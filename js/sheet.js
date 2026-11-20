/* =========================================================================
 * Sheet — "Lembar Data" ala Excel di dalam editor teks kaya.
 *
 * - Grid sel (maks. 60 × 20) dengan bilah rumus, navigasi panah/Enter/Tab.
 * - Rumus: =A1+B2*2, =SUM(A1:A5), AVERAGE, MIN, MAX, COUNT, ROUND, ABS, IF,
 *   alias Indonesia (JUMLAH, RATA, CACAH, JIKA). Operator + - * / ^ dan
 *   perbandingan = <> < > <= >=. Pemisah argumen , atau ;  Desimal: titik.
 *   Galat: #REF!, #DIV/0!, #NAME?, #VALUE!, #SIKLUS!, #ERROR!
 * - Tempel langsung dari Excel/Google Sheets, impor .xlsx/.xls/.csv.
 * - Hasil disisipkan sebagai <table class="rte-table"> berisi NILAI hasil
 *   hitung (rumus tidak ikut tersimpan di dokumen).
 *
 * Sheet.open({ table?, onInsert(html), onReplace(html) })
 * =======================================================================*/
(function (global) {
  'use strict';

  const MAX_R = 60, MAX_C = 20;
  const esc = (s) => (global.UI ? UI.esc(s) : String(s == null ? '' : s));
  const colName = (c) => String.fromCharCode(65 + c);

  /* ============================ rumus ============================ */
  class SheetError extends Error { constructor(code) { super(code); this.code = code; } }
  const isErr = (v) => v instanceof SheetError;

  /** Angka dari teks sel: "1.234,5" (id), "1234.5", "1234,5", "50%". */
  function parseNum(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/\s+/g, '');
    if (!s) return null;
    let pct = false;
    if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
    s = s.replace(/^Rp\.?/i, '');
    let n = null;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
    else if (/^-?\d+,\d+$/.test(s)) n = Number(s.replace(',', '.'));
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) n = Number(s.replace(/,/g, ''));
    else if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) n = Number(s);
    if (n == null || !Number.isFinite(n)) return null;
    return pct ? n / 100 : n;
  }

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = src.slice(i);
      let m;
      if ((m = /^\$?([A-Za-z])\$?(\d{1,3})(?::\$?([A-Za-z])\$?(\d{1,3}))?/.exec(rest)) && !/^[A-Za-z0-9(]/.test(rest.slice(m[0].length))) {
        if (m[3]) out.push({ t: 'range', a: [Number(m[2]) - 1, m[1].toUpperCase().charCodeAt(0) - 65], b: [Number(m[4]) - 1, m[3].toUpperCase().charCodeAt(0) - 65] });
        else out.push({ t: 'ref', rc: [Number(m[2]) - 1, m[1].toUpperCase().charCodeAt(0) - 65] });
        i += m[0].length; continue;
      }
      if ((m = /^[A-Za-z][A-Za-z0-9_.]*/.exec(rest))) { out.push({ t: 'name', v: m[0].toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) { out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
      if (ch === '"') {
        const end = src.indexOf('"', i + 1);
        if (end < 0) throw new SheetError('#ERROR!');
        out.push({ t: 'str', v: src.slice(i + 1, end) }); i = end + 1; continue;
      }
      if ((m = /^(<=|>=|<>|[-+*/^()=<>,;&])/.exec(rest))) { out.push({ t: 'op', v: m[0] === ';' ? ',' : m[0] }); i += m[0].length; continue; }
      throw new SheetError('#ERROR!');
    }
    return out;
  }

  const ALIAS = { JUMLAH: 'SUM', RATA: 'AVERAGE', RATARATA: 'AVERAGE', 'RATA.RATA': 'AVERAGE', CACAH: 'COUNT', JIKA: 'IF', PEMBULATAN: 'ROUND', BULATKAN: 'ROUND' };
  const FN = {
    SUM: (a) => nums(a).reduce((s, v) => s + v, 0),
    AVERAGE: (a) => { const n = nums(a); if (!n.length) throw new SheetError('#DIV/0!'); return n.reduce((s, v) => s + v, 0) / n.length; },
    MIN: (a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
    MAX: (a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
    COUNT: (a) => nums(a).length,
    ROUND: (a) => { const x = toNum(scalar(a[0])); const d = a.length > 1 ? Math.round(toNum(scalar(a[1]))) : 0; const f = Math.pow(10, d); return Math.round(x * f) / f; },
    ABS: (a) => Math.abs(toNum(scalar(a[0]))),
    IF: (a) => { if (a.length < 2) throw new SheetError('#VALUE!'); const c = scalar(a[0]); const yes = typeof c === 'number' ? c !== 0 : !!c; return yes ? scalar(a[1]) : (a.length > 2 ? scalar(a[2]) : false); }
  };
  function flat(args) { return args.reduce((o, v) => o.concat(Array.isArray(v) ? flat(v) : [v]), []); }
  function nums(args) { return flat(args).filter(v => typeof v === 'number' && Number.isFinite(v)); }
  function scalar(v) { if (Array.isArray(v)) throw new SheetError('#VALUE!'); return v; }
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '' || v == null) return 0;
    const n = parseNum(v);
    if (n == null) throw new SheetError('#VALUE!');
    return n;
  }

  /** Mesin hitung untuk satu grid. get(r, c) → nilai sel (dengan deteksi siklus). */
  function engine(grid) {
    const memo = new Map();
    const visiting = new Set();
    function cellValue(r, c) {
      if (r < 0 || c < 0 || r >= grid.length || c >= (grid[0] || []).length) throw new SheetError('#REF!');
      const key = r + ':' + c;
      if (memo.has(key)) { const v = memo.get(key); if (isErr(v)) throw v; return v; }
      if (visiting.has(key)) throw new SheetError('#SIKLUS!');
      visiting.add(key);
      let v;
      try { v = evalRaw(grid[r][c]); }
      catch (e) { v = isErr(e) ? e : new SheetError('#ERROR!'); }
      visiting.delete(key);
      memo.set(key, v);
      if (isErr(v)) throw v;
      return v;
    }
    function evalRaw(raw) {
      const s = String(raw == null ? '' : raw);
      if (!s.startsWith('=')) { const n = parseNum(s); return n == null ? s : n; }
      const toks = tokenize(s.slice(1));
      let p = 0;
      const peek = () => toks[p];
      const take = (v) => { const t = toks[p]; if (!t || (v && t.v !== v)) throw new SheetError('#ERROR!'); p++; return t; };
      function expr() { return compare(); }
      function compare() {
        let a = concat();
        const t = peek();
        if (t && t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
          p++;
          const b = concat();
          const x = scalar(a), y = scalar(b);
          const bothNum = typeof x === 'number' && typeof y === 'number';
          const L = bothNum ? x : String(x).toLowerCase(), R = bothNum ? y : String(y).toLowerCase();
          a = { '=': L === R, '<>': L !== R, '<': L < R, '>': L > R, '<=': L <= R, '>=': L >= R }[t.v] ? 1 : 0;
        }
        return a;
      }
      function concat() {
        let a = add();
        while (peek() && peek().v === '&') { p++; a = String(scalar(a)) + String(scalar(add())); }
        return a;
      }
      function add() {
        let a = mul();
        while (peek() && (peek().v === '+' || peek().v === '-')) { const op = take().v; const b = mul(); a = op === '+' ? toNum(scalar(a)) + toNum(scalar(b)) : toNum(scalar(a)) - toNum(scalar(b)); }
        return a;
      }
      function mul() {
        let a = pow();
        while (peek() && (peek().v === '*' || peek().v === '/')) {
          const op = take().v; const b = toNum(scalar(pow()));
          if (op === '/' && b === 0) throw new SheetError('#DIV/0!');
          a = op === '*' ? toNum(scalar(a)) * b : toNum(scalar(a)) / b;
        }
        return a;
      }
      function pow() {
        const a = unary();
        if (peek() && peek().v === '^') { p++; return Math.pow(toNum(scalar(a)), toNum(scalar(unary()))); }
        return a;
      }
      function unary() {
        if (peek() && peek().v === '-') { p++; return -toNum(scalar(unary())); }
        if (peek() && peek().v === '+') { p++; return toNum(scalar(unary())); }
        return primary();
      }
      function primary() {
        const t = peek();
        if (!t) throw new SheetError('#ERROR!');
        if (t.t === 'num') { p++; return t.v; }
        if (t.t === 'str') { p++; return t.v; }
        if (t.t === 'ref') { p++; const v = cellValue(t.rc[0], t.rc[1]); return v === '' ? 0 : v; }
        if (t.t === 'range') {
          p++;
          const r1 = Math.min(t.a[0], t.b[0]), r2 = Math.max(t.a[0], t.b[0]);
          const c1 = Math.min(t.a[1], t.b[1]), c2 = Math.max(t.a[1], t.b[1]);
          if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_R * MAX_C) throw new SheetError('#REF!');
          const out = [];
          for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cellValue(r, c));
          return out;
        }
        if (t.t === 'name') {
          p++;
          const name = ALIAS[t.v] || t.v;
          if (name === 'TRUE' || name === 'BENAR') return 1;
          if (name === 'FALSE' || name === 'SALAH') return 0;
          if (!FN[name] || !peek() || peek().v !== '(') throw new SheetError('#NAME?');
          take('(');
          const args = [];
          if (peek() && peek().v !== ')') {
            args.push(expr());
            while (peek() && peek().v === ',') { p++; args.push(expr()); }
          }
          take(')');
          return FN[name](args);
        }
        if (t.v === '(') { p++; const v = expr(); take(')'); return v; }
        throw new SheetError('#ERROR!');
      }
      const v = expr();
      if (p < toks.length) throw new SheetError('#ERROR!');
      if (Array.isArray(v)) throw new SheetError('#VALUE!');
      return v;
    }
    return {
      get(r, c) { try { return cellValue(r, c); } catch (e) { return isErr(e) ? e : new SheetError('#ERROR!'); } }
    };
  }

  function display(v, idFmt) {
    if (isErr(v)) return v.code;
    if (typeof v === 'number') {
      const n = Math.round(v * 1e6) / 1e6;
      return idFmt ? n.toLocaleString('id-ID', { maximumFractionDigits: 4 }) : String(n);
    }
    return String(v == null ? '' : v);
  }

  /* ============================ impor ============================ */
  function parseDelimited(text) {
    const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const first = src.split('\n')[0] || '';
    const delim = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = [];
    let cur = [''], inQ = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQ) {
        if (ch === '"') { if (src[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else inQ = false; }
        else cur[cur.length - 1] += ch;
      } else if (ch === '"' && cur[cur.length - 1] === '') inQ = true;
      else if (ch === delim) cur.push('');
      else if (ch === '\n') { rows.push(cur); cur = ['']; }
      else cur[cur.length - 1] += ch;
    }
    rows.push(cur);
    return rows;
  }
  function tableToGrid(table) {
    const rows = [...table.rows].map(tr => [...tr.cells].map(td => (td.innerText || td.textContent || '').replace(/\s+/g, ' ').trim()));
    const head = !!(table.rows[0] && table.rows[0].cells[0] && table.rows[0].cells[0].tagName === 'TH');
    return { rows, head };
  }

  /* ============================ dialog ============================ */
  function open(o) {
    const opts = o || {};
    let grid = [];
    let rows = 6, cols = 4;
    let sel = [0, 0];
    let head = true, idFmt = true, alignNum = true;
    const replacing = !!opts.table;
    const ensure = (r, c) => {
      rows = Math.min(MAX_R, Math.max(rows, r));
      cols = Math.min(MAX_C, Math.max(cols, c));
      for (let i = 0; i < rows; i++) { grid[i] = grid[i] || []; for (let j = 0; j < cols; j++) if (grid[i][j] == null) grid[i][j] = ''; }
      grid.length = rows; grid.forEach(rw => { rw.length = cols; });
    };
    if (replacing) {
      const t = tableToGrid(opts.table);
      grid = t.rows.map(r => r.slice(0, MAX_C)).slice(0, MAX_R);
      head = t.head;
      ensure(grid.length || 1, Math.max(1, ...grid.map(r => r.length)));
      rows = grid.length; cols = grid[0].length;
    } else {
      grid = [['Nama', 'Nilai', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']];
    }

    const body = `<div class="sh">
      <div class="sh-bar">
        <span class="sh-addr" id="shAddr" aria-live="polite">A1</span>
        <label class="sr-only" for="shFx">Isi sel atau rumus</label>
        <input id="shFx" class="sh-fx" autocomplete="off" spellcheck="false" placeholder="Isi sel, atau rumus mis. =SUM(B2:B6)" />
      </div>
      <div class="sh-grid-wrap" id="shWrap"></div>
      <div class="sh-tools">
        <div class="sh-btns">
          <button type="button" class="btn btn-sm btn-secondary" data-sh="addRow">＋ Baris</button>
          <button type="button" class="btn btn-sm btn-secondary" data-sh="delRow">− Baris</button>
          <button type="button" class="btn btn-sm btn-secondary" data-sh="addCol">＋ Kolom</button>
          <button type="button" class="btn btn-sm btn-secondary" data-sh="delCol">− Kolom</button>
          <button type="button" class="btn btn-sm btn-secondary" data-sh="sum">Σ Baris total</button>
          <label class="btn btn-sm btn-secondary sh-file">Impor Excel/CSV<input type="file" id="shFile" accept=".xlsx,.xls,.csv,.tsv,.txt" /></label>
          <button type="button" class="btn btn-sm btn-ghost" data-sh="clear">Kosongkan</button>
        </div>
        <div class="sh-opts">
          <label class="qe-check"><input type="checkbox" id="shHead" ${head ? 'checked' : ''} /> Baris pertama sebagai judul</label>
          <label class="qe-check"><input type="checkbox" id="shId" checked /> Hasil rumus berformat Indonesia (1.234,5)</label>
          <label class="qe-check"><input type="checkbox" id="shAlign" checked /> Rata kanan untuk angka</label>
        </div>
      </div>
      <details class="sh-help"><summary>Rumus yang didukung</summary>
        <p class="muted small">Awali dengan <code>=</code>. Contoh: <code>=B2*C2</code>, <code>=SUM(B2:B6)</code>, <code>=AVERAGE(B2:B6)</code>,
        <code>=ROUND(B7/3;2)</code>, <code>=IF(B2>=75;"Lulus";"Remedial")</code>. Fungsi: SUM/JUMLAH, AVERAGE/RATA, MIN, MAX, COUNT/CACAH, ROUND, ABS, IF/JIKA.
        Tempel sel dari Excel atau Google Sheets langsung ke sel mana pun. Yang tersimpan di dokumen adalah hasil hitungnya.</p></details>
      <div class="sh-prev-head muted small">Pratinjau</div>
      <div class="sh-prev rt-content" id="shPrev"></div>
      <div class="sh-err small" id="shErr" role="alert" hidden></div>
      <div class="sh-foot">
        <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
        <button type="button" class="btn btn-primary" data-ok>${replacing ? 'Perbarui tabel' : 'Sisipkan tabel'}</button>
      </div>
    </div>`;

    Editor.openSubDialog(replacing ? 'Lembar Data — sunting tabel' : 'Lembar Data (ala Excel)', body, (back, close) => {
      const dlg = back.querySelector('.qe-dialog');
      if (dlg) dlg.classList.add('is-wide');
      const wrap = back.querySelector('#shWrap');
      const fx = back.querySelector('#shFx');
      const addr = back.querySelector('#shAddr');
      const prev = back.querySelector('#shPrev');
      const errEl = back.querySelector('#shErr');
      let calc = engine(grid);
      const showErr = (m) => { errEl.hidden = !m; errEl.textContent = m || ''; };

      function cellInput(r, c) { return wrap.querySelector(`input[data-r="${r}"][data-c="${c}"]`); }
      function shown(r, c) {
        const raw = grid[r] && grid[r][c] != null ? grid[r][c] : '';
        return String(raw).startsWith('=') ? display(calc.get(r, c), idFmt) : raw;
      }
      function paintGrid() {
        wrap.innerHTML = `<table class="sh-grid" role="grid" aria-label="Lembar data">
          <thead><tr><th class="sh-corner" aria-hidden="true"></th>${Array.from({ length: cols }, (_, c) => `<th scope="col">${colName(c)}</th>`).join('')}</tr></thead>
          <tbody>${grid.map((rw, r) => `<tr><th scope="row">${r + 1}</th>${rw.map((v, c) => {
            const isF = String(v).startsWith('=');
            return `<td class="${r === 0 && head ? 'is-head' : ''} ${isF ? 'is-fx' : ''}"><input data-r="${r}" data-c="${c}" value="${esc(shown(r, c))}"
              aria-label="Sel ${colName(c)}${r + 1}" autocomplete="off" spellcheck="false" /></td>`;
          }).join('')}</tr>`).join('')}</tbody></table>`;
        bindGrid();
      }
      function refreshValues(except) {
        calc = engine(grid);
        wrap.querySelectorAll('input[data-r]').forEach(inp => {
          if (inp === except) return;
          const r = Number(inp.dataset.r), c = Number(inp.dataset.c);
          inp.value = shown(r, c);
          inp.parentElement.classList.toggle('is-fx', String(grid[r][c]).startsWith('='));
          inp.parentElement.classList.toggle('is-err', String(grid[r][c]).startsWith('=') && isErr(calc.get(r, c)));
        });
        paintPreview();
      }
      function select(r, c, focus) {
        sel = [Math.max(0, Math.min(rows - 1, r)), Math.max(0, Math.min(cols - 1, c))];
        addr.textContent = colName(sel[1]) + (sel[0] + 1);
        fx.value = grid[sel[0]][sel[1]];
        wrap.querySelectorAll('td.is-sel').forEach(td => td.classList.remove('is-sel'));
        const inp = cellInput(sel[0], sel[1]);
        if (inp) { inp.parentElement.classList.add('is-sel'); if (focus) inp.focus(); }
      }
      function bindGrid() {
        wrap.querySelectorAll('input[data-r]').forEach(inp => {
          const r = Number(inp.dataset.r), c = Number(inp.dataset.c);
          inp.addEventListener('focus', () => { inp.value = grid[r][c]; select(r, c, false); inp.select(); });
          // Sel lama yang terlepas dari DOM (setelah impor/tambah kolom) diabaikan.
          inp.addEventListener('blur', () => { if (inp.isConnected) inp.value = shown(r, c); });
          inp.addEventListener('input', () => { grid[r][c] = inp.value; fx.value = inp.value; refreshValues(inp); });
          inp.addEventListener('keydown', (e) => {
            const atStart = inp.selectionStart === 0 && inp.selectionEnd === 0;
            const atEnd = inp.selectionStart === inp.value.length;
            if (e.key === 'Enter') { e.preventDefault(); if (r === rows - 1 && rows < MAX_R) { addRow(); } select(r + 1, c, true); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); select(r + 1, c, true); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); select(r - 1, c, true); }
            else if (e.key === 'ArrowLeft' && atStart) { e.preventDefault(); select(r, c - 1, true); }
            else if (e.key === 'ArrowRight' && atEnd) { e.preventDefault(); select(r, c + 1, true); }
          });
          inp.addEventListener('paste', (e) => {
            const text = (e.clipboardData || global.clipboardData).getData('text');
            if (!/[\t\n]/.test(text)) return;
            e.preventDefault();
            fillFrom(r, c, parseDelimited(text));
          });
        });
      }
      function fillFrom(r0, c0, data) {
        const needR = Math.min(MAX_R, r0 + data.length), needC = Math.min(MAX_C, c0 + Math.max(...data.map(d => d.length)));
        const cut = data.length + r0 > MAX_R || Math.max(...data.map(d => d.length)) + c0 > MAX_C;
        ensure(needR, needC);
        data.forEach((rw, i) => rw.forEach((v, j) => { if (r0 + i < MAX_R && c0 + j < MAX_C) grid[r0 + i][c0 + j] = String(v == null ? '' : v).trim(); }));
        paintGrid(); refreshValues(); select(r0, c0, false);
        showErr(cut ? `Data dipotong ke batas ${MAX_R} baris × ${MAX_C} kolom.` : '');
      }
      function addRow() { if (rows >= MAX_R) { showErr(`Maksimal ${MAX_R} baris.`); return; } ensure(rows + 1, cols); paintGrid(); refreshValues(); }

      function tableHtml() {
        const rowsOut = grid.filter((rw, i) => i === 0 || rw.some(v => String(v).trim() !== ''));
        const lastNonEmptyCol = Math.max(0, ...grid.map(rw => rw.reduce((m, v, j) => (String(v).trim() !== '' ? j : m), -1)));
        const nc = lastNonEmptyCol + 1;
        const tr = (rw, r, isHead) => '<tr>' + rw.slice(0, nc).map((_, c) => {
          const v = calc.get(r, c);
          // Nilai ketikan disimpan apa adanya (tahun "2024" tidak jadi "2.024"); hanya hasil rumus yang diformat.
          const txt = String(grid[r][c]).startsWith('=') ? display(v, idFmt) : String(grid[r][c]).trim();
          const numeric = !isHead && (typeof v === 'number') && alignNum;
          return isHead ? `<th>${esc(txt)}</th>` : `<td${numeric ? ' style="text-align:right"' : ''}>${esc(txt) || '&nbsp;'}</td>`;
        }).join('') + '</tr>';
        let html = '<table class="rte-table">';
        rowsOut.forEach((rw) => {
          const r = grid.indexOf(rw);
          html += tr(rw, r, head && r === 0);
        });
        return html + '</table>';
      }
      function paintPreview() {
        const hasData = grid.some(rw => rw.some(v => String(v).trim() !== ''));
        prev.innerHTML = hasData ? tableHtml() : '<span class="muted small">Isi beberapa sel untuk melihat pratinjau.</span>';
      }

      fx.addEventListener('input', () => {
        grid[sel[0]][sel[1]] = fx.value;
        const inp = cellInput(sel[0], sel[1]);
        if (inp) inp.value = shown(sel[0], sel[1]);
        refreshValues();
      });
      fx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); select(sel[0] + 1, sel[1], true); } });
      back.querySelectorAll('[data-sh]').forEach(b => b.addEventListener('click', () => {
        showErr('');
        const a = b.dataset.sh;
        if (a === 'addRow') addRow();
        else if (a === 'delRow') { if (rows > 1) { grid.splice(sel[0], 1); rows--; ensure(rows, cols); paintGrid(); refreshValues(); select(Math.min(sel[0], rows - 1), sel[1]); } }
        else if (a === 'addCol') { if (cols >= MAX_C) { showErr(`Maksimal ${MAX_C} kolom.`); return; } ensure(rows, cols + 1); paintGrid(); refreshValues(); }
        else if (a === 'delCol') { if (cols > 1) { grid.forEach(rw => rw.splice(sel[1], 1)); cols--; ensure(rows, cols); paintGrid(); refreshValues(); select(sel[0], Math.min(sel[1], cols - 1)); } }
        else if (a === 'sum') {
          // Baris total: SUM untuk setiap kolom yang berisi angka
          const firstData = head ? 1 : 0;
          let last = rows - 1;
          while (last >= firstData && grid[last].every(v => String(v).trim() === '')) last--;
          if (last < firstData) { showErr('Isi data terlebih dahulu.'); return; }
          const target = last + 1;
          if (target >= MAX_R) { showErr(`Maksimal ${MAX_R} baris.`); return; }
          ensure(Math.max(rows, target + 1), cols);
          const cTotal = engine(grid);
          grid[target] = grid[target].map((_, c) => {
            const hasNum = Array.from({ length: last - firstData + 1 }, (__, k) => cTotal.get(firstData + k, c)).some(v => typeof v === 'number');
            return c === 0 && !hasNum ? 'Total' : (hasNum ? `=SUM(${colName(c)}${firstData + 1}:${colName(c)}${last + 1})` : '');
          });
          paintGrid(); refreshValues(); select(target, 0, false);
        }
        else if (a === 'clear') { if (UI.confirmDialog('Kosongkan semua sel?')) { grid = grid.map(rw => rw.map(() => '')); paintGrid(); refreshValues(); } }
      }));
      back.querySelector('#shHead').addEventListener('change', (e) => { head = e.target.checked; paintGrid(); refreshValues(); });
      back.querySelector('#shId').addEventListener('change', (e) => { idFmt = e.target.checked; refreshValues(); });
      back.querySelector('#shAlign').addEventListener('change', (e) => { alignNum = e.target.checked; paintPreview(); });
      back.querySelector('#shFile').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { showErr('Berkas maksimal 5 MB.'); return; }
        try {
          if (!global.Office) throw new Error('Modul impor belum termuat. Muat ulang halaman.');
          const data = (await Office.readTableFile(f)).filter(rw => rw.some(v => String(v).trim() !== ''));
          if (!data.length) throw new Error('Berkas tidak berisi data.');
          grid = [['']]; rows = 1; cols = 1;
          fillFrom(0, 0, data);
        } catch (err) { showErr(err.message || 'Berkas tidak dapat dibaca.'); }
      });
      back.querySelector('[data-cancel]').addEventListener('click', close);
      back.querySelector('[data-ok]').addEventListener('click', () => {
        if (!grid.some(rw => rw.some(v => String(v).trim() !== ''))) { showErr('Lembar masih kosong.'); return; }
        const html = tableHtml() + '<p><br></p>';
        close();
        if (replacing && typeof opts.onReplace === 'function') opts.onReplace(tableHtml());
        else if (typeof opts.onInsert === 'function') opts.onInsert(html);
      });

      ensure(rows, cols);
      paintGrid();
      refreshValues();
      select(0, 0, true);
    }, { anchor: opts.anchor || null });
  }

  global.Sheet = { open, engine, parseNum, parseDelimited, display };
})(window);
