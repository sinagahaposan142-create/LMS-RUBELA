/* =====================================================================
 * js/wb-hub.js — daftar papan tulis per kelas
 * ---------------------------------------------------------------------
 * Satu papan untuk tiap materi/pertemuan. Papan lama tetap dapat dibuka
 * dan diubah tutor; mentee & orang tua melihatnya per pertemuan atau per
 * materi. Isi papan digambar oleh js/whiteboard.js (Whiteboard.mount).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 16}" height="${s || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
    prev: svg('<path d="M15 18l-6-6 6-6"/>'),
    next: svg('<path d="M9 18l6-6-6-6"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    board: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 12l3-3 2 2 4-4"/>', 28),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 15)
  };
  const VIEW_KEY = 'lms_wbh_group';
  let cleanup = null;

  const ymdLabel = (ymd) => {
    if (!ymd) return '';
    const d = new Date(ymd + 'T00:00:00');
    return isNaN(d) ? ymd : d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  };
  /** Rencana kelas aktif, berurutan, bernomor "Pertemuan n". */
  /** Pertemuan kelas (urut tanggal & jam). Materi kosong diisi dari Rencana Materi minggu itu. */
  function meetings(course) {
    return DB.getClassPlansByCourse(course.id).filter(p => p.status !== 'cancelled')
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
      .map((p, i) => {
        const mp = p.topic ? null : DB.materialPlanForDate(course.id, p.date);
        return { id: p.id, no: i + 1, date: p.date, topic: String(p.topic || (mp && mp.title) || '').trim() };
      });
  }
  const personName = (id) => { const u = id && DB.getUser(id); return u ? u.name : (id === 'u_admin' || /admin/i.test(String(id || '')) ? 'Admin' : 'Tutor'); };
  const shortName = (name) => { const w = String(name || '').trim().split(/\s+/); return (/^(bu|ibu|pak|bapak|kak)$/i.test(w[0] || '') ? w.slice(0, 2) : w.slice(0, 1)).join(' '); };
  const pageCount = (b) => (Array.isArray(b.pages) && b.pages.length) || 1;

  function decorate(course) {
    const ms = meetings(course);
    const byPlan = new Map(ms.map(m => [m.id, m]));
    return DB.getCourseBoards(course.id).map(b => {
      const m = b.planId ? byPlan.get(b.planId) : null;
      return { b, m, title: DB.boardTitle(b), topic: String(b.topic || (m && m.topic) || '').trim(),
        when: m ? m.date : new Date(b.createdAt || b.updatedAt || Date.now()).toISOString().slice(0, 10),
        creator: personName(b.createdBy || b.updatedBy) };
    }).sort((x, y) => (y.when.localeCompare(x.when)) || ((y.b.createdAt || 0) - (x.b.createdAt || 0)));
  }

  function render(opts) {
    destroy();
    const o = opts || {};
    const { container, course, user } = o;
    if (!container || !course || !DB.canViewWhiteboard(user, course, o.childId)) {
      if (container) container.innerHTML = '<div class="alert alert-error">Anda tidak memiliki akses ke papan tulis kelas ini.</div>';
      return;
    }
    const editable = DB.canEditWhiteboard(user, course);
    let group = localStorage.getItem(VIEW_KEY) === 'materi' ? 'materi' : 'pertemuan';
    let query = '';
    let openId = o.boardId || null;
    let board = null;     // Whiteboard aktif

    function listHtml() {
      const all = decorate(course);
      const q = query.trim().toLowerCase();
      const items = q ? all.filter(x => (x.title + ' ' + x.topic + ' ' + x.creator).toLowerCase().includes(q)) : all;
      const used = DB.whiteboardMediaBytes(course.id);
      const head = `
        <div class="wbh-head">
          <div class="wbh-head-txt">
            <h3>Whiteboard</h3>
            <p class="muted small">${all.length ? `${all.length} papan` : 'Belum ada papan'} • satu papan untuk tiap materi atau pertemuan${editable && used ? ` • berkas ${(used / 1048576).toFixed(1).replace('.', ',')} / ${DB.WB_MEDIA_LIMIT / 1048576} MB` : ''}</p>
          </div>
          <div class="wbh-head-act">
            ${all.length > 1 ? `<div class="wbh-seg" role="group" aria-label="Kelompokkan papan">
              <button type="button" class="${group === 'pertemuan' ? 'is-on' : ''}" data-wbh-group="pertemuan" aria-pressed="${group === 'pertemuan'}">Per pertemuan</button>
              <button type="button" class="${group === 'materi' ? 'is-on' : ''}" data-wbh-group="materi" aria-pressed="${group === 'materi'}">Per materi</button></div>` : ''}
            ${editable ? `<button type="button" class="btn btn-primary btn-sm" data-wbh-new>${IC.plus} Papan baru</button>` : ''}
          </div>
        </div>
        ${all.length > 6 ? `<label class="wbh-search">${IC.search}<input type="search" id="wbhQ" placeholder="Cari judul, materi, atau pembuat…" value="${esc(query)}" aria-label="Cari papan" /></label>` : ''}`;
      if (!all.length) {
        return head + `<div class="wbh-empty">${IC.board}
          <strong>${editable ? 'Mulai papan pertama kelas ini' : 'Tutor belum membuat whiteboard'}</strong>
          <span class="muted small">${editable ? 'Buat satu papan untuk tiap pertemuan atau materi. Papan lama tetap tersimpan dan bisa diubah kapan saja.' : 'Whiteboard tiap pertemuan akan muncul di sini.'}</span>
          ${editable ? `<button type="button" class="btn btn-primary" data-wbh-new>${IC.plus} Buat papan</button>` : ''}</div>`;
      }
      if (!items.length) return head + '<div class="wbh-empty"><span class="muted">Tidak ada papan yang cocok.</span></div>';
      const card = (x) => {
        const b = x.b;
        const kicker = x.m ? `Pertemuan ${x.m.no} • ${ymdLabel(x.m.date)}` : ymdLabel(x.when);
        return `<li class="wbh-card">
          <button type="button" class="wbh-open" data-wbh-open="${esc(b.id)}" aria-label="Buka papan ${esc(x.title)}">
            <span class="wbh-thumb">${b.thumb ? `<img src="${esc(b.thumb)}" alt="" loading="lazy" />` : '<span class="wbh-thumb-empty" aria-hidden="true"></span>'}
              <span class="wbh-pages">${pageCount(b)} hlm</span></span>
            <span class="wbh-body">
              <span class="wbh-kicker">${esc(kicker)}</span>
              <strong class="wbh-name">${esc(x.title)}</strong>
              ${x.topic && group !== 'materi' ? `<span class="wbh-topic">${esc(x.topic)}</span>` : ''}
              <span class="wbh-meta">${esc(shortName(x.creator))} • ${b.updatedAt ? 'diubah ' + esc(UI.fmtRelative(b.updatedAt)) : 'belum diisi'}</span>
            </span>
          </button>
          ${editable ? `<div class="wbh-card-menu">${UI.actionMenu([
            { label: 'Ubah judul & materi', icon: IC.edit, attrs: `data-wbh-edit="${esc(b.id)}"` },
            { label: 'Hapus papan', icon: IC.trash, danger: true, attrs: `data-wbh-del="${esc(b.id)}"` }
          ], 'Aksi papan ' + x.title)}</div>` : ''}
        </li>`;
      };
      if (group === 'materi') {
        const groups = new Map();
        items.forEach(x => { const k = x.topic || 'Tanpa materi'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
        const keys = [...groups.keys()].sort((a, b) => (a === 'Tanpa materi') - (b === 'Tanpa materi') || a.localeCompare(b, 'id'));
        return head + keys.map(k => `<section class="wbh-group"><h4>${esc(k)} <span class="muted small">${groups.get(k).length} papan</span></h4>
          <ul class="wbh-grid">${groups.get(k).map(card).join('')}</ul></section>`).join('');
      }
      return head + `<ul class="wbh-grid">${items.map(card).join('')}</ul>`;
    }

    function paintList() {
      if (board) { Whiteboard.destroy(); board = null; }
      openId = null;
      container.innerHTML = `<div class="card wbh">${listHtml()}</div>`;
      const root = container.querySelector('.wbh');
      root.querySelectorAll('[data-wbh-group]').forEach(b => b.addEventListener('click', () => {
        group = b.dataset.wbhGroup; try { localStorage.setItem(VIEW_KEY, group); } catch (e) { /* abaikan */ }
        paintList();
      }));
      root.querySelectorAll('[data-wbh-new]').forEach(b => b.addEventListener('click', () => openForm(null)));
      root.querySelectorAll('[data-wbh-open]').forEach(b => b.addEventListener('click', () => openBoard(b.dataset.wbhOpen)));
      root.querySelectorAll('[data-wbh-edit]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.wbhEdit)));
      root.querySelectorAll('[data-wbh-del]').forEach(b => b.addEventListener('click', () => removeBoard(b.dataset.wbhDel)));
      const q = root.querySelector('#wbhQ');
      if (q) q.addEventListener('input', () => {
        query = q.value;
        const pos = q.selectionStart;
        paintList();
        const q2 = container.querySelector('#wbhQ');
        if (q2) { q2.focus(); try { q2.setSelectionRange(pos, pos); } catch (e) { /* abaikan */ } }
      });
    }

    function openBoard(id, after) {
      const list = decorate(course);
      const i = list.findIndex(x => x.b.id === id);
      if (i < 0) { UI.toast('Papan tidak ditemukan.', 'error'); paintList(); return; }
      const x = list[i];
      // Urutan daftar: terbaru dulu. "Sebelumnya" = pertemuan lebih lama.
      const older = list[i + 1], newer = list[i - 1];
      openId = id;
      if (board) { Whiteboard.destroy(); board = null; }
      const bits = [x.topic && `Materi: ${x.topic}`, x.m && `Pertemuan ${x.m.no} • ${ymdLabel(x.m.date)}`, `oleh ${x.creator}`].filter(Boolean);
      container.innerHTML = `
        <div class="wbh-crumb">
          <button type="button" class="btn btn-secondary btn-sm" data-wbh-back>${IC.back} Semua papan</button>
          <div class="wbh-crumb-info"><strong>${esc(x.title)}</strong><span>${esc(bits.join(' • '))}</span></div>
          <div class="wbh-crumb-nav">
            <button type="button" class="wb-ibtn" data-wbh-go="${older ? esc(older.b.id) : ''}" ${older ? '' : 'disabled'} title="${older ? 'Papan sebelumnya: ' + esc(older.title) : 'Tidak ada papan sebelumnya'}" aria-label="Papan sebelumnya">${IC.prev}</button>
            <span class="wbh-pos">${list.length - i}/${list.length}</span>
            <button type="button" class="wb-ibtn" data-wbh-go="${newer ? esc(newer.b.id) : ''}" ${newer ? '' : 'disabled'} title="${newer ? 'Papan berikutnya: ' + esc(newer.title) : 'Ini papan terbaru'}" aria-label="Papan berikutnya">${IC.next}</button>
            ${editable ? `<button type="button" class="wb-ibtn" data-wbh-info title="Ubah judul & materi" aria-label="Ubah judul dan materi">${IC.edit}</button>` : ''}
          </div>
        </div>
        <div id="wbhMount"></div>`;
      container.querySelector('[data-wbh-back]').addEventListener('click', paintList);
      container.querySelectorAll('[data-wbh-go]').forEach(b => b.addEventListener('click', () => { if (b.dataset.wbhGo) openBoard(b.dataset.wbhGo); }));
      const info = container.querySelector('[data-wbh-info]');
      if (info) info.addEventListener('click', () => openForm(id));
      board = Whiteboard.mount({ container: container.querySelector('#wbhMount'), course, user, childId: o.childId, boardId: id });
      if (board && after) after(board);
    }

    function removeBoard(id) {
      const b = DB.getWhiteboardBoard(id);
      if (!b) return;
      const pages = pageCount(b), files = (b.media || []).length;
      if (!UI.confirmDialog(`Hapus papan "${DB.boardTitle(b)}"? ${pages} halaman${files ? ` dan ${files} berkas PDF/gambar` : ''} ikut terhapus dan tidak dapat dikembalikan.`)) return;
      try { DB.deleteWhiteboardBoard(id, user); UI.toast('Papan dihapus.'); paintList(); }
      catch (e) { UI.toast(e.message, 'error'); }
    }

    /** Formulir papan baru / ubah info. Memilih pertemuan mengisi materi & judul otomatis. */
    function openForm(id) {
      const rec = id ? DB.getWhiteboardBoard(id) : null;
      const ms = meetings(course);
      const taken = new Set(DB.getCourseBoards(course.id).filter(b => b.id !== id).map(b => b.planId).filter(Boolean));
      const today = UI.todayYMD();
      // Pertemuan bawaan: hari ini, atau pertemuan berikutnya yang belum punya papan.
      const defPlan = rec ? (rec.planId || '') : ((ms.find(m => m.date === today && !taken.has(m.id)) || ms.find(m => m.date >= today && !taken.has(m.id)) || {}).id || '');
      // Pilihan materi: Rencana Materi kelas dulu, lalu Materi subtest, materi pertemuan, dan papan lain.
      const topics = new Set(DB.materialChoices(course.id).map(m => m.name));
      ms.forEach(m => { if (m.topic) topics.add(m.topic); });
      DB.getCourseBoards(course.id).forEach(b => { if (b.topic) topics.add(b.topic); });
      UI.modal.open(rec ? 'Ubah Info Papan' : 'Whiteboard Baru', `
        <form class="form" id="wbhForm" novalidate>
          <div class="form-group">
            <label for="wbhPlan">Pertemuan</label>
            <select id="wbhPlan">
              <option value="">— Tidak terkait jadwal —</option>
              ${ms.map(m => `<option value="${esc(m.id)}" ${m.id === defPlan ? 'selected' : ''}>Pertemuan ${m.no} • ${esc(ymdLabel(m.date))}${m.topic ? ' • ' + esc(m.topic.slice(0, 50)) : ''}${taken.has(m.id) ? ' (sudah ada papan)' : ''}</option>`).join('')}
            </select>
            ${ms.length ? '' : '<div class="muted small">Belum ada rencana kelas. Papan tetap bisa dibuat tanpa jadwal.</div>'}
          </div>
          <div class="form-group">
            <label for="wbhTopic">Materi</label>
            <input id="wbhTopic" maxlength="120" list="wbhTopics" placeholder="mis. Barisan & Deret Aritmetika" value="${esc(rec ? rec.topic || '' : '')}" />
            <datalist id="wbhTopics">${[...topics].slice(0, 80).map(t => `<option value="${esc(t)}"></option>`).join('')}</datalist>
          </div>
          <div class="form-group">
            <label for="wbhTitle">Judul papan</label>
            <input id="wbhTitle" maxlength="100" required placeholder="mis. Pertemuan 3 — Barisan Aritmetika" value="${esc(rec ? DB.boardTitle(rec) : '')}" />
          </div>
          ${rec ? '' : `<div class="form-group">
            <label for="wbhFile">Isi awal <span class="muted">(opsional)</span></label>
            <input type="file" id="wbhFile" accept="application/pdf,image/png,image/jpeg,image/webp" multiple />
            <div class="muted small">PDF atau gambar menjadi halaman papan (maks. 15 halaman, berkas ≤ 10 MB). Total berkas whiteboard per kelas ${DB.WB_MEDIA_LIMIT / 1048576} MB.</div>
          </div>`}
          <div class="wbh-form-act">
            <button type="button" class="btn btn-secondary" data-wbh-cancel>Batal</button>
            <button type="submit" class="btn btn-primary">${rec ? 'Simpan' : 'Buat papan'}</button>
          </div>
        </form>`);
      const f = document.getElementById('wbhForm');
      const plan = f.querySelector('#wbhPlan'), topic = f.querySelector('#wbhTopic'), title = f.querySelector('#wbhTitle');
      let titleTouched = !!rec, topicTouched = !!(rec && rec.topic);
      const suggest = () => {
        const m = ms.find(x => x.id === plan.value);
        if (m && !topicTouched && m.topic) topic.value = m.topic;
        if (!titleTouched) title.value = [m ? `Pertemuan ${m.no}` : '', topic.value.trim()].filter(Boolean).join(' — ') || '';
      };
      plan.addEventListener('change', suggest);
      topic.addEventListener('input', () => { topicTouched = true; if (!titleTouched) suggest(); });
      title.addEventListener('input', () => { titleTouched = true; });
      if (!rec) suggest();
      f.querySelector('[data-wbh-cancel]').addEventListener('click', () => UI.modal.close());
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const meta = { title: title.value.trim(), topic: topic.value.trim(), planId: plan.value || null };
        if (!meta.title) { title.focus(); UI.toast('Judul papan wajib diisi.', 'error'); return; }
        try {
          if (rec) {
            DB.updateWhiteboardMeta(rec.id, meta, user);
            UI.modal.close();
            UI.toast('Info papan disimpan.');
            if (openId === rec.id) openBoard(rec.id); else paintList();
            return;
          }
          const files = Array.from((f.querySelector('#wbhFile') || {}).files || []);
          const made = DB.createWhiteboardBoard(course.id, meta, user);
          UI.modal.close();
          openBoard(made.id, files.length ? (wb) => wb.importFiles(files) : null);
        } catch (err) { UI.toast(err.message, 'error'); }
      });
    }

    function onRemote(e) {
      if (!container.isConnected) { destroy(); return; }
      const keys = (e.detail && e.detail.keys) || [];
      if (!openId && (keys.includes('lms_whiteboards') || keys.includes('lms_class_plans'))) paintList();
    }
    global.addEventListener('lms:remote-change', onRemote);
    cleanup = () => { global.removeEventListener('lms:remote-change', onRemote); if (board) Whiteboard.destroy(); board = null; };

    if (openId && DB.getWhiteboardBoard(openId)) openBoard(openId); else paintList();
  }

  function destroy() {
    if (cleanup) { const c = cleanup; cleanup = null; c(); }
    else if (global.Whiteboard) Whiteboard.destroy();
  }

  global.WbHub = { render, destroy };
})(window);
