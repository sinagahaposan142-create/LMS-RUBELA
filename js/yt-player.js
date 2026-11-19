/* =========================================================================
 * YTPlayer — pemutar YouTube untuk video pembahasan & materi.
 *
 * - Hanya thumbnail yang dimuat sampai pengguna menekan putar (hemat kuota,
 *   tidak ada cookie YouTube sebelum diklik). Domain: youtube-nocookie.com.
 * - Mode terkunci (video pembahasan): kontrol bawaan YouTube disembunyikan
 *   (controls=0, disablekb=1), diganti kontrol sendiri tanpa pilihan kecepatan.
 *   Kecepatan dipaksa 1x lewat onPlaybackRateChange + pemeriksaan berkala.
 *   Opsi "cegah loncat maju" melacak posisi terjauh yang sudah ditonton.
 *
 * BATASAN (jujur): semua ini berjalan di peramban pengguna. Pengguna yang
 * paham teknis tetap bisa mengakali (DevTools, ekstensi, membuka video di
 * youtube.com). Fitur ini menyulitkan, bukan menjamin.
 *
 * Markup kartu dibangkitkan ulang oleh RichText.render dari atribut
 * data-yt-id / data-yt-lock / data-yt-noskip, jadi aman disimpan di konten.
 * =======================================================================*/
(function (global) {
  'use strict';

  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const HOST = 'https://www.youtube-nocookie.com';
  const API_URL = 'https://www.youtube.com/iframe_api';
  const PROG_KEY = 'lms_yt_progress';          // cache posisi terjauh per pengguna+video (bukan data penting)
  const SKIP_TOL = 1.5;                         // detik toleransi lompatan maju

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Ambil ID video dari URL YouTube (watch, youtu.be, shorts, embed, live, nocookie) atau ID polos. */
  function parseId(input) {
    const raw = String(input == null ? '' : input).trim();
    if (!raw) return null;
    if (ID_RE.test(raw)) return raw;
    let u;
    try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch (e) { return null; }
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
    let id = null;
    if (host === 'youtu.be') id = u.pathname.split('/')[1];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
        if (m) id = m[1];
      }
    }
    return id && ID_RE.test(id) ? id : null;
  }

  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    vol: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    mute: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/></svg>',
    full: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    big: '<svg viewBox="0 0 68 48" width="68" height="48" aria-hidden="true"><rect width="68" height="48" rx="12" fill="rgba(15,23,42,.82)"/><path d="M27 15v18l16-9z" fill="#fff"/></svg>'
  };

  /**
   * Kartu pratinjau (thumbnail). Tidak ada iframe sampai diklik.
   * opts: { lock: bool (kontrol kustom + kecepatan 1x), noSkip: bool, title: string }
   */
  function cardHtml(id, opts) {
    const o = opts || {};
    if (!ID_RE.test(String(id || ''))) return '';
    const label = o.lock ? 'Putar video pembahasan' : 'Putar video';
    return `<div class="yt-card" data-yt-id="${id}"${o.lock ? ' data-yt-lock="1"' : ''}${o.lock && o.noSkip ? ' data-yt-noskip="1"' : ''}
        role="button" tabindex="0" aria-label="${esc(o.title ? label + ': ' + o.title : label)}">
        <img class="yt-thumb" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy" decoding="async" />
        <span class="yt-bigplay">${ICON.big}</span>
        ${o.lock ? `<span class="yt-badge">${o.noSkip ? 'Kecepatan 1x · tidak bisa dilompati' : 'Kecepatan 1x'}</span>` : ''}
      </div>`;
  }

  /* ---------------------- IFrame API (sekali muat) ---------------------- */
  let apiPromise = null;
  function loadApi() {
    if (global.YT && global.YT.Player) return Promise.resolve(global.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const prev = global.onYouTubeIframeAPIReady;
      const timer = setTimeout(() => { apiPromise = null; reject(new Error('timeout')); }, 12000);
      global.onYouTubeIframeAPIReady = function () {
        clearTimeout(timer);
        if (typeof prev === 'function') try { prev(); } catch (e) { /* abaikan */ }
        resolve(global.YT);
      };
      const s = document.createElement('script');
      s.src = API_URL;
      s.async = true;
      s.onerror = () => { clearTimeout(timer); apiPromise = null; s.remove(); reject(new Error('load')); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  /* ---------------------- cache posisi terjauh ---------------------- */
  function progKey(id) {
    let uid = 'anon';
    try { uid = (JSON.parse(localStorage.getItem('lms_session') || 'null') || {}).id || 'anon'; } catch (e) { /* abaikan */ }
    return uid + ':' + id;
  }
  function loadMax(id) {
    try { const m = JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); return Number(m[progKey(id)]) || 0; } catch (e) { return 0; }
  }
  function saveMax(id, t) {
    try {
      const m = JSON.parse(localStorage.getItem(PROG_KEY) || '{}');
      m[progKey(id)] = Math.round(t);
      const keys = Object.keys(m);
      if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(k => { delete m[k]; });
      localStorage.setItem(PROG_KEY, JSON.stringify(m));
    } catch (e) { /* kuota penuh: abaikan */ }
  }

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
  };

  const ERRORS = {
    2: 'Tautan video tidak valid. Periksa kembali URL YouTube-nya.',
    5: 'Video ini tidak dapat diputar di peramban Anda.',
    100: 'Video tidak ditemukan. Mungkin sudah dihapus atau dijadikan privat oleh pemiliknya.',
    101: 'Pemilik video tidak mengizinkan video ini diputar di situs lain (embed dinonaktifkan).',
    150: 'Pemilik video tidak mengizinkan video ini diputar di situs lain (embed dinonaktifkan).'
  };

  /* ---------------------- mode biasa (kontrol YouTube) ---------------------- */
  function startPlain(card, id) {
    const wrap = document.createElement('div');
    wrap.className = 'yt-wrap';
    wrap.innerHTML = `<div class="yt-frame"><iframe src="${HOST}/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1"
      title="Video YouTube" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
    card.replaceWith(wrap);
  }

  /* ---------------------- mode terkunci (kontrol kustom) ---------------------- */
  function startLocked(card, id, noSkip) {
    const wrap = document.createElement('div');
    wrap.className = 'yt-wrap is-locked';
    wrap.tabIndex = -1;
    wrap.innerHTML = `
      <div class="yt-frame">
        <div class="yt-host"></div>
        <div class="yt-shield" aria-hidden="true"></div>
        <div class="yt-state" role="status">Memuat pemutar…</div>
      </div>
      <div class="yt-controls" hidden>
        <button type="button" class="yt-btn" data-yt="play" aria-label="Putar">${ICON.play}</button>
        <span class="yt-time" aria-live="off"><span data-yt="cur">0:00</span> / <span data-yt="dur">0:00</span></span>
        <input type="range" class="yt-seek" data-yt="seek" min="0" max="1000" step="1" value="0" aria-label="Posisi video" />
        <button type="button" class="yt-btn" data-yt="mute" aria-label="Bisukan">${ICON.vol}</button>
        <input type="range" class="yt-vol" data-yt="vol" min="0" max="100" step="1" value="100" aria-label="Volume" />
        <button type="button" class="yt-btn" data-yt="full" aria-label="Layar penuh">${ICON.full}</button>
      </div>
      <div class="yt-note" role="status" aria-live="polite"></div>`;
    card.replaceWith(wrap);

    const $ = (s) => wrap.querySelector(`[data-yt="${s}"]`);
    const state = wrap.querySelector('.yt-state');
    const note = wrap.querySelector('.yt-note');
    const ctr = wrap.querySelector('.yt-controls');
    const seek = $('seek');
    let player = null, poll = 0, dur = 0, seeking = false, noteTimer = 0;
    let maxT = noSkip ? loadMax(id) : 0;

    const say = (msg) => {
      note.textContent = msg;
      note.classList.add('is-on');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => note.classList.remove('is-on'), 3200);
    };
    const fail = (msg, retry) => {
      stop();
      ctr.hidden = true;
      state.hidden = false;
      state.className = 'yt-state is-error';
      state.innerHTML = `<span>${esc(msg)}</span>${retry ? '<button type="button" class="btn btn-sm btn-secondary" data-yt="retry">Coba lagi</button>' : ''}`;
      const r = $('retry');
      if (r) r.addEventListener('click', () => {
        try { if (player) player.destroy(); } catch (e) { /* abaikan */ }
        const fresh = document.createElement('div');
        wrap.replaceWith(fresh);
        startLocked(fresh, id, noSkip);
      });
    };
    function stop() { if (poll) { clearInterval(poll); poll = 0; } }

    const clampTarget = (t) => (noSkip && t > maxT + SKIP_TOL ? maxT : t);
    const isPlaying = () => player && player.getPlayerState && player.getPlayerState() === 1;

    function syncUi() {
      if (!player || !player.getCurrentTime) return;
      const t = player.getCurrentTime() || 0;
      dur = player.getDuration() || dur;
      $('cur').textContent = fmt(t);
      $('dur').textContent = fmt(dur);
      if (!seeking && dur) seek.value = String(Math.round((t / dur) * 1000));
      if (noSkip && dur) wrap.style.setProperty('--yt-max', ((maxT / dur) * 100).toFixed(2) + '%');
      const playing = isPlaying();
      const b = $('play');
      b.innerHTML = playing ? ICON.pause : ICON.play;
      b.setAttribute('aria-label', playing ? 'Jeda' : 'Putar');
      const muted = player.isMuted && player.isMuted();
      $('mute').innerHTML = muted ? ICON.mute : ICON.vol;
      $('mute').setAttribute('aria-label', muted ? 'Bunyikan' : 'Bisukan');
    }

    function tick() {
      if (!wrap.isConnected) { stop(); try { player.destroy(); } catch (e) { /* abaikan */ } return; }
      if (!player || !player.getCurrentTime) return;
      // Kecepatan: cadangan bila event onPlaybackRateChange terlewat
      if (player.getPlaybackRate && player.getPlaybackRate() !== 1) {
        player.setPlaybackRate(1);
        say('Kecepatan video dikunci pada 1x.');
      }
      if (noSkip) {
        const t = player.getCurrentTime() || 0;
        if (t > maxT + SKIP_TOL) {
          player.seekTo(maxT, true);
          say('Bagian yang belum ditonton tidak bisa dilompati.');
        } else if (isPlaying() && t > maxT) {
          maxT = t;
          if (Math.floor(t) % 5 === 0) saveMax(id, maxT);
        }
      }
      syncUi();
    }

    function goTo(t) {
      if (!player) return;
      const want = Math.max(0, Math.min(dur || t, t));
      const ok = clampTarget(want);
      if (ok < want) say('Bagian yang belum ditonton tidak bisa dilompati.');
      player.seekTo(ok, true);
      syncUi();
    }

    loadApi().then((YT) => {
      if (!wrap.isConnected) return;
      player = new YT.Player(wrap.querySelector('.yt-host'), {
        host: HOST,
        videoId: id,
        width: '100%', height: '100%',
        playerVars: Object.assign({ autoplay: 1, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, fs: 0, iv_load_policy: 3 },
          /^https?:/.test(location.origin) ? { origin: location.origin } : {}),
        events: {
          onReady: () => {
            state.hidden = true;
            ctr.hidden = false;
            player.setPlaybackRate(1);
            if (noSkip && maxT > 0) player.seekTo(Math.max(0, maxT - 2), true);
            poll = setInterval(tick, 500);
            syncUi();
          },
          onPlaybackRateChange: (e) => {
            if (e.data !== 1) { player.setPlaybackRate(1); say('Kecepatan video dikunci pada 1x.'); }
          },
          onStateChange: (e) => {
            if (e.data === 0 && noSkip) { maxT = Math.max(maxT, player.getDuration() || maxT); saveMax(id, maxT); }
            if (e.data === 2 && noSkip) saveMax(id, maxT);
            syncUi();
          },
          onError: (e) => fail(ERRORS[e.data] || 'Video tidak dapat diputar (kode ' + esc(e.data) + ').', false)
        }
      });
    }).catch(() => fail('Pemutar YouTube tidak dapat dimuat. Periksa koneksi internet atau pemblokir iklan, lalu coba lagi.', true));

    /* kontrol */
    $('play').addEventListener('click', () => { if (!player) return; isPlaying() ? player.pauseVideo() : player.playVideo(); });
    wrap.querySelector('.yt-shield').addEventListener('click', () => { if (!player) return; isPlaying() ? player.pauseVideo() : player.playVideo(); });
    wrap.querySelector('.yt-shield').addEventListener('contextmenu', (e) => e.preventDefault());
    seek.addEventListener('input', () => {
      seeking = true;
      if (dur) $('cur').textContent = fmt((Number(seek.value) / 1000) * dur);
    });
    seek.addEventListener('change', () => { seeking = false; if (dur) goTo((Number(seek.value) / 1000) * dur); });
    $('mute').addEventListener('click', () => {
      if (!player) return;
      if (player.isMuted()) { player.unMute(); if (!player.getVolume()) player.setVolume(60); } else player.mute();
      $('vol').value = player.isMuted() ? '0' : String(player.getVolume());
      syncUi();
    });
    $('vol').addEventListener('input', () => {
      if (!player) return;
      const v = Number($('vol').value);
      player.setVolume(v);
      if (v === 0) player.mute(); else if (player.isMuted()) player.unMute();
      syncUi();
    });
    $('full').addEventListener('click', () => {
      const d = document;
      if (d.fullscreenElement === wrap) { d.exitFullscreen && d.exitFullscreen(); return; }
      if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => say('Layar penuh tidak didukung di perangkat ini.'));
      else say('Layar penuh tidak didukung di perangkat ini.');
    });
    wrap.addEventListener('keydown', (e) => {
      if (!player || e.target.matches('input[type=range]')) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); isPlaying() ? player.pauseVideo() : player.playVideo(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo((player.getCurrentTime() || 0) - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo((player.getCurrentTime() || 0) + 5); }
    });
    setTimeout(() => wrap.focus({ preventScroll: true }), 50);
  }

  function start(card) {
    if (!card || card.closest('[contenteditable="true"]')) return;   // di editor hanya pratinjau
    const id = card.getAttribute('data-yt-id');
    if (!ID_RE.test(id || '')) return;
    if (card.getAttribute('data-yt-lock') === '1') startLocked(card, id, card.getAttribute('data-yt-noskip') === '1');
    else startPlain(card, id);
  }

  /* Satu handler untuk semua kartu di halaman (konten dirender ulang kapan saja). */
  document.addEventListener('click', (e) => {
    const card = e.target.closest && e.target.closest('.yt-card');
    if (card) { e.preventDefault(); start(card); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest && e.target.closest('.yt-card');
    if (card && e.target === card) { e.preventDefault(); start(card); }
  });

  /** Blok "Video pembahasan" untuk field soal explanationVideo { id, url, noSkip }. */
  function explanationHtml(v) {
    if (!v || !ID_RE.test(String(v.id || ''))) return '';
    return `<div class="yt-exp"><div class="yt-exp-head">Video pembahasan</div>${cardHtml(v.id, { lock: true, noSkip: !!v.noSkip })}</div>`;
  }
  const expVideo = (q) => (global.YTPlayer && q && q.explanationVideo ? explanationHtml(q.explanationVideo) : '');

  global.YTPlayer = { parseId, cardHtml, explanationHtml, expVideo, isValidId: (id) => ID_RE.test(String(id || '')) };
})(window);
