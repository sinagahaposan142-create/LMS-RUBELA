/* =====================================================================
 * js/ai-providers.js — daftar penyedia AI & penerjemah format permintaan
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh browser (js/ai.js, mode lokal) dan server
 * (api/_lib/handlers.js → aiProxy) agar perilaku kedua mode identik.
 *
 * Seluruh fitur AI di LMS menyusun permintaan dalam format Gemini
 * ({ contents, systemInstruction, generationConfig }). Untuk penyedia
 * berformat OpenAI (Groq, Mistral, OpenRouter, endpoint kompatibel
 * lainnya) permintaan diterjemahkan ke /chat/completions, lalu
 * jawabannya dikembalikan ke bentuk Gemini (candidates[0].content.parts)
 * sehingga kode pemanggil tidak perlu berubah.
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

  const PROVIDERS = {
    gemini: {
      id: 'gemini', label: 'Google Gemini', kind: 'gemini',
      keySetting: 'geminiApiKey', modelSetting: 'geminiModel', defaultModel: 'gemini-flash-latest',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
      keyUrl: 'https://aistudio.google.com/app/apikey',
      note: 'Gratis dengan kuota harian; ketersediaan kunci bergantung pada akun/negara.'
    },
    groq: {
      id: 'groq', label: 'Groq', kind: 'openai',
      keySetting: 'groqApiKey', modelSetting: 'groqModel', defaultModel: 'openai/gpt-oss-120b',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      keyUrl: 'https://console.groq.com/keys',
      note: 'Paling cepat. Gratis tanpa kartu kredit; gpt-oss-120b ±1.000 permintaan & 200 ribu token per hari.'
    },
    mistral: {
      id: 'mistral', label: 'Mistral AI', kind: 'openai',
      keySetting: 'mistralApiKey', modelSetting: 'mistralModel', defaultModel: 'mistral-small-latest',
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      keyUrl: 'https://console.mistral.ai/api-keys',
      note: 'Kuota token gratis terbesar (±1 miliar token/bulan pada mode gratis).'
    },
    openrouter: {
      id: 'openrouter', label: 'OpenRouter', kind: 'openai',
      keySetting: 'openrouterApiKey', modelSetting: 'openrouterModel', defaultModel: 'openrouter/free',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      keyUrl: 'https://openrouter.ai/settings/keys',
      note: 'Cadangan: model gratis dipilih otomatis; 50 permintaan/hari (1.000/hari setelah pernah membeli kredit ≥ $10).'
    },
    custom: {
      id: 'custom', label: 'Endpoint kompatibel OpenAI', kind: 'openai',
      keySetting: 'customAiApiKey', modelSetting: 'customAiModel', endpointSetting: 'customAiEndpoint', defaultModel: '',
      endpoint: '', keyUrl: '',
      note: 'Untuk penyedia lain berformat OpenAI (mis. NVIDIA NIM). Isi URL lengkap …/v1/chat/completions.'
    }
  };
  const ORDER = ['gemini', 'groq', 'mistral', 'openrouter', 'custom'];
  /** Kunci pengaturan yang dibaca server untuk proxy AI. */
  const SETTING_KEYS = ['aiEnabled', 'aiProvider', 'aiFallback', 'aiTimeoutMs'].concat(
    ...ORDER.map(id => [PROVIDERS[id].keySetting, PROVIDERS[id].modelSetting, PROVIDERS[id].endpointSetting].filter(Boolean)));
  const SECRET_KEYS = ORDER.map(id => PROVIDERS[id].keySetting);
  const MASK = '__server__';

  const str = (v) => String(v == null ? '' : v).trim();
  function isValidModel(p, m) {
    const v = str(m);
    if (!v) return false;
    return p.kind === 'gemini' ? /^[A-Za-z0-9._-]{1,80}$/.test(v) : /^[A-Za-z0-9._:/@-]{1,120}$/.test(v);
  }
  function modelOf(p, settings) {
    const v = str(settings && settings[p.modelSetting]);
    return isValidModel(p, v) ? v : p.defaultModel;
  }
  /** Endpoint kustom wajib https dan bukan alamat jaringan internal (mencegah SSRF). */
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
  function endpointOf(p, settings) {
    if (p.endpointSetting) return safeEndpoint(settings && settings[p.endpointSetting]);
    return p.endpoint;
  }
  function hasKey(p, settings) { return !!str(settings && settings[p.keySetting]); }
  /** Penyedia lengkap (kunci + model + endpoint) dan siap dipanggil. */
  function configured(p, settings) {
    return hasKey(p, settings) && !!modelOf(p, settings) && !!endpointOf(p, settings);
  }
  function primaryId(settings) {
    const v = str(settings && settings.aiProvider);
    return PROVIDERS[v] ? v : 'gemini';
  }

  /**
   * Urutan penyedia yang dicoba: penyedia utama lalu (bila cadangan aktif)
   * penyedia lain yang kuncinya sudah diisi.
   * @param {object} settings
   * @param {object} [opts] { only: id, key: kunci uji, model: model uji }
   */
  function chain(settings, opts) {
    const o = opts || {};
    const s = settings || {};
    if (o.only && PROVIDERS[o.only]) {
      const p = PROVIDERS[o.only];
      const key = str(o.key) && str(o.key) !== MASK ? str(o.key) : str(s[p.keySetting]);
      const model = isValidModel(p, o.model) ? str(o.model) : modelOf(p, s);
      const endpoint = p.endpointSetting ? safeEndpoint(o.endpoint || s[p.endpointSetting]) : p.endpoint;
      return key && model && endpoint ? [{ id: p.id, label: p.label, kind: p.kind, key, model, endpoint }] : [];
    }
    const first = primaryId(s);
    const ids = [first].concat(s.aiFallback === false ? [] : ORDER.filter(id => id !== first));
    return ids.map(id => PROVIDERS[id]).filter(p => configured(p, s))
      .map(p => ({ id: p.id, label: p.label, kind: p.kind, key: str(s[p.keySetting]), model: modelOf(p, s), endpoint: endpointOf(p, s) }));
  }

  /* ---------------- Terjemahan permintaan ---------------- */
  const textOf = (parts) => (Array.isArray(parts) ? parts : []).map(x => (x && typeof x.text === 'string') ? x.text : '').join('');
  const isReasoningModel = (model) => /gpt-oss|reason|think|magistral|deepseek-r1|qwen3/i.test(String(model || ''));

  /** Bangun permintaan HTTP untuk satu penyedia. `payload` berformat Gemini. */
  function buildRequest(c, payload, opts) {
    const o = opts || {};
    if (c.kind === 'gemini') {
      return {
        url: c.endpoint + encodeURIComponent(c.model) + ':generateContent',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': c.key },
        body: payload
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
      // Model penalaran memakai sebagian token untuk "berpikir" — beri ruang tambahan.
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

  /**
   * Ubah jawaban penyedia ke bentuk Gemini.
   * @returns {{ ok:boolean, status:number, data:object, retryPlain?:boolean }}
   */
  function normalizeResponse(c, status, data) {
    if (c.kind === 'gemini') return { ok: status >= 200 && status < 300, status, data };
    const ok = status >= 200 && status < 300;
    if (!ok) {
      const msg = data && data.error ? (typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error).slice(0, 300)))
        : (data && data.message) || ('HTTP ' + status);
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
    const finish = choice && choice.finish_reason;
    return {
      ok: true, status: 200,
      data: { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: finish === 'length' ? 'MAX_TOKENS' : 'STOP' }],
        usageMetadata: data && data.usage ? { promptTokenCount: data.usage.prompt_tokens, candidatesTokenCount: data.usage.completion_tokens } : undefined,
        provider: c.id, model: (data && data.model) || c.model }
    };
  }

  /** Apakah kegagalan ini layak dialihkan ke penyedia cadangan. */
  function shouldFallback(r) {
    if (!r) return true;
    if (r.code === 'timeout' || r.code === 'network') return true;
    if (r.ok) {
      const cand = r.data && r.data.candidates && r.data.candidates[0];
      const text = cand && cand.content ? textOf(cand.content.parts).trim() : '';
      return !text;                                  // jawaban kosong → coba penyedia lain
    }
    return true;                                     // kunci salah, kuota habis, server bermasalah, dsb.
  }

  return {
    PROVIDERS, ORDER, SETTING_KEYS, SECRET_KEYS, MASK,
    modelOf, endpointOf, safeEndpoint, configured, hasKey, primaryId, chain,
    buildRequest, normalizeResponse, shouldFallback, isValidModel
  };
});
