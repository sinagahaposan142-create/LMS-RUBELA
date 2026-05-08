/* ===== Login page controller ===== */
(function () {
  // Redirect if already logged in
  const session = Auth.getSession();
  if (session) {
    window.location.href = 'dashboard.html';
    return;
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
        siswa: { u: 'siswa1', p: 'siswa123' }
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
      return;
    }
    window.location.href = 'dashboard.html';
  });

  // Register modal
  const registerModal = document.getElementById('registerModal');
  document.getElementById('openRegister').addEventListener('click', (e) => {
    e.preventDefault();
    registerModal.classList.remove('hidden');
  });
  document.getElementById('closeRegister').addEventListener('click', () => {
    registerModal.classList.add('hidden');
  });
  registerModal.addEventListener('click', (e) => {
    if (e.target === registerModal) registerModal.classList.add('hidden');
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
      password: fd.get('password')
    });
    if (!result.ok) {
      registerError.textContent = result.error;
      registerError.classList.remove('hidden');
      return;
    }
    // Auto-login
    Auth.login(result.user.username, fd.get('password'), 'siswa');
    window.location.href = 'dashboard.html';
  });
})();
