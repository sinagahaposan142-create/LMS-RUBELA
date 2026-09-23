/* =====================================================================
 * js/ai.js — Lapisan integrasi AI bersama (Gemini + Agent API TinyFish)
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh panel admin, tutor, siswa, dan orang tua supaya
 * perilaku AI identik di seluruh aplikasi.
 *
 * CATATAN KEAMANAN — PENTING
 * Aplikasi ini statis (tanpa backend), sehingga seluruh JavaScript bisa
 * dibaca siapa pun yang membuka situs. Karena itu kunci API TIDAK boleh
 * ditulis di dalam kode dan tidak boleh ikut ter-commit ke repositori.
 * Kunci diisi admin lewat menu Pengaturan, lalu hanya disimpan di
 * localStorage browser admin tersebut.
 * ===================================================================*/
(function (global) {
  'use strict';

  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const DEFAULT_MODEL = 'gemini-flash-latest';
  const DEFAULT_TIMEOUT = 30000;

  const esc = (s) => (global.UI && UI.esc) ? UI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------------------------------------------------------------
   * Konfigurasi
   * -------------------------------------------------------------*/
  function cfg() {
    const s = (global.DB && DB.getSettings) ? DB.getSettings() : {};
    return {
      enabled: s.aiEnabled !== false,
      key: String(s.geminiApiKey || '').trim(),
      model: String(s.geminiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
      timeout: Number(s.aiTimeoutMs) > 0 ? Number(s.aiTimeoutMs) : DEFAULT_TIMEOUT,
      tfKey: String(s.tinyfishApiKey || '').trim(),
      tfEndpoint: String(s.tinyfishEndpoint || '').trim()
    };
  }

  /** Apakah Gemini siap dipakai (diaktifkan + ada kunci). */
  function ready() { const c = cfg(); return !!(c.enabled && c.key); }
  /** Apakah Agent API (TinyFish) siap dipakai. */
  function agentReady() { const c = cfg(); return !!(c.enabled && c.tfKey && c.tfEndpoint); }

  function err(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---------------------------------------------------------------
   * Pemanggilan Gemini
   * -------------------------------------------------------------*/
  /**
   * Kirim percakapan ke Gemini.
   * @param {Array} turns  [{ role:'user'|'model', text:'...' }]
   * @param {object} opts  { system, temperature, maxTokens, json, signal }
   * @returns {Promise<string>} teks jawaban
   */
  async function chat(turns, opts) {
    const o = opts || {};
    const c = cfg();
    if (!c.enabled) throw err('disabled', 'Fitur AI sedang dimatikan oleh admin pada menu Pengaturan.');
    if (!c.key) throw err('nokey', 'Kunci API Gemini belum diisi. Admin dapat menambahkannya di Pengaturan → Integrasi AI.');

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

    // Timeout manual: fetch tidak punya timeout bawaan.
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), c.timeout);

    let res;
    try {
      res = await fetch(GEMINI_BASE + encodeURIComponent(c.model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': c.key },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') {
        throw err('timeout', 'Permintaan ke AI melebihi batas waktu. Coba lagi atau perpendek pertanyaan.');
      }
      throw err('network', 'Tidak dapat menghubungi layanan AI. Periksa koneksi internet Anda.');
    }
    if (timer) clearTimeout(timer);

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + res.status);
      if (res.status === 400 && /api key|API_KEY/i.test(msg)) {
        throw err('badkey', 'Kunci API Gemini tidak valid. Periksa kembali di Pengaturan → Integrasi AI.');
      }
      if (res.status === 401 || res.status === 403) {
        throw err('forbidden', 'Kunci API ditolak (tidak punya izin). Pastikan kunci masih aktif.');
      }
      if (res.status === 429) {
        throw err('quota', 'Kuota permintaan AI sedang penuh. Tunggu sebentar lalu coba lagi.');
      }
      if (res.status >= 500) {
        throw err('server', 'Layanan AI sedang bermasalah (server). Coba lagi beberapa saat lagi.');
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

    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timer = null;
    if (ctrl) timer = setTimeout(() => ctrl.abort(), Math.max(c.timeout, 60000));

    let res;
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
    let data = null;
    let text = '';
    try {
      if (/json/i.test(ct)) data = await res.json();
      else { text = await res.text(); try { data = JSON.parse(text); } catch (e2) { data = null; } }
    } catch (e) { data = null; }

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
    if (c.enabled && c.key) return '';
    const isAdmin = user && user.role === 'admin';
    const why = !c.enabled
      ? 'Fitur AI sedang dimatikan pada menu Pengaturan.'
      : 'Kunci API Gemini belum diisi.';
    return `
      <div class="alert alert-warning ai-notice">
        <strong>🤖 Fitur AI belum aktif.</strong> ${esc(why)}
        ${isAdmin
          ? ' Buka <strong>Pengaturan → Integrasi AI</strong> untuk memasukkan kunci API Gemini.'
          : ' Hubungi admin agar mengaktifkan integrasi AI terlebih dahulu.'}
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
    cfg, ready, agentReady,
    chat, ask, askJson, parseJson,
    agentExtract, normalizeRows,
    noticeHtml, loadingHtml, errorHtml, renderMarkdown, toPlain,
    DEFAULT_MODEL
  };
})(window);
