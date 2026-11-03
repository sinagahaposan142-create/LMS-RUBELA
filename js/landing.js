/* =====================================================================
 * js/landing.js — interaksi ringan halaman awal (index.html):
 * reveal saat scroll, parallax skyline halus, toggle tema, tombol
 * tampil/sembunyi password, deteksi Caps Lock, tombol "Masuk"/"Daftar",
 * dan slot foto kampus opsional (CC BY/CC0). Semua elemen form login
 * tetap sama, jadi login.js tidak terganggu.
 * ===================================================================*/
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----- Reveal saat scroll ----- */
  var reveals = [].slice.call(document.querySelectorAll('.lp-reveal'));
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el, idx) { el.style.transitionDelay = Math.min(idx * 55, 320) + 'ms'; io.observe(el); });
  }

  /* ----- Parallax skyline halus (SVG inline → layer langsung di dokumen) ----- */
  if (!reduce) {
    var campus = document.querySelector('.lp-campus');
    var layers = campus ? [].slice.call(campus.querySelectorAll('.cs-layer')) : [];
    var ticking = false;
    if (campus && layers.length) {
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          var rect = campus.getBoundingClientRect();
          var vh = window.innerHeight || 1;
          var prog = 1 - (rect.top + rect.height / 2) / vh; // -1..1 saat melintas viewport
          layers.forEach(function (ly) {
            var d = parseFloat(ly.getAttribute('data-depth')) || 10;
            ly.style.transform = 'translate3d(0,' + (prog * d * -0.6).toFixed(2) + 'px,0)';
          });
          ticking = false;
        });
      }, { passive: true });
    }
  }

  /* ----- Tombol tampil/sembunyi password + Caps Lock ----- */
  var pass = document.getElementById('password');
  var toggle = document.getElementById('lpPassToggle');
  if (toggle && pass) {
    toggle.addEventListener('click', function () {
      var show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
      try { pass.focus({ preventScroll: true }); } catch (e) {}
    });
  }
  var capsHint = document.getElementById('lpCapsHint');
  function caps(e) {
    if (!capsHint || !e.getModifierState) return;
    capsHint.classList.toggle('hidden', !e.getModifierState('CapsLock'));
  }
  [document.getElementById('username'), pass].forEach(function (el) {
    if (!el) return;
    el.addEventListener('keyup', caps);
    el.addEventListener('keydown', caps);
    el.addEventListener('blur', function () { if (capsHint) capsHint.classList.add('hidden'); });
  });

  /* ----- CTA: gulir ke kartu login / buka registrasi ----- */
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
  var ctaMasukHero = document.getElementById('lpCtaMasukHero');
  if (ctaMasukHero) ctaMasukHero.addEventListener('click', function (e) { e.preventDefault(); if (ctaMasuk) ctaMasuk.click(); });
  var ctaDaftar = document.getElementById('lpCtaDaftar');
  if (ctaDaftar) ctaDaftar.addEventListener('click', function (e) {
    e.preventDefault();
    var open = document.getElementById('openRegister');
    if (open) open.click();
  });

  /* ----- Tombol tema di topbar (label mengikuti mode; ikon via CSS) ----- */
  var themeBtn = document.getElementById('lpThemeBtn');
  function syncThemeLabel() {
    if (!themeBtn) return;
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var label = themeBtn.querySelector('.lp-ic-label');
    if (label) label.textContent = dark ? 'Terang' : 'Gelap';
    themeBtn.setAttribute('aria-label', dark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap');
  }
  if (themeBtn) {
    syncThemeLabel();
    themeBtn.addEventListener('click', function () {
      if (window.Effects && Effects.toggleTheme) Effects.toggleTheme();
      else {
        var dark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
        try { localStorage.setItem('lms_theme', dark ? 'light' : 'dark'); } catch (e) {}
      }
      syncThemeLabel();
    });
    // Jika tema diubah dari slot di dalam kartu (Effects), label tetap sinkron.
    var mo = new MutationObserver(syncThemeLabel);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ----- Slot foto kampus opsional (Rute A1) -----
   * Aktif hanya bila .lp-campus punya atribut data-campus-photo berisi path foto
   * berlisensi CC BY/CC0 (mis. data-campus-photo="assets/campus/skyline.webp").
   * Tanpa atribut itu, ilustrasi SVG tetap dipakai. */
  var campusEl = document.querySelector('.lp-campus');
  if (campusEl && campusEl.getAttribute('data-campus-photo')) {
    var src = campusEl.getAttribute('data-campus-photo');
    var pic = campusEl.querySelector('.lp-campus-photo');
    if (pic) {
      var img = new Image();
      img.src = src; img.alt = 'Panorama kampus'; img.loading = 'lazy'; img.decoding = 'async';
      img.onerror = function () { campusEl.removeAttribute('data-campus-photo'); }; // fallback ke SVG
      pic.appendChild(img);
    }
  }
})();
