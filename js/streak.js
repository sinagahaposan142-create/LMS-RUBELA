/* =====================================================================
 * js/streak.js — Streak API & gamifikasi belajar
 * ---------------------------------------------------------------------
 * Mesin streak bersifat DETERMINISTIK: tidak ada angka streak tersimpan
 * yang bisa diubah. Setiap kali dibutuhkan, streak dihitung ulang dari:
 *   1. log aktivitas sah (DB.getLearningLog, terverifikasi rantai hash),
 *   2. aktivitas turunan dari tabel resmi (tugas, tryout, presensi),
 *   3. buku besar Streak Freeze pemberian admin.
 * Pergantian hari memakai zona waktu LMS atau zona pengguna (diatur admin).
 * Login TIDAK menyalakan streak; hanya aktivitas belajar yang selesai.
 * ===================================================================*/
(function (global) {
  'use strict';

  const esc = (s) => UI.esc(s);
  const DAY = 86400000;
  const T = () => DB.LEARNING_TYPES;

  /* ------------------------- konfigurasi bawaan ------------------------- */
  const DEFAULT_MILESTONES = [
    { key: 'm3', days: 3, label: 'Percikan Pertama', icon: '✨', points: 15, unlock: 'lamps', desc: 'Lampu taman dan bangku pertama muncul di tepi danau.' },
    { key: 'm7', days: 7, label: 'Taman Bersemi', icon: '🌷', points: 30, unlock: 'garden', desc: 'Taman bunga di sekeliling danau mulai berkembang.' },
    { key: 'm14', days: 14, label: 'Danau Hidup', icon: '🦢', points: 50, unlock: 'wildlife', desc: 'Angsa, burung, dan perahu meramaikan danau.' },
    { key: 'm30', days: 30, label: 'Menara Ilmu', icon: '🗼', points: 80, unlock: 'landmark', desc: 'Landmark khusus: Menara Jam Rubela berdiri di pulau tengah danau.' },
    { key: 'm60', days: 60, label: 'Jembatan Cahaya', icon: '🌉', points: 120, unlock: 'bridge', desc: 'Jembatan menuju pulau dan air mancur menyala.' },
    { key: 'm100', days: 100, label: 'Pulau Pustaka', icon: '🏝️', points: 200, unlock: 'island', desc: 'Area istimewa: perpustakaan & observatorium di pulau terbuka.' },
    { key: 'batch', days: 174, label: 'Satu Batch Penuh', icon: '🎓', points: 300, unlock: 'gate', desc: 'Gerbang kelulusan Rubela berdiri dengan lentera-lentera.', batch: true },
    { key: 'm365', days: 365, label: 'Legenda Rubela', icon: '👑', points: 500, unlock: 'aurora', desc: 'Pencapaian eksklusif: aurora dan bendera emas di langit kampus.' }
  ];
  /* Peringkat bersifat sementara & dapat diubah admin. Sumber: QS World
   * University Rankings 2026 (topuniversities.com, rilis Juni 2025). Angka yang
   * belum diverifikasi dibiarkan kosong agar admin mengisinya dari sumber resmi. */
  const QS_URL = 'https://www.topuniversities.com/world-university-rankings/2026';
  const DEFAULT_UNIVERSITIES = [
    { key: 'ui', name: 'Universitas Indonesia', short: 'UI', style: 'tower', color: '#facc15', rank: '189', rankingSource: 'QS World University Rankings 2026', rankingUrl: QS_URL },
    { key: 'ugm', name: 'Universitas Gadjah Mada', short: 'UGM', style: 'colonnade', color: '#e2e8f0', rank: '', rankingSource: 'QS World University Rankings 2026', rankingUrl: QS_URL },
    { key: 'itb', name: 'Institut Teknologi Bandung', short: 'ITB', style: 'gonjong', color: '#93c5fd', rank: '', rankingSource: 'QS World University Rankings 2026', rankingUrl: QS_URL },
    { key: 'unair', name: 'Universitas Airlangga', short: 'Unair', style: 'modern', color: '#fde68a', rank: '287', rankingSource: 'QS World University Rankings 2026', rankingUrl: QS_URL },
    { key: 'ipb', name: 'IPB University', short: 'IPB', style: 'joglo', color: '#bfdbfe', rank: '', rankingSource: 'QS World University Rankings 2026', rankingUrl: QS_URL }
  ];
  const STYLES = { tower: 'Menara bertingkat', colonnade: 'Balairung berpilar', gonjong: 'Atap gonjong', modern: 'Gedung modern bergerbang', joglo: 'Atap joglo' };
  const LEVEL_TITLES = [[1, 'Pemula'], [3, 'Pejuang'], [5, 'Tekun'], [8, 'Konsisten'], [12, 'Disiplin'], [16, 'Ambisius'], [20, 'Legenda Rubela']];

  function settings() { return DB.getSettings(); }
  function programTotal() {
    const st = settings();
    return Math.max(30, (Number(st.streakProgramDays) || 174) + Math.max(0, Number(st.streakProgramExtraDays) || 0));
  }
  function milestones() {
    const custom = settings().streakMilestones;
    const list = DEFAULT_MILESTONES.map(m => {
      const c = Array.isArray(custom) ? custom.find(x => x.key === m.key) : null;
      const merged = Object.assign({}, m, c ? { days: Number(c.days) || m.days, label: c.label || m.label, points: Number(c.points) >= 0 ? Number(c.points) : m.points, desc: c.desc || m.desc } : {});
      if (m.batch) merged.days = programTotal();      // mengikuti durasi batch
      return merged;
    });
    return list.sort((a, b) => a.days - b.days);
  }
  function universities() {
    const custom = settings().streakUniversities;
    return (Array.isArray(custom) && custom.length === 5 ? custom : DEFAULT_UNIVERSITIES).map((u, i) => Object.assign({}, DEFAULT_UNIVERSITIES[i], u));
  }

  /* ------------------------- utilitas tanggal ------------------------- */
  const parse = (ymd) => Date.parse(ymd + 'T00:00:00Z');
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (ymd, n) => fmt(parse(ymd) + n * DAY);
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const weekKey = (ymd) => { const d = new Date(parse(ymd)); const dow = (d.getUTCDay() + 6) % 7; return fmt(parse(ymd) - dow * DAY); };
  const monthKey = (ymd) => ymd.slice(0, 7);

  function levelOf(xp) {
    // XP total untuk mencapai level L = 50·L·(L−1)
    let L = 1;
    while (50 * (L + 1) * L <= xp && L < 99) L++;
    const cur = 50 * L * (L - 1), next = 50 * (L + 1) * L;
    const title = LEVEL_TITLES.filter(t => L >= t[0]).pop()[1];
    return { level: L, title, xp, floor: cur, next, progress: Math.round((xp - cur) / (next - cur) * 100) };
  }

  /* ------------------------- mesin streak ------------------------- */
  const memo = new Map();
  function memoKey(userId) {
    const k = ['lms_learning_log', 'lms_submissions', 'lms_cbt_attempts', 'lms_attendance', 'lms_streak_grants', 'lms_settings', 'lms_class_plans']
      .map(x => (localStorage.getItem(x) || '').length).join(':');
    return userId + '|' + k + '|' + DB.ymdInTz(Date.now(), DB.streakTzFor(DB.getUser(userId))) + '|' + new Date().getUTCHours();
  }

  /** Semua aktivitas (log sah + turunan) beserta XP setelah batas harian. */
  function events(userId) {
    const valid = DB.verifyLearningLog(userId);
    const logged = DB.getLearningLog(userId).map(e => Object.assign({}, e, { valid: valid.get(e.id) !== false }));
    const derivedRaw = DB.derivedLearning(userId).sort((a, b) => a.at - b.at);
    const perDayType = {};
    const derived = derivedRaw.map(e => {
      const k = e.day + ':' + e.type;
      perDayType[k] = (perDayType[k] || 0) + 1;
      const def = T()[e.type];
      const capped = perDayType[k] > def.cap;
      return Object.assign({ valid: true, xp: capped ? 0 : def.xp, capped }, e);
    });
    return logged.concat(derived).sort((a, b) => a.at - b.at);
  }

  function compute(userId, nowTs) {
    const now = nowTs || Date.now();
    if (!nowTs) { const k = memoKey(userId); const hit = memo.get(userId); if (hit && hit.k === k) return hit.v; }
    const user = DB.getUser(userId);
    const st = settings();
    const tz = DB.streakTzFor(user);
    const today = DB.ymdInTz(now, tz);
    const goal = Math.max(1, Number(st.streakDailyGoal) || 3);
    const minAct = Math.max(1, Number(st.streakMinActivities) || 1);
    const all = events(userId);
    const days = new Map();
    const dayOf = (d) => { if (!days.has(d)) days.set(d, { day: d, count: 0, types: new Set(), xp: 0, login: false, entries: [] }); return days.get(d); };
    let tampered = 0;
    all.forEach(e => {
      if (!e.valid) { tampered++; return; }
      const d = dayOf(e.day);
      d.entries.push(e);
      d.xp += Number(e.xp) || 0;
      if (e.type === 'login') { d.login = true; return; }
      if (e.learning) { d.count++; d.types.add(e.type); }
    });
    // Target harian: bonus turunan bila jenis aktivitas berbeda ≥ target.
    days.forEach(d => {
      if (d.types.size >= goal) {
        d.goalMet = true;
        d.xp += T().target.xp;
        d.entries.push({ id: 'd_goal_' + d.day, type: 'target', day: d.day, at: parse(d.day) + 23 * 3600000, xp: T().target.xp, learning: true, derived: true, valid: true });
      }
    });
    const isActive = (d) => { const x = days.get(d); return !!x && x.count >= minAct; };
    const activeList = [...days.values()].filter(d => d.count >= minAct).map(d => d.day).sort();

    // Buku besar freeze pemberian admin
    const grants = DB.getStreakGrants(userId);
    const grantByDay = {};
    grants.forEach(g => { grantByDay[g.day] = (grantByDay[g.day] || 0) + g.count; });
    const firstGrant = grants.map(g => g.day).sort()[0];
    const start = [activeList[0], firstGrant].filter(Boolean).sort()[0];

    const status = {};
    let streak = 0, longest = 0, freezes = 0, frozenTotal = 0;
    const usedMonth = {};
    const breaks = [];
    const series = [];
    const freezeOn = st.streakFreezeEnabled !== false;
    const earnEvery = Math.max(0, Number(st.streakFreezeEarnEvery) || 0);
    const fMax = Math.max(0, Number(st.streakFreezeMax) || 0);
    const fMonth = Math.max(0, Number(st.streakFreezeMonthlyLimit) || 0);
    if (start) {
      for (let d = start; d <= today; d = addDays(d, 1)) {
        if (grantByDay[d]) freezes = Math.min(fMax + 5, freezes + grantByDay[d]);
        if (isActive(d)) {
          streak++; longest = Math.max(longest, streak);
          status[d] = 'active';
          if (freezeOn && earnEvery && streak % earnEvery === 0) freezes = Math.min(Math.max(fMax, freezes), freezes + 1);
        } else if (d === today) {
          status[d] = 'pending';
        } else if (freezeOn && streak > 0 && freezes > 0 && (usedMonth[monthKey(d)] || 0) < fMonth) {
          freezes--; frozenTotal++;
          usedMonth[monthKey(d)] = (usedMonth[monthKey(d)] || 0) + 1;
          status[d] = 'frozen';
        } else {
          if (streak > 0) breaks.push({ day: d, lost: streak });
          streak = 0;
          status[d] = days.get(d) && days.get(d).login ? 'login' : 'missed';
        }
        series.push({ day: d, streak });
      }
    }
    const current = streak;
    const activeToday = isActive(today);
    const todayInfo = days.get(today) || { types: new Set(), count: 0, login: false, xp: 0, entries: [] };

    // Weekly & monthly streak (periode berjalan tidak memutus streak).
    const wCount = {}, mCount = {};
    activeList.forEach(d => { wCount[weekKey(d)] = (wCount[weekKey(d)] || 0) + 1; mCount[monthKey(d)] = (mCount[monthKey(d)] || 0) + 1; });
    const wT = Math.max(1, Math.min(7, Number(st.streakWeeklyTarget) || 4));
    const mT = Math.max(1, Math.min(28, Number(st.streakMonthlyTarget) || 12));
    let weekly = 0;
    for (let w = weekKey(today), first = true; ; w = addDays(w, -7), first = false) {
      if ((wCount[w] || 0) >= wT) weekly++;
      else if (!first) break;
      if (w < (activeList[0] || today)) break;
    }
    let monthly = 0;
    const prevMonth = (m) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
    for (let m = monthKey(today), first = true; ; m = prevMonth(m), first = false) {
      if ((mCount[m] || 0) >= mT) monthly++;
      else if (!first) break;
      if (m < monthKey(activeList[0] || today)) break;
    }

    const ms = milestones();
    const reached = ms.filter(m => longest >= m.days);
    const nextMs = ms.find(m => current < m.days) || null;
    const bonus = reached.reduce((n, m) => n + (Number(m.points) || 0), 0);
    let xpTotal = 0, learningCount = 0;
    days.forEach(d => { xpTotal += d.xp; learningCount += d.count + (d.goalMet ? 1 : 0); });
    xpTotal += bonus;
    const lvl = levelOf(xpTotal);

    // Batch / program belajar
    const total = programTotal();
    const pStart = settings().streakProgramStart || activeList[0] || today;
    const batchDay = Math.max(0, Math.min(total, diffDays(pStart, today) + 1));
    const batchActive = activeList.filter(d => d >= pStart && diffDays(pStart, d) < total).length;

    const result = {
      userId, tz, today, current, longest, activeToday, atRisk: !activeToday && current > 0,
      totalActiveDays: activeList.length, totalLearning: learningCount, xp: xpTotal, level: lvl,
      weekly, monthly, weeklyTarget: wT, monthlyTarget: mT,
      thisWeekDays: wCount[weekKey(today)] || 0, thisMonthDays: mCount[monthKey(today)] || 0,
      goal, todayTypes: [...todayInfo.types], todayCount: todayInfo.count, todayLogin: !!todayInfo.login,
      goalMet: !!todayInfo.goalMet, freezes, frozenTotal, freezeUsedThisMonth: usedMonth[monthKey(today)] || 0,
      milestones: ms.map(m => Object.assign({}, m, { reached: longest >= m.days })), reached, nextMilestone: nextMs,
      bonusPoints: bonus, breaks, status, series, days, tampered,
      batch: { total, start: pStart, day: batchDay, active: batchActive, growth: Math.min(1, batchActive / total) },
      events: all
    };
    if (!nowTs) memo.set(userId, { k: memoKey(userId), v: result });
    return result;
  }

  /* ------------------------- hook dashboard ------------------------- */
  /** Dipanggil saat dashboard dibuka & berkala: catat login, kirim pengingat. */
  function tick(user) {
    if (!user || user.role !== 'siswa' || settings().streakEnabled === false) return;
    try { DB.recordLearning(user.id, 'login', {}); } catch (e) { /* login hanya sekali sehari */ }
    const s = compute(user.id);
    const hour = DB.hourInTz(Date.now(), s.tz);
    const key = `lms_streak_reminded:${user.id}:${s.today}`;
    // Id tetap per hari agar pengingat tidak dobel bila siswa memakai beberapa perangkat.
    const remindId = 'nt_streak_' + user.id + '_' + s.today;
    if (s.atRisk && hour >= (Number(settings().streakReminderHour) || 18) && !localStorage.getItem(key)
      && !DB.getNotifications(user.id).some(n => n.id === remindId)) {
      localStorage.setItem(key, '1');
      DB.addNotification({ id: remindId, userId: user.id, icon: '🔥', title: `Streak ${s.current} hari hampir terputus!`,
        body: `Selesaikan satu aktivitas belajar sebelum pukul 24.00 ${s.tz}${s.freezes ? ` (kamu punya ${s.freezes} Streak Freeze)` : ''}.`, link: 'streak' });
      if (global.Dashboard && Dashboard.refreshNotifications) Dashboard.refreshNotifications();
    }
  }

  function bonusPoints(userId) {
    try { return compute(userId).bonusPoints; } catch (e) { return 0; }
  }

  /* =====================================================================
   * VISUAL: danau kampus & lima gedung rektorat (SVG ringan)
   * ===================================================================*/
  function timeOfDay(hour) {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 16) return 'day';
    if (hour >= 16 && hour < 19) return 'dusk';
    return 'night';
  }
  function weatherOf(ymd) {
    // Cuaca berganti per hari, deterministik (sama di semua perangkat).
    let h = 0; for (const ch of ymd) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ['clear', 'clear', 'cloudy', 'clear', 'breeze', 'drizzle', 'clear'][h % 7];
  }

  function buildingSvg(u, x, y, scale, idx, lit) {
    const c = u.color || '#e2e8f0';
    const win = lit ? '#fde68a' : '#94a3b8';
    const s = scale;
    let body = '';
    if (u.style === 'tower') {
      body = `<rect x="-38" y="-120" width="76" height="120" rx="3" fill="#f8fafc" stroke="#94a3b8"/>
        <rect x="-26" y="-170" width="52" height="52" fill="#f1f5f9" stroke="#94a3b8"/>
        <polygon points="-34,-168 0,-212 34,-168" fill="${c}" stroke="#a16207"/>
        <rect x="-3" y="-232" width="6" height="22" fill="#64748b"/>
        ${[0, 1, 2, 3].map(r => [-24, -8, 8].map(cx => `<rect x="${cx}" y="${-108 + r * 26}" width="12" height="14" fill="${win}"/>`).join('')).join('')}
        <rect x="-10" y="-22" width="20" height="22" fill="#475569"/>`;
    } else if (u.style === 'colonnade') {
      body = `<rect x="-78" y="-70" width="156" height="70" fill="#f8fafc" stroke="#94a3b8"/>
        <polygon points="-90,-70 0,-118 90,-70" fill="${c}" stroke="#64748b"/>
        <rect x="-82" y="-74" width="164" height="6" fill="#cbd5e1"/>
        ${[-64, -44, -24, -4, 16, 36, 56].map(cx => `<rect x="${cx}" y="-66" width="8" height="62" fill="#e2e8f0" stroke="#94a3b8"/>`).join('')}
        <rect x="-96" y="-4" width="192" height="6" fill="#cbd5e1"/>
        <rect x="-10" y="-40" width="20" height="36" fill="${win}" opacity=".7"/>`;
    } else if (u.style === 'gonjong') {
      body = `<rect x="-70" y="-62" width="140" height="62" fill="#f8fafc" stroke="#94a3b8"/>
        <path d="M-84,-60 Q-70,-80 -62,-112 Q-40,-86 0,-84 Q40,-86 62,-112 Q70,-80 84,-60 Z" fill="${c}" stroke="#1e3a8a"/>
        ${[-52, -30, -8, 14, 36].map(cx => `<rect x="${cx}" y="-48" width="14" height="20" fill="${win}"/>`).join('')}
        <rect x="-10" y="-22" width="20" height="22" fill="#475569"/>`;
    } else if (u.style === 'joglo') {
      body = `<rect x="-70" y="-56" width="140" height="56" fill="#f8fafc" stroke="#94a3b8"/>
        <polygon points="-92,-54 -40,-86 40,-86 92,-54" fill="${c}" stroke="#1e40af"/>
        <polygon points="-40,-86 -18,-112 18,-112 40,-86" fill="${c}" stroke="#1e40af"/>
        ${[-56, -34, 20, 42].map(cx => `<rect x="${cx}" y="-44" width="14" height="18" fill="${win}"/>`).join('')}
        <rect x="-12" y="-30" width="24" height="30" fill="#475569"/>`;
    } else {
      body = `<rect x="-62" y="-104" width="124" height="104" rx="4" fill="#f8fafc" stroke="#94a3b8"/>
        <rect x="-62" y="-112" width="124" height="10" fill="${c}"/>
        ${[0, 1, 2, 3].map(r => [-50, -30, -10, 10, 30].map(cx => `<rect x="${cx}" y="${-96 + r * 22}" width="14" height="12" fill="${win}"/>`).join('')).join('')}
        <path d="M-30,0 L-30,-18 Q0,-40 30,-18 L30,0" fill="none" stroke="${c}" stroke-width="6"/>`;
    }
    return `<g class="lk-bld" data-lk-hot="bld:${idx}" tabindex="0" role="button" aria-label="${esc(u.name)}"
      transform="translate(${x} ${y}) scale(${s})">
      <ellipse cx="0" cy="4" rx="96" ry="10" fill="rgba(15,23,42,.18)"/>
      ${body}
      <g class="lk-flag"><rect x="-1.5" y="-150" width="3" height="40" fill="#475569" transform="translate(70 40)"/>
        <polygon points="72,-108 96,-101 72,-94" fill="${c}"/></g>
      <text y="22" text-anchor="middle" class="lk-label">${esc(u.short)}</text>
    </g>`;
  }

  function tree(x, y, s, kind) {
    if (kind === 1) return `<g class="lk-tree" transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-18" width="6" height="18" fill="#7c5a3a"/><polygon points="0,-62 -18,-14 18,-14" fill="#15803d"/><polygon points="0,-74 -14,-34 14,-34" fill="#16a34a"/></g>`;
    return `<g class="lk-tree" transform="translate(${x} ${y}) scale(${s})"><rect x="-3" y="-16" width="6" height="16" fill="#7c5a3a"/><circle cx="0" cy="-30" r="18" fill="#22c55e"/><circle cx="-10" cy="-22" r="12" fill="#16a34a"/><circle cx="11" cy="-24" r="12" fill="#15803d"/></g>`;
  }

  function lakeSvg(s, opts) {
    const o = opts || {};
    const unl = new Set(s.milestones.filter(m => m.reached).map(m => m.unlock));
    const msBy = {}; s.milestones.forEach(m => { msBy[m.unlock] = m; });
    const tod = o.tod || timeOfDay(DB.hourInTz(Date.now(), s.tz));
    const weather = o.weather === false ? 'clear' : weatherOf(s.today);
    const unis = universities();
    const lit = tod === 'night' || tod === 'dusk';
    const sky = { dawn: ['#fbcfe8', '#fde68a'], day: ['#7dd3fc', '#e0f2fe'], dusk: ['#f97316', '#fde68a'], night: ['#0f172a', '#312e81'] }[tod];
    const growth = s.batch.growth;
    // Pohon bertambah mengikuti hari aktif dalam batch (umpan balik jangka panjang).
    const treeSpots = [[70, 420], [120, 450], [1120, 430], [1080, 460], [200, 470], [1000, 480], [300, 500], [900, 505], [40, 500], [1160, 505],
      [260, 430], [940, 430], [150, 520], [1050, 525], [380, 540], [820, 540], [90, 560], [1110, 560], [470, 560], [730, 560]];
    const treeCount = Math.min(treeSpots.length, 6 + Math.round(growth * 14) + Math.min(6, Math.floor(s.longest / 10)));
    const locked = (key) => !unl.has(key);
    const hot = (key, inner, label) => `<g class="lk-item ${locked(key) ? 'is-locked' : 'is-open'}" data-lk-hot="ms:${key}" tabindex="0" role="button" aria-label="${esc(label)}">${inner}</g>`;

    return `<svg class="lk-svg lk-${tod} lk-w-${weather} ${s.current === 0 ? 'is-dormant' : ''}" viewBox="0 0 1200 620" role="img"
        aria-label="Danau kampus Rubela dengan lima gedung rektorat. Streak ${s.current} hari.">
      <defs>
        <linearGradient id="lkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
        <linearGradient id="lkWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tod === 'night' ? '#1e3a8a' : '#38bdf8'}"/><stop offset="1" stop-color="${tod === 'night' ? '#0f172a' : '#0369a1'}"/></linearGradient>
        <radialGradient id="lkGlow"><stop offset="0" stop-color="#fef9c3" stop-opacity=".9"/><stop offset="1" stop-color="#fef9c3" stop-opacity="0"/></radialGradient>
        <clipPath id="lkLakeClip"><ellipse cx="600" cy="430" rx="360" ry="110"/></clipPath>
      </defs>
      <rect width="1200" height="620" fill="url(#lkSky)"/>
      ${tod === 'night' ? `<g class="lk-stars">${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 97) % 1200}" cy="${(i * 53) % 220}" r="${i % 3 ? 1.2 : 2}" fill="#fff"/>`).join('')}</g>
        <circle cx="1010" cy="90" r="34" fill="#f8fafc"/><circle cx="1024" cy="80" r="30" fill="${sky[0]}"/>`
        : `<circle class="lk-sun" cx="${tod === 'dusk' ? 980 : tod === 'dawn' ? 180 : 1000}" cy="${tod === 'day' ? 90 : 170}" r="42" fill="${tod === 'day' ? '#fde047' : '#fb923c'}"/>`}
      ${unl.has('aurora') ? `<g class="lk-aurora" data-lk-hot="ms:aurora"><path d="M0,120 C200,40 400,160 600,80 S1000,40 1200,110 L1200,0 L0,0 Z" fill="#34d399" opacity=".28"/><path d="M0,160 C250,80 450,190 650,110 S1000,90 1200,150 L1200,0 L0,0 Z" fill="#a78bfa" opacity=".2"/></g>` : ''}
      <g class="lk-clouds ${weather === 'cloudy' || weather === 'drizzle' ? 'is-many' : ''}">
        <g class="lk-cloud c1"><ellipse cx="200" cy="110" rx="60" ry="18" fill="#fff" opacity=".85"/><ellipse cx="240" cy="98" rx="40" ry="20" fill="#fff" opacity=".85"/></g>
        <g class="lk-cloud c2"><ellipse cx="760" cy="70" rx="70" ry="18" fill="#fff" opacity=".75"/><ellipse cx="800" cy="58" rx="40" ry="18" fill="#fff" opacity=".75"/></g>
        <g class="lk-cloud c3 lk-extra"><ellipse cx="480" cy="150" rx="80" ry="20" fill="#e2e8f0" opacity=".9"/><ellipse cx="530" cy="136" rx="50" ry="22" fill="#e2e8f0" opacity=".9"/></g>
      </g>
      <path d="M0,300 Q150,230 320,280 T640,270 T960,260 T1200,280 L1200,620 L0,620 Z" fill="${tod === 'night' ? '#14532d' : '#86efac'}"/>
      <path d="M0,330 Q200,290 400,320 T800,310 T1200,330 L1200,620 L0,620 Z" fill="${tod === 'night' ? '#166534' : '#4ade80'}"/>
      <!-- jalan setapak -->
      <path d="M0,560 C220,520 300,600 600,580 C900,560 980,520 1200,560" fill="none" stroke="#e7d3a8" stroke-width="18" stroke-linecap="round"/>
      <path d="M600,580 L600,545" stroke="#e7d3a8" stroke-width="14"/>
      <!-- gedung rektorat: 3 di belakang, 2 di sisi -->
      ${buildingSvg(unis[0], 600, 300, 0.95, 0, lit)}
      ${buildingSvg(unis[1], 330, 318, 0.82, 1, lit)}
      ${buildingSvg(unis[2], 870, 318, 0.82, 2, lit)}
      ${buildingSvg(unis[3], 140, 392, 0.78, 3, lit)}
      ${buildingSvg(unis[4], 1060, 392, 0.78, 4, lit)}
      <!-- danau -->
      <ellipse cx="600" cy="436" rx="372" ry="118" fill="#a3e635" opacity=".35"/>
      <ellipse cx="600" cy="430" rx="360" ry="110" fill="url(#lkWater)"/>
      <g clip-path="url(#lkLakeClip)">
        <g class="lk-reflect" opacity=".22"><rect x="560" y="330" width="80" height="120" fill="#f8fafc"/><rect x="300" y="340" width="60" height="70" fill="#f8fafc"/><rect x="840" y="340" width="60" height="70" fill="#f8fafc"/></g>
        <g class="lk-waves">
          ${[360, 390, 420, 450, 480, 510].map((y, i) => `<path class="lk-wave w${i % 3}" d="M200,${y} q30,-6 60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0 t60,0" fill="none" stroke="#e0f2fe" stroke-opacity=".45" stroke-width="2"/>`).join('')}
        </g>
        <ellipse class="lk-shimmer" cx="${tod === 'night' ? 1000 : 640}" cy="400" rx="120" ry="8" fill="#fff" opacity=".25"/>
      </g>
      <!-- pulau tengah -->
      <ellipse cx="600" cy="440" rx="${unl.has('island') ? 110 : 70}" ry="${unl.has('island') ? 34 : 22}" fill="#65a30d"/>
      ${hot('landmark', `<g transform="translate(600 438)"><rect x="-10" y="-90" width="20" height="90" fill="#f1f5f9" stroke="#64748b"/><polygon points="-14,-90 0,-118 14,-90" fill="#dc2626"/><circle cx="0" cy="-70" r="8" fill="#fff" stroke="#334155"/><path d="M0,-70 L0,-75 M0,-70 L4,-70" stroke="#334155" stroke-width="1.5"/></g>`, 'Menara Ilmu')}
      ${hot('island', `<g transform="translate(680 440)"><rect x="-26" y="-34" width="52" height="34" fill="#fef3c7" stroke="#92400e"/><polygon points="-30,-34 0,-56 30,-34" fill="#b45309"/><circle cx="-60" cy="-36" r="14" fill="#e0e7ff" stroke="#4338ca"/><rect x="-62" y="-24" width="4" height="22" fill="#4338ca"/></g>`, 'Pulau Pustaka')}
      ${hot('bridge', `<path d="M410,470 Q480,430 540,450" fill="none" stroke="#a16207" stroke-width="10" stroke-linecap="round"/><path d="M410,462 Q480,422 540,442" fill="none" stroke="#fbbf24" stroke-width="2"/>
        <g class="lk-fountain" transform="translate(800 470)"><ellipse rx="22" ry="6" fill="#bae6fd"/><path class="lk-jet" d="M0,0 C-6,-26 6,-26 0,-44 M0,0 C-14,-18 -8,-26 -18,-30 M0,0 C14,-18 8,-26 18,-30" stroke="#e0f2fe" stroke-width="3" fill="none"/></g>`, 'Jembatan Cahaya & air mancur')}
      ${hot('wildlife', `<g class="lk-swan s1" transform="translate(470 420)"><ellipse rx="14" ry="7" fill="#fff"/><path d="M8,-2 q8,-14 2,-20" stroke="#fff" stroke-width="4" fill="none"/><circle cx="10" cy="-21" r="3" fill="#fff"/><path d="M12,-21 l5,1" stroke="#f97316" stroke-width="2"/></g>
        <g class="lk-swan s2" transform="translate(760 410)"><ellipse rx="12" ry="6" fill="#fff"/><path d="M-7,-2 q-8,-12 -2,-18" stroke="#fff" stroke-width="4" fill="none"/><circle cx="-9" cy="-19" r="3" fill="#fff"/></g>
        <g class="lk-boat" transform="translate(540 470)"><path d="M-20,0 L20,0 L12,8 L-12,8 Z" fill="#fef3c7" stroke="#92400e"/><path d="M0,0 L0,-24 L14,-6 Z" fill="#f43f5e"/></g>
        <g class="lk-birds"><path d="M300,170 q8,-8 16,0 q8,-8 16,0" stroke="#334155" stroke-width="2" fill="none"/><path d="M360,150 q6,-6 12,0 q6,-6 12,0" stroke="#334155" stroke-width="2" fill="none"/></g>`, 'Danau Hidup: angsa, perahu, burung')}
      ${hot('garden', `<g class="lk-garden">${[[250, 545], [330, 560], [870, 560], [950, 545], [520, 600], [680, 600], [420, 590], [780, 590]].map(([x, y], i) => `<g transform="translate(${x} ${y})"><ellipse rx="26" ry="9" fill="#166534" opacity=".55"/>${[-14, -4, 6, 14].map((dx, k) => `<circle cx="${dx}" cy="${-4 - (k % 2) * 4}" r="4.5" fill="${['#f43f5e', '#facc15', '#a855f7', '#fb923c'][(i + k) % 4]}"/>`).join('')}</g>`).join('')}</g>`, 'Taman Bersemi')}
      ${hot('lamps', `${[[230, 532], [440, 562], [760, 562], [970, 532]].map(([x, y]) => `<g transform="translate(${x} ${y})"><rect x="-2" y="-40" width="4" height="40" fill="#334155"/><circle cy="-44" r="6" fill="${lit ? '#fde047' : '#fef9c3'}"/>${lit ? '<circle cy="-44" r="22" fill="url(#lkGlow)"/>' : ''}</g>`).join('')}
        <g transform="translate(560 552)"><rect x="-22" y="-8" width="44" height="5" fill="#92400e"/><rect x="-20" y="-3" width="4" height="10" fill="#78350f"/><rect x="16" y="-3" width="4" height="10" fill="#78350f"/></g>`, 'Percikan Pertama: lampu & bangku')}
      ${hot('gate', `<g transform="translate(600 610)"><rect x="-70" y="-70" width="12" height="70" fill="#7c3aed"/><rect x="58" y="-70" width="12" height="70" fill="#7c3aed"/><path d="M-76,-70 Q0,-112 76,-70" fill="none" stroke="#7c3aed" stroke-width="10"/><text y="-80" text-anchor="middle" class="lk-gate-text">RUBELA</text>${[-46, -16, 16, 46].map(x => `<circle cx="${x}" cy="-88" r="5" fill="#fde047"/>`).join('')}</g>`, 'Gerbang Kelulusan')}
      ${unl.has('aurora') ? `<g transform="translate(600 300)"><rect x="-1.5" y="-250" width="3" height="40" fill="#78350f"/><polygon points="2,-250 34,-240 2,-230" fill="#facc15"/></g>` : ''}
      <g class="lk-trees">${treeSpots.slice(0, treeCount).map(([x, y], i) => tree(x, y, 0.8 + (i % 3) * 0.15, i % 2)).join('')}</g>
      ${weather === 'drizzle' ? `<g class="lk-rain">${Array.from({ length: 36 }, (_, i) => `<line x1="${(i * 37) % 1200}" y1="${(i * 61) % 300}" x2="${(i * 37) % 1200 - 6}" y2="${(i * 61) % 300 + 16}"/>`).join('')}</g>` : ''}
      ${tod === 'night' ? '<rect width="1200" height="620" fill="#0f172a" opacity=".18" pointer-events="none"/>' : ''}
      ${tod === 'dusk' ? '<rect width="1200" height="620" fill="#f97316" opacity=".08" pointer-events="none"/>' : ''}
    </svg>`;
  }

  /* =====================================================================
   * Komponen tampilan
   * ===================================================================*/
  function flameHtml(n, size) {
    return `<span class="sk-flame ${n > 0 ? 'is-on' : ''}" style="--sk-s:${size || 56}px" aria-hidden="true">🔥</span>`;
  }

  function statCardsHtml(s) {
    const lv = s.level;
    return `<div class="sk-stats">
      <div class="sk-stat is-hero">${flameHtml(s.current, 44)}<div><span>Current Streak</span><strong>${s.current} hari</strong>
        <em>${s.activeToday ? 'Hari ini sudah aman ✅' : (s.current ? 'Belum belajar hari ini' : 'Mulai hari ini!')}</em></div></div>
      <div class="sk-stat"><span>Longest Streak</span><strong>${s.longest}</strong><em>hari</em></div>
      <div class="sk-stat"><span>Total Hari Aktif</span><strong>${s.totalActiveDays}</strong><em>hari belajar</em></div>
      <div class="sk-stat"><span>Total Aktivitas</span><strong>${s.totalLearning}</strong><em>aktivitas sah</em></div>
      <div class="sk-stat"><span>Weekly Streak</span><strong>${s.weekly}</strong><em>minggu • ${s.thisWeekDays}/${s.weeklyTarget} hari</em></div>
      <div class="sk-stat"><span>Monthly Streak</span><strong>${s.monthly}</strong><em>bulan • ${s.thisMonthDays}/${s.monthlyTarget} hari</em></div>
      <div class="sk-stat"><span>Streak Freeze</span><strong>${s.freezes} ❄️</strong><em>dipakai ${s.freezeUsedThisMonth}/${settings().streakFreezeMonthlyLimit} bulan ini</em></div>
      <div class="sk-stat"><span>Level ${lv.level} • ${esc(lv.title)}</span><strong>${lv.xp} XP</strong>
        <div class="sk-lvbar" title="${lv.progress}%"><i style="width:${lv.progress}%"></i></div><em>${lv.next - lv.xp} XP ke level ${lv.level + 1}</em></div>
    </div>`;
  }

  function goalHtml(s, opts) {
    const o = opts || {};
    const done = new Set(s.todayTypes);
    const pct = Math.min(100, Math.round(done.size / s.goal * 100));
    const order = ['latihan', 'miniquiz', 'materi', 'reading', 'tryout', 'tugas', 'kelas', 'tantangan', 'games', 'target', 'login'];
    const go = { latihan: 'arena', miniquiz: 'arena', reading: 'arena', tantangan: 'arena', games: 'arena', materi: 'my-courses', tryout: 'cbt', tugas: 'assignments', kelas: 'jadwal-siswa' };
    return `<div class="card sk-goal">
      <div class="card-header">${UI.secHead('🎯', 'Daily Learning Goal', `${done.size}/${s.goal} jenis aktivitas berbeda hari ini • hari berganti pukul 00.00 ${s.tz}`)}
        ${s.goalMet ? '<span class="badge badge-success">Target tercapai 🎉</span>' : ''}</div>
      <div class="sk-goalbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="sk-acts">${order.map(k => {
        const d = T()[k];
        const isDone = k === 'login' ? s.todayLogin : (k === 'target' ? s.goalMet : done.has(k));
        return `<div class="sk-act ${isDone ? 'is-done' : ''} ${d.learning ? '' : 'is-login'}">
          <span class="sk-act-ic" aria-hidden="true">${d.icon}</span>
          <div class="sk-act-body"><strong>${esc(d.label)}</strong><span>${esc(d.criteria)}</span>
            <em>${d.learning ? `+${d.xp} XP${d.cap > 1 ? ` • maks ${d.cap}×/hari` : ''}` : 'tidak menyalakan streak'}</em></div>
          ${isDone ? '<span class="sk-check" aria-label="selesai">✓</span>'
            : (!o.readOnly && go[k] && global.Dashboard && Dashboard.hasSection(go[k]) ? `<button type="button" class="btn btn-sm btn-secondary" data-sk-go="${go[k]}">Mulai</button>` : '')}
        </div>`;
      }).join('')}</div>
    </div>`;
  }

  function calendarHtml(s) {
    const weeks = 26;
    const end = s.today;
    const startW = addDays(weekKey(end), -7 * (weeks - 1));
    const cells = [];
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const day = addDays(startW, w * 7 + d);
        if (day > end) { cells.push('<i class="sk-cell is-future"></i>'); continue; }
        const info = s.days.get(day);
        const n = info ? info.count : 0;
        const st = s.status[day] || (n ? 'active' : 'none');
        const lvl = n >= 6 ? 4 : n >= 4 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
        cells.push(`<i class="sk-cell st-${st} lv-${lvl} ${day === end ? 'is-today' : ''}" title="${UI.fmtYMD(day)}: ${n} aktivitas${st === 'frozen' ? ' • Streak Freeze dipakai' : st === 'missed' ? ' • terlewat' : st === 'login' ? ' • hanya login' : ''}"></i>`);
      }
    }
    return `<div class="sk-cal-wrap"><div class="sk-cal" style="--weeks:${weeks}" role="img" aria-label="Kalender aktivitas 26 minggu terakhir">${cells.join('')}</div></div>
      <div class="sk-legend"><span><i class="sk-cell lv-0"></i>tidak ada</span><span><i class="sk-cell lv-1"></i><i class="sk-cell lv-3"></i>aktivitas</span>
        <span><i class="sk-cell st-frozen"></i>freeze</span><span><i class="sk-cell st-login"></i>hanya login</span><span><i class="sk-cell st-missed"></i>streak putus</span></div>`;
  }

  function chartHtml(s) {
    const pts = s.series.slice(-60);
    if (pts.length < 2) return '<div class="muted small">Grafik muncul setelah ada aktivitas minimal dua hari.</div>';
    const max = Math.max(3, ...pts.map(p => p.streak));
    const W = 600, H = 160;
    const xy = pts.map((p, i) => [Math.round(i / (pts.length - 1) * W), Math.round(H - p.streak / max * (H - 16) - 8)]);
    const line = xy.map(p => p.join(',')).join(' ');
    return `<svg class="sk-chart" viewBox="0 0 ${W} ${H + 22}" role="img" aria-label="Grafik perkembangan streak 60 hari terakhir">
      <line x1="0" y1="${H}" x2="${W}" y2="${H}" class="sk-axis"/>
      <polygon points="0,${H} ${line} ${W},${H}" class="sk-area"/>
      <polyline points="${line}" class="sk-line"/>
      <text x="0" y="${H + 16}" class="sk-tick">${UI.fmtYMD(pts[0].day)}</text>
      <text x="${W}" y="${H + 16}" text-anchor="end" class="sk-tick">${UI.fmtYMD(pts[pts.length - 1].day)}</text>
      <text x="4" y="14" class="sk-tick">puncak ${max}</text>
    </svg>`;
  }

  function achievementsHtml(s) {
    const lv = s.level;
    return `<div class="sk-ach">${s.milestones.map(m => `
      <div class="sk-badge ${m.reached ? 'is-on' : ''}" title="${esc(m.desc)}">
        <span class="sk-badge-ic">${m.reached ? m.icon : '🔒'}</span>
        <strong>${esc(m.label)}</strong>
        <span>${m.days} hari berturut-turut</span>
        <em>${m.reached ? `+${m.points} poin • terbuka` : `${Math.max(0, m.days - s.current)} hari lagi`}</em>
      </div>`).join('')}
      <div class="sk-badge is-on is-level"><span class="sk-badge-ic">🏅</span><strong>Level ${lv.level}</strong><span>${esc(lv.title)}</span><em>${lv.xp} XP</em></div>
    </div>`;
  }

  /* ------------------------- leaderboard ------------------------- */
  function leaderboardRows(viewer) {
    const st = settings();
    const metric = st.streakLeaderboardMetric || 'current';
    let pool = DB.getUsers().filter(u => u.role === 'siswa' && !['Dikeluarkan', 'Alumni'].includes(u.status || 'Aktif'));
    if (st.streakLeaderboardScope === 'kelas' && viewer && viewer.role === 'siswa') pool = pool.filter(u => u.kelas && u.kelas === viewer.kelas);
    const val = (s) => metric === 'longest' ? s.longest : metric === 'xp' ? s.xp : metric === 'activeDays' ? s.totalActiveDays : s.current;
    const rows = pool.map(u => ({ u, s: compute(u.id) })).map(r => Object.assign(r, { v: val(r.s) }))
      .sort((a, b) => b.v - a.v || b.s.longest - a.s.longest || a.u.name.localeCompare(b.u.name));
    const privacy = st.streakLeaderboardPrivacy || 'optin';
    return { metric, rows: rows.map((r, i) => Object.assign(r, { rank: i + 1,
      shown: privacy === 'all' || r.u.streakShare || (viewer && (viewer.id === r.u.id || viewer.role === 'admin')) })) };
  }
  const METRIC_LABEL = { current: 'Current streak', longest: 'Longest streak', xp: 'Total XP', activeDays: 'Hari aktif' };

  function leaderboardHtml(viewer) {
    const st = settings();
    if (st.streakLeaderboardEnabled === false) return '<div class="muted small">Leaderboard streak dinonaktifkan admin.</div>';
    const { metric, rows } = leaderboardRows(viewer);
    const privacy = st.streakLeaderboardPrivacy || 'optin';
    const list = (privacy === 'optin' && viewer.role !== 'admin') ? rows.filter(r => r.shown) : rows;
    const top = list.slice(0, Math.max(3, Number(st.streakLeaderboardSize) || 10));
    const me = rows.find(r => r.u.id === viewer.id);
    return `<div class="muted small mb-1">Peringkat berdasarkan <strong>${METRIC_LABEL[metric]}</strong>${st.streakLeaderboardScope === 'kelas' ? ' • satu kelas utama' : ''} •
      ${privacy === 'optin' ? 'hanya mentee yang mengizinkan namanya tampil' : 'nama mentee yang tidak mengizinkan disamarkan'}.</div>
      ${top.length ? `<ol class="sk-lb">${top.map(r => `<li class="${r.u.id === viewer.id ? 'is-me' : ''}">
        <span class="sk-lb-rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : '#' + r.rank}</span>
        ${r.shown ? Birthday.avatarHtml(r.u, 32) : '<span class="bd-avatar" style="--bd-s:32px"><span>?</span></span>'}
        <span class="sk-lb-name"><strong>${r.shown ? esc(r.u.name) : 'Mentee Rubela'}</strong><span class="muted small">${r.shown ? esc(r.u.kelas || '-') : 'disamarkan'}</span></span>
        <span class="sk-lb-val">${r.v}${metric === 'xp' ? ' XP' : ' hari'}</span></li>`).join('')}</ol>`
        : '<div class="empty"><div class="empty-icon">🏁</div>Belum ada mentee yang mengizinkan namanya tampil.</div>'}
      ${me && viewer.role === 'siswa' && !top.includes(me) ? `<div class="sk-lb-me">Posisimu: <strong>#${me.rank}</strong> • ${me.v}${metric === 'xp' ? ' XP' : ' hari'}</div>` : ''}`;
  }

  function friendsHtml(user) {
    if (!user.streakShare) return `<div class="muted small">Aktifkan <strong>"Izinkan teman membandingkan"</strong> di pengaturan privasi di bawah untuk melihat perbandingan dengan teman sekelas yang juga mengizinkan.</div>`;
    const mates = DB.getUsers().filter(u => u.role === 'siswa' && u.id !== user.id && u.streakShare && u.kelas && u.kelas === user.kelas);
    if (!mates.length) return '<div class="muted small">Belum ada teman sekelas yang mengizinkan perbandingan.</div>';
    const me = compute(user.id);
    const max = Math.max(1, me.longest, ...mates.map(m => compute(m.id).longest));
    const row = (u, s, mine) => `<div class="sk-cmp ${mine ? 'is-me' : ''}"><span class="sk-cmp-name">${esc(mine ? 'Kamu' : u.name.split(' ')[0])}</span>
      <div class="sk-cmp-bars"><i class="cur" style="width:${s.current / max * 100}%" title="Current ${s.current}"></i><i class="lng" style="width:${s.longest / max * 100}%" title="Longest ${s.longest}"></i></div>
      <span class="sk-cmp-val">${s.current} / ${s.longest}</span></div>`;
    return `<div class="muted small mb-1">Batang atas = current streak, batang bawah = longest streak.</div>
      ${row(user, me, true)}${mates.map(m => row(m, compute(m.id))).join('')}`;
  }

  /* ------------------------- halaman utama ------------------------- */
  const viewPref = {};   // pilihan waktu/cuaca per sesi

  /**
   * opts.readOnly → tampilan orang tua/tutor/admin untuk seorang mentee.
   */
  function renderPage(container, student, opts) {
    const o = opts || {};
    const viewer = o.viewer || student;
    if (settings().streakEnabled === false && viewer.role !== 'admin') {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🔥</div>Fitur streak sedang dinonaktifkan admin.</div>';
      return;
    }
    const s = compute(student.id);
    const pref = viewPref[student.id] || { tod: '', weather: true };
    viewPref[student.id] = pref;
    const next = s.nextMilestone;
    const unis = universities();
    container.innerHTML = `
      ${o.readOnly ? `<div class="alert alert-info">Menampilkan streak <strong>${esc(student.name)}</strong> (hanya baca).</div>` : ''}
      ${s.atRisk && !o.readOnly ? `<div class="alert alert-warning sk-risk" role="alert">🔥 Streak <strong>${s.current} hari</strong> akan terputus pukul 00.00 ${s.tz} bila belum ada aktivitas belajar hari ini.
        ${s.freezes ? `Kamu punya <strong>${s.freezes} Streak Freeze</strong> yang otomatis melindungi bila terlewat.` : ''}</div>` : ''}
      ${s.tampered ? `<div class="alert alert-error">⚠️ ${s.tampered} catatan aktivitas tidak lolos verifikasi dan tidak dihitung.</div>` : ''}

      <section class="card lk-card">
        <div class="lk-head">
          <div>
            <div class="sk-eyebrow">Kampus Danau Rubela</div>
            <h2 class="lk-title">${flameHtml(s.current, 30)} ${s.current} hari berturut-turut</h2>
            <p class="muted small">${next ? `${next.days - s.current} hari lagi menuju <strong>${esc(next.label)}</strong> ${next.icon}` : 'Semua milestone telah terbuka. Luar biasa!'}
              • Batch hari ke-${s.batch.day}/${s.batch.total} • ${s.batch.active} hari aktif di batch ini</p>
          </div>
          <div class="lk-controls">
            <select class="input" data-lk-tod aria-label="Suasana waktu">
              ${[['', 'Waktu otomatis'], ['dawn', 'Fajar'], ['day', 'Siang'], ['dusk', 'Senja'], ['night', 'Malam']].map(([v, l]) => `<option value="${v}" ${pref.tod === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
            <label class="check-row"><input type="checkbox" data-lk-weather ${pref.weather ? 'checked' : ''}/> Efek cuaca</label>
          </div>
        </div>
        <div class="lk-stage" id="lkStage">${lakeSvg(s, { tod: pref.tod || null, weather: pref.weather })}
          <div class="lk-pop hidden" id="lkPop" role="dialog" aria-live="polite"></div>
        </div>
        <div class="lk-progress" aria-label="Pertumbuhan lingkungan batch">
          <div class="lk-progress-bar"><i style="width:${Math.round(s.batch.growth * 100)}%"></i>
            ${s.milestones.filter(m => m.days <= s.batch.total).map(m => `<span class="lk-tick ${m.reached ? 'is-on' : ''}" style="left:${Math.min(100, m.days / s.batch.total * 100)}%" title="${esc(m.label)} • ${m.days} hari">${m.icon}</span>`).join('')}
          </div>
          <div class="muted small">Pepohonan bertambah sesuai hari aktif dalam batch (${s.batch.total} hari). Bangunan & area terbuka permanen sesuai streak terpanjangmu; bila streak terputus, taman tampak meredup sampai kamu belajar lagi.</div>
        </div>
        <div class="lk-explore" aria-label="Jelajahi elemen kampus">
          ${unis.map((u, i) => `<button type="button" class="chip" data-lk-hot="bld:${i}">🏛️ ${esc(u.short)}</button>`).join('')}
          ${s.milestones.map(m => `<button type="button" class="chip ${m.reached ? '' : 'is-locked'}" data-lk-hot="ms:${m.unlock}">${m.reached ? m.icon : '🔒'} ${esc(m.label)}</button>`).join('')}
        </div>
      </section>

      ${statCardsHtml(s)}
      ${goalHtml(s, { readOnly: o.readOnly })}

      <div class="sk-grid">
        <div class="card"><div class="card-header">${UI.secHead('🗓️', 'Kalender Aktivitas', '26 minggu terakhir')}</div>${calendarHtml(s)}</div>
        <div class="card"><div class="card-header">${UI.secHead('📈', 'Perkembangan Streak', '60 hari terakhir')}</div>${chartHtml(s)}
          ${s.breaks.length ? `<div class="muted small mt-1">Terakhir terputus: ${UI.fmtYMD(s.breaks[s.breaks.length - 1].day)} (streak ${s.breaks[s.breaks.length - 1].lost} hari).</div>` : ''}</div>
      </div>

      <div class="card"><div class="card-header">${UI.secHead('🏅', 'Achievement Collection', `${s.reached.length}/${s.milestones.length} milestone • bonus ${s.bonusPoints} poin`)}</div>${achievementsHtml(s)}</div>

      <div class="sk-grid">
        <div class="card"><div class="card-header">${UI.secHead('🏆', 'Leaderboard Streak', 'diatur admin')}</div>${leaderboardHtml(viewer)}</div>
        ${!o.readOnly ? `<div class="card"><div class="card-header">${UI.secHead('🤝', 'Bandingkan dengan Teman', 'hanya teman yang mengizinkan')}</div>${friendsHtml(student)}</div>` : ''}
      </div>

      <div class="card"><div class="card-header">${UI.secHead('🧾', 'Riwayat Aktivitas', 'dapat diperiksa: status validasi setiap catatan')}</div><div id="skHistory"></div></div>

      ${!o.readOnly ? `<div class="card"><div class="card-header">${UI.secHead('🔒', 'Privasi & Zona Waktu', 'atur siapa yang dapat melihat pencapaianmu')}</div>
        <form id="skPrefForm" class="form">
          <label class="check-row"><input type="checkbox" name="share" ${student.streakShare ? 'checked' : ''}/> Izinkan namaku tampil di leaderboard & dibandingkan teman sekelas</label>
          ${settings().streakTimezoneMode === 'user' ? `<div class="form-group"><label>Zona waktu penghitungan hari</label>
            <select name="tz" class="input">${Object.keys(DB.TZ_OFFSETS).map(z => `<option value="${z}" ${(student.timezone || 'WIB') === z ? 'selected' : ''}>${z} (UTC+${DB.TZ_OFFSETS[z]})</option>`).join('')}</select>
            <div class="muted small">Perubahan zona berlaku untuk aktivitas berikutnya.</div></div>`
            : `<p class="muted small">Pergantian hari memakai zona waktu LMS: <strong>${esc(s.tz)}</strong> (ditetapkan admin).</p>`}
          <button type="submit" class="btn btn-primary btn-sm">Simpan</button>
        </form></div>` : ''}`;

    // Riwayat dengan pencarian & filter
    const hist = s.events.slice().reverse();
    DataSearch.mount({
      container: container.querySelector('#skHistory'),
      items: hist,
      stateKey: 'streak-hist-' + student.id,
      placeholder: 'Cari jenis aktivitas atau tanggal…',
      fields: e => [(T()[e.type] || {}).label, e.day, UI.fmtYMD(e.day), e.derived ? 'otomatis' : 'tercatat', e.valid ? 'sah' : 'tidak sah'],
      filters: [{ key: 'type', label: 'Semua jenis', get: e => e.type, options: Object.keys(T()).map(k => ({ value: k, label: T()[k].label })) },
        { key: 'valid', label: 'Semua status', get: e => e.valid ? 'ok' : 'bad', options: [{ value: 'ok', label: 'Sah' }, { value: 'bad', label: 'Tidak sah' }] }],
      dateRange: e => e.day,
      sorts: [{ key: 'new', label: 'Terbaru', cmp: (a, b) => b.at - a.at }, { key: 'old', label: 'Terlama', cmp: (a, b) => a.at - b.at }],
      pageSize: 15,
      empty: 'Belum ada aktivitas.',
      render: (rows) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Waktu</th><th>Aktivitas</th><th>Detail</th><th>XP</th><th>Status</th></tr></thead>
        <tbody>${rows.map(e => { const d = T()[e.type] || { label: e.type, icon: '•' }; const m = e.meta || {};
          return `<tr><td>${UI.fmtYMD(e.day)}${e.derived ? '' : `<div class="muted small">${UI.fmtDateTime(e.at)}</div>`}</td>
            <td>${d.icon} ${esc(d.label)}</td>
            <td class="muted small">${m.total ? `${m.correct || 0}/${m.total} benar` : ''}${m.durationSec ? ` • ${Math.round(m.durationSec / 60 * 10) / 10} mnt` : ''}${m.score != null && !m.total ? `skor ${m.score}` : ''}${e.derived ? 'dari data resmi' : ''}</td>
            <td>${e.xp ? '+' + e.xp : (e.capped ? '<span class="muted small">batas harian</span>' : '0')}</td>
            <td>${e.valid ? '<span class="badge badge-success">Sah</span>' : '<span class="badge badge-danger">Tidak sah</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
    });

    bindLake(container, s, student, () => renderPage(container, student, o));
    container.querySelectorAll('[data-sk-go]').forEach(b => b.addEventListener('click', () => Dashboard.navigate(b.dataset.skGo)));
    const pf = container.querySelector('#skPrefForm');
    if (pf) pf.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(pf);
      const patch = { streakShare: !!fd.get('share') };
      if (fd.get('tz') && DB.TZ_OFFSETS[fd.get('tz')] != null) patch.timezone = fd.get('tz');
      DB.updateUser(student.id, patch);
      Object.assign(student, patch);
      memo.clear();
      UI.toast('Preferensi streak disimpan.');
      renderPage(container, DB.getUser(student.id), o);
    });
  }

  function bindLake(container, s, student, rerender) {
    const pop = container.querySelector('#lkPop');
    const stage = container.querySelector('#lkStage');
    const unis = universities();
    const showPop = (key, anchor) => {
      let html = '';
      if (key.startsWith('bld:')) {
        const u = unis[Number(key.slice(4))];
        html = `<strong>🏛️ ${esc(u.name)}</strong><span>${esc(STYLES[u.style] || '')} — terinspirasi karakter arsitektur kampus, bukan replika resmi.</span>
          <span>${u.rank ? `Peringkat dunia #${esc(u.rank)} — ` : ''}${esc(u.rankingSource || 'Sumber peringkat belum diisi')}</span>
          ${u.rankingUrl && /^https:\/\//.test(u.rankingUrl) ? `<a href="${esc(u.rankingUrl)}" target="_blank" rel="noopener noreferrer">Periksa sumber peringkat ↗</a>` : ''}
          <span class="muted">Peringkat dapat berubah tiap tahun dan diatur admin.</span>`;
      } else {
        const m = s.milestones.find(x => x.unlock === key.slice(3));
        if (!m) return;
        html = m.reached
          ? `<strong>${m.icon} ${esc(m.label)}</strong><span>${esc(m.desc)}</span><span class="muted">Terbuka sejak mencapai streak ${m.days} hari • +${m.points} poin</span>`
          : `<strong>🔒 ${esc(m.label)}</strong><span>${esc(m.desc)}</span><span class="muted">Terbuka pada streak ${m.days} hari berturut-turut (${Math.max(0, m.days - s.current)} hari lagi).</span>`;
      }
      pop.innerHTML = html + '<button type="button" class="btn btn-sm btn-secondary" data-lk-close>Tutup</button>';
      pop.classList.remove('hidden');
      const r = stage.getBoundingClientRect();
      const a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
      const left = a && stage.contains(anchor) ? Math.min(r.width - 260, Math.max(8, a.left - r.left + a.width / 2 - 130)) : 12;
      const top = a && stage.contains(anchor) ? Math.max(8, Math.min(r.height - 150, a.top - r.top - 10)) : 12;
      pop.style.left = left + 'px'; pop.style.top = top + 'px';
      pop.querySelector('[data-lk-close]').addEventListener('click', () => pop.classList.add('hidden'));
      if (key === 'ms:wildlife' && m_reached(s, 'wildlife')) {
        stage.querySelectorAll('.lk-swan').forEach(sw => { sw.classList.remove('is-swim'); void sw.getBoundingClientRect(); sw.classList.add('is-swim'); });
      }
    };
    container.querySelectorAll('[data-lk-hot]').forEach(el => {
      const open = (ev) => { ev.stopPropagation(); showPop(el.getAttribute('data-lk-hot'), el); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(ev); } });
    });
    const tod = container.querySelector('[data-lk-tod]');
    if (tod) tod.addEventListener('change', () => { viewPref[student.id].tod = tod.value; rerender(); });
    const wx = container.querySelector('[data-lk-weather]');
    if (wx) wx.addEventListener('change', () => { viewPref[student.id].weather = wx.checked; rerender(); });
    // Animasi berhenti saat danau tidak terlihat (hemat baterai/CPU).
    if ('IntersectionObserver' in global && stage) {
      const io = new IntersectionObserver((ents) => ents.forEach(en => stage.classList.toggle('is-paused', !en.isIntersecting)));
      io.observe(stage);
    }
  }
  const m_reached = (s, key) => s.milestones.some(m => m.unlock === key && m.reached);

  /* ------------------------- widget ringkas (overview) ------------------------- */
  function widgetHtml(student, opts) {
    if (settings().streakEnabled === false) return '';
    const s = compute(student.id);
    const o = opts || {};
    return `<div class="card sk-widget ${s.atRisk ? 'is-risk' : ''}">
      <div class="sk-widget-main">${flameHtml(s.current, 40)}
        <div><div class="sk-eyebrow">${o.child ? 'Streak belajar ' + esc(student.name.split(' ')[0]) : 'Streak belajarmu'}</div>
          <strong class="sk-widget-num">${s.current} hari</strong>
          <span class="muted small">Terpanjang ${s.longest} • ${s.todayTypes.length}/${s.goal} target hari ini • Level ${s.level.level}</span></div></div>
      <div class="sk-goalbar"><i style="width:${Math.min(100, Math.round(s.todayTypes.length / s.goal * 100))}%"></i></div>
      ${s.atRisk ? `<div class="small" style="color:var(--warning);margin-top:6px;">🔥 Belum ada aktivitas belajar hari ini — streak dapat terputus pukul 00.00 ${s.tz}.</div>` : ''}
      <button type="button" class="btn btn-sm btn-primary" data-sk-open="${o.link || 'streak'}">${o.child ? 'Lihat Streak Anak' : 'Buka Kampus Danau'}</button>
    </div>`;
  }
  function bindWidget(root) {
    root.querySelectorAll('[data-sk-open]').forEach(b => b.addEventListener('click', () => Dashboard.navigate(b.dataset.skOpen)));
  }

  /* =====================================================================
   * Roster (admin & tutor)
   * ===================================================================*/
  function renderRoster(container, viewer, people, opts) {
    const o = opts || {};
    const rows = people.map(u => ({ u, s: compute(u.id) }));
    container.innerHTML = `<div id="skRoster"></div>`;
    DataSearch.mount({
      container: container.querySelector('#skRoster'),
      items: rows,
      stateKey: 'streak-roster-' + viewer.id,
      placeholder: 'Cari nama, username, atau kelas…',
      fields: r => [r.u.name, r.u.username, r.u.kelas],
      filters: [{ key: 'risk', label: 'Semua status', get: r => r.s.activeToday ? 'safe' : (r.s.current ? 'risk' : 'off'),
        options: [{ value: 'safe', label: 'Aktif hari ini' }, { value: 'risk', label: 'Berisiko putus' }, { value: 'off', label: 'Belum ada streak' }] },
        { key: 'kelas', label: 'Semua kelas', get: r => r.u.kelas || '', options: [...new Set(people.map(u => u.kelas).filter(Boolean))].map(k => ({ value: k, label: k })) }],
      sorts: [
        { key: 'cur', label: 'Current tertinggi', cmp: (a, b) => b.s.current - a.s.current },
        { key: 'long', label: 'Longest tertinggi', cmp: (a, b) => b.s.longest - a.s.longest },
        { key: 'xp', label: 'XP tertinggi', cmp: (a, b) => b.s.xp - a.s.xp },
        { key: 'name', label: 'Nama A–Z', cmp: (a, b) => a.u.name.localeCompare(b.u.name) }
      ],
      pageSize: 15,
      empty: 'Belum ada mentee.',
      render: (list, ctx) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>Mentee</th><th>Current</th><th>Longest</th><th>Hari aktif</th><th>XP / Level</th><th>Freeze</th><th>Hari ini</th><th>Aksi</th></tr></thead>
        <tbody>${list.map(r => `<tr>
          <td><div class="user-cell">${Birthday.avatarHtml(r.u, 30)}<div><strong>${ctx.highlight(r.u.name)}</strong><div class="muted small">${ctx.highlight(r.u.kelas || '-')}</div></div></div></td>
          <td>🔥 ${r.s.current}</td><td>${r.s.longest}</td><td>${r.s.totalActiveDays}</td>
          <td>${r.s.xp} XP<div class="muted small">Lv ${r.s.level.level}</div></td>
          <td>${r.s.freezes} ❄️</td>
          <td>${r.s.activeToday ? '<span class="badge badge-success">Aman</span>' : (r.s.current ? '<span class="badge badge-warning">Berisiko</span>' : '<span class="badge badge-gray">-</span>')}
            ${r.s.tampered ? `<span class="badge badge-danger" title="catatan tidak sah">${r.s.tampered} ⚠</span>` : ''}</td>
          <td class="actions"><button type="button" class="btn btn-sm btn-primary" data-sk-detail="${r.u.id}">Detail</button>
            ${o.canGrant ? `<button type="button" class="btn btn-sm btn-secondary" data-sk-grant="${r.u.id}">+ Freeze</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`,
      onPaint: (box) => {
        box.querySelectorAll('[data-sk-detail]').forEach(b => b.addEventListener('click', () => {
          UI.modal.open('Streak Mentee', '<div id="skModal" class="sk-modal"></div>');
          renderPage(document.getElementById('skModal'), DB.getUser(b.dataset.skDetail), { readOnly: true, viewer });
        }));
        box.querySelectorAll('[data-sk-grant]').forEach(b => b.addEventListener('click', () => openGrant(b.dataset.skGrant, viewer, () => renderRoster(container, viewer, people, o))));
      }
    });
  }

  function openGrant(userId, admin, done) {
    const u = DB.getUser(userId);
    UI.modal.open(`Beri Streak Freeze — ${u.name}`, `<form id="skGrantForm" class="form">
      <div class="form-group"><label>Jumlah freeze (1–5)</label><input type="number" name="n" min="1" max="5" value="1" required /></div>
      <div class="form-group"><label>Alasan (tercatat di audit)</label><input name="reason" maxlength="160" required placeholder="mis. sakit, ada surat keterangan" /></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button><button type="submit" class="btn btn-primary">Beri Freeze</button></div></form>`);
    const f = document.getElementById('skGrantForm');
    f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        DB.grantStreakFreeze(userId, f.n.value, f.reason.value, admin);
        DB.addNotification({ userId, icon: '❄️', title: 'Kamu mendapat Streak Freeze', body: `${f.n.value} freeze dari admin: ${f.reason.value}`, link: 'streak' });
        memo.clear(); UI.modal.close(); UI.toast('Streak Freeze diberikan.'); done();
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  /* ------------------------- tutor ------------------------- */
  function renderTutor(container, user) {
    const ids = new Set();
    DB.getCoursesByTeacher(user.id).forEach(c => DB.getEnrollmentsByCourse(c.id).forEach(e => ids.add(e.studentId)));
    const people = DB.getUsers().filter(u => ids.has(u.id));
    container.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('🔥', 'Streak Belajar Siswa Saya', 'mentee di kelas yang Anda ampu • hanya baca')}</div><div id="skTutor"></div></div>`;
    if (!people.length) { container.querySelector('#skTutor').innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Belum ada siswa di kelas Anda.</div>'; return; }
    renderRoster(container.querySelector('#skTutor'), user, people, { canGrant: false });
  }

  /* ------------------------- admin ------------------------- */
  let adminTab = 'roster';
  function renderAdmin(container, admin) {
    const st = settings();
    container.innerHTML = `
      <div class="tabs">${[['roster', '👥 Ringkasan Mentee'], ['settings', '⚙️ Aturan Streak'], ['milestones', '🏅 Milestone & Visual'], ['campus', '🏛️ Kampus'], ['board', '🏆 Leaderboard']]
        .map(([k, l]) => `<button type="button" class="tab-btn ${adminTab === k ? 'active' : ''}" data-sk-tab="${k}">${l}</button>`).join('')}</div>
      <div id="skAdminBox"></div>`;
    container.querySelectorAll('[data-sk-tab]').forEach(b => b.addEventListener('click', () => { adminTab = b.dataset.skTab; renderAdmin(container, admin); }));
    const box = container.querySelector('#skAdminBox');
    const save = (pairs, msg) => { pairs.forEach(([k, v]) => DB.setSetting(k, v)); memo.clear(); UI.toast(msg || 'Disimpan.'); renderAdmin(container, admin); };
    const int = (v, lo, hi) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Nilai harus ${lo}–${hi}.`); return n; };

    if (adminTab === 'roster') {
      box.innerHTML = '<div class="card"><div class="card-header">' + UI.secHead('🔥', 'Streak Seluruh Mentee', 'pantau risiko streak putus, beri Streak Freeze dengan alasan yang tercatat') + '</div><div id="skAdmRoster"></div></div>';
      renderRoster(box.querySelector('#skAdmRoster'), admin, DB.getUsers().filter(u => u.role === 'siswa'), { canGrant: true });
      return;
    }
    if (adminTab === 'settings') {
      box.innerHTML = `<form class="card form" id="skSetForm">
        <div class="card-header">${UI.secHead('⚙️', 'Aturan Streak', 'berlaku untuk seluruh mentee; streak dihitung ulang otomatis')}</div>
        <label class="check-row"><input type="checkbox" name="enabled" ${st.streakEnabled !== false ? 'checked' : ''}/> Aktifkan fitur streak & gamifikasi</label>
        <div class="form-row">
          <div class="form-group"><label>Penghitungan hari</label><select name="tzMode" class="input">
            <option value="lms" ${st.streakTimezoneMode !== 'user' ? 'selected' : ''}>Zona waktu LMS</option>
            <option value="user" ${st.streakTimezoneMode === 'user' ? 'selected' : ''}>Zona waktu pilihan mentee</option></select></div>
          <div class="form-group"><label>Zona waktu LMS</label><select name="tz" class="input">${Object.keys(DB.TZ_OFFSETS).map(z => `<option ${st.lmsTimezone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Aktivitas belajar minimal / hari</label><input type="number" name="minAct" min="1" max="10" value="${st.streakMinActivities}" /></div>
          <div class="form-group"><label>Daily goal (jenis aktivitas berbeda)</label><input type="number" name="goal" min="1" max="10" value="${st.streakDailyGoal}" /></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Weekly streak: hari aktif / minggu</label><input type="number" name="week" min="1" max="7" value="${st.streakWeeklyTarget}" /></div>
          <div class="form-group"><label>Monthly streak: hari aktif / bulan</label><input type="number" name="month" min="1" max="28" value="${st.streakMonthlyTarget}" /></div>
        </div>
        <div class="form-group"><label>Jam pengingat sebelum streak putus (0–23)</label><input type="number" name="hour" min="0" max="23" value="${st.streakReminderHour}" /></div>
        <h4>❄️ Streak Freeze</h4>
        <label class="check-row"><input type="checkbox" name="freeze" ${st.streakFreezeEnabled !== false ? 'checked' : ''}/> Aktifkan perlindungan otomatis saat satu hari terlewat</label>
        <div class="form-row">
          <div class="form-group"><label>Dapat 1 freeze tiap kelipatan streak (hari, 0 = tidak)</label><input type="number" name="earn" min="0" max="60" value="${st.streakFreezeEarnEvery}" /></div>
          <div class="form-group"><label>Stok maksimal</label><input type="number" name="fmax" min="0" max="10" value="${st.streakFreezeMax}" /></div>
          <div class="form-group"><label>Pemakaian maks / bulan</label><input type="number" name="fmonth" min="0" max="10" value="${st.streakFreezeMonthlyLimit}" /></div>
        </div>
        <h4>🎓 Durasi Batch</h4>
        <div class="form-row">
          <div class="form-group"><label>Durasi batch (hari)</label><input type="number" name="prog" min="30" max="1000" value="${st.streakProgramDays}" /></div>
          <div class="form-group"><label>Tambahan hari (perpanjangan)</label><input type="number" name="extra" min="0" max="365" value="${st.streakProgramExtraDays}" /></div>
          <div class="form-group"><label>Tanggal mulai batch</label><input type="date" name="start" value="${esc(st.streakProgramStart || '')}" />
            <div class="muted small">Kosong = mulai dari aktivitas pertama tiap mentee.</div></div>
        </div>
        <p class="muted small">Total batch saat ini: <strong>${programTotal()} hari</strong>. Milestone "Satu Batch Penuh" dan skala pertumbuhan visual otomatis menyesuaikan.</p>
        <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Simpan Aturan</button></div>
      </form>`;
      box.querySelector('#skSetForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          if (f.start.value && !/^\d{4}-\d{2}-\d{2}$/.test(f.start.value)) throw new Error('Tanggal mulai tidak valid.');
          save([['streakEnabled', f.enabled.checked], ['streakTimezoneMode', f.tzMode.value === 'user' ? 'user' : 'lms'],
            ['lmsTimezone', DB.TZ_OFFSETS[f.tz.value] != null ? f.tz.value : 'WIB'], ['streakMinActivities', int(f.minAct.value, 1, 10)],
            ['streakDailyGoal', int(f.goal.value, 1, 10)], ['streakWeeklyTarget', int(f.week.value, 1, 7)], ['streakMonthlyTarget', int(f.month.value, 1, 28)],
            ['streakReminderHour', int(f.hour.value, 0, 23)], ['streakFreezeEnabled', f.freeze.checked], ['streakFreezeEarnEvery', int(f.earn.value, 0, 60)],
            ['streakFreezeMax', int(f.fmax.value, 0, 10)], ['streakFreezeMonthlyLimit', int(f.fmonth.value, 0, 10)],
            ['streakProgramDays', int(f.prog.value, 30, 1000)], ['streakProgramExtraDays', int(f.extra.value, 0, 365)], ['streakProgramStart', f.start.value || '']],
          'Aturan streak disimpan.');
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      return;
    }
    if (adminTab === 'milestones') {
      const ms = milestones();
      box.innerHTML = `<form class="card form" id="skMsForm">
        <div class="card-header">${UI.secHead('🏅', 'Milestone, Reward & Perkembangan Visual', 'setiap milestone membuka satu elemen lingkungan danau')}</div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Visual</th><th>Hari berturut-turut</th><th>Nama badge</th><th>Poin reward</th><th>Deskripsi</th></tr></thead>
        <tbody>${ms.map(m => `<tr data-key="${m.key}"><td>${m.icon} <span class="muted small">${esc(m.unlock)}</span></td>
          <td>${m.batch ? `<strong>${m.days}</strong><div class="muted small">mengikuti durasi batch</div>` : `<input type="number" class="input" name="days" min="1" max="2000" value="${m.days}" />`}</td>
          <td><input class="input" name="label" maxlength="40" value="${esc(m.label)}" /></td>
          <td><input type="number" class="input" name="points" min="0" max="5000" value="${m.points}" /></td>
          <td><input class="input" name="desc" maxlength="160" value="${esc(m.desc)}" /></td></tr>`).join('')}</tbody></table></div>
        <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="skMsReset">Kembalikan bawaan</button><button class="btn btn-primary" type="submit">Simpan Milestone</button></div>
      </form>`;
      box.querySelector('#skMsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const out = [...box.querySelectorAll('tr[data-key]')].map(tr => {
            const days = tr.querySelector('[name=days]');
            const label = tr.querySelector('[name=label]').value.trim();
            if (!label) throw new Error('Nama badge wajib diisi.');
            return { key: tr.dataset.key, days: days ? int(days.value, 1, 2000) : undefined, label,
              points: int(tr.querySelector('[name=points]').value, 0, 5000), desc: tr.querySelector('[name=desc]').value.trim() };
          });
          const dd = out.filter(x => x.days).map(x => x.days);
          if (new Set(dd).size !== dd.length) throw new Error('Jumlah hari tiap milestone harus berbeda.');
          save([['streakMilestones', out]], 'Milestone disimpan.');
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      box.querySelector('#skMsReset').addEventListener('click', () => { if (UI.confirmDialog('Kembalikan milestone bawaan?')) save([['streakMilestones', null]], 'Milestone dikembalikan.'); });
      return;
    }
    if (adminTab === 'campus') {
      const unis = universities();
      box.innerHTML = `<form class="card form" id="skUniForm">
        <div class="card-header">${UI.secHead('🏛️', 'Lima Gedung Rektorat', 'nama & dasar peringkat dapat diubah — bukan peringkat permanen')}</div>
        <div class="alert alert-info small">Bawaan memakai <a href="${QS_URL}" target="_blank" rel="noopener noreferrer">QS World University Rankings 2026</a>. Angka peringkat yang belum diverifikasi sengaja dikosongkan; isi dari sumber resmi terbaru. Ilustrasi gedung hanya terinspirasi karakter arsitektur, bukan replika.</div>
        ${unis.map((u, i) => `<fieldset class="sk-uni" data-i="${i}"><legend>Gedung ${i + 1}</legend>
          <div class="form-row">
            <div class="form-group"><label>Nama kampus</label><input class="input" name="name" maxlength="80" required value="${esc(u.name)}" /></div>
            <div class="form-group"><label>Singkatan</label><input class="input" name="short" maxlength="10" required value="${esc(u.short)}" /></div>
            <div class="form-group"><label>Gaya bangunan</label><select class="input" name="style">${Object.keys(STYLES).map(k => `<option value="${k}" ${u.style === k ? 'selected' : ''}>${STYLES[k]}</option>`).join('')}</select></div>
            <div class="form-group"><label>Warna atap</label>${UI.colorFieldHtml('color', u.color, 'aria-label="Warna atap gedung ' + (i + 1) + '"', '#e2e8f0')}</div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Peringkat</label><input class="input" name="rank" maxlength="20" value="${esc(u.rank || '')}" placeholder="mis. 189" /></div>
            <div class="form-group"><label>Dasar pemeringkatan</label><input class="input" name="src" maxlength="100" value="${esc(u.rankingSource || '')}" /></div>
            <div class="form-group"><label>Tautan sumber (https)</label><input class="input" name="url" maxlength="300" value="${esc(u.rankingUrl || '')}" /></div>
          </div></fieldset>`).join('')}
        <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="skUniReset">Kembalikan bawaan</button><button class="btn btn-primary" type="submit">Simpan Kampus</button></div>
      </form>`;
      box.querySelector('#skUniForm').addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const out = [...box.querySelectorAll('.sk-uni')].map((fs, i) => {
            const v = (n) => fs.querySelector(`[name=${n}]`).value.trim();
            if (v('url') && !/^https:\/\//i.test(v('url'))) throw new Error(`Gedung ${i + 1}: tautan harus diawali https://`);
            if (!v('name') || !v('short')) throw new Error(`Gedung ${i + 1}: nama & singkatan wajib.`);
            return { key: DEFAULT_UNIVERSITIES[i].key, name: v('name'), short: v('short'), style: STYLES[v('style')] ? v('style') : 'modern',
              color: /^#[0-9a-f]{6}$/i.test(v('color')) ? v('color') : '#e2e8f0', rank: v('rank'), rankingSource: v('src'), rankingUrl: v('url') };
          });
          save([['streakUniversities', out]], 'Data kampus disimpan.');
        } catch (err) { UI.toast(err.message, 'error'); }
      });
      box.querySelector('#skUniReset').addEventListener('click', () => { if (UI.confirmDialog('Kembalikan data kampus bawaan?')) save([['streakUniversities', null]], 'Data kampus dikembalikan.'); });
      return;
    }
    // leaderboard
    box.innerHTML = `<div class="sk-grid"><form class="card form" id="skLbForm">
      <div class="card-header">${UI.secHead('🏆', 'Pengaturan Leaderboard', 'tampil di halaman streak mentee')}</div>
      <label class="check-row"><input type="checkbox" name="on" ${st.streakLeaderboardEnabled !== false ? 'checked' : ''}/> Tampilkan leaderboard</label>
      <div class="form-group"><label>Metrik</label><select class="input" name="metric">${Object.keys(METRIC_LABEL).map(k => `<option value="${k}" ${st.streakLeaderboardMetric === k ? 'selected' : ''}>${METRIC_LABEL[k]}</option>`).join('')}</select></div>
      <div class="form-group"><label>Cakupan</label><select class="input" name="scope"><option value="all" ${st.streakLeaderboardScope !== 'kelas' ? 'selected' : ''}>Seluruh mentee</option><option value="kelas" ${st.streakLeaderboardScope === 'kelas' ? 'selected' : ''}>Satu kelas utama</option></select></div>
      <div class="form-group"><label>Jumlah ditampilkan</label><input type="number" class="input" name="size" min="3" max="50" value="${st.streakLeaderboardSize}" /></div>
      <div class="form-group"><label>Privasi</label><select class="input" name="privacy"><option value="optin" ${st.streakLeaderboardPrivacy !== 'all' ? 'selected' : ''}>Hanya mentee yang mengizinkan</option><option value="all" ${st.streakLeaderboardPrivacy === 'all' ? 'selected' : ''}>Semua (nama yang tidak mengizinkan disamarkan)</option></select></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Simpan</button></div>
    </form><div class="card"><div class="card-header">${UI.secHead('👁', 'Pratinjau', 'tampilan admin menampilkan semua nama')}</div>${leaderboardHtml(admin)}</div></div>`;
    box.querySelector('#skLbForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        save([['streakLeaderboardEnabled', f.on.checked], ['streakLeaderboardMetric', METRIC_LABEL[f.metric.value] ? f.metric.value : 'current'],
          ['streakLeaderboardScope', f.scope.value === 'kelas' ? 'kelas' : 'all'], ['streakLeaderboardSize', int(f.size.value, 3, 50)],
          ['streakLeaderboardPrivacy', f.privacy.value === 'all' ? 'all' : 'optin']], 'Leaderboard disimpan.');
      } catch (err) { UI.toast(err.message, 'error'); }
    });
  }

  global.StreakAPI = {
    compute, tick, bonusPoints, milestones, universities, levelOf, programTotal,
    renderPage, renderAdmin, renderTutor, renderRoster, widgetHtml, bindWidget, lakeSvg,
    clearCache: () => memo.clear(), DEFAULT_MILESTONES, DEFAULT_UNIVERSITIES
  };
})(window);
