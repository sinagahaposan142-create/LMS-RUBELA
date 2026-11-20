'use strict';
/* =====================================================================
 * Uji end-to-end API tanpa dependensi: database Turso tiruan (node:sqlite)
 * + /api/rubela asli, lewat HTTP sungguhan.
 *   node scripts/test-api.js
 * Mencakup: kebijakan berkas (QRIS, bukti transfer), validasi gambar,
 * pesan chat, video pembahasan, pembayaran Course Mandiri, remedial ujian, berita publik, dan Tools (data PTN,
 * jadwal seleksi, rencana UTBK).
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

  const failed = results.filter(x => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lulus`);
  server.close(); turso.close && turso.close();
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
