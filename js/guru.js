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
    if (section === 'grading') return renderGrading(container, user);
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
        <div class="form-group"><label>Kategori</label>
          <input name="category" value="${UI.esc(editing?.category || '')}" placeholder="mis. Matematika" /></div>
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
        <button class="tab-btn" data-tab="assignments">Tugas (${assignments.length})</button>
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
    if (tab === 'assignments') return renderAssignmentsTab(el, course);
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

  global.GuruPanel = { render };
})(window);
