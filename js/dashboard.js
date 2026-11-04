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
        { key: 'guru', label: 'Kelola Guru', icon: '👨‍🏫', group: 'Pengguna' },
        { key: 'siswa', label: 'Kelola Siswa', icon: '👨‍🎓', group: 'Pengguna' },
        { key: 'orangtua', label: 'Kelola Orang Tua', icon: '👨‍👩‍👦', group: 'Pengguna' },
        { key: 'staff', label: 'Admin & Staff', icon: '🛡️', group: 'Pengguna' },
        { key: 'courses', label: 'Semua Kelas', icon: '📚', group: 'Akademik' },
        { key: 'course-admin', label: 'Course Mandiri', icon: '🎓', group: 'Akademik' },
        { key: 'pusat-konten', label: 'Pusat Konten', icon: '📦', group: 'Akademik' },
        { key: 'jadwal-kelas', label: 'Jadwal Kelas', icon: '🗓️', group: 'Akademik' },
        { key: 'attendance', label: 'Presensi', icon: '📋', group: 'Akademik' },
        { key: 'admin-cbt', label: 'CBT / Ujian', icon: '🖥️', group: 'Akademik' },
        { key: 'admin-bank-soal', label: 'Bank Soal', icon: '📝', group: 'Akademik' },
        { key: 'rekap', label: 'Rekapan', icon: '📈', group: 'Akademik' },
        { key: 'batch', label: 'Tahun Akademik', icon: '🎓', group: 'Akademik' },
        { key: 'alumni', label: 'Alumni', icon: '🏛️', group: 'Akademik' },
        { key: 'streak-admin', label: 'Streak & Gamifikasi', icon: '🔥', group: 'Motivasi & Gamifikasi' },
        { key: 'arena-admin', label: 'Arena Belajar', icon: '🎮', group: 'Motivasi & Gamifikasi' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆', group: 'Motivasi & Gamifikasi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Motivasi & Gamifikasi' },
        { key: 'motivasi', label: 'Kata Motivasi', icon: '💡', group: 'Motivasi & Gamifikasi' },
        { key: 'ayat-admin', label: 'Ayat Harian', icon: '📖', group: 'Motivasi & Gamifikasi' },
        { key: 'mesin-waktu-admin', label: 'Mesin Waktu', icon: '⏳', group: 'Motivasi & Gamifikasi' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Keuangan', icon: '💰', group: 'Operasional' },
        { key: 'musik', label: 'Musik Latar', icon: '🎵', group: 'Operasional' },
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
        { key: 'rekap', label: 'Rekapan Kelas', icon: '📈', group: 'Siswa & Laporan' },
        { key: 'streak-siswa', label: 'Streak Siswa', icon: '🔥', group: 'Siswa & Laporan' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🏆', group: 'Siswa & Laporan' },
        { key: 'ai-asisten', label: 'Asisten AI', icon: '💬', group: 'Siswa & Laporan' },
        { key: 'ai-analytics', label: 'AI Analytics', icon: '🤖', group: 'Siswa & Laporan' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Honor Saya', icon: '💰', group: 'Akun' },
        { key: 'profile', label: 'Profil', icon: '👤', group: 'Akun' }
      ],
      siswa: [
        { key: 'overview', label: 'Overview', icon: '📊', group: 'Utama' },
        { key: 'notifikasi', label: 'Notifikasi', icon: '🔔', group: 'Utama' },
        { key: 'my-courses', label: 'Kelas Saya', icon: '📚', group: 'Belajar' },
        { key: 'course', label: 'Course', icon: '🎓', group: 'Belajar' },
        { key: 'browse', label: 'Jelajah Kelas', icon: '🔎', group: 'Belajar' },
        { key: 'modul', label: 'Modul', icon: '📘', group: 'Belajar' },
        { key: 'rekaman', label: 'Rekaman Kelas', icon: '🎥', group: 'Belajar' },
        { key: 'assignments', label: 'Tugas', icon: '📝', group: 'Belajar' },
        { key: 'cbt', label: 'CBT / Ujian', icon: '🖥️', group: 'Belajar' },
        { key: 'grades', label: 'Nilai', icon: '🏆', group: 'Belajar' },
        { key: 'streak', label: 'Streak Belajar', icon: '🔥', group: 'Gamifikasi' },
        { key: 'arena', label: 'Arena Belajar', icon: '🎮', group: 'Gamifikasi' },
        { key: 'leaderboard', label: 'Papan Peringkat', icon: '🥇', group: 'Gamifikasi' },
        { key: 'jadwal-siswa', label: 'Jadwal Kelas', icon: '🗓️', group: 'Jadwal & Kehadiran' },
        { key: 'absensi', label: 'Presensi Saya', icon: '📋', group: 'Jadwal & Kehadiran' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Jadwal & Kehadiran' },
        { key: 'mesin-waktu', label: 'Mesin Waktu', icon: '⏳', group: 'Ruang Pribadi' },
        { key: 'ayat', label: 'Ayat Harian', icon: '📖', group: 'Ruang Pribadi' },
        { key: 'ai-tools', label: 'AI Tools', icon: '🤖', group: 'Ruang Pribadi' },
        { key: 'birthday', label: 'Ulang Tahun', icon: '🎂', group: 'Ruang Pribadi' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat', icon: '💭', group: 'Komunikasi' },
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
        { key: 'anak-kelas', label: 'Kelas & Guru', icon: '📚', group: 'Pantau Anak' },
        { key: 'anak-course', label: 'Course Anak', icon: '🎓', group: 'Pantau Anak' },
        { key: 'anak-jadwal', label: 'Jadwal Kelas', icon: '🗓️', group: 'Pantau Anak' },
        { key: 'anak-perkembangan', label: 'Perkembangan', icon: '📈', group: 'Pantau Anak' },
        { key: 'anak-streak', label: 'Streak Anak', icon: '🔥', group: 'Pantau Anak' },
        { key: 'birthday', label: 'Ulang Tahun Anak', icon: '🎂', group: 'Pantau Anak' },
        { key: 'pengumuman', label: 'Pengumuman', icon: '📢', group: 'Komunikasi' },
        { key: 'kalender', label: 'Kalender', icon: '📅', group: 'Komunikasi' },
        { key: 'chat', label: 'Chat Guru', icon: '💭', group: 'Komunikasi' },
        { key: 'feedback', label: 'Kritik & Saran', icon: '💬', group: 'Komunikasi' },
        { key: 'keuangan', label: 'Pembayaran', icon: '💰', group: 'Akun' },
        { key: 'profile', label: 'Profil', icon: '👤', group: 'Akun' }
      ]
    };

    /* Navigasi bawah ponsel: menu yang paling sering dipakai tiap peran + "Menu". */
    const BOTTOM_NAV = {
      admin: [['overview', 'Beranda'], ['siswa', 'Siswa'], ['courses', 'Kelas'], ['attendance', 'Presensi']],
      guru: [['overview', 'Beranda'], ['courses', 'Kelas'], ['absensi', 'Presensi'], ['grading', 'Nilai']],
      siswa: [['overview', 'Beranda'], ['my-courses', 'Kelas'], ['streak', 'Streak'], ['assignments', 'Tugas']],
      orangtua: [['overview', 'Beranda'], ['anak-nilai', 'Nilai'], ['anak-absensi', 'Hadir'], ['anak-tugas', 'Tugas']]
    };

    /* Aksi cepat di Overview — hanya menu yang memang tersedia bagi peran itu. */
    const QUICK_ACTIONS = {
      admin: [['attendance', 'Ambil presensi', 'Isi kehadiran hari ini'], ['siswa', 'Tambah siswa', 'Kelola akun mentee'],
        ['courses', 'Kelola kelas', 'Tutor, jadwal & siswa'], ['admin-cbt', 'Buat ujian', 'CBT & tryout'],
        ['pengumuman', 'Pengumuman', 'Kirim info penting'], ['keuangan', 'Keuangan', 'Pemasukan & gaji']],
      guru: [['absensi', 'Ambil presensi', 'Kelas hari ini'], ['grading', 'Nilai tugas', 'Submission menunggu'],
        ['jadwal-kelas', 'Jadwal', 'Validasi pertemuan'], ['cbt', 'Buat ujian', 'CBT kelas'],
        ['modul', 'Modul', 'Materi berbagian'], ['chat', 'Chat', 'Pesan siswa & admin']],
      siswa: [['arena', 'Tantangan harian', 'Nyalakan streak'], ['assignments', 'Tugas', 'Kerjakan sebelum deadline'],
        ['cbt', 'Tryout / CBT', 'Ujian tersedia'], ['jadwal-siswa', 'Jadwal kelas', 'Masuk Zoom/Meet'],
        ['course', 'Course', 'Belajar mandiri'], ['mesin-waktu', 'Mesin Waktu', 'Surat untuk masa depan']],
      orangtua: [['anak-nilai', 'Nilai & ujian', 'Hasil terbaru'], ['anak-absensi', 'Kehadiran', 'Persentase hadir'],
        ['anak-tugas', 'Tugas', 'Status pengumpulan'], ['anak-jadwal', 'Jadwal', 'Kelas minggu ini'],
        ['keuangan', 'Pembayaran', 'Tagihan & riwayat'], ['chat', 'Chat guru', 'Hubungi tutor']]
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
      if (fresh.photo) el.innerHTML = `<img src="${UI.esc(fresh.photo)}" alt="" />`;
      else el.textContent = UI.initials(fresh.name);
    }

    /* Halaman lintas peran yang dirender langsung oleh shell. */
    const COMMON = {
      birthday: (c) => Birthday.renderWall(c, user),
      notifikasi: (c) => renderNotifHistory(c)
    };

    /* ================= Routing ================= */
    let currentKey = 'overview';
    function navigate(key, opts) {
      const quiet = !!(opts && opts.quiet);
      const keepY = quiet ? window.scrollY : 0;
      currentKey = key;
      hideLiveChip();
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

      // Motion: replay the staggered entrance and wire up new nodes
      if (window.Effects) {
        if (!quiet) Effects.playPageEnter(content);
        Effects.enhance(content);
      }
      // Responsif: beri label kolom tabel & tandai area yang perlu digulir
      if (window.Responsive) Responsive.apply(content);
      if (window.Shared && Shared.bindMotivation) Shared.bindMotivation(content);
      if (quiet) window.scrollTo(0, keepY);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* ================= Pembaruan dari perangkat lain (mode server) =================
     * Halaman ringkasan diperbarui otomatis; halaman lain menampilkan tombol
     * "Muat ulang" agar isian/tab yang sedang dibuka tidak tiba-tiba berubah. */
    const AUTO_REFRESH = new Set(['overview', 'notifikasi', 'pengumuman', 'kalender', 'online']);
    const SELF_LIVE = new Set(['chat']);
    let lastInputAt = 0;
    let liveTimer = null;
    let lastLiveAt = 0;
    document.getElementById('content').addEventListener('input', () => { lastInputAt = Date.now(); }, true);
    document.getElementById('content').addEventListener('change', () => { lastInputAt = Date.now(); }, true);
    function hideLiveChip() {
      const chip = document.getElementById('liveChip');
      if (chip) chip.remove();
    }
    function interactionBusy() {
      if (document.body.classList.contains('exam-mode') || document.getElementById('loginQuizGate')) return true;
      if (!document.getElementById('genericModal').classList.contains('hidden')) return true;
      const a = document.activeElement;
      const content = document.getElementById('content');
      if (a && content.contains(a) && a.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
      return Date.now() - lastInputAt < 20000;
    }
    function showLiveChip() {
      if (document.getElementById('liveChip')) return;
      const content = document.getElementById('content');
      const chip = document.createElement('div');
      chip.id = 'liveChip';
      chip.className = 'live-chip';
      chip.setAttribute('role', 'status');
      chip.innerHTML = '<span>🔄 Ada data baru dari perangkat lain.</span><button type="button" class="btn btn-primary btn-sm">Muat ulang</button><button type="button" class="icon-btn" aria-label="Tutup">&times;</button>';
      chip.querySelector('.btn').addEventListener('click', () => navigate(currentKey, { quiet: true }));
      chip.querySelector('.icon-btn').addEventListener('click', hideLiveChip);
      content.prepend(chip);
    }
    function onRemoteChange(keys) {
      renderBell();
      renderAvatar();
      if (keys.includes('lms_settings') && window.Branding) Branding.apply();
      if (keys.includes('lms_users')) {
        const fresh = DB.getUser(user.id);
        if (fresh) { document.getElementById('userName').textContent = fresh.name; }
      }
      const relevant = keys.filter(k => !['lms_birthday_notified', 'lms_activity_log'].includes(k) || currentKey === 'notifikasi');
      if (!relevant.length || SELF_LIVE.has(currentKey)) return;
      if (document.querySelector('#content .wb-root, #content .tc-root')) return;      // whiteboard & Mesin Waktu punya pembaruan sendiri
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        if (AUTO_REFRESH.has(currentKey) && !interactionBusy() && Date.now() - lastLiveAt > 3000) {
          lastLiveAt = Date.now();
          navigate(currentKey, { quiet: true });
        } else if (!document.body.classList.contains('exam-mode')) showLiveChip();
      }, 900);
    }
    if (window.Sync && Sync.isServer()) {
      window.addEventListener('lms:remote-change', (e) => onRemoteChange((e.detail && e.detail.keys) || []));
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
      if (window.Whiteboard) Whiteboard.destroy();
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

    /* Indikator sinkronisasi di topbar (mode server). */
    function renderSyncBadge(st) {
      const el = document.getElementById('syncBadge');
      if (!el) return;
      let cls = 'ok', label = 'Tersinkron', tip = 'Data tersimpan di server.';
      if (!st.online) { cls = 'off'; label = 'Offline'; tip = 'Tidak ada koneksi. Perubahan disimpan di perangkat dan dikirim saat online.'; }
      else if (st.error) { cls = 'err'; label = 'Gagal sinkron'; tip = st.error; }
      else if (st.syncing || st.pending) { cls = 'busy'; label = st.pending ? `Menyimpan (${st.pending})` : 'Menyinkron…'; tip = 'Mengirim/menarik perubahan.'; }
      if (st.lastSync) tip += ' Terakhir: ' + new Date(st.lastSync).toLocaleTimeString('id-ID');
      tip += st.realtime ? ' • Realtime aktif' : ' • Pembaruan berkala';
      el.className = 'sync-badge is-' + cls;
      el.title = tip;
      el.setAttribute('aria-label', label + '. ' + tip);
      el.innerHTML = `<span class="sync-dot" aria-hidden="true"></span><span class="sync-label">${UI.esc(label)}</span>`;
    }
    if (window.Sync && Sync.isServer()) {
      const slot = document.createElement('span');
      slot.id = 'syncBadge';
      slot.setAttribute('role', 'status');
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
  }

  if (window.Sync && typeof Sync.boot === 'function') Sync.boot().then(main);
  else main();
})();
