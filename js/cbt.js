/* ===== CBT Workspace =====
 * Halaman khusus (full page) untuk mengelola ujian CBT:
 *   - Daftar ujian + statistik
 *   - Wizard 6 langkah pembuatan/penyuntingan ujian
 *   - Bank soal "Soal Tersedia" per kategori subtest
 *   - Pemantauan langsung peserta (kamera/mikrofon + pelanggaran)
 *   - Hasil & analisis per subtest
 *
 * Dipakai oleh Admin dan Guru. Guru hanya melihat kelas/soal miliknya.
 */
(function (global) {
  // Isi lingkaran avatar: avatar almamater / foto / inisial (js/avatars.js).
  const AV = (u) => (global.Avatars ? Avatars.inner(u) : UI.esc(UI.initials(u && u.name)));

  /* =====================================================================
   * Utilitas
   * ===================================================================*/
  function emptyState(msg, icon) {
    return `<div class="empty"><div class="empty-icon">${icon || '📭'}</div>${UI.esc(msg)}</div>`;
  }

  /** Kelas tingkat (X-A, XI-B, ...) yang diatur admin di Pengaturan. */
  function gradeClasses() {
    return DB.getClassOptions ? DB.getClassOptions() : [];
  }

  /** Jumlah siswa pada satu kelas tingkat. */
  function studentsInGrade(kelas) {
    return DB.getUsers().filter(u => u.role === 'siswa' && u.kelas === kelas && (u.status || 'Aktif') === 'Aktif').length;
  }

  /** Peserta yang ditargetkan sebuah ujian. */
  function targetedStudents(cbt) {
    return DB.getUsers()
      .filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif')
      .filter(u => DB.cbtTargetsStudent(cbt, u));
  }

  function difficultyChip(d) {
    const key = (d || 'sedang').toLowerCase();
    return `<span class="qc-chip d-${UI.esc(key)}">${UI.esc(key.toUpperCase())}</span>`;
  }

  /** Ringkasan bentuk jawaban: "4 opsi", "3 pernyataan • 3 kolom", "jawaban terbuka". */
  function answerShapeLabel(q) {
    const f = q.questionType || 'Pilihan Ganda';
    const n = (q.statements || []).length;
    if (f === 'Majemuk Kompleks') return `${n} pernyataan • ${DB.qMatrixColumns(q).length} kolom`;
    if (f === 'Benar/Salah Majemuk') return `${n} pernyataan B/S`;
    if (f === 'Menjodohkan') return `${(q.pairs || []).length} pasangan`;
    if (f === 'Urutan') return `${(q.orderItems || []).length} item`;
    const optCount = (q.options || []).length;
    return optCount ? optCount + ' opsi' : 'jawaban terbuka';
  }

  function questionCardHtml(q, checked) {
    const st = DB.subtestByName(q.subject);
    return `
      <label class="q-card ${checked ? 'is-on' : ''}" data-qid="${q.id}"
             data-hay="${UI.esc((q.text + ' ' + (q.subject || '') + ' ' + (q.questionType || '')).toLowerCase())}">
        <input type="checkbox" name="qid" value="${q.id}" ${checked ? 'checked' : ''} />
        <div class="qc-text rt-content">${RichText.render(q.text)}</div>
        <div class="qc-tags">
          <span class="qc-chip sub">${st ? st.icon : '📘'} ${UI.esc(st ? st.short : (q.subject || 'Umum'))}</span>
          <span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>
          ${difficultyChip(q.difficulty)}
          ${global.Topics ? Topics.chipsHtml(q) : ''}
          <span class="qc-chip opt">${UI.esc(answerShapeLabel(q))}</span>
          ${q.points != null && Number(q.points) !== 1 ? `<span class="qc-chip">⭐ ${UI.esc(String(q.points))} poin</span>` : ''}
        </div>
      </label>`;
  }

  /* =====================================================================
   * Shell workspace (overlay full screen)
   * ===================================================================*/
  let wsEl = null;

  function openWorkspace(title, subtitle, actionsHtml) {
    closeWorkspace();
    wsEl = document.createElement('div');
    wsEl.className = 'cbt-workspace';
    wsEl.innerHTML = `
      <div class="cbt-ws-top">
        <button class="btn btn-secondary btn-sm" id="wsBack">← Kembali</button>
        <div>
          <h3 class="ws-title" id="wsTitle">${UI.esc(title)}</h3>
          <div class="ws-sub" id="wsSub">${UI.esc(subtitle || '')}</div>
        </div>
        <div class="ws-spacer"></div>
        <div class="flex-gap" id="wsActions">${actionsHtml || ''}</div>
      </div>
      <div class="cbt-ws-body"><div class="cbt-ws-inner" id="wsBody"></div></div>
    `;
    document.body.appendChild(wsEl);
    document.body.style.overflow = 'hidden';
    wsEl.querySelector('#wsBack').addEventListener('click', () => {
      if (typeof wsEl.__onBack === 'function') wsEl.__onBack();
      else closeWorkspace();
    });
    return wsEl.querySelector('#wsBody');
  }

  function setWorkspaceHeader(title, subtitle) {
    if (!wsEl) return;
    wsEl.querySelector('#wsTitle').textContent = title;
    wsEl.querySelector('#wsSub').textContent = subtitle || '';
  }

  function closeWorkspace() {
    if (wsEl) {
      wsEl.remove();
      wsEl = null;
      document.body.style.overflow = '';
    }
  }

  /* =====================================================================
   * 1) HALAMAN UTAMA: daftar ujian
   * ===================================================================*/
  function renderCbtHome(container, user) {
    const isAdmin = user.role === 'admin';
    const allCbts = DB.getCbts();
    // Guru hanya melihat ujian pada kelas yang ia ajar
    const myCourseIds = isAdmin ? null : DB.getCoursesByTeacher(user.id).map(c => c.id);
    const cbts = isAdmin ? allCbts : allCbts.filter(c => {
      const ids = (c.courseIds && c.courseIds.length) ? c.courseIds : (c.courseId ? [c.courseId] : []);
      return ids.some(id => myCourseIds.includes(id));
    });

    const now = Date.now();
    const live = cbts.filter(c => c.startAt <= now && c.endAt >= now);
    const upcoming = cbts.filter(c => c.startAt > now);
    const done = cbts.filter(c => c.endAt < now);
    const totalAttempts = DB.getCbtAttempts().filter(a => a.submittedAt).length;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success is-clickable" id="kpiLive">
          <div class="label">Sedang Berlangsung</div>
          <div class="value">${live.length}</div>
          <div class="sub">ujian aktif saat ini</div>
        </div>
        <div class="stat-card accent-primary">
          <div class="label">Akan Datang</div>
          <div class="value">${upcoming.length}</div>
          <div class="sub">terjadwal</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Selesai</div>
          <div class="value">${done.length}</div>
          <div class="sub">${totalAttempts} pengerjaan</div>
        </div>
        <div class="stat-card accent-danger is-clickable" id="kpiBank">
          <div class="label">Bank Soal</div>
          <div class="value">${DB.getQuestions().length}</div>
          <div class="sub">klik untuk jelajahi</div>
        </div>
      </div>

      ${global.Remedial ? Remedial.settingsCardHtml(user) : ''}

      <div class="card">
        <div class="card-header">
          ${UI.secHead('🖥️', 'Manajemen Ujian CBT', 'Halaman khusus dengan wizard pembuatan ujian, bank soal, dan pemantauan langsung')}
          <div class="flex-gap">
            <button class="btn btn-secondary btn-sm" id="openBankBtn">📚 Soal Tersedia</button>
            <button class="btn btn-primary btn-sm" id="newCbtBtn">+ Buat Ujian Baru</button>
          </div>
        </div>

        <div id="cbtSearch"></div>
      </div>
    `;

    const reload = () => renderCbtHome(container, user);
    Visibility.bind(container, user, reload);
    if (global.Remedial) Remedial.bindSettings(container, user, reload);
    const statusOf = (c) => c.endAt < now ? 'done' : (c.startAt <= now ? 'live' : 'upcoming');
    const cbtCourses = [...new Set(cbts.flatMap(c => (c.courseIds && c.courseIds.length) ? c.courseIds : (c.courseId ? [c.courseId] : [])))]
      .map(id => DB.getCourse(id)).filter(Boolean);
    DataSearch.mount({
      container: container.querySelector('#cbtSearch'),
      items: cbts,
      stateKey: 'cbt-home-' + user.id,
      placeholder: 'Cari judul ujian, deskripsi, kelas tujuan, subtest, atau pembuat…',
      fields: c => [c.title, c.id, c.description, DB.cbtTargetLabel(c), DB.cbtSections(c).map(x => x.subtest || x.name || x.title || ''),
        DB.contentOwnerName(c, DB.getCourse(c.courseId)), UI.fmtDateTime(c.startAt)],
      filters: [
        { key: 'status', label: 'Semua status', get: statusOf,
          options: [{ value: 'live', label: 'Berlangsung' }, { value: 'upcoming', label: 'Akan datang' }, { value: 'done', label: 'Selesai' }] },
        { key: 'mode', label: 'Semua mode', get: c => c.subtestMode || 'custom',
          options: [{ value: 'full', label: '7 Subtest' }, { value: 'single', label: '1 Subtest' }, { value: 'custom', label: 'Custom' }] },
        { key: 'act', label: 'Aktif & nonaktif', get: c => c.active === false ? 'off' : 'on', options: [{ value: 'on', label: 'Aktif' }, { value: 'off', label: 'Nonaktif' }] },
        { key: 'course', label: 'Semua kelas', get: c => (c.courseIds && c.courseIds.length) ? c.courseIds : (c.courseId ? [c.courseId] : []),
          options: cbtCourses.map(c => ({ value: c.id, label: DB.courseTitle(c) })) }
      ],
      dateRange: c => DB.ymdOf(c.startAt),
      sorts: [
        { key: 'new', label: 'Terbaru dibuat', cmp: (a, b) => b.createdAt - a.createdAt },
        { key: 'start', label: 'Jadwal terdekat', cmp: (a, b) => a.startAt - b.startAt },
        { key: 'title', label: 'Judul A–Z', cmp: (a, b) => a.title.localeCompare(b.title) }
      ],
      pageSize: 15,
      empty: 'Belum ada ujian CBT. Klik "Buat Ujian Baru" untuk memulai.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Ujian</th><th>Kelas Tujuan</th><th>Mode</th><th>Subtest</th>
            <th>Soal</th><th>Jadwal</th><th>Peserta</th><th>Status</th><th>Aksi</th>
          </tr></thead>
          <tbody>${rows.map(c => {
            const sections = DB.cbtSections(c);
            const qCount = DB.cbtQuestionIds(c).length;
            const attempts = DB.getCbtAttemptsByCbt(c.id);
            const submitted = attempts.filter(a => a.submittedAt).length;
            const running = attempts.filter(a => !a.submittedAt).length;
            const targets = targetedStudents(c).length;
            let status = '<span class="badge badge-info">Akan Datang</span>';
            if (c.endAt < now) status = '<span class="badge badge-gray">Selesai</span>';
            else if (c.startAt <= now) status = '<span class="badge badge-success">Berlangsung</span>';
            const sec = c.security || {};
            const secIcons = [
              sec.requireCamera ? '📷' : '', sec.requireMic ? '🎙️' : '',
              sec.requireScreenShare ? '🖲️' : '', sec.fullscreen ? '🖥️' : '',
              sec.lockScreen ? '🔒' : '', sec.blockTabSwitch ? '🚫' : '',
              sec.blockCopy ? '📋' : '', sec.blockScreenshot ? '📸' : ''
            ].filter(Boolean).join(' ');
            return `<tr>
              <td>
                <strong>${ctx.highlight(c.title)}</strong>
                ${global.Remedial ? Remedial.listLabelHtml(c) : ''}
                ${c.description ? `<div class="muted small" style="max-width:260px;">${UI.esc(c.description.slice(0, 70))}${c.description.length > 70 ? '…' : ''}</div>` : ''}
                ${secIcons ? `<div class="small" title="Pengaturan keamanan">${secIcons}</div>` : ''}
              </td>
              <td><span class="badge ${c.remedialOf ? 'badge-warning' : (c.targetClasses || []).includes(DB.ALL_CLASSES) ? 'badge-success' : 'badge-info'}">${UI.esc(DB.cbtTargetLabel(c))}</span></td>
              <td>${c.subtestMode === 'full' ? '<span class="badge badge-warning">7 Subtest</span>'
                    : (c.subtestMode === 'single' ? '<span class="badge badge-info">1 Subtest</span>' : '<span class="badge badge-gray">Custom</span>')}
                  ${global.Scoring ? `<div class="small" style="margin-top:4px;"><span class="badge ${Scoring.modeOf(c) === 'irt' ? 'badge-gray' : 'badge-success'}" title="${UI.esc(Scoring.describe(c))}">${Scoring.modeOf(c) === 'irt' ? '📈' : '⭐'} ${UI.esc(Scoring.MODES[Scoring.modeOf(c)].short)}</span></div>` : ''}</td>
              <td class="muted small">${sections.length} bagian</td>
              <td>${qCount}</td>
              <td class="small">${UI.fmtDateTime(c.startAt)}<div class="muted">s.d. ${UI.fmtDateTime(c.endAt)}</div></td>
              <td>${submitted}/${targets}${running ? `<div class="small" style="color:var(--warning);">${running} mengerjakan</div>` : ''}</td>
              <td>${status}</td>
              <td class="actions">
                <button class="btn btn-sm btn-primary" data-monitor="${c.id}">📡 Pantau</button>
                <button class="btn btn-sm btn-secondary" data-results="${c.id}">📊 Hasil</button>
                ${DB.canManageContent(user, c, DB.getCourse(c.courseId))
                  ? `<button class="btn btn-sm btn-secondary" data-edit-cbt="${c.id}">Edit</button>
                     <button class="btn btn-sm btn-danger" data-del-cbt="${c.id}">Hapus</button>`
                  : `<span class="lock-note">🔒 milik ${UI.esc(DB.contentOwnerName(c, DB.getCourse(c.courseId)) || 'tutor lain')}</span>`}
                ${Visibility.controlsHtml('cbt', c, user)}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-edit-cbt]').forEach(b => b.addEventListener('click', () =>
          openWizard(user, b.dataset.editCbt, reload)));
        box.querySelectorAll('[data-monitor]').forEach(b => b.addEventListener('click', () =>
          openMonitor(b.dataset.monitor, user, reload)));
        box.querySelectorAll('[data-results]').forEach(b => b.addEventListener('click', () =>
          openResults(b.dataset.results, user, reload)));
        box.querySelectorAll('[data-del-cbt]').forEach(b => b.addEventListener('click', () => {
          const nRem = DB.getCbts().filter(x => x.remedialOf === b.dataset.delCbt).length;
          if (!UI.confirmDialog('Hapus ujian ini beserta seluruh hasil pengerjaannya?' + (nRem ? `\n${nRem} putaran remedial ujian ini juga ikut terhapus.` : ''))) return;
          DB.deleteCbt(b.dataset.delCbt);
          UI.toast('Ujian dihapus.');
          reload();
        }));
      }
    });

    document.getElementById('newCbtBtn').addEventListener('click', () => openWizard(user, null, reload));
    document.getElementById('openBankBtn').addEventListener('click', () => openBankBrowser(user, reload));
    document.getElementById('kpiBank').addEventListener('click', () => openBankBrowser(user, reload));
    document.getElementById('kpiLive').addEventListener('click', () => {
      if (live.length) openMonitor(live[0].id, user, reload);
      else UI.toast('Tidak ada ujian yang sedang berlangsung.', 'info');
    });
  }

  /* =====================================================================
   * 2) WIZARD PEMBUATAN UJIAN (6 langkah, full page)
   * ===================================================================*/
  const STEPS = [
    { key: 'info',     label: 'Informasi & Deskripsi', icon: '📝' },
    { key: 'target',   label: 'Kelas Tujuan',          icon: '🎯' },
    { key: 'mode',     label: 'Metode Subtest',        icon: '🧪' },
    { key: 'soal',     label: 'Pilih Soal',            icon: '📚' },
    { key: 'security', label: 'Keamanan & Pemantauan', icon: '🔒' },
    { key: 'review',   label: 'Tinjau & Simpan',       icon: '✅' }
  ];

  /**
   * @param {object} user   pengguna aktif
   * @param {string|null} editId  id ujian yang disunting
   * @param {function} onDone     callback setelah simpan/tutup
   * @param {object} opts   { courseIds: [], ownerId: '' } — dipakai saat ujian
   *                        dibuat dari dalam halaman kelas agar kelas tujuan
   *                        dan tutor penanggung jawab langsung terisi.
   */
  function openWizard(user, editId, onDone, opts) {
    const o = opts || {};
    const editing = editId ? DB.getCbt(editId) : null;
    const courses = user.role === 'admin' ? DB.getCourses() : DB.getCoursesByTeacher(user.id);
    // Tutor penanggung jawab: dipertahankan saat edit, atau dari opts/pembuat.
    // Admin boleh mengubahnya pada langkah 1 agar rekap keaktifan tutor akurat.
    let ownerId = (editing && editing.createdBy) || o.ownerId ||
      (user.role === 'guru' ? user.id : null);

    // Keterangan tutor pembuat HANYA relevan untuk ujian di dalam kelas.
    // Pada CBT umum/utama, atribusi tetap dicatat di data (dipakai untuk hak
    // edit/hapus) tetapi tidak ditampilkan sebagai keterangan pembuat.
    const inClass = !!(o.inClass
      || (Array.isArray(o.courseIds) && o.courseIds.length)
      || (editing && ((editing.courseIds || []).length || editing.courseId)));

    // ---- State draft ujian ----
    const draft = {
      title: editing?.title || '',
      description: editing?.description || '',
      targetClasses: (editing?.targetClasses || []).slice(),
      courseIds: (editing?.courseIds && editing.courseIds.length
        ? editing.courseIds
        : (editing?.courseId ? [editing.courseId]
           : (Array.isArray(o.courseIds) ? o.courseIds : []))).slice(),
      subtestMode: editing?.subtestMode || 'single',
      selectedSubtest: editing?.selectedSubtest || DB.SUBTESTS[0].name,
      // map: nama subtest -> array questionId
      picked: {},
      durations: {},
      security: Object.assign(
        { requireCamera: false, requireMic: false, requireScreenShare: false,
          fullscreen: true, lockScreen: true, blockTabSwitch: true,
          blockCopy: true, blockScreenshot: true, maxViolations: 3 },
        DB.getSettings().examSecurityDefaults || {},
        editing?.security || {}
      ),
      startAt: editing?.startAt || Date.now(),
      endAt: editing?.endAt || (Date.now() + 7 * 86400000),
      // Sistem penilaian: IRT (bawaan), Poin Manual, atau keduanya (js/scoring.js)
      scoring: {
        mode: global.Scoring ? Scoring.modeOf(editing) : 'irt',
        basis: editing?.pointsBasis === 'package' ? 'package' : 'question',
        packageTotal: Number(editing?.packageTotal) > 0 ? Number(editing.packageTotal) : 100,
        wrongPoints: Number(editing?.wrongPoints) < 0 ? Number(editing.wrongPoints) : 0,
        points: Object.assign({}, editing?.points || {})
      }
    };
    // Muat pilihan soal dari sections yang tersimpan
    if (editing) {
      DB.cbtSections(editing).forEach(s => {
        draft.picked[s.subtest] = (s.questionIds || []).slice();
        draft.durations[s.subtest] = s.durationMinutes || 20;
      });
    }

    let step = 0;
    const body = openWorkspace(
      editing ? 'Edit Ujian CBT' : 'Buat Ujian CBT',
      'Ikuti 6 langkah berikut — perubahan baru tersimpan saat menekan Simpan Ujian'
    );
    wsEl.__onBack = () => {
      if (UI.confirmDialog('Keluar dari wizard? Perubahan yang belum disimpan akan hilang.')) {
        closeWorkspace();
        if (typeof onDone === 'function') onDone();
      }
    };

    paint();

    function totalPicked() {
      return Object.values(draft.picked).reduce((n, arr) => n + (arr ? arr.length : 0), 0);
    }
    /** Subtest yang relevan untuk mode saat ini. */
    function activeSubtests() {
      if (draft.subtestMode === 'single') return [draft.selectedSubtest];
      return DB.SUBTEST_NAMES; // full & custom -> semua tersedia, pilihan tetap manual
    }
    function builtSections() {
      return activeSubtests()
        .map(name => ({
          subtest: name,
          questionIds: (draft.picked[name] || []).slice(),
          durationMinutes: Number(draft.durations[name] || DB.subtestByName(name)?.defaultMinutes || 20)
        }))
        .filter(s => s.questionIds.length > 0)
        .sort((a, b) => DB.subtestOrder(a.subtest) - DB.subtestOrder(b.subtest));
    }

    function paint() {
      body.innerHTML = `
        <div class="wz-steps">
          ${STEPS.map((s, i) => `
            <button type="button" class="wz-step ${i === step ? 'is-active' : ''} ${i < step ? 'is-done' : ''}" data-step="${i}">
              <span class="wz-num">${i < step ? '✓' : i + 1}</span>
              <span>${s.icon} ${UI.esc(s.label)}</span>
            </button>`).join('')}
        </div>
        <div id="wzPanel" class="wz-panel"></div>
        <div class="wz-nav">
          <button class="btn btn-secondary" id="wzPrev" ${step === 0 ? 'disabled' : ''}>← Sebelumnya</button>
          <div class="flex-gap">
            <span class="muted small" style="align-self:center;">${totalPicked()} soal dipilih</span>
            ${step < STEPS.length - 1
              ? '<button class="btn btn-primary" id="wzNext">Lanjut →</button>'
              : `<button class="btn btn-success" id="wzSave">${editing ? '💾 Simpan Perubahan' : '💾 Simpan Ujian'}</button>`}
          </div>
        </div>
      `;
      body.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
        const target = Number(b.dataset.step);
        if (target > step && !validateStep(step)) return;
        step = target;
        paint();
      }));
      const prev = document.getElementById('wzPrev');
      if (prev) prev.addEventListener('click', () => { step = Math.max(0, step - 1); paint(); });
      const next = document.getElementById('wzNext');
      if (next) next.addEventListener('click', () => {
        if (!validateStep(step)) return;
        step = Math.min(STEPS.length - 1, step + 1);
        paint();
      });
      const save = document.getElementById('wzSave');
      if (save) save.addEventListener('click', doSave);

      const panel = document.getElementById('wzPanel');
      ({
        0: stepInfo, 1: stepTarget, 2: stepMode, 3: stepSoal, 4: stepSecurity, 5: stepReview
      })[step](panel);
      if (global.Effects) Effects.enhance(body);
    }

    function validateStep(i) {
      if (i === 0) {
        // Ambil dari input bila langkah 1 sedang tampil, jika tidak pakai draft
        const el = document.querySelector('[name="wzTitle"]');
        const t = (el ? el.value : draft.title).trim();
        if (!t) {
          UI.toast('Judul ujian wajib diisi.', 'error');
          if (!el) { step = 0; paint(); }
          return false;
        }
        draft.title = t;
        if (draft.endAt <= draft.startAt) { UI.toast('Waktu selesai harus setelah waktu mulai.', 'error'); return false; }
      }
      if (i === 1 && !(editing && editing.remedialOf) && draft.targetClasses.length === 0 && draft.courseIds.length === 0) {
        UI.toast('Pilih minimal satu kelas tujuan (atau "Untuk Semua Kelas").', 'error');
        return false;
      }
      if (i === 3 && totalPicked() === 0) {
        UI.toast('Pilih minimal 1 soal untuk ujian ini.', 'error');
        return false;
      }
      return true;
    }

    /* ---------- Langkah 1: Info & deskripsi ---------- */
    /**
     * Blok atribusi tutor. Tutor selalu tercatat atas namanya sendiri; admin
     * memilih tutor penanggung jawab (sistem tetap menyimpan bahwa admin yang
     * mengetiknya lewat field enteredBy).
     */
    function ownerBlockHtml() {
      if (!inClass) return '';
      if (user.role !== 'admin') {
        const me = DB.getUser(ownerId) || user;
        return `
          <div class="ce-owner-note">
            <span class="ce-owner-ic">👤</span>
            <div>
              <strong>Tercatat atas nama Anda: ${UI.esc(me.name)}</strong>
              <div class="muted small">Ujian ini dihitung sebagai keaktifan Anda pada rekapan tutor.</div>
            </div>
          </div>`;
      }
      const tutors = DB.getUsers().filter(u => u.role === 'guru' && u.active !== false);
      return `
        <div class="form-group">
          <label for="wzOwner">Tutor Penanggung Jawab</label>
          <select name="wzOwner" id="wzOwner">
            ${ownerId && ownerId !== DB.ADMIN_OWNER && !DB.getUser(ownerId) ? `<option value="${UI.esc(ownerId)}" selected>Pembuat lama (akun dihapus) — pilih pengganti</option>` : ''}
            <option value="" ${!ownerId ? 'selected' : ''}>— Tidak dikaitkan (semua tutor kelas dapat mengelola) —</option>
            <option value="${DB.ADMIN_OWNER}" ${ownerId === DB.ADMIN_OWNER ? 'selected' : ''}>Admin Rubela (hanya admin yang mengubah)</option>
            ${tutors.map(t => `<option value="${UI.esc(t.id)}" ${ownerId === t.id ? 'selected' : ''}>${UI.esc(t.name)}</option>`).join('')}
          </select>
          <div class="muted small">
            Anda mencatat sebagai admin. Pilih tutor yang benar-benar menyiapkan ujian ini agar
            rekapan keaktifan tutor tetap akurat. Sistem menyimpan bahwa admin yang mengetiknya.
          </div>
        </div>`;
    }

    function stepInfo(panel) {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('📝', 'Informasi Ujian', 'Judul, deskripsi, dan jadwal pelaksanaan')}</div>
          <div class="form">
            <div class="form-group">
              <label>Judul Ujian</label>
              <input name="wzTitle" value="${UI.esc(draft.title)}" placeholder="mis. Try Out UTBK Batch 1" />
            </div>
            ${ownerBlockHtml()}
            <div class="form-group">
              <label>Deskripsi / Petunjuk Ujian</label>
              <textarea name="wzDesc" rows="5" placeholder="Tulis petunjuk pengerjaan, aturan, dan hal yang perlu disiapkan peserta...">${UI.esc(draft.description)}</textarea>
              <p class="muted small" style="margin:6px 0 0;">Deskripsi ini ditampilkan pada halaman pembuka ujian sebelum peserta menekan "Mulai".</p>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Waktu Mulai</label>
                <input name="wzStart" type="datetime-local" value="${UI.utcToTzInput(draft.startAt)}" /></div>
              <div class="form-group"><label>Waktu Selesai</label>
                <input name="wzEnd" type="datetime-local" value="${UI.utcToTzInput(draft.endAt)}" /></div>
            </div>
            <div class="alert alert-info">Zona waktu aktif: <strong>${UI.getTimezone()}</strong>. Ubah lewat pemilih zona waktu di topbar.</div>
          </div>
        </div>`;
      const sync = () => {
        draft.title = document.querySelector('[name="wzTitle"]').value;
        draft.description = document.querySelector('[name="wzDesc"]').value;
        const s = document.querySelector('[name="wzStart"]').value;
        const e2 = document.querySelector('[name="wzEnd"]').value;
        if (s) draft.startAt = UI.tzInputToUtc(s);
        if (e2) draft.endAt = UI.tzInputToUtc(e2);
      };
      panel.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', sync));
      const own = panel.querySelector('#wzOwner');
      if (own) own.addEventListener('change', () => { ownerId = own.value || null; });
    }

    /* ---------- Langkah 2: Kelas tujuan (multi + semua) ---------- */
    function stepTarget(panel) {
      if (editing && editing.remedialOf) {
        // Peserta remedial dipilih per siswa dari halaman Hasil ujian induk.
        const parent = DB.getCbt(editing.remedialOf);
        const names = (editing.targetStudentIds || []).map(id => (DB.getUser(id) || {}).name).filter(Boolean);
        panel.innerHTML = `<div class="card">
          <div class="card-header">${UI.secHead('🔁', 'Peserta Remedial', `Remedial ke-${editing.remedialRound || 1}${parent ? ' untuk ' + parent.title : ''}`)}</div>
          <p class="muted small">Peserta dan jadwal remedial diatur dari halaman <strong>Hasil</strong> ujian awal → <strong>Kelola remedial</strong>.</p>
          <div class="qc-tags">${names.map(n => `<span class="qc-chip">${UI.esc(n)}</span>`).join('') || '<span class="muted">Belum ada peserta.</span>'}</div>
        </div>`;
        return;
      }
      const grades = gradeClasses();
      const allOn = draft.targetClasses.includes(DB.ALL_CLASSES);
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('🎯', 'Kelas Tujuan', 'Pilih satu atau beberapa kelas tingkat — bukan kelas mata pelajaran')}</div>
          <p class="muted small">Kelas di bawah ini adalah <strong>kelas tingkat</strong> (X, XI, XII) yang diatur pada menu Pengaturan.
          Centang beberapa sekaligus, atau pilih "Untuk Semua Kelas" agar ujian terbuka untuk seluruh siswa aktif.</p>
          <div class="tgt-grid mt-2">
            <label class="tgt-box all-box ${allOn ? 'is-on' : ''}">
              <input type="checkbox" id="tgtAll" ${allOn ? 'checked' : ''} />
              <div>
                <div class="tgt-name">🌐 Untuk Semua Kelas</div>
                <div class="tgt-meta">Semua siswa aktif (${DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif').length} siswa) dapat mengikuti</div>
              </div>
            </label>
            ${grades.length === 0
              ? '<div class="muted small">Belum ada daftar kelas. Tambahkan lewat menu Pengaturan → Daftar Nama Kelas.</div>'
              : grades.map(g => `
                <label class="tgt-box ${draft.targetClasses.includes(g) ? 'is-on' : ''} ${allOn ? 'is-disabled' : ''}">
                  <input type="checkbox" name="tgtClass" value="${UI.esc(g)}" ${draft.targetClasses.includes(g) ? 'checked' : ''} />
                  <div>
                    <div class="tgt-name">${UI.esc(g)}</div>
                    <div class="tgt-meta">${studentsInGrade(g)} siswa</div>
                  </div>
                </label>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('📚', 'Kaitkan ke Kelas Mata Pelajaran (opsional)', 'Agar ujian juga muncul di halaman kelas terkait')}</div>
          ${courses.length === 0 ? emptyState('Belum ada kelas mata pelajaran.') : `
          <div class="tgt-grid">
            ${courses.map(c => `
              <label class="tgt-box ${draft.courseIds.includes(c.id) ? 'is-on' : ''}">
                <input type="checkbox" name="tgtCourse" value="${c.id}" ${draft.courseIds.includes(c.id) ? 'checked' : ''} />
                <div>
                  <div class="tgt-name">${UI.esc(c.title.length > 26 ? c.title.slice(0, 26) + '…' : c.title)}</div>
                  <div class="tgt-meta">${DB.getEnrollmentsByCourse(c.id).length} siswa terdaftar</div>
                </div>
              </label>`).join('')}
          </div>`}
        </div>

        <div class="alert alert-info" id="tgtSummary"></div>`;

      const refreshSummary = () => {
        const fake = { targetClasses: draft.targetClasses, courseIds: draft.courseIds };
        const n = targetedStudents(fake).length;
        document.getElementById('tgtSummary').innerHTML =
          `Perkiraan peserta: <strong>${n} siswa</strong> — ${UI.esc(DB.cbtTargetLabel(fake))}` +
          (draft.courseIds.length ? ` + ${draft.courseIds.length} kelas mata pelajaran` : '');
      };

      const allBox = document.getElementById('tgtAll');
      allBox.addEventListener('change', () => {
        if (allBox.checked) draft.targetClasses = [DB.ALL_CLASSES];
        else draft.targetClasses = [];
        paint();
      });
      panel.querySelectorAll('[name="tgtClass"]').forEach(cb => cb.addEventListener('change', () => {
        const v = cb.value;
        if (cb.checked) { if (!draft.targetClasses.includes(v)) draft.targetClasses.push(v); }
        else draft.targetClasses = draft.targetClasses.filter(x => x !== v);
        cb.closest('.tgt-box').classList.toggle('is-on', cb.checked);
        refreshSummary();
      }));
      panel.querySelectorAll('[name="tgtCourse"]').forEach(cb => cb.addEventListener('change', () => {
        const v = cb.value;
        if (cb.checked) { if (!draft.courseIds.includes(v)) draft.courseIds.push(v); }
        else draft.courseIds = draft.courseIds.filter(x => x !== v);
        cb.closest('.tgt-box').classList.toggle('is-on', cb.checked);
        refreshSummary();
      }));
      refreshSummary();
    }

    /* ---------- Langkah 3: Metode subtest ---------- */
    function stepMode(panel) {
      const modes = [
        { key: 'single', ic: '🎯', nm: 'Per 1 Subtest', ds: 'Ujian fokus pada satu subtest saja. Cocok untuk ujian harian atau latihan terarah.' },
        { key: 'full',   ic: '🏆', nm: 'Gabungan 7 Subtest (Full UTBK)', ds: 'Simulasi UTBK lengkap. Peserta mengerjakan tiap subtest secara berurutan: PU → PPU → PBM → PK → Literasi Indonesia → Literasi Inggris → Penalaran Matematika.' },
        { key: 'custom', ic: '🧩', nm: 'Custom', ds: 'Bebas memilih subtest mana saja yang ingin digabungkan dalam satu ujian.' }
      ];
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('🧪', 'Metode Subtest', 'Menentukan bagaimana soal dikelompokkan saat dikerjakan')}</div>
          <div class="mode-grid">
            ${modes.map(m => `
              <div class="mode-card ${draft.subtestMode === m.key ? 'is-on' : ''}" data-mode="${m.key}">
                <span class="mc-ic">${m.ic}</span>
                <div class="mc-nm">${UI.esc(m.nm)}</div>
                <div class="mc-ds">${UI.esc(m.ds)}</div>
              </div>`).join('')}
          </div>

          <div class="alert alert-info mt-2">
            <strong>Catatan:</strong> memilih mode <em>tidak</em> otomatis mencentang soal apa pun.
            Anda tetap memilih soal sendiri pada langkah berikutnya, per kategori subtest.
          </div>

          <div id="singlePick" class="${draft.subtestMode === 'single' ? '' : 'hidden'}" style="margin-top:14px;">
            <label style="display:block;font-size:13px;font-weight:600;margin-bottom:8px;">Pilih Subtest</label>
            <div class="tgt-grid">
              ${DB.SUBTESTS.map(s => `
                <label class="tgt-box ${draft.selectedSubtest === s.name ? 'is-on' : ''}">
                  <input type="radio" name="singleSub" value="${UI.esc(s.name)}" ${draft.selectedSubtest === s.name ? 'checked' : ''} />
                  <div>
                    <div class="tgt-name">${s.icon} ${UI.esc(s.short)}</div>
                    <div class="tgt-meta">${DB.getQuestions().filter(q => q.subject === s.name).length} soal tersedia</div>
                  </div>
                </label>`).join('')}
            </div>
          </div>
        </div>`;

      panel.insertAdjacentHTML('beforeend', scoringCardHtml());
      bindScoringCard(panel);

      panel.querySelectorAll('[data-mode]').forEach(c => c.addEventListener('click', () => {
        draft.subtestMode = c.dataset.mode;
        paint();
      }));
      panel.querySelectorAll('[name="singleSub"]').forEach(r => r.addEventListener('change', () => {
        draft.selectedSubtest = r.value;
        paint();
      }));
    }

    /* ---------- Sistem penilaian (bagian langkah 3) ---------- */
    function scoringCardHtml() {
      const sc = draft.scoring;
      const modes = [
        { key: 'irt', ic: '📈', nm: 'IRT UTBK (200–800)', ds: 'Skor cohort-weighted / Rasch-like seperti UTBK: soal yang jarang dijawab benar berbobot lebih tinggi. Benar 1, salah/kosong 0, tanpa minus.' },
        { key: 'points', ic: '⭐', nm: 'Poin Manual', ds: 'Anda menentukan sendiri poin setiap soal atau total poin paket. Cocok untuk ulangan, kuis, dan tryout berpoin.' },
        { key: 'both', ic: '⚖️', nm: 'Poin + IRT', ds: 'Skor utama berupa poin, sekaligus menampilkan skor IRT 200–800 sebagai pembanding.' }
      ];
      const pts = sc.mode !== 'irt';
      return `
        <div class="card">
          <div class="card-header">${UI.secHead('🏅', 'Sistem Penilaian', 'Menentukan cara skor peserta dihitung')}</div>
          <div class="mode-grid">
            ${modes.map(m => `
              <div class="mode-card ${sc.mode === m.key ? 'is-on' : ''}" data-scoremode="${m.key}" role="button" tabindex="0" aria-pressed="${sc.mode === m.key}">
                <span class="mc-ic">${m.ic}</span>
                <div class="mc-nm">${UI.esc(m.nm)}</div>
                <div class="mc-ds">${UI.esc(m.ds)}</div>
              </div>`).join('')}
          </div>
          ${pts ? `
          <div class="wz-pts-opts">
            <label class="wz-sub-label">Cara menentukan poin</label>
            <div class="tgt-grid">
              <label class="tgt-box ${sc.basis === 'question' ? 'is-on' : ''}">
                <input type="radio" name="ptsBasis" value="question" ${sc.basis === 'question' ? 'checked' : ''} />
                <div><div class="tgt-name">🎯 Poin per Soal</div>
                  <div class="tgt-meta">Poin bawaan diambil dari Bank Soal dan dapat diubah satu per satu di langkah "Tinjau & Simpan".</div></div>
              </label>
              <label class="tgt-box ${sc.basis === 'package' ? 'is-on' : ''}">
                <input type="radio" name="ptsBasis" value="package" ${sc.basis === 'package' ? 'checked' : ''} />
                <div><div class="tgt-name">📦 Poin per Paket</div>
                  <div class="tgt-meta">Masukkan total poin paket ujian; poin dibagi rata ke setiap soal.</div></div>
              </label>
            </div>
            <div class="form-row" style="margin-top:12px;">
              ${sc.basis === 'package' ? `<div class="form-group">
                <label for="wzPkgTotal">Total poin paket</label>
                <input type="number" id="wzPkgTotal" min="1" max="100000" step="any" value="${sc.packageTotal}" />
                <div class="muted small">Contoh: 100 (skala nilai rapor) atau 1000.</div>
              </div>` : ''}
              <div class="form-group">
                <label for="wzWrong">Poin jawaban salah</label>
                <input type="number" id="wzWrong" max="0" min="-1000" step="any" value="${sc.wrongPoints}" />
                <div class="muted small">0 = tanpa minus (seperti UTBK). Isi negatif, mis. -1, untuk pengurangan per jawaban salah. Jawaban kosong selalu 0.</div>
              </div>
            </div>
            <div class="alert alert-info small" style="margin-bottom:0;">Soal esai mendapat poin dari tutor lewat tombol <strong>✍️ Nilai Esai</strong> pada halaman Hasil ujian.</div>
          </div>` : ''}
        </div>`;
    }

    function bindScoringCard(panel) {
      const sc = draft.scoring;
      panel.querySelectorAll('[data-scoremode]').forEach(c => {
        const pick = () => { sc.mode = c.dataset.scoremode; paint(); };
        c.addEventListener('click', pick);
        c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      });
      panel.querySelectorAll('[name="ptsBasis"]').forEach(r => r.addEventListener('change', () => { sc.basis = r.value; paint(); }));
      const tot = panel.querySelector('#wzPkgTotal');
      if (tot) tot.addEventListener('change', () => {
        const v = Number(tot.value);
        sc.packageTotal = Number.isFinite(v) && v > 0 ? Math.min(100000, v) : 100;
        tot.value = sc.packageTotal;
      });
      const wr = panel.querySelector('#wzWrong');
      if (wr) wr.addEventListener('change', () => {
        const v = Number(wr.value);
        sc.wrongPoints = Number.isFinite(v) ? Math.max(-1000, -Math.abs(v)) : 0;
        wr.value = sc.wrongPoints;
      });
    }

    /** Objek CBT sementara dari draft (untuk pratinjau poin). */
    /** Ringkasan materi dari soal yang dipilih: "Logika Umum (5) • Silogisme (2) …". */
    function coverageHtml() {
      const ids = builtSections().flatMap(s => s.questionIds);
      if (!ids.length) return '<span class="muted">-</span>';
      const counts = new Map();
      let none = 0;
      ids.forEach(id => {
        const l = Topics.labelOf(DB.getQuestion(id));
        if (!l) { none++; return; }
        counts.set(l.text, (counts.get(l.text) || 0) + 1);
      });
      const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="qc-chip tp-chip">${UI.esc(t)} · ${n}</span>`);
      return `<div class="qc-tags">${parts.join('')}${none ? `<span class="qc-chip opt">${none} soal tanpa materi</span>` : ''}</div>`;
    }

    function draftCbt() {
      const sc = draft.scoring;
      return {
        sections: builtSections(), scoringMode: sc.mode, pointsBasis: sc.basis,
        packageTotal: sc.packageTotal, wrongPoints: sc.wrongPoints, points: sc.points
      };
    }

    /* ---------- Langkah 4: Pilih soal per subtest ---------- */
    function stepSoal(panel) {
      const subs = activeSubtests();
      let activeSub = subs[0];
      let fType = '', fDiff = '', fQuery = '';
      const tf = { topicId: '', subtopicId: '' };     // filter materi / sub materi

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('📚', 'Soal Tersedia', 'Dikelompokkan per kategori subtest — centang soal yang ingin dimasukkan')}</div>
          <div class="qb-layout">
            <div class="qb-side">
              <div class="qb-side-head">Kategori Subtest</div>
              <div id="subList"></div>
            </div>
            <div class="qb-main">
              <div class="qb-filters">
                <input type="search" id="qSearch" class="qf-grow" placeholder="Cari teks soal..." autocomplete="off" />
                <select id="fType">
                  <option value="">Semua Format</option>
                  ${DB.QUESTION_TYPES.map(t => `<option value="${UI.esc(t)}">${UI.esc(t)}</option>`).join('')}
                </select>
                <select id="fDiff">
                  <option value="">Semua Tingkat</option>
                  ${DB.DIFFICULTIES.map(d => `<option value="${d}">${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
                </select>
                ${global.Topics ? '<span class="qf-topics" id="wzTpBox"></span>' : ''}
                <button class="btn btn-sm btn-secondary" id="selAll">Pilih Semua</button>
                <button class="btn btn-sm btn-secondary" id="selNone">Kosongkan</button>
              </div>
              <div class="qb-random">
                <label for="wzRandN">Ambil acak</label>
                <input type="number" id="wzRandN" min="1" max="200" value="10" />
                <span class="muted small">soal dari hasil filter yang belum dipilih</span>
                <button type="button" class="btn btn-sm btn-secondary" id="wzRandGo">Ambil</button>
              </div>
              <div id="qArea"></div>
            </div>
          </div>
          <div class="qb-bar">
            <div class="qb-sum">Total dipilih: <strong id="totalSel">${totalPicked()}</strong> soal
              <span class="muted small" id="subSel"></span>
            </div>
            <div class="flex-gap">
              <label class="muted small" style="align-self:center;">Durasi subtest ini (menit)</label>
              <input type="number" id="subDur" min="1" max="240" style="width:86px;padding:7px 10px;border:1px solid var(--gray-300);border-radius:6px;" />
            </div>
          </div>
        </div>`;

      const subListEl = document.getElementById('subList');
      const qArea = document.getElementById('qArea');

      function paintSubList() {
        subListEl.innerHTML = subs.map(name => {
          const st = DB.subtestByName(name);
          const avail = DB.getQuestions().filter(q => q.subject === name).length;
          const sel = (draft.picked[name] || []).length;
          return `<div class="qb-sub ${activeSub === name ? 'is-active' : ''}" data-sub="${UI.esc(name)}">
            <span class="qs-ic">${st ? st.icon : '📘'}</span>
            <span class="qs-nm">${UI.esc(st ? st.short : name)}
              ${sel ? `<span class="qs-sel">✓ ${sel} dipilih</span>` : ''}
            </span>
            <span class="qs-cnt">${avail}</span>
          </div>`;
        }).join('');
        subListEl.querySelectorAll('[data-sub]').forEach(el => el.addEventListener('click', () => {
          activeSub = el.dataset.sub;
          tf.topicId = ''; tf.subtopicId = '';
          paintSubList();
          if (global.Topics) paintTopicFilter();
          paintQuestions();
        }));
      }

      /** Soal subtest aktif yang lolos semua filter (format, tingkat, materi, kata kunci). */
      function filtered() {
        let list = DB.getQuestions().filter(q => q.subject === activeSub);
        if (fType) list = list.filter(q => (q.questionType || 'Pilihan Ganda') === fType);
        if (fDiff) list = list.filter(q => (q.difficulty || 'sedang') === fDiff);
        if (global.Topics) list = list.filter(q => Topics.matches(q, tf));
        if (fQuery) list = list.filter(q => DataSearch.matches(DataSearch.norm(DataSearch.plain(q.text)), fQuery));
        return list;
      }
      function paintTopicFilter() {
        const box = document.getElementById('wzTpBox');
        if (!box) return;
        box.innerHTML = Topics.filterHtml(activeSub, tf, 'wz');
        box.querySelector('#wzTopic').addEventListener('change', (e) => { tf.topicId = e.target.value; tf.subtopicId = ''; paintTopicFilter(); paintQuestions(); });
        box.querySelector('#wzSub').addEventListener('change', (e) => { tf.subtopicId = e.target.value; paintQuestions(); });
      }

      function paintQuestions() {
        const st = DB.subtestByName(activeSub);
        const list = filtered();

        const sel = new Set(draft.picked[activeSub] || []);
        const dur = draft.durations[activeSub] || (st ? st.defaultMinutes : 20);
        document.getElementById('subDur').value = dur;

        qArea.innerHTML = list.length === 0
          ? emptyState(`Belum ada soal untuk ${st ? st.short : activeSub} dengan filter ini. Tambahkan lewat menu Bank Soal.`, '📭')
          : `<div class="q-cards">${list.map(q => questionCardHtml(q, sel.has(q.id))).join('')}</div>`;

        qArea.querySelectorAll('.q-card input[type="checkbox"]').forEach(cb => cb.addEventListener('change', () => {
          const card = cb.closest('.q-card');
          const qid = card.dataset.qid;
          const arr = draft.picked[activeSub] ? draft.picked[activeSub].slice() : [];
          if (cb.checked) { if (!arr.includes(qid)) arr.push(qid); }
          else { const i = arr.indexOf(qid); if (i > -1) arr.splice(i, 1); }
          draft.picked[activeSub] = arr;
          card.classList.toggle('is-on', cb.checked);
          refreshCounts();
          paintSubList();
        }));
        refreshCounts();
      }

      function refreshCounts() {
        document.getElementById('totalSel').textContent = totalPicked();
        const st = DB.subtestByName(activeSub);
        document.getElementById('subSel').textContent =
          `• ${(draft.picked[activeSub] || []).length} soal di ${st ? st.short : activeSub}`;
      }

      document.getElementById('qSearch').addEventListener('input', (e) => { fQuery = e.target.value.trim(); paintQuestions(); });
      document.getElementById('wzRandGo').addEventListener('click', () => {
        const want = Math.max(1, Math.min(200, Math.round(Number(document.getElementById('wzRandN').value) || 0)));
        const have = new Set(draft.picked[activeSub] || []);
        const pool = filtered().map(q => q.id).filter(id => !have.has(id));
        if (!pool.length) { UI.toast('Semua soal pada filter ini sudah dipilih.', 'info'); return; }
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const take = pool.slice(0, want);
        draft.picked[activeSub] = [...have, ...take];
        UI.toast(take.length < want ? `Hanya ${take.length} soal tersedia; semuanya ditambahkan.` : `${take.length} soal acak ditambahkan.`, 'success');
        paintQuestions(); paintSubList();
      });
      document.getElementById('fType').addEventListener('change', (e) => { fType = e.target.value; paintQuestions(); });
      document.getElementById('fDiff').addEventListener('change', (e) => { fDiff = e.target.value; paintQuestions(); });
      document.getElementById('selAll').addEventListener('click', () => {
        // Hanya soal yang tampil (menghormati filter) pada subtest aktif
        const shown = [...qArea.querySelectorAll('.q-card')].map(c => c.dataset.qid);
        const arr = new Set(draft.picked[activeSub] || []);
        shown.forEach(id => arr.add(id));
        draft.picked[activeSub] = [...arr];
        paintQuestions(); paintSubList();
      });
      document.getElementById('selNone').addEventListener('click', () => {
        draft.picked[activeSub] = [];
        paintQuestions(); paintSubList();
      });
      document.getElementById('subDur').addEventListener('change', (e) => {
        draft.durations[activeSub] = Math.max(1, Number(e.target.value) || 1);
      });

      paintSubList();
      if (global.Topics) paintTopicFilter();
      paintQuestions();
    }

    /* ---------- Langkah 5: Keamanan & pemantauan ---------- */
    function stepSecurity(panel) {
      const s = draft.security;
      const opts = [
        { key: 'requireCamera', ic: '📷', nm: 'Wajib Kamera Aktif',
          ds: 'Peserta harus mengizinkan akses kamera sebelum ujian dimulai. Pratinjau kamera tetap tampil selama ujian sebagai bukti kehadiran.' },
        { key: 'requireMic', ic: '🎙️', nm: 'Wajib Mikrofon Aktif',
          ds: 'Mikrofon diaktifkan untuk memantau tingkat kebisingan/suara di sekitar peserta. Indikator level suara terlihat oleh peserta.' },
        { key: 'requireScreenShare', ic: '🖲️', nm: 'Wajib Berbagi Layar',
          ds: 'Peserta harus membagikan SELURUH layar. Bila hanya membagikan tab/jendela, permintaan ditolak. Menghentikan berbagi layar akan mengunci ujian.' },
        { key: 'fullscreen', ic: '🖥️', nm: 'Paksa Mode Layar Penuh',
          ds: 'Ujian dijalankan dalam layar penuh. Bila peserta keluar, ujian terkunci hingga mereka kembali.' },
        { key: 'lockScreen', ic: '🔒', nm: 'Kunci Layar Ujian',
          ds: 'Menampilkan overlay pengunci saat peserta keluar dari layar penuh, berpindah tab, atau menghentikan berbagi layar. Waktu ujian tetap berjalan.' },
        { key: 'blockTabSwitch', ic: '🚫', nm: 'Deteksi Pindah Tab / Aplikasi',
          ds: 'Setiap kali peserta meninggalkan halaman ujian, sistem mencatatnya sebagai pelanggaran dan memberi peringatan.' },
        { key: 'blockCopy', ic: '📋', nm: 'Anti Salin Soal',
          ds: 'Menonaktifkan klik kanan, seleksi teks, drag gambar, dan pintasan salin/simpan/cetak. Papan klip dikosongkan saat ada upaya menyalin.' },
        { key: 'blockScreenshot', ic: '📸', nm: 'Anti Tangkapan Layar',
          ds: 'Mencatat penekanan Print Screen, mengosongkan papan klip, dan mengaburkan soal ketika jendela ujian tidak aktif.' }
      ];
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('🔒', 'Keamanan & Pemantauan Langsung', 'Aktifkan pengawasan selama ujian berlangsung')}</div>
          ${opts.map(o => `
            <label class="sec-opt ${s[o.key] ? 'is-on' : ''}">
              <input type="checkbox" name="sec" value="${o.key}" ${s[o.key] ? 'checked' : ''} />
              <div>
                <div class="so-nm">${o.ic} ${UI.esc(o.nm)}</div>
                <div class="so-ds">${UI.esc(o.ds)}</div>
              </div>
            </label>`).join('')}

          <div class="form-row mt-2">
            <div class="form-group">
              <label>Batas Pelanggaran Sebelum Peringatan Keras</label>
              <input type="number" id="maxVio" min="1" max="20" value="${s.maxViolations || 3}" />
            </div>
          </div>

          <div class="alert alert-info">
            <strong>Catatan privasi:</strong> kamera, mikrofon, dan layar hanya diakses di perangkat peserta untuk
            menampilkan pratinjau dan mendeteksi aktivitas. Tidak ada rekaman video/audio/layar yang dikirim atau
            disimpan — sistem hanya mencatat <em>kejadian</em> pelanggaran (mis. pindah tab) untuk dilihat pengawas.
          </div>
          <div class="alert alert-warning">
            <strong>Batas teknis yang perlu diketahui:</strong> proteksi anti-salin dan anti-tangkapan-layar
            berjalan di dalam peramban sehingga bersifat <em>pencegah</em>. Alat tingkat sistem operasi,
            kamera ponsel, atau ekstensi peramban tertentu tetap tidak dapat diblokir sepenuhnya oleh kode web.
            Karena itu setiap upaya dicatat sebagai pelanggaran agar pengawas dapat menindaklanjuti.
          </div>
        </div>`;

      panel.querySelectorAll('[name="sec"]').forEach(cb => cb.addEventListener('change', () => {
        draft.security[cb.value] = cb.checked;
        cb.closest('.sec-opt').classList.toggle('is-on', cb.checked);
      }));
      document.getElementById('maxVio').addEventListener('change', (e) => {
        draft.security.maxViolations = Math.max(1, Number(e.target.value) || 3);
      });
    }

    /* ---------- Langkah 6: Tinjau & simpan ---------- */
    function stepReview(panel) {
      const sections = builtSections();
      const totalQ = sections.reduce((n, s) => n + s.questionIds.length, 0);
      const totalMin = sections.reduce((n, s) => n + s.durationMinutes, 0);
      const peserta = targetedStudents({ targetClasses: draft.targetClasses, courseIds: draft.courseIds }).length;
      const sec = draft.security;

      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('✅', 'Tinjau Ujian', 'Periksa kembali sebelum disimpan')}</div>
          <div class="stats-grid" style="margin-bottom:14px;">
            <div class="stat-card accent-primary"><div class="label">Total Soal</div><div class="value">${totalQ}</div></div>
            <div class="stat-card accent-success"><div class="label">Bagian Subtest</div><div class="value">${sections.length}</div></div>
            <div class="stat-card accent-warning"><div class="label">Total Durasi</div><div class="value">${totalMin}</div><div class="sub">menit</div></div>
            <div class="stat-card accent-danger"><div class="label">Perkiraan Peserta</div><div class="value">${peserta}</div></div>
          </div>

          <div class="table-wrap"><table class="table">
            <tbody>
              <tr><th style="width:190px;">Judul</th><td><strong>${UI.esc(draft.title || '-')}</strong></td></tr>
              <tr><th>Deskripsi</th><td>${draft.description ? UI.esc(draft.description) : '<span class="muted">Tidak ada deskripsi</span>'}</td></tr>
              <tr><th>Kelas Tujuan</th><td>${UI.esc(DB.cbtTargetLabel({ targetClasses: draft.targetClasses }))}</td></tr>
              <tr><th>Kelas Mata Pelajaran</th><td>${draft.courseIds.length
                ? draft.courseIds.map(id => UI.esc(DB.getCourse(id)?.title || '-')).join(', ')
                : '<span class="muted">Tidak dikaitkan</span>'}</td></tr>
              ${inClass ? `<tr><th>Tutor Penanggung Jawab</th><td>${ownerId
                ? UI.esc(DB.contentOwnerName({ createdBy: ownerId }) || '-') +
                  (user.role === 'admin' ? ' <span class="badge badge-gray">diinput admin</span>' : '')
                : '<span class="muted">Tidak dikaitkan ke tutor</span>'}</td></tr>` : ''}
              <tr><th>Metode</th><td>${draft.subtestMode === 'full' ? 'Gabungan 7 Subtest (Full UTBK)'
                : (draft.subtestMode === 'single' ? 'Per 1 Subtest — ' + UI.esc(draft.selectedSubtest) : 'Custom')}</td></tr>
              ${global.Topics ? `<tr><th>Cakupan Materi</th><td>${coverageHtml()}</td></tr>` : ''}
              <tr><th>Sistem Penilaian</th><td id="wzScoreDesc">${global.Scoring ? UI.esc(Scoring.describe(draftCbt())) : 'IRT'}</td></tr>
              <tr><th>Jadwal</th><td>${UI.fmtDateTime(draft.startAt)} &nbsp;s.d.&nbsp; ${UI.fmtDateTime(draft.endAt)}</td></tr>
              <tr><th>Keamanan</th><td>
                ${[sec.requireCamera ? '📷 Kamera wajib' : '', sec.requireMic ? '🎙️ Mikrofon wajib' : '',
                   sec.requireScreenShare ? '🖲️ Berbagi layar wajib' : '',
                   sec.fullscreen ? '🖥️ Layar penuh' : '', sec.lockScreen ? '🔒 Kunci layar' : '',
                   sec.blockTabSwitch ? '🚫 Deteksi pindah tab' : '',
                   sec.blockCopy ? '📋 Anti salin' : '', sec.blockScreenshot ? '📸 Anti tangkapan layar' : '']
                  .filter(Boolean).map(x => `<span class="badge badge-info" style="margin:2px;">${x}</span>`).join('')
                  || '<span class="muted">Tanpa pengawasan khusus</span>'}
              </td></tr>
            </tbody>
          </table></div>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('📋', 'Urutan Pengerjaan', 'Peserta mengerjakan bagian secara berurutan sesuai urutan resmi UTBK')}</div>
          ${sections.length === 0 ? emptyState('Belum ada soal dipilih. Kembali ke langkah "Pilih Soal".') : `
          <div class="sec-list">
            ${sections.map((s, i) => {
              const st = DB.subtestByName(s.subtest);
              return `<div class="sec-row">
                <div class="sr-ord">${i + 1}</div>
                <div class="sr-nm">${st ? st.icon : '📘'} ${UI.esc(s.subtest)}
                  <div class="sr-meta">${s.questionIds.length} soal • ${s.durationMinutes} menit</div>
                </div>
              </div>`;
            }).join('')}
          </div>`}
        </div>
        ${global.Scoring && draft.scoring.mode !== 'irt' && sections.length ? pointsEditorHtml(sections) : ''}`;
      if (global.Scoring && draft.scoring.mode !== 'irt' && sections.length) bindPointsEditor(panel, sections);
    }

    /* ---------- Editor poin per soal (langkah 6) ---------- */
    function pointsEditorHtml(sections) {
      const sc = draft.scoring;
      const fmt = Scoring.fmtNum;
      const maxMap = Scoring.maxPointsMap(draftCbt());
      const pkg = sc.basis === 'package';
      return `
        <div class="card" id="wzPtsCard">
          <div class="card-header">
            ${UI.secHead('⭐', pkg ? 'Poin per Soal (paket)' : 'Poin per Soal', pkg
              ? 'Total poin paket dibagi rata ke semua soal'
              : 'Berlaku khusus untuk ujian ini — poin di Bank Soal tidak berubah')}
            <div class="wz-pts-total">Total: <strong id="wzPtsTotal">${fmt(Object.values(maxMap).reduce((n, v) => n + v, 0))}</strong> poin</div>
          </div>
          ${pkg ? '' : `<div class="wz-pts-bulk">
            <label for="wzPtsAll" class="muted small">Samakan semua soal</label>
            <input type="number" id="wzPtsAll" min="0" max="${Scoring.MAX_POINTS}" step="any" value="1" />
            <button type="button" class="btn btn-sm btn-secondary" id="wzPtsApply">Terapkan</button>
            <button type="button" class="btn btn-sm btn-ghost" id="wzPtsReset">↺ Pakai poin Bank Soal</button>
          </div>`}
          <div class="table-wrap"><table class="table wz-pts-table">
            <thead><tr><th>#</th><th>Soal</th><th>Format</th><th>Poin Bank</th><th>Poin di ujian ini</th></tr></thead>
            <tbody>${sections.map(sec => {
              const st = DB.subtestByName(sec.subtest);
              return `<tr class="wz-pts-sec"><td colspan="5">${st ? st.icon : '📘'} <strong>${UI.esc(sec.subtest)}</strong>
                  <span class="muted small" data-sec-total="${UI.esc(sec.subtest)}"></span></td></tr>` +
                sec.questionIds.map((qid, i) => {
                  const q = DB.getQuestion(qid);
                  if (!q) return '';
                  const ess = (q.questionType || '') === 'Esai';
                  return `<tr>
                    <td>${i + 1}</td>
                    <td><div class="wz-pts-q">${UI.esc(RichText.plain(q.text, 120))}</div></td>
                    <td><span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>${ess ? ' <span class="badge badge-warning">dinilai tutor</span>' : ''}</td>
                    <td class="muted">${fmt(Scoring.defaultPoints(q))}</td>
                    <td>${pkg ? `<strong>${fmt(maxMap[qid] || 0)}</strong>`
                      : `<input type="number" class="wz-pts-in" data-pts="${UI.esc(qid)}" data-sub="${UI.esc(sec.subtest)}" min="0" max="${Scoring.MAX_POINTS}" step="any"
                          value="${maxMap[qid] != null ? maxMap[qid] : 1}" aria-label="Poin soal ${i + 1} ${UI.esc(sec.subtest)}" />`}</td>
                  </tr>`;
                }).join('');
            }).join('')}</tbody>
          </table></div>
        </div>`;
    }

    function bindPointsEditor(panel, sections) {
      const sc = draft.scoring;
      const refresh = () => {
        const cbt = draftCbt();
        const maxMap = Scoring.maxPointsMap(cbt);
        const total = Object.values(maxMap).reduce((n, v) => n + v, 0);
        const t = panel.querySelector('#wzPtsTotal');
        if (t) t.textContent = Scoring.fmtNum(total);
        sections.forEach(sec => {
          const el = panel.querySelector(`[data-sec-total="${CSS.escape(sec.subtest)}"]`);
          if (el) el.textContent = ` • ${Scoring.fmtNum(sec.questionIds.reduce((n, id) => n + (maxMap[id] || 0), 0))} poin`;
        });
        const d = panel.querySelector('#wzScoreDesc');
        if (d) d.textContent = Scoring.describe(cbt);
      };
      panel.querySelectorAll('[data-pts]').forEach(inp => inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (inp.value === '' || !Number.isFinite(v) || v < 0) return;
        sc.points[inp.dataset.pts] = Math.min(Scoring.MAX_POINTS, v);
        refresh();
      }));
      panel.querySelectorAll('[data-pts]').forEach(inp => inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (inp.value === '' || !Number.isFinite(v) || v < 0) {
          const q = DB.getQuestion(inp.dataset.pts);
          delete sc.points[inp.dataset.pts];
          inp.value = Scoring.defaultPoints(q);
        } else inp.value = Math.min(Scoring.MAX_POINTS, v);
        refresh();
      }));
      const apply = panel.querySelector('#wzPtsApply');
      if (apply) apply.addEventListener('click', () => {
        const v = Number(panel.querySelector('#wzPtsAll').value);
        if (!Number.isFinite(v) || v < 0) { UI.toast('Poin harus angka 0 atau lebih.', 'error'); return; }
        sections.forEach(sec => sec.questionIds.forEach(id => { sc.points[id] = Math.min(Scoring.MAX_POINTS, v); }));
        panel.querySelectorAll('[data-pts]').forEach(inp => { inp.value = Math.min(Scoring.MAX_POINTS, v); });
        refresh();
        UI.toast('Poin semua soal disamakan.', 'info');
      });
      const reset = panel.querySelector('#wzPtsReset');
      if (reset) reset.addEventListener('click', () => {
        sections.forEach(sec => sec.questionIds.forEach(id => { delete sc.points[id]; }));
        panel.querySelectorAll('[data-pts]').forEach(inp => { inp.value = Scoring.defaultPoints(DB.getQuestion(inp.dataset.pts)); });
        refresh();
        UI.toast('Poin dikembalikan ke nilai Bank Soal.', 'info');
      });
      refresh();
    }

    /** Field penilaian untuk disimpan: hanya poin yang berbeda dari Bank Soal. */
    function scoringPayload(sections) {
      const sc = draft.scoring;
      const mode = sc.mode === 'points' || sc.mode === 'both' ? sc.mode : 'irt';
      const out = { scoringMode: mode, pointsBasis: sc.basis, packageTotal: sc.packageTotal, wrongPoints: sc.wrongPoints, points: {} };
      if (mode !== 'irt' && sc.basis === 'question' && global.Scoring) {
        sections.forEach(sec => sec.questionIds.forEach(id => {
          const v = sc.points[id];
          if (v == null || !Number.isFinite(Number(v))) return;
          if (Number(v) !== Scoring.defaultPoints(DB.getQuestion(id))) out.points[id] = Number(v);
        }));
      }
      return out;
    }

    function doSave() {
      if (!validateStep(0) || !validateStep(1)) return;
      const sections = builtSections();
      if (sections.length === 0) { UI.toast('Pilih minimal 1 soal terlebih dahulu.', 'error'); return; }
      const allQids = sections.flatMap(s => s.questionIds);
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        targetClasses: draft.targetClasses.slice(),
        courseIds: draft.courseIds.slice(),
        // Kompatibilitas dengan tampilan lama yang memakai courseId tunggal
        courseId: draft.courseIds[0] || null,
        subtestMode: draft.subtestMode,
        selectedSubtest: draft.subtestMode === 'single' ? draft.selectedSubtest : null,
        sections,
        questionIds: allQids,
        durationMinutes: sections.reduce((n, s) => n + s.durationMinutes, 0),
        security: draft.security,
        startAt: draft.startAt,
        endAt: draft.endAt
      };
      Object.assign(payload, scoringPayload(sections));
      if (payload.scoringMode !== 'irt' && global.Scoring) {
        const total = Object.values(Scoring.maxPointsMap(Object.assign({}, payload))).reduce((n, v) => n + v, 0);
        if (!(total > 0)) { UI.toast('Total poin ujian masih 0. Atur poin minimal satu soal pada langkah Tinjau.', 'error'); return; }
      }

      if (editing) {
        const patch = DB.stampEditor(payload, user);
        // Admin boleh mengosongkan atribusi secara sengaja; tutor tidak bisa
        // memindahkan kepemilikan ujian orang lain.
        patch.createdBy = user.role === 'admin'
          ? (ownerId || null)
          : (ownerId || editing.createdBy || null);
        DB.updateCbt(editing.id, patch);
        UI.toast('Perubahan ujian disimpan.');
      } else {
        const created = DB.addCbt(DB.stampCreator(payload, user, ownerId));
        // Beritahu peserta yang ditargetkan
        const students = targetedStudents(created);
        DB.notifyUsers(students.map(s => s.id), {
          type: 'cbt', icon: '🖥️',
          title: 'Ujian CBT baru',
          body: `${payload.title} — ${allQids.length} soal, ${payload.durationMinutes} menit.`,
          link: 'cbt'
        });
        UI.toast(`Ujian dibuat & ${students.length} peserta diberi notifikasi.`);
      }
      closeWorkspace();
      if (typeof onDone === 'function') onDone();
    }
  }

  /* =====================================================================
   * 3) BANK SOAL BROWSER ("Soal Tersedia") — halaman khusus
   * ===================================================================*/
  function openBankBrowser(user, onDone, initialSub) {
    let activeSub = (initialSub && DB.SUBTEST_NAMES.includes(initialSub)) ? initialSub : DB.SUBTESTS[0].name;
    let fType = '', fDiff = '', fQuery = '';
    const tf = { topicId: '', subtopicId: '' };     // filter materi / sub materi
    let bbPage = 1;

    const body = openWorkspace('Soal Tersedia — Bank Soal',
      'Telusuri soal per kategori subtest, format, dan tingkat kesulitan',
      `${global.Topics ? '<button class="btn btn-secondary btn-sm" id="wsTopics">🗂 Materi & Sub Materi</button>' : ''}
       <button class="btn btn-secondary btn-sm" id="wsBulkQ">⚡ Buat Massal</button>
       <button class="btn btn-secondary btn-sm" id="wsImportQ">⬆ Impor</button>
       <button class="btn btn-secondary btn-sm" id="wsDocQ" title="Baca soal dari PDF/Word, dibantu AI"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/></svg> Impor PDF/Word</button>
       <button class="btn btn-secondary btn-sm" id="wsExportQ">⬇ Ekspor</button>
       <button class="btn btn-primary btn-sm" id="wsAddQ">+ Tambah Soal</button>`);
    wsEl.__onBack = () => { closeWorkspace(); if (typeof onDone === 'function') onDone(); };

    // Subtest yang sedang dibuka ikut terbawa ke editor soal
    document.getElementById('wsAddQ').addEventListener('click', () =>
      openQuestionForm(user, null, paintAll, { subtest: activeSub }));
    document.getElementById('wsBulkQ').addEventListener('click', () =>
      BankTools.openBulk(user, paintAll, { subtest: activeSub }));
    document.getElementById('wsImportQ').addEventListener('click', () =>
      BankTools.openImport(user, paintAll, { subtest: activeSub }));
    document.getElementById('wsDocQ').addEventListener('click', () =>
      DocImport.open(user, paintAll, { subtest: activeSub }));
    document.getElementById('wsExportQ').addEventListener('click', () => openExportMenu());
    const tpBtn = document.getElementById('wsTopics');
    if (tpBtn) tpBtn.addEventListener('click', () => Topics.openManager(user, () => { if (tf.topicId && !Topics.get(tf.topicId)) { tf.topicId = ''; tf.subtopicId = ''; } paintAll(); }, activeSub));

    /** Pilihan ekspor: seluruh bank atau hanya subtest yang sedang dibuka. */
    function openExportMenu() {
      const inSub = DB.getQuestions().filter(q => q.subject === activeSub);
      Editor.openSubDialog('Ekspor Bank Soal', `
        <p class="muted small" style="margin-top:0;">Berkas berisi kolom lengkap beserta kunci jawaban dan pembahasan,
          dan bisa diimpor kembali tanpa penyesuaian.</p>
        <div class="form-group">
          <label>Cakupan</label>
          <label class="qe-check"><input type="radio" name="bkScope" value="all" checked />
            Seluruh bank soal (${DB.getQuestions().length} soal)</label>
          <label class="qe-check"><input type="radio" name="bkScope" value="sub" ${inSub.length ? '' : 'disabled'} />
            Hanya ${UI.esc(activeSub)} (${inSub.length} soal)</label>
        </div>
        <div class="flex-gap mt-2" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
          <button type="button" class="btn btn-secondary" data-csv>⬇ CSV</button>
          <button type="button" class="btn btn-primary" data-xlsx>⬇ Excel</button>
        </div>
      `, (back, close) => {
        const pick = () => {
          const scope = (back.querySelector('[name="bkScope"]:checked') || {}).value;
          return scope === 'sub' ? DB.getQuestions().filter(q => q.subject === activeSub) : DB.getQuestions();
        };
        back.querySelector('[data-cancel]').addEventListener('click', close);
        back.querySelector('[data-csv]').addEventListener('click', () => { const l = pick(); close(); BankTools.exportQuestions(l, 'csv'); });
        back.querySelector('[data-xlsx]').addEventListener('click', () => { const l = pick(); close(); BankTools.exportQuestions(l, 'xlsx'); });
      });
    }

    paintAll();

    function paintAll() {
      const all = DB.getQuestions();
      body.innerHTML = `
        <div class="stats-grid">
          ${DB.SUBTESTS.slice(0, 4).map(s => {
            const n = all.filter(q => q.subject === s.name).length;
            return `<div class="stat-card accent-primary"><div class="label">${UI.esc(s.short)}</div><div class="value">${n}</div><div class="sub">soal tersedia</div></div>`;
          }).join('')}
        </div>
        <div class="qb-layout">
          <div class="qb-side">
            <div class="qb-side-head">Kategori Subtest</div>
            <div id="bbSubList"></div>
          </div>
          <div class="qb-main">
            <div class="qb-filters">
              <input type="search" id="bbSearch" class="qf-grow" placeholder="Cari isi soal, opsi, pembahasan, kunci… (mis. bilangan)" autocomplete="off" value="${UI.esc(fQuery)}" />
              <button type="button" class="btn btn-sm btn-secondary" id="bbClear" aria-label="Hapus pencarian">✕ Clear</button>
              <select id="bbType">
                <option value="">Semua Format</option>
                ${DB.QUESTION_TYPES.map(t => `<option value="${UI.esc(t)}" ${fType === t ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}
              </select>
              <select id="bbDiff">
                <option value="">Semua Tingkat</option>
                ${DB.DIFFICULTIES.map(d => `<option value="${d}" ${fDiff === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
              </select>
              ${global.Topics ? '<span class="qf-topics" id="bbTpBox"></span>' : ''}
            </div>
            <div id="bbArea"></div>
          </div>
        </div>`;
      paintSubs();
      paintList();

      // Debounce agar pencarian tidak dijalankan pada setiap ketukan tombol.
      let bbTimer = null;
      const bbInput = document.getElementById('bbSearch');
      bbInput.addEventListener('input', (e) => {
        clearTimeout(bbTimer);
        bbTimer = setTimeout(() => { fQuery = e.target.value.trim(); bbPage = 1; paintList(); }, 220);
      });
      document.getElementById('bbClear').addEventListener('click', () => {
        clearTimeout(bbTimer); bbInput.value = ''; fQuery = ''; bbPage = 1; paintList(); bbInput.focus();
      });
      document.getElementById('bbType').addEventListener('change', (e) => { fType = e.target.value; bbPage = 1; paintList(); });
      document.getElementById('bbDiff').addEventListener('change', (e) => { fDiff = e.target.value; bbPage = 1; paintList(); });
      paintTopicFilter();
      if (global.Effects) Effects.enhance(body);
    }

    function paintTopicFilter() {
      const box = document.getElementById('bbTpBox');
      if (!box) return;
      box.innerHTML = Topics.filterHtml(activeSub, tf, 'bb');
      box.querySelector('#bbTopic').addEventListener('change', (e) => { tf.topicId = e.target.value; tf.subtopicId = ''; bbPage = 1; paintTopicFilter(); paintList(); });
      box.querySelector('#bbSub').addEventListener('change', (e) => { tf.subtopicId = e.target.value; bbPage = 1; paintList(); });
    }

    function paintSubs() {
      const all = DB.getQuestions();
      document.getElementById('bbSubList').innerHTML = DB.SUBTESTS.map(s => {
        const n = all.filter(q => q.subject === s.name).length;
        return `<div class="qb-sub ${activeSub === s.name ? 'is-active' : ''}" data-sub="${UI.esc(s.name)}">
          <span class="qs-ic">${s.icon}</span>
          <span class="qs-nm">${UI.esc(s.short)}<div class="muted small">${UI.esc(s.group)}</div></span>
          <span class="qs-cnt">${n}</span>
        </div>`;
      }).join('');
      document.getElementById('bbSubList').querySelectorAll('[data-sub]').forEach(el =>
        el.addEventListener('click', () => {
          activeSub = el.dataset.sub; bbPage = 1; tf.topicId = ''; tf.subtopicId = '';
          paintSubs(); paintTopicFilter(); paintList();
        }));
    }

    /** Semua teks yang relevan dari satu soal: isi, opsi, kunci, pembahasan, atribut. */
    function questionHaystack(q) {
      const P = global.DataSearch ? DataSearch.plain : (s => String(s || ''));
      return DataSearch.norm([
        P(q.text), (q.options || []).map(P).join(' '), P(q.explanation || ''),
        (q.answers || []).join(' '), (q.keywords || []).join(' '),
        (q.statements || []).map(s => P(s.text)).join(' '), (q.columns || []).join(' '),
        (q.pairs || []).map(p => P(p.left) + ' ' + P(p.right)).join(' '),
        (q.orderItems || []).map(P).join(' '),
        q.subject, q.questionType, q.difficulty, q.id,
        global.Topics && Topics.labelOf(q) ? Topics.labelOf(q).text : '',
        (DB.getUser(q.authorId) || {}).name || ''
      ].join(' '));
    }

    function paintList() {
      const st = DB.subtestByName(activeSub);
      // Saat ada kata kunci, cari di SELURUH bank (semua subtest) agar soal
      // terkait tidak terlewat hanya karena berada di kategori lain.
      let list = fQuery ? DB.getQuestions() : DB.getQuestions().filter(q => q.subject === activeSub);
      if (fType) list = list.filter(q => (q.questionType || 'Pilihan Ganda') === fType);
      if (fDiff) list = list.filter(q => (q.difficulty || 'sedang') === fDiff);
      if (global.Topics && tf.topicId) list = list.filter(q => Topics.matches(q, tf));
      if (fQuery) list = list.filter(q => DataSearch.matches(questionHaystack(q), fQuery));
      const totalMatches = list.length;
      const PAGE = 20;
      const pages = Math.max(1, Math.ceil(totalMatches / PAGE));
      if (bbPage > pages) bbPage = pages;
      list = list.slice((bbPage - 1) * PAGE, bbPage * PAGE);

      const area = document.getElementById('bbArea');
      area.innerHTML = `
        <div class="flex-between mb-2" style="flex-wrap:wrap;gap:8px;">
          <div><strong>${fQuery ? `🔎 Hasil pencarian "${UI.esc(fQuery)}" di seluruh subtest` : (st ? st.icon + ' ' + UI.esc(st.name) : UI.esc(activeSub))}</strong>
            <div class="muted small">${totalMatches} soal cocok${fQuery ? ' (isi soal, opsi, kunci, pembahasan, atribut)' : ` • kelompok ${UI.esc(st ? st.group : '-')}`}</div></div>
        </div>
        ${list.length === 0
          ? emptyState(fQuery || fType || fDiff || tf.topicId ? 'Tidak ada soal yang cocok dengan pencarian/filter.' : 'Belum ada soal pada kategori ini. Klik "+ Tambah Soal" untuk menambahkan.', '📭')
          : `<div class="q-cards">${list.map(q => { const qs = DB.subtestByName(q.subject); return `
              <div class="q-card" style="padding-left:14px;cursor:default;">
                <div class="qc-text rt-content">${RichText.render(q.text)}</div>
                <div class="qc-tags">
                  <span class="qc-chip sub">${qs ? qs.icon : '📘'} ${UI.esc(qs ? qs.short : (q.subject || '-'))}</span>
                  <span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>
                  ${difficultyChip(q.difficulty)}
                  ${global.Topics ? Topics.chipsHtml(q) : ''}
                  <span class="qc-chip opt">${UI.esc(answerShapeLabel(q))}</span>
                </div>
                <div class="flex-gap mt-2">
                  <button class="btn btn-sm btn-secondary" data-edit-q="${q.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-q="${q.id}">Hapus</button>
                </div>
              </div>`; }).join('')}</div>`}
        ${pages > 1 ? `<div class="ds-pager">
          <button type="button" class="btn btn-sm btn-secondary" data-bbpg="prev" ${bbPage <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>
          <span class="ds-pg-info">Halaman ${bbPage} / ${pages} • ${totalMatches} soal</span>
          <button type="button" class="btn btn-sm btn-secondary" data-bbpg="next" ${bbPage >= pages ? 'disabled' : ''}>Berikutnya ›</button>
        </div>` : ''}
      `;
      area.querySelectorAll('[data-bbpg]').forEach(b => b.addEventListener('click', () => {
        bbPage += b.dataset.bbpg === 'next' ? 1 : -1; paintList();
      }));
      area.querySelectorAll('[data-edit-q]').forEach(b => b.addEventListener('click', () =>
        openQuestionForm(user, b.dataset.editQ, paintAll, { subtest: activeSub })));
      area.querySelectorAll('[data-del-q]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus soal ini? Soal juga akan dilepas dari ujian yang memakainya.')) return;
        DB.deleteQuestion(b.dataset.delQ);
        UI.toast('Soal dihapus.');
        paintAll();
      }));
    }
  }

  /* =====================================================================
   * 4) FORM SOAL (dipakai bank browser)
   * ===================================================================*/
  /**
   * Buka editor soal.
   * Sebelumnya memakai UI.modal yang tertimpa oleh overlay workspace
   * (.modal z-index 100 < .cbt-workspace 120) sehingga tombol terasa "tidak
   * berfungsi". Sekarang memakai QEditor: halaman penuh dengan z-index 140.
   */
  /**
   * @param {object} opts { subtest } — subtest yang sedang dibuka agar
   *        pilihan subtest di editor terisi otomatis dan penulis soal tidak
   *        perlu memilihnya ulang setiap kali menambah soal.
   */
  function openQuestionForm(user, editId, onDone, opts) {
    if (!global.QEditor) {
      UI.toast('Editor soal belum termuat. Muat ulang halaman.', 'error');
      return;
    }
    QEditor.open(user, editId, (saved) => {
      if (typeof onDone === 'function') onDone(saved || null);
    }, opts || {});
  }

  /* =====================================================================
   * 5) PEMANTAUAN LANGSUNG
   * ===================================================================*/
  function openMonitor(cbtId, user, onDone) {
    const cbt = DB.getCbt(cbtId);
    if (!cbt) { UI.toast('Ujian tidak ditemukan.', 'error'); return; }
    const body = openWorkspace(`📡 Pemantauan — ${cbt.title}`, 'Memuat ulang otomatis setiap 5 detik');
    wsEl.__onBack = () => { stop(); closeWorkspace(); if (typeof onDone === 'function') onDone(); };

    let timer = null;
    // Koneksi peserta hanya bermakna bila data tersinkron lewat server.
    const netOn = !!(global.Sync && Sync.isServer());
    const NET_IC = {
      ok: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/></svg>',
      warn: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11a4 4 0 0 1-2.5 8Z"/><path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/></svg>',
      bad: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M8.6 8.7A5 5 0 0 0 8 19h9.5c.4 0 .8 0 1.1-.1M21.3 16.2A4 4 0 0 0 20 11a6 6 0 0 0-8.6-5.4"/></svg>'
    };
    const fmtDur = (ms) => {
      const s = Math.round((ms || 0) / 1000);
      if (s < 60) return s + ' dtk';
      const m = Math.floor(s / 60);
      return m < 60 ? `${m} mnt ${s % 60} dtk` : `${Math.floor(m / 60)} jam ${m % 60} mnt`;
    };
    /** Status koneksi peserta yang sedang mengerjakan: status online langsung + riwayat di attempt. */
    function connectionOf(a, p) {
      if (!netOn || !a || a.submittedAt) return null;
      const n = a.net || {};
      const live = p && p.net ? p.net : null;
      const drops = Math.max(Number(n.drops) || 0, live ? Number(live.drops) || 0 : 0);
      const offMs = Math.max(Number(n.offlineMs) || 0, live ? Number(live.offlineMs) || 0 : 0);
      const hist = drops ? `Sempat terputus ${drops}× (total ${fmtDur(offMs)})` : '';
      const saved = n.savedAt ? `jawaban terakhir diterima ${UI.fmtRelative(n.savedAt)}` : 'belum ada jawaban yang diterima';
      if (!p) return { cls: 'bad', text: 'Tidak terhubung', sub: saved.charAt(0).toUpperCase() + saved.slice(1) + (hist ? '. ' + hist : '') };
      if (live && live.pending > 0) return { cls: 'warn', text: `${live.pending} perubahan menunggu terkirim`, sub: hist || 'Jawaban sudah aman di perangkat peserta.' };
      if (drops) return { cls: 'warn', text: 'Tersambung kembali', sub: hist };
      return { cls: 'ok', text: 'Koneksi baik', sub: n.savedAt ? 'Tersimpan ' + UI.fmtRelative(n.savedAt) : '' };
    }
    let ticks = 0;
    paint();
    timer = setInterval(() => {
      // Tarik data & status online peserta tiap 10 detik selama pemantauan berlangsung.
      if (netOn && ++ticks % 2 === 0) Sync.syncNow('monitor');
      paint();
    }, 5000);
    function stop() { if (timer) clearInterval(timer); timer = null; }

    function paint() {
      if (!wsEl) { stop(); return; }
      const students = targetedStudents(cbt);
      const attempts = DB.getCbtAttemptsByCbt(cbt.id);
      const byStudent = new Map(attempts.map(a => [a.studentId, a]));
      const sec = cbt.security || {};
      const pres = new Map((global.Presence ? Presence.getAll() : []).map(r => [r.userId, r]));
      const working = attempts.filter(a => !a.submittedAt).length;
      const finished = attempts.filter(a => a.submittedAt).length;
      const totalVio = attempts.reduce((n, a) => n + (a.violations || []).length, 0);
      const nets = new Map(students.map(s => [s.id, connectionOf(byStudent.get(s.id), pres.get(s.id))]));
      const netBad = [...nets.values()].filter(n => n && n.cls !== 'ok').length;

      body.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent-primary"><div class="label">Peserta Ditargetkan</div><div class="value">${students.length}</div></div>
          <div class="stat-card accent-warning"><div class="label">Sedang Mengerjakan</div><div class="value">${working}</div></div>
          <div class="stat-card accent-success"><div class="label">Sudah Selesai</div><div class="value">${finished}</div></div>
          <div class="stat-card accent-danger"><div class="label">Total Pelanggaran</div><div class="value">${totalVio}</div></div>
          ${netOn ? `<div class="stat-card accent-danger"><div class="label">Koneksi Bermasalah</div><div class="value">${netBad}</div><div class="sub">terputus, tertunda, atau sempat putus</div></div>` : ''}
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('🔒', 'Pengaturan Keamanan Ujian Ini', 'Diterapkan di perangkat peserta')}</div>
          <div class="flex-gap">
            ${[
              ['📷 Kamera wajib', sec.requireCamera], ['🎙️ Mikrofon wajib', sec.requireMic],
              ['🖲️ Berbagi layar', sec.requireScreenShare], ['🖥️ Layar penuh', sec.fullscreen],
              ['🔒 Kunci layar', sec.lockScreen], ['🚫 Deteksi pindah tab', sec.blockTabSwitch],
              ['📋 Anti salin', sec.blockCopy], ['📸 Anti tangkapan layar', sec.blockScreenshot]
            ].map(([lbl, on]) => `<span class="badge ${on ? 'badge-success' : 'badge-gray'}">${lbl}: ${on ? 'AKTIF' : 'nonaktif'}</span>`).join('')}
            <span class="badge badge-info">Batas pelanggaran: ${sec.maxViolations || 3}</span>
          </div>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('👥', `Status Peserta (${students.length})`, netOn ? 'Kartu merah: pelanggaran tinggi atau peserta tidak terhubung. Status koneksi diperbarui ±15–50 detik.' : 'Kartu merah menandai pelanggaran tinggi')}</div>
          ${students.length === 0 ? emptyState('Belum ada peserta yang ditargetkan ujian ini.', '👥') : `
          <div class="mon-grid">
            ${students.map(s => {
              const a = byStudent.get(s.id);
              const vios = a ? (a.violations || []) : [];
              const risk = vios.length >= (sec.maxViolations || 3) ? 'risk-high' : (vios.length > 0 ? 'risk-mid' : '');
              let statusBadge = '<span class="badge badge-gray">Belum Mulai</span>';
              if (a && a.submittedAt) statusBadge = `<span class="badge badge-success">Selesai • ${a.score ?? 0}</span>`;
              else if (a) statusBadge = '<span class="badge badge-warning">Mengerjakan</span>';
              const cn = nets.get(s.id);
              const netHtml = cn ? `<div class="mon-net is-${cn.cls}">${NET_IC[cn.cls]}<span>${UI.esc(cn.text)}${cn.sub ? `<small>${UI.esc(cn.sub)}</small>` : ''}</span></div>` : '';
              return `<div class="mon-card ${risk} ${a && a.submittedAt ? 'done' : ''} ${cn && cn.cls === 'bad' ? 'net-bad' : ''}">
                <div class="mc-top">
                  <div class="avatar">${AV(s)}</div>
                  <div style="flex:1;min-width:0;">
                    <div class="mc-nm">${UI.esc(s.name)}</div>
                    <div class="mc-mt">${UI.esc(s.kelas || '-')}</div>
                  </div>
                </div>
                ${statusBadge}
                ${a ? `<div class="muted small mt-1">Mulai ${UI.fmtDateTime(a.startedAt)}${a.currentSection != null ? ` • bagian ${a.currentSection + 1}` : ''}</div>` : ''}
                ${netHtml}
                ${a && a.submittedAt && a.net && a.net.drops ? `<div class="muted small mt-1">Sempat terputus ${a.net.drops}× selama ujian (total ${fmtDur(a.net.offlineMs)}); jawaban tetap terkirim.</div>` : ''}
                ${vios.length ? `
                  <div class="mt-1"><span class="badge badge-warning">${vios.length} pelanggaran</span></div>
                  <div class="vio-list">
                    ${vios.slice(-5).reverse().map(v => `<div class="vio-item">${UI.esc(v.type || 'pelanggaran')} • ${UI.fmtRelative(v.at)}</div>`).join('')}
                  </div>` : '<div class="muted small mt-1">Tidak ada pelanggaran tercatat</div>'}
              </div>`;
            }).join('')}
          </div>`}
        </div>`;
      if (global.Effects) Effects.enhance(body);
    }
  }

  /* =====================================================================
   * 6) HASIL & ANALISIS PER SUBTEST
   * ===================================================================*/
  function openResults(cbtId, user, onDone) {
    const cbt = DB.getCbt(cbtId);
    if (!cbt) { UI.toast('Ujian tidak ditemukan.', 'error'); return; }
    const body = openWorkspace(`📊 Hasil — ${cbt.title}`, 'Nilai keseluruhan dan rincian per subtest');
    wsEl.__onBack = () => { closeWorkspace(); if (typeof onDone === 'function') onDone(); };

    const sections = DB.cbtSections(cbt);
    if (global.Scoring) Scoring.recomputeCbt(cbt.id);
    const attempts = DB.getCbtAttemptsByCbt(cbt.id).filter(a => a.submittedAt)
      .map(a => global.Scoring ? Scoring.ensureFresh(a) : a);
    const ptsMode = !!(global.Scoring && Scoring.usesPoints(cbt));
    const fmtN = global.Scoring ? Scoring.fmtNum : String;
    const maxTotal = ptsMode ? Object.values(Scoring.maxPointsMap(cbt)).reduce((n, v) => n + v, 0) : 800;
    const scoreOf = a => (ptsMode && a.scoring && a.scoring.points) ? a.scoring.points.earned
      : (a.scoring ? a.scoring.scaled200_800 : (a.score || 0));
    const scoredAttempts = attempts.filter(a => scoreOf(a) != null);
    const avgRaw = scoredAttempts.length ? scoredAttempts.reduce((n, a) => n + scoreOf(a), 0) / scoredAttempts.length : null;
    const avg = avgRaw == null ? null : (ptsMode ? Math.round(avgRaw * 100) / 100 : Math.round(avgRaw));
    const scaleLbl = ptsMode ? `poin, maks ${fmtN(maxTotal)}` : '200–800';
    const essayQids = sections.flatMap(s => s.questionIds).filter(id => ((DB.getQuestion(id) || {}).questionType || '') === 'Esai');
    const remCol = !!(global.Remedial && Remedial.hasData(cbt));
    const best = scoredAttempts.length ? Math.max(...scoredAttempts.map(scoreOf)) : null;
    const worst = scoredAttempts.length ? Math.min(...scoredAttempts.map(scoreOf)) : null;

    // Rata-rata per subtest
    const subAvg = ptsMode ? sections.map(s => {
      const vals = attempts.map(a => a.scoring && a.scoring.points && (a.scoring.points.sections || []).find(x => x.subtest === s.subtest)).filter(Boolean);
      return {
        subtest: s.subtest, count: vals.length,
        avg: vals.length ? Math.round(vals.reduce((n, v) => n + v.percent, 0) / vals.length) : null,
        ptsAvg: vals.length ? Math.round(vals.reduce((n, v) => n + v.earned, 0) / vals.length * 100) / 100 : null,
        ptsMax: vals.length ? vals[0].max : null, scaledAvg: null
      };
    }) : sections.map(s => {
      const vals = attempts.map(a => {
        const irt = a.scoring && (a.scoring.sections || []).find(x => x.subtest === s.subtest);
        const legacy = (a.sectionScores || []).find(x => x.subtest === s.subtest);
        return irt ? { scaled: irt.scaled200_800, legacy: irt.legacyPercent } : (legacy ? { scaled: null, legacy: legacy.score || 0 } : null);
      }).filter(Boolean);
      return {
        subtest: s.subtest,
        count: vals.length,
        avg: vals.length ? Math.round(vals.reduce((n, v) => n + v.legacy, 0) / vals.length) : null,
        scaledAvg: vals.some(v => v.scaled != null) ? Math.round(vals.filter(v => v.scaled != null).reduce((n, v) => n + v.scaled, 0) / vals.filter(v => v.scaled != null).length) : null
      };
    });

    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Peserta Selesai</div><div class="value">${attempts.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Rata-rata (${scaleLbl})</div><div class="value">${avg == null ? '-' : fmtN(avg)}</div></div>
        <div class="stat-card accent-warning"><div class="label">Tertinggi (${scaleLbl})</div><div class="value">${best == null ? '-' : fmtN(best)}</div></div>
        <div class="stat-card accent-danger"><div class="label">Terendah (${scaleLbl})</div><div class="value">${worst == null ? '-' : fmtN(worst)}</div></div>
      </div>
      ${global.Remedial ? Remedial.resultsCardHtml(cbt, user) : ''}
      ${ptsMode ? `<div class="alert alert-info small"><strong>${UI.esc(Scoring.describe(cbt))}.</strong>
        Benar mendapat poin penuh, kosong 0. ${essayQids.length ? `Ujian ini memuat ${essayQids.length} soal esai — beri poinnya lewat tombol <strong>✍️ Nilai Esai</strong> pada tabel peserta.` : ''}
        ${Scoring.modeOf(cbt) === 'both' ? 'Skor IRT 200–800 tetap ditampilkan sebagai pembanding.' : ''}</div>`
      : attempts.length ? `<div class="alert alert-info small"><strong>Skor cohort-weighted / Rasch-like:</strong> benar=1, salah/kosong=0, tanpa minus. Bobot item dihitung dari ${attempts.length} peserta yang sudah selesai; skala 200–800 ini bersifat ${attempts[0].scoring && attempts[0].scoring.provisional ? 'sementara' : 'terkalibrasi cohort'} dan bukan skor nasional resmi.</div>` : ''}

      <div class="card">
        <div class="card-header">${UI.secHead('🧪', 'Rata-rata per Subtest', 'Membantu melihat subtest terlemah')}</div>
        ${subAvg.length === 0 ? emptyState('Belum ada data.') : subAvg.map(s => {
          const st = DB.subtestByName(s.subtest);
          return `<div style="margin-bottom:12px;">
            <div class="flex-between"><strong style="font-size:13px;">${st ? st.icon : '📘'} ${UI.esc(s.subtest)}</strong>
              <span class="muted small">${s.ptsAvg != null ? `<strong>${fmtN(s.ptsAvg)}/${fmtN(s.ptsMax)} poin</strong> • ` : ''}${s.scaledAvg != null ? `<strong>${s.scaledAvg}/800</strong> • ` : ''}${s.count} peserta</span></div>
            ${UI.progressHtml(s.avg ?? 0, '', 'auto')}
          </div>`;
        }).join('')}
      </div>

      ${global.Topics ? Topics.masteryCardHtml(cbt, attempts, { sub: 'Rata-rata seluruh peserta — membantu menentukan materi yang perlu diulang' }) : ''}

      <div class="card">
        <div class="card-header">${UI.secHead('📋', 'Rincian Peserta', 'Termasuk catatan pelanggaran selama ujian')}</div>
        <div id="resSearch"></div>
      </div>`;
    const kelasList = [...new Set(attempts.map(a => (DB.getUser(a.studentId) || {}).kelas).filter(Boolean))];
    const rmOpen = body.querySelector('[data-rm-open]');
    if (rmOpen) rmOpen.addEventListener('click', () => Remedial.openPanel(cbt.id, user, () => { if (wsEl) openResults(cbtId, user, onDone); }));
    const rmParent = body.querySelector('[data-rm-parent]');
    if (rmParent) rmParent.addEventListener('click', () => openResults(rmParent.dataset.rmParent, user, onDone));
    DataSearch.mount({
      container: body.querySelector('#resSearch'),
      items: attempts,
      placeholder: 'Cari nama peserta, username, atau kelas…',
      fields: a => { const u = DB.getUser(a.studentId) || {}; return [u.name, u.username, u.kelas, String(scoreOf(a) ?? '')]; },
      filters: [
        { key: 'kelas', label: 'Semua kelas', get: a => (DB.getUser(a.studentId) || {}).kelas || '', options: kelasList.map(k => ({ value: k, label: k })) },
        { key: 'vio', label: 'Semua peserta', get: a => (a.violations || []).length ? 'yes' : 'no',
          options: [{ value: 'yes', label: 'Ada pelanggaran' }, { value: 'no', label: 'Tanpa pelanggaran' }] }
      ],
      sorts: [
        { key: 'high', label: 'Skor tertinggi', cmp: (a, b) => scoreOf(b) - scoreOf(a) },
        { key: 'low', label: 'Skor terendah', cmp: (a, b) => scoreOf(a) - scoreOf(b) },
        { key: 'name', label: 'Nama A–Z', cmp: (a, b) => ((DB.getUser(a.studentId) || {}).name || '').localeCompare((DB.getUser(b.studentId) || {}).name || '') },
        { key: 'time', label: 'Selesai terbaru', cmp: (a, b) => b.submittedAt - a.submittedAt }
      ],
      pageSize: 25,
      empty: 'Belum ada peserta yang menyelesaikan ujian ini.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table">
          <thead><tr><th>Peserta</th><th>Kelas</th><th>Skor</th><th>Benar</th>
            ${sections.map(s => `<th>${UI.esc(DB.subtestByName(s.subtest)?.short || s.subtest)}</th>`).join('')}
            <th>Pelanggaran</th><th>Selesai</th>${ptsMode && essayQids.length ? '<th>Esai</th>' : ''}${remCol ? '<th>Nilai Akhir</th>' : ''}</tr></thead>
          <tbody>${rows.map(a => {
            const s = DB.getUser(a.studentId);
            const vios = (a.violations || []).length;
            return `<tr>
              <td><strong>${ctx.highlight(s ? s.name : '-')}</strong></td>
              <td>${ctx.highlight(s ? (s.kelas || '-') : '-')}</td>
              <td>${a.scoring ? Scoring.scoreHtml(a, true) : `<strong>${a.score ?? 0}</strong>`}</td>
              <td>${a.correctCount ?? 0}/${a.totalCount ?? 0}</td>
              ${sections.map(sec2 => {
                const ss = (a.sectionScores || []).find(x => x.subtest === sec2.subtest);
                const irt = a.scoring && (a.scoring.sections || []).find(x => x.subtest === sec2.subtest);
                const ps = ptsMode && a.scoring && a.scoring.points ? (a.scoring.points.sections || []).find(x => x.subtest === sec2.subtest) : null;
                if (ps) return `<td><strong>${fmtN(ps.earned)}</strong><span class="muted small">/${fmtN(ps.max)}</span><div class="muted small">${Math.round(ps.percent)}%</div></td>`;
                return `<td>${irt ? `<strong>${irt.scaled200_800}</strong><div class="muted small">${ss ? ss.score + '%' : ''}</div>` : (ss ? ss.score : '-')}</td>`;
              }).join('')}
              <td>${vios ? `<span class="badge badge-warning">${vios}</span>` : '<span class="muted small">0</span>'}</td>
              <td class="small">${UI.fmtDateTime(a.submittedAt)}</td>
              ${ptsMode && essayQids.length ? `<td>${essayCellHtml(a)}</td>` : ''}
              ${remCol ? `<td>${Remedial.finalCellHtml(cbt, a.studentId)}</td>` : ''}
            </tr>`;
          }).join('')}</tbody>
        </table></div>`,
      onPaint: (res) => res.querySelectorAll('[data-essay]').forEach(b => b.addEventListener('click', () =>
        openEssayGrading(b.dataset.essay, user, () => openResults(cbtId, user, onDone))))
    });
    if (global.Effects) Effects.enhance(body);
  }

  function essayCellHtml(a) {
    const p = a.scoring && a.scoring.points;
    const pending = p ? p.pending : 0;
    return `<button type="button" class="btn btn-sm ${pending ? 'btn-primary' : 'btn-secondary'}" data-essay="${UI.esc(a.id)}">✍️ ${pending ? `Nilai (${pending})` : 'Ubah'}</button>`;
  }

  /* =====================================================================
   * 6b) PENILAIAN ESAI (sistem Poin Manual) — dipakai admin & tutor
   * ===================================================================*/
  function openEssayGrading(attemptId, user, onDone) {
    let attempt = DB.getCbtAttempts().find(a => a.id === attemptId);
    if (!attempt) { UI.toast('Lembar jawaban tidak ditemukan.', 'error'); return; }
    const cbt = DB.getCbt(attempt.cbtId);
    if (!cbt || !global.Scoring) return;
    const student = DB.getUser(attempt.studentId) || {};
    const maxMap = Scoring.maxPointsMap(cbt);
    const essays = DB.cbtSections(cbt).flatMap(s => s.questionIds).map(id => DB.getQuestion(id))
      .filter(q => q && (q.questionType || '') === 'Esai');
    if (!essays.length) { UI.toast('Ujian ini tidak memiliki soal esai.', 'info'); return; }
    const cur = Object.assign({}, attempt.essayPoints || {});
    const fmt = Scoring.fmtNum;
    UI.modal.open(`✍️ Nilai Esai — ${student.name || 'Peserta'}`, `
      <form id="essForm" class="form" novalidate>
        <p class="muted small" style="margin-top:0;">${UI.esc(cbt.title)} • isi poin 0 sampai poin maksimal tiap soal. Kosongkan bila belum dinilai.</p>
        ${essays.map((q, i) => `
          <div class="ess-item">
            <div class="ess-q"><span class="q-num">${i + 1}</span><div class="rt-content">${RichText.render(q.text)}</div></div>
            ${(q.keywords || []).length ? `<div class="muted small">Kata kunci penilaian: ${q.keywords.map(k => `<span class="badge badge-gray">${UI.esc(k)}</span>`).join(' ')}</div>` : ''}
            <div class="ess-ans">${UI.esc((attempt.answers || {})[q.id] || '(tidak dijawab)')}</div>
            <div class="ess-grade">
              <label for="ess_${UI.esc(q.id)}">Poin</label>
              <input type="number" id="ess_${UI.esc(q.id)}" data-ess="${UI.esc(q.id)}" min="0" max="${maxMap[q.id] || 0}" step="any"
                value="${cur[q.id] != null ? cur[q.id] : ''}" placeholder="0–${fmt(maxMap[q.id] || 0)}" />
              <span class="muted small">/ ${fmt(maxMap[q.id] || 0)} poin</span>
            </div>
          </div>`).join('')}
        <div class="flex-gap" style="margin-top:12px;">
          <button type="submit" class="btn btn-primary">💾 Simpan Nilai Esai</button>
          <button type="button" class="btn btn-secondary" id="essCancel">Batal</button>
        </div>
      </form>`, { fullscreenToggle: true, fullKey: 'cbt-essay' });
    document.getElementById('essCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('essForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const next = {};
      let bad = null;
      document.querySelectorAll('[data-ess]').forEach(inp => {
        if (inp.value === '') return;
        const v = Number(inp.value);
        const m = maxMap[inp.dataset.ess] || 0;
        if (!Number.isFinite(v) || v < 0 || v > m) { bad = bad || inp; return; }
        next[inp.dataset.ess] = Math.round(v * 100) / 100;
      });
      if (bad) { UI.toast(`Poin harus antara 0 dan ${fmt(Number(bad.max) || 0)}.`, 'error'); bad.focus(); return; }
      DB.updateCbtAttempt(attempt.id, { essayPoints: next, essayGradedBy: user.id, essayGradedAt: Date.now() });
      Scoring.recomputeCbt(cbt.id);
      attempt = DB.getCbtAttempts().find(a => a.id === attemptId) || attempt;
      const p = attempt.scoring && attempt.scoring.points;
      if (p) DB.updateCbtAttempt(attempt.id, { score: Math.round(p.percent) });
      DB.notifyStudentAndParents(attempt.studentId, {
        type: 'cbt', icon: '✍️', title: 'Nilai esai sudah keluar',
        body: `${cbt.title} — skor kini ${Scoring.label(attempt)}.`, link: 'cbt'
      }, { title: `Nilai esai ${student.name || 'anak'} sudah keluar`, link: 'anak-nilai' });
      UI.modal.close();
      UI.toast('Nilai esai disimpan.', 'success');
      if (typeof onDone === 'function') onDone();
    });
  }

  /* =====================================================================
   * 7) RINGKASAN BANK SOAL (in-page) — pintu masuk ke halaman khusus
   * ===================================================================*/
  function renderBankHome(container, user) {
    const all = DB.getQuestions();
    const byType = {};
    DB.QUESTION_TYPES.forEach(t => { byType[t] = all.filter(q => (q.questionType || 'Pilihan Ganda') === t).length; });

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Soal</div><div class="value">${all.length}</div><div class="sub">di seluruh subtest</div></div>
        <div class="stat-card accent-success"><div class="label">Subtest Terisi</div><div class="value">${DB.SUBTESTS.filter(s => all.some(q => q.subject === s.name)).length}</div><div class="sub">dari ${DB.SUBTESTS.length} subtest</div></div>
        <div class="stat-card accent-warning"><div class="label">Soal Esai</div><div class="value">${byType['Esai'] || 0}</div><div class="sub">dinilai manual</div></div>
        <div class="stat-card accent-danger"><div class="label">Tingkat Sulit</div><div class="value">${all.filter(q => q.difficulty === 'sulit').length}</div><div class="sub">soal sulit</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('📚', 'Bank Soal per Kategori Subtest', 'Buka halaman khusus untuk menelusuri, memfilter, dan menyunting soal')}
          <div class="flex-gap">
            <button class="btn btn-secondary btn-sm" id="bsBulkBtn">⚡ Buat Massal</button>
            <button class="btn btn-secondary btn-sm" id="bsImportBtn">⬆ Impor</button>
            <button class="btn btn-secondary btn-sm" id="bsDocBtn" title="Baca soal dari PDF/Word, dibantu AI"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14h6M9 17h4"/></svg> Impor PDF/Word</button>
            <button class="btn btn-secondary btn-sm" id="bsExportBtn">⬇ Ekspor</button>
            <button class="btn btn-secondary btn-sm" id="bsAddBtn">+ Tambah Soal</button>
            <button class="btn btn-primary btn-sm" id="bsOpenBtn">📖 Buka Soal Tersedia</button>
          </div>
        </div>
        <div class="tgt-grid">
          ${DB.SUBTESTS.map(s => {
            const list = all.filter(q => q.subject === s.name);
            const easy = list.filter(q => q.difficulty === 'mudah').length;
            const mid = list.filter(q => (q.difficulty || 'sedang') === 'sedang').length;
            const hard = list.filter(q => q.difficulty === 'sulit').length;
            return `<div class="tgt-box ripple-host" data-open-sub="${UI.esc(s.name)}" style="cursor:pointer;display:block;">
              <div class="tgt-name">${s.icon} ${UI.esc(s.short)}</div>
              <div class="tgt-meta">${UI.esc(s.group)} • ${list.length} soal</div>
              <div class="qc-tags" style="margin-top:6px;">
                <span class="qc-chip d-mudah">${easy} mudah</span>
                <span class="qc-chip d-sedang">${mid} sedang</span>
                <span class="qc-chip d-sulit">${hard} sulit</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🧾', 'Format Soal Didukung', 'Setiap soal memiliki keterangan format, subtest, dan tingkat kesulitan')}</div>
        <div class="flex-gap">
          ${DB.QUESTION_TYPES.map(t => `<span class="badge badge-info" style="padding:6px 10px;font-size:12px;">${UI.esc(t)}: ${byType[t] || 0}</span>`).join('')}
        </div>
      </div>
    `;

    const reload = () => renderBankHome(container, user);
    document.getElementById('bsOpenBtn').addEventListener('click', () => openBankBrowser(user, reload));
    document.getElementById('bsAddBtn').addEventListener('click', () => openQuestionForm(user, null, reload));
    document.getElementById('bsBulkBtn').addEventListener('click', () => BankTools.openBulk(user, reload));
    document.getElementById('bsImportBtn').addEventListener('click', () => BankTools.openImport(user, reload));
    document.getElementById('bsDocBtn').addEventListener('click', () => DocImport.open(user, reload));
    document.getElementById('bsExportBtn').addEventListener('click', () => BankTools.exportQuestions(null, 'xlsx'));
    /* Klik kartu subtest membuka browser LANGSUNG pada subtest itu; dulu
     * nama subtest di data-open-sub dibuang sehingga selalu mendarat di PU. */
    container.querySelectorAll('[data-open-sub]').forEach(b => b.addEventListener('click', () =>
      openBankBrowser(user, reload, b.dataset.openSub)));
    if (global.Effects) Effects.enhance(container);
  }

  global.CbtAdmin = {
    renderCbtHome, renderBankHome, openWizard, openBankBrowser, openMonitor, openResults,
    openQuestionForm, closeWorkspace, openEssayGrading
  };
})(window);
