/* =====================================================================
 * js/boot-splash.js — layar pemuatan saat masuk & memuat data awal
 * ---------------------------------------------------------------------
 * Dipakai halaman masuk (setelah login berhasil) dan dashboard (sinkron
 * pertama dari server, js/sync.js). Menampilkan logo lembaga dengan cincin
 * orbit, sapaan sesuai waktu, kalimat penyemangat bergiliran sesuai peran,
 * tiga tahap pemuatan, dan jumlah data yang sudah dimuat.
 * Mandiri (tidak bergantung DB/UI) karena dimuat sebelum modul lain.
 *   BootSplash.show({ step, user })  step 0..2
 *   BootSplash.step(n, detail) • BootSplash.error(pesan, coba) • BootSplash.hide()
 * ===================================================================*/
(function (global) {
  'use strict';
  const LINES = {
    siswa: [
      'Satu soal hari ini, satu langkah lebih dekat ke kampus impian.',
      'Konsisten mengalahkan semangat sesaat.',
      'Salah saat latihan adalah bekal benar saat ujian.',
      'Pelan-pelan asal tidak berhenti.',
      'Yang kamu ulang hari ini, kamu ingat saat tryout.',
      '25 menit fokus penuh lebih berharga dari 2 jam setengah hati.',
      'Kampus impian menunggu versi terbaikmu.'
    ],
    guru: [
      'Satu penjelasan yang jernih bisa mengubah cara seseorang belajar.',
      'Kelas yang hebat dimulai dari tutor yang siap.',
      'Terima kasih sudah menyalakan semangat mentee hari ini.',
      'Setiap pertanyaan mentee adalah pintu untuk mengajar lebih baik.'
    ],
    orangtua: [
      'Dukungan di rumah adalah energi terbesar bagi anak.',
      'Rayakan setiap kemajuan kecil anak Anda.',
      'Pantau perkembangan, dampingi prosesnya.'
    ],
    admin: [
      'Data yang rapi, keputusan yang tepat.',
      'Menyiapkan ruang belajar untuk semua mentee dan tutor.',
      'Lembaga yang tertata membuat belajar terasa ringan.'
    ]
  };
  const STEPS = ['Akun terverifikasi', 'Menyinkronkan data', 'Menyiapkan dashboard'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let el = null, rot = null, cur = 0, startedAt = 0, hideTimer = null;

  function session() {
    try { return JSON.parse(localStorage.getItem('lms_session') || 'null') || {}; } catch (e) { return {}; }
  }
  /** Nama & logo lembaga dari cache Branding (js/branding.js), logo hanya data URL gambar. */
  function brand() {
    try {
      const b = JSON.parse(localStorage.getItem('lms_brand_cache') || 'null') || {};
      const logo = typeof b.logo === 'string' && /^data:image\/(png|jpe?g|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(b.logo) ? b.logo : '';
      return { name: String(b.name || 'LMS Rubela').slice(0, 60), logo };
    } catch (e) { return { name: 'LMS Rubela', logo: '' }; }
  }
  function greeting() {
    // Sama dengan sapaan dashboard (zona waktu pengguna); cadangan WIB bila ui.js belum dimuat.
    try { if (global.UI && typeof UI.greeting === 'function') return UI.greeting(); } catch (e) { /* lanjut */ }
    let h = new Date().getHours();
    try { h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date())); } catch (e) { /* jam perangkat */ }
    return h < 4 ? 'Selamat malam' : h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  }
  const reduced = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function build(o) {
    const s = o.user || session();
    const b = brand();
    const first = String(s.name || '').trim().split(/\s+/)[0] || '';
    const pool = LINES[s.role] || LINES.siswa;
    cur = Math.floor(Math.random() * pool.length);
    el = document.createElement('div');
    el.id = 'bootSplash';
    el.className = 'bs-splash' + (o && o.instant ? ' is-instant' : '');
    el.innerHTML = `
      <div class="bs-glow" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="bs-center">
        <div class="bs-mark" aria-hidden="true">
          <svg class="bs-orbit" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="bs-track"/><circle cx="60" cy="60" r="54" class="bs-arc"/></svg>
          <span class="bs-dot d1"></span><span class="bs-dot d2"></span><span class="bs-dot d3"></span>
          <span class="bs-logo">${b.logo ? `<img src="${esc(b.logo)}" alt="" />` : esc(b.name.charAt(0).toUpperCase() || 'R')}</span>
        </div>
        <div class="bs-brand">${esc(b.name)}</div>
        <h1 class="bs-hello">${esc(greeting())}${first ? ', ' + esc(first) : ''}</h1>
        <p class="bs-line" data-bs-line>${esc(pool[cur])}</p>
        <ol class="bs-steps" data-bs-steps>${STEPS.map((t, i) => `<li data-i="${i}"><span class="bs-chk" aria-hidden="true"></span>${esc(t)}</li>`).join('')}</ol>
        <div class="bs-status" role="status" aria-live="polite" data-bs-status></div>
        <div class="bs-actions" data-bs-actions hidden></div>
      </div>`;
    document.body.appendChild(el);
    startedAt = Date.now();
    if (!reduced()) {
      rot = setInterval(() => {
        const line = el && el.querySelector('[data-bs-line]');
        if (!line) return;
        line.classList.add('is-out');
        setTimeout(() => {
          if (!el) return;
          cur = (cur + 1) % pool.length;
          line.textContent = pool[cur];
          line.classList.remove('is-out');
        }, 320);
      }, 3400);
    }
  }

  function show(o) {
    const opts = o || {};
    if (!document.body) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!el) build(opts);
    el.classList.remove('is-leaving', 'is-error');
    step(opts.step == null ? 1 : opts.step, opts.detail || '');
  }
  function step(n, detail) {
    if (!el) return;
    el.querySelectorAll('[data-bs-steps] li').forEach(li => {
      const i = Number(li.dataset.i);
      li.classList.toggle('is-done', i < n);
      li.classList.toggle('is-now', i === n);
    });
    const st = el.querySelector('[data-bs-status]');
    st.textContent = detail || STEPS[Math.min(n, STEPS.length - 1)] + '…';
  }
  function status(text) { if (el) el.querySelector('[data-bs-status]').textContent = text || ''; }
  function error(msg, retry) {
    if (!el) show({ step: 1 });
    el.classList.add('is-error');
    status(msg || 'Data belum dapat dimuat.');
    const box = el.querySelector('[data-bs-actions]');
    box.hidden = false;
    box.innerHTML = '<button type="button" class="btn btn-primary btn-sm" data-bs-retry>Coba lagi</button><a class="btn btn-secondary btn-sm" href="index.html">Ke halaman masuk</a>';
    box.querySelector('[data-bs-retry]').addEventListener('click', () => {
      box.hidden = true; box.innerHTML = '';
      el.classList.remove('is-error');
      step(1);
      if (typeof retry === 'function') retry();
    }, { once: true });
  }
  /** Tutup dengan transisi; tampil minimal 600 ms agar tidak berkedip. */
  function hide() {
    if (!el) return;
    const node = el;
    const wait = Math.max(0, 600 - (Date.now() - startedAt));
    step(3, 'Siap!');
    hideTimer = setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => { node.remove(); if (el === node) el = null; }, reduced() ? 0 : 380);
      if (rot) { clearInterval(rot); rot = null; }
      hideTimer = null;
    }, wait);
  }

  global.BootSplash = { show, step, status, error, hide, isOpen: () => !!el };
})(window);
