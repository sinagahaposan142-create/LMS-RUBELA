/* =========================================================================
 * NewsPublic — tampilan berita untuk pengunjung & pengguna.
 *
 *  - Halaman depan (index.html #lpNews): 1 berita utama + 3 terbaru.
 *  - berita.html: daftar (kategori, pencarian, muat lebih banyak) dan
 *    halaman artikel (?id=<slug>), termasuk tautan berbagi & berita terkait.
 *  - Dashboard (menu Berita untuk semua peran) dan pratinjau di editor admin.
 *
 * Sumber data:
 *  - Mode server (halaman publik & dashboard non-admin) → GET
 *    /api/rubela?action=news (tanpa login, hanya berita terbit; di-cache CDN
 *    ±1 menit). Berita tidak ikut disinkronkan ke perangkat non-admin, jadi
 *    gambar sampul tidak memenuhi penyimpanan perangkat siswa.
 *  - Admin di dashboard & mode lokal → DB (semua berita ada di perangkat).
 * Isi artikel selalu dirender lewat RichText.render (sanitasi daftar-putih).
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE_SIZE = 9;
  const TZ = 'Asia/Jakarta';
  const dateFmt = (() => { try { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }); } catch (e) { return null; } })();
  const fmtDate = (ts) => (dateFmt ? dateFmt.format(new Date(Number(ts) || 0)) : new Date(Number(ts) || 0).toLocaleDateString('id-ID'));
  const articleUrl = (n) => 'berita.html?id=' + encodeURIComponent(n.slug || n.id);

  const ICON = {
    arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.7 14.9L2 22l5.3-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    news: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h13v14H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 16h3"/></svg>'
  };

  /* ============================ data ============================ */
  const serverMode = () => !!(global.Sync && Sync.isServer && Sync.isServer());
  /** o.local = baca dari DB perangkat (admin di dashboard). */
  const viaApi = (o) => serverMode() && !(o && o.local);
  const apiUrl = () => ((global.LMS_SYNC_CONFIG && LMS_SYNC_CONFIG.api) || '/api/rubela');

  async function api(params) {
    const qs = Object.entries(Object.assign({ action: 'news' }, params)).filter(([, v]) => v !== '' && v != null)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const res = await fetch(apiUrl() + '?' + qs, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit' });
      if (res.status === 404) return { ok: false, configured: false };      // hosting statis tanpa API
      const data = await res.json().catch(() => null);
      if (!data) throw new Error('Respons server tidak valid.');
      return data;
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Server tidak merespons. Coba lagi.' : 'Berita tidak dapat dimuat. Periksa koneksi internet.');
    } finally { if (t) clearTimeout(t); }
  }
  const localPublished = () => (global.DB && DB.getPublishedNews ? DB.getPublishedNews() : []);
  const strip = (n) => ({ id: n.id, slug: n.slug || n.id, title: n.title, excerpt: n.excerpt || '', category: n.category || '', thumb: n.thumb || '',
    coverAlt: n.coverAlt || '', publishAt: n.publishAt, pinned: !!n.pinned, readMin: n.readMin || 1, authorName: n.authorName || '' });

  async function list(o) {
    const opts = Object.assign({ limit: PAGE_SIZE, offset: 0, cat: '', q: '' }, o || {});
    if (viaApi(opts)) {
      const d = await api({ limit: opts.limit, offset: opts.offset, cat: opts.cat, q: opts.q });
      if (d.ok) return d;
      if (d.configured === false) return localList(opts);
      throw new Error(d.error || 'Berita tidak dapat dimuat.');
    }
    return localList(opts);
  }
  function localList(opts) {
    const all = localPublished();
    const term = String(opts.q || '').trim().toLowerCase();
    const rows = all.filter(n => (!opts.cat || n.category === opts.cat) &&
      (!term || (n.title + ' ' + (n.excerpt || '')).toLowerCase().includes(term)));
    const cats = new Map();
    all.forEach(n => { if (n.category) cats.set(n.category, (cats.get(n.category) || 0) + 1); });
    return {
      ok: true, items: rows.slice(opts.offset, opts.offset + opts.limit).map(strip), total: rows.length, offset: opts.offset, limit: opts.limit,
      categories: [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
    };
  }
  async function get(idOrSlug, o) {
    if (viaApi(o)) {
      const d = await api({ id: idOrSlug });
      if (d.ok || d.notFound) return d;
      if (d.configured !== false) throw new Error(d.error || 'Berita tidak dapat dimuat.');
    }
    const all = localPublished();
    const n = all.find(x => x.id === idOrSlug || x.slug === idOrSlug);
    if (!n) return { ok: false, notFound: true };
    const related = all.filter(x => x.id !== n.id).sort((a, b) => (a.category === n.category ? 0 : 1) - (b.category === n.category ? 0 : 1) || b.publishAt - a.publishAt).slice(0, 3);
    return { ok: true, item: Object.assign(strip(n), { content: n.content || '', cover: n.cover || '', updatedAt: n.updatedAt || 0 }), related: related.map(strip) };
  }

  /* ============================ templat ============================ */
  function mediaHtml(src, alt, cls) {
    return src
      ? `<span class="nw-media ${cls || ''}"><img src="${esc(src)}" alt="${esc(alt || '')}" loading="lazy" decoding="async" /></span>`
      : `<span class="nw-media is-empty ${cls || ''}" aria-hidden="true"><span>Rubela</span></span>`;
  }
  const metaHtml = (n) => `<span class="nw-meta"><time datetime="${new Date(Number(n.publishAt) || 0).toISOString()}">${esc(fmtDate(n.publishAt))}</time><span aria-hidden="true">·</span><span>${Number(n.readMin) || 1} menit baca</span></span>`;
  const catHtml = (n) => (n.category ? `<span class="nw-cat">${esc(n.category)}</span>` : '');

  /** variant: feature | card | compact. link: href atau null (pakai data-nw-open). */
  function cardHtml(n, variant, link) {
    const href = link === undefined ? articleUrl(n) : link;
    const tag = href ? `a href="${esc(href)}"` : `button type="button" data-nw-open="${esc(n.slug || n.id)}"`;
    const end = href ? 'a' : 'button';
    if (variant === 'compact') {
      return `<${tag} class="nw-card is-compact">${mediaHtml(n.thumb, n.coverAlt, 'is-sq')}
        <span class="nw-body">${catHtml(n)}<span class="nw-title">${esc(n.title)}</span>${metaHtml(n)}</span></${end}>`;
    }
    return `<${tag} class="nw-card ${variant === 'feature' ? 'is-feature' : ''}">${mediaHtml(n.thumb, n.coverAlt)}
      <span class="nw-body">${catHtml(n)}${n.pinned && variant === 'feature' ? '<span class="nw-pin">Berita utama</span>' : ''}
        <span class="nw-title">${esc(n.title)}</span>
        ${n.excerpt ? `<span class="nw-excerpt">${esc(n.excerpt)}</span>` : ''}
        ${metaHtml(n)}</span></${end}>`;
  }
  function skeletonHtml(n, variant) {
    return Array.from({ length: n }, () => `<div class="nw-card nw-skel ${variant || ''}" aria-hidden="true"><span class="nw-media"></span>
      <span class="nw-body"><span class="sk-line w30"></span><span class="sk-line w90"></span><span class="sk-line w70"></span></span></div>`).join('');
  }

  /** Isi artikel lengkap (halaman publik, dashboard, pratinjau admin). */
  function articleHtml(item, related, o) {
    const opts = o || {};
    const body = global.RichText ? RichText.render(item.content || '') : esc(String(item.content || '').replace(/<[^>]*>/g, ' '));
    const shareUrl = opts.shareUrl || '';
    return `<article class="nw-article">
      <header class="nw-a-head">
        ${catHtml(item)}
        <h1 class="nw-a-title">${esc(item.title)}</h1>
        ${item.excerpt ? `<p class="nw-a-lead">${esc(item.excerpt)}</p>` : ''}
        <div class="nw-a-meta">${item.authorName ? `<span>Oleh <strong>${esc(item.authorName)}</strong></span><span aria-hidden="true">·</span>` : ''}${metaHtml(item)}
          ${item.updatedAt && item.updatedAt - item.publishAt > 3600000 ? `<span class="nw-upd">Diperbarui ${esc(fmtDate(item.updatedAt))}</span>` : ''}</div>
      </header>
      ${item.cover || item.thumb ? `<figure class="nw-a-cover">${mediaHtml(item.cover || item.thumb, item.coverAlt, 'is-wide')}${item.coverAlt ? `<figcaption>${esc(item.coverAlt)}</figcaption>` : ''}</figure>` : ''}
      <div class="nw-a-body rt-content">${body}</div>
      ${shareUrl ? `<div class="nw-share" aria-label="Bagikan berita">
        <span class="nw-share-lbl">Bagikan</span>
        <button type="button" class="nw-sbtn" data-nw-copy="${esc(shareUrl)}">${ICON.link}<span>Salin tautan</span></button>
        <a class="nw-sbtn" href="https://wa.me/?text=${encodeURIComponent(item.title + ' — ' + shareUrl)}" target="_blank" rel="noopener noreferrer">${ICON.wa}<span>WhatsApp</span></a>
        ${navigator.share ? `<button type="button" class="nw-sbtn" data-nw-native>${ICON.share}<span>Lainnya</span></button>` : ''}
      </div>` : ''}
    </article>
    ${(related || []).length ? `<section class="nw-related" aria-labelledby="nwRelHead"><h2 id="nwRelHead">Berita lainnya</h2>
      <div class="nw-grid is-3">${related.map(n => cardHtml(n, 'card', opts.relatedLink ? opts.relatedLink(n) : undefined)).join('')}</div></section>` : ''}`;
  }
  function bindShare(root, item, shareUrl) {
    root.querySelectorAll('[data-nw-copy]').forEach(b => b.addEventListener('click', async () => {
      const url = b.dataset.nwCopy;
      let ok = false;
      try { if (navigator.clipboard) { await navigator.clipboard.writeText(url); ok = true; } } catch (e) { ok = false; }
      const lbl = b.querySelector('span');
      lbl.textContent = ok ? 'Tautan disalin' : 'Salin manual dari bilah alamat';
      setTimeout(() => { lbl.textContent = 'Salin tautan'; }, 2200);
    }));
    root.querySelectorAll('[data-nw-native]').forEach(b => b.addEventListener('click', () => {
      navigator.share({ title: item.title, text: item.excerpt || item.title, url: shareUrl }).catch(() => {});
    }));
  }

  /* ============================ halaman depan ============================ */
  async function initLanding() {
    const sec = document.getElementById('lpNews');
    if (!sec) return;
    const grid = sec.querySelector('#lpNewsGrid');
    if (viaApi()) { sec.hidden = false; grid.innerHTML = `<div class="lp-news-main">${skeletonHtml(1, 'is-feature')}</div><div class="lp-news-side">${skeletonHtml(3, 'is-compact')}</div>`; }
    try {
      const d = await list({ limit: 4 });
      const items = d.items || [];
      if (!items.length) { sec.hidden = true; return; }
      const [first, ...rest] = items;
      grid.innerHTML = `<div class="lp-news-main">${cardHtml(first, 'feature')}</div>
        <div class="lp-news-side">${rest.map(n => cardHtml(n, 'compact')).join('') || '<p class="nw-side-note">Berita lain akan tampil di sini.</p>'}</div>`;
      sec.hidden = false;
    } catch (e) {
      sec.hidden = true;            // halaman depan tetap bersih bila berita gagal dimuat
    }
  }

  /* ============================ berita.html ============================ */
  function readParams() {
    const p = new URLSearchParams(location.search);
    return { id: p.get('id') || '', cat: p.get('kategori') || '', q: p.get('cari') || '' };
  }
  function writeParams(st) {
    const p = new URLSearchParams();
    if (st.cat) p.set('kategori', st.cat);
    if (st.q) p.set('cari', st.q);
    const s = p.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { /* abaikan */ }
  }
  let lastMeta = null;
  function setMeta(title, desc) {
    lastMeta = { title, desc };
    const app = (document.querySelector('[data-app-name]') || {}).textContent || 'LMS Rubela';
    document.title = title ? `${title} — Berita ${app}` : `Berita — ${app}`;
    const set = (sel, attr, key, val) => {
      let el = document.head.querySelector(sel);
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.setAttribute('content', val);
    };
    const d = String(desc || 'Berita, pengumuman, dan informasi seleksi masuk PTN dari ' + app + '.').slice(0, 300);
    set('meta[name="description"]', 'name', 'description', d);
    set('meta[property="og:title"]', 'property', 'og:title', title || 'Berita ' + app);
    set('meta[property="og:description"]', 'property', 'og:description', d);
    set('meta[property="og:type"]', 'property', 'og:type', title ? 'article' : 'website');
  }

  async function initIndex() {
    const root = document.getElementById('nwRoot');
    if (!root) return;
    const st = readParams();
    if (st.id) { mountArticle(root, st.id, {}); return; }
    setMeta('', '');
    mountList(root, {
      st,
      head: `<header class="nw-page-head">
          <span class="nw-kicker">Kabar Rubela</span>
          <h1>Berita &amp; Informasi</h1>
          <p>Pengumuman, kegiatan, prestasi, dan informasi seleksi masuk perguruan tinggi.</p>
        </header>`
    });
  }

  /**
   * Daftar berita dengan kategori, pencarian, dan "muat lebih banyak".
   * cfg: { st:{cat,q}, head, local, onOpen(slug) } — onOpen diisi = kartu berupa tombol (dashboard).
   */
  function mountList(root, cfg) {
    const st = cfg.st;
    const dash = typeof cfg.onOpen === 'function';
    const link = dash ? null : undefined;
    let offset = 0, total = 0, timer = null, seq = 0;
    root.innerHTML = `${cfg.head || ''}
      <div class="nw-toolbar">
        <div class="nw-chips" data-nw-chips role="group" aria-label="Kategori"></div>
        <label class="nw-search">${ICON.search}<span class="sr-only">Cari berita</span>
          <input type="search" data-nw-q placeholder="Cari berita…" value="${esc(st.q)}" autocomplete="off" /></label>
      </div>
      <div class="nw-grid is-3" data-nw-grid aria-live="polite">${skeletonHtml(6)}</div>
      <div class="nw-more"><button type="button" class="nw-btn" data-nw-more hidden>Muat lebih banyak</button></div>`;
    const grid = root.querySelector('[data-nw-grid]');
    const more = root.querySelector('[data-nw-more]');
    const chips = root.querySelector('[data-nw-chips]');
    const bindOpen = (scope) => {
      if (!dash) return;
      scope.querySelectorAll('[data-nw-open]').forEach(b => {
        if (b.dataset.nwBound) return;
        b.dataset.nwBound = '1';
        b.addEventListener('click', () => cfg.onOpen(b.dataset.nwOpen));
      });
    };
    async function load(reset) {
      const my = ++seq;                       // hasil permintaan lama diabaikan bila filter sudah berubah
      if (reset) { offset = 0; grid.innerHTML = skeletonHtml(6); more.hidden = true; }
      more.disabled = true;
      try {
        const d = await list({ limit: PAGE_SIZE, offset, cat: st.cat, q: st.q, local: cfg.local });
        if (my !== seq) return;
        total = d.total || 0;
        const items = d.items || [];
        if (reset) {
          const cats = d.categories || [];
          if (st.cat && !cats.some(c => c.name === st.cat)) cats.unshift({ name: st.cat, count: 0 });
          chips.innerHTML = [{ name: '', count: null }].concat(cats).map(c =>
            `<button type="button" class="nw-chip ${st.cat === c.name ? 'is-on' : ''}" aria-pressed="${st.cat === c.name}" data-cat="${esc(c.name)}">${c.name ? esc(c.name) : 'Semua'}${c.count != null ? ` <span>${c.count}</span>` : ''}</button>`).join('');
          chips.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
            if (st.cat === b.dataset.cat) return;
            st.cat = b.dataset.cat;
            if (!dash) writeParams(st);
            load(true);
          }));
          const filtered = !!(st.cat || st.q);
          grid.innerHTML = items.length ? items.map((n, i) => cardHtml(n, i === 0 && !filtered ? 'feature' : 'card', link)).join('')
            : `<div class="nw-empty"><strong>${filtered ? 'Tidak ada berita yang cocok' : 'Belum ada berita'}</strong>
                <span>${filtered ? 'Coba kata kunci atau kategori lain.' : 'Berita yang diterbitkan admin akan tampil di sini.'}</span></div>`;
        } else grid.insertAdjacentHTML('beforeend', items.map(n => cardHtml(n, 'card', link)).join(''));
        bindOpen(grid);
        offset += items.length;
        more.hidden = !items.length || offset >= total;
      } catch (e) {
        if (my !== seq) return;
        if (reset) {
          grid.innerHTML = `<div class="nw-empty is-error"><strong>Berita gagal dimuat</strong><span>${esc(e.message)}</span>
            <button type="button" class="nw-btn" data-nw-retry>Coba lagi</button></div>`;
          grid.querySelector('[data-nw-retry]').addEventListener('click', () => load(true));
        } else if (global.UI) UI.toast(e.message, 'error');
      } finally { if (my === seq) more.disabled = false; }
    }
    root.querySelector('[data-nw-q]').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = e.target.value.trim();
        if (q === st.q) return;
        st.q = q;
        if (!dash) writeParams(st);
        load(true);
      }, 300);
    });
    more.addEventListener('click', () => load(false));
    load(true);
  }

  /**
   * Halaman artikel. cfg: { local, onBack(), onOpen(slug) } — onBack diisi = tampilan dashboard.
   */
  async function mountArticle(root, idOrSlug, cfg) {
    const dash = typeof cfg.onBack === 'function';
    const backBtn = dash
      ? `<button type="button" class="nw-crumb-btn" data-nw-back>${ICON.back} Semua berita</button>`
      : `<a href="berita.html">${ICON.back} Semua berita</a>`;
    const bindBack = () => { const b = root.querySelector('[data-nw-back]'); if (b) b.addEventListener('click', cfg.onBack); };
    root.innerHTML = `<div class="nw-article is-loading" aria-busy="true"><span class="sk-line w30"></span><span class="sk-line w90 is-big"></span>
      <span class="sk-line w70"></span><span class="nw-media is-wide nw-skel"></span><span class="sk-line w90"></span><span class="sk-line w80"></span></div>`;
    try {
      const d = await get(idOrSlug, { local: cfg.local });
      if (!d.ok) {
        if (!dash) setMeta('Berita tidak ditemukan', '');
        root.innerHTML = `<div class="nw-empty"><strong>Berita tidak ditemukan</strong><span>Berita ini mungkin sudah dihapus atau belum diterbitkan.</span>
          ${dash ? `<button type="button" class="nw-btn" data-nw-back>${ICON.back} Semua berita</button>` : `<a class="nw-btn" href="berita.html">${ICON.back} Semua berita</a>`}</div>`;
        bindBack();
        return;
      }
      const item = d.item;
      const page = /^https?:$/.test(location.protocol) ? location.origin + location.pathname.replace(/[^/]*$/, '') + 'berita.html' : '';
      const shareUrl = page ? page + '?id=' + encodeURIComponent(item.slug) : '';
      if (!dash) setMeta(item.title, item.excerpt);
      root.innerHTML = `<nav class="nw-crumb" aria-label="Navigasi">${backBtn}
          ${item.category && !dash ? `<span aria-hidden="true">/</span><a href="berita.html?kategori=${encodeURIComponent(item.category)}">${esc(item.category)}</a>` : ''}</nav>
        ${articleHtml(item, d.related, { shareUrl, relatedLink: dash ? () => null : undefined })}`;
      bindShare(root, item, shareUrl);
      bindBack();
      if (dash) root.querySelectorAll('[data-nw-open]').forEach(b => b.addEventListener('click', () => cfg.onOpen(b.dataset.nwOpen)));
      if (global.scrollTo) global.scrollTo(0, 0);
    } catch (e) {
      root.innerHTML = `<div class="nw-empty is-error"><strong>Berita gagal dimuat</strong><span>${esc(e.message)}</span>
        <button type="button" class="nw-btn" data-nw-retry>Coba lagi</button></div>`;
      root.querySelector('[data-nw-retry]').addEventListener('click', () => mountArticle(root, idOrSlug, cfg));
    }
  }

  /* ============================ dashboard ============================ */
  /**
   * Menu "Berita" di dashboard siswa, guru, dan orang tua: berita yang sama dengan
   * halaman depan. Mode server membaca API publik; mode lokal membaca DB.
   */
  function mountDashboard(container, user) {
    const local = !serverMode() || (user && user.role === 'admin');
    const st = { cat: '', q: '' };
    const head = `<div class="card nw-dash-head">
        ${global.UI ? UI.secHead(ICON.news, 'Berita & Informasi', 'Pengumuman, kegiatan, dan info seleksi — sama dengan halaman depan situs') : ''}
        <a class="btn btn-secondary btn-sm" href="berita.html" target="_blank" rel="noopener">Buka halaman publik</a>
      </div>`;
    const shell = document.createElement('div');
    shell.className = 'nw-dash';
    container.innerHTML = '';
    container.appendChild(shell);
    const showList = () => mountList(shell, { st, head, local, onOpen: showArticle });
    function showArticle(slug) {
      shell.innerHTML = '<div class="card nw-dash-article"></div>';
      mountArticle(shell.firstChild, slug, { local, onBack: showList, onOpen: showArticle });
    }
    showList();
  }

  /** Pratinjau artikel di editor admin (memakai templat yang sama dengan halaman publik). */
  function previewHtml(item) {
    return `<div class="nw-preview">${articleHtml(Object.assign({ publishAt: Date.now(), readMin: 1 }, item), [], {})}</div>`;
  }

  /* ============================ tema (berita.html) ============================ */
  function bindTheme() {
    const btn = document.getElementById('nwTheme');
    if (!btn) return;
    const label = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
      const t = btn.querySelector('.lp-ic-label'); if (t) t.textContent = dark ? 'Terang' : 'Gelap';
    };
    btn.addEventListener('click', () => {
      if (global.Effects && Effects.toggleTheme) Effects.toggleTheme();
      else {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('lms_theme', next); } catch (e) { /* abaikan */ }
      }
      label();
    });
    label();
  }
  function applyBranding() {
    if (!(global.Sync && location.protocol !== 'file:' && Sync.detectMode)) return;
    Sync.detectMode().then(h => {
      if (!h || !h.branding) return;
      const b = h.branding;
      const st = { appName: b.appName || 'LMS Rubela', appTagline: b.appTagline || '', appLogo: b.appLogo || '' };
      if (global.Branding) document.querySelectorAll('.brand-logo').forEach(el => Branding.fillLogo(el, st));
      document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = st.appName; });
      if (lastMeta) setMeta(lastMeta.title, lastMeta.desc);
    }).catch(() => {});
  }

  function boot() {
    if (document.getElementById('lpNews')) initLanding();
    if (document.getElementById('nwRoot')) { bindTheme(); applyBranding(); initIndex(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  global.NewsPublic = { list, get, cardHtml, articleHtml, previewHtml, mountDashboard, fmtDate, articleUrl, icons: ICON };
})(window);
