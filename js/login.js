/* ===== Login page controller ===== */
(function () {
  const server = () => Auth.isServer();

  // Redirect if already logged in
  const session = Auth.getSession();
  if (session) {
    window.location.href = 'dashboard.html';
    return;
  }

  // Theme switch available before login too
  const themeSlot = document.getElementById('authThemeSlot');
  if (themeSlot && window.Effects) {
    themeSlot.innerHTML = Effects.themeToggleHtml();
    Effects.bindThemeToggle();
  }

  const modeNote = document.getElementById('authModeNote');
  function showNote(html, kind) {
    if (!modeNote) return;
    modeNote.className = 'alert small ' + (kind || 'alert-info');
    modeNote.innerHTML = html;
    modeNote.classList.remove('hidden');
  }
  if (/[?&]sesi=berakhir/.test(location.search)) showNote('Sesi Anda telah berakhir. Silakan masuk kembali.', 'alert-warning');
  if (/[?&]server=aktif/.test(location.search)) showNote('LMS kini memakai server bersama. Silakan masuk dengan akun yang diberikan admin.', 'alert-info');

  // Tentukan mode (server/lokal) dan tampilkan identitas aplikasi dari server.
  if (window.Sync && location.protocol !== 'file:') {
    Sync.detectMode().then(h => {
      if (!h) return;
      if (h.branding && window.Branding) {
        const b = h.branding;
        const st = { appName: b.appName || 'LMS Rubela', appTagline: b.appTagline || 'Learning Management System', appLogo: b.appLogo || '' };
        document.querySelectorAll('.brand-logo').forEach(el => Branding.fillLogo(el, st));
        document.querySelectorAll('.brand h1').forEach(el => { el.textContent = st.appName; });
        document.querySelectorAll('.brand p:not(#sideRole)').forEach(el => { el.textContent = st.appTagline; });
        document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = st.appName; });
      }
      if (h.reachable && h.configured && h.ok === false) {
        showNote('Server sedang tidak dapat mengakses database. Coba beberapa saat lagi atau hubungi admin.', 'alert-warning');
      }
    });
  }
  if (!server()) {
    showNote('<strong>Mode lokal.</strong> Server belum terhubung, sehingga data hanya tersimpan di browser ini dan tidak tersinkron ke perangkat lain.', 'alert-warning');
  }

  let selectedRole = 'admin';
  const tabs = document.querySelectorAll('.role-tab');
  const HINTS = { admin: 'Username admin', guru: 'Username tutor', siswa: 'Username siswa', orangtua: 'Username orang tua' };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      selectedRole = tab.dataset.role;
      const usernameEl = document.getElementById('username');
      if (usernameEl) usernameEl.placeholder = HINTS[selectedRole] || 'Username';
    });
  });
  // Trigger default placeholder
  tabs[0].click();

  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  /** Tampilkan pesan gagal pada kartu login. */
  function showError(message) {
    loginError.textContent = message;
    loginError.classList.remove('hidden');
    if (window.Effects) {
      Effects.shake(document.querySelector('.auth-card'));
      Effects.pop(loginError);
    }
  }
  function busy(on, label) {
    if (!submitBtn) return;
    submitBtn.disabled = on;
    submitBtn.innerHTML = on
      ? `<span class="spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,.4);"></span> ${label || 'Memeriksa...'}`
      : 'Masuk';
  }
  function goDashboard() {
    busy(true, 'Menyiapkan dashboard...');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 300);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (server()) {
      busy(true);
      const r = await Auth.login(username, password, selectedRole);
      if (!r || !r.ok) { busy(false); showError((r && r.error) || 'Gagal masuk.'); return; }
      if (r.quiz) {
        busy(false);
        LoginQuiz.openServer(r.quiz, (res) => { Auth.setSession(res.user, res.token, res.expiresAt); goDashboard(); },
          (msg) => { busy(false); showError(msg); });
        return;
      }
      Auth.setSession(r.user, r.token, r.expiresAt);
      goDashboard();
      return;
    }

    // Mode lokal: periksa kredensial tanpa langsung membuat sesi, supaya
    // verifikasi keamanan benar-benar menjadi syarat masuk.
    const check = Auth.verify(username, password, selectedRole);
    if (!check.ok) {
      showError(check.error);
      return;
    }
    const finish = () => {
      const result = Auth.login(username, password, selectedRole);
      if (!result.ok) { showError(result.error); return; }
      goDashboard();
    };
    // Gerbang soal UTBK (bisa dimatikan admin lewat menu Keamanan Login)
    if (window.LoginQuiz && LoginQuiz.isRequired(check.user)) {
      LoginQuiz.open(check.user, finish, (msg) => {
        busy(false);
        showError(msg);
      });
      return;
    }
    finish();
  });

  // Register modal
  const registerModal = document.getElementById('registerModal');
  const closeRegister = () => {
    registerModal.classList.add('is-closing');
    setTimeout(() => {
      registerModal.classList.add('hidden');
      registerModal.classList.remove('is-closing');
    }, 170);
  };
  document.getElementById('openRegister').addEventListener('click', (e) => {
    e.preventDefault();
    registerModal.classList.remove('is-closing');
    registerModal.classList.remove('hidden');
  });
  document.getElementById('closeRegister').addEventListener('click', closeRegister);
  registerModal.addEventListener('click', (e) => {
    if (e.target === registerModal) closeRegister();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !registerModal.classList.contains('hidden')) closeRegister();
  });

  const registerForm = document.getElementById('registerForm');
  const registerError = document.getElementById('registerError');
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerError.classList.add('hidden');
    const btn = registerForm.querySelector('button[type="submit"]');
    const fd = new FormData(registerForm);
    if (btn) { btn.disabled = true; btn.textContent = 'Mendaftarkan...'; }
    const result = await Auth.registerSiswa({
      name: fd.get('name').trim(),
      email: fd.get('email').trim(),
      username: fd.get('username').trim(),
      password: fd.get('password'),
      targetUniv: fd.get('targetUniv') || '',
      targetMajor: fd.get('targetMajor') || ''
    });
    if (btn) { btn.disabled = false; btn.textContent = 'Daftar Akun Siswa'; }
    if (!result || !result.ok) {
      registerError.textContent = (result && result.error) || 'Pendaftaran gagal.';
      registerError.classList.remove('hidden');
      if (window.Effects) Effects.shake(registerModal.querySelector('.modal-content'));
      return;
    }
    // Auto-login
    if (server()) Auth.setSession(result.user, result.token, result.expiresAt);
    else Auth.login(result.user.username, fd.get('password'), 'siswa');
    window.location.href = 'dashboard.html';
  });
})();
