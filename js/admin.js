/* ===== Admin Panel =====
 * Manage guru, siswa, courses, view stats, reset data.
 */
(function (global) {
  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container);
    if (section === 'guru') return renderUsers(container, 'guru');
    if (section === 'siswa') return renderUsers(container, 'siswa');
    if (section === 'orangtua') return renderParents(container);
    if (section === 'courses') return renderCourses(container);
    // CBT & Bank Soal kini memakai workspace khusus (js/cbt.js)
    if (section === 'admin-cbt') return CbtAdmin.renderCbtHome(container, user);
    if (section === 'admin-bank-soal') return CbtAdmin.renderBankHome(container, user);
    if (section === 'jadwal-kelas') return renderJadwalKelas(container);
    if (section === 'batch') return renderBatch(container);
    if (section === 'alumni') return renderAlumni(container);
    if (section === 'attendance') return renderAttendance(container, user);
    if (section === 'rekap') return renderRekap(container);
    if (section === 'leaderboard') return Shared.renderLeaderboard(container, user);
    if (section === 'kalender') return Shared.renderCalendar(container, user);
    if (section === 'pengumuman') return Shared.renderAnnouncements(container, user);
    if (section === 'feedback') return Shared.renderFeedback(container, user);
    if (section === 'chat') return Shared.renderChat(container, user);
    if (section === 'ai-analytics') return Shared.renderAiAnalytics(container, user);
    if (section === 'keuangan') return renderKeuangan(container);
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
    const cbts = DB.getCbts();
    const attempts = DB.getCbtAttempts().filter(a => a.submittedAt);
    const income = DB.getPayments().filter(p => p.status === 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
    const expense = DB.getExpenses().reduce((s, e) => s + (e.amount || 0), 0)
                  + DB.getSalaries().filter(s => s.status === 'dibayar').reduce((s, p) => s + (p.amount || 0), 0);
    const profit = income - expense;
    const parents = DB.getParents();
    const lockedCourses = courses.filter(c => DB.hasCoursePassword(c.id)).length;
    const todayAtt = DB.getAttendance().filter(a => a.date === UI.todayYMD()).length;

    container.innerHTML = `
      <section class="welcome-hero hero-admin">
        <span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">${UI.esc(UI.greeting())} • ${UI.esc(UI.fmtFullDateTime(UI.nowInTz()))}</div>
          <h2>Selamat Datang, <span class="hl">Administrator</span></h2>
          <p class="wh-sub">Pusat kendali LMS Rubela — kelola guru, siswa, orang tua, kelas, presensi, dan keuangan dari satu tempat.</p>
          <div class="wh-chips">
            <span class="wh-chip">👨‍🏫 ${gurus.length} guru</span>
            <span class="wh-chip">👨‍🎓 ${siswas.length} siswa</span>
            <span class="wh-chip">👨‍👩‍👦 ${parents.length} orang tua</span>
            <span class="wh-chip">🔒 ${lockedCourses}/${courses.length} kelas terkunci</span>
            <span class="wh-chip">📋 ${todayAtt} presensi hari ini</span>
          </div>
          <div class="wh-cta flex-gap">
            <button class="btn btn-ghost btn-sm" id="heroAttendance">Ambil Presensi</button>
            <button class="btn btn-ghost btn-sm" id="heroParents">Kelola Orang Tua</button>
            <button class="btn btn-ghost btn-sm" id="heroLeaderboard">Papan Peringkat</button>
          </div>
        </div>
      </section>

      <div class="stats-grid">
        <div class="stat-card accent-primary is-clickable" id="kpiGuru">
          <div class="label">Total Guru</div>
          <div class="value">${gurus.length}</div>
          <div class="sub">Pengajar terdaftar</div>
        </div>
        <div class="stat-card accent-success is-clickable" id="kpiSiswa">
          <div class="label">Total Siswa</div>
          <div class="value">${siswas.length}</div>
          <div class="sub">Peserta didik aktif</div>
        </div>
        <div class="stat-card accent-warning is-clickable" id="kpiCourses">
          <div class="label">Total Kelas</div>
          <div class="value">${courses.length}</div>
          <div class="sub">Kelas aktif di sistem</div>
        </div>
        <div class="stat-card accent-danger is-clickable" id="kpiUngraded">
          <div class="label">Belum Dinilai</div>
          <div class="value">${ungraded}</div>
          <div class="sub">dari ${submissions.length} submission</div>
        </div>
      </div>

      <div class="finance-summary">
        <div class="fin-card income">
          <div class="label">Total Pemasukan</div>
          <div class="value">${UI.fmtRp(income)}</div>
        </div>
        <div class="fin-card expense">
          <div class="label">Total Pengeluaran</div>
          <div class="value">${UI.fmtRp(expense)}</div>
        </div>
        <div class="fin-card profit">
          <div class="label">Laba Bersih</div>
          <div class="value">${UI.fmtRp(profit)}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card accent-primary is-clickable" id="kpiCbt">
          <div class="label">Total CBT</div>
          <div class="value">${cbts.length}</div>
          <div class="sub">${attempts.length} pengerjaan selesai</div>
        </div>
        <div class="stat-card accent-success">
          <div class="label">Total Tugas</div>
          <div class="value">${assignments.length}</div>
          <div class="sub">Tersebar di ${courses.length} kelas</div>
        </div>
        <div class="stat-card accent-warning">
          <div class="label">Total Modul</div>
          <div class="value">${DB.getModules().length}</div>
          <div class="sub">${DB.getRecordings().length} rekaman</div>
        </div>
        <div class="stat-card accent-danger is-clickable" id="kpiBankSoal">
          <div class="label">Bank Soal</div>
          <div class="value">${DB.getQuestions().length}</div>
          <div class="sub">Total soal di bank soal</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('📚', 'Kelas Terbaru', 'Lima kelas yang paling baru dibuat')}
          <button class="btn btn-sm btn-secondary" id="heroCourses">Kelola Semua Kelas</button>
        </div>
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
    `;

    document.getElementById('heroAttendance').addEventListener('click', () => Dashboard.navigate('attendance'));
    document.getElementById('heroParents').addEventListener('click', () => Dashboard.navigate('orangtua'));
    document.getElementById('heroLeaderboard').addEventListener('click', () => Dashboard.navigate('leaderboard'));
    document.getElementById('heroCourses').addEventListener('click', () => Dashboard.navigate('courses'));
    // Kartu KPI dapat diklik seperti pada panel peran lain
    const jump = { kpiGuru: 'guru', kpiSiswa: 'siswa', kpiCourses: 'courses', kpiUngraded: 'rekap', kpiCbt: 'admin-cbt', kpiBankSoal: 'admin-bank-soal' };
    Object.keys(jump).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => Dashboard.navigate(jump[id]));
    });
  }

  function renderUsers(container, role) {
    const list = DB.getUsers().filter(u => u.role === role);
    const isGuru = role === 'guru';
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>${isGuru ? 'Daftar Guru' : 'Daftar Siswa'} (${list.length})</h3>
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="exportBtn">Export Excel</button>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;">Import Excel
              <input type="file" id="importFile" accept=".xlsx,.xls,.csv" style="display:none;" />
            </label>
            <button class="btn btn-primary btn-sm" id="addUserBtn">+ Tambah ${isGuru ? 'Guru' : 'Siswa'}</button>
          </div>
        </div>
        <details class="demo-accounts" style="margin:0 0 14px;">
          <summary>Format kolom Excel untuk import ${isGuru ? 'guru' : 'siswa'}</summary>
          <p class="muted small" style="margin:8px 0 0;">
            Kolom yang dikenali: <strong>Nama</strong>, <strong>Username</strong>, <strong>Password</strong>, <strong>Email</strong>,
            ${isGuru
              ? '<strong>WhatsApp</strong>, <strong>Subtest</strong>, <strong>Tarif Gaji</strong>'
              : '<strong>Telepon</strong>, <strong>Kelas</strong>, <strong>Universitas Tujuan</strong>, <strong>Jurusan Tujuan</strong>'},
            dan <strong>Status</strong>. Klik <em>Export Excel</em> untuk mendapatkan template dengan kolom lengkap.
            Bila kolom <strong>Password</strong> dikosongkan, akun dibuat dengan password <code>password123</code>.
          </p>
        </details>
        ${list.length === 0 ? emptyState('Belum ada data.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Nama</th><th>Username</th><th>${isGuru ? 'Subtest' : 'Kelas'}</th><th>${isGuru ? 'WhatsApp' : 'Telepon'}</th><th>Status</th><th>Aksi</th>
          </tr></thead>
          <tbody>
            ${list.map(u => {
              const statusBadge = (u.status || 'Aktif') === 'Aktif' ? 'badge-success'
                : (u.status === 'Nonaktif' ? 'badge-warning' : 'badge-gray');
              return `<tr>
              <td><strong>${UI.esc(u.name)}</strong><div class="muted small">${UI.esc(u.email || '-')}</div></td>
              <td>${UI.esc(u.username)}</td>
              <td>${UI.esc(isGuru ? (u.subject || '-') : (u.kelas || '-'))}</td>
              <td>${UI.esc(isGuru ? (u.whatsapp || '-') : (u.phone || '-'))}</td>
              <td><span class="badge ${statusBadge}">${UI.esc(u.status || 'Aktif')}</span></td>
              <td class="actions">
                <button class="btn btn-sm btn-secondary" data-edit="${u.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del="${u.id}">Hapus</button>
              </td>
            </tr>`;
            }).join('')}
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

    // Export Excel
    document.getElementById('exportBtn').addEventListener('click', () => {
      const users = DB.getUsers().filter(u => u.role === role);
      let rows;
      if (isGuru) {
        rows = users.map(u => ({
          Nama: u.name, Username: u.username, Password: u.password || '', Email: u.email || '',
          WhatsApp: u.whatsapp || '', Subtest: u.subject || '',
          'Tarif Gaji': u.salaryRate || 0, Status: u.status || 'Aktif'
        }));
      } else {
        rows = users.map(u => ({
          Nama: u.name, Username: u.username, Password: u.password || '', Email: u.email || '',
          Telepon: u.phone || '', Kelas: u.kelas || '',
          'Universitas Tujuan': u.targetUniv || '', 'Jurusan Tujuan': u.targetMajor || '',
          Status: u.status || 'Aktif'
        }));
      }
      // Baris contoh agar kolom tetap terlihat walau data masih kosong
      if (rows.length === 0) {
        rows = [isGuru
          ? { Nama: 'Contoh Guru', Username: 'guru_baru', Password: 'password123', Email: 'guru@rubela.edu',
              WhatsApp: '08123456789', Subtest: DB.SUBTESTS[0].name, 'Tarif Gaji': 3000000, Status: 'Aktif' }
          : { Nama: 'Contoh Siswa', Username: 'siswa_baru', Password: 'password123', Email: 'siswa@rubela.edu',
              Telepon: '08123456789', Kelas: (DB.getClassOptions()[0] || 'X-A'),
              'Universitas Tujuan': 'Universitas Indonesia', 'Jurusan Tujuan': 'Teknik Informatika', Status: 'Aktif' }];
      }
      if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat. Coba reload halaman.', 'error'); return; }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isGuru ? 'Guru' : 'Siswa');
      XLSX.writeFile(wb, `data_${role}_${UI.todayYMD()}.xlsx`);
      UI.toast('File Excel berhasil diunduh (termasuk kolom Password).');
    });

    // Import Excel
    document.getElementById('importFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws);
          if (rows.length === 0) { UI.toast('File kosong atau format tidak sesuai.', 'error'); return; }
          let added = 0, skipped = 0, defaultPw = 0;
          rows.forEach(row => {
            const name = (row.Nama || row.nama || '').trim();
            const username = (row.Username || row.username || '').trim();
            const email = (row.Email || row.email || '').trim();
            if (!name || !username) { skipped++; return; }
            if (DB.findUserByUsername(username)) { skipped++; return; }
            // Password diambil dari kolom Excel; bila kosong pakai default
            const pwRaw = String(row.Password || row.password || row.Sandi || row.sandi || '').trim();
            const password = pwRaw || 'password123';
            if (!pwRaw) defaultPw++;
            const record = { id: DB.uid('u'), role, name, username, email, password, status: (row.Status || row.status || 'Aktif') };
            if (isGuru) {
              record.subject = row.Subtest || row.subtest || row['Mata Pelajaran'] || '';
              record.whatsapp = String(row.WhatsApp || row.whatsapp || row.WA || '');
              record.salaryRate = Number(row['Tarif Gaji'] || row.salaryRate || 0);
            } else {
              record.kelas = row.Kelas || row.kelas || '';
              record.phone = String(row.Telepon || row.telepon || row.Phone || row.phone || '');
              record.targetUniv = row['Universitas Tujuan'] || row.targetUniv || '';
              record.targetMajor = row['Jurusan Tujuan'] || row.targetMajor || '';
            }
            DB.addUser(record);
            added++;
          });
          UI.toast(`Import selesai: ${added} ditambahkan, ${skipped} dilewati (duplikat/kosong).` +
            (defaultPw ? ` ${defaultPw} akun tanpa kolom Password memakai "password123".` : ''),
            added > 0 ? 'success' : 'info');
          renderUsers(container, role);
        } catch (err) {
          UI.toast('Gagal membaca file: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = ''; // reset input
    });
  }

  function openUserForm(role, editId) {
    const isGuru = role === 'guru';
    const editing = editId ? DB.getUser(editId) : null;
    const title = editing ? `Edit ${isGuru ? 'Guru' : 'Siswa'}` : `Tambah ${isGuru ? 'Guru' : 'Siswa'}`;

    // Subtest options for guru
    const SUBTESTS = [
      'Penalaran Umum (PU)',
      'Pengetahuan dan Pemahaman Umum (PPU)',
      'Kemampuan Memahami Bacaan dan Menulis (PBM)',
      'Pengetahuan Kuantitatif (PK)',
      'Literasi dalam Bahasa Indonesia',
      'Literasi dalam Bahasa Inggris',
      'Penalaran Matematika'
    ];

    // Status options
    const STATUSES = ['Aktif', 'Nonaktif', 'Dikeluarkan'];

    // Class options from settings (admin-configurable)
    const CLASS_OPTIONS = DB.getClassOptions ? DB.getClassOptions() : ['X-A', 'X-B', 'XI-A', 'XI-B', 'XII-A', 'XII-B'];

    let body;
    if (isGuru) {
      body = `
        <form id="userForm" class="form">
          <div class="form-group"><label>Nama Lengkap</label>
            <input name="name" required value="${UI.esc(editing?.name || '')}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Username</label>
              <input name="username" required value="${UI.esc(editing?.username || '')}" ${editing ? 'readonly' : ''} /></div>
            <div class="form-group"><label>Email</label>
              <input type="email" name="email" required value="${UI.esc(editing?.email || '')}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>No. WhatsApp</label>
              <input name="whatsapp" type="tel" placeholder="08xxxxxxxxxx" value="${UI.esc(editing?.whatsapp || '')}" /></div>
            <div class="form-group"><label>Status</label>
              <select name="status">
                ${STATUSES.map(s => `<option value="${s}" ${(editing?.status || 'Aktif') === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-group"><label>Guru Subtest</label>
            <select name="subject" required>
              <option value="">-- Pilih Subtest --</option>
              ${SUBTESTS.map(s => `<option value="${s}" ${editing?.subject === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Tarif Gaji per Bulan (Rp)</label>
            <input name="salaryRate" type="number" min="0" value="${editing?.salaryRate || 0}" /></div>
          <div class="form-group"><label>Password ${editing ? '(kosongkan jika tidak diubah)' : ''}</label>
            <input type="password" name="password" ${editing ? '' : 'required minlength="6"'} /></div>
          <div id="userFormError" class="alert alert-error hidden"></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
    } else {
      body = `
        <form id="userForm" class="form">
          <div class="form-group"><label>Nama Lengkap</label>
            <input name="name" required value="${UI.esc(editing?.name || '')}" /></div>
          <div class="form-row">
            <div class="form-group"><label>Username</label>
              <input name="username" required value="${UI.esc(editing?.username || '')}" ${editing ? 'readonly' : ''} /></div>
            <div class="form-group"><label>Email</label>
              <input type="email" name="email" required value="${UI.esc(editing?.email || '')}" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>No. Telepon</label>
              <input name="phone" type="tel" placeholder="08xxxxxxxxxx" value="${UI.esc(editing?.phone || '')}" /></div>
            <div class="form-group"><label>Status</label>
              <select name="status">
                ${STATUSES.map(s => `<option value="${s}" ${(editing?.status || 'Aktif') === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Kelas</label>
              <select name="kelas">
                <option value="">-- Pilih Kelas --</option>
                ${CLASS_OPTIONS.map(c => `<option value="${c}" ${editing?.kelas === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Tujuan Universitas</label>
              <input name="targetUniv" value="${UI.esc(editing?.targetUniv || '')}" placeholder="Nama universitas tujuan" /></div>
          </div>
          <div class="form-group"><label>Jurusan Tujuan</label>
            <input name="targetMajor" value="${UI.esc(editing?.targetMajor || '')}" placeholder="Jurusan yang dituju" /></div>
          <div class="form-group"><label>Password ${editing ? '(kosongkan jika tidak diubah)' : ''}</label>
            <input type="password" name="password" ${editing ? '' : 'required minlength="6"'} /></div>
          <div id="userFormError" class="alert alert-error hidden"></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
    }

    UI.modal.open(title, body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('userForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = fd.get('name').trim();
      const username = fd.get('username').trim();
      const email = fd.get('email').trim();
      const password = fd.get('password');
      const status = fd.get('status');
      const err = document.getElementById('userFormError');
      err.classList.add('hidden');

      if (!editing) {
        if (DB.findUserByUsername(username)) {
          err.textContent = 'Username sudah dipakai.';
          err.classList.remove('hidden');
          return;
        }
        const record = { id: DB.uid('u'), role, name, username, email, password, status };
        if (isGuru) {
          record.subject = fd.get('subject');
          record.whatsapp = fd.get('whatsapp').trim();
          record.salaryRate = Number(fd.get('salaryRate') || 0);
        } else {
          record.kelas = fd.get('kelas');
          record.phone = fd.get('phone').trim();
          record.targetUniv = fd.get('targetUniv').trim();
          record.targetMajor = fd.get('targetMajor').trim();
        }
        DB.addUser(record);
        UI.toast('Berhasil menambahkan.');
      } else {
        const patch = { name, email, status };
        if (isGuru) {
          patch.subject = fd.get('subject');
          patch.whatsapp = fd.get('whatsapp').trim();
          patch.salaryRate = Number(fd.get('salaryRate') || 0);
        } else {
          patch.kelas = fd.get('kelas');
          patch.phone = fd.get('phone').trim();
          patch.targetUniv = fd.get('targetUniv').trim();
          patch.targetMajor = fd.get('targetMajor').trim();
        }
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
    const gurus = DB.getUsers().filter(u => u.role === 'guru');
    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Semua Kelas (${courses.length})</h3>
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="exportCourseBtn">Export Excel</button>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;">Import Excel
              <input type="file" id="importCourseFile" accept=".xlsx,.xls,.csv" style="display:none;" />
            </label>
            <button class="btn btn-primary btn-sm" id="adminAddCourseBtn">+ Buat Kelas Baru</button>
          </div>
        </div>
        <details class="demo-accounts" style="margin:0 0 14px;">
          <summary>Format kolom Excel untuk import kelas</summary>
          <p class="muted small" style="margin:8px 0 0;">
            Kolom yang dikenali: <strong>Judul Kelas</strong>, <strong>Kategori</strong>, <strong>Deskripsi</strong>,
            <strong>Biaya</strong>, <strong>Password</strong>, dan <strong>Username Guru</strong> (username akun guru pengajar).
            Judul boleh salah satu dari 7 subtest UTBK atau judul bebas. Kelas dengan judul yang sudah ada akan dilewati.
          </p>
        </details>
        ${courses.length === 0 ? emptyState('Belum ada kelas.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Judul</th><th>Kategori</th><th>Guru</th><th>Password</th><th>Materi</th><th>Tugas</th><th>Siswa</th><th>Aksi</th></tr></thead>
          <tbody>
            ${courses.map(c => {
              const t = DB.getUser(c.teacherId);
              const enrollCount = DB.getEnrollmentsByCourse(c.id).length;
              const locked = DB.hasCoursePassword(c.id);
              return `<tr>
                <td><strong>${UI.esc(c.title)}</strong><div class="small muted">${UI.esc(c.description)}</div></td>
                <td><span class="badge badge-info">${UI.esc(c.category || '-')}</span></td>
                <td>${UI.esc(t ? t.name : '-')}</td>
                <td>${locked
                  ? `<span class="badge badge-warning" title="Password kelas">🔒 ${UI.esc(c.password)}</span>`
                  : '<span class="badge badge-gray">Terbuka</span>'}
                  <button class="btn btn-sm btn-secondary" data-set-pw="${c.id}" style="margin-left:6px;">Atur</button>
                </td>
                <td>${DB.getMaterialsByCourse(c.id).length}</td>
                <td>${DB.getAssignmentsByCourse(c.id).length}</td>
                <td>${enrollCount}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-primary" data-manage-students="${c.id}">Kelola Siswa</button>
                  <button class="btn btn-sm btn-secondary" data-edit-course="${c.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del="${c.id}">Hapus</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;

    container.querySelectorAll('[data-set-pw]').forEach(b => b.addEventListener('click', () => {
      Shared.openCoursePasswordForm(b.dataset.setPw, () => renderCourses(container));
    }));

    /* ---- Export Excel kelas ---- */
    document.getElementById('exportCourseBtn').addEventListener('click', () => {
      if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat. Coba reload halaman.', 'error'); return; }
      let rows = DB.getCourses().map(c => {
        const t = DB.getUser(c.teacherId);
        return {
          'Judul Kelas': c.title,
          Kategori: c.category || '',
          Deskripsi: c.description || '',
          Biaya: c.price || 0,
          Password: c.password || '',
          'Username Guru': t ? t.username : '',
          'Nama Guru': t ? t.name : '',
          'Jumlah Siswa': DB.getEnrollmentsByCourse(c.id).length
        };
      });
      if (rows.length === 0) {
        const g = DB.getUsers().find(u => u.role === 'guru');
        rows = [{
          'Judul Kelas': DB.SUBTESTS[0].name, Kategori: 'TPS', Deskripsi: 'Kelas persiapan Penalaran Umum.',
          Biaya: 500000, Password: 'pu2026', 'Username Guru': g ? g.username : 'guru1',
          'Nama Guru': g ? g.name : '', 'Jumlah Siswa': 0
        }];
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Kelas');
      XLSX.writeFile(wb, `data_kelas_${UI.todayYMD()}.xlsx`);
      UI.toast('File Excel kelas berhasil diunduh.');
    });

    /* ---- Import Excel kelas ---- */
    document.getElementById('importCourseFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          if (rows.length === 0) { UI.toast('File kosong atau format tidak sesuai.', 'error'); return; }

          const existingTitles = new Set(DB.getCourses().map(c => c.title.toLowerCase()));
          const gurus = DB.getUsers().filter(u => u.role === 'guru');
          let added = 0, skipped = 0, noTeacher = 0;

          rows.forEach(row => {
            const title = String(row['Judul Kelas'] || row.Judul || row.judul || row.Title || '').trim();
            if (!title) { skipped++; return; }
            if (existingTitles.has(title.toLowerCase())) { skipped++; return; }

            const uname = String(row['Username Guru'] || row['username guru'] || row.Guru || row.guru || '').trim();
            let teacher = uname ? DB.findUserByUsername(uname) : null;
            if (!teacher || teacher.role !== 'guru') {
              teacher = gurus[0] || null;
              if (uname) noTeacher++;
            }
            if (!teacher) { skipped++; return; }

            DB.addCourse({
              title,
              category: String(row.Kategori || row.kategori || row.Category || '').trim(),
              description: String(row.Deskripsi || row.deskripsi || row.Description || '').trim() || title,
              price: Number(row.Biaya || row.biaya || row.Price || row.harga || 0) || 0,
              password: String(row.Password || row.password || '').trim(),
              teacherId: teacher.id
            });
            existingTitles.add(title.toLowerCase());
            added++;
          });

          let msg = `Import selesai: ${added} kelas ditambahkan, ${skipped} dilewati (duplikat/kosong).`;
          if (noTeacher) msg += ` ${noTeacher} baris memakai guru default karena username guru tidak ditemukan.`;
          UI.toast(msg, added > 0 ? 'success' : 'info');
          renderCourses(container);
        } catch (err) {
          UI.toast('Gagal membaca file: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    });

    // Add course
    document.getElementById('adminAddCourseBtn').addEventListener('click', () => openAdminCourseForm(container));
    // Edit course
    container.querySelectorAll('[data-edit-course]').forEach(b => b.addEventListener('click', () => openAdminCourseForm(container, b.dataset.editCourse)));
    // Delete course
    container.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus kelas dan semua data terkait (materi, tugas, submission)?')) return;
      DB.deleteCourse(b.dataset.del);
      UI.toast('Kelas dihapus.');
      renderCourses(container);
    }));
    // Manage students
    container.querySelectorAll('[data-manage-students]').forEach(b => b.addEventListener('click', () => {
      openBulkEnrollModal(b.dataset.manageStudents, container);
    }));
  }

  function openAdminCourseForm(container, editId) {
    const editing = editId ? DB.getCourse(editId) : null;
    const gurus = DB.getUsers().filter(u => u.role === 'guru' && (u.status || 'Aktif') === 'Aktif');
    // Judul kelas: pilih salah satu subtest UTBK, atau "Lainnya" untuk diketik manual
    const isPreset = editing ? DB.SUBTEST_NAMES.includes(editing.title) : false;
    const body = `
      <form id="adminCourseForm" class="form">
        <div class="form-group">
          <label>Judul Kelas</label>
          <select name="titlePreset" id="titlePreset">
            <option value="">-- Pilih Subtest UTBK --</option>
            ${DB.SUBTESTS.map(s => `<option value="${UI.esc(s.name)}" ${isPreset && editing.title === s.name ? 'selected' : ''}>${s.icon} ${UI.esc(s.name)}</option>`).join('')}
            <option value="__OTHER__" ${editing && !isPreset ? 'selected' : ''}>✏️ Lainnya (tulis manual)</option>
          </select>
        </div>
        <div class="form-group ${editing && !isPreset ? '' : 'hidden'}" id="titleCustomBox">
          <label>Judul Kelas (manual)</label>
          <input name="titleCustom" id="titleCustom" value="${UI.esc(editing && !isPreset ? editing.title : '')}" placeholder="mis. Kelas Intensif Saintek" />
        </div>
        <div class="form-row">
          <div class="form-group"><label>Kategori</label>
            <input name="category" value="${UI.esc(editing?.category || '')}" placeholder="mis. Matematika" /></div>
          <div class="form-group"><label>Biaya / SPP (Rp)</label>
            <input name="price" type="number" min="0" value="${editing?.price || 0}" /></div>
        </div>
        <div class="form-group"><label>Guru Pengajar</label>
          <select name="teacherId" required>
            <option value="">-- Pilih Guru --</option>
            ${gurus.map(g => `<option value="${g.id}" ${editing?.teacherId === g.id ? 'selected' : ''}>${UI.esc(g.name)} (${UI.esc(g.subject || '-')})</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Deskripsi</label>
          <textarea name="description" required>${UI.esc(editing?.description || '')}</textarea></div>
        <div class="form-group">
          <label>🔒 Password Kelas (untuk "Jelajah Kelas")</label>
          <input name="password" value="${UI.esc(editing?.password || '')}" placeholder="Kosongkan bila kelas terbuka tanpa password" />
          <p class="muted small" style="margin:6px 0 0;">Siswa wajib memasukkan password ini saat bergabung sendiri lewat halaman
          <strong>Jelajah Kelas</strong>. Pendaftaran melalui menu <strong>Kelola Siswa</strong> oleh admin tidak memerlukan password.
          Guru pengajar juga dapat mengubah password ini.</p>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Kelas' : 'Buat Kelas Baru', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    // Tampilkan input manual hanya bila memilih "Lainnya"
    const presetSel = document.getElementById('titlePreset');
    const customBox = document.getElementById('titleCustomBox');
    const customInput = document.getElementById('titleCustom');
    const syncTitleMode = () => {
      const other = presetSel.value === '__OTHER__';
      customBox.classList.toggle('hidden', !other);
      customInput.required = other;
      if (other) setTimeout(() => customInput.focus(), 50);
    };
    presetSel.addEventListener('change', syncTitleMode);
    syncTitleMode();

    document.getElementById('adminCourseForm').addEventListener('submit', (e) => {
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
        password: (fd.get('password') || '').trim(),
        teacherId: fd.get('teacherId')
      };
      if (editing) {
        DB.updateCourse(editing.id, payload);
        UI.toast('Kelas diperbarui.');
      } else {
        DB.addCourse(payload);
        UI.toast('Kelas dibuat.');
      }
      UI.modal.close();
      renderCourses(container);
    });
  }

  function openBulkEnrollModal(courseId, container) {
    const course = DB.getCourse(courseId);
    const allStudents = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
    const enrolled = DB.getEnrollmentsByCourse(courseId);
    const enrolledIds = new Set(enrolled.map(e => e.studentId));

    const body = `
      <div class="muted small mb-1">Centang siswa yang ingin didaftarkan ke kelas <strong>${UI.esc(course.title)}</strong>. Perubahan disimpan saat klik "Simpan".</div>
      <div class="form" style="margin-bottom:12px;">
        <input id="studentSearch" placeholder="Cari nama siswa..." style="width:100%;padding:8px 12px;border:1px solid var(--gray-300);border-radius:6px;" />
      </div>
      <div id="studentCheckList" style="max-height:350px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;padding:4px;">
        ${allStudents.map(s => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--gray-100);cursor:pointer;" data-name="${s.name.toLowerCase()}">
            <input type="checkbox" name="sid" value="${s.id}" ${enrolledIds.has(s.id) ? 'checked' : ''} />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:500;">${UI.esc(s.name)}</div>
              <div class="muted small">${UI.esc(s.kelas || '-')} • ${UI.esc(s.email || '-')}</div>
            </div>
            ${enrolledIds.has(s.id) ? '<span class="badge badge-success" style="font-size:10px;">Terdaftar</span>' : ''}
          </label>`).join('')}
      </div>
      <div class="muted small mt-1">${allStudents.length} siswa tersedia, ${enrolledIds.size} sudah terdaftar</div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
        <button type="button" class="btn btn-primary" id="saveEnrollBtn">Simpan Perubahan</button>
      </div>`;
    UI.modal.open('Kelola Siswa di Kelas', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    // Search filter
    document.getElementById('studentSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#studentCheckList label').forEach(el => {
        el.style.display = el.dataset.name.includes(q) ? '' : 'none';
      });
    });

    // Save
    document.getElementById('saveEnrollBtn').addEventListener('click', () => {
      const checks = document.querySelectorAll('#studentCheckList input[name="sid"]');
      const selected = new Set();
      checks.forEach(ch => { if (ch.checked) selected.add(ch.value); });

      let added = 0, removed = 0;
      // Enroll new students
      selected.forEach(sid => {
        if (!enrolledIds.has(sid)) {
          DB.enroll(courseId, sid);
          added++;
        }
      });
      // Unenroll unchecked students
      enrolledIds.forEach(sid => {
        if (!selected.has(sid)) {
          DB.unenroll(courseId, sid);
          removed++;
        }
      });

      UI.toast(`Selesai: ${added} ditambahkan, ${removed} dihapus.`);
      UI.modal.close();
      renderCourses(container);
    });
  }

  /* ========== JADWAL KELAS AKTIF ========== */
  function renderJadwalKelas(container) {
    const events = DB.getEvents().filter(e => e.category === 'Jadwal Kelas');
    const today = UI.todayYMD();
    const upcoming = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = events.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
    const todayEvents = events.filter(e => e.date === today);

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Hari Ini</div><div class="value">${todayEvents.length}</div><div class="sub">jadwal aktif</div></div>
        <div class="stat-card accent-primary"><div class="label">Akan Datang</div><div class="value">${upcoming.length}</div></div>
        <div class="stat-card accent-warning"><div class="label">Selesai</div><div class="value">${past.length}</div></div>
      </div>

      <div class="subtabs">
        <button class="subtab-btn active" data-jtab="today">Hari Ini (${todayEvents.length})</button>
        <button class="subtab-btn" data-jtab="upcoming">Akan Datang (${upcoming.length})</button>
        <button class="subtab-btn" data-jtab="past">Selesai (${past.length})</button>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 id="jadwalTitle">Jadwal Hari Ini</h3>
          <button class="btn btn-primary btn-sm" id="addJadwalBtn">+ Tambah Jadwal</button>
        </div>
        <div id="jadwalBox"></div>
      </div>
    `;

    let currentTab = 'today';
    const renderTab = () => {
      const box = document.getElementById('jadwalBox');
      const titleEl = document.getElementById('jadwalTitle');
      let list;
      if (currentTab === 'today') { list = todayEvents; titleEl.textContent = 'Jadwal Hari Ini'; }
      else if (currentTab === 'upcoming') { list = upcoming; titleEl.textContent = 'Jadwal Akan Datang'; }
      else { list = past.slice(0, 30); titleEl.textContent = 'Jadwal Selesai'; }

      if (list.length === 0) { box.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>Tidak ada jadwal.</div>'; return; }
      box.innerHTML = list.map(ev => `
        <div class="list-item">
          <div class="flex-between">
            <div class="title">${UI.esc(ev.title)}</div>
            <span class="muted small">${UI.fmtYMD(ev.date)}${ev.time ? ' • ' + UI.esc(ev.time) : ''}</span>
          </div>
          ${ev.description ? `<div class="content">${UI.esc(ev.description)}</div>` : ''}
        </div>`).join('');
    };

    container.querySelectorAll('[data-jtab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-jtab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentTab = b.dataset.jtab;
      renderTab();
    }));

    document.getElementById('addJadwalBtn').addEventListener('click', () => {
      // Reuse calendar event form but preset category
      const body = `
        <form id="jadwalForm" class="form">
          <div class="form-group"><label>Judul Jadwal</label>
            <input name="title" required placeholder="mis. Kelas Matematika - Sesi 5" /></div>
          <div class="form-row">
            <div class="form-group"><label>Tanggal</label>
              <input name="date" type="date" required value="${today}" /></div>
            <div class="form-group"><label>Waktu</label>
              <input name="time" type="time" /></div>
          </div>
          <div class="form-group"><label>Deskripsi</label>
            <textarea name="description" rows="2"></textarea></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open('Tambah Jadwal Kelas', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      document.getElementById('jadwalForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        DB.addEvent({
          title: fd.get('title').trim(),
          date: fd.get('date'),
          time: fd.get('time') || '',
          category: 'Jadwal Kelas',
          color: '#dcfce7',
          description: fd.get('description').trim(),
          authorId: 'u_admin'
        });
        UI.toast('Jadwal ditambahkan!');
        UI.modal.close();
        renderJadwalKelas(container);
      });
    });

    renderTab();
  }

  /* ========== TAHUN AKADEMIK / BATCH ========== */
  function renderBatch(container) {
    const batches = DB.getBatches().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const today = UI.todayYMD();

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>Tahun Akademik / Batch (${batches.length})</h3>
          <button class="btn btn-primary btn-sm" id="addBatchBtn">+ Tambah Batch</button>
        </div>
        ${batches.length === 0 ? emptyState('Belum ada tahun akademik. Buat yang pertama!') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama Batch</th><th>Mulai</th><th>Berakhir</th><th>Siswa</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${batches.map(b => {
              const isExpired = b.endDate && b.endDate < today;
              const isActive = b.startDate <= today && (!b.endDate || b.endDate >= today);
              const students = DB.getUsers().filter(u => u.role === 'siswa' && u.batchId === b.id);
              const statusLabel = isExpired ? 'Selesai' : (isActive ? 'Aktif' : 'Akan Datang');
              const statusBadge = isExpired ? 'badge-gray' : (isActive ? 'badge-success' : 'badge-info');
              return `<tr>
                <td><strong>${UI.esc(b.name)}</strong>${b.description ? `<div class="muted small">${UI.esc(b.description)}</div>` : ''}</td>
                <td>${UI.fmtYMD(b.startDate)}</td>
                <td>${UI.fmtYMD(b.endDate)}</td>
                <td>${students.length}</td>
                <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
                <td class="actions">
                  <button class="btn btn-sm btn-secondary" data-edit-batch="${b.id}">Edit</button>
                  ${isExpired ? `<button class="btn btn-sm btn-warning" data-graduate="${b.id}">Lulus → Alumni</button>` : ''}
                  <button class="btn btn-sm btn-danger" data-del-batch="${b.id}">Hapus</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>

      <div class="card">
        <div class="card-header"><h3>Assign Siswa ke Batch</h3></div>
        <p class="muted small">Pilih batch lalu assign siswa yang belum memiliki batch.</p>
        <div class="form-row" style="max-width:500px;">
          <div class="form-group"><label>Batch</label>
            <select id="assignBatch">
              <option value="">-- Pilih --</option>
              ${batches.filter(b => !(b.endDate && b.endDate < today)).map(b => `<option value="${b.id}">${UI.esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="display:flex;align-items:flex-end;">
            <button class="btn btn-primary btn-sm" id="openAssignBtn">Kelola</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('addBatchBtn').addEventListener('click', () => openBatchForm(container));
    container.querySelectorAll('[data-edit-batch]').forEach(b => b.addEventListener('click', () => openBatchForm(container, b.dataset.editBatch)));
    container.querySelectorAll('[data-del-batch]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus batch ini? Siswa di batch ini akan kehilangan assignment batch.')) return;
      // Remove batchId from students
      DB.getUsers().filter(u => u.batchId === b.dataset.delBatch).forEach(u => DB.updateUser(u.id, { batchId: null }));
      DB.deleteBatch(b.dataset.delBatch);
      UI.toast('Batch dihapus.');
      renderBatch(container);
    }));
    container.querySelectorAll('[data-graduate]').forEach(b => b.addEventListener('click', () => {
      const batchId = b.dataset.graduate;
      const batch = DB.getBatch(batchId);
      if (!UI.confirmDialog(`Luluskan semua siswa di batch "${batch.name}" ke Alumni?`)) return;
      const students = DB.getUsers().filter(u => u.role === 'siswa' && u.batchId === batchId);
      students.forEach(u => DB.updateUser(u.id, { status: 'Alumni', batchId: batchId }));
      UI.toast(`${students.length} siswa dipindahkan ke Alumni.`);
      renderBatch(container);
    }));

    document.getElementById('openAssignBtn').addEventListener('click', () => {
      const batchId = document.getElementById('assignBatch').value;
      if (!batchId) { UI.toast('Pilih batch dulu.', 'error'); return; }
      openBatchAssign(container, batchId);
    });
  }

  function openBatchForm(container, editId) {
    const editing = editId ? DB.getBatch(editId) : null;
    const body = `
      <form id="batchForm" class="form">
        <div class="form-group"><label>Nama Batch / Tahun Akademik</label>
          <input name="name" required value="${UI.esc(editing?.name || '')}" placeholder="mis. Batch 2025/2026" /></div>
        <div class="form-row">
          <div class="form-group"><label>Tanggal Mulai</label>
            <input name="startDate" type="date" required value="${editing?.startDate || UI.todayYMD()}" /></div>
          <div class="form-group"><label>Tanggal Berakhir</label>
            <input name="endDate" type="date" required value="${editing?.endDate || ''}" /></div>
        </div>
        <div class="form-group"><label>Deskripsi (opsional)</label>
          <textarea name="description" rows="2">${UI.esc(editing?.description || '')}</textarea></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;
    UI.modal.open(editing ? 'Edit Batch' : 'Tambah Tahun Akademik', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('batchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        name: fd.get('name').trim(),
        startDate: fd.get('startDate'),
        endDate: fd.get('endDate'),
        description: fd.get('description').trim()
      };
      if (editing) DB.updateBatch(editing.id, payload);
      else DB.addBatch(payload);
      UI.toast('Batch disimpan.');
      UI.modal.close();
      renderBatch(container);
    });
  }

  function openBatchAssign(container, batchId) {
    const batch = DB.getBatch(batchId);
    const allStudents = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');
    const inBatch = new Set(allStudents.filter(u => u.batchId === batchId).map(u => u.id));

    const body = `
      <div class="muted small mb-1">Centang siswa untuk batch <strong>${UI.esc(batch.name)}</strong></div>
      <div style="max-height:350px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:6px;">
        ${allStudents.map(s => `
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--gray-100);cursor:pointer;">
            <input type="checkbox" name="sid" value="${s.id}" ${inBatch.has(s.id) ? 'checked' : ''} />
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:500;">${UI.esc(s.name)}</div>
              <div class="muted small">${UI.esc(s.kelas || '-')}${s.batchId && s.batchId !== batchId ? ' • Batch lain' : ''}</div>
            </div>
          </label>`).join('')}
      </div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
        <button type="button" class="btn btn-primary" id="saveBatchAssign">Simpan</button>
      </div>`;
    UI.modal.open('Assign Siswa ke Batch', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('saveBatchAssign').addEventListener('click', () => {
      const checks = document.querySelectorAll('#modalBody input[name="sid"]');
      checks.forEach(ch => {
        const user = DB.getUser(ch.value);
        if (ch.checked && user.batchId !== batchId) {
          DB.updateUser(ch.value, { batchId });
        } else if (!ch.checked && user.batchId === batchId) {
          DB.updateUser(ch.value, { batchId: null });
        }
      });
      UI.toast('Assignment batch disimpan.');
      UI.modal.close();
      renderBatch(container);
    });
  }

  /* ========== ALUMNI ========== */
  function renderAlumni(container) {
    const alumni = DB.getUsers().filter(u => u.role === 'siswa' && u.status === 'Alumni');
    const batches = DB.getBatches();

    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Daftar Alumni (${alumni.length})</h3></div>
        ${alumni.length === 0 ? emptyState('Belum ada alumni. Siswa otomatis masuk alumni saat batch-nya selesai dan diluluskan.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Email</th><th>Batch</th><th>Universitas Tujuan</th><th>Jurusan</th><th>Aksi</th></tr></thead>
          <tbody>
            ${alumni.map(u => {
              const batch = batches.find(b => b.id === u.batchId);
              return `<tr>
                <td><strong>${UI.esc(u.name)}</strong></td>
                <td>${UI.esc(u.email || '-')}</td>
                <td>${UI.esc(batch ? batch.name : '-')}</td>
                <td>${UI.esc(u.targetUniv || '-')}</td>
                <td>${UI.esc(u.targetMajor || '-')}</td>
                <td><button class="btn btn-sm btn-secondary" data-reactivate="${u.id}">Aktifkan Kembali</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>
    `;
    container.querySelectorAll('[data-reactivate]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Aktifkan kembali siswa ini? Status akan berubah ke Aktif.')) return;
      DB.updateUser(b.dataset.reactivate, { status: 'Aktif' });
      UI.toast('Siswa diaktifkan kembali.');
      renderAlumni(container);
    }));
  }

  function renderSettings(container) {
    const classOpts = DB.getClassOptions();
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h3>Daftar Nama Kelas</h3></div>
        <p class="muted small">Kelas yang tersedia di dropdown formulir siswa. Klik + untuk menambah, x untuk menghapus.</p>
        <div id="classOptList" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          ${classOpts.map((c, i) => `<span class="badge badge-info" style="padding:6px 10px;font-size:13px;">${UI.esc(c)} <button type="button" data-rm-class="${i}" style="border:none;background:none;cursor:pointer;font-weight:700;color:var(--danger);margin-left:4px;">&times;</button></span>`).join('')}
        </div>
        <div class="flex-gap">
          <input id="newClassName" placeholder="Nama kelas baru..." style="padding:8px 12px;border:1px solid var(--gray-300);border-radius:6px;font-size:13px;" />
          <button class="btn btn-sm btn-primary" id="addClassBtn">+ Tambah</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Pengaturan Sistem</h3></div>
        <p class="muted">Data LMS disimpan di browser Anda (localStorage). Gunakan tombol di bawah untuk mereset ke data contoh.</p>
        <div class="flex-gap">
          <button class="btn btn-danger" id="resetBtn">Reset Semua Data</button>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Tentang</h3></div>
        <p><strong>LMS Rubela</strong> v2.0 — Learning Management System berbasis web dengan fitur lengkap.</p>
        <p class="muted small">Dibuat dengan HTML, CSS, dan JavaScript murni.</p>
      </div>
    `;
    // Class management
    document.getElementById('addClassBtn').addEventListener('click', () => {
      const inp = document.getElementById('newClassName');
      const val = inp.value.trim();
      if (!val) return;
      const opts = DB.getClassOptions();
      if (opts.includes(val)) { UI.toast('Kelas sudah ada.', 'error'); return; }
      opts.push(val);
      DB.setClassOptions(opts);
      UI.toast('Kelas ditambahkan.');
      renderSettings(container);
    });
    container.querySelectorAll('[data-rm-class]').forEach(b => b.addEventListener('click', () => {
      const opts = DB.getClassOptions();
      opts.splice(Number(b.dataset.rmClass), 1);
      DB.setClassOptions(opts);
      UI.toast('Kelas dihapus.');
      renderSettings(container);
    }));

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

  /* ========== ATTENDANCE (admin) ==========
   * Tab "Ambil Presensi": pilih kelas lewat kotak berbaris ke samping, lalu
   * tandai status langsung dengan tombol — tanpa dropdown.
   * Tab lainnya: rekap siswa / guru dan log lengkap.
   */
  function renderAttendance(container, user) {
    const courses = DB.getCourses();
    const allAtt = DB.getAttendance();
    const studentAtt = allAtt.filter(a => a.role === 'siswa');
    const guruAtt = allAtt.filter(a => a.role === 'guru');
    const presentS = studentAtt.filter(a => a.status === 'hadir').length;
    const presentG = guruAtt.filter(a => a.status === 'hadir').length;
    const todayCount = allAtt.filter(a => a.date === UI.todayYMD()).length;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-success"><div class="label">Kehadiran Siswa</div><div class="value">${studentAtt.length ? Math.round(presentS / studentAtt.length * 100) : 0}%</div><div class="sub">${presentS}/${studentAtt.length} sesi</div></div>
        <div class="stat-card accent-primary"><div class="label">Kehadiran Guru</div><div class="value">${guruAtt.length ? Math.round(presentG / guruAtt.length * 100) : 0}%</div><div class="sub">${presentG}/${guruAtt.length} sesi</div></div>
        <div class="stat-card accent-warning"><div class="label">Total Record</div><div class="value">${allAtt.length}</div></div>
        <div class="stat-card accent-danger"><div class="label">Tercatat Hari Ini</div><div class="value">${todayCount}</div><div class="sub">${UI.fmtYMD(UI.todayYMD())}</div></div>
      </div>

      <div class="subtabs">
        <button class="subtab-btn active" data-stab="ambil">📝 Ambil Presensi</button>
        <button class="subtab-btn" data-stab="siswa">Rekap Siswa</button>
        <button class="subtab-btn" data-stab="guru">Rekap Guru</button>
        <button class="subtab-btn" data-stab="log">Log Presensi</button>
      </div>

      <div id="attFilters" class="filter-bar hidden">
        <label>Kelas:</label>
        <select id="attCourseFilter">
          <option value="">Semua Kelas</option>
          ${courses.map(c => `<option value="${c.id}">${UI.esc(c.title)}</option>`).join('')}
        </select>
        <label style="margin-left:12px;">Peran:</label>
        <select id="attRoleFilter">
          <option value="">Semua</option>
          <option value="siswa">Siswa</option>
          <option value="guru">Guru</option>
        </select>
        <label style="margin-left:12px;">Status:</label>
        <select id="attStatusFilter">
          <option value="">Semua</option>
          <option value="hadir">Hadir</option>
          <option value="izin">Izin</option>
          <option value="sakit">Sakit</option>
          <option value="alfa">Alfa</option>
        </select>
      </div>

      <div id="attBox"></div>
    `;
    let currentTab = 'ambil';
    let currentCourse = '';
    let currentRole = '';
    let currentStatus = '';
    let takeCourseId = courses.length ? courses[0].id : '';

    const render = () => {
      const box = document.getElementById('attBox');
      const filters = document.getElementById('attFilters');
      filters.classList.toggle('hidden', currentTab === 'ambil');

      // --- Ambil presensi langsung dari panel admin ---
      if (currentTab === 'ambil') {
        if (courses.length === 0) { box.innerHTML = emptyState('Belum ada kelas untuk diabsen.'); return; }
        box.innerHTML = `
          <div class="card">
            <div class="card-header">${UI.secHead('🗂️', 'Pilih Kelas', 'Klik salah satu kotak kelas di bawah')}</div>
            ${Shared.classChipsHtml(courses, takeCourseId, 'data-take-course')}
          </div>
          <div id="adminAttSheet"></div>`;
        box.querySelectorAll('[data-take-course]').forEach(b => b.addEventListener('click', () => {
          takeCourseId = b.dataset.takeCourse;
          box.querySelectorAll('[data-take-course]').forEach(x => x.classList.remove('is-active'));
          b.classList.add('is-active');
          paintSheet();
        }));
        paintSheet();
        return;
      }

      let att = DB.getAttendance();
      if (currentCourse) att = att.filter(a => a.courseId === currentCourse);
      if (currentTab === 'log' && currentRole) att = att.filter(a => a.role === currentRole);
      if (currentTab === 'log' && currentStatus) att = att.filter(a => a.status === currentStatus);

      if (currentTab === 'log') {
        const log = att.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
        if (log.length === 0) { box.innerHTML = emptyState('Belum ada log.'); return; }
        box.innerHTML = `<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>Tanggal</th><th>Peran</th><th>Nama</th><th>Kelas</th><th>Status</th><th>Catatan</th></tr></thead>
          <tbody>${log.map(a => {
            const u = DB.getUser(a.userId);
            const c = DB.getCourse(a.courseId);
            return `<tr>
              <td>${UI.fmtYMD(a.date)}</td>
              <td><span class="badge ${a.role === 'guru' ? 'badge-info' : 'badge-gray'}">${a.role.toUpperCase()}</span></td>
              <td><strong>${UI.esc(u ? u.name : '-')}</strong></td>
              <td>${UI.esc(c ? c.title : '-')}</td>
              <td><span class="status-${a.status}">${a.status.toUpperCase()}</span></td>
              <td class="muted small">${UI.esc(a.note || '-')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div></div>`;
        return;
      }

      // Rekap per user
      const role = currentTab; // 'siswa' | 'guru'
      const users = DB.getUsers().filter(u => u.role === role);
      const rows = users.map(u => {
        const rec = att.filter(a => a.userId === u.id && a.role === role);
        const counts = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
        rec.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
        const total = rec.length;
        const pct = total ? Math.round(counts.hadir / total * 100) : 0;
        return { u, counts, total, pct };
      }).filter(r => r.total > 0 || !currentCourse);

      box.innerHTML = `<div class="card">
        <div class="card-header"><h3>Rekap Kehadiran ${role === 'siswa' ? 'Siswa' : 'Guru'}</h3></div>
        ${rows.length === 0 ? emptyState('Tidak ada data.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Hadir</th><th>Izin</th><th>Sakit</th><th>Alfa</th><th>Total</th><th>%</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${UI.esc(r.u.name)}</strong></td>
            <td>${r.counts.hadir}</td><td>${r.counts.izin}</td><td>${r.counts.sakit}</td><td>${r.counts.alfa}</td>
            <td>${r.total}</td>
            <td><strong>${r.pct}%</strong></td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>`;
    };

    const paintSheet = () => {
      const host = document.getElementById('adminAttSheet');
      if (!host || !takeCourseId) return;
      Shared.renderAttendanceSheet({
        container: host,
        courseId: takeCourseId,
        date: UI.todayYMD(),
        user,
        canMarkTeacher: true
      });
    };

    container.querySelectorAll('[data-stab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-stab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      currentTab = b.dataset.stab;
      render();
    }));
    document.getElementById('attCourseFilter').addEventListener('change', (e) => { currentCourse = e.target.value; render(); });
    document.getElementById('attRoleFilter').addEventListener('change', (e) => { currentRole = e.target.value; render(); });
    document.getElementById('attStatusFilter').addEventListener('change', (e) => { currentStatus = e.target.value; render(); });
    render();
  }

  /* ========== KELOLA ORANG TUA / WALI ==========
   * Akun orang tua dibuat admin dan dihubungkan ke satu atau lebih siswa.
   */
  function renderParents(container) {
    const parents = DB.getParents();
    const students = DB.getUsers().filter(u => u.role === 'siswa');
    const linkedIds = new Set(parents.flatMap(p => p.childIds || []));
    const unlinked = students.filter(s => !linkedIds.has(s.id));

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Akun Orang Tua</div><div class="value">${parents.length}</div></div>
        <div class="stat-card accent-success"><div class="label">Siswa Terpantau</div><div class="value">${linkedIds.size}</div><div class="sub">dari ${students.length} siswa</div></div>
        <div class="stat-card accent-warning"><div class="label">Belum Terhubung</div><div class="value">${unlinked.length}</div><div class="sub">siswa tanpa akun wali</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('👨‍👩‍👦', `Daftar Orang Tua / Wali (${parents.length})`, 'Akun ini hanya dapat memantau, tidak dapat mengubah data')}
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="exportParentBtn">Export Excel</button>
            <label class="btn btn-sm btn-secondary" style="cursor:pointer;">Import Excel
              <input type="file" id="importParentFile" accept=".xlsx,.xls,.csv" style="display:none;" />
            </label>
            <button class="btn btn-primary btn-sm" id="addParentBtn">+ Tambah Orang Tua</button>
          </div>
        </div>
        <details class="demo-accounts" style="margin:0 0 14px;">
          <summary>Format kolom Excel untuk import orang tua</summary>
          <p class="muted small" style="margin:8px 0 0;">
            Kolom yang dikenali: <strong>Nama</strong>, <strong>Username</strong>, <strong>Password</strong>,
            <strong>Email</strong>, <strong>Telepon</strong>, <strong>Hubungan</strong> (Ayah/Ibu/Wali),
            dan <strong>Username Anak</strong> (username siswa, pisahkan dengan koma bila lebih dari satu).
            Baris dengan username yang sudah ada akan dilewati. Bila Password kosong, dipakai <code>password123</code>.
          </p>
        </details>
        ${parents.length === 0 ? emptyState('Belum ada akun orang tua.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nama</th><th>Username</th><th>Hubungan</th><th>Kontak</th><th>Anak Dipantau</th><th>Aksi</th></tr></thead>
          <tbody>
            ${parents.map(p => {
              const kids = DB.getChildren(p.id);
              return `<tr>
                <td><strong>${UI.esc(p.name)}</strong><div class="muted small">${UI.esc(p.email || '-')}</div></td>
                <td>${UI.esc(p.username)}</td>
                <td><span class="badge badge-info">${UI.esc(p.relation || 'Wali')}</span></td>
                <td class="muted small">${UI.esc(p.phone || '-')}</td>
                <td>${kids.length === 0
                  ? '<span class="badge badge-warning">Belum terhubung</span>'
                  : kids.map(k => `<span class="badge badge-success" style="margin:2px;">${UI.esc(k.name)}</span>`).join(' ')}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-primary" data-link-child="${p.id}">Hubungkan Anak</button>
                  <button class="btn btn-sm btn-secondary" data-edit-parent="${p.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-parent="${p.id}">Hapus</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`}
      </div>

      ${unlinked.length ? `
      <div class="card">
        <div class="card-header">${UI.secHead('🔗', 'Siswa Belum Punya Akun Wali', 'Buat akun orang tua lalu hubungkan')}</div>
        <div class="flex-gap">
          ${unlinked.map(s => `<span class="badge badge-gray" style="padding:6px 10px;font-size:12px;">${UI.esc(s.name)} • ${UI.esc(s.kelas || '-')}</span>`).join('')}
        </div>
      </div>` : ''}
    `;

    document.getElementById('addParentBtn').addEventListener('click', () => openParentForm(container));
    container.querySelectorAll('[data-edit-parent]').forEach(b => b.addEventListener('click', () => openParentForm(container, b.dataset.editParent)));
    container.querySelectorAll('[data-link-child]').forEach(b => b.addEventListener('click', () => openLinkChildModal(container, b.dataset.linkChild)));
    container.querySelectorAll('[data-del-parent]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus akun orang tua ini? Data siswa tidak akan terhapus.')) return;
      DB.deleteUser(b.dataset.delParent);
      UI.toast('Akun orang tua dihapus.');
      renderParents(container);
    }));

    /* ---- Export Excel orang tua ---- */
    document.getElementById('exportParentBtn').addEventListener('click', () => {
      if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat. Coba reload halaman.', 'error'); return; }
      let rows = DB.getParents().map(p => {
        const kids = DB.getChildren(p.id);
        return {
          Nama: p.name,
          Username: p.username,
          Password: p.password || '',
          Email: p.email || '',
          Telepon: p.phone || '',
          Hubungan: p.relation || 'Wali',
          'Username Anak': kids.map(k => k.username).join(', '),
          'Nama Anak': kids.map(k => k.name).join(', '),
          Status: p.status || 'Aktif'
        };
      });
      if (rows.length === 0) {
        const sample = DB.getUsers().find(u => u.role === 'siswa');
        rows = [{
          Nama: 'Contoh Orang Tua', Username: 'ortu_baru', Password: 'password123',
          Email: 'ortu@wali.edu', Telepon: '08123456789', Hubungan: 'Ayah',
          'Username Anak': sample ? sample.username : 'siswa1', 'Nama Anak': sample ? sample.name : '', Status: 'Aktif'
        }];
      }
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orang Tua');
      XLSX.writeFile(wb, `data_orangtua_${UI.todayYMD()}.xlsx`);
      UI.toast('File Excel orang tua berhasil diunduh.');
    });

    /* ---- Import Excel orang tua ---- */
    document.getElementById('importParentFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
          const wb = XLSX.read(evt.target.result, { type: 'array' });
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
          if (rows.length === 0) { UI.toast('File kosong atau format tidak sesuai.', 'error'); return; }

          let added = 0, skipped = 0, defaultPw = 0, linked = 0, unknownKid = 0;
          rows.forEach(row => {
            const name = String(row.Nama || row.nama || '').trim();
            const username = String(row.Username || row.username || '').trim();
            if (!name || !username) { skipped++; return; }
            if (DB.findUserByUsername(username)) { skipped++; return; }

            const pwRaw = String(row.Password || row.password || row.Sandi || '').trim();
            const password = pwRaw || 'password123';
            if (!pwRaw) defaultPw++;

            // "Username Anak" boleh berisi beberapa username dipisah koma
            const kidRaw = String(row['Username Anak'] || row['username anak'] || row.Anak || row.anak || '').trim();
            const childIds = [];
            kidRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(uname => {
              const kid = DB.findUserByUsername(uname);
              if (kid && kid.role === 'siswa') { childIds.push(kid.id); linked++; }
              else unknownKid++;
            });

            DB.addUser({
              id: DB.uid('u'), role: 'orangtua', name, username, password,
              email: String(row.Email || row.email || '').trim(),
              phone: String(row.Telepon || row.telepon || row.Phone || row.phone || '').trim(),
              relation: String(row.Hubungan || row.hubungan || 'Wali').trim() || 'Wali',
              status: String(row.Status || row.status || 'Aktif').trim() || 'Aktif',
              childIds
            });
            // Beri tahu anak yang baru terhubung
            DB.notifyUsers(childIds, {
              type: 'info', icon: '👨‍👩‍👦',
              title: 'Akun orang tua terhubung',
              body: `${name} kini dapat memantau perkembangan belajar Anda.`,
              link: 'profile'
            });
            added++;
          });

          let msg = `Import selesai: ${added} akun ditambahkan, ${skipped} dilewati (duplikat/kosong), ${linked} anak terhubung.`;
          if (defaultPw) msg += ` ${defaultPw} akun memakai password default.`;
          if (unknownKid) msg += ` ${unknownKid} username anak tidak ditemukan.`;
          UI.toast(msg, added > 0 ? 'success' : 'info');
          renderParents(container);
        } catch (err) {
          UI.toast('Gagal membaca file: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
    });
  }

  /* ===== Picker siswa yang rapi + pencarian =====
   * Dipakai pada form tambah/edit orang tua dan modal "Hubungkan Anak".
   */
  function studentPickerHtml(students, selectedSet, opts) {
    const o = opts || {};
    const inputName = o.name || 'childIds';
    const idPrefix = o.idPrefix || 'pick';
    if (students.length === 0) {
      return `<div class="pick-wrap"><div class="pick-empty">Belum ada siswa terdaftar.</div></div>`;
    }
    return `
      <div class="pick-wrap" id="${idPrefix}Wrap">
        <div class="pick-toolbar">
          <input type="search" class="pick-search" id="${idPrefix}Search" placeholder="Cari nama, username, atau kelas siswa..." autocomplete="off" />
          <span class="pick-count" id="${idPrefix}Count">${selectedSet.size} dipilih</span>
        </div>
        <div class="pick-list" id="${idPrefix}List">
          ${students.map(s => {
            const on = selectedSet.has(s.id);
            const hay = `${s.name} ${s.username || ''} ${s.kelas || ''} ${s.targetUniv || ''}`.toLowerCase();
            return `<label class="pick-item ${on ? 'is-checked' : ''}" data-hay="${UI.esc(hay)}">
              <input type="checkbox" name="${inputName}" value="${s.id}" ${on ? 'checked' : ''} />
              <span class="pick-av">${UI.initials(s.name)}</span>
              <span class="pick-main">
                <span class="pick-name">${UI.esc(s.name)}</span>
                <span class="pick-meta">@${UI.esc(s.username || '-')} • ${UI.esc(s.kelas || 'tanpa kelas')}${s.targetUniv ? ' • ' + UI.esc(s.targetUniv) : ''}</span>
              </span>
              <span class="badge ${(s.status || 'Aktif') === 'Aktif' ? 'badge-success' : 'badge-gray'} pick-tag">${UI.esc(s.status || 'Aktif')}</span>
            </label>`;
          }).join('')}
          <div class="pick-empty hidden" id="${idPrefix}NoMatch">Tidak ada siswa yang cocok dengan pencarian.</div>
        </div>
        <div class="pick-foot">
          <span id="${idPrefix}Info">${students.length} siswa tersedia</span>
          <div class="flex-gap">
            <button type="button" class="btn btn-secondary" data-pick-all="${idPrefix}">Pilih Semua</button>
            <button type="button" class="btn btn-secondary" data-pick-none="${idPrefix}">Kosongkan</button>
          </div>
        </div>
      </div>`;
  }

  /** Mengaktifkan pencarian, sinkronisasi highlight, dan tombol pilih semua. */
  function bindStudentPicker(idPrefix) {
    const wrap = document.getElementById(idPrefix + 'Wrap');
    if (!wrap) return;
    const list = document.getElementById(idPrefix + 'List');
    const search = document.getElementById(idPrefix + 'Search');
    const countEl = document.getElementById(idPrefix + 'Count');
    const noMatch = document.getElementById(idPrefix + 'NoMatch');
    const items = [...list.querySelectorAll('.pick-item')];

    const refreshCount = () => {
      const n = items.filter(i => i.querySelector('input').checked).length;
      countEl.textContent = `${n} dipilih`;
    };
    const applyFilter = () => {
      const q = (search.value || '').trim().toLowerCase();
      let visible = 0;
      items.forEach(i => {
        const show = !q || i.dataset.hay.includes(q);
        i.classList.toggle('hidden', !show);
        if (show) visible++;
      });
      noMatch.classList.toggle('hidden', visible > 0);
    };

    if (search) search.addEventListener('input', applyFilter);
    items.forEach(i => {
      const cb = i.querySelector('input');
      cb.addEventListener('change', () => {
        i.classList.toggle('is-checked', cb.checked);
        refreshCount();
      });
    });
    wrap.querySelectorAll('[data-pick-all]').forEach(b => b.addEventListener('click', () => {
      items.filter(i => !i.classList.contains('hidden')).forEach(i => {
        const cb = i.querySelector('input');
        cb.checked = true;
        i.classList.add('is-checked');
      });
      refreshCount();
    }));
    wrap.querySelectorAll('[data-pick-none]').forEach(b => b.addEventListener('click', () => {
      items.forEach(i => {
        const cb = i.querySelector('input');
        cb.checked = false;
        i.classList.remove('is-checked');
      });
      refreshCount();
    }));
    refreshCount();
  }

  function openParentForm(container, editId) {
    const editing = editId ? DB.getUser(editId) : null;
    const RELATIONS = ['Ayah', 'Ibu', 'Wali', 'Kakak', 'Lainnya'];
    const students = DB.getUsers().filter(u => u.role === 'siswa');
    const selected = new Set(editing?.childIds || []);

    const body = `
      <form id="parentForm" class="form">
        <div class="form-group"><label>Nama Lengkap</label>
          <input name="name" required value="${UI.esc(editing?.name || '')}" /></div>
        <div class="form-row">
          <div class="form-group"><label>Username</label>
            <input name="username" required value="${UI.esc(editing?.username || '')}" ${editing ? 'readonly' : ''} /></div>
          <div class="form-group"><label>Email</label>
            <input type="email" name="email" value="${UI.esc(editing?.email || '')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>No. Telepon / WhatsApp</label>
            <input name="phone" value="${UI.esc(editing?.phone || '')}" placeholder="08xxxxxxxxxx" /></div>
          <div class="form-group"><label>Hubungan</label>
            <select name="relation">
              ${RELATIONS.map(r => `<option value="${r}" ${(editing?.relation || 'Wali') === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Anak / Siswa yang Dipantau</label>
          ${studentPickerHtml(students, selected, { name: 'childIds', idPrefix: 'pf' })}
        </div>
        <div class="form-group"><label>Password ${editing ? '(kosongkan jika tidak diubah)' : ''}</label>
          <input type="password" name="password" ${editing ? '' : 'required minlength="6"'} /></div>
        <div id="parentFormError" class="alert alert-error hidden"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;

    UI.modal.open(editing ? 'Edit Orang Tua / Wali' : 'Tambah Orang Tua / Wali', body);
    bindStudentPicker('pf');
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('parentForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = fd.get('username').trim();
      const err = document.getElementById('parentFormError');
      err.classList.add('hidden');
      if (!editing && DB.findUserByUsername(username)) {
        err.textContent = 'Username sudah dipakai.';
        err.classList.remove('hidden');
        return;
      }
      const childIds = fd.getAll('childIds');
      const payload = {
        name: fd.get('name').trim(),
        email: (fd.get('email') || '').trim(),
        phone: (fd.get('phone') || '').trim(),
        relation: fd.get('relation'),
        childIds
      };
      const password = fd.get('password');
      if (editing) {
        if (password) payload.password = password;
        DB.updateUser(editing.id, payload);
        UI.toast('Data orang tua diperbarui.');
      } else {
        DB.addUser(Object.assign({ id: DB.uid('u'), role: 'orangtua', username, password, status: 'Aktif' }, payload));
        DB.notifyUsers(childIds, {
          type: 'info', icon: '👨‍👩‍👦',
          title: 'Akun orang tua terhubung',
          body: `${payload.name} kini dapat memantau perkembangan belajar Anda.`,
          link: 'profile'
        });
        UI.toast('Akun orang tua dibuat.');
      }
      UI.modal.close();
      renderParents(container);
    });
  }

  function openLinkChildModal(container, parentId) {
    const parent = DB.getUser(parentId);
    const students = DB.getUsers().filter(u => u.role === 'siswa');
    const selected = new Set(parent.childIds || []);
    const body = `
      <div class="muted small mb-2">Pilih siswa yang dapat dipantau oleh <strong>${UI.esc(parent.name)}</strong>.
      Gunakan kolom pencarian untuk menemukan siswa dengan cepat.</div>
      ${studentPickerHtml(students, selected, { name: 'cid', idPrefix: 'lk' })}
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
        <button type="button" class="btn btn-primary" id="saveLinkBtn">Simpan Hubungan</button>
      </div>`;
    UI.modal.open('Hubungkan Anak', body);
    bindStudentPicker('lk');
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
    document.getElementById('saveLinkBtn').addEventListener('click', () => {
      const ids = [...document.querySelectorAll('#lkList input[name="cid"]:checked')].map(i => i.value);
      DB.setChildren(parentId, ids);
      // Kabari siswa yang baru dihubungkan
      const added = ids.filter(id => !selected.has(id));
      DB.notifyUsers(added, {
        type: 'info', icon: '👨‍👩‍👦',
        title: 'Akun orang tua terhubung',
        body: `${parent.name} kini dapat memantau perkembangan belajar Anda.`,
        link: 'profile'
      });
      UI.toast(`${ids.length} anak terhubung ke ${parent.name}.`);
      UI.modal.close();
      renderParents(container);
    });
  }

  /* ========== REKAPAN ========== */
  function renderRekap(container) {
    const courses = DB.getCourses();
    // Academic rekap
    const rows = courses.map(c => {
      const students = DB.getEnrollmentsByCourse(c.id).length;
      const materials = DB.getMaterialsByCourse(c.id).length;
      const modules = DB.getModulesByCourse(c.id).length;
      const recordings = DB.getRecordingsByCourse(c.id).length;
      const assignments = DB.getAssignmentsByCourse(c.id);
      const asgIds = assignments.map(a => a.id);
      const subs = DB.getSubmissions().filter(s => asgIds.includes(s.assignmentId));
      const cbts = DB.getCbtsByCourse(c.id);
      const cbtIds = cbts.map(x => x.id);
      const attempts = DB.getCbtAttempts().filter(a => cbtIds.includes(a.cbtId) && a.submittedAt);
      const avgAsg = subs.filter(s => s.grade != null).length
        ? Math.round(subs.filter(s => s.grade != null).reduce((sum, s) => sum + s.grade, 0) / subs.filter(s => s.grade != null).length) : null;
      const avgCbt = attempts.length ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length) : null;
      const att = DB.getAttendanceByCourse(c.id).filter(a => a.role === 'siswa');
      const presentPct = att.length ? Math.round(att.filter(a => a.status === 'hadir').length / att.length * 100) : 0;
      return { c, students, materials, modules, recordings, assignments: assignments.length, cbts: cbts.length, avgAsg, avgCbt, presentPct };
    });

    // Per-student rekap (top-level)
    const siswas = DB.getUsers().filter(u => u.role === 'siswa');
    const studentRows = siswas.map(s => {
      const subs = DB.getSubmissionsByStudent(s.id);
      const graded = subs.filter(x => x.grade != null);
      const avg = graded.length ? Math.round(graded.reduce((sum, x) => sum + x.grade, 0) / graded.length) : null;
      const attempts = DB.getCbtAttemptsByStudent(s.id).filter(a => a.submittedAt);
      const avgCbt = attempts.length ? Math.round(attempts.reduce((sum, a) => sum + (a.score || 0), 0) / attempts.length) : null;
      const att = DB.getAttendanceByUser(s.id).filter(a => a.role === 'siswa');
      const presentPct = att.length ? Math.round(att.filter(a => a.status === 'hadir').length / att.length * 100) : 0;
      const payments = DB.getPaymentsByStudent(s.id);
      const paid = payments.filter(p => p.status === 'lunas').reduce((sum, p) => sum + (p.amount || 0), 0);
      return { s, subs: subs.length, avgAsg: avg, attemptsCount: attempts.length, avgCbt, presentPct, paid };
    });

    container.innerHTML = `
      <div class="subtabs">
        <button class="subtab-btn active" data-rtab="class">Rekap per Kelas</button>
        <button class="subtab-btn" data-rtab="student">Rekap per Siswa</button>
      </div>
      <div id="rekapBox"></div>
    `;

    const renderTab = (tab) => {
      const box = document.getElementById('rekapBox');
      if (tab === 'class') {
        box.innerHTML = `<div class="card">
          <div class="card-header"><h3>Rekap Aktivitas per Kelas</h3></div>
          ${rows.length === 0 ? emptyState('Belum ada kelas.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Kelas</th><th>Siswa</th><th>Materi</th><th>Modul</th><th>Rekaman</th><th>Tugas</th><th>CBT</th><th>Rata Tugas</th><th>Rata CBT</th><th>Kehadiran</th></tr></thead>
            <tbody>${rows.map(r => `<tr>
              <td><strong>${UI.esc(r.c.title)}</strong></td>
              <td>${r.students}</td>
              <td>${r.materials}</td>
              <td>${r.modules}</td>
              <td>${r.recordings}</td>
              <td>${r.assignments}</td>
              <td>${r.cbts}</td>
              <td>${r.avgAsg ?? '-'}</td>
              <td>${r.avgCbt ?? '-'}</td>
              <td><strong>${r.presentPct}%</strong></td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>`;
      } else {
        box.innerHTML = `<div class="card">
          <div class="card-header"><h3>Rekap per Siswa</h3></div>
          ${studentRows.length === 0 ? emptyState('Belum ada siswa.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Siswa</th><th>Kelas</th><th>Submission</th><th>Rata Tugas</th><th>CBT Selesai</th><th>Rata CBT</th><th>Kehadiran</th><th>Terbayar</th></tr></thead>
            <tbody>${studentRows.map(r => `<tr>
              <td><strong>${UI.esc(r.s.name)}</strong></td>
              <td>${UI.esc(r.s.kelas || '-')}</td>
              <td>${r.subs}</td>
              <td>${r.avgAsg ?? '-'}</td>
              <td>${r.attemptsCount}</td>
              <td>${r.avgCbt ?? '-'}</td>
              <td><strong>${r.presentPct}%</strong></td>
              <td>${UI.fmtRp(r.paid)}</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>`;
      }
    };
    container.querySelectorAll('[data-rtab]').forEach(b => b.addEventListener('click', () => {
      container.querySelectorAll('[data-rtab]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderTab(b.dataset.rtab);
    }));
    renderTab('class');
  }

  /* ========== KEUANGAN ========== */
  function renderKeuangan(container) {
    const renderAll = () => {
      const payments = DB.getPayments();
      const expenses = DB.getExpenses();
      const salaries = DB.getSalaries();
      const income = payments.filter(p => p.status === 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
      const pendingIncome = payments.filter(p => p.status !== 'lunas').reduce((s, p) => s + (p.amount || 0), 0);
      const expTotal = expenses.reduce((s, e) => s + (e.amount || 0), 0);
      const salTotal = salaries.filter(s => s.status === 'dibayar').reduce((s, p) => s + (p.amount || 0), 0);
      const expense = expTotal + salTotal;

      container.innerHTML = `
        <div class="finance-summary">
          <div class="fin-card income"><div class="label">Pemasukan</div><div class="value">${UI.fmtRp(income)}</div></div>
          <div class="fin-card expense"><div class="label">Pengeluaran</div><div class="value">${UI.fmtRp(expense)}</div></div>
          <div class="fin-card profit"><div class="label">Laba Bersih</div><div class="value">${UI.fmtRp(income - expense)}</div></div>
          <div class="fin-card" style="border-left:4px solid var(--warning);"><div class="label">Piutang</div><div class="value" style="color:var(--warning);">${UI.fmtRp(pendingIncome)}</div></div>
        </div>

        <div class="subtabs">
          <button class="subtab-btn active" data-ftab="income">Pemasukan (${payments.length})</button>
          <button class="subtab-btn" data-ftab="expense">Pengeluaran (${expenses.length})</button>
          <button class="subtab-btn" data-ftab="salary">Gaji Guru (${salaries.length})</button>
        </div>
        <div id="finBox"></div>
      `;
      container.querySelectorAll('[data-ftab]').forEach(b => b.addEventListener('click', () => {
        container.querySelectorAll('[data-ftab]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderTab(b.dataset.ftab);
      }));
      renderTab('income');
    };

    const renderTab = (tab) => {
      const box = document.getElementById('finBox');
      if (tab === 'income') renderIncome(box);
      else if (tab === 'expense') renderExpense(box);
      else renderSalary(box);
    };

    const renderIncome = (box) => {
      const payments = DB.getPayments().slice().sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>Pembayaran Siswa</h3>
            <button class="btn btn-primary btn-sm" id="addPayBtn">+ Tambah Pembayaran</button></div>
          ${payments.length === 0 ? emptyState('Belum ada pembayaran.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Siswa</th><th>Kelas</th><th>Jumlah</th><th>Metode</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${payments.map(p => {
              const s = DB.getUser(p.studentId);
              const c = p.courseId ? DB.getCourse(p.courseId) : null;
              return `<tr>
                <td>${UI.fmtDate(p.paidAt || p.createdAt)}</td>
                <td><strong>${UI.esc(s ? s.name : '-')}</strong></td>
                <td>${UI.esc(c ? c.title : 'Umum')}</td>
                <td>${UI.fmtRp(p.amount)}</td>
                <td>${UI.esc(p.method || '-')}</td>
                <td>${p.status === 'lunas' ? '<span class="badge badge-success">Lunas</span>' : '<span class="badge badge-warning">' + UI.esc(p.status || '-') + '</span>'}</td>
                <td class="muted small">${UI.esc(p.note || '-')}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-secondary" data-edit-pay="${p.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-pay="${p.id}">Hapus</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
        </div>
      `;
      document.getElementById('addPayBtn').addEventListener('click', () => openPaymentForm());
      box.querySelectorAll('[data-edit-pay]').forEach(b => b.addEventListener('click', () => openPaymentForm(b.dataset.editPay)));
      box.querySelectorAll('[data-del-pay]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus pembayaran ini?')) return;
        DB.deletePayment(b.dataset.delPay);
        UI.toast('Pembayaran dihapus.');
        renderAll();
      }));
    };

    const openPaymentForm = (editId) => {
      const editing = editId ? DB.getPayment(editId) : null;
      const students = DB.getUsers().filter(u => u.role === 'siswa');
      const courses = DB.getCourses();
      const body = `
        <form id="payForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Siswa</label>
              <select name="studentId" required>
                <option value="">-- Pilih Siswa --</option>
                ${students.map(s => `<option value="${s.id}" ${editing?.studentId === s.id ? 'selected' : ''}>${UI.esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Kelas (opsional)</label>
              <select name="courseId">
                <option value="">-- Pembayaran Umum --</option>
                ${courses.map(c => `<option value="${c.id}" ${editing?.courseId === c.id ? 'selected' : ''}>${UI.esc(c.title)} (${UI.fmtRp(c.price || 0)})</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Jumlah (Rp)</label>
              <input name="amount" type="number" min="0" required value="${editing?.amount || 0}" /></div>
            <div class="form-group"><label>Metode</label>
              <select name="method">
                ${['transfer', 'cash', 'qris', 'lainnya'].map(m => `<option value="${m}" ${editing?.method === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Status</label>
              <select name="status">
                ${['lunas', 'pending', 'dibatalkan'].map(s => `<option value="${s}" ${editing?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Tanggal</label>
              <input name="paidAt" type="date" required value="${UI.toDateInput(editing?.paidAt || Date.now())}" /></div>
          </div>
          <div class="form-group"><label>Catatan</label>
            <input name="note" value="${UI.esc(editing?.note || '')}" /></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open(editing ? 'Edit Pembayaran' : 'Tambah Pembayaran', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      document.getElementById('payForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          studentId: fd.get('studentId'),
          courseId: fd.get('courseId') || null,
          amount: Number(fd.get('amount')),
          method: fd.get('method'),
          status: fd.get('status'),
          note: fd.get('note').trim(),
          paidAt: new Date(fd.get('paidAt')).getTime()
        };
        if (editing) DB.updatePayment(editing.id, payload);
        else DB.addPayment(payload);
        UI.toast('Pembayaran disimpan.');
        UI.modal.close();
        renderAll();
      });
    };

    const renderExpense = (box) => {
      const expenses = DB.getExpenses().slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>Pengeluaran Operasional</h3>
            <button class="btn btn-primary btn-sm" id="addExBtn">+ Tambah Pengeluaran</button></div>
          ${expenses.length === 0 ? emptyState('Belum ada pengeluaran.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Kategori</th><th>Jumlah</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${expenses.map(e => `<tr>
              <td>${UI.fmtYMD(e.date)}</td>
              <td><span class="badge badge-info">${UI.esc(e.category)}</span></td>
              <td>${UI.fmtRp(e.amount)}</td>
              <td class="muted small">${UI.esc(e.note || '-')}</td>
              <td class="actions">
                <button class="btn btn-sm btn-secondary" data-edit-ex="${e.id}">Edit</button>
                <button class="btn btn-sm btn-danger" data-del-ex="${e.id}">Hapus</button>
              </td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        </div>
      `;
      document.getElementById('addExBtn').addEventListener('click', () => openExpenseForm());
      box.querySelectorAll('[data-edit-ex]').forEach(b => b.addEventListener('click', () => openExpenseForm(b.dataset.editEx)));
      box.querySelectorAll('[data-del-ex]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus pengeluaran ini?')) return;
        DB.deleteExpense(b.dataset.delEx);
        UI.toast('Pengeluaran dihapus.');
        renderAll();
      }));
    };

    const openExpenseForm = (editId) => {
      const editing = editId ? DB.getExpenses().find(x => x.id === editId) : null;
      const body = `
        <form id="exForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Kategori</label>
              <input name="category" required value="${UI.esc(editing?.category || '')}" placeholder="Operasional, Logistik, dll" /></div>
            <div class="form-group"><label>Jumlah (Rp)</label>
              <input name="amount" type="number" min="0" required value="${editing?.amount || 0}" /></div>
          </div>
          <div class="form-group"><label>Tanggal</label>
            <input name="date" type="date" required value="${editing?.date || UI.todayYMD()}" /></div>
          <div class="form-group"><label>Catatan</label>
            <input name="note" value="${UI.esc(editing?.note || '')}" /></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open(editing ? 'Edit Pengeluaran' : 'Tambah Pengeluaran', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      document.getElementById('exForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          category: fd.get('category').trim(),
          amount: Number(fd.get('amount')),
          date: fd.get('date'),
          note: fd.get('note').trim()
        };
        if (editing) DB.updateExpense(editing.id, payload);
        else DB.addExpense(payload);
        UI.toast('Pengeluaran disimpan.');
        UI.modal.close();
        renderAll();
      });
    };

    const renderSalary = (box) => {
      const salaries = DB.getSalaries().slice().sort((a, b) => (b.period || '').localeCompare(a.period || ''));
      const gurus = DB.getUsers().filter(u => u.role === 'guru');
      box.innerHTML = `
        <div class="card">
          <div class="card-header"><h3>Gaji / Honor Guru</h3>
            <button class="btn btn-primary btn-sm" id="addSalBtn">+ Catat Gaji</button></div>
          ${salaries.length === 0 ? emptyState('Belum ada data gaji.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Periode</th><th>Guru</th><th>Jumlah</th><th>Status</th><th>Dibayar</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${salaries.map(s => {
              const g = DB.getUser(s.teacherId);
              return `<tr>
                <td>${UI.esc(s.period)}</td>
                <td><strong>${UI.esc(g ? g.name : '-')}</strong></td>
                <td>${UI.fmtRp(s.amount)}</td>
                <td>${s.status === 'dibayar' ? '<span class="badge badge-success">Dibayar</span>' : '<span class="badge badge-warning">Pending</span>'}</td>
                <td>${s.status === 'dibayar' ? UI.fmtDate(s.paidAt) : '-'}</td>
                <td class="muted small">${UI.esc(s.note || '-')}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-secondary" data-edit-sal="${s.id}">Edit</button>
                  <button class="btn btn-sm btn-danger" data-del-sal="${s.id}">Hapus</button>
                </td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`}
        </div>
      `;
      document.getElementById('addSalBtn').addEventListener('click', () => openSalaryForm());
      box.querySelectorAll('[data-edit-sal]').forEach(b => b.addEventListener('click', () => openSalaryForm(b.dataset.editSal)));
      box.querySelectorAll('[data-del-sal]').forEach(b => b.addEventListener('click', () => {
        if (!UI.confirmDialog('Hapus data gaji ini?')) return;
        DB.deleteSalary(b.dataset.delSal);
        UI.toast('Gaji dihapus.');
        renderAll();
      }));
    };

    const openSalaryForm = (editId) => {
      const editing = editId ? DB.getSalaries().find(x => x.id === editId) : null;
      const gurus = DB.getUsers().filter(u => u.role === 'guru');
      const periodDefault = editing?.period || DB.periodKey(new Date());
      const body = `
        <form id="salForm" class="form">
          <div class="form-row">
            <div class="form-group"><label>Guru</label>
              <select name="teacherId" required id="salTeacher">
                <option value="">-- Pilih Guru --</option>
                ${gurus.map(g => `<option value="${g.id}" data-rate="${g.salaryRate || 0}" ${editing?.teacherId === g.id ? 'selected' : ''}>${UI.esc(g.name)} (${UI.fmtRp(g.salaryRate || 0)}/bln)</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Periode (YYYY-MM)</label>
              <input name="period" required value="${UI.esc(periodDefault)}" placeholder="2026-05" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Jumlah (Rp)</label>
              <input name="amount" type="number" min="0" required value="${editing?.amount || 0}" id="salAmount" /></div>
            <div class="form-group"><label>Status</label>
              <select name="status">
                ${['pending', 'dibayar'].map(s => `<option value="${s}" ${editing?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Tanggal Bayar</label>
              <input name="paidAt" type="date" value="${UI.toDateInput(editing?.paidAt || Date.now())}" /></div>
            <div class="form-group"><label>Catatan</label>
              <input name="note" value="${UI.esc(editing?.note || '')}" /></div>
          </div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open(editing ? 'Edit Gaji Guru' : 'Catat Gaji Guru', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());
      // Auto-fill amount from teacher's salaryRate
      const teacherSel = document.getElementById('salTeacher');
      const amountInp = document.getElementById('salAmount');
      teacherSel.addEventListener('change', (e) => {
        const rate = e.target.selectedOptions[0]?.dataset.rate;
        if (rate && (!editing || !amountInp.value || amountInp.value === '0')) amountInp.value = rate;
      });
      document.getElementById('salForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const payload = {
          teacherId: fd.get('teacherId'),
          period: fd.get('period').trim(),
          amount: Number(fd.get('amount')),
          status: fd.get('status'),
          paidAt: new Date(fd.get('paidAt')).getTime(),
          note: fd.get('note').trim()
        };
        if (editing) DB.updateSalary(editing.id, payload);
        else DB.addSalary(payload);
        UI.toast('Gaji disimpan.');
        UI.modal.close();
        renderAll();
      });
    };

    renderAll();
  }

  global.AdminPanel = { render };
})(window);
