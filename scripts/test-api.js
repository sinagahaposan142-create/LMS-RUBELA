'use strict';
/* =====================================================================
 * Uji end-to-end API tanpa dependensi: database Turso tiruan (node:sqlite)
 * + /api/rubela asli, lewat HTTP sungguhan.
 *   node scripts/test-api.js
 * Mencakup: kebijakan berkas (QRIS, bukti transfer), validasi gambar,
 * pesan chat, dan video pembahasan.
 * Butuh Node.js >= 22.5.
 * ===================================================================*/
const http = require('http');

const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond });
  process.stdout.write((cond ? '  ok   ' : '  GAGAL ') + name + (cond || info == null ? '' : '  → ' + JSON.stringify(info).slice(0, 300)) + '\n');
}

async function main() {
  const { createMockTurso } = require('./mock-turso');
  const turso = createMockTurso({ file: ':memory:', token: 'test-token' });
  await new Promise(r => turso.listen(0, '127.0.0.1', r));
  process.env.TURSO_DATABASE_URL = 'http://127.0.0.1:' + turso.address().port;
  process.env.TURSO_AUTH_TOKEN = 'test-token';
  delete process.env.ADMIN_PASSWORD;
  const api = require('../api/rubela.js');
  const server = http.createServer((req, res) => { req.query = {}; api(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_API = 'http://127.0.0.1:' + server.address().port + '/api/rubela';

  async function call(action, body, token) {
    const res = await fetch(URL_API, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(Object.assign({ action }, body || {}))
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { status: res.status, data: data || {} };
  }
  async function login(username, password, role) {
    const r = await call('login', { username, password, role });
    if (!r.data.token) throw new Error('Login gagal untuk ' + username + ': ' + JSON.stringify(r.data));
    return r.data.token;
  }
  /** Kirim perubahan; kembalikan { applied, rejected }. */
  async function push(token, changes) {
    const r = await call('sync', { cursor: 0, changes: changes.map(c => Object.assign({ op: 'put' }, c)) }, token);
    return { status: r.status, applied: r.data.applied || [], rejected: r.data.rejected || [], data: r.data };
  }
  async function pull(token) {
    const r = await call('sync', { cursor: 0, full: true }, token);
    const map = {};
    (r.data.changes || r.data.items || []).forEach(x => { (map[x.k] = map[x.k] || {})[x.id] = x.v; });
    return map;
  }
  const b64 = (bytes) => Buffer.from(bytes).toString('base64');
  const PNG = b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
  const JPG = b64([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
  const HTML = b64(Buffer.from('<html><script>alert(1)</script></html>'));
  const putBlob = (token, key, data, type) => call('blob_put', { key, part: 0, parts: 1, size: Buffer.from(data, 'base64').length, type: type || 'image/png', data }, token);

  /* ---------- Persiapan akun ---------- */
  const admin = await login('admin', 'rubela2026', 'admin');
  let r = await push(admin, [
    { k: 'lms_settings', id: 'loginQuizEnabled', v: false },
    { k: 'lms_users', id: 'u_g1', v: { id: 'u_g1', role: 'guru', name: 'Guru Satu', username: 'guru1', password: 'rahasia1', status: 'Aktif' } },
    { k: 'lms_users', id: 'u_s1', v: { id: 'u_s1', role: 'siswa', name: 'Siswa Satu', username: 'siswa1', password: 'rahasia1', status: 'Aktif' } },
    { k: 'lms_users', id: 'u_s2', v: { id: 'u_s2', role: 'siswa', name: 'Siswa Dua', username: 'siswa2', password: 'rahasia1', status: 'Aktif' } }
  ]);
  check('admin membuat akun uji', r.rejected.length === 0, r.rejected);
  const guru = await login('guru1', 'rahasia1', 'guru');
  const s1 = await login('siswa1', 'rahasia1', 'siswa');
  const s2 = await login('siswa2', 'rahasia1', 'siswa');

  /* ---------- Penyimpanan berkas ---------- */
  console.log('\n[Penyimpanan berkas]');
  r = await putBlob(admin, 'qris:hc1:1', PNG);
  check('admin mengunggah QRIS (PNG)', r.data.ok, r.data);
  r = await putBlob(guru, 'qris:hc1:2', PNG);
  check('guru tidak boleh mengunggah QRIS', r.status === 403, r);
  r = await putBlob(admin, 'qris:hc1:3', HTML, 'image/png');
  check('QRIS berisi HTML (menyamar image/png) ditolak', r.status === 400, r);
  r = await call('blob_get', { key: 'qris:hc1:1', part: 0 }, s1);
  check('siswa dapat melihat QRIS', r.data.ok && r.data.type === 'image/png', r.data);
  r = await putBlob(s1, 'proof:u_s1:p1', JPG, 'application/octet-stream');
  check('siswa mengunggah bukti (JPG, tipe dikoreksi server)', r.data.ok, r.data);
  r = await call('blob_get', { key: 'proof:u_s1:p1', part: 0 }, s1);
  check('tipe bukti dicatat dari isi berkas', r.data.type === 'image/jpeg', r.data);
  r = await putBlob(s1, 'proof:u_s1:p1', PNG);
  check('bukti yang sudah tersimpan tidak dapat ditimpa', r.status === 403, r);
  r = await putBlob(s2, 'proof:u_s1:p9', PNG);
  check('siswa lain tidak dapat mengunggah atas nama siswa1', r.status === 403, r);
  r = await call('blob_get', { key: 'proof:u_s1:p1', part: 0 }, s2);
  check('siswa lain tidak dapat melihat bukti', r.status === 403, r);
  r = await call('blob_get', { key: 'proof:u_s1:p1', part: 0 }, guru);
  check('guru tidak dapat melihat bukti', r.status === 403, r);
  r = await call('blob_get', { key: 'proof:u_s1:p1', part: 0 }, admin);
  check('admin dapat melihat bukti', r.data.ok, r.data);
  r = await call('blob_del', { key: 'proof:u_s1:p1' }, s1);
  check('siswa tidak dapat menghapus bukti', r.status === 403, r);
  r = await call('blob_put', { key: 'proof:u_s1:p2', part: 0, parts: 1, size: 4 * 1024 * 1024, type: 'image/png', data: PNG }, s1);
  check('bukti melebihi 3 MB ditolak', r.status === 400, r);
  r = await putBlob(s1, 'proof:u_s1:../x', PNG);
  check('kunci bukti tidak valid ditolak', r.status === 403 || r.status === 400, r);

  /* ---------- Chat ---------- */
  console.log('\n[Chat]');
  const msg = { id: 'm1', senderId: 'u_s1', receiverId: 'u_g1', text: 'Halo $x^2$', createdAt: Date.now() };
  r = await push(s1, [{ k: 'lms_messages', id: 'm1', v: msg }]);
  check('siswa mengirim pesan', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_messages', id: 'm2', v: { id: 'm2', senderId: 'u_g1', receiverId: 'u_s1', text: 'palsu', createdAt: Date.now() } }]);
  check('pengirim palsu ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_messages', id: 'm3', v: { id: 'm3', senderId: 'u_g1', receiverId: 'u_s1', text: 'Balasan', createdAt: Date.now(), replyToId: 'm1', replyTo: { senderId: 'u_s1', text: 'Halo' } } }]);
  check('guru membalas dengan kutipan', r.rejected.length === 0 && r.applied[0].v.replyToId === 'm1', r);
  r = await push(guru, [{ k: 'lms_messages', id: 'm1', v: Object.assign({}, msg, { text: 'diubah penerima' }) }]);
  check('penerima tidak dapat mengubah pesan', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_messages', id: 'm1', v: Object.assign({}, msg, { text: '', deleted: true, deletedAt: Date.now() }) }]);
  check('pengirim menghapus pesan (hapus lunak)', r.rejected.length === 0 && r.applied[0].v.deleted === true && r.applied[0].v.text === '', r);
  r = await push(s1, [{ k: 'lms_messages', id: 'm4', v: { id: 'm4', senderId: 'u_s1', receiverId: 'u_g1', text: 'x'.repeat(2001), createdAt: Date.now() } }]);
  check('pesan > 2000 karakter ditolak', r.rejected.length === 1, r);

  /* ---------- Video pembahasan ---------- */
  console.log('\n[Video pembahasan]');
  const q = { id: 'q1', questionType: 'Pilihan Ganda', text: '<p>1+1?</p>', options: ['1', '2'], correctIndex: 1 };
  r = await push(guru, [{ k: 'lms_questions', id: 'q1', v: Object.assign({}, q, { explanationVideo: { id: 'dQw4w9WgXcQ', url: 'https://youtu.be/dQw4w9WgXcQ', noSkip: true } }) }]);
  check('guru menyimpan video pembahasan', r.rejected.length === 0, r.rejected);
  r = await push(admin, [{ k: 'lms_questions', id: 'q2', v: Object.assign({}, q, { id: 'q2', explanationVideo: { id: 'x"><script>', url: 'javascript:alert(1)' } }) }]);
  check('video pembahasan tidak valid ditolak (juga untuk admin)', r.rejected.length === 1, r);

  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lulus`);
  server.close(); turso.close && turso.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
