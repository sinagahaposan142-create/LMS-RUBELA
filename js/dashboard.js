/* ===== Dashboard controller - role routing, shell chrome, notifications ===== */
(function () {
  const user = Auth.requireAuth(['admin', 'guru', 'siswa', 'orangtua']);
  if (!user) return;

  const NAVS = {
    admin: [
      { key: 'overview', label: 'Overview', icon: '📊' },
      { key: 'guru', label: 'Kelola Guru', icon: '👨‍🏫' },
      { key: 'siswa', label: 'Kelola Siswa', icon: '👨‍🎓' },
      { key: 'orangtua', label: 'Kelola Orang Tua', icon: '👨‍👩‍👦' },
      { key: 'courses', label: 'Semua Kelas', icon: '📚' },
      { key: 'admin-cbt', label: 'CBT / Ujian', icon: '🖥️' },
      { key: 'admin-bank-soal', label: 'Bank Soal', icon: '📝' },
      { key: 'jadwal-kelas', label: 'Jadwal Kelas', icon: '🗓️' },
      { key: 'batch', label: 'Tahun Akademik', icon: '🎓' },
      { key: 'alumni', label: 'Alumni', icon: '🏛️' },
      { key: 'attendance', label: 'Presensi', icon: '📋' },
      { key: 'rekap', label: 'Rekapan', icon: '📈' },
      { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'chat', label: 'Chat', icon: '💭' },
      { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖' },
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
      { key: 'absensi', label: 'Presensi', icon: '📋' },
      { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'chat', label: 'Chat', icon: '💭' },
      { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖' },
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
      { key: 'absensi', label: 'Presensi Saya', icon: '📋' },
      { key: 'leaderboard', label: 'Papan Peringkat', icon: '🥇' },
      { key: 'ai-tools', label: 'AI Tools', icon: '🤖' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'chat', label: 'Chat', icon: '💭' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'keuangan', label: 'Pembayaran', icon: '💰' },
      { key: 'profile', label: 'Profil', icon: '👤' }
    ],
    orangtua: [
      { key: 'overview', label: 'Overview Anak', icon: '📊' },
      { key: 'anak-nilai', label: 'Nilai & Ujian', icon: '🏆' },
      { key: 'anak-absensi', label: 'Kehadiran', icon: '📋' },
      { key: 'anak-tugas', label: 'Tugas', icon: '📝' },
      { key: 'anak-kelas', label: 'Kelas & Guru', icon: '📚' },
      { key: 'anak-perkembangan', label: 'Perkembangan', icon: '📈' },
      { key: 'keuangan', label: 'Pembayaran', icon: '💰' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'chat', label: 'Chat Guru', icon: '💭' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'profile', label: 'Profil', icon: '👤' }
    ]
  };

  const ROLE_TITLES = {
    admin: 'Admin Panel',
    guru: 'Guru Panel',
    siswa: 'Siswa Panel',
    orangtua: 'Panel Orang Tua'
  };

  const PANELS = {
    admin: () => window.AdminPanel,
    guru: () => window.GuruPanel,
    siswa: () => window.SiswaPanel,
    orangtua: () => window.OrangtuaPanel
  };

  /* ================= Sidebar ================= */
  function renderSidebar() {
    document.getElementById('sideRole').textContent = ROLE_TITLES[user.role] || 'Panel';
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = Auth.ROLE_LABELS[user.role] || user.role;
    document.getElementById('userAvatar').textContent = UI.initials(user.name);
    const badge = document.getElementById('roleBadge');
    badge.textContent = (Auth.ROLE_LABELS[user.role] || user.role).toUpperCase();
    badge.classList.add(user.role);

    const nav = document.getElementById('sideNav');
    nav.innerHTML = '';
    (NAVS[user.role] || []).forEach((item, i) => {
      const a = document.createElement('a');
      a.innerHTML = `<span class="icon">${item.icon}</span><span>${UI.esc(item.label)}</span>`;
      a.dataset.key = item.key;
      a.style.animation = `fadeInLeft .4s var(--ease) both`;
      a.style.animationDelay = (0.03 + i * 0.022).toFixed(3) + 's';
      a.addEventListener('click', () => {
        navigate(item.key);
        closeSidebar();
      });
      nav.appendChild(a);
    });
  }

  /* ================= Routing ================= */
  function navigate(key) {
    document.querySelectorAll('.side-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.key === key);
    });
    const navItem = (NAVS[user.role] || []).find(n => n.key === key);
    document.getElementById('pageTitle').textContent = navItem ? navItem.label : 'Dashboard';
    const content = document.getElementById('content');
    content.innerHTML = '';

    const mod = (PANELS[user.role] || (() => null))();
    if (!mod || typeof mod.render !== 'function') {
      content.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Panel untuk peran ini belum tersedia.</div>';
      return;
    }
    try {
      mod.render(content, key, user);
    } catch (err) {
      console.error('[LMS] gagal merender halaman', key, err);
      content.innerHTML = `<div class="card"><div class="alert alert-error">
        Terjadi kesalahan saat membuka halaman ini. Silakan coba lagi.</div>
        <p class="muted small">${UI.esc(err.message || String(err))}</p></div>`;
    }

    // Motion: replay the staggered entrance and wire up new nodes
    if (window.Effects) {
      Effects.playPageEnter(content);
      Effects.enhance(content);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ================= Notification center ================= */
  let notifOpen = false;

  function renderBell() {
    const wrap = document.getElementById('notifWrap');
    if (!wrap) return;
    const unread = DB.getUnreadCount(user.id);
    wrap.innerHTML = `
      <button type="button" class="bell-btn ${unread ? 'has-new' : ''}" id="bellBtn"
              title="Notifikasi" aria-label="Notifikasi (${unread} belum dibaca)">
        <span class="bell-ic">🔔</span>
        ${unread ? `<span class="bell-count">${unread > 9 ? '9+' : unread}</span>` : ''}
      </button>
      ${notifOpen ? notifPanelHtml() : ''}
    `;
    document.getElementById('bellBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      notifOpen = !notifOpen;
      renderBell();
    });
    if (notifOpen) bindNotifPanel();
  }

  function notifPanelHtml() {
    const list = DB.getNotifications(user.id).slice(0, 30);
    return `
      <div class="notif-panel" id="notifPanel">
        <div class="np-head">
          <strong>Notifikasi</strong>
          <div class="flex-gap">
            <button class="btn btn-sm btn-secondary" id="markAllRead">Tandai dibaca</button>
            ${list.length ? '<button class="btn btn-sm btn-secondary" id="clearNotif">Bersihkan</button>' : ''}
          </div>
        </div>
        <div class="notif-list">
          ${list.length === 0
            ? '<div class="empty" style="border:none;background:transparent;"><div class="empty-icon">🔔</div>Belum ada notifikasi.</div>'
            : list.map(n => `
              <div class="notif-item ${n.read ? '' : 'unread'}" data-nid="${n.id}" data-link="${UI.esc(n.link || '')}">
                <div class="ni-ic">${n.icon || '🔔'}</div>
                <div style="flex:1;min-width:0;">
                  <div class="ni-title">${UI.esc(n.title || '')}</div>
                  <div class="ni-body">${UI.esc(n.body || '')}</div>
                  <div class="ni-time">${UI.fmtRelative(n.createdAt)}</div>
                </div>
              </div>`).join('')}
        </div>
      </div>`;
  }

  function bindNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    panel.addEventListener('click', (e) => e.stopPropagation());

    const markAll = document.getElementById('markAllRead');
    if (markAll) markAll.addEventListener('click', () => {
      DB.markAllNotificationsRead(user.id);
      renderBell();
      UI.toast('Semua notifikasi ditandai sudah dibaca.', 'info');
    });
    const clear = document.getElementById('clearNotif');
    if (clear) clear.addEventListener('click', () => {
      DB.clearNotifications(user.id);
      renderBell();
      UI.toast('Notifikasi dibersihkan.', 'info');
    });

    panel.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', () => {
        DB.markNotificationRead(item.dataset.nid);
        const link = item.dataset.link;
        notifOpen = false;
        renderBell();
        // Only navigate when the target section exists for this role
        if (link && (NAVS[user.role] || []).some(n => n.key === link)) navigate(link);
      });
    });
  }

  // Close the panel when clicking elsewhere
  document.addEventListener('click', () => {
    if (notifOpen) { notifOpen = false; renderBell(); }
  });

  /* ================= Mobile sidebar ================= */
  let scrim = null;
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'sidebar-scrim';
      scrim.addEventListener('click', closeSidebar);
      document.body.appendChild(scrim);
    }
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    if (scrim) { scrim.remove(); scrim = null; }
  }
  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = document.getElementById('sidebar').classList.contains('open');
    if (isOpen) closeSidebar(); else openSidebar();
  });

  /* ================= Shell wiring ================= */
  document.getElementById('logoutBtn').addEventListener('click', () => {
    UI.toast('Sampai jumpa, ' + user.name.split(' ')[0] + '! 👋', 'info');
    setTimeout(Auth.logout, 420);
  });

  const genericModal = document.getElementById('genericModal');
  document.getElementById('modalClose').addEventListener('click', () => UI.modal.close());
  genericModal.addEventListener('click', (e) => { if (e.target === genericModal) UI.modal.close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !genericModal.classList.contains('hidden')) UI.modal.close();
  });

  renderSidebar();
  document.getElementById('clockContainer').innerHTML = UI.clockWidgetHtml();
  UI.startClock();
  const themeSlot = document.getElementById('themeSlot');
  if (themeSlot && window.Effects) {
    themeSlot.innerHTML = Effects.themeToggleHtml();
    Effects.bindThemeToggle();
  }
  renderBell();
  navigate('overview');

  // Greet the user once per session
  UI.toast(`${UI.greeting()}, ${user.name.split(' ')[0]}! 👋`, 'info');

  // Expose for role modules
  window.Dashboard = {
    navigate,
    currentUser: user,
    refreshNotifications: renderBell,
    hasSection: (key) => (NAVS[user.role] || []).some(n => n.key === key)
  };
})();
