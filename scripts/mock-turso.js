'use strict';
/* =====================================================================
 * Server tiruan Turso (Hrana v2 /v2/pipeline) di atas node:sqlite.
 * HANYA untuk pengujian lokal (node scripts/dev-server.js). Mendukung
 * execute, batch + kondisi, close, baton untuk transaksi interaktif.
 * Butuh Node.js >= 22.5.
 * ===================================================================*/
const http = require('http');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

function decode(v) {
  if (!v) return null;
  switch (v.type) {
    case 'null': return null;
    case 'integer': { const n = Number(v.value); return Number.isSafeInteger(n) ? n : BigInt(v.value); }
    case 'float': return Number(v.value);
    case 'text': return String(v.value);
    case 'blob': return Buffer.from(v.base64 || '', 'base64');
    default: return null;
  }
}
function encode(x) {
  if (x === null || x === undefined) return { type: 'null' };
  if (typeof x === 'bigint') return { type: 'integer', value: x.toString() };
  if (typeof x === 'number') return Number.isInteger(x) ? { type: 'integer', value: String(x) } : { type: 'float', value: x };
  if (x instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(x).toString('base64').replace(/=+$/, '') };
  return { type: 'text', value: String(x) };
}

function createMockTurso(opts) {
  const o = opts || {};
  const db = new DatabaseSync(o.file || ':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  const token = o.token || 'test-token';
  const streams = new Map();          // baton -> stream
  let owner = null;                   // stream yang memegang transaksi terbuka
  const waiters = [];
  const stats = { requests: 0, statements: 0 };

  let busy = false;                   // sedang memproses satu request (sinkron)
  function wake() { waiters.splice(0).forEach(fn => fn()); }
  function release() { owner = null; wake(); }
  /** Satu koneksi SQLite dipakai bersama: tunggu sampai tidak ada transaksi stream lain. */
  async function acquire(stream) {
    for (;;) {
      if (!busy && (!owner || owner === stream)) { busy = true; return; }
      await new Promise(resolve => waiters.push(resolve));
    }
  }
  function done() { busy = false; wake(); }

  function execStmt(stream, s) {
    stats.statements++;
    const sql = String(s.sql || '');
    const args = (s.args || []).map(decode);
    const st = db.prepare(sql);
    const rows = st.all(...args);
    const meta = db.prepare('SELECT changes() AS c, last_insert_rowid() AS r').get();
    if (/^\s*BEGIN\b/i.test(sql)) { stream.inTx = true; owner = stream; }
    if (/^\s*(COMMIT|END|ROLLBACK)\b/i.test(sql)) { stream.inTx = false; }
    const cols = rows.length ? Object.keys(rows[0]).map(name => ({ name, decltype: null })) : [];
    return {
      cols,
      rows: rows.map(r => cols.map(c => encode(r[c.name]))),
      affected_row_count: Number(meta.c) || 0,
      last_insert_rowid: meta.r != null ? String(meta.r) : null,
      rows_read: rows.length, rows_written: 0, query_duration_ms: 0
    };
  }

  function evalCond(c, results) {
    if (!c) return true;
    switch (c.type) {
      case 'ok': return !!(results[c.step] && results[c.step].ok);
      case 'error': return !!(results[c.step] && results[c.step].err);
      case 'not': return !evalCond(c.cond, results);
      case 'and': return (c.conds || []).every(x => evalCond(x, results));
      case 'or': return (c.conds || []).some(x => evalCond(x, results));
      default: throw new Error('kondisi tidak dikenal ' + c.type);
    }
  }

  function handleRequest(stream, req) {
    if (req.type === 'close') { stream.closed = true; return { type: 'ok', response: { type: 'close' } }; }
    if (req.type === 'execute') {
      try { return { type: 'ok', response: { type: 'execute', result: execStmt(stream, req.stmt) } }; }
      catch (e) { return { type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } }; }
    }
    if (req.type === 'batch') {
      const steps = req.batch.steps || [];
      const state = [];
      const step_results = [], step_errors = [];
      steps.forEach((step, i) => {
        if (step.condition && step.condition.step != null && step.condition.step >= i) throw new Error('kondisi merujuk langkah berikutnya');
        if (!evalCond(step.condition, state)) { state.push({}); step_results.push(null); step_errors.push(null); return; }
        try { step_results.push(execStmt(stream, step.stmt)); step_errors.push(null); state.push({ ok: true }); }
        catch (e) { step_results.push(null); step_errors.push({ message: e.message, code: 'SQLITE_ERROR' }); state.push({ err: true }); }
      });
      return { type: 'ok', response: { type: 'batch', result: { step_results, step_errors } } };
    }
    return { type: 'error', error: { message: 'request tidak didukung: ' + req.type } };
  }

  // Stream transaksi yang ditinggal >10 detik otomatis di-rollback.
  const reaper = setInterval(() => {
    const now = Date.now();
    streams.forEach((s, baton) => {
      if (now - s.lastUsed > 10000) {
        if (s.inTx) { try { db.exec('ROLLBACK'); } catch (e) { /* noop */ } s.inTx = false; }
        streams.delete(baton);
        if (owner === s) release();
      }
    });
  }, 2000);
  reaper.unref();

  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/v2') return send(200, {});
    if (req.method !== 'POST' || req.url !== '/v2/pipeline') return send(404, { error: 'not found' });
    if ((req.headers.authorization || '') !== 'Bearer ' + token) return send(401, { error: 'unauthorized' });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      stats.requests++;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(400, { error: 'bad json' }); }
      let stream;
      if (body.baton) {
        stream = streams.get(body.baton);
        if (!stream) return send(404, { error: 'stream not found' });
        streams.delete(body.baton);
      } else stream = { id: crypto.randomUUID(), inTx: false };
      await acquire(stream);
      stream.lastUsed = Date.now();
      let results;
      try { results = (body.requests || []).map(r => handleRequest(stream, r)); }
      catch (e) {
        if (stream.inTx) { try { db.exec('ROLLBACK'); } catch (x) {} stream.inTx = false; }
        if (owner === stream) owner = null;
        done();
        return send(400, { error: e.message });
      }
      let baton = null;
      if (stream.closed) {
        if (stream.inTx) { try { db.exec('ROLLBACK'); } catch (e) {} stream.inTx = false; }
      } else {
        baton = crypto.randomBytes(12).toString('hex');
        streams.set(baton, stream);
      }
      if (!stream.inTx && owner === stream) owner = null;
      done();
      send(200, { baton, base_url: null, results });
    });
  });
  server.stats = stats;
  server.db = db;
  return server;
}

module.exports = { createMockTurso };

if (require.main === module) {
  const port = Number(process.env.MOCK_TURSO_PORT || 8780);
  createMockTurso({ file: process.env.MOCK_TURSO_FILE || ':memory:', token: process.env.MOCK_TURSO_TOKEN || 'test-token' })
    .listen(port, () => console.log('mock turso on http://127.0.0.1:' + port));
}
