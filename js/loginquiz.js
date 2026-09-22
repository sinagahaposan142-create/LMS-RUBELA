/* ===== LMS Rubela - Verifikasi Keamanan Login =====
 * Gerbang tambahan setelah username & password benar: pengguna harus
 * menjawab satu soal UTBK mudah sebelum sesi dibuat. Tujuannya memastikan
 * yang masuk benar-benar siswa bersangkutan, bukan orang lain yang
 * sekadar memegang kata sandinya.
 *
 *   LoginQuiz.isRequired(user)            -> boolean
 *   LoginQuiz.open(user, onPass, onFail)  -> tampilkan gerbang
 *
 * Admin mengatur semuanya dari menu "Keamanan Login":
 *   settings.loginQuizEnabled   aktif / mati
 *   settings.loginQuizRoles     peran yang wajib menjawab
 *   settings.loginQuizAttempts  jumlah kesempatan (default 3)
 *
 * Modul ini sengaja tidak bergantung pada UI/Effects agar tetap berjalan
 * di halaman login yang hanya memuat data.js + auth.js.
 */
(function (global) {

  const COOLDOWN_KEY = 'lms_login_quiz_block';
  const COOLDOWN_MS = 60 * 1000;         // jeda 1 menit setelah kesempatan habis

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** Render teks soal: pakai RichText/LaTeX bila tersedia, jika tidak teks biasa. */
  function renderText(text) {
    if (global.RichText && typeof RichText.render === 'function') {
      try { return RichText.render(text); } catch (e) { /* jatuh ke teks biasa */ }
    }
    return esc(text);
  }

  function settings() {
    const s = (global.DB && DB.getSettings) ? DB.getSettings() : {};
    return {
      enabled: s.loginQuizEnabled !== false,
      roles: Array.isArray(s.loginQuizRoles) ? s.loginQuizRoles : ['siswa'],
      attempts: Math.max(1, Number(s.loginQuizAttempts) || 3)
    };
  }

  /** Apakah pengguna ini wajib melewati verifikasi? */
  function isRequired(user) {
    if (!user) return false;
    const s = settings();
    if (!s.enabled) return false;
    if (!s.roles.includes(user.role)) return false;
    return DB.getActiveSecurityQuestions().length > 0;
  }

  /* ---- Jeda setelah kesempatan habis ---- */
  function blockedUntil(username) {
    try {
      const raw = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}');
      return Number(raw[username] || 0);
    } catch (e) { return 0; }
  }
  function setBlocked(username, until) {
    try {
      const raw = JSON.parse(localStorage.getItem(COOLDOWN_KEY) || '{}');
      if (until) raw[username] = until; else delete raw[username];
      localStorage.setItem(COOLDOWN_KEY, JSON.stringify(raw));
    } catch (e) { /* noop */ }
  }
  function remainingBlock(username) {
    return Math.max(0, blockedUntil(username) - Date.now());
  }

  /** Ambil soal acak yang belum dipakai pada sesi verifikasi ini. */
  function pickQuestion(used) {
    const pool = DB.getActiveSecurityQuestions().filter(q =>
      Array.isArray(q.options) && q.options.length >= 2 &&
      q.correctIndex != null && q.options[q.correctIndex] != null);
    if (!pool.length) return null;
    const fresh = pool.filter(q => !used.has(q.id));
    const list = fresh.length ? fresh : pool;
    return list[Math.floor(Math.random() * list.length)];
  }

  function close() {
    const el = document.getElementById('loginQuizGate');
    if (el) el.remove();
    document.body.classList.remove('lq-open');
  }

  /**
   * Tampilkan gerbang verifikasi.
   * @param {object} user     pengguna yang kredensialnya sudah benar
   * @param {Function} onPass dipanggil bila menjawab benar
   * @param {Function} onFail dipanggil dengan pesan bila gagal / dibatalkan
   */
  function open(user, onPass, onFail) {
    const s = settings();
    const fail = (msg) => { close(); if (typeof onFail === 'function') onFail(msg); };

    const wait = remainingBlock(user.username);
    if (wait > 0) {
      fail(`Terlalu banyak jawaban salah. Coba lagi dalam ${Math.ceil(wait / 1000)} detik.`);
      return;
    }

    const used = new Set();
    let left = s.attempts;
    let question = pickQuestion(used);
    if (!question) { close(); if (typeof onPass === 'function') onPass(); return; }

    const gate = document.createElement('div');
    gate.id = 'loginQuizGate';
    gate.className = 'lq-back';
    gate.innerHTML = `
      <div class="lq-card" role="dialog" aria-modal="true" aria-labelledby="lqTitle">
        <div class="lq-head">
          <div class="lq-ic">🔐</div>
          <div>
            <h3 id="lqTitle">Verifikasi Keamanan</h3>
            <p class="lq-sub">Halo <strong>${esc(user.name)}</strong>, jawab satu soal berikut untuk membuktikan ini benar akun Anda.</p>
          </div>
        </div>
        <div id="lqBody"></div>
        <div class="lq-foot">
          <button type="button" class="btn btn-secondary btn-sm" id="lqCancel">Batalkan Masuk</button>
          <span class="lq-left" id="lqLeft"></span>
        </div>
      </div>`;
    document.body.appendChild(gate);
    document.body.classList.add('lq-open');

    document.getElementById('lqCancel').addEventListener('click', () =>
      fail('Masuk dibatalkan. Verifikasi keamanan belum diselesaikan.'));

    paint();

    function paint(feedback) {
      used.add(question.id);
      const body = document.getElementById('lqBody');
      body.innerHTML = `
        <div class="lq-meta">
          <span class="badge badge-info">${esc(question.subtest || 'UTBK')}</span>
          <span class="badge badge-gray">${esc(question.difficulty || 'mudah')}</span>
        </div>
        <div class="lq-q">${renderText(question.text)}</div>
        <div class="lq-opts">
          ${question.options.map((o, i) => `
            <button type="button" class="lq-opt" data-pick="${i}">
              <span class="lq-key">${String.fromCharCode(65 + i)}</span>
              <span class="lq-val">${renderText(o)}</span>
            </button>`).join('')}
        </div>
        ${feedback ? `<div class="alert alert-error lq-fb">${esc(feedback)}</div>` : ''}
      `;
      document.getElementById('lqLeft').textContent = `Kesempatan tersisa: ${left}`;

      body.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', () => {
        const pick = Number(btn.dataset.pick);
        body.querySelectorAll('[data-pick]').forEach(b => { b.disabled = true; });

        if (pick === Number(question.correctIndex)) {
          btn.classList.add('is-right');
          setBlocked(user.username, 0);
          setTimeout(() => {
            close();
            if (typeof onPass === 'function') onPass();
          }, 520);
          return;
        }

        btn.classList.add('is-wrong');
        const right = body.querySelector(`[data-pick="${Number(question.correctIndex)}"]`);
        if (right) right.classList.add('is-right');
        left--;

        setTimeout(() => {
          if (left <= 0) {
            setBlocked(user.username, Date.now() + COOLDOWN_MS);
            fail('Kesempatan menjawab habis. Silakan coba masuk lagi dalam 1 menit.');
            return;
          }
          const next = pickQuestion(used);
          if (!next) {
            // Bank soal terlalu sedikit — jangan kunci pengguna
            close();
            if (typeof onPass === 'function') onPass();
            return;
          }
          question = next;
          paint('Jawaban belum tepat. Coba soal berikut ini.');
        }, 1100);
      }));
    }
  }

  global.LoginQuiz = { isRequired, open, close, COOLDOWN_MS };
})(window);
