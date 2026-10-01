/* =====================================================================
 * js/presence.js — status online lokal, heartbeat, dan sinkronisasi tab
 * ---------------------------------------------------------------------
 * LMS Rubela saat ini tidak memiliki backend. Presence ini akurat untuk
 * tab/window pada browser profile + origin yang sama. Untuk lintas perangkat
 * perlu backend realtime (WebSocket/SSE). Tidak mengumpulkan alamat IP.
 * ===================================================================*/
(function (global) {
  'use strict';

  const KEY = 'lms_presence_v1';
  const CHANNEL = 'lms-presence-v1';
  const HEARTBEAT_MS = 15000;
  const TTL_MS = 50000;
  const AWAY_AFTER_MS = 30000;

  let currentUser = null;
  let resumeUser = null;
  let currentPage = 'overview';
  let timer = null;
  let channel = null;
  let listeners = [];
  let lastActivity = Date.now();
  let started = false;
  const tabId = getTabId();

  function getTabId() {
    try {
      let id = sessionStorage.getItem('lms_presence_tab');
      if (!id) {
        id = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem('lms_presence_tab', id);
      }
      return id;
    } catch (e) {
      return 'tab_' + Math.random().toString(36).slice(2, 10);
    }
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function save(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); return true; }
    catch (e) { return false; }
  }

  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    let browser = 'Browser';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/OPR\//.test(ua)) browser = 'Opera';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua)) browser = 'Safari';
    let os = 'Perangkat';
    if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS/iPadOS';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    return { browser, os, device: mobile ? 'Ponsel/Tablet' : 'Komputer' };
  }

  function prune(map, now) {
    const t = now || Date.now();
    Object.keys(map).forEach(k => {
      const r = map[k];
      if (!r || !r.lastSeen || t - r.lastSeen > TTL_MS * 4) delete map[k];
    });
    return map;
  }

  function stateOf(record, now) {
    const t = now || Date.now();
    if (!record || t - record.lastSeen > TTL_MS) return 'offline';
    if (record.visibility === 'hidden' || t - (record.lastActivity || 0) > AWAY_AFTER_MS) return 'away';
    return 'online';
  }

  function heartbeat(forceNotify) {
    if (!currentUser) return;
    const now = Date.now();
    const map = prune(load(), now);
    const info = deviceInfo();
    map[tabId] = {
      tabId,
      userId: currentUser.id,
      page: currentPage,
      lastSeen: now,
      lastActivity,
      visibility: document.visibilityState || 'visible',
      browser: info.browser,
      os: info.os,
      device: info.device
    };
    save(map);
    if (channel) {
      try { channel.postMessage({ type: 'heartbeat', tabId, at: now }); } catch (e) { /* fallback storage */ }
    }
    if (forceNotify) notify();
  }

  function touch() {
    const now = Date.now();
    // Batasi write saat pointer/keyboard sangat aktif.
    if (now - lastActivity > 4000) {
      lastActivity = now;
      heartbeat(true);
    } else {
      lastActivity = now;
    }
  }

  function start(user) {
    if (!user) return;
    if (started && currentUser && currentUser.id === user.id) return;
    stop(false);
    currentUser = user;
    resumeUser = user;
    started = true;
    lastActivity = Date.now();
    if ('BroadcastChannel' in global) {
      try {
        channel = new BroadcastChannel(CHANNEL);
        channel.addEventListener('message', notify);
      } catch (e) { channel = null; }
    }
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    global.addEventListener('storage', onStorage);
    global.addEventListener('pagehide', onPageHide);
    heartbeat(true);
    timer = setInterval(() => heartbeat(true), HEARTBEAT_MS);
  }

  function stop(removeRecord) {
    if (timer) clearInterval(timer);
    timer = null;
    if (channel) { try { channel.close(); } catch (e) {} }
    channel = null;
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev =>
      document.removeEventListener(ev, touch));
    document.removeEventListener('visibilitychange', onVisibility);
    global.removeEventListener('storage', onStorage);
    global.removeEventListener('pagehide', onPageHide);
    if (removeRecord !== false) {
      const map = load();
      delete map[tabId];
      save(map);
    }
    started = false;
    currentUser = null;
    notify();
  }

  function onVisibility() { heartbeat(true); }
  function onPageHide() {
    resumeUser = currentUser;
    stop(true);
  }
  function onPageShow(e) {
    if (!e.persisted || started) return;
    const session = Auth.getSession();
    const user = session && DB.getUser(session.id);
    if (user && (!resumeUser || resumeUser.id === user.id)) start(user);
  }
  function onStorage(e) {
    if (e.key === KEY) notify();
    if (e.key === 'lms_session') {
      try {
        const s = e.newValue ? JSON.parse(e.newValue) : null;
        if (!s || (currentUser && s.id !== currentUser.id)) stop(true);
      } catch (err) { stop(true); }
    }
  }

  function setPage(page) {
    currentPage = page || 'overview';
    heartbeat(true);
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => { listeners = listeners.filter(x => x !== fn); };
  }

  function notify() {
    const snapshot = getAll();
    listeners.slice().forEach(fn => { try { fn(snapshot); } catch (e) { console.error(e); } });
  }

  /** Satu row per user; bila banyak tab, ambil tab paling baru. */
  function getAll() {
    const now = Date.now();
    const map = prune(load(), now);
    const byUser = {};
    Object.values(map).forEach(r => {
      if (stateOf(r, now) === 'offline') return;
      if (!DB.getUser(r.userId)) return;
      if (!byUser[r.userId] || r.lastSeen > byUser[r.userId].lastSeen) byUser[r.userId] = r;
    });
    return Object.values(byUser).map(r => Object.assign({}, r, {
      state: stateOf(r, now),
      user: DB.getUser(r.userId)
    })).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  function visibleTo(viewer) {
    const all = getAll();
    if (!viewer || viewer.role === 'admin') return all;
    if (viewer.role !== 'guru') return all.filter(r => r.userId === viewer.id);
    const courseIds = new Set(DB.getCoursesByTeacher(viewer.id).map(c => c.id));
    const visibleIds = new Set([viewer.id]);
    DB.getCourses().forEach(c => {
      if (!courseIds.has(c.id)) return;
      DB.courseTeacherIds(c).forEach(id => visibleIds.add(id));
      DB.getEnrollmentsByCourse(c.id).forEach(e => visibleIds.add(e.studentId));
    });
    return all.filter(r => visibleIds.has(r.userId));
  }

  function stateLabel(state) {
    return state === 'online' ? 'Aktif' : (state === 'away' ? 'Menjauh' : 'Offline');
  }

  function pageLabel(key) {
    const labels = {
      overview: 'Overview', courses: 'Kelas', 'my-courses': 'Kelas Saya',
      cbt: 'CBT / Ujian', 'admin-cbt': 'CBT / Ujian', assignments: 'Tugas',
      grading: 'Penilaian Tugas', chat: 'Chat', pengumuman: 'Pengumuman',
      kalender: 'Kalender', attendance: 'Presensi', absensi: 'Presensi',
      'jadwal-kelas': 'Jadwal Kelas', 'jadwal-siswa': 'Jadwal Kelas',
      'ai-tools': 'AI Tools', 'ai-analytics': 'AI Analytics', online: 'Status Online'
    };
    return labels[key] || String(key || '-').replace(/-/g, ' ');
  }

  function renderPanel(container, viewer) {
    const paint = () => {
      const list = visibleTo(viewer);
      const active = list.filter(x => x.state === 'online').length;
      const away = list.filter(x => x.state === 'away').length;
      container.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card accent-success"><div class="label">Aktif sekarang</div><div class="value">${active}</div><div class="sub">sedang memakai LMS</div></div>
          <div class="stat-card accent-warning"><div class="label">Menjauh</div><div class="value">${away}</div><div class="sub">tab tersembunyi/tidak aktif</div></div>
          <div class="stat-card accent-primary"><div class="label">Terlihat oleh Anda</div><div class="value">${list.length}</div><div class="sub">pengguna unik, bukan jumlah tab</div></div>
        </div>
        <div class="card">
          <div class="card-header"><div><h3>🟢 Siapa yang Sedang Online</h3>
            <p class="muted small" style="margin:4px 0 0;">Diperbarui otomatis. ${viewer.role === 'guru' ? 'Hanya tutor dan siswa pada kelas yang Anda ampu.' : 'Seluruh pengguna yang aktif pada lingkungan LMS ini.'}</p></div>
            <span class="badge badge-gray">Heartbeat 15 detik</span>
          </div>
          <div class="alert alert-info small"><strong>Privasi & cakupan:</strong> LMS tidak mengambil alamat IP. Yang ditampilkan hanya perangkat/browser, halaman aktif, dan waktu aktivitas. Karena belum ada backend, status ini tersinkron antar-tab pada browser/origin yang sama; status lintas perangkat memerlukan server realtime.</div>
          ${list.length ? `<div class="online-grid">${list.map(r => `
            <article class="online-card">
              <span class="presence-dot ${r.state}" aria-label="${stateLabel(r.state)}"></span>
              <div class="online-avatar">${UI.initials(r.user.name)}</div>
              <div class="online-main"><strong>${UI.esc(r.user.name)}</strong>
                <span>${UI.esc(Auth.ROLE_LABELS[r.user.role] || r.user.role)} • ${UI.esc(pageLabel(r.page))}</span>
                <small>${UI.esc(r.device)} • ${UI.esc(r.browser)} / ${UI.esc(r.os)} • ${UI.fmtRelative(r.lastSeen)}</small>
              </div>
              <span class="badge ${r.state === 'online' ? 'badge-success' : 'badge-warning'}">${stateLabel(r.state)}</span>
            </article>`).join('')}</div>`
            : '<div class="empty"><div class="empty-icon">🌙</div>Belum ada pengguna aktif yang terlihat.</div>'}
        </div>`;
      if (global.Responsive) Responsive.apply(container);
    };
    paint();
    const off = subscribe(paint);
    container.__presenceDispose = off;
  }

  global.addEventListener('pageshow', onPageShow);

  global.Presence = {
    KEY, HEARTBEAT_MS, TTL_MS,
    start, stop, setPage, subscribe, getAll, visibleTo,
    renderPanel, stateLabel, pageLabel, deviceInfo,
    _heartbeat: heartbeat
  };
})(window);
