/* =====================================================================
 * js/ai-context.js — konteks data LMS untuk AI (admin, tutor, mentee)
 * ---------------------------------------------------------------------
 * AI tidak dapat membaca database secara langsung. Modul ini menyusun
 * ringkasan data LMS yang RELEVAN dan sesuai hak akses pengguna, lalu
 * mengirimkannya sebagai instruksi sistem:
 *   - admin  : seluruh mentee, kelas, tutor, jadwal, CBT, keuangan ringkas
 *   - tutor  : hanya kelas yang diajar & mentee di kelas tersebut
 *   - mentee : hanya datanya sendiri
 * Bila pengguna menyebut nama mentee, rincian mentee itu ikut dimuat.
 *
 * PRIVASI: bila "Samarkan nama mentee" aktif (bawaan), nama mentee diganti
 * kode (Mentee-01, …) sebelum dikirim ke penyedia AI, lalu dikembalikan ke
 * nama asli saat jawaban ditampilkan. Email, nomor HP, dan password tidak
 * pernah dikirim.
 * ===================================================================*/
(function (global) {
  'use strict';

  const BUDGET = 14000;            // batas karakter blok data agar muat di kuota penyedia gratis
  const DAY = 86400000;

  const clip = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const pct = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v) + '%');
  const num = (v) => (v == null || !isFinite(v) ? '–' : String(Math.round(v)));
  const cbtTxt = (v) => (v == null || !isFinite(v) ? '–' : (v > 100 ? `${Math.round(v)} (skala 200–800)` : `${Math.round(v)}%`));
  const ymd = (ts) => (global.DB && DB.ymdOf ? DB.ymdOf(ts) : new Date(ts).toISOString().slice(0, 10));
  const fmtDate = (ts) => (global.UI && UI.fmtDate ? UI.fmtDate(ts) : ymd(ts));
  const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ---------------------------------------------------------------
   * Penyamaran nama mentee
   * -------------------------------------------------------------*/
  function makePseudo(students, enabled) {
    const map = new Map();        // id → kode
    const byName = [];            // [{ name, code }] (panjang dulu agar nama lengkap tercocok)
    (students || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).forEach((s, i) => {
      const code = 'Mentee-' + String(i + 1).padStart(2, '0');
      map.set(s.id, code);
      if (s.name && String(s.name).trim().length >= 3) byName.push({ name: String(s.name).trim(), code });
    });
    byName.sort((a, b) => b.name.length - a.name.length);
    const nameOf = (s) => (enabled ? (map.get(s.id) || 'Mentee') : (s.name || 'Mentee'));
    function enc(text) {
      if (!enabled) return String(text == null ? '' : text);
      let t = String(text == null ? '' : text);
      byName.forEach(x => { t = t.replace(new RegExp('(^|[^\\p{L}])' + escRe(x.name) + '(?![\\p{L}])', 'giu'), (m, pre) => pre + x.code); });
      return t;
    }
    function dec(text) {
      if (!enabled) return String(text == null ? '' : text);
      let t = String(text == null ? '' : text);
      byName.forEach(x => { t = t.replace(new RegExp(escRe(x.code) + '(?!\\d)', 'g'), x.name); });
      return t;
    }
    return { enabled: !!enabled, nameOf, enc, dec, codeOf: (id) => map.get(id) };
  }

  /* ---------------------------------------------------------------
   * Pengumpulan data sesuai hak akses
   * -------------------------------------------------------------*/
  function scopeFor(user) {
    const allStudents = DB.getUsers().filter(u => u.role === 'siswa');
    if (user.role === 'admin') {
      return { courses: DB.getCourses(), students: allStudents, tutors: DB.getUsers().filter(u => u.role === 'guru') };
    }
    if (user.role === 'guru') {
      const courses = DB.getCoursesByTeacher(user.id);
      const ids = new Set(courses.map(c => c.id));
      const sids = new Set(DB.getEnrollments ? DB.getEnrollments().filter(e => ids.has(e.courseId)).map(e => e.studentId)
        : [].concat(...courses.map(c => DB.getEnrollmentsByCourse(c.id))).map(e => e.studentId));
      return { courses, students: allStudents.filter(s => sids.has(s.id)), tutors: [user] };
    }
    const mine = new Set(DB.getEnrollmentsByStudent(user.id).map(e => e.courseId));
    return { courses: DB.getCourses().filter(c => mine.has(c.id)), students: allStudents.filter(s => s.id === user.id), tutors: [] };
  }

  /** Statistik ringkas satu mentee (memakai Rekap bila tersedia). */
  function statsOf(s) {
    try {
      if (global.Rekap && Rekap.studentStats) return Rekap.studentStats(s);
    } catch (e) { /* jatuh ke perhitungan sederhana */ }
    const att = DB.attendanceSummary(DB.getAttendanceByUser(s.id).filter(a => a.role === 'siswa'));
    return { presentPct: Math.round(att.pct), attTotal: att.sessions, subs: DB.getSubmissionsByStudent(s.id).length, missing: 0, avgAsg: null, avgCbt: null, attempts: 0, performance: null };
  }

  function batchName(s) {
    if (!s.batchId || !DB.getBatch) return '';
    const b = DB.getBatch(s.batchId);
    return b ? b.name : '';
  }

  function studentLine(s, st, P, withMoney) {
    const bits = [
      P.nameOf(s), s.kelas || '-', batchName(s) || '',
      `hadir ${pct(st.presentPct)}${st.attTotal ? ` dari ${st.attTotal} sesi` : ''}`,
      `tugas ${st.subs || 0} dikumpul / ${st.missing || 0} belum, rata ${num(st.avgAsg)}`,
      `CBT ${st.attempts || 0}x rata ${cbtTxt(st.avgCbt)}`,
      st.weakSubtest ? `terlemah ${st.weakSubtest}` : '',
      st.performance != null ? `indeks ${st.performance}` : '',
      withMoney && st.unpaid ? `tunggakan Rp${Number(st.unpaid).toLocaleString('id-ID')}` : '',
      s.status && s.status !== 'Aktif' ? `status ${s.status}` : ''
    ].filter(Boolean);
    return '- ' + bits.join(' | ');
  }

  function studentDetail(s, st, P, scope) {
    const lines = [`### Rincian ${P.nameOf(s)} (${s.kelas || '-'})`];
    if (s.targetUniv) lines.push(`Target kuliah: ${clip(s.targetUniv, 80)}${s.targetMajor ? ' — ' + clip(s.targetMajor, 80) : ''}`);
    const courseIds = new Set(scope.courses.map(c => c.id));
    const mine = DB.getEnrollmentsByStudent(s.id).map(e => DB.getCourse(e.courseId)).filter(c => c && courseIds.has(c.id));
    if (mine.length) lines.push('Kelas: ' + mine.map(c => DB.courseTitle(c)).join('; '));
    lines.push(`Kehadiran: ${pct(st.presentPct)} (hadir ${st.hadir || 0}, terlambat ${st.terlambat || 0}, izin ${st.izin || 0}, sakit ${st.sakit || 0}, alfa ${st.alfa || 0})`);
    const miss = (st.missingList || []).filter(a => courseIds.has(a.courseId)).slice(0, 8);
    if (miss.length) lines.push('Tugas belum dikumpulkan: ' + miss.map(a => `${clip(a.title, 60)}${a.dueDate ? ` (tenggat ${fmtDate(a.dueDate)})` : ''}`).join('; '));
    const atts = (st.attemptList || []).slice().sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)).slice(0, 6);
    if (atts.length) {
      lines.push('CBT terakhir: ' + atts.map(a => {
        const cbt = DB.getCbt(a.cbtId);
        const sc = a.scoring && a.scoring.scaled200_800 != null ? `${a.scoring.scaled200_800}/800` : `${a.score ?? 0}%`;
        return `${clip(cbt ? cbt.title : 'CBT', 50)} = ${sc} (${a.correctCount || 0}/${a.totalCount || 0} benar)`;
      }).join('; '));
    }
    const sub = DB.studentSubtestStats(s.id).filter(x => x.avg != null);
    if (sub.length) lines.push('Rata-rata per subtest (terlemah dulu): ' + sub.map(x => `${x.short} ${x.avg}`).join(', '));
    return lines.join('\n');
  }

  function coursesBlock(scope) {
    return scope.courses.slice(0, 60).map(c => {
      const n = DB.getEnrollmentsByCourse(c.id).length;
      const tutors = DB.courseTeachers ? DB.courseTeachers(c).map(t => t.name).join(' & ') : '';
      return `- ${clip(DB.courseTitle(c), 90)} | subtest ${c.subtest || '-'} | ${n} mentee | tutor ${tutors || '-'} | jadwal ${DB.courseScheduleLabel(c)}${c.active === false ? ' | NONAKTIF' : ''}`;
    }).join('\n');
  }

  function plansBlock(scope) {
    const ids = new Set(scope.courses.map(c => c.id));
    const today = ymd(Date.now());
    const until = ymd(Date.now() + 7 * DAY);
    const plans = DB.getClassPlans().filter(p => ids.has(p.courseId) && p.date >= today && p.date <= until && p.status !== 'cancelled')
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 25);
    return plans.map(p => {
      const c = DB.getCourse(p.courseId);
      const t = p.teacherId ? DB.getUser(p.teacherId) : null;
      return `- ${p.date} ${p.time || ''}${p.endTime ? '–' + p.endTime : ''} | ${clip(c ? DB.courseTitle(c) : '-', 70)} | ${clip(p.topic || 'topik belum diisi', 60)} | ${t ? t.name : 'tutor -'} | ${p.status === 'fixed' ? 'fix' : 'rencana'}`;
    }).join('\n');
  }

  function cbtBlock(scope, isAdmin) {
    const ids = new Set(scope.courses.map(c => c.id));
    const sids = new Set(scope.students.map(s => s.id));
    const cbts = DB.getCbts().filter(c => isAdmin || [c.courseId].concat(c.courseIds || []).some(id => id && ids.has(id)))
      .sort((a, b) => (b.startAt || 0) - (a.startAt || 0)).slice(0, 10);
    return cbts.map(c => {
      const at = DB.getCbtAttempts().filter(a => a.cbtId === c.id && a.submittedAt && sids.has(a.studentId));
      const avg = at.length ? Math.round(at.reduce((n, a) => n + (Number(a.score) || 0), 0) / at.length) : null;
      return `- ${clip(c.title, 70)} | ${c.startAt ? fmtDate(c.startAt) : '-'} | ${at.length} peserta selesai | rata ${avg == null ? '–' : avg + '%'}${c.active === false ? ' | nonaktif' : ''}`;
    }).join('\n');
  }

  /** Mentee yang disebut di pertanyaan (nama lengkap / nama depan unik / kode samaran). */
  function mentioned(question, students, P) {
    const q = String(question || '').toLowerCase();
    if (!q) return [];
    const hits = [];
    const firstCount = {};
    students.forEach(s => { const f = String(s.name || '').trim().split(/\s+/)[0].toLowerCase(); if (f) firstCount[f] = (firstCount[f] || 0) + 1; });
    students.forEach(s => {
      const name = String(s.name || '').trim().toLowerCase();
      const first = name.split(/\s+/)[0];
      const code = P.codeOf(s.id);
      if ((name && q.includes(name)) || (code && q.includes(code.toLowerCase()))
        || (first && first.length >= 3 && firstCount[first] === 1 && new RegExp('(^|[^\\p{L}])' + escRe(first) + '(?![\\p{L}])', 'iu').test(q))) hits.push(s);
    });
    return hits.slice(0, 4);
  }

  /* ---------------------------------------------------------------
   * Prompt sistem
   * -------------------------------------------------------------*/
  const RULES = [
    'ATURAN JAWABAN:',
    '1. Semua angka/fakta tentang mentee, kelas, nilai, kehadiran, jadwal, dan keuangan HANYA boleh diambil dari bagian "DATA LMS". Jangan mengarang. Bila data tidak ada, katakan "tidak tercatat di LMS".',
    '2. Bila memakai pengetahuan di luar LMS (materi pelajaran, aturan UTBK/SNPMB, strategi belajar, informasi kampus), tandai dengan judul "🌐 Pengetahuan umum" dan pisahkan dari "📊 Dari data LMS".',
    '3. Untuk informasi eksternal yang bisa berubah (jadwal resmi, kuota, biaya, passing grade), sebut sumber resminya (mis. laman resmi SNPMB atau situs PTN terkait) dan sarankan untuk memeriksa ulang. Jangan membuat tautan atau angka yang tidak kamu yakini.',
    '4. Kode berbentuk "Mentee-" diikuti dua angka adalah nama samaran. Tulis kode itu apa adanya, jangan menebak nama asli.',
    '5. Jawab dalam Bahasa Indonesia yang jelas, terstruktur (poin/tabel ringkas), dan langsung ke inti. Akhiri dengan saran tindakan yang konkret bila relevan.'
  ].join('\n');

  /**
   * Konteks untuk Asisten AI admin/tutor.
   * @returns {{ system:string, pseudo }}
   */
  function forStaff(user, question) {
    const s = DB.getSettings();
    const scope = scopeFor(user);
    const P = makePseudo(scope.students, s.aiPseudonymize !== false);
    const isAdmin = user.role === 'admin';
    const stats = new Map();
    const st = (x) => { if (!stats.has(x.id)) stats.set(x.id, statsOf(x)); return stats.get(x.id); };
    const active = scope.students.filter(x => !x.status || x.status === 'Aktif');
    // Urutkan berisiko lebih dulu (indeks performa terendah) agar yang penting tidak terpotong.
    const ranked = active.slice().sort((a, b) => (st(a).performance == null ? 101 : st(a).performance) - (st(b).performance == null ? 101 : st(b).performance));

    const parts = [];
    const head = [
      `Tanggal hari ini: ${fmtDate(Date.now())}.`,
      `Ringkasan: ${scope.courses.length} kelas subtest, ${active.length} mentee aktif${isAdmin ? `, ${scope.tutors.length} tutor` : ''}.`,
      `Ambang kehadiran minimal LMS: ${DB.attendanceThreshold ? DB.attendanceThreshold() : 75}%.`
    ];
    parts.push('## Umum\n' + head.join(' '));
    const detail = mentioned(question, scope.students, P).map(x => studentDetail(x, st(x), P, scope));
    if (detail.length) parts.push(detail.join('\n\n'));
    parts.push('## Kelas\n' + (coursesBlock(scope) || '(belum ada kelas)'));
    const plans = plansBlock(scope);
    if (plans) parts.push('## Jadwal 7 hari ke depan\n' + plans);
    const cb = cbtBlock(scope, isAdmin);
    if (cb) parts.push('## CBT / Tryout terbaru\n' + cb);
    if (isAdmin) {
      const tl = scope.tutors.slice(0, 40).map(t => `- ${t.name} | ${DB.getCoursesByTeacher(t.id).length} kelas${t.status && t.status !== 'Aktif' ? ' | ' + t.status : ''}`).join('\n');
      if (tl) parts.push('## Tutor\n' + tl);
    }
    const ann = (DB.getAnnouncements() || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5)
      .map(a => `- ${fmtDate(a.createdAt || Date.now())}: ${clip(a.title, 90)}`).join('\n');
    if (ann) parts.push('## Pengumuman terbaru\n' + ann);

    let used = parts.join('\n\n').length;
    const rows = [];
    let shown = 0;
    for (const x of ranked) {
      const line = studentLine(x, st(x), P, isAdmin);
      if (used + line.length + 200 > BUDGET) break;
      rows.push(line); used += line.length + 1; shown++;
    }
    const studentsBlock = '## Mentee (berisiko lebih dulu; kolom: nama | kelas utama | angkatan | kehadiran | tugas | CBT | subtest terlemah | indeks performa 0–100)\n'
      + (rows.join('\n') || '(belum ada mentee)')
      + (shown < ranked.length ? `\n(${ranked.length - shown} mentee lain tidak dimuat karena batas panjang. Minta pengguna menyebut nama mentee untuk rincian.)` : '');
    parts.splice(detail.length ? 2 : 1, 0, studentsBlock);

    const role = isAdmin ? 'admin bimbel' : `tutor (${user.name}) — data dibatasi pada kelas yang diajar`;
    const system = [
      `Kamu adalah "Asisten AI LMS Rubela", analis pendidikan & asisten operasional untuk ${role} di bimbel UTBK.`,
      'Tugasmu: menjawab pertanyaan tentang mentee, kelas, nilai, kehadiran, jadwal, dan strategi pembelajaran, serta memberi rekomendasi yang dapat ditindaklanjuti.',
      RULES,
      '',
      '=== DATA LMS (internal, terkini saat pertanyaan dikirim) ===',
      parts.join('\n\n'),
      '=== AKHIR DATA LMS ==='
    ].join('\n');
    return { system, pseudo: P };
  }

  /** Konteks AI Guru untuk mentee (hanya datanya sendiri). */
  function forStudent(user) {
    const scope = scopeFor(user);
    const P = makePseudo([], false);
    const st = statsOf(user);
    const sub = DB.studentSubtestStats(user.id).filter(x => x.avg != null);
    const pending = (st.missingList || []).slice(0, 6).map(a => `${clip(a.title, 60)}${a.dueDate ? ` (tenggat ${fmtDate(a.dueDate)})` : ''}`);
    const plans = plansBlock(scope);
    const first = String(user.name || '').trim().split(/\s+/)[0] || 'kamu';
    const lines = [
      `Tanggal hari ini: ${fmtDate(Date.now())}.`,
      `Nama panggilan mentee: ${first}. Kelas utama: ${user.kelas || '-'}.`,
      user.targetUniv ? `Target kuliah: ${clip(user.targetUniv, 80)}${user.targetMajor ? ' — ' + clip(user.targetMajor, 80) : ''}.` : '',
      `Kelas yang diikuti: ${scope.courses.map(c => DB.courseTitle(c)).join('; ') || 'belum ada'}.`,
      `Kehadiran: ${pct(st.presentPct)}. Tugas dikumpulkan ${st.subs || 0}, belum ${st.missing || 0}, rata nilai tugas ${num(st.avgAsg)}.`,
      sub.length ? `Rata-rata CBT per subtest (terlemah dulu): ${sub.map(x => `${x.short} ${x.avg}`).join(', ')}.` : 'Belum ada riwayat CBT.',
      pending.length ? `Tugas yang belum dikumpulkan: ${pending.join('; ')}.` : '',
      plans ? `Jadwal 7 hari ke depan:\n${plans}` : ''
    ].filter(Boolean);
    const system = [
      'Kamu adalah "AI Guru", tutor UTBK berbahasa Indonesia di LMS Rubela untuk siswa SMA/SMK.',
      'Jawab ringkas, terstruktur, ramah, dan mudah dipahami. Bila pertanyaan berupa soal, tuntun langkah demi langkah dan ajak siswa berpikir; berikan jawaban akhir setelah langkahnya jelas.',
      'Gunakan data siswa di bawah untuk memberi saran yang personal. Jangan mengarang nilai atau jadwal yang tidak ada di data.',
      'Untuk informasi resmi yang bisa berubah (jadwal UTBK/SNPMB, daya tampung), sebut sumber resminya dan sarankan untuk memeriksa ulang.',
      'Tolak dengan sopan permintaan di luar kegiatan belajar yang tidak pantas.',
      '',
      '=== DATA SISWA (LMS) ===',
      lines.join('\n'),
      '=== AKHIR DATA ==='
    ].join('\n');
    return { system, pseudo: P };
  }

  /** Konteks pembahasan satu soal CBT setelah ujian selesai. */
  function forCbtQuestion(user, cbt, q, attempt, correct) {
    const P = makePseudo([], false);
    const plain = (h) => clip(global.RichText && RichText.plain ? RichText.plain(h, 4000) : String(h || '').replace(/<[^>]*>/g, ' '), 3500);
    const f = q.questionType || 'Pilihan Ganda';
    const ans = attempt && attempt.answers ? attempt.answers[q.id] : null;
    const lines = [`Ujian: ${clip(cbt && cbt.title, 100)}.`, `Subtest/mapel: ${q.subject || '-'}. Format soal: ${f}.`, `Soal: ${plain(q.text)}`];
    if (Array.isArray(q.options) && q.options.length) lines.push('Pilihan:\n' + q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${plain(o)}`).join('\n'));
    if (Array.isArray(q.statements) && q.statements.length) {
      const cols = DB.qMatrixColumns ? DB.qMatrixColumns(q) : ['Benar', 'Salah'];
      lines.push('Pernyataan:\n' + q.statements.map((s2, i) => `${i + 1}. ${plain(s2.text)}`).join('\n') + (f === 'Majemuk Kompleks' ? `\nKolom jawaban: ${cols.join(' / ')}` : ''));
    }
    if (Array.isArray(q.pairs) && q.pairs.length) lines.push('Pasangan kiri: ' + q.pairs.map((p, i) => `${i + 1}. ${plain(p.left)}`).join('; '));
    lines.push(`Kunci jawaban resmi: ${DB.qKeyText ? DB.qKeyText(q) : '-'}`);
    lines.push(`Jawaban siswa: ${(DB.qAnswerText ? DB.qAnswerText(q, ans) : String(ans || '')) || '(tidak dijawab)'} — ${correct === true ? 'BENAR' : correct === false ? 'SALAH' : 'dinilai manual'}.`);
    if (q.explanation) lines.push(`Pembahasan dari tutor: ${plain(q.explanation)}`);
    const system = [
      'Kamu adalah "AI Guru" yang membantu siswa memahami PEMBAHASAN soal ujian yang SUDAH selesai dikerjakan di LMS Rubela.',
      'Jelaskan konsep dan langkah penyelesaian secara bertahap dengan bahasa sederhana; tunjukkan mengapa jawaban siswa benar/salah dan di mana letak kekeliruannya.',
      'Gunakan kunci jawaban resmi sebagai acuan. Bila menurut perhitunganmu kunci tersebut keliru, sampaikan dengan hati-hati beserta alasannya dan sarankan siswa mengonfirmasi ke tutor.',
      'Bila pembahasan tutor tersedia, perjelas dan lengkapi pembahasan itu — jangan bertentangan tanpa alasan.',
      'Tawarkan satu soal latihan serupa di akhir bila siswa membutuhkannya. Jawab dalam Bahasa Indonesia.',
      '',
      '=== DATA SOAL ===',
      lines.join('\n'),
      '=== AKHIR DATA SOAL ==='
    ].join('\n');
    return { system, pseudo: P };
  }

  global.AIContext = { forStaff, forStudent, forCbtQuestion, makePseudo, _scopeFor: scopeFor };
})(window);
