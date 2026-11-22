/* =====================================================================
 * js/vocab.js — Kosakata di Arena Belajar (streak)
 * ---------------------------------------------------------------------
 * 1. Kata Baku (kb): dua pilihan (baku vs tidak baku) → umpan balik, contoh
 *    kalimat & kaidahnya → nilai diri: Lupa (ulang besok), Ragu (ulang 2 hari
 *    lagi), Ingat (tidak diulang sampai semua kosakata selesai; lalu putaran baru).
 * 2. Vocab Inggris (en): flashcard dibalik atau kuis tebak arti, pelafalan
 *    (Web Speech), definisi, contoh kalimat + terjemahan, sinonim; penilaian
 *    Lupa/Ragu/Ingat yang sama.
 * Progres tersimpan lewat DB.vocabGrade (lms_vocab_progress, hanya pemilik).
 * Sesi ≥ 10 kartu tercatat di streak (jenis katabaku / vocab).
 * Kosakata bawaan: js/vocab-data.js (dimuat saat dibutuhkan); tambahan admin: lms_vocab_items.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const DECK = {
    kb: { label: 'Kata Baku', type: 'katabaku', icon: '🔤', unit: 'kata', ask: 'Mana penulisan yang baku?' },
    en: { label: 'Vocab Inggris', type: 'vocab', icon: '🗂️', unit: 'kata', ask: 'Apa arti kata ini?' }
  };
  const TAGS = {
    kb: { serapan: 'Kata serapan', ejaan: 'Ejaan & huruf', gabungan: 'Gabungan kata', imbuhan: 'Imbuhan', keagamaan: 'Istilah keagamaan', waktu: 'Hari & bulan' },
    en: { akademik: 'Akademik', 'soal bacaan': 'Istilah soal bacaan', sikap: 'Sikap penulis', penghubung: 'Kata penghubung', sains: 'Sains', sosial: 'Sosial', ekonomi: 'Ekonomi', lingkungan: 'Lingkungan', kesehatan: 'Kesehatan' }
  };
  const STATUS = {
    new: ['Baru', 'is-new'], due: ['Jatuh tempo', 'is-due'], later: ['Dijadwalkan', 'is-later'], done: ['Diingat', 'is-done']
  };
  let timers = [];
  let keyHandler = null;
  const view = { kb: { tag: '', tab: 'home', mode: 'flip' }, en: { tag: '', tab: 'home', mode: 'flip' } };

  function stop() {
    timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    timers = [];
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    if (global.speechSynthesis) try { global.speechSynthesis.cancel(); } catch (e) { /* noop */ }
  }
  function onKeys(fn) {
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable)) return;
      if (document.querySelector('#genericModal:not(.hidden)')) return;
      fn(e);
    };
    document.addEventListener('keydown', keyHandler);
  }

  /* ---------------- data ---------------- */
  let loading = null;
  function ensureData() {
    if (global.VocabData) return Promise.resolve(global.VocabData);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vocab-data.js';
      s.async = true;
      s.onload = () => (global.VocabData ? resolve(global.VocabData) : reject(new Error('Data kosakata tidak valid.')));
      s.onerror = () => { loading = null; reject(new Error('Data kosakata gagal dimuat. Periksa koneksi lalu coba lagi.')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function settings() {
    const st = DB.getSettings();
    return {
      enabled: st.vocabEnabled !== false,
      size: Math.max(10, Math.min(50, Math.round(Number(st.vocabSessionSize) || 20))),
      off: new Set(Array.isArray(st.vocabOff) ? st.vocabOff : [])
    };
  }
  /** Kosakata aktif sebuah dek: bawaan (kecuali dinonaktifkan) + tambahan admin yang aktif. */
  function items(kind) {
    const st = settings();
    const base = ((global.VocabData && global.VocabData[kind]) || []).filter(v => !st.off.has(v.id));
    const extra = DB.getVocabItems(kind).filter(v => v.active !== false);
    return base.concat(extra);
  }
  function classify(entry, today) {
    if (!Array.isArray(entry) || entry[0] === 0) return 'new';
    if (entry[0] === 3) return 'done';
    return entry[1] <= today ? 'due' : 'later';
  }
  function deckState(user, kind) {
    const p = DB.vocabProgress(user.id).decks[kind];
    const today = DB.vocabDayIndex(null, user);
    const list = items(kind).map(it => ({ it, e: p.items[it.id] || null, s: classify(p.items[it.id], today) }));
    const count = (s) => list.filter(x => x.s === s).length;
    return { p, today, list, total: list.length, new: count('new'), due: count('due'), later: count('later'), done: count('done') };
  }
  /** Urutan kartu baru tetap per putaran (acak berbibit id mentee + putaran). */
  function seeded(list, seedStr) {
    let h = 2166136261;
    for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rnd = () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function buildQueue(user, kind, opts) {
    const o = opts || {};
    const st = deckState(user, kind);
    const inTag = (x) => !o.tag || x.it.tag === o.tag;
    const due = st.list.filter(x => x.s === 'due' && inTag(x)).sort((a, b) => a.e[1] - b.e[1] || b.e[3] - a.e[3]);
    const fresh = seeded(st.list.filter(x => x.s === 'new' && inTag(x)), user.id + ':' + kind + ':' + st.p.round);
    const early = st.list.filter(x => x.s === 'later' && inTag(x)).sort((a, b) => a.e[1] - b.e[1]);
    return (o.early ? early : due.concat(fresh)).slice(0, o.size || settings().size).map(x => x.it);
  }

  /* ---------------- tampilan bersama ---------------- */
  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Sorot kata (dan bentuk turunannya) di contoh kalimat yang sudah di-escape. */
  function highlight(sentence, word) {
    const safe = esc(sentence);
    const w = String(word || '').trim();
    if (!w) return safe;
    const stem = w.length > 4 ? w.replace(/e$/i, '') : w;
    try { return safe.replace(new RegExp('(^|[^\\p{L}])(' + rxEsc(esc(stem)) + '[\\p{L}]*)', 'giu'), '$1<mark>$2</mark>'); } catch (e) { return safe; }
  }
  const canSpeak = () => !!(global.speechSynthesis && global.SpeechSynthesisUtterance);
  function speak(text, lang) {
    if (!canSpeak()) return;
    try {
      global.speechSynthesis.cancel();
      const u = new global.SpeechSynthesisUtterance(text);
      u.lang = lang || 'en-US';
      u.rate = 0.92;
      const v = global.speechSynthesis.getVoices().find(x => /^en(-|_)(US|GB)/i.test(x.lang));
      if (v) u.voice = v;
      global.speechSynthesis.speak(u);
    } catch (e) { /* noop */ }
  }
  const SPK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';

  function ringHtml(pct, big, small) {
    const r = 34, c = 2 * Math.PI * r;
    return `<div class="vc-ring" role="img" aria-label="${pct}% ${esc(small)}">
      <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${r}" class="vc-ring-bg"/><circle cx="40" cy="40" r="${r}" class="vc-ring-fg" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(1)}"/></svg>
      <div><strong>${esc(big)}</strong><span>${esc(small)}</span></div></div>`;
  }
  function activityHtml(p, today) {
    const days = [];
    for (let d = today - 13; d <= today; d++) days.push({ d, n: Number(p.days[d]) || 0 });
    const max = Math.max(1, ...days.map(x => x.n));
    const label = (d) => new Date(d * 86400000).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    return `<div class="vc-act" role="img" aria-label="Kartu per hari, 14 hari terakhir">
      ${days.map(x => `<span title="${esc(label(x.d))}: ${x.n} kartu" class="${x.d === today ? 'is-today' : ''}"><i style="height:${Math.max(x.n ? 10 : 3, Math.round(x.n / max * 100))}%"></i></span>`).join('')}
    </div><div class="vc-act-cap"><span>14 hari lalu</span><span>hari ini</span></div>`;
  }

  /* ---------------- halaman dek ---------------- */
  function render(box, user, kind) {
    stop();
    if (!settings().enabled) { box.innerHTML = '<div class="empty"><div class="empty-icon">🗂️</div>Latihan kosakata sedang dinonaktifkan admin.</div>'; return; }
    box.innerHTML = '<div class="card vc-loading"><span class="spinner"></span> Memuat kosakata…</div>';
    ensureData().then(() => { if (box.isConnected) paintHome(box, user, kind); })
      .catch(e => { box.innerHTML = `<div class="alert alert-error">${esc(e.message)} <button type="button" class="btn btn-sm btn-secondary" data-vc-retry>Coba lagi</button></div>`;
        box.querySelector('[data-vc-retry]').addEventListener('click', () => render(box, user, kind)); });
  }

  function paintHome(box, user, kind) {
    const D = DECK[kind];
    const v = view[kind];
    let st = deckState(user, kind);
    // Semua kosakata sudah diingat → putaran baru dari awal.
    if (st.total && st.done === st.total) {
      const round = DB.vocabNewRound(user.id, kind, st.list.map(x => x.it.id));
      if (round) UI.toast(`Semua ${st.total} ${D.label.toLowerCase()} sudah kamu ingat! Putaran ke-${round} dimulai dari awal. 🎉`, 'success');
      st = deckState(user, kind);
    }
    const tags = TAGS[kind];
    const byTag = Object.keys(tags).map(t => {
      const l = st.list.filter(x => x.it.tag === t);
      return { t, n: l.length, done: l.filter(x => x.s === 'done').length };
    }).filter(x => x.n);
    const inTag = (x) => !v.tag || x.it.tag === v.tag;
    const avail = st.list.filter(x => inTag(x) && (x.s === 'due' || x.s === 'new')).length;
    const early = st.list.filter(x => inTag(x) && x.s === 'later').length;
    const size = settings().size;
    const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    const acc = st.p.answered ? Math.round(st.p.correct / st.p.answered * 100) : null;
    const tomorrow = st.list.filter(x => x.s === 'later' && x.e[1] === st.today + 1).length;
    box.innerHTML = `<div class="vc vc-${kind}">
      <div class="vc-tabs" role="tablist">
        ${[['home', 'Latihan'], ['list', 'Daftar kata']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${v.tab === k}" class="vc-tab ${v.tab === k ? 'is-on' : ''}" data-vc-tab="${k}">${l}</button>`).join('')}
      </div>
      <div data-vc-body></div></div>`;
    box.querySelectorAll('[data-vc-tab]').forEach(b => b.addEventListener('click', () => { v.tab = b.dataset.vcTab; paintHome(box, user, kind); }));
    const body = box.querySelector('[data-vc-body]');
    if (v.tab === 'list') return paintList(body, user, kind, st);
    body.innerHTML = `
      <section class="card vc-hero">
        <div class="vc-hero-main">
          <div class="vc-eyebrow">${D.icon} ${esc(D.label)} • putaran ${st.p.round}</div>
          <h3>${st.due ? `${st.due} kartu menunggu diulang hari ini` : (st.new ? 'Siap belajar kosakata baru' : 'Kartu hari ini sudah tuntas')}</h3>
          <p class="muted">${kind === 'kb'
            ? 'Pilih penulisan yang baku, lihat contoh kalimat dan kaidahnya, lalu nilai dirimu. Kartu yang kamu ingat tidak muncul lagi sampai semua kata selesai.'
            : 'Balik kartu atau tebak artinya, dengarkan pelafalannya, pelajari contoh kalimatnya, lalu nilai dirimu. Kartu yang kamu ingat tidak muncul lagi sampai semua kata selesai.'}</p>
          <div class="vc-grades-legend">
            <span><b class="g-lupa">Lupa</b> ulang besok</span><span><b class="g-ragu">Ragu</b> ulang 2 hari lagi</span><span><b class="g-ingat">Ingat</b> selesai sampai putaran berikutnya</span>
          </div>
          ${kind === 'en' ? `<div class="vc-modes" role="radiogroup" aria-label="Cara latihan">
            ${[['flip', 'Flashcard', 'balik kartu untuk melihat arti'], ['quiz', 'Tebak arti', 'pilih arti yang benar dari 4 pilihan']].map(([k, l, d]) => `<button type="button" role="radio" aria-checked="${v.mode === k}" class="vc-mode ${v.mode === k ? 'is-on' : ''}" data-vc-mode="${k}"><strong>${l}</strong><small>${d}</small></button>`).join('')}
          </div>` : ''}
          <div class="vc-tagsel">
            <label for="vcTag">Kategori</label>
            <select id="vcTag"><option value="">Semua kategori (${st.total})</option>${byTag.map(x => `<option value="${esc(x.t)}" ${v.tag === x.t ? 'selected' : ''}>${esc(tags[x.t])} (${x.n})</option>`).join('')}</select>
          </div>
          <div class="vc-cta">
            <button type="button" class="btn btn-primary" data-vc-start ${avail ? '' : 'disabled'}>${avail ? `Mulai sesi • ${Math.min(size, avail)} kartu` : 'Tidak ada kartu jatuh tempo'}</button>
            ${!avail && early ? `<button type="button" class="btn btn-secondary" data-vc-early>Ulang lebih awal (${early})</button>` : ''}
          </div>
          ${!avail && tomorrow ? `<p class="muted small">${tomorrow} kartu dijadwalkan besok.</p>` : ''}
        </div>
        <div class="vc-hero-side">
          ${ringHtml(pct, pct + '%', `${st.done}/${st.total} diingat`)}
          <dl class="vc-nums">
            <div><dt>Jatuh tempo</dt><dd>${st.due}</dd></div>
            <div><dt>Baru</dt><dd>${st.new}</dd></div>
            <div><dt>Dijadwalkan</dt><dd>${st.later}</dd></div>
            <div><dt>${kind === 'kb' ? 'Akurasi pilihan' : 'Akurasi kuis'}</dt><dd>${acc == null ? '–' : acc + '%'}</dd></div>
          </dl>
        </div>
      </section>
      <div class="vc-grid">
        <section class="card vc-panel"><h4>Aktivitas 14 hari</h4>${activityHtml(st.p, st.today)}</section>
        <section class="card vc-panel"><h4>Penguasaan per kategori</h4>
          <ul class="vc-tagbars">${byTag.map(x => `<li><span>${esc(tags[x.t])}</span><span class="vc-bar"><i style="width:${Math.round(x.done / x.n * 100)}%"></i></span><b>${x.done}/${x.n}</b></li>`).join('')}</ul>
        </section>
      </div>
      <p class="muted small vc-keys">Pintasan: ${kind === 'kb' ? '<kbd>←</kbd>/<kbd>→</kbd> memilih' : '<kbd>Spasi</kbd> membalik kartu • <kbd>1</kbd>–<kbd>4</kbd> pilih arti'} • <kbd>1</kbd> Lupa <kbd>2</kbd> Ragu <kbd>3</kbd> Ingat setelah jawaban tampil.</p>`;
    body.querySelector('#vcTag').addEventListener('change', (e) => { v.tag = e.target.value; paintHome(box, user, kind); });
    body.querySelectorAll('[data-vc-mode]').forEach(b => b.addEventListener('click', () => { v.mode = b.dataset.vcMode; paintHome(box, user, kind); }));
    body.querySelector('[data-vc-start]').addEventListener('click', () => startSession(box, user, kind, { tag: v.tag }));
    const ea = body.querySelector('[data-vc-early]');
    if (ea) ea.addEventListener('click', () => startSession(box, user, kind, { tag: v.tag, early: true }));
  }

  function paintList(body, user, kind, st) {
    const tags = TAGS[kind];
    const statusText = (x) => {
      if (x.s === 'later') return x.e[0] === 1 ? 'Lupa • ulang ' + whenText(x.e[1] - st.today) : 'Ragu • ulang ' + whenText(x.e[1] - st.today);
      return STATUS[x.s][0];
    };
    body.innerHTML = '<section class="card"><div id="vcList"></div></section>';
    DataSearch.mount({
      container: body.querySelector('#vcList'), items: st.list, stateKey: 'vocab-list-' + kind,
      placeholder: kind === 'kb' ? 'Cari kata baku, bentuk tidak baku, atau contoh…' : 'Cari kata, arti, atau contoh kalimat…',
      fields: x => kind === 'kb' ? [x.it.baku, x.it.salah.join(' '), x.it.contoh, x.it.ket] : [x.it.word, x.it.arti, x.it.def, x.it.contoh, (x.it.sin || []).join(' ')],
      filters: [
        { key: 's', label: 'Semua status', get: x => x.s, options: Object.keys(STATUS).map(k => ({ value: k, label: STATUS[k][0] })) },
        { key: 't', label: 'Semua kategori', get: x => x.it.tag, options: Object.keys(tags).map(k => ({ value: k, label: tags[k] })) }
      ],
      sorts: [
        { key: 'az', label: 'A–Z', cmp: (a, b) => String(a.it.baku || a.it.word).localeCompare(String(b.it.baku || b.it.word), 'id') },
        { key: 'lapse', label: 'Paling sering lupa', cmp: (a, b) => ((b.e || [])[3] || 0) - ((a.e || [])[3] || 0) }
      ],
      pageSize: 30, empty: 'Belum ada kosakata.',
      render: (rows, ctx) => `<ul class="vc-rows">${rows.map(x => `<li class="vc-row">
          <div class="vc-row-main">
            ${kind === 'kb'
              ? `<strong class="vc-baku">${ctx.highlight(x.it.baku)}</strong><span class="vc-salah">${x.it.salah.map(s => `<s>${ctx.highlight(s)}</s>`).join(' ')}</span>`
              : `<strong>${ctx.highlight(x.it.word)}</strong> <em class="muted small">${esc(x.it.pos)}</em> <span class="vc-arti">${ctx.highlight(x.it.arti)}</span>`}
            <p class="vc-ex">${highlight(x.it.contoh, kind === 'kb' ? x.it.baku : x.it.word)}</p>
          </div>
          <div class="vc-row-side"><span class="vc-st ${STATUS[x.s][1]}">${esc(statusText(x))}</span>
            <span class="muted small">${esc(tags[x.it.tag] || x.it.tag || '')}${x.e && x.e[2] ? ` • ${x.e[2]}× diulang` : ''}</span>
            ${kind === 'en' && canSpeak() ? `<button type="button" class="icon-btn" data-vc-say="${esc(x.it.word)}" aria-label="Dengarkan ${esc(x.it.word)}">${SPK}</button>` : ''}</div>
        </li>`).join('')}</ul>`,
      onPaint: (host) => host.querySelectorAll('[data-vc-say]').forEach(b => b.addEventListener('click', () => speak(b.dataset.vcSay)))
    });
  }
  const whenText = (d) => (d <= 0 ? 'hari ini' : d === 1 ? 'besok' : d === 2 ? 'lusa' : d + ' hari lagi');

  /* ---------------- sesi ---------------- */
  function startSession(box, user, kind, opts) {
    const o = opts || {};
    const queue = buildQueue(user, kind, o);
    if (!queue.length) { UI.toast('Tidak ada kartu untuk sesi ini.', 'info'); return; }
    let tok = null;
    try { tok = DB.beginLearning(user.id, DECK[kind].type, '').token; } catch (e) { tok = null; }
    const S = { kind, user, queue, i: 0, log: [], tok, opts: o, started: Date.now(), mode: kind === 'en' ? view.en.mode : 'pick' };
    paintCard(box, S);
  }

  function sessionBar(S) {
    const n = S.queue.length;
    return `<div class="vc-sbar">
      <button type="button" class="btn btn-sm btn-ghost" data-vc-end>Akhiri</button>
      <div class="vc-sprog" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${S.i}" aria-label="Kartu ${Math.min(S.i + 1, n)} dari ${n}"><i style="width:${(S.i / n * 100).toFixed(1)}%"></i></div>
      <span class="vc-scount">${Math.min(S.i + 1, n)}/${n}</span></div>`;
  }
  function gradesHtml(lockIngat) {
    return `<div class="vc-grades" role="group" aria-label="Seberapa kamu mengingat kata ini?">
      <button type="button" class="vc-g g-lupa" data-vc-g="lupa"><kbd>1</kbd><strong>Lupa</strong><small>ulang besok</small></button>
      <button type="button" class="vc-g g-ragu" data-vc-g="ragu"><kbd>2</kbd><strong>Ragu</strong><small>ulang 2 hari lagi</small></button>
      <button type="button" class="vc-g g-ingat" data-vc-g="ingat" ${lockIngat ? 'disabled title="Jawabanmu belum tepat — pilih Lupa atau Ragu"' : ''}><kbd>3</kbd><strong>Ingat</strong><small>${lockIngat ? 'jawaban belum tepat' : 'tidak diulang lagi'}</small></button>
    </div>`;
  }

  function paintCard(box, S) {
    if (S.i >= S.queue.length) return finish(box, S);
    const it = S.queue[S.i];
    const kind = S.kind;
    const card = { revealed: false, correct: null };
    let html;
    if (kind === 'kb') {
      const wrong = it.salah[Math.floor(Math.random() * it.salah.length)];
      const opts = Math.random() < 0.5 ? [it.baku, wrong] : [wrong, it.baku];
      card.opts = opts;
      html = `<div class="vc-card vc-kbcard" aria-live="polite">
        <div class="vc-prompt">${esc(DECK.kb.ask)}<span class="muted small">${esc(TAGS.kb[it.tag] || '')}</span></div>
        <div class="vc-pair">${opts.map((w, k) => `<button type="button" class="vc-pick" data-vc-pick="${k}"><kbd>${k ? '→' : '←'}</kbd><span>${esc(w)}</span></button>`).join('')}</div>
        <div data-vc-reveal></div></div>`;
    } else if (S.mode === 'quiz') {
      const all = items('en').filter(x => x.id !== it.id);
      const same = all.filter(x => x.pos === it.pos);
      const pickFrom = (list, n, taken) => {
        const out = [];
        const pool = list.slice().sort(() => Math.random() - 0.5);
        for (const x of pool) { if (out.length >= n) break; if (!taken.has(x.arti)) { taken.add(x.arti); out.push(x.arti); } }
        return out;
      };
      const taken = new Set([it.arti]);
      let dis = pickFrom(same, 3, taken);
      if (dis.length < 3) dis = dis.concat(pickFrom(all, 3 - dis.length, taken));
      const opts = dis.concat([it.arti]).sort(() => Math.random() - 0.5);
      card.opts = opts;
      html = `<div class="vc-card vc-encard" aria-live="polite">
        <div class="vc-word-row"><div><div class="vc-word">${esc(it.word)}</div><span class="vc-pos">${esc(it.pos)}</span></div>${speakBtn(it.word)}</div>
        <div class="vc-prompt">${esc(DECK.en.ask)}</div>
        <div class="vc-quiz">${opts.map((a, k) => `<button type="button" class="vc-pick" data-vc-pick="${k}"><kbd>${k + 1}</kbd><span>${esc(a)}</span></button>`).join('')}</div>
        <div data-vc-reveal></div></div>`;
    } else {
      html = `<div class="vc-flip" data-vc-flip tabindex="0" role="button" aria-label="Balik kartu ${esc(it.word)}">
        <div class="vc-face vc-front">
          <span class="vc-tagchip">${esc(TAGS.en[it.tag] || it.tag || '')}</span>
          <div class="vc-word">${esc(it.word)}</div><span class="vc-pos">${esc(it.pos)}</span>
          <p class="muted small vc-fliphint">Ingat artinya dulu, lalu ketuk kartu atau tekan Spasi</p>
        </div>
        <div class="vc-face vc-back" data-vc-reveal></div>
      </div>`;
    }
    box.innerHTML = `<div class="vc vc-session">${sessionBar(S)}<div class="vc-stage">${html}</div><div class="vc-after" data-vc-after></div></div>`;
    box.querySelector('[data-vc-end]').addEventListener('click', () => {
      if (S.log.length && S.log.length < S.queue.length && !UI.confirmDialog(`Akhiri sesi sekarang? ${S.log.length} kartu yang sudah dinilai tetap tersimpan.`)) return;
      finish(box, S);
    });
    box.querySelectorAll('[data-vc-say]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.vcSay); }));

    const after = box.querySelector('[data-vc-after]');
    const reveal = (correct) => {
      if (card.revealed) return;
      card.revealed = true;
      card.correct = correct;
      const r = box.querySelector('[data-vc-reveal]');
      if (kind === 'kb') {
        box.querySelectorAll('[data-vc-pick]').forEach(b => {
          const w = card.opts[Number(b.dataset.vcPick)];
          b.disabled = true;
          b.classList.add(w === it.baku ? 'is-key' : 'is-wrong');
        });
        r.innerHTML = `<div class="vc-explain ${correct ? 'is-ok' : 'is-no'}">
          <div class="vc-verdict">${correct ? 'Tepat!' : 'Belum tepat.'} Bentuk baku: <strong>${esc(it.baku)}</strong>
            <span class="vc-salah">${it.salah.map(s => `<s>${esc(s)}</s>`).join(' ')}</span></div>
          <p class="vc-ex">${highlight(it.contoh, it.baku)}</p>
          ${it.ket ? `<p class="vc-rule">${esc(it.ket)}</p>` : ''}</div>`;
      } else {
        if (S.mode === 'quiz') box.querySelectorAll('[data-vc-pick]').forEach(b => {
          const a = card.opts[Number(b.dataset.vcPick)];
          b.disabled = true;
          b.classList.add(a === it.arti ? 'is-key' : (b.classList.contains('is-chosen') ? 'is-wrong' : 'is-dim'));
        });
        r.innerHTML = `<div class="vc-explain ${S.mode === 'quiz' ? (correct ? 'is-ok' : 'is-no') : ''}">
          ${S.mode === 'quiz' ? `<div class="vc-verdict">${correct ? 'Tepat!' : 'Belum tepat.'}</div>` : `<div class="vc-word-row is-small"><div><div class="vc-word">${esc(it.word)}</div><span class="vc-pos">${esc(it.pos)}</span></div>${speakBtn(it.word)}</div>`}
          <div class="vc-arti-big">${esc(it.arti)}</div>
          ${it.def ? `<p class="vc-def">${esc(it.def)}</p>` : ''}
          <p class="vc-ex" lang="en">${highlight(it.contoh, it.word)} ${speakBtn(it.contoh, 'Dengarkan contoh kalimat')}</p>
          ${it.contohId ? `<p class="vc-exid">${esc(it.contohId)}</p>` : ''}
          ${(it.sin || []).length ? `<div class="vc-syn"><span>Sinonim</span>${it.sin.map(s => `<b>${esc(s)}</b>`).join('')}</div>` : ''}</div>`;
        r.querySelectorAll('[data-vc-say]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); speak(b.dataset.vcSay); }));
        const flip = box.querySelector('[data-vc-flip]');
        if (flip) { flip.classList.add('is-flipped'); flip.setAttribute('aria-label', 'Kartu dibalik'); }
      }
      after.innerHTML = gradesHtml(correct === false);
      after.querySelectorAll('[data-vc-g]').forEach(b => b.addEventListener('click', () => grade(b.dataset.vcG)));
      if (correct === false) after.querySelector('[data-vc-g="lupa"]').classList.add('is-suggest');
    };
    const grade = (g) => {
      if (!card.revealed) return;
      if (g === 'ingat' && card.correct === false) return;
      try {
        DB.vocabGrade(S.user.id, kind, it.id, g, card.correct == null ? {} : { correct: card.correct });
      } catch (e) { UI.toast(e.message, 'error'); return; }
      S.log.push({ it, g, correct: card.correct });
      S.i++;
      paintCard(box, S);
    };
    box.querySelectorAll('[data-vc-pick]').forEach(b => b.addEventListener('click', () => {
      if (card.revealed) return;
      b.classList.add('is-chosen');
      const v2 = card.opts[Number(b.dataset.vcPick)];
      reveal(kind === 'kb' ? v2 === it.baku : v2 === it.arti);
    }));
    const flip = box.querySelector('[data-vc-flip]');
    if (flip) {
      flip.addEventListener('click', (e) => { if (!e.target.closest('[data-vc-say]')) reveal(null); });
      flip.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reveal(null); } });
      try { flip.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    }
    onKeys((e) => {
      const k = e.key;
      if (!card.revealed) {
        if (kind === 'kb' && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); box.querySelector(`[data-vc-pick="${k === 'ArrowLeft' ? 0 : 1}"]`).click(); }
        else if (kind === 'en' && S.mode === 'quiz' && /^[1-4]$/.test(k)) { const b = box.querySelector(`[data-vc-pick="${Number(k) - 1}"]`); if (b) b.click(); }
        else if (kind === 'en' && S.mode !== 'quiz' && (k === ' ' || k === 'Enter')) { e.preventDefault(); reveal(null); }
        return;
      }
      const map = { 1: 'lupa', 2: 'ragu', 3: 'ingat' };
      if (map[k]) { e.preventDefault(); grade(map[k]); }
    });
  }
  const speakBtn = (text, label) => (canSpeak() ? `<button type="button" class="icon-btn vc-say" data-vc-say="${esc(text)}" aria-label="${esc(label || 'Dengarkan pelafalan')}">${SPK}</button>` : '');

  function finish(box, S) {
    stop();
    const kind = S.kind;
    const D = DECK[kind];
    const n = S.log.length;
    const graded = S.log.filter(x => x.correct != null);
    const correct = graded.filter(x => x.correct).length;
    const cnt = (g) => S.log.filter(x => x.g === g).length;
    // Kartu yang sudah dinilai tidak lagi jatuh tempo/baru, jadi sesi berikutnya otomatis berisi kartu lain.
    const more = buildQueue(S.user, kind, { tag: S.opts.tag }).length;
    const min = DB.LEARNING_TYPES[D.type].minAnswered;
    box.innerHTML = `<div class="vc vc-done">
      <section class="card vc-summary">
        <div class="vc-eyebrow">${D.icon} Sesi ${esc(D.label)} selesai</div>
        <h3>${n ? `${n} kartu dinilai` : 'Belum ada kartu yang dinilai'}</h3>
        <div class="vc-sum-grid">
          <div class="g-ingat"><strong>${cnt('ingat')}</strong><span>Ingat</span></div>
          <div class="g-ragu"><strong>${cnt('ragu')}</strong><span>Ragu • 2 hari lagi</span></div>
          <div class="g-lupa"><strong>${cnt('lupa')}</strong><span>Lupa • besok</span></div>
          ${graded.length ? `<div><strong>${correct}/${graded.length}</strong><span>pilihan tepat</span></div>` : ''}
        </div>
        <div data-vc-xp class="vc-xp"></div>
        <div class="vc-cta">
          ${more ? `<button type="button" class="btn btn-primary" data-vc-more>Sesi berikutnya • ${Math.min(settings().size, more)} kartu</button>` : ''}
          <button type="button" class="btn btn-secondary" data-vc-home>Kembali</button>
        </div>
      </section>
      ${S.log.some(x => x.g !== 'ingat') ? `<section class="card"><h4>Perlu diulang</h4><ul class="vc-rows">${S.log.filter(x => x.g !== 'ingat').map(x => `<li class="vc-row"><div class="vc-row-main">
        ${kind === 'kb' ? `<strong class="vc-baku">${esc(x.it.baku)}</strong> <span class="vc-salah">${x.it.salah.map(s => `<s>${esc(s)}</s>`).join(' ')}</span>` : `<strong>${esc(x.it.word)}</strong> <span class="vc-arti">${esc(x.it.arti)}</span>`}
        <p class="vc-ex">${highlight(x.it.contoh, kind === 'kb' ? x.it.baku : x.it.word)}</p></div>
        <div class="vc-row-side"><span class="vc-st ${x.g === 'lupa' ? 'is-due' : 'is-later'}">${x.g === 'lupa' ? 'Lupa • besok' : 'Ragu • lusa'}</span></div></li>`).join('')}</ul></section>` : ''}
    </div>`;
    const xpEl = box.querySelector('[data-vc-xp]');
    const back = () => paintHome(box, S.user, kind);
    box.querySelector('[data-vc-home]').addEventListener('click', back);
    const mb = box.querySelector('[data-vc-more]');
    if (mb) mb.addEventListener('click', () => startSession(box, S.user, kind, { tag: S.opts.tag }));
    if (!S.tok || DB.getSettings().streakEnabled === false) return;
    if (n < min) { xpEl.innerHTML = `<p class="muted small">Nilai minimal ${min} kartu dalam satu sesi agar tercatat di streak (${n}/${min}).</p>`; return; }
    const tryRecord = () => {
      const wait = DB.learningTokenWait(S.tok);
      if (wait == null) return;
      if (wait > 0) { xpEl.innerHTML = `<p class="muted small">Mencatat ke streak dalam ${wait} detik…</p>`; timers.push(setTimeout(tryRecord, 1000)); return; }
      try {
        const r = DB.recordLearning(S.user.id, D.type, { token: S.tok, answered: n, total: n, correct: graded.length ? correct : n });
        S.tok = null;
        xpEl.innerHTML = `<p class="vc-xp-ok">${r.entry && r.entry.capped ? 'Tercatat di streak. Batas XP harian kosakata sudah tercapai.' : `Tercatat di streak: +${r.entry ? r.entry.xp : 0} XP`}</p>`;
      } catch (e) { xpEl.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
    };
    tryRecord();
  }

  /* =====================================================================
   * Admin: kelola kosakata
   * ===================================================================*/
  function renderAdmin(host, admin) {
    host.innerHTML = '<div class="card"><span class="spinner"></span> Memuat kosakata…</div>';
    ensureData().then(() => paintAdmin(host, admin)).catch(e => { host.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`; });
  }
  let adminKind = 'kb';
  function paintAdmin(host, admin) {
    const st = settings();
    const kind = adminKind;
    const base = global.VocabData[kind].map(v => Object.assign({}, v, { active: !st.off.has(v.id) }));
    const extra = DB.getVocabItems(kind);
    const all = base.concat(extra);
    const progress = DB.getUsers().filter(u => u.role === 'siswa' && (u.status || 'Aktif') === 'Aktif').map(u => {
      const d = DB.vocabProgress(u.id).decks[kind];
      return Object.values(d.items).filter(e => e[0] === 3).length;
    });
    const learners = progress.filter(n => n > 0).length;
    const avg = learners ? Math.round(progress.filter(n => n > 0).reduce((a, b) => a + b, 0) / learners) : 0;
    host.innerHTML = `<div class="card">
      <div class="card-header">${UI.secHead('🗂️', 'Kosakata Arena', 'Kata Baku & Vocab Inggris untuk mentee • kartu Lupa/Ragu/Ingat')}
        <div class="flex-gap">
          <button type="button" class="btn btn-sm btn-secondary" data-va-tpl>Unduh template</button>
          <label class="btn btn-sm btn-secondary">Impor Excel/CSV<input type="file" accept=".xlsx,.xls,.csv" data-va-file hidden /></label>
          <button type="button" class="btn btn-sm btn-primary" data-va-add>+ Tambah</button>
        </div></div>
      <div class="vc-tabs" role="tablist">${Object.keys(DECK).map(k => `<button type="button" role="tab" aria-selected="${kind === k}" class="vc-tab ${kind === k ? 'is-on' : ''}" data-va-kind="${k}">${esc(DECK[k].label)}</button>`).join('')}</div>
      <form class="form vc-admin-set" data-va-set>
        <label class="check-row"><input type="checkbox" name="enabled" ${st.enabled ? 'checked' : ''} /> Aktifkan latihan kosakata untuk mentee</label>
        <label class="vc-inline">Kartu per sesi <input type="number" name="size" min="10" max="50" value="${st.size}" /></label>
        <button type="submit" class="btn btn-sm btn-secondary">Simpan pengaturan</button>
        <span class="muted small">${all.filter(v => v.active !== false).length} aktif dari ${all.length} • ${learners} mentee belajar • rata-rata ${avg} kata diingat</span>
      </form>
      <div id="vaList"></div></div>`;
    host.querySelectorAll('[data-va-kind]').forEach(b => b.addEventListener('click', () => { adminKind = b.dataset.vaKind; paintAdmin(host, admin); }));
    host.querySelector('[data-va-set]').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const size = Math.round(Number(f.size.value));
      if (!(size >= 10 && size <= 50)) { UI.toast('Kartu per sesi 10–50.', 'error'); return; }
      DB.setSetting('vocabEnabled', f.enabled.checked);
      DB.setSetting('vocabSessionSize', size);
      UI.toast('Pengaturan kosakata disimpan.');
    });
    host.querySelector('[data-va-add]').addEventListener('click', () => openForm(host, admin, kind, null));
    host.querySelector('[data-va-tpl]').addEventListener('click', () => downloadTemplate(kind));
    host.querySelector('[data-va-file]').addEventListener('change', (e) => { const fl = e.target.files[0]; e.target.value = ''; if (fl) importFile(host, admin, kind, fl); });
    DataSearch.mount({
      container: host.querySelector('#vaList'), items: all, stateKey: 'vocab-admin-' + kind,
      placeholder: 'Cari kosakata…',
      fields: v => kind === 'kb' ? [v.baku, (v.salah || []).join(' '), v.contoh, v.tag] : [v.word, v.arti, v.contoh, v.tag],
      filters: [
        { key: 'src', label: 'Semua sumber', get: v => (v.builtin ? 'b' : 'c'), options: [{ value: 'b', label: 'Bawaan' }, { value: 'c', label: 'Tambahan' }] },
        { key: 'on', label: 'Aktif & nonaktif', get: v => (v.active !== false ? 'on' : 'off'), options: [{ value: 'on', label: 'Aktif' }, { value: 'off', label: 'Nonaktif' }] },
        { key: 'tag', label: 'Semua kategori', get: v => v.tag, options: Object.keys(TAGS[kind]).map(k => ({ value: k, label: TAGS[kind][k] })) }
      ],
      pageSize: 25, empty: 'Belum ada kosakata.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table">
        <thead><tr><th>${kind === 'kb' ? 'Baku / tidak baku' : 'Kata / arti'}</th><th>Contoh</th><th>Kategori</th><th>Sumber</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(v => `<tr class="${v.active === false ? 'is-off' : ''}">
          <td>${kind === 'kb' ? `<strong>${ctx.highlight(v.baku)}</strong><div class="muted small">${(v.salah || []).map(s => `<s>${esc(s)}</s>`).join(' ')}</div>`
            : `<strong>${ctx.highlight(v.word)}</strong> <em class="muted small">${esc(v.pos || '')}</em><div class="muted small">${esc(v.arti)}</div>`}</td>
          <td class="small">${esc(v.contoh)}</td>
          <td class="small">${esc(TAGS[kind][v.tag] || v.tag || '-')}</td>
          <td><span class="badge ${v.builtin ? 'badge-gray' : 'badge-info'}">${v.builtin ? 'Bawaan' : 'Tambahan'}</span></td>
          <td class="actions">
            <button type="button" class="btn btn-sm btn-secondary" data-va-toggle="${esc(v.id)}">${v.active === false ? 'Aktifkan' : 'Nonaktifkan'}</button>
            ${v.builtin ? '' : `<button type="button" class="btn btn-sm btn-secondary" data-va-edit="${esc(v.id)}">Edit</button>
              <button type="button" class="btn btn-sm btn-danger" data-va-del="${esc(v.id)}">Hapus</button>`}
          </td></tr>`).join('')}</tbody></table></div>`,
      onPaint: (res) => {
        res.querySelectorAll('[data-va-toggle]').forEach(b => b.addEventListener('click', () => {
          const v = all.find(x => x.id === b.dataset.vaToggle);
          if (!v) return;
          if (v.builtin) {
            const off = new Set(settings().off);
            if (off.has(v.id)) off.delete(v.id); else off.add(v.id);
            DB.setSetting('vocabOff', [...off]);
          } else {
            try { DB.saveVocabItem(Object.assign({}, v, { active: v.active === false }), admin); } catch (e) { UI.toast(e.message, 'error'); return; }
          }
          paintAdmin(host, admin);
        }));
        res.querySelectorAll('[data-va-edit]').forEach(b => b.addEventListener('click', () => openForm(host, admin, kind, extra.find(x => x.id === b.dataset.vaEdit))));
        res.querySelectorAll('[data-va-del]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus kosakata ini? Progres mentee untuk kata ini ikut tidak dipakai lagi.')) return;
          DB.deleteVocabItem(b.dataset.vaDel, admin);
          UI.toast('Kosakata dihapus.');
          paintAdmin(host, admin);
        }));
      }
    });
  }
  function openForm(host, admin, kind, ed) {
    const tagOpts = Object.keys(TAGS[kind]).map(k => `<option value="${esc(k)}" ${ed && ed.tag === k ? 'selected' : ''}>${esc(TAGS[kind][k])}</option>`).join('');
    const v = (k) => esc(ed ? (Array.isArray(ed[k]) ? ed[k].join(', ') : ed[k] || '') : '');
    UI.modal.open(ed ? 'Edit Kosakata' : `Tambah ${DECK[kind].label}`, `<form class="form" id="vaForm">
      ${kind === 'kb' ? `<div class="form-row"><div class="form-group"><label for="vaBaku">Kata baku</label><input id="vaBaku" name="baku" maxlength="60" required value="${v('baku')}" /></div>
        <div class="form-group"><label for="vaSalah">Bentuk tidak baku <span class="muted small">(pisahkan koma)</span></label><input id="vaSalah" name="salah" maxlength="200" required value="${v('salah')}" /></div></div>
        <div class="form-group"><label for="vaKet">Kaidah / keterangan</label><input id="vaKet" name="ket" maxlength="240" value="${v('ket')}" /></div>`
      : `<div class="form-row"><div class="form-group"><label for="vaWord">Kata</label><input id="vaWord" name="word" maxlength="60" required value="${v('word')}" /></div>
        <div class="form-group"><label for="vaPos">Kelas kata</label><input id="vaPos" name="pos" maxlength="20" placeholder="noun, verb, adjective…" value="${v('pos')}" /></div></div>
        <div class="form-group"><label for="vaArti">Arti (Indonesia)</label><input id="vaArti" name="arti" maxlength="140" required value="${v('arti')}" /></div>
        <div class="form-group"><label for="vaDef">Definisi (Inggris)</label><input id="vaDef" name="def" maxlength="200" value="${v('def')}" /></div>`}
      <div class="form-group"><label for="vaContoh">Contoh kalimat</label><textarea id="vaContoh" name="contoh" rows="2" maxlength="300" required>${v('contoh')}</textarea></div>
      ${kind === 'en' ? `<div class="form-group"><label for="vaContohId">Terjemahan contoh</label><textarea id="vaContohId" name="contohId" rows="2" maxlength="300">${v('contohId')}</textarea></div>
        <div class="form-group"><label for="vaSin">Sinonim <span class="muted small">(pisahkan koma)</span></label><input id="vaSin" name="sin" maxlength="200" value="${v('sin')}" /></div>` : ''}
      <div class="form-group"><label for="vaTag">Kategori</label><select id="vaTag" name="tag">${tagOpts}</select></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div>
    </form>`);
    const f = document.getElementById('vaForm');
    f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const rec = { id: ed ? ed.id : null, kind, active: ed ? ed.active !== false : true };
      fd.forEach((val, key) => { rec[key] = val; });
      try { DB.saveVocabItem(rec, admin); } catch (ex) { UI.toast(ex.message, 'error'); return; }
      UI.modal.close();
      UI.toast('Kosakata disimpan.');
      paintAdmin(host, admin);
    });
  }
  const COLS = { kb: ['Kata Baku', 'Tidak Baku', 'Contoh', 'Keterangan', 'Kategori'], en: ['Kata', 'Kelas Kata', 'Arti', 'Definisi', 'Contoh', 'Terjemahan', 'Sinonim', 'Kategori'] };
  function downloadTemplate(kind) {
    if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
    const sample = kind === 'kb'
      ? [{ 'Kata Baku': 'sistem', 'Tidak Baku': 'sistim', Contoh: 'Sistem itu memudahkan pendaftaran.', Keterangan: 'Serapan dari "system".', Kategori: 'serapan' }]
      : [{ Kata: 'reliable', 'Kelas Kata': 'adjective', Arti: 'dapat diandalkan', Definisi: 'able to be trusted', Contoh: 'We need reliable data.', Terjemahan: 'Kita membutuhkan data yang dapat diandalkan.', Sinonim: 'dependable, trustworthy', Kategori: 'akademik' }];
    const ws = XLSX.utils.json_to_sheet(sample, { header: COLS[kind] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, DECK[kind].label);
    XLSX.writeFile(wb, `template_${kind === 'kb' ? 'kata_baku' : 'vocab_inggris'}.xlsx`);
  }
  function importFile(host, admin, kind, file) {
    if (typeof XLSX === 'undefined') { UI.toast('Library Excel belum termuat.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      let rows;
      try { const wb = XLSX.read(ev.target.result, { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); } catch (e) { UI.toast('Berkas tidak dapat dibaca.', 'error'); return; }
      const existing = new Set(items(kind).concat(DB.getVocabItems(kind)).map(v => String(kind === 'kb' ? v.baku : v.word).toLowerCase()));
      const tagOf = (t) => { const k = String(t || '').trim().toLowerCase(); return Object.keys(TAGS[kind]).find(x => x === k || TAGS[kind][x].toLowerCase() === k) || Object.keys(TAGS[kind])[0]; };
      let ok = 0, skip = 0, fail = 0;
      rows.slice(0, 2000).forEach(r => {
        const g = (k) => String(r[k] == null ? '' : r[k]).trim();
        const rec = kind === 'kb'
          ? { kind, baku: g('Kata Baku'), salah: g('Tidak Baku'), contoh: g('Contoh'), ket: g('Keterangan'), tag: tagOf(g('Kategori')) }
          : { kind, word: g('Kata'), pos: g('Kelas Kata'), arti: g('Arti'), def: g('Definisi'), contoh: g('Contoh'), contohId: g('Terjemahan'), sin: g('Sinonim'), tag: tagOf(g('Kategori')) };
        const key = String(kind === 'kb' ? rec.baku : rec.word).toLowerCase();
        if (!key) { fail++; return; }
        if (existing.has(key)) { skip++; return; }
        try { DB.saveVocabItem(rec, admin); existing.add(key); ok++; } catch (e) { fail++; }
      });
      UI.toast(`Impor selesai: ${ok} ditambahkan, ${skip} sudah ada, ${fail} baris tidak lengkap.`, ok ? 'success' : 'info');
      paintAdmin(host, admin);
    };
    reader.readAsArrayBuffer(file);
  }

  global.Vocab = {
    renderKataBaku: (box, user) => render(box, user, 'kb'),
    renderEnglish: (box, user) => render(box, user, 'en'),
    renderAdmin, stop, ensureData, enabled: () => settings().enabled,
    _test: { buildQueue, classify, highlight, items }
  };
})(window);
