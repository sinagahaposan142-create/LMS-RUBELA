'use strict';
/* =====================================================================
 * Klien Turso/libSQL tanpa dependensi (protokol "SQL over HTTP",
 * Hrana v2 pipeline). Hanya memakai fetch bawaan Node 18+.
 * Spesifikasi: tursodatabase/libsql docs/HTTP_V2_SPEC.md & HRANA_3_SPEC.md
 * ===================================================================*/

const DEFAULT_TIMEOUT_MS = 20000;

/** Cari variabel lingkungan Turso (mendukung prefiks kustom Vercel). */
function findConfig(env) {
  const e = env || process.env;
  const names = Object.keys(e);
  const urlNames = names.filter(n => /(^|_)(TURSO_DATABASE_URL|LIBSQL_URL|TURSO_URL|LIBSQL_DATABASE_URL)$/.test(n) && e[n]);
  // Utamakan nama standar tanpa prefiks.
  urlNames.sort((a, b) => a.length - b.length);
  for (const urlVar of urlNames) {
    const prefix = urlVar.replace(/(TURSO_DATABASE_URL|LIBSQL_URL|TURSO_URL|LIBSQL_DATABASE_URL)$/, '');
    const tokenVar = [prefix + 'TURSO_AUTH_TOKEN', prefix + 'LIBSQL_AUTH_TOKEN', prefix + 'TURSO_TOKEN', prefix + 'TURSO_DATABASE_TOKEN']
      .find(n => e[n]);
    const url = toHttpUrl(e[urlVar]);
    if (!url) continue;
    if (tokenVar || /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) {
      return { url, token: tokenVar ? String(e[tokenVar]).trim() : '', urlVar, tokenVar: tokenVar || null };
    }
  }
  return null;
}

function toHttpUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^libsql:\/\//i, 'https://').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
  if (!/^https?:\/\//i.test(s)) return '';
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  return s.replace(/\/+$/, '');
}

/** Region database dari hostname, mis. "aws-ap-northeast-1". */
function regionOf(url) {
  const m = /\.((?:aws|gcp|fly)-[a-z0-9-]+)\.turso\.io/i.exec(String(url || ''));
  return m ? m[1] : null;
}

function encodeValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { type: 'null' };
    if (Number.isInteger(v)) return { type: 'integer', value: String(v) };
    return { type: 'float', value: v };
  }
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
}

function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  switch (v.type) {
    case 'null': return null;
    case 'integer': {
      const n = Number(v.value);
      return Number.isSafeInteger(n) ? n : String(v.value);
    }
    case 'float': return v.value == null ? NaN : Number(v.value);
    case 'text': return v.value == null ? '' : String(v.value);
    case 'blob': return Buffer.from(v.base64 || '', 'base64');
    default: return v.value != null ? v.value : null;
  }
}

function toStmt(s) {
  const sql = typeof s === 'string' ? s : s.sql;
  const args = typeof s === 'string' ? [] : (s.args || []);
  const out = { sql };
  if (args.length) out.args = args.map(encodeValue);
  if (s && s.wantRows === false) out.want_rows = false;
  return out;
}

function rowsOf(result) {
  if (!result) return [];
  const cols = (result.cols || []).map((c, i) => (c && c.name) || ('c' + i));
  return (result.rows || []).map(r => {
    const o = {};
    r.forEach((v, i) => { o[cols[i]] = decodeValue(v); });
    return o;
  });
}

class DbError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

function errorFrom(e) {
  const msg = (e && (e.message || e.error)) || 'kesalahan database';
  return new DbError((e && e.code) || 'SQL_ERROR', String(msg));
}

/** Rangkai langkah batch: setiap langkah hanya jalan bila langkah sebelumnya sukses. */
function chainSteps(stmts, startIndex) {
  const base = startIndex || 0;
  return stmts.map((s, i) => {
    const step = { stmt: toStmt(s) };
    if (base + i > 0) step.condition = { type: 'ok', step: base + i - 1 };
    return step;
  });
}

class TursoClient {
  constructor(opts) {
    this.url = opts.url;
    this.token = opts.token || '';
    this.timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
    this.fetch = opts.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('fetch tidak tersedia pada runtime ini.');
  }

  async post(baseUrl, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeout);
    let res;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = 'Bearer ' + this.token;
      res = await this.fetch((baseUrl || this.url) + '/v2/pipeline', {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal
      });
    } catch (e) {
      throw new DbError(e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        e && e.name === 'AbortError' ? 'Database tidak merespons (timeout).' : 'Tidak dapat menghubungi database: ' + ((e && e.message) || e));
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { const j = JSON.parse(text); msg = j.error || j.message || text; } catch (e) { /* teks biasa */ }
      throw new DbError(res.status === 401 ? 'AUTH' : 'HTTP', `Database menolak permintaan (HTTP ${res.status}): ${String(msg).slice(0, 200)}`, res.status);
    }
    try { return JSON.parse(text); } catch (e) { throw new DbError('PROTOCOL', 'Respons database bukan JSON.'); }
  }

  /**
   * Jalankan beberapa request Hrana pada satu stream baru lalu tutup.
   * Mengembalikan array hasil mentah { ok, result|error } sesuai urutan.
   */
  async rawPipeline(requests) {
    const data = await this.post(this.url, { baton: null, requests: requests.concat([{ type: 'close' }]) });
    const results = data.results || [];
    return requests.map((_, i) => results[i] || { type: 'error', error: { message: 'hasil hilang' } });
  }

  /** Jalankan statement satu per satu (autocommit). Error per statement dilempar. */
  async run(stmts) {
    const list = stmts.map(s => ({ type: 'execute', stmt: toStmt(s) }));
    const results = await this.rawPipeline(list);
    return results.map(r => {
      if (r.type !== 'ok') throw errorFrom(r.error);
      return rowsOf(r.response && r.response.result);
    });
  }

  async query(sql, args) {
    const [rows] = await this.run([{ sql, args }]);
    return rows;
  }

  /** Statement berurutan dalam satu transaksi atomik (semua atau tidak sama sekali). */
  async atomic(stmts) {
    const steps = chainSteps(['BEGIN'].concat(stmts).concat(['COMMIT']));
    const commitIdx = steps.length - 1;
    steps.push({ condition: { type: 'not', cond: { type: 'ok', step: commitIdx } }, stmt: toStmt('ROLLBACK') });
    const [r] = await this.rawPipeline([{ type: 'batch', batch: { steps } }]);
    if (r.type !== 'ok') throw errorFrom(r.error);
    const res = r.response.result;
    const errs = res.step_errors || [];
    const firstErr = errs.slice(0, commitIdx + 1).find(Boolean);
    if (!res.step_results[commitIdx]) throw errorFrom(firstErr || { message: 'transaksi dibatalkan' });
    return res.step_results.slice(1, commitIdx).map(rowsOf);
  }

  /**
   * Mulai transaksi interaktif sekaligus menjalankan statement awal
   * (satu round-trip). Mengembalikan { tx, rows }.
   */
  async begin(stmts) {
    const tx = new Transaction(this);
    const rows = await tx.begin(stmts || []);
    return { tx, rows };
  }

  /** Transaksi interaktif (baton). fn(tx) boleh memanggil tx.run([...]). */
  async transaction(fn) {
    const tx = new Transaction(this);
    try {
      await tx.begin();
      const out = await fn(tx);
      if (!tx.done) await tx.commit([]);
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }
}

class Transaction {
  constructor(client) {
    this.client = client;
    this.baton = null;
    this.baseUrl = null;
    this.done = false;
  }
  async send(requests, close) {
    const body = { baton: this.baton, requests: close ? requests.concat([{ type: 'close' }]) : requests };
    const data = await this.client.post(this.baseUrl || this.client.url, body);
    this.baton = data.baton || null;
    if (data.base_url) this.baseUrl = data.base_url;
    return data.results || [];
  }
  /** BEGIN (execute, sesuai contoh resmi transaksi interaktif) + statement awal berantai. */
  async begin(stmts) {
    const list = stmts || [];
    const reqs = [{ type: 'execute', stmt: toStmt('BEGIN') }];
    if (list.length) reqs.push({ type: 'batch', batch: { steps: chainSteps(list) } });
    const results = await this.send(reqs, false);
    const r0 = results[0];
    if (!r0 || r0.type !== 'ok') { await this.rollback(); throw errorFrom(r0 && r0.error); }
    if (!this.baton) throw new DbError('PROTOCOL', 'Database tidak membuka stream transaksi.');
    if (!list.length) return [];
    const r1 = results[1];
    if (!r1 || r1.type !== 'ok') { await this.rollback(); throw errorFrom(r1 && r1.error); }
    const res = r1.response.result;
    const err = (res.step_errors || []).find(Boolean);
    if (err || res.step_results.some(x => !x)) {
      await this.rollback();
      throw errorFrom(err || { message: 'transaksi gagal dimulai' });
    }
    return res.step_results.map(rowsOf);
  }
  /** Statement berantai di dalam transaksi; gagal satu → lempar error. */
  async run(stmts) {
    if (this.done) throw new DbError('TX_DONE', 'Transaksi sudah selesai.');
    const [r] = await this.send([{ type: 'batch', batch: { steps: chainSteps(stmts) } }], false);
    if (!r || r.type !== 'ok') throw errorFrom(r && r.error);
    const res = r.response.result;
    const err = (res.step_errors || []).find(Boolean);
    if (err || res.step_results.some(x => !x)) throw errorFrom(err || { message: 'langkah transaksi dilewati' });
    return res.step_results.map(rowsOf);
  }
  /**
   * Tulis + COMMIT secara atomik, lalu jalankan statement lanjutan
   * (autocommit) pada stream yang sama sebelum ditutup.
   */
  async commit(stmts, after) {
    const steps = chainSteps(stmts.concat(['COMMIT']));
    const commitIdx = steps.length - 1;
    steps.push({ condition: { type: 'not', cond: { type: 'ok', step: commitIdx } }, stmt: toStmt('ROLLBACK') });
    const extra = (after || []).map(s => ({ type: 'execute', stmt: toStmt(s) }));
    const results = await this.send([{ type: 'batch', batch: { steps } }].concat(extra), true);
    this.done = true;
    this.baton = null;
    const r = results[0];
    if (!r || r.type !== 'ok') throw errorFrom(r && r.error);
    const res = r.response.result;
    if (!res.step_results[commitIdx]) {
      throw errorFrom((res.step_errors || []).find(Boolean) || { message: 'commit gagal' });
    }
    return {
      rows: res.step_results.slice(0, commitIdx).map(rowsOf),
      after: extra.map((_, i) => {
        const x = results[1 + i];
        if (!x || x.type !== 'ok') return { error: errorFrom(x && x.error) };
        return { rows: rowsOf(x.response && x.response.result) };
      })
    };
  }
  async rollback() {
    if (!this.baton) { this.done = true; return; }
    try { await this.send([{ type: 'execute', stmt: toStmt('ROLLBACK') }], true); } catch (e) { /* stream kedaluwarsa = otomatis rollback */ }
    this.done = true;
    this.baton = null;
  }
}

module.exports = { TursoClient, DbError, findConfig, toHttpUrl, regionOf, encodeValue, decodeValue, rowsOf };
