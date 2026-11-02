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
    cbts: 'lms_cbts',
    cbtAttempts: 'lms_cbt_attempts',
    attendance: 'lms_attendance',
    payments: 'lms_payments',
    expenses: 'lms_expenses',
    salaries: 'lms_salaries',
    notifications: 'lms_notifications',
    classPlans: 'lms_class_plans',
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
    'lms_hub_courses', 'lms_hub_progress', 'lms_capsule_vaults', 'lms_capsules',
    'lms_music_tracks'
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
  const QUESTION_TYPES = ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Esai', 'Benar/Salah', 'Majemuk Kompleks'];
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
                 criteria: 'Menuntaskan 1 ronde game edukasi dengan skor minimal yang ditentukan.' }
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
    { key: 'denda',        label: 'Denda Siswa',       icon: '⚠️', fine: true  },
    { key: 'lainnya',      label: 'Pemasukan Lain',    icon: '💼', fine: false }
  ];
  const FINE_REASONS = [
    'Terlambat membayar SPP',
    'Terlambat masuk kelas',
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

  /* ===== Migrasi skema =====
   * Versi skema TERPISAH dari penanda seed. Menaikkan penanda seed akan
   * menghapus seluruh data pengguna, sedangkan migrasi ini hanya menambah
   * field yang belum ada (idempoten) sehingga data lama tetap utuh. */
  const SCHEMA_KEY = 'lms_schema_version';
  const SCHEMA_VERSION = 3;

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
        title: 'Kelas 11-A • Pengetahuan Kuantitatif (PK) — Bu Maria Simbolon',
        description: 'Kelas Pengetahuan Kuantitatif untuk Kelas 11-A. Fokus aljabar, barisan, dan logika bilangan.',
        category: 'TPS', price: 500000, password: 'pk2026',
        schedule: { days: ['Senin', 'Kamis'], time: '16:00', endTime: '17:30', startDate: ymdOf(now), sessions: 16 },
        meetingLink: 'https://meet.google.com/abc-defg-hij',
        createdAt: now - DAY * 10 },

      { id: 'c_pk_11b', subtest: SUBTESTS[3].name, label: '',
        mainClasses: ['Kelas 11-B'], teacherIds: ['u_guru2'], teacherId: 'u_guru2',
        title: 'Kelas 11-B • Pengetahuan Kuantitatif (PK) — Bu Irana Dewi',
        description: 'Kelas Pengetahuan Kuantitatif untuk Kelas 11-B dengan pendekatan latihan intensif.',
        category: 'TPS', price: 500000, password: '',
        schedule: { days: ['Selasa', 'Jumat'], time: '16:00', endTime: '17:30', startDate: ymdOf(now), sessions: 16 },
        meetingLink: 'https://zoom.us/j/1234567890',
        createdAt: now - DAY * 9 },

      { id: 'c_pu_12', subtest: SUBTESTS[0].name, label: 'Gabungan',
        mainClasses: ['Kelas 12-A'], teacherIds: ['u_guru3', 'u_guru1'], teacherId: 'u_guru3',
        title: 'Kelas 12-A • Penalaran Umum (PU) — Pak Budi & Bu Maria',
        description: 'Kelas Penalaran Umum gabungan dua tutor untuk Kelas 12-A.',
        category: 'TPS', price: 550000, password: '',
        schedule: { days: ['Rabu'], time: '19:00', endTime: '20:30', startDate: ymdOf(now), sessions: 12 },
        meetingLink: 'https://meet.google.com/xyz-1234-abc',
        createdAt: now - DAY * 8 },

      { id: 'c_lbind_10', subtest: SUBTESTS[4].name, label: '',
        mainClasses: ['Kelas 10-A'], teacherIds: ['u_guru4'], teacherId: 'u_guru4',
        title: 'Kelas 10-A • Literasi dalam Bahasa Indonesia — Bu Sari Wulandari',
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
        { courseId: 'c_pu_12', teacherId: 'u_guru3', offset: 2, time: '19:00', endTime: '20:30',
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
  const HUB_QTYPES = ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Benar/Salah', 'Isian Singkat',
    'Majemuk Kompleks', 'Menjodohkan', 'Urutan', 'Esai'];
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
    } else if (t === 'Majemuk Kompleks') {
      if ((q.statements || []).filter(x => x && hubFilled(x.text)).length < 2) return 'minimal 2 pernyataan';
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
    if (t === 'Majemuk Kompleks') return Array.isArray(a) ? (q.statements || []).map((_, i) => (a[i] === true ? true : a[i] === false ? false : null)) : [];
    if (t === 'Menjodohkan') return Array.isArray(a) ? (q.pairs || []).map((_, i) => clip(a[i], 2000)) : [];
    if (t === 'Urutan') return Array.isArray(a) ? a.slice(0, 60).map(v => clip(v, 2000)) : [];
    return null;
  }
  function hubAnswered(q, a) {
    const t = hubQType(q);
    if (t === 'Pilihan Ganda' || t === 'Benar/Salah') return a != null;
    if (t === 'Pilihan Lebih dari Satu') return Array.isArray(a) && a.length > 0;
    if (t === 'Isian Singkat' || t === 'Esai') return String(a || '').trim().length > 0;
    if (t === 'Majemuk Kompleks') return Array.isArray(a) && a.length > 0 && a.every(v => v === true || v === false);
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

  const DB = {
    KEYS, uid, periodKey,

    /* ===== Konstanta bersama ===== */
    SUBTESTS, SUBTEST_NAMES, QUESTION_TYPES, DIFFICULTIES, ALL_CLASSES,
    subtestByName, subtestOrder, DAY_NAMES, PLAN_STATUS, ymdOf,
    PAYMENT_KINDS, FINE_REASONS, CONTENT_KINDS,

    /* ===== Pengaturan aplikasi ===== */
    getSettings: () => Object.assign({
      loginQuizEnabled: true, loginQuizRoles: ['siswa'], loginQuizAttempts: 3,
      motivationEnabled: true, planFillLead: PLAN_FILL_LEAD, planConfirmLead: PLAN_CONFIRM_LEAD,
      appName: 'LMS Rubela', appTagline: 'Learning Management System', appLogo: '',
      /* ===== Integrasi AI =====
       * Kunci API TIDAK pernah ikut tersimpan di repositori. Admin mengisinya
       * lewat Pengaturan, lalu disimpan pada localStorage browser masing-masing.
       */
      aiEnabled: true,
      aiProvider: 'gemini',          // penyedia utama: gemini | groq | mistral | openrouter | custom
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
      aiTimeoutMs: 30000,
      tinyfishApiKey: '',
      tinyfishEndpoint: '',
      /* ===== Kehadiran ===== */
      attendanceThreshold: 75,
      attendanceExcusedPolicy: 'count',
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
    /** Nama tampilan kelas: "Kelas 11-A • PK — Bu Maria" (dibangun bila kosong). */
    courseTitle: (course) => {
      if (!course) return '-';
      if (course.title && course.title.trim()) return course.title;
      const st = subtestByName(course.subtest);
      const mains = (course.mainClasses || []).join(', ');
      const tutors = DB.courseTeachers(course).map(t => t.name).join(' & ');
      return [mains, st ? st.short : course.subtest, tutors].filter(Boolean).join(' • ');
    },
    /** Ringkasan jadwal: "Senin, Kamis • 16:00–17:30". */
    courseScheduleLabel: (course) => {
      const s = course && course.schedule;
      if (!s) return '-';
      const days = (s.days || []).join(', ');
      const time = s.time ? (s.endTime ? `${s.time}–${s.endTime}` : s.time) : '';
      return [days, time].filter(Boolean).join(' • ') || '-';
    },

    /* ===== Enrolment berbasis kelas utama ===== */
    /** Daftarkan seluruh siswa pada satu kelas utama ke sebuah kelas subtest. */
    enrollMainClass: (courseId, kelas) => {
      let added = 0;
      DB.getStudentsByMainClass(kelas).forEach(s => {
        if (!DB.isEnrolled(courseId, s.id)) { DB.enroll(courseId, s.id); added++; }
      });
      return added;
    },
    unenrollMainClass: (courseId, kelas) => {
      let removed = 0;
      DB.getStudentsByMainClass(kelas).forEach(s => {
        if (DB.isEnrolled(courseId, s.id)) { DB.unenroll(courseId, s.id); removed++; }
      });
      return removed;
    },
    /** Samakan daftar kelas utama sebuah kelas subtest dengan enrolmennya. */
    syncCourseMainClasses: (courseId, mainClasses) => {
      const course = findById(KEYS.courses, courseId);
      if (!course) return null;
      const next = [...new Set(mainClasses || [])];
      const prev = course.mainClasses || [];
      prev.filter(k => !next.includes(k)).forEach(k => DB.unenrollMainClass(courseId, k));
      let added = 0;
      next.forEach(k => { added += DB.enrollMainClass(courseId, k); });
      update(KEYS.courses, courseId, { mainClasses: next });
      return { added, mainClasses: next };
    },

    /* ===== War Jadwal Kelas (rencana kelas) ===== */
    getClassPlans: () => getAll(KEYS.classPlans),
    getClassPlan: (id) => findById(KEYS.classPlans, id),
    getClassPlansByCourse: (cid) => getAll(KEYS.classPlans).filter(p => p.courseId === cid),
    getClassPlansByTeacher: (tid) => getAll(KEYS.classPlans).filter(p => p.teacherId === tid),
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
    addClassPlan: (p) => add(KEYS.classPlans, Object.assign({
      status: 'draft', topic: '', note: '', meetingLink: '',
      confirmedAt: null, createdAt: Date.now(), updatedAt: Date.now()
    }, p)),
    updateClassPlan: (id, patch) => update(KEYS.classPlans, id, Object.assign({ updatedAt: Date.now() }, patch)),
    deleteClassPlan: (id) => remove(KEYS.classPlans, id),
    /** Validasi tutor: tandai rencana sebagai FIX. */
    confirmClassPlan: (id) => update(KEYS.classPlans, id, {
      status: 'fixed', confirmedAt: Date.now(), updatedAt: Date.now()
    }),

    /** Rencana kelas pada satu tanggal untuk satu kelas (null bila tak ada). */
    getPlanForCourseDate: (cid, ymd) =>
      getAll(KEYS.classPlans).find(p => p.courseId === cid && p.date === ymd) || null,

    /**
     * Tutor yang bertugas mengajar kelas ini pada tanggal tertentu.
     * Satu pertemuan hanya diajar satu tutor, jadi rencana kelas (War Jadwal)
     * adalah sumber kebenarannya. Bila belum ada rencana, jatuh ke tutor
     * pertama kelas agar presensi tetap bisa diambil.
     */
    sessionTeacher: (course, ymd) => {
      if (!course) return null;
      const plan = DB.getPlanForCourseDate(course.id, ymd);
      if (plan && plan.teacherId) {
        const u = findById(KEYS.users, plan.teacherId);
        if (u) return { user: u, plan, scheduled: true };
      }
      const first = DB.courseTeachers(course)[0] || null;
      return first ? { user: first, plan: plan || null, scheduled: false } : null;
    },

    /** Bolehkah pengguna memvalidasi / mengubah rencana kelas ini? */
    canManagePlan: (user, plan) => {
      if (!user || !plan) return false;
      if (user.role === 'admin') return true;
      if (user.role !== 'guru') return false;
      return plan.teacherId === user.id;
    },
    /** Selisih hari dari hari ini ke tanggal rencana (negatif = sudah lewat). */
    planDaysAhead: (ymd) => {
      if (!ymd) return 0;
      const today = new Date(DB.ymdOf(Date.now()) + 'T00:00:00');
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
    findUserByUsername: (u) => getAll(KEYS.users).find(x => x.username.toLowerCase() === String(u).toLowerCase()) || null,
    addUser: (u) => {
      const rec = add(KEYS.users, u);
      DB.logActivity('user.add', `Menambah akun ${u.role || ''} "${u.name || u.username}"`, u.id);
      return rec;
    },
    updateUser: (id, p) => {
      const rec = update(KEYS.users, id, p);
      // Pembaruan profil kecil (mis. lastSeen) tidak perlu dicatat.
      const keys = Object.keys(p || {}).filter(k => !['lastSeen', 'lastLogin'].includes(k));
      if (rec && keys.length) DB.logActivity('user.update', `Memperbarui akun "${rec.name}" (${keys.join(', ')})`, id);
      return rec;
    },
    deleteUser: (id) => {
      const victim = findById(KEYS.users, id);
      if (victim) DB.logActivity('user.delete', `Menghapus akun ${victim.role} "${victim.name}"`, id);
      const user = findById(KEYS.users, id);
      if (user && user.role === 'guru') {
        // Lepas guru dari kelas; kelas hanya dihapus bila tak ada tutor lain
        getAll(KEYS.courses).forEach(c => {
          const ids = DB.courseTeacherIds(c);
          if (!ids.includes(id)) return;
          const rest = ids.filter(x => x !== id);
          if (rest.length === 0) DB.deleteCourse(c.id);
          else update(KEYS.courses, c.id, { teacherIds: rest, teacherId: rest[0] });
        });
        setAll(KEYS.classPlans, getAll(KEYS.classPlans).filter(pl => pl.teacherId !== id));
        setAll(KEYS.salaries, getAll(KEYS.salaries).filter(s => s.teacherId !== id));
        setAll(KEYS.attendance, getAll(KEYS.attendance).filter(a => a.userId !== id));
        setAll(KEYS.questions, getAll(KEYS.questions).filter(q => q.authorId !== id));
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
        // Kapsul terenkripsi ikut dihapus (tidak ada yang dapat membukanya lagi).
        save('lms_capsules', load('lms_capsules', []).filter(c => c.userId !== id));
        save('lms_capsule_vaults', load('lms_capsule_vaults', []).filter(v => v.userId !== id));
        if (global.BlobStore) BlobStore.removePrefix('cap:' + id + ':').catch(() => {});
        // Keep orang tua accounts consistent: drop the link to this child.
        getAll(KEYS.users)
          .filter(u => u.role === 'orangtua' && Array.isArray(u.childIds) && u.childIds.includes(id))
          .forEach(p => update(KEYS.users, p.id, { childIds: p.childIds.filter(c => c !== id) }));
      }
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
    getCourses: () => getAll(KEYS.courses),
    getCourse: (id) => findById(KEYS.courses, id),
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
    getCoursesByTeacher: (tid) => getAll(KEYS.courses).filter(c => DB.courseTeacherIds(c).includes(tid)),
    addCourse: (c) => {
      const rec = Object.assign({ createdAt: Date.now(), mainClasses: [], teacherIds: [] }, c);
      if ((!rec.teacherIds || !rec.teacherIds.length) && rec.teacherId) rec.teacherIds = [rec.teacherId];
      if (rec.teacherIds && rec.teacherIds.length) rec.teacherId = rec.teacherIds[0];
      const created = add(KEYS.courses, rec);
      // Langsung daftarkan siswa dari kelas utama yang dipilih
      (created.mainClasses || []).forEach(k => DB.enrollMainClass(created.id, k));
      return created;
    },
    updateCourse: (id, p) => {
      const patch = Object.assign({}, p);
      if (Array.isArray(patch.teacherIds)) patch.teacherId = patch.teacherIds[0] || null;
      return update(KEYS.courses, id, patch);
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
      setAll(KEYS.whiteboards, getAll(KEYS.whiteboards).filter(w => w.courseId !== id));
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
      if (id) {
        const u = findById(KEYS.users, id);
        if (u) return u.name;
        return 'Tutor tidak ditemukan';
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
      if (rec && rec.enteredBy && rec.enteredBy !== rec.createdBy) {
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
      if (!owner) return course ? DB.courseTeacherIds(course).includes(user.id) : true;
      return owner === user.id;
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
    enroll: (cid, sid) => {
      if (DB.isEnrolled(cid, sid)) return null;
      return add(KEYS.enrollments, { courseId: cid, studentId: sid, enrolledAt: Date.now() });
    },
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
      // Remove this question from any CBTs that reference it
      const cbts = getAll(KEYS.cbts).map(c => Object.assign({}, c, { questionIds: (c.questionIds || []).filter(qid => qid !== id) }));
      setAll(KEYS.cbts, cbts);
      remove(KEYS.questions, id);
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
      setAll(KEYS.cbtAttempts, getAll(KEYS.cbtAttempts).filter(a => a.cbtId !== id));
      remove(KEYS.cbts, id);
    },
    /** Apakah sebuah CBT ditujukan untuk siswa ini?
     * Cocok bila: targetClasses memuat ALL_CLASSES, memuat kelas (tingkat)
     * siswa, atau siswa terdaftar di salah satu kelas mata pelajaran tujuan.
     */
    cbtTargetsStudent: (cbt, student) => {
      if (!cbt || !student) return false;
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
      return getAll(KEYS.cbts).filter(c => DB.cbtTargetsStudent(c, student)).filter(c => {
        if (tried.has(c.id)) return true;
        if (c.active === false) return false;
        const course = c.courseId ? findById(KEYS.courses, c.courseId) : null;
        return !course || !DB.isEnrolled(course.id, studentId) || DB.contentVisibleToStudent(c, course, studentId);
      });
    },
    /** Daftar kelas (tingkat) tujuan dalam bentuk teks siap tampil. */
    cbtTargetLabel: (cbt) => {
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

    /* ===== Whiteboard per kelas ===== */
    getWhiteboards: () => getAll(KEYS.whiteboards),
    getWhiteboard: (courseId) => getAll(KEYS.whiteboards).find(w => w.courseId === courseId) || null,
    saveWhiteboard: (courseId, state, actor) => {
      const course = findById(KEYS.courses, courseId);
      if (!course || !DB.canEditWhiteboard(actor, course)) {
        throw new Error('Aktor tidak berhak mengubah whiteboard kelas ini.');
      }
      const list = getAll(KEYS.whiteboards);
      const i = list.findIndex(w => w.courseId === courseId);
      const prev = i >= 0 ? list[i] : null;
      const rec = Object.assign({
        id: prev ? prev.id : uid('wb'), courseId, schemaVersion: 1,
        strokes: [], revision: 0, createdAt: prev ? prev.createdAt : Date.now()
      }, prev || {}, state || {}, {
        courseId,
        revision: Math.max(Number(prev && prev.revision) || 0, Number(state && state.revision) || 0) + 1,
        updatedAt: Date.now(), updatedBy: actor && actor.id ? actor.id : null
      });
      if (i >= 0) list[i] = rec; else list.push(rec);
      save(KEYS.whiteboards, list);
      return rec;
    },
    /* Riwayat versi & papan tersimpan per kelas.
     * { id, courseId, type:'version'|'board', name, auto, createdAt, createdBy,
     *   objects:[...], board:{w,h,bg,template} }
     * Batas: 15 versi + 20 papan per kelas agar localStorage tidak penuh. */
    getWhiteboardSaves: (courseId, type) => load('lms_whiteboard_boards', [])
      .filter(x => x.courseId === courseId && (!type || x.type === type))
      .sort((a, b) => b.createdAt - a.createdAt),
    addWhiteboardSave: (courseId, entry, actor) => {
      const course = findById(KEYS.courses, courseId);
      if (!course || !DB.canEditWhiteboard(actor, course)) throw new Error('Hanya admin/tutor kelas yang dapat menyimpan papan.');
      const type = entry.type === 'board' ? 'board' : 'version';
      const name = String(entry.name || '').trim().slice(0, 80) || (type === 'board' ? 'Papan tanpa judul' : 'Versi otomatis');
      const rec = {
        id: uid('wbs'), courseId, type, name, auto: !!entry.auto,
        createdAt: Date.now(), createdBy: actor.id,
        objects: JSON.parse(JSON.stringify(entry.objects || [])),
        board: Object.assign({}, entry.board || {})
      };
      let list = load('lms_whiteboard_boards', []);
      list.push(rec);
      const LIMIT = { version: 15, board: 20 };
      const mine = list.filter(x => x.courseId === courseId && x.type === type).sort((a, b) => b.createdAt - a.createdAt);
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
    getAttendanceRecord: (cid, uid, date) =>
      getAll(KEYS.attendance).find(a => a.courseId === cid && a.userId === uid && a.date === date) || null,
    upsertAttendance: (cid, uid, role, date, status, note) => {
      // Validasi: hanya status resmi yang boleh disimpan.
      if (!ATT_KEYS.includes(status)) throw new Error('Status presensi tidak dikenal: ' + status);
      const existing = DB.getAttendanceRecord(cid, uid, date);
      if (existing) return update(KEYS.attendance, existing.id, { role, status, note: note || '' });
      return add(KEYS.attendance, { courseId: cid, userId: uid, role, date, status, note: note || '', createdAt: Date.now() });
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
    isCancelledSession: (courseId, ymd) => {
      const pl = getAll(KEYS.classPlans).find(p => p.courseId === courseId && p.date === ymd);
      return !!(pl && pl.status === 'cancelled');
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
      const cancelledSet = new Set(getAll(KEYS.classPlans)
        .filter(p => p.status === 'cancelled').map(p => p.courseId + '|' + p.date));
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

    /* ===== Feedback (Kritik & Saran) ===== */
    getFeedbacks: () => {
      try { return JSON.parse(localStorage.getItem('lms_feedbacks') || '[]'); } catch(e) { return []; }
    },
    addFeedback: (fb) => {
      const list = JSON.parse(localStorage.getItem('lms_feedbacks') || '[]');
      if (!fb.id) fb.id = uid('fb');
      fb.createdAt = Date.now();
      list.push(fb);
      localStorage.setItem('lms_feedbacks', JSON.stringify(list));
      return fb;
    },
    deleteFeedback: (id) => {
      const list = JSON.parse(localStorage.getItem('lms_feedbacks') || '[]').filter(f => f.id !== id);
      localStorage.setItem('lms_feedbacks', JSON.stringify(list));
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
      return b;
    },
    updateBatch: (id, patch) => {
      const list = JSON.parse(localStorage.getItem('lms_batches') || '[]');
      const idx = list.findIndex(b => b.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      localStorage.setItem('lms_batches', JSON.stringify(list));
      return list[idx];
    },
    deleteBatch: (id) => {
      const list = JSON.parse(localStorage.getItem('lms_batches') || '[]').filter(b => b.id !== id);
      localStorage.setItem('lms_batches', JSON.stringify(list));
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
    addMessage: (msg) => {
      const list = JSON.parse(localStorage.getItem('lms_messages') || '[]');
      if (!msg.id) msg.id = uid('msg');
      msg.createdAt = Date.now();
      list.push(msg);
      localStorage.setItem('lms_messages', JSON.stringify(list));
      return msg;
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
    getNotifications: (userId) => getAll(KEYS.notifications)
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt),
    getUnreadCount: (userId) => getAll(KEYS.notifications).filter(n => n.userId === userId && !n.read).length,
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
      const list = getAll(KEYS.notifications).map(n => (n.userId === userId ? Object.assign({}, n, { read: true }) : n));
      setAll(KEYS.notifications, list);
    },
    clearNotifications: (userId) => {
      setAll(KEYS.notifications, getAll(KEYS.notifications).filter(n => n.userId !== userId));
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
      DB.logActivity('content.reactivate', `Mengaktifkan ulang ${kind} "${rec.title || id}" untuk siswa baru`, id);
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
    saveHubCourse: (rec, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      const title = String(rec.title || '').trim();
      if (title.length < 3 || title.length > 140) throw new Error('Judul course 3–140 karakter.');
      const sections = Array.isArray(rec.sections) ? rec.sections : [];
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
      const list = load('lms_hub_courses', []);
      const now = Date.now();
      const inact = Number(rec.inactivityDays);
      const clean = Object.assign({}, rec, {
        title, subtitle: String(rec.subtitle || '').trim().slice(0, 240),
        category: String(rec.category || '').trim().slice(0, 60), level: String(rec.level || '').slice(0, 30),
        outcomes: (rec.outcomes || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        requirements: (rec.requirements || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12),
        enrollMode: rec.enrollMode === 'assigned' ? 'assigned' : 'open',
        newStudentPolicy: rec.newStudentPolicy === 'fromJoin' ? 'fromJoin' : 'all',
        sequential: rec.sequential === 'lesson' || rec.sequential === 'section' ? rec.sequential : 'off',
        inactivityDays: rec.inactivityDays == null || rec.inactivityDays === '' || !isFinite(inact)
          ? HUB_DEFAULT_INACTIVE_DAYS : Math.max(0, Math.min(365, Math.round(inact))),
        color: /^#[0-9a-f]{6}$/i.test(String(rec.color || '')) ? rec.color : '#4f46e5',
        active: rec.active !== false, updatedAt: now
      });
      let out;
      const i = rec.id ? list.findIndex(c => c.id === rec.id) : -1;
      if (i >= 0) out = list[i] = Object.assign({}, list[i], clean);
      else { out = Object.assign({ createdAt: now, createdBy: actor.id }, clean, { id: rec.id || uid('hub') }); list.push(out); }
      save('lms_hub_courses', list);
      DB.logActivity('hub.save', `Menyimpan course "${title}"`, out.id);
      return out;
    },
    deleteHubCourse: (id, actor) => {
      if (!actor || actor.role !== 'admin') throw new Error('Course hanya dapat dikelola admin.');
      save('lms_hub_courses', load('lms_hub_courses', []).filter(c => c.id !== id));
      save('lms_hub_progress', load('lms_hub_progress', []).filter(p => p.courseId !== id));
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
