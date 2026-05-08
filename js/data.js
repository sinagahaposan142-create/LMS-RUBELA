/* ===== LMS Rubela - Data Store (LocalStorage) =====
 * Handles seeding and CRUD-like helpers for users, courses, materials,
 * assignments, submissions, and enrollments.
 */
(function (global) {
  const KEYS = {
    users: 'lms_users',
    courses: 'lms_courses',
    materials: 'lms_materials',
    assignments: 'lms_assignments',
    submissions: 'lms_submissions',
    enrollments: 'lms_enrollments',
    session: 'lms_session',
    seeded: 'lms_seeded_v1'
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function seedIfNeeded() {
    if (localStorage.getItem(KEYS.seeded) === '1') return;

    const users = [
      { id: 'u_admin', role: 'admin', username: 'admin', password: 'admin123', name: 'Administrator', email: 'admin@rubela.edu' },
      { id: 'u_guru1', role: 'guru', username: 'guru1', password: 'guru123', name: 'Pak Budi Santoso', email: 'budi@rubela.edu', subject: 'Matematika' },
      { id: 'u_guru2', role: 'guru', username: 'guru2', password: 'guru123', name: 'Bu Sari Wulandari', email: 'sari@rubela.edu', subject: 'Bahasa Indonesia' },
      { id: 'u_siswa1', role: 'siswa', username: 'siswa1', password: 'siswa123', name: 'Andi Pratama', email: 'andi@siswa.edu', kelas: 'X-A' },
      { id: 'u_siswa2', role: 'siswa', username: 'siswa2', password: 'siswa123', name: 'Dewi Anggraini', email: 'dewi@siswa.edu', kelas: 'X-A' },
      { id: 'u_siswa3', role: 'siswa', username: 'siswa3', password: 'siswa123', name: 'Rendy Kurniawan', email: 'rendy@siswa.edu', kelas: 'X-B' }
    ];

    const courses = [
      { id: 'c_mat1', title: 'Matematika Dasar', description: 'Pengantar aljabar dan operasi bilangan.', teacherId: 'u_guru1', category: 'Matematika', createdAt: Date.now() - 86400000 * 10 },
      { id: 'c_bind1', title: 'Bahasa Indonesia', description: 'Tata bahasa, menulis, dan apresiasi sastra.', teacherId: 'u_guru2', category: 'Bahasa', createdAt: Date.now() - 86400000 * 7 }
    ];

    const materials = [
      { id: 'm_1', courseId: 'c_mat1', title: 'Bilangan Bulat', content: 'Bilangan bulat meliputi bilangan positif, nol, dan negatif. Operasi dasar: + - x :.', link: '', createdAt: Date.now() - 86400000 * 8 },
      { id: 'm_2', courseId: 'c_mat1', title: 'Persamaan Linear', content: 'Bentuk umum ax + b = 0. Pelajari cara mencari nilai x.', link: '', createdAt: Date.now() - 86400000 * 5 },
      { id: 'm_3', courseId: 'c_bind1', title: 'Kalimat Efektif', content: 'Ciri kalimat efektif: kesatuan, kehematan, kepaduan, kelogisan.', link: '', createdAt: Date.now() - 86400000 * 3 }
    ];

    const assignments = [
      { id: 'a_1', courseId: 'c_mat1', title: 'Latihan Persamaan Linear', description: 'Kerjakan 5 soal tentang persamaan linear satu variabel.', dueDate: Date.now() + 86400000 * 5, createdAt: Date.now() - 86400000 * 4 },
      { id: 'a_2', courseId: 'c_bind1', title: 'Esai Singkat', description: 'Tulis esai 300 kata tentang pahlawan favoritmu.', dueDate: Date.now() + 86400000 * 7, createdAt: Date.now() - 86400000 * 2 }
    ];

    const submissions = [
      { id: 's_1', assignmentId: 'a_1', studentId: 'u_siswa1', content: 'Jawaban soal 1: x = 3 ... dst.', submittedAt: Date.now() - 86400000, grade: 85, feedback: 'Bagus, cek kembali soal nomor 3.' }
    ];

    const enrollments = [
      { id: 'e_1', courseId: 'c_mat1', studentId: 'u_siswa1', enrolledAt: Date.now() - 86400000 * 6 },
      { id: 'e_2', courseId: 'c_mat1', studentId: 'u_siswa2', enrolledAt: Date.now() - 86400000 * 5 },
      { id: 'e_3', courseId: 'c_bind1', studentId: 'u_siswa1', enrolledAt: Date.now() - 86400000 * 3 }
    ];

    save(KEYS.users, users);
    save(KEYS.courses, courses);
    save(KEYS.materials, materials);
    save(KEYS.assignments, assignments);
    save(KEYS.submissions, submissions);
    save(KEYS.enrollments, enrollments);
    localStorage.setItem(KEYS.seeded, '1');
  }

  seedIfNeeded();

  // Generic collection helpers
  function getAll(key) { return load(key, []); }
  function setAll(key, list) { save(key, list); }

  function findById(key, id) {
    return getAll(key).find(x => x.id === id) || null;
  }
  function add(key, record) {
    const list = getAll(key);
    if (!record.id) record.id = uid(key.replace('lms_', '').charAt(0));
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
    const list = getAll(key).filter(x => x.id !== id);
    setAll(key, list);
  }

  const DB = {
    KEYS,
    uid,
    // Users
    getUsers: () => getAll(KEYS.users),
    getUser: (id) => findById(KEYS.users, id),
    findUserByUsername: (username) => getAll(KEYS.users).find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null,
    addUser: (u) => add(KEYS.users, u),
    updateUser: (id, p) => update(KEYS.users, id, p),
    deleteUser: (id) => {
      // Cleanup related data if teacher or student deleted
      const user = findById(KEYS.users, id);
      if (user && user.role === 'guru') {
        // Remove the teacher's courses cascade
        const owned = getAll(KEYS.courses).filter(c => c.teacherId === id);
        owned.forEach(c => DB.deleteCourse(c.id));
      }
      if (user && user.role === 'siswa') {
        setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => e.studentId !== id));
        setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => s.studentId !== id));
      }
      remove(KEYS.users, id);
    },

    // Courses
    getCourses: () => getAll(KEYS.courses),
    getCourse: (id) => findById(KEYS.courses, id),
    getCoursesByTeacher: (teacherId) => getAll(KEYS.courses).filter(c => c.teacherId === teacherId),
    addCourse: (c) => add(KEYS.courses, Object.assign({ createdAt: Date.now() }, c)),
    updateCourse: (id, p) => update(KEYS.courses, id, p),
    deleteCourse: (id) => {
      setAll(KEYS.materials, getAll(KEYS.materials).filter(m => m.courseId !== id));
      const asgIds = getAll(KEYS.assignments).filter(a => a.courseId === id).map(a => a.id);
      setAll(KEYS.assignments, getAll(KEYS.assignments).filter(a => a.courseId !== id));
      setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => !asgIds.includes(s.assignmentId)));
      setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => e.courseId !== id));
      remove(KEYS.courses, id);
    },

    // Materials
    getMaterials: () => getAll(KEYS.materials),
    getMaterialsByCourse: (courseId) => getAll(KEYS.materials).filter(m => m.courseId === courseId),
    addMaterial: (m) => add(KEYS.materials, Object.assign({ createdAt: Date.now() }, m)),
    updateMaterial: (id, p) => update(KEYS.materials, id, p),
    deleteMaterial: (id) => remove(KEYS.materials, id),

    // Assignments
    getAssignments: () => getAll(KEYS.assignments),
    getAssignment: (id) => findById(KEYS.assignments, id),
    getAssignmentsByCourse: (courseId) => getAll(KEYS.assignments).filter(a => a.courseId === courseId),
    addAssignment: (a) => add(KEYS.assignments, Object.assign({ createdAt: Date.now() }, a)),
    updateAssignment: (id, p) => update(KEYS.assignments, id, p),
    deleteAssignment: (id) => {
      setAll(KEYS.submissions, getAll(KEYS.submissions).filter(s => s.assignmentId !== id));
      remove(KEYS.assignments, id);
    },

    // Submissions
    getSubmissions: () => getAll(KEYS.submissions),
    getSubmissionsByAssignment: (assignmentId) => getAll(KEYS.submissions).filter(s => s.assignmentId === assignmentId),
    getSubmissionByStudent: (assignmentId, studentId) =>
      getAll(KEYS.submissions).find(s => s.assignmentId === assignmentId && s.studentId === studentId) || null,
    getSubmissionsByStudent: (studentId) => getAll(KEYS.submissions).filter(s => s.studentId === studentId),
    addSubmission: (s) => add(KEYS.submissions, Object.assign({ submittedAt: Date.now() }, s)),
    updateSubmission: (id, p) => update(KEYS.submissions, id, p),

    // Enrollments
    getEnrollments: () => getAll(KEYS.enrollments),
    getEnrollmentsByStudent: (studentId) => getAll(KEYS.enrollments).filter(e => e.studentId === studentId),
    getEnrollmentsByCourse: (courseId) => getAll(KEYS.enrollments).filter(e => e.courseId === courseId),
    isEnrolled: (courseId, studentId) => !!getAll(KEYS.enrollments).find(e => e.courseId === courseId && e.studentId === studentId),
    enroll: (courseId, studentId) => {
      if (DB.isEnrolled(courseId, studentId)) return null;
      return add(KEYS.enrollments, { courseId, studentId, enrolledAt: Date.now() });
    },
    unenroll: (courseId, studentId) => {
      setAll(KEYS.enrollments, getAll(KEYS.enrollments).filter(e => !(e.courseId === courseId && e.studentId === studentId)));
    },

    // Reset (for admin convenience)
    resetAll: () => {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
      seedIfNeeded();
    }
  };

  global.DB = DB;
})(window);
