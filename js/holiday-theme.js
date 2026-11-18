/* =====================================================================
 * js/holiday-theme.js — Tema Hari Besar Nasional LMS Rubela
 * ---------------------------------------------------------------------
 * Admin memilih SATU tema hari besar secara manual (menu "Tema Hari
 * Besar"). Tema berlaku untuk semua pengguna di semua perangkat: halaman
 * masuk (index.html) dan seluruh dashboard (admin, tutor, mentee, ortu).
 *
 * Alur data
 *  - Pilihan disimpan di lms_settings: holidayTheme, holidayEffects,
 *    holidayBanner, holidayMessages → ikut tersinkron lewat server.
 *  - Halaman masuk (belum login, mode server) membaca tema dari
 *    /api/rubela?action=health (lihat api/_lib/handlers.js → health).
 *  - Warna & ilustrasi dipasang sebagai variabel CSS --hd-* di <html>
 *    beserta atribut data-holiday. css/holiday-themes.css memetakannya ke
 *    token design system (terang & gelap).
 *  - Salinan terakhir disimpan di localStorage "lms_holiday_cache" (lokal
 *    per perangkat, bukan data sinkron) agar skrip pra-render di <head>
 *    memasang tema sebelum paint pertama — tanpa kedipan warna lama.
 *
 * Dekorasi (semuanya aria-hidden & pointer-events:none)
 *  - ilustrasi SVG + untaian (garland) di hero, pola latar halaman,
 *    lencana di logo sidebar, garis warna topbar/sidebar, langit kampus
 *    halaman masuk, partikel animasi, kartu ucapan di Overview, dan pita
 *    ucapan di halaman masuk.
 *  - Animasi otomatis mati bila pengguna memilih "kurangi gerakan",
 *    selama ujian (body.exam-mode), bila admin mematikannya, atau bila
 *    pengguna mematikannya sendiri dari kartu ucapan.
 * ===================================================================*/
(function (global) {
  'use strict';

  const CACHE_KEY = 'lms_holiday_cache';   // lokal per perangkat (tidak ada di sync-catalog)
  const PREF_KEY = 'lms_holiday_prefs';    // preferensi pengguna: ucapan ditutup, animasi dimatikan
  const ADMIN_KEY = 'tema-hari-besar';     // kunci menu admin (js/dashboard.js)
  const CACHE_VER = 1;
  const MAX_TITLE = 80;
  const MAX_TEXT = 240;

  /* ================================================================
   * Utilitas
   * ==============================================================*/
  /* Halaman masuk tidak memuat js/ui.js, jadi modul ini harus mandiri. */
  function esc(s) {
    if (global.UI && UI.esc) return UI.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  const clip = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const r1 = (n) => Math.round(n * 10) / 10;
  const reducedMotion = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const svgDoc = (vb, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`;
  const dataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);
  const cssUrl = (svg) => `url("${dataUri(svg)}")`;

  function readJson(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function writeJson(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* kuota penuh / mode privat: tema tetap jalan tanpa cache */ }
  }

  /* ---------------- Tanggal ---------------- */
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86400000);
  const fmtLong = (d) => `${HARI[d.getDay()]}, ${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;

  /** Minggu Paskah (algoritma Gregorian anonim / Meeus–Jones–Butcher). */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  /** Kenaikan Yesus Kristus = 39 hari setelah Minggu Paskah (hari ke-40, selalu Kamis). */
  function ascension(y) {
    const e = easter(y);
    return new Date(e.getFullYear(), e.getMonth(), e.getDate() + 39);
  }

  /** Tahun & bulan Hijriah (Umm al-Qura) bila peramban mendukung; null bila tidak. */
  function hijri(now) {
    try {
      const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'numeric' });
      if (f.resolvedOptions().calendar !== 'islamic-umalqura') return null;
      const p = {};
      f.formatToParts(now).forEach(x => { p[x.type] = x.value; });
      const y = parseInt(p.year, 10), m = parseInt(p.month, 10);
      return y > 1400 && y < 1700 && m >= 1 && m <= 12 ? { y, m } : null;
    } catch (e) { return null; }
  }

  const SHIO = ['Tikus', 'Kerbau', 'Macan', 'Kelinci', 'Naga', 'Ular', 'Kuda', 'Kambing', 'Monyet', 'Ayam', 'Anjing', 'Babi'];
  const UNSUR = ['Kayu', 'Kayu', 'Api', 'Api', 'Tanah', 'Tanah', 'Logam', 'Logam', 'Air', 'Air'];

  /* ================================================================
   * Primitif SVG (dipakai ilustrasi, untaian, pola, ikon, partikel)
   * ==============================================================*/
  function starPts(cx, cy, R, r, n, rot) {
    const N = n || 5, base = rot == null ? -90 : rot, pts = [];
    for (let i = 0; i < N * 2; i++) {
      const a = (base + i * 180 / N) * Math.PI / 180, rad = i % 2 ? r : R;
      pts.push(r1(cx + rad * Math.cos(a)) + ',' + r1(cy + rad * Math.sin(a)));
    }
    return pts.join(' ');
  }
  const star = (cx, cy, R, fill, op) =>
    `<polygon points="${starPts(cx, cy, R, R * 0.42)}" fill="${fill}"${op != null ? ` opacity="${op}"` : ''}/>`;
  /** Bintang kilau 4 sudut. */
  const sparkle = (cx, cy, r, fill, op) =>
    `<path d="M${cx} ${r1(cy - r)}Q${cx} ${cy} ${r1(cx + r)} ${cy}Q${cx} ${cy} ${cx} ${r1(cy + r)}Q${cx} ${cy} ${r1(cx - r)} ${cy}Q${cx} ${cy} ${cx} ${r1(cy - r)}Z" fill="${fill}"${op != null ? ` opacity="${op}"` : ''}/>`;
  /** Kepingan salju 6 lengan dengan cabang. */
  function flake(cx, cy, r, c, w, op) {
    let d = '';
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      d += `M${r1(cx)} ${r1(cy)}L${r1(cx + r * Math.cos(a))} ${r1(cy + r * Math.sin(a))}`;
      const bx = cx + r * 0.55 * Math.cos(a), by = cy + r * 0.55 * Math.sin(a);
      [-0.7, 0.7].forEach(s => {
        d += `M${r1(bx)} ${r1(by)}L${r1(bx + r * 0.32 * Math.cos(a + s))} ${r1(by + r * 0.32 * Math.sin(a + s))}`;
      });
    }
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"${op != null ? ` opacity="${op}"` : ''}/>`;
  }
  /** Ledakan kembang api: sinar + titik di ujung. */
  function burst(cx, cy, r, c, n, w) {
    let d = '', dots = '';
    for (let i = 0; i < n; i++) {
      const a = i * 2 * Math.PI / n, ca = Math.cos(a), sa = Math.sin(a);
      d += `M${r1(cx + ca * r * 0.3)} ${r1(cy + sa * r * 0.3)}L${r1(cx + ca * r * 0.8)} ${r1(cy + sa * r * 0.8)}`;
      dots += `<circle cx="${r1(cx + ca * r)}" cy="${r1(cy + sa * r)}" r="${r1(w * 0.95)}" fill="${c}"/>`;
    }
    return `<g><path d="${d}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>${dots}</g>`;
  }
  /** Bulan sabit menghadap kanan (☾): lingkaran luar dipotong lingkaran yang digeser d. */
  function crescent(cx, cy, R, d, fill, op) {
    const h = Math.sqrt(R * R - (d / 2) * (d / 2)), x1 = r1(cx + d / 2);
    return `<path d="M${x1} ${r1(cy - h)}A${R} ${R} 0 1 0 ${x1} ${r1(cy + h)}A${R} ${R} 0 0 1 ${x1} ${r1(cy - h)}Z" fill="${fill}"${op != null ? ` opacity="${op}"` : ''}/>`;
  }
  function cloud(x, y, w, fill, op) {
    const h = w * 0.3;
    return `<g fill="${fill}"${op != null ? ` opacity="${op}"` : ''}>
      <rect x="${r1(x)}" y="${r1(y - h * 0.22)}" width="${r1(w)}" height="${r1(h * 0.56)}" rx="${r1(h * 0.28)}"/>
      <circle cx="${r1(x + w * 0.28)}" cy="${r1(y - h * 0.16)}" r="${r1(h * 0.48)}"/>
      <circle cx="${r1(x + w * 0.55)}" cy="${r1(y - h * 0.42)}" r="${r1(h * 0.64)}"/>
      <circle cx="${r1(x + w * 0.78)}" cy="${r1(y - h * 0.12)}" r="${r1(h * 0.42)}"/></g>`;
  }
  /** Ketupat anyaman janur. s = setengah diagonal. */
  function ketupat(cx, cy, s) {
    let weave = '';
    [1 / 3, 2 / 3].forEach(f => {
      weave += `M${r1(cx - f * s)} ${r1(cy - s + f * s)}L${r1(cx + s - f * s)} ${r1(cy + f * s)}`;
      weave += `M${r1(cx + f * s)} ${r1(cy - s + f * s)}L${r1(cx - s + f * s)} ${r1(cy + f * s)}`;
    });
    return `<g>
      <path d="M${cx} ${r1(cy + s)}l-${r1(s * 0.28)} ${r1(s * 0.6)}M${cx} ${r1(cy + s)}l${r1(s * 0.28)} ${r1(s * 0.6)}" stroke="#65a30d" stroke-width="${r1(Math.max(1.2, s * 0.12))}" stroke-linecap="round"/>
      <polygon points="${cx},${r1(cy - s)} ${r1(cx + s)},${cy} ${cx},${r1(cy + s)} ${r1(cx - s)},${cy}" fill="#bef264" stroke="#4d7c0f" stroke-width="${r1(Math.max(1, s * 0.08))}"/>
      <path d="${weave}" stroke="#65a30d" stroke-width="${r1(Math.max(0.8, s * 0.07))}"/></g>`;
  }
  /** Lampion Imlek merah–emas. top = tepi atas tutup. */
  function lantern(cx, top, rx, ry, withString) {
    const cy = top + ry + 5;
    return `<g>
      ${withString ? `<line x1="${cx}" y1="0" x2="${cx}" y2="${top}" stroke="#fbbf24" stroke-width="1.6"/>` : ''}
      <rect x="${r1(cx - rx * 0.45)}" y="${top}" width="${r1(rx * 0.9)}" height="${r1(Math.max(3, ry * 0.2))}" rx="1.5" fill="#fbbf24"/>
      <ellipse cx="${cx}" cy="${r1(cy)}" rx="${rx}" ry="${ry}" fill="#dc2626" stroke="#fbbf24" stroke-width="${r1(Math.max(1, rx * 0.06))}"/>
      <ellipse cx="${cx}" cy="${r1(cy)}" rx="${r1(rx * 0.56)}" ry="${ry}" fill="none" stroke="#fde68a" stroke-opacity=".8" stroke-width="${r1(Math.max(0.8, rx * 0.04))}"/>
      <ellipse cx="${cx}" cy="${r1(cy)}" rx="${r1(rx * 0.16)}" ry="${ry}" fill="none" stroke="#fde68a" stroke-opacity=".8" stroke-width="${r1(Math.max(0.8, rx * 0.04))}"/>
      <rect x="${r1(cx - rx * 0.45)}" y="${r1(cy + ry - ry * 0.12)}" width="${r1(rx * 0.9)}" height="${r1(Math.max(3, ry * 0.2))}" rx="1.5" fill="#fbbf24"/>
      <path d="M${cx} ${r1(cy + ry + ry * 0.1)}v${r1(ry * 0.75)}M${r1(cx - rx * 0.16)} ${r1(cy + ry + ry * 0.12)}v${r1(ry * 0.6)}M${r1(cx + rx * 0.16)} ${r1(cy + ry + ry * 0.12)}v${r1(ry * 0.6)}" stroke="#fbbf24" stroke-width="${r1(Math.max(1, rx * 0.06))}" stroke-linecap="round"/></g>`;
  }
  /** Bunga mei (plum) 5 kelopak. */
  function blossom(cx, cy, r, c) {
    let s = '';
    for (let i = 0; i < 5; i++) {
      const a = (-90 + i * 72) * Math.PI / 180;
      s += `<circle cx="${r1(cx + Math.cos(a) * r * 0.9)}" cy="${r1(cy + Math.sin(a) * r * 0.9)}" r="${r1(r * 0.62)}" fill="${c}"/>`;
    }
    return s + `<circle cx="${cx}" cy="${cy}" r="${r1(r * 0.38)}" fill="#fbbf24"/>`;
  }
  /** Teratai: kelopak di sekitar titik dasar (cx, cy). */
  function lotus(cx, cy, s, c1, c2) {
    const petal = (a, c) => `<ellipse cx="${cx}" cy="${r1(cy - s * 0.5)}" rx="${r1(s * 0.2)}" ry="${r1(s * 0.5)}" fill="${c}" transform="rotate(${a} ${cx} ${cy})"/>`;
    return `<g><ellipse cx="${cx}" cy="${r1(cy + s * 0.06)}" rx="${r1(s * 0.95)}" ry="${r1(s * 0.15)}" fill="#16a34a" opacity=".9"/>
      ${petal(-64, c2)}${petal(64, c2)}${petal(-32, c1)}${petal(32, c1)}${petal(0, c2)}</g>`;
  }
  function balloon(cx, cy, rx, ry, c, sx, sy) {
    return `<g><path d="M${cx} ${r1(cy + ry + 3)}C${r1(cx - 6)} ${r1(cy + ry + 22)} ${r1(sx + 6)} ${r1(sy - 22)} ${sx} ${sy}" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.2" fill="none"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${c}"/>
      <ellipse cx="${r1(cx - rx * 0.35)}" cy="${r1(cy - ry * 0.35)}" rx="${r1(rx * 0.2)}" ry="${r1(ry * 0.28)}" fill="#ffffff" opacity=".45"/>
      <polygon points="${r1(cx - 3)},${r1(cy + ry + 4)} ${r1(cx + 3)},${r1(cy + ry + 4)} ${cx},${r1(cy + ry - 1)}" fill="${c}"/></g>`;
  }
  /** Domba kurban (koordinat lokal, digeser dengan translate). */
  function sheep(x, y, s) {
    const legs = [[-17, 8], [-7, 10], [7, 10], [17, 8]].map(([lx, ly]) => `<rect x="${lx - 2.5}" y="${ly}" width="5" height="20" rx="2" fill="#44403c"/>`).join('');
    const wool = [[-20, -4, 13], [-8, -12, 14], [8, -12, 14], [21, -4, 13], [10, 5, 13], [-10, 5, 13], [0, -3, 15]]
      .map(([wx, wy, wr]) => `<circle cx="${wx}" cy="${wy}" r="${wr}"/>`).join('');
    return `<g transform="translate(${x} ${y}) scale(${s})">${legs}<g fill="#ffffff">${wool}<circle cx="33" cy="-6" r="5"/></g>
      <ellipse cx="-33" cy="-7" rx="10" ry="12.5" fill="#44403c"/><ellipse cx="-28" cy="-17" rx="6" ry="2.8" fill="#57534e" transform="rotate(-24 -28 -17)"/>
      <circle cx="-36.5" cy="-10" r="1.7" fill="#ffffff"/></g>`;
  }
  /** Separuh candi bentar (gerbang terbelah Bali). dir = -1 (kiri) / 1 (kanan). */
  function candiHalf(X, base, dir, fill, stroke) {
    const steps = [[60, base], [60, base - 30], [52, base - 30], [52, base - 54], [44, base - 54], [44, base - 78], [36, base - 78],
      [36, base - 100], [28, base - 100], [28, base - 120], [20, base - 120], [20, base - 138], [12, base - 138], [6, base - 150], [0, base - 156]];
    const pts = steps.map(([w, y]) => `${X + dir * w},${y}`).join(' ') + ` ${X},${base}`;
    let checker = '';
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 2; j++) {
        const cx0 = X + dir * (i * 6) + (dir < 0 ? -6 : 0);
        checker += `<rect x="${cx0}" y="${base - 20 + j * 6}" width="6" height="6" fill="${(i + j) % 2 ? '#f8fafc' : '#111827'}"/>`;
      }
    }
    return `<g><polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/>${checker}</g>`;
  }
  function heart(cx, cy, s, fill, op) {
    return `<path d="M${cx} ${r1(cy + s * 0.9)}C${r1(cx - s * 1.4)} ${r1(cy)} ${r1(cx - s * 0.7)} ${r1(cy - s * 1.1)} ${cx} ${r1(cy - s * 0.35)}C${r1(cx + s * 0.7)} ${r1(cy - s * 1.1)} ${r1(cx + s * 1.4)} ${cy} ${cx} ${r1(cy + s * 0.9)}Z" fill="${fill}"${op != null ? ` opacity="${op}"` : ''}/>`;
  }
  function apple(cx, cy, r) {
    return `<g><path d="M${cx} ${r1(cy - r * 0.8)}q${r1(r * 0.1)} ${r1(-r * 0.5)} ${r1(r * 0.35)} ${r1(-r * 0.7)}" stroke="#78350f" stroke-width="${r1(Math.max(1.2, r * 0.14))}" stroke-linecap="round" fill="none"/>
      <ellipse cx="${r1(cx + r * 0.5)}" cy="${r1(cy - r * 1.15)}" rx="${r1(r * 0.42)}" ry="${r1(r * 0.2)}" fill="#22c55e" transform="rotate(-28 ${r1(cx + r * 0.5)} ${r1(cy - r * 1.15)})"/>
      <path d="M${cx} ${r1(cy - r * 0.7)}C${r1(cx - r * 0.5)} ${r1(cy - r * 1.1)} ${r1(cx - r * 1.15)} ${r1(cy - r * 0.6)} ${r1(cx - r * 1.05)} ${r1(cy + r * 0.05)}C${r1(cx - r * 0.95)} ${r1(cy + r * 0.8)} ${r1(cx - r * 0.4)} ${r1(cy + r * 1.05)} ${cx} ${r1(cy + r * 0.85)}C${r1(cx + r * 0.4)} ${r1(cy + r * 1.05)} ${r1(cx + r * 0.95)} ${r1(cy + r * 0.8)} ${r1(cx + r * 1.05)} ${r1(cy + r * 0.05)}C${r1(cx + r * 1.15)} ${r1(cy - r * 0.6)} ${r1(cx + r * 0.5)} ${r1(cy - r * 1.1)} ${cx} ${r1(cy - r * 0.7)}Z" fill="#ef4444"/>
      <ellipse cx="${r1(cx - r * 0.45)}" cy="${r1(cy - r * 0.2)}" rx="${r1(r * 0.18)}" ry="${r1(r * 0.3)}" fill="#ffffff" opacity=".45"/></g>`;
  }
  function mortarboard(cx, cy, s) {
    return `<g><path d="M${r1(cx - s * 0.5)} ${r1(cy + s * 0.08)}v${r1(s * 0.28)}c${r1(s * 0.25)} ${r1(s * 0.2)} ${r1(s * 0.75)} ${r1(s * 0.2)} ${r1(s)} 0v${r1(-s * 0.28)}" fill="#0f172a"/>
      <polygon points="${cx},${r1(cy - s * 0.36)} ${r1(cx + s)},${cy} ${cx},${r1(cy + s * 0.36)} ${r1(cx - s)},${cy}" fill="#1e293b" stroke="#ffffff" stroke-opacity=".35" stroke-width="${r1(Math.max(0.8, s * 0.03))}"/>
      <path d="M${cx} ${cy}L${r1(cx + s * 0.86)} ${r1(cy + s * 0.06)}V${r1(cy + s * 0.5)}" stroke="#fbbf24" stroke-width="${r1(Math.max(1, s * 0.05))}" fill="none"/>
      <rect x="${r1(cx + s * 0.8)}" y="${r1(cy + s * 0.46)}" width="${r1(s * 0.12)}" height="${r1(s * 0.2)}" rx="1" fill="#fbbf24"/></g>`;
  }
  function flagRI(x, y, w, h, wave) {
    const a = wave ? h * 0.18 : 0;
    const top = `M${x} ${y}C${r1(x + w * 0.3)} ${r1(y - a)} ${r1(x + w * 0.55)} ${r1(y + a)} ${r1(x + w)} ${y}L${r1(x + w)} ${r1(y + h / 2)}C${r1(x + w * 0.55)} ${r1(y + h / 2 + a)} ${r1(x + w * 0.3)} ${r1(y + h / 2 - a)} ${x} ${r1(y + h / 2)}Z`;
    const bot = `M${x} ${r1(y + h / 2)}C${r1(x + w * 0.3)} ${r1(y + h / 2 - a)} ${r1(x + w * 0.55)} ${r1(y + h / 2 + a)} ${r1(x + w)} ${r1(y + h / 2)}L${r1(x + w)} ${r1(y + h)}C${r1(x + w * 0.55)} ${r1(y + h + a)} ${r1(x + w * 0.3)} ${r1(y + h - a)} ${x} ${r1(y + h)}Z`;
    return `<path d="${top}" fill="#ef4444" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.2"/><path d="${bot}" fill="#ffffff" stroke="#e5e7eb" stroke-width="1"/>`;
  }

  /* ================================================================
   * Ilustrasi hero (viewBox 320×200, ditempatkan di kanan-bawah hero).
   * Setiap ilustrasi memuat unsur khas hari besarnya. Gambar orisinal;
   * Lambang Negara (Garuda Pancasila) sengaja TIDAK digambar — hanya
   * lima simbol sila secara terpisah, sesuai kaidah penggunaan lambang.
   * ==============================================================*/
  const VB = '0 0 320 200';
  const ART = {
    'tahun-baru': (ctx) => svgDoc(VB, `
      ${burst(242, 58, 46, '#fbbf24', 14, 2.6)}${burst(150, 40, 30, '#f472b6', 12, 2.2)}
      ${burst(292, 122, 24, '#a78bfa', 10, 2)}${burst(78, 66, 20, '#ffffff', 10, 1.8)}
      ${sparkle(196, 104, 7, '#fde68a')}${sparkle(40, 128, 5, '#ffffff', 0.8)}${sparkle(300, 30, 5, '#ffffff', 0.85)}
      <g transform="translate(112 140)"><circle r="27" fill="#ffffff" fill-opacity=".1" stroke="#ffffff" stroke-opacity=".75" stroke-width="3"/>
        <path d="M0 -21v5M21 0h-5M0 21v-5M-21 0h5" stroke="#ffffff" stroke-opacity=".8" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M0 0V-17M0 0V-12" stroke="#fde68a" stroke-width="3.2" stroke-linecap="round"/><circle r="2.6" fill="#fde68a"/></g>
      <text x="236" y="186" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="56" letter-spacing="2"
        fill="#ffffff" fill-opacity=".12" stroke="#fde68a" stroke-opacity=".9" stroke-width="2">${esc(String(ctx.y))}</text>`),

    'imlek': () => svgDoc(VB, `
      <path d="M86 200C104 166 134 150 166 134S214 116 236 146" stroke="#7c2d12" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M140 146C150 128 160 122 176 116M206 124c6-12 16-16 26-18" stroke="#7c2d12" stroke-width="3" stroke-linecap="round" fill="none"/>
      ${blossom(132, 152, 9, '#fbcfe8')}${blossom(176, 116, 8, '#f9a8d4')}${blossom(214, 128, 9, '#fbcfe8')}${blossom(232, 106, 7, '#f9a8d4')}${blossom(160, 138, 6, '#fce7f3')}
      ${lantern(254, 20, 34, 28, true)}${lantern(196, 10, 18, 15, true)}${lantern(296, 58, 20, 17, true)}
      <g transform="translate(118 182)"><circle r="13" fill="#fbbf24" stroke="#b45309" stroke-width="2"/><rect x="-4" y="-4" width="8" height="8" fill="#991b1b"/></g>
      <g transform="translate(146 190)"><circle r="10" fill="#fcd34d" stroke="#b45309" stroke-width="2"/><rect x="-3" y="-3" width="6" height="6" fill="#991b1b"/></g>
      ${sparkle(64, 120, 5, '#fde68a', 0.9)}${sparkle(300, 160, 4, '#fde68a', 0.9)}`),

    'nyepi': () => svgDoc(VB, `
      ${[[40, 30, 1.4], [86, 60, 1], [124, 22, 1.6], [170, 48, 1.1], [210, 18, 1.3], [262, 40, 1.6], [300, 20, 1.1], [306, 82, 1.2], [60, 96, 1.1], [140, 90, 1.3]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity=".85"/>`).join('')}
      ${sparkle(232, 30, 5, '#ffffff', 0.9)}${sparkle(100, 40, 4, '#fde68a', 0.9)}
      ${candiHalf(216, 192, -1, '#111827', '#d4a017')}${candiHalf(244, 192, 1, '#111827', '#d4a017')}
      <path d="M232 176C226 164 238 154 232 142S228 124 234 112" stroke="#ffffff" stroke-opacity=".45" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g transform="translate(230 186)"><rect x="-13" y="-4" width="26" height="9" rx="2" fill="#a3e635" stroke="#4d7c0f" stroke-width="1"/>
        <circle cx="-7" cy="-6" r="3.4" fill="#f43f5e"/><circle cx="0" cy="-8" r="3.4" fill="#ffffff"/><circle cx="7" cy="-6" r="3.4" fill="#facc15"/><circle cx="0" cy="-3" r="2.6" fill="#6366f1"/></g>`),

    'idulfitri': () => svgDoc(VB, `
      ${crescent(252, 50, 28, 16, '#fde68a')}${star(282, 38, 9, '#fde68a')}
      ${sparkle(206, 30, 5, '#ffffff', 0.85)}${sparkle(306, 86, 4, '#fde68a')}
      <g fill="#ecfdf5" opacity=".92">
        <rect x="138" y="80" width="12" height="112"/><polygon points="134,82 154,82 144,60"/><rect x="134" y="104" width="20" height="5"/>
        <rect x="296" y="80" width="12" height="112"/><polygon points="292,82 312,82 302,60"/><rect x="292" y="104" width="20" height="5"/>
        <rect x="156" y="132" width="134" height="60"/>
        <path d="M180 132C180 100 202 88 223 72C244 88 266 100 266 132Z"/><rect x="221" y="56" width="4" height="18"/>
      </g>
      ${crescent(223, 50, 6, 4, '#fde68a')}
      <g fill="#065f46"><path d="M211 192v-26a12 12 0 0 1 24 0v26Z"/><path d="M170 160v-10a7 7 0 0 1 14 0v10Z"/><path d="M262 160v-10a7 7 0 0 1 14 0v10Z"/></g>
      <line x1="64" y1="0" x2="64" y2="34" stroke="#fde68a" stroke-width="1.5"/>${ketupat(64, 56, 22)}
      <line x1="106" y1="0" x2="106" y2="22" stroke="#fde68a" stroke-width="1.5"/>${ketupat(106, 38, 15)}`),

    'hardiknas': () => svgDoc(VB, `
      ${sparkle(110, 40, 6, '#fde68a')}${sparkle(300, 60, 5, '#ffffff', 0.85)}${sparkle(160, 22, 4, '#ffffff', 0.85)}${star(70, 90, 6, '#fde68a', 0.9)}
      ${mortarboard(232, 92, 64)}
      <g><path d="M232 150C210 136 180 134 156 142V188C180 180 210 182 232 196Z" fill="#ffffff"/>
        <path d="M232 150C254 136 284 134 308 142V188C284 180 254 182 232 196Z" fill="#f1f5f9"/>
        <path d="M232 150V196" stroke="#cbd5e1" stroke-width="2"/>
        <path d="M168 154c18-5 36-4 54 4M168 164c18-5 36-4 54 4M168 174c18-5 36-4 54 4M244 158c18-8 36-9 54-4M244 168c18-8 36-9 54-4M244 178c18-8 36-9 54-4" stroke="#94a3b8" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>
      <g transform="translate(86 176) rotate(-42)"><rect x="0" y="-7" width="70" height="14" rx="2" fill="#facc15"/><rect x="-10" y="-7" width="12" height="14" rx="3" fill="#f9a8d4"/>
        <rect x="-2" y="-7" width="5" height="14" fill="#94a3b8"/><polygon points="70,-7 88,0 70,7" fill="#fde68a"/><polygon points="82,-2.4 88,0 82,2.4" fill="#1f2937"/></g>`),

    'kenaikan': () => svgDoc(VB, `
      <g fill="#ffffff" opacity=".14">${[-3, -2, -1, 0, 1, 2, 3].map(i => `<polygon points="226,-10 ${226 + i * 46 - 10},200 ${226 + i * 46 + 10},200"/>`).join('')}</g>
      <circle cx="226" cy="44" r="46" fill="#fef9c3" opacity=".28"/><circle cx="226" cy="44" r="28" fill="#fef9c3" opacity=".4"/>
      <g fill="#ffffff"><rect x="221" y="16" width="10" height="56" rx="2"/><rect x="204" y="30" width="44" height="10" rx="2"/></g>
      ${cloud(40, 128, 92, '#ffffff', 0.55)}${cloud(120, 160, 128, '#ffffff', 0.92)}${cloud(206, 176, 118, '#ffffff', 0.97)}${cloud(240, 120, 70, '#ffffff', 0.6)}
      ${sparkle(140, 60, 5, '#fde68a')}${sparkle(300, 70, 4, '#ffffff', 0.9)}`),

    'waisak': () => svgDoc(VB, `
      <circle cx="240" cy="70" r="56" fill="#fef9c3" opacity=".22"/><circle cx="240" cy="70" r="40" fill="#fef9c3" opacity=".92"/>
      <g fill="#431407" stroke="#fbbf24" stroke-opacity=".75" stroke-width="1.5" stroke-linejoin="round">
        <rect x="166" y="178" width="148" height="14" rx="2"/><rect x="178" y="166" width="124" height="13" rx="2"/>
        <path d="M194 166C194 128 214 110 240 110C266 110 286 128 286 166Z"/><rect x="230" y="98" width="20" height="13" rx="2"/>
        <polygon points="234,98 246,98 240,58"/></g>
      <path d="M235 86h10M236 78h8" stroke="#fbbf24" stroke-opacity=".8" stroke-width="1.4"/>
      ${[[70, 54], [112, 26], [140, 84], [300, 24], [186, 40]].map(([x, y], i) => `<g transform="translate(${x} ${y})"><circle r="${i % 2 ? 11 : 13}" fill="#fde68a" opacity=".3"/>
        <rect x="-5.5" y="-7" width="11" height="14" rx="3" fill="#fdba74"/><rect x="-5.5" y="-7" width="11" height="3" rx="1" fill="#c2410c"/></g>`).join('')}
      ${lotus(108, 182, 46, '#fbcfe8', '#f472b6')}`),

    'iduladha': () => svgDoc(VB, `
      ${crescent(262, 46, 26, 14, '#fde68a')}${star(288, 34, 8, '#fde68a')}
      ${sparkle(206, 34, 5, '#ffffff', 0.85)}${sparkle(140, 50, 4, '#fde68a')}
      <g fill="#ffffff" opacity=".2"><path d="M40 196C40 160 62 148 80 132C98 148 120 160 120 196Z"/><rect x="128" y="104" width="10" height="92"/><polygon points="124,106 142,106 133,86"/></g>
      <ellipse cx="226" cy="194" rx="96" ry="10" fill="#fde68a" opacity=".3"/>
      ${sheep(236, 160, 1.15)}`),

    'pancasila': () => {
      const pos = [[50, 128], [110, 84], [178, 64], [246, 84], [296, 128]];
      const badge = ([x, y], i) => `<circle cx="${x}" cy="${y}" r="24" fill="#ffffff" fill-opacity=".14" stroke="#fde68a" stroke-opacity=".85" stroke-width="1.6"/>
        <text x="${x}" y="${y + 40}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="#ffffff" fill-opacity=".85">${i + 1}</text>`;
      const sym = [
        ([x, y]) => star(x, y, 14, '#fbbf24'),
        ([x, y]) => {
          let s = '';
          for (let j = 0; j < 8; j++) {
            const a = j * Math.PI / 4, lx = r1(x + 12 * Math.cos(a)), ly = r1(y + 12 * Math.sin(a));
            s += j % 2 ? `<rect x="${r1(lx - 3.2)}" y="${r1(ly - 3.2)}" width="6.4" height="6.4" fill="none" stroke="#fde68a" stroke-width="2" transform="rotate(${j * 45} ${lx} ${ly})"/>`
              : `<circle cx="${lx}" cy="${ly}" r="3.6" fill="none" stroke="#fde68a" stroke-width="2"/>`;
          }
          return s;
        },
        ([x, y]) => `<rect x="${x - 2.5}" y="${y + 1}" width="5" height="14" fill="#a16207"/>
          <path d="M${x - 6} ${y + 2}v9M${x + 6} ${y + 2}v9M${x - 2} ${y + 3}v7" stroke="#86efac" stroke-width="1.2"/>
          <g fill="#22c55e"><circle cx="${x}" cy="${y - 7}" r="10"/><circle cx="${x - 9}" cy="${y - 1}" r="7"/><circle cx="${x + 9}" cy="${y - 1}" r="7"/></g>`,
        ([x, y]) => `<path d="M${x - 8} ${y - 7}Q${x - 17} ${y - 9} ${x - 15} ${y - 18}M${x + 8} ${y - 7}Q${x + 17} ${y - 9} ${x + 15} ${y - 18}" stroke="#f8fafc" stroke-width="3" stroke-linecap="round" fill="none"/>
          <path d="M${x - 9} ${y - 8}Q${x} ${y - 12} ${x + 9} ${y - 8}L${x + 7} ${y + 5}Q${x} ${y + 15} ${x - 7} ${y + 5}Z" fill="#111827"/>
          <ellipse cx="${x}" cy="${y + 7}" rx="4.5" ry="3" fill="#374151"/><circle cx="${x - 4}" cy="${y - 2}" r="1.5" fill="#ffffff"/><circle cx="${x + 4}" cy="${y - 2}" r="1.5" fill="#ffffff"/>`,
        ([x, y]) => `<path d="M${x - 3} ${y + 15}Q${x - 11} ${y} ${x - 5} ${y - 15}" stroke="#ca8a04" stroke-width="1.6" fill="none"/>
          ${[[-9, 6], [-10, -1], [-8, -8], [-5, -14]].map(([dx, dy]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="1.9" ry="3.3" fill="#fbbf24" transform="rotate(-20 ${x + dx} ${y + dy})"/>`).join('')}
          <path d="M${x + 3} ${y + 15}Q${x + 10} ${y} ${x + 5} ${y - 12}" stroke="#65a30d" stroke-width="1.6" fill="none"/>
          <g fill="#ffffff"><circle cx="${x + 6}" cy="${y - 12}" r="3.6"/><circle cx="${x + 10}" cy="${y - 3}" r="3.3"/><circle cx="${x + 8}" cy="${y + 6}" r="3"/></g>`
      ];
      return svgDoc(VB, `${sparkle(178, 18, 5, '#fde68a')}${sparkle(20, 60, 4, '#ffffff', 0.8)}${sparkle(306, 50, 4, '#ffffff', 0.8)}
        ${pos.map((p, i) => badge(p, i) + sym[i](p)).join('')}`);
    },

    'hari-anak': () => svgDoc(VB, `
      <g transform="translate(286 38)"><circle r="18" fill="#fde047"/><path d="M0 -28v-6M0 28v6M-28 0h-6M28 0h6M-20 -20l-4 -4M20 20l4 4M-20 20l-4 4M20 -20l4 -4" stroke="#fde047" stroke-width="3" stroke-linecap="round"/></g>
      ${balloon(206, 78, 17, 21, '#f472b6', 226, 196)}${balloon(240, 64, 18, 22, '#facc15', 226, 196)}${balloon(270, 96, 16, 20, '#38bdf8', 226, 196)}${balloon(222, 116, 15, 19, '#4ade80', 226, 196)}
      <g transform="translate(96 54)"><polygon points="0,-30 22,0 0,30 -22,0" fill="#f43f5e"/><polygon points="0,-30 22,0 0,0" fill="#fde047"/><polygon points="0,0 -22,0 0,30" fill="#fde047"/>
        <path d="M0 -30V30M-22 0H22" stroke="#ffffff" stroke-opacity=".8" stroke-width="1.4"/>
        <path d="M0 30C8 46 -10 56 2 72S-6 96 4 110" stroke="#ffffff" stroke-opacity=".75" stroke-width="1.3" fill="none"/>
        <polygon points="-1,46 7,42 6,50" fill="#38bdf8"/><polygon points="0,66 -8,62 -7,70" fill="#4ade80"/><polygon points="1,88 9,84 8,92" fill="#f472b6"/></g>
      <g transform="translate(140 150) rotate(-12)"><polygon points="0,0 44,10 0,20 8,10" fill="#ffffff"/><polygon points="8,10 44,10 0,20" fill="#e2e8f0"/></g>
      ${star(160, 40, 6, '#ffffff', 0.85)}${sparkle(50, 140, 5, '#fde047')}`),

    'kemerdekaan': (ctx) => svgDoc(VB, `
      ${burst(66, 44, 24, '#fde68a', 12, 2)}${burst(138, 26, 16, '#ffffff', 10, 1.6)}${sparkle(170, 70, 5, '#ffffff', 0.9)}
      <rect x="194" y="18" width="5" height="176" rx="2" fill="#f8fafc"/><circle cx="196.5" cy="16" r="5" fill="#fbbf24"/>
      ${flagRI(199, 24, 112, 72, true)}
      <text x="104" y="104" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="800" letter-spacing="3" fill="#ffffff" fill-opacity=".9">HUT RI</text>
      <text x="104" y="180" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="80" font-weight="900"
        fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".9" stroke-width="2.2">${esc(String(ctx.hut))}</text>`),

    'hari-guru': () => svgDoc(VB, `
      <rect x="150" y="26" width="164" height="108" rx="7" fill="#92400e"/><rect x="158" y="34" width="148" height="92" rx="3" fill="#14532d"/>
      <text x="232" y="72" text-anchor="middle" font-family="'Trebuchet MS', Arial, sans-serif" font-size="16" font-style="italic" fill="#f8fafc">Terima kasih,</text>
      <text x="232" y="100" text-anchor="middle" font-family="'Trebuchet MS', Arial, sans-serif" font-size="24" font-weight="700" fill="#fef9c3">Guru!</text>
      ${heart(282, 110, 6, '#fda4af')}<path d="M196 110c12 4 30 4 44 0" stroke="#f8fafc" stroke-opacity=".7" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <rect x="170" y="134" width="124" height="6" rx="2" fill="#78350f"/><rect x="250" y="129" width="22" height="5" rx="2" fill="#f8fafc"/>
      <g><rect x="96" y="176" width="88" height="16" rx="3" fill="#f97316"/><rect x="104" y="162" width="76" height="14" rx="3" fill="#38bdf8"/><rect x="100" y="150" width="70" height="12" rx="3" fill="#facc15"/>
        <path d="M106 184h70M112 169h60M108 156h54" stroke="#ffffff" stroke-opacity=".6" stroke-width="1.4"/></g>
      ${apple(136, 134, 14)}
      ${blossom(60, 120, 7, '#fda4af')}${blossom(40, 160, 6, '#fde68a')}${sparkle(84, 70, 5, '#fde68a')}`),

    'natal': () => svgDoc(VB, `
      <ellipse cx="220" cy="196" rx="132" ry="14" fill="#ffffff" opacity=".35"/>
      <circle cx="232" cy="24" r="22" fill="#fde68a" opacity=".3"/>
      <g fill="#16a34a" stroke="#14532d" stroke-width="1.2" stroke-linejoin="round">
        <polygon points="232,30 204,78 260,78"/><polygon points="232,54 192,110 272,110"/><polygon points="232,84 178,146 286,146"/><polygon points="232,114 166,178 298,178"/></g>
      <path d="M204 78q14 8 28 0t28 0M192 110q20 9 40 0t40 0M178 146q27 10 54 0t54 0M166 178q33 10 66 0t66 0" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" fill="none"/>
      <rect x="222" y="178" width="20" height="16" fill="#7c2d12"/>
      ${star(232, 24, 13, '#fbbf24')}
      ${[[220, 70, '#ef4444'], [246, 92, '#fbbf24'], [212, 100, '#ffffff'], [252, 128, '#ef4444'], [206, 134, '#fbbf24'], [232, 120, '#38bdf8'], [196, 166, '#ef4444'], [268, 164, '#ffffff'], [232, 158, '#fbbf24']]
        .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="4.6" fill="${c}"/>`).join('')}
      <g><rect x="110" y="160" width="36" height="32" rx="2" fill="#f59e0b"/><rect x="125" y="160" width="6" height="32" fill="#ffffff"/><rect x="110" y="172" width="36" height="6" fill="#ffffff"/>
        <path d="M128 160c-8-10-16-4-10 0M128 160c8-10 16-4 10 0" stroke="#ffffff" stroke-width="3" fill="none"/></g>
      <g><rect x="146" y="172" width="28" height="20" rx="2" fill="#ffffff"/><rect x="157" y="172" width="6" height="20" fill="#dc2626"/></g>
      <g><rect x="292" y="176" width="24" height="18" rx="2" fill="#dc2626"/><rect x="301" y="176" width="6" height="18" fill="#fbbf24"/></g>
      ${flake(64, 40, 11, '#ffffff', 2, 0.8)}${flake(120, 92, 7, '#ffffff', 1.6, 0.7)}${flake(40, 124, 6, '#ffffff', 1.4, 0.65)}${flake(304, 46, 7, '#ffffff', 1.6, 0.75)}`)
  };

  /* ================================================================
   * Untaian / garland (ubin berulang horizontal, tinggi viewBox 40)
   * ==============================================================*/
  const sagY = (x, W, sag) => 3 + 4 * sag * (x / W) * (1 - x / W);
  const wire = (W, sag, c) => `<path d="M0 3Q${W / 2} ${3 + 2 * sag} ${W} 3" stroke="${c || '#ffffff'}" stroke-opacity=".8" stroke-width="1.4" fill="none"/>`;
  function bunting(colors, n, W) {
    const sag = 7, slot = W / n, fw = slot * 0.78;
    let s = wire(W, sag);
    for (let i = 0; i < n; i++) {
      const x0 = i * slot + (slot - fw) / 2, x1 = x0 + fw, xm = (x0 + x1) / 2;
      const c = colors[i % colors.length];
      s += `<polygon points="${r1(x0)},${r1(sagY(x0, W, sag))} ${r1(x1)},${r1(sagY(x1, W, sag))} ${r1(xm)},${r1(sagY(xm, W, sag) + 22)}" fill="${c}"${c.toLowerCase() === '#ffffff' ? ' stroke="#e5e7eb" stroke-width=".8"' : ''}/>`;
    }
    return svgDoc(`0 0 ${W} 40`, s);
  }
  function lights(colors, n, W) {
    const sag = 8, slot = W / n;
    let s = wire(W, sag, '#334155');
    for (let i = 0; i < n; i++) {
      const x = r1(i * slot + slot / 2), y = r1(sagY(x, W, sag)), c = colors[i % colors.length];
      s += `<circle cx="${x}" cy="${r1(y + 10)}" r="8" fill="${c}" opacity=".32"/><rect x="${r1(x - 2.2)}" y="${y}" width="4.4" height="4" rx="1" fill="#64748b"/>
        <ellipse cx="${x}" cy="${r1(y + 9.5)}" rx="3.6" ry="5.6" fill="${c}"/>`;
    }
    return svgDoc(`0 0 ${W} 40`, s);
  }
  function hangers(W, items) {
    const sag = 6;
    let s = wire(W, sag, '#fde68a');
    items.forEach(([x, len, draw]) => {
      const y = sagY(x, W, sag);
      s += `<line x1="${x}" y1="${r1(y)}" x2="${x}" y2="${r1(y + len)}" stroke="#fde68a" stroke-width="1.2"/>` + draw(x, y + len);
    });
    return svgDoc(`0 0 ${W} 40`, s);
  }
  const GARLAND = {
    'tahun-baru': () => lights(['#fbbf24', '#ffffff', '#a78bfa', '#f472b6'], 4, 120),
    'imlek': () => hangers(120, [[30, 3, (x, y) => lantern(x, r1(y), 9, 8, false)], [90, 9, (x, y) => lantern(x, r1(y), 7, 6, false)]]),
    'nyepi': () => {
      let s = '';
      for (let i = 0; i < 12; i++) s += `<rect x="${i * 8}" y="0" width="8" height="7" fill="${i % 2 ? '#f8fafc' : '#111827'}"/><rect x="${i * 8}" y="7" width="8" height="7" fill="${i % 2 ? '#111827' : '#f8fafc'}"/>`;
      for (let i = 0; i < 4; i++) { const x = 12 + i * 24; s += `<polygon points="${x - 7},14 ${x + 7},14 ${x + 3},26 ${x},34 ${x - 3},26" fill="#d9f99d" stroke="#65a30d" stroke-width=".8"/>`; }
      return svgDoc('0 0 96 40', s);
    },
    'idulfitri': () => hangers(120, [[30, 4, (x, y) => ketupat(x, r1(y + 10), 10)], [90, 8, (x, y) => crescent(x, r1(y + 8), 7, 4.5, '#fde68a') + star(x + 6, r1(y + 4), 3, '#fde68a')]]),
    'hardiknas': () => bunting(['#1e40af', '#fbbf24', '#ffffff', '#fbbf24'], 4, 120),
    'kenaikan': () => svgDoc('0 0 160 40', cloud(6, 22, 66, '#ffffff', 0.85) + cloud(84, 16, 70, '#ffffff', 0.7)),
    'waisak': () => bunting(['#2563eb', '#facc15', '#dc2626', '#ffffff', '#f97316'], 5, 150),
    'iduladha': () => hangers(120, [[30, 6, (x, y) => crescent(x, r1(y + 8), 8, 5, '#fde68a')], [90, 10, (x, y) => star(x, r1(y + 6), 6, '#fde68a')]]),
    'pancasila': () => bunting(['#dc2626', '#ffffff', '#fbbf24', '#ffffff'], 4, 120),
    'hari-anak': () => bunting(['#f43f5e', '#f59e0b', '#facc15', '#22c55e', '#38bdf8', '#a855f7'], 6, 150),
    'kemerdekaan': () => bunting(['#dc2626', '#ffffff'], 4, 120),
    'hari-guru': () => bunting(['#0d9488', '#f97316', '#facc15', '#ffffff'], 4, 120),
    'natal': () => lights(['#ef4444', '#22c55e', '#fbbf24', '#38bdf8'], 4, 120)
  };

  /* ================================================================
   * Pola latar (ubin 80×80, satu warna, transparan)
   * ==============================================================*/
  const PATTERN = {
    'tahun-baru': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${sparkle(20, 22, 7, c)}${sparkle(60, 60, 4, c)}<circle cx="62" cy="18" r="1.6" fill="${c}"/></g>`),
    'imlek': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}"><circle cx="20" cy="20" r="8" fill="none" stroke="${c}" stroke-width="2"/><rect x="17.5" y="17.5" width="5" height="5" fill="${c}"/>${blossom(60, 60, 6, c)}</g>`),
    'nyepi': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${sparkle(22, 20, 5, c)}<circle cx="60" cy="56" r="1.8" fill="${c}"/><circle cx="44" cy="70" r="1.2" fill="${c}"/><circle cx="68" cy="22" r="1.2" fill="${c}"/></g>`),
    'idulfitri': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}" fill="none" stroke="${c}" stroke-width="1.6"><rect x="14" y="14" width="12" height="12"/><rect x="14" y="14" width="12" height="12" transform="rotate(45 20 20)"/></g><g opacity="${o}">${star(60, 60, 4, c)}</g>`),
    'hardiknas': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}"><path d="M20 16c-4-3-10-3-14-1v12c4-2 10-2 14 1c4-3 10-3 14-1V15c-4-2-10-2-14 1ZM20 16v12" fill="none" stroke="${c}" stroke-width="1.6"/><circle cx="60" cy="60" r="2" fill="${c}"/></g>`),
    'kenaikan': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${cloud(8, 26, 26, c)}<circle cx="60" cy="60" r="1.8" fill="${c}"/>${sparkle(62, 22, 3.5, c)}</g>`),
    'waisak': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}" fill="none" stroke="${c}" stroke-width="1.5"><path d="M20 28c-6-4-8-10-6-16c4 2 6 6 6 10c0-5 2-9 6-12c2 6 0 12-6 18Z"/><path d="M10 28h20"/></g><g opacity="${o}"><circle cx="60" cy="60" r="2" fill="${c}"/></g>`),
    'iduladha': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${crescent(18, 22, 8, 5, c)}${star(30, 16, 3, c)}<circle cx="60" cy="60" r="1.8" fill="${c}"/></g>`),
    'pancasila': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${star(20, 20, 6, c)}${star(60, 60, 4, c)}</g>`),
    'hari-anak': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"><circle cx="18" cy="18" r="5"/><path d="M54 60l6-10l6 10Z"/><path d="M16 60q4-6 8 0t8 0"/></g>`),
    'kemerdekaan': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}"><rect x="14" y="14" width="16" height="5" fill="${c}"/><rect x="14.5" y="19" width="15" height="5" fill="none" stroke="${c}"/><path d="M14 13v16" stroke="${c}" stroke-width="1.2"/>${star(60, 60, 4, c)}</g>`),
    'hari-guru': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${heart(20, 20, 6, c)}<circle cx="60" cy="60" r="2" fill="${c}"/></g>`),
    'natal': (c, o) => svgDoc('0 0 80 80', `<g opacity="${o}">${flake(20, 20, 8, c, 1.5)}${flake(60, 58, 4.5, c, 1.2)}<circle cx="62" cy="20" r="1.6" fill="${c}"/></g>`)
  };

  /* ================================================================
   * Ikon berwarna 48×48 (kartu ucapan, pita, kartu admin, lencana logo)
   * ==============================================================*/
  const IV = '0 0 48 48';
  const ICON = {
    'tahun-baru': () => svgDoc(IV, `${burst(22, 26, 17, '#f59e0b', 12, 2.2)}${sparkle(38, 10, 6, '#a78bfa')}<circle cx="22" cy="26" r="3" fill="#f472b6"/>`),
    'imlek': () => svgDoc(IV, lantern(24, 4, 15, 13, false)),
    'nyepi': () => svgDoc(IV, `<g transform="translate(-2 -3) scale(.2)">${candiHalf(118, 240, -1, '#1f2937', '#d4a017')}${candiHalf(142, 240, 1, '#1f2937', '#d4a017')}</g>${sparkle(24, 9, 4, '#d4a017')}`),
    'idulfitri': () => svgDoc(IV, `${ketupat(22, 24, 15)}${star(39, 11, 5, '#f59e0b')}`),
    'hardiknas': () => svgDoc(IV, `${mortarboard(24, 22, 20)}${sparkle(40, 38, 4, '#f59e0b')}`),
    'kenaikan': () => svgDoc(IV, `<g fill="#fbbf24" opacity=".7"><polygon points="24,2 20,22 28,22"/><polygon points="8,8 18,24 22,20"/><polygon points="40,8 30,24 26,20"/></g>
      <g fill="#f59e0b"><rect x="22" y="6" width="4" height="18" rx="1"/><rect x="16" y="11" width="16" height="4" rx="1"/></g>${cloud(6, 38, 36, '#e0f2fe')}<path d="M6 38h36" stroke="#7dd3fc" stroke-width="1.4"/>`),
    'waisak': () => svgDoc(IV, lotus(24, 36, 30, '#fbcfe8', '#ec4899')),
    'iduladha': () => svgDoc(IV, `${crescent(21, 24, 16, 9, '#ca8a04')}${star(36, 15, 6, '#f59e0b')}`),
    'pancasila': () => svgDoc(IV, `<circle cx="24" cy="24" r="21" fill="#b91c1c"/>${star(24, 25, 15, '#fbbf24')}`),
    'kemerdekaan': () => svgDoc(IV, `<rect x="8" y="4" width="3" height="40" rx="1.5" fill="#94a3b8"/>${flagRI(11, 8, 30, 20, true)}`),
    'hari-anak': () => svgDoc(IV, `${balloon(18, 16, 9, 11, '#f472b6', 24, 46)}${balloon(31, 20, 9, 11, '#facc15', 24, 46)}`.replace(/#ffffff" stroke-opacity/g, '#94a3b8" stroke-opacity')),
    'hari-guru': () => svgDoc(IV, apple(24, 27, 15)),
    'natal': () => svgDoc(IV, `<g fill="#16a34a"><polygon points="24,8 13,22 35,22"/><polygon points="24,15 9,32 39,32"/></g><rect x="21" y="32" width="6" height="8" fill="#92400e"/>
      ${star(24, 8, 6, '#fbbf24')}<circle cx="19" cy="26" r="2.2" fill="#ef4444"/><circle cx="29" cy="20" r="2" fill="#fbbf24"/><circle cx="30" cy="28" r="2.2" fill="#ffffff"/>`)
  };

  /* ================================================================
   * Partikel animasi: jenis gerak + bentuk (maks. 4 bentuk per tema)
   *  fall = jatuh • rise = naik • twinkle = berkelip • burst = meletup
   * ==============================================================*/
  const PV = '0 0 24 24';
  const FX = {
    'tahun-baru': { kind: 'burst', n: 7, size: [48, 104], dur: [3.8, 6.8],
      shapes: () => [svgDoc(PV, burst(12, 12, 10.5, '#fbbf24', 12, 1)), svgDoc(PV, burst(12, 12, 10.5, '#f472b6', 10, 1)), svgDoc(PV, burst(12, 12, 10.5, '#ffffff', 12, 0.9)), svgDoc(PV, burst(12, 12, 10.5, '#a78bfa', 10, 1))] },
    'imlek': { kind: 'fall', n: 14, size: [10, 18], dur: [9, 15],
      shapes: () => [svgDoc(PV, blossom(12, 12, 6, '#fbcfe8')), svgDoc(PV, blossom(12, 12, 6, '#f9a8d4')), svgDoc(PV, `<circle cx="12" cy="12" r="9" fill="#fbbf24" stroke="#b45309" stroke-width="1.4"/><rect x="9.5" y="9.5" width="5" height="5" fill="#b45309"/>`)] },
    'nyepi': { kind: 'twinkle', n: 16, size: [5, 12], dur: [4, 8],
      shapes: () => [svgDoc(PV, sparkle(12, 12, 11, '#ffffff')), svgDoc(PV, '<circle cx="12" cy="12" r="5" fill="#ffffff"/>'), svgDoc(PV, sparkle(12, 12, 11, '#fde68a'))] },
    'idulfitri': { kind: 'twinkle', n: 16, size: [7, 15], dur: [3.5, 7],
      shapes: () => [svgDoc(PV, star(12, 12, 11, '#fde68a')), svgDoc(PV, sparkle(12, 12, 11, '#ffffff')), svgDoc(PV, crescent(11, 12, 10, 6, '#fde68a'))] },
    'hardiknas': { kind: 'rise', n: 12, size: [12, 22], dur: [11, 18],
      shapes: () => [svgDoc(PV, mortarboard(12, 10, 10)), svgDoc(PV, sparkle(12, 12, 11, '#fde68a')), svgDoc(PV, star(12, 12, 11, '#ffffff'))] },
    'kenaikan': { kind: 'rise', n: 16, size: [6, 14], dur: [10, 17],
      shapes: () => [svgDoc(PV, '<defs><radialGradient id="g"><stop offset="0" stop-color="#fffbeb"/><stop offset=".55" stop-color="#fef3c7" stop-opacity=".7"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></radialGradient></defs><circle cx="12" cy="12" r="12" fill="url(#g)"/>'), svgDoc(PV, sparkle(12, 12, 11, '#ffffff'))] },
    'waisak': { kind: 'rise', n: 12, size: [14, 26], dur: [14, 22],
      shapes: () => [svgDoc(PV, '<circle cx="12" cy="12" r="11" fill="#fde68a" opacity=".35"/><rect x="7" y="5.5" width="10" height="13" rx="3" fill="#fdba74"/><rect x="7" y="5.5" width="10" height="2.6" rx="1" fill="#c2410c"/><rect x="9.5" y="9.5" width="5" height="6" rx="1.5" fill="#fef3c7" opacity=".8"/>'), svgDoc(PV, lotus(12, 18, 14, '#fbcfe8', '#f472b6'))] },
    'iduladha': { kind: 'twinkle', n: 14, size: [7, 14], dur: [4, 7.5],
      shapes: () => [svgDoc(PV, star(12, 12, 11, '#fde68a')), svgDoc(PV, sparkle(12, 12, 11, '#ffffff')), svgDoc(PV, crescent(11, 12, 10, 6, '#fde68a'))] },
    'pancasila': { kind: 'twinkle', n: 14, size: [8, 16], dur: [3.5, 7],
      shapes: () => [svgDoc(PV, star(12, 12, 11, '#fbbf24')), svgDoc(PV, star(12, 12, 11, '#ffffff')), svgDoc(PV, sparkle(12, 12, 11, '#fde68a'))] },
    'hari-anak': { kind: 'rise', n: 10, size: [18, 30], dur: [12, 19],
      shapes: () => ['#f472b6', '#facc15', '#38bdf8', '#4ade80'].map(c => svgDoc(PV, `<ellipse cx="12" cy="9" rx="7" ry="8.5" fill="${c}"/><ellipse cx="9.4" cy="6.2" rx="1.6" ry="2.4" fill="#ffffff" opacity=".5"/><polygon points="10.5,18.2 13.5,18.2 12,16.6" fill="${c}"/><path d="M12 18.4q-2 2.6 0 5.6" stroke="#ffffff" stroke-width=".8" fill="none"/>`)) },
    'kemerdekaan': { kind: 'fall', n: 18, size: [7, 13], dur: [7, 12],
      shapes: () => [svgDoc(PV, '<rect x="5" y="8" width="14" height="8" rx="1.5" fill="#ef4444"/>'), svgDoc(PV, '<rect x="5" y="8" width="14" height="8" rx="1.5" fill="#ffffff"/>'), svgDoc(PV, star(12, 12, 11, '#fde68a')), svgDoc(PV, '<rect x="7" y="4" width="10" height="16" rx="1.5" fill="#fecaca"/>')] },
    'hari-guru': { kind: 'fall', n: 12, size: [10, 17], dur: [9, 15],
      shapes: () => [svgDoc(PV, heart(12, 12, 8, '#fda4af')), svgDoc(PV, blossom(12, 12, 6, '#fde68a')), svgDoc(PV, blossom(12, 12, 6, '#fdba74'))] },
    'natal': { kind: 'fall', n: 18, size: [8, 18], dur: [9, 16],
      shapes: () => [svgDoc(PV, flake(12, 12, 10.5, '#ffffff', 1.4)), svgDoc(PV, '<circle cx="12" cy="12" r="5" fill="#ffffff"/>'), svgDoc(PV, flake(12, 12, 10, '#e0f2fe', 1.6))] }
  };

  /* ================================================================
   * Katalog tema
   *  c.p  warna utama (teks/tautan/tombol, kontras ≥ 4.5:1 dengan putih)
   *  c.s  warna kedua • c.a aksen • c.k warna utama di mode gelap
   *  c.h  3 warna gradien hero (cukup gelap untuk teks putih)
   *  c.cta tombol CTA halaman masuk [terang, tengah, gelap, tinta]
   *  sky/ksky, ground/kground, orb/korb, star, win: langit kampus halaman masuk
   *  season: bulan (0–11) terakhir musim hari besar → menentukan tahun
   *          "yang akan datang" saat dipratinjau jauh sebelum harinya.
   * Urutan mengikuti kalender (Idulfitri/Iduladha bergeser tiap tahun).
   * ==============================================================*/
  const THEMES = [
    {
      id: 'tahun-baru', name: 'Tahun Baru Masehi', season: 0,
      date: { fixed: [0, 1] }, dateText: 'Setiap 1 Januari',
      desc: 'Malam pergantian tahun yang meriah: langit gelap berbintang, kembang api emas, dan untaian lampu.',
      elements: ['Kembang api', 'Langit malam berbintang', 'Jam tengah malam', 'Untaian lampu emas', 'Angka tahun baru'],
      c: { p: '#1e3a8a', s: '#7c3aed', a: '#f59e0b', k: '#3b5bdb', h: ['#0b1437', '#1e1b4b', '#5b21b6'], cta: ['#fde68a', '#fbbf24', '#f59e0b', '#3f2a06'],
        sky: ['#1e1b4b', '#4c1d95'], ksky: ['#0b0f2a', '#1e1b4b'], orb: '#fde68a', korb: '#fde68a', star: 1 },
      greet: (x) => ({ eyebrow: `1 Januari ${x.y}`, title: `Selamat Tahun Baru ${x.y}`,
        text: 'Lembaran baru, semangat baru. Semoga setiap langkah belajar tahun ini membawamu makin dekat ke kampus impian.' }),
      points: () => ['Resolusi belajar', 'Target baru', 'Semangat baru']
    },
    {
      id: 'imlek', name: 'Tahun Baru Imlek', season: 1,
      date: { lunar: true }, dateText: 'Hari pertama kalender Imlek (Januari–Februari) · ditetapkan pemerintah',
      desc: 'Nuansa merah–emas pembawa keberuntungan dengan lampion, bunga mei, dan koin emas.',
      elements: ['Lampion merah', 'Bunga mei (plum)', 'Koin emas keberuntungan', 'Nuansa merah–emas', 'Shio & unsur tahun'],
      c: { p: '#c8102e', s: '#b45309', a: '#f59e0b', k: '#dc2626', h: ['#7f1d1d', '#b91c1c', '#b45309'], cta: ['#fde68a', '#fbbf24', '#f59e0b', '#450a0a'],
        sky: ['#fca5a5', '#fef3c7'], ksky: ['#2a0a0a', '#451a03'], orb: '#fbbf24', korb: '#fde68a', flag: '#fbbf24',
        stripe: 'linear-gradient(90deg, #c8102e, #f59e0b 50%, #c8102e)' },
      greet: (x) => ({ eyebrow: `Tahun Baru Imlek ${x.y + 551} Kongzili`, title: 'Gong Xi Fa Cai! Selamat Tahun Baru Imlek',
        text: `Selamat menyambut Tahun ${SHIO[((x.y - 4) % 12 + 12) % 12]} ${UNSUR[((x.y - 4) % 10 + 10) % 10]}. Semoga tahun ini membawa kesehatan, rezeki, dan keberhasilan belajar.` }),
      points: () => ['Lampion merah', 'Bunga mei', 'Angpao keberuntungan']
    },
    {
      id: 'nyepi', name: 'Hari Raya Nyepi', season: 2,
      date: { lunar: true }, dateText: 'Sehari setelah Tilem Kesanga (Maret) · Tahun Baru Saka · ditetapkan pemerintah',
      desc: 'Tenang dan hening: langit tilem tanpa bulan, jendela padam (Amati Geni), candi bentar berkain poleng.',
      elements: ['Candi bentar', 'Kain poleng', 'Canang sari & dupa', 'Langit tilem tanpa bulan', 'Jendela padam (Amati Geni)', 'Catur Brata Penyepian'],
      c: { p: '#334155', s: '#a16207', a: '#d4a017', k: '#a16207', h: ['#0b1120', '#1e293b', '#3b2f13'], cta: ['#fde68a', '#eab308', '#ca8a04', '#2b1d03'],
        sky: ['#0f172a', '#1e293b'], ksky: ['#020617', '#0f172a'], orb: 'rgba(0,0,0,0)', korb: 'rgba(0,0,0,0)', star: 1,
        win: ['#334155', '#475569'], stripe: 'repeating-linear-gradient(90deg, #111827 0 10px, #f8fafc 10px 20px)' },
      greet: (x) => ({ eyebrow: `Tahun Baru Saka ${x.y - 78}`, title: 'Selamat Hari Raya Nyepi',
        text: 'Dalam keheningan kita merenung, menjernihkan hati, dan memulai lembaran baru dengan damai.' }),
      points: () => ['Amati Geni · tanpa api & cahaya', 'Amati Karya · tidak bekerja', 'Amati Lelungan · tidak bepergian', 'Amati Lelanguan · tanpa hiburan']
    },
    {
      id: 'idulfitri', name: 'Hari Raya Idulfitri', season: 3,
      date: { lunar: true }, dateText: '1 Syawal (kalender Hijriah) · ditetapkan pemerintah',
      desc: 'Hijau–emas yang teduh: masjid, bulan sabit & bintang, serta ketupat yang bergelantungan.',
      elements: ['Masjid & menara', 'Bulan sabit & bintang', 'Ketupat', 'Nuansa hijau–emas', 'Ucapan mohon maaf lahir dan batin'],
      c: { p: '#047857', s: '#0f766e', a: '#ca8a04', k: '#08875f', h: ['#064e3b', '#047857', '#a16207'], cta: ['#fde68a', '#fbbf24', '#d97706', '#3f2a06'],
        sky: ['#a7f3d0', '#ecfdf5'], ksky: ['#022c22', '#064e3b'], orb: '#fde68a', korb: '#fef3c7' },
      greet: (x) => ({ eyebrow: x.hijriFitri ? `1 Syawal ${x.hijriFitri} H` : '1 Syawal', title: 'Selamat Hari Raya Idulfitri',
        text: 'Taqabbalallahu minna wa minkum. Mohon maaf lahir dan batin — semoga kita kembali fitri dan makin semangat belajar.' }),
      points: () => ['Mohon maaf lahir & batin', 'Silaturahmi', 'Kembali fitri']
    },
    {
      id: 'hardiknas', name: 'Hari Pendidikan Nasional', season: 4,
      date: { fixed: [4, 2] }, dateText: 'Setiap 2 Mei · hari lahir Ki Hajar Dewantara',
      desc: 'Biru–emas akademis dengan buku terbuka, toga, pensil, dan trilogi kepemimpinan Ki Hajar Dewantara.',
      elements: ['Buku terbuka', 'Toga wisuda', 'Pensil', 'Trilogi Ki Hajar Dewantara', 'Nuansa biru–emas'],
      c: { p: '#1d4ed8', s: '#0369a1', a: '#d4a017', k: '#2563eb', h: ['#172554', '#1e40af', '#a16207'], cta: ['#fde68a', '#fbbf24', '#f59e0b', '#3f2a06'],
        sky: ['#bfdbfe', '#eff6ff'] },
      greet: (x) => ({ eyebrow: `2 Mei ${x.y}`, title: 'Selamat Hari Pendidikan Nasional',
        text: 'Mengenang Ki Hajar Dewantara, Bapak Pendidikan Nasional. Mari terus belajar, berbagi ilmu, dan saling menguatkan.' }),
      points: () => ['Ing Ngarsa Sung Tuladha', 'Ing Madya Mangun Karsa', 'Tut Wuri Handayani']
    },
    {
      id: 'kenaikan', name: 'Kenaikan Yesus Kristus', season: 5,
      date: { kind: 'kenaikan' }, dateText: 'Kamis, 40 hari setelah Paskah',
      desc: 'Biru langit yang damai dengan awan, berkas cahaya dari atas, dan salib.',
      elements: ['Awan', 'Berkas cahaya dari langit', 'Salib', 'Nuansa biru langit'],
      c: { p: '#0369a1', s: '#0284c7', a: '#f59e0b', k: '#0477b8', h: ['#0c4a6e', '#0369a1', '#0284c7'], cta: ['#fef3c7', '#fde68a', '#fbbf24', '#3f2a06'],
        sky: ['#bae6fd', '#f0f9ff'], ksky: ['#082f49', '#0c4a6e'], orb: '#fffbeb', korb: '#fef9c3' },
      greet: (x) => ({ eyebrow: `Kenaikan Yesus Kristus · ${fmtLong(x.kenaikan)}`, title: 'Selamat Memperingati Kenaikan Yesus Kristus',
        text: 'Semoga damai, pengharapan, dan kasih-Nya menyertai kita dalam setiap langkah.' }),
      points: () => ['Damai', 'Pengharapan', 'Kasih']
    },
    {
      id: 'waisak', name: 'Hari Raya Waisak', season: 5,
      date: { lunar: true }, dateText: 'Purnama bulan Waisak (Mei–Juni) · ditetapkan pemerintah',
      desc: 'Senja jingga keunguan dengan stupa di bawah bulan purnama, teratai, dan lampion terbang.',
      elements: ['Stupa (Borobudur)', 'Bulan purnama', 'Bunga teratai', 'Lampion terbang', 'Warna bendera Buddhis'],
      c: { p: '#c2410c', s: '#a21caf', a: '#eab308', k: '#c2410c', h: ['#431407', '#9a3412', '#6b21a8'], cta: ['#fef08a', '#facc15', '#eab308', '#422006'],
        sky: ['#fed7aa', '#fdf4ff'], ksky: ['#1e1036', '#2a1446'], orb: '#fef9c3', korb: '#fef9c3',
        stripe: 'linear-gradient(90deg, #2563eb 0 20%, #facc15 20% 40%, #dc2626 40% 60%, #ffffff 60% 80%, #f97316 80% 100%)' },
      greet: (x) => ({ eyebrow: `Waisak ${x.y + 544} BE`, title: 'Selamat Hari Raya Waisak',
        text: 'Semoga semua makhluk hidup berbahagia — Sabbe satta bhavantu sukhitatta.' }),
      points: () => ['Cinta kasih (metta)', 'Welas asih (karuna)', 'Kebijaksanaan (panna)']
    },
    {
      id: 'iduladha', name: 'Hari Raya Iduladha', season: 5,
      date: { lunar: true }, dateText: '10 Zulhijah (kalender Hijriah) · ditetapkan pemerintah',
      desc: 'Zaitun–pasir yang hangat dengan bulan sabit, kubah masjid, dan hewan kurban.',
      elements: ['Bulan sabit & bintang', 'Kubah & menara masjid', 'Hewan kurban (domba)', 'Nuansa zaitun–pasir'],
      c: { p: '#4d7c0f', s: '#a16207', a: '#d4a017', k: '#4d7c0f', h: ['#1a2e05', '#3f6212', '#92400e'], cta: ['#fde68a', '#fbbf24', '#d97706', '#3f2a06'],
        sky: ['#fde68a', '#fffbeb'], ksky: ['#1c1917', '#292524'], orb: '#fbbf24', korb: '#fef3c7' },
      greet: (x) => ({ eyebrow: x.hijriAdha ? `10 Zulhijah ${x.hijriAdha} H` : '10 Zulhijah', title: 'Selamat Hari Raya Iduladha',
        text: 'Semangat berkurban, berbagi, dan ikhlas. Semoga kepedulian kita membawa berkah bagi sesama.' }),
      points: () => ['Ikhlas', 'Berbagi', 'Peduli sesama']
    },
    {
      id: 'pancasila', name: 'Hari Lahir Pancasila', season: 5,
      date: { fixed: [5, 1] }, dateText: 'Setiap 1 Juni',
      desc: 'Merah–putih–emas dengan lima simbol sila Pancasila: bintang, rantai, pohon beringin, kepala banteng, padi & kapas.',
      elements: ['Bintang', 'Rantai', 'Pohon beringin', 'Kepala banteng', 'Padi & kapas', 'Nuansa merah–putih–emas'],
      c: { p: '#a16207', s: '#b91c1c', a: '#ca8a04', k: '#a16207', h: ['#7f1d1d', '#991b1b', '#a16207'], cta: ['#fde68a', '#fbbf24', '#f59e0b', '#3f2a06'],
        sky: ['#fee2e2', '#fffbeb'], stripe: 'linear-gradient(90deg, #b91c1c, #ca8a04 50%, #b91c1c)' },
      greet: (x) => ({ eyebrow: `1 Juni ${x.y}`, title: 'Selamat Hari Lahir Pancasila',
        text: 'Pancasila dasar negara dan pemersatu bangsa. Mari amalkan nilai-nilainya dalam belajar dan keseharian.' }),
      points: () => ['1 · Ketuhanan Yang Maha Esa', '2 · Kemanusiaan yang adil dan beradab', '3 · Persatuan Indonesia',
        '4 · Kerakyatan yang dipimpin oleh hikmat kebijaksanaan dalam permusyawaratan/perwakilan', '5 · Keadilan sosial bagi seluruh rakyat Indonesia']
    },
    {
      id: 'hari-anak', name: 'Hari Anak Nasional', season: 6,
      date: { fixed: [6, 23] }, dateText: 'Setiap 23 Juli',
      desc: 'Ceria dan penuh warna: balon, layang-layang, pesawat kertas, dan umbul-umbul pelangi.',
      elements: ['Balon warna-warni', 'Layang-layang', 'Pesawat kertas', 'Matahari ceria', 'Umbul-umbul pelangi'],
      c: { p: '#2563eb', s: '#db2777', a: '#f59e0b', k: '#2563eb', h: ['#1d4ed8', '#7c3aed', '#db2777'], cta: ['#fef08a', '#facc15', '#f59e0b', '#422006'],
        sky: ['#bae6fd', '#fef9c3'], stripe: 'linear-gradient(90deg, #f43f5e, #f59e0b, #facc15, #22c55e, #38bdf8, #a855f7)' },
      greet: (x) => ({ eyebrow: `23 Juli ${x.y}`, title: 'Selamat Hari Anak Nasional',
        text: 'Anak Indonesia ceria, berani bermimpi, dan terus belajar. Masa depan bangsa ada di tangan kalian!' }),
      points: () => ['Ceria', 'Berani bermimpi', 'Terlindungi']
    },
    {
      id: 'kemerdekaan', name: 'Hari Proklamasi Kemerdekaan RI', season: 7,
      date: { fixed: [7, 17] }, dateText: 'Setiap 17 Agustus · HUT Republik Indonesia',
      desc: 'Merah putih berkibar: bendera, umbul-umbul, angka HUT RI, kembang api, dan konfeti merah putih.',
      elements: ['Bendera Merah Putih berkibar', 'Umbul-umbul merah putih', 'Angka HUT RI', 'Kembang api', 'Konfeti merah putih'],
      c: { p: '#dc2626', s: '#991b1b', a: '#ef4444', k: '#dc2626', h: ['#7f1d1d', '#b91c1c', '#dc2626'], cta: ['#ffffff', '#ffffff', '#f1f5f9', '#b91c1c'],
        sky: ['#bfdbfe', '#eff6ff'], stripe: 'linear-gradient(#dc2626 0 50%, #ffffff 50% 100%)' },
      greet: (x) => ({ eyebrow: `17 Agustus ${x.y}`, title: `Dirgahayu Republik Indonesia ke-${x.hut}`,
        text: 'Merdeka! Mari isi kemerdekaan dengan semangat belajar, berprestasi, dan berkarya untuk negeri.' }),
      points: () => ['Merah Putih', 'Semangat juang', 'Persatuan']
    },
    {
      id: 'hari-guru', name: 'Hari Guru Nasional', season: 10,
      date: { fixed: [10, 25] }, dateText: 'Setiap 25 November',
      desc: 'Hangat dan penuh terima kasih: papan tulis "Terima kasih, Guru!", apel, tumpukan buku, dan kelopak bunga.',
      elements: ['Papan tulis "Terima kasih, Guru!"', 'Apel untuk guru', 'Tumpukan buku & kapur', 'Kelopak bunga & hati'],
      c: { p: '#0f766e', s: '#ea580c', a: '#facc15', k: '#0d8379', h: ['#134e4a', '#0f766e', '#c2410c'], cta: ['#fed7aa', '#fb923c', '#ea580c', '#431407'],
        sky: ['#ccfbf1', '#fff7ed'] },
      greet: (x) => ({ eyebrow: `25 November ${x.y}`, title: 'Selamat Hari Guru Nasional',
        text: 'Terima kasih, Guru dan Tutor, atas ilmu, kesabaran, dan ketulusan dalam membimbing kami.' }),
      points: () => ['Terima kasih, Guru', 'Pelita ilmu', 'Ketulusan']
    },
    {
      id: 'natal', name: 'Hari Raya Natal', season: 11,
      date: { fixed: [11, 25] }, dateText: 'Setiap 25 Desember',
      desc: 'Merah–hijau–emas yang hangat dengan pohon Natal, bintang, kado, salju turun, dan tanah bersalju.',
      elements: ['Pohon Natal', 'Bintang Betlehem', 'Salju turun', 'Kado', 'Lampu Natal', 'Kampus bersalju'],
      c: { p: '#b91c1c', s: '#166534', a: '#d97706', k: '#dc2626', h: ['#7f1d1d', '#991b1b', '#14532d'], cta: ['#fde68a', '#fbbf24', '#f59e0b', '#3f2a06'],
        sky: ['#dbeafe', '#f1f5f9'], ksky: ['#0f172a', '#1e293b'], ground: ['#f8fafc', '#e2e8f0'], kground: ['#cbd5e1', '#94a3b8'],
        orb: '#fef3c7', korb: '#f1f5f9', stripe: 'linear-gradient(90deg, #b91c1c, #166534 50%, #b91c1c)' },
      greet: () => ({ eyebrow: '25 Desember', title: 'Selamat Hari Natal',
        text: 'Damai dan sukacita Natal menyertai kita semua. Semoga kasih-Nya menerangi setiap langkah.' }),
      points: () => ['Damai', 'Sukacita', 'Kasih']
    }
  ];
  const MAP = {};
  THEMES.forEach(t => { MAP[t.id] = t; });

  /** Konteks tahun untuk teks & ilustrasi (tahun hari besar terdekat). */
  function ctxFor(t, now) {
    const y = now.getFullYear() + (now.getMonth() > t.season + 1 ? 1 : 0);
    const h = hijri(now);
    let ken = ascension(now.getFullYear());
    if (daysBetween(ken, now) > 7) ken = ascension(now.getFullYear() + 1);
    return {
      y, hut: y - 1945, kenaikan: ken,
      // Idulfitri (bulan 10): setelah Syawal berlalu, yang terdekat adalah tahun Hijriah berikutnya.
      hijriFitri: h ? (h.m >= 11 ? h.y + 1 : h.y) : null,
      // Iduladha (bulan 12, bulan terakhir): selalu tahun Hijriah berjalan.
      hijriAdha: h ? h.y : null
    };
  }
  function occurrence(t, year) {
    if (t.date.fixed) return new Date(year, t.date.fixed[0], t.date.fixed[1]);
    if (t.date.kind === 'kenaikan') return ascension(year);
    return null;
  }
  function nextOccurrence(t, today) {
    for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
      const d = occurrence(t, y);
      if (d && daysBetween(today, d) >= 0) return d;
    }
    return null;
  }
  function lastOccurrence(t, today) {
    for (const y of [today.getFullYear(), today.getFullYear() - 1]) {
      const d = occurrence(t, y);
      if (d && daysBetween(d, today) >= 0) return d;
    }
    return null;
  }
  /** Keterangan tanggal untuk kartu admin. */
  function dateLabel(t, now) {
    if (t.date.kind === 'kenaikan') {
      const d = nextOccurrence(t, dayStart(now));
      return d ? `${fmtLong(d)} · 40 hari setelah Paskah` : t.dateText;
    }
    return t.dateText;
  }

  /* ================================================================
   * Keadaan (state)
   * ==============================================================*/
  let current = normalize(null);  // keadaan yang sedang terpasang di halaman ini
  let previewing = '';            // id tema yang sedang dipratinjau admin (tidak disimpan)
  let lastRemote = null;          // keadaan dari /health (halaman masuk mode server)
  let ready = false;              // data pengaturan sudah dapat dipercaya
  let navCtx = null;              // { key, content, user } halaman dashboard terakhir

  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const id = typeof r.id === 'string' && Object.prototype.hasOwnProperty.call(MAP, r.id) ? r.id : '';
    return { id, effects: r.effects !== false, banner: r.banner !== false, title: clip(r.title, MAX_TITLE), text: clip(r.text, MAX_TEXT) };
  }
  function settings() {
    try { return DB.getSettings(); } catch (e) { return {}; }
  }
  function messagesOf(st) {
    const m = st && st.holidayMessages;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  }
  function messageFor(st, id) {
    const m = messagesOf(st)[id];
    return m && typeof m === 'object' ? { title: clip(m.title, MAX_TITLE), text: clip(m.text, MAX_TEXT) } : { title: '', text: '' };
  }
  function fromSettings(st, idOverride) {
    const s = st || {};
    const id = idOverride != null ? idOverride : s.holidayTheme;
    const msg = messageFor(s, id);
    return normalize({ id, effects: s.holidayEffects, banner: s.holidayBanner, title: msg.title, text: msg.text });
  }
  const sameState = (a, b) => a.id === b.id && a.effects === b.effects && a.banner === b.banner && a.title === b.title && a.text === b.text;
  /** Halaman masuk mode server: data lms_settings tidak dimuat, sumbernya /health. */
  const serverLanding = () => !!(global.Sync && Sync.isServer && Sync.isServer() && Sync.page !== 'dashboard');
  const isLanding = () => !!(document.body && document.body.classList.contains('lp-body'));
  const isDashboard = () => !!(document.body && document.body.classList.contains('dash-body'));
  function cachedState() {
    const c = readJson(CACHE_KEY);
    return c && c.v === CACHE_VER ? normalize(c) : normalize(null);
  }
  function savedState() {
    if (serverLanding()) return lastRemote || cachedState();
    return fromSettings(settings());
  }

  function prefs() {
    const p = readJson(PREF_KEY);
    return p && typeof p === 'object' ? p : {};
  }
  function setPref(patch) { writeJson(PREF_KEY, Object.assign(prefs(), patch)); }
  /** Ucapan yang ditutup akan muncul lagi pada tahun berikutnya. */
  const dismissToken = (t) => t.id + ':' + ctxFor(t, new Date()).y;
  const isDismissed = (t) => (prefs().dismiss || {})[t.id] === dismissToken(t);
  function dismiss(t) {
    const d = Object.assign({}, prefs().dismiss || {});
    d[t.id] = dismissToken(t);
    setPref({ dismiss: d });
  }
  function fxAllowed() {
    return !!current.id && current.effects && !prefs().noFx && !reducedMotion()
      && !(document.body && document.body.classList.contains('exam-mode'));
  }

  /* ================================================================
   * Pemasangan tema pada <html>
   * ==============================================================*/
  function buildVars(t, ctx) {
    const c = t.c, v = {};
    v['--hd-1'] = c.p; v['--hd-2'] = c.s; v['--hd-3'] = c.a; v['--hd-k1'] = c.k || c.p;
    v['--hd-h0'] = c.h[0]; v['--hd-h1'] = c.h[1]; v['--hd-h2'] = c.h[2];
    if (c.cta) { v['--hd-c0'] = c.cta[0]; v['--hd-c1'] = c.cta[1]; v['--hd-c2'] = c.cta[2]; v['--hd-cink'] = c.cta[3]; }
    const pair = (arr, a, b) => { if (arr) { v[a] = arr[0]; v[b] = arr[1]; } };
    pair(c.sky, '--hd-sky0', '--hd-sky1'); pair(c.ksky, '--hd-ksky0', '--hd-ksky1');
    pair(c.ground, '--hd-ground0', '--hd-ground1'); pair(c.kground, '--hd-kground0', '--hd-kground1');
    pair(c.win, '--hd-win0', '--hd-win1');
    if (c.orb) v['--hd-orb'] = c.orb;
    if (c.korb) v['--hd-korb'] = c.korb;
    if (c.star != null) v['--hd-star'] = String(c.star);
    if (c.flag) v['--hd-flag'] = c.flag;
    if (c.stripe) v['--hd-stripe'] = c.stripe;
    v['--hd-art'] = cssUrl(ART[t.id](ctx));
    v['--hd-garland'] = cssUrl(GARLAND[t.id]());
    v['--hd-pattern'] = cssUrl(PATTERN[t.id](c.p, 0.05));
    v['--hd-pattern-k'] = cssUrl(PATTERN[t.id]('#ffffff', 0.04));
    v['--hd-badge'] = cssUrl(ICON[t.id]());
    return v;
  }
  function setMetaColor(color) {
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m) return;
    if (m.dataset.hdOrig == null) m.dataset.hdOrig = m.getAttribute('content') || '';
    m.setAttribute('content', color || m.dataset.hdOrig);
  }
  /** Pasang/lepas atribut & variabel. Mengembalikan variabel yang dipasang (untuk cache). */
  function paintRoot(state) {
    const root = document.documentElement;
    // Hapus semua --hd-* (termasuk yang dipasang skrip pra-render di <head>).
    Array.prototype.slice.call(root.style).forEach(k => { if (k.indexOf('--hd-') === 0) root.style.removeProperty(k); });
    const t = MAP[state.id];
    if (!t) {
      root.removeAttribute('data-holiday');
      setMetaColor('');
      return null;
    }
    const vars = buildVars(t, ctxFor(t, new Date()));
    Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));
    root.setAttribute('data-holiday', t.id);
    setMetaColor(t.c.h[1]);
    return vars;
  }
  /**
   * Terapkan keadaan. opts.preview → jangan tulis cache (pratinjau admin / cache awal).
   * opts.force → pasang ulang walau keadaan sama.
   */
  function applyState(state, opts) {
    const o = opts || {};
    const next = normalize(state);
    if (!o.force && sameState(next, current) && document.documentElement.hasAttribute('data-holiday') === !!next.id) return false;
    current = next;
    const vars = paintRoot(next);
    if (!o.preview) {
      writeJson(CACHE_KEY, vars ? { v: CACHE_VER, id: next.id, effects: next.effects, banner: next.banner, title: next.title, text: next.text, vars } : null);
    }
    redecorate();
    return true;
  }

  /* ================================================================
   * Dekorasi DOM
   * ==============================================================*/
  const HERO_SEL = '.welcome-hero:not(.bd-hero):not(.hub-hero)';
  const shapeCache = {};

  function clearDecor() {
    document.querySelectorAll('.hd-fx, .hd-ribbon, .hd-greet[data-live]').forEach(el => el.remove());
    document.querySelectorAll('[data-hd-fx]').forEach(el => el.removeAttribute('data-hd-fx'));
  }
  function redecorate() {
    if (!document.body) return;
    clearDecor();
    if (!current.id) return;
    if (isLanding()) decorateLanding();
    scanHeroes(document);
    if (navCtx && navCtx.key === 'overview' && navCtx.content && navCtx.content.isConnected) mountGreeting(navCtx.content);
  }

  function setFall(layer) {
    const h = layer.clientHeight || (layer.parentNode && layer.parentNode.clientHeight) || 300;
    layer.style.setProperty('--fall', Math.round(h + 60) + 'px');
  }
  /** Buat lapisan partikel di dalam host. */
  function spawn(host, cls, scale) {
    const fx = FX[current.id];
    if (!fx || !host) return null;
    const urls = shapeCache[current.id] || (shapeCache[current.id] = fx.shapes().slice(0, 4).map(cssUrl));
    const layer = document.createElement('div');
    layer.className = `hd-fx hd-fx--${fx.kind} ${cls}`;
    layer.setAttribute('aria-hidden', 'true');
    urls.forEach((u, i) => layer.style.setProperty('--hd-s' + i, u));
    const small = (global.innerWidth || 1024) < 640;
    const n = Math.max(4, Math.round(fx.n * scale * (small ? 0.6 : 1)));
    const rnd = (a, b) => a + Math.random() * (b - a);
    let html = '';
    for (let i = 0; i < n; i++) {
      const d = rnd(fx.dur[0], fx.dur[1]);
      html += `<i class="hd-p s${i % urls.length}" style="--x:${rnd(3, 97).toFixed(1)}%;--y:${rnd(6, 82).toFixed(1)}%;--s:${rnd(fx.size[0], fx.size[1]).toFixed(1)}px;`
        + `--d:${d.toFixed(2)}s;--dl:${(-rnd(0, d)).toFixed(2)}s;--dr:${rnd(-36, 36).toFixed(0)}px;--rot:${rnd(-220, 220).toFixed(0)}deg;--o:${rnd(0.55, 0.95).toFixed(2)}"></i>`;
    }
    layer.innerHTML = html;
    host.appendChild(layer);
    setFall(layer);
    return layer;
  }
  /** Tambahkan partikel ke setiap hero sambutan yang belum dihias. */
  function scanHeroes(root) {
    if (!current.id || !fxAllowed()) return;
    (root || document).querySelectorAll(HERO_SEL).forEach(h => {
      if (h.getAttribute('data-hd-fx') === current.id) return;
      Array.prototype.slice.call(h.children).forEach(ch => { if (ch.classList.contains('hd-fx')) ch.remove(); });
      h.setAttribute('data-hd-fx', current.id);
      spawn(h, 'hd-fx-hero', 1);
    });
  }

  /* ---------------- Kartu ucapan ---------------- */
  function greetingData(t, state) {
    const g = t.greet(ctxFor(t, new Date()));
    return { eyebrow: g.eyebrow, title: state.title || g.title, text: state.text || g.text, points: t.points ? t.points() : [] };
  }
  function iconImg(t, size) {
    return `<img src="${dataUri(ICON[t.id]())}" alt="" width="${size}" height="${size}" decoding="async" />`;
  }
  function greetingHtml(t, state, preview) {
    const g = greetingData(t, state);
    const canFx = state.effects && !reducedMotion();
    return `<section class="hd-greet" ${preview ? 'data-preview="1"' : 'data-live="1"'} data-hd-id="${t.id}" aria-label="${esc('Ucapan ' + t.name)}">
      <div class="hd-greet-ic" aria-hidden="true">${iconImg(t, 46)}</div>
      <div class="hd-greet-body">
        <div class="hd-greet-eyebrow">${esc(g.eyebrow)}</div>
        <h3>${esc(g.title)}</h3>
        <p>${esc(g.text)}</p>
        ${g.points.length ? `<ul class="hd-chips">${g.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>
      ${preview ? '' : `<div class="hd-greet-actions">
        ${canFx ? `<button type="button" class="btn btn-ghost btn-sm" data-hd-fxtoggle aria-pressed="${prefs().noFx ? 'true' : 'false'}">${prefs().noFx ? '✨ Nyalakan animasi' : '⏸ Matikan animasi'}</button>` : ''}
        <button type="button" class="icon-btn" data-hd-dismiss aria-label="Tutup ucapan" title="Tutup ucapan">&times;</button>
      </div>`}
    </section>`;
  }
  function mountGreeting(content) {
    if (!content || !current.id || !current.banner) return;
    const t = MAP[current.id];
    if (!t || isDismissed(t)) return;
    content.querySelectorAll('.hd-greet[data-live]').forEach(el => el.remove());
    const wrap = document.createElement('div');
    wrap.innerHTML = greetingHtml(t, current, false);
    const el = wrap.firstElementChild;
    const hero = content.querySelector('.welcome-hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(el, hero);
    else content.insertBefore(el, content.firstChild);
    el.querySelector('[data-hd-dismiss]').addEventListener('click', () => {
      dismiss(t);
      el.remove();
      if (global.UI && UI.toast) UI.toast('Ucapan ditutup. Tema tetap aktif.', 'info');
    });
    const fxBtn = el.querySelector('[data-hd-fxtoggle]');
    if (fxBtn) fxBtn.addEventListener('click', () => {
      setPref({ noFx: !prefs().noFx });
      redecorate();
      const again = document.querySelector('.hd-greet[data-live] [data-hd-fxtoggle]');
      if (again) try { again.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    });
  }

  /* ---------------- Halaman masuk ---------------- */
  function decorateLanding() {
    const t = MAP[current.id];
    if (!t) return;
    const wrap = document.querySelector('.lp-wrap');
    if (wrap && current.banner && !isDismissed(t)) {
      const g = greetingData(t, current);
      const el = document.createElement('div');
      el.className = 'hd-ribbon';
      el.setAttribute('role', 'note');
      el.setAttribute('aria-label', 'Ucapan hari besar');
      el.innerHTML = `<span class="hd-ribbon-ic" aria-hidden="true">${iconImg(t, 24)}</span>
        <span class="hd-ribbon-txt"><b>${esc(g.title)}</b><span class="hd-ribbon-sub"> — ${esc(g.text)}</span></span>
        <button type="button" class="hd-x" aria-label="Tutup ucapan" title="Tutup">&times;</button>`;
      wrap.insertBefore(el, wrap.firstChild);
      el.querySelector('.hd-x').addEventListener('click', () => { dismiss(t); el.remove(); });
    }
    const hero = document.querySelector('.lp-hero');
    if (hero && fxAllowed()) spawn(hero, 'hd-fx-lp', 1.5);
  }

  /* ---------------- Pengamat konten dashboard ---------------- */
  let mo = null, moRaf = 0;
  function observeContent() {
    const content = document.getElementById('content');
    if (!content || mo || !('MutationObserver' in global)) return;
    mo = new MutationObserver(() => {
      if (moRaf || !current.id) return;
      moRaf = requestAnimationFrame(() => { moRaf = 0; scanHeroes(content); });
    });
    mo.observe(content, { childList: true, subtree: true });
  }

  /* ================================================================
   * Halaman admin: Tema Hari Besar
   * ==============================================================*/
  let adminView = null;   // { container, user }

  function rerender() {
    if (adminView && adminView.container && adminView.container.isConnected) renderAdmin(adminView.container, adminView.user);
  }
  function reapply() {
    if (previewing) preview(previewing);
    else applyState(savedState(), { force: true });
  }
  function activate(id) {
    const t = MAP[id];
    if (!t) return;
    if (!UI.confirmDialog(`Aktifkan tema "${t.name}" untuk seluruh pengguna sekarang?\n\nTema langsung terlihat di halaman masuk dan semua dashboard.`)) return;
    DB.setSetting('holidayTheme', id);
    previewing = '';
    applyState(savedState(), { force: true });
    UI.toast(`Tema ${t.name} aktif untuk semua pengguna.`, 'success');
    rerender();
    global.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  function deactivate() {
    const t = MAP[fromSettings(settings()).id];
    if (!t) return;
    if (!UI.confirmDialog(`Kembalikan LMS ke tema bawaan?\n\nTema "${t.name}" dilepas dari semua perangkat.`)) return;
    DB.setSetting('holidayTheme', '');
    previewing = '';
    applyState(savedState(), { force: true });
    UI.toast('Tema bawaan LMS Rubela dipakai kembali.', 'info');
    rerender();
  }
  function openMessage(id) {
    const t = MAP[id];
    if (!t) return;
    const cur = messageFor(settings(), id);
    const def = t.greet(ctxFor(t, new Date()));
    UI.modal.open(`Ucapan — ${t.name}`, `
      <form id="hdMsgForm" class="form" novalidate>
        <p class="muted small" style="margin-top:0;">Ucapan ini tampil di kartu Overview semua peran dan di pita halaman masuk saat tema
          <strong>${esc(t.name)}</strong> aktif. Kosongkan kolom untuk memakai ucapan bawaan (teks abu-abu).</p>
        <div class="form-group"><label for="hdMsgTitle">Judul ucapan</label>
          <input id="hdMsgTitle" maxlength="${MAX_TITLE}" value="${esc(cur.title)}" placeholder="${esc(def.title)}" /></div>
        <div class="form-group"><label for="hdMsgText">Pesan</label>
          <textarea id="hdMsgText" rows="4" maxlength="${MAX_TEXT}" placeholder="${esc(def.text)}">${esc(cur.text)}</textarea>
          <div class="muted small"><span id="hdMsgCount">${cur.text.length}</span>/${MAX_TEXT} karakter</div></div>
        <div class="flex-gap">
          <button type="submit" class="btn btn-primary">Simpan Ucapan</button>
          <button type="button" class="btn btn-secondary" id="hdMsgReset" ${cur.title || cur.text ? '' : 'disabled'}>Pakai ucapan bawaan</button>
        </div>
      </form>`);
    const form = document.getElementById('hdMsgForm');
    const txt = document.getElementById('hdMsgText');
    const count = document.getElementById('hdMsgCount');
    txt.addEventListener('input', () => { count.textContent = String(txt.value.length); });
    const save = (title, text) => {
      const map = Object.assign({}, messagesOf(settings()));
      if (title || text) map[id] = { title, text };
      else delete map[id];
      DB.setSetting('holidayMessages', map);
      UI.modal.close();
      UI.toast(title || text ? `Ucapan ${t.name} disimpan.` : `Ucapan ${t.name} kembali ke bawaan.`, 'success');
      reapply();
      rerender();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save(clip(document.getElementById('hdMsgTitle').value, MAX_TITLE), clip(txt.value, MAX_TEXT));
    });
    document.getElementById('hdMsgReset').addEventListener('click', () => save('', ''));
  }

  function reminderHtml(saved, now) {
    const today = dayStart(now);
    const parts = [];
    const act = MAP[saved.id];
    if (act && (act.date.fixed || act.date.kind)) {
      const last = lastOccurrence(act, today), next = nextOccurrence(act, today);
      const since = last ? daysBetween(last, today) : null, until = next ? daysBetween(today, next) : null;
      if (since != null && since > 3 && since <= 60 && (until == null || until > 7)) {
        parts.push(`<div class="alert alert-warning hd-alert"><span>⏰ Tema <strong>${esc(act.name)}</strong> masih aktif, padahal hari besarnya sudah lewat ${since} hari.</span>
          <button type="button" class="btn btn-secondary btn-sm" data-hd-off>Kembalikan ke tema bawaan</button></div>`);
      }
    }
    const list = THEMES.filter(t => t.date.fixed || t.date.kind)
      .map(t => { const d = nextOccurrence(t, today); return d ? { t, d, n: daysBetween(today, d) } : null; })
      .filter(Boolean).sort((a, b) => a.n - b.n);
    const todays = list.filter(x => x.n === 0);
    if (todays.length) {
      todays.forEach(x => parts.push(`<div class="alert alert-success hd-alert"><span>🎉 Hari ini <strong>${esc(x.t.name)}</strong> (${esc(fmtLong(x.d))}).</span>
        ${saved.id === x.t.id ? '<span class="badge badge-success">Tema sudah aktif</span>' : `<button type="button" class="btn btn-primary btn-sm" data-hd-on="${x.t.id}">Aktifkan sekarang</button>`}</div>`));
    } else if (list.length) {
      const x = list[0];
      parts.push(`<div class="alert alert-info hd-alert"><span>📅 Hari besar bertanggal tetap terdekat: <strong>${esc(x.t.name)}</strong> — ${esc(fmtLong(x.d))} (${x.n === 1 ? 'besok' : x.n + ' hari lagi'}).</span>
        ${saved.id === x.t.id || previewing === x.t.id ? '' : `<button type="button" class="btn btn-secondary btn-sm" data-hd-preview="${x.t.id}">👁️ Pratinjau</button>`}</div>`);
    }
    parts.push(`<p class="muted small hd-note">Idulfitri, Iduladha, Imlek, Nyepi, dan Waisak mengikuti kalender lunar dan tanggalnya ditetapkan pemerintah setiap tahun (SKB 3 Menteri).
      Cek kalender libur nasional tahun berjalan, lalu aktifkan temanya pada hari tersebut.</p>`);
    return parts.join('');
  }

  function cardHtml(t, saved, st, now) {
    const isActive = saved.id === t.id, isPrev = previewing === t.id;
    const custom = messageFor(st, t.id);
    return `<article class="hd-card${isActive ? ' is-active' : ''}${isPrev ? ' is-preview' : ''}" aria-label="${esc(t.name)}">
      <div class="hd-card-prev" data-hd-prev="${t.id}">
        <span class="hd-card-ic" aria-hidden="true">${iconImg(t, 34)}</span>
        ${isActive ? '<span class="hd-tag">● Aktif</span>' : isPrev ? '<span class="hd-tag is-prev">Pratinjau</span>' : ''}
      </div>
      <div class="hd-card-body">
        <h4>${esc(t.name)}</h4>
        <div class="hd-card-date">${esc(dateLabel(t, now))}</div>
        <p class="muted small">${esc(t.desc)}</p>
        <ul class="hd-elems" aria-label="Unsur tema">${t.elements.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
        <div class="hd-card-actions">
          ${isActive ? '<button type="button" class="btn btn-secondary btn-sm" data-hd-off>Nonaktifkan</button>'
            : `<button type="button" class="btn btn-primary btn-sm" data-hd-on="${t.id}">Aktifkan</button>`}
          ${isActive ? '' : isPrev ? '<button type="button" class="btn btn-secondary btn-sm" data-hd-endprev>Akhiri pratinjau</button>'
            : `<button type="button" class="btn btn-secondary btn-sm" data-hd-preview="${t.id}">👁️ Pratinjau</button>`}
          <button type="button" class="btn btn-ghost btn-sm" data-hd-msg="${t.id}">✏️ Ucapan${custom.title || custom.text ? '<span class="hd-dot" title="Memakai ucapan kustom"></span>' : ''}</button>
        </div>
      </div>
    </article>`;
  }
  /** Isi gradien + ilustrasi mini setiap kartu (variabel di-set lewat JS, bukan atribut style). */
  function paintPreviews(root, now) {
    root.querySelectorAll('[data-hd-prev]').forEach(el => {
      const t = MAP[el.getAttribute('data-hd-prev')];
      if (!t) return;
      el.style.setProperty('--pv0', t.c.h[0]);
      el.style.setProperty('--pv1', t.c.h[1]);
      el.style.setProperty('--pv2', t.c.h[2]);
      el.style.setProperty('--pv-art', cssUrl(ART[t.id](ctxFor(t, now))));
      el.style.setProperty('--pv-garland', cssUrl(GARLAND[t.id]()));
    });
  }

  function renderAdmin(container, user) {
    adminView = { container, user };
    const st = settings();
    const saved = fromSettings(st);
    const now = new Date();
    const active = MAP[saved.id];
    const shown = MAP[previewing] || active;
    const pv = MAP[previewing];
    container.innerHTML = `
      <section class="welcome-hero hd-admin-hero">
        <span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">🎉 Tema Hari Besar Nasional</div>
          <h2>${active ? `Tema aktif: ${esc(active.name)}` : 'Tema bawaan sedang dipakai'}</h2>
          <p class="wh-sub">Ubah suasana seluruh LMS — halaman masuk serta dashboard admin, tutor, mentee, dan orang tua — sesuai hari besar nasional.
            Tema <strong>tidak berganti otomatis</strong>: aktifkan saat harinya tiba, lalu kembalikan ke tema bawaan setelah selesai.</p>
          <div class="wh-chips"><span class="wh-chip">${THEMES.length} tema hari besar</span><span class="wh-chip">Tersinkron ke semua perangkat</span><span class="wh-chip">Mode terang &amp; gelap</span></div>
        </div>
      </section>
      ${pv ? `<div class="hd-previewbar" role="status">
        <span>👁️ Pratinjau <strong>${esc(pv.name)}</strong> — hanya terlihat di perangkat Anda dan belum disimpan.</span>
        <div class="flex-gap"><button type="button" class="btn btn-primary btn-sm" data-hd-on="${pv.id}">Aktifkan untuk semua</button>
          <button type="button" class="btn btn-secondary btn-sm" data-hd-endprev>Akhiri pratinjau</button></div></div>` : ''}
      ${reminderHtml(saved, now)}
      <div class="card hd-status">
        <div class="card-header">${UI.secHead('🎨', 'Tema yang sedang aktif', 'berlaku untuk semua pengguna di semua perangkat')}</div>
        <div class="hd-status-row">
          <div class="hd-mini"${active ? ` data-hd-prev="${active.id}"` : ''}>${active ? iconImg(active, 40) : '<span class="hd-mini-def" aria-hidden="true">R</span>'}</div>
          <div class="hd-status-info">
            <strong>${active ? esc(active.name) : 'Tema bawaan LMS Rubela'}</strong>
            <div class="muted small">${active ? esc(dateLabel(active, now)) : 'Warna indigo standar tanpa dekorasi hari besar.'}</div>
            ${active ? `<div class="flex-gap hd-status-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-hd-off>↩︎ Kembalikan ke tema bawaan</button>
              <button type="button" class="btn btn-ghost btn-sm" data-hd-msg="${active.id}">✏️ Ubah ucapan</button></div>` : ''}
          </div>
        </div>
        <div class="hd-opts">
          <label class="check-row"><input type="checkbox" id="hdFx" ${saved.effects ? 'checked' : ''} /> Tampilkan animasi dekorasi (salju, kembang api, lampion, balon, dan lainnya)</label>
          <label class="check-row"><input type="checkbox" id="hdBanner" ${saved.banner ? 'checked' : ''} /> Tampilkan kartu ucapan di Overview dan pita ucapan di halaman masuk</label>
          <p class="muted small">Animasi tidak diputar bagi pengguna yang mengaktifkan "kurangi gerakan" di perangkatnya dan selama ujian berlangsung.
            Setiap pengguna juga dapat mematikan animasi atau menutup ucapan dari kartu ucapannya sendiri.</p>
        </div>
      </div>
      ${shown ? `<div class="card">
        <div class="card-header">${UI.secHead('💌', 'Pratinjau kartu ucapan', 'tampil di Overview semua peran; versi singkatnya menjadi pita di halaman masuk')}</div>
        ${greetingHtml(shown, pv ? fromSettings(st, pv.id) : saved, true)}</div>` : ''}
      <div class="card">
        <div class="card-header">${UI.secHead('🗓️', 'Pilih tema', 'urut sesuai kalender · pratinjau hanya terlihat di perangkat Anda')}</div>
        <div class="hd-grid">${THEMES.map(t => cardHtml(t, saved, st, now)).join('')}</div>
      </div>`;
    paintPreviews(container, now);

    container.querySelectorAll('[data-hd-on]').forEach(b => b.addEventListener('click', () => activate(b.getAttribute('data-hd-on'))));
    container.querySelectorAll('[data-hd-off]').forEach(b => b.addEventListener('click', deactivate));
    container.querySelectorAll('[data-hd-preview]').forEach(b => b.addEventListener('click', () => {
      const t = MAP[b.getAttribute('data-hd-preview')];
      if (!t) return;
      preview(t.id);
      rerender();
      global.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      UI.toast(`Pratinjau ${t.name} — belum disimpan.`, 'info');
    }));
    container.querySelectorAll('[data-hd-endprev]').forEach(b => b.addEventListener('click', () => { endPreview(); rerender(); }));
    container.querySelectorAll('[data-hd-msg]').forEach(b => b.addEventListener('click', () => openMessage(b.getAttribute('data-hd-msg'))));
    const fx = container.querySelector('#hdFx');
    fx.addEventListener('change', () => {
      DB.setSetting('holidayEffects', fx.checked);
      UI.toast(fx.checked ? 'Animasi dekorasi dinyalakan.' : 'Animasi dekorasi dimatikan untuk semua pengguna.', 'info');
      reapply();
      rerender();
    });
    const bn = container.querySelector('#hdBanner');
    bn.addEventListener('change', () => {
      DB.setSetting('holidayBanner', bn.checked);
      UI.toast(bn.checked ? 'Kartu & pita ucapan ditampilkan.' : 'Kartu & pita ucapan disembunyikan.', 'info');
      reapply();
      rerender();
    });
  }

  /* ================================================================
   * API publik & inisialisasi
   * ==============================================================*/
  /** Baca ulang pengaturan (mis. setelah sinkronisasi dari perangkat lain). */
  function refresh() {
    if (previewing || !ready) return false;
    return applyState(savedState());
  }
  /** Halaman masuk mode server: terapkan tema dari respons /health. */
  function applyRemote(h) {
    if (!serverLanding()) return false;
    lastRemote = normalize(h);
    ready = true;
    return applyState(lastRemote);
  }
  /** Pratinjau lokal (admin) — tidak disimpan & tidak ditulis ke cache. */
  function preview(id) {
    if (!MAP[id]) return;
    previewing = id;
    applyState(fromSettings(settings(), id), { preview: true, force: true });
  }
  function endPreview() {
    if (!previewing) return;
    previewing = '';
    applyState(savedState(), { force: true });
  }
  /** Dipanggil js/dashboard.js setiap kali halaman berganti. */
  function onNavigate(key, content, user) {
    navCtx = { key, content, user };
    // Meninggalkan halaman admin mengakhiri pratinjau; redecorate() memasang ucapan & partikel.
    if (previewing && key !== ADMIN_KEY) { endPreview(); return; }
    if (key === 'overview') mountGreeting(content);
    scanHeroes(content);
  }

  function init() {
    // 1) Selaras dengan skrip pra-render: pasang segera dari cache perangkat.
    applyState(cachedState(), { preview: true, force: true });
    // 2) Ganti dengan pengaturan yang sah setelah data siap.
    const start = () => {
      if (isDashboard()) observeContent();
      if (serverLanding()) return;        // js/login.js memanggil applyRemote() setelah /health
      const go = () => { ready = true; refresh(); };
      if (global.Sync && Sync.whenReady) Sync.whenReady(go);
      else go();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    // Mode lokal: perubahan dari tab lain di peramban yang sama.
    global.addEventListener('storage', (e) => {
      if (e.key === 'lms_settings' && !(global.Sync && Sync.isServer && Sync.isServer())) refresh();
    });
    let rt = 0;
    global.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => document.querySelectorAll('.hd-fx').forEach(setFall), 200);
    });
  }

  global.HolidayTheme = {
    ADMIN_KEY,
    list: () => THEMES.map(t => ({ id: t.id, name: t.name, dateText: t.dateText, elements: t.elements.slice() })),
    get current() { return Object.assign({}, current); },
    get previewing() { return previewing; },
    refresh, applyRemote, onNavigate, renderAdmin, preview, endPreview,
    /* Untuk pengujian manual di konsol. */
    _test: {
      easter, ascension,
      greeting: (id, d) => (MAP[id] ? MAP[id].greet(ctxFor(MAP[id], d || new Date())) : null)
    }
  };

  init();
})(window);
