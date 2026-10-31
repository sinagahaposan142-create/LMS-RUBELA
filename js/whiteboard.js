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
    const editable = DB.canEditWhiteboard(user, course);
    const prefKey = 'lms_wb_pref:' + user.id;
    const pref = (() => { try { return JSON.parse(localStorage.getItem(prefKey) || '{}') || {}; } catch (e) { return {}; } })();
    const savePref = () => { try { localStorage.setItem(prefKey, JSON.stringify(pref)); } catch (e) { /* abaikan */ } };

    let record = DB.getWhiteboard(course.id) || { courseId: course.id, strokes: [], revision: 0, updatedAt: 0 };
    let { board, objects } = migrate(record);
    let clearEpoch = Number(record.clearEpoch) || 0;
    let deletedIds = new Set(record.deletedIds || []);
    let pendingRemote = null;
    const undoStack = [];
    const redoStack = [];
    let dirty = false, lastSave = 0, saveTimer = null, raf = 0, destroyed = false;
    let lastVersionAt = (DB.getWhiteboardSaves(course.id, 'version')[0] || {}).createdAt || 0;
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
    let selection = null;    // id objek terpilih
    let drag = null;         // operasi pindah/resize/geser
    let lasers = [];         // jejak laser {pts:[[x,y,t]], local}
    let laserSend = 0;
    let textEditor = null;
    const images = new Map();
    let spaceDown = false;

    /* ============================ markup ============================ */
    const toolBtn = (t) => `<button type="button" class="wb-tool ${st.tool === t.key ? 'is-on' : ''}" data-wb-tool="${t.key}"
      title="${UI.esc(t.label)}" aria-label="${UI.esc(t.label)}" aria-pressed="${st.tool === t.key}">${t.ic}</button>`;

    container.innerHTML = `
      <div class="card whiteboard-card wb-pro" id="wbCard">
        <div class="wb-head">
          <div class="wb-title">
            <h3>🖍️ Whiteboard Kelas</h3>
            <span class="muted small">${UI.esc(DB.courseTitle(course))} • ${editable ? 'admin/tutor dapat menggambar' : 'mode lihat saja'}</span>
          </div>
          <div class="wb-head-actions">
            <span class="wb-save" id="wbSave">${record.updatedAt ? 'Tersimpan ' + UI.fmtRelative(record.updatedAt) : 'Belum ada coretan'}</span>
            <div class="wb-zoom" role="group" aria-label="Zoom">
              <button type="button" class="wb-ibtn" data-wb-zoom="out" title="Perkecil (−)" aria-label="Perkecil">－</button>
              <button type="button" class="wb-ibtn wb-zoom-val" data-wb-zoom="reset" title="Zoom 100%" aria-label="Zoom 100%">100%</button>
              <button type="button" class="wb-ibtn" data-wb-zoom="in" title="Perbesar (+)" aria-label="Perbesar">＋</button>
              <button type="button" class="wb-ibtn" data-wb-zoom="fit" title="Muat ke layar (0)" aria-label="Muat ke layar">⤢</button>
            </div>
            <button type="button" class="wb-ibtn" data-wb-panel="board" title="Ukuran, latar & template" aria-label="Pengaturan papan">📐</button>
            ${editable ? '<button type="button" class="wb-ibtn" data-wb-panel="saves" title="Simpan, buka & riwayat versi" aria-label="Simpan dan riwayat versi">🗂️</button>' : ''}
            <button type="button" class="wb-ibtn" data-wb-panel="export" title="Ekspor PNG / PDF" aria-label="Ekspor">⬇️</button>
            <button type="button" class="wb-ibtn" id="wbFull" title="Layar penuh (F)" aria-label="Layar penuh">⛶</button>
            <button type="button" class="wb-ibtn" id="wbMin" title="Minimalkan" aria-label="Minimalkan whiteboard">▁</button>
          </div>
        </div>
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
              <button type="button" class="wb-tool" data-wb-panel="tools" title="Pengaturan alat" aria-label="Pengaturan alat">⚙️</button>
              <button type="button" class="wb-tool" id="wbDock" title="${st.dock ? 'Lepas toolbar' : 'Tempel toolbar di atas'}" aria-label="Tempel atau lepas toolbar">📌</button>
            </div>` : ''}
            <div class="wb-sheet hidden" id="wbSheet" role="dialog" aria-modal="false"></div>
            <div class="wb-hint muted small" id="wbHint"></div>
          </div>
          <div class="wb-min-bar hidden" id="wbMinBar">Whiteboard diminimalkan — <button type="button" class="btn btn-sm btn-primary" id="wbRestore">Tampilkan</button></div>
        </div>
        <div class="muted small wb-foot">${editable
          ? 'Autosave ≤1 detik • Ctrl+Z/Ctrl+Y undo/redo • Ctrl+scroll untuk zoom • Spasi+seret untuk geser papan.'
          : 'Whiteboard tersinkron otomatis dalam mode baca. Gunakan ✋ atau tombol zoom untuk melihat detail.'}
          Sinkron antar-tab/jendela pada browser yang sama; lintas perangkat memerlukan backend realtime.</div>
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
    function fit() {
      const w = stage.clientWidth || 600, h = stage.clientHeight || 400;
      view.zoom = clamp(Math.min((w - 24) / board.w, (h - 24) / board.h), 0.05, 8);
      view.panX = (w - board.w * view.zoom) / 2;
      view.panY = (h - board.h * view.zoom) / 2;
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

    function drawTemplate(c) {
      c.save();
      c.fillStyle = board.bg || '#ffffff';
      c.fillRect(0, 0, board.w, board.h);
      const dark = board.bg === '#1e293b';
      const line = dark ? 'rgba(255,255,255,.12)' : 'rgba(15,23,42,.10)';
      const strong = dark ? 'rgba(255,255,255,.22)' : 'rgba(15,23,42,.18)';
      c.lineWidth = 1 / view.zoom;
      if (board.template === 'grid' || board.template === 'mm') {
        const step = board.template === 'mm' ? 10 : 40;
        for (let x = 0; x <= board.w; x += step) {
          c.strokeStyle = board.template === 'mm' && x % 50 === 0 ? strong : line;
          c.beginPath(); c.moveTo(x, 0); c.lineTo(x, board.h); c.stroke();
        }
        for (let y = 0; y <= board.h; y += step) {
          c.strokeStyle = board.template === 'mm' && y % 50 === 0 ? strong : line;
          c.beginPath(); c.moveTo(0, y); c.lineTo(board.w, y); c.stroke();
        }
      } else if (board.template === 'dots') {
        c.fillStyle = strong;
        const rr = Math.max(1.4, 1.2 / view.zoom);
        for (let x = 40; x < board.w; x += 40) for (let y = 40; y < board.h; y += 40) c.fillRect(x - rr / 2, y - rr / 2, rr, rr);
      } else if (board.template === 'lines') {
        c.strokeStyle = line;
        for (let y = 64; y < board.h; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(board.w, y); c.stroke(); }
        c.strokeStyle = dark ? 'rgba(248,113,113,.35)' : 'rgba(220,38,38,.25)';
        c.beginPath(); c.moveTo(96, 0); c.lineTo(96, board.h); c.stroke();
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

    function imageFor(src) {
      let img = images.get(src);
      if (!img) {
        img = new Image();
        img.onload = () => { inkDirty = true; scheduleDraw(); };
        img.src = src;
        images.set(src, img);
      }
      return img;
    }
    function drawImageObj(c, o) {
      const img = imageFor(o.src);
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
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,.18)'; ctx.shadowBlur = 18 / view.zoom;
      ctx.fillStyle = board.bg || '#fff'; ctx.fillRect(0, 0, board.w, board.h);
      ctx.restore();
      drawTemplate(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(ink, 0, 0);
      applyView(ctx);
      if (current && !erasing) drawObj(ctx, current);
      drawSelection();
      const alive = drawLasers();
      if (alive) scheduleDraw();
    }

    function drawSelection() {
      const ob = selection && objects.find(x => x.id === selection);
      if (!ob) return;
      const b = bbox(ob);
      ctx.save();
      ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5 / view.zoom; ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
      ctx.strokeRect(b.x - 4 / view.zoom, b.y - 4 / view.zoom, b.w + 8 / view.zoom, b.h + 8 / view.zoom);
      ctx.setLineDash([]);
      const hs = 10 / view.zoom;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2563eb';
      ctx.fillRect(b.x + b.w - hs / 2 + 4 / view.zoom, b.y + b.h - hs / 2 + 4 / view.zoom, hs, hs);
      ctx.strokeRect(b.x + b.w - hs / 2 + 4 / view.zoom, b.y + b.h - hs / 2 + 4 / view.zoom, hs, hs);
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
    function scale(ob, from, sx, sy) {
      if (ob.kind === 'stroke') ob.pts = ob.pts.map(q => [r1(from.x + (q[0] - from.x) * sx), r1(from.y + (q[1] - from.y) * sy), q[2]]);
      else if (ob.kind === 'shape') {
        ob.x1 = from.x + (ob.x1 - from.x) * sx; ob.x2 = from.x + (ob.x2 - from.x) * sx;
        ob.y1 = from.y + (ob.y1 - from.y) * sy; ob.y2 = from.y + (ob.y2 - from.y) * sy;
      } else if (ob.kind === 'text') ob.size = clamp(Math.round((Number(ob.size) || 32) * Math.max(sx, sy)), 8, 400);
      else { ob.w = Math.max(20, ob.w * sx); ob.h = Math.max(20, ob.h * sy); }
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
      ids.forEach(id => deletedIds.add(id));
      if (selection && set.has(selection)) selection = null;
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
    function actUpdate(before, after) {
      pushAction({
        undo() { replaceObj(before); },
        redo() { replaceObj(after); }
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
      objects = []; selection = null; clearEpoch = Date.now();
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
      if (!remote || remote.courseId !== course.id || remote.origin === origin) return;
      clearEpoch = Math.max(clearEpoch, Number(remote.clearEpoch) || 0);
      (remote.deletedIds || []).forEach(id => deletedIds.add(id));
      const incoming = migrate({ strokes: remote.strokes || [], board: remote.board || board });
      if (remote.board && (Number(remote.board.updatedAt) || 0) > (Number(board.updatedAt) || 0)) {
        board = Object.assign({}, board, remote.board);
      }
      const map = new Map();
      objects.concat(incoming.objects).forEach(ob => {
        if (!ob || !ob.id || deletedIds.has(ob.id) || (Number(ob.createdAt) || 0) < clearEpoch) return;
        const prev = map.get(ob.id);
        if (!prev || stamp(ob) > stamp(prev)) map.set(ob.id, ob);
      });
      objects = Array.from(map.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (selection && !map.has(selection)) selection = null;
      record = Object.assign({}, record, {
        revision: Math.max(Number(record.revision) || 0, Number(remote.revision) || 0),
        updatedAt: Math.max(Number(record.updatedAt) || 0, Number(remote.updatedAt) || 0)
      });
      inkDirty = true;
    }

    function snapshotState() {
      return {
        strokes: clone(objects), board: clone(board), schemaVersion: 2,
        // Tombstone dipangkas agar data tidak tumbuh tanpa batas.
        deletedIds: Array.from(deletedIds).slice(-3000), clearEpoch, revision: record.revision || 0
      };
    }

    function flush() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty || destroyed) return;
      try {
        const latest = DB.getWhiteboard(course.id);
        if (latest && (latest.revision || 0) > (record.revision || 0)) {
          reconcile(Object.assign({ origin: 'storage-latest' }, latest));
        }
        record = DB.saveWhiteboard(course.id, snapshotState(), user);
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
        DB.addWhiteboardSave(course.id, { type: 'version', auto: true, name: 'Versi otomatis ' + UI.fmtDateTime(Date.now()), objects, board }, user);
        lastVersionAt = Date.now(); editsSinceVersion = 0;
      } catch (e) { /* versi otomatis bersifat best-effort */ }
    }

    function broadcast(extra) {
      if (!channel) return;
      try {
        if (extra.type === 'laser') { channel.postMessage(Object.assign({ origin, courseId: course.id }, extra)); return; }
        channel.postMessage(Object.assign({ origin, courseId: course.id, revision: record.revision, updatedAt: record.updatedAt },
          snapshotState(), extra));
      } catch (e) { /* kanal tertutup */ }
    }

    function mergeRemote(remote) {
      if (!remote || remote.courseId !== course.id || remote.origin === origin) return;
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
    }

    function onStorage(e) {
      if (e.key !== 'lms_whiteboards') return;
      const fresh = DB.getWhiteboard(course.id);
      if (fresh) mergeRemote(Object.assign({ origin: 'storage' }, fresh));
    }

    function drainPending() {
      if (pendingRemote) { const q = pendingRemote; pendingRemote = null; reconcile(q); }
    }

    function updateButtons() {
      if (!editable) return;
      const u = container.querySelector('#wbUndo'), r = container.querySelector('#wbRedo'), d = container.querySelector('#wbDelSel');
      if (u) u.disabled = !undoStack.length;
      if (r) r.disabled = !redoStack.length;
      if (d) d.disabled = !selection;
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
        const sel = selection && objects.find(x => x.id === selection);
        if (sel) {
          const b = bbox(sel), hs = 14 / view.zoom;
          if (Math.abs(p.x - (b.x + b.w + 4 / view.zoom)) < hs && Math.abs(p.y - (b.y + b.h + 4 / view.zoom)) < hs) {
            drag = { mode: 'resize', id: sel.id, before: clone(sel), from: { x: b.x, y: b.y }, bw: b.w, bh: b.h };
            return;
          }
        }
        const target = topHit(p);
        selection = target ? target.id : null;
        if (target) drag = { mode: 'move', id: target.id, before: clone(target), sx: p.x, sy: p.y, moved: false };
        updateButtons(); scheduleDraw();
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
      if (drag && (drag.mode === 'move' || drag.mode === 'resize')) {
        const ob = objects.find(x => x.id === drag.id);
        if (!ob) { drag = null; return; }
        const p = toWorld(e);
        const fresh = clone(drag.before);
        if (drag.mode === 'move') { translate(fresh, p.x - drag.sx, p.y - drag.sy); drag.moved = true; }
        else {
          const sx = Math.max(0.05, (p.x - drag.from.x) / Math.max(1, drag.bw));
          const sy = Math.max(0.05, (p.y - drag.from.y) / Math.max(1, drag.bh));
          scale(fresh, drag.from, sx, e.shiftKey ? sx : sy); drag.moved = true;
        }
        Object.assign(ob, fresh);
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
          const ob = objects.find(x => x.id === d.id);
          if (ob) { touch(ob); actUpdate(d.before, clone(ob)); }
        }
        drainPending(); scheduleDraw(); updateButtons();
        if (d.mode !== 'pan' && d.mode !== 'laser') flush();
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
      const el = textEditor.el; textEditor = null; el.remove();
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
      st.tool = 'select'; syncTools(); selection = objects[objects.length - 1].id; updateButtons(); flush();
      flashHint('Klik dua kali pada sel untuk mengisi tabel.');
    }

    async function insertImage(file) {
      if (!guard() || !file) return;
      if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) { UI.toast('Gunakan gambar PNG, JPG, WEBP, atau GIF.', 'error'); return; }
      try {
        setStatus('Memproses gambar…', 'is-saving');
        const src = global.Editor && Editor.compressImage ? await Editor.compressImage(file) : await new Promise((res, rej) => {
          const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file);
        });
        const img = imageFor(src);
        await new Promise(res => { if (img.complete && img.naturalWidth) res(); else { img.onload = () => { inkDirty = true; res(); }; img.onerror = res; } });
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 0.75;
        const w = Math.min(board.w * 0.6, img.naturalWidth || 600), h = w * ratio;
        const c = centerWorld();
        actAdd([{ id: rid(), kind: 'image', x: r1(c.x - w / 2), y: r1(c.y - h / 2), w, h, src, createdAt: Date.now() }]);
        st.tool = 'select'; syncTools(); selection = objects[objects.length - 1].id; updateButtons(); flush();
      } catch (err) {
        setStatus('Gagal memuat gambar', 'is-error');
        UI.toast(err.message || 'Gagal membaca gambar.', 'error');
      }
    }

    function deleteSelected() {
      if (!selection || !guard()) return;
      actRemove([selection]); flush();
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
        sheet.innerHTML = sheetHead('Papan') + `
          <div class="muted small">Ukuran saat ini: ${board.w} × ${board.h} px</div>
          ${editable ? `<div class="wb-row"><span>Ukuran</span><div class="wb-seg wrap">${PRESETS.map(p =>
            `<button type="button" class="${board.w === p.w && board.h === p.h ? 'is-on' : ''}" data-wb-preset="${p.key}">${p.label}</button>`).join('')}</div></div>
          <div class="wb-row"><span>Perluas</span><div class="wb-inline">
            <button type="button" class="btn btn-sm btn-secondary" data-wb-grow="down">⬇ Tambah ke bawah</button>
            <button type="button" class="btn btn-sm btn-secondary" data-wb-grow="right">➡ Tambah ke kanan</button></div></div>
          <div class="wb-row"><span>Template</span><div class="wb-seg wrap">${TEMPLATES.map(t =>
            `<button type="button" class="${board.template === t.key ? 'is-on' : ''}" data-wb-template="${t.key}">${t.label}</button>`).join('')}</div></div>
          <div class="wb-row"><span>Latar</span><div class="wb-pal">${BGS.map(b =>
            `<button type="button" class="wb-dot ${board.bg === b.key ? 'is-on' : ''}" style="background:${b.key}" data-wb-bg="${b.key}" title="${b.label}" aria-label="Latar ${b.label}"></button>`).join('')}</div></div>` : ''}
          <label class="wb-check"><input type="checkbox" id="wbGuides" ${st.guides ? 'checked' : ''} /> Tampilkan garis bantu (tengah & margin)</label>`;
      } else if (k === 'export') {
        sheet.innerHTML = sheetHead('Ekspor') + `
          <p class="muted small">Ekspor seluruh papan (${board.w} × ${board.h}) beserta latar dan template.</p>
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-primary" id="wbPng">🖼️ Unduh PNG</button>
          <button type="button" class="btn btn-sm btn-secondary" id="wbPdf">📄 Simpan PDF</button></div>
          <p class="muted small">PDF dibuat lewat dialog cetak browser: pilih "Simpan sebagai PDF".</p>`;
      } else if (k === 'saves') {
        const boards = DB.getWhiteboardSaves(course.id, 'board');
        const versions = DB.getWhiteboardSaves(course.id, 'version');
        const row = (x) => `<div class="wb-save-row">
          <div><strong>${UI.esc(x.name)}</strong><div class="muted small">${UI.esc(UI.fmtDateTime(x.createdAt))} • ${(x.objects || []).length} objek${x.auto ? ' • otomatis' : ''}</div></div>
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-primary" data-wb-open="${x.id}">${x.type === 'board' ? 'Buka' : 'Pulihkan'}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-wb-del="${x.id}" aria-label="Hapus ${UI.esc(x.name)}">🗑️</button></div></div>`;
        sheet.innerHTML = sheetHead('Simpan, Buka & Riwayat') + `
          <form class="wb-inline" id="wbSaveForm"><input class="input" id="wbSaveName" maxlength="80" placeholder="Nama papan, mis. Pembahasan PU Bab 3" aria-label="Nama papan" />
            <button type="submit" class="btn btn-sm btn-primary">💾 Simpan papan</button></form>
          <div class="wb-inline"><button type="button" class="btn btn-sm btn-secondary" id="wbSnap">📸 Simpan versi sekarang</button>
            <button type="button" class="btn btn-sm btn-secondary" id="wbNew">🆕 Papan baru</button></div>
          <div class="wb-list-title">Papan tersimpan (${boards.length}/20)</div>
          ${boards.length ? boards.map(row).join('') : '<div class="muted small">Belum ada papan tersimpan.</div>'}
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
      on('[data-wb-bg]', 'click', (e) => setBoard({ bg: e.currentTarget.dataset.wbBg }));
      if (q('#wbGuides')) q('#wbGuides').addEventListener('change', (e) => { st.guides = e.target.checked; persist(); scheduleDraw(); });
      // ekspor
      if (q('#wbPng')) q('#wbPng').addEventListener('click', exportPng);
      if (q('#wbPdf')) q('#wbPdf').addEventListener('click', exportPdf);
      // simpan & riwayat
      if (q('#wbSaveForm')) q('#wbSaveForm').addEventListener('submit', (e) => {
        e.preventDefault();
        if (!guard()) return;
        if (!objects.length) { UI.toast('Papan masih kosong.', 'info'); return; }
        try {
          DB.addWhiteboardSave(course.id, { type: 'board', name: q('#wbSaveName').value, objects, board }, user);
          UI.toast('Papan disimpan.'); paintSheet();
        } catch (err) { UI.toast(/quota/i.test(String(err && err.name) + err.message) ? 'Penyimpanan browser penuh. Hapus simpanan lama.' : err.message, 'error'); }
      });
      if (q('#wbSnap')) q('#wbSnap').addEventListener('click', () => {
        if (!guard()) return;
        try {
          DB.addWhiteboardSave(course.id, { type: 'version', name: 'Versi manual ' + UI.fmtDateTime(Date.now()), objects, board }, user);
          lastVersionAt = Date.now(); editsSinceVersion = 0;
          UI.toast('Versi disimpan.'); paintSheet();
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      if (q('#wbNew')) q('#wbNew').addEventListener('click', () => {
        if (!guard()) return;
        if (objects.length) {
          if (!UI.confirmDialog('Mulai papan baru? Isi saat ini disimpan dulu sebagai versi.')) return;
          try { DB.addWhiteboardSave(course.id, { type: 'version', name: 'Sebelum papan baru ' + UI.fmtDateTime(Date.now()), objects, board }, user); } catch (err) { /* lanjut */ }
        }
        loadObjects([], null, 'Papan baru siap. Gunakan Undo bila ingin kembali.');
        paintSheet();
      });
      on('[data-wb-open]', 'click', (e) => {
        const rec = DB.getWhiteboardSaves(course.id).find(x => x.id === e.currentTarget.dataset.wbOpen);
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

    /* ============================ ekspor ============================ */
    function renderFull() {
      const k = Math.min(2, 8192 / Math.max(board.w, board.h));
      const out = document.createElement('canvas');
      out.width = Math.round(board.w * k); out.height = Math.round(board.h * k);
      const oc = out.getContext('2d');
      const layer = document.createElement('canvas');
      layer.width = out.width; layer.height = out.height;
      const lc = layer.getContext('2d');
      const saved = Object.assign({}, view);
      view.zoom = k; view.panX = 0; view.panY = 0;
      const savedDpr = dpr; dpr = 1;
      const guides = st.guides; st.guides = false;
      oc.setTransform(k, 0, 0, k, 0, 0); drawTemplate(oc);
      lc.setTransform(k, 0, 0, k, 0, 0); objects.forEach(ob => drawObj(lc, ob));
      oc.setTransform(1, 0, 0, 1, 0, 0); oc.drawImage(layer, 0, 0);
      Object.assign(view, saved); dpr = savedDpr; st.guides = guides;
      return out;
    }
    function fileBase() {
      return ('whiteboard-' + DB.courseTitle(course) + '-' + UI.todayYMD()).replace(/[^\w\-]+/g, '_').slice(0, 80);
    }
    function exportPng() {
      try {
        const url = renderFull().toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url; a.download = fileBase() + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        UI.toast('PNG diunduh.');
      } catch (e) { UI.toast('Gagal mengekspor PNG: ' + e.message, 'error'); }
    }
    function exportPdf() {
      let url;
      try { url = renderFull().toDataURL('image/png'); } catch (e) { UI.toast('Gagal menyiapkan PDF.', 'error'); return; }
      const win = global.open('', '_blank');
      if (!win) { UI.toast('Popup diblokir browser. Izinkan popup untuk menyimpan PDF.', 'error'); return; }
      const landscape = board.w >= board.h;
      win.document.write(`<!doctype html><html><head><title>${UI.esc(fileBase())}</title>
        <style>@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:10mm}html,body{margin:0;height:100%}
        body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%;object-fit:contain}</style>
        </head><body><img src="${url}" alt="Whiteboard" /></body></html>`);
      win.document.close();
      const img = win.document.querySelector('img');
      const go = () => { win.focus(); win.print(); };
      if (img.complete) setTimeout(go, 150); else img.onload = () => setTimeout(go, 150);
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
      if (st.tool !== 'select') { selection = null; updateButtons(); scheduleDraw(); }
    }
    function setTool(t) {
      if (!editable && t !== 'hand') return;
      if (textEditor) commitText();
      st.tool = t; syncTools(); persist();
      const meta = TOOLS.find(x => x.key === t);
      if (meta) flashHint(meta.label);
    }

    if (editable) {
      container.querySelectorAll('[data-wb-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.wbTool)));
      container.querySelector('#wbColor').addEventListener('input', e => setColor(e.target.value));
      container.querySelector('#wbUndo').addEventListener('click', undo);
      container.querySelector('#wbRedo').addEventListener('click', redo);
      container.querySelector('#wbDelSel').addEventListener('click', deleteSelected);
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
      if (ob.kind === 'text') { selection = ob.id; openTextEditor({ x: ob.x, y: ob.y }, ob); }
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection) { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') { if (sheetKind) closeSheet(); else if (selection) { selection = null; updateButtons(); scheduleDraw(); } return; }
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
    global.addEventListener('pagehide', flush);
    if ('BroadcastChannel' in global) {
      try { channel = new BroadcastChannel('lms-whiteboard-' + course.id); channel.addEventListener('message', e => mergeRemote(e.data)); }
      catch (e) { channel = null; }
    }

    syncTools(); resize(); scheduleDraw(); updateButtons();

    active = {
      container,
      destroy() {
        if (textEditor) commitText();
        flush();
        destroyed = true;
        if (saveTimer) clearTimeout(saveTimer);
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        global.removeEventListener('storage', onStorage);
        global.removeEventListener('pagehide', flush);
        document.removeEventListener('fullscreenchange', onFsChange);
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keyup', onKeyUp);
        if (document.fullscreenElement === card && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        document.body.classList.remove('wb-lock');
        if (channel) channel.close();
        active = null;
      },
      flush,
      getState: () => ({ objects: clone(objects), board: clone(board), record: clone(record), editable, view: Object.assign({}, view) })
    };
    container.__whiteboardDispose = active.destroy;
    return active;
  }

  function destroy() {
    if (active && active.destroy) active.destroy();
  }

  global.Whiteboard = { mount, destroy };
})(window);
