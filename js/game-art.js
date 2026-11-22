/* =====================================================================
 * js/game-art.js — gambar SVG untuk game arkade & Main Bareng Kelas
 * ---------------------------------------------------------------------
 * Semua gambar dibuat di perangkat (tanpa berkas gambar): ikon garis 24 px,
 * monster (Goblin, Orc, Golem raksasa), tokoh peran (Penyerang, Penyihir,
 * Penjaga, Penyembuh), mobil tampak atas, dan ilustrasi kartu game.
 * Dipakai js/games-arcade.js, js/race-engine.js, dan js/game-room.js.
 * ===================================================================*/
(function (global) {
  'use strict';

  /* ---------------- Ikon garis (stroke = currentColor) ---------------- */
  const P = {
    turbo: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/>',
    oil: '<path d="M12 3c3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.8 6-11z"/><path d="M9.5 15.5a2.5 2.5 0 0 0 2.5 2.5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    micOff: '<path d="M3 3l18 18M9 9v2a3 3 0 0 0 5.1 2.1M15 10V6a3 3 0 0 0-5.7-1.3"/><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.6 2.8M12 18v3"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    sword: '<path d="M14.5 3H21v6.5L9 21.5 2.5 15z"/><path d="m6 12 6 6M4 20l2-2"/>',
    wand: '<path d="m4 20 11-11M15 4v2M19 8h2M17.5 5.5 19 4M13 8l3 3"/><circle cx="17" cy="7" r="1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    cross: '<rect x="9" y="3" width="6" height="18" rx="1.5"/><rect x="3" y="9" width="18" height="6" rx="1.5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
    chest: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 13h18M5 9V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v2M12 12v3"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>',
    crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    left: '<path d="M15 5 8 12l7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    up: '<path d="m5 15 7-7 7 7"/>',
    jump: '<path d="M12 20V6M6 12l6-6 6 6M5 21h14"/>',
    rope: '<path d="M2 12c2-2 4 2 6 0s4 2 6 0 4 2 6 0 2 0 2 0"/><path d="M2 15c2-2 4 2 6 0s4 2 6 0 4 2 6 0"/>',
    basket: '<path d="M4 10h16l-2 10H6zM8 10l4-6 4 6"/>',
    hex: '<path d="m12 2 8.7 5v10L12 22l-8.7-5V7z"/>',
    map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
    skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M10 20v-2M14 20v-2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    skip: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
    car: '<path d="M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>'
  };
  /** Ikon SVG 24×24 (aria-hidden). */
  function icon(name, size, cls) {
    const s = size || 18;
    return `<svg class="ga-ic ${cls || ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.star}</svg>`;
  }

  /* ---------------- Monster ---------------- */
  const MONSTERS = {
    goblin: { name: 'Goblin', title: 'Goblin Pencuri', color: '#65a30d', hpPer: 60, atk: 16, hits: 2 },
    orc: { name: 'Orc', title: 'Orc Penjaga Jembatan', color: '#4d7c0f', hpPer: 90, atk: 22, hits: 3 },
    golem: { name: 'Golem', title: 'Golem Raksasa', color: '#78716c', hpPer: 135, atk: 26, hits: 99 }
  };
  function monster(kind, cls) {
    const k = MONSTERS[kind] ? kind : 'goblin';
    const body = {
      goblin: `
        <ellipse cx="80" cy="150" rx="42" ry="7" class="ga-shadow"/>
        <path d="M44 62 14 44l26 32z" fill="#84cc16"/><path d="M116 62l30-18-26 32z" fill="#84cc16"/>
        <path d="M52 112c-6 20-4 30 6 34h12l2-22zM108 112c6 20 4 30-6 34H90l-2-22z" fill="#3f6212"/>
        <path d="M48 96c0-20 14-34 32-34s32 14 32 34v14c0 12-14 18-32 18s-32-6-32-18z" fill="#713f12"/>
        <circle cx="80" cy="66" r="34" fill="#84cc16"/>
        <path d="M56 52l14 8M104 52l-14 8" stroke="#1a2e05" stroke-width="5" stroke-linecap="round"/>
        <ellipse cx="66" cy="66" rx="8" ry="9" fill="#fde047"/><ellipse cx="94" cy="66" rx="8" ry="9" fill="#fde047"/>
        <circle cx="67" cy="68" r="3.5" fill="#1a2e05"/><circle cx="93" cy="68" r="3.5" fill="#1a2e05"/>
        <path d="M66 86q14 10 28 0" stroke="#1a2e05" stroke-width="4" fill="none" stroke-linecap="round"/>
        <path d="M71 88l3 6 3-5M84 88l3 6 3-5" fill="#fff"/>
        <path d="M118 96l22-26 4 4-20 26z" fill="#cbd5e1"/><rect x="112" y="98" width="14" height="6" rx="2" transform="rotate(-50 119 101)" fill="#78350f"/>`,
      orc: `
        <ellipse cx="80" cy="152" rx="50" ry="7" class="ga-shadow"/>
        <path d="M48 118c-6 18-6 28 6 32h16v-26zM112 118c6 18 6 28-6 32H90v-26z" fill="#1f2937"/>
        <path d="M38 96c0-24 18-40 42-40s42 16 42 40v18c0 14-18 20-42 20s-42-6-42-20z" fill="#57534e"/>
        <path d="M54 84h52v40H54z" fill="#78716c"/><path d="M54 98h52M54 112h52" stroke="#44403c" stroke-width="3"/>
        <circle cx="80" cy="58" r="34" fill="#65a30d"/>
        <path d="M46 52c0-22 16-34 34-34s34 12 34 34z" fill="#9ca3af"/><path d="M76 18h8v20h-8z" fill="#6b7280"/>
        <path d="M46 52h68" stroke="#4b5563" stroke-width="5"/>
        <path d="M58 60l14 4M102 60l-14 4" stroke="#1a2e05" stroke-width="5" stroke-linecap="round"/>
        <circle cx="66" cy="68" r="5" fill="#ef4444"/><circle cx="94" cy="68" r="5" fill="#ef4444"/>
        <path d="M64 84h32" stroke="#1a2e05" stroke-width="5" stroke-linecap="round"/>
        <path d="M66 84l-3-12 7 10zM94 84l3-12-7 10z" fill="#fefce8"/>
        <rect x="124" y="40" width="7" height="92" rx="3" fill="#78350f"/>
        <path d="M128 40c18 0 26 12 26 26-10-6-18-6-26-4z" fill="#d1d5db"/><path d="M128 40c-14 2-20 12-20 24 8-6 14-6 20-4z" fill="#9ca3af"/>`,
      golem: `
        <ellipse cx="80" cy="154" rx="62" ry="7" class="ga-shadow"/>
        <path d="M40 120h28v32H36zM92 120h28l4 32H92z" fill="#57534e"/>
        <path d="M30 70h100l8 56H22z" fill="#78716c"/>
        <path d="M30 70h100l8 56H22z" fill="none" stroke="#44403c" stroke-width="3"/>
        <path d="M62 82l10 14-6 12 12 10M104 76l-8 16 8 10" stroke="#fb923c" stroke-width="3" fill="none" class="ga-glow"/>
        <path d="M6 78l24-8 6 46-22 6zM154 78l-24-8-6 46 22 6z" fill="#a8a29e" stroke="#57534e" stroke-width="3"/>
        <rect x="48" y="22" width="64" height="50" rx="8" fill="#a8a29e" stroke="#57534e" stroke-width="3"/>
        <path d="M56 44h18v8H56zM86 44h18v8H86z" fill="#f97316" class="ga-glow"/>
        <path d="M64 62h32" stroke="#57534e" stroke-width="4" stroke-linecap="round"/>
        <circle cx="40" cy="96" r="3" fill="#57534e"/><circle cx="118" cy="104" r="4" fill="#57534e"/>
        <path d="M70 22l6-10 8 10" fill="#65a30d"/>`
    }[k];
    return `<svg class="ga-monster is-${k} ${cls || ''}" viewBox="0 0 160 160" role="img" aria-label="${MONSTERS[k].title}">${body}</svg>`;
  }

  /* ---------------- Tokoh peran ---------------- */
  const ROLES = {
    penyerang: { name: 'Penyerang', color: '#dc2626', icon: 'sword', desc: 'Serangan terkuat ke monster.' },
    penyihir: { name: 'Penyihir', color: '#7c3aed', icon: 'wand', desc: 'Sihir yang melemahkan monster.' },
    penjaga: { name: 'Penjaga', color: '#2563eb', icon: 'shield', desc: 'Melindungi teman dari serangan.' },
    penyembuh: { name: 'Penyembuh', color: '#059669', icon: 'cross', desc: 'Memulihkan & membangkitkan teman.' }
  };
  function hero(role, opts) {
    const o = opts || {};
    const r = ROLES[role] ? role : 'penyerang';
    const c = ROLES[r].color, skin = o.skin || '#f2c9a0';
    const gear = {
      penyerang: `<path d="M44 20 58 6l2 2-14 14z" fill="#e5e7eb"/><rect x="40" y="20" width="8" height="4" rx="1" transform="rotate(-45 44 22)" fill="#78350f"/>
        <path d="M18 34c-6 10-8 22-6 34l8-4z" fill="#991b1b"/>`,
      penyihir: `<path d="M20 22 32 0l12 22z" fill="#5b21b6"/><path d="M18 22h28" stroke="#4c1d95" stroke-width="4" stroke-linecap="round"/>
        <path d="M50 18v56" stroke="#92400e" stroke-width="3"/><circle cx="50" cy="16" r="5" fill="#a78bfa" class="ga-glow"/>`,
      penjaga: `<path d="M42 38h16v18c0 8-8 12-8 12s-8-4-8-12z" fill="#1d4ed8" stroke="#bfdbfe" stroke-width="2"/>
        <path d="M22 18c0-8 5-12 10-12s10 4 10 12z" fill="#94a3b8"/>`,
      penyembuh: `<path d="M50 20v54" stroke="#a16207" stroke-width="3"/><path d="M45 18h10M50 13v10" stroke="#facc15" stroke-width="3" stroke-linecap="round"/>
        <path d="M20 20c2-8 7-11 12-11s10 3 12 11" fill="none" stroke="#bbf7d0" stroke-width="3"/>`
    }[r];
    return `<svg class="ga-hero is-${r} ${o.ko ? 'is-ko' : ''} ${o.cls || ''}" viewBox="0 0 64 80" aria-hidden="true">
      <ellipse cx="32" cy="76" rx="16" ry="3.5" class="ga-shadow"/>
      <path d="M22 64v10h7V64zM35 64v10h7V64z" fill="#374151"/>
      <path d="M18 38c0-6 6-10 14-10s14 4 14 10v28H18z" fill="${c}"/>
      <path d="M18 48h28" stroke="rgba(0,0,0,.18)" stroke-width="3"/>
      <circle cx="32" cy="20" r="11" fill="${skin}"/>
      <circle cx="28" cy="20" r="1.6" fill="#1f2937"/><circle cx="36" cy="20" r="1.6" fill="#1f2937"/>
      <path d="M29 25q3 2 6 0" stroke="#1f2937" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      ${gear}
    </svg>`;
  }

  /* ---------------- Mobil tampak atas ---------------- */
  const CAR_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#e11d48'];
  function carSvg(color, cls) {
    return `<svg class="ga-car ${cls || ''}" viewBox="0 0 40 70" aria-hidden="true">
      <rect x="2" y="10" width="6" height="14" rx="2" fill="#111827"/><rect x="32" y="10" width="6" height="14" rx="2" fill="#111827"/>
      <rect x="2" y="46" width="6" height="14" rx="2" fill="#111827"/><rect x="32" y="46" width="6" height="14" rx="2" fill="#111827"/>
      <rect x="6" y="3" width="28" height="64" rx="11" fill="${color}"/>
      <path d="M11 18h18l-3 10H14z" fill="#bae6fd"/><path d="M13 48h14l2 7H11z" fill="#93c5fd"/>
      <rect x="17" y="3" width="6" height="64" fill="rgba(255,255,255,.28)"/>
    </svg>`;
  }
  /** Gambar mobil di kanvas 2D (pusat x,y; w lebar; sudut radian). */
  function drawCar(g, x, y, w, color, angle, opts) {
    const o = opts || {};
    const h = w * 1.75;
    g.save();
    g.translate(x, y);
    if (angle) g.rotate(angle);
    g.fillStyle = 'rgba(0,0,0,.25)';
    roundRect(g, -w / 2 + 2, -h / 2 + 4, w, h, w * 0.3); g.fill();
    g.fillStyle = '#111827';
    [[-0.55, -0.3], [0.4, -0.3], [-0.55, 0.22], [0.4, 0.22]].forEach(([fx, fy]) => { roundRect(g, fx * w, fy * h, w * 0.15, h * 0.2, 2); g.fill(); });
    g.fillStyle = color;
    roundRect(g, -w * 0.42, -h / 2, w * 0.84, h, w * 0.3); g.fill();
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.fillRect(-w * 0.08, -h / 2, w * 0.16, h);
    g.fillStyle = '#bae6fd';
    g.beginPath(); g.moveTo(-w * 0.28, -h * 0.24); g.lineTo(w * 0.28, -h * 0.24); g.lineTo(w * 0.2, -h * 0.08); g.lineTo(-w * 0.2, -h * 0.08); g.closePath(); g.fill();
    g.fillStyle = '#93c5fd';
    g.fillRect(-w * 0.2, h * 0.2, w * 0.4, h * 0.09);
    if (o.shield) {
      g.strokeStyle = 'rgba(56,189,248,.9)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(0, 0, w * 0.85, h * 0.68, 0, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(56,189,248,.15)'; g.fill();
    }
    if (o.turbo) {
      g.fillStyle = 'rgba(251,146,60,.9)';
      g.beginPath(); g.moveTo(-w * 0.25, h / 2); g.lineTo(0, h / 2 + h * (0.35 + Math.random() * 0.2)); g.lineTo(w * 0.25, h / 2); g.closePath(); g.fill();
    }
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  /* ---------------- Ilustrasi kartu game (48×48) ---------------- */
  const CARD_ART = {
    peta: '<rect x="4" y="6" width="40" height="36" rx="6" fill="#fde68a"/><path d="M10 34c6-10 10 2 16-8s10-2 14-14" stroke="#b45309" stroke-width="2.5" stroke-dasharray="3 3" fill="none"/><path d="M36 9l4 4M40 9l-4 4" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"/><circle cx="11" cy="35" r="3" fill="#2563eb"/>',
    monster: '<circle cx="24" cy="22" r="14" fill="#84cc16"/><path d="M12 18 4 10l6 14M36 18l8-8-6 14" fill="#84cc16"/><circle cx="19" cy="21" r="3" fill="#fde047"/><circle cx="29" cy="21" r="3" fill="#fde047"/><path d="M18 30q6 4 12 0" stroke="#1a2e05" stroke-width="2.5" fill="none"/><path d="M8 44h32" stroke="#713f12" stroke-width="4" stroke-linecap="round"/>',
    balap: '<rect x="4" y="4" width="40" height="40" rx="8" fill="#334155"/><path d="M24 6v8M24 20v8M24 34v8" stroke="#fde047" stroke-width="2.5"/><rect x="11" y="18" width="10" height="17" rx="4" fill="#ef4444"/><rect x="28" y="10" width="10" height="17" rx="4" fill="#3b82f6"/>',
    lari: '<path d="M4 40h40" stroke="#16a34a" stroke-width="4" stroke-linecap="round"/><circle cx="18" cy="10" r="5" fill="#f2c9a0"/><path d="M18 16l-2 12 8 8M16 28l-8 6M18 20l8 4M18 20l-8 2" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round" fill="none"/><rect x="32" y="30" width="8" height="10" rx="2" fill="#a16207"/>',
    tambang: '<path d="M4 26h40" stroke="#a16207" stroke-width="4" stroke-linecap="round"/><path d="M24 18v16" stroke="#dc2626" stroke-width="3"/><circle cx="9" cy="16" r="4" fill="#3b82f6"/><circle cx="39" cy="16" r="4" fill="#ef4444"/><path d="M9 20v10l-4 8M39 20v10l4 8" stroke="#475569" stroke-width="3" stroke-linecap="round" fill="none"/>',
    tangkap: '<circle cx="14" cy="10" r="5" fill="#22c55e"/><circle cx="32" cy="16" r="5" fill="#f43f5e"/><circle cx="22" cy="24" r="4" fill="#f59e0b"/><path d="M8 34h32l-4 10H12z" fill="#a16207"/><path d="M8 34h32" stroke="#78350f" stroke-width="3"/>',
    wilayah: '<path d="m14 4 8 4.6v9.2L14 22l-8-4.2V8.6z" fill="#3b82f6"/><path d="m32 4 8 4.6v9.2L32 22l-8-4.2V8.6z" fill="#ef4444"/><path d="m23 20 8 4.6v9.2L23 38l-8-4.2v-9.2z" fill="#3b82f6"/><path d="m40 22 4 2.3V34l-4 2" fill="#94a3b8"/>',
    ludo: '<rect x="4" y="4" width="40" height="40" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2"/><rect x="6" y="6" width="14" height="14" rx="3" fill="#ef4444"/><rect x="28" y="6" width="14" height="14" rx="3" fill="#22c55e"/><rect x="6" y="28" width="14" height="14" rx="3" fill="#3b82f6"/><rect x="28" y="28" width="14" height="14" rx="3" fill="#facc15"/><path d="m24 18 6 6-6 6-6-6z" fill="#64748b"/>',
    raid: '<path d="M8 40 24 6l16 34z" fill="#78716c"/><path d="M18 26h4v4h-4zM26 26h4v4h-4z" fill="#f97316"/><circle cx="10" cy="40" r="4" fill="#dc2626"/><circle cx="38" cy="40" r="4" fill="#2563eb"/>'
  };
  function cardArt(id) {
    return `<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">${CARD_ART[id] || CARD_ART.peta}</svg>`;
  }

  global.GameArt = { icon, monster, hero, carSvg, drawCar, roundRect, cardArt, MONSTERS, ROLES, CAR_COLORS };
})(window);
