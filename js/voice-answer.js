/* =====================================================================
 * js/voice-answer.js — menjawab soal dengan suara (Web Speech API)
 * ---------------------------------------------------------------------
 * Cukup sebut hurufnya ("A", "be", "pilihan C") atau isi jawabannya
 * ("dua puluh lima", "benar"). Pengenalan suara berjalan di peramban
 * (Chrome/Edge/Safari; Firefox belum mendukung), bahasa id-ID.
 * Dipakai Balapan Mobil (mode kelas di proyektor) dan Main Bareng Kelas.
 *
 *   VoiceAnswer.supported()                 → boolean
 *   VoiceAnswer.match(texts, options, kind) → indeks pilihan atau -1
 *   VoiceAnswer.attach(host, q, opts)       → tombol mikrofon untuk soal
 *                                             PG / Benar-Salah di AnswerUI
 * ===================================================================*/
(function (global) {
  'use strict';
  const SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  const PREF = 'lms_voice_pref';

  const supported = () => !!SR;
  const prefOn = () => { try { return localStorage.getItem(PREF) === '1'; } catch (e) { return false; } };
  const setPref = (on) => { try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) { /* noop */ } };

  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9,./ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  /* Nama huruf seperti diucapkan (bahasa Indonesia & Inggris). */
  const LETTER = {
    a: 0, ah: 0, aa: 0, hah: 0,
    b: 1, be: 1, bee: 1, beh: 1, bi: 1,
    c: 2, ce: 2, se: 2, see: 2, che: 2, ceh: 2, si: 2, sea: 2,
    d: 3, de: 3, dee: 3, deh: 3, di: 3,
    e: 4, eh: 4, ee: 4, i: 4
  };
  const LEAD = /^(pilihan|jawaban|jawabannya|jawab|huruf|opsi|option|answer|yang|nomor)\s+/;
  const NUM_WORDS = { nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10, sebelas: 11, seratus: 100, seribu: 1000 };
  /** "dua puluh lima" → "25" (sederhana, sampai ribuan). */
  function wordsToNumber(s) {
    return s.replace(/((?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|belas|puluh|ratus|ribu)(?:\s+|$))+/g, (m) => {
      const toks = m.trim().split(/\s+/);
      let total = 0, cur = 0;
      toks.forEach(t => {
        if (t in NUM_WORDS) { const v = NUM_WORDS[t]; if (v >= 100) { total += (cur || 1) * v; cur = 0; } else cur += v; }
        else if (t === 'belas') cur += 10;
        else if (t === 'puluh') cur *= 10;
        else if (t === 'ratus') { total += (cur || 1) * 100; cur = 0; }
        else if (t === 'ribu') { total = (total + (cur || 1)) * 1000; cur = 0; }
      });
      return String(total + cur) + ' ';
    }).trim();
  }
  function bigrams(s) { const out = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); out.set(b, (out.get(b) || 0) + 1); } return out; }
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0;
    A.forEach((n, k) => { inter += Math.min(n, B.get(k) || 0); });
    return (2 * inter) / (a.length - 1 + b.length - 1);
  }

  /**
   * Cocokkan hasil pengenalan suara dengan pilihan jawaban.
   * @param {string[]} texts  alternatif transkrip (terbaik dulu)
   * @param {string[]} options teks polos tiap pilihan
   * @param {'pg'|'bs'} kind
   */
  function match(texts, options, kind) {
    const opts = (options || []).map(o => wordsToNumber(norm(o)));
    for (const raw of texts || []) {
      let t = norm(raw);
      if (!t) continue;
      t = t.replace(LEAD, '').replace(LEAD, '');
      if (kind === 'bs') {
        if (/^(benar|betul|bener|true|ya|iya|right|correct)\b/.test(t)) return 0;
        if (/^(salah|keliru|false|tidak|bukan|wrong|nggak|enggak)\b/.test(t)) return 1;
      }
      const words = t.split(' ');
      if (words.length <= 2 && Object.prototype.hasOwnProperty.call(LETTER, words[0])) {
        const i = LETTER[words[0]];
        if (i < opts.length) return i;
      }
      const tn = wordsToNumber(t);
      // Isi jawaban persis, atau tepat satu pilihan yang termuat dalam ucapan.
      const eq = opts.findIndex(o => o && o === tn);
      if (eq >= 0) return eq;
      const inside = opts.map((o, i) => ({ o, i })).filter(x => x.o && x.o.length >= 2 && (` ${tn} `).includes(` ${x.o} `));
      if (inside.length === 1) return inside[0].i;
      // Mirip (koefisien Dice bigram) dengan selisih yang jelas.
      const sc = opts.map(o => dice(o, tn)).map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
      if (sc.length && sc[0].s >= 0.62 && (sc.length < 2 || sc[0].s - sc[1].s >= 0.12)) return sc[0].i;
    }
    return -1;
  }

  /* ---------------- Pendengar ---------------- */
  let active = null;
  /** Mulai mendengarkan sekali. Mengembalikan pengendali { stop }. */
  function listen(o) {
    stop();
    if (!SR) { if (o.onError) o.onError('Peramban ini belum mendukung pengenalan suara. Gunakan Chrome atau Edge.'); return null; }
    let rec;
    try { rec = new SR(); } catch (e) { if (o.onError) o.onError('Mikrofon tidak dapat dipakai.'); return null; }
    rec.lang = o.lang || 'id-ID';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    const ctl = { rec, stopped: false, stop() { this.stopped = true; try { rec.abort(); } catch (e) { /* noop */ } } };
    rec.onresult = (ev) => {
      const res = ev.results[ev.results.length - 1];
      const texts = [];
      for (let i = 0; i < res.length; i++) texts.push(res[i].transcript);
      if (o.onText) o.onText(texts);
    };
    rec.onerror = (ev) => {
      const msg = { 'not-allowed': 'Izin mikrofon ditolak. Izinkan mikrofon di pengaturan peramban.', 'service-not-allowed': 'Izin mikrofon ditolak.', 'audio-capture': 'Mikrofon tidak ditemukan.', network: 'Pengenalan suara butuh koneksi internet.' }[ev.error];
      if (msg && o.onError) o.onError(msg);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') ctl.fatal = true;
    };
    rec.onend = () => { if (active === ctl) active = null; if (o.onEnd) o.onEnd(ctl); };
    try { rec.start(); } catch (e) { if (o.onError) o.onError('Mikrofon sedang dipakai.'); return null; }
    active = ctl;
    if (o.onStart) o.onStart();
    return ctl;
  }
  function stop() { if (active) { const a = active; active = null; a.stop(); } }

  /* ---------------- Tombol mikrofon untuk AnswerUI ---------------- */
  const plain = (h) => (global.RichText ? RichText.plain(h || '', 200) : String(h || '')).trim();
  const fmtOf = (q) => q.questionType || 'Pilihan Ganda';
  /** Soal yang dapat dijawab dengan suara (PG & Benar/Salah). */
  function canVoice(q) { return !!q && (fmtOf(q) === 'Pilihan Ganda' || fmtOf(q) === 'Benar/Salah'); }

  /**
   * Pasang tombol mikrofon di atas pilihan jawaban (host = wadah AnswerUI).
   * opts: { auto: boolean (langsung mendengar), labels?: string[], onPick?(i) }
   * Jawaban dipilih dengan mengeklik tombol [data-opt=i] yang ada di host.
   */
  function attach(host, q, opts) {
    const o = opts || {};
    if (!host || !canVoice(q)) return null;
    const kind = fmtOf(q) === 'Benar/Salah' ? 'bs' : 'pg';
    const labels = o.labels || (kind === 'bs' ? ['Benar', 'Salah'] : (q.options || []).map(plain));
    const bar = document.createElement('div');
    bar.className = 'va-bar';
    const ok = supported();
    bar.innerHTML = `<button type="button" class="va-btn" aria-pressed="false" ${ok ? '' : 'disabled'}>
        ${GameArt.icon('mic', 18)}<span>${ok ? 'Jawab dengan suara' : 'Suara tidak didukung peramban ini'}</span></button>
      <label class="va-auto" ${ok ? '' : 'hidden'}><input type="checkbox" ${prefOn() ? 'checked' : ''}/> otomatis tiap soal</label>
      <span class="va-heard" aria-live="polite"></span>`;
    host.prepend(bar);
    const btn = bar.querySelector('.va-btn'), heard = bar.querySelector('.va-heard');
    let ctl = null, done = false, tries = 0;
    const setOn = (on) => { btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', String(on)); btn.querySelector('span').textContent = on ? 'Mendengarkan… sebut huruf atau jawaban' : 'Jawab dengan suara'; };
    const start = () => {
      if (done || !ok || !host.isConnected) return;
      ctl = listen({
        onStart: () => setOn(true),
        onText: (texts) => {
          heard.textContent = '“' + texts[0] + '”';
          const i = match(texts, labels, kind);
          if (i < 0) { heard.textContent += ' — belum dikenali, ulangi.'; return; }
          const b = host.querySelector(`[data-opt="${i}"]`);
          if (b && !b.disabled) { done = true; if (o.onPick) o.onPick(i); else b.click(); }
        },
        onError: (m) => { heard.textContent = m; },
        onEnd: (c) => {
          setOn(false);
          // Mode otomatis: dengarkan lagi sampai terjawab (maks. 4 kali).
          if (!done && !c.stopped && !c.fatal && bar.querySelector('.va-auto input').checked && tries++ < 4 && host.isConnected && !host.classList.contains('is-locked')) setTimeout(start, 250);
        }
      });
    };
    btn.addEventListener('click', () => { if (ctl && btn.classList.contains('is-on')) { ctl.stop(); setOn(false); } else { tries = 0; start(); } });
    bar.querySelector('.va-auto input').addEventListener('change', (e) => { setPref(e.target.checked); if (e.target.checked && !btn.classList.contains('is-on')) { tries = 0; start(); } });
    if (ok && (o.auto || prefOn())) setTimeout(start, 200);
    const api = { stop() { done = true; if (ctl) ctl.stop(); setOn(false); } };
    // Berhenti otomatis bila jawaban terkunci / soal diganti.
    const mo = new MutationObserver(() => { if (!host.isConnected || host.classList.contains('is-locked')) { api.stop(); mo.disconnect(); } });
    mo.observe(host, { attributes: true, attributeFilter: ['class'] });
    if (host.parentNode) mo.observe(host.parentNode, { childList: true });
    return api;
  }

  global.VoiceAnswer = { supported, match, listen, stop, attach, canVoice, wordsToNumber, prefOn, setPref };
})(window);
