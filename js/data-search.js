/* =====================================================================
 * js/data-search.js — pencarian, filter, sorting, dan pagination bersama
 * ---------------------------------------------------------------------
 * LMS Rubela tidak memiliki server; seluruh data ada di localStorage.
 * Komponen ini memindai SELURUH dataset yang diberikan pemanggil (bukan hanya
 * baris yang sedang tampil), sehingga hasilnya setara pencarian server-side.
 * Pemanggil WAJIB hanya memberikan data yang boleh diakses perannya — itulah
 * batas hak akses; komponen tidak pernah membaca DB sendiri.
 *
 * DataSearch.mount({
 *   container, items:[...], fields:(item)=>[string,...],
 *   filters:[{key,label,options:[{value,label}],get:(item)=>value|[values]}],
 *   sorts:[{key,label,cmp}], pageSize, placeholder, empty,
 *   render:(pageItems, ctx)=>html, onPaint:(box, ctx)=>void, stateKey
 * })
 * ===================================================================*/
(function (global) {
  'use strict';

  const DEBOUNCE_MS = 220;
  const memory = {};               // state per halaman agar tetap saat re-render

  /** Normalisasi: huruf kecil, tanpa diakritik, spasi rapat. */
  function norm(s) {
    let t = String(s == null ? '' : s).toLowerCase();
    if (t.normalize) t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  /** Ubah HTML rich text menjadi teks agar isi soal/materi ikut tercari. */
  function plain(html) {
    if (global.RichText && RichText.plain) return RichText.plain(html, 5000);
    return String(html || '').replace(/<[^>]*>/g, ' ');
  }

  /**
   * Cocok bila SETIAP kata kunci muncul di salah satu field (parsial).
   * "bilangan bulat" cocok dengan soal yang memuat kedua kata di mana saja.
   */
  function matches(haystack, query) {
    const q = norm(query);
    if (!q) return true;
    return q.split(' ').every(tok => haystack.includes(tok));
  }

  function haystackOf(item, fields) {
    const parts = (fields(item) || []).map(v => Array.isArray(v) ? v.join(' ') : v);
    return norm(parts.join(' \u0001 '));
  }

  function escHtml(s) { return UI.esc(s); }

  /** Sorot kata kunci pada teks (aman: teks di-escape lebih dulu). */
  function highlight(text, query) {
    const safe = escHtml(text);
    const toks = norm(query).split(' ').filter(t => t.length > 1);
    if (!toks.length) return safe;
    const re = new RegExp('(' + toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    return safe.replace(re, '<mark class="ds-hit">$1</mark>');
  }

  function mount(opts) {
    const o = Object.assign({ pageSize: 20, placeholder: 'Cari…', empty: 'Tidak ada data yang cocok.' }, opts);
    const box = o.container;
    if (!box) return null;
    const key = o.stateKey || null;
    const saved = (key && memory[key]) || {};
    const state = {
      q: saved.q || '',
      filters: Object.assign({}, saved.filters || {}),
      sort: saved.sort || ((o.sorts && o.sorts[0]) ? o.sorts[0].key : ''),
      page: 1
    };
    // Indeks dibangun sekali per mount, bukan setiap ketikan.
    const index = (o.items || []).map(item => ({ item, hay: haystackOf(item, o.fields || (() => [])) }));
    let timer = null;

    box.innerHTML = `
      <div class="ds-bar" role="search">
        <div class="ds-search">
          <span class="ds-ic" aria-hidden="true">🔎</span>
          <input type="search" class="ds-input" placeholder="${escHtml(o.placeholder)}"
                 value="${escHtml(state.q)}" aria-label="${escHtml(o.placeholder)}" autocomplete="off" />
          <button type="button" class="ds-clear ${state.q ? '' : 'is-hidden'}" aria-label="Hapus pencarian">✕</button>
        </div>
        ${(o.filters || []).map(f => `
          <select class="input ds-filter" data-f="${escHtml(f.key)}" aria-label="${escHtml(f.label)}">
            <option value="">${escHtml(f.label)}</option>
            ${(f.options || []).map(op => `<option value="${escHtml(op.value)}" ${state.filters[f.key] === String(op.value) ? 'selected' : ''}>${escHtml(op.label)}</option>`).join('')}
          </select>`).join('')}
        ${(o.dateRange) ? `
          <input type="date" class="input ds-date" data-d="from" aria-label="Dari tanggal" value="${escHtml(state.filters.__from || '')}" />
          <input type="date" class="input ds-date" data-d="to" aria-label="Sampai tanggal" value="${escHtml(state.filters.__to || '')}" />` : ''}
        ${(o.sorts && o.sorts.length > 1) ? `
          <select class="input ds-sort" aria-label="Urutkan">
            ${o.sorts.map(s => `<option value="${escHtml(s.key)}" ${state.sort === s.key ? 'selected' : ''}>Urut: ${escHtml(s.label)}</option>`).join('')}
          </select>` : ''}
        <button type="button" class="btn btn-sm btn-secondary ds-reset">Reset</button>
      </div>
      <div class="ds-meta muted small" aria-live="polite"></div>
      <div class="ds-results"></div>
      <div class="ds-pager"></div>`;

    const input = box.querySelector('.ds-input');
    const clearBtn = box.querySelector('.ds-clear');
    const results = box.querySelector('.ds-results');
    const meta = box.querySelector('.ds-meta');
    const pager = box.querySelector('.ds-pager');

    function persist() { if (key) memory[key] = { q: state.q, filters: state.filters, sort: state.sort }; }

    function compute() {
      let list = index.filter(x => matches(x.hay, state.q)).map(x => x.item);
      (o.filters || []).forEach(f => {
        const want = state.filters[f.key];
        if (!want) return;
        list = list.filter(it => {
          const v = f.get(it);
          return Array.isArray(v) ? v.map(String).includes(want) : String(v == null ? '' : v) === want;
        });
      });
      if (o.dateRange) {
        const from = state.filters.__from, to = state.filters.__to;
        if (from || to) list = list.filter(it => {
          const d = String(o.dateRange(it) || '').slice(0, 10);
          return (!from || d >= from) && (!to || d <= to);
        });
      }
      const sorter = (o.sorts || []).find(s => s.key === state.sort);
      if (sorter) list = list.slice().sort(sorter.cmp);
      return list;
    }

    function paint() {
      const list = compute();
      const size = Math.max(1, o.pageSize);
      const pages = Math.max(1, Math.ceil(list.length / size));
      if (state.page > pages) state.page = pages;
      const start = (state.page - 1) * size;
      const pageItems = list.slice(start, start + size);
      const total = index.length;
      const active = !!state.q || Object.values(state.filters).some(Boolean);

      meta.textContent = active
        ? `${list.length} dari ${total} data cocok${state.q ? ` untuk "${state.q}"` : ''}`
        : `${total} data`;
      clearBtn.classList.toggle('is-hidden', !state.q);

      results.innerHTML = pageItems.length
        ? o.render(pageItems, { query: state.q, highlight: (t) => highlight(t, state.q), start })
        : `<div class="empty"><div class="empty-icon">🔎</div>${escHtml(active ? 'Tidak ada data yang cocok dengan pencarian/filter.' : o.empty)}</div>`;

      pager.innerHTML = pages > 1 ? `
        <button type="button" class="btn btn-sm btn-secondary" data-pg="prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>
        <span class="ds-pg-info">Halaman ${state.page} / ${pages} • ${start + 1}–${Math.min(start + size, list.length)} dari ${list.length}</span>
        <button type="button" class="btn btn-sm btn-secondary" data-pg="next" ${state.page >= pages ? 'disabled' : ''}>Berikutnya ›</button>` : '';
      pager.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => {
        state.page += b.dataset.pg === 'next' ? 1 : -1;
        paint();
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }));

      if (typeof o.onPaint === 'function') o.onPaint(results, { query: state.q, list });
      if (global.Responsive) Responsive.apply(results);
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = input.value; state.page = 1; persist(); paint(); }, DEBOUNCE_MS);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) { input.value = ''; state.q = ''; state.page = 1; persist(); paint(); }
    });
    clearBtn.addEventListener('click', () => {
      clearTimeout(timer);
      input.value = ''; state.q = ''; state.page = 1; persist(); paint(); input.focus();
    });
    box.querySelectorAll('.ds-filter').forEach(sel => sel.addEventListener('change', () => {
      state.filters[sel.dataset.f] = sel.value; state.page = 1; persist(); paint();
    }));
    box.querySelectorAll('.ds-date').forEach(inp => inp.addEventListener('change', () => {
      state.filters[inp.dataset.d === 'from' ? '__from' : '__to'] = inp.value; state.page = 1; persist(); paint();
    }));
    const sortSel = box.querySelector('.ds-sort');
    if (sortSel) sortSel.addEventListener('change', () => { state.sort = sortSel.value; state.page = 1; persist(); paint(); });
    box.querySelector('.ds-reset').addEventListener('click', () => {
      clearTimeout(timer);
      if (key) delete memory[key];   // hapus state tersimpan SEBELUM mount ulang
      mount(Object.assign({}, o));   // gambar ulang kontrol dalam keadaan bersih
    });

    paint();
    return { refresh: paint, state };
  }

  global.DataSearch = { mount, norm, matches, highlight, plain };
})(window);
