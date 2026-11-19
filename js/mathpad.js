/* =========================================================================
 * MathPad — editor rumus matematika (LaTeX) untuk soal, pembahasan, dan chat.
 *
 * Dua mode:
 *   - LaTeX (bawaan): kotak teks + toolbar kategori simbol, autocomplete,
 *     template, pratinjau langsung, riwayat. Bekerja tanpa jaringan.
 *   - Visual (MathLive): editor WYSIWYG, dimuat malas dari CDN saat tab
 *     dibuka. Bila CDN tidak terjangkau, pesan galat tampil dan mode LaTeX
 *     tetap dapat dipakai.
 *
 * API:  MathPad.open({ initial, display, anchor, onInsert(latex, isBlock) })
 * =======================================================================*/
(function (global) {
  'use strict';

  const HIST_KEY = 'lms_mathpad_hist';      // hanya cache preferensi pribadi
  const HIST_MAX = 12;
  const MATHLIVE_URL = 'https://cdn.jsdelivr.net/npm/mathlive@0/dist/mathlive.min.js';

  const esc = (s) => RichText.esc(s);

  /* Kategori toolbar. Item: [snippet, tampilan, judul]. "{}" = tempat isi;
   * kursor dan tombol Tab melompat ke "{}" kosong berikutnya. */
  const CATS = [
    { id: 'frac', name: 'Pecahan & Akar', items: [
      ['\\frac{}{}', 'a/b', 'Pecahan'], ['\\sqrt{}', '√x', 'Akar kuadrat'],
      ['\\sqrt[{}]{}', 'ⁿ√x', 'Akar pangkat n'], ['\\binom{}{}', '(n k)', 'Kombinasi'],
      ['\\dfrac{}{}', 'a/b', 'Pecahan besar'], ['\\%', '%', 'Persen']] },
    { id: 'pow', name: 'Pangkat & Indeks', items: [
      ['^{}', 'xⁿ', 'Pangkat'], ['_{}', 'xₙ', 'Indeks bawah'], ['_{}^{}', 'xₙᵐ', 'Indeks dan pangkat'],
      ['^{2}', 'x²', 'Kuadrat'], ['^{3}', 'x³', 'Kubik'], ['\\overline{}', 'x̄', 'Garis atas'],
      ['\\vec{}', 'x⃗', 'Vektor'], ['\\hat{}', 'x̂', 'Topi']] },
    { id: 'calc', name: 'Kalkulus', items: [
      ['\\int_{}^{} {} \\, dx', '∫', 'Integral tentu'], ['\\int {} \\, dx', '∫', 'Integral tak tentu'],
      ['\\lim_{x \\to {}} {}', 'lim', 'Limit'], ['\\sum_{i=1}^{n} {}', '∑', 'Sigma'],
      ['\\prod_{i=1}^{n} {}', '∏', 'Perkalian'], ['\\frac{d}{dx}{}', 'd/dx', 'Turunan'],
      ['\\frac{\\partial {}}{\\partial {}}', '∂/∂x', 'Turunan parsial'], ['\\infty', '∞', 'Tak hingga']] },
    { id: 'mat', name: 'Matriks', items: [
      ['\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}', '( )', 'Matriks 2×2 kurung'],
      ['\\begin{bmatrix} {} & {} \\\\ {} & {} \\end{bmatrix}', '[ ]', 'Matriks 2×2 siku'],
      ['\\begin{vmatrix} {} & {} \\\\ {} & {} \\end{vmatrix}', '| |', 'Determinan 2×2'],
      ['\\begin{pmatrix} {} & {} & {} \\\\ {} & {} & {} \\\\ {} & {} & {} \\end{pmatrix}', '3×3', 'Matriks 3×3'],
      ['\\begin{cases} {} & {} \\\\ {} & {} \\end{cases}', '{ ', 'Sistem / kasus']] },
    { id: 'greek', name: 'Huruf Yunani', items: [
      ['\\alpha', 'α', 'alfa'], ['\\beta', 'β', 'beta'], ['\\gamma', 'γ', 'gamma'], ['\\delta', 'δ', 'delta'],
      ['\\epsilon', 'ε', 'epsilon'], ['\\theta', 'θ', 'theta'], ['\\lambda', 'λ', 'lambda'], ['\\mu', 'μ', 'mu'],
      ['\\pi', 'π', 'pi'], ['\\rho', 'ρ', 'rho'], ['\\sigma', 'σ', 'sigma'], ['\\tau', 'τ', 'tau'],
      ['\\phi', 'φ', 'phi'], ['\\omega', 'ω', 'omega'], ['\\Delta', 'Δ', 'Delta'], ['\\Sigma', 'Σ', 'Sigma'],
      ['\\Omega', 'Ω', 'Omega'], ['\\Phi', 'Φ', 'Phi']] },
    { id: 'op', name: 'Operator & Relasi', items: [
      ['\\times', '×', 'Kali'], ['\\div', '÷', 'Bagi'], ['\\pm', '±', 'Plus minus'], ['\\cdot', '⋅', 'Titik'],
      ['\\neq', '≠', 'Tidak sama'], ['\\leq', '≤', 'Kurang dari sama dengan'], ['\\geq', '≥', 'Lebih dari sama dengan'],
      ['\\approx', '≈', 'Hampir sama'], ['\\equiv', '≡', 'Kongruen'], ['\\to', '→', 'Panah'],
      ['\\Rightarrow', '⇒', 'Maka'], ['\\Leftrightarrow', '⇔', 'Jika dan hanya jika'],
      ['\\degree', '°', 'Derajat'], ['\\sim', '∼', 'Sebanding']] },
    { id: 'set', name: 'Himpunan & Logika', items: [
      ['\\in', '∈', 'Anggota'], ['\\notin', '∉', 'Bukan anggota'], ['\\subset', '⊂', 'Himpunan bagian'],
      ['\\subseteq', '⊆', 'Bagian atau sama'], ['\\cup', '∪', 'Gabungan'], ['\\cap', '∩', 'Irisan'],
      ['\\emptyset', '∅', 'Himpunan kosong'], ['\\forall', '∀', 'Untuk semua'], ['\\exists', '∃', 'Ada'],
      ['\\land', '∧', 'Dan'], ['\\lor', '∨', 'Atau'], ['\\neg', '¬', 'Negasi'],
      ['\\mathbb{R}', 'ℝ', 'Bilangan real'], ['\\mathbb{N}', 'ℕ', 'Bilangan asli'],
      ['\\mathbb{Z}', 'ℤ', 'Bilangan bulat'], ['\\mathbb{Q}', 'ℚ', 'Bilangan rasional']] },
    { id: 'fn', name: 'Fungsi', items: [
      ['\\sin', 'sin', 'sinus'], ['\\cos', 'cos', 'cosinus'], ['\\tan', 'tan', 'tangen'],
      ['\\log_{}', 'log', 'Logaritma'], ['\\ln', 'ln', 'Logaritma natural'], ['\\left| {} \\right|', '|x|', 'Nilai mutlak'],
      ['\\left( {} \\right)', '( )', 'Kurung menyesuaikan'], ['\\text{}', 'abc', 'Teks biasa']] }
  ];

  /* Template siap pakai. */
  const TEMPLATES = [
    ['Persamaan kuadrat', 'ax^2 + bx + c = 0'],
    ['Rumus ABC', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
    ['Teorema Pythagoras', 'a^2 + b^2 = c^2'],
    ['Turunan', "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}"],
    ['Integral tentu', '\\int_{a}^{b} f(x) \\, dx = F(b) - F(a)'],
    ['Determinan 2×2', '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc'],
    ['Matriks 2×2', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
    ['Deret aritmetika', 'S_n = \\frac{n}{2}\\left(2a + (n-1)b\\right)'],
    ['Sigma', '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}'],
    ['Limit trigonometri', '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'],
    ['Luas lingkaran', 'L = \\pi r^2'],
    ['Hukum II Newton', 'F = m \\cdot a'],
    ['Energi kinetik', 'E_k = \\frac{1}{2} m v^2'],
    ['Reaksi kimia', '\\ce{2H2 + O2 -> 2H2O}']
  ];

  /* Perintah untuk autocomplete: [ketik, sisipkan, keterangan] */
  const AC_BASE = [
    ['\\frac', '\\frac{}{}', 'pecahan'], ['\\dfrac', '\\dfrac{}{}', 'pecahan besar'],
    ['\\sqrt', '\\sqrt{}', 'akar'], ['\\binom', '\\binom{}{}', 'kombinasi'],
    ['\\sum', '\\sum_{i=1}^{n} {}', 'sigma'], ['\\int', '\\int_{}^{} {} \\, dx', 'integral'],
    ['\\lim', '\\lim_{x \\to {}} {}', 'limit'], ['\\prod', '\\prod_{i=1}^{n} {}', 'perkalian'],
    ['\\text', '\\text{}', 'teks'], ['\\mathbb', '\\mathbb{}', 'huruf papan tulis'],
    ['\\overline', '\\overline{}', 'garis atas'], ['\\vec', '\\vec{}', 'vektor'],
    ['\\begin', '\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}', 'matriks'],
    ['\\left', '\\left( {} \\right)', 'kurung menyesuaikan'], ['\\ce', '\\ce{}', 'rumus kimia']
  ];

  /* ---------------------------- util ---------------------------------- */
  function loadHist() {
    try {
      const a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      return Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, HIST_MAX) : [];
    } catch (e) { return []; }
  }
  function pushHist(latex) {
    const v = String(latex || '').trim();
    if (!v) return;
    const a = loadHist().filter(x => x !== v);
    a.unshift(v);
    try { localStorage.setItem(HIST_KEY, JSON.stringify(a.slice(0, HIST_MAX))); } catch (e) { /* kuota penuh */ }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('copy'));
    });
  }

  function toast(msg, type) { if (global.UI && UI.toast) UI.toast(msg, type || 'info'); }

  function acList() {
    const seen = {};
    const list = AC_BASE.slice();
    list.forEach(x => { seen[x[0]] = 1; });
    Object.keys((global.MathFmt && MathFmt.SYMBOLS) || {}).forEach(k => {
      if (!seen['\\' + k]) list.push(['\\' + k, '\\' + k, MathFmt.SYMBOLS[k]]);
    });
    return list;
  }

  /* ---------------------------- dialog -------------------------------- */
  function open(opts) {
    const o = opts || {};
    if (!global.Editor || !Editor.openSubDialog) { toast('Editor rumus belum siap.', 'error'); return; }
    const AC = acList();

    const body = `
      <div class="mpd" data-mpd>
        <div class="mpd-tabs" role="tablist">
          <button type="button" class="mpd-tab is-on" role="tab" aria-selected="true" data-tab="latex">LaTeX</button>
          <button type="button" class="mpd-tab" role="tab" aria-selected="false" data-tab="visual">Visual</button>
        </div>

        <div class="mpd-cats" role="tablist" aria-label="Kategori simbol">
          ${CATS.map((c, i) => `<button type="button" class="mpd-cat${i === 0 ? ' is-on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
        </div>
        <div class="mpd-keys" data-keys></div>

        <div class="mpd-pane" data-pane="latex">
          <label class="mpd-label" for="mpSrc">Kode LaTeX <span class="mpd-hint">Tab = ke isian berikutnya, Ctrl+Enter = sisipkan</span></label>
          <div class="mpd-src-wrap">
            <textarea id="mpSrc" class="mpd-src" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off"
              placeholder="Contoh: \\frac{a}{b}"></textarea>
            <ul class="mpd-ac" data-ac hidden role="listbox" aria-label="Saran perintah"></ul>
          </div>
        </div>
        <div class="mpd-pane" data-pane="visual" hidden>
          <div class="mpd-visual" data-visual></div>
        </div>

        <div class="mpd-prevhead"><span class="mpd-label">Pratinjau</span>
          <label class="mpd-check"><input type="checkbox" data-block /> Rumus blok (baris sendiri)</label></div>
        <div class="mpd-preview" data-preview aria-live="polite"></div>
        <div class="mpd-error" data-error role="alert" hidden></div>

        <details class="mpd-more">
          <summary>Template, riwayat, dan referensi</summary>
          <div class="mpd-sec"><div class="mpd-label">Template siap pakai</div>
            <div class="mpd-chips" data-templates>${TEMPLATES.map((t, i) =>
              `<button type="button" class="mpd-chip" data-tpl="${i}">${esc(t[0])}</button>`).join('')}</div></div>
          <div class="mpd-sec"><div class="mpd-label">Riwayat rumus (di perangkat ini)</div>
            <div class="mpd-chips" data-history></div></div>
          <div class="mpd-sec"><div class="mpd-label">Referensi</div>
            <ul class="mpd-links">
              <li><a href="https://katex.org/docs/supported" target="_blank" rel="noopener noreferrer">Daftar perintah yang didukung KaTeX</a></li>
              <li><a href="https://katex.org/docs/support_table" target="_blank" rel="noopener noreferrer">Tabel dukungan fungsi</a></li>
              <li><a href="https://en.wikibooks.org/wiki/LaTeX/Mathematics" target="_blank" rel="noopener noreferrer">Panduan matematika LaTeX (Wikibooks)</a></li>
              <li><a href="https://mathpix.com/image-to-latex" target="_blank" rel="noopener noreferrer">Konverter gambar ke LaTeX (Mathpix, layanan pihak ketiga)</a></li>
            </ul>
            <p class="mpd-hint">Pintasan: Alt+1 pecahan, Alt+2 akar, Alt+3 pangkat, Alt+4 indeks, Alt+5 sigma, Alt+6 integral, Alt+7 limit, Alt+8 matriks.</p>
          </div>
        </details>

        <div class="mpd-actions">
          <button type="button" class="btn btn-secondary" data-copy>Salin LaTeX</button>
          <span class="mpd-spacer"></span>
          <button type="button" class="btn btn-secondary" data-cancel>Batal</button>
          <button type="button" class="btn btn-primary" data-ok>Sisipkan</button>
        </div>
      </div>`;

    Editor.openSubDialog('Editor Rumus', body, (back, close) => {
      const $ = (s) => back.querySelector(s);
      const src = $('#mpSrc');
      const keys = $('[data-keys]');
      const prev = $('[data-preview]');
      const errEl = $('[data-error]');
      const block = $('[data-block]');
      const acEl = $('[data-ac]');
      const okBtn = $('[data-ok]');
      let mode = 'latex';
      let mf = null;               // elemen <math-field>
      let acItems = [];
      let acIdx = 0;

      block.checked = !!o.display;
      src.value = String(o.initial || '');

      /* ----- pratinjau + galat ----- */
      const current = () => (mode === 'visual' && mf ? mf.getValue('latex') : src.value).trim();
      function refresh() {
        const v = current();
        if (!v) {
          prev.innerHTML = '<span class="mpd-empty">Pratinjau rumus akan tampil di sini.</span>';
          errEl.hidden = true;
          okBtn.textContent = 'Sisipkan';
          return;
        }
        let msg = null;
        try { msg = MathFmt.validateLatex(v); } catch (e) { msg = 'Rumus tidak dapat diperiksa.'; }
        try { prev.innerHTML = MathFmt.renderLatex(v, block.checked); }
        catch (e) { prev.innerHTML = '<span class="mpd-empty">Pratinjau gagal ditampilkan.</span>'; msg = msg || 'Rumus tidak dapat ditampilkan.'; }
        errEl.hidden = !msg;
        errEl.textContent = msg || '';
        okBtn.textContent = msg ? 'Sisipkan tetap' : 'Sisipkan';
      }

      /* ----- toolbar kategori ----- */
      function showCat(id) {
        const c = CATS.find(x => x.id === id) || CATS[0];
        back.querySelectorAll('.mpd-cat').forEach(b => b.classList.toggle('is-on', b.dataset.cat === c.id));
        keys.innerHTML = c.items.map((it, i) =>
          `<button type="button" class="mpd-key" data-i="${i}" title="${esc(it[2])}" aria-label="${esc(it[2])}">${esc(it[1])}</button>`).join('');
        keys.dataset.cat = c.id;
      }
      showCat(CATS[0].id);
      back.querySelectorAll('.mpd-cat').forEach(b => b.addEventListener('click', () => showCat(b.dataset.cat)));
      keys.addEventListener('click', (e) => {
        const b = e.target.closest('.mpd-key');
        if (!b) return;
        const c = CATS.find(x => x.id === keys.dataset.cat);
        insertSnippet(c.items[Number(b.dataset.i)][0]);
      });

      /* ----- sisip snippet pada kursor ----- */
      function insertSnippet(snip) {
        if (mode === 'visual' && mf) {
          mf.insert(snip.replace(/\{\}/g, '{#?}'), { focus: true });
          refresh();
          return;
        }
        const a = src.selectionStart, b = src.selectionEnd;
        const sel = src.value.slice(a, b);
        let text = snip;
        // Teks terpilih mengisi tempat kosong pertama
        if (sel && text.indexOf('{}') !== -1) text = text.replace('{}', '{' + sel + '}');
        src.setRangeText(text, a, b, 'end');
        const first = text.indexOf('{}');
        if (first !== -1 && !sel) {
          const pos = a + first + 1;
          src.setSelectionRange(pos, pos);
        }
        src.focus();
        refresh();
      }

      /* Tab: lompat ke "{}" kosong berikutnya */
      function jumpNext() {
        const from = src.selectionEnd;
        let p = src.value.indexOf('{}', from);
        if (p === -1) p = src.value.indexOf('{}');          // putar ke awal
        if (p === -1) return false;
        src.setSelectionRange(p + 1, p + 1);
        return true;
      }

      /* ----- autocomplete ----- */
      function acClose() { acEl.hidden = true; acItems = []; src.removeAttribute('aria-activedescendant'); }
      function acUpdate() {
        const pos = src.selectionStart;
        const m = /\\([a-zA-Z]{1,12})$/.exec(src.value.slice(0, pos));
        if (!m) { acClose(); return; }
        const q = '\\' + m[1];
        acItems = AC.filter(x => x[0].startsWith(q) && (x[0] !== q || x[1] !== x[0])).slice(0, 7);
        if (!acItems.length) { acClose(); return; }
        acIdx = 0;
        acEl.innerHTML = acItems.map((x, i) =>
          `<li role="option" id="mpAc${i}" class="mpd-ac-item${i === 0 ? ' is-on' : ''}" data-i="${i}">
             <code>${esc(x[0])}</code><span>${esc(x[2])}</span></li>`).join('');
        acEl.hidden = false;
      }
      function acPick(i) {
        const it = acItems[i];
        if (!it) return;
        const pos = src.selectionStart;
        const m = /\\[a-zA-Z]{1,12}$/.exec(src.value.slice(0, pos));
        const start = pos - (m ? m[0].length : 0);
        const text = it[1];
        src.setRangeText(text, start, pos, 'end');
        const first = text.indexOf('{}');
        if (first !== -1) { const p = start + first + 1; src.setSelectionRange(p, p); }
        acClose();
        refresh();
      }
      acEl.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.mpd-ac-item');
        if (li) { e.preventDefault(); acPick(Number(li.dataset.i)); }
      });

      src.addEventListener('input', () => { refresh(); acUpdate(); });
      src.addEventListener('blur', () => setTimeout(acClose, 120));

      /* ----- keyboard ----- */
      const SHORT = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7 };
      const SHORT_SNIP = ['\\frac{}{}', '\\sqrt{}', '^{}', '_{}', '\\sum_{i=1}^{n} {}',
        '\\int_{}^{} {} \\, dx', '\\lim_{x \\to {}} {}', '\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}'];
      src.addEventListener('keydown', (e) => {
        if (!acEl.hidden && acItems.length) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            acIdx = (acIdx + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
            acEl.querySelectorAll('.mpd-ac-item').forEach((li, i) => li.classList.toggle('is-on', i === acIdx));
            src.setAttribute('aria-activedescendant', 'mpAc' + acIdx);
            return;
          }
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey || e.key === 'Tab') {
            e.preventDefault(); acPick(acIdx); return;
          }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acClose(); return; }
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          if (jumpNext()) e.preventDefault();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); insertNow(); return; }
        if (e.altKey && !e.ctrlKey && !e.metaKey && SHORT[e.code] != null) {
          e.preventDefault();
          insertSnippet(SHORT_SNIP[SHORT[e.code]]);
        }
      });

      /* ----- template & riwayat ----- */
      function setValue(v) {
        if (mode === 'visual' && mf) mf.setValue(v); else src.value = v;
        refresh();
        if (mode === 'latex') src.focus();
      }
      back.querySelectorAll('[data-tpl]').forEach(b =>
        b.addEventListener('click', () => setValue(TEMPLATES[Number(b.dataset.tpl)][1])));
      function renderHistory() {
        const h = loadHist();
        const box = $('[data-history]');
        box.innerHTML = h.length
          ? h.map((x, i) => `<button type="button" class="mpd-chip mpd-chip-code" data-h="${i}" title="${esc(x)}">${esc(x.length > 28 ? x.slice(0, 27) + '…' : x)}</button>`).join('')
          : '<span class="mpd-hint">Belum ada rumus yang disisipkan.</span>';
        box.querySelectorAll('[data-h]').forEach(b => b.addEventListener('click', () => setValue(h[Number(b.dataset.h)])));
      }
      renderHistory();

      /* ----- salin ----- */
      $('[data-copy]').addEventListener('click', () => {
        const v = current();
        if (!v) { toast('Belum ada rumus untuk disalin.', 'info'); return; }
        copyText(v).then(() => toast('Kode LaTeX disalin.', 'success'),
                         () => toast('Gagal menyalin. Pilih teks lalu salin manual.', 'error'));
      });

      /* ----- tab LaTeX / Visual ----- */
      function setMode(next) {
        if (next === mode) return;
        if (next === 'visual') {
          openVisual();
          return;
        }
        if (mf) src.value = mf.getValue('latex');
        mode = 'latex';
        applyTabs();
        refresh();
        src.focus();
      }
      function applyTabs() {
        back.querySelectorAll('.mpd-tab').forEach(t => {
          const on = t.dataset.tab === mode;
          t.classList.toggle('is-on', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        back.querySelectorAll('.mpd-pane').forEach(p => { p.hidden = p.dataset.pane !== mode; });
      }
      back.querySelectorAll('.mpd-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.tab)));

      function openVisual() {
        const host = $('[data-visual]');
        host.innerHTML = '<div class="mpd-loading" role="status">Memuat editor visual…</div>';
        mode = 'visual';
        applyTabs();
        loadMathLive().then(() => {
          if (mode !== 'visual') return;
          if (!mf) {
            mf = document.createElement('math-field');
            mf.className = 'mpd-mf';
            mf.setAttribute('aria-label', 'Editor rumus visual');
            mf.addEventListener('input', refresh);
          }
          host.innerHTML = '';
          host.appendChild(mf);
          mf.setValue(src.value);
          refresh();
          setTimeout(() => mf.focus(), 50);
        }).catch(() => {
          mode = 'latex';
          applyTabs();
          host.innerHTML = '';
          errEl.hidden = false;
          errEl.textContent = 'Editor visual tidak dapat dimuat (perlu koneksi internet). Gunakan mode LaTeX.';
        });
      }

      /* ----- sisipkan ----- */
      function insertNow() {
        const v = current();
        if (!v) { close(); return; }
        pushHist(v);
        close();
        if (typeof o.onInsert === 'function') o.onInsert(v, block.checked);
      }
      okBtn.addEventListener('click', insertNow);
      $('[data-cancel]').addEventListener('click', close);
      block.addEventListener('change', refresh);

      refresh();
      setTimeout(() => src.focus(), 60);
    }, { anchor: o.anchor || null });
  }

  /* Muat MathLive satu kali. */
  let mlPromise = null;
  function loadMathLive() {
    if (global.MathfieldElement || (global.customElements && customElements.get('math-field'))) return Promise.resolve();
    if (mlPromise) return mlPromise;
    mlPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MATHLIVE_URL;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        try { if (global.MathfieldElement) MathfieldElement.soundsDirectory = null; } catch (e) { /* abaikan */ }
        customElements.whenDefined('math-field').then(resolve, reject);
      };
      s.onerror = () => { mlPromise = null; s.remove(); reject(new Error('mathlive')); };
      document.head.appendChild(s);
    });
    return mlPromise;
  }

  global.MathPad = { open, CATS, TEMPLATES };
})(window);
