/* ===== Dashboard controller - role routing, shell chrome, notifications ===== */
(function () {
  /* Mode server: tunggu data server dimuat (js/sync.js) sebelum dashboard dirender. */
  function main() {
    const user = Auth.requireAuth(['admin', 'guru', 'siswa', 'orangtua']);
    if (!user) return;
    // Mode server: migrasi skema data bersama dijalankan oleh perangkat admin.
    if (DB.isServerMode && DB.isServerMode() && user.role === 'admin') {
      try { DB.runMigrations(); } catch (e) { console.warn('[LMS] migrasi', e); }
    }

    /* Navigasi dikelompokkan per kategori agar sidebar mudah dipindai.
     * Kunci (key) TIDAK berubah sehingga routing & tautan notifikasi tetap sama. */
    const NAVS = {
      admin: [
        { key: 'overview', label: 'Overview', icon: '📊', group: 'Utama' },
        { key: 'notifikasi', label: 'Notifikasi & Aktivitas', icon: '🔔', group: 'Utama' },
        { key: 'online', label: 'Sedang Online', icon: '🟢', group: 'Utama' },
        { key: 'guru', label: 'Kelola Tutor', icon: '👨‍🏫', group: 'Pengguna' },
        { key: 'siswa', label: 'Kelola Mentee', icon: '👨‍🎓', group: 'Pengguna' },
        { key: 'orangtua', label: 'Kelola Orang Tua', icon: '👨‍👩‍👦', group: 'Pengguna' },
        { key: 'staff', label: 'Admin & Staff', icon: '🛡️', group: 'Pengguna' },
        { key: 'data-ganda', label: 'Cek Data Ganda', icon: '🔁', group: 'Pengguna' },
        { key: 'courses', label: 'Semua Kelas', icon: '📚', group: 'Akademik' },
        { key: 'course-admin', label: 'Course Mandiri', icon: '🎓', group: 'Akademik' },
        { key: 'hub-pay', label: 'Pembayaran Course', icon: '💳', group: 'Akademik' },
        { key: 'pusat-konten', label: 'Pusat Konten', icon: '📦', group: 'Akademik' },
        { key: 'jadwal-kelas', label: 'Jadwal Kelas', icon: '🗓️', group: 'Akademik' },
        { key: 'attendance', label: 'Presensi', icon: '📋', group: 'Akademik' },
        { key: 'admin-cbt', label: 'CBT / Ujian', icon: '🖥️', group: 'Akademik' },
        { key: 'admin-bank-soal', label: 'Bank Soal', icon: '📝', group: 'Akademik' },
        { key: 'rekap', label: 'Rekapan', icon: '📈', group: 'Akademik' },
        { key: 'batch', label: 'Tahun Akademik', icon: '🎓', group: 'Akademik' },
        { key: 'alumni', label: 'Alumni', icon: '🏛️', group: 'Akademik' },
        { key: 'kalkulator-utbk', label: 'Kalkulator UTBK', icon: '🧮', group: 'Tools' },
        { key: 'kalender-seleksi', label: 'Kalender Seleksi', icon: '📆', group: 'Tools' },
        { key: 'data-ptn', label: 'Data PTN', icon: '🏫', group: 'Tools' },
        { key: 'streak-admin', label: 'Streak & Gamifikasi', icon: '🔥', group: 'Motivasi & Gamifikasi' },
        { key: 'arena-admin', label: 'Arena Belajar', icon: '🎮', group: 'Motivasi & Gamifikasi' },
        { key: 'game-admin', label: 'Game Battle', icon: '⚔️', group: 'Motivasi & Gamifikasi' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆', group: 'Motivasi & Gamifikasi' },
        { key: 'ruang-belajar', label: 'Ruang Belajar', icon: '⏱️', group: 'Motivasi & Gamifikasi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Motivasi & Gamifikasi' },
        { key: 'motivasi', label: 'Kata Motivasi', icon: '💡', group: 'Motivasi & Gamifikasi' },
        { key: 'ayat-admin', label: 'Ayat Harian', icon: '📖', group: 'Motivasi & Gamifikasi' },
        { key: 'mesin-waktu-admin', label: 'Mesin Waktu', icon: '⏳', group: 'Motivasi & Gamifikasi' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'berita', label: 'Berita', icon: '📰', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
        { key: 'grup', label: 'Grup Belajar', icon: '👥', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Keuangan', icon: '💰', group: 'Operasional' },
        { key: 'musik', label: 'Musik Latar', icon: '🎵', group: 'Operasional' },
        { key: 'tema-hari-besar', label: 'Tema Hari Besar', icon: '🎉', group: 'Operasional' },
        { key: 'ai-asisten', label: 'Asisten AI', icon: '💬', group: 'Sistem & AI' },
        { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖', group: 'Sistem & AI' },
        { key: 'agent-web', label: 'Agent Web', icon: '🌐', group: 'Sistem & AI' },
        { key: 'keamanan-login', label: 'Keamanan Login', icon: '🔐', group: 'Sistem & AI' },
        { key: 'settings', label: 'Pengaturan', icon: '⚙️', group: 'Sistem & AI' }
      ],
      guru: [
        { key: 'overview', label: 'Overview', icon: '📊', group: 'Utama' },
        { key: 'notifikasi', label: 'Notifikasi', icon: '🔔', group: 'Utama' },
        { key: 'online', label: 'Sedang Online', icon: '🟢', group: 'Utama' },
        { key: 'courses', label: 'Kelas Saya', icon: '📚', group: 'Mengajar' },
        { key: 'jadwal-kelas', label: 'Jadwal & War Jadwal', icon: '🗓️', group: 'Mengajar' },
        { key: 'pusat-konten', label: 'Pusat Konten', icon: '📦', group: 'Mengajar' },
        { key: 'absensi', label: 'Presensi', icon: '📋', group: 'Mengajar' },
        { key: 'modul', label: 'Modul', icon: '📘', group: 'Mengajar' },
        { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥', group: 'Mengajar' },
        { key: 'bank-soal', label: 'Bank Soal', icon: '📝', group: 'Mengajar' },
        { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️', group: 'Mengajar' },
        { key: 'grading', label: 'Penilaian Tugas', icon: '✅', group: 'Mengajar' },
        { key: 'course-tutor', label: 'Course Mandiri', icon: '🎓', group: 'Mengajar' },
        { key: 'kalkulator-utbk', label: 'Kalkulator UTBK', icon: '🧮', group: 'Tools' },
        { key: 'kalender-seleksi', label: 'Kalender Seleksi', icon: '📆', group: 'Tools' },
        { key: 'rekap', label: 'Rekapan Kelas', icon: '📈', group: 'Mentee & Laporan' },
        { key: 'streak-siswa', label: 'Streak Mentee', icon: '🔥', group: 'Mentee & Laporan' },
        { key: 'ruang-belajar', label: 'Ruang Belajar', icon: '⏱️', group: 'Mentee & Laporan' },
        { key: 'game-admin', label: 'Game Battle', icon: '⚔️', group: 'Mentee & Laporan' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆', group: 'Mentee & Laporan' },
        { key: 'ai-asisten', label: 'Asisten AI', icon: '💬', group: 'Mentee & Laporan' },
        { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖', group: 'Mentee & Laporan' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'berita', label: 'Berita', icon: '📰', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
        { key: 'grup', label: 'Grup Belajar', icon: '👥', group: 'Komunikasi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Honor Saya', icon: '💰', group: 'Akun' },
        { key: 'profile', label: 'Profil', icon: '👤', group: 'Akun' }
      ],
      siswa: [
        { key: 'overview', label: 'Overview', icon: '📊', group: 'Utama' },
        { key: 'notifikasi', label: 'Notifikasi', icon: '🔔', group: 'Utama' },
        { key: 'my-courses', label: 'Kelas Saya', icon: '📚', group: 'Belajar' },
        { key: 'ruang-belajar', label: 'Ruang Belajar', icon: '⏱️', group: 'Belajar' },
        { key: 'course', label: 'Course', icon: '🎓', group: 'Belajar' },
        { key: 'browse', label: 'Jelajah Kelas', icon: '🔎', group: 'Belajar' },
        { key: 'modul', label: 'Modul', icon: '📘', group: 'Belajar' },
        { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥', group: 'Belajar' },
        { key: 'assignments', label: 'Tugas', icon: '📝', group: 'Belajar' },
        { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️', group: 'Belajar' },
        { key: 'grades', label: 'Nilai', icon: '🏆', group: 'Belajar' },
        { key: 'kalkulator-utbk', label: 'Kalkulator UTBK', icon: '🧮', group: 'Tools' },
        { key: 'kalender-seleksi', label: 'Kalender Seleksi', icon: '📆', group: 'Tools' },
        { key: 'streak', label: 'Streak Belajar', icon: '🔥', group: 'Gamifikasi' },
        { key: 'arena', label: 'Arena Belajar', icon: '🎮', group: 'Gamifikasi' },
        { key: 'game-battle', label: 'Game Battle', icon: '⚔️', group: 'Gamifikasi' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🥇', group: 'Gamifikasi' },
        { key: 'jadwal-siswa', label: 'Jadwal Kelas', icon: '🗓️', group: 'Jadwal & Kehadiran' },
        { key: 'absensi', label: 'Presensi Saya', icon: '📋', group: 'Jadwal & Kehadiran' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Jadwal & Kehadiran' },
        { key: 'mesin-waktu', label: 'Mesin Waktu', icon: '⏳', group: 'Ruang Pribadi' },
        { key: 'ayat', label: 'Ayat Harian', icon: '📖', group: 'Ruang Pribadi' },
        { key: 'ai-tools', label: 'AI Tools', icon: '🤖', group: 'Ruang Pribadi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Ruang Pribadi' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'berita', label: 'Berita', icon: '📰', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
        { key: 'grup', label: 'Grup Belajar', icon: '👥', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Pembayaran', icon: '💰', group: 'Akun' },
        { key: 'profile', label: 'Profil', icon: '👤', group: 'Akun' }
      ],
      orangtua: [
        { key: 'overview', label: 'Overview Anak', icon: '📊', group: 'Utama' },
        { key: 'notifikasi', label: 'Notifikasi', icon: '🔔', group: 'Utama' },
        { key: 'anak-nilai', label: 'Nilai & Ujian', icon: '🏆', group: 'Pantau Anak' },
        { key: 'anak-absensi', label: 'Kehadiran', icon: '📋', group: 'Pantau Anak' },
        { key: 'anak-tugas', label: 'Tugas', icon: '📝', group: 'Pantau Anak' },
        { key: 'anak-kelas', label: 'Kelas & Tutor', icon: '📚', group: 'Pantau Anak' },
        { key: 'anak-course', label: 'Course Anak', icon: '🎓', group: 'Pantau Anak' },
        { key: 'anak-jadwal', label: 'Jadwal Kelas', icon: '🗓️', group: 'Pantau Anak' },
        { key: 'anak-perkembangan', label: 'Perkembangan', icon: '📈', group: 'Pantau Anak' },
        { key: 'anak-streak', label: 'Streak Anak', icon: '🔥', group: 'Pantau Anak' },
        { key: 'ruang-belajar', label: 'Jam Belajar Anak', icon: '⏱️', group: 'Pantau Anak' },
        { key: 'birthday', label: 'Ulang Tahun Anak', icon: '🎂', group: 'Pantau Anak' },
        { key: 'kalkulator-utbk', label: 'Kalkulator UTBK', icon: '🧮', group: 'Tools' },
        { key: 'kalender-seleksi', label: 'Kalender Seleksi', icon: '📆', group: 'Tools' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'berita', label: 'Berita', icon: '📰', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat Tutor', icon: '💭', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Pembayaran', icon: '💰', group: 'Akun' },
        { key: 'profile', label: 'Profil', icon: '👤', group: 'Akun' }
      ]
    };

    /* Navigasi bawah ponsel: menu yang paling sering dipakai tiap peran + "Menu". */
    const BOTTOM_NAV = {
      admin: [['overview', 'Beranda'], ['siswa', 'Mentee'], ['courses', 'Kelas'], ['attendance', 'Presensi']],
      guru: [['overview', 'Beranda'], ['courses', 'Kelas'], ['absensi', 'Presensi'], ['grading', 'Nilai']],
      siswa: [['overview', 'Beranda'], ['my-courses', 'Kelas'], ['streak', 'Streak'], ['assignments', 'Tugas']],
      orangtua: [['overview', 'Beranda'], ['anak-nilai', 'Nilai'], ['anak-absensi', 'Hadir'], ['anak-tugas', 'Tugas']]
    };

    /* Aksi cepat di Overview — hanya menu yang memang tersedia bagi peran itu. */
    const QUICK_ACTIONS = {
      admin: [['attendance', 'Ambil presensi', 'Isi kehadiran hari ini'], ['siswa', 'Tambah mentee', 'Kelola akun mentee'],
        ['courses', 'Kelola kelas', 'Tutor, jadwal & mentee'], ['admin-cbt', 'Buat ujian', 'CBT & tryout'],
        ['pengumuman', 'Pengumuman', 'Kirim info penting'], ['keuangan', 'Keuangan', 'Pemasukan & gaji']],
      guru: [['absensi', 'Ambil presensi', 'Kelas hari ini'], ['grading', 'Nilai tugas', 'Submission menunggu'],
        ['jadwal-kelas', 'Jadwal', 'Validasi pertemuan'], ['cbt', 'Buat ujian', 'CBT kelas'],
        ['modul', 'Modul', 'Materi berbagian'], ['chat', 'Chat', 'Pesan mentee & admin']],
      siswa: [['arena', 'Tantangan harian', 'Nyalakan streak'], ['assignments', 'Tugas', 'Kerjakan sebelum deadline'],
        ['cbt', 'Tryout / CBT', 'Ujian tersedia'], ['jadwal-siswa', 'Jadwal kelas', 'Masuk Zoom/Meet'],
        ['course', 'Course', 'Belajar mandiri'], ['mesin-waktu', 'Mesin Waktu', 'Surat untuk masa depan']],
      orangtua: [['anak-nilai', 'Nilai & ujian', 'Hasil terbaru'], ['anak-absensi', 'Kehadiran', 'Persentase hadir'],
        ['anak-tugas', 'Tugas', 'Status pengumpulan'], ['anak-jadwal', 'Jadwal', 'Kelas minggu ini'],
        ['keuangan', 'Pembayaran', 'Tagihan & riwayat'], ['chat', 'Chat tutor', 'Hubungi tutor']]
    };

    const ROLE_TITLES = {
      admin: 'Admin Panel',
      guru: 'Tutor Panel',
      siswa: 'Mentee Panel',
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
      // Kelompokkan menu sesuai urutan kemunculan kategori.
      const groups = [];
      (NAVS[user.role] || []).forEach(item => {
        const g = item.group || 'Menu';
        let grp = groups.find(x => x.name === g);
        if (!grp) { grp = { name: g, items: [] }; groups.push(grp); }
        grp.items.push(item);
      });
      let i = 0;
      groups.forEach(grp => {
        const wrap = document.createElement('div');
        wrap.className = 'side-nav-group';
        wrap.setAttribute('role', 'group');
        const gid = 'navg-' + grp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        wrap.setAttribute('aria-labelledby', gid);
        wrap.innerHTML = `<div class="side-nav-label" id="${gid}">${UI.esc(grp.name)}</div>`;
        grp.items.forEach(item => {
          const a = document.createElement('a');
          a.href = '#';
          a.innerHTML = `<span class="icon" aria-hidden="true">${item.icon}</span><span class="nav-label">${UI.esc(item.label)}</span>`;
          a.dataset.key = item.key;
          a.dataset.tip = item.label;
          a.style.animation = `fadeInLeft .35s var(--ease) both`;
          a.style.animationDelay = Math.min(0.5, 0.02 + i * 0.012).toFixed(3) + 's';
          a.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(item.key);
            closeSidebar();
          });
          wrap.appendChild(a);
          i++;
        });
        nav.appendChild(wrap);
      });
      renderBottomNav();
    }

    /* ================= Sidebar ringkas (desktop) ================= */
    const SB_KEY = 'lms_sidebar_collapsed';
    function applyCollapsed(on) {
      document.body.classList.toggle('sb-collapsed', on);
      const t = document.getElementById('sbToggle');
      if (t) {
        t.setAttribute('aria-expanded', String(!on));
        t.setAttribute('aria-label', on ? 'Perluas sidebar' : 'Ciutkan sidebar');
        t.title = on ? 'Perluas sidebar' : 'Ciutkan sidebar';
      }
      try { localStorage.setItem(SB_KEY, on ? '1' : '0'); } catch (e) { /* noop */ }
    }
    (function initCollapse() {
      const t = document.getElementById('sbToggle');
      let on = false;
      try { on = localStorage.getItem(SB_KEY) === '1'; } catch (e) { on = false; }
      applyCollapsed(on);
      if (t) t.addEventListener('click', () => applyCollapsed(!document.body.classList.contains('sb-collapsed')));
    })();

    /* ================= Navigasi bawah (ponsel) ================= */
    function renderBottomNav() {
      const el = document.getElementById('bottomNav');
      if (!el) return;
      const navs = NAVS[user.role] || [];
      const items = (BOTTOM_NAV[user.role] || []).filter(([k]) => navs.some(n => n.key === k));
      el.innerHTML = items.map(([k, lbl]) => {
        const n = navs.find(x => x.key === k);
        return `<button type="button" data-bn="${k}" aria-label="${UI.esc(n.label)}"><span class="bn-ic" aria-hidden="true">${n.icon}</span><span class="bn-lbl">${UI.esc(lbl)}</span></button>`;
      }).join('') + `<button type="button" data-bn="__menu" aria-label="Buka semua menu" aria-controls="sidebar"><span class="bn-ic" aria-hidden="true">☰</span><span class="bn-lbl">Menu</span></button>`;
      el.querySelectorAll('[data-bn]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (b.dataset.bn === '__menu') {
          if (document.getElementById('sidebar').classList.contains('open')) closeSidebar(); else openSidebar();
          return;
        }
        closeSidebar();
        navigate(b.dataset.bn);
      }));
    }

    /* ================= Aksi cepat di Overview ================= */
    function mountQuickActions(content) {
      const navs = NAVS[user.role] || [];
      const items = (QUICK_ACTIONS[user.role] || []).filter(([k]) => navs.some(n => n.key === k));
      if (!items.length) return;
      const box = document.createElement('section');
      box.className = 'quick-actions';
      box.setAttribute('aria-label', 'Aksi cepat');
      box.innerHTML = `<div class="qa-title"><h3>⚡ Aksi cepat</h3><span>menu yang paling sering dipakai</span></div>
        <div class="qa-grid">${items.map(([k, lbl, sub]) => {
          const n = navs.find(x => x.key === k);
          return `<button type="button" class="qa-item" data-qa="${k}"><span class="qa-ic" aria-hidden="true">${n.icon}</span>
            <span class="qa-text">${UI.esc(lbl)}<small>${UI.esc(sub)}</small></span></button>`;
        }).join('')}</div>`;
      // Letakkan tepat setelah hero sambutan (atau di paling atas bila tidak ada).
      const hero = content.querySelector('.welcome-hero');
      if (hero && hero.parentNode) hero.parentNode.insertBefore(box, hero.nextSibling);
      else content.insertBefore(box, content.firstChild);
      box.querySelectorAll('[data-qa]').forEach(b => b.addEventListener('click', () => navigate(b.dataset.qa)));
    }

    /** Avatar sidebar: foto profil bila ada, bingkai khusus saat ulang tahun. */
    function renderAvatar() {
      const el = document.getElementById('userAvatar');
      const fresh = DB.getUser(user.id) || user;
      el.classList.toggle('has-photo', !!fresh.photo);
      el.classList.toggle('bd-frame', !!(window.Birthday && Birthday.hasFrame(fresh)));
      if (window.Avatars) el.innerHTML = Avatars.inner(fresh);
      else if (fresh.photo) el.innerHTML = `<img src="${UI.esc(fresh.photo)}" alt="" />`;
      else el.textContent = UI.initials(fresh.name);
    }

    /* Halaman lintas peran yang dirender langsung oleh shell. */
    const COMMON = {
      birthday: (c) => Birthday.renderWall(c, user),
      notifikasi: (c) => renderNotifHistory(c),
      // Berita situs: admin mengelola, peran lain membaca (sama dengan halaman depan).
      berita: (c) => (user.role === 'admin' ? NewsAdmin.render(c, user) : NewsPublic.mountDashboard(c, user)),
      // Tools seleksi masuk kampus (js/ptn.js): kalkulator & kalender untuk semua peran, data PTN khusus admin.
      'kalkulator-utbk': (c) => UtbkCalc.render(c, user),
      'kalender-seleksi': (c) => AdmissionCal.render(c, user),
      'data-ptn': (c) => PtnAdmin.render(c, user),
      grup: (c) => Groups.render(c, user),
      // Ruang Belajar ala YPT (js/study-room.js): timer, ruang kelas, peringkat, rekap.
      'ruang-belajar': (c) => StudyRoom.render(c, user)
    };

    /* ================= Routing ================= */
    let currentKey = 'overview';
    function navigate(key, opts) {
      const quiet = !!(opts && opts.quiet);
      const keepY = quiet ? window.scrollY : 0;
      const keepUi = quiet && key === currentKey ? captureUiState(document.getElementById('content')) : [];
      if (key !== currentKey) refreshDue = false;      // halaman baru selalu digambar dari data terbaru
      currentKey = key;
      document.querySelectorAll('.side-nav a').forEach(a => {
        const on = a.dataset.key === key;
        a.classList.toggle('active', on);
        if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      document.querySelectorAll('#bottomNav [data-bn]').forEach(b => {
        const on = b.dataset.bn === key;
        b.classList.toggle('is-active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      const navItem = (NAVS[user.role] || []).find(n => n.key === key);
      document.getElementById('pageTitle').textContent = navItem ? navItem.label : 'Dashboard';
      const content = document.getElementById('content');
      if (window.WbHub) WbHub.destroy();
      // Ruang pribadi Mesin Waktu terkunci kembali setiap kali halaman ditinggalkan.
      if (window.TimeCapsule) TimeCapsule.lock();
      if (window.Arena) Arena.stop();
      if (window.Games) Games.stop();
      if (window.GamesAdmin) GamesAdmin.stop();
      if (window.StudyRoom) StudyRoom.stop();
      if (window.CourseHub && key !== 'course' && key !== 'course-admin' && key !== 'course-tutor') CourseHub.reset();
      if (content.__presenceDispose) {
        content.__presenceDispose();
        delete content.__presenceDispose;
      }
      if (content.__pushObs) { content.__pushObs.disconnect(); delete content.__pushObs; }
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
        if (key === 'overview') {
          mountQuickActions(content);
          if (window.Birthday) Birthday.mountBanner(content, user);
        }
      } catch (err) {
        console.error('[LMS] gagal merender halaman', key, err);
        content.innerHTML = `<div class="card"><div class="alert alert-error">
          Terjadi kesalahan saat membuka halaman ini. Silakan coba lagi.</div>
          <p class="muted small">${UI.esc(err.message || String(err))}</p></div>`;
      }
      // Notifikasi perangkat: kartu pengaturan di Profil (dan Pengaturan untuk admin).
      if (window.PushNotif && (key === 'profile' || (key === 'settings' && user.role === 'admin'))) mountPushCard(content);
      // Tema hari besar: kartu ucapan di Overview, partikel hero, akhiri pratinjau admin.
      if (window.HolidayTheme) {
        try { HolidayTheme.onNavigate(key, content, user); } catch (e) { console.warn('[LMS] tema hari besar', e); }
      }

      // Motion: replay the staggered entrance and wire up new nodes
      if (window.Effects) {
        if (!quiet) Effects.playPageEnter(content);
        Effects.enhance(content);
      }
      // Responsif: beri label kolom tabel & tandai area yang perlu digulir
      if (window.Responsive) Responsive.apply(content);
      if (window.Shared && Shared.bindMotivation) Shared.bindMotivation(content);
      if (keepUi.length) { try { restoreUiState(content, keepUi); } catch (e) { console.warn('[LMS] pulihkan tab', e); } }
      if (quiet) window.scrollTo(0, keepY);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /** Kartu "Notifikasi Perangkat" — dipasang ulang bila halaman merender dirinya sendiri. */
    function mountPushCard(content) {
      const put = () => {
        if (content.querySelector('#pushCard')) return;
        const box = document.createElement('div');
        box.className = 'push-card-wrap';
        box.innerHTML = PushNotif.cardHtml();
        content.insertBefore(box, content.firstChild);
        PushNotif.bindCard(box);
      };
      put();
      if ('MutationObserver' in window) {
        const obs = new MutationObserver(() => { if (!content.querySelector('#pushCard')) put(); });
        obs.observe(content, { childList: true });
        content.__pushObs = obs;
      }
    }

    /* ================= Pembaruan dari perangkat lain (mode server) =================
     * Data dari pengguna/perangkat lain langsung tersimpan di perangkat ini, lalu
     * halaman yang terbuka digambar ulang diam-diam (posisi gulir & tab aktif
     * dipertahankan) begitu pengguna tidak sedang mengisi formulir atau membuka
     * dialog. Pantulan perubahan sendiri (simpan, unggah) tidak memicu apa pun. */
    const SELF_LIVE = new Set(['chat', 'game-battle', 'game-admin', 'grup', 'ruang-belajar']);
    // Data yang hanya berarti di halaman tertentu; lonceng & avatar diperbarui terpisah.
    const PAGE_KEYS = {
      lms_notifications: ['notifikasi'], lms_activity_log: ['notifikasi'], lms_birthday_notified: [],
      lms_messages: [], lms_ai_chats: ['ai-asisten'], lms_whiteboard_boards: [],
      lms_game_rooms: [], lms_game_players: [], lms_game_battles: [], lms_game_scores: ['leaderboard'],
      lms_study_sessions: [], lms_study_goals: [],
      lms_learning_log: ['streak', 'streak-admin', 'streak-siswa', 'anak-streak', 'leaderboard', 'overview']
    };
    let lastInputAt = 0;
    let liveTimer = null;
    let refreshDue = false;
    ['input', 'change', 'keydown', 'pointerdown'].forEach(ev =>
      document.addEventListener(ev, () => { lastInputAt = Date.now(); }, { capture: true, passive: true }));
    function interactionBusy() {
      if (document.body.classList.contains('exam-mode') || document.getElementById('loginQuizGate')) return true;
      if (!document.getElementById('genericModal').classList.contains('hidden')) return true;
      if (document.querySelector('.qe-workspace, .cbt-workspace, .qe-dialog-back, details.act-menu[open], .wb-text-input, .rte-pop.is-open')) return true;
      const a = document.activeElement;
      if (a && a !== document.body && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]), textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
      if (window.getSelection && String(window.getSelection() || '').trim()) return true;
      return Date.now() - lastInputAt < 6000;
    }
    function scheduleLiveRefresh(ms) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        if (!refreshDue) return;
        if (SELF_LIVE.has(currentKey) || document.querySelector('#content .wbh, #content .wb-pro, #content .tc-root')) { refreshDue = false; return; }
        if (document.hidden || interactionBusy()) { scheduleLiveRefresh(1500); return; }
        refreshDue = false;
        navigate(currentKey, { quiet: true });
      }, ms);
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden && refreshDue) scheduleLiveRefresh(300); });
    function onRemoteChange(keys, foreign) {
      renderBell();
      renderAvatar();
      if (keys.includes('lms_settings') && window.Branding) Branding.apply();
      if (keys.includes('lms_settings') && window.HolidayTheme) HolidayTheme.refresh();
      if (keys.includes('lms_users')) {
        const fresh = DB.getUser(user.id);
        if (fresh) { document.getElementById('userName').textContent = fresh.name; }
      }
      const relevant = foreign.filter(k => !PAGE_KEYS[k] || PAGE_KEYS[k].includes(currentKey));
      if (!relevant.length || SELF_LIVE.has(currentKey)) return;
      // Whiteboard & Mesin Waktu menggabungkan pembaruan sendiri tanpa menggambar ulang halaman.
      if (document.querySelector('#content .wbh, #content .wb-pro, #content .tc-root')) return;
      refreshDue = true;
      scheduleLiveRefresh(700);
    }
    if (window.Sync && Sync.isServer()) {
      window.addEventListener('lms:remote-change', (e) => {
        const d = e.detail || {};
        onRemoteChange(d.keys || [], d.foreign || d.keys || []);
      });
    }

    /* Tab/subtab aktif di halaman: digambar ulang diam-diam tanpa kembali ke tab bawaan. */
    const UI_STATE_SEL = '.subtab-btn.active, .tab-btn.active, .class-chip.is-active, .wbh-seg .is-on, [role="tab"][aria-selected="true"]';
    function captureUiState(root) {
      const out = [];
      root.querySelectorAll(UI_STATE_SEL).forEach(el => {
        const a = [...el.attributes].find(x => /^data-/.test(x.name) && x.value && x.name !== 'data-tip');
        if (a) out.push([a.name, a.value]);
      });
      return out;
    }
    function restoreUiState(root, saved) {
      saved.forEach(([name, value]) => {
        let el = null;
        try { el = root.querySelector(`[${name}="${CSS.escape(value)}"]`); } catch (e) { el = null; }
        if (el && !el.matches(UI_STATE_SEL) && !el.disabled) el.click();
      });
    }

    /* ================= Riwayat notifikasi & aktivitas ================= */
    // Admin & tutor membuka Ruang Perhatian lebih dulu (js/attention.js).
    const staffNotif = (user.role === 'admin' || user.role === 'guru') && !!window.Attention;
    let notifTab = staffNotif ? 'perhatian' : 'notif';
    function renderNotifHistory(container) {
      const isAdmin = user.role === 'admin';
      const tabs = [];
      if (staffNotif) tabs.push(['perhatian', 'Perlu Ditindaklanjuti']);
      if (staffNotif || isAdmin) tabs.push(['notif', 'Notifikasi Saya']);
      if (isAdmin) tabs.push(['log', 'Riwayat Aktivitas']);
      const tab = tabs.some(t => t[0] === notifTab) ? notifTab : 'notif';
      const attCount = staffNotif ? Attention.count(user) : 0;
      container.innerHTML = `
        ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" class="tab-btn ${tab === k ? 'active' : ''}" data-ntab="${k}">${l}${k === 'perhatian' && attCount ? ` <span class="tab-count">${attCount > 99 ? '99+' : attCount}</span>` : ''}</button>`).join('')}</div>` : ''}
        ${tab === 'perhatian' ? '<div class="card" id="attRoom"></div>' : `
        <div class="card">
          <div class="card-header">
            ${UI.secHead(tab === 'log' ? '🧾' : '🔔', tab === 'log' ? 'Riwayat Aktivitas' : 'Riwayat Notifikasi',
              tab === 'log' ? 'perubahan akun, pengaturan, dan moderasi (1000 entri terbaru)' : 'semua notifikasi yang Anda terima')}
            ${tab === 'notif' ? `<div class="flex-gap">
              <button type="button" class="btn btn-sm btn-secondary" id="nhRead">Tandai semua dibaca</button>
              <button type="button" class="btn btn-sm btn-danger" id="nhClear">Bersihkan</button></div>` : ''}
          </div>
          <div id="nhList"></div>
        </div>`}`;
      container.querySelectorAll('[data-ntab]').forEach(b => b.addEventListener('click', () => {
        notifTab = b.dataset.ntab; renderNotifHistory(container);
      }));
      const box = container.querySelector('#nhList');
      if (tab === 'perhatian') {
        Attention.render(container.querySelector('#attRoom'), user);
        return;
      }
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
      const mb = document.getElementById('menuBtn');
      if (mb) mb.setAttribute('aria-expanded', 'true');
      const cur = document.querySelector('.side-nav a.active') || document.querySelector('.side-nav a');
      if (cur) setTimeout(() => { try { cur.focus({ preventScroll: false }); } catch (e) { /* noop */ } }, 60);
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.className = 'sidebar-scrim';
        scrim.addEventListener('click', closeSidebar);
        document.body.appendChild(scrim);
      }
    }
    function closeSidebar() {
      document.getElementById('sidebar').classList.remove('open');
      const mb = document.getElementById('menuBtn');
      if (mb) mb.setAttribute('aria-expanded', 'false');
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
      if (window.WbHub) WbHub.destroy();
      UI.modal.close();
    }
    document.getElementById('modalClose').addEventListener('click', closeGenericModal);
    genericModal.addEventListener('click', (e) => { if (e.target === genericModal) closeGenericModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !genericModal.classList.contains('hidden')) closeGenericModal();
      else if (e.key === 'Escape' && document.getElementById('sidebar').classList.contains('open')) closeSidebar();
    });

    // Expose SEBELUM ticker pertama dirender agar tombol papan berjalan hidup
    // sejak paint awal, bukan baru setelah pengumuman berubah.
    window.Dashboard = {
      navigate,
      currentUser: user,
      refreshNotifications: renderBell,
      refreshAvatar: renderAvatar,
      hasSection: (key) => (NAVS[user.role] || []).some(n => n.key === key),
      currentSection: () => currentKey,
      refresh: () => navigate(currentKey, { quiet: true })
    };

    /* Indikator penyimpanan di topbar (mode server): menghitung lama penyimpanan
     * secara langsung ("Menyimpan 0.8 detik") sampai server mengonfirmasi, lalu
     * menampilkan hasilnya sebentar ("Tersimpan 1.2 detik"). */
    let syncTicker = null;
    let syncShown = '';
    const SAVED_HOLD = 4000;
    const fmtSec = (ms) => (Math.max(0, ms) / 1000).toFixed(1) + ' detik';
    function renderSyncBadge(st) {
      const el = document.getElementById('syncBadge');
      if (!el) return;
      const t = Date.now();
      const justSaved = st.lastSaveAt && t - st.lastSaveAt < SAVED_HOLD;
      let cls = 'ok', label = 'Tersinkron', time = '', tip = 'Semua data tersimpan di server.';
      if (!st.online) {
        cls = 'off'; label = 'Offline';
        tip = st.saving ? 'Tidak ada koneksi. Perubahan aman di perangkat ini dan dikirim otomatis saat online.' : 'Tidak ada koneksi.';
      } else if (st.saving && st.error) {
        cls = 'err'; label = 'Mencoba lagi'; time = fmtSec(t - st.saveStartedAt); tip = st.error + ' Perubahan dikirim ulang otomatis.';
      } else if (st.saving) {
        cls = 'busy'; label = 'Menyimpan'; time = fmtSec(t - st.saveStartedAt);
        tip = st.uploads ? 'Mengunggah berkas ke server…' : 'Mengirim perubahan ke server…';
      } else if (st.error) {
        cls = 'err'; label = 'Gagal sinkron'; tip = st.error;
      } else if (justSaved) {
        cls = 'saved'; label = 'Tersimpan'; time = fmtSec(st.lastSaveMs); tip = `Tersimpan di server dalam ${fmtSec(st.lastSaveMs)}.`;
      }
      if (st.lastSync) tip += ' Sinkron terakhir: ' + new Date(st.lastSync).toLocaleTimeString('id-ID');
      tip += st.realtime ? ' • Realtime aktif' : ' • Pembaruan berkala';
      const key = cls + '|' + label;
      if (key !== syncShown) {
        syncShown = key;
        el.className = 'sync-badge is-' + cls;
        el.innerHTML = `<span class="sync-dot" aria-hidden="true"></span><span class="sync-label">${UI.esc(label)}</span><span class="sync-time" aria-hidden="true"></span>`;
        el.setAttribute('aria-label', label + (time && cls === 'saved' ? ' dalam ' + time : ''));
      }
      el.title = tip;
      el.querySelector('.sync-time').textContent = time;
      el.classList.toggle('has-time', !!time);
      // Jam berjalan selama menyimpan; setelah tersimpan, kembali ke "Tersinkron" otomatis.
      const live = st.saving || justSaved;
      if (live && !syncTicker) syncTicker = setInterval(() => renderSyncBadge(Sync.status()), 100);
      if (!live && syncTicker) { clearInterval(syncTicker); syncTicker = null; }
    }
    if (window.Sync && Sync.isServer()) {
      const slot = document.createElement('span');
      slot.id = 'syncBadge';
      slot.setAttribute('role', 'status');
      slot.setAttribute('aria-live', 'polite');
      const right = document.querySelector('.topbar-right');
      if (right) right.insertBefore(slot, right.firstChild);
      renderSyncBadge(Sync.status());
      Sync.onStatus(renderSyncBadge);
    }

    // Notifikasi ulang tahun dikirim sebelum lonceng pertama kali digambar.
    if (window.Birthday) { try { Birthday.ensureNotifications(); } catch (e) { console.warn('[LMS] notifikasi ulang tahun', e); } }
    // Streak: catat login harian (bukan aktivitas belajar) & pengingat sebelum streak putus.
    const streakTick = () => { if (window.StreakAPI) { try { StreakAPI.tick(user); } catch (e) { console.warn('[LMS] streak', e); } } };
    streakTick();
    setInterval(streakTick, 5 * 60 * 1000);
    // Kalender Seleksi: pengingat H-3 sebelum mulai & H-1 sebelum ditutup untuk jadwal yang diikuti.
    const admissionTick = () => { if (window.AdmissionCal) { try { if (AdmissionCal.tick(user)) renderBell(); } catch (e) { console.warn('[LMS] pengingat seleksi', e); } } };
    admissionTick();
    setInterval(admissionTick, 30 * 60 * 1000);
    if (user.role === 'siswa') { try { DB.notifyReadyCapsules(user.id); } catch (e) { console.warn('[LMS] mesin waktu', e); } }
    // Course Mandiri: keluarkan otomatis peserta yang tidak aktif (admin: semua; mentee: miliknya).
    if ((user.role === 'admin' || user.role === 'siswa') && window.CourseHub && CourseHub.sweep) CourseHub.sweep(user);
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
    if (window.Presence) {
      Presence.start(user);
      renderPresenceBadge();
      Presence.subscribe(renderPresenceBadge);
    }

    // Jawaban aman saat sinyal putus: pulihkan jurnal perangkat & siapkan salinan halaman offline.
    if (window.SafeSave) { try { SafeSave.init(user); } catch (e) { console.warn('[LMS] simpan aman', e); } }
    // Ruang Belajar: timer tetap berjalan & waktu aktif di LMS dihitung di halaman mana pun (mentee).
    if (window.StudyRoom) { try { StudyRoom.init(user); } catch (e) { console.warn('[LMS] ruang belajar', e); } }

    navigate('overview');
    // Notifikasi perangkat (Web Push): daftarkan service worker, pulihkan langganan, ajakan aktifkan.
    if (window.PushNotif) { try { PushNotif.init(user); } catch (e) { console.warn('[LMS] notifikasi perangkat', e); } }
    // Game Battle: kartu undangan battle muncul di halaman mana pun (siswa).
    if (window.Games) { try { Games.init(user); } catch (e) { console.warn('[LMS] game battle', e); } }
    // Judul kelas lama memuat nama tutor; admin merapikannya sekali (tersinkron ke semua perangkat).
    if (user.role === 'admin' && DB.tidyCourseTitles) { try { DB.tidyCourseTitles(); } catch (e) { console.warn('[LMS] judul kelas', e); } }
    // Mentee yang dulu ditambahkan dengan kelas utama tetapi belum masuk kelas subtestnya (bug lama): diperbaiki sekali.
    if (user.role === 'admin' && DB.getSettings().enrollRepair !== 1) {
      try { const n = DB.repairMainClassEnrollments(); DB.setSetting('enrollRepair', 1); if (n) UI.toast(`${n} pendaftaran kelas subtest yang terlewat sudah ditambahkan otomatis.`, 'info'); }
      catch (e) { console.warn('[LMS] perbaikan pendaftaran', e); }
    }
    // Musik latar hidup di shell sehingga tidak dimulai ulang saat berpindah menu.
    if (window.Music) { try { Music.init(user); } catch (e) { console.warn('[LMS] musik', e); } }

    // Greet the user once per session
    UI.toast(`${UI.greeting()}, ${user.name.split(' ')[0]}! 👋`, 'info');

    // Dashboard API sudah diekspor sebelum inisialisasi ticker.
  }

  if (window.Sync && typeof Sync.boot === 'function') Sync.boot().then(main);
  else main();
})();
