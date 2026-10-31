/* =====================================================================
 * js/arena.js — Arena Belajar (aktivitas harian penyala streak)
 * ---------------------------------------------------------------------
 * Tantangan harian, mini quiz, latihan soal, Reading Text + soal
 * pemahaman, dan Games Area. Setiap aktivitas memakai token sesi dari
 * DB.beginLearning sehingga durasi minimum & kelengkapan jawaban
 * divalidasi di lapisan data (DB.recordLearning), bukan oleh tombol UI.
 * Admin mengelola Reading Text dari menu Arena Belajar.
 * ===================================================================*/
(function (global) {
  'use strict';
  const esc = (s) => UI.esc(s);
  let tab = 'challenge';
  let timers = [];
  const clearTimers = () => { timers.forEach(t => { clearInterval(t); clearTimeout(t); }); timers = []; };

  const SYNONYMS = [['cerdas', 'pandai'], ['gigih', 'tekun'], ['rintangan', 'hambatan'], ['ringkas', 'singkat'], ['akurat', 'tepat'],
    ['lazim', 'umum'], ['kendala', 'halangan'], ['mahir', 'cakap'], ['hakikat', 'esensi'], ['sahih', 'valid'], ['khalayak', 'publik'], ['nisbi', 'relatif']];

  function pool(subtest) {
    return DB.getQuestions().filter(q => (q.questionType || 'Pilihan Ganda') === 'Pilihan Ganda'
      && Array.isArray(q.options) && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length
      && (!subtest || q.subject === subtest));
  }
  function shuffle(a, seed) {
    const arr = a.slice();
    let h = seed == null ? Math.random() * 1e9 : seed;
    const rnd = () => { h = (h * 9301 + 49297) % 233280; return h / 233280; };
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor((seed == null ? Math.random() : rnd()) * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  const hashStr = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const today = (user) => DB.ymdInTz(Date.now(), DB.streakTzFor(user));
  const qText = (q) => global.RichText ? RichText.render(q.text || '') : esc(q.text);

  /** Kirim catatan; bila durasi minimum belum terpenuhi, tunggu lalu kirim otomatis. */
  function submitWhenReady(user, type, payload, statusEl, onDone) {
    const wait = DB.learningTokenWait(payload.token);
    const go = () => {
      try {
        const r = DB.recordLearning(user.id, type, payload);
        const xp = r.entry ? r.entry.xp : 0;
        UI.toast(r.entry && r.entry.capped ? 'Tercatat. Batas XP harian aktivitas ini sudah tercapai.' : `Aktivitas tercatat! +${xp} XP 🔥`);
        if (global.Effects && statusEl) Effects.pop && Effects.pop(statusEl);
        onDone(r);
      } catch (err) {
        if (statusEl) statusEl.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
        else UI.toast(err.message, 'error');
      }
    };
    if (wait == null) { if (statusEl) statusEl.innerHTML = '<div class="alert alert-error">Sesi aktivitas berakhir. Mulai ulang.</div>'; return; }
    if (wait <= 0) return go();
    if (statusEl) statusEl.innerHTML = `<div class="alert alert-info">Menyimpan dalam <strong data-left>${wait}</strong> detik (durasi minimum aktivitas)…</div>`;
    const t = setInterval(() => {
      // Hitung ulang dari token (timer tab latar bisa diperlambat browser).
      const left = DB.learningTokenWait(payload.token);
      const el = statusEl && statusEl.querySelector('[data-left]');
      if (el && left != null) el.textContent = left;
      if (left == null || left <= 0 || (statusEl && !statusEl.isConnected)) { clearInterval(t); if (left != null && (!statusEl || statusEl.isConnected)) go(); }
    }, 1000);
    timers.push(t);
  }

  function questionHtml(q, i, name, opts) {
    const o = opts || {};
    return `<fieldset class="ar-q" data-qi="${i}"><legend><span class="ar-qn">${i + 1}</span><div class="rt-content">${qText(q)}</div></legend>
      <div class="ar-opts">${q.options.map((op, k) => `<label class="ar-opt ${o.reveal ? (k === q.correctIndex ? 'is-key' : (o.chosen === k ? 'is-wrong' : '')) : ''}">
        <input type="radio" name="${name}${i}" value="${k}" ${o.chosen === k ? 'checked' : ''} ${o.reveal ? 'disabled' : ''}/>
        <span class="ar-letter">${String.fromCharCode(65 + k)}</span><span>${esc(op)}</span></label>`).join('')}</div>
      ${o.reveal && q.explanation ? `<div class="ar-exp"><strong>Pembahasan:</strong> ${esc(q.explanation)}</div>` : ''}
    </fieldset>`;
  }

  function render(container, user) {
    clearTimers();
    const me = DB.getUser(user.id) || user;
    if (DB.getSettings().streakEnabled === false) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🎮</div>Arena Belajar sedang dinonaktifkan admin.</div>';
      return;
    }
    const s = global.StreakAPI ? StreakAPI.compute(me.id) : null;
    const TABS = [['challenge', '🏆 Tantangan Harian'], ['quiz', '⚡ Mini Quiz'], ['practice', '🧮 Latihan Soal'], ['reading', '📰 Reading Text'], ['games', '🎮 Games Area']];
    container.innerHTML = `
      ${s ? StreakAPI.widgetHtml(me) : ''}
      <div class="tabs">${TABS.map(([k, l]) => `<button type="button" class="tab-btn ${tab === k ? 'active' : ''}" data-ar-tab="${k}">${l}</button>`).join('')}</div>
      <div id="arBox"></div>`;
    if (s) StreakAPI.bindWidget(container);
    container.querySelectorAll('[data-ar-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.arTab; render(container, user); }));
    const box = container.querySelector('#arBox');
    if (tab === 'challenge') return renderChallenge(box, me);
    if (tab === 'quiz') return renderQuiz(box, me);
    if (tab === 'practice') return renderPractice(box, me);
    if (tab === 'reading') return renderReadingList(box, me);
    return renderGames(box, me);
  }

  /* ------------------------- tantangan harian ------------------------- */
  function renderChallenge(box, user) {
    const day = today(user);
    const list = pool();
    const done = DB.getLearningLog(user.id).find(e => e.type === 'tantangan' && e.day === day);
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Bank soal pilihan ganda belum tersedia.</div>'; return; }
    const q = list.slice().sort((a, b) => a.id.localeCompare(b.id))[hashStr(day) % list.length];
    if (done) {
      const chosen = done.meta && done.meta.choice;
      box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('🏆', 'Tantangan Hari Ini Selesai', 'soal baru tersedia besok pukul 00.00')}</div>
        ${questionHtml(q, 0, 'ch', { reveal: true, chosen })}
        <div class="alert ${done.meta && done.meta.correct ? 'alert-success' : 'alert-info'}">${done.meta && done.meta.correct ? '🎉 Jawabanmu benar!' : 'Jawabanmu belum tepat, pelajari pembahasannya.'} +${done.xp} XP</div></div>`;
      return;
    }
    const tok = DB.beginLearning(user.id, 'tantangan', 'ch:' + day);
    box.innerHTML = `<form class="card ar-card" id="arChForm"><div class="card-header">${UI.secHead('🏆', 'Tantangan Akademik Harian', `${esc(q.subject || '')} • satu kesempatan per hari, sama untuk semua mentee`)}</div>
      ${questionHtml(q, 0, 'ch')}
      <div id="arChStatus"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Kunci Jawaban</button></div></form>`;
    const f = box.querySelector('#arChForm');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = f.querySelector('input[name=ch0]:checked');
      if (!v) { UI.toast('Pilih satu jawaban.', 'error'); return; }
      const choice = Number(v.value);
      const correct = choice === q.correctIndex ? 1 : 0;
      f.querySelector('button[type=submit]').disabled = true;
      submitWhenReady(user, 'tantangan', { token: tok.token, answered: 1, total: 1, correct, choice }, f.querySelector('#arChStatus'), () => renderChallenge(box, user));
    });
  }

  /* ------------------------- mini quiz ------------------------- */
  function renderQuiz(box, user) {
    const list = pool();
    if (list.length < 5) { box.innerHTML = '<div class="empty"><div class="empty-icon">📭</div>Mini quiz membutuhkan minimal 5 soal pilihan ganda di Bank Soal.</div>'; return; }
    box.innerHTML = `<div class="card ar-card ar-intro"><div class="card-header">${UI.secHead('⚡', 'Mini Quiz 5 Soal', 'campuran semua subtest • waktu 5 menit')}</div>
      <p class="muted">Kriteria: ${esc(DB.LEARNING_TYPES.miniquiz.criteria)}</p>
      <button class="btn btn-primary" type="button" id="arQuizStart">Mulai Mini Quiz</button></div>`;
    box.querySelector('#arQuizStart').addEventListener('click', () => {
      const qs = shuffle(list).slice(0, 5);
      const tok = DB.beginLearning(user.id, 'miniquiz', '');
      let left = 300;
      box.innerHTML = `<form class="card ar-card" id="arQuizForm"><div class="card-header">${UI.secHead('⚡', 'Mini Quiz', 'jawab semua soal lalu kumpulkan')}
        <span class="ar-timer" id="arTimer" aria-live="polite">05:00</span></div>
        ${qs.map((q, i) => questionHtml(q, i, 'mq')).join('')}
        <div id="arQuizStatus"></div>
        <div class="flex-gap" style="justify-content:space-between;"><span class="muted small" id="arAnswered">0/5 terjawab</span>
          <button class="btn btn-primary" type="submit">Kumpulkan</button></div></form>`;
      const f = box.querySelector('#arQuizForm');
      const count = () => qs.filter((_, i) => f.querySelector(`input[name=mq${i}]:checked`)).length;
      f.addEventListener('change', () => { box.querySelector('#arAnswered').textContent = `${count()}/5 terjawab`; });
      const t = setInterval(() => {
        left--;
        const el = box.querySelector('#arTimer');
        if (!el) { clearInterval(t); return; }
        el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) { clearInterval(t); f.requestSubmit(); }
      }, 1000);
      timers.push(t);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const answers = qs.map((_, i) => { const v = f.querySelector(`input[name=mq${i}]:checked`); return v ? Number(v.value) : null; });
        const answered = answers.filter(a => a != null).length;
        if (answered < 5 && left > 0) { UI.toast('Jawab semua soal sebelum mengumpulkan.', 'error'); return; }
        clearInterval(t);
        const correct = qs.reduce((n, q, i) => n + (answers[i] === q.correctIndex ? 1 : 0), 0);
        const showResult = (msg) => {
          box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('📊', `Skor ${correct}/5`, msg)}</div>
            ${qs.map((q, i) => questionHtml(q, i, 'rv', { reveal: true, chosen: answers[i] })).join('')}
            <button class="btn btn-primary" type="button" id="arAgain">Mini quiz lagi</button></div>`;
          box.querySelector('#arAgain').addEventListener('click', () => renderQuiz(box, user));
        };
        if (answered < 5) { showResult('Waktu habis sebelum semua soal terjawab — aktivitas tidak dihitung.'); return; }
        f.querySelector('button[type=submit]').disabled = true;
        submitWhenReady(user, 'miniquiz', { token: tok.token, answered, total: 5, correct }, f.querySelector('#arQuizStatus'), () => showResult('Mini quiz tercatat sebagai aktivitas belajar.'));
      });
    });
  }

  /* ------------------------- latihan soal ------------------------- */
  function renderPractice(box, user) {
    const all = pool();
    const subjects = [...new Set(all.map(q => q.subject).filter(Boolean))];
    box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('🧮', 'Latihan Soal per Subtest', 'pembahasan langsung setelah menjawab')}</div>
      <p class="muted">Kriteria: ${esc(DB.LEARNING_TYPES.latihan.criteria)}</p>
      ${subjects.length ? `<div class="ar-subjects">${subjects.map(sj => {
        const n = all.filter(q => q.subject === sj).length;
        return `<button type="button" class="ar-subject" data-sj="${esc(sj)}" ${n < 5 ? 'disabled' : ''}><strong>${esc(sj)}</strong><span>${n} soal${n < 5 ? ' • belum cukup (min 5)' : ''}</span></button>`;
      }).join('')}</div>` : '<div class="empty"><div class="empty-icon">📭</div>Bank soal pilihan ganda belum tersedia.</div>'}</div>`;
    box.querySelectorAll('[data-sj]').forEach(b => b.addEventListener('click', () => startPractice(box, user, b.dataset.sj)));
  }
  function startPractice(box, user, subject) {
    const qs = shuffle(pool(subject)).slice(0, 10);
    const tok = DB.beginLearning(user.id, 'latihan', '');
    const answers = new Array(qs.length).fill(null);
    let i = 0;
    const paint = () => {
      const q = qs[i];
      const answered = answers[i] != null;
      box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('🧮', esc(subject), `Soal ${i + 1}/${qs.length} • ${answers.filter(a => a != null).length} terjawab`)}</div>
        <div class="ar-dots">${qs.map((_, k) => `<span class="${k === i ? 'is-cur' : ''} ${answers[k] != null ? (answers[k] === qs[k].correctIndex ? 'is-ok' : 'is-bad') : ''}"></span>`).join('')}</div>
        <form id="arPrForm">${questionHtml(q, i, 'pr', answered ? { reveal: true, chosen: answers[i] } : {})}</form>
        <div id="arPrStatus"></div>
        <div class="flex-gap" style="justify-content:space-between;">
          <button type="button" class="btn btn-secondary" id="arPrFinish">Selesai (${answers.filter(a => a != null).length}/${qs.length})</button>
          <div class="flex-gap">${answered ? '' : '<button type="button" class="btn btn-primary" id="arPrCheck">Periksa</button>'}
            ${i < qs.length - 1 ? `<button type="button" class="btn ${answered ? 'btn-primary' : 'btn-secondary'}" id="arPrNext">Berikutnya →</button>` : ''}</div>
        </div></div>`;
      const check = box.querySelector('#arPrCheck');
      if (check) check.addEventListener('click', () => {
        const v = box.querySelector(`input[name=pr${i}]:checked`);
        if (!v) { UI.toast('Pilih jawaban dulu.', 'error'); return; }
        answers[i] = Number(v.value); paint();
      });
      const nx = box.querySelector('#arPrNext');
      if (nx) nx.addEventListener('click', () => { i++; paint(); });
      box.querySelector('#arPrFinish').addEventListener('click', () => {
        const answered = answers.filter(a => a != null).length;
        const correct = qs.reduce((n, q2, k) => n + (answers[k] === q2.correctIndex ? 1 : 0), 0);
        if (answered < 5) { UI.toast(`Jawab minimal 5 soal agar latihan tercatat (baru ${answered}).`, 'error'); return; }
        box.querySelector('#arPrFinish').disabled = true;
        submitWhenReady(user, 'latihan', { token: tok.token, answered, total: qs.length, correct }, box.querySelector('#arPrStatus'), () => {
          box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('✅', `Latihan selesai: ${correct}/${answered} benar`, esc(subject))}</div>
            <button type="button" class="btn btn-primary" id="arPrBack">Pilih subtest lain</button></div>`;
          box.querySelector('#arPrBack').addEventListener('click', () => renderPractice(box, user));
        });
      });
    };
    paint();
  }

  /* ------------------------- Reading Text ------------------------- */
  function readMinSec(t) {
    const words = DataSearch.plain(t.body).split(/\s+/).filter(Boolean).length;
    return Math.max(45, Math.min(300, Math.round(words / 4 * 0.5)));   // ±50% waktu baca 240 kata/menit
  }
  function renderReadingList(box, user) {
    const day = today(user);
    const log = DB.getLearningLog(user.id).filter(e => e.type === 'reading');
    const texts = DB.getReadingTexts().filter(t => t.active !== false);
    box.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('📰', 'Reading Text', 'baca teks lalu jawab soal pemahaman')}</div><div id="arRtList"></div></div>`;
    DataSearch.mount({
      container: box.querySelector('#arRtList'), items: texts, stateKey: 'arena-rt',
      placeholder: 'Cari judul, isi teks, atau subtest…',
      fields: t => [t.title, DataSearch.plain(t.body), t.subtest, t.level],
      filters: [{ key: 'level', label: 'Semua tingkat', get: t => t.level, options: ['mudah', 'sedang', 'sulit'].map(v => ({ value: v, label: v })) }],
      pageSize: 8, empty: 'Admin belum menambahkan Reading Text.',
      render: (rows, ctx) => `<div class="ar-rt-grid">${rows.map(t => {
        const doneToday = log.some(e => e.refId === 'rt:' + t.id && e.day === day);
        const ever = log.some(e => e.refId === 'rt:' + t.id);
        return `<article class="ar-rt"><span class="badge badge-info">${esc(t.subtest || 'Literasi')}</span>
          <h4>${ctx.highlight(t.title)}</h4><p class="muted small">${esc(DataSearch.plain(t.body).slice(0, 140))}…</p>
          <div class="muted small">${(t.questions || []).length} soal • baca min. ${readMinSec(t)} detik • ${esc(t.level)}</div>
          <button type="button" class="btn btn-sm ${doneToday ? 'btn-secondary' : 'btn-primary'}" data-rt="${t.id}" ${doneToday ? 'disabled' : ''}>
            ${doneToday ? '✓ Selesai hari ini' : ever ? 'Baca lagi' : 'Mulai membaca'}</button></article>`;
      }).join('')}</div>`,
      onPaint: (res) => res.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => openReading(box, user, b.dataset.rt)))
    });
  }
  function openReading(box, user, id) {
    const t = DB.getReadingText(id);
    if (!t) return;
    const minSec = readMinSec(t);
    let tok;
    try { tok = DB.beginLearning(user.id, 'reading', 'rt:' + t.id, { minSec }); } catch (e) { UI.toast(e.message, 'error'); return; }
    box.innerHTML = `<div class="card ar-card ar-reading">
      <button type="button" class="btn btn-sm btn-secondary" id="arRtBack">← Daftar teks</button>
      <h2 class="mt-1">${esc(t.title)}</h2><div class="muted small">${esc(t.subtest || '')} • ${esc(t.level)}</div>
      <div class="ar-read-timer" id="arRtTimer" aria-live="polite">⏱️ Baca dengan saksama — soal dapat dikumpulkan setelah ${minSec} detik.</div>
      <div class="rt-content ar-passage">${RichText.render(t.body)}</div>
      <form id="arRtForm"><h3>Soal Pemahaman</h3>
        ${(t.questions || []).map((q, i) => questionHtml(q, i, 'rq')).join('')}
        <div id="arRtStatus"></div>
        <div class="flex-gap" style="justify-content:flex-end;"><button class="btn btn-primary" type="submit">Kumpulkan Jawaban</button></div></form></div>`;
    box.querySelector('#arRtBack').addEventListener('click', () => renderReadingList(box, user));
    const timer = box.querySelector('#arRtTimer');
    const tk = setInterval(() => {
      const w = DB.learningTokenWait(tok.token);
      if (w == null || !timer.isConnected) { clearInterval(tk); return; }
      timer.textContent = w > 0 ? `⏱️ Waktu baca minimum: ${w} detik lagi` : '✅ Waktu baca minimum terpenuhi. Silakan kumpulkan jawaban.';
      if (w <= 0) clearInterval(tk);
    }, 1000);
    timers.push(tk);
    const f = box.querySelector('#arRtForm');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const qs = t.questions || [];
      const answers = qs.map((_, i) => { const v = f.querySelector(`input[name=rq${i}]:checked`); return v ? Number(v.value) : null; });
      const answered = answers.filter(a => a != null).length;
      if (answered < qs.length) { UI.toast('Jawab semua soal pemahaman.', 'error'); return; }
      const correct = qs.reduce((n, q, i) => n + (answers[i] === q.correctIndex ? 1 : 0), 0);
      f.querySelector('button[type=submit]').disabled = true;
      submitWhenReady(user, 'reading', { token: tok.token, answered, total: qs.length, correct }, f.querySelector('#arRtStatus'), () => {
        f.innerHTML = `<h3>Hasil: ${correct}/${qs.length} benar</h3>${qs.map((q, i) => questionHtml(q, i, 'rr', { reveal: true, chosen: answers[i] })).join('')}`;
      });
    });
  }

  /* ------------------------- Games Area ------------------------- */
  function renderGames(box, user) {
    const day = today(user);
    const played = DB.getLearningLog(user.id).filter(e => e.type === 'games' && e.day === day).length;
    box.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('🎮', 'Games Area', `${played}/${DB.LEARNING_TYPES.games.cap} ronde ber-XP hari ini`)}</div>
      <p class="muted small">Kriteria: ${esc(DB.LEARNING_TYPES.games.criteria)} (skor minimal ${DB.LEARNING_TYPES.games.minScore}).</p>
      <div class="ar-games">
        <button type="button" class="ar-game" data-game="math"><span>⚡➕</span><strong>Kilat Hitung</strong><em>60 detik aritmetika cepat • skor = jawaban benar</em></button>
        <button type="button" class="ar-game" data-game="pairs"><span>🧩</span><strong>Pasangan Kata</strong><em>Cocokkan 6 pasangan sinonim (Literasi)</em></button>
      </div></div>`;
    box.querySelector('[data-game=math]').addEventListener('click', () => gameMath(box, user));
    box.querySelector('[data-game=pairs]').addEventListener('click', () => gamePairs(box, user));
  }
  function gameMath(box, user) {
    const tok = DB.beginLearning(user.id, 'games', '');
    let score = 0, left = 60, q = null;
    const next = () => {
      const op = ['+', '−', '×'][Math.floor(Math.random() * 3)];
      let a = 2 + Math.floor(Math.random() * 18), b = 2 + Math.floor(Math.random() * 12);
      if (op === '−' && b > a) [a, b] = [b, a];
      q = { text: `${a} ${op} ${b}`, ans: op === '+' ? a + b : op === '−' ? a - b : a * b };
    };
    next();
    box.innerHTML = `<div class="card ar-card ar-math"><div class="card-header">${UI.secHead('⚡', 'Kilat Hitung', 'tekan Enter untuk menjawab')}<span class="ar-timer" id="gmT">60</span></div>
      <div class="ar-math-q" id="gmQ" aria-live="polite">${q.text}</div>
      <form id="gmF" class="flex-gap" style="justify-content:center;"><input id="gmA" class="input" inputmode="numeric" autocomplete="off" aria-label="Jawaban" style="max-width:160px;text-align:center;font-size:20px;" />
        <button class="btn btn-primary" type="submit">Jawab</button></form>
      <div class="ar-math-score">Skor: <strong id="gmS">0</strong></div><div id="gmStatus"></div></div>`;
    const inp = box.querySelector('#gmA');
    inp.focus();
    box.querySelector('#gmF').addEventListener('submit', (e) => {
      e.preventDefault();
      if (left <= 0) return;
      if (Number(inp.value) === q.ans) { score++; box.querySelector('#gmS').textContent = score; }
      inp.value = ''; next(); box.querySelector('#gmQ').textContent = q.text;
    });
    const t = setInterval(() => {
      left--;
      const el = box.querySelector('#gmT');
      if (!el) { clearInterval(t); return; }
      el.textContent = left;
      if (left > 0) return;
      clearInterval(t);
      inp.disabled = true;
      const st = box.querySelector('#gmStatus');
      if (score < DB.LEARNING_TYPES.games.minScore) {
        st.innerHTML = `<div class="alert alert-info">Skor ${score}. Butuh minimal ${DB.LEARNING_TYPES.games.minScore} agar ronde tercatat. <button type="button" class="btn btn-sm btn-primary" id="gmAgain">Main lagi</button></div>`;
        st.querySelector('#gmAgain').addEventListener('click', () => gameMath(box, user));
        return;
      }
      submitWhenReady(user, 'games', { token: tok.token, score }, st, () => {
        st.innerHTML = `<div class="alert alert-success">🎉 Skor ${score}! Ronde tercatat. <button type="button" class="btn btn-sm btn-secondary" id="gmBack">Kembali</button></div>`;
        st.querySelector('#gmBack').addEventListener('click', () => renderGames(box, user));
      });
    }, 1000);
    timers.push(t);
  }
  function gamePairs(box, user) {
    const tok = DB.beginLearning(user.id, 'games', '');
    const pairs = shuffle(SYNONYMS).slice(0, 6);
    const cards = shuffle(pairs.flatMap((p, i) => [{ w: p[0], g: i }, { w: p[1], g: i }]));
    let open = [], matched = new Set(), moves = 0;
    const paint = () => {
      box.innerHTML = `<div class="card ar-card"><div class="card-header">${UI.secHead('🧩', 'Pasangan Kata', `${matched.size}/6 pasangan • ${moves} langkah`)}</div>
        <div class="ar-pairs">${cards.map((c, i) => `<button type="button" class="ar-pair ${matched.has(c.g) ? 'is-done' : ''} ${open.includes(i) ? 'is-open' : ''}" data-i="${i}" ${matched.has(c.g) ? 'disabled' : ''}>${esc(c.w)}</button>`).join('')}</div>
        <div id="gpStatus"></div></div>`;
      box.querySelectorAll('.ar-pair:not([disabled])').forEach(b => b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        if (open.includes(i) || open.length === 2) return;
        open.push(i);
        if (open.length === 2) {
          moves++;
          const [a, c] = open;
          if (cards[a].g === cards[c].g) { matched.add(cards[a].g); open = []; }
          else { paint(); const t = setTimeout(() => { open = []; paint(); }, 650); timers.push(t); return; }
        }
        paint();
        if (matched.size === 6) {
          submitWhenReady(user, 'games', { token: tok.token, score: 6 }, box.querySelector('#gpStatus'), () => {
            box.querySelector('#gpStatus').innerHTML = `<div class="alert alert-success">🎉 Semua pasangan cocok dalam ${moves} langkah! <button type="button" class="btn btn-sm btn-secondary" id="gpBack">Kembali</button></div>`;
            box.querySelector('#gpBack').addEventListener('click', () => renderGames(box, user));
          });
        }
      }));
    };
    paint();
  }

  /* ------------------------- materi kelas: "Selesai dibaca" ------------------------- */
  /** Tombol baca untuk materi/modul kelas (siswa). ref = 'mat:<id>' | 'mod:<id>'. */
  function readButtonHtml(user, ref) {
    if (!user || user.role !== 'siswa' || DB.getSettings().streakEnabled === false) return '';
    const done = DB.learnedRefs(user.id, 'materi').has(ref);
    return done ? '<span class="badge badge-success ar-read-done">✓ Sudah dibaca</span>'
      : `<button type="button" class="btn btn-sm btn-secondary" data-ar-read="${esc(ref)}">📖 Mulai membaca</button>`;
  }
  function bindReadButtons(root, user) {
    root.querySelectorAll('[data-ar-read]').forEach(b => b.addEventListener('click', () => {
      const ref = b.dataset.arRead;
      if (b.dataset.token) {
        try {
          const r = DB.recordLearning(user.id, 'materi', { token: b.dataset.token });
          UI.toast(`Materi tercatat dibaca. +${r.entry.xp} XP 📖`);
          b.outerHTML = '<span class="badge badge-success ar-read-done">✓ Sudah dibaca</span>';
        } catch (err) { UI.toast(err.message, 'error'); }
        return;
      }
      let tok;
      try { tok = DB.beginLearning(user.id, 'materi', ref); } catch (err) { UI.toast(err.message, 'error'); return; }
      b.dataset.token = tok.token;
      b.disabled = true;
      const tick = () => {
        const w = DB.learningTokenWait(tok.token);
        if (w == null || !b.isConnected) return false;
        if (w > 0) { b.textContent = `📖 Membaca… ${w} dtk`; return true; }
        b.disabled = false; b.classList.remove('btn-secondary'); b.classList.add('btn-primary');
        b.textContent = '✓ Selesai dibaca';
        return false;
      };
      tick();
      const t = setInterval(() => { if (!tick()) clearInterval(t); }, 1000);
      timers.push(t);
    }));
  }

  /* ------------------------- admin: kelola Reading Text ------------------------- */
  function renderAdmin(container, admin) {
    clearTimers();
    const texts = DB.getReadingTexts();
    const log = DB.getLearningLog();
    const today0 = DB.ymdInTz(Date.now(), DB.getSettings().lmsTimezone || 'WIB');
    const counts = {};
    log.filter(e => e.day === today0 && e.learning).forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    container.innerHTML = `
      <div class="stats-grid">${['tantangan', 'miniquiz', 'latihan', 'reading', 'games', 'materi'].map(k => `<div class="stat-card accent-primary">
        <div class="label">${DB.LEARNING_TYPES[k].icon} ${esc(DB.LEARNING_TYPES[k].label)}</div><div class="value">${counts[k] || 0}</div><div class="sub">tercatat hari ini</div></div>`).join('')}</div>
      <div class="card"><div class="card-header">${UI.secHead('📰', `Reading Text (${texts.length})`, 'teks bacaan + soal pemahaman untuk Arena Belajar mentee')}
        <button type="button" class="btn btn-primary btn-sm" id="rtAdd">+ Tambah Teks</button></div><div id="rtAdmList"></div></div>
      <div class="card"><div class="card-header">${UI.secHead('🏆', 'Tantangan Harian', 'otomatis dari Bank Soal pilihan ganda (sama untuk semua mentee per hari)')}</div>
        <p class="muted small">Soal pilihan ganda tersedia: <strong>${pool().length}</strong>. Mini quiz memerlukan minimal 5 soal; latihan per subtest memerlukan minimal 5 soal per subtest.</p></div>`;
    container.querySelector('#rtAdd').addEventListener('click', () => openReadingForm(container, admin));
    DataSearch.mount({
      container: container.querySelector('#rtAdmList'), items: texts, stateKey: 'arena-rt-admin',
      placeholder: 'Cari judul atau isi…', fields: t => [t.title, DataSearch.plain(t.body), t.subtest],
      pageSize: 10, empty: 'Belum ada Reading Text.',
      render: (rows, ctx) => `<div class="table-wrap"><table class="table"><thead><tr><th>Judul</th><th>Subtest</th><th>Soal</th><th>Dibaca</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>${rows.map(t => `<tr><td><strong>${ctx.highlight(t.title)}</strong><div class="muted small">${esc(t.level)}</div></td><td>${esc(t.subtest || '-')}</td>
          <td>${(t.questions || []).length}</td><td>${log.filter(e => e.refId === 'rt:' + t.id).length}×</td>
          <td>${t.active !== false ? '<span class="badge badge-success">Aktif</span>' : '<span class="badge badge-gray">Nonaktif</span>'}</td>
          <td class="actions"><button type="button" class="btn btn-sm btn-secondary" data-rt-edit="${t.id}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-rt-del="${t.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`,
      onPaint: (res) => {
        res.querySelectorAll('[data-rt-edit]').forEach(b => b.addEventListener('click', () => openReadingForm(container, admin, b.dataset.rtEdit)));
        res.querySelectorAll('[data-rt-del]').forEach(b => b.addEventListener('click', () => {
          if (!UI.confirmDialog('Hapus Reading Text ini?')) return;
          try { DB.deleteReadingText(b.dataset.rtDel, admin); UI.toast('Teks dihapus.'); renderAdmin(container, admin); } catch (e) { UI.toast(e.message, 'error'); }
        }));
      }
    });
  }
  function openReadingForm(container, admin, id) {
    const ed = id ? DB.getReadingText(id) : null;
    const qs = ed ? ed.questions.map(q => Object.assign({}, q, { options: q.options.slice() })) : [{ text: '', options: ['', '', '', ''], correctIndex: 0 }];
    UI.modal.open(ed ? 'Edit Reading Text' : 'Tambah Reading Text', `<form id="rtForm" class="form">
      <div class="form-group"><label>Judul</label><input name="title" class="input" required maxlength="140" value="${esc(ed ? ed.title : '')}" /></div>
      <div class="form-row"><div class="form-group"><label>Subtest</label><select name="subtest" class="input">${DB.SUBTEST_NAMES.map(n => `<option ${ed && ed.subtest === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Tingkat</label><select name="level" class="input">${['mudah', 'sedang', 'sulit'].map(v => `<option ${ed && ed.level === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="check-row" style="margin-top:28px;"><input type="checkbox" name="active" ${!ed || ed.active !== false ? 'checked' : ''}/> Aktif</label></div></div>
      <div class="form-group"><label>Isi teks</label>${Editor.toolbarHtml('rtBody', { noAi: false })}
        <div id="rtBody" class="qe-editor" contenteditable="true" data-ph="Tulis teks bacaan…">${ed ? ed.body : ''}</div></div>
      <div id="rtQs"></div>
      <button type="button" class="btn btn-sm btn-secondary" id="rtAddQ">+ Tambah soal</button>
      <div id="rtErr" class="alert alert-error hidden"></div>
      <div class="flex-gap" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" data-close>Batal</button><button type="submit" class="btn btn-primary">Simpan</button></div></form>`);
    const f = document.getElementById('rtForm');
    Editor.attach(f);
    const qBox = f.querySelector('#rtQs');
    const collect = () => {
      qBox.querySelectorAll('.rt-q').forEach((el, i) => {
        qs[i].text = el.querySelector('[data-f=text]').value;
        qs[i].options = [...el.querySelectorAll('[data-f=opt]')].map(x => x.value);
        const k = el.querySelector('input[type=radio]:checked');
        qs[i].correctIndex = k ? Number(k.value) : -1;
      });
    };
    const paintQs = () => {
      qBox.innerHTML = qs.map((q, i) => `<fieldset class="rt-q"><legend>Soal ${i + 1} ${qs.length > 1 ? `<button type="button" class="btn btn-sm btn-ghost" data-rmq="${i}">Hapus</button>` : ''}</legend>
        <input class="input" data-f="text" placeholder="Pertanyaan" value="${esc(q.text)}" />
        ${q.options.map((o, k) => `<div class="flex-gap mt-1"><input type="radio" name="key${i}" value="${k}" ${q.correctIndex === k ? 'checked' : ''} aria-label="Kunci ${String.fromCharCode(65 + k)}"/>
          <input class="input" data-f="opt" style="flex:1" placeholder="Pilihan ${String.fromCharCode(65 + k)}" value="${esc(o)}" /></div>`).join('')}
        <div class="muted small">Tandai bulatan pada pilihan yang benar.</div></fieldset>`).join('');
      qBox.querySelectorAll('[data-rmq]').forEach(b => b.addEventListener('click', () => { collect(); qs.splice(Number(b.dataset.rmq), 1); paintQs(); }));
    };
    paintQs();
    f.querySelector('#rtAddQ').addEventListener('click', () => { collect(); if (qs.length >= 10) { UI.toast('Maksimal 10 soal.', 'error'); return; } qs.push({ text: '', options: ['', '', '', ''], correctIndex: 0 }); paintQs(); });
    f.querySelector('[data-close]').addEventListener('click', () => UI.modal.close());
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      collect();
      const err = f.querySelector('#rtErr');
      try {
        DB.saveReadingText({ id: ed ? ed.id : null, title: f.title.value, subtest: f.subtest.value, level: f.level.value, active: f.active.checked,
          body: RichText.sanitize(f.querySelector('#rtBody').innerHTML), questions: qs }, admin);
        UI.modal.close(); UI.toast('Reading Text disimpan.'); renderAdmin(container, admin);
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    });
  }

  global.Arena = { render, renderAdmin, readButtonHtml, bindReadButtons, stop: clearTimers };
})(window);
