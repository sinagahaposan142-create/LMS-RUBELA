'use strict';
/* =====================================================================
 * Satu-satunya Vercel Function LMS Rubela: /api/rubela
 *   GET  /api/rubela?action=health          → status server & database
 *   POST /api/rubela {action: ...}          → login, quiz, register, logout,
 *        verify, sync, blob_put, blob_get, blob_del, ai, agent
 * Database: Turso (env TURSO_DATABASE_URL + TURSO_AUTH_TOKEN).
 * ===================================================================*/
const store = require('./_lib/store');
const h = require('./_lib/handlers');

const PUBLIC = { health: h.health };
const ACTIONS = {
  login: h.login, quiz: h.quizAnswer, register: h.register, logout: h.logout, verify: h.verify,
  sync: h.sync, blob_put: h.blobPut, blob_get: h.blobGet, blob_del: h.blobDel, ai: h.aiProxy, agent: h.agentProxy
};

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    if (typeof req.body === 'object') return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 5 * 1024 * 1024) throw new h.HttpError(413, 'Permintaan terlalu besar.');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(obj));
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url, 'http://x').searchParams); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Allow', 'GET, POST, OPTIONS'); return res.end(); }
  let body = {};
  const q = queryOf(req);
  try {
    if (req.method === 'POST') {
      try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { ok: false, error: e.status ? e.message : 'Body JSON tidak valid.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
    } else if (req.method !== 'GET') {
      return send(res, 405, { ok: false, error: 'Metode tidak didukung.' });
    }
    const action = String(body.action || q.action || 'health');
    const db = store.getDb();
    if (PUBLIC[action]) return send(res, 200, await PUBLIC[action](db, req, body));
    const fn = ACTIONS[action];
    if (!fn) return send(res, 404, { ok: false, error: 'Aksi tidak dikenal.' });
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Gunakan POST.' });
    if (!db) return send(res, 503, { ok: false, code: 'not_configured', error: 'Server belum terhubung ke database. Hubungi admin.' });
    await store.ensureReady(db);
    return send(res, 200, await fn(db, req, body));
  } catch (e) {
    if (e instanceof h.HttpError) return send(res, e.status, Object.assign({ ok: false, error: e.message }, e.extra));
    console.error('[api/rubela]', e && (e.stack || e));
    const dbDown = e && ['NETWORK', 'TIMEOUT', 'HTTP', 'AUTH'].includes(e.code);
    return send(res, dbDown ? 503 : 500, { ok: false, code: dbDown ? 'db_unavailable' : 'server_error',
      error: dbDown ? 'Database sedang tidak dapat diakses. Coba lagi sebentar lagi.' : 'Terjadi kesalahan di server. Coba lagi.' });
  }
};
