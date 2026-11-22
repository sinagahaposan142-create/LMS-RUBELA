/* =====================================================================
 * js/avatars.js — Avatar Almamater (pengganti foto profil yang ringan)
 * ---------------------------------------------------------------------
 * Avatar digambar di perangkat sebagai SVG. Yang disimpan di akun hanya
 * kode pendek pada kolom photo, mis. "av1:ui:f:2" (kampus, cowok/cewek,
 * gaya 0–5), jadi database tidak perlu menyimpan gambar.
 *  - Jaket = warna jas almamater kampus. TIDAK memakai logo resmi; hanya
 *    warna dan singkatan nama kampus pada saku.
 *  - Warna bawaan adalah perkiraan; admin dapat menyesuaikannya di
 *    Pengaturan (setelan avatarCampusColors) tanpa mengubah avatar pengguna.
 *  - inner(user): isi lingkaran avatar (SVG avatar / foto / inisial) dipakai
 *    di seluruh aplikasi.
 * ===================================================================*/
(function (global) {
  'use strict';

  const VERSION = 'av1';
  const RE = /^av1:([a-z]{2,8}):([mf]):([0-5])$/;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Warna perkiraan jas almamater (tanpa logo). Admin dapat mengoreksi. */
  const CAMPUS = [
    { id: 'ui', short: 'UI', name: 'Universitas Indonesia', color: '#f2c230', match: /\bui\b|universitas indonesia/ },
    { id: 'ugm', short: 'UGM', name: 'Universitas Gadjah Mada', color: '#a8865a', match: /\bugm\b|gadjah ?mada/ },
    { id: 'itb', short: 'ITB', name: 'Institut Teknologi Bandung', color: '#1e3a6e', match: /\bitb\b|teknologi bandung/ },
    { id: 'ipb', short: 'IPB', name: 'IPB University', color: '#1b4d8f', match: /\bipb\b|pertanian bogor/ },
    { id: 'its', short: 'ITS', name: 'Institut Teknologi Sepuluh Nopember', color: '#0f5ea8', match: /\bits\b|sepuluh nopember/ },
    { id: 'unair', short: 'UNAIR', name: 'Universitas Airlangga', color: '#233f86', match: /unair|airlangga/ },
    { id: 'unpad', short: 'UNPAD', name: 'Universitas Padjadjaran', color: '#2b3a67', match: /unpad|padjadjaran/ },
    { id: 'undip', short: 'UNDIP', name: 'Universitas Diponegoro', color: '#1a4f9c', match: /undip|diponegoro/ },
    { id: 'ub', short: 'UB', name: 'Universitas Brawijaya', color: '#1d3461', match: /\bub\b|brawijaya/ },
    { id: 'uns', short: 'UNS', name: 'Universitas Sebelas Maret', color: '#4f8fd1', match: /\buns\b|sebelas maret/ },
    { id: 'unhas', short: 'UNHAS', name: 'Universitas Hasanuddin', color: '#b3202a', match: /unhas|hasanuddin/ },
    { id: 'unj', short: 'UNJ', name: 'Universitas Negeri Jakarta', color: '#1f7a4a', match: /\bunj\b|negeri jakarta/ }
  ];
  const SKIN = ['#f6d5b8', '#ecb98f', '#d49b6c', '#a8714c'];
  const HAIR = ['#2b1d17', '#3d2a1f', '#1f1a18', '#4b3325'];
  const STYLE_NAMES = {
    m: ['Rapi', 'Belah samping', 'Keriting', 'Cepak', 'Berkacamata', 'Gondrong'],
    f: ['Panjang', 'Bob', 'Hijab biru tua', 'Kuncir', 'Hijab mawar', 'Ikal']
  };

  /* ---------------- warna ---------------- */
  const HEX = /^#[0-9a-f]{6}$/i;
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(c) { return '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  function mix(hex, other, t) { const a = rgb(hex), b = rgb(other); return toHex(a.map((v, i) => v + (b[i] - v) * t)); }
  function luma(hex) { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  function overrides() {
    try {
      const s = global.DB && DB.getSettings ? DB.getSettings().avatarCampusColors : null;
      return s && typeof s === 'object' ? s : {};
    } catch (e) { return {}; }
  }
  /** Daftar kampus dengan warna terbaru (bawaan + koreksi admin). */
  function campuses() {
    const o = overrides();
    return CAMPUS.map(c => Object.assign({}, c, { color: HEX.test(o[c.id] || '') ? o[c.id].toLowerCase() : c.color, base: c.color }));
  }
  const campusOf = (id) => campuses().find(c => c.id === id) || null;

  function parse(v) {
    const m = RE.exec(String(v || ''));
    if (!m || !CAMPUS.some(c => c.id === m[1])) return null;
    return { campus: m[1], gender: m[2], style: Number(m[3]) };
  }
  const isPreset = (v) => !!parse(v);
  const idOf = (campus, gender, style) => `${VERSION}:${campus}:${gender}:${style}`;

  /* ---------------- gambar ---------------- */
  function hairMale(style, hc) {
    switch (style) {
      case 1: return `<path d="M37 55c-2-19 9-30 25-30 15 0 24 9 22 27-5-8-12-12-21-12-6 0-9 3-15 4-4 1-8 4-11 11z" fill="${hc}"/>`;
      case 2: return `<g fill="${hc}">${[[42, 40], [50, 33], [60, 30], [70, 33], [78, 40], [82, 49], [38, 49], [46, 36], [74, 36]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('')}</g>`;
      case 3: return `<path d="M38 52c0-17 10-26 22-26s22 9 22 26c-5-6-13-9-22-9s-17 3-22 9z" fill="${hc}" opacity=".85"/>`;
      case 5: return `<path d="M35 64c-4-25 7-40 25-40s29 15 25 40c-2-9-4-15-8-19-4 3-11 5-17 5s-13-2-17-5c-4 4-6 10-8 19z" fill="${hc}"/>`;
      default: return `<path d="M37 54c-1-19 9-29 23-29 15 0 24 10 23 29-4-8-12-13-23-13-10 0-19 5-23 13z" fill="${hc}"/>`;
    }
  }
  function hairFemaleBack(style, hc) {
    switch (style) {
      case 0: return `<path d="M33 58c-2-24 10-35 27-35s29 11 27 35l2 34c-7 4-15 2-19-4H50c-4 6-12 8-19 4z" fill="${hc}"/>`;
      case 1: return `<path d="M34 60c-2-23 9-35 26-35s28 12 26 35c0 9-2 15-5 19H39c-3-4-5-10-5-19z" fill="${hc}"/>`;
      case 3: return `<circle cx="86" cy="44" r="9" fill="${hc}"/><path d="M84 46c8 6 10 18 5 28-1-9-4-15-9-19z" fill="${hc}"/>`;
      case 5: return `<g fill="${hc}">${[[38, 62], [36, 74], [40, 86], [82, 62], [84, 74], [80, 86]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('')}</g>`;
      default: return '';
    }
  }
  function hairFemaleFront(style, hc) {
    switch (style) {
      case 1: return `<path d="M37 56c0-19 10-30 23-30 14 0 24 11 23 30-6-9-14-13-23-13-4 6-12 10-23 13z" fill="${hc}"/>`;
      case 3: return `<path d="M38 53c1-17 10-27 22-27 13 0 22 10 22 27-6-7-13-11-22-11s-16 4-22 11z" fill="${hc}"/>`;
      case 5: return `<g fill="${hc}">${[[44, 36], [52, 31], [61, 29], [70, 31], [77, 37], [82, 46], [39, 45]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('')}</g>`;
      default: return `<path d="M37 56c0-20 10-31 23-31 14 0 23 11 23 31-5-10-12-15-23-15-5 5-13 10-23 15z" fill="${hc}"/>`;
    }
  }
  function face(skin, shade, opts) {
    const o = opts || {};
    return `${o.ears ? `<circle cx="38" cy="59" r="5" fill="${shade}"/><circle cx="82" cy="59" r="5" fill="${shade}"/>` : ''}
      <ellipse cx="60" cy="58" rx="${o.rx || 22}" ry="${o.ry || 24}" fill="${skin}"/>
      <path d="M47 51.5q4-2.5 8 0M65 51.5q4-2.5 8 0" stroke="#3a2a22" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".75"/>
      <ellipse cx="51" cy="59" rx="2.7" ry="3.3" fill="#2a211d"/><ellipse cx="69" cy="59" rx="2.7" ry="3.3" fill="#2a211d"/>
      <circle cx="52" cy="57.8" r=".95" fill="#fff"/><circle cx="70" cy="57.8" r=".95" fill="#fff"/>
      <circle cx="45.5" cy="66" r="3.6" fill="#f08f8f" opacity=".38"/><circle cx="74.5" cy="66" r="3.6" fill="#f08f8f" opacity=".38"/>
      <path d="M54.5 67.5q5.5 5 11 0" stroke="#8a3b2f" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }
  function jacket(c, noShirt) {
    const col = c.color;
    const dark = mix(col, '#000000', 0.22);
    const light = luma(col) > 0.62;
    const patch = light ? mix(col, '#000000', 0.55) : '#ffffff';
    const patchText = light ? '#ffffff' : mix(col, '#000000', 0.15);
    const w = Math.max(13, c.short.length * 4.2 + 5);
    return `<path d="M14 122c2-22 18-34 46-34s44 12 46 34z" fill="${col}"/>
      ${noShirt ? '' : '<path d="M49 88l11 17 11-17z" fill="#ffffff"/>'}
      <path d="M47 88.5l13 18-7 8.5-10-23z" fill="${dark}"/><path d="M73 88.5l-13 18 7 8.5 10-23z" fill="${dark}"/>
      <path d="M58.6 106.5h2.8l1.2 15.5h-5.2z" fill="${dark}" opacity=".55"/>
      <g transform="translate(${77 - w / 2} 103)"><rect width="${w}" height="9" rx="2.2" fill="${patch}" opacity=".92"/>
        <text x="${w / 2}" y="6.6" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="5.8" font-weight="800" letter-spacing=".3" fill="${patchText}">${esc(c.short)}</text></g>`;
  }

  let seq = 0;
  /** SVG avatar dari kode preset. opts: { label } */
  function svg(code, opts) {
    const p = parse(code);
    if (!p) return '';
    const c = campusOf(p.campus);
    const skin = SKIN[p.style % SKIN.length];
    const shade = mix(skin, '#7a4a2c', 0.18);
    const hc = HAIR[(p.style + (p.gender === 'f' ? 1 : 0)) % HAIR.length];
    const uid = 'av' + (++seq).toString(36);
    const bg = mix(c.color, '#ffffff', luma(c.color) > 0.62 ? 0.72 : 0.84);
    let body = '';
    if (p.gender === 'f' && (p.style === 2 || p.style === 4)) {
      const hj = p.style === 2 ? '#2f3a4f' : '#b98b82';
      const hjEdge = mix(hj, '#000000', 0.14);
      body = `${jacket(c, true)}
        <path d="M31 60c0-25 13-37 29-37s29 12 29 37c0 14-5 24-11 30H42c-6-6-11-16-11-30z" fill="${hj}"/>
        <path d="M40 84q20 17 40 0l-4 14q-16 10-32 0z" fill="${hjEdge}"/>
        ${face(skin, shade, { rx: 19, ry: 21 })}`;
    } else if (p.gender === 'f') {
      body = `${hairFemaleBack(p.style, hc)}${jacket(c)}<rect x="53" y="74" width="14" height="16" rx="5" fill="${shade}"/>
        ${face(skin, shade, { ears: false })}${hairFemaleFront(p.style, hc)}`;
    } else {
      body = `${jacket(c)}<rect x="53" y="74" width="14" height="16" rx="5" fill="${shade}"/>
        ${face(skin, shade, { ears: true })}${hairMale(p.style, hc)}
        ${p.style === 4 ? '<g fill="none" stroke="#2a2522" stroke-width="1.8"><circle cx="51" cy="59" r="6.2"/><circle cx="69" cy="59" r="6.2"/><path d="M57.2 59h5.6M44.8 58l-6-2M75.2 58l6-2"/></g>' : ''}`;
    }
    const label = (opts && opts.label) || `Avatar ${p.gender === 'f' ? 'cewek' : 'cowok'} jas almamater ${c.name}`;
    return `<svg class="av-svg" viewBox="0 0 120 120" role="img" aria-label="${esc(label)}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="${uid}c"><circle cx="60" cy="60" r="60"/></clipPath></defs>
      <g clip-path="url(#${uid}c)"><rect width="120" height="120" fill="${bg}"/>${body}</g></svg>`;
  }

  const initials = (name) => (global.UI && UI.initials ? UI.initials(name || '?') : String(name || '?').slice(0, 2).toUpperCase());
  /** Isi lingkaran avatar: SVG avatar, foto, atau inisial (sudah di-escape). */
  function inner(user) {
    const v = user && user.photo;
    if (isPreset(v)) return svg(v, { label: 'Avatar ' + (user.name || '') });
    if (v && /^data:image\/(png|jpe?g|webp);base64,/i.test(v)) return `<img src="${esc(v)}" alt="" loading="lazy" />`;
    return esc(initials(user ? user.name : '?'));
  }

  /* ---------------- pemilih avatar ---------------- */
  /** Kampus tujuan siswa (targetUniv) → kampus avatar yang cocok. */
  function suggestCampus(user) {
    const t = String((user && user.targetUniv) || '').toLowerCase();
    const hit = t && CAMPUS.find(c => c.match.test(t));
    return hit ? hit.id : 'ui';
  }
  /**
   * Panel pemilih di dalam form profil. host: elemen kosong.
   * opts: { value, user, onPick(code) }. Kembalian: { set(code) }.
   */
  function mountPicker(host, opts) {
    const o = opts || {};
    const cur = parse(o.value);
    const st = { campus: cur ? cur.campus : suggestCampus(o.user), gender: cur ? cur.gender : 'f' };
    function paint() {
      const list = campuses();
      host.innerHTML = `<div class="avp" role="group" aria-label="Pilih avatar almamater">
        <div class="avp-row">
          <div class="avp-seg" role="radiogroup" aria-label="Jenis avatar">
            ${[['f', 'Cewek'], ['m', 'Cowok']].map(([g, l]) => `<button type="button" role="radio" aria-checked="${st.gender === g}" class="${st.gender === g ? 'is-on' : ''}" data-avp-g="${g}">${l}</button>`).join('')}
          </div>
          <label class="avp-camp"><span class="sr-only">Kampus</span>
            <select data-avp-c>${list.map(c => `<option value="${c.id}" ${c.id === st.campus ? 'selected' : ''}>${esc(c.short)} — ${esc(c.name)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="avp-swatches" aria-hidden="true">${list.map(c => `<button type="button" tabindex="-1" class="avp-sw ${c.id === st.campus ? 'is-on' : ''}" style="--sw:${c.color}" data-avp-sw="${c.id}" title="${esc(c.name)}"><span>${esc(c.short)}</span></button>`).join('')}</div>
        <div class="avp-grid" role="radiogroup" aria-label="Gaya avatar">
          ${[0, 1, 2, 3, 4, 5].map(i => {
            const code = idOf(st.campus, st.gender, i);
            const on = o.value === code;
            return `<button type="button" role="radio" aria-checked="${!!on}" class="avp-opt ${on ? 'is-on' : ''}" data-avp-pick="${code}" title="${esc(STYLE_NAMES[st.gender][i])}">${svg(code)}<span>${esc(STYLE_NAMES[st.gender][i])}</span></button>`;
          }).join('')}
        </div>
        <p class="avp-note">Avatar tidak memakai logo kampus. Warna jaket mengikuti jas almamater (perkiraan) dan hanya kode pendek yang disimpan, bukan gambar.</p>
      </div>`;
      host.querySelectorAll('[data-avp-g]').forEach(b => b.addEventListener('click', () => { st.gender = b.dataset.avpG; paint(); }));
      host.querySelector('[data-avp-c]').addEventListener('change', (e) => { st.campus = e.target.value; paint(); });
      host.querySelectorAll('[data-avp-sw]').forEach(b => b.addEventListener('click', () => { st.campus = b.dataset.avpSw; paint(); }));
      host.querySelectorAll('[data-avp-pick]').forEach(b => b.addEventListener('click', () => {
        o.value = b.dataset.avpPick;
        Object.assign(st, parse(o.value));
        if (o.onPick) o.onPick(o.value);
        paint();
      }));
    }
    paint();
    return { set(code) { o.value = code; const p = parse(code); if (p) Object.assign(st, p); paint(); } };
  }

  /* ---------------- pengaturan admin ---------------- */
  function renderAdmin(el) {
    if (!el) return;
    const list = campuses();
    const o = overrides();
    el.innerHTML = `<div class="card-header">${global.UI && UI.secHead ? UI.secHead('🎓', 'Avatar Almamater', 'warna jaket avatar profil per kampus') : '<h3>Avatar Almamater</h3>'}</div>
      <p class="muted small">Pengguna memilih avatar cowok/cewek berjas almamater sebagai pengganti foto profil. Warna bawaan adalah perkiraan; sesuaikan bila berbeda dari jas almamater asli. Perubahan langsung berlaku untuk semua avatar kampus tersebut.</p>
      <div class="avc-grid">${list.map(c => `<label class="avc-item">
          <span class="avc-prev">${svg(idOf(c.id, 'm', 0))}</span>
          <span class="avc-txt"><strong>${esc(c.short)}</strong><small>${esc(c.name)}</small></span>
          <input type="color" value="${c.color}" data-avc="${c.id}" aria-label="Warna jaket ${esc(c.name)}" />
          ${o[c.id] ? `<button type="button" class="btn btn-sm btn-ghost" data-avc-reset="${c.id}">Bawaan</button>` : ''}
        </label>`).join('')}</div>`;
    const save = (next) => {
      const clean = {};
      Object.keys(next).forEach(k => { if (CAMPUS.some(c => c.id === k) && HEX.test(next[k])) clean[k] = next[k].toLowerCase(); });
      DB.setSetting('avatarCampusColors', clean);
      renderAdmin(el);
      if (global.Dashboard && Dashboard.refreshAvatar) Dashboard.refreshAvatar();
    };
    el.querySelectorAll('[data-avc]').forEach(inp => inp.addEventListener('change', () => {
      const id = inp.dataset.avc;
      const next = Object.assign({}, overrides());
      const base = CAMPUS.find(c => c.id === id).color;
      if (inp.value.toLowerCase() === base) delete next[id]; else next[id] = inp.value;
      save(next);
      if (global.UI) UI.toast('Warna jaket ' + id.toUpperCase() + ' disimpan.', 'success');
    }));
    el.querySelectorAll('[data-avc-reset]').forEach(b => b.addEventListener('click', () => {
      const next = Object.assign({}, overrides());
      delete next[b.dataset.avcReset];
      save(next);
    }));
  }

  global.Avatars = { CAMPUS, campuses, parse, isPreset, idOf, svg, inner, mountPicker, renderAdmin, suggestCampus, STYLE_NAMES };
})(window);
