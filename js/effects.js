/* ===== LMS Rubela - Effects & Motion Layer =====
 * Progressive-enhancement only: every feature here is decorative and safe to
 * no-op. Provides click ripples, scroll reveals, number count-ups, page
 * transitions, and the light/dark theme switch.
 */
(function (global) {
  const THEME_KEY = 'lms_theme';
  const prefersReduced = () =>
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= Theme ================= */
  function getTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    localStorage.setItem(THEME_KEY, theme === 'dark' ? 'dark' : 'light');
    const knob = document.querySelector('.theme-toggle .knob');
    if (knob) knob.textContent = theme === 'dark' ? '🌙' : '☀️';
    const tog = document.querySelector('.theme-toggle');
    if (tog) tog.setAttribute('aria-label', theme === 'dark' ? 'Mode gelap aktif' : 'Mode terang aktif');
  }
  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    return next;
  }
  function themeToggleHtml() {
    const t = getTheme();
    return `<button type="button" class="theme-toggle" id="themeToggle" title="Ganti mode terang / gelap">
      <span class="knob">${t === 'dark' ? '🌙' : '☀️'}</span>
    </button>`;
  }
  function bindThemeToggle() {
    const btn = document.getElementById('themeToggle');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const next = toggleTheme();
      if (global.UI && UI.toast) {
        UI.toast(next === 'dark' ? 'Mode gelap diaktifkan 🌙' : 'Mode terang diaktifkan ☀️', 'info');
      }
    });
  }

  /* ================= Click ripple ================= */
  function spawnRipple(host, clientX, clientY) {
    if (prefersReduced()) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;
    const size = Math.max(rect.width, rect.height);
    const dot = document.createElement('span');
    dot.className = 'ripple-dot';
    // Light buttons need a tinted ripple to stay visible
    const bg = getComputedStyle(host).backgroundColor;
    const isLight = /rgba?\(\s*(2[4-5]\d|25[0-5])\s*,\s*(2[4-5]\d|25[0-5])\s*,\s*(2[4-5]\d|25[0-5])/.test(bg)
      || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
    if (isLight) dot.classList.add('dark');
    dot.style.width = dot.style.height = size + 'px';
    const x = (clientX == null ? rect.left + rect.width / 2 : clientX) - rect.left - size / 2;
    const y = (clientY == null ? rect.top + rect.height / 2 : clientY) - rect.top - size / 2;
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    host.appendChild(dot);
    setTimeout(() => dot.remove(), 650);
  }

  function initRipples() {
    if (document.body.dataset.rippleBound) return;
    document.body.dataset.rippleBound = '1';
    document.addEventListener('pointerdown', (e) => {
      // .att-pill sengaja dikecualikan: presensi harus terasa instan tanpa efek
      const host = e.target.closest('.btn, .ripple-host, .class-chip, .role-tab');
      if (!host || host.disabled) return;
      spawnRipple(host, e.clientX, e.clientY);
    }, { passive: true });
  }

  /* ================= Scroll reveal ================= */
  let observer = null;
  function initReveals(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll('.reveal:not(.is-visible)');
    if (!nodes.length) return;
    if (prefersReduced() || !('IntersectionObserver' in global)) {
      nodes.forEach(n => n.classList.add('is-visible'));
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    }
    nodes.forEach(n => observer.observe(n));
  }

  /* ================= Number count-up ================= */
  // Parses "123", "87%", "Rp 1.250.000" -> animates the numeric part.
  function parseValue(text) {
    const m = String(text).trim().match(/^([^\d-]*)(-?\d[\d.,\s]*)(.*)$/);
    if (!m) return null;
    const digits = m[2].replace(/[.\s,]/g, '');
    const num = Number(digits);
    if (!isFinite(num)) return null;
    const grouped = /[.,]/.test(m[2]);
    return { prefix: m[1], value: num, suffix: m[3], grouped };
  }

  function countUp(el) {
    if (el.dataset.counted) return;
    const parsed = parseValue(el.textContent);
    if (!parsed || parsed.value === 0 || Math.abs(parsed.value) > 1e12) {
      el.dataset.counted = '1';
      return;
    }
    el.dataset.counted = '1';
    if (prefersReduced()) return;
    const target = parsed.value;
    const fmt = (n) => parsed.prefix + (parsed.grouped ? Math.round(n).toLocaleString('id-ID') : String(Math.round(n))) + parsed.suffix;
    const duration = 750;
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    el.classList.add('counting');
    function frame(now) {
      const p = Math.min(1, (now - start) / duration);
      el.textContent = fmt(target * easeOut(p));
      if (p < 1) requestAnimationFrame(frame);
      else { el.textContent = fmt(target); el.classList.remove('counting'); }
    }
    requestAnimationFrame(frame);
  }

  function initCounters(root) {
    const scope = root || document;
    scope.querySelectorAll('.stat-card .value, .fin-card .value, [data-count]').forEach(countUp);
  }

  /* ================= Progress bar fills ================= */
  function initBars(root) {
    const scope = root || document;
    scope.querySelectorAll('.progress > span[data-pct]').forEach(bar => {
      const pct = Math.max(0, Math.min(100, Number(bar.dataset.pct) || 0));
      requestAnimationFrame(() => { bar.style.width = pct + '%'; });
    });
    scope.querySelectorAll('.meter[data-val]').forEach(m => {
      const v = Math.max(0, Math.min(100, Number(m.dataset.val) || 0));
      m.style.setProperty('--val', v);
    });
  }

  /* ================= Page transition ================= */
  function playPageEnter(el) {
    if (!el || prefersReduced()) return;
    el.classList.remove('page-enter');
    // Force reflow so the animation restarts on every navigation
    void el.offsetWidth;
    el.classList.add('page-enter');
  }

  /* ================= One-shot entrance for any element ================= */
  function pop(el) {
    if (!el || prefersReduced()) return;
    el.classList.remove('anim-pop');
    void el.offsetWidth;
    el.classList.add('anim-pop');
  }
  function shake(el) {
    if (!el || prefersReduced()) return;
    el.classList.remove('anim-shake');
    void el.offsetWidth;
    el.classList.add('anim-shake');
  }

  /* ================= Public enhance hook ================= */
  // Call after any dynamic render to (re)apply motion to the new DOM.
  function enhance(root) {
    initRipples();
    initReveals(root);
    initCounters(root);
    initBars(root);
    bindThemeToggle();
  }

  // Apply stored theme as early as possible.
  applyTheme(getTheme());
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getTheme());
    enhance(document);
  });

  global.Effects = {
    getTheme, applyTheme, toggleTheme, themeToggleHtml, bindThemeToggle,
    enhance, initReveals, initCounters, initBars, playPageEnter, pop, shake, spawnRipple
  };
})(window);
