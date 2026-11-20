/* =========================================================================
 * Office — impor dokumen Word (.docx) dan lembar Excel (.xlsx) tanpa pustaka luar.
 *
 * .docx/.xlsx adalah arsip ZIP berisi XML. Arsip dibaca dari direktori pusatnya,
 * lalu tiap bagian dibuka dengan DecompressionStream('deflate-raw')
 * (Chrome/Edge 80+, Firefox 113+, Safari 16.4+).
 *
 * Word → HTML: paragraf, Judul (Title, Heading 1–3), kutipan, tebal/miring/
 * garis bawah/coret, subskrip/superskrip, perataan, daftar poin & bernomor
 * (bertingkat), tabel (termasuk sel gabungan), tautan, dan gambar PNG/JPG/GIF/
 * WEBP (diperkecil lewat opts.image). Persamaan Word, kotak teks, dan gambar
 * EMF/WMF tidak didukung → dicatat di `warnings`.
 * Hasil WAJIB tetap melewati RichText.sanitize sebelum disisipkan.
 *
 * Excel → baris: lembar pertama, nilai tersimpan (hasil rumus), tanggal dan
 * persen dikenali dari format sel. Bila SheetJS (CDN) termuat, .xlsx/.xls dibaca
 * dengan SheetJS; tanpa internet .xlsx tetap bisa dibaca modul ini.
 * =======================================================================*/
(function (global) {
  'use strict';

  const NOT_OFFICE = 'Berkas bukan dokumen Office yang valid (.docx/.xlsx).';
  const OLD_BROWSER = 'Browser ini belum bisa membuka dokumen Office. Perbarui browser, atau salin-tempel isinya.';
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_PART = 40 * 1024 * 1024;          // batas satu bagian setelah dibuka (anti "zip bomb")
  const MAX_IMAGES = 30;
  const MAX_ROWS = 5000, MAX_COLS = 60;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const supported = () => typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined' && typeof Response !== 'undefined';

  /* ============================ ZIP ============================ */
  async function readZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error(NOT_OFFICE);
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');
    const entries = new Map();
    for (let n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error(NOT_OFFICE);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      entries.set(dec.decode(u8.subarray(p + 46, p + 46 + nlen)), {
        method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), off: dv.getUint32(p + 42, true)
      });
      p += 46 + nlen + xlen + clen;
    }
    async function bytes(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.usize > MAX_PART) throw new Error('Bagian dokumen terlalu besar untuk dibuka.');
      if (e.off + 30 > u8.length || dv.getUint32(e.off, true) !== 0x04034b50) throw new Error(NOT_OFFICE);
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const raw = u8.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method !== 8) throw new Error('Format kompresi dokumen tidak didukung.');
      if (!supported()) throw new Error(OLD_BROWSER);
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    async function text(name) {
      const b = await bytes(name);
      return b ? dec.decode(b) : null;
    }
    return { has: (n) => entries.has(n), names: () => [...entries.keys()], bytes, text };
  }

  async function fileBytes(file) {
    if (!file) throw new Error('Pilih berkas terlebih dahulu.');
    if (file.size > MAX_FILE) throw new Error('Berkas maksimal 25 MB.');
    if (file.arrayBuffer) return new Uint8Array(await file.arrayBuffer());
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
      r.readAsArrayBuffer(file);
    });
  }

  /* ============================ XML ============================ */
  function parseXml(str) {
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Isi dokumen rusak dan tidak dapat dibaca.');
    return doc;
  }
  const kids = (el, name) => (el ? [...el.children].filter(c => c.localName === name) : []);
  const kid = (el, name) => {
    if (!el) return null;
    for (const c of el.children) if (c.localName === name) return c;
    return null;
  };
  function attr(el, name) {
    if (!el) return null;
    for (const a of el.attributes) if (a.localName === name) return a.value;
    return null;
  }
  /** Atribut r:id / r:embed (namespace relationships). */
  function relAttr(el, name) {
    if (!el) return null;
    for (const a of el.attributes) if (a.localName === name && /relationships/.test(a.namespaceURI || '')) return a.value;
    return attr(el, name);
  }
  const descendants = (el, name) => (el ? [...el.getElementsByTagNameNS('*', name)] : []);
  /** Properti biner Word: <w:b/> = aktif, <w:b w:val="0"/> = nonaktif. */
  function isOn(pr, name) {
    const e = kid(pr, name);
    if (!e) return false;
    const v = attr(e, 'val');
    return v == null || !/^(0|false|off|none)$/i.test(v);
  }

  async function rels(zip, path) {
    const out = new Map();
    const xml = await zip.text(path);
    if (!xml) return out;
    descendants(parseXml(xml).documentElement, 'Relationship').forEach(r => {
      out.set(r.getAttribute('Id'), { target: r.getAttribute('Target') || '', external: r.getAttribute('TargetMode') === 'External' });
    });
    return out;
  }
  /** "media/image1.png" relatif terhadap "word/" → "word/media/image1.png". */
  function resolvePath(baseDir, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (baseDir + target).split('/');
    const out = [];
    parts.forEach(p => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  /* ============================ WORD ============================ */
  async function docxToHtml(file, opts) {
    const o = opts || {};
    const zip = await readZip(await fileBytes(file));
    const docXml = await zip.text('word/document.xml');
    if (!docXml) throw new Error('Berkas ini bukan dokumen Word (.docx). Dokumen .doc lama: buka di Word lalu simpan sebagai .docx.');
    const body = kid(parseXml(docXml).documentElement, 'body');
    if (!body) throw new Error(NOT_OFFICE);
    const relMap = await rels(zip, 'word/_rels/document.xml.rels');
    const warnings = new Set();

    // Gaya paragraf: nama + turunan (basedOn) + tingkat kerangka.
    const styles = new Map();
    const stylesXml = await zip.text('word/styles.xml');
    if (stylesXml) {
      descendants(parseXml(stylesXml).documentElement, 'style').forEach(s => {
        const pPr = kid(s, 'pPr');
        styles.set(attr(s, 'styleId'), {
          name: String(attr(kid(s, 'name'), 'val') || '').toLowerCase(),
          basedOn: attr(kid(s, 'basedOn'), 'val'),
          outline: attr(kid(pPr, 'outlineLvl'), 'val'),
          numPr: kid(pPr, 'numPr'),
          bold: isOn(kid(s, 'rPr'), 'b'), italic: isOn(kid(s, 'rPr'), 'i')
        });
      });
    }
    const styleChain = (id) => {
      const out = [];
      for (let k = 0, cur = styles.get(id); cur && k < 8; k++, cur = styles.get(cur.basedOn)) out.push(cur);
      return out;
    };
    // Penomoran: numId → abstractNum → format per tingkat.
    const numFmt = new Map();
    const numXml = await zip.text('word/numbering.xml');
    if (numXml) {
      const root = parseXml(numXml).documentElement;
      const abstract = new Map();
      kids(root, 'abstractNum').forEach(a => {
        const lv = {};
        kids(a, 'lvl').forEach(l => { lv[attr(l, 'ilvl')] = attr(kid(l, 'numFmt'), 'val') || 'decimal'; });
        abstract.set(attr(a, 'abstractNumId'), lv);
      });
      kids(root, 'num').forEach(n => numFmt.set(attr(n, 'numId'), abstract.get(attr(kid(n, 'abstractNumId'), 'val')) || {}));
    }

    const images = [];
    const imageToken = (rid) => {
      const rel = relMap.get(rid);
      if (!rel || rel.external) return '';
      if (images.length >= MAX_IMAGES) { warnings.add(`Hanya ${MAX_IMAGES} gambar pertama yang diimpor.`); return ''; }
      images.push(resolvePath('word/', rel.target));
      return `\u0000IMG${images.length - 1}\u0000`;
    };
    function drawing(node) {
      if (descendants(node, 'txbxContent').length) warnings.add('Kotak teks (text box) tidak ikut diimpor.');
      const blips = descendants(node, 'blip').map(b => relAttr(b, 'embed')).filter(Boolean);
      const vml = descendants(node, 'imagedata').map(b => relAttr(b, 'id')).filter(Boolean);
      const ids = blips.length ? blips : vml;
      return ids.slice(0, 1).map(imageToken).join('');
    }

    function run(r, base) {
      const rPr = kid(r, 'rPr');
      let html = '';
      for (const c of r.children) {
        const n = c.localName;
        if (n === 't') html += esc(c.textContent);
        else if (n === 'tab') html += ' ';
        else if (n === 'br' || n === 'cr') html += attr(c, 'type') === 'page' ? '' : '<br>';
        else if (n === 'noBreakHyphen') html += '-';
        else if (n === 'drawing' || n === 'pict' || n === 'object') html += drawing(c);
        else if (n === 'AlternateContent') html += drawing(kid(c, 'Choice') || kid(c, 'Fallback') || c);
      }
      if (!html) return '';
      const rStyle = styles.get(attr(kid(rPr, 'rStyle'), 'val')) || {};
      const valign = attr(kid(rPr, 'vertAlign'), 'val');
      if (valign === 'superscript') html = `<sup>${html}</sup>`;
      else if (valign === 'subscript') html = `<sub>${html}</sub>`;
      if (isOn(rPr, 'strike') || isOn(rPr, 'dstrike')) html = `<s>${html}</s>`;
      if (isOn(rPr, 'u')) html = `<u>${html}</u>`;
      if (isOn(rPr, 'i') || (!kid(rPr, 'i') && (rStyle.italic || /emphasis/.test(rStyle.name || '') || base.italic))) html = `<em>${html}</em>`;
      if (isOn(rPr, 'b') || (!kid(rPr, 'b') && (rStyle.bold || /strong/.test(rStyle.name || '') || base.bold))) html = `<strong>${html}</strong>`;
      return html;
    }
    function inline(node, base) {
      let html = '';
      if (!node) return html;
      for (const c of node.children) {
        switch (c.localName) {
          case 'r': html += run(c, base); break;
          case 'hyperlink': {
            const inner = inline(c, base);
            const rel = relMap.get(relAttr(c, 'id'));
            html += rel && /^(https?:|mailto:)/i.test(rel.target) ? `<a href="${esc(rel.target)}">${inner}</a>` : inner;
            break;
          }
          case 'ins': case 'smartTag': case 'fldSimple': case 'customXml': case 'dir': case 'bdo': html += inline(c, base); break;
          case 'sdt': html += inline(kid(c, 'sdtContent'), base); break;
          case 'oMath': case 'oMathPara':
            warnings.add('Persamaan Word diimpor sebagai teks biasa. Tulis ulang dengan tombol Rumus bila perlu.');
            html += esc(descendants(c, 't').map(t => t.textContent).join(''));
            break;
          default: break;
        }
      }
      return html;
    }
    function paraMeta(p) {
      const pPr = kid(p, 'pPr');
      const chain = styleChain(attr(kid(pPr, 'pStyle'), 'val'));
      let tag = 'p';
      for (const s of chain) {
        const m = /^heading\s*(\d)/.exec(s.name);
        if (s.name === 'title') { tag = 'h2'; break; }
        if (s.name === 'subtitle') { tag = 'h3'; break; }
        if (m) { tag = m[1] === '1' ? 'h2' : (m[1] === '2' ? 'h3' : 'h4'); break; }
        if (/quote/.test(s.name)) { tag = 'blockquote'; break; }
        if (s.outline != null && Number(s.outline) < 9) { tag = ['h2', 'h3'][Number(s.outline)] || 'h4'; break; }
      }
      const numPr = kid(pPr, 'numPr') || (chain.find(s => s.numPr) || {}).numPr || null;
      const numId = attr(kid(numPr, 'numId'), 'val');
      let list = null;
      if (numId && numId !== '0' && tag === 'p') {
        const lvl = Math.min(5, Math.max(0, parseInt(attr(kid(numPr, 'ilvl'), 'val'), 10) || 0));
        const fmt = (numFmt.get(numId) || {})[String(lvl)] || 'decimal';
        list = { level: lvl, tag: fmt === 'bullet' ? 'ul' : 'ol' };
      }
      const jc = attr(kid(pPr, 'jc'), 'val');
      const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] || '';
      // Tebal/miring dari gaya paragraf biasa (bukan judul, yang sudah tebal dengan sendirinya).
      const base = tag === 'p' ? { bold: chain.some(s => s.bold), italic: chain.some(s => s.italic) } : {};
      return { tag, list, align, base };
    }
    const hasContent = (h) => /\u0000IMG|<br>|[^\s]/.test(h.replace(/<(?!br)[^>]*>/g, ''));

    function cellHtml(tc) {
      const parts = [];
      for (const c of tc.children) {
        if (c.localName === 'p') { const h = inline(c, paraMeta(c).base); if (hasContent(h)) parts.push(h); }
        else if (c.localName === 'tbl') parts.push(table(c));
        else if (c.localName === 'sdt') parts.push(cellHtml(kid(c, 'sdtContent') || c));
      }
      return parts.join('<br>');
    }
    function table(tbl) {
      const origin = {};                       // kolom → sel awal gabungan vertikal
      const rows = [];
      kids(tbl, 'tr').forEach(tr => {
        const trPr = kid(tr, 'trPr');
        const head = !!kid(trPr, 'tblHeader');
        let col = parseInt(attr(kid(trPr, 'gridBefore'), 'val'), 10) || 0;
        const cells = [];
        const tcs = [];
        for (const c of tr.children) {
          if (c.localName === 'tc') tcs.push(c);
          else if (c.localName === 'sdt') tcs.push(...kids(kid(c, 'sdtContent'), 'tc'));
        }
        tcs.forEach(tc => {
          const tcPr = kid(tc, 'tcPr');
          const span = Math.max(1, Math.min(MAX_COLS, parseInt(attr(kid(tcPr, 'gridSpan'), 'val'), 10) || 1));
          const vmEl = kid(tcPr, 'vMerge');
          const vm = vmEl ? (attr(vmEl, 'val') || 'continue') : null;
          if (vm === 'continue' && origin[col]) { origin[col].rowspan++; col += span; return; }
          const cell = { html: cellHtml(tc), colspan: span, rowspan: 1 };
          for (let k = 0; k < span; k++) delete origin[col + k];
          if (vm === 'restart') origin[col] = cell;
          cells.push(cell);
          col += span;
        });
        rows.push({ head, cells });
      });
      return '<table class="rte-table">' + rows.map(r => '<tr>' + r.cells.map(c => {
        const t = r.head ? 'th' : 'td';
        return `<${t}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${c.html || '&nbsp;'}</${t}>`;
      }).join('') + '</tr>').join('') + '</table>';
    }

    const out = [];
    const stack = [];
    const closeLists = (depth) => { while (stack.length > depth) out.push('</li></' + stack.pop() + '>'); };
    function listItem(list, inner) {
      const lv = list.level;
      if (stack.length > lv + 1) closeLists(lv + 1);
      if (stack.length === lv + 1 && stack[lv] !== list.tag) closeLists(lv);
      if (stack.length === lv + 1) { out.push('</li><li>' + inner); return; }
      while (stack.length < lv + 1) { out.push(`<${list.tag}><li>`); stack.push(list.tag); }
      out.push(inner);
    }
    function block(node) {
      for (const c of node.children) {
        if (c.localName === 'p') {
          const meta = paraMeta(c);
          const inner = inline(c, meta.base);
          if (meta.list) { if (hasContent(inner)) listItem(meta.list, inner); continue; }
          closeLists(0);
          if (!hasContent(inner)) continue;               // paragraf kosong (jarak) dilewati
          out.push(`<${meta.tag}${meta.align ? ` style="text-align:${meta.align}"` : ''}>${inner}</${meta.tag}>`);
        } else if (c.localName === 'tbl') { closeLists(0); out.push(table(c)); }
        else if (c.localName === 'sdt') block(kid(c, 'sdtContent') || c);
        else if (c.localName === 'customXml') block(c);
      }
    }
    block(body);
    closeLists(0);
    let html = out.join('\n');

    // Gambar: dibaca dari arsip lalu diperkecil (opts.image) sebelum disisipkan.
    const urls = await Promise.all(images.map(async (path) => {
      const ext = (path.split('.').pop() || '').toLowerCase();
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
      if (!type) { warnings.add('Gambar berformat EMF/WMF/TIFF tidak didukung dan dilewati.'); return ''; }
      try {
        const b = await zip.bytes(path);
        if (!b) return '';
        const blob = new Blob([b], { type });
        return o.image ? await o.image(blob) : '';
      } catch (e) { warnings.add('Sebagian gambar gagal dibaca.'); return ''; }
    }));
    html = html.replace(/\u0000IMG(\d+)\u0000/g, (m, i) => (urls[i] ? `<img src="${esc(urls[i])}" alt="">` : ''));
    if (!html.replace(/<[^>]*>/g, '').trim() && !/<img/.test(html)) throw new Error('Dokumen tidak berisi teks yang dapat diimpor.');
    return { html, warnings: [...warnings] };
  }

  /* ============================ EXCEL ============================ */
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  const colIndex = (ref) => {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const pad = (n) => String(n).padStart(2, '0');
  function serialDate(v, time) {
    const ms = Math.round((Number(v) - 25569) * 86400000);   // 25569 = 1 Jan 1970 dalam serial Excel
    const d = new Date(ms);
    if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return String(v);
    const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    return time && (d.getUTCHours() || d.getUTCMinutes()) ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
  }
  function numText(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Number.isInteger(n)) return String(n);
    return String(parseFloat(n.toPrecision(12))).replace('.', ',');   // desimal gaya Indonesia
  }

  async function xlsxRows(file) {
    const zip = await readZip(await fileBytes(file));
    const wbXml = await zip.text('xl/workbook.xml');
    if (!wbXml) throw new Error('Berkas ini bukan lembar Excel (.xlsx).');
    const sheetEl = descendants(parseXml(wbXml).documentElement, 'sheet')[0];
    if (!sheetEl) throw new Error('Lembar kerja tidak ditemukan.');
    const wbRels = await rels(zip, 'xl/_rels/workbook.xml.rels');
    const rel = wbRels.get(relAttr(sheetEl, 'id'));
    const sheetPath = rel ? resolvePath('xl/', rel.target) : 'xl/worksheets/sheet1.xml';

    const shared = [];
    const ssXml = await zip.text('xl/sharedStrings.xml');
    if (ssXml) {
      kids(parseXml(ssXml).documentElement, 'si').forEach(si => {
        const t = kid(si, 't');
        shared.push(t ? t.textContent : kids(si, 'r').map(r => (kid(r, 't') || { textContent: '' }).textContent).join(''));
      });
    }
    const xfKind = [];                         // indeks gaya sel → 'date' | 'time' | 'pct' | ''
    const stXml = await zip.text('xl/styles.xml');
    if (stXml) {
      const root = parseXml(stXml).documentElement;
      const custom = new Map();
      kids(kid(root, 'numFmts'), 'numFmt').forEach(f => custom.set(Number(attr(f, 'numFmtId')), attr(f, 'formatCode') || ''));
      kids(kid(root, 'cellXfs'), 'xf').forEach(xf => {
        const id = Number(attr(xf, 'numFmtId')) || 0;
        const code = (custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
        if (BUILTIN_DATE.has(id) || /[dy]/i.test(code) || (/m/i.test(code) && !/0/.test(code))) xfKind.push(/[hs]/i.test(code) || [22, 45, 46, 47].includes(id) ? 'time' : 'date');
        else if (id === 9 || id === 10 || /%/.test(code)) xfKind.push('pct');
        else xfKind.push('');
      });
    }

    const shXml = await zip.text(sheetPath);
    if (!shXml) throw new Error('Lembar kerja tidak dapat dibaca.');
    const data = kid(parseXml(shXml).documentElement, 'sheetData');
    const out = [];
    kids(data, 'row').slice(0, MAX_ROWS).forEach((row, i) => {
      const rIdx = Math.min(MAX_ROWS - 1, (parseInt(attr(row, 'r'), 10) || (i + 1)) - 1);
      const vals = [];
      kids(row, 'c').forEach((c, j) => {
        const ci = attr(c, 'r') ? colIndex(attr(c, 'r')) : j;
        if (ci < 0 || ci >= MAX_COLS) return;
        const t = attr(c, 't') || 'n';
        const v = kid(c, 'v');
        let val = '';
        if (t === 's') val = v ? (shared[Number(v.textContent)] || '') : '';
        else if (t === 'inlineStr') val = descendants(kid(c, 'is'), 't').map(x => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1' ? 'BENAR' : 'SALAH';
        else if (t === 'str' || t === 'e') val = v ? v.textContent : '';
        else if (v && v.textContent !== '') {
          const kind = xfKind[Number(attr(c, 's')) || 0] || '';
          val = kind === 'date' || kind === 'time' ? serialDate(v.textContent, kind === 'time')
            : kind === 'pct' ? numText(Number(v.textContent) * 100) + '%' : numText(v.textContent);
        }
        vals[ci] = val;
      });
      out[rIdx] = Array.from({ length: vals.length }, (_, k) => (vals[k] == null ? '' : String(vals[k])));
    });
    const rows = Array.from({ length: out.length }, (_, k) => out[k] || []);
    const width = Math.max(0, ...rows.map(r => r.length));
    return rows.map(r => r.concat(Array(width - r.length).fill('')));
  }

  /**
   * Baca berkas tabel (.csv/.tsv/.txt/.xlsx/.xls) menjadi baris-baris teks.
   * Dipakai Lembar Data dan impor data lain.
   */
  async function readTableFile(file) {
    if (!file) throw new Error('Pilih berkas terlebih dahulu.');
    if (file.size > MAX_FILE) throw new Error('Berkas maksimal 25 MB.');
    const name = String(file.name || '').toLowerCase();
    if (/\.(csv|tsv|txt)$/.test(name)) {
      const text = file.text ? await file.text() : await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Berkas tidak dapat dibaca.')); r.readAsText(file, 'utf-8');
      });
      if (!global.Sheet) throw new Error('Modul Lembar Data belum termuat.');
      return Sheet.parseDelimited(text.replace(/^\uFEFF/, ''));
    }
    if (typeof XLSX !== 'undefined') {
      const wb = XLSX.read(await fileBytes(file), { type: 'array' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }).map(r => r.map(v => String(v == null ? '' : v)));
    }
    if (/\.xls$/.test(name)) throw new Error('Berkas .xls lama butuh pustaka Excel (perlu internet). Simpan sebagai .xlsx atau CSV lalu impor lagi.');
    return xlsxRows(file);
  }

  global.Office = { supported, readZip, docxToHtml, xlsxRows, readTableFile };
})(window);
