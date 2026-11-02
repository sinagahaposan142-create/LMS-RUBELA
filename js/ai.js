/* =====================================================================
 * js/ai.js — Lapisan integrasi AI bersama (multi-penyedia + Agent API)
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh panel admin, tutor, siswa, dan orang tua supaya
 * perilaku AI identik di seluruh aplikasi.
 *
 * Penyedia: Google Gemini, Groq, Mistral AI, OpenRouter, atau endpoint
 * kompatibel OpenAI (lihat js/ai-providers.js). Bila penyedia utama gagal
 * (kuota habis, kunci salah, server/jaringan bermasalah) penyedia lain
 * yang kuncinya terisi dicoba otomatis.
 *
 * CATATAN KEAMANAN — PENTING
 * Kunci API TIDAK boleh ditulis di dalam kode dan tidak boleh ikut
 * ter-commit ke repositori. Admin mengisinya lewat menu Pengaturan.
 * Mode server: kunci disimpan di database server dan hanya admin yang
 * dapat melihatnya; semua panggilan AI diteruskan oleh /api/rubela.
 * Mode lokal: kunci hanya disimpan di browser admin tersebut.
 * ===================================================================*/
(function (global) {
  'use strict';

  const DEFAULT_MODEL = 'gemini-flash-latest';
  const DEFAULT_TIMEOUT = 30000;
  const P = () => global.AIProviders;
  let lastUsed = null;          // { provider, model } penyedia yang terakhir menjawab

  const esc = (s) => (global.UI && UI.esc) ? UI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------------------------------------------------------------
   * Konfigurasi
   * -------------------------------------------------------------*/
  function settings() { return (global.DB && DB.getSettings) ? DB.getSettings() : {}; }
  function cfg() {
    const s = settings();
    const chain = P() ? P().chain(s) : [];
    const primary = P() ? P().primaryId(s) : 'gemini';
    return {
      enabled: s.aiEnabled !== false,
      provider: primary,
      providers: chain.map(c => c.id),
      key: chain.length ? chain[0].key : String(s.geminiApiKey || '').trim(),
      model: chain.length ? chain[0].model : (String(s.geminiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL),
      fallback: s.aiFallback !== false,
      timeout: Number(s.aiTimeoutMs) > 0 ? Number(s.aiTimeoutMs) : DEFAULT_TIMEOUT,
      tfKey: String(s.tinyfishApiKey || '').trim(),
      tfEndpoint: String(s.tinyfishEndpoint || '').trim()
    };
  }

  /** Mode server: panggilan AI diteruskan oleh /api/rubela memakai kunci di server. */
  function viaServer() { return !!(global.Sync && Sync.isServer()); }

  /** Apakah AI siap dipakai (diaktifkan + minimal satu penyedia berkunci). */
  function ready() { const c = cfg(); return !!(c.enabled && c.providers.length); }
  /** Apakah Agent API (TinyFish) siap dipakai. */
  function agentReady() { const c = cfg(); return !!(c.enabled && c.tfKey && c.tfEndpoint); }
  /** Nama penyedia (utama, atau yang terakhir menjawab) untuk label "Ditenagai …". */
  function providerLabel(which) {
    const id = which === 'last' && lastUsed ? lastUsed.provider : cfg().provider;
    const p = P() && P().PROVIDERS[id];
    return p ? p.label : 'AI';
  }

  function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /** Mode lokal: panggil satu penyedia langsung dari browser. */
  async function callDirect(c, body, timeout, plain) {
    const def = P().buildRequest(c, body, { plain, noJson: plain, referer: global.location ? global.location.origin : '' });
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(def.url, { method: 'POST', headers: def.headers, body: JSON.stringify(def.body), signal: ctrl ? ctrl.signal : undefined });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return P().normalizeResponse(c, res.status, data);
    } catch (e) {
      const to = e && e.name === 'AbortError';
      return { ok: false, code: to ? 'timeout' : 'network',
        error: to ? 'Permintaan ke AI melebihi batas waktu. Coba lagi atau perpendek pertanyaan.' : `Tidak dapat menghubungi ${c.label}. Periksa koneksi internet Anda.` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------
   * Pemanggilan AI (format permintaan Gemini, diterjemahkan per penyedia)
   * -------------------------------------------------------------*/
  /**
   * Kirim percakapan ke AI.
   * @param {Array} turns  [{ role:'user'|'model', text:'...' }]
   * @param {object} opts  { system, temperature, maxTokens, json,
   *                         test:{ provider, key, model, endpoint } (uji koneksi admin) }
   * @returns {Promise<string>} teks jawaban
   */
  async function chat(turns, opts) {
    const o = opts || {};
    const c = cfg();
    const test = o.test && o.test.provider ? o.test : null;
    if (!c.enabled && !test) throw err('disabled', 'Fitur AI sedang dimatikan oleh admin pada menu Pengaturan.');
    if (!test && !c.providers.length) throw err('nokey', 'Kunci API AI belum diisi. Admin dapat menambahkannya di Pengaturan → Integrasi AI.');

    const body = {
      contents: (turns || []).map(t => ({
        role: t.role === 'model' ? 'model' : 'user',
        parts: [{ text: String(t.text == null ? '' : t.text) }]
      })),
      generationConfig: {
        temperature: o.temperature == null ? 0.7 : o.temperature,
        maxOutputTokens: o.maxTokens || 2048
      }
    };
    if (o.system) body.systemInstruction = { parts: [{ text: String(o.system) }] };
    if (o.json) body.generationConfig.responseMimeType = 'application/json';

    let res;
    let data = null;
    let used = null;
    if (viaServer()) {
      // Mode server: kunci API hanya ada di server; browser mengirim lewat /api/rubela.
      try { await Sync.flush(); } catch (e) { /* tetap coba */ }
      let out;
      const req = { payload: body };
      if (test) Object.assign(req, { test: true, provider: test.provider, testKey: test.key || '', model: test.model || '', endpoint: test.endpoint || '' });
      try {
        // Penyedia cadangan bisa dicoba berurutan di server — beri waktu lebih.
        out = await Sync.api('ai', req, { timeout: Math.max(c.timeout + 10000, 62000) });
      } catch (e) {
        if (!e.status) throw err('network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.');
        throw err('server', e.message || 'Server AI sedang bermasalah. Coba lagi.');
      }
      if (!out.ok) throw err(out.code || 'http', out.error || 'Permintaan AI gagal.');
      res = { ok: out.status >= 200 && out.status < 300, status: out.status };
      data = out.data;
      used = out.provider ? { provider: out.provider, model: out.model || '' } : null;
    } else {
      if (!P()) throw err('config', 'Modul penyedia AI belum termuat. Muat ulang halaman.');
      const s = settings();
      const chain = test ? P().chain(s, { only: test.provider, key: test.key, model: test.model, endpoint: test.endpoint }) : P().chain(s);
      if (!chain.length) throw err('nokey', 'Kunci API/endpoint penyedia AI belum diisi atau tidak valid.');
      let last = null;
      for (const pc of chain) {
        let r = await callDirect(pc, body, c.timeout, false);
        if (!r.ok && r.retryPlain) r = await callDirect(pc, body, c.timeout, true);
        if (r.ok && !P().shouldFallback(r)) { last = { r, pc }; break; }
        last = { r, pc };
      }
      const r = last.r;
      if (r.code) throw err(r.code, r.error);
      res = { ok: r.ok, status: r.status };
      data = r.data;
      used = { provider: last.pc.id, model: last.pc.model };
    }
    if (used) lastUsed = used;
    const label = used && P() && P().PROVIDERS[used.provider] ? P().PROVIDERS[used.provider].label : 'AI';

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + res.status);
      if (res.status === 400 && /api key|API_KEY/i.test(msg)) {
        throw err('badkey', `Kunci API ${label} tidak valid. Periksa kembali di Pengaturan → Integrasi AI.`);
      }
      if (res.status === 401 || res.status === 403) {
        throw err('forbidden', `Kunci API ${label} ditolak (tidak punya izin). Pastikan kunci masih aktif.`);
      }
      if (res.status === 413) {
        throw err('toolarge', 'Permintaan terlalu panjang untuk batas penyedia AI gratis. Perpendek teks atau tambahkan penyedia cadangan.');
      }
      if (res.status === 429) {
        throw err('quota', `Kuota permintaan ${label} sedang penuh. Tunggu sebentar, atau tambahkan penyedia cadangan di Pengaturan → Integrasi AI.`);
      }
      if (res.status >= 500) {
        throw err('server', `Layanan ${label} sedang bermasalah (server). Coba lagi beberapa saat lagi.`);
      }
      throw err('http', 'Permintaan AI gagal: ' + msg);
    }

    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw err('blocked', 'Permintaan ditolak oleh filter keamanan AI (' + data.promptFeedback.blockReason + ').');
    }
    const cand = data && data.candidates && data.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    const text = (parts || []).map(p => p && p.text ? p.text : '').join('').trim();
    if (!text) {
      if (cand && cand.finishReason === 'MAX_TOKENS') {
        throw err('truncated', 'Jawaban AI terpotong karena terlalu panjang. Coba pertanyaan yang lebih spesifik.');
      }
      throw err('empty', 'AI tidak memberikan jawaban. Coba ulangi dengan kalimat berbeda.');
    }
    return text;
  }

  /** Pertanyaan tunggal. */
  function ask(prompt, opts) {
    return chat([{ role: 'user', text: prompt }], opts);
  }

  /**
   * Minta jawaban JSON dan langsung di-parse.
   * Tetap tahan terhadap jawaban yang dibungkus ```json ... ```.
   */
  async function askJson(prompt, opts) {
    const raw = await ask(prompt, Object.assign({ json: true, temperature: 0.3 }, opts || {}));
    return parseJson(raw);
  }

  function parseJson(raw) {
    let t = String(raw || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch (e) { /* lanjut ke percobaan berikutnya */ }
    // Ambil blok JSON pertama yang masuk akal.
    const start = t.search(/[[{]/);
    if (start >= 0) {
      const lastArr = t.lastIndexOf(']');
      const lastObj = t.lastIndexOf('}');
      const end = Math.max(lastArr, lastObj);
      if (end > start) {
        try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* jatuh ke error */ }
      }
    }
    throw err('parse', 'Jawaban AI bukan JSON yang valid sehingga tidak bisa diproses otomatis.');
  }

  /* ---------------------------------------------------------------
   * Agent API (TinyFish) — ekstraksi data terstruktur dari URL
   * -------------------------------------------------------------*/
  /**
   * @param {string} url   halaman sumber
   * @param {string} goal  instruksi data apa yang ingin diambil
   * @returns {Promise<{rows:Array, raw:*}>}
   */
  async function agentExtract(url, goal) {
    const c = cfg();
    if (!c.enabled) throw err('disabled', 'Fitur AI sedang dimatikan oleh admin pada menu Pengaturan.');
    if (!c.tfEndpoint) throw err('noendpoint', 'Endpoint Agent API belum diisi di Pengaturan → Integrasi AI.');
    if (!c.tfKey) throw err('nokey', 'Kunci Agent API belum diisi di Pengaturan → Integrasi AI.');
    if (!/^https?:\/\//i.test(url)) throw err('badurl', 'URL harus dimulai dengan http:// atau https://');

    let res;
    let data = null;
    let text = '';
    if (viaServer()) {
      try { await Sync.flush(); } catch (e) { /* tetap coba */ }
      let out;
      try { out = await Sync.api('agent', { url: url, goal: goal }, { timeout: 70000 }); }
      catch (e) {
        if (!e.status) throw err('network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.');
        throw err(e.status === 403 ? 'forbidden' : 'server', e.message || 'Agent API gagal.');
      }
      if (!out.ok) throw err(out.code || 'http', out.error || 'Agent API gagal.');
      res = { ok: out.status >= 200 && out.status < 300, status: out.status };
      text = out.text || '';
      try { data = JSON.parse(text); } catch (e2) { data = null; }
    } else {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      let timer = null;
      if (ctrl) timer = setTimeout(() => ctrl.abort(), Math.max(c.timeout, 60000));
      try {
        res = await fetch(c.tfEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + c.tfKey
          },
          body: JSON.stringify({ url: url, goal: goal }),
          signal: ctrl ? ctrl.signal : undefined
        });
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (e && e.name === 'AbortError') throw err('timeout', 'Agent API melebihi batas waktu.');
        throw err('network', 'Tidak dapat menghubungi Agent API. Periksa endpoint dan koneksi internet.');
      }
      if (timer) clearTimeout(timer);
      const ct = res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '';
      try {
        if (/json/i.test(ct)) data = await res.json();
        else { text = await res.text(); try { data = JSON.parse(text); } catch (e2) { data = null; } }
      } catch (e) { data = null; }
    }

    if (!res.ok) {
      const msg = (data && (data.message || (data.error && (data.error.message || data.error)))) || ('HTTP ' + res.status);
      if (res.status === 401 || res.status === 403) throw err('forbidden', 'Kunci Agent API ditolak.');
      if (res.status === 429) throw err('quota', 'Kuota Agent API penuh. Coba lagi nanti.');
      throw err('http', 'Agent API gagal: ' + msg);
    }
    return { rows: normalizeRows(data), raw: data == null ? text : data };
  }

  /** Cari array objek pada bentuk balasan yang beragam. */
  function normalizeRows(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data.filter(r => r && typeof r === 'object');
    for (const k of ['rows', 'data', 'items', 'result', 'results', 'output', 'records']) {
      if (Array.isArray(data[k])) return data[k].filter(r => r && typeof r === 'object');
    }
    // Mode JSON penyedia berformat OpenAI mewajibkan objek, sehingga array sering
    // dibungkus kunci lain (mis. {"soal":[...]}) — ambil array objek pertama.
    if (typeof data === 'object') {
      const arrKey = Object.keys(data).find(k => Array.isArray(data[k]) && data[k].some(r => r && typeof r === 'object'));
      if (arrKey) return data[arrKey].filter(r => r && typeof r === 'object');
    }
    // Kadang hasil dikirim sebagai string JSON di dalam field teks.
    for (const k of ['text', 'content', 'answer']) {
      if (typeof data[k] === 'string') {
        try {
          const p = parseJson(data[k]);
          if (Array.isArray(p)) return p.filter(r => r && typeof r === 'object');
        } catch (e) { /* abaikan */ }
      }
    }
    if (typeof data === 'object') return [data];
    return [];
  }

  /* ---------------------------------------------------------------
   * Tampilan bantu (dipakai semua panel agar konsisten)
   * -------------------------------------------------------------*/
  /** Pemberitahuan bila AI belum dikonfigurasi. */
  function noticeHtml(user) {
    const c = cfg();
    if (c.enabled && c.providers.length) return '';
    const isAdmin = user && user.role === 'admin';
    const why = !c.enabled
      ? 'Fitur AI sedang dimatikan pada menu Pengaturan.'
      : 'Kunci API AI (Gemini, Groq, Mistral, atau OpenRouter) belum diisi.';
    let how;
    if (isAdmin) how = ' Buka <strong>Pengaturan → Integrasi AI</strong> untuk memilih penyedia dan memasukkan kunci API.';
    else if (user && user.role === 'guru') {
      how = viaServer()
        ? ' Integrasi AI dikelola admin di server — hubungi admin agar mengisi kunci di <strong>Pengaturan → Integrasi AI</strong>.'
        : ' Buka <strong>Profil → Integrasi AI</strong> untuk mengisi kunci di perangkat ini (mode lokal).';
    } else how = ' Hubungi admin agar mengaktifkan integrasi AI terlebih dahulu.';
    return `
      <div class="alert alert-warning ai-notice">
        <strong>🤖 Fitur AI belum aktif.</strong> ${esc(why)}${how}
        <div class="muted small" style="margin-top:6px;">
          Tanpa kunci API, halaman ini tetap menampilkan analisis dari data asli LMS —
          hanya ulasan naratif dari AI yang tidak tersedia.
        </div>
      </div>`;
  }

  /** Kotak status "sedang berpikir". */
  function loadingHtml(label) {
    return `<div class="ai-loading"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>
      <span class="muted small">${esc(label || 'AI sedang menyusun jawaban…')}</span></div>`;
  }

  /** Kotak error yang ramah. */
  function errorHtml(e) {
    const msg = (e && e.message) ? e.message : 'Terjadi kesalahan tak terduga saat memanggil AI.';
    return `<div class="alert alert-danger">🤖 ${esc(msg)}</div>`;
  }

  /**
   * Render markdown sederhana dari AI menjadi HTML yang aman.
   * Semua teks di-escape lebih dulu, baru pola markdown diterapkan.
   */
  function renderMarkdown(text) {
    let s = esc(String(text == null ? '' : text));

    // Blok kode
    const blocks = [];
    s = s.replace(/```(?:[\w-]+)?\n?([\s\S]*?)```/g, (m, code) => {
      blocks.push(code.replace(/\n$/, ''));
      return '\u0000BLOCK' + (blocks.length - 1) + '\u0000';
    });

    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
    s = s.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^#\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // Daftar
    s = s.replace(/(?:^|\n)((?:\s*[-*]\s+.+(?:\n|$))+)/g, (m, chunk) => {
      const items = chunk.trim().split(/\n/).map(l => l.replace(/^\s*[-*]\s+/, ''));
      return '\n<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
    });
    s = s.replace(/(?:^|\n)((?:\s*\d+[.)]\s+.+(?:\n|$))+)/g, (m, chunk) => {
      const items = chunk.trim().split(/\n/).map(l => l.replace(/^\s*\d+[.)]\s+/, ''));
      return '\n<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
    });

    s = s.split(/\n{2,}/).map(p => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h3|h4|ul|ol|pre)/.test(t)) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('');

    s = s.replace(/\u0000BLOCK(\d+)\u0000/g, (m, i) => `<pre class="ai-code">${blocks[Number(i)]}</pre>`);
    return s;
  }

  /** Ubah HTML editor menjadi teks biasa untuk dikirim ke AI. */
  function toPlain(html) {
    if (global.RichText && RichText.plain) return RichText.plain(html, 4000);
    const d = document.createElement('div');
    d.innerHTML = String(html == null ? '' : html);
    return (d.textContent || '').trim();
  }

  global.AI = {
    cfg, ready, agentReady, providerLabel,
    lastUsed: () => lastUsed,
    chat, ask, askJson, parseJson,
    agentExtract, normalizeRows,
    noticeHtml, loadingHtml, errorHtml, renderMarkdown, toPlain,
    DEFAULT_MODEL
  };
})(window);
