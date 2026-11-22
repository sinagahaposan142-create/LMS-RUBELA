/* ===== LMS Rubela - Alat Bank Soal =====
 * Tiga alat untuk mempercepat pengelolaan Bank Soal pusat:
 *
 *  1. Buat Soal Massal — satu baris satu soal, atau tempel langsung dari
 *     Excel/Google Sheets, sehingga tidak perlu membuka halaman editor
 *     berulang kali untuk setiap soal.
 *  2. Ekspor — unduh seluruh (atau sebagian) bank soal ke Excel (.xlsx)
 *     maupun CSV, lengkap dengan kunci jawaban dan pembahasan.
 *  3. Impor — unggah Excel/CSV dengan format yang sama untuk menambah soal
 *     dalam jumlah besar, disertai pratinjau dan laporan baris bermasalah.
 *
 * Format kolom (sama untuk ekspor, impor, dan tempel):
 *   Subtest | Format | Tingkat | Materi | Sub Materi | Pertanyaan | A–H | Kolom | Kunci | Pembahasan | Poin
 * Materi & Sub Materi bersifat opsional; nama yang belum ada dibuat otomatis
 * saat soal disimpan (js/topics.js).
 * Kunci: huruf (A/B/C…) untuk pilihan ganda, beberapa huruf dipisah koma
 * untuk pilihan lebih dari satu, "Benar"/"Salah" untuk benar-salah, dan teks
 * jawaban untuk isian singkat. Menjodohkan: kolom A–H berisi "kiri = kanan".
 * Urutan: kolom A–H berisi langkah; Kunci kosong berarti urutan kolom sudah
 * benar, atau tulis urutan huruf yang benar (mis. "C, A, B").
 * Impor dari PDF/Word (dibantu AI) ada di js/doc-import.js.
 */
(function (global) {

  /* Kolom F–H dipakai bila soal Majemuk berisi lebih dari 5 pernyataan.
   * "Kolom" = nama kolom jawaban Majemuk Kompleks, dipisah | (mis. Benar | Salah | Tidak diketahui). */
  const COLS = ['Subtest', 'Format', 'Tingkat', 'Materi', 'Sub Materi', 'Pertanyaan', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Kolom', 'Kunci', 'Pembahasan', 'Poin', 'Judul Teks', 'Teks Bacaan'];
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  function esc(s) { return UI.esc(s); }

  /* =====================================================================
   * Konversi baris <-> soal
   * ===================================================================*/
  /** Cocokkan nama subtest secara longgar (kode, singkatan, atau nama penuh). */
  function resolveSubtest(raw, fallback) {
    const v = String(raw || '').trim();
    if (!v) return fallback;
    const hit = DB.SUBTESTS.find(s =>
      s.name.toLowerCase() === v.toLowerCase() ||
      s.short.toLowerCase() === v.toLowerCase() ||
      s.code.toLowerCase() === v.toLowerCase());
    return hit ? hit.name : v;      // subtest di luar 7 UTBK tetap diterima
  }

  function resolveFormat(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return 'Pilihan Ganda';
    const all = (global.QEditor && QEditor.FORMATS) ? QEditor.FORMATS.map(f => f.key) : DB.QUESTION_TYPES;
    const hit = all.find(f => f.toLowerCase() === v);
    if (hit) return hit;
    if (/ganda\s*kompleks|lebih dari satu|multi/.test(v)) return 'Pilihan Lebih dari Satu';
    if (/(benar.{0,3}salah|b\/s).*(majemuk|ganda|banyak)|majemuk.*(benar|b\/s)/.test(v)) return 'Benar/Salah Majemuk';
    if (/majemuk|matriks|matrix|tabel/.test(v)) return 'Majemuk Kompleks';
    if (/benar|salah|b\/s/.test(v)) return 'Benar/Salah';
    if (/isian|singkat|short/.test(v)) return 'Isian Singkat';
    if (/esai|essay|uraian/.test(v)) return 'Esai';
    if (/jodoh|pasang|match/.test(v)) return 'Menjodohkan';
    if (/urut|order|sequence/.test(v)) return 'Urutan';
    return 'Pilihan Ganda';
  }

  function resolveDifficulty(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return DB.DIFFICULTIES.includes(v) ? v : 'sedang';
  }

  /** Ubah satu baris tabel menjadi payload soal, atau { error }. */
  function rowToQuestion(row, defaults) {
    const d = defaults || {};
    const text = String(row.Pertanyaan == null ? '' : row.Pertanyaan).trim();
    if (!text) return { error: 'Kolom Pertanyaan kosong' };

    const format = resolveFormat(row.Format);
    const subject = resolveSubtest(row.Subtest, d.subtest || DB.SUBTESTS[0].name);
    const difficulty = resolveDifficulty(row.Tingkat);
    const keyRaw = String(row.Kunci == null ? '' : row.Kunci).trim();
    const explanation = String(row.Pembahasan == null ? '' : row.Pembahasan).trim();

    const base = {
      subject,
      questionType: format,
      difficulty,
      text: wrapParagraph(text),
      explanation: explanation ? wrapParagraph(explanation) : '',
      options: []
    };
    // Materi & Sub Materi: nama disimpan sementara, diubah ke id saat soal disimpan.
    const tName = String(row.Materi == null ? (d.topic || '') : row.Materi).replace(/\s+/g, ' ').trim().slice(0, 80);
    const sName = String(row['Sub Materi'] == null ? (row.Materi == null ? (d.subtopic || '') : '') : row['Sub Materi']).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (tName) { base._topic = tName; if (sName) base._subtopic = sName; }
    // Teks bacaan (opsional): baris dengan isi teks yang sama memakai satu teks bersama.
    const psgText = String(row['Teks Bacaan'] == null ? (row.Bacaan == null ? '' : row.Bacaan) : row['Teks Bacaan']).trim();
    if (psgText) base._passage = { title: String(row['Judul Teks'] == null ? (row['Judul Teks Bacaan'] || '') : row['Judul Teks']).trim().slice(0, 120), html: wrapParagraph(psgText) };
    else if (d.passage && d.passage.html) base._passage = d.passage;
    // Kolom "Poin" opsional (sistem Poin Manual). Kosong → poin bawaan 1.
    const ptsRaw = row.Poin == null ? '' : String(row.Poin).trim().replace(',', '.');
    if (ptsRaw !== '') {
      const pv = Number(ptsRaw);
      if (!Number.isFinite(pv) || pv < 0 || pv > 10000) return { error: 'Kolom Poin harus angka 0–10000' };
      base.points = pv;
    }

    if (format === 'Esai') {
      base.correctIndex = null;
      base.keywords = keyRaw ? keyRaw.split(/[,;|]/).map(x => x.trim()).filter(Boolean) : [];
      return { question: base };
    }

    if (format === 'Isian Singkat') {
      if (!keyRaw) return { error: 'Isian Singkat membutuhkan jawaban di kolom Kunci' };
      base.answers = keyRaw.split(/[,;|]/).map(x => x.trim()).filter(Boolean);
      base.numeric = base.answers.every(a => a !== '' && !isNaN(Number(a.replace(',', '.'))));
      base.correctIndex = null;
      return { question: base };
    }

    if (format === 'Benar/Salah Majemuk' || format === 'Majemuk Kompleks') {
      const stmts = LETTERS.map(L => String(row[L] == null ? '' : row[L]).trim()).filter(Boolean);
      if (stmts.length < 2) return { error: 'Majemuk membutuhkan minimal 2 pernyataan (kolom A, B, …)' };
      const keys = splitKeys(keyRaw);
      if (keys.length !== stmts.length) return { error: `Kunci harus berisi ${stmts.length} jawaban (satu per pernyataan), dipisah titik koma` };
      if (format === 'Benar/Salah Majemuk') {
        const vals = keys.map(k => /^(b|benar|true|1|ya)$/i.test(k) ? true : (/^(s|salah|false|0|tidak)$/i.test(k) ? false : null));
        if (vals.some(v => v == null)) return { error: 'Kunci Benar/Salah Majemuk hanya boleh "Benar" atau "Salah", mis. "Benar; Salah; Benar"' };
        base.statements = stmts.map((t, i) => ({ text: wrapParagraph(t), value: vals[i] }));
        base.correctIndex = null;
        return { question: base };
      }
      const colRaw = String(row.Kolom == null ? '' : row.Kolom).trim();
      const cols = colRaw ? colRaw.split(/\s*[|;]\s*/).map(x => x.trim()).filter(Boolean) : DB.MATRIX_DEFAULT_COLS.slice();
      if (cols.length < 2) return { error: 'Kolom jawaban minimal 2, dipisah tanda | (mis. "Benar | Salah | Tidak diketahui")' };
      if (cols.length > DB.MATRIX_MAX_COLS) return { error: `Kolom jawaban maksimal ${DB.MATRIX_MAX_COLS}` };
      if (new Set(cols.map(c => c.toLowerCase())).size !== cols.length) return { error: 'Nama kolom jawaban tidak boleh sama' };
      const idx = keys.map(k => {
        const byName = cols.findIndex(c => c.toLowerCase() === k.toLowerCase());
        if (byName >= 0) return byName;
        if (/^b$/i.test(k) && cols[0].toLowerCase() === 'benar') return 0;
        if (/^s$/i.test(k) && cols[1].toLowerCase() === 'salah') return 1;
        const n = Number(k);
        return Number.isInteger(n) && n >= 1 && n <= cols.length ? n - 1 : -1;
      });
      const bad = idx.findIndex(i => i < 0);
      if (bad >= 0) return { error: `Kunci pernyataan ${bad + 1} ("${keys[bad]}") tidak cocok dengan nama kolom` };
      base.columns = cols.map(c => c.replace(/[<>]/g, '').slice(0, 40));
      base.statements = stmts.map((t, i) => ({ text: wrapParagraph(t), correct: idx[i] }));
      base.correctIndex = null;
      return { question: base };
    }

    if (format === 'Menjodohkan') {
      // Kolom A–H: "kiri = kanan" (juga => -> → atau |), satu pasangan benar per kolom.
      const cells = LETTERS.map(L => String(row[L] == null ? '' : row[L]).trim()).filter(Boolean);
      const pairs = cells.map(c => { const m = /^(.+?)\s*(?:=>|->|→|=|\|)\s*(.+)$/.exec(c); return m ? { left: wrapParagraph(m[1]), right: wrapParagraph(m[2]) } : null; });
      if (pairs.length < 2 || pairs.some(p => !p)) return { error: 'Menjodohkan: isi kolom A, B, … dengan "kiri = kanan" (minimal 2 pasangan)' };
      if (new Set(pairs.map(p => RichText.plain(p.right).toLowerCase())).size !== pairs.length) return { error: 'Menjodohkan: jawaban kanan tidak boleh sama' };
      base.pairs = pairs;
      base.correctIndex = null;
      return { question: base };
    }

    if (format === 'Urutan') {
      // Kolom A–H berisi langkah. Kunci opsional = urutan huruf yang benar (mis. "C, A, B"); kosong = sudah urut.
      let items = LETTERS.map(L => String(row[L] == null ? '' : row[L]).trim()).filter(Boolean);
      if (items.length < 2) return { error: 'Urutan: isi minimal 2 langkah di kolom A, B, …' };
      if (keyRaw) {
        const order = keyRaw.split(/[,;|/\s]+/).filter(Boolean).map(k => LETTERS.indexOf(k.toUpperCase()));
        if (order.length !== items.length || order.some(i => i < 0 || i >= items.length) || new Set(order).size !== order.length) {
          return { error: `Kunci Urutan harus memuat ${items.length} huruf berbeda, mis. "${LETTERS.slice(0, items.length).reverse().join(', ')}"` };
        }
        items = order.map(i => items[i]);
      }
      base.orderItems = items.map(wrapParagraph);
      base.correctIndex = null;
      return { question: base };
    }

    if (format === 'Benar/Salah') {
      base.options = ['Benar', 'Salah'];
      const k = keyRaw.toLowerCase();
      if (/^(b|benar|true|1|a)$/.test(k)) base.correctIndex = 0;
      else if (/^(s|salah|false|0)$/.test(k)) base.correctIndex = 1;
      else return { error: 'Kunci Benar/Salah harus "Benar" atau "Salah"' };
      return { question: base };
    }

    // Format berbasis pilihan
    const opts = LETTERS.map(L => String(row[L] == null ? '' : row[L]).trim()).filter(Boolean);
    if (opts.length < 2) return { error: 'Minimal dua pilihan jawaban (kolom A dan B)' };
    base.options = opts.map(wrapParagraph);

    const letterToIndex = (t) => {
      const s = String(t).trim().toUpperCase();
      if (/^[A-H]$/.test(s)) return LETTERS.indexOf(s);
      const n = Number(s);
      return isNaN(n) ? -1 : n - 1;         // dukung "1" = A
    };

    if (format === 'Pilihan Lebih dari Satu') {
      const picks = keyRaw.split(/[,;|/ ]+/).map(letterToIndex).filter(i => i >= 0 && i < opts.length);
      if (!picks.length) return { error: 'Kunci harus berisi huruf pilihan, mis. "A,C"' };
      base.correctIndices = [...new Set(picks)].sort((a, b) => a - b);
      base.correctIndex = base.correctIndices[0];
      return { question: base };
    }

    const idx = letterToIndex(keyRaw);
    if (idx < 0 || idx >= opts.length) {
      return { error: `Kunci "${keyRaw || '(kosong)'}" tidak menunjuk pilihan yang ada` };
    }
    base.correctIndex = idx;
    return { question: base };
  }

  /** Kunci per pernyataan: "Benar; Salah; Benar" (titik koma/|), atau dipisah koma bila tanpa titik koma. */
  function splitKeys(raw) {
    const t = String(raw || '').trim();
    if (!t) return [];
    return (/[;|]/.test(t) ? t.split(/\s*[;|]\s*/) : t.split(/\s*,\s*/)).map(x => x.trim()).filter(Boolean);
  }

  /** Teks datar dari Excel dibungkus paragraf agar konsisten dengan editor. */
  function wrapParagraph(t) {
    const s = String(t == null ? '' : t).trim();
    if (!s) return '';
    if (/^\s*</.test(s)) return RichText.sanitize(s);   // sudah HTML
    return '<p>' + RichText.sanitize(s).replace(/\n+/g, '<br>') + '</p>';
  }

  /** Ubah satu soal menjadi baris tabel untuk ekspor. */
  function questionToRow(q) {
    const row = {};
    const fmt = q.questionType || 'Pilihan Ganda';
    row.Subtest = q.subject || '';
    row.Format = fmt;
    row.Tingkat = q.difficulty || 'sedang';
    const tl = global.Topics ? Topics.labelOf(q) : null;
    row.Materi = tl ? tl.topic : '';
    row['Sub Materi'] = tl ? tl.sub : '';
    row.Pertanyaan = RichText.plain(q.text, 4000);
    const isMx = fmt === 'Majemuk Kompleks' || fmt === 'Benar/Salah Majemuk';
    const src = isMx ? (q.statements || []).map(x => x && x.text)
      : fmt === 'Menjodohkan' ? (q.pairs || []).map(p => p && (RichText.plain(p.left, 400) + ' = ' + RichText.plain(p.right, 400)))
      : fmt === 'Urutan' ? (q.orderItems || []) : (q.options || []);
    LETTERS.forEach((L, i) => {
      row[L] = src[i] ? RichText.plain(src[i], 800) : '';
    });
    row.Kolom = fmt === 'Majemuk Kompleks' ? DB.qMatrixColumns(q).join(' | ') : '';
    if (isMx) row.Kunci = DB.qKeyText(q);
    else if (fmt === 'Menjodohkan' || fmt === 'Urutan') row.Kunci = '';
    else if (fmt === 'Esai') row.Kunci = (q.keywords || []).join(', ');
    else if (fmt === 'Isian Singkat') row.Kunci = (q.answers || []).join(', ');
    else if (fmt === 'Benar/Salah') row.Kunci = q.correctIndex === 0 ? 'Benar' : 'Salah';
    else if (fmt === 'Pilihan Lebih dari Satu') row.Kunci = (q.correctIndices || []).map(i => LETTERS[i]).join(', ');
    else row.Kunci = LETTERS[q.correctIndex] || '';
    row.Pembahasan = RichText.plain(q.explanation || '', 2000);
    row.Poin = q.points != null ? q.points : '';
    const ps = global.Passages ? Passages.of(q) : null;
    row['Judul Teks'] = ps ? ps.title || '' : '';
    row['Teks Bacaan'] = ps ? RichText.plain(ps.html, 30000) : '';
    return row;
  }

  /* =====================================================================
   * Simpan hasil impor / buat massal
   * ===================================================================*/
  /**
   * Simpan daftar soal (hasil rowToQuestion). Teks bacaan `_passage` dibuat
   * sekali (atau memakai teks yang isinya sama di Bank Soal) lalu ditautkan.
   */
  function saveQuestions(list, user, source) {
    const cache = new Map();
    const key = (h) => RichText.plain(h || '', 20000).toLowerCase().replace(/\s+/g, ' ').trim();
    let n = 0;
    list.forEach(q0 => {
      let q = JSON.parse(JSON.stringify(q0));
      if (global.Topics && (q._topic || q._subtopic)) q = Topics.applyImportNames(q, user);
      const ps = q._passage;
      ['_passage', '_topic', '_subtopic', '_num', '_dup', 'id'].forEach(k => delete q[k]);
      if (ps && ps.html) {
        const k = key(ps.html) + '|' + (q.subject || '');
        if (!cache.has(k)) { const p = DB.findOrCreatePassage({ title: ps.title, html: ps.html, subject: q.subject, source }, user.id); cache.set(k, p ? p.id : null); }
        if (cache.get(k)) q.passageId = cache.get(k);
      }
      DB.addQuestion(Object.assign({ authorId: user.id, source }, q));
      n++;
    });
    return n;
  }
  /** Tandai baris yang sama/mirip dengan Bank Soal atau dengan baris lain di berkas yang sama. */
  function markDuplicates(parsed) {
    if (!global.Duplicates) return 0;
    const check = Duplicates.importChecker();
    let n = 0;
    parsed.forEach(p => {
      if (!p.question) return;
      p.question._num = p.line;
      p.dup = check(p.question);
      if (p.dup) n++;
    });
    return n;
  }
  const dupText = (d) => (!d ? '' : d.where === 'bank' ? `${d.sim === 1 ? 'Sama' : 'Mirip'} dengan soal di Bank Soal` : `Sama dengan baris ${d.num}`);
  const dupOptionHtml = (n) => (n ? `<label class="check-row small" style="margin-top:8px;"><input type="checkbox" id="bkKeepDup" /> Tetap simpan ${n} soal yang terdeteksi ganda</label>` : '');

  /* =====================================================================
   * 1. EKSPOR
   * ===================================================================*/
  function exportQuestions(list, format) {
    const rows = (list || DB.getQuestions()).map(questionToRow);
    if (!rows.length) { UI.toast('Tidak ada soal untuk diekspor.', 'info'); return; }
    const stamp = UI.todayYMD();

    if (format === 'csv') {
      const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const lines = [COLS.join(';')].concat(rows.map(r => COLS.map(c => cell(r[c])).join(';')));
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `bank_soal_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      UI.toast(`${rows.length} soal diekspor ke CSV.`, 'success');
      return;
    }

    if (typeof XLSX === 'undefined') {
      UI.toast('Library Excel belum termuat. Coba muat ulang halaman atau pakai CSV.', 'error');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows, { header: COLS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bank Soal');
    XLSX.writeFile(wb, `bank_soal_${stamp}.xlsx`);
    UI.toast(`${rows.length} soal diekspor ke Excel.`, 'success');
  }

  /** Unduh berkas contoh agar pengguna tahu format kolomnya. */
  function downloadTemplate() {
    const sample = [
      { Subtest: 'Pengetahuan Kuantitatif (PK)', Format: 'Pilihan Ganda', Tingkat: 'mudah', Materi: 'Bilangan', 'Sub Materi': 'Operasi bilangan',
        Pertanyaan: 'Hasil dari 12 + 8 adalah ...', A: '18', B: '20', C: '22', D: '24', E: '',
        Kunci: 'B', Pembahasan: '12 + 8 = 20.', Poin: 4 },
      { Subtest: 'PU', Format: 'Pilihan Lebih dari Satu', Tingkat: 'sedang', Materi: 'Logika Umum', 'Sub Materi': 'Logika dasar',
        Pertanyaan: 'Manakah bilangan prima?', A: '2', B: '3', C: '4', D: '9', E: '',
        Kunci: 'A, B', Pembahasan: '2 dan 3 adalah bilangan prima.' },
      { Subtest: 'PK', Format: 'Isian Singkat', Tingkat: 'mudah',
        Pertanyaan: 'Berapa hasil 7 x 8?', A: '', B: '', C: '', D: '', E: '',
        Kunci: '56', Pembahasan: '' },
      { Subtest: 'PPU', Format: 'Benar/Salah', Tingkat: 'mudah',
        Pertanyaan: 'Jakarta adalah ibu kota Indonesia.', A: '', B: '', C: '', D: '', E: '',
        Kunci: 'Benar', Pembahasan: '' },
      { Subtest: 'PPU', Format: 'Benar/Salah Majemuk', Tingkat: 'sedang',
        Pertanyaan: 'Tentukan benar atau salah setiap pernyataan berikut.', A: 'Air mendidih pada 100 °C di permukaan laut.',
        B: 'Matahari mengelilingi Bumi.', C: 'Indonesia memiliki lebih dari 17.000 pulau.', D: '', E: '',
        Kunci: 'Benar; Salah; Benar', Pembahasan: '' },
      { Subtest: 'PBM', Format: 'Majemuk Kompleks', Tingkat: 'sulit',
        Pertanyaan: 'Berdasarkan teks, tentukan status setiap pernyataan.', A: 'Penulis setuju dengan kebijakan tersebut.',
        B: 'Kebijakan berlaku mulai tahun depan.', C: 'Semua siswa menolak kebijakan.', D: '', E: '',
        Kolom: 'Benar | Salah | Tidak dapat ditentukan', Kunci: 'Benar; Tidak dapat ditentukan; Salah', Pembahasan: '' },
      { Subtest: 'PPU', Format: 'Menjodohkan', Tingkat: 'sedang',
        Pertanyaan: 'Pasangkan provinsi dengan ibu kotanya.', A: 'Jawa Barat = Bandung', B: 'Jawa Tengah = Semarang', C: 'Jawa Timur = Surabaya', D: '', E: '',
        Kunci: '', Pembahasan: '' },
      { Subtest: 'PBM', Format: 'Urutan', Tingkat: 'sedang',
        Pertanyaan: 'Urutkan langkah menulis paragraf.', A: 'Menentukan topik', B: 'Menyusun kerangka', C: 'Mengembangkan kalimat', D: '', E: '',
        Kunci: '', Pembahasan: 'Kunci kosong berarti urutan kolom A, B, C sudah benar.' },
      { Subtest: 'LBIND', Format: 'Pilihan Ganda', Tingkat: 'sedang', 'Judul Teks': 'Teks 1 — Hutan Mangrove',
        'Teks Bacaan': 'Hutan mangrove menahan abrasi dan menjadi tempat berkembang biak ikan. Luasnya terus berkurang karena alih fungsi lahan.',
        Pertanyaan: 'Gagasan utama teks tersebut adalah …', A: 'Manfaat dan ancaman hutan mangrove', B: 'Cara menanam mangrove', C: 'Jenis ikan di pesisir', D: 'Penyebab abrasi', E: '',
        Kunci: 'A', Pembahasan: 'Teks membahas manfaat mangrove lalu ancamannya.' },
      { Subtest: 'LBIND', Format: 'Benar/Salah', Tingkat: 'mudah', 'Judul Teks': 'Teks 1 — Hutan Mangrove',
        'Teks Bacaan': 'Hutan mangrove menahan abrasi dan menjadi tempat berkembang biak ikan. Luasnya terus berkurang karena alih fungsi lahan.',
        Pertanyaan: 'Menurut teks, luas hutan mangrove terus bertambah.', A: '', B: '', C: '', D: '', E: '',
        Kunci: 'Salah', Pembahasan: 'Baris dengan Teks Bacaan yang sama memakai satu teks bersama.' },
      { Subtest: 'LBIND', Format: 'Esai', Tingkat: 'sulit',
        Pertanyaan: 'Jelaskan ciri kalimat efektif.', A: '', B: '', C: '', D: '', E: '',
        Kunci: 'kesatuan, kehematan, kepaduan', Pembahasan: 'Kata kunci penilaian.' }
    ];
    if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
    const ws = XLSX.utils.json_to_sheet(sample, { header: COLS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contoh');
    XLSX.writeFile(wb, 'contoh_impor_bank_soal.xlsx');
    UI.toast('Berkas contoh diunduh. Isi sesuai kolomnya lalu impor kembali.', 'success');
  }

  /* =====================================================================
   * 2. IMPOR (Excel / CSV)
   * ===================================================================*/
  function openImport(user, onDone, defaults) {
    let parsed = [];      // [{row, question|error}]

    Editor.openSubDialog('Impor Soal dari Excel / CSV', `
      <p class="muted small" style="margin-top:0;">
        Kolom yang dibaca: <code>${COLS.join('</code>, <code>')}</code>.
        Nama subtest boleh ditulis singkat (<code>PK</code>) maupun lengkap.
      </p>
      <div class="flex-gap mb-2">
        <button type="button" class="btn btn-sm btn-secondary" id="bkTpl">⬇ Unduh Berkas Contoh</button>
      </div>
      <div class="form-group">
        <label for="bkFile">Pilih berkas Excel (.xlsx) atau CSV</label>
        <input type="file" id="bkFile" accept=".xlsx,.xls,.csv" />
      </div>
      <div id="bkReport"></div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok disabled>Impor Soal</button>
      </div>
    `, (back, close) => {
      const report = back.querySelector('#bkReport');
      const okBtn = back.querySelector('[data-ok]');

      back.querySelector('#bkTpl').addEventListener('click', downloadTemplate);
      back.querySelector('[data-cancel]').addEventListener('click', close);

      back.querySelector('#bkFile').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        report.innerHTML = '<span class="spinner"></span> Membaca berkas…';
        const reader = new FileReader();
        reader.onerror = () => { report.innerHTML = '<div class="alert alert-error">Gagal membaca berkas.</div>'; };
        reader.onload = (evt) => {
          try {
            let rows;
            if (/\.csv$/i.test(file.name)) {
              rows = parseCsv(String(evt.target.result));
            } else {
              if (typeof XLSX === 'undefined') throw new Error('Library Excel belum termuat.');
              const wb = XLSX.read(evt.target.result, { type: 'array' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            }
            parsed = rows.map((r, i) => {
              const res = rowToQuestion(r, defaults);
              return { line: i + 2, row: r, question: res.question, error: res.error };
            });
            markDuplicates(parsed);
            renderReport();
          } catch (err) {
            report.innerHTML = `<div class="alert alert-error">${esc(err.message || 'Berkas tidak dapat dibaca.')}</div>`;
          }
        };
        if (/\.csv$/i.test(file.name)) reader.readAsText(file, 'utf-8');
        else reader.readAsArrayBuffer(file);
      });

      function renderReport() {
        const good = parsed.filter(p => p.question);
        const bad = parsed.filter(p => p.error);
        const dups = good.filter(p => p.dup);
        const psgN = new Set(good.filter(p => p.question._passage).map(p => RichText.plain(p.question._passage.html, 400))).size;
        okBtn.disabled = good.length === 0;
        report.innerHTML = `
          <div class="alert ${bad.length ? 'alert-error' : 'alert-info'}">
            <strong>${good.length} soal siap diimpor</strong>${bad.length ? ` • ${bad.length} baris dilewati` : ''}${dups.length ? ` • ${dups.length} terdeteksi ganda (tidak disimpan kecuali dicentang)` : ''}${psgN ? ` • ${psgN} teks bacaan` : ''}
          </div>${dupOptionHtml(dups.length)}
          ${bad.length ? `
            <div class="table-wrap" style="max-height:200px;overflow:auto;">
              <table class="table"><thead><tr><th>Baris</th><th>Masalah</th><th>Pertanyaan</th></tr></thead>
              <tbody>${bad.slice(0, 40).map(b => `<tr>
                <td>${b.line}</td><td style="color:var(--danger);">${esc(b.error)}</td>
                <td class="muted small">${esc(String(b.row.Pertanyaan || '').slice(0, 60))}</td>
              </tr>`).join('')}</tbody></table>
            </div>` : ''}
          ${good.length ? `
            <div class="table-wrap mt-1" style="max-height:220px;overflow:auto;">
              <table class="table"><thead><tr><th>#</th><th>Subtest</th><th>Materi</th><th>Format</th><th>Pertanyaan</th><th>Kunci</th><th>Catatan</th></tr></thead>
              <tbody>${good.slice(0, 40).map((g, i) => `<tr>
                <td>${i + 1}</td>
                <td class="muted small">${esc(g.question.subject)}</td>
                <td class="muted small">${esc(g.question._topic ? g.question._topic + (g.question._subtopic ? ' › ' + g.question._subtopic : '') : '-')}</td>
                <td class="muted small">${esc(g.question.questionType)}</td>
                <td>${g.question._passage ? '📖 ' : ''}${esc(RichText.plain(g.question.text, 70))}</td>
                <td>${esc(keyLabel(g.question))}</td>
                <td class="small" style="color:${g.dup ? 'var(--warning)' : 'var(--success)'};">${esc(g.dup ? dupText(g.dup) : 'OK')}</td>
              </tr>`).join('')}</tbody></table>
              ${good.length > 40 ? `<p class="muted small">…dan ${good.length - 40} soal lainnya.</p>` : ''}
            </div>` : ''}`;
      }

      okBtn.addEventListener('click', () => {
        const keepDup = !!(back.querySelector('#bkKeepDup') || {}).checked;
        const good = parsed.filter(p => p.question && (keepDup || !p.dup));
        if (!good.length) { UI.toast('Semua soal terdeteksi ganda. Centang "Tetap simpan" bila memang ingin menyimpannya.', 'info'); return; }
        const added = saveQuestions(good.map(g => g.question), user, 'impor');
        close();
        UI.toast(`${added} soal berhasil diimpor ke Bank Soal.`, 'success');
        if (typeof onDone === 'function') onDone(added);
      });
    });
  }

  function keyLabel(q) {
    const fmt = q.questionType || 'Pilihan Ganda';
    if (fmt === 'Esai') return (q.keywords || []).join(', ') || '(manual)';
    if (fmt === 'Isian Singkat') return (q.answers || []).join(', ');
    if (fmt === 'Benar/Salah') return q.correctIndex === 0 ? 'Benar' : 'Salah';
    if (fmt === 'Pilihan Lebih dari Satu') return (q.correctIndices || []).map(i => LETTERS[i]).join(', ');
    if (fmt === 'Majemuk Kompleks' || fmt === 'Benar/Salah Majemuk' || fmt === 'Menjodohkan' || fmt === 'Urutan') return DB.qKeyText(q);
    return LETTERS[q.correctIndex] || '-';
  }

  /** Pembaca CSV sederhana yang menghormati tanda kutip dan pemisah ; atau , */
  function parseCsv(text) {
    const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const firstLine = src.split('\n')[0] || '';
    const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    const rows = [];
    let cur = [''];
    let inQ = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
          else inQ = false;
        } else cur[cur.length - 1] += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) cur.push('');
      else if (ch === '\n') { rows.push(cur); cur = ['']; }
      else cur[cur.length - 1] += ch;
    }
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
    if (!rows.length) return [];
    const head = rows.shift().map(h => h.trim());
    return rows.filter(r => r.some(c => String(c).trim() !== '')).map(r => {
      const o = {};
      head.forEach((h, i) => { o[h] = r[i] == null ? '' : r[i]; });
      return o;
    });
  }

  /* =====================================================================
   * 3. BUAT SOAL MASSAL
   * ===================================================================*/
  function openBulk(user, onDone, defaults) {
    const d = defaults || {};
    const sub = d.subtest || DB.SUBTESTS[0].name;

    Editor.openSubDialog('Buat Soal Massal', `
      <p class="muted small" style="margin-top:0;">
        Tulis banyak soal sekaligus tanpa membuka editor satu per satu.
        Pilih salah satu cara di bawah, lalu tekan <strong>Periksa</strong> untuk melihat pratinjau.
      </p>

      <div class="form-row">
        <div class="form-group">
          <label for="bkSub">Subtest untuk semua soal</label>
          <select id="bkSub" class="input">
            ${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${s.name === sub ? 'selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="bkDiff">Tingkat kesulitan</label>
          <select id="bkDiff" class="input">
            ${DB.DIFFICULTIES.map(x => `<option value="${x}" ${x === 'sedang' ? 'selected' : ''}>${x.charAt(0).toUpperCase() + x.slice(1)}</option>`).join('')}
          </select>
        </div>
      </div>

      ${global.Topics ? `<div id="bkTopicBox">${Topics.pickerHtml('bkTp', { hint: 'Dipakai untuk semua soal, kecuali baris yang menulis kolom Materi sendiri.' })}</div>` : ''}

      <div class="subtabs" style="margin-bottom:12px;">
        <button type="button" class="subtab-btn active" data-bmode="baris">📝 Satu Baris Satu Soal</button>
        <button type="button" class="subtab-btn" data-bmode="tabel">📋 Tempel dari Excel</button>
        <button type="button" class="subtab-btn" data-bmode="ai">🤖 Buat dengan AI</button>
        ${global.DocImport ? '<button type="button" class="subtab-btn" id="bkDocImport" title="Baca soal & teks bacaan dari PDF / Word">📄 Impor PDF / Word</button>' : ''}
      </div>

      <div id="bkPanel"></div>

      <div id="bkPreview"></div>
      <div class="flex-gap mt-2" style="justify-content:space-between;">
        <button type="button" class="btn btn-secondary btn-sm" id="bkCheck">🔍 Periksa</button>
        <div class="flex-gap">
          <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
          <button type="button" class="btn btn-primary" data-ok disabled>Simpan Semua</button>
        </div>
      </div>
    `, (back, close) => {
      let mode = 'baris';
      let parsed = [];
      let aiRows = [];     // hasil generate AI, menunggu diperiksa
      const panel = back.querySelector('#bkPanel');
      const tpBox = back.querySelector('#bkTopicBox');
      const topicPick = tpBox ? Topics.bindPicker(tpBox, { user, subtest: sub, value: {} }) : null;
      const subSel = back.querySelector('#bkSub');
      if (topicPick) subSel.addEventListener('change', () => topicPick.setSubtest(subSel.value));
      /** Nama materi/sub materi terpilih di dialog (dipakai sebagai bawaan baris). */
      const pickedNames = () => {
        const v = topicPick ? topicPick.get() : {};
        const t = v.topicId && Topics.get(v.topicId);
        const s = v.subtopicId && Topics.get(v.subtopicId);
        return { topic: t ? t.name : '', subtopic: s ? s.name : '' };
      };
      const preview = back.querySelector('#bkPreview');
      const okBtn = back.querySelector('[data-ok]');

      function paintPanel() {
        if (mode === 'ai') {
          panel.innerHTML = `
            ${global.AI ? AI.noticeHtml(user) : ''}
            <div class="form-row">
              <div class="form-group">
                <label for="bkAiTopic">Topik / materi soal</label>
                <input id="bkAiTopic" placeholder="mis. barisan aritmetika, teks eksposisi, hukum Newton" />
              </div>
              <div class="form-group">
                <label for="bkAiCount">Jumlah soal</label>
                <input id="bkAiCount" type="number" min="1" max="20" value="5" />
              </div>
            </div>
            <div class="form-group">
              <label for="bkAiFormat">Format soal</label>
              <select id="bkAiFormat" class="input">
                <option value="Pilihan Ganda">Pilihan Ganda (satu jawaban benar)</option>
                <option value="Pilihan Lebih dari Satu">Pilihan Lebih dari Satu</option>
                <option value="Benar/Salah">Benar/Salah</option>
                <option value="Isian Singkat">Isian Singkat</option>
                <option value="Benar/Salah Majemuk">Benar/Salah Majemuk (beberapa pernyataan)</option>
                <option value="Majemuk Kompleks">Majemuk Kompleks (kolom: Benar / Salah / Tidak dapat ditentukan)</option>
              </select>
            </div>
            <div class="form-group">
              <label for="bkAiNote">Catatan tambahan (opsional)</label>
              <input id="bkAiNote" placeholder="mis. gunakan konteks sehari-hari, hindari angka desimal" />
            </div>
            <div class="flex-gap">
              <button type="button" class="btn btn-primary btn-sm" id="bkAiGen" ${(global.AI && AI.ready()) ? '' : 'disabled'}>🤖 Buat Soal dengan AI</button>
            </div>
            <div id="bkAiOut" style="margin-top:10px;"></div>
            <div class="muted small" style="margin-top:8px;">
              Soal hasil AI <strong>wajib Anda periksa</strong> sebelum disimpan — tekan
              <strong>Periksa</strong> untuk melihat pratinjau, lalu perbaiki bila ada yang kurang tepat.
            </div>`;

          const genBtn = panel.querySelector('#bkAiGen');
          if (genBtn) genBtn.addEventListener('click', async () => {
            const pn = pickedNames();
            const topic = panel.querySelector('#bkAiTopic').value.trim() || [pn.topic, pn.subtopic].filter(Boolean).join(' — ');
            const n = Math.max(1, Math.min(20, Number(panel.querySelector('#bkAiCount').value) || 5));
            const fmt = panel.querySelector('#bkAiFormat').value;
            const note = panel.querySelector('#bkAiNote').value.trim();
            const subtest = back.querySelector('#bkSub').value;
            const diff = back.querySelector('#bkDiff').value;
            const out = panel.querySelector('#bkAiOut');
            if (!topic) { UI.toast('Isi topik soal atau pilih materi terlebih dahulu.', 'error'); return; }

            genBtn.disabled = true;
            out.innerHTML = AI.loadingHtml(`AI menyusun ${n} soal…`);
            const shape = fmt === 'Benar/Salah Majemuk'
              ? '{"Pertanyaan":"instruksi + konteks","A":"pernyataan 1","B":"pernyataan 2","C":"pernyataan 3","D":"pernyataan 4","Kunci":"Benar; Salah; Benar; Salah","Pembahasan":"..."} (Kunci berisi satu jawaban per pernyataan, dipisah titik koma)'
              : fmt === 'Majemuk Kompleks'
              ? '{"Pertanyaan":"instruksi + konteks","Kolom":"Benar | Salah | Tidak dapat ditentukan","A":"pernyataan 1","B":"pernyataan 2","C":"pernyataan 3","Kunci":"Benar; Tidak dapat ditentukan; Salah","Pembahasan":"..."} (Kunci memakai nama kolom, satu per pernyataan, dipisah titik koma)'
              : fmt === 'Benar/Salah'
              ? '{"Pertanyaan":"...","Kunci":"Benar atau Salah","Pembahasan":"..."}'
              : (fmt === 'Isian Singkat'
                ? '{"Pertanyaan":"...","Kunci":"jawaban singkat","Pembahasan":"..."}'
                : '{"Pertanyaan":"...","A":"...","B":"...","C":"...","D":"...","Kunci":"' +
                  (fmt === 'Pilihan Lebih dari Satu' ? 'A,C' : 'B') + '","Pembahasan":"..."}');
            try {
              const data = await AI.askJson(
                `Buat ${n} soal latihan UTBK untuk subtest "${subtest}" dengan tingkat kesulitan ${diff}. ` +
                `Topik: ${topic}. Format soal: ${fmt}. ` +
                (note ? `Catatan: ${note}. ` : '') +
                'Tulis dalam Bahasa Indonesia yang baku dan pastikan kunci jawabannya benar secara ilmiah. ' +
                'Sertakan pembahasan singkat yang menjelaskan mengapa kunci itu benar. ' +
                `Balas HANYA berupa array JSON, setiap elemen berbentuk ${shape}`,
                { maxTokens: 4096 });
              const list = Array.isArray(data) ? data : AI.normalizeRows(data);
              aiRows = list.filter(r => r && r.Pertanyaan).map(r => Object.assign({}, r, {
                Subtest: subtest, Tingkat: diff, Format: fmt
              }));
              if (!aiRows.length) throw new Error('AI tidak menghasilkan soal yang bisa dibaca. Coba ulangi.');
              out.innerHTML = `<div class="alert alert-success">${aiRows.length} soal dibuat AI. Tekan <strong>Periksa</strong> di bawah untuk melihat pratinjau.</div>`;
            } catch (e) {
              aiRows = [];
              out.innerHTML = AI.errorHtml(e);
            } finally {
              genBtn.disabled = false;
            }
          });
        } else if (mode === 'baris') {
          panel.innerHTML = `
            <div class="form-group">
              <label for="bkLines">Daftar soal — satu soal per baris</label>
              <textarea id="bkLines" rows="11" placeholder="Pertanyaan | pilihan A | pilihan B | pilihan C | pilihan D | kunci
Hasil 12 + 8 | 18 | 20 | 22 | 24 | B
Manakah bilangan prima | 2 | 3 | 4 | 9 | A,C

TEKS: Teks 1 — Hutan Mangrove
Hutan mangrove menahan abrasi dan menjadi tempat berkembang biak ikan.
Gagasan utama teks tersebut adalah … | Manfaat mangrove | Cara menanam | Jenis ikan | Penyebab abrasi | A
Menurut teks, mangrove menahan abrasi | Benar
---"></textarea>
              <div class="muted small">
                Pemisah tanda <code>|</code>. Bagian terakhir adalah kunci: huruf pilihan
                (<code>B</code>), beberapa huruf untuk jawaban ganda (<code>A,C</code>),
                <code>Benar</code>/<code>Salah</code>, atau jawaban isian singkat bila tanpa pilihan.
                <br><strong>Teks bacaan:</strong> tulis <code>TEKS: Judul</code> lalu paragraf bacaannya (tanpa <code>|</code>).
                Soal-soal sesudahnya memakai teks itu sampai <code>TEKS:</code> berikutnya atau baris <code>---</code>.
              </div>
            </div>`;
        } else {
          panel.innerHTML = `
            <div class="form-group">
              <label for="bkPaste">Tempel langsung dari Excel / Google Sheets</label>
              <textarea id="bkPaste" rows="9" placeholder="Salin beberapa kolom dari Excel lalu tempel di sini (Ctrl+V).
Urutan kolom: Pertanyaan, A, B, C, D, Kunci, Pembahasan (opsional)"></textarea>
              <div class="muted small">
                Kolom dipisah tab — cukup salin sel dari Excel dan tempel. Bila baris pertama berisi judul kolom
                (mis. <code>Pertanyaan</code>, <code>A</code>, <code>Kunci</code>, <code>Teks Bacaan</code>, <code>Judul Teks</code>),
                kolom dibaca sesuai namanya — soal dengan isi <code>Teks Bacaan</code> yang sama memakai satu teks.
              </div>
            </div>`;
        }
        preview.innerHTML = '';
        okBtn.disabled = true;
        parsed = [];
        if (mode !== 'ai') aiRows = [];
      }

      const docBtn = back.querySelector('#bkDocImport');
      if (docBtn) docBtn.addEventListener('click', () => {
        const subject = back.querySelector('#bkSub').value;
        close();
        DocImport.open(user, onDone, { subtest: subject });
      });
      back.querySelectorAll('[data-bmode]').forEach(b => b.addEventListener('click', () => {
        back.querySelectorAll('[data-bmode]').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        mode = b.dataset.bmode;
        paintPanel();
      }));

      back.querySelector('#bkCheck').addEventListener('click', () => {
        const subject = back.querySelector('#bkSub').value;
        const difficulty = back.querySelector('#bkDiff').value;
        const rows = mode === 'ai'
          ? aiRows.slice()
          : (mode === 'baris'
            ? linesToRows(back.querySelector('#bkLines').value)
            : pastedToRows(back.querySelector('#bkPaste').value));

        const pn = pickedNames();
        parsed = rows.map((r, i) => {
          r.Subtest = r.Subtest || subject;
          r.Tingkat = r.Tingkat || difficulty;
          const res = rowToQuestion(r, { subtest: subject, topic: pn.topic, subtopic: pn.subtopic });
          return { line: i + 1, row: r, question: res.question, error: res.error };
        });

        markDuplicates(parsed);
        const good = parsed.filter(p => p.question);
        const bad = parsed.filter(p => p.error);
        const dups = good.filter(p => p.dup);
        const psgN = new Set(good.filter(p => p.question._passage).map(p => RichText.plain(p.question._passage.html, 400))).size;
        okBtn.disabled = good.length === 0;
        preview.innerHTML = !parsed.length
          ? '<div class="alert alert-error">Belum ada yang bisa dibaca. Periksa kembali isinya.</div>'
          : `<div class="alert ${bad.length ? 'alert-error' : 'alert-info'}">
               <strong>${good.length - dups.length} soal baru siap disimpan</strong>${dups.length ? ` • ${dups.length} terdeteksi ganda (dilewati)` : ''}${bad.length ? ` • ${bad.length} baris bermasalah` : ''}${psgN ? ` • ${psgN} teks bacaan` : ''}
             </div>${dupOptionHtml(dups.length)}
             <div class="table-wrap" style="max-height:220px;overflow:auto;">
               <table class="table"><thead><tr><th>#</th><th>Format</th><th>Materi</th><th>Pertanyaan</th><th>Kunci</th><th>Catatan</th></tr></thead>
               <tbody>${parsed.slice(0, 50).map(pp => `<tr>
                 <td>${pp.line}</td>
                 <td class="muted small">${esc(pp.question ? pp.question.questionType : '-')}</td>
                 <td class="muted small">${esc(pp.question && pp.question._topic ? pp.question._topic + (pp.question._subtopic ? ' › ' + pp.question._subtopic : '') : '-')}</td>
                 <td>${pp.question && pp.question._passage ? '📖 ' : ''}${esc(String(pp.row.Pertanyaan || '').slice(0, 60))}</td>
                 <td>${esc(pp.question ? keyLabel(pp.question) : '-')}</td>
                 <td class="small" style="color:${pp.error ? 'var(--danger)' : pp.dup ? 'var(--warning)' : 'var(--success)'};">${esc(pp.error || (pp.dup ? dupText(pp.dup) : 'OK'))}</td>
               </tr>`).join('')}</tbody></table>
             </div>`;
      });

      back.querySelector('[data-cancel]').addEventListener('click', close);
      okBtn.addEventListener('click', () => {
        const keepDup = !!(back.querySelector('#bkKeepDup') || {}).checked;
        const good = parsed.filter(p => p.question && (keepDup || !p.dup));
        if (!good.length) { UI.toast('Semua soal terdeteksi ganda. Centang "Tetap simpan" bila memang ingin menyimpannya.', 'info'); return; }
        const n = saveQuestions(good.map(g => g.question), user, mode === 'ai' ? 'ai' : 'massal');
        close();
        UI.toast(`${n} soal ditambahkan ke Bank Soal.`, 'success');
        if (typeof onDone === 'function') onDone(n);
      });

      paintPanel();
    });
  }

  /**
   * Tebak format dari bentuk kuncinya ketika pengguna tidak menulis kolom
   * Format — misalnya "A,C" berarti pilihan lebih dari satu, "Benar" berarti
   * benar/salah, dan kunci tanpa pilihan berarti isian singkat.
   */
  function inferFormat(key, optionCount) {
    const k = String(key == null ? '' : key).trim();
    if (!optionCount) return /^(benar|salah|true|false)$/i.test(k) ? 'Benar/Salah' : 'Isian Singkat';
    const letters = k.split(/[,;|/ ]+/).map(x => x.trim()).filter(Boolean);
    const allLetters = letters.length > 0 && letters.every(x => /^[A-Ha-h]$/.test(x) || /^\d+$/.test(x));
    if (allLetters && letters.length > 1) return 'Pilihan Lebih dari Satu';
    if (/^(benar|salah|true|false)$/i.test(k)) return 'Benar/Salah';
    return 'Pilihan Ganda';
  }

  /**
   * "Pertanyaan | A | B | C | D | kunci" -> baris tabel.
   * Teks bacaan: baris "TEKS: Judul" lalu paragraf bacaan (tanpa tanda |). Soal
   * sesudahnya memakai teks itu sampai "TEKS:" berikutnya atau baris "---".
   */
  function linesToRows(text) {
    const rows = [];
    let psg = null;
    const psgHtml = (p) => p.paras.filter(x => x.trim()).map(x => '<p>' + UI.esc(x.trim()) + '</p>').join('');
    String(text || '').split('\n').forEach(raw => {
      const line = raw.trim();
      const head = /^(?:teks(?:\s*bacaan)?|bacaan|wacana|stimulus)\s*:\s*(.*)$/i.exec(line);
      if (head) { psg = head[1].trim() === '-' ? null : { title: head[1].trim(), paras: [''], started: false }; return; }
      if (/^-{3,}$/.test(line)) { psg = null; return; }
      if (psg && !psg.started && !line.includes('|')) {
        if (!line) psg.paras.push('');
        else psg.paras[psg.paras.length - 1] += (psg.paras[psg.paras.length - 1] ? ' ' : '') + line;
        return;
      }
      if (!line) return;
      const parts = line.split('|').map(x => x.trim());
      const row = { Pertanyaan: parts.shift() || '' };
      const key = parts.length ? parts.pop() : '';
      parts.forEach((p, i) => { if (LETTERS[i]) row[LETTERS[i]] = p; });
      row.Kunci = key;
      row.Format = inferFormat(key, parts.length);
      if (psg && psgHtml(psg)) { psg.started = true; row['Teks Bacaan'] = psgHtml(psg); row['Judul Teks'] = psg.title; }
      rows.push(row);
    });
    return rows;
  }

  /** Tempelan Excel (dipisah tab) -> baris tabel. Baris judul berisi nama kolom dipetakan per nama. */
  function pastedToRows(text) {
    const lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
    if (!lines.length) return [];
    const split = (l) => l.split('\t').map(x => x.trim());
    let rows = lines.map(split);
    const first = rows[0].map(x => x.toLowerCase());
    const named = first.map(h => COLS.find(c => c.toLowerCase() === h) || (h === 'soal' ? 'Pertanyaan' : null));
    if (named.filter(Boolean).length >= 2 && named.includes('Pertanyaan')) {
      return rows.slice(1).map(cells => {
        const row = {};
        named.forEach((c, i) => { if (c) row[c] = cells[i] || ''; });
        if (!row.Format) row.Format = inferFormat(row.Kunci, LETTERS.filter(L => row[L]).length);
        return row;
      });
    }
    // Tanpa judul kolom: Pertanyaan, A, B, …, Kunci, Pembahasan (opsional)
    if (first.includes('pertanyaan') || first.includes('soal')) rows = rows.slice(1);
    return rows.map(cells => {
      const row = { Pertanyaan: cells[0] || '' };
      let key, expl = '';
      if (cells.length >= 7) { expl = cells[cells.length - 1]; key = cells[cells.length - 2]; }
      else key = cells[cells.length - 1];
      const opts = cells.slice(1, cells.length - (cells.length >= 7 ? 2 : 1));
      opts.forEach((o, i) => { if (LETTERS[i]) row[LETTERS[i]] = o; });
      row.Kunci = key || '';
      row.Pembahasan = expl;
      row.Format = inferFormat(key, opts.filter(Boolean).length);
      return row;
    });
  }

  global.BankTools = {
    openBulk, openImport, exportQuestions, downloadTemplate, saveQuestions, markDuplicates,
    rowToQuestion, questionToRow, parseCsv, linesToRows, pastedToRows, keyLabel,
    inferFormat, COLS
  };
})(window);
