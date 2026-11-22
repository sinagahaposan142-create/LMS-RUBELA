/* =====================================================================
 * js/qpicker.js — Pemilih soal Bank Soal (halaman penuh)
 * ---------------------------------------------------------------------
 * Dipakai setoran soal CBT Tryout (tutor), tambah soal Tryout (admin), dan
 * "Ambil dari Bank Soal" di Game Battle.
 *   - Kategori subtest di kiri: jumlah tersedia/dipilih + centang semua per kategori
 *     dan centang semua soal (seluruh kategori)
 *   - Pencarian di kategori aktif atau di semua kategori; filter format, tingkat,
 *     materi, sub materi, dan "dipilih / belum dipilih"
 *   - Soal dikelompokkan per Materi › Sub Materi, centang semua per kelompok
 *   - Setiap pilihan dapat dibatalkan satu per satu atau sekaligus
 *   - Opsional (opts.create): buat soal baru langsung dengan alat Bank Soal
 *     (editor, buat massal, impor Excel/CSV, impor PDF/Word/teks dibantu AI);
 *     soal baru otomatis dipilih.
 *
 * QPicker.open({
 *   title, subtitle, subtests:[nama], subtest, selected:[id],
 *   questions: () => [soal]            // bawaan DB.getQuestions()
 *   disabled: (q) => 'alasan' | ''     // soal yang tidak boleh dipilih
 *   badge: (q) => html                 // keterangan tambahan pada kartu
 *   sideNote: (subtest) => teks        // keterangan kecil per kategori (mis. target)
 *   note: html                         // keterangan di atas daftar
 *   create: { user }                   // tampilkan alat buat soal
 *   confirmLabel: (n) => teks, onConfirm: (ids) => boolean|void, onClose: () => void
 * })
 * z-index 130: di atas .cbt-workspace (120), di bawah editor soal (140) & dialog.
 * ===================================================================*/
(function (global) {
  const esc = (s) => UI.esc(s);
  const PAGE = 60;
  const NONE = '__none__';
  let current = null;

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    document.removeEventListener('keydown', c.onKey, true);
    c.el.remove();
    document.documentElement.classList.remove('qp-lock');
    if (c.returnFocus && document.contains(c.returnFocus)) try { c.returnFocus.focus({ preventScroll: true }); } catch (e) { /* noop */ }
  }

  function plainText(html) { return global.DataSearch ? DataSearch.plain(html || '') : String(html || ''); }
  function hay(q) {
    const P = plainText;
    const tl = global.Topics ? Topics.labelOf(q) : null;
    const ps = global.Passages && Passages.of ? Passages.of(q) : null;
    return DataSearch.norm([
      P(q.text), (q.options || []).map(P).join(' '), P(q.explanation || ''),
      (q.statements || []).map(s => P(s.text)).join(' '), (q.pairs || []).map(p => P(p.left) + ' ' + P(p.right)).join(' '),
      (q.orderItems || []).map(P).join(' '), q.subject, q.questionType, q.difficulty, q.id,
      tl ? tl.text : '', ps ? (ps.title || '') : ''
    ].join(' '));
  }
  const diffLabel = (d) => { const k = (d || 'sedang').toLowerCase(); return k.charAt(0).toUpperCase() + k.slice(1); };

  function open(opts) {
    const o = Object.assign({ title: 'Pilih Soal dari Bank Soal', confirmLabel: (n) => `Gunakan ${n} soal` }, opts || {});
    close();
    const subs = (o.subtests && o.subtests.length ? o.subtests : DB.SUBTEST_NAMES).slice();
    const sel = new Set(o.selected || []);
    const initial = new Set(sel);
    const st = {
      sub: o.subtest && subs.includes(o.subtest) ? o.subtest : subs[0],
      q: '', everywhere: false, type: '', diff: '', show: '', tf: { topicId: '', subtopicId: '' }, limit: PAGE
    };
    const hayCache = new Map();
    const hayOf = (q) => { const k = q.id + '|' + (q.updatedAt || q.createdAt || ''); if (!hayCache.has(k)) hayCache.set(k, hay(q)); return hayCache.get(k); };
    const pool = () => (o.questions ? o.questions() : DB.getQuestions()).filter(q => q && q.id && subs.includes(q.subject));
    const why = (q) => (o.disabled ? o.disabled(q) || '' : '');
    const eligible = (q) => !why(q);

    const el = document.createElement('div');
    el.className = 'qp';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'qpTitle');
    el.innerHTML = `
      <header class="qp-top">
        <button type="button" class="btn btn-secondary btn-sm" data-qp-cancel>← Batal</button>
        <div class="qp-head"><h2 id="qpTitle">${esc(o.title)}</h2>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ''}</div>
        ${o.create ? `<div class="qp-create" role="group" aria-label="Buat soal baru">
          <button type="button" class="btn btn-sm btn-primary" data-qp-new="editor">+ Soal Baru</button>
          <button type="button" class="btn btn-sm btn-secondary" data-qp-new="bulk" title="Banyak soal sekaligus: per baris, tempel dari Excel, atau dibuat AI">Buat Massal</button>
          <button type="button" class="btn btn-sm btn-secondary" data-qp-new="excel">Impor Excel/CSV</button>
          ${global.DocImport ? '<button type="button" class="btn btn-sm btn-secondary" data-qp-new="doc" title="PDF, Word, atau teks tempelan; dapat dirapikan AI">Impor PDF/Word/Teks</button>' : ''}
        </div>` : ''}
      </header>
      <div class="qp-body">
        <aside class="qp-side" aria-label="Kategori subtest">
          <div class="qp-side-head">Kategori Subtest</div>
          <label class="qp-all"><input type="checkbox" data-qp-every /> <span>Semua soal</span> <small data-qp-every-n></small></label>
          <div class="qp-subs" data-qp-subs></div>
        </aside>
        <main class="qp-main">
          ${o.note ? `<div class="qp-note">${o.note}</div>` : ''}
          <div class="qp-filters">
            <div class="qp-search">
              <input type="search" data-qp-q placeholder="Cari isi soal, pilihan, pembahasan, materi…" aria-label="Cari soal" autocomplete="off" />
              <label class="qp-scope"><input type="checkbox" data-qp-everywhere /> di semua subtest</label>
            </div>
            <div class="qp-fsel">
              <select data-qp-type aria-label="Format soal"><option value="">Semua format</option>${DB.QUESTION_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
              <select data-qp-diff aria-label="Tingkat kesulitan"><option value="">Semua tingkat</option>${DB.DIFFICULTIES.map(d => `<option value="${esc(d)}">${esc(diffLabel(d))}</option>`).join('')}</select>
              ${global.Topics ? '<span class="qp-topics" data-qp-topics></span>' : ''}
              <select data-qp-show aria-label="Tampilkan"><option value="">Semua soal</option><option value="sel">Hanya yang dipilih</option><option value="unsel">Belum dipilih</option></select>
            </div>
          </div>
          <div class="qp-listhead" data-qp-listhead></div>
          <div class="qp-list" data-qp-list></div>
        </main>
      </div>
      <footer class="qp-bar">
        <div class="qp-sum" aria-live="polite" data-qp-sum></div>
        <div class="qp-bar-actions">
          <button type="button" class="btn btn-ghost btn-sm" data-qp-review>Tinjau pilihan</button>
          <button type="button" class="btn btn-secondary btn-sm" data-qp-clear>Batalkan semua<span class="qp-wide"> pilihan</span></button>
        </div>
        <button type="button" class="btn btn-primary" data-qp-ok></button>
      </footer>`;
    document.body.appendChild(el);
    document.documentElement.classList.add('qp-lock');
    const $ = (s) => el.querySelector(s);

    /* ---------------- data ---------------- */
    function filtered() {
      let list = pool();
      if (!(st.q && st.everywhere) && st.show !== 'sel-all') list = list.filter(q => q.subject === st.sub);
      if (st.type) list = list.filter(q => (q.questionType || 'Pilihan Ganda') === st.type);
      if (st.diff) list = list.filter(q => (q.difficulty || 'sedang') === st.diff);
      if (global.Topics && st.tf.topicId && !(st.q && st.everywhere)) list = list.filter(q => Topics.matches(q, st.tf));
      if (st.show === 'sel' || st.show === 'sel-all') list = list.filter(q => sel.has(q.id));
      if (st.show === 'unsel') list = list.filter(q => !sel.has(q.id));
      if (st.q) list = list.filter(q => DataSearch.matches(hayOf(q), st.q));
      return list;
    }
    /** Kunci & label kelompok Materi › Sub Materi (urut sesuai pengaturan materi). */
    function groupOf(q, withSub) {
      const t = global.Topics ? Topics.get(q.topicId) : null;
      const s = t && global.Topics ? Topics.get(q.subtopicId) : null;
      const okSub = s && s.parentId === t.id;
      const pre = withSub ? q.subject + '|' : '';
      const short = (DB.subtestByName(q.subject) || {}).short || q.subject;
      return {
        key: pre + (t ? t.id : NONE) + '|' + (okSub ? s.id : NONE),
        label: (withSub ? short + ' · ' : '') + (t ? t.name + (okSub ? ' › ' + s.name : '') : 'Belum diberi materi'),
        order: [withSub ? DB.subtestOrder(q.subject) : 0, t ? (t.order || 0) : 1e6, t ? t.name : '', okSub ? (s.order || 0) : -1, okSub ? s.name : '']
      };
    }
    const cmpOrder = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

    /* ---------------- gambar ---------------- */
    function triState(box, ids) {
      const ok = ids.filter(id => sel.has(id)).length;
      box.checked = !!ids.length && ok === ids.length;
      box.indeterminate = ok > 0 && ok < ids.length;
      box.disabled = !ids.length;
    }
    function paintSide() {
      const all = pool();
      const host = $('[data-qp-subs]');
      host.innerHTML = subs.map(name => {
        const s = DB.subtestByName(name);
        const inSub = all.filter(q => q.subject === name);
        const n = inSub.filter(q => sel.has(q.id)).length;
        const note = o.sideNote ? o.sideNote(name) : '';
        return `<div class="qp-sub ${name === st.sub && !(st.q && st.everywhere) && st.show !== 'sel-all' ? 'is-active' : ''}">
          <input type="checkbox" data-qp-subcheck="${esc(name)}" aria-label="Pilih semua soal ${esc(s ? s.short : name)}" />
          <button type="button" class="qp-sub-btn" data-qp-sub="${esc(name)}">
            <span class="qp-sub-nm">${s ? s.icon + ' ' : ''}${esc(s ? s.short : name)}</span>
            <span class="qp-sub-meta">${n ? `<b>${n} dipilih</b> · ` : ''}${inSub.length} soal${note ? ' · ' + esc(note) : ''}</span>
          </button>
        </div>`;
      }).join('');
      host.querySelectorAll('[data-qp-subcheck]').forEach(cb => {
        triState(cb, all.filter(q => q.subject === cb.dataset.qpSubcheck && (eligible(q) || sel.has(q.id))).map(q => q.id));
        cb.addEventListener('change', () => {
          const ids = all.filter(q => q.subject === cb.dataset.qpSubcheck).map(q => q.id);
          toggleMany(ids, cb.checked);
        });
      });
      host.querySelectorAll('[data-qp-sub]').forEach(b => b.addEventListener('click', () => {
        st.sub = b.dataset.qpSub; st.tf = { topicId: '', subtopicId: '' }; st.limit = PAGE;
        if (st.show === 'sel-all') st.show = '';
        if (st.everywhere && st.q) { st.everywhere = false; $('[data-qp-everywhere]').checked = false; }
        paintTopics(); paintAll();
      }));
      const every = $('[data-qp-every]');
      triState(every, all.filter(q => eligible(q) || sel.has(q.id)).map(q => q.id));
      $('[data-qp-every-n]').textContent = `${all.filter(q => sel.has(q.id)).length}/${all.length}`;
    }
    function paintTopics() {
      const box = $('[data-qp-topics]');
      if (!box) return;
      box.innerHTML = Topics.filterHtml(st.sub, st.tf, 'qp');
      box.querySelector('#qpTopic').addEventListener('change', (e) => { st.tf = { topicId: e.target.value, subtopicId: '' }; st.limit = PAGE; paintTopics(); paintList(); });
      box.querySelector('#qpSub').addEventListener('change', (e) => { st.tf.subtopicId = e.target.value; st.limit = PAGE; paintList(); });
      const off = !!(st.q && st.everywhere) || st.show === 'sel-all';
      box.querySelectorAll('select').forEach(s => { if (off) s.disabled = true; });
    }
    function cardHtml(q) {
      const reason = why(q);
      const on = sel.has(q.id);
      const s = DB.subtestByName(q.subject);
      const tl = global.Topics ? Topics.labelOf(q) : null;
      const opts = (q.options || []).filter(x => plainText(x).trim() || /<img/i.test(String(x)));
      return `<div class="qp-card ${on ? 'is-on' : ''} ${reason && !on ? 'is-off' : ''}" data-qp-card="${esc(q.id)}">
        <input type="checkbox" data-qp-q="${esc(q.id)}" ${on ? 'checked' : ''} ${reason && !on ? 'disabled' : ''} aria-label="Pilih soal" />
        <div class="qp-card-body">
          <div class="qp-meta">
            <span class="qc-chip sub">${s ? s.icon + ' ' + esc(s.short) : esc(q.subject || '-')}</span>
            <span class="qp-path" title="Materi › Sub materi">${tl ? esc(tl.text) : '<span class="muted">Belum diberi materi</span>'}</span>
          </div>
          <div class="qp-text rt-content">${RichText.render(q.text)}</div>
          <div class="qp-opts rt-content" hidden>${opts.length ? `<ol type="A">${opts.map(x => `<li>${RichText.render(x)}</li>`).join('')}</ol>` : ''}</div>
          <div class="qp-tags">
            <span class="qc-chip type">${esc(q.questionType || 'Pilihan Ganda')}</span>
            <span class="qc-chip d-${esc((q.difficulty || 'sedang').toLowerCase())}">${esc(diffLabel(q.difficulty))}</span>
            ${global.Passages ? Passages.chip(q) : ''}
            ${o.badge ? o.badge(q) : ''}
            ${reason ? `<span class="qp-why">${esc(reason)}</span>` : ''}
            <button type="button" class="qp-more" data-qp-more aria-expanded="false">Selengkapnya</button>
          </div>
        </div>
      </div>`;
    }
    function paintList() {
      const list = filtered();
      const cross = (st.q && st.everywhere) || st.show === 'sel-all';
      const groups = new Map();
      list.forEach(q => {
        const g = groupOf(q, cross);
        if (!groups.has(g.key)) groups.set(g.key, Object.assign(g, { items: [] }));
        groups.get(g.key).items.push(q);
      });
      const ordered = [...groups.values()].sort((a, b) => cmpOrder(a.order, b.order));
      const s = DB.subtestByName(st.sub);
      const head = $('[data-qp-listhead]');
      const shownIds = list.map(q => q.id);
      head.innerHTML = `
        <div><strong>${st.show === 'sel-all' ? 'Soal yang dipilih (semua subtest)' : (st.q && st.everywhere ? `Hasil "${esc(st.q)}" di semua subtest` : (s ? s.icon + ' ' + esc(s.name) : esc(st.sub)))}</strong>
          <span class="muted small">${list.length} soal${ordered.length ? ` · ${ordered.length} kelompok materi` : ''}</span></div>
        <label class="qp-pickall"><input type="checkbox" data-qp-shown /> Pilih semua yang tampil (${list.length})</label>`;
      triState(head.querySelector('[data-qp-shown]'), list.filter(q => eligible(q) || sel.has(q.id)).map(q => q.id));
      head.querySelector('[data-qp-shown]').addEventListener('change', (e) => toggleMany(shownIds, e.target.checked));

      const host = $('[data-qp-list]');
      if (!list.length) {
        const any = st.q || st.type || st.diff || st.tf.topicId || st.show;
        host.innerHTML = `<div class="empty"><div class="empty-icon">📭</div>${any ? 'Tidak ada soal yang cocok dengan pencarian/filter.' : 'Belum ada soal pada kategori ini.'}${o.create && !any ? '<div class="muted small mt-1">Buat soal baru lewat tombol di kanan atas.</div>' : ''}</div>`;
        return;
      }
      let budget = st.limit;
      const parts = [];
      for (const g of ordered) {
        if (budget <= 0) break;
        const items = g.items.slice(0, budget);
        budget -= items.length;
        const gIds = g.items.map(q => q.id);
        parts.push(`<section class="qp-group">
          <header class="qp-ghead">
            <label><input type="checkbox" data-qp-group="${esc(g.key)}" /> <strong>${esc(g.label)}</strong></label>
            <span class="muted small">${gIds.filter(id => sel.has(id)).length}/${gIds.length} dipilih</span>
          </header>
          <div class="qp-cards">${items.map(cardHtml).join('')}</div>
        </section>`);
      }
      host.innerHTML = parts.join('') + (list.length > st.limit
        ? `<div class="qp-moreall"><button type="button" class="btn btn-secondary btn-sm" data-qp-page>Tampilkan ${Math.min(PAGE, list.length - st.limit)} soal lagi</button> <span class="muted small">${st.limit} dari ${list.length} tampil</span></div>` : '');
      host.querySelectorAll('[data-qp-group]').forEach(cb => {
        const g = groups.get(cb.dataset.qpGroup);
        triState(cb, g.items.filter(q => eligible(q) || sel.has(q.id)).map(q => q.id));
        cb.addEventListener('change', () => toggleMany(g.items.map(q => q.id), cb.checked));
      });
      host.querySelectorAll('[data-qp-q]').forEach(cb => cb.addEventListener('change', () => {
        const id = cb.dataset.qpQ;
        if (cb.checked) sel.add(id); else sel.delete(id);
        paintAll(true);
      }));
      // Klik di mana saja pada kartu (selain tombol/tautan) ikut mencentang.
      host.querySelectorAll('[data-qp-card]').forEach(card => card.addEventListener('click', (e) => {
        if (e.target.closest('input, button, a, .qp-opts') || (window.getSelection && String(window.getSelection()).trim())) return;
        const cb = card.querySelector('[data-qp-q]');
        if (!cb || cb.disabled) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      }));
      host.querySelectorAll('[data-qp-more]').forEach(b => b.addEventListener('click', () => {
        const card = b.closest('.qp-card');
        const openNow = !card.classList.contains('is-open');
        card.classList.toggle('is-open', openNow);
        card.querySelector('.qp-opts').hidden = !openNow;
        b.setAttribute('aria-expanded', String(openNow));
        b.textContent = openNow ? 'Ringkas' : 'Selengkapnya';
      }));
      const pg = host.querySelector('[data-qp-page]');
      if (pg) pg.addEventListener('click', () => { st.limit += PAGE; paintList(); });
    }
    function paintSum() {
      const all = pool();
      const byId = new Map(all.map(q => [q.id, q]));
      const per = {};
      [...sel].forEach(id => { const q = byId.get(id); if (q) per[q.subject] = (per[q.subject] || 0) + 1; });
      const n = [...sel].filter(id => byId.has(id)).length;
      const changed = n !== initial.size || [...sel].some(id => !initial.has(id));
      $('[data-qp-sum]').innerHTML = `<strong>${n}</strong> soal dipilih` +
        (Object.keys(per).length ? `<span class="qp-per">${subs.filter(x => per[x]).map(x => `${esc((DB.subtestByName(x) || {}).short || x)} ${per[x]}`).join(' · ')}</span>` : '');
      const ok = $('[data-qp-ok]');
      ok.textContent = o.confirmLabel(n);
      ok.disabled = o.allowEmpty ? !changed : (!n || (!changed && !o.allowUnchanged));
      $('[data-qp-clear]').disabled = !n;
      $('[data-qp-review]').innerHTML = st.show === 'sel-all' ? 'Kembali<span class="qp-wide"> ke daftar</span>' : 'Tinjau<span class="qp-wide"> pilihan</span>';
      $('[data-qp-review]').disabled = !n && st.show !== 'sel-all';
    }
    function paintAll(keepScroll) {
      const list = $('[data-qp-list]');
      const y = keepScroll ? $('.qp-main').scrollTop : 0;
      paintSide(); paintList(); paintSum();
      if (keepScroll) $('.qp-main').scrollTop = y;
      else if (list) $('.qp-main').scrollTop = 0;
    }
    function toggleMany(ids, on) {
      const byId = new Map(pool().map(q => [q.id, q]));
      let skipped = 0;
      ids.forEach(id => {
        const q = byId.get(id);
        if (!q) return;
        if (on) { if (eligible(q)) sel.add(id); else if (!sel.has(id)) skipped++; } else sel.delete(id);
      });
      if (on && skipped) UI.toast(`${skipped} soal dilewati: ${why(byId.get(ids.find(id => byId.get(id) && !eligible(byId.get(id)) && !sel.has(id)))) || 'tidak dapat dipilih'}.`, 'info');
      paintAll(true);
    }

    /* ---------------- buat soal baru ---------------- */
    let known = new Set(DB.getQuestions().map(q => q.id));
    function takeNew() {
      const fresh = DB.getQuestions().filter(q => !known.has(q.id));
      fresh.forEach(q => known.add(q.id));
      const usable = fresh.filter(q => subs.includes(q.subject) && eligible(q));
      usable.forEach(q => sel.add(q.id));
      if (usable.length) {
        const first = usable[0];
        if (first.subject !== st.sub && !(st.q && st.everywhere)) { st.sub = first.subject; st.tf = { topicId: '', subtopicId: '' }; paintTopics(); }
        UI.toast(`${usable.length} soal baru tersimpan di Bank Soal dan langsung dipilih.`, 'success');
      } else if (fresh.length) UI.toast('Soal baru tersimpan di Bank Soal, tetapi subtestnya di luar pilihan ini.', 'info');
      hayCache.clear();
      paintAll();
    }
    el.querySelectorAll('[data-qp-new]').forEach(b => b.addEventListener('click', () => {
      const user = o.create.user;
      const d = { subtest: st.sub };
      known = new Set(DB.getQuestions().map(q => q.id));
      if (b.dataset.qpNew === 'editor') CbtAdmin.openQuestionForm(user, null, takeNew, d);
      else if (b.dataset.qpNew === 'bulk') BankTools.openBulk(user, takeNew, d);
      else if (b.dataset.qpNew === 'excel') BankTools.openImport(user, takeNew, d);
      else if (b.dataset.qpNew === 'doc') DocImport.open(user, takeNew, d);
    }));

    /* ---------------- kontrol ---------------- */
    let qTimer = null;
    $('[data-qp-q]').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { st.q = e.target.value.trim(); st.limit = PAGE; paintTopics(); paintAll(); }, 200);
    });
    $('[data-qp-everywhere]').addEventListener('change', (e) => { st.everywhere = e.target.checked; st.limit = PAGE; paintTopics(); paintAll(); });
    $('[data-qp-type]').addEventListener('change', (e) => { st.type = e.target.value; st.limit = PAGE; paintAll(); });
    $('[data-qp-diff]').addEventListener('change', (e) => { st.diff = e.target.value; st.limit = PAGE; paintAll(); });
    $('[data-qp-show]').addEventListener('change', (e) => { st.show = e.target.value; st.limit = PAGE; paintTopics(); paintAll(); });
    $('[data-qp-every]').addEventListener('change', (e) => toggleMany(pool().map(q => q.id), e.target.checked));
    $('[data-qp-review]').addEventListener('click', () => {
      st.show = st.show === 'sel-all' ? '' : 'sel-all';
      $('[data-qp-show]').value = '';
      st.limit = PAGE; paintTopics(); paintAll();
    });
    $('[data-qp-clear]').addEventListener('click', () => {
      if (sel.size > 5 && !UI.confirmDialog(`Batalkan semua ${sel.size} pilihan soal?`)) return;
      sel.clear();
      if (st.show === 'sel-all') st.show = '';
      paintTopics(); paintAll();
    });
    const cancel = () => {
      const changed = sel.size !== initial.size || [...sel].some(id => !initial.has(id));
      if (changed && !UI.confirmDialog('Tutup tanpa menyimpan pilihan soal?')) return;
      close();
      if (typeof o.onClose === 'function') o.onClose();
    };
    $('[data-qp-cancel]').addEventListener('click', cancel);
    $('[data-qp-ok]').addEventListener('click', () => {
      const valid = new Set(pool().map(q => q.id));
      const ids = [...sel].filter(id => valid.has(id));
      const res = typeof o.onConfirm === 'function' ? o.onConfirm(ids) : true;
      if (res === false) return;
      close();
      if (typeof o.onClose === 'function') o.onClose();
    });
    const onKey = (e) => {
      if (e.key !== 'Escape' || !current || current.el !== el) return;
      // Dialog/editor di atas pemilih menangani Escape sendiri.
      if (document.querySelector('.qe-workspace, .di-ws, .qe-dialog-back, #genericModal:not(.hidden)')) return;
      e.preventDefault();
      cancel();
    };
    document.addEventListener('keydown', onKey, true);
    current = { el, onKey, returnFocus: document.activeElement };

    paintTopics();
    paintAll();
    if (global.Effects) Effects.enhance(el);
    setTimeout(() => { const q = $('[data-qp-q]'); if (q) try { q.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 50);
    return { close };
  }

  global.QPicker = { open, close };
})(window);
