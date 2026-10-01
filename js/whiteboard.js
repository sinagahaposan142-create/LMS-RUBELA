/* =====================================================================
 * js/whiteboard.js — papan tulis vector per kelas
 * Autosave maksimal 1 detik, tahan refresh, sinkron antar-tab melalui
 * BroadcastChannel + storage. Koordinat normal 0..1 agar responsif.
 * ===================================================================*/
(function (global) {
  'use strict';
  let active = null;

  function uid() { return 'stroke_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

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
    let record = DB.getWhiteboard(course.id) || { courseId: course.id, strokes: [], revision: 0, updatedAt: 0 };
    let strokes = clone(record.strokes || []);
    let clearEpoch = Number(record.clearEpoch) || 0;
    let deletedIds = new Set(record.deletedIds || []);
    let pendingRemote = null;
    let redoStack = [];
    let current = null;
    let dirty = false;
    let lastSave = 0;
    let saveTimer = null;
    let raf = 0;
    let tool = 'pen';
    let color = '#1f2937';
    let width = 3;
    let destroyed = false;
    const origin = Math.random().toString(36).slice(2);
    let channel = null;

    container.innerHTML = `
      <div class="card whiteboard-card">
        <div class="card-header"><div>
          <h3>🖍️ Whiteboard Kelas</h3>
          <p class="muted small" style="margin:4px 0 0;">${UI.esc(DB.courseTitle(course))} • ${editable ? 'admin/tutor dapat menggambar' : 'mode lihat saja'}</p>
        </div><span class="wb-save" id="wbSave">${record.updatedAt ? 'Tersimpan ' + UI.fmtRelative(record.updatedAt) : 'Belum ada coretan'}</span></div>
        ${editable ? `<div class="wb-toolbar" role="toolbar" aria-label="Alat whiteboard">
          <button type="button" class="btn btn-sm btn-primary is-active" data-wb-tool="pen">✏️ Pena</button>
          <button type="button" class="btn btn-sm btn-secondary" data-wb-tool="eraser">🧽 Penghapus</button>
          <label class="wb-field">Warna <input type="color" id="wbColor" value="#1f2937" /></label>
          <label class="wb-field">Tebal <input type="range" id="wbWidth" min="1" max="18" value="3" /></label>
          <button type="button" class="btn btn-sm btn-secondary" id="wbUndo" ${strokes.length ? '' : 'disabled'}>↶ Undo</button>
          <button type="button" class="btn btn-sm btn-secondary" id="wbRedo" disabled>↷ Redo</button>
          <button type="button" class="btn btn-sm btn-danger" id="wbClear" ${strokes.length ? '' : 'disabled'}>Hapus Semua</button>
        </div>` : `<div class="alert alert-info small">Whiteboard tersinkron otomatis. Siswa dan orang tua melihat hasil terbaru dalam mode baca.</div>`}
        <div class="wb-stage"><canvas id="wbCanvas" tabindex="0" aria-label="Whiteboard ${UI.esc(DB.courseTitle(course))}"></canvas></div>
        <div class="muted small wb-foot">Autosave setiap ≤1 detik dan saat pena dilepas. Sinkronisasi saat ini antar-tab/browser origin yang sama; lintas perangkat memerlukan backend realtime.</div>
      </div>`;

    const canvas = container.querySelector('#wbCanvas');
    const ctx = canvas.getContext('2d');
    const status = container.querySelector('#wbSave');

    function setStatus(text, cls) {
      status.textContent = text;
      status.className = 'wb-save ' + (cls || '');
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      const w = Math.max(300, Math.round(rect.width * dpr));
      const h = Math.max(260, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; draw(); }
    }

    function drawStroke(s) {
      const pts = s.points || [];
      if (!pts.length) return;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = (s.width || 3) * (canvas.width / Math.max(300, canvas.clientWidth));
      ctx.strokeStyle = s.color || '#1f2937';
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const x = p.x * canvas.width, y = p.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (pts.length === 1) ctx.lineTo(pts[0].x * canvas.width + .1, pts[0].y * canvas.height + .1);
      ctx.stroke(); ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokes.forEach(drawStroke);
      if (current) drawStroke(current);
    }

    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)), t: Date.now() };
    }

    function scheduleDraw() {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    }

    function markDirty() {
      dirty = true; setStatus('Menyimpan…', 'is-saving');
      if (!saveTimer) {
        const wait = Math.max(0, 1000 - (Date.now() - lastSave));
        saveTimer = setTimeout(flush, wait);
      }
      updateButtons();
    }

    function reconcile(remote) {
      if (!remote || remote.courseId !== course.id || remote.origin === origin) return;
      clearEpoch = Math.max(clearEpoch, Number(remote.clearEpoch) || 0);
      (remote.deletedIds || []).forEach(id => deletedIds.add(id));
      const map = new Map();
      (remote.strokes || []).concat(strokes).forEach(s => {
        if (!s || !s.id || deletedIds.has(s.id)) return;
        if ((Number(s.createdAt) || 0) < clearEpoch) return;
        map.set(s.id, s);
      });
      strokes = Array.from(map.values()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      record = Object.assign({}, record, {
        revision: Math.max(Number(record.revision) || 0, Number(remote.revision) || 0),
        updatedAt: Math.max(Number(record.updatedAt) || 0, Number(remote.updatedAt) || 0),
        clearEpoch, deletedIds: Array.from(deletedIds)
      });
    }

    function flush() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      if (!dirty || destroyed) return;
      try {
        // Reconcile lagi dengan storage terbaru tepat sebelum write untuk
        // mengurangi lost-update ketika dua tutor menggambar bersamaan.
        const latest = DB.getWhiteboard(course.id);
        if (latest && (latest.revision || 0) > (record.revision || 0)) {
          reconcile({ courseId: course.id, origin: 'storage-latest',
            strokes: latest.strokes, deletedIds: latest.deletedIds,
            clearEpoch: latest.clearEpoch, revision: latest.revision, updatedAt: latest.updatedAt });
        }
        record = DB.saveWhiteboard(course.id, {
          strokes: clone(strokes), deletedIds: Array.from(deletedIds),
          clearEpoch, revision: record.revision || 0
        }, user);
        lastSave = Date.now(); dirty = false;
        setStatus('Tersimpan sekarang', 'is-saved');
        broadcast();
      } catch (e) {
        setStatus('Gagal menyimpan', 'is-error');
        UI.toast(e.message || 'Whiteboard gagal disimpan. Penyimpanan browser mungkin penuh.', 'error');
      }
    }

    function broadcast() {
      if (!channel) return;
      try { channel.postMessage({ type: 'state', origin, courseId: course.id,
        revision: record.revision, updatedAt: record.updatedAt, strokes: clone(strokes),
        deletedIds: Array.from(deletedIds), clearEpoch }); } catch (e) {}
    }

    function mergeRemote(remote) {
      if (!remote || remote.courseId !== course.id || remote.origin === origin) return;
      if (current) {
        // Jangan buang update; antrekan revisi terbaru sampai pointer dilepas.
        if (!pendingRemote || (remote.revision || 0) >= (pendingRemote.revision || 0)) pendingRemote = remote;
        return;
      }
      reconcile(remote);
      redoStack = []; draw(); updateButtons(); setStatus('Tersinkron sekarang', 'is-saved');
    }

    function onStorage(e) {
      if (e.key !== 'lms_whiteboards') return;
      const fresh = DB.getWhiteboard(course.id);
      if (fresh) mergeRemote({ courseId: course.id, strokes: fresh.strokes,
        deletedIds: fresh.deletedIds, clearEpoch: fresh.clearEpoch,
        revision: fresh.revision, updatedAt: fresh.updatedAt, origin: 'storage' });
    }

    function updateButtons() {
      if (!editable) return;
      container.querySelector('#wbUndo').disabled = !strokes.length;
      container.querySelector('#wbRedo').disabled = !redoStack.length;
      container.querySelector('#wbClear').disabled = !strokes.length;
    }

    function pointerDown(e) {
      if (!editable || !DB.canEditWhiteboard(user, DB.getCourse(course.id)) || e.button > 0) return;
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      current = { id: uid(), createdAt: Date.now(), tool, color, width, points: [point(e)] };
      scheduleDraw();
    }
    function pointerMove(e) {
      if (!current) return;
      e.preventDefault(); current.points.push(point(e)); scheduleDraw();
    }
    function pointerUp(e) {
      if (!current) return;
      current.points.push(point(e));
      const localStroke = current;
      current = null;
      if (pendingRemote) { const queued = pendingRemote; pendingRemote = null; reconcile(queued); }
      if (!deletedIds.has(localStroke.id) && localStroke.createdAt >= clearEpoch) strokes.push(localStroke);
      redoStack = []; markDirty(); draw(); flush();
    }

    if (editable) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', pointerDown);
      canvas.addEventListener('pointermove', pointerMove);
      canvas.addEventListener('pointerup', pointerUp);
      canvas.addEventListener('pointercancel', pointerUp);
      container.querySelectorAll('[data-wb-tool]').forEach(b => b.addEventListener('click', () => {
        tool = b.dataset.wbTool;
        container.querySelectorAll('[data-wb-tool]').forEach(x => x.classList.toggle('btn-primary', x === b));
      }));
      container.querySelector('#wbColor').addEventListener('input', e => { color = e.target.value; tool = 'pen'; });
      container.querySelector('#wbWidth').addEventListener('input', e => { width = Number(e.target.value) || 3; });
      container.querySelector('#wbUndo').addEventListener('click', () => {
        if (!strokes.length || !DB.canEditWhiteboard(user, DB.getCourse(course.id))) return;
        const removed = strokes.pop();
        deletedIds.add(removed.id);
        redoStack.push(removed); markDirty(); draw();
      });
      container.querySelector('#wbRedo').addEventListener('click', () => {
        if (!redoStack.length || !DB.canEditWhiteboard(user, DB.getCourse(course.id))) return;
        const restored = redoStack.pop();
        deletedIds.delete(restored.id);
        if ((restored.createdAt || 0) < clearEpoch) restored.createdAt = Date.now();
        strokes.push(restored); markDirty(); draw();
      });
      container.querySelector('#wbClear').addEventListener('click', () => {
        // Guard ulang pada handler, bukan hanya menyembunyikan toolbar.
        if (!DB.canEditWhiteboard(user, course)) { UI.toast('Anda tidak boleh menghapus whiteboard ini.', 'error'); return; }
        if (!UI.confirmDialog('Hapus seluruh isi whiteboard kelas ini?')) return;
        redoStack = strokes.slice();
        strokes.forEach(s => deletedIds.add(s.id));
        clearEpoch = Date.now();
        strokes = []; markDirty(); draw(); flush();
      });
    }

    let ro = null;
    if ('ResizeObserver' in global) { ro = new ResizeObserver(resize); ro.observe(canvas); }
    else global.addEventListener('resize', resize);
    global.addEventListener('storage', onStorage);
    global.addEventListener('pagehide', flush);
    if ('BroadcastChannel' in global) {
      try { channel = new BroadcastChannel('lms-whiteboard-' + course.id); channel.addEventListener('message', e => mergeRemote(e.data)); }
      catch (e) { channel = null; }
    }

    resize(); draw(); updateButtons();

    active = {
      container,
      destroy() {
        flush();
        destroyed = true;
        if (saveTimer) clearTimeout(saveTimer);
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else global.removeEventListener('resize', resize);
        global.removeEventListener('storage', onStorage);
        global.removeEventListener('pagehide', flush);
        if (channel) channel.close();
        active = null;
      },
      flush,
      getState: () => ({ strokes: clone(strokes), record: clone(record), editable })
    };
    container.__whiteboardDispose = active.destroy;
    return active;
  }

  function destroy() {
    if (active && active.destroy) active.destroy();
  }

  global.Whiteboard = { mount, destroy };
})(window);
