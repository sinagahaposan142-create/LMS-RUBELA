/* =====================================================================
 * js/games-arcade.js — 8 game arkade untuk Game Battle
 * ---------------------------------------------------------------------
 *  11 Petualangan Peta   : jelajahi pulau, pilih jalur aman / berbahaya
 *  12 Pertarungan Monster: pilih peran & jurus, kalahkan Goblin → Orc → Golem
 *  13 Balapan Mobil      : 8 sirkuit, gerbang soal memberi Turbo/Perisai/Oli
 *  14 Lari-Lompat        : lari di lintasan atletik, lompati gawang, masuk
 *                          gerbang jawaban yang benar
 *  15 Tarik Tambang      : tiap jawaban benar menarik tali ke timmu
 *  16 Tangkap Jawaban    : gerakkan keranjang, tangkap jawaban yang benar
 *  17 Rebut Wilayah      : rebut petak heksagon dari lawan
 *  18 Ludo Edukasi       : lempar dadu, jawab benar untuk melangkah
 *
 * Setiap game memakai mesin yang sama dengan 10 game dasar (js/games.js):
 * ctx (skor, timer, umpan balik), mode pribadi / battle / lawan bot /
 * pratinjau, skor & XP. Gambar: js/game-art.js, balapan: js/race-engine.js.
 * Kontrol: sentuh (tombol & usap), keyboard, dan suara untuk soal PG/BS.
 * ===================================================================*/
(function (global) {
  'use strict';
  if (!global.Games || !Games.kit) return;
  const { askTurn, beep, shuffle, gainHtml, fmtOf, optCount, plain, rt, esc, fmt, reducedMotion, ALL_AUTO } = Games.kit;
  const Art = global.GameArt;
  const ic = (n, s) => Art.icon(n, s);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sub = (ctx, host) => Object.assign({}, ctx, { stage: host });

  /* ---------- pemilihan soal ---------- */
  /** Ambil soal berikutnya yang belum dipakai (utamakan tingkat tertentu), berputar bila habis. */
  function picker(qs) {
    const used = new Set();
    let last = null;
    return function next(pref) {
      let cand = qs.filter(q => !used.has(q));
      if (!cand.length) { used.clear(); cand = qs.filter(q => q !== last); if (!cand.length) cand = qs.slice(); }
      const want = pref ? cand.filter(q => (q.difficulty || 'sedang') === pref) : [];
      const q = (want.length ? want : cand)[0];
      used.add(q); last = q;
      return q;
    };
  }
  const isPG = (q) => fmtOf(q) === 'Pilihan Ganda';
  const isBS = (q) => fmtOf(q) === 'Benar/Salah';
  const shortOpts = (q, n) => (q.options || []).every(o => plain(o).length <= (n || 40));
  /** Pilihan jawaban ringkas untuk game gerak (gerbang/benda jatuh): kunci + pengecoh, maks. `max`. */
  function compactChoices(q, rng, max) {
    if (isBS(q)) {
      const o = (q.options || []).map(x => plain(x, 30));
      const labels = o.length === 2 && o[0] && o[1] ? o : ['Benar', 'Salah'];
      return labels.map((t, i) => ({ t, ok: i === q.correctIndex }));
    }
    const all = (q.options || []).map((o, i) => ({ t: plain(o, 60), ok: i === q.correctIndex })).filter(x => x.t);
    const key = all.filter(x => x.ok);
    const rest = shuffle(all.filter(x => !x.ok), rng).slice(0, Math.max(1, (max || 3) - 1));
    return shuffle(key.concat(rest), rng);
  }
  /** Teks dibungkus maksimal `lines` baris pada kanvas. */
  function wrapText(g, text, maxW, lines) {
    const words = String(text).split(/\s+/);
    const out = [];
    let cur = '';
    words.forEach(w => {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/.{0,2}$/, '…'); }
    return out;
  }
  /** Loop animasi yang otomatis berhenti saat sesi game berakhir. */
  function loop(ctx, fn) {
    let raf = 0, last = performance.now(), alive = true;
    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!ctx.stage.isConnected) { alive = false; return; }
      fn(dt, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => { alive = false; cancelAnimationFrame(raf); };
    ctx.onDispose(stop);
    return stop;
  }
  /** Tombol keyboard selama game berjalan. */
  function keys(ctx, map) {
    const h = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (map[k]) { e.preventDefault(); map[k](e); }
    };
    document.addEventListener('keydown', h);
    ctx.onDispose(() => document.removeEventListener('keydown', h));
  }
  /** Usap kiri/kanan/atas pada elemen. */
  function swipe(ctx, el, on) {
    let x0 = 0, y0 = 0, t0 = 0;
    const s = (e) => { const p = e.touches ? e.touches[0] : e; x0 = p.clientX; y0 = p.clientY; t0 = Date.now(); };
    const e2 = (e) => {
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - x0, dy = p.clientY - y0;
      if (Date.now() - t0 > 600) return;
      if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) on(dx < 0 ? 'left' : 'right');
      else if (dy < -28) on('up');
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && on.tap) on.tap(p);
    };
    el.addEventListener('touchstart', s, { passive: true });
    el.addEventListener('touchend', e2);
    ctx.onDispose(() => { el.removeEventListener('touchstart', s); el.removeEventListener('touchend', e2); });
  }
  /** Angka melayang (+poin / −HP) di atas elemen. */
  function floatNum(host, text, cls, x, y) {
    const s = document.createElement('span');
    s.className = 'ar-float ' + (cls || '');
    s.textContent = text;
    s.style.left = x + '%';
    s.style.top = y + '%';
    host.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
  const hearts = (n, max) => `<span class="ar-hearts" aria-label="${n} dari ${max} nyawa">${Array.from({ length: max }, (_, i) => `<span class="${i < n ? 'is-on' : ''}">${ic('heart', 16)}</span>`).join('')}</span>`;

  /* ================================================================
   * 11 — Petualangan Peta
   * ==============================================================*/
  const MAP_NODES = {
    S: [26, 198, 'Dermaga'], N1: [66, 170, 'Pantai Karang'], N2: [104, 132, 'Hutan Bambu'],
    A1: [138, 178, 'Jalan Setapak'], A2: [178, 168, 'Ladang Jagung'], AD: [158, 98, 'Jembatan Gantung'],
    N3: [210, 132, 'Desa Nelayan'], N4: [238, 90, 'Gua Kristal'],
    B1: [276, 128, 'Sungai Deras'], B2: [314, 112, 'Air Terjun'], BD: [282, 52, 'Tebing Api'], F: [334, 60, 'Kuil Harta']
  };
  const MAP_EDGES = [['S', 'N1'], ['N1', 'N2'], ['N2', 'A1'], ['A1', 'A2'], ['A2', 'N3'], ['N2', 'AD'], ['AD', 'N3'], ['N3', 'N4'], ['N4', 'B1'], ['B1', 'B2'], ['B2', 'F'], ['N4', 'BD'], ['BD', 'F']];
  const MAP_ROUTE = ['N1', 'N2', { safe: ['A1', 'A2'], danger: ['AD'] }, 'N3', 'N4', { safe: ['B1', 'B2'], danger: ['BD'] }, 'F'];

  function mapSvg() {
    const n = MAP_NODES;
    const nodes = Object.keys(n).map(k => {
      const [x, y, name] = n[k];
      const danger = k === 'AD' || k === 'BD', fin = k === 'F';
      return `<g class="ar-node ${danger ? 'is-danger' : ''} ${fin ? 'is-final' : ''}" data-node="${k}" transform="translate(${x},${y})">
        <circle r="${fin ? 11 : 8.5}" class="ar-node-c"/>
        ${danger ? '<path d="M-3.5 -1.5 a3.5 3.5 0 1 1 7 0 v3 h-7z" fill="#fff"/>' : ''}
        ${fin ? '<path d="M-5 -5 5 5M5 -5 -5 5" stroke="#dc2626" stroke-width="3" stroke-linecap="round"/>' : ''}
        <text y="${fin ? 22 : 19}" text-anchor="middle" class="ar-node-l">${name}</text></g>`;
    }).join('');
    return `<svg class="ar-map" viewBox="0 0 360 222" role="img" aria-label="Peta pulau petualangan">
      <defs><pattern id="arWave" width="24" height="12" patternUnits="userSpaceOnUse"><path d="M0 8 q6 -6 12 0 t12 0" stroke="rgba(255,255,255,.35)" fill="none"/></pattern></defs>
      <rect width="360" height="222" rx="16" fill="#38bdf8"/><rect width="360" height="222" rx="16" fill="url(#arWave)"/>
      <path d="M8,214 C2,150 34,108 76,92 C108,54 168,54 208,64 C248,22 322,10 352,34 C366,68 356,112 340,142 C322,184 262,178 232,190 C192,214 122,220 70,220 C38,220 12,220 8,214 Z" fill="#fde68a"/>
      <path d="M34,200 C40,150 70,124 96,112 C126,82 176,86 210,96 C250,58 316,44 336,62 C346,90 330,124 312,146 C290,170 250,162 222,172 C184,192 120,200 70,202 Z" fill="#86efac"/>
      <path d="M262 64 l20 -34 l20 34z" fill="#78716c"/><path d="M276 40 l6 -10 l6 10z" fill="#f97316"/>
      <path d="M318 118 v22" stroke="#e0f2fe" stroke-width="5" stroke-linecap="round"/>
      ${[[52, 190], [92, 160], [128, 120], [196, 182], [226, 112], [300, 150]].map(([x, y]) => `<g transform="translate(${x},${y})"><circle r="6" fill="#16a34a"/><rect x="-1" y="5" width="2" height="4" fill="#92400e"/></g>`).join('')}
      ${MAP_EDGES.map(([a, b]) => `<path class="ar-edge" data-edge="${a}-${b}" d="M${n[a][0]},${n[a][1]} L${n[b][0]},${n[b][1]}"/>`).join('')}
      ${nodes}
      <g class="ar-token" id="arToken" transform="translate(${n.S[0]},${n.S[1]})"><path d="M0 0 c-6 -8 -9 -12 -9 -17 a9 9 0 0 1 18 0 c0 5 -3 9 -9 17z" fill="#2563eb" stroke="#fff" stroke-width="2"/><circle cy="-17" r="3.5" fill="#fff"/></g>
    </svg>`;
  }

  const peta = {
    id: 'peta', name: 'Petualangan Peta', icon: '🗺️', art: Art.cardArt('peta'), color: '#0ea5e9', tag: 'Jelajah pulau',
    desc: 'Jelajahi pulau dari Dermaga ke Kuil Harta. Tiap tempat = satu soal. Di persimpangan pilih Jalur Aman (2 soal mudah) atau Jalur Berbahaya (1 soal sulit, poin ×2 + peti harta). Salah menguras tenaga — 3 tenaga.',
    formats: ALL_AUTO, accepts: () => true, min: 6, limitSec: 14 * 25 + 90,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 14),
    bot: { units: 9, sec: 11, per: 130, wrong: 0, lives: 3 },
    play(ctx) {
      const next = picker(ctx.qs);
      let energy = 3, routeIdx = 0, at = 'S', asked = 0, keyAct = null;
      const visited = new Set(['S']);
      keys(ctx, { 1: () => keyAct && keyAct('safe'), 2: () => keyAct && keyAct('danger') });
      ctx.stage.innerHTML = `<div class="ar-peta"><div class="ar-peta-map">${mapSvg()}</div>
        <div class="ar-peta-status" aria-live="polite"></div><div class="ar-peta-panel"></div></div>`;
      const svg = ctx.stage.querySelector('.ar-map');
      const panel = ctx.stage.querySelector('.ar-peta-panel');
      const status = ctx.stage.querySelector('.ar-peta-status');
      const token = svg.querySelector('#arToken');
      const paint = () => {
        svg.querySelectorAll('[data-node]').forEach(g => {
          g.classList.toggle('is-done', visited.has(g.dataset.node) && g.dataset.node !== at);
          g.classList.toggle('is-here', g.dataset.node === at);
        });
        ctx.info(`Tenaga ${energy}/3 • ${MAP_NODES[at][2]}`);
        status.innerHTML = `${hearts(energy, 3)}<span>Posisi: <b>${esc(MAP_NODES[at][2])}</b></span>`;
      };
      const moveTo = (k, done) => {
        const prev = at;
        at = k; visited.add(k);
        const e = svg.querySelector(`[data-edge="${prev}-${k}"]`);
        if (e) e.classList.add('is-walked');
        token.setAttribute('transform', `translate(${MAP_NODES[k][0]},${MAP_NODES[k][1]})`);
        paint();
        ctx.after(reducedMotion() ? 50 : 650, done);
      };
      const end = (msg) => {
        panel.innerHTML = `<div class="ar-end">${msg}</div>`;
        ctx.after(1600, () => ctx.finish());
      };
      const askAt = (k, kind, done) => {
        const pref = kind === 'safe' ? 'mudah' : (kind === 'danger' || k === 'F' ? 'sulit' : null);
        const q = next(pref);
        asked++;
        const extra = kind === 'danger' ? `<span class="gb-chip-s d-sulit">${ic('skull', 12)} Berbahaya ×2</span>` : (k === 'F' ? `<span class="gb-chip-s d-sulit">${ic('chest', 12)} Harta</span>` : '');
        askTurn(sub(ctx, panel), q, asked, null, 25, (r) => {
          ctx.hideTimer();
          ctx.mark(r.correct);
          if (r.correct) {
            const base = { mudah: 70, sedang: 100, sulit: 140 }[q.difficulty] || 100;
            let gain = base + Math.round(r.left / 25 * base * 0.5);
            if (kind === 'danger') gain = gain * 2 + 150;
            if (k === 'F') gain += 300;
            ctx.add(gain);
            r.fb.insertAdjacentHTML('beforeend', gainHtml(gain) + (kind === 'danger' ? ` <span class="ar-tag">${ic('chest', 14)} Peti harta +150</span>` : ''));
            ctx.after(1300, done);
          } else {
            energy--;
            paint();
            r.fb.insertAdjacentHTML('beforeend', `<span class="gb-gain is-down">−1 tenaga</span>`);
            if (energy <= 0) return ctx.after(1400, () => end(`<h3>Tenagamu habis di ${esc(MAP_NODES[k][2])}</h3><p class="muted">Istirahat dulu, lalu coba lagi!</p>`));
            ctx.after(1500, () => { status.insertAdjacentHTML('beforeend', '<span class="ar-tag">Coba soal lain di tempat yang sama</span>'); askAt(k, kind, done); });
          }
        }, { extra });
      };
      const walk = (list, kind, done) => {
        if (!list.length) return done();
        const k = list[0];
        moveTo(k, () => askAt(k, kind, () => walk(list.slice(1), kind, done)));
      };
      const stepRoute = () => {
        if (routeIdx >= MAP_ROUTE.length) return end(`<div class="ar-end-ic">${ic('chest', 40)}</div><h3>Harta karun ditemukan!</h3><p class="muted">Petualangan selesai dengan tenaga ${energy}/3.</p>`);
        const st = MAP_ROUTE[routeIdx++];
        if (typeof st === 'string') return walk([st], st === 'F' ? 'final' : 'normal', stepRoute);
        const [s1, s2] = st.safe, d1 = st.danger[0];
        svg.querySelectorAll('[data-node]').forEach(g => g.classList.toggle('is-option', [s1, d1].includes(g.dataset.node)));
        panel.innerHTML = `<div class="ar-fork"><h3>${ic('map', 20)} Persimpangan! Pilih jalurmu</h3>
          <div class="ar-fork-opts">
            <button type="button" class="ar-fork-b is-safe" data-path="safe">${ic('shield', 22)}<strong>Jalur Aman</strong><span>${esc(MAP_NODES[s1][2])} → ${esc(MAP_NODES[s2][2])}</span><small>2 soal, utamakan mudah</small></button>
            <button type="button" class="ar-fork-b is-danger" data-path="danger">${ic('skull', 22)}<strong>Jalur Berbahaya</strong><span>${esc(MAP_NODES[d1][2])}</span><small>1 soal sulit • poin ×2 + peti harta</small></button>
          </div><p class="muted small">Tombol 1 = aman, 2 = berbahaya</p></div>`;
        const go = (kind) => {
          if (panel.dataset.busy) return;
          panel.dataset.busy = '1';
          keyAct = null;
          svg.querySelectorAll('.is-option').forEach(g => g.classList.remove('is-option'));
          beep('pop');
          walk(kind === 'safe' ? [s1, s2] : [d1], kind, () => { delete panel.dataset.busy; stepRoute(); });
        };
        panel.querySelectorAll('[data-path]').forEach(b => b.addEventListener('click', () => go(b.dataset.path)));
        keyAct = go;
      };
      paint();
      stepRoute();
    }
  };

  /* ================================================================
   * 12 — Pertarungan Monster (pribadi). Peran & jurus juga dipakai
   * Monster Co-op di Main Bareng Kelas (js/game-room.js).
   * ==============================================================*/
  const SKILLS = {
    penyerang: [
      { id: 'tebas', name: 'Tebasan', icon: 'sword', dmg: 34, desc: 'Serangan 34' },
      { id: 'berat', name: 'Serangan Berat', icon: 'bolt', dmg: 52, risk: 12, desc: 'Serangan 52 • salah: kamu −12 HP' }
    ],
    penyihir: [
      { id: 'api', name: 'Bola Api', icon: 'wand', dmg: 30, desc: 'Sihir 30' },
      { id: 'kutuk', name: 'Kutukan', icon: 'skull', dmg: 16, weaken: 0.4, desc: 'Sihir 16 • serangan monster −40% ronde ini' }
    ],
    penjaga: [
      { id: 'tameng', name: 'Perisai Kelompok', icon: 'shield', dmg: 12, guard: 0.5, desc: 'Serangan 12 • luka semua teman −50%' },
      { id: 'provokasi', name: 'Provokasi', icon: 'target', dmg: 20, taunt: true, desc: 'Serangan 20 • monster hanya menyerangmu, lukamu −50%' }
    ],
    penyembuh: [
      { id: 'pulih', name: 'Pulihkan', icon: 'cross', dmg: 8, heal: 36, revive: true, desc: 'Pulihkan 36 HP teman terlemah atau bangkitkan yang pingsan' },
      { id: 'berkah', name: 'Berkah', icon: 'heart', dmg: 6, healAll: 16, desc: 'Semua teman +16 HP' }
    ]
  };
  const MON_ORDER = ['goblin', 'orc', 'golem'];
  const SOLO_HP = { goblin: 90, orc: 140, golem: 200 };
  const DEFEAT_BONUS = { goblin: 150, orc: 250, golem: 400 };
  const CRIT_AT = 0.6;              // sisa waktu ≥ 60% (menjawab di 40% awal) = kritis
  const CRIT_MULT = 1.6;
  const diffMult = (q) => ({ mudah: 0.85, sedang: 1, sulit: 1.25 }[q && q.difficulty] || 1);

  function roleCardsHtml() {
    return `<div class="ar-roles">${Object.entries(Art.ROLES).map(([k, r]) => `
      <button type="button" class="ar-role" data-role="${k}" style="--rc:${r.color}">
        <span class="ar-role-fig">${Art.hero(k)}</span><strong>${ic(r.icon, 16)} ${esc(r.name)}</strong><small>${esc(r.desc)}</small>
        <span class="ar-role-sk">${SKILLS[k].map(s => `<em>${esc(s.name)}</em>`).join('')}</span>
      </button>`).join('')}</div>`;
  }

  const monsterGame = {
    id: 'monster', name: 'Pertarungan Monster', icon: '👹', art: Art.cardArt('monster'), color: '#65a30d', tag: 'RPG 3 monster',
    desc: 'Pilih peran (Penyerang, Penyihir, Penjaga, Penyembuh), lalu tiap ronde pilih jurus dan jawab soal. Benar = jurus mengenai monster, cepat = serangan kritis. Monster membalas! Kalahkan Goblin, Orc, lalu Golem raksasa.',
    formats: ALL_AUTO, accepts: () => true, min: 6, limitSec: 18 * 28 + 90,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 18),
    bot: { units: 14, sec: 12, per: 120, wrong: 0, lives: 3 },
    play(ctx) {
      const next = picker(ctx.qs);
      const st = { role: null, hp: 100, max: 100, potion: true, mi: 0, mhp: 0, mmax: 0, round: 0, dealt: 0 };
      let keyAct = null;
      keys(ctx, { 1: () => keyAct && keyAct(0), 2: () => keyAct && keyAct(1) });
      ctx.stage.innerHTML = `<div class="ar-mon">
          <div class="ar-mon-scene">
            <div class="ar-side is-hero"><div class="ar-hp"><i></i><b></b></div><div class="ar-fig" id="arHero"></div><div class="ar-nm" id="arHeroNm">Pilih peran</div></div>
            <div class="ar-mid"><span id="arRound">Ronde 0</span></div>
            <div class="ar-side is-mon"><div class="ar-hp is-mon"><i></i><b></b></div><div class="ar-fig" id="arMon"></div><div class="ar-nm" id="arMonNm"></div></div>
            <div class="ar-fx" aria-hidden="true"></div>
          </div>
          <div class="ar-mon-log" aria-live="polite"></div>
          <div class="ar-mon-panel"></div></div>`;
      const $ = (s) => ctx.stage.querySelector(s);
      const panel = $('.ar-mon-panel'), fx = $('.ar-fx'), log = $('.ar-mon-log');
      const kind = () => MON_ORDER[st.mi];
      const bars = () => {
        const h = $('.is-hero .ar-hp'), m = $('.ar-hp.is-mon');
        h.querySelector('i').style.width = (st.hp / st.max * 100) + '%'; h.querySelector('b').textContent = `${Math.max(0, Math.round(st.hp))}/${st.max}`;
        m.querySelector('i').style.width = (st.mhp / st.mmax * 100) + '%'; m.querySelector('b').textContent = `${Math.max(0, Math.round(st.mhp))}/${st.mmax}`;
        ctx.info(`HP ${Math.max(0, Math.round(st.hp))} • ${Art.MONSTERS[kind()].name} ${Math.max(0, Math.round(st.mhp))}`);
      };
      const spawn = () => {
        const k = kind();
        st.mmax = st.mhp = SOLO_HP[k];
        $('#arMon').innerHTML = Art.monster(k, 'is-enter');
        $('#arMonNm').textContent = Art.MONSTERS[k].title;
        bars();
      };
      const anim = (sel, cls, ms) => { const el = $(sel); if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms || 600); };
      const proj = (role) => { if (reducedMotion()) return; const p = document.createElement('span'); p.className = 'ar-proj is-' + role; fx.appendChild(p); setTimeout(() => p.remove(), 700); };

      const chooseRole = () => {
        panel.innerHTML = `<h3 class="ar-h">${ic('users', 20)} Pilih peranmu</h3>${roleCardsHtml()}`;
        panel.querySelectorAll('[data-role]').forEach(b => b.addEventListener('click', () => {
          st.role = b.dataset.role;
          $('#arHero').innerHTML = Art.hero(st.role);
          $('#arHeroNm').textContent = 'Kamu • ' + Art.ROLES[st.role].name;
          beep('go');
          spawn();
          round();
        }));
      };
      const round = () => {
        st.round++;
        $('#arRound').textContent = 'Ronde ' + st.round;
        const m = Art.MONSTERS[kind()];
        const sk = SKILLS[st.role];
        panel.innerHTML = `<div class="ar-skills"><p class="ar-intent">${ic('skull', 16)} ${esc(m.name)} bersiap menyerang (±${m.atk + st.mi * 2})</p>
          <h3 class="ar-h">Pilih jurus</h3>
          <div class="ar-sk-row">${sk.map((s, i) => `<button type="button" class="ar-sk" data-sk="${i}" style="--rc:${Art.ROLES[st.role].color}">
            ${ic(s.icon, 22)}<strong>${i + 1}. ${esc(s.name)}</strong><small>${esc(s.desc)}</small></button>`).join('')}</div></div>`;
        let picked = false;
        const pick = (i) => {
          if (picked) return;
          picked = true;
          keyAct = null;
          ask(sk[i]);
        };
        panel.querySelectorAll('[data-sk]').forEach(b => b.addEventListener('click', () => pick(Number(b.dataset.sk))));
        keyAct = pick;
      };
      const ask = (skill) => {
        const q = next();
        askTurn(sub(ctx, panel), q, st.round, null, 20, (r) => {
          ctx.hideTimer();
          ctx.mark(r.correct);
          ctx.after(900, () => resolve(skill, q, r));
        }, { extra: `<span class="gb-chip-s">${ic(skill.icon, 12)} ${esc(skill.name)}</span>` });
      };
      const resolve = (skill, q, r) => {
        const crit = r.correct && r.left / 20 >= CRIT_AT;
        let gain = 0, guard = 1, weaken = 1;
        const lines = [];
        if (r.correct) {
          const dmg = Math.round(skill.dmg * diffMult(q) * (crit ? CRIT_MULT : 1));
          st.mhp -= dmg; st.dealt += dmg; gain += dmg + 50;
          proj(st.role);
          setTimeout(() => { anim('#arMon .ga-monster', 'is-hit'); floatNum(fx, (crit ? 'KRITIS −' : '−') + dmg, crit ? 'is-crit' : 'is-dmg', 74, 30); }, reducedMotion() ? 0 : 380);
          lines.push(`${esc(skill.name)} mengenai! −${dmg}${crit ? ' (KRITIS)' : ''}`);
          if (skill.heal || skill.healAll) {
            const h = Math.round((skill.heal || skill.healAll) * (crit ? 1.5 : 1));
            const real = Math.min(h, st.max - st.hp);
            st.hp += real; gain += Math.round(real * 0.5);
            if (real) { floatNum(fx, '+' + real, 'is-heal', 20, 30); lines.push(`Pulih +${real} HP`); }
          }
          if (skill.guard) guard = 1 - skill.guard;
          if (skill.taunt) guard = 0.5;
          if (skill.weaken) weaken = 1 - skill.weaken;
        } else {
          lines.push(r.timedOut ? 'Waktu habis — jurus gagal.' : 'Jawaban salah — jurus meleset.');
          if (skill.risk) { st.hp -= skill.risk; floatNum(fx, '−' + skill.risk, 'is-dmg', 20, 30); lines.push(`Serangan berat membuatmu lelah −${skill.risk}`); }
        }
        if (gain) ctx.add(gain);
        bars();
        const after = () => {
          if (st.mhp <= 0) {
            const k = kind();
            ctx.add(DEFEAT_BONUS[k]);
            anim('#arMon .ga-monster', 'is-down', 1200);
            beep('win');
            log.innerHTML = `<b>${esc(Art.MONSTERS[k].title)} kalah!</b> ${gainHtml(DEFEAT_BONUS[k])}`;
            st.mi++;
            if (st.mi >= MON_ORDER.length) {
              return ctx.after(1500, () => { panel.innerHTML = `<div class="ar-end"><div class="ar-end-ic">${ic('trophy', 40)}</div><h3>Semua monster dikalahkan!</h3><p class="muted">Total serangan ${fmt(st.dealt)} dalam ${st.round} ronde.</p></div>`; ctx.after(1500, () => ctx.finish()); });
            }
            st.hp = Math.min(st.max, st.hp + 25);
            return ctx.after(1500, () => { log.innerHTML = `Monster berikutnya datang: <b>${esc(Art.MONSTERS[kind()].title)}</b> • kamu pulih +25 HP`; spawn(); ctx.after(900, round); });
          }
          // Monster membalas
          const m = Art.MONSTERS[kind()];
          const atk = Math.round((m.atk + st.mi * 2 + Math.floor(ctx.rng() * 5) - 2) * guard * weaken);
          ctx.after(reducedMotion() ? 200 : 700, () => {
            anim('#arMon .ga-monster', 'is-attack', 600);
            ctx.after(reducedMotion() ? 0 : 300, () => {
              st.hp -= atk;
              anim('#arHero .ga-hero', 'is-hurt', 500);
              if (!reducedMotion()) anim('.ar-mon-scene', 'is-shake', 400);
              floatNum(fx, '−' + atk, 'is-dmg', 20, 30);
              lines.push(`${esc(m.name)} menyerang −${atk}${guard < 1 ? ' (tertahan)' : ''}${weaken < 1 ? ' (melemah)' : ''}`);
              log.innerHTML = lines.join(' • ');
              if (st.hp <= 0) {
                if (st.potion) {
                  st.potion = false; st.hp = 40;
                  log.innerHTML += ` • <b>Ramuan Kebangkitan dipakai: bangkit dengan 40 HP</b>`;
                  bars();
                  return ctx.after(1600, round);
                }
                st.hp = 0; bars();
                $('#arHero .ga-hero').classList.add('is-ko');
                return ctx.after(1300, () => { panel.innerHTML = `<div class="ar-end"><h3>Kamu pingsan…</h3><p class="muted">Monster ke-${st.mi + 1} terlalu kuat kali ini. Total serangan ${fmt(st.dealt)}.</p></div>`; ctx.after(1500, () => ctx.finish()); });
              }
              bars();
              ctx.after(1300, round);
            });
          });
        };
        log.innerHTML = lines.join(' • ');
        ctx.after(reducedMotion() ? 300 : 900, after);
      };
      chooseRole();
    }
  };

  /* ================================================================
   * Soal di atas layar permainan (tanpa timer utama ctx) — dipakai
   * Balapan Mobil & Main Bareng Kelas. Mengembalikan pengendali.
   * opts: { sec, voice, big, onDone({correct, timedOut, leftRatio, ans}) }
   * ==============================================================*/
  function overlayQuestion(host, q, ctx, opts) {
    const o = opts || {};
    const sec = o.sec || 15;
    host.hidden = false;
    host.innerHTML = `<div class="ar-oq ${o.big ? 'is-big' : ''}">
        <div class="ar-oq-top"><span class="ar-oq-t">${ic('clock', 14)} <b>${sec}</b> dtk</span><span class="ar-oq-bar"><i></i></span></div>
        <div class="gb-qtext">${rt(q.text)}</div><div class="gb-ans"></div><div class="gb-fb" aria-live="polite"></div></div>`;
    const ansEl = host.querySelector('.gb-ans'), fb = host.querySelector('.gb-fb');
    const bar = host.querySelector('.ar-oq-bar i'), tl = host.querySelector('.ar-oq-t b');
    const t0 = performance.now();
    let done = false, voice = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      clearInterval(iv);
      if (voice) voice.stop();
      ui.reveal(res.correct);
      fb.innerHTML = res.correct ? '<div class="gb-good">Benar!</div>' : `<div class="gb-badfb">${res.timedOut ? 'Waktu habis.' : 'Belum tepat.'} <span>Kunci: ${esc(Games.keyText(q))}</span></div>`;
      if (ctx && ctx.seen) ctx.seen(q, res.correct);   // riwayat jawaban mentee (Game Battle)
      if (o.onDone) o.onDone(res);
    };
    const ui = Games.AnswerUI.render(q, ansEl, (ans) => {
      const g = Exam.gradeQuestion(q, ans);
      finish({ correct: !!g.correct, timedOut: false, leftRatio: Math.max(0, 1 - (performance.now() - t0) / (sec * 1000)), ans });
    }, { rng: ctx ? ctx.rng : Math.random });
    if (o.voice !== false && global.VoiceAnswer) voice = VoiceAnswer.attach(ansEl, q, { auto: !!o.autoVoice });
    const iv = setInterval(() => {
      const left = Math.max(0, sec * 1000 - (performance.now() - t0));
      bar.style.width = (left / (sec * 1000) * 100) + '%';
      tl.textContent = Math.ceil(left / 1000);
      if (left <= 0) finish({ correct: false, timedOut: true, leftRatio: 0, ans: null });
    }, 100);
    if (ctx) ctx.onDispose(() => { clearInterval(iv); if (voice) voice.stop(); });
    return {
      get done() { return done; },
      /** Pilih opsi ke-i (keyboard huruf A–E). */
      pick(i) { const b = ansEl.querySelector(`[data-opt="${i}"]`); if (b && !b.disabled) b.click(); },
      close() { clearInterval(iv); if (voice) voice.stop(); done = true; host.hidden = true; host.innerHTML = ''; }
    };
  }

  /* ================================================================
   * 13 — Balapan Mobil (kamu vs 3 bot)
   * ==============================================================*/
  const RE = global.RaceEngine;
  const BOT_CARS = [
    { name: 'Elang', color: '#3b82f6', p: 0.6, speed: 0.985, dodge: 0.55 },
    { name: 'Kancil', color: '#f59e0b', p: 0.72, speed: 1.0, dodge: 0.7 },
    { name: 'Rajawali', color: '#10b981', p: 0.82, speed: 1.01, dodge: 0.85 }
  ];
  const POS_POINTS = [500, 320, 200, 120];
  function trackPickerHtml(sel) {
    return `<div class="ar-tracks">${RE.TRACKS.map(t => `
      <button type="button" class="ar-track ${t.id === sel ? 'is-on' : ''}" data-track="${t.id}" aria-pressed="${t.id === sel}">
        <svg viewBox="0 0 400 260" aria-hidden="true"><rect width="400" height="260" rx="22" fill="${t.c.ground}"/>
          <path d="${t.path}" fill="none" stroke="${t.c.edge}" stroke-width="26"/><path d="${t.path}" fill="none" stroke="${t.c.road}" stroke-width="18"/></svg>
        <span>${esc(t.name)}</span></button>`).join('')}</div>`;
  }

  const balap = {
    id: 'balap', name: 'Balapan Mobil', icon: '🏎️', art: Art.cardArt('balap'), color: '#e11d48', tag: '8 sirkuit',
    desc: 'Mobil melaju sendiri — pindah lajur untuk menghindari rintangan. Tiap lewat gerbang "?", jawab soal: benar = Turbo, Perisai, atau Genangan Oli untuk lawan; salah = tergelincir. Bisa dijawab dengan suara (sebut hurufnya) — cocok dimainkan satu kelas di proyektor.',
    formats: ['Pilihan Ganda', 'Benar/Salah'], accepts: q => isPG(q) || isBS(q), min: 6, limitSec: 330,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 12),
    bot: { units: 9, sec: 14, per: 150, wrong: 0 },
    play(ctx) {
      const battle = ctx.mode === 'battle';
      let trackId = RE.TRACKS[Math.floor(ctx.rng() * RE.TRACKS.length)].id;
      let classMode = false;
      if (battle) return startRace();
      const paintSetup = () => {
        ctx.stage.innerHTML = `<div class="ar-setup"><h3 class="ar-h">${ic('flag', 20)} Pilih sirkuit</h3>${trackPickerHtml(trackId)}
          <label class="check-row ar-class"><input type="checkbox" id="arClass" ${classMode ? 'checked' : ''}/> <span><b>Mode Kelas (proyektor)</b> — soal besar & mikrofon otomatis: kelas cukup menyebut huruf atau jawabannya${global.VoiceAnswer && VoiceAnswer.supported() ? '' : ' <em class="muted">(peramban ini belum mendukung suara; gunakan Chrome/Edge)</em>'}</span></label>
          <p class="muted small">Kontrol: ← → (atau A/D, usap) pindah lajur • Spasi/↑ pakai item • saat soal muncul, tekan A–E atau klik jawaban.</p>
          <button type="button" class="btn btn-primary" id="arGo">${ic('play', 16)} Mulai Balapan</button></div>`;
        ctx.stage.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => { trackId = b.dataset.track; paintSetup(); }));
        ctx.stage.querySelector('#arClass').addEventListener('change', (e) => { classMode = e.target.checked; });
        ctx.stage.querySelector('#arGo').addEventListener('click', startRace);
      };
      paintSetup();

      function startRace() {
        const course = RE.buildCourse(trackId, 3, Math.floor(ctx.rng() * 1e9));
        const next = picker(ctx.qs);
        const me = RE.createCar({ id: 'me', name: 'Kamu', color: '#e11d48' });
        const bots = BOT_CARS.map((b, i) => RE.createCar({ id: 'bot' + i, name: b.name, color: b.color, base: RE.BASE_SPEED * b.speed, lane: i === 1 ? 0 : 2, lx: i === 1 ? 0 : 2, ai: b, dodged: new Set() }));
        me.lane = me.lx = 1;
        const cars = [me].concat(bots);
        const puddles = [];
        const tStart = performance.now();
        let oq = null, over = false, lastHud = 0, msgTimer = null;
        ctx.stage.innerHTML = `<div class="ar-race ${classMode ? 'is-class' : ''}">
            <div class="ar-race-top"><div class="ar-race-map"></div><ol class="ar-race-board" aria-label="Klasemen"></ol></div>
            <div class="ar-race-road"><div class="ar-race-hud"></div><div class="ar-race-msg" aria-live="assertive"></div><div class="ar-race-q" hidden></div></div>
            <div class="ar-race-ctrl">
              <button type="button" class="ar-ctl" data-act="left" aria-label="Pindah lajur kiri">${ic('left', 26)}</button>
              <button type="button" class="ar-ctl ar-item" data-act="item" aria-label="Pakai item" disabled>${ic('star', 22)}<span>Item kosong</span></button>
              <button type="button" class="ar-ctl" data-act="right" aria-label="Pindah lajur kanan">${ic('right', 26)}</button>
            </div></div>`;
        const $ = (s) => ctx.stage.querySelector(s);
        const map = RE.mountMap($('.ar-race-map'), course);
        const roadHost = $('.ar-race-road');
        const road = RE.mountRoad(roadHost, course);
        ctx.onDispose(() => road.destroy());
        const qHost = $('.ar-race-q'), msg = $('.ar-race-msg'), hud = $('.ar-race-hud'), board = $('.ar-race-board');
        const itemBtn = $('[data-act="item"]');
        const say = (html, cls) => {
          msg.innerHTML = `<span class="${cls || ''}">${html}</span>`;
          clearTimeout(msgTimer);
          msgTimer = setTimeout(() => { msg.innerHTML = ''; }, 1800);
        };
        const rankOf = (car) => RE.standings(cars).indexOf(car);
        const paintItem = () => {
          const it = me.item ? RE.ITEMS[me.item] : null;
          itemBtn.disabled = !it;
          itemBtn.innerHTML = it ? `${ic(it.icon, 22)}<span>${esc(it.name)}</span>` : `${ic('star', 22)}<span>Item kosong</span>`;
          itemBtn.classList.toggle('is-ready', !!it);
        };
        const lane = (dir) => { if (over || me.cruise) return; me.lane = clamp(me.lane + dir, 0, 2); };
        const throwOil = (from, t) => {
          const order = RE.standings(cars).filter(c => !c.fin);
          const i = order.indexOf(from);
          const target = i > 0 ? order[i - 1] : order[i + 1];
          if (!target) return null;
          puddles.push({ d: target.d + 48, lane: target.lane, to: target.id, from: from.id, at: t });
          return target;
        };
        const use = () => {
          if (over || !me.item) return;
          const t = performance.now();
          const it = RE.useItem(me, t);
          if (it === 'oil') { const tg = throwOil(me, t); say(tg ? `${ic('oil', 16)} Oli dilempar ke ${esc(tg.name)}!` : 'Tidak ada lawan di dekatmu.'); }
          else if (it === 'turbo') { say(`${ic('turbo', 16)} TURBO!`, 'is-turbo'); beep('go'); }
          else if (it === 'shield') say(`${ic('shield', 16)} Perisai aktif 12 detik`);
          ctx.add(20);
          paintItem();
        };
        itemBtn.addEventListener('click', use);
        $('[data-act="left"]').addEventListener('click', () => lane(-1));
        $('[data-act="right"]').addEventListener('click', () => lane(1));
        swipe(ctx, roadHost, Object.assign((d) => { if (d === 'left') lane(-1); else if (d === 'right') lane(1); else if (d === 'up') use(); }, {}));
        const letter = (i) => () => { if (oq && !oq.done) oq.pick(i); else if (i === 0) lane(-1); else if (i === 3) lane(1); };
        keys(ctx, {
          ArrowLeft: () => lane(-1), ArrowRight: () => lane(1), ' ': use, ArrowUp: use, w: use,
          a: letter(0), b: letter(1), c: letter(2), d: letter(3), e: letter(4)
        });

        const gate = (i) => {
          const q = next();
          me.cruise = true;
          oq = overlayQuestion(qHost, q, ctx, {
            sec: classMode ? 20 : 15, big: classMode, autoVoice: classMode,
            onDone: (r) => {
              ctx.mark(r.correct);
              const t = performance.now();
              if (r.correct) {
                const gain = 80 + Math.round(r.leftRatio * 40);
                ctx.add(gain);
                if (me.item) { ctx.add(30); say(`Benar! Slot item penuh: +30 poin ${gainHtml(gain)}`); }
                else { me.item = RE.rollItem(rankOf(me), cars.length, ctx.rng); say(`Benar! Dapat <b>${esc(RE.ITEMS[me.item].name)}</b> ${ic(RE.ITEMS[me.item].icon, 16)} ${gainHtml(gain)}`, 'is-good'); }
                paintItem();
              } else if (!r.timedOut) {
                RE.hit(me, 'skid', t) === 'blocked' ? say(`${ic('shield', 16)} Perisai menahan tergelincir`) : say('Salah — mobil tergelincir!', 'is-bad');
              } else say('Waktu habis — tanpa item.');
              ctx.after(r.correct ? 900 : 1600, () => { if (oq) oq.close(); oq = null; me.cruise = false; });
            }
          });
          beep('pop');
          void i;
        };
        const botGate = (b) => {
          b.cruise = true;
          ctx.after(1800 + Math.random() * 3800, () => {
            b.cruise = false;
            const t = performance.now();
            if (Math.random() < b.ai.p) { if (!b.item) b.item = RE.rollItem(rankOf(b), cars.length); b.itemAt = t; }
            else RE.hit(b, 'skid', t);
          });
        };
        const botThink = (b, t) => {
          // Item: turbo & perisai langsung, oli bila ada lawan dekat di depan (atau setelah 6 detik).
          if (b.item) {
            if (b.item === 'oil') {
              const ahead = cars.some(c => c !== b && !c.fin && c.d > b.d && c.d - b.d < 260);
              if (ahead || t - b.itemAt > 6000) { RE.useItem(b, t); const tg = throwOil(b, t); if (tg === me) say(`${ic('oil', 16)} Awas! Oli dari ${esc(b.name)} — pindah lajur!`, 'is-bad'); }
            } else RE.useItem(b, t);
          }
          // Hindari rintangan & oli di lajurnya.
          const danger = course.obstacles.concat(puddles.filter(p => !p.used && (!p.to || p.to === b.id)))
            .find(o => o.d > b.d + 20 && o.d < b.d + 75 && o.lane === b.lane);
          if (danger && !b.dodged.has(danger)) {
            b.dodged.add(danger);
            if (Math.random() < b.ai.dodge) {
              const opts = [0, 1, 2].filter(l => l !== b.lane && Math.abs(l - b.lane) === 1 && !course.obstacles.some(o => o.lane === l && Math.abs(o.d - danger.d) < 30));
              if (opts.length) b.lane = opts[Math.floor(Math.random() * opts.length)];
            }
          }
        };
        const finishRace = (t) => {
          if (over) return;
          over = true;
          if (oq) { oq.close(); oq = null; }
          // Mobil bot yang belum finis: perkirakan waktu finisnya dari sisa jarak.
          cars.forEach(c => { if (!c.fin) c.fin = t + Math.max(0, course.total - c.d) / (c.base * 0.95) * 1000; });
          const order = RE.standings(cars);
          const pos = order.indexOf(me);
          const pts = POS_POINTS[pos] || 0;
          ctx.add(pts);
          beep(pos === 0 ? 'win' : 'ok');
          qHost.hidden = false;
          qHost.innerHTML = `<div class="ar-oq ar-podium"><h3>${pos === 0 ? ic('trophy', 26) + ' Juara 1!' : `Finis posisi ${pos + 1}`}</h3>
            <ol>${order.map((c, i) => `<li class="${c === me ? 'is-me' : ''}"><span style="background:${c.color}"></span>${esc(c.name)}<b>${i === 0 ? ic('crown', 14) : ''}${((c.fin - tStart) / 1000).toFixed(1)} dtk</b></li>`).join('')}</ol>
            <p>${gainHtml(pts)} poin posisi</p></div>`;
          ctx.after(3000, () => ctx.finish());
        };
        paintItem();
        loop(ctx, (dt, t) => {
          if (over) return;
          if (t - tStart > 300000) return finishRace(t);
          cars.forEach(c => {
            const ev = RE.step(c, dt, t, course, puddles);
            ev.forEach(e => {
              if (e.type === 'gate') { if (c === me) gate(e.i); else botGate(c); }
              else if (e.type === 'obstacle' && !c.cruise) { const r = RE.hit(c, 'obstacle', t); if (c === me) { r === 'blocked' ? say(`${ic('shield', 16)} Perisai menahan tabrakan`) : say('Tabrakan! Hindari rintangan dengan pindah lajur.', 'is-bad'); if (r !== 'blocked') beep('bad'); } }
              else if (e.type === 'pad' && !c.cruise) { c.fx.turbo = Math.max(c.fx.turbo, t + RE.FX.pad); if (c === me) say(`${ic('turbo', 16)} Papan turbo!`, 'is-turbo'); }
              else if (e.type === 'oil') { e.p.used = true; const r = RE.hit(c, 'oil', t); if (c === me) { r === 'blocked' ? say(`${ic('shield', 16)} Perisai menahan oli`) : say('Terpeleset oli!', 'is-bad'); } }
              else if (e.type === 'finish' && c === me) finishRace(t);
            });
            if (c !== me && !c.fin) botThink(c, t);
          });
          road.draw({ me, others: bots, puddles, t });
          if (t - lastHud > 150) {
            lastHud = t;
            const order = RE.standings(cars);
            hud.innerHTML = `<span>${ic('flag', 14)} Putaran <b>${RE.lapOf(me, course)}/${course.laps}</b></span><span>Posisi <b>${order.indexOf(me) + 1}/${cars.length}</b></span><span>${Math.round(me.v * 3.2)} km/j</span>`;
            board.innerHTML = order.map((c, i) => `<li class="${c === me ? 'is-me' : ''}"><span style="background:${c.color}"></span>${i + 1}. ${esc(c.name)}</li>`).join('');
            map.update(cars.map(c => ({ id: c.id, d: c.d, color: c.color, me: c === me })));
            ctx.info(`${course.track.name} • putaran ${RE.lapOf(me, course)}/${course.laps}`);
          }
        });
      }
    }
  };

  /* ================================================================
   * 14 — Lari-Lompat (lintasan atletik 3 lajur)
   * ==============================================================*/
  const lari = {
    id: 'lari', name: 'Lari-Lompat', icon: '🏃', art: Art.cardArt('lari'), color: '#f97316', tag: 'Lari & lompat',
    desc: 'Berlari di lintasan atletik: lompati gawang dan ambil koin. Saat soal muncul, baca lalu masuk ke gerbang berisi jawaban yang benar. Salah gerbang atau menabrak gawang = −1 nyawa (3 nyawa).',
    formats: ['Pilihan Ganda (pilihan ≤ 40 huruf)', 'Benar/Salah'], accepts: q => (isPG(q) && optCount(q) >= 2 && shortOpts(q, 40)) || isBS(q),
    min: 6, limitSec: 10 * 18 + 60,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 10),
    bot: { units: 10, sec: 9, per: 125, wrong: 0, lives: 3 },
    play(ctx) {
      const TOTAL_Q = Math.min(10, ctx.qs.length);
      let lives = 3, qi = 0, s = 0, v = 62, laneT = 1, lx = 1, jumpT = -1, stumble = 0, over = false, phase = 'run';
      let ents = [], nextSpawn = 40;
      ctx.stage.innerHTML = `<div class="ar-run">
          <div class="ar-run-banner" aria-live="polite"></div>
          <div class="ar-run-field"><div class="ar-run-hud"></div></div>
          <div class="ar-race-ctrl">
            <button type="button" class="ar-ctl" data-act="left" aria-label="Pindah lajur kiri">${ic('left', 26)}</button>
            <button type="button" class="ar-ctl ar-item is-ready" data-act="jump" aria-label="Lompat">${ic('jump', 22)}<span>Lompat</span></button>
            <button type="button" class="ar-ctl" data-act="right" aria-label="Pindah lajur kanan">${ic('right', 26)}</button>
          </div></div>`;
      const $ = (q) => ctx.stage.querySelector(q);
      const field = $('.ar-run-field'), bannerEl = $('.ar-run-banner'), hud = $('.ar-run-hud');
      const cv = document.createElement('canvas');
      cv.className = 're-road';
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Lintasan lari. Tombol kiri/kanan pindah lajur, tombol lompat untuk melompati gawang.');
      field.appendChild(cv);
      const g = cv.getContext('2d');
      let W = 320, H = 360;
      const resize = () => {
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        W = Math.max(260, field.clientWidth || 320);
        H = Math.round(Math.min(Math.max(300, W * 0.95), Math.max(320, (global.innerHeight || 700) * (field.closest('.game-fs') ? 0.62 : 0.5))));
        cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      if ('ResizeObserver' in global) { const ro = new ResizeObserver(resize); ro.observe(field); ctx.onDispose(() => ro.disconnect()); }
      global.addEventListener('resize', resize); ctx.onDispose(() => global.removeEventListener('resize', resize));
      const lane = (d) => { if (!over) laneT = clamp(laneT + d, 0, 2); };
      const jump = () => { if (!over && jumpT < 0) { jumpT = 0; beep('pop'); } };
      $('[data-act="left"]').addEventListener('click', () => lane(-1));
      $('[data-act="right"]').addEventListener('click', () => lane(1));
      $('[data-act="jump"]').addEventListener('click', jump);
      swipe(ctx, field, Object.assign((d) => { if (d === 'left') lane(-1); else if (d === 'right') lane(1); else jump(); }, { tap: jump }));
      keys(ctx, { ArrowLeft: () => lane(-1), a: () => lane(-1), ArrowRight: () => lane(1), d: () => lane(1), ArrowUp: jump, w: jump, ' ': jump });

      const paintHud = () => { hud.innerHTML = `${hearts(lives, 3)}<span>Soal <b>${Math.min(qi + (phase === 'run' ? 0 : 1), TOTAL_Q)}/${TOTAL_Q}</b></span>`; ctx.info(`Nyawa ${lives} • soal ${Math.min(qi + 1, TOTAL_Q)}/${TOTAL_Q}`); };
      const loseLife = (why) => {
        lives--;
        stumble = 1;
        beep('bad');
        ctx.flash(false);
        paintHud();
        if (lives <= 0) endRun(`<b>Nyawa habis</b> — ${why}`);
      };
      const endRun = (html) => {
        if (over) return;
        over = true;
        bannerEl.innerHTML = `<div class="ar-end">${html}<p class="muted">Jarak ${fmt(s)} m • ${qi} soal</p></div>`;
        ctx.after(1600, () => ctx.finish());
      };
      const startQuestion = () => {
        if (qi >= TOTAL_Q) return endRun(`<div class="ar-end-ic">${ic('trophy', 36)}</div><b>Garis finis!</b>`);
        const q = ctx.qs[qi];
        const choices = compactChoices(q, ctx.rng, 3);
        const lanes = choices.length === 2 ? [0, 2] : [0, 1, 2];
        const len = plain(q.text, 500).length;
        const readSec = clamp(3.5 + len / 28, 4.5, 11);
        phase = 'question';
        const gateD = s + readSec * v;
        ents.push({ type: 'gate', d: gateD, choices: choices.map((c, i) => Object.assign({ lane: lanes[i] }, c)), q });
        if (choices.length === 2) ents.push({ type: 'wall', d: gateD, lane: 1 });
        bannerEl.innerHTML = `<div class="ar-run-q"><span class="gb-qnum">Soal ${qi + 1}/${TOTAL_Q}</span><div class="gb-qtext">${rt(q.text)}</div>
          <div class="ar-run-choices">${choices.map((c, i) => `<span><b>${['Kiri', 'Tengah', 'Kanan'][lanes[i]]}</b> ${esc(c.t)}</span>`).join('')}</div></div>`;
        paintHud();
      };
      const passGate = (e) => {
        const lnNow = Math.round(lx);
        const c = e.choices.find(x => x.lane === lnNow);
        qi++;
        phase = 'run';
        nextSpawn = s + 30;
        const ok = !!(c && c.ok);
        ctx.mark(ok); ctx.seen(e.q, ok);
        if (ok) {
          const gain = 100 + Math.round((v - 60) * 2);
          ctx.add(gain); ctx.flash(true);
          bannerEl.innerHTML = `<div class="ar-run-q is-ok"><div class="gb-good">Benar: ${esc(c.t)}</div>${gainHtml(gain)}</div>`;
          v = Math.min(96, v + 3);
        } else {
          bannerEl.innerHTML = `<div class="ar-run-q is-no"><div class="gb-badfb">${c ? 'Gerbang salah.' : 'Kamu menabrak tembok.'} <span>Kunci: ${esc(Games.keyText(e.q))}</span></div></div>`;
          loseLife('salah gerbang');
        }
        paintHud();
        if (!over) ctx.after(1500, () => { if (!over && phase === 'run') bannerEl.innerHTML = `<div class="ar-run-q is-run">${ic('jump', 16)} Lompati gawang & ambil koin…</div>`; });
      };
      const spawnRun = () => {
        // Gawang & koin di antara soal (tidak menutup ketiga lajur sekaligus).
        const d = s + 150 + ctx.rng() * 40;
        const ln = Math.floor(ctx.rng() * 3);
        ents.push({ type: 'hurdle', d, lane: ln });
        if (ctx.rng() < 0.5) ents.push({ type: 'hurdle', d, lane: (ln + 1 + Math.floor(ctx.rng() * 2)) % 3 });
        for (let k = 0; k < 4; k++) ents.push({ type: 'coin', d: d + 26 + k * 9, lane: (ln + 1) % 3 });
        nextSpawn = d + 55 + ctx.rng() * 30;
      };
      const QUESTION_EVERY = 4.2;    // detik lari bebas di antara soal
      let runUntil = s + QUESTION_EVERY * v;
      paintHud();
      bannerEl.innerHTML = `<div class="ar-run-q is-run">${ic('jump', 16)} Siap… lompati gawang dengan tombol Lompat / Spasi / usap ke atas.</div>`;
      loop(ctx, (dt, now) => {
        if (over) { draw(now); return; }
        const speed = v * (stumble > 0 ? 0.45 : 1);
        stumble = Math.max(0, stumble - dt);
        const prev = s;
        s += speed * dt;
        lx += (laneT - lx) * Math.min(1, dt * 12);
        if (jumpT >= 0) { jumpT += dt; if (jumpT > 0.68) jumpT = -1; }
        const air = jumpT >= 0 ? Math.sin(jumpT / 0.68 * Math.PI) : 0;
        if (phase === 'run') {
          if (s >= nextSpawn - 150 && s < runUntil - 120) spawnRun();
          if (s >= runUntil) { startQuestion(); runUntil = Infinity; }
        }
        ents.forEach(e => {
          if (e.done || !(prev < e.d && s >= e.d)) return;
          const here = Math.abs(lx - e.lane) < 0.5;
          if (e.type === 'hurdle' && here) { e.done = true; if (air < 0.35) loseLife('menabrak gawang'); else ctx.add(15); }
          else if (e.type === 'coin' && here) { e.done = true; ctx.add(10); beep('pop'); }
          else if (e.type === 'gate') { e.done = true; passGate(e); if (!over) runUntil = s + QUESTION_EVERY * v; }
        });
        ents = ents.filter(e => e.d > s - 40);
        draw(now, air);
      });

      function draw(now, air) {
        const ppu = H / 140, runY = H * 0.8, trackW = Math.min(W * 0.8, 360), laneW = trackW / 3, cx = W / 2;
        const yOf = (d) => runY - (d - s) * ppu;
        const xOf = (l) => cx + (l - 1) * laneW;
        g.fillStyle = '#4ade80'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#22c55e';
        for (let k = 0; k < 14; k++) { const yy = ((k * 40 + s * ppu) % (H + 40)) - 40; g.fillRect(0, yy, W, 18); }
        g.fillStyle = '#c2410c'; g.fillRect(cx - trackW / 2, 0, trackW, H);
        g.fillStyle = '#f8fafc';
        g.fillRect(cx - trackW / 2, 0, 3, H); g.fillRect(cx + trackW / 2 - 3, 0, 3, H);
        g.fillRect(cx - laneW / 2 - 1, 0, 2, H); g.fillRect(cx + laneW / 2 - 1, 0, 2, H);
        ents.forEach(e => {
          const y = yOf(e.d);
          if (y < -80 || y > H + 40) return;
          if (e.type === 'coin' && !e.done) { g.fillStyle = '#facc15'; g.beginPath(); g.arc(xOf(e.lane), y, 7, 0, 6.283); g.fill(); g.strokeStyle = '#a16207'; g.lineWidth = 2; g.stroke(); }
          if (e.type === 'hurdle') {
            const x = xOf(e.lane);
            g.fillStyle = '#1f2937'; g.fillRect(x - laneW * 0.38, y - 2, 4, 10); g.fillRect(x + laneW * 0.38 - 4, y - 2, 4, 10);
            for (let k = 0; k < 4; k++) { g.fillStyle = k % 2 ? '#111827' : '#f9fafb'; g.fillRect(x - laneW * 0.38 + k * laneW * 0.19, y - 6, laneW * 0.19, 6); }
          }
          if (e.type === 'wall') { const x = xOf(e.lane); g.fillStyle = '#7c2d12'; g.fillRect(x - laneW / 2 + 4, y - 16, laneW - 8, 18); g.fillStyle = '#9a3412'; for (let k = 0; k < 3; k++) g.fillRect(x - laneW / 2 + 8 + k * (laneW - 16) / 3, y - 13, (laneW - 24) / 3, 5); }
          if (e.type === 'gate') {
            e.choices.forEach(c => {
              const x = xOf(c.lane);
              g.fillStyle = '#334155'; g.fillRect(x - laneW / 2 + 4, y - 40, 5, 44); g.fillRect(x + laneW / 2 - 9, y - 40, 5, 44);
              g.fillStyle = e.done ? (c.ok ? '#16a34a' : '#dc2626') : '#1d4ed8';
              Art.roundRect(g, x - laneW / 2 + 2, y - 70, laneW - 4, 36, 8); g.fill();
              g.fillStyle = '#fff'; g.font = `800 ${laneW < 90 ? 10 : 12}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
              const lines = wrapText(g, c.t, laneW - 14, 2);
              lines.forEach((ln, k) => g.fillText(ln, x, y - 52 + (k - (lines.length - 1) / 2) * 13));
            });
          }
        });
        // Pelari (tampak atas): bayangan, kaki & lengan berayun, kepala.
        const x = xOf(lx), a = air || 0, sc = 1 + a * 0.35, ph = Math.sin(now / 90);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, runY + 14, 14 - a * 4, 6 - a * 2, 0, 0, 6.283); g.fill();
        g.save(); g.translate(x, runY - a * 26); g.scale(sc, sc);
        g.strokeStyle = '#1e3a8a'; g.lineWidth = 5; g.lineCap = 'round';
        const sw = reducedMotion() ? 0.3 : ph;
        g.beginPath(); g.moveTo(-5, 4); g.lineTo(-6, 4 + 12 * sw); g.moveTo(5, 4); g.lineTo(6, 4 - 12 * sw); g.stroke();
        g.strokeStyle = '#f2c9a0'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(-9, -6); g.lineTo(-12, -6 - 9 * sw); g.moveTo(9, -6); g.lineTo(12, -6 + 9 * sw); g.stroke();
        g.fillStyle = '#2563eb'; Art.roundRect(g, -10, -12, 20, 18, 7); g.fill();
        g.fillStyle = '#f2c9a0'; g.beginPath(); g.arc(0, -16, 7, 0, 6.283); g.fill();
        g.fillStyle = '#1f2937'; g.beginPath(); g.arc(0, -18, 6, Math.PI, 0); g.fill();
        g.restore();
        g.lineCap = 'butt';
      }
    }
  };

  /* ================================================================
   * 15 — Tarik Tambang
   * ==============================================================*/
  function tugTeam(color, flip) {
    return Array.from({ length: 4 }, (_, i) => {
      const x = flip ? 262 + i * 26 : 30 + i * 26;
      return `<g class="ar-tug-man" transform="translate(${x},70)${flip ? ' scale(-1,1)' : ''}">
        <circle cx="0" cy="-26" r="7" fill="#f2c9a0"/><path d="M0 -19 L-4 4 M-4 4 L-12 22 M-4 4 L4 22 M-2 -12 L14 -2" stroke="${color}" stroke-width="6" stroke-linecap="round" fill="none"/></g>`;
    }).join('');
  }
  const tambang = {
    id: 'tambang', name: 'Tarik Tambang', icon: '🪢', art: Art.cardArt('tambang'), color: '#b45309', tag: 'Adu cepat 75 dtk',
    desc: 'Timmu melawan tim lawan. Setiap jawaban benar menarik tali ke arahmu — makin cepat makin kuat, beruntun ada bonus. Tim lawan terus menarik! Tarik bendera melewati garismu sebelum 75 detik habis.',
    formats: ['Pilihan Ganda', 'Benar/Salah', 'Pilihan Lebih dari Satu'], accepts: q => isPG(q) || isBS(q) || fmtOf(q) === 'Pilihan Lebih dari Satu',
    min: 8, limitSec: 75 + 25,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 30),
    bot: { units: 14, sec: 5, per: 105, wrong: 0, timeSec: 75 },
    play(ctx) {
      const next = picker(ctx.qs);
      let pos = 0, streak = 0, over = false, n = 0, oppPower = 1;
      ctx.stage.innerHTML = `<div class="ar-tug">
          <svg class="ar-tug-scene" viewBox="0 0 400 130" role="img" aria-label="Arena tarik tambang">
            <rect width="400" height="130" rx="14" fill="#bbf7d0"/><rect y="92" width="400" height="38" fill="#86efac"/>
            <ellipse cx="200" cy="104" rx="46" ry="12" fill="#92400e" opacity=".75"/>
            <path d="M80 18 V120" stroke="#2563eb" stroke-width="3" stroke-dasharray="6 5"/><path d="M320 18 V120" stroke="#dc2626" stroke-width="3" stroke-dasharray="6 5"/>
            <text x="80" y="14" text-anchor="middle" class="ar-tug-l">Garis timmu</text><text x="320" y="14" text-anchor="middle" class="ar-tug-l">Garis lawan</text>
            <g class="ar-tug-move">
              <path d="M20 62 Q200 ${66} 380 62" stroke="#a16207" stroke-width="5" fill="none" class="ar-rope"/>
              <g transform="translate(200,62)"><path d="M0 0 V-22 l14 6 -14 6" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.5"/></g>
              <g class="ar-team is-me">${tugTeam('#2563eb', false)}</g><g class="ar-team is-op">${tugTeam('#dc2626', true)}</g>
            </g>
          </svg>
          <div class="ar-tug-meter" aria-hidden="true"><i></i></div>
          <div class="ar-tug-panel"></div></div>`;
      const $ = (s) => ctx.stage.querySelector(s);
      const mover = $('.ar-tug-move'), meter = $('.ar-tug-meter i'), panel = $('.ar-tug-panel');
      const paint = (who) => {
        mover.style.transform = `translateX(${(-pos * 1.2).toFixed(1)}px)`;
        meter.style.left = (50 - pos / 2) + '%';
        if (who && !reducedMotion()) {
          const team = $('.ar-team.' + (who === 'me' ? 'is-me' : 'is-op'));
          team.classList.remove('is-pull'); void team.getBoundingClientRect(); team.classList.add('is-pull');
          setTimeout(() => team.classList.remove('is-pull'), 380);
        }
        ctx.info(pos > 0 ? `Unggul ${Math.round(pos)}` : pos < 0 ? `Tertinggal ${Math.round(-pos)}` : 'Seimbang');
      };
      const end = (result) => {
        if (over) return;
        over = true;
        t.stop();
        const bonus = result === 'win' ? 500 + Math.round(t.left() * 5) : result === 'draw' ? 100 : 0;
        if (bonus) ctx.add(bonus);
        if (result === 'win') beep('win');
        panel.innerHTML = `<div class="ar-end"><h3>${result === 'win' ? `${ic('trophy', 26)} Timmu menang!` : result === 'draw' ? 'Seimbang!' : 'Tim lawan menang'}</h3>${bonus ? gainHtml(bonus) : ''}<p class="muted">${n} soal dijawab.</p></div>`;
        ctx.after(1500, () => ctx.finish());
      };
      const t = ctx.timer(75, () => end(pos > 3 ? 'win' : pos < -3 ? 'lose' : 'draw'));
      // Tim lawan menarik terus-menerus, makin kuat seiring waktu.
      const oppPull = () => {
        if (over) return;
        oppPower = 1 + (75 - t.left()) / 110;
        pos -= (6 + ctx.rng() * 5) * oppPower;
        paint('op');
        if (pos <= -100) return end('lose');
        ctx.after(2200 + ctx.rng() * 1400, oppPull);
      };
      ctx.after(2500, oppPull);
      const ask = () => {
        if (over) return;
        const q = next();
        n++;
        panel.innerHTML = `<div class="gb-qtext">${rt(q.text)}</div><div class="gb-ans"></div><div class="gb-fb" aria-live="polite"></div>`;
        const t0 = performance.now();
        const ui = Games.AnswerUI.render(q, panel.querySelector('.gb-ans'), (ans) => {
          if (over) return;
          const ok = !!Exam.gradeQuestion(q, ans).correct;
          ui.reveal(ok);
          ctx.mark(ok); ctx.seen(q, ok); ctx.flash(ok);
          const fb = panel.querySelector('.gb-fb');
          if (ok) {
            streak++;
            const fast = clamp(1 - (performance.now() - t0) / 8000, 0, 1);
            const pull = 14 + fast * 10 + Math.min(8, (streak - 1) * 2);
            pos += pull;
            const gain = 100 + Math.round(fast * 60) + Math.min(60, (streak - 1) * 15);
            ctx.add(gain);
            fb.innerHTML = `<div class="gb-good">Tarik! +${Math.round(pull)}</div>${gainHtml(gain)}${streak >= 3 ? `<span class="ar-tag">${ic('bolt', 14)} Beruntun ${streak}</span>` : ''}`;
            paint('me');
            if (pos >= 100) return end('win');
          } else {
            streak = 0; pos -= 6;
            fb.innerHTML = `<div class="gb-badfb">Tali tergelincir −6 <span>Kunci: ${esc(Games.keyText(q))}</span></div>`;
            paint('op');
            if (pos <= -100) return end('lose');
          }
          ctx.after(ok ? 650 : 1500, ask);
        }, { rng: ctx.rng });
        if (global.VoiceAnswer) VoiceAnswer.attach(panel.querySelector('.gb-ans'), q, {});
      };
      paint();
      ask();
    }
  };

  /* ================================================================
   * 16 — Tangkap Jawaban
   * ==============================================================*/
  const FRUIT = ['#ef4444', '#f59e0b', '#22c55e', '#a855f7'];
  const tangkap = {
    id: 'tangkap', name: 'Tangkap Jawaban', icon: '🧺', art: Art.cardArt('tangkap'), color: '#16a34a', tag: 'Keranjang',
    desc: 'Pilihan jawaban berjatuhan dari pohon. Geser keranjang (← →, seret, atau tombol) dan tangkap jawaban yang benar. Menangkap yang salah atau membiarkan yang benar jatuh = −1 nyawa.',
    formats: ['Pilihan Ganda (pilihan ≤ 40 huruf)', 'Benar/Salah'], accepts: q => (isPG(q) && optCount(q) >= 2 && shortOpts(q, 40)) || isBS(q),
    min: 6, limitSec: 10 * 16 + 40,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 10),
    bot: { units: 10, sec: 8, per: 110, wrong: 0, lives: 3 },
    play(ctx) {
      const TOTAL = Math.min(10, ctx.qs.length);
      let lives = 3, qi = -1, items = [], bx = 0.5, hold = 0, over = false, resolved = true, cur = null, flashUntil = 0, t0 = 0;
      ctx.stage.innerHTML = `<div class="ar-catch">
          <div class="ar-run-banner" aria-live="polite"></div>
          <div class="ar-run-field"><div class="ar-run-hud"></div></div>
          <div class="ar-race-ctrl">
            <button type="button" class="ar-ctl" data-act="left" aria-label="Geser kiri">${ic('left', 26)}</button>
            <span class="ar-ctl-note">${ic('basket', 18)} seret keranjang</span>
            <button type="button" class="ar-ctl" data-act="right" aria-label="Geser kanan">${ic('right', 26)}</button>
          </div></div>`;
      const $ = (s) => ctx.stage.querySelector(s);
      const field = $('.ar-run-field'), bannerEl = $('.ar-run-banner'), hud = $('.ar-run-hud');
      const cv = document.createElement('canvas');
      cv.className = 're-road';
      cv.setAttribute('role', 'img');
      cv.setAttribute('aria-label', 'Kebun dengan jawaban berjatuhan dan keranjang.');
      field.appendChild(cv);
      const g = cv.getContext('2d');
      let W = 320, H = 360;
      const resize = () => {
        const dpr = Math.min(2, global.devicePixelRatio || 1);
        W = Math.max(260, field.clientWidth || 320);
        H = Math.round(Math.min(Math.max(300, W * 0.85), Math.max(320, (global.innerHeight || 700) * (field.closest('.game-fs') ? 0.62 : 0.5))));
        cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      if ('ResizeObserver' in global) { const ro = new ResizeObserver(resize); ro.observe(field); ctx.onDispose(() => ro.disconnect()); }
      global.addEventListener('resize', resize); ctx.onDispose(() => global.removeEventListener('resize', resize));
      const holdBtn = (el, dir) => {
        const on = (e) => { e.preventDefault(); hold = dir; };
        const off = () => { if (hold === dir) hold = 0; };
        el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointerleave', off); el.addEventListener('pointercancel', off);
      };
      holdBtn($('[data-act="left"]'), -1); holdBtn($('[data-act="right"]'), 1);
      let dragging = false;
      const toX = (e) => { const r = cv.getBoundingClientRect(); bx = clamp((e.clientX - r.left) / r.width, 0.08, 0.92); };
      cv.addEventListener('pointerdown', (e) => { dragging = true; toX(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* noop */ } });
      cv.addEventListener('pointermove', (e) => { if (dragging) toX(e); });
      cv.addEventListener('pointerup', () => { dragging = false; });
      const kd = (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') hold = -1; if (e.key === 'ArrowRight' || e.key === 'd') hold = 1; };
      const ku = (e) => { if ((e.key === 'ArrowLeft' || e.key === 'a') && hold === -1) hold = 0; if ((e.key === 'ArrowRight' || e.key === 'd') && hold === 1) hold = 0; };
      document.addEventListener('keydown', kd); document.addEventListener('keyup', ku);
      ctx.onDispose(() => { document.removeEventListener('keydown', kd); document.removeEventListener('keyup', ku); });

      const paintHud = () => { hud.innerHTML = `${hearts(lives, 3)}<span>Soal <b>${Math.max(1, qi + 1)}/${TOTAL}</b></span>`; ctx.info(`Nyawa ${lives} • soal ${Math.max(1, qi + 1)}/${TOTAL}`); };
      const nextQ = () => {
        if (over) return;
        qi++;
        if (qi >= TOTAL || lives <= 0) return endGame();
        cur = ctx.qs[qi];
        const ch = compactChoices(cur, ctx.rng, 4);
        const cols = shuffle([0, 1, 2, 3], ctx.rng).slice(0, ch.length);
        const len = plain(cur.text, 500).length;
        const speed = (H / clamp(6 + len / 45 - qi * 0.25, 4.2, 10)) ;
        items = ch.map((c, i) => ({ t: c.t, ok: c.ok, col: cols[i], y: -30 - i * 55 - ctx.rng() * 30, vy: speed * (0.9 + ctx.rng() * 0.2), c: FRUIT[i % 4], state: 'fall' }));
        resolved = false; t0 = performance.now();
        bannerEl.innerHTML = `<div class="ar-run-q"><span class="gb-qnum">Soal ${qi + 1}/${TOTAL}</span><div class="gb-qtext">${rt(cur.text)}</div></div>`;
        paintHud();
      };
      const resolve = (ok, why) => {
        if (resolved) return;
        resolved = true;
        ctx.mark(ok); ctx.seen(cur, ok); ctx.flash(ok);
        if (ok) {
          const gain = 100 + Math.round(clamp(1 - (performance.now() - t0) / 9000, 0, 1) * 60);
          ctx.add(gain);
          bannerEl.innerHTML = `<div class="ar-run-q is-ok"><div class="gb-good">Tertangkap!</div>${gainHtml(gain)}</div>`;
        } else {
          lives--;
          flashUntil = performance.now() + 900;
          bannerEl.innerHTML = `<div class="ar-run-q is-no"><div class="gb-badfb">${why} <span>Kunci: ${esc(Games.keyText(cur))}</span></div></div>`;
        }
        paintHud();
        items.forEach(it => { if (it.state === 'fall') it.state = it.ok ? 'show' : 'fade'; });
        ctx.after(ok ? 900 : 1700, () => (lives <= 0 ? endGame() : nextQ()));
      };
      const endGame = () => {
        if (over) return;
        over = true;
        bannerEl.innerHTML = `<div class="ar-end">${lives > 0 ? `${ic('basket', 32)}<h3>Keranjang penuh!</h3>` : '<h3>Nyawa habis</h3>'}<p class="muted">${qi} soal dimainkan.</p></div>`;
        ctx.after(1500, () => ctx.finish());
      };
      paintHud();
      nextQ();
      loop(ctx, (dt, now) => {
        bx = clamp(bx + hold * dt * 0.9, 0.08, 0.92);
        const basketY = H - 34, bw = Math.min(110, W * 0.26), cols = 4;
        items.forEach(it => {
          if (it.state === 'fall' && !over) {
            it.y += it.vy * dt;
            const x = (it.col + 0.5) / cols * W;
            if (it.y >= basketY - 12 && it.y <= basketY + 10 && Math.abs(x - bx * W) < bw / 2 + 4) {
              it.state = it.ok ? 'got' : 'bad';
              resolve(it.ok, 'Itu jawaban yang salah.');
            } else if (it.y > H + 20) {
              it.state = 'gone';
              if (it.ok) resolve(false, 'Jawaban benar terjatuh.');
            }
          } else if (it.state === 'fade' || it.state === 'show') it.y += it.vy * dt * 0.25;
        });
        // Gambar kebun
        g.fillStyle = '#bae6fd'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#15803d'; g.beginPath(); g.ellipse(W / 2, -10, W * 0.7, 60, 0, 0, Math.PI); g.fill();
        g.fillStyle = '#22c55e'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(k * W / 5, 24, 30, 0, 6.283); g.fill(); }
        g.fillStyle = '#4ade80'; g.fillRect(0, H - 18, W, 18);
        items.forEach(it => {
          if (it.state === 'gone' || it.state === 'got' || it.state === 'bad') return;
          const x = (it.col + 0.5) / cols * W;
          g.globalAlpha = it.state === 'fade' ? 0.25 : 1;
          g.fillStyle = it.c; g.beginPath(); g.arc(x, it.y, 13, 0, 6.283); g.fill();
          g.fillStyle = '#15803d'; g.beginPath(); g.ellipse(x + 5, it.y - 13, 6, 3, -0.5, 0, 6.283); g.fill();
          g.font = '800 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          const lines = wrapText(g, it.t, Math.min(130, W / cols - 8), 2);
          const lw = Math.max(...lines.map(l => g.measureText(l).width)) + 12, lh = lines.length * 14 + 6;
          g.fillStyle = it.state === 'show' && now < flashUntil + 800 ? '#16a34a' : 'rgba(15,23,42,.82)';
          Art.roundRect(g, x - lw / 2, it.y + 16, lw, lh, 7); g.fill();
          g.fillStyle = '#fff';
          lines.forEach((l, k) => g.fillText(l, x, it.y + 16 + 10 + k * 14));
          g.globalAlpha = 1;
        });
        // Keranjang
        const x = bx * W;
        g.fillStyle = now < flashUntil ? '#dc2626' : '#a16207';
        g.beginPath(); g.moveTo(x - bw / 2, basketY - 8); g.lineTo(x + bw / 2, basketY - 8); g.lineTo(x + bw / 2 - 12, basketY + 18); g.lineTo(x - bw / 2 + 12, basketY + 18); g.closePath(); g.fill();
        g.strokeStyle = '#78350f'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - bw / 2, basketY - 8); g.lineTo(x + bw / 2, basketY - 8); g.stroke();
        g.strokeStyle = 'rgba(120,53,15,.5)'; g.lineWidth = 1.5;
        for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(x - bw / 2 + k * bw / 5, basketY - 8); g.lineTo(x - bw / 2 + 12 + k * (bw - 24) / 5, basketY + 18); g.stroke(); }
      });
    }
  };

  /* ================================================================
   * 17 — Rebut Wilayah (peta heksagon 7 × 5)
   * ==============================================================*/
  const HEX_C = 7, HEX_R = 5, HEX_S = 22;
  const hexXY = (c, r) => [HEX_S * Math.sqrt(3) * (c + (r % 2 ? 0.5 : 0)) + HEX_S * 1.1, HEX_S * 1.5 * r + HEX_S * 1.15];
  const hexPts = (x, y) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${(x + (HEX_S - 1.5) * Math.cos(a)).toFixed(1)},${(y + (HEX_S - 1.5) * Math.sin(a)).toFixed(1)}`; }).join(' ');
  function hexNeighbors(c, r) {
    const d = r % 2 ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    return d.map(([dc, dr]) => [c + dc, r + dr]).filter(([x, y]) => x >= 0 && y >= 0 && x < HEX_C && y < HEX_R);
  }
  const TILE = { plain: { name: 'Padang', val: 100 }, fort: { name: 'Benteng', val: 200 }, mine: { name: 'Tambang Emas', val: 160 } };
  const wilayah = {
    id: 'wilayah', name: 'Rebut Wilayah', icon: '🏰', art: Art.cardArt('wilayah'), color: '#2563eb', tag: 'Strategi peta',
    desc: 'Kamu (biru) dan lawan (merah) berebut 35 petak. Tiap giliran pilih petak di sebelah wilayahmu lalu jawab soal: benar = petak direbut. Benteng butuh soal lebih sulit tapi bernilai 2×. Rebut juga petak lawan! Paling banyak petak setelah 12 giliran menang.',
    formats: ALL_AUTO, accepts: () => true, min: 6, limitSec: 12 * 28 + 90,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 14),
    bot: { units: 12, sec: 12, per: 125, wrong: 0 },
    play(ctx) {
      const next = picker(ctx.qs);
      const TURNS = 12;
      const tiles = [];
      for (let r = 0; r < HEX_R; r++) for (let c = 0; c < HEX_C; c++) tiles.push({ c, r, owner: null, type: 'plain', key: c + ',' + r });
      const at = (c, r) => tiles[r * HEX_C + c];
      shuffle(tiles.filter(t => !((t.c <= 1 && t.r >= 3) || (t.c >= 5 && t.r <= 1))), ctx.rng).slice(0, 10).forEach((t, i) => { t.type = i < 6 ? 'fort' : 'mine'; });
      at(0, 4).owner = 'me'; at(6, 0).owner = 'bot';
      let turn = 0, busy = false;
      const W = hexXY(HEX_C - 1, 1)[0] + HEX_S * 1.2, H = hexXY(0, HEX_R - 1)[1] + HEX_S * 1.2;
      ctx.stage.innerHTML = `<div class="ar-hex">
          <div class="ar-hex-score" aria-live="polite"></div>
          <svg class="ar-hex-map" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="group" aria-label="Peta wilayah">
            ${tiles.map(t => { const [x, y] = hexXY(t.c, t.r); return `<g class="ar-tile" data-k="${t.key}" tabindex="-1" role="button">
              <polygon points="${hexPts(x, y)}"/>
              ${t.type === 'fort' ? `<path d="M${x - 7} ${y + 6} v-9 h3 v3 h3 v-3 h2 v3 h3 v-3 h3 v9z" class="ar-tile-ic"/>` : ''}
              ${t.type === 'mine' ? `<circle cx="${x}" cy="${y}" r="5.5" class="ar-tile-gold"/>` : ''}</g>`; }).join('')}
          </svg>
          <div class="ar-hex-panel"></div></div>`;
      const $ = (s) => ctx.stage.querySelector(s);
      const panel = $('.ar-hex-panel'), score = $('.ar-hex-score');
      const count = (o) => tiles.filter(t => t.owner === o).length;
      const frontier = (o) => tiles.filter(t => t.owner !== o && hexNeighbors(t.c, t.r).some(([c, r]) => at(c, r).owner === o));
      const paint = () => {
        const can = new Set(!busy && turn < TURNS ? frontier('me').map(t => t.key) : []);
        ctx.stage.querySelectorAll('.ar-tile').forEach(el => {
          const t = tiles.find(x => x.key === el.dataset.k);
          el.setAttribute('class', `ar-tile is-${t.owner || 'none'} t-${t.type}${can.has(t.key) ? ' is-can' : ''}`);
          el.setAttribute('tabindex', can.has(t.key) ? '0' : '-1');
          el.setAttribute('aria-label', `${TILE[t.type].name}, ${t.owner === 'me' ? 'milikmu' : t.owner === 'bot' ? 'milik lawan' : 'netral'}${can.has(t.key) ? ', dapat diserang' : ''}`);
        });
        score.innerHTML = `<span class="is-me">${ic('hex', 16)} Kamu <b>${count('me')}</b></span><span>Giliran <b>${Math.min(turn + 1, TURNS)}/${TURNS}</b></span><span class="is-bot">Lawan <b>${count('bot')}</b> ${ic('hex', 16)}</span>`;
        ctx.info(`Petak ${count('me')} vs ${count('bot')}`);
      };
      const end = () => {
        const a = count('me'), b = count('bot');
        const res = a > b ? 'win' : a === b ? 'draw' : 'lose';
        const bonus = res === 'win' ? 300 : res === 'draw' ? 100 : 0;
        if (bonus) ctx.add(bonus);
        if (res === 'win') beep('win');
        panel.innerHTML = `<div class="ar-end"><h3>${res === 'win' ? `${ic('crown', 24)} Wilayahmu terluas!` : res === 'draw' ? 'Seimbang!' : 'Lawan menguasai lebih banyak petak'}</h3><p class="muted">${a} petak vs ${b} petak</p>${bonus ? gainHtml(bonus) : ''}</div>`;
        busy = true; paint();
        ctx.after(1700, () => ctx.finish());
      };
      const botTurn = () => {
        const opts = frontier('bot');
        if (!opts.length || count('bot') === 0) return myTurn();
        const scoreOf = (t) => (t.owner === 'me' ? 3 : 0) + (t.type === 'fort' ? 2 : t.type === 'mine' ? 1.5 : 0) + ctx.rng() * 2;
        const tgt = opts.sort((x, y) => scoreOf(y) - scoreOf(x))[0];
        const el = ctx.stage.querySelector(`[data-k="${tgt.key}"]`);
        el.classList.add('is-attacked');
        const ok = ctx.rng() < (tgt.type === 'fort' ? 0.5 : 0.62);
        panel.innerHTML = `<p class="ar-intent">${ic('target', 16)} Lawan menyerang <b>${TILE[tgt.type].name}</b>${tgt.owner === 'me' ? ' milikmu' : ''}…</p>`;
        ctx.after(1100, () => {
          if (ok) { const stolen = tgt.owner === 'me'; tgt.owner = 'bot'; panel.innerHTML = `<p class="ar-intent is-bad">Lawan merebut ${TILE[tgt.type].name}${stolen ? ' darimu' : ''}.</p>`; if (stolen) beep('bad'); }
          else panel.innerHTML = `<p class="ar-intent">Serangan lawan gagal.</p>`;
          paint();
          ctx.after(800, myTurn);
        });
      };
      const myTurn = () => {
        if (turn >= TURNS) return end();
        if (count('bot') === 0) return end();
        busy = false;
        const opts = frontier('me');
        if (!opts.length) { turn++; panel.innerHTML = '<p class="ar-intent">Wilayahmu terkepung — giliran dilewati.</p>'; return ctx.after(1000, botTurn); }
        panel.innerHTML = `<p class="ar-intent">${ic('pin', 16)} Pilih petak bercahaya di sebelah wilayahmu (Tab + Enter juga bisa).</p>`;
        paint();
        const first = ctx.stage.querySelector('.ar-tile.is-can');
        if (first && document.activeElement && ctx.stage.contains(document.activeElement)) try { first.focus({ preventScroll: true }); } catch (e) { /* noop */ }
      };
      const attack = (key) => {
        if (busy || turn >= TURNS) return;
        const tgt = tiles.find(t => t.key === key);
        if (!frontier('me').includes(tgt)) return;
        busy = true; turn++;
        paint();
        ctx.stage.querySelector(`[data-k="${key}"]`).classList.add('is-target');
        const q = next(tgt.type === 'fort' ? 'sulit' : null);
        askTurn(sub(ctx, panel), q, turn, TURNS, 25, (r) => {
          ctx.hideTimer();
          ctx.mark(r.correct);
          if (r.correct) {
            const stolen = tgt.owner === 'bot';
            const gain = TILE[tgt.type].val + Math.round(r.left / 25 * 50) + (stolen ? 50 : 0);
            tgt.owner = 'me';
            ctx.add(gain);
            r.fb.insertAdjacentHTML('beforeend', `${gainHtml(gain)}${stolen ? `<span class="ar-tag">${ic('target', 14)} Direbut dari lawan</span>` : ''}`);
          } else r.fb.insertAdjacentHTML('beforeend', '<span class="ar-tag">Serangan gagal</span>');
          paint();
          ctx.after(1500, botTurn);
        }, { extra: `<span class="gb-chip-s">${ic('hex', 12)} ${TILE[tgt.type].name}</span>` });
      };
      ctx.stage.querySelectorAll('.ar-tile').forEach(el => {
        el.addEventListener('click', () => attack(el.dataset.k));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); attack(el.dataset.k); } });
      });
      myTurn();
    }
  };

  /* ================================================================
   * 18 — Ludo Edukasi (kamu + 3 bot, 2 bidak per pemain)
   * ==============================================================*/
  const LOOP = (() => {
    const p = [];
    for (let c = 1; c <= 5; c++) p.push([c, 6]);
    for (let r = 5; r >= 0; r--) p.push([6, r]);
    p.push([7, 0]);
    for (let r = 0; r <= 5; r++) p.push([8, r]);
    for (let c = 9; c <= 14; c++) p.push([c, 6]);
    p.push([14, 7]);
    for (let c = 14; c >= 9; c--) p.push([c, 8]);
    for (let r = 9; r <= 14; r++) p.push([8, r]);
    p.push([7, 14]);
    for (let r = 14; r >= 9; r--) p.push([6, r]);
    for (let c = 5; c >= 0; c--) p.push([c, 8]);
    p.push([0, 7]);
    p.push([0, 6]);
    return p;                                  // 52 petak
  })();
  const LUDO = [
    { id: 'me', name: 'Kamu', color: '#3b82f6', start: 39, home: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]], base: [0, 9] },
    { id: 'r', name: 'Merah', color: '#ef4444', start: 0, home: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], base: [0, 0], p: 0.58 },
    { id: 'g', name: 'Hijau', color: '#22c55e', start: 13, home: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], base: [9, 0], p: 0.64 },
    { id: 'y', name: 'Kuning', color: '#eab308', start: 26, home: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], base: [9, 9], p: 0.7 }
  ];
  const SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]);
  const GOAL = 56;
  const loopIdx = (pl, rel) => (pl.start + rel) % 52;
  function cellOf(pl, rel) {
    if (rel <= 50) return LOOP[loopIdx(pl, rel)];
    if (rel <= 55) return pl.home[rel - 51];
    return [7, 7];
  }
  function ludoBoardSvg() {
    const C = 20, cells = [];
    LOOP.forEach(([c, r], i) => cells.push(`<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" class="ar-lc${SAFE.has(i) ? ' is-safe' : ''}"/>${SAFE.has(i) && ![0, 13, 26, 39].includes(i) ? `<path d="M${c * C + 10} ${r * C + 4} l2 4.5 4.8 .5 -3.6 3.2 1 4.8 -4.2 -2.4 -4.2 2.4 1 -4.8 -3.6 -3.2 4.8 -.5z" fill="#94a3b8"/>` : ''}`));
    LUDO.forEach(pl => {
      const [sc, sr] = LOOP[pl.start];
      cells.push(`<rect x="${sc * C}" y="${sr * C}" width="${C}" height="${C}" fill="${pl.color}" opacity=".85"/>`);
      pl.home.forEach(([c, r]) => cells.push(`<rect x="${c * C}" y="${r * C}" width="${C}" height="${C}" fill="${pl.color}" opacity=".55" stroke="#fff"/>`));
      const [bc, br] = pl.base;
      cells.push(`<rect x="${bc * C}" y="${br * C}" width="${6 * C}" height="${6 * C}" rx="10" fill="${pl.color}"/><rect x="${bc * C + 20}" y="${br * C + 20}" width="${2 * C * 2}" height="${2 * C * 2}" rx="8" fill="#fff" opacity=".9"/>
        <text x="${bc * C + 60}" y="${br * C + 66}" text-anchor="middle" class="ar-ludo-nm">${pl.name}</text>`);
    });
    cells.push(`<path d="M120 120 L150 150 L120 180Z" fill="#ef4444"/><path d="M120 120 L150 150 L180 120Z" fill="#22c55e"/><path d="M180 120 L150 150 L180 180Z" fill="#eab308"/><path d="M120 180 L150 150 L180 180Z" fill="#3b82f6"/>`);
    return `<svg class="ar-ludo-board" viewBox="0 0 300 300" role="img" aria-label="Papan Ludo"><rect width="300" height="300" rx="14" fill="#f8fafc"/>${cells.join('')}<g class="ar-pawns"></g></svg>`;
  }
  const DIE_DOTS = { 1: [[12, 12]], 2: [[7, 7], [17, 17]], 3: [[7, 7], [12, 12], [17, 17]], 4: [[7, 7], [17, 7], [7, 17], [17, 17]], 5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]], 6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]] };
  const dieSvg = (n) => `<svg viewBox="0 0 24 24" width="44" height="44" aria-label="Dadu ${n}"><rect x="1" y="1" width="22" height="22" rx="5" fill="#fff" stroke="#334155" stroke-width="1.5"/>${(DIE_DOTS[n] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.1" fill="#1f2937"/>`).join('')}</svg>`;

  const ludo = {
    id: 'ludo', name: 'Ludo Edukasi', icon: '🎲', art: Art.cardArt('ludo'), color: '#7c3aed', tag: 'Papan & dadu',
    desc: 'Kamu (biru) melawan 3 bot, masing-masing 2 bidak. Lempar dadu, lalu jawab soal: benar = bidak melangkah sesuai dadu (cepat = +1 langkah, dapat 6 = giliran lagi), salah = diam. Mendarat di bidak lawan = kirim pulang. Bawa kedua bidak ke tengah!',
    formats: ALL_AUTO, accepts: () => true, min: 6, limitSec: 12 * 35 + 120,
    pick: (pool, rng) => shuffle(pool, rng).slice(0, 16),
    bot: { units: 12, sec: 13, per: 115, wrong: 0 },
    play(ctx) {
      const next = picker(ctx.qs);
      const TURNS = 12;
      const players = LUDO.map(pl => Object.assign({}, pl, { pawns: [0, 0], caps: 0 }));
      const me = players[0];
      let myTurns = 0, over = false, keyAct = null;
      keys(ctx, { ' ': () => keyAct && keyAct('roll'), Enter: () => keyAct && keyAct('roll'), 1: () => keyAct && keyAct(0), 2: () => keyAct && keyAct(1) });
      ctx.stage.innerHTML = `<div class="ar-ludo"><div class="ar-ludo-wrap">${ludoBoardSvg()}</div>
          <div class="ar-ludo-side"><ol class="ar-ludo-rank"></ol><div class="ar-ludo-die" aria-live="polite"></div><div class="ar-ludo-panel"></div></div></div>`;
      const $ = (s) => ctx.stage.querySelector(s);
      const layer = $('.ar-pawns'), rank = $('.ar-ludo-rank'), dieEl = $('.ar-ludo-die'), panel = $('.ar-ludo-panel');
      const progress = (pl) => pl.pawns.reduce((a, b) => a + b, 0);
      const done = (pl) => pl.pawns.every(p => p >= GOAL);
      const order = () => players.slice().sort((a, b) => (b.pawns.filter(p => p >= GOAL).length - a.pawns.filter(p => p >= GOAL).length) || (progress(b) - progress(a)));
      const paint = (choose) => {
        const groups = new Map();
        players.forEach(pl => pl.pawns.forEach((rel, i) => {
          const [c, r] = cellOf(pl, rel);
          const k = c + ',' + r;
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push({ pl, i, c, r });
        }));
        let html = '';
        groups.forEach(list => list.forEach((p, j) => {
          const off = list.length > 1 ? (j - (list.length - 1) / 2) * 6 : 0;
          const can = choose && p.pl === me && choose.includes(p.i);
          html += `<g class="ar-pawn${can ? ' is-can' : ''}" ${can ? `data-pawn="${p.i}" tabindex="0" role="button" aria-label="Bidak ${p.i + 1}"` : ''} transform="translate(${p.c * 20 + 10 + off},${p.r * 20 + 10 + off * 0.5})">
            <circle r="7.5" fill="${p.pl.color}" stroke="#fff" stroke-width="2.5"/><text y="3" text-anchor="middle" class="ar-pawn-n">${p.pl === me ? p.i + 1 : ''}</text></g>`;
        }));
        layer.innerHTML = html;
        rank.innerHTML = order().map((pl, i) => `<li class="${pl === me ? 'is-me' : ''}"><span style="background:${pl.color}"></span>${i + 1}. ${pl.name}<b>${pl.pawns.filter(p => p >= GOAL).length}/2 ${ic('flag', 12)}</b></li>`).join('');
        ctx.info(`Giliranmu ${Math.max(1, Math.min(myTurns, TURNS))}/${TURNS}`);
      };
      /** Gerakkan bidak selangkah demi selangkah, lalu tangani tangkapan & finis. */
      const move = (pl, i, steps, cb) => {
        const target = Math.min(GOAL, pl.pawns[i] + steps);
        const hop = () => {
          if (pl.pawns[i] >= target) return land();
          pl.pawns[i]++;
          paint();
          if (!reducedMotion()) beep('tick');
          ctx.after(reducedMotion() ? 10 : 140, hop);
        };
        const land = () => {
          const rel = pl.pawns[i];
          const out = { caught: 0, home: rel >= GOAL, victims: [] };
          if (rel <= 50 && !SAFE.has(loopIdx(pl, rel))) {
            const li = loopIdx(pl, rel);
            players.forEach(o => { if (o === pl) return; o.pawns.forEach((orel, j) => { if (orel <= 50 && loopIdx(o, orel) === li) { o.pawns[j] = 0; out.caught++; out.victims.push(o); } }); });
          }
          pl.caps += out.caught;
          paint();
          cb(out);
        };
        hop();
      };
      const finishGame = () => {
        if (over) return;
        over = true;
        keyAct = null;
        const ord = order();
        const pos = ord.indexOf(me);
        const bonus = [400, 220, 120, 40][pos];
        ctx.add(bonus);
        if (pos === 0) beep('win');
        panel.innerHTML = `<div class="ar-end"><h3>${pos === 0 ? `${ic('trophy', 24)} Juara Ludo!` : `Peringkat ${pos + 1}`}</h3>${gainHtml(bonus)}<p class="muted">${me.pawns.filter(p => p >= GOAL).length}/2 bidak sampai • ${me.caps} tangkapan</p></div>`;
        ctx.after(1700, () => ctx.finish());
      };
      const roll = () => 1 + Math.floor(ctx.rng() * 6);
      const showDie = (pl, n) => { dieEl.innerHTML = `<span class="ar-die ${reducedMotion() ? '' : 'is-roll'}" style="--pc:${pl.color}">${dieSvg(n)}</span><span>${pl.name}: <b>${n}</b></span>`; };
      const botTurn = (bi) => {
        if (over) return;
        if (bi >= players.length) return myTurn();
        const pl = players[bi];
        const n = roll();
        showDie(pl, n);
        const ok = ctx.rng() < pl.p;
        panel.innerHTML = `<p class="ar-intent">${pl.name} ${ok ? 'menjawab benar' : 'menjawab salah'}…</p>`;
        ctx.after(700, () => {
          if (!ok) return ctx.after(400, () => botTurn(bi + 1));
          const cand = pl.pawns.map((rel, i) => ({ i, rel })).filter(x => x.rel < GOAL);
          if (!cand.length) return botTurn(bi + 1);
          const value = (x) => {
            const nr = Math.min(GOAL, x.rel + n);
            if (nr >= GOAL) return 90;
            let v = nr * 0.1;
            if (nr <= 50) {
              const li = loopIdx(pl, nr);
              if (!SAFE.has(li) && players.some(o => o !== pl && o.pawns.some(orel => orel <= 50 && loopIdx(o, orel) === li))) v += 100;
              if (SAFE.has(li)) v += 8;
            } else v += 20;
            return v;
          };
          const best = cand.sort((a, b) => value(b) - value(a))[0];
          move(pl, best.i, n, (out) => {
            if (out.caught) {
              const mine = out.victims.includes(me);
              panel.innerHTML = `<p class="ar-intent ${mine ? 'is-bad' : ''}">${pl.name} menangkap bidak ${mine ? 'milikmu — bidakmu pulang ke petak start' : out.victims.map(o => o.name).join(' & ')}!</p>`;
              if (mine) beep('bad');
            }
            if (done(pl)) return finishGame();
            ctx.after(450, () => botTurn(bi + 1));
          });
        });
      };
      const myTurn = (bonusTurn) => {
        if (over) return;
        if (!bonusTurn) myTurns++;
        if (myTurns > TURNS) return finishGame();
        paint();
        panel.innerHTML = `<div class="ar-ludo-act"><p>${bonusTurn ? `${ic('star', 16)} Giliran tambahan!` : `Giliranmu (${myTurns}/${TURNS})`}</p>
          <button type="button" class="btn btn-primary" id="arRoll">${ic('dice', 18)} Lempar Dadu</button><p class="muted small">Spasi/Enter untuk melempar</p></div>`;
        let rolled = false;
        const doRoll = () => {
          if (rolled || over) return;
          rolled = true; keyAct = null;
          const n = roll();
          showDie(me, n);
          beep('pop');
          ctx.after(reducedMotion() ? 100 : 650, () => ask(n, !!bonusTurn));
        };
        panel.querySelector('#arRoll').addEventListener('click', doRoll);
        keyAct = (k) => { if (k === 'roll') doRoll(); };
      };
      const ask = (n, wasBonus) => {
        const q = next();
        askTurn(sub(ctx, panel), q, myTurns, TURNS, 25, (r) => {
          ctx.hideTimer();
          ctx.mark(r.correct);
          if (!r.correct) return ctx.after(1500, () => botTurn(1));
          const fast = r.left / 25 >= CRIT_AT;
          const steps = n + (fast ? 1 : 0);
          ctx.add(60 + steps * 8);
          r.fb.insertAdjacentHTML('beforeend', `${gainHtml(60 + steps * 8)}<span class="ar-tag">${ic('dice', 14)} Maju ${steps}${fast ? ' (bonus cepat +1)' : ''}</span>`);
          const can = me.pawns.map((rel, i) => ({ rel, i })).filter(x => x.rel < GOAL).map(x => x.i);
          const go = (i) => {
            keyAct = null;
            move(me, i, steps, (out) => {
              if (out.caught) { ctx.add(150 * out.caught); panel.insertAdjacentHTML('beforeend', `<p class="ar-intent is-good">Tangkap! Bidak lawan pulang ${gainHtml(150 * out.caught)}</p>`); beep('win'); }
              if (out.home) { ctx.add(250); panel.insertAdjacentHTML('beforeend', `<p class="ar-intent is-good">Bidak sampai di tengah! ${gainHtml(250)}</p>`); }
              if (done(me)) return ctx.after(900, finishGame);
              if (n === 6 && !wasBonus) return ctx.after(1100, () => myTurn(true));
              ctx.after(1100, () => botTurn(1));
            });
          };
          ctx.after(900, () => {
            if (!can.length) return botTurn(1);
            if (can.length === 1 || me.pawns[0] === me.pawns[1]) return go(can[0]);
            panel.insertAdjacentHTML('beforeend', `<p class="ar-intent">${ic('pin', 16)} Pilih bidak yang akan maju ${steps} langkah: klik bidak bernomor atau tekan 1 / 2.</p>
              <div class="flex-gap">${can.map(i => `<button type="button" class="btn btn-sm btn-secondary" data-pick="${i}">Bidak ${i + 1}</button>`).join('')}</div>`);
            paint(can);
            const pick = (i) => { if (!can.includes(i)) return; panel.querySelectorAll('[data-pick]').forEach(b => { b.disabled = true; }); go(i); };
            panel.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pick(Number(b.dataset.pick))));
            layer.querySelectorAll('[data-pawn]').forEach(g => {
              g.addEventListener('click', () => pick(Number(g.dataset.pawn)));
              g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(Number(g.dataset.pawn)); } });
            });
            keyAct = (k) => { if (k === 0 || k === 1) pick(k); };
          });
        });
      };
      paint();
      myTurn();
    }
  };

  /* ================================================================
   * Pendaftaran
   * ==============================================================*/
  [peta, monsterGame, balap, lari, tambang, tangkap, wilayah, ludo].forEach(g => Games.register(g));

  global.Arcade = {
    SKILLS, MON_ORDER, CRIT_AT, CRIT_MULT, diffMult, roleCardsHtml, overlayQuestion, picker, compactChoices, hearts, floatNum, keys, loop, swipe,
    _test: { LOOP, cellOf, LUDO, hexNeighbors, wrapText }
  };
})(window);
