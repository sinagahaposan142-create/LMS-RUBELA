/* =====================================================================
 * js/whiteboard.js — papan tulis profesional per kelas
 * ---------------------------------------------------------------------
 * - Objek vektor (goresan, bentuk, teks, gambar, tabel) dalam koordinat
 *   papan (px logis). Papan memiliki ukuran sendiri (preset/diperluas),
 *   sehingga zoom/pan/fit tidak mengubah data.
 * - 10 alat tulis: pena, pena halus, kuas, spidol, stabilo, kaligrafi,
 *   pensil, penghapus, laser pointer (sementara, tidak disimpan), bentuk.
 *   Ditambah teks, pilih (pindah/ubah ukuran/hapus), dan geser (hand).
 * - Undo/redo untuk semua jenis objek, autosave ≤1 detik, riwayat versi,
 *   simpan/buka papan, ekspor PNG/PDF, layar penuh, minimize.
 * - Sinkron antar-tab: BroadcastChannel + event storage, tombstone
 *   (deletedIds) + clearEpoch + penggabungan per objek (updatedAt).
 * - Performa: objek yang sudah selesai dirender ke kanvas cache; selama
 *   menggambar hanya goresan aktif yang digambar ulang lewat rAF.
 * Hak akses tetap di DB: saveWhiteboard/canEditWhiteboard/canViewWhiteboard.
 * ===================================================================*/
(function (global) {
  'use strict';
  let active = null;

  const PRESETS = [
    { key: 'wide', label: 'Lebar 16:9', w: 1920, h: 1080 },
    { key: 'std', label: 'Standar 4:3', w: 1600, h: 1200 },
    { key: 'square', label: 'Persegi', w: 1400, h: 1400 },
    { key: 'a4', label: 'A4 tegak', w: 1240, h: 1754 },
    { key: 'a4l', label: 'A4 mendatar', w: 1754, h: 1240 }
  ];
  const MAX_SIDE = 8000;
  const TEMPLATES = [
    { key: 'plain', label: 'Polos' }, { key: 'grid', label: 'Kotak' }, { key: 'dots', label: 'Titik' },
    { key: 'lines', label: 'Garis' }, { key: 'mm', label: 'Milimeter' }
  ];
  const BGS = [
    { key: '#ffffff', label: 'Putih' }, { key: '#fffbeb', label: 'Krem' },
    { key: '#f0fdf4', label: 'Hijau muda' }, { key: '#1e293b', label: 'Papan gelap' }
  ];
  const TOOLS = [
    { key: 'select', ic: '🖱️', label: 'Pilih / pindah (V)' },
    { key: 'hand', ic: '✋', label: 'Geser papan (H)' },
    { key: 'pen', ic: '✏️', label: 'Pena standar (P)' },
    { key: 'fine', ic: '🖋️', label: 'Pena halus' },
    { key: 'brush', ic: '🖌️', label: 'Kuas' },
    { key: 'marker', ic: '🖍️', label: 'Spidol' },
    { key: 'highlighter', ic: '🟨', label: 'Stabilo' },
    { key: 'calligraphy', ic: '✒️', label: 'Pena kaligrafi' },
    { key: 'pencil', ic: '📝', label: 'Pensil' },
    { key: 'eraser', ic: '🧽', label: 'Penghapus (E)' },
    { key: 'laser', ic: '🔴', label: 'Laser pointer (L)' },
    { key: 'shape', ic: '⬜', label: 'Bentuk (S)' },
    { key: 'text', ic: '🔤', label: 'Teks (T)' }
  ];
  const INK_TOOLS = ['pen', 'fine', 'brush', 'marker', 'highlighter', 'calligraphy', 'pencil', 'eraser'];
  const SHAPES = [
    { key: 'line', label: '／ Garis' }, { key: 'arrow', label: '➝ Panah' }, { key: 'rect', label: '▭ Persegi' },
    { key: 'ellipse', label: '◯ Elips' }, { key: 'triangle', label: '△ Segitiga' }
  ];
  const PALETTE = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb', '#7c3aed', '#db2777', '#ffffff'];
  const FONTS = [
    { key: 'sans', label: 'Sans', css: 'Inter, "Segoe UI", Arial, sans-serif' },
    { key: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
    { key: 'mono', label: 'Mono', css: '"JetBrains Mono", Consolas, monospace' },
    { key: 'hand', label: 'Tulisan tangan', css: '"Comic Sans MS", "Segoe Print", cursive' }
  ];
  /* Karakter per alat: lebar relatif, opasitas bawaan, ujung goresan. */
  const INK = {
    pen: { k: 1, alpha: 1, cap: 'round' },
    fine: { k: 0.45, alpha: 1, cap: 'round' },
    brush: { k: 1.6, alpha: 0.95, cap: 'round', variable: true },
    marker: { k: 2.6, alpha: 0.9, cap: 'square' },
    highlighter: { k: 5.5, alpha: 0.32, cap: 'butt' },
    calligraphy: { k: 2.2, alpha: 1, nib: true },
    pencil: { k: 0.8, alpha: 0.75, cap: 'round', grain: true },
    eraser: { k: 3, alpha: 1, cap: 'round' }
  };

  const fontCss = (key) => (FONTS.find(f => f.key === key) || FONTS[0]).css;
  const rid = () => 'obj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = (n) => Math.round(n * 10) / 10;
  const stamp = (o) => o.updatedAt || o.createdAt || 0;
  /** Gabungan dua kotak {x,y,w,h}. */
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  /**
   * Papan sebuah halaman: tiap halaman memakai latarnya sendiri. Latar PDF/gambar
   * (bgImage) tidak boleh terbawa dari halaman lain — itu yang dulu membuat halaman
   * PDF tampil penyok di halaman lain.
   */
  const pageBoard = (base, own) => Object.assign(
    { w: base.w, h: base.h, bg: base.bg || '#ffffff', template: base.template || 'plain' },
    own || {}, { bgImage: (own && own.bgImage) || null });

  /** Seed deterministik agar tekstur pensil identik di semua layar. */
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  }

  /* -------------------- migrasi data lama (v1 → v2) --------------------
   * v1 menyimpan goresan {tool,color,width,points:[{x,y}]} dengan koordinat
   * 0..1 terhadap kanvas. v2 memakai px papan. Konversi dilakukan di memori;
   * ditulis ulang hanya ketika editor menyimpan. */
  /* ============================ watermark & halaman (ekspor) ============================
   * Diatur admin di Pengaturan → Ekspor Whiteboard. Logo khusus watermark
   * (wbWatermarkLogo) dipakai bila ada; bila kosong memakai logo aplikasi. */
  const MAX_PAGES = 30;
  function wmSettings() {
    const st = (global.DB && DB.getSettings) ? DB.getSettings() : {};
    return {
      enabled: st.wbWatermarkEnabled !== false,
      text: String(st.wbWatermarkText == null ? 'Aset RUBELA Indonesia' : st.wbWatermarkText).trim().slice(0, 80),
      logo: st.wbWatermarkLogo || st.appLogo || '',
      opacity: clamp(Number(st.wbWatermarkOpacity) || 14, 3, 80),
      style: ['tile', 'center', 'corner'].includes(st.wbWatermarkStyle) ? st.wbWatermarkStyle : 'tile',
      pageNumbers: st.wbPageNumbers !== false
    };
  }
  function loadImage(src) {
    return new Promise(resolve => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth ? img : null);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  /** Gambar watermark (logo + teks) di atas kanvas berukuran W×H piksel. */
  function drawWatermark(c, W, H, wm, logoImg, dark) {
    if (!wm || !wm.enabled || (!wm.text && !logoImg)) return;
    const base = Math.min(W, H);
    const ink = dark ? '#ffffff' : '#0f172a';
    const alpha = clamp(wm.opacity / 100, 0.03, 0.8);
    const unit = (logoSize, fontSize) => {
      // Satu "cap": logo di atas, teks di bawah, berpusat di (0,0)
      const lw = logoImg ? logoSize * (logoImg.naturalWidth / logoImg.naturalHeight || 1) : 0;
      const gap = logoImg && wm.text ? fontSize * 0.45 : 0;
      const total = (logoImg ? logoSize : 0) + gap + (wm.text ? fontSize : 0);
      let y = -total / 2;
      if (logoImg) { c.drawImage(logoImg, -lw / 2, y, lw, logoSize); y += logoSize + gap; }
      if (wm.text) { c.font = `800 ${fontSize}px Inter, "Segoe UI", Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(wm.text, 0, y); }
    };
    c.save();
    c.fillStyle = ink;
    if (wm.style === 'corner') {
      c.globalAlpha = clamp(alpha * 3, 0.25, 0.9);
      const fs = Math.max(12, base * 0.026), ls = fs * 2.2;
      const pad = base * 0.03;
      c.translate(W - pad - Math.max(fs * (wm.text.length * 0.32), ls * 1.2), H - pad - (ls + fs) / 2 - fs);
      unit(ls, fs);
    } else if (wm.style === 'center') {
      c.globalAlpha = alpha;
      c.translate(W / 2, H / 2); c.rotate(-Math.PI / 7);
      unit(base * 0.3, base * 0.065);
    } else {
      c.globalAlpha = alpha;
      c.translate(W / 2, H / 2); c.rotate(-Math.PI / 7);
      const fs = Math.max(11, base * 0.034), ls = fs * 2.1;
      const stepX = Math.max(fs * (wm.text.length * 0.62 + 4), ls * 2.6), stepY = (ls + fs) * 2.4;
      const R = Math.hypot(W, H);
      let row = 0;
      for (let y = -R; y <= R; y += stepY, row++) {
        for (let x = -R + (row % 2 ? stepX / 2 : 0); x <= R; x += stepX) { c.save(); c.translate(x, y); unit(ls, fs); c.restore(); }
      }
    }
    c.restore();
  }
  function drawPageFooter(c, W, H, label, dark) {
    const fs = Math.max(11, Math.min(W, H) * 0.02);
    c.save();
    c.font = `600 ${fs}px Inter, "Segoe UI", Arial, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillStyle = dark ? 'rgba(255,255,255,.75)' : 'rgba(15,23,42,.6)';
    c.fillText(label, W / 2, H - fs * 0.8);
    c.restore();
  }
  /** Pratinjau watermark di halaman Pengaturan. */
  async function previewWatermark(canvas, override) {
    if (!canvas) return;
    const wm = Object.assign(wmSettings(), override || {});
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(15,23,42,.08)';
    for (let x = 0; x < W; x += 24) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 24) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#1d4ed8'; c.font = '700 22px Inter, Arial, sans-serif'; c.fillText('y = 2x + 3', 30, 60);
    c.strokeStyle = '#dc2626'; c.lineWidth = 3; c.beginPath(); c.moveTo(30, H - 50); c.quadraticCurveTo(W / 2, 40, W - 40, H - 70); c.stroke();
    const logo = await loadImage(wm.logo);
    drawWatermark(c, W, H, wm, logo, false);
    if (wm.pageNumbers) drawPageFooter(c, W, H, 'Halaman 1 / 2', false);
  }

  function migrate(record) {
    const board = Object.assign({ w: 1920, h: 1080, bg: '#ffffff', template: 'plain', updatedAt: 0 }, record.board || {});
    const objects = (record.strokes || []).map(o => {
      if (!o || o.kind) return o;
      return {
        id: o.id, kind: 'stroke', tool: o.tool === 'eraser' ? 'eraser' : 'pen', color: o.color || '#1f2937',
        width: Number(o.width) || 3, opacity: 1, dash: 'solid', createdAt: o.createdAt || 0,
        pts: (o.points || []).map(p => [r1(p.x * board.w), r1(p.y * board.h), 0.5])
      };
    }).filter(Boolean);
    return { board, objects };
  }

  function mount(opts) {
    destroy();
    const o = opts || {};
    const container = o.container;
    const course = o.course;
    const user = o.user;
    if (!container || !course || !DB.canViewWhiteboard(user, course, o.childId)) {
      if (container) container.innerHTML = '<div class="alert alert-error">Anda tidak memiliki akses ke whiteboard kelas ini.</div>';
      return null;
    }
    const boardId = o.boardId;
    let record = DB.getWhiteboardBoard(boardId);
    if (!record || record.courseId !== course.id) {
      container.innerHTML = '<div class="alert alert-error">Papan tidak ditemukan. Mungkin sudah dihapus.</div>';
      return null;
    }
    const editable = DB.canEditWhiteboard(user, course);
    const prefKey = 'lms_wb_pref:' + user.id;
    const pref = (() => { try { return JSON.parse(localStorage.getItem(prefKey) || '{}') || {}; } catch (e) { return {}; } })();
    const savePref = () => { try { localStorage.setItem(prefKey, JSON.stringify(pref)); } catch (e) { /* abaikan */ } };

    let { board, objects } = migrate(record);
    let media = clone(record.media || []);   // berkas PDF/gambar papan ini {key, bytes, at}
    let thumb = record.thumb || '';
    let thumbAt = 0;
    /* Halaman: halaman aktif = objects/board di atas (disinkronkan seperti biasa);
     * halaman lain disimpan sebagai cuplikan di pageData. */
    let pages = Array.isArray(record.pages) && record.pages.length ? clone(record.pages) : [{ id: 'pg_1', name: 'Halaman 1' }];
    let pageData = clone(record.pageData || {});
    let activePage = pages.some(pg => pg.id === record.activePage) ? record.activePage : pages[0].id;
    let pagesUpdatedAt = Number(record.pagesUpdatedAt) || 0;
    let pagesDirty = false;     // true bila daftar halaman berubah dari perangkat lain
    let clearEpoch = Number(record.clearEpoch) || 0;
    let deletedIds = new Set(record.deletedIds || []);
    let pendingRemote = null;
    const undoStack = [];
    const redoStack = [];
    let dirty = false, lastSave = 0, saveTimer = null, raf = 0, destroyed = false;
    let lastVersionAt = (DB.getWhiteboardSaves(course.id, 'version', boardId)[0] || {}).createdAt || 0;
    // Penonton (mentee/orang tua) dapat membuka halaman lain sendiri; "ikuti" = selalu di halaman yang dibuka tutor.
    let follow = true;
    let viewPage = activePage;
    let editsSinceVersion = 0;
    const origin = Math.random().toString(36).slice(2);
    let channel = null;

    // Pengaturan alat (preferensi per pengguna, tidak disinkronkan)
    const st = Object.assign({
      tool: editable ? 'pen' : 'hand', color: '#111827', width: 4, opacity: 100, dash: 'solid', pressure: true, bold: false,
      shape: 'rect', fill: false, font: 'sans', textSize: 32, eraser: 'pixel', custom: [], guides: false,
      dock: global.innerWidth < 760, tbx: 12, tby: 12
    }, pref);
    if (!editable) st.tool = 'hand';
    const view = { zoom: 1, panX: 0, panY: 0 };
    let userView = false;    // true setelah pengguna zoom/geser manual

    let current = null;      // goresan/bentuk yang sedang dibuat
    let selected = new Set(); // id objek terpilih (bisa banyak: blok/kelompok)
    let drag = null;         // operasi pindah/resize/geser
    let lasers = [];         // jejak laser {pts:[[x,y,t]], local}
    let laserSend = 0;
    let textEditor = null;
    const images = new Map();
    const objectUrls = [];    // URL blob gambar/PDF, dilepas saat papan ditutup
    let spaceDown = false;

    /* ============================ markup ============================ */
    const toolBtn = (t) => `<button type="button" class="wb-tool ${st.tool === t.key ? 'is-on' : ''}" data-wb-tool="${t.key}"
      title="${UI.esc(t.label)}" aria-label="${UI.esc(t.label)}" aria-pressed="${st.tool === t.key}">${t.ic}</button>`;

    container.innerHTML = `
      <div class="card whiteboard-card wb-pro" id="wbCard">
        <div class="wb-bar">
          <span class="wb-save" id="wbSave">${record.updatedAt ? 'Tersimpan ' + UI.fmtRelative(record.updatedAt) : (editable ? 'Belum ada coretan' : 'Mode lihat')}</span>
          <strong class="wb-fs-title">${UI.esc(DB.boardTitle(record))}</strong>
          <div class="wb-head-actions">
            ${editable ? `<label class="wb-ibtn wb-import" title="PDF menjadi halaman baru (ukuran asli); gambar disisipkan dan dapat dipindah" aria-label="Impor PDF atau gambar">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
              <span>PDF / Gambar</span><input type="file" id="wbImport" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" multiple hidden /></label>` : ''}
            <div class="wb-zoom" role="group" aria-label="Zoom">
              <button type="button" class="wb-ibtn" data-wb-zoom="out" title="Perkecil (−)" aria-label="Perkecil">－</button>
              <button type="button" class="wb-ibtn wb-zoom-val" data-wb-zoom="reset" title="Zoom 100%" aria-label="Zoom 100%">100%</button>
              <button type="button" class="wb-ibtn" data-wb-zoom="in" title="Perbesar (+)" aria-label="Perbesar">＋</button>
              <button type="button" class="wb-ibtn" data-wb-zoom="fit" title="Muat ke layar (0)" aria-label="Muat ke layar">⤢</button>
            </div>
            <button type="button" class="wb-ibtn" data-wb-panel="board" title="Ukuran, latar & template" aria-label="Pengaturan papan">📐</button>
            ${editable ? '<button type="button" class="wb-ibtn" data-wb-panel="saves" title="Salinan & riwayat versi" aria-label="Salinan dan riwayat versi">🗂️</button>' : ''}
            <button type="button" class="wb-ibtn" data-wb-panel="export" title="Ekspor PNG / PDF" aria-label="Ekspor">⬇️</button>
            <button type="button" class="wb-ibtn" id="wbFull" title="Layar penuh (F)" aria-label="Layar penuh">⛶</button>
            <button type="button" class="wb-ibtn" id="wbMin" title="Minimalkan" aria-label="Minimalkan whiteboard">▁</button>
          </div>
        </div>
        <div class="wb-pages" id="wbPages" role="toolbar" aria-label="Halaman whiteboard"></div>
        <div class="wb-body">
          <div class="wb-stage" id="wbStage">
            <canvas id="wbCanvas" tabindex="0" aria-label="Whiteboard ${UI.esc(DB.courseTitle(course))}"></canvas>
            ${editable ? `<div class="wb-palette ${st.dock ? 'is-docked' : ''}" id="wbPalette" style="left:${st.tbx}px;top:${st.tby}px" role="toolbar" aria-label="Alat whiteboard">
              <button type="button" class="wb-grip" id="wbGrip" title="Seret untuk memindahkan toolbar" aria-label="Pindahkan toolbar">⠿</button>
              <div class="wb-tools">${TOOLS.map(toolBtn).join('')}</div>
              <span class="wb-sep"></span>
              <label class="wb-swatch" title="Warna"><input type="color" id="wbColor" value="${UI.esc(st.color)}" aria-label="Warna" /></label>
              <button type="button" class="wb-tool" id="wbUndo" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
              <button type="button" class="wb-tool" id="wbRedo" title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
              <button type="button" class="wb-tool" id="wbDelSel" title="Hapus objek terpilih (Del)" aria-label="Hapus objek terpilih">🗑️</button>
              <button type="button" class="wb-tool wb-tool-txt" id="wbGroup" title="Kelompokkan objek terpilih (Ctrl+G)" aria-label="Kelompokkan" hidden>⧉</button>
              <button type="button" class="wb-tool wb-tool-txt" id="wbUngroup" title="Pisahkan kelompok (Ctrl+Shift+G)" aria-label="Pisahkan kelompok" hidden>⧈</button>
              <button type="button" class="wb-tool" data-wb-panel="tools" title="Pengaturan alat" aria-label="Pengaturan alat">⚙️</button>
              <button type="button" class="wb-tool" id="wbDock" title="${st.dock ? 'Lepas toolbar' : 'Tempel toolbar di atas'}" aria-label="Tempel atau lepas toolbar">📌</button>
            </div>` : ''}
            <div class="wb-sheet hidden" id="wbSheet" role="dialog" aria-modal="false"></div>
            <div class="wb-hint muted small" id="wbHint"></div>
          </div>
          <div class="wb-min-bar hidden" id="wbMinBar">Whiteboard diminimalkan — <button type="button" class="btn btn-sm btn-primary" id="wbRestore">Tampilkan</button></div>
        </div>
      </div>`;

    const card = container.querySelector('#wbCard');
    const stage = container.querySelector('#wbStage');
    const canvas = container.querySelector('#wbCanvas');
    const ctx = canvas.getContext('2d');
    const ink = document.createElement('canvas');
    const ictx = ink.getContext('2d');
    let inkDirty = true;
    const status = container.querySelector('#wbSave');
    const sheet = container.querySelector('#wbSheet');
    const hint = container.querySelector('#wbHint');
    const zoomVal = container.querySelector('.wb-zoom-val');
    let dpr = 1;

    function setStatus(text, cls) { status.textContent = text; status.className = 'wb-save ' + (cls || ''); }
    function flashHint(text) {
      hint.textContent = text; hint.classList.add('is-on');
      clearTimeout(flashHint.t); flashHint.t = setTimeout(() => hint.classList.remove('is-on'), 1600);
    }

    /* ============================ view ============================ */
    /** Papan + semua isi (tulisan boleh keluar dari ukuran papan). */
    function contentBounds(pad) {
      let b = { x: 0, y: 0, w: board.w, h: board.h };
      objects.forEach(ob => { const o = bbox(ob); if (o) b = union(b, o); });
      if (pad && (b.x < 0 || b.y < 0 || b.x + b.w > board.w || b.y + b.h > board.h)) b = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      return b;
    }
    function fit() {
      const w = stage.clientWidth || 600, h = stage.clientHeight || 400;
      const b = contentBounds(16);
      view.zoom = clamp(Math.min((w - 24) / b.w, (h - 24) / b.h), 0.05, 8);
      view.panX = (w - b.w * view.zoom) / 2 - b.x * view.zoom;
      view.panY = (h - b.h * view.zoom) / 2 - b.y * view.zoom;
      viewChanged();
    }
    function zoomAt(factor, sx, sy) {
      userView = true;
      const nz = clamp(view.zoom * factor, 0.05, 8);
      const wx = (sx - view.panX) / view.zoom, wy = (sy - view.panY) / view.zoom;
      view.zoom = nz; view.panX = sx - wx * nz; view.panY = sy - wy * nz;
      viewChanged();
    }
    function viewChanged() {
      zoomVal.textContent = Math.round(view.zoom * 100) + '%';
      inkDirty = true; scheduleDraw();
      if (textEditor) placeTextEditor();
    }
    function toWorld(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left - view.panX) / view.zoom, y: (e.clientY - r.top - view.panY) / view.zoom };
    }
    function resize() {
      const rect = stage.getBoundingClientRect();
      dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.max(200, Math.round(rect.width * dpr));
      const h = Math.max(200, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        const first = !canvas.dataset.ready;
        canvas.width = w; canvas.height = h; ink.width = w; ink.height = h;
        canvas.dataset.ready = '1';
        // Selama pengguna belum zoom/geser manual, papan selalu dimuat pas layar.
        if (first || !userView) fit(); else { inkDirty = true; draw(); }
      }
    }

    /* ============================ render ============================ */
    function applyView(c) { c.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.panX, dpr * view.panY); }

    /** Letak latar PDF/gambar: ukuran asli halaman (tidak diregangkan), mulai dari pojok kiri atas papan. */
    function bgRect(brd) {
      const bi = brd && brd.bgImage;
      if (!bi) return null;
      if (bi.w > 0 && bi.h > 0) return { x: 0, y: 0, w: bi.w, h: bi.h };
      const img = imageFor(bi);
      if (!img.naturalWidth) return null;
      return { x: 0, y: 0, w: brd.w, h: brd.w * img.naturalHeight / img.naturalWidth };
    }
    /** Area dunia yang terlihat di layar. */
    function visibleRect() {
      return { x: -view.panX / view.zoom, y: -view.panY / view.zoom, w: canvas.width / dpr / view.zoom, h: canvas.height / dpr / view.zoom };
    }
    /**
     * Latar, halaman PDF, dan template diisi di seluruh `area` (bawaan: papan), sehingga
     * tidak ada "kotak putih" di tengah layar abu-abu; papan tampak menyatu dengan layar.
     */
    function drawTemplate(c, area) {
      const a = area || { x: 0, y: 0, w: board.w, h: board.h };
      c.save();
      c.fillStyle = board.bg || '#ffffff';
      c.fillRect(a.x, a.y, a.w, a.h);
      const dark = board.bg === '#1e293b';
      // Halaman PDF/gambar impor menjadi latar: di bawah lapisan tinta, jadi penghapus tidak menghapusnya.
      const br = bgRect(board);
      if (br) {
        const img = imageFor(board.bgImage);
        if (img.complete && img.naturalWidth) c.drawImage(img, br.x, br.y, br.w, br.h);
        c.strokeStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(15,23,42,.14)';
        c.lineWidth = 1 / view.zoom;
        c.strokeRect(br.x, br.y, br.w, br.h);
      }
      const line = dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.10)';
      const strong = dark ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.18)';
      c.lineWidth = 1 / view.zoom;
      const x0 = a.x, y0 = a.y, x1 = a.x + a.w, y1 = a.y + a.h;
      const from = (v, step, off) => Math.ceil((v - (off || 0)) / step) * step + (off || 0);
      if (board.template === 'grid' || board.template === 'mm') {
        // Garis yang terlalu rapat pada zoom kecil dilewati agar tetap ringan & terbaca.
        let step = board.template === 'mm' ? 10 : 40;
        if (step * view.zoom < 4) step = board.template === 'mm' ? 50 : 0;
        if (step) {
          for (let x = from(x0, step); x <= x1; x += step) {
            c.strokeStyle = board.template === 'mm' && x % 50 === 0 ? strong : line;
            c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke();
          }
          for (let y = from(y0, step); y <= y1; y += step) {
            c.strokeStyle = board.template === 'mm' && y % 50 === 0 ? strong : line;
            c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
          }
        }
      } else if (board.template === 'dots' && 40 * view.zoom >= 6) {
        c.fillStyle = strong;
        const rr = Math.max(1.4, 1.2 / view.zoom);
        for (let x = from(x0, 40); x <= x1; x += 40) for (let y = from(y0, 40); y <= y1; y += 40) c.fillRect(x - rr / 2, y - rr / 2, rr, rr);
      } else if (board.template === 'lines' && 48 * view.zoom >= 4) {
        c.strokeStyle = line;
        for (let y = from(y0, 48, 64); y <= y1; y += 48) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
        c.strokeStyle = dark ? 'rgba(248,113,113,.35)' : 'rgba(220,38,38,.25)';
        c.beginPath(); c.moveTo(96, y0); c.lineTo(96, y1); c.stroke();
      }
      if (st.guides) {
        c.strokeStyle = dark ? 'rgba(96,165,250,.5)' : 'rgba(37,99,235,.35)';
        c.setLineDash([8 / view.zoom, 6 / view.zoom]);
        c.beginPath(); c.moveTo(board.w / 2, 0); c.lineTo(board.w / 2, board.h);
        c.moveTo(0, board.h / 2); c.lineTo(board.w, board.h / 2); c.stroke();
        c.strokeRect(board.w * 0.05, board.h * 0.05, board.w * 0.9, board.h * 0.9);
      }
      c.restore();
    }

    function dashFor(o, w) {
      if (o.dash === 'dashed') return [w * 3, w * 2.2];
      if (o.dash === 'dotted') return [0.01, w * 2.2];
      return [];
    }

    function strokePath(c, pts) {
      c.beginPath();
      if (pts.length === 1) { c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[0][0] + 0.01, pts[0][1] + 0.01); return; }
      c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      c.lineTo(last[0], last[1]);
    }

    function drawStroke(c, o) {
      const pts = o.pts || [];
      if (!pts.length) return;
      const spec = INK[o.tool] || INK.pen;
      const base = Math.max(0.5, (Number(o.width) || 3) * spec.k * (o.bold ? 1.8 : 1));
      c.save();
      c.globalAlpha = o.tool === 'eraser' ? 1 : spec.alpha * clamp((o.opacity == null ? 100 : o.opacity) / 100, 0.05, 1);
      c.globalCompositeOperation = o.tool === 'eraser' ? 'destination-out' : 'source-over';
      c.strokeStyle = c.fillStyle = o.color || '#111827';
      c.lineJoin = 'round';
      c.lineCap = spec.cap || 'round';
      if (spec.nib) {
        // Ujung pena miring 45°: lebar tergantung arah goresan.
        const nx = Math.cos(Math.PI / 4) * base / 2, ny = Math.sin(Math.PI / 4) * base / 2;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const k = o.pressure ? 0.5 + (b[2] || 0.5) : 1;
          c.beginPath();
          c.moveTo(a[0] + nx * k, a[1] - ny * k); c.lineTo(b[0] + nx * k, b[1] - ny * k);
          c.lineTo(b[0] - nx * k, b[1] + ny * k); c.lineTo(a[0] - nx * k, a[1] + ny * k);
          c.closePath(); c.fill();
        }
        if (pts.length === 1) { c.fillRect(pts[0][0] - nx, pts[0][1] - ny, nx * 2, ny * 2); }
      } else if ((spec.variable || (o.pressure && pts.some(p => Math.abs((p[2] || 0.5) - 0.5) > 0.02)))
        && ['pen', 'fine', 'brush', 'eraser'].includes(o.tool) && c.globalAlpha >= 0.9) {
        // Lebar variabel hanya untuk tinta pekat: pada tinta transparan (stabilo,
        // spidol, pensil) sambungan segmen akan tampak lebih gelap.
        // Lebar mengikuti tekanan stylus (atau kecepatan untuk kuas).
        c.setLineDash(dashFor(o, base));
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          c.lineWidth = base * (0.35 + (b[2] == null ? 0.5 : b[2]) * 1.3);
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        }
        if (pts.length === 1) { c.lineWidth = base; strokePath(c, pts); c.stroke(); }
      } else {
        c.lineWidth = base;
        c.setLineDash(dashFor(o, base));
        strokePath(c, pts); c.stroke();
        if (spec.grain) {
          // Tekstur grafit: dua jejak tipis bergeser acak (deterministik).
          const rnd = seeded(o.id || 'p');
          c.globalAlpha *= 0.45; c.lineWidth = Math.max(0.4, base * 0.5);
          for (let pass = 0; pass < 2; pass++) {
            const jx = (rnd() - 0.5) * base * 1.1, jy = (rnd() - 0.5) * base * 1.1;
            strokePath(c, pts.map(p => [p[0] + jx, p[1] + jy])); c.stroke();
          }
        }
      }
      c.restore();
    }

    function drawShape(c, o) {
      const w = Math.max(0.5, (Number(o.width) || 3) * (o.bold ? 1.8 : 1));
      c.save();
      c.globalAlpha = clamp((o.opacity == null ? 100 : o.opacity) / 100, 0.05, 1);
      c.strokeStyle = c.fillStyle = o.color || '#111827';
      c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
      c.setLineDash(dashFor(o, w));
      const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), ww = Math.abs(o.x2 - o.x1), hh = Math.abs(o.y2 - o.y1);
      c.beginPath();
      if (o.shape === 'rect') c.rect(x, y, ww, hh);
      else if (o.shape === 'ellipse') c.ellipse(x + ww / 2, y + hh / 2, ww / 2 || 0.5, hh / 2 || 0.5, 0, 0, Math.PI * 2);
      else if (o.shape === 'triangle') { c.moveTo(x + ww / 2, y); c.lineTo(x + ww, y + hh); c.lineTo(x, y + hh); c.closePath(); }
      else { c.moveTo(o.x1, o.y1); c.lineTo(o.x2, o.y2); }
      if (o.fill && ['rect', 'ellipse', 'triangle'].includes(o.shape)) {
        c.save(); c.globalAlpha *= 0.22; c.fill(); c.restore();
      }
      c.stroke();
      if (o.shape === 'arrow') {
        const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1), head = Math.max(12, w * 4);
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(o.x2, o.y2); c.lineTo(o.x2 - head * Math.cos(ang - 0.45), o.y2 - head * Math.sin(ang - 0.45));
        c.lineTo(o.x2 - head * Math.cos(ang + 0.45), o.y2 - head * Math.sin(ang + 0.45));
        c.closePath(); c.fill();
      }
      c.restore();
    }

    const measureCtx = document.createElement('canvas').getContext('2d');
    function textMetrics(o) {
      const size = Number(o.size) || 32;
      measureCtx.font = `${o.bold ? 700 : 400} ${size}px ${fontCss(o.font)}`;
      const lines = String(o.text || '').split('\n');
      const w = Math.max(size * 0.6, ...lines.map(l => measureCtx.measureText(l).width));
      return { lines, size, w, h: lines.length * size * 1.25 };
    }
    function drawText(c, o) {
      const m = textMetrics(o);
      c.save();
      c.globalAlpha = clamp((o.opacity == null ? 100 : o.opacity) / 100, 0.05, 1);
      c.fillStyle = o.color || '#111827';
      c.font = `${o.bold ? 700 : 400} ${m.size}px ${fontCss(o.font)}`;
      c.textBaseline = 'top';
      m.lines.forEach((l, i) => c.fillText(l, o.x, o.y + i * m.size * 1.25));
      c.restore();
    }

    /** ref: data URL lama, atau { blob: "wb:…" } berkas di BlobStore (server + cache IndexedDB). */
    function imageFor(ref) {
      const key = ref && typeof ref === 'object' ? (ref.blob ? 'blob:' + ref.blob : ref.src || '') : String(ref || '');
      let img = images.get(key);
      if (!img) {
        img = new Image();
        img.onload = () => { inkDirty = true; scheduleDraw(); };
        images.set(key, img);
        if (key.startsWith('blob:')) {
          img.loading = true;
          (global.BlobStore ? BlobStore.get(ref.blob) : Promise.resolve(null)).then(b => {
            img.loading = false;
            if (destroyed) return;
            if (b) { const url = URL.createObjectURL(b); objectUrls.push(url); img.src = url; }
            else { img.failed = true; scheduleDraw(); }
          }).catch(() => { img.loading = false; img.failed = true; });
        } else img.src = key;
      }
      return img;
    }
    function drawImageObj(c, o) {
      const img = imageFor(o.blob ? { blob: o.blob } : o.src);
      if (img.complete && img.naturalWidth) c.drawImage(img, o.x, o.y, o.w, o.h);
      else { c.save(); c.strokeStyle = '#94a3b8'; c.setLineDash([6, 6]); c.strokeRect(o.x, o.y, o.w, o.h); c.restore(); }
    }

    function drawTable(c, o) {
      const cw = o.w / o.cols, ch = o.h / o.rows;
      c.save();
      c.strokeStyle = o.color || '#111827';
      c.lineWidth = Math.max(1, Number(o.width) || 2);
      c.strokeRect(o.x, o.y, o.w, o.h);
      c.beginPath();
      for (let i = 1; i < o.cols; i++) { c.moveTo(o.x + i * cw, o.y); c.lineTo(o.x + i * cw, o.y + o.h); }
      for (let j = 1; j < o.rows; j++) { c.moveTo(o.x, o.y + j * ch); c.lineTo(o.x + o.w, o.y + j * ch); }
      c.stroke();
      const size = clamp(Math.min(ch * 0.42, Number(o.size) || 22), 8, 64);
      c.fillStyle = o.color || '#111827';
      c.font = `400 ${size}px ${fontCss(o.font)}`;
      c.textBaseline = 'middle';
      (o.cells || []).forEach((row, j) => (row || []).forEach((txt, i) => {
        if (!txt) return;
        c.save();
        c.beginPath(); c.rect(o.x + i * cw + 2, o.y + j * ch + 2, cw - 4, ch - 4); c.clip();
        c.fillText(String(txt), o.x + i * cw + 8, o.y + j * ch + ch / 2);
        c.restore();
      }));
      c.restore();
    }

    function drawObj(c, ob) {
      if (ob.kind === 'stroke') drawStroke(c, ob);
      else if (ob.kind === 'shape') drawShape(c, ob);
      else if (ob.kind === 'text') drawText(c, ob);
      else if (ob.kind === 'image') drawImageObj(c, ob);
      else if (ob.kind === 'table') drawTable(c, ob);
    }

    function renderInk(includeCurrent) {
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.clearRect(0, 0, ink.width, ink.height);
      applyView(ictx);
      // Hanya gambar objek yang terlihat (culling) supaya papan besar tetap ringan.
      const vx0 = -view.panX / view.zoom, vy0 = -view.panY / view.zoom;
      const vx1 = vx0 + canvas.width / dpr / view.zoom, vy1 = vy0 + canvas.height / dpr / view.zoom;
      objects.forEach(ob => {
        const b = bbox(ob);
        if (b && (b.x > vx1 || b.y > vy1 || b.x + b.w < vx0 || b.y + b.h < vy0)) return;
        drawObj(ictx, ob);
      });
      if (includeCurrent && current) drawObj(ictx, current);
    }

    function draw() {
      if (destroyed) return;
      const erasing = current && current.tool === 'eraser';
      if (inkDirty || erasing) { renderInk(erasing); inkDirty = false; if (erasing) inkDirty = true; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      applyView(ctx);
      drawTemplate(ctx, visibleRect());
      if (stage.dataset.bg !== board.bg) { stage.dataset.bg = board.bg || '#ffffff'; stage.style.background = board.bg || '#ffffff'; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ink, 0, 0);
      applyView(ctx);
      if (current && !erasing) drawObj(ctx, current);
      drawSelection();
      const alive = drawLasers();
      if (alive) scheduleDraw();
    }

    /* ---- pilihan (satu, banyak, atau kelompok) ---- */
    const selectedObjs = () => objects.filter(ob => selected.has(ob.id));
    function selBounds() {
      let b = null;
      selectedObjs().forEach(ob => { const o = bbox(ob); if (o) b = b ? union(b, o) : o; });
      return b;
    }
    /** Objek sekelompok (groupId sama) selalu terpilih bersama. */
    function withGroups(ids) {
      const groups = new Set(objects.filter(ob => ids.has(ob.id) && ob.groupId).map(ob => ob.groupId));
      if (groups.size) objects.forEach(ob => { if (ob.groupId && groups.has(ob.groupId)) ids.add(ob.id); });
      return ids;
    }
    function setSelection(ids) { selected = withGroups(new Set(ids)); updateButtons(); scheduleDraw(); }
    function marqueeRect(d) {
      return { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
    }
    /** Kelompokkan pilihan (satu groupId) atau pisahkan kembali; satu langkah undo. */
    function setGroup(on) {
      if (!guard()) return;
      const list = selectedObjs();
      if (on && list.length < 2) { flashHint('Pilih minimal dua objek untuk dikelompokkan.'); return; }
      if (!on && !list.some(ob => ob.groupId)) return;
      const gid = on ? 'grp_' + rid().slice(4) : null;
      const befores = clone(list);
      list.forEach(ob => { if (gid) ob.groupId = gid; else delete ob.groupId; touch(ob); });
      actUpdateMany(befores, clone(list));
      flush();
      flashHint(on ? `${list.length} objek dikelompokkan — dipindah & diubah ukurannya bersama` : 'Kelompok dipisahkan');
    }
    /** Geser pilihan dengan tombol panah (Shift = 10 px). */
    function nudge(dx, dy) {
      if (!guard() || !selected.size) return;
      const list = selectedObjs();
      const befores = clone(list);
      list.forEach(ob => { translate(ob, dx, dy); touch(ob); });
      actUpdateMany(befores, clone(list));
      clearTimeout(nudge.t); nudge.t = setTimeout(flush, 400);
    }
    function handleRect(b) {
      const hs = 10 / view.zoom, off = 4 / view.zoom;
      return { x: b.x + b.w - hs / 2 + off, y: b.y + b.h - hs / 2 + off, s: hs };
    }

    function drawSelection() {
      const pad = 4 / view.zoom;
      ctx.save();
      if (drag && drag.mode === 'marquee') {
        const r = marqueeRect(drag);
        ctx.fillStyle = 'rgba(37,99,235,.08)'; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1 / view.zoom; ctx.setLineDash([4 / view.zoom, 3 / view.zoom]);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      const list = selectedObjs();
      if (list.length) {
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.strokeStyle = 'rgba(37,99,235,.55)'; ctx.lineWidth = 1 / view.zoom;
        if (list.length > 1) list.forEach(ob => { const b = bbox(ob); if (b) ctx.strokeRect(b.x - pad / 2, b.y - pad / 2, b.w + pad, b.h + pad); });
        const b = selBounds();
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5 / view.zoom;
        ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        ctx.setLineDash([]);
        const h = handleRect(b);
        ctx.fillStyle = '#fff';
        ctx.fillRect(h.x, h.y, h.s, h.s); ctx.strokeRect(h.x, h.y, h.s, h.s);
      }
      ctx.restore();
    }

    function drawLasers() {
      const now = Date.now();
      lasers = lasers.filter(l => now - l.last < 1400);
      if (!lasers.length) return false;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      lasers.forEach(l => {
        const pts = l.pts.filter(p => now - p[2] < 900);
        for (let i = 1; i < pts.length; i++) {
          const age = (now - pts[i][2]) / 900;
          ctx.strokeStyle = `rgba(239,68,68,${(1 - age).toFixed(2)})`;
          ctx.shadowColor = 'rgba(239,68,68,.8)'; ctx.shadowBlur = 12 / view.zoom;
          ctx.lineWidth = 6 / view.zoom;
          ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
        }
        const tip = l.pts[l.pts.length - 1];
        if (tip && now - tip[2] < 900) {
          ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(tip[0], tip[1], 7 / view.zoom, 0, Math.PI * 2); ctx.fill();
        }
      });
      ctx.restore();
      return true;
    }

    function scheduleDraw() { if (!raf && !destroyed) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

    /* ============================ geometri ============================ */
    function bbox(ob) {
      if (ob.kind === 'stroke') {
        const pts = ob.pts || [];
        if (!pts.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
        const pad = (Number(ob.width) || 3) * ((INK[ob.tool] || INK.pen).k) * (ob.bold ? 1.8 : 1);
        return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
      }
      if (ob.kind === 'shape') {
        const pad = (Number(ob.width) || 3) * 2;
        return { x: Math.min(ob.x1, ob.x2) - pad, y: Math.min(ob.y1, ob.y2) - pad, w: Math.abs(ob.x2 - ob.x1) + pad * 2, h: Math.abs(ob.y2 - ob.y1) + pad * 2 };
      }
      if (ob.kind === 'text') { const m = textMetrics(ob); return { x: ob.x, y: ob.y, w: m.w, h: m.h }; }
      return { x: ob.x, y: ob.y, w: ob.w, h: ob.h };
    }
    function distSeg(px, py, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / ((dx * dx + dy * dy) || 1), 0, 1);
      return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
    }
    function hit(ob, p) {
      const b = bbox(ob);
      const tol = 8 / view.zoom;
      if (!b || p.x < b.x - tol || p.y < b.y - tol || p.x > b.x + b.w + tol || p.y > b.y + b.h + tol) return false;
      if (ob.kind === 'stroke') {
        if (ob.tool === 'eraser') return false;
        const w = (Number(ob.width) || 3) * ((INK[ob.tool] || INK.pen).k) / 2 + tol;
        const pts = ob.pts;
        if (pts.length === 1) return Math.hypot(p.x - pts[0][0], p.y - pts[0][1]) <= w;
        for (let i = 1; i < pts.length; i++) if (distSeg(p.x, p.y, pts[i - 1], pts[i]) <= w) return true;
        return false;
      }
      if (ob.kind === 'shape' && (ob.shape === 'line' || ob.shape === 'arrow')) {
        return distSeg(p.x, p.y, [ob.x1, ob.y1], [ob.x2, ob.y2]) <= (Number(ob.width) || 3) + tol;
      }
      return true;
    }
    function topHit(p) {
      for (let i = objects.length - 1; i >= 0; i--) if (hit(objects[i], p)) return objects[i];
      return null;
    }
    function translate(ob, dx, dy) {
      if (ob.kind === 'stroke') ob.pts = ob.pts.map(q => [r1(q[0] + dx), r1(q[1] + dy), q[2]]);
      else if (ob.kind === 'shape') { ob.x1 += dx; ob.x2 += dx; ob.y1 += dy; ob.y2 += dy; }
      else { ob.x += dx; ob.y += dy; }
    }
    /** Skala terhadap titik `from` (pojok kiri atas pilihan) — posisi ikut berskala agar kelompok tetap utuh. */
    function scale(ob, from, sx, sy) {
      const X = (x) => from.x + (x - from.x) * sx, Y = (y) => from.y + (y - from.y) * sy;
      if (ob.kind === 'stroke') ob.pts = ob.pts.map(q => [r1(X(q[0])), r1(Y(q[1])), q[2]]);
      else if (ob.kind === 'shape') { ob.x1 = X(ob.x1); ob.x2 = X(ob.x2); ob.y1 = Y(ob.y1); ob.y2 = Y(ob.y2); }
      else if (ob.kind === 'text') {
        ob.x = r1(X(ob.x)); ob.y = r1(Y(ob.y));
        ob.size = clamp(Math.round((Number(ob.size) || 32) * Math.max(sx, sy)), 8, 400);
      } else { ob.x = r1(X(ob.x)); ob.y = r1(Y(ob.y)); ob.w = Math.max(20, ob.w * sx); ob.h = Math.max(20, ob.h * sy); }
    }

    /* ============================ perubahan & undo ============================ */
    function touch(ob) { ob.updatedAt = Date.now(); return ob; }
    /* Objek yang dipulihkan mendapat id baru; alias mencatat id lama → baru
     * agar aksi undo/redo sebelumnya tetap menunjuk objek yang benar. */
    const alias = new Map();
    function resolve(id) {
      let cur = id, guard = 0;
      while (alias.has(cur) && guard++ < 500) cur = alias.get(cur);
      return cur;
    }
    function freshCopy(ob) {
      const c = clone(ob); c.id = rid(); c.createdAt = Date.now(); delete c.updatedAt;
      if (ob.id) alias.set(ob.id, c.id);
      return c;
    }
    function addObjs(list) { list.forEach(ob => objects.push(ob)); }
    function removeIds(ids) {
      ids = ids.map(resolve);
      const set = new Set(ids);
      const gone = objects.filter(ob => set.has(ob.id));
      objects = objects.filter(ob => !set.has(ob.id));
      ids.forEach(id => { deletedIds.add(id); selected.delete(id); });
      return gone;
    }
    function replaceObj(next) {
      next = Object.assign(clone(next), { id: resolve(next.id) });
      const i = objects.findIndex(x => x.id === next.id);
      if (i >= 0) objects[i] = touch(clone(next));
      return i >= 0;
    }
    /** Setiap aksi menyimpan cara membatalkan & mengulang; objek yang
     *  dipulihkan mendapat id baru agar tidak bentrok dengan tombstone di tab lain. */
    function pushAction(action) { undoStack.push(action); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; commit(); }
    function actAdd(list) {
      addObjs(list);
      let ids = list.map(x => x.id), snapshot = clone(list);
      pushAction({
        undo() { const live = ids.map(resolve); snapshot = clone(objects.filter(x => live.includes(x.id))); if (snapshot.length) removeIds(live); },
        redo() { const copies = snapshot.map(freshCopy); ids = copies.map(x => x.id); addObjs(copies); }
      });
    }
    function actRemove(ids) {
      let gone = clone(removeIds(ids));
      let restoredIds = [];
      if (!gone.length) return;
      pushAction({
        undo() { const copies = gone.map(freshCopy); restoredIds = copies.map(x => x.id); addObjs(copies); },
        redo() { const live = restoredIds.map(resolve); gone = clone(objects.filter(x => live.includes(x.id))); removeIds(live); }
      });
    }
    function actUpdate(before, after) { actUpdateMany([before], [after]); }
    /** Satu langkah undo untuk banyak objek sekaligus (pindah/ubah ukuran/kelompok). */
    function actUpdateMany(befores, afters) {
      if (!befores.length) return;
      pushAction({
        undo() { befores.forEach(replaceObj); },
        redo() { afters.forEach(replaceObj); }
      });
    }
    function actClear() {
      const gone = clone(objects);
      const prevEpoch = clearEpoch;
      let restoredIds = [];
      doClear();
      pushAction({
        undo() { const copies = gone.map(freshCopy); restoredIds = copies.map(x => x.id); addObjs(copies); },
        redo() { removeIds(restoredIds); clearEpoch = Math.max(prevEpoch, Date.now()); }
      });
    }
    function doClear() {
      objects.forEach(ob => deletedIds.add(ob.id));
      objects = []; selected = new Set(); clearEpoch = Date.now();
    }
    function undo() {
      if (!guard() || !undoStack.length) return;
      const a = undoStack.pop(); a.undo(); redoStack.push(a); commit();
    }
    function redo() {
      if (!guard() || !redoStack.length) return;
      const a = redoStack.pop(); a.redo(); undoStack.push(a); commit();
    }
    function commit() { inkDirty = true; editsSinceVersion++; markDirty(); scheduleDraw(); updateButtons(); }
    function guard() {
      if (!editable || !DB.canEditWhiteboard(user, DB.getCourse(course.id))) { UI.toast('Anda tidak boleh mengubah whiteboard ini.', 'error'); return false; }
      return true;
    }

    /* ============================ simpan & sinkron ============================ */
    function markDirty() {
      dirty = true; setStatus('Menyimpan…', 'is-saving');
      if (!saveTimer) saveTimer = setTimeout(flush, Math.max(0, 1000 - (Date.now() - lastSave)));
    }

    function reconcile(remote) {
      if (!remote || remote.id !== boardId || remote.origin === origin) return;
      clearEpoch = Math.max(clearEpoch, Number(remote.clearEpoch) || 0);
      const known = new Set(media.map(m => m.key));
      (remote.media || []).forEach(m => { if (m && m.key && !known.has(m.key)) { media.push(m); known.add(m.key); } });
      if (remote.thumb) thumb = remote.thumb;
      (remote.deletedIds || []).forEach(id => deletedIds.add(id));
      if ((Number(remote.pagesUpdatedAt) || 0) > pagesUpdatedAt && Array.isArray(remote.pages) && remote.pages.length) {
        pages = clone(remote.pages);
        pageData = clone(remote.pageData || {});
        activePage = pages.some(pg => pg.id === remote.activePage) ? remote.activePage : pages[0].id;
        pagesUpdatedAt = Number(remote.pagesUpdatedAt) || 0;
        pagesDirty = true;
      }
      const incoming = migrate({ strokes: remote.strokes || [], board: remote.board || board });
      if (remote.board && (Number(remote.board.updatedAt) || 0) > (Number(board.updatedAt) || 0)) {
        board = pageBoard(board, remote.board);
      }
      const map = new Map();
      objects.concat(incoming.objects).forEach(ob => {
        if (!ob || !ob.id || deletedIds.has(ob.id) || (Number(ob.createdAt) || 0) < clearEpoch) return;
        const prev = map.get(ob.id);
        if (!prev || stamp(ob) > stamp(prev)) map.set(ob.id, ob);
      });
      objects = Array.from(map.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      selected.forEach(id => { if (!map.has(id)) selected.delete(id); });
      record = Object.assign({}, record, {
        revision: Math.max(Number(record.revision) || 0, Number(remote.revision) || 0),
        updatedAt: Math.max(Number(record.updatedAt) || 0, Number(remote.updatedAt) || 0)
      });
      inkDirty = true;
    }

    function snapshotState() {
      return {
        strokes: clone(objects), board: clone(board), schemaVersion: 2,
        pages: clone(pages), pageData: clone(pageData), activePage, pagesUpdatedAt,
        media: clone(media), thumb: thumb || null,
        // Tombstone dipangkas agar data tidak tumbuh tanpa batas.
        deletedIds: Array.from(deletedIds).slice(-3000), clearEpoch, revision: record.revision || 0
      };
    }

    function flush() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty || destroyed) return;
      try {
        const latest = DB.getWhiteboardBoard(boardId);
        if (latest && (latest.revision || 0) > (record.revision || 0)) {
          reconcile(Object.assign({ origin: 'storage-latest' }, latest));
        }
        makeThumb();
        record = DB.saveWhiteboard(boardId, snapshotState(), user);
        lastSave = Date.now(); dirty = false;
        setStatus('Tersimpan sekarang', 'is-saved');
        broadcast({ type: 'state' });
        autoVersion();
      } catch (e) {
        setStatus('Gagal menyimpan', 'is-error');
        UI.toast(/quota/i.test(String(e && e.name) + e.message)
          ? 'Penyimpanan browser penuh. Hapus gambar besar atau versi lama di menu 🗂️.'
          : (e.message || 'Whiteboard gagal disimpan.'), 'error');
      }
    }

    /** Versi otomatis tiap ≥5 menit bila ada perubahan berarti. */
    function autoVersion() {
      if (!editable || editsSinceVersion < 5 || Date.now() - lastVersionAt < 5 * 60 * 1000 || !objects.length) return;
      try {
        DB.addWhiteboardSave(course.id, { type: 'version', auto: true, boardId, name: 'Versi otomatis ' + UI.fmtDateTime(Date.now()), objects, board }, user);
        lastVersionAt = Date.now(); editsSinceVersion = 0;
      } catch (e) { /* versi otomatis bersifat best-effort */ }
    }

    /** Gambar mini halaman pertama untuk daftar papan (≤320 px, JPEG ±10 KB), paling sering tiap 15 detik. */
    function makeThumb(force) {
      if (!editable || (!force && Date.now() - thumbAt < 15000)) return;
      thumbAt = Date.now();
      try {
        const first = pages[0] && pages[0].id !== activePage ? (pageData[pages[0].id] || { objects: [], board: null }) : { objects, board };
        const brd = first.board === board ? board : pageBoard(board, first.board);
        const out = renderPageCanvas(first.objects || [], brd, '', null, null, 320);
        const url = out.toDataURL('image/jpeg', 0.62);
        if (url.length < 58000) thumb = url;
      } catch (e) { /* gambar mini bersifat opsional */ }
    }

    function broadcast(extra) {
      if (!channel) return;
      try {
        if (extra.type === 'laser') { channel.postMessage(Object.assign({ origin, id: boardId }, extra)); return; }
        channel.postMessage(Object.assign({ origin, revision: record.revision, updatedAt: record.updatedAt },
          snapshotState(), extra, { id: boardId }));
      } catch (e) { /* kanal tertutup */ }
    }

    function mergeRemote(remote) {
      if (!remote || remote.id !== boardId || remote.origin === origin) return;
      if (!editable && remote.type !== 'laser') { viewerLoad(remote); return; }
      if (remote.type === 'laser') {
        let l = lasers.find(x => x.from === remote.origin && x.stroke === remote.stroke);
        if (!l) { l = { from: remote.origin, stroke: remote.stroke, pts: [], last: 0 }; lasers.push(l); }
        const now = Date.now();
        (remote.pts || []).forEach(p => l.pts.push([p[0], p[1], now]));
        l.last = now; scheduleDraw();
        return;
      }
      if (current || drag) {
        if (!pendingRemote || (remote.revision || 0) >= (pendingRemote.revision || 0)) pendingRemote = remote;
        return;
      }
      reconcile(remote);
      scheduleDraw(); updateButtons(); setStatus('Tersinkron sekarang', 'is-saved');
      if (pagesDirty) { pagesDirty = false; paintPages(); }
    }

    function onStorage(e) {
      if (e.key !== 'lms_whiteboards') return;
      const fresh = DB.getWhiteboardBoard(boardId);
      if (fresh) mergeRemote(Object.assign({ origin: 'storage' }, fresh));
    }
    /* Perubahan dari perangkat lain (sinkron server) tiba lewat lms:remote-change. */
    function onRemote(e) {
      const keys = (e.detail && e.detail.keys) || [];
      if (!keys.includes('lms_whiteboards')) return;
      const fresh = DB.getWhiteboardBoard(boardId);
      if (fresh && (fresh.revision || 0) > (record.revision || 0)) mergeRemote(Object.assign({ origin: 'server' }, fresh));
    }

    /* Penonton: isi kanvas selalu diturunkan ulang dari rekaman terbaru (tidak pernah disimpan). */
    function viewerLoad(rec) {
      record = Object.assign({}, record, rec);
      pages = Array.isArray(rec.pages) && rec.pages.length ? clone(rec.pages) : [{ id: 'pg_1', name: 'Halaman 1' }];
      pageData = clone(rec.pageData || {});
      activePage = pages.some(pg => pg.id === rec.activePage) ? rec.activePage : pages[0].id;
      if (follow || !pages.some(pg => pg.id === viewPage)) viewPage = activePage;
      const cur = migrate(rec);
      if (viewPage === activePage) { board = cur.board; objects = cur.objects; }
      else {
        const pd = pageData[viewPage] || {};
        board = pageBoard(cur.board, pd.board);
        objects = (pd.objects || []).slice();
      }
      inkDirty = true;
      if (!userView) fit(); else scheduleDraw();
      if (rec.updatedAt) setStatus('Diperbarui ' + UI.fmtRelative(rec.updatedAt), 'is-saved');
      paintPages();
    }

    function drainPending() {
      if (pendingRemote) { const q = pendingRemote; pendingRemote = null; reconcile(q); if (pagesDirty) { pagesDirty = false; paintPages(); } }
    }

    function updateButtons() {
      if (!editable) return;
      const u = container.querySelector('#wbUndo'), r = container.querySelector('#wbRedo'), d = container.querySelector('#wbDelSel');
      if (u) u.disabled = !undoStack.length;
      if (r) r.disabled = !redoStack.length;
      if (d) d.disabled = !selected.size;
      const g = container.querySelector('#wbGroup'), ug = container.querySelector('#wbUngroup');
      const list = selectedObjs();
      const grouped = list.some(ob => ob.groupId);
      const oneGroup = grouped && new Set(list.map(ob => ob.groupId || '')).size === 1;
      if (g) g.hidden = !(list.length > 1 && !oneGroup);
      if (ug) ug.hidden = !grouped;
    }

    /* ============================ pointer ============================ */
    let lastPt = null;
    function capture(e) { try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer sudah dilepas */ } }
    function pressureOf(e, p) {
      if (st.pressure && e.pointerType === 'pen' && e.pressure > 0) return Math.round(e.pressure * 100) / 100;
      if (st.tool === 'brush' && lastPt) {
        // Kuas tanpa stylus: makin cepat makin tipis.
        const sp = Math.hypot(p.x - lastPt.x, p.y - lastPt.y) / Math.max(1, (e.timeStamp - lastPt.t) || 1);
        return Math.round(clamp(1 - sp * 0.5, 0.2, 1) * 100) / 100;
      }
      return 0.5;
    }

    function pointerDown(e) {
      if (e.button > 1) return;
      canvas.focus({ preventScroll: true });
      const p = toWorld(e);
      const panning = e.button === 1 || spaceDown || st.tool === 'hand' || !editable;
      if (panning) {
        drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: view.panX, py: view.panY };
        capture(e); canvas.classList.add('is-panning');
        return;
      }
      if (textEditor) { commitText(); return; }
      if (!guard()) return;
      e.preventDefault();
      capture(e);
      lastPt = { x: p.x, y: p.y, t: e.timeStamp };
      const t = st.tool;
      if (t === 'select') {
        const sb = selected.size ? selBounds() : null;
        if (sb) {
          const h = handleRect(sb), tol = 7 / view.zoom;
          if (p.x >= h.x - tol && p.x <= h.x + h.s + tol && p.y >= h.y - tol && p.y <= h.y + h.s + tol) {
            drag = { mode: 'resize', before: clone(selectedObjs()), from: { x: sb.x, y: sb.y }, bw: sb.w, bh: sb.h, moved: false };
            return;
          }
        }
        const target = topHit(p);
        if (!target) {
          // Seret di area kosong = blok (marquee); Shift menambah ke pilihan.
          if (!e.shiftKey) selected = new Set();
          drag = { mode: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: new Set(selected) };
          updateButtons(); scheduleDraw();
          return;
        }
        const ids = withGroups(new Set([target.id]));
        if (e.shiftKey) {
          const all = [...ids].every(id => selected.has(id));
          ids.forEach(id => (all ? selected.delete(id) : selected.add(id)));
        } else if (!selected.has(target.id)) selected = ids;
        updateButtons(); scheduleDraw();
        if (selected.has(target.id)) drag = { mode: 'move', before: clone(selectedObjs()), sx: p.x, sy: p.y, moved: false };
        return;
      }
      if (t === 'eraser' && st.eraser === 'object') {
        const target = topHit(p);
        if (target) actRemove([target.id]);
        drag = { mode: 'erase-object' };
        return;
      }
      if (t === 'laser') {
        current = null;
        drag = { mode: 'laser', stroke: rid() };
        lasers.push({ from: origin, stroke: drag.stroke, pts: [[p.x, p.y, Date.now()]], last: Date.now() });
        scheduleDraw();
        return;
      }
      if (t === 'text') { openTextEditor({ x: p.x, y: p.y }); return; }
      if (t === 'shape') {
        current = { id: rid(), kind: 'shape', shape: st.shape, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: st.color,
          width: st.width, opacity: st.opacity, dash: st.dash, bold: st.bold, fill: st.fill, createdAt: Date.now() };
        return;
      }
      if (INK_TOOLS.includes(t)) {
        current = { id: rid(), kind: 'stroke', tool: t, color: st.color, width: st.width, opacity: st.opacity,
          dash: st.dash, bold: st.bold, pressure: !!st.pressure, createdAt: Date.now(), pts: [[r1(p.x), r1(p.y), pressureOf(e, p)]] };
        scheduleDraw();
      }
    }

    function pointerMove(e) {
      if (!drag && !current) return;
      if (drag && drag.mode === 'pan') {
        view.panX = drag.px + (e.clientX - drag.sx); view.panY = drag.py + (e.clientY - drag.sy);
        userView = true; viewChanged(); return;
      }
      e.preventDefault();
      let evs = (e.getCoalescedEvents && current && current.kind === 'stroke') ? e.getCoalescedEvents() : [e];
      if (!evs || !evs.length) evs = [e];   // event sintetis/browser lama tidak punya coalesced events
      if (drag && drag.mode === 'laser') {
        const p = toWorld(e);
        const l = lasers.find(x => x.stroke === drag.stroke);
        if (l) { l.pts.push([p.x, p.y, Date.now()]); l.last = Date.now(); if (l.pts.length > 120) l.pts.shift(); }
        const now = Date.now();
        if (now - laserSend > 40) { laserSend = now; broadcast({ type: 'laser', stroke: drag.stroke, pts: [[p.x, p.y]] }); }
        scheduleDraw(); return;
      }
      if (drag && drag.mode === 'erase-object') {
        const target = topHit(toWorld(e));
        if (target) actRemove([target.id]);
        return;
      }
      if (drag && drag.mode === 'marquee') {
        const p = toWorld(e);
        drag.x1 = p.x; drag.y1 = p.y;
        const r = marqueeRect(drag);
        const ids = new Set(drag.base);
        objects.forEach(ob => {
          const b = bbox(ob);
          if (b && !(ob.kind === 'stroke' && ob.tool === 'eraser') && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y) ids.add(ob.id);
        });
        selected = withGroups(ids);
        scheduleDraw(); return;
      }
      if (drag && (drag.mode === 'move' || drag.mode === 'resize')) {
        const p = toWorld(e);
        let sx = 1, sy = 1;
        if (drag.mode === 'resize') {
          sx = Math.max(0.05, (p.x - drag.from.x) / Math.max(1, drag.bw));
          sy = Math.max(0.05, (p.y - drag.from.y) / Math.max(1, drag.bh));
          // Gambar, teks, tabel, dan pilihan banyak objek berskala seragam agar tidak penyok; Shift = bebas.
          const uniform = drag.before.length > 1 || drag.before.some(ob => ['image', 'text', 'table'].includes(ob.kind));
          if (uniform !== !!e.shiftKey) { const s = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; sx = s; sy = s; }
        }
        drag.before.forEach(b0 => {
          const ob = objects.find(x => x.id === resolve(b0.id));
          if (!ob) return;
          const fresh = clone(b0);
          fresh.id = ob.id;
          if (drag.mode === 'move') translate(fresh, p.x - drag.sx, p.y - drag.sy);
          else scale(fresh, drag.from, sx, sy);
          Object.assign(ob, fresh);
        });
        drag.moved = drag.moved || drag.mode === 'resize' || Math.hypot(p.x - drag.sx, p.y - drag.sy) > 0.5 / view.zoom;
        inkDirty = true; scheduleDraw(); return;
      }
      if (!current) return;
      if (current.kind === 'shape') {
        const p = toWorld(e);
        current.x2 = p.x; current.y2 = p.y;
        if (e.shiftKey && current.shape !== 'line' && current.shape !== 'arrow') {
          const s = Math.max(Math.abs(p.x - current.x1), Math.abs(p.y - current.y1));
          current.x2 = current.x1 + Math.sign(p.x - current.x1 || 1) * s; current.y2 = current.y1 + Math.sign(p.y - current.y1 || 1) * s;
        }
        scheduleDraw(); return;
      }
      evs.forEach(ev => {
        const p = toWorld(ev);
        const last = current.pts[current.pts.length - 1];
        // Buang titik yang terlalu rapat: data ringkas tanpa mengurangi ketajaman.
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.8 / view.zoom) return;
        current.pts.push([r1(p.x), r1(p.y), pressureOf(ev, p)]);
        lastPt = { x: p.x, y: p.y, t: ev.timeStamp };
      });
      scheduleDraw();
    }

    function pointerUp(e) {
      canvas.classList.remove('is-panning');
      if (drag) {
        const d = drag; drag = null;
        if ((d.mode === 'move' || d.mode === 'resize') && d.moved) {
          const befores = [], afters = [];
          d.before.forEach(b0 => {
            const ob = objects.find(x => x.id === resolve(b0.id));
            if (ob) { touch(ob); befores.push(Object.assign(clone(b0), { id: ob.id })); afters.push(clone(ob)); }
          });
          actUpdateMany(befores, afters);
        }
        if (d.mode === 'marquee' && selected.size > 1) flashHint(`${selected.size} objek dipilih — seret untuk memindahkan, Ctrl+G untuk mengelompokkan`);
        drainPending(); scheduleDraw(); updateButtons();
        if (d.mode !== 'pan' && d.mode !== 'laser' && d.mode !== 'marquee') flush();
        return;
      }
      if (!current) return;
      const done = current; current = null;
      drainPending();
      if (done.kind === 'shape' && Math.hypot(done.x2 - done.x1, done.y2 - done.y1) < 3) { scheduleDraw(); return; }
      if (!deletedIds.has(done.id) && done.createdAt >= clearEpoch) actAdd([done]);
      flush();
    }

    /* ============================ teks & tabel ============================ */
    function openTextEditor(at, existing, cell) {
      closeTextEditor();
      const ta = document.createElement('textarea');
      ta.className = 'wb-text-input';
      ta.setAttribute('aria-label', cell ? 'Isi sel tabel' : 'Teks whiteboard');
      ta.value = existing ? (cell ? ((existing.cells[cell.r] || [])[cell.c] || '') : existing.text) : '';
      stage.appendChild(ta);
      textEditor = { el: ta, at, existing, cell };
      placeTextEditor();
      setTimeout(() => ta.focus(), 0);
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); closeTextEditor(); }
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || cell)) { ev.preventDefault(); commitText(); }
      });
      ta.addEventListener('blur', () => setTimeout(() => { if (textEditor && textEditor.el === ta) commitText(); }, 120));
    }
    function placeTextEditor() {
      if (!textEditor) return;
      const { el, at, existing, cell } = textEditor;
      let x = at.x, y = at.y, size = st.textSize, w = 260;
      if (existing && cell) {
        const cw = existing.w / existing.cols, ch = existing.h / existing.rows;
        x = existing.x + cell.c * cw; y = existing.y + cell.r * ch; size = clamp(Math.min(ch * 0.42, existing.size || 22), 8, 64); w = cw;
      } else if (existing) { x = existing.x; y = existing.y; size = existing.size; }
      el.style.left = (view.panX + x * view.zoom) + 'px';
      el.style.top = (view.panY + y * view.zoom) + 'px';
      el.style.fontSize = Math.max(10, size * view.zoom) + 'px';
      el.style.minWidth = Math.max(120, w * view.zoom) + 'px';
      el.style.color = existing ? (existing.color || st.color) : st.color;
      el.style.fontFamily = fontCss(existing ? existing.font : st.font);
      el.style.fontWeight = (existing ? existing.bold : st.bold) ? 700 : 400;
    }
    function closeTextEditor() {
      if (!textEditor) return;
      const el = textEditor.el; textEditor = null;
      const hadFocus = document.activeElement === el;
      el.remove();
      // Fokus kembali ke kanvas agar pintasan (V, P, Ctrl+Z, …) tetap berfungsi setelah mengetik.
      if (hadFocus && card.isConnected) canvas.focus({ preventScroll: true });
    }
    function commitText() {
      if (!textEditor) return;
      const { el, at, existing, cell } = textEditor;
      const text = el.value.replace(/\s+$/, '').slice(0, 2000);
      closeTextEditor();
      if (!guard()) return;
      if (existing && cell) {
        const before = clone(existing);
        const after = clone(existing);
        after.cells = (after.cells || []).map(r => r.slice());
        after.cells[cell.r][cell.c] = text.slice(0, 200);
        if (replaceObj(after)) actUpdate(before, clone(objects.find(x => x.id === after.id)));
      } else if (existing) {
        if (!text) { actRemove([existing.id]); }
        else {
          const before = clone(existing); const after = Object.assign(clone(existing), { text });
          if (replaceObj(after)) actUpdate(before, clone(objects.find(x => x.id === after.id)));
        }
      } else if (text) {
        actAdd([{ id: rid(), kind: 'text', x: r1(at.x), y: r1(at.y), text, size: st.textSize, font: st.font,
          color: st.color, bold: st.bold, opacity: st.opacity, createdAt: Date.now() }]);
      }
      flush();
    }

    function centerWorld() {
      return { x: (stage.clientWidth / 2 - view.panX) / view.zoom, y: (stage.clientHeight / 2 - view.panY) / view.zoom };
    }

    function insertTable(rows, cols) {
      if (!guard()) return;
      const c = centerWorld();
      const w = Math.min(board.w * 0.8, cols * 180), h = Math.min(board.h * 0.8, rows * 56);
      actAdd([{ id: rid(), kind: 'table', x: r1(c.x - w / 2), y: r1(c.y - h / 2), w, h, rows, cols,
        cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
        color: st.color, width: 2, size: 22, font: st.font, createdAt: Date.now() }]);
      st.tool = 'select'; syncTools(); setSelection([objects[objects.length - 1].id]); flush();
      flashHint('Klik dua kali pada sel untuk mengisi tabel.');
    }

    /* ============================ berkas PDF & gambar ============================
     * Berkas tidak disimpan di dalam rekaman papan (data URL membuat tiap sinkron berat),
     * melainkan sebagai berkas "wb:<kelas>:<papan>:<id>" di BlobStore (server + cache IndexedDB).
     * Batas: tiap halaman/gambar ≤ 900 KB setelah dikompres, total 8 MB per kelas
     * (juga ditegakkan server), berkas masukan ≤ 10 MB, ≤ 15 halaman PDF per impor. */
    const FILE_MAX = 900 * 1024, INPUT_MAX = 10 * 1024 * 1024, IMPORT_PAGES = 15, PAGE_SIDE = 1600;
    const fmtMB = (n) => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
    const sumBytes = (list) => (list || []).reduce((m, x) => m + (Number(x.bytes) || 0), 0);
    function mediaUsed() {
      return DB.getCourseBoards(course.id).filter(b => b.id !== boardId).reduce((n, b) => n + sumBytes(b.media), 0) + sumBytes(media);
    }
    function fileToImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`"${file.name}" bukan gambar yang dapat dibaca.`)); };
        img.src = url;
      });
    }
    function imageToCanvas(img, maxSide) {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
      cv.height = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return cv;
    }
    const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
    /** Kanvas → berkas ≤ FILE_MAX: PNG bila cukup kecil (menjaga transparansi), selain itu JPEG bermutu menurun lalu diperkecil. */
    async function compress(cv, keepPng) {
      if (keepPng) { const png = await toBlob(cv, 'image/png'); if (png && png.size <= FILE_MAX) return png; }
      let c = cv, q = 0.82;
      for (let i = 0; i < 10; i++) {
        if (keepPng && i === 0) { const flat = document.createElement('canvas'); flat.width = c.width; flat.height = c.height;
          const fc = flat.getContext('2d'); fc.fillStyle = '#ffffff'; fc.fillRect(0, 0, flat.width, flat.height); fc.drawImage(c, 0, 0); c = flat; }
        const b = await toBlob(c, 'image/jpeg', q);
        if (b && b.size <= FILE_MAX) return b;
        if (q > 0.56) q -= 0.08;
        else { const s = document.createElement('canvas'); s.width = Math.round(c.width * 0.8); s.height = Math.round(c.height * 0.8); s.getContext('2d').drawImage(c, 0, 0, s.width, s.height); c = s; }
      }
      throw new Error('Gambar terlalu rumit untuk dikompres di bawah 900 KB.');
    }
    async function storeMedia(blob) {
      if (!global.BlobStore || !BlobStore.available()) throw new Error('Browser ini tidak dapat menyimpan berkas (IndexedDB tidak tersedia).');
      const left = DB.WB_MEDIA_LIMIT - mediaUsed();
      if (blob.size > left) throw new Error(`Ruang berkas whiteboard kelas ini tersisa ${fmtMB(Math.max(0, left))} dari ${fmtMB(DB.WB_MEDIA_LIMIT)}. Hapus papan berisi PDF/gambar lama terlebih dahulu.`);
      const key = `wb:${course.id}:${boardId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      await BlobStore.put(key, blob, { courseId: course.id, boardId });
      media.push({ key, bytes: blob.size, at: Date.now() });
      return key;
    }

    /** Hapus berkas yang tidak lagi dipakai halaman mana pun maupun salinan/versi papan ini (membebaskan kuota kelas). */
    function pruneMedia() {
      if (!editable || !media.length) return;
      const used = new Set();
      const scan = (objs, brd) => {
        if (brd && brd.bgImage && brd.bgImage.blob) used.add(brd.bgImage.blob);
        (objs || []).forEach(ob => { if (ob && ob.blob) used.add(ob.blob); });
      };
      scan(objects, board);
      Object.values(pageData).forEach(pd => scan(pd && pd.objects, pd && pd.board));
      DB.getWhiteboardSaves(course.id, null, boardId).forEach(s => scan(s.objects, s.board));
      const drop = media.filter(m => !used.has(m.key));
      if (!drop.length) return;
      media = media.filter(m => used.has(m.key));
      dirty = true; flush();
      drop.forEach(m => { if (global.BlobStore) BlobStore.remove(m.key).catch(() => {}); });
    }

    /** Sisipkan gambar sebagai objek yang dapat dipindah & diubah ukurannya (alat Pilih). `nth` menggeser posisi bila banyak. */
    async function insertImage(file, nth) {
      if (!guard() || !file) return;
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) { UI.toast('Gunakan gambar PNG, JPG, WEBP, atau GIF.', 'error'); return; }
      if (file.size > INPUT_MAX) { UI.toast(`Gambar maksimal ${fmtMB(INPUT_MAX)}.`, 'error'); return; }
      try {
        setStatus('Mengunggah gambar…', 'is-saving');
        const img = await fileToImage(file);
        const cv = imageToCanvas(img, PAGE_SIDE);
        const key = await storeMedia(await compress(cv, /png|gif|webp/i.test(file.type)));
        const vis = visibleRect();
        const w = Math.min(board.w * 0.6, vis.w * 0.7, cv.width), h = w * (cv.height / cv.width);
        const c = centerWorld(), off = (nth || 0) * 28;
        actAdd([{ id: rid(), kind: 'image', x: r1(c.x - w / 2 + off), y: r1(c.y - h / 2 + off), w, h, blob: key, createdAt: Date.now() }]);
        st.tool = 'select'; syncTools(); setSelection([objects[objects.length - 1].id]); flush();
        flashHint('Gambar dapat diseret untuk dipindah; tarik pojok kanan bawah untuk mengubah ukuran.');
      } catch (err) {
        setStatus('Gagal mengunggah gambar', 'is-error');
        UI.toast(err.message || 'Gagal membaca gambar.', 'error');
      }
    }

    /** Halaman baru berlatar berkas impor. Halaman pertama yang masih kosong dipakai ulang. */
    function addBgPage(key, w, h, name) {
      const brd = { w, h, bg: '#ffffff', template: 'plain', bgImage: { blob: key, w, h } };
      const cur = pages[pageIndex()];
      if (pages.length === 1 && !objects.length && !board.bgImage) {
        board = Object.assign({}, board, brd, { updatedAt: Date.now() });
        cur.name = name;
        return cur.id;
      }
      const id = 'pg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const after = pages.findIndex(pg => pg.id === (addBgPage.last || activePage));
      pages.splice(after + 1, 0, { id, name });
      pageData[id] = { objects: [], board: brd };
      addBgPage.last = id;
      return id;
    }
    async function importPdf(file, room) {
      if (!global.DocImport || !DocImport.loadPdfjs) throw new Error('Pembaca PDF belum dimuat. Muat ulang halaman lalu coba lagi.');
      const pdfjs = await DocImport.loadPdfjs();
      let doc;
      try { doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
      catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'PDF dikunci kata sandi. Buka kuncinya terlebih dahulu.' : `"${file.name}" tidak dapat dibaca sebagai PDF.`); }
      const n = Math.min(doc.numPages, room);
      if (doc.numPages > n) UI.toast(`Diimpor ${n} dari ${doc.numPages} halaman "${file.name}" (maks. ${IMPORT_PAGES} halaman sekali impor, ${MAX_PAGES} halaman per papan).`, 'info');
      const base = file.name.replace(/\.pdf$/i, '').slice(0, 40);
      const first = [];
      try {
        for (let p = 1; p <= n; p++) {
          setStatus(`Mengimpor halaman ${p}/${n}…`, 'is-saving');
          const page = await doc.getPage(p);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: PAGE_SIDE / Math.max(v1.width, v1.height) });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          const c = cv.getContext('2d');
          c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: c, viewport: vp }).promise;
          page.cleanup();
          const key = await storeMedia(await compress(cv, false));
          first.push(addBgPage(key, cv.width, cv.height, n > 1 ? `${base} • ${p}` : base));
        }
      } finally { doc.destroy(); }
      return first;
    }
    /**
     * Impor berkas: tiap halaman PDF menjadi halaman papan (ukuran asli, tidak diregangkan);
     * gambar disisipkan di halaman ini sebagai objek yang dapat dipindah & diubah ukurannya.
     */
    async function importFiles(files) {
      if (!guard()) return;
      const all = Array.from(files || []).filter(Boolean);
      if (!all.length) return;
      const big = all.find(f => f.size > INPUT_MAX);
      if (big) { UI.toast(`"${big.name}" lebih dari ${fmtMB(INPUT_MAX)}. Perkecil atau pisahkan berkasnya terlebih dahulu.`, 'error'); return; }
      const isPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
      const bad = all.find(f => !isPdf(f) && !/^image\/(png|jpe?g|webp|gif)$/i.test(f.type));
      if (bad) { UI.toast(`"${bad.name}" bukan PDF atau gambar PNG/JPG/WEBP.`, 'error'); return; }
      if (textEditor) commitText();
      const imgs = all.filter(f => !isPdf(f));
      for (let i = 0; i < imgs.length; i++) await insertImage(imgs[i], i);
      const list = all.filter(isPdf);
      if (!list.length) return;
      const room0 = Math.min(IMPORT_PAGES, MAX_PAGES - pages.length + (pages.length === 1 && !objects.length && !board.bgImage ? 1 : 0));
      if (room0 <= 0) { UI.toast(`Papan ini sudah ${MAX_PAGES} halaman. Buat papan baru untuk materi berikutnya.`, 'info'); return; }
      const importBtn = container.querySelector('.wb-import');
      if (importBtn) importBtn.classList.add('is-busy');
      addBgPage.last = null;
      const made = [];
      try {
        for (const f of list) {
          const room = room0 - made.length;
          if (room <= 0) break;
          made.push(...await importPdf(f, room));
        }
      } catch (e) {
        UI.toast(e.message || 'Impor gagal.', 'error');
      } finally {
        if (importBtn) importBtn.classList.remove('is-busy');
        addBgPage.last = null;
      }
      if (!made.length) { setStatus('Impor dibatalkan', 'is-error'); return; }
      // Simpan dulu daftar halaman & berkas, lalu buka halaman impor pertama.
      undoStack.length = 0; redoStack.length = 0;
      inkDirty = true; pagesUpdatedAt = Date.now(); dirty = true; flush();
      if (made[0] !== activePage) switchPage(made[0], { quiet: true }); else { paintPages(); fit(); }
      UI.toast(`${made.length} halaman ditambahkan. Ruang berkas kelas terpakai ${fmtMB(mediaUsed())} dari ${fmtMB(DB.WB_MEDIA_LIMIT)}.`);
    }

    function deleteSelected() {
      if (!selected.size || !guard()) return;
      actRemove([...selected]); flush();
    }

    /* ============================ panel (sheet) ============================ */
    let sheetKind = null;
    function openSheet(kind) {
      if (sheetKind === kind) { closeSheet(); return; }
      sheetKind = kind;
      sheet.classList.remove('hidden');
      paintSheet();
    }
    function closeSheet() { sheetKind = null; sheet.classList.add('hidden'); sheet.innerHTML = ''; }
    function sheetHead(title) {
      return `<div class="wb-sheet-head"><strong>${UI.esc(title)}</strong>
        <button type="button" class="wb-ibtn" data-wb-close aria-label="Tutup panel">✕</button></div>`;
    }
    function paintSheet() {
      const k = sheetKind;
      if (k === 'tools') {
        sheet.innerHTML = sheetHead('Pengaturan Alat') + `
          <div class="wb-row"><span>Palet</span><div class="wb-pal">${PALETTE.concat(st.custom || []).map(c =>
            `<button type="button" class="wb-dot ${c === st.color ? 'is-on' : ''}" style="background:${UI.esc(c)}" data-wb-color="${UI.esc(c)}" title="${UI.esc(c)}" aria-label="Warna ${UI.esc(c)}"></button>`).join('')}
            <button type="button" class="wb-ibtn" id="wbAddColor" title="Simpan warna saat ini ke palet kustom" aria-label="Tambah warna kustom">＋</button></div></div>
          <label class="wb-row"><span>Ketebalan <b id="wbWv">${st.width}</b></span><input type="range" id="wbWidth" min="1" max="40" value="${st.width}" /></label>
          <label class="wb-row"><span>Opasitas <b id="wbOv">${st.opacity}%</b></span><input type="range" id="wbOpacity" min="5" max="100" value="${st.opacity}" /></label>
          <div class="wb-row"><span>Gaya garis</span><div class="wb-seg">${['solid', 'dashed', 'dotted'].map(d =>
            `<button type="button" class="${st.dash === d ? 'is-on' : ''}" data-wb-dash="${d}">${{ solid: '━ Solid', dashed: '┅ Putus', dotted: '┈ Titik' }[d]}</button>`).join('')}</div></div>
          <label class="wb-check"><input type="checkbox" id="wbBold" ${st.bold ? 'checked' : ''} /> Tebal (bold) untuk goresan & teks</label>
          <label class="wb-check"><input type="checkbox" id="wbPressure" ${st.pressure ? 'checked' : ''} /> Sensitivitas tekanan stylus</label>
          <div class="wb-row"><span>Bentuk</span><div class="wb-seg wrap">${SHAPES.map(s =>
            `<button type="button" class="${st.shape === s.key ? 'is-on' : ''}" data-wb-shape="${s.key}">${s.label}</button>`).join('')}</div></div>
          <label class="wb-check"><input type="checkbox" id="wbFill" ${st.fill ? 'checked' : ''} /> Isi bentuk (transparan)</label>
          <div class="wb-row"><span>Penghapus</span><div class="wb-seg">
            <button type="button" class="${st.eraser === 'pixel' ? 'is-on' : ''}" data-wb-eraser="pixel">Goresan</button>
            <button type="button" class="${st.eraser === 'object' ? 'is-on' : ''}" data-wb-eraser="object">Per objek</button></div></div>
          <div class="wb-row"><span>Teks</span><div class="wb-inline">
            <select id="wbFont" class="input" aria-label="Font">${FONTS.map(f => `<option value="${f.key}" ${st.font === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
            <input type="number" id="wbTextSize" class="input" min="10" max="200" value="${st.textSize}" aria-label="Ukuran teks" /></div></div>
          <div class="wb-row"><span>Sisipkan</span><div class="wb-inline">
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;">🖼️ Gambar<input type="file" id="wbImage" accept="image/png,image/jpeg,image/webp,image/gif" hidden /></label>
            <button type="button" class="btn btn-sm btn-secondary" id="wbTableBtn">▦ Tabel</button>
            <button type="button" class="btn btn-sm btn-danger" id="wbClear">Hapus semua</button></div></div>
          <div class="wb-row hidden" id="wbTableForm"><span>Tabel</span><div class="wb-inline">
            <input type="number" id="wbRows" class="input" min="1" max="20" value="3" aria-label="Jumlah baris" /> ×
            <input type="number" id="wbCols" class="input" min="1" max="12" value="3" aria-label="Jumlah kolom" />
            <button type="button" class="btn btn-sm btn-primary" id="wbTableOk">Sisipkan</button></div></div>`;
      } else if (k === 'board') {
        const onBg = !!board.bgImage;
        sheet.innerHTML = sheetHead('Papan') + `
          <div class="muted small">Ukuran saat ini: ${board.w} × ${board.h} px</div>
          ${editable && onBg ? `<div class="wb-row"><span>Latar</span><div class="wb-inline">
            <span class="muted small">Halaman PDF tampil dengan ukuran aslinya; tulisan boleh di luar halaman.</span>
            <button type="button" class="btn btn-sm btn-secondary" id="wbDropBg">Lepas latar PDF</button></div></div>` : ''}
          ${editable ? `<div class="wb-row"><span>Ukuran</span><div class="wb-seg wrap">${PRESETS.map(p =>
            `<button type="button" class="${board.w === p.w && board.h === p.h ? 'is-on' : ''}" data-wb-preset="${p.key}" ${onBg ? 'disabled title="Ukuran mengikuti halaman PDF"' : ''}>${p.label}</button>`).join('')}</div></div>
          <div class="wb-row"><span>Perluas</span><div class="wb-inline">
            <button type="button" class="btn btn-sm btn-secondary" data-wb-grow="down">⬇ Tambah ke bawah</button>
            <button type="button" class="btn btn-sm btn-secondary" data-wb-grow="right">➡ Tambah ke kanan</button></div></div>
          <div class="wb-row"><span>Template</span><div class="wb-seg wrap">${TEMPLATES.map(t =>
            `<button type="button" class="${board.template === t.key ? 'is-on' : ''}" data-wb-template="${t.key}">${t.label}</button>`).join('')}</div></div>
          <div class="wb-row"><span>Latar</span><div class="wb-pal">${BGS.map(b =>
            `<button type="button" class="wb-dot ${board.bg === b.key ? 'is-on' : ''}" style="background:${b.key}" data-wb-bg="${b.key}" title="${b.label}" aria-label="Latar ${b.label}"></button>`).join('')}</div></div>` : ''}
          <label class="wb-check"><input type="checkbox" id="wbGuides" ${st.guides ? 'checked' : ''} /> Tampilkan garis bantu (tengah & margin)</label>`;
      } else if (k === 'export') {
        const wm = wmSettings();
        const pi = pages.findIndex(pg => pg.id === activePage);
        sheet.innerHTML = sheetHead('Ekspor') + `
          <p class="muted small">Ekspor papan beserta latar dan template. ${pages.length > 1 ? `Whiteboard ini punya <strong>${pages.length} halaman</strong>.` : ''}</p>
          ${pages.length > 1 ? `<div class="wb-row"><span>Halaman</span><div class="wb-seg">
            <button type="button" class="is-on" data-wb-scope="all">Semua (${pages.length})</button>
            <button type="button" data-wb-scope="current">Halaman ini (${pi + 1})</button></div></div>` : ''}
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-primary" id="wbPng">🖼️ Unduh PNG</button>
          <button type="button" class="btn btn-sm btn-secondary" id="wbPdf">📄 Simpan PDF</button></div>
          <p class="muted small">${wm.enabled ? `🔏 Watermark "${UI.esc(wm.text || 'logo')}" ${wm.logo ? '+ logo ' : ''}otomatis ditambahkan` : 'Watermark sedang dimatikan admin'}${wm.pageNumbers ? ' • nomor halaman dicetak di bawah' : ''}. Diatur admin di Pengaturan.</p>
          <p class="muted small">PDF dibuat lewat dialog cetak browser: pilih "Simpan sebagai PDF". PNG banyak halaman diunduh satu per satu.</p>`;
      } else if (k === 'saves') {
        const boards = DB.getWhiteboardSaves(course.id, 'board', boardId);
        const versions = DB.getWhiteboardSaves(course.id, 'version', boardId);
        const row = (x) => `<div class="wb-save-row">
          <div><strong>${UI.esc(x.name)}</strong><div class="muted small">${UI.esc(UI.fmtDateTime(x.createdAt))} • ${(x.objects || []).length} objek${x.auto ? ' • otomatis' : ''}</div></div>
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-primary" data-wb-open="${x.id}">${x.type === 'board' ? 'Buka' : 'Pulihkan'}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-wb-del="${x.id}" aria-label="Hapus ${UI.esc(x.name)}">🗑️</button></div></div>`;
        sheet.innerHTML = sheetHead('Salinan & Riwayat') + `
          <p class="muted small" style="margin:0;">Salinan menyimpan isi halaman ini agar dapat dibuka lagi. Untuk materi/pertemuan baru, buat papan baru dari daftar papan.</p>
          <form class="wb-inline" id="wbSaveForm"><input class="input" id="wbSaveName" maxlength="80" placeholder="Nama salinan, mis. Pembahasan nomor 5" aria-label="Nama salinan" />
            <button type="submit" class="btn btn-sm btn-primary">Simpan salinan</button></form>
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-secondary" id="wbSnap">Simpan versi sekarang</button></div>
          <div class="wb-list-title">Salinan tersimpan (${boards.length}/20)</div>
          ${boards.length ? boards.map(row).join('') : '<div class="muted small">Belum ada salinan.</div>'}
          <div class="wb-list-title">Riwayat versi (${versions.length}/15)</div>
          ${versions.length ? versions.map(row).join('') : '<div class="muted small">Versi otomatis dibuat tiap ±5 menit saat papan diubah.</div>'}`;
      }
      bindSheet();
    }

    function setBoard(patch) {
      if (!guard()) return;
      const before = clone(board);
      board = Object.assign({}, board, patch, { updatedAt: Date.now() });
      const after = clone(board);
      pushAction({ undo() { board = Object.assign({}, before, { updatedAt: Date.now() }); }, redo() { board = Object.assign({}, after, { updatedAt: Date.now() }); } });
      flush(); paintSheet();
    }

    function loadObjects(list, newBoard, label) {
      if (!guard()) return;
      const gone = clone(objects), prevBoard = clone(board);
      doClear();
      const copies = (list || []).map(freshCopy);
      addObjs(copies);
      if (newBoard && newBoard.w) board = Object.assign({}, board, newBoard, { updatedAt: Date.now() });
      let ids = copies.map(x => x.id), restored = [];
      pushAction({
        undo() { removeIds(ids); const c2 = gone.map(freshCopy); restored = c2.map(x => x.id); addObjs(c2); board = Object.assign({}, prevBoard, { updatedAt: Date.now() }); },
        redo() { removeIds(restored); const c3 = copies.map(freshCopy); ids = c3.map(x => x.id); addObjs(c3); if (newBoard && newBoard.w) board = Object.assign({}, board, newBoard, { updatedAt: Date.now() }); }
      });
      flush(); fit();
      UI.toast(label);
    }

    function bindSheet() {
      const q = (s) => sheet.querySelector(s);
      const on = (s, ev, fn) => sheet.querySelectorAll(s).forEach(el => el.addEventListener(ev, fn));
      on('[data-wb-close]', 'click', closeSheet);
      // alat
      on('[data-wb-color]', 'click', (e) => { setColor(e.currentTarget.dataset.wbColor); paintSheet(); });
      if (q('#wbAddColor')) q('#wbAddColor').addEventListener('click', () => {
        const list = (st.custom || []).filter(c => c !== st.color);
        if (PALETTE.includes(st.color)) { UI.toast('Warna ini sudah ada di palet.', 'info'); return; }
        st.custom = [st.color].concat(list).slice(0, 8); persist(); paintSheet();
      });
      if (q('#wbWidth')) q('#wbWidth').addEventListener('input', (e) => { st.width = Number(e.target.value) || 4; q('#wbWv').textContent = st.width; persist(); });
      if (q('#wbOpacity')) q('#wbOpacity').addEventListener('input', (e) => { st.opacity = Number(e.target.value) || 100; q('#wbOv').textContent = st.opacity + '%'; persist(); });
      on('[data-wb-dash]', 'click', (e) => { st.dash = e.currentTarget.dataset.wbDash; persist(); paintSheet(); });
      on('[data-wb-shape]', 'click', (e) => { st.shape = e.currentTarget.dataset.wbShape; st.tool = 'shape'; syncTools(); persist(); paintSheet(); });
      on('[data-wb-eraser]', 'click', (e) => { st.eraser = e.currentTarget.dataset.wbEraser; st.tool = 'eraser'; syncTools(); persist(); paintSheet(); });
      if (q('#wbBold')) q('#wbBold').addEventListener('change', (e) => { st.bold = e.target.checked; persist(); });
      if (q('#wbPressure')) q('#wbPressure').addEventListener('change', (e) => { st.pressure = e.target.checked; persist(); });
      if (q('#wbFill')) q('#wbFill').addEventListener('change', (e) => { st.fill = e.target.checked; persist(); });
      if (q('#wbFont')) q('#wbFont').addEventListener('change', (e) => { st.font = e.target.value; persist(); });
      if (q('#wbTextSize')) q('#wbTextSize').addEventListener('change', (e) => { st.textSize = clamp(Number(e.target.value) || 32, 10, 200); e.target.value = st.textSize; persist(); });
      if (q('#wbImage')) q('#wbImage').addEventListener('change', (e) => { insertImage(e.target.files[0]); e.target.value = ''; });
      if (q('#wbTableBtn')) q('#wbTableBtn').addEventListener('click', () => q('#wbTableForm').classList.toggle('hidden'));
      if (q('#wbTableOk')) q('#wbTableOk').addEventListener('click', () => {
        insertTable(clamp(Math.round(Number(q('#wbRows').value) || 3), 1, 20), clamp(Math.round(Number(q('#wbCols').value) || 3), 1, 12));
        closeSheet();
      });
      if (q('#wbClear')) q('#wbClear').addEventListener('click', () => {
        if (!guard()) return;
        if (!objects.length) { UI.toast('Papan sudah kosong.', 'info'); return; }
        if (!UI.confirmDialog('Hapus seluruh isi whiteboard kelas ini? Anda masih bisa membatalkannya dengan Undo.')) return;
        actClear(); flush(); closeSheet();
      });
      // papan
      on('[data-wb-preset]', 'click', (e) => { const p = PRESETS.find(x => x.key === e.currentTarget.dataset.wbPreset); if (p) { setBoard({ w: p.w, h: p.h }); fit(); } });
      on('[data-wb-grow]', 'click', (e) => {
        const down = e.currentTarget.dataset.wbGrow === 'down';
        const next = down ? { h: Math.min(MAX_SIDE, Math.round(board.h * 1.5)) } : { w: Math.min(MAX_SIDE, Math.round(board.w * 1.5)) };
        if ((down ? next.h : next.w) === (down ? board.h : board.w)) { UI.toast(`Ukuran maksimum ${MAX_SIDE}px tercapai.`, 'info'); return; }
        setBoard(next); fit();
      });
      on('[data-wb-template]', 'click', (e) => setBoard({ template: e.currentTarget.dataset.wbTemplate }));
      if (q('#wbDropBg')) q('#wbDropBg').addEventListener('click', () => {
        if (!UI.confirmDialog('Lepas latar PDF dari halaman ini? Tulisan tetap ada; dapat dibatalkan dengan Undo.')) return;
        setBoard({ bgImage: null });
      });
      on('[data-wb-bg]', 'click', (e) => setBoard({ bg: e.currentTarget.dataset.wbBg }));
      if (q('#wbGuides')) q('#wbGuides').addEventListener('change', (e) => { st.guides = e.target.checked; persist(); scheduleDraw(); });
      // ekspor
      on('[data-wb-scope]', 'click', (e) => {
        sheet.querySelectorAll('[data-wb-scope]').forEach(b => b.classList.toggle('is-on', b === e.currentTarget));
      });
      const scope = () => { const b = sheet.querySelector('[data-wb-scope].is-on'); return b ? b.dataset.wbScope : 'all'; };
      if (q('#wbPng')) q('#wbPng').addEventListener('click', () => exportPng(scope()));
      if (q('#wbPdf')) q('#wbPdf').addEventListener('click', () => exportPdf(scope()));
      // simpan & riwayat
      if (q('#wbSaveForm')) q('#wbSaveForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!guard()) return;
        if (!objects.length) { UI.toast('Papan masih kosong.', 'info'); return; }
        try {
          DB.addWhiteboardSave(course.id, { type: 'board', boardId, name: q('#wbSaveName').value, objects, board }, user);
          UI.toast('Salinan disimpan.'); paintSheet();
        } catch (err) { UI.toast(/quota/i.test(String(err && err.name) + err.message) ? 'Penyimpanan browser penuh. Hapus simpanan lama.' : err.message, 'error'); }
      });
      if (q('#wbSnap')) q('#wbSnap').addEventListener('click', () => {
        if (!guard()) return;
        try {
          DB.addWhiteboardSave(course.id, { type: 'version', boardId, name: 'Versi manual ' + UI.fmtDateTime(Date.now()), objects, board }, user);
          lastVersionAt = Date.now(); editsSinceVersion = 0;
          UI.toast('Versi disimpan.'); paintSheet();
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      on('[data-wb-open]', 'click', (e) => {
        const rec = DB.getWhiteboardSaves(course.id, null, boardId).find(x => x.id === e.currentTarget.dataset.wbOpen);
        if (!rec) return;
        if (objects.length && !UI.confirmDialog(`${rec.type === 'board' ? 'Buka' : 'Pulihkan'} "${rec.name}"? Isi papan saat ini akan diganti (bisa dibatalkan dengan Undo).`)) return;
        loadObjects(rec.objects, rec.board, `"${rec.name}" dibuka.`);
        closeSheet();
      });
      on('[data-wb-del]', 'click', (e) => {
        if (!UI.confirmDialog('Hapus simpanan ini?')) return;
        try { DB.deleteWhiteboardSave(e.currentTarget.dataset.wbDel, user); paintSheet(); } catch (err) { UI.toast(err.message, 'error'); }
      });
    }

    /* ============================ halaman ============================ */
    const pagesBar = container.querySelector('#wbPages');
    const shownPage = () => (editable ? activePage : viewPage);
    function pageIndex() { return Math.max(0, pages.findIndex(pg => pg.id === shownPage())); }
    function paintPages() {
      const i = pageIndex();
      const on = shownPage();
      pagesBar.innerHTML = `
        <span class="wb-pages-label">Halaman</span>
        <div class="wb-pages-list">${pages.map((pg, k) => `<button type="button" class="wb-page ${pg.id === on ? 'is-on' : ''} ${!editable && pg.id === activePage ? 'is-live' : ''}"
            data-wb-page="${UI.esc(pg.id)}" title="${UI.esc(pg.name || 'Halaman ' + (k + 1))}${!editable && pg.id === activePage ? ' • sedang dibuka tutor' : ''}"
            aria-pressed="${pg.id === on}">${k + 1}</button>`).join('')}</div>
        <span class="wb-page-name">${UI.esc(pages[i].name || 'Halaman ' + (i + 1))} <span class="muted small">(${i + 1}/${pages.length})</span></span>
        ${!editable ? `<div class="wb-pages-act">
          <button type="button" class="btn btn-sm btn-secondary" id="wbPgPrev" ${i ? '' : 'disabled'} aria-label="Halaman sebelumnya">‹</button>
          <button type="button" class="btn btn-sm btn-secondary" id="wbPgNext" ${i < pages.length - 1 ? '' : 'disabled'} aria-label="Halaman berikutnya">›</button>
          ${follow ? '<span class="wb-follow is-on" title="Halaman berpindah mengikuti tutor">● Mengikuti tutor</span>'
            : '<button type="button" class="btn btn-sm btn-primary" id="wbFollow">Ikuti tutor</button>'}
        </div>` : ''}
        ${editable ? `<div class="wb-pages-act">
          <button type="button" class="btn btn-sm btn-secondary" id="wbPgPrev" ${i ? '' : 'disabled'} aria-label="Halaman sebelumnya">‹</button>
          <button type="button" class="btn btn-sm btn-secondary" id="wbPgNext" ${i < pages.length - 1 ? '' : 'disabled'} aria-label="Halaman berikutnya">›</button>
          <button type="button" class="btn btn-sm btn-primary" id="wbPgAdd">＋ Halaman baru</button>
          <button type="button" class="btn btn-sm btn-ghost" id="wbPgRename" title="Ganti nama halaman">✏️</button>
          <button type="button" class="btn btn-sm btn-ghost" id="wbPgLeft" ${i ? '' : 'disabled'} title="Pindahkan ke kiri">⇤</button>
          <button type="button" class="btn btn-sm btn-ghost" id="wbPgRight" ${i < pages.length - 1 ? '' : 'disabled'} title="Pindahkan ke kanan">⇥</button>
          <button type="button" class="btn btn-sm btn-ghost" id="wbPgDel" ${pages.length > 1 ? '' : 'disabled'} title="Hapus halaman ini">🗑️</button>
        </div>` : ''}`;
      if (!editable) {
        const go = (id) => { follow = follow && id === activePage; viewPage = id; viewerLoad(record); userView = false; fit(); };
        pagesBar.querySelectorAll('[data-wb-page]').forEach(b => b.addEventListener('click', () => go(b.dataset.wbPage)));
        const k = pageIndex();
        const pv = pagesBar.querySelector('#wbPgPrev'), nx = pagesBar.querySelector('#wbPgNext'), fl = pagesBar.querySelector('#wbFollow');
        if (pv) pv.addEventListener('click', () => { if (k > 0) go(pages[k - 1].id); });
        if (nx) nx.addEventListener('click', () => { if (k < pages.length - 1) go(pages[k + 1].id); });
        if (fl) fl.addEventListener('click', () => { follow = true; viewPage = activePage; viewerLoad(record); userView = false; fit(); });
        return;
      }
      pagesBar.querySelectorAll('[data-wb-page]').forEach(b => b.addEventListener('click', () => switchPage(b.dataset.wbPage)));
      const q = (id) => pagesBar.querySelector(id);
      q('#wbPgPrev').addEventListener('click', () => { const k = pageIndex(); if (k > 0) switchPage(pages[k - 1].id); });
      q('#wbPgNext').addEventListener('click', () => { const k = pageIndex(); if (k < pages.length - 1) switchPage(pages[k + 1].id); });
      q('#wbPgAdd').addEventListener('click', addPage);
      q('#wbPgRename').addEventListener('click', renamePage);
      q('#wbPgLeft').addEventListener('click', () => movePage(-1));
      q('#wbPgRight').addEventListener('click', () => movePage(1));
      q('#wbPgDel').addEventListener('click', deletePage);
    }
    function pagesChanged() { pagesUpdatedAt = Date.now(); dirty = true; flush(); paintPages(); if (sheetKind === 'export') paintSheet(); }
    function switchPage(id, opts) {
      if (!guard() || id === activePage || !pages.some(pg => pg.id === id)) return;
      if (textEditor) commitText();
      pageData[activePage] = { objects: clone(objects), board: clone(board) };
      const target = pageData[id] || { objects: [], board: null };
      delete pageData[id];
      activePage = id;
      doClear();
      addObjs((target.objects || []).map(freshCopy));
      board = Object.assign(pageBoard(board, target.board), { updatedAt: Date.now() });
      // Riwayat undo milik halaman sebelumnya tidak berlaku di halaman ini.
      undoStack.length = 0; redoStack.length = 0;
      inkDirty = true; editsSinceVersion++;
      pagesChanged(); fit(); updateButtons(); scheduleDraw();
      if (!(opts && opts.quiet)) flashHint((pages.find(pg => pg.id === id) || {}).name || 'Halaman');
    }
    function addPage() {
      if (!guard()) return;
      if (pages.length >= MAX_PAGES) { UI.toast(`Maksimal ${MAX_PAGES} halaman per whiteboard.`, 'info'); return; }
      try {
        if (JSON.stringify(snapshotState()).length > 3000000) { UI.toast('Whiteboard sudah sangat besar. Hapus gambar besar atau simpan halaman lama sebelum menambah halaman.', 'error'); return; }
      } catch (e) { /* lanjut */ }
      const id = 'pg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const used = new Set(pages.map(pg => pg.name));
      let n = pages.length + 1;
      while (used.has('Halaman ' + n)) n++;
      pages.splice(pageIndex() + 1, 0, { id, name: 'Halaman ' + n });
      pageData[id] = { objects: [], board: { w: board.w, h: board.h, bg: board.bg, template: board.template } };
      switchPage(id, { quiet: true });
      UI.toast(`Halaman ${pageIndex() + 1} dibuat.`);
    }
    function renamePage() {
      if (!guard()) return;
      const pg = pages[pageIndex()];
      const name = global.prompt('Nama halaman:', pg.name || '');
      if (name == null) return;
      pg.name = String(name).trim().slice(0, 60) || ('Halaman ' + (pageIndex() + 1));
      pagesChanged();
    }
    function movePage(dir) {
      if (!guard()) return;
      const i = pageIndex(), j = i + dir;
      if (j < 0 || j >= pages.length) return;
      [pages[i], pages[j]] = [pages[j], pages[i]];
      pagesChanged();
    }
    function deletePage() {
      if (!guard() || pages.length < 2) return;
      const i = pageIndex();
      const pg = pages[i];
      if (!UI.confirmDialog(`Hapus "${pg.name || 'Halaman ' + (i + 1)}" beserta isinya? Tindakan ini tidak dapat dibatalkan.`)) return;
      const next = pages[i + 1] || pages[i - 1];
      switchPage(next.id, { quiet: true });
      pages = pages.filter(x => x.id !== pg.id);
      delete pageData[pg.id];
      pagesChanged();
      pruneMedia();
      UI.toast('Halaman dihapus.');
    }
    paintPages();

    /* ============================ ekspor ============================ */
    /** Render satu halaman ke kanvas (objek & papan halaman tersebut). */
    function renderPageCanvas(objs, brd, footer, wm, logo, maxSide) {
      const savedBoard = board, savedObjects = objects;
      board = brd; objects = objs;
      try {
        const out = renderFull(maxSide);
        const oc = out.getContext('2d');
        const dark = brd.bg === '#1e293b';
        if (wm) drawWatermark(oc, out.width, out.height, wm, logo, dark);
        if (footer) drawPageFooter(oc, out.width, out.height, footer, dark);
        return out;
      } finally { board = savedBoard; objects = savedObjects; }
    }
    /** Ekspor papan + tulisan yang keluar dari ukuran papan (tidak terpotong). maxSide: sisi terpanjang (px), mis. gambar mini. */
    function renderFull(maxSide) {
      const r = contentBounds(24);
      const k = maxSide ? maxSide / Math.max(r.w, r.h) : Math.min(2, 8192 / Math.max(r.w, r.h));
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(r.w * k)); out.height = Math.max(1, Math.round(r.h * k));
      const oc = out.getContext('2d');
      const layer = document.createElement('canvas');
      layer.width = out.width; layer.height = out.height;
      const lc = layer.getContext('2d');
      const saved = Object.assign({}, view);
      view.zoom = k; view.panX = -r.x * k; view.panY = -r.y * k;
      const savedDpr = dpr; dpr = 1;
      const guides = st.guides; st.guides = false;
      oc.setTransform(k, 0, 0, k, -r.x * k, -r.y * k); drawTemplate(oc, r);
      lc.setTransform(k, 0, 0, k, -r.x * k, -r.y * k); objects.forEach(ob => drawObj(lc, ob));
      oc.setTransform(1, 0, 0, 1, 0, 0); oc.drawImage(layer, 0, 0);
      Object.assign(view, saved); dpr = savedDpr; st.guides = guides;
      return out;
    }
    /** Semua halaman (urut) sebagai {objects, board, name}. */
    function pageList(scope) {
      const all = pages.map(pg => pg.id === activePage
        ? { id: pg.id, name: pg.name, objects, board }
        : { id: pg.id, name: pg.name, objects: ((pageData[pg.id] || {}).objects) || [], board: pageBoard(board, (pageData[pg.id] || {}).board) });
      return scope === 'current' ? all.filter(x => x.id === activePage) : all;
    }
    /** Pastikan semua gambar halaman sudah termuat sebelum dirender. */
    async function preloadImages(list) {
      const refs = new Map();
      const want = (ref) => { const k = typeof ref === 'object' ? 'blob:' + ref.blob : ref; if (!refs.has(k)) refs.set(k, ref); };
      list.forEach(pg => {
        if (pg.board && pg.board.bgImage) want({ blob: pg.board.bgImage.blob });
        (pg.objects || []).forEach(ob => { if (ob && ob.kind === 'image') { if (ob.blob) want({ blob: ob.blob }); else if (ob.src) want(ob.src); } });
      });
      await Promise.all([...refs.values()].map(ref => new Promise(res => {
        const img = imageFor(ref);
        if (img.failed || img.naturalWidth) { res(); return; }
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
        setTimeout(res, 8000);    // berkas dari server mungkin perlu diunduh dulu
      })));
    }
    async function renderPages(scope) {
      const list = pageList(scope);
      const wm = wmSettings();
      const [logo] = await Promise.all([wm.enabled ? loadImage(wm.logo) : Promise.resolve(null), preloadImages(list)]);
      const total = pages.length;
      return list.map(pg => {
        const no = pages.findIndex(x => x.id === pg.id) + 1;
        const footer = wm.pageNumbers ? `Halaman ${no} / ${total}${pg.name && pg.name !== 'Halaman ' + no ? ' — ' + pg.name : ''}` : '';
        return { no, name: pg.name, landscape: pg.board.w >= pg.board.h, canvas: renderPageCanvas(pg.objects, pg.board, footer, wm, logo) };
      });
    }
    function fileBase() {
      return ('whiteboard-' + DB.courseTitle(course) + '-' + DB.boardTitle(record) + '-' + UI.todayYMD()).replace(/[^\w\-]+/g, '_').slice(0, 100);
    }
    async function exportPng(scope) {
      try {
        const out = await renderPages(scope);
        const many = out.length > 1;
        out.forEach((pg, i) => setTimeout(() => {
          const a = document.createElement('a');
          a.href = pg.canvas.toDataURL('image/png');
          a.download = fileBase() + (many || pages.length > 1 ? `-hal-${String(pg.no).padStart(2, '0')}` : '') + '.png';
          document.body.appendChild(a); a.click(); a.remove();
        }, i * 450));
        UI.toast(many ? `${out.length} halaman diunduh sebagai PNG.` : 'PNG diunduh.');
      } catch (e) { UI.toast('Gagal mengekspor PNG: ' + e.message, 'error'); }
    }
    async function exportPdf(scope) {
      // Jendela dibuka lebih dulu (masih dalam gestur klik) agar tidak diblokir browser.
      const win = global.open('', '_blank');
      if (!win) { UI.toast('Popup diblokir browser. Izinkan popup untuk menyimpan PDF.', 'error'); return; }
      win.document.write('<!doctype html><title>Menyiapkan PDF…</title><p style="font-family:sans-serif">Menyiapkan halaman…</p>');
      let out;
      try { out = await renderPages(scope); } catch (e) { win.close(); UI.toast('Gagal menyiapkan PDF.', 'error'); return; }
      const imgs = out.map(pg => `<div class="pg ${pg.landscape ? 'land' : 'port'}"><img src="${pg.canvas.toDataURL('image/png')}" alt="Halaman ${pg.no}" /></div>`).join('');
      win.document.open();
      win.document.write(`<!doctype html><html><head><title>${UI.esc(fileBase())}</title>
        <style>@page land{size:A4 landscape;margin:10mm}@page port{size:A4 portrait;margin:10mm}
        html,body{margin:0}.pg{display:flex;align-items:center;justify-content:center;height:calc(100vh - 2px);page-break-after:always;break-after:page}
        .pg:last-child{page-break-after:auto;break-after:auto}.pg.land{page:land}.pg.port{page:port}
        img{max-width:100%;max-height:100%;object-fit:contain}
        @media screen{.pg{height:auto;margin:12px auto;max-width:900px;border:1px solid #e2e8f0}}</style>
        </head><body>${imgs}</body></html>`);
      win.document.close();
      const list = [...win.document.images];
      let left = list.length;
      const go = () => { win.focus(); win.print(); };
      if (!left) { setTimeout(go, 150); return; }
      list.forEach(img => {
        const done = () => { if (--left === 0) setTimeout(go, 200); };
        if (img.complete) done(); else { img.onload = done; img.onerror = done; }
      });
    }

    /* ============================ toolbar ============================ */
    function persist() {
      ['tool', 'color', 'width', 'opacity', 'dash', 'pressure', 'bold', 'shape', 'fill', 'font', 'textSize', 'eraser', 'custom', 'guides', 'dock', 'tbx', 'tby']
        .forEach(k => { pref[k] = st[k]; });
      savePref();
    }
    function setColor(c) {
      st.color = c;
      const inp = container.querySelector('#wbColor');
      if (inp) inp.value = c;
      if (['eraser', 'select', 'hand', 'laser'].includes(st.tool)) { st.tool = 'pen'; syncTools(); }
      persist();
    }
    function syncTools() {
      container.querySelectorAll('[data-wb-tool]').forEach(b => {
        const on = b.dataset.wbTool === st.tool;
        b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on);
      });
      canvas.dataset.tool = st.tool;
      if (st.tool !== 'select') { selected = new Set(); updateButtons(); scheduleDraw(); }
    }
    function setTool(t) {
      if (!editable && t !== 'hand') return;
      if (textEditor) commitText();
      st.tool = t; syncTools(); persist();
      const meta = TOOLS.find(x => x.key === t);
      if (meta) flashHint(meta.label);
    }

    if (editable) {
      container.querySelector('#wbImport').addEventListener('change', (e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; importFiles(fs); });
      container.querySelectorAll('[data-wb-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.wbTool)));
      container.querySelector('#wbColor').addEventListener('input', e => setColor(e.target.value));
      container.querySelector('#wbUndo').addEventListener('click', undo);
      container.querySelector('#wbRedo').addEventListener('click', redo);
      container.querySelector('#wbDelSel').addEventListener('click', deleteSelected);
      container.querySelector('#wbGroup').addEventListener('click', () => setGroup(true));
      container.querySelector('#wbUngroup').addEventListener('click', () => setGroup(false));
      const palette = container.querySelector('#wbPalette');
      container.querySelector('#wbDock').addEventListener('click', () => {
        st.dock = !st.dock; palette.classList.toggle('is-docked', st.dock);
        container.querySelector('#wbDock').title = st.dock ? 'Lepas toolbar' : 'Tempel toolbar di atas';
        persist();
      });
      // Toolbar dapat dipindah: seret pegangan ⠿ (posisi disimpan per pengguna).
      const grip = container.querySelector('#wbGrip');
      grip.addEventListener('pointerdown', (e) => {
        if (st.dock) return;
        e.preventDefault(); try { grip.setPointerCapture(e.pointerId); } catch (err) { /* pointer sintetis */ }
        const sx = e.clientX, sy = e.clientY, ox = palette.offsetLeft, oy = palette.offsetTop;
        const move = (ev) => {
          st.tbx = clamp(ox + ev.clientX - sx, 0, Math.max(0, stage.clientWidth - palette.offsetWidth));
          st.tby = clamp(oy + ev.clientY - sy, 0, Math.max(0, stage.clientHeight - palette.offsetHeight));
          palette.style.left = st.tbx + 'px'; palette.style.top = st.tby + 'px';
        };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); persist(); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
      });
    }
    container.querySelectorAll('[data-wb-panel]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.wbPanel)));
    container.querySelectorAll('[data-wb-zoom]').forEach(b => b.addEventListener('click', () => {
      const z = b.dataset.wbZoom, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
      if (z === 'in') zoomAt(1.25, cx, cy);
      else if (z === 'out') zoomAt(0.8, cx, cy);
      else if (z === 'reset') zoomAt(1 / view.zoom, cx, cy);
      else { userView = false; fit(); }
    }));

    /* Layar penuh (Fullscreen API) dengan cadangan mode maksimal CSS. */
    const fullBtn = container.querySelector('#wbFull');
    function isFull() { return document.fullscreenElement === card || card.classList.contains('is-max'); }
    function toggleFull() {
      if (isFull()) {
        if (document.fullscreenElement === card && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        card.classList.remove('is-max'); document.body.classList.remove('wb-lock');
      } else if (card.requestFullscreen) {
        card.requestFullscreen().catch(() => { card.classList.add('is-max'); document.body.classList.add('wb-lock'); });
      } else { card.classList.add('is-max'); document.body.classList.add('wb-lock'); }
      setTimeout(() => { resize(); fit(); }, 120);
    }
    function onFsChange() {
      fullBtn.classList.toggle('is-on', isFull());
      fullBtn.title = isFull() ? 'Keluar layar penuh (F)' : 'Layar penuh (F)';
      setTimeout(() => { resize(); fit(); }, 80);
    }
    fullBtn.addEventListener('click', toggleFull);
    document.addEventListener('fullscreenchange', onFsChange);

    const minBtn = container.querySelector('#wbMin');
    function setMin(min) {
      card.classList.toggle('is-min', min);
      container.querySelector('#wbMinBar').classList.toggle('hidden', !min);
      minBtn.textContent = min ? '▢' : '▁';
      minBtn.title = min ? 'Pulihkan' : 'Minimalkan';
      if (!min) setTimeout(() => { resize(); scheduleDraw(); }, 30);
    }
    minBtn.addEventListener('click', () => setMin(!card.classList.contains('is-min')));
    container.querySelector('#wbRestore').addEventListener('click', () => setMin(false));

    /* ============================ input ============================ */
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('dblclick', (e) => {
      if (!editable) return;
      const p = toWorld(e);
      const ob = topHit(p);
      if (!ob || !guard()) return;
      if (ob.kind === 'text') { setSelection([ob.id]); openTextEditor({ x: ob.x, y: ob.y }, ob); }
      else if (ob.kind === 'table') {
        const c = clamp(Math.floor((p.x - ob.x) / (ob.w / ob.cols)), 0, ob.cols - 1);
        const r = clamp(Math.floor((p.y - ob.y) / (ob.h / ob.rows)), 0, ob.rows - 1);
        openTextEditor({ x: ob.x, y: ob.y }, ob, { r, c });
      }
    });
    function onWheel(e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      } else if (isFull() || e.shiftKey) {
        e.preventDefault();
        view.panX -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        view.panY -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        userView = true; viewChanged();
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onKey(e) {
      if (textEditor || !card.isConnected) return;
      const inCard = card.contains(document.activeElement) || isFull();
      if (!inCard || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) return;
      const k = e.key.toLowerCase();
      if (e.key === ' ') { spaceDown = true; canvas.classList.add('can-pan'); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (editable && (e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault();
        if (st.tool !== 'select') setTool('select');
        setSelection(objects.filter(ob => !(ob.kind === 'stroke' && ob.tool === 'eraser')).map(ob => ob.id));
        if (selected.size) flashHint(`${selected.size} objek dipilih`);
        return;
      }
      if (editable && (e.ctrlKey || e.metaKey) && k === 'g') { e.preventDefault(); setGroup(!e.shiftKey); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') { if (sheetKind) closeSheet(); else if (selected.size) setSelection([]); return; }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (editable && arrows[e.key] && selected.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
        return;
      }
      const map = { v: 'select', h: 'hand', p: 'pen', e: 'eraser', l: 'laser', s: 'shape', t: 'text' };
      if (map[k] && (editable || map[k] === 'hand')) { setTool(map[k]); return; }
      if (k === 'f') { toggleFull(); return; }
      if (k === '+' || k === '=') zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2);
      else if (k === '-') zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2);
      else if (k === '0') { userView = false; fit(); }
    }
    function onKeyUp(e) { if (e.key === ' ') { spaceDown = false; canvas.classList.remove('can-pan'); } }
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);

    let ro = null;
    if ('ResizeObserver' in global) { ro = new ResizeObserver(() => resize()); ro.observe(stage); }
    else global.addEventListener('resize', resize);
    global.addEventListener('storage', onStorage);
    global.addEventListener('lms:remote-change', onRemote);
    global.addEventListener('pagehide', flush);
    if ('BroadcastChannel' in global) {
      try { channel = new BroadcastChannel('lms-whiteboard-' + boardId); channel.addEventListener('message', e => mergeRemote(e.data)); }
      catch (e) { channel = null; }
    }

    syncTools(); resize(); scheduleDraw(); updateButtons();

    active = {
      container,
      destroy() {
        if (textEditor) commitText();
        if (dirty) thumbAt = 0;      // gambar mini terakhir dibuat saat papan ditutup
        flush();
        try { pruneMedia(); } catch (e) { /* pembersihan berkas bersifat best-effort */ }
        destroyed = true;
        if (saveTimer) clearTimeout(saveTimer);
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        global.removeEventListener('storage', onStorage);
        global.removeEventListener('lms:remote-change', onRemote);
        objectUrls.forEach(u => URL.revokeObjectURL(u));
        global.removeEventListener('pagehide', flush);
        document.removeEventListener('fullscreenchange', onFsChange);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keyup', onKeyUp);
        if (document.fullscreenElement === card && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        document.body.classList.remove('wb-lock');
        if (channel) channel.close();
        active = null;
      },
      flush, importFiles,
      getState: () => ({ objects: clone(objects), board: clone(board), record: clone(record), editable, view: Object.assign({}, view), selected: [...selected] })
    };
    container.__whiteboardDispose = active.destroy;
    return active;
  }

  function destroy() {
    if (active && active.destroy) active.destroy();
  }

  global.Whiteboard = { mount, destroy, previewWatermark, drawWatermark };
})(window);
