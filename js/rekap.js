/* ===== LMS Rubela - Rekapan Lengkap =====
 * Satu modul rekap yang dipakai admin (semua data) dan tutor (data sendiri).
 *
 *   Rekap.render(container, user)
 *
 * Tab:
 *   Ringkasan       KPI global, sebaran per subtest, peringkat tertinggi/terendah
 *   Rekap Tutor     tabel semua tutor + halaman detail per tutor
 *   Rekap Siswa     tabel semua siswa + halaman detail per siswa
 *   Rekap Kelas     tabel semua kelas subtest + halaman detail per kelas
 *   Per Subtest     agregat 7 subtest UTBK
 *
 * Semua tabel bisa diunduh sebagai CSV (dibuka Excel) lewat tombol "⬇ CSV".
 */
(function (global) {

  /* =====================================================================
   * Utilitas kecil
   * ===================================================================*/
  function esc(s) { return UI.esc(s); }
  function emptyState(msg, icon) {
    return `<div class="empty"><div class="empty-icon">${icon || '📈'}</div>${esc(msg)}</div>`;
  }
  function pctOf(part, total) {
    const t = Number(total) || 0;
    if (!t) return 0;
    return Math.round((Number(part) || 0) / t * 100);
  }
  function average(nums) {
    const list = nums.filter(n => n != null && !isNaN(n));
    if (!list.length) return null;
    return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  }
  function nOrDash(v) { return v == null ? '<span class="muted">–</span>' : v; }
  function tone(v) {
    if (v == null) return '';
    return v >= 75 ? 'ok' : (v >= 55 ? 'warn' : 'bad');
  }
  function scorePill(v, suffix) {
    if (v == null) return '<span class="muted">–</span>';
    return `<span class="rk-pill ${tone(v)}">${v}${suffix || ''}</span>`;
  }
  function statusBadge(status) {
    const map = {
      hadir: ['badge-success', 'Hadir'], izin: ['badge-warning', 'Izin'],
      sakit: ['badge-info', 'Sakit'], alfa: ['badge-danger', 'Alfa']
    };
    const m = map[status] || ['badge-secondary', status || '-'];
    return `<span class="badge ${m[0]}">${esc(m[1])}</span>`;
  }

  /** Unduh tabel sebagai CSV agar bisa dibuka di Excel. */
  function downloadCsv(filename, headers, rows) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(cell).join(';')].concat(rows.map(r => r.map(cell).join(';')));
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    UI.toast('Berkas CSV diunduh.', 'success');
  }

  /** Pasang tombol unduh CSV pada sebuah elemen. */
  function bindCsv(btn, filename, headers, rowsFn) {
    if (!btn) return;
    btn.addEventListener('click', () => downloadCsv(filename, headers, rowsFn()));
  }

  function csvBtn(id, label) {
    return `<button class="btn btn-sm btn-secondary" id="${id}">⬇ ${esc(label || 'CSV')}</button>`;
  }

  /* =====================================================================
   * Pengumpulan data — dihitung sekali lalu dipakai semua tab
   * ===================================================================*/

  /** Rekap satu kelas subtest. */
  function courseStats(course) {
    const enrollments = DB.getEnrollmentsByCourse(course.id);
    const studentIds = enrollments.map(e => e.studentId);
    const assignments = DB.getAssignmentsByCourse(course.id);
    const asgIds = assignments.map(a => a.id);
    const allSubs = DB.getSubmissions().filter(s => asgIds.includes(s.assignmentId));
    const graded = allSubs.filter(s => s.grade != null);
    const cbts = DB.getCbtsByCourse(course.id);
    const cbtIds = cbts.map(c => c.id);
    const attempts = DB.getCbtAttempts().filter(a => cbtIds.includes(a.cbtId) && a.submittedAt);
    const att = DB.getAttendanceByCourse(course.id).filter(a => a.role === 'siswa');
    const plans = DB.getClassPlansByCourse(course.id);
    const violations = attempts.reduce((n, a) => n + ((a.violations || []).length), 0);

    return {
      course,
      studentIds,
      students: studentIds.length,
      materials: DB.getMaterialsByCourse(course.id).length,
      modules: DB.getModulesByCourse(course.id).length,
      recordings: DB.getRecordingsByCourse(course.id).length,
      assignments: assignments.length,
      assignmentList: assignments,
      submissions: allSubs.length,
      ungraded: allSubs.length - graded.length,
      expectedSubs: assignments.length * studentIds.length,
      cbts: cbts.length,
      cbtList: cbts,
      attempts: attempts.length,
      violations,
      avgAsg: average(graded.map(s => s.grade)),
      avgCbt: average(attempts.map(a => a.score)),
      sessions: new Set(att.map(a => a.date)).size,
      attTotal: att.length,
      hadir: att.filter(a => a.status === 'hadir').length,
      izin: att.filter(a => a.status === 'izin').length,
      sakit: att.filter(a => a.status === 'sakit').length,
      alfa: att.filter(a => a.status === 'alfa').length,
      presentPct: pctOf(att.filter(a => a.status === 'hadir').length, att.length),
      plans: plans.length,
      plansFixed: plans.filter(p => p.status === 'fixed').length,
      plansDraft: plans.filter(p => p.status === 'draft').length,
      plansChanged: plans.filter(p => p.status === 'changed').length,
      plansCancelled: plans.filter(p => p.status === 'cancelled').length
    };
  }

  /** Rekap satu tutor, menggabungkan semua kelas yang diampu. */
  function tutorStats(guru) {
    const courses = DB.getCoursesByTeacher(guru.id);
    const per = courses.map(courseStats);
    const plans = DB.getClassPlansByTeacher(guru.id);
    const ownAtt = DB.getAttendanceByUser(guru.id).filter(a => a.role === 'guru');
    const questions = DB.getQuestionsByAuthor ? DB.getQuestionsByAuthor(guru.id) : DB.getQuestions().filter(q => q.authorId === guru.id);
    const salaries = DB.getSalariesByTeacher(guru.id);
    const studentIds = new Set();
    per.forEach(p => p.studentIds.forEach(id => studentIds.add(id)));

    const sum = (key) => per.reduce((n, p) => n + (p[key] || 0), 0);
    const attTotal = sum('attTotal');

    return {
      user: guru,
      courses,
      per,
      classes: courses.length,
      students: studentIds.size,
      studentIds: [...studentIds],
      subtests: [...new Set(courses.map(c => c.subtest).filter(Boolean))],
      mainClasses: [...new Set(courses.flatMap(c => c.mainClasses || []))],
      materials: sum('materials'),
      modules: sum('modules'),
      recordings: sum('recordings'),
      assignments: sum('assignments'),
      submissions: sum('submissions'),
      ungraded: sum('ungraded'),
      cbts: sum('cbts'),
      attempts: sum('attempts'),
      violations: sum('violations'),
      questions: questions.length,
      questionsBySubject: questions.reduce((acc, q) => {
        const k = q.subject || 'Lainnya';
        acc[k] = (acc[k] || 0) + 1; return acc;
      }, {}),
      avgAsg: average(per.map(p => p.avgAsg)),
      avgCbt: average(per.map(p => p.avgCbt)),
      sessions: sum('sessions'),
      classPresentPct: pctOf(sum('hadir'), attTotal),
      plans: plans.length,
      plansFixed: plans.filter(p => p.status === 'fixed').length,
      plansDraft: plans.filter(p => p.status === 'draft').length,
      plansChanged: plans.filter(p => p.status === 'changed').length,
      plansCancelled: plans.filter(p => p.status === 'cancelled').length,
      planList: plans,
      disciplinePct: pctOf(plans.filter(p => p.status === 'fixed').length, plans.length),
      ownPresentPct: pctOf(ownAtt.filter(a => a.status === 'hadir').length, ownAtt.length),
      ownAttTotal: ownAtt.length,
      ownAtt,
      salaries,
      salaryPaid: salaries.filter(s => s.status === 'dibayar').reduce((n, s) => n + (s.amount || 0), 0),
      salaryPending: salaries.filter(s => s.status !== 'dibayar').reduce((n, s) => n + (s.amount || 0), 0)
    };
  }

  /** Rekap satu siswa di semua kelas yang diikuti. */
  function studentStats(siswa) {
    const enrollments = DB.getEnrollmentsByStudent(siswa.id);
    const courses = enrollments.map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const subs = DB.getSubmissionsByStudent(siswa.id);
    const graded = subs.filter(s => s.grade != null);
    const attempts = DB.getCbtAttemptsByStudent(siswa.id).filter(a => a.submittedAt);
    const att = DB.getAttendanceByUser(siswa.id).filter(a => a.role === 'siswa');
    const payments = DB.getPaymentsByStudent(siswa.id);
    const parents = DB.getParentsOfStudent(siswa.id);
    const plans = DB.getClassPlansForStudent(siswa.id);

    // Tugas yang seharusnya dikerjakan berdasarkan kelas yang diikuti
    const dueAssignments = courses.flatMap(c => DB.getAssignmentsByCourse(c.id));
    const submittedIds = new Set(subs.map(s => s.assignmentId));
    const missing = dueAssignments.filter(a => !submittedIds.has(a.id));
    const late = subs.filter(s => {
      const a = DB.getAssignment(s.assignmentId);
      return a && a.dueDate && s.submittedAt && s.submittedAt > a.dueDate;
    });

    // Nilai per subtest dari sectionScores tiap attempt
    const bySubtest = {};
    attempts.forEach(a => {
      (a.sectionScores || []).forEach(s => {
        const key = s.subtest || 'Lainnya';
        if (!bySubtest[key]) bySubtest[key] = { correct: 0, total: 0, scores: [] };
        bySubtest[key].correct += Number(s.correct) || 0;
        bySubtest[key].total += Number(s.total) || 0;
        if (s.score != null) bySubtest[key].scores.push(s.score);
      });
    });
    // Bila attempt tidak punya sectionScores, pakai subtest kelasnya
    attempts.forEach(a => {
      if ((a.sectionScores || []).length) return;
      const cbt = DB.getCbt(a.cbtId);
      const c = cbt ? DB.getCourse(cbt.courseId) : null;
      const key = (c && c.subtest) || 'Lainnya';
      if (!bySubtest[key]) bySubtest[key] = { correct: 0, total: 0, scores: [] };
      bySubtest[key].correct += Number(a.correctCount) || 0;
      bySubtest[key].total += Number(a.totalCount) || 0;
      if (a.score != null) bySubtest[key].scores.push(a.score);
    });

    const avgAsg = average(graded.map(s => s.grade));
    const avgCbt = average(attempts.map(a => a.score));
    const presentPct = pctOf(att.filter(a => a.status === 'hadir').length, att.length);
    // Indeks performa gabungan: 40% CBT, 35% tugas, 25% kehadiran
    const parts = [];
    if (avgCbt != null) parts.push([avgCbt, 0.40]);
    if (avgAsg != null) parts.push([avgAsg, 0.35]);
    if (att.length) parts.push([presentPct, 0.25]);
    const wsum = parts.reduce((n, p) => n + p[1], 0);
    const performance = wsum ? Math.round(parts.reduce((n, p) => n + p[0] * p[1], 0) / wsum) : null;

    return {
      user: siswa,
      courses,
      parents,
      plans,
      classes: courses.length,
      subs: subs.length,
      subList: subs,
      graded: graded.length,
      missing: missing.length,
      missingList: missing,
      late: late.length,
      dueTotal: dueAssignments.length,
      dueList: dueAssignments,
      attempts: attempts.length,
      attemptList: attempts,
      violations: attempts.reduce((n, a) => n + ((a.violations || []).length), 0),
      avgAsg, avgCbt, performance,
      bestSubtest: Object.keys(bySubtest).length
        ? Object.entries(bySubtest).sort((a, b) => (average(b[1].scores) || 0) - (average(a[1].scores) || 0))[0][0] : null,
      weakSubtest: Object.keys(bySubtest).length
        ? Object.entries(bySubtest).sort((a, b) => (average(a[1].scores) || 0) - (average(b[1].scores) || 0))[0][0] : null,
      bySubtest,
      att,
      attTotal: att.length,
      hadir: att.filter(a => a.status === 'hadir').length,
      izin: att.filter(a => a.status === 'izin').length,
      sakit: att.filter(a => a.status === 'sakit').length,
      alfa: att.filter(a => a.status === 'alfa').length,
      presentPct,
      payments,
      paid: payments.filter(p => p.status === 'lunas').reduce((n, p) => n + (p.amount || 0), 0),
      unpaid: payments.filter(p => p.status !== 'lunas').reduce((n, p) => n + (p.amount || 0), 0)
    };
  }

  /* =====================================================================
   * Halaman utama
   * ===================================================================*/
  const TABS = [
    { key: 'ringkasan', label: '📊 Ringkasan' },
    { key: 'tutor', label: '👨‍🏫 Rekap Tutor' },
    { key: 'siswa', label: '👨‍🎓 Rekap Siswa' },
    { key: 'kelas', label: '📚 Rekap Kelas' },
    { key: 'subtest', label: '🧩 Per Subtest' }
  ];

  // Status navigasi rekap (tab aktif + detail yang dibuka)
  const state = { tab: 'ringkasan', tutorId: null, studentId: null, courseId: null };

  function scopeOf(user) {
    const isAdmin = user.role === 'admin';
    const courses = isAdmin ? DB.getCourses() : DB.getCoursesByTeacher(user.id);
    const courseIds = new Set(courses.map(c => c.id));
    let students;
    if (isAdmin) {
      students = DB.getUsers().filter(u => u.role === 'siswa');
    } else {
      const ids = new Set();
      courses.forEach(c => DB.getEnrollmentsByCourse(c.id).forEach(e => ids.add(e.studentId)));
      students = [...ids].map(id => DB.getUser(id)).filter(Boolean);
    }
    const tutors = isAdmin
      ? DB.getUsers().filter(u => u.role === 'guru')
      : [user];
    return { isAdmin, courses, courseIds, students, tutors };
  }

  function render(container, user) {
    const me = user || (global.Dashboard && Dashboard.currentUser);
    if (!me) return;
    const tabs = me.role === 'admin' ? TABS : TABS.filter(t => t.key !== 'ringkasan' || true);

    container.innerHTML = `
      <div class="subtabs">
        ${tabs.map(t => `<button class="subtab-btn ${state.tab === t.key ? 'active' : ''}" data-rtab="${t.key}">${t.label}</button>`).join('')}
      </div>
      <div id="rekapBox"></div>
    `;

    container.querySelectorAll('[data-rtab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-rtab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.tab = b.dataset.rtab;
      state.tutorId = state.studentId = state.courseId = null;
      paint();
    }));

    function paint() {
      const box = document.getElementById('rekapBox');
      if (!box) return;
      const sc = scopeOf(me);
      if (state.tab === 'ringkasan') renderRingkasan(box, me, sc, paint);
      else if (state.tab === 'tutor') {
        if (state.tutorId) renderTutorDetail(box, state.tutorId, me, paint);
        else renderTutorTable(box, me, sc, paint);
      } else if (state.tab === 'siswa') {
        if (state.studentId) renderStudentDetail(box, state.studentId, me, paint);
        else renderStudentTable(box, me, sc, paint);
      } else if (state.tab === 'kelas') {
        if (state.courseId) renderClassDetail(box, state.courseId, me, paint);
        else renderClassTable(box, me, sc, paint);
      } else renderSubtestTable(box, me, sc, paint);

      if (global.Effects) Effects.enhance(box);
      if (global.Responsive) Responsive.apply(box);
    }

    paint();
  }

  /* =====================================================================
   * Tab 1 — Ringkasan
   * ===================================================================*/
  function renderRingkasan(box, me, sc, repaint) {
    const tutorRows = sc.tutors.map(tutorStats);
    const studentRows = sc.students.map(studentStats);
    const classRows = sc.courses.map(courseStats);

    const totalAtt = classRows.reduce((n, r) => n + r.attTotal, 0);
    const totalHadir = classRows.reduce((n, r) => n + r.hadir, 0);
    const totalPlans = classRows.reduce((n, r) => n + r.plans, 0);
    const totalFixed = classRows.reduce((n, r) => n + r.plansFixed, 0);
    const ungraded = classRows.reduce((n, r) => n + r.ungraded, 0);
    const avgCbt = average(studentRows.map(r => r.avgCbt));
    const avgAsg = average(studentRows.map(r => r.avgAsg));
    const paid = studentRows.reduce((n, r) => n + r.paid, 0);
    const unpaid = studentRows.reduce((n, r) => n + r.unpaid, 0);

    const ranked = studentRows.filter(r => r.performance != null)
      .sort((a, b) => b.performance - a.performance);
    const top = ranked.slice(0, 5);
    const bottom = ranked.slice(-5).reverse();
    const risky = studentRows.filter(r =>
      (r.attTotal && r.presentPct < 75) || r.missing > 0 || r.unpaid > 0
    );

    box.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Tutor</div><div class="value">${sc.tutors.length}</div><div class="sub">${sc.courses.length} kelas subtest</div></div>
        <div class="stat-card accent-success"><div class="label">Siswa Aktif</div><div class="value">${sc.students.length}</div><div class="sub">${DB.getMainClasses().length} kelas utama</div></div>
        <div class="stat-card accent-info"><div class="label">Rata-rata CBT</div><div class="value">${avgCbt == null ? '–' : avgCbt}</div><div class="sub">rata tugas ${avgAsg == null ? '–' : avgAsg}</div></div>
        <div class="stat-card accent-warning"><div class="label">Kehadiran</div><div class="value">${pctOf(totalHadir, totalAtt)}%</div><div class="sub">${totalHadir}/${totalAtt} catatan</div></div>
        <div class="stat-card accent-primary"><div class="label">Rencana Kelas</div><div class="value">${totalPlans}</div><div class="sub">${totalFixed} sudah fix (${pctOf(totalFixed, totalPlans)}%)</div></div>
        <div class="stat-card accent-danger"><div class="label">Belum Dinilai</div><div class="value">${ungraded}</div><div class="sub">submission menunggu</div></div>
        <div class="stat-card accent-success"><div class="label">Terbayar</div><div class="value" style="font-size:18px;">${UI.fmtRp(paid)}</div><div class="sub">piutang ${UI.fmtRp(unpaid)}</div></div>
        <div class="stat-card accent-danger"><div class="label">Perlu Perhatian</div><div class="value">${risky.length}</div><div class="sub">kehadiran/tugas/tagihan</div></div>
      </div>

      <div class="rk-split">
        <div class="card">
          <div class="card-header">${UI.secHead('🥇', '5 Siswa Terbaik', 'indeks 40% CBT + 35% tugas + 25% kehadiran')}</div>
          ${top.length === 0 ? emptyState('Belum ada data nilai.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Siswa</th><th>Kelas Utama</th><th>Indeks</th><th>CBT</th><th>Hadir</th></tr></thead>
            <tbody>${top.map(r => `<tr>
              <td><strong>${esc(r.user.name)}</strong></td>
              <td>${esc(r.user.kelas || '-')}</td>
              <td>${scorePill(r.performance)}</td>
              <td>${nOrDash(r.avgCbt)}</td>
              <td>${r.attTotal ? r.presentPct + '%' : '<span class="muted">–</span>'}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('🆘', 'Perlu Pendampingan', 'indeks terendah')}</div>
          ${bottom.length === 0 ? emptyState('Belum ada data nilai.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Siswa</th><th>Kelas Utama</th><th>Indeks</th><th>Subtest Terlemah</th><th>Tugas Nunggak</th></tr></thead>
            <tbody>${bottom.map(r => `<tr>
              <td><strong>${esc(r.user.name)}</strong></td>
              <td>${esc(r.user.kelas || '-')}</td>
              <td>${scorePill(r.performance)}</td>
              <td>${esc(r.weakSubtest || '-')}</td>
              <td>${r.missing ? `<span class="badge badge-danger">${r.missing}</span>` : '0'}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🏫', 'Ringkasan Kinerja Tutor', 'klik tab Rekap Tutor untuk detail lengkap')}</div>
        ${tutorRows.length === 0 ? emptyState('Belum ada tutor.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tutor</th><th>Kelas</th><th>Siswa</th><th>Rencana Fix</th><th>Kedisiplinan</th><th>Rata CBT</th><th>Belum Dinilai</th></tr></thead>
          <tbody>${tutorRows.map(t => `<tr>
            <td><strong>${esc(t.user.name)}</strong><div class="muted small">${esc(t.subtests.join(', ') || '-')}</div></td>
            <td>${t.classes}</td>
            <td>${t.students}</td>
            <td>${t.plansFixed}/${t.plans}</td>
            <td>${t.plans ? scorePill(t.disciplinePct, '%') : '<span class="muted">–</span>'}</td>
            <td>${nOrDash(t.avgCbt)}</td>
            <td>${t.ungraded ? `<span class="badge badge-warning">${t.ungraded}</span>` : '0'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>

      ${risky.length ? `
      <div class="card">
        <div class="card-header">${UI.secHead('⚠️', `Daftar Perlu Perhatian (${risky.length})`, 'kehadiran < 75%, ada tugas nunggak, atau masih ada tagihan')}</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Siswa</th><th>Kelas Utama</th><th>Kehadiran</th><th>Tugas Nunggak</th><th>Tagihan</th><th>Catatan</th></tr></thead>
          <tbody>${risky.map(r => {
            const notes = [];
            if (r.attTotal && r.presentPct < 75) notes.push('kehadiran rendah');
            if (r.missing) notes.push(r.missing + ' tugas belum dikumpulkan');
            if (r.unpaid) notes.push('tagihan ' + UI.fmtRp(r.unpaid));
            return `<tr>
              <td><strong>${esc(r.user.name)}</strong></td>
              <td>${esc(r.user.kelas || '-')}</td>
              <td>${r.attTotal ? r.presentPct + '%' : '<span class="muted">–</span>'}</td>
              <td>${r.missing}</td>
              <td>${r.unpaid ? UI.fmtRp(r.unpaid) : '-'}</td>
              <td class="muted small">${esc(notes.join(' • '))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>` : ''}
    `;
  }

  /* =====================================================================
   * Tab 2 — Rekap Tutor
   * ===================================================================*/
  function renderTutorTable(box, me, sc, repaint) {
    const rows = sc.tutors.map(tutorStats);
    box.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('👨‍🏫', `Rekap per Tutor (${rows.length})`, 'klik "Detail" untuk rekap lengkap satu tutor')}
          ${csvBtn('rkTutorCsv', 'Unduh CSV')}
        </div>
        ${rows.length === 0 ? emptyState('Belum ada tutor.', '👨‍🏫') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Tutor</th><th>Subtest</th><th>Kelas</th><th>Siswa</th>
            <th>Materi</th><th>Modul</th><th>Rekaman</th><th>Tugas</th><th>Soal</th><th>CBT</th>
            <th>Sesi</th><th>Rencana</th><th>Fix</th><th>Kedisiplinan</th>
            <th>Rata Tugas</th><th>Rata CBT</th><th>Hadir Kelas</th><th>Belum Dinilai</th><th>Aksi</th>
          </tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td><strong>${esc(t.user.name)}</strong><div class="muted small">@${esc(t.user.username)}</div></td>
            <td>${esc(t.subtests.join(', ') || '-')}</td>
            <td>${t.classes}</td>
            <td>${t.students}</td>
            <td>${t.materials}</td>
            <td>${t.modules}</td>
            <td>${t.recordings}</td>
            <td>${t.assignments}</td>
            <td>${t.questions}</td>
            <td>${t.cbts}</td>
            <td>${t.sessions}</td>
            <td>${t.plans}</td>
            <td>${t.plansFixed}</td>
            <td>${t.plans ? scorePill(t.disciplinePct, '%') : '<span class="muted">–</span>'}</td>
            <td>${nOrDash(t.avgAsg)}</td>
            <td>${nOrDash(t.avgCbt)}</td>
            <td>${t.classPresentPct}%</td>
            <td>${t.ungraded ? `<span class="badge badge-warning">${t.ungraded}</span>` : '0'}</td>
            <td class="actions"><button class="btn btn-sm btn-primary" data-tutor="${t.user.id}">Detail</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    box.querySelectorAll('[data-tutor]').forEach(b => b.addEventListener('click', () => {
      state.tutorId = b.dataset.tutor;
      repaint();
    }));
    bindCsv(document.getElementById('rkTutorCsv'), 'rekap-tutor.csv',
      ['Tutor', 'Username', 'Subtest', 'Kelas', 'Siswa', 'Materi', 'Modul', 'Rekaman', 'Tugas', 'Soal', 'CBT',
        'Sesi', 'Rencana', 'Fix', 'Kedisiplinan %', 'Rata Tugas', 'Rata CBT', 'Hadir Kelas %', 'Belum Dinilai'],
      () => rows.map(t => [t.user.name, t.user.username, t.subtests.join(', '), t.classes, t.students,
        t.materials, t.modules, t.recordings, t.assignments, t.questions, t.cbts, t.sessions,
        t.plans, t.plansFixed, t.disciplinePct, t.avgAsg ?? '', t.avgCbt ?? '', t.classPresentPct, t.ungraded]));
  }

  function renderTutorDetail(box, tutorId, me, repaint) {
    const guru = DB.getUser(tutorId);
    if (!guru) { state.tutorId = null; repaint(); return; }
    const t = tutorStats(guru);
    const PS = DB.PLAN_STATUS || {};
    const upcoming = t.planList.slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter(p => DB.planDaysAhead(p.date) >= -14);

    const allAsg = t.per.flatMap(p => p.assignmentList.map(a => ({ a, course: p.course, studentCount: p.students })));
    const allCbt = t.per.flatMap(p => p.cbtList.map(c => ({ c, course: p.course })));

    box.innerHTML = `
      <button class="btn btn-secondary btn-sm mb-1" id="rkBack">← Kembali ke Daftar Tutor</button>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🏫', guru.name, `@${guru.username} • ${esc(guru.email || '-')} • ${esc(guru.phone || 'tanpa nomor')}`)}</div>
        <div class="table-wrap"><table class="table">
          <tbody>
            <tr><th>Subtest Diampu</th><td>${t.subtests.length ? t.subtests.map(s => `<span class="badge badge-info">${esc(s)}</span>`).join(' ') : '<span class="muted">–</span>'}</td></tr>
            <tr><th>Kelas Utama Dilayani</th><td>${t.mainClasses.length ? t.mainClasses.map(s => `<span class="badge badge-secondary">${esc(s)}</span>`).join(' ') : '<span class="muted">–</span>'}</td></tr>
            <tr><th>Hari Mengajar</th><td>${esc((guru.teachDays || []).join(', ') || '-')} ${guru.teachTime ? '• ' + esc(guru.teachTime) : ''}</td></tr>
            <tr><th>Keahlian</th><td>${esc(guru.subject || guru.expertise || '-')}</td></tr>
          </tbody>
        </table></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Kelas Diampu</div><div class="value">${t.classes}</div><div class="sub">${t.students} siswa</div></div>
        <div class="stat-card accent-success"><div class="label">Sesi Terlaksana</div><div class="value">${t.sessions}</div><div class="sub">berdasarkan presensi</div></div>
        <div class="stat-card accent-info"><div class="label">Kedisiplinan Rencana</div><div class="value">${t.plans ? t.disciplinePct + '%' : '–'}</div><div class="sub">${t.plansFixed}/${t.plans} divalidasi</div></div>
        <div class="stat-card accent-warning"><div class="label">Presensi Tutor</div><div class="value">${t.ownAttTotal ? t.ownPresentPct + '%' : '–'}</div><div class="sub">${t.ownAttTotal} catatan</div></div>
        <div class="stat-card accent-primary"><div class="label">Konten Dibuat</div><div class="value">${t.materials + t.modules + t.recordings}</div><div class="sub">${t.materials} materi • ${t.modules} modul • ${t.recordings} rekaman</div></div>
        <div class="stat-card accent-info"><div class="label">Soal Ditulis</div><div class="value">${t.questions}</div><div class="sub">${t.cbts} paket CBT</div></div>
        <div class="stat-card accent-danger"><div class="label">Belum Dinilai</div><div class="value">${t.ungraded}</div><div class="sub">dari ${t.submissions} submission</div></div>
        <div class="stat-card accent-success"><div class="label">Honor Dibayar</div><div class="value" style="font-size:18px;">${UI.fmtRp(t.salaryPaid)}</div><div class="sub">tertunda ${UI.fmtRp(t.salaryPending)}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📚', 'Rincian Tiap Kelas', 'performa kelas yang diampu tutor ini')}${csvBtn('rkTdKelasCsv')}</div>
        ${t.per.length === 0 ? emptyState('Tutor ini belum mengampu kelas.', '📚') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Kelas</th><th>Kelas Utama</th><th>Jadwal</th><th>Siswa</th><th>Materi</th><th>Modul</th><th>Tugas</th><th>CBT</th><th>Sesi</th><th>Kehadiran</th><th>Rata Tugas</th><th>Rata CBT</th><th>Rencana Fix</th></tr></thead>
          <tbody>${t.per.map(p => `<tr>
            <td><strong>${esc(DB.courseTitle ? DB.courseTitle(p.course) : p.course.title)}</strong></td>
            <td>${esc((p.course.mainClasses || []).join(', ') || '-')}</td>
            <td class="muted small">${esc(DB.courseScheduleLabel(p.course))}</td>
            <td>${p.students}</td>
            <td>${p.materials}</td>
            <td>${p.modules}</td>
            <td>${p.assignments}</td>
            <td>${p.cbts}</td>
            <td>${p.sessions}</td>
            <td>${p.attTotal ? scorePill(p.presentPct, '%') : '<span class="muted">–</span>'}</td>
            <td>${nOrDash(p.avgAsg)}</td>
            <td>${nOrDash(p.avgCbt)}</td>
            <td>${p.plansFixed}/${p.plans}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🗂️', `Rencana Kelas (${t.plans})`, 'hasil pengisian War Jadwal Kelas')}</div>
        <div class="rk-chiprow">
          <span class="rk-chip">Rencana <strong>${t.plansDraft}</strong></span>
          <span class="rk-chip ok">Fix <strong>${t.plansFixed}</strong></span>
          <span class="rk-chip warn">Diubah <strong>${t.plansChanged}</strong></span>
          <span class="rk-chip bad">Dibatalkan <strong>${t.plansCancelled}</strong></span>
        </div>
        ${upcoming.length === 0 ? emptyState('Belum ada rencana kelas.', '🗂️') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas</th><th>Jam</th><th>Topik</th><th>Status</th></tr></thead>
          <tbody>${upcoming.map(p => {
            const c = DB.getCourse(p.courseId);
            const st = PS[p.status] || { label: p.status, badge: 'badge-secondary' };
            return `<tr>
              <td>${UI.fmtYMD(p.date)}</td>
              <td>${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : 'Kelas dihapus')}</td>
              <td>${esc(p.time || '-')}${p.endTime ? '–' + esc(p.endTime) : ''}</td>
              <td>${esc(p.topic || '-')}</td>
              <td><span class="badge ${esc(st.badge || 'badge-secondary')}">${esc(st.label || p.status)}</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📝', `Tugas Dibuat (${allAsg.length})`, 'tingkat pengumpulan dan penilaian')}</div>
        ${allAsg.length === 0 ? emptyState('Belum ada tugas.', '📝') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Tenggat</th><th>Terkumpul</th><th>Dinilai</th><th>Belum Dinilai</th><th>Rata Nilai</th></tr></thead>
          <tbody>${allAsg.map(({ a, course, studentCount }) => {
            const subs = DB.getSubmissionsByAssignment(a.id);
            const graded = subs.filter(s => s.grade != null);
            return `<tr>
              <td><strong>${esc(a.title)}</strong></td>
              <td class="muted small">${esc(DB.courseTitle ? DB.courseTitle(course) : course.title)}</td>
              <td>${a.dueDate ? UI.fmtDate(a.dueDate) : '-'}</td>
              <td>${subs.length}/${studentCount}</td>
              <td>${graded.length}</td>
              <td>${subs.length - graded.length ? `<span class="badge badge-warning">${subs.length - graded.length}</span>` : '0'}</td>
              <td>${nOrDash(average(graded.map(s => s.grade)))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🖥️', `CBT Dibuat (${allCbt.length})`, 'partisipasi, skor, dan pelanggaran')}</div>
        ${allCbt.length === 0 ? emptyState('Belum ada paket CBT.', '🖥️') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Ujian</th><th>Kelas</th><th>Soal</th><th>Peserta</th><th>Selesai</th><th>Rata Skor</th><th>Tertinggi</th><th>Terendah</th><th>Pelanggaran</th></tr></thead>
          <tbody>${allCbt.map(({ c, course }) => {
            const atts = DB.getCbtAttemptsByCbt(c.id);
            const done = atts.filter(a => a.submittedAt);
            const scores = done.map(a => a.score).filter(s => s != null);
            const viol = atts.reduce((n, a) => n + ((a.violations || []).length), 0);
            return `<tr>
              <td><strong>${esc(c.title)}</strong></td>
              <td class="muted small">${esc(DB.courseTitle ? DB.courseTitle(course) : course.title)}</td>
              <td>${DB.cbtQuestionIds(c).length}</td>
              <td>${atts.length}</td>
              <td>${done.length}</td>
              <td>${nOrDash(average(scores))}</td>
              <td>${scores.length ? Math.max(...scores) : '<span class="muted">–</span>'}</td>
              <td>${scores.length ? Math.min(...scores) : '<span class="muted">–</span>'}</td>
              <td>${viol ? `<span class="badge badge-danger">${viol}</span>` : '0'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="rk-split">
        <div class="card">
          <div class="card-header">${UI.secHead('📝', 'Soal per Subtest', `${t.questions} soal ditulis`)}</div>
          ${Object.keys(t.questionsBySubject).length === 0 ? emptyState('Belum menulis soal.', '📝') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Subtest</th><th>Jumlah</th><th>Porsi</th></tr></thead>
            <tbody>${Object.entries(t.questionsBySubject).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr>
              <td>${esc(k)}</td><td>${v}</td>
              <td>${UI.progressHtml(pctOf(v, t.questions), '', 'auto')}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('💰', 'Riwayat Honor', `${t.salaries.length} catatan`)}</div>
          ${t.salaries.length === 0 ? emptyState('Belum ada catatan honor.', '💰') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Periode</th><th>Jumlah</th><th>Status</th><th>Dibayar</th></tr></thead>
            <tbody>${t.salaries.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(s => `<tr>
              <td>${esc(s.period || '-')}</td>
              <td>${UI.fmtRp(s.amount)}</td>
              <td>${s.status === 'dibayar' ? '<span class="badge badge-success">Dibayar</span>' : `<span class="badge badge-warning">${esc(s.status || '-')}</span>`}</td>
              <td>${s.paidAt ? UI.fmtDate(s.paidAt) : '-'}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📋', 'Presensi Tutor', 'kehadiran tutor pada sesi kelasnya')}</div>
        ${t.ownAtt.length === 0 ? emptyState('Belum ada catatan presensi tutor.', '📋') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${t.ownAtt.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(a => {
            const c = DB.getCourse(a.courseId);
            return `<tr>
              <td>${UI.fmtYMD(a.date)}</td>
              <td>${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : '-')}</td>
              <td>${statusBadge(a.status)}</td>
              <td class="muted small">${esc(a.note || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🎓', `Siswa yang Diajar (${t.students})`, 'klik untuk membuka rekap siswa')}</div>
        ${t.studentIds.length === 0 ? emptyState('Belum ada siswa terdaftar.', '👨‍🎓') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Siswa</th><th>Kelas Utama</th><th>Indeks</th><th>Rata CBT</th><th>Rata Tugas</th><th>Kehadiran</th><th>Aksi</th></tr></thead>
          <tbody>${t.studentIds.map(id => DB.getUser(id)).filter(Boolean).map(s => {
            const r = studentStats(s);
            return `<tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${esc(s.kelas || '-')}</td>
              <td>${scorePill(r.performance)}</td>
              <td>${nOrDash(r.avgCbt)}</td>
              <td>${nOrDash(r.avgAsg)}</td>
              <td>${r.attTotal ? r.presentPct + '%' : '<span class="muted">–</span>'}</td>
              <td class="actions"><button class="btn btn-sm btn-secondary" data-goto-student="${s.id}">Rekap</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;

    document.getElementById('rkBack').addEventListener('click', () => { state.tutorId = null; repaint(); });
    box.querySelectorAll('[data-goto-student]').forEach(b => b.addEventListener('click', () => {
      state.tab = 'siswa';
      state.tutorId = null;
      state.studentId = b.dataset.gotoStudent;
      const holder = document.querySelector('.subtabs');
      if (holder) {
        holder.querySelectorAll('[data-rtab]').forEach(x => x.classList.toggle('active', x.dataset.rtab === 'siswa'));
      }
      repaint();
    }));
    bindCsv(document.getElementById('rkTdKelasCsv'), `rekap-tutor-${guru.username}-kelas.csv`,
      ['Kelas', 'Kelas Utama', 'Jadwal', 'Siswa', 'Materi', 'Modul', 'Tugas', 'CBT', 'Sesi', 'Kehadiran %', 'Rata Tugas', 'Rata CBT', 'Rencana', 'Fix'],
      () => t.per.map(p => [DB.courseTitle(p.course), (p.course.mainClasses || []).join(', '),
        DB.courseScheduleLabel(p.course), p.students, p.materials, p.modules, p.assignments, p.cbts,
        p.sessions, p.presentPct, p.avgAsg ?? '', p.avgCbt ?? '', p.plans, p.plansFixed]));
  }

  /* =====================================================================
   * Tab 3 — Rekap Siswa
   * ===================================================================*/
  function renderStudentTable(box, me, sc, repaint) {
    const mains = DB.getMainClasses();
    box.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('👨‍🎓', `Rekap per Siswa (${sc.students.length})`, 'klik "Detail" untuk rekap lengkap satu siswa')}
          ${csvBtn('rkSiswaCsv', 'Unduh CSV')}
        </div>
        <div class="rk-filters">
          <input type="search" id="rkSearch" class="input" placeholder="Cari nama atau username siswa…" />
          <select id="rkMain" class="input">
            <option value="">Semua kelas utama</option>
            ${mains.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
          <select id="rkSort" class="input">
            <option value="name">Urut: Nama</option>
            <option value="perf">Urut: Indeks tertinggi</option>
            <option value="perfAsc">Urut: Indeks terendah</option>
            <option value="att">Urut: Kehadiran terendah</option>
          </select>
        </div>
        <div id="rkStudentBody"></div>
      </div>
    `;

    const allRows = sc.students.map(studentStats);

    function filtered() {
      const q = (document.getElementById('rkSearch').value || '').toLowerCase().trim();
      const main = document.getElementById('rkMain').value;
      const sort = document.getElementById('rkSort').value;
      let rows = allRows.filter(r => {
        if (main && (r.user.kelas || '') !== main) return false;
        if (!q) return true;
        return (r.user.name || '').toLowerCase().includes(q) ||
          (r.user.username || '').toLowerCase().includes(q);
      });
      if (sort === 'perf') rows = rows.slice().sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
      else if (sort === 'perfAsc') rows = rows.slice().sort((a, b) => (a.performance ?? 999) - (b.performance ?? 999));
      else if (sort === 'att') rows = rows.slice().sort((a, b) => a.presentPct - b.presentPct);
      else rows = rows.slice().sort((a, b) => (a.user.name || '').localeCompare(b.user.name || ''));
      return rows;
    }

    function paintBody() {
      const rows = filtered();
      const body = document.getElementById('rkStudentBody');
      body.innerHTML = rows.length === 0 ? emptyState('Tidak ada siswa yang cocok.', '👨‍🎓') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Siswa</th><th>Kelas Utama</th><th>Target</th><th>Kelas Subtest</th>
            <th>Indeks</th><th>Rata CBT</th><th>CBT Selesai</th><th>Rata Tugas</th>
            <th>Terkumpul</th><th>Nunggak</th><th>Terlambat</th>
            <th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Kehadiran</th>
            <th>Terkuat</th><th>Terlemah</th><th>Pelanggaran</th><th>Terbayar</th><th>Tagihan</th><th>Aksi</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${esc(r.user.name)}</strong><div class="muted small">@${esc(r.user.username)}</div></td>
            <td>${esc(r.user.kelas || '-')}</td>
            <td class="muted small">${esc(r.user.target || r.user.targetKampus || '-')}</td>
            <td>${r.classes}</td>
            <td>${scorePill(r.performance)}</td>
            <td>${nOrDash(r.avgCbt)}</td>
            <td>${r.attempts}</td>
            <td>${nOrDash(r.avgAsg)}</td>
            <td>${r.subs}/${r.dueTotal}</td>
            <td>${r.missing ? `<span class="badge badge-danger">${r.missing}</span>` : '0'}</td>
            <td>${r.late || 0}</td>
            <td>${r.hadir}</td><td>${r.izin}</td><td>${r.sakit}</td><td>${r.alfa}</td>
            <td>${r.attTotal ? scorePill(r.presentPct, '%') : '<span class="muted">–</span>'}</td>
            <td class="muted small">${esc(r.bestSubtest || '-')}</td>
            <td class="muted small">${esc(r.weakSubtest || '-')}</td>
            <td>${r.violations ? `<span class="badge badge-danger">${r.violations}</span>` : '0'}</td>
            <td>${UI.fmtRp(r.paid)}</td>
            <td>${r.unpaid ? `<span class="badge badge-warning">${UI.fmtRp(r.unpaid)}</span>` : '-'}</td>
            <td class="actions"><button class="btn btn-sm btn-primary" data-student="${r.user.id}">Detail</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`;
      body.querySelectorAll('[data-student]').forEach(b => b.addEventListener('click', () => {
        state.studentId = b.dataset.student;
        repaint();
      }));
      if (global.Responsive) Responsive.apply(body);
    }

    ['rkSearch', 'rkMain', 'rkSort'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', paintBody);
      el.addEventListener('change', paintBody);
    });
    paintBody();

    bindCsv(document.getElementById('rkSiswaCsv'), 'rekap-siswa.csv',
      ['Siswa', 'Username', 'Kelas Utama', 'Target', 'Kelas Subtest', 'Indeks', 'Rata CBT', 'CBT Selesai',
        'Rata Tugas', 'Terkumpul', 'Total Tugas', 'Nunggak', 'Terlambat', 'Hadir', 'Izin', 'Sakit', 'Alfa',
        'Kehadiran %', 'Subtest Terkuat', 'Subtest Terlemah', 'Pelanggaran', 'Terbayar', 'Tagihan'],
      () => filtered().map(r => [r.user.name, r.user.username, r.user.kelas || '', r.user.target || '',
        r.classes, r.performance ?? '', r.avgCbt ?? '', r.attempts, r.avgAsg ?? '', r.subs, r.dueTotal,
        r.missing, r.late, r.hadir, r.izin, r.sakit, r.alfa, r.presentPct,
        r.bestSubtest || '', r.weakSubtest || '', r.violations, r.paid, r.unpaid]));
  }

  function renderStudentDetail(box, studentId, me, repaint) {
    const s = DB.getUser(studentId);
    if (!s) { state.studentId = null; repaint(); return; }
    const r = studentStats(s);
    const PS = DB.PLAN_STATUS || {};

    const subtestRows = Object.entries(r.bySubtest).map(([k, v]) => ({
      subtest: k, correct: v.correct, total: v.total,
      score: average(v.scores), acc: pctOf(v.correct, v.total)
    })).sort((a, b) => (b.score || 0) - (a.score || 0));

    box.innerHTML = `
      <button class="btn btn-secondary btn-sm mb-1" id="rkBack">← Kembali ke Daftar Siswa</button>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🎓', s.name, `@${esc(s.username)} • ${esc(s.kelas || 'tanpa kelas utama')}`)}</div>
        <div class="table-wrap"><table class="table">
          <tbody>
            <tr><th>Target Kampus</th><td>${esc(s.target || s.targetKampus || '-')}</td></tr>
            <tr><th>Kontak</th><td>${esc(s.email || '-')} • ${esc(s.phone || '-')}</td></tr>
            <tr><th>Orang Tua / Wali</th><td>${r.parents.length ? r.parents.map(p => `${esc(p.name)} <span class="muted small">(${esc(p.phone || p.username)})</span>`).join(' • ') : '<span class="muted">belum ditautkan</span>'}</td></tr>
            <tr><th>Status</th><td>${s.active === false ? '<span class="badge badge-danger">Nonaktif</span>' : '<span class="badge badge-success">Aktif</span>'}</td></tr>
          </tbody>
        </table></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Indeks Performa</div><div class="value">${r.performance == null ? '–' : r.performance}</div><div class="sub">40% CBT • 35% tugas • 25% hadir</div></div>
        <div class="stat-card accent-info"><div class="label">Rata-rata CBT</div><div class="value">${r.avgCbt == null ? '–' : r.avgCbt}</div><div class="sub">${r.attempts} ujian selesai</div></div>
        <div class="stat-card accent-success"><div class="label">Rata-rata Tugas</div><div class="value">${r.avgAsg == null ? '–' : r.avgAsg}</div><div class="sub">${r.graded}/${r.subs} dinilai</div></div>
        <div class="stat-card accent-warning"><div class="label">Kehadiran</div><div class="value">${r.attTotal ? r.presentPct + '%' : '–'}</div><div class="sub">${r.hadir}H ${r.izin}I ${r.sakit}S ${r.alfa}A</div></div>
        <div class="stat-card accent-primary"><div class="label">Kelas Subtest</div><div class="value">${r.classes}</div><div class="sub">${r.plans.length} rencana kelas</div></div>
        <div class="stat-card accent-danger"><div class="label">Tugas Nunggak</div><div class="value">${r.missing}</div><div class="sub">${r.late} terlambat</div></div>
        <div class="stat-card accent-danger"><div class="label">Pelanggaran Ujian</div><div class="value">${r.violations}</div><div class="sub">tercatat saat CBT</div></div>
        <div class="stat-card accent-success"><div class="label">Terbayar</div><div class="value" style="font-size:18px;">${UI.fmtRp(r.paid)}</div><div class="sub">tagihan ${UI.fmtRp(r.unpaid)}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🧩', 'Penguasaan per Subtest', 'dihitung dari tiap bagian ujian CBT yang dikerjakan')}</div>
        ${subtestRows.length === 0 ? emptyState('Belum ada hasil CBT.', '🧩') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Subtest</th><th>Benar</th><th>Soal</th><th>Akurasi</th><th>Rata Skor</th><th>Grafik</th></tr></thead>
          <tbody>${subtestRows.map(x => `<tr>
            <td><strong>${esc(x.subtest)}</strong></td>
            <td>${x.correct}</td>
            <td>${x.total}</td>
            <td>${x.acc}%</td>
            <td>${scorePill(x.score)}</td>
            <td>${UI.progressHtml(x.score || 0, '', 'auto')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="muted small mt-1">Subtest terkuat: <strong>${esc(r.bestSubtest || '-')}</strong> • perlu ditingkatkan: <strong>${esc(r.weakSubtest || '-')}</strong></p>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📚', `Kelas yang Diikuti (${r.classes})`, 'performa siswa ini di setiap kelas')}</div>
        ${r.courses.length === 0 ? emptyState('Belum terdaftar di kelas mana pun.', '📚') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Kelas</th><th>Subtest</th><th>Tutor</th><th>Jadwal</th><th>Kehadiran</th><th>Tugas</th><th>Rata Tugas</th><th>CBT</th><th>Rata CBT</th></tr></thead>
          <tbody>${r.courses.map(c => {
            const asg = DB.getAssignmentsByCourse(c.id);
            const asgIds = asg.map(a => a.id);
            const mySubs = r.subList.filter(x => asgIds.includes(x.assignmentId));
            const myGraded = mySubs.filter(x => x.grade != null);
            const cbtIds = DB.getCbtsByCourse(c.id).map(x => x.id);
            const myAtt = r.attemptList.filter(a => cbtIds.includes(a.cbtId));
            const att = r.att.filter(a => a.courseId === c.id);
            return `<tr>
              <td><strong>${esc(DB.courseTitle ? DB.courseTitle(c) : c.title)}</strong></td>
              <td>${esc(c.subtest || '-')}</td>
              <td>${esc(DB.courseTeachers(c).map(x => x.name).join(' & ') || '-')}</td>
              <td class="muted small">${esc(DB.courseScheduleLabel(c))}</td>
              <td>${att.length ? scorePill(pctOf(att.filter(a => a.status === 'hadir').length, att.length), '%') : '<span class="muted">–</span>'}</td>
              <td>${mySubs.length}/${asg.length}</td>
              <td>${nOrDash(average(myGraded.map(x => x.grade)))}</td>
              <td>${myAtt.length}/${cbtIds.length}</td>
              <td>${nOrDash(average(myAtt.map(a => a.score)))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🖥️', `Riwayat CBT (${r.attempts})`, 'skor, durasi, dan pelanggaran tiap ujian')}</div>
        ${r.attemptList.length === 0 ? emptyState('Belum mengikuti CBT.', '🖥️') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Ujian</th><th>Kelas</th><th>Tanggal</th><th>Skor</th><th>Benar</th><th>Durasi</th><th>Pelanggaran</th><th>Rincian Bagian</th></tr></thead>
          <tbody>${r.attemptList.slice().sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).map(a => {
            const cbt = DB.getCbt(a.cbtId);
            const c = cbt ? DB.getCourse(cbt.courseId) : null;
            const dur = a.submittedAt && a.startedAt ? UI.fmtDuration(Math.round((a.submittedAt - a.startedAt) / 1000)) : '-';
            return `<tr>
              <td><strong>${esc(cbt ? cbt.title : 'Ujian dihapus')}</strong></td>
              <td class="muted small">${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : '-')}</td>
              <td>${a.submittedAt ? UI.fmtDate(a.submittedAt) : '-'}</td>
              <td>${scorePill(a.score)}</td>
              <td>${a.correctCount ?? '-'}/${a.totalCount ?? '-'}</td>
              <td>${dur}</td>
              <td>${(a.violations || []).length ? `<span class="badge badge-danger">${(a.violations || []).length}</span>` : '0'}</td>
              <td class="muted small">${esc((a.sectionScores || []).map(x => `${x.subtest}: ${x.score}`).join(' • ') || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📝', `Tugas (${r.dueTotal})`, 'status pengumpulan tiap tugas di kelasnya')}</div>
        ${r.dueList.length === 0 ? emptyState('Belum ada tugas.', '📝') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Tenggat</th><th>Status</th><th>Dikumpulkan</th><th>Nilai</th><th>Catatan Tutor</th></tr></thead>
          <tbody>${r.dueList.slice().sort((a, b) => (b.dueDate || 0) - (a.dueDate || 0)).map(a => {
            const c = DB.getCourse(a.courseId);
            const sub = r.subList.find(x => x.assignmentId === a.id);
            let st = '<span class="badge badge-danger">Belum dikumpulkan</span>';
            if (sub) {
              const isLate = a.dueDate && sub.submittedAt && sub.submittedAt > a.dueDate;
              st = isLate ? '<span class="badge badge-warning">Terlambat</span>' : '<span class="badge badge-success">Terkumpul</span>';
            }
            return `<tr>
              <td><strong>${esc(a.title)}</strong></td>
              <td class="muted small">${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : '-')}</td>
              <td>${a.dueDate ? UI.fmtDate(a.dueDate) : '-'}</td>
              <td>${st}</td>
              <td>${sub && sub.submittedAt ? UI.fmtDate(sub.submittedAt) : '-'}</td>
              <td>${sub ? (sub.grade != null ? scorePill(sub.grade) : '<span class="badge badge-warning">Menunggu nilai</span>') : '-'}</td>
              <td class="muted small">${esc(sub ? (sub.feedback || '-') : '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="rk-split">
        <div class="card">
          <div class="card-header">${UI.secHead('📋', 'Riwayat Presensi', `${r.attTotal} catatan terakhir`)}</div>
          ${r.att.length === 0 ? emptyState('Belum ada presensi.', '📋') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
            <tbody>${r.att.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(a => {
              const c = DB.getCourse(a.courseId);
              return `<tr>
                <td>${UI.fmtYMD(a.date)}</td>
                <td class="muted small">${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : '-')}</td>
                <td>${statusBadge(a.status)}</td>
                <td class="muted small">${esc(a.note || '-')}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('💰', 'Pembayaran', `${r.payments.length} transaksi`)}</div>
          ${r.payments.length === 0 ? emptyState('Belum ada pembayaran.', '💰') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Kelas</th><th>Jumlah</th><th>Status</th></tr></thead>
            <tbody>${r.payments.slice().sort((a, b) => (b.paidAt || b.createdAt || 0) - (a.paidAt || a.createdAt || 0)).map(p => {
              const c = p.courseId ? DB.getCourse(p.courseId) : null;
              return `<tr>
                <td>${UI.fmtDate(p.paidAt || p.createdAt)}</td>
                <td class="muted small">${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : 'Umum')}</td>
                <td>${UI.fmtRp(p.amount)}</td>
                <td>${p.status === 'lunas' ? '<span class="badge badge-success">Lunas</span>' : `<span class="badge badge-warning">${esc(p.status || '-')}</span>`}</td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🗓️', 'Rencana Kelas Mendatang', 'dari War Jadwal Kelas tutornya')}</div>
        ${(() => {
          const up = r.plans.filter(p => DB.planDaysAhead(p.date) >= 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15);
          return up.length === 0 ? emptyState('Belum ada rencana kelas mendatang.', '🗓️') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Kelas</th><th>Jam</th><th>Materi</th><th>Status</th></tr></thead>
            <tbody>${up.map(p => {
              const c = DB.getCourse(p.courseId);
              const st = PS[p.status] || { label: p.status, badge: 'badge-secondary' };
              return `<tr>
                <td>${UI.fmtYMD(p.date)}</td>
                <td>${esc(c ? (DB.courseTitle ? DB.courseTitle(c) : c.title) : '-')}</td>
                <td>${esc(p.time || '-')}${p.endTime ? '–' + esc(p.endTime) : ''}</td>
                <td>${esc(p.topic || '-')}</td>
                <td><span class="badge ${esc(st.badge || 'badge-secondary')}">${esc(st.label || p.status)}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`;
        })()}
      </div>
    `;
    document.getElementById('rkBack').addEventListener('click', () => { state.studentId = null; repaint(); });
  }

  /* =====================================================================
   * Tab 4 — Rekap Kelas
   * ===================================================================*/
  function renderClassTable(box, me, sc, repaint) {
    const rows = sc.courses.map(courseStats);
    box.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('📚', `Rekap per Kelas Subtest (${rows.length})`, 'aktivitas, hasil belajar, dan kepatuhan jadwal')}
          ${csvBtn('rkKelasCsv', 'Unduh CSV')}
        </div>
        ${rows.length === 0 ? emptyState('Belum ada kelas.', '📚') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Kelas</th><th>Subtest</th><th>Kelas Utama</th><th>Tutor</th><th>Jadwal</th>
            <th>Siswa</th><th>Materi</th><th>Modul</th><th>Rekaman</th>
            <th>Tugas</th><th>Terkumpul</th><th>Belum Dinilai</th>
            <th>CBT</th><th>Attempt</th><th>Rata Tugas</th><th>Rata CBT</th>
            <th>Sesi</th><th>Kehadiran</th><th>Rencana</th><th>Fix</th><th>Aksi</th>
          </tr></thead>
          <tbody>${rows.map(p => `<tr>
            <td><strong>${esc(DB.courseTitle ? DB.courseTitle(p.course) : p.course.title)}</strong></td>
            <td>${esc(p.course.subtest || '-')}</td>
            <td>${esc((p.course.mainClasses || []).join(', ') || '-')}</td>
            <td class="muted small">${esc(DB.courseTeachers(p.course).map(t => t.name).join(' & ') || '-')}</td>
            <td class="muted small">${esc(DB.courseScheduleLabel(p.course))}</td>
            <td>${p.students}</td>
            <td>${p.materials}</td>
            <td>${p.modules}</td>
            <td>${p.recordings}</td>
            <td>${p.assignments}</td>
            <td>${p.submissions}/${p.expectedSubs}</td>
            <td>${p.ungraded ? `<span class="badge badge-warning">${p.ungraded}</span>` : '0'}</td>
            <td>${p.cbts}</td>
            <td>${p.attempts}</td>
            <td>${nOrDash(p.avgAsg)}</td>
            <td>${nOrDash(p.avgCbt)}</td>
            <td>${p.sessions}</td>
            <td>${p.attTotal ? scorePill(p.presentPct, '%') : '<span class="muted">–</span>'}</td>
            <td>${p.plans}</td>
            <td>${p.plansFixed}</td>
            <td class="actions"><button class="btn btn-sm btn-primary" data-course="${p.course.id}">Detail</button></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    box.querySelectorAll('[data-course]').forEach(b => b.addEventListener('click', () => {
      state.courseId = b.dataset.course;
      repaint();
    }));
    bindCsv(document.getElementById('rkKelasCsv'), 'rekap-kelas.csv',
      ['Kelas', 'Subtest', 'Kelas Utama', 'Tutor', 'Jadwal', 'Siswa', 'Materi', 'Modul', 'Rekaman', 'Tugas',
        'Terkumpul', 'Diharapkan', 'Belum Dinilai', 'CBT', 'Attempt', 'Rata Tugas', 'Rata CBT', 'Sesi',
        'Kehadiran %', 'Rencana', 'Fix', 'Diubah', 'Dibatalkan'],
      () => rows.map(p => [DB.courseTitle(p.course), p.course.subtest || '', (p.course.mainClasses || []).join(', '),
        DB.courseTeachers(p.course).map(t => t.name).join(' & '), DB.courseScheduleLabel(p.course),
        p.students, p.materials, p.modules, p.recordings, p.assignments, p.submissions, p.expectedSubs,
        p.ungraded, p.cbts, p.attempts, p.avgAsg ?? '', p.avgCbt ?? '', p.sessions, p.presentPct,
        p.plans, p.plansFixed, p.plansChanged, p.plansCancelled]));
  }

  function renderClassDetail(box, courseId, me, repaint) {
    const course = DB.getCourse(courseId);
    if (!course) { state.courseId = null; repaint(); return; }
    const p = courseStats(course);
    const students = p.studentIds.map(id => DB.getUser(id)).filter(Boolean);

    box.innerHTML = `
      <button class="btn btn-secondary btn-sm mb-1" id="rkBack">← Kembali ke Daftar Kelas</button>

      <div class="card">
        <div class="card-header">${UI.secHead('📚', DB.courseTitle(course), DB.courseScheduleLabel(course))}</div>
        <div class="table-wrap"><table class="table">
          <tbody>
            <tr><th>Subtest</th><td>${esc(course.subtest || '-')}</td></tr>
            <tr><th>Kelas Utama</th><td>${(course.mainClasses || []).map(m => `<span class="badge badge-secondary">${esc(m)}</span>`).join(' ') || '<span class="muted">–</span>'}</td></tr>
            <tr><th>Tutor</th><td>${DB.courseTeachers(course).map(t => `<span class="badge badge-info">${esc(t.name)}</span>`).join(' ') || '<span class="muted">–</span>'}</td></tr>
            <tr><th>Rencana Kelas</th><td>${p.plans} rencana • ${p.plansFixed} fix • ${p.plansChanged} diubah • ${p.plansCancelled} dibatalkan</td></tr>
          </tbody>
        </table></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Siswa</div><div class="value">${p.students}</div><div class="sub">${p.sessions} sesi tercatat</div></div>
        <div class="stat-card accent-warning"><div class="label">Kehadiran</div><div class="value">${p.attTotal ? p.presentPct + '%' : '–'}</div><div class="sub">${p.hadir}H ${p.izin}I ${p.sakit}S ${p.alfa}A</div></div>
        <div class="stat-card accent-success"><div class="label">Rata Tugas</div><div class="value">${p.avgAsg == null ? '–' : p.avgAsg}</div><div class="sub">${p.submissions}/${p.expectedSubs} terkumpul</div></div>
        <div class="stat-card accent-info"><div class="label">Rata CBT</div><div class="value">${p.avgCbt == null ? '–' : p.avgCbt}</div><div class="sub">${p.attempts} attempt • ${p.violations} pelanggaran</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🎓', `Siswa di Kelas Ini (${students.length})`, 'performa tiap siswa pada kelas ini')}${csvBtn('rkCdSiswaCsv')}</div>
        ${students.length === 0 ? emptyState('Belum ada siswa terdaftar.', '👨‍🎓') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Siswa</th><th>Kelas Utama</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Kehadiran</th><th>Tugas</th><th>Rata Tugas</th><th>CBT</th><th>Rata CBT</th><th>Aksi</th></tr></thead>
          <tbody>${students.map(s => {
            const att = DB.getAttendanceByUser(s.id).filter(a => a.role === 'siswa' && a.courseId === course.id);
            const asgIds = p.assignmentList.map(a => a.id);
            const subs = DB.getSubmissionsByStudent(s.id).filter(x => asgIds.includes(x.assignmentId));
            const graded = subs.filter(x => x.grade != null);
            const cbtIds = p.cbtList.map(c => c.id);
            const atts = DB.getCbtAttemptsByStudent(s.id).filter(a => cbtIds.includes(a.cbtId) && a.submittedAt);
            return `<tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${esc(s.kelas || '-')}</td>
              <td>${att.filter(a => a.status === 'hadir').length}</td>
              <td>${att.filter(a => a.status === 'izin').length}</td>
              <td>${att.filter(a => a.status === 'sakit').length}</td>
              <td>${att.filter(a => a.status === 'alfa').length}</td>
              <td>${att.length ? scorePill(pctOf(att.filter(a => a.status === 'hadir').length, att.length), '%') : '<span class="muted">–</span>'}</td>
              <td>${subs.length}/${p.assignments}</td>
              <td>${nOrDash(average(graded.map(x => x.grade)))}</td>
              <td>${atts.length}/${p.cbts}</td>
              <td>${nOrDash(average(atts.map(a => a.score)))}</td>
              <td class="actions"><button class="btn btn-sm btn-secondary" data-goto-student="${s.id}">Rekap</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;
    document.getElementById('rkBack').addEventListener('click', () => { state.courseId = null; repaint(); });
    box.querySelectorAll('[data-goto-student]').forEach(b => b.addEventListener('click', () => {
      state.tab = 'siswa';
      state.courseId = null;
      state.studentId = b.dataset.gotoStudent;
      const holder = document.querySelector('.subtabs');
      if (holder) holder.querySelectorAll('[data-rtab]').forEach(x => x.classList.toggle('active', x.dataset.rtab === 'siswa'));
      repaint();
    }));
    bindCsv(document.getElementById('rkCdSiswaCsv'), `rekap-kelas-${course.id}-siswa.csv`,
      ['Siswa', 'Kelas Utama'], () => students.map(s => [s.name, s.kelas || '']));
  }

  /* =====================================================================
   * Tab 5 — Per Subtest
   * ===================================================================*/
  function renderSubtestTable(box, me, sc, repaint) {
    const rows = DB.SUBTESTS.map(st => {
      const courses = sc.courses.filter(c => c.subtest === st.name || c.subtest === st.code || c.subtest === st.short);
      const per = courses.map(courseStats);
      const studentIds = new Set();
      per.forEach(x => x.studentIds.forEach(id => studentIds.add(id)));
      const questions = DB.getQuestions().filter(q => q.subject === st.name || q.subject === st.code || q.subject === st.short);
      // Skor subtest dari sectionScores semua attempt
      const scores = [];
      let correct = 0, total = 0;
      DB.getCbtAttempts().filter(a => a.submittedAt).forEach(a => {
        (a.sectionScores || []).forEach(sx => {
          if (sx.subtest !== st.name && sx.subtest !== st.code && sx.subtest !== st.short) return;
          if (sx.score != null) scores.push(sx.score);
          correct += Number(sx.correct) || 0;
          total += Number(sx.total) || 0;
        });
      });
      const tutors = new Set();
      courses.forEach(c => DB.courseTeacherIds(c).forEach(id => tutors.add(id)));
      const sum = k => per.reduce((n, x) => n + (x[k] || 0), 0);
      return {
        st, courses: courses.length, tutors: tutors.size, students: studentIds.size,
        materials: sum('materials'), modules: sum('modules'), assignments: sum('assignments'),
        cbts: sum('cbts'), questions: questions.length, plans: sum('plans'), plansFixed: sum('plansFixed'),
        avg: average(scores), acc: pctOf(correct, total), correct, total,
        presentPct: pctOf(sum('hadir'), sum('attTotal')), attTotal: sum('attTotal')
      };
    });

    box.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('🧩', '7 Subtest UTBK', 'agregat kelas, tutor, soal, dan capaian nilai tiap subtest')}
          ${csvBtn('rkSubtestCsv', 'Unduh CSV')}
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Subtest</th><th>Kelompok</th><th>Kelas</th><th>Tutor</th><th>Siswa</th>
            <th>Materi</th><th>Modul</th><th>Tugas</th><th>CBT</th><th>Bank Soal</th>
            <th>Rencana Fix</th><th>Benar/Soal</th><th>Akurasi</th><th>Rata Skor</th><th>Kehadiran</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${r.st.icon} ${esc(r.st.short)}</strong><div class="muted small">${esc(r.st.name)}</div></td>
            <td>${esc(r.st.group)}</td>
            <td>${r.courses}</td>
            <td>${r.tutors}</td>
            <td>${r.students}</td>
            <td>${r.materials}</td>
            <td>${r.modules}</td>
            <td>${r.assignments}</td>
            <td>${r.cbts}</td>
            <td>${r.questions}</td>
            <td>${r.plansFixed}/${r.plans}</td>
            <td>${r.total ? r.correct + '/' + r.total : '<span class="muted">–</span>'}</td>
            <td>${r.total ? r.acc + '%' : '<span class="muted">–</span>'}</td>
            <td>${scorePill(r.avg)}</td>
            <td>${r.attTotal ? r.presentPct + '%' : '<span class="muted">–</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
    bindCsv(document.getElementById('rkSubtestCsv'), 'rekap-subtest.csv',
      ['Subtest', 'Nama', 'Kelompok', 'Kelas', 'Tutor', 'Siswa', 'Materi', 'Modul', 'Tugas', 'CBT',
        'Bank Soal', 'Rencana', 'Fix', 'Benar', 'Soal', 'Akurasi %', 'Rata Skor', 'Kehadiran %'],
      () => rows.map(r => [r.st.short, r.st.name, r.st.group, r.courses, r.tutors, r.students,
        r.materials, r.modules, r.assignments, r.cbts, r.questions, r.plans, r.plansFixed,
        r.correct, r.total, r.acc, r.avg ?? '', r.presentPct]));
  }

  global.Rekap = {
    render,
    tutorStats, studentStats, courseStats,
    openTutor(id) { state.tab = 'tutor'; state.tutorId = id; state.studentId = null; state.courseId = null; },
    openStudent(id) { state.tab = 'siswa'; state.studentId = id; state.tutorId = null; state.courseId = null; },
    reset() { state.tab = 'ringkasan'; state.tutorId = state.studentId = state.courseId = null; }
  };
})(window);
