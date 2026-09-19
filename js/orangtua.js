/* ===== Panel Orang Tua / Wali =====
 * Read-only monitoring dashboard. Setiap data diambil langsung dari entitas
 * yang sama dengan panel siswa/guru/admin (enrollments, submissions, CBT,
 * absensi, pembayaran) sehingga selalu tersinkron.
 *
 * Satu akun orang tua dapat memantau beberapa anak (user.childIds).
 */
(function (global) {
  // Anak yang sedang dilihat (dipertahankan saat berpindah menu)
  let activeChildId = null;

  function render(container, section, user) {
    const children = DB.getChildren(user.id);

    if (children.length === 0) return renderNoChild(container, user);
    if (!activeChildId || !children.some(c => c.id === activeChildId)) {
      activeChildId = children[0].id;
    }

    // Halaman yang tidak terikat anak tertentu
    if (section === 'kalender') return Shared.renderCalendar(container, user);
    if (section === 'pengumuman') return Shared.renderAnnouncements(container, user);
    if (section === 'chat') return Shared.renderChat(container, user);
    if (section === 'feedback') return Shared.renderFeedback(container, user);
    if (section === 'profile') return renderProfile(container, user, children);

    // Halaman pemantauan: selalu diawali pemilih anak
    return paintChildPage(container, section, user, children);
  }

  function paintChildPage(container, section, user, children) {
    container.innerHTML = childSwitcherHtml(children);
    const body = document.createElement('div');
    body.id = 'ortuBody';
    container.appendChild(body);

    container.querySelectorAll('[data-child]').forEach(b => b.addEventListener('click', () => {
      activeChildId = b.dataset.child;
      paintChildPage(container, section, user, children);
    }));

    const child = DB.getUser(activeChildId);
    if (!child) {
      body.innerHTML = emptyState('Data anak tidak ditemukan.');
      return;
    }

    if (section === 'overview') renderOverview(body, user, child);
    else if (section === 'anak-nilai') renderNilai(body, child);
    else if (section === 'anak-absensi') renderAbsensi(body, child);
    else if (section === 'anak-tugas') renderTugas(body, child);
    else if (section === 'anak-kelas') renderKelas(body, child);
    else if (section === 'anak-perkembangan') renderPerkembangan(body, child);
    else if (section === 'keuangan') renderKeuangan(body, child);
    else body.innerHTML = emptyState('Halaman tidak dikenali.');

    if (global.Effects) Effects.enhance(container);
  }

  function childSwitcherHtml(children) {
    if (children.length === 1) {
      const c = children[0];
      return `<div class="child-switch">
        <div class="child-card is-active">
          <div class="avatar">${UI.initials(c.name)}</div>
          <div>
            <div class="nm">${UI.esc(c.name)}</div>
            <div class="mt">${UI.esc(c.kelas || '-')} • ${UI.esc(c.targetUniv || 'Target belum diisi')}</div>
          </div>
        </div>
      </div>`;
    }
    return `<div class="child-switch">
      ${children.map(c => `
        <button type="button" class="child-card ${activeChildId === c.id ? 'is-active' : ''}" data-child="${c.id}">
          <div class="avatar">${UI.initials(c.name)}</div>
          <div style="text-align:left;">
            <div class="nm">${UI.esc(c.name)}</div>
            <div class="mt">${UI.esc(c.kelas || '-')}</div>
          </div>
        </button>`).join('')}
    </div>`;
  }

  function renderNoChild(container, user) {
    container.innerHTML = `
      <section class="welcome-hero hero-parent">
        <span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">${UI.esc(UI.greeting())}</div>
          <h2>Selamat Datang, <span class="hl">${UI.esc(user.name)}</span></h2>
          <p class="wh-sub">Akun Anda belum dihubungkan dengan data siswa mana pun.</p>
        </div>
      </section>
      <div class="card">
        <div class="alert alert-info">
          Hubungi <strong>Admin</strong> untuk menghubungkan akun Anda dengan anak/siswa yang ingin dipantau.
          Setelah terhubung, Anda dapat melihat nilai, kehadiran, tugas, dan pembayaran secara real-time.
        </div>
      </div>`;
  }

  /* ================= OVERVIEW ================= */
  function renderOverview(el, user, child) {
    const st = Shared.studentStats(child.id);
    const courses = DB.getEnrollmentsByStudent(child.id).map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const payments = DB.getPaymentsByStudent(child.id);
    const unpaid = payments.filter(p => p.status !== 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
    const late = st.pendingAsg.filter(a => Date.now() > a.dueDate);

    // Indikator sederhana kondisi belajar anak
    const flags = [];
    if (st.attendanceTotal >= 3 && st.attendancePct < 75) flags.push(`Kehadiran baru ${st.attendancePct}% (di bawah 75%)`);
    if (late.length > 0) flags.push(`${late.length} tugas melewati deadline`);
    if (st.avgAsg != null && st.avgAsg < 60) flags.push(`Rata-rata nilai tugas rendah (${st.avgAsg})`);
    if (st.avgCbt != null && st.avgCbt < 50) flags.push(`Rata-rata skor CBT rendah (${st.avgCbt})`);
    if (unpaid > 0) flags.push(`Ada tagihan belum lunas sebesar ${UI.fmtRp(unpaid)}`);

    // Data masih terlalu sedikit untuk disimpulkan
    const thinData = st.attendanceTotal < 3 && st.submissions === 0 && st.cbtDone === 0;

    el.innerHTML = `
      <section class="welcome-hero hero-parent">
        <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">${UI.esc(UI.greeting())} • ${UI.esc(UI.fmtFullDateTime(UI.nowInTz()))}</div>
          <h2>Selamat Datang, <span class="hl">${UI.esc(user.name)}</span></h2>
          <p class="wh-sub">
            Anda memantau perkembangan <strong>${UI.esc(child.name)}</strong>${child.relation ? '' : ''} —
            ${child.targetUniv
              ? `Calon Mahasiswa <strong>${UI.esc(child.targetUniv)}</strong>${child.targetMajor ? ` (${UI.esc(child.targetMajor)})` : ''}.`
              : 'universitas impian belum diisi.'}
          </p>
          <div class="wh-chips">
            <span class="wh-chip">🏅 Level ${st.level} • ${st.points} poin</span>
            <span class="wh-chip">📋 Kehadiran ${st.attendancePct}%</span>
            <span class="wh-chip">📝 ${st.pendingAsg.length} tugas belum dikumpulkan</span>
            <span class="wh-chip">📚 ${courses.length} kelas</span>
          </div>
        </div>
      </section>

      ${flags.length ? `
      <div class="card">
        <div class="card-header">${UI.secHead('⚠️', 'Perlu Perhatian', 'Hal yang sebaiknya didiskusikan dengan anak Anda')}</div>
        <div class="alert alert-error" style="margin-bottom:0;">
          <ul style="margin:0;padding-left:18px;">${flags.map(f => `<li>${UI.esc(f)}</li>`).join('')}</ul>
        </div>
      </div>` : (thinData ? `
      <div class="card">
        <div class="alert alert-info" style="margin-bottom:0;">
          ℹ️ Data belajar ${UI.esc(child.name)} masih sedikit (${st.attendanceTotal} sesi presensi, ${st.submissions} tugas,
          ${st.cbtDone} ujian). Kesimpulan perkembangan akan lebih akurat setelah beberapa pertemuan berjalan.
        </div>
      </div>` : `
      <div class="card">
        <div class="alert alert-success" style="margin-bottom:0;">
          ✅ Perkembangan ${UI.esc(child.name)} terpantau baik. Terus berikan dukungan!
        </div>
      </div>`)}

      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Kehadiran</div><div class="value">${st.attendancePct}%</div><div class="sub">${st.attendanceCounts.hadir} hadir dari ${st.attendanceTotal} sesi</div></div>
        <div class="stat-card accent-primary"><div class="label">Rata-rata Tugas</div><div class="value">${st.avgAsg ?? '-'}</div><div class="sub">${st.gradedCount} tugas dinilai</div></div>
        <div class="stat-card accent-warning"><div class="label">Rata-rata CBT</div><div class="value">${st.avgCbt ?? '-'}</div><div class="sub">${st.cbtDone} ujian selesai</div></div>
        <div class="stat-card accent-danger"><div class="label">Tagihan</div><div class="value">${UI.fmtRp(unpaid)}</div><div class="sub">${unpaid > 0 ? 'belum lunas' : 'semua lunas ✓'}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📈', 'Ringkasan Capaian', 'Gambaran cepat performa belajar')}</div>
        <div class="stats-grid" style="margin-bottom:0;">
          <div class="stat-card" style="text-align:center;">
            ${UI.meterHtml(st.attendancePct)}
            <div class="label" style="margin:0;">Kehadiran</div>
          </div>
          <div class="stat-card" style="text-align:center;">
            ${UI.meterHtml(st.avgAsg ?? 0)}
            <div class="label" style="margin:0;">Nilai Tugas</div>
          </div>
          <div class="stat-card" style="text-align:center;">
            ${UI.meterHtml(st.avgCbt ?? 0)}
            <div class="label" style="margin:0;">Skor CBT</div>
          </div>
          <div class="stat-card" style="text-align:center;">
            ${UI.meterHtml(st.levelProgress)}
            <div class="label" style="margin:0;">Progres Level ${st.level}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🕒', 'Aktivitas Terbaru', `Rekam jejak ${UI.esc(child.name)}`)}</div>
        <div id="ortuTimeline"></div>
      </div>
    `;

    renderTimeline(document.getElementById('ortuTimeline'), child);
  }

  /** Gabungan submission, CBT, dan absensi menjadi satu feed kronologis. */
  function renderTimeline(box, child) {
    const items = [];
    DB.getSubmissionsByStudent(child.id).forEach(s => {
      const a = DB.getAssignment(s.assignmentId);
      const c = a ? DB.getCourse(a.courseId) : null;
      items.push({
        ts: s.submittedAt,
        title: s.grade != null ? `Tugas dinilai: ${s.grade}` : 'Mengumpulkan tugas',
        meta: `${a ? a.title : 'Tugas'}${c ? ' • ' + c.title : ''}`,
        body: s.feedback ? 'Catatan guru: ' + s.feedback : ''
      });
    });
    DB.getCbtAttemptsByStudent(child.id).filter(a => a.submittedAt).forEach(a => {
      const cbt = DB.getCbt(a.cbtId);
      items.push({
        ts: a.submittedAt,
        title: `Menyelesaikan ujian — skor ${a.score ?? 0}`,
        meta: cbt ? cbt.title : 'CBT',
        body: `${a.correctCount ?? 0} benar dari ${a.totalCount ?? 0} soal`
      });
    });
    DB.getAttendanceByUser(child.id).filter(a => a.role === 'siswa').forEach(a => {
      const c = DB.getCourse(a.courseId);
      items.push({
        ts: new Date(a.date + 'T08:00:00').getTime(),
        title: `Presensi: ${a.status.toUpperCase()}`,
        meta: `${c ? c.title : 'Kelas'} • ${UI.fmtYMD(a.date)}`,
        body: a.note || ''
      });
    });

    const sorted = items.filter(i => i.ts).sort((a, b) => b.ts - a.ts).slice(0, 15);
    if (sorted.length === 0) {
      box.innerHTML = emptyState('Belum ada aktivitas tercatat.');
      return;
    }
    box.innerHTML = `<div class="timeline">
      ${sorted.map((i, idx) => `
        <div class="tl-item" style="animation-delay:${Math.min(0.4, idx * 0.04)}s;">
          <div class="tl-title">${UI.esc(i.title)}</div>
          <div class="tl-meta">${UI.esc(i.meta)} • ${UI.fmtRelative(i.ts)}</div>
          ${i.body ? `<div class="tl-body">${UI.esc(i.body)}</div>` : ''}
        </div>`).join('')}
    </div>`;
  }

  /* ================= NILAI & UJIAN ================= */
  function renderNilai(el, child) {
    const subs = DB.getSubmissionsByStudent(child.id).slice().sort((a, b) => b.submittedAt - a.submittedAt);
    const graded = subs.filter(s => s.grade != null);
    const avg = graded.length ? Math.round(graded.reduce((a, s) => a + s.grade, 0) / graded.length) : null;
    const best = graded.length ? Math.max(...graded.map(s => s.grade)) : null;
    const attempts = DB.getCbtAttemptsByStudent(child.id).filter(a => a.submittedAt)
      .slice().sort((a, b) => b.submittedAt - a.submittedAt);
    const avgCbt = attempts.length ? Math.round(attempts.reduce((a, x) => a + (x.score || 0), 0) / attempts.length) : null;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Rata-rata Tugas</div><div class="value">${avg ?? '-'}</div></div>
        <div class="stat-card accent-success"><div class="label">Nilai Terbaik</div><div class="value">${best ?? '-'}</div></div>
        <div class="stat-card accent-warning"><div class="label">Rata-rata CBT</div><div class="value">${avgCbt ?? '-'}</div></div>
        <div class="stat-card accent-danger"><div class="label">Menunggu Nilai</div><div class="value">${subs.length - graded.length}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🏆', 'Nilai Tugas', `${UI.esc(child.name)} • ${subs.length} submission`)}</div>
        ${subs.length === 0 ? emptyState('Belum ada tugas yang dikumpulkan.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Dikumpulkan</th><th>Nilai</th><th>Catatan Guru</th></tr></thead>
          <tbody>${subs.map(s => {
            const a = DB.getAssignment(s.assignmentId);
            const c = a ? DB.getCourse(a.courseId) : null;
            return `<tr>
              <td><strong>${UI.esc(a ? a.title : '-')}</strong></td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td>${UI.fmtDateTime(s.submittedAt)}</td>
              <td>${s.grade == null ? '<span class="badge badge-warning">Menunggu</span>' : `<strong>${s.grade}</strong>`}</td>
              <td class="muted small">${UI.esc(s.feedback || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🖥️', 'Hasil Ujian CBT', `${attempts.length} ujian diselesaikan`)}</div>
        ${attempts.length === 0 ? emptyState('Belum ada ujian yang diselesaikan.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Ujian</th><th>Kelas</th><th>Tanggal</th><th>Benar</th><th>Skor</th></tr></thead>
          <tbody>${attempts.map(at => {
            const cbt = DB.getCbt(at.cbtId);
            const c = cbt ? DB.getCourse(cbt.courseId) : null;
            const tone = (at.score || 0) >= 75 ? 'var(--success)' : ((at.score || 0) >= 50 ? 'var(--warning)' : 'var(--danger)');
            return `<tr>
              <td><strong>${UI.esc(cbt ? cbt.title : '-')}</strong></td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td>${UI.fmtDateTime(at.submittedAt)}</td>
              <td>${at.correctCount ?? 0}/${at.totalCount ?? 0}</td>
              <td><strong style="color:${tone};">${at.score ?? 0}</strong></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;
  }

  /* ================= KEHADIRAN ================= */
  function renderAbsensi(el, child) {
    const att = DB.getAttendanceByUser(child.id).filter(a => a.role === 'siswa')
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    const counts = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
    att.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
    const pct = att.length ? Math.round(counts.hadir / att.length * 100) : 0;

    const courses = DB.getEnrollmentsByStudent(child.id).map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const perCourse = courses.map(c => {
      const list = att.filter(a => a.courseId === c.id);
      const local = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
      list.forEach(a => { local[a.status] = (local[a.status] || 0) + 1; });
      return { c, local, total: list.length, pct: list.length ? Math.round(local.hadir / list.length * 100) : 0 };
    });

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Hadir</div><div class="value">${counts.hadir}</div></div>
        <div class="stat-card accent-primary"><div class="label">Izin</div><div class="value">${counts.izin}</div></div>
        <div class="stat-card accent-warning"><div class="label">Sakit</div><div class="value">${counts.sakit}</div></div>
        <div class="stat-card accent-danger"><div class="label">Alfa</div><div class="value">${counts.alfa}</div></div>
      </div>

      <div class="card" style="text-align:center;">
        ${UI.meterHtml(pct)}
        <div class="muted">Persentase kehadiran ${UI.esc(child.name)} dari ${att.length} sesi tercatat</div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📊', 'Kehadiran per Kelas', 'Perbandingan antar kelas yang diikuti')}</div>
        ${perCourse.length === 0 ? emptyState('Belum ada kelas.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Kelas</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Total</th><th>Kehadiran</th></tr></thead>
          <tbody>${perCourse.map(r => `<tr>
            <td><strong>${UI.esc(r.c.title)}</strong></td>
            <td>${r.local.hadir}</td><td>${r.local.izin}</td><td>${r.local.sakit}</td><td>${r.local.alfa}</td>
            <td>${r.total}</td>
            <td style="min-width:150px;">${UI.progressHtml(r.pct, '', 'auto')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📋', 'Riwayat Kehadiran', 'Diperbarui otomatis setiap guru mengisi presensi')}</div>
        ${att.length === 0 ? emptyState('Belum ada data kehadiran.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${att.map(a => {
            const c = DB.getCourse(a.courseId);
            return `<tr>
              <td>${UI.fmtYMD(a.date)}</td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td><span class="status-${a.status}">${a.status.toUpperCase()}</span></td>
              <td class="muted small">${UI.esc(a.note || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;
  }

  /* ================= TUGAS ================= */
  function renderTugas(el, child) {
    const enrolled = DB.getEnrollmentsByStudent(child.id).map(e => e.courseId);
    const all = DB.getAssignments().filter(a => enrolled.includes(a.courseId))
      .slice().sort((a, b) => a.dueDate - b.dueDate);
    const subs = DB.getSubmissionsByStudent(child.id);
    const byAsg = new Map(subs.map(s => [s.assignmentId, s]));
    const done = all.filter(a => byAsg.has(a.id)).length;
    const overdue = all.filter(a => !byAsg.has(a.id) && Date.now() > a.dueDate).length;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Tugas</div><div class="value">${all.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Dikumpulkan</div><div class="value">${done}</div></div>
        <div class="stat-card accent-warning"><div class="label">Belum</div><div class="value">${all.length - done}</div></div>
        <div class="stat-card accent-danger"><div class="label">Lewat Deadline</div><div class="value">${overdue}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📝', 'Daftar Tugas', `Progres pengumpulan ${UI.esc(child.name)}`)}</div>
        ${UI.progressHtml(all.length ? Math.round(done / all.length * 100) : 0, 'Tugas terkumpul')}
        <div class="mt-2">
        ${all.length === 0 ? emptyState('Belum ada tugas dari kelas yang diikuti.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Deadline</th><th>Status</th><th>Nilai</th></tr></thead>
          <tbody>${all.map(a => {
            const c = DB.getCourse(a.courseId);
            const s = byAsg.get(a.id);
            let status = '<span class="badge badge-info">Belum Dikerjakan</span>';
            if (s && s.grade != null) status = '<span class="badge badge-success">Selesai & Dinilai</span>';
            else if (s) status = '<span class="badge badge-warning">Menunggu Penilaian</span>';
            else if (Date.now() > a.dueDate) status = '<span class="badge badge-warning">Terlambat</span>';
            return `<tr>
              <td><strong>${UI.esc(a.title)}</strong><div class="muted small">${UI.esc(a.description || '')}</div></td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td>${UI.fmtDate(a.dueDate)}</td>
              <td>${status}</td>
              <td>${s && s.grade != null ? `<strong>${s.grade}</strong>` : '-'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
        </div>
      </div>
    `;
  }

  /* ================= KELAS & GURU ================= */
  function renderKelas(el, child) {
    const enrollments = DB.getEnrollmentsByStudent(child.id);
    const courses = enrollments.map(e => ({ e, c: DB.getCourse(e.courseId) })).filter(x => x.c);

    el.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead('📚', `Kelas yang Diikuti (${courses.length})`, 'Beserta guru pengajar dan kontaknya')}</div>
        ${courses.length === 0 ? emptyState('Belum tergabung ke kelas manapun.') : `
        <div class="course-grid">
          ${courses.map(({ e, c }, i) => {
            const t = DB.getUser(c.teacherId);
            const att = DB.getAttendanceByCourse(c.id).filter(a => a.userId === child.id);
            const pct = att.length ? Math.round(att.filter(a => a.status === 'hadir').length / att.length * 100) : 0;
            return `<div class="course-card">
              <div class="course-banner ${UI.bannerClass(i)}">${UI.esc((c.title || '?').slice(0, 1).toUpperCase())}</div>
              <div class="course-body">
                <h4>${UI.esc(c.title)}</h4>
                <div class="meta">${UI.esc(c.category || 'Umum')} • Guru: ${UI.esc(t ? t.name : '-')}</div>
                <p>${UI.esc(c.description || '')}</p>
                <div class="muted small">Bergabung ${UI.fmtDate(e.enrolledAt)}</div>
                <div class="mt-1">${UI.progressHtml(pct, 'Kehadiran di kelas ini', 'auto')}</div>
              </div>
              <div class="course-footer">
                <span>${DB.getMaterialsByCourse(c.id).length} materi • ${DB.getAssignmentsByCourse(c.id).length} tugas</span>
                ${t ? `<button class="btn btn-sm btn-secondary" data-chat-teacher="${t.id}">💭 Hubungi</button>` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>`}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍🏫', 'Guru Pengajar', 'Klik Hubungi untuk membuka menu Chat Guru')}</div>
        ${courses.length === 0 ? emptyState('Belum ada guru terkait.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Guru</th><th>Subtest / Mapel</th><th>Kelas</th><th>Kontak</th></tr></thead>
          <tbody>${courses.map(({ c }) => {
            const t = DB.getUser(c.teacherId);
            if (!t) return '';
            return `<tr>
              <td><strong>${UI.esc(t.name)}</strong></td>
              <td>${UI.esc(t.subject || '-')}</td>
              <td>${UI.esc(c.title)}</td>
              <td class="muted small">${UI.esc(t.email || '-')}${t.whatsapp ? ' • ' + UI.esc(t.whatsapp) : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>
    `;

    el.querySelectorAll('[data-chat-teacher]').forEach(b => b.addEventListener('click', () => {
      UI.toast('Membuka menu Chat Guru...', 'info');
      Dashboard.navigate('chat');
    }));
  }

  /* ================= PERKEMBANGAN ================= */
  function renderPerkembangan(el, child) {
    const st = Shared.studentStats(child.id);
    const attempts = DB.getCbtAttemptsByStudent(child.id).filter(a => a.submittedAt)
      .slice().sort((a, b) => a.submittedAt - b.submittedAt);
    const graded = DB.getSubmissionsByStudent(child.id).filter(s => s.grade != null)
      .slice().sort((a, b) => a.submittedAt - b.submittedAt);

    // Tren sederhana: bandingkan paruh awal vs paruh akhir
    const trend = (arr, pick) => {
      if (arr.length < 2) return null;
      const mid = Math.floor(arr.length / 2);
      const avgOf = (xs) => Math.round(xs.reduce((a, x) => a + pick(x), 0) / xs.length);
      return avgOf(arr.slice(mid)) - avgOf(arr.slice(0, mid));
    };
    const cbtTrend = trend(attempts, a => a.score || 0);
    const asgTrend = trend(graded, s => s.grade);
    const trendBadge = (v) => {
      if (v == null) return '<span class="badge badge-gray">Data belum cukup</span>';
      if (v > 3) return `<span class="badge badge-success">↑ Naik ${v} poin</span>`;
      if (v < -3) return `<span class="badge badge-warning">↓ Turun ${Math.abs(v)} poin</span>`;
      return '<span class="badge badge-info">→ Stabil</span>';
    };

    const maxBar = 100;
    const bars = (rows) => rows.length === 0
      ? emptyState('Belum ada data.')
      : `<div style="display:flex;align-items:flex-end;gap:10px;height:170px;padding:10px 0;">
          ${rows.map((r, i) => `
            <div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px;min-width:34px;">
              <strong style="font-size:12px;">${r.v}</strong>
              <div title="${UI.esc(r.label)}" style="width:100%;border-radius:8px 8px 0 0;
                   background:linear-gradient(180deg,var(--primary),var(--accent));
                   height:${Math.max(4, Math.round(r.v / maxBar * 120))}px;
                   animation:fadeInUp .5s var(--ease) both;animation-delay:${(i * 0.06).toFixed(2)}s;"></div>
              <span class="muted small" style="font-size:10px;text-align:center;">${UI.esc(r.short)}</span>
            </div>`).join('')}
        </div>`;

    el.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Level Saat Ini</div><div class="value">${st.level}</div><div class="sub">${st.points} poin aktivitas</div></div>
        <div class="stat-card accent-success"><div class="label">Tren Nilai Tugas</div><div class="value" style="font-size:16px;">${trendBadge(asgTrend)}</div></div>
        <div class="stat-card accent-warning"><div class="label">Tren Skor CBT</div><div class="value" style="font-size:16px;">${trendBadge(cbtTrend)}</div></div>
        <div class="stat-card accent-danger"><div class="label">Tugas Tertunda</div><div class="value">${st.pendingAsg.length}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📊', 'Grafik Skor CBT', 'Urut dari ujian terlama ke terbaru')}</div>
        ${bars(attempts.map((a, i) => {
          const cbt = DB.getCbt(a.cbtId);
          return { v: a.score || 0, label: cbt ? cbt.title : 'Ujian ' + (i + 1), short: 'U' + (i + 1) };
        }))}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('📈', 'Grafik Nilai Tugas', 'Urut dari tugas terlama ke terbaru')}</div>
        ${bars(graded.map((s, i) => {
          const a = DB.getAssignment(s.assignmentId);
          return { v: s.grade, label: a ? a.title : 'Tugas ' + (i + 1), short: 'T' + (i + 1) };
        }))}
      </div>

      ${Shared.achievementsHtml(st)}

      <div class="card">
        <div class="card-header">${UI.secHead('💡', 'Saran untuk Orang Tua', 'Dihitung dari data belajar anak')}</div>
        <ul style="margin:0;padding-left:20px;color:var(--gray-700);font-size:14px;line-height:1.9;">
          ${st.attendancePct < 80 ? '<li>Bantu pastikan anak mengikuti sesi kelas secara rutin — kehadiran masih di bawah 80%.</li>' : '<li>Kehadiran sudah baik, pertahankan rutinitas belajarnya.</li>'}
          ${st.pendingAsg.length > 0 ? `<li>Ada ${st.pendingAsg.length} tugas belum dikumpulkan. Ajak anak menyusun jadwal pengerjaan.</li>` : '<li>Semua tugas terkumpul — apresiasi kedisiplinannya.</li>'}
          ${st.avgCbt != null && st.avgCbt < 60 ? '<li>Skor CBT masih perlu ditingkatkan. Dorong anak memakai menu AI Tools untuk latihan terarah.</li>' : '<li>Hasil CBT cukup baik, dorong anak menaikkan target skor.</li>'}
          ${child.targetUniv ? `<li>Target kampus: <strong>${UI.esc(child.targetUniv)}</strong>${child.targetMajor ? ' — ' + UI.esc(child.targetMajor) : ''}. Diskusikan progresnya secara berkala.</li>` : '<li>Universitas impian belum diisi. Ajak anak menentukan target kampusnya.</li>'}
        </ul>
      </div>
    `;
  }

  /* ================= PEMBAYARAN ================= */
  function renderKeuangan(el, child) {
    const payments = DB.getPaymentsByStudent(child.id).slice().sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
    const paid = payments.filter(p => p.status === 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
    const pending = payments.filter(p => p.status !== 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
    const courses = DB.getEnrollmentsByStudent(child.id).map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const billed = courses.reduce((s, c) => s + (c.price || 0), 0);

    el.innerHTML = `
      <div class="finance-summary">
        <div class="fin-card income"><div class="label">Total Terbayar</div><div class="value">${UI.fmtRp(paid)}</div></div>
        <div class="fin-card expense"><div class="label">Belum Lunas</div><div class="value">${UI.fmtRp(pending)}</div></div>
        <div class="fin-card profit"><div class="label">Estimasi Tagihan Kelas</div><div class="value">${UI.fmtRp(billed)}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('💰', 'Riwayat Pembayaran', `Tagihan dan pembayaran ${UI.esc(child.name)}`)}</div>
        ${payments.length === 0 ? emptyState('Belum ada transaksi pembayaran.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas / Keterangan</th><th>Jumlah</th><th>Metode</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${payments.map(p => {
            const c = p.courseId ? DB.getCourse(p.courseId) : null;
            return `<tr>
              <td>${UI.fmtDate(p.paidAt || p.createdAt)}</td>
              <td>${UI.esc(c ? c.title : 'Umum')}</td>
              <td><strong>${UI.fmtRp(p.amount)}</strong></td>
              <td>${UI.esc(p.method || '-')}</td>
              <td>${p.status === 'lunas' ? '<span class="badge badge-success">Lunas</span>' : '<span class="badge badge-warning">' + UI.esc(p.status || '-') + '</span>'}</td>
              <td class="muted small">${UI.esc(p.note || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="alert alert-info" style="margin-bottom:0;">
          Pembayaran dicatat oleh Admin pada menu Keuangan. Bila ada selisih data, silakan hubungi admin melalui menu Chat.
        </div>
      </div>
    `;
  }

  /* ================= PROFIL ORANG TUA ================= */
  function renderProfile(container, user, children) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead('👤', 'Profil Orang Tua / Wali', 'Perbarui data kontak Anda')}</div>
        <form id="ortuProfileForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Nama</label>
              <input name="name" required value="${UI.esc(user.name)}" /></div>
            <div class="form-group"><label>Username</label>
              <input value="${UI.esc(user.username)}" readonly /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Email</label>
              <input name="email" type="email" value="${UI.esc(user.email || '')}" /></div>
            <div class="form-group"><label>No. Telepon</label>
              <input name="phone" value="${UI.esc(user.phone || '')}" placeholder="08xxxxxxxxxx" /></div>
          </div>
          <div class="form-group"><label>Hubungan dengan Siswa</label>
            <select name="relation">
              ${['Ayah', 'Ibu', 'Wali', 'Kakak', 'Lainnya'].map(r =>
                `<option value="${r}" ${(user.relation || 'Wali') === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Password Baru (kosongkan jika tidak diubah)</label>
            <input name="password" type="password" minlength="6" /></div>
          <button class="btn btn-primary" type="submit">Simpan Perubahan</button>
        </form>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👨‍👩‍👦', `Anak yang Dipantau (${children.length})`, 'Hubungan akun diatur oleh Admin')}</div>
        ${children.length === 0 ? emptyState('Belum ada anak terhubung.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Kelas</th><th>Universitas Impian</th><th>Kelas Diikuti</th><th>Status</th></tr></thead>
          <tbody>${children.map(c => `<tr>
            <td><strong>${UI.esc(c.name)}</strong><div class="muted small">${UI.esc(c.email || '-')}</div></td>
            <td>${UI.esc(c.kelas || '-')}</td>
            <td>${UI.esc(c.targetUniv || '-')}${c.targetMajor ? '<div class="muted small">' + UI.esc(c.targetMajor) + '</div>' : ''}</td>
            <td>${DB.getEnrollmentsByStudent(c.id).length}</td>
            <td><span class="badge ${(c.status || 'Aktif') === 'Aktif' ? 'badge-success' : 'badge-warning'}">${UI.esc(c.status || 'Aktif')}</span></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;

    document.getElementById('ortuProfileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {
        name: fd.get('name').trim(),
        email: (fd.get('email') || '').trim(),
        phone: (fd.get('phone') || '').trim(),
        relation: fd.get('relation')
      };
      const pw = fd.get('password');
      if (pw) patch.password = pw;
      DB.updateUser(user.id, patch);
      UI.toast('Profil diperbarui.');
      setTimeout(() => location.reload(), 500);
    });
  }

  function emptyState(msg) {
    return `<div class="empty"><div class="empty-icon">📭</div>${UI.esc(msg)}</div>`;
  }

  global.OrangtuaPanel = { render };
})(window);
