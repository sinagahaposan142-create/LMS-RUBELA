/* =====================================================================
 * js/ai.js — Lapisan integrasi AI bersama (multi-penyedia + Agent API)
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh panel admin, tutor, siswa, dan orang tua supaya
 * perilaku AI identik di seluruh aplikasi.
 *
 * Penyedia: Gemini, Groq, Mistral, OpenRouter, DeepSeek, Kimi, SiliconFlow,
 * Meta Muse, dan gateway kompatibel OpenAI (lihat js/ai-providers.js).
 * Mode "single": penyedia utama, lalu cadangan bila gagal.
 * Mode "ensemble": beberapa AI menjawab bersamaan, lalu satu AI "juri"
 * memeriksa dan menyusun satu jawaban terbaik.
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
    const mode = P() ? P().modeOf(s) : 'single';
    const chain = P() ? P().chain(s, { all: mode === 'ensemble' }) : [];
    const primary = P() ? P().primaryId(s) : 'gemini';
    return {
      enabled: s.aiEnabled !== false,
      provider: primary,
      providers: chain.map(c => c.id),
      key: chain.length ? chain[0].key : String(s.geminiApiKey || '').trim(),
      model: chain.length ? chain[0].model : (String(s.geminiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL),
      fallback: s.aiFallback !== false,
      mode,
      ensembleSize: P() ? P().ensembleSize(s) : 3,
      /** Mode gabungan benar-benar aktif (≥ 2 penyedia siap). */
      ensembleActive: mode === 'ensemble' && chain.length >= 2,
      /** Penyedia siap yang bisa ikut mode gabungan (untuk pilihan per-pesan admin/tutor). */
      ensemblePossible: (P() ? P().chain(s, { all: true }) : []).length >= 2,
      pseudonymize: s.aiPseudonymize !== false,
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
  function labelOf(id) { const p = P() && P().PROVIDERS[id]; return p ? p.label : (id || 'AI'); }
  /** Nama penyedia (utama, atau yang terakhir menjawab) untuk label "Ditenagai …". */
  function providerLabel(which) {
    if (which === 'last' && lastUsed) return describeUsed(lastUsed);
    const c = cfg();
    if (c.ensembleActive) return `Gabungan ${Math.min(c.ensembleSize, c.providers.length)} AI`;
    return labelOf(c.provider);
  }
  /** Keterangan singkat penyedia yang menjawab, mis. "Gabungan: Gemini + Groq (juri Gemini)". */
  function describeUsed(u) {
    if (!u) return 'AI';
    const e = u.ensemble;
    if (e && e.answered && e.answered.length > 1) {
      return `Gabungan ${e.answered.length} AI: ${e.answered.map(labelOf).join(' + ')}${e.judge ? ` • disusun ${labelOf(e.judge)}` : ''}`;
    }
    return labelOf(u.provider) + (u.model ? ` (${u.model})` : '');
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
        error: to ? 'Permintaan ke AI melebihi batas waktu. Coba lagi atau perpendek pertanyaan.' : `Tidak dapat menghubungi ${c.label}. Periksa koneksi internet (atau penyedia ini memblokir akses langsung dari browser).` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Terjemahkan status/pesan galat penyedia menjadi pesan yang jelas bagi pengguna. */
  function httpError(status, data, label, model) {
    const e = data && data.error ? data.error : {};
    const msg = e.message || ('HTTP ' + status);
    const gst = String(e.status || '');
    if (/api[_ ]?key|API_KEY_INVALID|invalid.*key|incorrect.*key|key.*invalid/i.test(msg) && (status === 400 || status === 401 || status === 403)) {
      return err('badkey', `Kunci API ${label} tidak valid. Salin ulang kunci (tanpa spasi) di Pengaturan → Integrasi AI.`);
    }
    if (status === 404 || /not found|does not exist|unknown model|model.*not.*(exist|support|found)/i.test(msg)) {
      return err('model', `Model "${model || '?'}" tidak tersedia di ${label}. Gunakan tombol "Ambil daftar model" di Pengaturan → Integrasi AI lalu pilih model yang ada.`);
    }
    if (/location is not supported|User location|FAILED_PRECONDITION/i.test(msg + ' ' + gst)) {
      return err('region', `${label} menolak permintaan dari lokasi server ini (wilayah tidak didukung). Gunakan penyedia lain sebagai utama atau aktifkan cadangan.`);
    }
    if (/PERMISSION_DENIED|SERVICE_DISABLED|has not been used|is disabled/i.test(msg + ' ' + gst)) {
      return err('forbidden', `${label} menolak kunci ini: layanan belum diaktifkan atau kunci dibatasi. Buat kunci baru di dasbor penyedia (untuk Gemini: aistudio.google.com).`);
    }
    if (status === 401 || status === 403) return err('forbidden', `Kunci API ${label} ditolak (tidak punya izin). Pastikan kunci masih aktif.`);
    if (status === 429) return err('quota', `Kuota permintaan ${label} sedang penuh. Tunggu sebentar, atau tambahkan penyedia cadangan di Pengaturan → Integrasi AI.`);
    if (status === 402 || /insufficient.*(balance|credit|fund)|balance.*insufficient|billing|payment required/i.test(msg)) {
      return err('billing', `Saldo/kredit ${label} habis atau belum diisi. Isi saldo di dasbor penyedia, atau gunakan penyedia lain.`);
    }
    if (status === 413) return err('toolarge', 'Permintaan terlalu panjang untuk batas penyedia AI. Perpendek teks atau mulai percakapan baru.');
    if (status >= 500) return err('server', `Layanan ${label} sedang bermasalah (server). Coba lagi beberapa saat lagi.`);
    return err('http', `Permintaan AI ke ${label} gagal: ${msg}`);
  }

  /* ---------------------------------------------------------------
   * Pemanggilan AI (format permintaan Gemini, diterjemahkan per penyedia)
   * -------------------------------------------------------------*/
  /**
   * Kirim percakapan ke AI.
   * @param {Array} turns  [{ role:'user'|'model', text:'...' }]
   * @param {object} opts  { system, temperature, maxTokens, json,
   *                         mode:'single'|'ensemble' (opsional),
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
    const mode = o.mode === 'single' || o.mode === 'ensemble' ? o.mode : null;

    let res;
    let data = null;
    let used = null;
    if (viaServer()) {
      // Mode server: kunci API hanya ada di server; browser mengirim lewat /api/rubela.
      try { await Sync.flush(); } catch (e) { /* tetap coba */ }
      let out;
      const req = { payload: body };
      if (mode) req.mode = mode;
      if (test) Object.assign(req, { test: true, provider: test.provider, testKey: test.key || '', model: test.model || '', endpoint: test.endpoint || '' });
      try {
        // Penyedia cadangan / mode gabungan berjalan di server — beri waktu lebih.
        out = await Sync.api('ai', req, { timeout: Math.max(c.timeout + 12000, 66000) });
      } catch (e) {
        if (!e.status) throw err('network', 'Tidak dapat menghubungi server. Periksa koneksi internet Anda.');
        if (e.status === 504) throw err('timeout', 'Server AI melebihi batas waktu. Coba lagi, atau gunakan mode satu AI untuk pertanyaan ini.');
        throw err('server', e.message || 'Server AI sedang bermasalah. Coba lagi.');
      }
      if (!out.ok) throw err(out.code || 'http', out.error || 'Permintaan AI gagal.');
      res = { ok: out.status >= 200 && out.status < 300, status: out.status };
      data = out.data;
      used = out.provider ? { provider: out.provider, model: out.model || '', ensemble: out.ensemble || null } : null;
    } else {
      if (!P()) throw err('config', 'Modul penyedia AI belum termuat. Muat ulang halaman.');
      const s = settings();
      let m = P().modeOf(s);
      if (mode === 'single') m = 'single';
      else if (mode === 'ensemble') m = 'ensemble';
      const list = test ? P().chain(s, { only: test.provider, key: test.key, model: test.model, endpoint: test.endpoint })
        : P().chain(s, { all: m === 'ensemble' });
      if (!list.length) throw err('nokey', 'Kunci API/endpoint penyedia AI belum diisi atau tidak valid.');
      const out = await P().run(list, body, {
        call: callDirect, mode: test ? 'single' : m, size: P().ensembleSize(s),
        deadlineMs: Math.max(60000, c.timeout * 2), perCallMs: c.timeout
      });
      const r = out.r;
      if (!r) throw err('nokey', 'Tidak ada penyedia AI yang dapat dipanggil.');
      if (r.code) throw err(r.code, r.error);
      res = { ok: r.ok, status: r.status };
      data = r.data;
      used = { provider: out.c.id, model: out.c.model, ensemble: out.ensemble || null };
    }
    if (used) lastUsed = used;
    const label = used ? labelOf(used.provider) : 'AI';

    if (!res.ok) throw httpError(res.status, data, label, used && used.model);

    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw err('blocked', 'Permintaan ditolak oleh filter keamanan AI (' + data.promptFeedback.blockReason + '). Ubah kalimat pertanyaan.');
    }
    const cand = data && data.candidates && data.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    const text = (parts || []).map(p => p && p.text && !p.thought ? p.text : '').join('').trim();
    if (!text) {
      const fr = cand && cand.finishReason;
      if (fr === 'MAX_TOKENS') throw err('truncated', 'Jawaban AI terpotong karena batas panjang. Coba pertanyaan yang lebih spesifik.');
      if (/SAFETY|RECITATION|PROHIBITED|BLOCKLIST|SPII/.test(String(fr || ''))) {
        throw err('blocked', 'Jawaban ditahan oleh filter keamanan penyedia AI. Ubah kalimat pertanyaan.');
      }
      throw err('empty', 'AI tidak memberikan jawaban. Coba ulangi dengan kalimat berbeda.');
    }
    return text;
  }

  /**
   * Daftar model penyedia (admin, Pengaturan). Memakai kunci yang sedang
   * diketik bila ada, sehingga bisa dicek sebelum disimpan.
   * @returns {Promise<string[]>}
   */
  async function listModels(provider, key, endpoint) {
    if (!P() || !P().PROVIDERS[provider]) throw err('config', 'Penyedia tidak dikenal.');
    if (viaServer()) {
      let out;
      try { out = await Sync.api('ai_models', { provider, testKey: key || '', endpoint: endpoint || '' }, { timeout: 25000 }); }
      catch (e) { throw err(e.status ? 'server' : 'network', e.message || 'Tidak dapat menghubungi server.'); }
      if (!out.ok) {
        if (out.status) throw httpError(out.status, { error: { message: out.error } }, labelOf(provider), '');
        throw err(out.code || 'http', out.error || 'Gagal mengambil daftar model.');
      }
      return out.models || [];
    }
    const list = P().chain(settings(), { only: provider, key, model: 'x', endpoint });
    if (!list.length) throw err('nokey', 'Isi kunci API (dan Base URL untuk gateway) terlebih dahulu.');
    const c = list[0];
    const def = P().listModelsRequest(c);
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    try {
      const res = await fetch(def.url, { headers: def.headers, signal: ctrl ? ctrl.signal : undefined });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) throw httpError(res.status, data && data.error ? data : { error: { message: (data && data.message) || ('HTTP ' + res.status) } }, c.label, '');
      return P().parseModels(c, data);
    } catch (e) {
      if (e && e.code) throw e;
      throw err(e && e.name === 'AbortError' ? 'timeout' : 'network', `Tidak dapat menghubungi ${c.label} dari browser ini.`);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
    const raw = await ask(prompt, Object.assign({ json: true, temperature: 0.3, mode: 'single' }, opts || {}));
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
      : 'Belum ada kunci API AI yang diisi.';
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
    cfg, ready, agentReady, providerLabel, describeUsed, labelOf,
    lastUsed: () => lastUsed,
    chat, ask, askJson, parseJson, listModels,
    agentExtract, normalizeRows,
    noticeHtml, loadingHtml, errorHtml, renderMarkdown, toPlain,
    DEFAULT_MODEL
  };
})(window);
