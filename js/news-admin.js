/* =========================================================================
 * NewsAdmin — pengelola berita untuk admin (menu Berita).
 *
 *  - Daftar: jumlah terbit/terjadwal/draf, pencarian & filter, sunting,
 *    lihat, duplikat, hapus.
 *  - Editor satu layar penuh: judul, ringkasan, gambar sampul (diperkecil +
 *    potongan kartu 16:10), isi dengan editor lengkap (Impor Word, Lembar Data
 *    ala Excel, tabel, rumus, gambar, video), status Draf / Terbit / Jadwalkan,
 *    kategori, berita utama, alamat (slug), pratinjau kartu & halaman.
 *  - Simpanan otomatis di perangkat (kunci lms_news_draft:<id|new>, di luar
 *    sinkronisasi) agar tulisan tidak hilang saat tab tertutup.
 * Data disimpan lewat DB.saveNews; server memvalidasi ulang (api/_lib/rules.js).
 * =======================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const DRAFT_PREFIX = 'lms_news_draft:';
  const COVER = { maxW: 1600, maxChars: 440000 };
  const THUMB = { maxW: 640, maxChars: 85000, ratio: 16 / 10 };
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    news: svg('<path d="M4 5h13v14H6a2 2 0 0 1-2-2Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 16h3"/>', 20),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>', 22),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>')
  };
  const STATE = {
    published: { label: 'Terbit', cls: 'badge-success' },
    scheduled: { label: 'Terjadwal', cls: 'badge-info' },
    draft: { label: 'Draf', cls: 'badge-gray' }
  };

  /* ============================ simpanan lokal ============================ */
  function readLocal(id) {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_PREFIX + (id || 'new')) || 'null'); return d && d.v === 1 && d.draft ? d : null; } catch (e) { return null; }
  }
  function writeLocal(id, draft) {
    const key = DRAFT_PREFIX + (id || 'new');
    const rec = { v: 1, savedAt: Date.now(), draft };
    try { localStorage.setItem(key, JSON.stringify(rec)); return 'full'; } catch (e) { /* penuh: coba tanpa gambar sampul */ }
    try { localStorage.setItem(key, JSON.stringify({ v: 1, savedAt: rec.savedAt, draft: Object.assign({}, draft, { cover: '', thumb: '' }), noImage: true })); return 'text'; } catch (e) { return ''; }
  }
  function dropLocal(id) { try { localStorage.removeItem(DRAFT_PREFIX + (id || 'new')); } catch (e) { /* abaikan */ } }

  /* ============================ gambar ============================ */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type || '')) { reject(new Error('Gunakan gambar JPG, PNG, atau WEBP.')); return; }
      if (file.size > 15 * 1024 * 1024) { reject(new Error('Gambar maksimal 15 MB.')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Berkas bukan gambar yang valid.')); };
      img.src = url;
    });
  }
  /** JPEG dengan batas panjang data URL; ratio = potong tengah ke rasio lebar/tinggi. */
  function encode(img, o) {
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (!sw || !sh) throw new Error('Ukuran gambar tidak terbaca.');
    if (o.ratio) {
      if (sw / sh > o.ratio) { const nw = Math.round(sh * o.ratio); sx = Math.round((sw - nw) / 2); sw = nw; }
      else { const nh = Math.round(sw / o.ratio); sy = Math.round((sh - nh) / 2); sh = nh; }
    }
    let w = Math.min(o.maxW, sw);
    for (let pass = 0; pass < 6; pass++) {
      const cw = Math.max(1, Math.round(w)), ch = Math.max(1, Math.round(sh * (w / sw)));
      const cv = document.createElement('canvas');
      cv.width = cw; cv.height = ch;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
      for (const q of [0.85, 0.76, 0.66, 0.56]) {
        const out = cv.toDataURL('image/jpeg', q);
        if (out.length <= o.maxChars) return out;
      }
      w *= 0.8;
    }
    throw new Error('Gambar tidak dapat diperkecil. Coba gambar lain.');
  }

  /* ============================ daftar ============================ */
  function render(container, user) {
    if (!user || user.role !== 'admin') {
      container.innerHTML = '<div class="card"><div class="alert alert-error">Pengelolaan berita khusus admin.</div></div>';
      return;
    }
    const all = DB.getNews().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const now = Date.now();
    const count = { published: 0, scheduled: 0, draft: 0 };
    all.forEach(n => { count[DB.newsState(n, now)]++; });
    const pending = readLocal('new');
    const serverNote = global.Sync && Sync.isServer() ? ' Halaman publik memakai cache ±1 menit.' : '';

    container.innerHTML = `
      <div class="card nwa-head">
        <div class="card-header">
          ${UI.secHead(ICON.news, 'Berita', 'Tampil di halaman depan situs dan halaman Berita, terbuka tanpa login.' + serverNote)}
          <div class="flex-gap">
            <a class="btn btn-secondary btn-sm" href="berita.html" target="_blank" rel="noopener">${ICON.ext} Halaman publik</a>
            <button type="button" class="btn btn-primary btn-sm" id="nwaNew">${ICON.plus} Tulis berita</button>
          </div>
        </div>
        <dl class="nwa-stats">
          <div><dt>Terbit</dt><dd>${count.published}</dd></div>
          <div><dt>Terjadwal</dt><dd>${count.scheduled}</dd></div>
          <div><dt>Draf</dt><dd>${count.draft}</dd></div>
        </dl>
        ${pending ? `<div class="nwa-restore" role="status">
          <div><strong>Tulisan belum disimpan</strong>
            <span>${esc(pending.draft.title || '(tanpa judul)')} · ${esc(UI.fmtRelative(pending.savedAt))}</span></div>
          <div class="flex-gap">
            <button type="button" class="btn btn-sm btn-secondary" data-nwa-drop>Buang</button>
            <button type="button" class="btn btn-sm btn-primary" data-nwa-resume>Lanjutkan menulis</button>
          </div></div>` : ''}
      </div>
      <div class="card"><div id="nwaList"></div></div>`;

    const reload = () => render(container, user);
    container.querySelector('#nwaNew').addEventListener('click', () => {
      if (pending && !UI.confirmDialog('Ada tulisan baru yang belum disimpan. Mulai tulisan baru dan buang tulisan itu?')) return;
      dropLocal('new');
      openEditor(user, null, reload, false);
    });
    const resume = container.querySelector('[data-nwa-resume]');
    if (resume) resume.addEventListener('click', () => openEditor(user, null, reload, true));
    const drop = container.querySelector('[data-nwa-drop]');
    if (drop) drop.addEventListener('click', () => { if (UI.confirmDialog('Buang tulisan yang belum disimpan?')) { dropLocal('new'); reload(); } });

    const cats = [...new Set(all.map(n => n.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    DataSearch.mount({
      container: container.querySelector('#nwaList'),
      items: all,
      stateKey: 'admin-news',
      placeholder: 'Cari judul, ringkasan, kategori, atau penulis…',
      fields: n => [n.title, n.excerpt, n.category, n.slug, n.authorName],
      filters: [
        { key: 'state', label: 'Semua status', get: n => DB.newsState(n), options: Object.keys(STATE).map(k => ({ value: k, label: STATE[k].label })) },
        { key: 'cat', label: 'Semua kategori', get: n => n.category || '', options: cats.map(c => ({ value: c, label: c })) }
      ],
      sorts: [
        { key: 'upd', label: 'Terakhir diubah', cmp: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) },
        { key: 'pub', label: 'Tanggal terbit', cmp: (a, b) => (b.publishAt || 0) - (a.publishAt || 0) },
        { key: 'title', label: 'Judul A–Z', cmp: (a, b) => a.title.localeCompare(b.title, 'id') }
      ],
      pageSize: 15,
      empty: all.length ? 'Tidak ada berita yang cocok.' : 'Belum ada berita. Tekan "Tulis berita" untuk membuat yang pertama.',
      render: (rows, ctx) => `<ul class="nwa-list">${rows.map(n => {
        const s = DB.newsState(n);
        const when = s === 'draft' ? `Diubah ${UI.fmtRelative(n.updatedAt)}` : (s === 'scheduled' ? `Terbit ${UI.fmtDateTime(n.publishAt)}` : `Terbit ${UI.fmtDate(n.publishAt)}`);
        return `<li class="nwa-row">
          <span class="nwa-thumb">${n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy" />` : ICON.image}</span>
          <div class="nwa-main">
            <div class="nwa-badges"><span class="badge ${STATE[s].cls}">${STATE[s].label}</span>
              ${n.pinned ? '<span class="badge badge-warning">Berita utama</span>' : ''}
              ${n.category ? `<span class="nwa-cat">${ctx.highlight(n.category)}</span>` : ''}</div>
            <strong class="nwa-title">${ctx.highlight(n.title)}</strong>
            <span class="nwa-meta">${esc(when)} · ${esc(n.authorName || 'Admin')} · ${Number(n.readMin) || 1} menit baca</span>
          </div>
          <div class="nwa-actions">
            <button type="button" class="btn btn-sm btn-primary" data-nwa-edit="${esc(n.id)}">Sunting</button>
            <button type="button" class="btn btn-sm btn-secondary" data-nwa-view="${esc(n.id)}">${s === 'published' ? 'Lihat' : 'Pratinjau'}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-nwa-dup="${esc(n.id)}">Duplikat</button>
            <button type="button" class="btn btn-sm btn-ghost nwa-del" data-nwa-del="${esc(n.id)}">Hapus</button>
          </div></li>`;
      }).join('')}</ul>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-nwa-edit]').forEach(b => b.addEventListener('click', () => openEditor(user, b.dataset.nwaEdit, reload, false)));
        box.querySelectorAll('[data-nwa-view]').forEach(b => b.addEventListener('click', () => {
          const n = DB.getNewsItem(b.dataset.nwaView);
          if (!n) return;
          if (DB.newsState(n) === 'published') global.open(NewsPublic.articleUrl(n), '_blank', 'noopener');
          else openPreview(n);
        }));
        box.querySelectorAll('[data-nwa-dup]').forEach(b => b.addEventListener('click', () => {
          const n = DB.getNewsItem(b.dataset.nwaDup);
          if (!n) return;
          try {
            const copy = DB.saveNews(Object.assign({}, n, { id: null, slug: '', status: 'draft', publishAt: 0, pinned: false,
              title: ('Salinan ' + n.title).slice(0, 160) }), user);
            UI.toast('Salinan disimpan sebagai draf.', 'success');
            openEditor(user, copy.id, reload, false);
          } catch (e) { UI.toast(e.message, 'error'); }
        }));
        box.querySelectorAll('[data-nwa-del]').forEach(b => b.addEventListener('click', () => {
          const n = DB.getNewsItem(b.dataset.nwaDel);
          if (!n || !UI.confirmDialog(`Hapus berita "${n.title}"? Berita hilang dari halaman depan dan tautannya tidak bisa dibuka lagi.`)) return;
          DB.deleteNews(n.id, user);
          dropLocal(n.id);
          UI.toast('Berita dihapus.', 'success');
          reload();
        }));
      }
    });
  }

  function openPreview(item) {
    UI.modal.open('Pratinjau berita', NewsPublic.previewHtml(item), { fullscreenToggle: true, fullKey: 'news-preview', autofocus: false });
  }

  /* ============================ editor ============================ */
  let ws = null;
  function closeWorkspace() {
    if (ws) { ws.remove(); ws = null; }
    document.body.style.overflow = '';
    Editor.setHost(null);
  }

  function openEditor(user, id, onDone, resume) {
    const editing = id ? DB.getNewsItem(id) : null;
    if (id && !editing) { UI.toast('Berita tidak ditemukan. Mungkin sudah dihapus dari perangkat lain.', 'error'); return; }
    const now = Date.now();
    const initState = editing ? DB.newsState(editing, now) : 'draft';
    const draft = {
      title: editing ? editing.title : '', excerpt: editing ? editing.excerpt || '' : '', category: editing ? editing.category || '' : '',
      cover: editing ? editing.cover || '' : '', thumb: editing ? editing.thumb || '' : '', coverAlt: editing ? editing.coverAlt || '' : '',
      content: editing ? editing.content || '' : '', pinned: editing ? !!editing.pinned : false,
      slug: editing ? editing.slug : '', slugTouched: !!editing,
      mode: initState === 'scheduled' ? 'schedule' : (initState === 'published' ? 'publish' : 'draft'),
      scheduleAt: initState === 'scheduled' ? editing.publishAt : 0
    };
    const local = readLocal(editing ? editing.id : 'new');
    let restoreNote = null;
    if (local && (resume || !editing || local.savedAt > (editing.updatedAt || 0))) {
      if (resume || !editing) { Object.assign(draft, local.draft); if (local.noImage) restoreNote = 'Gambar sampul tidak ikut tersimpan sementara. Unggah ulang bila perlu.'; }
      else restoreNote = 'offer';
    } else if (local) dropLocal(editing.id);          // simpanan lama yang sudah tergantikan versi tersimpan
    let dirty = false, saveTimer = null;

    closeWorkspace();
    ws = document.createElement('div');
    ws.className = 'ce-workspace nwa-ws';
    ws.setAttribute('role', 'dialog');
    ws.setAttribute('aria-label', editing ? 'Sunting berita' : 'Tulis berita');
    ws.innerHTML = `
      <header class="ce-top">
        <button type="button" class="btn btn-secondary btn-sm" id="nwaBack">← Kembali</button>
        <div class="ce-title">
          <h2>${editing ? 'Sunting berita' : 'Tulis berita'}</h2>
          <p id="nwaAuto">${editing ? `Terakhir disimpan ${esc(UI.fmtDateTime(editing.updatedAt))}` : 'Tulisan disimpan sementara di perangkat ini selama Anda mengetik.'}</p>
        </div>
        <div class="ce-actions">
          <button type="button" class="btn btn-secondary" id="nwaPrev">${ICON.eye} Pratinjau</button>
          <button type="button" class="btn btn-primary" id="nwaSave">Simpan</button>
        </div>
      </header>
      <div class="ce-body">
        <div class="ce-main">
          <div class="form ce-form nwa-form">
            <div id="nwaRestore"></div>
            <section class="ce-card">
              <label class="nwa-lbl" for="nwaTitle">Judul</label>
              <textarea id="nwaTitle" class="nwa-title-in" rows="2" maxlength="160" placeholder="Judul berita">${esc(draft.title)}</textarea>
              <div class="nwa-count"><span id="nwaTitleN">0</span>/160</div>
              <label class="nwa-lbl" for="nwaExcerpt">Ringkasan <span class="muted">(opsional)</span></label>
              <textarea id="nwaExcerpt" rows="2" maxlength="320" placeholder="Satu atau dua kalimat yang tampil di kartu berita. Kosongkan untuk diambil dari paragraf pertama.">${esc(draft.excerpt)}</textarea>
              <div class="nwa-count"><span id="nwaExN">0</span>/320</div>
            </section>
            <section class="ce-card">
              <h3 class="ce-h">Gambar sampul</h3>
              <div class="nwa-cover" id="nwaCover"></div>
              <div class="form-group mt-1">
                <label for="nwaAlt">Keterangan gambar</label>
                <input id="nwaAlt" maxlength="160" value="${esc(draft.coverAlt)}" placeholder="mis. Siswa Rubela saat tryout akbar di aula" />
                <div class="muted small">Tampil sebagai keterangan di bawah gambar dan dibacakan pembaca layar.</div>
              </div>
            </section>
            <section class="ce-card">
              <h3 class="ce-h">Isi berita</h3>
              ${Editor.toolbarHtml('nwaBody', { word: true })}
              <div id="nwaBody" class="qe-editor ce-editor-tall nwa-body rt-content" contenteditable="true"
                   data-ph="Tulis isi berita di sini, atau tekan Impor Word untuk memasukkan dokumen .docx.">${draft.content}</div>
              <div class="nwa-bodyfoot"><span id="nwaWords">0 kata</span>
                <span class="muted">Tabel ala Excel: tombol <strong>Lembar Data</strong>. Gabung/urutkan sel: tombol <strong>▦⋯</strong>.</span></div>
            </section>
          </div>
        </div>
        <aside class="ce-side nwa-side">
          <div class="ce-side-head"><h3>Pengaturan terbit</h3><p class="muted small">Atur kapan dan di mana berita tampil</p></div>
          <div class="form nwa-side-body">
            <fieldset class="nwa-field">
              <legend>Status</legend>
              <div class="nwa-seg" role="radiogroup" aria-label="Status berita">
                ${[['draft', 'Draf'], ['publish', 'Terbit'], ['schedule', 'Jadwalkan']].map(([v, l]) =>
                  `<label class="nwa-seg-opt"><input type="radio" name="nwaMode" value="${v}" ${draft.mode === v ? 'checked' : ''} /><span>${l}</span></label>`).join('')}
              </div>
              <p class="nwa-help" id="nwaModeHelp"></p>
              <div class="form-group" id="nwaSchedBox" hidden>
                <label for="nwaSched">Waktu terbit (${esc(UI.getTimezone())})</label>
                <input type="datetime-local" id="nwaSched" value="${esc(draft.scheduleAt ? UI.utcToTzInput(draft.scheduleAt) : '')}" />
              </div>
            </fieldset>
            <div class="form-group">
              <label for="nwaCat">Kategori</label>
              <input id="nwaCat" list="nwaCatList" maxlength="40" value="${esc(draft.category)}" placeholder="Pilih atau ketik kategori" autocomplete="off" />
              <datalist id="nwaCatList">${[...new Set(DB.NEWS_CATEGORIES.concat(DB.getNews().map(n => n.category).filter(Boolean)))]
                .map(c => `<option value="${esc(c)}"></option>`).join('')}</datalist>
            </div>
            <label class="nwa-check"><input type="checkbox" id="nwaPin" ${draft.pinned ? 'checked' : ''} />
              <span><strong>Jadikan berita utama</strong><span class="muted small" id="nwaPinHelp"></span></span></label>
            <div class="form-group">
              <label for="nwaSlug">Alamat halaman</label>
              <div class="nwa-slug"><span>berita.html?id=</span><input id="nwaSlug" maxlength="100" value="${esc(draft.slug)}" spellcheck="false" autocomplete="off" /></div>
              <div class="muted small">Huruf kecil, angka, dan tanda hubung. <button type="button" class="link-btn" id="nwaSlugReset">Buat dari judul</button></div>
            </div>
            <div class="nwa-field">
              <div class="nwa-lbl">Tampilan kartu</div>
              <div class="nwa-cardprev" id="nwaCard" aria-hidden="true" inert></div>
            </div>
            <div class="nwa-field">
              <div class="nwa-lbl">Saat dibagikan / di mesin pencari</div>
              <div class="nwa-serp" id="nwaSerp"></div>
            </div>
            ${editing ? `<div class="nwa-field nwa-info muted small">Ditulis oleh ${esc(editing.authorName || 'Admin')} · dibuat ${esc(UI.fmtDate(editing.createdAt))}</div>
              <button type="button" class="btn btn-sm btn-ghost nwa-del" id="nwaDelete">Hapus berita ini</button>` : ''}
          </div>
        </aside>
      </div>`;
    document.body.appendChild(ws);
    document.body.style.overflow = 'hidden';
    Editor.setHost(ws);

    const $ = (sel) => ws.querySelector(sel);
    const body = $('#nwaBody');
    const titleIn = $('#nwaTitle'), exIn = $('#nwaExcerpt'), slugIn = $('#nwaSlug'), schedIn = $('#nwaSched');

    /* ---- simpanan otomatis ---- */
    function autosave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushLocal, 700);
    }
    function flushLocal() {
      clearTimeout(saveTimer);
      if (!dirty) return true;
      draft.content = body.innerHTML;
      const r = writeLocal(editing ? editing.id : 'new', draft);
      const t = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      $('#nwaAuto').textContent = r === 'full' ? `Tersimpan sementara di perangkat ini · ${t}`
        : (r === 'text' ? `Tersimpan sementara tanpa gambar sampul (penyimpanan perangkat penuh) · ${t}` : 'Penyimpanan perangkat penuh — simpan berita agar tulisan tidak hilang.');
      return !!r;
    }
    const touch = () => { dirty = true; autosave(); };

    /* ---- pratinjau samping ---- */
    const currentSlug = () => (draft.slugTouched && draft.slug ? draft.slug : DB.newsSlug(draft.title || 'berita', editing ? editing.id : null));
    function plainBody() { return (body.innerText || '').replace(/\s+/g, ' ').trim(); }
    function previewItem() {
      const text = plainBody();
      return {
        title: draft.title.trim() || 'Judul berita', category: draft.category.trim(), thumb: draft.thumb, cover: draft.cover, coverAlt: draft.coverAlt,
        excerpt: draft.excerpt.trim() || (text.length > 220 ? text.slice(0, 217).replace(/\s+\S*$/, '') + '…' : text),
        content: RichText.sanitize(body.innerHTML), pinned: draft.pinned, authorName: editing ? editing.authorName : user.name,
        publishAt: draft.mode === 'schedule' && draft.scheduleAt ? draft.scheduleAt : (editing && editing.publishAt ? editing.publishAt : Date.now()),
        readMin: Math.max(1, Math.round((text ? text.split(' ').length : 0) / 200)), slug: currentSlug(), updatedAt: 0
      };
    }
    function paintSide() {
      const it = previewItem();
      const words = plainBody() ? plainBody().split(' ').length : 0;
      $('#nwaWords').textContent = `${words.toLocaleString('id-ID')} kata · ±${it.readMin} menit baca`;
      $('#nwaTitleN').textContent = titleIn.value.length;
      $('#nwaExN').textContent = exIn.value.length;
      if (!draft.slugTouched) slugIn.value = it.slug;
      $('#nwaCard').innerHTML = NewsPublic.cardHtml(it, 'card', null);
      $('#nwaSerp').innerHTML = `<span class="nwa-serp-url">…/berita.html?id=${esc(it.slug)}</span>
        <span class="nwa-serp-title">${esc(it.title)}</span><span class="nwa-serp-desc">${esc(it.excerpt || 'Ringkasan akan diambil dari isi berita.')}</span>`;
      const help = {
        draft: 'Hanya admin yang dapat melihat. Simpan kapan saja.',
        publish: editing && initState === 'published' ? `Sudah terbit sejak ${UI.fmtDateTime(editing.publishAt)}. Perubahan langsung tampil.` : 'Tampil di halaman depan begitu disimpan.',
        schedule: 'Tampil otomatis pada waktu yang dipilih. Sebelum itu hanya admin yang dapat melihat.'
      }[draft.mode];
      $('#nwaModeHelp').textContent = help;
      $('#nwaSchedBox').hidden = draft.mode !== 'schedule';
      $('#nwaSave').textContent = { draft: 'Simpan draf', publish: editing && initState === 'published' ? 'Perbarui' : 'Terbitkan', schedule: 'Jadwalkan' }[draft.mode];
      const other = DB.getNews().find(n => n.pinned && (!editing || n.id !== editing.id));
      $('#nwaPinHelp').textContent = draft.pinned && other ? `Menggantikan "${other.title}".` : 'Tampil paling depan di halaman depan dan halaman Berita.';
    }
    let sideTimer = null;
    const paintSoon = () => { clearTimeout(sideTimer); sideTimer = setTimeout(paintSide, 200); };

    /* ---- gambar sampul ---- */
    function paintCover() {
      const box = $('#nwaCover');
      box.innerHTML = draft.cover || draft.thumb
        ? `<figure class="nwa-cover-fig"><img src="${esc(draft.cover || draft.thumb)}" alt="" /></figure>
           <div class="flex-gap"><label class="btn btn-sm btn-secondary nwa-file">Ganti gambar<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-nwa-cover /></label>
             <button type="button" class="btn btn-sm btn-ghost" data-nwa-uncover>Hapus gambar</button></div>`
        : `<label class="nwa-drop">${ICON.image}<strong>Pilih gambar sampul</strong><span>JPG, PNG, atau WEBP. Diperkecil otomatis; kartu berita memakai potongan tengah 16:10.</span>
             <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-nwa-cover /></label>`;
      box.querySelector('[data-nwa-cover]').addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!f) return;
        box.classList.add('is-busy');
        try {
          const img = await loadImage(f);
          draft.cover = encode(img, COVER);
          draft.thumb = encode(img, THUMB);
          touch(); paintCover(); paintSide();
        } catch (err) { UI.toast(err.message, 'error'); }
        finally { box.classList.remove('is-busy'); }
      });
      const un = box.querySelector('[data-nwa-uncover]');
      if (un) un.addEventListener('click', () => { draft.cover = ''; draft.thumb = ''; touch(); paintCover(); paintSide(); });
    }

    /* ---- ikatan ---- */
    if (restoreNote === 'offer') {
      $('#nwaRestore').innerHTML = `<div class="nwa-restore is-inline" role="status">
        <div><strong>Ada perubahan yang belum disimpan</strong><span>dari ${esc(UI.fmtDateTime(local.savedAt))} di perangkat ini.</span></div>
        <div class="flex-gap"><button type="button" class="btn btn-sm btn-secondary" data-r="drop">Buang</button>
          <button type="button" class="btn btn-sm btn-primary" data-r="use">Pulihkan</button></div></div>`;
      $('#nwaRestore [data-r="use"]').addEventListener('click', () => { closeWorkspace(); openEditor(user, editing.id, onDone, true); });
      $('#nwaRestore [data-r="drop"]').addEventListener('click', () => { dropLocal(editing.id); $('#nwaRestore').innerHTML = ''; });
    } else if (restoreNote) {
      $('#nwaRestore').innerHTML = `<div class="alert alert-info">${esc(restoreNote)}</div>`;
    }
    if (resume && local) dirty = true;

    titleIn.addEventListener('input', () => { draft.title = titleIn.value.replace(/\n+/g, ' '); touch(); paintSoon(); });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); exIn.focus(); } });
    exIn.addEventListener('input', () => { draft.excerpt = exIn.value; touch(); paintSoon(); });
    $('#nwaAlt').addEventListener('input', (e) => { draft.coverAlt = e.target.value; touch(); });
    $('#nwaCat').addEventListener('input', (e) => { draft.category = e.target.value; touch(); paintSoon(); });
    $('#nwaPin').addEventListener('change', (e) => { draft.pinned = e.target.checked; touch(); paintSide(); });
    slugIn.addEventListener('input', () => {
      const v = slugIn.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+/, '');
      if (v !== slugIn.value) slugIn.value = v;
      draft.slug = v; draft.slugTouched = !!v; touch(); paintSoon();
    });
    $('#nwaSlugReset').addEventListener('click', () => { draft.slugTouched = false; draft.slug = ''; touch(); paintSide(); });
    ws.querySelectorAll('input[name="nwaMode"]').forEach(r => r.addEventListener('change', () => {
      draft.mode = r.value;
      if (draft.mode === 'schedule' && !schedIn.value) {
        schedIn.value = UI.utcToTzInput(Date.now() + 86400000 - (Date.now() % 3600000));   // besok, jam bulat
        draft.scheduleAt = UI.tzInputToUtc(schedIn.value);
      }
      touch(); paintSide();
    }));
    schedIn.addEventListener('change', () => { draft.scheduleAt = UI.tzInputToUtc(schedIn.value) || 0; touch(); paintSide(); });
    Editor.attach(ws.querySelector('.ce-main'), { onInput: () => { touch(); paintSoon(); } });

    $('#nwaPrev').addEventListener('click', () => openPreview(previewItem()));
    $('#nwaBack').addEventListener('click', () => {
      const kept = flushLocal();
      if (dirty && !kept && !UI.confirmDialog('Tulisan belum disimpan dan penyimpanan perangkat penuh. Tutup dan buang perubahan?')) return;
      closeWorkspace();
      if (dirty && kept) UI.toast('Tulisan disimpan sementara di perangkat ini.', 'info');
      onDone();
    });
    const del = $('#nwaDelete');
    if (del) del.addEventListener('click', () => {
      if (!UI.confirmDialog(`Hapus berita "${editing.title}"?`)) return;
      DB.deleteNews(editing.id, user);
      dropLocal(editing.id);
      closeWorkspace();
      UI.toast('Berita dihapus.', 'success');
      onDone();
    });

    $('#nwaSave').addEventListener('click', () => {
      const mode = draft.mode;
      let status = 'draft', publishAt = 0;
      if (mode === 'publish') {
        status = 'published';
        publishAt = editing && initState === 'published' ? editing.publishAt : Date.now();
      } else if (mode === 'schedule') {
        status = 'published';
        publishAt = UI.tzInputToUtc(schedIn.value) || 0;
        if (!publishAt || publishAt <= Date.now() + 60000) { UI.toast('Pilih waktu terbit di masa depan, atau pilih status Terbit.', 'error'); schedIn.focus(); return; }
      }
      if (draft.title.trim().length < 3) { UI.toast('Judul berita minimal 3 karakter.', 'error'); titleIn.focus(); return; }
      let saved;
      try {
        saved = DB.saveNews({
          id: editing ? editing.id : null, title: draft.title, excerpt: draft.excerpt, category: draft.category,
          cover: draft.cover, thumb: draft.thumb, coverAlt: draft.coverAlt, pinned: draft.pinned,
          slug: draft.slugTouched ? draft.slug : '', status, publishAt, content: RichText.sanitize(body.innerHTML)
        }, user);
      } catch (e) { UI.toast(e.message, 'error'); return; }
      clearTimeout(saveTimer);
      dropLocal(editing ? editing.id : 'new');
      closeWorkspace();
      const cache = global.Sync && Sync.isServer() ? ' Halaman publik diperbarui dalam ±1 menit.' : '';
      UI.toast(status === 'draft' ? 'Draf disimpan.' : (DB.newsState(saved) === 'scheduled'
        ? `Berita dijadwalkan terbit ${UI.fmtDateTime(saved.publishAt)}.` : 'Berita diterbitkan.' + cache), 'success');
      onDone();
    });

    paintCover();
    paintSide();
    if (!editing && !draft.title) setTimeout(() => titleIn.focus(), 60);
  }

  global.NewsAdmin = { render, openEditor };
})(window);
