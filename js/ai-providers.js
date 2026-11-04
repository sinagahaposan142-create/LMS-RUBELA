/* =====================================================================
 * js/ai-providers.js — daftar penyedia AI, penerjemah format, dan
 *                      orkestrator (satu penyedia + cadangan / gabungan)
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh browser (js/ai.js, mode lokal) dan server
 * (api/_lib/handlers.js → aiProxy) agar perilaku kedua mode identik.
 *
 * Seluruh fitur AI di LMS menyusun permintaan dalam format Gemini
 * ({ contents, systemInstruction, generationConfig }). Untuk penyedia
 * berformat OpenAI (Groq, Mistral, OpenRouter, DeepSeek, Kimi,
 * SiliconFlow, Meta Muse, dan gateway kompatibel OpenAI) permintaan
 * diterjemahkan ke /chat/completions, lalu jawabannya dikembalikan ke
 * bentuk Gemini (candidates[0].content.parts) sehingga kode pemanggil
 * tidak perlu berubah.
 *
 * Mode jawaban:
 *  - single   : penyedia utama, lalu (bila cadangan aktif) penyedia lain.
 *  - ensemble : beberapa penyedia menjawab bersamaan, lalu satu penyedia
 *               "juri" memeriksa dan menyusun SATU jawaban terbaik.
 *
 * KEAMANAN: berkas ini tidak berisi kunci apa pun. Kunci diisi admin di
 * Pengaturan → Integrasi AI dan (mode server) hanya tersimpan di database.
 * ===================================================================*/
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.AIProviders = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* group: 'resmi' = penyedia model langsung, 'gateway' = layanan perantara
   * berformat OpenAI dengan Base URL yang dapat diubah. */
  const PROVIDERS = {
    gemini: {
      id: 'gemini', label: 'Google Gemini', kind: 'gemini', group: 'resmi',
      keySetting: 'geminiApiKey', modelSetting: 'geminiModel', defaultModel: 'gemini-flash-latest',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      note: 'Gratis dengan kuota harian. Kunci dibuat di Google AI Studio (diawali "AIza"). Model bawaan selalu mengikuti Gemini Flash terbaru.'
    },
    groq: {
      id: 'groq', label: 'Groq', kind: 'openai', group: 'resmi',
      keySetting: 'groqApiKey', modelSetting: 'groqModel', defaultModel: 'openai/gpt-oss-120b',
      endpoint: 'https://api.groq.com/openai/v1',
      keyUrl: 'https://console.groq.com/keys',
      note: 'Paling cepat. Gratis tanpa kartu kredit.'
    },
    mistral: {
      id: 'mistral', label: 'Mistral AI', kind: 'openai', group: 'resmi',
      keySetting: 'mistralApiKey', modelSetting: 'mistralModel', defaultModel: 'mistral-small-latest',
      endpoint: 'https://api.mistral.ai/v1',
      keyUrl: 'https://console.mistral.ai/api-keys',
      note: 'Kuota token gratis besar pada mode gratis.'
    },
    openrouter: {
      id: 'openrouter', label: 'OpenRouter', kind: 'openai', group: 'resmi',
      keySetting: 'openrouterApiKey', modelSetting: 'openrouterModel', defaultModel: 'openrouter/free',
      endpoint: 'https://openrouter.ai/api/v1',
      keyUrl: 'https://openrouter.ai/settings/keys',
      note: 'Model gratis dipilih otomatis; batas permintaan harian kecil.'
    },
    deepseek: {
      id: 'deepseek', label: 'DeepSeek', kind: 'openai', group: 'resmi',
      keySetting: 'deepseekApiKey', modelSetting: 'deepseekModel', defaultModel: 'deepseek-flash',
      endpoint: 'https://api.deepseek.com',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      note: 'Kuat untuk matematika & penalaran. Berbayar per token (murah). Nama model berganti dari waktu ke waktu — pakai "Ambil daftar model".'
    },
    kimi: {
      id: 'kimi', label: 'Kimi (Moonshot AI)', kind: 'openai', group: 'resmi',
      keySetting: 'kimiApiKey', modelSetting: 'kimiModel', defaultModel: 'kimi-k2.6',
      endpoint: 'https://api.moonshot.ai/v1',
      keyUrl: 'https://platform.kimi.ai/console/api-keys',
      note: 'Konteks panjang, bagus untuk analisis data. Berbayar per token.'
    },
    siliconflow: {
      id: 'siliconflow', label: 'SiliconFlow', kind: 'openai', group: 'resmi',
      keySetting: 'siliconflowApiKey', modelSetting: 'siliconflowModel', defaultModel: '',
      endpoint: 'https://api.siliconflow.com/v1',
      keyUrl: 'https://cloud.siliconflow.com/account/ak',
      note: 'Banyak model terbuka (Qwen, DeepSeek, GLM, Kimi). Wajib memilih model — gunakan "Ambil daftar model".'
    },
    muse: {
      id: 'muse', label: 'Meta Muse (Model API)', kind: 'openai', group: 'resmi',
      keySetting: 'museApiKey', modelSetting: 'museModel', defaultModel: 'muse-spark-1.3',
      endpoint: 'https://api.meta.ai/v1',
      keyUrl: 'https://dev.meta.ai',
      note: 'Model Muse Spark dari Meta (dev.meta.ai). Kompatibel format OpenAI.'
    },
    freeaiapikey: {
      id: 'freeaiapikey', label: 'FreeAIAPIKey', kind: 'openai', group: 'gateway',
      keySetting: 'freeaiApiKey', modelSetting: 'freeaiModel', endpointSetting: 'freeaiEndpoint',
      defaultModel: '', defaultEndpoint: 'https://api.freeaiapikey.com/v1',
      keyUrl: 'https://freeaiapikey.com',
      note: 'Gateway pihak ketiga (format OpenAI). Pilih model lewat "Ambil daftar model".'
    },
    iteracompute: {
      id: 'iteracompute', label: 'IteraCompute', kind: 'openai', group: 'gateway',
      keySetting: 'iteraApiKey', modelSetting: 'iteraModel', endpointSetting: 'iteraEndpoint',
      defaultModel: '', defaultEndpoint: '',
      keyUrl: 'https://platform.iteracompute.com',
      note: 'Gateway Qwen/DeepSeek/GLM/Kimi. Salin "Base URL" dari dasbor platform.iteracompute.com (diakhiri /v1).'
    },
    pateway: {
      id: 'pateway', label: 'Pateway', kind: 'openai', group: 'gateway',
      keySetting: 'patewayApiKey', modelSetting: 'patewayModel', endpointSetting: 'patewayEndpoint',
      defaultModel: '', defaultEndpoint: 'https://api.pateway.ai/v1',
      keyUrl: 'https://pateway.ai',
      note: 'Gateway pihak ketiga (format OpenAI).'
    },
    radoxai: {
      id: 'radoxai', label: 'RadoxAI', kind: 'openai', group: 'gateway',
      keySetting: 'radoxApiKey', modelSetting: 'radoxModel', endpointSetting: 'radoxEndpoint',
      defaultModel: 'claude-opus-4.8', defaultEndpoint: 'https://radoxai.com/v1',
      keyUrl: 'https://radoxai.com',
      note: 'Gateway pihak ketiga (format OpenAI). Kunci diawali "cc_". Model apa pun dari daftar /models.'
    },
    kitsora: {
      id: 'kitsora', label: 'Kitsora', kind: 'openai', group: 'gateway',
      keySetting: 'kitsoraApiKey', modelSetting: 'kitsoraModel', endpointSetting: 'kitsoraEndpoint',
      defaultModel: 'kt/claude-fable-5.1', defaultEndpoint: 'https://kitsora.ai.id/v1',
      keyUrl: 'https://kitsora.ai.id',
      note: 'Gateway pihak ketiga (format OpenAI). Kunci diawali "sk-kt-".'
    },
    custom: {
      id: 'custom', label: 'Endpoint kompatibel OpenAI lainnya', kind: 'openai', group: 'gateway',
      keySetting: 'customAiApiKey', modelSetting: 'customAiModel', endpointSetting: 'customAiEndpoint',
      defaultModel: '', defaultEndpoint: '', keyUrl: '',
      note: 'Untuk penyedia lain berformat OpenAI (mis. NVIDIA NIM). Isi Base URL (…/v1) atau URL lengkap …/chat/completions.'
    }
  };
  const ORDER = ['gemini', 'groq', 'mistral', 'openrouter', 'deepseek', 'kimi', 'siliconflow', 'muse',
    'freeaiapikey', 'iteracompute', 'pateway', 'radoxai', 'kitsora', 'custom'];
  const MODES = ['single', 'ensemble'];
  const ENSEMBLE_MIN = 2;
  const ENSEMBLE_MAX = 5;
  /** Kunci pengaturan yang dibaca server untuk proxy AI. */
  const SETTING_KEYS = ['aiEnabled', 'aiProvider', 'aiFallback', 'aiTimeoutMs', 'aiMode', 'aiEnsembleSize'].concat(
    ...ORDER.map(id => [PROVIDERS[id].keySetting, PROVIDERS[id].modelSetting, PROVIDERS[id].endpointSetting].filter(Boolean)));
  const SECRET_KEYS = ORDER.map(id => PROVIDERS[id].keySetting);
  const MASK = '__server__';

  const str = (v) => String(v == null ? '' : v).trim();

  /** Nama model Gemini boleh ditulis "models/gemini-…" (format daftar model Google). */
  function cleanModel(p, m) {
    let v = str(m);
    if (p.kind === 'gemini') v = v.replace(/^models\//i, '');
    return v;
  }
  function isValidModel(p, m) {
    const v = cleanModel(p, m);
    if (!v) return false;
    return p.kind === 'gemini' ? /^[A-Za-z0-9._-]{1,80}$/.test(v) : /^[A-Za-z0-9._:/@+-]{1,120}$/.test(v);
  }
  function modelOf(p, settings) {
    const v = cleanModel(p, settings && settings[p.modelSetting]);
    return isValidModel(p, v) ? v : p.defaultModel;
  }
  /** Endpoint wajib https dan bukan alamat jaringan internal (mencegah SSRF). */
  function safeEndpoint(url) {
    const u = str(url);
    if (!/^https:\/\//i.test(u) || u.length > 300) return '';
    let host = '';
    try { host = new URL(u).hostname.toLowerCase(); } catch (e) { return ''; }
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '[::1]' || host === '::1') return '';
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return '';
    if (/^\[?(fc|fd|fe80)/i.test(host)) return '';
    return u;
  }
  /** Base URL (…/v1) atau URL lengkap → URL …/chat/completions. */
  function chatUrl(base) {
    const b = str(base).replace(/\/+$/, '');
    if (!b) return '';
    return /\/chat\/completions$/i.test(b) ? b : b + '/chat/completions';
  }
  /** URL daftar model untuk endpoint berformat OpenAI. */
  function modelsUrl(chat) {
    const c = str(chat);
    return c ? c.replace(/\/chat\/completions$/i, '') + '/models' : '';
  }
  function endpointOf(p, settings) {
    if (p.kind === 'gemini') return p.endpoint;
    if (p.endpointSetting) return chatUrl(safeEndpoint(str(settings && settings[p.endpointSetting]) || p.defaultEndpoint || ''));
    return chatUrl(p.endpoint);
  }
  function hasKey(p, settings) {
    const k = str(settings && settings[p.keySetting]);
    return !!k;
  }
  /** Penyedia lengkap (kunci + model + endpoint) dan siap dipanggil. */
  function configured(p, settings) {
    return hasKey(p, settings) && !!modelOf(p, settings) && !!endpointOf(p, settings);
  }
  function primaryId(settings) {
    const v = str(settings && settings.aiProvider);
    return PROVIDERS[v] ? v : 'gemini';
  }
  function modeOf(settings) { return settings && settings.aiMode === 'ensemble' ? 'ensemble' : 'single'; }
  function ensembleSize(settings) {
    const n = Math.round(Number(settings && settings.aiEnsembleSize) || 3);
    return Math.max(ENSEMBLE_MIN, Math.min(ENSEMBLE_MAX, n));
  }

  /**
   * Urutan penyedia yang dicoba: penyedia utama lalu penyedia lain yang
   * kuncinya sudah diisi (bila cadangan aktif, atau bila mode gabungan).
   * @param {object} settings
   * @param {object} [opts] { only: id, key: kunci uji, model: model uji, endpoint, all: abaikan aiFallback }
   */
  function chain(settings, opts) {
    const o = opts || {};
    const s = settings || {};
    if (o.only && PROVIDERS[o.only]) {
      const p = PROVIDERS[o.only];
      const key = str(o.key) && str(o.key) !== MASK ? str(o.key) : str(s[p.keySetting]);
      const model = isValidModel(p, o.model) ? cleanModel(p, o.model) : modelOf(p, s);
      let endpoint;
      if (p.kind === 'gemini') endpoint = p.endpoint;
      else if (p.endpointSetting) endpoint = chatUrl(safeEndpoint(str(o.endpoint) || str(s[p.endpointSetting]) || p.defaultEndpoint || ''));
      else endpoint = chatUrl(p.endpoint);
      return key && key !== MASK && model && endpoint ? [{ id: p.id, label: p.label, kind: p.kind, key, model, endpoint }] : [];
    }
    const first = primaryId(s);
    const others = (s.aiFallback === false && !o.all) ? [] : ORDER.filter(id => id !== first);
    return [first].concat(others).map(id => PROVIDERS[id]).filter(p => configured(p, s))
      .map(p => ({ id: p.id, label: p.label, kind: p.kind, key: str(s[p.keySetting]), model: modelOf(p, s), endpoint: endpointOf(p, s) }));
  }

  /* ---------------- Terjemahan permintaan ---------------- */
  const textOf = (parts) => (Array.isArray(parts) ? parts : [])
    .map(x => (x && typeof x.text === 'string' && !x.thought) ? x.text : '').join('');
  /** Model yang memakai token untuk "berpikir" — beri ruang token tambahan. */
  const isReasoningModel = (model) => /gpt-oss|reason|think|magistral|deepseek|r1\b|qwen3|qwq|kimi|k2|glm|muse|minimax|claude|\bo[1-9]\b/i.test(String(model || ''));
  /** Gemini 2.5 / 3.x / alias "latest" adalah model berpikir. */
  const isThinkingGemini = (model) => /gemini-(2\.5|[3-9])|latest/i.test(String(model || ''));

  function geminiBody(c, payload, plain) {
    const body = JSON.parse(JSON.stringify(payload || {}));
    const gc = body.generationConfig = Object.assign({}, body.generationConfig || {});
    if (isThinkingGemini(c.model)) {
      const base = Number(gc.maxOutputTokens) || 2048;
      if (!plain) {
        // Batasi "berpikir" agar token jawaban tidak habis (penyebab jawaban kosong/terpotong).
        gc.thinkingConfig = /2\.5/.test(c.model) ? { thinkingBudget: /pro/i.test(c.model) ? 128 : 0 } : { thinkingLevel: 'low' };
        gc.maxOutputTokens = Math.min(65536, base + 1024);
      } else {
        delete gc.thinkingConfig;
        gc.maxOutputTokens = Math.min(65536, base + 4096);
      }
    }
    return body;
  }

  /** Bangun permintaan HTTP untuk satu penyedia. `payload` berformat Gemini. */
  function buildRequest(c, payload, opts) {
    const o = opts || {};
    if (c.kind === 'gemini') {
      return {
        url: c.endpoint + encodeURIComponent(c.model) + ':generateContent',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': c.key },
        body: geminiBody(c, payload, !!o.plain)
      };
    }
    const gc = (payload && payload.generationConfig) || {};
    const messages = [];
    const sys = payload && payload.systemInstruction ? textOf(payload.systemInstruction.parts) : '';
    if (sys) messages.push({ role: 'system', content: sys });
    ((payload && payload.contents) || []).forEach(t => {
      const content = textOf(t && t.parts);
      if (!content) return;
      messages.push({ role: t.role === 'model' ? 'assistant' : 'user', content });
    });
    const maxOut = Math.max(64, Math.min(16000, Number(gc.maxOutputTokens) || 2048));
    const reasoning = isReasoningModel(c.model);
    const body = {
      model: c.model,
      messages,
      temperature: gc.temperature == null ? 0.7 : Math.max(0, Math.min(1.5, Number(gc.temperature) || 0)),
      max_tokens: reasoning ? maxOut + 1024 : maxOut
    };
    if (gc.responseMimeType === 'application/json' && !o.noJson) body.response_format = { type: 'json_object' };
    if (c.id === 'groq' && /gpt-oss/i.test(c.model) && !o.plain) { body.reasoning_effort = 'low'; body.include_reasoning = false; }
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key };
    if (c.id === 'openrouter') {
      headers['HTTP-Referer'] = o.referer || 'https://lms-rubela.vercel.app';
      headers['X-Title'] = 'LMS Rubela';
    }
    return { url: c.endpoint, headers, body };
  }

  function errMessage(data, status) {
    if (data && data.error) {
      if (typeof data.error === 'string') return data.error;
      return data.error.message || JSON.stringify(data.error).slice(0, 300);
    }
    if (data && typeof data.message === 'string') return data.message;
    if (data && typeof data.detail === 'string') return data.detail;
    return 'HTTP ' + status;
  }

  /**
   * Ubah jawaban penyedia ke bentuk Gemini.
   * @returns {{ ok:boolean, status:number, data:object, retryPlain?:boolean }}
   */
  function normalizeResponse(c, status, data) {
    const ok = status >= 200 && status < 300;
    if (c.kind === 'gemini') {
      if (!ok) {
        const msg = errMessage(data, status);
        const gstatus = data && data.error && data.error.status ? String(data.error.status) : '';
        // Model lama tidak mengenal thinkingConfig → ulangi tanpa parameter itu.
        const retryPlain = status === 400 && /thinking/i.test(msg);
        return { ok: false, status, data: { error: { message: String(msg).slice(0, 500), status: gstatus, provider: c.id } }, retryPlain };
      }
      const out = Object.assign({}, data || {});
      if (Array.isArray(out.candidates)) {
        // Buang bagian "pikiran" (thought) agar hanya jawaban yang dipakai.
        out.candidates = out.candidates.map(cd => {
          if (!cd || !cd.content) return cd;
          const parts = (cd.content.parts || []).filter(p => p && !p.thought && typeof p.text === 'string');
          return Object.assign({}, cd, { content: Object.assign({}, cd.content, { parts }) });
        });
      }
      out.provider = c.id; out.model = c.model;
      return { ok: true, status, data: out };
    }
    if (!ok) {
      const msg = errMessage(data, status);
      // 400 karena response_format / parameter penalaran tidak didukung → coba ulang tanpa keduanya.
      const retryPlain = status === 400 && /response_format|json|reasoning|include_reasoning|unsupported|not supported/i.test(String(msg));
      return { ok: false, status, data: { error: { message: String(msg).slice(0, 500), provider: c.id } }, retryPlain };
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const m = choice && choice.message;
    let text = '';
    if (m) {
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) text = m.content.map(x => (x && x.type !== 'thinking' && typeof x.text === 'string') ? x.text : '').join('');
    }
    // Beberapa model membungkus penalaran dengan <think>…</think> di dalam jawaban.
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const finish = choice && choice.finish_reason;
    return {
      ok: true, status: 200,
      data: { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: finish === 'length' ? 'MAX_TOKENS' : (finish === 'content_filter' ? 'SAFETY' : 'STOP') }],
        usageMetadata: data && data.usage ? { promptTokenCount: data.usage.prompt_tokens, candidatesTokenCount: data.usage.completion_tokens } : undefined,
        provider: c.id, model: (data && data.model) || c.model }
    };
  }

  /** Teks jawaban dari hasil normalizeResponse ('' bila tidak ada). */
  function answerText(r) {
    if (!r || !r.ok || !r.data) return '';
    const cand = r.data.candidates && r.data.candidates[0];
    return cand && cand.content ? textOf(cand.content.parts).trim() : '';
  }

  /** Apakah kegagalan ini layak dialihkan ke penyedia cadangan. */
  function shouldFallback(r) {
    if (!r) return true;
    if (r.code === 'timeout' || r.code === 'network') return true;
    if (r.ok) return !answerText(r);                  // jawaban kosong → coba penyedia lain
    return true;                                      // kunci salah, kuota habis, server bermasalah, dsb.
  }

  /* ---------------- Daftar model ---------------- */
  function listModelsRequest(c) {
    if (c.kind === 'gemini') {
      return { url: c.endpoint.replace(/\/+$/, '') + '?pageSize=1000', headers: { 'X-goog-api-key': c.key } };
    }
    return { url: modelsUrl(c.endpoint), headers: { Authorization: 'Bearer ' + c.key } };
  }
  function parseModels(c, data) {
    let ids = [];
    if (c.kind === 'gemini') {
      ids = ((data && data.models) || [])
        .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.indexOf('generateContent') >= 0)
        .map(m => String(m.name || '').replace(/^models\//, ''));
    } else {
      const list = (data && (data.data || data.models)) || (Array.isArray(data) ? data : []);
      ids = (Array.isArray(list) ? list : []).map(m => typeof m === 'string' ? m : (m && (m.id || m.name)) || '');
    }
    return [...new Set(ids.map(str).filter(Boolean))].sort().slice(0, 500);
  }

  /* ---------------- Orkestrator ---------------- */
  const JUDGE_RULES = [
    'TUGAS KHUSUS: Kamu adalah penilai sekaligus penyusun jawaban akhir.',
    'Beberapa asisten AI telah menjawab permintaan pengguna yang sama (lihat "JAWABAN KANDIDAT").',
    'Periksa kebenaran setiap kandidat: fakta, hitungan, logika, dan kesesuaian dengan data yang diberikan.',
    'Untuk soal hitungan atau logika, kerjakan ulang sendiri sebelum memutuskan.',
    'Gabungkan bagian yang benar dan paling jelas, buang bagian yang salah, mengarang, atau tidak didukung data.',
    'Bila kandidat saling bertentangan, pilih yang dapat dibuktikan; bila tidak dapat dipastikan, katakan dengan jujur.',
    'Jangan menyebut adanya beberapa asisten, kandidat, atau penilaian. Tulis langsung SATU jawaban final yang lengkap,',
    'dengan bahasa, gaya, dan format yang diminta pengguna serta mematuhi seluruh instruksi sistem di atas.'
  ].join(' ');

  function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  /** Susun permintaan untuk penyedia juri dari percakapan asli + jawaban kandidat. */
  function judgePayload(payload, answers) {
    const contents = (payload && payload.contents) || [];
    const sys = payload && payload.systemInstruction ? textOf(payload.systemInstruction.parts) : '';
    const recent = contents.slice(-8).map(t => (t.role === 'model' ? 'ASISTEN: ' : 'PENGGUNA: ') + clip(textOf(t.parts), 3000)).join('\n\n');
    const cands = answers.map((a, i) => `--- Kandidat ${i + 1} ---\n${clip(a, 7000)}`).join('\n\n');
    const gc = Object.assign({}, (payload && payload.generationConfig) || {});
    delete gc.responseMimeType;
    gc.temperature = Math.min(0.4, gc.temperature == null ? 0.4 : Number(gc.temperature) || 0);
    return {
      contents: [{ role: 'user', parts: [{ text: `PERCAKAPAN (permintaan terakhir pengguna paling bawah):\n${recent}\n\nJAWABAN KANDIDAT:\n${cands}\n\nTulis jawaban final terbaik untuk permintaan terakhir pengguna.` }] }],
      systemInstruction: { parts: [{ text: (sys ? sys + '\n\n' : '') + JUDGE_RULES }] },
      generationConfig: gc
    };
  }

  /**
   * Jalankan permintaan sesuai mode.
   * @param {Array} list    hasil chain()
   * @param {object} payload format Gemini
   * @param {object} o { call(c,payload,timeoutMs,plain) → Promise<r>, mode, size, deadlineMs, perCallMs }
   * @returns {Promise<{ r, c, tried:string[], ensemble?:{members:string[], answered:string[], judge:string} }>}
   */
  async function run(list, payload, o) {
    const start = Date.now();
    const deadline = Math.max(10000, Number(o.deadlineMs) || 55000);
    const perCall = Math.max(5000, Number(o.perCallMs) || 30000);
    const left = () => deadline - (Date.now() - start);
    const tried = [];
    const callOne = async (c, timeout, body) => {
      const p = body || payload;
      let r = await o.call(c, p, timeout, false);
      if (!r.ok && r.retryPlain && left() > 4000) r = await o.call(c, p, Math.min(timeout, Math.max(4000, left() - 500)), true);
      return r;
    };
    const runSingle = async (cands) => {
      let last = null;
      for (const c of cands) {
        if (tried.length && left() < 6000) break;         // sisakan waktu agar fungsi server tidak terputus
        const r = await callOne(c, Math.min(perCall, left()));
        tried.push(c.id);
        if (r.ok && !shouldFallback(r)) return { r, c, tried };
        last = { r, c };
      }
      return last ? { r: last.r, c: last.c, tried } : { r: null, c: null, tried };
    };

    const json = payload && payload.generationConfig && payload.generationConfig.responseMimeType === 'application/json';
    const size = Math.max(ENSEMBLE_MIN, Math.min(ENSEMBLE_MAX, Number(o.size) || 3));
    if (o.mode !== 'ensemble' || json || list.length < 2) return runSingle(list);

    // Mode gabungan: anggota menjawab bersamaan, lalu juri menyusun jawaban final.
    const members = list.slice(0, size);
    const memberTimeout = Math.max(8000, Math.min(perCall, Math.round(deadline * 0.5)));
    const results = await Promise.all(members.map(c => callOne(c, memberTimeout).catch(() => ({ ok: false, code: 'network', error: 'gagal' }))));
    members.forEach(c => tried.push(c.id));
    const good = [];
    results.forEach((r, i) => { const t = answerText(r); if (r && r.ok && t) good.push({ c: members[i], r, text: t }); });
    const info = { members: members.map(c => c.id), answered: good.map(g => g.c.id), judge: '' };
    if (!good.length) {
      // Semua anggota gagal → lanjutkan ke penyedia cadangan berikutnya (bila ada).
      const rest = await runSingle(list.slice(members.length));
      if (rest.r) return Object.assign(rest, { ensemble: info });
      const i = results.length - 1;
      return { r: results[i], c: members[i], tried, ensemble: info };
    }
    if (good.length === 1) return { r: good[0].r, c: good[0].c, tried, ensemble: info };
    const jp = judgePayload(payload, good.map(g => g.text));
    for (const g of good) {
      const t = left() - 1500;
      if (t < 6000) break;
      const jr = await callOne(g.c, Math.min(perCall, t), jp);
      tried.push(g.c.id + ':juri');
      if (jr.ok && answerText(jr)) {
        info.judge = g.c.id;
        return { r: jr, c: g.c, tried, ensemble: info };
      }
    }
    // Juri gagal / waktu habis → pakai jawaban penyedia dengan prioritas tertinggi.
    return { r: good[0].r, c: good[0].c, tried, ensemble: info };
  }

  return {
    PROVIDERS, ORDER, MODES, SETTING_KEYS, SECRET_KEYS, MASK, ENSEMBLE_MIN, ENSEMBLE_MAX,
    modelOf, cleanModel, endpointOf, safeEndpoint, chatUrl, modelsUrl, configured, hasKey, primaryId,
    modeOf, ensembleSize, chain,
    buildRequest, normalizeResponse, shouldFallback, isValidModel, answerText,
    listModelsRequest, parseModels, judgePayload, run, isThinkingGemini
  };
});
