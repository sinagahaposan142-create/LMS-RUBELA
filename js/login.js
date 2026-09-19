/* ===== Login page controller ===== */
(function () {
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

  let selectedRole = 'admin';
  const tabs = document.querySelectorAll('.role-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedRole = tab.dataset.role;
      // Prefill username hint
      const usernameEl = document.getElementById('username');
      const passwordEl = document.getElementById('password');
      const presets = {
        admin: { u: 'admin', p: 'admin123' },
        guru: { u: 'guru1', p: 'guru123' },
        siswa: { u: 'siswa1', p: 'siswa123' },
        orangtua: { u: 'ortu1', p: 'ortu123' }
      };
      if (presets[selectedRole]) {
        usernameEl.placeholder = 'mis. ' + presets[selectedRole].u;
        passwordEl.placeholder = 'mis. ' + presets[selectedRole].p;
      }
    });
  });
  // Trigger default placeholder
  tabs[0].click();

  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    const result = Auth.login(username, password, selectedRole);
    if (!result.ok) {
      loginError.textContent = result.error;
      loginError.classList.remove('hidden');
      if (window.Effects) {
        Effects.shake(document.querySelector('.auth-card'));
        Effects.pop(loginError);
      }
      return;
    }
    // Brief success state so the transition doesn't feel abrupt
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="border-top-color:#fff;border-color:rgba(255,255,255,.4);border-top-color:#fff;"></span> Menyiapkan dashboard...';
    }
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 420);
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
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    registerError.classList.add('hidden');
    const fd = new FormData(registerForm);
    const result = Auth.registerSiswa({
      name: fd.get('name').trim(),
      email: fd.get('email').trim(),
      username: fd.get('username').trim(),
      password: fd.get('password'),
      targetUniv: fd.get('targetUniv') || '',
      targetMajor: fd.get('targetMajor') || ''
    });
    if (!result.ok) {
      registerError.textContent = result.error;
      registerError.classList.remove('hidden');
      if (window.Effects) Effects.shake(registerModal.querySelector('.modal-content'));
      return;
    }
    // Auto-login
    Auth.login(result.user.username, fd.get('password'), 'siswa');
    window.location.href = 'dashboard.html';
  });
})();
