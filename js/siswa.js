/* ===== Siswa Panel =====
 * Browse + enroll courses, view materials, submit assignments, view grades.
 */
(function (global) {
  let currentCourseId = null;

  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container, user);
    if (section === 'my-courses') {
      if (currentCourseId) return renderCourseDetail(container, user);
      return renderMyCourses(container, user);
    }
    if (section === 'browse') return renderBrowse(container, user);
    if (section === 'assignments') return renderAssignments(container, user);
    if (section === 'grades') return renderGrades(container, user);
    if (section === 'profile') return renderProfile(container, user);
  }

  function renderOverview(container, user) {
    const enrolled = DB.getEnrollmentsByStudent(user.id);
    const enrolledCourses = enrolled.map(e => DB.getCourse(e.courseId)).filter(Boolean);
    const courseIds = enrolledCourses.map(c => c.id);
    const allAsg = DB.getAssignments().filter(a => courseIds.includes(a.courseId));
    const mySubs = DB.getSubmissionsByStudent(user.id);
    const submittedIds = new Set(mySubs.map(s => s.assignmentId));
    const pending = allAsg.filter(a => !submittedIds.has(a.id));
    const graded = mySubs.filter(s => s.grade != null);
    const avg = graded.length ? Math.round(graded.reduce((sum, s) => sum + s.grade, 0) / graded.length) : null;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary">
          <div class="label">Kelas Diikuti</div>
          <div class="value">${enrolledCourses.length}</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Tugas Pending</div>
          <div class="value">${pending.length}</div>
          <div class="sub">belum dikumpulkan</div>
        </div>
        <div class="stat-card accent-success">
          <div class="label">Tugas Selesai</div>
          <div class="value">${mySubs.length}</div>
          <div class="sub">${graded.length} sudah dinilai</div>
        </div>
        <div class="stat-card accent-danger">
          <div class="label">Rata-rata Nilai</div>
          <div class="value">${avg ?? '-'}</div>
          <div class="sub">dari ${graded.length} tugas dinilai</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>Tugas Akan Datang</h3>
          ${pending.length ? '<button class="btn btn-sm btn-secondary" id="viewAllAsg">Lihat Semua</button>' : ''}
        </div>
        ${pending.length === 0 ? emptyState('Tidak ada tugas tertunda. Kerja bagus!') :
          pending.sort((a, b) => a.dueDate - b.dueDate).slice(0, 5).map(a => {
            const course = DB.getCourse(a.courseId);
            const overdue = Date.now() > a.dueDate;
            return `<div class="list-item">
              <div class="flex-between">
                <div class="title">${UI.esc(a.title)}</div>
                <span class="badge ${overdue ? 'badge-warning' : 'badge-info'}">${overdue ? 'Terlambat' : 'Deadline'} ${UI.fmtDate(a.dueDate)}</span>
              </div>
              <div class="meta">${UI.esc(course ? course.title : '-')}</div>
              <button class="btn btn-sm btn-primary mt-1" data-goto-asg="${a.id}">Kerjakan</button>
            </div>`;
          }).join('')}
      </div>

      <div class="card">
        <div class="card-header"><h3>Kelas Saya</h3></div>
        ${enrolledCourses.length === 0 ?
          `<div class="empty"><div class="empty-icon">🔎</div>Belum bergabung kelas. <a href="#" id="goBrowse">Jelajahi kelas</a>.</div>` :
          `<div class="course-grid">${enrolledCourses.map((c, i) => courseCard(c, i)).join('')}</div>`}
      </div>
    `;

    const viewAll = document.getElementById('viewAllAsg');
    if (viewAll) viewAll.addEventListener('click', () => Dashboard.navigate('assignments'));
    const goBrowse = document.getElementById('goBrowse');
    if (goBrowse) goBrowse.addEventListener('click', (e) => { e.preventDefault(); Dashboard.navigate('browse'); });
    container.querySelectorAll('[data-goto-asg]').forEach(b => b.addEventListener('click', () => {
      Dashboard.navigate('assignments');
    }));
    container.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      currentCourseId = b.dataset.open;
      Dashboard.navigate('my-courses');
    }));
  }

  function courseCard(c, idx) {
    const t = DB.getUser(c.teacherId);
    const matCount = DB.getMaterialsByCourse(c.id).length;
    const asgCount = DB.getAssignmentsByCourse(c.id).length;
    return `
      <div class="course-card">
        <div class="course-banner ${UI.bannerClass(idx)}">${UI.esc((c.title || '?').slice(0, 1).toUpperCase())}</div>
        <div class="course-body">
          <h4>${UI.esc(c.title)}</h4>
          <div class="meta">${UI.esc(c.category || 'Umum')} • ${UI.esc(t ? t.name : '-')}</div>
          <p>${UI.esc(c.description)}</p>
        </div>
        <div class="course-footer">
          <span>${matCount} materi • ${asgCount} tugas</span>
          <button class="btn btn-sm btn-primary" data-open="${c.id}">Buka</button>
        </div>
      </div>
    `;
  }

  function renderMyCourses(container, user) {
    const enrolled = DB.getEnrollmentsByStudent(user.id);
    const courses = enrolled.map(e => DB.getCourse(e.courseId)).filter(Boolean);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Kelas yang Saya Ikuti (${courses.length})</h3>
          <button class="btn btn-secondary btn-sm" id="browseBtn">+ Gabung Kelas Baru</button>
        </div>
        ${courses.length === 0 ? emptyState('Belum bergabung ke kelas manapun.') :
          `<div class="course-grid">${courses.map((c, i) => courseCard(c, i)).join('')}</div>`}
      </div>
    `;
    document.getElementById('browseBtn').addEventListener('click', () => Dashboard.navigate('browse'));
    container.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      currentCourseId = b.dataset.open;
      Dashboard.navigate('my-courses');
    }));
  }

  function renderBrowse(container, user) {
    const all = DB.getCourses();
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Jelajah Kelas (${all.length})</h3>
          <input type="search" id="searchBox" placeholder="Cari kelas..." style="padding:8px 12px;border:1px solid var(--gray-300);border-radius:6px;max-width:240px;" />
        </div>
        <div id="browseList"></div>
      </div>
    `;
    const renderList = (q = '') => {
      const list = document.getElementById('browseList');
      const filter = q.trim().toLowerCase();
      const filtered = all.filter(c =>
        !filter || c.title.toLowerCase().includes(filter) || (c.category || '').toLowerCase().includes(filter) || (c.description || '').toLowerCase().includes(filter));
      if (filtered.length === 0) { list.innerHTML = emptyState('Tidak ada kelas cocok.'); return; }
      list.innerHTML = `<div class="course-grid">${filtered.map((c, i) => {
        const t = DB.getUser(c.teacherId);
        const enrolled = DB.isEnrolled(c.id, user.id);
        return `<div class="course-card">
          <div class="course-banner ${UI.bannerClass(i)}">${UI.esc((c.title || '?').slice(0, 1).toUpperCase())}</div>
          <div class="course-body">
            <h4>${UI.esc(c.title)}</h4>
            <div class="meta">${UI.esc(c.category || 'Umum')} • ${UI.esc(t ? t.name : '-')}</div>
            <p>${UI.esc(c.description)}</p>
          </div>
          <div class="course-footer">
            <span>${DB.getEnrollmentsByCourse(c.id).length} siswa</span>
            ${enrolled
              ? '<span class="badge badge-success">Sudah Bergabung</span>'
              : `<button class="btn btn-sm btn-primary" data-enroll="${c.id}">Gabung</button>`}
          </div>
        </div>`;
      }).join('')}</div>`;
      list.querySelectorAll('[data-enroll]').forEach(b => b.addEventListener('click', () => {
        DB.enroll(b.dataset.enroll, user.id);
        UI.toast('Berhasil bergabung ke kelas.');
        renderList(document.getElementById('searchBox').value);
      }));
    };
    renderList();
    document.getElementById('searchBox').addEventListener('input', (e) => renderList(e.target.value));
  }

  function renderCourseDetail(container, user) {
    const course = DB.getCourse(currentCourseId);
    if (!course || !DB.isEnrolled(course.id, user.id)) {
      currentCourseId = null;
      return renderMyCourses(container, user);
    }
    const teacher = DB.getUser(course.teacherId);
    const materials = DB.getMaterialsByCourse(course.id);
    const assignments = DB.getAssignmentsByCourse(course.id);

    container.innerHTML = `
      <div class="flex-between mb-2">
        <button class="btn btn-secondary btn-sm" id="backBtn">← Kembali</button>
        <button class="btn btn-danger btn-sm" id="leaveBtn">Keluar dari Kelas</button>
      </div>
      <div class="card">
        <h3 class="mt-0">${UI.esc(course.title)}</h3>
        <div class="muted small">${UI.esc(course.category || 'Umum')} • Guru: ${UI.esc(teacher ? teacher.name : '-')}</div>
        <p class="mt-2">${UI.esc(course.description)}</p>
      </div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="materials">Materi (${materials.length})</button>
        <button class="tab-btn" data-tab="assignments">Tugas (${assignments.length})</button>
      </div>
      <div id="tabContent"></div>
    `;
    document.getElementById('backBtn').addEventListener('click', () => {
      currentCourseId = null;
      Dashboard.navigate('my-courses');
    });
    document.getElementById('leaveBtn').addEventListener('click', () => {
      if (!UI.confirmDialog('Keluar dari kelas ini?')) return;
      DB.unenroll(course.id, user.id);
      currentCourseId = null;
      UI.toast('Keluar dari kelas.', 'info');
      Dashboard.navigate('my-courses');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.tab === 'materials') renderCourseMaterials(document.getElementById('tabContent'), course);
      else renderCourseAssignments(document.getElementById('tabContent'), course, user);
    }));
    renderCourseMaterials(document.getElementById('tabContent'), course);
  }

  function renderCourseMaterials(el, course) {
    const materials = DB.getMaterialsByCourse(course.id).slice().sort((a, b) => a.createdAt - b.createdAt);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Materi Pembelajaran</h3></div>
        ${materials.length === 0 ? emptyState('Guru belum mengunggah materi.') :
          materials.map(m => `
            <div class="list-item">
              <div class="title">${UI.esc(m.title)}</div>
              <div class="meta">${UI.fmtDate(m.createdAt)}</div>
              <div class="content">${UI.esc(m.content)}</div>
              ${m.link ? `<div><a href="${UI.esc(m.link)}" target="_blank" rel="noopener">Buka tautan →</a></div>` : ''}
            </div>`).join('')}
      </div>
    `;
  }

  function renderCourseAssignments(el, course, user) {
    const assignments = DB.getAssignmentsByCourse(course.id).slice().sort((a, b) => a.dueDate - b.dueDate);
    el.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Daftar Tugas</h3></div>
        ${assignments.length === 0 ? emptyState('Belum ada tugas.') :
          assignments.map(a => {
            const sub = DB.getSubmissionByStudent(a.id, user.id);
            const overdue = !sub && Date.now() > a.dueDate;
            let statusBadge = '<span class="badge badge-info">Belum Dikerjakan</span>';
            if (sub && sub.grade != null) statusBadge = `<span class="badge badge-success">Nilai: ${sub.grade}</span>`;
            else if (sub) statusBadge = '<span class="badge badge-warning">Menunggu Nilai</span>';
            else if (overdue) statusBadge = '<span class="badge badge-warning">Terlambat</span>';
            return `
              <div class="list-item">
                <div class="flex-between">
                  <div class="title">${UI.esc(a.title)}</div>
                  ${statusBadge}
                </div>
                <div class="meta">Deadline ${UI.fmtDate(a.dueDate)}</div>
                <div class="content">${UI.esc(a.description)}</div>
                ${sub ? `<div class="muted small">Dikirim ${UI.fmtDateTime(sub.submittedAt)}${sub.feedback ? ' • Feedback: ' + UI.esc(sub.feedback) : ''}</div>` : ''}
                <div class="flex-gap mt-1">
                  <button class="btn btn-sm btn-primary" data-submit="${a.id}">${sub ? 'Ubah Jawaban' : 'Kerjakan'}</button>
                </div>
              </div>
            `;
          }).join('')}
      </div>
    `;
    el.querySelectorAll('[data-submit]').forEach(b => b.addEventListener('click', () => openSubmitForm(b.dataset.submit, user)));
  }

  function openSubmitForm(assignmentId, user) {
    const asg = DB.getAssignment(assignmentId);
    const sub = DB.getSubmissionByStudent(assignmentId, user.id);
    const body = `
      <div class="muted small mb-1">${UI.esc(asg.title)} — Deadline ${UI.fmtDate(asg.dueDate)}</div>
      <div class="content mb-2" style="color:var(--gray-700);">${UI.esc(asg.description)}</div>
      <form id="submitForm" class="form">
        <div class="form-group"><label>Jawaban</label>
          <textarea name="content" required rows="8">${UI.esc(sub?.content || '')}</textarea></div>
        ${sub && sub.grade != null ? `
          <div class="alert alert-info">
            <strong>Nilai: ${sub.grade}</strong>${sub.feedback ? ` — ${UI.esc(sub.feedback)}` : ''}
          </div>` : ''}
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">${sub ? 'Perbarui' : 'Kirim'} Jawaban</button>
        </div>
      </form>
    `;
    UI.modal.open(sub ? 'Ubah Jawaban' : 'Kerjakan Tugas', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('submitForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const content = fd.get('content').trim();
      if (sub) {
        DB.updateSubmission(sub.id, { content, submittedAt: Date.now() });
      } else {
        DB.addSubmission({ assignmentId, studentId: user.id, content });
      }
      UI.toast('Jawaban terkirim.');
      UI.modal.close();
      // refresh the dashboard view
      const currentKey = document.querySelector('.side-nav a.active')?.dataset.key || 'assignments';
      Dashboard.navigate(currentKey);
    });
  }

  function renderAssignments(container, user) {
    const enrolled = DB.getEnrollmentsByStudent(user.id).map(e => e.courseId);
    const allAsg = DB.getAssignments().filter(a => enrolled.includes(a.courseId))
      .slice().sort((a, b) => a.dueDate - b.dueDate);
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Semua Tugas (${allAsg.length})</h3></div>
        ${allAsg.length === 0 ? emptyState('Belum ada tugas dari kelas yang diikuti.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Deadline</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${allAsg.map(a => {
              const c = DB.getCourse(a.courseId);
              const sub = DB.getSubmissionByStudent(a.id, user.id);
              const overdue = !sub && Date.now() > a.dueDate;
              let status = '<span class="badge badge-info">Belum</span>';
              if (sub && sub.grade != null) status = `<span class="badge badge-success">Nilai ${sub.grade}</span>`;
              else if (sub) status = '<span class="badge badge-warning">Menunggu Nilai</span>';
              else if (overdue) status = '<span class="badge badge-warning">Terlambat</span>';
              return `<tr>
                <td><strong>${UI.esc(a.title)}</strong></td>
                <td>${UI.esc(c ? c.title : '-')}</td>
                <td>${UI.fmtDate(a.dueDate)}</td>
                <td>${status}</td>
                <td><button class="btn btn-sm btn-primary" data-submit="${a.id}">${sub ? 'Lihat/Ubah' : 'Kerjakan'}</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
    container.querySelectorAll('[data-submit]').forEach(b => b.addEventListener('click', () => openSubmitForm(b.dataset.submit, user)));
  }

  function renderGrades(container, user) {
    const mySubs = DB.getSubmissionsByStudent(user.id).slice().sort((a, b) => b.submittedAt - a.submittedAt);
    const graded = mySubs.filter(s => s.grade != null);
    const avg = graded.length ? Math.round(graded.reduce((sum, s) => sum + s.grade, 0) / graded.length) : null;
    const best = graded.length ? Math.max(...graded.map(s => s.grade)) : null;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Tugas</div><div class="value">${mySubs.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Dinilai</div><div class="value">${graded.length}</div></div>
        <div class="stat-card accent-warning"><div class="label">Nilai Terbaik</div><div class="value">${best ?? '-'}</div></div>
        <div class="stat-card accent-danger"><div class="label">Rata-rata</div><div class="value">${avg ?? '-'}</div></div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Riwayat Nilai</h3></div>
        ${mySubs.length === 0 ? emptyState('Belum ada submission.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tugas</th><th>Kelas</th><th>Dikirim</th><th>Nilai</th><th>Feedback</th></tr></thead>
          <tbody>
            ${mySubs.map(s => {
              const a = DB.getAssignment(s.assignmentId);
              const c = a ? DB.getCourse(a.courseId) : null;
              return `<tr>
                <td><strong>${UI.esc(a ? a.title : '-')}</strong></td>
                <td>${UI.esc(c ? c.title : '-')}</td>
                <td>${UI.fmtDateTime(s.submittedAt)}</td>
                <td>${s.grade == null ? '<span class="badge badge-warning">Menunggu</span>' : `<strong>${s.grade}</strong>`}</td>
                <td class="muted small">${UI.esc(s.feedback || '-')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
  }

  function renderProfile(container, user) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Profil Saya</h3></div>
        <form id="profileForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Nama</label>
              <input name="name" required value="${UI.esc(user.name)}" /></div>
            <div class="form-group"><label>Username</label>
              <input value="${UI.esc(user.username)}" readonly /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Email</label>
              <input name="email" type="email" required value="${UI.esc(user.email || '')}" /></div>
            <div class="form-group"><label>Kelas</label>
              <input name="kelas" value="${UI.esc(user.kelas || '')}" /></div>
          </div>
          <div class="form-group"><label>Password Baru (kosongkan jika tidak diubah)</label>
            <input name="password" type="password" minlength="6" /></div>
          <button class="btn btn-primary" type="submit">Simpan Perubahan</button>
        </form>
      </div>
    `;
    document.getElementById('profileForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const patch = {
        name: fd.get('name').trim(),
        email: fd.get('email').trim(),
        kelas: fd.get('kelas').trim()
      };
      const pw = fd.get('password');
      if (pw) patch.password = pw;
      DB.updateUser(user.id, patch);
      UI.toast('Profil diperbarui.');
      setTimeout(() => location.reload(), 500);
    });
  }

  function emptyState(msg) {
    return `<div class="empty"><div class="empty-icon">📭</div>${msg}</div>`;
  }

  global.SiswaPanel = { render };
})(window);
