/* ===== LMS Rubela - Auth =====
 * Thin session layer on top of DB.
 */
(function (global) {
  const SESSION_KEY = 'lms_session';

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(user) {
    const minimal = { id: user.id, username: user.username, role: user.role, name: user.name };
    localStorage.setItem(SESSION_KEY, JSON.stringify(minimal));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  const ROLE_LABELS = {
    admin: 'Admin', guru: 'Guru', siswa: 'Siswa', orangtua: 'Orang Tua'
  };

  /** Periksa kredensial TANPA membuat sesi — dipakai gerbang keamanan login. */
  function verify(username, password, role) {
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

  function login(username, password, role) {
    const result = verify(username, password, role);
    if (!result.ok) return result;
    setSession(result.user);
    return result;
  }

  function registerSiswa({ name, email, username, password, targetUniv, targetMajor, phone }) {
    if (!name || !email || !username || !password) return { ok: false, error: 'Semua field wajib diisi.' };
    if (password.length < 6) return { ok: false, error: 'Password minimal 6 karakter.' };
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
    clearSession();
    window.location.href = 'index.html';
  }

  global.Auth = { getSession, verify, login, logout, registerSiswa, requireAuth, ROLE_LABELS };
})(window);
