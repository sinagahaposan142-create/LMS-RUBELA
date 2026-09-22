/* ===== LMS Rubela - Rich Text & LaTeX Renderer =====
 * Dipakai untuk isi soal, opsi jawaban, dan pembahasan.
 *
 * Dua kemampuan utama:
 *  1. MathFmt — merender notasi LaTeX untuk matematika, fisika, dan kimia
 *     TANPA pustaka eksternal (mandiri, tetap jalan offline). Bila KaTeX
 *     tersedia di halaman, KaTeX dipakai agar hasilnya lebih presisi.
 *  2. RichText — membersihkan (sanitize) HTML buatan guru lalu merender
 *     rumus di dalamnya, serta menyematkan gambar/audio/tautan.
 *
 * Keamanan: seluruh HTML dari guru disaring dengan daftar-putih tag/atribut
 * sebelum ditampilkan ke siswa, sehingga tidak bisa menyisipkan skrip.
 */
(function (global) {

  /* =====================================================================
   * 1. Tabel simbol
   * ===================================================================*/
  const SYMBOLS = {
    // Huruf Yunani kecil
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
    tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    // Huruf Yunani besar
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    // Operator & relasi
    times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠',
    approx: '≈', equiv: '≡', sim: '∼', propto: '∝', cong: '≅',
    ll: '≪', gg: '≫', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
    in: '∈', notin: '∉', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
    // Panah
    rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    uparrow: '↑', downarrow: '↓', mapsto: '↦', implies: '⟹', iff: '⟺',
    // Lain-lain
    infty: '∞', partial: '∂', nabla: '∇', prime: '′', degree: '°',
    angle: '∠', perp: '⊥', parallel: '∥', triangle: '△', square: '□',
    therefore: '∴', because: '∵', dots: '…', ldots: '…', cdots: '⋯',
    prod: '∏', coprod: '∐', oint: '∮', surd: '√', checkmark: '✓',
    percent: '%', permil: '‰', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
    aleph: 'ℵ', wp: '℘', circ: '∘', bullet: '∙', star: '⋆',
    // Satuan & notasi fisika yang sering dipakai
    ohm: 'Ω', mho: '℧', micro: 'µ', angstrom: 'Å'
  };

  // Fungsi matematika yang ditulis tegak (roman), bukan miring
  const FUNCTIONS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos',
    'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'dim',
    'gcd', 'lcm', 'max', 'min', 'mod', 'deg', 'arg', 'sgn'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* =====================================================================
   * 2. Parser LaTeX mandiri
   * ===================================================================*/

  /** Ambil satu grup {..} mulai dari posisi i (i menunjuk '{'). */
  function readGroup(src, i) {
    if (src[i] !== '{') {
      // Tanpa kurung: ambil satu karakter (atau satu perintah \cmd)
      if (src[i] === '\\') {
        const m = /^\\([a-zA-Z]+)/.exec(src.slice(i));
        if (m) return { body: m[0], next: i + m[0].length };
      }
      return { body: src[i] || '', next: i + 1 };
    }
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '\\') { j++; continue; }        // lewati karakter ter-escape
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return { body: src.slice(i + 1, j), next: j + 1 };
      }
    }
    return { body: src.slice(i + 1), next: src.length };  // kurung tidak tertutup
  }

  /** Ambil argumen opsional [..] bila ada. */
  function readOptional(src, i) {
    if (src[i] !== '[') return { body: null, next: i };
    const end = src.indexOf(']', i);
    if (end === -1) return { body: null, next: i };
    return { body: src.slice(i + 1, end), next: end + 1 };
  }

  /** Render notasi kimia: H2SO4 -> H₂SO₄, ^{2-} -> superskrip, -> jadi panah. */
  function renderChem(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      // Panah reaksi
      if (src.startsWith('<=>', i)) { out += ' ⇌ '; i += 3; continue; }
      if (src.startsWith('->', i)) { out += ' → '; i += 2; continue; }
      if (src.startsWith('<-', i)) { out += ' ← '; i += 2; continue; }
      // Superskrip eksplisit (muatan ion)
      if (ch === '^') {
        const g = readGroup(src, i + 1);
        out += '<sup>' + esc(g.body) + '</sup>';
        i = g.next;
        continue;
      }
      // Subskrip eksplisit
      if (ch === '_') {
        const g = readGroup(src, i + 1);
        out += '<sub>' + esc(g.body) + '</sub>';
        i = g.next;
        continue;
      }
      // Angka setelah huruf/penutup kurung => jumlah atom (subskrip)
      if (/[0-9]/.test(ch) && i > 0 && /[A-Za-z)\]]/.test(src[i - 1])) {
        let num = '';
        while (i < src.length && /[0-9]/.test(src[i])) { num += src[i]; i++; }
        out += '<sub>' + num + '</sub>';
        continue;
      }
      out += esc(ch);
      i++;
    }
    return '<span class="mf-chem">' + out + '</span>';
  }

  /**
   * Inti renderer: mengubah potongan LaTeX menjadi HTML.
   * Dipanggil rekursif untuk isi grup.
   */
  function toHtml(src) {
    let out = '';
    let i = 0;

    while (i < src.length) {
      const ch = src[i];

      /* ---- Perintah \cmd ---- */
      if (ch === '\\') {
        const m = /^\\([a-zA-Z]+)\*?/.exec(src.slice(i));
        if (!m) {
          // Karakter ter-escape: \{ \} \$ \% \_ \& \#
          const nextCh = src[i + 1];
          if (nextCh) { out += esc(nextCh); i += 2; continue; }
          i++; continue;
        }
        const cmd = m[1];
        let j = i + m[0].length;

        // Lewati satu spasi setelah perintah (konvensi LaTeX)
        const skipSpace = (k) => (src[k] === ' ' ? k + 1 : k);

        switch (cmd) {
          case 'frac':
          case 'dfrac':
          case 'tfrac': {
            const a = readGroup(src, skipSpace(j));
            const b = readGroup(src, skipSpace(a.next));
            out += '<span class="mf-frac"><span class="mf-num">' + toHtml(a.body) +
                   '</span><span class="mf-den">' + toHtml(b.body) + '</span></span>';
            i = b.next;
            continue;
          }
          case 'sqrt': {
            const opt = readOptional(src, skipSpace(j));
            const g = readGroup(src, skipSpace(opt.next));
            out += '<span class="mf-sqrt">' +
                   (opt.body ? '<span class="mf-idx">' + toHtml(opt.body) + '</span>' : '') +
                   '<span class="mf-radsign">√</span><span class="mf-rad">' + toHtml(g.body) + '</span></span>';
            i = g.next;
            continue;
          }
          case 'text':
          case 'textrm':
          case 'textnormal':
          case 'mathrm':
          case 'operatorname': {
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-text">' + esc(g.body) + '</span>';
            i = g.next;
            continue;
          }
          case 'textbf':
          case 'mathbf': {
            const g = readGroup(src, skipSpace(j));
            out += '<strong>' + toHtml(g.body) + '</strong>';
            i = g.next;
            continue;
          }
          case 'textit':
          case 'mathit': {
            const g = readGroup(src, skipSpace(j));
            out += '<em>' + toHtml(g.body) + '</em>';
            i = g.next;
            continue;
          }
          case 'ce': {                       // notasi kimia
            const g = readGroup(src, skipSpace(j));
            out += renderChem(g.body);
            i = g.next;
            continue;
          }
          case 'vec': {
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-vec">' + toHtml(g.body) + '</span>';
            i = g.next;
            continue;
          }
          case 'hat': {
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-hat">' + toHtml(g.body) + '</span>';
            i = g.next;
            continue;
          }
          case 'bar':
          case 'overline': {
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-overline">' + toHtml(g.body) + '</span>';
            i = g.next;
            continue;
          }
          case 'underline': {
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-underline">' + toHtml(g.body) + '</span>';
            i = g.next;
            continue;
          }
          case 'sum':
          case 'int':
          case 'lim':
          case 'prod': {
            const glyph = cmd === 'sum' ? '∑' : (cmd === 'int' ? '∫' : (cmd === 'prod' ? '∏' : 'lim'));
            const isLim = cmd === 'lim';
            let lower = null, upper = null;
            let k = skipSpace(j);
            // Batas bawah/atas dalam urutan apa pun
            for (let pass = 0; pass < 2; pass++) {
              if (src[k] === '_') { const g = readGroup(src, k + 1); lower = g.body; k = g.next; }
              else if (src[k] === '^') { const g = readGroup(src, k + 1); upper = g.body; k = g.next; }
            }
            out += '<span class="mf-op' + (isLim ? ' mf-oplim' : '') + '">' +
                   '<span class="mf-oplimits">' +
                   (upper ? '<span class="mf-up">' + toHtml(upper) + '</span>' : '') +
                   '<span class="mf-glyph">' + (isLim ? 'lim' : glyph) + '</span>' +
                   (lower ? '<span class="mf-low">' + toHtml(lower) + '</span>' : '') +
                   '</span></span>';
            i = k;
            continue;
          }
          case 'left':
          case 'right': {
            // Ukuran pembatas: cukup keluarkan simbolnya
            const d = src[j];
            const map = { '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '.': '' };
            let sym = map[d] != null ? map[d] : '';
            if (d === '\\') {
              const mm = /^\\([a-zA-Z]+)/.exec(src.slice(j));
              if (mm) { sym = SYMBOLS[mm[1]] || ''; j += mm[0].length - 1; }
            }
            out += '<span class="mf-delim">' + esc(sym) + '</span>';
            i = j + 1;
            continue;
          }
          case 'begin':
          case 'end': {
            // Lingkungan tidak didukung penuh: lewati namanya
            const g = readGroup(src, skipSpace(j));
            i = g.next;
            continue;
          }
          case 'quad': out += '<span class="mf-space-q"></span>'; i = j; continue;
          case 'qquad': out += '<span class="mf-space-qq"></span>'; i = j; continue;
          case 'ang': {                       // \ang{90} -> 90°
            const g = readGroup(src, skipSpace(j));
            out += esc(g.body) + '°';
            i = g.next;
            continue;
          }
          case 'unit': {                      // \unit{m/s^2}
            const g = readGroup(src, skipSpace(j));
            out += '<span class="mf-unit">' + toHtml(g.body) + '</span>';
            i = g.next;
            continue;
          }
          default: {
            if (FUNCTIONS.indexOf(cmd) !== -1) {
              out += '<span class="mf-func">' + cmd + '</span>';
              i = j;
              continue;
            }
            if (SYMBOLS[cmd] != null) {
              out += esc(SYMBOLS[cmd]);
              i = j;
              continue;
            }
            // Perintah tak dikenal: tampilkan apa adanya agar penulis sadar
            out += '<span class="mf-unknown">\\' + esc(cmd) + '</span>';
            i = j;
            continue;
          }
        }
      }

      /* ---- Superskrip / subskrip ---- */
      if (ch === '^' || ch === '_') {
        const g = readGroup(src, i + 1);
        const tag = ch === '^' ? 'sup' : 'sub';
        out += '<' + tag + '>' + toHtml(g.body) + '</' + tag + '>';
        i = g.next;
        continue;
      }

      /* ---- Grup polos ---- */
      if (ch === '{') {
        const g = readGroup(src, i);
        out += toHtml(g.body);
        i = g.next;
        continue;
      }

      /* ---- Variabel (huruf tunggal) ditulis miring ---- */
      if (/[a-zA-Z]/.test(ch)) {
        let word = '';
        while (i < src.length && /[a-zA-Z]/.test(src[i])) { word += src[i]; i++; }
        out += '<span class="mf-var">' + esc(word) + '</span>';
        continue;
      }

      /* ---- Sisanya apa adanya ---- */
      out += esc(ch);
      i++;
    }

    return out;
  }

  /** Apakah KaTeX tersedia? (opsional, hanya untuk presisi lebih tinggi) */
  function hasKatex() {
    return !!(global.katex && typeof global.katex.renderToString === 'function');
  }

  /**
   * Render satu ekspresi LaTeX menjadi HTML.
   * @param {string} src  isi rumus (tanpa pembatas $)
   * @param {boolean} display  true = rumus blok (tengah), false = sebaris
   */
  function renderLatex(src, display) {
    const raw = String(src == null ? '' : src);
    if (!raw.trim()) return '';
    if (hasKatex()) {
      try {
        return global.katex.renderToString(raw, {
          displayMode: !!display, throwOnError: false, output: 'html'
        });
      } catch (e) { /* jatuh ke renderer mandiri */ }
    }
    return '<span class="mathfmt' + (display ? ' mf-display' : '') + '">' + toHtml(raw) + '</span>';
  }

  /* =====================================================================
   * 3. Sanitizer HTML (daftar-putih)
   * ===================================================================*/
  const ALLOWED_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, INS: 1,
    SUB: 1, SUP: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, SECTION: 1,
    UL: 1, OL: 1, LI: 1, DL: 1, DT: 1, DD: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, COLGROUP: 1, COL: 1,
    IMG: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, FIGURE: 1, FIGCAPTION: 1,
    A: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1, HR: 1,
    H3: 1, H4: 1, H5: 1, H6: 1, SMALL: 1, MARK: 1, ABBR: 1
  };
  const ALLOWED_ATTRS = {
    href: 1, src: 1, alt: 1, title: 1, colspan: 1, rowspan: 1, span: 1,
    controls: 1, loop: 1, muted: 1, poster: 1, width: 1, height: 1,
    class: 1, style: 1, 'data-latex': 1, start: 1, type: 1, dir: 1, lang: 1
  };
  // Properti CSS aman untuk atribut style
  const ALLOWED_CSS = /^(text-align|font-weight|font-style|text-decoration|color|background-color|width|height|max-width|vertical-align|border|border-collapse|padding|margin|font-size|line-height|white-space)$/;
  const SAFE_URL = /^(https?:|mailto:|tel:|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,|data:audio\/(mpeg|mp3|wav|ogg|webm);base64,|#|\/)/i;

  function safeStyle(value) {
    return String(value).split(';').map(part => {
      const idx = part.indexOf(':');
      if (idx === -1) return '';
      const prop = part.slice(0, idx).trim().toLowerCase();
      const val = part.slice(idx + 1).trim();
      if (!ALLOWED_CSS.test(prop)) return '';
      // Tolak nilai yang bisa memuat sumber luar / ekspresi
      if (/url\s*\(|expression\s*\(|javascript:/i.test(val)) return '';
      return prop + ':' + val;
    }).filter(Boolean).join(';');
  }

  /** Bersihkan HTML dari elemen/atribut berbahaya (anti-XSS). */
  function sanitize(html) {
    const tpl = document.createElement('div');
    tpl.innerHTML = String(html == null ? '' : html);

    const walk = (node) => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 8) { child.remove(); return; }            // komentar
        if (child.nodeType !== 1) return;                                // teks: aman
        const tag = child.tagName;

        if (!ALLOWED_TAGS[tag]) {
          // Tag terlarang: buang elemennya, pertahankan isi teksnya
          const text = document.createTextNode(child.textContent || '');
          child.replaceWith(text);
          return;
        }
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (name.startsWith('on') || !ALLOWED_ATTRS[name]) {
            child.removeAttribute(attr.name);
            return;
          }
          if (name === 'href' || name === 'src') {
            if (!SAFE_URL.test(attr.value.trim())) child.removeAttribute(attr.name);
          } else if (name === 'style') {
            const cleaned = safeStyle(attr.value);
            if (cleaned) child.setAttribute('style', cleaned);
            else child.removeAttribute('style');
          }
        });
        // Tautan selalu dibuka di tab baru dengan aman
        if (tag === 'A' && child.getAttribute('href')) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }
        if (tag === 'IMG') child.setAttribute('loading', 'lazy');
        if (tag === 'AUDIO' || tag === 'VIDEO') child.setAttribute('controls', '');
        walk(child);
      });
    };
    walk(tpl);
    return tpl.innerHTML;
  }

  /* =====================================================================
   * 4. Render rumus di dalam teks/HTML
   * ===================================================================*/
  /**
   * Ganti pembatas rumus menjadi HTML:
   *   $$...$$ atau \[...\]  -> rumus blok
   *   $...$   atau \(...\)  -> rumus sebaris
   * Bekerja pada potongan teks saja (tidak menyentuh tag HTML).
   */
  function renderMathInText(text) {
    let s = String(text == null ? '' : text);
    const out = [];
    let i = 0;

    const pushPlain = (str) => { if (str) out.push(esc(str)); };

    while (i < s.length) {
      // Blok: $$ ... $$
      if (s.startsWith('$$', i)) {
        const end = s.indexOf('$$', i + 2);
        if (end !== -1) {
          out.push(renderLatex(s.slice(i + 2, end), true));
          i = end + 2;
          continue;
        }
      }
      // Blok: \[ ... \]
      if (s.startsWith('\\[', i)) {
        const end = s.indexOf('\\]', i + 2);
        if (end !== -1) {
          out.push(renderLatex(s.slice(i + 2, end), true));
          i = end + 2;
          continue;
        }
      }
      // Sebaris: \( ... \)
      if (s.startsWith('\\(', i)) {
        const end = s.indexOf('\\)', i + 2);
        if (end !== -1) {
          out.push(renderLatex(s.slice(i + 2, end), false));
          i = end + 2;
          continue;
        }
      }
      // Sebaris: $ ... $  (abaikan \$ yang di-escape)
      if (s[i] === '$' && (i === 0 || s[i - 1] !== '\\')) {
        let end = -1;
        for (let k = i + 1; k < s.length; k++) {
          if (s[k] === '$' && s[k - 1] !== '\\') { end = k; break; }
        }
        if (end !== -1 && end > i + 1) {
          out.push(renderLatex(s.slice(i + 1, end), false));
          i = end + 1;
          continue;
        }
      }
      // Kumpulkan teks biasa hingga calon pembatas berikutnya
      let next = s.length;
      ['$', '\\[', '\\('].forEach(tok => {
        const p = s.indexOf(tok, i + 1);
        if (p !== -1 && p < next) next = p;
      });
      pushPlain(s.slice(i, next));
      i = next;
    }
    return out.join('');
  }

  /** Terapkan renderMathInText hanya pada node teks di dalam sebuah elemen. */
  function renderMathInElement(root) {
    const skip = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (skip[node.parentNode && node.parentNode.tagName]) return NodeFilter.FILTER_REJECT;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.mathfmt, .katex')) {
          return NodeFilter.FILTER_REJECT;
        }
        return /[$\\]/.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    targets.forEach(node => {
      const html = renderMathInText(node.nodeValue);
      if (html === esc(node.nodeValue)) return;   // tidak ada rumus
      const span = document.createElement('span');
      span.innerHTML = html;
      node.replaceWith(span);
    });
  }

  /* =====================================================================
   * 5. API utama untuk isi soal
   * ===================================================================*/
  /**
   * Render konten kaya (HTML guru + rumus) menjadi HTML siap tampil.
   * @param {string} content  HTML/teks dari editor
   * @returns {string} HTML yang sudah bersih dan rumusnya dirender
   */
  function render(content) {
    const raw = String(content == null ? '' : content);
    if (!raw.trim()) return '';
    const holder = document.createElement('div');
    // Bila konten polos (bukan HTML), pertahankan baris baru
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(raw);
    holder.innerHTML = looksLikeHtml ? sanitize(raw) : esc(raw).replace(/\n/g, '<br>');
    renderMathInElement(holder);
    return holder.innerHTML;
  }

  /** Render langsung ke sebuah elemen (lebih hemat daripada innerHTML manual). */
  function renderInto(el, content) {
    if (!el) return;
    el.innerHTML = render(content);
  }

  /** Versi teks bersih (untuk ringkasan/daftar) tanpa tag dan tanpa rumus. */
  function plain(content, maxLen) {
    const holder = document.createElement('div');
    holder.innerHTML = sanitize(String(content == null ? '' : content));
    let t = (holder.textContent || '').replace(/\s+/g, ' ').trim();
    // Sederhanakan pembatas rumus agar ringkasan tetap terbaca
    t = t.replace(/\$\$?([^$]*)\$\$?/g, '$1').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    if (maxLen && t.length > maxLen) t = t.slice(0, maxLen).trim() + '…';
    return t;
  }

  /* =====================================================================
   * 6. Penyematan media (gambar / audio / tautan)
   * ===================================================================*/
  /** Deteksi jenis tautan untuk pratinjau. */
  function linkKind(url) {
    const u = String(url || '').trim();
    if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u) || /^data:image\//i.test(u)) return 'image';
    if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(u) || /^data:audio\//i.test(u)) return 'audio';
    if (/(youtube\.com\/watch|youtu\.be\/|vimeo\.com\/)/i.test(u)) return 'video';
    if (/\.(mp4|webm|mov)(\?|$)/i.test(u)) return 'file-video';
    return 'link';
  }

  /** HTML pratinjau untuk sebuah tautan (dipakai editor & tampilan soal). */
  function embedHtml(url, caption) {
    const u = String(url || '').trim();
    if (!u || !SAFE_URL.test(u)) return '';
    const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
    switch (linkKind(u)) {
      case 'image':
        return `<figure class="rt-media"><img src="${esc(u)}" alt="${esc(caption || 'Gambar soal')}" loading="lazy" />${cap}</figure>`;
      case 'audio':
        return `<figure class="rt-media"><audio controls preload="none" src="${esc(u)}"></audio>${cap}</figure>`;
      case 'file-video':
        return `<figure class="rt-media"><video controls preload="none" src="${esc(u)}"></video>${cap}</figure>`;
      case 'video': {
        // Pakai helper embed yang sudah ada bila tersedia
        const embed = (global.Shared && Shared.toEmbedUrl) ? Shared.toEmbedUrl(u) : u;
        return `<figure class="rt-media"><div class="video-wrap"><iframe src="${esc(embed)}" allowfullscreen
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>${cap}</figure>`;
      }
      default:
        return `<p class="rt-link"><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(caption || u)}</a></p>`;
    }
  }

  global.MathFmt = { renderLatex, toHtml, renderChem, hasKatex, SYMBOLS };
  global.RichText = {
    render, renderInto, plain, sanitize, renderMathInText, renderMathInElement,
    embedHtml, linkKind, esc
  };
})(window);
