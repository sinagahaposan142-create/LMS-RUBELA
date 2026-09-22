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

  function questionCardHtml(q, checked) {
    const st = DB.subtestByName(q.subject);
    const optCount = (q.options || []).length;
    return `
      <label class="q-card ${checked ? 'is-on' : ''}" data-qid="${q.id}"
             data-hay="${UI.esc((q.text + ' ' + (q.subject || '') + ' ' + (q.questionType || '')).toLowerCase())}">
        <input type="checkbox" name="qid" value="${q.id}" ${checked ? 'checked' : ''} />
        <div class="qc-text rt-content">${RichText.render(q.text)}</div>
        <div class="qc-tags">
          <span class="qc-chip sub">${st ? st.icon : '📘'} ${UI.esc(st ? st.short : (q.subject || 'Umum'))}</span>
          <span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>
          ${difficultyChip(q.difficulty)}
          <span class="qc-chip opt">${optCount ? optCount + ' opsi' : 'jawaban terbuka'}</span>
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

      <div class="card">
        <div class="card-header">
          ${UI.secHead('🖥️', 'Manajemen Ujian CBT', 'Halaman khusus dengan wizard pembuatan ujian, bank soal, dan pemantauan langsung')}
          <div class="flex-gap">
            <button class="btn btn-secondary btn-sm" id="openBankBtn">📚 Soal Tersedia</button>
            <button class="btn btn-primary btn-sm" id="newCbtBtn">+ Buat Ujian Baru</button>
          </div>
        </div>

        ${cbts.length === 0 ? emptyState('Belum ada ujian CBT. Klik "Buat Ujian Baru" untuk memulai.', '🖥️') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Ujian</th><th>Kelas Tujuan</th><th>Mode</th><th>Subtest</th>
            <th>Soal</th><th>Jadwal</th><th>Peserta</th><th>Status</th><th>Aksi</th>
          </tr></thead>
          <tbody>${cbts.slice().sort((a, b) => b.createdAt - a.createdAt).map(c => {
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
                <strong>${UI.esc(c.title)}</strong>
                ${c.description ? `<div class="muted small" style="max-width:260px;">${UI.esc(c.description.slice(0, 70))}${c.description.length > 70 ? '…' : ''}</div>` : ''}
                ${secIcons ? `<div class="small" title="Pengaturan keamanan">${secIcons}</div>` : ''}
              </td>
              <td><span class="badge ${(c.targetClasses || []).includes(DB.ALL_CLASSES) ? 'badge-success' : 'badge-info'}">${UI.esc(DB.cbtTargetLabel(c))}</span></td>
              <td>${c.subtestMode === 'full' ? '<span class="badge badge-warning">7 Subtest</span>'
                    : (c.subtestMode === 'single' ? '<span class="badge badge-info">1 Subtest</span>' : '<span class="badge badge-gray">Custom</span>')}</td>
              <td class="muted small">${sections.length} bagian</td>
              <td>${qCount}</td>
              <td class="small">${UI.fmtDateTime(c.startAt)}<div class="muted">s.d. ${UI.fmtDateTime(c.endAt)}</div></td>
              <td>${submitted}/${targets}${running ? `<div class="small" style="color:var(--warning);">${running} mengerjakan</div>` : ''}</td>
              <td>${status}</td>
              <td class="actions">
                <button class="btn btn-sm btn-primary" data-monitor="${c.id}">📡 Pantau</button>
                <button class="btn btn-sm btn-secondary" data-results="${c.id}">📊 Hasil</button>
                <button class="btn btn-sm btn-secondary" data-edit-cbt="${c.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del-cbt="${c.id}">Hapus</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;

    const reload = () => renderCbtHome(container, user);
    document.getElementById('newCbtBtn').addEventListener('click', () => openWizard(user, null, reload));
    document.getElementById('openBankBtn').addEventListener('click', () => openBankBrowser(user, reload));
    document.getElementById('kpiBank').addEventListener('click', () => openBankBrowser(user, reload));
    document.getElementById('kpiLive').addEventListener('click', () => {
      if (live.length) openMonitor(live[0].id, user, reload);
      else UI.toast('Tidak ada ujian yang sedang berlangsung.', 'info');
    });
    container.querySelectorAll('[data-edit-cbt]').forEach(b => b.addEventListener('click', () =>
      openWizard(user, b.dataset.editCbt, reload)));
    container.querySelectorAll('[data-monitor]').forEach(b => b.addEventListener('click', () =>
      openMonitor(b.dataset.monitor, user, reload)));
    container.querySelectorAll('[data-results]').forEach(b => b.addEventListener('click', () =>
      openResults(b.dataset.results, user, reload)));
    container.querySelectorAll('[data-del-cbt]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus ujian ini beserta seluruh hasil pengerjaannya?')) return;
      DB.deleteCbt(b.dataset.delCbt);
      UI.toast('Ujian dihapus.');
      reload();
    }));
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

  function openWizard(user, editId, onDone) {
    const editing = editId ? DB.getCbt(editId) : null;
    const courses = user.role === 'admin' ? DB.getCourses() : DB.getCoursesByTeacher(user.id);

    // ---- State draft ujian ----
    const draft = {
      title: editing?.title || '',
      description: editing?.description || '',
      targetClasses: (editing?.targetClasses || []).slice(),
      courseIds: (editing?.courseIds && editing.courseIds.length
        ? editing.courseIds
        : (editing?.courseId ? [editing.courseId] : [])).slice(),
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
      endAt: editing?.endAt || (Date.now() + 7 * 86400000)
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
      if (i === 1 && draft.targetClasses.length === 0 && draft.courseIds.length === 0) {
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
    function stepInfo(panel) {
      panel.innerHTML = `
        <div class="card">
          <div class="card-header">${UI.secHead('📝', 'Informasi Ujian', 'Judul, deskripsi, dan jadwal pelaksanaan')}</div>
          <div class="form">
            <div class="form-group">
              <label>Judul Ujian</label>
              <input name="wzTitle" value="${UI.esc(draft.title)}" placeholder="mis. Try Out UTBK Batch 1" />
            </div>
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
    }

    /* ---------- Langkah 2: Kelas tujuan (multi + semua) ---------- */
    function stepTarget(panel) {
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

      panel.querySelectorAll('[data-mode]').forEach(c => c.addEventListener('click', () => {
        draft.subtestMode = c.dataset.mode;
        paint();
      }));
      panel.querySelectorAll('[name="singleSub"]').forEach(r => r.addEventListener('change', () => {
        draft.selectedSubtest = r.value;
        paint();
      }));
    }

    /* ---------- Langkah 4: Pilih soal per subtest ---------- */
    function stepSoal(panel) {
      const subs = activeSubtests();
      let activeSub = subs[0];
      let fType = '', fDiff = '', fQuery = '';

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
                <button class="btn btn-sm btn-secondary" id="selAll">Pilih Semua</button>
                <button class="btn btn-sm btn-secondary" id="selNone">Kosongkan</button>
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
          paintSubList();
          paintQuestions();
        }));
      }

      function paintQuestions() {
        const st = DB.subtestByName(activeSub);
        let list = DB.getQuestions().filter(q => q.subject === activeSub);
        if (fType) list = list.filter(q => (q.questionType || 'Pilihan Ganda') === fType);
        if (fDiff) list = list.filter(q => (q.difficulty || 'sedang') === fDiff);
        if (fQuery) list = list.filter(q => q.text.toLowerCase().includes(fQuery));

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

      document.getElementById('qSearch').addEventListener('input', (e) => { fQuery = e.target.value.trim().toLowerCase(); paintQuestions(); });
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
              <tr><th>Metode</th><td>${draft.subtestMode === 'full' ? 'Gabungan 7 Subtest (Full UTBK)'
                : (draft.subtestMode === 'single' ? 'Per 1 Subtest — ' + UI.esc(draft.selectedSubtest) : 'Custom')}</td></tr>
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
        </div>`;
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

      if (editing) {
        DB.updateCbt(editing.id, payload);
        UI.toast('Perubahan ujian disimpan.');
      } else {
        const created = DB.addCbt(payload);
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
  function openBankBrowser(user, onDone) {
    let activeSub = DB.SUBTESTS[0].name;
    let fType = '', fDiff = '', fQuery = '';

    const body = openWorkspace('Soal Tersedia — Bank Soal', 'Telusuri soal per kategori subtest, format, dan tingkat kesulitan',
      '<button class="btn btn-primary btn-sm" id="wsAddQ">+ Tambah Soal</button>');
    wsEl.__onBack = () => { closeWorkspace(); if (typeof onDone === 'function') onDone(); };
    document.getElementById('wsAddQ').addEventListener('click', () => openQuestionForm(user, null, paintAll));

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
              <input type="search" id="bbSearch" class="qf-grow" placeholder="Cari teks soal..." autocomplete="off" value="${UI.esc(fQuery)}" />
              <select id="bbType">
                <option value="">Semua Format</option>
                ${DB.QUESTION_TYPES.map(t => `<option value="${UI.esc(t)}" ${fType === t ? 'selected' : ''}>${UI.esc(t)}</option>`).join('')}
              </select>
              <select id="bbDiff">
                <option value="">Semua Tingkat</option>
                ${DB.DIFFICULTIES.map(d => `<option value="${d}" ${fDiff === d ? 'selected' : ''}>${d.charAt(0).toUpperCase() + d.slice(1)}</option>`).join('')}
              </select>
            </div>
            <div id="bbArea"></div>
          </div>
        </div>`;
      paintSubs();
      paintList();

      document.getElementById('bbSearch').addEventListener('input', (e) => { fQuery = e.target.value.trim().toLowerCase(); paintList(); });
      document.getElementById('bbType').addEventListener('change', (e) => { fType = e.target.value; paintList(); });
      document.getElementById('bbDiff').addEventListener('change', (e) => { fDiff = e.target.value; paintList(); });
      if (global.Effects) Effects.enhance(body);
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
        el.addEventListener('click', () => { activeSub = el.dataset.sub; paintSubs(); paintList(); }));
    }

    function paintList() {
      const st = DB.subtestByName(activeSub);
      let list = DB.getQuestions().filter(q => q.subject === activeSub);
      if (fType) list = list.filter(q => (q.questionType || 'Pilihan Ganda') === fType);
      if (fDiff) list = list.filter(q => (q.difficulty || 'sedang') === fDiff);
      if (fQuery) list = list.filter(q => q.text.toLowerCase().includes(fQuery));

      const area = document.getElementById('bbArea');
      area.innerHTML = `
        <div class="flex-between mb-2" style="flex-wrap:wrap;gap:8px;">
          <div><strong>${st ? st.icon + ' ' + UI.esc(st.name) : UI.esc(activeSub)}</strong>
            <div class="muted small">${list.length} soal ditampilkan • kelompok ${UI.esc(st ? st.group : '-')}</div></div>
        </div>
        ${list.length === 0
          ? emptyState('Belum ada soal pada kategori ini. Klik "+ Tambah Soal" untuk menambahkan.', '📭')
          : `<div class="q-cards">${list.map(q => `
              <div class="q-card" style="padding-left:14px;cursor:default;">
                <div class="qc-text rt-content">${RichText.render(q.text)}</div>
                <div class="qc-tags">
                  <span class="qc-chip sub">${st ? st.icon : '📘'} ${UI.esc(st ? st.short : activeSub)}</span>
                  <span class="qc-chip type">${UI.esc(q.questionType || 'Pilihan Ganda')}</span>
                  ${difficultyChip(q.difficulty)}
                  <span class="qc-chip opt">${(q.options || []).length ? (q.options || []).length + ' opsi' : 'jawaban terbuka'}</span>
                </div>
                <div class="flex-gap mt-2">
                  <button class="btn btn-sm btn-secondary" data-edit-q="${q.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-q="${q.id}">Hapus</button>
                </div>
              </div>`).join('')}</div>`}
      `;
      area.querySelectorAll('[data-edit-q]').forEach(b => b.addEventListener('click', () =>
        openQuestionForm(user, b.dataset.editQ, paintAll)));
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
  function openQuestionForm(user, editId, onDone) {
    if (!global.QEditor) {
      UI.toast('Editor soal belum termuat. Muat ulang halaman.', 'error');
      return;
    }
    QEditor.open(user, editId, (saved) => {
      if (saved && typeof onDone === 'function') onDone(saved);
      else if (!saved && typeof onDone === 'function') onDone(null);
    });
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
    paint();
    timer = setInterval(paint, 5000);
    function stop() { if (timer) clearInterval(timer); timer = null; }

    function paint() {
      if (!wsEl) { stop(); return; }
      const students = targetedStudents(cbt);
      const attempts = DB.getCbtAttemptsByCbt(cbt.id);
      const byStudent = new Map(attempts.map(a => [a.studentId, a]));
      const sec = cbt.security || {};
      const working = attempts.filter(a => !a.submittedAt).length;
      const finished = attempts.filter(a => a.submittedAt).length;
      const totalVio = attempts.reduce((n, a) => n + (a.violations || []).length, 0);

      body.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent-primary"><div class="label">Peserta Ditargetkan</div><div class="value">${students.length}</div></div>
          <div class="stat-card accent-warning"><div class="label">Sedang Mengerjakan</div><div class="value">${working}</div></div>
          <div class="stat-card accent-success"><div class="label">Sudah Selesai</div><div class="value">${finished}</div></div>
          <div class="stat-card accent-danger"><div class="label">Total Pelanggaran</div><div class="value">${totalVio}</div></div>
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
          <div class="card-header">${UI.secHead('👥', `Status Peserta (${students.length})`, 'Kartu merah menandai pelanggaran tinggi')}</div>
          ${students.length === 0 ? emptyState('Belum ada peserta yang ditargetkan ujian ini.', '👥') : `
          <div class="mon-grid">
            ${students.map(s => {
              const a = byStudent.get(s.id);
              const vios = a ? (a.violations || []) : [];
              const risk = vios.length >= (sec.maxViolations || 3) ? 'risk-high' : (vios.length > 0 ? 'risk-mid' : '');
              let statusBadge = '<span class="badge badge-gray">Belum Mulai</span>';
              if (a && a.submittedAt) statusBadge = `<span class="badge badge-success">Selesai • ${a.score ?? 0}</span>`;
              else if (a) statusBadge = '<span class="badge badge-warning">Mengerjakan</span>';
              return `<div class="mon-card ${risk} ${a && a.submittedAt ? 'done' : ''}">
                <div class="mc-top">
                  <div class="avatar">${UI.initials(s.name)}</div>
                  <div style="flex:1;min-width:0;">
                    <div class="mc-nm">${UI.esc(s.name)}</div>
                    <div class="mc-mt">${UI.esc(s.kelas || '-')}</div>
                  </div>
                </div>
                ${statusBadge}
                ${a ? `<div class="muted small mt-1">Mulai ${UI.fmtDateTime(a.startedAt)}${a.currentSection != null ? ` • bagian ${a.currentSection + 1}` : ''}</div>` : ''}
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
    const attempts = DB.getCbtAttemptsByCbt(cbt.id).filter(a => a.submittedAt);
    const avg = attempts.length ? Math.round(attempts.reduce((n, a) => n + (a.score || 0), 0) / attempts.length) : null;
    const best = attempts.length ? Math.max(...attempts.map(a => a.score || 0)) : null;
    const worst = attempts.length ? Math.min(...attempts.map(a => a.score || 0)) : null;

    // Rata-rata per subtest
    const subAvg = sections.map(s => {
      const vals = attempts.map(a => (a.sectionScores || []).find(x => x.subtest === s.subtest))
        .filter(Boolean).map(x => x.score || 0);
      return {
        subtest: s.subtest,
        count: vals.length,
        avg: vals.length ? Math.round(vals.reduce((n, v) => n + v, 0) / vals.length) : null
      };
    });

    body.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Peserta Selesai</div><div class="value">${attempts.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Rata-rata</div><div class="value">${avg ?? '-'}</div></div>
        <div class="stat-card accent-warning"><div class="label">Tertinggi</div><div class="value">${best ?? '-'}</div></div>
        <div class="stat-card accent-danger"><div class="label">Terendah</div><div class="value">${worst ?? '-'}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🧪', 'Rata-rata per Subtest', 'Membantu melihat subtest terlemah')}</div>
        ${subAvg.length === 0 ? emptyState('Belum ada data.') : subAvg.map(s => {
          const st = DB.subtestByName(s.subtest);
          return `<div style="margin-bottom:12px;">
            <div class="flex-between"><strong style="font-size:13px;">${st ? st.icon : '📘'} ${UI.esc(s.subtest)}</strong>
              <span class="muted small">${s.count} peserta</span></div>
            ${UI.progressHtml(s.avg ?? 0, '', 'auto')}
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📋', 'Rincian Peserta', 'Termasuk catatan pelanggaran selama ujian')}</div>
        ${attempts.length === 0 ? emptyState('Belum ada peserta yang menyelesaikan ujian ini.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Peserta</th><th>Kelas</th><th>Skor</th><th>Benar</th>
            ${sections.map(s => `<th>${UI.esc(DB.subtestByName(s.subtest)?.short || s.subtest)}</th>`).join('')}
            <th>Pelanggaran</th><th>Selesai</th></tr></thead>
          <tbody>${attempts.slice().sort((a, b) => (b.score || 0) - (a.score || 0)).map(a => {
            const s = DB.getUser(a.studentId);
            const vios = (a.violations || []).length;
            return `<tr>
              <td><strong>${UI.esc(s ? s.name : '-')}</strong></td>
              <td>${UI.esc(s ? (s.kelas || '-') : '-')}</td>
              <td><strong>${a.score ?? 0}</strong></td>
              <td>${a.correctCount ?? 0}/${a.totalCount ?? 0}</td>
              ${sections.map(sec2 => {
                const ss = (a.sectionScores || []).find(x => x.subtest === sec2.subtest);
                return `<td>${ss ? ss.score : '-'}</td>`;
              }).join('')}
              <td>${vios ? `<span class="badge badge-warning">${vios}</span>` : '<span class="muted small">0</span>'}</td>
              <td class="small">${UI.fmtDateTime(a.submittedAt)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>`;
    if (global.Effects) Effects.enhance(body);
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
    container.querySelectorAll('[data-open-sub]').forEach(b => b.addEventListener('click', () => openBankBrowser(user, reload)));
    if (global.Effects) Effects.enhance(container);
  }

  global.CbtAdmin = {
    renderCbtHome, renderBankHome, openWizard, openBankBrowser, openMonitor, openResults,
    openQuestionForm, closeWorkspace
  };
})(window);
