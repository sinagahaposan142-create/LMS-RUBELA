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
      { key: 'staff', label: 'Admin & Staff', icon: '🛡️' },
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
      { key: 'motivasi', label: 'Kata Motivasi', icon: '💡' },
      { key: 'streak-admin', label: 'Streak & Gamifikasi', icon: '🔥' },
      { key: 'arena-admin', label: 'Arena Belajar', icon: '🎮' },
      { key: 'course-admin', label: 'Course Mandiri', icon: '🎓' },
      { key: 'ayat-admin', label: 'Ayat Harian', icon: '📖' },
      { key: 'musik', label: 'Musik Latar', icon: '🎵' },
      { key: 'mesin-waktu-admin', label: 'Mesin Waktu', icon: '⏳' },
      { key: 'birthday', label: 'Ulang Tahun', icon: '🎂' },
      { key: 'notifikasi', label: 'Notifikasi & Aktivitas', icon: '🔔' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'chat', label: 'Chat', icon: '💭' },
      { key: 'online', label: 'Sedang Online', icon: '🟢' },
      { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖' },
      { key: 'agent-web', label: 'Agent Web', icon: '🌐' },
      { key: 'keuangan', label: 'Keuangan', icon: '💰' },
      { key: 'keamanan-login', label: 'Keamanan Login', icon: '🔐' },
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
      { key: 'jadwal-kelas', label: 'Jadwal & War Jadwal', icon: '🗓️' },
      { key: 'rekap', label: 'Rekapan Kelas', icon: '📈' },
      { key: 'streak-siswa', label: 'Streak Siswa', icon: '🔥' },
      { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'birthday', label: 'Ulang Tahun', icon: '🎂' },
      { key: 'notifikasi', label: 'Notifikasi', icon: '🔔' },
      { key: 'feedback', label: 'Kritik & Saran', icon: '💬' },
      { key: 'chat', label: 'Chat', icon: '💭' },
      { key: 'online', label: 'Sedang Online', icon: '🟢' },
      { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖' },
      { key: 'keuangan', label: 'Honor Saya', icon: '💰' },
      { key: 'profile', label: 'Profil', icon: '👤' }
    ],
    siswa: [
      { key: 'overview', label: 'Overview', icon: '📊' },
      { key: 'streak', label: 'Streak Belajar', icon: '🔥' },
      { key: 'arena', label: 'Arena Belajar', icon: '🎮' },
      { key: 'my-courses', label: 'Kelas Saya', icon: '📚' },
      { key: 'course', label: 'Course', icon: '🎓' },
      { key: 'browse', label: 'Jelajah Kelas', icon: '🔎' },
      { key: 'modul', label: 'Modul', icon: '📘' },
      { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥' },
      { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️' },
      { key: 'assignments', label: 'Tugas', icon: '📝' },
      { key: 'grades', label: 'Nilai', icon: '🏆' },
      { key: 'absensi', label: 'Presensi Saya', icon: '📋' },
      { key: 'jadwal-siswa', label: 'Jadwal Kelas', icon: '🗓️' },
      { key: 'leaderboard', label: 'Papan Peringkat', icon: '🥇' },
      { key: 'ai-tools', label: 'AI Tools', icon: '🤖' },
      { key: 'ayat', label: 'Ayat Harian', icon: '📖' },
      { key: 'mesin-waktu', label: 'Mesin Waktu', icon: '⏳' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'birthday', label: 'Ulang Tahun', icon: '🎂' },
      { key: 'notifikasi', label: 'Notifikasi', icon: '🔔' },
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
      { key: 'anak-streak', label: 'Streak Anak', icon: '🔥' },
      { key: 'anak-course', label: 'Course Anak', icon: '🎓' },
      { key: 'anak-jadwal', label: 'Jadwal Kelas', icon: '🗓️' },
      { key: 'keuangan', label: 'Pembayaran', icon: '💰' },
      { key: 'kalender', label: 'Kalender', icon: '📅' },
      { key: 'pengumuman', label: 'Pengumuman', icon: '📢' },
      { key: 'birthday', label: 'Ulang Tahun Anak', icon: '🎂' },
      { key: 'notifikasi', label: 'Notifikasi', icon: '🔔' },
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
    renderAvatar();
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

  /** Avatar sidebar: foto profil bila ada, bingkai khusus saat ulang tahun. */
  function renderAvatar() {
    const el = document.getElementById('userAvatar');
    const fresh = DB.getUser(user.id) || user;
    el.classList.toggle('has-photo', !!fresh.photo);
    el.classList.toggle('bd-frame', !!(window.Birthday && Birthday.hasFrame(fresh)));
    if (fresh.photo) el.innerHTML = `<img src="${UI.esc(fresh.photo)}" alt="" />`;
    else el.textContent = UI.initials(fresh.name);
  }

  /* Halaman lintas peran yang dirender langsung oleh shell. */
  const COMMON = {
    birthday: (c) => Birthday.renderWall(c, user),
    notifikasi: (c) => renderNotifHistory(c)
  };

  /* ================= Routing ================= */
  function navigate(key) {
    document.querySelectorAll('.side-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.key === key);
    });
    const navItem = (NAVS[user.role] || []).find(n => n.key === key);
    document.getElementById('pageTitle').textContent = navItem ? navItem.label : 'Dashboard';
    const content = document.getElementById('content');
    if (window.Whiteboard) Whiteboard.destroy();
    // Ruang pribadi Mesin Waktu terkunci kembali setiap kali halaman ditinggalkan.
    if (window.TimeCapsule) TimeCapsule.lock();
    if (window.Arena) Arena.stop();
    if (window.CourseHub && key !== 'course' && key !== 'course-admin') CourseHub.reset();
    if (content.__presenceDispose) {
      content.__presenceDispose();
      delete content.__presenceDispose;
    }
    content.innerHTML = '';
    if (window.Presence) Presence.setPage(key);

    const mod = (PANELS[user.role] || (() => null))();
    if (!mod || typeof mod.render !== 'function') {
      content.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Panel untuk peran ini belum tersedia.</div>';
      return;
    }
    try {
      if (COMMON[key]) COMMON[key](content);
      else mod.render(content, key, user);
      if (key === 'overview' && window.Birthday) Birthday.mountBanner(content, user);
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
    // Responsif: beri label kolom tabel & tandai area yang perlu digulir
    if (window.Responsive) Responsive.apply(content);
    if (window.Shared && Shared.bindMotivation) Shared.bindMotivation(content);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ================= Riwayat notifikasi & aktivitas ================= */
  let notifTab = 'notif';
  function renderNotifHistory(container) {
    const isAdmin = user.role === 'admin';
    const tab = isAdmin ? notifTab : 'notif';
    container.innerHTML = `
      ${isAdmin ? `<div class="tabs">
        <button type="button" class="tab-btn ${tab === 'notif' ? 'active' : ''}" data-ntab="notif">🔔 Notifikasi Saya</button>
        <button type="button" class="tab-btn ${tab === 'log' ? 'active' : ''}" data-ntab="log">🧾 Riwayat Aktivitas</button>
      </div>` : ''}
      <div class="card">
        <div class="card-header">
          ${UI.secHead(tab === 'log' ? '🧾' : '🔔', tab === 'log' ? 'Riwayat Aktivitas' : 'Riwayat Notifikasi',
            tab === 'log' ? 'perubahan akun, pengaturan, dan moderasi (1000 entri terbaru)' : 'semua notifikasi yang Anda terima')}
          ${tab === 'notif' ? `<div class="flex-gap">
            <button type="button" class="btn btn-sm btn-secondary" id="nhRead">Tandai semua dibaca</button>
            <button type="button" class="btn btn-sm btn-danger" id="nhClear">Bersihkan</button></div>` : ''}
        </div>
        <div id="nhList"></div>
      </div>`;
    container.querySelectorAll('[data-ntab]').forEach(b => b.addEventListener('click', () => {
      notifTab = b.dataset.ntab; renderNotifHistory(container);
    }));
    const box = container.querySelector('#nhList');
    if (tab === 'log') {
      const ROLE = Auth.ROLE_LABELS;
      const log = DB.getActivityLog();
      const kinds = [...new Set(log.map(l => l.action.split('.')[0]))];
      const KIND_LABEL = { user: 'Akun', settings: 'Pengaturan', birthday: 'Ulang tahun' };
      DataSearch.mount({
        container: box, items: log, stateKey: 'activity-log',
        placeholder: 'Cari pelaku, aksi, atau detail…',
        fields: l => [l.actorName, ROLE[l.actorRole] || l.actorRole, l.action, l.detail, UI.fmtDateTime(l.at)],
        filters: [
          { key: 'kind', label: 'Semua jenis', get: l => l.action.split('.')[0], options: kinds.map(k => ({ value: k, label: KIND_LABEL[k] || k })) },
          { key: 'role', label: 'Semua peran', get: l => l.actorRole, options: Object.keys(ROLE).map(k => ({ value: k, label: ROLE[k] })) }
        ],
        dateRange: l => DB.ymdOf(l.at),
        sorts: [{ key: 'new', label: 'Terbaru', cmp: (a, b) => b.at - a.at }, { key: 'old', label: 'Terlama', cmp: (a, b) => a.at - b.at }],
        pageSize: 20, empty: 'Belum ada aktivitas tercatat.',
        render: (rows, ctx) => `<div class="table-wrap"><table class="table">
          <thead><tr><th>Waktu</th><th>Pelaku</th><th>Aktivitas</th></tr></thead>
          <tbody>${rows.map(l => `<tr><td>${UI.esc(UI.fmtDateTime(l.at))}</td>
            <td><strong>${ctx.highlight(l.actorName)}</strong><div class="muted small">${UI.esc(ROLE[l.actorRole] || l.actorRole)}</div></td>
            <td>${ctx.highlight(l.detail)}</td></tr>`).join('')}</tbody></table></div>`
      });
      return;
    }
    const list = DB.getNotifications(user.id);
    DataSearch.mount({
      container: box, items: list, stateKey: 'notif-history',
      placeholder: 'Cari judul atau isi notifikasi…',
      fields: n => [n.title, n.body, n.icon],
      filters: [{ key: 'read', label: 'Semua', get: n => n.read ? 'read' : 'unread',
        options: [{ value: 'unread', label: 'Belum dibaca' }, { value: 'read', label: 'Sudah dibaca' }] }],
      dateRange: n => DB.ymdOf(n.createdAt),
      sorts: [{ key: 'new', label: 'Terbaru', cmp: (a, b) => b.createdAt - a.createdAt }, { key: 'old', label: 'Terlama', cmp: (a, b) => a.createdAt - b.createdAt }],
      pageSize: 20, empty: 'Belum ada notifikasi.',
      render: (rows, ctx) => `<div class="notif-list is-page">${rows.map(n => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-nh="${n.id}" data-link="${UI.esc(n.link || '')}" role="button" tabindex="0">
          <div class="ni-ic">${UI.esc(n.icon || '🔔')}</div>
          <div style="flex:1;min-width:0;">
            <div class="ni-title">${ctx.highlight(n.title || '')}</div>
            <div class="ni-body">${ctx.highlight(n.body || '')}</div>
            <div class="ni-time">${UI.esc(UI.fmtDateTime(n.createdAt))} • ${UI.fmtRelative(n.createdAt)}</div>
          </div>
        </div>`).join('')}</div>`,
      onPaint: (res) => res.querySelectorAll('[data-nh]').forEach(item => {
        const open = () => {
          DB.markNotificationRead(item.dataset.nh);
          renderBell();
          const link = item.dataset.link;
          if (link && link !== 'notifikasi' && (NAVS[user.role] || []).some(n => n.key === link)) navigate(link);
          else renderNotifHistory(container);
        };
        item.addEventListener('click', open);
        item.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      })
    });
    container.querySelector('#nhRead').addEventListener('click', () => {
      DB.markAllNotificationsRead(user.id); renderBell(); renderNotifHistory(container);
      UI.toast('Semua notifikasi ditandai sudah dibaca.', 'info');
    });
    container.querySelector('#nhClear').addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus semua notifikasi Anda?')) return;
      DB.clearNotifications(user.id); renderBell(); renderNotifHistory(container);
      UI.toast('Notifikasi dibersihkan.', 'info');
    });
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
            <button class="btn btn-sm btn-primary" id="allNotif">Lihat semua</button>
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
    const all = document.getElementById('allNotif');
    if (all) all.addEventListener('click', () => { notifOpen = false; renderBell(); navigate('notifikasi'); });
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
    if (window.TimeCapsule) TimeCapsule.lock();
    if (window.Music) Music.destroy();
    UI.toast('Sampai jumpa, ' + user.name.split(' ')[0] + '! 👋', 'info');
    setTimeout(Auth.logout, 420);
  });

  const genericModal = document.getElementById('genericModal');
  function closeGenericModal() {
    if (window.Whiteboard) Whiteboard.destroy();
    UI.modal.close();
  }
  document.getElementById('modalClose').addEventListener('click', closeGenericModal);
  genericModal.addEventListener('click', (e) => { if (e.target === genericModal) closeGenericModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !genericModal.classList.contains('hidden')) closeGenericModal();
  });

  // Expose SEBELUM ticker pertama dirender agar tombol papan berjalan hidup
  // sejak paint awal, bukan baru setelah pengumuman berubah.
  window.Dashboard = {
    navigate,
    currentUser: user,
    refreshNotifications: renderBell,
    refreshAvatar: renderAvatar,
    hasSection: (key) => (NAVS[user.role] || []).some(n => n.key === key)
  };

  // Notifikasi ulang tahun dikirim sebelum lonceng pertama kali digambar.
  if (window.Birthday) { try { Birthday.ensureNotifications(); } catch (e) { console.warn('[LMS] notifikasi ulang tahun', e); } }
  // Streak: catat login harian (bukan aktivitas belajar) & pengingat sebelum streak putus.
  const streakTick = () => { if (window.StreakAPI) { try { StreakAPI.tick(user); } catch (e) { console.warn('[LMS] streak', e); } } };
  streakTick();
  setInterval(streakTick, 5 * 60 * 1000);
  if (user.role === 'siswa') { try { DB.notifyReadyCapsules(user.id); } catch (e) { console.warn('[LMS] mesin waktu', e); } }
  renderSidebar();
  document.getElementById('clockContainer').innerHTML = UI.clockWidgetHtml();
  UI.startClock();
  const themeSlot = document.getElementById('themeSlot');
  if (themeSlot && window.Effects) {
    themeSlot.innerHTML = Effects.themeToggleHtml();
    Effects.bindThemeToggle();
  }
  renderBell();

  /* Papan berjalan: memakai audience yang sama dengan halaman Pengumuman. */
  function renderTickerBar() {
    if (window.Shared && Shared.renderTicker) Shared.renderTicker(document.getElementById('tickerBar'), user);
  }
  renderTickerBar();
  window.addEventListener('lms:announcements-changed', renderTickerBar);
  window.addEventListener('storage', (e) => {
    if (e.key === 'lms_announcements') renderTickerBar();
  });

  /* Presence/status online: badge ringkas di topbar + halaman khusus admin/tutor. */
  function renderPresenceBadge() {
    const wrap = document.getElementById('presenceWrap');
    if (!wrap || !window.Presence) return;
    const visible = Presence.visibleTo(user);
    const active = visible.filter(r => r.state === 'online').length;
    const canOpen = (NAVS[user.role] || []).some(n => n.key === 'online');
    wrap.innerHTML = `<button type="button" class="presence-btn ${canOpen ? '' : 'is-static'}"
      id="presenceBtn" title="${active} pengguna aktif${canOpen ? ' — buka daftar' : ''}"
      aria-label="${active} pengguna aktif">
      <span class="presence-dot online"></span><strong>${active}</strong><span class="presence-label">online</span>
    </button>`;
    const btn = document.getElementById('presenceBtn');
    if (btn && canOpen) btn.addEventListener('click', () => navigate('online'));
  }
  let stopPresenceBadge = null;
  if (window.Presence) {
    Presence.start(user);
    renderPresenceBadge();
    stopPresenceBadge = Presence.subscribe(renderPresenceBadge);
  }

  navigate('overview');
  // Musik latar hidup di shell sehingga tidak dimulai ulang saat berpindah menu.
  if (window.Music) { try { Music.init(user); } catch (e) { console.warn('[LMS] musik', e); } }

  // Greet the user once per session
  UI.toast(`${UI.greeting()}, ${user.name.split(' ')[0]}! 👋`, 'info');

  // Dashboard API sudah diekspor sebelum inisialisasi ticker.
})();
