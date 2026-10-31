/* =====================================================================
 * js/timecapsule.js — Mesin Waktu (Time Capsule) + kode keamanan F2
 * ---------------------------------------------------------------------
 * Kriptografi (Web Crypto API, seluruhnya di perangkat pemilik):
 *  - Kunci data acak AES-GCM 256-bit mengenkripsi judul, isi, dan lampiran.
 *  - Kunci data dibungkus dua kali:
 *      1) dengan kunci turunan F2  (PBKDF2-SHA-256, 600.000 iterasi, salt acak)
 *      2) dengan kunci turunan Recovery Key (dibuat sekali, ditampilkan sekali)
 *  - Yang tersimpan hanya: salt, IV, dan ciphertext. F2 & Recovery Key
 *    TIDAK PERNAH disimpan, baik plaintext maupun hash.
 *  - Verifikasi F2 = keberhasilan dekripsi AES-GCM (tag autentikasi).
 * Akses: DB.capsuleOwnerGuard menolak sesi selain pemilik akun mentee.
 * Admin hanya melihat ringkasan operasional (jumlah & tanggal), bukan isi.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const ITER = 600000;
  const MAX_FAILS = 5;
  const IDLE_MS = 10 * 60 * 1000;
  const MAX_ATTACH = 4;
  const MAX_PDF = 2 * 1024 * 1024;
  const THEMES = { sunset: 'Senja', ocean: 'Samudra', forest: 'Hutan', night: 'Malam', rose: 'Mawar' };

  // Sesi terbuka hanya di memori halaman ini.
  let session = null;     // { userId, key: CryptoKey, raw: Uint8Array }
  let idleTimer = null;
  let tickTimer = null;
  let pwFails = 0, pwLockUntil = 0;
  const objectUrls = [];

  const subtle = () => (global.crypto && global.crypto.subtle) || null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = (n) => global.crypto.getRandomValues(new Uint8Array(n));

  async function derive(secret, saltB64, iter) {
    const base = await subtle().importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iter || ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function aesEnc(key, bytes) {
    const iv = rand(12);
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv: b64(iv), ct: b64(ct) };
  }
  async function aesDec(key, box) {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct)));
  }
  const importData = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const encJson = async (obj) => aesEnc(session.key, enc.encode(JSON.stringify(obj)));
  const decJson = async (box) => JSON.parse(dec.decode(await aesDec(session.key, box)));

  /** Recovery key: 25 karakter Base32 (125 bit), dikelompokkan per 5. */
  function newRecoveryKey() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = rand(25);
    const s = Array.from(b, x => A[x % 32]).join('');
    return s.match(/.{5}/g).join('-');
  }
  const normRec = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  function validateF2(code, confirm, user) {
    const c = String(code || '');
    if (c.length < 6 || c.length > 64) return 'Kode F2 harus 6–64 karakter.';
    if (/^(.)\1+$/.test(c)) return 'Kode F2 tidak boleh berupa karakter yang sama berulang.';
    if (['123456', '1234567', '12345678', '654321', 'qwerty', 'password', 'abcdef', '111111'].includes(c.toLowerCase())) return 'Kode F2 terlalu mudah ditebak.';
    const fresh = DB.getUser(user.id) || user;
    if (fresh.password && c === fresh.password) return 'Kode F2 harus berbeda dari password akun.';
    if (confirm != null && c !== confirm) return 'Konfirmasi kode F2 tidak sama.';
    return '';
  }

  /** Buat brankas baru (kunci data baru) → kembalikan recovery key untuk ditampilkan sekali. */
  async function createVault(user, code) {
    const raw = rand(32);
    const salt = b64(rand(16)), recSalt = b64(rand(16));
    const recovery = newRecoveryKey();
    const k1 = await derive(code, salt), k2 = await derive(normRec(recovery), recSalt);
    const now = Date.now();
    DB.saveCapsuleVault(user.id, { salt, recSalt, iter: ITER, version: 1, wrapF2: await aesEnc(k1, raw), wrapRec: await aesEnc(k2, raw),
      fails: 0, lockUntil: 0, lockLevel: 0, createdAt: now, updatedAt: now, recoveryConfirmed: false });
    session = { userId: user.id, key: await importData(raw), raw };
    armIdle();
    return recovery;
  }
  /** Bungkus ulang kunci data yang sama dengan F2 baru (+ recovery key baru). */
  async function rewrap(user, raw, code, rotateRecovery) {
    const v = DB.getCapsuleVault(user.id);
    const salt = b64(rand(16));
    const patch = Object.assign({}, v, { salt, iter: ITER, wrapF2: await aesEnc(await derive(code, salt), raw), fails: 0, lockUntil: 0, lockLevel: 0, updatedAt: Date.now() });
    let recovery = null;
    if (rotateRecovery) {
      recovery = newRecoveryKey();
      patch.recSalt = b64(rand(16));
      patch.wrapRec = await aesEnc(await derive(normRec(recovery), patch.recSalt), raw);
      patch.recoveryConfirmed = false;
    }
    DB.saveCapsuleVault(user.id, patch);
    session = { userId: user.id, key: await importData(raw), raw };
    armIdle();
    return recovery;
  }

  async function unlock(user, code) {
    const v = DB.getCapsuleVault(user.id);
    if (!v) throw new Error('Brankas belum dibuat.');
    const now = Date.now();
    if (v.lockUntil && v.lockUntil > now) throw new Error(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((v.lockUntil - now) / 1000)} detik.`);
    try {
      const raw = await aesDec(await derive(code, v.salt, v.iter), v.wrapF2);
      DB.saveCapsuleVault(user.id, Object.assign({}, v, { fails: 0, lockLevel: 0, lockUntil: 0 }));
      session = { userId: user.id, key: await importData(raw), raw };
      armIdle();
    } catch (e) {
      // Penguncian bertahap: 5 salah → 1 menit, lalu 2, 4, … maks 60 menit.
      const fails = (v.fails || 0) + 1;
      const patch = Object.assign({}, v, { fails });
      let msg = `Kode F2 salah. Sisa percobaan: ${MAX_FAILS - fails}.`;
      if (fails >= MAX_FAILS) {
        const lvl = v.lockLevel || 0;
        const mins = Math.min(60, Math.pow(2, lvl));
        Object.assign(patch, { fails: 0, lockLevel: lvl + 1, lockUntil: Date.now() + mins * 60000 });
        msg = `Kode F2 salah ${MAX_FAILS}× — akses dikunci ${mins} menit.`;
      }
      DB.saveCapsuleVault(user.id, patch);
      throw new Error(msg);
    }
  }

  function lock() {
    session = null;
    clearTimeout(idleTimer); idleTimer = null;
    clearInterval(tickTimer); tickTimer = null;
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { lock(); const c = document.getElementById('content'); if (c && c.querySelector('.tc-root')) renderPage(c, Dashboard.currentUser); UI.toast('Mesin Waktu terkunci otomatis setelah 10 menit tidak aktif.', 'info'); }, IDLE_MS);
  }

  /* ------------------------- tampilan ------------------------- */
  function fmtCountdown(ms) {
    if (ms <= 0) return 'Siap dibuka';
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
    return d > 0 ? `${d} hari ${h} jam ${m} mnt` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const fmtDT = (ms) => new Date(ms).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });

  function shell(inner) {
    return `<div class="tc-root">
      <section class="tc-hero"><div class="tc-hero-text"><div class="tc-eyebrow">Ruang pribadi • terenkripsi di perangkatmu</div>
        <h2>Mesin Waktu</h2><p>Tulis surat untuk dirimu di masa depan. Hanya kamu — dengan kode F2 — yang dapat membukanya, tepat pada waktunya.</p></div>
        <div class="tc-capsule" aria-hidden="true"><div class="tc-cap-top"></div><div class="tc-cap-body"><span>✉</span></div><div class="tc-cap-glow"></div></div></section>
      ${inner}</div>`;
  }

  function renderPage(container, user) {
    clearInterval(tickTimer); tickTimer = null;
    if (!subtle()) {
      container.innerHTML = shell('<div class="card"><div class="alert alert-error">Mesin Waktu memerlukan koneksi aman (HTTPS) dan browser modern yang mendukung Web Crypto. Buka LMS melalui alamat https.</div></div>');
      return;
    }
    if (DB.getSettings().capsuleEnabled === false) { container.innerHTML = shell('<div class="empty"><div class="empty-icon">⏳</div>Mesin Waktu sedang dinonaktifkan admin.</div>'); return; }
    let vault;
    try { vault = DB.getCapsuleVault(user.id); } catch (e) { container.innerHTML = shell(`<div class="alert alert-error">${esc(e.message)}</div>`); return; }
    if (session && session.userId !== user.id) lock();
    if (!vault) return renderSetup(container, user);
    if (!session) return renderUnlock(container, user, vault);
    return renderVault(container, user);
  }

  function renderSetup(container, user) {
    container.innerHTML = shell(`<form class="card tc-card" id="tcSetup">
      <div class="card-header">${UI.secHead('🔐', 'Buat Kode Keamanan F2', 'langkah pertama sebelum menulis surat')}</div>
      <ul class="tc-points">
        <li>Isi surat dienkripsi di perangkatmu. Tutor, admin, staf, dan mentee lain <strong>tidak dapat membacanya</strong>.</li>
        <li>Kode F2 tidak disimpan di mana pun. Jika lupa, gunakan <strong>Recovery Key</strong> yang akan ditampilkan sekali setelah ini.</li>
        <li>Tanpa F2 dan Recovery Key, isi surat <strong>tidak dapat dipulihkan siapa pun</strong>.</li>
      </ul>
      <div class="form-row">
        <div class="form-group"><label for="tcF2">Kode F2 (6–64 karakter)</label><input id="tcF2" type="password" class="input" autocomplete="new-password" required minlength="6" maxlength="64" /></div>
        <div class="form-group"><label for="tcF2b">Ulangi kode F2</label><input id="tcF2b" type="password" class="input" autocomplete="new-password" required /></div>
      </div>
      <div class="muted small">Gunakan kode yang berbeda dari password akunmu. Kalimat pendek yang mudah kamu ingat lebih aman daripada angka berurutan.</div>
      <div id="tcErr" class="alert alert-error hidden" role="alert"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Buat Brankas</button></div></form>`);
    const f = container.querySelector('#tcSetup');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('#tcErr');
      const msg = validateF2(f.querySelector('#tcF2').value, f.querySelector('#tcF2b').value, user);
      if (msg) { err.textContent = msg; err.classList.remove('hidden'); return; }
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mengamankan…';
      try {
        const rec = await createVault(user, f.querySelector('#tcF2').value);
        showRecovery(container, user, rec, 'Brankas dibuat');
      } catch (ex) { err.textContent = ex.message || 'Gagal membuat brankas.'; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'Buat Brankas'; }
    });
  }

  function showRecovery(container, user, rec, title) {
    container.innerHTML = shell(`<div class="card tc-card">
      <div class="card-header">${UI.secHead('🗝️', `${esc(title)} — simpan Recovery Key`, 'hanya ditampilkan SEKALI')}</div>
      <p>Recovery Key adalah satu-satunya cara memulihkan akses bila kamu lupa kode F2. Simpan di tempat aman (tulis di buku atau unduh berkasnya). Admin tidak memiliki salinannya.</p>
      <div class="tc-reckey" id="tcRec" tabindex="0">${esc(rec)}</div>
      <div class="flex-gap"><button type="button" class="btn btn-secondary btn-sm" id="tcCopy">📋 Salin</button><button type="button" class="btn btn-secondary btn-sm" id="tcDl">⬇️ Unduh .txt</button></div>
      <form id="tcRecOk" class="form mt-2"><div class="form-group"><label for="tcRecLast">Ketik 5 karakter terakhir Recovery Key untuk konfirmasi</label>
        <input id="tcRecLast" class="input" maxlength="5" autocomplete="off" required style="max-width:160px;text-transform:uppercase;" /></div>
        <div id="tcErr" class="alert alert-error hidden"></div>
        <button class="btn btn-primary" type="submit">Saya sudah menyimpannya</button></form></div>`);
    container.querySelector('#tcCopy').addEventListener('click', () => {
      (navigator.clipboard ? navigator.clipboard.writeText(rec) : Promise.reject()).then(() => UI.toast('Recovery Key disalin.'), () => UI.toast('Salin manual dari kotak di atas.', 'info'));
    });
    container.querySelector('#tcDl').addEventListener('click', () => {
      const blob = new Blob([`Recovery Key Mesin Waktu LMS Rubela\nAkun: ${user.username}\nDibuat: ${new Date().toLocaleString('id-ID')}\n\n${rec}\n\nSimpan berkas ini di tempat aman. Siapa pun yang memiliki kunci ini DAN akses akunmu dapat mengganti kode F2.\n`], { type: 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recovery-key-mesin-waktu.txt';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    container.querySelector('#tcRecOk').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = normRec(container.querySelector('#tcRecLast').value);
      if (v !== normRec(rec).slice(-5)) { const er = container.querySelector('#tcErr'); er.textContent = 'Lima karakter terakhir tidak cocok.'; er.classList.remove('hidden'); return; }
      const vault = DB.getCapsuleVault(user.id);
      DB.saveCapsuleVault(user.id, Object.assign({}, vault, { recoveryConfirmed: true }));
      renderVault(container, user);
    });
  }

  function renderUnlock(container, user, vault) {
    const locked = vault.lockUntil && vault.lockUntil > Date.now();
    container.innerHTML = shell(`<form class="card tc-card tc-unlock" id="tcUnlock">
      <div class="tc-lock-ic" aria-hidden="true">🔒</div>
      <h3>Masukkan kode F2</h3>
      <p class="muted small">Brankas Mesin Waktu terkunci. Kode diperiksa dengan mencoba mendekripsi kunci suratmu di perangkat ini.</p>
      <input id="tcCode" type="password" class="input" autocomplete="current-password" aria-label="Kode F2" ${locked ? 'disabled' : ''} required />
      <div id="tcErr" class="alert alert-error ${locked ? '' : 'hidden'}" role="alert">${locked ? `Terlalu banyak percobaan. Coba lagi dalam <span id="tcLockLeft">${Math.ceil((vault.lockUntil - Date.now()) / 1000)}</span> detik.` : ''}</div>
      ${!locked && vault.fails ? `<div class="muted small">Sisa percobaan sebelum dikunci: ${MAX_FAILS - vault.fails}</div>` : ''}
      <button class="btn btn-primary btn-block" type="submit" ${locked ? 'disabled' : ''}>Buka Brankas</button>
      <button type="button" class="btn btn-ghost btn-sm" id="tcForgot">Lupa kode F2?</button></form>`);
    const f = container.querySelector('#tcUnlock');
    if (locked) {
      const t = setInterval(() => {
        const el = container.querySelector('#tcLockLeft');
        if (!el) { clearInterval(t); return; }
        const left = Math.ceil((vault.lockUntil - Date.now()) / 1000);
        if (left <= 0) { clearInterval(t); renderPage(container, user); } else el.textContent = left;
      }, 1000);
      tickTimer = t;
    } else setTimeout(() => { const c = f.querySelector('#tcCode'); if (c) c.focus(); }, 50);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memeriksa…';
      try { await unlock(user, f.querySelector('#tcCode').value); renderVault(container, user); }
      catch (ex) { UI.toast(ex.message, 'error'); renderPage(container, user); }
    });
    f.querySelector('#tcForgot').addEventListener('click', () => renderRecovery(container, user));
  }

  /* ------------------------- pemulihan F2 ------------------------- */
  function renderRecovery(container, user) {
    container.innerHTML = shell(`<div class="card tc-card">
      <div class="card-header">${UI.secHead('🛟', 'Pulihkan Kode F2', 'verifikasi identitas pemilik akun terlebih dahulu')}</div>
      <form id="tcRecForm" class="form">
        <div class="form-group"><label for="tcPw">1. Password akun Rubela (${esc(user.username)})</label><input id="tcPw" type="password" class="input" autocomplete="current-password" required /></div>
        <div class="form-group"><label>2. Pilih cara pemulihan</label>
          <label class="check-row"><input type="radio" name="mode" value="key" checked /> Saya punya Recovery Key</label>
          <label class="check-row"><input type="radio" name="mode" value="lost" /> Recovery Key hilang</label></div>
        <div id="tcModeKey">
          <div class="form-group"><label for="tcRk">Recovery Key</label><input id="tcRk" class="input" autocomplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" /></div>
          <div class="form-row"><div class="form-group"><label for="tcN1">Kode F2 baru</label><input id="tcN1" type="password" class="input" autocomplete="new-password" /></div>
            <div class="form-group"><label for="tcN2">Ulangi kode F2 baru</label><input id="tcN2" type="password" class="input" autocomplete="new-password" /></div></div>
          <p class="muted small">Isi surat tetap utuh. Recovery Key lama tidak berlaku lagi; kamu akan menerima Recovery Key baru.</p>
        </div>
        <div id="tcModeLost" class="hidden">
          <div class="alert alert-error"><strong>Konsekuensi permanen.</strong> Tanpa kode F2 dan Recovery Key, kunci enkripsi tidak dapat dipulihkan oleh siapa pun —
            termasuk admin. Reset akan <strong>menghapus seluruh surat Mesin Waktu</strong> beserta lampirannya, lalu kamu dapat membuat brankas baru.</div>
          <label class="check-row"><input type="checkbox" id="tcAck" /> Saya memahami bahwa seluruh surat akan hilang permanen.</label>
          <div class="form-group"><label for="tcType">Ketik <strong>HAPUS PERMANEN</strong> untuk melanjutkan</label><input id="tcType" class="input" autocomplete="off" /></div>
        </div>
        <div id="tcErr" class="alert alert-error hidden" role="alert"></div>
        <div class="flex-gap" style="justify-content:space-between;"><button type="button" class="btn btn-secondary" id="tcBack">← Kembali</button>
          <button class="btn btn-primary" type="submit" id="tcRecGo">Pulihkan</button></div>
      </form></div>`);
    const f = container.querySelector('#tcRecForm');
    const err = f.querySelector('#tcErr');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    f.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
      const lost = f.querySelector('input[name=mode]:checked').value === 'lost';
      f.querySelector('#tcModeKey').classList.toggle('hidden', lost);
      f.querySelector('#tcModeLost').classList.toggle('hidden', !lost);
      const go = f.querySelector('#tcRecGo'); go.textContent = lost ? 'Hapus & Reset' : 'Pulihkan'; go.className = 'btn ' + (lost ? 'btn-danger' : 'btn-primary');
    }));
    f.querySelector('#tcBack').addEventListener('click', () => renderPage(container, user));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.classList.add('hidden');
      if (pwLockUntil > Date.now()) return fail(`Terlalu banyak percobaan password. Tunggu ${Math.ceil((pwLockUntil - Date.now()) / 1000)} detik.`);
      const check = Auth.verify(user.username, f.querySelector('#tcPw').value, 'siswa');
      if (!check.ok || check.user.id !== user.id) {
        pwFails++;
        if (pwFails >= 3) { pwFails = 0; pwLockUntil = Date.now() + 60000; }
        return fail('Password akun salah. Identitas tidak dapat diverifikasi.');
      }
      pwFails = 0;
      const lost = f.querySelector('input[name=mode]:checked').value === 'lost';
      if (lost) {
        if (!f.querySelector('#tcAck').checked || f.querySelector('#tcType').value.trim() !== 'HAPUS PERMANEN') return fail('Centang pernyataan dan ketik HAPUS PERMANEN dengan tepat.');
        lock();
        DB.destroyCapsuleVault(user.id);
        if (global.BlobStore) BlobStore.removePrefix('cap:' + user.id + ':').catch(() => {});
        UI.toast('Brankas lama dihapus. Silakan buat kode F2 baru.', 'info');
        renderSetup(container, user);
        return;
      }
      const msg = validateF2(f.querySelector('#tcN1').value, f.querySelector('#tcN2').value, user);
      if (msg) return fail(msg);
      const v = DB.getCapsuleVault(user.id);
      if (v.lockUntil && v.lockUntil > Date.now()) return fail(`Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((v.lockUntil - Date.now()) / 1000)} detik.`);
      const btn = f.querySelector('#tcRecGo');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memeriksa…';
      let raw;
      try { raw = await aesDec(await derive(normRec(f.querySelector('#tcRk').value), v.recSalt, v.iter), v.wrapRec); }
      catch (ex) {
        // Recovery key salah ikut dihitung sebagai percobaan gagal (anti brute force).
        const fails = (v.fails || 0) + 1;
        const patch = Object.assign({}, v, { fails });
        if (fails >= MAX_FAILS) { const lvl = v.lockLevel || 0; Object.assign(patch, { fails: 0, lockLevel: lvl + 1, lockUntil: Date.now() + Math.min(60, Math.pow(2, lvl)) * 60000 }); }
        DB.saveCapsuleVault(user.id, patch);
        btn.disabled = false; btn.textContent = 'Pulihkan';
        return fail('Recovery Key tidak cocok.');
      }
      const rec = await rewrap(user, raw, f.querySelector('#tcN1').value, true);
      DB.logActivity('capsule.recover', 'Memulihkan kode F2 dengan Recovery Key', user.id);
      showRecovery(container, user, rec, 'Kode F2 diganti');
    });
  }

  /* ------------------------- isi brankas ------------------------- */
  async function renderVault(container, user) {
    armIdle();
    const caps = DB.getCapsules(user.id);
    const vault = DB.getCapsuleVault(user.id);
    const now = Date.now();
    container.innerHTML = shell(`<div class="card"><div class="tc-loading"><span class="spinner"></span> Membuka brankas…</div></div>`);
    // Judul didekripsi (isi surat TIDAK didekripsi sebelum waktunya).
    const titles = {};
    await Promise.all(caps.map(async c => { try { titles[c.id] = (await decJson(c.encTitle)).title; } catch (e) { titles[c.id] = '(tidak dapat didekripsi)'; } }));
    if (!container.isConnected || !session) return;
    const locked = caps.filter(c => c.openAt > now), ready = caps.filter(c => c.openAt <= now && !c.openedAt), opened = caps.filter(c => c.openedAt);
    container.innerHTML = shell(`
      ${!vault.recoveryConfirmed ? '<div class="alert alert-warning">Recovery Key belum dikonfirmasi tersimpan. Buat Recovery Key baru di bagian Keamanan bila belum menyimpannya.</div>' : ''}
      <div class="tc-bar">
        <div class="tc-stats"><span>⏳ <strong>${locked.length}</strong> terkunci</span><span>💌 <strong>${ready.length}</strong> siap dibuka</span><span>📖 <strong>${opened.length}</strong> kenangan</span></div>
        <div class="flex-gap"><button type="button" class="btn btn-primary" id="tcNew">✍️ Tulis Surat Baru</button>
          <button type="button" class="btn btn-secondary" id="tcLock">🔒 Kunci</button></div>
      </div>
      ${ready.length ? `<div class="tc-ready">${ready.map(c => `<div class="tc-env tc-t-${c.theme}" data-open-cap="${c.id}" role="button" tabindex="0" aria-label="Buka surat ${esc(titles[c.id])}">
        <div class="tc-env-flap"></div><div class="tc-env-seal">✦</div><div class="tc-env-body"><strong>${esc(titles[c.id])}</strong><span>Ditulis ${fmtDT(c.createdAt)}</span><em>Ketuk untuk membuka</em></div></div>`).join('')}</div>` : ''}
      <div class="card"><div class="card-header">${UI.secHead('🛤️', 'Perjalanan Time Capsule', 'riwayat surat dari yang terdekat dibuka')}</div>
        ${caps.length ? `<ol class="tc-timeline">${caps.slice().sort((a, b) => a.openAt - b.openAt).map(c => {
          const st = c.openedAt ? 'opened' : c.openAt <= now ? 'ready' : 'locked';
          return `<li class="tc-ti is-${st}"><span class="tc-dot" aria-hidden="true">${st === 'opened' ? '📖' : st === 'ready' ? '💌' : '🔒'}</span>
            <div class="tc-ti-body"><strong>${esc(titles[c.id])}</strong>
              <span class="muted small">Ditulis ${fmtDT(c.createdAt)} • dibuka ${fmtDT(c.openAt)}${c.extendedCount ? ` • diundur ${c.extendedCount}×` : ''}${c.attachments.length ? ` • 📎 ${c.attachments.length}` : ''}</span>
              ${st === 'locked' ? `<span class="tc-count" data-count="${c.openAt}">${fmtCountdown(c.openAt - now)}</span>` : ''}</div>
            <div class="tc-ti-act">${st === 'locked' ? `<button type="button" class="btn btn-sm btn-ghost" data-extend="${c.id}">Undur</button>` : `<button type="button" class="btn btn-sm btn-primary" data-open-cap="${c.id}">${st === 'opened' ? 'Baca lagi' : 'Buka'}</button>`}
              <button type="button" class="btn btn-sm btn-ghost" data-del-cap="${c.id}" aria-label="Hapus">🗑️</button></div></li>`;
        }).join('')}</ol>` : `<div class="empty tc-empty"><div class="empty-icon">✉️</div>Belum ada surat. Tulis surat pertamamu untuk dirimu di masa depan.</div>`}
      </div>
      ${opened.length ? `<div class="card"><div class="card-header">${UI.secHead('🗂️', 'Kartu Kenangan', 'surat yang sudah kamu baca')}</div>
        <div class="tc-memories">${opened.map(c => `<button type="button" class="tc-memory tc-t-${c.theme}" data-open-cap="${c.id}">
          <span class="tc-mem-year">${new Date(c.createdAt).getFullYear()}</span><strong>${esc(titles[c.id])}</strong>
          <span>Dari dirimu ${Math.max(0, Math.round((c.openAt - c.createdAt) / 86400000))} hari sebelumnya</span></button>`).join('')}</div></div>` : ''}
      <details class="card tc-security"><summary>🛡️ Keamanan Brankas</summary>
        <form id="tcChange" class="form mt-1"><h4>Ganti kode F2</h4>
          <div class="form-row"><div class="form-group"><label>Kode F2 saat ini</label><input type="password" class="input" name="cur" autocomplete="current-password" required /></div>
            <div class="form-group"><label>Kode F2 baru</label><input type="password" class="input" name="n1" autocomplete="new-password" required /></div>
            <div class="form-group"><label>Ulangi</label><input type="password" class="input" name="n2" autocomplete="new-password" required /></div></div>
          <label class="check-row"><input type="checkbox" name="rot" /> Buat Recovery Key baru sekaligus</label>
          <div class="tc-err alert alert-error hidden"></div><button class="btn btn-secondary btn-sm" type="submit">Ganti F2</button></form>
        <p class="muted small mt-1">Brankas dibuat ${fmtDT(vault.createdAt)} • enkripsi AES-GCM 256-bit, kunci turunan PBKDF2-SHA-256 ${Number(vault.iter || ITER).toLocaleString('id-ID')} iterasi. Terkunci otomatis setelah 10 menit tidak aktif atau saat berpindah halaman.</p>
      </details>`);
    bindVault(container, user, titles);
    tickTimer = setInterval(() => {
      let reloadNeeded = false;
      container.querySelectorAll('[data-count]').forEach(el => {
        const left = Number(el.dataset.count) - Date.now();
        el.textContent = fmtCountdown(left);
        if (left <= 0) reloadNeeded = true;
      });
      if (!container.querySelector('.tc-root')) { clearInterval(tickTimer); return; }
      if (reloadNeeded) { DB.notifyReadyCapsules(user.id); if (global.Dashboard) Dashboard.refreshNotifications(); renderVault(container, user); }
    }, 1000);
  }

  function bindVault(container, user, titles) {
    const act = () => armIdle();
    container.addEventListener('pointerdown', act);
    container.addEventListener('keydown', act);
    container.querySelector('#tcNew').addEventListener('click', () => renderCompose(container, user));
    container.querySelector('#tcLock').addEventListener('click', () => { lock(); renderPage(container, user); });
    container.querySelectorAll('[data-open-cap]').forEach(el => {
      const open = () => openCapsule(container, user, el.dataset.openCap, el.classList.contains('tc-env'));
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    container.querySelectorAll('[data-del-cap]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog(`Hapus surat "${titles[b.dataset.delCap]}" secara permanen?`)) return;
      const cap = DB.getCapsules(user.id).find(c => c.id === b.dataset.delCap);
      DB.deleteCapsule(user.id, b.dataset.delCap);
      if (cap && global.BlobStore) cap.attachments.forEach(a => BlobStore.remove(`cap:${user.id}:${a.id}`).catch(() => {}));
      UI.toast('Surat dihapus.'); renderVault(container, user);
    }));
    container.querySelectorAll('[data-extend]').forEach(b => b.addEventListener('click', () => {
      const cap = DB.getCapsules(user.id).find(c => c.id === b.dataset.extend);
      UI.modal.open('Undur waktu pembukaan', `<form id="tcExt" class="form"><p class="muted small">Waktu pembukaan hanya dapat diundur, tidak dimajukan. Saat ini: ${fmtDT(cap.openAt)}.</p>
        <div class="form-group"><label>Waktu pembukaan baru</label><input type="datetime-local" class="input" name="at" required value="${toLocalInput(cap.openAt + 30 * 86400000)}" /></div>
        <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Simpan</button></div></form>`);
      document.getElementById('tcExt').addEventListener('submit', (e) => {
        e.preventDefault();
        try { DB.updateCapsule(user.id, cap.id, { openAt: new Date(e.target.at.value).getTime() }); UI.modal.close(); UI.toast('Waktu pembukaan diundur.'); renderVault(container, user); }
        catch (ex) { UI.toast(ex.message, 'error'); }
      });
    }));
    const ch = container.querySelector('#tcChange');
    ch.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = ch.querySelector('.tc-err');
      const show = (m) => { err.textContent = m; err.classList.remove('hidden'); };
      const msg = validateF2(ch.n1.value, ch.n2.value, user);
      if (msg) return show(msg);
      const v = DB.getCapsuleVault(user.id);
      try { await aesDec(await derive(ch.cur.value, v.salt, v.iter), v.wrapF2); } catch (ex) { return show('Kode F2 saat ini salah.'); }
      const rec = await rewrap(user, session.raw, ch.n1.value, ch.rot.checked);
      DB.logActivity('capsule.f2', 'Mengganti kode F2 Mesin Waktu', user.id);
      if (rec) showRecovery(container, user, rec, 'Kode F2 diganti'); else { UI.toast('Kode F2 diganti.'); renderVault(container, user); }
    });
  }

  function toLocalInput(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderCompose(container, user) {
    armIdle();
    const atts = [];
    const presets = [['1 bulan', 30], ['6 bulan', 182], ['1 tahun', 365], ['Setelah UTBK (± 8 bulan)', 240], ['5 tahun', 1826]];
    container.innerHTML = shell(`<form class="card tc-card tc-compose" id="tcForm">
      <div class="card-header">${UI.secHead('✍️', 'Surat untuk Diriku di Masa Depan', 'semua isian dienkripsi sebelum disimpan')}
        <button type="button" class="btn btn-sm btn-secondary" id="tcCancel">Batal</button></div>
      <div class="form-group"><label for="tcTitle">Judul surat</label><input id="tcTitle" class="input" maxlength="120" required placeholder="mis. Untukku yang sudah kuliah" /></div>
      <div class="form-group"><label>Isi surat</label>${Editor.toolbarHtml('tcBody', { noAi: true, noAudio: true })}
        <div id="tcBody" class="qe-editor ce-editor-tall tc-paper" contenteditable="true" data-ph="Saat aku menulis surat ini, aku sedang berjuang…"></div>
        <div class="muted small">Bantuan AI sengaja tidak tersedia di sini agar isi suratmu tidak pernah dikirim ke layanan luar.</div></div>
      <div class="form-row">
        <div class="form-group"><label for="tcHope">Harapan</label><textarea id="tcHope" rows="3" maxlength="1500"></textarea></div>
        <div class="form-group"><label for="tcTarget">Target pendidikan</label><textarea id="tcTarget" rows="3" maxlength="1500" placeholder="mis. Lolos SNBT di ${esc(user.targetUniv || 'kampus impian')}"></textarea></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label for="tcDream">Cita-cita</label><textarea id="tcDream" rows="3" maxlength="1500"></textarea></div>
        <div class="form-group"><label for="tcRefl">Refleksi hari ini</label><textarea id="tcRefl" rows="3" maxlength="1500"></textarea></div>
      </div>
      <div class="form-group"><label>Lampiran (maks. ${MAX_ATTACH}: foto JPG/PNG/WEBP atau PDF ≤ 2 MB)</label>
        <input type="file" id="tcFiles" accept="image/jpeg,image/png,image/webp,application/pdf" multiple class="input" />
        <div class="tc-atts" id="tcAtts"></div></div>
      <div class="form-row">
        <div class="form-group"><label for="tcAt">Tanggal & waktu pembukaan</label><input id="tcAt" type="datetime-local" class="input" required value="${toLocalInput(Date.now() + 365 * 86400000)}" min="${toLocalInput(Date.now() + 11 * 60000)}" />
          <div class="tc-presets">${presets.map(([l, d]) => `<button type="button" class="chip" data-days="${d}">${l}</button>`).join('')}</div></div>
        <div class="form-group"><label>Nuansa amplop</label><div class="tc-themes">${Object.keys(THEMES).map((k, i) => `<label class="tc-theme tc-t-${k}"><input type="radio" name="theme" value="${k}" ${i === 0 ? 'checked' : ''}/><span>${THEMES[k]}</span></label>`).join('')}</div></div>
      </div>
      <div id="tcErr" class="alert alert-error hidden" role="alert"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">🔒 Segel & Kirim ke Masa Depan</button></div></form>`);
    const f = container.querySelector('#tcForm');
    Editor.attach(f);
    f.querySelector('#tcCancel').addEventListener('click', () => renderVault(container, user));
    f.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => { f.querySelector('#tcAt').value = toLocalInput(Date.now() + Number(b.dataset.days) * 86400000); }));
    const paintAtts = () => {
      f.querySelector('#tcAtts').innerHTML = atts.map((a, i) => `<span class="tc-att">${a.kind === 'pdf' ? '📄' : `<img src="${a.preview}" alt="" />`} ${esc(a.name)} <button type="button" data-rm="${i}" aria-label="Hapus lampiran">✕</button></span>`).join('');
      f.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { atts.splice(Number(b.dataset.rm), 1); paintAtts(); }));
    };
    f.querySelector('#tcFiles').addEventListener('change', async (e) => {
      for (const file of [...e.target.files]) {
        if (atts.length >= MAX_ATTACH) { UI.toast(`Maksimal ${MAX_ATTACH} lampiran.`, 'error'); break; }
        try {
          if (file.type === 'application/pdf') {
            if (file.size > MAX_PDF) throw new Error(`${file.name}: PDF maksimal 2 MB.`);
            const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
            if (String.fromCharCode(...head) !== '%PDF-') throw new Error(`${file.name}: bukan berkas PDF yang valid.`);
            atts.push({ kind: 'pdf', name: file.name.slice(0, 80), bytes: new Uint8Array(await file.arrayBuffer()) });
          } else if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
            const url = await Editor.compressImage(file);
            atts.push({ kind: 'image', name: file.name.slice(0, 80), preview: url, bytes: enc.encode(url) });
          } else throw new Error(`${file.name}: format tidak didukung.`);
        } catch (ex) { UI.toast(ex.message, 'error'); }
      }
      e.target.value = '';
      paintAtts();
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('#tcErr');
      const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
      err.classList.add('hidden');
      if (!session) { renderPage(container, user); return; }
      const title = f.querySelector('#tcTitle').value.trim();
      const body = RichText.sanitize(f.querySelector('#tcBody').innerHTML);
      const plain = DataSearch.plain(body).trim();
      if (!title) return fail('Judul wajib diisi.');
      if (plain.length < 20) return fail('Isi surat minimal 20 karakter.');
      const openAt = new Date(f.querySelector('#tcAt').value).getTime();
      if (!Number.isFinite(openAt)) return fail('Pilih tanggal & waktu pembukaan.');
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Mengenkripsi…';
      try {
        const attMeta = [];
        for (const a of atts) {
          const id = 'att_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const boxed = await aesEnc(session.key, a.bytes);
          await BlobStore.put(`cap:${user.id}:${id}`, new Blob([JSON.stringify(boxed)], { type: 'application/octet-stream' }));
          attMeta.push({ id, size: a.bytes.length, kind: a.kind, name: a.name });
        }
        const v = (id) => f.querySelector(id).value.trim();
        const cap = DB.addCapsule(user.id, {
          openAt, theme: (f.querySelector('input[name=theme]:checked') || {}).value,
          encTitle: await encJson({ title }),
          encBody: await encJson({ body, hope: v('#tcHope'), target: v('#tcTarget'), dream: v('#tcDream'), reflection: v('#tcRefl'), names: attMeta.map(a => a.name), mood: '' }),
          attachments: attMeta
        });
        sealAnimation(container, cap, () => { UI.toast('Surat tersegel. Sampai jumpa di masa depan! 💌'); renderVault(container, user); });
      } catch (ex) {
        btn.disabled = false; btn.textContent = '🔒 Segel & Kirim ke Masa Depan';
        fail(/quota/i.test(String(ex && ex.name) + ex.message) ? 'Penyimpanan perangkat penuh. Kurangi lampiran.' : (ex.message || 'Gagal menyimpan surat.'));
      }
    });
  }

  function sealAnimation(container, cap, done) {
    const reduce = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { done(); return; }
    const ov = document.createElement('div');
    ov.className = 'tc-overlay';
    ov.innerHTML = `<div class="tc-seal-anim tc-t-${cap.theme}"><div class="tc-letter"></div><div class="tc-env-big"><div class="tc-env-flap"></div><div class="tc-env-seal">✦</div></div>
      <p>Disegel hingga ${fmtDT(cap.openAt)}</p></div>`;
    document.body.appendChild(ov);
    setTimeout(() => { ov.classList.add('is-out'); setTimeout(() => { ov.remove(); done(); }, 400); }, 2100);
  }

  async function openCapsule(container, user, id, animate) {
    if (!session) { renderPage(container, user); return; }
    const cap = DB.getCapsules(user.id).find(c => c.id === id);
    if (!cap) return;
    if (cap.openAt > Date.now()) { UI.toast('Surat ini belum waktunya dibuka.', 'error'); return; }
    let title, body;
    try { title = (await decJson(cap.encTitle)).title; body = await decJson(cap.encBody); }
    catch (e) { UI.toast('Surat tidak dapat didekripsi.', 'error'); return; }
    const first = !cap.openedAt;
    DB.updateCapsule(user.id, id, { openedAt: true });
    const atts = [];
    for (const a of cap.attachments) {
      try {
        const blob = await BlobStore.get(`cap:${user.id}:${a.id}`);
        if (!blob) { atts.push({ kind: a.kind, missing: true }); continue; }
        const bytes = await aesDec(session.key, JSON.parse(await blob.text()));
        if (a.kind === 'pdf') { const u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); objectUrls.push(u); atts.push({ kind: 'pdf', url: u, name: (body.names || [])[atts.length] || 'lampiran.pdf' }); }
        else atts.push({ kind: 'image', url: dec.decode(bytes) });
      } catch (e) { atts.push({ kind: a.kind, missing: true }); }
    }
    const section = (label, v) => v ? `<div class="tc-sec"><h4>${label}</h4><p>${esc(v).replace(/\n/g, '<br>')}</p></div>` : '';
    const html = `<article class="tc-letter-view tc-t-${cap.theme} ${first && animate !== false ? 'is-unfold' : ''}">
      <div class="tc-letter-meta">Ditulis ${fmtDT(cap.createdAt)} • dibuka ${fmtDT(Date.now())} • ${Math.round((Date.now() - cap.createdAt) / 86400000)} hari perjalanan</div>
      <h2>${esc(title)}</h2>
      <div class="rt-content tc-letter-body">${RichText.render(body.body)}</div>
      ${section('🌱 Harapan', body.hope)}${section('🎓 Target pendidikan', body.target)}${section('✨ Cita-cita', body.dream)}${section('🪞 Refleksi', body.reflection)}
      ${atts.length ? `<div class="tc-sec"><h4>📎 Lampiran</h4><div class="tc-att-view">${atts.map(a => a.missing ? '<span class="muted small">Lampiran tidak tersedia di perangkat ini.</span>'
        : a.kind === 'pdf' ? `<a class="btn btn-sm btn-secondary" href="${a.url}" target="_blank" rel="noopener">📄 ${esc(a.name)}</a>` : `<img src="${esc(a.url)}" alt="Lampiran foto" />`).join('')}</div></div>` : ''}
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="tcCloseLetter">Tutup</button></div></article>`;
    const show = () => {
      container.querySelector('.tc-root').innerHTML = html;
      container.querySelector('#tcCloseLetter').addEventListener('click', () => renderVault(container, user));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    if (first && animate !== false && !(global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      const ov = document.createElement('div');
      ov.className = 'tc-overlay is-open';
      ov.innerHTML = `<div class="tc-seal-anim is-opening tc-t-${cap.theme}"><div class="tc-env-big"><div class="tc-env-flap"></div><div class="tc-env-seal">✦</div></div><div class="tc-letter"></div><p>Membuka surat dari masa lalu…</p></div>`;
      document.body.appendChild(ov);
      setTimeout(() => { ov.classList.add('is-out'); setTimeout(() => { ov.remove(); show(); }, 400); }, 1900);
    } else show();
  }

  /* ------------------------- admin: operasional saja ------------------------- */
  function renderAdmin(container, admin) {
    const st = DB.getSettings();
    let rows;
    try { rows = DB.capsuleStats(admin); } catch (e) { container.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; return; }
    container.innerHTML = `
      <div class="alert alert-info">🔐 Isi Mesin Waktu dienkripsi di perangkat mentee dengan kode F2 pribadi. Halaman ini hanya menampilkan data operasional — admin <strong>tidak dapat</strong> membaca judul, isi, atau lampiran, dan tidak dapat mengambil/mereset kode F2 mentee.</div>
      <form class="card form" id="tcAdmForm"><div class="card-header">${UI.secHead('⚙️', 'Pengaturan Mesin Waktu', 'berlaku untuk semua mentee')}</div>
        <label class="check-row"><input type="checkbox" name="on" ${st.capsuleEnabled !== false ? 'checked' : ''}/> Aktifkan Mesin Waktu</label>
        <div class="form-group"><label>Maksimal kapsul per mentee</label><input type="number" class="input" name="max" min="1" max="100" value="${st.capsuleMaxPerUser}" style="max-width:160px;" /></div>
        <button class="btn btn-primary btn-sm" type="submit">Simpan</button></form>
      <div class="card"><div class="card-header">${UI.secHead('📊', 'Status Operasional', 'jumlah kapsul per mentee, tanpa konten')}</div><div id="tcAdmList"></div></div>`;
    container.querySelector('#tcAdmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = Math.round(Number(e.target.max.value));
      if (!(n >= 1 && n <= 100)) { UI.toast('Maksimal kapsul 1–100.', 'error'); return; }
      DB.setSetting('capsuleEnabled', e.target.on.checked); DB.setSetting('capsuleMaxPerUser', n);
      UI.toast('Pengaturan Mesin Waktu disimpan.');
    });
    DataSearch.mount({
      container: container.querySelector('#tcAdmList'), items: rows, stateKey: 'tc-admin',
      placeholder: 'Cari nama atau kelas mentee…', fields: r => [r.name, r.kelas],
      filters: [{ key: 'v', label: 'Semua', get: r => r.hasVault ? 'yes' : 'no', options: [{ value: 'yes', label: 'Sudah membuat brankas' }, { value: 'no', label: 'Belum' }] }],
      sorts: [{ key: 'n', label: 'Kapsul terbanyak', cmp: (a, b) => b.total - a.total }, { key: 'name', label: 'Nama A–Z', cmp: (a, b) => a.name.localeCompare(b.name) }],
      pageSize: 20, empty: 'Belum ada mentee.',
      render: (list, ctx) => `<div class="table-wrap"><table class="table"><thead><tr><th>Mentee</th><th>Brankas</th><th>Total</th><th>Terkunci</th><th>Siap dibuka</th><th>Dibuka</th><th>Pembukaan berikutnya</th><th>Ukuran</th></tr></thead>
        <tbody>${list.map(r => `<tr><td><strong>${ctx.highlight(r.name)}</strong><div class="muted small">${ctx.highlight(r.kelas || '-')}</div></td>
          <td>${r.hasVault ? (r.lockedOut ? '<span class="badge badge-warning">Terkunci sementara</span>' : '<span class="badge badge-success">Aktif</span>') : '<span class="badge badge-gray">Belum</span>'}</td>
          <td>${r.total}</td><td>${r.locked}</td><td>${r.ready}</td><td>${r.opened}</td><td>${r.nextOpen ? UI.fmtDate(r.nextOpen) : '-'}</td><td>${Math.round(r.approxBytes / 1024)} KB</td></tr>`).join('')}</tbody></table></div>`
    });
  }

  global.addEventListener('pagehide', lock);
  global.TimeCapsule = { renderPage, renderAdmin, lock, isUnlocked: () => !!session };
})(window);
