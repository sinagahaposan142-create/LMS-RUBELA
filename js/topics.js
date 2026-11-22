/* =========================================================================
 * Topics — taksonomi Materi & Sub Materi per subtest UTBK.
 *
 *   Subtest (mis. Penalaran Umum)
 *     └─ Materi        (mis. Logika Umum)
 *          └─ Sub Materi (mis. Logika dasar)
 *
 * Data: lms_topics (tersinkron, STAFF_ONLY di server)
 *   { id, subtest, parentId|null, name, order, createdAt, createdBy }
 * Dipakai oleh soal (topicId, subtopicId), materi & modul kelas, filter
 * Bank Soal, wizard CBT (filter + ambil acak), dan analisis per materi.
 * =======================================================================*/
(function (global) {
  'use strict';

  const KEY = 'lms_topics';
  const NAME_MAX = 80;
  const NONE = '__none__';           // filter: "belum diberi materi"
  const esc = (s) => (global.UI ? UI.esc(s) : String(s == null ? '' : s));
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const uid = () => 'tp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function load() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save(list) { localStorage.setItem(KEY, JSON.stringify(list)); }

  const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name), 'id');
  const all = () => load();
  const get = (id) => (id ? load().find(t => t.id === id) || null : null);
  /** Materi (tingkat 1) sebuah subtest. */
  const topicsOf = (subtest) => load().filter(t => t.subtest === subtest && !t.parentId).sort(byOrder);
  /** Sub materi sebuah materi. */
  const subsOf = (topicId) => load().filter(t => t.parentId === topicId).sort(byOrder);
  function tree(subtest) {
    const list = load();
    return list.filter(t => t.subtest === subtest && !t.parentId).sort(byOrder)
      .map(t => Object.assign({}, t, { subs: list.filter(s => s.parentId === t.id).sort(byOrder) }));
  }

  function canEdit(user) { return !!user && (user.role === 'admin' || user.role === 'guru'); }
  function actorOf(user) {
    if (user) return user;
    try { return JSON.parse(localStorage.getItem('lms_session') || 'null'); } catch (e) { return null; }
  }

  /* ---------------- tulis ---------------- */
  function validName(name) {
    const n = norm(name);
    if (n.length < 2) throw new Error('Nama minimal 2 karakter.');
    if (n.length > NAME_MAX) throw new Error(`Nama maksimal ${NAME_MAX} karakter.`);
    return n.replace(/[<>]/g, '');
  }
  function siblings(list, subtest, parentId) {
    return list.filter(t => t.subtest === subtest && (t.parentId || null) === (parentId || null));
  }

  /** Tambah materi (parentId kosong) atau sub materi. */
  function add({ subtest, name, parentId }, user) {
    const actor = actorOf(user);
    if (!canEdit(actor)) throw new Error('Hanya admin/tutor yang dapat mengelola materi.');
    const list = load();
    const parent = parentId ? list.find(t => t.id === parentId) : null;
    if (parentId && (!parent || parent.parentId)) throw new Error('Materi induk tidak ditemukan.');
    const st = parent ? parent.subtest : norm(subtest);
    if (!st) throw new Error('Subtest belum dipilih.');
    const n = validName(name);
    const sib = siblings(list, st, parent ? parent.id : null);
    const dup = sib.find(t => t.name.toLowerCase() === n.toLowerCase());
    if (dup) return dup;               // tidak membuat duplikat
    const rec = { id: uid(), subtest: st, parentId: parent ? parent.id : null, name: n,
      order: sib.reduce((m, t) => Math.max(m, t.order || 0), 0) + 1, createdAt: Date.now(), createdBy: actor.id };
    list.push(rec);
    save(list);
    return rec;
  }

  function rename(id, name, user) {
    if (!canEdit(actorOf(user))) throw new Error('Hanya admin/tutor yang dapat mengelola materi.');
    const list = load();
    const t = list.find(x => x.id === id);
    if (!t) throw new Error('Materi tidak ditemukan.');
    const n = validName(name);
    if (siblings(list, t.subtest, t.parentId).some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) {
      throw new Error('Nama ini sudah dipakai pada tingkat yang sama.');
    }
    t.name = n;
    t.updatedAt = Date.now();
    save(list);
    return t;
  }

  function move(id, dir, user) {
    if (!canEdit(actorOf(user))) return;
    const list = load();
    const t = list.find(x => x.id === id);
    if (!t) return;
    const sib = siblings(list, t.subtest, t.parentId).sort(byOrder);
    const i = sib.findIndex(x => x.id === id);
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= sib.length) return;
    [sib[i], sib[j]] = [sib[j], sib[i]];
    sib.forEach((x, k) => { x.order = k + 1; });
    save(list);
  }

  /** Data yang memakai sebuah materi/sub materi. */
  const REFS = [['lms_questions', 'soal'], ['lms_materials', 'materi kelas'], ['lms_modules', 'modul'],
    ['lms_material_plans', 'rencana materi'], ['lms_class_plans', 'rencana kelas']];
  function readKey(k) { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function usage(id) {
    const ids = new Set([id].concat(subsOf(id).map(s => s.id)));
    const out = { total: 0 };
    REFS.forEach(([k, label]) => {
      const n = readKey(k).filter(r => ids.has(r.topicId) || ids.has(r.subtopicId)).length;
      out[label] = n;
      out.total += n;
    });
    return out;
  }
  /** Hitung soal per materi/sub materi dalam satu lintasan. */
  function questionCounts() {
    const map = {};
    readKey('lms_questions').forEach(q => {
      if (q.topicId) map[q.topicId] = (map[q.topicId] || 0) + 1;
      if (q.subtopicId) map[q.subtopicId] = (map[q.subtopicId] || 0) + 1;
    });
    return map;
  }

  /** Hapus materi beserta sub materinya; rujukan pada soal/materi/modul dikosongkan. */
  function remove(id, user) {
    if (!canEdit(actorOf(user))) throw new Error('Hanya admin/tutor yang dapat mengelola materi.');
    const list = load();
    const t = list.find(x => x.id === id);
    if (!t) return;
    const ids = new Set([id].concat(list.filter(x => x.parentId === id).map(x => x.id)));
    REFS.forEach(([k]) => {
      const rows = readKey(k);
      let changed = false;
      rows.forEach(r => {
        if (ids.has(r.topicId)) { r.topicId = null; r.subtopicId = null; changed = true; }
        else if (ids.has(r.subtopicId)) { r.subtopicId = null; changed = true; }
      });
      if (changed) localStorage.setItem(k, JSON.stringify(rows));
    });
    save(list.filter(x => !ids.has(x.id)));
  }

  /** Cari atau buat pasangan materi/sub materi dari nama (impor Excel, soal massal). */
  function resolveNames(subtest, topicName, subName, user) {
    const tn = norm(topicName), sn = norm(subName);
    if (!tn) return { topicId: null, subtopicId: null };
    const actor = actorOf(user);
    let topic = topicsOf(subtest).find(t => t.name.toLowerCase() === tn.toLowerCase());
    if (!topic) {
      if (!canEdit(actor)) return { topicId: null, subtopicId: null };
      topic = add({ subtest, name: tn }, actor);
    }
    if (!sn) return { topicId: topic.id, subtopicId: null };
    let sub = subsOf(topic.id).find(s => s.name.toLowerCase() === sn.toLowerCase());
    if (!sub && canEdit(actor)) sub = add({ parentId: topic.id, name: sn }, actor);
    return { topicId: topic.id, subtopicId: sub ? sub.id : null };
  }

  /** Terapkan kolom sementara _topic/_subtopic hasil impor ke id, lalu buang kolom itu. */
  function applyImportNames(q, user) {
    const out = Object.assign({}, q);
    const r = resolveNames(out.subject, out._topic, out._subtopic, user);
    if (r.topicId) { out.topicId = r.topicId; out.subtopicId = r.subtopicId; }
    delete out._topic;
    delete out._subtopic;
    return out;
  }

  /** Pastikan pasangan id konsisten dengan subtest (dipakai saat menyimpan). */
  function sanitizeRef(subtest, topicId, subtopicId) {
    const t = get(topicId);
    if (!t || t.parentId || t.subtest !== subtest) return { topicId: null, subtopicId: null };
    const s = get(subtopicId);
    return { topicId: t.id, subtopicId: s && s.parentId === t.id ? s.id : null };
  }

  /* ---------------- tampilan ---------------- */
  function labelOf(rec) {
    const t = rec && get(rec.topicId);
    if (!t) return null;
    const s = get(rec.subtopicId);
    return { topic: t.name, sub: s && s.parentId === t.id ? s.name : '', text: t.name + (s && s.parentId === t.id ? ' › ' + s.name : '') };
  }
  function chipsHtml(rec, cls) {
    const l = labelOf(rec);
    if (!l) return '';
    return `<span class="qc-chip tp-chip ${cls || ''}" title="Materi${l.sub ? ' › Sub Materi' : ''}">${esc(l.text)}</span>`;
  }

  /** Cocokkan rekaman dengan filter { topicId, subtopicId } ('' = semua, NONE = tanpa materi). */
  function matches(rec, f) {
    if (!f || !f.topicId) return true;
    if (f.topicId === NONE) return !get(rec.topicId);
    if (rec.topicId !== f.topicId) return false;
    if (!f.subtopicId) return true;
    if (f.subtopicId === NONE) return !rec.subtopicId;
    return rec.subtopicId === f.subtopicId;
  }

  /** Dua kotak filter (dipakai Bank Soal & wizard CBT). */
  function filterHtml(subtest, f, idPrefix) {
    const topics = topicsOf(subtest);
    const subs = f.topicId && f.topicId !== NONE ? subsOf(f.topicId) : [];
    return `
      <select id="${idPrefix}Topic" aria-label="Filter materi">
        <option value="">Semua materi</option>
        ${topics.map(t => `<option value="${esc(t.id)}" ${f.topicId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        <option value="${NONE}" ${f.topicId === NONE ? 'selected' : ''}>Belum diberi materi</option>
      </select>
      <select id="${idPrefix}Sub" aria-label="Filter sub materi" ${subs.length ? '' : 'disabled'}>
        <option value="">Semua sub materi</option>
        ${subs.map(s => `<option value="${esc(s.id)}" ${f.subtopicId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        ${subs.length ? `<option value="${NONE}" ${f.subtopicId === NONE ? 'selected' : ''}>Tanpa sub materi</option>` : ''}
      </select>`;
  }

  /**
   * Pemilih Materi + Sub Materi untuk formulir (soal, materi, modul).
   * @returns {string} HTML; ikat dengan bindPicker(root, …)
   */
  function pickerHtml(idPrefix, opts) {
    const o = opts || {};
    return `<div class="tp-pick" data-tp-pick="${esc(idPrefix)}">
      <div class="form-row">
        <div class="form-group">
          <label for="${esc(idPrefix)}Topic">Materi <span class="muted small">(opsional)</span></label>
          <select id="${esc(idPrefix)}Topic" data-tp-topic></select>
        </div>
        <div class="form-group">
          <label for="${esc(idPrefix)}Sub">Sub Materi <span class="muted small">(opsional)</span></label>
          <select id="${esc(idPrefix)}Sub" data-tp-sub></select>
        </div>
      </div>
      <div class="tp-new" data-tp-new hidden>
        <label class="tp-new-label" data-tp-new-label for="${esc(idPrefix)}New"></label>
        <div class="tp-new-row">
          <input id="${esc(idPrefix)}New" maxlength="${NAME_MAX}" autocomplete="off" data-tp-new-input />
          <button type="button" class="btn btn-sm btn-primary" data-tp-new-ok>Simpan</button>
          <button type="button" class="btn btn-sm btn-secondary" data-tp-new-cancel>Batal</button>
        </div>
        <div class="tp-err small" data-tp-err role="alert" hidden></div>
      </div>
      ${o.hint ? `<div class="muted small tp-hint">${esc(o.hint)}</div>` : ''}
    </div>`;
  }

  /**
   * @param {HTMLElement} root  elemen yang memuat pickerHtml
   * @param {object} o { user, subtest, value:{topicId,subtopicId}, onChange(v) }
   * @returns {{ get(): {topicId, subtopicId}, setSubtest(s) }}
   */
  function bindPicker(root, o) {
    const box = root.querySelector('[data-tp-pick]');
    if (!box) return { get: () => ({ topicId: null, subtopicId: null }), setSubtest: () => {} };
    const tSel = box.querySelector('[data-tp-topic]');
    const sSel = box.querySelector('[data-tp-sub]');
    const newBox = box.querySelector('[data-tp-new]');
    const newInp = box.querySelector('[data-tp-new-input]');
    const newLbl = box.querySelector('[data-tp-new-label]');
    const errEl = box.querySelector('[data-tp-err]');
    const editable = canEdit(o.user);
    let subtest = o.subtest;
    let val = sanitizeRef(subtest, o.value && o.value.topicId, o.value && o.value.subtopicId);
    let creating = null;         // 'topic' | 'sub'

    const emit = () => { if (typeof o.onChange === 'function') o.onChange(Object.assign({}, val)); };
    function paint() {
      const topics = topicsOf(subtest);
      tSel.innerHTML = `<option value="">— Tanpa materi —</option>` +
        topics.map(t => `<option value="${esc(t.id)}" ${val.topicId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('') +
        (editable ? '<option value="__new">＋ Tambah materi baru…</option>' : '');
      const subs = val.topicId ? subsOf(val.topicId) : [];
      sSel.innerHTML = `<option value="">— Tanpa sub materi —</option>` +
        subs.map(s => `<option value="${esc(s.id)}" ${val.subtopicId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') +
        (editable && val.topicId ? '<option value="__new">＋ Tambah sub materi baru…</option>' : '');
      sSel.disabled = !val.topicId;
      if (!topics.length && !editable) tSel.disabled = true;
    }
    function openNew(kind) {
      creating = kind;
      newBox.hidden = false;
      errEl.hidden = true;
      newInp.value = '';
      newLbl.textContent = kind === 'topic'
        ? `Nama materi baru untuk ${subtest}`
        : `Nama sub materi baru di "${(get(val.topicId) || {}).name || ''}"`;
      newInp.placeholder = kind === 'topic' ? 'mis. Logika Umum' : 'mis. Logika dasar';
      setTimeout(() => newInp.focus(), 30);
    }
    function closeNew() { creating = null; newBox.hidden = true; paint(); }
    function commitNew() {
      try {
        const rec = add(creating === 'topic' ? { subtest, name: newInp.value } : { parentId: val.topicId, name: newInp.value }, o.user);
        if (creating === 'topic') val = { topicId: rec.id, subtopicId: null };
        else val.subtopicId = rec.id;
        closeNew();
        emit();
      } catch (e) {
        errEl.textContent = e.message;
        errEl.hidden = false;
      }
    }
    tSel.addEventListener('change', () => {
      if (tSel.value === '__new') { openNew('topic'); return; }
      val = { topicId: tSel.value || null, subtopicId: null };
      paint();
      emit();
    });
    sSel.addEventListener('change', () => {
      if (sSel.value === '__new') { openNew('sub'); return; }
      val.subtopicId = sSel.value || null;
      emit();
    });
    box.querySelector('[data-tp-new-ok]').addEventListener('click', commitNew);
    box.querySelector('[data-tp-new-cancel]').addEventListener('click', closeNew);
    newInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNew(); }
    });
    paint();
    return {
      get: () => Object.assign({}, val),
      setSubtest(s) {
        if (s === subtest) return;
        subtest = s;
        val = { topicId: null, subtopicId: null };
        if (creating) closeNew(); else paint();
        emit();
      }
    };
  }

  /* ---------------- daftar bawaan UTBK (dapat diubah) ---------------- */
  const DEFAULTS = {
    PU: [
      ['Logika Umum', ['Logika dasar', 'Silogisme', 'Implikasi & biimplikasi', 'Negasi & kuantor']],
      ['Penalaran Induktif', ['Analogi', 'Generalisasi', 'Hubungan sebab-akibat']],
      ['Penalaran Kuantitatif', ['Pola bilangan', 'Perbandingan & proporsi', 'Membaca tabel & grafik']],
      ['Penalaran Analitik', ['Penyusunan posisi & urutan', 'Penjadwalan', 'Pengelompokan']]
    ],
    PPU: [
      ['Makna Kata', ['Sinonim', 'Antonim', 'Makna kata dalam konteks', 'Kata berimbuhan']],
      ['Hubungan Antarkalimat', ['Kata penghubung', 'Hubungan antarkalimat', 'Ide pokok paragraf']],
      ['Pemahaman Bacaan Umum', ['Informasi tersurat', 'Informasi tersirat', 'Simpulan bacaan']]
    ],
    PBM: [
      ['Ejaan & Tanda Baca', ['Huruf kapital', 'Tanda baca', 'Penulisan kata']],
      ['Kalimat Efektif', ['Kehematan', 'Kesejajaran', 'Kelogisan']],
      ['Diksi & Bentuk Kata', ['Pilihan kata', 'Kata baku', 'Imbuhan']],
      ['Paragraf', ['Kepaduan paragraf', 'Kalimat sumbang', 'Penyusunan paragraf']]
    ],
    PK: [
      ['Bilangan', ['Operasi bilangan', 'Pecahan & persen', 'FPB & KPK', 'Pangkat & akar']],
      ['Aljabar', ['Persamaan & pertidaksamaan linear', 'Persamaan kuadrat', 'Sistem persamaan', 'Fungsi']],
      ['Geometri', ['Bangun datar', 'Bangun ruang', 'Garis & sudut', 'Koordinat']],
      ['Statistika & Peluang', ['Ukuran pemusatan data', 'Kaidah pencacahan', 'Peluang']],
      ['Perbandingan Kuantitatif', ['Perbandingan nilai P dan Q', 'Kecukupan data']]
    ],
    LBIND: [
      ['Teks Informasi', ['Ide pokok', 'Informasi tersurat', 'Simpulan']],
      ['Teks Argumentasi', ['Fakta dan opini', 'Argumen pendukung', 'Kelemahan argumen']],
      ['Teks Sastra', ['Unsur intrinsik', 'Makna tersirat', 'Amanat']],
      ['Kebahasaan dalam Teks', ['Makna kata', 'Kalimat utama', 'Hubungan antarparagraf']]
    ],
    LBING: [
      ['Main Idea & Purpose', ['Main idea', "Author's purpose", 'Best title']],
      ['Detail & Reference', ['Specific information', 'Reference', 'Restatement']],
      ['Inference', ['Implied information', 'Conclusion', "Author's tone"]],
      ['Vocabulary in Context', ['Synonym', 'Meaning in context']]
    ],
    PM: [
      ['Aritmetika Sosial & Proporsi', ['Untung, rugi & diskon', 'Perbandingan', 'Kecepatan, jarak & waktu']],
      ['Aljabar & Fungsi', ['Persamaan linear', 'Fungsi & grafik', 'Barisan & deret']],
      ['Geometri & Pengukuran', ['Luas & keliling', 'Volume', 'Kesebangunan']],
      ['Data & Peluang', ['Membaca data', 'Statistika dasar', 'Peluang']]
    ]
  };
  /** Tambahkan daftar bawaan yang belum ada (tidak menimpa/menghapus milik Anda). */
  function importDefaults(subtestName, user) {
    const actor = actorOf(user);
    if (!canEdit(actor)) throw new Error('Hanya admin/tutor yang dapat mengelola materi.');
    let added = 0;
    (global.DB ? DB.SUBTESTS : []).forEach(st => {
      if (subtestName && st.name !== subtestName) return;
      (DEFAULTS[st.code] || []).forEach(([tn, subs]) => {
        const before = load().length;
        resolveNames(st.name, tn, '', actor);
        subs.forEach(sn => resolveNames(st.name, tn, sn, actor));
        added += load().length - before;
      });
    });
    return added;
  }

  /* ---------------- analisis penguasaan per materi ---------------- */
  /**
   * Persentase benar per materi & sub materi dari lembar jawaban ujian.
   * Hanya soal yang dinilai otomatis yang dihitung.
   * @returns {Array<{topicId, subtopicId, label, sub, questions, correct, total, percent}>}
   */
  function mastery(cbt, attempts) {
    if (!global.Exam || !cbt) return [];
    const qs = DB.cbtQuestionIds(cbt).map(id => DB.getQuestion(id)).filter(q => q && q.topicId && get(q.topicId));
    if (!qs.length) return [];
    const rows = new Map();
    const bump = (key, base, q, a) => {
      if (!rows.has(key)) rows.set(key, Object.assign({ qids: new Set(), correct: 0, total: 0 }, base));
      const r = rows.get(key);
      r.qids.add(q.id);
      const g = Exam.gradeQuestion(q, (a.answers || {})[q.id]);
      if (!g.auto) return;
      r.total++;
      if (g.correct) r.correct++;
    };
    attempts.forEach(a => qs.forEach(q => {
      const t = get(q.topicId);
      const s = get(q.subtopicId);
      bump('t:' + t.id, { topicId: t.id, subtopicId: null, label: t.name, sub: '' }, q, a);
      if (s && s.parentId === t.id) bump('s:' + s.id, { topicId: t.id, subtopicId: s.id, label: t.name, sub: s.name }, q, a);
    }));
    return [...rows.values()].map(r => ({
      topicId: r.topicId, subtopicId: r.subtopicId, label: r.label, sub: r.sub,
      questions: r.qids.size, correct: r.correct, total: r.total,
      percent: r.total ? Math.round(r.correct / r.total * 100) : null
    })).sort((a, b) => a.label.localeCompare(b.label, 'id') || (a.subtopicId ? 1 : 0) - (b.subtopicId ? 1 : 0) || a.sub.localeCompare(b.sub, 'id'));
  }

  /** Kartu "Penguasaan per Materi" (admin: seluruh peserta; siswa: dirinya). */
  function masteryCardHtml(cbt, attempts, opts) {
    const o = opts || {};
    const rows = mastery(cbt, attempts).filter(r => r.total > 0);
    if (!rows.length) return '';
    const weakest = rows.filter(r => r.subtopicId || !rows.some(x => x.topicId === r.topicId && x.subtopicId))
      .slice().sort((a, b) => a.percent - b.percent).slice(0, 3).filter(r => r.percent < 70);
    const tone = (p) => p >= 75 ? 'is-good' : p >= 50 ? 'is-mid' : 'is-low';
    return `<div class="card">
      <div class="card-header">${UI.secHead('🗂', 'Penguasaan per Materi', o.sub || 'Persentase jawaban benar pada soal yang dinilai otomatis')}</div>
      ${weakest.length ? `<div class="tp-weak">Perlu diperkuat: ${weakest.map(r => `<strong>${esc(r.sub ? r.label + ' › ' + r.sub : r.label)}</strong> (${r.percent}%)`).join(', ')}.</div>` : ''}
      <div class="tp-mastery" role="table" aria-label="Penguasaan per materi">
        ${rows.map(r => `<div class="tp-m-row ${r.subtopicId ? 'is-sub' : ''}" role="row">
          <span class="tp-m-name" role="cell">${esc(r.subtopicId ? r.sub : r.label)}</span>
          <span class="tp-m-meta muted small" role="cell">${r.questions} soal</span>
          <span class="tp-m-bar ${tone(r.percent)}" role="cell" aria-label="${r.percent}% benar"><i style="width:${r.percent}%"></i></span>
          <span class="tp-m-pct" role="cell">${r.percent}%</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  /* ---------------- pengelola (admin & tutor) ---------------- */
  function openManager(user, onClose, initialSubtest) {
    if (!canEdit(user)) { UI.toast('Hanya admin/tutor yang dapat mengelola materi.', 'error'); return; }
    let active = initialSubtest && DB.SUBTEST_NAMES.includes(initialSubtest) ? initialSubtest : DB.SUBTESTS[0].name;
    let editing = null;          // id yang sedang diganti nama
    const open = new Set();      // materi yang sedang dibuka

    UI.modal.open('Materi & Sub Materi', '<div id="tpMgr" class="tp-mgr"></div>', { fullscreenToggle: true, fullKey: 'topics', autofocus: false });
    const host = document.getElementById('tpMgr');
    const modalEl = document.getElementById('genericModal');
    // Panggil onClose sekali saat modal ditutup (tombol × / latar / Escape).
    const obs = new MutationObserver(() => {
      if (modalEl.classList.contains('hidden') || !document.getElementById('tpMgr')) {
        obs.disconnect();
        if (typeof onClose === 'function') onClose();
      }
    });
    obs.observe(modalEl, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

    function paint() {
      const counts = questionCounts();
      const t = tree(active);
      const st = DB.subtestByName(active);
      host.innerHTML = `
        <p class="muted small tp-intro">Kelompokkan soal per <strong>materi</strong> dan <strong>sub materi</strong>. Dipakai untuk memfilter Bank Soal,
          menyusun ujian khusus materi tertentu, dan melihat penguasaan mentee per materi.</p>
        <div class="tp-subtabs" role="tablist" aria-label="Subtest">
          ${DB.SUBTESTS.map(s => `<button type="button" role="tab" aria-selected="${s.name === active}" class="tp-subtab ${s.name === active ? 'is-on' : ''}" data-tp-st="${esc(s.name)}">${esc(s.short)}
            <span class="tp-count">${topicsOf(s.name).length}</span></button>`).join('')}
        </div>
        <div class="tp-head">
          <div><strong>${st ? st.icon + ' ' : ''}${esc(active)}</strong><div class="muted small">${t.length} materi • ${t.reduce((n, x) => n + x.subs.length, 0)} sub materi</div></div>
          <button type="button" class="btn btn-sm btn-secondary" data-tp-defaults>Tambahkan daftar bawaan UTBK</button>
        </div>
        <form class="tp-add" data-tp-add-topic>
          <label class="sr-only" for="tpNewTopic">Materi baru</label>
          <input id="tpNewTopic" maxlength="${NAME_MAX}" placeholder="Nama materi baru, mis. Logika Umum" autocomplete="off" />
          <button type="submit" class="btn btn-sm btn-primary">＋ Materi</button>
        </form>
        ${t.length ? `<ul class="tp-tree">${t.map((m, mi) => `
          <li class="tp-node ${open.has(m.id) ? 'is-open' : ''}">
            <div class="tp-row">
              <button type="button" class="tp-toggle" data-tp-open="${esc(m.id)}" aria-expanded="${open.has(m.id)}" aria-label="${open.has(m.id) ? 'Tutup' : 'Buka'} sub materi ${esc(m.name)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>
              ${editing === m.id ? renameForm(m) : `<span class="tp-name">${esc(m.name)}</span>`}
              <span class="tp-meta">${m.subs.length} sub • ${counts[m.id] || 0} soal</span>
              ${rowActions(m, mi, t.length)}
            </div>
            ${open.has(m.id) ? `<ul class="tp-subs">
              ${m.subs.map((s, si) => `<li class="tp-row is-sub">
                ${editing === s.id ? renameForm(s) : `<span class="tp-name">${esc(s.name)}</span>`}
                <span class="tp-meta">${counts[s.id] || 0} soal</span>
                ${rowActions(s, si, m.subs.length)}
              </li>`).join('')}
              <li><form class="tp-add is-sub" data-tp-add-sub="${esc(m.id)}">
                <label class="sr-only" for="tpNewSub_${esc(m.id)}">Sub materi baru untuk ${esc(m.name)}</label>
                <input id="tpNewSub_${esc(m.id)}" maxlength="${NAME_MAX}" placeholder="Sub materi baru" autocomplete="off" />
                <button type="submit" class="btn btn-sm btn-secondary">＋ Sub materi</button>
              </form></li>
            </ul>` : ''}
          </li>`).join('')}</ul>`
        : `<div class="empty"><div class="empty-icon">🗂</div>Belum ada materi untuk subtest ini.<div class="muted small">Tambahkan sendiri atau gunakan daftar bawaan UTBK sebagai awal.</div></div>`}`;
      bind();
    }
    function renameForm(x) {
      return `<form class="tp-rename" data-tp-rename="${esc(x.id)}"><label class="sr-only" for="tpRen">Nama baru</label>
        <input id="tpRen" value="${esc(x.name)}" maxlength="${NAME_MAX}" autocomplete="off" />
        <button type="submit" class="btn btn-sm btn-primary">Simpan</button>
        <button type="button" class="btn btn-sm btn-secondary" data-tp-ren-cancel>Batal</button></form>`;
    }
    function rowActions(x, i, n) {
      const ic = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
      return `<span class="tp-acts">
        <button type="button" class="tp-act" data-tp-up="${esc(x.id)}" ${i ? '' : 'disabled'} aria-label="Naikkan ${esc(x.name)}">${ic('M12 19V5M6 11l6-6 6 6')}</button>
        <button type="button" class="tp-act" data-tp-down="${esc(x.id)}" ${i < n - 1 ? '' : 'disabled'} aria-label="Turunkan ${esc(x.name)}">${ic('M12 5v14M6 13l6 6 6-6')}</button>
        <button type="button" class="tp-act" data-tp-ren="${esc(x.id)}" aria-label="Ganti nama ${esc(x.name)}">${ic('M4 20h4L19 9l-4-4L4 16v4Z')}</button>
        <button type="button" class="tp-act is-danger" data-tp-del="${esc(x.id)}" aria-label="Hapus ${esc(x.name)}">${ic('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</button>
      </span>`;
    }
    function run(fn) { try { fn(); paint(); } catch (e) { UI.toast(e.message, 'error'); } }
    function bind() {
      host.querySelectorAll('[data-tp-st]').forEach(b => b.addEventListener('click', () => { active = b.dataset.tpSt; editing = null; paint(); }));
      host.querySelectorAll('[data-tp-open]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.tpOpen;
        if (open.has(id)) open.delete(id); else open.add(id);
        paint();
      }));
      host.querySelector('[data-tp-defaults]').addEventListener('click', () => run(() => {
        const n = importDefaults(active, user);
        tree(active).forEach(m => open.add(m.id));
        UI.toast(n ? `${n} materi/sub materi bawaan ditambahkan.` : 'Semua materi bawaan sudah ada.', n ? 'success' : 'info');
      }));
      const addT = host.querySelector('[data-tp-add-topic]');
      addT.addEventListener('submit', (e) => {
        e.preventDefault();
        run(() => { const r = add({ subtest: active, name: addT.querySelector('input').value }, user); open.add(r.id); });
        const again = host.querySelector('#tpNewTopic'); if (again) again.focus();
      });
      host.querySelectorAll('[data-tp-add-sub]').forEach(f => f.addEventListener('submit', (e) => {
        e.preventDefault();
        const pid = f.dataset.tpAddSub;
        run(() => add({ parentId: pid, name: f.querySelector('input').value }, user));
        const again = host.querySelector('#tpNewSub_' + CSS.escape(pid)); if (again) again.focus();
      }));
      host.querySelectorAll('[data-tp-up]').forEach(b => b.addEventListener('click', () => run(() => move(b.dataset.tpUp, -1, user))));
      host.querySelectorAll('[data-tp-down]').forEach(b => b.addEventListener('click', () => run(() => move(b.dataset.tpDown, 1, user))));
      host.querySelectorAll('[data-tp-ren]').forEach(b => b.addEventListener('click', () => { editing = b.dataset.tpRen; paint(); const i = host.querySelector('#tpRen'); if (i) { i.focus(); i.select(); } }));
      host.querySelectorAll('[data-tp-ren-cancel]').forEach(b => b.addEventListener('click', () => { editing = null; paint(); }));
      host.querySelectorAll('[data-tp-rename]').forEach(f => f.addEventListener('submit', (e) => {
        e.preventDefault();
        run(() => { rename(f.dataset.tpRename, f.querySelector('input').value, user); editing = null; });
      }));
      host.querySelectorAll('[data-tp-del]').forEach(b => b.addEventListener('click', () => {
        const x = get(b.dataset.tpDel);
        if (!x) return;
        const u = usage(x.id);
        const nSub = x.parentId ? 0 : subsOf(x.id).length;
        const msg = `Hapus ${x.parentId ? 'sub materi' : 'materi'} "${x.name}"?` +
          (nSub ? `\n${nSub} sub materi di dalamnya ikut terhapus.` : '') +
          (u.total ? `\n${u.soal} soal, ${u['materi kelas']} materi kelas, dan ${u.modul} modul akan kehilangan label ini (isinya tidak terhapus).` : '');
        if (!UI.confirmDialog(msg)) return;
        run(() => remove(x.id, user));
      }));
    }
    paint();
  }

  global.Topics = {
    KEY, NONE, all, get, topicsOf, subsOf, tree, canEdit,
    add, rename, move, remove, usage, questionCounts, resolveNames, applyImportNames, sanitizeRef,
    labelOf, chipsHtml, matches, filterHtml, pickerHtml, bindPicker,
    DEFAULTS, importDefaults, mastery, masteryCardHtml, openManager
  };
})(window);
