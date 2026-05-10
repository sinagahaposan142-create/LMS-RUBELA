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
    session: 'lms_session',
    seeded: 'lms_seeded_v2'
  };

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
    // Migrate: clear previous seed (v1) if present
    if (localStorage.getItem('lms_seeded_v1') === '1' && localStorage.getItem(KEYS.seeded) !== '1') {
      Object.keys(KEYS).forEach(k => localStorage.removeItem(KEYS[k]));
      localStorage.removeItem('lms_seeded_v1');
    }
    if (localStorage.getItem(KEYS.seeded) === '1') return;

    const now = Date.now();
    const DAY = 86400000;

    const users = [
      { id: 'u_admin', role: 'admin', username: 'admin', password: 'admin123', name: 'Administrator', email: 'admin@rubela.edu' },
      { id: 'u_guru1', role: 'guru', username: 'guru1', password: 'guru123', name: 'Pak Budi Santoso', email: 'budi@rubela.edu', subject: 'Matematika', salaryRate: 3000000 },
      { id: 'u_guru2', role: 'guru', username: 'guru2', password: 'guru123', name: 'Bu Sari Wulandari', email: 'sari@rubela.edu', subject: 'Bahasa Indonesia', salaryRate: 2800000 },
      { id: 'u_siswa1', role: 'siswa', username: 'siswa1', password: 'siswa123', name: 'Andi Pratama', email: 'andi@siswa.edu', kelas: 'X-A' },
      { id: 'u_siswa2', role: 'siswa', username: 'siswa2', password: 'siswa123', name: 'Dewi Anggraini', email: 'dewi@siswa.edu', kelas: 'X-A' },
      { id: 'u_siswa3', role: 'siswa', username: 'siswa3', password: 'siswa123', name: 'Rendy Kurniawan', email: 'rendy@siswa.edu', kelas: 'X-B' }
    ];

    const courses = [
      { id: 'c_mat1', title: 'Matematika Dasar', description: 'Pengantar aljabar dan operasi bilangan.', teacherId: 'u_guru1', category: 'Matematika', price: 500000, createdAt: now - DAY * 10 },
      { id: 'c_bind1', title: 'Bahasa Indonesia', description: 'Tata bahasa, menulis, dan apresiasi sastra.', teacherId: 'u_guru2', category: 'Bahasa', price: 450000, createdAt: now - DAY * 7 }
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

    // Question bank
    const questions = [
      { id: 'q_1', authorId: 'u_guru1', subject: 'Matematika', difficulty: 'mudah',
        text: 'Berapakah hasil dari 3 + 4 * 2?',
        options: ['14', '11', '10', '12'], correctIndex: 1, explanation: 'Perkalian dulu: 4*2=8, lalu 3+8=11.' },
      { id: 'q_2', authorId: 'u_guru1', subject: 'Matematika', difficulty: 'sedang',
        text: 'Nilai x dari 2x + 5 = 11 adalah?',
        options: ['2', '3', '4', '5'], correctIndex: 1, explanation: '2x = 6, x = 3.' },
      { id: 'q_3', authorId: 'u_guru1', subject: 'Matematika', difficulty: 'sedang',
        text: 'Hasil dari 5! (faktorial) adalah?',
        options: ['60', '100', '120', '150'], correctIndex: 2, explanation: '5! = 5*4*3*2*1 = 120.' },
      { id: 'q_4', authorId: 'u_guru2', subject: 'Bahasa Indonesia', difficulty: 'mudah',
        text: 'Kalimat berikut yang efektif adalah...',
        options: [
          'Para siswa-siswa sedang belajar.',
          'Siswa sedang belajar.',
          'Para siswa sedang belajar-belajar.',
          'Siswa-siswa sedang belajar bersama sama-sama.'
        ], correctIndex: 1, explanation: 'Hindari pengulangan makna (kehematan).' },
      { id: 'q_5', authorId: 'u_guru2', subject: 'Bahasa Indonesia', difficulty: 'mudah',
        text: 'Sinonim dari "bahagia" adalah...',
        options: ['sedih', 'riang', 'marah', 'kecewa'], correctIndex: 1, explanation: 'Riang = senang/bahagia.' }
    ];

    const cbts = [
      {
        id: 'cbt_1', courseId: 'c_mat1', title: 'Ujian Harian - Aljabar',
        description: 'Ujian singkat 3 soal materi aljabar dasar.',
        questionIds: ['q_1', 'q_2', 'q_3'],
        durationMinutes: 15,
        startAt: now - DAY * 2, endAt: now + DAY * 5,
        createdAt: now - DAY * 3
      }
    ];

    const cbtAttempts = [
      { id: 'att_1', cbtId: 'cbt_1', studentId: 'u_siswa1',
        answers: { q_1: 1, q_2: 1, q_3: 2 },
        score: 100, correctCount: 3, totalCount: 3,
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
      }
      remove(KEYS.users, id);
    },

    /* ===== Courses ===== */
    getCourses: () => getAll(KEYS.courses),
    getCourse: (id) => findById(KEYS.courses, id),
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
    getCbtAttempts: () => getAll(KEYS.cbtAttempts),
    getCbtAttemptsByCbt: (cid) => getAll(KEYS.cbtAttempts).filter(a => a.cbtId === cid),
    getCbtAttemptByStudent: (cid, sid) => getAll(KEYS.cbtAttempts).find(a => a.cbtId === cid && a.studentId === sid) || null,
    getCbtAttemptsByStudent: (sid) => getAll(KEYS.cbtAttempts).filter(a => a.studentId === sid),
    addCbtAttempt: (a) => add(KEYS.cbtAttempts, Object.assign({ startedAt: Date.now() }, a)),
    updateCbtAttempt: (id, p) => update(KEYS.cbtAttempts, id, p),

    /* ===== Attendance ===== */
    getAttendance: () => getAll(KEYS.attendance),
    getAttendanceByCourse: (cid) => getAll(KEYS.attendance).filter(a => a.courseId === cid),
    getAttendanceByUser: (uid) => getAll(KEYS.attendance).filter(a => a.userId === uid),
    getAttendanceByCourseDate: (cid, date) => getAll(KEYS.attendance).filter(a => a.courseId === cid && a.date === date),
    getAttendanceRecord: (cid, uid, date) =>
      getAll(KEYS.attendance).find(a => a.courseId === cid && a.userId === uid && a.date === date) || null,
    upsertAttendance: (cid, uid, role, date, status, note) => {
      const existing = DB.getAttendanceRecord(cid, uid, date);
      if (existing) return update(KEYS.attendance, existing.id, { status, note: note || '' });
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

    resetAll: () => {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      localStorage.removeItem('lms_seeded_v1');
      seedIfNeeded();
    }
  };

  global.DB = DB;
})(window);
