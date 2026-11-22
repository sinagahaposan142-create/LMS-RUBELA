/* =====================================================================
 * js/tryout.js — CBT Tryout untuk semua mentee
 * ---------------------------------------------------------------------
 * Alur:
 *   1. Admin membuat tryout di halaman CBT (judul, deskripsi, subtest beserta
 *      target soal & durasi, jadwal). Tryout tersimpan sebagai DRAF.
 *   2. Tutor melihat draf di dashboard CBT-nya lalu menyetor soal sesuai
 *      subtest yang diampu: memilih dari Bank Soal (halaman penuh) atau membuat
 *      soal baru dengan alat Bank Soal (editor, massal, Excel/CSV, PDF/Word/teks + AI).
 *      Setoran disimpan di lms_cbt_contribs (pending) — tutor tidak menulis tryout.
 *   3. Admin meninjau setoran (terima/tolak) dan dapat menambah soal sendiri.
 *   4. Admin menerbitkan tryout: tampil ke mentee sekarang atau pada waktu
 *      tertentu. Draf tidak pernah tampil ke mentee (juga ditegakkan server).
 * ===================================================================*/
(function (global) {
  const esc = (s) => UI.esc(s);
  const now = () => Date.now();
  let wsEl = null;

  /* ---------------- utilitas ---------------- */
  const subMeta = (name) => DB.subtestByName(name) || { name, short: name, icon: '📘', defaultMinutes: 30 };
  const activeStudents = () => DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
  const adminIds = (exceptId) => DB.getUsers().filter(u => u.role === 'admin' && u.id !== exceptId && (u.status || 'Aktif') !== 'Dikeluarkan').map(u => u.id);
  const fmtRange = (c) => `${UI.fmtDateTime(c.startAt)} s.d. ${UI.fmtDateTime(c.endAt)}`;
  const isLocked = (c) => DB.getCbtAttemptsByCbt(c.id).length > 0;

  /** draft | scheduled (terbit, belum tampil) | upcoming | live | done */
  function stateOf(c) {
    const t = now();
    if (c.status !== 'published') return 'draft';
    if ((Number(c.publishAt) || 0) > t) return 'scheduled';
    if (t < c.startAt) return 'upcoming';
    if (t <= c.endAt) return 'live';
    return 'done';
  }
  const STATE = {
    draft: ['badge-gray', 'Draf'],
    scheduled: ['badge-info', 'Terbit terjadwal'],
    upcoming: ['badge-info', 'Terbit · akan dibuka'],
    live: ['badge-success', 'Sedang berlangsung'],
    done: ['badge-gray', 'Selesai']
  };
  const stateBadge = (c) => { const s = STATE[stateOf(c)]; return `<span class="badge ${s[0]}">${s[1]}</span>`; };

  /** Setoran yang soalnya masih ada di Bank Soal. */
  function contribsOf(c, filter) {
    return DB.getCbtContribs(c.id).filter(x => DB.getQuestion(x.questionId)).filter(filter || (() => true));
  }
  function progressOf(c) {
    const pend = contribsOf(c, x => x.status === 'pending');
    const per = DB.tryoutSections(c).map(s => ({
      subtest: s.subtest, have: (s.questionIds || []).length, target: Number(s.target) || 0,
      minutes: Number(s.durationMinutes) || subMeta(s.subtest).defaultMinutes || 30,
      pending: pend.filter(x => x.subtest === s.subtest).length
    }));
    const have = per.reduce((n, s) => n + s.have, 0);
    const target = per.reduce((n, s) => n + s.target, 0);
    return { per, have, target, pending: pend.length, pct: target ? Math.min(100, Math.round(have / target * 100)) : (have ? 100 : 0) };
  }
  function progressBar(p) {
    return `<div class="to-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="Kelengkapan soal">
      <span style="width:${p.pct}%"></span></div>`;
  }
  function subChips(p, only) {
    return `<div class="to-subs">${p.per.filter(s => !only || only.includes(s.subtest)).map(s => {
      const m = subMeta(s.subtest);
      const full = s.target ? s.have >= s.target : s.have > 0;
      return `<span class="to-subchip ${full ? 'is-full' : ''}" title="${esc(m.name)}">${m.icon} ${esc(m.short)} <b>${s.have}${s.target ? '/' + s.target : ''}</b>${s.pending ? `<i title="Setoran menunggu tinjauan">+${s.pending}</i>` : ''}</span>`;
    }).join('')}</div>`;
  }
  function qCardHtml(q, extra) {
    const s = subMeta(q.subject);
    const tl = global.Topics ? Topics.labelOf(q) : null;
    return `<div class="to-q">
      <div class="qp-meta"><span class="qc-chip sub">${s.icon} ${esc(s.short)}</span>
        <span class="qp-path">${tl ? esc(tl.text) : '<span class="muted">Belum diberi materi</span>'}</span>
        <span class="qc-chip type">${esc(q.questionType || 'Pilihan Ganda')}</span>
        <span class="qc-chip d-${esc((q.difficulty || 'sedang').toLowerCase())}">${esc(q.difficulty || 'sedang')}</span>
        ${global.Passages ? Passages.chip(q) : ''}</div>
      <div class="to-q-text rt-content">${RichText.render(q.text)}</div>
      ${extra || ''}
    </div>`;
  }

  /* ---------------- workspace halaman penuh ---------------- */
  function openWs(title, subtitle, actionsHtml, onBack) {
    closeWs();
    if (global.CbtAdmin) CbtAdmin.closeWorkspace();
    wsEl = document.createElement('div');
    wsEl.className = 'cbt-workspace to-ws';
    wsEl.innerHTML = `
      <div class="cbt-ws-top">
        <button class="btn btn-secondary btn-sm" data-to-back>← Kembali</button>
        <div><h3 class="ws-title">${esc(title)}</h3><div class="ws-sub">${esc(subtitle || '')}</div></div>
        <div class="ws-spacer"></div>
        <div class="flex-gap" id="wsActions">${actionsHtml || ''}</div>
      </div>
      <div class="cbt-ws-body"><div class="cbt-ws-inner" data-to-body></div></div>`;
    document.body.appendChild(wsEl);
    document.body.style.overflow = 'hidden';
    wsEl.querySelector('[data-to-back]').addEventListener('click', () => { closeWs(); if (typeof onBack === 'function') onBack(); });
    return wsEl.querySelector('[data-to-body]');
  }
  function closeWs() {
    if (!wsEl) return;
    wsEl.remove();
    wsEl = null;
    document.body.style.overflow = '';
  }

  /* =====================================================================
   * Admin: panel di halaman CBT
   * ===================================================================*/
  let showDone = false;
  function renderAdminPanel(host, user, reload) {
    const all = DB.getTryouts().slice();
    const order = { draft: 0, scheduled: 1, live: 2, upcoming: 3, done: 4 };
    all.sort((a, b) => (order[stateOf(a)] - order[stateOf(b)]) || (a.startAt - b.startAt));
    const done = all.filter(c => stateOf(c) === 'done');
    const list = showDone ? all : all.filter(c => stateOf(c) !== 'done');
    const pendTotal = all.reduce((n, c) => n + contribsOf(c, x => x.status === 'pending').length, 0);
    host.innerHTML = `
      <div class="card to-panel">
        <div class="card-header">
          ${UI.secHead('🏁', 'CBT Tryout', `untuk semua mentee • tutor menyetor soal per subtest${pendTotal ? ` • ${pendTotal} setoran menunggu tinjauan` : ''}`)}
          <button type="button" class="btn btn-primary btn-sm" data-to-new>+ Buat Tryout</button>
        </div>
        ${list.length ? `<div class="to-list">${list.map(c => adminRowHtml(c)).join('')}</div>`
          : `<div class="empty"><div class="empty-icon">🏁</div>${all.length ? 'Tidak ada tryout aktif.' : 'Belum ada tryout. Buat tryout baru, lalu tutor dapat menyetor soal sesuai subtestnya.'}</div>`}
        ${done.length ? `<button type="button" class="btn btn-ghost btn-sm" data-to-done>${showDone ? 'Sembunyikan' : 'Tampilkan'} tryout selesai (${done.length})</button>` : ''}
      </div>`;
    host.querySelector('[data-to-new]').addEventListener('click', () => openForm(user, null, reload));
    const td = host.querySelector('[data-to-done]');
    if (td) td.addEventListener('click', () => { showDone = !showDone; renderAdminPanel(host, user, reload); });
    host.querySelectorAll('[data-to-act]').forEach(b => b.addEventListener('click', () => {
      const c = DB.getCbt(b.dataset.id);
      if (!c) return;
      const act = b.dataset.toAct;
      if (act === 'studio') openStudio(user, c.id, reload);
      else if (act === 'edit') openForm(user, c.id, reload);
      else if (act === 'publish') openPublish(user, c.id, reload);
      else if (act === 'draft') revertToDraft(user, c, reload);
      else if (act === 'monitor') CbtAdmin.openMonitor(c.id, user, reload);
      else if (act === 'results') CbtAdmin.openResults(c.id, user, reload);
      else if (act === 'delete') {
        const n = DB.getCbtAttemptsByCbt(c.id).length;
        if (!UI.confirmDialog(`Hapus tryout "${c.title}"?${n ? ` ${n} hasil pengerjaan mentee ikut terhapus.` : ''} Setoran soal tutor juga dihapus (soal tetap ada di Bank Soal).`)) return;
        DB.deleteCbt(c.id);
        UI.toast('Tryout dihapus.');
        reload();
      }
    }));
  }
  function adminRowHtml(c) {
    const p = progressOf(c);
    const s = stateOf(c);
    const att = DB.getCbtAttemptsByCbt(c.id);
    const done = att.filter(a => a.submittedAt).length;
    const btn = (act, label, cls) => `<button type="button" class="btn btn-sm ${cls || 'btn-secondary'}" data-to-act="${act}" data-id="${esc(c.id)}">${label}</button>`;
    return `<article class="to-row">
      <div class="to-row-main">
        <div class="to-row-title"><strong>${esc(c.title)}</strong> ${stateBadge(c)}
          ${p.pending ? `<span class="badge badge-warning">${p.pending} setoran menunggu</span>` : ''}</div>
        <div class="muted small">${fmtRange(c)}${s === 'scheduled' ? ` • tampil ke mentee ${esc(UI.fmtDateTime(c.publishAt))}` : ''}${s !== 'draft' ? ` • ${done} mengerjakan` : ''}</div>
        <div class="to-row-prog">${progressBar(p)}<span class="small"><b>${p.have}</b>${p.target ? ` / ${p.target}` : ''} soal</span></div>
        ${subChips(p)}
      </div>
      <div class="to-row-actions">
        ${btn('studio', 'Kelola soal', 'btn-primary')}
        ${btn('edit', 'Edit info')}
        ${s === 'draft' ? btn('publish', 'Terbitkan', 'btn-success') : (att.length ? '' : btn('draft', 'Kembalikan ke draf'))}
        ${s !== 'draft' ? btn('monitor', 'Pantau') + btn('results', 'Hasil') : ''}
        ${btn('delete', 'Hapus', 'btn-danger')}
      </div>
    </article>`;
  }

  /* =====================================================================
   * Admin: form buat / edit tryout
   * ===================================================================*/
  function openForm(user, editId, onDone) {
    const editing = editId ? DB.getCbt(editId) : null;
    const locked = editing ? isLocked(editing) : false;
    const secMap = new Map((editing ? DB.tryoutSections(editing) : []).map(s => [s.subtest, s]));
    const sec = DB.getSettings().examSecurityDefaults || {};
    const security = Object.assign({ requireCamera: false, requireMic: false, requireScreenShare: false, fullscreen: true, lockScreen: true,
      blockTabSwitch: true, blockCopy: true, blockScreenshot: true, maxViolations: 3 }, sec, (editing && editing.security) || {});
    // Bawaan: sepekan lagi pukul 08.00 waktu LMS.
    const start = editing ? editing.startAt : UI.tzInputToUtc(UI.toDateTimeLocalInput(now() + 7 * 86400000).slice(0, 10) + 'T08:00');
    const end = editing ? editing.endAt : start + 10 * 3600000;
    const SEC = [
      ['fullscreen', 'Paksa layar penuh'], ['lockScreen', 'Kunci layar saat keluar'], ['blockTabSwitch', 'Deteksi pindah tab'],
      ['blockCopy', 'Anti salin soal'], ['blockScreenshot', 'Anti tangkapan layar'], ['requireCamera', 'Wajib kamera'], ['requireMic', 'Wajib mikrofon']
    ];
    const body = openWs(editing ? 'Edit Tryout' : 'Buat Tryout', editing ? editing.title : 'Tryout untuk semua mentee; tersimpan sebagai draf sampai diterbitkan', '', onDone);
    body.innerHTML = `
      <form class="form to-form" data-to-form novalidate>
        <div class="card">
          <div class="card-header">${UI.secHead('📝', 'Informasi Tryout', 'nama, deskripsi, dan jadwal ujian')}</div>
          <div class="form-group"><label for="toTitle">Nama tryout</label>
            <input id="toTitle" name="title" required maxlength="140" value="${esc(editing ? editing.title : '')}" placeholder="mis. Tryout UTBK Nasional #3" /></div>
          <div class="form-group"><label for="toDesc">Deskripsi <span class="muted small">(opsional)</span></label>
            <textarea id="toDesc" name="description" rows="3" maxlength="2000" placeholder="Petunjuk, cakupan materi, atau catatan untuk mentee">${esc(editing ? editing.description || '' : '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label for="toStart">Dibuka</label><input id="toStart" type="datetime-local" name="startAt" required value="${esc(UI.toDateTimeLocalInput(start))}" /></div>
            <div class="form-group"><label for="toEnd">Ditutup</label><input id="toEnd" type="datetime-local" name="endAt" required value="${esc(UI.toDateTimeLocalInput(end))}" /></div>
          </div>
          <p class="muted small">Peserta: semua mentee aktif. Tryout tidak terikat kelas.</p>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('🧪', 'Subtest', 'centang subtest yang diujikan; target = jumlah soal yang dikumpulkan dari tutor & admin')}</div>
          ${locked ? '<div class="alert alert-warning">Sudah ada mentee yang mengerjakan tryout ini, jadi subtest tidak dapat diubah. Jadwal & informasi tetap dapat diperbarui.</div>' : ''}
          <div class="to-secgrid">
            ${DB.SUBTESTS.map(s => {
              const cur = secMap.get(s.name);
              const on = editing ? !!cur : true;
              const n = cur ? (cur.questionIds || []).length : 0;
              return `<div class="to-secrow ${on ? 'is-on' : ''}">
                <label class="to-secname"><input type="checkbox" data-sec-on="${esc(s.name)}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} />
                  <span>${s.icon} <strong>${esc(s.short)}</strong> <small>${esc(s.name)}</small></span></label>
                <label class="to-num">Target <input type="number" min="1" max="200" data-sec-target="${esc(s.name)}" value="${cur && cur.target ? cur.target : 20}" ${on && !locked ? '' : 'disabled'} /> soal</label>
                <label class="to-num">Durasi <input type="number" min="1" max="240" data-sec-min="${esc(s.name)}" value="${cur ? cur.durationMinutes || s.defaultMinutes : s.defaultMinutes}" ${on && !locked ? '' : 'disabled'} /> menit</label>
                ${n ? `<span class="muted small">${n} soal terkumpul</span>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('🔒', 'Penilaian & Keamanan', 'bawaan mengikuti pengaturan ujian lembaga')}</div>
          ${global.Scoring ? `<div class="form-group"><label for="toScore">Sistem penilaian</label>
            <select id="toScore" name="scoringMode">${Object.keys(Scoring.MODES).map(k => `<option value="${k}" ${Scoring.modeOf(editing) === k ? 'selected' : ''}>${esc(Scoring.MODES[k].label)}</option>`).join('')}</select></div>` : ''}
          <div class="to-secopts">${SEC.map(([k, l]) => `<label><input type="checkbox" data-secopt="${k}" ${security[k] ? 'checked' : ''} /> ${esc(l)}</label>`).join('')}</div>
        </div>

        <div class="to-formbar">
          <button type="button" class="btn btn-secondary" data-to-cancel>Batal</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Simpan perubahan' : 'Simpan sebagai draf'}</button>
        </div>
      </form>`;
    const form = body.querySelector('[data-to-form]');
    form.querySelectorAll('[data-sec-on]').forEach(cb => cb.addEventListener('change', () => {
      const n = cb.dataset.secOn;
      const cur = secMap.get(n);
      if (!cb.checked && cur && (cur.questionIds || []).length && !UI.confirmDialog(`${subMeta(n).short} sudah berisi ${(cur.questionIds || []).length} soal. Soal-soal itu dilepas dari tryout bila subtest ini dihapus. Lanjutkan?`)) { cb.checked = true; return; }
      form.querySelectorAll(`[data-sec-target="${CSS.escape(n)}"], [data-sec-min="${CSS.escape(n)}"]`).forEach(i => { i.disabled = !cb.checked; });
      cb.closest('.to-secrow').classList.toggle('is-on', cb.checked);
    }));
    form.querySelector('[data-to-cancel]').addEventListener('click', () => { closeWs(); if (typeof onDone === 'function') onDone(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.querySelector('#toTitle').value.trim();
      const startAt = UI.tzInputToUtc(form.querySelector('#toStart').value);
      const endAt = UI.tzInputToUtc(form.querySelector('#toEnd').value);
      if (title.length < 3) { UI.toast('Nama tryout minimal 3 karakter.', 'error'); form.querySelector('#toTitle').focus(); return; }
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) { UI.toast('Isi jadwal dibuka dan ditutup.', 'error'); return; }
      if (endAt <= startAt) { UI.toast('Waktu ditutup harus setelah waktu dibuka.', 'error'); return; }
      let sections;
      if (locked) sections = editing.sections;
      else {
        sections = [];
        for (const s of DB.SUBTESTS) {
          const on = form.querySelector(`[data-sec-on="${CSS.escape(s.name)}"]`).checked;
          if (!on) continue;
          const target = Math.round(Number(form.querySelector(`[data-sec-target="${CSS.escape(s.name)}"]`).value));
          const minutes = Math.round(Number(form.querySelector(`[data-sec-min="${CSS.escape(s.name)}"]`).value));
          if (!(target >= 1 && target <= 200)) { UI.toast(`Target soal ${s.short} harus 1–200.`, 'error'); return; }
          if (!(minutes >= 1 && minutes <= 240)) { UI.toast(`Durasi ${s.short} harus 1–240 menit.`, 'error'); return; }
          const cur = secMap.get(s.name);
          sections.push({ subtest: s.name, questionIds: cur ? (cur.questionIds || []).slice() : [], durationMinutes: minutes, target });
        }
        if (!sections.length) { UI.toast('Pilih minimal satu subtest.', 'error'); return; }
      }
      const securityOut = Object.assign({}, security);
      form.querySelectorAll('[data-secopt]').forEach(cb => { securityOut[cb.dataset.secopt] = cb.checked; });
      const scoreSel = form.querySelector('#toScore');
      const payload = {
        title, description: form.querySelector('#toDesc').value.trim(), startAt, endAt, sections,
        questionIds: sections.flatMap(s => s.questionIds || []),
        durationMinutes: sections.reduce((n, s) => n + (Number(s.durationMinutes) || 0), 0),
        security: securityOut, scoringMode: scoreSel ? scoreSel.value : 'irt'
      };
      if (editing) {
        // Jadwal dimajukan: waktu tampil ke mentee tidak boleh melewati waktu dibuka.
        if (editing.publishAt && Number(editing.publishAt) > startAt) payload.publishAt = Math.max(now(), Math.min(Number(editing.publishAt), startAt));
        DB.updateCbt(editing.id, DB.stampEditor(payload, user));
        UI.toast('Tryout diperbarui.');
        closeWs();
        if (typeof onDone === 'function') onDone();
        return;
      }
      const created = DB.addCbt(DB.stampCreator(Object.assign(payload, {
        kind: 'tryout', status: 'draft', publishAt: null, subtestMode: sections.length === DB.SUBTESTS.length ? 'full' : 'custom',
        selectedSubtest: null, targetClasses: [DB.ALL_CLASSES], courseIds: [], courseId: null, active: true
      }), user, DB.ADMIN_OWNER));
      // Beri tahu tutor yang mengampu subtest tryout ini.
      const subsSet = new Set(sections.map(s => s.subtest));
      const tutors = DB.getUsers().filter(u => u.role === 'guru' && (u.status || 'Aktif') === 'Aktif'
        && DB.tutorTryoutSubtests(u).some(n => subsSet.has(n)));
      DB.notifyUsers(tutors.map(t => t.id), {
        type: 'cbt', icon: '🏁', title: 'Tryout baru butuh soal',
        body: `${title}: setor soal sesuai subtest Anda sebelum ${UI.fmtDateTime(startAt)}.`, link: 'cbt'
      });
      UI.toast(`Tryout tersimpan sebagai draf. ${tutors.length} tutor diberi tahu untuk menyetor soal.`, 'success');
      openStudio(user, created.id, onDone);
    });
    if (global.Effects) Effects.enhance(body);
  }

  /* =====================================================================
   * Admin: kelola soal (studio) — tinjau setoran, tambah & lepas soal
   * ===================================================================*/
  function openStudio(user, id, onDone, startSub) {
    let c = DB.getCbt(id);
    if (!c) return;
    let sub = startSub || (DB.tryoutSections(c)[0] || {}).subtest;
    const body = openWs('Kelola Soal Tryout', c.title, `
      <button type="button" class="btn btn-secondary btn-sm" data-st-edit>Edit info</button>
      <button type="button" class="btn btn-success btn-sm" data-st-pub hidden>Terbitkan</button>`, onDone);
    wsEl.querySelector('[data-st-edit]').addEventListener('click', () => openForm(user, id, () => openStudio(user, id, onDone, sub)));
    wsEl.querySelector('[data-st-pub]').addEventListener('click', () => openPublish(user, id, () => openStudio(user, id, onDone, sub)));
    paint();

    function setSections(mut) {
      c = DB.getCbt(id);
      const sections = DB.tryoutSections(c).map(s => Object.assign({}, s, { questionIds: (s.questionIds || []).slice() }));
      mut(sections);
      sections.forEach(s => { s.questionIds = DB.groupByPassage([...new Set(s.questionIds)].filter(q => DB.getQuestion(q))); });
      DB.updateCbt(id, DB.stampEditor({ sections, questionIds: sections.flatMap(s => s.questionIds) }, user));
      c = DB.getCbt(id);
    }
    /** Terima/tolak setoran; tutor diberi satu notifikasi ringkas per orang. */
    function review(list, status, note) {
      if (!list.length) return;
      if (status === 'accepted') setSections(secs => list.forEach(x => {
        const s = secs.find(y => y.subtest === x.subtest);
        if (s && !s.questionIds.includes(x.questionId)) s.questionIds.push(x.questionId);
      }));
      const byTutor = new Map();
      list.forEach(x => {
        DB.reviewCbtContrib(x.id, status, user, note);
        byTutor.set(x.by, (byTutor.get(x.by) || 0) + 1);
      });
      byTutor.forEach((n, tid) => {
        if (tid === user.id) return;
        DB.addNotification({ userId: tid, type: 'cbt', icon: status === 'accepted' ? '✅' : '↩️', link: 'cbt',
          title: `${n} setoran soal ${status === 'accepted' ? 'diterima' : 'ditolak'}`,
          body: `${c.title}${note ? ' • ' + note : ''}` });
      });
      UI.toast(`${list.length} setoran ${status === 'accepted' ? 'diterima & masuk tryout' : 'ditolak'}.`, 'success');
      paint();
    }
    function askReject(list) {
      UI.modal.open(`Tolak ${list.length} setoran`, `
        <form id="toRejForm" class="form">
          <div class="form-group"><label for="toRejNote">Alasan untuk tutor <span class="muted small">(opsional)</span></label>
            <textarea id="toRejNote" rows="3" maxlength="300" placeholder="mis. kunci jawaban perlu diperiksa, soal mirip dengan yang sudah ada"></textarea></div>
          <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button>
            <button type="submit" class="btn btn-danger">Tolak</button></div>
        </form>`);
      const f = document.getElementById('toRejForm');
      f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
      f.addEventListener('submit', (e) => { e.preventDefault(); const note = f.querySelector('#toRejNote').value.trim(); UI.modal.close(); review(list, 'rejected', note); });
    }

    function paint() {
      c = DB.getCbt(id);
      if (!c) { closeWs(); if (typeof onDone === 'function') onDone(); return; }
      const secs = DB.tryoutSections(c);
      if (!secs.some(s => s.subtest === sub)) sub = (secs[0] || {}).subtest;
      const p = progressOf(c);
      const locked = isLocked(c);
      const pubBtn = wsEl.querySelector('[data-st-pub]');
      pubBtn.hidden = c.status === 'published';
      const sec = secs.find(s => s.subtest === sub) || { questionIds: [] };
      const ps = p.per.find(x => x.subtest === sub) || { have: 0, target: 0, pending: 0, minutes: 0 };
      const pend = contribsOf(c, x => x.status === 'pending' && x.subtest === sub).sort((a, b) => a.at - b.at);
      const rejected = contribsOf(c, x => x.status === 'rejected' && x.subtest === sub);
      const m = subMeta(sub);
      const tutorName = (tid) => { const u = DB.getUser(tid); return u ? u.name : 'Akun terhapus'; };
      body.innerHTML = `
        <div class="to-head">
          <div><div class="to-row-title"><strong>${esc(c.title)}</strong> ${stateBadge(c)}</div>
            <div class="muted small">${fmtRange(c)} • semua mentee aktif (${activeStudents().length})</div></div>
          <div class="to-head-prog">${progressBar(p)}<span class="small"><b>${p.have}</b>${p.target ? ` / ${p.target}` : ''} soal${p.pending ? ` • ${p.pending} setoran menunggu` : ''}</span></div>
        </div>
        ${locked ? '<div class="alert alert-warning">Sudah ada mentee yang mengerjakan tryout ini. Soal dikunci agar hasil tetap adil; setoran baru tidak dapat diterima.</div>' : ''}
        <div class="to-tabs" role="tablist">${p.per.map(s => {
          const sm = subMeta(s.subtest);
          return `<button type="button" role="tab" aria-selected="${s.subtest === sub}" class="to-tab ${s.subtest === sub ? 'is-on' : ''}" data-st-sub="${esc(s.subtest)}">
            ${sm.icon} ${esc(sm.short)} <b>${s.have}${s.target ? '/' + s.target : ''}</b>${s.pending ? `<span class="tab-count">${s.pending}</span>` : ''}</button>`;
        }).join('')}</div>

        <div class="card">
          <div class="card-header">${UI.secHead(m.icon, m.name, `${ps.have} soal${ps.target ? ` dari target ${ps.target}` : ''} • ${ps.minutes} menit`)}
            ${locked ? '' : '<button type="button" class="btn btn-primary btn-sm" data-st-add>Tambah / buat soal</button>'}</div>

          <section class="to-block">
            <div class="to-block-head"><h4>Setoran tutor menunggu tinjauan (${pend.length})</h4>
              ${pend.length && !locked ? `<div class="flex-gap"><button type="button" class="btn btn-sm btn-success" data-st-accall>Terima semua</button>
                <button type="button" class="btn btn-sm btn-secondary" data-st-rejall>Tolak semua</button></div>` : ''}</div>
            ${pend.length ? `<div class="to-qlist">${pend.map(x => qCardHtml(DB.getQuestion(x.questionId), `
              <div class="to-q-foot"><span class="muted small">Disetor ${esc(tutorName(x.by))} • ${esc(UI.fmtDateTime(x.at))}</span>
                ${locked ? '' : `<span class="flex-gap"><button type="button" class="btn btn-sm btn-success" data-st-acc="${esc(x.id)}">Terima</button>
                <button type="button" class="btn btn-sm btn-secondary" data-st-rej="${esc(x.id)}">Tolak</button></span>`}</div>`)).join('')}</div>`
              : '<p class="muted small">Belum ada setoran baru untuk subtest ini.</p>'}
          </section>

          <section class="to-block">
            <div class="to-block-head"><h4>Soal di tryout (${(sec.questionIds || []).length})</h4>
              ${(sec.questionIds || []).length && !locked ? '<button type="button" class="btn btn-sm btn-ghost" data-st-clear>Lepas semua</button>' : ''}</div>
            ${(sec.questionIds || []).length ? `<ol class="to-qlist is-numbered">${sec.questionIds.map(qid => {
              const q = DB.getQuestion(qid);
              if (!q) return '';
              const from = DB.getCbtContribs(c.id).find(x => x.questionId === qid && x.status === 'accepted');
              return `<li>${qCardHtml(q, `<div class="to-q-foot"><span class="muted small">${from ? 'Setoran ' + esc(tutorName(from.by)) : 'Ditambahkan admin'}</span>
                ${locked ? '' : `<button type="button" class="btn btn-sm btn-ghost" data-st-drop="${esc(qid)}">Lepas</button>`}</div>`)}</li>`;
            }).join('')}</ol>` : '<p class="muted small">Belum ada soal. Terima setoran tutor atau tambahkan sendiri dari Bank Soal.</p>'}
          </section>

          ${rejected.length ? `<details class="to-block"><summary>Setoran ditolak (${rejected.length})</summary>
            <div class="to-qlist">${rejected.map(x => qCardHtml(DB.getQuestion(x.questionId), `<div class="to-q-foot"><span class="muted small">${esc(tutorName(x.by))}${x.note ? ' • ' + esc(x.note) : ''}</span>
              ${locked ? '' : `<button type="button" class="btn btn-sm btn-secondary" data-st-acc="${esc(x.id)}">Terima</button>`}</div>`)).join('')}</div></details>` : ''}
        </div>`;

      body.querySelectorAll('[data-st-sub]').forEach(b => b.addEventListener('click', () => { sub = b.dataset.stSub; paint(); }));
      const find = (cid) => DB.getCbtContribs(c.id).find(x => x.id === cid);
      body.querySelectorAll('[data-st-acc]').forEach(b => b.addEventListener('click', () => { const x = find(b.dataset.stAcc); if (x) review([x], 'accepted'); }));
      body.querySelectorAll('[data-st-rej]').forEach(b => b.addEventListener('click', () => { const x = find(b.dataset.stRej); if (x) askReject([x]); }));
      const accAll = body.querySelector('[data-st-accall]');
      if (accAll) accAll.addEventListener('click', () => review(pend, 'accepted'));
      const rejAll = body.querySelector('[data-st-rejall]');
      if (rejAll) rejAll.addEventListener('click', () => askReject(pend));
      body.querySelectorAll('[data-st-drop]').forEach(b => b.addEventListener('click', () => {
        setSections(s2 => { const s = s2.find(y => y.subtest === sub); if (s) s.questionIds = s.questionIds.filter(q => q !== b.dataset.stDrop); });
        // Setoran yang dilepas kembali menunggu tinjauan agar jejaknya jelas.
        const x = DB.getCbtContribs(c.id).find(y => y.questionId === b.dataset.stDrop && y.status === 'accepted');
        if (x) DB.reviewCbtContrib(x.id, 'pending', null, '');
        UI.toast('Soal dilepas dari tryout (tetap ada di Bank Soal).');
        paint();
      }));
      const clr = body.querySelector('[data-st-clear]');
      if (clr) clr.addEventListener('click', () => {
        if (!UI.confirmDialog(`Lepas semua ${sec.questionIds.length} soal ${m.short} dari tryout? Soal tetap ada di Bank Soal.`)) return;
        const ids = new Set(sec.questionIds);
        setSections(s2 => { const s = s2.find(y => y.subtest === sub); if (s) s.questionIds = []; });
        DB.getCbtContribs(c.id).filter(y => ids.has(y.questionId) && y.status === 'accepted').forEach(y => DB.reviewCbtContrib(y.id, 'pending', null, ''));
        paint();
      });
      const add = body.querySelector('[data-st-add]');
      if (add) add.addEventListener('click', () => {
        const inTryout = new Set(DB.cbtQuestionIds(DB.getCbt(id)));
        const pendQ = new Map(contribsOf(c, x => x.status === 'pending').map(x => [x.questionId, x]));
        QPicker.open({
          title: 'Tambah Soal ke Tryout', subtitle: `${c.title} • soal yang dipilih langsung masuk tryout`,
          subtests: secs.map(s => s.subtest), subtest: sub,
          disabled: (q) => (inTryout.has(q.id) ? 'Sudah ada di tryout' : ''),
          badge: (q) => (pendQ.has(q.id) ? '<span class="qc-chip">setoran tutor</span>' : ''),
          sideNote: (n) => { const x = progressOf(DB.getCbt(id)).per.find(y => y.subtest === n); return x ? `${x.have}${x.target ? '/' + x.target : ''} di tryout` : ''; },
          create: { user },
          confirmLabel: (n) => `Masukkan ${n} soal ke tryout`,
          onConfirm: (ids) => {
            const qs = ids.map(q => DB.getQuestion(q)).filter(Boolean);
            setSections(s2 => qs.forEach(q => { const s = s2.find(y => y.subtest === q.subject); if (s && !s.questionIds.includes(q.id)) s.questionIds.push(q.id); }));
            qs.forEach(q => { const x = pendQ.get(q.id); if (x) DB.reviewCbtContrib(x.id, 'accepted', user, ''); });
            UI.toast(`${qs.length} soal masuk tryout.`, 'success');
            const first = qs[0];
            if (first) sub = first.subject;
          },
          onClose: () => paint()
        });
      });
      if (global.Effects) Effects.enhance(body);
    }
  }

  /* =====================================================================
   * Admin: terbitkan & kembalikan ke draf
   * ===================================================================*/
  function openPublish(user, id, onDone) {
    const c = DB.getCbt(id);
    if (!c) return;
    const p = progressOf(c);
    const empty = p.per.filter(s => !s.have);
    const short = p.per.filter(s => s.have && s.target && s.have < s.target);
    const startLocal = UI.toDateTimeLocalInput(c.startAt);
    UI.modal.open('Terbitkan Tryout', `
      <form id="toPubForm" class="form">
        <p style="margin-top:0;"><strong>${esc(c.title)}</strong><br><span class="muted small">${fmtRange(c)} • ${p.have} soal • ${DB.tryoutSections(c).reduce((n, s) => n + (Number(s.durationMinutes) || 0), 0)} menit</span></p>
        ${empty.length ? `<div class="alert alert-error">Belum ada soal untuk ${empty.map(s => esc(subMeta(s.subtest).short)).join(', ')}. Tambahkan soal, atau hapus subtest itu lewat Edit info.</div>` : ''}
        ${short.length ? `<div class="alert alert-warning">Belum mencapai target: ${short.map(s => `${esc(subMeta(s.subtest).short)} ${s.have}/${s.target}`).join(', ')}. Tryout tetap dapat diterbitkan.</div>` : ''}
        ${p.pending ? `<div class="alert alert-info">${p.pending} setoran tutor belum ditinjau dan tidak ikut diterbitkan.</div>` : ''}
        <fieldset class="to-pubwhen"><legend>Tampil di dashboard mentee</legend>
          <label><input type="radio" name="when" value="now" checked /> Sekarang <span class="muted small">(mentee melihat jadwalnya; ujian dibuka ${esc(UI.fmtDateTime(c.startAt))})</span></label>
          <label><input type="radio" name="when" value="at" /> Pada waktu tertentu</label>
          <input type="datetime-local" id="toPubAt" value="${esc(startLocal)}" max="${esc(startLocal)}" disabled aria-label="Waktu tampil ke mentee" />
        </fieldset>
        <label class="check-row"><input type="checkbox" id="toPubNotify" checked /> Kirim notifikasi ke ${activeStudents().length} mentee saat tryout tampil</label>
        <div class="flex-gap" style="justify-content:flex-end;margin-top:12px;">
          <button type="button" class="btn btn-secondary" data-close>Batal</button>
          <button type="submit" class="btn btn-success" ${empty.length ? 'disabled' : ''}>Terbitkan</button>
        </div>
      </form>`);
    const f = document.getElementById('toPubForm');
    const at = f.querySelector('#toPubAt');
    f.querySelectorAll('[name="when"]').forEach(r => r.addEventListener('change', () => { at.disabled = f.querySelector('[name="when"]:checked').value !== 'at'; }));
    f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const cur = DB.getCbt(id);
      if (!cur) return;
      if (progressOf(cur).per.some(s => !s.have)) { UI.toast('Masih ada subtest tanpa soal.', 'error'); return; }
      let publishAt = now();
      if (f.querySelector('[name="when"]:checked').value === 'at') {
        publishAt = at.value ? UI.tzInputToUtc(at.value) : NaN;
        if (!Number.isFinite(publishAt)) { UI.toast('Isi waktu tampil ke mentee.', 'error'); return; }
        if (publishAt > cur.startAt) { UI.toast('Waktu tampil harus sebelum atau tepat saat tryout dibuka.', 'error'); return; }
        if (publishAt < now()) publishAt = now();
      }
      if (cur.endAt < now() && !UI.confirmDialog('Jadwal tryout ini sudah lewat, sehingga mentee tidak dapat mengerjakannya. Tetap terbitkan?')) return;
      const sections = DB.tryoutSections(cur).filter(s => (s.questionIds || []).length);
      DB.updateCbt(id, DB.stampEditor({
        status: 'published', publishAt, publishedAt: now(), publishedBy: user.id,
        sections, questionIds: sections.flatMap(s => s.questionIds), durationMinutes: sections.reduce((n, s) => n + (Number(s.durationMinutes) || 0), 0)
      }, user));
      let sent = 0;
      if (f.querySelector('#toPubNotify').checked) {
        const later = publishAt > now() + 60000;
        sent = DB.notifyUsers(activeStudents().map(s => s.id), Object.assign({
          type: 'cbt', icon: '🏁', title: `Tryout baru: ${cur.title}`,
          body: `Dibuka ${UI.fmtDateTime(cur.startAt)} s.d. ${UI.fmtDateTime(cur.endAt)} • ${sections.reduce((n, s) => n + s.questionIds.length, 0)} soal.`,
          link: 'cbt', tryoutId: id
        }, later ? { showAt: publishAt } : {}));
      }
      UI.modal.close();
      UI.toast(publishAt > now() + 60000 ? `Tryout terbit dan tampil ke mentee ${UI.fmtDateTime(publishAt)}.` : `Tryout terbit${sent ? ` & ${sent} mentee diberi notifikasi` : ''}.`, 'success');
      if (typeof onDone === 'function') onDone();
    });
  }
  function revertToDraft(user, c, onDone) {
    if (isLocked(c)) { UI.toast('Sudah ada mentee yang mengerjakan, tryout tidak dapat dikembalikan ke draf.', 'error'); return; }
    if (!UI.confirmDialog(`Kembalikan "${c.title}" ke draf? Tryout hilang dari dashboard mentee sampai diterbitkan lagi.`)) return;
    DB.updateCbt(c.id, DB.stampEditor({ status: 'draft', publishAt: null }, user));
    UI.toast('Tryout dikembalikan ke draf.');
    if (typeof onDone === 'function') onDone();
  }

  /* =====================================================================
   * Tutor: panel & halaman setor soal
   * ===================================================================*/
  function tutorTryouts(user) {
    const mine = new Set(DB.tutorTryoutSubtests(user));
    // Setoran hanya sebelum tryout dibuka: soal tryout yang sedang berjalan tidak lagi berubah.
    return DB.getTryouts().filter(c => ['draft', 'scheduled', 'upcoming'].includes(stateOf(c)) && DB.tryoutSections(c).some(s => mine.has(s.subtest)))
      .sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1) || a.startAt - b.startAt);
  }
  function renderTutorPanel(host, user, reload) {
    const list = tutorTryouts(user);
    if (!list.length) { host.innerHTML = ''; return; }
    const mine = DB.tutorTryoutSubtests(user);
    host.innerHTML = `
      <div class="card to-panel">
        <div class="card-header">${UI.secHead('🏁', 'Tryout: setor soal', `subtest Anda: ${mine.map(n => subMeta(n).short).join(', ')}`)}</div>
        <div class="to-list">${list.map(c => {
          const p = progressOf(c);
          const my = DB.getCbtContribs(c.id).filter(x => x.by === user.id && DB.getQuestion(x.questionId));
          const cnt = (s) => my.filter(x => x.status === s).length;
          const need = p.per.filter(s => mine.includes(s.subtest) && s.target && s.have < s.target);
          return `<article class="to-row">
            <div class="to-row-main">
              <div class="to-row-title"><strong>${esc(c.title)}</strong> ${stateBadge(c)}
                ${need.length ? `<span class="badge badge-warning">butuh ${need.reduce((n, s) => n + (s.target - s.have), 0)} soal</span>` : ''}</div>
              <div class="muted small">${fmtRange(c)}</div>
              ${subChips(p, mine)}
              <div class="muted small">Setoran Anda: ${cnt('pending')} menunggu • ${cnt('accepted')} diterima • ${cnt('rejected')} ditolak</div>
            </div>
            <div class="to-row-actions"><button type="button" class="btn btn-primary btn-sm" data-to-give="${esc(c.id)}">Setor soal</button></div>
          </article>`;
        }).join('')}</div>
      </div>`;
    host.querySelectorAll('[data-to-give]').forEach(b => b.addEventListener('click', () => openContribute(user, b.dataset.toGive, reload)));
  }

  function openContribute(user, id, onDone, startSub) {
    let c = DB.getCbt(id);
    if (!c) return;
    const mine = DB.tutorTryoutSubtests(user);
    const subsOf = () => DB.tryoutSections(DB.getCbt(id) || c).map(s => s.subtest).filter(n => mine.includes(n));
    let sub = startSub && subsOf().includes(startSub) ? startSub : subsOf()[0];
    const body = openWs('Setor Soal Tryout', c.title, '<button type="button" class="btn btn-primary btn-sm" data-ct-pick>Pilih / buat soal</button>', onDone);
    wsEl.querySelector('[data-ct-pick]').addEventListener('click', () => pick());
    paint();

    function pick() {
      c = DB.getCbt(id);
      if (!c) return;
      const inTryout = new Set(DB.cbtQuestionIds(c).concat(DB.tryoutSections(c).flatMap(s => s.questionIds || [])));
      const given = new Map(DB.getCbtContribs(id).filter(x => x.status !== 'rejected').map(x => [x.questionId, x]));
      QPicker.open({
        title: 'Setor Soal ke Tryout', subtitle: `${c.title} • soal yang dipilih dikirim ke admin untuk ditinjau`,
        subtests: subsOf(), subtest: sub,
        disabled: (q) => (inTryout.has(q.id) ? 'Sudah ada di tryout' : (given.has(q.id) ? (given.get(q.id).by === user.id ? 'Sudah Anda setor' : 'Sudah disetor tutor lain') : '')),
        sideNote: (n) => { const x = progressOf(DB.getCbt(id)).per.find(y => y.subtest === n); return x && x.target ? `kurang ${Math.max(0, x.target - x.have)}` : ''; },
        note: '<div class="alert alert-info small" style="margin:0;">Tidak menemukan soal yang cocok? Buat soal baru lewat tombol di kanan atas (editor, buat massal, Excel/CSV, atau PDF/Word/teks yang dapat dirapikan AI). Soal baru tersimpan di Bank Soal dan langsung dipilih.</div>',
        create: { user },
        confirmLabel: (n) => `Setor ${n} soal`,
        onConfirm: (ids) => {
          const cur = DB.getCbt(id);
          if (!cur) { UI.toast('Tryout sudah dihapus admin.', 'error'); return false; }
          const bySub = new Map();
          ids.map(q => DB.getQuestion(q)).filter(Boolean).forEach(q => { if (!bySub.has(q.subject)) bySub.set(q.subject, []); bySub.get(q.subject).push(q.id); });
          let n = 0;
          bySub.forEach((qids, s) => { n += DB.addCbtContribs(id, s, qids, user).length; });
          if (n) DB.notifyUsers(adminIds(user.id), { type: 'cbt', icon: '📥', link: 'admin-cbt', title: `${user.name} menyetor ${n} soal`, body: `Tryout: ${cur.title}. Tinjau di halaman CBT → Kelola soal.` });
          UI.toast(n ? `${n} soal disetor. Admin akan meninjau setoran Anda.` : 'Tidak ada soal baru yang disetor.', n ? 'success' : 'info');
          const first = ids.map(q => DB.getQuestion(q)).find(Boolean);
          if (first && subsOf().includes(first.subject)) sub = first.subject;
        },
        onClose: () => paint()
      });
    }

    function paint() {
      c = DB.getCbt(id);
      if (!c) { closeWs(); UI.toast('Tryout ini sudah dihapus admin.', 'info'); if (typeof onDone === 'function') onDone(); return; }
      const subs = subsOf();
      if (!subs.includes(sub)) sub = subs[0];
      const p = progressOf(c);
      const ps = p.per.find(x => x.subtest === sub) || { have: 0, target: 0 };
      const m = subMeta(sub);
      const my = DB.getCbtContribs(id).filter(x => x.by === user.id && x.subtest === sub && DB.getQuestion(x.questionId)).sort((a, b) => b.at - a.at);
      const sec = DB.tryoutSections(c).find(s => s.subtest === sub) || { questionIds: [] };
      const ST = { pending: ['badge-warning', 'Menunggu tinjauan'], accepted: ['badge-success', 'Diterima'], rejected: ['badge-gray', 'Ditolak'] };
      body.innerHTML = `
        <div class="to-head">
          <div><div class="to-row-title"><strong>${esc(c.title)}</strong> ${stateBadge(c)}</div>
            <div class="muted small">${fmtRange(c)} • Anda dapat menyetor soal untuk ${subs.map(n => esc(subMeta(n).short)).join(', ')}</div></div>
        </div>
        ${subs.length > 1 ? `<div class="to-tabs" role="tablist">${subs.map(n => {
          const x = p.per.find(y => y.subtest === n) || { have: 0, target: 0 };
          const sm = subMeta(n);
          return `<button type="button" role="tab" aria-selected="${n === sub}" class="to-tab ${n === sub ? 'is-on' : ''}" data-ct-sub="${esc(n)}">${sm.icon} ${esc(sm.short)} <b>${x.have}${x.target ? '/' + x.target : ''}</b></button>`;
        }).join('')}</div>` : ''}
        <div class="card">
          <div class="card-header">${UI.secHead(m.icon, m.name, ps.target ? `${ps.have} dari target ${ps.target} soal sudah masuk tryout${ps.have < ps.target ? ` • kurang ${ps.target - ps.have}` : ' • target terpenuhi'}` : `${ps.have} soal di tryout`)}
            <button type="button" class="btn btn-primary btn-sm" data-ct-pick2>Pilih / buat soal</button></div>
          <section class="to-block">
            <div class="to-block-head"><h4>Setoran Anda (${my.length})</h4></div>
            ${my.length ? `<div class="to-qlist">${my.map(x => qCardHtml(DB.getQuestion(x.questionId), `
              <div class="to-q-foot"><span><span class="badge ${ST[x.status][0]}">${ST[x.status][1]}</span>
                <span class="muted small">${esc(UI.fmtDateTime(x.at))}${x.note ? ' • ' + esc(x.note) : ''}</span></span>
                ${x.status === 'pending' ? `<button type="button" class="btn btn-sm btn-ghost" data-ct-undo="${esc(x.id)}">Tarik</button>` : ''}</div>`)).join('')}</div>`
              : '<p class="muted small">Anda belum menyetor soal untuk subtest ini.</p>'}
          </section>
          <details class="to-block"><summary>Soal yang sudah ada di tryout (${(sec.questionIds || []).length})</summary>
            ${(sec.questionIds || []).length ? `<ol class="to-qlist is-numbered">${sec.questionIds.map(q => DB.getQuestion(q)).filter(Boolean).map(q => `<li>${qCardHtml(q)}</li>`).join('')}</ol>`
              : '<p class="muted small">Belum ada.</p>'}
          </details>
        </div>`;
      body.querySelectorAll('[data-ct-sub]').forEach(b => b.addEventListener('click', () => { sub = b.dataset.ctSub; paint(); }));
      body.querySelector('[data-ct-pick2]').addEventListener('click', () => pick());
      body.querySelectorAll('[data-ct-undo]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Tarik setoran ini? Soal tetap ada di Bank Soal.')) return;
        DB.deleteCbtContrib(b.dataset.ctUndo);
        UI.toast('Setoran ditarik.');
        paint();
      }));
      if (global.Effects) Effects.enhance(body);
    }
  }

  /* =====================================================================
   * Mentee: kartu tryout di dashboard
   * ===================================================================*/
  function studentCardHtml(user) {
    const t = now();
    const list = DB.getCbtsForStudent(user.id).filter(c => DB.isTryout(c) && c.endAt >= t)
      .filter(c => { const a = DB.getCbtAttemptByStudent(c.id, user.id); return !(a && a.submittedAt); })
      .sort((a, b) => a.startAt - b.startAt).slice(0, 3);
    if (!list.length) return '';
    const until = (ts) => {
      const d = ts - t;
      if (d <= 0) return '';
      const days = Math.floor(d / 86400000), h = Math.floor(d / 3600000) % 24, mi = Math.floor(d / 60000) % 60;
      return days ? `${days} hari ${h} jam lagi` : (h ? `${h} jam ${mi} menit lagi` : `${Math.max(1, mi)} menit lagi`);
    };
    return `<div class="card to-stu">
      <div class="card-header">${UI.secHead('🏁', 'Tryout', 'jadwal tryout untuk semua mentee')}
        <button type="button" class="btn btn-sm btn-secondary" data-to-go>Buka CBT</button></div>
      <div class="to-stu-list">${list.map(c => {
        const live = c.startAt <= t;
        const secs = DB.cbtSections(c);
        return `<div class="to-stu-item">
          <div class="to-stu-when ${live ? 'is-live' : ''}"><strong>${live ? 'Sedang dibuka' : esc(UI.fmtDate(c.startAt))}</strong>
            <span>${live ? 'ditutup ' + esc(UI.fmtDateTime(c.endAt)) : esc(until(c.startAt))}</span></div>
          <div class="to-stu-main"><strong>${esc(c.title)}</strong>
            <div class="muted small">${secs.length} subtest • ${DB.cbtQuestionIds(c).length} soal • ${c.durationMinutes} menit • ${esc(fmtRange(c))}</div></div>
          <button type="button" class="btn btn-sm ${live ? 'btn-primary' : 'btn-secondary'}" data-to-go>${live ? 'Kerjakan' : 'Lihat'}</button>
        </div>`;
      }).join('')}</div>
    </div>`;
  }
  function bindStudentCard(root) {
    (root || document).querySelectorAll('[data-to-go]').forEach(b => b.addEventListener('click', () => Dashboard.navigate('cbt')));
  }

  global.Tryout = {
    stateOf, progressOf, renderAdminPanel, renderTutorPanel, openForm, openStudio, openPublish, openContribute,
    studentCardHtml, bindStudentCard, close: closeWs
  };
})(window);
