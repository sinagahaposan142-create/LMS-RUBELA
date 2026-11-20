/* =========================================================================
 * PTN — data Tools seleksi masuk kampus (diisi manual oleh admin).
 *
 *  lms_ptn_campuses     { id, name, short, city, province, type, website }
 *  lms_ptn_faculties    { id, campusId, name }
 *  lms_ptn_majors       { id, campusId, facultyId, name, level, year, capacity,
 *                         applicants, avgScore, minScore, subtests:{PU..PM}, source, notes }
 *  lms_admission_events { id, track, campusId, campusName, title, startDate, endDate,
 *                         link, notes, important }
 *  lms_utbk_plans       { userId, scores:{PU..PM}, choices:[majorId], reminders:[eventId],
 *                         notified:{eventId:['start','end']}, updatedAt }  (milik pengguna)
 *
 * Model peluang (bukan prediksi resmi SNPMB — dijelaskan di halaman kalkulator):
 *   skor kamu x  = rata-rata subtest yang diisi
 *   ambang c     = skor minimum diterima (bila diisi admin), selain itu
 *                  rata-rata diterima − 45
 *   ketidakpastian s = 30 (ambang dari skor minimum) atau 35 (dari rata-rata)
 *   peluang      = Φ((x − c) / s), dibatasi 1–99 %
 * s mewakili perubahan ambang antartahun dan selisih skor tryout dengan skor
 * UTBK sebenarnya.
 * Server memvalidasi bentuk data (api/_lib/rules.js → toolsProblem).
 * =======================================================================*/
(function (global) {
  'use strict';

  const K = { campus: 'lms_ptn_campuses', faculty: 'lms_ptn_faculties', major: 'lms_ptn_majors', event: 'lms_admission_events', plan: 'lms_utbk_plans' };
  const CODES = ['PU', 'PPU', 'PBM', 'PK', 'LBIND', 'LBING', 'PM'];
  const CAMPUS_TYPES = ['PTN', 'PTN-BH', 'PTKIN', 'Politeknik Negeri', 'Sekolah Kedinasan', 'PTS'];
  const LEVELS = ['S1', 'D4', 'D3'];
  const TRACKS = {
    SNBP: { label: 'SNBP', desc: 'Seleksi Nasional Berdasarkan Prestasi' },
    SNBT: { label: 'SNBT', desc: 'Seleksi Nasional Berdasarkan Tes (UTBK)' },
    MANDIRI: { label: 'Mandiri', desc: 'Seleksi mandiri kampus' },
    LAINNYA: { label: 'Lainnya', desc: 'Kedinasan, beasiswa, dan seleksi lain' }
  };
  const LEVELS_CHANCE = [
    { key: 'high', min: 80, label: 'Peluang tinggi' },
    { key: 'good', min: 55, label: 'Berpeluang' },
    { key: 'tight', min: 30, label: 'Kompetitif' },
    { key: 'risk', min: 0, label: 'Berisiko' }
  ];
  const MAX_CHOICES = 4;
  /** Nama subtest tanpa kode ganda: "Penalaran Umum (PU)" → "Penalaran Umum"; "Lit. Indonesia" tetap. */
  const subLabel = (s) => (s.short && s.short !== s.code ? s.short : String(s.name || s.code).replace(/\s*\([^)]*\)\s*$/, ''));

  /* ============================ penyimpanan ============================ */
  const load = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const text = (v, max) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  /** Angka dari isian (koma desimal diterima); kosong → null; di luar batas → NaN. */
  function num(v, lo, hi, int) {
    let s = String(v == null ? '' : v).trim().replace(/\s+/g, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) && (int || s.includes(','))) s = s.replace(/\./g, '').replace(',', '.');   // 1.234 / 1.234,5
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && (int || s.includes('.'))) s = s.replace(/,/g, '');            // 1,234 / 1,234.5
    else s = s.replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < lo || n > hi) return NaN;
    return int ? Math.round(n) : Math.round(n * 100) / 100;
  }
  const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
  const urlOk = (u) => !u || (/^https?:\/\/[^\s<>"']+$/i.test(u) && u.length <= 300);
  const guard = (actor) => { if (!actor || actor.role !== 'admin') throw new Error('Data ini hanya dapat dikelola admin.'); };
  const log = (action, detail, id) => { if (global.DB && DB.logActivity) DB.logActivity(action, detail, id); };

  /* ============================ kampus / fakultas / jurusan ============================ */
  const byName = (a, b) => a.name.localeCompare(b.name, 'id');
  const campuses = () => load(K.campus).sort(byName);
  const campus = (id) => load(K.campus).find(c => c.id === id) || null;
  const faculties = (campusId) => load(K.faculty).filter(f => !campusId || f.campusId === campusId).sort(byName);
  const faculty = (id) => load(K.faculty).find(f => f.id === id) || null;
  function majors(o) {
    const f = o || {};
    return load(K.major).filter(m => (!f.campusId || m.campusId === f.campusId) && (!f.facultyId || m.facultyId === f.facultyId)).sort(byName);
  }
  const major = (id) => load(K.major).find(m => m.id === id) || null;

  function saveCampus(rec, actor) {
    guard(actor);
    const name = text(rec.name, 120);
    if (name.length < 2) throw new Error('Nama kampus minimal 2 karakter.');
    const website = String(rec.website || '').trim();
    if (!urlOk(website)) throw new Error('Situs kampus harus diawali http:// atau https://');
    const list = load(K.campus);
    if (list.some(c => c.id !== rec.id && norm(c.name) === norm(name))) throw new Error(`Kampus "${name}" sudah ada.`);
    const out = {
      id: rec.id || uid('pc'), name, short: text(rec.short, 20), city: text(rec.city, 60), province: text(rec.province, 60),
      type: CAMPUS_TYPES.includes(rec.type) ? rec.type : 'PTN', website, updatedAt: Date.now()
    };
    const i = list.findIndex(c => c.id === out.id);
    if (i >= 0) list[i] = out; else list.push(out);
    save(K.campus, list);
    log('ptn.campus', `${i >= 0 ? 'Mengubah' : 'Menambah'} kampus "${name}"`, out.id);
    return out;
  }
  function deleteCampus(id, actor) {
    guard(actor);
    const c = campus(id);
    save(K.campus, load(K.campus).filter(x => x.id !== id));
    save(K.faculty, load(K.faculty).filter(f => f.campusId !== id));
    const gone = new Set(load(K.major).filter(m => m.campusId === id).map(m => m.id));
    save(K.major, load(K.major).filter(m => m.campusId !== id));
    // Jadwal mandiri kampus ini tetap ada (nama kampus tersimpan di jadwal).
    const evs = load(K.event);
    if (evs.some(e => e.campusId === id)) save(K.event, evs.map(e => (e.campusId === id ? Object.assign({}, e, { campusId: null }) : e)));
    dropChoices(gone);
    if (c) log('ptn.campus.delete', `Menghapus kampus "${c.name}" beserta ${gone.size} jurusan`, id);
  }
  function saveFaculty(rec, actor) {
    guard(actor);
    const name = text(rec.name, 120);
    if (name.length < 2) throw new Error('Nama fakultas minimal 2 karakter.');
    if (!campus(rec.campusId)) throw new Error('Pilih kampus untuk fakultas ini.');
    const list = load(K.faculty);
    if (list.some(f => f.id !== rec.id && f.campusId === rec.campusId && norm(f.name) === norm(name))) throw new Error(`Fakultas "${name}" sudah ada di kampus ini.`);
    const out = { id: rec.id || uid('pf'), campusId: rec.campusId, name, updatedAt: Date.now() };
    const i = list.findIndex(f => f.id === out.id);
    if (i >= 0) list[i] = out; else list.push(out);
    save(K.faculty, list);
    return out;
  }
  function deleteFaculty(id, actor) {
    guard(actor);
    save(K.faculty, load(K.faculty).filter(f => f.id !== id));
    const gone = new Set(load(K.major).filter(m => m.facultyId === id).map(m => m.id));
    save(K.major, load(K.major).filter(m => m.facultyId !== id));
    dropChoices(gone);
  }
  /**
   * Validasi + normalisasi jurusan; melempar Error berbahasa Indonesia.
   * look = pencari kampus/fakultas (impor memakai data yang belum tersimpan).
   */
  function cleanMajor(rec, look) {
    const L = look || { campus, faculty };
    const name = text(rec.name, 120);
    if (name.length < 2) throw new Error('Nama jurusan minimal 2 karakter.');
    const c = L.campus(rec.campusId);
    if (!c) throw new Error('Pilih kampus untuk jurusan ini.');
    const f = rec.facultyId ? L.faculty(rec.facultyId) : null;
    if (rec.facultyId && (!f || f.campusId !== c.id)) throw new Error('Fakultas tidak sesuai dengan kampus.');
    const field = (v, lo, hi, int, label) => { const n = num(v, lo, hi, int); if (Number.isNaN(n)) throw new Error(`${label} harus angka ${lo}–${hi}.`); return n; };
    const subtests = {};
    CODES.forEach(code => { subtests[code] = field(rec.subtests && rec.subtests[code], 0, 1000, false, 'Skor ' + code); });
    const out = {
      id: rec.id || uid('pm'), campusId: c.id, facultyId: f ? f.id : null, name,
      level: LEVELS.includes(rec.level) ? rec.level : 'S1',
      year: field(rec.year, 2000, 2100, true, 'Tahun data'),
      capacity: field(rec.capacity, 0, 100000, true, 'Daya tampung'),
      applicants: field(rec.applicants, 0, 10000000, true, 'Jumlah peminat'),
      avgScore: field(rec.avgScore, 0, 1000, false, 'Rata-rata skor'),
      minScore: field(rec.minScore, 0, 1000, false, 'Skor minimum'),
      subtests, source: text(rec.source, 200), notes: text(rec.notes, 500), updatedAt: Date.now()
    };
    if (out.avgScore == null && out.minScore == null) throw new Error('Isi rata-rata skor atau skor minimum diterima agar peluang bisa dihitung.');
    if (out.avgScore != null && out.minScore != null && out.minScore > out.avgScore) throw new Error('Skor minimum tidak boleh lebih besar dari rata-rata.');
    return out;
  }
  function saveMajor(rec, actor) {
    guard(actor);
    const out = cleanMajor(rec);
    const list = load(K.major);
    if (list.some(m => m.id !== out.id && m.campusId === out.campusId && m.facultyId === out.facultyId && norm(m.name) === norm(out.name) && m.level === out.level)) {
      throw new Error(`Jurusan "${out.name}" (${out.level}) sudah ada di fakultas ini.`);
    }
    const i = list.findIndex(m => m.id === out.id);
    if (i >= 0) list[i] = out; else list.push(out);
    save(K.major, list);
    return out;
  }
  function deleteMajor(id, actor) {
    guard(actor);
    save(K.major, load(K.major).filter(m => m.id !== id));
    dropChoices(new Set([id]));
  }
  /** Jurusan yang dihapus keluar dari pilihan tersimpan semua pengguna. */
  function dropChoices(ids) {
    if (!ids.size) return;
    const plans = load(K.plan);
    let changed = false;
    plans.forEach(p => {
      const next = (p.choices || []).filter(x => !ids.has(x));
      if (next.length !== (p.choices || []).length) { p.choices = next; p.updatedAt = Date.now(); changed = true; }
    });
    if (changed) save(K.plan, plans);
  }
  function majorLabel(m) {
    if (!m) return '';
    const c = campus(m.campusId);
    return `${m.name}${m.level && m.level !== 'S1' ? ' (' + m.level + ')' : ''} — ${c ? (c.short || c.name) : 'Kampus dihapus'}`;
  }

  /* ============================ model peluang ============================ */
  function erf(x) {
    const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return s * y;
  }
  const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  function summary(scores) {
    const vals = CODES.map(c => (scores && scores[c] != null && scores[c] !== '' ? Number(scores[c]) : null)).filter(v => v != null && Number.isFinite(v));
    const total = vals.reduce((a, b) => a + b, 0);
    return { filled: vals.length, complete: vals.length === CODES.length, total: Math.round(total * 100) / 100, avg: vals.length ? Math.round((total / vals.length) * 100) / 100 : null };
  }
  function levelOf(pct) { return LEVELS_CHANCE.find(l => pct >= l.min); }
  /** Perkiraan peluang satu jurusan untuk skor tertentu; null bila skor kosong. */
  function chance(scores, m) {
    const me = summary(scores);
    if (!m || me.avg == null) return null;
    const hasMin = m.minScore != null, hasAvg = m.avgScore != null;
    if (!hasMin && !hasAvg) return null;
    const cutoff = hasMin ? m.minScore : m.avgScore - 45;
    const spread = hasMin ? 30 : 35;
    const pct = Math.max(1, Math.min(99, Math.round(phi((me.avg - cutoff) / spread) * 100)));
    const sub = m.subtests || {};
    const gaps = CODES.map(code => {
      const mine = scores && scores[code] != null && scores[code] !== '' ? Number(scores[code]) : null;
      const theirs = sub[code] != null ? Number(sub[code]) : null;
      return { code, mine, theirs, diff: mine != null && theirs != null ? Math.round((mine - theirs) * 10) / 10 : null };
    });
    const subFilled = CODES.filter(c => sub[c] != null);
    const majorTotal = subFilled.length === CODES.length ? subFilled.reduce((a, c) => a + Number(sub[c]), 0) : (hasAvg ? m.avgScore * CODES.length : null);
    return {
      me, pct, level: levelOf(pct), cutoff: Math.round(cutoff * 10) / 10, spread, basis: hasMin ? 'min' : 'avg',
      vsAvg: hasAvg ? Math.round((me.avg - m.avgScore) * 10) / 10 : null,
      vsCut: Math.round((me.avg - cutoff) * 10) / 10,
      gaps, majorTotal: majorTotal != null ? Math.round(majorTotal * 10) / 10 : null, majorTotalExact: subFilled.length === CODES.length,
      ratio: m.capacity && m.applicants ? { rate: m.capacity / m.applicants, oneIn: Math.max(1, Math.round(m.applicants / m.capacity)) } : null
    };
  }
  /** Jurusan lain yang mirip (nama sama/serupa atau satu fakultas) dengan peluang lebih baik. */
  function alternatives(scores, m, limit) {
    if (!m) return [];
    const base = chance(scores, m);
    if (!base) return [];
    const words = norm(m.name).split(' ').filter(w => w.length > 3 && !['ilmu', 'teknik', 'pendidikan', 'program', 'studi'].includes(w));
    return load(K.major).filter(x => x.id !== m.id).map(x => {
      const nx = norm(x.name);
      const sameName = nx === norm(m.name);
      const related = sameName || words.some(w => nx.includes(w)) || (x.facultyId && x.facultyId === m.facultyId);
      if (!related) return null;
      const c = chance(scores, x);
      if (!c || c.pct < Math.max(55, base.pct + 10)) return null;
      return { major: x, chance: c, sameName };
    }).filter(Boolean)
      .sort((a, b) => (b.sameName - a.sameName) || (b.chance.pct - a.chance.pct) || ((b.major.avgScore || 0) - (a.major.avgScore || 0)))
      .slice(0, limit || 5);
  }
  /** Rata-rata skor IRT (200–800) per subtest dari 3 tryout LMS terakhir. */
  function tryoutScores(studentId) {
    if (!global.DB) return { scores: {}, attempts: 0 };
    const nameToCode = {};
    (DB.SUBTESTS || []).forEach(s => { nameToCode[s.name] = s.code; });
    const attempts = DB.getCbtAttempts().filter(a => a.studentId === studentId && a.submittedAt && a.scoring && Array.isArray(a.scoring.sections))
      .sort((a, b) => b.submittedAt - a.submittedAt);
    const bucket = {};
    attempts.forEach(a => a.scoring.sections.forEach(s => {
      const code = nameToCode[s.subtest];
      if (!code || s.scaled200_800 == null) return;
      bucket[code] = bucket[code] || [];
      if (bucket[code].length < 3) bucket[code].push(Number(s.scaled200_800));
    }));
    const scores = {};
    Object.keys(bucket).forEach(code => { scores[code] = Math.round(bucket[code].reduce((x, y) => x + y, 0) / bucket[code].length); });
    return { scores, attempts: attempts.length };
  }

  /* ============================ rencana pengguna ============================ */
  function plan(userId) {
    const p = load(K.plan).find(x => x.userId === userId);
    return Object.assign({ userId, scores: {}, choices: [], reminders: [], notified: {} }, p || {});
  }
  function savePlan(userId, patch) {
    if (!userId) return null;
    const list = load(K.plan);
    const i = list.findIndex(x => x.userId === userId);
    const cur = i >= 0 ? list[i] : { userId, scores: {}, choices: [], reminders: [], notified: {} };
    const next = Object.assign({}, cur, patch, { userId, updatedAt: Date.now() });
    const sc = {};
    CODES.forEach(c => { const n = num(next.scores && next.scores[c], 0, 1000, false); if (n != null && !Number.isNaN(n)) sc[c] = n; });
    next.scores = sc;
    next.choices = [...new Set((next.choices || []).filter(x => typeof x === 'string'))].slice(0, MAX_CHOICES);
    next.reminders = [...new Set((next.reminders || []).filter(x => typeof x === 'string'))].slice(0, 100);
    const nt = {};
    Object.keys(next.notified || {}).forEach(id => { if (next.reminders.includes(id)) nt[id] = (next.notified[id] || []).filter(x => x === 'start' || x === 'end'); });
    next.notified = nt;
    if (i >= 0) list[i] = next; else list.push(next);
    save(K.plan, list);
    return next;
  }

  /* ============================ jadwal seleksi ============================ */
  const events = () => load(K.event).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'id'));
  const event = (id) => load(K.event).find(e => e.id === id) || null;
  function saveEvent(rec, actor) {
    guard(actor);
    const title = text(rec.title, 160);
    if (title.length < 3) throw new Error('Judul jadwal minimal 3 karakter.');
    if (!TRACKS[rec.track]) throw new Error('Pilih jalur seleksi.');
    if (!ymdRe.test(rec.startDate || '')) throw new Error('Tanggal mulai wajib diisi.');
    const endDate = rec.endDate && ymdRe.test(rec.endDate) ? rec.endDate : rec.startDate;
    if (endDate < rec.startDate) throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
    const link = String(rec.link || '').trim();
    if (!urlOk(link)) throw new Error('Tautan harus diawali http:// atau https://');
    const c = rec.campusId ? campus(rec.campusId) : null;
    const out = {
      id: rec.id || uid('ae'), track: rec.track, campusId: c ? c.id : null,
      campusName: c ? c.name : text(rec.campusName, 120), title, startDate: rec.startDate, endDate,
      link, notes: text(rec.notes, 600), important: !!rec.important, updatedAt: Date.now()
    };
    const list = load(K.event);
    const i = list.findIndex(e => e.id === out.id);
    if (i >= 0) list[i] = out; else list.push(out);
    save(K.event, list);
    log('admission.save', `${i >= 0 ? 'Mengubah' : 'Menambah'} jadwal seleksi "${title}"`, out.id);
    return out;
  }
  function deleteEvent(id, actor) {
    guard(actor);
    const e = event(id);
    save(K.event, load(K.event).filter(x => x.id !== id));
    const plans = load(K.plan);
    if (plans.some(p => (p.reminders || []).includes(id))) {
      save(K.plan, plans.map(p => ((p.reminders || []).includes(id) ? Object.assign({}, p, { reminders: p.reminders.filter(x => x !== id), updatedAt: Date.now() }) : p)));
    }
    if (e) log('admission.delete', `Menghapus jadwal seleksi "${e.title}"`, id);
  }
  /** Selisih hari kalender (WIB/zona pengguna) dari hari ini ke tanggal ymd. */
  function daysUntil(ymd, today) {
    const t = today || (global.UI ? UI.todayYMD() : new Date().toISOString().slice(0, 10));
    const ms = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    return Math.round((ms(ymd) - ms(t)) / 86400000);
  }
  function eventState(ev, today) {
    const t = today || (global.UI ? UI.todayYMD() : '');
    if (ev.endDate < t) return 'past';
    if (ev.startDate <= t) return 'ongoing';
    return 'upcoming';
  }
  /** Berkas kalender .ics (acara sehari penuh, tanggal selesai eksklusif). */
  function icsFor(ev) {
    const d = (s) => s.replace(/-/g, '');
    const next = (s) => { const x = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + 1)); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
    const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const desc = [TRACKS[ev.track] ? TRACKS[ev.track].desc : '', ev.campusName, ev.notes, ev.link].filter(Boolean).join('\n');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LMS Rubela//Kalender Seleksi//ID', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${ev.id}@lms-rubela`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d(ev.startDate)}`, `DTEND;VALUE=DATE:${next(ev.endDate)}`,
      `SUMMARY:${escIcs((TRACKS[ev.track] ? TRACKS[ev.track].label + ': ' : '') + ev.title)}`, `DESCRIPTION:${escIcs(desc)}`,
      ev.link ? `URL:${ev.link}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  }

  /* ============================ impor / ekspor ============================ */
  const COLUMNS = ['Kampus', 'Singkatan', 'Kota', 'Provinsi', 'Jenis', 'Situs', 'Fakultas', 'Jurusan', 'Jenjang', 'Tahun Data',
    'Daya Tampung', 'Peminat', 'Rata-rata Skor', 'Skor Minimum', 'PU', 'PPU', 'PBM', 'PK', 'LBIND', 'LBING', 'PM', 'Sumber', 'Catatan'];
  /** Baris ekspor (baris pertama = judul kolom), satu baris per jurusan. */
  function exportRows() {
    const cs = new Map(load(K.campus).map(c => [c.id, c]));
    const fs = new Map(load(K.faculty).map(f => [f.id, f]));
    const fmt = (v) => (v == null ? '' : v);           // angka tetap angka (ekspor .xlsx); CSV memformat sendiri
    return [COLUMNS].concat(majors().map(m => {
      const c = cs.get(m.campusId) || {}, f = fs.get(m.facultyId) || {};
      return [c.name, c.short, c.city, c.province, c.type, c.website, f.name, m.name, m.level, m.year, m.capacity, m.applicants, m.avgScore, m.minScore]
        .concat(CODES.map(code => (m.subtests || {})[code]), [m.source, m.notes]).map(fmt);
    }));
  }
  /**
   * Baris tabel (baris pertama = judul kolom) → rencana impor. Tidak menyimpan apa pun.
   * Kampus dicocokkan dari nama, fakultas dari (kampus, nama), jurusan dari (kampus, fakultas, nama, jenjang).
   */
  function planImport(rows) {
    const head = (rows[0] || []).map(h => norm(h));
    const col = (name) => head.indexOf(norm(name));
    if (col('Kampus') < 0 || col('Jurusan') < 0) throw new Error('Kolom "Kampus" dan "Jurusan" wajib ada. Unduh templat untuk melihat susunan kolom.');
    const get = (r, name) => { const i = col(name); return i >= 0 ? String(r[i] == null ? '' : r[i]).trim() : ''; };
    const cs = load(K.campus), fs = load(K.faculty), ms = load(K.major);
    const out = { campuses: [], faculties: [], majors: [], errors: [], counts: { newCampus: 0, updCampus: 0, newFaculty: 0, newMajor: 0, updMajor: 0 }, updatedCampusIds: new Set() };
    const findC = (name) => out.campuses.concat(cs).find(c => norm(c.name) === norm(name));
    const findF = (cid, name) => out.faculties.concat(fs).find(f => f.campusId === cid && norm(f.name) === norm(name));
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      if (!r.some(v => String(v == null ? '' : v).trim())) return;
      // Kampus/fakultas baru dari baris ini baru dicatat bila jurusannya lolos validasi.
      const stage = { campuses: [], faculties: [] };
      const look = {
        campus: (id) => stage.campuses.concat(out.campuses, cs).find(c => c.id === id) || null,
        faculty: (id) => stage.faculties.concat(out.faculties, fs).find(f => f.id === id) || null
      };
      try {
        const cname = text(get(r, 'Kampus'), 120);
        if (cname.length < 2) throw new Error('nama kampus kosong');
        let c = findC(cname);
        const web = get(r, 'Situs');
        if (web && !urlOk(web)) throw new Error('situs kampus harus diawali http:// atau https://');
        const info = { short: text(get(r, 'Singkatan'), 20), city: text(get(r, 'Kota'), 60), province: text(get(r, 'Provinsi'), 60),
          type: CAMPUS_TYPES.includes(get(r, 'Jenis')) ? get(r, 'Jenis') : '', website: web };
        let campusNew = false, campusUpd = false;
        if (!c) {
          c = Object.assign({ id: uid('pc'), name: cname }, info, { type: info.type || 'PTN', updatedAt: Date.now() });
          stage.campuses.push(c); campusNew = true;
        } else {
          // Kolom kampus yang diisi memperbarui data kampus yang sudah ada.
          const patch = {};
          Object.keys(info).forEach(k => { if (info[k] && info[k] !== c[k]) patch[k] = info[k]; });
          if (Object.keys(patch).length) { c = Object.assign({}, c, patch, { updatedAt: Date.now() }); stage.campuses.push(c); campusUpd = true; }
        }
        let f = null;
        const fname = text(get(r, 'Fakultas'), 120);
        if (fname) {
          f = findF(c.id, fname);
          if (!f) { f = { id: uid('pf'), campusId: c.id, name: fname, updatedAt: Date.now() }; stage.faculties.push(f); }
        }
        const lv = get(r, 'Jenjang').toUpperCase();
        const level = LEVELS.includes(lv) ? lv : 'S1';
        const mname = text(get(r, 'Jurusan'), 120);
        const existing = out.majors.concat(ms).find(m => m.campusId === c.id && (m.facultyId || null) === (f ? f.id : null) && norm(m.name) === norm(mname) && m.level === level);
        const subtests = {};
        CODES.forEach(code => { subtests[code] = get(r, code); });
        const clean = cleanMajor({
          id: existing ? existing.id : null, campusId: c.id, facultyId: f ? f.id : null, name: mname, level,
          year: get(r, 'Tahun Data'), capacity: get(r, 'Daya Tampung'), applicants: get(r, 'Peminat'), avgScore: get(r, 'Rata-rata Skor'),
          minScore: get(r, 'Skor Minimum'), subtests, source: get(r, 'Sumber'), notes: get(r, 'Catatan')
        }, look);
        // Lolos: catat kampus/fakultas/jurusan dari baris ini.
        stage.campuses.forEach(x => {
          const j = out.campuses.findIndex(y => y.id === x.id);
          if (j >= 0) out.campuses[j] = x; else out.campuses.push(x);
        });
        if (campusNew) out.counts.newCampus++;
        else if (campusUpd && !out.updatedCampusIds.has(c.id)) { out.updatedCampusIds.add(c.id); out.counts.updCampus++; }
        stage.faculties.forEach(x => { out.faculties.push(x); out.counts.newFaculty++; });
        const j = out.majors.indexOf(existing);
        if (j >= 0) out.majors[j] = clean;
        else { out.majors.push(clean); if (existing) out.counts.updMajor++; else out.counts.newMajor++; }
      } catch (e) {
        out.errors.push(`Baris ${line}: ${e.message}`);
      }
    });
    return out;
  }
  function applyImport(p, actor) {
    guard(actor);
    const merge = (key, items) => {
      if (!items.length) return;
      const list = load(key);
      items.forEach(x => { const i = list.findIndex(y => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x); });
      save(key, list);
    };
    merge(K.campus, p.campuses);
    merge(K.faculty, p.faculties);
    merge(K.major, p.majors);
    log('ptn.import', `Impor data PTN: ${p.counts.newCampus} kampus baru, ${p.counts.updCampus} kampus diperbarui, ${p.counts.newFaculty} fakultas, ${p.counts.newMajor} jurusan baru, ${p.counts.updMajor} diperbarui`, null);
  }

  global.PTN = {
    K, CODES, CAMPUS_TYPES, LEVELS, TRACKS, MAX_CHOICES, COLUMNS, norm, num, subLabel,
    campuses, campus, faculties, faculty, majors, major, majorLabel,
    saveCampus, deleteCampus, saveFaculty, deleteFaculty, saveMajor, deleteMajor,
    summary, chance, alternatives, levelOf, tryoutScores,
    plan, savePlan,
    events, event, saveEvent, deleteEvent, daysUntil, eventState, icsFor,
    exportRows, planImport, applyImport
  };
})(window);
