/* =====================================================================
 * js/idb.js — penyimpanan berkas besar (IndexedDB)
 * ---------------------------------------------------------------------
 * localStorage hanya ±5 MB dan menyimpan teks. Berkas audio musik latar
 * dan lampiran terenkripsi Mesin Waktu disimpan di IndexedDB sebagai Blob.
 * Kunci: "music:<trackId>", "cap:<userId>:<attachmentId>".
 * ===================================================================*/
(function (global) {
  'use strict';
  const DB_NAME = 'lms_rubela_blobs';
  const STORE = 'blobs';
  let dbPromise = null;

  function open() {
    if (!('indexedDB' in global)) return Promise.reject(new Error('Browser ini tidak mendukung IndexedDB.'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error || new Error('Gagal membuka penyimpanan berkas.')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn(store, (v) => { result = v; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('Transaksi penyimpanan gagal.'));
      t.onabort = () => reject(t.error || new Error('Penyimpanan penuh atau dibatalkan.'));
    }));
  }

  const BlobStore = {
    put: (key, blob, meta) => tx('readwrite', (s) => {
      s.put({ blob, size: blob.size || 0, type: blob.type || '', at: Date.now(), meta: meta || {} }, key);
    }),
    get: (key) => tx('readonly', (s, done) => {
      const r = s.get(key);
      r.onsuccess = () => done(r.result ? r.result.blob : null);
    }),
    remove: (key) => tx('readwrite', (s) => { s.delete(key); }),
    /** Daftar {key,size,type,at} dengan awalan tertentu. */
    list: (prefix) => tx('readonly', (s, done) => {
      const out = [];
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) { done(out); return; }
        if (!prefix || String(c.key).startsWith(prefix)) out.push({ key: c.key, size: c.value.size, type: c.value.type, at: c.value.at });
        c.continue();
      };
    }),
    removePrefix: (prefix) => BlobStore.list(prefix).then(items =>
      tx('readwrite', (s) => { items.forEach(i => s.delete(i.key)); })),
    usage: (prefix) => BlobStore.list(prefix).then(items => items.reduce((n, i) => n + (i.size || 0), 0)),
    clearAll: () => tx('readwrite', (s) => { s.clear(); }),
    available: () => 'indexedDB' in global
  };

  global.BlobStore = BlobStore;
})(window);
