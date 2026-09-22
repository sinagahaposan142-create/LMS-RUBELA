/* ===== LMS Rubela - Mesin Editor Konten Kaya =====
 * Satu mesin editor dipakai bersama oleh:
 *   - Bank Soal / CBT   (js/qeditor.js)
 *   - Materi & Modul    (js/content.js)
 *   - Tugas             (js/content.js)
 *
 * Kemampuan setara pengolah kata + lembar kerja:
 *   teks (tebal/miring/garis bawah/coret, sub & superskrip, warna, stabilo,
 *   jenis & ukuran huruf), paragraf (judul H1-H4, kutipan, kode, rata kiri/
 *   tengah/kanan/penuh, indentasi, daftar poin/bernomor/centang, garis
 *   horizontal), tabel yang bisa disunting (tambah/hapus baris & kolom,
 *   baris judul), rumus LaTeX + palet simbol matematika/fisika/kimia,
 *   gambar (otomatis diperkecil), audio, dan tautan berpratinjau.
 *
 * Perbaikan penting dibanding versi sebelumnya:
 *   1. Tombol blok (kutipan/judul/kode) kini BISA dimatikan kembali. Dulu
 *      memakai execCommand('formatBlock') yang hanya menerapkan, tidak
 *      mengalihkan, sehingga kutipan tidak bisa dibatalkan.
 *   2. Penyisipan dari dialog (tabel, gambar, rumus, dll.) kini menyimpan dan
 *      memulihkan posisi kursor. Dulu seleksi hilang saat mengisi dialog
 *      sehingga execCommand('insertHTML') gagal tanpa pesan apa pun —
 *      itulah sebab tabel "tidak bisa dibuat".
 *   3. Tombol menyala (is-on) mengikuti format di posisi kursor.
 */
(function (global) {

  /* ===== Batas media ===== */
  const IMG_MAX_W = 1000;              // lebar maksimum gambar setelah diperkecil
  const IMG_MAX_BYTES = 400 * 1024;    // target ukuran gambar
  const AUDIO_MAX_BYTES = 1.5 * 1024 * 1024;

  /* Tag blok yang dikenali saat mendeteksi format di posisi kursor. */
  const BLOCK_TAGS = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li'];
  const BLOCK_RE = /^(p|div|h[1-6]|ul|ol|li|blockquote|pre|table|hr|figure)$/i;

  const FONTS = [
    ['', 'Huruf bawaan'],
    ['Inter, system-ui, sans-serif', 'Inter (sans)'],
    ['Georgia, serif', 'Georgia (serif)'],
    ['"Times New Roman", serif', 'Times New Roman'],
    ['"Courier New", monospace', 'Courier New (mono)'],
    ['Arial, Helvetica, sans-serif', 'Arial']
  ];
  const SIZES = [
    ['', 'Ukuran bawaan'], ['12px', 'Sangat kecil'], ['14px', 'Kecil'],
    ['16px', 'Normal'], ['18px', 'Agak besar'], ['22px', 'Besar'], ['28px', 'Sangat besar']
  ];
  const TEXT_COLORS = ['#0f172a', '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
    '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#64748b', '#ffffff'];
  const MARK_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa', 'transparent'];

  /* Palet simbol LaTeX: matematika, fisika, kimia, himpunan & logika. */
  const PALETTE = [
    { group: 'Dasar & Operator', items: [
      ['\\times', '×', 'Kali'], ['\\div', '÷', 'Bagi'], ['\\pm', '±', 'Plus minus'],
      ['\\mp', '∓', 'Minus plus'], ['\\cdot', '⋅', 'Titik kali'], ['\\neq', '≠', 'Tidak sama dengan'],
      ['\\leq', '≤', 'Kurang dari sama dengan'], ['\\geq', '≥', 'Lebih dari sama dengan'],
      ['\\approx', '≈', 'Kira-kira'], ['\\equiv', '≡', 'Identik'], ['\\propto', '∝', 'Sebanding'],
      ['\\infty', '∞', 'Tak hingga'], ['\\%', '%', 'Persen']
    ]},
    { group: 'Pecahan, Akar & Pangkat', items: [
      ['\\frac{a}{b}', 'a/b', 'Pecahan'], ['\\dfrac{a}{b}', 'a/b', 'Pecahan besar'],
      ['\\sqrt{x}', '√x', 'Akar'], ['\\sqrt[3]{x}', '∛x', 'Akar pangkat n'],
      ['x^{2}', 'x²', 'Pangkat'], ['x_{i}', 'xᵢ', 'Indeks'],
      ['\\log_{a} b', 'logₐb', 'Logaritma'], ['\\ln x', 'ln x', 'Logaritma natural'],
      ['e^{x}', 'eˣ', 'Eksponen'], ['|x|', '|x|', 'Nilai mutlak']
    ]},
    { group: 'Kalkulus & Deret', items: [
      ['\\sum_{i=1}^{n}', '∑', 'Sigma'], ['\\prod_{i=1}^{n}', '∏', 'Produk'],
      ['\\int_{a}^{b}', '∫', 'Integral'], ['\\lim_{x \\to 0}', 'lim', 'Limit'],
      ['\\frac{dy}{dx}', 'dy/dx', 'Turunan'], ['\\partial', '∂', 'Turunan parsial'],
      ['\\Delta', 'Δ', 'Delta'], ['\\nabla', '∇', 'Nabla']
    ]},
    { group: 'Yunani', items: [
      ['\\alpha', 'α', 'Alfa'], ['\\beta', 'β', 'Beta'], ['\\gamma', 'γ', 'Gama'],
      ['\\delta', 'δ', 'Delta'], ['\\theta', 'θ', 'Teta'], ['\\lambda', 'λ', 'Lambda'],
      ['\\mu', 'μ', 'Mu'], ['\\pi', 'π', 'Pi'], ['\\rho', 'ρ', 'Rho'],
      ['\\sigma', 'σ', 'Sigma'], ['\\phi', 'φ', 'Fi'], ['\\omega', 'ω', 'Omega'],
      ['\\Omega', 'Ω', 'Omega besar']
    ]},
    { group: 'Trigonometri', items: [
      ['\\sin', 'sin', 'Sinus'], ['\\cos', 'cos', 'Kosinus'], ['\\tan', 'tan', 'Tangen'],
      ['\\cot', 'cot', 'Kotangen'], ['\\sec', 'sec', 'Sekan'], ['\\csc', 'csc', 'Kosekan'],
      ['\\sin^{-1}', 'sin⁻¹', 'Arcus sinus'], ['\\degree', '°', 'Derajat']
    ]},
    { group: 'Fisika', items: [
      ['\\vec{v}', 'v⃗', 'Vektor'], ['\\hat{n}', 'n̂', 'Vektor satuan'],
      ['\\degree', '°', 'Derajat'], ['\\unit{m/s^2}', 'm/s²', 'Satuan'],
      ['\\hbar', 'ℏ', 'Konstanta Planck'], ['\\perp', '⊥', 'Tegak lurus'],
      ['\\parallel', '∥', 'Sejajar'], ['\\angle', '∠', 'Sudut'],
      ['\\rightarrow', '→', 'Menuju']
    ]},
    { group: 'Kimia', items: [
      ['\\ce{H2O}', 'H₂O', 'Rumus molekul'], ['\\ce{H2SO4}', 'H₂SO₄', 'Asam sulfat'],
      ['\\ce{SO4^{2-}}', 'SO₄²⁻', 'Ion'], ['\\ce{Na+}', 'Na⁺', 'Kation'],
      ['\\ce{A + B -> C}', 'A+B→C', 'Reaksi'], ['\\ce{A <=> B}', 'A⇌B', 'Kesetimbangan'],
      ['\\Delta H', 'ΔH', 'Entalpi']
    ]},
    { group: 'Himpunan & Logika', items: [
      ['\\in', '∈', 'Anggota'], ['\\notin', '∉', 'Bukan anggota'],
      ['\\subset', '⊂', 'Himpunan bagian'], ['\\cup', '∪', 'Gabungan'],
      ['\\cap', '∩', 'Irisan'], ['\\emptyset', '∅', 'Himpunan kosong'],
      ['\\forall', '∀', 'Untuk semua'], ['\\exists', '∃', 'Terdapat'],
      ['\\Rightarrow', '⇒', 'Implikasi'], ['\\Leftrightarrow', '⇔', 'Biimplikasi'],
      ['\\land', '∧', 'Dan'], ['\\lor', '∨', 'Atau'], ['\\neg', '¬', 'Negasi']
    ]}
  ];

  /* ===== Status modul ===== */
  let activeEditable = null;   // editor terakhir yang difokuskan
  let savedRange = null;       // posisi kursor terakhir di dalam editor
  let dialogHost = null;       // tempat dialog dipasang (overlay penuh / body)

  function esc(s) { return global.UI ? UI.esc(s) : String(s == null ? '' : s); }
  function toast(msg, kind) { if (global.UI) UI.toast(msg, kind); }

  /** Tentukan tempat memasang dialog agar selalu di atas lapisan lain. */
  function setHost(el) { dialogHost = el || null; }
  function host() { return dialogHost || document.body; }

  /* =====================================================================
   * 1. Seleksi & penyisipan — inti perbaikan bug "tabel tidak bisa dibuat"
   * ===================================================================*/
  function rememberEditable(el) {
    if (!el) return;
    activeEditable = el;
    saveRange();
  }

  /** Simpan posisi kursor selama masih berada di dalam editor aktif. */
  function saveRange() {
    const sel = global.getSelection ? global.getSelection() : null;
    if (!sel || !sel.rangeCount || !activeEditable) return;
    const r = sel.getRangeAt(0);
    if (activeEditable.contains(r.commonAncestorContainer)) savedRange = r.cloneRange();
  }

  /**
   * Pulihkan kursor ke editor. Dipanggil sebelum setiap perintah format atau
   * penyisipan, karena saat pengguna mengisi dialog fokusnya pindah ke input
   * dialog sehingga seleksi di editor hilang.
   */
  function restoreRange() {
    if (!activeEditable) return false;
    activeEditable.focus({ preventScroll: true });
    const sel = global.getSelection();
    if (!sel) return false;
    if (savedRange && activeEditable.contains(savedRange.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return true;
    }
    // Belum pernah menaruh kursor: letakkan di akhir isi editor
    const r = document.createRange();
    r.selectNodeContents(activeEditable);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
    return true;
  }

  function notifyChange() {
    if (!activeEditable) return;
    saveRange();
    activeEditable.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Sisipkan HTML pada posisi kursor.
   * execCommand('insertHTML') mengembalikan false (tanpa melempar galat) bila
   * seleksi tidak berada di elemen yang bisa disunting, jadi nilai baliknya
   * harus diperiksa dan disiapkan jalur cadangan manual.
   */
  function insertHtml(html) {
    if (!activeEditable) { toast('Klik dulu area teks yang ingin diisi.', 'info'); return false; }
    restoreRange();

    let ok = false;
    try { ok = document.execCommand('insertHTML', false, html); }
    catch (e) { ok = false; }

    if (!ok) {
      // Jalur cadangan: bangun simpul sendiri lalu taruh di posisi kursor
      const sel = global.getSelection();
      const range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
      const tpl = document.createElement('div');
      tpl.innerHTML = html;
      const frag = document.createDocumentFragment();
      let last = null;
      while (tpl.firstChild) { last = tpl.firstChild; frag.appendChild(last); }
      if (range && activeEditable.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        range.insertNode(frag);
        if (last) {
          const after = document.createRange();
          after.setStartAfter(last);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
        }
      } else {
        activeEditable.appendChild(frag);
      }
    }
    notifyChange();
    return true;
  }

  function insertText(text) { return insertHtml(esc(text)); }

  /* =====================================================================
   * 2. Perintah format
   * ===================================================================*/
  function execCmd(cmd, value) {
    if (!activeEditable) { toast('Klik dulu area teks yang ingin diformat.', 'info'); return; }
    restoreRange();
    try { document.execCommand(cmd, false, value == null ? null : value); }
    catch (e) { /* perintah tak didukung peramban — diabaikan */ }
    notifyChange();
  }

  /** Elemen terdekat di atas kursor yang cocok dengan salah satu tag. */
  function closestTag(tags) {
    if (!activeEditable) return null;
    const sel = global.getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    const want = tags.map(t => t.toUpperCase());
    while (n && n !== activeEditable && activeEditable.contains(n)) {
      if (want.includes(n.tagName)) return n;
      n = n.parentNode;
    }
    return null;
  }

  /** Nama tag blok tempat kursor berada ('p', 'blockquote', 'h3', …). */
  function currentBlockTag() {
    const el = closestTag(BLOCK_TAGS);
    return el ? el.tagName.toLowerCase() : '';
  }

  /**
   * Lepas sebuah elemen blok namun pertahankan isinya.
   * Dipakai untuk membatalkan kutipan/kode, karena formatBlock('p') tidak
   * dapat diandalkan membuang pembungkus <blockquote> di Blink/WebKit.
   */
  function unwrapElement(el) {
    if (!el || !el.parentNode) return null;
    const frag = document.createDocumentFragment();
    let buffer = null;
    let firstOut = null;
    Array.prototype.slice.call(el.childNodes).forEach(ch => {
      const isBlock = ch.nodeType === 1 && BLOCK_RE.test(ch.tagName);
      if (isBlock) {
        if (buffer) { frag.appendChild(buffer); buffer = null; }
        frag.appendChild(ch);
        if (!firstOut) firstOut = ch;
      } else {
        if (!buffer) buffer = document.createElement('p');
        buffer.appendChild(ch);
      }
    });
    if (buffer) frag.appendChild(buffer);
    if (!firstOut) firstOut = frag.firstChild;
    el.parentNode.replaceChild(frag, el);
    return firstOut;
  }

  function placeCaretIn(node) {
    if (!node) return;
    const sel = global.getSelection();
    const r = document.createRange();
    try { r.selectNodeContents(node); } catch (e) { return; }
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    savedRange = r.cloneRange();
  }

  /**
   * Alihkan format blok: bila kursor sudah berada di dalam tag itu, lepas;
   * bila belum, terapkan. Inilah perbaikan bug tombol kutipan.
   */
  function toggleBlock(tag) {
    if (!activeEditable) { toast('Klik dulu area teks yang ingin diformat.', 'info'); return; }
    restoreRange();
    const t = String(tag || '').toLowerCase();
    const existing = closestTag([t]);
    if (existing) {
      const out = unwrapElement(existing);
      placeCaretIn(out);
      notifyChange();
      return;
    }
    // Kutipan boleh bersarang di dalam paragraf: normalkan dulu ke <p>
    try { document.execCommand('formatBlock', false, t); }
    catch (e) { /* diabaikan */ }
    // Beberapa peramban butuh bentuk <tag>
    if (!closestTag([t])) {
      try { document.execCommand('formatBlock', false, '<' + t + '>'); }
      catch (e) { /* diabaikan */ }
    }
    notifyChange();
  }

  /** Daftar centang (checklist) — tidak tersedia di execCommand. */
  function insertChecklist() {
    insertHtml('<ul class="rte-check"><li>Poin pertama</li><li>Poin kedua</li></ul><p><br></p>');
  }

  function insertDivider() {
    insertHtml('<hr /><p><br></p>');
  }

  /* =====================================================================
   * 3. Tabel — sisip & sunting
   * ===================================================================*/
  function buildTableHtml(rows, cols, withHead) {
    let html = '<table class="rte-table"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) {
        html += (withHead && r === 0) ? `<th>Judul ${c + 1}</th>` : '<td>&nbsp;</td>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table><p><br></p>';
  }

  function currentCell() { return closestTag(['td', 'th']); }
  function currentTable() { return closestTag(['table']); }

  /** Operasi tabel relatif terhadap sel tempat kursor berada. */
  function tableOp(op) {
    const cell = currentCell();
    const table = currentTable();
    if (!cell || !table) {
      toast('Letakkan kursor di dalam tabel terlebih dahulu.', 'info');
      return;
    }
    const row = cell.parentElement;
    const colIndex = Array.prototype.indexOf.call(row.children, cell);
    const rows = Array.prototype.slice.call(table.rows);

    const makeCell = (tag, text) => {
      const c = document.createElement(tag);
      c.innerHTML = text || '&nbsp;';
      return c;
    };

    if (op === 'rowAbove' || op === 'rowBelow') {
      const fresh = row.cloneNode(false);
      Array.prototype.forEach.call(row.children, () => fresh.appendChild(makeCell('td')));
      row.parentNode.insertBefore(fresh, op === 'rowAbove' ? row : row.nextSibling);
      placeCaretIn(fresh.firstChild);
    } else if (op === 'rowDelete') {
      if (rows.length <= 1) { toast('Tabel harus punya minimal satu baris.', 'info'); return; }
      const idx = rows.indexOf(row);
      row.parentNode.removeChild(row);
      const next = table.rows[Math.min(idx, table.rows.length - 1)];
      placeCaretIn(next && next.cells[0]);
    } else if (op === 'colLeft' || op === 'colRight') {
      const at = op === 'colLeft' ? colIndex : colIndex + 1;
      rows.forEach(r => {
        const isHeadRow = r.cells[0] && r.cells[0].tagName === 'TH';
        const c = makeCell(isHeadRow ? 'th' : 'td', isHeadRow ? 'Judul' : '');
        if (at >= r.cells.length) r.appendChild(c);
        else r.insertBefore(c, r.cells[at]);
      });
      placeCaretIn(row.cells[Math.min(at, row.cells.length - 1)]);
    } else if (op === 'colDelete') {
      if (row.cells.length <= 1) { toast('Tabel harus punya minimal satu kolom.', 'info'); return; }
      rows.forEach(r => { if (r.cells[colIndex]) r.deleteCell(colIndex); });
      placeCaretIn(row.cells[Math.min(colIndex, row.cells.length - 1)]);
    } else if (op === 'toggleHead') {
      const first = table.rows[0];
      if (!first) return;
      const isHead = first.cells[0] && first.cells[0].tagName === 'TH';
      Array.prototype.slice.call(first.cells).forEach(c => {
        const rep = document.createElement(isHead ? 'td' : 'th');
        rep.innerHTML = c.innerHTML;
        c.parentNode.replaceChild(rep, c);
      });
    } else if (op === 'delete') {
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      table.parentNode.replaceChild(p, table);
      placeCaretIn(p);
    }
    notifyChange();
  }

  /* =====================================================================
   * 4. Utilitas media
   * ===================================================================*/
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Berkas bukan gambar yang valid.'));
        img.onload = () => {
          const scale = Math.min(1, IMG_MAX_W / img.width);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          let quality = 0.88;
          let out = canvas.toDataURL('image/jpeg', quality);
          while (out.length > IMG_MAX_BYTES * 1.37 && quality > 0.4) {
            quality -= 0.12;
            out = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('Gagal membaca berkas.'));
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
  }

  /* =====================================================================
   * 5. Toolbar
   * ===================================================================*/
  /**
   * @param {string} idPrefix  id elemen contenteditable yang dilayani
   * @param {object} opts      { compact: true } untuk versi ringkas
   */
  function toolbarHtml(idPrefix, opts) {
    const o = opts || {};
    const btn = (cmd, label, title, arg, extra) =>
      `<button type="button" class="rte-btn ${extra || ''}" data-cmd="${cmd}"` +
      `${arg ? ` data-arg="${esc(arg)}"` : ''} title="${esc(title)}">${label}</button>`;
    const blk = (tag, label, title) =>
      `<button type="button" class="rte-btn" data-block="${tag}" title="${esc(title)}">${label}</button>`;
    const ins = (key, label, title, extra) =>
      `<button type="button" class="rte-btn ${extra || ''}" data-ins="${key}" title="${esc(title)}">${label}</button>`;

    const swatches = (attr, colors) => colors.map(c =>
      `<button type="button" class="rte-swatch" data-${attr}="${c}" title="${esc(c)}"
         style="background:${c === 'transparent' ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50%/8px 8px' : c};"></button>`).join('');

    return `
      <div class="rte-toolbar" data-for="${idPrefix}">
        <div class="rte-group">
          ${btn('undo', '↶', 'Batalkan (Ctrl+Z)')}
          ${btn('redo', '↷', 'Ulangi (Ctrl+Y)')}
        </div>

        <div class="rte-group">
          <select class="rte-select" data-style="fontName" title="Jenis huruf">
            ${FONTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
          </select>
          <select class="rte-select" data-style="fontSize" title="Ukuran huruf">
            ${SIZES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
          </select>
          <select class="rte-select" data-block-select title="Gaya paragraf">
            <option value="p">Teks biasa</option>
            <option value="h2">Judul besar</option>
            <option value="h3">Judul sedang</option>
            <option value="h4">Judul kecil</option>
            <option value="blockquote">Kutipan</option>
            <option value="pre">Kode</option>
          </select>
        </div>

        <div class="rte-group">
          ${btn('bold', '<b>B</b>', 'Tebal (Ctrl+B)')}
          ${btn('italic', '<i>I</i>', 'Miring (Ctrl+I)')}
          ${btn('underline', '<u>U</u>', 'Garis bawah (Ctrl+U)')}
          ${btn('strikeThrough', '<s>S</s>', 'Coret')}
          ${btn('subscript', 'X₂', 'Subskrip')}
          ${btn('superscript', 'X²', 'Superskrip')}
        </div>

        <div class="rte-group rte-pop-wrap">
          <button type="button" class="rte-btn" data-pop="color" title="Warna huruf"><span class="rte-ink">A</span></button>
          <div class="rte-pop" data-pop-for="color">
            <div class="rte-pop-title">Warna huruf</div>
            <div class="rte-swatches">${swatches('fore', TEXT_COLORS)}</div>
          </div>
        </div>
        <div class="rte-group rte-pop-wrap">
          <button type="button" class="rte-btn" data-pop="mark" title="Stabilo">🖍</button>
          <div class="rte-pop" data-pop-for="mark">
            <div class="rte-pop-title">Warna stabilo</div>
            <div class="rte-swatches">${swatches('back', MARK_COLORS)}</div>
          </div>
        </div>

        <div class="rte-group">
          ${btn('insertUnorderedList', '•', 'Daftar poin')}
          ${btn('insertOrderedList', '1.', 'Daftar bernomor')}
          ${ins('checklist', '☑', 'Daftar centang')}
          ${btn('outdent', '⇤', 'Kurangi indentasi')}
          ${btn('indent', '⇥', 'Tambah indentasi')}
        </div>

        <div class="rte-group">
          ${btn('justifyLeft', '⯇', 'Rata kiri')}
          ${btn('justifyCenter', '≡', 'Rata tengah')}
          ${btn('justifyRight', '⯈', 'Rata kanan')}
          ${btn('justifyFull', '▤', 'Rata penuh')}
        </div>

        <div class="rte-group">
          ${blk('h3', 'H', 'Judul')}
          ${blk('blockquote', '❝', 'Kutipan (klik lagi untuk membatalkan)')}
          ${blk('pre', '&lt;/&gt;', 'Kode (klik lagi untuk membatalkan)')}
          ${ins('divider', '―', 'Garis pemisah')}
        </div>

        <div class="rte-group">
          ${ins('formula', '∑ Rumus', 'Sisipkan rumus LaTeX', 'accent')}
          ${ins('palette', 'Ω Simbol', 'Palet simbol matematika, fisika, kimia')}
        </div>

        <div class="rte-group rte-pop-wrap">
          ${ins('table', '▦ Tabel', 'Sisipkan tabel')}
          <button type="button" class="rte-btn" data-pop="tbl" title="Sunting tabel">▦⋯</button>
          <div class="rte-pop rte-pop-wide" data-pop-for="tbl">
            <div class="rte-pop-title">Sunting tabel di posisi kursor</div>
            <div class="rte-pop-grid">
              <button type="button" class="btn btn-sm btn-secondary" data-tbl="rowAbove">⬆ Baris di atas</button>
              <button type="button" class="btn btn-sm btn-secondary" data-tbl="rowBelow">⬇ Baris di bawah</button>
              <button type="button" class="btn btn-sm btn-secondary" data-tbl="colLeft">⬅ Kolom di kiri</button>
              <button type="button" class="btn btn-sm btn-secondary" data-tbl="colRight">➡ Kolom di kanan</button>
              <button type="button" class="btn btn-sm btn-danger" data-tbl="rowDelete">✕ Hapus baris</button>
              <button type="button" class="btn btn-sm btn-danger" data-tbl="colDelete">✕ Hapus kolom</button>
              <button type="button" class="btn btn-sm btn-secondary" data-tbl="toggleHead">⇅ Baris judul</button>
              <button type="button" class="btn btn-sm btn-danger" data-tbl="delete">🗑 Hapus tabel</button>
            </div>
          </div>
        </div>

        <div class="rte-group">
          ${ins('image', '🖼 Gambar', 'Sisipkan gambar')}
          ${ins('audio', '🔊 Audio', 'Sisipkan audio')}
          ${ins('link', '🔗 Tautan', 'Sisipkan tautan')}
        </div>

        <div class="rte-group">
          ${ins('paste', '📋', 'Tempel sebagai teks biasa')}
          ${btn('unlink', '⛓', 'Lepas tautan')}
          ${btn('removeFormat', '⌫', 'Hapus format')}
        </div>
      </div>`;
  }

  /* =====================================================================
   * 6. Dialog
   * ===================================================================*/
  function openSubDialog(title, bodyHtml, onMount) {
    const back = document.createElement('div');
    back.className = 'qe-dialog-back';
    back.innerHTML = `
      <div class="qe-dialog" role="dialog" aria-modal="true">
        <header class="qe-dialog-head">
          <strong>${esc(title)}</strong>
          <button type="button" class="icon-btn" data-close>&times;</button>
        </header>
        <div class="qe-dialog-body">${bodyHtml}</div>
      </div>`;
    host().appendChild(back);

    // Menekan tombol di dalam dialog tidak boleh mencuri seleksi editor
    back.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    const close = () => back.remove();
    back.querySelector('[data-close]').addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    if (typeof onMount === 'function') onMount(back, close);
    return { el: back, close };
  }

  function openFormulaDialog() {
    openSubDialog('Sisipkan Rumus (LaTeX)', `
      <p class="muted small" style="margin-top:0;">Tulis rumus tanpa tanda <code>$</code>. Contoh:
        <code>\\frac{1}{2}</code>, <code>x^2 + y^2</code>, <code>\\ce{H2SO4}</code>, <code>\\sum_{i=1}^{n} i</code>.</p>
      <textarea id="qeFx" class="qe-fx-input" rows="3" placeholder="\\frac{a}{b}"></textarea>
      <div class="qe-fx-preview" id="qeFxPrev"><span class="muted small">Pratinjau akan muncul di sini…</span></div>
      <label class="qe-check"><input type="checkbox" id="qeFxBlock" /> Tampilkan sebagai rumus blok (baris sendiri)</label>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok>Sisipkan</button>
      </div>
    `, (back, close) => {
      const input = back.querySelector('#qeFx');
      const prev = back.querySelector('#qeFxPrev');
      const block = back.querySelector('#qeFxBlock');
      const update = () => {
        const v = input.value.trim();
        prev.innerHTML = v ? MathFmt.renderLatex(v, block.checked)
                           : '<span class="muted small">Pratinjau akan muncul di sini…</span>';
      };
      input.addEventListener('input', update);
      block.addEventListener('change', update);
      back.querySelector('[data-cancel]').addEventListener('click', close);
      back.querySelector('[data-ok]').addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) { close(); return; }
        const delim = block.checked ? '$$' : '$';
        close();                              // tutup dulu, lalu sisipkan
        insertHtml(delim + v + delim + '&nbsp;');
      });
      setTimeout(() => input.focus(), 60);
    });
  }

  function openPaletteDialog() {
    const body = `
      <input type="search" id="qePalQ" class="input" placeholder="Cari simbol… (mis. akar, sigma, ion)" />
      <div id="qePalBody">${PALETTE.map(g => `
        <div class="qe-pal-group" data-group="${esc(g.group)}">
          <div class="qe-pal-title">${esc(g.group)}</div>
          <div class="qe-pal-grid">
            ${g.items.map(([tex, glyph, label]) =>
              `<button type="button" class="qe-pal-btn" data-tex="${esc(tex)}"
                 data-key="${esc((label + ' ' + tex).toLowerCase())}" title="${esc(label)} — ${esc(tex)}">
                 <span class="pal-glyph">${esc(glyph)}</span>
                 <span class="pal-label">${esc(label)}</span>
               </button>`).join('')}
          </div>
        </div>`).join('')}</div>
      <p class="muted small">Klik simbol untuk menyisipkan. Dialog tetap terbuka agar bisa memilih beberapa simbol.</p>`;
    openSubDialog('Palet Simbol LaTeX', body, (back) => {
      back.querySelectorAll('[data-tex]').forEach(b => b.addEventListener('click', () => {
        insertHtml('$' + b.dataset.tex + '$&nbsp;');
        toast('Simbol disisipkan.', 'info');
      }));
      const q = back.querySelector('#qePalQ');
      q.addEventListener('input', () => {
        const v = q.value.trim().toLowerCase();
        back.querySelectorAll('.qe-pal-group').forEach(g => {
          let shown = 0;
          g.querySelectorAll('[data-key]').forEach(b => {
            const hit = !v || b.dataset.key.includes(v);
            b.style.display = hit ? '' : 'none';
            if (hit) shown++;
          });
          g.style.display = shown ? '' : 'none';
        });
      });
    });
  }

  function openTableDialog() {
    openSubDialog('Sisipkan Tabel', `
      <div class="form-row">
        <div class="form-group"><label>Jumlah Baris</label><input type="number" id="qeRows" min="1" max="30" value="3" /></div>
        <div class="form-group"><label>Jumlah Kolom</label><input type="number" id="qeCols" min="1" max="12" value="3" /></div>
      </div>
      <label class="qe-check"><input type="checkbox" id="qeHead" checked /> Baris pertama sebagai judul kolom</label>
      <p class="muted small">Setelah tersisip, gunakan tombol <strong>▦⋯</strong> di bilah alat untuk menambah atau
        menghapus baris dan kolom.</p>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok>Sisipkan</button>
      </div>
    `, (back, close) => {
      back.querySelector('[data-cancel]').addEventListener('click', close);
      back.querySelector('[data-ok]').addEventListener('click', () => {
        const rows = Math.max(1, Math.min(30, Number(back.querySelector('#qeRows').value) || 3));
        const cols = Math.max(1, Math.min(12, Number(back.querySelector('#qeCols').value) || 3));
        const withHead = back.querySelector('#qeHead').checked;
        close();                              // tutup dulu agar kursor pulih
        insertHtml(buildTableHtml(rows, cols, withHead));
        toast('Tabel disisipkan.', 'success');
      });
    });
  }

  function openImageDialog() {
    openSubDialog('Sisipkan Gambar', `
      <div class="form-group">
        <label>Unggah dari perangkat</label>
        <input type="file" id="qeImgFile" accept="image/*" />
        <p class="muted small" style="margin:6px 0 0;">Gambar otomatis diperkecil (maks ${IMG_MAX_W}px) agar hemat penyimpanan.</p>
      </div>
      <div class="qe-or">atau</div>
      <div class="form-group">
        <label>Tempel URL gambar</label>
        <input type="url" id="qeImgUrl" placeholder="https://contoh.com/gambar.png" />
      </div>
      <div class="form-group">
        <label>Keterangan (opsional)</label>
        <input type="text" id="qeImgCap" placeholder="mis. Grafik fungsi kuadrat" />
      </div>
      <div class="qe-fx-preview" id="qeImgPrev"><span class="muted small">Pratinjau gambar…</span></div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok disabled>Sisipkan</button>
      </div>
    `, (back, close) => {
      let dataUrl = '';
      const prev = back.querySelector('#qeImgPrev');
      const okBtn = back.querySelector('[data-ok]');
      const setPreview = (src) => {
        dataUrl = src || '';
        okBtn.disabled = !dataUrl;
        prev.innerHTML = dataUrl
          ? `<img src="${esc(dataUrl)}" alt="pratinjau" style="max-width:100%;max-height:200px;border-radius:6px;" />`
          : '<span class="muted small">Pratinjau gambar…</span>';
      };
      back.querySelector('#qeImgFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        prev.innerHTML = '<span class="spinner"></span> Memproses gambar…';
        try { setPreview(await compressImage(f)); }
        catch (err) { prev.innerHTML = `<span class="small" style="color:var(--danger);">${esc(err.message)}</span>`; }
      });
      back.querySelector('#qeImgUrl').addEventListener('input', (e) => {
        const v = e.target.value.trim();
        setPreview(/^https?:\/\//i.test(v) ? v : '');
      });
      back.querySelector('[data-cancel]').addEventListener('click', close);
      okBtn.addEventListener('click', () => {
        const cap = back.querySelector('#qeImgCap').value.trim();
        const html = RichText.embedHtml(dataUrl, cap) + '<p><br></p>';
        close();
        insertHtml(html);
      });
    });
  }

  function openAudioDialog() {
    openSubDialog('Sisipkan Audio', `
      <div class="form-group">
        <label>Unggah berkas audio</label>
        <input type="file" id="qeAudFile" accept="audio/*" />
        <p class="muted small" style="margin:6px 0 0;">Disarankan di bawah 1,5 MB. Untuk audio panjang, gunakan URL.</p>
      </div>
      <div class="qe-or">atau</div>
      <div class="form-group">
        <label>Tempel URL audio</label>
        <input type="url" id="qeAudUrl" placeholder="https://contoh.com/listening.mp3" />
      </div>
      <div class="form-group">
        <label>Keterangan (opsional)</label>
        <input type="text" id="qeAudCap" placeholder="mis. Rekaman listening bagian 1" />
      </div>
      <div class="qe-fx-preview" id="qeAudPrev"><span class="muted small">Pratinjau audio…</span></div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok disabled>Sisipkan</button>
      </div>
    `, (back, close) => {
      let src = '';
      const prev = back.querySelector('#qeAudPrev');
      const okBtn = back.querySelector('[data-ok]');
      const setPreview = (v) => {
        src = v || '';
        okBtn.disabled = !src;
        prev.innerHTML = src ? `<audio controls src="${esc(src)}" style="width:100%;"></audio>`
                             : '<span class="muted small">Pratinjau audio…</span>';
      };
      back.querySelector('#qeAudFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > AUDIO_MAX_BYTES) {
          prev.innerHTML = '<span class="small" style="color:var(--danger);">Berkas terlalu besar. Gunakan URL untuk audio panjang.</span>';
          return;
        }
        try { setPreview(await readAsDataUrl(f)); }
        catch (err) { prev.innerHTML = `<span class="small" style="color:var(--danger);">${esc(err.message)}</span>`; }
      });
      back.querySelector('#qeAudUrl').addEventListener('input', (e) => {
        const v = e.target.value.trim();
        setPreview(/^https?:\/\//i.test(v) ? v : '');
      });
      back.querySelector('[data-cancel]').addEventListener('click', close);
      okBtn.addEventListener('click', () => {
        const html = RichText.embedHtml(src, back.querySelector('#qeAudCap').value.trim()) + '<p><br></p>';
        close();
        insertHtml(html);
      });
    });
  }

  function openLinkDialog() {
    openSubDialog('Sisipkan Tautan', `
      <div class="form-group">
        <label>URL</label>
        <input type="url" id="qeLnkUrl" placeholder="https://contoh.com/artikel" />
      </div>
      <div class="form-group">
        <label>Teks tautan (opsional)</label>
        <input type="text" id="qeLnkText" placeholder="Baca sumber" />
      </div>
      <label class="qe-check"><input type="checkbox" id="qeLnkEmbed" /> Tampilkan sebagai pratinjau (gambar/audio/video langsung tampil)</label>
      <div class="qe-fx-preview" id="qeLnkPrev"><span class="muted small">Pratinjau tautan…</span></div>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok disabled>Sisipkan</button>
      </div>
    `, (back, close) => {
      const urlEl = back.querySelector('#qeLnkUrl');
      const textEl = back.querySelector('#qeLnkText');
      const embedEl = back.querySelector('#qeLnkEmbed');
      const prev = back.querySelector('#qeLnkPrev');
      const okBtn = back.querySelector('[data-ok]');
      const update = () => {
        const u = urlEl.value.trim();
        const valid = /^https?:\/\//i.test(u);
        okBtn.disabled = !valid;
        if (!valid) { prev.innerHTML = '<span class="muted small">Pratinjau tautan…</span>'; return; }
        prev.innerHTML = embedEl.checked
          ? RichText.embedHtml(u, textEl.value.trim())
          : `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(textEl.value.trim() || u)}</a>
             <div class="muted small mt-1">Jenis terdeteksi: ${esc(RichText.linkKind(u))}</div>`;
      };
      [urlEl, textEl].forEach(el => el.addEventListener('input', update));
      embedEl.addEventListener('change', update);
      back.querySelector('[data-cancel]').addEventListener('click', close);
      okBtn.addEventListener('click', () => {
        const u = urlEl.value.trim();
        const t = textEl.value.trim();
        const html = embedEl.checked
          ? RichText.embedHtml(u, t) + '<p><br></p>'
          : `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t || u)}</a>&nbsp;`;
        close();
        insertHtml(html);
      });
    });
  }

  function openPasteDialog() {
    openSubDialog('Tempel sebagai Teks Biasa', `
      <p class="muted small" style="margin-top:0;">Tempel di sini bila ingin membuang seluruh format asal
        (warna, huruf, dan gaya dari Word atau situs web).</p>
      <textarea id="qePasteBox" rows="7" placeholder="Tempel teks di sini (Ctrl+V)…"></textarea>
      <div class="flex-gap mt-2" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok>Sisipkan</button>
      </div>
    `, (back, close) => {
      const box = back.querySelector('#qePasteBox');
      back.querySelector('[data-cancel]').addEventListener('click', close);
      back.querySelector('[data-ok]').addEventListener('click', () => {
        const lines = String(box.value || '').split(/\n{2,}/).filter(x => x.trim());
        if (!lines.length) { close(); return; }
        const html = lines.map(par =>
          '<p>' + esc(par.trim()).replace(/\n/g, '<br>') + '</p>').join('');
        close();
        insertHtml(html);
      });
      setTimeout(() => box.focus(), 60);
    });
  }

  /* =====================================================================
   * 7. Pemasangan: hubungkan toolbar ke editor
   * ===================================================================*/
  /**
   * Aktifkan semua toolbar + editor di dalam `root`.
   * @param {HTMLElement} root  wadah yang memuat .rte-toolbar dan .qe-editor
   * @param {object} opts       { onInput: fn(editorEl) }
   */
  function attach(root, opts) {
    if (!root) return;
    const o = opts || {};

    // --- editor: lacak fokus & seleksi, bersihkan tempelan ---
    root.querySelectorAll('[contenteditable="true"]').forEach(ed => {
      if (ed.dataset.rteReady === '1') return;
      ed.dataset.rteReady = '1';
      ['focus', 'mouseup', 'keyup', 'click'].forEach(evt =>
        ed.addEventListener(evt, () => { activeEditable = ed; saveRange(); syncToolbars(root); }));
      ed.addEventListener('input', () => {
        saveRange();
        if (typeof o.onInput === 'function') o.onInput(ed);
      });
      // Tempelan dibersihkan agar gaya asing tidak merusak tampilan
      ed.addEventListener('paste', (e) => {
        const cd = e.clipboardData;
        if (!cd) return;
        e.preventDefault();
        activeEditable = ed;
        const html = cd.getData('text/html');
        const text = cd.getData('text/plain');
        if (html && global.RichText) insertHtml(RichText.sanitize(html));
        else insertHtml(esc(text).replace(/\n/g, '<br>'));
      });
      // Jalan pintas papan tombol
      ed.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        const k = e.key.toLowerCase();
        if (k === 'k') { e.preventDefault(); rememberEditable(ed); openLinkDialog(); }
        else if (k === 'b' || k === 'i' || k === 'u') setTimeout(() => syncToolbars(root), 0);
      });
    });

    // --- toolbar ---
    root.querySelectorAll('.rte-toolbar').forEach(bar => {
      if (bar.dataset.rteReady === '1') return;
      bar.dataset.rteReady = '1';
      const targetEl = bar.dataset.for ? root.querySelector('#' + bar.dataset.for) : null;

      // Jangan hilangkan seleksi saat menekan tombol
      bar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, .rte-swatch')) e.preventDefault();
      });

      const useTarget = () => { if (targetEl) rememberEditable(targetEl); };

      bar.querySelectorAll('.rte-btn').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.pop) return;              // ditangani terpisah
        useTarget();
        if (b.dataset.cmd) { execCmd(b.dataset.cmd, b.dataset.arg); syncToolbars(root); return; }
        if (b.dataset.block) { toggleBlock(b.dataset.block); syncToolbars(root); return; }
        switch (b.dataset.ins) {
          case 'formula': openFormulaDialog(); break;
          case 'palette': openPaletteDialog(); break;
          case 'table': openTableDialog(); break;
          case 'image': openImageDialog(); break;
          case 'audio': openAudioDialog(); break;
          case 'link': openLinkDialog(); break;
          case 'paste': openPasteDialog(); break;
          case 'checklist': insertChecklist(); break;
          case 'divider': insertDivider(); break;
          default: break;
        }
      }));

      // Pilihan gaya (huruf, ukuran, paragraf)
      bar.querySelectorAll('[data-style]').forEach(sel => sel.addEventListener('change', () => {
        useTarget();
        const v = sel.value;
        if (!v) { execCmd('removeFormat'); return; }
        if (sel.dataset.style === 'fontName') execCmd('fontName', v);
        else applyInlineStyle('font-size', v);
        syncToolbars(root);
      }));
      const blkSel = bar.querySelector('[data-block-select]');
      if (blkSel) blkSel.addEventListener('change', () => {
        useTarget();
        const want = blkSel.value;
        const cur = currentBlockTag();
        if (cur === want) return;
        if (cur && ['blockquote', 'pre'].includes(cur)) {
          const el = closestTag([cur]);
          if (el) placeCaretIn(unwrapElement(el));
        }
        if (want !== 'p') toggleBlock(want);
        else execCmd('formatBlock', 'p');
        syncToolbars(root);
      });

      // Popover (warna, stabilo, sunting tabel)
      bar.querySelectorAll('[data-pop]').forEach(trigger => trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        useTarget();
        const key = trigger.dataset.pop;
        const pop = bar.querySelector(`[data-pop-for="${key}"]`);
        const wasOpen = pop && pop.classList.contains('is-open');
        bar.querySelectorAll('.rte-pop').forEach(p => p.classList.remove('is-open'));
        if (pop && !wasOpen) pop.classList.add('is-open');
      }));
      bar.querySelectorAll('[data-fore]').forEach(sw => sw.addEventListener('click', () => {
        useTarget();
        execCmd('foreColor', sw.dataset.fore);
        bar.querySelectorAll('.rte-pop').forEach(p => p.classList.remove('is-open'));
      }));
      bar.querySelectorAll('[data-back]').forEach(sw => sw.addEventListener('click', () => {
        useTarget();
        if (sw.dataset.back === 'transparent') execCmd('removeFormat');
        else if (!execHilite(sw.dataset.back)) applyInlineStyle('background-color', sw.dataset.back);
        bar.querySelectorAll('.rte-pop').forEach(p => p.classList.remove('is-open'));
      }));
      bar.querySelectorAll('[data-tbl]').forEach(b => b.addEventListener('click', () => {
        useTarget();
        tableOp(b.dataset.tbl);
        bar.querySelectorAll('.rte-pop').forEach(p => p.classList.remove('is-open'));
      }));
    });

    // Klik di luar menutup popover
    if (!root.dataset.rtePopReady) {
      root.dataset.rtePopReady = '1';
      document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.rte-pop-wrap')) return;
        root.querySelectorAll('.rte-pop.is-open').forEach(p => p.classList.remove('is-open'));
      });
    }

    syncToolbars(root);
  }

  /** hiliteColor tidak tersedia di semua peramban; kembalikan false bila gagal. */
  function execHilite(color) {
    if (!activeEditable) return false;
    restoreRange();
    let ok = false;
    try {
      document.execCommand('styleWithCSS', false, true);
      ok = document.execCommand('hiliteColor', false, color);
      if (!ok) ok = document.execCommand('backColor', false, color);
    } catch (e) { ok = false; }
    notifyChange();
    return ok;
  }

  /** Bungkus seleksi dengan <span style="..."> bila execCommand tak memadai. */
  function applyInlineStyle(prop, value) {
    if (!activeEditable) { toast('Klik dulu area teks yang ingin diformat.', 'info'); return; }
    restoreRange();
    const sel = global.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) { toast('Pilih dulu teks yang ingin diubah.', 'info'); return; }
    const span = document.createElement('span');
    span.style.setProperty(prop, value);
    try {
      span.appendChild(range.extractContents());
      range.insertNode(span);
      const after = document.createRange();
      after.selectNodeContents(span);
      sel.removeAllRanges();
      sel.addRange(after);
      savedRange = after.cloneRange();
    } catch (e) { /* seleksi melintasi blok — dilewati */ }
    notifyChange();
  }

  /** Perbarui tampilan tombol agar sesuai format di posisi kursor. */
  function syncToolbars(root) {
    if (!root) return;
    const inline = ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript',
      'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter',
      'justifyRight', 'justifyFull'];
    const state = {};
    inline.forEach(c => {
      try { state[c] = document.queryCommandState(c); } catch (e) { state[c] = false; }
    });
    const block = currentBlockTag();

    root.querySelectorAll('.rte-toolbar').forEach(bar => {
      bar.querySelectorAll('[data-cmd]').forEach(b => {
        const c = b.dataset.cmd;
        if (c in state) b.classList.toggle('is-on', !!state[c]);
      });
      bar.querySelectorAll('[data-block]').forEach(b => {
        b.classList.toggle('is-on', b.dataset.block === block);
      });
      const sel = bar.querySelector('[data-block-select]');
      if (sel) {
        const want = ['h2', 'h3', 'h4', 'blockquote', 'pre'].includes(block) ? block : 'p';
        if (sel.value !== want) sel.value = want;
      }
    });
  }

  /* =====================================================================
   * 8. API publik
   * ===================================================================*/
  global.Editor = {
    // toolbar & pemasangan
    toolbarHtml, attach, syncToolbars, setHost,
    // seleksi & penyisipan
    rememberEditable, saveRange, restoreRange, insertHtml, insertText, execCmd,
    // format blok & tabel
    toggleBlock, currentBlockTag, tableOp, buildTableHtml, insertChecklist, insertDivider,
    // dialog
    openSubDialog, openFormulaDialog, openPaletteDialog, openTableDialog,
    openImageDialog, openAudioDialog, openLinkDialog, openPasteDialog,
    // media
    compressImage, readAsDataUrl,
    // konstanta
    PALETTE, FONTS, SIZES, TEXT_COLORS, MARK_COLORS,
    IMG_MAX_W, IMG_MAX_BYTES, AUDIO_MAX_BYTES
  };
})(window);
