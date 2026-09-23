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
    'lms_announcements', 'lms_messages'
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

  seedIfNeeded();

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
      geminiApiKey: '',
      geminiModel: 'gemini-flash-latest',
      aiTimeoutMs: 30000,
      tinyfishApiKey: '',
      tinyfishEndpoint: '',
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
    addUser: (u) => add(KEYS.users, u),
    updateUser: (id, p) => update(KEYS.users, id, p),
    deleteUser: (id) => {
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
        // Keep orang tua accounts consistent: drop the link to this child.
        getAll(KEYS.users)
          .filter(u => u.role === 'orangtua' && Array.isArray(u.childIds) && u.childIds.includes(id))
          .forEach(p => update(KEYS.users, p.id, { childIds: p.childIds.filter(c => c !== id) }));
      }
      // Messages + notifications belonging to the removed account
      setAll(KEYS.notifications, getAll(KEYS.notifications).filter(n => n.userId !== id));
      try {
        const msgs = JSON.parse(localStorage.getItem('lms_messages') || '[]')
          .filter(m => m.senderId !== id && m.receiverId !== id);
        localStorage.setItem('lms_messages', JSON.stringify(msgs));
      } catch (e) { /* noop */ }
      remove(KEYS.users, id);
    },

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
    addRecording: (r) => add(KEYS.recordings, Object.assign({ recordedAt: Date.now() }, r)),
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
      return getAll(KEYS.cbts).filter(c => DB.cbtTargetsStudent(c, student));
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

    /* ===== Attendance ===== */
    getAttendance: () => getAll(KEYS.attendance),
    getAttendanceByCourse: (cid) => getAll(KEYS.attendance).filter(a => a.courseId === cid),
    getAttendanceByUser: (uid) => getAll(KEYS.attendance).filter(a => a.userId === uid),
    getAttendanceByCourseDate: (cid, date) => getAll(KEYS.attendance).filter(a => a.courseId === cid && a.date === date),
    getAttendanceRecord: (cid, uid, date) =>
      getAll(KEYS.attendance).find(a => a.courseId === cid && a.userId === uid && a.date === date) || null,
    upsertAttendance: (cid, uid, role, date, status, note) => {
      const existing = DB.getAttendanceRecord(cid, uid, date);
      if (existing) return update(KEYS.attendance, existing.id, { role, status, note: note || '' });
      return add(KEYS.attendance, { courseId: cid, userId: uid, role, date, status, note: note || '', createdAt: Date.now() });
    },
    deleteAttendance: (id) => remove(KEYS.attendance, id),

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

    resetAll: () => {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      ['lms_seeded_v1', 'lms_seeded_v2'].forEach(k => localStorage.removeItem(k));
      EXTRA_KEYS.forEach(k => localStorage.removeItem(k));
      seedIfNeeded();
    }
  };

  global.DB = DB;
})(window);
