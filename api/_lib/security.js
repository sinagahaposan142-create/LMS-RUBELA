'use strict';
/* Hash password (scrypt), token sesi, dan pembatas percobaan (throttle). */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFKC'), salt, params.keylen, {
      N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024
    }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !password || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const params = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keylen: Buffer.from(parts[5], 'base64').length };
  if (!(params.N >= 1024 && params.N <= 1048576) || !params.keylen) return false;
  try {
    const key = await scryptAsync(password, Buffer.from(parts[4], 'base64'), params);
    const ref = Buffer.from(parts[5], 'base64');
    return key.length === ref.length && crypto.timingSafeEqual(key, ref);
  } catch (e) {
    return false;
  }
}

function newToken() { return crypto.randomBytes(32).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function randomId(prefix) { return (prefix ? prefix + '_' : '') + crypto.randomBytes(9).toString('base64url'); }

/** IP klien dari header Vercel (hanya untuk pembatas percobaan, tidak disimpan permanen). */
function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return (fwd || String(h['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown').slice(0, 64);
}

/* ---------- Throttle (tabel `throttle`) ---------- */
async function throttleState(db, key, now) {
  const rows = await db.query('SELECT count, window_start, locked_until FROM throttle WHERE key = ?', [key]);
  const r = rows[0];
  if (!r) return { count: 0, lockedFor: 0 };
  return { count: Number(r.count) || 0, windowStart: Number(r.window_start) || 0, lockedFor: Math.max(0, (Number(r.locked_until) || 0) - now) };
}

/** Catat satu kegagalan; kunci `lockMs` bila jumlah dalam `windowMs` mencapai `limit`. */
async function throttleFail(db, key, opts, now) {
  const o = Object.assign({ limit: 8, windowMs: 15 * 60000, lockMs: 15 * 60000 }, opts || {});
  await db.run([{
    sql: `INSERT INTO throttle (key, count, window_start, locked_until) VALUES (?, 1, ?, 0)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN throttle.window_start < ? THEN 1 ELSE throttle.count + 1 END,
            window_start = CASE WHEN throttle.window_start < ? THEN ? ELSE throttle.window_start END,
            locked_until = CASE WHEN (CASE WHEN throttle.window_start < ? THEN 1 ELSE throttle.count + 1 END) >= ? THEN ? ELSE throttle.locked_until END`,
    args: [key, now, now - o.windowMs, now - o.windowMs, now, now - o.windowMs, o.limit, now + o.lockMs]
  }]);
}

async function throttleClear(db, key) {
  await db.run([{ sql: 'DELETE FROM throttle WHERE key = ?', args: [key] }]);
}

/** Kunci sementara tanpa menghitung (mis. jeda kuis login). */
async function throttleLock(db, key, ms, now) {
  await db.run([{
    sql: `INSERT INTO throttle (key, count, window_start, locked_until) VALUES (?, 0, ?, ?)
          ON CONFLICT(key) DO UPDATE SET locked_until = excluded.locked_until`,
    args: [key, now, now + ms]
  }]);
}

module.exports = {
  hashPassword, verifyPassword, newToken, sha256, randomId, clientIp,
  throttleState, throttleFail, throttleClear, throttleLock, SCRYPT
};
