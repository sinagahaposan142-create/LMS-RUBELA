/* =====================================================================
 * js/safe-save.js — jawaban tetap aman saat sinyal putus
 * ---------------------------------------------------------------------
 * Dipakai ujian CBT (js/exam.js), kuis course (js/course-hub.js), dan kuis
 * grup (js/groups.js):
 *  - Jurnal per detik di localStorage perangkat (ditulis sinkron, tetap ada
 *    walau tab ditutup paksa, HP mati, atau baterai habis).
 *    Kunci: lms_safe_v1:<idPengguna>:<jenis>:<id>.
 *  - Tiap detik yang ada perubahan: Sync.saveNow() menaruh antrean kirim di
 *    IndexedDB dan mengirimnya bila online. Selama ujian/kuis berjalan,
 *    js/sync.js mencoba kirim ulang tiap 3 detik saat koneksi putus.
 *  - Jurnal dihapus setelah server mengonfirmasi; bila halaman dibuka lagi
 *    sebelum itu, pemulih per jenis (registerRecovery) menerapkannya ulang.
 *  - net(): riwayat putus-sambung tab ini, dikirim bersama status online
 *    agar pengawas melihat siapa yang koneksinya bermasalah.
 *  - Service worker (sw.js) menyimpan salinan halaman sehingga LMS tetap
 *    terbuka bila dimuat ulang tanpa sinyal.
 * Mode lokal (file://): tidak ada server; jurnal tetap ditulis agar jawaban
 * kuis yang belum dikirim tidak hilang saat halaman dimuat ulang.
 * ===================================================================*/
(function (global) {
  'use strict';

  const PREFIX = 'lms_safe_v1:';
  const MAX_AGE = 21 * 86400000;
  const TICK = 1000;
  const now = () => Date.now();
  const isServer = () => !!(global.Sync && Sync.isServer && Sync.isServer());
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    ok: svg('<path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11a4 4 0 0 1-2.5 8Z"/><path d="m9.5 14 2 2 3.5-3.5"/>'),
    device: svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
    off: svg('<path d="M3 3l18 18"/><path d="M8.6 8.7A5 5 0 0 0 8 19h9.5c.4 0 .8 0 1.1-.1M21.3 16.2A4 4 0 0 0 20 11a6 6 0 0 0-8.6-5.4"/>'),
    up: svg('<path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11a4 4 0 0 1-2.5 8Z"/><path d="M12 16v-5M9.5 13.5 12 11l2.5 2.5"/>'),
    back: svg('<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>')
  };

  /* ------------------------------------------------------------------
   * Jurnal perangkat
   * ----------------------------------------------------------------*/
  function sessionUser() {
    try { const s = JSON.parse(localStorage.getItem('lms_session') || 'null'); return s && s.id ? String(s.id) : ''; } catch (e) { return ''; }
  }
  const keyOf = (scope, id, u) => PREFIX + (u || sessionUser()) + ':' + scope + ':' + id;

  let quotaNoticeAt = 0;
  function put(scope, id, data) {
    const u = sessionUser();
    if (!u || !id || data == null) return false;
    try {
      localStorage.setItem(keyOf(scope, id, u), JSON.stringify({ at: now(), data }));
      return true;
    } catch (e) {
      if (now() - quotaNoticeAt > 60000 && global.UI && UI.toast) {
        quotaNoticeAt = now();
        UI.toast('Penyimpanan perangkat penuh. Jawaban tetap dikirim ke server bila online, tetapi cadangan di perangkat gagal dibuat.', 'error');
      }
      return false;
    }
  }
  function read(key) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' && v.data != null ? v : null; } catch (e) { return null; }
  }
  function get(scope, id) { return read(keyOf(scope, id)); }
  function drop(scope, id) { try { localStorage.removeItem(keyOf(scope, id)); } catch (e) { /* noop */ } waiting.delete(scope + '\u0001' + id); }
  /** Semua entri jurnal milik pengguna aktif untuk satu jenis. */
  function list(scope) {
    const pre = PREFIX + sessionUser() + ':' + scope + ':';
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        const v = read(k);
        if (v) out.push({ id: k.slice(pre.length), at: Number(v.at) || 0, data: v.data });
      }
    } catch (e) { /* penyimpanan tidak dapat dibaca */ }
    return out;
  }
  /** Buang jurnal yang sudah terlalu lama (semua akun di perangkat ini). */
  function prune() {
    const old = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        const v = read(k);
        if (!v || now() - (Number(v.at) || 0) > MAX_AGE) old.push(k);
      }
      old.forEach(k => localStorage.removeItem(k));
    } catch (e) { /* noop */ }
  }

  /* Hapus jurnal setelah server mengonfirmasi seluruh antrean. */
  const waiting = new Map();          // scope\u0001id → waktu ditandai
  function dropWhenSynced(scope, id) {
    if (!isServer()) { drop(scope, id); return; }
    waiting.set(scope + '\u0001' + id, now());
    try { Sync.saveNow(); } catch (e) { /* noop */ }
    checkWaiting();
  }
  function checkWaiting() {
    if (!waiting.size || !isServer()) return;
    const st = Sync.status();
    if (st.pending || st.syncing || !st.online) return;
    [...waiting.entries()].forEach(([k, t]) => {
      if (st.lastSync <= t) return;
      const i = k.indexOf('\u0001');
      drop(k.slice(0, i), k.slice(i + 1));
    });
  }

  /* ------------------------------------------------------------------
   * Kesehatan koneksi tab ini
   * ----------------------------------------------------------------*/
  const netState = { drops: 0, offlineMs: 0, offlineSince: 0, lastDropAt: 0, backAt: 0 };
  const netListeners = new Set();
  function linkUp() {
    if (navigator.onLine === false) return false;
    return isServer() ? Sync.status().online !== false : true;
  }
  function evalNet() {
    const up = linkUp();
    const t = now();
    let changed = false;
    if (!up && !netState.offlineSince) { netState.offlineSince = t; netState.drops++; netState.lastDropAt = t; changed = true; }
    else if (up && netState.offlineSince) { netState.offlineMs += t - netState.offlineSince; netState.offlineSince = 0; netState.backAt = t; changed = true; }
    if (changed) netListeners.forEach(fn => { try { fn(net()); } catch (e) { console.error(e); } });
  }
  function net() {
    const t = now();
    const st = isServer() ? Sync.status() : null;
    return {
      online: !netState.offlineSince, drops: netState.drops, lastDropAt: netState.lastDropAt, offlineSince: netState.offlineSince,
      offlineMs: netState.offlineMs + (netState.offlineSince ? t - netState.offlineSince : 0), backAt: netState.backAt,
      pending: st ? st.pending : 0, syncing: st ? !!st.syncing : false, lastSync: st ? st.lastSync : 0
    };
  }
  function onNet(fn) { netListeners.add(fn); return () => netListeners.delete(fn); }

  /* ------------------------------------------------------------------
   * Simpan otomatis per detik
   * ----------------------------------------------------------------*/
  const activeSavers = new Set();
  function releaseUrgent() {
    const start = now();
    (function check() {
      if (!Sync.status().pending || now() - start > 120000) { Sync.setUrgent(false); return; }
      setTimeout(check, 3000);
    })();
  }
  /**
   * o = { scope, id, read: () => data, write?: (data) => void, urgent?: true, alive?: () => bool }
   * read() mengembalikan salinan lengkap yang cukup untuk memulihkan pekerjaan (null = lewati).
   * alive(): bila false (mis. dialog kuis ditutup), simpan terakhir lalu berhenti sendiri.
   * Kembalian: { mark(immediate), flush(), stop(), cancel(), onStop(fn), savedAt() }.
   */
  function autosave(o) {
    let dirty = false, stopped = false, savedAt = 0;
    const stopFns = [];
    const urgent = o.urgent !== false && isServer();
    function run(force) {
      if (stopped || (!dirty && !force)) return;
      dirty = false;
      let data = null;
      try { data = o.read(); } catch (e) { console.warn('[safe-save] baca', e); }
      if (data == null) return;
      if (o.write) { try { o.write(data); } catch (e) { console.warn('[safe-save] tulis', e); } }
      put(o.scope, o.id, data);
      savedAt = now();
      try { if (isServer()) Sync.saveNow(); } catch (e) { /* noop */ }
      paintAll();
    }
    const timer = setInterval(() => {
      if (o.alive && !o.alive()) { handle.stop(); return; }
      run(false);
    }, TICK);
    const onHide = () => { if (document.visibilityState === 'hidden') run(true); };
    const onLeave = () => run(true);
    document.addEventListener('visibilitychange', onHide);
    // capture: dijalankan sebelum js/sync.js mengirim antrean terakhir saat halaman ditutup.
    global.addEventListener('pagehide', onLeave, true);
    if (urgent) Sync.setUrgent(true);
    function finish() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      global.removeEventListener('pagehide', onLeave, true);
      // Mode mendesak dilepas setelah antrean terakhir terkirim (atau 2 menit).
      if (urgent) releaseUrgent();
      activeSavers.delete(handle);
      stopFns.splice(0).forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    }
    const handle = {
      mark(immediate) { dirty = true; if (immediate) run(true); },
      flush() { run(true); },
      savedAt: () => savedAt,
      onStop(fn) { if (stopped) fn(); else stopFns.push(fn); },
      /** Simpan perubahan terakhir lalu berhenti. */
      stop() { if (stopped) return; run(false); finish(); },
      /** Berhenti tanpa menyimpan lagi (pemanggil menulis hasil akhirnya sendiri). */
      cancel() { if (stopped) return; dirty = false; finish(); }
    };
    activeSavers.add(handle);
    return handle;
  }

  /* ------------------------------------------------------------------
   * Pemulihan saat halaman dibuka kembali
   * ----------------------------------------------------------------*/
  const recoverers = {};
  /** fn(entry) → 'drop' (hapus jurnal) | 'synced' (hapus setelah terkirim) | 'keep'. */
  function registerRecovery(scope, fn) { recoverers[scope] = fn; }
  function recover(scope) {
    const scopes = scope ? [scope] : Object.keys(recoverers);
    let applied = 0;
    scopes.forEach(s => {
      const fn = recoverers[s];
      if (!fn) return;
      list(s).forEach(entry => {
        let r = 'keep';
        try { r = fn(entry) || 'keep'; } catch (e) { console.warn('[safe-save] pulihkan', s, e); return; }
        if (r === 'drop') drop(s, entry.id);
        else if (r === 'synced') { applied++; dropWhenSynced(s, entry.id); }
      });
    });
    return applied;
  }

  /* ------------------------------------------------------------------
   * Indikator status penyimpanan
   * ----------------------------------------------------------------*/
  const statusEls = new Set();
  const fmtTime = (t) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function stateNow() {
    const n = net();
    if (!n.online) return { cls: 'off', icon: ICON.off, label: 'Offline', sub: 'Jawaban tersimpan di perangkat ini dan terkirim otomatis saat sinyal kembali.' };
    if (!isServer()) return { cls: 'ok', icon: ICON.device, label: 'Tersimpan di perangkat', sub: lastLocal() ? 'Terakhir ' + fmtTime(lastLocal()) : '' };
    if (n.pending || n.syncing) return { cls: 'busy', icon: ICON.up, label: 'Mengirim…', sub: 'Sudah aman di perangkat ini; menunggu konfirmasi server.' };
    return { cls: 'ok', icon: ICON.ok, label: 'Tersimpan di server', sub: n.lastSync ? 'Terakhir ' + fmtTime(n.lastSync) : '' };
  }
  function lastLocal() { let t = 0; activeSavers.forEach(h => { t = Math.max(t, h.savedAt()); }); return t; }
  function paint(el) {
    const s = stateNow();
    const sig = s.cls + '|' + s.label + '|' + s.sub;
    if (el.__ssSig === sig) return;
    el.__ssSig = sig;
    el.className = 'ss-pill is-' + s.cls;
    el.title = s.sub;
    el.setAttribute('aria-label', s.label + (s.sub ? '. ' + s.sub : ''));
    el.innerHTML = `${s.icon}<span class="ss-pill-lbl">${esc(s.label)}</span>${s.sub && el.dataset.detail ? `<span class="ss-pill-sub">${esc(s.sub)}</span>` : ''}`;
  }
  function paintAll() {
    statusEls.forEach(el => { if (!el.isConnected) { statusEls.delete(el); return; } paint(el); });
    paintBar();
  }

  /* Bilah peringatan saat ujian/kuis berjalan. */
  let bar = null, barHideTimer = null, barWanted = 0;
  function paintBar() {
    if (!barWanted) { if (bar) { bar.remove(); bar = null; } return; }
    const n = net();
    if (!n.online) {
      clearTimeout(barHideTimer); barHideTimer = null;
      ensureBar();
      bar.className = 'ss-bar is-off';
      const sig = 'off';
      if (bar.__sig !== sig) {
        bar.__sig = sig;
        bar.innerHTML = `${ICON.off}<div><strong>Sinyal terputus.</strong> Jawabanmu tetap tersimpan di perangkat ini setiap detik dan akan terkirim otomatis saat sinyal kembali. Jangan keluar dari akun.</div>`;
      }
      return;
    }
    if (bar && bar.__sig === 'off') {
      bar.className = 'ss-bar is-back';
      bar.__sig = 'back';
      bar.innerHTML = `${ICON.back}<div><strong>Tersambung kembali.</strong> ${n.pending ? 'Mengirim jawaban yang tertunda…' : 'Semua jawaban sudah terkirim.'}</div>`;
    } else if (bar && bar.__sig === 'back' && !n.pending && !barHideTimer) {
      bar.innerHTML = `${ICON.back}<div><strong>Tersambung kembali.</strong> Semua jawaban sudah terkirim.</div>`;
      barHideTimer = setTimeout(() => { barHideTimer = null; if (bar && bar.__sig === 'back') { bar.remove(); bar = null; } }, 3500);
    }
  }
  function ensureBar() {
    if (bar && bar.isConnected) return;
    bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'assertive');
    document.body.appendChild(bar);
  }
  /**
   * Pasang indikator status pada elemen (diperbarui otomatis).
   * opts.banner: tampilkan bilah peringatan saat offline (untuk ujian/kuis).
   * Kembalian: fungsi untuk melepas.
   */
  function mountStatus(el, opts) {
    const o = opts || {};
    if (el) { if (o.detail) el.dataset.detail = '1'; statusEls.add(el); paint(el); }
    if (o.banner) { barWanted++; paintBar(); }
    let done = false;
    return function dispose() {
      if (done) return;
      done = true;
      if (el) statusEls.delete(el);
      if (o.banner) { barWanted = Math.max(0, barWanted - 1); paintBar(); }
    };
  }

  /* ------------------------------------------------------------------
   * Salinan halaman untuk dibuka tanpa sinyal (service worker)
   * ----------------------------------------------------------------*/
  function registerShell() {
    const nav = global.navigator;
    if (!nav || !('serviceWorker' in nav) || !global.isSecureContext || location.protocol === 'file:') return;
    nav.serviceWorker.register('sw.js', { scope: './' })
      .then(() => nav.serviceWorker.ready)
      .then(reg => {
        const here = location.origin;
        const urls = new Set([location.pathname, new URL('index.html', location.href).pathname]);
        try {
          performance.getEntriesByType('resource').forEach(e => {
            const u = new URL(e.name, location.href);
            if (u.origin === here && !/\/api\//.test(u.pathname)) urls.add(u.pathname + u.search);
          });
        } catch (e) { /* Performance API tidak tersedia */ }
        const w = reg.active || nav.serviceWorker.controller;
        if (w) w.postMessage({ type: 'lms-shell-cache', urls: [...urls].slice(0, 250) });
      })
      .catch(e => console.warn('[safe-save] service worker', e));
  }

  /* ------------------------------------------------------------------
   * Inisialisasi (dipanggil js/dashboard.js setelah data siap)
   * ----------------------------------------------------------------*/
  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    prune();
    global.addEventListener('online', () => { evalNet(); paintAll(); });
    global.addEventListener('offline', () => { evalNet(); paintAll(); });
    if (isServer()) Sync.onStatus(() => { evalNet(); checkWaiting(); paintAll(); });
    evalNet();
    // Pulihkan setelah tarikan pertama agar tidak menimpa pekerjaan dari perangkat lain;
    // bila sedang offline, cache perangkat inilah satu-satunya acuan.
    const run = () => { try { recover(); } catch (e) { console.warn('[safe-save] pulihkan', e); } };
    const st0 = isServer() ? Sync.status() : null;
    if (!st0 || !linkUp() || (st0.lastSync && !st0.syncing)) run();
    else {
      const boot = now();
      let off = null;
      const wait = setTimeout(() => { if (off) off(); run(); }, 15000);
      off = Sync.onStatus(st => {
        if (st.lastSync > boot && !st.syncing) { clearTimeout(wait); off(); off = null; run(); }
      });
    }
    setInterval(paintAll, 5000);
    registerShell();
  }

  global.SafeSave = {
    put, get, drop, list, dropWhenSynced,
    autosave, registerRecovery, recover,
    net, onNet, mountStatus, init,
    _test: { netState, waiting, evalNet, keyOf }
  };
})(window);
