/* =====================================================================
 * js/games.js — Game Battle: 10 game edukasi (pribadi & battle 1 lawan 1)
 * ---------------------------------------------------------------------
 * Mode bermain:
 *  - Pribadi : main sendiri, skor tersimpan & masuk papan peringkat game.
 *  - Battle  : 1 lawan 1 dengan siswa yang sedang online. Lawan dipilih
 *              manual, atau "Cari Otomatis" — bot matchmaking mendeteksi
 *              siswa online (prioritas yang sedang membuka Game Battle),
 *              mengirim undangan, dan mengambil tantangan terbuka.
 *  - Lawan Bot: latihan battle melawan bot (Mudah/Sedang/Sulit).
 * Battle berbentuk "balapan": kedua pemain mendapat soal & urutan pilihan
 * yang sama (seed sama), mulai bersamaan, dan melihat skor lawan langsung.
 *
 * Sumber soal: Bank Soal (lms_questions) dan Soal Game (lms_game_questions,
 * dikelola di js/games-admin.js) — diatur admin. Semua format soal sistem
 * (kecuali Esai) didukung; tiap game memakai format yang cocok dengannya.
 *
 * Data (tersinkron): lms_game_questions, lms_game_battles, lms_game_scores.
 * Preferensi perangkat (lokal): lms_game_prefs (suara).
 * ===================================================================*/
(function (global) {
  'use strict';
  // Isi lingkaran avatar: avatar almamater / foto / inisial (js/avatars.js).
  const AV = (u) => (global.Avatars ? Avatars.inner(u) : UI.esc(UI.initials(u && u.name)));

  const K = { q: 'lms_game_questions', battles: 'lms_game_battles', scores: 'lms_game_scores' };
  const PREF_KEY = 'lms_game_prefs';
  const PAGE = 'game-battle';
  const INVITE_TTL = 2 * 60000;         // undangan/tantangan terbuka berlaku 2 menit
  const START_DELAY = 6000;             // hitung mundur sebelum battle dimulai
  const BATTLE_GRACE = 45000;           // batas tunggu lawan setelah waktu game habis
  const esc = (s) => UI.esc(s);
  const rt = (html) => `<span class="rt-content">${RichText.render(html || '')}</span>`;
  const plain = (html, n) => RichText.plain(html || '', n || 400).trim();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const server = () => !!(global.Sync && Sync.isServer && Sync.isServer());
  const reducedMotion = () => !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID');

  /* ================================================================
   * Penyimpanan
   * ==============================================================*/
  function load(k) {
    try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function save(k, arr) { localStorage.setItem(k, JSON.stringify(arr)); }
  function upsert(k, rec) {
    const all = load(k);
    const i = all.findIndex(x => x.id === rec.id);
    if (i >= 0) all[i] = rec; else all.push(rec);
    save(k, all);
    return rec;
  }
  function removeRec(k, id) { save(k, load(k).filter(x => x.id !== id)); }

  const getGameQuestions = () => load(K.q);
  const getBattles = () => load(K.battles);
  const getBattle = (id) => getBattles().find(b => b.id === id) || null;
  const getScores = () => load(K.scores);

  function settings() {
    const st = DB.getSettings();
    return {
      enabled: st.gamesEnabled !== false,
      battle: st.gameBattleEnabled !== false,
      bot: st.gameBotEnabled !== false,
      source: ['both', 'game', 'bank'].includes(st.gameSource) ? st.gameSource : 'both',
      disabled: Array.isArray(st.gameDisabled) ? st.gameDisabled : []
    };
  }

  function prefs() {
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function setPref(patch) { try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(prefs(), patch))); } catch (e) { /* noop */ } }

  /* ================================================================
   * Acak deterministik (seed sama → urutan sama untuk kedua pemain)
   * ==============================================================*/
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ================================================================
   * Suara (WebAudio, tanpa berkas) — dapat dimatikan
   * ==============================================================*/
  let actx = null;
  function beep(kind) {
    if (prefs().sound === false) return;
    try {
      actx = actx || new (global.AudioContext || global.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const seq = { ok: [[660, 0.08], [880, 0.12]], bad: [[220, 0.18]], tick: [[520, 0.05]], win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.22]], pop: [[900, 0.05]], go: [[440, 0.12], [880, 0.2]] }[kind] || [[600, 0.08]];
      let t = actx.currentTime;
      seq.forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = kind === 'bad' ? 'sawtooth' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + d + 0.02);
        t += d * 0.9;
      });
    } catch (e) { /* audio tidak tersedia */ }
  }

  /* ================================================================
   * Soal: validitas per format & kumpulan soal tiap game
   * ==============================================================*/
  const fmtOf = (q) => q.questionType || 'Pilihan Ganda';
  const optCount = (q) => (Array.isArray(q.options) ? q.options.filter(o => plain(o)).length : 0);
  /** Kolom Majemuk Kompleks berupa Benar/Salah? (dipakai BS Turbo). */
  function boolColumns(q) {
    const cols = DB.qMatrixColumns(q).map(c => String(c).toLowerCase().trim());
    return cols.length === 2 && cols[0] === 'benar' && cols[1] === 'salah';
  }
  /** Soal dapat dinilai otomatis & lengkap? */
  function autoValid(q) {
    if (!q || !q.text) return false;
    const f = fmtOf(q);
    switch (f) {
      case 'Pilihan Ganda': return optCount(q) >= 2 && q.correctIndex >= 0 && q.correctIndex < (q.options || []).length;
      case 'Pilihan Lebih dari Satu': return optCount(q) >= 2 && Array.isArray(q.correctIndices) && q.correctIndices.length > 0;
      case 'Benar/Salah': return q.correctIndex === 0 || q.correctIndex === 1;
      case 'Isian Singkat': return Array.isArray(q.answers) && q.answers.some(a => String(a).trim());
      case 'Benar/Salah Majemuk': return Array.isArray(q.statements) && q.statements.length >= 1;
      case 'Majemuk Kompleks': return Array.isArray(q.statements) && q.statements.length >= 1 && DB.qMatrixKeys(q).every(k => k != null);
      case 'Menjodohkan': return Array.isArray(q.pairs) && q.pairs.length >= 2;
      case 'Urutan': return Array.isArray(q.orderItems) && q.orderItems.length >= 2;
      default: return false;
    }
  }

  /** Semua soal sumber (sesuai pengaturan admin), ditandai asalnya. */
  function sourceQuestions() {
    const src = settings().source;
    const out = [];
    if (src !== 'bank') getGameQuestions().filter(q => q.active !== false).forEach(q => out.push(Object.assign({}, q, { _ref: 'g:' + q.id })));
    if (src !== 'game') DB.getQuestions().forEach(q => out.push(Object.assign({}, q, { _ref: 'b:' + q.id })));
    return out;
  }
  function resolveRef(ref) {
    const m = /^([gb]):(.+)$/.exec(String(ref || ''));
    if (!m) return null;
    const q = m[1] === 'g' ? getGameQuestions().find(x => x.id === m[2]) : DB.getQuestion(m[2]);
    return q ? Object.assign({}, q, { _ref: ref }) : null;
  }
  /** Kumpulan soal untuk satu game (opsional filter subtest). */
  function poolFor(game, subject) {
    return sourceQuestions().filter(q => {
      if (subject && q.subject !== subject) return false;
      if (Array.isArray(q.games) && q.games.length && !q.games.includes(game.id)) return false;
      return autoValid(q) && game.accepts(q);
    });
  }
  /** Banyaknya "unit" bermain dari kumpulan (mis. pernyataan/pasangan), untuk syarat minimum. */
  const unitsOf = (game, pool) => (game.units ? game.units(pool) : pool.length);

  /* ================================================================
   * AnswerUI — input jawaban semua format otomatis, keluaran sesuai
   * bentuk jawaban Exam.gradeQuestion (dipakai beberapa game).
   * ==============================================================*/
  const L = (i) => String.fromCharCode(65 + i);
  function keyText(q) {
    const f = fmtOf(q);
    if (f === 'Pilihan Ganda') return `${L(q.correctIndex)}. ${plain((q.options || [])[q.correctIndex], 120)}`;
    if (f === 'Pilihan Lebih dari Satu') return (q.correctIndices || []).map(i => `${L(i)}. ${plain((q.options || [])[i], 60)}`).join(' • ');
    return DB.qKeyText(q);
  }
  const bsLabels = (q) => {
    const o = (q.options || []).map(x => plain(x, 30));
    return o.length === 2 && o[0] && o[1] ? o : ['Benar', 'Salah'];
  };

  const AnswerUI = {
    /**
     * @param {object} q soal
     * @param {HTMLElement} host
     * @param {(ans:any)=>void} onSubmit
     * @param {object} [o] { rng }
     * @returns {{lock():void, reveal(correct:boolean):void, hide(indices:number[]):void}}
     */
    render(q, host, onSubmit, o) {
      const f = fmtOf(q);
      const rng = (o && o.rng) || Math.random;
      let locked = false;
      const submit = (ans) => { if (locked) return; locked = true; host.classList.add('is-locked'); onSubmit(ans); };
      const api = {
        lock() { locked = true; host.classList.add('is-locked'); host.querySelectorAll('button, input, select').forEach(el => { el.disabled = true; }); },
        reveal(correct) {
          api.lock();
          host.querySelectorAll('[data-key="1"]').forEach(el => el.classList.add('is-key'));
          if (!correct) host.querySelectorAll('.is-picked:not([data-key="1"])').forEach(el => el.classList.add('is-wrong'));
        },
        hide(indices) { indices.forEach(i => { const b = host.querySelector(`[data-opt="${i}"]`); if (b) { b.disabled = true; b.classList.add('is-gone'); } }); }
      };

      if (f === 'Pilihan Ganda' || f === 'Benar/Salah') {
        const labels = f === 'Benar/Salah' ? bsLabels(q) : (q.options || []);
        host.innerHTML = `<div class="gb-opts ${f === 'Benar/Salah' ? 'is-bs' : ''}">${labels.map((opt, i) => `
          <button type="button" class="gb-opt" data-opt="${i}" data-key="${i === q.correctIndex ? 1 : 0}">
            <span class="gb-opt-l">${f === 'Benar/Salah' ? (i === 0 ? '✔' : '✖') : L(i)}</span><span class="gb-opt-t">${f === 'Benar/Salah' ? esc(opt) : rt(opt)}</span>
          </button>`).join('')}</div>`;
        host.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
          if (locked) return;
          b.classList.add('is-picked');
          submit(Number(b.dataset.opt));
        }));
        return api;
      }
      if (f === 'Pilihan Lebih dari Satu') {
        const key = new Set(q.correctIndices || []);
        host.innerHTML = `<div class="gb-hint">Pilih semua jawaban yang benar, lalu tekan Kirim.</div>
          <div class="gb-opts">${(q.options || []).map((opt, i) => `
            <button type="button" class="gb-opt" data-opt="${i}" data-key="${key.has(i) ? 1 : 0}" aria-pressed="false">
              <span class="gb-opt-l">${L(i)}</span><span class="gb-opt-t">${rt(opt)}</span></button>`).join('')}</div>
          <button type="button" class="btn btn-primary gb-send">Kirim Jawaban</button>`;
        host.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
          if (locked) return;
          b.classList.toggle('is-picked');
          b.setAttribute('aria-pressed', String(b.classList.contains('is-picked')));
        }));
        host.querySelector('.gb-send').addEventListener('click', () => {
          const picks = [...host.querySelectorAll('.gb-opt.is-picked')].map(b => Number(b.dataset.opt));
          if (!picks.length) { UI.toast('Pilih minimal satu jawaban.', 'info'); return; }
          submit(picks);
        });
        return api;
      }
      if (f === 'Isian Singkat') {
        host.innerHTML = `<form class="gb-isian" autocomplete="off">
            <input type="text" class="gb-input" maxlength="120" placeholder="Ketik jawabanmu…" aria-label="Jawaban" ${q.numeric ? 'inputmode="decimal"' : ''} />
            <button type="submit" class="btn btn-primary">Kirim</button>
          </form>`;
        const inp = host.querySelector('input');
        setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch (e) { /* noop */ } }, 50);
        host.querySelector('form').addEventListener('submit', (e) => {
          e.preventDefault();
          if (!inp.value.trim()) { UI.toast('Jawaban masih kosong.', 'info'); return; }
          submit(inp.value.trim());
        });
        api.reveal = (correct) => {
          api.lock();
          inp.classList.add(correct ? 'is-key' : 'is-wrong');
        };
        return api;
      }
      if (f === 'Benar/Salah Majemuk' || f === 'Majemuk Kompleks') {
        const cols = f === 'Majemuk Kompleks' ? DB.qMatrixColumns(q) : ['Benar', 'Salah'];
        const keys = f === 'Majemuk Kompleks' ? DB.qMatrixKeys(q) : (q.statements || []).map(s => (s.value ? 0 : 1));
        const pick = new Array((q.statements || []).length).fill(null);
        host.innerHTML = `<div class="gb-matrix">${(q.statements || []).map((s, r) => `
            <div class="gb-mrow"><div class="gb-mtext">${r + 1}. ${rt(s.text)}</div>
              <div class="gb-mcols">${cols.map((c, ci) => `<button type="button" class="gb-mcell" data-r="${r}" data-c="${ci}" data-key="${keys[r] === ci ? 1 : 0}">${esc(c)}</button>`).join('')}</div>
            </div>`).join('')}</div>
          <button type="button" class="btn btn-primary gb-send">Kirim Jawaban</button>`;
        host.querySelectorAll('.gb-mcell').forEach(b => b.addEventListener('click', () => {
          if (locked) return;
          const r = Number(b.dataset.r);
          pick[r] = Number(b.dataset.c);
          host.querySelectorAll(`.gb-mcell[data-r="${r}"]`).forEach(x => x.classList.toggle('is-picked', x === b));
        }));
        host.querySelector('.gb-send').addEventListener('click', () => {
          if (pick.some(v => v == null)) { UI.toast('Jawab semua pernyataan terlebih dahulu.', 'info'); return; }
          submit(f === 'Majemuk Kompleks' ? pick.slice() : pick.map(v => v === 0));
        });
        return api;
      }
      if (f === 'Menjodohkan') {
        const pairs = q.pairs || [];
        const rights = shuffle(pairs.map(p => p.right), rng);
        host.innerHTML = `<div class="gb-match">${pairs.map((p, i) => `
            <div class="gb-mrow"><div class="gb-mtext">${rt(p.left)}</div>
              <select class="gb-select" data-i="${i}" aria-label="Pasangan ${i + 1}">
                <option value="">— pilih pasangan —</option>
                ${rights.map((r, ri) => `<option value="${ri}">${esc(plain(r, 80))}</option>`).join('')}
              </select></div>`).join('')}</div>
          <button type="button" class="btn btn-primary gb-send">Kirim Jawaban</button>`;
        host.querySelector('.gb-send').addEventListener('click', () => {
          const sel = [...host.querySelectorAll('.gb-select')];
          if (sel.some(s => s.value === '')) { UI.toast('Pasangkan semua item terlebih dahulu.', 'info'); return; }
          submit(sel.map(s => rights[Number(s.value)]));
        });
        api.reveal = (correct) => {
          api.lock();
          host.querySelectorAll('.gb-select').forEach((s, i) => {
            const ok = s.value !== '' && plain(rights[Number(s.value)]) === plain(pairs[i].right);
            s.classList.add(ok ? 'is-key' : 'is-wrong');
          });
          if (!correct) host.insertAdjacentHTML('beforeend', `<div class="gb-keyline">Kunci: ${esc(DB.qKeyText(q))}</div>`);
        };
        return api;
      }
      if (f === 'Urutan') {
        const items = (q.orderItems || []).map((t, i) => ({ t, i }));
        const pool = shuffle(items, rng);
        const seq = [];
        const paint = () => {
          host.innerHTML = `<div class="gb-hint">Ketuk item sesuai urutan yang benar. Ketuk item di atas untuk membatalkan.</div>
            <ol class="gb-seq">${seq.map((it, k) => `<li><button type="button" class="gb-chip is-picked" data-back="${k}">${rt(it.t)}</button></li>`).join('') || '<li class="gb-seq-empty">Belum ada item</li>'}</ol>
            <div class="gb-pool">${pool.filter(it => !seq.includes(it)).map(it => `<button type="button" class="gb-chip" data-add="${it.i}">${rt(it.t)}</button>`).join('')}</div>
            <button type="button" class="btn btn-primary gb-send" ${seq.length === items.length ? '' : 'disabled'}>Kirim Urutan</button>`;
          host.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
            if (locked) return;
            seq.push(items[Number(b.dataset.add)]); paint();
          }));
          host.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
            if (locked) return;
            seq.splice(Number(b.dataset.back), 1); paint();
          }));
          host.querySelector('.gb-send').addEventListener('click', () => { if (seq.length === items.length) submit(seq.map(it => it.t)); });
        };
        paint();
        api.reveal = (correct) => {
          api.lock();
          host.querySelectorAll('.gb-seq li').forEach((li, k) => li.classList.add(seq[k] && seq[k].i === k ? 'is-key' : 'is-wrong'));
          if (!correct) host.insertAdjacentHTML('beforeend', `<div class="gb-keyline">Urutan benar: ${esc(DB.qKeyText(q))}</div>`);
        };
        api.sequence = () => seq.map(it => it.i);
        return api;
      }
      host.innerHTML = '<div class="muted">Format soal tidak didukung.</div>';
      return api;
    }
  };

  /** Kartu soal (kepala) dengan subtest & tingkat. */
  function qCardHtml(q, idx, total, extra) {
    const st = DB.subtestByName(q.subject);
    return `<div class="gb-qhead">
        <span class="gb-qnum">${idx}/${total}</span>
        <span class="gb-chip-s">${st ? st.icon + ' ' + esc(st.short) : esc(q.subject || 'Umum')}</span>
        <span class="gb-chip-s d-${esc(q.difficulty || 'sedang')}">${esc(q.difficulty || 'sedang')}</span>
        ${extra || ''}
      </div>
      <div class="gb-qtext">${rt(q.text)}</div>`;
  }

  /**
   * Satu giliran soal standar: render soal + jawaban + timer + umpan balik.
   * onResult({correct, timedOut, left, ans, ui}) — panggil next() sendiri.
   */
  function askTurn(ctx, q, idx, total, seconds, onResult, opts) {
    const o = opts || {};
    ctx.stage.innerHTML = `<div class="gb-turn">${qCardHtml(q, idx, total, o.extra)}<div class="gb-ans"></div><div class="gb-fb" aria-live="polite"></div></div>`;
    const ansEl = ctx.stage.querySelector('.gb-ans');
    const fbEl = ctx.stage.querySelector('.gb-fb');
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      t.stop();
      ui.reveal(res.correct);
      fbEl.innerHTML = res.correct ? `<div class="gb-good">✅ Benar!${res.msg ? ' ' + res.msg : ''}</div>`
        : `<div class="gb-badfb">${res.timedOut ? '⏰ Waktu habis.' : '❌ Belum tepat.'} <span>Kunci: ${esc(keyText(q))}</span></div>`;
      ctx.flash(res.correct);
      onResult(Object.assign(res, { ui, fb: fbEl }));
    };
    const ui = AnswerUI.render(q, ansEl, (ans) => {
      const g = Exam.gradeQuestion(q, ans);
      finish({ correct: !!g.correct, timedOut: false, left: t.left(), ans });
    }, { rng: ctx.rng });
    const t = ctx.timer(seconds, () => finish({ correct: false, timedOut: true, left: 0, ans: null }));
    if (o.onReady) o.onReady(ui, t);
    return { ui, timer: t, isDone: () => done, finish };
  }

  /* ================================================================
   * Katalog 10 game
   *  accepts(q)  : soal cocok untuk game ini?
   *  min         : minimal unit (soal/pernyataan/pasangan) agar bisa main
   *  pick(pool)  : pilih soal untuk satu ronde (deterministik dengan rng)
   *  limitSec    : batas waktu terlama satu ronde (untuk battle)
   *  bot         : model skor lawan bot { units, sec, per, wrong, ... }
   *  play(ctx)   : jalankan game di ctx.stage
   * ==============================================================*/
  const ALL_AUTO = ['Pilihan Ganda', 'Pilihan Lebih dari Satu', 'Benar/Salah', 'Isian Singkat', 'Benar/Salah Majemuk', 'Majemuk Kompleks', 'Menjodohkan', 'Urutan'];
  const DIFF_ORDER = { mudah: 0, sedang: 1, sulit: 2 };
  const gainHtml = (n) => `<span class="gb-gain ${n >= 0 ? 'is-up' : 'is-down'}">${n >= 0 ? '+' : ''}${fmt(n)}</span>`;

  /* ---------- kartu Benar/Salah dari beberapa format ---------- */
  function bsCards(qs) {
    const out = [];
    qs.forEach(q => {
      const f = fmtOf(q);
      if (f === 'Benar/Salah') out.push({ stem: '', text: q.text, value: q.correctIndex === 0, ref: q._ref });
      else if (f === 'Benar/Salah Majemuk') (q.statements || []).forEach(s => out.push({ stem: plain(q.text, 180), text: s.text, value: !!s.value, ref: q._ref }));
      else if (f === 'Majemuk Kompleks' && boolColumns(q)) {
        const keys = DB.qMatrixKeys(q);
        (q.statements || []).forEach((s, i) => out.push({ stem: plain(q.text, 180), text: s.text, value: keys[i] === 0, ref: q._ref }));
      }
    });
    return out;
  }

  /* ---------- pasangan memori ---------- */
  function memoryPairs(qs) {
    const out = [];
    qs.forEach(q => {
      const f = fmtOf(q);
      if (f === 'Menjodohkan') (q.pairs || []).forEach(p => {
        if (plain(p.left).length <= 70 && plain(p.right).length <= 70) out.push({ a: p.left, b: p.right });
      });
      else if (f === 'Pilihan Ganda' && plain(q.text).length <= 70) {
        const k = (q.options || [])[q.correctIndex];
        if (k && plain(k).length <= 40) out.push({ a: q.text, b: k });
      }
    });
    return out;
  }
  const shortOptions = (q) => (q.options || []).every(o => plain(o).length <= 60);

  const GAMES = [
    /* 1 ─────────────────────────────── Kuis Kilat */
    {
      id: 'kilat', name: 'Kuis Kilat', icon: '⚡', color: '#f59e0b', tag: 'Kecepatan & combo',
      desc: '10 soal, 15 detik per soal. Makin cepat makin besar bonusnya, dan jawaban benar beruntun melipatgandakan combo.',
      formats: ['Pilihan Ganda', 'Benar/Salah', 'Pilihan Lebih dari Satu'],
      accepts: q => ['Pilihan Ganda', 'Benar/Salah', 'Pilihan Lebih dari Satu'].includes(fmtOf(q)),
      min: 5, limitSec: 10 * 15 + 30,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 10),
      bot: { units: 10, sec: 8, per: 165, wrong: 0 },
      play(ctx) {
        let i = 0, combo = 0;
        const next = () => {
          if (i >= ctx.qs.length) return ctx.finish();
          const q = ctx.qs[i++];
          ctx.info(combo >= 2 ? `🔥 Combo ×${combo}` : '');
          askTurn(ctx, q, i, ctx.qs.length, 15, (r) => {
            ctx.mark(r.correct);
            if (r.correct) {
              combo++;
              const gain = 100 + Math.round(r.left / 15 * 100) + Math.min(100, (combo - 1) * 20);
              ctx.add(gain);
              r.fb.insertAdjacentHTML('beforeend', gainHtml(gain));
            } else combo = 0;
            ctx.after(1300, next);
          });
        };
        next();
      }
    },
    /* 2 ─────────────────────────────── Benar–Salah Turbo */
    {
      id: 'bsturbo', name: 'Benar–Salah Turbo', icon: '🚦', color: '#10b981', tag: '60 detik kilat',
      desc: 'Tebak benar atau salah sebanyak mungkin pernyataan dalam 60 detik. Benar +50, salah −25, beruntun dapat bonus. Bisa pakai tombol ← (Benar) dan → (Salah).',
      formats: ['Benar/Salah', 'Benar/Salah Majemuk', 'Majemuk Kompleks (kolom Benar | Salah)'],
      accepts: q => fmtOf(q) === 'Benar/Salah' || fmtOf(q) === 'Benar/Salah Majemuk' || (fmtOf(q) === 'Majemuk Kompleks' && boolColumns(q)),
      units: (pool) => bsCards(pool).length, min: 8, limitSec: 60 + 20,
      pick: (pool, rng) => {
        const qs = shuffle(pool, rng), out = [];
        let n = 0;
        for (const q of qs) { out.push(q); n += bsCards([q]).length; if (n >= 40) break; }
        return out;
      },
      bot: { units: 22, sec: 2.6, per: 70, wrong: -25, timeSec: 60 },
      play(ctx) {
        const cards = shuffle(bsCards(ctx.qs), ctx.rng).slice(0, 40);
        let i = 0, streak = 0, over = false;
        const t = ctx.timer(60, () => { over = true; ctx.finish(); });
        const show = () => {
          if (over) return;
          if (i >= cards.length) { t.stop(); return ctx.finish(); }
          const c = cards[i];
          ctx.info(streak >= 3 ? `🔥 Beruntun ${streak}` : `Kartu ${i + 1}/${cards.length}`);
          ctx.stage.innerHTML = `<div class="gb-bs">
              ${c.stem ? `<div class="gb-bs-stem">${esc(c.stem)}</div>` : ''}
              <div class="gb-bs-card">${rt(c.text)}</div>
              <div class="gb-bs-btns">
                <button type="button" class="gb-bs-b is-true" data-v="1"><span>←</span> Benar</button>
                <button type="button" class="gb-bs-b is-false" data-v="0">Salah <span>→</span></button>
              </div><div class="gb-fb" aria-live="polite"></div></div>`;
          ctx.stage.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => answer(b.dataset.v === '1')));
        };
        let busy = false;
        const answer = (v) => {
          if (busy || over) return;
          busy = true;
          const c = cards[i];
          const ok = v === c.value;
          ctx.mark(ok);
          let gain;
          if (ok) { streak++; gain = 50 + Math.min(100, Math.max(0, streak - 2) * 10); } else { streak = 0; gain = -25; }
          ctx.add(gain);
          ctx.flash(ok);
          const fb = ctx.stage.querySelector('.gb-fb');
          if (fb) fb.innerHTML = `${ok ? '<div class="gb-good">✅ Tepat</div>' : `<div class="gb-badfb">❌ Jawaban: ${c.value ? 'Benar' : 'Salah'}</div>`}${gainHtml(gain)}`;
          const card = ctx.stage.querySelector('.gb-bs-card');
          if (card) card.classList.add(ok ? 'is-ok' : 'is-no');
          ctx.after(ok ? 380 : 900, () => { busy = false; i++; show(); });
        };
        const onKey = (e) => {
          if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'b') { e.preventDefault(); answer(true); }
          else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 's') { e.preventDefault(); answer(false); }
        };
        document.addEventListener('keydown', onKey);
        ctx.onDispose(() => document.removeEventListener('keydown', onKey));
        show();
      }
    },
    /* 3 ─────────────────────────────── Bertahan Hidup */
    {
      id: 'survival', name: 'Bertahan Hidup', icon: '❤️', color: '#ef4444', tag: '3 nyawa',
      desc: 'Soal makin sulit dari mudah ke sulit. Kamu punya 3 nyawa — salah atau kehabisan waktu mengurangi nyawa. Bertahanlah sejauh mungkin!',
      formats: ALL_AUTO, accepts: () => true, min: 5, limitSec: 20 * 25 + 40,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 20).sort((a, b) => (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1)),
      bot: { units: 20, sec: 10, per: 115, wrong: 0, lives: 3 },
      play(ctx) {
        let i = 0, lives = 3;
        const hearts = () => '❤️'.repeat(lives) + '🖤'.repeat(3 - lives);
        const next = () => {
          if (lives <= 0 || i >= ctx.qs.length) return ctx.finish();
          const q = ctx.qs[i++];
          ctx.info(`${hearts()} • Level ${i}`);
          askTurn(ctx, q, i, ctx.qs.length, 25, (r) => {
            ctx.mark(r.correct);
            if (r.correct) {
              const base = { mudah: 50, sedang: 100, sulit: 150 }[q.difficulty] || 100;
              const gain = base + Math.round(r.left / 25 * base * 0.5);
              ctx.add(gain);
              r.fb.insertAdjacentHTML('beforeend', gainHtml(gain));
            } else {
              lives--;
              ctx.info(`${hearts()} • Level ${i}`);
              r.fb.insertAdjacentHTML('beforeend', '<span class="gb-gain is-down">−1 ❤️</span>');
            }
            ctx.after(1400, next);
          });
        };
        next();
      }
    },
    /* 4 ─────────────────────────────── Tangga Juara */
    {
      id: 'jutawan', name: 'Tangga Juara', icon: '🪜', color: '#8b5cf6', tag: 'Bantuan 50:50',
      desc: 'Naiki 10 anak tangga poin. Punya 3 bantuan: 50:50, Ganti Soal, dan +15 Detik. Salah = turun ke titik aman (tangga 5 & 8). Berani lanjut atau ambil poin?',
      formats: ['Pilihan Ganda (≥ 3 pilihan)'], accepts: q => fmtOf(q) === 'Pilihan Ganda' && optCount(q) >= 3,
      min: 10, limitSec: 11 * 30 + 60,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 11).sort((a, b) => (DIFF_ORDER[a.difficulty] ?? 1) - (DIFF_ORDER[b.difficulty] ?? 1)),
      ladder: [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000], safe: [4, 7],
      bot: { ladder: true, sec: 12 },
      play(ctx) {
        const L2 = this.ladder, SAFE = this.safe;
        const main = ctx.qs.slice(0, 10), spare = ctx.qs.slice(10);
        let lvl = 0;
        const life = { fifty: true, swap: spare.length > 0, time: true };
        const safeVal = () => { let v = 0; SAFE.forEach(s => { if (lvl > s) v = L2[s]; }); return v; };
        const ladderHtml = () => `<ol class="gb-ladder">${L2.map((v, k) => `<li class="${k === lvl ? 'is-now' : ''} ${k < lvl ? 'is-done' : ''} ${SAFE.includes(k) ? 'is-safe' : ''}"><span>${k + 1}</span><b>${fmt(v)}</b></li>`).reverse().join('')}</ol>`;
        const next = (qOverride) => {
          if (lvl >= main.length) return ctx.finish();
          const q = qOverride || main[lvl];
          ctx.info(`Anak tangga ${lvl + 1} • ${fmt(L2[lvl])} poin`);
          const turn = askTurn(ctx, q, lvl + 1, 10, 30, (r) => {
            ctx.mark(r.correct);
            if (r.correct) {
              const prev = lvl ? L2[lvl - 1] : 0;
              lvl++;
              ctx.add(L2[lvl - 1] - prev);
              r.fb.insertAdjacentHTML('beforeend', gainHtml(L2[lvl - 1] - prev));
              if (lvl >= 10) { ctx.after(1200, () => ctx.finish()); return; }
              ctx.after(1300, next);
            } else {
              const keep = safeVal();
              ctx.setScore(keep);
              r.fb.insertAdjacentHTML('beforeend', `<div class="gb-hint">Kamu turun ke titik aman: <b>${fmt(keep)}</b> poin.</div>`);
              ctx.after(1800, () => ctx.finish());
            }
          }, {
            extra: '',
            onReady: (ui, t) => {
              const bar = document.createElement('div');
              bar.className = 'gb-lifelines';
              bar.innerHTML = `<button type="button" class="btn btn-sm btn-secondary" data-l="fifty" ${life.fifty ? '' : 'disabled'}>✂️ 50:50</button>
                <button type="button" class="btn btn-sm btn-secondary" data-l="swap" ${life.swap ? '' : 'disabled'}>🔄 Ganti Soal</button>
                <button type="button" class="btn btn-sm btn-secondary" data-l="time" ${life.time ? '' : 'disabled'}>⏱ +15 Detik</button>
                <button type="button" class="btn btn-sm btn-ghost" data-l="stop" ${lvl ? '' : 'disabled'}>🏳️ Ambil ${fmt(lvl ? L2[lvl - 1] : 0)} poin</button>`;
              ctx.stage.querySelector('.gb-turn').insertAdjacentElement('afterbegin', bar);
              ctx.stage.querySelector('.gb-turn').insertAdjacentHTML('beforeend', ladderHtml());
              bar.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => {
                if (turn.isDone()) return;
                const k = b.dataset.l;
                if (k === 'fifty' && life.fifty) {
                  life.fifty = false;
                  const wrong = shuffle((q.options || []).map((_, i2) => i2).filter(i2 => i2 !== q.correctIndex), ctx.rng);
                  ui.hide(wrong.slice(0, Math.max(0, Math.min(2, wrong.length - 1))));
                  b.disabled = true;
                } else if (k === 'swap' && life.swap) {
                  life.swap = false; t.stop(); next(spare.shift());
                } else if (k === 'time' && life.time) {
                  life.time = false; t.addTime(15); b.disabled = true;
                } else if (k === 'stop' && lvl) {
                  t.stop(); ui.lock(); ctx.finish();
                }
              }));
            }
          });
        };
        next();
      }
    },
    /* 5 ─────────────────────────────── Taruhan Cerdas */
    {
      id: 'taruhan', name: 'Taruhan Cerdas', icon: '🎲', color: '#0ea5e9', tag: 'Ukur keyakinanmu',
      desc: 'Mulai dengan 500 poin. Sebelum tiap soal, lihat subtest & tingkatnya lalu pasang taruhan 10–100%. Benar: poin bertambah (soal sulit ×2), salah: taruhan hilang.',
      formats: ALL_AUTO, accepts: () => true, min: 5, limitSec: 8 * 40 + 60,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 8),
      bot: { units: 8, sec: 14, start: 500, wager: 0.35 },
      play(ctx) {
        let i = 0;
        ctx.setScore(500);
        const mult = { mudah: 1, sedang: 1.5, sulit: 2 };
        const next = () => {
          if (i >= ctx.qs.length || ctx.score() <= 0) return ctx.finish();
          const q = ctx.qs[i];
          const st = DB.subtestByName(q.subject);
          ctx.info(`Soal ${i + 1}/${ctx.qs.length}`);
          ctx.stage.innerHTML = `<div class="gb-wager">
              <div class="gb-wager-ic">🎲</div>
              <h3>Pasang taruhan untuk soal ${i + 1}</h3>
              <p class="muted">${st ? st.icon + ' ' + esc(st.name) : esc(q.subject || 'Umum')} • tingkat <b>${esc(q.difficulty || 'sedang')}</b> (×${mult[q.difficulty] || 1.5}) • ${esc(fmtOf(q))}</p>
              <div class="gb-wager-btns">${[10, 25, 50, 100].map(p => `<button type="button" class="btn btn-secondary" data-w="${p}">${p === 100 ? 'All-in' : p + '%'}<small>${fmt(Math.max(10, Math.round(ctx.score() * p / 100)))} poin</small></button>`).join('')}</div>
            </div>`;
          const t = ctx.timer(15, () => place(10));
          let placed = false;
          const place = (p) => {
            if (placed) return;
            placed = true; t.stop();
            const wager = Math.min(ctx.score(), Math.max(10, Math.round(ctx.score() * p / 100)));
            i++;
            askTurn(ctx, q, i, ctx.qs.length, 30, (r) => {
              ctx.mark(r.correct);
              const gain = r.correct ? Math.round(wager * (mult[q.difficulty] || 1.5)) : -wager;
              ctx.add(gain);
              r.fb.insertAdjacentHTML('beforeend', `${gainHtml(gain)} <span class="muted small">(taruhan ${fmt(wager)})</span>`);
              ctx.after(1500, next);
            }, { extra: `<span class="gb-chip-s">🎯 Taruhan ${fmt(wager)}</span>` });
          };
          ctx.stage.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => place(Number(b.dataset.w))));
        };
        next();
      }
    },
    /* 6 ─────────────────────────────── Isian Kilat */
    {
      id: 'isian', name: 'Isian Kilat', icon: '⌨️', color: '#6366f1', tag: 'Ketik jawaban',
      desc: 'Ketik jawaban singkat untuk 8 soal (25 detik per soal). Butuh petunjuk? Huruf pertama & panjang jawaban bisa dibuka dengan −30 poin.',
      formats: ['Isian Singkat'], accepts: q => fmtOf(q) === 'Isian Singkat', min: 4, limitSec: 8 * 25 + 40,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 8),
      bot: { units: 8, sec: 13, per: 125, wrong: 0 },
      play(ctx) {
        let i = 0;
        const next = () => {
          if (i >= ctx.qs.length) return ctx.finish();
          const q = ctx.qs[i++];
          let hinted = false;
          ctx.info(`Soal ${i}/${ctx.qs.length}`);
          askTurn(ctx, q, i, ctx.qs.length, 25, (r) => {
            ctx.mark(r.correct);
            if (r.correct) {
              const gain = 100 + Math.round(r.left / 25 * 50) - (hinted ? 30 : 0);
              ctx.add(gain);
              r.fb.insertAdjacentHTML('beforeend', gainHtml(gain));
            }
            ctx.after(1500, next);
          }, {
            onReady: (ui, t) => {
              const ans = String((q.answers || [])[0] || '');
              const hint = document.createElement('div');
              hint.className = 'gb-hintbar';
              hint.innerHTML = `<button type="button" class="btn btn-sm btn-ghost">💡 Petunjuk (−30)</button><span class="gb-hint-out"></span>`;
              ctx.stage.querySelector('.gb-ans').insertAdjacentElement('afterend', hint);
              hint.querySelector('button').addEventListener('click', (e) => {
                if (hinted) return;
                hinted = true;
                e.currentTarget.disabled = true;
                const shown = ans.split('').map((ch, k) => (k === 0 || ch === ' ' ? ch : '•')).join('');
                hint.querySelector('.gb-hint-out').textContent = `${shown}  (${ans.replace(/\s/g, '').length} karakter)`;
              });
            }
          });
        };
        next();
      }
    },
    /* 7 ─────────────────────────────── Jodohkan Kilat */
    {
      id: 'jodoh', name: 'Jodohkan Kilat', icon: '🔗', color: '#ec4899', tag: 'Pasangkan cepat',
      desc: 'Ketuk item kiri lalu pasangannya di kanan. Pasangan benar +40, salah −10. Selesaikan semua ronde dalam 90 detik.',
      formats: ['Menjodohkan'], accepts: q => fmtOf(q) === 'Menjodohkan' && (q.pairs || []).length >= 2,
      units: (pool) => pool.reduce((n, q) => n + Math.min(6, (q.pairs || []).length), 0), min: 6, limitSec: 90 + 20,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 4),
      bot: { units: 16, sec: 4.5, per: 40, wrong: -10, timeSec: 90 },
      play(ctx) {
        let qi = 0, over = false;
        const t = ctx.timer(90, () => { over = true; ctx.finish(); });
        const round = () => {
          if (over) return;
          if (qi >= ctx.qs.length) { t.stop(); return ctx.finish(); }
          const q = ctx.qs[qi++];
          const pairs = shuffle((q.pairs || []).map((p, k) => ({ p, k })), ctx.rng).slice(0, 6);
          const rights = shuffle(pairs, ctx.rng);
          const done = new Set();
          let sel = null;
          ctx.info(`Ronde ${qi}/${ctx.qs.length}`);
          ctx.stage.innerHTML = `<div class="gb-jodoh"><div class="gb-qtext">${rt(q.text)}</div>
              <div class="gb-jcols"><div class="gb-jcol">${pairs.map((x, n) => `<button type="button" class="gb-jitem" data-l="${n}">${rt(x.p.left)}</button>`).join('')}</div>
              <div class="gb-jcol">${rights.map((x, n) => `<button type="button" class="gb-jitem" data-r="${n}">${rt(x.p.right)}</button>`).join('')}</div></div>
              <div class="gb-fb" aria-live="polite"></div></div>`;
          ctx.stage.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => {
            if (over || b.disabled) return;
            ctx.stage.querySelectorAll('[data-l]').forEach(x => x.classList.toggle('is-sel', x === b));
            sel = Number(b.dataset.l);
          }));
          ctx.stage.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
            if (over || b.disabled || sel == null) { if (sel == null && !over) UI.toast('Pilih item di kolom kiri terlebih dahulu.', 'info'); return; }
            const left = pairs[sel], right = rights[Number(b.dataset.r)];
            const ok = plain(left.p.right) === plain(right.p.right);
            ctx.mark(ok);
            const lb = ctx.stage.querySelector(`[data-l="${sel}"]`);
            if (ok) {
              ctx.add(40); ctx.flash(true);
              lb.disabled = true; b.disabled = true; lb.classList.add('is-ok'); b.classList.add('is-ok'); lb.classList.remove('is-sel');
              done.add(sel); sel = null;
              if (done.size === pairs.length) ctx.after(700, round);
            } else {
              ctx.add(-10); ctx.flash(false);
              b.classList.add('is-no'); setTimeout(() => b.classList.remove('is-no'), 450);
            }
          }));
        };
        round();
      }
    },
    /* 8 ─────────────────────────────── Kartu Memori */
    {
      id: 'memori', name: 'Kartu Memori', icon: '🃏', color: '#14b8a6', tag: 'Ingat & cocokkan',
      desc: 'Buka dua kartu sekaligus dan temukan 6 pasangan (istilah ↔ arti, soal ↔ jawaban). Cocok +100, meleset −10, sisa waktu jadi bonus.',
      formats: ['Menjodohkan', 'Pilihan Ganda (teks pendek)'],
      accepts: q => fmtOf(q) === 'Menjodohkan' || fmtOf(q) === 'Pilihan Ganda',
      units: (pool) => memoryPairs(pool).length, min: 6, limitSec: 120 + 20,
      pick: (pool, rng) => {
        const qs = shuffle(pool.filter(q => memoryPairs([q]).length), rng), out = [];
        let n = 0;
        for (const q of qs) { out.push(q); n += memoryPairs([q]).length; if (n >= 6) break; }
        return out;
      },
      bot: { units: 6, sec: 14, per: 100, wrong: -10, bonusSec: 30 },
      play(ctx) {
        const pairs = shuffle(memoryPairs(ctx.qs), ctx.rng).slice(0, 6);
        const cards = shuffle(pairs.flatMap((p, k) => [{ k, side: 'a', html: p.a }, { k, side: 'b', html: p.b }]), ctx.rng);
        let open = [], matched = 0, busy = false, over = false;
        const t = ctx.timer(120, () => { over = true; ctx.finish(); });
        ctx.info(`0/${pairs.length} pasangan`);
        ctx.stage.innerHTML = `<div class="gb-mem">${cards.map((c, n) => `
            <button type="button" class="gb-card" data-c="${n}" aria-label="Kartu ${n + 1}">
              <span class="gb-card-in"><span class="gb-card-back">?</span><span class="gb-card-front ${c.side === 'a' ? 'is-a' : 'is-b'}">${rt(c.html)}</span></span>
            </button>`).join('')}</div>`;
        ctx.stage.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
          if (busy || over || b.classList.contains('is-open')) return;
          b.classList.add('is-open');
          beep('tick');
          open.push(b);
          if (open.length < 2) return;
          const [x, y] = open;
          const cx = cards[Number(x.dataset.c)], cy = cards[Number(y.dataset.c)];
          const ok = cx.k === cy.k && cx.side !== cy.side;
          ctx.mark(ok);
          if (ok) {
            matched++; ctx.add(100); ctx.flash(true);
            x.classList.add('is-done'); y.classList.add('is-done'); x.disabled = true; y.disabled = true;
            open = [];
            ctx.info(`${matched}/${pairs.length} pasangan`);
            if (matched === pairs.length) {
              const bonus = Math.round(t.left() * 5);
              t.stop(); ctx.add(bonus);
              ctx.stage.insertAdjacentHTML('beforeend', `<div class="gb-good">🎉 Semua pasangan ditemukan! Bonus waktu ${gainHtml(bonus)}</div>`);
              ctx.after(1400, () => ctx.finish());
            }
          } else {
            busy = true; ctx.add(-10); ctx.flash(false);
            ctx.after(900, () => { x.classList.remove('is-open'); y.classList.remove('is-open'); open = []; busy = false; });
          }
        }));
      }
    },
    /* 9 ─────────────────────────────── Susun Urutan */
    {
      id: 'urutan', name: 'Susun Urutan', icon: '🧱', color: '#a16207', tag: 'Logika berurutan',
      desc: 'Susun langkah, peristiwa, atau proses ke urutan yang benar. Urutan sempurna +150 & bonus waktu; tiap posisi benar tetap dapat +20.',
      formats: ['Urutan'], accepts: q => fmtOf(q) === 'Urutan' && (q.orderItems || []).length >= 3, min: 3, limitSec: 5 * 45 + 40,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 5),
      bot: { units: 5, sec: 26, per: 165, wrong: 40 },
      play(ctx) {
        let i = 0;
        const next = () => {
          if (i >= ctx.qs.length) return ctx.finish();
          const q = ctx.qs[i++];
          ctx.info(`Soal ${i}/${ctx.qs.length}`);
          askTurn(ctx, q, i, ctx.qs.length, 45, (r) => {
            ctx.mark(r.correct);
            let gain = 0;
            if (r.correct) gain = 150 + Math.round(r.left / 45 * 50);
            else if (Array.isArray(r.ans)) gain = r.ans.reduce((n, it, k) => n + (plain(it) === plain((q.orderItems || [])[k]) ? 20 : 0), 0);
            if (gain) { ctx.add(gain); r.fb.insertAdjacentHTML('beforeend', gainHtml(gain)); }
            ctx.after(1700, next);
          });
        };
        next();
      }
    },
    /* 10 ────────────────────────────── Pecah Balon */
    {
      id: 'balon', name: 'Pecah Balon', icon: '🎈', color: '#f43f5e', tag: 'Kejar jawaban',
      desc: 'Pilihan jawaban terbang sebagai balon! Pecahkan balon yang benar sebelum lepas ke langit. Makin cepat makin besar poinnya; balon salah −20.',
      formats: ['Pilihan Ganda (pilihan pendek)'], accepts: q => fmtOf(q) === 'Pilihan Ganda' && optCount(q) >= 2 && optCount(q) <= 5 && shortOptions(q),
      min: 5, limitSec: 10 * 10 + 40,
      pick: (pool, rng) => shuffle(pool, rng).slice(0, 10),
      bot: { units: 10, sec: 6, per: 150, wrong: -20 },
      play(ctx) {
        let i = 0;
        const FLY = 9;
        const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#38bdf8', '#a855f7'];
        const next = () => {
          if (i >= ctx.qs.length) return ctx.finish();
          const q = ctx.qs[i++];
          ctx.info(`Soal ${i}/${ctx.qs.length}`);
          const order = shuffle((q.options || []).map((o, k) => k).filter(k => plain(q.options[k])), ctx.rng);
          ctx.stage.innerHTML = `<div class="gb-balloon-wrap">${qCardHtml(q, i, ctx.qs.length)}
              <div class="gb-sky ${reducedMotion() ? 'is-static' : ''}" style="--fly:${FLY}s">${order.map((k, n) => `
                <button type="button" class="gb-balloon" data-b="${k}" style="--x:${8 + n * (84 / Math.max(1, order.length - 1 || 1))}%;--c:${colors[n % colors.length]};--dl:${(n * 0.35).toFixed(2)}s">
                  <span class="gb-balloon-t">${rt(q.options[k])}</span></button>`).join('')}</div>
              <div class="gb-fb" aria-live="polite"></div></div>`;
          let done = false;
          const t = ctx.timer(FLY, () => end(false, true));
          const end = (ok, timeout) => {
            if (done) return;
            done = true; t.stop();
            ctx.mark(ok);
            const fb = ctx.stage.querySelector('.gb-fb');
            ctx.stage.querySelectorAll('.gb-balloon').forEach(b => { b.disabled = true; if (Number(b.dataset.b) === q.correctIndex) b.classList.add('is-key'); });
            if (fb) fb.innerHTML = ok ? '<div class="gb-good">🎯 Tepat sasaran!</div>' : `<div class="gb-badfb">${timeout ? '🎈 Balon lepas!' : '❌'} Kunci: ${esc(keyText(q))}</div>`;
            ctx.flash(ok);
            ctx.after(1400, next);
          };
          ctx.stage.querySelectorAll('.gb-balloon').forEach(b => b.addEventListener('click', () => {
            if (done) return;
            const k = Number(b.dataset.b);
            if (k === q.correctIndex) {
              const gain = 100 + Math.round(t.left() / FLY * 100);
              b.classList.add('is-pop'); ctx.add(gain); beep('pop');
              const fb = ctx.stage.querySelector('.gb-fb');
              end(true);
              if (fb) fb.insertAdjacentHTML('beforeend', gainHtml(gain));
            } else {
              b.classList.add('is-pop', 'is-wrong'); b.disabled = true;
              ctx.add(-20); ctx.flash(false);
            }
          }));
        };
        next();
      }
    }
  ];
  const GAME = {};
  GAMES.forEach(g => { GAME[g.id] = g; });

  /* ================================================================
   * Pemain & battle — helper data
   * ==============================================================*/
  const blankPlayer = () => ({ score: 0, answered: 0, correct: 0, finished: false, finishedAt: null, at: Date.now() });
  const userName = (id) => { const u = DB.getUser(id); return u ? u.name : 'Pemain'; };
  const firstName = (id) => userName(id).split(' ')[0];
  const opponentOf = (b, me) => (b.p1Id === me ? b.p2Id : b.p1Id);
  const BOT_LEVELS = { mudah: { label: 'Bot Mudah', p: 0.55, speed: 1.25 }, sedang: { label: 'Bot Sedang', p: 0.72, speed: 1 }, sulit: { label: 'Bot Sulit', p: 0.88, speed: 0.8 } };

  /** Pemenang battle dari skor (seri → null). Sama persis dengan aturan server. */
  function winnerOf(b) {
    const a = (b.players || {})[b.p1Id], c = (b.players || {})[b.p2Id];
    const sa = a ? Number(a.score) || 0 : 0, sc = c ? Number(c.score) || 0 : 0;
    if (sa === sc) return null;
    return sa > sc ? b.p1Id : b.p2Id;
  }
  function battleExpired(b, now) {
    return (b.status === 'invite' || b.status === 'open') && (Number(b.expiresAt) || 0) < (now || Date.now());
  }
  /** Battle aktif (sedang dimainkan) yang melibatkan pengguna. */
  function activeBattleOf(userId) {
    const now = Date.now();
    return getBattles().find(b => b.status === 'playing' && (b.p1Id === userId || b.p2Id === userId)
      && now < (Number(b.startAt) || 0) + (Number(b.limitMs) || 300000) + BATTLE_GRACE) || null;
  }

  /** Siswa yang sedang online (untuk lawan battle). */
  function onlineStudents(me) {
    if (!global.Presence) return [];
    const busy = new Set();
    getBattles().forEach(b => { if (b.status === 'playing' && Date.now() < (b.startAt || 0) + (b.limitMs || 300000)) { busy.add(b.p1Id); busy.add(b.p2Id); } });
    const mine = DB.getUser(me.id) || me;
    return Presence.getAll()
      .filter(r => r.user && r.user.role === 'siswa' && r.userId !== me.id && r.user.gameAvailable !== false && (r.user.status || 'Aktif') !== 'Dikeluarkan')
      .map(r => ({ id: r.userId, user: r.user, state: r.state, inGame: r.page === PAGE, busy: busy.has(r.userId), lastSeen: r.lastSeen }))
      .sort((a, b) => (a.busy - b.busy) || ((b.state === 'online') - (a.state === 'online')) || (b.inGame - a.inGame)
        || ((b.user.kelas === mine.kelas) - (a.user.kelas === mine.kelas)) || (b.lastSeen - a.lastSeen));
  }

  /* ================================================================
   * Runner: menjalankan satu ronde (pribadi / battle / bot / pratinjau)
   * ==============================================================*/
  let session = null;      // sesi yang sedang berjalan

  function stopSession(reason) {
    if (session) { const s = session; session = null; s.dispose(reason || 'stop'); }
  }

  /**
   * @param {HTMLElement} container
   * @param {object} user
   * @param {{gameId, mode:'solo'|'battle'|'bot'|'preview', subject?, battleId?, botLevel?, onExit?}} opts
   */
  function runSession(container, user, opts) {
    stopSession('restart');
    const game = GAME[opts.gameId];
    if (!game) { UI.toast('Game tidak ditemukan.', 'error'); return; }
    const mode = opts.mode;
    let battle = mode === 'battle' ? getBattle(opts.battleId) : null;
    let seed, qs;
    if (battle) {
      seed = Number(battle.seed) >>> 0;
      qs = (battle.qids || []).map(resolveRef).filter(Boolean);
    } else {
      seed = (Math.random() * 4294967296) >>> 0;
      qs = game.pick(poolFor(game, opts.subject), mulberry(seed));
    }
    if (!qs.length) { UI.toast('Soal untuk game ini belum tersedia.', 'error'); if (opts.onExit) opts.onExit(); return; }
    const rng = mulberry((seed ^ 0xA5A5A5A5) >>> 0);
    const me = user.id;
    const oppId = battle ? opponentOf(battle, me) : null;
    const bot = mode === 'bot' ? (BOT_LEVELS[opts.botLevel] || BOT_LEVELS.sedang) : null;
    const timers = new Set(), intervals = new Set(), disposers = [];
    const stats = { score: 0, answered: 0, correct: 0 };
    const startedAt = Date.now();
    let finished = false, lastWrite = 0, writeTimer = null, mainTimer = null;
    let learnTok = null;
    if (user.role === 'siswa' && mode !== 'preview' && DB.getSettings().streakEnabled !== false) {
      try { learnTok = DB.beginLearning(user.id, 'games', '').token; } catch (e) { learnTok = null; }
    }

    container.innerHTML = `
      <div class="gb-run" style="--gc:${game.color}">
        <div class="gb-hud">
          <button type="button" class="btn btn-sm btn-secondary" data-gb="quit">← Keluar</button>
          <div class="gb-hud-game"><span class="gb-hud-ic">${game.icon}</span><div><strong>${esc(game.name)}</strong>
            <small>${mode === 'battle' ? `⚔️ Battle vs ${esc(firstName(oppId))}` : mode === 'bot' ? `🤖 vs ${esc(bot.label)}` : mode === 'preview' ? '👁️ Pratinjau (tidak disimpan)' : '🎯 Main pribadi'}</small></div></div>
          <div class="gb-hud-info" id="gbInfo"></div>
          <div class="gb-hud-score"><span>Skor</span><b id="gbScore">0</b></div>
          <button type="button" class="icon-btn gb-sound" data-gb="sound" aria-label="Suara" title="Suara">${prefs().sound === false ? '🔇' : '🔊'}</button>
        </div>
        <div class="gb-timer" id="gbTimer" hidden><span class="gb-timer-bar"><i id="gbTimerBar"></i></span><b id="gbTimerTxt"></b></div>
        ${battle || bot ? `<div class="gb-vs" id="gbVs"></div>` : ''}
        <div class="gb-stage" id="gbStage" tabindex="-1"></div>
      </div>`;
    const $ = (s) => container.querySelector(s);
    const stage = $('#gbStage');

    /* ---------- tampilan lawan ---------- */
    let botState = null;
    function vsHtml() {
      const myRow = { name: 'Kamu', score: stats.score, answered: stats.answered, finished };
      let op;
      if (bot) op = { name: bot.label, score: botState ? botState.score : 0, answered: botState ? botState.answered : 0, finished: !!(botState && botState.done) };
      else {
        const b = getBattle(battle.id) || battle;
        const p = (b.players || {})[oppId];
        op = { name: firstName(oppId), score: p ? p.score : 0, answered: p ? p.answered : 0, finished: !!(p && p.finished), waiting: !p || !(p.answered || p.score || p.finished) };
      }
      const max = Math.max(1, Math.abs(myRow.score), Math.abs(op.score));
      const row = (r, cls) => `<div class="gb-vs-row ${cls}"><span class="gb-vs-n">${esc(r.name)}${r.finished ? ' ✅' : ''}</span>
        <span class="gb-vs-bar"><i style="width:${Math.max(3, Math.round(Math.max(0, r.score) / max * 100))}%"></i></span>
        <b>${fmt(r.score)}</b></div>`;
      return row(myRow, 'is-me') + row(op, 'is-op') + (op.waiting && !bot ? '<div class="gb-vs-note">Menunggu lawan bergabung…</div>' : '');
    }
    function paintVs() { const el = $('#gbVs'); if (el) el.innerHTML = vsHtml(); }

    /* ---------- tulis progres battle ---------- */
    function writeMine(force) {
      if (!battle || mode !== 'battle') return;
      const now = Date.now();
      if (!force && now - lastWrite < 1200) {
        if (!writeTimer) writeTimer = setTimeout(() => { writeTimer = null; writeMine(true); }, 1200 - (now - lastWrite));
        return;
      }
      lastWrite = now;
      const b = getBattle(battle.id);
      if (!b) return;
      const players = Object.assign({}, b.players || {});
      players[me] = { score: stats.score, answered: stats.answered, correct: stats.correct, finished, finishedAt: finished ? now : null, at: now };
      battle = upsert(K.battles, Object.assign({}, b, { players }));
      if (server()) Sync.syncNow('battle').catch(() => {});
    }

    /* ---------- ctx untuk game ---------- */
    const ctx = {
      stage, qs, rng, game,
      score: () => stats.score,
      setScore(n) { stats.score = Math.round(n); $('#gbScore').textContent = fmt(stats.score); paintVs(); writeMine(); },
      add(delta) {
        ctx.setScore(stats.score + delta);
        const el = $('#gbScore');
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
      },
      mark(ok) { stats.answered++; if (ok) stats.correct++; paintVs(); writeMine(); },
      info(html) { const el = $('#gbInfo'); if (el) el.innerHTML = esc(html); },
      flash(ok) {
        beep(ok ? 'ok' : 'bad');
        stage.classList.remove('is-ok', 'is-no'); void stage.offsetWidth; stage.classList.add(ok ? 'is-ok' : 'is-no');
      },
      after(ms, fn) { const id = setTimeout(() => { timers.delete(id); if (session === sess) fn(); }, ms); timers.add(id); return id; },
      every(ms, fn) { const id = setInterval(() => { if (session === sess) fn(); }, ms); intervals.add(id); return id; },
      onDispose(fn) { disposers.push(fn); },
      timer(sec, onEnd) {
        if (mainTimer) mainTimer.stop();
        let total = sec * 1000, endAt = performance.now() + total, stopped = false, warned = false;
        const box = $('#gbTimer'), bar = $('#gbTimerBar'), txt = $('#gbTimerTxt');
        box.hidden = false;
        const tick = () => {
          if (stopped) return;
          const left = Math.max(0, endAt - performance.now());
          bar.style.width = (left / total * 100).toFixed(1) + '%';
          txt.textContent = Math.ceil(left / 1000) + ' dtk';
          box.classList.toggle('is-low', left < 5000);
          if (left < 5000 && !warned) { warned = true; beep('tick'); }
          if (left <= 0) { t.stop(); onEnd(); }
        };
        const id = setInterval(tick, 100);
        intervals.add(id);
        const t = {
          stop() { if (stopped) return; stopped = true; clearInterval(id); intervals.delete(id); },
          left: () => (stopped ? 0 : Math.max(0, (endAt - performance.now()) / 1000)),
          addTime(s) { endAt += s * 1000; total += s * 1000; warned = false; tick(); }
        };
        mainTimer = t;
        tick();
        return t;
      },
      finish() { finishRound(); }
    };

    /* ---------- bot ---------- */
    function startBot() {
      const cfg = game.bot || {};
      const lvl = bot;
      botState = { score: cfg.start || 0, answered: 0, correct: 0, done: false, lives: cfg.lives || 0, ladder: 0, simT: 0, fast: false };
      const step = () => {
        if (botState.done) return;
        // Waktu simulasi (bukan waktu nyata) agar bot tetap adil saat dipercepat.
        if (cfg.timeSec && botState.simT >= cfg.timeSec) { botState.done = true; paintVs(); return; }
        let p = lvl.p;
        if (cfg.ladder) {
          const ladder = game.ladder;
          p = Math.max(0.25, lvl.p - botState.ladder * 0.045);
          botState.answered++;
          if (Math.random() < p) {
            botState.correct++; botState.ladder++; botState.score = ladder[botState.ladder - 1];
            if (botState.ladder >= ladder.length) botState.done = true;
          } else {
            let v = 0; game.safe.forEach(s => { if (botState.ladder > s) v = ladder[s]; });
            botState.score = v; botState.done = true;
          }
        } else {
          botState.answered++;
          const ok = Math.random() < p;
          if (cfg.start) {
            const w = Math.max(10, Math.round(botState.score * cfg.wager));
            botState.score += ok ? Math.round(w * 1.5) : -Math.min(w, botState.score);
            if (botState.score <= 0) botState.done = true;
          } else botState.score += ok ? Math.round(cfg.per * (0.8 + Math.random() * 0.35)) : (cfg.wrong || 0);
          if (ok) botState.correct++;
          else if (cfg.lives) { botState.lives--; if (botState.lives <= 0) botState.done = true; }
          if (botState.answered >= (cfg.units || 10)) {
            botState.done = true;
            if (cfg.bonusSec) botState.score += Math.round(cfg.bonusSec * 5 * lvl.p);
          }
        }
        paintVs();
        if (!botState.done) schedule();
      };
      const schedule = () => {
        const d = (cfg.sec || 8) * lvl.speed * (0.6 + Math.random() * 0.8);
        botState.simT += d;
        botState.timer = ctx.after(botState.fast ? 220 : Math.round(d * 1000), step);
      };
      botState.kick = () => {
        if (botState.fast || botState.done) return;
        botState.fast = true;
        clearTimeout(botState.timer); timers.delete(botState.timer);
        botState.timer = ctx.after(220, step);
      };
      schedule();
    }

    /* ---------- selesai & hasil ---------- */
    function finishRound() {
      if (finished) return;
      finished = true;
      if (mainTimer) mainTimer.stop();
      $('#gbTimer').hidden = true;
      writeMine(true);
      paintVs();
      if (mode === 'battle') waitOpponent();
      else if (mode === 'bot') waitBot();
      else showResult();
    }

    function waitBot() {
      if (botState && !botState.done) {
        stage.innerHTML = `<div class="gb-wait"><div class="gb-spin"></div><h3>Menunggu ${esc(bot.label)} selesai…</h3><p class="muted">Skormu sudah tersimpan: <b>${fmt(stats.score)}</b></p></div>`;
        // Pemain sudah selesai: sisa giliran bot disimulasikan cepat.
        if (botState.kick) botState.kick();
        const id = ctx.every(400, () => { if (botState.done) { clearInterval(id); intervals.delete(id); showResult(); } });
      } else showResult();
    }

    function waitOpponent() {
      const check = () => {
        const b = getBattle(battle.id);
        if (!b) return showResult();
        battle = b;
        paintVs();
        const op = (b.players || {})[oppId];
        const limit = (Number(b.startAt) || startedAt) + (Number(b.limitMs) || game.limitSec * 1000) + BATTLE_GRACE;
        if (b.status === 'done' || (op && op.finished) || Date.now() > limit) {
          if (b.status !== 'done') {
            const players = Object.assign({}, b.players);
            const next = Object.assign({}, b, { status: 'done', endedAt: Date.now(), players });
            next.winnerId = winnerOf(next);
            battle = upsert(K.battles, next);
            if (server()) Sync.syncNow('battle').catch(() => {});
          }
          showResult();
          return true;
        }
        return false;
      };
      if (check()) return;
      stage.innerHTML = `<div class="gb-wait"><div class="gb-spin"></div><h3>Menunggu ${esc(firstName(oppId))} menyelesaikan game…</h3>
        <p class="muted">Skormu: <b>${fmt(stats.score)}</b> • ${stats.correct}/${stats.answered} benar</p></div>`;
      const id = ctx.every(2000, () => {
        if (server()) Sync.syncNow('battle').catch(() => {});
        if (check()) { clearInterval(id); intervals.delete(id); }
      });
    }

    function saveScore(result) {
      if (mode === 'preview' || user.role !== 'siswa') return;
      upsert(K.scores, {
        id: uid('gs'), studentId: me, game: game.id, mode, score: stats.score, correct: stats.correct, answered: stats.answered,
        subject: battle ? (battle.subject || '') : (opts.subject || ''), battleId: battle ? battle.id : null,
        opponentId: battle ? oppId : (bot ? 'bot:' + opts.botLevel : null), result: result || null,
        durationMs: Date.now() - startedAt, createdAt: Date.now()
      });
    }

    /** Catat XP streak (aturan "Games Area"): tunggu durasi minimum bila ronde sangat singkat. */
    function recordXp(el) {
      if (!learnTok || !el) return;
      const paint = (t) => { if (el.isConnected) el.innerHTML = t; };
      if (stats.correct < (DB.LEARNING_TYPES && DB.LEARNING_TYPES.games ? DB.LEARNING_TYPES.games.minScore : 6)) {
        learnTok = null;
        paint('⭐ Jawab benar minimal 6 dalam satu ronde untuk mendapat XP streak.');
        return;
      }
      const tok = learnTok;
      const attempt = () => {
        const wait = DB.learningTokenWait(tok);
        if (wait && wait > 0) { paint(`⭐ XP dicatat dalam ${wait} detik…`); setTimeout(attempt, 1000); return; }
        try {
          const r = DB.recordLearning(user.id, 'games', { token: tok, score: stats.correct, answered: stats.answered, total: Math.max(stats.answered, qs.length) });
          paint(r && r.entry ? (r.entry.capped ? '⭐ Batas XP game hari ini sudah tercapai.' : `⭐ +${r.entry.xp} XP streak belajar`) : '');
        } catch (e) { paint('⭐ ' + esc(e.message || 'XP tidak tercatat.')); }
      };
      learnTok = null;
      attempt();
    }

    function showResult() {
      if (!session || session !== sess) return;
      let outcome = null, opScore = null, opName = '';
      if (mode === 'battle') {
        const b = getBattle(battle.id) || battle;
        const p = (b.players || {})[oppId];
        opScore = p ? p.score : 0; opName = firstName(oppId);
        const w = b.status === 'done' && b.winnerId !== undefined ? b.winnerId : winnerOf(b);
        outcome = w === me ? 'win' : (w == null ? 'draw' : 'lose');
      } else if (mode === 'bot') {
        opScore = botState ? botState.score : 0; opName = bot.label;
        outcome = stats.score > opScore ? 'win' : (stats.score === opScore ? 'draw' : 'lose');
      }
      saveScore(outcome);
      const best = mode === 'solo' ? Math.max(0, ...getScores().filter(s => s.studentId === me && s.game === game.id).map(s => s.score)) : null;
      const isBest = mode === 'solo' && best === stats.score && stats.score > 0;
      const OUT = { win: ['🏆', 'Kamu Menang!', 'is-win'], lose: ['💪', 'Belum Beruntung', 'is-lose'], draw: ['🤝', 'Seri!', 'is-draw'] };
      const o = outcome ? OUT[outcome] : null;
      stage.innerHTML = `<div class="gb-result ${o ? o[2] : ''}">
          <div class="gb-res-ic">${o ? o[0] : game.icon}</div>
          <h2>${o ? o[1] : 'Ronde Selesai!'}</h2>
          ${o ? `<div class="gb-res-vs"><div><span>Kamu</span><b>${fmt(stats.score)}</b></div><em>vs</em><div><span>${esc(opName)}</span><b>${fmt(opScore)}</b></div></div>`
            : `<div class="gb-res-score">${fmt(stats.score)}<small>poin</small></div>`}
          <p class="muted">${stats.correct} benar dari ${stats.answered} jawaban${isBest ? ' • <b>🎉 Rekor pribadi baru!</b>' : (best != null && best > 0 ? ` • rekor pribadi ${fmt(best)}` : '')}</p>
          ${learnTok ? '<p class="gb-xp" id="gbXp"></p>' : ''}
          <div class="flex-gap gb-res-act">
            ${mode === 'battle' ? '<button type="button" class="btn btn-primary" data-gb="rematch">⚔️ Tantang Lagi</button>' : '<button type="button" class="btn btn-primary" data-gb="again">🔁 Main Lagi</button>'}
            <button type="button" class="btn btn-secondary" data-gb="back">Kembali ke Game Battle</button>
          </div>
        </div>`;
      recordXp(stage.querySelector('#gbXp'));
      if (outcome === 'win' || isBest) { beep('win'); if (global.Birthday && Birthday.confetti) Birthday.confetti(stage); }
      stage.querySelector('[data-gb="back"]').addEventListener('click', exit);
      const again = stage.querySelector('[data-gb="again"]');
      if (again) again.addEventListener('click', () => runSession(container, user, Object.assign({}, opts)));
      const rem = stage.querySelector('[data-gb="rematch"]');
      if (rem) rem.addEventListener('click', () => {
        const nb = createBattle(user, game, battle.subject || '', oppId);
        if (nb) { stopSession('rematch'); if (opts.onRematch) opts.onRematch(nb); }
      });
    }

    function exit() { stopSession('exit'); if (opts.onExit) opts.onExit(); }

    const sess = {
      id: uid('ss'),
      mode, battleId: battle ? battle.id : null,
      dispose(reason) {
        timers.forEach(clearTimeout); intervals.forEach(clearInterval);
        timers.clear(); intervals.clear();
        if (writeTimer) clearTimeout(writeTimer);
        disposers.forEach(fn => { try { fn(); } catch (e) { /* noop */ } });
        // Keluar di tengah battle = menyerah dengan skor saat ini.
        if (mode === 'battle' && !finished && reason !== 'rematch') { finished = true; writeMine(true); }
      },
      onBattleChange() { if (battle) paintVs(); }
    };
    session = sess;

    $('[data-gb="quit"]').addEventListener('click', () => {
      if (!finished && mode === 'battle' && !UI.confirmDialog('Keluar dari battle? Skormu saat ini dikirim sebagai skor akhir.')) return;
      exit();
    });
    $('[data-gb="sound"]').addEventListener('click', (e) => {
      setPref({ sound: prefs().sound === false });
      e.currentTarget.textContent = prefs().sound === false ? '🔇' : '🔊';
    });

    /* ---------- mulai (dengan hitung mundur) ---------- */
    const begin = () => {
      if (session !== sess) return;
      paintVs();
      if (bot) startBot();
      beep('go');
      try { game.play(ctx); } catch (e) { console.error('[games]', e); stage.innerHTML = `<div class="alert alert-error">Game gagal dimulai: ${esc(e.message)}</div>`; }
      try { stage.focus({ preventScroll: true }); } catch (e) { /* noop */ }
    };
    const startAt = battle ? Number(battle.startAt) || Date.now() : Date.now() + 3200;
    paintVs();
    const countdown = () => {
      const left = Math.ceil((startAt - Date.now()) / 1000);
      if (left <= 0) return begin();
      stage.innerHTML = `<div class="gb-count"><div class="gb-count-n">${left}</div><p>${battle ? `Battle melawan <b>${esc(userName(oppId))}</b> dimulai…` : 'Bersiap…'}</p>
        <p class="muted small">${esc(game.desc)}</p></div>`;
      if (left <= 3) beep('tick');
      ctx.after(Math.max(50, Math.min(1000, startAt - Date.now() - (left - 1) * 1000)), countdown);
    };
    countdown();
    if (battle && server()) ctx.every(3000, () => Sync.syncNow('battle').catch(() => {}));
    return sess;
  }

  /* ================================================================
   * Battle: buat, terima, tolak, batalkan, cari otomatis
   * ==============================================================*/
  function playableGames(subject) {
    const st = settings();
    return GAMES.filter(g => !st.disabled.includes(g.id)).map(g => {
      const pool = poolFor(g, subject);
      return { g, pool, units: unitsOf(g, pool), ok: unitsOf(g, pool) >= g.min };
    });
  }

  function createBattle(user, game, subject, opponentId) {
    const st = settings();
    if (!st.battle) { UI.toast('Mode battle sedang dinonaktifkan admin.', 'info'); return null; }
    const pool = poolFor(game, subject);
    if (unitsOf(game, pool) < game.min) { UI.toast(`Soal ${game.name} belum cukup untuk battle.`, 'error'); return null; }
    if (opponentId && activeBattleOf(opponentId)) { UI.toast(`${firstName(opponentId)} sedang bertanding. Coba lawan lain.`, 'info'); return null; }
    // Satu tantangan aktif per pemain: tantangan lama yang masih menunggu dibatalkan.
    getBattles().filter(b => b.p1Id === user.id && (b.status === 'invite' || b.status === 'open')).forEach(b => {
      upsert(K.battles, Object.assign({}, b, { status: 'cancelled' }));
    });
    const seed = (Math.random() * 4294967296) >>> 0;
    const qs = game.pick(pool, mulberry(seed));
    const now = Date.now();
    const b = {
      id: uid('gb'), game: game.id, subject: subject || '', qids: qs.map(q => q._ref), seed,
      limitMs: game.limitSec * 1000, createdAt: now, expiresAt: now + INVITE_TTL,
      p1Id: user.id, p2Id: opponentId || null, status: opponentId ? 'invite' : 'open',
      players: { [user.id]: blankPlayer() }, startAt: null, winnerId: null
    };
    upsert(K.battles, b);
    if (opponentId) {
      DB.addNotification({
        userId: opponentId, type: 'game', icon: '⚔️', link: PAGE,
        title: `${user.name} menantangmu battle!`,
        body: `${game.icon} ${game.name}${subject ? ' • ' + subject : ''} — terima dalam 2 menit di menu Game Battle.`
      });
    }
    if (server()) Sync.syncNow('battle').catch(() => {});
    return b;
  }

  /** Terima undangan atau ambil tantangan terbuka. Resolve true bila berhasil. */
  async function acceptBattle(user, id) {
    const b = getBattle(id);
    if (!b) { UI.toast('Tantangan tidak ditemukan.', 'error'); return false; }
    if (battleExpired(b)) { UI.toast('Tantangan sudah kedaluwarsa.', 'info'); return false; }
    const claim = b.status === 'open' && !b.p2Id && b.p1Id !== user.id;
    const invited = b.status === 'invite' && b.p2Id === user.id;
    if (!claim && !invited) { UI.toast('Tantangan ini sudah tidak tersedia.', 'info'); return false; }
    if (activeBattleOf(user.id)) { UI.toast('Selesaikan battle yang sedang berjalan terlebih dahulu.', 'info'); return false; }
    const players = Object.assign({}, b.players || {});
    players[user.id] = blankPlayer();
    upsert(K.battles, Object.assign({}, b, { p2Id: user.id, status: 'playing', startAt: Date.now() + START_DELAY, players }));
    if (!server()) return true;
    try { await Sync.syncNow('battle'); } catch (e) { /* dicek di bawah */ }
    const after = getBattle(id);
    if (!after || after.p2Id !== user.id || after.status !== 'playing') {
      UI.toast('Tantangan sudah diambil pemain lain.', 'info');
      return false;
    }
    return true;
  }

  function declineBattle(user, id) {
    const b = getBattle(id);
    if (!b || b.p2Id !== user.id || b.status !== 'invite') return;
    upsert(K.battles, Object.assign({}, b, { status: 'declined' }));
    if (server()) Sync.syncNow('battle').catch(() => {});
  }
  function cancelBattle(user, id) {
    const b = getBattle(id);
    if (!b || b.p1Id !== user.id || (b.status !== 'invite' && b.status !== 'open')) return;
    upsert(K.battles, Object.assign({}, b, { status: 'cancelled' }));
    if (server()) Sync.syncNow('battle').catch(() => {});
  }

  /**
   * Bot matchmaking: ambil tantangan terbuka orang lain, atau buat tantangan
   * terbuka lalu undang hingga 3 siswa online (yang sedang di Game Battle diutamakan).
   * @returns {Promise<{battleId, joined:boolean, invited:string[]}|null>}
   */
  async function autoMatch(user, game, subject) {
    const now = Date.now();
    const open = getBattles().filter(b => b.status === 'open' && !b.p2Id && b.p1Id !== user.id && !battleExpired(b, now)
      && (!game || b.game === game.id) && (!subject || b.subject === subject)).sort((a, b) => a.createdAt - b.createdAt);
    for (const b of open) {
      if (await acceptBattle(user, b.id)) return { battleId: b.id, joined: true, invited: [] };
    }
    let g = game;
    if (!g) {
      const ok = playableGames(subject).filter(x => x.ok);
      if (!ok.length) { UI.toast('Belum ada game dengan soal yang cukup.', 'error'); return null; }
      g = ok[Math.floor(Math.random() * ok.length)].g;
    }
    const b = createBattle(user, g, subject, null);
    if (!b) return null;
    const cand = onlineStudents(user).filter(c => !c.busy && c.state === 'online').slice(0, 3);
    if (cand.length) {
      DB.notifyUsers(cand.map(c => c.id), {
        type: 'game', icon: '⚔️', link: PAGE,
        title: `${user.name} mencari lawan battle!`,
        body: `${g.icon} ${g.name} — buka Game Battle dan tekan "Terima" dalam 2 menit.`
      });
    }
    return { battleId: b.id, joined: false, invited: cand.map(c => c.id) };
  }

  /* ================================================================
   * Halaman siswa: Game Battle
   * ==============================================================*/
  const view = { tab: 'play', subject: '', rankGame: GAMES[0].id, battleGame: '', waiting: null };
  let page = null;           // { container, user }
  let pendingJoin = null;    // id battle yang diterima dari kartu undangan

  function subjectSelectHtml(id, value, allLabel) {
    return `<select id="${id}" class="gb-select-sub" aria-label="Subtest">
      <option value="">${esc(allLabel || 'Semua subtest')}</option>
      ${DB.SUBTESTS.map(s => `<option value="${esc(s.name)}" ${value === s.name ? 'selected' : ''}>${s.icon} ${esc(s.short)}</option>`).join('')}
    </select>`;
  }

  function myStats(uid2) {
    const mine = getScores().filter(s => s.studentId === uid2);
    return {
      plays: mine.length,
      wins: mine.filter(s => s.result === 'win' && s.mode === 'battle').length,
      battles: mine.filter(s => s.mode === 'battle').length,
      best: mine.reduce((m, s) => Math.max(m, s.score), 0)
    };
  }

  function render(container, user) {
    stopSession('nav');
    page = { container, user };
    const st = settings();
    if (!st.enabled) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🎮</div>Game Battle sedang dinonaktifkan oleh admin.</div>';
      return;
    }
    if (pendingJoin) {
      const id = pendingJoin; pendingJoin = null;
      joinFlow(id);
      return;
    }
    if (view.waiting) {
      const b = getBattle(view.waiting);
      if (b && (b.status === 'invite' || b.status === 'open') && !battleExpired(b)) return paintWaiting(b);
      view.waiting = null;
    }
    const act = activeBattleOf(user.id);
    if (act && !((act.players || {})[user.id] || {}).finished) {
      return runSession(container, user, { gameId: act.game, mode: 'battle', battleId: act.id, onExit: () => render(container, user), onRematch: (nb) => { view.waiting = nb.id; render(container, user); } });
    }
    const ms = myStats(user.id);
    const tabs = [['play', '🎮 Main'], ['battle', '⚔️ Battle'], ['rank', '🏆 Peringkat'], ['history', '📜 Riwayat']];
    const incoming = getBattles().filter(b => b.status === 'invite' && b.p2Id === user.id && !battleExpired(b)).length;
    container.innerHTML = `
      <section class="welcome-hero gb-hero">
        <span class="blob b1"></span><span class="blob b2"></span>
        <div class="wh-inner">
          <div class="wh-eyebrow">🎮 Game Battle</div>
          <h2>Belajar sambil bertanding!</h2>
          <p class="wh-sub">10 game edukasi dari Bank Soal. Main sendiri untuk memecahkan rekor, atau tantang teman yang sedang online — pilih lawan sendiri atau biarkan bot mencarikan.</p>
          <div class="wh-chips"><span class="wh-chip">🎯 ${ms.plays} ronde</span><span class="wh-chip">⚔️ ${ms.wins}/${ms.battles} menang</span><span class="wh-chip">🏅 Rekor ${fmt(ms.best)}</span></div>
        </div>
      </section>
      <div class="tabs gb-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="tab-btn ${view.tab === k ? 'active' : ''}" data-gbtab="${k}" role="tab" aria-selected="${view.tab === k}">${l}${k === 'battle' && incoming ? ` <span class="gb-dot">${incoming}</span>` : ''}</button>`).join('')}</div>
      <div id="gbBody"></div>`;
    container.querySelectorAll('[data-gbtab]').forEach(b => b.addEventListener('click', () => { view.tab = b.dataset.gbtab; render(container, user); }));
    const body = container.querySelector('#gbBody');
    if (view.tab === 'play') paintPlay(body, user);
    else if (view.tab === 'battle') paintBattle(body, user);
    else if (view.tab === 'rank') paintRank(body, user);
    else paintHistory(body, user);
    if (global.Effects) Effects.enhance(container);
  }

  function gameCardHtml(x, user, opts) {
    const g = x.g;
    const best = getScores().filter(s => s.studentId === user.id && s.game === g.id).reduce((m, s) => Math.max(m, s.score), 0);
    return `<article class="gb-card-g ${x.ok ? '' : 'is-off'}" style="--gc:${g.color}">
      <div class="gb-cg-top"><span class="gb-cg-ic">${g.icon}</span><span class="gb-cg-tag">${esc(g.tag)}</span></div>
      <h4>${esc(g.name)}</h4>
      <p>${esc(g.desc)}</p>
      <div class="gb-cg-meta"><span title="Format soal">🧩 ${esc(g.formats.join(', '))}</span>
        <span>${x.ok ? `📚 ${x.units} ${g.units ? 'unit' : 'soal'}` : `⚠️ butuh ${g.min} ${g.units ? 'unit' : 'soal'} (ada ${x.units})`}</span>
        ${best ? `<span>🏅 Rekor ${fmt(best)}</span>` : ''}</div>
      <div class="gb-cg-act">
        ${opts && opts.preview ? `<button type="button" class="btn btn-sm btn-primary" data-preview="${g.id}" ${x.ok ? '' : 'disabled'}>👁️ Coba</button>`
          : `<button type="button" class="btn btn-sm btn-primary" data-solo="${g.id}" ${x.ok ? '' : 'disabled'}>▶ Main Sendiri</button>
             <button type="button" class="btn btn-sm btn-secondary" data-battle="${g.id}" ${x.ok && settings().battle ? '' : 'disabled'}>⚔️ Battle</button>`}
      </div>
    </article>`;
  }

  function paintPlay(body, user) {
    const list = playableGames(view.subject);
    body.innerHTML = `
      <div class="gb-toolbar"><label for="gbSub" class="muted small">Sumber soal</label>${subjectSelectHtml('gbSub', view.subject)}
        <span class="muted small">${list.filter(x => x.ok).length}/${list.length} game siap dimainkan</span></div>
      <div class="gb-grid">${list.map(x => gameCardHtml(x, user)).join('')}</div>`;
    body.querySelector('#gbSub').addEventListener('change', (e) => { view.subject = e.target.value; render(page.container, user); });
    body.querySelectorAll('[data-solo]').forEach(b => b.addEventListener('click', () =>
      runSession(page.container, user, { gameId: b.dataset.solo, mode: 'solo', subject: view.subject, onExit: () => render(page.container, user) })));
    body.querySelectorAll('[data-battle]').forEach(b => b.addEventListener('click', () => { view.tab = 'battle'; view.battleGame = b.dataset.battle; render(page.container, user); }));
  }

  function paintBattle(body, user) {
    const st = settings();
    if (!st.battle) { body.innerHTML = '<div class="empty"><div class="empty-icon">⚔️</div>Mode battle sedang dinonaktifkan admin. Kamu tetap bisa main sendiri.</div>'; return; }
    const me = DB.getUser(user.id) || user;
    const now = Date.now();
    const incoming = getBattles().filter(b => b.status === 'invite' && b.p2Id === user.id && !battleExpired(b, now)).sort((a, b) => b.createdAt - a.createdAt);
    const openList = getBattles().filter(b => b.status === 'open' && !b.p2Id && b.p1Id !== user.id && !battleExpired(b, now)).sort((a, b) => a.createdAt - b.createdAt);
    const ready = playableGames(view.subject).filter(x => x.ok);
    if (view.battleGame && !ready.some(x => x.g.id === view.battleGame)) view.battleGame = '';
    const online = onlineStudents(user);
    const avail = me.gameAvailable !== false;
    const left = (b) => Math.max(0, Math.ceil(((b.expiresAt || 0) - now) / 1000));
    body.innerHTML = `
      ${incoming.length ? `<div class="card gb-incoming">
        <div class="card-header">${UI.secHead('📨', 'Tantangan untukmu', 'terima sebelum waktunya habis')}</div>
        ${incoming.map(b => { const g = GAME[b.game] || GAMES[0]; return `<div class="gb-inv-row">
          <span class="gb-inv-ic">${g.icon}</span><div class="gb-inv-main"><strong>${esc(userName(b.p1Id))}</strong> menantangmu <b>${esc(g.name)}</b>
          <div class="muted small">${b.subject ? esc(b.subject) + ' • ' : ''}${left(b)} detik lagi</div></div>
          <div class="flex-gap"><button type="button" class="btn btn-sm btn-primary" data-acc="${b.id}">Terima</button>
          <button type="button" class="btn btn-sm btn-ghost" data-dec="${b.id}">Tolak</button></div></div>`; }).join('')}
      </div>` : ''}
      ${openList.length ? `<div class="card">
        <div class="card-header">${UI.secHead('🔥', 'Tantangan terbuka', 'siapa cepat dia dapat')}</div>
        ${openList.map(b => { const g = GAME[b.game] || GAMES[0]; return `<div class="gb-inv-row">
          <span class="gb-inv-ic">${g.icon}</span><div class="gb-inv-main"><strong>${esc(userName(b.p1Id))}</strong> mencari lawan <b>${esc(g.name)}</b>
          <div class="muted small">${b.subject ? esc(b.subject) + ' • ' : ''}${left(b)} detik lagi</div></div>
          <button type="button" class="btn btn-sm btn-primary" data-acc="${b.id}">⚔️ Lawan</button></div>`; }).join('')}
      </div>` : ''}
      <div class="card">
        <div class="card-header">${UI.secHead('⚔️', 'Mulai Battle', 'pilih game, lalu tentukan lawan')}</div>
        <div class="form form-row gb-battle-cfg">
          <div class="form-group"><label for="gbBGame">Game</label>
            <select id="gbBGame"><option value="">🎲 Acak (bot memilihkan)</option>
              ${ready.map(x => `<option value="${x.g.id}" ${view.battleGame === x.g.id ? 'selected' : ''}>${x.g.icon} ${esc(x.g.name)}</option>`).join('')}</select></div>
          <div class="form-group"><label for="gbBSub">Subtest</label>${subjectSelectHtml('gbBSub', view.subject)}</div>
        </div>
        <div class="gb-opp-grid">
          <div class="gb-opp-card is-auto">
            <div class="gb-opp-ic">🤖</div><h4>Cari Otomatis</h4>
            <p>Bot mendeteksi siswa yang sedang online lalu mencarikan lawan untukmu.</p>
            <button type="button" class="btn btn-primary" id="gbAuto" ${ready.length ? '' : 'disabled'}>🔍 Cari Lawan</button>
          </div>
          <div class="gb-opp-card is-bot ${st.bot ? '' : 'is-off'}">
            <div class="gb-opp-ic">🦾</div><h4>Lawan Bot</h4>
            <p>Latihan battle kapan saja melawan bot kecerdasan buatan.</p>
            <div class="flex-gap">${Object.entries(BOT_LEVELS).map(([k, v]) => `<button type="button" class="btn btn-sm btn-secondary" data-bot="${k}" ${st.bot && ready.length ? '' : 'disabled'}>${esc(v.label.replace('Bot ', ''))}</button>`).join('')}</div>
          </div>
        </div>
        <h4 class="gb-sub-h">🟢 Pilih lawan sendiri <span class="muted small">(${online.length} siswa online)</span></h4>
        ${online.length ? `<div class="gb-online">${online.map(o => `
          <div class="gb-on-row ${o.busy ? 'is-busy' : ''}">
            <span class="gb-on-av">${AV(o.user)}<i class="presence-dot ${o.state}"></i></span>
            <div class="gb-on-main"><strong>${esc(o.user.name)}</strong>
              <span class="muted small">${esc(o.user.kelas || '')}${o.inGame ? ' • 🎮 di Game Battle' : ''}${o.busy ? ' • ⚔️ sedang bertanding' : (o.state === 'away' ? ' • menjauh' : '')}</span></div>
            <button type="button" class="btn btn-sm btn-primary" data-chal="${o.id}" ${o.busy || !ready.length ? 'disabled' : ''}>Tantang</button>
          </div>`).join('')}</div>`
          : `<div class="empty"><div class="empty-icon">🌙</div>Belum ada siswa lain yang online${server() ? '' : ' (mode lokal: hanya tab di peramban ini)'}. Coba <b>Cari Otomatis</b> — tantanganmu terbuka 2 menit untuk siswa yang baru masuk — atau lawan bot.</div>`}
        <label class="check-row gb-avail"><input type="checkbox" id="gbAvail" ${avail ? 'checked' : ''} /> Terima tantangan battle dari siswa lain (status online-ku terlihat di daftar lawan)</label>
      </div>`;
    const cfg = () => {
      const gid = body.querySelector('#gbBGame').value;
      return { game: gid ? GAME[gid] : null, subject: body.querySelector('#gbBSub').value };
    };
    body.querySelector('#gbBGame').addEventListener('change', (e) => { view.battleGame = e.target.value; });
    body.querySelector('#gbBSub').addEventListener('change', (e) => { view.subject = e.target.value; render(page.container, user); });
    const pickGame = (subject) => {
      const c = cfg();
      if (c.game) return c.game;
      const ok = playableGames(subject).filter(x => x.ok);
      return ok.length ? ok[Math.floor(Math.random() * ok.length)].g : null;
    };
    body.querySelectorAll('[data-acc]').forEach(b => b.addEventListener('click', () => joinFlow(b.dataset.acc, b)));
    body.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { declineBattle(user, b.dataset.dec); UI.toast('Tantangan ditolak.', 'info'); render(page.container, user); }));
    body.querySelectorAll('[data-chal]').forEach(b => b.addEventListener('click', () => {
      const c = cfg(); const g = pickGame(c.subject);
      if (!g) return;
      const nb = createBattle(user, g, c.subject, b.dataset.chal);
      if (nb) { view.waiting = nb.id; UI.toast(`Tantangan dikirim ke ${firstName(b.dataset.chal)}.`, 'success'); render(page.container, user); }
    }));
    body.querySelector('#gbAuto').addEventListener('click', async (e) => {
      const btn = e.currentTarget; UI.setBusy(btn, true);
      const c = cfg();
      const r = await autoMatch(user, c.game, c.subject);
      UI.setBusy(btn, false);
      if (!r) return;
      if (r.joined) joinFlow(r.battleId, null, true);
      else { view.waiting = r.battleId; render(page.container, user); }
    });
    body.querySelectorAll('[data-bot]').forEach(b => b.addEventListener('click', () => {
      const c = cfg(); const g = pickGame(c.subject);
      if (!g) return;
      runSession(page.container, user, { gameId: g.id, mode: 'bot', botLevel: b.dataset.bot, subject: c.subject, onExit: () => render(page.container, user) });
    }));
    body.querySelector('#gbAvail').addEventListener('change', (e) => {
      DB.updateUser(user.id, { gameAvailable: e.target.checked });
      UI.toast(e.target.checked ? 'Kamu bisa ditantang siswa lain.' : 'Kamu tidak muncul di daftar lawan.', 'info');
    });
  }

  /** Terima tantangan lalu langsung masuk ke battle. */
  async function joinFlow(id, btn, already) {
    if (!page) return;
    const { container, user } = page;
    if (btn) UI.setBusy(btn, true);
    const ok = already ? true : await acceptBattle(user, id);
    if (btn && btn.isConnected) UI.setBusy(btn, false);
    if (!page || page.container !== container) return;
    if (!ok) { render(container, user); return; }
    const b = getBattle(id);
    runSession(container, user, { gameId: b.game, mode: 'battle', battleId: id, onExit: () => render(container, user), onRematch: (nb) => { view.waiting = nb.id; render(container, user); } });
  }

  /** Layar menunggu lawan (pembuat tantangan). */
  function paintWaiting(b) {
    const { container, user } = page;
    const g = GAME[b.game] || GAMES[0];
    const left = Math.max(0, Math.ceil(((b.expiresAt || 0) - Date.now()) / 1000));
    container.innerHTML = `<div class="gb-run" style="--gc:${g.color}"><div class="gb-wait gb-waiting">
        <div class="gb-radar"><span></span><span></span><span></span><b>${g.icon}</b></div>
        <h3>${b.status === 'invite' ? `Menunggu ${esc(userName(b.p2Id))} menerima tantangan…` : '🤖 Bot sedang mencarikan lawan…'}</h3>
        <p class="muted">${esc(g.name)}${b.subject ? ' • ' + esc(b.subject) : ''} • berlaku <b id="gbLeft">${left}</b> detik lagi</p>
        ${b.status === 'open' ? '<p class="muted small">Tantangan terbuka untuk semua siswa online. Siswa yang diundang mendapat notifikasi di perangkatnya.</p>' : ''}
        <div class="flex-gap" style="justify-content:center;margin-top:12px;">
          <button type="button" class="btn btn-secondary" id="gbCancel">Batalkan</button>
          ${settings().bot ? '<button type="button" class="btn btn-ghost" id="gbToBot">🦾 Lawan Bot saja</button>' : ''}
        </div></div></div>`;
    container.querySelector('#gbCancel').addEventListener('click', () => { cancelBattle(user, b.id); view.waiting = null; render(container, user); });
    const tb = container.querySelector('#gbToBot');
    if (tb) tb.addEventListener('click', () => {
      cancelBattle(user, b.id); view.waiting = null;
      runSession(container, user, { gameId: b.game, mode: 'bot', botLevel: 'sedang', subject: b.subject, onExit: () => render(container, user) });
    });
    const tick = () => {
      if (!page || page.container !== container || view.waiting !== b.id || session) return;
      const cur = getBattle(b.id);
      if (!cur) { view.waiting = null; return render(container, user); }
      if (cur.status === 'playing' && cur.p2Id) {
        view.waiting = null;
        beep('go');
        return runSession(container, user, { gameId: cur.game, mode: 'battle', battleId: cur.id, onExit: () => render(container, user), onRematch: (nb) => { view.waiting = nb.id; render(container, user); } });
      }
      if (cur.status === 'declined') { view.waiting = null; UI.toast(`${firstName(cur.p2Id)} menolak tantangan.`, 'info'); return render(container, user); }
      if (cur.status === 'cancelled' || battleExpired(cur)) {
        if (cur.status !== 'cancelled') cancelBattle(user, cur.id);
        view.waiting = null; UI.toast('Belum ada lawan yang menerima. Coba lagi atau lawan bot.', 'info');
        return render(container, user);
      }
      const el = container.querySelector('#gbLeft');
      if (el) el.textContent = Math.max(0, Math.ceil(((cur.expiresAt || 0) - Date.now()) / 1000));
      if (server() && Date.now() % 3000 < 1000) Sync.syncNow('battle').catch(() => {});
      waitTimer = setTimeout(tick, 1000);
    };
    clearTimeout(waitTimer);
    waitTimer = setTimeout(tick, 1000);
  }
  let waitTimer = null;

  function paintRank(body, user) {
    const g = GAME[view.rankGame] || GAMES[0];
    const scores = getScores().filter(s => s.game === g.id);
    const bestBy = new Map();
    scores.forEach(s => { const cur = bestBy.get(s.studentId); if (!cur || s.score > cur.score) bestBy.set(s.studentId, s); });
    const rows = [...bestBy.values()].filter(s => DB.getUser(s.studentId)).sort((a, b) => b.score - a.score).slice(0, 20);
    const winsBy = new Map();
    getScores().filter(s => s.mode === 'battle' && s.result === 'win').forEach(s => winsBy.set(s.studentId, (winsBy.get(s.studentId) || 0) + 1));
    const champs = [...winsBy.entries()].filter(([id]) => DB.getUser(id)).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    body.innerHTML = `
      <div class="gb-rank-wrap">
        <div class="card">
          <div class="card-header">${UI.secHead('🏆', 'Rekor per Game', 'skor terbaik tiap siswa')}
            <select id="gbRankG">${GAMES.map(x => `<option value="${x.id}" ${x.id === g.id ? 'selected' : ''}>${x.icon} ${esc(x.name)}</option>`).join('')}</select></div>
          ${rows.length ? `<ol class="gb-rank">${rows.map((s, i) => `<li class="${s.studentId === user.id ? 'is-me' : ''}"><span class="gb-rk">${medal(i)}</span>
            <span class="gb-rn">${esc(userName(s.studentId))}</span><span class="muted small">${esc(UI.fmtRelative(s.createdAt))}</span><b>${fmt(s.score)}</b></li>`).join('')}</ol>`
            : '<div class="empty"><div class="empty-icon">🏁</div>Belum ada skor. Jadilah yang pertama!</div>'}
        </div>
        <div class="card">
          <div class="card-header">${UI.secHead('⚔️', 'Juara Battle', 'kemenangan battle melawan siswa')}</div>
          ${champs.length ? `<ol class="gb-rank">${champs.map(([id, n], i) => `<li class="${id === user.id ? 'is-me' : ''}"><span class="gb-rk">${medal(i)}</span>
            <span class="gb-rn">${esc(userName(id))}</span><b>${n} menang</b></li>`).join('')}</ol>`
            : '<div class="empty"><div class="empty-icon">⚔️</div>Belum ada battle yang selesai.</div>'}
        </div>
      </div>`;
    body.querySelector('#gbRankG').addEventListener('change', (e) => { view.rankGame = e.target.value; paintRank(body, user); });
  }

  function paintHistory(body, user) {
    const mine = getScores().filter(s => s.studentId === user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
    const RES = { win: '<span class="badge badge-success">Menang</span>', lose: '<span class="badge badge-danger">Kalah</span>', draw: '<span class="badge badge-gray">Seri</span>' };
    body.innerHTML = `<div class="card"><div class="card-header">${UI.secHead('📜', 'Riwayat Main', '30 ronde terakhir')}</div>
      ${mine.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Game</th><th>Mode</th><th>Skor</th><th>Benar</th><th>Hasil</th><th>Waktu</th></tr></thead>
        <tbody>${mine.map(s => { const g = GAME[s.game] || {}; return `<tr><td>${g.icon || '🎮'} ${esc(g.name || s.game)}</td>
          <td>${s.mode === 'battle' ? `⚔️ vs ${esc(firstName(s.opponentId))}` : s.mode === 'bot' ? '🦾 vs Bot' : '🎯 Pribadi'}</td>
          <td><strong>${fmt(s.score)}</strong></td><td>${s.correct}/${s.answered}</td><td>${RES[s.result] || '-'}</td>
          <td class="small">${esc(UI.fmtDateTime(s.createdAt))}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<div class="empty"><div class="empty-icon">🎮</div>Belum ada riwayat. Ayo main!</div>'}</div>`;
    if (global.Responsive) Responsive.apply(body);
  }

  /* ================================================================
   * Pengamat global: kartu undangan battle di halaman mana pun (siswa)
   * ==============================================================*/
  let watchUser = null;
  const shownCards = new Set();
  function dock() {
    let d = document.getElementById('gbDock');
    if (!d) { d = document.createElement('div'); d.id = 'gbDock'; d.className = 'gb-dock'; d.setAttribute('aria-live', 'polite'); document.body.appendChild(d); }
    return d;
  }
  function watch() {
    if (!watchUser || document.body.classList.contains('exam-mode')) return;
    const me = watchUser.id;
    const now = Date.now();
    const onPage = global.Dashboard && Dashboard.currentSection && Dashboard.currentSection() === PAGE;
    // Kartu yang sudah tidak relevan dihapus.
    document.querySelectorAll('#gbDock [data-card]').forEach(el => {
      const b = getBattle(el.dataset.card);
      if (!b || battleExpired(b, now) || (el.dataset.kind === 'inv' && b.status !== 'invite') || (el.dataset.kind === 'acc' && (onPage || session))) el.remove();
    });
    if (session) return;
    getBattles().forEach(b => {
      if (b.status === 'invite' && b.p2Id === me && !battleExpired(b, now) && !shownCards.has('inv:' + b.id)) {
        shownCards.add('inv:' + b.id);
        // Kartu selalu muncul (juga di halaman Game Battle, tab apa pun); daftar ikut diperbarui.
        showCard(b, 'inv');
        if (onPage && page) render(page.container, page.user);
      }
      if (b.status === 'playing' && b.p1Id === me && !onPage && !shownCards.has('acc:' + b.id)
        && now < (b.startAt || 0) + (b.limitMs || 300000) && !((b.players || {})[me] || {}).finished) {
        shownCards.add('acc:' + b.id);
        showCard(b, 'acc');
      }
    });
    if (onPage && page && !session && !view.waiting && view.tab === 'battle') {
      const sig = getBattles().filter(b => (b.status === 'open' || b.status === 'invite') && !battleExpired(b, now)).map(b => b.id + b.status).join('|') + '#' + onlineStudents(watchUser).map(o => o.id + o.state + o.busy).join('|');
      if (sig !== watch.lastSig) { watch.lastSig = sig; if (document.activeElement === document.body || !page.container.contains(document.activeElement)) render(page.container, page.user); }
    }
  }
  function showCard(b, kind) {
    const g = GAME[b.game] || GAMES[0];
    const el = document.createElement('div');
    el.className = 'gb-invite';
    el.dataset.card = b.id;
    el.dataset.kind = kind;
    el.innerHTML = `<span class="gb-invite-ic">${g.icon}</span>
      <div class="gb-invite-main">${kind === 'inv'
        ? `<strong>⚔️ ${esc(userName(b.p1Id))} menantangmu!</strong><span>${esc(g.name)}${b.subject ? ' • ' + esc(b.subject) : ''}</span>`
        : `<strong>✅ ${esc(firstName(b.p2Id))} menerima tantanganmu!</strong><span>${esc(g.name)} — battle sudah dimulai.</span>`}</div>
      <div class="gb-invite-act">${kind === 'inv'
        ? '<button type="button" class="btn btn-sm btn-primary" data-x="acc">Terima</button><button type="button" class="btn btn-sm btn-ghost" data-x="dec">Tolak</button>'
        : '<button type="button" class="btn btn-sm btn-primary" data-x="go">Main Sekarang</button><button type="button" class="icon-btn" data-x="close" aria-label="Tutup">&times;</button>'}</div>`;
    dock().appendChild(el);
    beep('go');
    el.querySelectorAll('[data-x]').forEach(btn => btn.addEventListener('click', () => {
      const x = btn.dataset.x;
      el.remove();
      if (x === 'dec') { declineBattle(watchUser, b.id); return; }
      if (x === 'close') return;
      if (x === 'acc') pendingJoin = b.id;
      if (global.Dashboard) Dashboard.navigate(PAGE);
    }));
  }

  /** Dipanggil dashboard sekali saat masuk (siswa). */
  function init(user) {
    if (!user || user.role !== 'siswa' || watchUser) return;
    watchUser = user;
    // Undangan lama tidak dimunculkan ulang sebagai kartu.
    getBattles().forEach(b => { if (b.status !== 'invite' || battleExpired(b)) shownCards.add('inv:' + b.id); });
    global.addEventListener('storage', (e) => {
      if (e.key === K.battles) { watch(); if (session && session.onBattleChange) session.onBattleChange(); }
      if (e.key === 'lms_presence_v1') watch();
    });
    setInterval(watch, 4000);
  }

  function stop() { stopSession('nav'); clearTimeout(waitTimer); page = null; }

  global.Games = {
    PAGE, KEYS: K, GAMES, GAME, settings, poolFor, unitsOf, autoValid, sourceQuestions, getGameQuestions, upsertQuestion: (q) => upsert(K.q, q),
    removeQuestion: (id) => removeRec(K.q, id), getBattles, getScores, playableGames, gameCardHtml, keyText,
    render, init, stop, runSession, stopSession, AnswerUI, winnerOf,
    _test: { mulberry, shuffle, bsCards, memoryPairs, createBattle, acceptBattle, autoMatch, onlineStudents }
  };
})(window);
