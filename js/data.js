/* ===== LMS Rubela - Data Store (LocalStorage) =====
 * Handles seeding and CRUD-like helpers for all LMS entities.
 * All entities are linked via IDs so data stays synchronized.
 *
 * Entities:
 *  - users (admin / guru / siswa)
 *  - courses -> teacherId
 *  - materials -> courseId
 *  - modules -> courseId (structured module with multiple sections)
 *  - recordings -> courseId (class recordings / video links)
 *  - assignments -> courseId
 *  - submissions -> assignmentId, studentId
 *  - enrollments -> courseId, studentId
 *  - questions (bank soal) -> subject, authorId
 *  - cbts (exams) -> courseId, questionIds[]
 *  - cbtAttempts -> cbtId, studentId
 *  - attendance -> courseId, userId, date, role(siswa|guru)
 *  - payments -> studentId, courseId (optional)
 *  - expenses -> category
 *  - salaries -> teacherId (payroll to teacher)
 */
(function (global) {
  const KEYS = {
    users: 'lms_users',
    courses: 'lms_courses',
    materials: 'lms_materials',
    modules: 'lms_modules',
    recordings: 'lms_recordings',
    assignments: 'lms_assignments',
    submissions: 'lms_submissions',
    enrollments: 'lms_enrollments',
    questions: 'lms_questions',
    passages: 'lms_passages',
    cbts: 'lms_cbts',
    cbtContribs: 'lms_cbt_contribs',
    qHistory: 'lms_q_history',
    vocabItems: 'lms_vocab_items',
    vocabProgress: 'lms_vocab_progress',
    cbtAttempts: 'lms_cbt_attempts',
    attendance: 'lms_attendance',
    payments: 'lms_payments',
    expenses: 'lms_expenses',
    salaries: 'lms_salaries',
    notifications: 'lms_notifications',
    classPlans: 'lms_class_plans',
    materialPlans: 'lms_material_plans',
    whiteboards: 'lms_whiteboards',
    motivations: 'lms_motivations',
    securityQuestions: 'lms_security_questions',
    settings: 'lms_settings',
    session: 'lms_session',
    seeded: 'lms_seeded_v6'
  };

  /* Extra localStorage keys that are not part of the main entity map but must
   * still be cleared on reset / re-seed so everything stays in sync. */
  const EXTRA_KEYS = [
    'lms_class_options', 'lms_events', 'lms_batches', 'lms_feedbacks',
    'lms_announcements', 'lms_messages', 'lms_presence_v1',
    'lms_schema_version', 'lms_birthday_wishes', 'lms_birthday_rewards',
    'lms_activity_log', 'lms_birthday_notified', 'lms_whiteboard_boards',
    'lms_learning_log', 'lms_streak_grants', 'lms_reading_texts', 'lms_verses',
    'lms_hub_courses', 'lms_hub_progress', 'lms_hub_payments', 'lms_capsule_vaults', 'lms_capsules',
    'lms_music_tracks', 'lms_ai_chats', 'lms_game_questions', 'lms_game_battles', 'lms_game_scores', 'lms_game_rooms', 'lms_game_players',
    'lms_topics', 'lms_news', 'lms_ptn_campuses', 'lms_ptn_faculties', 'lms_ptn_majors', 'lms_admission_events', 'lms_utbk_plans',
    'lms_groups', 'lms_group_posts', 'lms_group_answers', 'lms_study_sessions', 'lms_study_goals', 'lms_study_stats'
  ];

  /* ===== Hari & jadwal ===== */
  const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  /* Ambang waktu alur "War Jadwal Kelas" (dalam hari sebelum pelaksanaan) */
  const PLAN_FILL_LEAD = 3;     // H-3: tutor mulai mengisi rencana
  const PLAN_CONFIRM_LEAD = 5;  // H-5: tutor melakukan validasi/centang
  const PLAN_STATUS = {
    draft: { label: 'Rencana', badge: 'badge-gray' },
    fixed: { label: 'Fix', badge: 'badge-success' },
    changed: { label: 'Diubah', badge: 'badge-warning' },
    cancelled: { label: 'Dibatalkan', badge: 'badge-gray' }
  };

  /* ===== Konstanta UTBK (dipakai seluruh panel) =====
   * Urutan array = urutan resmi pengerjaan subtest UTBK. Ujian mode
   * "Gabungan 7 Subtest" dikerjakan berurutan mengikuti indeks ini.
   */
  const SUBTESTS = [
    { code: 'PU',    name: 'Penalaran Umum (PU)',                            short: 'PU',    group: 'TPS',      icon: '🧩', defaultMinutes: 30 },
    { code: 'PPU',   name: 'Pengetahuan dan Pemahaman Umum (PPU)',           short: 'PPU',   group: 'TPS',      icon: '📖', defaultMinutes: 15 },
    { code: 'PBM',   name: 'Kemampuan Memahami Bacaan dan Menulis (PBM)',    short: 'PBM',   group: 'TPS',      icon: '✍️', defaultMinutes: 25 },
    { code: 'PK',    name: 'Pengetahuan Kuantitatif (PK)',                   short: 'PK',    group: 'TPS',      icon: '🔢', defaultMinutes: 20 },
    { code: 'LBIND', name: 'Literasi dalam Bahasa Indonesia',               short: 'Lit. Indonesia', group: 'Literasi', icon: '🇮🇩', defaultMinutes: 42 },
    { code: 'LBING', name: 'Literasi dalam Bahasa Inggris',                 short: 'Lit. Inggris',   group: 'Literasi', icon: '🇬🇧', defaultMinutes: 20 },
    { code: 'PM',    name: 'Penalaran Matematika',                          short: 'Pen. Matematika', group: 'Penalaran', icon: '📐', defaultMinutes: 42 }
  ];
  const SUBTEST_NAMES = SUBTESTS.map(s => s.name);
  /* Seluruh format soal (urutan sama dengan js/qeditor.js FORMATS).
   * - "Benar/Salah Majemuk": beberapa pernyataan, tiap baris hanya Benar/Salah
   *   (statements[{text, value:boolean}], jawaban Array<Boolean>).
   * - "Majemuk Kompleks": tabel pernyataan dengan kolom jawaban yang dapat
   *   diubah (columns[label], statements[{text, correct:indeksKolom}], jawaban
   *   Array<Number>). Soal lama tanpa columns dianggap kolom Benar/Salah. */
  const QUESTION_TYPES = ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Benar/Salah', 'Isian Singkat',
    'Benar/Salah Majemuk', 'Majemuk Kompleks', 'Menjodohkan', 'Urutan', 'Esai'];
  const MATRIX_DEFAULT_COLS = ['Benar', 'Salah'];
  const MATRIX_MAX_COLS = 8;
  const plainLabel = (v) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  /** Label kolom jawaban soal Majemuk Kompleks (minimal 2; bawaan Benar/Salah). */
  function qMatrixColumns(q) {
    const cols = Array.isArray(q && q.columns) ? q.columns.map(plainLabel).filter(Boolean).slice(0, MATRIX_MAX_COLS) : [];
    return cols.length >= 2 ? cols : MATRIX_DEFAULT_COLS.slice();
  }
  /** Kunci per pernyataan sebagai indeks kolom (soal lama: true → Benar=0, false → Salah=1). */
  function qMatrixKeys(q) {
    const n = qMatrixColumns(q).length;
    return ((q && q.statements) || []).map(st => {
      if (st && st.correct != null && st.correct !== '' && Number.isInteger(Number(st.correct))) {
        const k = Number(st.correct);
        return k >= 0 && k < n ? k : null;
      }
      if (st && typeof st.value === 'boolean') return st.value ? 0 : 1;
      return null;
    });
  }
  /** Jawaban mentee → indeks kolom per pernyataan (jawaban lama boolean ikut dikonversi). */
  function qMatrixAnswer(q, ans) {
    if (!Array.isArray(ans)) return [];
    const n = qMatrixColumns(q).length;
    return ((q && q.statements) || []).map((_, i) => {
      const v = ans[i];
      if (v === true) return 0;
      if (v === false) return 1;
      if (v == null || v === '') return null;
      const k = Number(v);
      return Number.isInteger(k) && k >= 0 && k < n ? k : null;
    });
  }
  /** Jawaban Benar/Salah Majemuk → Array<Boolean|null>. */
  function qBoolAnswer(q, ans) {
    if (!Array.isArray(ans)) return [];
    return ((q && q.statements) || []).map((_, i) => {
      const v = ans[i];
      if (v === true || v === 'true' || v === 1 || v === '1') return true;
      if (v === false || v === 'false' || v === 0 || v === '0') return false;
      return null;
    });
  }
  /** Teks jawaban mentee yang mudah dibaca (untuk tabel penilaian tutor). */
  function qAnswerText(q, ans) {
    const f = (q && q.questionType) || 'Pilihan Ganda';
    const L = (i) => String.fromCharCode(65 + Number(i));
    if (ans == null || ans === '' || (Array.isArray(ans) && !ans.length)) return '';
    if (f === 'Majemuk Kompleks') {
      const cols = qMatrixColumns(q);
      return qMatrixAnswer(q, ans).map((k, i) => `${i + 1}: ${k == null ? '—' : cols[k]}`).join('; ');
    }
    if (f === 'Benar/Salah Majemuk') return qBoolAnswer(q, ans).map((v, i) => `${i + 1}: ${v == null ? '—' : (v ? 'Benar' : 'Salah')}`).join('; ');
    if (f === 'Pilihan Lebih dari Satu') return (Array.isArray(ans) ? ans : []).map(L).join(', ');
    if (f === 'Pilihan Ganda' || f === 'Benar/Salah') {
      const k = Number(ans);
      if (!Number.isInteger(k)) return String(ans);
      return f === 'Benar/Salah' && !((q.options || []).length) ? (k === 0 ? 'Benar' : 'Salah') : L(k);
    }
    if (Array.isArray(ans)) return ans.map(x => plainLabel(x)).join(', ');
    return plainLabel(ans);
  }
  /** Teks kunci jawaban ringkas (bank soal, daftar kuis). */
  function qKeyText(q) {
    const f = (q && q.questionType) || 'Pilihan Ganda';
    const L = (i) => String.fromCharCode(65 + Number(i));
    if (f === 'Majemuk Kompleks') { const cols = qMatrixColumns(q); return qMatrixKeys(q).map(k => (k == null ? '—' : cols[k])).join('; '); }
    if (f === 'Benar/Salah Majemuk') return ((q.statements || [])).map(s => (s && s.value ? 'Benar' : 'Salah')).join('; ');
    if (f === 'Esai') return (q.keywords || []).join(', ') || '(manual)';
    if (f === 'Isian Singkat') return (q.answers || []).join(', ');
    if (f === 'Benar/Salah') return Number(q.correctIndex) === 0 ? 'Benar' : 'Salah';
    if (f === 'Pilihan Lebih dari Satu') return (q.correctIndices || []).map(L).join(', ');
    if (f === 'Menjodohkan') return (q.pairs || []).map(p => `${plainLabel(p.left)} → ${plainLabel(p.right)}`).join('; ');
    if (f === 'Urutan') return (q.orderItems || []).map(plainLabel).join(' → ');
    return q.correctIndex != null && Number.isInteger(Number(q.correctIndex)) ? L(q.correctIndex) : '-';
  }
  const DIFFICULTIES = ['mudah', 'sedang', 'sulit'];
  /** Penanda "berlaku untuk semua kelas" pada targetClasses sebuah CBT. */
  const ALL_CLASSES = '__ALL__';

  /* ===== Aktivitas belajar (Streak API) =====
   * learning:false → tidak menyalakan streak (login).
   * derived:true   → dihitung dari tabel resmi (submission, attempt, presensi),
   *                  bukan dari laporan klien, sehingga tidak dapat dipalsukan
   *                  lewat pencatatan aktivitas.
   * cap            → jumlah per hari yang masih memberi XP; lebih dari itu tetap
   *                  tercatat (riwayat) tetapi XP 0.
   */
  const LEARNING_TYPES = {
    login:     { label: 'Login harian', icon: '🔑', learning: false, xp: 2, cap: 1,
                 criteria: 'Masuk ke dashboard. Tidak dihitung sebagai aktivitas belajar.' },
    latihan:   { label: 'Latihan soal', icon: '🧮', learning: true, xp: 10, cap: 5, minSec: 30, minAnswered: 5,
                 criteria: 'Menjawab minimal 5 soal latihan dalam satu sesi (≥ 30 detik) lalu menekan Selesai.' },
    miniquiz:  { label: 'Mini quiz', icon: '⚡', learning: true, xp: 15, cap: 3, minSec: 20, minAnswered: 5,
                 criteria: 'Menjawab seluruh 5 soal mini quiz lalu mengumpulkannya (≥ 20 detik).' },
    materi:    { label: 'Membaca materi', icon: '📖', learning: true, xp: 8, cap: 10, minSec: 40, oncePerRef: true,
                 criteria: 'Membuka materi/pelajaran minimal 40 detik lalu menekan "Selesai dibaca". Satu materi hanya dihitung sekali.' },
    reading:   { label: 'Reading Text', icon: '📰', learning: true, xp: 15, cap: 3, minSec: 45,
                 criteria: 'Membaca teks (waktu minimal menyesuaikan panjang teks) dan menjawab semua soal pemahaman.' },
    tryout:    { label: 'Tryout / CBT', icon: '🖥️', learning: true, xp: 30, cap: 3, derived: true,
                 criteria: 'Mengumpulkan ujian CBT/tryout (tercatat otomatis dari hasil ujian).' },
    tugas:     { label: 'Mengumpulkan tugas', icon: '📝', learning: true, xp: 20, cap: 5, derived: true,
                 criteria: 'Mengumpulkan tugas kelas (tercatat otomatis dari pengumpulan).' },
    kelas:     { label: 'Mengikuti kelas', icon: '🏫', learning: true, xp: 15, cap: 3, derived: true,
                 criteria: 'Tercatat Hadir/Terlambat oleh tutor pada presensi kelas.' },
    target:    { label: 'Target harian', icon: '🎯', learning: true, xp: 10, cap: 1, derived: true,
                 criteria: 'Menyelesaikan jumlah jenis aktivitas belajar berbeda sesuai target harian.' },
    tantangan: { label: 'Tantangan harian', icon: '🏆', learning: true, xp: 12, cap: 1, minSec: 5, minAnswered: 1,
                 criteria: 'Menjawab 1 soal tantangan akademik hari ini (sekali per hari).' },
    games:     { label: 'Games Area', icon: '🎮', learning: true, xp: 6, cap: 3, minSec: 20, minScore: 6,
                 criteria: 'Menuntaskan 1 ronde game edukasi dengan skor minimal yang ditentukan.' },
    katabaku:  { label: 'Kata Baku', icon: '🔤', learning: true, xp: 8, cap: 3, minSec: 40, minAnswered: 10,
                 criteria: 'Menuntaskan minimal 10 kartu Kata Baku dalam satu sesi (≥ 40 detik).' },
    vocab:     { label: 'Vocab Inggris', icon: '🗂️', learning: true, xp: 8, cap: 3, minSec: 40, minAnswered: 10,
                 criteria: 'Menuntaskan minimal 10 flashcard vocab bahasa Inggris dalam satu sesi (≥ 40 detik).' }
  };
  /* Token sesi aktivitas hanya hidup di memori halaman (tidak di localStorage):
   * durasi dihitung dari waktu token diterbitkan, bukan dari angka kiriman klien. */
  const learningTokens = new Map();
  const LOG_PEPPER = 'rubela-lrn-v1';
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function chainHash(e) {
    const base = [LOG_PEPPER, e.prev, e.id, e.userId, e.type, e.refId, e.day, e.at, e.xp, e.learning ? 1 : 0].join('|');
    return fnv1a(base) + fnv1a(base.split('').reverse().join(''));
  }
  const QH_MAX = 6000;           // batas entri riwayat jawaban per mentee (lihat DB.qhRecord)
  function sessionActor() {
    try { return JSON.parse(localStorage.getItem('lms_session') || 'null'); } catch (e) { return null; }
  }
  const RELIGIONS = ['Islam', 'Kristen Protestan', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];

  /* ===== Jenis pemasukan =====
   * Pemasukan bimbel tidak hanya SPP: ada denda keterlambatan, denda
   * pelanggaran, dan biaya lain. Dipakai halaman Keuangan agar setiap rupiah
   * yang masuk punya asal yang jelas.
   */
  const PAYMENT_KINDS = [
    { key: 'spp',          label: 'SPP / Biaya Kelas', icon: '📚', fine: false },
    { key: 'pendaftaran',  label: 'Biaya Pendaftaran', icon: '📝', fine: false },
    { key: 'denda',        label: 'Denda Mentee',       icon: '⚠️', fine: true  },
    { key: 'lainnya',      label: 'Pemasukan Lain',    icon: '💼', fine: false }
  ];
  const FINE_REASONS = [
    'Terlambat membayar SPP',
    'Terlambat masuk kelas',
    'Melebihi batas ketidakhadiran',
    'Tidak mengerjakan tugas',
    'Melanggar aturan kelas',
    'Melanggar aturan ujian / CBT',
    'Keluar dari bimbel sebelum masa selesai',
    'Merusak fasilitas',
    'Lainnya'
  ];

  /* ===== Status presensi (satu sumber kebenaran untuk semua panel) =====
   * present: dihitung sebagai "hadir" pada rumus persentase.
   * Rumus: (hadir + terlambat) / total sesi terlaksana × 100%.
   * Izin & sakit ditampilkan terpisah; kebijakan admin (attendanceExcusedPolicy)
   * menentukan apakah keduanya ikut penyebut atau dikeluarkan. */
  const ATT_STATUSES = [
    { key: 'hadir',     label: 'Hadir',     short: 'H', ic: '✓', present: true,  excused: false },
    { key: 'terlambat', label: 'Terlambat', short: 'T', ic: '⏱', present: true,  excused: false },
    { key: 'izin',      label: 'Izin',      short: 'I', ic: '✎', present: false, excused: true  },
    { key: 'sakit',     label: 'Sakit',     short: 'S', ic: '✚', present: false, excused: true  },
    { key: 'alfa',      label: 'Alfa',      short: 'A', ic: '✕', present: false, excused: false }
  ];
  const ATT_KEYS = ATT_STATUSES.map(s => s.key);

  /* ===== Status pendidikan mentee (dasar batas ketidakhadiran & denda) =====
   * Gap year sambil bekerja tidak dibatasi dan tidak dikenai sanksi.
   * Batas status lain diatur admin di Pengaturan → Batas Ketidakhadiran (absencePolicy). */
  const EDU_STATUSES = [
    { key: 'sma12',         label: 'Kelas 12 SMA/SMK/MA',          short: 'Kelas 12' },
    { key: 'gapyear',       label: 'Gap year (tidak bekerja)',     short: 'Gap year' },
    { key: 'gapyear_kerja', label: 'Gap year sambil bekerja',      short: 'Gap year · bekerja', exempt: true },
    { key: 'semi_gapyear',  label: 'Semi gap year (sambil kuliah)', short: 'Semi gap year' }
  ];
  const ABSENCE_DEFAULT = {
    period: 'month',                        // month = dihitung ulang tiap bulan | program = sepanjang program
    statuses: ['alfa'],                     // status presensi yang dihitung sebagai ketidakhadiran
    limits: { sma12: 3, gapyear: 3, semi_gapyear: 4 },   // null = tanpa batas
    unsetLimit: null,                       // mentee yang status pendidikannya belum diisi
    fineAmount: 0,                          // 0 = hanya deteksi, tanpa tagihan denda
    fineMode: 'per'                         // per = × jumlah kelebihan | flat = sekali per periode
  };

  /* ===== Migrasi skema =====
   * Versi skema TERPISAH dari penanda seed. Menaikkan penanda seed akan
   * menghapus seluruh data pengguna, sedangkan migrasi ini hanya menambah
   * field yang belum ada (idempoten) sehingga data lama tetap utuh. */
  const SCHEMA_KEY = 'lms_schema_version';
  const SCHEMA_VERSION = 3;

  /** Pemilik konten "Admin" (dipakai saat tutor pembuat dihapus / dipilih admin). */
  const ADMIN_OWNER = '__admin__';
  /** Jenis konten kelas yang punya pencatatan pembuat. */
  const CONTENT_KINDS = {
    material:   { label: 'Materi',   icon: '📄' },
    module:     { label: 'Modul',    icon: '📘' },
    recording:  { label: 'Rekaman',  icon: '🎥' },
    assignment: { label: 'Tugas',    icon: '📝' },
    cbt:        { label: 'CBT',      icon: '🖥️' }
  };

  function subtestByName(name) {
    return SUBTESTS.find(s => s.name === name) || null;
  }
  /** Urutan subtest sesuai UTBK; subtest tak dikenal ditaruh di akhir. */
  function subtestOrder(name) {
    const i = SUBTEST_NAMES.indexOf(name);
    return i === -1 ? 999 : i;
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  /* Riwayat chat AI */
  const AI_CHAT_KEY = 'lms_ai_chats';
  const AI_CHAT_TTL = 7 * 86400000;      // 7 hari
  const AI_CHAT_MAX_MSG = 80;
  const AI_CHAT_MAX_TEXT = 12000;
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* =====================================================================
   * Bank soal verifikasi login siswa (>100 soal UTBK tingkat mudah).
   * Soal numerik dibangkitkan agar kunci jawaban pasti benar; soal verbal
   * ditulis manual. Semua soal singkat supaya login tetap cepat.
   * ===================================================================*/
  function buildSecurityQuestionBank() {
    const out = [];
    let n = 0;
    const push = (subtest, text, options, correctIndex) => {
      n++;
      out.push({
        id: 'sq_' + n, subtest, text, options,
        correctIndex, difficulty: 'mudah',
        source: 'seed', active: true, createdAt: Date.now()
      });
    };
    /** Acak opsi tetapi tetap mengunci jawaban benar. */
    const shuffled = (correct, distractors) => {
      const opts = [correct, ...distractors];
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }
      return { options: opts, correctIndex: opts.indexOf(correct) };
    };
    const PU = SUBTESTS[0].name, PPU = SUBTESTS[1].name, PBM = SUBTESTS[2].name;
    const PK = SUBTESTS[3].name, LBIND = SUBTESTS[4].name, LBING = SUBTESTS[5].name, PM = SUBTESTS[6].name;

    /* ---------- Pengetahuan Kuantitatif: aritmetika cepat (30 soal) ---------- */
    const arith = [
      [12, 8, '+'], [25, 17, '+'], [46, 29, '+'], [7, 9, '×'], [12, 6, '×'],
      [15, 4, '×'], [81, 9, ':'], [72, 8, ':'], [144, 12, ':'], [50, 18, '−'],
      [100, 37, '−'], [64, 28, '−'], [11, 11, '×'], [13, 5, '×'], [96, 6, ':']
    ];
    arith.forEach(([a, b, op]) => {
      let res;
      if (op === '+') res = a + b;
      else if (op === '−') res = a - b;
      else if (op === '×') res = a * b;
      else res = a / b;
      const d = [res + 1, res - 2, res + 3].map(String);
      const s = shuffled(String(res), d);
      push(PK, `Berapakah hasil dari ${a} ${op} ${b}?`, s.options, s.correctIndex);
    });
    // Persentase sederhana
    [[20, 150], [10, 250], [25, 80], [50, 46], [30, 200], [15, 60], [40, 75]].forEach(([pct, base]) => {
      const res = (pct / 100) * base;
      const s = shuffled(String(res), [String(res + 5), String(res - 5), String(res * 2)]);
      push(PK, `Berapakah ${pct}% dari ${base}?`, s.options, s.correctIndex);
    });
    // Rata-rata
    [[[6, 8, 10], 8], [[5, 7, 9, 11], 8], [[10, 20, 30], 20], [[4, 6, 8, 10, 12], 8]].forEach(([arr, avg]) => {
      const s = shuffled(String(avg), [String(avg + 1), String(avg - 1), String(avg + 2)]);
      push(PK, `Rata-rata dari ${arr.join(', ')} adalah...`, s.options, s.correctIndex);
    });
    // Persamaan satu variabel
    [[2, 6, 3], [3, 12, 4], [5, 20, 4], [4, 28, 7]].forEach(([a, c, x]) => {
      const s = shuffled(String(x), [String(x + 1), String(x - 1), String(x + 2)]);
      push(PK, `Jika ${a}x = ${c}, maka nilai x adalah...`, s.options, s.correctIndex);
    });

    /* ---------- Penalaran Umum: pola & logika (22 soal) ---------- */
    const patterns = [
      [[2, 4, 6, 8], 10], [[1, 3, 5, 7], 9], [[5, 10, 15, 20], 25],
      [[3, 6, 12, 24], 48], [[1, 4, 9, 16], 25], [[2, 6, 18, 54], 162],
      [[100, 90, 80, 70], 60], [[1, 1, 2, 3, 5], 8], [[7, 14, 21, 28], 35],
      [[64, 32, 16, 8], 4], [[2, 5, 10, 17], 26], [[10, 21, 32, 43], 54]
    ];
    patterns.forEach(([seq, nextVal]) => {
      const s = shuffled(String(nextVal), [String(nextVal + 2), String(nextVal - 3), String(nextVal + 5)]);
      push(PU, `Lanjutkan pola bilangan berikut: ${seq.join(', ')}, ...`, s.options, s.correctIndex);
    });
    const logic = [
      ['Semua burung memiliki sayap. Merpati adalah burung. Maka...',
        'Merpati memiliki sayap', ['Merpati tidak bersayap', 'Semua bersayap adalah merpati', 'Merpati bukan burung']],
      ['Jika hujan maka jalan basah. Hari ini jalan tidak basah. Maka...',
        'Hari ini tidak hujan', ['Hari ini hujan', 'Jalan selalu basah', 'Tidak dapat disimpulkan']],
      ['A lebih tinggi dari B. B lebih tinggi dari C. Siapa paling tinggi?',
        'A', ['B', 'C', 'Sama tinggi']],
      ['Semua siswa rajin lulus ujian. Budi lulus ujian. Maka...',
        'Budi belum tentu rajin', ['Budi pasti rajin', 'Budi tidak rajin', 'Budi bukan siswa']],
      ['Andi lebih muda dari Budi. Citra lebih tua dari Budi. Siapa paling tua?',
        'Citra', ['Andi', 'Budi', 'Tidak diketahui']],
      ['Jika x > 5 dan x < 8, maka nilai bulat x adalah...',
        '6 atau 7', ['5 atau 8', 'Hanya 6', 'Lebih dari 8']],
      ['Semua logam menghantarkan listrik. Besi adalah logam. Maka besi...',
        'Menghantarkan listrik', ['Tidak menghantarkan listrik', 'Bukan logam', 'Isolator']],
      ['Dalam satu minggu ada 7 hari. Dalam 3 minggu ada berapa hari?',
        '21 hari', ['14 hari', '24 hari', '28 hari']],
      ['Urutan yang benar dari kecil ke besar: 0,5 — 0,05 — 0,55',
        '0,05 — 0,5 — 0,55', ['0,5 — 0,05 — 0,55', '0,55 — 0,5 — 0,05', '0,05 — 0,55 — 0,5']],
      ['Jika hari ini Senin, maka 3 hari kemudian adalah...',
        'Kamis', ['Rabu', 'Jumat', 'Sabtu']]
    ];
    logic.forEach(([text, correct, distractors]) => {
      const s = shuffled(correct, distractors);
      push(PU, text, s.options, s.correctIndex);
    });

    /* ---------- PPU: sinonim & antonim (20 soal) ---------- */
    const syn = [
      ['bahagia', 'riang', ['sedih', 'marah', 'kecewa']],
      ['pandai', 'cerdas', ['bodoh', 'lambat', 'malas']],
      ['besar', 'raksasa', ['kecil', 'sempit', 'tipis']],
      ['cepat', 'lekas', ['lambat', 'santai', 'lelah']],
      ['indah', 'cantik', ['buruk', 'kotor', 'kusam']],
      ['berani', 'gagah', ['takut', 'ragu', 'cemas']],
      ['sulit', 'rumit', ['mudah', 'ringan', 'sederhana']],
      ['tinggi', 'jangkung', ['pendek', 'rendah', 'kerdil']],
      ['mulai', 'awal', ['akhir', 'henti', 'tutup']],
      ['bohong', 'dusta', ['jujur', 'benar', 'nyata']]
    ];
    syn.forEach(([w, correct, d]) => {
      const s = shuffled(correct, d);
      push(PPU, `Sinonim dari kata "${w}" adalah...`, s.options, s.correctIndex);
    });
    const ant = [
      ['tinggi', 'rendah', ['jangkung', 'besar', 'panjang']],
      ['tebal', 'tipis', ['lebar', 'berat', 'keras']],
      ['maju', 'mundur', ['jalan', 'cepat', 'lurus']],
      ['terang', 'gelap', ['cerah', 'silau', 'putih']],
      ['kaya', 'miskin', ['hemat', 'mewah', 'banyak']],
      ['eksplisit', 'implisit', ['tersurat', 'tegas', 'jelas']],
      ['optimis', 'pesimis', ['yakin', 'senang', 'tenang']],
      ['naik', 'turun', ['tetap', 'melaju', 'tumbuh']],
      ['panas', 'dingin', ['hangat', 'sejuk', 'kering']],
      ['banyak', 'sedikit', ['penuh', 'padat', 'besar']]
    ];
    ant.forEach(([w, correct, d]) => {
      const s = shuffled(correct, d);
      push(PPU, `Antonim dari kata "${w}" adalah...`, s.options, s.correctIndex);
    });

    /* ---------- PBM: kaidah bahasa (14 soal) ---------- */
    const pbm = [
      ['Kalimat manakah yang paling efektif?', 'Siswa sedang belajar.',
        ['Para siswa-siswa sedang belajar.', 'Siswa sedang belajar-belajar.', 'Para siswa semuanya sedang belajar bersama-sama.']],
      ['Manakah penulisan baku dari kata yang bermakna “penerapan langsung”?', 'praktik', ['praktek', 'pratik', 'practik']],
      ['Manakah penulisan baku dari kata yang bermakna “penguraian masalah”?', 'analisis', ['analisa', 'analysis', 'analise']],
      ['Manakah penulisan baku dari kata yang bermakna “kegiatan”?', 'aktivitas', ['aktifitas', 'activitas', 'aktipitas']],
      ['Manakah penulisan baku dari kata yang bermakna “kemungkinan rugi”?', 'risiko', ['resiko', 'risico', 'resico']],
      ['Manakah penulisan baku dari kata yang bermakna “daftar waktu kegiatan”?', 'jadwal', ['jadual', 'jadwall', 'jadwal-']],
      ['Manakah penulisan baku dari kata yang bermakna “cara atau metode kerja”?', 'teknik', ['tehnik', 'tekhnik', 'technik']],
      ['Manakah penulisan baku dari kata yang bermakna “udara yang dihirup”?', 'napas', ['nafas', 'nampas', 'nafass']],
      ['Imbuhan yang tepat: "Dia ... surat itu kemarin."', 'menulis', ['ditulis', 'tertulis', 'penulis']],
      ['Kata hubung yang tepat: "Dia rajin ... nilainya bagus."', 'sehingga', ['tetapi', 'meskipun', 'atau']],
      ['Gagasan utama paragraf biasanya terdapat pada...', 'kalimat utama', ['kalimat penjelas', 'tanda baca', 'kata hubung']],
      ['Tanda baca yang tepat mengakhiri kalimat tanya adalah...', 'tanda tanya (?)', ['tanda titik (.)', 'tanda seru (!)', 'tanda koma (,)']],
      ['Kalimat berikut yang menggunakan huruf kapital dengan benar:', 'Saya tinggal di Kota Medan.',
        ['saya tinggal di kota medan.', 'Saya Tinggal Di Kota Medan.', 'SAYA tinggal di Kota medan.']],
      ['Bentuk pasif dari "Ibu memasak nasi" adalah...', 'Nasi dimasak ibu', ['Ibu dimasak nasi', 'Nasi memasak ibu', 'Ibu memasakkan nasi']]
    ];
    pbm.forEach(([text, correct, d]) => {
      const s = shuffled(correct, d);
      push(PBM, text, s.options, s.correctIndex);
    });

    /* ---------- Literasi Bahasa Inggris (10 soal) ---------- */
    const eng = [
      ['Choose the correct sentence.', "She doesn't like coffee.",
        ["She don't like coffee.", "She doesn't likes coffee.", 'She not like coffee.']],
      ['The word "significant" is closest in meaning to...', 'important', ['tiny', 'unclear', 'random']],
      ['The opposite of "increase" is...', 'decrease', ['grow', 'expand', 'raise']],
      ['Complete: "They ... to school every day."', 'go', ['goes', 'going', 'gone']],
      ['Complete: "I have ... my homework."', 'finished', ['finish', 'finishing', 'finishes']],
      ['The word "difficult" is closest in meaning to...', 'hard', ['easy', 'simple', 'light']],
      ['Choose the correct plural of "child".', 'children', ['childs', 'childes', 'childrens']],
      ['Complete: "She is good ... mathematics."', 'at', ['in', 'on', 'for']],
      ['The word "rapid" is closest in meaning to...', 'fast', ['slow', 'late', 'calm']],
      ['Complete: "If it rains, we ... stay home."', 'will', ['would', 'were', 'have']]
    ];
    eng.forEach(([text, correct, d]) => {
      const s = shuffled(correct, d);
      push(LBING, text, s.options, s.correctIndex);
    });

    /* ---------- Penalaran Matematika: soal cerita (12 soal) ---------- */
    const story = [
      ['Sebuah mobil menempuh 180 km dalam 3 jam. Kecepatan rata-ratanya adalah...', '60 km/jam', ['50 km/jam', '55 km/jam', '65 km/jam']],
      ['Harga baju Rp200.000 didiskon 25%. Harga setelah diskon adalah...', 'Rp150.000', ['Rp175.000', 'Rp160.000', 'Rp125.000']],
      ['Ani membeli 3 buku @Rp15.000. Total yang dibayar adalah...', 'Rp45.000', ['Rp30.000', 'Rp50.000', 'Rp60.000']],
      ['Sebuah persegi memiliki sisi 7 cm. Luasnya adalah...', '49 cm²', ['14 cm²', '28 cm²', '56 cm²']],
      ['Keliling persegi panjang dengan panjang 8 cm dan lebar 5 cm adalah...', '26 cm', ['13 cm', '40 cm', '30 cm']],
      ['Jika 1 lusin = 12 buah, maka 3 lusin sama dengan...', '36 buah', ['24 buah', '30 buah', '48 buah']],
      ['Sebuah tangki berisi 60 liter air, terpakai 1/3 bagian. Sisa air adalah...', '40 liter', ['20 liter', '30 liter', '45 liter']],
      ['Perbandingan 2 : 3 dari 25 permen, bagian terkecil adalah...', '10 permen', ['15 permen', '5 permen', '12 permen']],
      ['Luas segitiga dengan alas 10 cm dan tinggi 6 cm adalah...', '30 cm²', ['60 cm²', '16 cm²', '45 cm²']],
      ['Sebuah pekerjaan selesai 5 hari oleh 4 orang. Bila 8 orang, perkiraan waktunya...', '2,5 hari', ['10 hari', '5 hari', '4 hari']],
      ['Jika suhu naik dari -3°C menjadi 7°C, kenaikannya adalah...', '10°C', ['4°C', '7°C', '3°C']],
      ['Bilangan prima antara 10 dan 20 ada berapa?', '4', ['3', '5', '6']]
    ];
    story.forEach(([text, correct, d]) => {
      const s = shuffled(correct, d);
      push(PM, text, s.options, s.correctIndex);
    });

    /* ---------- Literasi Bahasa Indonesia (8 soal) ---------- */
    const lit = [
      ['Teks yang bertujuan meyakinkan pembaca disebut teks...', 'persuasi', ['narasi', 'deskripsi', 'laporan']],
      ['Teks yang menceritakan rangkaian peristiwa disebut teks...', 'narasi', ['eksposisi', 'persuasi', 'prosedur']],
      ['Bagian akhir teks yang berisi kesimpulan disebut...', 'penutup', ['pembuka', 'isi', 'judul']],
      ['Kalimat fakta ditandai dengan...', 'data yang dapat dibuktikan', ['pendapat penulis', 'kata mungkin', 'kata sebaiknya']],
      ['Ide pokok paragraf disebut juga...', 'gagasan utama', ['gagasan penjelas', 'kalimat tanya', 'simpulan akhir']],
      ['Teks prosedur berisi...', 'langkah-langkah melakukan sesuatu', ['cerita masa lalu', 'pendapat pribadi', 'gambaran tempat']],
      ['Kata rujukan "tersebut" mengacu pada...', 'hal yang sudah disebut sebelumnya', ['hal yang akan dijelaskan', 'judul teks', 'penulis teks']],
      ['Simpulan dibuat berdasarkan...', 'isi keseluruhan teks', ['judul saja', 'kalimat pertama saja', 'pendapat pembaca']]
    ];
    lit.forEach(([text, correct, d]) => {
      const s = shuffled(correct, d);
      push(LBIND, text, s.options, s.correctIndex);
    });

    return out;
  }

  /** Notifikasi terjadwal (showAt) atau milik tryout yang belum/tidak lagi terbit disembunyikan. */
  function notifShown(n, now) {
    if (Number(n.showAt) > now) return false;
    if (n.tryoutId) {
      const c = findById(KEYS.cbts, n.tryoutId);
      if (!c || c.status !== 'published' || (Number(c.publishAt) || 0) > now) return false;
    }
    return true;
  }

  /** Format tanggal YYYY-MM-DD dari timestamp/Date. */
  function ymdOf(ts) {
    const d = ts instanceof Date ? ts : new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function seedIfNeeded() {
    // Migrate: wipe any older seed version so new demo entities (orang tua,
    // password kelas, notifikasi) are created consistently.
    const OLD_SEEDS = ['lms_seeded_v1', 'lms_seeded_v2', 'lms_seeded_v3', 'lms_seeded_v4', 'lms_seeded_v5'];
    const staleSeed = OLD_SEEDS.find(k => localStorage.getItem(k) === '1');
    if (staleSeed && localStorage.getItem(KEYS.seeded) !== '1') {
      Object.keys(KEYS).forEach(k => localStorage.removeItem(KEYS[k]));
      EXTRA_KEYS.forEach(k => localStorage.removeItem(k));
      OLD_SEEDS.forEach(k => localStorage.removeItem(k));
    }
    if (localStorage.getItem(KEYS.seeded) === '1') return;

    const now = Date.now();
    const DAY = 86400000;

    /* ===== Guru (tutor) =====
     * Satu subtest bisa diajar beberapa tutor, dan satu kelas subtest bisa
     * dibina lebih dari satu tutor (lihat courses.teacherIds).
     */
    const users = [
      { id: 'u_admin', role: 'admin', username: 'admin', password: 'admin123', name: 'Administrator', email: 'admin@rubela.edu' },
      { id: 'u_guru1', role: 'guru', username: 'guru1', password: 'guru123', name: 'Bu Maria Simbolon', email: 'maria@rubela.edu',
        subject: SUBTESTS[3].name, whatsapp: '081311110001', salaryRate: 3000000, status: 'Aktif',
        teachDays: ['Senin', 'Kamis'], teachTime: '16:00' },
      { id: 'u_guru2', role: 'guru', username: 'guru2', password: 'guru123', name: 'Bu Irana Dewi', email: 'irana@rubela.edu',
        subject: SUBTESTS[3].name, whatsapp: '081311110002', salaryRate: 2900000, status: 'Aktif',
        teachDays: ['Selasa', 'Jumat'], teachTime: '16:00' },
      { id: 'u_guru3', role: 'guru', username: 'guru3', password: 'guru123', name: 'Pak Budi Santoso', email: 'budi@rubela.edu',
        subject: SUBTESTS[0].name, whatsapp: '081311110003', salaryRate: 3100000, status: 'Aktif',
        teachDays: ['Rabu'], teachTime: '19:00' },
      { id: 'u_guru4', role: 'guru', username: 'guru4', password: 'guru123', name: 'Bu Sari Wulandari', email: 'sari@rubela.edu',
        subject: SUBTESTS[4].name, whatsapp: '081311110004', salaryRate: 2800000, status: 'Aktif',
        teachDays: ['Sabtu'], teachTime: '09:00' },

      /* ===== Siswa =====
       * kelas = KELAS UTAMA (Kelas 10/11/12) yang memisahkan ratusan siswa.
       * Kelas subtest diisi dengan memilih kelas utama, bukan satu per satu.
       */
      { id: 'u_siswa1', role: 'siswa', username: 'siswa1', password: 'siswa123', name: 'Andi Pratama', email: 'andi@siswa.edu',
        kelas: 'Kelas 11-A', targetUniv: 'Universitas Indonesia', targetMajor: 'Teknik Informatika', phone: '081200000001', status: 'Aktif' },
      { id: 'u_siswa2', role: 'siswa', username: 'siswa2', password: 'siswa123', name: 'Dewi Anggraini', email: 'dewi@siswa.edu',
        kelas: 'Kelas 11-A', targetUniv: 'Institut Teknologi Bandung', targetMajor: 'Teknik Elektro', phone: '081200000002', status: 'Aktif' },
      { id: 'u_siswa3', role: 'siswa', username: 'siswa3', password: 'siswa123', name: 'Rendy Kurniawan', email: 'rendy@siswa.edu',
        kelas: 'Kelas 11-B', targetUniv: 'Universitas Gadjah Mada', targetMajor: 'Kedokteran', phone: '081200000003', status: 'Aktif' },
      { id: 'u_siswa4', role: 'siswa', username: 'siswa4', password: 'siswa123', name: 'Putri Lestari', email: 'putri@siswa.edu',
        kelas: 'Kelas 12-A', targetUniv: 'Universitas Airlangga', targetMajor: 'Farmasi', phone: '081200000004', status: 'Aktif' },
      { id: 'u_siswa5', role: 'siswa', username: 'siswa5', password: 'siswa123', name: 'Bagas Nugroho', email: 'bagas@siswa.edu',
        kelas: 'Kelas 12-A', targetUniv: 'Institut Teknologi Sepuluh Nopember', targetMajor: 'Sistem Informasi', phone: '081200000005', status: 'Aktif' },
      { id: 'u_siswa6', role: 'siswa', username: 'siswa6', password: 'siswa123', name: 'Salsa Ramadhani', email: 'salsa@siswa.edu',
        kelas: 'Kelas 10-A', targetUniv: 'Universitas Padjadjaran', targetMajor: 'Hukum', phone: '081200000006', status: 'Aktif' },

      // Orang tua / wali: memantau perkembangan anak (childIds -> id siswa)
      { id: 'u_ortu1', role: 'orangtua', username: 'ortu1', password: 'ortu123', name: 'Bapak Hendra Pratama', email: 'hendra@wali.edu',
        phone: '081300000001', relation: 'Ayah', childIds: ['u_siswa1'] },
      { id: 'u_ortu2', role: 'orangtua', username: 'ortu2', password: 'ortu123', name: 'Ibu Ratna Anggraini', email: 'ratna@wali.edu',
        phone: '081300000002', relation: 'Ibu', childIds: ['u_siswa2', 'u_siswa3'] }
    ];

    /* ===== Kelas Subtest =====
     * Satu kelas = 1 subtest + kelas utama yang mengisinya + 1..n tutor +
     * jadwal mengajar. Contoh: "Kelas 11 - PK bersama Bu Maria" dan
     * "Kelas 11 - PK bersama Bu Irana" adalah dua kelas berbeda.
     */
    const courses = [
      { id: 'c_pk_11a', subtest: SUBTESTS[3].name, label: '',
        mainClasses: ['Kelas 11-A'], teacherIds: ['u_guru1'], teacherId: 'u_guru1',
        title: 'Kelas 11-A • Pengetahuan Kuantitatif (PK)',
        description: 'Kelas Pengetahuan Kuantitatif untuk Kelas 11-A. Fokus aljabar, barisan, dan logika bilangan.',
        category: 'TPS', price: 500000, password: 'pk2026',
        schedule: { days: ['Senin', 'Kamis'], time: '16:00', endTime: '17:30', startDate: ymdOf(now), sessions: 16 },
        meetingLink: 'https://meet.google.com/abc-defg-hij',
        createdAt: now - DAY * 10 },

      { id: 'c_pk_11b', subtest: SUBTESTS[3].name, label: '',
        mainClasses: ['Kelas 11-B'], teacherIds: ['u_guru2'], teacherId: 'u_guru2',
        title: 'Kelas 11-B • Pengetahuan Kuantitatif (PK)',
        description: 'Kelas Pengetahuan Kuantitatif untuk Kelas 11-B dengan pendekatan latihan intensif.',
        category: 'TPS', price: 500000, password: '',
        schedule: { days: ['Selasa', 'Jumat'], time: '16:00', endTime: '17:30', startDate: ymdOf(now), sessions: 16 },
        meetingLink: 'https://zoom.us/j/1234567890',
        createdAt: now - DAY * 9 },

      { id: 'c_pu_12', subtest: SUBTESTS[0].name, label: 'Gabungan',
        mainClasses: ['Kelas 12-A'], teacherIds: ['u_guru3', 'u_guru1'], teacherId: 'u_guru3',
        title: 'Kelas 12-A • Penalaran Umum (PU)',
        description: 'Kelas Penalaran Umum gabungan dua tutor untuk Kelas 12-A.',
        category: 'TPS', price: 550000, password: '',
        schedule: { days: ['Rabu'], time: '19:00', endTime: '20:30', startDate: ymdOf(now), sessions: 12 },
        meetingLink: 'https://meet.google.com/xyz-1234-abc',
        createdAt: now - DAY * 8 },

      { id: 'c_lbind_10', subtest: SUBTESTS[4].name, label: '',
        mainClasses: ['Kelas 10-A'], teacherIds: ['u_guru4'], teacherId: 'u_guru4',
        title: 'Kelas 10-A • Literasi dalam Bahasa Indonesia',
        description: 'Literasi Bahasa Indonesia untuk Kelas 10-A: pemahaman bacaan dan penalaran teks.',
        category: 'Literasi', price: 450000, password: '',
        schedule: { days: ['Sabtu'], time: '09:00', endTime: '10:30', startDate: ymdOf(now), sessions: 12 },
        meetingLink: '',
        createdAt: now - DAY * 7 }
    ];

    const materials = [
      { id: 'm_1', courseId: 'c_pk_11a', title: 'Bilangan Bulat', content: 'Bilangan bulat meliputi bilangan positif, nol, dan negatif. Operasi dasar: + - x :.', link: '', createdBy: 'u_guru1', createdAt: now - DAY * 8 },
      { id: 'm_2', courseId: 'c_pk_11a', title: 'Persamaan Linear', content: 'Bentuk umum ax + b = 0. Pelajari cara mencari nilai x.', link: '', createdBy: 'u_guru1', createdAt: now - DAY * 5 },
      { id: 'm_3', courseId: 'c_lbind_10', title: 'Kalimat Efektif', content: 'Ciri kalimat efektif: kesatuan, kehematan, kepaduan, kelogisan.', link: '', createdBy: 'u_guru4', createdAt: now - DAY * 3 }
    ];

    const modules = [
      {
        id: 'mod_1', courseId: 'c_pk_11a', title: 'Modul 1 - Aljabar Dasar',
        description: 'Modul pengantar aljabar dengan latihan.',
        sections: [
          { title: 'Pengertian Variabel', content: 'Variabel adalah simbol (biasanya huruf) yang mewakili nilai yang belum diketahui.' },
          { title: 'Operasi pada Variabel', content: 'Operasi +, -, *, / dapat dilakukan pada variabel sesuai aturan.' },
          { title: 'Latihan', content: 'Kerjakan soal 1-5 pada buku halaman 25.' }
        ],
        link: '', createdBy: 'u_guru1', createdAt: now - DAY * 9
      },
      {
        id: 'mod_2', courseId: 'c_lbind_10', title: 'Modul 1 - Kaidah Bahasa',
        description: 'Dasar-dasar kaidah Bahasa Indonesia.',
        sections: [
          { title: 'EYD', content: 'Ejaan yang Disempurnakan - panduan penulisan resmi.' },
          { title: 'Tanda Baca', content: 'Penggunaan tanda baca yang benar.' }
        ],
        link: '', createdBy: 'u_guru4', createdAt: now - DAY * 4
      }
    ];

    const recordings = [
      { id: 'rec_1', courseId: 'c_pk_11a', title: 'Pertemuan 1 - Pengantar', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 3600, recordedAt: now - DAY * 8, notes: 'Membahas bab 1 dan 2.', createdBy: 'u_guru1', createdAt: now - DAY * 8 },
      { id: 'rec_2', courseId: 'c_pk_11a', title: 'Pertemuan 2 - Aljabar', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 3300, recordedAt: now - DAY * 4, notes: 'Latihan soal aljabar.', createdBy: 'u_guru1', createdAt: now - DAY * 4 },
      { id: 'rec_3', courseId: 'c_lbind_10', title: 'Pertemuan 1 - EYD', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 2700, recordedAt: now - DAY * 3, notes: 'Pengantar EYD.', createdBy: 'u_guru4', createdAt: now - DAY * 3 }
    ];

    const assignments = [
      { id: 'a_1', courseId: 'c_pk_11a', title: 'Latihan Persamaan Linear', description: 'Kerjakan 5 soal tentang persamaan linear satu variabel.', dueDate: now + DAY * 5, createdBy: 'u_guru1', createdAt: now - DAY * 4 },
      { id: 'a_2', courseId: 'c_lbind_10', title: 'Esai Singkat', description: 'Tulis esai 300 kata tentang pahlawan favoritmu.', dueDate: now + DAY * 7, createdBy: 'u_guru4', createdAt: now - DAY * 2 }
    ];

    const submissions = [
      { id: 's_1', assignmentId: 'a_1', studentId: 'u_siswa1', content: 'Jawaban soal 1: x = 3 ... dst.', submittedAt: now - DAY, grade: 85, feedback: 'Bagus, cek kembali soal nomor 3.' }
    ];

    const enrollments = [
      { id: 'e_1', courseId: 'c_pk_11a', studentId: 'u_siswa1', enrolledAt: now - DAY * 6 },
      { id: 'e_2', courseId: 'c_pk_11a', studentId: 'u_siswa2', enrolledAt: now - DAY * 5 },
      { id: 'e_3', courseId: 'c_lbind_10', studentId: 'u_siswa6', enrolledAt: now - DAY * 3 },
      { id: 'e_4', courseId: 'c_pk_11b', studentId: 'u_siswa3', enrolledAt: now - DAY * 4 },
      { id: 'e_5', courseId: 'c_pu_12', studentId: 'u_siswa4', enrolledAt: now - DAY * 4 },
      { id: 'e_6', courseId: 'c_pu_12', studentId: 'u_siswa5', enrolledAt: now - DAY * 4 }
    ];

    // Bank soal — memakai nama subtest UTBK resmi agar bisa dikelompokkan
    const N = (code) => SUBTESTS.find(s => s.code === code).name;
    const questions = [
      /* ---- Penalaran Umum (PU) ---- */
      { id: 'q_pu1', authorId: 'u_guru3', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Semua siswa yang rajin memperoleh nilai baik. Andi memperoleh nilai baik. Kesimpulan yang tepat adalah...',
        options: ['Andi pasti rajin', 'Andi belum tentu rajin', 'Andi tidak rajin', 'Andi malas'],
        correctIndex: 1, explanation: 'Premis tidak dapat dibalik; nilai baik bisa disebabkan hal lain.' },
      { id: 'q_pu2', authorId: 'u_guru3', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Lanjutkan pola bilangan: 2, 6, 12, 20, 30, ...',
        options: ['40', '42', '44', '46'], correctIndex: 1, explanation: 'Selisih bertambah 2: +4,+6,+8,+10,+12 → 30+12 = 42.' },
      { id: 'q_pu3', authorId: 'u_guru3', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'sulit',
        text: 'Jika P lebih tinggi dari Q, Q lebih tinggi dari R, dan S lebih rendah dari R, siapa yang paling rendah?',
        options: ['P', 'Q', 'R', 'S'], correctIndex: 3, explanation: 'Urutan: P > Q > R > S, jadi S paling rendah.' },

      /* ---- Pengetahuan dan Pemahaman Umum (PPU) ---- */
      { id: 'q_ppu1', authorId: 'u_guru2', subject: N('PPU'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Sinonim yang paling tepat untuk kata "bahagia" adalah...',
        options: ['sedih', 'riang', 'marah', 'kecewa'], correctIndex: 1, explanation: 'Riang bermakna senang/bahagia.' },
      { id: 'q_ppu2', authorId: 'u_guru2', subject: N('PPU'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Antonim dari kata "eksplisit" adalah...',
        options: ['tersurat', 'implisit', 'tegas', 'nyata'], correctIndex: 1, explanation: 'Eksplisit = tersurat; antonimnya implisit (tersirat).' },

      /* ---- Kemampuan Memahami Bacaan dan Menulis (PBM) ---- */
      { id: 'q_pbm1', authorId: 'u_guru2', subject: N('PBM'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Kalimat berikut yang paling efektif adalah...',
        options: [
          'Para siswa-siswa sedang belajar.',
          'Siswa sedang belajar.',
          'Para siswa sedang belajar-belajar.',
          'Siswa-siswa sedang belajar bersama sama-sama.'
        ], correctIndex: 1, explanation: 'Hindari pengulangan makna (prinsip kehematan).' },
      { id: 'q_pbm2', authorId: 'u_guru2', subject: N('PBM'), questionType: 'Benar/Salah', difficulty: 'mudah',
        text: 'Kalimat "Kepada Bapak Kepala Sekolah, waktu dan tempat kami persilakan." sudah baku.',
        options: ['Benar', 'Salah'], correctIndex: 1, explanation: 'Tidak baku; yang dipersilakan orangnya, bukan waktu dan tempat.' },

      /* ---- Pengetahuan Kuantitatif (PK) ---- */
      { id: 'q_pk1', authorId: 'u_guru1', subject: N('PK'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Berapakah hasil dari 3 + 4 × 2?',
        options: ['14', '11', '10', '12'], correctIndex: 1, explanation: 'Perkalian dulu: 4×2=8, lalu 3+8=11.' },
      { id: 'q_pk2', authorId: 'u_guru1', subject: N('PK'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Nilai x dari 2x + 5 = 11 adalah...',
        options: ['2', '3', '4', '5'], correctIndex: 1, explanation: '2x = 6, maka x = 3.' },
      { id: 'q_pk3', authorId: 'u_guru1', subject: N('PK'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Hasil dari 5! (faktorial) adalah...',
        options: ['60', '100', '120', '150'], correctIndex: 2, explanation: '5! = 5×4×3×2×1 = 120.' },

      /* ---- Literasi dalam Bahasa Indonesia ---- */
      { id: 'q_lbind1', authorId: 'u_guru4', subject: N('LBIND'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Gagasan utama sebuah paragraf umumnya dapat ditemukan pada...',
        options: ['kalimat penjelas', 'kalimat topik', 'kata hubung', 'tanda baca'],
        correctIndex: 1, explanation: 'Gagasan utama terdapat pada kalimat topik (kalimat utama).' },
      { id: 'q_lbind2', authorId: 'u_guru4', subject: N('LBIND'), questionType: 'Esai', difficulty: 'sulit',
        text: 'Tuliskan simpulan Anda mengenai dampak literasi digital bagi pelajar (maksimal 100 kata).',
        options: [], correctIndex: null, explanation: 'Dinilai manual oleh guru.' },

      /* ---- Literasi dalam Bahasa Inggris ---- */
      { id: 'q_lbing1', authorId: 'u_guru4', subject: N('LBING'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Choose the correct sentence.',
        options: ['She don\'t like coffee.', 'She doesn\'t likes coffee.', 'She doesn\'t like coffee.', 'She not like coffee.'],
        correctIndex: 2, explanation: 'Third person singular uses "doesn\'t" + base verb.' },
      { id: 'q_lbing2', authorId: 'u_guru4', subject: N('LBING'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'The word "significant" is closest in meaning to...',
        options: ['tiny', 'important', 'unclear', 'random'], correctIndex: 1, explanation: 'Significant = important/considerable.' },

      /* ---- Penalaran Matematika ---- */
      { id: 'q_pm1', authorId: 'u_guru1', subject: N('PM'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Sebuah mobil menempuh 180 km dalam 3 jam. Berapa kecepatan rata-ratanya?',
        options: ['50 km/jam', '55 km/jam', '60 km/jam', '65 km/jam'], correctIndex: 2, explanation: '180 ÷ 3 = 60 km/jam.' },
      { id: 'q_pm2', authorId: 'u_guru1', subject: N('PM'), questionType: 'Pilihan Ganda', difficulty: 'sulit',
        text: 'Diskon 20% lalu tambahan diskon 10% pada harga Rp500.000 menghasilkan harga akhir...',
        options: ['Rp350.000', 'Rp360.000', 'Rp375.000', 'Rp400.000'], correctIndex: 1,
        explanation: '500.000 × 0,8 = 400.000; lalu × 0,9 = 360.000.' }
    ];

    /* CBT: mendukung banyak kelas tujuan (tingkat), deskripsi, pengaturan
     * keamanan, dan pembagian per subtest (sections) untuk mode gabungan. */
    const cbts = [
      {
        id: 'cbt_1',
        title: 'Ujian Harian - Pengetahuan Kuantitatif',
        description: 'Ujian singkat materi aljabar dasar dan operasi bilangan. Pastikan koneksi internet stabil sebelum memulai.',
        courseId: 'c_pk_11a',
        courseIds: ['c_pk_11a'],
        targetClasses: ['Kelas 11-A', 'Kelas 11-B'],
        subtestMode: 'single',
        selectedSubtest: N('PK'),
        sections: [
          { subtest: N('PK'), questionIds: ['q_pk1', 'q_pk2', 'q_pk3'], durationMinutes: 15 }
        ],
        questionIds: ['q_pk1', 'q_pk2', 'q_pk3'],
        durationMinutes: 15,
        security: { requireCamera: false, requireMic: false, fullscreen: false, blockTabSwitch: true, maxViolations: 5 },
        startAt: now - DAY * 2, endAt: now + DAY * 5,
        createdBy: 'u_guru1',
        createdAt: now - DAY * 3
      },
      {
        id: 'cbt_2',
        title: 'Try Out UTBK - Gabungan 7 Subtest',
        description: 'Simulasi UTBK lengkap. Subtest dikerjakan berurutan mulai dari Penalaran Umum. Kamera dan mikrofon wajib aktif selama ujian untuk pemantauan.',
        courseId: 'c_pk_11a',
        courseIds: ['c_pk_11a', 'c_pk_11b', 'c_pu_12'],
        targetClasses: [ALL_CLASSES],
        subtestMode: 'full',
        selectedSubtest: null,
        sections: [
          { subtest: N('PU'),    questionIds: ['q_pu1', 'q_pu2', 'q_pu3'], durationMinutes: 10 },
          { subtest: N('PPU'),   questionIds: ['q_ppu1', 'q_ppu2'],        durationMinutes: 5 },
          { subtest: N('PBM'),   questionIds: ['q_pbm1', 'q_pbm2'],        durationMinutes: 5 },
          { subtest: N('PK'),    questionIds: ['q_pk1', 'q_pk2', 'q_pk3'], durationMinutes: 10 },
          { subtest: N('LBIND'), questionIds: ['q_lbind1'],                durationMinutes: 5 },
          { subtest: N('LBING'), questionIds: ['q_lbing1', 'q_lbing2'],    durationMinutes: 5 },
          { subtest: N('PM'),    questionIds: ['q_pm1', 'q_pm2'],          durationMinutes: 10 }
        ],
        questionIds: ['q_pu1', 'q_pu2', 'q_pu3', 'q_ppu1', 'q_ppu2', 'q_pbm1', 'q_pbm2',
                      'q_pk1', 'q_pk2', 'q_pk3', 'q_lbind1', 'q_lbing1', 'q_lbing2', 'q_pm1', 'q_pm2'],
        durationMinutes: 50,
        security: { requireCamera: true, requireMic: true, fullscreen: true, blockTabSwitch: true, maxViolations: 3 },
        startAt: now - DAY, endAt: now + DAY * 14,
        createdBy: 'u_guru1',
        createdAt: now - DAY * 2
      }
    ];

    const cbtAttempts = [
      { id: 'att_1', cbtId: 'cbt_1', studentId: 'u_siswa1',
        answers: { q_pk1: 1, q_pk2: 1, q_pk3: 2 },
        score: 100, correctCount: 3, totalCount: 3,
        sectionScores: [{ subtest: N('PK'), correct: 3, total: 3, score: 100 }],
        violations: [],
        startedAt: now - DAY * 1, submittedAt: now - DAY * 1 + 600000 }
    ];

    // Attendance records (date stored as YYYY-MM-DD string)
    const today = new Date();
    const ymd = (d) => {
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    };
    const t0 = ymd(today);
    const tm1 = ymd(new Date(Date.now() - DAY));
    const tm2 = ymd(new Date(Date.now() - DAY * 2));
    const attendance = [
      { id: 'at_1', courseId: 'c_pk_11a', userId: 'u_guru1', role: 'guru', date: tm2, status: 'hadir', note: '', createdAt: now - DAY * 2 },
      { id: 'at_2', courseId: 'c_pk_11a', userId: 'u_siswa1', role: 'siswa', date: tm2, status: 'hadir', note: '', createdAt: now - DAY * 2 },
      { id: 'at_3', courseId: 'c_pk_11a', userId: 'u_siswa2', role: 'siswa', date: tm2, status: 'izin', note: 'Sakit', createdAt: now - DAY * 2 },
      { id: 'at_4', courseId: 'c_pk_11a', userId: 'u_guru1', role: 'guru', date: tm1, status: 'hadir', note: '', createdAt: now - DAY },
      { id: 'at_5', courseId: 'c_pk_11a', userId: 'u_siswa1', role: 'siswa', date: tm1, status: 'hadir', note: '', createdAt: now - DAY },
      { id: 'at_6', courseId: 'c_lbind_10', userId: 'u_guru4', role: 'guru', date: t0, status: 'hadir', note: '', createdAt: now }
    ];

    const payments = [
      { id: 'pay_1', studentId: 'u_siswa1', courseId: 'c_pk_11a', amount: 500000, method: 'transfer', status: 'lunas', kind: 'spp', note: 'SPP kelas PK Kelas 11-A', paidAt: now - DAY * 6, createdAt: now - DAY * 6 },
      { id: 'pay_2', studentId: 'u_siswa2', courseId: 'c_pk_11a', amount: 500000, method: 'transfer', status: 'lunas', kind: 'spp', note: 'SPP kelas PK Kelas 11-A', paidAt: now - DAY * 5, createdAt: now - DAY * 5 },
      { id: 'pay_3', studentId: 'u_siswa6', courseId: 'c_lbind_10', amount: 450000, method: 'cash', status: 'lunas', kind: 'spp', note: 'SPP kelas Literasi Indonesia Kelas 10-A', paidAt: now - DAY * 3, createdAt: now - DAY * 3 },
      { id: 'pay_4', studentId: 'u_siswa3', courseId: 'c_pk_11b', amount: 50000, method: 'cash', status: 'lunas', kind: 'denda', fineReason: 'Terlambat membayar SPP', note: 'Denda keterlambatan pembayaran SPP', paidAt: now - DAY * 2, createdAt: now - DAY * 2 }
    ];

    const expenses = [
      { id: 'ex_1', category: 'Operasional', amount: 250000, note: 'Listrik dan internet', date: tm2, createdAt: now - DAY * 2 },
      { id: 'ex_2', category: 'Logistik', amount: 150000, note: 'ATK & fotokopi modul', date: tm1, createdAt: now - DAY }
    ];

    const salaries = [
      { id: 'sal_1', teacherId: 'u_guru1', period: periodKey(new Date(now - DAY * 30)), amount: 3000000, status: 'dibayar', note: 'Gaji bulanan', paidAt: now - DAY * 28, createdAt: now - DAY * 30 }
    ];

    const notifications = [
      { id: 'nt_1', userId: 'u_siswa1', type: 'nilai', icon: '🏆', title: 'Tugas dinilai', body: 'Latihan Persamaan Linear mendapat nilai 85.', link: 'grades', read: false, createdAt: now - 3600000 },
      { id: 'nt_2', userId: 'u_siswa1', type: 'tugas', icon: '📝', title: 'Tugas baru', body: 'Esai Singkat di kelas Bahasa Indonesia.', link: 'assignments', read: false, createdAt: now - 7200000 },
      { id: 'nt_3', userId: 'u_ortu1', type: 'absensi', icon: '📋', title: 'Rekap kehadiran anak', body: 'Andi Pratama hadir pada sesi Matematika Dasar.', link: 'anak-absensi', read: false, createdAt: now - 5400000 },
      { id: 'nt_4', userId: 'u_guru1', type: 'tugas', icon: '✅', title: 'Submission masuk', body: 'Andi Pratama mengumpulkan Latihan Persamaan Linear.', link: 'grading', read: false, createdAt: now - 9000000 }
    ];

    /* ===== War Jadwal Kelas (rencana kelas bulanan) =====
     * Tutor mengisi rencana mulai H-3, memvalidasi (fix) mulai H-5, dan boleh
     * mengubah bila mendadak tidak bisa mengajar.
     */
    const classPlans = [];
    (function seedPlans() {
      const plans = [
        { courseId: 'c_pk_11a', teacherId: 'u_guru1', offset: 0, time: '16:00', endTime: '17:30',
          topic: 'Barisan & Deret Aritmetika', status: 'fixed' },
        { courseId: 'c_pk_11a', teacherId: 'u_guru1', offset: 3, time: '16:00', endTime: '17:30',
          topic: 'Barisan & Deret Geometri', status: 'fixed' },
        { courseId: 'c_pk_11a', teacherId: 'u_guru1', offset: 7, time: '16:00', endTime: '17:30',
          topic: 'Latihan Soal Campuran', status: 'draft' },
        { courseId: 'c_pk_11b', teacherId: 'u_guru2', offset: 1, time: '16:00', endTime: '17:30',
          topic: 'Aljabar Dasar & Persamaan', status: 'fixed' },
        { courseId: 'c_pk_11b', teacherId: 'u_guru2', offset: 4, time: '16:00', endTime: '17:30',
          topic: 'Pertidaksamaan', status: 'draft' },
        { courseId: 'c_pu_12', teacherId: 'u_guru3', teacherIds: ['u_guru3', 'u_guru1'], offset: 2, time: '19:00', endTime: '20:30',
          topic: 'Silogisme & Penarikan Kesimpulan', status: 'fixed' },
        { courseId: 'c_pu_12', teacherId: 'u_guru3', offset: 9, time: '19:00', endTime: '20:30',
          topic: 'Pola Bilangan & Analitik', status: 'draft' },
        { courseId: 'c_lbind_10', teacherId: 'u_guru4', offset: 5, time: '09:00', endTime: '10:30',
          topic: 'Gagasan Utama & Simpulan Teks', status: 'draft' }
      ];
      plans.forEach((pl, i) => {
        const course = courses.find(c => c.id === pl.courseId);
        classPlans.push({
          id: 'plan_' + (i + 1),
          courseId: pl.courseId,
          teacherId: pl.teacherId,
          teacherIds: pl.teacherIds || [pl.teacherId],
          date: ymdOf(now + pl.offset * DAY),
          time: pl.time,
          endTime: pl.endTime,
          topic: pl.topic,
          note: '',
          status: pl.status,
          meetingLink: (course && course.meetingLink) || '',
          confirmedAt: pl.status === 'fixed' ? now - DAY : null,
          createdBy: pl.teacherId,
          createdAt: now - DAY * 2,
          updatedAt: now - DAY * 2
        });
      });
    })();

    /* ===== Kata motivasi (dikelola admin, beda tiap peran) ===== */
    const motivations = [
      { id: 'mo_s1', role: 'siswa', text: 'Satu soal yang kamu kerjakan hari ini adalah satu langkah lebih dekat ke kampus impianmu.', author: 'Tim Rubela', active: true, createdAt: now },
      { id: 'mo_s2', role: 'siswa', text: 'Tidak perlu jadi yang tercepat, cukup jadi yang tidak berhenti.', author: 'Tim Rubela', active: true, createdAt: now },
      { id: 'mo_s3', role: 'siswa', text: 'Nilai hari ini bukan penentu masa depanmu, tapi kebiasaan belajarmu iya.', author: 'Tim Rubela', active: true, createdAt: now },
      { id: 'mo_s4', role: 'siswa', text: 'Kerjakan yang sulit hari ini, agar UTBK terasa mudah nanti.', author: 'Tim Rubela', active: true, createdAt: now },
      { id: 'mo_g1', role: 'guru', text: 'Satu penjelasan Anda hari ini bisa menjadi alasan seorang siswa tidak menyerah.', author: 'Manajemen Rubela', active: true, createdAt: now },
      { id: 'mo_g2', role: 'guru', text: 'Mengajar bukan mengisi wadah, tetapi menyalakan api rasa ingin tahu.', author: 'Manajemen Rubela', active: true, createdAt: now },
      { id: 'mo_g3', role: 'guru', text: 'Terima kasih sudah hadir tepat waktu — konsistensi Anda dicontoh siswa.', author: 'Manajemen Rubela', active: true, createdAt: now },
      { id: 'mo_o1', role: 'orangtua', text: 'Dukungan kecil dari rumah sering kali lebih berarti daripada seribu nasihat.', author: 'Tim Rubela', active: true, createdAt: now },
      { id: 'mo_o2', role: 'orangtua', text: 'Tanyakan “bagaimana perasaanmu belajar hari ini?”, bukan hanya “berapa nilaimu?”.', author: 'Tim Rubela', active: true, createdAt: now }
    ];

    save(KEYS.classPlans, classPlans);
    save(KEYS.motivations, motivations);
    save(KEYS.securityQuestions, buildSecurityQuestionBank());
    save(KEYS.settings, {
      loginQuizEnabled: true,
      loginQuizRoles: ['siswa'],
      loginQuizAttempts: 3,
      motivationEnabled: true,
      planFillLead: PLAN_FILL_LEAD,
      planConfirmLead: PLAN_CONFIRM_LEAD,
      examSecurityDefaults: {
        requireCamera: false, requireMic: false, fullscreen: true,
        blockTabSwitch: true, blockCopy: true, blockScreenshot: true,
        detectScreenShare: true, lockScreen: true, maxViolations: 3
      }
    });
    save(KEYS.notifications, notifications);
    save(KEYS.users, users);
    save(KEYS.courses, courses);
    save(KEYS.materials, materials);
    save(KEYS.modules, modules);
    save(KEYS.recordings, recordings);
    save(KEYS.assignments, assignments);
    save(KEYS.submissions, submissions);
    save(KEYS.enrollments, enrollments);
    save(KEYS.questions, questions);
    save(KEYS.cbts, cbts);
    save(KEYS.cbtAttempts, cbtAttempts);
    save(KEYS.attendance, attendance);
    save(KEYS.payments, payments);
    save(KEYS.expenses, expenses);
    save(KEYS.salaries, salaries);
    localStorage.setItem(KEYS.seeded, '1');
  }

  function periodKey(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  }

  /* Mode server (js/sync.js): data berasal dari database bersama, jadi data
   * contoh TIDAK dibuat di browser. Migrasi dijalankan setelah data dimuat. */
  const SERVER_MODE = !!(global.Sync && global.Sync.isServer && global.Sync.isServer());
  if (!SERVER_MODE) {
    seedIfNeeded();
    runMigrations();
  }

  /**
   * Migrasi berversi yang aman: setiap langkah hanya MENAMBAH field yang belum
   * ada, tidak pernah menghapus data. Dijalankan berurutan sekali per versi.
   */
  /* =====================================================================
   * Konten awal ronde 8 (hanya dipasang sekali lewat migrasi v3)
   * ===================================================================*/
  /** Ayat motivasi belajar. Terjemahan WAJIB ditinjau admin/pemuka agama
   *  sebelum dipakai resmi (ditandai reviewed:false). */
  function seedVerses() {
    const now = Date.now();
    const V = (religion, reference, text, source) => ({
      id: uid('verse'), religion, reference, text, source, active: true, reviewed: false, date: '', createdAt: now
    });
    return [
      V('Islam', 'QS. Al-Insyirah [94]: 5–6', 'Maka sesungguhnya beserta kesulitan ada kemudahan. Sesungguhnya beserta kesulitan ada kemudahan.', 'Terjemahan Kemenag RI'),
      V('Islam', 'QS. Al-Baqarah [2]: 286', 'Allah tidak membebani seseorang melainkan sesuai dengan kesanggupannya.', 'Terjemahan Kemenag RI'),
      V('Islam', 'QS. Taha [20]: 114', '… dan katakanlah, "Ya Tuhanku, tambahkanlah ilmu kepadaku."', 'Terjemahan Kemenag RI'),
      V('Islam', 'QS. Al-Mujadilah [58]: 11', '… niscaya Allah akan mengangkat (derajat) orang-orang yang beriman di antaramu dan orang-orang yang diberi ilmu beberapa derajat.', 'Terjemahan Kemenag RI'),
      V('Kristen Protestan', 'Filipi 4:13', 'Segala perkara dapat kutanggung di dalam Dia yang memberi kekuatan kepadaku.', 'Alkitab Terjemahan Baru (LAI)'),
      V('Kristen Protestan', 'Amsal 16:3', 'Serahkanlah perbuatanmu kepada TUHAN, maka terlaksanalah segala rencanamu.', 'Alkitab Terjemahan Baru (LAI)'),
      V('Kristen Protestan', 'Kolose 3:23', 'Apa pun juga yang kamu perbuat, perbuatlah dengan segenap hatimu seperti untuk Tuhan dan bukan untuk manusia.', 'Alkitab Terjemahan Baru (LAI)'),
      V('Katolik', 'Mazmur 119:105', 'Firman-Mu itu pelita bagi kakiku dan terang bagi jalanku.', 'Alkitab Deuterokanonika (LAI)'),
      V('Katolik', 'Yeremia 29:11', 'Sebab Aku ini mengetahui rancangan-rancangan apa yang ada pada-Ku mengenai kamu, demikianlah firman TUHAN, yaitu rancangan damai sejahtera dan bukan rancangan kecelakaan, untuk memberikan kepadamu hari depan yang penuh harapan.', 'Alkitab Deuterokanonika (LAI)'),
      V('Katolik', 'Filipi 4:6', 'Janganlah hendaknya kamu kuatir tentang apa pun juga, tetapi nyatakanlah dalam segala hal keinginanmu kepada Allah dalam doa dan permohonan dengan ucapan syukur.', 'Alkitab Deuterokanonika (LAI)'),
      V('Hindu', 'Bhagavad Gita 2.47', 'Engkau berhak atas kerjamu, tetapi tidak atas hasilnya. Jangan jadikan hasil sebagai motif kerjamu, dan jangan pula terikat untuk tidak bekerja.', 'Terjemahan bebas — mohon ditinjau'),
      V('Hindu', 'Bhagavad Gita 6.5', 'Hendaklah seseorang mengangkat dirinya dengan kekuatannya sendiri dan tidak merendahkan dirinya; sebab diri sendirilah sahabat sekaligus musuh bagi dirinya.', 'Terjemahan bebas — mohon ditinjau'),
      V('Buddha', 'Dhammapada 276', 'Engkau sendirilah yang harus berusaha; para Tathagata hanya menunjukkan jalan.', 'Terjemahan bebas — mohon ditinjau'),
      V('Buddha', 'Dhammapada 103', 'Walaupun seseorang dapat menaklukkan ribuan musuh dalam ribuan kali pertempuran, penakluk terbesar adalah dia yang dapat menaklukkan dirinya sendiri.', 'Terjemahan bebas — mohon ditinjau'),
      V('Konghucu', 'Lunyu I : 1', 'Belajar dan selalu dilatih, tidakkah itu menyenangkan?', 'Kitab Sabda Suci — mohon ditinjau'),
      V('Konghucu', 'Lunyu II : 15', 'Belajar tanpa berpikir akan sia-sia; berpikir tanpa belajar akan berbahaya.', 'Kitab Sabda Suci — mohon ditinjau')
    ];
  }

  /** Teks bacaan dengan soal pemahaman (dapat diubah/dihapus admin). */
  function seedReadingTexts() {
    const now = Date.now();
    return [
      {
        id: 'rt_tidur', title: 'Tidur dan Daya Ingat', subtest: 'Literasi dalam Bahasa Indonesia', level: 'sedang', active: true,
        createdAt: now, createdBy: 'u_admin',
        body: '<p>Banyak pelajar mengurangi jam tidur menjelang ujian karena merasa waktu belajar tidak cukup. Padahal, tidur bukan sekadar waktu istirahat. Saat tidur, otak memproses informasi yang dipelajari sepanjang hari dan memindahkannya dari ingatan jangka pendek ke ingatan jangka panjang. Proses ini disebut konsolidasi memori.</p><p>Penelitian di bidang ilmu saraf menunjukkan bahwa orang yang tidur cukup setelah belajar cenderung mengingat materi lebih baik dibandingkan orang yang begadang. Kurang tidur juga menurunkan kemampuan memusatkan perhatian, sehingga waktu belajar tambahan dari begadang sering kali tidak efektif.</p><p>Karena itu, strategi belajar yang baik bukan menambah jam belajar dengan mengorbankan tidur, melainkan membagi waktu belajar secara teratur sejak jauh hari dan menjaga jadwal tidur yang konsisten.</p>',
        questions: [
          { text: 'Apa gagasan utama teks tersebut?', options: ['Begadang membuat belajar lebih efektif', 'Tidur cukup membantu otak menyimpan materi yang dipelajari', 'Ujian sebaiknya ditunda bila kurang tidur', 'Ingatan jangka pendek lebih penting daripada jangka panjang'], correctIndex: 1 },
          { text: 'Istilah "konsolidasi memori" dalam teks berarti …', options: ['proses lupa saat tidur', 'pemindahan informasi ke ingatan jangka panjang', 'kemampuan memusatkan perhatian', 'jadwal tidur yang teratur'], correctIndex: 1 },
          { text: 'Saran penulis bagi pelajar adalah …', options: ['belajar semalam suntuk sebelum ujian', 'tidur lebih lama pada hari ujian saja', 'membagi waktu belajar sejak jauh hari dan tidur teratur', 'mengurangi jumlah materi yang dipelajari'], correctIndex: 2 }
        ]
      },
      {
        id: 'rt_sampah', title: 'Bank Sampah di Lingkungan Sekolah', subtest: 'Penalaran Umum', level: 'mudah', active: true,
        createdAt: now, createdBy: 'u_admin',
        body: '<p>Sebuah sekolah menengah membuka bank sampah. Setiap siswa dapat menyetorkan sampah plastik dan kertas yang sudah dipilah. Sampah ditimbang, lalu nilainya dicatat sebagai tabungan siswa. Setiap akhir semester, tabungan dapat ditukar dengan alat tulis.</p><p>Pada bulan pertama, sampah yang terkumpul mencapai 120 kg. Pada bulan ketiga, jumlahnya naik menjadi 210 kg karena kelas-kelas mulai berlomba mengumpulkan sampah. Namun, petugas mencatat bahwa sebagian sampah yang disetor belum dipilah dengan benar sehingga harus disortir ulang.</p><p>Pengelola bank sampah kemudian mengadakan pelatihan singkat cara memilah sampah. Setelah pelatihan, waktu yang dibutuhkan petugas untuk menyortir ulang berkurang hampir setengahnya.</p>',
        questions: [
          { text: 'Berapa kenaikan sampah yang terkumpul dari bulan pertama ke bulan ketiga?', options: ['60 kg', '90 kg', '120 kg', '210 kg'], correctIndex: 1 },
          { text: 'Mengapa pengelola mengadakan pelatihan?', options: ['Agar jumlah sampah berkurang', 'Karena banyak sampah belum dipilah dengan benar', 'Untuk menambah nilai tabungan siswa', 'Karena alat tulis habis'], correctIndex: 1 },
          { text: 'Kesimpulan yang PALING tepat berdasarkan teks adalah …', options: ['Pelatihan memilah sampah membuat kerja petugas lebih efisien', 'Bank sampah tidak bermanfaat bagi sekolah', 'Sampah kertas lebih bernilai daripada plastik', 'Perlombaan antarkelas menurunkan jumlah sampah'], correctIndex: 0 }
        ]
      }
    ];
  }

  /** Course mandiri contoh (dikelola admin, tanpa tutor). */
  function seedHubCourses() {
    const now = Date.now();
    return [{
      id: 'hub_strategi', title: 'Strategi Belajar Efektif Menuju UTBK',
      subtitle: 'Kebiasaan belajar, manajemen waktu, dan teknik mengerjakan soal yang terbukti membantu.',
      description: '<p>Course mandiri ini membantu kamu menyusun rutinitas belajar yang konsisten. Setiap pelajaran singkat dan dapat diselesaikan kurang dari 15 menit.</p>',
      category: 'Pengembangan Diri', level: 'Pemula', language: 'Bahasa Indonesia', cover: '', color: '#4f46e5',
      outcomes: ['Menyusun jadwal belajar mingguan yang realistis', 'Menerapkan teknik pengulangan berjarak', 'Mengelola waktu saat mengerjakan tryout'],
      requirements: ['Tidak ada prasyarat', 'Siapkan buku catatan'],
      audience: { type: 'all', classes: [], studentIds: [] }, enrollMode: 'open',
      active: true, newStudentPolicy: 'all', certificate: true,
      createdAt: now, updatedAt: now, createdBy: 'u_admin',
      sections: [
        { id: 'sec_s1', title: 'Membangun Kebiasaan', lessons: [
          { id: 'les_s1a', title: 'Mengapa konsistensi mengalahkan durasi', type: 'article', durationMin: 6, active: true, createdAt: now, dripDays: 0,
            content: '<p>Belajar 45 menit setiap hari umumnya lebih efektif daripada belajar 5 jam sekali seminggu. Otak membutuhkan pengulangan dan jeda agar informasi tersimpan di ingatan jangka panjang.</p><ul><li>Tetapkan jam belajar yang sama setiap hari.</li><li>Mulai dari target kecil yang pasti tercapai.</li><li>Catat aktivitas belajar agar kemajuan terlihat.</li></ul>' },
          { id: 'les_s1b', title: 'Pengulangan berjarak (spaced repetition)', type: 'article', durationMin: 8, active: true, createdAt: now, dripDays: 0,
            content: '<p>Ulangi materi pada hari ke-1, ke-3, ke-7, dan ke-14 setelah pertama dipelajari. Setiap pengulangan memperkuat ingatan sebelum sempat terlupa.</p><p>Gunakan kartu catatan: tulis pertanyaan di satu sisi dan jawabannya di sisi lain.</p>' }
        ] },
        { id: 'sec_s2', title: 'Strategi Mengerjakan Soal', lessons: [
          { id: 'les_s2a', title: 'Mengelola waktu saat tryout', type: 'article', durationMin: 7, active: true, createdAt: now, dripDays: 0,
            content: '<p>Bagi waktu per soal sejak awal. Lewati soal yang terlalu lama, tandai, lalu kembali setelah soal lain selesai. Sisakan beberapa menit terakhir untuk memeriksa jawaban yang ragu.</p>' },
          { id: 'les_s2q', title: 'Kuis: Strategi belajar', type: 'quiz', durationMin: 5, active: true, createdAt: now, dripDays: 0, passScore: 70,
            content: '<p>Jawab pertanyaan berikut untuk menguji pemahamanmu.</p>',
            questions: [
              { text: 'Mana yang lebih efektif untuk ingatan jangka panjang?', options: ['Belajar 5 jam sekali seminggu', 'Belajar 45 menit setiap hari', 'Belajar hanya sebelum ujian', 'Tidak perlu mengulang materi'], correctIndex: 1 },
              { text: 'Pada pengulangan berjarak, setelah hari ke-3 materi diulang pada hari ke-…', options: ['4', '5', '7', '30'], correctIndex: 2 },
              { text: 'Saat menemui soal yang terlalu lama dikerjakan saat tryout, sebaiknya …', options: ['Terus dikerjakan sampai selesai', 'Dilewati, ditandai, lalu dikerjakan kembali nanti', 'Dijawab asal', 'Mengakhiri tryout'], correctIndex: 1 }
            ] }
        ] }
      ]
    }];
  }

  function runMigrations() {
    let current = Number(localStorage.getItem(SCHEMA_KEY) || '1') || 1;
    if (current >= SCHEMA_VERSION) return;

    // v2: profil (tanggal lahir, foto), status presensi "terlambat",
    //     pengaturan ambang kehadiran & hadiah ulang tahun.
    if (current < 2) {
      const DAY_MS = 86400000;
      const pad = n => String(n).padStart(2, '0');
      const users = load(KEYS.users, []);
      let changed = false;
      users.forEach((u, i) => {
        if (u.birthDate === undefined) {
          // Tanggal lahir contoh hanya untuk akun demo bawaan; akun nyata
          // dibiarkan kosong agar diisi sendiri oleh pemiliknya.
          let demo = '';
          if (/^u_siswa\d+$/.test(u.id)) {
            const n = Number(u.id.replace('u_siswa', ''));
            const d = new Date(Date.now() + (n === 1 ? 0 : n * 9) * DAY_MS);
            const year = 2008 - (n % 3);
            demo = `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          }
          u.birthDate = demo;
          changed = true;
        }
        if (u.photo === undefined) { u.photo = ''; changed = true; }
        users[i] = u;
      });
      if (changed) save(KEYS.users, users);
    }

    // v3: agama (ayat harian), preferensi streak, konten awal Arena & Course.
    // Hanya menambah data yang belum ada; data pengguna tidak disentuh.
    if (current < 3) {
      const DEMO_RELIGION = ['Islam', 'Kristen Protestan', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
      const users = load(KEYS.users, []);
      let changed = false;
      users.forEach((u, i) => {
        if (u.religion === undefined) {
          const m = /^u_siswa(\d+)$/.exec(u.id);
          u.religion = m ? DEMO_RELIGION[(Number(m[1]) - 1) % DEMO_RELIGION.length] : '';
          changed = true;
        }
        if (u.streakShare === undefined) { u.streakShare = false; changed = true; }
        users[i] = u;
      });
      if (changed) save(KEYS.users, users);
      if (localStorage.getItem('lms_verses') == null) save('lms_verses', seedVerses());
      if (localStorage.getItem('lms_reading_texts') == null) save('lms_reading_texts', seedReadingTexts());
      if (localStorage.getItem('lms_hub_courses') == null) save('lms_hub_courses', seedHubCourses());
    }

    localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION));
  }

  // Generic helpers
  function getAll(key) { return load(key, []); }

  /**
   * Judul kelas tanpa nama tutor. Kelas lama menyimpan judul buatan otomatis
   * "Kelas 11-A • PK • Bu A & Pak B" atau "Kelas 11-A • PK — Bu A". Nama tutor
   * ditampilkan di kolom/label tutor sendiri, jadi judul cukup kelas + subtest.
   */
  function cleanCourseTitle(course) {
    if (!course) return '';
    const st = subtestByName(course.subtest);
    const mains = (course.mainClasses || []).join(', ');
    const auto = [mains, st ? st.short : course.subtest].filter(Boolean).join(' • ');
    const raw = String(course.title || '').replace(/\s+/g, ' ').trim();
    if (!raw) return auto || 'Kelas';
    const low = (x) => String(x || '').toLowerCase().trim();
    const subNames = (st ? [st.name, st.short, st.code] : [course.subtest]).filter(Boolean).map(low);
    const hasSub = (x) => subNames.some(n => n && low(x).includes(n));
    let base = raw;
    const dash = raw.split(/\s+[—–]\s+/);
    if (dash.length > 1 && (hasSub(dash[0]) || (mains && low(dash[0]).includes(low(mains))))) base = dash[0];
    const parts = base.split(/\s*•\s*/);
    if (parts.length >= 3 && subNames.includes(low(parts[1]))) base = parts.slice(0, 2).join(' • ');
    else if (parts.length >= 2 && /\s&\s/.test(parts[parts.length - 1]) && !hasSub(parts[parts.length - 1])) base = parts.slice(0, -1).join(' • ');
    return base || auto || 'Kelas';
  }
  const withCleanTitle = (c) => (c && c.title !== cleanCourseTitle(c) ? Object.assign({}, c, { title: cleanCourseTitle(c) }) : c);
  function setAll(key, list) { save(key, list); }
  function findById(key, id) { return getAll(key).find(x => x.id === id) || null; }
  function add(key, record) {
    const list = getAll(key);
    if (!record.id) record.id = uid(key.replace('lms_', '').slice(0, 3));
    list.push(record);
    setAll(key, list);
    return record;
  }
  function update(key, id, patch) {
    const list = getAll(key);
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    setAll(key, list);
    return list[idx];
  }
  function remove(key, id) {
    setAll(key, getAll(key).filter(x => x.id !== id));
  }

  /** Durasi tetap satu pertemuan kelas (menit). */
  const PLAN_MINUTES = 90;
  /** Rapikan rencana kelas: teacherIds unik (tutor utama = teacherId), jam selesai = mulai + 90 menit. */
  function normPlan(p) {
    const out = Object.assign({}, p);
    if (Array.isArray(out.teacherIds)) {
      out.teacherIds = [...new Set(out.teacherIds.filter(Boolean).map(String))];
      out.teacherId = out.teacherIds[0] || null;
    } else if (Object.prototype.hasOwnProperty.call(out, 'teacherId')) {
      out.teacherIds = out.teacherId ? [out.teacherId] : [];
    }
    if (Object.prototype.hasOwnProperty.call(out, 'time') && out.time) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(out.time));
      if (m) {
        const end = Math.min(24 * 60 - 1, Number(m[1]) * 60 + Number(m[2]) + PLAN_MINUTES);
        out.endTime = String(Math.floor(end / 60)).padStart(2, '0') + ':' + String(end % 60).padStart(2, '0');
      }
    }
    return out;
  }

  /**
   * Ubah pendaftaran sekaligus (satu kali baca & tulis).
   * adds:    [{ courseId, studentId, via }]  — dilewati bila sudah terdaftar
   * removes: [{ courseId, studentId, onlyMain }] — onlyMain: pendaftaran perorangan dipertahankan
   */
  function changeEnrollments(adds, removes) {
    let list = getAll(KEYS.enrollments);
    const removed = [];
    if (removes.length) {
      const drop = new Map(removes.map(r => [r.courseId + '|' + r.studentId, r]));
      list = list.filter(e => {
        const r = drop.get(e.courseId + '|' + e.studentId);
        if (!r || (r.onlyMain && e.via && e.via !== 'main')) return true;
        removed.push(e);
        return false;
      });
    }
    const have = new Set(list.map(e => e.courseId + '|' + e.studentId));
    const added = [];
    const now = Date.now();
    adds.forEach(a => {
      const k = a.courseId + '|' + a.studentId;
      if (have.has(k)) return;
      have.add(k);
      const rec = { id: uid('enr'), courseId: a.courseId, studentId: a.studentId, enrolledAt: now, via: a.via || 'manual' };
      list.push(rec);
      added.push(rec);
    });
    if (added.length || removed.length) setAll(KEYS.enrollments, list);
    return { added, removed };
  }
  /** Kelas utama sebuah kelas subtest berubah: daftarkan yang baru, lepas yang dihapus. */
  function applyCourseMainClasses(courseId, prev, next) {
    const gone = prev.filter(k => !next.includes(k));
    const fresh = next.filter(k => !prev.includes(k));
    const students = getAll(KEYS.users).filter(u => u.role === 'siswa' && u.kelas);
    return changeEnrollments(
      students.filter(s => next.includes(s.kelas)).map(s => ({ courseId, studentId: s.id, via: 'main' })),
      gone.length ? students.filter(s => gone.includes(s.kelas) && !fresh.includes(s.kelas)).map(s => ({ courseId, studentId: s.id, onlyMain: true })) : []
    );
  }

  /** Tambahkan satu catatan aktivitas ke rantai milik pengguna (dipakai internal). */
  function appendLearning(user, type, refId, meta, now) {
    const def = LEARNING_TYPES[type];
    const tz = DB.streakTzFor(user);
    const day = DB.ymdInTz(now, tz);
    const log = load('lms_learning_log', []);
    const mine = log.filter(e => e.userId === user.id);
    const sameDay = mine.filter(e => e.day === day && e.type === type);
    if (type === 'login') {
      if (sameDay.length) return { duplicate: true, entry: sameDay[0] };
    } else {
      if (type === 'tantangan' && sameDay.length) throw new Error('Tantangan hari ini sudah dijawab. Kembali besok!');
      if (refId && sameDay.some(e => e.refId === refId)) throw new Error('Aktivitas yang sama sudah tercatat hari ini.');
      if (def.oncePerRef && refId && mine.some(e => e.type === type && e.refId === refId)) {
        throw new Error('Materi ini sudah pernah tercatat. Pilih materi lain.');
      }
      const last = mine.filter(e => e.type === type).reduce((a, e) => (!a || e.at > a.at ? e : a), null);
      if (last && now - last.at < 15000) throw new Error('Terlalu cepat. Tunggu beberapa detik sebelum mencatat aktivitas berikutnya.');
    }
    let xp = def.xp;
    let capped = false;
    if (sameDay.length >= def.cap) { xp = 0; capped = true; }
    if (!capped && meta && meta.total && meta.correct != null) xp += Math.round(def.xp * 0.5 * (meta.correct / meta.total));
    if (!capped && type === 'reading' && mine.some(e => e.type === 'reading' && e.refId === refId)) xp = Math.round(xp / 3);
    const prevEntry = mine.length ? mine[mine.length - 1] : null;
    const e = { id: uid('lrn'), userId: user.id, type, refId: refId || '', day, tz, at: now, xp, capped,
      learning: !!def.learning, meta: meta || {}, prev: prevEntry ? prevEntry.h : 'GENESIS' };
    e.h = chainHash(e);
    log.push(e);
    save('lms_learning_log', log);
    return { entry: e };
  }

  /* =====================================================================
   * Course Mandiri — helper kuis, kunci urutan, durasi & keaktifan peserta
   * ===================================================================*/
  /** Jenis soal kuis course = jenis soal CBT (js/qeditor.js FORMATS). */
  const HUB_QTYPES = QUESTION_TYPES.slice();
  const HUB_DEFAULT_MIN_SEC = 40;          // waktu minimal bawaan sebelum "Tandai selesai"
  const HUB_DEFAULT_INACTIVE_DAYS = 7;     // keluarkan peserta bila tidak aktif selama ini
  const HUB_TOUCH_MS = 10 * 60000;         // jeda minimum pencatatan "terakhir aktif"
  let hubSweepAt = { id: '', at: 0 };

  const hubPlain = (html) => String(html == null ? '' : html).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
  const hubHasMedia = (html) => /<(img|audio|video|iframe)\b/i.test(String(html || ''));
  const hubFilled = (v) => !!(hubPlain(v) || hubHasMedia(v));
  /** Soal lama (tanpa questionType) dianggap Pilihan Ganda. */
  const hubQType = (q) => (q && HUB_QTYPES.includes(q.questionType)) ? q.questionType : 'Pilihan Ganda';

  /** Bagian yang belum lengkap dari sebuah soal kuis; null bila valid. */

  /** Tipe akses course (gratis/berbayar) + tujuan pembayaran. Record lama tanpa accessType = gratis. */
  /** Validasi & normalisasi kurikulum course mandiri (dipakai admin dan tutor course). */
  function validateHubSections(sections) {
    sections.forEach((sec, si) => {
      if (!String(sec.title || '').trim()) throw new Error(`Bab ${si + 1} belum diberi judul.`);
      (sec.lessons || []).forEach((l, li) => {
        const at = `${si + 1}.${li + 1}`;
        if (!String(l.title || '').trim()) throw new Error(`Pelajaran ${at} belum diberi judul.`);
        if (!['article', 'video', 'pdf', 'link', 'quiz'].includes(l.type)) throw new Error(`Jenis pelajaran ${at} tidak valid.`);
        if ((l.type === 'video' || l.type === 'link' || l.type === 'pdf') && l.url && !/^https:\/\//i.test(l.url)) {
          throw new Error(`Tautan pelajaran ${at} harus diawali https://`);
        }
        if (l.type === 'quiz') {
          const qs = l.questions || [];
          if (!qs.length) throw new Error(`Kuis ${at} belum memiliki soal.`);
          if (qs.length > 60) throw new Error(`Kuis ${at} maksimal 60 soal.`);
          qs.forEach((q, qi) => {
            const prob = hubQuestionProblem(q);
            if (prob) throw new Error(`Kuis ${at} soal ${qi + 1} belum lengkap: ${prob}.`);
          });
          if (!qs.some(q => hubQType(q) !== 'Esai')) {
            throw new Error(`Kuis ${at} membutuhkan minimal satu soal yang dinilai otomatis (selain Esai).`);
          }
        }
        // Normalisasi angka agar data lama & baru konsisten
        l.durationMin = Math.max(0, Math.min(600, Math.round(Number(l.durationMin) || 0)));
        l.dripDays = Math.max(0, Math.min(365, Math.round(Number(l.dripDays) || 0)));
        // Waktu minimal hanya untuk pelajaran non-kuis (kuis selesai bila lulus).
        if (l.type !== 'quiz' && l.minSec != null && l.minSec !== '') l.minSec = Math.max(0, Math.min(7200, Math.round(Number(l.minSec) || 0)));
        else delete l.minSec;
      });
    });
  }

  function normHubAccess(rec) {
    if (rec.accessType !== 'paid') return { accessType: 'free', price: 0, payment: null };
    const price = Math.round(Number(rec.price));
    if (!Number.isFinite(price) || price < 1000 || price > 100000000) throw new Error('Harga course Rp1.000 – Rp100.000.000.');
    const p = rec.payment || {};
    const bank = String(p.bank || '').replace(/[<>]/g, '').trim().slice(0, 60);
    const accountNo = String(p.accountNo || '').trim();
    const accountName = String(p.accountName || '').replace(/[<>]/g, '').trim().slice(0, 80);
    if (accountNo && !/^[0-9][0-9 -]{4,29}$/.test(accountNo)) throw new Error('Nomor rekening hanya angka, spasi, atau tanda hubung (5–30 karakter).');
    const hasBank = !!(bank && accountNo && accountName);
    if ((bank || accountNo || accountName) && !hasBank) throw new Error('Lengkapi nama bank, nomor rekening, dan nama pemilik rekening.');
    if (!hasBank && !p.qrisKey) throw new Error('Course berbayar membutuhkan rekening lengkap atau gambar QRIS.');
    return {
      accessType: 'paid', price,
      payment: { bank, accountNo, accountName, qrisKey: p.qrisKey || '', qrisAt: p.qrisKey ? (p.qrisAt || Date.now()) : 0,
        instructions: String(p.instructions || '').replace(/[<>]/g, '').trim().slice(0, 1000) }
    };
  }

  function hubQuestionProblem(q) {
    if (!q || typeof q !== 'object') return 'data soal';
    const t = hubQType(q);
    if (!hubFilled(q.text)) return 'isi pertanyaan';
    const opts = Array.isArray(q.options) ? q.options : [];
    if (t === 'Pilihan Ganda' || t === 'Pilihan Lebih dari Satu') {
      if (opts.length < 2 || opts.some(o => !hubFilled(o))) return 'minimal 2 pilihan jawaban dan tidak ada pilihan kosong';
      if (t === 'Pilihan Ganda') {
        const k = Number(q.correctIndex);
        if (!(Number.isInteger(k) && k >= 0 && k < opts.length)) return 'kunci jawaban';
      } else {
        const ks = Array.isArray(q.correctIndices) ? q.correctIndices.map(Number) : [];
        if (!ks.length || ks.some(k => !(Number.isInteger(k) && k >= 0 && k < opts.length))) return 'minimal satu kunci jawaban';
      }
    } else if (t === 'Benar/Salah') {
      if (Number(q.correctIndex) !== 0 && Number(q.correctIndex) !== 1) return 'kunci Benar/Salah';
    } else if (t === 'Isian Singkat') {
      if (!(q.answers || []).some(a => String(a == null ? '' : a).trim())) return 'minimal satu jawaban yang diterima';
    } else if (t === 'Benar/Salah Majemuk') {
      const st = (q.statements || []).filter(x => x && hubFilled(x.text));
      if (st.length < 2) return 'minimal 2 pernyataan';
      if (st.some(x => typeof x.value !== 'boolean')) return 'kunci Benar/Salah tiap pernyataan';
    } else if (t === 'Majemuk Kompleks') {
      if ((q.statements || []).filter(x => x && hubFilled(x.text)).length < 2) return 'minimal 2 pernyataan';
      if (Array.isArray(q.columns) && q.columns.map(plainLabel).filter(Boolean).length < 2) return 'minimal 2 kolom jawaban';
      if (qMatrixKeys(q).some(k => k == null)) return 'kunci kolom tiap pernyataan';
    } else if (t === 'Menjodohkan') {
      if ((q.pairs || []).filter(x => x && hubFilled(x.left) && hubFilled(x.right)).length < 2) return 'minimal 2 pasangan lengkap';
    } else if (t === 'Urutan') {
      if ((q.orderItems || []).filter(hubFilled).length < 2) return 'minimal 2 item urutan';
    }
    return null;
  }

  /** Normalkan jawaban mentee ke bentuk yang dipakai Exam.gradeQuestion (dan batasi ukurannya). */
  function hubNormAnswer(q, a) {
    const t = hubQType(q);
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n || 4000);
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') {
      return (a === '' || a == null || !isFinite(Number(a))) ? null : Number(a);
    }
    if (t === 'Pilihan Lebih dari Satu') {
      return Array.isArray(a) ? [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n >= 0))].sort((x, y) => x - y).slice(0, 20) : [];
    }
    if (t === 'Isian Singkat' || t === 'Esai') return clip(a);
    if (t === 'Benar/Salah Majemuk') return qBoolAnswer(q, a);
    if (t === 'Majemuk Kompleks') return qMatrixAnswer(q, a);
    if (t === 'Menjodohkan') return Array.isArray(a) ? (q.pairs || []).map((_, i) => clip(a[i], 2000)) : [];
    if (t === 'Urutan') return Array.isArray(a) ? a.slice(0, 60).map(v => clip(v, 2000)) : [];
    return null;
  }
  function hubAnswered(q, a) {
    const t = hubQType(q);
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') return a != null;
    if (t === 'Pilihan Lebih dari Satu') return Array.isArray(a) && a.length > 0;
    if (t === 'Isian Singkat' || t === 'Esai') return String(a || '').trim().length > 0;
    if (t === 'Benar/Salah Majemuk') return Array.isArray(a) && a.length > 0 && a.every(v => v === true || v === false);
    if (t === 'Majemuk Kompleks') return Array.isArray(a) && a.length > 0 && a.every(v => Number.isInteger(v) && v >= 0);
    if (t === 'Menjodohkan') return Array.isArray(a) && a.length > 0 && a.every(v => String(v).length > 0);
    if (t === 'Urutan') return Array.isArray(a) && a.length === (q.orderItems || []).length;
    return false;
  }
  /** Nilai satu soal → { auto, correct }. Memakai mesin penilaian CBT agar hasilnya konsisten. */
  function hubGrade(q, a) {
    const t = hubQType(q);
    if (t === 'Esai') return { auto: false, correct: false };
    const qq = Object.assign({}, q, { questionType: t });
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') qq.correctIndex = Number(q.correctIndex);
    if (t === 'Pilihan Lebih dari Satu') qq.correctIndices = (q.correctIndices || []).map(Number);
    if (global.Exam && typeof global.Exam.gradeQuestion === 'function') {
      const g = global.Exam.gradeQuestion(qq, a);
      return { auto: !!g.auto, correct: !!g.correct };
    }
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') return { auto: true, correct: a === qq.correctIndex };
    throw new Error('Modul penilaian belum termuat. Muat ulang halaman lalu coba lagi.');
  }

  /** Waktu aktivitas terakhir peserta course (dipakai pengeluaran otomatis). */
  function hubLastActive(p) {
    let t = Math.max(Number(p.lastActiveAt) || 0, Number(p.enrolledAt) || 0, Number(p.restoredAt) || 0);
    Object.values(p.completed || {}).forEach(v => { if (Number(v) > t) t = Number(v); });
    Object.values(p.quiz || {}).forEach(q => { if (q && Number(q.at) > t) t = Number(q.at); });
    return t;
  }
  function saveHubProgressRec(prog) {
    const list = load('lms_hub_progress', []);
    const i = list.findIndex(x => x.id === prog.id);
    if (i >= 0) list[i] = prog; else list.push(prog);
    save('lms_hub_progress', list);
  }

  let batchMemo = { sid: null, at: 0, batch: null };

  const passageKeyCache = new Map();   // isi HTML teks bacaan -> teks polos (dibandingkan berulang saat impor)
  const DB = {
    KEYS, uid, periodKey,

    /* ===== Konstanta bersama ===== */
    SUBTESTS, SUBTEST_NAMES, QUESTION_TYPES, DIFFICULTIES, ALL_CLASSES,
    MATRIX_DEFAULT_COLS, MATRIX_MAX_COLS,
    qMatrixColumns, qMatrixKeys, qMatrixAnswer, qBoolAnswer, qAnswerText, qKeyText,
    subtestByName, subtestOrder, DAY_NAMES, PLAN_STATUS, ymdOf,
    PAYMENT_KINDS, FINE_REASONS, CONTENT_KINDS, ADMIN_OWNER, EDU_STATUSES,

    /* ===== Pengaturan aplikasi ===== */
    getSettings: () => Object.assign({
      loginQuizEnabled: true, loginQuizRoles: ['siswa'], loginQuizAttempts: 3,
      motivationEnabled: true, planFillLead: PLAN_FILL_LEAD, planConfirmLead: PLAN_CONFIRM_LEAD,
      appName: 'LMS Rubela', appTagline: 'Learning Management System', appLogo: '',
      /* ===== Ekspor whiteboard: watermark & nomor halaman ===== */
      wbWatermarkEnabled: true,
      wbWatermarkText: 'Aset RUBELA Indonesia',
      wbWatermarkLogo: '',            // kosong = memakai logo aplikasi
      wbWatermarkOpacity: 14,         // persen
      wbWatermarkStyle: 'tile',       // tile (berulang miring) | center | corner
      wbPageNumbers: true,
      /* ===== Integrasi AI =====
       * Kunci API TIDAK pernah ikut tersimpan di repositori. Admin mengisinya
       * lewat Pengaturan, lalu disimpan pada localStorage browser masing-masing.
       */
      aiEnabled: true,
      aiProvider: 'gemini',          // penyedia utama (lihat js/ai-providers.js ORDER)
      aiFallback: true,              // coba penyedia lain yang kuncinya terisi bila utama gagal
      geminiApiKey: '',
      geminiModel: 'gemini-flash-latest',
      groqApiKey: '',
      groqModel: 'openai/gpt-oss-120b',
      mistralApiKey: '',
      mistralModel: 'mistral-small-latest',
      openrouterApiKey: '',
      openrouterModel: 'openrouter/free',
      customAiEndpoint: '',
      customAiApiKey: '',
      customAiModel: '',
      deepseekApiKey: '', deepseekModel: '',
      kimiApiKey: '', kimiModel: '',
      siliconflowApiKey: '', siliconflowModel: '',
      museApiKey: '', museModel: '',
      freeaiApiKey: '', freeaiModel: '', freeaiEndpoint: '',
      iteraApiKey: '', iteraModel: '', iteraEndpoint: '',
      patewayApiKey: '', patewayModel: '', patewayEndpoint: '',
      radoxApiKey: '', radoxModel: '', radoxEndpoint: '',
      kitsoraApiKey: '', kitsoraModel: '', kitsoraEndpoint: '',
      aiMode: 'single',              // single = penyedia utama + cadangan | ensemble = gabungan beberapa AI
      aiEnsembleSize: 3,             // jumlah penyedia yang menjawab bersamaan (2–5)
      aiPseudonymize: true,          // samarkan nama mentee sebelum data dikirim ke penyedia AI
      aiTimeoutMs: 30000,
      tinyfishApiKey: '',
      tinyfishEndpoint: '',
      /* ===== Kehadiran ===== */
      attendanceThreshold: 75,
      attendanceExcusedPolicy: 'count',
      absencePolicy: null,            // null = bawaan (lihat ABSENCE_DEFAULT & DB.absencePolicy)
      /* ===== Ulang tahun ===== */
      birthdayEnabled: true,
      birthdayPoints: 50,
      birthdayModeration: 'post',   // 'post' = langsung tampil, 'pre' = tunggu persetujuan
      birthdayMessage: 'Selamat ulang tahun dari keluarga besar Rubela! Terus semangat berjuang menuju PTN impianmu. 🎓',
      /* ===== Streak & gamifikasi ===== */
      streakEnabled: true,
      streakTimezoneMode: 'lms',          // 'lms' = zona LMS, 'user' = zona pilihan pengguna
      lmsTimezone: 'WIB',
      streakMinActivities: 1,             // aktivitas belajar sah minimal per hari
      streakDailyGoal: 3,                 // target harian: jumlah jenis aktivitas berbeda
      streakWeeklyTarget: 4,              // hari aktif minimal per minggu (weekly streak)
      streakMonthlyTarget: 12,            // hari aktif minimal per bulan (monthly streak)
      streakReminderHour: 18,             // jam pengingat sebelum streak putus
      streakFreezeEnabled: true,
      streakFreezeEarnEvery: 7,           // dapat 1 freeze setiap kelipatan N hari streak
      streakFreezeMax: 2,                 // stok maksimal
      streakFreezeMonthlyLimit: 2,        // pemakaian maksimal per bulan
      streakProgramDays: 174,             // durasi batch
      streakProgramExtraDays: 0,          // perpanjangan oleh admin
      streakProgramStart: '',             // YYYY-MM-DD; kosong = tanggal mulai tahun akademik aktif / hari pertama aktivitas
      streakMilestones: null,             // null = bawaan (lihat STREAK_MILESTONES)
      streakUniversities: null,           // null = bawaan (lihat STREAK_UNIVERSITIES)
      streakLeaderboardEnabled: true,
      streakLeaderboardMetric: 'current', // current | longest | xp | activeDays
      streakLeaderboardScope: 'all',      // all | kelas
      streakLeaderboardSize: 10,
      streakLeaderboardPrivacy: 'optin',  // optin = hanya yang mengizinkan; all = semua (nama lain disamarkan)
      /* ===== Kosakata Arena (js/vocab.js) ===== */
      vocabEnabled: true,
      vocabSessionSize: 20,               // kartu per sesi (10–50)
      vocabOff: [],                       // id kosakata bawaan yang dinonaktifkan admin
      /* ===== Mesin Waktu ===== */
      capsuleEnabled: true,
      capsuleMaxPerUser: 20,
      /* ===== Musik latar ===== */
      musicEnabled: false,
      musicMainTrackId: '',
      musicDefaultVolume: 35,
      musicDashboards: ['admin', 'guru', 'siswa', 'orangtua'],
      musicShuffle: false,
      musicAutoplay: true,
      /* ===== Ayat harian ===== */
      verseEnabled: true,
      /* ===== Tema hari besar nasional (js/holiday-theme.js) =====
       * Dipilih manual oleh admin; '' = tema bawaan. holidayMessages berisi
       * ucapan kustom per tema: { natal: { title, text }, ... }. */
      holidayTheme: '',
      holidayEffects: true,
      holidayBanner: true,
      holidayMessages: {},
      /* ===== Notifikasi perangkat (Web Push, js/push.js) ===== */
      pushEnabled: true,
      pushRoles: ['admin', 'guru', 'siswa', 'orangtua'],
      /* ===== Game Battle (js/games.js) ===== */
      gamesEnabled: true,
      gameBattleEnabled: true,
      gameBotEnabled: true,
      gameSource: 'both',              // both = Bank Soal + Soal Game | game = Soal Game saja | bank = Bank Soal saja
      gameDisabled: [],                // id game yang dimatikan admin
      remedialEnabled: true,           // sistem remedial ujian (js/remedial.js)
      remedialDefaults: { kkm: 75, kkmIrt: 500, policy: 'cap' },
      examSecurityDefaults: {
        requireCamera: false, requireMic: false, fullscreen: true,
        blockTabSwitch: true, blockCopy: true, blockScreenshot: true,
        detectScreenShare: true, lockScreen: true, maxViolations: 3
      }
    }, load(KEYS.settings, {})),
    setSetting: (key, value) => {
      const cur = load(KEYS.settings, {});
      cur[key] = value;
      save(KEYS.settings, cur);
      // Kunci rahasia (API key) tidak pernah ditulis ke log.
      const secret = /key|token|secret|password/i.test(key);
      DB.logActivity('settings', `Mengubah pengaturan "${key}"${secret || typeof value === 'object' ? '' : ` → ${String(value).slice(0, 60)}`}`);
      return cur;
    },

    /* ===== Kelas Utama (Kelas 10/11/12) =====
     * Dipakai untuk memisahkan ratusan siswa, dan menjadi dasar pengisian
     * kelas subtest (tidak perlu mencentang siswa satu per satu).
     */
    getMainClasses: () => {
      const stored = localStorage.getItem('lms_class_options');
      if (stored) { try { return JSON.parse(stored); } catch (e) { /* noop */ } }
      return ['Kelas 10-A', 'Kelas 10-B', 'Kelas 11-A', 'Kelas 11-B', 'Kelas 12-A', 'Kelas 12-B'];
    },
    setMainClasses: (list) => localStorage.setItem('lms_class_options', JSON.stringify(list)),
    /** Daftar kelas utama beserta jumlah siswa aktif di dalamnya. */
    getMainClassesWithCounts: () => {
      const students = getAll(KEYS.users).filter(u => u.role === 'siswa');
      return DB.getMainClasses().map(name => {
        const inClass = students.filter(s => s.kelas === name);
        return {
          name,
          total: inClass.length,
          active: inClass.filter(s => (s.status || 'Aktif') === 'Aktif').length,
          studentIds: inClass.map(s => s.id)
        };
      });
    },
    getStudentsByMainClass: (kelas) =>
      getAll(KEYS.users).filter(u => u.role === 'siswa' && u.kelas === kelas),

    /* ===== Kelas Subtest: tutor & jadwal ===== */
    /** Daftar id tutor sebuah kelas (mendukung data lama teacherId tunggal). */
    courseTeacherIds: (course) => {
      if (!course) return [];
      if (Array.isArray(course.teacherIds) && course.teacherIds.length) return course.teacherIds;
      return course.teacherId ? [course.teacherId] : [];
    },
    courseTeachers: (course) => DB.courseTeacherIds(course).map(id => findById(KEYS.users, id)).filter(Boolean),
    /** Nama tampilan kelas: "Kelas 11-A • PK" (tanpa nama tutor). */
    courseTitle: (course) => (course ? cleanCourseTitle(course) : '-'),
    /** Tanda singkat kartu kelas: kode subtest (PK, PU, …). Huruf pertama judul selalu "K" untuk "Kelas …". */
    courseMark: (course) => {
      const st = course && subtestByName(course.subtest);
      if (st && st.short) return st.short.slice(0, 4);
      const t = String((course && (course.subtest || course.title)) || '?').replace(/^kelas\s+/i, '').trim();
      return (t.slice(0, 1) || '?').toUpperCase();
    },
    /** Ringkasan tutor untuk label sempit: "Nailul, Davi +5". */
    courseTutorsShort: (course, max) => {
      // "Bu Maria Simbolon" -> "Bu Maria": sapaan saja (Bu/Pak/Kak) tidak cukup untuk membedakan tutor.
      const HON = /^(bu|ibu|pak|bapak|kak|mas|mbak|bang|sdr|sdri|dr|drs|ir|prof)\.?$/i;
      const short = (name) => { const w = String(name || '').trim().split(/\s+/).filter(Boolean); return (HON.test(w[0] || '') ? w.slice(0, 2) : w.slice(0, 1)).join(' '); };
      const names = DB.courseTeachers(course).map(t => short(t.name)).filter(Boolean);
      const n = max || 2;
      if (!names.length) return '';
      return names.length <= n ? names.join(', ') : `${names.slice(0, n).join(', ')} +${names.length - n}`;
    },
    /** Ringkasan jadwal: "Senin, Kamis • 16:00–17:30". */
    courseScheduleLabel: (course) => {
      const s = course && course.schedule;
      if (!s) return '-';
      const days = (s.days || []).join(', ');
      // Setiap pertemuan 90 menit: jam selesai dihitung dari jam mulai (data lama tetap tampil benar).
      const time = s.time ? `${s.time}–${DB.planEndFor(s.time)}` : '';
      return [days, time].filter(Boolean).join(' • ') || '-';
    },

    /* ===== Enrolment berbasis kelas utama ===== */
    /* Pendaftaran yang mengikuti kelas utama ditandai via:'main'. Pendaftaran
     * perorangan (mentee bergabung sendiri = 'self', admin/tutor = 'manual')
     * tidak ikut dilepas saat kelas utama berubah. Data lama tanpa `via`
     * diperlakukan seperti 'main'. */
    /** Kelas subtest yang memuat kelas utama `kelas`. */
    coursesOfMainClass: (kelas) => (kelas ? getAll(KEYS.courses).filter(c => (c.mainClasses || []).includes(kelas)) : []),
    /** Daftarkan seluruh mentee sebuah kelas utama ke satu kelas subtest. */
    enrollMainClass: (courseId, kelas) =>
      changeEnrollments(DB.getStudentsByMainClass(kelas).map(s => ({ courseId, studentId: s.id, via: 'main' })), []).added.length,
    /** Lepas mentee kelas utama `kelas` dari satu kelas subtest (pendaftaran perorangan tetap). */
    unenrollMainClass: (courseId, kelas) =>
      changeEnrollments([], DB.getStudentsByMainClass(kelas).map(s => ({ courseId, studentId: s.id, onlyMain: true }))).removed.length,
    /** Samakan daftar kelas utama sebuah kelas subtest dengan pendaftarannya. */
    syncCourseMainClasses: (courseId, mainClasses) => {
      const course = findById(KEYS.courses, courseId);
      if (!course) return null;
      const next = [...new Set(mainClasses || [])];
      const res = applyCourseMainClasses(courseId, course.mainClasses || [], next);
      update(KEYS.courses, courseId, { mainClasses: next });
      return { added: res.added.length, removed: res.removed.length, mainClasses: next };
    },
    /**
     * Samakan pendaftaran seorang mentee dengan kelas utamanya: masuk ke semua
     * kelas subtest kelas utama sekarang, keluar dari kelas subtest kelas utama
     * lama (kecuali kelas itu juga memuat kelas utama baru).
     * @returns {{added: string[], removed: string[]}} id kelas subtest
     */
    syncStudentMainClass: (studentId, prevKelas) => {
      const st = findById(KEYS.users, studentId);
      if (!st || st.role !== 'siswa') return { added: [], removed: [] };
      const next = st.kelas || '';
      const courses = getAll(KEYS.courses);
      const adds = next ? courses.filter(c => (c.mainClasses || []).includes(next)).map(c => ({ courseId: c.id, studentId, via: 'main' })) : [];
      const drops = prevKelas && prevKelas !== next
        ? courses.filter(c => (c.mainClasses || []).includes(prevKelas) && !(next && (c.mainClasses || []).includes(next)))
          .map(c => ({ courseId: c.id, studentId, onlyMain: true }))
        : [];
      const res = changeEnrollments(adds, drops);
      return { added: res.added.map(e => e.courseId), removed: res.removed.map(e => e.courseId) };
    },
    /**
     * Perbaikan sekali jalan (admin): mentee yang kelas utamanya tercantum di
     * kelas subtest tetapi belum terdaftar (bug lama saat akun baru dibuat).
     */
    repairMainClassEnrollments: () => {
      const students = getAll(KEYS.users).filter(u => u.role === 'siswa' && u.kelas);
      const adds = [];
      getAll(KEYS.courses).forEach(c => (c.mainClasses || []).forEach(k => students.forEach(s => {
        if (s.kelas === k) adds.push({ courseId: c.id, studentId: s.id, via: 'main' });
      })));
      return changeEnrollments(adds, []).added.length;
    },

    /* ===== War Jadwal Kelas (rencana kelas) =====
     * Satu pertemuan boleh diajar lebih dari satu tutor: `teacherIds` (urutan =
     * tutor utama dulu). `teacherId` tetap diisi tutor pertama untuk data lama. */
    planTeacherIds: (plan) => {
      if (!plan) return [];
      if (Array.isArray(plan.teacherIds) && plan.teacherIds.length) return plan.teacherIds;
      return plan.teacherId ? [plan.teacherId] : [];
    },
    planTeachers: (plan) => DB.planTeacherIds(plan).map(id => findById(KEYS.users, id)).filter(Boolean),
    /** "Bu Maria & Pak Budi" (nama lengkap, untuk kartu & presensi). */
    planTeacherNames: (plan, sep) => DB.planTeachers(plan).map(u => u.name).join(sep || ' & '),
    getClassPlans: () => getAll(KEYS.classPlans),
    getClassPlan: (id) => findById(KEYS.classPlans, id),
    getClassPlansByCourse: (cid) => getAll(KEYS.classPlans).filter(p => p.courseId === cid),
    getClassPlansByTeacher: (tid) => getAll(KEYS.classPlans).filter(p => DB.planTeacherIds(p).includes(tid)),
    getClassPlansByDate: (ymd) => getAll(KEYS.classPlans).filter(p => p.date === ymd),
    getClassPlansInRange: (fromYmd, toYmd) => getAll(KEYS.classPlans)
      .filter(p => p.date >= fromYmd && p.date <= toYmd)
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))),
    /** Rencana kelas yang relevan untuk seorang siswa (via enrolmennya). */
    getClassPlansForStudent: (studentId) => {
      const cids = getAll(KEYS.enrollments).filter(e => e.studentId === studentId).map(e => e.courseId);
      return getAll(KEYS.classPlans)
        .filter(p => cids.includes(p.courseId))
        .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    },
    addClassPlan: (p) => add(KEYS.classPlans, normPlan(Object.assign({
      status: 'draft', topic: '', note: '', meetingLink: '',
      confirmedAt: null, createdAt: Date.now(), updatedAt: Date.now()
    }, p))),
    updateClassPlan: (id, patch) => update(KEYS.classPlans, id, normPlan(Object.assign({ updatedAt: Date.now() }, patch))),
    /** Hapus pertemuan beserta presensi sesi itu. Mengembalikan salinan { plan, attendance } untuk "Urungkan". */
    deleteClassPlan: (id) => {
      const pl = findById(KEYS.classPlans, id);
      if (!pl) return null;
      const att = DB.planAttendance(pl);
      if (att.length) {
        const drop = new Set(att.map(a => a.id));
        setAll(KEYS.attendance, getAll(KEYS.attendance).filter(a => !drop.has(a.id)));
      }
      remove(KEYS.classPlans, id);
      return { plan: pl, attendance: att };
    },
    /** Kembalikan pertemuan yang baru dihapus (hasil deleteClassPlan). */
    reinstateClassPlan: (snap) => {
      if (!snap || !snap.plan || findById(KEYS.classPlans, snap.plan.id)) return null;
      const pl = add(KEYS.classPlans, normPlan(Object.assign({}, snap.plan, { updatedAt: Date.now() })));
      (snap.attendance || []).forEach(a => DB.restoreAttendance(a));
      return pl;
    },
    /** Presensi yang tercatat untuk satu pertemuan (catatan lama tanpa planId milik sesi pertama hari itu). */
    planAttendance: (pl) => (pl ? DB.getSessionAttendance(pl.courseId, pl.date, pl.id) : []),
    /** Batalkan sebuah pertemuan (tetap tercatat sebagai "Dibatalkan"; status sebelumnya disimpan untuk dipulihkan). */
    cancelClassPlan: (id, reason) => {
      const pl = findById(KEYS.classPlans, id);
      if (!pl || pl.status === 'cancelled') return pl || null;
      return update(KEYS.classPlans, id, {
        status: 'cancelled', prevStatus: pl.status, cancelledAt: Date.now(),
        cancelReason: String(reason || '').replace(/[<>]/g, '').trim().slice(0, 200), updatedAt: Date.now()
      });
    },
    /** Pulihkan pertemuan yang dibatalkan ke status sebelumnya. */
    restoreClassPlan: (id) => {
      const pl = findById(KEYS.classPlans, id);
      if (!pl || pl.status !== 'cancelled') return pl || null;
      const status = pl.prevStatus && pl.prevStatus !== 'cancelled' ? pl.prevStatus : 'draft';
      // `time` ikut dikirim agar jam selesai dihitung ulang (90 menit) untuk data lama.
      return update(KEYS.classPlans, id, normPlan({ status, time: pl.time, prevStatus: null, cancelledAt: null, cancelReason: '', updatedAt: Date.now() }));
    },
    /** Validasi tutor: tandai rencana sebagai FIX. */
    confirmClassPlan: (id) => update(KEYS.classPlans, id, {
      status: 'fixed', confirmedAt: Date.now(), updatedAt: Date.now()
    }),

    /**
     * Rencana kelas pada satu tanggal untuk satu kelas (null bila tak ada).
     * Satu kelas boleh punya lebih dari satu sesi per hari; yang dipilih adalah
     * sesi aktif (tidak dibatalkan) paling awal, agar presensi & tutor sesi tepat.
     */
    getPlanForCourseDate: (cid, ymd) => {
      const list = DB.getPlansForCourseDate(cid, ymd);
      return list.find(p => p.status !== 'cancelled') || list[0] || null;
    },
    /** Semua sesi satu kelas pada satu tanggal, urut jam mulai. */
    getPlansForCourseDate: (cid, ymd) => getAll(KEYS.classPlans)
      .filter(p => p.courseId === cid && p.date === ymd)
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || ''))),

    /* ===== Rencana Materi (silabus mingguan per kelas subtest) =====
     * { id, courseId, week, topicId, subtopicId, title, teacherIds[], note, createdBy, createdAt, updatedAt }
     * Nama materi terhubung ke Materi & Sub Materi (lms_topics) subtest kelasnya,
     * sehingga muncul di setiap pilihan "Materi": rencana kelas, whiteboard,
     * bank soal, materi, dan modul — tanpa mengetik ulang. */
    getMaterialPlans: (courseId) => getAll(KEYS.materialPlans).filter(m => !courseId || m.courseId === courseId)
      .sort((a, b) => (Number(a.week) - Number(b.week)) || ((a.createdAt || 0) - (b.createdAt || 0))),
    getMaterialPlan: (id) => findById(KEYS.materialPlans, id),
    canEditMaterialPlans: (user, course) => !!(user && course &&
      (user.role === 'admin' || (user.role === 'guru' && DB.courseTeacherIds(course).includes(user.id)))),
    /** Simpan satu baris (baru bila tanpa id). Nama materi didaftarkan ke Materi subtest bila belum ada. */
    saveMaterialPlan: (row, actor) => {
      const course = findById(KEYS.courses, row.courseId);
      if (!DB.canEditMaterialPlans(actor, course)) throw new Error('Hanya admin atau tutor kelas ini yang dapat mengubah rencana materi.');
      const week = Math.round(Number(row.week));
      if (!(week >= 1 && week <= 60)) throw new Error('Minggu ke- harus 1–60.');
      const title = String(row.title || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (title.length < 2) throw new Error('Nama materi minimal 2 huruf.');
      const tutors = new Set(DB.courseTeacherIds(course));
      const teacherIds = [...new Set((row.teacherIds || []).filter(id => tutors.has(id)))].slice(0, 6);
      let ref = { topicId: row.topicId || null, subtopicId: row.subtopicId || null };
      if (global.Topics && course.subtest) {
        const t = row.topicId && Topics.get(row.topicId);
        if (!t || t.name.toLowerCase() !== title.toLowerCase()) ref = Topics.resolveNames(course.subtest, title, '', actor);
      }
      const rec = { courseId: course.id, week, title, topicId: ref.topicId, subtopicId: ref.subtopicId || null, teacherIds,
        note: String(row.note || '').replace(/[<>]/g, '').trim().slice(0, 300), updatedAt: Date.now() };
      if (row.id && findById(KEYS.materialPlans, row.id)) return update(KEYS.materialPlans, row.id, rec);
      // id lama dipakai lagi saat "Urungkan" hapus, agar tautan dari pertemuan tetap tersambung.
      const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(row.id || '')) ? row.id : uid('mpl');
      return add(KEYS.materialPlans, Object.assign({ id, createdBy: row.createdBy || actor.id, createdAt: row.createdAt || Date.now() }, rec));
    },
    /**
     * Sambungkan rencana materi ke pertemuan minggu itu: materi pertemuan yang
     * masih kosong diisi, dan yang masih memakai nama lama ikut diganti.
     * Hanya pertemuan yang boleh diubah `actor`. Mengembalikan jumlah pertemuan yang diperbarui.
     */
    linkMaterialPlanToSessions: (mp, actor, oldTitle) => {
      const course = mp && findById(KEYS.courses, mp.courseId);
      const range = course && DB.courseWeekRange(course, Number(mp.week));
      if (!range) return 0;
      let n = 0;
      DB.getClassPlansByCourse(course.id).forEach(pl => {
        if (pl.status === 'cancelled' || !DB.canManagePlan(actor, pl)) return;
        const topic = String(pl.topic || '').trim();
        const inWeek = pl.date >= range.from && pl.date <= range.to;
        const renamed = pl.materialPlanId === mp.id && oldTitle && topic === oldTitle && topic !== mp.title;
        if (!(inWeek && !topic) && !renamed) return;
        update(KEYS.classPlans, pl.id, { topic: mp.title, topicId: mp.topicId || null, materialPlanId: mp.id, updatedAt: Date.now() });
        n++;
      });
      return n;
    },
    deleteMaterialPlan: (id, actor) => {
      const rec = findById(KEYS.materialPlans, id);
      if (!rec) return;
      if (!DB.canEditMaterialPlans(actor, findById(KEYS.courses, rec.courseId))) throw new Error('Anda tidak berhak menghapus rencana materi ini.');
      remove(KEYS.materialPlans, id);
    },
    /** Tanggal awal hitungan minggu kelas: tanggal mulai jadwal rutin, atau pertemuan pertama. */
    courseStartYmd: (course) => {
      if (!course) return '';
      const sc = course.schedule || {};
      if (/^\d{4}-\d{2}-\d{2}$/.test(sc.startDate || '')) return sc.startDate;
      const first = DB.getClassPlansByCourse(course.id).map(p => p.date).filter(Boolean).sort()[0];
      return first || ymdOf(course.createdAt || Date.now());
    },
    /** Minggu ke- sebuah tanggal (1 = minggu pertama kelas), atau 0 bila sebelum kelas mulai. */
    courseWeekOf: (course, ymd) => {
      const start = DB.courseStartYmd(course);
      if (!start || !ymd) return 0;
      const d = Math.round((new Date(ymd + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000);
      return d < 0 ? 0 : Math.floor(d / 7) + 1;
    },
    /** Rentang tanggal minggu ke-n: { from, to } (YYYY-MM-DD). */
    courseWeekRange: (course, week) => {
      const start = DB.courseStartYmd(course);
      if (!start || !(week >= 1)) return null;
      const base = new Date(start + 'T00:00:00').getTime() + (week - 1) * 7 * 86400000;
      return { from: ymdOf(base), to: ymdOf(base + 6 * 86400000) };
    },
    /** Rencana materi untuk minggu tanggal tersebut (null bila belum diisi). */
    materialPlanForDate: (courseId, ymd) => {
      const course = findById(KEYS.courses, courseId);
      const w = DB.courseWeekOf(course, ymd);
      return w ? (DB.getMaterialPlans(courseId).find(m => Number(m.week) === w) || null) : null;
    },
    /** Daftar nama materi untuk isian "Materi" sebuah kelas: rencana materi dulu, lalu Materi subtest. */
    materialChoices: (courseId) => {
      const course = findById(KEYS.courses, courseId);
      const out = [];
      const seen = new Set();
      const push = (name, extra) => {
        const n = String(name || '').trim();
        if (!n || seen.has(n.toLowerCase())) return;
        seen.add(n.toLowerCase());
        out.push(Object.assign({ name: n }, extra || {}));
      };
      DB.getMaterialPlans(courseId).forEach(m => push(m.title, { week: m.week, planId: m.id, topicId: m.topicId }));
      if (global.Topics && course && course.subtest) Topics.topicsOf(course.subtest).forEach(t => push(t.name, { topicId: t.id }));
      return out;
    },

    /* ===== Anti-bentrok jadwal =====
     * Dua sesi BENTROK bila tanggalnya sama, jamnya beririsan, dan:
     *  - berada di kelas subtest yang sama, atau
     *  - kelas subtestnya berbagi kelas utama (siswa yang sama harus hadir), atau
     *  - diajar tutor yang sama.
     * Sesi yang dibatalkan tidak dihitung. Setiap pertemuan berdurasi tetap
     * 90 menit (PLAN_MINUTES); jam selesai dihitung dari jam mulai. */
    PLAN_MINUTES,
    /** "19:20" → "20:50" (jam mulai + 90 menit). */
    planEndFor: (time) => {
      const a = DB.timeToMinutes(time);
      return a == null ? '' : DB.minutesToTime(Math.min(24 * 60 - 1, a + PLAN_MINUTES));
    },
    /** Tanggal & menit "sekarang" menurut zona waktu tampilan (sama dengan jam di topbar). */
    nowParts: () => {
      const d = global.UI && UI.nowInTz ? UI.nowInTz() : new Date();
      const p = (n) => String(n).padStart(2, '0');
      return { ymd: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
    },
    /**
     * Fase sebuah pertemuan: 'ended' (jam selesai sudah lewat), 'live' (sedang
     * berlangsung), 'today' (hari ini, belum mulai), atau 'upcoming'.
     */
    planPhase: (plan, ref) => {
      const now = ref || DB.nowParts();
      if (!plan || !plan.date) return 'upcoming';
      if (plan.date < now.ymd) return 'ended';
      if (plan.date > now.ymd) return 'upcoming';
      const w = DB.planWindow(plan);
      if (!w) return 'today';
      if (now.minutes >= w.end) return 'ended';
      if (now.minutes >= w.start) return 'live';
      return 'today';
    },
    planEnded: (plan, ref) => DB.planPhase(plan, ref) === 'ended',
    timeToMinutes: (t) => {
      const m = /^\s*(\d{1,2})[:.](\d{2})/.exec(String(t || ''));
      if (!m) return null;
      const h = Number(m[1]), mi = Number(m[2]);
      if (h > 23 || mi > 59) return null;
      return h * 60 + mi;
    },
    minutesToTime: (n) => {
      const v = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(n) || 0)));
      return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
    },
    /** Rentang menit sebuah sesi {start, end} atau null bila jam mulai belum diisi. */
    planWindow: (plan) => {
      if (!plan) return null;
      const start = DB.timeToMinutes(plan.time);
      if (start == null) return null;
      let end = DB.timeToMinutes(plan.endTime);
      if (end == null || end <= start) end = Math.min(24 * 60, start + PLAN_MINUTES);
      return { start, end };
    },
    /** Pesan galat untuk jam yang tidak valid, atau null. */
    validatePlanTimes: (plan) => {
      if (!plan || plan.status === 'cancelled') return null;
      const a = DB.timeToMinutes(plan.time), b = DB.timeToMinutes(plan.endTime);
      if (a == null) return 'Jam mulai wajib diisi.';
      if (b == null) return 'Jam selesai wajib diisi.';
      if (a + PLAN_MINUTES > 24 * 60 - 1) return 'Jam mulai terlalu malam: pertemuan 90 menit harus selesai sebelum 23.59.';
      if (b - a !== PLAN_MINUTES) return `Setiap pertemuan berdurasi ${PLAN_MINUTES} menit.`;
      return null;
    },
    /** Kelas utama yang sama-sama diikuti dua kelas subtest. */
    sharedMainClasses: (courseA, courseB) => {
      const a = new Set((courseA && courseA.mainClasses) || []);
      return ((courseB && courseB.mainClasses) || []).filter(k => a.has(k));
    },
    /**
     * Sesi lain yang bentrok dengan `cand`.
     * @param {object} cand  { id?, courseId, teacherId, date, time, endTime, status }
     * @param {object} [opts] { extra: [rencana virtual, mis. hasil isi otomatis], plans: daftar pembanding }
     * @returns {Array<{plan, course, reasons:string[], mainClasses:string[]}>}
     */
    planConflicts: (cand, opts) => {
      const o = opts || {};
      if (!cand || cand.status === 'cancelled' || !cand.date) return [];
      const w = DB.planWindow(cand);
      if (!w) return [];
      const cCourse = findById(KEYS.courses, cand.courseId);
      const pool = (o.plans || getAll(KEYS.classPlans)).concat(o.extra || []);
      const out = [];
      pool.forEach(p => {
        if (!p || p === cand || (cand.id && p.id === cand.id) || p.date !== cand.date || p.status === 'cancelled') return;
        const pw = DB.planWindow(p);
        if (!pw || !(w.start < pw.end && pw.start < w.end)) return;
        const pCourse = findById(KEYS.courses, p.courseId);
        const reasons = [];
        const shared = DB.sharedMainClasses(cCourse, pCourse);
        if (p.courseId === cand.courseId) reasons.push('kelas-sama');
        else if (shared.length) reasons.push('kelas-utama');
        const candT = new Set(DB.planTeacherIds(cand));
        const tutors = DB.planTeacherIds(p).filter(id => candT.has(id));
        if (tutors.length) reasons.push('tutor');
        if (reasons.length) out.push({ plan: p, course: pCourse, reasons, mainClasses: shared, tutors });
      });
      return out;
    },
    /** Kalimat ringkas untuk satu bentrokan (dipakai form & panel War Jadwal). */
    describePlanConflict: (c) => {
      const p = c.plan;
      const name = c.course ? DB.courseTitle(c.course) : 'kelas lain';
      const names = (c.tutors || DB.planTeacherIds(p)).map(id => (DB.getUser(id) || {}).name).filter(Boolean).join(', ');
      const why = c.reasons.map(r => r === 'tutor' ? `tutor sama (${names || '-'})`
        : r === 'kelas-utama' ? `kelas utama sama (${c.mainClasses.join(', ')})` : 'kelas yang sama').join(' & ');
      return `${name} ${p.time || ''}${p.endTime ? '–' + p.endTime : ''} — ${why}`;
    },
    /** Semua pasangan sesi yang bentrok dalam rentang tanggal (opsional dibatasi daftar kelas). */
    planClashesInRange: (fromYmd, toYmd, courseIds) => {
      const allow = courseIds ? new Set(courseIds) : null;
      const plans = DB.getClassPlansInRange(fromYmd, toYmd).filter(p => p.status !== 'cancelled');
      const out = [];
      const seen = new Set();
      plans.forEach(p => {
        DB.planConflicts(p, { plans }).forEach(c => {
          if (allow && !allow.has(p.courseId) && !allow.has(c.plan.courseId)) return;
          const key = [p.id, c.plan.id].sort().join('|');
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ a: p, b: c.plan, conflict: c });
        });
      });
      return out.sort((x, y) => (x.a.date + (x.a.time || '')).localeCompare(y.a.date + (y.a.time || '')));
    },
    /**
     * Bentrok jadwal rutin kelas (hari & jam bawaan) terhadap kelas lain yang
     * berbagi kelas utama atau tutor. Dipakai sebagai peringatan di form kelas.
     */
    courseScheduleConflicts: (draft, ignoreId) => {
      const sc = (draft && draft.schedule) || {};
      const a = DB.timeToMinutes(sc.time);
      if (a == null || !(sc.days || []).length) return [];
      const b = a + PLAN_MINUTES;
      const tutors = new Set(DB.courseTeacherIds(draft));
      return getAll(KEYS.courses).filter(c => c.id !== ignoreId && c.active !== false).map(c => {
        const s2 = c.schedule || {};
        const days = (s2.days || []).filter(d => (sc.days || []).includes(d));
        const x = DB.timeToMinutes(s2.time);
        if (!days.length || x == null) return null;
        const y = x + PLAN_MINUTES;
        if (!(a < y && x < b)) return null;
        const shared = DB.sharedMainClasses(draft, c);
        const sameTutor = DB.courseTeacherIds(c).filter(id => tutors.has(id));
        if (!shared.length && !sameTutor.length) return null;
        return { course: c, days, mainClasses: shared, tutors: sameTutor };
      }).filter(Boolean);
    },

    /**
     * Tutor pertemuan sebuah kelas pada satu tanggal (opsional satu sesi tertentu).
     * Rencana kelas (War Jadwal) adalah sumber kebenarannya; tanpa rencana,
     * `scheduled:false` dan `users` kosong — pemanggil menentukan sendiri.
     * @returns {{plan, plans, users, scheduled}}
     */
    sessionTutors: (course, ymd, planId) => {
      if (!course) return { plan: null, plans: [], users: [], scheduled: false };
      const plans = DB.getPlansForCourseDate(course.id, ymd).filter(p => p.status !== 'cancelled');
      const plan = (planId && plans.find(p => p.id === planId)) || plans[0] || null;
      const users = plan ? DB.planTeachers(plan) : [];
      return { plan, plans, users, scheduled: !!plan && users.length > 0 };
    },
    /**
     * Bolehkah pengguna mengisi/mengubah presensi pertemuan ini? Admin selalu;
     * tutor hanya bila ia tutor pertemuan itu (atau tutor kelas bila belum ada rencana).
     */
    canTakeAttendance: (user, course, ymd, planId) => {
      if (!user || !course) return false;
      if (user.role === 'admin') return true;
      if (user.role !== 'guru') return false;
      const ses = DB.sessionTutors(course, ymd, planId);
      if (ses.plan) return DB.planTeacherIds(ses.plan).includes(user.id);
      return DB.courseTeacherIds(course).includes(user.id);
    },

    /** Bolehkah pengguna memvalidasi / mengubah rencana kelas ini? */
    canManagePlan: (user, plan) => {
      if (!user || !plan) return false;
      if (user.role === 'admin') return true;
      if (user.role !== 'guru') return false;
      return DB.planTeacherIds(plan).includes(user.id);
    },
    /** Selisih hari dari hari ini ke tanggal rencana (negatif = sudah lewat). */
    planDaysAhead: (ymd) => {
      if (!ymd) return 0;
      const today = new Date(DB.nowParts().ymd + 'T00:00:00');
      const target = new Date(ymd + 'T00:00:00');
      return Math.round((target - today) / 86400000);
    },

    /* ===== Kata motivasi ===== */
    getMotivations: (role) => {
      const all = getAll(KEYS.motivations);
      return role ? all.filter(m => m.role === role) : all;
    },
    getActiveMotivation: (role) => {
      const list = getAll(KEYS.motivations).filter(m => m.role === role && m.active !== false);
      if (!list.length) return null;
      // Pilih stabil per hari agar tidak berubah setiap render
      const seed = Number(DB.ymdOf(Date.now()).replace(/-/g, ''));
      return list[seed % list.length];
    },
    addMotivation: (m) => add(KEYS.motivations, Object.assign({ active: true, createdAt: Date.now() }, m)),
    updateMotivation: (id, p) => update(KEYS.motivations, id, p),
    deleteMotivation: (id) => remove(KEYS.motivations, id),

    /* ===== Soal verifikasi login ===== */
    getSecurityQuestions: () => getAll(KEYS.securityQuestions),
    getActiveSecurityQuestions: () => getAll(KEYS.securityQuestions).filter(q => q.active !== false),
    addSecurityQuestion: (q) => add(KEYS.securityQuestions, Object.assign({
      difficulty: 'mudah', active: true, source: 'admin', createdAt: Date.now()
    }, q)),
    updateSecurityQuestion: (id, p) => update(KEYS.securityQuestions, id, p),
    deleteSecurityQuestion: (id) => remove(KEYS.securityQuestions, id),
    /** Satu soal acak untuk gerbang login. */
    randomSecurityQuestion: () => {
      const list = DB.getActiveSecurityQuestions();
      if (!list.length) return null;
      return list[Math.floor(Math.random() * list.length)];
    },

    /* ===== Users ===== */
    getUsers: () => getAll(KEYS.users),
    getUser: (id) => findById(KEYS.users, id),
    /**
     * Penempatan kelas: mentee aktif tanpa kelas subtest aktif, dan tutor aktif
     * yang belum mengampu kelas aktif. Dipakai daftar akun, Ruang Perhatian, dan ringkasan admin.
     * @returns {Map<string, number>} id pengguna → jumlah kelas aktif
     */
    classCountByUser: () => {
      const active = new Map(getAll(KEYS.courses).filter(c => c.active !== false).map(c => [c.id, c]));
      const out = new Map();
      getAll(KEYS.enrollments).forEach(e => { if (active.has(e.courseId)) out.set(e.studentId, (out.get(e.studentId) || 0) + 1); });
      active.forEach(c => DB.courseTeacherIds(c).forEach(id => out.set(id, (out.get(id) || 0) + 1)));
      return out;
    },
    unplacedUsers: (role) => {
      const counts = DB.classCountByUser();
      return getAll(KEYS.users).filter(u => u.role === role && (u.status || 'Aktif') === 'Aktif' && !counts.get(u.id));
    },
    /** Subtest yang diampu tutor (data lama: satu `subject`; data baru: `subjects`). */
    userSubjects: (u) => {
      if (!u) return [];
      const list = Array.isArray(u.subjects) && u.subjects.length ? u.subjects : (u.subject ? String(u.subject).split(/\s*[,;]\s*/) : []);
      return [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))];
    },
    /** Label ringkas: "PK, PU" (nama manual ditampilkan apa adanya). */
    userSubjectsLabel: (u, sep) => DB.userSubjects(u).map(n => { const st = subtestByName(n); return st ? st.short : n; }).join(sep || ', '),
    /** Nama subtest dari teks bebas (kode/singkatan/nama) → nama resmi atau teks aslinya. */
    resolveSubjectNames: (raw) => [...new Set(String(raw || '').split(/\s*[,;|]\s*/).map(x => x.trim()).filter(Boolean).map(v => {
      const hit = SUBTESTS.find(st => [st.name, st.short, st.code].some(n => n.toLowerCase() === v.toLowerCase()));
      return hit ? hit.name : v.slice(0, 80);
    }))],
    findUserByUsername: (u) => getAll(KEYS.users).find(x => x.username.toLowerCase() === String(u).toLowerCase()) || null,
    addUser: (u) => {
      const rec = add(KEYS.users, u);
      DB.logActivity('user.add', `Menambah akun ${u.role || ''} "${u.name || u.username}"`, u.id);
      // Mentee baru dengan kelas utama langsung masuk ke semua kelas subtest kelas utama itu.
      if (rec.role === 'siswa' && rec.kelas) DB.syncStudentMainClass(rec.id, '');
      return rec;
    },
    updateUser: (id, p) => {
      const prev = p && Object.prototype.hasOwnProperty.call(p, 'kelas') ? findById(KEYS.users, id) : null;
      const rec = update(KEYS.users, id, p);
      // Kelas utama disimpan → samakan pendaftaran kelas subtest (juga memperbaiki yang belum terdaftar).
      if (prev && prev.role === 'siswa') DB.syncStudentMainClass(id, prev.kelas || '');
      // Pembaruan profil kecil (mis. lastSeen) tidak perlu dicatat.
      const keys = Object.keys(p || {}).filter(k => !['lastSeen', 'lastLogin'].includes(k));
      if (rec && keys.length) DB.logActivity('user.update', `Memperbarui akun "${rec.name}" (${keys.join(', ')})`, id);
      return rec;
    },
    /**
     * Ringkasan data milik seorang tutor/admin sebelum akunnya dihapus.
     * @returns {{materials, modules, recordings, assignments, cbts, questions, courses, futurePlans, total}}
     */
    ownedContentSummary: (id) => {
      const by = (key) => getAll(key).filter(x => x.createdBy === id).length;
      const today = ymdOf(new Date());
      const out = {
        materials: by(KEYS.materials), modules: by(KEYS.modules), recordings: by(KEYS.recordings),
        assignments: by(KEYS.assignments), cbts: by(KEYS.cbts),
        questions: getAll(KEYS.questions).filter(q => q.authorId === id).length,
        courses: getAll(KEYS.courses).filter(c => DB.courseTeacherIds(c).includes(id)).length,
        futurePlans: getAll(KEYS.classPlans).filter(p => DB.planTeacherIds(p).includes(id) && p.date >= today).length
      };
      out.total = out.materials + out.modules + out.recordings + out.assignments + out.cbts + out.questions;
      return out;
    },
    /**
     * Hapus akun. Untuk tutor/admin, seluruh konten buatannya TIDAK ikut
     * terhapus: kepemilikan dialihkan ke `opts.reassignTo` (id tutor baru atau
     * DB.ADMIN_OWNER, bawaan Admin). Kelas tidak pernah dihapus otomatis —
     * kelas tanpa tutor tetap ada (dikelola admin) beserta seluruh isinya.
     */
    deleteUser: (id, opts) => {
      const victim = findById(KEYS.users, id);
      if (victim) DB.logActivity('user.delete', `Menghapus akun ${victim.role} "${victim.name}"`, id);
      const user = findById(KEYS.users, id);
      if (user && (user.role === 'guru' || user.role === 'admin')) {
        const target = opts && opts.reassignTo && opts.reassignTo !== id ? opts.reassignTo : ADMIN_OWNER;
        const heir = target === ADMIN_OWNER ? null : findById(KEYS.users, target);
        const ownerId = heir && heir.role === 'guru' ? heir.id : ADMIN_OWNER;
        const now = Date.now();
        [KEYS.materials, KEYS.modules, KEYS.recordings, KEYS.assignments, KEYS.cbts].forEach(key => {
          const list = getAll(key);
          let changed = false;
          list.forEach(x => {
            if (x.createdBy === id) { x.createdBy = ownerId; x.ownerChangedAt = now; x.ownerChangedFrom = id; changed = true; }
          });
          if (changed) setAll(key, list);
        });
        const qs = getAll(KEYS.questions);
        if (qs.some(q => q.authorId === id)) setAll(KEYS.questions, qs.map(q => q.authorId === id ? Object.assign({}, q, { authorId: ownerId }) : q));
        if (user.role === 'guru') {
          // Lepas tutor dari kelas; tutor pengganti (bila dipilih) mengambil posisinya.
          getAll(KEYS.courses).forEach(c => {
            const ids = DB.courseTeacherIds(c);
            if (!ids.includes(id)) return;
            let next = ids.map(x => (x === id && heir && heir.role === 'guru' ? heir.id : x)).filter(x => x !== id);
            next = [...new Set(next)];
            const patch = { teacherIds: next, teacherId: next[0] || null };
            // Judul kelas tidak memuat nama tutor (lihat cleanCourseTitle), jadi cukup data tutornya.
            const t = cleanCourseTitle(c);
            if (c.title && t !== c.title) patch.title = t;
            update(KEYS.courses, c.id, patch);
          });
          // Sesi mendatang pindah ke tutor pengganti; riwayat sesi lampau tetap tersimpan.
          const today = ymdOf(new Date());
          setAll(KEYS.classPlans, getAll(KEYS.classPlans).map(pl => {
            const ids = DB.planTeacherIds(pl);
            if (!ids.includes(id) || pl.date < today) return pl;
            const next = [...new Set(ids.map(x => (x === id ? (heir && heir.role === 'guru' ? heir.id : null) : x)).filter(Boolean))];
            return Object.assign({}, pl, { teacherIds: next, teacherId: next[0] || null, updatedAt: now });
          }));
          const mps = getAll(KEYS.materialPlans);
          if (mps.some(m => (m.teacherIds || []).includes(id))) {
            setAll(KEYS.materialPlans, mps.map(m => ((m.teacherIds || []).includes(id)
              ? Object.assign({}, m, { teacherIds: [...new Set(m.teacherIds.map(x => (x === id ? (heir && heir.role === 'guru' ? heir.id : null) : x)).filter(Boolean))], updatedAt: now }) : m)));
          }
          setAll(KEYS.salaries, getAll(KEYS.salaries).filter(s => s.teacherId !== id));
          setAll(KEYS.attendance, getAll(KEYS.attendance).filter(a => a.userId !== id));
        }
      }
      if (user && user.role === 'siswa') {
        setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => e.studentId !== id));
        setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => s.studentId !== id));
        setAll(KEYS.cbtAttempts, getAll(KEYS.cbtAttempts).filter(a => a.studentId !== id));
        setAll(KEYS.attendance, getAll(KEYS.attendance).filter(a => a.userId !== id));
        setAll(KEYS.payments, getAll(KEYS.payments).filter(p => p.studentId !== id));
        save('lms_birthday_rewards', DB.getBirthdayRewards().filter(r => r.studentId !== id));
        save('lms_birthday_wishes', DB.getBirthdayWishes().filter(w => w.recipientId !== id));
        save('lms_learning_log', load('lms_learning_log', []).filter(e => e.userId !== id));
        save('lms_streak_grants', load('lms_streak_grants', []).filter(g => g.userId !== id));
        save('lms_hub_progress', load('lms_hub_progress', []).filter(p => p.studentId !== id));
        // Bukti transfer (berkas proof:<id>:*) ikut dihapus server saat akun dihapus.
        save('lms_hub_payments', load('lms_hub_payments', []).filter(p => p.studentId !== id));
        // Kapsul terenkripsi ikut dihapus (tidak ada yang dapat membukanya lagi).
        save('lms_capsules', load('lms_capsules', []).filter(c => c.userId !== id));
        save('lms_capsule_vaults', load('lms_capsule_vaults', []).filter(v => v.userId !== id));
        // Riwayat jawaban soal & progres kosakata (record per mentee)
        if (getAll(KEYS.qHistory).some(r => r.userId === id)) setAll(KEYS.qHistory, getAll(KEYS.qHistory).filter(r => r.userId !== id));
        if (getAll(KEYS.vocabProgress).some(r => r.userId === id)) setAll(KEYS.vocabProgress, getAll(KEYS.vocabProgress).filter(r => r.userId !== id));
        if (global.BlobStore) BlobStore.removePrefix('cap:' + id + ':').catch(() => {});
        // Keep orang tua accounts consistent: drop the link to this child.
        getAll(KEYS.users)
          .filter(u => u.role === 'orangtua' && Array.isArray(u.childIds) && u.childIds.includes(id))
          .forEach(p => update(KEYS.users, p.id, { childIds: p.childIds.filter(c => c !== id) }));
      }
      // Riwayat chat AI milik akun ini
      if (load(AI_CHAT_KEY, []).some(t => t && t.userId === id)) save(AI_CHAT_KEY, load(AI_CHAT_KEY, []).filter(t => !t || t.userId !== id));
      // Grup Belajar: keluarkan dari keanggotaan, hapus pesan & jawaban kuis akun ini
      const grs = load('lms_groups', []);
      if (grs.some(g => (g.memberIds || []).includes(id) || (g.tutorIds || []).includes(id))) {
        save('lms_groups', grs.map(g => ((g.memberIds || []).includes(id) || (g.tutorIds || []).includes(id)
          ? Object.assign({}, g, { memberIds: (g.memberIds || []).filter(x => x !== id), tutorIds: (g.tutorIds || []).filter(x => x !== id), updatedAt: Date.now() }) : g)));
      }
      if (load('lms_group_posts', []).some(p => p.authorId === id && p.kind === 'message')) save('lms_group_posts', load('lms_group_posts', []).filter(p => !(p.authorId === id && p.kind === 'message')));
      if (load('lms_group_answers', []).some(a => a.userId === id)) save('lms_group_answers', load('lms_group_answers', []).filter(a => a.userId !== id));
      // Skor, pilihan jurusan, dan pengingat Tools milik akun ini
      if (load('lms_utbk_plans', []).some(p => p && p.userId === id)) save('lms_utbk_plans', load('lms_utbk_plans', []).filter(p => !p || p.userId !== id));
      // Messages + notifications belonging to the removed account
      setAll(KEYS.notifications, getAll(KEYS.notifications).filter(n => n.userId !== id));
      save('lms_birthday_wishes', DB.getBirthdayWishes().filter(w => w.authorId !== id));
      try {
        const msgs = JSON.parse(localStorage.getItem('lms_messages') || '[]')
          .filter(m => m.senderId !== id && m.receiverId !== id);
        localStorage.setItem('lms_messages', JSON.stringify(msgs));
      } catch (e) { /* noop */ }
      remove(KEYS.users, id);
    },

    /* ===== Ulang tahun & Birthday Wall =====
     * Ucapan: { id, recipientId, authorId, year, template, text, sticker,
     *           status:'visible'|'pending'|'hidden', reports:[{by,reason,at}],
     *           createdAt }
     * Hadiah: buku besar { id, studentId, year, points, openedAt } — satu
     *         entri per siswa per tahun sehingga poin tidak pernah dobel. */
    /** Tanggal ulang tahun pada tahun berjalan; null bila belum diisi. */
    birthdayInfo: (user, refTs) => {
      if (!user || !user.birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(user.birthDate)) return null;
      const now = new Date(refTs || Date.now());
      const [by, bm, bd] = user.birthDate.split('-').map(Number);
      const y = now.getFullYear();
      // 29 Februari dirayakan 28 Februari pada tahun non-kabisat.
      const isLeap = (yy) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
      const dayFor = (yy) => (bm === 2 && bd === 29 && !isLeap(yy)) ? 28 : bd;
      const todayYmd = DB.ymdOf(now.getTime());
      const pad = n => String(n).padStart(2, '0');
      let next = `${y}-${pad(bm)}-${pad(dayFor(y))}`;
      if (next < todayYmd) next = `${y + 1}-${pad(bm)}-${pad(dayFor(y + 1))}`;
      // Selisih dihitung terhadap tanggal referensi, bukan selalu "sekarang".
      const daysUntil = Math.round((new Date(next + 'T00:00:00') - new Date(todayYmd + 'T00:00:00')) / 86400000);
      return {
        isToday: daysUntil === 0,
        daysUntil,
        nextDate: next,
        age: Number(next.slice(0, 4)) - by,
        year: Number(next.slice(0, 4))
      };
    },
    /** Siswa aktif yang berulang tahun dalam `days` hari ke depan (0 = hari ini). */
    getBirthdays: (days) => {
      const range = Number(days) || 0;
      return getAll(KEYS.users)
        .filter(u => u.role === 'siswa' && (u.status || 'Aktif') !== 'Dikeluarkan')
        .map(u => ({ user: u, info: DB.birthdayInfo(u) }))
        .filter(x => x.info && x.info.daysUntil >= 0 && x.info.daysUntil <= range)
        .sort((a, b) => a.info.daysUntil - b.info.daysUntil || a.user.name.localeCompare(b.user.name));
    },
    /**
     * Jendela ucapan: dibuka 7 hari sebelum s.d. 7 hari sesudah ulang tahun.
     * → { year, open, phase:'before'|'today'|'after'|'closed', date }
     */
    birthdayWishWindow: (user, refTs) => {
      const info = DB.birthdayInfo(user, refTs);
      if (!info) return null;
      const DAYS = 7;
      if (info.isToday) return { year: info.year, open: true, phase: 'today', date: info.nextDate };
      if (info.daysUntil <= DAYS) return { year: info.year, open: true, phase: 'before', date: info.nextDate };
      // Ulang tahun terakhir = tanggal yang sama setahun sebelum nextDate.
      const prev = DB.birthdayInfo(user, (refTs || Date.now()) - (DAYS + 1) * 86400000);
      if (prev && prev.year < info.year) {
        const since = Math.round((new Date(DB.ymdOf(refTs || Date.now()) + 'T00:00:00') - new Date(prev.nextDate + 'T00:00:00')) / 86400000);
        if (since >= 0 && since <= DAYS) return { year: prev.year, open: true, phase: 'after', date: prev.nextDate };
      }
      return { year: info.year, open: false, phase: 'closed', date: info.nextDate };
    },
    getBirthdayWishes: () => load('lms_birthday_wishes', []),
    /** Ucapan yang boleh dilihat `viewer` untuk seorang penerima pada tahun itu. */
    getWishesFor: (recipientId, year, viewer) => {
      const isMod = viewer && viewer.role === 'admin';
      return DB.getBirthdayWishes()
        .filter(w => w.recipientId === recipientId && (!year || w.year === year))
        .filter(w => w.status === 'visible' || isMod || (viewer && w.authorId === viewer.id))
        .sort((a, b) => a.createdAt - b.createdAt);
    },
    /** Hanya siswa, tutor, dan admin yang boleh menulis ucapan. */
    canSendWish: (user, recipient) => {
      if (!user || !recipient || recipient.role !== 'siswa') return false;
      if (user.id === recipient.id) return false;
      return ['siswa', 'guru', 'admin'].includes(user.role);
    },
    addBirthdayWish: (wish, actor) => {
      const recipient = findById(KEYS.users, wish.recipientId);
      if (!DB.canSendWish(actor, recipient)) throw new Error('Anda tidak dapat mengirim ucapan untuk pengguna ini.');
      const text = String(wish.text || '').trim();
      if (text.length < 2) throw new Error('Ucapan terlalu pendek.');
      if (text.length > 500) throw new Error('Ucapan maksimal 500 karakter.');
      if (DB.getSettings().birthdayEnabled === false) throw new Error('Fitur ulang tahun sedang dinonaktifkan admin.');
      const win = DB.birthdayWishWindow(recipient);
      if (!win) throw new Error('Tanggal lahir penerima belum diisi.');
      if (!win.open) throw new Error('Ucapan hanya dapat dikirim 7 hari sebelum hingga 7 hari sesudah ulang tahun.');
      const list = DB.getBirthdayWishes();
      const year = win.year;
      // Batasi spam: satu ucapan per penulis per penerima per tahun.
      if (list.some(w => w.recipientId === recipient.id && w.authorId === actor.id && w.year === year)) {
        throw new Error('Anda sudah mengirim ucapan untuk teman ini tahun ini.');
      }
      const premod = DB.getSettings().birthdayModeration === 'pre' && actor.role !== 'admin';
      const rec = {
        id: uid('wish'), recipientId: recipient.id, authorId: actor.id, year,
        template: String(wish.template || 'classic'), text,
        sticker: String(wish.sticker || ''),
        status: premod ? 'pending' : 'visible',
        reports: [], createdAt: Date.now()
      };
      list.push(rec);
      save('lms_birthday_wishes', list);
      return rec;
    },
    updateBirthdayWish: (id, patch) => {
      const list = DB.getBirthdayWishes();
      const i = list.findIndex(w => w.id === id);
      if (i < 0) return null;
      list[i] = Object.assign({}, list[i], patch);
      save('lms_birthday_wishes', list);
      return list[i];
    },
    /** Moderasi hanya oleh admin; penulis boleh menghapus ucapannya sendiri. */
    moderateWish: (id, status, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat memoderasi ucapan.');
      if (!['visible', 'hidden'].includes(status)) throw new Error('Status moderasi tidak valid.');
      const r = DB.updateBirthdayWish(id, { status, moderatedBy: actor.id, moderatedAt: Date.now() });
      if (r) DB.logActivity('birthday.moderate', `Moderasi ucapan ulang tahun → ${status === 'visible' ? 'ditampilkan' : 'disembunyikan'}`, id);
      return r;
    },
    deleteBirthdayWish: (id, actor) => {
      const w = DB.getBirthdayWishes().find(x => x.id === id);
      if (!w) return;
      if (!actor || (actor.role !== 'admin' && actor.id !== w.authorId)) throw new Error('Anda tidak berhak menghapus ucapan ini.');
      save('lms_birthday_wishes', DB.getBirthdayWishes().filter(x => x.id !== id));
      if (actor.role === 'admin' && actor.id !== w.authorId) DB.logActivity('birthday.delete', 'Menghapus ucapan ulang tahun', id);
    },
    /** Laporan pesan tidak pantas; ≥3 laporan otomatis menyembunyikan ucapan. */
    reportWish: (id, reason, actor) => {
      const w = DB.getBirthdayWishes().find(x => x.id === id);
      if (!w || !actor) return null;
      if (w.authorId === actor.id) throw new Error('Tidak dapat melaporkan ucapan sendiri.');
      const reports = (w.reports || []).slice();
      if (reports.some(r => r.by === actor.id)) throw new Error('Anda sudah melaporkan ucapan ini.');
      reports.push({ by: actor.id, reason: String(reason || '').slice(0, 200), at: Date.now() });
      const patch = { reports };
      if (reports.length >= 3 && w.status === 'visible') patch.status = 'hidden';
      return DB.updateBirthdayWish(id, patch);
    },
    getBirthdayRewards: () => load('lms_birthday_rewards', []),
    /** Bonus poin ulang tahun milik siswa (sudah dibuka). */
    birthdayBonusPoints: (studentId) => DB.getBirthdayRewards()
      .filter(r => r.studentId === studentId && r.openedAt)
      .reduce((n, r) => n + (Number(r.points) || 0), 0),
    /** Buka hadiah: hanya pada hari ulang tahun, sekali per tahun. */
    claimBirthdayReward: (student) => {
      const info = DB.birthdayInfo(student);
      if (!info || !info.isToday) throw new Error('Hadiah hanya dapat dibuka pada hari ulang tahun.');
      const st = DB.getSettings();
      if (st.birthdayEnabled === false) throw new Error('Fitur ulang tahun sedang dinonaktifkan admin.');
      const list = DB.getBirthdayRewards();
      const existing = list.find(r => r.studentId === student.id && r.year === info.year);
      if (existing) return existing;
      const rec = {
        id: uid('bday'), studentId: student.id, year: info.year,
        points: Math.max(0, Math.min(1000, Number(st.birthdayPoints) || 0)),
        openedAt: Date.now()
      };
      list.push(rec);
      save('lms_birthday_rewards', list);
      return rec;
    },
    birthdayRewardFor: (studentId, year) =>
      DB.getBirthdayRewards().find(r => r.studentId === studentId && r.year === year) || null,

    /* ===== Orang Tua / Wali <-> Siswa linking ===== */
    getParents: () => getAll(KEYS.users).filter(u => u.role === 'orangtua'),
    /** Siswa yang dipantau oleh satu akun orang tua. */
    getChildren: (parentId) => {
      const p = findById(KEYS.users, parentId);
      if (!p || !Array.isArray(p.childIds)) return [];
      return p.childIds.map(id => findById(KEYS.users, id)).filter(Boolean);
    },
    /** Semua orang tua yang terhubung ke satu siswa. */
    getParentsOfStudent: (studentId) =>
      getAll(KEYS.users).filter(u => u.role === 'orangtua' && Array.isArray(u.childIds) && u.childIds.includes(studentId)),
    setChildren: (parentId, childIds) => update(KEYS.users, parentId, { childIds: [...new Set(childIds || [])] }),
    linkChild: (parentId, studentId) => {
      const p = findById(KEYS.users, parentId);
      if (!p) return null;
      const ids = new Set(Array.isArray(p.childIds) ? p.childIds : []);
      ids.add(studentId);
      return update(KEYS.users, parentId, { childIds: [...ids] });
    },
    unlinkChild: (parentId, studentId) => {
      const p = findById(KEYS.users, parentId);
      if (!p) return null;
      const ids = (Array.isArray(p.childIds) ? p.childIds : []).filter(id => id !== studentId);
      return update(KEYS.users, parentId, { childIds: ids });
    },

    /* ===== Courses ===== */
    getCourses: () => getAll(KEYS.courses).map(withCleanTitle),
    getCourse: (id) => withCleanTitle(findById(KEYS.courses, id)),
    /** Kelas yang dilindungi password (diatur admin / guru pemilik). */
    hasCoursePassword: (id) => {
      const c = findById(KEYS.courses, id);
      return !!(c && c.password && String(c.password).trim() !== '');
    },
    verifyCoursePassword: (id, input) => {
      const c = findById(KEYS.courses, id);
      if (!c) return false;
      if (!c.password || String(c.password).trim() === '') return true;
      return String(c.password).trim() === String(input || '').trim();
    },
    getCoursesByTeacher: (tid) => getAll(KEYS.courses).filter(c => DB.courseTeacherIds(c).includes(tid)).map(withCleanTitle),
    /**
     * Rapikan judul kelas yang tersimpan (hapus nama tutor dari judul lama).
     * Dijalankan admin saat masuk; mengembalikan jumlah kelas yang diubah.
     */
    tidyCourseTitles: () => {
      const list = getAll(KEYS.courses);
      let n = 0;
      list.forEach(c => { const t = cleanCourseTitle(c); if (c.title && t !== c.title) { c.title = t; n++; } });
      if (n) setAll(KEYS.courses, list);
      return n;
    },
    addCourse: (c) => {
      const rec = Object.assign({ createdAt: Date.now(), mainClasses: [], teacherIds: [] }, c);
      if ((!rec.teacherIds || !rec.teacherIds.length) && rec.teacherId) rec.teacherIds = [rec.teacherId];
      if (rec.teacherIds && rec.teacherIds.length) rec.teacherId = rec.teacherIds[0];
      const created = add(KEYS.courses, rec);
      // Langsung daftarkan mentee dari kelas utama yang dipilih
      applyCourseMainClasses(created.id, [], created.mainClasses || []);
      return created;
    },
    /** Perubahan kelas utama ikut mendaftarkan/melepas mentee (opts.keepEnrollments untuk penggantian nama). */
    updateCourse: (id, p, opts) => {
      const patch = Object.assign({}, p);
      if (Array.isArray(patch.teacherIds)) patch.teacherId = patch.teacherIds[0] || null;
      const before = Array.isArray(patch.mainClasses) ? findById(KEYS.courses, id) : null;
      const rec = update(KEYS.courses, id, patch);
      if (rec && before && !(opts && opts.keepEnrollments)) applyCourseMainClasses(id, before.mainClasses || [], rec.mainClasses || []);
      return rec;
    },
    deleteCourse: (id) => {
      setAll(KEYS.materials, getAll(KEYS.materials).filter(m => m.courseId !== id));
      setAll(KEYS.modules, getAll(KEYS.modules).filter(m => m.courseId !== id));
      setAll(KEYS.recordings, getAll(KEYS.recordings).filter(r => r.courseId !== id));
      const asgIds = getAll(KEYS.assignments).filter(a => a.courseId === id).map(a => a.id);
      setAll(KEYS.assignments, getAll(KEYS.assignments).filter(a => a.courseId !== id));
      setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => !asgIds.includes(s.assignmentId)));
      const cbtIds = getAll(KEYS.cbts).filter(c => c.courseId === id).map(c => c.id);
      setAll(KEYS.cbts, getAll(KEYS.cbts).filter(c => c.courseId !== id));
      setAll(KEYS.cbtAttempts, getAll(KEYS.cbtAttempts).filter(a => !cbtIds.includes(a.cbtId)));
      setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => e.courseId !== id));
      setAll(KEYS.attendance, getAll(KEYS.attendance).filter(a => a.courseId !== id));
      setAll(KEYS.payments, getAll(KEYS.payments).filter(p => p.courseId !== id));
      setAll(KEYS.classPlans, getAll(KEYS.classPlans).filter(pl => pl.courseId !== id));
      setAll(KEYS.materialPlans, getAll(KEYS.materialPlans).filter(m => m.courseId !== id));
      setAll(KEYS.whiteboards, getAll(KEYS.whiteboards).filter(w => w.courseId !== id));
      if (global.BlobStore) BlobStore.removePrefix(`wb:${id}:`).catch(() => {});
      save('lms_whiteboard_boards', load('lms_whiteboard_boards', []).filter(x => x.courseId !== id));
      remove(KEYS.courses, id);
    },

    /* =====================================================================
     * KEPEMILIKAN KONTEN KELAS
     * Satu kelas subtest bisa diampu beberapa tutor, tetapi satu pertemuan
     * hanya diajar satu tutor. Karena itu setiap materi/modul/rekaman/tugas/
     * CBT mencatat `createdBy` (tutor penanggung jawab) supaya rekap keaktifan
     * tiap tutor akurat. Admin yang membuat konten atas nama tutor mengisi
     * `createdBy` secara manual dan `enteredBy` menyimpan siapa yang mengetik.
     * ===================================================================*/

    /** Id tutor penanggung jawab sebuah konten (null bila belum tercatat). */
    contentOwnerId: (rec) => (rec && (rec.createdBy || null)) || null,

    /** Nama tutor penanggung jawab; jatuh ke tutor pertama kelas bila kosong. */
    contentOwnerName: (rec, course) => {
      const id = rec && rec.createdBy;
      if (id === ADMIN_OWNER) return 'Admin Rubela';
      if (id) {
        const u = findById(KEYS.users, id);
        if (u) return u.name;
        return 'Pembuat lama (akun dihapus)';
      }
      if (course) {
        const first = DB.courseTeachers(course)[0];
        if (first) return first.name;
      }
      return '';
    },

    /** Keterangan lengkap: "Bu Maria" atau "Bu Maria (dicatat admin)". */
    contentCreditLabel: (rec, course) => {
      const name = DB.contentOwnerName(rec, course);
      if (!name) return '';
      if (rec && rec.enteredBy && rec.enteredBy !== rec.createdBy && rec.createdBy !== ADMIN_OWNER) {
        const by = findById(KEYS.users, rec.enteredBy);
        if (by && by.role === 'admin') return name + ' (dicatat admin)';
        if (by) return name + ' (dicatat ' + by.name + ')';
      }
      return name;
    },

    /**
     * Bolehkah pengguna ini menyunting / menilai sebuah konten?
     * Admin selalu boleh. Tutor hanya boleh bila dia pencatatnya — bila
     * `createdBy` belum tercatat (data lama), semua tutor kelas itu boleh
     * supaya konten warisan tidak terkunci permanen.
     */
    canManageContent: (user, rec, course) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (user.role !== 'guru') return false;
      const owner = rec && rec.createdBy;
      if (owner === ADMIN_OWNER) return false;          // konten milik admin hanya diubah admin
      // Belum tercatat, atau akun pembuatnya sudah dihapus: tutor kelas itu boleh mengelola
      if (!owner || !findById(KEYS.users, owner)) return course ? DB.courseTeacherIds(course).includes(user.id) : true;
      return owner === user.id;
    },
    /** Pembuat tercatat tetapi akunnya sudah tidak ada. */
    isOrphanContent: (rec) => !!(rec && rec.createdBy && rec.createdBy !== ADMIN_OWNER && !findById(KEYS.users, rec.createdBy)),
    /** Pilihan pembuat konten: Admin + seluruh tutor aktif. */
    ownerCandidates: () => [{ id: ADMIN_OWNER, name: 'Admin Rubela', role: 'admin' }].concat(
      getAll(KEYS.users).filter(u => u.role === 'guru' && (u.status || 'Aktif') !== 'Nonaktif')
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))),
    /**
     * Ganti pembuat (penanggung jawab) beberapa konten sekaligus — khusus admin.
     * @param {Array<{kind,id}>} items  kind: material|module|recording|assignment|cbt|question
     * @param {string} ownerId          id tutor atau DB.ADMIN_OWNER
     */
    reassignContentOwner: (items, ownerId, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengganti pembuat konten.');
      const owner = ownerId === ADMIN_OWNER ? null : findById(KEYS.users, ownerId);
      if (ownerId !== ADMIN_OWNER && (!owner || owner.role !== 'guru')) throw new Error('Pilih Admin atau tutor yang terdaftar.');
      let n = 0;
      (items || []).forEach(it => {
        if (it.kind === 'question') {
          if (findById(KEYS.questions, it.id)) { update(KEYS.questions, it.id, { authorId: ownerId, updatedAt: Date.now() }); n++; }
          return;
        }
        const key = DB.CONTENT_STORE[it.kind];
        if (!key || it.kind === 'course' || !findById(key, it.id)) return;
        update(key, it.id, { createdBy: ownerId, ownerChangedAt: Date.now(), ownerChangedBy: actor.id });
        n++;
      });
      DB.logActivity('content.owner', `Mengganti pembuat ${n} konten menjadi ${owner ? owner.name : 'Admin'}`, ownerId);
      return n;
    },

    /** Stempel pembuat untuk payload baru. */
    stampCreator: (payload, user, ownerId) => {
      const out = Object.assign({}, payload);
      out.createdBy = ownerId || (user && user.role === 'guru' ? user.id : null) || null;
      out.enteredBy = (user && user.id) || null;
      out.createdAt = out.createdAt || Date.now();
      return out;
    },

    /** Stempel penyunting untuk payload edit (pembuat asli dipertahankan). */
    stampEditor: (payload, user) => {
      const out = Object.assign({}, payload);
      out.updatedBy = (user && user.id) || null;
      out.updatedAt = Date.now();
      return out;
    },

    /* ===== Materials ===== */
    getMaterials: () => getAll(KEYS.materials),
    getMaterial: (id) => findById(KEYS.materials, id),
    getMaterialsByCourse: (cid) => getAll(KEYS.materials).filter(m => m.courseId === cid),
    addMaterial: (m) => add(KEYS.materials, Object.assign({ createdAt: Date.now() }, m)),
    updateMaterial: (id, p) => update(KEYS.materials, id, p),
    deleteMaterial: (id) => remove(KEYS.materials, id),

    /* ===== Modules ===== */
    getModules: () => getAll(KEYS.modules),
    getModule: (id) => findById(KEYS.modules, id),
    getModulesByCourse: (cid) => getAll(KEYS.modules).filter(m => m.courseId === cid),
    addModule: (m) => add(KEYS.modules, Object.assign({ createdAt: Date.now(), sections: [] }, m)),
    updateModule: (id, p) => update(KEYS.modules, id, p),
    deleteModule: (id) => remove(KEYS.modules, id),

    /* ===== Recordings ===== */
    getRecordings: () => getAll(KEYS.recordings),
    getRecording: (id) => findById(KEYS.recordings, id),
    getRecordingsByCourse: (cid) => getAll(KEYS.recordings).filter(r => r.courseId === cid),
    addRecording: (r) => add(KEYS.recordings, Object.assign({ recordedAt: Date.now(), createdAt: Date.now() }, r)),
    updateRecording: (id, p) => update(KEYS.recordings, id, p),
    deleteRecording: (id) => remove(KEYS.recordings, id),

    /* ===== Assignments ===== */
    getAssignments: () => getAll(KEYS.assignments),
    getAssignment: (id) => findById(KEYS.assignments, id),
    getAssignmentsByCourse: (cid) => getAll(KEYS.assignments).filter(a => a.courseId === cid),
    addAssignment: (a) => add(KEYS.assignments, Object.assign({ createdAt: Date.now() }, a)),
    updateAssignment: (id, p) => update(KEYS.assignments, id, p),
    deleteAssignment: (id) => {
      setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => s.assignmentId !== id));
      remove(KEYS.assignments, id);
    },

    /* ===== Submissions ===== */
    getSubmissions: () => getAll(KEYS.submissions),
    getSubmission: (id) => findById(KEYS.submissions, id),
    getSubmissionsByAssignment: (aid) => getAll(KEYS.submissions).filter(s => s.assignmentId === aid),
    getSubmissionByStudent: (aid, sid) => getAll(KEYS.submissions).find(s => s.assignmentId === aid && s.studentId === sid) || null,
    getSubmissionsByStudent: (sid) => getAll(KEYS.submissions).filter(s => s.studentId === sid),
    addSubmission: (s) => add(KEYS.submissions, Object.assign({ submittedAt: Date.now() }, s)),
    updateSubmission: (id, p) => update(KEYS.submissions, id, p),

    /* ===== Enrollments ===== */
    getEnrollments: () => getAll(KEYS.enrollments),
    getEnrollmentsByStudent: (sid) => getAll(KEYS.enrollments).filter(e => e.studentId === sid),
    getEnrollmentsByCourse: (cid) => getAll(KEYS.enrollments).filter(e => e.courseId === cid),
    isEnrolled: (cid, sid) => !!getAll(KEYS.enrollments).find(e => e.courseId === cid && e.studentId === sid),
    /** via: 'self' (mentee bergabung sendiri), 'manual' (admin/tutor), 'main' (mengikuti kelas utama). */
    enroll: (cid, sid, via) => changeEnrollments([{ courseId: cid, studentId: sid, via: via || 'manual' }], []).added[0] || null,
    unenroll: (cid, sid) => {
      setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => !(e.courseId === cid && e.studentId === sid)));
    },

    /* ===== Question Bank ===== */
    getQuestions: () => getAll(KEYS.questions),
    getQuestion: (id) => findById(KEYS.questions, id),
    getQuestionsByAuthor: (aid) => getAll(KEYS.questions).filter(q => q.authorId === aid),
    addQuestion: (q) => add(KEYS.questions, Object.assign({ createdAt: Date.now() }, q)),
    updateQuestion: (id, p) => update(KEYS.questions, id, p),
    deleteQuestion: (id) => {
      // Lepas soal dari ujian yang memakainya (daftar lama & per bagian subtest).
      const list = getAll(KEYS.cbts);
      let changed = false;
      list.forEach(c => {
        const uses = (c.questionIds || []).includes(id) || (c.sections || []).some(s => (s.questionIds || []).includes(id));
        if (!uses) return;
        changed = true;
        c.questionIds = (c.questionIds || []).filter(qid => qid !== id);
        if (Array.isArray(c.sections)) c.sections = c.sections.map(s => Object.assign({}, s, { questionIds: (s.questionIds || []).filter(qid => qid !== id) }));
      });
      if (changed) setAll(KEYS.cbts, list);
      remove(KEYS.questions, id);
    },

    /* ===== Teks Bacaan (stimulus bersama beberapa soal) =====
     * { id, title, subject, html, authorId, createdAt, updatedAt }. Soal menautkannya
     * lewat `passageId`; saat ujian teks tampil sekali di atas kelompok soalnya. */
    getPassages: () => getAll(KEYS.passages),
    getPassage: (id) => (id ? findById(KEYS.passages, id) : null),
    questionsOfPassage: (pid) => getAll(KEYS.questions).filter(q => q.passageId === pid),
    addPassage: (p) => add(KEYS.passages, Object.assign({ createdAt: Date.now(), updatedAt: Date.now(), title: '', html: '' }, p)),
    updatePassage: (id, patch) => update(KEYS.passages, id, Object.assign({ updatedAt: Date.now() }, patch)),
    /** Hapus teks bacaan; soal yang menautkannya tetap ada tanpa teks. */
    deletePassage: (id) => {
      const qs = getAll(KEYS.questions);
      if (qs.some(q => q.passageId === id)) setAll(KEYS.questions, qs.map(q => (q.passageId === id ? Object.assign({}, q, { passageId: null }) : q)));
      remove(KEYS.passages, id);
    },
    /** Teks bacaan dengan isi sama dipakai ulang (impor berulang tidak menggandakan teks). */
    passageKey: (h) => {
      const src = String(h || '');
      if (passageKeyCache.has(src)) return passageKeyCache.get(src);
      const k = (global.RichText ? RichText.plain(src, 20000) : src).toLowerCase().replace(/\s+/g, ' ').trim();
      if (passageKeyCache.size > 500) passageKeyCache.clear();
      passageKeyCache.set(src, k);
      return k;
    },
    /** Teks bacaan tersimpan yang isinya sama (tanpa membuat baru). */
    findPassage: (p) => {
      const k = DB.passageKey(p && p.html);
      if (!k) return null;
      return getAll(KEYS.passages).find(x => DB.passageKey(x.html) === k && (!p.subject || !x.subject || x.subject === p.subject)) || null;
    },
    findOrCreatePassage: (p, authorId) => {
      if (!DB.passageKey(p.html)) return null;
      const hit = DB.findPassage(p);
      if (hit) return hit;
      return DB.addPassage({ title: String(p.title || '').replace(/[<>]/g, '').trim().slice(0, 120), subject: p.subject || '', html: p.html, authorId, source: p.source || '' });
    },
    /** Kelompokkan id soal agar soal dengan teks bacaan yang sama berurutan (posisi soal pertama dipertahankan). */
    groupByPassage: (ids) => {
      const out = [], placed = new Set();
      const pidOf = (id) => { const q = findById(KEYS.questions, id); return q && q.passageId ? q.passageId : null; };
      (ids || []).forEach(id => {
        if (placed.has(id)) return;
        const pid = pidOf(id);
        if (!pid) { out.push(id); placed.add(id); return; }
        ids.forEach(other => { if (!placed.has(other) && pidOf(other) === pid) { out.push(other); placed.add(other); } });
      });
      return out;
    },

    /* ===== CBT (Computer Based Test) ===== */
    getCbts: () => getAll(KEYS.cbts),
    getCbt: (id) => findById(KEYS.cbts, id),
    /* Sebuah CBT bisa menargetkan beberapa kelas lewat courseIds; kelas
     * tunggal lama memakai courseId. Keduanya harus terbaca. */
    getCbtsByCourse: (cid) => getAll(KEYS.cbts).filter(c =>
      c.courseId === cid || (Array.isArray(c.courseIds) && c.courseIds.includes(cid))),
    addCbt: (c) => add(KEYS.cbts, Object.assign({ createdAt: Date.now(), questionIds: [] }, c)),
    updateCbt: (id, p) => update(KEYS.cbts, id, p),
    deleteCbt: (id) => {
      // Putaran remedial ikut terhapus bersama ujian induknya.
      const ids = new Set([id].concat(getAll(KEYS.cbts).filter(c => c.remedialOf === id).map(c => c.id)));
      setAll(KEYS.cbtAttempts, getAll(KEYS.cbtAttempts).filter(a => !ids.has(a.cbtId)));
      const contribs = getAll(KEYS.cbtContribs);
      if (contribs.some(x => ids.has(x.cbtId))) setAll(KEYS.cbtContribs, contribs.filter(x => !ids.has(x.cbtId)));
      setAll(KEYS.cbts, getAll(KEYS.cbts).filter(c => !ids.has(c.id)));
    },

    /* ===== CBT Tryout =====
     * Admin membuat tryout untuk semua mentee (kind 'tryout', status draft → published).
     * Tutor menyetor soal per subtest lewat lms_cbt_contribs (pending → accepted/rejected);
     * hanya admin yang menulis record tryout. Server menyembunyikan draf dari mentee & orang tua. */
    isTryout: (c) => !!c && c.kind === 'tryout',
    tryoutOpenForStudents: (c, now) => !!c && c.status === 'published' && (Number(c.publishAt) || 0) <= (now || Date.now()),
    getTryouts: () => getAll(KEYS.cbts).filter(c => c.kind === 'tryout'),
    /** Bagian tryout apa adanya (termasuk yang belum berisi soal), urut UTBK. */
    tryoutSections: (c) => (Array.isArray(c && c.sections) ? c.sections : []).slice()
      .sort((a, b) => subtestOrder(a.subtest) - subtestOrder(b.subtest)),
    getCbtContribs: (cbtId) => getAll(KEYS.cbtContribs).filter(x => !cbtId || x.cbtId === cbtId),
    cbtContribId: (cbtId, qid) => 'cc_' + cbtId + '_' + qid,
    /** Subtest tempat tutor boleh menyetor: subtest yang diampu + subtest kelas yang diajar (kosong = semua). */
    tutorTryoutSubtests: (user) => {
      if (!user || user.role === 'admin') return DB.SUBTEST_NAMES.slice();
      const out = new Set(DB.userSubjects(findById(KEYS.users, user.id) || user).filter(n => DB.SUBTEST_NAMES.includes(n)));
      DB.getCoursesByTeacher(user.id).forEach(c => { if (c.subtest && DB.SUBTEST_NAMES.includes(c.subtest)) out.add(c.subtest); });
      return out.size ? DB.SUBTEST_NAMES.filter(n => out.has(n)) : DB.SUBTEST_NAMES.slice();
    },
    addCbtContribs: (cbtId, subtest, qids, user) => {
      const list = getAll(KEYS.cbtContribs);
      const have = new Set(list.map(x => x.id));
      const now = Date.now();
      const added = [];
      (qids || []).forEach((qid, i) => {
        const id = DB.cbtContribId(cbtId, qid);
        if (have.has(id)) return;
        const rec = { id, cbtId, subtest, questionId: qid, by: user.id, at: now + i, status: 'pending' };
        list.push(rec); added.push(rec); have.add(id);
      });
      if (added.length) setAll(KEYS.cbtContribs, list);
      return added;
    },
    reviewCbtContrib: (id, status, reviewer, note) => update(KEYS.cbtContribs, id, {
      status, reviewedBy: reviewer ? reviewer.id : null, reviewedAt: Date.now(), note: String(note || '').slice(0, 300)
    }),
    deleteCbtContrib: (id) => remove(KEYS.cbtContribs, id),
    /** Apakah sebuah CBT ditujukan untuk siswa ini?
     * Cocok bila: targetClasses memuat ALL_CLASSES, memuat kelas (tingkat)
     * siswa, atau siswa terdaftar di salah satu kelas mata pelajaran tujuan.
     */
    cbtTargetsStudent: (cbt, student) => {
      if (!cbt || !student) return false;
      // Remedial hanya untuk peserta yang dipilih (bukan per kelas).
      if (cbt.remedialOf) return Array.isArray(cbt.targetStudentIds) && cbt.targetStudentIds.includes(student.id);
      const tc = Array.isArray(cbt.targetClasses) ? cbt.targetClasses : [];
      if (tc.includes(ALL_CLASSES)) return true;
      if (student.kelas && tc.includes(student.kelas)) return true;
      const cids = Array.isArray(cbt.courseIds) && cbt.courseIds.length
        ? cbt.courseIds
        : (cbt.courseId ? [cbt.courseId] : []);
      if (cids.length) {
        const enrolled = getAll(KEYS.enrollments).filter(e => e.studentId === student.id).map(e => e.courseId);
        if (cids.some(id => enrolled.includes(id))) return true;
      }
      // Tanpa target apa pun -> tidak ditampilkan agar tidak bocor ke semua siswa
      return false;
    },
    /** Semua ujian yang boleh dikerjakan seorang siswa. */
    getCbtsForStudent: (studentId) => {
      const student = findById(KEYS.users, studentId);
      if (!student) return [];
      const tried = new Set(getAll(KEYS.cbtAttempts).filter(a => a.studentId === studentId).map(a => a.cbtId));
      // Ujian nonaktif tidak tampil & tidak dapat dikerjakan; hasil yang sudah ada tetap terlihat.
      const staged = DB.studentStagedBatch(studentId);
      return getAll(KEYS.cbts).filter(c => DB.cbtTargetsStudent(c, student)).filter(c => {
        if (tried.has(c.id)) return true;
        // Tryout: draf tidak pernah tampil; yang terbit terjadwal baru tampil sejak publishAt.
        if (DB.isTryout(c) && !DB.tryoutOpenForStudents(c)) return false;
        if (c.active === false) return false;
        if (c.remedialOf && DB.getSettings().remedialEnabled === false) return false;
        if (staged && !DB.contentOpenForBatch(c, staged)) return false;
        const course = c.courseId ? findById(KEYS.courses, c.courseId) : null;
        return !course || !DB.isEnrolled(course.id, studentId) || DB.contentVisibleToStudent(c, course, studentId);
      });
    },
    /** Daftar kelas (tingkat) tujuan dalam bentuk teks siap tampil. */
    cbtTargetLabel: (cbt) => {
      if (cbt.remedialOf) return `${(cbt.targetStudentIds || []).length} peserta remedial`;
      if (DB.isTryout(cbt)) return 'Semua mentee (Tryout)';
      const tc = Array.isArray(cbt.targetClasses) ? cbt.targetClasses : [];
      if (tc.includes(ALL_CLASSES)) return 'Semua Kelas';
      if (tc.length === 0) return '-';
      return tc.join(', ');
    },
    /** Total soal sebuah CBT, dihitung dari sections bila tersedia. */
    cbtQuestionIds: (cbt) => {
      if (Array.isArray(cbt.sections) && cbt.sections.length) {
        return cbt.sections.flatMap(s => s.questionIds || []);
      }
      return cbt.questionIds || [];
    },
    /** Sections ternormalisasi & terurut sesuai urutan resmi UTBK. */
    cbtSections: (cbt) => {
      if (Array.isArray(cbt.sections) && cbt.sections.length) {
        return cbt.sections
          .filter(s => (s.questionIds || []).length > 0)
          .slice()
          .sort((a, b) => subtestOrder(a.subtest) - subtestOrder(b.subtest));
      }
      // CBT lama tanpa sections -> perlakukan sebagai satu bagian
      const qids = cbt.questionIds || [];
      if (!qids.length) return [];
      const first = findById(KEYS.questions, qids[0]);
      return [{
        subtest: (first && first.subject) || 'Umum',
        questionIds: qids,
        durationMinutes: cbt.durationMinutes || 30
      }];
    },

    getCbtAttempts: () => getAll(KEYS.cbtAttempts),
    getCbtAttemptsByCbt: (cid) => getAll(KEYS.cbtAttempts).filter(a => a.cbtId === cid),
    getCbtAttemptByStudent: (cid, sid) => getAll(KEYS.cbtAttempts).find(a => a.cbtId === cid && a.studentId === sid) || null,
    getCbtAttemptsByStudent: (sid) => getAll(KEYS.cbtAttempts).filter(a => a.studentId === sid),
    addCbtAttempt: (a) => add(KEYS.cbtAttempts, Object.assign({ startedAt: Date.now(), violations: [] }, a)),
    updateCbtAttempt: (id, p) => update(KEYS.cbtAttempts, id, p),
    /** Catat pelanggaran/aktivitas mencurigakan selama ujian berlangsung. */
    addCbtViolation: (attemptId, violation) => {
      const att = findById(KEYS.cbtAttempts, attemptId);
      if (!att) return null;
      const list = Array.isArray(att.violations) ? att.violations.slice() : [];
      list.push(Object.assign({ at: Date.now() }, violation));
      return update(KEYS.cbtAttempts, attemptId, { violations: list });
    },
    /** Ringkasan pelanggaran seluruh peserta sebuah ujian (untuk pemantauan). */
    getCbtViolationSummary: (cbtId) => {
      return getAll(KEYS.cbtAttempts)
        .filter(a => a.cbtId === cbtId)
        .map(a => ({
          attemptId: a.id,
          studentId: a.studentId,
          count: (a.violations || []).length,
          violations: a.violations || [],
          submitted: !!a.submittedAt
        }));
    },

    /* ===== Analitik nyata untuk halaman AI =====
     * Semua angka di halaman AI HARUS berasal dari data asli di bawah ini,
     * bukan angka karangan. Dipakai bersama panel siswa, tutor, admin, dan
     * orang tua agar nilainya konsisten di semua tempat.
     */

    /**
     * Rata-rata skor per subtest milik seorang siswa, dihitung dari
     * sectionScores tiap attempt (dengan cadangan ke subtest kelas bila
     * attempt lama belum punya sectionScores).
     * @returns {Array<{subtest,short,icon,avg,correct,total,attempts}>}
     */
    studentSubtestStats: (studentId) => {
      const attempts = getAll(KEYS.cbtAttempts).filter(a => a.studentId === studentId && a.submittedAt);
      const by = {};
      const bump = (key, correct, total, score) => {
        if (!key) return;
        if (!by[key]) by[key] = { correct: 0, total: 0, scores: [] };
        by[key].correct += Number(correct) || 0;
        by[key].total += Number(total) || 0;
        if (score != null) by[key].scores.push(Number(score));
      };
      attempts.forEach(a => {
        const secs = a.sectionScores || [];
        if (secs.length) {
          secs.forEach(s => bump(s.subtest || 'Lainnya', s.correct, s.total, s.score));
        } else {
          const cbt = findById(KEYS.cbts, a.cbtId);
          const c = cbt ? findById(KEYS.courses, cbt.courseId) : null;
          bump((c && c.subtest) || 'Lainnya', a.correctCount, a.totalCount, a.score);
        }
      });
      return Object.keys(by).map(name => {
        const st = DB.subtestByName(name);
        const d = by[name];
        const avg = d.scores.length
          ? Math.round(d.scores.reduce((x, y) => x + y, 0) / d.scores.length)
          : (d.total ? Math.round((d.correct / d.total) * 100) : null);
        return {
          subtest: name,
          short: st ? st.short : name,
          icon: st ? st.icon : '📘',
          avg, correct: d.correct, total: d.total, attempts: d.scores.length
        };
      }).sort((a, b) => (a.avg == null ? 999 : a.avg) - (b.avg == null ? 999 : b.avg));
    },

    /**
     * Sinyal integritas ujian yang BENAR-BENAR tercatat (bukan dugaan acak):
     * pelanggaran yang terekam, pengerjaan sangat cepat, dan skor sempurna
     * dengan waktu tidak wajar. Hanya attempt yang sudah dikumpulkan.
     */
    cbtIntegritySignals: (opts) => {
      const o = opts || {};
      let attempts = getAll(KEYS.cbtAttempts).filter(a => a.submittedAt);
      if (o.studentId) attempts = attempts.filter(a => a.studentId === o.studentId);
      if (o.cbtId) attempts = attempts.filter(a => a.cbtId === o.cbtId);
      if (o.courseIds && o.courseIds.length) {
        const set = new Set(o.courseIds);
        attempts = attempts.filter(a => {
          const cbt = findById(KEYS.cbts, a.cbtId);
          if (!cbt) return false;
          const ids = (cbt.courseIds && cbt.courseIds.length) ? cbt.courseIds : (cbt.courseId ? [cbt.courseId] : []);
          return ids.some(id => set.has(id));
        });
      }

      const out = [];
      attempts.forEach(a => {
        const cbt = findById(KEYS.cbts, a.cbtId);
        const student = findById(KEYS.users, a.studentId);
        if (!cbt || !student) return;
        const reasons = [];
        let weight = 0;

        const vio = a.violations || [];
        if (vio.length) {
          const kinds = {};
          vio.forEach(v => { const k = v.type || v.reason || 'lain'; kinds[k] = (kinds[k] || 0) + 1; });
          reasons.push('Pelanggaran tercatat: ' +
            Object.keys(kinds).map(k => `${k} (${kinds[k]}x)`).join(', '));
          weight += vio.length * 2;
        }

        // Durasi pengerjaan jauh lebih cepat dari alokasi waktu
        const durMin = (a.startedAt && a.submittedAt)
          ? Math.round((a.submittedAt - a.startedAt) / 60000) : null;
        const alloc = Number(cbt.durationMinutes) || 0;
        if (durMin != null && alloc > 0 && durMin < Math.max(2, alloc * 0.25)) {
          reasons.push(`Selesai sangat cepat (${durMin} dari ${alloc} menit)`);
          weight += 3;
        }
        // Skor sempurna dengan waktu sangat singkat
        if (a.score === 100 && durMin != null && alloc > 0 && durMin < alloc * 0.4) {
          reasons.push('Skor sempurna dengan waktu tidak wajar');
          weight += 2;
        }

        if (!reasons.length) return;
        out.push({
          attemptId: a.id,
          student, exam: cbt,
          score: a.score, durationMinutes: durMin,
          violations: vio.length,
          reasons, weight,
          severity: weight >= 6 ? 'Tinggi' : (weight >= 3 ? 'Sedang' : 'Rendah')
        });
      });
      return out.sort((x, y) => y.weight - x.weight);
    },

    /* ===== Whiteboard per kelas =====
     * Satu rekaman lms_whiteboards = satu papan (biasanya satu per materi/pertemuan):
     * { id, courseId, title, topic, planId, createdBy, createdAt, strokes, board, pages, pageData,
     *   media:[{key,bytes,at}], thumb, revision, updatedAt, updatedBy }.
     * Rekaman lama (satu papan per kelas, tanpa judul) tetap terbaca sebagai "Papan Kelas". */
    WB_MEDIA_LIMIT: 8 * 1024 * 1024,
    getWhiteboards: () => getAll(KEYS.whiteboards),
    getCourseBoards: (courseId) => getAll(KEYS.whiteboards).filter(w => w.courseId === courseId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    getWhiteboardBoard: (id) => (id ? findById(KEYS.whiteboards, id) : null),
    boardTitle: (b) => (b && String(b.title || '').trim()) || 'Papan Kelas',
    /** Total ukuran PDF/gambar papan satu kelas (dibatasi agar database tidak membengkak). */
    whiteboardMediaBytes: (courseId) => DB.getCourseBoards(courseId)
      .reduce((n, b) => n + (b.media || []).reduce((m, x) => m + (Number(x.bytes) || 0), 0), 0),
    createWhiteboardBoard: (courseId, meta, actor) => {
      const course = findById(KEYS.courses, courseId);
      if (!course || !DB.canEditWhiteboard(actor, course)) throw new Error('Hanya admin/tutor kelas yang dapat membuat papan.');
      const m = meta || {};
      const title = String(m.title || '').replace(/[<>]/g, '').trim().slice(0, 100);
      if (!title) throw new Error('Judul papan wajib diisi.');
      return add(KEYS.whiteboards, {
        id: uid('wb'), courseId, title, topic: String(m.topic || '').replace(/[<>]/g, '').trim().slice(0, 120),
        planId: m.planId || null, createdBy: actor.id, createdAt: Date.now(), schemaVersion: 2,
        strokes: [], board: m.board || undefined, media: [], revision: 0, updatedAt: 0
      });
    },
    updateWhiteboardMeta: (id, patch, actor) => {
      const rec = findById(KEYS.whiteboards, id);
      if (!rec || !DB.canEditWhiteboard(actor, findById(KEYS.courses, rec.courseId))) throw new Error('Anda tidak berhak mengubah papan ini.');
      const p = {};
      if (patch.title != null) { p.title = String(patch.title).replace(/[<>]/g, '').trim().slice(0, 100); if (!p.title) throw new Error('Judul papan wajib diisi.'); }
      if (patch.topic != null) p.topic = String(patch.topic).replace(/[<>]/g, '').trim().slice(0, 120);
      if (patch.planId !== undefined) p.planId = patch.planId || null;
      return update(KEYS.whiteboards, id, p);
    },
    /** Hapus papan beserta simpanan versinya dan berkas PDF/gambarnya. */
    deleteWhiteboardBoard: (id, actor) => {
      const rec = findById(KEYS.whiteboards, id);
      if (!rec) return;
      if (!DB.canEditWhiteboard(actor, findById(KEYS.courses, rec.courseId))) throw new Error('Anda tidak berhak menghapus papan ini.');
      save('lms_whiteboard_boards', load('lms_whiteboard_boards', []).filter(x => x.boardId !== id));
      remove(KEYS.whiteboards, id);
      if (global.BlobStore) BlobStore.removePrefix(`wb:${rec.courseId}:${id}:`).catch(() => {});
    },
    saveWhiteboard: (boardId, state, actor) => {
      const list = getAll(KEYS.whiteboards);
      const i = list.findIndex(w => w.id === boardId);
      const prev = i >= 0 ? list[i] : null;
      const course = prev && findById(KEYS.courses, prev.courseId);
      if (!prev) throw new Error('Papan tidak ditemukan. Mungkin sudah dihapus.');
      if (!course || !DB.canEditWhiteboard(actor, course)) throw new Error('Aktor tidak berhak mengubah whiteboard kelas ini.');
      const rec = Object.assign({}, prev, state || {}, {
        id: prev.id, courseId: prev.courseId, title: prev.title, topic: prev.topic, planId: prev.planId,
        createdBy: prev.createdBy || (actor && actor.id) || null, createdAt: prev.createdAt || Date.now(),
        revision: Math.max(Number(prev.revision) || 0, Number(state && state.revision) || 0) + 1,
        updatedAt: Date.now(), updatedBy: actor && actor.id ? actor.id : null
      });
      list[i] = rec;
      save(KEYS.whiteboards, list);
      return rec;
    },
    /* Riwayat versi & papan tersimpan per papan.
     * { id, courseId, boardId, type:'version'|'board', name, auto, createdAt, createdBy,
     *   objects:[...], board:{w,h,bg,template} }
     * Batas: 15 versi + 20 simpanan per papan agar localStorage tidak penuh.
     * Simpanan lama tanpa boardId tampil di semua papan kelas itu. */
    getWhiteboardSaves: (courseId, type, boardId) => load('lms_whiteboard_boards', [])
      .filter(x => x.courseId === courseId && (!type || x.type === type) && (!boardId || !x.boardId || x.boardId === boardId))
      .sort((a, b) => b.createdAt - a.createdAt),
    addWhiteboardSave: (courseId, entry, actor) => {
      const course = findById(KEYS.courses, courseId);
      if (!course || !DB.canEditWhiteboard(actor, course)) throw new Error('Hanya admin/tutor kelas yang dapat menyimpan papan.');
      const type = entry.type === 'board' ? 'board' : 'version';
      const name = String(entry.name || '').trim().slice(0, 80) || (type === 'board' ? 'Papan tanpa judul' : 'Versi otomatis');
      const boardId = entry.boardId || null;
      const rec = {
        id: uid('wbs'), courseId, boardId, type, name, auto: !!entry.auto,
        createdAt: Date.now(), createdBy: actor.id,
        objects: JSON.parse(JSON.stringify(entry.objects || [])),
        board: Object.assign({}, entry.board || {})
      };
      let list = load('lms_whiteboard_boards', []);
      list.push(rec);
      const LIMIT = { version: 15, board: 20 };
      const mine = list.filter(x => x.courseId === courseId && x.type === type && (x.boardId || null) === boardId).sort((a, b) => b.createdAt - a.createdAt);
      if (mine.length > LIMIT[type]) {
        const drop = new Set(mine.slice(LIMIT[type]).map(x => x.id));
        list = list.filter(x => !drop.has(x.id));
      }
      save('lms_whiteboard_boards', list);
      return rec;
    },
    deleteWhiteboardSave: (id, actor) => {
      const list = load('lms_whiteboard_boards', []);
      const rec = list.find(x => x.id === id);
      if (!rec) return;
      if (!DB.canEditWhiteboard(actor, findById(KEYS.courses, rec.courseId))) throw new Error('Anda tidak berhak menghapus simpanan ini.');
      save('lms_whiteboard_boards', list.filter(x => x.id !== id));
    },
    canViewWhiteboard: (user, course, childId) => {
      if (!user || !course) return false;
      if (user.role === 'admin') return true;
      if (user.role === 'guru') return DB.courseTeacherIds(course).includes(user.id);
      if (user.role === 'siswa') return DB.isEnrolled(course.id, user.id);
      if (user.role === 'orangtua') {
        const ids = childId ? [childId] : (DB.getChildren(user.id) || []).map(c => c.id);
        return ids.some(id => DB.isEnrolled(course.id, id));
      }
      return false;
    },
    canEditWhiteboard: (user, course) => !!(user && course &&
      (user.role === 'admin' || (user.role === 'guru' && DB.courseTeacherIds(course).includes(user.id)))),

    /* ===== Attendance ===== */
    getAttendance: () => getAll(KEYS.attendance),
    getAttendanceByCourse: (cid) => getAll(KEYS.attendance).filter(a => a.courseId === cid),
    getAttendanceByUser: (uid) => getAll(KEYS.attendance).filter(a => a.userId === uid),
    getAttendanceByCourseDate: (cid, date) => getAll(KEYS.attendance).filter(a => a.courseId === cid && a.date === date),
    /**
     * Catatan presensi satu orang pada satu pertemuan. Kelas dengan beberapa sesi
     * di hari yang sama dibedakan lewat `planId`; catatan lama tanpa planId
     * dianggap milik sesi pertama hari itu.
     */
    getAttendanceRecord: (cid, uid, date, planId) => {
      const list = getAll(KEYS.attendance).filter(a => a.courseId === cid && a.userId === uid && a.date === date);
      if (!planId) return list.find(a => !a.planId) || list[0] || null;
      const exact = list.find(a => a.planId === planId);
      if (exact) return exact;
      const first = DB.getPlansForCourseDate(cid, date).filter(p => p.status !== 'cancelled')[0];
      return (!first || first.id === planId) ? (list.find(a => !a.planId) || null) : null;
    },
    /** Semua catatan presensi satu pertemuan (sesi tertentu bila planId diisi). */
    getSessionAttendance: (cid, date, planId) => getAll(KEYS.attendance).filter(a => a.courseId === cid && a.date === date)
      .filter(a => {
        if (!planId || a.planId === planId) return true;
        if (a.planId) return false;
        const first = DB.getPlansForCourseDate(cid, date).filter(p => p.status !== 'cancelled')[0];
        return !first || first.id === planId;
      }),
    /**
     * Isi/ubah presensi. opts: { planId, actor } — actor dicatat sebagai pengisi
     * (markedBy) dan wajib berhak (DB.canTakeAttendance) bila bukan admin.
     */
    upsertAttendance: (cid, uid, role, date, status, note, opts) => {
      const o = opts || {};
      // Validasi: hanya status resmi yang boleh disimpan.
      if (!ATT_KEYS.includes(status)) throw new Error('Status presensi tidak dikenal: ' + status);
      if (o.actor && !DB.canTakeAttendance(o.actor, findById(KEYS.courses, cid), date, o.planId)) {
        throw new Error('Presensi pertemuan ini hanya dapat diisi tutor yang mengajar sesi tersebut atau admin.');
      }
      const stamp = { markedBy: o.actor ? o.actor.id : null, markedAt: Date.now() };
      const existing = DB.getAttendanceRecord(cid, uid, date, o.planId);
      if (existing) {
        // Status berubah → notifikasi Alfa boleh dikirim lagi untuk status baru.
        if (existing.status !== status) stamp.notifiedAt = null;
        return update(KEYS.attendance, existing.id, Object.assign({ role, status, note: note || '', planId: o.planId || existing.planId || null }, stamp));
      }
      return add(KEYS.attendance, Object.assign({ courseId: cid, userId: uid, role, date, planId: o.planId || null, status, note: note || '', createdAt: Date.now() }, stamp));
    },
    /** Kosongkan presensi satu orang (salah isi). Mengembalikan catatan yang dihapus. */
    clearAttendance: (cid, uid, date, opts) => {
      const o = opts || {};
      if (o.actor && !DB.canTakeAttendance(o.actor, findById(KEYS.courses, cid), date, o.planId)) {
        throw new Error('Presensi pertemuan ini hanya dapat diubah tutor yang mengajar sesi tersebut atau admin.');
      }
      const rec = DB.getAttendanceRecord(cid, uid, date, o.planId);
      if (rec) remove(KEYS.attendance, rec.id);
      return rec;
    },
    /** Ubah satu catatan presensi (status/catatan) menurut id — dipakai Log Presensi admin. */
    updateAttendance: (id, patch, actor) => {
      const rec = findById(KEYS.attendance, id);
      if (!rec) return null;
      const status = patch.status || rec.status;
      if (!ATT_KEYS.includes(status)) throw new Error('Status presensi tidak dikenal: ' + status);
      if (actor && !DB.canTakeAttendance(actor, findById(KEYS.courses, rec.courseId), rec.date, rec.planId)) {
        throw new Error('Presensi pertemuan ini hanya dapat diubah tutor yang mengajar sesi tersebut atau admin.');
      }
      const next = { status, note: patch.note != null ? String(patch.note).slice(0, 500) : (rec.note || ''), markedBy: actor ? actor.id : null, markedAt: Date.now() };
      if (status !== rec.status) next.notifiedAt = null;
      return update(KEYS.attendance, id, next);
    },
    /** Tandai notifikasi Alfa sudah dikirim, agar "Selesai" yang diklik ulang tidak mengirim dua kali. */
    markAttendanceNotified: (id) => update(KEYS.attendance, id, { notifiedAt: Date.now() }),
    /** Pulihkan catatan presensi yang baru dihapus (tombol "Urungkan"). */
    restoreAttendance: (rec) => {
      if (!rec || !rec.id || findById(KEYS.attendance, rec.id)) return null;
      return add(KEYS.attendance, Object.assign({}, rec));
    },
    deleteAttendance: (id) => remove(KEYS.attendance, id),

    /* ===== Persentase kehadiran (rumus tunggal untuk semua panel) =====
     * Persentase = (hadir + terlambat) / total sesi terlaksana × 100%.
     * - Sesi pada tanggal yang rencana kelasnya DIBATALKAN tidak dihitung.
     * - Kebijakan izin/sakit diatur admin (attendanceExcusedPolicy):
     *     'count'   → tetap masuk penyebut (default, paling ketat)
     *     'exclude' → dikeluarkan dari penyebut
     */
    ATT_STATUSES, ATT_KEYS,
    attStatusMeta: (key) => ATT_STATUSES.find(s => s.key === key) || { key, label: key || '-', short: '?', ic: '•', present: false, excused: false },
    /** Tanggal dianggap batal bila ada rencana dan SEMUA sesinya hari itu dibatalkan. */
    isCancelledSession: (courseId, ymd) => {
      const list = getAll(KEYS.classPlans).filter(p => p.courseId === courseId && p.date === ymd);
      return list.length > 0 && list.every(p => p.status === 'cancelled');
    },
    /**
     * Ringkasan kehadiran dari kumpulan record presensi.
     * @param {Array} records record presensi (sudah difilter per user/kelas/periode)
     * @returns {{counts, total, sessions, present, cancelled, pct}}
     */
    attendanceSummary: (records) => {
      const settings = DB.getSettings();
      const excludeExcused = settings.attendanceExcusedPolicy === 'exclude';
      // Indeks sesi batal dibangun SEKALI, bukan dibaca ulang per record.
      // Satu tanggal bisa berisi beberapa sesi: batal hanya bila semua sesinya batal.
      const activeSet = new Set();
      const cancelledAll = new Set();
      getAll(KEYS.classPlans).forEach(p => {
        const k = p.courseId + '|' + p.date;
        if (p.status === 'cancelled') cancelledAll.add(k); else activeSet.add(k);
      });
      const cancelledSet = new Set([...cancelledAll].filter(k => !activeSet.has(k)));
      const counts = {};
      ATT_KEYS.forEach(k => { counts[k] = 0; });
      let cancelled = 0;
      let denominator = 0;
      let present = 0;
      (records || []).forEach(r => {
        if (cancelledSet.has(r.courseId + '|' + r.date)) { cancelled++; return; }
        counts[r.status] = (counts[r.status] || 0) + 1;
        const meta = DB.attStatusMeta(r.status);
        if (meta.present) present++;
        if (excludeExcused && meta.excused) return;
        denominator++;
      });
      const total = ATT_KEYS.reduce((n, k) => n + counts[k], 0);
      return {
        counts, total, sessions: denominator, present, cancelled,
        pct: denominator ? Math.round(present / denominator * 1000) / 10 : 0
      };
    },
    /** Agregasi bulanan: [{ month:'2026-09', ...summary }] urut naik. */
    attendanceByMonth: (records) => {
      const by = {};
      (records || []).forEach(r => {
        const m = String(r.date || '').slice(0, 7);
        if (!m) return;
        (by[m] = by[m] || []).push(r);
      });
      return Object.keys(by).sort().map(m => Object.assign({ month: m }, DB.attendanceSummary(by[m])));
    },
    /** Semester akademik: Jan–Jun = Genap, Jul–Des = Ganjil (tahun ajaran). */
    attendanceBySemester: (records) => {
      const by = {};
      (records || []).forEach(r => {
        const y = Number(String(r.date).slice(0, 4));
        const mo = Number(String(r.date).slice(5, 7));
        if (!y || !mo) return;
        const key = mo >= 7 ? `${y}/${y + 1} Ganjil` : `${y - 1}/${y} Genap`;
        (by[key] = by[key] || []).push(r);
      });
      return Object.keys(by).sort().map(k => Object.assign({ semester: k }, DB.attendanceSummary(by[k])));
    },
    /** Ambang batas kehadiran (persen) dari pengaturan admin. */
    attendanceThreshold: () => {
      const v = Number(DB.getSettings().attendanceThreshold);
      return v >= 0 && v <= 100 ? v : 75;
    },

    /* ===== Status pendidikan & batas ketidakhadiran =====
     * Batas dihitung dari catatan presensi berstatus terhitung (bawaan: Alfa) per bulan
     * atau sepanjang program; sesi yang dibatalkan tidak dihitung. */
    eduStatusMeta: (key) => EDU_STATUSES.find(s => s.key === key) || null,
    eduStatusLabel: (key) => { const m = DB.eduStatusMeta(key); return m ? m.label : 'Belum diisi'; },
    /** Teks bebas (kolom Excel) → kunci status pendidikan; '' bila tidak dikenali. */
    parseEduStatus: (v) => {
      const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const t = flat(v);
      if (!t) return '';
      const hit = EDU_STATUSES.find(s => s.key === t.replace(/ /g, '_') || flat(s.label) === t || flat(s.short) === t);
      if (hit) return hit.key;
      if (/semi/.test(t) || /kuliah/.test(t)) return 'semi_gapyear';
      if (/gap/.test(t)) return /(kerja|work)/.test(t) && !/tidak/.test(t) ? 'gapyear_kerja' : 'gapyear';
      if (/(^| )(12|xii)( |$)/.test(t)) return 'sma12';
      return '';
    },
    /** Kebijakan yang sudah dirapikan: bawaan + pengaturan admin. */
    absencePolicy: () => {
      const raw = DB.getSettings().absencePolicy;
      const p = raw && typeof raw === 'object' ? raw : {};
      const lim = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.min(999, Math.floor(Number(v))));
      const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
      const limits = {};
      EDU_STATUSES.forEach(s => {
        limits[s.key] = s.exempt ? null : (has(p.limits, s.key) ? lim(p.limits[s.key]) : ABSENCE_DEFAULT.limits[s.key]);
      });
      const statuses = Array.isArray(p.statuses) ? p.statuses.filter(k => ['alfa', 'izin', 'sakit'].includes(k)) : ABSENCE_DEFAULT.statuses;
      return {
        period: p.period === 'program' ? 'program' : 'month',
        statuses: statuses.length ? statuses.slice() : ['alfa'],
        limits,
        unsetLimit: has(p, 'unsetLimit') ? lim(p.unsetLimit) : ABSENCE_DEFAULT.unsetLimit,
        fineAmount: Math.max(0, Math.min(100000000, Math.round(Number(p.fineAmount) || 0))),
        fineMode: p.fineMode === 'flat' ? 'flat' : 'per'
      };
    },
    /** Kunci periode: 'YYYY-MM' (bulanan) atau 'program'. */
    absencePeriodKey: (month) => (DB.absencePolicy().period === 'program' ? 'program'
      : (/^\d{4}-\d{2}$/.test(String(month || '')) ? month : ymdOf(new Date()).slice(0, 7))),
    absencePeriodLabel: (key) => {
      if (key === 'program') return 'sepanjang program';
      const [y, m] = String(key).split('-').map(Number);
      return y && m ? new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : String(key);
    },
    /**
     * Status batas ketidakhadiran semua mentee (atau `ids`) untuk satu periode.
     * Indeks presensi & sesi batal dibangun sekali agar ringan untuk ratusan mentee.
     */
    absenceReport: (month, ids) => {
      const pol = DB.absencePolicy();
      const key = DB.absencePeriodKey(month);
      const label = DB.absencePeriodLabel(key);
      const counted = new Set(pol.statuses);
      const active = new Set(), cancelledAll = new Set();
      getAll(KEYS.classPlans).forEach(p => (p.status === 'cancelled' ? cancelledAll : active).add(p.courseId + '|' + p.date));
      const byUser = new Map();
      getAll(KEYS.attendance).forEach(a => {
        if (!counted.has(a.status)) return;
        if (key !== 'program' && !String(a.date || '').startsWith(key)) return;
        const ck = a.courseId + '|' + a.date;
        if (cancelledAll.has(ck) && !active.has(ck)) return;
        if (!byUser.has(a.userId)) byUser.set(a.userId, []);
        byUser.get(a.userId).push(a);
      });
      const want = ids ? new Set(ids) : null;
      return getAll(KEYS.users).filter(u => u.role === 'siswa' && (!want || want.has(u.id))).map(s => {
        const meta = DB.eduStatusMeta(s.eduStatus);
        const exempt = !!(meta && meta.exempt);
        const limit = exempt ? null : (meta ? pol.limits[meta.key] : pol.unsetLimit);
        const records = (byUser.get(s.id) || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const count = records.length;
        const over = limit == null ? 0 : Math.max(0, count - limit);
        const fine = over > 0 && pol.fineAmount > 0 ? (pol.fineMode === 'flat' ? pol.fineAmount : pol.fineAmount * over) : 0;
        return {
          studentId: s.id, student: s, eduStatus: meta ? meta.key : '', eduLabel: meta ? meta.label : 'Belum diisi',
          exempt, limit, count, over, exceeded: over > 0, atLimit: limit != null && limit > 0 && count === limit,
          remaining: limit == null ? null : Math.max(0, limit - count), periodKey: key, periodLabel: label,
          statuses: pol.statuses, fine, records
        };
      });
    },
    absenceStatusFor: (student, month) => {
      const id = typeof student === 'string' ? student : student && student.id;
      return id ? (DB.absenceReport(month, [id])[0] || null) : null;
    },
    /** Kalimat singkat untuk satu status, mis. "Alfa 4× dari batas 3× (Oktober 2026)". */
    absenceText: (st) => {
      if (!st) return '';
      const what = st.statuses.map(k => DB.attStatusMeta(k).label).join('/');
      if (st.exempt) return `${st.eduLabel}: tanpa batas ketidakhadiran`;
      if (st.limit == null) return `${what} ${st.count}× (tanpa batas)`;
      return `${what} ${st.count}× dari batas ${st.limit}× (${st.periodLabel})`;
    },
    /** Aturan yang berlaku untuk satu status pendidikan, dalam satu kalimat. */
    absenceRuleText: (eduKey) => {
      const pol = DB.absencePolicy();
      const meta = DB.eduStatusMeta(eduKey);
      if (meta && meta.exempt) return 'Tanpa batas ketidakhadiran dan tanpa sanksi.';
      const limit = meta ? pol.limits[meta.key] : pol.unsetLimit;
      if (limit == null) return meta ? 'Belum ada batas ketidakhadiran untuk status ini.' : 'Status belum diisi: ketidakhadiran tidak dibatasi.';
      const what = pol.statuses.map(k => DB.attStatusMeta(k).label).join('/');
      return `Batas ${limit}× ${what} ${pol.period === 'program' ? 'sepanjang program' : 'per bulan'}` +
        (pol.fineAmount > 0 ? `; lewat batas dikenai denda ${Number(pol.fineAmount).toLocaleString('id-ID')} rupiah${pol.fineMode === 'per' ? ' per ketidakhadiran' : ''}.` : '.');
    },
    absenceFineId: (st) => 'fine_att_' + st.studentId + '_' + String(st.periodKey).replace(/[^0-9a-z]/gi, ''),
    /**
     * Buat/perbarui tagihan denda (lms_payments, jenis denda, status pending) untuk mentee
     * yang melebihi batas. Id tetap per mentee & periode sehingga tidak pernah dobel;
     * tagihan yang sudah lunas/dibatalkan tidak diubah.
     */
    issueAbsenceFine: (st) => {
      if (!st || !st.exceeded || !(st.fine > 0)) return { skipped: true };
      const id = DB.absenceFineId(st);
      const note = `${st.count}× tidak hadir, batas ${st.limit}× • ${st.periodLabel}`;
      const existing = findById(KEYS.payments, id);
      if (existing) {
        if (existing.status !== 'pending' || (Number(existing.amount) === st.fine && existing.note === note)) return { record: existing };
        return { record: update(KEYS.payments, id, { amount: st.fine, note }), changed: true };
      }
      const rec = add(KEYS.payments, {
        id, studentId: st.studentId, courseId: null, kind: 'denda', amount: st.fine, method: 'lainnya', status: 'pending',
        fineReason: 'Melebihi batas ketidakhadiran', note, paidAt: Date.now(), createdAt: Date.now(), source: 'absence', periodKey: st.periodKey
      });
      DB.notifyStudentAndParents(st.studentId, {
        type: 'keuangan', icon: '⚠️', title: 'Denda batas ketidakhadiran',
        body: `${note}. Denda ${Number(st.fine).toLocaleString('id-ID')} rupiah menunggu pembayaran.`, link: 'keuangan'
      }, { title: `Denda ketidakhadiran ${st.student ? st.student.name : 'anak Anda'}`, link: 'keuangan' });
      return { record: rec, created: true };
    },

    /* ===== Finance: Payments (pemasukan/SPP siswa) ===== */
    getPayments: () => getAll(KEYS.payments),
    getPayment: (id) => findById(KEYS.payments, id),
    /** Jenis pemasukan sebuah transaksi (data lama dianggap SPP). */
    paymentKind: (p) => (p && p.kind) || 'spp',
    paymentKindMeta: (kind) => PAYMENT_KINDS.find(k => k.key === ((kind) || 'spp')) || PAYMENT_KINDS[0],
    /** Semua denda; opsional difilter per siswa. */
    getFines: (studentId) => getAll(KEYS.payments).filter(p =>
      DB.paymentKind(p) === 'denda' && (!studentId || p.studentId === studentId)),
    /** Ringkasan pemasukan per jenis: { spp: {lunas, pending}, denda: {...} }. */
    incomeByKind: () => {
      const out = {};
      PAYMENT_KINDS.forEach(k => { out[k.key] = { lunas: 0, pending: 0, count: 0 }; });
      getAll(KEYS.payments).forEach(p => {
        const k = DB.paymentKind(p);
        if (!out[k]) out[k] = { lunas: 0, pending: 0, count: 0 };
        out[k].count++;
        if (p.status === 'lunas') out[k].lunas += Number(p.amount) || 0;
        else out[k].pending += Number(p.amount) || 0;
      });
      return out;
    },
    getPaymentsByStudent: (sid) => getAll(KEYS.payments).filter(p => p.studentId === sid),
    addPayment: (p) => add(KEYS.payments, Object.assign({ createdAt: Date.now() }, p)),
    updatePayment: (id, p) => update(KEYS.payments, id, p),
    deletePayment: (id) => remove(KEYS.payments, id),

    /* ===== Finance: Expenses (pengeluaran operasional) ===== */
    getExpenses: () => getAll(KEYS.expenses),
    addExpense: (e) => add(KEYS.expenses, Object.assign({ createdAt: Date.now() }, e)),
    updateExpense: (id, p) => update(KEYS.expenses, id, p),
    deleteExpense: (id) => remove(KEYS.expenses, id),

    /* ===== Finance: Salaries (gaji guru) ===== */
    getSalaries: () => getAll(KEYS.salaries),
    getSalariesByTeacher: (tid) => getAll(KEYS.salaries).filter(s => s.teacherId === tid),
    addSalary: (s) => add(KEYS.salaries, Object.assign({ createdAt: Date.now() }, s)),
    updateSalary: (id, p) => update(KEYS.salaries, id, p),
    deleteSalary: (id) => remove(KEYS.salaries, id),

    /* ===== Alias kompatibilitas: kelas utama ===== */
    getClassOptions: () => DB.getMainClasses(),
    setClassOptions: (list) => DB.setMainClasses(list),

    /* ===== Feedback (Kritik & Saran) =====
     * Tujuan: 'admin' (hanya admin), 'tutor' (hanya tutor penerima), 'umum' (semua pengguna).
     * Pengirim selalu melihat miliknya. Data lama: 'kelas' = umum, 'individu' tanpa akun penerima = admin.
     * Aturan yang sama ditegakkan server (api/_lib/rules.js → feedbackAudience). */
    FEEDBACK_TARGETS: { admin: 'Admin / Manajemen', tutor: 'Tutor', umum: 'Umum' },
    feedbackTarget: (fb) => {
      const t = fb && fb.target;
      if (t === 'tutor' && fb.recipientId) return 'tutor';
      if (t === 'umum' || t === 'kelas') return 'umum';
      return 'admin';
    },
    feedbackVisibleTo: (fb, user) => {
      if (!fb || !user) return false;
      if (fb.senderId && fb.senderId === user.id) return true;
      const t = DB.feedbackTarget(fb);
      if (t === 'umum') return true;
      if (t === 'tutor') return fb.recipientId === user.id;
      return user.role === 'admin';
    },
    /** Yang boleh membalas: tutor penerima, atau admin untuk masukan ke admin/umum. */
    canReplyFeedback: (fb, user) => {
      if (!fb || !user) return false;
      return DB.feedbackTarget(fb) === 'tutor' ? fb.recipientId === user.id : user.role === 'admin';
    },
    canDeleteFeedback: (fb, user) => !!(fb && user) && (user.role === 'admin' || (fb.senderId && fb.senderId === user.id) ||
      (DB.feedbackTarget(fb) === 'tutor' && fb.recipientId === user.id)),
    /** Masukan yang boleh dilihat `user` (tanpa argumen: semua data lokal). */
    getFeedbacks: (user) => {
      const all = load('lms_feedbacks', []);
      const list = Array.isArray(all) ? all.filter(f => f && f.id) : [];
      return user ? list.filter(f => DB.feedbackVisibleTo(f, user)) : list;
    },
    /** Tutor yang dapat dipilih sebagai penerima (akun aktif, bukan diri sendiri). */
    feedbackRecipients: (user) => getAll(KEYS.users)
      .filter(u => u.role === 'guru' && u.id !== (user && user.id) && u.status !== 'Dikeluarkan')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'id')),
    addFeedback: (user, input) => {
      if (!user) return { error: 'Sesi berakhir. Silakan masuk lagi.' };
      const message = String((input && input.message) || '').trim();
      if (message.length < 3) return { error: 'Pesan minimal 3 karakter.' };
      if (message.length > 2000) return { error: 'Pesan maksimal 2.000 karakter.' };
      const target = Object.prototype.hasOwnProperty.call(DB.FEEDBACK_TARGETS, input.target) ? input.target : 'admin';
      const rec = { id: uid('fb'), senderId: user.id, target, message, anonymous: !!input.anonymous, createdAt: Date.now() };
      if (target === 'tutor') {
        const r = DB.feedbackRecipients(user).find(u => u.id === input.recipientId);
        if (!r) return { error: 'Pilih tutor penerima dari daftar akun.' };
        rec.recipientId = r.id;
      }
      const list = DB.getFeedbacks();
      list.push(rec);
      save('lms_feedbacks', list);
      const who = rec.anonymous ? 'Pengirim anonim' : (user.name || 'Pengguna');
      const payload = { type: 'feedback', icon: '💬', title: 'Kritik & saran baru', body: who + ': ' + message.slice(0, 120), link: 'feedback' };
      if (target === 'tutor') DB.notifyUsers([rec.recipientId], payload);
      else if (target === 'admin') DB.notifyUsers(getAll(KEYS.users).filter(u => u.role === 'admin' && u.id !== user.id).map(u => u.id), payload);
      return { record: rec };
    },
    /** Balas (atau hapus balasan bila teks kosong). */
    replyFeedback: (user, id, text) => {
      const list = DB.getFeedbacks();
      const fb = list.find(f => f.id === id);
      if (!fb || !DB.canReplyFeedback(fb, user)) return { error: 'Anda tidak dapat membalas masukan ini.' };
      const t = String(text || '').trim();
      if (t.length > 2000) return { error: 'Balasan maksimal 2.000 karakter.' };
      if (t) fb.reply = { text: t, by: user.id, at: Date.now() };
      else delete fb.reply;
      save('lms_feedbacks', list);
      if (t && fb.senderId && fb.senderId !== user.id) {
        DB.addNotification({ userId: fb.senderId, type: 'feedback', icon: '💬', title: 'Kritik & saran Anda dibalas', body: t.slice(0, 120), link: 'feedback' });
      }
      return { record: fb };
    },
    deleteFeedback: (user, id) => {
      const list = DB.getFeedbacks();
      const fb = list.find(f => f.id === id);
      if (!fb || !DB.canDeleteFeedback(fb, user)) return false;
      save('lms_feedbacks', list.filter(f => f.id !== id));
      return true;
    },

    /* ===== Announcements (Pengumuman) ===== */
    getAnnouncements: () => {
      try { return JSON.parse(localStorage.getItem('lms_announcements') || '[]'); } catch(e) { return []; }
    },
    getAnnouncement: (id) => {
      return (JSON.parse(localStorage.getItem('lms_announcements') || '[]')).find(a => a.id === id) || null;
    },
    addAnnouncement: (a) => {
      const list = JSON.parse(localStorage.getItem('lms_announcements') || '[]');
      if (!a.id) a.id = uid('ann');
      a.createdAt = Date.now();
      list.push(a);
      localStorage.setItem('lms_announcements', JSON.stringify(list));
      return a;
    },
    updateAnnouncement: (id, patch) => {
      const list = JSON.parse(localStorage.getItem('lms_announcements') || '[]');
      const idx = list.findIndex(a => a.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      localStorage.setItem('lms_announcements', JSON.stringify(list));
      return list[idx];
    },
    deleteAnnouncement: (id) => {
      const list = JSON.parse(localStorage.getItem('lms_announcements') || '[]').filter(a => a.id !== id);
      localStorage.setItem('lms_announcements', JSON.stringify(list));
    },

    /* ===== Berita publik (halaman depan & berita.html; dikelola admin) =====
     * status: 'draft' | 'published'. Terbit dengan publishAt di masa depan = terjadwal. */
    NEWS_CATEGORIES: ['Pengumuman', 'Info UTBK & SNBT', 'Prestasi', 'Kegiatan', 'Tips Belajar', 'Beasiswa'],
    getNews: () => load('lms_news', []),
    getNewsItem: (idOrSlug) => load('lms_news', []).find(n => n.id === idOrSlug || n.slug === idOrSlug) || null,
    newsState: (n, at) => (!n || n.status !== 'published' ? 'draft' : (Number(n.publishAt) > (at || Date.now()) ? 'scheduled' : 'published')),
    /** Berita terbit, terbaru dulu; berita utama (pinned) di atas. */
    getPublishedNews: () => load('lms_news', []).filter(n => DB.newsState(n) === 'published')
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.publishAt - a.publishAt),
    newsSlug: (title, exceptId) => {
      const base = String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'berita';
      const taken = new Set(load('lms_news', []).filter(n => n.id !== exceptId).map(n => n.slug));
      let slug = base, i = 2;
      while (taken.has(slug)) slug = `${base}-${i++}`.slice(0, 100);
      return slug;
    },
    /** Simpan berita (admin). content harus sudah disanitasi (RichText.sanitize). */
    saveNews: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Berita hanya dapat dikelola admin.');
      const title = String(rec.title || '').replace(/\s+/g, ' ').trim();
      if (title.length < 3 || title.length > 160) throw new Error('Judul berita 3–160 karakter.');
      const content = String(rec.content || '');
      if (content.length > 2400000) throw new Error('Isi berita terlalu besar. Kurangi atau perkecil gambar di dalam isi.');
      const img = (v, max) => (!v ? '' : (typeof v === 'string' && v.length <= max && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : null));
      const cover = img(rec.cover, 450000), thumb = img(rec.thumb, 90000);
      if (cover === null || thumb === null) throw new Error('Gambar sampul tidak valid atau terlalu besar. Unggah ulang gambarnya.');
      const plain = content.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (rec.status === 'published' && plain.length < 20) throw new Error('Isi berita terlalu pendek untuk diterbitkan.');
      const list = load('lms_news', []);
      const i = rec.id ? list.findIndex(n => n.id === rec.id) : -1;
      const id = i >= 0 ? list[i].id : (rec.id || uid('news'));
      let slug = String(rec.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').slice(0, 100).replace(/^-+|-+$/g, '');
      if (!slug || list.some(n => n.id !== id && n.slug === slug)) slug = DB.newsSlug(slug || title, id);
      const now = Date.now();
      const status = rec.status === 'published' ? 'published' : 'draft';
      const words = plain ? plain.split(' ').length : 0;
      const clean = {
        id, title, slug, status, content,
        excerpt: (String(rec.excerpt || '').replace(/\s+/g, ' ').trim() || (plain.length > 220 ? plain.slice(0, 217).replace(/\s+\S*$/, '') + '…' : plain)).slice(0, 320),
        category: String(rec.category || '').replace(/[<>]/g, '').trim().slice(0, 40),
        cover, thumb, coverAlt: String(rec.coverAlt || '').replace(/[<>]/g, '').trim().slice(0, 160),
        pinned: !!rec.pinned,
        publishAt: status === 'published' ? (Number(rec.publishAt) || now) : (Number(rec.publishAt) || 0),
        readMin: Math.max(1, Math.round(words / 200)),
        authorId: i >= 0 ? (list[i].authorId || actor.id) : actor.id,
        authorName: String(i >= 0 ? (list[i].authorName || actor.name || 'Admin') : (actor.name || 'Admin')).slice(0, 80),
        createdAt: i >= 0 ? (list[i].createdAt || now) : now,
        updatedAt: now, updatedBy: actor.id
      };
      if (clean.pinned) list.forEach(n => { if (n.id !== id && n.pinned) n.pinned = false; });   // satu berita utama
      if (i >= 0) list[i] = clean; else list.push(clean);
      save('lms_news', list);
      DB.logActivity('news.save', `${status === 'published' ? 'Menerbitkan' : 'Menyimpan draf'} berita "${title}"`, id);
      return clean;
    },
    deleteNews: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Berita hanya dapat dikelola admin.');
      const n = DB.getNewsItem(id);
      save('lms_news', load('lms_news', []).filter(x => x.id !== id));
      if (n) DB.logActivity('news.delete', `Menghapus berita "${n.title}"`, id);
    },

    /* ===== Academic Batches (Tahun Akademik) ===== */
    getBatches: () => {
      try { return JSON.parse(localStorage.getItem('lms_batches') || '[]'); } catch(e) { return []; }
    },
    getBatch: (id) => {
      return (JSON.parse(localStorage.getItem('lms_batches') || '[]')).find(b => b.id === id) || null;
    },
    addBatch: (b) => {
      const list = JSON.parse(localStorage.getItem('lms_batches') || '[]');
      if (!b.id) b.id = uid('batch');
      b.createdAt = Date.now();
      list.push(b);
      localStorage.setItem('lms_batches', JSON.stringify(list));
      batchMemo = { sid: null, at: 0, batch: null };
      return b;
    },
    updateBatch: (id, patch) => {
      const list = JSON.parse(localStorage.getItem('lms_batches') || '[]');
      const idx = list.findIndex(b => b.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      localStorage.setItem('lms_batches', JSON.stringify(list));
      batchMemo = { sid: null, at: 0, batch: null };
      return list[idx];
    },
    deleteBatch: (id) => {
      const list = JSON.parse(localStorage.getItem('lms_batches') || '[]').filter(b => b.id !== id);
      localStorage.setItem('lms_batches', JSON.stringify(list));
      batchMemo = { sid: null, at: 0, batch: null };
    },

    /* ===== Rilis konten per angkatan =====
     * Angkatan (batch) dengan releaseMode 'staged': konten yang dibuat SEBELUM
     * tanggal batas angkatan (archiveBefore, bawaan tanggal mulai) dianggap
     * arsip angkatan lama dan TIDAK langsung terlihat oleh mentee angkatan ini.
     * Admin/tutor merilisnya satu per satu atau sekaligus (bisa terjadwal):
     *   rec.releases[batchId] = { at: waktuBuka, by: userId }
     * Konten yang dibuat setelah tanggal batas langsung terlihat seperti biasa.
     * Angkatan lama tanpa releaseMode tidak terpengaruh (semua konten terlihat). */
    isStagedBatch: (b) => !!(b && b.releaseMode === 'staged'),
    batchCutoff: (b) => {
      const ymd = String((b && (b.archiveBefore || b.startDate)) || '');
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : 0;
    },
    /** Angkatan yang masih berjalan (belum berakhir), urut terbaru. */
    activeBatches: () => {
      const today = ymdOf(new Date());
      return DB.getBatches().filter(b => !b.endDate || b.endDate >= today)
        .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
    },
    /** Angkatan bertahap milik seorang mentee (null bila tidak ada). */
    studentStagedBatch: (studentId) => {
      const now = Date.now();
      if (batchMemo.sid === studentId && now - batchMemo.at < 1500) return batchMemo.batch;
      const st = findById(KEYS.users, studentId);
      const b = st && st.role === 'siswa' && st.batchId ? DB.getBatch(st.batchId) : null;
      batchMemo = { sid: studentId, at: now, batch: DB.isStagedBatch(b) ? b : null };
      return batchMemo.batch;
    },
    /**
     * Status konten bagi sebuah angkatan:
     *  open      → angkatan tidak bertahap (selalu terlihat)
     *  new       → dibuat setelah tanggal batas angkatan
     *  released  → dirilis untuk angkatan ini
     *  scheduled → dirilis terjadwal, belum waktunya
     *  archive   → arsip angkatan lama, belum dirilis
     */
    contentBatchState: (rec, batch, nowTs) => {
      if (!rec || !DB.isStagedBatch(batch)) return 'open';
      const born = Number(rec.createdAt) || Number(rec.recordedAt) || 0;
      if (born >= DB.batchCutoff(batch)) return 'new';
      const rel = rec.releases && rec.releases[batch.id];
      if (rel && Number(rel.at)) return Number(rel.at) <= (nowTs || Date.now()) ? 'released' : 'scheduled';
      return 'archive';
    },
    contentOpenForBatch: (rec, batch) => ['open', 'new', 'released'].includes(DB.contentBatchState(rec, batch)),
    /** Kelas (subtest) yang tercakup sebuah konten. */
    contentCourseIds: (kind, rec) => {
      if (!rec) return [];
      if (kind === 'cbt') return [...new Set([rec.courseId].concat(rec.courseIds || []).filter(Boolean))];
      return rec.courseId ? [rec.courseId] : [];
    },
    /** Admin, pembuat, atau tutor salah satu kelas konten tersebut boleh merilis. */
    canReleaseContent: (actor, kind, rec) => {
      if (!actor || !rec) return false;
      if (actor.role === 'admin') return true;
      if (actor.role !== 'guru') return false;
      if (rec.createdBy === actor.id) return true;
      return DB.contentCourseIds(kind, rec).some(cid => DB.courseTeacherIds(findById(KEYS.courses, cid)).includes(actor.id));
    },
    /**
     * Rilis konten arsip untuk sebuah angkatan.
     * @param {Array<{kind,id}>} items
     * @param {string} batchId
     * @param {number} [at]  waktu buka (bawaan sekarang); di masa depan = terjadwal
     */
    releaseContent: (items, batchId, at, actor) => {
      const batch = DB.getBatch(batchId);
      if (!batch) throw new Error('Angkatan tidak ditemukan.');
      const when = Number(at) > 0 ? Number(at) : Date.now();
      const now = Date.now();
      const report = { released: 0, scheduled: 0, skipped: [] };
      const opened = [];
      (items || []).forEach(it => {
        const key = DB.CONTENT_STORE[it.kind];
        const rec = key && it.kind !== 'course' ? findById(key, it.id) : null;
        if (!rec) { report.skipped.push({ id: it.id, reason: 'tidak ditemukan' }); return; }
        if (!DB.canReleaseContent(actor, it.kind, rec)) { report.skipped.push({ id: it.id, title: rec.title, reason: 'bukan kelas Anda' }); return; }
        const releases = Object.assign({}, rec.releases || {}, { [batchId]: { at: when, by: actor.id, setAt: now } });
        update(key, it.id, { releases });
        if (when <= now) { report.released++; opened.push({ kind: it.kind, rec }); } else report.scheduled++;
      });
      // Satu notifikasi ringkas per mentee angkatan ini untuk konten yang langsung dibuka.
      if (opened.length) {
        const students = getAll(KEYS.users).filter(u => u.role === 'siswa' && u.batchId === batchId && (u.status || 'Aktif') === 'Aktif');
        const enr = getAll(KEYS.enrollments);
        students.forEach(stu => {
          const mine = new Set(enr.filter(e => e.studentId === stu.id).map(e => e.courseId));
          const got = opened.filter(o => o.rec.active !== false && (o.kind === 'cbt'
            ? DB.cbtTargetsStudent(o.rec, stu) : DB.contentCourseIds(o.kind, o.rec).some(cid => mine.has(cid))));
          if (!got.length) return;
          DB.addNotification({ userId: stu.id, type: 'konten', icon: '🔓', link: 'my-courses',
            title: got.length === 1 ? `${CONTENT_KINDS[got[0].kind].label} baru dibuka` : `${got.length} konten baru dibuka`,
            body: got.slice(0, 3).map(o => o.rec.title || CONTENT_KINDS[o.kind].label).join(', ') + (got.length > 3 ? `, dan ${got.length - 3} lainnya` : '') });
        });
      }
      DB.logActivity('content.release', `Merilis ${report.released + report.scheduled} konten untuk angkatan "${batch.name}"`, batchId);
      return report;
    },
    /** Tarik kembali rilis (konten arsip disembunyikan lagi untuk angkatan ini). */
    unreleaseContent: (items, batchId, actor) => {
      let n = 0;
      (items || []).forEach(it => {
        const key = DB.CONTENT_STORE[it.kind];
        const rec = key && it.kind !== 'course' ? findById(key, it.id) : null;
        if (!rec || !rec.releases || !rec.releases[batchId] || !DB.canReleaseContent(actor, it.kind, rec)) return;
        const releases = Object.assign({}, rec.releases);
        delete releases[batchId];
        update(key, it.id, { releases });
        n++;
      });
      DB.logActivity('content.unrelease', `Menarik rilis ${n} konten`, batchId);
      return n;
    },

    /* ===== Transfer konten: salin / pindahkan ke kelas lain =====
     * Salinan mendapat id & tanggal dibuat baru (langsung terlihat oleh kelas
     * tujuan), pengumpulan/hasil ujian TIDAK ikut tersalin. Memindahkan tugas
     * yang sudah dikumpulkan atau ujian yang sudah dikerjakan ditolak agar
     * nilai mentee tidak tercampur — gunakan salin. */
    transferContent: (o, actor) => {
      const opt = o || {};
      if (!actor || (actor.role !== 'admin' && actor.role !== 'guru')) throw new Error('Hanya admin/tutor yang dapat mentransfer konten.');
      const mode = opt.mode === 'move' ? 'move' : 'copy';
      const targets = [...new Set(opt.targetCourseIds || [])].map(id => findById(KEYS.courses, id)).filter(Boolean);
      if (!targets.length) throw new Error('Pilih minimal satu kelas tujuan.');
      if (mode === 'move' && targets.length !== 1) throw new Error('Memindahkan hanya ke satu kelas tujuan.');
      if (actor.role === 'guru') {
        const bad = targets.find(t => !DB.courseTeacherIds(t).includes(actor.id));
        if (bad) throw new Error(`Anda bukan tutor kelas tujuan "${DB.courseTitle(bad)}".`);
      }
      const now = Date.now();
      const report = { copied: 0, moved: 0, skipped: [], created: [], shifted: 0 };
      const ownerFor = (rec, target) => {
        if (actor.role === 'guru') return actor.id;
        const tutors = DB.courseTeacherIds(target);
        if (opt.owner && opt.owner !== 'keep' && opt.owner !== 'target') return opt.owner;
        if (opt.owner === 'target') return tutors[0] || ADMIN_OWNER;
        const cur = rec.createdBy;
        if (cur === ADMIN_OWNER) return cur;
        if (cur && tutors.includes(cur) && findById(KEYS.users, cur)) return cur;
        return tutors[0] || ADMIN_OWNER;
      };
      const notify = new Map();          // courseId → judul konten yang dibuka untuk mentee
      (opt.items || []).forEach(it => {
        const key = DB.CONTENT_STORE[it.kind];
        const rec = key && it.kind !== 'course' ? findById(key, it.id) : null;
        if (!rec) { report.skipped.push({ title: it.id, reason: 'tidak ditemukan' }); return; }
        const title = rec.title || CONTENT_KINDS[it.kind].label;
        const srcCourse = rec.courseId ? findById(KEYS.courses, rec.courseId) : null;
        const allowed = actor.role === 'admin' || DB.canManageContent(actor, rec, srcCourse) || DB.canReleaseContent(actor, it.kind, rec);
        if (!allowed) { report.skipped.push({ title, reason: 'Anda tidak berhak mengelola konten ini' }); return; }
        if (mode === 'move') {
          const t = targets[0];
          if (DB.contentCourseIds(it.kind, rec).includes(t.id) && it.kind !== 'cbt') { report.skipped.push({ title, reason: 'sudah berada di kelas tujuan' }); return; }
          if (it.kind === 'assignment' && getAll(KEYS.submissions).some(x => x.assignmentId === rec.id)) { report.skipped.push({ title, reason: 'sudah ada pengumpulan mentee — gunakan Salin' }); return; }
          if (it.kind === 'cbt' && getAll(KEYS.cbtAttempts).some(x => x.cbtId === rec.id)) { report.skipped.push({ title, reason: 'sudah dikerjakan mentee — gunakan Salin' }); return; }
          const patch = { courseId: t.id, createdBy: ownerFor(rec, t), movedFrom: { courseId: rec.courseId || null, at: now, by: actor.id }, updatedAt: now, updatedBy: actor.id };
          if (it.kind === 'cbt') {
            const srcIds = DB.contentCourseIds('cbt', rec).filter(id => id !== rec.courseId);
            patch.courseIds = [...new Set([t.id].concat(srcIds))];
          }
          update(key, rec.id, patch);
          report.moved++;
          report.created.push({ kind: it.kind, id: rec.id, courseId: t.id });
          return;
        }
        targets.forEach(t => {
          const copy = JSON.parse(JSON.stringify(rec));
          ['id', 'releases', 'reactivatedAt', 'activeChangedAt', 'activeChangedBy', 'updatedBy', 'movedFrom', 'ownerChangedAt', 'ownerChangedBy', 'ownerChangedFrom'].forEach(k => delete copy[k]);
          Object.assign(copy, {
            courseId: t.id, createdAt: now, updatedAt: now, createdBy: ownerFor(rec, t), enteredBy: actor.id,
            copiedFrom: { id: rec.id, courseId: rec.courseId || null, at: now, by: actor.id },
            active: opt.inactive ? false : rec.active !== false
          });
          if (it.kind === 'recording' && !copy.recordedAt) copy.recordedAt = now;
          if (it.kind === 'assignment') {
            const due = Number(opt.dueAt) || 0;
            if (due) copy.dueDate = due;
            else if (!(Number(rec.dueDate) > now)) { copy.dueDate = now + 7 * 86400000; report.shifted++; }
          }
          if (it.kind === 'cbt') {
            copy.courseIds = [t.id];
            copy.targetClasses = (rec.targetClasses || []).includes(ALL_CLASSES) ? [ALL_CLASSES] : [];
            const dur = Number(rec.endAt) && Number(rec.startAt) ? Number(rec.endAt) - Number(rec.startAt) : 0;
            const start = Number(opt.startAt) || 0;
            if (start) { copy.startAt = start; if (dur > 0) copy.endAt = start + dur; }
            else if (Number(rec.endAt) && Number(rec.endAt) < now) {
              const d = new Date(Number(rec.startAt) || now);
              const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(d.getHours(), d.getMinutes(), 0, 0);
              copy.startAt = next.getTime(); copy.endAt = next.getTime() + (dur > 0 ? dur : 2 * 3600000);
              report.shifted++;
            }
          }
          const saved = add(key, copy);
          report.copied++;
          report.created.push({ kind: it.kind, id: saved.id, courseId: t.id });
          if (saved.active !== false && (it.kind === 'assignment' || it.kind === 'cbt' || it.kind === 'material' || it.kind === 'module')) {
            if (!notify.has(t.id)) notify.set(t.id, []);
            notify.get(t.id).push(saved.title || CONTENT_KINDS[it.kind].label);
          }
        });
      });
      notify.forEach((titles, cid) => {
        const c = findById(KEYS.courses, cid);
        DB.notifyUsers(getAll(KEYS.enrollments).filter(e => e.courseId === cid).map(e => e.studentId), {
          type: 'konten', icon: '📥', link: 'my-courses',
          title: titles.length === 1 ? 'Konten baru di kelasmu' : `${titles.length} konten baru di kelasmu`,
          body: `${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ', …' : ''} — ${c ? DB.courseTitle(c) : ''}` });
      });
      DB.logActivity('content.transfer', `${mode === 'move' ? 'Memindahkan' : 'Menyalin'} ${report.copied + report.moved} konten ke ${targets.map(t => DB.courseTitle(t)).join(', ')}`, targets.map(t => t.id).join(','));
      return report;
    },

    /* ===== Riwayat chat AI =====
     * { id, userId, kind:'tutor'|'assistant'|'cbt', ref, title,
     *   messages:[{ role:'user'|'model', text, at, via }], createdAt, updatedAt }
     * Disinkronkan antar-perangkat, hanya dapat dibaca pemiliknya. Setiap pesan
     * disimpan 7 hari; utas tanpa pesan tersisa ikut terhapus (juga di server). */
    AI_CHAT_TTL_MS: AI_CHAT_TTL,
    /** Utas milik pengguna (opsional difilter jenis/ref), terbaru lebih dulu. */
    getAiChats: (userId, kind, ref) => {
      DB.pruneAiChats(userId);
      return load(AI_CHAT_KEY, []).filter(t => t && t.userId === userId && (!kind || t.kind === kind) && (ref == null || t.ref === ref))
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    },
    getAiChat: (id) => load(AI_CHAT_KEY, []).find(t => t && t.id === id) || null,
    /** Simpan (buat/perbarui) satu utas; pesan & teks dipangkas agar ringan. */
    saveAiChat: (thread) => {
      if (!thread || !thread.userId) return null;
      const now = Date.now();
      const msgs = (thread.messages || []).filter(m => m && (m.role === 'user' || m.role === 'model') && m.text)
        .map(m => ({ role: m.role, text: String(m.text).slice(0, AI_CHAT_MAX_TEXT), at: Number(m.at) || now, via: m.via ? String(m.via).slice(0, 120) : undefined }))
        .filter(m => now - m.at < AI_CHAT_TTL)
        .slice(-AI_CHAT_MAX_MSG);
      const rec = {
        id: thread.id || uid('aic'), userId: thread.userId, kind: thread.kind || 'assistant',
        ref: thread.ref == null ? null : String(thread.ref).slice(0, 200),
        title: String(thread.title || (msgs[0] && msgs[0].text) || 'Percakapan').replace(/\s+/g, ' ').trim().slice(0, 80),
        messages: msgs, createdAt: Number(thread.createdAt) || now,
        updatedAt: msgs.length ? Math.max.apply(null, msgs.map(m => m.at)) : now
      };
      const list = load(AI_CHAT_KEY, []);
      const i = list.findIndex(t => t && t.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      save(AI_CHAT_KEY, list);
      return rec;
    },
    deleteAiChat: (id, userId) => {
      const list = load(AI_CHAT_KEY, []);
      const next = list.filter(t => !(t && t.id === id && (!userId || t.userId === userId)));
      if (next.length !== list.length) save(AI_CHAT_KEY, next);
    },
    /** Hapus pesan > 7 hari; utas kosong ikut terhapus. Hanya utas milik userId. */
    pruneAiChats: (userId) => {
      const now = Date.now();
      const list = load(AI_CHAT_KEY, []);
      let changed = false;
      const next = [];
      list.forEach(t => {
        if (!t || (userId && t.userId !== userId)) { if (t) next.push(t); return; }
        const msgs = (t.messages || []).filter(m => m && now - (Number(m.at) || 0) < AI_CHAT_TTL);
        if (!msgs.length) { changed = true; return; }
        if (msgs.length !== (t.messages || []).length) {
          changed = true;
          next.push(Object.assign({}, t, { messages: msgs, updatedAt: Math.max.apply(null, msgs.map(m => Number(m.at) || 0)) }));
        } else next.push(t);
      });
      if (changed) save(AI_CHAT_KEY, next);
      return changed;
    },

    /* ===== Calendar Events ===== */
    getEvents: () => {
      try { return JSON.parse(localStorage.getItem('lms_events') || '[]'); } catch(e) { return []; }
    },
    getEvent: (id) => {
      return (JSON.parse(localStorage.getItem('lms_events') || '[]')).find(e => e.id === id) || null;
    },
    addEvent: (ev) => {
      const list = JSON.parse(localStorage.getItem('lms_events') || '[]');
      if (!ev.id) ev.id = uid('ev');
      ev.createdAt = Date.now();
      list.push(ev);
      localStorage.setItem('lms_events', JSON.stringify(list));
      return ev;
    },
    updateEvent: (id, patch) => {
      const list = JSON.parse(localStorage.getItem('lms_events') || '[]');
      const idx = list.findIndex(e => e.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      localStorage.setItem('lms_events', JSON.stringify(list));
      return list[idx];
    },
    deleteEvent: (id) => {
      const list = JSON.parse(localStorage.getItem('lms_events') || '[]').filter(e => e.id !== id);
      localStorage.setItem('lms_events', JSON.stringify(list));
    },

    /* ===== Chat Messages ===== */
    getMessages: () => {
      try { return JSON.parse(localStorage.getItem('lms_messages') || '[]'); } catch(e) { return []; }
    },
    getConversation: (userId1, userId2) => {
      const msgs = JSON.parse(localStorage.getItem('lms_messages') || '[]');
      return msgs.filter(m =>
        (m.senderId === userId1 && m.receiverId === userId2) ||
        (m.senderId === userId2 && m.receiverId === userId1)
      ).sort((a, b) => a.createdAt - b.createdAt);
    },
    getConversationPartners: (userId) => {
      const msgs = JSON.parse(localStorage.getItem('lms_messages') || '[]');
      const partners = new Set();
      msgs.forEach(m => {
        if (m.senderId === userId) partners.add(m.receiverId);
        if (m.receiverId === userId) partners.add(m.senderId);
      });
      return [...partners];
    },
    getMessage: (id) => DB.getMessages().find(m => m.id === id) || null,
    /**
     * Kirim pesan. opts: { replyTo: pesanAsal, forwardedFrom: namaPengirimAsli }.
     * Balasan menyimpan replyToId + cuplikan (dipakai bila pesan asal tidak lagi tersedia).
     */
    addMessage: (msg, opts) => {
      const o = opts || {};
      const text = String(msg.text == null ? '' : msg.text).slice(0, 2000);
      if (!text.trim()) return null;
      const rec = { id: msg.id || uid('msg'), senderId: msg.senderId, receiverId: msg.receiverId, text, createdAt: Date.now() };
      if (o.replyTo && o.replyTo.id) {
        rec.replyToId = o.replyTo.id;
        rec.replyTo = { senderId: o.replyTo.senderId || '', text: o.replyTo.deleted ? '' : String(o.replyTo.text || '').slice(0, 200) };
      }
      if (o.forwardedFrom != null) {
        rec.forwarded = true;
        rec.forwardedFrom = String(o.forwardedFrom || '').replace(/[<>]/g, '').slice(0, 80).trim();
      }
      const list = DB.getMessages();
      list.push(rec);
      localStorage.setItem('lms_messages', JSON.stringify(list));
      return rec;
    },
    /** Hapus pesan milik sendiri (hapus lunak: isi dikosongkan, penanda tetap ada). */
    deleteMessage: (id, byUserId) => {
      const list = DB.getMessages();
      const m = list.find(x => x.id === id);
      if (!m || m.senderId !== byUserId || m.deleted) return false;
      ['replyToId', 'replyTo', 'forwarded', 'forwardedFrom'].forEach(f => { delete m[f]; });
      m.text = '';
      m.deleted = true;
      m.deletedAt = Date.now();
      localStorage.setItem('lms_messages', JSON.stringify(list));
      return true;
    },

    /* ===== Riwayat aktivitas (audit ringan, maks. 1000 entri terbaru) =====
     * Pelaku diambil dari sesi aktif; aksi sistem (seed/migrasi) tidak dicatat. */
    logActivity: (action, detail, targetId) => {
      let actor = null;
      try { actor = JSON.parse(localStorage.getItem('lms_session') || 'null'); } catch (e) { actor = null; }
      if (!actor || !actor.id) return null;
      const list = load('lms_activity_log', []);
      const rec = {
        id: uid('act'), at: Date.now(), actorId: actor.id, actorName: actor.name || actor.username || '',
        actorRole: actor.role || '', action: String(action || ''), detail: String(detail || '').slice(0, 300),
        targetId: targetId || null
      };
      list.push(rec);
      save('lms_activity_log', list.slice(-1000));
      return rec;
    },
    getActivityLog: () => load('lms_activity_log', []).slice().sort((a, b) => b.at - a.at),

    /* ===== Notifications (pusat notifikasi lintas peran) ===== */
    // showAt (opsional): notifikasi terjadwal baru tampil sejak waktu itu (mis. tryout yang terbit terjadwal).
    // tryoutId (opsional): notifikasi tryout untuk mentee hanya tampil selama tryout itu terbit untuknya.
    getNotifications: (userId) => {
      const now = Date.now();
      return getAll(KEYS.notifications)
        .filter(n => n.userId === userId && notifShown(n, now))
        .sort((a, b) => (Number(b.showAt) || b.createdAt) - (Number(a.showAt) || a.createdAt));
    },
    getUnreadCount: (userId) => {
      const now = Date.now();
      return getAll(KEYS.notifications).filter(n => n.userId === userId && !n.read && notifShown(n, now)).length;
    },
    addNotification: (n) => add(KEYS.notifications, Object.assign({ read: false, createdAt: Date.now() }, n)),
    /** Kirim satu notifikasi ke banyak user sekaligus. */
    notifyUsers: (userIds, payload) => {
      const ids = [...new Set((userIds || []).filter(Boolean))];
      ids.forEach(uid2 => add(KEYS.notifications, Object.assign({
        read: false, createdAt: Date.now()
      }, payload, { userId: uid2 })));
      return ids.length;
    },
    /** Notifikasi ke seorang siswa DAN semua orang tuanya (tetap tersinkron). */
    notifyStudentAndParents: (studentId, payload, parentPayload) => {
      const student = findById(KEYS.users, studentId);
      if (!student) return 0;
      DB.addNotification(Object.assign({}, payload, { userId: studentId }));
      const parents = DB.getParentsOfStudent(studentId);
      parents.forEach(p => DB.addNotification(Object.assign({},
        payload, parentPayload || {}, { userId: p.id })));
      return 1 + parents.length;
    },
    markNotificationRead: (id) => update(KEYS.notifications, id, { read: true }),
    markAllNotificationsRead: (userId) => {
      const now = Date.now();
      const list = getAll(KEYS.notifications).map(n => (n.userId === userId && notifShown(n, now) ? Object.assign({}, n, { read: true }) : n));
      setAll(KEYS.notifications, list);
    },
    // Notifikasi terjadwal yang belum tampil tidak ikut terhapus.
    clearNotifications: (userId) => {
      const now = Date.now();
      setAll(KEYS.notifications, getAll(KEYS.notifications).filter(n => n.userId !== userId || Number(n.showAt) > now));
    },

    /* =====================================================================
     * RONDE 8 — STREAK API, VISIBILITAS KONTEN, AYAT, READING TEXT,
     * COURSE MANDIRI, MESIN WAKTU (ciphertext saja), MUSIK LATAR
     * ===================================================================*/
    TZ_OFFSETS: { WIB: 7, WITA: 8, WIT: 9 },
    LEARNING_TYPES, RELIGIONS,
    /** YYYY-MM-DD menurut zona waktu tertentu (tidak bergantung zona perangkat). */
    ymdInTz: (ts, tz) => {
      const off = DB.TZ_OFFSETS[tz] != null ? DB.TZ_OFFSETS[tz] : 7;
      return new Date(Number(ts) + off * 3600000).toISOString().slice(0, 10);
    },
    hourInTz: (ts, tz) => {
      const off = DB.TZ_OFFSETS[tz] != null ? DB.TZ_OFFSETS[tz] : 7;
      return new Date(Number(ts) + off * 3600000).getUTCHours();
    },
    /** Zona waktu penghitungan streak seorang pengguna. */
    streakTzFor: (user) => {
      const st = DB.getSettings();
      if (st.streakTimezoneMode === 'user' && user && DB.TZ_OFFSETS[user.timezone] != null) return user.timezone;
      return DB.TZ_OFFSETS[st.lmsTimezone] != null ? st.lmsTimezone : 'WIB';
    },

    /* ---------- Pencatatan aktivitas belajar ---------- */
    getLearningLog: (userId) => load('lms_learning_log', []).filter(e => !userId || e.userId === userId),
    /**
     * Terbitkan token sesi aktivitas. Durasi minimum dihitung dari waktu ini.
     * opts.minSec dipakai Reading Text (menyesuaikan panjang teks).
     * opts.exactMinSec dipakai pelajaran Course Mandiri: waktu minimal diatur
     * admin per pelajaran (boleh 0 detik). Streak/XP tetap memakai batas
     * minimum jenis aktivitas (lihat recordLearning & hubCompleteLesson).
     */
    beginLearning: (userId, type, refId, opts) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') throw new Error('Aktivitas belajar hanya dicatat untuk akun mentee yang sedang masuk.');
      const def = LEARNING_TYPES[type];
      if (!def || def.derived || type === 'login') throw new Error('Jenis aktivitas tidak dikenal.');
      // Bersihkan token kedaluwarsa agar memori tidak tumbuh.
      const now = Date.now();
      learningTokens.forEach((t, k) => { if (now - t.startedAt > 3 * 3600000) learningTokens.delete(k); });
      const exact = opts && opts.exactMinSec != null && isFinite(Number(opts.exactMinSec))
        ? Math.max(0, Math.min(7200, Math.round(Number(opts.exactMinSec)))) : null;
      const tok = { id: uid('tok'), userId, type, refId: String(refId || '').slice(0, 80), startedAt: now,
        minSec: exact != null ? exact : Math.max(def.minSec || 0, Math.min(600, Number(opts && opts.minSec) || 0)) };
      learningTokens.set(tok.id, tok);
      return { token: tok.id, minSec: tok.minSec, startedAt: now };
    },
    /** Sisa detik sebelum token memenuhi durasi minimum (untuk UI). */
    learningTokenWait: (token) => {
      const t = learningTokens.get(token);
      if (!t) return null;
      return Math.max(0, Math.ceil(t.minSec - (Date.now() - t.startedAt) / 1000));
    },
    /**
     * Catat aktivitas yang sudah DISELESAIKAN. Semua kriteria divalidasi di sini
     * (lapisan data), bukan di tombol UI: token sesi, durasi minimum, jumlah soal
     * terjawab, duplikasi, batas harian, dan jeda minimum antar-catatan.
     */
    recordLearning: (userId, type, payload) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId) throw new Error('Aktivitas hanya dapat dicatat oleh pemilik akun.');
      const user = findById(KEYS.users, userId);
      if (!user || user.role !== 'siswa') throw new Error('Streak belajar hanya berlaku untuk mentee.');
      if (DB.getSettings().streakEnabled === false) throw new Error('Fitur streak sedang dinonaktifkan admin.');
      const def = LEARNING_TYPES[type];
      if (!def || def.derived) throw new Error('Jenis aktivitas tidak dapat dicatat manual.');
      const p = payload || {};
      const now = Date.now();
      let refId = '';
      const meta = {};
      if (type !== 'login') {
        const tok = learningTokens.get(p.token);
        if (!tok || tok.userId !== userId || tok.type !== type) throw new Error('Sesi aktivitas tidak sah. Mulai ulang aktivitas.');
        const sec = (now - tok.startedAt) / 1000;
        if (sec > 3 * 3600) { learningTokens.delete(p.token); throw new Error('Sesi aktivitas kedaluwarsa. Mulai ulang.'); }
        // Batas minimum jenis aktivitas tetap berlaku walau token dibuat dengan waktu lebih singkat.
        const needSec = Math.max(tok.minSec, def.minSec || 0);
        if (sec < needSec) throw new Error(`Aktivitas terlalu singkat. Tunggu ${Math.ceil(needSec - sec)} detik lagi.`);
        const answered = Math.max(0, Math.floor(Number(p.answered) || 0));
        const total = Math.max(0, Math.floor(Number(p.total) || 0));
        const correct = Math.max(0, Math.min(answered, Math.floor(Number(p.correct) || 0)));
        if (def.minAnswered && answered < def.minAnswered) throw new Error(`Jawab minimal ${def.minAnswered} soal.`);
        if ((type === 'miniquiz' || type === 'reading') && (total < 1 || answered < total)) throw new Error('Semua soal harus dijawab.');
        if (answered > total && total) throw new Error('Data jawaban tidak valid.');
        if (type === 'games') {
          const score = Math.floor(Number(p.score) || 0);
          if (score < def.minScore) throw new Error(`Skor minimal ${def.minScore} untuk menuntaskan ronde.`);
          meta.score = score;
        }
        refId = tok.refId || tok.id;
        Object.assign(meta, { answered, total, correct, durationSec: Math.round(sec) });
        if (type === 'tantangan' && Number.isInteger(Number(p.choice))) meta.choice = Number(p.choice);
        learningTokens.delete(p.token);
      }
      return appendLearning(user, type, refId, meta, now);
    },
    /** Status "sudah dibaca" materi kelas / pelajaran course (dari log sah). */
    learnedRefs: (userId, type) => new Set(DB.getLearningLog(userId).filter(e => e.type === type).map(e => e.refId)),
    /** Periksa rantai hash; catatan yang diubah/disisipkan ditandai tidak sah. */
    verifyLearningLog: (userId) => {
      const out = new Map();
      let prev = 'GENESIS';
      DB.getLearningLog(userId).forEach(e => {
        const ok = e.prev === prev && chainHash(e) === e.h;
        out.set(e.id, ok);
        prev = e.h;
      });
      return out;
    },
    /** Aktivitas turunan dari tabel resmi (tidak dapat dicatat dari klien). */
    derivedLearning: (userId) => {
      const user = findById(KEYS.users, userId);
      if (!user) return [];
      const tz = DB.streakTzFor(user);
      const out = [];
      getAll(KEYS.submissions).filter(s => s.studentId === userId && s.submittedAt).forEach(s => {
        out.push({ id: 'd_sub_' + s.id, userId, type: 'tugas', refId: s.assignmentId, at: s.submittedAt,
          day: DB.ymdInTz(s.submittedAt, tz), learning: true, derived: true });
      });
      getAll(KEYS.cbtAttempts).filter(a => a.studentId === userId && a.submittedAt).forEach(a => {
        out.push({ id: 'd_cbt_' + a.id, userId, type: 'tryout', refId: a.cbtId, at: a.submittedAt,
          day: DB.ymdInTz(a.submittedAt, tz), learning: true, derived: true });
      });
      getAll(KEYS.attendance).filter(a => a.userId === userId && a.role === 'siswa'
        && (a.status === 'hadir' || a.status === 'terlambat') && !DB.isCancelledSession(a.courseId, a.date)).forEach(a => {
        out.push({ id: 'd_att_' + a.id, userId, type: 'kelas', refId: a.courseId, at: Date.parse(a.date + 'T12:00:00Z'),
          day: a.date, learning: true, derived: true });
      });
      return out;
    },
    getStreakGrants: (userId) => load('lms_streak_grants', []).filter(g => !userId || g.userId === userId),
    /** Admin memberi stok Streak Freeze (tercatat & dapat diaudit). */
    grantStreakFreeze: (userId, count, reason, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat memberi Streak Freeze.');
      const u = findById(KEYS.users, userId);
      if (!u || u.role !== 'siswa') throw new Error('Mentee tidak ditemukan.');
      const n = Math.floor(Number(count) || 0);
      if (n < 1 || n > 5) throw new Error('Jumlah freeze 1–5.');
      const rec = { id: uid('grant'), userId, count: n, reason: String(reason || '').trim().slice(0, 160),
        at: Date.now(), day: DB.ymdInTz(Date.now(), DB.streakTzFor(u)), by: actor.id };
      const list = load('lms_streak_grants', []); list.push(rec); save('lms_streak_grants', list);
      DB.logActivity('streak.freeze', `Memberi ${n} Streak Freeze kepada "${u.name}"`, userId);
      return rec;
    },

    /* =====================================================================
     * Riwayat jawaban soal per mentee (Game Battle & Arena Belajar)
     * ---------------------------------------------------------------------
     * Satu record per mentee (lms_q_history, idField userId):
     *   items[ref] = [benar(1|0), jumlahDijawab, waktuTerakhir(detik)]
     *   cycles[cakupan] = jumlah putaran yang sudah diulang
     * ref = 'b:<id soal Bank Soal>' atau 'g:<id Soal Game>'.
     * Aturan: soal yang terakhir dijawab BENAR tidak ditampilkan lagi; soal yang
     * salah tetap muncul (diprioritaskan); bila semua soal suatu cakupan sudah
     * dikuasai, cakupan itu diulang dari awal (putaran baru).
     * ===================================================================*/
    qHistory: (userId) => {
      const rec = getAll(KEYS.qHistory).find(r => r.userId === userId);
      return rec ? { userId, items: Object.assign({}, rec.items || {}), cycles: Object.assign({}, rec.cycles || {}) }
        : { userId, items: {}, cycles: {} };
    },
    /** 'fresh' (belum pernah) | 'review' (terakhir salah) | 'mastered' (terakhir benar). */
    qhState: (hist, ref) => {
      const it = hist && hist.items ? hist.items[ref] : null;
      if (!Array.isArray(it)) return 'fresh';
      return it[0] === 1 ? 'mastered' : 'review';
    },
    qhStats: (userId, refs, scopeKey) => {
      const h = DB.qHistory(userId);
      const out = { total: 0, fresh: 0, review: 0, mastered: 0, cycle: (Number(h.cycles[scopeKey]) || 0) + 1 };
      [...new Set(refs || [])].forEach(r => { out.total++; out[DB.qhState(h, r)]++; });
      return out;
    },
    /** Ref yang masih boleh tampil (belum dikuasai). */
    qhEligible: (userId, refs) => {
      const h = DB.qHistory(userId);
      return (refs || []).filter(r => DB.qhState(h, r) !== 'mastered');
    },
    /** Putaran baru: tanda "dikuasai" pada ref cakupan ini dihapus. Mengembalikan nomor putaran baru. */
    qhReset: (userId, refs, scopeKey) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') return 1;
      const h = DB.qHistory(userId);
      (refs || []).forEach(r => { if (Array.isArray(h.items[r]) && h.items[r][0] === 1) delete h.items[r]; });
      const k = String(scopeKey || 'semua').slice(0, 120);
      h.cycles[k] = Math.min(9999, (Number(h.cycles[k]) || 0) + 1);
      DB._qhSave(h);
      return h.cycles[k] + 1;
    },
    /**
     * Urutkan ref untuk satu sesi: soal yang pernah salah (paling lama dulu) diselipkan
     * di antara soal baru. Soal yang sudah dikuasai tidak dipakai selama masih ada soal
     * lain; bila sisa soal kurang dari `need`, kekurangannya diisi soal dikuasai yang paling
     * lama dijawab. Bila semua sudah dikuasai, putaran baru dimulai dari semua soal.
     * @returns {{ refs: string[], reset: boolean, cycle: number }}
     */
    qhOrder: (userId, refs, need, scopeKey) => {
      const all = [...new Set(refs || [])];
      let h = DB.qHistory(userId);
      const shuffled = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
      let reset = false;
      let cycle = (Number(h.cycles[scopeKey]) || 0) + 1;
      if (all.length && all.every(r => DB.qhState(h, r) === 'mastered')) {
        cycle = DB.qhReset(userId, all, scopeKey);
        h = DB.qHistory(userId);
        reset = true;
      }
      const review = all.filter(r => DB.qhState(h, r) === 'review').sort((a, b) => (h.items[a][2] || 0) - (h.items[b][2] || 0));
      const fresh = shuffled(all.filter(r => DB.qhState(h, r) === 'fresh'));
      const short = Math.max(0, Math.min(need || 1, all.length) - review.length - fresh.length);
      const rest = short ? all.filter(r => DB.qhState(h, r) === 'mastered').sort((a, b) => (h.items[a][2] || 0) - (h.items[b][2] || 0)).slice(0, short) : [];
      // Selang-seling: hingga ±40% kursi awal diisi soal yang pernah salah, berganti dengan soal baru.
      const out = [];
      const slots = review.length ? Math.min(review.length, Math.max(1, Math.round((need || all.length) * 0.4))) : 0;
      let ri = 0, fi = 0;
      while (ri < review.length || fi < fresh.length) {
        if (ri < slots && (out.length % 2 === 0 || fi >= fresh.length)) out.push(review[ri++]);
        else if (fi < fresh.length) out.push(fresh[fi++]);
        else out.push(review[ri++]);
      }
      return { refs: out.concat(rest), reset, cycle };
    },
    /** Catat hasil satu sesi: [{ ref, ok }]. Hanya mentee yang sedang masuk, untuk dirinya sendiri. */
    qhRecord: (userId, results) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') return null;
      const list = (results || []).filter(x => x && typeof x.ref === 'string' && /^[bg]:/.test(x.ref) && x.ref.length <= 120);
      if (!list.length) return null;
      const h = DB.qHistory(userId);
      const at = Math.floor(Date.now() / 1000);
      list.forEach(x => {
        const prev = Array.isArray(h.items[x.ref]) ? h.items[x.ref] : [0, 0, 0];
        h.items[x.ref] = [x.ok ? 1 : 0, Math.min(99999, (Number(prev[1]) || 0) + 1), at];
      });
      DB._qhSave(h);
      return h;
    },
    _qhSave: (h) => {
      // Batas ukuran: soal paling lama yang sudah dikuasai dibuang lebih dulu.
      const keys = Object.keys(h.items);
      if (keys.length > QH_MAX) {
        keys.sort((a, b) => (h.items[b][0] - h.items[a][0]) || ((h.items[a][2] || 0) - (h.items[b][2] || 0)))
          .slice(0, keys.length - QH_MAX).forEach(k => { delete h.items[k]; });
      }
      const list = getAll(KEYS.qHistory).filter(r => r.userId !== h.userId);
      list.push({ id: h.userId, userId: h.userId, items: h.items, cycles: h.cycles, updatedAt: Date.now() });
      setAll(KEYS.qHistory, list);
    },

    /* =====================================================================
     * Pemakaian soal di ujian & tryout (keterangan "dipakai N×")
     * Remedial tidak dihitung (salinan ujian induk). opts.exclude: id CBT yang sedang disunting.
     * ===================================================================*/
    questionUsage: (opts) => {
      const ex = opts && opts.exclude;
      const map = new Map();
      getAll(KEYS.cbts).forEach(c => {
        if (c.remedialOf || c.id === ex) return;
        const ids = new Set(DB.cbtQuestionIds(c).concat(Array.isArray(c.sections) ? c.sections.flatMap(s => s.questionIds || []) : []));
        const tryout = c.kind === 'tryout';
        ids.forEach(id => {
          const u = map.get(id) || { n: 0, tryout: 0, exam: 0, last: 0, titles: [] };
          u.n++; if (tryout) u.tryout++; else u.exam++;
          u.last = Math.max(u.last, Number(c.startAt) || Number(c.createdAt) || 0);
          if (u.titles.length < 4) u.titles.push(String(c.title || '').slice(0, 60));
          map.set(id, u);
        });
      });
      return map;
    },

    /* =====================================================================
     * Profil kelemahan mentee (Mode Adaptif Arena)
     * Sumber utama: hasil tryout/ujian (sectionScores + jawaban per materi), bobot
     * terbaru lebih besar. Bila belum ada tryout, dipakai riwayat latihan & game.
     * ===================================================================*/
    studentWeakness: (studentId) => {
      const attempts = getAll(KEYS.cbtAttempts).filter(a => a.studentId === studentId && a.submittedAt)
        .sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 10);
      const sub = new Map(), top = new Map();
      const add = (m, key, base, c, t, w) => {
        const r = m.get(key) || Object.assign({ c: 0, t: 0, w: 0, n: 0 }, base);
        r.c += c * w; r.t += t * w; r.w += w; r.n++;
        m.set(key, r);
      };
      const grade = global.Exam && Exam.gradeQuestion;
      attempts.forEach((a, i) => {
        const w = 1 / (1 + i * 0.35);
        const cbt = findById(KEYS.cbts, a.cbtId);
        const secs = Array.isArray(a.sectionScores) ? a.sectionScores : [];
        secs.forEach(s => { if (s && s.subtest && Number(s.total) > 0) add(sub, s.subtest, { name: s.subtest }, Number(s.correct) || 0, Number(s.total), w); });
        if (!cbt || !grade) return;
        DB.cbtQuestionIds(cbt).forEach(qid => {
          const q = findById(KEYS.questions, qid);
          if (!q) return;
          const g = grade(q, (a.answers || {})[qid]);
          if (!g.auto) return;
          if (!secs.length) add(sub, q.subject, { name: q.subject }, g.correct ? 1 : 0, 1, w);
          if (q.topicId) add(top, q.topicId + '|' + (q.subtopicId || ''), { subtest: q.subject, topicId: q.topicId, subtopicId: q.subtopicId || null }, g.correct ? 1 : 0, 1, w);
        });
      });
      let source = attempts.length && sub.size ? 'tryout' : 'none';
      if (source === 'none') {
        // Cadangan: riwayat jawaban latihan & game dari Bank Soal.
        const h = DB.qHistory(studentId);
        Object.keys(h.items).forEach(ref => {
          if (ref.slice(0, 2) !== 'b:') return;
          const q = findById(KEYS.questions, ref.slice(2));
          if (!q || !q.subject) return;
          const ok = h.items[ref][0] === 1 ? 1 : 0;
          add(sub, q.subject, { name: q.subject }, ok, 1, 1);
          if (q.topicId) add(top, q.topicId + '|' + (q.subtopicId || ''), { subtest: q.subject, topicId: q.topicId, subtopicId: q.subtopicId || null }, ok, 1, 1);
        });
        if (sub.size) source = 'latihan';
      }
      const pct = (r) => (r.t ? Math.round(r.c / r.t * 1000) / 10 : null);
      const subtests = [...sub.values()].filter(r => DB.SUBTEST_NAMES.includes(r.name))
        .map(r => ({ name: r.name, pct: pct(r), samples: r.n, weight: Math.round(r.t * 10) / 10 }))
        .sort((a, b) => a.pct - b.pct || subtestOrder(a.name) - subtestOrder(b.name));
      const topics = [...top.values()].filter(r => r.t >= 1)
        .map(r => ({ subtest: r.subtest, topicId: r.topicId, subtopicId: r.subtopicId, pct: pct(r), samples: r.n }))
        .sort((a, b) => a.pct - b.pct);
      return { source, attempts: attempts.length, subtests, topics, weakest: subtests[0] || null };
    },

    /* =====================================================================
     * Kosakata: Kata Baku (kb) & Vocab Bahasa Inggris (en)
     * ---------------------------------------------------------------------
     * Kosakata bawaan ada di js/vocab-data.js; tambahan admin/tutor di
     * lms_vocab_items. Progres per mentee di lms_vocab_progress:
     *   decks[kb|en].items[id] = [status, hariJatuhTempo, ulangan, lupa, waktu(detik)]
     *   status 1 = lupa (ulang besok), 2 = ragu (ulang 2 hari lagi), 3 = ingat (selesai)
     *   decks[..].round = putaran; semua kosakata "ingat" → putaran baru dari awal.
     * ===================================================================*/
    VOCAB_GRADES: { lupa: { st: 1, days: 1, label: 'Lupa', hint: 'ulang besok' }, ragu: { st: 2, days: 2, label: 'Ragu', hint: 'ulang 2 hari lagi' }, ingat: { st: 3, days: 0, label: 'Ingat', hint: 'tidak diulang sampai semua selesai' } },
    vocabDayIndex: (ts, user) => {
      const ymd = DB.ymdInTz(ts == null ? Date.now() : ts, DB.streakTzFor(user || sessionActor() || {}));
      return Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86400000);
    },
    getVocabItems: (kind) => getAll(KEYS.vocabItems).filter(v => !kind || v.kind === kind),
    saveVocabItem: (item, actor) => {
      if (!actor || (actor.role !== 'admin' && actor.role !== 'guru')) throw new Error('Hanya admin/tutor yang dapat mengelola kosakata.');
      const clean = (v, n) => String(v == null ? '' : v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
      const list = (v, n, each) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/)).map(x => clean(x, each)).filter(Boolean).slice(0, n);
      const kind = item.kind === 'en' ? 'en' : 'kb';
      const out = { id: item.id || uid('voc'), kind, active: item.active !== false, tag: clean(item.tag, 40), updatedAt: Date.now(), updatedBy: actor.id };
      if (kind === 'kb') {
        Object.assign(out, { baku: clean(item.baku, 60), salah: list(item.salah, 4, 60), contoh: clean(item.contoh, 300), ket: clean(item.ket, 240) });
        if (out.baku.length < 2 || !out.salah.length) throw new Error('Isi kata baku dan minimal satu bentuk tidak baku.');
        if (out.salah.some(s => s.toLowerCase() === out.baku.toLowerCase())) throw new Error('Bentuk tidak baku tidak boleh sama dengan kata baku.');
      } else {
        Object.assign(out, { word: clean(item.word, 60), pos: clean(item.pos, 20), arti: clean(item.arti, 140), def: clean(item.def, 200),
          contoh: clean(item.contoh, 300), contohId: clean(item.contohId, 300), sin: list(item.sin, 5, 40) });
        if (out.word.length < 2 || out.arti.length < 2 || out.contoh.length < 5) throw new Error('Isi kata, arti, dan contoh kalimat.');
      }
      if (out.contoh.length < 5) throw new Error('Contoh kalimat minimal 5 karakter.');
      const all = getAll(KEYS.vocabItems);
      const i = all.findIndex(v => v.id === out.id);
      if (i >= 0) { out.createdAt = all[i].createdAt; out.createdBy = all[i].createdBy; all[i] = out; }
      else { out.createdAt = Date.now(); out.createdBy = actor.id; all.push(out); }
      setAll(KEYS.vocabItems, all);
      return out;
    },
    deleteVocabItem: (id, actor) => {
      if (!actor || (actor.role !== 'admin' && actor.role !== 'guru')) throw new Error('Hanya admin/tutor yang dapat mengelola kosakata.');
      remove(KEYS.vocabItems, id);
    },
    vocabProgress: (userId) => {
      const rec = getAll(KEYS.vocabProgress).find(r => r.userId === userId);
      const deck = (d) => ({ items: Object.assign({}, (d && d.items) || {}), round: Math.max(1, Number(d && d.round) || 1),
        days: Object.assign({}, (d && d.days) || {}), correct: Number(d && d.correct) || 0, answered: Number(d && d.answered) || 0 });
      return { userId, decks: { kb: deck(rec && rec.decks && rec.decks.kb), en: deck(rec && rec.decks && rec.decks.en) } };
    },
    /** Nilai kartu: grade lupa|ragu|ingat. opts.correct (kata baku: pilihan benar?). */
    vocabGrade: (userId, kind, itemId, grade, opts) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') throw new Error('Progres kosakata hanya untuk akun mentee yang sedang masuk.');
      const g = DB.VOCAB_GRADES[grade];
      if (!g || (kind !== 'kb' && kind !== 'en') || typeof itemId !== 'string' || !itemId || itemId.length > 80) throw new Error('Penilaian kartu tidak valid.');
      const p = DB.vocabProgress(userId);
      const d = p.decks[kind];
      const today = DB.vocabDayIndex(null, actor);
      const prev = Array.isArray(d.items[itemId]) ? d.items[itemId] : [0, today, 0, 0, 0];
      d.items[itemId] = [g.st, today + g.days, Math.min(9999, (Number(prev[2]) || 0) + 1), Math.min(9999, (Number(prev[3]) || 0) + (g.st === 1 ? 1 : 0)), Math.floor(Date.now() / 1000)];
      d.days[today] = Math.min(9999, (Number(d.days[today]) || 0) + 1);
      // Simpan 120 hari terakhir saja untuk grafik aktivitas.
      Object.keys(d.days).forEach(k => { if (Number(k) < today - 120) delete d.days[k]; });
      if (opts && typeof opts.correct === 'boolean') { d.answered++; if (opts.correct) d.correct++; }
      DB._vpSave(p);
      return d.items[itemId];
    },
    /** Semua kosakata aktif sudah "ingat" → mulai putaran baru (riwayat ulangan tetap). */
    vocabNewRound: (userId, kind, activeIds) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') return null;
      const p = DB.vocabProgress(userId);
      const d = p.decks[kind];
      const today = DB.vocabDayIndex(null, actor);
      (activeIds || []).forEach(id => { const it = d.items[id]; if (Array.isArray(it)) d.items[id] = [0, today, it[2], it[3], it[4]]; });
      d.round = Math.min(999, d.round + 1);
      DB._vpSave(p);
      return d.round;
    },
    _vpSave: (p) => {
      const list = getAll(KEYS.vocabProgress).filter(r => r.userId !== p.userId);
      list.push({ id: p.userId, userId: p.userId, decks: p.decks, updatedAt: Date.now() });
      setAll(KEYS.vocabProgress, list);
    },

    /* ---------- Visibilitas konten (aktif/nonaktif & siswa baru) ---------- */
    CONTENT_STORE: { material: 'lms_materials', module: 'lms_modules', recording: 'lms_recordings',
      assignment: 'lms_assignments', cbt: 'lms_cbts', course: 'lms_courses' },
    /**
     * Konten tampil untuk siswa bila: aktif, kelasnya aktif, dan — pada kelas
     * dengan kebijakan "fromJoin" — dibuat setelah siswa bergabung atau
     * diaktifkan ulang setelah siswa bergabung.
     */
    contentVisibleToStudent: (rec, course, studentId) => {
      if (!rec || rec.active === false) return false;
      // Rilis bertahap per angkatan: arsip angkatan lama tersembunyi sampai dirilis.
      const stagedBatch = studentId ? DB.studentStagedBatch(studentId) : null;
      if (stagedBatch && !DB.contentOpenForBatch(rec, stagedBatch)) return false;
      if (course) {
        if (course.active === false) return false;
        if (course.newStudentPolicy === 'fromJoin') {
          const e = getAll(KEYS.enrollments).find(x => x.courseId === course.id && x.studentId === studentId);
          if (e) {
            const since = Number(e.enrolledAt) || 0;
            const born = Number(rec.createdAt) || Number(rec.recordedAt) || 0;
            if (born < since && !((Number(rec.reactivatedAt) || 0) >= since)) return false;
          }
        }
      }
      return true;
    },
    visibleCoursesForStudent: (studentId) => getAll(KEYS.enrollments).filter(e => e.studentId === studentId)
      .map(e => findById(KEYS.courses, e.courseId)).filter(c => c && c.active !== false),
    /** Daftar konten kelas yang boleh dilihat siswa (riwayat miliknya tetap tampil). */
    studentContent: (kind, studentId, courseId) => {
      const courses = courseId ? [findById(KEYS.courses, courseId)].filter(Boolean) : DB.visibleCoursesForStudent(studentId);
      const subs = kind === 'assignment' ? new Set(getAll(KEYS.submissions).filter(s => s.studentId === studentId).map(s => s.assignmentId)) : null;
      const tried = kind === 'cbt' ? new Set(getAll(KEYS.cbtAttempts).filter(a => a.studentId === studentId).map(a => a.cbtId)) : null;
      return courses.flatMap(c => {
        if (c.active === false) return [];
        const list = getAll(DB.CONTENT_STORE[kind]).filter(x => kind === 'cbt'
          ? (x.courseId === c.id || (x.courseIds || []).includes(c.id)) : x.courseId === c.id);
        return list.filter(x => DB.contentVisibleToStudent(x, c, studentId)
          || (subs && subs.has(x.id)) || (tried && tried.has(x.id)));
      }).filter((x, i, arr) => arr.findIndex(y => y.id === x.id) === i);
    },
    canToggleContent: (kind, rec, actor) => {
      if (!actor || !rec) return false;
      if (kind === 'course') return actor.role === 'admin';
      const course = rec.courseId ? findById(KEYS.courses, rec.courseId) : null;
      return DB.canManageContent(actor, rec, course);
    },
    setContentActive: (kind, id, active, actor) => {
      const key = DB.CONTENT_STORE[kind];
      if (!key) throw new Error('Jenis konten tidak dikenal.');
      const rec = findById(key, id);
      if (!rec) throw new Error('Data tidak ditemukan.');
      if (!DB.canToggleContent(kind, rec, actor)) throw new Error('Anda tidak berhak mengubah status konten ini.');
      const out = update(key, id, { active: !!active, activeChangedAt: Date.now(), activeChangedBy: actor.id });
      DB.logActivity('content.' + (active ? 'activate' : 'deactivate'), `${active ? 'Mengaktifkan' : 'Menonaktifkan'} ${kind} "${rec.title || rec.name || id}"`, id);
      return out;
    },
    /** Aktifkan ulang: tampil juga bagi siswa yang bergabung setelah konten dibuat. */
    reactivateContent: (kind, id, actor) => {
      const key = DB.CONTENT_STORE[kind];
      const rec = key ? findById(key, id) : null;
      if (!rec) throw new Error('Data tidak ditemukan.');
      if (!DB.canToggleContent(kind, rec, actor)) throw new Error('Anda tidak berhak mengubah status konten ini.');
      const now = Date.now();
      const out = update(key, id, { active: true, reactivatedAt: now, activeChangedAt: now, activeChangedBy: actor.id });
      DB.logActivity('content.reactivate', `Mengaktifkan ulang ${kind} "${rec.title || id}" untuk mentee baru`, id);
      const course = rec.courseId ? findById(KEYS.courses, rec.courseId) : null;
      if (course && ['assignment', 'cbt', 'material', 'module'].includes(kind)) {
        DB.notifyUsers(getAll(KEYS.enrollments).filter(e => e.courseId === course.id).map(e => e.studentId), {
          icon: '🔓', title: 'Konten kelas dibuka', body: `${rec.title || 'Konten'} kini tersedia di ${course.title}.`, link: 'my-courses'
        });
      }
      return out;
    },

    /* ---------- Ayat harian ---------- */
    getVerses: () => load('lms_verses', []),
    saveVerse: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola ayat.');
      const religion = String(rec.religion || '');
      if (!RELIGIONS.includes(religion)) throw new Error('Pilih agama yang valid.');
      const text = String(rec.text || '').trim();
      const reference = String(rec.reference || '').trim();
      if (text.length < 5 || text.length > 1200) throw new Error('Isi ayat 5–1200 karakter.');
      if (reference.length < 2 || reference.length > 120) throw new Error('Rujukan ayat wajib diisi (maks. 120 karakter).');
      const date = String(rec.date || '');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Format tanggal tidak valid.');
      const list = load('lms_verses', []);
      const clean = { religion, text, reference, source: String(rec.source || '').trim().slice(0, 120),
        active: rec.active !== false, reviewed: !!rec.reviewed, date, updatedAt: Date.now() };
      let out;
      if (rec.id) {
        const i = list.findIndex(v => v.id === rec.id);
        if (i < 0) throw new Error('Ayat tidak ditemukan.');
        out = list[i] = Object.assign({}, list[i], clean);
      } else {
        out = Object.assign({ id: uid('verse'), createdAt: Date.now() }, clean);
        list.push(out);
      }
      save('lms_verses', list);
      DB.logActivity('verse.save', `Menyimpan ayat ${religion} (${reference})`, out.id);
      return out;
    },
    deleteVerse: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola ayat.');
      save('lms_verses', load('lms_verses', []).filter(v => v.id !== id));
      DB.logActivity('verse.delete', 'Menghapus ayat', id);
    },
    /** Ayat hari ini: ayat yang dijadwalkan pada tanggal itu, atau rotasi harian. */
    verseOfDay: (religion, ymd) => {
      if (!religion) return null;
      const list = load('lms_verses', []).filter(v => v.religion === religion && v.active !== false);
      if (!list.length) return null;
      const pinned = list.find(v => v.date === ymd);
      if (pinned) return pinned;
      const pool = list.filter(v => !v.date).sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
      if (!pool.length) return null;
      const dayNo = Math.floor(Date.parse(ymd + 'T00:00:00Z') / 86400000);
      return pool[((dayNo % pool.length) + pool.length) % pool.length];
    },

    /* ---------- Reading Text ---------- */
    getReadingTexts: () => load('lms_reading_texts', []),
    getReadingText: (id) => load('lms_reading_texts', []).find(t => t.id === id) || null,
    saveReadingText: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola Reading Text.');
      const title = String(rec.title || '').trim();
      if (title.length < 3 || title.length > 140) throw new Error('Judul 3–140 karakter.');
      const body = String(rec.body || '');
      const plainLen = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
      if (plainLen < 80) throw new Error('Isi teks minimal 80 karakter.');
      if (body.length > 60000) throw new Error('Isi teks terlalu panjang.');
      const qs = Array.isArray(rec.questions) ? rec.questions : [];
      if (qs.length < 1 || qs.length > 10) throw new Error('Sertakan 1–10 soal pemahaman.');
      qs.forEach((q, i) => {
        if (!String(q.text || '').trim()) throw new Error(`Soal ${i + 1} belum diisi.`);
        const opts = (q.options || []).map(o => String(o || '').trim());
        if (opts.length < 2 || opts.length > 6 || opts.some(o => !o)) throw new Error(`Soal ${i + 1}: isi 2–6 pilihan jawaban.`);
        if (!(q.correctIndex >= 0 && q.correctIndex < opts.length)) throw new Error(`Soal ${i + 1}: pilih kunci jawaban.`);
      });
      const clean = { title, body, subtest: String(rec.subtest || '').slice(0, 80), level: ['mudah', 'sedang', 'sulit'].includes(rec.level) ? rec.level : 'sedang',
        active: rec.active !== false, updatedAt: Date.now(),
        questions: qs.map(q => ({ text: String(q.text).trim().slice(0, 600), options: q.options.map(o => String(o).trim().slice(0, 300)), correctIndex: Number(q.correctIndex) })) };
      const list = load('lms_reading_texts', []);
      let out;
      if (rec.id) {
        const i = list.findIndex(t => t.id === rec.id);
        if (i < 0) throw new Error('Teks tidak ditemukan.');
        out = list[i] = Object.assign({}, list[i], clean);
      } else {
        out = Object.assign({ id: uid('rt'), createdAt: Date.now(), createdBy: actor.id }, clean);
        list.push(out);
      }
      save('lms_reading_texts', list);
      DB.logActivity('reading.save', `Menyimpan Reading Text "${title}"`, out.id);
      return out;
    },
    deleteReadingText: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola Reading Text.');
      save('lms_reading_texts', load('lms_reading_texts', []).filter(t => t.id !== id));
      DB.logActivity('reading.delete', 'Menghapus Reading Text', id);
    },

    /* ---------- Course mandiri (dikelola admin, tanpa tutor) ---------- */
    HUB_QTYPES,
    HUB_DEFAULT_MIN_SEC,
    HUB_DEFAULT_INACTIVE_DAYS,
    getHubCourses: () => load('lms_hub_courses', []),
    getHubCourse: (id) => load('lms_hub_courses', []).find(c => c.id === id) || null,
    /** Bagian soal kuis yang belum lengkap (null = valid). Dipakai editor & validasi simpan. */
    hubQuestionProblem: (q) => hubQuestionProblem(q),
    /** Jenis soal kuis (soal lama tanpa jenis = Pilihan Ganda). */
    hubQType: (q) => hubQType(q),
    /** Apakah jawaban mentee untuk soal ini sudah lengkap (aturan sama dengan penilaian). */
    hubIsAnswered: (q, a) => hubAnswered(q, hubNormAnswer(q, a)),
    /** Tutor course mandiri (ditetapkan admin): boleh menyusun kurikulum & menilai esai peserta. */
    hubTutorIds: (course) => (course && Array.isArray(course.tutorIds) ? course.tutorIds : []),
    isHubTutor: (user, course) => !!(user && course && user.role === 'guru' && DB.hubTutorIds(course).includes(user.id)),
    hubCoursesForTutor: (userId) => load('lms_hub_courses', []).filter(c => DB.hubTutorIds(c).includes(userId)),
    saveHubCourse: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      const title = String(rec.title || '').trim();
      if (title.length < 3 || title.length > 140) throw new Error('Judul course 3–140 karakter.');
      const sections = Array.isArray(rec.sections) ? rec.sections : [];
      validateHubSections(sections);
      const access = normHubAccess(rec);
      const list = load('lms_hub_courses', []);
      const now = Date.now();
      const inact = Number(rec.inactivityDays);
      const gurus = new Set(load(KEYS.users, []).filter(u => u.role === 'guru').map(u => u.id));
      const clean = Object.assign({}, rec, {
        title, subtitle: String(rec.subtitle || '').trim().slice(0, 240),
        category: String(rec.category || '').trim().slice(0, 60), level: String(rec.level || '').slice(0, 30),
        outcomes: (rec.outcomes || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        requirements: (rec.requirements || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        tutorIds: [...new Set((rec.tutorIds || []).filter(id => gurus.has(id)))].slice(0, 20),
        enrollMode: rec.enrollMode === 'assigned' ? 'assigned' : 'open',
        newStudentPolicy: rec.newStudentPolicy === 'fromJoin' ? 'fromJoin' : 'all',
        sequential: rec.sequential === 'lesson' || rec.sequential === 'section' ? rec.sequential : 'off',
        inactivityDays: rec.inactivityDays == null || rec.inactivityDays === '' || !isFinite(inact)
          ? HUB_DEFAULT_INACTIVE_DAYS : Math.max(0, Math.min(365, Math.round(inact))),
        color: /^#[0-9a-f]{6}$/i.test(String(rec.color || '')) ? rec.color : '#4f46e5',
        active: rec.active !== false, updatedAt: now
      }, access);
      let out;
      const i = rec.id ? list.findIndex(c => c.id === rec.id) : -1;
      const before = i >= 0 ? list[i] : null;
      if (i >= 0) out = list[i] = Object.assign({}, list[i], clean);
      else { out = Object.assign({ createdAt: now, createdBy: actor.id }, clean, { id: rec.id || uid('hub') }); list.push(out); }
      save('lms_hub_courses', list);
      DB.logActivity('hub.save', `Menyimpan course "${title}"`, out.id);
      const added = out.tutorIds.filter(id => !DB.hubTutorIds(before).includes(id));
      if (added.length) DB.notifyUsers(added, { type: 'course', icon: '📚', title: 'Anda menjadi tutor course mandiri', body: `${title} — susun materi dan nilai esai peserta di menu Course Mandiri.`, link: 'course-tutor' });
      return out;
    },
    /**
     * Tutor course menyimpan isi course: hanya kurikulum (bab & pelajaran), deskripsi,
     * subjudul, tujuan, dan persyaratan. Judul, akses, harga, sasaran, dan tutor tetap milik admin.
     */
    saveHubCourseByTutor: (rec, actor) => {
      const cur = DB.getHubCourse(rec && rec.id);
      if (!cur) throw new Error('Course tidak ditemukan.');
      if (!DB.isHubTutor(actor, cur)) throw new Error('Hanya tutor course ini atau admin yang dapat mengubah isinya.');
      if (cur.contentLocked) throw new Error('Isi course belum termuat penuh. Muat ulang halaman lalu coba lagi.');
      const sections = Array.isArray(rec.sections) ? rec.sections : [];
      validateHubSections(sections);
      const out = Object.assign({}, cur, {
        sections, description: global.RichText ? RichText.sanitize(rec.description || '') : String(rec.description || '').replace(/[<>]/g, ''),
        subtitle: String(rec.subtitle || '').trim().slice(0, 240),
        outcomes: (rec.outcomes || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        requirements: (rec.requirements || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        updatedAt: Date.now()
      });
      save('lms_hub_courses', load('lms_hub_courses', []).map(c => (c.id === cur.id ? out : c)));
      return out;
    },
    /**
     * Penilaian esai kuis oleh tutor course (atau admin): nilai 0–100 per soal esai dan umpan balik.
     * Disimpan di progres peserta (review[lessonId]); peserta diberi notifikasi.
     */
    hubSaveReview: (courseId, studentId, lessonId, data, actor) => {
      const c = DB.getHubCourse(courseId);
      if (!c || !actor || !(actor.role === 'admin' || DB.isHubTutor(actor, c))) throw new Error('Hanya tutor course ini atau admin yang dapat menilai.');
      const list = load('lms_hub_progress', []);
      const prog = list.find(p => p.courseId === courseId && p.studentId === studentId);
      if (!prog) throw new Error('Progres peserta tidak ditemukan.');
      const lesson = DB.hubLessons(c).find(l => l.id === lessonId);
      if (!lesson || lesson.type !== 'quiz') throw new Error('Kuis tidak ditemukan.');
      const scores = {};
      Object.keys((data && data.scores) || {}).forEach(k => {
        const v = Number(data.scores[k]);
        if (data.scores[k] === '' || data.scores[k] == null || !isFinite(v)) return;
        if (v < 0 || v > 100) throw new Error('Nilai esai harus 0–100.');
        scores[k] = Math.round(v);
      });
      const feedback = String((data && data.feedback) || '').replace(/[<>]/g, '').trim().slice(0, 2000);
      if (!Object.keys(scores).length && !feedback) throw new Error('Isi nilai atau umpan balik terlebih dahulu.');
      prog.review = Object.assign({}, prog.review, { [lessonId]: { scores, feedback, gradedBy: actor.id, gradedAt: Date.now() } });
      save('lms_hub_progress', list);
      DB.addNotification({ userId: studentId, type: 'course', icon: '📝', title: 'Esai kuis sudah dinilai',
        body: `${c.title} — ${lesson.title}`, link: 'course' });
      return prog;
    },
    /** Jumlah jawaban esai yang belum dinilai tutor pada satu course. */
    hubPendingEssays: (course) => {
      const quizzes = DB.hubLessons(course).filter(l => l.type === 'quiz' && (l.questions || []).some(q => hubQType(q) === 'Esai'));
      let n = 0;
      DB.getHubProgressByCourse(course.id).forEach(p => quizzes.forEach(l => {
        const qr = (p.quiz || {})[l.id] || {};
        const rv = (p.review || {})[l.id];
        // Belum dinilai, atau jawaban dikirim ulang setelah dinilai.
        if (qr.answers && (!rv || (Number(qr.at) || 0) > (Number(rv.gradedAt) || 0))) n++;
      }));
      return n;
    },
    deleteHubCourse: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      const gone = DB.getHubCourse(id);
      save('lms_hub_courses', load('lms_hub_courses', []).filter(c => c.id !== id));
      save('lms_hub_progress', load('lms_hub_progress', []).filter(p => p.courseId !== id));
      // Riwayat pembayaran dipertahankan untuk audit; gambar QRIS course dihapus.
      if (gone && gone.payment && gone.payment.qrisKey && global.BlobStore) BlobStore.remove(gone.payment.qrisKey).catch(() => {});
      DB.logActivity('hub.delete', 'Menghapus course', id);
    },
    setHubCourseActive: (id, active, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      const c = DB.getHubCourse(id);
      if (!c) throw new Error('Course tidak ditemukan.');
      c.active = !!active; c.updatedAt = Date.now();
      save('lms_hub_courses', load('lms_hub_courses', []).map(x => x.id === id ? c : x));
      DB.logActivity('hub.' + (active ? 'activate' : 'deactivate'), `${active ? 'Mengaktifkan' : 'Menonaktifkan'} course "${c.title}"`, id);
      return c;
    },
    /** Lesson: aktif/nonaktif & aktifkan ulang (siswa baru). */
    setHubLessonState: (courseId, lessonId, patch, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      const c = DB.getHubCourse(courseId);
      if (!c) throw new Error('Course tidak ditemukan.');
      let found = null;
      (c.sections || []).forEach(sec => (sec.lessons || []).forEach(l => { if (l.id === lessonId) found = l; }));
      if (!found) throw new Error('Pelajaran tidak ditemukan.');
      if (patch.active != null) found.active = !!patch.active;
      if (patch.reactivate) { found.active = true; found.reactivatedAt = Date.now(); }
      c.updatedAt = Date.now();
      save('lms_hub_courses', load('lms_hub_courses', []).map(x => x.id === courseId ? c : x));
      DB.logActivity('hub.lesson', `Mengubah status pelajaran "${found.title}"`, lessonId);
      return found;
    },
    hubAudienceIncludes: (course, student) => {
      if (!course || !student || student.role !== 'siswa') return false;
      const a = course.audience || { type: 'all' };
      if (a.type === 'kelas') return (a.classes || []).includes(student.kelas);
      if (a.type === 'students') return (a.studentIds || []).includes(student.id);
      return true;
    },
    /** Progres AKTIF (peserta yang dikeluarkan otomatis tidak dihitung). */
    getHubProgress: (courseId, studentId) => load('lms_hub_progress', [])
      .find(p => p.courseId === courseId && p.studentId === studentId && !p.removedAt) || null,
    /** Record progres apa pun statusnya (termasuk yang dikeluarkan). */
    getHubProgressRecord: (courseId, studentId) => load('lms_hub_progress', [])
      .find(p => p.courseId === courseId && p.studentId === studentId) || null,
    getHubProgressByStudent: (studentId) => load('lms_hub_progress', []).filter(p => p.studentId === studentId && !p.removedAt),
    getHubProgressByCourse: (courseId) => load('lms_hub_progress', []).filter(p => p.courseId === courseId && !p.removedAt),
    /** Semua record milik mentee (termasuk yang dikeluarkan) — untuk tampilan orang tua. */
    getHubProgressHistoryByStudent: (studentId) => load('lms_hub_progress', []).filter(p => p.studentId === studentId),
    getHubRemovedByCourse: (courseId) => load('lms_hub_progress', []).filter(p => p.courseId === courseId && p.removedAt),
    /** Course yang tampil di katalog siswa (aktif & sesuai sasaran). */
    hubCoursesForStudent: (studentId) => {
      const st = findById(KEYS.users, studentId);
      return load('lms_hub_courses', []).filter(c => c.active !== false && DB.hubAudienceIncludes(c, st));
    },
    /**
     * Daftar ke course. Bila mentee pernah dikeluarkan otomatis karena tidak
     * aktif, record lamanya dipulihkan (progres, nilai kuis & catatan tetap ada).
     */
    hubEnroll: (courseId, studentId) => {
      const actor = sessionActor();
      const c = DB.getHubCourse(courseId);
      const st = findById(KEYS.users, studentId);
      if (!c || c.active === false) throw new Error('Course tidak tersedia.');
      const isAdmin = actor && actor.role === 'admin';
      if (!isAdmin && (!actor || actor.id !== studentId)) throw new Error('Pendaftaran tidak sah.');
      if (!DB.hubAudienceIncludes(c, st)) throw new Error('Course ini bukan untuk kelasmu.');
      if (!isAdmin && c.enrollMode === 'assigned') throw new Error('Course ini didaftarkan oleh admin.');
      if (!isAdmin && !DB.hubHasAccess(c, studentId)) throw new Error('Course berbayar: kirim bukti pembayaran dan tunggu persetujuan admin.');
      const list = load('lms_hub_progress', []);
      const existing = list.find(p => p.courseId === courseId && p.studentId === studentId);
      const now = Date.now();
      if (existing && !existing.removedAt) return existing;
      if (existing) {
        existing.removedAt = null;
        existing.removedReason = '';
        existing.removedAfterDays = null;
        existing.restoredAt = now;
        existing.lastActiveAt = now;
        save('lms_hub_progress', list);
        return existing;
      }
      const rec = { id: uid('hubp'), courseId, studentId, enrolledAt: now, lastActiveAt: now, completed: {}, quiz: {}, notes: {}, lastLessonId: '', completedAt: null };
      list.push(rec); save('lms_hub_progress', list);
      return rec;
    },
    /* ---------- Course berbayar: pembayaran manual (transfer/QRIS + bukti) ---------- */
    getHubPayments: () => load('lms_hub_payments', []),
    getHubPayment: (id) => load('lms_hub_payments', []).find(p => p.id === id) || null,
    /** Pembayaran terbaru seorang siswa untuk satu course (null bila belum pernah). */
    hubPaymentFor: (courseId, studentId) => load('lms_hub_payments', [])
      .filter(p => p.courseId === courseId && p.studentId === studentId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null,
    hubIsPaid: (course) => !!course && course.accessType === 'paid',
    /** Gratis = selalu; berbayar = ada pembayaran disetujui. Penegakan sebenarnya di server. */
    hubHasAccess: (course, studentId) => !DB.hubIsPaid(course) || load('lms_hub_payments', [])
      .some(p => p.courseId === course.id && p.studentId === studentId && p.status === 'approved'),
    /** Siswa mengirim bukti (berkas sudah diunggah ke proofKey). */
    hubSubmitPayment: ({ courseId, proofKey, proofName, note }) => {
      const actor = sessionActor();
      if (!actor || actor.role !== 'siswa') throw new Error('Hanya mentee yang dapat mengirim bukti pembayaran.');
      const c = DB.getHubCourse(courseId);
      if (!c || c.active === false || !DB.hubIsPaid(c)) throw new Error('Course tidak tersedia untuk dibayar.');
      const last = DB.hubPaymentFor(courseId, actor.id);
      if (last && last.status === 'pending') throw new Error('Masih ada pembayaran yang menunggu verifikasi.');
      if (last && last.status === 'approved') throw new Error('Pembayaran course ini sudah disetujui.');
      if (!new RegExp('^proof:' + actor.id + ':').test(String(proofKey || ''))) throw new Error('Unggah bukti transfer terlebih dahulu.');
      const rec = {
        id: uid('hpay'), courseId, studentId: actor.id, amount: c.price, status: 'pending',
        proofKey, proofName: String(proofName || '').replace(/[<>]/g, '').slice(0, 120), note: String(note || '').replace(/[<>]/g, '').trim().slice(0, 300),
        createdAt: Date.now()
      };
      const list = load('lms_hub_payments', []);
      list.push(rec);
      save('lms_hub_payments', list);
      const admins = load(KEYS.users, []).filter(u => u.role === 'admin' && u.status !== 'Dikeluarkan').map(u => u.id);
      DB.notifyUsers(admins, { icon: '💳', title: 'Bukti pembayaran baru', body: `${actor.name || 'Mentee'} — ${c.title} (${DB.formatRupiah(c.price)})`, link: 'hub-pay' });
      return rec;
    },
    /** Admin menyetujui / menolak. Disetujui → siswa langsung terdaftar di course. */
    hubDecidePayment: (payId, decision, reason, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat memverifikasi pembayaran.');
      const list = load('lms_hub_payments', []);
      const p = list.find(x => x.id === payId);
      if (!p) throw new Error('Data pembayaran tidak ditemukan.');
      if (decision !== 'approved' && decision !== 'rejected') throw new Error('Keputusan tidak valid.');
      const why = String(reason || '').replace(/[<>]/g, '').trim().slice(0, 300);
      if (decision === 'rejected' && !why) throw new Error('Tuliskan alasan penolakan agar mentee tahu yang harus diperbaiki.');
      p.status = decision;
      p.rejectReason = decision === 'rejected' ? why : '';
      p.decidedAt = Date.now();
      p.decidedBy = actor.id;
      save('lms_hub_payments', list);
      const c = DB.getHubCourse(p.courseId);
      const title = c ? c.title : 'Course';
      if (decision === 'approved' && c) { try { DB.hubEnroll(c.id, p.studentId); } catch (e) { /* sasaran berubah: akses tetap tercatat */ } }
      DB.addNotification({
        userId: p.studentId, link: 'course', icon: '💳',
        title: decision === 'approved' ? 'Pembayaran disetujui' : 'Pembayaran ditolak',
        body: decision === 'approved' ? `Akses ke "${title}" sudah dibuka. Selamat belajar.` : `"${title}": ${why}`
      });
      DB.logActivity('hub.pay.' + decision, `${decision === 'approved' ? 'Menyetujui' : 'Menolak'} pembayaran "${title}"`, payId);
      return p;
    },
    /** Admin memberi akses tanpa bukti (mis. beasiswa, bayar tunai). */
    hubGrantAccess: (courseId, studentId, actor, note) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat memberi akses.');
      const c = DB.getHubCourse(courseId);
      if (!c) throw new Error('Course tidak ditemukan.');
      if (!DB.hubIsPaid(c) || DB.hubHasAccess(c, studentId)) return null;
      const now = Date.now();
      const rec = { id: uid('hpay'), courseId, studentId, amount: 0, status: 'approved', method: 'manual',
        note: String(note || 'Akses diberikan admin').replace(/[<>]/g, '').slice(0, 300), createdAt: now, decidedAt: now, decidedBy: actor.id };
      const list = load('lms_hub_payments', []);
      list.push(rec);
      save('lms_hub_payments', list);
      DB.logActivity('hub.pay.grant', `Memberi akses course "${c.title}"`, studentId);
      return rec;
    },
    formatRupiah: (n) => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID'),
    hubLessonVisible: (course, lesson, progress) => {
      if (!lesson || lesson.active === false) return false;
      if (progress && course.newStudentPolicy === 'fromJoin') {
        const since = progress.enrolledAt || 0;
        if ((lesson.createdAt || 0) < since && !((lesson.reactivatedAt || 0) >= since)) return false;
      }
      return true;
    },
    /** Kapan pelajaran terbuka (drip): null = sudah terbuka. */
    hubLessonOpensAt: (lesson, progress) => {
      const d = Number(lesson.dripDays) || 0;
      if (!d || !progress) return null;
      const at = (progress.enrolledAt || 0) + d * 86400000;
      return at > Date.now() ? at : null;
    },
    hubLessons: (course) => (course.sections || []).flatMap(sec => (sec.lessons || []).map(l => Object.assign({ sectionId: sec.id, sectionTitle: sec.title }, l))),
    /** Waktu minimal (detik) sebelum pelajaran non-kuis boleh ditandai selesai. 0 = langsung. */
    hubLessonMinSec: (lesson) => {
      const v = lesson && lesson.minSec;
      if (v == null || v === '' || !isFinite(Number(v))) return HUB_DEFAULT_MIN_SEC;
      return Math.max(0, Math.min(7200, Math.round(Number(v))));
    },
    /** Batas hari tidak aktif sebelum peserta dikeluarkan otomatis (0 = tidak pernah). */
    hubInactivityDays: (course) => {
      const v = course && course.inactivityDays;
      if (v == null || v === '' || !isFinite(Number(v))) return HUB_DEFAULT_INACTIVE_DAYS;
      return Math.max(0, Math.min(365, Math.round(Number(v))));
    },
    /**
     * Kunci urutan belajar (course.sequential):
     *   'lesson'  → pelajaran terbuka setelah semua pelajaran sebelumnya selesai
     *   'section' → bab berikutnya terbuka setelah seluruh pelajaran bab sebelumnya selesai
     * Mengembalikan peta lessonId → pelajaran penghalang (yang harus diselesaikan dulu).
     * Pelajaran yang sudah selesai tidak pernah terkunci (selalu bisa diulas).
     */
    hubLockMap: (course, progress) => {
      const mode = course && (course.sequential === 'lesson' || course.sequential === 'section') ? course.sequential : '';
      const out = {};
      if (!mode) return out;
      const done = (progress && progress.completed) || {};
      let blocker = null;
      (course.sections || []).forEach(sec => {
        const vis = (sec.lessons || []).filter(l => DB.hubLessonVisible(course, l, progress))
          .map(l => Object.assign({ sectionId: sec.id, sectionTitle: sec.title }, l));
        if (mode === 'section') {
          if (blocker) vis.forEach(l => { if (!done[l.id]) out[l.id] = blocker; });
          else blocker = vis.find(l => !done[l.id]) || null;
        } else {
          vis.forEach(l => {
            if (done[l.id]) return;
            if (blocker) out[l.id] = blocker;
            else blocker = l;
          });
        }
      });
      return out;
    },
    /** Catat "terakhir aktif" saat mentee membuka pelajaran (dibatasi tiap 10 menit). */
    hubTouch: (courseId, studentId) => {
      const actor = sessionActor();
      if (!actor || actor.id !== studentId) return null;
      const prog = DB.getHubProgress(courseId, studentId);
      if (!prog) return null;
      const now = Date.now();
      if (now - (Number(prog.lastActiveAt) || 0) < HUB_TOUCH_MS) return prog;
      prog.lastActiveAt = now;
      saveHubProgressRec(prog);
      return prog;
    },
    hubLastActive: (progress) => (progress ? hubLastActive(progress) : 0),
    /**
     * Tandai pelajaran selesai. Artikel/video/tautan memerlukan token durasi
     * (waktu minimal diatur per pelajaran, bawaan 40 detik); kuis dinilai DI
     * SINI dari kunci jawaban, bukan dari UI. Streak/XP hanya bertambah bila
     * waktu belajar nyata memenuhi batas aktivitas "Membaca materi".
     */
    hubCompleteLesson: (courseId, lessonId, studentId, payload) => {
      const actor = sessionActor();
      if (!actor || actor.id !== studentId) throw new Error('Hanya pemilik akun yang dapat menyelesaikan pelajaran.');
      const c = DB.getHubCourse(courseId);
      if (!c || c.active === false) throw new Error('Course tidak tersedia.');
      const prog = DB.getHubProgress(courseId, studentId);
      if (!prog) throw new Error('Daftar course terlebih dahulu.');
      const lesson = DB.hubLessons(c).find(l => l.id === lessonId);
      if (!DB.hubLessonVisible(c, lesson, prog)) throw new Error('Pelajaran tidak tersedia.');
      if (DB.hubLessonOpensAt(lesson, prog)) throw new Error('Pelajaran ini belum dibuka.');
      const blocker = DB.hubLockMap(c, prog)[lessonId];
      if (blocker) throw new Error(`Selesaikan dulu pelajaran "${blocker.title}".`);
      const p = payload || {};
      const user = findById(KEYS.users, studentId);
      const now = Date.now();
      let result = { passed: true, score: null };
      let streakOk = true;
      if (lesson.type === 'quiz') {
        const qs = lesson.questions || [];
        const raw = Array.isArray(p.answers) ? p.answers : [];
        if (raw.length !== qs.length) throw new Error('Jawab semua soal kuis.');
        const ans = qs.map((q, i) => hubNormAnswer(q, raw[i]));
        if (qs.some((q, i) => !hubAnswered(q, ans[i]))) throw new Error('Jawab semua soal kuis.');
        let correct = 0, total = 0;
        const marks = qs.map((q, i) => {
          const g = hubGrade(q, ans[i]);
          if (g.auto) { total++; if (g.correct) correct++; }
          return g.auto ? (g.correct ? 1 : 0) : null;
        });
        if (!total) throw new Error('Kuis ini belum memiliki soal yang dapat dinilai otomatis.');
        const score = Math.round(correct / total * 100);
        const pass = Number(lesson.passScore) || 70;
        result = { passed: score >= pass, score, correct, total, marks };
        const prevAttempts = Number(((prog.quiz || {})[lessonId] || {}).attempts) || 0;
        prog.quiz = Object.assign({}, prog.quiz, { [lessonId]: { score, passed: result.passed, at: now, answers: ans,
          correct, total, attempts: prevAttempts + 1 } });
      } else {
        const tok = learningTokens.get(p.token);
        if (!tok || tok.userId !== studentId || tok.refId !== 'hub:' + lessonId) throw new Error('Sesi belajar tidak sah. Buka ulang pelajaran.');
        const elapsed = (now - tok.startedAt) / 1000;
        // Waktu minimal dibaca dari data course (bukan dari token) agar tidak dapat diperpendek.
        const wait = DB.hubLessonMinSec(lesson) - elapsed;
        if (wait > 0) throw new Error(`Pelajari dulu minimal ${Math.ceil(wait)} detik lagi.`);
        streakOk = elapsed >= (LEARNING_TYPES.materi.minSec || HUB_DEFAULT_MIN_SEC);
        learningTokens.delete(p.token);
      }
      const already = !!(prog.completed || {})[lessonId];
      if (result.passed && !already) {
        prog.completed = Object.assign({}, prog.completed, { [lessonId]: now });
        // Aktivitas belajar sah: pelajaran = "membaca materi", kuis = "mini quiz".
        if (streakOk) {
          try { appendLearning(user, lesson.type === 'quiz' ? 'miniquiz' : 'materi', 'hub:' + lessonId, { score: result.score }, now); } catch (e) { /* duplikasi diabaikan */ }
        }
      }
      result.streak = !!(result.passed && !already && streakOk);
      prog.lastLessonId = lessonId;
      prog.lastActiveAt = now;
      const visible = DB.hubLessons(c).filter(l => DB.hubLessonVisible(c, l, prog));
      if (!prog.completedAt && visible.length && visible.every(l => prog.completed[l.id])) prog.completedAt = now;
      saveHubProgressRec(prog);
      return Object.assign({ progress: prog }, result);
    },
    hubSaveNote: (courseId, lessonId, studentId, text) => {
      const actor = sessionActor();
      if (!actor || actor.id !== studentId) throw new Error('Catatan hanya milik pemilik akun.');
      const prog = DB.getHubProgress(courseId, studentId);
      if (!prog) throw new Error('Daftar course terlebih dahulu.');
      prog.notes = Object.assign({}, prog.notes, { [lessonId]: String(text || '').slice(0, 4000) });
      prog.lastLessonId = lessonId;
      prog.lastActiveAt = Date.now();
      saveHubProgressRec(prog);
      return prog;
    },
    hubPercent: (course, progress) => {
      if (!progress) return 0;
      const visible = DB.hubLessons(course).filter(l => DB.hubLessonVisible(course, l, progress));
      if (!visible.length) return 0;
      return Math.round(visible.filter(l => (progress.completed || {})[l.id]).length / visible.length * 100);
    },
    /**
     * Keluarkan otomatis peserta Course Mandiri yang tidak aktif selama
     * course.inactivityDays hari (bawaan 7; 0 = tidak pernah). Hanya berlaku
     * untuk Course Mandiri — pendaftaran Kelas tidak disentuh. Bersifat lunak:
     * record tetap disimpan (removedAt) sehingga progres pulih saat mentee
     * bergabung kembali. Tidak dihitung tidak aktif bila mentee sudah tuntas,
     * course sedang dimatikan, atau mentee hanya menunggu pelajaran terjadwal.
     * Admin memproses semua peserta; mentee hanya record miliknya sendiri.
     */
    hubSweepInactive: (actorArg, opts) => {
      const actor = actorArg || sessionActor();
      if (!actor || (actor.role !== 'admin' && actor.role !== 'siswa')) return [];
      const now = Date.now();
      if (!(opts && opts.force) && hubSweepAt.id === actor.id && now - hubSweepAt.at < HUB_TOUCH_MS) return [];
      hubSweepAt = { id: actor.id, at: now };
      const byId = new Map(load('lms_hub_courses', []).map(c => [c.id, c]));
      const list = load('lms_hub_progress', []);
      const removed = [];
      let stamped = 0;
      list.forEach(p => {
        if (!p || p.removedAt || p.completedAt) return;
        if (actor.role !== 'admin' && p.studentId !== actor.id) return;
        const c = byId.get(p.courseId);
        if (!c || c.active === false) return;
        const days = DB.hubInactivityDays(c);
        if (!days) return;
        // Record lama (sebelum pencatatan keaktifan ada) diberi hitungan baru mulai
        // sekarang, sehingga tidak ada mentee yang langsung dikeluarkan saat fitur ini aktif.
        if (p.lastActiveAt == null) { p.lastActiveAt = now; stamped++; return; }
        const st = findById(KEYS.users, p.studentId);
        if (!st || st.role !== 'siswa') return;
        const lock = DB.hubLockMap(c, p);
        const pending = DB.hubLessons(c).filter(l => DB.hubLessonVisible(c, l, p) && !(p.completed || {})[l.id]);
        // Tidak ada pelajaran yang bisa dikerjakan sekarang (semua menunggu jadwal) → jangan dihitung.
        if (!pending.some(l => !DB.hubLessonOpensAt(l, p) && !lock[l.id])) return;
        let last = hubLastActive(p);
        // Pelajaran terjadwal yang baru terbuka menjadi titik awal hitungan baru.
        pending.forEach(l => {
          const d = Number(l.dripDays) || 0;
          if (!d) return;
          const at = (Number(p.enrolledAt) || 0) + d * 86400000;
          if (at <= now && at > last) last = at;
        });
        if (now - last < days * 86400000) return;
        p.removedAt = now;
        p.removedReason = 'inactive';
        p.removedAfterDays = days;
        p.removals = (Array.isArray(p.removals) ? p.removals : []).concat([{ at: now, reason: 'inactive', days, lastActiveAt: last, percent: DB.hubPercent(c, p) }]).slice(-10);
        removed.push({ progress: p, course: c });
      });
      if (!removed.length) {
        if (stamped) save('lms_hub_progress', list);
        return [];
      }
      save('lms_hub_progress', list);
      removed.forEach(({ progress: p, course: c }) => {
        try {
          DB.addNotification({ userId: p.studentId, type: 'course', icon: '⏳', title: 'Dikeluarkan dari course karena tidak aktif',
            body: `${c.title} — tidak ada aktivitas selama ${p.removedAfterDays} hari. ` +
              (c.enrollMode === 'assigned' ? 'Hubungi admin untuk didaftarkan kembali.' : 'Buka menu Course untuk bergabung kembali; progresmu tetap tersimpan.'),
            link: 'course' });
        } catch (e) { /* notifikasi opsional */ }
      });
      if (actor.role === 'admin') {
        try { DB.logActivity('hub.inactive', `Mengeluarkan ${removed.length} peserta course yang tidak aktif`, removed.map(r => r.progress.id).join(',').slice(0, 200)); } catch (e) { /* log opsional */ }
      }
      return removed;
    },

    /* ---------- Mesin Waktu: penyimpanan ciphertext milik pemilik saja ----------
     * Lapisan ini TIDAK PERNAH menyimpan isi surat dalam bentuk teks biasa.
     * Semua fungsi baca/tulis isi memeriksa bahwa sesi aktif = pemilik akun,
     * sehingga panel admin/tutor tidak memiliki jalur untuk mengambilnya. */
    capsuleOwnerGuard: (userId) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId || actor.role !== 'siswa') throw new Error('Mesin Waktu hanya dapat diakses pemilik akun.');
      return actor;
    },
    getCapsuleVault: (userId) => {
      DB.capsuleOwnerGuard(userId);
      return load('lms_capsule_vaults', []).find(v => v.userId === userId) || null;
    },
    saveCapsuleVault: (userId, vault) => {
      DB.capsuleOwnerGuard(userId);
      const allowed = ['salt', 'iter', 'wrapF2', 'wrapRec', 'recSalt', 'version', 'fails', 'lockUntil', 'lockLevel', 'createdAt', 'updatedAt', 'recoveryConfirmed'];
      const clean = { userId };
      allowed.forEach(k => { if (vault[k] !== undefined) clean[k] = vault[k]; });
      if (!clean.salt || !clean.wrapF2 || !clean.wrapF2.ct) throw new Error('Data brankas tidak lengkap.');
      const list = load('lms_capsule_vaults', []).filter(v => v.userId !== userId);
      list.push(clean); save('lms_capsule_vaults', list);
      return clean;
    },
    /** Hapus brankas + seluruh kapsul (reset tanpa recovery key). */
    destroyCapsuleVault: (userId) => {
      DB.capsuleOwnerGuard(userId);
      save('lms_capsule_vaults', load('lms_capsule_vaults', []).filter(v => v.userId !== userId));
      save('lms_capsules', load('lms_capsules', []).filter(c => c.userId !== userId));
      DB.logActivity('capsule.reset', 'Mereset kode F2 tanpa recovery key (isi Mesin Waktu dihapus permanen)', userId);
    },
    getCapsules: (userId) => {
      DB.capsuleOwnerGuard(userId);
      return load('lms_capsules', []).filter(c => c.userId === userId).sort((a, b) => a.openAt - b.openAt);
    },
    addCapsule: (userId, rec) => {
      DB.capsuleOwnerGuard(userId);
      const st = DB.getSettings();
      if (st.capsuleEnabled === false) throw new Error('Mesin Waktu sedang dinonaktifkan admin.');
      const mine = load('lms_capsules', []).filter(c => c.userId === userId);
      if (mine.length >= (Number(st.capsuleMaxPerUser) || 20)) throw new Error(`Maksimal ${st.capsuleMaxPerUser || 20} kapsul per akun.`);
      const openAt = Number(rec.openAt);
      const now = Date.now();
      if (!Number.isFinite(openAt) || openAt < now + 10 * 60000) throw new Error('Waktu pembukaan minimal 10 menit dari sekarang.');
      if (openAt > now + 50 * 365 * 86400000) throw new Error('Waktu pembukaan maksimal 50 tahun.');
      if (!rec.encTitle || !rec.encTitle.ct || !rec.encBody || !rec.encBody.ct) throw new Error('Isi kapsul harus terenkripsi.');
      if (JSON.stringify(rec.encBody).length > 2500000) throw new Error('Isi surat terlalu besar (maks. ±1,8 MB).');
      const out = { id: uid('cap'), userId, createdAt: now, openAt, encTitle: rec.encTitle, encBody: rec.encBody,
        attachments: (rec.attachments || []).slice(0, 4).map(a => ({ id: String(a.id), size: Number(a.size) || 0, kind: a.kind === 'pdf' ? 'pdf' : 'image' })),
        theme: ['sunset', 'ocean', 'forest', 'night', 'rose'].includes(rec.theme) ? rec.theme : 'sunset',
        openedAt: null, notifiedAt: null, extendedCount: 0 };
      const all = load('lms_capsules', []); all.push(out); save('lms_capsules', all);
      return out;
    },
    updateCapsule: (userId, id, patch) => {
      DB.capsuleOwnerGuard(userId);
      const all = load('lms_capsules', []);
      const i = all.findIndex(c => c.id === id && c.userId === userId);
      if (i < 0) throw new Error('Kapsul tidak ditemukan.');
      const cur = all[i];
      const next = Object.assign({}, cur);
      if (patch.openAt != null) {
        const v = Number(patch.openAt);
        if (cur.openAt <= Date.now()) throw new Error('Kapsul yang sudah terbuka tidak dapat dikunci ulang.');
        if (!(v > cur.openAt)) throw new Error('Tanggal pembukaan hanya dapat diundur, tidak dimajukan.');
        next.openAt = v; next.extendedCount = (cur.extendedCount || 0) + 1;
      }
      if (patch.openedAt) {
        if (cur.openAt > Date.now()) throw new Error('Kapsul belum waktunya dibuka.');
        next.openedAt = cur.openedAt || Date.now();
      }
      if (patch.notifiedAt) next.notifiedAt = cur.notifiedAt || Date.now();
      all[i] = next; save('lms_capsules', all);
      return next;
    },
    deleteCapsule: (userId, id) => {
      DB.capsuleOwnerGuard(userId);
      save('lms_capsules', load('lms_capsules', []).filter(c => !(c.id === id && c.userId === userId)));
    },
    /** Ringkasan operasional untuk admin: TANPA judul/isi/ciphertext. */
    capsuleStats: (actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin.');
      const now = Date.now();
      const caps = load('lms_capsules', []);
      const vaults = load('lms_capsule_vaults', []);
      return getAll(KEYS.users).filter(u => u.role === 'siswa').map(u => {
        const mine = caps.filter(c => c.userId === u.id);
        const v = vaults.find(x => x.userId === u.id);
        return { userId: u.id, name: u.name, kelas: u.kelas || '', hasVault: !!v,
          lockedOut: !!(v && v.lockUntil && v.lockUntil > now),
          total: mine.length, locked: mine.filter(c => c.openAt > now).length,
          ready: mine.filter(c => c.openAt <= now && !c.openedAt).length, opened: mine.filter(c => c.openedAt).length,
          nextOpen: mine.filter(c => c.openAt > now).map(c => c.openAt).sort((a, b) => a - b)[0] || null,
          approxBytes: mine.reduce((n, c) => n + JSON.stringify(c.encBody).length, 0) };
      });
    },
    /** Dipanggil saat dashboard dibuka: notifikasi surat yang sudah dapat dibaca. */
    notifyReadyCapsules: (userId) => {
      const actor = sessionActor();
      if (!actor || actor.id !== userId) return 0;
      const now = Date.now();
      const all = load('lms_capsules', []);
      let n = 0;
      all.forEach(c => {
        if (c.userId === userId && c.openAt <= now && !c.notifiedAt) {
          c.notifiedAt = now; n++;
          DB.addNotification({ userId, icon: '💌', title: 'Surat masa depanmu sudah dapat dibuka',
            body: `Kapsul yang kamu tulis pada ${new Date(c.createdAt).toLocaleDateString('id-ID')} kini dapat dibaca di Mesin Waktu.`, link: 'mesin-waktu' });
        }
      });
      if (n) save('lms_capsules', all);
      return n;
    },

    /* ---------- Musik latar (metadata; berkas audio di IndexedDB) ---------- */
    MUSIC_MOODS: [
      { key: 'fokus', label: 'Fokus', icon: '🎯' }, { key: 'santai', label: 'Santai', icon: '🌿' },
      { key: 'semangat', label: 'Semangat', icon: '🔥' }, { key: 'tenang', label: 'Tenang', icon: '🌙' }
    ],
    getMusicTracks: () => load('lms_music_tracks', []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    saveMusicTrack: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola musik.');
      const title = String(rec.title || '').trim();
      if (title.length < 1 || title.length > 120) throw new Error('Judul lagu 1–120 karakter.');
      const artist = String(rec.artist || '').trim();
      if (artist.length < 1 || artist.length > 120) throw new Error('Nama artis/pencipta wajib diisi.');
      if (!rec.rights || !rec.rights.confirmed || String(rec.rights.license || '').trim().length < 3) {
        throw new Error('Konfirmasi hak penggunaan dan isi jenis lisensi.');
      }
      if (!DB.MUSIC_MOODS.some(m => m.key === rec.mood)) throw new Error('Pilih suasana musik.');
      const list = load('lms_music_tracks', []);
      const clean = { title, artist, mood: rec.mood, cover: String(rec.cover || ''), mime: String(rec.mime || ''),
        size: Number(rec.size) || 0, duration: Number(rec.duration) || 0, fileName: String(rec.fileName || '').slice(0, 160),
        rights: { confirmed: true, license: String(rec.rights.license).trim().slice(0, 120), source: String(rec.rights.source || '').trim().slice(0, 300) },
        active: rec.active !== false, updatedAt: Date.now(), blobKey: String(rec.blobKey || '') };
      if (!clean.blobKey) throw new Error('Berkas audio belum diunggah.');
      let out;
      const i = rec.id ? list.findIndex(t => t.id === rec.id) : -1;
      if (i >= 0) out = list[i] = Object.assign({}, list[i], clean);
      else { out = Object.assign({ id: uid('trk'), createdAt: Date.now(), createdBy: actor.id, order: list.length }, clean); list.push(out); }
      save('lms_music_tracks', list);
      DB.logActivity('music.save', `Menyimpan musik "${title}" (${clean.rights.license})`, out.id);
      return out;
    },
    deleteMusicTrack: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola musik.');
      const t = load('lms_music_tracks', []).find(x => x.id === id);
      save('lms_music_tracks', load('lms_music_tracks', []).filter(x => x.id !== id));
      if (DB.getSettings().musicMainTrackId === id) DB.setSetting('musicMainTrackId', '');
      DB.logActivity('music.delete', `Menghapus musik "${t ? t.title : id}"`, id);
      return t;
    },
    moveMusicTrack: (id, dir, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Hanya admin yang dapat mengelola musik.');
      const list = DB.getMusicTracks();
      const i = list.findIndex(t => t.id === id);
      const j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      list.forEach((t, k) => { t.order = k; });
      save('lms_music_tracks', list);
    },

    /** Migrasi skema idempoten (mode server: dipanggil setelah data server dimuat). */
    runMigrations: () => runMigrations(),
    isServerMode: () => SERVER_MODE,

    resetAll: () => {
      // Mode server: JANGAN menghapus data bersama. Cukup bersihkan cache perangkat ini.
      if (SERVER_MODE) { global.Sync.resetLocalCache(); return; }
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      ['lms_seeded_v1', 'lms_seeded_v2'].forEach(k => localStorage.removeItem(k));
      EXTRA_KEYS.forEach(k => localStorage.removeItem(k));
      // Draft tugas memakai key per siswa+tugas, jadi bersihkan berdasarkan prefix.
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && /^lms_(assignment_draft|wb_pref|music_pref|streak_reminded|arena_state):/.test(k)) localStorage.removeItem(k);
      }
      seedIfNeeded();
      runMigrations();
      if (global.BlobStore) BlobStore.clearAll().catch(() => {});
    }
  };

  global.DB = DB;
})(window);
