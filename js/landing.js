/* =====================================================================
 * js/landing.js — interaksi ringan halaman utama (index.html):
 * reveal saat scroll, taburan bintang (mode gelap), parallax halus,
 * toggle tema, dan tombol "Masuk" / "Daftar" yang menggulir ke kartu.
 * Tidak mengganggu login.js (semua elemen form tetap sama).
 * ===================================================================*/
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Taburan bintang untuk mode gelap */
  var starField = document.getElementById('lpStars');
  if (starField) {
    var n = window.innerWidth < 600 ? 26 : 50;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i++) {
      var s = document.createElement('span');
      s.className = 'lp-star';
      s.style.left = (Math.random() * 100) + '%';
      s.style.top = (Math.random() * 62) + '%';
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
      var sz = (Math.random() * 2 + 1.5).toFixed(1);
      s.style.width = sz + 'px'; s.style.height = sz + 'px';
      frag.appendChild(s);
    }
    starField.appendChild(frag);
  }

  /* Reveal saat scroll */
  var reveals = [].slice.call(document.querySelectorAll('.lp-reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el, idx) { el.style.transitionDelay = Math.min(idx * 60, 360) + 'ms'; io.observe(el); });
  }

  /* Parallax halus pada benda langit mengikuti scroll (dilewati bila reduce motion) */
  if (!reduce) {
    var sun = document.querySelector('.lp-sun');
    var campus = document.querySelector('.lp-campus svg');
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.pageYOffset || 0;
        if (sun) sun.style.transform = 'translateY(' + (y * 0.18) + 'px)';
        if (campus) campus.style.transform = 'translateY(' + (y * -0.04) + 'px)';
        ticking = false;
      });
    }, { passive: true });
  }

  /* Tombol CTA: gulir mulus ke kartu login / buka registrasi */
  function scrollToCard() {
    var card = document.getElementById('lpAuthCard');
    if (card) card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }
  var ctaMasuk = document.getElementById('lpCtaMasuk');
  if (ctaMasuk) ctaMasuk.addEventListener('click', function (e) {
    e.preventDefault();
    scrollToCard();
    setTimeout(function () { var u = document.getElementById('username'); if (u) try { u.focus({ preventScroll: true }); } catch (x) {} }, reduce ? 0 : 450);
  });
  var ctaDaftar = document.getElementById('lpCtaDaftar');
  if (ctaDaftar) ctaDaftar.addEventListener('click', function (e) {
    e.preventDefault();
    var open = document.getElementById('openRegister');
    if (open) open.click();
  });

  /* Tombol tema di topbar landing (memakai Effects bila ada) */
  var themeBtn = document.getElementById('lpThemeBtn');
  function syncThemeIcon() {
    if (!themeBtn) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.textContent = dark ? '☀️ Terang' : '🌙 Gelap';
    themeBtn.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
  }
  if (themeBtn) {
    syncThemeIcon();
    themeBtn.addEventListener('click', function () {
      if (window.Effects && Effects.toggleTheme) Effects.toggleTheme();
      else {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
        try { localStorage.setItem('lms_theme', dark ? 'light' : 'dark'); } catch (e) {}
      }
      syncThemeIcon();
    });
  }
})();
