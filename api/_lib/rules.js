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
  'lms_cbts', 'lms_attendance', 'lms_class_plans', 'lms_whiteboards', 'lms_whiteboard_boards', 'lms_events', 'lms_announcements',
  'lms_game_questions', 'lms_topics']);
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
  if (ctx.role !== 'siswa') return deny('Hanya siswa yang dapat mengirim bukti pembayaran.');
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

/* ============================ REMEDIAL ============================ */
const REMEDIAL_GRACE_MS = 10 * 60 * 1000;      // toleransi selisih jam perangkat
/** Percobaan baru pada ujian remedial: hanya peserta terpilih, di dalam jadwal, sistem aktif. */
function remedialAttemptProblem(ctx, after) {
  const refs = ctx.refs || {};
  const cbt = refs.cbts && refs.cbts.get(after.cbtId);
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
    case 'lms_hub_payments':
      if (ctx.isAdmin || rec.studentId === me) return rec;
      return ctx.role === 'orangtua' && ctx.childIds.includes(rec.studentId) ? rec : undefined;
    case 'lms_hub_courses':
      // Course berbayar: isi pelajaran hanya untuk admin dan siswa yang pembayarannya disetujui.
      if (ctx.isAdmin || rec.accessType !== 'paid') return rec;
      if (ctx.paidCourses && ctx.paidCourses.has(rec.id)) return rec;
      return lockedCourse(rec);
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
  // Pesan divalidasi untuk semua peran (termasuk admin): bentuk, panjang, balasan, terusan.
  if (k === 'lms_messages') return checkMessage(ctx, op, before, after);
  if (k === 'lms_hub_payments') return checkHubPayment(ctx, op, before, after);
  if (k === 'lms_hub_courses' && after) {
    const prob = hubCourseAccessProblem(after);
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
  // Video pembahasan soal: hanya ID YouTube yang valid (semua peran, termasuk admin).
  if (k === 'lms_questions' && after && after.explanationVideo != null) {
    const v = normVideo(after.explanationVideo);
    if (!v) return deny('Link video pembahasan tidak valid. Gunakan link YouTube.');
    after = Object.assign({}, after, { explanationVideo: v });
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
        return allow(after);
      }
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
    case 'lms_game_scores':
      if (op === 'delete') return ctx.isStaff ? allow(null) : deny('Riwayat game tidak dapat dihapus.');
      if (ctx.role === 'siswa' && op === 'create' && ownsAfter) return allow(after);
      return deny('Skor game hanya dicatat oleh pemainnya.');
    case 'lms_game_battles':
      return checkBattle(ctx, op, before, after);
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
    if (ctx.role !== 'siswa' || after.p1Id !== me) return deny('Battle hanya dapat dibuat siswa atas namanya sendiri.');
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
