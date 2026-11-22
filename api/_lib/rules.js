'use strict';
/* =====================================================================
 * Aturan baca/tulis per kunci data (ditegakkan di server).
 * Prinsip: admin boleh semua; staf (guru) mengelola konten kelas; siswa
 * dan orang tua hanya menulis data miliknya sendiri. Data pribadi
 * (pesan, notifikasi, keuangan, kapsul, log aktivitas) tidak dikirim ke
 * pengguna yang tidak berhak.
 * ===================================================================*/
const catalog = require('../../js/sync-catalog.js');

const ROLES = ['admin', 'guru', 'siswa', 'orangtua'];
const ADMIN_ONLY = new Set(['lms_payments', 'lms_expenses', 'lms_salaries', 'lms_motivations', 'lms_security_questions',
  'lms_class_options', 'lms_batches', 'lms_reading_texts', 'lms_verses', 'lms_hub_courses', 'lms_music_tracks', 'lms_streak_grants',
  'lms_news', 'lms_ptn_campuses', 'lms_ptn_faculties', 'lms_ptn_majors', 'lms_admission_events', 'lms_groups']);
const STAFF_ONLY = new Set(['lms_courses', 'lms_materials', 'lms_modules', 'lms_recordings', 'lms_assignments', 'lms_questions',
  'lms_cbts', 'lms_attendance', 'lms_class_plans', 'lms_whiteboards', 'lms_whiteboard_boards', 'lms_events', 'lms_announcements',
  'lms_game_questions', 'lms_topics', 'lms_passages']);
// Tutor tidak boleh mengubah pengaturan global di server (termasuk kunci AI):
// sebelumnya tutor dapat menimpa/mengosongkan kunci & model Gemini milik admin.
const GURU_SETTINGS = new Set([]);
// batchId menentukan konten yang dirilis untuk mentee — hanya admin yang boleh mengubahnya.
// kelas (kelas utama) menentukan kelas subtest yang diikuti otomatis — mentee tidak boleh memindahkan dirinya sendiri.
// eduStatus (status pendidikan) menentukan batas ketidakhadiran & denda — hanya admin yang mengisinya.
const EDU_STATUSES = ['sma12', 'gapyear', 'gapyear_kerja', 'semi_gapyear'];
const USER_PROTECTED = ['id', 'role', 'username', 'status', 'childIds', 'salaryRate', 'createdAt', 'batchId', 'kelas', 'eduStatus'];

function makeCtx(user, extra) {
  return Object.assign({
    user,
    id: user.id,
    role: user.role,
    childIds: Array.isArray(user.childIds) ? user.childIds.map(String) : [],
    isAdmin: user.role === 'admin',
    isStaff: user.role === 'admin' || user.role === 'guru',
    teacherStudents: null,     // Set id siswa di kelas yang diampu guru (diisi pemanggil bila perlu)
    paidCourses: null,         // Set id course berbayar yang sudah disetujui untuk pengguna ini (diisi pemanggil)
    refs: null                 // Data rujukan untuk validasi tulis course/pembayaran (diisi applyChanges)
  }, extra || {});
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => catalog.canon(a) === catalog.canon(b);

/* ============================ COURSE BERBAYAR ============================ */
const PAY_STATUS = ['pending', 'approved', 'rejected'];
const PRICE_MAX = 100000000;
const cleanText = (v, max) => cut(v, max).replace(/[<>]/g, '').trim();

/** Versi course tanpa isi pelajaran (judul, jenis, durasi tetap terlihat di kurikulum). */
function lockedCourse(rec) {
  const out = Object.assign({}, rec);
  out.sections = (Array.isArray(rec.sections) ? rec.sections : []).map(sec => Object.assign({}, sec, {
    lessons: (Array.isArray(sec.lessons) ? sec.lessons : []).map(l => ({
      id: l.id, title: l.title, type: l.type, durationMin: l.durationMin, dripDays: l.dripDays, active: l.active,
      createdAt: l.createdAt, reactivatedAt: l.reactivatedAt,
      questionCount: Array.isArray(l.questions) ? l.questions.length : 0, locked: true
    }))
  }));
  out.contentLocked = true;
  return out;
}

/** Validasi tipe akses & tujuan pembayaran course (berlaku juga untuk admin). */
function hubCourseAccessProblem(c) {
  if (c.accessType == null || c.accessType === 'free') return null;
  if (c.accessType !== 'paid') return 'Tipe akses course tidak valid.';
  const price = c.price;
  if (!Number.isInteger(price) || price < 1000 || price > PRICE_MAX) return 'Harga course harus bilangan bulat Rp1.000 – Rp100.000.000.';
  const p = c.payment && typeof c.payment === 'object' ? c.payment : {};
  const bank = typeof p.bank === 'string' ? p.bank.trim() : '';
  const no = typeof p.accountNo === 'string' ? p.accountNo.trim() : '';
  const name = typeof p.accountName === 'string' ? p.accountName.trim() : '';
  if (bank.length > 60 || name.length > 80 || String(p.instructions || '').length > 1000) return 'Data tujuan pembayaran terlalu panjang.';
  if (no && !/^[0-9][0-9 -]{4,29}$/.test(no)) return 'Nomor rekening hanya boleh angka, spasi, atau tanda hubung (5–30 karakter).';
  if (p.qrisKey != null && p.qrisKey !== '' && !new RegExp('^qris:' + String(c.id).replace(/[^A-Za-z0-9_.-]/g, '') + ':[0-9]{1,16}$').test(p.qrisKey)) return 'Gambar QRIS tidak valid.';
  const hasBank = !!(bank && no && name);
  if (!hasBank && !p.qrisKey) return 'Course berbayar membutuhkan rekening lengkap (bank, nomor, nama pemilik) atau gambar QRIS.';
  if ((bank || no || name) && !hasBank) return 'Lengkapi nama bank, nomor rekening, dan nama pemilik rekening.';
  return null;
}

/* ============================ TUTOR COURSE MANDIRI ============================
 * Admin menetapkan tutorIds pada course. Tutor hanya boleh mengubah isi course
 * (kurikulum, deskripsi, subjudul, tujuan, persyaratan) dan menulis penilaian esai
 * (review) pada progres peserta course itu — tidak judul, akses, harga, atau sasaran. */
const HUB_TUTOR_FIELDS = ['sections', 'description', 'subtitle', 'outcomes', 'requirements', 'updatedAt'];
const isHubTutor = (ctx, course) => ctx.role === 'guru' && !!course && Array.isArray(course.tutorIds) && course.tutorIds.includes(ctx.id);
function hubTutorCourseProblem(after) {
  if (after.contentLocked) return 'Isi course belum termuat penuh. Muat ulang halaman lalu coba lagi.';
  if (!Array.isArray(after.sections) || after.sections.length > 60) return 'Kurikulum tidak valid (maks. 60 bab).';
  if (typeof after.description === 'string' && (after.description.length > 100000 || richUnsafe(after.description))) return 'Deskripsi course memuat skrip atau terlalu panjang.';
  if (!optStr(after.subtitle, 240)) return 'Subjudul maksimal 240 karakter.';
  for (const sec of after.sections) {
    const ls = sec && Array.isArray(sec.lessons) ? sec.lessons : null;
    if (!ls || ls.length > 200 || !strOk(sec.title, 120, 1)) return 'Bab tidak valid (judul 1–120 karakter, maks. 200 pelajaran).';
    for (const l of ls) {
      if (!l || !['article', 'video', 'pdf', 'link', 'quiz'].includes(l.type) || !strOk(l.title, 200, 1)) return 'Pelajaran tidak valid.';
      if (l.url && !/^https:\/\/[^\s<>"']+$/i.test(String(l.url))) return 'Tautan pelajaran harus diawali https://';
      if (typeof l.content === 'string' && richUnsafe(l.content)) return 'Isi pelajaran memuat skrip atau atribut yang tidak diizinkan.';
      if (l.questions != null && (!Array.isArray(l.questions) || l.questions.length > 60)) return 'Kuis maksimal 60 soal.';
    }
  }
  if (JSON.stringify(after.sections).length > 2000000) return 'Isi course terlalu besar (maks. ±2 MB).';
  return null;
}
function hubReviewProblem(review) {
  if (review == null) return null;
  if (typeof review !== 'object' || Array.isArray(review) || Object.keys(review).length > 300) return 'Penilaian esai tidak valid.';
  for (const r of Object.values(review)) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'Penilaian esai tidak valid.';
    if (!optStr(r.feedback, 2000)) return 'Umpan balik maksimal 2.000 karakter.';
    const s = r.scores;
    if (s != null && (typeof s !== 'object' || Array.isArray(s) || Object.keys(s).length > 60
      || Object.values(s).some(v => !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)))) return 'Nilai esai harus angka 0–100.';
  }
  return null;
}
/** Cap penilai & waktu dari server pada entri penilaian yang berubah. */
function stampReview(ctx, before, after) {
  const prev = (before && before.review) || {};
  const out = {};
  Object.keys(after || {}).forEach(k => {
    const r = after[k];
    out[k] = JSON.stringify(r) === JSON.stringify(prev[k]) ? r : Object.assign({}, r, { gradedBy: ctx.id, gradedAt: Date.now() });
  });
  return out;
}

/** Siswa boleh mulai course? Gratis selalu boleh; berbayar perlu pembayaran disetujui. */
function hubAccessOk(ctx, courseId) {
  const refs = ctx.refs || {};
  const c = refs.courses && refs.courses.get(courseId);
  if (!c || c.accessType !== 'paid') return true;
  return (refs.myPayments || []).some(p => p.courseId === courseId && p.status === 'approved');
}

/**
 * Pembayaran manual:
 *  - siswa membuat record "pending" untuk dirinya sendiri, nominal = harga course saat ini,
 *    bukti = berkas proof:<dirinya>:… ; tidak boleh ada pembayaran lain yang menunggu/disetujui.
 *  - siswa tidak dapat mengubah/menghapus; admin memutuskan (setuju/tolak dengan alasan) atau memberi akses manual.
 */
function checkHubPayment(ctx, op, before, after) {
  const me = ctx.id;
  const refs = ctx.refs || {};
  if (op === 'delete') return ctx.isAdmin ? allow(null) : deny('Data pembayaran tidak dapat dihapus.');
  if (ctx.isAdmin) {
    if (!PAY_STATUS.includes(after.status)) return deny('Status pembayaran tidak valid.');
    if (typeof after.courseId !== 'string' || typeof after.studentId !== 'string') return deny('Data pembayaran tidak lengkap.');
    const out = Object.assign({}, after, {
      note: cleanText(after.note, 300),
      rejectReason: after.status === 'rejected' ? cleanText(after.rejectReason, 300) : ''
    });
    if (after.status === 'rejected' && !out.rejectReason) return deny('Tuliskan alasan penolakan.');
    if (before && before.status !== after.status) { out.decidedBy = me; out.decidedAt = Date.now(); }
    if (op === 'create' && after.status !== 'pending') { out.decidedBy = me; out.decidedAt = out.decidedAt || Date.now(); }
    return allow(out);
  }
  if (ctx.role !== 'siswa') return deny('Hanya mentee yang dapat mengirim bukti pembayaran.');
  if (op !== 'create') return deny('Pembayaran yang sudah dikirim tidak dapat diubah. Hubungi admin.');
  if (after.studentId !== me) return deny('Pembayaran hanya untuk akun sendiri.');
  const course = refs.courses && refs.courses.get(after.courseId);
  if (!course || course.active === false) return deny('Course tidak tersedia.');
  if (course.accessType !== 'paid') return deny('Course ini gratis.');
  if (after.amount !== course.price) return deny('Nominal pembayaran tidak sesuai harga course saat ini. Muat ulang halaman.');
  if (typeof after.proofKey !== 'string' || !new RegExp('^proof:' + me.replace(/[^A-Za-z0-9_.-]/g, '') + ':[A-Za-z0-9_.-]{1,80}$').test(after.proofKey)) {
    return deny('Bukti transfer belum diunggah.');
  }
  const open = (refs.myPayments || []).find(p => p.courseId === after.courseId && (p.status === 'pending' || p.status === 'approved'));
  if (open) return deny(open.status === 'approved' ? 'Pembayaran course ini sudah disetujui.' : 'Masih ada pembayaran yang menunggu verifikasi.');
  const created = Number(after.createdAt);
  return allow({
    id: after.id, courseId: after.courseId, studentId: me, amount: course.price, status: 'pending',
    proofKey: after.proofKey, proofName: cleanText(after.proofName, 120), note: cleanText(after.note, 300),
    createdAt: Number.isFinite(created) && created > 0 ? Math.min(created, Date.now() + 5 * 60 * 1000) : Date.now()
  });
}

/* ============================ BERITA ============================ */
const NEWS_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
/** Validasi berita (admin pun wajib lolos). Konten disanitasi di peramban saat simpan & tampil. */
function newsProblem(n) {
  const title = typeof n.title === 'string' ? n.title.trim() : '';
  if (title.length < 3 || title.length > 160) return 'Judul berita 3–160 karakter.';
  if (typeof n.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n.slug) || n.slug.length > 100) return 'Alamat (slug) berita tidak valid.';
  if (!['draft', 'published'].includes(n.status)) return 'Status berita tidak valid.';
  if (!Number.isFinite(Number(n.publishAt))) return 'Waktu terbit tidak valid.';
  if (n.excerpt != null && (typeof n.excerpt !== 'string' || n.excerpt.length > 320)) return 'Ringkasan maksimal 320 karakter.';
  if (n.category != null && (typeof n.category !== 'string' || n.category.length > 40)) return 'Kategori maksimal 40 karakter.';
  if (n.coverAlt != null && (typeof n.coverAlt !== 'string' || n.coverAlt.length > 160)) return 'Keterangan gambar maksimal 160 karakter.';
  if (n.authorName != null && (typeof n.authorName !== 'string' || n.authorName.length > 80)) return 'Nama penulis maksimal 80 karakter.';
  if (typeof n.content !== 'string' || n.content.length > 2400000) return 'Isi berita terlalu besar. Kurangi atau perkecil gambar di dalam isi.';
  // Lapis kedua: tolak penanda skrip di dalam tag (sanitasi utama berjalan di peramban).
  if (/<\s*(script|iframe|object|embed|style)\b/i.test(n.content) || /<[^>]*\son[a-z]+\s*=/i.test(n.content) ||
      /(href|src)\s*=\s*["']?\s*(javascript|vbscript):/i.test(n.content)) return 'Isi berita berisi kode yang tidak diizinkan.';
  for (const [f, max] of [['cover', 450000], ['thumb', 90000]]) {
    if (n[f] != null && n[f] !== '' && (typeof n[f] !== 'string' || n[f].length > max || !NEWS_IMG.test(n[f]))) return 'Gambar sampul tidak valid atau terlalu besar.';
  }
  return null;
}

/* ============================ TOOLS (data PTN & jadwal seleksi) ============================ */
const UTBK_CODES = ['PU', 'PPU', 'PBM', 'PK', 'LBIND', 'LBING', 'PM'];
const TRACKS = ['SNBP', 'SNBT', 'MANDIRI', 'LAINNYA'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const strOk = (v, max, min) => typeof v === 'string' && v.length <= max && v.trim().length >= (min || 0);
const optStr = (v, max) => v == null || v === '' || strOk(v, max);
const optNum = (v, lo, hi) => v == null || (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi);
const optUrl = (v) => v == null || v === '' || (typeof v === 'string' && v.length <= 300 && /^https?:\/\/[^\s<>"']+$/i.test(v));
const scoreMap = (o) => o == null || (typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).every(k => UTBK_CODES.includes(k) && optNum(o[k], 0, 1000)));
/** Bentuk data Tools (berlaku untuk semua peran, termasuk admin). */
function toolsProblem(k, id, r, me) {
  switch (k) {
    case 'lms_ptn_campuses':
      if (!strOk(r.name, 120, 2) || !optStr(r.short, 20) || !optStr(r.city, 60) || !optStr(r.province, 60) || !optStr(r.type, 40)) return 'Data kampus tidak valid.';
      return optUrl(r.website) ? null : 'Situs kampus tidak valid.';
    case 'lms_ptn_faculties':
      return strOk(r.name, 120, 2) && strOk(r.campusId, 200, 1) ? null : 'Data fakultas tidak valid.';
    case 'lms_ptn_majors':
      if (!strOk(r.name, 120, 2) || !strOk(r.campusId, 200, 1) || !(r.facultyId == null || strOk(r.facultyId, 200, 1))) return 'Data jurusan tidak valid.';
      if (!optNum(r.year, 2000, 2100) || !optNum(r.capacity, 0, 100000) || !optNum(r.applicants, 0, 10000000)) return 'Angka daya tampung/peminat/tahun tidak valid.';
      if (!optNum(r.avgScore, 0, 1000) || !optNum(r.minScore, 0, 1000) || !scoreMap(r.subtests)) return 'Skor jurusan harus 0–1000.';
      return optStr(r.source, 200) && optStr(r.notes, 500) ? null : 'Sumber/catatan terlalu panjang.';
    case 'lms_admission_events':
      if (!TRACKS.includes(r.track) || !strOk(r.title, 160, 3)) return 'Jalur atau judul jadwal tidak valid.';
      if (!YMD.test(r.startDate || '') || !YMD.test(r.endDate || '') || r.endDate < r.startDate) return 'Tanggal jadwal tidak valid.';
      return optUrl(r.link) && optStr(r.notes, 600) && optStr(r.campusName, 120) ? null : 'Tautan atau catatan jadwal tidak valid.';
    case 'lms_utbk_plans': {
      if (r.userId !== id || (me && r.userId !== me)) return 'Rencana UTBK milik pengguna lain.';
      const ids = (a, n) => a == null || (Array.isArray(a) && a.length <= n && a.every(x => strOk(x, 200, 1)));
      if (!scoreMap(r.scores) || !ids(r.choices, 4) || !ids(r.reminders, 100)) return 'Isi rencana UTBK tidak valid.';
      return r.notified == null || (typeof r.notified === 'object' && Object.keys(r.notified).length <= 100) ? null : 'Isi rencana UTBK tidak valid.';
    }
    default:
      return null;
  }
}

/* ============================ GRUP BELAJAR ============================
 * lms_groups        : dikelola admin. Terlihat oleh admin, tutor (tutorIds), dan anggota (memberIds).
 * lms_group_posts   : anggota hanya mengirim 'message' (termasuk balasan diskusi); admin & tutor grup
 *                     dapat mengirim semua jenis, menyematkan, dan menghapus (soft delete) kiriman siapa pun.
 * lms_group_answers : jawaban kuis (id = postId:userId) milik anggota; terkunci setelah dikirim;
 *                     terlihat oleh pemilik, tutor grup, dan admin.
 * ctx.groupAccess (Map groupId → 'staff' | 'member') dan ctx.refs.groups / groupPosts diisi handler. */
const GROUP_KINDS = ['message', 'discussion', 'quiz', 'material', 'announcement'];
const GROUP_QUIZ_GRACE = 10 * 60 * 1000;
const GROUP_QUIZ_OFFLINE_MAX = 2 * 60 * 60 * 1000;   // kiriman offline yang dibuat sebelum batas waktu
const idList = (a, max) => Array.isArray(a) && a.length <= max && a.every(x => typeof x === 'string' && x.length > 0 && x.length <= 200);
function richUnsafe(html) {
  return /<\s*(script|iframe|object|embed|style)\b/i.test(html) || /<[^>]*\son[a-z]+\s*=/i.test(html) ||
    /(href|src)\s*=\s*["']?\s*(javascript|vbscript):/i.test(html);
}
function groupProblem(g) {
  const name = typeof g.name === 'string' ? g.name.trim() : '';
  if (name.length < 2 || name.length > 80) return 'Nama grup 2–80 karakter.';
  if (g.description != null && (typeof g.description !== 'string' || g.description.length > 500)) return 'Deskripsi grup maksimal 500 karakter.';
  if (!idList(g.memberIds || [], 1000) || !idList(g.tutorIds || [], 100)) return 'Daftar anggota grup tidak valid.';
  if (g.color != null && g.color !== '' && !/^#[0-9a-f]{6}$/i.test(g.color)) return 'Warna grup tidak valid.';
  return null;
}
/** Map groupId → 'staff' | 'member' untuk pengguna dari daftar grup [{ id, memberIds, tutorIds }]. */
function groupAccessFrom(groups, me) {
  const m = new Map();
  groups.forEach(g => {
    if ((g.tutorIds || []).includes(me)) m.set(g.id, 'staff');
    else if ((g.memberIds || []).includes(me)) m.set(g.id, 'member');
  });
  return m;
}
function groupRole(ctx, groupId) {
  if (ctx.isAdmin) return 'staff';
  return (ctx.groupAccess && ctx.groupAccess.get(groupId)) || null;
}
function groupPostShape(p) {
  if (!GROUP_KINDS.includes(p.kind)) return 'Jenis kiriman grup tidak valid.';
  if (typeof p.groupId !== 'string' || !p.groupId || typeof p.authorId !== 'string') return 'Kiriman grup tidak valid.';
  if (typeof p.text !== 'string' || p.text.length > 4000) return 'Pesan maksimal 4.000 karakter.';
  if (p.title != null && (typeof p.title !== 'string' || p.title.length > 160)) return 'Judul maksimal 160 karakter.';
  if (p.content != null && (typeof p.content !== 'string' || p.content.length > 1500000)) return 'Isi kiriman terlalu besar. Perkecil gambar di dalamnya.';
  if (typeof p.content === 'string' && richUnsafe(p.content)) return 'Isi kiriman berisi kode yang tidak diizinkan.';
  if (p.threadId != null && (p.kind !== 'message' || typeof p.threadId !== 'string' || p.threadId.length > 200)) return 'Balasan diskusi tidak valid.';
  if (p.deleted) return null;
  if (p.kind === 'message' && !p.text.trim()) return 'Pesan kosong.';
  if (p.kind !== 'message' && !(typeof p.title === 'string' && p.title.trim().length >= 2)) return 'Judul kiriman minimal 2 karakter.';
  if (p.kind === 'quiz') {
    const q = p.quiz;
    if (!q || typeof q !== 'object' || !Array.isArray(q.questions) || !q.questions.length || q.questions.length > 40 ||
        !q.questions.every(x => x && typeof x === 'object' && typeof x.id === 'string' && typeof x.questionType === 'string')) return 'Kuis harus berisi 1–40 soal.';
    if (q.dueAt != null && !Number.isFinite(Number(q.dueAt))) return 'Batas waktu kuis tidak valid.';
  } else if (p.quiz != null) return 'Hanya kiriman kuis yang boleh berisi soal.';
  return null;
}
function checkGroupPost(ctx, op, before, after) {
  const me = ctx.id;
  const rec = after || before;
  const role = groupRole(ctx, rec.groupId);
  if (!role) return deny('Anda bukan anggota grup ini.');
  if (op === 'delete') return ctx.isAdmin ? allow(null) : deny('Kiriman grup dihapus dengan menandainya, bukan dihapus permanen.');
  const prob = groupPostShape(after);
  if (prob) return deny(prob);
  const g = ctx.refs && ctx.refs.groups ? ctx.refs.groups.get(rec.groupId) : null;
  if (op === 'create') {
    if (after.authorId !== me) return deny('Penulis kiriman tidak sesuai.');
    if (!g && !ctx.isAdmin) return deny('Grup tidak ditemukan.');
    if (g && g.archived) return deny('Grup ini sudah diarsipkan.');
    if (role !== 'staff' && after.kind !== 'message') return deny('Hanya admin atau tutor grup yang dapat mengirim soal, bahan diskusi, materi, atau pengumuman.');
    const out = clone(after);
    if (role !== 'staff') out.pinned = false;
    out.deleted = false;
    return allow(out);
  }
  for (const f of ['groupId', 'authorId', 'kind', 'threadId', 'createdAt']) {
    if (!same(before[f] == null ? null : before[f], after[f] == null ? null : after[f])) return deny('Kiriman grup tidak dapat dipindahkan atau diubah jenisnya.');
  }
  if (before.deleted && !after.deleted) return deny('Kiriman yang dihapus tidak dapat dipulihkan.');
  if (before.authorId === me) {
    const out = clone(after);
    if (role !== 'staff') out.pinned = !!before.pinned;
    if (out.deleted && !before.deleted) Object.assign(out, { text: '', title: '', content: '', quiz: null, deletedBy: me });
    return allow(out);
  }
  if (role !== 'staff') return deny('Kiriman milik anggota lain.');
  // Moderasi tutor/admin: hanya sematkan & hapus.
  const out = clone(before);
  out.pinned = !!after.pinned;
  if (after.deleted && !before.deleted) Object.assign(out, { deleted: true, text: '', title: '', content: '', quiz: null, deletedBy: me, deletedAt: Number(after.deletedAt) || null });
  return allow(out);
}
function checkGroupAnswer(ctx, op, id, before, after) {
  const me = ctx.id;
  const rec = after || before;
  const post = ctx.refs && ctx.refs.groupPosts ? ctx.refs.groupPosts.get(rec.postId) : null;
  const role = groupRole(ctx, post ? post.groupId : rec.groupId);
  if (op === 'delete') return role === 'staff' ? allow(null) : deny('Jawaban kuis hanya dapat diatur ulang admin atau tutor grup.');
  if (after.userId !== me || id !== after.postId + ':' + me || (before && before.userId !== me)) return deny('Jawaban kuis milik pengguna lain.');
  if (role !== 'member') return deny('Kuis grup hanya dikerjakan anggota grup.');
  if (!post || post.kind !== 'quiz' || post.deleted || post.groupId !== after.groupId) return deny('Kuis tidak ditemukan atau sudah dihapus.');
  if (before && before.submittedAt) return deny('Jawaban kuis sudah dikirim dan tidak dapat diubah.');
  if (after.answers == null || typeof after.answers !== 'object' || Array.isArray(after.answers) || JSON.stringify(after.answers).length > 200000) return deny('Isi jawaban kuis tidak valid.');
  const out = clone(after);
  delete out.syncedLate;
  // Waktu server menentukan batas waktu. Kiriman yang dibuat perangkat sebelum batas tetapi baru
  // tersinkron sesudahnya (sinyal putus) diterima paling lama GROUP_QUIZ_OFFLINE_MAX dan diberi
  // cap syncedLate (waktu server) agar tutor dapat menilainya sendiri.
  if (after.submittedAt && post.dueAt) {
    const t = Date.now();
    if (t > post.dueAt + GROUP_QUIZ_GRACE) {
      const claimed = Number(after.submittedAt) || 0;
      if (!(claimed > 0 && claimed <= post.dueAt + GROUP_QUIZ_GRACE && t <= post.dueAt + GROUP_QUIZ_OFFLINE_MAX)) return deny('Batas waktu kuis sudah lewat.');
      out.syncedLate = t;
    }
  }
  return allow(out);
}

/* ============================ RUANG BELAJAR ============================
 * lms_study_goals    : tujuan belajar milik mentee (judul, target menit, warna).
 * lms_study_sessions : sesi fokus (timer, tidak dapat diubah setelah tercatat) & waktu aktif di LMS
 *                      per perangkat per hari (id web:<user>:<hari>:<perangkat>). Hanya pemilik.
 * lms_study_stats    : ringkasan jam belajar per mentee (id = userId), terlihat semua peran.
 * Admin hanya dapat menghapus (mis. data tidak wajar), tidak dapat menulis atas nama mentee. */
const STUDY_DAY = 86400000;
const STUDY_MAX_FOCUS = 12 * 3600000;
const HEX6 = /^#[0-9a-f]{6}$/i;
function studyDayOk(ymd, now, back) {
  if (!YMD.test(ymd || '')) return false;
  const t = Date.parse(ymd + 'T00:00:00Z');
  return Number.isFinite(t) && t <= now + 2 * STUDY_DAY && t >= now - back;
}
function checkStudy(ctx, op, k, id, before, after) {
  const me = ctx.id;
  const owner = (before && before.userId) || (after && after.userId);
  if (op === 'delete') return owner === me || ctx.isAdmin ? allow(null) : deny('Data Ruang Belajar milik pengguna lain.');
  if (after.userId !== me || (before && before.userId !== me)) return deny('Data Ruang Belajar hanya dapat ditulis pemiliknya.');
  if (ctx.role !== 'siswa') return deny('Ruang Belajar mencatat jam belajar mentee.');
  const now = Date.now();
  const n = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (k === 'lms_study_goals') {
    if (!strOk(after.title, 80, 2) || !n(after.targetMin, 5, 600) || (after.color != null && !HEX6.test(after.color))) return deny('Tujuan belajar tidak valid.');
    return allow(after);
  }
  if (k === 'lms_study_sessions') {
    const ms = after.durationMs;
    if (after.kind === 'web') {
      if (!/^[a-z0-9]{6,20}$/.test(after.dev || '') || id !== `web:${me}:${after.day}:${after.dev}`) return deny('Catatan waktu di LMS tidak valid.');
      if (!studyDayOk(after.day, now, 8 * STUDY_DAY) || !n(ms, 0, STUDY_DAY)) return deny('Catatan waktu di LMS di luar batas.');
      return allow(after);
    }
    if (after.kind !== 'focus') return deny('Jenis sesi belajar tidak dikenal.');
    if (before) {
      const fixed = ['kind', 'durationMs', 'startedAt', 'endedAt', 'day'].every(f => same(before[f], after[f]));
      return fixed ? allow(after) : deny('Sesi belajar yang sudah tercatat tidak dapat diubah.');
    }
    const s = after.startedAt, e = after.endedAt;
    if (!n(s, now - 3 * STUDY_DAY, now + 5 * 60000) || !n(e, s, now + 5 * 60000)) return deny('Waktu sesi belajar tidak valid.');
    if (!n(ms, 0, STUDY_MAX_FOCUS) || ms > e - s + 60000) return deny('Durasi sesi melebihi rentang mulai–selesai.');
    if (!studyDayOk(after.day, now, 4 * STUDY_DAY) || !optStr(after.title, 80) || !optStr(after.goalId, 200)) return deny('Isi sesi belajar tidak valid.');
    return allow(after);
  }
  // lms_study_stats: angka per hari dibatasi 24 jam; status langsung dibatasi bentuknya.
  const days = after.days, months = after.months, live = after.live;
  if (JSON.stringify(after).length > 30000) return deny('Ringkasan jam belajar terlalu besar.');
  if (!days || typeof days !== 'object' || Array.isArray(days) || Object.keys(days).length > 80) return deny('Ringkasan jam belajar tidak valid.');
  for (const d of Object.keys(days)) {
    const v = days[d];
    if (!studyDayOk(d, now, 400 * STUDY_DAY) || !v || typeof v !== 'object' || !n(v.f, 0, STUDY_DAY) || !n(v.w, 0, STUDY_DAY) ||
        v.f + v.w > STUDY_DAY || (v.n != null && !n(v.n, 0, 500))) return deny('Jam belajar per hari di luar batas.');
  }
  if (months != null && (typeof months !== 'object' || Array.isArray(months) || Object.keys(months).length > 600 ||
      Object.keys(months).some(m => !/^\d{4}-\d{2}$/.test(m) || !n(months[m], 0, 31 * STUDY_DAY)))) return deny('Rekap bulanan tidak valid.');
  if (!n(after.total, 0, 1e12)) return deny('Total jam belajar tidak valid.');
  if (live != null && (typeof live !== 'object' || !['focus', 'break'].includes(live.state) || !optStr(live.title, 80) || !optStr(live.goalId, 200) ||
      !(live.since == null || n(live.since, now - 2 * STUDY_DAY, now + 5 * 60000)) || !n(live.accMs, 0, STUDY_MAX_FOCUS) ||
      !n(live.targetMs, 0, 600 * 60000) || !n(live.at, 0, now + 5 * 60000))) return deny('Status Ruang Belajar tidak valid.');
  return allow(after);
}

/* ============================ MAIN BARENG KELAS ============================
 * lms_game_rooms   : ruang game kelas milik tutor/admin (Monster Co-op, Balap Kelas).
 *                    Hanya tuan rumah yang menulis; jam fase & mulai dicap server.
 * lms_game_players : satu record per siswa per ruang (id = <ruang>:<siswa>). Hanya
 *                    pemiliknya yang menulis; jawaban per ronde/gerbang terkunci
 *                    setelah terkirim dan diberi cap waktu server (sa).
 * Ruang & pemain lebih dari 12 jam tidak lagi dikirim ke peran lain (lihat present). */
const ROOM_KINDS = ['raid', 'race'];
const ROOM_STATUS = ['lobby', 'playing', 'done', 'closed'];
const ROOM_PHASES = ['lobby', 'question', 'resolve', 'race', 'end'];
const ROOM_TRACKS = ['taman', 'gurun', 'pantai', 'salju', 'hutan', 'malam', 'gunung', 'pelabuhan'];
const ROOM_FIXED = ['id', 'code', 'kind', 'hostId', 'createdAt'];
const ROOM_ROLES = ['penyerang', 'penyihir', 'penjaga', 'penyembuh'];
const ROOM_ITEMS = ['turbo', 'shield', 'oil'];
const ROOM_TTL = 12 * 3600000;
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
function checkRoom(ctx, op, before, after) {
  const me = ctx.id;
  if (op === 'delete') return ctx.isAdmin || before.hostId === me ? allow(null) : deny('Ruang Main Bareng milik tutor lain.');
  if (!ctx.isStaff) return deny('Ruang Main Bareng dibuat dan dijalankan oleh tutor/admin.');
  if (op === 'create' && after.hostId !== me) return deny('Tuan rumah ruang harus akun sendiri.');
  if (op === 'update' && before.hostId !== me && !ctx.isAdmin) return deny('Ruang Main Bareng milik tutor lain.');
  if (JSON.stringify(after).length > 60000) return deny('Data ruang terlalu besar.');
  const out = clone(after);
  if (before) ROOM_FIXED.forEach(f => { out[f] = clone(before[f]); });
  if (!/^[A-Z2-9]{6}$/.test(out.code || '') || !ROOM_KINDS.includes(out.kind)) return deny('Kode atau jenis ruang tidak valid.');
  if (!ROOM_STATUS.includes(out.status) || !ROOM_PHASES.includes(out.phase || 'lobby')) return deny('Status ruang tidak valid.');
  if (!strOk(out.title, 80, 2) || !optStr(out.subject, 120)) return deny('Judul ruang 2–80 karakter.');
  if (!idList(out.qids, 60) || out.qids.length < 1) return deny('Daftar soal ruang tidak valid.');
  if (out.playerIds != null && !idList(out.playerIds, 200)) return deny('Daftar pemain tidak valid.');
  if (!isNum(out.round == null ? 0 : out.round, 0, 300) || !isNum(out.roundSec == null ? 20 : out.roundSec, 10, 120)) return deny('Ronde tidak valid.');
  if (out.kind === 'race' && (!ROOM_TRACKS.includes(out.track) || !isNum(out.laps, 1, 5))) return deny('Sirkuit balap tidak valid.');
  if (out.state != null && (typeof out.state !== 'object' || Array.isArray(out.state))) return deny('Keadaan ruang tidak valid.');
  if (out.results != null && (!Array.isArray(out.results) || out.results.length > 200)) return deny('Hasil ruang tidak valid.');
  const now = Date.now();
  // Jam fase dicap server agar semua perangkat memakai acuan waktu yang sama.
  const phaseChanged = !before || before.phase !== out.phase || before.round !== out.round;
  if (phaseChanged) {
    const dur = Math.max(0, Math.min(180000, num(after.phaseEndsAt, now) - num(after.phaseAt, now)));
    out.phaseAt = now;
    out.phaseEndsAt = now + dur;
  } else { out.phaseAt = before.phaseAt; out.phaseEndsAt = before.phaseEndsAt; }
  if (out.status === 'playing' && (!before || before.status !== 'playing')) out.startAt = now + Math.max(0, Math.min(15000, num(after.startIn, 5000)));
  else out.startAt = before ? (before.startAt == null ? null : before.startAt) : null;
  delete out.startIn;
  if (!before) out.createdAt = now;
  out.updatedAt = now;
  return allow(out);
}
function cleanAnswer(a) {
  if (!a || typeof a !== 'object') return null;
  const o = a.o;
  const okO = o == null || typeof o === 'number' || typeof o === 'boolean' || (typeof o === 'string' && o.length <= 300) ||
    (Array.isArray(o) && o.length <= 20 && o.every(x => ['number', 'string', 'boolean'].includes(typeof x) && String(x).length <= 300));
  if (!okO || !isNum(a.ms == null ? 0 : a.ms, 0, 600000) || (a.sk != null && !/^[a-z]{2,16}$/.test(String(a.sk)))) return null;
  return { o: o == null ? null : o, ok: !!a.ok, ms: Math.round(num(a.ms, 0)), sk: a.sk || null };
}
function checkRoomPlayer(ctx, op, id, before, after) {
  const me = ctx.id;
  const owner = (before && before.userId) || (after && after.userId);
  if (op === 'delete') return owner === me || ctx.isStaff ? allow(null) : deny('Data pemain milik mentee lain.');
  if (after.userId !== me || (before && before.userId !== me)) return deny('Data pemain hanya dapat ditulis pemiliknya.');
  if (ctx.role !== 'siswa') return deny('Main Bareng Kelas dimainkan oleh mentee.');
  if (typeof after.roomId !== 'string' || !after.roomId || after.roomId.length > 120 || id !== `${after.roomId}:${me}`) return deny('Ruang pemain tidak valid.');
  if (before && (before.roomId !== after.roomId || before.hostId !== after.hostId)) return deny('Ruang pemain tidak dapat dipindah.');
  if (typeof after.hostId !== 'string' || !after.hostId || after.hostId.length > 200) return deny('Tuan rumah ruang tidak valid.');
  if (JSON.stringify(after).length > 24000) return deny('Data pemain terlalu besar.');
  if (after.role != null && !ROOM_ROLES.includes(after.role)) return deny('Peran tidak dikenal.');
  if (after.color != null && !isNum(after.color, 0, 11)) return deny('Warna mobil tidak valid.');
  const now = Date.now();
  const out = clone(after);
  // Jawaban: maks. 120 entri, entri lama tidak dapat diubah/dihapus, entri baru dicap server.
  const ans = after.ans == null ? {} : after.ans;
  if (typeof ans !== 'object' || Array.isArray(ans) || Object.keys(ans).length > 120) return deny('Jawaban tidak valid.');
  const prev = (before && before.ans) || {};
  out.ans = {};
  for (const k of Object.keys(prev)) out.ans[k] = clone(prev[k]);
  for (const k of Object.keys(ans)) {
    if (!/^\d{1,3}$/.test(k)) return deny('Nomor ronde tidak valid.');
    if (Object.prototype.hasOwnProperty.call(prev, k)) continue;      // sudah terkunci
    const a = cleanAnswer(ans[k]);
    if (!a) return deny('Isi jawaban tidak valid.');
    out.ans[k] = Object.assign(a, { sa: now });
  }
  if (after.car != null) {
    const c = after.car;
    if (typeof c !== 'object' || !isNum(c.d, 0, 20000) || !isNum(c.lane, 0, 2) || !isNum(c.v, 0, 400) || !isNum(c.at, 0, now + 600000) ||
      !(c.fin == null || c.fin === 0 || isNum(c.fin, 0, now + 600000)) || !(c.it == null || ROOM_ITEMS.includes(c.it))) return deny('Posisi mobil tidak valid.');
    out.car = { d: c.d, lane: c.lane, v: c.v, at: c.at, fin: c.fin || 0, it: c.it || null, gate: isNum(c.gate, 0, 200) ? c.gate : 0,
      fx: c.fx && typeof c.fx === 'object' ? { t: num(c.fx.t, 0), s: num(c.fx.s, 0), h: num(c.fx.h, 0) } : { t: 0, s: 0, h: 0 } };
  }
  if (after.ev != null) {
    if (!Array.isArray(after.ev) || after.ev.length > 12 || !after.ev.every(e => e && e.t === 'oil' && isNum(e.n, 0, 1e6) && typeof e.to === 'string' && e.to.length <= 200 && isNum(e.at, 0, now + 600000))) return deny('Item balap tidak valid.');
    out.ev = after.ev.map(e => ({ t: e.t, n: e.n, to: e.to, at: e.at, lane: isNum(e.lane, 0, 2) ? e.lane : 1 }));
  }
  out.at = now;
  if (!before) out.joinedAt = now;
  return allow(out);
}

/* ============================ REMEDIAL ============================ */
const REMEDIAL_GRACE_MS = 10 * 60 * 1000;      // toleransi selisih jam perangkat
/** Percobaan baru pada ujian remedial: hanya peserta terpilih, di dalam jadwal, sistem aktif. */
function remedialAttemptProblem(ctx, after) {
  const refs = ctx.refs || {};
  const cbt = refs.cbts && refs.cbts.get(after.cbtId);
  if (cbt && cbt.kind === 'tryout') {
    // Tryout: draf & yang belum terbit tidak dapat dikerjakan, begitu pula sebelum jadwal dibuka.
    const now = refs.now || Date.now();
    if (cbt.status !== 'published' || (cbt.publishAt && now < cbt.publishAt - REMEDIAL_GRACE_MS)) return 'Tryout ini belum diterbitkan admin.';
    if (cbt.startAt && now < cbt.startAt - REMEDIAL_GRACE_MS) return 'Tryout belum dibuka.';
    return null;
  }
  if (!cbt || !cbt.remedialOf) return null;
  if (refs.remedialEnabled === false) return 'Sistem remedial sedang dimatikan admin.';
  if (!cbt.targetStudentIds.includes(ctx.id)) return 'Kamu tidak terdaftar sebagai peserta remedial ini.';
  const now = refs.now || Date.now();
  if (cbt.startAt && now < cbt.startAt - REMEDIAL_GRACE_MS) return 'Remedial belum dibuka.';
  if (cbt.endAt && now > cbt.endAt + REMEDIAL_GRACE_MS) return 'Jadwal remedial sudah berakhir.';
  return null;
}

/* ============================ VIDEO PEMBAHASAN ============================ */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
/** { id, url, noSkip } → dinormalisasi; null bila tidak valid. */
function normVideo(v) {
  if (!v || typeof v !== 'object' || !YT_ID.test(String(v.id || ''))) return null;
  const url = typeof v.url === 'string' ? v.url.trim().slice(0, 500) : '';
  if (url && !/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(url)) return null;
  return { id: v.id, url: url || 'https://youtu.be/' + v.id, noSkip: v.noSkip === true };
}

/* ============================ CHAT ============================ */
const MSG_MAX = 2000;
const cut = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Pesan chat:
 *  - create: pengirim = akun sendiri; teks 1..2000 karakter; balasan (replyToId +
 *    cuplikan) dan terusan (forwarded + forwardedFrom) dinormalisasi. Field lain dibuang.
 *  - update: hanya pengirim, dan hanya untuk "hapus pesan" (hapus lunak: isi dikosongkan).
 *  - delete permanen: hanya admin (pembersihan saat akun dihapus).
 */
function checkMessage(ctx, op, before, after) {
  const me = ctx.id;
  if (op === 'delete') {
    return ctx.isAdmin ? allow(null) : deny('Pesan tidak dapat dihapus permanen. Gunakan "Hapus pesan".');
  }
  if (op === 'create') {
    if (after.senderId !== me) return deny('Pengirim pesan tidak sesuai.');
    if (typeof after.receiverId !== 'string' || !after.receiverId || after.receiverId.length > 200 || after.receiverId === me) {
      return deny('Penerima pesan tidak valid.');
    }
    if (typeof after.text !== 'string' || !after.text.trim()) return deny('Pesan tidak boleh kosong.');
    if (after.text.length > MSG_MAX) return deny('Pesan terlalu panjang (maksimal 2000 karakter).');
    const created = Number(after.createdAt);
    const out = {
      id: after.id, senderId: me, receiverId: after.receiverId, text: after.text,
      createdAt: Number.isFinite(created) && created > 0 ? Math.min(created, Date.now() + 5 * 60 * 1000) : Date.now()
    };
    if (after.replyToId != null) {
      if (typeof after.replyToId !== 'string' || !after.replyToId || after.replyToId.length > 200) return deny('Rujukan balasan tidak valid.');
      const q = after.replyTo && typeof after.replyTo === 'object' ? after.replyTo : {};
      out.replyToId = after.replyToId;
      out.replyTo = { senderId: cut(q.senderId, 200), text: cut(q.text, 200) };
    }
    if (after.forwarded === true) {
      out.forwarded = true;
      out.forwardedFrom = cut(after.forwardedFrom, 80).replace(/[<>]/g, '').trim();
    }
    return allow(out);
  }
  if (before.senderId !== me) return deny('Pesan milik pengguna lain tidak dapat diubah.');
  if (before.deleted) return allow(before);
  if (after.deleted !== true) return deny('Pesan yang sudah terkirim tidak dapat diedit.');
  return allow({
    id: before.id, senderId: before.senderId, receiverId: before.receiverId, createdAt: before.createdAt,
    text: '', deleted: true, deletedAt: Number(after.deletedAt) || Date.now()
  });
}

/* ============================ BACA ============================ */
/**
 * Nilai record sebagaimana boleh dilihat ctx. undefined = disembunyikan.
 * (Nilai null = tombstone, selalu boleh dikirim.)
 */
function present(ctx, k, id, rec) {
  if (rec == null) return null;
  const me = ctx.id;
  switch (k) {
    case 'lms_notifications':
      return rec.userId === me ? rec : undefined;
    case 'lms_messages':
      return (rec.senderId === me || rec.receiverId === me) ? rec : undefined;
    case 'lms_news':
      // Hanya admin yang menyinkronkan berita (termasuk draf & terjadwal). Peran lain membaca
      // berita terbit lewat GET ?action=news, sehingga berita terjadwal tetap muncul tepat waktu
      // dan gambar sampul tidak memenuhi penyimpanan perangkat siswa.
      return ctx.isAdmin ? rec : undefined;
    case 'lms_hub_payments':
      if (ctx.isAdmin || rec.studentId === me) return rec;
      return ctx.role === 'orangtua' && ctx.childIds.includes(rec.studentId) ? rec : undefined;
    case 'lms_study_sessions':
    case 'lms_study_goals':
      // Data mentah Ruang Belajar hanya untuk pemiliknya; peran lain membaca ringkasan (lms_study_stats).
      return rec.userId === me ? rec : undefined;
    case 'lms_game_rooms':
    case 'lms_game_players': {
      // Ruang & pemain Main Bareng hanya relevan beberapa jam; yang lama tetap untuk tuan rumah & pemiliknya.
      if (ctx.isAdmin || rec.hostId === me || rec.userId === me) return rec;
      const t = Number(rec.updatedAt || rec.at || rec.createdAt) || 0;
      return Date.now() - t < ROOM_TTL ? rec : undefined;
    }
    case 'lms_hub_courses':
      // Course berbayar: isi pelajaran hanya untuk admin, tutor course, dan siswa yang pembayarannya disetujui.
      if (ctx.isAdmin || rec.accessType !== 'paid' || isHubTutor(ctx, rec)) return rec;
      if (ctx.paidCourses && ctx.paidCourses.has(rec.id)) return rec;
      return lockedCourse(rec);
    case 'lms_ai_chats':
      return rec.userId === me ? rec : undefined;      // riwayat chat AI hanya untuk pemiliknya
    case 'lms_utbk_plans':
      return ctx.isAdmin || rec.userId === me ? rec : undefined;
    case 'lms_groups':
      // null (bukan undefined): perangkat anggota yang dikeluarkan ikut menghapus grupnya.
      if (ctx.isAdmin || (rec.memberIds || []).includes(me) || (rec.tutorIds || []).includes(me)) return rec;
      return null;
    case 'lms_group_posts':
      return groupRole(ctx, rec.groupId) ? rec : undefined;
    case 'lms_group_answers':
      return ctx.isAdmin || rec.userId === me || groupRole(ctx, rec.groupId) === 'staff' ? rec : undefined;
    case 'lms_users': {
      if (ctx.isAdmin || rec.id === me || rec.salaryRate == null) return rec;
      const out = Object.assign({}, rec);
      delete out.salaryRate;
      return out;
    }
    case 'lms_settings':
      if (!ctx.isAdmin && catalog.isSecretSetting(id)) return (rec === '' || rec == null) ? rec : catalog.MASK;
      return rec;
    case 'lms_feedbacks':
      return presentFeedback(ctx, rec);
    default:
      break;
  }
  if (ctx.isAdmin) return rec;
  switch (k) {
    case 'lms_expenses':
    case 'lms_activity_log':
      return undefined;
    case 'lms_cbt_contribs':
      return ctx.isStaff ? rec : undefined;          // setoran soal tryout hanya untuk tutor & admin
    case 'lms_cbts':
      // Draf tryout tidak pernah sampai ke mentee/orang tua; null = salinan lama di perangkat ikut terhapus.
      return rec.kind === 'tryout' && rec.status !== 'published' && !ctx.isStaff ? null : rec;
    case 'lms_payments':
      if (ctx.role === 'siswa') return rec.studentId === me ? rec : undefined;
      if (ctx.role === 'orangtua') return ctx.childIds.includes(rec.studentId) ? rec : undefined;
      if (ctx.role === 'guru') return ctx.teacherStudents && ctx.teacherStudents.has(rec.studentId) ? rec : undefined;
      return undefined;
    case 'lms_salaries':
      return ctx.role === 'guru' && rec.teacherId === me ? rec : undefined;
    case 'lms_capsules':
    case 'lms_capsule_vaults':
      return rec.userId === me ? rec : undefined;
    case 'lms_submissions':
      if (ctx.role === 'guru') return rec;
      if (rec.studentId === me || (ctx.role === 'orangtua' && ctx.childIds.includes(rec.studentId))) return rec;
      // Metadata saja: dipakai perhitungan streak/leaderboard, isi jawaban & nilai disembunyikan.
      return { id: rec.id, assignmentId: rec.assignmentId, studentId: rec.studentId, submittedAt: rec.submittedAt || null, redacted: true };
    case 'lms_hub_progress':
      // Jawaban kuis & catatan hanya untuk pemilik, orang tuanya, dan tutor course tersebut (untuk menilai esai).
      if (rec.studentId === me || (ctx.role === 'orangtua' && ctx.childIds.includes(rec.studentId))) return rec;
      if (ctx.role === 'guru' && ctx.hubTutorOf && ctx.hubTutorOf.has(rec.courseId)) return rec;
      return Object.assign({}, rec, { notes: {}, quiz: redactQuiz(rec.quiz) });
    default:
      return rec;
  }
}

/* ---------- Kritik & Saran ----------
 * 'admin' → hanya admin; 'tutor' → hanya tutor penerima; 'umum' → semua pengguna. Pengirim selalu melihat miliknya.
 * Data lama: 'kelas' dianggap umum, 'individu' (penerima teks bebas) hanya untuk admin. */
const FB_TARGETS = ['admin', 'tutor', 'umum'];
function feedbackAudience(rec) {
  const t = rec && rec.target;
  if (t === 'tutor' && typeof rec.recipientId === 'string' && rec.recipientId) return 'tutor';
  if (t === 'umum' || t === 'kelas') return 'umum';
  return 'admin';
}
function presentFeedback(ctx, rec) {
  const mine = typeof rec.senderId === 'string' && rec.senderId === ctx.id;
  const aud = feedbackAudience(rec);
  const ok = mine || aud === 'umum' || (aud === 'tutor' ? rec.recipientId === ctx.id : ctx.isAdmin);
  // null (bukan undefined): perangkat yang dulu menyimpan salinannya ikut menghapus.
  if (!ok) return null;
  if (rec.anonymous && !mine && rec.senderId != null) {
    const out = Object.assign({}, rec);
    delete out.senderId;
    return out;
  }
  return rec;
}
function checkFeedback(ctx, op, before, after) {
  const me = ctx.id;
  if (op === 'delete') {
    if (ctx.isAdmin || before.senderId === me || (feedbackAudience(before) === 'tutor' && before.recipientId === me)) return allow(null);
    return deny('Kritik & saran hanya dapat dihapus pengirim, penerima, atau admin.');
  }
  if (op === 'create') {
    if (after.senderId !== me) return deny('Pengirim kritik & saran tidak sesuai.');
    if (!FB_TARGETS.includes(after.target)) return deny('Tujuan kritik & saran tidak valid.');
    const message = typeof after.message === 'string' ? after.message.trim() : '';
    if (message.length < 3 || message.length > 2000) return deny('Pesan kritik & saran 3–2.000 karakter.');
    const created = Number(after.createdAt);
    const out = {
      id: after.id, senderId: me, target: after.target, message, anonymous: after.anonymous === true,
      createdAt: Number.isFinite(created) && created > 0 ? Math.min(created, Date.now() + 5 * 60 * 1000) : Date.now()
    };
    if (after.target === 'tutor') {
      const rid = typeof after.recipientId === 'string' ? after.recipientId : '';
      const info = rid && ctx.refs && ctx.refs.users ? ctx.refs.users.get(rid) : null;
      if (!info || rid === me || info.r !== 'guru' || info.s === 'Dikeluarkan') return deny('Penerima harus akun tutor yang terdaftar di LMS.');
      out.recipientId = rid;
    }
    return allow(out);
  }
  // Ubah: hanya balasan, oleh tutor penerima (tujuan tutor) atau admin (tujuan admin/umum).
  const canReply = feedbackAudience(before) === 'tutor' ? before.recipientId === me : ctx.isAdmin;
  if (!canReply) return deny('Hanya penerima yang dapat membalas kritik & saran ini.');
  const out = clone(before);
  const rep = after.reply;
  if (rep == null) delete out.reply;
  else {
    const text = rep && typeof rep.text === 'string' ? rep.text.trim() : '';
    if (!text || text.length > 2000) return deny('Balasan 1–2.000 karakter.');
    out.reply = before.reply && before.reply.text === text ? clone(before.reply) : { text, by: me, at: Date.now() };
  }
  return allow(out);
}

/* ---------- Setoran soal CBT Tryout (tutor) ----------
 * id 'cc_<cbtId>_<questionId>'; tutor hanya membuat setoran atas namanya (status pending)
 * untuk subtest yang ada di tryout, dan hanya dapat menarik setoran sendiri yang belum ditinjau. */
function checkContrib(ctx, op, id, before, after) {
  if (ctx.role !== 'guru') return deny('Setoran soal tryout hanya untuk tutor dan admin.');
  const me = ctx.id;
  if (op === 'delete') {
    return before.by === me && before.status === 'pending' ? allow(null) : deny('Hanya setoran sendiri yang belum ditinjau yang dapat ditarik.');
  }
  if (op === 'update') return deny('Setoran soal yang sudah dikirim tidak dapat diubah.');
  if (after.by !== me) return deny('Penyetor soal tidak sesuai.');
  if (typeof after.cbtId !== 'string' || typeof after.questionId !== 'string' || !after.questionId ||
      after.questionId.length > 200 || id !== 'cc_' + after.cbtId + '_' + after.questionId) return deny('Data setoran soal tidak valid.');
  const ref = ctx.refs && ctx.refs.tryouts ? ctx.refs.tryouts.get(after.cbtId) : null;
  if (!ref) return deny('Tryout tujuan tidak ditemukan.');
  if (!ref.subtests.includes(after.subtest)) return deny('Subtest ini tidak ada di tryout tujuan.');
  return allow({ id, cbtId: after.cbtId, subtest: after.subtest, questionId: after.questionId, by: me, at: Date.now(), status: 'pending' });
}

function redactQuiz(quiz) {
  const out = {};
  Object.keys(quiz || {}).forEach(k => {
    const q = quiz[k] || {};
    out[k] = { score: q.score, passed: q.passed, at: q.at, attempts: q.attempts };
  });
  return out;
}

/** Kunci yang butuh daftar siswa binaan guru untuk penyaringan. */
function needsTeacherScope(ctx, k) { return ctx.role === 'guru' && k === 'lms_payments'; }

/* ============================ TULIS ============================ */
const deny = (reason) => ({ ok: false, reason });
const allow = (value) => ({ ok: true, value });

/** Gabungkan hanya field tertentu dari `after` ke `before`. */
function onlyFields(before, after, fields) {
  const out = clone(before);
  fields.forEach(f => {
    if (after && Object.prototype.hasOwnProperty.call(after, f)) out[f] = clone(after[f]);
    else delete out[f];
  });
  return out;
}

function ownerField(k) {
  switch (k) {
    case 'lms_enrollments': case 'lms_submissions': case 'lms_cbt_attempts':
    case 'lms_hub_progress': case 'lms_birthday_rewards': return 'studentId';
    case 'lms_learning_log': case 'lms_capsules': case 'lms_capsule_vaults': case 'lms_notifications': return 'userId';
    case 'lms_game_scores': return 'studentId';
    default: return null;
  }
}

/**
 * Periksa satu perubahan. before/after = nilai record (null = tidak ada/terhapus).
 * Mengembalikan { ok, value } (value null = hapus) atau { ok:false, reason }.
 */
function checkWrite(ctx, k, id, before, after) {
  const meta = catalog.info(k);
  if (!meta) return deny('Data ini tidak disinkronkan.');
  if (before == null && after == null) return allow(null);
  if (meta.type === catalog.RECORDS && after != null) {
    if (typeof after !== 'object' || Array.isArray(after)) return deny('Format data tidak valid.');
    if (catalog.idOf(k, after) !== id) return deny('Id data tidak cocok.');
  }
  const op = before == null ? 'create' : (after == null ? 'delete' : 'update');
  const me = ctx.id;

  if (k === 'lms_users') return checkUser(ctx, op, before, after);
  if (k === 'lms_settings') {
    if (catalog.isSecretSetting(id) && after === catalog.MASK) return allow(before);       // tidak diubah
    if (ctx.isAdmin) return allow(after);
    if (ctx.role === 'guru' && GURU_SETTINGS.has(id)) return allow(after);
    return deny('Hanya admin yang dapat mengubah pengaturan.');
  }
  if (k === 'lms_activity_log') {
    if (op !== 'create') return ctx.isAdmin ? allow(after) : deny('Riwayat aktivitas tidak dapat diubah.');
    // Siswa/orang tua tidak dapat mengubah pengaturan, jadi catatan "settings" dari mereka menyesatkan.
    if (!ctx.isStaff && /^settings/.test(String(after.action || ''))) return deny('Pengaturan hanya dapat diubah admin.');
    return allow(Object.assign({}, after, {
      actorId: me, actorRole: ctx.role, actorName: ctx.user.name || ctx.user.username || ''
    }));
  }
  if (k === 'lms_ai_chats') {
    // Pemilik saja yang dapat membuat/mengubah; admin hanya boleh menghapus (mis. saat akun dihapus).
    if (op === 'delete' && ctx.isAdmin) return allow(null);
    const okOwner = (before == null || before.userId === me) && (after == null || after.userId === me);
    return okOwner ? allow(after) : deny('Riwayat chat AI milik pengguna lain.');
  }
  if (/^lms_study_/.test(k)) return checkStudy(ctx, op, k, id, before, after);
  if (k === 'lms_game_rooms') return checkRoom(ctx, op, before, after);
  if (k === 'lms_game_players') return checkRoomPlayer(ctx, op, id, before, after);
  // Pesan divalidasi untuk semua peran (termasuk admin): bentuk, panjang, balasan, terusan.
  if (k === 'lms_messages') return checkMessage(ctx, op, before, after);
  // Jadwal & presensi: bentuk data untuk semua peran staf, hak tulis tutor per pertemuan.
  if (k === 'lms_attendance') return checkAttendance(ctx, before, after);
  if (k === 'lms_class_plans') return checkClassPlan(ctx, op, before, after);
  // Kritik & saran: pengirim = diri sendiri, penerima akun tutor, hanya penerima yang membalas (semua peran).
  if (k === 'lms_feedbacks') return checkFeedback(ctx, op, before, after);
  if (k === 'lms_material_plans') return checkMaterialPlan(ctx, before, after);
  if (k === 'lms_group_posts') return checkGroupPost(ctx, op, before, after);
  if (k === 'lms_group_answers') return checkGroupAnswer(ctx, op, id, before, after);
  if (k === 'lms_groups' && after) {
    const prob = groupProblem(after);
    if (prob) return deny(prob);
  }
  if (k === 'lms_hub_payments') return checkHubPayment(ctx, op, before, after);
  // Akses & harga hanya ditulis admin (perubahan tutor pada field ini dibuang, lihat HUB_TUTOR_FIELDS).
  if (k === 'lms_hub_courses' && after && ctx.isAdmin) {
    const prob = hubCourseAccessProblem(after);
    if (prob) return deny(prob);
  }
  if (k === 'lms_news' && after) {
    const prob = newsProblem(after);
    if (prob) return deny(prob);
  }
  if (after && /^lms_(ptn_|admission_events$|utbk_plans$)/.test(k)) {
    // Admin boleh merapikan rencana pengguna lain (mis. jurusan terhapus), pemilik hanya miliknya.
    const prob = toolsProblem(k, id, after, ctx.isAdmin ? null : me);
    if (prob) return deny(prob);
  }
  // Materi & Sub Materi: bentuk data dibatasi (semua peran staf, termasuk admin).
  if (k === 'lms_topics' && after) {
    const name = typeof after.name === 'string' ? after.name.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 80) return deny('Nama materi 2–80 karakter.');
    if (typeof after.subtest !== 'string' || !after.subtest || after.subtest.length > 120) return deny('Subtest materi tidak valid.');
    if (after.parentId != null && (typeof after.parentId !== 'string' || after.parentId.length > 200 || after.parentId === id)) return deny('Materi induk tidak valid.');
    after = Object.assign({}, after, { name, order: Number.isFinite(Number(after.order)) ? Number(after.order) : 0 });
  }
  // Teks bacaan: judul pendek, isi tanpa skrip & berukuran wajar (semua peran staf, termasuk admin).
  if (k === 'lms_passages' && after) {
    if (!optStr(after.title, 120) || typeof after.html !== 'string' || !after.html.trim() || after.html.length > 400000) return deny('Teks bacaan 1–400.000 karakter dengan judul maks. 120 karakter.');
    if (richUnsafe(after.html)) return deny('Teks bacaan memuat skrip atau atribut yang tidak diizinkan.');
    if (!optStr(after.subject, 120)) return deny('Subtest teks bacaan tidak valid.');
  }
  if (k === 'lms_questions' && after && after.passageId != null && (typeof after.passageId !== 'string' || after.passageId.length > 200)) return deny('Rujukan teks bacaan tidak valid.');
  // Papan whiteboard: judul/materi pendek; PDF & gambar hanya berupa rujukan berkas "wb:<kelas>:…" (bukan data URL).
  if (k === 'lms_whiteboards' && after) {
    if (!optStr(after.title, 120) || !optStr(after.topic, 160) || !optStr(after.planId, 200)) return deny('Judul/materi papan terlalu panjang.');
    if (after.media != null) {
      const okMedia = Array.isArray(after.media) && after.media.length <= 300 && after.media.every(m => m && typeof m.key === 'string' &&
        m.key.startsWith('wb:' + after.courseId + ':') && m.key.length <= 240 && Number.isFinite(Number(m.bytes)) && Number(m.bytes) >= 0);
      if (!okMedia) return deny('Daftar berkas papan tidak valid.');
    }
    if (after.thumb != null && (typeof after.thumb !== 'string' || after.thumb.length > 60000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(after.thumb))) return deny('Gambar mini papan tidak valid.');
  }
  // Video pembahasan soal: hanya ID YouTube yang valid (semua peran, termasuk admin).
  if (k === 'lms_questions' && after && after.explanationVideo != null) {
    const v = normVideo(after.explanationVideo);
    if (!v) return deny('Link video pembahasan tidak valid. Gunakan link YouTube.');
    after = Object.assign({}, after, { explanationVideo: v });
  }
  if (k === 'lms_cbts' && after && after.kind === 'tryout' && !['draft', 'published'].includes(after.status)) return deny('Status tryout tidak valid.');
  if (ctx.isAdmin) return allow(after);

  // CBT Tryout hanya ditulis admin; tutor menyetor soal lewat lms_cbt_contribs (ditinjau admin).
  if (k === 'lms_cbts' && ((before && before.kind === 'tryout') || (after && after.kind === 'tryout'))) {
    return deny('Tryout hanya dapat diubah admin. Setor soal lewat menu Tryout.');
  }
  if (k === 'lms_cbt_contribs') return checkContrib(ctx, op, id, before, after);

  // Tutor course mandiri: hanya isi course yang ia ampu (field lain tetap milik admin).
  if (k === 'lms_hub_courses' && op === 'update' && isHubTutor(ctx, before)) {
    const prob = hubTutorCourseProblem(after);
    if (prob) return deny(prob);
    return allow(onlyFields(before, after, HUB_TUTOR_FIELDS));
  }
  if (ADMIN_ONLY.has(k)) return deny('Hanya admin yang dapat mengubah data ini.');
  if (STAFF_ONLY.has(k)) return ctx.isStaff ? allow(after) : deny('Hanya admin/tutor yang dapat mengubah data ini.');

  const rec = after || before;
  const owner = ownerField(k);
  const ownsBefore = before == null || (owner && before[owner] === me);
  const ownsAfter = after == null || (owner && after[owner] === me);

  switch (k) {
    case 'lms_enrollments':
      if (ctx.isStaff) return allow(after);
      // Mentee hanya untuk akun sendiri; pendaftarannya selalu tercatat sebagai bergabung sendiri.
      if (ctx.role === 'siswa' && ownsBefore && ownsAfter) return allow(after ? Object.assign({}, after, { via: 'self' }) : null);
      return deny('Pendaftaran kelas hanya untuk akun sendiri.');
    case 'lms_submissions':
      if (ctx.isStaff) return allow(after);
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) return allow(after);
      return deny('Tugas hanya dapat dikumpulkan oleh pemiliknya.');
    case 'lms_cbt_attempts':
      if (ctx.isStaff) return allow(after);
      if (ctx.role === 'siswa' && op === 'create' && ownsAfter) {
        const prob = remedialAttemptProblem(ctx, after);
        if (prob) return deny(prob);
      }
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) {
        // Nilai esai (Poin Manual) hanya diisi tutor/admin — peserta tidak dapat mengubahnya.
        const out = clone(after);
        ['essayPoints', 'essayGradedBy', 'essayGradedAt'].forEach(fld => {
          if (before && Object.prototype.hasOwnProperty.call(before, fld)) out[fld] = clone(before[fld]);
          else delete out[fld];
        });
        return allow(out);
      }
      // Skor cohort (IRT) dihitung ulang di perangkat mana pun yang membuka hasil ujian.
      if (op === 'update' && (ctx.role === 'siswa' || ctx.role === 'orangtua')) return allow(onlyFields(before, after, ['scoring']));
      return deny('Hasil ujian hanya dapat diubah pemiliknya.');
    case 'lms_notifications':
      if (op === 'create') return typeof rec.userId === 'string' ? allow(after) : deny('Notifikasi tanpa penerima.');
      return before.userId === me ? allow(after) : deny('Notifikasi milik pengguna lain.');
    case 'lms_learning_log':
      if (ctx.role === 'siswa' && op === 'create' && ownsAfter) return allow(after);
      return deny('Catatan belajar hanya dapat ditambah oleh pemiliknya.');
    case 'lms_hub_progress':
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) {
        if (op === 'create' && !hubAccessOk(ctx, after.courseId)) return deny('Course berbayar ini belum dapat diikuti: pembayaran belum disetujui admin.');
        // Penilaian esai hanya ditulis tutor/admin: peserta tidak dapat mengubahnya.
        const out = clone(after);
        if (before && before.review) out.review = clone(before.review); else delete out.review;
        return allow(out);
      }
      if (ctx.role === 'guru' && op === 'update') {
        const c = ctx.refs && ctx.refs.courses && ctx.refs.courses.get(before.courseId);
        if (!c || !(c.tutorIds || []).includes(me)) return deny('Hanya tutor course ini yang dapat menilai esai peserta.');
        const prob = hubReviewProblem(after.review);
        if (prob) return deny(prob);
        const out = onlyFields(before, after, ['review']);
        if (out.review) out.review = stampReview(ctx, before, out.review);
        return allow(out);
      }
      return deny('Progres course hanya milik mentee bersangkutan.');
    case 'lms_capsules':
    case 'lms_capsule_vaults':
      if (ctx.role === 'siswa' && ownsBefore && ownsAfter) return allow(after);
      return deny('Mesin Waktu hanya dapat diakses pemiliknya.');
    case 'lms_birthday_wishes': {
      const author = before ? before.authorId : after.authorId;
      if (op === 'create') return after.authorId === me ? allow(after) : deny('Penulis ucapan tidak sesuai.');
      if (author === me) return allow(after);
      if (op === 'update') {
        const out = onlyFields(before, after, ['reports', 'status']);
        if (out.status !== before.status && out.status !== 'hidden') out.status = before.status;
        return allow(out);
      }
      return deny('Ucapan milik pengguna lain.');
    }
    case 'lms_birthday_rewards':
      if (ctx.role === 'siswa' && op === 'create' && ownsAfter) return allow(after);
      return deny('Hadiah ulang tahun hanya dapat dibuka pemiliknya.');
    case 'lms_birthday_notified':
      return (after == null || typeof after === 'number') ? allow(after) : deny('Format penanda tidak valid.');
    case 'lms_game_scores': {
      if (op === 'delete') return ctx.isStaff ? allow(null) : deny('Riwayat game tidak dapat dihapus.');
      if (!(ctx.role === 'siswa' && op === 'create' && ownsAfter)) return deny('Skor game hanya dicatat oleh pemainnya.');
      // Skor harus angka wajar: NaN/Infinity atau angka raksasa merusak papan peringkat game.
      const fin = (v) => Number.isFinite(Number(v));
      if (!fin(after.score) || Math.abs(Number(after.score)) > 1e6) return deny('Skor game tidak valid.');
      if (typeof after.game !== 'string' || !after.game || after.game.length > 60) return deny('Jenis game tidak valid.');
      if (!['solo', 'battle', 'bot', 'kelas'].includes(after.mode)) return deny('Mode game tidak valid.');
      if (after.result != null && !['win', 'lose', 'draw'].includes(after.result)) return deny('Hasil game tidak valid.');
      const int = (v, max) => Math.max(0, Math.min(max, Math.floor(fin(v) ? Number(v) : 0)));
      const created = Number(after.createdAt);
      return allow(Object.assign({}, after, {
        score: Math.round(Number(after.score)), correct: int(after.correct, 1000), answered: int(after.answered, 1000),
        durationMs: int(after.durationMs, 24 * 3600000),
        createdAt: Number.isFinite(created) && created > 0 ? Math.min(created, Date.now() + 5 * 60 * 1000) : Date.now()
      }));
    }
    case 'lms_game_battles':
      return checkBattle(ctx, op, before, after);
    case 'lms_utbk_plans':
      return (before == null || before.userId === me) && (after == null || after.userId === me) ? allow(after) : deny('Rencana UTBK milik pengguna lain.');
    default:
      return deny('Perubahan tidak diizinkan.');
  }
}

/* ---------- Game Battle ----------
 * Setiap pemain hanya dapat mengubah entri skornya sendiri (players[id]).
 * Transisi status yang sah:
 *   invite → playing (diterima lawan) | declined (lawan) | cancelled (pembuat)
 *   open   → playing (siswa lain mengambil, p2Id = dirinya) | cancelled (pembuat)
 *   playing → done (peserta; bila keduanya selesai atau batas waktu lewat)
 * Pemenang dihitung server dari skor, bukan dari klien. */
const BATTLE_STATUS = ['invite', 'open', 'playing', 'done', 'declined', 'cancelled'];
const BATTLE_IMMUTABLE = ['id', 'game', 'subject', 'qids', 'seed', 'limitMs', 'createdAt', 'expiresAt', 'p1Id'];
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
function cleanPlayer(p) {
  const x = p && typeof p === 'object' ? p : {};
  return {
    score: Math.round(Math.max(-1e6, Math.min(1e6, num(x.score, 0)))),
    answered: Math.max(0, Math.min(1000, Math.floor(num(x.answered, 0)))),
    correct: Math.max(0, Math.min(1000, Math.floor(num(x.correct, 0)))),
    finished: !!x.finished,
    finishedAt: x.finished ? num(x.finishedAt, Date.now()) : null,
    at: num(x.at, Date.now())
  };
}
function battleWinner(b) {
  const a = (b.players || {})[b.p1Id], c = (b.players || {})[b.p2Id];
  const sa = a ? a.score : 0, sc = c ? c.score : 0;
  return sa === sc ? null : (sa > sc ? b.p1Id : b.p2Id);
}
function checkBattle(ctx, op, before, after) {
  const me = ctx.id;
  const now = Date.now();
  if (op === 'delete') return ctx.isStaff ? allow(null) : deny('Battle tidak dapat dihapus.');
  if (op === 'create') {
    if (ctx.role !== 'siswa' || after.p1Id !== me) return deny('Battle hanya dapat dibuat mentee atas namanya sendiri.');
    if (after.status !== 'invite' && after.status !== 'open') return deny('Status battle awal tidak valid.');
    if (after.status === 'invite' && (typeof after.p2Id !== 'string' || !after.p2Id || after.p2Id === me)) return deny('Lawan battle tidak valid.');
    if (after.status === 'open' && after.p2Id) return deny('Tantangan terbuka belum memiliki lawan.');
    if (!Array.isArray(after.qids) || after.qids.length < 1 || after.qids.length > 60) return deny('Daftar soal battle tidak valid.');
    const out = clone(after);
    out.players = { [me]: cleanPlayer((after.players || {})[me]) };
    out.limitMs = Math.max(30000, Math.min(15 * 60000, num(after.limitMs, 300000)));
    out.createdAt = now;
    out.expiresAt = Math.min(now + 10 * 60000, Math.max(now, num(after.expiresAt, now + 120000)));
    out.startAt = null; out.winnerId = null; out.endedAt = null;
    return allow(out);
  }
  const isP1 = before.p1Id === me, isP2 = !!before.p2Id && before.p2Id === me;
  const claim = before.status === 'open' && !before.p2Id && ctx.role === 'siswa' && !isP1 && after.p2Id === me;
  if (!isP1 && !isP2 && !claim) return deny('Battle milik pemain lain.');
  const out = clone(before);
  BATTLE_IMMUTABLE.forEach(f => { if (Object.prototype.hasOwnProperty.call(before, f)) out[f] = clone(before[f]); });
  out.players = clone(before.players || {});
  if (after.players && after.players[me] && before.status !== 'done') out.players[me] = cleanPlayer(after.players[me]);
  const from = before.status, to = BATTLE_STATUS.includes(after.status) ? after.status : from;
  if (to !== from) {
    const ok =
      (from === 'invite' && to === 'playing' && isP2) ||
      (from === 'invite' && to === 'declined' && isP2) ||
      (from === 'invite' && to === 'cancelled' && isP1) ||
      (from === 'open' && to === 'playing' && claim) ||
      (from === 'open' && to === 'cancelled' && isP1) ||
      (from === 'playing' && to === 'done' && (isP1 || isP2));
    if (!ok) return deny('Perubahan status battle tidak diizinkan.');
    if (to === 'playing') {
      if (num(before.expiresAt, 0) < now - 15000) return deny('Tantangan sudah kedaluwarsa.');
      if (claim) out.p2Id = me;
      out.players[me] = cleanPlayer((after.players || {})[me]);
      out.startAt = Math.max(now, Math.min(now + 30000, num(after.startAt, now + 6000)));
    }
    if (to === 'done') {
      const p1 = out.players[out.p1Id], p2 = out.players[out.p2Id];
      const timeUp = now > num(before.startAt, now) + num(before.limitMs, 300000) + 30000;
      if (!(p1 && p2 && p1.finished && p2.finished) && !timeUp) return deny('Battle belum selesai.');
      out.endedAt = now;
      out.winnerId = battleWinner(out);
    }
    out.status = to;
  } else out.status = from;
  return allow(out);
}

/* Foto profil: kosong, kode avatar almamater (js/avatars.js), atau gambar kecil terkompresi. */
const AVATAR_CODE = /^av1:[a-z]{2,8}:[mf]:[0-5]$/;
const PHOTO_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const PHOTO_MAX = 280000;               // ±200 KB gambar (320 px JPEG jauh di bawahnya)
function photoProblem(before, after) {
  if (!after || after.photo == null || after.photo === '') return null;
  if (before && before.photo === after.photo) return null;      // foto lama tidak diperiksa ulang
  const p = after.photo;
  if (typeof p !== 'string') return 'Foto profil tidak valid.';
  if (AVATAR_CODE.test(p)) return null;
  if (p.length > PHOTO_MAX) return 'Foto profil terlalu besar. Pilih avatar almamater atau gambar yang lebih kecil.';
  if (!PHOTO_DATA.test(p)) return 'Foto profil harus gambar PNG, JPG, atau WEBP.';
  return null;
}
/* ============================ JADWAL & PRESENSI ============================
 * ctx.refs.teach (diisi applyChanges): { courses: Map(id → tutor[]), plans: Map(id → plan ringkas) }.
 * Tutor hanya boleh:
 *  - membuat rencana di kelas yang ia ampu; mengubah/menghapus rencana yang ia ajar;
 *  - mengisi/mengubah/menghapus presensi pertemuan yang ia ajar (tanpa rencana: tutor kelas).
 * Tutor lain di kelas yang sama tidak dapat menimpa presensi pertemuan tutor lain. */
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLAN_MINUTES = 90;
const PLAN_STATUSES = ['draft', 'fixed', 'changed', 'cancelled'];
const ATT_STATUSES = ['hadir', 'terlambat', 'izin', 'sakit', 'alfa'];
const hmToMin = (t) => { const m = HM_RE.exec(String(t || '')); return m ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null; };
const planTutorsOf = (p) => (p && Array.isArray(p.teacherIds) && p.teacherIds.length ? p.teacherIds : (p && p.teacherId ? [p.teacherId] : []));
function teachRefs(ctx) { return (ctx.refs && ctx.refs.teach) || { courses: new Map(), plans: new Map() }; }
/** Sesi aktif sebuah kelas pada satu tanggal, urut jam. */
function sessionsOf(ctx, courseId, date) {
  const out = [];
  teachRefs(ctx).plans.forEach((p, id) => {
    if (p.courseId === courseId && p.date === date && p.status !== 'cancelled') out.push(Object.assign({ id }, p));
  });
  return out.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
}
function mayTakeAttendance(ctx, rec) {
  if (ctx.isAdmin) return true;
  if (ctx.role !== 'guru') return false;
  const tutors = teachRefs(ctx).courses.get(rec.courseId);
  if (!tutors) return false;
  let plan = null;
  if (rec.planId) {
    // Sesi tertentu (juga yang sudah dibatalkan): hanya tutor sesi itu.
    plan = teachRefs(ctx).plans.get(rec.planId);
    if (!plan || plan.courseId !== rec.courseId || plan.date !== rec.date) return false;
  } else {
    plan = sessionsOf(ctx, rec.courseId, rec.date)[0] || null;
  }
  return plan ? planTutorsOf(plan).includes(ctx.id) : tutors.includes(ctx.id);
}
function checkAttendance(ctx, before, after) {
  if (!ctx.isStaff) return deny('Hanya admin/tutor yang dapat mengubah presensi.');
  if (after) {
    if (typeof after.courseId !== 'string' || typeof after.userId !== 'string' || !YMD_RE.test(after.date || '')) return deny('Data presensi tidak valid.');
    if (!['siswa', 'guru'].includes(after.role)) return deny('Peran presensi tidak valid.');
    if (!ATT_STATUSES.includes(after.status)) return deny('Status presensi tidak dikenal.');
    if (!optStr(after.note, 500)) return deny('Catatan presensi maksimal 500 karakter.');
    if (after.planId != null && !strOk(after.planId, 200)) return deny('Rujukan pertemuan tidak valid.');
    if (before && (before.courseId !== after.courseId || before.userId !== after.userId || before.date !== after.date)) {
      return deny('Presensi tidak dapat dipindahkan ke kelas, orang, atau tanggal lain.');
    }
  }
  for (const rec of [before, after]) {
    if (rec && !mayTakeAttendance(ctx, rec)) return deny('Presensi pertemuan ini hanya dapat diisi atau diubah tutor yang mengajar sesi tersebut, atau admin.');
  }
  if (!after) return allow(null);
  return allow(Object.assign({}, after, { markedBy: ctx.id, markedAt: Date.now() }));
}
function planShapeProblem(p) {
  if (typeof p.courseId !== 'string' || !p.courseId || !YMD_RE.test(p.date || '')) return 'Kelas atau tanggal rencana tidak valid.';
  if (!PLAN_STATUSES.includes(p.status)) return 'Status rencana tidak dikenal.';
  if ((p.time && !HM_RE.test(p.time)) || (p.endTime && !HM_RE.test(p.endTime))) return 'Format jam tidak valid (HH:MM).';
  if (!optStr(p.topic, 200) || !optStr(p.note, 1000)) return 'Topik maksimal 200 karakter dan catatan 1.000 karakter.';
  if (!optUrl(p.meetingLink)) return 'Tautan kelas harus diawali http(s):// (maks. 300 karakter).';
  if (p.teacherIds != null && !idList(p.teacherIds, 6)) return 'Daftar tutor pertemuan tidak valid (maks. 6).';
  if ((p.topicId != null && !strOk(p.topicId, 200)) || (p.materialPlanId != null && !strOk(p.materialPlanId, 200))) return 'Rujukan materi tidak valid.';
  if (!optStr(p.cancelReason, 200)) return 'Alasan pembatalan maksimal 200 karakter.';
  if (p.prevStatus != null && !PLAN_STATUSES.includes(p.prevStatus)) return 'Status sebelumnya tidak dikenal.';
  return null;
}
function checkClassPlan(ctx, op, before, after) {
  if (!ctx.isStaff) return deny('Hanya admin/tutor yang dapat mengubah rencana kelas.');
  const refs = teachRefs(ctx);
  if (after) {
    const prob = planShapeProblem(after);
    if (prob) return deny(prob);
    const slotChanged = !before || before.date !== after.date || before.time !== after.time || before.endTime !== after.endTime
      || (before.status === 'cancelled' && after.status !== 'cancelled');
    if (after.status !== 'cancelled' && slotChanged) {
      const a = hmToMin(after.time), b = hmToMin(after.endTime);
      if (a == null || b == null || b - a !== PLAN_MINUTES) return deny(`Setiap pertemuan berdurasi ${PLAN_MINUTES} menit.`);
    }
    const tutors = refs.courses.get(after.courseId);
    const teamChanged = !before || JSON.stringify(planTutorsOf(before)) !== JSON.stringify(planTutorsOf(after));
    if (tutors && teamChanged && planTutorsOf(after).some(id => !tutors.includes(id))) return deny('Tutor pertemuan harus tutor kelas tersebut.');
  }
  if (ctx.isAdmin) return allow(after);
  if (op === 'create') {
    const tutors = refs.courses.get(after.courseId);
    return tutors && tutors.includes(ctx.id) ? allow(after) : deny('Rencana hanya dapat dibuat di kelas yang Anda ampu.');
  }
  if (!planTutorsOf(before).includes(ctx.id)) return deny('Rencana ini hanya dapat diubah tutor yang mengajar pertemuan tersebut atau admin.');
  if (after && after.courseId !== before.courseId && !(refs.courses.get(after.courseId) || []).includes(ctx.id)) return deny('Rencana hanya dapat dipindah ke kelas yang Anda ampu.');
  return allow(after);
}
function checkMaterialPlan(ctx, before, after) {
  if (!ctx.isStaff) return deny('Hanya admin/tutor yang dapat mengubah rencana materi.');
  if (after) {
    if (typeof after.courseId !== 'string' || !after.courseId) return deny('Kelas rencana materi tidak valid.');
    if (!(Number.isInteger(after.week) && after.week >= 1 && after.week <= 60)) return deny('Minggu ke- harus 1–60.');
    if (!strOk(after.title, 80, 2) || /[<>]/.test(after.title)) return deny('Nama materi 2–80 karakter tanpa < atau >.');
    if (!optStr(after.note, 300)) return deny('Catatan rencana materi maksimal 300 karakter.');
    if (after.teacherIds != null && !idList(after.teacherIds, 6)) return deny('Daftar pengajar tidak valid (maks. 6).');
    if ((after.topicId != null && !strOk(after.topicId, 200)) || (after.subtopicId != null && !strOk(after.subtopicId, 200))) return deny('Rujukan materi tidak valid.');
  }
  if (ctx.isAdmin) return allow(after);
  const tutors = teachRefs(ctx).courses;
  for (const rec of [before, after]) {
    if (rec && !(tutors.get(rec.courseId) || []).includes(ctx.id)) return deny('Rencana materi hanya untuk kelas yang Anda ampu.');
  }
  return allow(after);
}

function checkUser(ctx, op, before, after) {
  const pp = photoProblem(before, after);
  if (pp) return deny(pp);
  if (ctx.isAdmin) {
    if (after) {
      if (!ROLES.includes(after.role)) return deny('Peran akun tidak valid.');
      if (typeof after.username !== 'string' || !after.username.trim()) return deny('Username wajib diisi.');
      if (after.eduStatus != null && after.eduStatus !== '' && !EDU_STATUSES.includes(after.eduStatus)) return deny('Status pendidikan tidak valid.');
    }
    return allow(after);
  }
  if (op !== 'update' || before.id !== ctx.id) return deny('Akun hanya dapat diubah oleh admin atau pemiliknya.');
  const out = clone(after);
  USER_PROTECTED.forEach(f => {
    if (Object.prototype.hasOwnProperty.call(before, f)) out[f] = clone(before[f]);
    else delete out[f];
  });
  return allow(out);
}

module.exports = { makeCtx, present, checkWrite, needsTeacherScope, ROLES, same, clone, groupAccessFrom };
