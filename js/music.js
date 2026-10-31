/* =====================================================================
 * js/music.js — Musik latar global
 * ---------------------------------------------------------------------
 * - Admin mengunggah MP3/WAV/OGG (validasi ekstensi, MIME, signature
 *   berkas, ukuran, durasi, kuota), menulis judul/artis/cover/suasana,
 *   dan WAJIB mengonfirmasi hak penggunaan + jenis lisensi.
 * - Berkas audio disimpan di IndexedDB (BlobStore), metadata di DB.
 * - Pemutar mini hidup di "shell" dashboard (SPA), sehingga musik TIDAK
 *   dimulai ulang saat berpindah menu. Posisi lagu juga dilanjutkan bila
 *   halaman dimuat ulang dalam sesi yang sama.
 * - Autoplay hanya bila diizinkan browser & pengguna tidak memilih
 *   Pause/Mute; otomatis berhenti selama ujian (body.exam-mode).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_TOTAL = 150 * 1024 * 1024;
  const MAX_TRACKS = 40;
  const MIN_SEC = 5, MAX_SEC = 20 * 60;
  const FORMATS = {
    mp3: ['audio/mpeg', 'audio/mp3', 'audio/mpeg3', 'audio/x-mpeg-3'],
    wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
    ogg: ['audio/ogg', 'application/ogg', 'audio/vorbis']
  };

  /* ------------------------- validasi berkas ------------------------- */
  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
    if (s(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'mp3';
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
    if (s(0, 4) === 'OggS') return 'ogg';
    return '';
  }
  function durationOf(blob) {
    return new Promise((resolve, reject) => {
      const a = new Audio();
      const url = URL.createObjectURL(blob);
      const done = (fn, v) => { URL.revokeObjectURL(url); fn(v); };
      const t = setTimeout(() => done(reject, new Error('Durasi audio tidak dapat dibaca.')), 15000);
      a.preload = 'metadata';
      a.onloadedmetadata = () => { clearTimeout(t); done(resolve, a.duration); };
      a.onerror = () => { clearTimeout(t); done(reject, new Error('Berkas audio tidak dapat diputar browser ini.')); };
      a.src = url;
    });
  }
  async function validateAudio(file, replacingId) {
    if (!file) throw new Error('Pilih berkas audio.');
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FORMATS[ext]) throw new Error('Format harus MP3, WAV, atau OGG.');
    if (file.type && !FORMATS[ext].includes(file.type)) throw new Error(`Tipe berkas (${file.type}) tidak sesuai ekstensi .${ext}.`);
    if (file.size > MAX_BYTES) throw new Error(`Ukuran maksimal ${MAX_BYTES / 1048576} MB per lagu.`);
    if (file.size < 1024) throw new Error('Berkas terlalu kecil atau rusak.');
    const kind = await sniff(file);
    if (kind !== ext) throw new Error('Isi berkas bukan audio ' + ext.toUpperCase() + ' yang valid.');
    const tracks = DB.getMusicTracks();
    if (!replacingId && tracks.length >= MAX_TRACKS) throw new Error(`Maksimal ${MAX_TRACKS} lagu.`);
    const used = await BlobStore.usage('music:');
    const old = replacingId ? (tracks.find(t => t.id === replacingId) || {}).size || 0 : 0;
    if (used - old + file.size > MAX_TOTAL) throw new Error(`Batas penyimpanan musik ${MAX_TOTAL / 1048576} MB terlampaui.`);
    if (navigator.storage && navigator.storage.estimate) {
      try { const est = await navigator.storage.estimate(); if (est.quota && est.usage + file.size > est.quota * 0.9) throw new Error('Penyimpanan browser hampir penuh.'); }
      catch (e) { if (/penuh/.test(e.message)) throw e; }
    }
    const sec = await durationOf(file);
    if (!Number.isFinite(sec) || sec < MIN_SEC) throw new Error(`Durasi minimal ${MIN_SEC} detik.`);
    if (sec > MAX_SEC) throw new Error(`Durasi maksimal ${MAX_SEC / 60} menit.`);
    return { mime: FORMATS[ext][0], size: file.size, duration: Math.round(sec), fileName: file.name };
  }
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';

  /* =====================================================================
   * PEMUTAR (shell dashboard)
   * ===================================================================*/
  let player = null;

  function prefKey(u) { return 'lms_music_pref:' + u.id; }
  function loadPref(u) {
    const st = DB.getSettings();
    try { return Object.assign({ volume: Number(st.musicDefaultVolume) || 35, muted: false, paused: false, mood: '', collapsed: false }, JSON.parse(localStorage.getItem(prefKey(u)) || '{}')); }
    catch (e) { return { volume: 35, muted: false, paused: false, mood: '', collapsed: false }; }
  }

  function available(user) {
    const st = DB.getSettings();
    return st.musicEnabled === true && (st.musicDashboards || []).includes(user.role) && global.BlobStore && BlobStore.available();
  }

  function playlistFor(pref) {
    const st = DB.getSettings();
    let list = DB.getMusicTracks().filter(t => t.active !== false);
    if (pref.mood) { const m = list.filter(t => t.mood === pref.mood); if (m.length) list = m; }
    const main = list.findIndex(t => t.id === st.musicMainTrackId);
    if (main > 0) list.unshift(list.splice(main, 1)[0]);
    if (st.musicShuffle && list.length > 2) {
      const head = list.shift();
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      list.unshift(head);
    }
    return list;
  }

  function init(user) {
    destroyPlayer();
    if (!user || !available(user)) return;
    const pref = loadPref(user);
    const audio = new Audio();
    audio.preload = 'auto';
    const el = document.createElement('div');
    el.className = 'mp' + (pref.collapsed ? ' is-collapsed' : '');
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Pemutar musik latar');
    document.body.appendChild(el);
    document.body.classList.add('has-mp');
    player = { user, pref, audio, el, list: [], idx: 0, url: '', suspended: false, wasPlaying: false, blocked: false, saveT: null, observer: null };
    player.list = playlistFor(pref);
    if (!player.list.length) { el.remove(); document.body.classList.remove('has-mp'); player = null; return; }

    // Lanjutkan posisi dari sesi yang sama (reload halaman).
    let resume = null;
    try { resume = JSON.parse(sessionStorage.getItem('lms_music_pos') || 'null'); } catch (e) { resume = null; }
    if (resume && resume.u === user.id) { const i = player.list.findIndex(t => t.id === resume.id); if (i >= 0) player.idx = i; }

    audio.volume = Math.max(0, Math.min(1, pref.volume / 100));
    audio.muted = !!pref.muted;
    audio.addEventListener('ended', () => next(1, true));
    audio.addEventListener('timeupdate', paintProgress);
    audio.addEventListener('play', paint);
    audio.addEventListener('pause', paint);
    audio.addEventListener('error', () => { if (player && player.list.length > 1) next(1, true); });
    player.saveT = setInterval(savePos, 3000);
    global.addEventListener('pagehide', savePos);

    // Jangan mengganggu ujian: berhenti saat body.exam-mode, lanjut setelahnya.
    player.observer = new MutationObserver(() => {
      const exam = document.body.classList.contains('exam-mode');
      if (exam && !player.suspended) suspend(true); else if (!exam && player.suspended) suspend(false);
    });
    player.observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    paint();
    load(player.idx, resume && resume.u === user.id ? resume.t : 0).then(() => {
      if (!player) return;
      const st = DB.getSettings();
      if (st.musicAutoplay !== false && !pref.paused && !document.body.classList.contains('exam-mode')) tryPlay();
    });
  }

  async function load(i, at) {
    const p = player;
    if (!p || !p.list.length) return;
    p.idx = (i + p.list.length) % p.list.length;
    const t = p.list[p.idx];
    try {
      const blob = await BlobStore.get(t.blobKey);
      if (!player || player !== p) return;
      if (!blob) throw new Error('missing');
      if (p.url) URL.revokeObjectURL(p.url);
      p.url = URL.createObjectURL(blob);
      p.audio.src = p.url;
      if (at) p.audio.addEventListener('loadedmetadata', () => { try { p.audio.currentTime = Math.min(at, (p.audio.duration || at) - 1); } catch (e) { /* noop */ } }, { once: true });
    } catch (e) {
      p.list.splice(p.idx, 1);
      if (p.list.length) return load(p.idx, 0);
      destroyPlayer();
      return;
    }
    paint();
  }

  function tryPlay() {
    if (!player || player.suspended) return;
    player.audio.play().then(() => { player.blocked = false; paint(); }).catch(() => { player.blocked = true; paint(); });
  }
  function setPref(patch) {
    Object.assign(player.pref, patch);
    try { localStorage.setItem(prefKey(player.user), JSON.stringify(player.pref)); } catch (e) { /* noop */ }
  }
  function toggle() {
    if (!player) return;
    if (player.audio.paused) { setPref({ paused: false }); tryPlay(); }
    else { player.audio.pause(); setPref({ paused: true }); }
  }
  async function next(dir, keepPlaying) {
    if (!player) return;
    const playing = keepPlaying || !player.audio.paused;
    await load(player.idx + dir, 0);
    if (playing && player && !player.pref.paused) tryPlay();
  }
  function suspend(on) {
    if (!player) return;
    if (on) { player.wasPlaying = !player.audio.paused; player.audio.pause(); player.suspended = true; }
    else { player.suspended = false; if (player.wasPlaying && !player.pref.paused) tryPlay(); }
    paint();
  }
  function savePos() {
    if (!player || !player.list[player.idx]) return;
    try { sessionStorage.setItem('lms_music_pos', JSON.stringify({ u: player.user.id, id: player.list[player.idx].id, t: player.audio.currentTime || 0 })); } catch (e) { /* noop */ }
  }

  function paint() {
    const p = player;
    if (!p) return;
    const t = p.list[p.idx] || {};
    const playing = !p.audio.paused;
    p.el.className = 'mp' + (p.pref.collapsed ? ' is-collapsed' : '') + (playing ? ' is-playing' : '') + (p.blocked ? ' is-blocked' : '') + (p.suspended ? ' is-suspended' : '');
    p.el.innerHTML = `
      <button type="button" class="mp-cover" data-mp="collapse" aria-label="${p.pref.collapsed ? 'Perluas pemutar' : 'Ciutkan pemutar'}" title="${p.pref.collapsed ? 'Perluas' : 'Ciutkan'}">
        ${t.cover ? `<img src="${esc(t.cover)}" alt="" />` : '<span>♪</span>'}<i class="mp-eq" aria-hidden="true"><b></b><b></b><b></b></i></button>
      <div class="mp-body">
        <div class="mp-meta"><strong title="${esc(t.title || '')}">${esc(t.title || 'Musik latar')}</strong><span>${esc(t.artist || '')}${p.suspended ? ' • dijeda saat ujian' : ''}</span></div>
        <div class="mp-prog"><span class="mp-time" data-mp-cur>${fmtTime(p.audio.currentTime)}</span>
          <input type="range" class="mp-seek" min="0" max="1000" value="${p.audio.duration ? Math.round(p.audio.currentTime / p.audio.duration * 1000) : 0}" aria-label="Posisi lagu" data-mp-seek />
          <span class="mp-time" data-mp-dur>${fmtTime(p.audio.duration || t.duration)}</span></div>
      </div>
      <div class="mp-ctrl">
        <button type="button" class="mp-btn" data-mp="prev" aria-label="Lagu sebelumnya" title="Sebelumnya" ${p.list.length < 2 ? 'disabled' : ''}>⏮</button>
        <button type="button" class="mp-btn mp-play" data-mp="play" aria-label="${playing ? 'Jeda' : 'Putar'}" title="${playing ? 'Jeda' : 'Putar'}" ${p.suspended ? 'disabled' : ''}>${playing ? '⏸' : '▶'}</button>
        <button type="button" class="mp-btn" data-mp="next" aria-label="Lagu berikutnya" title="Berikutnya" ${p.list.length < 2 ? 'disabled' : ''}>⏭</button>
        <button type="button" class="mp-btn" data-mp="mute" aria-label="${p.audio.muted ? 'Bunyikan' : 'Bisukan'}" title="${p.audio.muted ? 'Bunyikan' : 'Bisukan'}">${p.audio.muted || p.pref.volume === 0 ? '🔇' : '🔊'}</button>
        <input type="range" class="mp-vol" min="0" max="100" value="${p.pref.volume}" aria-label="Volume" data-mp-vol />
        <button type="button" class="mp-btn" data-mp="settings" aria-label="Preferensi musik" title="Preferensi">⚙</button>
      </div>
      ${p.blocked && !playing ? '<button type="button" class="mp-prompt" data-mp="play">▶ Putar musik latar</button>' : ''}
      <div class="mp-pop hidden" data-mp-pop>
        <label>Suasana<select class="input" data-mp-mood><option value="">Semua playlist</option>${DB.MUSIC_MOODS.map(m => `<option value="${m.key}" ${p.pref.mood === m.key ? 'selected' : ''}>${m.icon} ${m.label}</option>`).join('')}</select></label>
        <ol class="mp-list">${p.list.map((x, i) => `<li><button type="button" data-mp-track="${i}" class="${i === p.idx ? 'is-on' : ''}">${esc(x.title)} <span>${esc(x.artist)}</span></button></li>`).join('')}</ol>
        <p class="muted small">Preferensi (volume, bisu, jeda) tersimpan di perangkat ini.</p>
      </div>`;
    p.el.querySelectorAll('[data-mp]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = b.dataset.mp;
      if (k === 'play') toggle();
      else if (k === 'prev') next(-1);
      else if (k === 'next') next(1);
      else if (k === 'mute') { p.audio.muted = !p.audio.muted; setPref({ muted: p.audio.muted }); paint(); }
      else if (k === 'collapse') { setPref({ collapsed: !p.pref.collapsed }); paint(); }
      else if (k === 'settings') p.el.querySelector('[data-mp-pop]').classList.toggle('hidden');
    }));
    const vol = p.el.querySelector('[data-mp-vol]');
    vol.addEventListener('input', () => {
      const v = Number(vol.value);
      p.audio.volume = v / 100;
      if (v > 0 && p.audio.muted) p.audio.muted = false;
      setPref({ volume: v, muted: p.audio.muted });
      const mute = p.el.querySelector('[data-mp=mute]');
      if (mute) mute.textContent = p.audio.muted || v === 0 ? '🔇' : '🔊';
    });
    const seek = p.el.querySelector('[data-mp-seek]');
    seek.addEventListener('input', () => { if (p.audio.duration) p.audio.currentTime = Number(seek.value) / 1000 * p.audio.duration; });
    const mood = p.el.querySelector('[data-mp-mood]');
    mood.addEventListener('change', async () => {
      setPref({ mood: mood.value });
      const playing2 = !p.audio.paused;
      p.list = playlistFor(p.pref);
      if (!p.list.length) return;
      await load(0, 0);
      if (playing2) tryPlay();
    });
    p.el.querySelectorAll('[data-mp-track]').forEach(b => b.addEventListener('click', async () => {
      await load(Number(b.dataset.mpTrack), 0); setPref({ paused: false }); tryPlay();
    }));
  }
  function paintProgress() {
    const p = player;
    if (!p) return;
    const cur = p.el.querySelector('[data-mp-cur]'), dur = p.el.querySelector('[data-mp-dur]'), seek = p.el.querySelector('[data-mp-seek]');
    if (cur) cur.textContent = fmtTime(p.audio.currentTime);
    if (dur && p.audio.duration) dur.textContent = fmtTime(p.audio.duration);
    if (seek && p.audio.duration && document.activeElement !== seek) seek.value = Math.round(p.audio.currentTime / p.audio.duration * 1000);
  }

  function destroyPlayer() {
    if (!player) return;
    savePos();
    clearInterval(player.saveT);
    if (player.observer) player.observer.disconnect();
    player.audio.pause();
    if (player.url) URL.revokeObjectURL(player.url);
    player.el.remove();
    document.body.classList.remove('has-mp');
    global.removeEventListener('pagehide', savePos);
    player = null;
  }
  /** Muat ulang daftar lagu tanpa memulai ulang lagu yang sedang diputar. */
  function refresh() {
    if (!player) { if (global.Dashboard && Dashboard.currentUser) init(Dashboard.currentUser); return; }
    if (!available(player.user)) { destroyPlayer(); return; }
    const curId = (player.list[player.idx] || {}).id;
    const list = playlistFor(player.pref);
    if (!list.length) { destroyPlayer(); return; }
    player.list = list;
    const i = list.findIndex(t => t.id === curId);
    if (i >= 0) { player.idx = i; paint(); }
    else load(0, 0).then(() => { if (player && !player.pref.paused) tryPlay(); });
  }
  global.addEventListener('storage', (e) => { if (e.key === 'lms_music_tracks' || e.key === 'lms_settings') refresh(); });

  /* =====================================================================
   * ADMIN: kelola musik
   * ===================================================================*/
  async function renderAdmin(container, admin) {
    const st = DB.getSettings();
    const tracks = DB.getMusicTracks();
    const ROLES = { admin: 'Admin & Staff', guru: 'Tutor', siswa: 'Mentee', orangtua: 'Orang Tua' };
    container.innerHTML = `
      <div class="sk-grid">
        <form class="card form" id="muSet"><div class="card-header">${UI.secHead('🎵', 'Pengaturan Musik Global', 'berlaku di dashboard yang dipilih')}</div>
          <label class="check-row"><input type="checkbox" name="on" ${st.musicEnabled ? 'checked' : ''}/> Aktifkan musik latar</label>
          <div class="form-group"><label>Tampil di dashboard</label>${Object.keys(ROLES).map(r => `<label class="check-row"><input type="checkbox" name="role" value="${r}" ${(st.musicDashboards || []).includes(r) ? 'checked' : ''}/> ${ROLES[r]}</label>`).join('')}</div>
          <div class="form-group"><label>Musik utama (diputar pertama)</label><select class="input" name="main"><option value="">— urutan playlist —</option>${tracks.map(t => `<option value="${t.id}" ${st.musicMainTrackId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></div>
          <div class="form-group"><label>Volume bawaan: <strong data-vv>${st.musicDefaultVolume}</strong>%</label><input type="range" name="vol" min="0" max="100" value="${st.musicDefaultVolume}" /></div>
          <label class="check-row"><input type="checkbox" name="auto" ${st.musicAutoplay !== false ? 'checked' : ''}/> Putar otomatis bila diizinkan browser</label>
          <label class="check-row"><input type="checkbox" name="shuffle" ${st.musicShuffle ? 'checked' : ''}/> Acak urutan (lagu utama tetap pertama)</label>
          <p class="muted small">Musik otomatis berhenti selama ujian/tryout dan tidak pernah diputar bila pengguna memilih Jeda atau Bisu.</p>
          <button class="btn btn-primary btn-sm" type="submit">Simpan Pengaturan</button></form>
        <form class="card form" id="muUp"><div class="card-header">${UI.secHead('⬆️', 'Unggah Musik', 'MP3, WAV, atau OGG • maks. 15 MB • 5 detik–20 menit')}</div>
          <div class="form-group"><label>Berkas audio</label><input type="file" name="file" class="input" accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg" required /></div>
          <div class="form-row"><div class="form-group"><label>Judul lagu</label><input name="title" class="input" maxlength="120" required /></div>
            <div class="form-group"><label>Artis / pencipta</label><input name="artist" class="input" maxlength="120" required /></div></div>
          <div class="form-row"><div class="form-group"><label>Suasana belajar</label><select name="mood" class="input">${DB.MUSIC_MOODS.map(m => `<option value="${m.key}">${m.icon} ${m.label}</option>`).join('')}</select></div>
            <div class="form-group"><label>Cover (opsional)</label><input type="file" name="cover" class="input" accept="image/jpeg,image/png,image/webp" /></div></div>
          <div class="form-row"><div class="form-group"><label>Jenis lisensi</label><input name="license" class="input" maxlength="120" required placeholder="mis. CC BY 4.0, royalty-free, karya sendiri" /></div>
            <div class="form-group"><label>Sumber / bukti lisensi (opsional)</label><input name="source" class="input" maxlength="300" placeholder="URL halaman lisensi" /></div></div>
          <label class="check-row"><input type="checkbox" name="rights" required /> Saya menyatakan Rubela memiliki hak menggunakan musik ini di platform pembelajaran.</label>
          <div id="muErr" class="alert alert-error hidden" role="alert"></div>
          <button class="btn btn-primary btn-sm" type="submit">Unggah</button></form>
      </div>
      <div class="card"><div class="card-header">${UI.secHead('🎶', `Playlist (${tracks.length})`, 'urutan diputar dari atas')}<span class="muted small" id="muUse">menghitung penyimpanan…</span></div><div id="muList"></div></div>`;
    BlobStore.usage('music:').then(b => { const el = container.querySelector('#muUse'); if (el) el.textContent = `${fmtMB(b)} dari ${fmtMB(MAX_TOTAL)} terpakai`; }).catch(() => {});
    const set = container.querySelector('#muSet');
    set.vol.addEventListener('input', () => { set.querySelector('[data-vv]').textContent = set.vol.value; });
    set.addEventListener('submit', (e) => {
      e.preventDefault();
      const roles = [...set.querySelectorAll('input[name=role]:checked')].map(x => x.value);
      if (set.on.checked && !tracks.some(t => t.active !== false)) { UI.toast('Unggah dan aktifkan minimal satu lagu sebelum menyalakan musik.', 'error'); return; }
      DB.setSetting('musicEnabled', set.on.checked); DB.setSetting('musicDashboards', roles);
      DB.setSetting('musicMainTrackId', set.main.value); DB.setSetting('musicDefaultVolume', Math.round(Number(set.vol.value)));
      DB.setSetting('musicAutoplay', set.auto.checked); DB.setSetting('musicShuffle', set.shuffle.checked);
      UI.toast('Pengaturan musik disimpan.');
      refresh();
      renderAdmin(container, admin);
    });
    const up = container.querySelector('#muUp');
    up.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = up.querySelector('#muErr');
      err.classList.add('hidden');
      const btn = up.querySelector('button[type=submit]');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Memvalidasi…';
      try {
        const file = up.file.files[0];
        const meta = await validateAudio(file);
        let cover = '';
        if (up.cover.files[0]) {
          if (!/^image\/(jpeg|png|webp)$/.test(up.cover.files[0].type)) throw new Error('Cover harus JPG, PNG, atau WEBP.');
          cover = await Editor.compressImage(up.cover.files[0]);
        }
        const blobKey = 'music:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await BlobStore.put(blobKey, file);
        try {
          DB.saveMusicTrack(Object.assign({ title: up.title.value, artist: up.artist.value, mood: up.mood.value, cover, blobKey,
            rights: { confirmed: up.rights.checked, license: up.license.value, source: up.source.value } }, meta), admin);
        } catch (ex) { await BlobStore.remove(blobKey); throw ex; }
        UI.toast('Musik diunggah.');
        refresh();
        renderAdmin(container, admin);
      } catch (ex) {
        err.textContent = ex.message || 'Gagal mengunggah.'; err.classList.remove('hidden');
        btn.disabled = false; btn.textContent = 'Unggah';
      }
    });
    const moodLabel = (k) => { const m = DB.MUSIC_MOODS.find(x => x.key === k); return m ? m.icon + ' ' + m.label : k; };
    DataSearch.mount({
      container: container.querySelector('#muList'), items: tracks, stateKey: 'music-admin',
      placeholder: 'Cari judul, artis, atau lisensi…', fields: t => [t.title, t.artist, t.rights && t.rights.license, moodLabel(t.mood)],
      filters: [{ key: 'mood', label: 'Semua suasana', get: t => t.mood, options: DB.MUSIC_MOODS.map(m => ({ value: m.key, label: m.label })) }],
      pageSize: 20, empty: 'Belum ada musik. Unggah lagu pertama di atas.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table"><thead><tr><th>Lagu</th><th>Suasana</th><th>Durasi</th><th>Ukuran</th><th>Lisensi</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(t => `<tr>
          <td><div class="user-cell"><span class="mu-cover">${t.cover ? `<img src="${esc(t.cover)}" alt="" />` : '♪'}</span><div><strong>${ctx.highlight(t.title)}</strong>${st.musicMainTrackId === t.id ? ' <span class="badge badge-warning">Utama</span>' : ''}<div class="muted small">${ctx.highlight(t.artist)}</div></div></div></td>
          <td>${moodLabel(t.mood)}</td><td>${fmtTime(t.duration)}</td><td>${fmtMB(t.size)}</td>
          <td class="small">${ctx.highlight(t.rights ? t.rights.license : '-')}${t.rights && /^https:\/\//.test(t.rights.source) ? ` <a href="${esc(t.rights.source)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</td>
          <td>${t.active !== false ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-gray">Nonaktif</span>'}</td>
          <td class="actions">
            <button type="button" class="btn btn-sm btn-secondary" data-mu-prev="${t.id}" aria-label="Pratinjau">▶</button>
            <button type="button" class="btn btn-sm btn-secondary" data-mu-up="${t.id}" aria-label="Naikkan">↑</button>
            <button type="button" class="btn btn-sm btn-secondary" data-mu-down="${t.id}" aria-label="Turunkan">↓</button>
            <button type="button" class="btn btn-sm btn-secondary" data-mu-edit="${t.id}">Edit</button>
            <button type="button" class="btn btn-sm btn-secondary" data-mu-toggle="${t.id}">${t.active !== false ? 'Nonaktifkan' : 'Aktifkan'}</button>
            <button type="button" class="btn btn-sm btn-danger" data-mu-del="${t.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`,
      onPaint: (box) => {
        let preview = null;
        box.querySelectorAll('[data-mu-prev]').forEach(b => b.addEventListener('click', async () => {
          const t = tracks.find(x => x.id === b.dataset.muPrev);
          if (preview) { preview.pause(); URL.revokeObjectURL(preview.src); if (preview.__id === t.id) { preview = null; b.textContent = '▶'; return; } }
          const blob = await BlobStore.get(t.blobKey);
          if (!blob) { UI.toast('Berkas audio tidak ditemukan di perangkat ini.', 'error'); return; }
          preview = new Audio(URL.createObjectURL(blob)); preview.__id = t.id; preview.volume = 0.5;
          box.querySelectorAll('[data-mu-prev]').forEach(x => { x.textContent = '▶'; });
          preview.play().then(() => { b.textContent = '⏸'; }).catch(() => UI.toast('Browser menolak pemutaran.', 'error'));
        }));
        box.querySelectorAll('[data-mu-up],[data-mu-down]').forEach(b => b.addEventListener('click', () => {
          DB.moveMusicTrack(b.dataset.muUp || b.dataset.muDown, b.dataset.muUp ? -1 : 1, admin); refresh(); renderAdmin(container, admin);
        }));
        box.querySelectorAll('[data-mu-toggle]').forEach(b => b.addEventListener('click', () => {
          const t = tracks.find(x => x.id === b.dataset.muToggle);
          try { DB.saveMusicTrack(Object.assign({}, t, { active: t.active === false }), admin); refresh(); renderAdmin(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
        }));
        box.querySelectorAll('[data-mu-del]').forEach(b => b.addEventListener('click', async () => {
          if (!UI.confirmDialog('Hapus lagu ini dari playlist?')) return;
          const t = DB.deleteMusicTrack(b.dataset.muDel, admin);
          if (t) await BlobStore.remove(t.blobKey).catch(() => {});
          UI.toast('Lagu dihapus.'); refresh(); renderAdmin(container, admin);
        }));
        box.querySelectorAll('[data-mu-edit]').forEach(b => b.addEventListener('click', () => openEdit(container, admin, tracks.find(x => x.id === b.dataset.muEdit))));
      }
    });
  }

  function openEdit(container, admin, t) {
    UI.modal.open('Edit Musik', `<form id="muEdit" class="form">
      <div class="form-row"><div class="form-group"><label>Judul</label><input name="title" class="input" maxlength="120" required value="${esc(t.title)}" /></div>
        <div class="form-group"><label>Artis / pencipta</label><input name="artist" class="input" maxlength="120" required value="${esc(t.artist)}" /></div></div>
      <div class="form-row"><div class="form-group"><label>Suasana</label><select name="mood" class="input">${DB.MUSIC_MOODS.map(m => `<option value="${m.key}" ${t.mood === m.key ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Ganti cover</label><input type="file" name="cover" class="input" accept="image/jpeg,image/png,image/webp" /></div></div>
      <div class="form-group"><label>Ganti berkas audio (opsional)</label><input type="file" name="file" class="input" accept=".mp3,.wav,.ogg" /></div>
      <div class="form-row"><div class="form-group"><label>Lisensi</label><input name="license" class="input" maxlength="120" required value="${esc(t.rights ? t.rights.license : '')}" /></div>
        <div class="form-group"><label>Sumber</label><input name="source" class="input" maxlength="300" value="${esc(t.rights ? t.rights.source : '')}" /></div></div>
      <label class="check-row"><input type="checkbox" name="rights" checked required /> Hak penggunaan tetap berlaku.</label>
      <div id="muEErr" class="alert alert-error hidden"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Simpan</button></div></form>`);
    const f = document.getElementById('muEdit');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('#muEErr');
      try {
        const patch = Object.assign({}, t, { title: f.title.value, artist: f.artist.value, mood: f.mood.value,
          rights: { confirmed: f.rights.checked, license: f.license.value, source: f.source.value } });
        if (f.cover.files[0]) {
          if (!/^image\/(jpeg|png|webp)$/.test(f.cover.files[0].type)) throw new Error('Cover harus JPG, PNG, atau WEBP.');
          patch.cover = await Editor.compressImage(f.cover.files[0]);
        }
        let oldKey = null;
        if (f.file.files[0]) {
          Object.assign(patch, await validateAudio(f.file.files[0], t.id));
          oldKey = t.blobKey;
          patch.blobKey = 'music:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          await BlobStore.put(patch.blobKey, f.file.files[0]);
        }
        DB.saveMusicTrack(patch, admin);
        if (oldKey) await BlobStore.remove(oldKey).catch(() => {});
        UI.modal.close(); UI.toast('Musik diperbarui.'); refresh(); renderAdmin(container, admin);
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    });
  }

  global.Music = { init, refresh, renderAdmin, destroy: destroyPlayer, validateAudio, _player: () => player };
})(window);
