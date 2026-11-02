/* =====================================================================
 * js/sync.js — sinkronisasi data LMS Rubela lintas perangkat
 * ---------------------------------------------------------------------
 * Mode "server" (default di hosting Vercel):
 *  - Kunci data bisnis (lihat js/sync-catalog.js) tidak lagi disimpan di
 *    localStorage, melainkan di memori + IndexedDB, lalu disinkronkan ke
 *    /api/rubela (database Turso). Kode aplikasi tetap memakai
 *    localStorage.getItem/setItem seperti biasa — modul ini menyadapnya.
 *  - Perubahan lokal dikirim per record (bukan seluruh array) sehingga
 *    beberapa pengguna dapat bekerja bersamaan tanpa saling menimpa.
 *  - Perubahan dari perangkat lain ditarik berkala; sinyal Supabase
 *    Realtime (Broadcast) mempercepatnya. Tanpa sinyal pun tetap jalan.
 * Mode "local": perilaku lama (data hanya di browser ini). Dipakai bila
 * server belum dikonfigurasi atau halaman dibuka dari file://.
 * ===================================================================*/
(function (global) {
  'use strict';

  const CFG = Object.assign({ api: '/api/rubela', realtime: true, realtimeTopic: 'lms-rubela-sync-v1' }, global.LMS_SYNC_CONFIG || {});
  const CAT = global.LMSSyncCatalog;
  const LS = global.localStorage;
  const proto = global.Storage && Storage.prototype;
  const noop = function () { return null; };
  const rawGet = proto ? proto.getItem : noop, rawSet = proto ? proto.setItem : noop, rawRemove = proto ? proto.removeItem : noop;
  const script = document.currentScript;
  const PAGE = (script && script.dataset && script.dataset.page) || (/dashboard\.html$/.test(location.pathname) ? 'dashboard' : 'login');
  const MODE_KEY = 'lms_sync_mode';
  const SESSION_KEY = 'lms_session';
  const FORMAT = 1;
  const IDB_NAME = 'lms_rubela_sync';
  const CHUNK_BYTES = 1400000;
  const PUSH_DEBOUNCE = 450;

  const rget = (k) => { try { return rawGet.call(LS, k); } catch (e) { return null; } };
  const rset = (k, v) => { try { rawSet.call(LS, k, v); return true; } catch (e) { return false; } };
  const rdel = (k) => { try { rawRemove.call(LS, k); } catch (e) { /* noop */ } };
  const canon = CAT ? CAT.canon : (v) => JSON.stringify(v);
  const parseJson = (s, d) => { if (s == null) return d; try { return JSON.parse(s); } catch (e) { return d; } };
  const now = () => Date.now();

  /* ------------------------------------------------------------------
   * Mode
   * ----------------------------------------------------------------*/
  const isFile = location.protocol === 'file:';
  let mode = isFile || !CAT || !proto ? 'local' : (rget(MODE_KEY) === 'local' ? 'local' : 'server');
  const isServer = () => mode === 'server';

  function setMode(next, reload) {
    if (next === mode) return;
    rset(MODE_KEY, next);
    if (reload) location.reload();
  }

  /* ------------------------------------------------------------------
   * Penyimpanan virtual (hanya mode server)
   * ----------------------------------------------------------------*/
  const mem = new Map();            // kunci → string JSON (nilai lokal saat ini)
  const base = new Map();           // kunci → Map(id → { s, ver, seq })  (keadaan server terakhir)
  const pending = new Map();        // kunci → Map(id → op)  (perubahan lokal belum terkirim)
  const dirty = new Set();          // kunci yang perlu dihitung ulang selisihnya
  let ready = false;

  if (isServer()) {
    proto.getItem = function (k) {
      if (this === LS && CAT.has(k)) { const v = mem.get(k); return v === undefined ? CAT.emptyString(k) : v; }
      return rawGet.call(this, k);
    };
    proto.setItem = function (k, v) {
      if (this === LS && CAT.has(k)) { localWrite(k, String(v)); return; }
      return rawSet.call(this, k, v);
    };
    proto.removeItem = function (k) {
      if (this === LS && CAT.has(k)) { console.warn('[sync] removeItem diabaikan untuk data server:', k); return; }
      return rawRemove.call(this, k);
    };
  }

  function localWrite(k, s) {
    if (mem.get(k) === s) return;
    mem.set(k, s);
    if (!ready) return;              // ditulis sebelum boot selesai (tidak terjadi pada alur normal)
    dirty.add(k);
    schedulePush();
  }

  /* ------------------------------------------------------------------
   * Sesi
   * ----------------------------------------------------------------*/
  function readSession() { return parseJson(rget(SESSION_KEY), null); }
  function token() { const s = readSession(); return s && s.token ? s.token : ''; }

  /* ------------------------------------------------------------------
   * Status & event
   * ----------------------------------------------------------------*/
  const status = { online: navigator.onLine !== false, lastSync: 0, error: '', realtime: false, pending: 0, syncing: false };
  const statusListeners = [];
  function setStatus(patch) {
    Object.assign(status, patch);
    status.pending = countPending();
    statusListeners.slice().forEach(fn => { try { fn(Object.assign({}, status)); } catch (e) { console.error(e); } });
  }
  /** Jumlah perubahan lokal yang belum dikonfirmasi server (kunci yang belum dihitung dihitung 1). */
  function countPending() { let n = dirty.size; pending.forEach(m => { n += m.size; }); return n; }

  function emitRemote(keys) {
    if (!keys.size) return;
    keys.forEach(k => {
      try {
        global.dispatchEvent(new StorageEvent('storage', { key: k, newValue: mem.get(k) || null, oldValue: null, storageArea: LS, url: location.href }));
      } catch (e) { /* browser lama */ }
    });
    try { global.dispatchEvent(new CustomEvent('lms:remote-change', { detail: { keys: [...keys] } })); } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------------
   * Utilitas record
   * ----------------------------------------------------------------*/
  function baseOf(k) { if (!base.has(k)) base.set(k, new Map()); return base.get(k); }
  function pendingOf(k) { if (!pending.has(k)) pending.set(k, new Map()); return pending.get(k); }

  /** Nilai lokal sebuah kunci dalam bentuk terstruktur. */
  function readLocal(k) {
    const meta = CAT.info(k);
    const s = mem.has(k) ? mem.get(k) : CAT.emptyString(k);
    if (meta.type === CAT.RECORDS) { const v = parseJson(s, []); return Array.isArray(v) ? v : []; }
    if (meta.type === CAT.MAP) { const v = parseJson(s, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
    return s == null ? undefined : parseJson(s, undefined);
  }
  function writeLocal(k, value) {
    if (value === undefined) mem.delete(k);
    else mem.set(k, JSON.stringify(value));
  }

  /** Ambil satu entri lokal (record / properti / dokumen). undefined = tidak ada. */
  function entryOf(k, local, id) {
    const meta = CAT.info(k);
    if (meta.type === CAT.RECORDS) return local.find(r => CAT.idOf(k, r) === id);
    if (meta.type === CAT.MAP) return Object.prototype.hasOwnProperty.call(local, id) ? local[id] : undefined;
    return local;
  }
  /** Set/hapus satu entri pada struktur lokal (mengembalikan struktur baru untuk doc). */
  function setEntry(k, local, id, value, seq) {
    const meta = CAT.info(k);
    if (meta.type === CAT.RECORDS) {
      const i = local.findIndex(r => CAT.idOf(k, r) === id);
      if (value === undefined || value === null) { if (i >= 0) local.splice(i, 1); return local; }
      if (i >= 0) local[i] = value;
      else insertBySeq(k, local, value, seq);
      return local;
    }
    if (meta.type === CAT.MAP) {
      if (value === undefined || value === null) delete local[id]; else local[id] = value;
      return local;
    }
    return value === null ? undefined : value;
  }
  /** Sisipkan record baru dari server sesuai urutan pembuatan (seq). */
  function insertBySeq(k, list, value, seq) {
    if (seq) {
      const b = baseOf(k);
      const id = CAT.idOf(k, value);
      for (let i = 0; i < list.length; i++) {
        const oid = CAT.idOf(k, list[i]);
        const e = oid && oid !== id ? b.get(oid) : null;
        if (e && e.seq > seq) { list.splice(i, 0, value); return; }
      }
    }
    list.push(value);
  }

  function fieldDiff(before, after) {
    const set = {};
    const unset = [];
    Object.keys(after).forEach(f => { if (!Object.prototype.hasOwnProperty.call(before, f) || canon(before[f]) !== canon(after[f])) set[f] = after[f]; });
    Object.keys(before).forEach(f => { if (!Object.prototype.hasOwnProperty.call(after, f)) unset.push(f); });
    return { set, unset };
  }
  function applyPatch(obj, set, unset) {
    const out = Object.assign({}, obj, set || {});
    (unset || []).forEach(f => { delete out[f]; });
    return out;
  }

  /* ------------------------------------------------------------------
   * Hitung perubahan lokal → pending
   * ----------------------------------------------------------------*/
  function diffKey(k) {
    const meta = CAT.info(k);
    const b = baseOf(k);
    const ops = new Map();
    const local = readLocal(k);
    if (meta.type === CAT.RECORDS) {
      const seen = new Set();
      local.forEach(rec => {
        const id = CAT.idOf(k, rec);
        if (!id || seen.has(id)) return;
        seen.add(id);
        const c = canon(rec);
        const be = b.get(id);
        if (!be) ops.set(id, { k, id, op: 'put', v: rec, c });
        else if (be.s !== c) {
          const d = fieldDiff(parseJson(be.s, {}), rec);
          ops.set(id, { k, id, op: 'patch', set: d.set, unset: d.unset, c });
        }
      });
      b.forEach((be, id) => { if (!seen.has(id)) ops.set(id, { k, id, op: 'del', c: null }); });
    } else if (meta.type === CAT.MAP) {
      Object.keys(local).forEach(id => {
        const c = canon(local[id]);
        const be = b.get(id);
        if (!be || be.s !== c) ops.set(id, { k, id, op: 'put', v: local[id], c });
      });
      b.forEach((be, id) => { if (!Object.prototype.hasOwnProperty.call(local, id)) ops.set(id, { k, id, op: 'del', c: null }); });
    } else {
      const be = b.get('*');
      if (local === undefined) { if (be) ops.set('*', { k, id: '*', op: 'del', c: null }); }
      else { const c = canon(local); if (!be || be.s !== c) ops.set('*', { k, id: '*', op: 'put', v: local, c }); }
    }
    if (ops.size) pending.set(k, ops); else pending.delete(k);
  }
  function flushDiff() {
    if (!dirty.size) return;
    const keys = [...dirty];
    dirty.clear();
    keys.forEach(diffKey);
    persistPending();
    setStatus({});
  }

  /* ------------------------------------------------------------------
   * Terapkan data server ke lokal
   * ----------------------------------------------------------------*/
  /**
   * items: [{ k, id, v, ver, seq, own?: op }] — v null = dihapus.
   * Mengembalikan Set kunci yang berubah secara lokal.
   */
  function applyServer(items, opts) {
    const o = opts || {};
    const byKey = new Map();
    items.forEach(it => { if (CAT.has(it.k)) { if (!byKey.has(it.k)) byKey.set(it.k, []); byKey.get(it.k).push(it); } });
    const changed = new Set();
    byKey.forEach((list, k) => {
      const meta = CAT.info(k);
      const b = baseOf(k);
      let local = readLocal(k);
      const before = mem.get(k);
      list.forEach(it => {
        const be = b.get(it.id);
        if (!o.force && be && it.ver && be.ver > it.ver) return;     // sudah punya versi lebih baru
        const oldS = be ? be.s : null;
        const newS = it.v == null ? null : canon(it.v);
        if (it.v == null) b.delete(it.id);
        else b.set(it.id, { s: newS, ver: it.ver || (be && be.ver) || 0, seq: it.seq || (be && be.seq) || 0 });
        markPersist(k, it.id);
        const cur = entryOf(k, local, it.id);
        const curS = cur === undefined ? null : canon(cur);
        let next;
        if (it.own) {
          // Jawaban atas perubahan kita sendiri: pakai versi server bila belum diubah lagi.
          if (curS === it.own.c) next = it.v;
          else if (meta.type === CAT.RECORDS && cur && it.v && it.own.c) {
            const sent = it.own.op === 'put' ? it.own.v : null;
            next = sent ? applyPatch(it.v, fieldDiff(sent, cur).set, fieldDiff(sent, cur).unset) : cur;
          } else return;                                              // dihapus/diubah lagi: tunggu push berikut
        } else if (curS === oldS) next = it.v;                         // tidak ada edit lokal
        else if (it.v == null) next = null;                            // dihapus di server menang
        else if (meta.type === CAT.RECORDS && cur && oldS) {
          const d = fieldDiff(parseJson(oldS, {}), cur);               // rebase edit lokal di atas versi server
          next = applyPatch(it.v, d.set, d.unset);
        } else return;                                                 // edit lokal (map/doc/record baru) menang
        const nextS = next == null ? null : canon(next);
        if (nextS === curS) return;
        local = setEntry(k, local, it.id, next == null ? null : next, it.seq);
      });
      writeLocal(k, local);
      if (mem.get(k) !== before) changed.add(k);
      dirty.add(k);
    });
    return changed;
  }

  /** Bangun ulang seluruh nilai lokal dari base + pending (setelah boot / tarik penuh). */
  function rebuildLocal(keys) {
    (keys || Object.keys(CAT.KEYS)).forEach(k => {
      const meta = CAT.info(k);
      const b = baseOf(k);
      const entries = [...b.entries()].sort((x, y) => (x[1].seq || 0) - (y[1].seq || 0));
      let local;
      if (meta.type === CAT.RECORDS) local = entries.map(([, e]) => parseJson(e.s, null)).filter(Boolean);
      else if (meta.type === CAT.MAP) { local = {}; entries.forEach(([id, e]) => { local[id] = parseJson(e.s, null); }); }
      else local = b.has('*') ? parseJson(b.get('*').s, undefined) : undefined;
      const ops = pending.get(k);
      if (ops) ops.forEach(op => {
        if (op.op === 'del') { local = setEntry(k, local, op.id, null); return; }
        if (op.op === 'put') { local = setEntry(k, local, op.id, op.v); return; }
        const cur = entryOf(k, local, op.id);
        if (cur) local = setEntry(k, local, op.id, applyPatch(cur, op.set, op.unset));
      });
      if (meta.type === CAT.DOC && local === undefined) mem.delete(k);
      else if (meta.type !== CAT.DOC && !b.size && !(ops && ops.size)) mem.delete(k);
      else writeLocal(k, local);
    });
  }

  /* ------------------------------------------------------------------
   * IndexedDB (cache persisten)
   * ----------------------------------------------------------------*/
  let idb = null;
  const persistRecs = new Set();
  let persistTimer = null;
  let cursor = 0;
  let viewSig = '';
  let owner = '';
  const TAB = (() => {
    try {
      let id = sessionStorage.getItem('lms_sync_tab');
      if (!id) { id = 'tab_' + now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('lms_sync_tab', id); }
      return id;
    } catch (e) { return 'tab_' + Math.random().toString(36).slice(2, 10); }
  })();

  function idbOpen() {
    if (idb) return Promise.resolve(idb);
    if (!('indexedDB' in global)) return Promise.reject(new Error('IndexedDB tidak tersedia'));
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('rec')) db.createObjectStore('rec');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => { idb = req.result; idb.onversionchange = () => { idb.close(); idb = null; }; resolve(idb); };
      req.onerror = () => reject(req.error || new Error('IndexedDB gagal dibuka'));
      req.onblocked = () => reject(new Error('IndexedDB terblokir'));
    });
  }
  function idbTx(stores, mode, fn) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      fn(t, v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error || new Error('transaksi IndexedDB gagal'));
      t.onabort = () => reject(t.error || new Error('transaksi IndexedDB dibatalkan'));
    }));
  }
  const idbGet = (store, key) => idbTx([store], 'readonly', (t, done) => { const r = t.objectStore(store).get(key); r.onsuccess = () => done(r.result); });

  function markPersist(k, id) { persistRecs.add(k + '\u0001' + id); schedulePersist(); }
  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => { persistTimer = null; persistNow().catch(e => console.warn('[sync] cache', e)); }, 800);
  }
  function persistNow() {
    if (!idb || !owner) return Promise.resolve();
    const recs = [...persistRecs];
    persistRecs.clear();
    const state = { v: FORMAT, owner, cursor, viewSig, savedAt: now() };
    return idbTx(['rec', 'meta'], 'readwrite', (t) => {
      const rs = t.objectStore('rec');
      recs.forEach(key => {
        const [k, id] = key.split('\u0001');
        const e = base.has(k) ? base.get(k).get(id) : null;
        const g = rs.get(key);
        g.onsuccess = () => {
          const cur = g.result;
          if (e) { if (!cur || !(cur.ver > e.ver)) rs.put({ k, id, s: e.s, ver: e.ver, seq: e.seq }, key); }
          else if (cur) rs.delete(key);
        };
      });
      const ms = t.objectStore('meta');
      const g = ms.get('state');
      g.onsuccess = () => {
        const cur = g.result;
        if (cur && cur.owner === owner && cur.v === FORMAT && cur.cursor > state.cursor) state.cursor = cur.cursor;
        ms.put(state, 'state');
      };
    });
  }
  function persistPending() {
    if (!idb || !owner) return;
    const ops = [];
    pending.forEach(m => m.forEach(op => ops.push(op)));
    idbTx(['meta'], 'readwrite', t => {
      const ms = t.objectStore('meta');
      if (ops.length) ms.put({ owner, at: now(), ops }, 'pending:' + TAB); else ms.delete('pending:' + TAB);
    }).catch(() => {});
    try {
      const tabs = parseJson(rget('lms_sync_tabs'), {}) || {};
      tabs[TAB] = now();
      rset('lms_sync_tabs', JSON.stringify(tabs));
    } catch (e) { /* noop */ }
  }
  function heartbeatTab() {
    const tabs = parseJson(rget('lms_sync_tabs'), {}) || {};
    const t = now();
    tabs[TAB] = t;
    Object.keys(tabs).forEach(id => { if (t - tabs[id] > 7 * 86400000) delete tabs[id]; });
    rset('lms_sync_tabs', JSON.stringify(tabs));
  }

  async function loadCache(userId) {
    const state = await idbGet('meta', 'state');
    if (!state || state.owner !== userId || state.v !== FORMAT) {
      await idbTx(['rec', 'meta'], 'readwrite', t => {
        t.objectStore('rec').clear();
        const ms = t.objectStore('meta');
        const keys = ms.getAllKeys();
        keys.onsuccess = () => keys.result.forEach(key => { if (key !== 'legacy') ms.delete(key); });
      });
      return false;
    }
    const all = await idbTx(['rec', 'meta'], 'readonly', (t, done) => {
      const out = { recs: [], pend: [] };
      const r = t.objectStore('rec').getAll();
      r.onsuccess = () => { out.recs = r.result || []; };
      const ms = t.objectStore('meta');
      const c = ms.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        if (String(cur.key).startsWith('pending:')) out.pend.push({ key: cur.key, val: cur.value });
        cur.continue();
      };
      done(out);
    });
    all.recs.forEach(e => { if (CAT.has(e.k)) baseOf(e.k).set(e.id, { s: e.s, ver: e.ver, seq: e.seq }); });
    // Pending milik tab ini (reload) + tab lain yang sudah tidak aktif.
    const tabs = parseJson(rget('lms_sync_tabs'), {}) || {};
    const adopted = [];
    all.pend.forEach(p => {
      const tab = String(p.key).slice(8);
      const alive = tab !== TAB && tabs[tab] && now() - tabs[tab] < 30000;
      if (alive || !p.val || p.val.owner !== userId) return;
      (p.val.ops || []).forEach(op => { if (CAT.has(op.k)) pendingOf(op.k).set(op.id, op); });
      if (tab !== TAB) adopted.push(p.key);
    });
    if (adopted.length) idbTx(['meta'], 'readwrite', t => adopted.forEach(k => t.objectStore('meta').delete(k))).catch(() => {});
    cursor = Number(state.cursor) || 0;
    viewSig = state.viewSig || '';
    return true;
  }

  async function wipeCache() {
    base.clear(); pending.clear(); mem.clear(); dirty.clear();
    cursor = 0; viewSig = '';
    try {
      await idbTx(['rec', 'meta'], 'readwrite', t => {
        t.objectStore('rec').clear();
        const ms = t.objectStore('meta');
        const keys = ms.getAllKeys();
        keys.onsuccess = () => keys.result.forEach(key => { if (key !== 'legacy') ms.delete(key); });
      });
    } catch (e) { /* tanpa IndexedDB */ }
  }

  /* ------------------------------------------------------------------
   * API
   * ----------------------------------------------------------------*/
  class ApiError extends Error {
    constructor(message, status, data) { super(message); this.status = status || 0; this.data = data || null; }
  }

  async function api(action, body, opts) {
    const o = opts || {};
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeout || 45000) : null;
    const headers = { 'Content-Type': 'application/json' };
    const t = o.token !== undefined ? o.token : token();
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    try {
      res = await fetch(CFG.api, {
        method: 'POST', headers, body: JSON.stringify(Object.assign({ action }, body || {})),
        signal: ctrl ? ctrl.signal : undefined, keepalive: !!o.keepalive, cache: 'no-store', credentials: 'same-origin'
      });
    } catch (e) {
      setStatus({ online: false });
      throw new ApiError(e && e.name === 'AbortError' ? 'Server tidak merespons. Periksa koneksi internet.' : 'Tidak dapat terhubung ke server. Periksa koneksi internet.', 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!status.online) setStatus({ online: true });
    if (res.status === 401 && action !== 'login' && action !== 'logout') {
      onUnauthorized();
      throw new ApiError((data && data.error) || 'Sesi berakhir.', 401, data);
    }
    if (!res.ok) throw new ApiError((data && data.error) || ('Server error (HTTP ' + res.status + ')'), res.status, data);
    if (!data) throw new ApiError('Respons server tidak valid.', res.status);
    return data;
  }

  let unauthorizedOnce = false;
  function onUnauthorized() {
    if (unauthorizedOnce) return;
    unauthorizedOnce = true;
    rdel(SESSION_KEY);
    if (PAGE === 'dashboard') location.replace('index.html?sesi=berakhir');
  }

  /* ------------------------------------------------------------------
   * Siklus sinkronisasi
   * ----------------------------------------------------------------*/
  let pushTimer = null, pollTimer = null, inflight = null, again = false, errorCount = 0, repushRounds = 0;
  let started = false, lastLocalEdit = 0, lastActivity = now();

  function schedulePush() {
    lastLocalEdit = now();
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; syncNow('push'); }, PUSH_DEBOUNCE);
    setStatus({});
  }

  function pollDelay() {
    if (errorCount) return Math.min(60000, 4000 * Math.pow(2, errorCount - 1));
    if (document.visibilityState === 'hidden') return 60000;
    if (status.realtime) return 25000;
    return now() - lastActivity > 120000 ? 15000 : 7000;
  }
  function schedulePoll(ms) {
    if (!started) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { pollTimer = null; syncNow('poll'); }, ms != null ? ms : pollDelay());
  }

  /** Id tab yang dipakai js/presence.js (tetap walau Presence sudah berhenti). */
  function presenceTab() {
    const r = global.Presence && Presence.localRecord && Presence.localRecord();
    if (r && r.tabId) return r.tabId;
    try { return sessionStorage.getItem('lms_presence_tab') || TAB; } catch (e) { return TAB; }
  }
  let presenceSentAt = 0, presenceSentKey = '';
  /** Status online tab ini; dikirim paling sering tiap 20 detik kecuali halaman/visibilitas berubah. */
  function presencePayload(force) {
    if (!global.Presence || typeof Presence.localRecord !== 'function') return null;
    const r = Presence.localRecord();
    if (!r) return null;
    const key = r.page + '|' + r.visibility;
    if (!force && key === presenceSentKey && now() - presenceSentAt < 20000) return null;
    presenceSentAt = now();
    presenceSentKey = key;
    return { tab: r.tabId, page: r.page, visibility: r.visibility, idle: Math.max(0, now() - (r.lastActivity || now())), browser: r.browser, os: r.os, device: r.device };
  }

  function applyPresence(list, serverNow) {
    if (!Array.isArray(list)) return;
    const skew = now() - (Number(serverNow) || now());
    let map = parseJson(rget('lms_presence_v1'), {}) || {};
    const mine = global.Presence && Presence.localRecord ? (Presence.localRecord() || {}).tabId : null;
    let changed = false;
    list.forEach(p => {
      if (!p || !p.tabId || p.tabId === mine) return;
      const lastSeen = Number(p.lastSeen) + skew;
      const cur = map[p.tabId];
      if (cur && cur.lastSeen >= lastSeen) return;
      map[p.tabId] = { tabId: p.tabId, userId: p.userId, page: p.page || 'overview', lastSeen, lastActivity: lastSeen - (Number(p.idle) || 0),
        visibility: p.visibility || 'visible', browser: p.browser || 'Browser', os: p.os || 'Perangkat', device: p.device || 'Perangkat', remote: true };
      changed = true;
    });
    if (!changed) return;
    rset('lms_presence_v1', JSON.stringify(map));
    try { global.dispatchEvent(new StorageEvent('storage', { key: 'lms_presence_v1', storageArea: LS })); } catch (e) { /* noop */ }
  }

  function chunkOps(ops) {
    const out = [];
    let cur = [], size = 0;
    ops.forEach(op => {
      const wire = op.op === 'put' ? { k: op.k, id: op.id, op: 'put', v: op.v }
        : op.op === 'patch' ? { k: op.k, id: op.id, op: 'patch', set: op.set, unset: op.unset } : { k: op.k, id: op.id, op: 'del' };
      const n = JSON.stringify(wire).length;
      if (cur.length && (size + n > CHUNK_BYTES || cur.length >= 400)) { out.push(cur); cur = []; size = 0; }
      cur.push({ op, wire });
      size += n;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function handleSyncResponse(resp, sent) {
    const changed = new Set();
    const items = [];
    const sentMap = new Map((sent || []).map(x => [x.op.k + '\u0001' + x.op.id, x.op]));
    (resp.applied || []).forEach(a => {
      const op = sentMap.get(a.k + '\u0001' + a.id);
      if (a.hidden) { items.push({ k: a.k, id: a.id, v: null, ver: a.ver, seq: a.seq, force: true, own: op ? Object.assign({}, op, { c: op.c }) : null }); return; }
      items.push({ k: a.k, id: a.id, v: a.v == null ? null : a.v, ver: a.ver, seq: a.seq, own: op || null });
    });
    let rejectedMsg = '';
    (resp.rejected || []).forEach(r => {
      const op = sentMap.get(r.k + '\u0001' + r.id);
      items.push({ k: r.k, id: r.id, v: r.hidden ? null : (r.v == null ? null : r.v), ver: r.ver || 0, seq: r.seq || 0, own: op ? Object.assign({}, op) : null, rejected: true });
      // Penghapusan berantai yang ditolak (mis. data keuangan saat tutor menghapus kelas)
      // cukup dipulihkan diam-diam; perubahan lain diberi tahu ke pengguna.
      if (!rejectedMsg && !(op && op.op === 'del')) rejectedMsg = r.reason || 'Perubahan ditolak server.';
    });
    if (items.length) {
      // Perubahan sendiri: hapus dari pending bila belum diubah lagi.
      items.forEach(it => {
        const ops = pending.get(it.k);
        if (ops && it.own && ops.get(it.id) && ops.get(it.id).c === it.own.c) ops.delete(it.id);
      });
      applyServerOwn(items).forEach(k => changed.add(k));
    }
    if (rejectedMsg) {
      console.warn('[sync] ditolak:', resp.rejected);
      notifyRejected(rejectedMsg);
    }
    const records = (resp.records || []).map(r => ({ k: r.k, id: r.id, v: r.v, ver: r.ver, seq: r.seq }));
    if (records.length) applyServer(records).forEach(k => changed.add(k));
    if (typeof resp.cursor === 'number' && resp.cursor > cursor) cursor = resp.cursor;
    if (resp.presence) applyPresence(resp.presence, resp.now);
    if (resp.me && owner) refreshSessionFrom(resp.me);
    return changed;
  }

  /** Respons atas perubahan sendiri: paksa set base, lalu sesuaikan lokal. */
  function applyServerOwn(items) {
    const plain = [];
    items.forEach(it => {
      if (it.rejected || it.force) {
        // Ditolak / disembunyikan: kembalikan ke versi server (lokal ikut).
        const b = baseOf(it.k);
        if (it.v == null) b.delete(it.id); else b.set(it.id, { s: canon(it.v), ver: it.ver || 0, seq: it.seq || 0 });
        markPersist(it.k, it.id);
        let local = readLocal(it.k);
        local = setEntry(it.k, local, it.id, it.v == null ? null : it.v, it.seq);
        writeLocal(it.k, local);
        const ops = pending.get(it.k);
        if (ops) ops.delete(it.id);
        dirty.add(it.k);
        plain.push(it.k);
      } else plain.push(null);
    });
    const rest = items.filter(it => !it.rejected && !it.force);
    const changed = applyServer(rest, { force: true });
    plain.forEach(k => { if (k) changed.add(k); });
    return changed;
  }

  let rejectNoticeAt = 0;
  function notifyRejected(msg) {
    if (now() - rejectNoticeAt < 8000) return;
    rejectNoticeAt = now();
    if (global.UI && UI.toast) UI.toast('Sebagian perubahan tidak disimpan: ' + msg, 'error');
  }

  function refreshSessionFrom(me) {
    const s = readSession();
    if (!s || s.id !== me.id) return;
    if (s.name !== me.name || s.role !== me.role || s.username !== me.username) {
      rset(SESSION_KEY, JSON.stringify(Object.assign({}, s, { name: me.name, role: me.role, username: me.username })));
    }
    if ((me.status || 'Aktif') === 'Dikeluarkan') onUnauthorized();
  }

  async function syncNow(reason) {
    if (!isServer() || !ready || !token()) return;
    if (inflight) { again = true; return inflight; }
    inflight = (async () => {
      setStatus({ syncing: true });
      const changedAll = new Set();
      try {
        flushDiff();
        const ops = [];
        pending.forEach(m => m.forEach(op => ops.push(op)));
        const chunks = chunkOps(ops);
        let nudge = null;
        let resp;
        if (!chunks.length) chunks.push([]);
        for (let i = 0; i < chunks.length; i++) {
          resp = await api('sync', { cursor, changes: chunks[i].map(x => x.wire), presence: i === 0 ? presencePayload() : null });
          if (resp.reset) { await fullResync(); return; }
          handleSyncResponse(resp, chunks[i]).forEach(k => changedAll.add(k));
          if (resp.nudge) nudge = mergeNudge(nudge, resp.nudge);
          if (resp.viewSig && viewSig && resp.viewSig !== viewSig) { viewSig = resp.viewSig; await fullResync(); return; }
          if (resp.viewSig) viewSig = resp.viewSig;
        }
        let guard = 0;
        while (resp && resp.more && guard++ < 50) {
          resp = await api('sync', { cursor });
          handleSyncResponse(resp, []).forEach(k => changedAll.add(k));
        }
        flushDiff();
        errorCount = 0;
        setStatus({ lastSync: now(), error: '', online: true });
        schedulePersist();
        if (nudge) RT.send(nudge);
        if (changedAll.size || ops.length) BC.post();
        // Edit lokal yang terjadi selama permintaan berjalan: kirim lagi (dibatasi agar tidak berputar).
        if (countPending() && repushRounds < 3) { repushRounds++; again = true; } else repushRounds = 0;
      } catch (e) {
        errorCount = Math.min(errorCount + 1, 6);
        setStatus({ error: e.message || String(e) });
        if (e.status === 401) return;
      } finally {
        inflight = null;
        setStatus({ syncing: false });
        if (changedAll.size) emitRemote(changedAll);
        if (again) { again = false; setTimeout(() => syncNow('again'), 50); }
        else schedulePoll();
      }
    })();
    return inflight;
  }

  /** Kirim semua perubahan lokal sekarang dan tunggu sampai server mengonfirmasi. */
  async function flush() {
    if (!isServer() || !ready) return;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    for (let i = 0; i < 6; i++) {
      flushDiff();
      if (!countPending() && !inflight) return;
      if (inflight) { try { await inflight; } catch (e) { /* lanjut */ } }
      else await syncNow('flush');
      if (!status.online || (status.error && errorCount > 1)) return;
    }
  }

  function mergeNudge(a, b) {
    if (!a) return b;
    if (a.scope === 'all' || b.scope === 'all') return { scope: 'all' };
    return { scope: 'users', users: [...new Set((a.users || []).concat(b.users || []))] };
  }

  /** Tarik seluruh data dari server (perangkat baru / cache tidak valid). */
  async function fullResync(onProgress) {
    let c = 0, snap = 0, more = true, count = 0, last = null, guard = 0;
    const fresh = new Map();
    while (more && guard++ < 2000) {
      const resp = await api('sync', { cursor: c, full: true, snap, presence: c === 0 ? presencePayload() : null });
      (resp.records || []).forEach(r => {
        if (!CAT.has(r.k)) return;
        if (!fresh.has(r.k)) fresh.set(r.k, new Map());
        if (r.v == null) fresh.get(r.k).delete(r.id);
        else fresh.get(r.k).set(r.id, { s: canon(r.v), ver: r.ver, seq: r.seq });
        count++;
      });
      c = resp.cursor; snap = resp.snap; more = !!resp.more; last = resp;
      if (onProgress) onProgress(count);
    }
    base.clear();
    fresh.forEach((m, k) => base.set(k, m));
    cursor = c;
    if (last && last.viewSig) viewSig = last.viewSig;
    // Pending lama dihitung ulang terhadap base baru.
    rebuildLocal();
    Object.keys(CAT.KEYS).forEach(k => dirty.add(k));
    flushDiff();
    if (last && last.presence) applyPresence(last.presence, last.now);
    if (last && last.me) refreshSessionFrom(last.me);
    await persistAll();
    setStatus({ lastSync: now(), error: '' });
    if (ready) emitRemote(new Set(Object.keys(CAT.KEYS)));
  }

  async function persistAll() {
    if (!idb || !owner) return;
    persistRecs.clear();
    await idbTx(['rec', 'meta'], 'readwrite', t => {
      const rs = t.objectStore('rec');
      rs.clear();
      base.forEach((m, k) => m.forEach((e, id) => rs.put({ k, id, s: e.s, ver: e.ver, seq: e.seq }, k + '\u0001' + id)));
      t.objectStore('meta').put({ v: FORMAT, owner, cursor, viewSig, savedAt: now() }, 'state');
    });
  }

  /* ------------------------------------------------------------------
   * Sinyal antar-tab & Supabase Realtime (Broadcast)
   * ----------------------------------------------------------------*/
  const BC = {
    ch: null,
    init() {
      if (!('BroadcastChannel' in global)) return;
      try {
        this.ch = new BroadcastChannel('lms-rubela-sync');
        this.ch.onmessage = (e) => { if (e.data && e.data.tab !== TAB && e.data.owner === owner) schedulePoll(150); };
      } catch (e) { this.ch = null; }
    },
    post() { if (this.ch) try { this.ch.postMessage({ tab: TAB, owner, at: now() }); } catch (e) { /* noop */ } }
  };

  function hashUser(id) {
    let h = 0x811c9dc5;
    const s = String(id) + ':' + CFG.realtimeTopic;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const RT = {
    ws: null, ref: 0, joinRef: null, joined: false, hb: null, retry: 1000, timer: null, lastNudge: 0, stopped: false,
    enabled() { return !!(CFG.realtime && CFG.supabaseUrl && CFG.supabaseKey && 'WebSocket' in global); },
    connect() {
      if (!this.enabled() || this.ws || this.stopped) return;
      const url = String(CFG.supabaseUrl).replace(/^http/i, 'ws').replace(/\/+$/, '') +
        '/realtime/v1/websocket?apikey=' + encodeURIComponent(CFG.supabaseKey) + '&vsn=1.0.0';
      let ws;
      try { ws = new WebSocket(url); } catch (e) { this.later(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.joinRef = String(++this.ref);
        this.raw({ topic: 'realtime:' + CFG.realtimeTopic, event: 'phx_join', ref: this.joinRef, join_ref: this.joinRef,
          payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: false }, postgres_changes: [], private: false } } });
        clearInterval(this.hb);
        this.hb = setInterval(() => this.raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) }), 25000);
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!m) return;
        if (m.event === 'phx_reply' && m.ref === this.joinRef) {
          this.joined = !!(m.payload && m.payload.status === 'ok');
          if (this.joined) { this.retry = 1000; setStatus({ realtime: true }); schedulePoll(); }
          return;
        }
        if (m.topic === 'realtime:' + CFG.realtimeTopic && (m.event === 'phx_error' || m.event === 'phx_close')) { try { ws.close(); } catch (x) { /* noop */ } return; }
        if (m.event === 'broadcast' && m.payload && m.payload.event === 'changed') this.onNudge(m.payload.payload || {});
      };
      ws.onclose = () => {
        clearInterval(this.hb);
        this.ws = null; this.joined = false;
        if (status.realtime) setStatus({ realtime: false });
        schedulePoll();
        this.later();
      };
      ws.onerror = () => { /* onclose menyusul */ };
    },
    later() {
      if (this.stopped) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(60000, this.retry * 2);
    },
    raw(obj) { if (this.ws && this.ws.readyState === 1) try { this.ws.send(JSON.stringify(obj)); } catch (e) { /* noop */ } },
    send(nudge) {
      if (!this.joined) return;
      const payload = { t: TAB, s: nudge.scope };
      if (nudge.scope === 'users') payload.u = (nudge.users || []).slice(0, 200).map(hashUser);
      this.raw({ topic: 'realtime:' + CFG.realtimeTopic, event: 'broadcast', ref: String(++this.ref), join_ref: this.joinRef,
        payload: { type: 'broadcast', event: 'changed', payload } });
    },
    onNudge(p) {
      if (!p || p.t === TAB) return;
      if (p.s === 'users' && !(Array.isArray(p.u) && p.u.includes(hashUser(owner)))) return;
      const t = now();
      if (t - this.lastNudge < 1500) { schedulePoll(1600); return; }
      this.lastNudge = t;
      schedulePoll(150 + Math.floor(Math.random() * 900));
    },
    stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.hb); if (this.ws) try { this.ws.close(); } catch (e) { /* noop */ } }
  };

  /* ------------------------------------------------------------------
   * Overlay pemuatan
   * ----------------------------------------------------------------*/
  let overlay = null;
  function showOverlay(text) {
    if (!document.body) return;
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'syncBoot';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;' +
        'background:var(--bg,#f6f7fb);color:var(--text,#1f2937);font:500 15px/1.5 "Plus Jakarta Sans",system-ui,sans-serif;text-align:center;padding:24px;';
      overlay.innerHTML = '<div class="spinner" style="width:34px;height:34px;"></div><div id="syncBootText"></div><div id="syncBootSub" style="font-size:13px;opacity:.7;max-width:420px;"></div>';
      document.body.appendChild(overlay);
    }
    overlay.querySelector('#syncBootText').textContent = text;
  }
  function overlaySub(text) { if (overlay) overlay.querySelector('#syncBootSub').textContent = text || ''; }
  function hideOverlay() { if (overlay) { overlay.remove(); overlay = null; } }
  function overlayError(msg, retry) {
    showOverlay('Data belum dapat dimuat');
    overlaySub(msg);
    const box = overlay;
    if (!box.querySelector('#syncRetry')) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center;';
      wrap.innerHTML = '<button type="button" class="btn btn-primary btn-sm" id="syncRetry">Coba lagi</button>' +
        '<a class="btn btn-secondary btn-sm" href="index.html" id="syncToLogin">Ke halaman masuk</a>';
      box.appendChild(wrap);
      box.querySelector('#syncRetry').addEventListener('click', () => { wrap.remove(); retry(); });
    }
    const sp = box.querySelector('.spinner');
    if (sp) sp.style.display = 'none';
  }

  /* ------------------------------------------------------------------
   * Boot dashboard
   * ----------------------------------------------------------------*/
  let readyResolve;
  const readyPromise = new Promise(r => { readyResolve = r; });

  async function bootDashboard() {
    const s = readSession();
    if (!s || !s.token) { location.replace('index.html'); return new Promise(() => {}); }
    owner = s.id;
    let hasCache = false;
    try {
      await idbOpen();
      hasCache = await loadCache(owner);
    } catch (e) {
      console.warn('[sync] IndexedDB tidak dapat dipakai, data hanya di memori:', e);
      idb = null;
    }
    BC.init();
    heartbeatTab();
    rebuildLocal();
    ready = true;
    if (!hasCache) {
      const slow = setTimeout(() => showOverlay('Menyiapkan data LMS…'), 250);
      const attempt = async () => {
        try {
          await fullResync(n => { if (overlay) overlaySub(n + ' data dimuat'); });
          clearTimeout(slow);
          hideOverlay();
        } catch (e) {
          clearTimeout(slow);
          if (e.status === 401) return new Promise(() => {});
          await new Promise(res => overlayError(e.message || 'Tidak dapat terhubung ke server.', res));
          showOverlay('Menyiapkan data LMS…');
          return attempt();
        }
      };
      await attempt();
    }
    start();
    if (hasCache) setTimeout(() => syncNow('boot'), 30);
    readyResolve();
    afterBoot();
    return readyPromise;
  }

  function start() {
    if (started) return;
    started = true;
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActivity = now(); }, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow('visible');
      else { flushDiff(); if (countPending()) syncNow('hide'); persistNow().catch(() => {}); }
    });
    global.addEventListener('online', () => { setStatus({ online: true }); errorCount = 0; syncNow('online'); });
    global.addEventListener('offline', () => setStatus({ online: false }));
    global.addEventListener('pagehide', onPageHide);
    setInterval(heartbeatTab, 10000);
    RT.connect();
    schedulePoll();
  }

  function onPageHide() {
    flushDiff();
    persistNow().catch(() => {});
    const t = token();
    if (!t) return;
    const ops = [];
    pending.forEach(m => m.forEach(op => ops.push(op)));
    const body = { cursor, presence: { tab: presenceTab(), gone: true } };
    const small = chunkOps(ops);
    if (small.length === 1 && JSON.stringify(small[0].map(x => x.wire)).length < 60000) body.changes = small[0].map(x => x.wire);
    api('sync', body, { keepalive: true, timeout: 8000 }).catch(() => {});
  }

  function afterBoot() {
    if (global.Branding && Branding.apply) try { Branding.apply(); } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------------
   * Data lama perangkat (sebelum server aktif)
   * ----------------------------------------------------------------*/
  const legacy = {
    async backupIfNeeded() {
      const keys = Object.keys(CAT.KEYS).filter(k => rget(k) != null);
      if (!keys.length) return;
      try {
        await idbOpen();
        const existing = await idbGet('meta', 'legacy');
        if (!existing) {
          const data = {};
          keys.forEach(k => { data[k] = rget(k); });
          await idbTx(['meta'], 'readwrite', t => t.objectStore('meta').put({ at: now(), data }, 'legacy'));
        }
        keys.forEach(rdel);
        ['lms_seeded_v1', 'lms_seeded_v2', 'lms_seeded_v3', 'lms_seeded_v4', 'lms_seeded_v5', 'lms_seeded_v6'].forEach(rdel);
      } catch (e) {
        console.warn('[sync] cadangan data lama gagal, data lama dibiarkan:', e);
      }
    },
    async get() { try { await idbOpen(); return await idbGet('meta', 'legacy'); } catch (e) { return null; } },
    async summary() {
      const l = await this.get();
      if (!l || !l.data) return null;
      const counts = {};
      Object.keys(l.data).forEach(k => {
        const v = parseJson(l.data[k], null);
        counts[k] = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1);
      });
      const users = parseJson(l.data.lms_users, []) || [];
      const realUsers = users.filter(u => u && !CAT.DEMO_USER_IDS.includes(u.id)).length;
      return { at: l.at, counts, users: users.length, realUsers };
    },
    async download() {
      const l = await this.get();
      if (!l) return false;
      const out = { app: 'LMS Rubela', exportedAt: new Date().toISOString(), backupAt: new Date(l.at).toISOString(), data: {} };
      Object.keys(l.data).forEach(k => { out.data[k] = parseJson(l.data[k], l.data[k]); });
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'cadangan-data-lama-lms-rubela.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return true;
    },
    async discard() { try { await idbTx(['meta'], 'readwrite', t => t.objectStore('meta').delete('legacy')); } catch (e) { /* noop */ } },
    /**
     * Gabungkan data lama ke server (hanya record yang belum ada di server).
     * opts.skipDemo: lewati akun & data contoh bawaan.
     */
    async importToServer(opts) {
      const o = opts || {};
      const l = await this.get();
      if (!l || !l.data) return { added: 0 };
      const demo = new Set(CAT.DEMO_USER_IDS);
      const DEMO_PW = ['admin123', 'guru123', 'siswa123', 'ortu123', 'password123'];
      const refFields = ['userId', 'studentId', 'teacherId', 'senderId', 'receiverId', 'authorId', 'recipientId', 'actorId'];
      const seedIds = /^(c_pk_11a|c_pk_11b|c_pu_12|c_lbind_10|m_[123]|mod_[12]|rec_[123]|a_[12]|s_1|e_[1-6]|q_(pu|ppu|pbm|pk|lbind|lbing|pm)\d|cbt_[12]|att_1|at_[1-6]|pay_[1-4]|ex_[12]|sal_1|nt_[1-4]|plan_[1-8]|mo_[sgo]\d)$/;
      const resetPw = [];
      let added = 0;
      const verses = readLocal('lms_verses');
      Object.keys(l.data).forEach(k => {
        if (!CAT.has(k)) return;
        const meta = CAT.info(k);
        const val = parseJson(l.data[k], null);
        if (val == null) return;
        const b = baseOf(k);
        let local = readLocal(k);
        if (meta.type === CAT.RECORDS) {
          (Array.isArray(val) ? val : []).forEach(rec => {
            const id = CAT.idOf(k, rec);
            if (!id || b.has(id) || entryOf(k, local, id) !== undefined) return;
            if (o.skipDemo) {
              if (k === 'lms_users' && demo.has(id)) return;
              if (seedIds.test(id)) return;
              if (refFields.some(f => demo.has(rec[f]) && rec[f] !== 'u_admin')) return;
            } else if (k === 'lms_users' && id === 'u_admin') return;
            if (k === 'lms_verses' && verses.some(v => v.religion === rec.religion && v.reference === rec.reference)) return;
            if (k === 'lms_security_questions') return;
            let r = rec;
            if (k === 'lms_users') {
              r = Object.assign({}, rec);
              if (!r.password || DEMO_PW.includes(String(r.password))) {
                r.password = 'Rbl-' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
                resetPw.push({ name: r.name || r.username, username: r.username, password: r.password });
              }
            }
            local.push(r);
            added++;
          });
        } else if (meta.type === CAT.MAP) {
          Object.keys(val || {}).forEach(id => {
            if (b.has(id) || Object.prototype.hasOwnProperty.call(local, id)) return;
            local[id] = val[id];
            added++;
          });
        } else if (!b.has('*') && local === undefined) { local = val; added++; }
        writeLocal(k, local);
        dirty.add(k);
      });
      flushDiff();
      await syncNow('import');
      if (inflight) await inflight;
      emitRemote(new Set(Object.keys(CAT.KEYS)));
      return { added, resetPw };
    }
  };

  /* ------------------------------------------------------------------
   * Berkas besar (musik, lampiran Mesin Waktu)
   * ----------------------------------------------------------------*/
  const BLOB_PART = 786432;
  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
      r.onerror = () => reject(r.error || new Error('Gagal membaca berkas.'));
      r.readAsDataURL(blob);
    });
  }
  async function blobUpload(key, blob, onProgress) {
    const size = blob.size || 0;
    const parts = Math.max(1, Math.ceil(size / BLOB_PART));
    for (let i = 0; i < parts; i++) {
      const data = await blobToB64(blob.slice(i * BLOB_PART, Math.min(size, (i + 1) * BLOB_PART)));
      const r = await api('blob_put', { key, part: i, parts, size, type: blob.type || '', data: data || 'AA==' });
      if (!r.ok) throw new Error(r.error || 'Unggah berkas gagal.');
      if (onProgress) onProgress((i + 1) / parts);
    }
  }
  async function blobDownload(key) {
    const first = await api('blob_get', { key, part: 0 });
    if (!first.ok) return null;
    const bufs = [b64ToBytes(first.data)];
    for (let i = 1; i < first.parts; i++) {
      const r = await api('blob_get', { key, part: i });
      if (!r.ok) return null;
      bufs.push(b64ToBytes(r.data));
    }
    return new Blob(bufs, { type: first.type || '' });
  }
  function b64ToBytes(s) {
    const bin = atob(s || '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function blobDelete(keyOrPrefix, isPrefix) {
    return api('blob_del', isPrefix ? { prefix: keyOrPrefix } : { key: keyOrPrefix });
  }

  /* ------------------------------------------------------------------
   * Autentikasi (dipakai js/auth.js)
   * ----------------------------------------------------------------*/
  function saveSession(user, tok, exp) {
    const minimal = { id: user.id, username: user.username, role: user.role, name: user.name, token: tok, exp: exp || 0 };
    rset(SESSION_KEY, JSON.stringify(minimal));
  }
  async function login(username, password, role) {
    try {
      const r = await api('login', { username, password, role }, { token: '' });
      return r;
    } catch (e) { return { ok: false, error: e.message }; }
  }
  async function quiz(challenge, pick) {
    try { return await api('quiz', { challenge, pick }, { token: '' }); }
    catch (e) { return { ok: false, done: true, error: e.message }; }
  }
  async function register(data) {
    try { return await api('register', data, { token: '' }); }
    catch (e) { return { ok: false, error: e.message }; }
  }
  async function verifyPassword(password, purpose) {
    const r = await api('verify', { password, purpose: purpose || 'identity' });
    if (!r.ok) throw new Error(r.error || 'Verifikasi gagal.');
    return !!r.match;
  }
  async function logout() {
    RT.stop();
    flushDiff();
    try { if (countPending()) await syncNow('logout'); } catch (e) { /* noop */ }
    const t = token();
    if (t) {
      try { await api('sync', { cursor, presence: { tab: presenceTab(), gone: true } }, { timeout: 5000 }); } catch (e) { /* noop */ }
      try { await api('logout', {}, { timeout: 5000 }); } catch (e) { /* noop */ }
    }
    if (!countPending()) await wipeCache();
    rdel(SESSION_KEY);
  }

  async function healthCheck(timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 8000) : null;
    try {
      const res = await fetch(CFG.api + '?action=health', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      // 404 = fungsi API memang tidak ada (hosting statis / file lokal) → mode lokal.
      if (res.status === 404) return { reachable: true, configured: false, missing: true };
      const j = await res.json().catch(() => null);
      // Galat sementara (5xx/halaman HTML): jangan mengganti mode.
      if (!j || typeof j.configured !== 'boolean') return { reachable: false, status: res.status };
      return Object.assign({ reachable: true }, j);
    } catch (e) {
      return { reachable: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Halaman login: tentukan mode berdasarkan /api/rubela?action=health. */
  async function detectMode() {
    const h = await healthCheck(8000);
    if (!h.reachable) return h;
    if (h.configured === false && mode !== 'local') { setMode('local', true); return h; }
    if (h.configured === true && mode !== 'server') { setMode('server', true); return h; }
    return h;
  }

  /* ------------------------------------------------------------------
   * Ekspor
   * ----------------------------------------------------------------*/
  global.Sync = {
    get mode() { return mode; },
    isServer, page: PAGE, tab: TAB,
    ready: readyPromise,
    whenReady(fn) { return readyPromise.then(fn); },
    boot() {
      if (!isServer()) { readyResolve(); return readyPromise; }
      if (PAGE !== 'dashboard') { readyResolve(); return readyPromise; }
      return bootDashboard();
    },
    api, ApiError, syncNow, flush,
    status: () => Object.assign({}, status, { cursor, pending: countPending(), tab: TAB }),
    onStatus(fn) { statusListeners.push(fn); return () => { const i = statusListeners.indexOf(fn); if (i >= 0) statusListeners.splice(i, 1); }; },
    login, quiz, register, verifyPassword, logout, saveSession, healthCheck, detectMode,
    blobUpload, blobDownload, blobDelete,
    legacy,
    /** Hapus cache perangkat ini lalu muat ulang data dari server. */
    async resetLocalCache() {
      flushDiff();
      if (countPending()) { try { await syncNow('reset'); } catch (e) { /* noop */ } }
      await wipeCache();
      location.reload();
    },
    _debug: { mem, base, pending, get cursor() { return cursor; } }
  };

  if (isServer()) {
    legacy.backupIfNeeded();
    if (PAGE !== 'dashboard') readyResolve();
  } else {
    readyResolve();
    // Dashboard mode lokal: bila server ternyata sudah aktif, pindahkan perangkat ini ke mode
    // server (data lama otomatis dicadangkan) dan minta masuk ulang dengan akun server.
    if (PAGE === 'dashboard' && !isFile && CAT && proto) {
      setTimeout(() => {
        healthCheck(8000).then(h => {
          if (!h || !h.reachable || h.configured !== true) return;
          rset(MODE_KEY, 'server');
          rdel(SESSION_KEY);
          location.replace('index.html?server=aktif');
        });
      }, 4000);
    }
  }
})(window);
