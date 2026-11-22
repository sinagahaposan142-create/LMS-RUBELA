'use strict';
/* =====================================================================
 * Uji end-to-end API tanpa dependensi: database Turso tiruan (node:sqlite)
 * + /api/rubela asli, lewat HTTP sungguhan.
 *   node scripts/test-api.js
 * Mencakup: kebijakan berkas (QRIS, bukti transfer), validasi gambar,
 * pesan chat, video pembahasan, pembayaran Course Mandiri, remedial ujian, berita publik, dan Tools (data PTN,
 * jadwal seleksi, rencana UTBK), dan Grup Belajar.
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
  const server = http.createServer((req, res) => api(req, res));      // query string diurai api/rubela.js
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
    (r.data.records || []).forEach(x => { (map[x.k] = map[x.k] || {})[x.id] = x.v; });
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

  /* ---------- Avatar almamater / foto profil ---------- */
  console.log('\n[Foto profil]');
  const meS1 = (await pull(s1)).lms_users.u_s1;
  r = await push(s1, [{ k: 'lms_users', id: 'u_s1', v: Object.assign({}, meS1, { photo: 'av1:ui:f:2' }) }]);
  check('siswa memilih avatar almamater', r.rejected.length === 0 && r.applied[0].v.photo === 'av1:ui:f:2', r.rejected);
  r = await push(s1, [{ k: 'lms_users', id: 'u_s1', v: Object.assign({}, meS1, { photo: 'javascript:alert(1)' }) }]);
  check('foto profil bukan gambar ditolak', r.rejected.length === 1 && /Foto profil/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [{ k: 'lms_users', id: 'u_s1', v: Object.assign({}, meS1, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(300000) }) }]);
  check('foto profil terlalu besar ditolak', r.rejected.length === 1 && /terlalu besar/.test(r.rejected[0].reason), r.rejected);
  const meS2 = (await pull(admin)).lms_users.u_s2;
  r = await push(admin, [{ k: 'lms_users', id: 'u_s2', v: Object.assign({}, meS2, { photo: 'data:image/png;base64,' + PNG }) }]);
  check('admin menyimpan foto kecil yang valid', r.rejected.length === 0, r.rejected);

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

  /* ---------- Whiteboard: papan per pertemuan + berkas PDF/gambar ---------- */
  console.log('\n[Whiteboard]');
  r = await push(admin, [
    { k: 'lms_users', id: 'u_g2', v: { id: 'u_g2', role: 'guru', name: 'Guru Dua', username: 'guru2', password: 'rahasia1', status: 'Aktif' } },
    { k: 'lms_courses', id: 'c_wb', v: { id: 'c_wb', title: 'Kelas WB', teacherIds: ['u_g1'], teacherId: 'u_g1', mainClasses: [] } },
    { k: 'lms_enrollments', id: 'e_wb', v: { id: 'e_wb', courseId: 'c_wb', studentId: 'u_s1' } }
  ]);
  check('kelas whiteboard disiapkan', r.rejected.length === 0, r.rejected);
  const guru2 = await login('guru2', 'rahasia1', 'guru');
  const wbRec = { id: 'wb1', courseId: 'c_wb', title: 'Pertemuan 1 — Barisan', topic: 'Barisan', createdBy: 'u_g1', strokes: [], media: [{ key: 'wb:c_wb:wb1:a', bytes: 20 }] };
  r = await push(guru, [{ k: 'lms_whiteboards', id: 'wb1', v: wbRec }]);
  check('tutor membuat papan berjudul & bermateri', r.rejected.length === 0, r.rejected);
  r = await push(guru, [{ k: 'lms_whiteboards', id: 'wb2', v: Object.assign({}, wbRec, { id: 'wb2', media: [{ key: 'wb:c_lain:x:y', bytes: 1 }] }) }]);
  check('rujukan berkas kelas lain ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_whiteboards', id: 'wb3', v: Object.assign({}, wbRec, { id: 'wb3', thumb: 'data:text/html;base64,PHNjcmlwdD4=' }) }]);
  check('gambar mini bukan gambar ditolak', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_whiteboards', id: 'wb1', v: Object.assign({}, wbRec, { title: 'diubah' }) }]);
  check('mentee tidak dapat mengubah papan', r.rejected.length === 1, r);
  r = await putBlob(guru, 'wb:c_wb:wb1:a', JPG, 'image/jpeg');
  check('tutor kelas mengunggah halaman PDF/gambar', r.data.ok, r.data);
  r = await putBlob(guru2, 'wb:c_wb:wb1:b', JPG, 'image/jpeg');
  check('tutor kelas lain tidak dapat mengunggah', r.status === 403, r);
  r = await putBlob(s1, 'wb:c_wb:wb1:c', JPG, 'image/jpeg');
  check('mentee tidak dapat mengunggah', r.status === 403, r);
  r = await putBlob(guru, 'wb:c_wb:wb1:d', HTML, 'image/png');
  check('berkas bukan gambar ditolak', r.status === 400, r);
  r = await call('blob_put', { key: 'wb:c_wb:wb1:e', part: 0, parts: 2, size: 1024 * 1024, type: 'image/jpeg', data: JPG }, guru);
  check('halaman > 900 KB ditolak', r.status === 400, r);
  r = await call('blob_get', { key: 'wb:c_wb:wb1:a', part: 0 }, s1);
  check('mentee kelas dapat melihat berkas papan', r.data.ok && r.data.type === 'image/jpeg', r.data);
  r = await call('blob_get', { key: 'wb:c_wb:wb1:a', part: 0 }, s2);
  check('mentee kelas lain tidak dapat melihat berkas papan', r.status === 403, r);
  r = await call('blob_get', { key: 'wb:c_wb:wb1:a', part: 0 }, guru2);
  check('tutor kelas lain tidak dapat melihat berkas papan', r.status === 403, r);
  // Kuota 8 MB per kelas: 9 berkas ~900 KB (dua bagian) melewati batas.
  const big = b64(Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(560000)]));
  let quotaHit = null;
  for (let i = 0; i < 12 && !quotaHit; i++) {
    const key = 'wb:c_wb:wb1:q' + i;
    const r0 = await call('blob_put', { key, part: 0, parts: 2, size: 900 * 1024, type: 'image/jpeg', data: big.slice(0, 786432 / 3 * 4) }, guru);
    if (r0.status === 400) { quotaHit = { i, r0 }; break; }
    await call('blob_put', { key, part: 1, parts: 2, size: 900 * 1024, type: 'image/jpeg', data: big.slice(0, 1000) }, guru);
  }
  check('kuota berkas whiteboard 8 MB per kelas ditegakkan', quotaHit && quotaHit.i >= 8 && /penuh/.test(quotaHit.r0.data.error || ''), quotaHit);
  r = await call('blob_del', { prefix: 'wb:c_wb:' }, guru2);
  check('tutor kelas lain tidak dapat menghapus berkas papan', r.status === 403, r);
  r = await call('blob_del', { prefix: 'wb:c_wb:wb1:' }, guru);
  check('tutor kelas menghapus semua berkas papan', r.data.ok, r.data);
  r = await call('blob_get', { key: 'wb:c_wb:wb1:a', part: 0 }, s1);
  check('berkas papan terhapus', r.data.missing === true, r.data);

  /* ---------- Jadwal & presensi: hak tutor per pertemuan ---------- */
  console.log('\n[Jadwal & presensi]');
  r = await push(admin, [
    { k: 'lms_users', id: 'u_g3', v: { id: 'u_g3', role: 'guru', name: 'Guru Tiga', username: 'guru3', password: 'rahasia1', status: 'Aktif' } },
    { k: 'lms_courses', id: 'c_att', v: { id: 'c_att', title: 'Kelas Presensi', teacherIds: ['u_g1', 'u_g2'], teacherId: 'u_g1', mainClasses: [] } }
  ]);
  check('kelas dua tutor disiapkan', r.rejected.length === 0, r.rejected);
  const guru3 = await login('guru3', 'rahasia1', 'guru');
  const plan = { id: 'pl_a', courseId: 'c_att', date: '2026-12-01', time: '19:00', endTime: '20:30', status: 'draft', topic: 'Logika', teacherIds: ['u_g1'], teacherId: 'u_g1' };
  r = await push(guru, [{ k: 'lms_class_plans', id: 'pl_a', v: plan }]);
  check('tutor kelas membuat rencana 90 menit', r.rejected.length === 0, r.rejected);
  r = await push(guru, [{ k: 'lms_class_plans', id: 'pl_b', v: Object.assign({}, plan, { id: 'pl_b', endTime: '20:00' }) }]);
  check('rencana yang tidak 90 menit ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_class_plans', id: 'pl_c', v: Object.assign({}, plan, { id: 'pl_c', teacherIds: ['u_g1', 'u_g3'] }) }]);
  check('tutor luar kelas tidak dapat dijadikan pengajar', r.rejected.length === 1, r);
  r = await push(guru3, [{ k: 'lms_class_plans', id: 'pl_d', v: Object.assign({}, plan, { id: 'pl_d' }) }]);
  check('tutor luar kelas tidak dapat membuat rencana', r.rejected.length === 1, r);
  r = await push(guru2, [{ k: 'lms_class_plans', id: 'pl_a', v: Object.assign({}, plan, { topic: 'diubah tutor lain' }) }]);
  check('tutor lain tidak dapat mengubah rencana pertemuan', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_class_plans', id: 'pl_a', v: Object.assign({}, plan, { teacherIds: ['u_g1', 'u_g2'], teacherId: 'u_g1' }) }]);
  check('pertemuan diajar dua tutor', r.rejected.length === 0, r.rejected);
  r = await push(guru, [{ k: 'lms_class_plans', id: 'pl_a', v: Object.assign({}, plan, { teacherIds: ['u_g1'], teacherId: 'u_g1' }) }]);
  check('tim pengajar dikembalikan ke satu tutor', r.rejected.length === 0, r.rejected);
  const pres = { id: 'at_a', courseId: 'c_att', userId: 'u_s1', role: 'siswa', date: '2026-12-01', planId: 'pl_a', status: 'hadir', note: '' };
  r = await push(guru, [{ k: 'lms_attendance', id: 'at_a', v: pres }]);
  check('tutor pertemuan mengisi presensi', r.rejected.length === 0 && r.applied[0].v.markedBy === 'u_g1', r.rejected);
  r = await push(guru2, [{ k: 'lms_attendance', id: 'at_a', v: Object.assign({}, pres, { status: 'alfa' }) }]);
  check('tutor lain tidak dapat mengubah presensi pertemuan', r.rejected.length === 1, r);
  r = await push(guru2, [{ k: 'lms_attendance', id: 'at_a', op: 'del' }]);
  check('tutor lain tidak dapat menghapus presensi pertemuan', r.rejected.length === 1, r);
  r = await push(guru2, [{ k: 'lms_attendance', id: 'at_b', v: Object.assign({}, pres, { id: 'at_b', userId: 'u_s2', status: 'izin' }) }]);
  check('tutor lain tidak dapat mengisi presensi pertemuan tutor lain', r.rejected.length === 1, r);
  r = await push(guru2, [{ k: 'lms_attendance', id: 'at_c', v: Object.assign({}, pres, { id: 'at_c', date: '2026-12-03', planId: null }) }]);
  check('tanpa rencana: tutor kelas boleh mengisi presensi', r.rejected.length === 0, r.rejected);
  r = await push(guru3, [{ k: 'lms_attendance', id: 'at_d', v: Object.assign({}, pres, { id: 'at_d', date: '2026-12-03', planId: null }) }]);
  check('tutor luar kelas tidak dapat mengisi presensi', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_attendance', id: 'at_e', v: Object.assign({}, pres, { id: 'at_e', status: 'hadirr' }) }]);
  check('status presensi tidak dikenal ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_attendance', id: 'at_a', v: Object.assign({}, pres, { date: '2026-12-03' }) }]);
  check('presensi tidak dapat dipindah tanggal', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_attendance', id: 'at_f', v: Object.assign({}, pres, { id: 'at_f' }) }]);
  check('mentee tidak dapat mengisi presensi', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_attendance', id: 'at_a', op: 'del' }]);
  check('tutor pertemuan mengosongkan presensi', r.rejected.length === 0, r.rejected);
  const mp = { id: 'mp_a', courseId: 'c_att', week: 1, title: 'Logika Proposisi', teacherIds: ['u_g1'], note: '' };
  r = await push(guru2, [{ k: 'lms_material_plans', id: 'mp_a', v: mp }]);
  check('tutor kelas mengisi rencana materi', r.rejected.length === 0, r.rejected);
  r = await push(guru3, [{ k: 'lms_material_plans', id: 'mp_b', v: Object.assign({}, mp, { id: 'mp_b' }) }]);
  check('tutor luar kelas tidak dapat mengisi rencana materi', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_material_plans', id: 'mp_c', v: Object.assign({}, mp, { id: 'mp_c', week: 0 }) }]);
  check('minggu rencana materi di luar 1–60 ditolak', r.rejected.length === 1, r);
  r = await push(admin, [{ k: 'lms_material_plans', id: 'mp_d', v: Object.assign({}, mp, { id: 'mp_d', title: '<b>x</b>' }) }]);
  check('nama materi berisi tag ditolak (juga admin)', r.rejected.length === 1, r);

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

  /* ---------- Teks bacaan ---------- */
  console.log('\n[Teks bacaan]');
  const psg = { id: 'p1', title: 'Teks 1', subject: 'Literasi Bahasa Indonesia', html: '<p>Hutan mangrove melindungi pantai.</p>', createdAt: Date.now() };
  r = await push(guru, [{ k: 'lms_passages', id: 'p1', v: psg }]);
  check('tutor menyimpan teks bacaan', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_passages', id: 'p2', v: Object.assign({}, psg, { id: 'p2' }) }]);
  check('mentee tidak dapat menulis teks bacaan', r.rejected.length === 1, r);
  r = await push(admin, [{ k: 'lms_passages', id: 'p3', v: Object.assign({}, psg, { id: 'p3', html: '<p onclick="x()">a</p><script>alert(1)</script>' }) }]);
  check('teks bacaan berskrip ditolak (juga untuk admin)', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_passages', id: 'p4', v: Object.assign({}, psg, { id: 'p4', html: '   ' }) }]);
  check('teks bacaan kosong ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_passages', id: 'p5', v: Object.assign({}, psg, { id: 'p5', title: 'J'.repeat(121) }) }]);
  check('judul teks bacaan > 120 karakter ditolak', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_questions', id: 'q3', v: Object.assign({}, q, { id: 'q3', passageId: 'p1' }) }]);
  check('soal merujuk teks bacaan', r.rejected.length === 0 && r.applied[0].v.passageId === 'p1', r.rejected);
  r = await push(guru, [{ k: 'lms_questions', id: 'q4', v: Object.assign({}, q, { id: 'q4', passageId: { x: 1 } }) }]);
  check('rujukan teks bacaan tidak valid ditolak', r.rejected.length === 1, r);

  /* ---------- Course berbayar ---------- */
  console.log('\n[Course berbayar]');
  const lesson = { id: 'l1', title: 'Pengantar', type: 'article', content: '<p>ISI RAHASIA</p>', durationMin: 5 };
  const course = { id: 'hc1', title: 'Persiapan UTBK', active: true, enrollMode: 'open', audience: { type: 'all' },
    sections: [{ id: 's1', title: 'Bab 1', lessons: [lesson, { id: 'l2', title: 'Kuis', type: 'quiz', questions: [{ text: 'q', options: ['a', 'b'], correctIndex: 0 }] }] }],
    accessType: 'paid', price: 150000, payment: { bank: 'BCA', accountNo: '1234567890', accountName: 'Rubela', qrisKey: 'qris:hc1:1', instructions: '' } };
  r = await push(admin, [{ k: 'lms_hub_courses', id: 'hc1', v: Object.assign({}, course, { price: 50 }) }]);
  check('harga di bawah Rp1.000 ditolak (juga untuk admin)', r.rejected.length === 1, r);
  r = await push(admin, [{ k: 'lms_hub_courses', id: 'hc1', v: Object.assign({}, course, { payment: { bank: 'BCA', accountNo: '', accountName: '' } }) }]);
  check('course berbayar tanpa rekening/QRIS ditolak', r.rejected.length === 1, r);
  r = await push(admin, [{ k: 'lms_hub_courses', id: 'hc1', v: course }]);
  check('admin menyimpan course berbayar', r.rejected.length === 0, r.rejected);
  let view = await pull(s1);
  let hc = (view.lms_hub_courses || {}).hc1;
  check('siswa melihat kurikulum tanpa isi (dikunci server)', hc && hc.contentLocked && !hc.sections[0].lessons[0].content && hc.sections[0].lessons[0].title === 'Pengantar' && !hc.sections[0].lessons[1].questions, hc && hc.sections);
  check('isi rahasia tidak terkirim ke siswa', !JSON.stringify(hc).includes('ISI RAHASIA'));
  view = await pull(guru);
  check('guru juga tidak menerima isi course berbayar', !JSON.stringify(view.lms_hub_courses || {}).includes('ISI RAHASIA'));
  view = await pull(admin);
  check('admin menerima isi lengkap', JSON.stringify(view.lms_hub_courses.hc1).includes('ISI RAHASIA'));
  const prog = { id: 'hp1', courseId: 'hc1', studentId: 'u_s1', enrolledAt: Date.now(), completed: {}, quiz: {}, notes: {} };
  r = await push(s1, [{ k: 'lms_hub_progress', id: 'hp1', v: prog }]);
  check('siswa tidak dapat bergabung sebelum pembayaran disetujui', r.rejected.length === 1, r);

  r = await putBlob(s1, 'proof:u_s1:p5', JPG);
  const pay = { id: 'pay1', courseId: 'hc1', studentId: 'u_s1', amount: 150000, status: 'pending', proofKey: 'proof:u_s1:p5', note: 'a.n. Budi <b>', createdAt: Date.now() };
  r = await push(s1, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, pay, { amount: 1000 }) }]);
  check('nominal tidak sesuai harga ditolak', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, pay, { proofKey: 'proof:u_s2:x' }) }]);
  check('bukti milik siswa lain ditolak', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, pay, { status: 'approved' }) }]);
  check('siswa mengirim status "approved" → dipaksa "pending"', r.rejected.length === 0 && r.applied[0].v.status === 'pending', r);
  check('catatan siswa disanitasi', r.applied[0] && !/[<>]/.test(r.applied[0].v.note), r.applied[0]);
  r = await push(s1, [{ k: 'lms_hub_payments', id: 'pay2', v: Object.assign({}, pay, { id: 'pay2', proofKey: 'proof:u_s1:p6' }) }]);
  check('pembayaran ganda saat masih menunggu ditolak', r.rejected.length === 1, r);
  r = await push(s1, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, pay, { status: 'approved', note: 'x' }) }]);
  check('siswa tidak dapat mengubah pembayarannya', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_hub_payments', id: 'pay3', v: Object.assign({}, pay, { id: 'pay3', studentId: 'u_g1' }) }]);
  check('guru tidak dapat membuat pembayaran', r.rejected.length === 1, r);
  view = await pull(s2);
  check('siswa lain tidak melihat pembayaran siswa1', !(view.lms_hub_payments || {}).pay1);

  const cur = (await pull(admin)).lms_hub_payments.pay1;
  r = await push(admin, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, cur, { status: 'rejected', rejectReason: '' }) }]);
  check('penolakan tanpa alasan ditolak', r.rejected.length === 1, r);
  r = await push(admin, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, cur, { status: 'approved' }) }]);
  check('admin menyetujui pembayaran (pemutus & waktu dicatat server)', r.rejected.length === 0 && !!r.applied[0].v.decidedBy && !!r.applied[0].v.decidedAt, r);
  view = await pull(s1);
  hc = view.lms_hub_courses.hc1;
  check('setelah disetujui, siswa menerima isi lengkap', hc && !hc.contentLocked && JSON.stringify(hc).includes('ISI RAHASIA'), hc && hc.contentLocked);
  r = await push(s1, [{ k: 'lms_hub_progress', id: 'hp1', v: prog }]);
  check('siswa dapat bergabung setelah disetujui', r.rejected.length === 0, r.rejected);
  view = await pull(s2);
  check('siswa lain tetap terkunci', view.lms_hub_courses.hc1.contentLocked === true);

  // Sinkron bertahap (cursor): perangkat siswa menerima versi baru course saat akses dicabut
  let page = await call('sync', { cursor: 0, full: true }, s1);
  let cursor = page.data.cursor;
  while (page.data.more) { page = await call('sync', { cursor }, s1); cursor = page.data.cursor; }
  const appr = (await pull(admin)).lms_hub_payments.pay1;
  r = await push(admin, [{ k: 'lms_hub_payments', id: 'pay1', v: Object.assign({}, appr, { status: 'rejected', rejectReason: 'Dana dikembalikan' }) }]);
  check('admin mencabut akses dengan alasan', r.rejected.length === 0, r.rejected);
  const inc = await call('sync', { cursor }, s1);
  const upd = (inc.data.records || []).find(x => x.k === 'lms_hub_courses' && x.id === 'hc1');
  check('perubahan akses ikut tersinkron sebagai pembaruan course', upd && upd.v.contentLocked === true, (inc.data.records || []).map(x => x.k));

  /* ---------- Course mandiri: tutor course ---------- */
  console.log('\n[Course mandiri: tutor]');
  const hub2 = { id: 'hc2', title: 'Logika Dasar', active: true, enrollMode: 'open', audience: { type: 'all' }, tutorIds: ['u_g1'], accessType: 'free',
    sections: [{ id: 's1', title: 'Bab 1', lessons: [{ id: 'q1', title: 'Kuis', type: 'quiz', questions: [{ text: 'q', options: ['a', 'b'], correctIndex: 0 }, { questionType: 'Esai', text: 'Jelaskan' }] }] }] };
  r = await push(admin, [{ k: 'lms_hub_courses', id: 'hc2', v: hub2 }]);
  check('admin menetapkan tutor course', r.rejected.length === 0, r.rejected);
  const hp2 = { id: 'hp2', courseId: 'hc2', studentId: 'u_s1', enrolledAt: Date.now(), completed: {}, notes: { q1: 'catatan pribadi' },
    quiz: { q1: { score: 100, passed: true, answers: [0, 'Jawaban esai saya'], at: Date.now() } } };
  r = await push(s1, [{ k: 'lms_hub_progress', id: 'hp2', v: Object.assign({}, hp2, { review: { q1: { scores: { 1: 100 }, feedback: 'palsu' } } }) }]);
  check('mentee bergabung; penilaian buatan sendiri dibuang', r.rejected.length === 0 && r.applied[0] && !r.applied[0].v.review, r);
  view = await pull(guru);
  check('tutor course menerima jawaban esai peserta', JSON.stringify(((view.lms_hub_progress || {}).hp2 || {}).quiz || {}).includes('Jawaban esai saya'));
  view = await pull(guru2);
  const hubOther = JSON.stringify((view.lms_hub_progress || {}).hp2 || {});
  check('tutor lain tidak menerima jawaban & catatan peserta', hubOther !== '{}' && !hubOther.includes('Jawaban esai saya') && !hubOther.includes('catatan pribadi'), hubOther);
  const hubEdited = Object.assign({}, hub2, { title: 'Diganti tutor', accessType: 'paid', price: 99999, tutorIds: ['u_g1', 'u_g2'],
    sections: [{ id: 's1', title: 'Bab 1 (revisi)', lessons: hub2.sections[0].lessons.concat([{ id: 'a2', title: 'Ringkasan', type: 'article', content: '<p>Ringkasan</p>' }]) }] });
  r = await push(guru, [{ k: 'lms_hub_courses', id: 'hc2', v: hubEdited }]);
  check('tutor course mengubah kurikulum', r.rejected.length === 0 && r.applied[0] && r.applied[0].v.sections[0].lessons.length === 2, r.rejected);
  const hubAp = (r.applied[0] || {}).v || {};
  check('tutor tidak dapat mengubah judul, akses, harga, atau daftar tutor', hubAp.title === 'Logika Dasar' && hubAp.accessType === 'free' && JSON.stringify(hubAp.tutorIds) === '["u_g1"]', hubAp);
  r = await push(guru2, [{ k: 'lms_hub_courses', id: 'hc2', v: hubEdited }]);
  check('tutor lain tidak dapat mengubah course', r.rejected.length === 1, r);
  r = await push(guru, [{ k: 'lms_hub_courses', id: 'hc2', v: Object.assign({}, hubEdited, { sections: [{ id: 's1', title: 'Bab', lessons: [{ id: 'x', title: 'X', type: 'article', content: '<img src=x onerror=alert(1)>' }] }] }) }]);
  check('isi pelajaran berisi skrip ditolak', r.rejected.length === 1, r);
  const hubCur2 = (await pull(guru)).lms_hub_progress.hp2;
  r = await push(guru, [{ k: 'lms_hub_progress', id: 'hp2', v: Object.assign({}, hubCur2, { completed: { q1: true }, review: { q1: { scores: { 1: 85 }, feedback: 'Bagus' } } }) }]);
  const hubRv = ((r.applied[0] || {}).v || {});
  check('tutor menilai esai (penilai dicap server, progres lain tidak berubah)', r.rejected.length === 0 && hubRv.review && hubRv.review.q1.gradedBy === 'u_g1' && !(hubRv.completed || {}).q1, r);
  r = await push(guru, [{ k: 'lms_hub_progress', id: 'hp2', v: Object.assign({}, hubCur2, { review: { q1: { scores: { 1: 150 } } } }) }]);
  check('nilai esai di luar 0–100 ditolak', r.rejected.length === 1, r);
  r = await push(guru2, [{ k: 'lms_hub_progress', id: 'hp2', v: Object.assign({}, hubCur2, { review: { q1: { scores: { 1: 10 } } } }) }]);
  check('tutor lain tidak dapat menilai', r.rejected.length === 1, r);
  const hubMine = (await pull(s1)).lms_hub_progress.hp2;
  check('mentee menerima nilai & umpan balik tutor', hubMine && hubMine.review && hubMine.review.q1.feedback === 'Bagus', hubMine && hubMine.review);
  r = await push(s1, [{ k: 'lms_hub_progress', id: 'hp2', v: Object.assign({}, hubMine, { review: { q1: { scores: { 1: 100 }, feedback: 'diubah' } }, lastActiveAt: Date.now() }) }]);
  check('mentee tidak dapat mengubah nilai esai', r.rejected.length === 0 && r.applied[0] && r.applied[0].v.review.q1.feedback === 'Bagus', r.applied[0] && r.applied[0].v.review);
  let hubPg = await call('sync', { cursor: 0, full: true }, guru2);
  let hubPgCur = hubPg.data.cursor;
  while (hubPg.data.more) { hubPg = await call('sync', { cursor: hubPgCur }, guru2); hubPgCur = hubPg.data.cursor; }
  const hubNow = (await pull(admin)).lms_hub_courses.hc2;
  r = await push(admin, [{ k: 'lms_hub_courses', id: 'hc2', v: Object.assign({}, hubNow, { tutorIds: ['u_g1', 'u_g2'] }) }]);
  const hubInc = await call('sync', { cursor: hubPgCur }, guru2);
  const hubHpNew = (hubInc.data.records || []).find(x => x.k === 'lms_hub_progress' && x.id === 'hp2');
  check('tutor baru menerima ulang jawaban peserta', hubHpNew && JSON.stringify(hubHpNew.v.quiz).includes('Jawaban esai saya'), (hubInc.data.records || []).map(x => x.k + ':' + x.id));

  /* ---------- Remedial ---------- */
  console.log('\n[Remedial]');
  const T = Date.now();
  const baseCbt = { title: 'Ujian Awal', targetClasses: ['__ALL__'], sections: [{ subtest: 'PU', questionIds: ['q1'], durationMinutes: 10 }], questionIds: ['q1'], startAt: T - 7200000, endAt: T + 7200000 };
  const remOpen = Object.assign({}, baseCbt, { id: 'rm_open', title: 'Remedial 1', targetClasses: [], remedialOf: 'cb_main', remedialRound: 1, targetStudentIds: ['u_s1'], startAt: T - 3600000, endAt: T + 3600000 });
  r = await push(admin, [
    { k: 'lms_cbts', id: 'cb_main', v: Object.assign({ id: 'cb_main' }, baseCbt) },
    { k: 'lms_cbts', id: 'rm_open', v: remOpen },
    { k: 'lms_cbts', id: 'rm_future', v: Object.assign({}, remOpen, { id: 'rm_future', startAt: T + 86400000, endAt: T + 2 * 86400000 }) },
    { k: 'lms_cbts', id: 'rm_past', v: Object.assign({}, remOpen, { id: 'rm_past', startAt: T - 2 * 86400000, endAt: T - 86400000 }) },
    { k: 'lms_cbts', id: 'rm_two', v: Object.assign({}, remOpen, { id: 'rm_two', remedialRound: 2 }) }
  ]);
  check('admin membuat ujian induk & remedial', r.rejected.length === 0, r.rejected);
  const att = (id, cbtId, sid) => ({ k: 'lms_cbt_attempts', id, v: { id, cbtId, studentId: sid, answers: {}, startedAt: Date.now(), submittedAt: null } });
  r = await push(s2, [att('at_main_s2', 'cb_main', 'u_s2')]);
  check('ujian biasa tetap bisa dikerjakan', r.rejected.length === 0, r.rejected);
  r = await push(s1, [att('at_rm_s1', 'rm_open', 'u_s1')]);
  check('peserta terdaftar dapat memulai remedial', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_cbt_attempts', id: 'at_rm_s1', v: Object.assign(att('at_rm_s1', 'rm_open', 'u_s1').v, { answers: { q1: 1 }, submittedAt: Date.now() }) }]);
  check('peserta dapat mengirim jawaban remedial', r.rejected.length === 0, r.rejected);
  r = await push(s2, [att('at_rm_s2', 'rm_open', 'u_s2')]);
  check('siswa yang tidak terdaftar ditolak', r.rejected.length === 1 && /tidak terdaftar/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [att('at_fut_s1', 'rm_future', 'u_s1')]);
  check('remedial yang belum dibuka ditolak', r.rejected.length === 1 && /belum dibuka/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [att('at_past_s1', 'rm_past', 'u_s1')]);
  check('remedial yang sudah berakhir ditolak', r.rejected.length === 1 && /berakhir/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [{ k: 'lms_settings', id: 'remedialEnabled', v: false }]);
  r = await push(s1, [att('at_two_s1', 'rm_two', 'u_s1')]);
  check('saat sistem remedial dimatikan, percobaan baru ditolak', r.rejected.length === 1 && /dimatikan/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [{ k: 'lms_settings', id: 'remedialEnabled', v: true }]);
  r = await push(s1, [att('at_two_s1', 'rm_two', 'u_s1')]);
  check('setelah diaktifkan kembali, percobaan diterima', r.rejected.length === 0, r.rejected);

  /* ---------- Berita ---------- */
  console.log('\n[Berita]');
  const NOW = Date.now();
  const news = (id, extra) => ({ k: 'lms_news', id, v: Object.assign({ id, title: 'Berita ' + id, slug: 'berita-' + id, status: 'published',
    publishAt: NOW - 60000, content: '<p>Isi berita yang cukup panjang untuk diterbitkan.</p>', excerpt: 'Ringkas', category: 'Pengumuman',
    pinned: false, readMin: 1, authorName: 'Admin', cover: '', thumb: '' }, extra || {}) });
  r = await push(admin, [news('n1'), news('n2', { category: 'Prestasi', pinned: true }), news('n3', { status: 'draft' }), news('n4', { publishAt: NOW + 86400000 })]);
  check('admin menyimpan berita (terbit, draf, terjadwal)', r.rejected.length === 0, r.rejected);
  r = await push(guru, [news('n5')]);
  check('guru tidak boleh menulis berita', r.rejected.length === 1, r.rejected);
  r = await push(admin, [news('bad1', { content: '<p>x</p><img src=x onerror=alert(1)>' })]);
  check('isi berita berisi skrip ditolak', r.rejected.length === 1 && /tidak diizinkan/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [news('bad2', { slug: 'Bukan Slug!' })]);
  check('alamat (slug) tidak valid ditolak', r.rejected.length === 1 && /slug/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [news('bad3', { cover: 'data:text/html;base64,PHNjcmlwdD4=' })]);
  check('sampul yang bukan gambar ditolak', r.rejected.length === 1 && /Gambar sampul/.test(r.rejected[0].reason), r.rejected);
  const sp = await pull(s1);
  check('berita tidak disinkronkan ke perangkat siswa', !sp.lms_news, Object.keys(sp.lms_news || {}));
  const ap = await pull(admin);
  check('admin menerima semua berita termasuk draf & terjadwal', !!(ap.lms_news && ap.lms_news.n3 && ap.lms_news.n4));
  const getNews = async (qs) => {
    const res = await fetch(URL_API + '?action=news' + qs);
    return { status: res.status, cache: res.headers.get('cache-control') || '', data: await res.json() };
  };
  let g = await getNews('');
  check('publik: daftar hanya berisi berita terbit', g.data.ok && g.data.total === 2 && g.data.items.map(x => x.id).sort().join() === 'n1,n2', g.data);
  check('publik: berita utama di urutan pertama', g.data.items && g.data.items[0].id === 'n2', g.data.items);
  check('publik: daftar tidak memuat isi lengkap', (g.data.items || []).every(x => x.content === undefined));
  check('publik: daftar boleh di-cache CDN', /s-maxage=60/.test(g.cache), g.cache);
  g = await getNews('&cat=Prestasi');
  check('publik: filter kategori', g.data.total === 1 && g.data.items[0].id === 'n2', g.data);
  g = await getNews('&q=' + encodeURIComponent('N1'));
  check('publik: pencarian judul (tanpa beda huruf besar/kecil)', g.data.total === 1 && g.data.items[0].id === 'n1', g.data);
  g = await getNews('&id=berita-n1');
  check('publik: artikel lewat slug + berita terkait', g.data.ok && g.data.item.content.includes('Isi berita') && g.data.related.length === 1, g.data);
  g = await getNews('&id=n3');
  check('publik: draf tidak dapat dibuka & tidak di-cache', g.data.ok === false && g.data.notFound === true && /no-store/.test(g.cache), g);
  g = await getNews('&id=berita-n4');
  check('publik: berita terjadwal belum dapat dibuka', g.data.notFound === true, g.data);
  r = await push(admin, [news('n4', { publishAt: Date.now() - 1000 })]);
  g = await getNews('&id=berita-n4');
  check('publik: berita tampil begitu waktu terbitnya tercapai', g.data.ok === true, g.data);

  /* ---------- Tools: data PTN, jadwal seleksi, rencana UTBK ---------- */
  console.log('\n[Tools]');
  const major = (id, extra) => ({ k: 'lms_ptn_majors', id, v: Object.assign({ id, campusId: 'pc1', facultyId: 'pf1', name: 'Ilmu Komputer', level: 'S1', year: 2025,
    capacity: 120, applicants: 4200, avgScore: 712.4, minScore: 680, subtests: { PU: 720, PK: 760 }, source: 'Uji', notes: '' }, extra || {}) });
  r = await push(admin, [
    { k: 'lms_ptn_campuses', id: 'pc1', v: { id: 'pc1', name: 'Universitas Uji', short: 'UU', city: 'Depok', province: 'Jawa Barat', type: 'PTN', website: 'https://uji.ac.id' } },
    { k: 'lms_ptn_faculties', id: 'pf1', v: { id: 'pf1', campusId: 'pc1', name: 'Fakultas Ilmu Komputer' } },
    major('pm1'),
    { k: 'lms_admission_events', id: 'ae1', v: { id: 'ae1', track: 'SNBT', campusId: null, campusName: '', title: 'Pendaftaran UTBK', startDate: '2027-03-20', endDate: '2027-04-05', link: 'https://snpmb.id', notes: '', important: true } }
  ]);
  check('admin menyimpan kampus, fakultas, jurusan, jadwal', r.rejected.length === 0, r.rejected);
  r = await push(guru, [major('pm_guru')]);
  check('guru tidak boleh mengubah data PTN', r.rejected.length === 1, r.rejected);
  r = await push(admin, [major('pm_bad', { avgScore: 1500 })]);
  check('skor jurusan di luar 0–1000 ditolak (admin pun)', r.rejected.length === 1 && /0–1000/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [major('pm_bad2', { subtests: { XYZ: 500 } })]);
  check('kode subtest tidak dikenal ditolak', r.rejected.length === 1, r.rejected);
  r = await push(admin, [{ k: 'lms_admission_events', id: 'ae_bad', v: { id: 'ae_bad', track: 'SNBT', title: 'Terbalik', startDate: '2027-04-05', endDate: '2027-03-01' } }]);
  check('jadwal dengan tanggal selesai sebelum mulai ditolak', r.rejected.length === 1 && /Tanggal/.test(r.rejected[0].reason), r.rejected);
  r = await push(admin, [{ k: 'lms_admission_events', id: 'ae_bad2', v: { id: 'ae_bad2', track: 'SNBT', title: 'Tautan', startDate: '2027-04-05', endDate: '2027-04-05', link: 'javascript:alert(1)' } }]);
  check('tautan jadwal selain http(s) ditolak', r.rejected.length === 1, r.rejected);
  const planOf = (uid, extra) => ({ k: 'lms_utbk_plans', id: uid, v: Object.assign({ userId: uid, scores: { PU: 650, PK: 700 }, choices: ['pm1'], reminders: ['ae1'], notified: {} }, extra || {}) });
  r = await push(s1, [planOf('u_s1')]);
  check('siswa menyimpan rencana UTBK miliknya', r.rejected.length === 0, r.rejected);
  r = await push(s1, [planOf('u_s2')]);
  check('siswa tidak boleh menulis rencana siswa lain', r.rejected.length === 1, r.rejected);
  r = await push(s1, [planOf('u_s1', { choices: ['a', 'b', 'c', 'd', 'e'] })]);
  check('lebih dari 4 pilihan jurusan ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [planOf('u_s1', { scores: { PU: 1200 } })]);
  check('skor rencana di luar 0–1000 ditolak', r.rejected.length === 1, r.rejected);
  const p2 = await pull(s2);
  check('siswa lain tidak menerima rencana UTBK milik orang lain', !(p2.lms_utbk_plans && p2.lms_utbk_plans.u_s1));
  check('siswa menerima data jurusan & jadwal seleksi', !!(p2.lms_ptn_majors && p2.lms_ptn_majors.pm1 && p2.lms_admission_events && p2.lms_admission_events.ae1));
  const p1 = await pull(s1);
  check('pemilik menerima rencananya sendiri', !!(p1.lms_utbk_plans && p1.lms_utbk_plans.u_s1 && p1.lms_utbk_plans.u_s1.choices[0] === 'pm1'));
  const pa = await pull(admin);
  check('admin menerima rencana semua pengguna', !!(pa.lms_utbk_plans && pa.lms_utbk_plans.u_s1));
  r = await push(admin, [planOf('u_s1', { choices: [] })]);
  check('admin dapat merapikan rencana (jurusan terhapus)', r.rejected.length === 0, r.rejected);

  /* ---------- Grup Belajar ---------- */
  console.log('\n[Grup Belajar]');
  const T2 = Date.now();
  const gpost = (id, author, extra) => ({ k: 'lms_group_posts', id, v: Object.assign({ id, groupId: 'grp1', authorId: author, kind: 'message', text: 'Halo semua', title: '',
    content: '', threadId: null, quiz: null, pinned: false, deleted: false, createdAt: T2 }, extra || {}) });
  const quizQ = [{ id: 'q1', questionType: 'Pilihan Ganda', text: '1+1?', options: ['1', '2'], correctIndex: 1 }];
  r = await push(admin, [{ k: 'lms_groups', id: 'grp1', v: { id: 'grp1', name: 'Grup PK 12', description: '', color: '#0d9488', memberIds: ['u_s1'], tutorIds: ['u_g1'], archived: false, createdBy: 'u_admin' } }]);
  check('admin membuat grup', r.rejected.length === 0, r.rejected);
  r = await push(guru, [{ k: 'lms_groups', id: 'grp_g', v: { id: 'grp_g', name: 'Grup tutor', memberIds: [], tutorIds: ['u_g1'] } }]);
  check('tutor tidak boleh membuat grup', r.rejected.length === 1, r.rejected);
  r = await push(s1, [gpost('m1', 'u_s1')]);
  check('anggota mengirim pesan', r.rejected.length === 0, r.rejected);
  r = await push(s2, [gpost('m2', 'u_s2')]);
  check('bukan anggota tidak boleh mengirim pesan', r.rejected.length === 1 && /bukan anggota/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [gpost('m3', 'u_s1', { kind: 'quiz', title: 'Kuis', quiz: { questions: quizQ, dueAt: null } })]);
  check('anggota tidak boleh mengirim kuis', r.rejected.length === 1 && /Hanya admin atau tutor/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [gpost('m4', 'u_g1')]);
  check('anggota tidak boleh menyamar sebagai penulis lain', r.rejected.length === 1, r.rejected);
  r = await push(guru, [gpost('qz1', 'u_g1', { kind: 'quiz', title: 'Kuis PK', text: '', quiz: { questions: quizQ, dueAt: T2 + 86400000 } }),
    gpost('qzOld', 'u_g1', { kind: 'quiz', title: 'Kuis lewat', text: '', quiz: { questions: quizQ, dueAt: T2 - 3600000 } }),
    gpost('ds1', 'u_g1', { kind: 'discussion', title: 'Bahas soal no 5', text: '', content: '<p>Bagaimana caranya?</p>' })]);
  check('tutor grup mengirim kuis & bahan diskusi', r.rejected.length === 0, r.rejected);
  r = await push(guru, [gpost('bad', 'u_g1', { kind: 'material', title: 'Materi', text: '', content: '<img src=x onerror=alert(1)>' })]);
  check('materi berisi skrip ditolak', r.rejected.length === 1 && /tidak diizinkan/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [gpost('rp1', 'u_s1', { threadId: 'ds1', text: 'Pakai rumus luas' })]);
  check('anggota membalas diskusi', r.rejected.length === 0, r.rejected);
  r = await push(s1, [gpost('m1', 'u_s1', { pinned: true, text: 'Halo semua (disunting)' })]);
  check('anggota menyunting pesannya, tetapi tidak dapat menyematkan', r.rejected.length === 0 && r.applied[0].v.pinned === false && /disunting/.test(r.applied[0].v.text), r.applied);
  r = await push(guru, [gpost('m1', 'u_s1', { text: 'diubah tutor', pinned: true })]);
  check('tutor hanya dapat menyematkan pesan anggota (isi tidak berubah)', r.rejected.length === 0 && r.applied[0].v.pinned === true && /disunting/.test(r.applied[0].v.text), r.applied);
  r = await push(guru, [gpost('m1', 'u_s1', { deleted: true, text: '' , pinned: true })]);
  check('tutor dapat menghapus pesan anggota (isi dikosongkan)', r.rejected.length === 0 && r.applied[0].v.deleted === true && r.applied[0].v.text === '', r.applied);
  r = await push(s1, [gpost('m1', 'u_s1', { text: 'pulihkan', deleted: false })]);
  check('pesan terhapus tidak dapat dipulihkan', r.rejected.length === 1, r.rejected);
  const ans = (postId, uid, extra) => ({ k: 'lms_group_answers', id: postId + ':' + uid, v: Object.assign({ id: postId + ':' + uid, postId, groupId: 'grp1', userId: uid, answers: { q1: 1 }, score: { correct: 1, total: 1 }, submittedAt: Date.now() }, extra || {}) });
  r = await push(s1, [ans('qz1', 'u_s1')]);
  check('anggota mengirim jawaban kuis', r.rejected.length === 0, r.rejected);
  r = await push(s1, [ans('qz1', 'u_s1', { answers: { q1: 0 }, score: { correct: 0, total: 1 } })]);
  check('jawaban yang sudah dikirim terkunci', r.rejected.length === 1 && /sudah dikirim/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [ans('qzOld', 'u_s1')]);
  check('kuis yang lewat batas waktu ditolak', r.rejected.length === 1 && /Batas waktu/.test(r.rejected[0].reason), r.rejected);
  // Sinyal putus: kiriman dibuat sebelum batas waktu, baru tersinkron sesudahnya.
  r = await push(s1, [ans('qzOld', 'u_s1', { submittedAt: T2 - 3600000 - 60000, syncedLate: 1 })]);
  check('kiriman offline yang dibuat sebelum batas diterima & dicap waktu server', r.rejected.length === 0 && r.applied[0].v.syncedLate >= T2, r.rejected.concat(r.applied.map(a => a.v && a.v.syncedLate)));
  r = await push(guru, [gpost('qzOlder', 'u_g1', { kind: 'quiz', title: 'Kuis lama', text: '', quiz: { questions: quizQ, dueAt: T2 - 3 * 3600000 } })]);
  r = await push(s1, [ans('qzOlder', 'u_s1', { submittedAt: T2 - 3 * 3600000 - 60000 })]);
  check('kiriman offline lebih dari 2 jam setelah batas tetap ditolak', r.rejected.length === 1 && /Batas waktu/.test(r.rejected[0].reason), r.rejected);
  r = await push(s2, [ans('qz1', 'u_s2')]);
  check('bukan anggota tidak dapat mengerjakan kuis', r.rejected.length === 1, r.rejected);
  r = await push(s1, [ans('ds1', 'u_s1')]);
  check('jawaban untuk kiriman yang bukan kuis ditolak', r.rejected.length === 1, r.rejected);
  const pS2 = await pull(s2);
  check('bukan anggota tidak menerima grup, kiriman, dan jawaban', !(pS2.lms_groups && pS2.lms_groups.grp1) && !pS2.lms_group_posts && !pS2.lms_group_answers, Object.keys(pS2.lms_group_posts || {}));
  const pS1 = await pull(s1);
  check('anggota menerima grup & kiriman', !!(pS1.lms_groups && pS1.lms_groups.grp1 && pS1.lms_group_posts && pS1.lms_group_posts.qz1 && pS1.lms_group_posts.rp1));
  const pG = await pull(guru);
  check('tutor grup melihat jawaban anggota', !!(pG.lms_group_answers && pG.lms_group_answers['qz1:u_s1']));
  r = await push(guru, [{ k: 'lms_group_answers', id: 'qz1:u_s1', op: 'del' }]);
  check('tutor dapat mengatur ulang jawaban (anggota boleh mengerjakan lagi)', r.rejected.length === 0, r.rejected);
  r = await push(s1, [ans('qz1', 'u_s1', { syncedLate: 5 })]);
  check('cap kiriman offline tidak dapat diisi sendiri oleh anggota', r.rejected.length === 0 && r.applied[0].v.syncedLate === undefined, r.applied.map(a => a.v));

  // Status koneksi (js/safe-save.js) ikut presence: dibersihkan server, hanya staf yang melihat.
  await call('sync', { cursor: 0, presence: { tab: 'tab_net_s1', page: 'cbt', visibility: 'visible', net: { pending: 3, drops: 2, offlineMs: 5000.7, lastDropAt: 'x', evil: '<b>' } } }, s1);
  const presG = (await call('sync', { cursor: 0 }, guru)).data.presence || [];
  const pnet = (presG.find(p => p.tabId === 'tab_net_s1') || {}).net;
  check('status koneksi peserta terlihat staf & dibersihkan', pnet && pnet.pending === 3 && pnet.drops === 2 && pnet.offlineMs === 5000 && pnet.lastDropAt === 0 && !('evil' in pnet), pnet);
  const presS2 = (await call('sync', { cursor: 0 }, s2)).data.presence || [];
  const other = presS2.find(p => p.tabId === 'tab_net_s1');
  check('sesama siswa tidak melihat status koneksi', other && other.net === undefined, other);
  r = await push(admin, [{ k: 'lms_groups', id: 'grp1', v: { id: 'grp1', name: 'Grup PK 12', color: '#0d9488', memberIds: [], tutorIds: ['u_g1'], archived: false, createdBy: 'u_admin' } }]);
  const sync1 = await call('sync', { cursor: 0, full: true }, s1);
  const tomb = (sync1.data.records || []).find(x => x.k === 'lms_groups' && x.id === 'grp1');
  check('anggota yang dikeluarkan menerima penanda hapus grup', tomb && tomb.v === null, tomb);
  r = await push(s1, [gpost('m9', 'u_s1', { text: 'masih bisa?' })]);
  check('anggota yang dikeluarkan tidak dapat mengirim lagi', r.rejected.length === 1, r.rejected);
  r = await push(admin, [{ k: 'lms_groups', id: 'grp1', v: { id: 'grp1', name: 'Grup PK 12', color: '#0d9488', memberIds: ['u_s1'], tutorIds: ['u_g1'], archived: true, createdBy: 'u_admin' } }]);
  r = await push(s1, [gpost('m10', 'u_s1', { text: 'diarsipkan?' })]);
  check('grup yang diarsipkan menolak kiriman baru', r.rejected.length === 1 && /diarsipkan/.test(r.rejected[0].reason), r.rejected);

  /* ---------- Ruang Belajar ---------- */
  console.log('\n[Ruang Belajar]');
  const TS = Date.now();
  const ymdUtc = (t) => new Date(t).toISOString().slice(0, 10);
  const D0 = ymdUtc(TS);
  r = await push(s1, [{ k: 'lms_study_goals', id: 'stg1', v: { id: 'stg1', userId: 'u_s1', title: 'Latihan PK', targetMin: 50, color: '#4f46e5', createdAt: TS } }]);
  check('mentee menambah tujuan belajar', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_study_goals', id: 'stg2', v: { id: 'stg2', userId: 'u_s2', title: 'Palsu', targetMin: 50 } }]);
  check('tujuan atas nama mentee lain ditolak', r.rejected.length === 1, r.rejected);
  const sess = (id, extra) => ({ k: 'lms_study_sessions', id, v: Object.assign({ id, userId: 'u_s1', kind: 'focus', goalId: 'stg1', title: 'Latihan PK', startedAt: TS - 3600000, endedAt: TS - 600000, durationMs: 3000000, day: D0, createdAt: TS }, extra || {}) });
  r = await push(s1, [sess('sts1')]);
  check('sesi fokus yang wajar diterima', r.rejected.length === 0, r.rejected);
  r = await push(s1, [sess('sts2', { durationMs: 4 * 3600000 })]);
  check('durasi melebihi rentang mulai–selesai ditolak', r.rejected.length === 1 && /melebihi/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [sess('sts3', { startedAt: TS - 10 * 86400000, endedAt: TS - 10 * 86400000 + 3600000, durationMs: 3600000, day: ymdUtc(TS - 10 * 86400000) })]);
  check('sesi lama (mengisi mundur) ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [sess('sts1', { durationMs: 3500000 })]);
  check('sesi yang sudah tercatat tidak dapat diubah', r.rejected.length === 1 && /tidak dapat diubah/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [{ k: 'lms_study_sessions', id: `web:u_s1:${D0}:dabc1234`, v: { id: `web:u_s1:${D0}:dabc1234`, userId: 'u_s1', kind: 'web', day: D0, dev: 'dabc1234', durationMs: 1800000 } }]);
  check('waktu di LMS per perangkat diterima', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_study_sessions', id: 'web:lain', v: { id: 'web:lain', userId: 'u_s1', kind: 'web', day: D0, dev: 'dabc1234', durationMs: 1800000 } }]);
  check('id waktu di LMS yang tidak cocok ditolak', r.rejected.length === 1, r.rejected);
  const stat = (extra) => ({ k: 'lms_study_stats', id: 'u_s1', v: Object.assign({ userId: 'u_s1', days: { [D0]: { f: 3000000, w: 1800000, n: 1 } }, months: { [D0.slice(0, 7)]: 4800000 }, total: 4800000,
    live: { state: 'focus', title: 'Latihan PK', goalId: 'stg1', since: TS - 60000, accMs: 0, targetMs: 3000000, at: TS }, updatedAt: TS }, extra || {}) });
  r = await push(s1, [stat()]);
  check('ringkasan jam belajar & status langsung diterima', r.rejected.length === 0, r.rejected);
  r = await push(s1, [stat({ days: { [D0]: { f: 20 * 3600000, w: 6 * 3600000, n: 1 } } })]);
  check('lebih dari 24 jam per hari ditolak', r.rejected.length === 1 && /per hari/.test(r.rejected[0].reason), r.rejected);
  r = await push(s1, [stat({ live: { state: 'tidur', at: TS, accMs: 0, targetMs: 0 } })]);
  check('status langsung yang tidak dikenal ditolak', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_study_stats', id: 'u_g1', v: { userId: 'u_g1', days: {}, months: {}, total: 0, live: null } }]);
  check('tutor tidak mencatat jam belajar mentee', r.rejected.length === 1, r.rejected);
  r = await push(admin, [{ k: 'lms_study_stats', id: 'u_s1', v: Object.assign(stat().v, { total: 999 }) }]);
  check('admin tidak dapat mengubah ringkasan mentee', r.rejected.length === 1, r.rejected);
  const pS2b = await pull(s2);
  check('mentee lain melihat ringkasan, bukan sesi & tujuan', !!(pS2b.lms_study_stats && pS2b.lms_study_stats.u_s1) && !pS2b.lms_study_sessions && !pS2b.lms_study_goals, Object.keys(pS2b).filter(k => /study/.test(k)));
  const pAdm = await pull(admin);
  check('admin melihat ringkasan tanpa data mentah', !!(pAdm.lms_study_stats && pAdm.lms_study_stats.u_s1) && !pAdm.lms_study_sessions, Object.keys(pAdm).filter(k => /study/.test(k)));
  const pS1b = await pull(s1);
  check('pemilik menerima sesi & tujuannya', !!(pS1b.lms_study_sessions && pS1b.lms_study_sessions.sts1 && pS1b.lms_study_goals && pS1b.lms_study_goals.stg1));
  r = await push(admin, [{ k: 'lms_study_stats', id: 'u_s1', op: 'del' }]);
  check('admin dapat menghapus ringkasan yang tidak wajar', r.rejected.length === 0, r.rejected);

  /* ---------- Main Bareng Kelas ---------- */
  console.log('\n[Main Bareng Kelas]');
  const room = (extra) => ({ k: 'lms_game_rooms', id: 'gr_t1', v: Object.assign({ id: 'gr_t1', code: 'ABC234', kind: 'raid', hostId: 'u_g1', title: 'Monster Kelas', subject: '',
    status: 'lobby', phase: 'lobby', round: 0, roundSec: 20, qids: ['b:q1', 'b:q2'], playerIds: [], state: {} }, extra || {}) });
  r = await push(s1, [room({ hostId: 'u_s1' })]);
  check('siswa tidak dapat membuat ruang', r.rejected.length === 1, r.rejected);
  r = await push(guru, [room({ hostId: 'u_admin' })]);
  check('tuan rumah ruang harus akun sendiri', r.rejected.length === 1, r.rejected);
  r = await push(guru, [room({ code: 'abc' })]);
  check('kode ruang tidak valid ditolak', r.rejected.length === 1, r.rejected);
  r = await push(guru, [room()]);
  check('tutor membuat ruang', r.rejected.length === 0, r.rejected);
  const T0 = Date.now();
  r = await push(guru, [room({ status: 'playing', phase: 'question', round: 1, phaseAt: T0 - 999999, phaseEndsAt: T0 - 999999 + 20000, code: 'ZZZ999', hostId: 'u_g1' })]);
  const rv = (r.applied[0] || {}).v || {};
  check('jam fase dicap server (durasi dipertahankan), kode tidak berubah', r.rejected.length === 0 && Math.abs(rv.phaseAt - Date.now()) < 5000 && rv.phaseEndsAt - rv.phaseAt === 20000 && rv.code === 'ABC234', rv);
  const pl = (extra, who) => ({ k: 'lms_game_players', id: 'gr_t1:' + (who || 'u_s1'), v: Object.assign({ id: 'gr_t1:' + (who || 'u_s1'), roomId: 'gr_t1', hostId: 'u_g1', userId: who || 'u_s1', role: 'penyihir', color: 1, ans: {} }, extra || {}) });
  r = await push(s1, [pl()]);
  check('siswa bergabung ke ruang', r.rejected.length === 0, r.rejected);
  r = await push(s1, [pl({}, 'u_s2')]);
  check('siswa tidak dapat menulis data pemain lain', r.rejected.length === 1, r.rejected);
  r = await push(s1, [pl({ role: 'raja' })]);
  check('peran tidak dikenal ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [pl({ ans: { 1: { o: 2, ok: true, ms: 3000, sk: 'api' } } })]);
  const a1 = (((r.applied[0] || {}).v || {}).ans || {})[1] || {};
  check('jawaban ronde diterima & diberi cap waktu server', r.rejected.length === 0 && a1.o === 2 && Math.abs(a1.sa - Date.now()) < 5000, a1);
  r = await push(s1, [pl({ ans: { 1: { o: 0, ok: true, ms: 100, sk: 'api' } } })]);
  const a2 = (((r.applied[0] || {}).v || {}).ans || {})[1] || {};
  check('jawaban yang sudah terkirim tidak dapat diganti', a2.o === 2 && a2.ms === 3000, a2);
  r = await push(s1, [pl({ ans: { 1: { o: 2, ok: true, ms: 3000, sk: 'api' } }, car: { d: 120, lane: 1, v: 56, at: Date.now(), fin: 0, it: 'roket' } })]);
  check('item balap tidak dikenal ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [pl({ ans: { 1: { o: 2, ok: true, ms: 3000, sk: 'api' } }, car: { d: 120, lane: 2, v: 56, at: Date.now(), fin: 0, it: 'oil', fx: { t: 0, s: 0, h: 0 } }, ev: [{ t: 'oil', n: 1, to: 'u_s2', at: Date.now(), lane: 1 }] })]);
  check('posisi mobil & lemparan oli diterima', r.rejected.length === 0, r.rejected);
  r = await push(guru, [pl({ role: 'penjaga' })]);
  check('tutor tidak dapat menulis data pemain', r.rejected.length === 1, r.rejected);
  const pS2r = await pull(s2);
  check('siswa lain melihat ruang & pemain yang aktif', !!(pS2r.lms_game_rooms && pS2r.lms_game_rooms.gr_t1 && pS2r.lms_game_players && pS2r.lms_game_players['gr_t1:u_s1']));
  r = await push(s2, [room({ status: 'closed' })]);
  check('siswa tidak dapat menutup ruang', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_game_players', id: 'gr_t1:u_s1', op: 'del' }, { k: 'lms_game_rooms', id: 'gr_t1', op: 'del' }]);
  check('tuan rumah dapat merapikan ruang & pemainnya', r.rejected.length === 0, r.rejected);

  /* ---------- Kritik & Saran: tujuan admin / tutor / umum ---------- */
  console.log('\n[Kritik & Saran]');
  const fbRec = (id, extra) => ({ k: 'lms_feedbacks', id, v: Object.assign({ id, senderId: 'u_s1', target: 'admin', message: 'Saran yang cukup panjang', anonymous: false, createdAt: Date.now() }, extra || {}) });
  r = await push(s1, [fbRec('fb_t_admin'), fbRec('fb_t_tutor', { target: 'tutor', recipientId: 'u_g1', anonymous: true }), fbRec('fb_t_umum', { target: 'umum' })]);
  check('mentee mengirim masukan ke admin, tutor (anonim), dan umum', r.rejected.length === 0, r.rejected);
  r = await push(s1, [fbRec('fb_t_fake', { senderId: 'u_s2' })]);
  check('pengirim palsu ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [fbRec('fb_t_badrcp', { target: 'tutor', recipientId: 'u_s2' })]);
  check('penerima bukan akun tutor ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [fbRec('fb_t_norcp', { target: 'tutor', recipientId: 'u_tidak_ada' })]);
  check('penerima yang tidak terdaftar ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [fbRec('fb_t_short', { message: 'ok' }), fbRec('fb_t_tgt', { target: 'kelas' })]);
  check('pesan terlalu pendek & tujuan lama ditolak', r.rejected.length === 2, r.rejected);
  const fbG1 = (await pull(guru)).lms_feedbacks || {};
  const fbG2 = (await pull(guru2)).lms_feedbacks || {};
  const fbS2 = (await pull(s2)).lms_feedbacks || {};
  const fbAd = (await pull(admin)).lms_feedbacks || {};
  const fbS1 = (await pull(s1)).lms_feedbacks || {};
  check('tutor penerima melihat masukannya, tanpa identitas pengirim anonim', fbG1.fb_t_tutor && fbG1.fb_t_tutor.senderId === undefined && !fbG1.fb_t_admin, Object.keys(fbG1));
  check('tutor lain tidak melihat masukan untuk tutor lain', !fbG2.fb_t_tutor && !fbG2.fb_t_admin && !!fbG2.fb_t_umum, Object.keys(fbG2));
  check('mentee lain hanya melihat masukan umum', Object.keys(fbS2).filter(k => fbS2[k]).join() === 'fb_t_umum', fbS2);
  check('admin melihat masukan ke admin & umum, bukan ke tutor', fbAd.fb_t_admin && fbAd.fb_t_umum && !fbAd.fb_t_tutor, Object.keys(fbAd));
  check('pengirim melihat semua masukannya', fbS1.fb_t_admin && fbS1.fb_t_tutor && fbS1.fb_t_umum && fbS1.fb_t_tutor.senderId === 'u_s1', Object.keys(fbS1));
  r = await push(guru2, [{ k: 'lms_feedbacks', id: 'fb_t_tutor', op: 'patch', set: { reply: { text: 'Bukan untuk saya' } }, unset: [] }]);
  check('tutor lain tidak dapat membalas', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_feedbacks', id: 'fb_t_tutor', op: 'patch', set: { reply: { text: 'Terima kasih masukannya', by: 'u_s2', at: 1 }, message: 'diubah' }, unset: [] }]);
  const fbRep = (r.applied[0] || {}).v || {};
  check('tutor penerima membalas: hanya balasan yang berubah, penulis dicap server', r.rejected.length === 0 && fbRep.reply && fbRep.reply.by === 'u_g1' && fbRep.reply.at > 1 && fbRep.message === 'Saran yang cukup panjang' && fbRep.senderId === undefined, fbRep);
  const fbS1b = (await pull(s1)).lms_feedbacks || {};
  check('pengirim melihat balasan & identitasnya tetap tersimpan', fbS1b.fb_t_tutor && fbS1b.fb_t_tutor.reply && fbS1b.fb_t_tutor.reply.text === 'Terima kasih masukannya' && fbS1b.fb_t_tutor.senderId === 'u_s1', fbS1b.fb_t_tutor);
  r = await push(guru, [{ k: 'lms_feedbacks', id: 'fb_t_admin', op: 'patch', set: { reply: { text: 'Coba balas' } }, unset: [] }]);
  check('tutor tidak dapat membalas masukan untuk admin', r.rejected.length === 1, r.rejected);
  r = await push(admin, [{ k: 'lms_feedbacks', id: 'fb_t_admin', op: 'patch', set: { reply: { text: 'Ditindaklanjuti' } }, unset: [] }]);
  const fbAdRep = ((r.applied[0] || {}).v || {}).reply || {};
  check('admin membalas masukan untuk admin', r.rejected.length === 0 && fbAdRep.text === 'Ditindaklanjuti' && fbAdRep.at > 0 && typeof fbAdRep.by === 'string', r.rejected.concat(r.applied));
  r = await push(s2, [{ k: 'lms_feedbacks', id: 'fb_t_umum', op: 'del' }]);
  check('mentee lain tidak dapat menghapus masukan umum', r.rejected.length === 1, r.rejected);
  r = await push(s1, [{ k: 'lms_feedbacks', id: 'fb_t_umum', op: 'patch', set: { message: 'ubah sendiri' }, unset: [] }]);
  check('pengirim tidak dapat mengubah isi masukan', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_feedbacks', id: 'fb_t_tutor', op: 'del' }]);
  check('tutor penerima dapat menghapus masukan untuknya', r.rejected.length === 0, r.rejected);
  r = await push(s1, [{ k: 'lms_feedbacks', id: 'fb_t_umum', op: 'del' }]);
  check('pengirim dapat menghapus masukannya', r.rejected.length === 0, r.rejected);
  /* ---------- CBT Tryout: draf admin, setoran tutor ---------- */
  console.log('\n[CBT Tryout]');
  const TT = Date.now();
  const tryRec = (extra) => ({ k: 'lms_cbts', id: 'to_1', v: Object.assign({ id: 'to_1', kind: 'tryout', status: 'draft', title: 'Tryout Uji', targetClasses: ['__ALL__'], courseIds: [],
    sections: [{ subtest: 'Penalaran Umum (PU)', questionIds: [], durationMinutes: 30, target: 5 }], questionIds: [], startAt: TT - 60000, endAt: TT + 86400000, createdBy: '__admin__' }, extra || {}) });
  r = await push(admin, [tryRec(), { k: 'lms_questions', id: 'q_to1', v: { id: 'q_to1', subject: 'Penalaran Umum (PU)', text: '<p>Soal tryout</p>', options: ['a', 'b'], correctIndex: 0, authorId: 'u_g1' } }]);
  check('admin membuat draf tryout', r.rejected.length === 0, r.rejected);
  r = await push(admin, [{ k: 'lms_cbts', id: 'to_bad', v: Object.assign(tryRec().v, { id: 'to_bad', status: 'terbit' }) }]);
  check('status tryout tidak dikenal ditolak', r.rejected.length === 1, r.rejected);
  let toS1 = (await pull(s1)).lms_cbts || {};
  check('mentee tidak menerima draf tryout', !toS1.to_1, Object.keys(toS1));
  const toG1 = (await pull(guru)).lms_cbts || {};
  check('tutor melihat draf tryout', !!toG1.to_1);
  r = await push(guru, [tryRec({ title: 'diubah tutor' })]);
  check('tutor tidak dapat mengubah tryout', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_cbts', id: 'to_g', v: Object.assign(tryRec().v, { id: 'to_g' }) }]);
  check('tutor tidak dapat membuat tryout', r.rejected.length === 1, r.rejected);
  const ccRec = (qid, extra) => ({ k: 'lms_cbt_contribs', id: 'cc_to_1_' + qid, v: Object.assign({ id: 'cc_to_1_' + qid, cbtId: 'to_1', subtest: 'Penalaran Umum (PU)', questionId: qid, by: 'u_g1', at: 1, status: 'accepted' }, extra || {}) });
  r = await push(guru, [ccRec('q_to1')]);
  const ccV = (r.applied[0] || {}).v || {};
  check('tutor menyetor soal: status dipaksa pending & waktu dicap server', r.rejected.length === 0 && ccV.status === 'pending' && ccV.at > 1, r.rejected.concat(r.applied));
  r = await push(guru, [ccRec('q_x', { subtest: 'Penalaran Matematika (PM)' })]);
  check('setoran ke subtest di luar tryout ditolak', r.rejected.length === 1, r.rejected);
  r = await push(guru, [ccRec('q_y', { by: 'u_g2' })]);
  check('setoran atas nama tutor lain ditolak', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_cbt_contribs', id: 'cc_lain_q_to1', v: Object.assign(ccRec('q_to1').v, { id: 'cc_lain_q_to1' }) }]);
  check('id setoran yang tidak cocok ditolak', r.rejected.length === 1, r.rejected);
  r = await push(s1, [{ k: 'lms_cbt_contribs', id: 'cc_to_1_q_s', v: Object.assign(ccRec('q_s').v, { by: 'u_s1' }) }]);
  check('mentee tidak dapat menyetor soal', r.rejected.length === 1, r.rejected);
  const ccS1 = (await pull(s1)).lms_cbt_contribs || {};
  const ccG2 = (await pull(guru2)).lms_cbt_contribs || {};
  check('setoran hanya terlihat oleh staf', !Object.keys(ccS1).length && !!ccG2['cc_to_1_q_to1'], { s1: Object.keys(ccS1), g2: Object.keys(ccG2) });
  r = await push(guru2, [{ k: 'lms_cbt_contribs', id: 'cc_to_1_q_to1', op: 'del' }]);
  check('tutor lain tidak dapat menarik setoran', r.rejected.length === 1, r.rejected);
  r = await push(guru, [{ k: 'lms_cbt_contribs', id: 'cc_to_1_q_to1', op: 'patch', set: { status: 'accepted' }, unset: [] }]);
  check('tutor tidak dapat menerima setorannya sendiri', r.rejected.length === 1, r.rejected);
  r = await push(s1, [{ k: 'lms_cbt_attempts', id: 'at_to_s1', v: { id: 'at_to_s1', cbtId: 'to_1', studentId: 'u_s1', answers: {}, startedAt: Date.now(), submittedAt: null } }]);
  check('mentee tidak dapat mengerjakan draf tryout', r.rejected.length === 1, r.rejected);
  r = await push(admin, [{ k: 'lms_cbt_contribs', id: 'cc_to_1_q_to1', op: 'patch', set: { status: 'accepted', reviewedBy: 'u_admin' }, unset: [] },
    tryRec({ status: 'published', publishAt: TT + 3600000, sections: [{ subtest: 'Penalaran Umum (PU)', questionIds: ['q_to1'], durationMinutes: 30, target: 5 }], questionIds: ['q_to1'] })]);
  check('admin menerima setoran & menerbitkan terjadwal', r.rejected.length === 0, r.rejected);
  toS1 = (await pull(s1)).lms_cbts || {};
  check('mentee menerima tryout terbit (disembunyikan klien sampai waktunya)', !!toS1.to_1 && toS1.to_1.status === 'published', Object.keys(toS1));
  r = await push(s1, [{ k: 'lms_cbt_attempts', id: 'at_to_s1', v: { id: 'at_to_s1', cbtId: 'to_1', studentId: 'u_s1', answers: {}, startedAt: Date.now(), submittedAt: null } }]);
  check('mentee tidak dapat mengerjakan sebelum waktu tampil', r.rejected.length === 1, r.rejected);
  r = await push(admin, [tryRec({ status: 'published', publishAt: TT - 1000, sections: [{ subtest: 'Penalaran Umum (PU)', questionIds: ['q_to1'], durationMinutes: 30, target: 5 }], questionIds: ['q_to1'] })]);
  r = await push(s1, [{ k: 'lms_cbt_attempts', id: 'at_to_s1', v: { id: 'at_to_s1', cbtId: 'to_1', studentId: 'u_s1', answers: {}, startedAt: Date.now(), submittedAt: null } }]);
  check('mentee mengerjakan tryout yang sudah terbit', r.rejected.length === 0, r.rejected);
  r = await push(admin, [tryRec({ id: 'to_1', status: 'draft' })]);
  toS1 = (await pull(s1)).lms_cbts || {};
  check('tryout yang dikembalikan ke draf terhapus dari perangkat mentee', toS1.to_1 === null || toS1.to_1 === undefined, toS1.to_1);

  /* ---------- Skor game: angka wajar ---------- */
  console.log('\n[Skor game]');
  const gsRec = (id, extra) => ({ k: 'lms_game_scores', id, v: Object.assign({ id, studentId: 'u_s1', game: 'kuis', mode: 'solo', score: 120, correct: 3, answered: 4, result: null, createdAt: Date.now() }, extra || {}) });
  r = await push(s1, [gsRec('gs_ok', { correct: 3.7, answered: -2, durationMs: 'x' })]);
  const gsV = (r.applied[0] || {}).v || {};
  check('skor game valid diterima & angka dirapikan', r.rejected.length === 0 && gsV.correct === 3 && gsV.answered === 0 && gsV.durationMs === 0, r.rejected.concat(r.applied));
  r = await push(s1, [gsRec('gs_nan', { score: 'NaN' }), gsRec('gs_big', { score: 5e9 }), gsRec('gs_mode', { mode: 'curang' }), gsRec('gs_res', { result: 'menang' })]);
  check('skor NaN/raksasa, mode, & hasil tidak dikenal ditolak', r.rejected.length === 4, r.rejected);
  r = await push(s1, [gsRec('gs_other', { studentId: 'u_s2' })]);
  check('skor atas nama mentee lain ditolak', r.rejected.length === 1, r.rejected);

  r = await call('sync', { cursor: 0, full: true }, s1);
  const sigA = r.data.viewSig;
  check('tanda tampilan (viewSig) tersedia untuk tarik ulang penuh', typeof sigA === 'string' && sigA.length === 12, sigA);

  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lulus`);
  server.close(); turso.close && turso.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
