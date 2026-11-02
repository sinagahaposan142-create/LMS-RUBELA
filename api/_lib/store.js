'use strict';
/* Koneksi database, skema, dan inisialisasi data awal server. */
const { TursoClient, findConfig, regionOf } = require('./turso');
const security = require('./security');
const catalog = require('../../js/sync-catalog.js');
const seedBase = require('./seed-base.json');

/* Hash password admin awal (username "admin"). Kata sandinya TIDAK pernah
 * ditulis di repositori; hanya hash scrypt ini yang disimpan. Ganti password
 * setelah login pertama, atau atur env ADMIN_INITIAL_PASSWORD sebelum
 * database pertama kali dibuat. */
const BOOTSTRAP_ADMIN_HASH = 'scrypt$16384$8$1$XT7xIoet34Oik+ocwj7rNQ==$9DHUrFKwsNAjAR1gRRFFupZLWHYDfQfJJ3zl46YOEzQ=';
const BOOTSTRAP_ADMIN = {
  id: 'u_admin', role: 'admin', username: 'admin', name: 'Administrator', email: 'admin@rubela.edu',
  status: 'Aktif', birthDate: '', photo: '', religion: '', streakShare: false
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (
     k TEXT NOT NULL, id TEXT NOT NULL, v TEXT, ver INTEGER NOT NULL, seq INTEGER NOT NULL,
     updated_at INTEGER NOT NULL, updated_by TEXT, PRIMARY KEY (k, id))`,
  'CREATE INDEX IF NOT EXISTS kv_ver ON kv (ver)',
  'CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT)',
  'CREATE TABLE IF NOT EXISTS auth (user_id TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT)`,
  'CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)',
  `CREATE TABLE IF NOT EXISTS throttle (
     key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL, locked_until INTEGER NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS presence (
     user_id TEXT NOT NULL, tab TEXT NOT NULL, data TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (user_id, tab))`,
  'CREATE TABLE IF NOT EXISTS blobs (key TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, part))',
  `CREATE TABLE IF NOT EXISTS blob_meta (
     key TEXT PRIMARY KEY, size INTEGER NOT NULL, type TEXT, parts INTEGER NOT NULL, owner TEXT,
     complete INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  "INSERT INTO meta (name, value) VALUES ('ver', '0') ON CONFLICT(name) DO NOTHING",
  "INSERT INTO meta (name, value) VALUES ('schema', '1') ON CONFLICT(name) DO NOTHING"
];

let cached = null;      // { key, db, ready }

function config() { return findConfig(process.env); }

/** Klien database (null bila env Turso belum diatur). */
function getDb() {
  const cfg = config();
  if (!cfg) return null;
  const key = cfg.url + '|' + cfg.token.length;
  if (!cached || cached.key !== key) cached = { key, db: new TursoClient({ url: cfg.url, token: cfg.token }), ready: null, cfg };
  return cached.db;
}

function dbInfo() {
  const cfg = config();
  if (!cfg) return { configured: false };
  return { configured: true, region: regionOf(cfg.url), urlVar: cfg.urlVar, tokenVar: cfg.tokenVar };
}

/** Skema + data awal; dijalankan sekali per instance fungsi. */
async function ensureReady(db) {
  if (!cached || cached.db !== db) throw new Error('database belum dipilih');
  if (!cached.ready) {
    cached.ready = (async () => {
      await db.run(SCHEMA);
      await initialize(db);
      await maybeResetAdmin(db);
    })().catch(e => { cached.ready = null; throw e; });
  }
  return cached.ready;
}

function parse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

/** Ubah satu kunci katalog menjadi baris server [{id, value}]. */
function rowsForKey(k, value) {
  const meta = catalog.info(k);
  if (!meta) return [];
  if (meta.type === catalog.RECORDS) {
    return (Array.isArray(value) ? value : []).map(rec => ({ id: catalog.idOf(k, rec), value: rec })).filter(r => r.id);
  }
  if (meta.type === catalog.MAP) {
    return Object.keys(value || {}).map(id => ({ id, value: value[id] }));
  }
  return [{ id: '*', value }];
}

async function initialize(db) {
  const done = await db.query("SELECT value FROM meta WHERE name = 'initialized'");
  if (done.length) return;
  const now = Date.now();
  const initialPw = String(process.env.ADMIN_INITIAL_PASSWORD || '');
  const adminHash = initialPw.length >= 10 ? await security.hashPassword(initialPw) : BOOTSTRAP_ADMIN_HASH;
  await db.transaction(async tx => {
    const [, verRows, initRows] = await tx.run([
      "UPDATE meta SET value = value WHERE name = 'ver'",
      "SELECT CAST(value AS INTEGER) AS v FROM meta WHERE name = 'ver'",
      "SELECT value FROM meta WHERE name = 'initialized'"
    ]);
    if (initRows.length) return;                    // instance lain sudah menginisialisasi
    let ver = Number(verRows[0] && verRows[0].v) || 0;
    const writes = [];
    const put = (k, id, value) => {
      ver++;
      writes.push({
        sql: `INSERT INTO kv (k, id, v, ver, seq, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, 'system')
              ON CONFLICT(k, id) DO NOTHING`,
        args: [k, id, JSON.stringify(value), ver, ver, now]
      });
    };
    put('lms_users', BOOTSTRAP_ADMIN.id, Object.assign({ createdAt: now }, BOOTSTRAP_ADMIN));
    Object.keys(seedBase.keys).forEach(k => rowsForKey(k, seedBase.keys[k]).forEach(r => put(k, r.id, r.value)));
    writes.push({ sql: 'INSERT INTO auth (user_id, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING', args: [BOOTSTRAP_ADMIN.id, adminHash, now] });
    writes.push({ sql: "UPDATE meta SET value = ? WHERE name = 'ver'", args: [String(ver)] });
    writes.push({ sql: "INSERT INTO meta (name, value) VALUES ('initialized', ?) ON CONFLICT(name) DO NOTHING", args: [String(now)] });
    await tx.commit(writes);
  });
}

/** Darurat: env ADMIN_RESET_PASSWORD mengganti password akun admin pertama. */
async function maybeResetAdmin(db) {
  const pw = String(process.env.ADMIN_RESET_PASSWORD || '');
  if (pw.length < 10) return;
  const admins = await db.query(
    "SELECT id FROM kv WHERE k = 'lms_users' AND v IS NOT NULL AND json_extract(v, '$.role') = 'admin' ORDER BY seq LIMIT 1");
  if (!admins.length) return;
  const id = admins[0].id;
  const cur = await db.query('SELECT hash FROM auth WHERE user_id = ?', [id]);
  if (cur.length && await security.verifyPassword(pw, cur[0].hash)) return;
  const hash = await security.hashPassword(pw);
  await db.run([
    { sql: 'INSERT INTO auth (user_id, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at', args: [id, hash, Date.now()] },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', args: [id] }
  ]);
}

/** Baca beberapa properti lms_settings → objek. */
async function readSettings(db, names) {
  const list = names && names.length ? names : null;
  const rows = list
    ? await db.query(`SELECT id, v FROM kv WHERE k = 'lms_settings' AND v IS NOT NULL AND id IN (${list.map(() => '?').join(',')})`, list)
    : await db.query("SELECT id, v FROM kv WHERE k = 'lms_settings' AND v IS NOT NULL");
  const out = {};
  rows.forEach(r => { out[r.id] = parse(r.v); });
  return out;
}

async function findUserByUsername(db, username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  const rows = await db.query(
    "SELECT id, v FROM kv WHERE k = 'lms_users' AND v IS NOT NULL AND lower(json_extract(v, '$.username')) = ? LIMIT 1", [u]);
  return rows.length ? parse(rows[0].v) : null;
}

async function getRecord(db, k, id) {
  const rows = await db.query('SELECT v FROM kv WHERE k = ? AND id = ?', [k, id]);
  return rows.length ? parse(rows[0].v) : null;
}

/* Hash pengganti (parameter sama) untuk login dengan username yang tidak ada. */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

module.exports = {
  getDb, dbInfo, ensureReady, parse, rowsForKey, readSettings, findUserByUsername, getRecord,
  BOOTSTRAP_ADMIN, DUMMY_HASH, catalog
};
