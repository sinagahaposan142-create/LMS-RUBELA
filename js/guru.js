/* ===== Guru Panel =====
 * Manage own courses, materials, assignments, grade submissions.
 */
(function (global) {
  let currentCourseId = null;

  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container, user);
    if (section === 'courses') {
      if (currentCourseId) return renderCourseDetail(container, user);
      return renderMyCourses(container, user);
    }
    if (section === 'modul') return renderModulSection(container, user);
    if (section === 'rekaman') return renderRekamanSection(container, user);
    if (section === 'bank-soal') return renderBankSoal(container, user);
    if (section === 'cbt') return renderCbtSection(container, user);
    if (section === 'grading') return renderGrading(container, user);
    if (section === 'absensi') return renderAbsensiSection(container, user);
    if (section === 'kalender') return Shared.renderCalendar(container, user);
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

    container.innerHTML = `
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
    return `
      <div class="course-card">
        <div class="course-banner ${UI.bannerClass(idx)}">${UI.esc((c.title || '?').slice(0, 1).toUpperCase())}</div>
        <div class="course-body">
          <h4>${UI.esc(c.title)}</h4>
          <div class="meta">${UI.esc(c.category || 'Umum')} • oleh ${UI.esc(t ? t.name : '-')}</div>
          <p>${UI.esc(c.description)}</p>
        </div>
        <div class="course-footer">
          <span>${count} siswa</span>
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" data-open="${c.id}">Buka</button>
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
    container.querySelectorAll('[data-delete-course]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus kelas ini? Materi, tugas, dan submission juga akan dihapus.')) return;
      DB.deleteCourse(b.dataset.deleteCourse);
      UI.toast('Kelas dihapus.');
      render(container, 'courses', user);
    }));
  }

  function openCourseForm(user, editId) {
    const editing = editId ? DB.getCourse(editId) : null;
    const body = `
      <form id="courseForm" class="form">
        <div class="form-group"><label>Judul Kelas</label>
          <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
        <div class="form-row">
          <div class="form-group"><label>Kategori</label>
            <input name="category" value="${UI.esc(editing?.category || '')}" placeholder="mis. Matematika" /></div>
          <div class="form-group"><label>Biaya / SPP (Rp)</label>
            <input name="price" type="number" min="0" value="${editing?.price || 0}" /></div>
        </div>
        <div class="form-group"><label>Deskripsi</label>
          <textarea name="description" required>${UI.esc(editing?.description || '')}</textarea></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Kelas' : 'Buat Kelas Baru', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('courseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        title: fd.get('title').trim(),
        category: fd.get('category').trim(),
        price: Number(fd.get('price') || 0),
        description: fd.get('description').trim()
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
    if (!course || course.teacherId !== user.id) {
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
          <button class="btn btn-secondary btn-sm" id="editCourseBtn">Edit Kelas</button>
        </div>
      </div>

      <div class="card">
        <div class="flex-between mb-1">
          <div>
            <h3 class="mt-0">${UI.esc(course.title)}</h3>
            <div class="muted small">${UI.esc(course.category || 'Umum')} • ${enrollments.length} siswa</div>
          </div>
        </div>
        <p>${UI.esc(course.description)}</p>
      </div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="materials">Materi (${materials.length})</button>
        <button class="tab-btn" data-tab="modules">Modul (${DB.getModulesByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="recordings">Rekaman (${DB.getRecordingsByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="assignments">Tugas (${assignments.length})</button>
        <button class="tab-btn" data-tab="cbts">CBT (${DB.getCbtsByCourse(course.id).length})</button>
        <button class="tab-btn" data-tab="attendance">Absensi</button>
        <button class="tab-btn" data-tab="students">Siswa (${enrollments.length})</button>
      </div>
      <div id="tabContent"></div>
    `;

    document.getElementById('backBtn').addEventListener('click', () => {
      currentCourseId = null;
      Dashboard.navigate('courses');
    });
    document.getElementById('editCourseBtn').addEventListener('click', () => openCourseForm(user, course.id));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTab(btn.dataset.tab, course, user);
    }));
    renderTab('materials', course, user);
  }

  function renderTab(tab, course, user) {
    const el = document.getElementById('tabContent');
    if (tab === 'materials') return renderMaterialsTab(el, course);
    if (tab === 'modules') return renderModulesTab(el, course);
    if (tab === 'recordings') return renderRecordingsTab(el, course);
    if (tab === 'assignments') return renderAssignmentsTab(el, course);
    if (tab === 'cbts') return renderCbtsTab(el, course, user);
    if (tab === 'attendance') return renderAttendanceTab(el, course, user);
    if (tab === 'students') return renderStudentsTab(el, course);
  }

  function renderMaterialsTab(el, course) {
    const materials = DB.getMaterialsByCourse(course.id);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Materi Pembelajaran</h3>
          <button class="btn btn-primary btn-sm" id="addMatBtn">+ Tambah Materi</button></div>
        ${materials.length === 0 ? emptyState('Belum ada materi.') :
          materials.map(m => `
            <div class="list-item">
              <div class="title">${UI.esc(m.title)}</div>
              <div class="meta">Dibuat ${UI.fmtDate(m.createdAt)}</div>
              <div class="content">${UI.esc(m.content)}</div>
              ${m.link ? `<div><a href="${UI.esc(m.link)}" target="_blank" rel="noopener">Buka tautan →</a></div>` : ''}
              <div class="flex-gap mt-1">
                <button class="btn btn-sm btn-secondary" data-edit-mat="${m.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del-mat="${m.id}">Hapus</button>
              </div>
            </div>`).join('')}
      </div>
    `;
    document.getElementById('addMatBtn').addEventListener('click', () => openMaterialForm(course));
    el.querySelectorAll('[data-edit-mat]').forEach(b => b.addEventListener('click', () => openMaterialForm(course, b.dataset.editMat)));
    el.querySelectorAll('[data-del-mat]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus materi ini?')) return;
      DB.deleteMaterial(b.dataset.delMat);
      UI.toast('Materi dihapus.');
      renderMaterialsTab(el, course);
    }));
  }

  function openMaterialForm(course, editId) {
    const editing = editId ? DB.getMaterials().find(m => m.id === editId) : null;
    const body = `
      <form id="matForm" class="form">
        <div class="form-group"><label>Judul</label>
          <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
        <div class="form-group"><label>Isi Materi</label>
          <textarea name="content" required rows="6">${UI.esc(editing?.content || '')}</textarea></div>
        <div class="form-group"><label>Tautan (opsional)</label>
          <input name="link" type="url" value="${UI.esc(editing?.link || '')}" placeholder="https://..." /></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Materi' : 'Tambah Materi', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('matForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        courseId: course.id,
        title: fd.get('title').trim(),
        content: fd.get('content').trim(),
        link: fd.get('link').trim()
      };
      if (editing) DB.updateMaterial(editing.id, payload);
      else DB.addMaterial(payload);
      UI.toast('Materi disimpan.');
      UI.modal.close();
      renderMaterialsTab(document.getElementById('tabContent'), course);
    });
  }

  function renderAssignmentsTab(el, course) {
    const assignments = DB.getAssignmentsByCourse(course.id);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Tugas</h3>
          <button class="btn btn-primary btn-sm" id="addAsgBtn">+ Buat Tugas</button></div>
        ${assignments.length === 0 ? emptyState('Belum ada tugas.') :
          assignments.map(a => {
            const subs = DB.getSubmissionsByAssignment(a.id);
            const graded = subs.filter(s => s.grade != null).length;
            return `
              <div class="list-item">
                <div class="flex-between">
                  <div class="title">${UI.esc(a.title)}</div>
                  <span class="badge ${subs.length > graded ? 'badge-warning' : 'badge-success'}">${graded}/${subs.length} dinilai</span>
                </div>
                <div class="meta">Deadline ${UI.fmtDate(a.dueDate)}</div>
                <div class="content">${UI.esc(a.description)}</div>
                <div class="flex-gap mt-1">
                  <button class="btn btn-sm btn-primary" data-grade="${a.id}">Nilai Submission</button>
                  <button class="btn btn-sm btn-secondary" data-edit-asg="${a.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-asg="${a.id}">Hapus</button>
                </div>
              </div>`;
          }).join('')}
      </div>
    `;
    document.getElementById('addAsgBtn').addEventListener('click', () => openAssignmentForm(course));
    el.querySelectorAll('[data-edit-asg]').forEach(b => b.addEventListener('click', () => openAssignmentForm(course, b.dataset.editAsg)));
    el.querySelectorAll('[data-del-asg]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus tugas dan semua submission terkait?')) return;
      DB.deleteAssignment(b.dataset.delAsg);
      UI.toast('Tugas dihapus.');
      renderAssignmentsTab(el, course);
    }));
    el.querySelectorAll('[data-grade]').forEach(b => b.addEventListener('click', () => openGradeModal(b.dataset.grade)));
  }

  function openAssignmentForm(course, editId) {
    const editing = editId ? DB.getAssignment(editId) : null;
    const body = `
      <form id="asgForm" class="form">
        <div class="form-group"><label>Judul Tugas</label>
          <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
        <div class="form-group"><label>Instruksi</label>
          <textarea name="description" required rows="4">${UI.esc(editing?.description || '')}</textarea></div>
        <div class="form-group"><label>Deadline</label>
          <input name="dueDate" type="date" required value="${UI.toDateInput(editing?.dueDate)}" /></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Tugas' : 'Buat Tugas', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('asgForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        courseId: course.id,
        title: fd.get('title').trim(),
        description: fd.get('description').trim(),
        dueDate: new Date(fd.get('dueDate')).getTime()
      };
      if (editing) DB.updateAssignment(editing.id, payload);
      else DB.addAssignment(payload);
      UI.toast('Tugas disimpan.');
      UI.modal.close();
      renderAssignmentsTab(document.getElementById('tabContent'), course);
    });
  }

  function openGradeModal(assignmentId) {
    const asg = DB.getAssignment(assignmentId);
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
    document.getElementById('modalBody').querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => openGradeForm(b.dataset.sub, assignmentId)));
  }

  function openGradeForm(submissionId, assignmentId) {
    const sub = DB.getSubmissions().find(s => s.id === submissionId);
    const student = DB.getUser(sub.studentId);
    const body = `
      <div class="card" style="box-shadow:none;border-color:var(--gray-100);">
        <div class="muted small">Siswa</div>
        <strong>${UI.esc(student ? student.name : '-')}</strong>
        <div class="muted small mt-1">Dikirim ${UI.fmtDateTime(sub.submittedAt)}</div>
        <div class="content mt-1" style="white-space:pre-wrap;">${UI.esc(sub.content)}</div>
      </div>
      <form id="gradeForm" class="form">
        <div class="form-row">
          <div class="form-group"><label>Nilai (0-100)</label>
            <input name="grade" type="number" min="0" max="100" required value="${sub.grade ?? ''}" /></div>
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
    document.getElementById('cancelBtn').addEventListener('click', () => openGradeModal(assignmentId));
    document.getElementById('gradeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      DB.updateSubmission(sub.id, {
        grade: Number(fd.get('grade')),
        feedback: fd.get('feedback').trim()
      });
      UI.toast('Nilai disimpan.');
      openGradeModal(assignmentId);
    });
  }

  function renderStudentsTab(el, course) {
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
    const myAsg = DB.getAssignments().filter(a => myCourseIds.includes(a.courseId));
    const mySubs = DB.getSubmissions()
      .filter(s => myAsg.some(a => a.id === s.assignmentId))
      .sort((a, b) => b.submittedAt - a.submittedAt);

    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Daftar Submission (${mySubs.length})</h3></div>
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
                <td>${UI.esc(course ? course.title : '-')}</td>
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
      openGradeForm(b.dataset.gradeSub, b.dataset.asg);
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
  function renderModulesTab(el, course) {
    const modules = DB.getModulesByCourse(course.id);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Modul Pembelajaran</h3>
          <button class="btn btn-primary btn-sm" id="addModBtn">+ Tambah Modul</button></div>
        ${modules.length === 0 ? emptyState('Belum ada modul.') : modules.map(m => moduleCardHtml(m, true)).join('')}
      </div>
    `;
    document.getElementById('addModBtn').addEventListener('click', () => openModuleForm(course));
    bindModuleActions(el, course);
  }

  function moduleCardHtml(m, ownerActions) {
    return `
      <div class="module-card">
        <div class="module-head">
          <h4>${UI.esc(m.title)}</h4>
          <div class="meta">${UI.esc(m.description || '')} • ${(m.sections || []).length} bagian • ${UI.fmtDate(m.createdAt)}</div>
        </div>
        <div class="module-body">
          ${(m.sections || []).map(s => `
            <div class="module-section">
              <div class="module-section-title">${UI.esc(s.title)}</div>
              <div class="module-section-content">${UI.esc(s.content)}</div>
            </div>`).join('') || '<div class="module-section muted">Belum ada bagian.</div>'}
          ${m.link ? `<div class="module-section"><a href="${UI.esc(m.link)}" target="_blank" rel="noopener">Buka tautan modul →</a></div>` : ''}
        </div>
        ${ownerActions ? `<div class="module-section flex-gap">
          <button class="btn btn-sm btn-secondary" data-edit-mod="${m.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del-mod="${m.id}">Hapus</button>
        </div>` : ''}
      </div>
    `;
  }

  function bindModuleActions(el, course) {
    el.querySelectorAll('[data-edit-mod]').forEach(b => b.addEventListener('click', () => openModuleForm(course, b.dataset.editMod)));
    el.querySelectorAll('[data-del-mod]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus modul ini?')) return;
      DB.deleteModule(b.dataset.delMod);
      UI.toast('Modul dihapus.');
      renderModulesTab(el, course);
    }));
  }

  function openModuleForm(course, editId) {
    const editing = editId ? DB.getModule(editId) : null;
    const sections = editing?.sections ? JSON.parse(JSON.stringify(editing.sections)) : [{ title: '', content: '' }];
    const render = () => {
      const body = `
        <form id="modForm" class="form">
          <div class="form-group"><label>Judul Modul</label>
            <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
          <div class="form-group"><label>Deskripsi</label>
            <input name="description" value="${UI.esc(editing?.description || '')}" /></div>
          <div class="form-group"><label>Tautan Eksternal (opsional)</label>
            <input name="link" type="url" value="${UI.esc(editing?.link || '')}" placeholder="https://..." /></div>
          <div class="form-group">
            <label>Bagian Modul</label>
            <div id="sectionsBox">
              ${sections.map((s, i) => `
                <div class="list-item" style="margin-bottom:8px;">
                  <div class="form-row">
                    <div class="form-group" style="margin:0;"><label>Judul Bagian ${i + 1}</label>
                      <input class="sec-title" data-i="${i}" value="${UI.esc(s.title)}" /></div>
                    <div style="display:flex;align-items:flex-end;">
                      <button type="button" class="btn btn-sm btn-danger" data-remove-sec="${i}">Hapus Bagian</button>
                    </div>
                  </div>
                  <div class="form-group" style="margin-bottom:0;"><label>Isi</label>
                    <textarea class="sec-content" data-i="${i}" rows="3">${UI.esc(s.content)}</textarea></div>
                </div>`).join('')}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" id="addSecBtn">+ Tambah Bagian</button>
          </div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>
      `;
      UI.modal.open(editing ? 'Edit Modul' : 'Tambah Modul', body);

      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      const readSectionsFromDom = () => {
        document.querySelectorAll('.sec-title').forEach(inp => { sections[Number(inp.dataset.i)].title = inp.value; });
        document.querySelectorAll('.sec-content').forEach(inp => { sections[Number(inp.dataset.i)].content = inp.value; });
      };
      document.getElementById('addSecBtn').addEventListener('click', () => {
        readSectionsFromDom();
        sections.push({ title: '', content: '' });
        render();
      });
      document.querySelectorAll('[data-remove-sec]').forEach(b => b.addEventListener('click', () => {
        readSectionsFromDom();
        sections.splice(Number(b.dataset.removeSec), 1);
        if (sections.length === 0) sections.push({ title: '', content: '' });
        render();
      }));

      document.getElementById('modForm').addEventListener('submit', (e) => {
        e.preventDefault();
        readSectionsFromDom();
        const fd = new FormData(e.target);
        const payload = {
          courseId: course.id,
          title: fd.get('title').trim(),
          description: fd.get('description').trim(),
          link: fd.get('link').trim(),
          sections: sections.filter(s => s.title.trim() || s.content.trim())
        };
        if (editing) DB.updateModule(editing.id, payload);
        else DB.addModule(payload);
        UI.toast('Modul disimpan.');
        UI.modal.close();
        renderModulesTab(document.getElementById('tabContent'), course);
      });
    };
    render();
  }

  /* ========== RECORDINGS (within course tab) ========== */
  function renderRecordingsTab(el, course) {
    const recs = DB.getRecordingsByCourse(course.id).slice().sort((a, b) => b.recordedAt - a.recordedAt);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Rekaman Kelas</h3>
          <button class="btn btn-primary btn-sm" id="addRecBtn">+ Tambah Rekaman</button></div>
        ${recs.length === 0 ? emptyState('Belum ada rekaman.') : recs.map(r => `
          <div class="list-item">
            <div class="flex-between">
              <div class="title">${UI.esc(r.title)}</div>
              <span class="muted small">${UI.fmtDate(r.recordedAt)} • ${UI.fmtDuration(r.duration)}</span>
            </div>
            ${Shared.videoEmbedHtml(r.url)}
            ${r.notes ? `<div class="content">${UI.esc(r.notes)}</div>` : ''}
            <div class="flex-gap mt-1">
              <button class="btn btn-sm btn-secondary" data-edit-rec="${r.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-del-rec="${r.id}">Hapus</button>
            </div>
          </div>`).join('')}
      </div>
    `;
    document.getElementById('addRecBtn').addEventListener('click', () => openRecordingForm(course));
    el.querySelectorAll('[data-edit-rec]').forEach(b => b.addEventListener('click', () => openRecordingForm(course, b.dataset.editRec)));
    el.querySelectorAll('[data-del-rec]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus rekaman ini?')) return;
      DB.deleteRecording(b.dataset.delRec);
      UI.toast('Rekaman dihapus.');
      renderRecordingsTab(el, course);
    }));
  }

  function openRecordingForm(course, editId) {
    const editing = editId ? DB.getRecordings().find(r => r.id === editId) : null;
    const body = `
      <form id="recForm" class="form">
        <div class="form-group"><label>Judul</label>
          <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
        <div class="form-group"><label>URL Video (YouTube, Vimeo, atau mp4)</label>
          <input name="url" type="url" required value="${UI.esc(editing?.url || '')}" placeholder="https://..." /></div>
        <div class="form-row">
          <div class="form-group"><label>Tanggal Rekam</label>
            <input name="date" type="date" required value="${UI.toDateInput(editing?.recordedAt || Date.now())}" /></div>
          <div class="form-group"><label>Durasi (menit)</label>
            <input name="duration" type="number" min="0" value="${editing ? Math.round((editing.duration || 0) / 60) : 60}" /></div>
        </div>
        <div class="form-group"><label>Catatan (opsional)</label>
          <textarea name="notes" rows="3">${UI.esc(editing?.notes || '')}</textarea></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Rekaman' : 'Tambah Rekaman', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('recForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        courseId: course.id,
        title: fd.get('title').trim(),
        url: fd.get('url').trim(),
        notes: fd.get('notes').trim(),
        duration: (Number(fd.get('duration')) || 0) * 60,
        recordedAt: new Date(fd.get('date')).getTime()
      };
      if (editing) DB.updateRecording(editing.id, payload);
      else DB.addRecording(payload);
      UI.toast('Rekaman disimpan.');
      UI.modal.close();
      renderRecordingsTab(document.getElementById('tabContent'), course);
    });
  }

  /* ========== CBT (within course tab) ========== */
  function renderCbtsTab(el, course, user) {
    const cbts = DB.getCbtsByCourse(course.id);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Ujian Online (CBT)</h3>
          <button class="btn btn-primary btn-sm" id="addCbtBtn">+ Buat Ujian</button></div>
        ${cbts.length === 0 ? emptyState('Belum ada ujian.') : cbts.map(c => {
          const attempts = DB.getCbtAttemptsByCbt(c.id);
          const submitted = attempts.filter(a => a.submittedAt).length;
          return `<div class="list-item">
            <div class="flex-between">
              <div class="title">${UI.esc(c.title)}</div>
              <span class="badge badge-info">${(c.questionIds || []).length} soal</span>
            </div>
            <div class="meta">${UI.fmtDateTime(c.startAt)} — ${UI.fmtDateTime(c.endAt)} • Durasi ${c.durationMinutes} menit</div>
            <div class="content">${UI.esc(c.description || '')}</div>
            <div class="muted small">Dikerjakan: ${submitted} siswa</div>
            <div class="flex-gap mt-1">
              <button class="btn btn-sm btn-primary" data-result-cbt="${c.id}">Hasil</button>
              <button class="btn btn-sm btn-secondary" data-edit-cbt="${c.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-del-cbt="${c.id}">Hapus</button>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
    document.getElementById('addCbtBtn').addEventListener('click', () => openCbtForm(course, user));
    el.querySelectorAll('[data-edit-cbt]').forEach(b => b.addEventListener('click', () => openCbtForm(course, user, b.dataset.editCbt)));
    el.querySelectorAll('[data-del-cbt]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus ujian dan semua hasil pengerjaannya?')) return;
      DB.deleteCbt(b.dataset.delCbt);
      UI.toast('Ujian dihapus.');
      renderCbtsTab(el, course, user);
    }));
    el.querySelectorAll('[data-result-cbt]').forEach(b => b.addEventListener('click', () => openCbtResults(b.dataset.resultCbt)));
  }

  function openCbtForm(course, user, editId) {
    const editing = editId ? DB.getCbt(editId) : null;
    const questions = DB.getQuestionsByAuthor(user.id);
    if (questions.length === 0) {
      UI.toast('Anda belum punya soal di Bank Soal. Tambahkan dulu!', 'error');
      return;
    }
    const selectedSet = new Set(editing?.questionIds || []);
    const body = `
      <form id="cbtForm" class="form">
        <div class="form-group"><label>Judul Ujian</label>
          <input name="title" required value="${UI.esc(editing?.title || '')}" /></div>
        <div class="form-group"><label>Deskripsi</label>
          <textarea name="description" rows="2">${UI.esc(editing?.description || '')}</textarea></div>
        <div class="form-row">
          <div class="form-group"><label>Mulai</label>
            <input name="startAt" type="datetime-local" required value="${UI.toDateTimeLocalInput(editing?.startAt || Date.now())}" /></div>
          <div class="form-group"><label>Selesai</label>
            <input name="endAt" type="datetime-local" required value="${UI.toDateTimeLocalInput(editing?.endAt || Date.now() + 7 * 86400000)}" /></div>
        </div>
        <div class="muted small" style="margin:-8px 0 10px;">Waktu dalam zona <strong>${UI.getTimezone()}</strong>. Siswa di zona waktu lain akan otomatis melihat konversi sesuai zona mereka.</div>
        <div class="form-group"><label>Durasi (menit)</label>
          <input name="duration" type="number" min="5" max="300" required value="${editing?.durationMinutes || 30}" /></div>
        <div class="form-group">
          <label>Pilih Soal dari Bank Soal (${questions.length} tersedia)</label>
          <div style="max-height:260px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:8px;">
            ${questions.map(q => `
              <label style="display:flex;gap:8px;padding:6px;border-bottom:1px solid var(--gray-100);">
                <input type="checkbox" name="qid" value="${q.id}" ${selectedSet.has(q.id) ? 'checked' : ''} />
                <div style="flex:1;">
                  <div style="font-size:13px;">${UI.esc(q.text)}</div>
                  <div class="muted small">${UI.esc(q.subject)} • ${UI.esc(q.difficulty || 'umum')}</div>
                </div>
              </label>`).join('')}
          </div>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Ujian' : 'Buat Ujian CBT', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('cbtForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const qids = fd.getAll('qid');
      if (qids.length === 0) {
        UI.toast('Pilih minimal 1 soal.', 'error');
        return;
      }
      const payload = {
        courseId: course.id,
        title: fd.get('title').trim(),
        description: fd.get('description').trim(),
        startAt: UI.tzInputToUtc(fd.get('startAt')),
        endAt: UI.tzInputToUtc(fd.get('endAt')),
        durationMinutes: Number(fd.get('duration')),
        questionIds: qids
      };
      if (editing) DB.updateCbt(editing.id, payload);
      else DB.addCbt(payload);
      UI.toast('Ujian disimpan.');
      UI.modal.close();
      renderCbtsTab(document.getElementById('tabContent'), course, user);
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

  /* ========== ATTENDANCE (within course tab) ========== */
  function renderAttendanceTab(el, course, user) {
    const todayYmd = UI.todayYMD();
    const dates = [...new Set(DB.getAttendanceByCourse(course.id).map(a => a.date))].sort((a, b) => b.localeCompare(a));
    if (!dates.includes(todayYmd)) dates.unshift(todayYmd);
    renderDate(dates[0]);

    function renderDate(selectedDate) {
      const enrollments = DB.getEnrollmentsByCourse(course.id);
      const STATUSES = ['hadir', 'izin', 'sakit', 'alfa'];
      el.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h3>Absensi Kelas</h3>
            <div class="filter-bar" style="margin:0;">
              <label class="muted small">Tanggal:</label>
              <input type="date" id="attDate" value="${selectedDate}" />
            </div>
          </div>
          <h4 style="margin-top:10px;">Absensi Guru (Diri Sendiri)</h4>
          <div class="att-grid">
            <div class="att-name">${UI.esc(user.name)}</div>
            <select class="att-input att-status-select" id="selfStatus">
              ${STATUSES.map(s => `<option value="${s}">${s.toUpperCase()}</option>`).join('')}
            </select>
            <input class="att-input" id="selfNote" placeholder="Catatan..." style="max-width:240px;" />
            <button class="btn btn-sm btn-primary" id="saveSelfAtt">Simpan</button>
          </div>

          <h4 style="margin-top:18px;">Absensi Siswa</h4>
          ${enrollments.length === 0 ? emptyState('Belum ada siswa terdaftar.') : `
          <div style="border:1px solid var(--gray-200);border-radius:var(--radius-sm);">
            ${enrollments.map(e => {
              const s = DB.getUser(e.studentId);
              if (!s) return '';
              const rec = DB.getAttendanceRecord(course.id, s.id, selectedDate);
              return `<div class="att-grid" data-student="${s.id}">
                <div class="att-name">${UI.esc(s.name)} <span class="muted small">(${UI.esc(s.kelas || '-')})</span></div>
                <select class="att-input att-status-select stu-status">
                  ${STATUSES.map(st => `<option value="${st}" ${rec && rec.status === st ? 'selected' : (!rec && st === 'hadir' ? 'selected' : '')}>${st.toUpperCase()}</option>`).join('')}
                </select>
                <input class="att-input stu-note" value="${UI.esc(rec?.note || '')}" placeholder="Catatan..." style="max-width:240px;" />
                <span class="muted small">${rec ? 'Tersimpan' : 'Baru'}</span>
              </div>`;
            }).join('')}
          </div>
          <button class="btn btn-primary mt-2" id="saveAllAtt">Simpan Semua Absensi</button>`}
        </div>
      `;

      // Prefill self
      const selfRec = DB.getAttendanceRecord(course.id, user.id, selectedDate);
      if (selfRec) {
        document.getElementById('selfStatus').value = selfRec.status;
        document.getElementById('selfNote').value = selfRec.note || '';
      }

      const saveSelf = () => {
        DB.upsertAttendance(course.id, user.id, 'guru', selectedDate,
          document.getElementById('selfStatus').value,
          document.getElementById('selfNote').value);
      };

      document.getElementById('attDate').addEventListener('change', (e) => renderDate(e.target.value));
      document.getElementById('saveSelfAtt').addEventListener('click', () => {
        saveSelf();
        UI.toast('Absensi Anda tersimpan.');
        renderDate(selectedDate);
      });
      const saveAll = document.getElementById('saveAllAtt');
      if (saveAll) saveAll.addEventListener('click', () => {
        // Bug fix: also persist guru self-attendance so the user doesn't lose
        // in-flight edits when only clicking "Simpan Semua Absensi Siswa".
        saveSelf();
        document.querySelectorAll('[data-student]').forEach(row => {
          const sid = row.dataset.student;
          const status = row.querySelector('.stu-status').value;
          const note = row.querySelector('.stu-note').value;
          DB.upsertAttendance(course.id, sid, 'siswa', selectedDate, status, note);
        });
        UI.toast('Absensi guru & siswa disimpan.');
        renderDate(selectedDate);
      });
    }
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
          ${moduleCardHtml(m, true)}
        </div>`;
      }).join('');
      list.querySelectorAll('[data-edit-mod]').forEach(b => b.addEventListener('click', () => {
        const m = DB.getModule(b.dataset.editMod);
        const c = DB.getCourse(m.courseId);
        openModuleForm(c, m.id);
      }));
      list.querySelectorAll('[data-del-mod]').forEach(b => b.addEventListener('click', () => {
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
            <span class="muted small">${UI.esc(c ? c.title : '-')} • ${UI.fmtDate(r.recordedAt)}</span>
          </div>
          ${Shared.videoEmbedHtml(r.url)}
          ${r.notes ? `<div class="content">${UI.esc(r.notes)}</div>` : ''}
        </div>`;
      }).join('');
    };
    document.getElementById('recCourseFilter').addEventListener('change', (e) => renderList(e.target.value));
    renderList('');
  }

  function renderBankSoal(container, user) {
    const questions = DB.getQuestionsByAuthor(user.id);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Bank Soal (${questions.length})</h3>
          <div class="flex-gap">
            <input type="search" id="qSearch" placeholder="Cari soal..." style="padding:8px 12px;border:1px solid var(--gray-300);border-radius:6px;" />
            <button class="btn btn-primary btn-sm" id="addQBtn">+ Tambah Soal</button>
          </div>
        </div>
        <div id="qList"></div>
      </div>
    `;
    const renderList = (query = '') => {
      const list = document.getElementById('qList');
      const filter = query.trim().toLowerCase();
      const filtered = questions.filter(q => !filter || q.text.toLowerCase().includes(filter) || (q.subject || '').toLowerCase().includes(filter));
      if (filtered.length === 0) { list.innerHTML = emptyState('Belum ada soal.'); return; }
      list.innerHTML = filtered.map((q, i) => `
        <div class="list-item">
          <div class="flex-between">
            <div>
              <span class="badge badge-info">${UI.esc(q.subject || '-')}</span>
              <span class="badge badge-gray">${UI.esc(q.difficulty || 'umum')}</span>
            </div>
            <div class="flex-gap">
              <button class="btn btn-sm btn-secondary" data-edit-q="${q.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-del-q="${q.id}">Hapus</button>
            </div>
          </div>
          <div class="title mt-1">${UI.esc(q.text)}</div>
          <div class="option-list">
            ${q.options.map((opt, oi) => `
              <div class="option-item ${oi === q.correctIndex ? 'correct' : ''}">
                <span class="letter">${String.fromCharCode(65 + oi)}.</span>
                <span>${UI.esc(opt)}</span>
              </div>`).join('')}
          </div>
          ${q.explanation ? `<div class="muted small mt-1"><strong>Pembahasan:</strong> ${UI.esc(q.explanation)}</div>` : ''}
        </div>
      `).join('');
      list.querySelectorAll('[data-edit-q]').forEach(b => b.addEventListener('click', () => openQuestionForm(user, b.dataset.editQ)));
      list.querySelectorAll('[data-del-q]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus soal? Soal juga dihapus dari ujian yang menggunakan.')) return;
        DB.deleteQuestion(b.dataset.delQ);
        UI.toast('Soal dihapus.');
        renderBankSoal(container, user);
      }));
    };
    document.getElementById('addQBtn').addEventListener('click', () => openQuestionForm(user));
    document.getElementById('qSearch').addEventListener('input', (e) => renderList(e.target.value));
    renderList();
  }

  function openQuestionForm(user, editId) {
    const editing = editId ? DB.getQuestion(editId) : null;
    const opts = editing?.options && editing.options.length >= 2 ? editing.options.slice() : ['', '', '', ''];
    while (opts.length < 4) opts.push('');
    const body = `
      <form id="qForm" class="form">
        <div class="form-row">
          <div class="form-group"><label>Mata Pelajaran</label>
            <input name="subject" required value="${UI.esc(editing?.subject || user.subject || '')}" /></div>
          <div class="form-group"><label>Tingkat Kesulitan</label>
            <select name="difficulty">
              ${['mudah', 'sedang', 'sulit'].map(d => `<option value="${d}" ${(editing?.difficulty || 'sedang') === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group"><label>Pertanyaan</label>
          <textarea name="text" required rows="3">${UI.esc(editing?.text || '')}</textarea></div>
        ${[0, 1, 2, 3].map(i => `
          <div class="form-group">
            <label>Pilihan ${String.fromCharCode(65 + i)} ${editing?.correctIndex === i ? '<span class="badge badge-success">Jawaban Benar</span>' : ''}</label>
            <input name="opt${i}" required value="${UI.esc(opts[i])}" />
          </div>`).join('')}
        <div class="form-group"><label>Jawaban Benar</label>
          <select name="correctIndex" required>
            ${[0, 1, 2, 3].map(i => `<option value="${i}" ${editing?.correctIndex === i ? 'selected' : ''}>Pilihan ${String.fromCharCode(65 + i)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Pembahasan (opsional)</label>
          <textarea name="explanation" rows="2">${UI.esc(editing?.explanation || '')}</textarea></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Soal' : 'Tambah Soal', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('qForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        authorId: user.id,
        subject: fd.get('subject').trim(),
        difficulty: fd.get('difficulty'),
        text: fd.get('text').trim(),
        options: [0, 1, 2, 3].map(i => fd.get('opt' + i).trim()),
        correctIndex: Number(fd.get('correctIndex')),
        explanation: fd.get('explanation').trim()
      };
      if (editing) DB.updateQuestion(editing.id, payload);
      else DB.addQuestion(payload);
      UI.toast('Soal disimpan.');
      UI.modal.close();
      renderBankSoal(document.getElementById('content'), user);
    });
  }

  function renderCbtSection(container, user) {
    const courses = DB.getCoursesByTeacher(user.id);
    const courseIds = courses.map(c => c.id);
    const cbts = DB.getCbts().filter(c => courseIds.includes(c.courseId));
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Semua Ujian CBT Saya (${cbts.length})</h3>
          <select id="cbtCourseFilter" class="form" style="max-width:220px;">
            <option value="">Semua Kelas</option>
            ${courses.map(c => `<option value="${c.id}">${UI.esc(c.title)}</option>`).join('')}
          </select>
        </div>
        <div id="cbtList"></div>
      </div>
    `;
    const renderList = (cid) => {
      const list = document.getElementById('cbtList');
      const filtered = cid ? cbts.filter(c => c.courseId === cid) : cbts;
      if (filtered.length === 0) { list.innerHTML = emptyState('Belum ada ujian.'); return; }
      list.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Ujian</th><th>Kelas</th><th>Soal</th><th>Durasi</th><th>Peserta</th><th>Rata-rata</th><th>Aksi</th></tr></thead>
        <tbody>${filtered.map(c => {
          const course = DB.getCourse(c.courseId);
          const attempts = DB.getCbtAttemptsByCbt(c.id).filter(a => a.submittedAt);
          const avg = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.score || 0), 0) / attempts.length) : null;
          return `<tr>
            <td><strong>${UI.esc(c.title)}</strong></td>
            <td>${UI.esc(course ? course.title : '-')}</td>
            <td>${(c.questionIds || []).length}</td>
            <td>${c.durationMinutes} mnt</td>
            <td>${attempts.length}</td>
            <td>${avg ?? '-'}</td>
            <td><button class="btn btn-sm btn-primary" data-result="${c.id}">Lihat Hasil</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>`;
      list.querySelectorAll('[data-result]').forEach(b => b.addEventListener('click', () => openCbtResults(b.dataset.result)));
    };
    document.getElementById('cbtCourseFilter').addEventListener('change', (e) => renderList(e.target.value));
    renderList('');
  }

  function renderAbsensiSection(container, user) {
    const courses = DB.getCoursesByTeacher(user.id);
    const courseIds = courses.map(c => c.id);
    // Summary stats — only count this user's records as guru role
    const myAtt = DB.getAttendanceByUser(user.id).filter(a => a.role === 'guru');
    const present = myAtt.filter(a => a.status === 'hadir').length;
    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Sesi</div><div class="value">${myAtt.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Hadir</div><div class="value">${present}</div></div>
        <div class="stat-card accent-warning"><div class="label">Kehadiran</div><div class="value">${myAtt.length ? Math.round(present / myAtt.length * 100) : 0}%</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Rekap Absensi Kelas Saya</h3>
          <select id="absCourseFilter" class="form" style="max-width:220px;">
            ${courses.map(c => `<option value="${c.id}">${UI.esc(c.title)}</option>`).join('')}
          </select>
        </div>
        <div id="absBox"></div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Riwayat Absensi Saya</h3></div>
        ${myAtt.length === 0 ? emptyState('Belum ada data absensi.') : `
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
      </div>
    `;

    const render = (cid) => {
      const box = document.getElementById('absBox');
      if (!cid) { box.innerHTML = emptyState('Pilih kelas.'); return; }
      const enrollments = DB.getEnrollmentsByCourse(cid);
      const att = DB.getAttendanceByCourse(cid).filter(a => a.role === 'siswa');
      if (enrollments.length === 0) { box.innerHTML = emptyState('Belum ada siswa.'); return; }
      const rows = enrollments.map(e => {
        const s = DB.getUser(e.studentId);
        const rec = att.filter(a => a.userId === e.studentId);
        const counts = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
        rec.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
        const total = rec.length;
        const pct = total ? Math.round(counts.hadir / total * 100) : 0;
        return { s, counts, total, pct };
      });
      box.innerHTML = `<div class="table-wrap"><table class="table">
        <thead><tr><th>Siswa</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Total</th><th>%</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td><strong>${UI.esc(r.s?.name || '-')}</strong></td>
          <td>${r.counts.hadir}</td>
          <td>${r.counts.izin}</td>
          <td>${r.counts.sakit}</td>
          <td>${r.counts.alfa}</td>
          <td>${r.total}</td>
          <td><strong>${r.pct}%</strong></td>
        </tr>`).join('')}</tbody></table></div>`;
    };
    if (courses.length > 0) {
      document.getElementById('absCourseFilter').addEventListener('change', (e) => render(e.target.value));
      render(courses[0].id);
    } else {
      document.getElementById('absBox').innerHTML = emptyState('Anda belum memiliki kelas.');
    }
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

  global.GuruPanel = { render };
})(window);
