/* ===== LMS Rubela - Auth =====
 * Lapisan sesi di atas DB.
 * Mode server (js/sync.js): password diperiksa di server (/api/rubela),
 * sesi berisi token. Fungsi login/verify/registerSiswa mengembalikan Promise.
 * Mode lokal: perilaku lama (data & password di browser ini saja).
 */
(function (global) {
  const SESSION_KEY = 'lms_session';
  const serverMode = () => !!(global.Sync && Sync.isServer());

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      // Sesi lama (mode lokal) tidak berlaku di mode server.
      if (s && serverMode() && !s.token) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(user, token, exp) {
    if (serverMode() && token) { Sync.saveSession(user, token, exp); return; }
    const minimal = { id: user.id, username: user.username, role: user.role, name: user.name };
    localStorage.setItem(SESSION_KEY, JSON.stringify(minimal));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  const ROLE_LABELS = {
    admin: 'Admin', guru: 'Guru', siswa: 'Siswa', orangtua: 'Orang Tua'
  };

  /** Periksa kredensial TANPA membuat sesi (mode lokal). */
  function verifyLocal(username, password, role) {
    const user = DB.findUserByUsername(username);
    if (!user) return { ok: false, error: 'Username tidak ditemukan.' };
    if (user.password !== password) return { ok: false, error: 'Password salah.' };
    if (role && user.role !== role) {
      return { ok: false, error: `Akun ini terdaftar sebagai ${ROLE_LABELS[user.role] || user.role}, bukan ${ROLE_LABELS[role] || role}.` };
    }
    if ((user.status || 'Aktif') === 'Dikeluarkan') {
      return { ok: false, error: 'Akun ini sudah tidak aktif. Hubungi admin.' };
    }
    return { ok: true, user };
  }

  /**
   * Verifikasi password akun yang SEDANG MASUK (mis. pemulihan Mesin Waktu).
   * Mode server → Promise<{ ok, user, error }>.
   */
  function verify(username, password, role) {
    if (!serverMode()) return verifyLocal(username, password, role);
    const session = getSession();
    const me = session && DB.getUser(session.id);
    if (!me || String(me.username).toLowerCase() !== String(username || '').toLowerCase() || (role && me.role !== role)) {
      return Promise.resolve({ ok: false, error: 'Akun tidak sesuai dengan sesi yang sedang masuk.' });
    }
    return Sync.verifyPassword(password, 'identity')
      .then(match => (match ? { ok: true, user: me } : { ok: false, error: 'Password salah.' }))
      .catch(e => ({ ok: false, error: e.message || 'Verifikasi gagal.' }));
  }

  /** Apakah teks ini sama dengan password akun yang sedang masuk? (Promise<boolean>) */
  function matchesAccountPassword(text) {
    if (!serverMode()) {
      const s = getSession();
      const u = s && DB.getUser(s.id);
      return Promise.resolve(!!(u && u.password && u.password === text));
    }
    return Sync.verifyPassword(text, 'compare').catch(() => false);
  }

  /**
   * Mode lokal → { ok, user, error } (sinkron, sesi langsung dibuat).
   * Mode server → Promise<{ ok, token, user } | { ok, quiz } | { ok:false, error }>;
   *   sesi dibuat oleh pemanggil lewat Auth.setSession setelah verifikasi selesai.
   */
  function login(username, password, role) {
    if (serverMode()) return Sync.login(username, password, role);
    const result = verifyLocal(username, password, role);
    if (!result.ok) return result;
    setSession(result.user);
    return result;
  }

  function registerSiswa({ name, email, username, password, targetUniv, targetMajor, phone }) {
    if (!name || !email || !username || !password) return { ok: false, error: 'Semua field wajib diisi.' };
    if (password.length < 6) return { ok: false, error: 'Password minimal 6 karakter.' };
    if (serverMode()) return Sync.register({ name, email, username, password, targetUniv, targetMajor, phone });
    if (DB.findUserByUsername(username)) return { ok: false, error: 'Username sudah dipakai.' };
    const user = DB.addUser({
      id: DB.uid('u'), role: 'siswa', name, email, username, password,
      kelas: 'X-A', status: 'Aktif',
      // Dipakai sambutan dashboard: "Calon Mahasiswa <universitas impian>"
      targetUniv: (targetUniv || '').trim(),
      targetMajor: (targetMajor || '').trim(),
      phone: (phone || '').trim()
    });
    DB.addNotification({
      userId: user.id, type: 'info', icon: '🎉',
      title: 'Selamat datang di LMS Rubela!',
      body: 'Lengkapi profil dan mulai jelajahi kelas untuk menggapai kampus impianmu.',
      link: 'browse'
    });
    return { ok: true, user };
  }

  function requireAuth(allowedRoles) {
    const session = getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(session.role)) {
      window.location.href = 'index.html';
      return null;
    }
    // Re-validate against DB in case user was deleted
    const dbUser = DB.getUser(session.id);
    if (!dbUser) {
      clearSession();
      window.location.href = 'index.html';
      return null;
    }
    return dbUser;
  }

  function logout() {
    if (global.Presence && typeof Presence.stop === 'function') Presence.stop(true);
    if (serverMode()) {
      const go = () => { clearSession(); window.location.href = 'index.html'; };
      Promise.race([Sync.logout(), new Promise(r => setTimeout(r, 6000))]).then(go, go);
      return;
    }
    clearSession();
    window.location.href = 'index.html';
  }

  global.Auth = {
    getSession, setSession, verify, login, logout, registerSiswa, requireAuth,
    matchesAccountPassword, isServer: serverMode, ROLE_LABELS
  };
})(window);
