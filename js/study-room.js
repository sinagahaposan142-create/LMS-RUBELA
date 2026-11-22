/* =====================================================================
 * js/study-room.js — Ruang Belajar (ala YPT / YeolPumTa)
 * ---------------------------------------------------------------------
 *  - Ruang Kelas: figur mentee duduk di meja. Fokus (timer berjalan),
 *    istirahat (timer dijeda), atau sedang di LMS (online). Terlihat semua.
 *  - Timer & Tujuan: tambah tujuan (judul + durasi), mulai, jeda, selesai.
 *    Timer tetap berjalan saat pindah halaman (chip mengambang) dan saat
 *    halaman dimuat ulang. Tujuan tercapai → sesi otomatis tercatat.
 *    Pemeriksaan "masih belajar?" tiap 45 menit; tanpa jawaban 3 menit,
 *    timer dijeda di waktu pemeriksaan (waktu tidak dihitung).
 *  - Waktu di LMS (aktif & terlihat, tidak bersamaan dengan timer) ikut
 *    dihitung per hari, satu tab per perangkat.
 *  - Peringkat hari ini / minggu ini / bulan ini / total; statistik pribadi
 *    (grafik 7 hari, kalender bulan, per tujuan); rekap harian untuk
 *    admin & tutor (unduh CSV) dan pantauan orang tua.
 * Data:
 *  lms_study_sessions  sesi fokus & waktu web (hanya pemilik)
 *  lms_study_goals     tujuan belajar (hanya pemilik)
 *  lms_study_stats     ringkasan per pengguna (id = userId; terlihat semua):
 *                      days {YYYY-MM-DD: {f, w, n}} 62 hari, months, total, live
 * Ringkasan dihitung ulang dari sesi milik sendiri, jadi beberapa perangkat
 * menghasilkan angka yang sama. Server memvalidasi batas wajar setiap data.
 * ===================================================================*/
(function (global) {
  'use strict';

  const K = { s: 'lms_study_sessions', g: 'lms_study_goals', st: 'lms_study_stats' };
  const SEC = 1000, MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const MAX_FOCUS = 12 * HOUR;
  const LIVE_FRESH = 5 * MIN;
  const HEARTBEAT = 2 * MIN;
  const AFK_EVERY = 45 * MIN, AFK_WAIT = 3 * MIN;
  const KEEP_DAYS = 62;
  const COLORS = ['#4f46e5', '#0d9488', '#d97706', '#db2777', '#2563eb', '#16a34a'];
  const QUICK = [25, 50, 90];
  const esc = (s) => UI.esc(s);
  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
    pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
    stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 16),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 16),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 16)
  };

  /* ------------------------------------------------------------------
   * Data & waktu
   * ----------------------------------------------------------------*/
  const load = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const getJ = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const setJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* penyimpanan penuh */ } };
  const newId = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const tz = () => { const t = DB.getSettings().lmsTimezone; return DB.TZ_OFFSETS[t] != null ? t : 'WIB'; };
  const dayOf = (ts) => DB.ymdInTz(ts, tz());
  const today = () => dayOf(Date.now());
  const dayStart = (ymd) => UI.tzInputToUtc(ymd + 'T00:00', tz());
  const addDays = (ymd, n) => dayOf(dayStart(ymd) + n * DAY + 6 * HOUR);
  const dow = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
  const weekStart = (ymd) => addDays(ymd, -((dow(ymd) + 6) % 7));
  const DAYS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const pad = (n) => String(n).padStart(2, '0');
  function fmtDur(ms) {
    const m = Math.floor((ms || 0) / MIN);
    const h = Math.floor(m / 60);
    if (!h) return m + ' mnt';
    return m % 60 ? `${h} j ${m % 60} mnt` : `${h} jam`;
  }
  const fmtHours = (ms) => ((ms || 0) / HOUR).toLocaleString('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  function fmtClock(ms) {
    const s = Math.max(0, Math.floor(ms / SEC));
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  const sessionsOf = (userId) => load(K.s).filter(s => s.userId === userId);
  const goalsOf = (userId) => load(K.g).filter(g => g.userId === userId && !g.archived).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const statsAll = () => load(K.st);
  const statsOf = (userId) => statsAll().find(s => s.userId === userId) || null;
  const students = () => DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif');

  /** Ringkas sesi → { days, months, total } (fokus + waktu web per hari, maksimal 24 jam). */
  function summarize(list) {
    const days = {};
    list.forEach(s => {
      const ms = Math.max(0, Math.min(DAY, Number(s.durationMs) || 0));
      if (!ms || !/^\d{4}-\d{2}-\d{2}$/.test(s.day || '')) return;
      const d = days[s.day] || (days[s.day] = { f: 0, w: 0, n: 0 });
      if (s.kind === 'web') d.w += ms; else { d.f += ms; d.n++; }
    });
    const months = {};
    let total = 0;
    Object.keys(days).sort().forEach(k => {
      const d = days[k];
      d.f = Math.min(DAY, d.f);
      d.w = Math.min(DAY - d.f, d.w);
      const sum = d.f + d.w;
      months[k.slice(0, 7)] = (months[k.slice(0, 7)] || 0) + sum;
      total += sum;
    });
    return { days, months, total };
  }
  function putStats(rec) {
    const list = statsAll();
    const i = list.findIndex(s => s.userId === rec.userId);
    if (i >= 0) list[i] = rec; else list.push(rec);
    save(K.st, list);
  }
  /** Hitung ulang ringkasan pengguna dari sesinya sendiri; tulis hanya bila berubah. */
  function recompute(user, live) {
    const sum = summarize(sessionsOf(user.id));
    const cut = addDays(today(), -KEEP_DAYS);
    const days = {};
    Object.keys(sum.days).filter(d => d >= cut).sort().forEach(d => { days[d] = sum.days[d]; });
    const cur = statsOf(user.id);
    const next = { userId: user.id, days, months: sum.months, total: sum.total, live: live !== undefined ? live : (cur ? cur.live || null : null), updatedAt: Date.now() };
    const same = cur && JSON.stringify([cur.days, cur.months, cur.total, cur.live || null]) === JSON.stringify([next.days, next.months, next.total, next.live]);
    if (same) return cur;
    putStats(next);
    return next;
  }

  const dayTotal = (st, d) => { const x = st && st.days && st.days[d]; return x ? (x.f || 0) + (x.w || 0) : 0; };
  /** Total & rincian fokus/web sebuah periode dari ringkasan. */
  function period(st, kind, ref) {
    const t = ref || today();
    const out = { f: 0, w: 0, total: 0 };
    if (!st) return out;
    const addDay = (d) => { const x = st.days && st.days[d]; if (x) { out.f += x.f || 0; out.w += x.w || 0; } };
    if (kind === 'day') addDay(t);
    else if (kind === 'week') { for (let d = weekStart(t); d <= t; d = addDays(d, 1)) addDay(d); }
    else if (kind === 'month') { const ym = t.slice(0, 7); Object.keys(st.days || {}).forEach(d => { if (d.slice(0, 7) === ym) addDay(d); }); }
    out.total = kind === 'total' ? (st.total || 0) : kind === 'month' ? Math.max(out.f + out.w, (st.months || {})[t.slice(0, 7)] || 0) : out.f + out.w;
    return out;
  }
  /** Status langsung (null bila basi). */
  function liveOf(st, now) {
    const l = st && st.live;
    const t = now || Date.now();
    if (!l || !l.at || t - l.at > LIVE_FRESH || (l.state !== 'focus' && l.state !== 'break')) return null;
    return Object.assign({}, l, { elapsed: (l.accMs || 0) + (l.state === 'focus' && l.since ? t - l.since : 0) });
  }

  /* ------------------------------------------------------------------
   * Timer (siswa; disimpan di perangkat agar tahan muat ulang)
   * ----------------------------------------------------------------*/
  const TKEY = (u) => 'lms_study_timer:' + u.id;
  const timerOf = (u) => getJ(TKEY(u), null);
  function setTimer(u, t) { if (t) setJ(TKEY(u), t); else { try { localStorage.removeItem(TKEY(u)); } catch (e) { /* noop */ } } }
  const elapsedOf = (t, now) => (t.accMs || 0) + (t.runSince ? (now || Date.now()) - t.runSince : 0);
  const liveFrom = (t) => (t ? { state: t.runSince ? 'focus' : 'break', title: t.title, goalId: t.goalId || null, since: t.runSince || null, accMs: Math.round(t.accMs || 0), targetMs: t.targetMs || 0, at: Date.now() } : null);
  let lastBeat = 0;
  function pushLive(u, t) { lastBeat = Date.now(); recompute(u, liveFrom(t)); }

  function startTimer(u, goal) {
    const now = Date.now();
    const cur = timerOf(u);
    if (cur) finishTimer(u, { quiet: true });
    const t = { goalId: goal.id, title: goal.title, color: goal.color, targetMs: Math.round(goal.targetMin * MIN), accMs: 0, runSince: now, startedAt: now, checkAt: now + AFK_EVERY };
    setTimer(u, t);
    pushLive(u, t);
    ensureTicker(u);
    return t;
  }
  function pauseTimer(u) {
    const t = timerOf(u);
    if (!t || !t.runSince) return t;
    t.accMs = elapsedOf(t); t.runSince = null; t.ask = false;
    setTimer(u, t); pushLive(u, t);
    return t;
  }
  function resumeTimer(u) {
    const t = timerOf(u);
    if (!t || t.runSince) return t;
    const now = Date.now();
    t.runSince = now; t.checkAt = now + AFK_EVERY; t.ask = false;
    setTimer(u, t); pushLive(u, t);
    return t;
  }
  /** Catat sesi (dipecah bila melewati tengah malam). */
  function addSession(u, t, ms, end) {
    let begin = Math.max(Number(t.startedAt) || end, end - 36 * HOUR);
    if (end - begin < ms) begin = end - ms;
    const base = { userId: u.id, kind: 'focus', goalId: t.goalId || null, title: String(t.title || 'Belajar').slice(0, 80), createdAt: end };
    const list = load(K.s);
    const d1 = dayOf(begin), d2 = dayOf(end);
    if (d1 !== d2) {
      const boundary = dayStart(d2);
      const ms2 = Math.round(ms * Math.min(1, (end - boundary) / Math.max(1, end - begin)));
      if (ms - ms2 > 0) list.push(Object.assign({ id: newId('sts'), startedAt: begin, endedAt: boundary, durationMs: ms - ms2, day: d1 }, base));
      if (ms2 > 0) list.push(Object.assign({ id: newId('sts'), startedAt: boundary, endedAt: end, durationMs: ms2, day: d2 }, base));
    } else list.push(Object.assign({ id: newId('sts'), startedAt: begin, endedAt: end, durationMs: ms, day: d2 }, base));
    save(K.s, list);
  }
  /** Selesaikan timer: catat sesi ≥ 1 menit. opts.atMs: batasi durasi (mis. target tercapai saat halaman tertutup). */
  function finishTimer(u, opts) {
    const o = opts || {};
    const t = timerOf(u);
    if (!t) return 0;
    const now = Date.now();
    let ms = Math.min(MAX_FOCUS, elapsedOf(t, now));
    let end = now;
    if (o.atMs != null && o.atMs < ms) { end = now - (ms - o.atMs); ms = o.atMs; }
    if (ms >= MIN) addSession(u, t, Math.round(ms), Math.round(end));
    setTimer(u, null);
    recompute(u, null);
    try { if (global.Sync && Sync.saveNow) Sync.saveNow(); } catch (e) { /* noop */ }
    if (!o.quiet) {
      if (ms >= MIN) UI.toast(`Sesi "${t.title}" tercatat: ${fmtDur(ms)}.`, 'success');
      else UI.toast('Sesi di bawah 1 menit tidak dicatat.', 'info');
    }
    return ms;
  }
  /**
   * Periksa timer: konfirmasi "masih belajar?" dan target tercapai. Berjalan tiap detik
   * selama timer aktif, juga saat halaman dibuka lagi setelah ditutup.
   * Kembalian: 'reached' | 'afk' | 'ask' | null.
   */
  function checkTimer(u) {
    const t = timerOf(u);
    if (!t) return null;
    const now = Date.now();
    if (t.runSince && t.checkAt && now >= t.checkAt + AFK_WAIT) {
      // Tidak ada konfirmasi: hentikan hitungan di waktu pemeriksaan.
      t.accMs = (t.accMs || 0) + Math.max(0, t.checkAt - t.runSince);
      t.runSince = null; t.ask = false; t.afkAt = t.checkAt;
      setTimer(u, t); pushLive(u, t);
      notify('Timer dijeda otomatis', `Tidak ada konfirmasi pada "${t.title}". Waktu setelah pemeriksaan tidak dihitung.`);
      return 'afk';
    }
    if (t.targetMs && elapsedOf(t, now) >= t.targetMs) {
      const title = t.title;
      finishTimer(u, { atMs: t.targetMs, quiet: true });
      lastReached = { title, ms: t.targetMs, goalId: t.goalId, at: now };
      chime();
      notify('Tujuan tercapai', `"${title}" selesai: ${fmtDur(t.targetMs)} tercatat.`);
      UI.toast(`Tujuan "${title}" tercapai — ${fmtDur(t.targetMs)} tercatat.`, 'success');
      return 'reached';
    }
    if (t.runSince && t.checkAt && now >= t.checkAt && !t.ask) {
      t.ask = true; setTimer(u, t);
      chime();
      notify('Masih belajar?', 'Buka LMS dan tekan "Ya, lanjut" dalam 3 menit agar timer tetap berjalan.');
      return 'ask';
    }
    return t.ask ? 'ask' : null;
  }
  function confirmStill(u) {
    const t = timerOf(u);
    if (!t) return;
    t.ask = false; t.checkAt = Date.now() + AFK_EVERY;
    setTimer(u, t);
  }
  let lastReached = null;

  let audioCtx = null;
  function chime() {
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      [0, 0.18].forEach((d, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = i ? 880 : 660;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.35);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.4);
      });
    } catch (e) { /* audio opsional */ }
  }
  function notify(title, body) {
    try {
      if (document.visibilityState === 'visible' || !('Notification' in global) || Notification.permission !== 'granted') return;
      new Notification(title, { body, tag: 'lms-study' });
    } catch (e) { /* notifikasi opsional */ }
  }

  /* ------------------------------------------------------------------
   * Waktu di LMS (siswa): dihitung saat tab terlihat & aktif, tanpa timer
   * ----------------------------------------------------------------*/
  const DEV = (() => {
    let d = getJ('lms_study_dev', null);
    if (!d || !/^[a-z0-9]{6,20}$/.test(d)) { d = 'd' + Math.random().toString(36).slice(2, 12); setJ('lms_study_dev', d); }
    return d;
  })();
  const TAB = 't' + Math.random().toString(36).slice(2, 10);
  const WKEY = (u) => 'lms_study_web:' + u.id;
  let lastInput = Date.now(), lastWebTick = Date.now(), lastFlush = Date.now();
  function webTick(u) {
    const now = Date.now();
    const dt = Math.min(20 * SEC, Math.max(0, now - lastWebTick));
    lastWebTick = now;
    if (document.visibilityState !== 'visible' || now - lastInput > 3 * MIN) return;
    const t = timerOf(u);
    if (t && t.runSince) return;                         // sudah dihitung sebagai waktu fokus
    const lock = getJ('lms_study_web_lock', null);
    if (lock && lock.tab !== TAB && now - lock.at < 30 * SEC) return;   // tab lain di perangkat ini yang menghitung
    setJ('lms_study_web_lock', { tab: TAB, at: now });
    const m = getJ(WKEY(u), {});
    const d = dayOf(now);
    m[d] = Math.min(DAY, (Number(m[d]) || 0) + dt);
    const cut = addDays(d, -6);
    Object.keys(m).forEach(k => { if (k < cut) delete m[k]; });
    setJ(WKEY(u), m);
  }
  function webFlush(u) {
    lastFlush = Date.now();
    const m = getJ(WKEY(u), {});
    const list = load(K.s);
    let changed = false;
    Object.keys(m).forEach(d => {
      const id = `web:${u.id}:${d}:${DEV}`;
      const i = list.findIndex(s => s.id === id);
      const ms = Math.max(Math.round(Number(m[d]) || 0), i >= 0 ? Number(list[i].durationMs) || 0 : 0);
      if (ms < MIN) return;
      if (i >= 0) {
        if (ms - (Number(list[i].durationMs) || 0) < 30 * SEC) return;
        list[i] = Object.assign({}, list[i], { durationMs: ms, updatedAt: Date.now() });
      } else list.push({ id, userId: u.id, kind: 'web', day: d, dev: DEV, durationMs: ms, createdAt: Date.now(), updatedAt: Date.now() });
      changed = true;
    });
    if (changed) { save(K.s, list); recompute(u); }
  }

  /* ------------------------------------------------------------------
   * Latar belakang: timer, detak status langsung, chip mengambang
   * ----------------------------------------------------------------*/
  let me = null, fastTimer = null, mini = null;
  function init(user) {
    if (!user || user.role !== 'siswa' || me) return;
    me = user;
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { webTick(me); webFlush(me); }
      else { lastWebTick = Date.now(); lastInput = Date.now(); checkTimer(me); paintMini(); }
    });
    global.addEventListener('pagehide', () => { try { webTick(me); webFlush(me); } catch (e) { /* noop */ } });
    // Halaman dibuka lagi: periksa timer yang tertinggal (target lewat / tanpa konfirmasi).
    checkTimer(me);
    const t = timerOf(me);
    if (t) { pushLive(me, timerOf(me)); ensureTicker(me); }
    else { const st = statsOf(me.id); if (st && st.live) recompute(me, null); }
    setInterval(() => {
      try {
        webTick(me);
        if (Date.now() - lastFlush > 3 * MIN) webFlush(me);
        const tt = timerOf(me);
        if (tt && Date.now() - lastBeat > HEARTBEAT) pushLive(me, tt);
      } catch (e) { console.warn('[ruang-belajar]', e); }
    }, 15 * SEC);
  }
  function ensureTicker(u) {
    if (fastTimer) return;
    fastTimer = setInterval(() => {
      const t = timerOf(u);
      if (!t) { clearInterval(fastTimer); fastTimer = null; paintMini(); if (view.repaint) view.repaint(); return; }
      const r = checkTimer(u);
      if ((r === 'reached' || r === 'afk' || r === 'ask') && view.repaint) view.repaint();
      paintMini();
      if (view.tick && view.tab === 'timer') view.tick();
    }, SEC);
  }
  /** Chip timer mengambang saat berada di halaman lain. */
  function paintMini() {
    if (!me) return;
    const t = timerOf(me);
    const onPage = global.Dashboard && Dashboard.currentSection && Dashboard.currentSection() === 'ruang-belajar';
    if (!t || onPage || document.body.classList.contains('exam-mode')) { if (mini) { mini.remove(); mini = null; } return; }
    if (!mini) {
      mini = document.createElement('button');
      mini.type = 'button';
      mini.className = 'rb-mini';
      mini.addEventListener('click', () => { view.tab = 'timer'; Dashboard.navigate('ruang-belajar'); });
      document.body.appendChild(mini);
    }
    const run = !!t.runSince;
    const left = t.targetMs ? Math.max(0, t.targetMs - elapsedOf(t)) : elapsedOf(t);
    mini.classList.toggle('is-paused', !run);
    mini.classList.toggle('is-ask', !!t.ask);
    mini.setAttribute('aria-label', `Timer ${t.title}: ${run ? 'berjalan' : 'dijeda'}, sisa ${fmtClock(left)}. Buka Ruang Belajar.`);
    mini.innerHTML = `<span class="rb-mini-dot" style="--c:${esc(t.color || COLORS[0])}"></span><span class="rb-mini-t">${fmtClock(left)}</span><span class="rb-mini-n">${t.ask ? 'Masih belajar?' : esc(t.title)}</span>`;
  }

  /* ------------------------------------------------------------------
   * Tampilan
   * ----------------------------------------------------------------*/
  const view = { tab: null, period: 'day', scope: 'all', rekapDays: 7, rekapKelas: '', childId: '', tick: null, repaint: null };
  let roomSync = null;
  function stop() {
    view.tick = null; view.repaint = null;
    if (roomSync) { clearInterval(roomSync); roomSync = null; }
    paintMini();
  }

  function tabsFor(user) {
    if (user.role === 'siswa') return [['timer', 'Timer & Tujuan'], ['kelas', 'Ruang Kelas'], ['statistik', 'Statistik Saya'], ['peringkat', 'Peringkat']];
    if (user.role === 'orangtua') return [['anak', 'Jam Belajar Anak'], ['peringkat', 'Peringkat']];
    return [['kelas', 'Ruang Kelas'], ['peringkat', 'Peringkat'], ['rekap', 'Rekap Harian']];
  }

  function render(container, user) {
    stop();
    const tabs = tabsFor(user);
    if (!tabs.some(t => t[0] === view.tab)) view.tab = tabs[0][0];
    container.innerHTML = `<div class="rb">
      <div class="rb-tabs" role="tablist" aria-label="Ruang Belajar">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${view.tab === k}" class="rb-tab ${view.tab === k ? 'is-on' : ''}" data-rb-tab="${k}">${esc(l)}</button>`).join('')}</div>
      <div id="rbBody"></div></div>`;
    container.querySelectorAll('[data-rb-tab]').forEach(b => b.addEventListener('click', () => { view.tab = b.dataset.rbTab; render(container, user); }));
    const body = container.querySelector('#rbBody');
    const paint = () => {
      if (!body.isConnected) { stop(); return; }
      ({ timer: paintTimer, kelas: paintRoom, statistik: paintStats, peringkat: paintRank, rekap: paintRekap, anak: paintChild })[view.tab](body, user);
      if (global.Responsive) Responsive.apply(body);
    };
    view.repaint = paint;
    paint();
    // Data dari perangkat lain (status teman, ringkasan) diperbarui sendiri.
    if (global.Sync && Sync.isServer && Sync.isServer() && (view.tab === 'kelas' || view.tab === 'peringkat')) {
      roomSync = setInterval(() => { if (!body.isConnected) { stop(); return; } Sync.syncNow('ruang-belajar'); }, 20 * SEC);
    }
  }
  /** Dipanggil shell saat data lain berubah (lms:remote-change). */
  function onRemote(keys) {
    if (!view.repaint) return;
    if (!keys || keys.some(k => /^lms_study_|^lms_users$|^lms_presence/.test(k))) {
      const a = document.activeElement;
      if (a && a.closest && a.closest('.rb') && a.matches('input, textarea, select')) return;
      view.repaint();
    }
  }

  /* ---------------- Timer & Tujuan (siswa) ---------------- */
  function goalProgress(user, goalId, d) {
    return sessionsOf(user.id).filter(s => s.kind !== 'web' && s.goalId === goalId && s.day === d).reduce((n, s) => n + (Number(s.durationMs) || 0), 0);
  }
  function ringHtml(pct, color, inner) {
    const r = 54, c = 2 * Math.PI * r;
    return `<div class="rb-ring" style="--c:${esc(color)}"><svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${r}" class="rb-ring-bg"/><circle cx="60" cy="60" r="${r}" class="rb-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.max(0, Math.min(1, pct)))).toFixed(1)}"/></svg>
      <div class="rb-ring-in">${inner}</div></div>`;
  }
  function paintTimer(body, user) {
    const t = timerOf(user);
    const goals = goalsOf(user.id);
    const d = today();
    const st = statsOf(user.id);
    const todayP = period(st, 'day');
    const localWeb = Math.min(DAY, Number(getJ(WKEY(user), {})[d]) || 0);
    if (localWeb > todayP.w) { todayP.total += localWeb - todayP.w; todayP.w = localWeb; }
    const todaySessions = sessionsOf(user.id).filter(s => s.kind !== 'web' && s.day === d).sort((a, b) => b.endedAt - a.endedAt);
    const reached = lastReached && Date.now() - lastReached.at < 10 * MIN ? lastReached : null;
    let active;
    if (t) {
      const el = elapsedOf(t), pct = t.targetMs ? el / t.targetMs : 0;
      active = `<section class="rb-active ${t.runSince ? 'is-run' : 'is-pause'}" aria-label="Timer berjalan">
        ${ringHtml(pct, t.color || COLORS[0], `<span class="rb-ring-lbl">${t.runSince ? 'Sisa waktu' : 'Dijeda'}</span>
          <strong id="rbLeft">${fmtClock(Math.max(0, t.targetMs - el))}</strong><span class="rb-ring-sub" id="rbEl">${fmtClock(el)} berjalan</span>`)}
        <div class="rb-active-info">
          <span class="rb-kicker">Sedang dikerjakan</span>
          <h3>${esc(t.title)}</h3>
          <p>Target ${fmtDur(t.targetMs)}. ${t.runSince ? 'Teman-temanmu melihatmu sedang fokus di Ruang Kelas.' : 'Status istirahat terlihat di Ruang Kelas.'}${t.afkAt ? ` Dijeda otomatis pada ${esc(UI.fmtDateTime(t.afkAt))} karena tidak ada konfirmasi.` : ''}</p>
          ${t.ask ? `<div class="rb-ask" role="alert"><strong>Masih belajar?</strong> Konfirmasi dalam 3 menit agar waktu tetap dihitung.
            <button type="button" class="btn btn-sm btn-primary" id="rbStill">Ya, lanjut</button></div>` : ''}
          <div class="rb-controls">
            ${t.runSince ? `<button type="button" class="btn btn-secondary" id="rbPause">${IC.pause} Istirahat</button>` : `<button type="button" class="btn btn-primary" id="rbResume">${IC.play} Lanjutkan</button>`}
            <button type="button" class="btn btn-ghost" id="rbFinish">${IC.stop} Selesai & catat</button>
          </div>
        </div></section>`;
    } else if (reached) {
      active = `<section class="rb-active is-done"><div class="rb-done-ic">${svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>', 40)}</div>
        <div class="rb-active-info"><span class="rb-kicker">Tujuan tercapai</span><h3>${esc(reached.title)}</h3>
          <p>${fmtDur(reached.ms)} tercatat ke jam belajarmu hari ini.</p>
          <div class="rb-controls">${goals.some(g => g.id === reached.goalId) ? `<button type="button" class="btn btn-primary" data-rb-start="${esc(reached.goalId)}">${IC.play} Ulangi sesi</button>` : ''}
            <button type="button" class="btn btn-ghost" id="rbDismiss">Tutup</button></div></div></section>`;
    } else {
      active = `<section class="rb-active is-idle"><div class="rb-idle-ic">${svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2h6"/>', 34)}</div>
        <div class="rb-active-info"><span class="rb-kicker">Belum ada timer</span><h3>Pilih tujuan lalu tekan Mulai</h3>
          <p>Tambahkan tujuan belajar beserta durasinya. Waktumu tercatat otomatis dan muncul di peringkat. Waktu aktif di LMS juga dihitung.</p></div></section>`;
    }
    body.innerHTML = `<div class="rb-timer">
      ${active}
      <div class="rb-today">
        <div><span>Hari ini</span><strong>${fmtDur(todayP.total)}</strong></div>
        <div><span>Fokus (timer)</span><strong>${fmtDur(todayP.f)}</strong></div>
        <div><span>Waktu di LMS</span><strong>${fmtDur(todayP.w)}</strong></div>
        <div><span>Sesi</span><strong>${(st && st.days && st.days[d] && st.days[d].n) || 0}</strong></div>
      </div>
      <section class="rb-goals card-flat" aria-label="Tujuan belajar">
        <div class="rb-sec-head"><h3>Tujuan belajar</h3><span class="muted small">Progres direset setiap hari</span></div>
        <form class="rb-goal-form" id="rbGoalForm" novalidate>
          <label class="rb-f-title"><span>Judul tujuan</span><input name="title" maxlength="80" required placeholder="mis. Latihan PK — Barisan & Deret" /></label>
          <label class="rb-f-min"><span>Durasi (menit)</span><input name="min" type="number" min="5" max="600" step="5" value="50" required /></label>
          <div class="rb-f-quick" role="group" aria-label="Durasi cepat">${QUICK.map(q => `<button type="button" data-rb-quick="${q}">${q}</button>`).join('')}</div>
          <div class="rb-f-colors" role="radiogroup" aria-label="Warna">${COLORS.map((c, i) => `<label><input type="radio" name="color" value="${c}" ${i === goals.length % COLORS.length ? 'checked' : ''}/><span style="--c:${c}"></span></label>`).join('')}</div>
          <button type="submit" class="btn btn-primary">${IC.plus} Tambah</button>
        </form>
        ${goals.length ? `<ul class="rb-goal-list">${goals.map(g => {
          const done = goalProgress(user, g.id, d);
          const tgt = g.targetMin * MIN;
          const pct = Math.min(100, Math.round(done / tgt * 100));
          const running = t && t.goalId === g.id;
          return `<li class="rb-goal ${running ? 'is-running' : ''}" style="--c:${esc(g.color || COLORS[0])}">
            <span class="rb-goal-bar" aria-hidden="true"></span>
            <div class="rb-goal-main"><strong>${esc(g.title)}</strong>
              <span>${fmtDur(done)} dari ${fmtDur(tgt)} hari ini${pct >= 100 ? ' • tercapai' : ''}</span>
              <span class="rb-prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></span></div>
            <div class="rb-goal-act">
              ${running ? '<span class="rb-pill">Berjalan</span>' : `<button type="button" class="btn btn-sm btn-primary" data-rb-start="${esc(g.id)}" aria-label="Mulai ${esc(g.title)}">${IC.play} Mulai</button>`}
              <button type="button" class="icon-btn" data-rb-edit="${esc(g.id)}" aria-label="Ubah ${esc(g.title)}">${IC.edit}</button>
              <button type="button" class="icon-btn" data-rb-del="${esc(g.id)}" aria-label="Hapus ${esc(g.title)}">${IC.trash}</button>
            </div></li>`;
        }).join('')}</ul>` : '<p class="rb-empty">Belum ada tujuan. Tambahkan satu di atas, misalnya "Latihan Penalaran Umum 50 menit".</p>'}
      </section>
      <section class="rb-log card-flat" aria-label="Sesi hari ini">
        <div class="rb-sec-head"><h3>Catatan hari ini</h3></div>
        ${todaySessions.length ? `<ol class="rb-log-list">${todaySessions.map(s => `<li><time>${esc(UI.fmtDateTime(s.startedAt).split(' ').slice(-2).join(' '))}</time>
          <span>${esc(s.title)}</span><strong>${fmtDur(s.durationMs)}</strong>
          <button type="button" class="icon-btn" data-rb-delsess="${esc(s.id)}" aria-label="Hapus sesi ${esc(s.title)}">${IC.trash}</button></li>`).join('')}</ol>`
          : '<p class="rb-empty">Sesi yang selesai akan muncul di sini.</p>'}
      </section>
    </div>`;

    const form = body.querySelector('#rbGoalForm');
    body.querySelectorAll('[data-rb-quick]').forEach(b => b.addEventListener('click', () => { form.min.value = b.dataset.rbQuick; }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.title.value.replace(/\s+/g, ' ').trim();
      const min = Math.round(Number(form.min.value));
      if (title.length < 2) { UI.toast('Tulis judul tujuan minimal 2 huruf.', 'error'); form.title.focus(); return; }
      if (!(min >= 5 && min <= 600)) { UI.toast('Durasi 5–600 menit.', 'error'); form.min.focus(); return; }
      const color = (form.querySelector('[name=color]:checked') || {}).value || COLORS[0];
      const list = load(K.g);
      list.push({ id: newId('stg'), userId: user.id, title: title.slice(0, 80), targetMin: min, color, createdAt: Date.now() });
      save(K.g, list);
      paintTimer(body, user);
    });
    body.querySelectorAll('[data-rb-start]').forEach(b => b.addEventListener('click', () => {
      const g = goalsOf(user.id).find(x => x.id === b.dataset.rbStart);
      if (!g) return;
      if (timerOf(user) && !UI.confirmDialog('Timer lain sedang berjalan. Catat sesi itu lalu mulai tujuan ini?')) return;
      lastReached = null;
      startTimer(user, g);
      if ('Notification' in global && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { /* noop */ } }
      paintTimer(body, user);
    }));
    body.querySelectorAll('[data-rb-edit]').forEach(b => b.addEventListener('click', () => editGoal(user, b.dataset.rbEdit, () => paintTimer(body, user))));
    body.querySelectorAll('[data-rb-del]').forEach(b => b.addEventListener('click', () => {
      const list = load(K.g);
      const g = list.find(x => x.id === b.dataset.rbDel);
      if (!g || !UI.confirmDialog(`Hapus tujuan "${g.title}"? Sesi yang sudah tercatat tetap dihitung.`)) return;
      g.archived = true;
      save(K.g, list);
      paintTimer(body, user);
    }));
    body.querySelectorAll('[data-rb-delsess]').forEach(b => b.addEventListener('click', () => {
      if (!UI.confirmDialog('Hapus sesi ini dari catatan? Jam belajar hari ini ikut berkurang.')) return;
      save(K.s, load(K.s).filter(s => !(s.id === b.dataset.rbDelsess && s.userId === user.id)));
      recompute(user);
      paintTimer(body, user);
    }));
    const on = (id, fn) => { const el = body.querySelector('#' + id); if (el) el.addEventListener('click', fn); };
    on('rbPause', () => { pauseTimer(user); paintTimer(body, user); });
    on('rbResume', () => { resumeTimer(user); paintTimer(body, user); });
    on('rbStill', () => { confirmStill(user); paintTimer(body, user); });
    on('rbFinish', () => { finishTimer(user); paintTimer(body, user); });
    on('rbDismiss', () => { lastReached = null; paintTimer(body, user); });
    view.tick = () => {
      const tt = timerOf(user);
      const left = body.querySelector('#rbLeft');
      if (!tt || !left) return;
      const el = elapsedOf(tt);
      left.textContent = fmtClock(Math.max(0, tt.targetMs - el));
      const e2 = body.querySelector('#rbEl'); if (e2) e2.textContent = fmtClock(el) + ' berjalan';
      const fg = body.querySelector('.rb-ring-fg');
      if (fg && tt.targetMs) { const c = 2 * Math.PI * 54; fg.setAttribute('stroke-dashoffset', (c * (1 - Math.min(1, el / tt.targetMs))).toFixed(1)); }
    };
    view.repaint = () => paintTimer(body, user);
  }
  function editGoal(user, id, done) {
    const g = load(K.g).find(x => x.id === id && x.userId === user.id);
    if (!g) return;
    UI.modal.open('Ubah tujuan', `<form class="form" id="rbEditForm" novalidate>
      <div class="form-group"><label for="rbEt">Judul tujuan</label><input id="rbEt" maxlength="80" value="${esc(g.title)}" required /></div>
      <div class="form-group"><label for="rbEm">Durasi (menit)</label><input id="rbEm" type="number" min="5" max="600" step="5" value="${g.targetMin}" required /></div>
      <div class="flex-gap"><button type="submit" class="btn btn-primary">Simpan</button><button type="button" class="btn btn-secondary" data-cancel>Batal</button></div></form>`, { autofocus: false });
    const f = document.getElementById('rbEditForm');
    f.querySelector('[data-cancel]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = f.querySelector('#rbEt').value.replace(/\s+/g, ' ').trim();
      const min = Math.round(Number(f.querySelector('#rbEm').value));
      if (title.length < 2 || !(min >= 5 && min <= 600)) { UI.toast('Judul minimal 2 huruf, durasi 5–600 menit.', 'error'); return; }
      const list = load(K.g);
      const x = list.find(y => y.id === id);
      if (x) { x.title = title.slice(0, 80); x.targetMin = min; x.updatedAt = Date.now(); save(K.g, list); }
      UI.modal.close();
      done();
    });
  }

  /* ---------------- Ruang Kelas ---------------- */
  function seatsData(user) {
    const now = Date.now();
    const statsMap = new Map(statsAll().map(s => [s.userId, s]));
    const online = new Map((global.Presence ? Presence.getAll() : []).filter(r => r.user && r.user.role === 'siswa').map(r => [r.userId, r]));
    const kelas = view.scope === 'mine' && user.role === 'siswa' ? (DB.getUser(user.id) || user).kelas : (view.scope !== 'all' && view.scope !== 'mine' ? view.scope : '');
    const list = [];
    students().forEach(s => {
      if (kelas && s.kelas !== kelas) return;
      const st = statsMap.get(s.id);
      const live = liveOf(st, now);
      const pr = online.get(s.id);
      if (!live && !pr) return;
      list.push({ user: s, st, live, state: live ? live.state : 'web', today: period(st, 'day').total });
    });
    const order = { focus: 0, break: 1, web: 2 };
    return list.sort((a, b) => order[a.state] - order[b.state] || ((b.live && b.live.elapsed) || 0) - ((a.live && a.live.elapsed) || 0) || b.today - a.today);
  }
  const PROPS = {
    focus: '<g class="rb-prop-book"><path d="M38 9l22 3 22-3v10l-22 3-22-3z" fill="#fff" stroke="#cbd5e1"/><path d="M60 12v10" stroke="#cbd5e1"/><path d="M43 13l12 1.6M43 16l12 1.6M65 14.6l12-1.6M65 17.6l12-1.6" stroke="#94a3b8" stroke-width="1"/></g><g class="rb-pencil"><path d="M80 4l9 9-2 2-9-9z" fill="#f59e0b"/><path d="M78 6l-2 4 4-2" fill="#334155"/></g>',
    break: '<g><rect x="70" y="6" width="12" height="13" rx="2" fill="#f8fafc" stroke="#cbd5e1"/><path d="M82 9h3a3 3 0 0 1 0 6h-3" fill="none" stroke="#cbd5e1" stroke-width="1.6"/><path class="rb-steam" d="M74 3c-1.5-2 1.5-3 0-5M78 3c-1.5-2 1.5-3 0-5" fill="none" stroke="#94a3b8" stroke-width="1.3" stroke-linecap="round"/></g><path d="M36 14l18 2-18 3z" fill="#e2e8f0"/>',
    web: '<g><rect x="40" y="-4" width="40" height="22" rx="2.5" fill="#334155"/><circle class="rb-glow" cx="60" cy="7" r="2.2" fill="#a5b4fc"/><path d="M34 18h52l-3 3H37z" fill="#475569"/></g>'
  };
  function seatHtml(x, now) {
    const s = x.user;
    const code = global.Avatars ? Avatars.codeFor(s) : '';
    const fig = code ? Avatars.svg(code, { bare: true }) : '';
    const first = String(s.name || '?').split(/\s+/)[0];
    const label = x.state === 'focus' ? 'Fokus' : x.state === 'break' ? 'Istirahat' : 'Di LMS';
    const time = x.live ? `<span class="rb-seat-time" data-rb-since="${x.state === 'focus' && x.live.since ? x.live.since : ''}" data-rb-acc="${x.live.accMs || 0}">${fmtClock(x.live.elapsed)}</span>`
      : `<span class="rb-seat-time is-muted">${fmtDur(x.today)} hari ini</span>`;
    return `<button type="button" class="rb-seat is-${x.state}" data-rb-seat="${esc(s.id)}" aria-label="${esc(s.name)}: ${label}${x.live ? ' — ' + esc(x.live.title || '') : ''}">
      <span class="rb-seat-stage"><span class="rb-fig">${fig}</span>
        <svg class="rb-desk" viewBox="0 0 120 52" aria-hidden="true"><g transform="translate(0 8)">${PROPS[x.state]}</g>
          <rect x="4" y="26" width="112" height="9" rx="3" class="rb-desk-top"/><rect x="12" y="35" width="96" height="15" rx="2" class="rb-desk-front"/></svg>
        <span class="rb-state" aria-hidden="true">${label}</span></span>
      <span class="rb-seat-name">${esc(first)}</span>
      ${x.live && x.live.title ? `<span class="rb-seat-goal">${esc(x.live.title)}</span>` : `<span class="rb-seat-goal">${esc(s.kelas || '')}</span>`}
      ${time}</button>`;
  }
  function paintRoom(body, user) {
    const now = Date.now();
    const seats = seatsData(user);
    const n = (st) => seats.filter(x => x.state === st).length;
    const kelasList = [...new Set(students().map(s => s.kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const minSeats = Math.max(6, seats.length);              // kursi kosong secukupnya agar ruang tetap terasa kelas
    const d = new Date(UI.nowInTz());
    body.innerHTML = `<div class="rb-room">
      <div class="rb-board">
        <div class="rb-board-txt"><span>Ruang Belajar Bersama</span><strong>${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</strong>
          <p>${n('focus')} fokus • ${n('break')} istirahat • ${n('web')} di LMS</p></div>
        <div class="rb-clock" aria-hidden="true"><span class="rb-h"></span><span class="rb-m"></span></div>
      </div>
      <div class="rb-filter" role="group" aria-label="Kelas">
        <button type="button" class="rb-chip ${view.scope === 'all' ? 'is-on' : ''}" data-rb-scope="all">Semua kelas</button>
        ${user.role === 'siswa' && user.kelas ? `<button type="button" class="rb-chip ${view.scope === 'mine' ? 'is-on' : ''}" data-rb-scope="mine">Kelasku (${esc(user.kelas)})</button>`
          : kelasList.map(k => `<button type="button" class="rb-chip ${view.scope === k ? 'is-on' : ''}" data-rb-scope="${esc(k)}">${esc(k)}</button>`).join('')}
      </div>
      <div class="rb-floor">
        <div class="rb-seats">${seats.map(x => seatHtml(x, now)).join('')}${Array.from({ length: Math.max(0, minSeats - seats.length) }, () => `<span class="rb-seat is-empty" aria-hidden="true"><span class="rb-seat-stage">
          <svg class="rb-desk" viewBox="0 0 120 52"><rect x="4" y="26" width="112" height="9" rx="3" class="rb-desk-top"/><rect x="12" y="35" width="96" height="15" rx="2" class="rb-desk-front"/></svg></span><span class="rb-seat-name">Kursi kosong</span></span>`).join('')}</div>
      </div>
      ${seats.length ? '' : '<p class="rb-empty">Belum ada yang sedang belajar. Mulai timer di tab Timer & Tujuan agar kamu muncul di sini.</p>'}
      <p class="rb-legend"><span class="is-focus">Fokus: timer berjalan</span><span class="is-break">Istirahat: timer dijeda</span><span class="is-web">Di LMS: online tanpa timer</span></p>
    </div>`;
    const clock = () => {
      const t = new Date(UI.nowInTz());
      const h = body.querySelector('.rb-h'), m = body.querySelector('.rb-m');
      if (h) h.style.transform = `rotate(${(t.getHours() % 12) * 30 + t.getMinutes() * 0.5}deg)`;
      if (m) m.style.transform = `rotate(${t.getMinutes() * 6}deg)`;
    };
    clock();
    body.querySelectorAll('[data-rb-scope]').forEach(b => b.addEventListener('click', () => { view.scope = b.dataset.rbScope; paintRoom(body, user); }));
    body.querySelectorAll('[data-rb-seat]').forEach(b => b.addEventListener('click', () => openPerson(b.dataset.rbSeat)));
    let ticks = 0;
    const tick = () => {
      const t = Date.now();
      body.querySelectorAll('[data-rb-since]').forEach(el => {
        const since = Number(el.dataset.rbSince), acc = Number(el.dataset.rbAcc) || 0;
        if (since) el.textContent = fmtClock(acc + t - since);
      });
      if (++ticks % 30 === 0) { clock(); paintRoom(body, user); }
    };
    view.tick = tick;
    const iv = setInterval(() => { if (!body.isConnected || view.tick !== tick) { clearInterval(iv); return; } tick(); }, SEC);
    view.repaint = () => paintRoom(body, user);
  }
  function openPerson(userId) {
    const u = DB.getUser(userId);
    if (!u) return;
    const st = statsOf(userId);
    const live = liveOf(st);
    const p = (k) => period(st, k);
    UI.modal.open(u.name, `<div class="rb-person">
      <div class="rb-person-head"><span class="rb-person-av">${global.Avatars ? Avatars.svg(Avatars.codeFor(u)) : ''}</span>
        <div><strong>${esc(u.name)}</strong><span>${esc(u.kelas || 'Mentee')}${u.targetUniv ? ' • target ' + esc(u.targetUniv) : ''}</span>
        ${live ? `<span class="rb-pill is-${live.state}">${live.state === 'focus' ? 'Fokus' : 'Istirahat'}: ${esc(live.title || '')} • ${fmtClock(live.elapsed)}</span>` : ''}</div></div>
      <dl class="rb-person-stats">${[['Hari ini', 'day'], ['Minggu ini', 'week'], ['Bulan ini', 'month'], ['Total', 'total']].map(([l, k]) => `<div><dt>${l}</dt><dd>${fmtDur(p(k).total)}</dd></div>`).join('')}</dl>
      ${weekBarsHtml(st)}</div>`, { autofocus: false });
  }

  /* ---------------- Statistik ---------------- */
  function weekBarsHtml(st) {
    const t = today();
    const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
    const vals = days.map(d => { const x = st && st.days && st.days[d]; return { d, f: x ? x.f || 0 : 0, w: x ? x.w || 0 : 0 }; });
    const max = Math.max(HOUR, ...vals.map(v => v.f + v.w));
    return `<figure class="rb-bars" aria-label="Jam belajar 7 hari terakhir"><div class="rb-bars-g">
      ${vals.map(v => `<div class="rb-bar" title="${esc(UI.fmtYMD(v.d))}: ${fmtDur(v.f + v.w)} (fokus ${fmtDur(v.f)}, di LMS ${fmtDur(v.w)})">
        <span class="rb-bar-val">${v.f + v.w ? fmtHours(v.f + v.w) : ''}</span>
        <span class="rb-bar-col"><i class="is-w" style="height:${(v.w / max * 100).toFixed(1)}%"></i><i class="is-f" style="height:${(v.f / max * 100).toFixed(1)}%"></i></span>
        <span class="rb-bar-d">${DAYS_SHORT[dow(v.d)]}</span></div>`).join('')}</div>
      <figcaption><span class="is-f">Fokus</span><span class="is-w">Di LMS</span><span>jam</span></figcaption></figure>`;
  }
  function heatHtml(st, ym) {
    const first = ym + '-01';
    const offset = (dow(first) + 6) % 7;
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push('<span class="rb-heat-c is-pad"></span>');
    for (let d = first; d.slice(0, 7) === ym; d = addDays(d, 1)) {
      const ms = dayTotal(st, d);
      const lvl = ms <= 0 ? 0 : ms < HOUR ? 1 : ms < 2 * HOUR ? 2 : ms < 4 * HOUR ? 3 : 4;
      cells.push(`<span class="rb-heat-c l${lvl} ${d === today() ? 'is-today' : ''}" title="${esc(UI.fmtYMD(d))}: ${fmtDur(ms)}"><span>${Number(d.slice(8))}</span></span>`);
      if (cells.length > 45) break;
    }
    return `<div class="rb-heat"><div class="rb-heat-h">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="rb-heat-g">${cells.join('')}</div>
      <div class="rb-heat-legend"><span>0</span>${[1, 2, 3, 4].map(l => `<i class="l${l}"></i>`).join('')}<span>4+ jam</span></div></div>`;
  }
  function statsHtml(user, st, own) {
    const t = today();
    const cards = [['Hari ini', 'day'], ['Minggu ini', 'week'], ['Bulan ini', 'month'], ['Total', 'total']].map(([l, k]) => {
      const p = period(st, k);
      return `<div class="rb-stat"><span>${l}</span><strong>${fmtDur(p.total)}</strong>${k !== 'total' ? `<small>fokus ${fmtDur(p.f)} • di LMS ${fmtDur(p.w)}</small>` : '<small>sejak mulai mencatat</small>'}</div>`;
    }).join('');
    let byGoal = '';
    if (own) {
      const map = new Map();
      sessionsOf(user.id).filter(s => s.kind !== 'web' && s.day >= weekStart(t)).forEach(s => {
        const k = s.title || 'Belajar';
        map.set(k, (map.get(k) || 0) + (Number(s.durationMs) || 0));
      });
      const rows = [...map.entries()].sort((a, b) => b[1] - a[1]);
      const max = rows.length ? rows[0][1] : 1;
      byGoal = `<section class="card-flat"><div class="rb-sec-head"><h3>Per tujuan minggu ini</h3></div>
        ${rows.length ? `<ul class="rb-goalstat">${rows.map(([k, v]) => `<li><span>${esc(k)}</span><span class="rb-prog"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><strong>${fmtDur(v)}</strong></li>`).join('')}</ul>` : '<p class="rb-empty">Belum ada sesi fokus minggu ini.</p>'}</section>`;
    }
    const ym = t.slice(0, 7);
    return `<div class="rb-statsview"><div class="rb-stats-grid">${cards}</div>
      <div class="rb-two">
        <section class="card-flat"><div class="rb-sec-head"><h3>7 hari terakhir</h3></div>${weekBarsHtml(st)}</section>
        <section class="card-flat"><div class="rb-sec-head"><h3>${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}</h3></div>${heatHtml(st, ym)}</section>
      </div>${byGoal}</div>`;
  }
  function paintStats(body, user) {
    body.innerHTML = statsHtml(user, statsOf(user.id), true);
    view.repaint = () => paintStats(body, user);
  }
  function paintChild(body, user) {
    const kids = DB.getChildren(user.id);
    if (!kids.length) { body.innerHTML = '<p class="rb-empty">Akun Anda belum terhubung dengan akun anak.</p>'; return; }
    if (!kids.some(k => k.id === view.childId)) view.childId = kids[0].id;
    const kid = kids.find(k => k.id === view.childId);
    const st = statsOf(kid.id);
    const live = liveOf(st);
    const rank = ranking('week', kid.kelas).findIndex(r => r.user.id === kid.id);
    body.innerHTML = `<div class="rb-statsview">${kids.length > 1 ? `<div class="rb-filter">${kids.map(k => `<button type="button" class="rb-chip ${k.id === kid.id ? 'is-on' : ''}" data-rb-kid="${esc(k.id)}">${esc(k.name)}</button>`).join('')}</div>` : ''}
      <p class="rb-note">${esc(kid.name)}${live ? ` sedang ${live.state === 'focus' ? 'fokus' : 'istirahat'} pada "${esc(live.title || '')}" (${fmtClock(live.elapsed)}).` : ' tidak sedang menjalankan timer.'}
        ${rank >= 0 ? ` Peringkat minggu ini di ${esc(kid.kelas || 'kelasnya')}: ke-${rank + 1}.` : ''} Jam belajar = waktu fokus dengan timer + waktu aktif di LMS.</p>
      ${statsHtml(kid, st, false)}</div>`;
    body.querySelectorAll('[data-rb-kid]').forEach(b => b.addEventListener('click', () => { view.childId = b.dataset.rbKid; paintChild(body, user); }));
    view.repaint = () => paintChild(body, user);
  }

  /* ---------------- Peringkat ---------------- */
  function ranking(kind, kelas) {
    const statsMap = new Map(statsAll().map(s => [s.userId, s]));
    return students().filter(s => !kelas || s.kelas === kelas)
      .map(s => { const p = period(statsMap.get(s.id), kind); return { user: s, total: p.total, f: p.f, w: p.w }; })
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total || a.user.name.localeCompare(b.user.name, 'id'));
  }
  function paintRank(body, user) {
    const kelasList = [...new Set(students().map(s => s.kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const myKelas = user.role === 'siswa' ? (DB.getUser(user.id) || user).kelas : '';
    const kelas = view.scope === 'mine' ? myKelas : (view.scope !== 'all' ? view.scope : '');
    const rows = ranking(view.period, kelas);
    const top = rows.slice(0, 50);
    const myIdx = rows.findIndex(r => r.user.id === user.id);
    const max = rows.length ? rows[0].total : 1;
    const row = (r, i) => `<li class="rb-rank-row ${r.user.id === user.id ? 'is-me' : ''} ${i < 3 ? 'top' + (i + 1) : ''}">
      <span class="rb-rank-n">${i + 1}</span><span class="rb-rank-av">${global.Avatars ? Avatars.inner(r.user) : ''}</span>
      <span class="rb-rank-who"><strong>${esc(r.user.name)}${r.user.id === user.id ? ' (kamu)' : ''}</strong><small>${esc(r.user.kelas || '-')}</small></span>
      <span class="rb-rank-bar" aria-hidden="true"><i class="is-f" style="width:${(r.f / max * 100).toFixed(1)}%"></i><i class="is-w" style="width:${(r.w / max * 100).toFixed(1)}%"></i></span>
      <strong class="rb-rank-t">${fmtDur(r.total)}</strong></li>`;
    body.innerHTML = `<div class="rb-rank">
      <div class="rb-rank-tools">
        <div class="rb-seg" role="radiogroup" aria-label="Periode">${[['day', 'Hari ini'], ['week', 'Minggu ini'], ['month', 'Bulan ini'], ['total', 'Total']].map(([k, l]) =>
          `<button type="button" role="radio" aria-checked="${view.period === k}" class="${view.period === k ? 'is-on' : ''}" data-rb-period="${k}">${l}</button>`).join('')}</div>
        <label class="rb-select"><span class="sr-only">Kelas</span><select id="rbRankKelas">
          <option value="all">Semua kelas</option>${myKelas ? `<option value="mine" ${view.scope === 'mine' ? 'selected' : ''}>Kelasku (${esc(myKelas)})</option>` : ''}
          ${kelasList.map(k => `<option value="${esc(k)}" ${view.scope === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
      </div>
      ${rows.length ? `<ol class="rb-rank-list">${top.map(row).join('')}</ol>${myIdx >= 50 ? `<ol class="rb-rank-list is-mine" start="${myIdx + 1}">${row(rows[myIdx], myIdx)}</ol>` : ''}`
        : '<p class="rb-empty">Belum ada jam belajar tercatat pada periode ini.</p>'}
      <p class="rb-legend"><span class="is-focus">Fokus (timer)</span><span class="is-web">Waktu aktif di LMS</span><span>Minggu dimulai Senin. Zona waktu ${esc(tz())}.</span></p>
    </div>`;
    body.querySelectorAll('[data-rb-period]').forEach(b => b.addEventListener('click', () => { view.period = b.dataset.rbPeriod; paintRank(body, user); }));
    body.querySelector('#rbRankKelas').addEventListener('change', (e) => { view.scope = e.target.value; paintRank(body, user); });
    view.repaint = () => paintRank(body, user);
  }

  /* ---------------- Rekap harian (admin & tutor) ---------------- */
  function scopeStudents(user) {
    if (user.role === 'admin') return students();
    const ids = new Set();
    DB.getCoursesByTeacher(user.id).forEach(c => DB.getEnrollmentsByCourse(c.id).forEach(e => ids.add(e.studentId)));
    return students().filter(s => ids.has(s.id));
  }
  function paintRekap(body, user) {
    const all = scopeStudents(user);
    const kelasList = [...new Set(all.map(s => s.kelas).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const list = all.filter(s => !view.rekapKelas || s.kelas === view.rekapKelas);
    const t = today();
    const days = Array.from({ length: view.rekapDays }, (_, i) => addDays(t, i - view.rekapDays + 1));
    const statsMap = new Map(statsAll().map(s => [s.userId, s]));
    const rows = list.map(s => {
      const st = statsMap.get(s.id);
      const vals = days.map(d => dayTotal(st, d));
      return { s, vals, sum: vals.reduce((a, b) => a + b, 0), total: (st && st.total) || 0 };
    }).sort((a, b) => b.sum - a.sum || a.s.name.localeCompare(b.s.name, 'id'));
    const colTotals = days.map((_, i) => rows.reduce((n, r) => n + r.vals[i], 0));
    const active = rows.filter(r => r.sum > 0).length;
    body.innerHTML = `<div class="rb-rekap">
      <div class="rb-rank-tools">
        <div class="rb-seg" role="radiogroup" aria-label="Rentang">${[7, 14, 30].map(n => `<button type="button" role="radio" aria-checked="${view.rekapDays === n}" class="${view.rekapDays === n ? 'is-on' : ''}" data-rb-days="${n}">${n} hari</button>`).join('')}</div>
        <label class="rb-select"><span class="sr-only">Kelas</span><select id="rbRekapKelas"><option value="">Semua kelas</option>${kelasList.map(k => `<option value="${esc(k)}" ${view.rekapKelas === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-sm btn-secondary" id="rbCsv">${IC.download} Unduh CSV</button>
      </div>
      <p class="rb-note">${active} dari ${rows.length} mentee belajar dalam ${view.rekapDays} hari terakhir • total ${fmtDur(rows.reduce((n, r) => n + r.sum, 0))}. Angka per hari = fokus (timer) + waktu aktif di LMS, dalam jam.</p>
      ${rows.length ? `<div class="table-wrap"><table class="table rb-rekap-t">
        <thead><tr><th>Mentee</th>${days.map(d => `<th class="num" title="${esc(UI.fmtYMD(d))}">${DAYS_SHORT[dow(d)]}<br><small>${Number(d.slice(8))}/${Number(d.slice(5, 7))}</small></th>`).join('')}<th class="num">${view.rekapDays} hari</th><th class="num">Total</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td><button type="button" class="rb-link" data-rb-person="${esc(r.s.id)}">${esc(r.s.name)}</button><div class="muted small">${esc(r.s.kelas || '-')}</div></td>
          ${r.vals.map(v => `<td class="num ${v ? '' : 'is-zero'}">${v ? fmtHours(v) : '—'}</td>`).join('')}<td class="num"><strong>${fmtHours(r.sum)}</strong></td><td class="num">${fmtHours(r.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th>Jumlah</th>${colTotals.map(v => `<th class="num">${fmtHours(v)}</th>`).join('')}<th class="num">${fmtHours(rows.reduce((n, r) => n + r.sum, 0))}</th><th></th></tr></tfoot>
      </table></div>` : '<p class="rb-empty">Belum ada mentee pada cakupan ini.</p>'}
    </div>`;
    body.querySelectorAll('[data-rb-days]').forEach(b => b.addEventListener('click', () => { view.rekapDays = Number(b.dataset.rbDays); paintRekap(body, user); }));
    body.querySelector('#rbRekapKelas').addEventListener('change', (e) => { view.rekapKelas = e.target.value; paintRekap(body, user); });
    body.querySelectorAll('[data-rb-person]').forEach(b => b.addEventListener('click', () => openPerson(b.dataset.rbPerson)));
    body.querySelector('#rbCsv').addEventListener('click', () => {
      const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [['Nama', 'Kelas'].concat(days, [`${view.rekapDays} hari (jam)`, 'Total (jam)']).map(q).join(',')]
        .concat(rows.map(r => [r.s.name, r.s.kelas || ''].concat(r.vals.map(v => (v / HOUR).toFixed(2)), [(r.sum / HOUR).toFixed(2), (r.total / HOUR).toFixed(2)]).map(q).join(',')));
      const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `rekap-jam-belajar-${t}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    view.repaint = () => paintRekap(body, user);
  }

  /* Pembaruan dari perangkat/tab lain. */
  global.addEventListener('lms:remote-change', (e) => onRemote(e.detail && e.detail.keys));
  global.addEventListener('storage', (e) => { if (e.key && /^lms_study_(sessions|goals|stats)$|^lms_presence_v1$/.test(e.key)) onRemote([e.key]); });

  global.StudyRoom = {
    init, render, stop, onRemote,
    // untuk ringkasan di halaman lain & pengujian
    statsOf, period, liveOf, summarize, recompute, timerOf, startTimer, pauseTimer, resumeTimer, finishTimer, checkTimer, webTick, webFlush,
    _test: { dayOf, addDays, weekStart, elapsedOf, K }
  };
})(window);
