/* ===== Admin Panel =====
 * Manage guru, siswa, courses, view stats, reset data.
 */
(function (global) {
  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container);
    if (section === 'guru') return renderUsers(container, 'guru');
    if (section === 'siswa') return renderUsers(container, 'siswa');
    if (section === 'courses') return renderCourses(container);
    if (section === 'settings') return renderSettings(container);
  }

  function renderOverview(container) {
    const users = DB.getUsers();
    const gurus = users.filter(u => u.role === 'guru');
    const siswas = users.filter(u => u.role === 'siswa');
    const courses = DB.getCourses();
    const assignments = DB.getAssignments();
    const submissions = DB.getSubmissions();
    const ungraded = submissions.filter(s => s.grade == null).length;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary">
          <div class="label">Total Guru</div>
          <div class="value">${gurus.length}</div>
          <div class="sub">Pengajar terdaftar</div>
        </div>
        <div class="stat-card accent-success">
          <div class="label">Total Siswa</div>
          <div class="value">${siswas.length}</div>
          <div class="sub">Peserta didik aktif</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Total Kelas</div>
          <div class="value">${courses.length}</div>
          <div class="sub">Kelas aktif di sistem</div>
        </div>
        <div class="stat-card accent-danger">
          <div class="label">Tugas Belum Dinilai</div>
          <div class="value">${ungraded}</div>
          <div class="sub">dari ${submissions.length} submission</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Kelas Terbaru</h3></div>
        ${courses.length === 0
          ? emptyState('Belum ada kelas.')
          : `<div class="table-wrap"><table class="table">
              <thead><tr><th>Judul</th><th>Guru</th><th>Kategori</th><th>Siswa</th><th>Dibuat</th></tr></thead>
              <tbody>${courses.slice().sort((a,b)=>b.createdAt-a.createdAt).slice(0,5).map(c => {
                const teacher = DB.getUser(c.teacherId);
                const count = DB.getEnrollmentsByCourse(c.id).length;
                return `<tr>
                  <td><strong>${UI.esc(c.title)}</strong></td>
                  <td>${UI.esc(teacher ? teacher.name : '-')}</td>
                  <td><span class="badge badge-info">${UI.esc(c.category || '-')}</span></td>
                  <td>${count}</td>
                  <td>${UI.fmtDate(c.createdAt)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>`}
      </div>

      <div class="card">
        <div class="card-header"><h3>Aktivitas Penilaian</h3></div>
        ${submissions.length === 0
          ? emptyState('Belum ada submission.')
          : `<div class="table-wrap"><table class="table">
              <thead><tr><th>Siswa</th><th>Tugas</th><th>Status</th><th>Nilai</th><th>Dikirim</th></tr></thead>
              <tbody>${submissions.slice().sort((a,b)=>b.submittedAt-a.submittedAt).slice(0,8).map(s => {
                const stud = DB.getUser(s.studentId);
                const asg = DB.getAssignment(s.assignmentId);
                return `<tr>
                  <td>${UI.esc(stud ? stud.name : '-')}</td>
                  <td>${UI.esc(asg ? asg.title : '-')}</td>
                  <td>${s.grade == null ? '<span class="badge badge-warning">Belum Dinilai</span>' : '<span class="badge badge-success">Selesai</span>'}</td>
                  <td>${s.grade == null ? '-' : s.grade}</td>
                  <td>${UI.fmtDateTime(s.submittedAt)}</td>
                </tr>`;
              }).join('')}</tbody></table></div>`}
      </div>
    `;
  }

  function renderUsers(container, role) {
    const list = DB.getUsers().filter(u => u.role === role);
    const isGuru = role === 'guru';
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${isGuru ? 'Daftar Guru' : 'Daftar Siswa'} (${list.length})</h3>
          <button class="btn btn-primary btn-sm" id="addUserBtn">+ Tambah ${isGuru ? 'Guru' : 'Siswa'}</button>
        </div>
        ${list.length === 0 ? emptyState('Belum ada data.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Nama</th><th>Username</th><th>Email</th><th>${isGuru ? 'Mapel' : 'Kelas'}</th><th>Aksi</th>
          </tr></thead>
          <tbody>
            ${list.map(u => `<tr>
              <td><strong>${UI.esc(u.name)}</strong></td>
              <td>${UI.esc(u.username)}</td>
              <td>${UI.esc(u.email || '-')}</td>
              <td>${UI.esc(isGuru ? (u.subject || '-') : (u.kelas || '-'))}</td>
              <td class="actions">
                <button class="btn btn-sm btn-secondary" data-edit="${u.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del="${u.id}">Hapus</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;

    document.getElementById('addUserBtn').addEventListener('click', () => openUserForm(role));
    container.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openUserForm(role, b.dataset.edit)));
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus pengguna ini? Data terkait akan ikut terhapus.')) return;
      DB.deleteUser(b.dataset.del);
      UI.toast('Pengguna dihapus.');
      renderUsers(container, role);
    }));
  }

  function openUserForm(role, editId) {
    const isGuru = role === 'guru';
    const editing = editId ? DB.getUser(editId) : null;
    const title = editing ? `Edit ${isGuru ? 'Guru' : 'Siswa'}` : `Tambah ${isGuru ? 'Guru' : 'Siswa'}`;
    const body = `
      <form id="userForm" class="form">
        <div class="form-group"><label>Nama Lengkap</label>
          <input name="name" required value="${UI.esc(editing?.name || '')}" /></div>
        <div class="form-row">
          <div class="form-group"><label>Username</label>
            <input name="username" required value="${UI.esc(editing?.username || '')}" ${editing ? 'readonly' : ''} /></div>
          <div class="form-group"><label>Email</label>
            <input type="email" name="email" required value="${UI.esc(editing?.email || '')}" /></div>
        </div>
        <div class="form-group"><label>${isGuru ? 'Mata Pelajaran' : 'Kelas'}</label>
          <input name="extra" value="${UI.esc(isGuru ? (editing?.subject || '') : (editing?.kelas || ''))}" /></div>
        <div class="form-group"><label>Password ${editing ? '(kosongkan jika tidak diubah)' : ''}</label>
          <input type="password" name="password" ${editing ? '' : 'required minlength="6"'} /></div>
        <div id="userFormError" class="alert alert-error hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(title, body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('userForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = fd.get('name').trim();
      const username = fd.get('username').trim();
      const email = fd.get('email').trim();
      const extra = fd.get('extra').trim();
      const password = fd.get('password');
      const err = document.getElementById('userFormError');
      err.classList.add('hidden');

      if (!editing) {
        if (DB.findUserByUsername(username)) {
          err.textContent = 'Username sudah dipakai.';
          err.classList.remove('hidden');
          return;
        }
        const record = { id: DB.uid('u'), role, name, username, email, password };
        if (isGuru) record.subject = extra; else record.kelas = extra;
        DB.addUser(record);
        UI.toast('Berhasil menambahkan.');
      } else {
        const patch = { name, email };
        if (isGuru) patch.subject = extra; else patch.kelas = extra;
        if (password) patch.password = password;
        DB.updateUser(editing.id, patch);
        UI.toast('Perubahan disimpan.');
      }
      UI.modal.close();
      const container = document.getElementById('content');
      renderUsers(container, role);
    });
  }

  function renderCourses(container) {
    const courses = DB.getCourses();
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Semua Kelas (${courses.length})</h3></div>
        ${courses.length === 0 ? emptyState('Belum ada kelas.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Judul</th><th>Kategori</th><th>Guru</th><th>Materi</th><th>Tugas</th><th>Siswa</th><th>Aksi</th></tr></thead>
          <tbody>
            ${courses.map(c => {
              const t = DB.getUser(c.teacherId);
              return `<tr>
                <td><strong>${UI.esc(c.title)}</strong><div class="small muted">${UI.esc(c.description)}</div></td>
                <td><span class="badge badge-info">${UI.esc(c.category || '-')}</span></td>
                <td>${UI.esc(t ? t.name : '-')}</td>
                <td>${DB.getMaterialsByCourse(c.id).length}</td>
                <td>${DB.getAssignmentsByCourse(c.id).length}</td>
                <td>${DB.getEnrollmentsByCourse(c.id).length}</td>
                <td><button class="btn btn-sm btn-danger" data-del="${c.id}">Hapus</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus kelas dan semua data terkait (materi, tugas, submission)?')) return;
      DB.deleteCourse(b.dataset.del);
      UI.toast('Kelas dihapus.');
      renderCourses(container);
    }));
  }

  function renderSettings(container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Pengaturan Sistem</h3></div>
        <p class="muted">Data LMS disimpan di browser Anda (localStorage). Gunakan tombol di bawah untuk mereset ke data contoh.</p>
        <div class="flex-gap">
          <button class="btn btn-danger" id="resetBtn">Reset Semua Data</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Tentang</h3></div>
        <p><strong>LMS Rubela</strong> v1.0 — Learning Management System sederhana berbasis web.</p>
        <p class="muted small">Dibuat dengan HTML, CSS, dan JavaScript murni.</p>
      </div>
    `;
    document.getElementById('resetBtn').addEventListener('click', () => {
      if (!UI.confirmDialog('Reset SEMUA data? Akun dan kelas akan kembali ke default.')) return;
      DB.resetAll();
      UI.toast('Data direset. Silakan login ulang.', 'info');
      setTimeout(Auth.logout, 800);
    });
  }

  function emptyState(msg) {
    return `<div class="empty"><div class="empty-icon">📭</div>${UI.esc(msg)}</div>`;
  }

  global.AdminPanel = { render };
})(window);
