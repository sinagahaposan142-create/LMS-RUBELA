/* =====================================================================
 * js/race-engine.js — mesin Balapan Mobil (8 sirkuit bertema)
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh:
 *  - game "Balapan Mobil" (js/games-arcade.js): kamu vs 3 mobil bot
 *  - "Balap Kelas" (js/game-room.js): tiap siswa menyetir dari HP-nya,
 *    layar guru/proyektor menampilkan seluruh balapan.
 *
 * Satuan jarak: 1 putaran = LAP (1000) satuan. Mobil melaju sendiri;
 * pengemudi hanya pindah lajur (3 lajur) untuk menghindari rintangan &
 * genangan oli, dan menjawab soal di gerbang "?" untuk mendapat item.
 * Isi lintasan (gerbang, rintangan, papan turbo) dibuat dari seed yang
 * sama sehingga semua pemain mendapat lintasan identik.
 * ===================================================================*/
(function (global) {
  'use strict';
  const LAP = 1000;
  const GATES_PER_LAP = 3;
  const GATE_AT = [240, 560, 850];
  const BASE_SPEED = 56;                  // satuan per detik
  const FX = { turbo: 3000, skid: 2200, hit: 1300, oil: 1800, shield: 12000, pad: 1200 };
  const ITEMS = {
    turbo: { name: 'Turbo', icon: 'turbo', desc: 'Melesat 3 detik' },
    shield: { name: 'Perisai', icon: 'shield', desc: 'Menahan 1 tabrakan/oli' },
    oil: { name: 'Genangan Oli', icon: 'oil', desc: 'Lempar ke mobil di depanmu' }
  };

  const mulberry = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const reduced = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------- 8 sirkuit ---------------- */
  const TRACKS = [
    { id: 'taman', name: 'Taman Kota', path: 'M80,40 H320 C360,40 370,70 370,100 V160 C370,200 350,220 320,220 H80 C50,220 30,200 30,160 V100 C30,70 45,40 80,40 Z',
      c: { ground: '#86efac', ground2: '#4ade80', road: '#475569', edge: '#f8fafc', line: '#fde047', sky: '#bbf7d0' }, deco: 'tree', obstacle: 'cone' },
    { id: 'gurun', name: 'Gurun', path: 'M70,60 C120,20 220,50 260,40 C330,25 380,70 360,130 C345,180 300,170 270,200 C230,240 150,235 100,215 C40,190 20,100 70,60 Z',
      c: { ground: '#fde68a', ground2: '#fbbf24', road: '#78716c', edge: '#fef3c7', line: '#fff7ed', sky: '#fef3c7' }, deco: 'cactus', obstacle: 'rock' },
    { id: 'pantai', name: 'Pantai', path: 'M60,200 C30,150 60,90 110,80 C160,70 170,40 230,35 C300,30 370,60 360,120 C350,170 300,160 270,190 C240,225 150,235 110,228 C85,224 70,215 60,200 Z',
      c: { ground: '#fef3c7', ground2: '#38bdf8', road: '#64748b', edge: '#ffffff', line: '#fde047', sky: '#bae6fd' }, deco: 'palm', obstacle: 'crab' },
    { id: 'salju', name: 'Salju', path: 'M90,50 C140,30 180,70 220,50 C260,30 330,30 350,80 C370,130 320,140 330,180 C340,215 290,235 240,220 C200,208 180,230 130,225 C70,220 40,180 50,130 C58,90 60,62 90,50 Z',
      c: { ground: '#f1f5f9', ground2: '#e2e8f0', road: '#64748b', edge: '#bae6fd', line: '#e0f2fe', sky: '#e0f2fe' }, deco: 'pine', obstacle: 'snowman' },
    { id: 'hutan', name: 'Hutan', path: 'M50,120 C40,60 100,30 150,50 C190,66 200,110 240,100 C280,90 270,40 320,40 C370,40 380,100 360,150 C340,200 300,230 240,220 C190,212 170,180 130,200 C90,220 60,180 50,120 Z',
      c: { ground: '#166534', ground2: '#14532d', road: '#57534e', edge: '#d6d3d1', line: '#fde68a', sky: '#bbf7d0' }, deco: 'forest', obstacle: 'log' },
    { id: 'malam', name: 'Kota Malam', path: 'M50,50 H200 Q215,50 215,65 V90 Q215,105 230,105 H340 Q360,105 360,125 V200 Q360,220 340,220 H70 Q50,220 50,200 Z',
      c: { ground: '#0f172a', ground2: '#1e1b4b', road: '#1e293b', edge: '#22d3ee', line: '#f0abfc', sky: '#312e81' }, deco: 'building', obstacle: 'barrier' },
    { id: 'gunung', name: 'Pegunungan', path: 'M40,200 C30,120 80,60 120,90 C150,112 140,40 190,40 C240,40 230,120 270,110 C310,100 310,40 350,50 C385,60 380,140 360,180 C340,225 280,230 220,225 C150,220 120,235 80,232 C55,230 45,220 40,200 Z',
      c: { ground: '#a3b18a', ground2: '#78716c', road: '#57534e', edge: '#e7e5e4', line: '#fde047', sky: '#dbeafe' }, deco: 'mountain', obstacle: 'rock' },
    { id: 'pelabuhan', name: 'Pelabuhan', path: 'M40,90 C40,60 60,45 100,45 H300 C340,45 365,70 365,105 C365,140 335,150 300,150 H220 C200,150 190,165 200,185 C210,205 260,200 300,205 C340,210 350,235 320,240 H90 C55,240 40,215 40,180 Z',
      c: { ground: '#0369a1', ground2: '#a16207', road: '#475569', edge: '#facc15', line: '#f8fafc', sky: '#bae6fd' }, deco: 'container', obstacle: 'crate' }
  ];
  const TRACK = {};
  TRACKS.forEach(t => { TRACK[t.id] = t; });

  /* ---------------- Isi lintasan (deterministik) ---------------- */
  function buildCourse(trackId, laps, seed) {
    const rng = mulberry((seed ^ 0x5bd1e995) >>> 0);
    const gates = [], obstacles = [], pads = [];
    for (let l = 0; l < laps; l++) {
      GATE_AT.forEach(g => gates.push(l * LAP + g));
      const used = [];
      const free = (d) => d > 60 && used.every(u => Math.abs(u - d) > 34) && GATE_AT.every(g => Math.abs(l * LAP + g - d) > 55);
      for (let i = 0, tries = 0; i < 7 && tries < 80; tries++) {
        const d = l * LAP + 40 + rng() * (LAP - 60);
        if (!free(d)) continue;
        used.push(d); i++;
        obstacles.push({ d, lane: Math.floor(rng() * 3) });
      }
      for (let i = 0, tries = 0; i < 2 && tries < 60; tries++) {
        const d = l * LAP + 80 + rng() * (LAP - 120);
        if (!free(d)) continue;
        used.push(d); i++;
        pads.push({ d, lane: Math.floor(rng() * 3) });
      }
    }
    obstacles.sort((a, b) => a.d - b.d);
    pads.sort((a, b) => a.d - b.d);
    return { track: TRACK[trackId] || TRACKS[0], laps, total: laps * LAP, gates, obstacles, pads };
  }

  /* ---------------- Fisika mobil ---------------- */
  function createCar(o) {
    return Object.assign({ id: '', name: '', color: '#ef4444', d: 0, lane: 1, lx: 1, v: 0, base: BASE_SPEED,
      fx: { turbo: 0, skid: 0, hit: 0, shield: 0 }, item: null, fin: 0, gate: 0, cruise: false, spin: 0 }, o || {});
  }
  /** Maju satu langkah. Mengembalikan daftar kejadian: gate/obstacle/pad/oil/finish. */
  function step(car, dt, t, course, puddles) {
    const ev = [];
    if (car.fin) { car.v = Math.max(0, car.v - car.base * dt); car.d += car.v * dt; return ev; }
    let target = car.base;
    if (t < car.fx.skid) target = car.base * 0.22;
    else if (t < car.fx.hit) target = car.base * 0.45;
    else if (t < car.fx.turbo) target = car.base * 1.75;
    if (car.cruise) target = Math.min(target, car.base * 0.72);
    car.v += (target - car.v) * Math.min(1, dt * 2.6);
    const prev = car.d;
    car.d += car.v * dt;
    car.lx += (car.lane - car.lx) * Math.min(1, dt * 9);
    car.spin = t < car.fx.skid ? car.spin + dt * 12 : 0;
    const crossed = (x) => prev < x && car.d >= x;
    const inLane = (lane) => Math.abs(car.lx - lane) < 0.55;
    course.obstacles.forEach((o, i) => { if (crossed(o.d) && inLane(o.lane)) ev.push({ type: 'obstacle', i }); });
    course.pads.forEach((p, i) => { if (crossed(p.d) && inLane(p.lane)) ev.push({ type: 'pad', i }); });
    (puddles || []).forEach((p) => { if (!p.used && (!p.to || p.to === car.id) && crossed(p.d) && inLane(p.lane)) ev.push({ type: 'oil', p }); });
    while (car.gate < course.gates.length && car.d >= course.gates[car.gate]) { ev.push({ type: 'gate', i: car.gate }); car.gate++; }
    if (car.d >= course.total) { car.fin = t || 1; ev.push({ type: 'finish' }); }
    return ev;
  }
  /** Terapkan efek benturan; perisai menahan satu benturan. */
  function hit(car, kind, t) {
    if (t < car.fx.shield) { car.fx.shield = 0; return 'blocked'; }
    if (kind === 'oil' || kind === 'skid') car.fx.skid = t + (kind === 'oil' ? FX.oil : FX.skid);
    else car.fx.hit = t + FX.hit;
    car.fx.turbo = 0;
    return 'hit';
  }
  function useItem(car, t) {
    const it = car.item;
    if (!it) return null;
    car.item = null;
    if (it === 'turbo') car.fx.turbo = t + FX.turbo;
    if (it === 'shield') car.fx.shield = t + FX.shield;
    return it;
  }
  /** Item hadiah jawaban benar; posisi belakang lebih sering mendapat Turbo. */
  function rollItem(rank, count, rng) {
    const back = count > 1 ? rank / (count - 1) : 0.5;      // 0 = terdepan, 1 = paling belakang
    const r = (rng || Math.random)();
    const pTurbo = 0.3 + back * 0.35, pOil = 0.38 - back * 0.2;
    return r < pTurbo ? 'turbo' : (r < pTurbo + pOil ? 'oil' : 'shield');
  }
  /** Peringkat: selesai lebih dulu, lalu jarak terjauh. */
  function standings(cars) {
    return cars.slice().sort((a, b) => {
      if (a.fin && b.fin) return a.fin - b.fin;
      if (a.fin) return -1;
      if (b.fin) return 1;
      return b.d - a.d;
    });
  }
  const lapOf = (car, course) => Math.min(course.laps, Math.floor(Math.min(car.d, course.total - 0.01) / LAP) + 1);

  /* ---------------- Peta sirkuit (SVG) ---------------- */
  const svgNS = 'http://www.w3.org/2000/svg';
  const lutCache = new Map();
  function trackLut(track) {
    if (lutCache.has(track.id)) return lutCache.get(track.id);
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', track.path);
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.appendChild(p);
    document.body.appendChild(svg);
    let len = 1000;
    const pts = [];
    try {
      len = p.getTotalLength();
      for (let i = 0; i <= 600; i++) { const q = p.getPointAtLength(len * i / 600); pts.push([q.x, q.y]); }
    } catch (e) { for (let i = 0; i <= 600; i++) pts.push([200 + 150 * Math.cos(i / 600 * 6.283), 130 + 90 * Math.sin(i / 600 * 6.283)]); }
    svg.remove();
    const lut = { len, pts };
    lutCache.set(track.id, lut);
    return lut;
  }
  /** Titik & arah pada sirkuit untuk jarak d (dalam satuan lintasan). */
  function pointAt(track, d) {
    const { pts } = trackLut(track);
    const f = ((d % LAP) + LAP) % LAP / LAP * (pts.length - 1);
    const i = Math.floor(f), a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
    const k = f - i;
    return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  }
  function decoSvg(track) {
    const rng = mulberry(track.id.length * 7919 + track.id.charCodeAt(0));
    const { pts } = trackLut(track);
    const out = [];
    for (let n = 0, tries = 0; n < 26 && tries < 400; tries++) {
      const x = 10 + rng() * 380, y = 10 + rng() * 240;
      if (pts.some(p => (p[0] - x) ** 2 + (p[1] - y) ** 2 < 26 * 26)) continue;
      n++;
      const s = 0.7 + rng() * 0.6;
      out.push(DECO_SVG[track.deco](x, y, s, rng));
    }
    return out.join('');
  }
  const DECO_SVG = {
    tree: (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-1.5" y="2" width="3" height="7" fill="#92400e"/><circle r="7" fill="#16a34a"/><circle cx="-3" cy="-2" r="3" fill="#22c55e"/></g>`,
    cactus: (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})" fill="#65a30d"><rect x="-2.5" y="-9" width="5" height="16" rx="2.5"/><rect x="-8" y="-4" width="4" height="7" rx="2"/><rect x="4" y="-6" width="4" height="7" rx="2"/></g>`,
    palm: (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0 8 C1 2 -1 -2 1 -6" stroke="#92400e" stroke-width="2.5" fill="none"/><path d="M1 -6 l-9 3 M1 -6 l9 2 M1 -6 l-5 -6 M1 -6 l6 -5" stroke="#16a34a" stroke-width="3" stroke-linecap="round"/></g>`,
    pine: (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0 -10 L7 2 H-7Z M0 -5 L8 7 H-8Z" fill="#15803d"/><path d="M0 -10 L3 -5 H-3Z" fill="#f8fafc"/><rect x="-1.5" y="7" width="3" height="3" fill="#78350f"/></g>`,
    forest: (x, y, s, r) => `<g transform="translate(${x},${y}) scale(${s})"><circle r="8" fill="${r() < 0.5 ? '#15803d' : '#166534'}"/><circle cx="5" cy="3" r="5" fill="#14532d"/></g>`,
    building: (x, y, s, r) => { const h = 10 + Math.floor(r() * 14); const c = ['#a855f7', '#22d3ee', '#f472b6'][Math.floor(r() * 3)]; return `<g transform="translate(${x},${y}) scale(${s})"><rect x="-7" y="${-h}" width="14" height="${h + 6}" fill="#1e293b" stroke="${c}" stroke-width="1"/><rect x="-4" y="${-h + 3}" width="3" height="3" fill="${c}"/><rect x="1" y="${-h + 8}" width="3" height="3" fill="${c}"/></g>`; },
    mountain: (x, y, s) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M-12 8 L0 -10 L12 8Z" fill="#78716c"/><path d="M0 -10 L4 -4 L-4 -4Z" fill="#f8fafc"/></g>`,
    container: (x, y, s, r) => `<g transform="translate(${x},${y}) scale(${s})"><rect x="-9" y="-5" width="18" height="10" fill="${['#dc2626', '#2563eb', '#16a34a', '#f59e0b'][Math.floor(r() * 4)]}"/><path d="M-6 -5v10M-2 -5v10M2 -5v10M6 -5v10" stroke="rgba(0,0,0,.25)"/></g>`
  };

  /**
   * Peta sirkuit dengan mobil. mount(host, course) → { update(cars), destroy() }.
   * cars: [{ id, d, color, name, me, fin }]
   */
  function mountMap(host, course, opts) {
    const o = opts || {};
    const t = course.track;
    const gates = course.gates.filter(g => g < LAP).map(g => pointAt(t, g));
    const start = pointAt(t, 0);
    host.innerHTML = `<svg class="re-map" viewBox="0 0 400 260" role="img" aria-label="Peta sirkuit ${t.name}">
      <rect width="400" height="260" rx="16" fill="${t.c.ground}"/>
      ${t.id === 'pantai' ? '<path d="M0 0 H400 V40 C300 70 200 10 100 40 C60 52 20 30 0 40Z" fill="#38bdf8" opacity=".85"/>' : ''}
      ${t.id === 'pelabuhan' ? '<rect x="0" y="0" width="400" height="260" rx="16" fill="#0369a1"/><path d="M20 30 H380 V250 H20Z" fill="#a8a29e" opacity=".9"/>' : ''}
      ${decoSvg(t)}
      <path d="${t.path}" fill="none" stroke="${t.c.edge}" stroke-width="22" stroke-linejoin="round"/>
      <path d="${t.path}" fill="none" stroke="${t.c.road}" stroke-width="17" stroke-linejoin="round"/>
      <path d="${t.path}" fill="none" stroke="${t.c.line}" stroke-width="1.4" stroke-dasharray="6 7" opacity=".8"/>
      <g transform="translate(${start.x},${start.y}) rotate(${start.ang * 57.3 + 90})"><rect x="-9" y="-2.5" width="18" height="5" fill="#fff"/><path d="M-9 -2.5h3v2.5h-3zM-3 -2.5h3v2.5h-3zM3 -2.5h3v2.5h-3zM-6 0h3v2.5h-3zM0 0h3v2.5h-3zM6 0h3v2.5h-3z" fill="#111"/></g>
      ${gates.map(g => `<g transform="translate(${g.x},${g.y})"><circle r="7" fill="#facc15" stroke="#854d0e" stroke-width="1.5"/><text y="3.5" text-anchor="middle" font-size="10" font-weight="900" fill="#713f12">?</text></g>`).join('')}
      <g class="re-cars"></g>
    </svg>`;
    const layer = host.querySelector('.re-cars');
    const els = new Map();
    return {
      update(cars) {
        const seen = new Set();
        cars.forEach(c => {
          seen.add(c.id);
          let g = els.get(c.id);
          if (!g) {
            g = document.createElementNS(svgNS, 'g');
            g.setAttribute('class', 're-car' + (c.me ? ' is-me' : ''));
            g.innerHTML = `<circle r="${c.me ? 7.5 : 6}" fill="${c.color}" stroke="#fff" stroke-width="2"/>${o.labels ? `<text y="-10" text-anchor="middle" class="re-car-l">${String(c.name || '').replace(/[<>&"]/g, '').slice(0, 12)}</text>` : ''}`;
            layer.appendChild(g);
            els.set(c.id, g);
          }
          const p = pointAt(t, c.d);
          g.setAttribute('transform', `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
          if (c.me) layer.appendChild(g);              // pemain sendiri digambar paling atas
        });
        els.forEach((g, id) => { if (!seen.has(id)) { g.remove(); els.delete(id); } });
      },
      destroy() { host.innerHTML = ''; els.clear(); }
    };
  }

  /* ---------------- Tampilan jalan (kanvas) ---------------- */
  /**
   * mountRoad(host, course) → { draw(view), resize(), destroy() }
   * view: { me: car, others: [car], puddles: [{d,lane}], t }
   */
  function mountRoad(host, course) {
    const t = course.track;
    const cv = document.createElement('canvas');
    cv.className = 're-road';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', `Jalan sirkuit ${t.name}. Gunakan tombol kiri/kanan untuk pindah lajur.`);
    host.appendChild(cv);
    const g = cv.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      dpr = Math.min(2, global.devicePixelRatio || 1);
      W = Math.max(260, host.clientWidth || 320);
      H = Math.round(Math.min(Math.max(300, W * 0.95), Math.max(320, (global.innerHeight || 700) * 0.52)));
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let ro = null;
    if ('ResizeObserver' in global) { ro = new ResizeObserver(() => resize()); ro.observe(host); }
    const still = reduced();
    const sway = (d) => (still ? 0 : Math.sin(d / 95) * 0.09 + Math.sin(d / 41 + 1.3) * 0.035);
    const decoRng = mulberry(t.id.charCodeAt(0) * 131 + 7);
    const decos = [];
    for (let d = 0; d < course.total + 200; d += 9 + decoRng() * 14) decos.push({ d, side: decoRng() < 0.5 ? -1 : 1, off: 0.15 + decoRng() * 0.75, r: decoRng() });

    function draw(view) {
      const me = view.me;
      const ppu = H / 150;                       // piksel per satuan
      const carY = H * 0.78;
      const roadW = Math.min(W * 0.78, 360);
      const laneW = roadW / 3;
      const yOf = (d) => carY - (d - me.d) * ppu;
      const cxOf = (d) => W / 2 + sway(d) * W;
      const laneX = (d, lane) => cxOf(d) + (lane - 1) * laneW;
      const vis = (d) => { const y = yOf(d); return y > -60 && y < H + 60; };

      // Latar
      g.fillStyle = t.c.ground; g.fillRect(0, 0, W, H);
      if (t.id === 'pantai') { g.fillStyle = t.c.ground2; g.fillRect(0, 0, W * 0.12, H); }
      if (t.id === 'pelabuhan') { g.fillStyle = t.c.ground2; g.fillRect(W * 0.86, 0, W * 0.14, H); }
      // Jalan per irisan (mengikuti kelokan)
      const step = 6;
      for (let y = -step; y < H + step; y += step) {
        const d = me.d + (carY - y) / ppu;
        const cx = cxOf(d);
        g.fillStyle = t.c.edge;
        g.fillRect(cx - roadW / 2 - 7, y, roadW + 14, step + 1);
        // pita tepi berselang
        if (Math.floor(d / 8) % 2 === 0) { g.fillStyle = t.id === 'malam' ? '#f0abfc' : '#ef4444'; g.fillRect(cx - roadW / 2 - 7, y, 7, step + 1); g.fillRect(cx + roadW / 2, y, 7, step + 1); }
        g.fillStyle = t.c.road;
        g.fillRect(cx - roadW / 2, y, roadW, step + 1);
        if (Math.floor(d / 7) % 2 === 0) {
          g.fillStyle = t.c.line;
          g.fillRect(cx - laneW / 2 - 1.5, y, 3, step + 1);
          g.fillRect(cx + laneW / 2 - 1.5, y, 3, step + 1);
        }
      }
      // Dekorasi tepi jalan
      decos.forEach(o => {
        if (!vis(o.d)) return;
        const y = yOf(o.d), cx = cxOf(o.d);
        const edge = roadW / 2 + 14;
        const room = Math.max(10, W / 2 - edge - 8);
        const x = cx + o.side * (edge + o.off * room);
        drawDeco(g, t.deco, x, y, o.r);
      });
      // Garis start/finis
      [0, course.total].forEach(fd => {
        if (!vis(fd)) return;
        const y = yOf(fd), cx = cxOf(fd), sq = roadW / 12;
        for (let i = 0; i < 12; i++) for (let r = 0; r < 2; r++) { g.fillStyle = (i + r) % 2 ? '#111827' : '#f9fafb'; g.fillRect(cx - roadW / 2 + i * sq, y - r * sq, sq, sq); }
      });
      // Papan turbo
      course.pads.forEach(p => {
        if (!vis(p.d)) return;
        const x = laneX(p.d, p.lane), y = yOf(p.d);
        g.fillStyle = 'rgba(34,211,238,.85)';
        for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(x - laneW * 0.3, y + k * 9); g.lineTo(x, y - 10 + k * 9); g.lineTo(x + laneW * 0.3, y + k * 9); g.lineTo(x + laneW * 0.3, y + 5 + k * 9); g.lineTo(x, y - 5 + k * 9); g.lineTo(x - laneW * 0.3, y + 5 + k * 9); g.closePath(); g.fill(); }
      });
      // Rintangan
      course.obstacles.forEach(o => { if (vis(o.d)) drawObstacle(g, t.obstacle, laneX(o.d, o.lane), yOf(o.d), laneW); });
      // Genangan oli
      (view.puddles || []).forEach(p => {
        if (p.used || !vis(p.d)) return;
        const x = laneX(p.d, p.lane), y = yOf(p.d);
        g.fillStyle = '#0b0b0f'; g.beginPath(); g.ellipse(x, y, laneW * 0.36, 11, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(168,85,247,.55)'; g.beginPath(); g.ellipse(x - 6, y - 3, laneW * 0.12, 3, -0.3, 0, Math.PI * 2); g.fill();
      });
      // Gerbang "?"
      course.gates.forEach((gd, i) => {
        if (!vis(gd)) return;
        const y = yOf(gd), cx = cxOf(gd);
        const passed = i < me.gate;
        g.fillStyle = '#334155';
        g.fillRect(cx - roadW / 2 - 10, y - 26, 8, 30); g.fillRect(cx + roadW / 2 + 2, y - 26, 8, 30);
        g.fillStyle = passed ? 'rgba(250,204,21,.45)' : '#facc15';
        GameArt.roundRect(g, cx - roadW / 2 - 6, y - 34, roadW + 12, 18, 6); g.fill();
        g.fillStyle = '#713f12'; g.font = '900 13px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(passed ? '✓' : '? ? ?   GERBANG SOAL   ? ? ?', cx, y - 25);
      });
      // Mobil lain
      (view.others || []).forEach(c => {
        if (!vis(c.d)) return;
        drawCarAt(c, laneX(c.d, c.lx != null ? c.lx : c.lane), yOf(c.d), laneW, view.t, c.name);
      });
      // Mobilku
      drawCarAt(me, laneX(me.d, me.lx), carY, laneW, view.t, '');
      // Garis kecepatan saat turbo
      if (view.t < me.fx.turbo && !still) {
        g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2;
        for (let k = 0; k < 10; k++) { const x = Math.random() * W, y = Math.random() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 26); g.stroke(); }
      }
    }
    function drawCarAt(c, x, y, laneW, tm, label) {
      const w = Math.min(34, laneW * 0.42);
      const ang = c.fx && tm < c.fx.skid ? (c.spin || 0) : 0;
      GameArt.drawCar(g, x, y, w, c.color, ang, { shield: c.fx && tm < c.fx.shield, turbo: c.fx && tm < c.fx.turbo });
      if (label) {
        g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
        const tw = g.measureText(label).width + 10;
        g.fillStyle = 'rgba(15,23,42,.75)'; GameArt.roundRect(g, x - tw / 2, y - w * 1.25 - 16, tw, 15, 6); g.fill();
        g.fillStyle = '#fff'; g.fillText(label, x, y - w * 1.25 - 3);
      }
    }
    return {
      draw, resize,
      destroy() { if (ro) ro.disconnect(); cv.remove(); }
    };
  }

  function drawDeco(g, kind, x, y, r) {
    switch (kind) {
      case 'tree': g.fillStyle = '#92400e'; g.fillRect(x - 2, y, 4, 9); g.fillStyle = '#15803d'; g.beginPath(); g.arc(x, y - 2, 10, 0, 6.283); g.fill(); g.fillStyle = '#22c55e'; g.beginPath(); g.arc(x - 3, y - 5, 4, 0, 6.283); g.fill(); break;
      case 'cactus': g.fillStyle = '#4d7c0f'; GameArt.roundRect(g, x - 3, y - 14, 6, 22, 3); g.fill(); GameArt.roundRect(g, x - 10, y - 7, 5, 9, 2.5); g.fill(); GameArt.roundRect(g, x + 5, y - 10, 5, 9, 2.5); g.fill(); break;
      case 'palm': g.strokeStyle = '#92400e'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(x, y + 8); g.quadraticCurveTo(x + 3, y - 2, x + 1, y - 10); g.stroke(); g.strokeStyle = '#16a34a'; g.lineWidth = 4; g.lineCap = 'round'; [[-12, -6], [12, -7], [-7, -18], [8, -17]].forEach(([dx, dy]) => { g.beginPath(); g.moveTo(x + 1, y - 10); g.lineTo(x + dx, y + dy); g.stroke(); }); g.lineCap = 'butt'; break;
      case 'pine': g.fillStyle = '#166534'; g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 10, y + 2); g.lineTo(x - 10, y + 2); g.closePath(); g.fill(); g.fillStyle = '#f8fafc'; g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 4, y - 10); g.lineTo(x - 4, y - 10); g.closePath(); g.fill(); break;
      case 'forest': g.fillStyle = r < 0.5 ? '#14532d' : '#15803d'; g.beginPath(); g.arc(x, y, 12, 0, 6.283); g.fill(); g.fillStyle = '#166534'; g.beginPath(); g.arc(x + 6, y + 4, 7, 0, 6.283); g.fill(); break;
      case 'building': { const h = 26 + r * 30; const c = r < 0.33 ? '#a855f7' : (r < 0.66 ? '#22d3ee' : '#f472b6'); g.fillStyle = '#1e293b'; g.fillRect(x - 11, y - h, 22, h + 6); g.strokeStyle = c; g.lineWidth = 1.5; g.strokeRect(x - 11, y - h, 22, h + 6); g.fillStyle = c; for (let k = 0; k < 3; k++) g.fillRect(x - 6 + (k % 2) * 7, y - h + 5 + k * 8, 4, 4); break; }
      case 'mountain': g.fillStyle = '#78716c'; g.beginPath(); g.moveTo(x - 16, y + 8); g.lineTo(x, y - 16); g.lineTo(x + 16, y + 8); g.closePath(); g.fill(); g.fillStyle = '#f8fafc'; g.beginPath(); g.moveTo(x, y - 16); g.lineTo(x + 5, y - 8); g.lineTo(x - 5, y - 8); g.closePath(); g.fill(); break;
      case 'container': g.fillStyle = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b'][Math.floor(r * 4)]; g.fillRect(x - 14, y - 8, 28, 16); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; for (let k = -9; k <= 9; k += 6) { g.beginPath(); g.moveTo(x + k, y - 8); g.lineTo(x + k, y + 8); g.stroke(); } break;
      default: break;
    }
  }
  function drawObstacle(g, kind, x, y, laneW) {
    const s = Math.min(1.2, laneW / 90);
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(2, 10, 20, 6, 0, 0, 6.283); g.fill();
    switch (kind) {
      case 'cone': g.fillStyle = '#f97316'; g.beginPath(); g.moveTo(0, -18); g.lineTo(12, 10); g.lineTo(-12, 10); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(-7, -3, 14, 4); break;
      case 'rock': g.fillStyle = '#6b7280'; g.beginPath(); g.moveTo(-16, 8); g.lineTo(-12, -8); g.lineTo(0, -14); g.lineTo(14, -6); g.lineTo(16, 8); g.closePath(); g.fill(); g.fillStyle = '#9ca3af'; g.beginPath(); g.moveTo(-8, -6); g.lineTo(0, -12); g.lineTo(6, -6); g.closePath(); g.fill(); break;
      case 'crab': g.fillStyle = '#dc2626'; g.beginPath(); g.ellipse(0, 0, 14, 9, 0, 0, 6.283); g.fill(); g.strokeStyle = '#dc2626'; g.lineWidth = 3; [[-1, 1], [1, 1]].forEach(([sx]) => { g.beginPath(); g.moveTo(sx * 12, -2); g.lineTo(sx * 20, -10); g.stroke(); }); g.fillStyle = '#fff'; g.fillRect(-5, -9, 3, 3); g.fillRect(2, -9, 3, 3); break;
      case 'snowman': g.fillStyle = '#f8fafc'; g.beginPath(); g.arc(0, 4, 11, 0, 6.283); g.fill(); g.beginPath(); g.arc(0, -10, 7, 0, 6.283); g.fill(); g.fillStyle = '#f97316'; g.fillRect(0, -11, 6, 2); g.strokeStyle = '#94a3b8'; g.lineWidth = 1; g.beginPath(); g.arc(0, 4, 11, 0, 6.283); g.stroke(); break;
      case 'log': g.fillStyle = '#92400e'; GameArt.roundRect(g, -22, -7, 44, 14, 7); g.fill(); g.fillStyle = '#d6a36c'; g.beginPath(); g.ellipse(20, 0, 5, 7, 0, 0, 6.283); g.fill(); break;
      case 'barrier': for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#f8fafc' : '#ef4444'; g.fillRect(-22 + k * 9, -8, 9, 12); } g.fillStyle = '#334155'; g.fillRect(-20, 4, 4, 8); g.fillRect(16, 4, 4, 8); break;
      case 'crate': g.fillStyle = '#b45309'; g.fillRect(-13, -13, 26, 24); g.strokeStyle = '#78350f'; g.lineWidth = 3; g.strokeRect(-13, -13, 26, 24); g.beginPath(); g.moveTo(-13, -13); g.lineTo(13, 11); g.stroke(); break;
      default: g.fillStyle = '#ef4444'; g.fillRect(-10, -10, 20, 20);
    }
    g.restore();
  }

  global.RaceEngine = {
    LAP, GATES_PER_LAP, BASE_SPEED, FX, ITEMS, TRACKS, TRACK,
    buildCourse, createCar, step, hit, useItem, rollItem, standings, lapOf, pointAt,
    mountMap, mountRoad, mulberry
  };
})(window);
