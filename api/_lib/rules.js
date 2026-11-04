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
  'lms_class_options', 'lms_batches', 'lms_reading_texts', 'lms_verses', 'lms_hub_courses', 'lms_music_tracks', 'lms_streak_grants']);
const STAFF_ONLY = new Set(['lms_courses', 'lms_materials', 'lms_modules', 'lms_recordings', 'lms_assignments', 'lms_questions',
  'lms_cbts', 'lms_attendance', 'lms_class_plans', 'lms_whiteboards', 'lms_whiteboard_boards', 'lms_events', 'lms_announcements']);
// Tutor tidak boleh mengubah pengaturan global di server (termasuk kunci AI):
// sebelumnya tutor dapat menimpa/mengosongkan kunci & model Gemini milik admin.
const GURU_SETTINGS = new Set([]);
// batchId menentukan konten yang dirilis untuk mentee — hanya admin yang boleh mengubahnya.
const USER_PROTECTED = ['id', 'role', 'username', 'status', 'childIds', 'salaryRate', 'createdAt', 'batchId'];

function makeCtx(user, extra) {
  return Object.assign({
    user,
    id: user.id,
    role: user.role,
    childIds: Array.isArray(user.childIds) ? user.childIds.map(String) : [],
    isAdmin: user.role === 'admin',
    isStaff: user.role === 'admin' || user.role === 'guru',
    teacherStudents: null      // Set id siswa di kelas yang diampu guru (diisi pemanggil bila perlu)
  }, extra || {});
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => catalog.canon(a) === catalog.canon(b);

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
    case 'lms_ai_chats':
      return rec.userId === me ? rec : undefined;      // riwayat chat AI hanya untuk pemiliknya
    case 'lms_users': {
      if (ctx.isAdmin || rec.id === me || rec.salaryRate == null) return rec;
      const out = Object.assign({}, rec);
      delete out.salaryRate;
      return out;
    }
    case 'lms_settings':
      if (!ctx.isAdmin && catalog.isSecretSetting(id)) return (rec === '' || rec == null) ? rec : catalog.MASK;
      return rec;
    default:
      break;
  }
  if (ctx.isAdmin) return rec;
  switch (k) {
    case 'lms_expenses':
    case 'lms_activity_log':
      return undefined;
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
      if (ctx.role === 'guru' || rec.studentId === me || (ctx.role === 'orangtua' && ctx.childIds.includes(rec.studentId))) return rec;
      return Object.assign({}, rec, { notes: {}, quiz: redactQuiz(rec.quiz) });
    default:
      return rec;
  }
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
  if (ctx.isAdmin) return allow(after);

  if (ADMIN_ONLY.has(k)) return deny('Hanya admin yang dapat mengubah data ini.');
  if (STAFF_ONLY.has(k)) return ctx.isStaff ? allow(after) : deny('Hanya admin/tutor yang dapat mengubah data ini.');

  const rec = after || before;
  const owner = ownerField(k);
  const ownsBefore = before == null || (owner && before[owner] === me);
  const ownsAfter = after == null || (owner && after[owner] === me);

  switch (k) {
    case 'lms_enrollments':
      if (ctx.isStaff) return allow(after);
      if (ctx.role === 'siswa' && ownsBefore && ownsAfter) return allow(after);
      return deny('Pendaftaran kelas hanya untuk akun sendiri.');
    case 'lms_submissions':
      if (ctx.isStaff) return allow(after);
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) return allow(after);
      return deny('Tugas hanya dapat dikumpulkan oleh pemiliknya.');
    case 'lms_cbt_attempts':
      if (ctx.isStaff) return allow(after);
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) return allow(after);
      // Skor cohort (IRT) dihitung ulang di perangkat mana pun yang membuka hasil ujian.
      if (op === 'update' && (ctx.role === 'siswa' || ctx.role === 'orangtua')) return allow(onlyFields(before, after, ['scoring']));
      return deny('Hasil ujian hanya dapat diubah pemiliknya.');
    case 'lms_notifications':
      if (op === 'create') return typeof rec.userId === 'string' ? allow(after) : deny('Notifikasi tanpa penerima.');
      return before.userId === me ? allow(after) : deny('Notifikasi milik pengguna lain.');
    case 'lms_messages':
      if (op === 'create') return after.senderId === me ? allow(after) : deny('Pengirim pesan tidak sesuai.');
      return (before.senderId === me || before.receiverId === me) ? allow(after) : deny('Pesan milik pengguna lain.');
    case 'lms_learning_log':
      if (ctx.role === 'siswa' && op === 'create' && ownsAfter) return allow(after);
      return deny('Catatan belajar hanya dapat ditambah oleh pemiliknya.');
    case 'lms_hub_progress':
      if (ctx.role === 'siswa' && op !== 'delete' && ownsBefore && ownsAfter) return allow(after);
      return deny('Progres course hanya milik siswa bersangkutan.');
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
    case 'lms_feedbacks':
      return op === 'create' ? allow(after) : deny('Hanya admin yang dapat mengelola masukan.');
    default:
      return deny('Perubahan tidak diizinkan.');
  }
}

function checkUser(ctx, op, before, after) {
  if (ctx.isAdmin) {
    if (after) {
      if (!ROLES.includes(after.role)) return deny('Peran akun tidak valid.');
      if (typeof after.username !== 'string' || !after.username.trim()) return deny('Username wajib diisi.');
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

module.exports = { makeCtx, present, checkWrite, needsTeacherScope, ROLES, same, clone };
