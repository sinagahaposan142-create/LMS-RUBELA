/* =====================================================================
 * js/doc-import.js — Impor soal massal dari PDF / Word, dibantu AI
 * ---------------------------------------------------------------------
 * Alur (Bank Soal → "Impor PDF/Word"):
 *  1. Dokumen: Word (.docx, dibaca di perangkat lewat js/office.js; gambar &
 *     format ikut), PDF (teks dibaca dengan pdf.js dari CDN), .txt, atau
 *     tempel teks.
 *  2. Analisis:
 *     - Pola penomoran (tanpa AI): "1." / "1)" = soal, "A." / "a)" / "(A)" =
 *       pilihan, "Kunci: B" / "Jawaban: A, C" = kunci, "Pembahasan:" =
 *       pembahasan, judul subtest (mis. "Penalaran Umum") = subtest soal
 *       berikutnya, bagian "Kunci Jawaban" di akhir dokumen (1. A 2. C …),
 *       pilihan bertanda * dianggap kunci.
 *     - AI (bila admin mengaktifkannya): dokumen dipotong ±10 soal per
 *       permintaan, AI mengubahnya menjadi JSON terstruktur untuk semua
 *       format soal. AI tidak boleh mengarang kunci kecuali diizinkan;
 *       kunci usulan AI ditandai "perlu dicek".
 *  3. Tinjau: setiap soal dapat diperiksa & disunting dengan editor soal
 *     lengkap sebelum disimpan. Hanya soal yang dicentang & valid disimpan.
 * Soal tersimpan sebagai soal Bank Soal biasa (source 'impor-dokumen'),
 * jadi aturan server yang sama berlaku.
 * ===================================================================*/
(function (global) {
  'use strict';

  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const PDFJS_VERSION = '4.10.38';
  const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_PAGES = 80;
  const AI_CHUNK_Q = 10;
  const AI_CHUNK_CHARS = 9000;
  const esc = (s) => UI.esc(s);
  const svg = (d, s) => `<svg viewBox="0 0 24 24" width="${s || 18}" height="${s || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>', 28),
    back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
    spark: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>', 16),
    edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', 16),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', 16),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 14),
    warn: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>', 14)
  };

  /* ------------------------------------------------------------------
   * 1. Membaca dokumen → baris { text, html, pre }
   * ----------------------------------------------------------------*/
  const plainOf = (html) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); };
  const escText = (t) => esc(String(t == null ? '' : t));

  /** HTML dokumen Word → baris. Penomoran otomatis Word dibentuk ulang: daftar bernomor
   *  tingkat atas = nomor soal (berlanjut di seluruh dokumen), tingkat dalam = huruf pilihan. */
  function htmlToLines(html) {
    const box = document.createElement('div');
    box.innerHTML = RichText.sanitize(html);
    const lines = [];
    let qNo = 0;                       // nomor soal terakhir (manual maupun otomatis)
    const add = (pre, h) => {
      const text = (pre + plainOf(h)).trim();
      if (!pre) { const m = /^(\d{1,3})\s*[.)]\s/.exec(text); if (m) qNo = Number(m[1]); }
      if (text || /<img/i.test(h)) lines.push({ pre, html: h.trim(), text });
    };
    function list(el, depth) {
      let i = 0;
      Array.from(el.children).forEach(li => {
        if (li.tagName !== 'LI') return;
        const clone = li.cloneNode(true);
        Array.from(clone.querySelectorAll('ol, ul')).forEach(x => x.remove());
        const ordered = el.tagName === 'OL';
        const pre = !ordered ? '' : depth === 0 ? `${++qNo}. ` : `${LETTERS[i] || '?'}. `;
        i++;
        add(pre, clone.innerHTML);
        Array.from(li.children).forEach(c => { if (c.tagName === 'OL' || c.tagName === 'UL') list(c, depth + 1); });
      });
    }
    function walk(node) {
      Array.from(node.children).forEach(el => {
        const tag = el.tagName;
        if (tag === 'OL' || tag === 'UL') list(el, 0);
        else if (tag === 'TABLE') {
          Array.from(el.querySelectorAll('tr')).forEach(tr => {
            const cells = Array.from(tr.children).map(td => td.innerHTML.trim()).filter(h => plainOf(h) || /<img/i.test(h));
            if (!cells.length) return;
            // Baris tabel 2 kolom "A | teks" dibaca sebagai pilihan; selain itu satu baris per sel.
            if (cells.length === 2 && /^[A-Ha-h1-9][.)]?$/.test(plainOf(cells[0]))) add(plainOf(cells[0]).replace(/[.)]$/, '') + '. ', cells[1]);
            else cells.forEach(c => add('', c));
          });
        } else if (/^(DIV|SECTION|BLOCKQUOTE)$/.test(tag)) walk(el);
        else {
          // Paragraf dengan <br>: tiap baris dipisah (pilihan sering ditulis dengan Shift+Enter).
          const parts = el.innerHTML.split(/<br\s*\/?>/i);
          parts.forEach(p => add('', p));
        }
      });
    }
    walk(box);
    return lines;
  }
  /** Teks datar (PDF/tempel/.txt) → baris. */
  const textToLines = (text) => String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map(t => t.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    .map(t => ({ pre: '', html: escText(t), text: t }));

  let pdfjsPromise = null;
  function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = import(PDFJS_BASE + 'pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
      return m;
    }).catch(() => {
      pdfjsPromise = null;
      throw new Error('Pembaca PDF (pdf.js) tidak dapat dimuat dari internet. Periksa koneksi, atau simpan dokumen sebagai Word (.docx) lalu impor lagi.');
    });
    return pdfjsPromise;
  }
  async function pdfToLines(file, onProgress) {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    let doc;
    try { doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'PDF ini dikunci kata sandi. Buka kuncinya terlebih dahulu.' : 'Berkas PDF tidak dapat dibaca.'); }
    const pages = Math.min(doc.numPages, MAX_PAGES);
    let text = '';
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // Kelompokkan potongan teks per baris berdasarkan posisi vertikal.
      const rows = [];
      tc.items.forEach(it => {
        if (!it.str) { if (it.hasEOL && rows.length) rows[rows.length - 1].eol = true; return; }
        const y = Math.round(it.transform[5]);
        let row = rows.find(r => Math.abs(r.y - y) <= 2.5);
        if (!row) { row = { y, parts: [] }; rows.push(row); }
        row.parts.push({ x: it.transform[4], s: it.str, w: it.width || 0 });
      });
      rows.sort((a, b) => b.y - a.y).forEach(r => {
        r.parts.sort((a, b) => a.x - b.x);
        let line = '', end = null;
        r.parts.forEach(pt => { if (end != null && pt.x - end > 1.5 && !/\s$/.test(line) && !/^\s/.test(pt.s)) line += ' '; line += pt.s; end = pt.x + pt.w; });
        text += line + '\n';
      });
      text += '\n';
      if (onProgress) onProgress(p, pages);
    }
    if (!text.replace(/\s/g, '')) throw new Error('PDF ini tidak memiliki lapisan teks (hasil pindai/foto). Gunakan PDF hasil ekspor Word, atau ketik ulang/OCR terlebih dahulu.');
    return { lines: textToLines(text), pages, totalPages: doc.numPages };
  }
  async function readFile(file, onProgress) {
    if (!file) throw new Error('Pilih berkas terlebih dahulu.');
    if (file.size > MAX_FILE) throw new Error('Berkas lebih dari 25 MB. Pecah dokumen menjadi beberapa bagian.');
    const name = String(file.name || '').toLowerCase();
    if (/\.pdf$/.test(name) || file.type === 'application/pdf') return Object.assign({ kind: 'PDF' }, await pdfToLines(file, onProgress));
    if (/\.docx$/.test(name)) {
      const res = await Office.docxToHtml(file, { image: (blob) => Editor.compressImage(blob, { maxW: 800 }) });
      return { kind: 'Word', lines: htmlToLines(res.html), warnings: res.warnings || [] };
    }
    if (/\.doc$/.test(name)) throw new Error('Format .doc lama belum didukung. Buka di Word lalu "Simpan sebagai" .docx.');
    if (/\.(txt|md)$/.test(name) || /^text\//.test(file.type)) return { kind: 'Teks', lines: textToLines(await file.text()) };
    throw new Error('Gunakan berkas PDF, Word (.docx), atau teks (.txt).');
  }

  /* ------------------------------------------------------------------
   * 2a. Analisis pola penomoran (tanpa AI)
   * ----------------------------------------------------------------*/
  const RE_Q = /^(?:soal\s*(?:no\.?|nomor)?\s*)?(\d{1,3})\s*[.)\]:]\s*/i;
  const RE_OPT = /^\*?\s*[([]?([A-Ha-h])\s*[.)\]:]\s+/;
  const RE_OPT_INLINE = /(?:^|\s)\(?([A-Ha-h])[.)]\s+/g;
  const RE_KEY = /^(?:kunci(?:\s*jawaban)?|jawaban(?:\s*(?:yang\s*)?benar)?|jwb|answer|ans)(?:\s*[:=.-]\s*|\s+|$)(.*)$/i;
  const RE_KEY_HEAD = /^(?:kunci\s*jawaban|answer\s*key|daftar\s*kunci(?:\s*jawaban)?)\s*:?\s*$/i;
  const isKeyHead = (t) => RE_KEY_HEAD.test(t) || /^KUNCI\s*:?$/.test(t);
  const RE_EXPL = /^(?:pembahasan|penjelasan|solusi|alasan|cara(?:\s*penyelesaian)?)\s*[:=.-]?\s*(.*)$/i;
  const RE_DIFF = /^(?:tingkat(?:\s*kesulitan)?|level|kesulitan)\s*[:=]\s*(mudah|sedang|sulit|hots)\b/i;
  const RE_MARK = /^\s*\*\s*|\s*\*\s*$|\s*\((?:benar|kunci|jawaban)\)\s*$/i;

  /** Hapus penanda di depan baris (nomor/huruf) dari HTML tanpa merusak format. */
  function stripLead(line, re) {
    const m = re.exec(line.text);
    if (!m) return line.html;
    if (line.pre && m[0].length <= line.pre.length) return line.html;
    const box = document.createElement('div');
    box.innerHTML = line.html;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const mm = re.exec(n.nodeValue.replace(/^\s+/, ''));
      if (mm) n.nodeValue = n.nodeValue.replace(/^\s+/, '').slice(mm[0].length);
      break;
    }
    return box.innerHTML.trim();
  }
  function subtestFromHeading(t) {
    if (t.length > 70 || RE_Q.test(t) || RE_OPT.test(t)) return null;
    const clean = t.toLowerCase().replace(/^(?:subtes(?:t)?|bagian|tes|materi)\s*[:\-.]?\s*/, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    const hit = DB.SUBTESTS.find(s => {
      const names = [s.name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim(), s.short.toLowerCase(), s.code.toLowerCase(), s.name.toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()];
      return names.includes(clean);
    });
    return hit ? hit.name : null;
  }
  /** "1. A 2. C 3. B,D" / "1-A" / "1) Benar" → { 1: 'A', … } */
  function keyPairs(t) {
    const out = {};
    const re = /(\d{1,3})\s*[.)\-:=]?\s*((?:[A-Ha-h](?:\s*[,&]\s*[A-Ha-h])*)(?![A-Za-z])|benar|salah)/gi;
    let m, n = 0;
    while ((m = re.exec(t))) { out[Number(m[1])] = m[2].replace(/\s+/g, ''); n++; }
    return n ? out : null;
  }
  function splitInlineOptions(text) {
    const marks = [];
    let m;
    RE_OPT_INLINE.lastIndex = 0;
    while ((m = RE_OPT_INLINE.exec(text))) marks.push({ i: m.index + (m[0].match(/^\s/) ? 1 : 0), L: m[1].toUpperCase(), len: m[0].trim().length });
    // Harus berurutan A, B, C… minimal dua penanda.
    const seq = [];
    marks.forEach(mk => { if (mk.L === LETTERS[seq.length]) seq.push(mk); });
    if (seq.length < 2) return null;
    const head = text.slice(0, seq[0].i).trim();
    const opts = seq.map((mk, k) => text.slice(mk.i + mk.len, k + 1 < seq.length ? seq[k + 1].i : undefined).trim());
    return { head, opts };
  }

  function parseLines(lines) {
    const items = [];
    const keyMap = {};
    let cur = null, part = 'text', keySection = false, subject = null, difficulty = null;
    const preamble = [];
    const appendHtml = (a, b) => (a ? a + '<br>' + b : b);
    const full = (line) => (line.pre ? escText(line.pre) : '') + line.html;
    const finish = () => { if (cur) items.push(cur); cur = null; };
    lines.forEach(line => {
      const t = line.text.trim();
      if (!t && !/<img/i.test(line.html)) return;
      if (isKeyHead(t)) { keySection = true; return; }
      if (keySection) {
        const pairs = keyPairs(t);
        if (pairs) { Object.assign(keyMap, pairs); return; }
        keySection = false;
      }
      const st = subtestFromHeading(t);
      if (st) { subject = st; return; }
      const dm = RE_DIFF.exec(t);
      if (dm) { const v = dm[1].toLowerCase() === 'hots' ? 'sulit' : dm[1].toLowerCase(); if (cur) cur.difficulty = v; else difficulty = v; return; }
      const qm = RE_Q.exec(t);
      if (qm) {
        const num = Number(qm[1]);
        // Daftar bernomor di dalam soal (mis. pernyataan 1, 2, 3) bukan soal baru.
        const inner = cur && !cur.options.length && !cur.key && (num <= 1 || num < cur.num || num > cur.num + 3) && cur.num;
        if (!inner) {
          finish();
          cur = { num, subject, difficulty, text: '', options: [], key: '', expl: '', marked: -1 };
          part = 'text';
          let html = stripLead(line, RE_Q);
          const inl = splitInlineOptions(plainOf(html));
          if (inl && inl.opts.length >= 2) { html = escText(inl.head); cur.options = inl.opts.map(escText); part = 'opt'; }
          cur.text = html;
          return;
        }
      }
      if (!cur) { preamble.push(t); return; }
      const om = RE_OPT.exec(t);
      if (om && (part !== 'expl' || LETTERS.indexOf(om[1].toUpperCase()) === cur.options.length)) {
        const inl = splitInlineOptions(t);
        if (inl && inl.opts.length >= 2 && !inl.head) inl.opts.forEach(o => cur.options.push(escText(o)));
        else {
          let html = stripLead(line, RE_OPT);
          if (/^\*/.test(t)) cur.marked = cur.options.length;
          if (RE_MARK.test(plainOf(html))) { cur.marked = cur.options.length; html = html.replace(/^\s*\*\s*/, '').replace(/\s*\*\s*$/, '').replace(/\s*\((?:benar|kunci|jawaban)\)\s*$/i, ''); }
          cur.options.push(html);
        }
        part = 'opt';
        return;
      }
      const km = RE_KEY.exec(t);
      if (km) {
        const k = km[1].trim();
        // "Kunci: B. 20" → ambil huruf; teks lain apa adanya (isian/benar-salah).
        const lm = /^([A-Ha-h](?:\s*[,;&]\s*[A-Ha-h])*)(?:[.)\s]|$)/.exec(k);
        cur.key = lm ? lm[1].replace(/\s+/g, '').replace(/[;&]/g, ',') : k;
        part = cur.key ? 'after' : 'key';
        return;
      }
      const em = RE_EXPL.exec(t);
      if (em) { cur.expl = appendHtml(cur.expl, em[1] ? escText(em[1]) : ''); part = 'expl'; return; }
      if (part === 'key') { cur.key = t; part = 'after'; return; }
      if (part === 'opt' && cur.options.length) cur.options[cur.options.length - 1] = appendHtml(cur.options[cur.options.length - 1], full(line));
      else if (part === 'expl' || part === 'after') { cur.expl = appendHtml(cur.expl, full(line)); part = 'expl'; }
      else cur.text = appendHtml(cur.text, full(line));
    });
    finish();
    items.forEach(it => {
      if (!it.key && keyMap[it.num]) it.key = keyMap[it.num];
      if (!it.key && it.marked >= 0) it.key = LETTERS[it.marked];
    });
    return { items, keyMap, preamble };
  }

  /* ------------------------------------------------------------------
   * 2b. Draf → soal Bank Soal
   * ----------------------------------------------------------------*/
  let seq = 0;
  /** Draf pola penomoran → { q, issues }. */
  function patternDraft(it, d) {
    const keyTokens = String(it.key || '').split(/[,;|/ ]+/).filter(Boolean);
    let format = BankTools.inferFormat(it.key, it.options.length);
    if (it.options.length >= 2 && keyTokens.length === it.options.length && keyTokens.every(k => /^(b|s|benar|salah)$/i.test(k))) format = 'Benar/Salah Majemuk';
    if (!it.options.length && !it.key) format = 'Esai';
    const row = {
      Subtest: it.subject || d.subtest || '', Format: format, Tingkat: it.difficulty || d.difficulty || 'sedang',
      Materi: d.topic || '', 'Sub Materi': d.subtopic || '',
      Pertanyaan: it.text, Kunci: format === 'Benar/Salah Majemuk' ? keyTokens.join('; ') : it.key, Pembahasan: it.expl
    };
    it.options.slice(0, LETTERS.length).forEach((o, i) => { row[LETTERS[i]] = o; });
    const res = BankTools.rowToQuestion(row, { subtest: d.subtest });
    const issues = [];
    if (it.options.length > LETTERS.length) issues.push(`Hanya ${LETTERS.length} pilihan pertama yang dipakai.`);
    const soft = format === 'Esai' && !it.options.length;
    if (soft) issues.push('Tidak ada pilihan & kunci, dibaca sebagai Esai. Buka "Periksa" untuk memastikan formatnya.');
    if (res.error) {
      issues.unshift(it.key ? res.error : (it.options.length ? 'Kunci jawaban tidak ditemukan.' : res.error));
      return { q: null, partial: partialFrom(row, format, it), issues };
    }
    return { q: res.question, issues, guessed: soft };
  }
  function partialFrom(row, format, it) {
    return {
      subject: resolveSubtestName(row.Subtest, DB.SUBTESTS[0].name),
      questionType: format === 'Esai' ? 'Esai' : format, difficulty: row.Tingkat,
      text: wrap(it.text), options: it.options.length ? it.options.map(wrap) : ['', '', '', ''],
      explanation: it.expl ? wrap(it.expl) : '', correctIndex: null, correctIndices: []
    };
  }
  const wrap = (h) => { const s = String(h || '').trim(); if (!s) return ''; return /^\s*</.test(s) ? RichText.sanitize(s) : '<p>' + RichText.sanitize(s) + '</p>'; };
  const para = (t) => { const s = String(t == null ? '' : t).trim(); return s ? '<p>' + escText(s).replace(/\n+/g, '<br>') + '</p>' : ''; };

  function resolveFmt(raw) {
    const all = (global.QEditor && QEditor.FORMATS) ? QEditor.FORMATS.map(f => f.key) : DB.QUESTION_TYPES;
    const v = String(raw || '').trim().toLowerCase();
    const hit = all.find(f => f.toLowerCase() === v);
    if (hit) return hit;
    if (/lebih dari satu|ganda\s*kompleks|multi/.test(v)) return 'Pilihan Lebih dari Satu';
    if (/benar.{0,3}salah.*majemuk|majemuk.*benar/.test(v)) return 'Benar/Salah Majemuk';
    if (/majemuk|matriks|matrix|tabel/.test(v)) return 'Majemuk Kompleks';
    if (/jodoh|pasang|match/.test(v)) return 'Menjodohkan';
    if (/urut|order|sequence/.test(v)) return 'Urutan';
    if (/benar|salah|true|false/.test(v)) return 'Benar/Salah';
    if (/isian|singkat|short/.test(v)) return 'Isian Singkat';
    if (/esai|essay|uraian/.test(v)) return 'Esai';
    return 'Pilihan Ganda';
  }
  /** Kode/singkatan/nama subtest → nama resmi; tidak dikenal → nilai bawaan. */
  function resolveSubtestName(raw, fallback) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return fallback;
    const hit = DB.SUBTESTS.find(x => [x.name, x.short, x.code].some(n => n.toLowerCase() === v) || x.name.toLowerCase().replace(/\s*\(.*\)\s*$/, '') === v);
    return hit ? hit.name : fallback;
  }
  const letterIdx = (k, n) => { const s = String(k == null ? '' : k).trim().toUpperCase().replace(/[.)]$/, ''); const i = /^[A-H]$/.test(s) ? LETTERS.indexOf(s) : (/^\d+$/.test(s) ? Number(s) - 1 : -1); return i >= 0 && i < n ? i : -1; };

  /** Objek hasil AI → { q, partial, issues }. Kunci tidak ada di dokumen → "perlu dicek". */
  function aiDraft(o, d) {
    const issues = [];
    const format = resolveFmt(o.format) || 'Pilihan Ganda';
    const diff = /^(mudah|sedang|sulit)$/i.test(o.difficulty || '') ? o.difficulty.toLowerCase() : (d.difficulty || 'sedang');
    const q = { subject: resolveSubtestName(o.subtest, d.subtest || DB.SUBTESTS[0].name), questionType: format, difficulty: diff,
      text: para(o.text), explanation: o.explanation ? para(o.explanation) : '', options: [], correctIndex: null };
    if (d.topic) { q._topic = d.topic; if (d.subtopic) q._subtopic = d.subtopic; }
    const ans = o.answer;
    const guessed = o.keyFound === false && ans != null && ans !== '' && !(Array.isArray(ans) && !ans.length);
    const fail = (msg) => { issues.unshift(msg); return { q: null, partial: Object.assign({}, q, { options: q.options.length ? q.options : ['', '', '', ''] }), issues }; };
    if (!plainOf(q.text)) return fail('Teks soal kosong.');
    const strs = (a) => (Array.isArray(a) ? a : []).map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    switch (format) {
      case 'Pilihan Ganda': case 'Benar/Salah': case 'Pilihan Lebih dari Satu': {
        let opts = strs(o.options);
        if (format === 'Benar/Salah' && opts.length < 2) opts = ['Benar', 'Salah'];
        if (opts.length < 2) return fail('Minimal dua pilihan jawaban.');
        q.options = opts.slice(0, 8).map(para);
        if (format === 'Pilihan Lebih dari Satu') {
          const picks = [...new Set((Array.isArray(ans) ? ans : String(ans || '').split(/[,;|/ ]+/)).map(k => letterIdx(k, q.options.length)).filter(i => i >= 0))].sort((a, b) => a - b);
          if (!picks.length) return fail('Kunci jawaban tidak ditemukan.');
          q.correctIndices = picks; q.correctIndex = picks[0];
        } else {
          let i = letterIdx(Array.isArray(ans) ? ans[0] : ans, q.options.length);
          if (i < 0 && format === 'Benar/Salah') i = /^b|benar|true/i.test(String(ans || '')) ? 0 : /^s|salah|false/i.test(String(ans || '')) ? 1 : -1;
          if (i < 0) return fail('Kunci jawaban tidak ditemukan.');
          q.correctIndex = i;
        }
        break;
      }
      case 'Isian Singkat': {
        const list = (Array.isArray(ans) ? strs(ans) : String(ans || '').split('|').map(x => x.trim()).filter(Boolean)).slice(0, 10);
        if (!list.length) return fail('Jawaban isian tidak ditemukan.');
        q.answers = list;
        q.numeric = list.every(a => a !== '' && !isNaN(Number(a.replace(',', '.'))));
        break;
      }
      case 'Benar/Salah Majemuk': {
        const st = (Array.isArray(o.statements) ? o.statements : []).filter(s => s && String(s.text || '').trim());
        if (st.length < 2) return fail('Minimal dua pernyataan.');
        if (st.some(s => typeof s.value !== 'boolean')) return fail('Kunci Benar/Salah tiap pernyataan belum lengkap.');
        q.statements = st.slice(0, 8).map(s => ({ text: para(s.text), value: s.value }));
        break;
      }
      case 'Majemuk Kompleks': {
        const cols = strs(o.columns).slice(0, DB.MATRIX_MAX_COLS);
        const st = (Array.isArray(o.statements) ? o.statements : []).filter(s => s && String(s.text || '').trim());
        if (cols.length < 2) return fail('Kolom jawaban minimal dua.');
        if (st.length < 2) return fail('Minimal dua pernyataan.');
        if (st.some(s => !(Number.isInteger(s.correct) && s.correct >= 0 && s.correct < cols.length))) return fail('Kunci kolom tiap pernyataan belum lengkap.');
        q.columns = cols.map(c => c.replace(/[<>]/g, '').slice(0, 40));
        q.statements = st.slice(0, 8).map(s => ({ text: para(s.text), correct: s.correct }));
        break;
      }
      case 'Menjodohkan': {
        const pairs = (Array.isArray(o.pairs) ? o.pairs : []).filter(p => p && String(p.left || '').trim() && String(p.right || '').trim());
        if (pairs.length < 2) return fail('Minimal dua pasangan.');
        q.pairs = pairs.slice(0, 10).map(p => ({ left: para(p.left), right: para(p.right) }));
        break;
      }
      case 'Urutan': {
        const items = strs(o.order);
        if (items.length < 2) return fail('Minimal dua langkah urutan.');
        q.orderItems = items.slice(0, 10).map(para);
        break;
      }
      default: {     // Esai
        q.questionType = 'Esai';
        q.keywords = (Array.isArray(ans) ? strs(ans) : String(ans || '').split(/[,;|]/).map(x => x.trim()).filter(Boolean)).slice(0, 12);
      }
    }
    if (guessed && format !== 'Esai') issues.push('Kunci diusulkan AI karena tidak tertulis di dokumen. Periksa sebelum disimpan.');
    return { q, issues, guessed };
  }

  /* ------------------------------------------------------------------
   * 2c. Analisis dengan AI (per potongan)
   * ----------------------------------------------------------------*/
  function chunksOf(lines, items) {
    // Potong di awal soal (pola penomoran) agar satu soal tidak terbelah; cadangan per jumlah karakter.
    const starts = [];
    lines.forEach((l, i) => { if (RE_Q.test(l.text.trim())) starts.push(i); });
    const out = [];
    let buf = [], qs = 0, size = 0;
    const flush = () => { if (buf.length) out.push(buf.join('\n')); buf = []; qs = 0; size = 0; };
    lines.forEach((l, i) => {
      const isStart = starts.includes(i);
      if (isStart && (qs >= AI_CHUNK_Q || size > AI_CHUNK_CHARS)) flush();
      if (!isStart && size > AI_CHUNK_CHARS * 1.4) flush();
      buf.push(l.text);
      size += l.text.length + 1;
      if (isStart) qs++;
    });
    flush();
    return out;
  }
  function aiPrompt(chunk, keyMap, allowGuess) {
    const subtests = DB.SUBTESTS.map(s => `${s.code} = ${s.name}`).join('; ');
    const keys = Object.keys(keyMap || {}).length ? Object.keys(keyMap).map(n => `${n}=${keyMap[n]}`).join(', ') : '(tidak ada)';
    return `Ubah potongan dokumen soal di bawah menjadi JSON dengan bentuk {"questions":[...]}.
Setiap soal: {"number":1,"format":"Pilihan Ganda|Pilihan Lebih dari Satu|Benar/Salah|Isian Singkat|Benar/Salah Majemuk|Majemuk Kompleks|Menjodohkan|Urutan|Esai",
"subtest":"kode subtest atau kosong","difficulty":"mudah|sedang|sulit atau kosong","text":"teks soal","options":["teks pilihan A","..."],
"answer":"A" | ["A","C"] | "Benar" | "jawaban isian (beberapa jawaban dipisah |)" | null,
"statements":[{"text":"...","value":true}] (Benar/Salah Majemuk) atau [{"text":"...","correct":0}] (Majemuk Kompleks, indeks kolom),
"columns":["Benar","Salah","Tidak diketahui"] (Majemuk Kompleks), "pairs":[{"left":"...","right":"..."}] (Menjodohkan, pasangan yang benar),
"order":["langkah pertama","..."] (Urutan, urutan yang benar), "explanation":"pembahasan atau kosong", "keyFound":true}
Aturan:
- Satu objek per soal sesuai urutan dokumen. Jangan menambah, menggabung, atau menghilangkan soal.
- Salin teks soal & pilihan apa adanya (rapikan spasi). Buang nomor soal dan huruf pilihan dari teks.
- Rumus matematika tulis dalam LaTeX di antara $...$.
- Kunci hanya dari dokumen (tulisan "Kunci", "Jawaban", tanda *, atau daftar kunci). ${allowGuess
    ? 'Bila tidak tertulis, boleh usulkan kunci yang paling tepat tetapi isi "keyFound": false.'
    : 'Bila tidak tertulis, isi "answer": null dan "keyFound": false. JANGAN menebak kunci.'}
- Soal tanpa pilihan & tanpa kunci kemungkinan Esai. Pilihan berupa pernyataan dengan kunci B/S per baris = Benar/Salah Majemuk.
- Subtest yang dikenal: ${subtests}. Isi hanya bila dokumen menyebutkannya.
Daftar kunci yang ditemukan terpisah di dokumen (nomor=kunci): ${keys}
Potongan dokumen:
"""
${chunk}
"""`;
  }
  async function aiParse(lines, items, keyMap, opts) {
    const o = opts || {};
    const chunks = chunksOf(lines, items);
    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      if (o.cancelled && o.cancelled()) throw new Error('Analisis AI dihentikan.');
      if (o.onProgress) o.onProgress(i, chunks.length);
      const data = await AI.askJson(aiPrompt(chunks[i], keyMap, o.allowGuess), {
        system: 'Kamu penyusun Bank Soal UTBK yang teliti. Jawab hanya dengan JSON valid sesuai bentuk yang diminta.',
        temperature: 0.1, maxTokens: 8000
      });
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.questions) ? data.questions : AI.normalizeRows(data));
      list.forEach(x => {
        if (!x || typeof x !== 'object') return;
        const num = Number(x.number);
        if ((x.answer == null || x.answer === '') && num && keyMap[num]) { x.answer = keyMap[num].includes(',') ? keyMap[num].split(',') : keyMap[num]; x.keyFound = true; }
        out.push(x);
      });
    }
    if (o.onProgress) o.onProgress(chunks.length, chunks.length);
    return out;
  }

  /* ------------------------------------------------------------------
   * 3. Tampilan
   * ----------------------------------------------------------------*/
  let ws = null;
  function close() {
    if (ws) { ws.remove(); ws = null; }
    document.body.classList.remove('di-open');
  }

  function open(user, onDone, defaults) {
    close();
    const st = {
      defaults: { subtest: (defaults && defaults.subtest) || '', difficulty: '', topic: '', subtopic: '' },
      source: null, lines: [], keyMap: {}, drafts: [], filter: 'all', busy: false, cancel: false, allowGuess: false, method: 'pola', note: ''
    };
    ws = document.createElement('div');
    ws.className = 'di-ws';
    ws.setAttribute('role', 'dialog');
    ws.setAttribute('aria-modal', 'true');
    ws.setAttribute('aria-label', 'Impor soal dari dokumen');
    document.body.appendChild(ws);
    document.body.classList.add('di-open');
    ws.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || document.querySelector('.qe-workspace, .qe-dialog-back')) return;
      const btn = ws.querySelector('[data-di-close]');
      if (btn) btn.click();
    });
    const aiOn = !!(global.AI && AI.ready());

    const finishAll = (n) => { close(); if (typeof onDone === 'function') onDone(n); };

    function shell() {
      ws.innerHTML = `
        <header class="di-top">
          <button type="button" class="btn btn-secondary btn-sm" data-di-close>${IC.back} Kembali</button>
          <div class="di-title"><strong>Impor Soal dari PDF / Word</strong><span>Baca dokumen, rapikan formatnya, periksa, lalu simpan ke Bank Soal</span></div>
        </header>
        <div class="di-body">
          <aside class="di-side" aria-label="Dokumen & pengaturan">
            <section class="di-card">
              <h3>1. Dokumen</h3>
              <label class="di-drop" id="diDrop" tabindex="0">
                <input type="file" id="diFile" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden />
                <span class="di-drop-ic">${IC.file}</span>
                <strong>${st.source ? esc(st.source.name) : 'Pilih atau seret berkas'}</strong>
                <span>${st.source ? esc(`${st.source.kind}${st.source.pages ? ` • ${st.source.pages} halaman` : ''} • ${st.lines.length} baris teks`) : 'PDF, Word (.docx), atau teks. Maks. 25 MB.'}</span>
              </label>
              <details class="di-paste" ${st.source && st.source.kind === 'Tempel' ? 'open' : ''}><summary>Atau tempel teks soal</summary>
                <textarea id="diPaste" rows="6" placeholder="1. Hasil dari 12 + 8 adalah …&#10;A. 18&#10;B. 20&#10;C. 22&#10;Kunci: B"></textarea>
                <button type="button" class="btn btn-sm btn-secondary" id="diPasteGo">Baca teks</button></details>
            </section>
            <section class="di-card">
              <h3>2. Nilai bawaan</h3>
              <p class="di-hint">Dipakai bila dokumen tidak menyebutkannya.</p>
              <label class="di-field"><span>Subtest</span><select id="diSub"><option value="">— pilih —</option>${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${st.defaults.subtest === s.name ? 'selected' : ''}>${esc(s.short)} — ${esc(s.name)}</option>`).join('')}</select></label>
              <label class="di-field"><span>Tingkat</span><select id="diDiff"><option value="">Sedang (bawaan)</option>${['mudah', 'sedang', 'sulit'].map(x => `<option value="${x}" ${st.defaults.difficulty === x ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></label>
              <label class="di-field"><span>Materi (opsional)</span><input id="diTopic" maxlength="80" value="${esc(st.defaults.topic)}" placeholder="mis. Barisan & Deret" /></label>
              <label class="di-field"><span>Sub Materi (opsional)</span><input id="diSubtopic" maxlength="80" value="${esc(st.defaults.subtopic)}" /></label>
            </section>
            <section class="di-card">
              <h3>3. Cara membaca</h3>
              <label class="di-radio"><input type="radio" name="diMethod" value="pola" ${st.method === 'pola' ? 'checked' : ''}/><span><strong>Pola penomoran</strong><small>Cepat & tanpa AI. Cocok untuk dokumen bernomor rapi (1. … A. … Kunci: …).</small></span></label>
              <label class="di-radio ${aiOn ? '' : 'is-off'}"><input type="radio" name="diMethod" value="ai" ${st.method === 'ai' ? 'checked' : ''} ${aiOn ? '' : 'disabled'}/><span><strong>${IC.spark} Analisis AI</strong><small>${aiOn ? 'Untuk dokumen tidak rapi atau format lain (majemuk, menjodohkan, urutan). Dibaca per ±10 soal.' : 'AI belum diaktifkan admin di Pengaturan.'}</small></span></label>
              ${aiOn ? `<label class="di-check"><input type="checkbox" id="diGuess" ${st.allowGuess ? 'checked' : ''}/><span>Izinkan AI mengusulkan kunci yang tidak tertulis (ditandai perlu dicek)</span></label>` : ''}
              <button type="button" class="btn btn-primary di-run" id="diRun" ${st.lines.length && !st.busy ? '' : 'disabled'}>${st.method === 'ai' ? IC.spark + ' Analisis dengan AI' : 'Baca soal'}</button>
              <details class="di-guide"><summary>Contoh dokumen yang terbaca rapi</summary>
                <pre>PENALARAN UMUM
1. Semua siswa rajin. Andi siswa. Maka …
A. Andi rajin
B. Andi malas
C. Tidak dapat disimpulkan
Kunci: A
Pembahasan: Premis umum berlaku untuk Andi.

2. Hasil 7 × 8 = …
Jawaban: 56

Kunci Jawaban
1. A  2. 56</pre></details>
            </section>
          </aside>
          <main class="di-main" id="diMain" aria-live="polite"></main>
        </div>`;
      bind();
      paintMain();
      // Layar sempit: panel pengaturan di atas, jadi langsung tampilkan hasil pembacaan.
      if (st.drafts.length && global.matchMedia && matchMedia('(max-width: 900px)').matches) {
        const m = ws.querySelector('#diMain');
        if (m) m.scrollIntoView({ block: 'start' });
      }
    }

    function readDefaults() {
      st.defaults.subtest = ws.querySelector('#diSub').value;
      st.defaults.difficulty = ws.querySelector('#diDiff').value;
      st.defaults.topic = ws.querySelector('#diTopic').value.replace(/\s+/g, ' ').trim();
      st.defaults.subtopic = ws.querySelector('#diSubtopic').value.replace(/\s+/g, ' ').trim();
    }
    function bind() {
      ws.querySelector('[data-di-close]').addEventListener('click', () => {
        if (st.drafts.length && !UI.confirmDialog('Tutup impor? Soal yang belum disimpan akan hilang.')) return;
        close();
      });
      const file = ws.querySelector('#diFile');
      const drop = ws.querySelector('#diDrop');
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
      drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
      file.addEventListener('change', () => { if (file.files[0]) load(file.files[0]); });
      ws.querySelector('#diPasteGo').addEventListener('click', () => {
        const t = ws.querySelector('#diPaste').value;
        if (!t.trim()) { UI.toast('Tempel teks soal terlebih dahulu.', 'error'); return; }
        readDefaults();
        st.source = { name: 'Teks tempelan', kind: 'Tempel' };
        st.lines = textToLines(t);
        st.drafts = [];
        run();
      });
      ['#diSub', '#diDiff', '#diTopic', '#diSubtopic'].forEach(sel => ws.querySelector(sel).addEventListener('change', readDefaults));
      ws.querySelectorAll('[name=diMethod]').forEach(r => r.addEventListener('change', () => { st.method = r.value; readDefaults(); shell(); }));
      const g = ws.querySelector('#diGuess');
      if (g) g.addEventListener('change', () => { st.allowGuess = g.checked; });
      ws.querySelector('#diRun').addEventListener('click', () => { readDefaults(); run(); });
    }

    async function load(f) {
      readDefaults();
      st.busy = true; st.drafts = []; st.note = '';
      paintStatus('Membaca dokumen…');
      try {
        const res = await readFile(f, (p, n) => paintStatus(`Membaca halaman ${p} dari ${n}…`));
        st.source = { name: f.name, kind: res.kind, pages: res.pages || 0 };
        st.lines = res.lines;
        if (res.totalPages && res.totalPages > res.pages) st.note = `Hanya ${res.pages} dari ${res.totalPages} halaman pertama yang dibaca. Pecah dokumen untuk sisanya.`;
        if (res.warnings && res.warnings.length) st.note = (st.note ? st.note + ' ' : '') + res.warnings.join(' ');
        st.busy = false;
        shell();
        run();
      } catch (e) {
        st.busy = false;
        shell();
        paintStatus(null, e.message || 'Dokumen tidak dapat dibaca.');
      }
    }

    async function run() {
      if (!st.lines.length || st.busy) return;
      const base = parseLines(st.lines);
      st.keyMap = base.keyMap;
      if (st.method === 'ai') {
        st.busy = true; st.cancel = false;
        paintStatus('Menyiapkan analisis AI…', null, true);
        try {
          const list = await aiParse(st.lines, base.items, base.keyMap, {
            allowGuess: st.allowGuess, cancelled: () => st.cancel,
            onProgress: (i, n) => paintStatus(i < n ? `AI membaca bagian ${i + 1} dari ${n}…` : 'Merapikan hasil…', null, true, n ? i / n : 0)
          });
          st.drafts = list.map(o => Object.assign(makeDraft(aiDraft(o, st.defaults), 'ai', o.number), { fromDocSubtest: !!resolveSubtestName(o.subtest, '') }));
          if (!st.drafts.length) st.note = 'AI tidak menemukan soal pada dokumen ini.';
        } catch (e) {
          st.busy = false;
          shell();
          paintStatus(null, (e && e.message) || 'Analisis AI gagal.');
          return;
        }
        st.busy = false;
      } else {
        st.drafts = base.items.map(it => Object.assign(makeDraft(patternDraft(it, st.defaults), 'pola', it.num), { fromDocSubtest: !!it.subject }));
      }
      st.drafts.forEach(dr => { dr.selected = ready(dr); });
      if (!st.defaults.subtest && st.drafts.some(dr => dr.q && !dr.fromDocSubtest)) {
        st.note = (st.note ? st.note + ' ' : '') + `Subtest tidak disebutkan untuk sebagian soal, jadi dipakai ${DB.SUBTESTS[0].short}. Ubah lewat "Subtest terpilih" sebelum menyimpan.`;
      }
      shell();
    }
    function makeDraft(res, source, num) {
      const q = res.q;
      if (q && st.defaults.topic && !q._topic) { q._topic = st.defaults.topic; if (st.defaults.subtopic) q._subtopic = st.defaults.subtopic; }
      return { uid: 'd' + (++seq), num: num || null, source, q, partial: res.partial || null, issues: res.issues || [], selected: !!q, guessed: !!res.guessed };
    }
    const ready = (d) => !!d.q && !d.guessed;

    function paintStatus(text, error, cancellable, pct) {
      const main = ws && ws.querySelector('#diMain');
      if (!main) return;
      if (error) { main.innerHTML = `<div class="di-empty is-error">${IC.warn}<strong>${esc(error)}</strong><span>Coba berkas lain atau tempel teksnya.</span></div>`; return; }
      main.innerHTML = `<div class="di-empty"><span class="spinner"></span><strong>${esc(text)}</strong>
        ${pct != null ? `<span class="di-bar"><i style="width:${Math.round(pct * 100)}%"></i></span>` : ''}
        ${cancellable ? '<button type="button" class="btn btn-sm btn-secondary" id="diCancel">Hentikan</button>' : ''}</div>`;
      const c = main.querySelector('#diCancel');
      if (c) c.addEventListener('click', () => { st.cancel = true; c.disabled = true; c.textContent = 'Menghentikan…'; });
    }

    function paintMain() {
      const main = ws.querySelector('#diMain');
      if (!st.drafts.length) {
        main.innerHTML = `<div class="di-empty">${IC.file}<strong>${st.lines.length ? 'Belum ada soal terbaca' : 'Unggah dokumen soal'}</strong>
          <span>${st.lines.length ? (st.note || 'Pola penomoran tidak menemukan soal. Pastikan soal diawali nomor (1. / 1)) dan pilihan diawali huruf (A. / a)), atau gunakan Analisis AI.') : 'Hasil pembacaan muncul di sini untuk diperiksa sebelum disimpan.'}</span></div>`;
        return;
      }
      const total = st.drafts.length;
      const ok = st.drafts.filter(ready).length;
      const check = total - ok;
      const shown = st.drafts.filter(d => st.filter === 'all' || (st.filter === 'ok' ? ready(d) : !ready(d)));
      const chosen = st.drafts.filter(d => d.selected && d.q).length;
      main.innerHTML = `
        <div class="di-summary">
          <div><strong>${total}</strong><span>soal terbaca</span></div>
          <div class="is-ok"><strong>${ok}</strong><span>siap disimpan</span></div>
          <div class="is-warn"><strong>${check}</strong><span>perlu dicek</span></div>
          <div><strong>${Object.keys(st.keyMap).length}</strong><span>kunci dari daftar kunci</span></div>
        </div>
        ${st.note ? `<p class="di-note">${esc(st.note)}</p>` : ''}
        <div class="di-tools">
          <div class="di-seg" role="radiogroup" aria-label="Saring">${[['all', 'Semua'], ['ok', 'Siap'], ['check', 'Perlu dicek']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${st.filter === k}" class="${st.filter === k ? 'is-on' : ''}" data-di-filter="${k}">${l}</button>`).join('')}</div>
          <label class="di-check"><input type="checkbox" id="diAll" ${chosen && chosen === st.drafts.filter(d => d.q).length ? 'checked' : ''}/><span>Pilih semua yang valid</span></label>
          <label class="di-inline"><span>Subtest terpilih</span><select id="diBulkSub"><option value="">— ubah ke —</option>${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}">${esc(s.short)}</option>`).join('')}</select></label>
          <label class="di-inline"><span>Tingkat terpilih</span><select id="diBulkDiff"><option value="">— ubah ke —</option><option value="mudah">Mudah</option><option value="sedang">Sedang</option><option value="sulit">Sulit</option></select></label>
          ${aiOn && st.method !== 'ai' ? `<button type="button" class="btn btn-sm btn-secondary" id="diRetryAi">${IC.spark} Baca ulang dengan AI</button>` : ''}
        </div>
        <ol class="di-list">${shown.map(cardHtml).join('')}</ol>
        <footer class="di-foot">
          <span>${chosen} soal dipilih${check ? ` • ${check} soal perlu dicek tidak ikut tersimpan sebelum diperiksa` : ''}</span>
          <button type="button" class="btn btn-primary" id="diSave" ${chosen ? '' : 'disabled'}>Simpan ${chosen} soal ke Bank Soal</button>
        </footer>`;
      main.querySelectorAll('[data-di-filter]').forEach(b => b.addEventListener('click', () => { st.filter = b.dataset.diFilter; paintMain(); }));
      main.querySelector('#diAll').addEventListener('change', (e) => { st.drafts.forEach(d => { d.selected = e.target.checked && !!d.q && !d.guessed; }); paintMain(); });
      main.querySelectorAll('[data-di-sel]').forEach(cb => cb.addEventListener('change', () => { const d = byId(cb.dataset.diSel); if (d) d.selected = cb.checked; paintMain(); }));
      main.querySelectorAll('[data-di-edit]').forEach(b => b.addEventListener('click', () => editDraft(byId(b.dataset.diEdit))));
      main.querySelectorAll('[data-di-del]').forEach(b => b.addEventListener('click', () => { st.drafts = st.drafts.filter(d => d.uid !== b.dataset.diDel); paintMain(); }));
      main.querySelector('#diBulkSub').addEventListener('change', (e) => { if (!e.target.value) return; st.drafts.forEach(d => { if (d.selected && d.q) d.q.subject = e.target.value; }); paintMain(); UI.toast('Subtest soal terpilih diubah.', 'success'); });
      main.querySelector('#diBulkDiff').addEventListener('change', (e) => { if (!e.target.value) return; st.drafts.forEach(d => { if (d.selected && d.q) d.q.difficulty = e.target.value; }); paintMain(); UI.toast('Tingkat soal terpilih diubah.', 'success'); });
      const retry = main.querySelector('#diRetryAi');
      if (retry) retry.addEventListener('click', () => { st.method = 'ai'; shell(); run(); });
      main.querySelector('#diSave').addEventListener('click', save);
    }
    const byId = (uid) => st.drafts.find(d => d.uid === uid);

    function previewOf(q) {
      const f = q.questionType;
      if (f === 'Benar/Salah Majemuk') return `<ul class="di-opts">${(q.statements || []).map(s => `<li class="${s.value ? 'is-key' : ''}"><span class="di-k">${s.value ? 'B' : 'S'}</span><span class="rt-content">${RichText.render(s.text)}</span></li>`).join('')}</ul>`;
      if (f === 'Majemuk Kompleks') return `<ul class="di-opts">${(q.statements || []).map(s => `<li><span class="di-k">${esc((q.columns || [])[s.correct] || '?')}</span><span class="rt-content">${RichText.render(s.text)}</span></li>`).join('')}</ul>`;
      if (f === 'Menjodohkan') return `<ul class="di-opts">${(q.pairs || []).map(p => `<li><span class="rt-content">${RichText.render(p.left)}</span><span class="di-arrow">→</span><span class="rt-content">${RichText.render(p.right)}</span></li>`).join('')}</ul>`;
      if (f === 'Urutan') return `<ol class="di-opts is-num">${(q.orderItems || []).map(x => `<li><span class="rt-content">${RichText.render(x)}</span></li>`).join('')}</ol>`;
      if (f === 'Isian Singkat') return `<p class="di-ans">Jawaban: <strong>${esc((q.answers || []).join(' / '))}</strong></p>`;
      if (f === 'Esai') return `<p class="di-ans">${(q.keywords || []).length ? 'Kata kunci penilaian: ' + esc(q.keywords.join(', ')) : 'Esai dinilai manual oleh tutor.'}</p>`;
      const keys = f === 'Pilihan Lebih dari Satu' ? (q.correctIndices || []) : [q.correctIndex];
      return `<ul class="di-opts">${(q.options || []).map((o, i) => `<li class="${keys.includes(i) ? 'is-key' : ''}"><span class="di-k">${LETTERS[i]}</span><span class="rt-content">${RichText.render(o)}</span>${keys.includes(i) ? `<span class="di-key">${IC.check} kunci</span>` : ''}</li>`).join('')}</ul>`;
    }
    function cardHtml(d) {
      const q = d.q || d.partial || {};
      const ok = ready(d);
      return `<li class="di-item ${ok ? 'is-ok' : 'is-warn'}">
        <div class="di-item-head">
          <label class="di-sel"><input type="checkbox" data-di-sel="${d.uid}" ${d.selected ? 'checked' : ''} ${d.q && !d.guessed ? '' : 'disabled'} aria-label="Pilih soal ${d.num || ''}"/></label>
          <span class="di-num">${d.num != null ? esc(d.num) : '•'}</span>
          <span class="di-badge">${esc(q.questionType || '—')}</span>
          <span class="di-badge is-soft">${esc((DB.subtestByName(q.subject) || {}).short || q.subject || 'Subtest?')}</span>
          <span class="di-badge is-soft">${esc(q.difficulty || 'sedang')}</span>
          <span class="di-src">${d.source === 'ai' ? 'dibaca AI' : 'pola penomoran'}</span>
          <span class="di-status">${ok ? `${IC.check} Siap` : `${IC.warn} Perlu dicek`}</span>
          <span class="di-acts"><button type="button" class="btn btn-sm btn-secondary" data-di-edit="${d.uid}">${IC.edit} ${ok ? 'Edit' : 'Periksa'}</button>
            <button type="button" class="icon-btn" data-di-del="${d.uid}" aria-label="Buang soal ${d.num || ''}">${IC.trash}</button></span>
        </div>
        ${d.issues.length ? `<ul class="di-issues">${d.issues.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <div class="di-q rt-content">${RichText.render(q.text || '')}</div>
        ${d.q ? previewOf(d.q) : (q.options && q.options.some(o => plainOf(o)) ? `<ul class="di-opts">${q.options.map((o, i) => `<li><span class="di-k">${LETTERS[i]}</span><span class="rt-content">${RichText.render(o)}</span></li>`).join('')}</ul>` : '')}
        ${q.explanation && plainOf(q.explanation) ? `<details class="di-expl"><summary>Pembahasan</summary><div class="rt-content">${RichText.render(q.explanation)}</div></details>` : ''}
      </li>`;
    }

    function editDraft(d) {
      if (!d || !global.QEditor) return;
      const base = d.q || d.partial || {};
      QEditor.open(user, null, (payload) => {
        if (!payload) return;
        delete payload.id; delete payload.sourceId;
        if (base._topic && !payload.topicId) { payload._topic = base._topic; if (base._subtopic) payload._subtopic = base._subtopic; }
        d.q = payload; d.partial = null; d.issues = []; d.guessed = false; d.selected = true;
        paintMain();
        UI.toast(`Soal ${d.num || ''} siap disimpan.`, 'success');
      }, { detached: true, question: base, subtest: base.subject || st.defaults.subtest, showPoints: true,
        heading: `Periksa soal ${d.num || ''}`, where: 'Soal dari dokumen — masuk Bank Soal setelah Anda menekan Simpan di halaman impor' });
    }

    function save() {
      const list = st.drafts.filter(d => d.selected && d.q && !d.guessed);
      if (!list.length) return;
      let n = 0;
      list.forEach(d => {
        let q = JSON.parse(JSON.stringify(d.q));
        if (global.Topics && (q._topic || q._subtopic)) q = Topics.applyImportNames(q, user);
        delete q._topic; delete q._subtopic; delete q.id;
        DB.addQuestion(Object.assign({ authorId: user.id, source: 'impor-dokumen' }, q));
        n++;
      });
      st.drafts = st.drafts.filter(d => !list.includes(d));
      UI.toast(`${n} soal tersimpan ke Bank Soal.`, 'success');
      if (st.drafts.length) { paintMain(); if (typeof onDone === 'function') onDone(n); }
      else finishAll(n);
    }

    shell();
    setTimeout(() => { const d = ws && ws.querySelector('#diDrop'); if (d) d.focus(); }, 30);
  }

  global.DocImport = { open, close, readFile, htmlToLines, textToLines, parseLines, patternDraft, aiDraft, aiPrompt, chunksOf };
})(window);
