/* ===== Dashboard controller - role routing ===== */
(function () {
  const user = Auth.requireAuth(['admin', 'guru', 'siswa']);
  if (!user) return;

  const NAVS = {
    admin: [
      { key: 'overview', label: 'Overview', icon: '📊' },
      { key: 'guru', label: 'Kelola Guru', icon: '👨‍🏫' },
      { key: 'siswa', label: 'Kelola Siswa', icon: '👨‍🎓' },
      { key: 'courses', label: 'Semua Kelas', icon: '📚' },
      { key: 'attendance', label: 'Absensi', icon: '📋' },
      { key: 'rekap', label: 'Rekapan', icon: '📈' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'keuangan', label: 'Keuangan', icon: '💰' },
      { key: 'settings', label: 'Pengaturan', icon: '⚙️' }
    ],
    guru: [
      { key: 'overview', label: 'Overview', icon: '📊' },
      { key: 'courses', label: 'Kelas Saya', icon: '📚' },
      { key: 'modul', label: 'Modul', icon: '📘' },
      { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥' },
      { key: 'bank-soal', label: 'Bank Soal', icon: '📝' },
      { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️' },
      { key: 'grading', label: 'Penilaian Tugas', icon: '✅' },
      { key: 'absensi', label: 'Absensi', icon: '📋' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'keuangan', label: 'Honor Saya', icon: '💰' },
      { key: 'profile', label: 'Profil', icon: '👤' }
    ],
    siswa: [
      { key: 'overview', label: 'Overview', icon: '📊' },
      { key: 'my-courses', label: 'Kelas Saya', icon: '📚' },
      { key: 'browse', label: 'Jelajah Kelas', icon: '🔎' },
      { key: 'modul', label: 'Modul', icon: '📘' },
      { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥' },
      { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️' },
      { key: 'assignments', label: 'Tugas', icon: '📝' },
      { key: 'grades', label: 'Nilai', icon: '🏆' },
      { key: 'absensi', label: 'Absensi Saya', icon: '📋' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'keuangan', label: 'Pembayaran', icon: '💰' },
      { key: 'profile', label: 'Profil', icon: '👤' }
    ]
  };

  function renderSidebar() {
    document.getElementById('sideRole').textContent = ({
      admin: 'Admin Panel', guru: 'Guru Panel', siswa: 'Siswa Panel'
    })[user.role];
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = user.role;
    document.getElementById('userAvatar').textContent = UI.initials(user.name);
    const badge = document.getElementById('roleBadge');
    badge.textContent = user.role.toUpperCase();
    badge.classList.add(user.role);

    const nav = document.getElementById('sideNav');
    nav.innerHTML = '';
    NAVS[user.role].forEach(item => {
      const a = document.createElement('a');
      a.innerHTML = `<span class="icon">${item.icon}</span><span>${UI.esc(item.label)}</span>`;
      a.dataset.key = item.key;
      a.addEventListener('click', () => navigate(item.key));
      nav.appendChild(a);
    });
  }

  function navigate(key) {
    document.querySelectorAll('.side-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.key === key);
    });
    const navItem = NAVS[user.role].find(n => n.key === key);
    document.getElementById('pageTitle').textContent = navItem ? navItem.label : 'Dashboard';
    const content = document.getElementById('content');
    content.innerHTML = '';
    const mod = ({ admin: AdminPanel, guru: GuruPanel, siswa: SiswaPanel })[user.role];
    mod.render(content, key, user);
  }

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', Auth.logout);

  // Modal close handlers
  const genericModal = document.getElementById('genericModal');
  document.getElementById('modalClose').addEventListener('click', () => UI.modal.close());
  genericModal.addEventListener('click', (e) => { if (e.target === genericModal) UI.modal.close(); });

  renderSidebar();
  // Inject clock widget
  document.getElementById('clockContainer').innerHTML = UI.clockWidgetHtml();
  UI.startClock();
  navigate('overview');

  // Expose for role modules
  window.Dashboard = { navigate, currentUser: user };
})();
