/* =====================================================================
 * js/duplicates.js — deteksi data ganda
 * ---------------------------------------------------------------------
 * Memindai data LMS yang kemungkinan tercatat dua kali:
 *  - akun (nama sama dalam peran yang sama, email sama, nomor HP sama)
 *  - kelas (judul sama, atau subtest + kelas utama sama)
 *  - kelas utama (nama sama setelah dirapikan, mis. "Kelas 11-A" & "kelas 11 a")
 *  - soal Bank Soal (isi sama persis, atau ≥ 90% mirip pada subtest & teks bacaan yang sama)
 *  - teks bacaan, ujian CBT, materi/modul/tugas dalam kelas yang sama
 *
 * Dipakai di halaman admin "Cek Data Ganda", tombol "Cek Soal Ganda" di Bank
 * Soal, dan pemeriksaan langsung saat membuat akun/kelas/soal atau mengimpor.
 * Grup yang ditandai "bukan ganda" disimpan di pengaturan `dupIgnore` (admin).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const plain = (h, n) => (global.RichText ? RichText.plain(h || '', n || 4000) : String(h || ''));

  /* ---------------- Normalisasi ---------------- */
  const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const TITLES = /\b(bu|bpk|pak|ibu|bapak|kak|kakak|mas|mbak|sdr|sdri|dr|drs|ir|prof)\b/g;
  const DEGREES = /\b(s ?pd|s ?si|s ?kom|s ?t|s ?e|s ?h|s ?psi|m ?pd|m ?si|m ?kom|m ?t|m ?sc|m ?a|ph ?d|lc)\b/g;
  const nameKey = (s) => norm(s).replace(DEGREES, ' ').replace(TITLES, ' ').replace(/\s+/g, ' ').trim();
  const phoneKey = (s) => { let d = String(s || '').replace(/\D/g, ''); if (d.startsWith('62')) d = '0' + d.slice(2); return d.length >= 9 ? d : ''; };
  const emailKey = (s) => String(s || '').trim().toLowerCase();

  /** Kata 4-gram untuk kemiripan teks soal. */
  function shingles(t) {
    const w = t.split(' ').filter(Boolean);
    if (w.length < 4) return new Set([w.join(' ')]);
    const out = new Set();
    for (let i = 0; i + 4 <= w.length; i++) out.add(w.slice(i, i + 4).join(' '));
    return out;
  }
  function jaccard(a, b) {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    const [s, l] = a.size < b.size ? [a, b] : [b, a];
    s.forEach(x => { if (l.has(x)) inter++; });
    return inter / (a.size + b.size - inter);
  }
  /** Isi pembeda sebuah soal: teks + pilihan/pernyataan/pasangan (urutan pilihan diabaikan). */
  function questionBody(q) {
    const parts = [plain(q.text)];
    const add = (arr, f) => (arr || []).forEach(x => parts.push(plain(f ? f(x) : x, 400)));
    add((q.options || []).slice().map(o => plain(o, 400)).sort());
    add(q.statements, s => s && s.text);
    add(q.pairs, p => p && (plain(p.left, 200) + ' ' + plain(p.right, 200)));
    add(q.orderItems);
    (q.answers || []).forEach(a => parts.push(String(a)));
    return norm(parts.join(' '));
  }
  /** Soal dengan teks bacaan berbeda bukan soal ganda walau kalimatnya sama ("Berdasarkan teks tersebut…"). */
  // Draf impor membawa teks bacaannya di `_passage`: pakai id teks tersimpan yang sama isinya,
  // atau isi teksnya sendiri agar sesama draf di bawah teks yang sama tetap dibandingkan.
  const questionScope = (q) => {
    let pid = q.passageId || '';
    if (!pid && q._passage && q._passage.html) {
      const hit = DB.findPassage({ html: q._passage.html, subject: q.subject });
      pid = hit ? hit.id : 'new:' + DB.passageKey(q._passage.html).slice(0, 300);
    }
    return (q.subject || '') + '|' + pid;
  };

  /* ---------------- Pencari soal mirip (indeks sekali bangun) ---------------- */
  const NEAR = 0.9;
  function buildQuestionIndex(list) {
    const items = list.map(q => ({ q, body: questionBody(q), scope: questionScope(q) }));
    items.forEach(it => { it.sh = shingles(it.body); });
    const byExact = new Map();
    const bySh = new Map();
    items.forEach((it, i) => {
      const k = it.scope + '#' + it.body;
      if (!byExact.has(k)) byExact.set(k, []);
      byExact.get(k).push(i);
      it.sh.forEach(x => { if (!bySh.has(x)) bySh.set(x, []); bySh.get(x).push(i); });
    });
    return { items, byExact, bySh };
  }
  /** Soal di indeks yang mirip dengan `q` (tidak termasuk q sendiri). */
  function similarIn(index, q, limit) {
    const body = questionBody(q), scope = questionScope(q), sh = shingles(body);
    if (!body) return [];
    const hits = new Map();
    (index.byExact.get(scope + '#' + body) || []).forEach(i => hits.set(i, 1));
    const cand = new Map();
    sh.forEach(x => {
      const b = index.bySh.get(x);
      if (!b || b.length > 60) return;              // potongan kalimat umum ("berikut yang benar adalah") diabaikan
      b.forEach(i => cand.set(i, (cand.get(i) || 0) + 1));
    });
    cand.forEach((n, i) => {
      if (hits.has(i)) return;
      const it = index.items[i];
      if (it.scope !== scope) return;
      const sim = jaccard(sh, it.sh);
      if (sim >= NEAR) hits.set(i, sim);
    });
    return [...hits.entries()].map(([i, sim]) => ({ q: index.items[i].q, sim }))
      .filter(x => !q.id || x.q.id !== q.id).sort((a, b) => b.sim - a.sim).slice(0, limit || 5);
  }

  /* ---------------- Pemindaian ---------------- */
  function groupBy(list, keyOf) {
    const m = new Map();
    list.forEach(x => { const k = keyOf(x); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return [...m.entries()].filter(([, v]) => v.length > 1);
  }
  const ROLE = { siswa: 'Mentee', guru: 'Tutor', orangtua: 'Orang Tua', admin: 'Admin' };
  const userItem = (u, counts) => ({
    id: u.id, ref: 'user', role: u.role, label: u.name || u.username,
    sub: [`@${u.username}`, ROLE[u.role] || u.role, u.kelas, u.email, (counts && counts.get(u.id)) ? `${counts.get(u.id)} kelas` : (u.role === 'siswa' || u.role === 'guru' ? 'belum punya kelas' : ''),
      u.status && u.status !== 'Aktif' ? u.status : ''].filter(Boolean).join(' • '),
    at: u.createdAt
  });

  /**
   * @param {{ kinds?: string[] }} [opts]
   * @returns {Array<{key, kind, title, reason, items:Array<{id, ref, label, sub, at}>}>}
   */
  function scan(opts) {
    const o = opts || {};
    const want = (k) => !o.kinds || o.kinds.includes(k);
    const out = [];
    const users = DB.getUsers();
    const counts = DB.classCountByUser ? DB.classCountByUser() : new Map();

    if (want('users')) {
      ['siswa', 'guru', 'orangtua', 'admin'].forEach(role => {
        groupBy(users.filter(u => u.role === role), u => nameKey(u.name)).forEach(([k, list]) => out.push({
          key: 'uname:' + role + ':' + k, kind: 'users', title: `${list.length} akun ${ROLE[role]} bernama "${list[0].name}"`,
          reason: 'Nama sama', items: list.map(u => userItem(u, counts)) }));
      });
      groupBy(users, u => emailKey(u.email)).forEach(([k, list]) => out.push({
        key: 'umail:' + k, kind: 'users', title: `${list.length} akun memakai email ${k}`, reason: 'Email sama', items: list.map(u => userItem(u, counts)) }));
      groupBy(users, u => phoneKey(u.phone || u.whatsapp)).forEach(([k, list]) => out.push({
        key: 'uphone:' + k, kind: 'users', title: `${list.length} akun memakai nomor ${k}`, reason: 'Nomor HP sama', items: list.map(u => userItem(u, counts)) }));
    }
    if (want('courses')) {
      const courses = DB.getCourses();
      const courseItem = (c) => ({ id: c.id, ref: 'course', label: DB.courseTitle(c),
        sub: [DB.courseTutorsShort(c, 3) || 'tanpa tutor', `${DB.getEnrollmentsByCourse(c.id).length} mentee`, DB.courseScheduleLabel(c), c.active === false ? 'nonaktif' : ''].filter(Boolean).join(' • '), at: c.createdAt });
      const seen = new Set();
      groupBy(courses, c => norm(DB.courseTitle(c))).forEach(([k, list]) => {
        list.forEach(c => seen.add(c.id));
        out.push({ key: 'ctitle:' + k, kind: 'courses', title: `${list.length} kelas berjudul "${DB.courseTitle(list[0])}"`, reason: 'Judul kelas sama', items: list.map(courseItem) });
      });
      groupBy(courses.filter(c => (c.mainClasses || []).length), c => (c.subtest || '') + '|' + (c.mainClasses || []).map(norm).sort().join(','))
        .forEach(([k, list]) => {
          if (list.every(c => seen.has(c.id))) return;
          out.push({ key: 'csame:' + k, kind: 'courses', title: `${list.length} kelas ${DB.subtestByName(list[0].subtest)?.short || list[0].subtest} untuk ${(list[0].mainClasses || []).join(', ')}`,
            reason: 'Subtest & kelas utama sama', items: list.map(courseItem) });
        });
      const mains = DB.getMainClasses();
      groupBy(mains, m => norm(m)).forEach(([k, list]) => out.push({
        key: 'main:' + k, kind: 'courses', title: `Kelas utama ditulis ${list.length} kali: ${list.join(' / ')}`, reason: 'Nama kelas utama sama',
        items: list.map(m => ({ id: m, ref: 'main', label: m, sub: `${DB.getStudentsByMainClass(m).length} mentee` })) }));
    }
    if (want('questions')) {
      const qs = DB.getQuestions();
      const index = buildQuestionIndex(qs);
      const done = new Set();
      index.items.forEach(it => {
        if (done.has(it.q.id)) return;
        const sims = similarIn(index, it.q, 30);
        if (!sims.length) return;
        const list = [it.q].concat(sims.map(x => x.q)).filter(q => !done.has(q.id));
        if (list.length < 2) return;
        list.forEach(q => done.add(q.id));
        const exact = sims.every(x => x.sim === 1);
        const st = DB.subtestByName(it.q.subject);
        out.push({ key: 'q:' + list.map(q => q.id).sort().join(','), kind: 'questions',
          title: `${list.length} soal ${st ? st.short : it.q.subject || ''} ${exact ? 'sama persis' : 'sangat mirip'}`,
          reason: exact ? 'Isi soal sama' : `Kemiripan ≥ ${Math.round(NEAR * 100)}%`,
          items: list.map(q => ({ id: q.id, ref: 'question', label: plain(q.text, 160) || '(soal kosong)', authorId: q.authorId,
            sub: [q.questionType || 'Pilihan Ganda', q.difficulty || 'sedang', usesOf(q.id) ? `dipakai ${usesOf(q.id)} ujian` : 'belum dipakai ujian',
              (DB.getUser(q.authorId) || {}).name || ''].filter(Boolean).join(' • '), at: q.createdAt })) });
      });
      if (DB.getPassages) groupBy(DB.getPassages(), p => norm(plain(p.html, 6000))).forEach(([k, list]) => out.push({
        key: 'psg:' + list.map(p => p.id).sort().join(','), kind: 'questions', title: `${list.length} teks bacaan berisi sama: "${list[0].title || plain(list[0].html, 50)}"`,
        reason: 'Isi teks bacaan sama', items: list.map(p => ({ id: p.id, ref: 'passage', label: p.title || plain(p.html, 120), sub: `${DB.questionsOfPassage(p.id).length} soal tertaut`, at: p.createdAt })) }));
    }
    if (want('content')) {
      groupBy(DB.getCbts(), c => norm(c.title)).forEach(([k, list]) => out.push({
        key: 'cbt:' + k, kind: 'content', title: `${list.length} ujian berjudul "${list[0].title}"`, reason: 'Judul ujian sama',
        items: list.map(c => ({ id: c.id, ref: 'cbt', label: c.title, sub: [`${DB.cbtQuestionIds(c).length} soal`, c.startAt ? UI.fmtDateTime(c.startAt) : ''].filter(Boolean).join(' • '), at: c.createdAt })) }));
      [['materials', 'materi', DB.getMaterials], ['modules', 'modul', DB.getModules], ['assignments', 'tugas', DB.getAssignments]].forEach(([kind, label, get]) => {
        if (typeof get !== 'function') return;
        groupBy(get(), x => x.courseId && x.title ? x.courseId + '|' + norm(x.title) : '').forEach(([k, list]) => {
          const c = DB.getCourse(list[0].courseId);
          out.push({ key: kind + ':' + k, kind: 'content', title: `${list.length} ${label} "${list[0].title}" di ${c ? DB.courseTitle(c) : 'kelas yang sama'}`, reason: `Judul ${label} sama dalam satu kelas`,
            items: list.map(x => ({ id: x.id, ref: kind, label: x.title, sub: DB.contentOwnerName ? DB.contentOwnerName(x, c) : '', at: x.createdAt })) });
        });
      });
    }
    const ignored = new Set(ignoreList());
    return out.filter(g => !ignored.has(g.key));
  }
  function usesOf(qid) { return DB.getCbts().filter(c => DB.cbtQuestionIds(c).includes(qid)).length; }

  /* ---------------- Tandai bukan ganda ---------------- */
  const LOCAL_IGNORE = 'lms_dup_ignore_local';
  function ignoreList() {
    const st = DB.getSettings().dupIgnore;
    let local = [];
    try { local = JSON.parse(localStorage.getItem(LOCAL_IGNORE) || '[]'); } catch (e) { local = []; }
    return (Array.isArray(st) ? st : []).concat(Array.isArray(local) ? local : []);
  }
  function ignore(user, key) {
    if (user.role === 'admin') {
      const cur = DB.getSettings().dupIgnore;
      DB.setSetting('dupIgnore', [...new Set((Array.isArray(cur) ? cur : []).concat(key))].slice(-500));
    } else {
      const cur = ignoreList();
      localStorage.setItem(LOCAL_IGNORE, JSON.stringify([...new Set(cur.concat(key))].slice(-500)));
    }
  }

  /* ---------------- Gabungkan ---------------- */
  /** Pakai `keepId`, alihkan rujukan ujian dari soal lain, lalu hapus soal lain. */
  function mergeQuestions(keepId, dropIds) {
    const drop = new Set(dropIds.filter(id => id !== keepId));
    if (!drop.size) return 0;
    DB.getCbts().forEach(c => {
      const swap = (ids) => [...new Set((ids || []).map(id => (drop.has(id) ? keepId : id)))];
      const uses = (c.questionIds || []).some(id => drop.has(id)) || (c.sections || []).some(s => (s.questionIds || []).some(id => drop.has(id)));
      if (!uses) return;
      const patch = { questionIds: swap(c.questionIds) };
      if (Array.isArray(c.sections)) patch.sections = c.sections.map(s => Object.assign({}, s, { questionIds: swap(s.questionIds) }));
      if (c.points && typeof c.points === 'object') {
        const pts = Object.assign({}, c.points);
        drop.forEach(id => { if (pts[id] != null && pts[keepId] == null) pts[keepId] = pts[id]; delete pts[id]; });
        patch.points = pts;
      }
      DB.updateCbt(c.id, patch);
    });
    drop.forEach(id => DB.deleteQuestion(id));
    return drop.size;
  }
  /** Satukan nama kelas utama: mentee & kelas subtest ikut nama yang dipertahankan. */
  function mergeMainClasses(keep, drops) {
    const dropSet = new Set(drops.filter(x => x !== keep));
    // Kelas subtest diganti namanya dulu (tanpa melepas pendaftaran), baru mentee dipindahkan:
    // urutan sebaliknya sempat melepas mentee dari kelas subtest yang hanya mencantumkan nama lama.
    DB.getCourses().forEach(c => {
      const mains = c.mainClasses || [];
      if (!mains.some(m => dropSet.has(m))) return;
      DB.updateCourse(c.id, { mainClasses: [...new Set(mains.map(m => (dropSet.has(m) ? keep : m)))] }, { keepEnrollments: true });
    });
    DB.getUsers().filter(u => u.role === 'siswa' && dropSet.has(u.kelas)).forEach(u => DB.updateUser(u.id, { kelas: keep }));
    DB.setMainClasses(DB.getMainClasses().filter(m => !dropSet.has(m)));
  }
  function mergePassages(keepId, dropIds) {
    const drop = new Set(dropIds.filter(id => id !== keepId));
    DB.getQuestions().filter(q => drop.has(q.passageId)).forEach(q => DB.updateQuestion(q.id, { passageId: keepId }));
    drop.forEach(id => DB.deletePassage(id));
  }

  /* ---------------- Tampilan ---------------- */
  const KIND = {
    users: { label: 'Akun', icon: '👤' },
    courses: { label: 'Kelas', icon: '🏫' },
    questions: { label: 'Soal & teks bacaan', icon: '📝' },
    content: { label: 'Ujian & konten kelas', icon: '📦' }
  };
  const view = { kind: 'all' };

  /** Halaman admin "Cek Data Ganda". */
  function render(container, user) {
    container.innerHTML = '<div class="card"><div class="empty"><span class="spinner"></span> Memeriksa data…</div></div>';
    setTimeout(() => paint(container, user), 20);
  }
  function paint(container, user) {
    const t0 = performance.now();
    const groups = scan();
    const ms = Math.round(performance.now() - t0);
    const byKind = (k) => groups.filter(g => g.kind === k);
    const shown = view.kind === 'all' ? groups : byKind(view.kind);
    container.innerHTML = `
      <div class="card">
        <div class="card-header">${UI.secHead('🔁', 'Cek Data Ganda', 'akun, kelas, soal, teks bacaan, ujian, dan konten yang kemungkinan tercatat dua kali')}
          <button type="button" class="btn btn-sm btn-secondary" id="dupRescan">Periksa ulang</button></div>
        <div class="dup-stats">${Object.entries(KIND).map(([k, v]) => `<button type="button" class="dup-stat ${view.kind === k ? 'is-on' : ''}" data-dup-kind="${k}">
            <span aria-hidden="true">${v.icon}</span><strong>${byKind(k).length}</strong><small>${esc(v.label)}</small></button>`).join('')}
          <button type="button" class="dup-stat ${view.kind === 'all' ? 'is-on' : ''}" data-dup-kind="all"><span aria-hidden="true">Σ</span><strong>${groups.length}</strong><small>Semua grup</small></button></div>
        <p class="muted small" style="margin:10px 0 0;">Diperiksa ${DB.getUsers().length} akun, ${DB.getCourses().length} kelas, ${DB.getQuestions().length} soal dalam ${ms} ms.
          Soal dianggap ganda bila isinya sama atau ≥ ${Math.round(NEAR * 100)}% mirip pada subtest dan teks bacaan yang sama.</p>
      </div>
      ${shown.length ? shown.map(g => groupHtml(g, user)).join('') : `<div class="card"><div class="empty"><div class="empty-icon">✅</div>Tidak ada data ganda${view.kind === 'all' ? '' : ' pada kategori ini'}.</div></div>`}`;
    container.querySelector('#dupRescan').addEventListener('click', () => render(container, user));
    container.querySelectorAll('[data-dup-kind]').forEach(b => b.addEventListener('click', () => { view.kind = b.dataset.dupKind; paint(container, user); }));
    bindGroups(container, user, groups, () => paint(container, user));
  }
  function groupHtml(g, user) {
    const mergeable = g.items.every(it => it.ref === 'question') || g.items.every(it => it.ref === 'main') || g.items.every(it => it.ref === 'passage');
    const canMerge = mergeable && (user.role === 'admin' || g.items.every(it => it.ref !== 'question' || it.authorId === user.id));
    const keep = g.items.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))[0];
    return `<section class="card dup-group" data-dup-group="${esc(g.key)}">
      <div class="dup-head"><span class="dup-kind" aria-hidden="true">${KIND[g.kind].icon}</span>
        <div class="dup-title"><strong>${esc(g.title)}</strong><span class="badge badge-warning">${esc(g.reason)}</span></div>
        <div class="row-acts">
          ${canMerge ? '<button type="button" class="btn btn-sm btn-primary" data-dup-merge>Gabungkan ke yang dipilih</button>' : ''}
          <button type="button" class="btn btn-sm btn-ghost" data-dup-ignore title="Sembunyikan grup ini dari pemeriksaan">Bukan ganda</button>
        </div></div>
      <ul class="dup-items">${g.items.map(it => `<li>
        ${canMerge ? `<label class="dup-keep"><input type="radio" name="keep_${esc(g.key)}" value="${esc(it.id)}" ${it === keep ? 'checked' : ''} aria-label="Pertahankan ${esc(it.label)}"/></label>` : ''}
        <div class="dup-main"><strong>${esc(it.label)}</strong><span>${esc(it.sub || '')}${it.at ? ` • dibuat ${esc(UI.fmtDateTime(it.at))}` : ''}</span></div>
        <div class="row-acts">${itemActions(it, user)}</div></li>`).join('')}</ul>
      ${canMerge ? `<p class="muted small dup-note">${g.items[0].ref === 'question' ? 'Gabungkan: ujian yang memakai soal lain dialihkan ke soal yang dipilih, lalu soal lain dihapus.' : g.items[0].ref === 'main' ? 'Gabungkan: mentee dan kelas subtest dipindahkan ke nama kelas utama yang dipilih.' : 'Gabungkan: soal yang tertaut dipindahkan ke teks bacaan yang dipilih.'}</p>` : ''}
    </section>`;
  }
  function itemActions(it, user) {
    const admin = user.role === 'admin';
    if (it.ref === 'user') return admin ? `<button type="button" class="btn btn-sm btn-secondary" data-dup-open="user:${esc(it.role)}:${esc(it.id)}">Edit</button>
      <button type="button" class="btn btn-sm btn-ghost" data-dup-del="user:${esc(it.id)}">Hapus</button>` : '';
    if (it.ref === 'course') return admin ? `<button type="button" class="btn btn-sm btn-secondary" data-dup-open="course:${esc(it.id)}">Edit</button>
      <button type="button" class="btn btn-sm btn-ghost" data-dup-del="course:${esc(it.id)}">Hapus</button>` : '';
    if (it.ref === 'question') return (admin || it.authorId === user.id) ? `<button type="button" class="btn btn-sm btn-secondary" data-dup-open="question:${esc(it.id)}">Edit</button>
      <button type="button" class="btn btn-sm btn-ghost" data-dup-del="question:${esc(it.id)}">Hapus</button>` : '';
    if (it.ref === 'cbt') return '<button type="button" class="btn btn-sm btn-secondary" data-dup-nav="admin-cbt">Buka CBT</button>';
    return '';
  }
  function bindGroups(root, user, groups, refresh) {
    const find = (key) => groups.find(g => g.key === key);
    root.querySelectorAll('[data-dup-ignore]').forEach(b => b.addEventListener('click', () => {
      const g = find(b.closest('[data-dup-group]').dataset.dupGroup);
      if (!g) return;
      ignore(user, g.key);
      UI.toast('Grup disembunyikan dari pemeriksaan.', 'info');
      refresh();
    }));
    root.querySelectorAll('[data-dup-merge]').forEach(b => b.addEventListener('click', () => {
      const box = b.closest('[data-dup-group]');
      const g = find(box.dataset.dupGroup);
      const keep = (box.querySelector('input[type="radio"]:checked') || {}).value;
      if (!g || !keep) return;
      const others = g.items.map(it => it.id).filter(id => id !== keep);
      const ref = g.items[0].ref;
      if (!UI.confirmDialog(`Gabungkan ${others.length} data ke "${(g.items.find(it => it.id === keep) || {}).label}"? Data lain dihapus setelah rujukannya dipindahkan.`)) return;
      if (ref === 'question') mergeQuestions(keep, others);
      else if (ref === 'main') mergeMainClasses(keep, others);
      else if (ref === 'passage') mergePassages(keep, others);
      UI.toast('Data digabungkan.', 'success');
      refresh();
    }));
    root.querySelectorAll('[data-dup-del]').forEach(b => b.addEventListener('click', () => {
      const [ref, id] = b.dataset.dupDel.split(':');
      if (ref === 'user') {
        const u = DB.getUser(id);
        if (!u || !UI.confirmDialog(`Hapus akun ${u.name} (@${u.username})? Data terkait ikut terhapus.`)) return;
        DB.deleteUser(id);
      } else if (ref === 'course') {
        if (!UI.confirmDialog('Hapus kelas ini beserta materi, tugas, dan ujiannya?')) return;
        DB.deleteCourse(id);
      } else if (ref === 'question') {
        if (!UI.confirmDialog('Hapus soal ini? Soal juga dilepas dari ujian yang memakainya.')) return;
        DB.deleteQuestion(id);
      }
      UI.toast('Data dihapus.', 'success');
      refresh();
    }));
    root.querySelectorAll('[data-dup-open]').forEach(b => b.addEventListener('click', () => {
      const parts = b.dataset.dupOpen.split(':');
      if (parts[0] === 'question') { CbtAdmin.openQuestionForm(user, parts[1], refresh); return; }
      const content = document.getElementById('content');
      if (parts[0] === 'user') { Dashboard.navigate(parts[1] === 'guru' ? 'guru' : parts[1] === 'siswa' ? 'siswa' : 'orangtua'); setTimeout(() => AdminPanel.openUserForm && AdminPanel.openUserForm(parts[1], parts[2]), 60); return; }
      if (parts[0] === 'course') { Dashboard.navigate('courses'); setTimeout(() => AdminPanel.openCourseForm && AdminPanel.openCourseForm(content, parts[1]), 60); }
    }));
    root.querySelectorAll('[data-dup-nav]').forEach(b => b.addEventListener('click', () => Dashboard.navigate(b.dataset.dupNav)));
  }

  /** Dialog "Cek Soal Ganda" dari Bank Soal (admin & tutor). */
  function openQuestionCheck(user, onChange) {
    const groups = scan({ kinds: ['questions'] });
    UI.modal.open('Cek Soal Ganda', `<div class="dup-modal">${groups.length
      ? `<p class="muted small" style="margin-top:0;">${groups.length} grup soal/teks bacaan yang sama atau ≥ ${Math.round(NEAR * 100)}% mirip.</p>${groups.map(g => groupHtml(g, user)).join('')}`
      : '<div class="empty"><div class="empty-icon">✅</div>Tidak ada soal ganda di Bank Soal.</div>'}</div>`);
    const body = document.querySelector('#modalBody .dup-modal');
    if (body) bindGroups(body, user, groups, () => { UI.modal.close(); if (onChange) onChange(); openQuestionCheck(user, onChange); });
  }

  /* ---------------- Pemeriksaan langsung ---------------- */
  /** Akun lain dengan nama/email/nomor yang sama (untuk peringatan di form akun). */
  function similarUsers(draft, ignoreId) {
    const nk = nameKey(draft.name), ek = emailKey(draft.email), pk = phoneKey(draft.phone || draft.whatsapp);
    return DB.getUsers().filter(u => u.id !== ignoreId && (
      (nk && u.role === draft.role && nameKey(u.name) === nk) || (ek && emailKey(u.email) === ek) || (pk && phoneKey(u.phone || u.whatsapp) === pk)))
      .map(u => ({ u, why: nk && u.role === draft.role && nameKey(u.name) === nk ? 'nama sama' : (ek && emailKey(u.email) === ek ? 'email sama' : 'nomor HP sama') }));
  }
  /** Kelas lain dengan judul sama atau subtest + kelas utama sama. */
  function similarCourses(draft, ignoreId) {
    const tk = norm(draft.title);
    const mk = (draft.mainClasses || []).map(norm).sort().join(',');
    return DB.getCourses().filter(c => c.id !== ignoreId && (
      (tk && norm(DB.courseTitle(c)) === tk) || (mk && (c.subtest || '') === (draft.subtest || '') && (c.mainClasses || []).map(norm).sort().join(',') === mk)));
  }
  /** Soal Bank Soal yang sama/mirip dengan draf soal. */
  function similarQuestions(q, ignoreId, pool) {
    const index = buildQuestionIndex((pool || DB.getQuestions()).filter(x => x.id !== ignoreId));
    return similarIn(index, Object.assign({}, q, { id: ignoreId || null }), 5);
  }
  /** Untuk impor massal: indeks dibangun sekali, lalu tiap draf dicek (termasuk sesama draf). */
  function importChecker() {
    const index = buildQuestionIndex(DB.getQuestions());
    const seen = new Map();
    return (q) => {
      const hit = similarIn(index, q, 1)[0];
      if (hit) return { where: 'bank', q: hit.q, sim: hit.sim };
      const k = questionScope(q) + '#' + questionBody(q);
      if (seen.has(k)) return { where: 'file', num: seen.get(k) };
      seen.set(k, q._num || seen.size + 1);
      return null;
    };
  }

  global.Duplicates = { render, scan, openQuestionCheck, similarUsers, similarCourses, similarQuestions, importChecker,
    mergeQuestions, mergeMainClasses, ignore, _test: { norm, nameKey, phoneKey, questionBody, jaccard, shingles } };
})(window);
