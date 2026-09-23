/* ===== Admin Panel =====
 * Manage guru, siswa, courses, view stats, reset data.
 */
(function (global) {
  // Kelas yang sedang dibuka di tampilan detail admin (null = daftar)
  let adminCourseId = null;

  function render(container, section, user) {
    if (section === 'overview') return renderOverview(container);
    if (section === 'guru') return renderUsers(container, 'guru');
    if (section === 'siswa') return renderUsers(container, 'siswa');
    if (section === 'orangtua') return renderParents(container);
    if (section === 'courses') {
      if (adminCourseId) return renderAdminCourseDetail(container, adminCourseId, user);
      return renderCourses(container);
    }
    // CBT & Bank Soal kini memakai workspace khusus (js/cbt.js)
    if (section === 'admin-cbt') return CbtAdmin.renderCbtHome(container, user);
    if (section === 'admin-bank-soal') return CbtAdmin.renderBankHome(container, user);
    if (section === 'jadwal-kelas') return renderJadwalKelas(container, user);
    if (section === 'batch') return renderBatch(container);
    if (section === 'alumni') return renderAlumni(container);
    if (section === 'attendance') return renderAttendance(container, user);
    if (section === 'rekap') return renderRekap(container, user);
    if (section === 'motivasi') return renderMotivasi(container);
    if (section === 'keamanan-login') return renderKeamananLogin(container);
    if (section === 'leaderboard') return Shared.renderLeaderboard(container, user);
    if (section === 'kalender') return Shared.renderCalendar(container, user);
    if (section === 'pengumuman') return Shared.renderAnnouncements(container, user);
    if (section === 'feedback') return Shared.renderFeedback(container, user);
    if (section === 'chat') return Shared.renderChat(container, user);
    if (section === 'ai-analytics') return Shared.renderAiAnalytics(container, user);
    if (section === 'agent-web') return renderAgentWeb(container, user);
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

    /* Daftar subtest diambil dari konstanta bersama DB.SUBTESTS supaya tidak
     * ada dua sumber kebenaran, dan selalu tersedia opsi "Lainnya" agar
     * bimbel bisa menambah materi di luar tujuh subtest UTBK. */
    const SUBTESTS = DB.SUBTEST_NAMES;
    const curSubject = editing ? (editing.subject || '') : '';
    const isOtherSubject = !!curSubject && !SUBTESTS.includes(curSubject);

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
          <div class="form-group"><label for="guSubject">Guru Subtest</label>
            <select name="subject" id="guSubject" required>
              <option value="">-- Pilih Subtest --</option>
              ${SUBTESTS.map(s => `<option value="${UI.esc(s)}" ${curSubject === s ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}
              <option value="__OTHER__" ${isOtherSubject ? 'selected' : ''}>✏️ Lainnya (tulis manual)</option>
            </select>
          </div>
          <div class="form-group ${isOtherSubject ? '' : 'hidden'}" id="guSubjectOtherBox">
            <label for="guSubjectOther">Nama Subtest / Materi (manual)</label>
            <input name="subjectOther" id="guSubjectOther" value="${UI.esc(isOtherSubject ? curSubject : '')}"
                   placeholder="mis. Kimia Dasar, Kelas Intensif Saintek" />
            <div class="muted small">Dipakai bila materi yang diampu di luar tujuh subtest UTBK.</div>
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

    /* Opsi "Lainnya" pada subtest tutor: tampilkan kolom manual bila dipilih.
     * Pola yang sama dipakai pada form kelas agar konsisten. */
    const subjSel = document.getElementById('guSubject');
    const subjBox = document.getElementById('guSubjectOtherBox');
    const subjInp = document.getElementById('guSubjectOther');
    const syncSubject = () => {
      if (!subjSel) return;
      const other = subjSel.value === '__OTHER__';
      subjBox.classList.toggle('hidden', !other);
      subjInp.required = other;
    };
    if (subjSel) { subjSel.addEventListener('change', syncSubject); syncSubject(); }
    const currentSubject = () => {
      if (!subjSel) return '';
      return subjSel.value === '__OTHER__' ? (subjInp.value || '').trim() : subjSel.value;
    };

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
        if (isGuru && !currentSubject()) {
          err.textContent = 'Pilih subtest atau tulis nama materinya secara manual.';
          err.classList.remove('hidden');
          return;
        }
        const record = { id: DB.uid('u'), role, name, username, email, password, status };
        if (isGuru) {
          record.subject = currentSubject();
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
        if (isGuru && !currentSubject()) {
          err.textContent = 'Pilih subtest atau tulis nama materinya secara manual.';
          err.classList.remove('hidden');
          return;
        }
        const patch = { name, email, status };
        if (isGuru) {
          patch.subject = currentSubject();
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

  function renderCourses(container, user) {
    const courses = DB.getCourses();
    const currentUser = user || (global.Dashboard && Dashboard.currentUser) || { role: 'admin' };
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
            Kolom yang dikenali: <strong>Judul Kelas</strong>, <strong>Subtest</strong>,
            <strong>Kelas Utama</strong> (pisahkan koma, mis. "Kelas 11-A, Kelas 11-B"),
            <strong>Username Guru</strong> (boleh beberapa, pisahkan koma untuk kelas dengan lebih dari satu tutor),
            <strong>Hari</strong>, <strong>Jam Mulai</strong>, <strong>Jam Selesai</strong>,
            <strong>Tanggal Mulai</strong>, <strong>Jumlah Pertemuan</strong>, <strong>Tautan Kelas</strong>,
            <strong>Kategori</strong>, <strong>Deskripsi</strong>, <strong>Biaya</strong>, dan <strong>Password</strong>.
            Siswa pada kelas utama yang dicantumkan otomatis terdaftar. Kelas dengan judul yang sama akan dilewati.
          </p>
        </details>
        ${courses.length === 0 ? emptyState('Belum ada kelas.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Kelas</th><th>Subtest</th><th>Kelas Utama</th><th>Tutor</th><th>Jadwal</th><th>Password</th><th>Siswa</th><th>Aksi</th></tr></thead>
          <tbody>
            ${courses.map(c => {
              const tutors = DB.courseTeachers(c);
              const enrollCount = DB.getEnrollmentsByCourse(c.id).length;
              const locked = DB.hasCoursePassword(c.id);
              const st = DB.subtestByName(c.subtest);
              return `<tr>
                <td><strong>${UI.esc(DB.courseTitle(c))}</strong>
                  <div class="small muted">${UI.esc(RichText ? RichText.plain(c.description, 70) : (c.description || ''))}</div></td>
                <td>${st ? `<span class="badge badge-info">${st.icon} ${UI.esc(st.short)}</span>`
                          : `<span class="badge badge-gray">${UI.esc(c.subtest || c.category || '-')}</span>`}</td>
                <td>${(c.mainClasses || []).length
                  ? (c.mainClasses).map(k => `<span class="badge badge-gray" style="margin:1px;">${UI.esc(k)}</span>`).join('')
                  : '<span class="muted small">-</span>'}</td>
                <td>${tutors.length
                  ? tutors.map(t => `<div class="small">${UI.esc(t.name)}</div>`).join('')
                  : '<span class="muted small">-</span>'}</td>
                <td class="small">${UI.esc(DB.courseScheduleLabel(c))}</td>
                <td>${locked
                  ? `<span class="badge badge-warning" title="Password kelas">🔒 ${UI.esc(c.password)}</span>`
                  : '<span class="badge badge-gray">Terbuka</span>'}
                  <button class="btn btn-sm btn-secondary" data-set-pw="${c.id}" style="margin-left:6px;">Atur</button>
                </td>
                <td>${enrollCount}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-primary" data-open-course="${c.id}">📂 Lihat Kelas</button>
                  <button class="btn btn-sm btn-secondary" data-manage-students="${c.id}">Kelola Siswa</button>
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
      Shared.openCoursePasswordForm(b.dataset.setPw, () => renderCourses(container, currentUser));
    }));
    // Buka isi kelas seperti tampilan dashboard tutor
    container.querySelectorAll('[data-open-course]').forEach(b => b.addEventListener('click', () => {
      adminCourseId = b.dataset.openCourse;
      renderAdminCourseDetail(container, adminCourseId, currentUser);
    }));

    /* ---- Export Excel kelas ---- */
    document.getElementById('exportCourseBtn').addEventListener('click', () => {
      if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat. Coba reload halaman.', 'error'); return; }
      let rows = DB.getCourses().map(c => {
        const tutors = DB.courseTeachers(c);
        const sc = c.schedule || {};
        return {
          'Judul Kelas': DB.courseTitle(c),
          Subtest: c.subtest || '',
          'Kelas Utama': (c.mainClasses || []).join(', '),
          Kategori: c.category || '',
          Deskripsi: c.description || '',
          Biaya: c.price || 0,
          Password: c.password || '',
          'Username Guru': tutors.map(t => t.username).join(', '),
          'Nama Guru': tutors.map(t => t.name).join(', '),
          Hari: (sc.days || []).join(', '),
          'Jam Mulai': sc.time || '',
          'Jam Selesai': sc.endTime || '',
          'Tanggal Mulai': sc.startDate || '',
          'Jumlah Pertemuan': sc.sessions || '',
          'Tautan Kelas': c.meetingLink || '',
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

            // Kolom opsional: beberapa username tutor & beberapa kelas utama
            const extraTutors = String(row['Username Guru'] || '').split(/[,;]/).map(x => x.trim()).filter(Boolean)
              .map(u => DB.findUserByUsername(u)).filter(t => t && t.role === 'guru').map(t => t.id);
            const teacherIds = extraTutors.length ? [...new Set(extraTutors)] : [teacher.id];
            const mains = String(row['Kelas Utama'] || row['kelas utama'] || '').split(/[,;]/)
              .map(x => x.trim()).filter(Boolean);
            const days = String(row.Hari || row.hari || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
            const subtestCol = String(row.Subtest || row.subtest || '').trim();

            DB.addCourse({
              subtest: subtestCol || (DB.SUBTEST_NAMES.includes(title) ? title : ''),
              title,
              mainClasses: mains,
              teacherIds,
              category: String(row.Kategori || row.kategori || row.Category || '').trim(),
              description: String(row.Deskripsi || row.deskripsi || row.Description || '').trim() || title,
              price: Number(row.Biaya || row.biaya || row.Price || row.harga || 0) || 0,
              password: String(row.Password || row.password || '').trim(),
              meetingLink: String(row['Tautan Kelas'] || row.Link || row.link || '').trim(),
              schedule: {
                days,
                time: String(row['Jam Mulai'] || row.Jam || '').trim(),
                endTime: String(row['Jam Selesai'] || '').trim(),
                startDate: String(row['Tanggal Mulai'] || '').trim() || UI.todayYMD(),
                sessions: Number(row['Jumlah Pertemuan'] || 16) || 16
              }
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

  /* ========== FORM KELAS SUBTEST ==========
   * Satu kelas = 1 subtest + kelas utama yang mengisinya + 1..n tutor +
   * jadwal mengajar (hari, jam, tanggal mulai).
   */
  function openAdminCourseForm(container, editId) {
    const editing = editId ? DB.getCourse(editId) : null;
    const gurus = DB.getUsers().filter(u => u.role === 'guru' && (u.status || 'Aktif') === 'Aktif');
    const mainClasses = DB.getMainClassesWithCounts();
    const sched = (editing && editing.schedule) || {};
    const selTeachers = new Set(editing ? DB.courseTeacherIds(editing) : []);
    const selMains = new Set((editing && editing.mainClasses) || []);
    const selDays = new Set(sched.days || []);
    const curSubtest = editing ? (editing.subtest || '') : '';

    const body = `
      <form id="adminCourseForm" class="form">
        <div class="form-group">
          <label>Subtest yang Diajarkan</label>
          <select name="subtest" id="acSubtest" required>
            <option value="">-- Pilih Subtest UTBK --</option>
            ${DB.SUBTESTS.map(x => `<option value="${UI.esc(x.name)}" ${curSubtest === x.name ? 'selected' : ''}>${x.icon} ${UI.esc(x.name)}</option>`).join('')}
            <option value="__OTHER__" ${editing && curSubtest && !DB.SUBTEST_NAMES.includes(curSubtest) ? 'selected' : ''}>✏️ Lainnya (tulis manual)</option>
          </select>
        </div>
        <div class="form-group ${editing && curSubtest && !DB.SUBTEST_NAMES.includes(curSubtest) ? '' : 'hidden'}" id="acSubtestOtherBox">
          <label>Nama Subtest / Materi (manual)</label>
          <input name="subtestOther" id="acSubtestOther" value="${UI.esc(editing && !DB.SUBTEST_NAMES.includes(curSubtest) ? curSubtest : '')}" placeholder="mis. Kelas Intensif Saintek" />
        </div>

        <div class="form-group">
          <label>Kelas Utama yang Mengisi Kelas Ini</label>
          <div class="tgt-grid">
            ${mainClasses.length === 0
              ? '<div class="muted small">Belum ada kelas utama. Tambahkan lewat menu Pengaturan.</div>'
              : mainClasses.map(mc => `
                <label class="tgt-box ${selMains.has(mc.name) ? 'is-on' : ''}">
                  <input type="checkbox" name="mainClass" value="${UI.esc(mc.name)}" ${selMains.has(mc.name) ? 'checked' : ''} />
                  <div>
                    <div class="tgt-name">${UI.esc(mc.name)}</div>
                    <div class="tgt-meta">${mc.active} siswa aktif</div>
                  </div>
                </label>`).join('')}
          </div>
          <p class="muted small" style="margin:8px 0 0;">Seluruh siswa pada kelas utama yang dicentang otomatis terdaftar di kelas ini.</p>
        </div>

        <div class="form-group">
          <label>Tutor Pengajar <span class="muted small">(boleh lebih dari satu)</span></label>
          <div class="tgt-grid">
            ${gurus.length === 0
              ? '<div class="muted small">Belum ada guru aktif.</div>'
              : gurus.map(g => `
                <label class="tgt-box ${selTeachers.has(g.id) ? 'is-on' : ''}">
                  <input type="checkbox" name="teacherIds" value="${g.id}" ${selTeachers.has(g.id) ? 'checked' : ''} />
                  <div>
                    <div class="tgt-name">${UI.esc(g.name)}</div>
                    <div class="tgt-meta">${UI.esc(g.subject ? (DB.subtestByName(g.subject)?.short || g.subject) : 'Tanpa subtest')}</div>
                  </div>
                </label>`).join('')}
          </div>
        </div>

        <div class="form-group">
          <label>Hari Mengajar</label>
          <div class="day-chips">
            ${DB.DAY_NAMES.map(d => `
              <label class="day-chip ${selDays.has(d) ? 'is-on' : ''}">
                <input type="checkbox" name="days" value="${d}" ${selDays.has(d) ? 'checked' : ''} />
                <span>${d.slice(0, 3)}</span>
              </label>`).join('')}
          </div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Jam Mulai</label>
            <input name="time" type="time" value="${UI.esc(sched.time || '16:00')}" /></div>
          <div class="form-group"><label>Jam Selesai</label>
            <input name="endTime" type="time" value="${UI.esc(sched.endTime || '17:30')}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Tanggal Mulai Kelas</label>
            <input name="startDate" type="date" value="${UI.esc(sched.startDate || UI.todayYMD())}" /></div>
          <div class="form-group"><label>Jumlah Pertemuan</label>
            <input name="sessions" type="number" min="1" max="200" value="${sched.sessions || 16}" /></div>
        </div>

        <div class="form-row">
          <div class="form-group"><label>Kategori</label>
            <input name="category" value="${UI.esc(editing?.category || '')}" placeholder="mis. TPS / Literasi" /></div>
          <div class="form-group"><label>Biaya / SPP (Rp)</label>
            <input name="price" type="number" min="0" value="${editing?.price || 0}" /></div>
        </div>

        <div class="form-group"><label>Tautan Zoom / Google Meet</label>
          <input name="meetingLink" type="url" value="${UI.esc(editing?.meetingLink || '')}" placeholder="https://meet.google.com/xxx-xxxx-xxx" />
          <p class="muted small" style="margin:6px 0 0;">Dipakai sebagai tautan bawaan saat kelas masuk agenda "Hari Ini".</p>
        </div>

        <div class="form-group"><label>Deskripsi</label>
          <textarea name="description" required>${UI.esc(editing?.description || '')}</textarea></div>

        <div class="form-group">
          <label>🔒 Password Kelas (untuk "Jelajah Kelas")</label>
          <input name="password" value="${UI.esc(editing?.password || '')}" placeholder="Kosongkan bila kelas terbuka tanpa password" />
          <p class="muted small" style="margin:6px 0 0;">Hanya diminta saat siswa bergabung sendiri lewat halaman
          <strong>Jelajah Kelas</strong>. Pendaftaran lewat kelas utama tidak memerlukan password.</p>
        </div>

        <div id="acPreview" class="alert alert-info"></div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
          <button type="submit" class="btn btn-primary">Simpan</button>
        </div>
      </form>`;

    UI.modal.open(editing ? 'Edit Kelas Subtest' : 'Buat Kelas Subtest Baru', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    const form = document.getElementById('adminCourseForm');
    const subSel = document.getElementById('acSubtest');
    const otherBox = document.getElementById('acSubtestOtherBox');
    const otherInp = document.getElementById('acSubtestOther');

    const syncOther = () => {
      const other = subSel.value === '__OTHER__';
      otherBox.classList.toggle('hidden', !other);
      otherInp.required = other;
    };
    subSel.addEventListener('change', () => { syncOther(); updatePreview(); });
    syncOther();

    // Sorot pilihan & tampilkan pratinjau nama kelas
    form.querySelectorAll('.tgt-box input, .day-chip input').forEach(cb => {
      cb.addEventListener('change', () => {
        const wrap = cb.closest('.tgt-box') || cb.closest('.day-chip');
        if (wrap) wrap.classList.toggle('is-on', cb.checked);
        updatePreview();
      });
    });
    form.querySelectorAll('[name="time"], [name="endTime"], [name="subtestOther"]')
      .forEach(el => el.addEventListener('input', updatePreview));

    function currentSubtest() {
      return subSel.value === '__OTHER__' ? (otherInp.value || '').trim() : subSel.value;
    }
    function updatePreview() {
      const fd = new FormData(form);
      const mains = fd.getAll('mainClass');
      const tIds = fd.getAll('teacherIds');
      const days = fd.getAll('days');
      const st = DB.subtestByName(currentSubtest());
      const tutorNames = tIds.map(id => (DB.getUser(id) || {}).name).filter(Boolean);
      const studentCount = mains.reduce((n, k) =>
        n + DB.getStudentsByMainClass(k).filter(x => (x.status || 'Aktif') === 'Aktif').length, 0);
      const title = [mains.join(', '), st ? st.short : currentSubtest(), tutorNames.join(' & ')]
        .filter(Boolean).join(' • ') || '(lengkapi data di atas)';
      document.getElementById('acPreview').innerHTML =
        `<strong>Nama kelas:</strong> ${UI.esc(title)}<br>
         <strong>Jadwal:</strong> ${days.length ? UI.esc(days.join(', ')) : '(belum dipilih)'} ${UI.esc(fd.get('time') || '')}${fd.get('endTime') ? '–' + UI.esc(fd.get('endTime')) : ''}<br>
         <strong>Perkiraan siswa:</strong> ${studentCount} siswa dari ${mains.length} kelas utama`;
    }
    updatePreview();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const subtest = currentSubtest();
      if (!subtest) { UI.toast('Pilih subtest atau tulis namanya secara manual.', 'error'); return; }

      const teacherIds = fd.getAll('teacherIds');
      if (teacherIds.length === 0) { UI.toast('Pilih minimal satu tutor pengajar.', 'error'); return; }
      const mains = fd.getAll('mainClass');
      const days = fd.getAll('days');

      const st = DB.subtestByName(subtest);
      const tutorNames = teacherIds.map(id => (DB.getUser(id) || {}).name).filter(Boolean);
      const title = [mains.join(', '), st ? st.short : subtest, tutorNames.join(' & ')]
        .filter(Boolean).join(' • ');

      const payload = {
        subtest,
        title,
        mainClasses: mains,
        teacherIds,
        category: (fd.get('category') || '').trim(),
        price: Number(fd.get('price') || 0),
        description: (fd.get('description') || '').trim(),
        password: (fd.get('password') || '').trim(),
        meetingLink: (fd.get('meetingLink') || '').trim(),
        schedule: {
          days,
          time: fd.get('time') || '',
          endTime: fd.get('endTime') || '',
          startDate: fd.get('startDate') || UI.todayYMD(),
          sessions: Number(fd.get('sessions') || 16)
        }
      };

      if (editing) {
        DB.updateCourse(editing.id, payload);
        const r = DB.syncCourseMainClasses(editing.id, mains);
        UI.toast(`Kelas diperbarui.${r && r.added ? ' ' + r.added + ' siswa baru terdaftar.' : ''}`);
      } else {
        const created = DB.addCourse(payload);
        const n = DB.getEnrollmentsByCourse(created.id).length;
        UI.toast(`Kelas dibuat dengan ${n} siswa dari ${mains.length} kelas utama.`);
      }
      UI.modal.close();
      renderCourses(container);
    });
  }

  /* ========== KELOLA SISWA DI KELAS (berbasis kelas utama) ==========
   * Tidak perlu mencentang siswa satu per satu: cukup pilih kelas utama,
   * lengkap dengan keterangan jumlah siswa di dalamnya.
   */
  function openBulkEnrollModal(courseId, container) {
    const course = DB.getCourse(courseId);
    const mainClasses = DB.getMainClassesWithCounts();
    const enrolledIds = new Set(DB.getEnrollmentsByCourse(courseId).map(e => e.studentId));
    const selMains = new Set(course.mainClasses || []);

    // Siswa yang terdaftar namun kelas utamanya tidak dicentang (perorangan)
    const extraStudents = [...enrolledIds]
      .map(id => DB.getUser(id))
      .filter(u => u && !selMains.has(u.kelas));

    const body = `
      <div class="muted small mb-2">
        Pilih <strong>kelas utama</strong> yang mengisi kelas
        <strong>${UI.esc(DB.courseTitle(course))}</strong>. Semua siswa di dalam kelas utama
        tersebut akan terdaftar otomatis — tidak perlu mencentang satu per satu.
      </div>
      <div class="tgt-grid">
        ${mainClasses.length === 0
          ? '<div class="muted small">Belum ada kelas utama. Tambahkan lewat menu Pengaturan.</div>'
          : mainClasses.map(mc => {
            const already = mc.studentIds.filter(id => enrolledIds.has(id)).length;
            return `<label class="tgt-box ${selMains.has(mc.name) ? 'is-on' : ''}">
              <input type="checkbox" name="mc" value="${UI.esc(mc.name)}" ${selMains.has(mc.name) ? 'checked' : ''} />
              <div>
                <div class="tgt-name">${UI.esc(mc.name)}</div>
                <div class="tgt-meta">${mc.active} siswa aktif${already ? ` • ${already} sudah terdaftar` : ''}</div>
              </div>
            </label>`;
          }).join('')}
      </div>

      ${extraStudents.length ? `
      <div class="alert alert-warning mt-2">
        <strong>${extraStudents.length} siswa terdaftar perorangan</strong>
        (kelas utamanya tidak dicentang): ${extraStudents.map(s => UI.esc(s.name)).join(', ')}.
        Mereka tetap terdaftar kecuali Anda menghapusnya di bawah.
      </div>
      <label class="qe-check"><input type="checkbox" id="dropExtra" /> Hapus juga pendaftaran perorangan tersebut</label>` : ''}

      <div id="enrollPreview" class="alert alert-info mt-2"></div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
        <button type="button" class="btn btn-primary" id="saveEnrollBtn">Simpan Perubahan</button>
      </div>`;

    UI.modal.open('Kelola Siswa di Kelas', body);
    document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

    const boxes = [...document.querySelectorAll('[name="mc"]')];
    const preview = document.getElementById('enrollPreview');
    const updatePreview = () => {
      const picked = boxes.filter(b => b.checked).map(b => b.value);
      const total = picked.reduce((n, k) =>
        n + DB.getStudentsByMainClass(k).filter(x => (x.status || 'Aktif') === 'Aktif').length, 0);
      preview.innerHTML = picked.length
        ? `Akan terdaftar: <strong>${total} siswa</strong> dari ${picked.length} kelas utama (${UI.esc(picked.join(', '))}).`
        : 'Belum ada kelas utama dipilih — seluruh pendaftaran berbasis kelas utama akan dilepas.';
    };
    boxes.forEach(b => b.addEventListener('change', () => {
      b.closest('.tgt-box').classList.toggle('is-on', b.checked);
      updatePreview();
    }));
    updatePreview();

    document.getElementById('saveEnrollBtn').addEventListener('click', () => {
      const picked = boxes.filter(b => b.checked).map(b => b.value);
      const res = DB.syncCourseMainClasses(courseId, picked);
      let dropped = 0;
      const dropExtra = document.getElementById('dropExtra');
      if (dropExtra && dropExtra.checked) {
        extraStudents.forEach(s => { DB.unenroll(courseId, s.id); dropped++; });
      }
      const total = DB.getEnrollmentsByCourse(courseId).length;
      UI.toast(`Tersimpan: ${total} siswa terdaftar${res && res.added ? ` (+${res.added} baru)` : ''}${dropped ? `, ${dropped} perorangan dilepas` : ''}.`);
      UI.modal.close();
      renderCourses(container);
    });
  }

  /* ========== DETAIL KELAS (tampilan admin, sama seperti dashboard tutor) ==========
   * Memakai komponen tab milik GuruPanel agar admin melihat modul, materi,
   * tugas, CBT, presensi, dan siswa dengan tampilan yang identik.
   */
  function renderAdminCourseDetail(container, courseId, user) {
    const course = DB.getCourse(courseId);
    if (!course) { adminCourseId = null; return renderCourses(container); }
    const tutors = DB.courseTeachers(course);
    const enrollments = DB.getEnrollmentsByCourse(course.id);
    const plans = DB.getClassPlansByCourse(course.id);
    const st = DB.subtestByName(course.subtest);

    container.innerHTML = `
      <div class="flex-between mb-2" style="flex-wrap:wrap;gap:8px;">
        <button class="btn btn-secondary btn-sm" id="acBack">← Kembali ke Semua Kelas</button>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="acPw">🔒 Password Kelas</button>
          <button class="btn btn-secondary btn-sm" id="acStudents">👥 Kelola Siswa</button>
          <button class="btn btn-primary btn-sm" id="acEdit">Edit Kelas</button>
        </div>
      </div>

      <div class="card">
        <div class="flex-between mb-1" style="flex-wrap:wrap;gap:8px;">
          <div>
            <h3 class="mt-0">${st ? st.icon + ' ' : ''}${UI.esc(DB.courseTitle(course))}</h3>
            <div class="muted small">
              ${UI.esc(course.subtest || course.category || 'Umum')} •
              ${enrollments.length} siswa • ${tutors.length} tutor
            </div>
          </div>
          <span class="badge ${DB.hasCoursePassword(course.id) ? 'badge-warning' : 'badge-gray'}">
            ${DB.hasCoursePassword(course.id) ? '🔒 Password: ' + UI.esc(course.password) : '🔓 Terbuka'}
          </span>
        </div>
        <p>${UI.esc(course.description || '')}</p>
        <div class="table-wrap"><table class="table">
          <tbody>
            <tr><th style="width:170px;">Kelas Utama</th><td>${(course.mainClasses || []).length
              ? (course.mainClasses).map(k => `<span class="badge badge-info" style="margin:2px;">${UI.esc(k)} (${DB.getStudentsByMainClass(k).length} siswa)</span>`).join('')
              : '<span class="muted">Belum diisi</span>'}</td></tr>
            <tr><th>Tutor</th><td>${tutors.length
              ? tutors.map(t => `<span class="badge badge-success" style="margin:2px;">${UI.esc(t.name)}</span>`).join('')
              : '<span class="muted">Belum ada tutor</span>'}</td></tr>
            <tr><th>Jadwal</th><td>${UI.esc(DB.courseScheduleLabel(course))}${course.schedule && course.schedule.startDate ? ` • mulai ${UI.fmtYMD(course.schedule.startDate)}` : ''}${course.schedule && course.schedule.sessions ? ` • ${course.schedule.sessions} pertemuan` : ''}</td></tr>
            <tr><th>Tautan Kelas</th><td>${course.meetingLink
              ? `<a href="${UI.esc(course.meetingLink)}" target="_blank" rel="noopener noreferrer">${UI.esc(course.meetingLink)}</a>`
              : '<span class="muted">Belum diisi</span>'}</td></tr>
            <tr><th>Rencana Kelas</th><td>${plans.length} rencana • ${plans.filter(p => p.status === 'fixed').length} sudah fix</td></tr>
            <tr><th>Biaya / SPP</th><td>${UI.fmtRp(course.price || 0)}</td></tr>
          </tbody>
        </table></div>
      </div>

      ${Jadwal.courseScheduleCardHtml(course, user, { linkToJadwal: true })}

      <div class="tabs">
        <button class="tab-btn active" data-atab="materials">Materi (${DB.getMaterialsByCourse(course.id).length})</button>
        <button class="tab-btn" data-atab="modules">Modul (${DB.getModulesByCourse(course.id).length})</button>
        <button class="tab-btn" data-atab="recordings">Rekaman (${DB.getRecordingsByCourse(course.id).length})</button>
        <button class="tab-btn" data-atab="assignments">Tugas (${DB.getAssignmentsByCourse(course.id).length})</button>
        <button class="tab-btn" data-atab="cbts">CBT (${DB.getCbtsByCourse(course.id).length})</button>
        <button class="tab-btn" data-atab="attendance">Presensi</button>
        <button class="tab-btn" data-atab="students">Siswa (${enrollments.length})</button>
      </div>
      <div id="tabContent"></div>
    `;

    document.getElementById('acBack').addEventListener('click', () => {
      adminCourseId = null;
      renderCourses(container);
    });
    document.getElementById('acEdit').addEventListener('click', () => openAdminCourseForm(container, course.id));
    document.getElementById('acPw').addEventListener('click', () =>
      Shared.openCoursePasswordForm(course.id, () => renderAdminCourseDetail(container, course.id, user)));
    document.getElementById('acStudents').addEventListener('click', () => openBulkEnrollModal(course.id, container));

    const showTab = (tab) => {
      GuruPanel.renderCourseTab(tab, course, user, document.getElementById('tabContent'));
      if (global.Effects) Effects.enhance(container);
      if (global.Responsive) Responsive.apply(container);
    };
    container.querySelectorAll('[data-atab]').forEach(btn => btn.addEventListener('click', () => {
      container.querySelectorAll('[data-atab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showTab(btn.dataset.atab);
    }));
    const goJ = document.getElementById('csGoJadwal');
    if (goJ) goJ.addEventListener('click', () => Dashboard.navigate('jadwal-kelas'));
    showTab('materials');
  }

  /* ========== JADWAL KELAS (agenda + War Jadwal) ==========
   * Seluruh logika ada di js/jadwal.js agar dipakai bersama panel tutor.
   */
  function renderJadwalKelas(container, user) {
    Jadwal.renderJadwalPage(container, user || (global.Dashboard && Dashboard.currentUser) || { role: 'admin' });
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

  /* ========== KATA MOTIVASI ==========
   * Kotak motivasi yang tampil di dashboard siswa, tutor, dan orang tua.
   * Kalimatnya berbeda per peran dan sepenuhnya dikelola dari sini.
   */
  const MOTIV_ROLES = [
    { key: 'siswa', label: '👨‍🎓 Siswa', hint: 'Tampil di Overview siswa' },
    { key: 'guru', label: '👨‍🏫 Tutor', hint: 'Tampil di Overview tutor' },
    { key: 'orangtua', label: '👨‍👩‍👦 Orang Tua', hint: 'Tampil di Overview orang tua' }
  ];
  let motivRole = 'siswa';

  function renderMotivasi(container) {
    const settings = DB.getSettings();
    const enabled = settings.motivationEnabled !== false;

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('💡', 'Kata Motivasi Dashboard', 'Kotak semangat yang tampil di halaman Overview tiap peran')}
          <label class="switch">
            <input type="checkbox" id="mvEnabled" ${enabled ? 'checked' : ''} />
            <span>Aktifkan kotak motivasi</span>
          </label>
        </div>
        <p class="muted small">
          Setiap peran memiliki daftar kalimat sendiri. Sistem memilih satu kalimat aktif
          secara bergilir tiap hari, dan pengguna dapat menekan “Kutipan Lain” untuk melihat kalimat lainnya.
          Menonaktifkan sakelar di atas menyembunyikan kotak ini dari semua dashboard.
        </p>
        ${!enabled ? '<div class="alert alert-info" style="margin-bottom:0;">Kotak motivasi sedang dimatikan — tidak tampil di dashboard mana pun.</div>' : ''}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('👁️', 'Pratinjau', 'tampilan kotak seperti yang dilihat pengguna')}</div>
        <div id="mvPreview" class="mv-preview"></div>
      </div>

      <div class="subtabs">
        ${MOTIV_ROLES.map(r => `<button class="subtab-btn ${motivRole === r.key ? 'active' : ''}" data-mvrole="${r.key}">${r.label} (${DB.getMotivations(r.key).length})</button>`).join('')}
      </div>
      <div id="mvBox"></div>
    `;

    // Pratinjau ketiga peran sekaligus
    const prev = document.getElementById('mvPreview');
    prev.innerHTML = MOTIV_ROLES.map(r => Shared.motivationHtml(r.key) ||
      `<div class="empty"><div class="empty-icon">💤</div>Belum ada kutipan aktif untuk ${UI.esc(r.label.replace(/^\S+\s/, ''))}.</div>`).join('');
    Shared.bindMotivation(prev);

    document.getElementById('mvEnabled').addEventListener('change', (e) => {
      DB.setSetting('motivationEnabled', e.target.checked);
      UI.toast(e.target.checked ? 'Kotak motivasi diaktifkan.' : 'Kotak motivasi dimatikan.', 'info');
      renderMotivasi(container);
    });

    container.querySelectorAll('[data-mvrole]').forEach(b => b.addEventListener('click', () => {
      motivRole = b.dataset.mvrole;
      renderMotivasi(container);
    }));

    paintMotivList(container);
  }

  function paintMotivList(container) {
    const box = document.getElementById('mvBox');
    const role = motivRole;
    const meta = MOTIV_ROLES.find(r => r.key === role);
    const list = DB.getMotivations(role);
    const activeCount = list.filter(m => m.active !== false).length;

    box.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('📝', `Kutipan untuk ${meta.label.replace(/^\S+\s/, '')}`, `${list.length} kalimat • ${activeCount} aktif • ${meta.hint}`)}
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="mvBulk">⚡ Tambah Banyak</button>
            <button class="btn btn-sm btn-primary" id="mvAdd">+ Tambah Kutipan</button>
          </div>
        </div>
        ${list.length === 0 ? emptyState('Belum ada kutipan untuk peran ini.') : `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Kalimat</th><th>Penulis</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead>
          <tbody>${list.map(m => `<tr>
            <td><strong>${UI.esc(m.text)}</strong></td>
            <td class="muted small">${UI.esc(m.author || '-')}</td>
            <td>${m.active === false ? '<span class="badge badge-gray">Nonaktif</span>' : '<span class="badge badge-success">Aktif</span>'}</td>
            <td class="muted small">${m.createdAt ? UI.fmtDate(m.createdAt) : '-'}</td>
            <td class="actions">
              <button class="btn btn-sm btn-secondary" data-mv-toggle="${m.id}">${m.active === false ? 'Aktifkan' : 'Matikan'}</button>
              <button class="btn btn-sm btn-secondary" data-mv-edit="${m.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-mv-del="${m.id}">Hapus</button>
            </td>
          </tr>`).join('')}</tbody>
        </table></div>`}
      </div>
    `;

    document.getElementById('mvAdd').addEventListener('click', () => openMotivForm(container, role, null));
    document.getElementById('mvBulk').addEventListener('click', () => openMotivBulk(container, role));
    box.querySelectorAll('[data-mv-edit]').forEach(b => b.addEventListener('click', () =>
      openMotivForm(container, role, b.dataset.mvEdit)));
    box.querySelectorAll('[data-mv-toggle]').forEach(b => b.addEventListener('click', () => {
      const m = DB.getMotivations().find(x => x.id === b.dataset.mvToggle);
      if (!m) return;
      DB.updateMotivation(m.id, { active: m.active === false });
      UI.toast(m.active === false ? 'Kutipan diaktifkan.' : 'Kutipan dimatikan.');
      renderMotivasi(container);
    }));
    box.querySelectorAll('[data-mv-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus kutipan ini?')) return;
      DB.deleteMotivation(b.dataset.mvDel);
      UI.toast('Kutipan dihapus.');
      renderMotivasi(container);
    }));

    if (global.Responsive) Responsive.apply(box);
  }

  function openMotivForm(container, role, editId) {
    const editing = editId ? DB.getMotivations().find(m => m.id === editId) : null;
    const body = `
      <form id="mvForm" class="form">
        <div class="form-group"><label>Untuk Peran</label>
          <select name="role">
            ${MOTIV_ROLES.map(r => `<option value="${r.key}" ${(editing ? editing.role : role) === r.key ? 'selected' : ''}>${UI.esc(r.label.replace(/^\S+\s/, ''))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Kalimat Motivasi</label>
          <textarea name="text" rows="3" required maxlength="240"
            placeholder="mis. Satu soal hari ini adalah satu langkah menuju kampus impian.">${UI.esc(editing ? editing.text : '')}</textarea>
          <div class="muted small">Maksimal 240 karakter agar tetap rapi di layar ponsel.</div>
        </div>
        <div class="form-group"><label>Penulis / Sumber</label>
          <input name="author" value="${UI.esc(editing ? (editing.author || '') : 'Tim Rubela')}" placeholder="Tim Rubela" />
        </div>
        <div class="form-group">
          <label class="switch">
            <input type="checkbox" name="active" ${editing && editing.active === false ? '' : 'checked'} />
            <span>Aktif (ikut ditampilkan bergilir)</span>
          </label>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="mvCancel">Batal</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Simpan Perubahan' : 'Tambah Kutipan'}</button>
        </div>
      </form>
    `;
    UI.modal.open(editing ? 'Edit Kata Motivasi' : 'Tambah Kata Motivasi', body);
    document.getElementById('mvCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('mvForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const payload = {
        role: f.get('role'),
        text: String(f.get('text') || '').trim(),
        author: String(f.get('author') || '').trim() || 'Tim Rubela',
        active: f.get('active') === 'on'
      };
      if (!payload.text) { UI.toast('Kalimat tidak boleh kosong.', 'error'); return; }
      if (editing) DB.updateMotivation(editing.id, payload);
      else DB.addMotivation(payload);
      UI.modal.close();
      UI.toast(editing ? 'Kutipan diperbarui.' : 'Kutipan ditambahkan.');
      motivRole = payload.role;
      renderMotivasi(container);
    });
  }

  function openMotivBulk(container, role) {
    const body = `
      <form id="mvBulkForm" class="form">
        <div class="form-group"><label>Untuk Peran</label>
          <select name="role">
            ${MOTIV_ROLES.map(r => `<option value="${r.key}" ${role === r.key ? 'selected' : ''}>${UI.esc(r.label.replace(/^\S+\s/, ''))}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Daftar Kalimat — satu kalimat per baris</label>
          <textarea name="lines" rows="9" required placeholder="Kalimat pertama&#10;Kalimat kedua&#10;Kalimat ketiga"></textarea>
          <div class="muted small">Baris kosong diabaikan. Kalimat yang sudah ada tidak akan diduplikasi.</div>
        </div>
        <div class="form-group"><label>Penulis / Sumber</label>
          <input name="author" value="Tim Rubela" />
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="mvBulkCancel">Batal</button>
          <button type="submit" class="btn btn-primary">Tambahkan Semua</button>
        </div>
      </form>
    `;
    UI.modal.open('Tambah Banyak Kutipan', body);
    document.getElementById('mvBulkCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('mvBulkForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const targetRole = f.get('role');
      const author = String(f.get('author') || '').trim() || 'Tim Rubela';
      const existing = new Set(DB.getMotivations(targetRole).map(m => m.text.trim().toLowerCase()));
      let added = 0, skipped = 0;
      String(f.get('lines') || '').split('\n').forEach(line => {
        const text = line.trim();
        if (!text) return;
        if (existing.has(text.toLowerCase())) { skipped++; return; }
        existing.add(text.toLowerCase());
        DB.addMotivation({ role: targetRole, text: text.slice(0, 240), author, active: true });
        added++;
      });
      UI.modal.close();
      UI.toast(added ? `${added} kutipan ditambahkan${skipped ? `, ${skipped} duplikat dilewati` : ''}.`
        : 'Tidak ada kutipan baru untuk ditambahkan.', added ? 'success' : 'info');
      motivRole = targetRole;
      renderMotivasi(container);
    });
  }

  /* ========== KEAMANAN LOGIN (bank soal verifikasi) ==========
   * Setelah username & password benar, pengguna pada peran terpilih harus
   * menjawab satu soal UTBK mudah. Admin dapat menambah soal, mematikan
   * fitur, memilih peran, dan mengatur jumlah kesempatan.
   */
  let sqFilterSubtest = '';
  let sqSearch = '';

  function renderKeamananLogin(container) {
    const settings = DB.getSettings();
    const enabled = settings.loginQuizEnabled !== false;
    const roles = Array.isArray(settings.loginQuizRoles) ? settings.loginQuizRoles : ['siswa'];
    const attempts = Number(settings.loginQuizAttempts) || 3;
    const all = DB.getSecurityQuestions();
    const active = all.filter(q => q.active !== false);
    const bySubtest = {};
    all.forEach(q => {
      const k = q.subtest || 'Lainnya';
      if (!bySubtest[k]) bySubtest[k] = { total: 0, active: 0 };
      bySubtest[k].total++;
      if (q.active !== false) bySubtest[k].active++;
    });
    const roleOpts = [
      { key: 'siswa', label: 'Siswa' },
      { key: 'guru', label: 'Tutor' },
      { key: 'orangtua', label: 'Orang Tua' },
      { key: 'admin', label: 'Admin' }
    ];

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-primary"><div class="label">Total Soal</div><div class="value">${all.length}</div><div class="sub">${active.length} aktif</div></div>
        <div class="stat-card accent-${enabled ? 'success' : 'danger'}"><div class="label">Status Fitur</div><div class="value" style="font-size:20px;">${enabled ? 'Aktif' : 'Mati'}</div><div class="sub">${enabled ? roles.length + ' peran diverifikasi' : 'tidak ada verifikasi'}</div></div>
        <div class="stat-card accent-info"><div class="label">Kesempatan</div><div class="value">${attempts}</div><div class="sub">sebelum jeda 1 menit</div></div>
        <div class="stat-card accent-warning"><div class="label">Cakupan Subtest</div><div class="value">${Object.keys(bySubtest).length}</div><div class="sub">dari 7 subtest UTBK</div></div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('🔐', 'Verifikasi Keamanan Login', 'Satu soal UTBK mudah sebelum sesi dibuat')}
          <label class="switch">
            <input type="checkbox" id="sqEnabled" ${enabled ? 'checked' : ''} />
            <span>Aktifkan verifikasi</span>
          </label>
        </div>
        <p class="muted small">
          Ketika aktif, pengguna pada peran terpilih harus menjawab satu soal acak dari bank di bawah
          setelah kata sandinya benar. Jawaban salah berulang membuat proses masuk dijeda satu menit.
          Mematikan sakelar di atas melewati verifikasi untuk semua peran.
        </p>

        <div class="form-row">
          <div class="form-group">
            <label>Peran yang Wajib Diverifikasi</label>
            <div class="tgt-grid">
              ${roleOpts.map(r => `
                <label class="pick-item ${roles.includes(r.key) ? 'is-on' : ''}">
                  <input type="checkbox" name="sqRole" value="${r.key}" ${roles.includes(r.key) ? 'checked' : ''} />
                  <span>${UI.esc(r.label)}</span>
                </label>`).join('')}
            </div>
          </div>
          <div class="form-group">
            <label for="sqAttempts">Jumlah Kesempatan Menjawab</label>
            <input type="number" id="sqAttempts" min="1" max="10" value="${attempts}" />
            <div class="muted small">Setiap jawaban salah menampilkan soal baru. Bila habis, masuk dijeda 1 menit.</div>
          </div>
        </div>
        <div class="flex-gap">
          <button class="btn btn-primary btn-sm" id="sqSaveCfg">Simpan Pengaturan</button>
          <button class="btn btn-secondary btn-sm" id="sqTry">▶ Uji Coba Gerbang</button>
        </div>
        ${active.length === 0 ? '<div class="alert alert-error mt-2" style="margin-bottom:0;">Bank soal kosong atau semua soal nonaktif — verifikasi otomatis dilewati agar pengguna tidak terkunci.</div>' : ''}
      </div>

      <div class="card">
        <div class="card-header">${UI.secHead('🧩', 'Sebaran per Subtest', 'pastikan setiap subtest punya cukup soal')}</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Subtest</th><th>Total</th><th>Aktif</th><th>Porsi</th></tr></thead>
          <tbody>${Object.entries(bySubtest).sort((a, b) => b[1].total - a[1].total).map(([k, v]) => `<tr>
            <td><strong>${UI.esc(k)}</strong></td>
            <td>${v.total}</td>
            <td>${v.active}</td>
            <td>${UI.progressHtml(all.length ? Math.round(v.total / all.length * 100) : 0, '', 'auto')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('📚', `Bank Soal Verifikasi (${all.length})`, 'soal singkat agar proses masuk tetap cepat')}
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="sqBulk">⚡ Tambah Banyak</button>
            <button class="btn btn-sm btn-primary" id="sqAdd">+ Tambah Soal</button>
          </div>
        </div>
        <div class="rk-filters">
          <input type="search" id="sqSearch" class="input" placeholder="Cari teks soal…" value="${UI.esc(sqSearch)}" />
          <select id="sqSubtest" class="input">
            <option value="">Semua subtest</option>
            ${Object.keys(bySubtest).map(k => `<option value="${UI.esc(k)}" ${sqFilterSubtest === k ? 'selected' : ''}>${UI.esc(k)}</option>`).join('')}
          </select>
        </div>
        <div id="sqList"></div>
      </div>
    `;

    document.getElementById('sqEnabled').addEventListener('change', (e) => {
      DB.setSetting('loginQuizEnabled', e.target.checked);
      UI.toast(e.target.checked ? 'Verifikasi login diaktifkan.' : 'Verifikasi login dimatikan.', 'info');
      renderKeamananLogin(container);
    });

    container.querySelectorAll('[name="sqRole"]').forEach(cb => cb.addEventListener('change', () => {
      cb.closest('.pick-item').classList.toggle('is-on', cb.checked);
    }));

    document.getElementById('sqSaveCfg').addEventListener('click', () => {
      const picked = [...container.querySelectorAll('[name="sqRole"]:checked')].map(c => c.value);
      const n = Math.max(1, Math.min(10, Number(document.getElementById('sqAttempts').value) || 3));
      DB.setSetting('loginQuizRoles', picked);
      DB.setSetting('loginQuizAttempts', n);
      UI.toast(picked.length ? `Pengaturan disimpan untuk ${picked.length} peran.` : 'Disimpan — tidak ada peran yang diverifikasi.', 'success');
      renderKeamananLogin(container);
    });

    document.getElementById('sqTry').addEventListener('click', () => {
      if (!window.LoginQuiz) { UI.toast('Modul verifikasi tidak tersedia di halaman ini.', 'error'); return; }
      if (!DB.getActiveSecurityQuestions().length) { UI.toast('Bank soal masih kosong.', 'error'); return; }
      const me = (global.Dashboard && Dashboard.currentUser) || { name: 'Admin', username: '__preview__', role: 'admin' };
      LoginQuiz.open({ name: me.name, username: '__preview__', role: me.role },
        () => UI.toast('Jawaban benar — pengguna akan diteruskan ke dashboard.', 'success'),
        (msg) => UI.toast('Uji coba selesai: ' + msg, 'info'));
    });

    const reFilter = () => {
      sqSearch = document.getElementById('sqSearch').value;
      sqFilterSubtest = document.getElementById('sqSubtest').value;
      paintSqList(container);
    };
    document.getElementById('sqSearch').addEventListener('input', reFilter);
    document.getElementById('sqSubtest').addEventListener('change', reFilter);
    document.getElementById('sqAdd').addEventListener('click', () => openSecQForm(container, null));
    document.getElementById('sqBulk').addEventListener('click', () => openSecQBulk(container));

    paintSqList(container);
  }

  function paintSqList(container) {
    const box = document.getElementById('sqList');
    const q = sqSearch.trim().toLowerCase();
    const rows = DB.getSecurityQuestions().filter(x => {
      if (sqFilterSubtest && (x.subtest || 'Lainnya') !== sqFilterSubtest) return false;
      if (!q) return true;
      return String(x.text || '').toLowerCase().includes(q) ||
        (x.options || []).some(o => String(o).toLowerCase().includes(q));
    });

    box.innerHTML = rows.length === 0 ? emptyState('Tidak ada soal yang cocok.') : `
      <p class="muted small">Menampilkan ${rows.length} soal.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Soal</th><th>Subtest</th><th>Pilihan</th><th>Kunci</th><th>Sumber</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(x => `<tr>
          <td><strong>${UI.esc(x.text)}</strong></td>
          <td>${UI.esc(x.subtest || '-')}</td>
          <td class="muted small">${(x.options || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${UI.esc(o)}`).join('<br>')}</td>
          <td><span class="badge badge-success">${String.fromCharCode(65 + Number(x.correctIndex || 0))}</span></td>
          <td class="muted small">${x.source === 'admin' ? 'Admin' : 'Bawaan'}</td>
          <td>${x.active === false ? '<span class="badge badge-gray">Nonaktif</span>' : '<span class="badge badge-success">Aktif</span>'}</td>
          <td class="actions">
            <button class="btn btn-sm btn-secondary" data-sq-toggle="${x.id}">${x.active === false ? 'Aktifkan' : 'Matikan'}</button>
            <button class="btn btn-sm btn-secondary" data-sq-edit="${x.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-sq-del="${x.id}">Hapus</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`;

    box.querySelectorAll('[data-sq-edit]').forEach(b => b.addEventListener('click', () =>
      openSecQForm(container, b.dataset.sqEdit)));
    box.querySelectorAll('[data-sq-toggle]').forEach(b => b.addEventListener('click', () => {
      const x = DB.getSecurityQuestions().find(y => y.id === b.dataset.sqToggle);
      if (!x) return;
      DB.updateSecurityQuestion(x.id, { active: x.active === false });
      UI.toast(x.active === false ? 'Soal diaktifkan.' : 'Soal dimatikan.');
      renderKeamananLogin(container);
    }));
    box.querySelectorAll('[data-sq-del]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus soal verifikasi ini?')) return;
      DB.deleteSecurityQuestion(b.dataset.sqDel);
      UI.toast('Soal dihapus.');
      renderKeamananLogin(container);
    }));

    if (global.Responsive) Responsive.apply(box);
  }

  function openSecQForm(container, editId) {
    const editing = editId ? DB.getSecurityQuestions().find(x => x.id === editId) : null;
    const opts = editing ? (editing.options || []).slice() : ['', '', '', ''];
    while (opts.length < 4) opts.push('');
    const key = editing ? Number(editing.correctIndex || 0) : 0;
    const subtests = DB.SUBTESTS.map(s => s.name);

    const body = `
      <form id="sqForm" class="form">
        <div class="form-row">
          <div class="form-group"><label>Subtest</label>
            <select name="subtest">
              ${subtests.map(s => `<option value="${UI.esc(s)}" ${editing && editing.subtest === s ? 'selected' : ''}>${UI.esc(s)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Tingkat Kesulitan</label>
            <select name="difficulty">
              ${['mudah', 'sedang'].map(d => `<option value="${d}" ${editing && editing.difficulty === d ? 'selected' : ''}>${d === 'mudah' ? 'Mudah' : 'Sedang'}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group"><label>Pertanyaan</label>
          <textarea name="text" rows="2" required maxlength="300"
            placeholder="mis. Hasil dari 15% × 200 adalah …">${UI.esc(editing ? editing.text : '')}</textarea>
          <div class="muted small">Gunakan soal singkat agar proses masuk tidak melambat. Dukungan LaTeX: tulis di antara tanda $ … $.</div>
        </div>
        <div class="form-group"><label>Pilihan Jawaban — klik bulatan untuk menandai kunci</label>
          <div class="qe-list">
            ${opts.map((o, i) => `
              <div class="qe-row">
                <label class="qe-key" title="Tandai sebagai jawaban benar">
                  <input type="radio" name="correctIndex" value="${i}" ${key === i ? 'checked' : ''} />
                  <span>${String.fromCharCode(65 + i)}</span>
                </label>
                <input name="opt${i}" value="${UI.esc(o)}" placeholder="Pilihan ${String.fromCharCode(65 + i)}" ${i < 2 ? 'required' : ''} />
              </div>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="switch">
            <input type="checkbox" name="active" ${editing && editing.active === false ? '' : 'checked'} />
            <span>Aktif (ikut diundi saat login)</span>
          </label>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="sqCancel">Batal</button>
          <button type="submit" class="btn btn-primary">${editing ? 'Simpan Perubahan' : 'Tambah Soal'}</button>
        </div>
      </form>
    `;
    UI.modal.open(editing ? 'Edit Soal Verifikasi' : 'Tambah Soal Verifikasi', body);
    document.getElementById('sqCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('sqForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const options = [0, 1, 2, 3].map(i => String(f.get('opt' + i) || '').trim()).filter(Boolean);
      const correctIndex = Number(f.get('correctIndex'));
      if (options.length < 2) { UI.toast('Minimal dua pilihan jawaban harus diisi.', 'error'); return; }
      if (correctIndex >= options.length) { UI.toast('Kunci jawaban menunjuk pilihan yang kosong.', 'error'); return; }
      const payload = {
        subtest: f.get('subtest'),
        difficulty: f.get('difficulty'),
        text: String(f.get('text') || '').trim(),
        options, correctIndex,
        active: f.get('active') === 'on',
        source: 'admin'
      };
      if (!payload.text) { UI.toast('Pertanyaan tidak boleh kosong.', 'error'); return; }
      if (editing) DB.updateSecurityQuestion(editing.id, payload);
      else DB.addSecurityQuestion(payload);
      UI.modal.close();
      UI.toast(editing ? 'Soal diperbarui.' : 'Soal ditambahkan.');
      renderKeamananLogin(container);
    });
  }

  function openSecQBulk(container) {
    const subtests = DB.SUBTESTS.map(s => s.name);
    const body = `
      <form id="sqBulkForm" class="form">
        <div class="form-group"><label>Subtest</label>
          <select name="subtest">${subtests.map(s => `<option value="${UI.esc(s)}">${UI.esc(s)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Daftar Soal — satu soal per baris</label>
          <textarea name="lines" rows="9" required placeholder="Pertanyaan | pilihan A | pilihan B | pilihan C | pilihan D | nomor kunci (1-4)&#10;Hasil 15% dari 200 | 20 | 30 | 35 | 40 | 2"></textarea>
          <div class="muted small">
            Format tiap baris: <code>pertanyaan | A | B | C | D | nomor kunci</code>.
            Pemisahnya tanda <code>|</code>. Nomor kunci 1 berarti pilihan A. Minimal dua pilihan.
          </div>
        </div>
        <div class="flex-gap" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="sqBulkCancel">Batal</button>
          <button type="submit" class="btn btn-primary">Tambahkan Semua</button>
        </div>
      </form>
    `;
    UI.modal.open('Tambah Banyak Soal Verifikasi', body);
    document.getElementById('sqBulkCancel').addEventListener('click', () => UI.modal.close());
    document.getElementById('sqBulkForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const subtest = f.get('subtest');
      let added = 0;
      const errors = [];
      String(f.get('lines') || '').split('\n').forEach((line, idx) => {
        const raw = line.trim();
        if (!raw) return;
        const parts = raw.split('|').map(p => p.trim());
        const text = parts.shift();
        const keyRaw = parts.pop();
        const keyNum = Number(keyRaw);
        const options = parts.filter(Boolean);
        if (!text || options.length < 2 || !keyNum || keyNum < 1 || keyNum > options.length) {
          errors.push(`Baris ${idx + 1}`);
          return;
        }
        DB.addSecurityQuestion({
          subtest, difficulty: 'mudah', text: text.slice(0, 300),
          options, correctIndex: keyNum - 1, active: true, source: 'admin'
        });
        added++;
      });
      UI.modal.close();
      if (added) {
        UI.toast(`${added} soal ditambahkan${errors.length ? `, ${errors.length} baris dilewati (${errors.slice(0, 3).join(', ')})` : ''}.`, 'success');
      } else {
        UI.toast(errors.length ? `Format tidak dikenali pada ${errors.length} baris. Periksa contoh format.` : 'Tidak ada soal untuk ditambahkan.', 'error');
      }
      renderKeamananLogin(container);
    });
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
        <div class="card-header">
          ${UI.secHead('🎨', 'Identitas & Logo Rubela', 'tampil di halaman masuk dan sidebar semua panel')}
        </div>
        <div class="brand-setting">
          <div class="bs-preview">
            <div class="bs-logo" id="brandPreview">${(() => {
              const st = DB.getSettings();
              return st.appLogo
                ? `<img src="${UI.esc(st.appLogo)}" alt="Logo" />`
                : UI.esc((st.appName || 'R').trim().charAt(0).toUpperCase());
            })()}</div>
            <div>
              <strong id="brandNamePrev">${UI.esc(DB.getSettings().appName || 'LMS Rubela')}</strong>
              <div class="muted small" id="brandTagPrev">${UI.esc(DB.getSettings().appTagline || '')}</div>
            </div>
          </div>
          <div class="bs-fields">
            <div class="form-row">
              <div class="form-group"><label for="appName">Nama Aplikasi</label>
                <input id="appName" value="${UI.esc(DB.getSettings().appName || 'LMS Rubela')}" /></div>
              <div class="form-group"><label for="appTagline">Tagline</label>
                <input id="appTagline" value="${UI.esc(DB.getSettings().appTagline || '')}" /></div>
            </div>
            <div class="form-group">
              <label for="appLogoFile">Unggah Logo (PNG/JPG/SVG)</label>
              <input type="file" id="appLogoFile" accept="image/*" />
              <div class="muted small">Gambar otomatis diperkecil agar hemat penyimpanan. Disarankan bentuk persegi.</div>
            </div>
            <div class="flex-gap">
              <button class="btn btn-primary btn-sm" id="saveBrandBtn">Simpan Identitas</button>
              <button class="btn btn-secondary btn-sm" id="removeLogoBtn" ${DB.getSettings().appLogo ? '' : 'disabled'}>Hapus Logo</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          ${UI.secHead('🤖', 'Integrasi AI', 'Gemini untuk asisten belajar & analisis, Agent API untuk menarik data dari halaman web')}
        </div>
        ${(() => {
          const st = DB.getSettings();
          const geminiOn = !!(st.aiEnabled !== false && (st.geminiApiKey || '').trim());
          const agentOn = !!(st.aiEnabled !== false && (st.tinyfishApiKey || '').trim() && (st.tinyfishEndpoint || '').trim());
          return `
          <div class="flex-gap" style="margin-bottom:10px;">
            <span class="ai-status ${geminiOn ? 'is-on' : 'is-off'}">${geminiOn ? '● Gemini aktif' : '○ Gemini belum aktif'}</span>
            <span class="ai-status ${agentOn ? 'is-on' : 'is-off'}">${agentOn ? '● Agent API aktif' : '○ Agent API belum aktif'}</span>
          </div>
          <div class="alert alert-warning">
            <strong>Keamanan kunci API.</strong> Situs ini berjalan tanpa server, sehingga kunci yang
            dimasukkan di sini <strong>hanya</strong> disimpan pada browser ini (localStorage) dan tidak
            pernah ikut tersimpan ke dalam kode atau repositori. Jangan membagikan kunci Anda, dan segera
            ganti kunci di Google AI Studio bila pernah terkirim ke orang lain.
          </div>
          <div class="form">
            <div class="form-group">
              <label class="sec-opt ${st.aiEnabled !== false ? 'is-on' : ''}">
                <input type="checkbox" id="aiEnabled" ${st.aiEnabled !== false ? 'checked' : ''} />
                <div>
                  <div class="so-nm">🤖 Aktifkan seluruh fitur AI</div>
                  <div class="so-ds">Bila dimatikan, halaman AI tetap menampilkan analisis dari data asli LMS — hanya ulasan naratif AI yang dinonaktifkan.</div>
                </div>
              </label>
            </div>

            <h4 style="margin:6px 0 0;">Google Gemini</h4>
            <div class="form-group">
              <label for="geminiApiKey">Kunci API Gemini</label>
              <div class="flex-gap">
                <input type="password" id="geminiApiKey" autocomplete="off" spellcheck="false"
                       placeholder="Tempel kunci API di sini" value="${UI.esc(st.geminiApiKey || '')}" style="flex:1;" />
                <button type="button" class="btn btn-secondary btn-sm" id="toggleKeyBtn">Lihat</button>
              </div>
              <div class="muted small">Dapatkan kunci gratis di Google AI Studio (aistudio.google.com/apikey).</div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="geminiModel">Model</label>
                <input id="geminiModel" value="${UI.esc(st.geminiModel || 'gemini-flash-latest')}" placeholder="gemini-flash-latest" />
              </div>
              <div class="form-group">
                <label for="aiTimeoutMs">Batas waktu (ms)</label>
                <input id="aiTimeoutMs" type="number" min="5000" step="1000" value="${Number(st.aiTimeoutMs) || 30000}" />
              </div>
            </div>

            <h4 style="margin:6px 0 0;">Agent API (TinyFish)</h4>
            <p class="muted small" style="margin:0;">
              Dipakai pada menu <strong>Agent Web</strong> untuk mengambil data terstruktur dari sebuah URL
              berdasarkan tujuan yang Anda tulis.
            </p>
            <div class="form-row">
              <div class="form-group">
                <label for="tinyfishEndpoint">Endpoint Agent API</label>
                <input id="tinyfishEndpoint" autocomplete="off" spellcheck="false"
                       placeholder="https://…" value="${UI.esc(st.tinyfishEndpoint || '')}" />
              </div>
              <div class="form-group">
                <label for="tinyfishApiKey">Kunci Agent API</label>
                <input type="password" id="tinyfishApiKey" autocomplete="off" spellcheck="false"
                       placeholder="Tempel kunci di sini" value="${UI.esc(st.tinyfishApiKey || '')}" />
              </div>
            </div>

            <div class="flex-gap">
              <button class="btn btn-primary btn-sm" id="saveAiBtn">Simpan Integrasi</button>
              <button class="btn btn-secondary btn-sm" id="testAiBtn">Uji Koneksi Gemini</button>
            </div>
            <div id="aiTestBox" style="margin-top:10px;"></div>
          </div>`;
        })()}
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

    /* ---- Identitas & logo ---- */
    let pendingLogo = null;
    const brandPrev = document.getElementById('brandPreview');
    document.getElementById('appName').addEventListener('input', (e) => {
      document.getElementById('brandNamePrev').textContent = e.target.value || 'LMS Rubela';
      if (!DB.getSettings().appLogo && !pendingLogo) {
        brandPrev.textContent = (e.target.value || 'R').trim().charAt(0).toUpperCase();
      }
    });
    document.getElementById('appTagline').addEventListener('input', (e) => {
      document.getElementById('brandTagPrev').textContent = e.target.value;
    });
    document.getElementById('appLogoFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      brandPrev.innerHTML = '<span class="spinner"></span>';
      try {
        // SVG tidak perlu (dan tidak bisa) dikompres lewat canvas
        pendingLogo = /svg/i.test(f.type)
          ? await Editor.readAsDataUrl(f)
          : await Editor.compressImage(f);
        brandPrev.innerHTML = `<img src="${UI.esc(pendingLogo)}" alt="Logo" />`;
        UI.toast('Logo siap disimpan. Tekan "Simpan Identitas".', 'info');
      } catch (err) {
        brandPrev.textContent = 'R';
        UI.toast(err.message || 'Gagal membaca gambar.', 'error');
      }
    });
    document.getElementById('saveBrandBtn').addEventListener('click', () => {
      const name = document.getElementById('appName').value.trim() || 'LMS Rubela';
      DB.setSetting('appName', name);
      DB.setSetting('appTagline', document.getElementById('appTagline').value.trim());
      if (pendingLogo) DB.setSetting('appLogo', pendingLogo);
      UI.toast('Identitas aplikasi disimpan.', 'success');
      if (global.Branding) Branding.apply();
      renderSettings(container);
    });
    document.getElementById('removeLogoBtn').addEventListener('click', () => {
      DB.setSetting('appLogo', '');
      pendingLogo = null;
      UI.toast('Logo dihapus, kembali memakai inisial nama.', 'info');
      if (global.Branding) Branding.apply();
      renderSettings(container);
    });

    /* ---- Integrasi AI ---- */
    document.getElementById('toggleKeyBtn').addEventListener('click', () => {
      const inp = document.getElementById('geminiApiKey');
      const btn = document.getElementById('toggleKeyBtn');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Sembunyikan' : 'Lihat';
    });
    document.getElementById('saveAiBtn').addEventListener('click', () => {
      const timeout = Number(document.getElementById('aiTimeoutMs').value);
      DB.setSetting('aiEnabled', document.getElementById('aiEnabled').checked);
      DB.setSetting('geminiApiKey', document.getElementById('geminiApiKey').value.trim());
      DB.setSetting('geminiModel', document.getElementById('geminiModel').value.trim() || 'gemini-flash-latest');
      DB.setSetting('aiTimeoutMs', timeout >= 5000 ? timeout : 30000);
      DB.setSetting('tinyfishEndpoint', document.getElementById('tinyfishEndpoint').value.trim());
      DB.setSetting('tinyfishApiKey', document.getElementById('tinyfishApiKey').value.trim());
      UI.toast('Pengaturan integrasi AI disimpan.', 'success');
      renderSettings(container);
    });
    document.getElementById('testAiBtn').addEventListener('click', async () => {
      const box = document.getElementById('aiTestBox');
      const key = document.getElementById('geminiApiKey').value.trim();
      if (!key) {
        box.innerHTML = '<div class="alert alert-warning">Isi kunci API terlebih dahulu, lalu tekan Simpan Integrasi.</div>';
        return;
      }
      // Pakai nilai yang sedang tampil supaya admin bisa menguji sebelum menyimpan.
      DB.setSetting('geminiApiKey', key);
      DB.setSetting('geminiModel', document.getElementById('geminiModel').value.trim() || 'gemini-flash-latest');
      DB.setSetting('aiEnabled', document.getElementById('aiEnabled').checked);
      box.innerHTML = AI.loadingHtml('Menghubungi Gemini…');
      try {
        const out = await AI.ask('Jawab dengan satu kalimat pendek dalam Bahasa Indonesia: sebutkan dirimu siap membantu LMS Rubela.',
          { temperature: 0.2, maxTokens: 120 });
        box.innerHTML = `<div class="alert alert-success"><strong>Koneksi berhasil.</strong>
          <div class="ai-answer" style="margin-top:6px;">${AI.renderMarkdown(out)}</div></div>`;
      } catch (e) {
        box.innerHTML = AI.errorHtml(e) +
          '<div class="muted small">Bila pesan di atas menyebut masalah jaringan, pastikan perangkat ini terhubung ke internet dan tidak diblokir firewall.</div>';
      }
    });

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

  /* ========== AGENT WEB (Agent API / TinyFish) ==========
   * Kirim sebuah URL + tujuan, lalu terima data terstruktur. Berguna untuk
   * menarik informasi dari halaman pengumuman kampus, jadwal SNBT, daftar
   * beasiswa, dan sejenisnya tanpa menyalin manual.
   */
  function renderAgentWeb(container, user) {
    const PRESETS = [
      { label: 'Jadwal & tahapan SNBT', goal: 'Ambil seluruh tahapan beserta tanggalnya. Balas array JSON dengan kunci: tahap, tanggal_mulai, tanggal_selesai.' },
      { label: 'Daftar program studi', goal: 'Ambil daftar program studi beserta daya tampung dan peminat tahun lalu. Balas array JSON dengan kunci: prodi, daya_tampung, peminat.' },
      { label: 'Daftar beasiswa', goal: 'Ambil daftar beasiswa beserta penyelenggara dan batas pendaftaran. Balas array JSON dengan kunci: beasiswa, penyelenggara, batas_pendaftaran.' },
      { label: 'Pengumuman terbaru', goal: 'Ambil 15 pengumuman terbaru. Balas array JSON dengan kunci: judul, tanggal, url.' }
    ];

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          ${UI.secHead('🌐', 'Agent Web', 'Ambil data terstruktur dari sebuah halaman web lewat Agent API')}
        </div>
        ${!AI.agentReady() ? `
          <div class="alert alert-warning">
            <strong>Agent API belum dikonfigurasi.</strong>
            Isi <strong>Endpoint</strong> dan <strong>Kunci Agent API</strong> pada
            <strong>Pengaturan → Integrasi AI</strong> terlebih dahulu.
            <div class="muted small" style="margin-top:6px;">
              Formulir di bawah tetap bisa Anda siapkan, tetapi tombol "Jalankan Agent" baru aktif
              setelah endpoint dan kunci tersimpan.
            </div>
          </div>` : ''}
        <div class="form">
          <div class="form-group">
            <label for="agUrl">URL halaman sumber</label>
            <input id="agUrl" placeholder="https://contoh.ac.id/pengumuman" spellcheck="false" />
          </div>
          <div class="form-group">
            <label for="agPreset">Contoh tujuan siap pakai</label>
            <select id="agPreset" class="input">
              <option value="">— pilih untuk mengisi otomatis —</option>
              ${PRESETS.map((p, i) => `<option value="${i}">${UI.esc(p.label)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="agGoal">Tujuan pengambilan data</label>
            <textarea id="agGoal" rows="4" placeholder="Jelaskan data apa yang ingin diambil dan dalam bentuk apa. Contoh: Ambil 15 pengumuman terbaru. Balas array JSON dengan kunci: judul, tanggal, url."></textarea>
            <div class="muted small">Sebutkan nama kunci JSON yang Anda inginkan agar hasilnya rapi dan konsisten.</div>
          </div>
          <div class="flex-gap">
            <button class="btn btn-primary btn-sm" id="agRun" ${AI.agentReady() ? '' : 'disabled'}>🌐 Jalankan Agent</button>
            <button class="btn btn-secondary btn-sm" id="agCsv" disabled>⬇️ Unduh CSV</button>
          </div>
        </div>
        <div id="agOut" class="ai-agent-result"></div>
      </div>`;

    let lastRows = [];

    document.getElementById('agPreset').addEventListener('change', (e) => {
      const p = PRESETS[Number(e.target.value)];
      if (p) document.getElementById('agGoal').value = p.goal;
    });

    document.getElementById('agRun').addEventListener('click', async () => {
      const url = document.getElementById('agUrl').value.trim();
      const goal = document.getElementById('agGoal').value.trim();
      const out = document.getElementById('agOut');
      const runBtn = document.getElementById('agRun');
      const csvBtn = document.getElementById('agCsv');

      if (!url) { UI.toast('Isi URL sumber terlebih dahulu.', 'error'); return; }
      if (!goal) { UI.toast('Jelaskan tujuan pengambilan datanya.', 'error'); return; }

      runBtn.disabled = true;
      csvBtn.disabled = true;
      lastRows = [];
      out.innerHTML = AI.loadingHtml('Agent sedang membuka halaman dan mengambil data…');
      try {
        const res = await AI.agentExtract(url, goal);
        lastRows = res.rows || [];
        if (!lastRows.length) {
          out.innerHTML = `<div class="alert alert-warning">Agent berhasil dijalankan tetapi tidak menemukan data yang bisa ditabelkan.
            Coba perjelas tujuan dan sebutkan kunci JSON yang diinginkan.</div>`;
          return;
        }
        const cols = Object.keys(lastRows.reduce((acc, r) => { Object.keys(r).forEach(k => { acc[k] = 1; }); return acc; }, {}));
        out.innerHTML = `
          <div class="alert alert-success">${lastRows.length} baris data diterima.</div>
          <div class="table-wrap" style="max-height:420px;overflow:auto;">
            <table class="table">
              <thead><tr>${cols.map(c => `<th>${UI.esc(c)}</th>`).join('')}</tr></thead>
              <tbody>${lastRows.slice(0, 200).map(r => `<tr>${cols.map(c => {
                const v = r[c];
                const s = (v == null) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
                return `<td class="small">${UI.esc(s.slice(0, 200))}</td>`;
              }).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>`;
        csvBtn.disabled = false;
      } catch (e) {
        out.innerHTML = AI.errorHtml(e);
      } finally {
        runBtn.disabled = false;
      }
    });

    document.getElementById('agCsv').addEventListener('click', () => {
      if (!lastRows.length) return;
      const cols = Object.keys(lastRows.reduce((acc, r) => { Object.keys(r).forEach(k => { acc[k] = 1; }); return acc; }, {}));
      const cell = (v) => {
        const s = (v == null) ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
        return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [cols.join(';')].concat(lastRows.map(r => cols.map(c => cell(r[c])).join(';'))).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'agent-web-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      UI.toast('CSV diunduh.', 'success');
    });
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
  /* Rekap lengkap (tutor, siswa, kelas, subtest) ditangani oleh js/rekap.js */
  function renderRekap(container, user) {
    const me = user || (global.Dashboard && Dashboard.currentUser) || { role: 'admin' };
    if (global.Rekap) return Rekap.render(container, me);
    container.innerHTML = `<div class="empty"><div class="empty-icon">📈</div>Modul rekap tidak tersedia.</div>`;
  }

  /* ========== KEUANGAN ========== */
  /* Penyaring jenis pemasukan pada halaman Keuangan */
  let incomeKindFilter = '';

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

      /* Pemasukan bimbel tidak hanya SPP: denda pelanggaran/keterlambatan dan
       * biaya lain juga masuk hitungan, jadi dirinci per jenis. */
      const byKind = DB.incomeByKind();
      const fineTotal = byKind.denda ? byKind.denda.lunas : 0;
      const fineCount = DB.getFines().length;

      container.innerHTML = `
        <div class="finance-summary">
          <div class="fin-card income"><div class="label">Pemasukan</div><div class="value">${UI.fmtRp(income)}</div></div>
          <div class="fin-card expense"><div class="label">Pengeluaran</div><div class="value">${UI.fmtRp(expense)}</div></div>
          <div class="fin-card profit"><div class="label">Laba Bersih</div><div class="value">${UI.fmtRp(income - expense)}</div></div>
          <div class="fin-card" style="border-left:4px solid var(--warning);"><div class="label">Piutang</div><div class="value" style="color:var(--warning);">${UI.fmtRp(pendingIncome)}</div></div>
        </div>

        <div class="card">
          <div class="card-header">${UI.secHead('📊', 'Rincian Pemasukan per Jenis', 'SPP, pendaftaran, denda siswa, dan pemasukan lain')}</div>
          <div class="kind-grid">
            ${DB.PAYMENT_KINDS.map(k => {
              const v = byKind[k.key] || { lunas: 0, pending: 0, count: 0 };
              return `<div class="kind-card ${k.fine ? 'is-fine' : ''}">
                <div class="kk-ic">${k.icon}</div>
                <div class="kk-body">
                  <div class="kk-nm">${UI.esc(k.label)}</div>
                  <div class="kk-val">${UI.fmtRp(v.lunas)}</div>
                  <div class="kk-sub">${v.count} transaksi${v.pending ? ` • piutang ${UI.fmtRp(v.pending)}` : ''}</div>
                </div>
              </div>`;
            }).join('')}
          </div>
          ${fineCount ? `<p class="muted small mt-1">
            Denda tercatat ${fineCount} kali dengan total ${UI.fmtRp(fineTotal)}. Alasan denda tersimpan
            pada tiap transaksi agar bisa ditelusuri.</p>` : ''}
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
      let payments = DB.getPayments().slice().sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
      if (incomeKindFilter) payments = payments.filter(p => DB.paymentKind(p) === incomeKindFilter);
      box.innerHTML = `
        <div class="card">
          <div class="card-header">
            ${UI.secHead('💵', `Pemasukan (${payments.length})`, 'SPP, pendaftaran, denda siswa, dan pemasukan lain')}
            <div class="flex-gap">
              <select id="payKindFilter" class="input" style="max-width:190px;">
                <option value="">Semua jenis</option>
                ${DB.PAYMENT_KINDS.map(k => `<option value="${k.key}" ${incomeKindFilter === k.key ? 'selected' : ''}>${k.icon} ${UI.esc(k.label)}</option>`).join('')}
              </select>
              <button class="btn btn-primary btn-sm" id="addPayBtn">+ Tambah Pemasukan</button>
            </div>
          </div>
          ${payments.length === 0 ? emptyState('Belum ada pemasukan pada jenis ini.') : `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Tanggal</th><th>Siswa</th><th>Jenis</th><th>Kelas</th><th>Jumlah</th><th>Metode</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead>
            <tbody>${payments.map(p => {
              const s = DB.getUser(p.studentId);
              const c = p.courseId ? DB.getCourse(p.courseId) : null;
              return `<tr>
                <td>${UI.fmtDate(p.paidAt || p.createdAt)}</td>
                <td><strong>${UI.esc(s ? s.name : '-')}</strong></td>
                <td>${(() => { const k = DB.paymentKindMeta(DB.paymentKind(p));
                  return `<span class="badge ${k.fine ? 'badge-warning' : 'badge-info'}">${k.icon} ${UI.esc(k.label)}</span>
                    ${p.fineReason ? `<div class="muted small">${UI.esc(p.fineReason)}</div>` : ''}`; })()}</td>
                <td>${UI.esc(c ? DB.courseTitle(c) : 'Umum')}</td>
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
      const kindSel = document.getElementById('payKindFilter');
      if (kindSel) kindSel.addEventListener('change', () => {
        incomeKindFilter = kindSel.value;
        renderIncome(box);
      });
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
            <div class="form-group"><label for="payKind">Jenis Pemasukan</label>
              <select name="kind" id="payKind">
                ${DB.PAYMENT_KINDS.map(k => `<option value="${k.key}" ${DB.paymentKind(editing || {}) === k.key ? 'selected' : ''}>${k.icon} ${UI.esc(k.label)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Jumlah (Rp)</label>
              <input name="amount" type="number" min="0" required value="${editing?.amount || 0}" /></div>
          </div>

          <div class="form-group ${DB.paymentKind(editing || {}) === 'denda' ? '' : 'hidden'}" id="payFineBox">
            <label for="payFine">Alasan Denda</label>
            <select name="fineReason" id="payFine">
              ${DB.FINE_REASONS.map(r => `<option value="${UI.esc(r)}" ${editing && editing.fineReason === r ? 'selected' : ''}>${UI.esc(r)}</option>`).join('')}
            </select>
            <input name="fineReasonOther" id="payFineOther" class="mt-1 hidden"
                   placeholder="Tulis alasan denda" value="${UI.esc(editing && !DB.FINE_REASONS.includes(editing.fineReason || '') ? (editing.fineReason || '') : '')}" />
            <div class="muted small">Alasan ini tercatat pada transaksi agar denda dapat ditelusuri.</div>
          </div>

          <div class="form-row">
            <div class="form-group"><label>Metode</label>
              <select name="method">
                ${['transfer', 'cash', 'qris', 'lainnya'].map(m => `<option value="${m}" ${editing?.method === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Tanggal</label>
              <input name="paidAt" type="date" required value="${UI.toDateInput(editing?.paidAt || Date.now())}" /></div>
          </div>
          <div class="form-group"><label>Status</label>
            <select name="status">
              ${['lunas', 'pending', 'dibatalkan'].map(s => `<option value="${s}" ${editing?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Catatan</label>
            <input name="note" value="${UI.esc(editing?.note || '')}" /></div>
          <div class="flex-gap" style="justify-content:flex-end;">
            <button type="button" class="btn btn-secondary" id="cancelBtn">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>`;
      UI.modal.open(editing ? 'Edit Pemasukan' : 'Tambah Pemasukan', body);
      document.getElementById('cancelBtn').addEventListener('click', () => UI.modal.close());

      // Alasan denda hanya relevan untuk jenis "denda"
      const kindEl = document.getElementById('payKind');
      const fineBox = document.getElementById('payFineBox');
      const fineSel = document.getElementById('payFine');
      const fineOther = document.getElementById('payFineOther');
      const syncFine = () => {
        const isFine = kindEl.value === 'denda';
        fineBox.classList.toggle('hidden', !isFine);
        fineOther.classList.toggle('hidden', !(isFine && fineSel.value === 'Lainnya'));
      };
      kindEl.addEventListener('change', syncFine);
      fineSel.addEventListener('change', syncFine);
      syncFine();
      document.getElementById('payForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const kind = fd.get('kind') || 'spp';
        const payload = {
          studentId: fd.get('studentId'),
          courseId: fd.get('courseId') || null,
          kind,
          amount: Number(fd.get('amount')),
          method: fd.get('method'),
          status: fd.get('status'),
          note: fd.get('note').trim(),
          paidAt: new Date(fd.get('paidAt')).getTime()
        };
        if (kind === 'denda') {
          const picked = fd.get('fineReason') || '';
          payload.fineReason = picked === 'Lainnya'
            ? (String(fd.get('fineReasonOther') || '').trim() || 'Lainnya')
            : picked;
          if (!payload.fineReason) { UI.toast('Pilih atau tulis alasan denda.', 'error'); return; }
        } else {
          payload.fineReason = null;
        }
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
