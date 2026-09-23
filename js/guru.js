/* ===== Guru Panel =====
 * Manage own courses, materials, assignments, grade submissions.
 */
(function (global) {
  let currentCourseId = null;

  /* Lencana "oleh <tutor>" + penjelasan bila konten dikunci tutor lain. */
  function credit(rec, course) {
    return global.ContentEditor ? ContentEditor.creditHtml(rec, course) : '';
  }

  /**
   * Tombol Edit/Hapus hanya untuk pemilik konten (atau admin).
   * Satu kelas bisa punya beberapa tutor, tetapi konten adalah tanggung
   * jawab tutor yang membuatnya, jadi tutor lain tidak boleh mengubahnya.
   */
  function ownerActionsHtml(user, rec, course, editAttr, delAttr) {
    if (DB.canManageContent(user, rec, course)) {
      return `<button class="btn btn-sm btn-secondary" ${editAttr}="${rec.id}">Edit</button>
              <button class="btn btn-sm btn-danger" ${delAttr}="${rec.id}">Hapus</button>`;
    }
    const owner = DB.contentOwnerName(rec, course);
    return `<span class="lock-note">🔒 Hanya ${UI.esc(owner || 'tutor pembuat')} yang dapat mengubah ini</span>`;
  }

  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container, user);
    if (section === 'courses') {
      if (currentCourseId) return renderCourseDetail(container, user);
      return renderMyCourses(container, user);
    }
    if (section === 'modul') return renderModulSection(container, user);
    if (section === 'rekaman') return renderRekamanSection(container, user);
    // Bank soal & CBT memakai workspace khusus bersama (js/cbt.js)
    if (section === 'bank-soal') return CbtAdmin.renderBankHome(container, user);
    if (section === 'cbt') return CbtAdmin.renderCbtHome(container, user);
    if (section === 'grading') return renderGrading(container, user);
    if (section === 'absensi') return renderAbsensiSection(container, user);
    if (section === 'jadwal-kelas') return Jadwal.renderJadwalPage(container, user);
    if (section === 'rekap') return Rekap.render(container, user);
    if (section === 'leaderboard') return Shared.renderLeaderboard(container, user);
    if (section === 'kalender') return Shared.renderCalendar(container, user);
    if (section === 'pengumuman') return Shared.renderAnnouncements(container, user);
    if (section === 'feedback') return Shared.renderFeedback(container, user);
    if (section === 'chat') return Shared.renderChat(container, user);
    if (section === 'ai-analytics') return Shared.renderAiAnalytics(container, user);
    if (section === 'keuangan') return renderHonorSection(container, user);
    if (section === 'profile') return renderProfile(container, user);
  }

  function renderOverview(container, user) {
    const myCourses = DB.getCoursesByTeacher(user.id);
    const myCourseIds = myCourses.map(c => c.id);
    const myAssignments = DB.getAssignments().filter(a => myCourseIds.includes(a.courseId));
    const mySubs = DB.getSubmissions().filter(s => myAssignments.some(a => a.id === s.assignmentId));
    const ungraded = mySubs.filter(s => s.grade == null);
    const studentSet = new Set();
    myCourseIds.forEach(cid => DB.getEnrollmentsByCourse(cid).forEach(e => studentSet.add(e.studentId)));

    const todayAtt = DB.getAttendanceByUser(user.id).filter(a => a.date === UI.todayYMD() && a.role === 'guru');

    container.innerHTML = `
      <section class="welcome-hero hero-guru">
        <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">${UI.esc(UI.greeting())} • ${UI.esc(UI.fmtFullDateTime(UI.nowInTz()))}</div>
          <h2>Selamat Datang, <span class="hl">${UI.esc(user.name)}</span></h2>
          <p class="wh-sub">Pengajar ${UI.esc(user.subject || 'Rubela')} — terima kasih telah membimbing para calon mahasiswa.</p>
          <div class="wh-chips">
            <span class="wh-chip">📚 ${myCourses.length} kelas</span>
            <span class="wh-chip">👨‍🎓 ${studentSet.size} siswa</span>
            <span class="wh-chip">✅ ${ungraded.length} perlu dinilai</span>
            <span class="wh-chip">📋 Presensi hari ini: ${todayAtt.length ? 'sudah' : 'belum'}</span>
          </div>
          <div class="wh-cta flex-gap">
            <button class="btn btn-ghost btn-sm" id="heroAbsen">Ambil Presensi</button>
            <button class="btn btn-ghost btn-sm" id="heroGrade">Nilai Tugas</button>
          </div>
        </div>
      </section>

      ${Shared.motivationHtml('guru')}

      <div class="stats-grid">
        <div class="stat-card accent-primary">
          <div class="label">Kelas Saya</div>
          <div class="value">${myCourses.length}</div>
        </div>
        <div class="stat-card accent-success">
          <div class="label">Total Siswa</div>
          <div class="value">${studentSet.size}</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Tugas Dibuat</div>
          <div class="value">${myAssignments.length}</div>
        </div>
        <div class="stat-card accent-danger">
          <div class="label">Perlu Dinilai</div>
          <div class="value">${ungraded.length}</div>
          <div class="sub">${ungraded.length > 0 ? 'Buka menu Penilaian' : 'Semua sudah dinilai ✓'}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Kelas Saya</h3>
          <button class="btn btn-primary btn-sm" id="newCourseBtn">+ Buat Kelas Baru</button>
        </div>
        ${myCourses.length === 0 ? emptyState('Belum ada kelas. Yuk buat kelas pertamamu!') :
          `<div class="course-grid">${myCourses.map((c, i) => courseCard(c, i, true)).join('')}</div>`}
      </div>
    `;
    document.getElementById('newCourseBtn').addEventListener('click', () => openCourseForm(user));
    document.getElementById('heroAbsen').addEventListener('click', () => Dashboard.navigate('absensi'));
    document.getElementById('heroGrade').addEventListener('click', () => Dashboard.navigate('grading'));
    bindCourseCards(container, user);
  }

  function renderMyCourses(container, user) {
    const myCourses = DB.getCoursesByTeacher(user.id);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Semua Kelas Saya (${myCourses.length})</h3>
          <button class="btn btn-primary btn-sm" id="newCourseBtn">+ Buat Kelas Baru</button>
        </div>
        ${myCourses.length === 0 ? emptyState('Belum ada kelas.') :
          `<div class="course-grid">${myCourses.map((c, i) => courseCard(c, i, true)).join('')}</div>`}
      </div>
    `;
    document.getElementById('newCourseBtn').addEventListener('click', () => openCourseForm(user));
    bindCourseCards(container, user);
  }

  function courseCard(c, idx, ownerActions) {
    const t = DB.getUser(c.teacherId);
    const count = DB.getEnrollmentsByCourse(c.id).length;
    const locked = DB.hasCoursePassword(c.id);
    return `
      <div class="course-card">
        <div class="course-banner ${UI.bannerClass(idx)}">
          ${UI.esc((c.title || '?').slice(0, 1).toUpperCase())}
          <span class="lock-chip">${locked ? '🔒 Terkunci' : '🔓 Terbuka'}</span>
        </div>
        <div class="course-body">
          <h4>${UI.esc(c.title)}</h4>
          <div class="meta">${UI.esc(c.category || 'Umum')} • oleh ${UI.esc(t ? t.name : '-')}</div>
          <p>${UI.esc(c.description)}</p>
          ${locked ? `<div class="muted small">Password kelas: <strong>${UI.esc(c.password)}</strong></div>` : ''}
        </div>
        <div class="course-footer">
          <span>${count} siswa</span>
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" data-open="${c.id}">Buka</button>
            ${ownerActions ? `<button class="btn btn-sm btn-secondary" data-course-pw="${c.id}" title="Atur password kelas">🔒</button>` : ''}
            ${ownerActions ? `<button class="btn btn-sm btn-danger" data-delete-course="${c.id}">Hapus</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function bindCourseCards(container, user) {
    container.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      currentCourseId = b.dataset.open;
      Dashboard.navigate('courses');
    }));
    container.querySelectorAll('[data-course-pw]').forEach(b => b.addEventListener('click', () => {
      Shared.openCoursePasswordForm(b.dataset.coursePw, () => Dashboard.navigate('courses'));
    }));
    container.querySelectorAll('[data-delete-course]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus kelas ini? Materi, tugas, dan submission juga akan dihapus.')) return;
      DB.deleteCourse(b.dataset.deleteCourse);
      UI.toast('Kelas dihapus.');
      render(container, 'courses', user);
    }));
  }

  function openCourseForm(user, editId) {
    const editing = editId ? DB.getCourse(editId) : null;
    // Judul kelas: pilih subtest UTBK, atau "Lainnya" untuk diketik manual
    const isPreset = editing ? DB.SUBTEST_NAMES.includes(editing.title) : false;
    const body = `
      <form id="courseForm" class="form">
        <div class="form-group">
          <label>Judul Kelas</label>
          <select name="titlePreset" id="gTitlePreset">
            <option value="">-- Pilih Subtest UTBK --</option>
            ${DB.SUBTESTS.map(s => `<option value="${UI.esc(s.name)}" ${isPreset && editing.title === s.name ? 'selected' : ''}>${s.icon} ${UI.esc(s.name)}</option>`).join('')}
            <option value="__OTHER__" ${editing && !isPreset ? 'selected' : ''}>✏️ Lainnya (tulis manual)</option>
          </select>
        </div>
        <div class="form-group ${editing && !isPreset ? '' : 'hidden'}" id="gTitleCustomBox">
          <label>Judul Kelas (manual)</label>
          <input name="titleCustom" id="gTitleCustom" value="${UI.esc(editing && !isPreset ? editing.title : '')}" placeholder="mis. Kelas Intensif Saintek" />
        </div>
        <div class="form-row">
          <div class="form-group"><label>Kategori</label>
            <input name="category" value="${UI.esc(editing?.category || '')}" placeholder="mis. Matematika" /></div>
          <div class="form-group"><label>Biaya / SPP (Rp)</label>
            <input name="price" type="number" min="0" value="${editing?.price || 0}" /></div>
        </div>
        <div class="form-group"><label>Deskripsi</label>
          <textarea name="description" required>${UI.esc(editing?.description || '')}</textarea></div>
        <div class="form-group">
          <label>🔒 Password Kelas (untuk "Jelajah Kelas")</label>
          <input name="password" value="${UI.esc(editing?.password || '')}" placeholder="Kosongkan bila kelas terbuka tanpa password" />
          <p class="muted small" style="margin:6px 0 0;">Siswa harus memasukkan password ini bila bergabung sendiri dari halaman
          <strong>Jelajah Kelas</strong>. Admin dan Anda dapat mengubahnya kapan saja.</p>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Kelas' : 'Buat Kelas Baru', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    const gPreset = document.getElementById('gTitlePreset');
    const gCustomBox = document.getElementById('gTitleCustomBox');
    const gCustom = document.getElementById('gTitleCustom');
    const gSync = () => {
      const other = gPreset.value === '__OTHER__';
      gCustomBox.classList.toggle('hidden', !other);
      gCustom.required = other;
      if (other) setTimeout(() => gCustom.focus(), 50);
    };
    gPreset.addEventListener('change', gSync);
    gSync();

    document.getElementById('courseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const preset = fd.get('titlePreset');
      const title = preset === '__OTHER__' ? (fd.get('titleCustom') || '').trim() : (preset || '').trim();
      if (!title) {
        UI.toast('Pilih subtest atau tulis judul kelas secara manual.', 'error');
        return;
      }
      const payload = {
        title,
        category: fd.get('category').trim(),
        price: Number(fd.get('price') || 0),
        description: fd.get('description').trim(),
        password: (fd.get('password') || '').trim()
      };
      if (editing) {
        DB.updateCourse(editing.id, payload);
        UI.toast('Kelas diperbarui.');
      } else {
        payload.teacherId = user.id;
        DB.addCourse(payload);
        UI.toast('Kelas dibuat.');
      }
      UI.modal.close();
      Dashboard.navigate('courses');
    });
  }

  function renderCourseDetail(container, user) {
    const course = DB.getCourse(currentCourseId);
    // Kelas subtest bisa diampu beberapa tutor: periksa seluruh daftar tutor,
    // bukan hanya teacherId lama, agar tutor kedua tidak tertolak.
    if (!course || !DB.courseTeacherIds(course).includes(user.id)) {
      currentCourseId = null;
      return renderMyCourses(container, user);
    }
    const materials = DB.getMaterialsByCourse(course.id);
    const assignments = DB.getAssignmentsByCourse(course.id);
    const enrollments = DB.getEnrollmentsByCourse(course.id);

    container.innerHTML = `
      <div class="flex-between mb-2">
        <button class="btn btn-secondary btn-sm" id="backBtn">← Kembali</button>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="coursePwBtn">🔒 Password Kelas</button>
          <button class="btn btn-secondary btn-sm" id="editCourseBtn">Edit Kelas</button>
        </div>
      </div>

      <div class="card">
        <div class="flex-between mb-1">
          <div>
            <h3 class="mt-0">${UI.esc(course.title)}</h3>
            <div class="muted small">${UI.esc(course.category || 'Umum')} • ${enrollments.length} siswa</div>
          </div>
          <span class="badge ${DB.hasCoursePassword(course.id) ? 'badge-warning' : 'badge-gray'}">
            ${DB.hasCoursePassword(course.id) ? '🔒 Password: ' + UI.esc(course.password) : '🔓 Terbuka'}
          </span>
        </div>
        <p>${UI.esc(course.description)}</p>
      </div>

      ${Jadwal.courseScheduleCardHtml(course, user, { linkToJadwal: true })}

      <div class="tabs">
        <button class="tab-btn active" data-tab="materials">Materi (${materials.length})</button>
        <button class="tab-btn" data-tab="modules">Modul (${DB.getModulesByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="recordings">Rekaman (${DB.getRecordingsByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="assignments">Tugas (${assignments.length})</button>
        <button class="tab-btn" data-tab="cbts">CBT (${DB.getCbtsByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="attendance">Presensi</button>
        <button class="tab-btn" data-tab="students">Siswa (${enrollments.length})</button>
      </div>
      <div id="tabContent"></div>
    `;

    document.getElementById('backBtn').addEventListener('click', () => {
      currentCourseId = null;
      Dashboard.navigate('courses');
    });
    document.getElementById('editCourseBtn').addEventListener('click', () => openCourseForm(user, course.id));
    document.getElementById('coursePwBtn').addEventListener('click', () =>
      Shared.openCoursePasswordForm(course.id, () => Dashboard.navigate('courses')));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab, course, user);
    }));
    const goJ = document.getElementById('csGoJadwal');
    if (goJ) goJ.addEventListener('click', () => Dashboard.navigate('jadwal-kelas'));
    renderTab('materials', course, user);
  }

  function renderTab(tab, course, user) {
    const el = document.getElementById('tabContent');
    if (tab === 'materials') return renderMaterialsTab(el, course, user);
    if (tab === 'modules') return renderModulesTab(el, course, user);
    if (tab === 'recordings') return renderRecordingsTab(el, course, user);
    if (tab === 'assignments') return renderAssignmentsTab(el, course, user);
    if (tab === 'cbts') return renderCbtsTab(el, course, user);
    if (tab === 'attendance') return renderAttendanceTab(el, course, user);
    if (tab === 'students') return renderStudentsTab(el, course, user);
  }

  function renderMaterialsTab(el, course, user) {
    const materials = DB.getMaterialsByCourse(course.id)
      .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const reload = () => renderMaterialsTab(el, course, user);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('📄', `Materi Pembelajaran (${materials.length})`, 'setiap materi mencatat tutor penanggung jawabnya')}
          <button class="btn btn-primary btn-sm" id="addMatBtn">+ Tambah Materi</button></div>
        ${materials.length === 0 ? emptyState('Belum ada materi.') :
          materials.map(m => `
            <div class="list-item">
              <div class="title">${UI.esc(m.title)}</div>
              <div class="meta">${credit(m, course)} • Dibuat ${UI.fmtDate(m.createdAt)}${m.updatedAt ? ` • Diubah ${UI.fmtDate(m.updatedAt)}` : ''}</div>
              <div class="content rt-content">${RichText.render(m.content || '')}</div>
              ${m.link ? `<div class="mt-1"><a href="${UI.esc(m.link)}" target="_blank" rel="noopener">Buka tautan →</a></div>` : ''}
              <div class="flex-gap mt-1">${ownerActionsHtml(user, m, course, 'data-edit-mat', 'data-del-mat')}</div>
            </div>`).join('')}
      </div>
    `;
    document.getElementById('addMatBtn').addEventListener('click', () =>
      ContentEditor.openMaterial({ user, course, onSaved: (r) => { if (r) reload(); } }));
    el.querySelectorAll('[data-edit-mat]').forEach(b => b.addEventListener('click', () =>
      ContentEditor.openMaterial({ user, course, editId: b.dataset.editMat, onSaved: (r) => { if (r) reload(); } })));
    el.querySelectorAll('[data-del-mat]').forEach(b => b.addEventListener('click', () => {
      const rec = DB.getMaterial(b.dataset.delMat);
      if (!DB.canManageContent(user, rec, course)) { UI.toast('Hanya tutor pembuatnya yang dapat menghapus materi ini.', 'error'); return; }
      if (!UI.confirmDialog('Hapus materi ini?')) return;
      DB.deleteMaterial(b.dataset.delMat);
      UI.toast('Materi dihapus.');
      reload();
    }));
  }

  function renderAssignmentsTab(el, course, user) {
    const assignments = DB.getAssignmentsByCourse(course.id)
      .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const reload = () => renderAssignmentsTab(el, course, user);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('📝', `Tugas (${assignments.length})`, 'hanya tutor pembuat yang dapat menyunting & menilai tugasnya')}
          <button class="btn btn-primary btn-sm" id="addAsgBtn">+ Buat Tugas</button></div>
        ${assignments.length === 0 ? emptyState('Belum ada tugas.') : assignments.map(a => {
          const subs = DB.getSubmissionsByAssignment(a.id);
          const graded = subs.filter(s => s.grade != null).length;
          const mine = DB.canManageContent(user, a, course);
          const qCount = (a.questionIds || []).length;
          return `
            <div class="list-item">
              <div class="flex-between">
                <div class="title">${UI.esc(a.title)}</div>
                <div class="flex-gap">
                  <span class="badge badge-info">${a.mode === 'soal' ? `🧮 ${qCount} soal` : '✍️ Uraian'}</span>
                  <span class="badge ${graded < subs.length ? 'badge-warning' : 'badge-success'}">${graded}/${subs.length} dinilai</span>
                </div>
              </div>
              <div class="meta">${credit(a, course)} • Deadline ${UI.fmtDate(a.dueDate)}</div>
              <div class="content rt-content">${RichText.render(a.description || '')}</div>
              <div class="flex-gap mt-1">
                ${mine
                  ? `<button class="btn btn-sm btn-primary" data-grade="${a.id}">Nilai (${subs.length})</button>
                     <button class="btn btn-sm btn-secondary" data-edit-asg="${a.id}">Edit</button>
                     <button class="btn btn-sm btn-danger" data-del-asg="${a.id}">Hapus</button>`
                  : `<span class="lock-note">🔒 Hanya ${UI.esc(DB.contentOwnerName(a, course) || 'tutor pembuat')} yang dapat menyunting & menilai tugas ini</span>`}
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('addAsgBtn').addEventListener('click', () =>
      ContentEditor.openAssignment({ user, course, onSaved: (r) => { if (r) reload(); } }));
    el.querySelectorAll('[data-edit-asg]').forEach(b => b.addEventListener('click', () =>
      ContentEditor.openAssignment({ user, course, editId: b.dataset.editAsg, onSaved: (r) => { if (r) reload(); } })));
    el.querySelectorAll('[data-del-asg]').forEach(b => b.addEventListener('click', () => {
      const a = DB.getAssignment(b.dataset.delAsg);
      if (!DB.canManageContent(user, a, course)) { UI.toast('Hanya tutor pembuatnya yang dapat menghapus tugas ini.', 'error'); return; }
      if (!UI.confirmDialog('Hapus tugas ini? Semua jawaban siswa juga terhapus.')) return;
      DB.deleteAssignment(b.dataset.delAsg);
      UI.toast('Tugas dihapus.');
      reload();
    }));
    el.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => openGradeModal(b.dataset.grade, user)));
  }

  function openGradeModal(assignmentId, user) {
    const asg = DB.getAssignment(assignmentId);
    const course = asg ? DB.getCourse(asg.courseId) : null;
    if (user && !DB.canManageContent(user, asg, course)) {
      UI.toast('Tugas ini dibuat tutor lain, jadi hanya dia (atau admin) yang boleh menilainya.', 'error');
      return;
    }
    const subs = DB.getSubmissionsByAssignment(assignmentId);
    const enrollments = DB.getEnrollmentsByCourse(asg.courseId);
    const rows = enrollments.map(e => {
      const student = DB.getUser(e.studentId);
      const sub = subs.find(s => s.studentId === e.studentId);
      return { student, sub };
    });

    const body = `
      <p class="muted">${UI.esc(asg.title)} — Deadline ${UI.fmtDate(asg.dueDate)}</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Siswa</th><th>Status</th><th>Dikirim</th><th>Nilai</th><th>Aksi</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><strong>${UI.esc(r.student ? r.student.name : '-')}</strong></td>
            <td>${r.sub ? (r.sub.grade != null ? '<span class="badge badge-success">Dinilai</span>' : '<span class="badge badge-warning">Perlu Dinilai</span>') : '<span class="badge badge-gray">Belum Submit</span>'}</td>
            <td>${r.sub ? UI.fmtDateTime(r.sub.submittedAt) : '-'}</td>
            <td>${r.sub && r.sub.grade != null ? r.sub.grade : '-'}</td>
            <td>${r.sub ? `<button class="btn btn-sm btn-primary" data-sub="${r.sub.id}">${r.sub.grade != null ? 'Ubah Nilai' : 'Beri Nilai'}</button>` : '-'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    `;
    UI.modal.open('Daftar Submission', body);
    document.getElementById('modalBody').querySelectorAll('[data-sub]').forEach(b =>
      b.addEventListener('click', () => openGradeForm(b.dataset.sub, assignmentId, user)));
  }

  function openGradeForm(submissionId, assignmentId, user) {
    const sub = DB.getSubmission(submissionId);
    const student = DB.getUser(sub.studentId);
    const asg = DB.getAssignment(assignmentId);
    const course = asg ? DB.getCourse(asg.courseId) : null;
    if (user && !DB.canManageContent(user, asg, course)) {
      UI.toast('Tugas ini dibuat tutor lain, jadi hanya dia (atau admin) yang boleh menilainya.', 'error');
      return;
    }

    /* Tugas berbasis soal: tampilkan jawaban per soal dan skor otomatisnya
     * sehingga tutor hanya perlu menilai bagian esai. */
    const isSoal = asg && asg.mode === 'soal' && (asg.questionIds || []).length;
    let autoInfo = null;
    if (isSoal) {
      const answers = sub.answers || {};
      let auto = 0, autoTotal = 0, manual = 0;
      const rows = (asg.questionIds || []).map((qid, i) => {
        const q = DB.getQuestion(qid);
        if (!q) return '';
        const g = global.Exam ? Exam.gradeQuestion(q, answers[qid]) : { auto: false, correct: false };
        if (g.auto) { autoTotal++; if (g.correct) auto++; } else manual++;
        return `<tr>
          <td>${i + 1}</td>
          <td class="rt-content">${RichText.render(q.text || '')}</td>
          <td>${UI.esc(q.questionType || '-')}</td>
          <td>${answers[qid] == null || answers[qid] === ''
                ? '<span class="muted">tidak dijawab</span>'
                : UI.esc(RichText.plain(String(
                    Array.isArray(answers[qid]) ? answers[qid].join(', ')
                    : (typeof answers[qid] === 'object' ? JSON.stringify(answers[qid]) : answers[qid])), 160))}</td>
          <td>${g.auto ? (g.correct ? '<span class="badge badge-success">Benar</span>' : '<span class="badge badge-danger">Salah</span>')
                       : '<span class="badge badge-warning">Manual</span>'}</td>
        </tr>`;
      }).join('');
      const suggested = autoTotal ? Math.round((auto / autoTotal) * (asg.maxScore || 100)) : null;
      autoInfo = { auto, autoTotal, manual, suggested, rows };
    }

    const body = `
      <div class="card" style="box-shadow:none;border-color:var(--gray-100);">
        <div class="muted small">Siswa</div>
        <strong>${UI.esc(student ? student.name : '-')}</strong>
        <div class="muted small mt-1">Dikirim ${UI.fmtDateTime(sub.submittedAt)}${asg ? ' • ' + UI.esc(asg.title) : ''}</div>
        ${isSoal && autoInfo ? `
          <div class="alert alert-info mt-1" style="margin-bottom:0;">
            <strong>Skor otomatis: ${autoInfo.auto}/${autoInfo.autoTotal} benar</strong>
            ${autoInfo.suggested != null ? ` → saran nilai <strong>${autoInfo.suggested}</strong>` : ''}
            ${autoInfo.manual ? ` • ${autoInfo.manual} soal esai perlu Anda nilai sendiri` : ''}
          </div>
          <div class="table-wrap mt-1"><table class="table">
            <thead><tr><th>#</th><th>Soal</th><th>Format</th><th>Jawaban Siswa</th><th>Hasil</th></tr></thead>
            <tbody>${autoInfo.rows}</tbody>
          </table></div>`
        : `<div class="content mt-1 rt-content">${sub.content ? RichText.render(sub.content) : '<span class="muted">(tanpa jawaban tertulis)</span>'}</div>`}
      </div>
      <form id="gradeForm" class="form">
        <div class="form-row">
          <div class="form-group"><label>Nilai (0-${asg ? (asg.maxScore || 100) : 100})</label>
            <input name="grade" type="number" min="0" max="${asg ? (asg.maxScore || 100) : 100}" required
                   value="${sub.grade != null ? sub.grade : (autoInfo && autoInfo.suggested != null ? autoInfo.suggested : '')}" /></div>
          <div class="form-group"><label>Feedback</label>
            <input name="feedback" value="${UI.esc(sub.feedback || '')}" /></div>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan Nilai</button>
        </div>
      </form>
    `;
    UI.modal.open('Beri Nilai', body);
    document.getElementById('cancelBtn').addEventListener('click', () => openGradeModal(assignmentId, user));
    document.getElementById('gradeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const grade = Number(fd.get('grade'));
      const feedback = fd.get('feedback').trim();
      DB.updateSubmission(sub.id, { grade, feedback, gradedBy: user ? user.id : null, gradedAt: Date.now() });
      // Sinkron: siswa dan orang tuanya langsung mendapat notifikasi nilai
      const asgRec = DB.getAssignment(assignmentId);
      DB.notifyStudentAndParents(sub.studentId, {
        type: 'nilai', icon: '🏆',
        title: 'Tugas telah dinilai',
        body: `${asgRec ? asgRec.title : 'Tugas'} — nilai ${grade}${feedback ? ' • ' + feedback : ''}`,
        link: 'grades'
      }, {
        title: `Nilai baru untuk ${student ? student.name : 'anak Anda'}`,
        link: 'anak-nilai'
      });
      UI.toast('Nilai disimpan & notifikasi dikirim ke siswa dan orang tua.');
      openGradeModal(assignmentId, user);
    });
  }

  function renderStudentsTab(el, course, user) {
    const enrollments = DB.getEnrollmentsByCourse(course.id);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Siswa Terdaftar (${enrollments.length})</h3></div>
        ${enrollments.length === 0 ? emptyState('Belum ada siswa terdaftar.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Kelas</th><th>Email</th><th>Bergabung</th></tr></thead>
          <tbody>
            ${enrollments.map(e => {
              const s = DB.getUser(e.studentId);
              if (!s) return '';
              return `<tr>
                <td><strong>${UI.esc(s.name)}</strong></td>
                <td>${UI.esc(s.kelas || '-')}</td>
                <td>${UI.esc(s.email || '-')}</td>
                <td>${UI.fmtDate(e.enrolledAt)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
  }

  function renderGrading(container, user) {
    const myCourses = DB.getCoursesByTeacher(user.id);
    const myCourseIds = myCourses.map(c => c.id);
    // Hanya tugas yang dibuat tutor ini: dalam satu kelas bisa ada dua tutor,
    // dan penilaian adalah tanggung jawab pembuat tugasnya.
    const myAsg = DB.getAssignments().filter(a =>
      myCourseIds.includes(a.courseId) && DB.canManageContent(user, a, DB.getCourse(a.courseId)));
    const mySubs = DB.getSubmissions()
      .filter(s => myAsg.some(a => a.id === s.assignmentId))
      .sort((a, b) => b.submittedAt - a.submittedAt);

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('✅', `Daftar Submission (${mySubs.length})`, 'hanya tugas yang Anda buat sendiri yang tampil di sini')}
        </div>
        ${mySubs.length === 0 ? emptyState('Belum ada submission dari siswa.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Siswa</th><th>Tugas</th><th>Kelas</th><th>Status</th><th>Dikirim</th><th>Nilai</th><th>Aksi</th></tr></thead>
          <tbody>
            ${mySubs.map(s => {
              const stu = DB.getUser(s.studentId);
              const asg = DB.getAssignment(s.assignmentId);
              const course = DB.getCourse(asg.courseId);
              return `<tr>
                <td><strong>${UI.esc(stu ? stu.name : '-')}</strong></td>
                <td>${UI.esc(asg.title)}</td>
                <td>${UI.esc(course ? DB.courseTitle(course) : '-')}</td>
                <td>${s.grade != null ? '<span class="badge badge-success">Dinilai</span>' : '<span class="badge badge-warning">Perlu Dinilai</span>'}</td>
                <td>${UI.fmtDateTime(s.submittedAt)}</td>
                <td>${s.grade != null ? s.grade : '-'}</td>
                <td><button class="btn btn-sm btn-primary" data-grade-sub="${s.id}" data-asg="${s.assignmentId}">Nilai</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
    container.querySelectorAll('[data-grade-sub]').forEach(b => b.addEventListener('click', () => {
      openGradeForm(b.dataset.gradeSub, b.dataset.asg, user);
    }));
  }

  function renderProfile(container, user) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Profil Saya</h3></div>
        <form id="profileForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Nama Lengkap</label>
              <input name="name" required value="${UI.esc(user.name)}" /></div>
            <div class="form-group"><label>Username</label>
              <input value="${UI.esc(user.username)}" readonly /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Email</label>
              <input name="email" type="email" required value="${UI.esc(user.email || '')}" /></div>
            <div class="form-group"><label>Mata Pelajaran</label>
              <input name="subject" value="${UI.esc(user.subject || '')}" /></div>
          </div>
          <div class="form-group"><label>Password Baru (kosongkan jika tidak diubah)</label>
            <input name="password" type="password" minlength="6" /></div>
          <div id="profileMsg" class="alert alert-success hidden"></div>
          <button class="btn btn-primary" type="submit">Simpan</button>
        </form>
      </div>
    `;
    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {
        name: fd.get('name').trim(),
        email: fd.get('email').trim(),
        subject: fd.get('subject').trim()
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

  /* ========== MODULES (within course tab) ========== */
  function renderModulesTab(el, course, user) {
    const modules = DB.getModulesByCourse(course.id)
      .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('📘', `Modul Pembelajaran (${modules.length})`, 'modul berbagian dengan tutor penanggung jawab')}
          <button class="btn btn-primary btn-sm" id="addModBtn">+ Tambah Modul</button></div>
        ${modules.length === 0 ? emptyState('Belum ada modul.')
          : modules.map(m => moduleCardHtml(m, true, course, user)).join('')}
      </div>
    `;
    document.getElementById('addModBtn').addEventListener('click', () =>
      ContentEditor.openModule({ user, course, onSaved: (r) => { if (r) renderModulesTab(el, course, user); } }));
    bindModuleActions(el, course, user);
  }

  function moduleCardHtml(m, ownerActions, course, user) {
    const c = course || DB.getCourse(m.courseId);
    return `
      <div class="module-card">
        <div class="module-head">
          <h4>${UI.esc(m.title)}</h4>
          <div class="meta">${credit(m, c)} • ${UI.esc(m.description || '')} • ${(m.sections || []).length} bagian • ${UI.fmtDate(m.createdAt)}</div>
        </div>
        <div class="module-body">
          ${(m.sections || []).map(s => `
            <div class="module-section">
              <div class="module-section-title">${UI.esc(s.title)}</div>
              <div class="module-section-content rt-content">${RichText.render(s.content || '')}</div>
            </div>`).join('') || '<div class="module-section muted">Belum ada bagian.</div>'}
          ${m.link ? `<div class="module-section"><a href="${UI.esc(m.link)}" target="_blank" rel="noopener">Buka tautan modul →</a></div>` : ''}
        </div>
        ${ownerActions && user ? `<div class="module-section flex-gap">
          ${ownerActionsHtml(user, m, c, 'data-edit-mod', 'data-del-mod')}
        </div>` : ''}
      </div>
    `;
  }

  function bindModuleActions(el, course, user) {
    el.querySelectorAll('[data-edit-mod]').forEach(b => b.addEventListener('click', () =>
      ContentEditor.openModule({ user, course, editId: b.dataset.editMod,
        onSaved: (r) => { if (r) renderModulesTab(el, course, user); } })));
    el.querySelectorAll('[data-del-mod]').forEach(b => b.addEventListener('click', () => {
      const rec = DB.getModule(b.dataset.delMod);
      if (!DB.canManageContent(user, rec, course)) { UI.toast('Hanya tutor pembuatnya yang dapat menghapus modul ini.', 'error'); return; }
      if (!UI.confirmDialog('Hapus modul ini?')) return;
      DB.deleteModule(b.dataset.delMod);
      UI.toast('Modul dihapus.');
      renderModulesTab(el, course, user);
    }));
  }

  /* ========== RECORDINGS (within course tab) ========== */
  function renderRecordingsTab(el, course, user) {
    const recs = DB.getRecordingsByCourse(course.id).slice().sort((a, b) => b.recordedAt - a.recordedAt);
    const reload = () => renderRecordingsTab(el, course, user);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('🎥', `Rekaman Kelas (${recs.length})`, 'rekaman pertemuan beserta tutor yang mengajar')}
          <button class="btn btn-primary btn-sm" id="addRecBtn">+ Tambah Rekaman</button></div>
        ${recs.length === 0 ? emptyState('Belum ada rekaman.') : recs.map(r => `
          <div class="list-item">
            <div class="flex-between">
              <div class="title">${UI.esc(r.title)}</div>
              <span class="muted small">${UI.fmtDate(r.recordedAt)} • ${UI.fmtDuration(r.duration)}</span>
            </div>
            <div class="meta">${credit(r, course)}</div>
            ${Shared.videoEmbedHtml(r.url)}
            ${r.notes ? `<div class="content rt-content">${RichText.render(r.notes)}</div>` : ''}
            <div class="flex-gap mt-1">${ownerActionsHtml(user, r, course, 'data-edit-rec', 'data-del-rec')}</div>
          </div>`).join('')}
      </div>
    `;
    document.getElementById('addRecBtn').addEventListener('click', () =>
      ContentEditor.openRecording({ user, course, onSaved: (r) => { if (r) reload(); } }));
    el.querySelectorAll('[data-edit-rec]').forEach(b => b.addEventListener('click', () =>
      ContentEditor.openRecording({ user, course, editId: b.dataset.editRec, onSaved: (r) => { if (r) reload(); } })));
    el.querySelectorAll('[data-del-rec]').forEach(b => b.addEventListener('click', () => {
      const rec = DB.getRecording(b.dataset.delRec);
      if (!DB.canManageContent(user, rec, course)) { UI.toast('Hanya tutor pembuatnya yang dapat menghapus rekaman ini.', 'error'); return; }
      if (!UI.confirmDialog('Hapus rekaman ini?')) return;
      DB.deleteRecording(b.dataset.delRec);
      UI.toast('Rekaman dihapus.');
      reload();
    }));
  }

  /* ========== CBT (within course tab) ========== */
  function renderCbtsTab(el, course, user) {
    const cbts = DB.getCbtsByCourse(course.id)
      .slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const reload = () => renderCbtsTab(el, course, user);
    el.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('🖥️', `Ujian CBT Kelas Ini (${cbts.length})`,
            'soal diambil dari Bank Soal pusat; ujian di halaman utama CBT dan di kelas ini memakai bank yang sama')}
          <button class="btn btn-primary btn-sm" id="addCbtBtn">+ Buat Ujian</button></div>
        ${cbts.length === 0
          ? emptyState('Belum ada ujian untuk kelas ini. Buat ujian, lalu pilih soalnya dari Bank Soal.')
          : cbts.map(c => {
          const attempts = DB.getCbtAttemptsByCbt(c.id);
          const submitted = attempts.filter(a => a.submittedAt).length;
          const qCount = DB.cbtQuestionIds(c).length;
          const mine = DB.canManageContent(user, c, course);
          const others = (c.courseIds || []).filter(x => x !== course.id).length;
          return `<div class="list-item">
            <div class="flex-between">
              <div class="title">${UI.esc(c.title)}</div>
              <div class="flex-gap">
                <span class="badge badge-info">${qCount} soal</span>
                ${others ? `<span class="badge badge-gray" title="Ujian ini juga dipakai kelas lain">+${others} kelas lain</span>` : ''}
              </div>
            </div>
            <div class="meta">${credit(c, course)} • ${UI.fmtDateTime(c.startAt)} — ${UI.fmtDateTime(c.endAt)} • Durasi ${c.durationMinutes} menit</div>
            <div class="content rt-content">${RichText.render(c.description || '')}</div>
            <div class="muted small">Dikerjakan: ${submitted} siswa</div>
            <div class="flex-gap mt-1">
              <button class="btn btn-sm btn-primary" data-result-cbt="${c.id}">Hasil</button>
              ${mine
                ? `<button class="btn btn-sm btn-secondary" data-edit-cbt="${c.id}">Edit</button>
                   <button class="btn btn-sm btn-danger" data-del-cbt="${c.id}">Hapus</button>`
                : `<span class="lock-note">🔒 Hanya ${UI.esc(DB.contentOwnerName(c, course) || 'tutor pembuat')} yang dapat mengubah ujian ini</span>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('addCbtBtn').addEventListener('click', () => startCbtWizard(course, user, null, reload));
    el.querySelectorAll('[data-edit-cbt]').forEach(b => b.addEventListener('click', () => {
      const c = DB.getCbt(b.dataset.editCbt);
      if (!DB.canManageContent(user, c, course)) { UI.toast('Hanya tutor pembuatnya yang dapat mengubah ujian ini.', 'error'); return; }
      startCbtWizard(course, user, b.dataset.editCbt, reload);
    }));
    el.querySelectorAll('[data-del-cbt]').forEach(b => b.addEventListener('click', () => {
      const c = DB.getCbt(b.dataset.delCbt);
      if (!DB.canManageContent(user, c, course)) { UI.toast('Hanya tutor pembuatnya yang dapat menghapus ujian ini.', 'error'); return; }
      if (!UI.confirmDialog('Hapus ujian dan semua hasil pengerjaannya?')) return;
      DB.deleteCbt(b.dataset.delCbt);
      UI.toast('Ujian dihapus.');
      reload();
    }));
    el.querySelectorAll('[data-result-cbt]').forEach(b => b.addEventListener('click', () => openCbtResults(b.dataset.resultCbt)));
  }

  /**
   * Buka wizard CBT dari halaman kelas.
   * Dulu halaman ini memakai form sendiri yang memfilter soal dengan
   * DB.getQuestionsByAuthor(user.id), sehingga admin (dan tutor yang memakai
   * soal rekannya) selalu ditolak dengan pesan "Anda belum punya soal di Bank
   * Soal". Sekarang seluruh pembuatan ujian memakai wizard bersama yang
   * membaca Bank Soal PUSAT, dengan kelas tujuan sudah terisi.
   */
  function startCbtWizard(course, user, editId, onDone) {
    if (DB.getQuestions().length === 0) {
      UI.toast('Bank Soal masih kosong. Tambahkan soal lewat menu Bank Soal terlebih dahulu.', 'error');
      return;
    }
    const open = (ownerId) => CbtAdmin.openWizard(user, editId, onDone, {
      courseIds: [course.id],
      ownerId: ownerId,
      inClass: true
    });

    // Tutor: otomatis atas namanya. Admin: pilih tutor penanggung jawab.
    if (user.role !== 'admin' || editId) { open(user.role === 'guru' ? user.id : null); return; }

    const tutors = DB.courseTeachers(course);
    if (tutors.length <= 1) { open(tutors[0] ? tutors[0].id : null); return; }
    UI.modal.open('Tutor Penanggung Jawab Ujian', `
      <form id="cbtOwnerForm" class="form">
        <p class="muted small" style="margin-top:0;">
          Kelas ini diampu ${tutors.length} tutor. Pilih tutor yang bertanggung jawab atas ujian ini
          agar rekapan keaktifan tutor tetap akurat.
        </p>
        <div class="form-group">
          <label for="cbtOwner">Tutor</label>
          <select id="cbtOwner" name="ownerId">
            ${tutors.map(t => `<option value="${UI.esc(t.id)}">${UI.esc(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cbtOwnerCancel">Batal</button>
          <button type="submit" class="btn btn-primary">Lanjut ke Wizard Ujian</button>
        </div>
      </form>`);
    document.getElementById('cbtOwnerCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('cbtOwnerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('cbtOwner').value;
      UI.modal.close();
      open(id);
    });
  }

  function openCbtResults(cbtId) {
    const cbt = DB.getCbt(cbtId);
    const course = DB.getCourse(cbt.courseId);
    const enrollments = DB.getEnrollmentsByCourse(cbt.courseId);
    const rows = enrollments.map(e => {
      const student = DB.getUser(e.studentId);
      const attempt = DB.getCbtAttemptByStudent(cbt.id, e.studentId);
      return { student, attempt };
    });
    const submitted = rows.filter(r => r.attempt && r.attempt.submittedAt);
    const avg = submitted.length ? Math.round(submitted.reduce((sum, r) => sum + (r.attempt.score || 0), 0) / submitted.length) : null;

    const body = `
      <div class="muted small mb-1">${UI.esc(cbt.title)} (${UI.esc(course.title)})</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="label">Peserta</div><div class="value">${enrollments.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Sudah Mengerjakan</div><div class="value">${submitted.length}</div></div>
        <div class="stat-card accent-primary"><div class="label">Rata-rata</div><div class="value">${avg ?? '-'}</div></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Siswa</th><th>Status</th><th>Benar</th><th>Skor</th><th>Dikirim</th></tr></thead>
        <tbody>
          ${rows.map(r => {
            if (!r.attempt) return `<tr><td>${UI.esc(r.student?.name || '-')}</td><td><span class="badge badge-gray">Belum</span></td><td>-</td><td>-</td><td>-</td></tr>`;
            if (!r.attempt.submittedAt) return `<tr><td>${UI.esc(r.student?.name || '-')}</td><td><span class="badge badge-warning">Sedang Mengerjakan</span></td><td>-</td><td>-</td><td>-</td></tr>`;
            return `<tr>
              <td><strong>${UI.esc(r.student?.name || '-')}</strong></td>
              <td><span class="badge badge-success">Selesai</span></td>
              <td>${r.attempt.correctCount}/${r.attempt.totalCount}</td>
              <td><strong>${r.attempt.score}</strong></td>
              <td>${UI.fmtDateTime(r.attempt.submittedAt)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>
    `;
    UI.modal.open('Hasil Ujian', body);
  }

  /* ========== ATTENDANCE (within course tab) ==========
   * Memakai lembar presensi bersama: status berupa kotak berbaris ke samping,
   * tanpa dropdown, dan langsung tersimpan saat diklik.
   */
  function renderAttendanceTab(el, course, user) {
    Shared.renderAttendanceSheet({
      container: el,
      courseId: course.id,
      date: UI.todayYMD(),
      user,
      canMarkTeacher: true
    });
  }

  /* ========== GLOBAL: Modul, Rekaman, Bank Soal, CBT, Absensi, Honor ========== */
  function renderModulSection(container, user) {
    const courses = DB.getCoursesByTeacher(user.id);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Modul di Kelas Saya</h3>
          <select id="modCourseFilter" class="form" style="max-width:220px;">
            <option value="">Semua Kelas</option>
            ${courses.map(c => `<option value="${c.id}">${UI.esc(c.title)}</option>`).join('')}
          </select>
        </div>
        <div id="modList"></div>
      </div>
    `;
    const renderList = (cid) => {
      const list = document.getElementById('modList');
      let modules = DB.getModules().filter(m => courses.some(c => c.id === m.courseId));
      if (cid) modules = modules.filter(m => m.courseId === cid);
      if (modules.length === 0) { list.innerHTML = emptyState('Belum ada modul.'); return; }
      list.innerHTML = modules.map(m => {
        const c = DB.getCourse(m.courseId);
        return `<div>
          <div class="muted small" style="margin-bottom:4px;">${UI.esc(c ? c.title : '-')}</div>
          ${moduleCardHtml(m, true, c, user)}
        </div>`;
      }).join('');
      list.querySelectorAll('[data-edit-mod]').forEach(b => b.addEventListener('click', () => {
        const m = DB.getModule(b.dataset.editMod);
        const c = DB.getCourse(m.courseId);
        ContentEditor.openModule({ user, course: c, editId: m.id,
          onSaved: (r) => { if (r) renderList(document.getElementById('modCourseFilter').value); } });
      }));
      list.querySelectorAll('[data-del-mod]').forEach(b => b.addEventListener('click', () => {
        const m = DB.getModule(b.dataset.delMod);
        if (!DB.canManageContent(user, m, DB.getCourse(m.courseId))) {
          UI.toast('Hanya tutor pembuatnya yang dapat menghapus modul ini.', 'error'); return;
        }
        if (!UI.confirmDialog('Hapus modul ini?')) return;
        DB.deleteModule(b.dataset.delMod);
        UI.toast('Modul dihapus.');
        renderList(document.getElementById('modCourseFilter').value);
      }));
    };
    document.getElementById('modCourseFilter').addEventListener('change', (e) => renderList(e.target.value));
    renderList('');
  }

  function renderRekamanSection(container, user) {
    const courses = DB.getCoursesByTeacher(user.id);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Rekaman Kelas Saya</h3>
          <select id="recCourseFilter" class="form" style="max-width:220px;">
            <option value="">Semua Kelas</option>
            ${courses.map(c => `<option value="${c.id}">${UI.esc(c.title)}</option>`).join('')}
          </select>
        </div>
        <div id="recList"></div>
      </div>
    `;
    const renderList = (cid) => {
      const list = document.getElementById('recList');
      let recs = DB.getRecordings().filter(r => courses.some(c => c.id === r.courseId));
      if (cid) recs = recs.filter(r => r.courseId === cid);
      recs = recs.sort((a, b) => b.recordedAt - a.recordedAt);
      if (recs.length === 0) { list.innerHTML = emptyState('Belum ada rekaman.'); return; }
      list.innerHTML = recs.map(r => {
        const c = DB.getCourse(r.courseId);
        return `<div class="list-item">
          <div class="flex-between">
            <div class="title">${UI.esc(r.title)}</div>
            <span class="muted small">${UI.esc(c ? DB.courseTitle(c) : '-')} • ${UI.fmtDate(r.recordedAt)}</span>
          </div>
          <div class="meta">${credit(r, c)}</div>
          ${Shared.videoEmbedHtml(r.url)}
          ${r.notes ? `<div class="content rt-content">${RichText.render(r.notes)}</div>` : ''}
        </div>`;
      }).join('');
    };
    document.getElementById('recCourseFilter').addEventListener('change', (e) => renderList(e.target.value));
    renderList('');
  }

  function renderAbsensiSection(container, user) {
    const courses = DB.getCoursesByTeacher(user.id);
    const myAtt = DB.getAttendanceByUser(user.id).filter(a => a.role === 'guru');
    const present = myAtt.filter(a => a.status === 'hadir').length;

    let activeCourse = courses.length ? courses[0].id : '';
    let activeTab = 'ambil';

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Sesi Saya</div><div class="value">${myAtt.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Hadir</div><div class="value">${present}</div></div>
        <div class="stat-card accent-warning"><div class="label">Kehadiran Saya</div><div class="value">${myAtt.length ? Math.round(present / myAtt.length * 100) : 0}%</div></div>
        <div class="stat-card accent-danger"><div class="label">Kelas Diajar</div><div class="value">${courses.length}</div></div>
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🗂️', 'Pilih Kelas', 'Klik kotak kelas, langsung siap absen')}</div>
        <div id="guruClassChips">
          ${courses.length ? Shared.classChipsHtml(courses, activeCourse, 'data-abs-course')
            : emptyState('Anda belum memiliki kelas.')}
        </div>
      </div>

      ${courses.length ? `
      <div class="subtabs">
        <button class="subtab-btn active" data-abstab="ambil">📝 Ambil Presensi</button>
        <button class="subtab-btn" data-abstab="rekap">📈 Rekap Siswa</button>
        <button class="subtab-btn" data-abstab="saya">👤 Riwayat Saya</button>
      </div>` : ''}
      <div id="absBox"></div>
    `;

    const paintTab = () => {
      const box = document.getElementById('absBox');
      if (!courses.length) { box.innerHTML = ''; return; }
      if (activeTab === 'ambil') {
        Shared.renderAttendanceSheet({
          container: box,
          courseId: activeCourse,
          date: UI.todayYMD(),
          user,
          canMarkTeacher: true,
          onSaved: () => { /* rekap dibaca ulang saat tab dibuka */ }
        });
        return;
      }
      if (activeTab === 'rekap') {
        const enrollments = DB.getEnrollmentsByCourse(activeCourse);
        const att = DB.getAttendanceByCourse(activeCourse).filter(a => a.role === 'siswa');
        if (enrollments.length === 0) { box.innerHTML = emptyState('Belum ada siswa di kelas ini.'); return; }
        const rows = enrollments.map(e => {
          const s = DB.getUser(e.studentId);
          const rec = att.filter(a => a.userId === e.studentId);
          const counts = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
          rec.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
          const total = rec.length;
          const pct = total ? Math.round(counts.hadir / total * 100) : 0;
          return { s, counts, total, pct };
        }).sort((a, b) => b.pct - a.pct);
        box.innerHTML = `<div class="card">
          <div class="card-header">${UI.secHead('📈', 'Rekap Kehadiran Siswa', UI.esc(DB.getCourse(activeCourse)?.title || ''))}</div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Siswa</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Total</th><th>Kehadiran</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
              <td><strong>${UI.esc(r.s?.name || '-')}</strong></td>
              <td>${r.counts.hadir}</td>
              <td>${r.counts.izin}</td>
              <td>${r.counts.sakit}</td>
              <td>${r.counts.alfa}</td>
              <td>${r.total}</td>
              <td style="min-width:150px;">${UI.progressHtml(r.pct, '', 'auto')}</td>
            </tr>`).join('')}</tbody></table></div>
        </div>`;
        if (window.Effects) Effects.enhance(box);
        return;
      }
      // Riwayat presensi guru sendiri
      box.innerHTML = `<div class="card">
        <div class="card-header">${UI.secHead('👤', 'Riwayat Presensi Saya', 'Seluruh kelas yang Anda ajar')}</div>
        ${myAtt.length === 0 ? emptyState('Belum ada data presensi.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${myAtt.slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => {
            const c = DB.getCourse(a.courseId);
            return `<tr>
              <td>${UI.fmtYMD(a.date)}</td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td><span class="status-${a.status}">${a.status.toUpperCase()}</span></td>
              <td>${UI.esc(a.note || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`}
      </div>`;
      if (window.Effects) Effects.enhance(box);
    };

    container.querySelectorAll('[data-abs-course]').forEach(b => b.addEventListener('click', () => {
      activeCourse = b.dataset.absCourse;
      container.querySelectorAll('[data-abs-course]').forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      paintTab();
    }));
    container.querySelectorAll('[data-abstab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-abstab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      activeTab = b.dataset.abstab;
      paintTab();
    }));
    paintTab();
  }

  function renderHonorSection(container, user) {
    const salaries = DB.getSalariesByTeacher(user.id).slice().sort((a, b) => (b.period || '').localeCompare(a.period || ''));
    const total = salaries.filter(s => s.status === 'dibayar').reduce((sum, s) => sum + (s.amount || 0), 0);
    const pending = salaries.filter(s => s.status !== 'dibayar').reduce((sum, s) => sum + (s.amount || 0), 0);
    container.innerHTML = `
      <div class="finance-summary">
        <div class="fin-card income">
          <div class="label">Total Diterima</div>
          <div class="value">${UI.fmtRp(total)}</div>
        </div>
        <div class="fin-card expense">
          <div class="label">Belum Dibayar</div>
          <div class="value">${UI.fmtRp(pending)}</div>
        </div>
        <div class="fin-card profit">
          <div class="label">Tarif per Bulan</div>
          <div class="value">${UI.fmtRp(user.salaryRate || 0)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Riwayat Honor</h3></div>
        ${salaries.length === 0 ? emptyState('Belum ada riwayat pembayaran honor.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Periode</th><th>Jumlah</th><th>Status</th><th>Dibayar</th><th>Catatan</th></tr></thead>
          <tbody>${salaries.map(s => `<tr>
            <td><strong>${UI.esc(s.period)}</strong></td>
            <td>${UI.fmtRp(s.amount)}</td>
            <td>${s.status === 'dibayar' ? '<span class="badge badge-success">Dibayar</span>' : '<span class="badge badge-warning">Pending</span>'}</td>
            <td>${s.status === 'dibayar' ? UI.fmtDate(s.paidAt) : '-'}</td>
            <td class="muted small">${UI.esc(s.note || '-')}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;
  }

  /* Diekspor agar panel Admin dapat menampilkan isi kelas (modul, materi,
   * tugas, CBT, presensi, siswa) memakai komponen yang sama persis dengan
   * dashboard tutor — tanpa menduplikasi kode. */
  global.GuruPanel = {
    render,
    renderCourseTab: (tab, course, user, el) => {
      const target = el || document.getElementById('tabContent');
      if (!target) return;
      if (tab === 'materials') return renderMaterialsTab(target, course, user);
      if (tab === 'modules') return renderModulesTab(target, course, user);
      if (tab === 'recordings') return renderRecordingsTab(target, course, user);
      if (tab === 'assignments') return renderAssignmentsTab(target, course, user);
      if (tab === 'cbts') return renderCbtsTab(target, course, user);
      if (tab === 'attendance') return renderAttendanceTab(target, course, user);
      if (tab === 'students') return renderStudentsTab(target, course, user);
    },
    openCourseForm
  };
})(window);
