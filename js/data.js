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
    session: 'lms_session',
    seeded: 'lms_seeded_v4'
  };

  /* Extra localStorage keys that are not part of the main entity map but must
   * still be cleared on reset / re-seed so everything stays in sync. */
  const EXTRA_KEYS = [
    'lms_class_options', 'lms_events', 'lms_batches', 'lms_feedbacks',
    'lms_announcements', 'lms_messages'
  ];

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

  function seedIfNeeded() {
    // Migrate: wipe any older seed version so new demo entities (orang tua,
    // password kelas, notifikasi) are created consistently.
    const OLD_SEEDS = ['lms_seeded_v1', 'lms_seeded_v2', 'lms_seeded_v3'];
    const staleSeed = OLD_SEEDS.find(k => localStorage.getItem(k) === '1');
    if (staleSeed && localStorage.getItem(KEYS.seeded) !== '1') {
      Object.keys(KEYS).forEach(k => localStorage.removeItem(KEYS[k]));
      EXTRA_KEYS.forEach(k => localStorage.removeItem(k));
      OLD_SEEDS.forEach(k => localStorage.removeItem(k));
    }
    if (localStorage.getItem(KEYS.seeded) === '1') return;

    const now = Date.now();
    const DAY = 86400000;

    const users = [
      { id: 'u_admin', role: 'admin', username: 'admin', password: 'admin123', name: 'Administrator', email: 'admin@rubela.edu' },
      { id: 'u_guru1', role: 'guru', username: 'guru1', password: 'guru123', name: 'Pak Budi Santoso', email: 'budi@rubela.edu', subject: 'Matematika', salaryRate: 3000000 },
      { id: 'u_guru2', role: 'guru', username: 'guru2', password: 'guru123', name: 'Bu Sari Wulandari', email: 'sari@rubela.edu', subject: 'Bahasa Indonesia', salaryRate: 2800000 },
      { id: 'u_siswa1', role: 'siswa', username: 'siswa1', password: 'siswa123', name: 'Andi Pratama', email: 'andi@siswa.edu', kelas: 'X-A',
        targetUniv: 'Universitas Indonesia', targetMajor: 'Teknik Informatika', phone: '081200000001' },
      { id: 'u_siswa2', role: 'siswa', username: 'siswa2', password: 'siswa123', name: 'Dewi Anggraini', email: 'dewi@siswa.edu', kelas: 'X-A',
        targetUniv: 'Institut Teknologi Bandung', targetMajor: 'Teknik Elektro', phone: '081200000002' },
      { id: 'u_siswa3', role: 'siswa', username: 'siswa3', password: 'siswa123', name: 'Rendy Kurniawan', email: 'rendy@siswa.edu', kelas: 'X-B',
        targetUniv: 'Universitas Gadjah Mada', targetMajor: 'Kedokteran', phone: '081200000003' },
      // Orang tua / wali: memantau perkembangan anak (childIds -> id siswa)
      { id: 'u_ortu1', role: 'orangtua', username: 'ortu1', password: 'ortu123', name: 'Bapak Hendra Pratama', email: 'hendra@wali.edu',
        phone: '081300000001', relation: 'Ayah', childIds: ['u_siswa1'] },
      { id: 'u_ortu2', role: 'orangtua', username: 'ortu2', password: 'ortu123', name: 'Ibu Ratna Anggraini', email: 'ratna@wali.edu',
        phone: '081300000002', relation: 'Ibu', childIds: ['u_siswa2', 'u_siswa3'] }
    ];

    const courses = [
      { id: 'c_mat1', title: 'Matematika Dasar', description: 'Pengantar aljabar dan operasi bilangan.', teacherId: 'u_guru1', category: 'Matematika', price: 500000, password: 'mat2026', createdAt: now - DAY * 10 },
      { id: 'c_bind1', title: 'Bahasa Indonesia', description: 'Tata bahasa, menulis, dan apresiasi sastra.', teacherId: 'u_guru2', category: 'Bahasa', price: 450000, password: '', createdAt: now - DAY * 7 }
    ];

    const materials = [
      { id: 'm_1', courseId: 'c_mat1', title: 'Bilangan Bulat', content: 'Bilangan bulat meliputi bilangan positif, nol, dan negatif. Operasi dasar: + - x :.', link: '', createdAt: now - DAY * 8 },
      { id: 'm_2', courseId: 'c_mat1', title: 'Persamaan Linear', content: 'Bentuk umum ax + b = 0. Pelajari cara mencari nilai x.', link: '', createdAt: now - DAY * 5 },
      { id: 'm_3', courseId: 'c_bind1', title: 'Kalimat Efektif', content: 'Ciri kalimat efektif: kesatuan, kehematan, kepaduan, kelogisan.', link: '', createdAt: now - DAY * 3 }
    ];

    const modules = [
      {
        id: 'mod_1', courseId: 'c_mat1', title: 'Modul 1 - Aljabar Dasar',
        description: 'Modul pengantar aljabar dengan latihan.',
        sections: [
          { title: 'Pengertian Variabel', content: 'Variabel adalah simbol (biasanya huruf) yang mewakili nilai yang belum diketahui.' },
          { title: 'Operasi pada Variabel', content: 'Operasi +, -, *, / dapat dilakukan pada variabel sesuai aturan.' },
          { title: 'Latihan', content: 'Kerjakan soal 1-5 pada buku halaman 25.' }
        ],
        link: '', createdAt: now - DAY * 9
      },
      {
        id: 'mod_2', courseId: 'c_bind1', title: 'Modul 1 - Kaidah Bahasa',
        description: 'Dasar-dasar kaidah Bahasa Indonesia.',
        sections: [
          { title: 'EYD', content: 'Ejaan yang Disempurnakan - panduan penulisan resmi.' },
          { title: 'Tanda Baca', content: 'Penggunaan tanda baca yang benar.' }
        ],
        link: '', createdAt: now - DAY * 4
      }
    ];

    const recordings = [
      { id: 'rec_1', courseId: 'c_mat1', title: 'Pertemuan 1 - Pengantar', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 3600, recordedAt: now - DAY * 8, notes: 'Membahas bab 1 dan 2.' },
      { id: 'rec_2', courseId: 'c_mat1', title: 'Pertemuan 2 - Aljabar', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 3300, recordedAt: now - DAY * 4, notes: 'Latihan soal aljabar.' },
      { id: 'rec_3', courseId: 'c_bind1', title: 'Pertemuan 1 - EYD', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', duration: 2700, recordedAt: now - DAY * 3, notes: 'Pengantar EYD.' }
    ];

    const assignments = [
      { id: 'a_1', courseId: 'c_mat1', title: 'Latihan Persamaan Linear', description: 'Kerjakan 5 soal tentang persamaan linear satu variabel.', dueDate: now + DAY * 5, createdAt: now - DAY * 4 },
      { id: 'a_2', courseId: 'c_bind1', title: 'Esai Singkat', description: 'Tulis esai 300 kata tentang pahlawan favoritmu.', dueDate: now + DAY * 7, createdAt: now - DAY * 2 }
    ];

    const submissions = [
      { id: 's_1', assignmentId: 'a_1', studentId: 'u_siswa1', content: 'Jawaban soal 1: x = 3 ... dst.', submittedAt: now - DAY, grade: 85, feedback: 'Bagus, cek kembali soal nomor 3.' }
    ];

    const enrollments = [
      { id: 'e_1', courseId: 'c_mat1', studentId: 'u_siswa1', enrolledAt: now - DAY * 6 },
      { id: 'e_2', courseId: 'c_mat1', studentId: 'u_siswa2', enrolledAt: now - DAY * 5 },
      { id: 'e_3', courseId: 'c_bind1', studentId: 'u_siswa1', enrolledAt: now - DAY * 3 }
    ];

    // Bank soal — memakai nama subtest UTBK resmi agar bisa dikelompokkan
    const N = (code) => SUBTESTS.find(s => s.code === code).name;
    const questions = [
      /* ---- Penalaran Umum (PU) ---- */
      { id: 'q_pu1', authorId: 'u_guru1', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Semua siswa yang rajin memperoleh nilai baik. Andi memperoleh nilai baik. Kesimpulan yang tepat adalah...',
        options: ['Andi pasti rajin', 'Andi belum tentu rajin', 'Andi tidak rajin', 'Andi malas'],
        correctIndex: 1, explanation: 'Premis tidak dapat dibalik; nilai baik bisa disebabkan hal lain.' },
      { id: 'q_pu2', authorId: 'u_guru1', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Lanjutkan pola bilangan: 2, 6, 12, 20, 30, ...',
        options: ['40', '42', '44', '46'], correctIndex: 1, explanation: 'Selisih bertambah 2: +4,+6,+8,+10,+12 → 30+12 = 42.' },
      { id: 'q_pu3', authorId: 'u_guru1', subject: N('PU'), questionType: 'Pilihan Ganda', difficulty: 'sulit',
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
      { id: 'q_lbind1', authorId: 'u_guru2', subject: N('LBIND'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
        text: 'Gagasan utama sebuah paragraf umumnya dapat ditemukan pada...',
        options: ['kalimat penjelas', 'kalimat topik', 'kata hubung', 'tanda baca'],
        correctIndex: 1, explanation: 'Gagasan utama terdapat pada kalimat topik (kalimat utama).' },
      { id: 'q_lbind2', authorId: 'u_guru2', subject: N('LBIND'), questionType: 'Esai', difficulty: 'sulit',
        text: 'Tuliskan simpulan Anda mengenai dampak literasi digital bagi pelajar (maksimal 100 kata).',
        options: [], correctIndex: null, explanation: 'Dinilai manual oleh guru.' },

      /* ---- Literasi dalam Bahasa Inggris ---- */
      { id: 'q_lbing1', authorId: 'u_guru2', subject: N('LBING'), questionType: 'Pilihan Ganda', difficulty: 'mudah',
        text: 'Choose the correct sentence.',
        options: ['She don\'t like coffee.', 'She doesn\'t likes coffee.', 'She doesn\'t like coffee.', 'She not like coffee.'],
        correctIndex: 2, explanation: 'Third person singular uses "doesn\'t" + base verb.' },
      { id: 'q_lbing2', authorId: 'u_guru2', subject: N('LBING'), questionType: 'Pilihan Ganda', difficulty: 'sedang',
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
        courseId: 'c_mat1',
        courseIds: ['c_mat1'],
        targetClasses: ['X-A', 'X-B'],
        subtestMode: 'single',
        selectedSubtest: N('PK'),
        sections: [
          { subtest: N('PK'), questionIds: ['q_pk1', 'q_pk2', 'q_pk3'], durationMinutes: 15 }
        ],
        questionIds: ['q_pk1', 'q_pk2', 'q_pk3'],
        durationMinutes: 15,
        security: { requireCamera: false, requireMic: false, fullscreen: false, blockTabSwitch: true, maxViolations: 5 },
        startAt: now - DAY * 2, endAt: now + DAY * 5,
        createdAt: now - DAY * 3
      },
      {
        id: 'cbt_2',
        title: 'Try Out UTBK - Gabungan 7 Subtest',
        description: 'Simulasi UTBK lengkap. Subtest dikerjakan berurutan mulai dari Penalaran Umum. Kamera dan mikrofon wajib aktif selama ujian untuk pemantauan.',
        courseId: 'c_mat1',
        courseIds: ['c_mat1', 'c_bind1'],
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
      { id: 'at_1', courseId: 'c_mat1', userId: 'u_guru1', role: 'guru', date: tm2, status: 'hadir', note: '', createdAt: now - DAY * 2 },
      { id: 'at_2', courseId: 'c_mat1', userId: 'u_siswa1', role: 'siswa', date: tm2, status: 'hadir', note: '', createdAt: now - DAY * 2 },
      { id: 'at_3', courseId: 'c_mat1', userId: 'u_siswa2', role: 'siswa', date: tm2, status: 'izin', note: 'Sakit', createdAt: now - DAY * 2 },
      { id: 'at_4', courseId: 'c_mat1', userId: 'u_guru1', role: 'guru', date: tm1, status: 'hadir', note: '', createdAt: now - DAY },
      { id: 'at_5', courseId: 'c_mat1', userId: 'u_siswa1', role: 'siswa', date: tm1, status: 'hadir', note: '', createdAt: now - DAY },
      { id: 'at_6', courseId: 'c_bind1', userId: 'u_guru2', role: 'guru', date: t0, status: 'hadir', note: '', createdAt: now }
    ];

    const payments = [
      { id: 'pay_1', studentId: 'u_siswa1', courseId: 'c_mat1', amount: 500000, method: 'transfer', status: 'lunas', note: 'Bayar kelas Matematika', paidAt: now - DAY * 6, createdAt: now - DAY * 6 },
      { id: 'pay_2', studentId: 'u_siswa2', courseId: 'c_mat1', amount: 500000, method: 'transfer', status: 'lunas', note: 'Bayar kelas Matematika', paidAt: now - DAY * 5, createdAt: now - DAY * 5 },
      { id: 'pay_3', studentId: 'u_siswa1', courseId: 'c_bind1', amount: 450000, method: 'cash', status: 'lunas', note: 'Bayar kelas B.Indonesia', paidAt: now - DAY * 3, createdAt: now - DAY * 3 }
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
    subtestByName, subtestOrder,

    /* ===== Users ===== */
    getUsers: () => getAll(KEYS.users),
    getUser: (id) => findById(KEYS.users, id),
    findUserByUsername: (u) => getAll(KEYS.users).find(x => x.username.toLowerCase() === String(u).toLowerCase()) || null,
    addUser: (u) => add(KEYS.users, u),
    updateUser: (id, p) => update(KEYS.users, id, p),
    deleteUser: (id) => {
      const user = findById(KEYS.users, id);
      if (user && user.role === 'guru') {
        getAll(KEYS.courses).filter(c => c.teacherId === id).forEach(c => DB.deleteCourse(c.id));
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
    getCoursesByTeacher: (tid) => getAll(KEYS.courses).filter(c => c.teacherId === tid),
    addCourse: (c) => add(KEYS.courses, Object.assign({ createdAt: Date.now() }, c)),
    updateCourse: (id, p) => update(KEYS.courses, id, p),
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
      remove(KEYS.courses, id);
    },

    /* ===== Materials ===== */
    getMaterials: () => getAll(KEYS.materials),
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
    getCbtsByCourse: (cid) => getAll(KEYS.cbts).filter(c => c.courseId === cid),
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

    /* ===== Class Options (admin-configurable list of kelas names) ===== */
    getClassOptions: () => {
      const stored = localStorage.getItem('lms_class_options');
      if (stored) try { return JSON.parse(stored); } catch(e) {}
      return ['X-A', 'X-B', 'XI-A', 'XI-B', 'XII-A', 'XII-B'];
    },
    setClassOptions: (list) => {
      localStorage.setItem('lms_class_options', JSON.stringify(list));
    },

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
