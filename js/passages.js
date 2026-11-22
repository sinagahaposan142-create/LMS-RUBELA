/* =====================================================================
 * js/passages.js — Teks Bacaan (stimulus bersama beberapa soal)
 * ---------------------------------------------------------------------
 * Soal UTBK sering merujuk satu bacaan, grafik, atau tabel yang sama
 * (mis. "Bacalah teks berikut untuk menjawab soal nomor 1–3"). Teks
 * disimpan sekali di `lms_passages`; soal menautkannya lewat `passageId`.
 *
 *  - Ujian CBT  : teks tampil sekali, berdampingan dengan kelompok soalnya
 *                 (layar lebar: kolom kiri tetap terlihat saat soal digulir;
 *                 ponsel: kartu di atas soal yang bisa diciutkan).
 *  - Pembahasan : teks tampil sebelum kelompok soalnya.
 *  - Editor soal: pilih teks yang ada, buat baru, atau sunting (berlaku untuk
 *                 semua soal yang memakainya).
 *  - Kuis course & grup menyimpan salinan teks (`q.passage`) bersama soalnya.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const plain = (h, n) => RichText.plain(h || '', n || 400);
  const IC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z"/></svg>';

  /** Teks bacaan sebuah soal: tertaut di Bank Soal, atau salinan pada kuis course/grup. */
  function of(q) {
    if (!q) return null;
    if (q.passageId && DB.getPassage) { const p = DB.getPassage(q.passageId); if (p) return p; }
    if (q.passage && q.passage.html) return Object.assign({ id: 'copy:' + (q.passage.id || q.id) }, q.passage);
    return null;
  }
  const keyOf = (q) => { const p = of(q); return p ? p.id : null; };
  const titleOf = (p) => (p && (p.title || '').trim()) || 'Teks bacaan';

  /** Chip kecil untuk daftar soal. */
  function chip(q) {
    const p = of(q);
    return p ? `<span class="qc-chip psg" title="${esc(plain(p.html, 200))}">${IC} ${esc(titleOf(p).slice(0, 40))}</span>` : '';
  }

  /** Salinan teks untuk soal yang disalin ke kuis course/grup. */
  function snapshotOf(q) {
    const p = of(q);
    return p ? { id: p.id, title: p.title || '', html: p.html } : null;
  }

  /**
   * Kelompokkan daftar soal berurutan yang memakai teks yang sama.
   * @returns {Array<{passage|null, items:Array<{q, i}>}>}
   */
  function groups(questions) {
    const out = [];
    questions.forEach((q, i) => {
      const k = keyOf(q);
      const last = out[out.length - 1];
      if (k && last && last.key === k) last.items.push({ q, i });
      else out.push({ key: k, passage: k ? of(q) : null, items: [{ q, i }] });
    });
    return out;
  }
  const rangeLabel = (items) => (items.length === 1 ? `Soal ${items[0].i + 1}` : `Soal ${items[0].i + 1}–${items[items.length - 1].i + 1}`);

  /**
   * Tata letak ujian: kelompok soal bertautan teks dibungkus berdampingan.
   * renderQ(q, i) mengembalikan HTML kartu soal.
   */
  function layoutHtml(questions, renderQ) {
    return groups(questions).map(g => {
      const cards = g.items.map(x => renderQ(x.q, x.i)).join('');
      if (!g.passage) return cards;
      return `<div class="psg-group" data-psg="${esc(g.key)}">
        <aside class="psg-pane" aria-label="${esc(titleOf(g.passage))}">
          <div class="psg-head"><span class="psg-ic">${IC}</span><div class="psg-ttl"><strong>${esc(titleOf(g.passage))}</strong><span>Untuk ${esc(rangeLabel(g.items))}</span></div>
            <button type="button" class="psg-toggle" aria-expanded="true" data-psg-toggle>Ciutkan</button></div>
          <div class="psg-body rt-content">${RichText.render(g.passage.html)}</div>
        </aside>
        <div class="psg-qs">${cards}</div>
      </div>`;
    }).join('');
  }
  /** Pembahasan: teks di atas kelompok soalnya (bisa dibuka/tutup). */
  function reviewHtml(questions, renderQ) {
    return groups(questions).map(g => {
      const cards = g.items.map(x => renderQ(x.q, x.i)).join('');
      if (!g.passage) return cards;
      return `<details class="psg-review" open><summary>${IC}<strong>${esc(titleOf(g.passage))}</strong><span class="muted small">${esc(rangeLabel(g.items))}</span></summary>
        <div class="psg-body rt-content">${RichText.render(g.passage.html)}</div></details>${cards}`;
    }).join('');
  }
  /** Kartu teks untuk satu soal (kuis course/grup yang tidak dikelompokkan). */
  function inlineHtml(q, prevQ) {
    const p = of(q);
    if (!p) return '';
    if (prevQ && keyOf(prevQ) === keyOf(q)) return `<p class="psg-same muted small">${IC} Masih memakai teks "${esc(titleOf(p))}" di atas.</p>`;
    return `<details class="psg-review" open><summary>${IC}<strong>${esc(titleOf(p))}</strong></summary><div class="psg-body rt-content">${RichText.render(p.html)}</div></details>`;
  }
  /** Tombol ciutkan teks pada layar ujian (delegasi; aman dipanggil berulang). */
  function bindLayout(root) {
    if (!root || root.__psgBound) return;
    root.__psgBound = true;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-psg-toggle]');
      if (!b) return;
      const pane = b.closest('.psg-pane');
      const open = !pane.classList.toggle('is-collapsed');
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Ciutkan' : 'Tampilkan teks';
    });
  }

  /* ---------------- Kartu "Teks Bacaan" di editor soal ---------------- */
  /**
   * @param {object} draft soal yang sedang disunting (memakai draft.passageId & draft.subject)
   * @returns {{ html: string, bind(root, ctx), collect(): {mode, id, title, html}, validate(): string|null, commit(user): string|null }}
   */
  function editor(draft) {
    const st = { mode: draft.passageId && DB.getPassage(draft.passageId) ? 'pick' : 'none', id: draft.passageId || '', title: '', html: '', editing: false };
    let root = null;
    const usedBy = (id) => (id ? DB.questionsOfPassage(id).length : 0);
    const listFor = (subject) => DB.getPassages().filter(p => !subject || !p.subject || p.subject === subject)
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    function bodyHtml() {
      const p = st.id ? DB.getPassage(st.id) : null;
      if (st.mode === 'none') return '<p class="muted small qe-psg-none">Soal berdiri sendiri. Pilih teks bacaan bila soal merujuk bacaan, grafik, atau tabel yang dipakai bersama beberapa soal.</p>';
      if (st.mode === 'pick' && !st.editing) {
        const list = listFor(draft.subject);
        return `<div class="form-group"><label for="qePsgSel">Teks bacaan (${list.length} untuk subtest ini)</label>
            <select id="qePsgSel"><option value="">— pilih teks —</option>${list.map(x => `<option value="${esc(x.id)}" ${x.id === st.id ? 'selected' : ''}>${esc(titleOf(x))} • ${usedBy(x.id)} soal</option>`).join('')}</select></div>
          ${p ? `<div class="qe-psg-prev"><div class="rt-content">${RichText.render(p.html)}</div></div>
            <div class="flex-gap qe-psg-acts"><button type="button" class="btn btn-sm btn-secondary" id="qePsgEdit">Sunting teks ini</button>
              <span class="muted small">Dipakai ${usedBy(p.id)} soal${usedBy(p.id) > 1 ? ' — perubahan berlaku untuk semuanya' : ''}.</span></div>` : ''}`;
      }
      // Buat baru / sunting
      return `<div class="form-group"><label for="qePsgTitle">Judul teks <span class="muted small">(tampil di atas bacaan)</span></label>
          <input id="qePsgTitle" maxlength="120" value="${esc(st.title)}" placeholder="mis. Teks 1 — Perubahan Iklim di Pesisir" /></div>
        <div class="form-group"><label>Isi teks bacaan</label>${Editor.toolbarHtml('qePsgText')}
          <div class="qe-editor" id="qePsgText" contenteditable="true" spellcheck="false" data-ph="Tempel atau tulis bacaan, tabel, grafik (gambar), atau puisi di sini…">${st.html || ''}</div></div>
        ${st.editing && usedBy(st.id) > 1 ? `<div class="alert alert-warning small">Teks ini dipakai ${usedBy(st.id)} soal. Perubahan berlaku untuk semuanya.</div>` : ''}
        ${st.editing ? '<button type="button" class="btn btn-sm btn-ghost" id="qePsgCancelEdit">Batal menyunting</button>' : ''}`;
    }
    function paint() {
      if (!root) return;
      root.querySelector('.qe-psg-body').innerHTML = bodyHtml();
      root.querySelectorAll('[data-psg-mode]').forEach(b => { const on = b.dataset.psgMode === (st.editing ? 'new' : st.mode); b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
      const sel = root.querySelector('#qePsgSel');
      if (sel) sel.addEventListener('change', () => { st.id = sel.value; paint(); if (ctx && ctx.onChange) ctx.onChange(); });
      const ed = root.querySelector('#qePsgEdit');
      if (ed) ed.addEventListener('click', () => { const p = DB.getPassage(st.id); if (!p) return; st.editing = true; st.title = p.title || ''; st.html = p.html || ''; paint(); });
      const cancel = root.querySelector('#qePsgCancelEdit');
      if (cancel) cancel.addEventListener('click', () => { st.editing = false; paint(); });
      const ti = root.querySelector('#qePsgTitle');
      if (ti) ti.addEventListener('input', () => { st.title = ti.value; });
      const tx = root.querySelector('#qePsgText');
      if (tx) {
        tx.addEventListener('input', () => { st.html = tx.innerHTML; if (ctx && ctx.onChange) ctx.onChange(); });
        if (ctx && ctx.attach) ctx.attach(root.querySelector('.qe-psg-body'));
      }
    }
    let ctx = null;
    return {
      html: `<section class="qe-card qe-psg" id="qePsgCard">
          <h4 class="qe-h">Teks Bacaan <span class="muted small">(opsional)</span></h4>
          <div class="seg-ctl" role="radiogroup" aria-label="Teks bacaan">
            <button type="button" role="radio" data-psg-mode="none">Tanpa teks</button>
            <button type="button" role="radio" data-psg-mode="pick">Pilih teks yang ada</button>
            <button type="button" role="radio" data-psg-mode="new">Buat teks baru</button>
          </div>
          <div class="qe-psg-body"></div>
        </section>`,
      bind(el, c) {
        root = el; ctx = c || {};
        root.querySelectorAll('[data-psg-mode]').forEach(b => b.addEventListener('click', () => {
          const m = b.dataset.psgMode;
          st.editing = false;
          if (m === 'new') { st.mode = 'new'; st.title = ''; st.html = ''; }
          else st.mode = m;
          paint();
          if (ctx.onChange) ctx.onChange();
        }));
        paint();
      },
      /** Teks yang akan tampil di pratinjau. */
      preview() {
        if (st.mode === 'none') return null;
        if (st.mode === 'new' || st.editing) return st.html ? { title: st.title, html: st.html } : null;
        return st.id ? DB.getPassage(st.id) : null;
      },
      validate() {
        if (st.mode === 'pick' && !st.editing && !st.id) return 'Pilih teks bacaan, atau ganti ke "Tanpa teks".';
        if ((st.mode === 'new' || st.editing) && !plain(st.html, 20) && !/<img|<table/i.test(st.html)) return 'Isi teks bacaan masih kosong.';
        return null;
      },
      /** Simpan teks (baru/sunting) lalu kembalikan id untuk soal. */
      commit(user, subject) {
        if (st.mode === 'none') return null;
        if (st.mode === 'new') {
          const p = DB.findOrCreatePassage({ title: st.title, html: RichText.sanitize(st.html), subject }, user.id);
          return p ? p.id : null;
        }
        if (st.editing && st.id) DB.updatePassage(st.id, { title: String(st.title || '').replace(/[<>]/g, '').trim().slice(0, 120), html: RichText.sanitize(st.html), subject });
        return st.id || null;
      }
    };
  }

  /* ---------------- Kelola teks bacaan (Bank Soal) ---------------- */
  function openManager(user, onChange) {
    const paintList = () => {
      const list = DB.getPassages().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return list.length ? `<ul class="psg-list">${list.map(p => {
        const n = DB.questionsOfPassage(p.id).length;
        const st = DB.subtestByName(p.subject);
        return `<li><div class="psg-li-main"><strong>${esc(titleOf(p))}</strong>
            <span>${st ? st.icon + ' ' + esc(st.short) + ' • ' : ''}${n} soal • ${esc(plain(p.html, 140))}</span></div>
          <div class="row-acts">${user.role === 'admin' || p.authorId === user.id ? `<button type="button" class="btn btn-sm btn-ghost" data-psg-del="${esc(p.id)}">Hapus</button>` : ''}</div></li>`;
      }).join('')}</ul>` : '<div class="empty"><div class="empty-icon">📖</div>Belum ada teks bacaan. Buat dari editor soal (kartu "Teks Bacaan") atau lewat Impor PDF/Word.</div>';
    };
    UI.modal.open('Teks Bacaan', `<p class="muted small" style="margin-top:0;">Teks dipakai bersama beberapa soal. Untuk menyunting isinya, buka salah satu soalnya lalu pilih "Sunting teks ini".</p><div id="psgMgr">${paintList()}</div>`);
    const box = document.getElementById('psgMgr');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-psg-del]');
      if (!b) return;
      const n = DB.questionsOfPassage(b.dataset.psgDel).length;
      if (!UI.confirmDialog(n ? `Hapus teks ini? ${n} soal tetap ada tetapi tanpa teks bacaan.` : 'Hapus teks bacaan ini?')) return;
      DB.deletePassage(b.dataset.psgDel);
      box.innerHTML = paintList();
      if (onChange) onChange();
    });
  }

  global.Passages = { of, keyOf, chip, snapshotOf, groups, layoutHtml, reviewHtml, inlineHtml, bindLayout, editor, openManager, titleOf, ICON: IC };
})(window);
