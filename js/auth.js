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

  function login(username, password, role) {
    const user = DB.findUserByUsername(username);
    if (!user) return { ok: false, error: 'Username tidak ditemukan.' };
    if (user.password !== password) return { ok: false, error: 'Password salah.' };
    if (role && user.role !== role) return { ok: false, error: 'Peran tidak sesuai untuk akun ini.' };
    setSession(user);
    return { ok: true, user };
  }

  function registerSiswa({ name, email, username, password }) {
    if (!name || !email || !username || !password) return { ok: false, error: 'Semua field wajib diisi.' };
    if (password.length < 6) return { ok: false, error: 'Password minimal 6 karakter.' };
    if (DB.findUserByUsername(username)) return { ok: false, error: 'Username sudah dipakai.' };
    const user = DB.addUser({ id: DB.uid('u'), role: 'siswa', name, email, username, password, kelas: 'X-A' });
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

  global.Auth = { getSession, login, logout, registerSiswa, requireAuth };
})(window);
