/* =====================================================================
 * js/qscope.js — Kategori latihan (cakupan soal) bersama
 * ---------------------------------------------------------------------
 * Dipakai Game Battle (main sendiri, battle, lawan bot) dan Arena Belajar
 * (latihan soal). Cakupan disimpan ringkas:
 *   { s: [nama subtest…], t: id materi | null, u: id sub materi | null }
 *   s kosong & t kosong  → semua subtest
 *   s berisi ≥ 1 subtest → per subtest / lebih dari satu subtest
 *   t berisi             → per materi (s = [subtest materi itu]), u = per sub bab
 * Panel juga menampilkan status riwayat jawaban mentee: baru, perlu diulang
 * (pernah salah), dan dikuasai (pernah benar, tidak ditampilkan lagi).
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  const ALL = { s: [], t: null, u: null };

  function normalize(sc) {
    if (typeof sc === 'string') return sc && DB.SUBTEST_NAMES.includes(sc) ? { s: [sc], t: null, u: null } : Object.assign({}, ALL);
    if (!sc || typeof sc !== 'object') return Object.assign({}, ALL);
    const t = global.Topics && sc.t ? Topics.get(sc.t) : null;
    if (t && !t.parentId) {
      const u = sc.u ? Topics.get(sc.u) : null;
      return { s: [t.subtest], t: t.id, u: u && u.parentId === t.id ? u.id : null };
    }
    const s = [...new Set(Array.isArray(sc.s) ? sc.s : [])].filter(n => DB.SUBTEST_NAMES.includes(n));
    const out = { s: DB.SUBTEST_NAMES.filter(n => s.includes(n)), t: null, u: null };
    // Mode "Per materi" yang belum memilih materi tetap diingat (m) agar panel tidak berpindah mode.
    if (sc.m === 'topic' && out.s.length === 1) out.m = 'topic';
    return out;
  }
  /** Bentuk yang disimpan di server (tanpa penanda mode tampilan). */
  const compact = (sc) => { const n = normalize(sc); return { s: n.s, t: n.t, u: n.u }; };
  const isAll = (sc) => { const n = normalize(sc); return !n.s.length && !n.t; };
  const modeOf = (sc) => { const n = normalize(sc); return n.t || n.m === 'topic' ? 'topic' : (n.s.length ? 'subtests' : 'all'); };

  function matches(q, sc) {
    const n = normalize(sc);
    if (!q) return false;
    if (n.t) return q.topicId === n.t && (!n.u || q.subtopicId === n.u);
    return !n.s.length || n.s.includes(q.subject);
  }
  const short = (name) => { const st = DB.subtestByName(name); return st ? st.short : name; };
  function label(sc) {
    const n = normalize(sc);
    if (n.t) {
      const t = Topics.get(n.t), u = n.u ? Topics.get(n.u) : null;
      return `${short(t.subtest)} › ${t.name}${u ? ' › ' + u.name : ''}`;
    }
    if (!n.s.length) return 'Semua subtest';
    if (n.s.length === DB.SUBTEST_NAMES.length) return 'Semua subtest';
    return n.s.map(short).join(', ');
  }
  /** Kunci stabil (riwayat putaran & pencocokan tantangan terbuka). */
  function key(sc) {
    const n = normalize(sc);
    if (n.t) return 't:' + n.t + (n.u ? '/' + n.u : '');
    return n.s.length && n.s.length < DB.SUBTEST_NAMES.length ? 's:' + n.s.map(short).join('+') : 'all';
  }

  const PREF = (ctx, uid) => 'lms_qscope:' + ctx + ':' + uid;
  function load(ctx, uid) {
    try { return normalize(JSON.parse(localStorage.getItem(PREF(ctx, uid)) || 'null')); } catch (e) { return Object.assign({}, ALL); }
  }
  function save(ctx, uid, sc) {
    try { localStorage.setItem(PREF(ctx, uid), JSON.stringify(normalize(sc))); } catch (e) { /* noop */ }
  }

  /** Bilah status riwayat: baru / perlu diulang / dikuasai. */
  function statsHtml(st) {
    if (!st || !st.total) return '<div class="qs-stats is-empty">Belum ada soal pada kategori ini.</div>';
    const w = (n) => (n / st.total * 100).toFixed(1) + '%';
    return `<div class="qs-stats">
      <div class="qs-bar" role="img" aria-label="${st.fresh} baru, ${st.review} perlu diulang, ${st.mastered} dikuasai dari ${st.total} soal">
        <i class="is-fresh" style="width:${w(st.fresh)}"></i><i class="is-review" style="width:${w(st.review)}"></i><i class="is-done" style="width:${w(st.mastered)}"></i></div>
      <div class="qs-legend">
        <span><b class="is-fresh"></b>${st.fresh} baru</span>
        <span><b class="is-review"></b>${st.review} perlu diulang</span>
        <span><b class="is-done"></b>${st.mastered} dikuasai</span>
        <span class="qs-cycle">putaran ${st.cycle} • ${st.total} soal</span>
      </div>
      <p class="qs-note">Soal yang sudah kamu jawab benar tidak muncul lagi. Soal yang salah muncul kembali sampai benar. Setelah semua dikuasai, kategori ini diulang dari awal.</p>
    </div>`;
  }

  /**
   * Pasang panel kategori.
   * o = { scope, onChange(scope), refs(scope) → [ref] (untuk status riwayat), count(subtest) → jumlah soal,
   *       userId, title?, compact? }
   */
  function mount(host, o) {
    let sc = normalize(o.scope);
    let mode = modeOf(sc);
    let topicSub = sc.t ? Topics.get(sc.t).subtest : (sc.s[0] || DB.SUBTEST_NAMES[0]);
    const hasTopics = !!global.Topics;
    const emit = () => { sc = normalize(sc); if (typeof o.onChange === 'function') o.onChange(sc); paint(); };
    function paint() {
      const st = o.refs && o.userId ? DB.qhStats(o.userId, o.refs(sc), key(sc)) : null;
      const topics = hasTopics ? Topics.topicsOf(topicSub) : [];
      const subs = hasTopics && sc.t ? Topics.subsOf(sc.t) : [];
      host.innerHTML = `<section class="qs ${o.compact ? 'is-compact' : ''}" aria-label="Kategori latihan">
        <div class="qs-head"><strong>${esc(o.title || 'Kategori latihan')}</strong><span class="qs-now">${esc(label(sc))}</span></div>
        <div class="qs-modes" role="radiogroup" aria-label="Jenis kategori">
          ${[['all', 'Semua subtest'], ['subtests', 'Pilih subtest'], ['topic', 'Per materi']].filter(m => m[0] !== 'topic' || hasTopics)
            .map(([k, l]) => `<button type="button" role="radio" aria-checked="${mode === k}" class="qs-mode ${mode === k ? 'is-on' : ''}" data-qs-mode="${k}">${l}</button>`).join('')}
        </div>
        ${mode === 'subtests' ? `<div class="qs-chips" role="group" aria-label="Subtest (boleh lebih dari satu)">
          ${DB.SUBTESTS.map(s => {
            const on = sc.s.includes(s.name);
            const n = o.count ? o.count(s.name) : null;
            return `<button type="button" class="qs-chip ${on ? 'is-on' : ''}" aria-pressed="${on}" data-qs-sub="${esc(s.name)}" title="${esc(s.name)}">
              <span>${s.icon} ${esc(s.short)}</span>${n != null ? `<small>${n}</small>` : ''}</button>`;
          }).join('')}
          <span class="qs-hint">Pilih satu atau beberapa subtest.</span></div>` : ''}
        ${mode === 'topic' ? `<div class="qs-topic">
          <label><span>Subtest</span><select data-qs-tsub>${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${s.name === topicSub ? 'selected' : ''}>${s.icon} ${esc(s.short)}</option>`).join('')}</select></label>
          <label><span>Materi</span><select data-qs-topic ${topics.length ? '' : 'disabled'}>
            ${topics.length ? `<option value="">— pilih materi —</option>${topics.map(t => `<option value="${esc(t.id)}" ${sc.t === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}` : '<option value="">Belum ada materi</option>'}</select></label>
          <label><span>Sub bab</span><select data-qs-subt ${subs.length ? '' : 'disabled'}>
            <option value="">${subs.length ? 'Semua sub bab' : '—'}</option>${subs.map(u => `<option value="${esc(u.id)}" ${sc.u === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          ${!topics.length ? '<span class="qs-hint">Tutor/admin belum menyusun Materi & Sub Materi untuk subtest ini.</span>' : ''}
        </div>` : ''}
        ${st ? statsHtml(st) : ''}
      </section>`;
      host.querySelectorAll('[data-qs-mode]').forEach(b => b.addEventListener('click', () => {
        mode = b.dataset.qsMode;
        if (mode === 'all') sc = Object.assign({}, ALL);
        else if (mode === 'subtests') sc = { s: sc.t ? [Topics.get(sc.t).subtest] : (sc.s.length ? sc.s : [DB.SUBTEST_NAMES[0]]), t: null, u: null };
        else { const first = hasTopics ? Topics.topicsOf(topicSub)[0] : null; sc = first ? { s: [topicSub], t: first.id, u: null } : { s: [topicSub], t: null, u: null, m: 'topic' }; }
        emit();
      }));
      host.querySelectorAll('[data-qs-sub]').forEach(b => b.addEventListener('click', () => {
        const n = b.dataset.qsSub;
        const set = new Set(sc.s);
        if (set.has(n)) { if (set.size === 1) { UI.toast('Minimal satu subtest. Pilih "Semua subtest" untuk semuanya.', 'info'); return; } set.delete(n); } else set.add(n);
        sc = { s: [...set], t: null, u: null };
        emit();
      }));
      const tsub = host.querySelector('[data-qs-tsub]');
      if (tsub) tsub.addEventListener('change', () => {
        topicSub = tsub.value;
        const first = Topics.topicsOf(topicSub)[0];
        sc = first ? { s: [topicSub], t: first.id, u: null } : { s: [topicSub], t: null, u: null, m: 'topic' };
        emit();
      });
      const tp = host.querySelector('[data-qs-topic]');
      if (tp) tp.addEventListener('change', () => { sc = tp.value ? { s: [topicSub], t: tp.value, u: null } : { s: [topicSub], t: null, u: null, m: 'topic' }; emit(); });
      const su = host.querySelector('[data-qs-subt]');
      if (su) su.addEventListener('change', () => { sc = { s: [topicSub], t: sc.t, u: su.value || null }; emit(); });
    }
    paint();
    return { get: () => normalize(sc), refresh: paint };
  }

  global.QScope = { normalize, compact, matches, label, key, isAll, modeOf, load, save, mount, statsHtml };
})(window);
