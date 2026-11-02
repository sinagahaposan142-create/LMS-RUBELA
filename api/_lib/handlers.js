'use strict';
/* =====================================================================
 * Handler API LMS Rubela (dipanggil oleh api/rubela.js).
 * Semua jawaban berbentuk { ok: true, ... } atau { ok: false, error }.
 * ===================================================================*/
const store = require('./store');
const security = require('./security');
const rules = require('./rules');
const catalog = require('../../js/sync-catalog.js');

const SESSION_DAYS = 30;
const PRESENCE_TTL = 90 * 1000;
const PULL_ROWS = 600;
const PULL_BYTES = 3000000;
const QUIZ_COOLDOWN = 60 * 1000;
const ROLE_LABELS = { admin: 'Admin', guru: 'Guru', siswa: 'Siswa', orangtua: 'Orang Tua' };
const MASK = catalog.MASK;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
const bad = (msg) => new HttpError(400, msg);
const unauthorized = (msg) => new HttpError(401, msg || 'Sesi berakhir. Silakan masuk lagi.', { code: 'unauthorized' });
const forbidden = (msg) => new HttpError(403, msg || 'Akses ditolak.');

const str = (v, max) => (typeof v === 'string' ? v : (v == null ? '' : String(v))).slice(0, max || 500);
const int = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : d; };
const parse = store.parse;

function bearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(h.trim());
  return m ? m[1] : '';
}

/** Data akun untuk dikirim ke pemiliknya (tanpa password). */
function publicUser(u) {
  const out = Object.assign({}, u);
  delete out.password;
  return out;
}

function sessionStmt(tokenHash) {
  return {
    sql: `SELECT s.user_id AS uid, s.expires_at AS exp, u.v AS uv FROM sessions s
          LEFT JOIN kv u ON u.k = 'lms_users' AND u.id = s.user_id WHERE s.token_hash = ?`,
    args: [tokenHash]
  };
}

function userFromSessionRows(rows, now) {
  const r = rows && rows[0];
  if (!r || !(Number(r.exp) > now) || r.uv == null) return null;
  const user = parse(r.uv);
  if (!user || (user.status || 'Aktif') === 'Dikeluarkan') return null;
  return user;
}

async function requireUser(db, req) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const tokenHash = security.sha256(token);
  const [rows] = await db.run([sessionStmt(tokenHash)]);
  const user = userFromSessionRows(rows, Date.now());
  if (!user) throw unauthorized();
  return { user, tokenHash };
}

async function createSession(db, user, req) {
  const token = security.newToken();
  const now = Date.now();
  const exp = now + SESSION_DAYS * 86400000;
  await db.run([{
    sql: 'INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, ua) VALUES (?, ?, ?, ?, ?, ?)',
    args: [security.sha256(token), user.id, now, now, exp, str(req.headers && req.headers['user-agent'], 200)]
  }]);
  return { token, expiresAt: exp };
}

/* ============================ HEALTH ============================ */
async function health(db) {
  const info = store.dbInfo();
  const out = { ok: true, configured: !!db, db: { region: info.region || null }, fnRegion: process.env.VERCEL_REGION || null, time: Date.now(), api: 1 };
  if (!db) {
    out.hint = 'Hubungkan database Turso ke project Vercel (TURSO_DATABASE_URL & TURSO_AUTH_TOKEN), lalu redeploy.';
    return out;
  }
  try {
    await store.ensureReady(db);
    const st = await store.readSettings(db, ['appName', 'appTagline', 'appLogo']);
    out.branding = { appName: st.appName || '', appTagline: st.appTagline || '', appLogo: st.appLogo || '' };
    out.ready = true;
  } catch (e) {
    out.ok = false;
    out.ready = false;
    out.error = 'Database belum dapat diakses: ' + (e.code === 'AUTH' ? 'token Turso ditolak.' : (e.message || 'kesalahan tak dikenal'));
  }
  return out;
}

/* ============================ LOGIN ============================ */
async function loginQuizConfig(db) {
  const st = await store.readSettings(db, ['loginQuizEnabled', 'loginQuizRoles', 'loginQuizAttempts']);
  return {
    enabled: st.loginQuizEnabled !== false,
    roles: Array.isArray(st.loginQuizRoles) ? st.loginQuizRoles : ['siswa'],
    attempts: Math.max(1, Math.min(10, Number(st.loginQuizAttempts) || 3))
  };
}

async function activeQuestions(db) {
  const rows = await db.query("SELECT id, v FROM kv WHERE k = 'lms_security_questions' AND v IS NOT NULL");
  return rows.map(r => parse(r.v)).filter(q => q && q.active !== false && Array.isArray(q.options) && q.options.length >= 2
    && q.correctIndex != null && q.options[q.correctIndex] != null);
}

function publicQuestion(q) {
  return { id: q.id, text: q.text, options: q.options, subtest: q.subtest || '', difficulty: q.difficulty || 'mudah' };
}

function pickQuestion(pool, used) {
  const fresh = pool.filter(q => !used.includes(q.id));
  const list = fresh.length ? fresh : pool;
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

async function login(db, req, body) {
  const username = str(body.username, 120).trim();
  const password = str(body.password, 200);
  const role = str(body.role, 20);
  if (!username || !password) throw bad('Username dan password wajib diisi.');
  const now = Date.now();
  const ip = security.clientIp(req);
  const uKey = 'login:u:' + username.toLowerCase();
  const ipKey = 'login:ip:' + ip;
  const [uState, ipState, quizState] = await Promise.all([
    security.throttleState(db, uKey, now), security.throttleState(db, ipKey, now),
    security.throttleState(db, 'quiz:u:' + username.toLowerCase(), now)
  ]);
  const locked = Math.max(uState.lockedFor, ipState.lockedFor);
  if (locked > 0) return { ok: false, error: `Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.ceil(locked / 60000)} menit.` };

  const user = await store.findUserByUsername(db, username);
  const auth = user ? await db.query('SELECT hash FROM auth WHERE user_id = ?', [user.id]) : [];
  // Akun tidak ada tetap menjalankan scrypt agar waktu respons tidak membocorkan username.
  const hash = auth.length ? auth[0].hash : store.DUMMY_HASH;
  const good = !!(await security.verifyPassword(password, hash)) && !!(user && auth.length);
  if (!good) {
    await Promise.all([
      security.throttleFail(db, uKey, { limit: 8, windowMs: 15 * 60000, lockMs: 15 * 60000 }, now),
      security.throttleFail(db, ipKey, { limit: 40, windowMs: 15 * 60000, lockMs: 15 * 60000 }, now)
    ]);
    return { ok: false, error: 'Username atau password salah.' };
  }
  await security.throttleClear(db, uKey);
  if (role && user.role !== role) {
    return { ok: false, error: `Akun ini terdaftar sebagai ${ROLE_LABELS[user.role] || user.role}, bukan ${ROLE_LABELS[role] || role}.` };
  }
  if ((user.status || 'Aktif') === 'Dikeluarkan') return { ok: false, error: 'Akun ini sudah tidak aktif. Hubungi admin.' };

  const quiz = await loginQuizConfig(db);
  if (quiz.enabled && quiz.roles.includes(user.role)) {
    if (quizState.lockedFor > 0) return { ok: false, error: `Terlalu banyak jawaban salah. Coba lagi dalam ${Math.ceil(quizState.lockedFor / 1000)} detik.` };
    const pool = await activeQuestions(db);
    if (pool.length) {
      const q = pickQuestion(pool, []);
      const challenge = security.randomId('lq');
      const data = { userId: user.id, username: user.username, left: quiz.attempts, used: [q.id], qid: q.id };
      await db.run([
        { sql: 'DELETE FROM challenges WHERE expires_at < ?', args: [now] },
        { sql: 'INSERT INTO challenges (id, user_id, data, expires_at) VALUES (?, ?, ?, ?)', args: [challenge, user.id, JSON.stringify(data), now + 10 * 60000] }
      ]);
      return { ok: true, quiz: { challenge, question: publicQuestion(q), left: quiz.attempts, name: user.name || user.username } };
    }
  }
  const s = await createSession(db, user, req);
  return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(user) };
}

async function quizAnswer(db, req, body) {
  const id = str(body.challenge, 80);
  const pick = int(body.pick, -1);
  const now = Date.now();
  const rows = await db.query('SELECT data, expires_at FROM challenges WHERE id = ?', [id]);
  if (!rows.length || !(Number(rows[0].expires_at) > now)) return { ok: false, done: true, error: 'Sesi verifikasi berakhir. Silakan masuk lagi.' };
  const data = parse(rows[0].data) || {};
  const user = await store.getRecord(db, 'lms_users', data.userId);
  if (!user || (user.status || 'Aktif') === 'Dikeluarkan') {
    await db.run([{ sql: 'DELETE FROM challenges WHERE id = ?', args: [id] }]);
    return { ok: false, done: true, error: 'Akun tidak dapat digunakan. Hubungi admin.' };
  }
  const q = await store.getRecord(db, 'lms_security_questions', data.qid);
  const pass = async () => {
    await db.run([{ sql: 'DELETE FROM challenges WHERE id = ?', args: [id] }]);
    await security.throttleClear(db, 'quiz:u:' + String(user.username || '').toLowerCase());
    const s = await createSession(db, user, req);
    return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(user) };
  };
  if (!q || pick === Number(q.correctIndex)) return pass();
  const left = (Number(data.left) || 1) - 1;
  if (left <= 0) {
    await db.run([{ sql: 'DELETE FROM challenges WHERE id = ?', args: [id] }]);
    await security.throttleLock(db, 'quiz:u:' + String(user.username || '').toLowerCase(), QUIZ_COOLDOWN, now);
    return { ok: false, done: true, correctIndex: Number(q.correctIndex), error: 'Kesempatan menjawab habis. Silakan coba masuk lagi dalam 1 menit.' };
  }
  const pool = await activeQuestions(db);
  const used = Array.isArray(data.used) ? data.used : [];
  const fresh = pool.filter(x => !used.includes(x.id));
  if (!fresh.length) return pass();                      // bank soal terlalu sedikit: jangan kunci pengguna
  const next = fresh[Math.floor(Math.random() * fresh.length)];
  const nextData = Object.assign({}, data, { left, qid: next.id, used: used.concat([next.id]).slice(-50) });
  await db.run([{ sql: 'UPDATE challenges SET data = ? WHERE id = ?', args: [JSON.stringify(nextData), id] }]);
  return { ok: false, done: false, correctIndex: Number(q.correctIndex), left, question: publicQuestion(next) };
}

/* ============================ REGISTER ============================ */
async function register(db, req, body) {
  const name = str(body.name, 120).trim();
  const email = str(body.email, 160).trim();
  const username = str(body.username, 60).trim();
  const password = str(body.password, 200);
  if (!name || !email || !username || !password) return { ok: false, error: 'Semua field wajib diisi.' };
  if (password.length < 6) return { ok: false, error: 'Password minimal 6 karakter.' };
  if (!/^\S{3,40}$/.test(username)) return { ok: false, error: 'Username 3–40 karakter tanpa spasi.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Format email tidak valid.' };
  const now = Date.now();
  const ipKey = 'register:ip:' + security.clientIp(req);
  const st = await security.throttleState(db, ipKey, now);
  if (st.lockedFor > 0) return { ok: false, error: 'Terlalu banyak pendaftaran dari jaringan ini. Coba lagi nanti.' };
  const hash = await security.hashPassword(password);
  const user = {
    id: security.randomId('u'), role: 'siswa', name, email, username, kelas: 'X-A', status: 'Aktif',
    targetUniv: str(body.targetUniv, 160).trim(), targetMajor: str(body.targetMajor, 160).trim(), phone: str(body.phone, 40).trim(),
    birthDate: '', photo: '', religion: '', streakShare: false, createdAt: now
  };
  const notif = {
    id: security.randomId('not'), userId: user.id, type: 'info', icon: '🎉', read: false, createdAt: now,
    title: 'Selamat datang di LMS Rubela!',
    body: 'Lengkapi profil dan mulai jelajahi kelas untuk menggapai kampus impianmu.', link: 'browse'
  };
  const { tx, rows } = await db.begin([
    "UPDATE meta SET value = value WHERE name = 'ver'",
    "SELECT CAST(value AS INTEGER) AS v FROM meta WHERE name = 'ver'",
    { sql: "SELECT id FROM kv WHERE k = 'lms_users' AND v IS NOT NULL AND lower(json_extract(v, '$.username')) = ?", args: [username.toLowerCase()] }
  ]);
  if (rows[2].length) { await tx.rollback(); return { ok: false, error: 'Username sudah dipakai.' }; }
  let ver = Number(rows[1][0] && rows[1][0].v) || 0;
  const put = (k, id, v) => { ver++; return { sql: 'INSERT INTO kv (k, id, v, ver, seq, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [k, id, JSON.stringify(v), ver, ver, now, user.id] }; };
  await tx.commit([
    put('lms_users', user.id, user),
    put('lms_notifications', notif.id, notif),
    { sql: 'INSERT INTO auth (user_id, hash, updated_at) VALUES (?, ?, ?)', args: [user.id, hash, now] },
    { sql: "UPDATE meta SET value = ? WHERE name = 'ver'", args: [String(ver)] }
  ]);
  await security.throttleFail(db, ipKey, { limit: 10, windowMs: 3600000, lockMs: 3600000 }, now);
  const s = await createSession(db, user, req);
  return { ok: true, token: s.token, expiresAt: s.expiresAt, user: publicUser(user) };
}

/* ============================ SESSION ============================ */
async function logout(db, req) {
  const token = bearer(req);
  if (token) await db.run([{ sql: 'DELETE FROM sessions WHERE token_hash = ?', args: [security.sha256(token)] }]);
  return { ok: true };
}

/** Cocokkan password akun yang sedang masuk (verifikasi identitas / perbandingan kode F2). */
async function verify(db, req, body) {
  const { user } = await requireUser(db, req);
  const purpose = body.purpose === 'compare' ? 'compare' : 'identity';
  const now = Date.now();
  const key = 'verify:' + purpose + ':' + user.id;
  const st = await security.throttleState(db, key, now);
  if (st.lockedFor > 0) return { ok: false, error: `Terlalu banyak percobaan. Tunggu ${Math.ceil(st.lockedFor / 1000)} detik.` };
  const rows = await db.query('SELECT hash FROM auth WHERE user_id = ?', [user.id]);
  const match = !!(rows.length && await security.verifyPassword(str(body.password, 200), rows[0].hash));
  if (purpose === 'identity') {
    if (!match) await security.throttleFail(db, key, { limit: 5, windowMs: 10 * 60000, lockMs: 5 * 60000 }, now);
    else await security.throttleClear(db, key);
  } else {
    await security.throttleFail(db, key, { limit: 30, windowMs: 10 * 60000, lockMs: 5 * 60000 }, now);
  }
  return { ok: true, match };
}

/* ============================ SYNC ============================ */
function normalizeChanges(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw bad('Format perubahan tidak valid.');
  if (list.length > 2000) throw bad('Terlalu banyak perubahan dalam satu permintaan.');
  const seen = new Map();
  list.forEach((c, i) => {
    if (!c || typeof c !== 'object') throw bad('Perubahan #' + i + ' tidak valid.');
    const k = str(c.k, 80);
    const id = str(c.id, 200);
    if (!catalog.has(k) || !id) throw bad('Kunci data tidak dikenal: ' + k);
    const op = c.op;
    if (!['put', 'patch', 'del'].includes(op)) throw bad('Operasi tidak dikenal.');
    const meta = catalog.info(k);
    if (op === 'patch' && meta.type !== catalog.RECORDS) throw bad('Patch hanya untuk record.');
    const payload = op === 'put' ? c.v : (op === 'patch' ? { set: c.set, unset: c.unset } : null);
    if (op !== 'del' && JSON.stringify(payload == null ? null : payload).length > catalog.MAX_RECORD_BYTES) {
      throw bad('Data terlalu besar untuk disimpan (' + k + ').');
    }
    if (op === 'patch' && (typeof c.set !== 'object' || c.set == null || Array.isArray(c.set))) throw bad('Patch tidak valid.');
    seen.set(k + '\u0001' + id, { k, id, op, v: c.v, set: c.set || {}, unset: Array.isArray(c.unset) ? c.unset.map(String) : [] });
  });
  return [...seen.values()];
}

function mergeChange(change, before) {
  if (change.op === 'del') return { after: null };
  if (change.op === 'put') return { after: change.v === undefined ? null : change.v };
  if (before == null) return { gone: true };
  const after = Object.assign({}, before, change.set);
  change.unset.forEach(f => { delete after[f]; });
  return { after };
}

function sanitizePresence(p) {
  if (!p || typeof p !== 'object') return null;
  const tab = str(p.tab, 60);
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(tab)) return null;
  if (p.gone) return { tab, gone: true };
  return {
    tab,
    data: {
      page: str(p.page, 60), visibility: p.visibility === 'hidden' ? 'hidden' : 'visible',
      idle: Math.max(0, Math.min(86400000, int(p.idle, 0))), browser: str(p.browser, 30), os: str(p.os, 30), device: str(p.device, 30)
    }
  };
}

function presenceStmts(tokenHash, pres, now) {
  const out = [];
  if (pres && pres.gone) {
    out.push({ sql: 'DELETE FROM presence WHERE tab = ? AND user_id = (SELECT user_id FROM sessions WHERE token_hash = ?)', args: [pres.tab, tokenHash] });
  } else if (pres) {
    out.push({
      sql: `INSERT INTO presence (user_id, tab, data, last_seen)
            SELECT s.user_id, ?, ?, ? FROM sessions s WHERE s.token_hash = ? AND s.expires_at > ?
            ON CONFLICT(user_id, tab) DO UPDATE SET data = excluded.data, last_seen = excluded.last_seen`,
      args: [pres.tab, JSON.stringify(pres.data), now, tokenHash, now]
    });
  }
  out.push({ sql: 'SELECT user_id, tab, data, last_seen FROM presence WHERE last_seen > ?', args: [now - PRESENCE_TTL] });
  out.push({
    sql: 'UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ? AND last_seen < ?',
    args: [now, now + SESSION_DAYS * 86400000, tokenHash, now - 10 * 60000]
  });
  return out;
}

function presenceFor(ctx, rows) {
  return (rows || []).filter(r => ctx.isStaff || r.user_id === ctx.id).map(r => {
    const d = parse(r.data) || {};
    return Object.assign({ tabId: r.tab, userId: r.user_id, lastSeen: Number(r.last_seen) }, d);
  });
}

function pullMetaStmt(cursor, full, snap) {
  // Tarik penuh halaman pertama: tanpa tombstone. Halaman berikutnya: tombstone setelah snapshot.
  const floor = full ? (cursor === 0 ? null : snap) : -1;
  if (floor === null) {
    return { sql: 'SELECT k, id, ver, length(v) AS sz FROM kv WHERE ver > ? AND v IS NOT NULL ORDER BY ver LIMIT ?', args: [cursor, PULL_ROWS] };
  }
  return { sql: 'SELECT k, id, ver, CASE WHEN v IS NULL THEN 0 ELSE length(v) END AS sz FROM kv WHERE ver > ? AND (v IS NOT NULL OR ver > ?) ORDER BY ver LIMIT ?', args: [cursor, floor, PULL_ROWS] };
}

async function teacherStudents(db, teacherId) {
  const rows = await db.query("SELECT k, v FROM kv WHERE k IN ('lms_courses', 'lms_enrollments') AND v IS NOT NULL");
  const courses = new Set();
  const enroll = [];
  rows.forEach(r => {
    const v = parse(r.v);
    if (!v) return;
    if (r.k === 'lms_courses') {
      const ids = Array.isArray(v.teacherIds) && v.teacherIds.length ? v.teacherIds : (v.teacherId ? [v.teacherId] : []);
      if (ids.includes(teacherId)) courses.add(v.id);
    } else enroll.push(v);
  });
  return new Set(enroll.filter(e => courses.has(e.courseId)).map(e => e.studentId));
}

/** Pilih baris pull sampai batas ukuran lalu ambil nilainya. */
async function fetchPull(db, ctx, metaRows, cursor, full, snap) {
  if (!metaRows.length) return { records: [], cursor, more: false };
  let bytes = 0, cut = metaRows[0].ver;
  for (const r of metaRows) {
    if (bytes > 0 && bytes + (Number(r.sz) || 0) > PULL_BYTES) break;
    bytes += Number(r.sz) || 0;
    cut = r.ver;
  }
  const more = metaRows.length >= PULL_ROWS || cut < metaRows[metaRows.length - 1].ver;
  const floor = full ? (cursor === 0 ? null : snap) : -1;
  const rows = floor === null
    ? await db.query('SELECT k, id, v, ver, seq FROM kv WHERE ver > ? AND ver <= ? AND v IS NOT NULL ORDER BY ver', [cursor, cut])
    : await db.query('SELECT k, id, v, ver, seq FROM kv WHERE ver > ? AND ver <= ? AND (v IS NOT NULL OR ver > ?) ORDER BY ver', [cursor, cut, floor]);
  if (ctx.role === 'guru' && !ctx.teacherStudents && rows.some(r => r.k === 'lms_payments')) {
    ctx.teacherStudents = await teacherStudents(db, ctx.id);
  }
  const records = [];
  rows.forEach(r => {
    if (!catalog.has(r.k)) return;
    const v = r.v == null ? null : rules.present(ctx, r.k, r.id, parse(r.v));
    if (v === undefined) return;
    records.push({ k: r.k, id: r.id, v, ver: Number(r.ver), seq: Number(r.seq) });
  });
  return { records, cursor: Number(cut), more };
}

function viewSig(user) {
  const kids = Array.isArray(user.childIds) ? user.childIds.slice().sort().join(',') : '';
  return security.sha256(user.id + '|' + user.role + '|' + kids).slice(0, 12);
}

function chunk(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

async function sync(db, req, body) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const tokenHash = security.sha256(token);
  const now = Date.now();
  const cursor = Math.max(0, int(body.cursor, 0));
  const full = !!body.full;
  const snap = Math.max(0, int(body.snap, 0));
  const changes = normalizeChanges(body.changes);
  const pres = sanitizePresence(body.presence);
  const metaStmt = { sql: "SELECT name, value FROM meta WHERE name IN ('ver', 'purge_ver')" };

  let user, metaRows, presRows, verNow, purgeVer, applied = [], rejected = [], nudge = null;
  if (!changes.length) {
    const res = await db.run([sessionStmt(tokenHash), metaStmt, pullMetaStmt(cursor, full, snap)].concat(presenceStmts(tokenHash, pres, now)));
    user = userFromSessionRows(res[0], now);
    if (!user) throw unauthorized();
    const m = {};
    res[1].forEach(r => { m[r.name] = Number(r.value) || 0; });
    verNow = m.ver || 0; purgeVer = m.purge_ver || 0;
    metaRows = res[2];
    presRows = res[res.length - 2];
  } else {
    // Transaksi lain sedang menulis (kunci database) → coba lagi sebentar.
    let out;
    for (let attempt = 0; ; attempt++) {
      try {
        out = await applyChanges(db, req, tokenHash, changes, now, [metaStmt, pullMetaStmt(cursor, full, snap)].concat(presenceStmts(tokenHash, pres, now)));
        break;
      } catch (e) {
        const transient = e && !(e instanceof HttpError) && /BUSY|LOCKED|locked|busy|stream|baton/i.test(String(e.code) + ' ' + String(e.message));
        if (!transient || attempt >= 3) throw e;
        await new Promise(r => setTimeout(r, 150 * (attempt + 1) + Math.floor(Math.random() * 120)));
      }
    }
    user = out.user;
    applied = out.applied; rejected = out.rejected; nudge = out.nudge;
    const m = {};
    (out.after[0].rows || []).forEach(r => { m[r.name] = Number(r.value) || 0; });
    verNow = m.ver || 0; purgeVer = m.purge_ver || 0;
    metaRows = out.after[1].rows || [];
    presRows = (out.after[out.after.length - 2] || {}).rows || [];
  }
  const ctx = rules.makeCtx(user);
  if (cursor > 0 && purgeVer > cursor && !full) {
    return { ok: true, reset: true, now, me: publicUser(user), viewSig: viewSig(user), applied, rejected, nudge };
  }
  const pulled = await fetchPull(db, ctx, metaRows, cursor, full, full && cursor === 0 ? verNow : snap);
  if (Math.random() < 0.02) housekeeping(db, now).catch(() => {});
  return {
    ok: true, now, cursor: pulled.cursor, more: pulled.more, snap: full ? (cursor === 0 ? verNow : snap) : 0,
    records: pulled.records, applied, rejected, nudge,
    presence: presenceFor(ctx, presRows), me: publicUser(rules.present(ctx, 'lms_users', user.id, user)), viewSig: viewSig(user)
  };
}

async function housekeeping(db, now) {
  const old = now - 45 * 86400000;
  const [maxRows] = await db.run([{ sql: 'SELECT MAX(ver) AS m FROM kv WHERE v IS NULL AND updated_at < ?', args: [old] }]);
  const m = Number(maxRows[0] && maxRows[0].m) || 0;
  const stmts = [
    { sql: 'DELETE FROM sessions WHERE expires_at < ?', args: [now] },
    { sql: 'DELETE FROM presence WHERE last_seen < ?', args: [now - 86400000] },
    { sql: 'DELETE FROM challenges WHERE expires_at < ?', args: [now] },
    { sql: 'DELETE FROM throttle WHERE locked_until < ? AND window_start < ?', args: [now, now - 86400000] }
  ];
  if (m) {
    stmts.push({ sql: 'DELETE FROM kv WHERE v IS NULL AND ver <= ?', args: [m] });
    stmts.push({ sql: "INSERT INTO meta (name, value) VALUES ('purge_ver', ?) ON CONFLICT(name) DO UPDATE SET value = CASE WHEN CAST(meta.value AS INTEGER) < CAST(excluded.value AS INTEGER) THEN excluded.value ELSE meta.value END", args: [String(m)] });
  }
  await db.run(stmts);
}

/**
 * Terapkan perubahan klien di dalam satu transaksi (kunci tulis diambil di
 * awal sehingga tidak ada lost update antar-perangkat).
 */
async function applyChanges(db, req, tokenHash, changes, now, afterStmts) {
  // Hash password lebih dulu (di luar kunci tulis) supaya transaksi singkat.
  const pwHashes = new Map();
  for (const c of changes) {
    if (c.k !== 'lms_users' || c.op === 'del') continue;
    const pw = c.op === 'put' ? (c.v && c.v.password) : c.set.password;
    if (typeof pw === 'string' && pw.length >= 6 && pw.length <= 200) pwHashes.set(c.id, await security.hashPassword(pw));
  }

  const byKey = new Map();
  changes.forEach(c => { if (!byKey.has(c.k)) byKey.set(c.k, []); byKey.get(c.k).push(c.id); });
  const reads = [];
  byKey.forEach((ids, k) => chunk(ids, 200).forEach(part => reads.push({
    sql: `SELECT k, id, v, ver, seq FROM kv WHERE k = ? AND id IN (${part.map(() => '?').join(',')})`, args: [k].concat(part)
  })));
  const touchesUsers = byKey.has('lms_users');
  const deletedUsers = changes.filter(c => c.k === 'lms_users' && c.op === 'del').map(c => c.id);
  const head = [
    "UPDATE meta SET value = value WHERE name = 'ver'",
    "SELECT CAST(value AS INTEGER) AS v FROM meta WHERE name = 'ver'",
    sessionStmt(tokenHash)
  ];
  const idxUsers = head.length + reads.length;
  const extra = [];
  if (touchesUsers) {
    extra.push("SELECT id, lower(json_extract(v, '$.username')) AS u, json_extract(v, '$.role') AS r, json_extract(v, '$.status') AS s FROM kv WHERE k = 'lms_users' AND v IS NOT NULL");
  }
  if (deletedUsers.length) {
    const qs = deletedUsers.map(() => '?').join(',');
    extra.push({
      sql: `SELECT k, id, v, ver, seq FROM kv WHERE k IN ('lms_messages', 'lms_notifications') AND v IS NOT NULL AND (
              json_extract(v, '$.userId') IN (${qs}) OR json_extract(v, '$.senderId') IN (${qs}) OR json_extract(v, '$.receiverId') IN (${qs}))`,
      args: deletedUsers.concat(deletedUsers, deletedUsers)
    });
  }
  const { tx, rows } = await db.begin(head.concat(reads, extra));
  try {
    const user = userFromSessionRows(rows[2], now);
    if (!user) throw unauthorized();
    const ctx = rules.makeCtx(user);
    let ver = Number(rows[1][0] && rows[1][0].v) || 0;
    const current = new Map();
    rows.slice(head.length, head.length + reads.length).forEach(list => list.forEach(r => {
      current.set(r.k + '\u0001' + r.id, { v: parse(r.v), ver: Number(r.ver), seq: Number(r.seq) });
    }));
    const userIdx = new Map();
    if (touchesUsers) rows[idxUsers].forEach(r => userIdx.set(r.id, { u: r.u || '', r: r.r, s: r.s || 'Aktif' }));

    const writes = [];
    const applied = [];
    const rejected = [];
    const targets = new Set();
    let broadcastAll = false;
    const written = new Set();
    const put = (k, id, value, seqOf) => {
      ver++;
      written.add(k + '\u0001' + id);
      writes.push({
        sql: `INSERT INTO kv (k, id, v, ver, seq, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(k, id) DO UPDATE SET v = excluded.v, ver = excluded.ver, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        args: [k, id, value == null ? null : JSON.stringify(value), ver, seqOf || ver, now, user.id]
      });
      return ver;
    };
    const visible = (k, id, v) => rules.present(ctx, k, id, v);
    const noteNudge = (k, value, before) => {
      const meta = catalog.info(k) || {};
      if (meta.quiet) return;
      if (meta.target) {
        [value, before].forEach(r => { if (r) meta.target.forEach(f => { if (typeof r[f] === 'string') targets.add(r[f]); }); });
      } else broadcastAll = true;
    };
    const activeAdmins = () => [...userIdx.entries()].filter(([, x]) => x.r === 'admin' && x.s !== 'Dikeluarkan').length;

    for (const c of changes) {
      const key = c.k + '\u0001' + c.id;
      const cur = current.get(key) || null;
      const before = cur ? cur.v : null;
      const merged = mergeChange(c, before);
      if (merged.gone) {
        rejected.push({ k: c.k, id: c.id, reason: 'Data ini sudah dihapus oleh pengguna lain.', v: null, ver: cur ? cur.ver : 0 });
        continue;
      }
      let after = merged.after;
      let password = null;
      if (c.k === 'lms_users' && after && typeof after === 'object') {
        if (Object.prototype.hasOwnProperty.call(after, 'password')) {
          password = after.password;
          after = Object.assign({}, after);
          delete after.password;
        }
      }
      const verdict = rules.checkWrite(ctx, c.k, c.id, before, after);
      const reject = (reason) => {
        const v = before == null ? null : visible(c.k, c.id, before);
        rejected.push(v === undefined ? { k: c.k, id: c.id, reason, hidden: true } : { k: c.k, id: c.id, reason, v, ver: cur ? cur.ver : 0, seq: cur ? cur.seq : 0 });
      };
      if (!verdict.ok) { reject(verdict.reason); continue; }
      let value = verdict.value;

      if (c.k === 'lms_users') {
        if (password != null && password !== '') {
          if (typeof password !== 'string' || password.length < 6) { reject('Password minimal 6 karakter.'); continue; }
          if (!ctx.isAdmin && c.id !== ctx.id) { reject('Password hanya dapat diubah admin atau pemilik akun.'); continue; }
        }
        if (value) {
          const uname = String(value.username || '').trim().toLowerCase();
          const clash = [...userIdx.entries()].some(([id, x]) => id !== c.id && x.u === uname);
          if (clash) { reject('Username sudah dipakai akun lain.'); continue; }
        }
        const prev = userIdx.get(c.id);
        const wasAdmin = prev && prev.r === 'admin' && prev.s !== 'Dikeluarkan';
        const stillAdmin = value && value.role === 'admin' && (value.status || 'Aktif') !== 'Dikeluarkan';
        if (wasAdmin && !stillAdmin && activeAdmins() <= 1) { reject('Minimal harus ada satu admin aktif.'); continue; }
        if (value) userIdx.set(c.id, { u: String(value.username || '').trim().toLowerCase(), r: value.role, s: value.status || 'Aktif' });
        else userIdx.delete(c.id);
      }

      if (value == null && before == null) {                     // hapus data yang memang tidak ada
        applied.push({ k: c.k, id: c.id, v: null, ver: 0 });
        continue;
      }
      if (value != null && before != null && rules.same(value, before) && password == null) {   // tidak ada perubahan
        const v = visible(c.k, c.id, before);
        applied.push(v === undefined ? { k: c.k, id: c.id, hidden: true } : { k: c.k, id: c.id, v, ver: cur.ver, seq: cur.seq });
        continue;
      }
      const newVer = (value != null && before != null && rules.same(value, before)) ? cur.ver : put(c.k, c.id, value, cur ? cur.seq : 0);
      noteNudge(c.k, value, before);
      if (c.k === 'lms_users') {
        if (password && pwHashes.has(c.id)) {
          writes.push({ sql: 'INSERT INTO auth (user_id, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at', args: [c.id, pwHashes.get(c.id), now] });
          // Password berubah: keluarkan sesi lain (sesi sendiri tetap berlaku).
          writes.push({ sql: 'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', args: [c.id, c.id === ctx.id ? tokenHash : ''] });
        }
        if (value == null) {
          writes.push({ sql: 'DELETE FROM auth WHERE user_id = ?', args: [c.id] });
          writes.push({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [c.id] });
          writes.push({ sql: 'DELETE FROM presence WHERE user_id = ?', args: [c.id] });
          writes.push({ sql: "DELETE FROM blobs WHERE key >= ? AND key < ?", args: ['cap:' + c.id + ':', 'cap:' + c.id + ';'] });
          writes.push({ sql: "DELETE FROM blob_meta WHERE key >= ? AND key < ?", args: ['cap:' + c.id + ':', 'cap:' + c.id + ';'] });
        } else if ((value.status || 'Aktif') === 'Dikeluarkan') {
          writes.push({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [c.id] });
        }
      }
      const v = value == null ? null : visible(c.k, c.id, value);
      applied.push(v === undefined ? { k: c.k, id: c.id, hidden: true, ver: newVer } : { k: c.k, id: c.id, v, ver: newVer, seq: cur && cur.seq ? cur.seq : newVer });
    }

    // Kaskade akun terhapus: pesan & notifikasi yang tidak terlihat admin.
    if (deletedUsers.length) {
      const gone = new Set(deletedUsers.filter(id => !userIdx.has(id)));
      (rows[idxUsers + (touchesUsers ? 1 : 0)] || []).forEach(r => {
        const key = r.k + '\u0001' + r.id;
        if (written.has(key)) return;
        const v = parse(r.v) || {};
        if (gone.has(v.userId) || gone.has(v.senderId) || gone.has(v.receiverId)) put(r.k, r.id, null, Number(r.seq));
      });
    }

    if (writes.length) writes.push({ sql: "UPDATE meta SET value = ? WHERE name = 'ver'", args: [String(ver)] });
    const out = await tx.commit(writes, afterStmts);
    let nudge = null;
    if (broadcastAll) nudge = { scope: 'all' };
    else if (targets.size) nudge = { scope: 'users', users: [...targets] };
    return { user, applied, rejected, after: out.after, nudge };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/* ============================ BLOB ============================ */
const BLOB_CHUNK_MAX = 1100000;   // karakter base64 per bagian (~800 KB data)

function blobPolicy(ctx, key) {
  const m = /^(music|cap):([A-Za-z0-9_.:-]{1,200})$/.exec(String(key || ''));
  if (!m) return null;
  if (m[1] === 'music') return { read: true, write: ctx.isAdmin, del: ctx.isAdmin, maxBytes: 16 * 1024 * 1024 };
  const owner = m[2].split(':')[0];
  const mine = owner === ctx.id;
  return { read: mine, write: mine && ctx.role === 'siswa', del: mine || ctx.isAdmin, maxBytes: 4 * 1024 * 1024 };
}

async function blobPut(db, req, body) {
  const { user } = await requireUser(db, req);
  const ctx = rules.makeCtx(user);
  const key = str(body.key, 240);
  const pol = blobPolicy(ctx, key);
  if (!pol || !pol.write) throw forbidden('Anda tidak berhak mengunggah berkas ini.');
  const part = int(body.part, -1), parts = int(body.parts, 0), size = int(body.size, -1);
  const data = typeof body.data === 'string' ? body.data : '';
  if (!(parts >= 1 && parts <= 40 && part >= 0 && part < parts)) throw bad('Bagian berkas tidak valid.');
  if (!(size >= 0 && size <= pol.maxBytes)) throw bad('Ukuran berkas melebihi batas.');
  if (!data || data.length > BLOB_CHUNK_MAX || !/^[A-Za-z0-9+/=]+$/.test(data)) throw bad('Data berkas tidak valid.');
  const now = Date.now();
  const stmts = [];
  if (part === 0) {
    stmts.push({ sql: 'DELETE FROM blobs WHERE key = ?', args: [key] });
    stmts.push({
      sql: `INSERT INTO blob_meta (key, size, type, parts, owner, complete, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(key) DO UPDATE SET size = excluded.size, type = excluded.type, parts = excluded.parts, owner = excluded.owner, complete = 0, updated_at = excluded.updated_at`,
      args: [key, size, str(body.type, 100), parts, user.id, now]
    });
  }
  stmts.push({ sql: 'INSERT INTO blobs (key, part, data) VALUES (?, ?, ?) ON CONFLICT(key, part) DO UPDATE SET data = excluded.data', args: [key, part, data] });
  if (part === parts - 1) {
    stmts.push({ sql: 'UPDATE blob_meta SET complete = CASE WHEN (SELECT COUNT(*) FROM blobs WHERE key = ?) = parts THEN 1 ELSE 0 END, updated_at = ? WHERE key = ?', args: [key, now, key] });
  }
  await db.atomic(stmts);
  if (part === parts - 1) {
    const meta = await db.query('SELECT complete FROM blob_meta WHERE key = ?', [key]);
    if (!meta.length || Number(meta[0].complete) !== 1) return { ok: false, error: 'Unggahan berkas tidak lengkap. Coba lagi.' };
  }
  return { ok: true, part, parts };
}

async function blobGet(db, req, body) {
  const { user } = await requireUser(db, req);
  const ctx = rules.makeCtx(user);
  const key = str(body.key, 240);
  const pol = blobPolicy(ctx, key);
  if (!pol || !pol.read) throw forbidden('Anda tidak berhak membuka berkas ini.');
  const part = Math.max(0, int(body.part, 0));
  const [meta, data] = await db.run([
    { sql: 'SELECT size, type, parts, complete FROM blob_meta WHERE key = ?', args: [key] },
    { sql: 'SELECT data FROM blobs WHERE key = ? AND part = ?', args: [key, part] }
  ]);
  if (!meta.length || Number(meta[0].complete) !== 1 || !data.length) return { ok: false, missing: true, error: 'Berkas tidak ditemukan di server.' };
  return { ok: true, size: Number(meta[0].size), type: meta[0].type || '', parts: Number(meta[0].parts), part, data: data[0].data };
}

async function blobDel(db, req, body) {
  const { user } = await requireUser(db, req);
  const ctx = rules.makeCtx(user);
  const prefix = str(body.prefix, 240);
  if (prefix) {
    if (!/^(music|cap):[A-Za-z0-9_.:-]*$/.test(prefix)) throw bad('Prefix tidak valid.');
    const pol = blobPolicy(ctx, prefix + 'x');
    if (!pol || !pol.del || (prefix.startsWith('cap:') && !/^cap:[^:]+:/.test(prefix) && !ctx.isAdmin)) throw forbidden('Anda tidak berhak menghapus berkas ini.');
    const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
    await db.atomic([
      { sql: 'DELETE FROM blobs WHERE key >= ? AND key < ?', args: [prefix, end] },
      { sql: 'DELETE FROM blob_meta WHERE key >= ? AND key < ?', args: [prefix, end] }
    ]);
    return { ok: true };
  }
  const key = str(body.key, 240);
  const pol = blobPolicy(ctx, key);
  if (!pol || !pol.del) throw forbidden('Anda tidak berhak menghapus berkas ini.');
  await db.atomic([
    { sql: 'DELETE FROM blobs WHERE key = ?', args: [key] },
    { sql: 'DELETE FROM blob_meta WHERE key = ?', args: [key] }
  ]);
  return { ok: true };
}

/* ============================ AI PROXY ============================ */
async function aiProxy(db, req, body) {
  const { user } = await requireUser(db, req);
  const now = Date.now();
  const key = 'ai:' + user.id;
  const st = await security.throttleState(db, key, now);
  if (st.lockedFor > 0) return { ok: true, status: 429, data: { error: { message: 'Batas permintaan AI tercapai.' } } };
  await security.throttleFail(db, key, { limit: 60, windowMs: 10 * 60000, lockMs: 2 * 60000 }, now);
  const s = await store.readSettings(db, ['aiEnabled', 'geminiApiKey', 'geminiModel', 'aiTimeoutMs']);
  const testKey = user.role === 'admin' ? str(body.testKey, 200).trim() : '';
  const apiKey = testKey && testKey !== MASK ? testKey : String(s.geminiApiKey || '').trim();
  if (s.aiEnabled === false && !testKey) return { ok: false, code: 'disabled', error: 'Fitur AI sedang dimatikan oleh admin pada menu Pengaturan.' };
  if (!apiKey) return { ok: false, code: 'nokey', error: 'Kunci API Gemini belum diisi. Admin dapat menambahkannya di Pengaturan → Integrasi AI.' };
  const model = /^[A-Za-z0-9._-]{1,80}$/.test(String(body.model || '')) ? body.model : (String(s.geminiModel || 'gemini-flash-latest'));
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : null;
  if (!payload || !Array.isArray(payload.contents)) throw bad('Permintaan AI tidak valid.');
  const timeout = Math.min(55000, Math.max(5000, Number(s.aiTimeoutMs) || 30000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify(payload), signal: ctrl.signal
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, code: e && e.name === 'AbortError' ? 'timeout' : 'network', error: e && e.name === 'AbortError' ? 'Permintaan ke AI melebihi batas waktu.' : 'Server tidak dapat menghubungi layanan AI.' };
  } finally {
    clearTimeout(timer);
  }
}

async function agentProxy(db, req, body) {
  const { user } = await requireUser(db, req);
  if (!['admin', 'guru'].includes(user.role)) throw forbidden('Agent API hanya untuk admin/tutor.');
  const s = await store.readSettings(db, ['aiEnabled', 'tinyfishApiKey', 'tinyfishEndpoint']);
  if (s.aiEnabled === false) return { ok: false, code: 'disabled', error: 'Fitur AI sedang dimatikan oleh admin pada menu Pengaturan.' };
  const endpoint = String(s.tinyfishEndpoint || '').trim();
  const apiKey = String(s.tinyfishApiKey || '').trim();
  if (!/^https:\/\//i.test(endpoint)) return { ok: false, code: 'noendpoint', error: 'Endpoint Agent API (https) belum diisi di Pengaturan → Integrasi AI.' };
  if (!apiKey) return { ok: false, code: 'nokey', error: 'Kunci Agent API belum diisi di Pengaturan → Integrasi AI.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 58000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ url: str(body.url, 2000), goal: str(body.goal, 4000) }), signal: ctrl.signal
    });
    const text = await res.text();
    return { ok: true, status: res.status, contentType: res.headers.get('content-type') || '', text: text.slice(0, 2000000) };
  } catch (e) {
    return { ok: false, code: e && e.name === 'AbortError' ? 'timeout' : 'network', error: 'Agent API tidak dapat dihubungi dari server.' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  HttpError, health, login, quizAnswer, register, logout, verify, sync,
  blobPut, blobGet, blobDel, aiProxy, agentProxy,
  _internals: { normalizeChanges, mergeChange, viewSig, publicUser }
};
