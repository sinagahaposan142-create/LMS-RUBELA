/* =====================================================================
 * js/push.js — Notifikasi Perangkat (Web Push) LMS Rubela
 * ---------------------------------------------------------------------
 * Siswa, tutor, admin, dan orang tua menerima notifikasi sistem
 * (Windows/macOS/Android/iOS) walau situs sedang ditutup.
 *
 *  - Setelah masuk, muncul ajakan "Aktifkan notifikasi". Satu klik
 *    → peramban meminta izin (wajib oleh peramban, sekali per perangkat)
 *    → perangkat langsung berlangganan. Selanjutnya otomatis: setiap
 *    notifikasi LMS baru untuk akun ini dikirim server ke perangkat.
 *  - Bila izin sudah pernah diberikan, langganan dipulihkan diam-diam
 *    setiap kali dashboard dibuka (tanpa ditanya lagi).
 *  - Mode lokal (tanpa server): notifikasi sistem hanya selama tab terbuka.
 *  - Saat dashboard terbuka, notifikasi dari perangkat lain tampil sebagai
 *    toast + lonceng diperbarui (tanpa menunggu muat ulang).
 * Kunci perangkat (localStorage, tidak disinkron): lms_push_prefs.
 * ===================================================================*/
(function (global) {
  'use strict';

  const PREF_KEY = 'lms_push_prefs';
  const RESYNC_MS = 24 * 3600000;
  const REASK_MS = 3 * 86400000;
  const ROLES = [['siswa', 'Mentee'], ['guru', 'Tutor'], ['admin', 'Admin'], ['orangtua', 'Orang Tua']];

  const nav = global.navigator || {};
  const ua = nav.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const standalone = () => !!((global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) || nav.standalone === true);
  const swSupported = () => !!('serviceWorker' in nav && 'Notification' in global && global.isSecureContext);
  const pushSupported = () => swSupported() && 'PushManager' in global;
  const server = () => !!(global.Sync && Sync.isServer && Sync.isServer());
  const esc = (s) => (global.UI && UI.esc ? UI.esc(s) : String(s == null ? '' : s));

  let user = null;
  let regPromise = null;
  let keyInfo = null;          // { publicKey, enabled, allowed, devices }
  let subscribed = false;      // perangkat ini berlangganan push server
  const seen = new Set();
  let cardHost = null;

  /* ---------------- Preferensi perangkat ---------------- */
  function prefs() {
    try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
  }
  function setPref(patch) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(prefs(), patch))); } catch (e) { /* noop */ }
  }
  const permission = () => (swSupported() ? Notification.permission : 'unsupported');

  /* ---------------- Service worker ---------------- */
  function register() {
    if (!swSupported()) return Promise.resolve(null);
    if (!regPromise) {
      regPromise = nav.serviceWorker.register('sw.js', { scope: './' })
        .then(() => nav.serviceWorker.ready)
        .catch(e => { console.warn('[push] service worker', e); regPromise = null; return null; });
    }
    return regPromise;
  }

  function b64ToBytes(s) {
    const pad = '='.repeat((4 - s.length % 4) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameKey(buf, b64) {
    if (!buf) return true;                         // peramban tidak membuka kunci → anggap sama
    const a = new Uint8Array(buf), b = b64ToBytes(b64);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  async function loadKey(force) {
    if (!server()) return null;
    if (keyInfo && !force) return keyInfo;
    keyInfo = await Sync.api('push_key', {}, { timeout: 15000 });
    return keyInfo;
  }

  /** Pastikan langganan perangkat ini terdaftar di server. Tidak pernah meminta izin. */
  async function syncSubscription(force) {
    if (!pushSupported() || !server() || permission() !== 'granted' || prefs().off) return false;
    const reg = await register();
    if (!reg || !reg.pushManager) return false;
    const k = await loadKey(force);
    if (!k || !k.allowed) { subscribed = false; return false; }
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, k.publicKey)) {
      try { await sub.unsubscribe(); } catch (e) { /* noop */ }
      sub = null;
    }
    let changed = false;
    if (!sub) { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(k.publicKey) }); changed = true; }
    const p = prefs();
    if (force || changed || p.endpoint !== sub.endpoint || p.user !== user.id || !(Date.now() - (p.syncedAt || 0) < RESYNC_MS)) {
      const res = await Sync.api('push_sub', { on: true, sub: sub.toJSON() }, { timeout: 15000 });
      if (!res.ok) throw new Error(res.error || 'Langganan ditolak server.');
      setPref({ endpoint: sub.endpoint, user: user.id, syncedAt: Date.now() });
      if (keyInfo) keyInfo.devices = Math.max(1, keyInfo.devices || 0);
    }
    subscribed = true;
    return true;
  }

  /** Aktifkan (dipanggil dari klik pengguna — izin peramban hanya boleh diminta lewat gestur). */
  async function enable() {
    if (!swSupported()) return { ok: false, reason: 'unsupported' };
    if (isIOS && !standalone() && !pushSupported()) return { ok: false, reason: 'ios' };
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: perm };
    setPref({ off: false, dismissedAt: 0 });
    await register();
    if (!server() || !pushSupported()) return { ok: true, local: true };
    try {
      const k = await loadKey(true);
      if (!k.allowed) return { ok: false, reason: 'disabled' };
      await syncSubscription(true);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', error: e.message || String(e) };
    }
  }

  async function disable() {
    setPref({ off: true, endpoint: '', syncedAt: 0 });
    subscribed = false;
    try {
      const reg = await register();
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        if (server()) { try { await Sync.api('push_sub', { on: false, sub: { endpoint: sub.endpoint } }, { timeout: 15000 }); } catch (e) { /* noop */ } }
        await sub.unsubscribe();
      }
    } catch (e) { console.warn('[push] disable', e); }
    return { ok: true };
  }

  /** Tampilkan notifikasi lokal lewat service worker (mode lokal / tab tersembunyi). */
  async function localNotify(n) {
    if (permission() !== 'granted' || prefs().off) return;
    const reg = await register();
    if (!reg) return;
    const appName = (global.DB && DB.getSettings && DB.getSettings().appName) || 'LMS Rubela';
    try {
      await reg.showNotification(String(n.title || 'Notifikasi baru').slice(0, 120), {
        body: ((n.icon ? n.icon + ' ' : '') + String(n.body || '')).trim().slice(0, 400) || appName,
        icon: 'assets/icons/icon-192.png', badge: 'assets/icons/badge-72.png',
        tag: n.id ? 'lms-' + n.id : undefined, lang: 'id', data: { link: n.link || '', id: n.id || '' }
      });
    } catch (e) { console.warn('[push] local', e); }
  }

  async function test() {
    if (server() && subscribed) {
      const r = await Sync.api('push_test', {}, { timeout: 20000 });
      if (!r.ok) throw new Error(r.error || 'Gagal mengirim notifikasi uji.');
      if (!r.sent) throw new Error(r.devices ? 'Layanan notifikasi peramban menolak pesan. Coba matikan lalu aktifkan lagi.' : 'Perangkat belum terdaftar. Tekan Aktifkan lagi.');
      return `Notifikasi uji dikirim ke ${r.sent} perangkat. Bila tidak muncul, periksa mode "Jangan Ganggu"/Fokus dan izin notifikasi sistem.`;
    }
    await localNotify({ id: 'test_' + Date.now().toString(36), title: 'Notifikasi aktif 🎉', body: 'Contoh notifikasi dari LMS Rubela.', link: 'notifikasi' });
    return 'Notifikasi uji ditampilkan.';
  }

  /* ---------------- Notifikasi baru selama dashboard terbuka ---------------- */
  function scan(fromRemote) {
    if (!user || !global.DB) return;
    const list = DB.getNotifications(user.id);
    const fresh = list.filter(n => !n.read && !seen.has(n.id) && !((Number(n.showAt) || Number(n.createdAt)) < Date.now() - 6 * 3600000));
    list.forEach(n => seen.add(n.id));
    if (!fresh.length) return;
    if (global.Dashboard && Dashboard.refreshNotifications) Dashboard.refreshNotifications();
    const top = fresh.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
    if (document.visibilityState === 'visible') {
      if (fromRemote && global.UI) {
        if (fresh.length > 3) UI.toast(`🔔 ${fresh.length} notifikasi baru`, 'info');
        else top.forEach(n => UI.toast(`${n.icon || '🔔'} ${n.title || 'Notifikasi baru'}`, 'info'));
      }
    } else if (!subscribed) {
      // Tab tersembunyi tanpa push server: tampilkan notifikasi sistem dari tab ini.
      top.forEach(localNotify);
    }
  }

  function markRead(nid) {
    if (!nid || !global.DB || !user) return;
    const n = DB.getNotifications(user.id).find(x => x.id === nid);
    if (n && !n.read) { DB.markNotificationRead(nid); if (global.Dashboard) Dashboard.refreshNotifications(); }
  }

  function openLink(link, nid) {
    markRead(nid);
    if (link && global.Dashboard && Dashboard.hasSection(link)) Dashboard.navigate(link);
    else if (global.Dashboard && Dashboard.hasSection('notifikasi')) Dashboard.navigate('notifikasi');
  }

  /** Tautan dari klik notifikasi saat dashboard belum terbuka: dashboard.html#go=…&nid=… */
  function handleHash() {
    const m = /^#(.*)$/.exec(location.hash || '');
    if (!m) return;
    const q = {};
    m[1].split('&').forEach(p => { const i = p.indexOf('='); if (i > 0) { try { q[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch (e) { /* noop */ } } });
    if (!q.go) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* noop */ }
    const link = /^[a-z0-9-]{1,40}$/i.test(q.go) ? q.go : '';
    const nid = /^[A-Za-z0-9_.:-]{1,120}$/.test(q.nid || '') ? q.nid : '';
    openLink(link, nid);
    // Record notifikasi mungkin baru tiba setelah sinkron berikutnya.
    if (nid && server()) setTimeout(() => markRead(nid), 4000);
  }

  /* ---------------- Ajakan aktifkan ---------------- */
  function roleAllowedLocal() {
    const st = global.DB ? DB.getSettings() : {};
    if (st.pushEnabled === false) return false;
    const roles = Array.isArray(st.pushRoles) ? st.pushRoles : ROLES.map(r => r[0]);
    return roles.includes(user.role);
  }

  function promptBar() {
    const old = document.getElementById('pushPrompt');
    if (old) old.remove();
    if (!user || document.body.classList.contains('exam-mode')) return;
    const p = prefs();
    if (p.off || Date.now() - (p.dismissedAt || 0) < REASK_MS || !roleAllowedLocal()) return;
    const iosHint = isIOS && !standalone() && !pushSupported();
    if (!iosHint && (!swSupported() || permission() !== 'default')) return;
    const el = document.createElement('div');
    el.id = 'pushPrompt';
    el.className = 'push-prompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Aktifkan notifikasi');
    el.innerHTML = iosHint
      ? `<span class="pp-ic" aria-hidden="true">📲</span>
         <div class="pp-body"><strong>Notifikasi di iPhone/iPad</strong>
           <span>Tekan tombol <b>Bagikan</b> lalu <b>Tambah ke Layar Utama</b>, buka LMS dari ikon itu, lalu aktifkan notifikasi.</span></div>
         <div class="pp-act"><button type="button" class="btn btn-sm btn-secondary" data-pp="later">Mengerti</button></div>`
      : `<span class="pp-ic" aria-hidden="true">🔔</span>
         <div class="pp-body"><strong>Aktifkan notifikasi</strong>
           <span>Dapatkan pemberitahuan tugas, nilai, jadwal, pengumuman, dan tantangan Game Battle walau situs sedang ditutup.</span></div>
         <div class="pp-act">
           <button type="button" class="btn btn-sm btn-primary" data-pp="on">Aktifkan</button>
           <button type="button" class="btn btn-sm btn-ghost" data-pp="later">Nanti</button>
         </div>`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-pp]').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.pp === 'later') { setPref({ dismissedAt: Date.now() }); el.remove(); return; }
      b.disabled = true;
      const r = await enable();
      el.remove();
      feedback(r);
      paintCard();
    }));
  }

  function feedback(r) {
    if (!global.UI) return;
    if (r.ok) UI.toast(r.local ? 'Notifikasi aktif selama tab LMS terbuka (mode lokal).' : 'Notifikasi perangkat aktif ✅ Anda akan tetap menerima pemberitahuan walau situs ditutup.', 'success');
    else if (r.reason === 'denied') UI.toast('Izin notifikasi ditolak peramban. Buka ikon gembok di bilah alamat → Notifikasi → Izinkan.', 'warning');
    else if (r.reason === 'default') UI.toast('Izin notifikasi belum diberikan.', 'info');
    else if (r.reason === 'disabled') UI.toast('Notifikasi perangkat dinonaktifkan admin untuk peran Anda.', 'info');
    else if (r.reason === 'ios') UI.toast('Di iPhone/iPad, tambahkan LMS ke Layar Utama terlebih dahulu.', 'info');
    else if (r.reason === 'unsupported') UI.toast('Peramban ini belum mendukung notifikasi perangkat.', 'error');
    else UI.toast('Gagal mengaktifkan notifikasi: ' + (r.error || 'coba lagi.'), 'error');
  }

  /* ---------------- Kartu pengaturan (Profil & Pengaturan admin) ---------------- */
  function cardHtml() {
    return '<div class="card push-card" id="pushCard"><div class="muted small">Memeriksa notifikasi perangkat…</div></div>';
  }

  function statusRows() {
    const perm = permission();
    const iosHint = isIOS && !standalone() && !pushSupported();
    const rows = [];
    if (!swSupported() && !iosHint) rows.push(['❌', 'Peramban ini belum mendukung notifikasi perangkat. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru melalui HTTPS.']);
    else if (iosHint) rows.push(['📲', 'iPhone/iPad: buka menu Bagikan → Tambah ke Layar Utama, lalu buka LMS dari ikon tersebut untuk mengaktifkan notifikasi (iOS 16.4+).']);
    else {
      rows.push([perm === 'granted' ? '✅' : (perm === 'denied' ? '⛔' : '⏳'),
        perm === 'granted' ? 'Izin peramban: diizinkan.' : (perm === 'denied'
          ? 'Izin peramban: diblokir. Klik ikon gembok/situs di bilah alamat → Notifikasi → Izinkan, lalu muat ulang halaman.'
          : 'Izin peramban: belum diminta.')]);
      if (server()) {
        rows.push([subscribed ? '📡' : '⚪', subscribed
          ? `Perangkat ini terdaftar — notifikasi tetap masuk walau situs ditutup${keyInfo && keyInfo.devices ? ` (${keyInfo.devices} perangkat aktif di akun ini)` : ''}.`
          : 'Perangkat ini belum terdaftar untuk notifikasi.']);
        if (keyInfo && !keyInfo.allowed) rows.push(['🔕', 'Admin menonaktifkan notifikasi perangkat untuk peran Anda.']);
      } else rows.push(['ℹ️', 'Mode lokal: notifikasi sistem hanya muncul selama tab LMS terbuka (server belum terhubung).']);
    }
    return rows;
  }

  function paintCard() {
    const host = cardHost && cardHost.isConnected ? cardHost.querySelector('#pushCard') : null;
    if (!host || !user) return;
    const perm = permission();
    const on = perm === 'granted' && !prefs().off && (subscribed || !server());
    const st = global.DB ? DB.getSettings() : {};
    const isAdmin = user.role === 'admin';
    const roles = Array.isArray(st.pushRoles) ? st.pushRoles : ROLES.map(r => r[0]);
    host.innerHTML = `
      <div class="card-header">${global.UI ? UI.secHead('🔔', 'Notifikasi Perangkat', 'pemberitahuan sistem di HP/laptop walau situs ditutup') : ''}
        <span class="badge ${on ? 'badge-success' : 'badge-gray'}">${on ? 'Aktif' : 'Nonaktif'}</span></div>
      <ul class="push-status">${statusRows().map(([ic, t]) => `<li><span aria-hidden="true">${ic}</span><span>${esc(t)}</span></li>`).join('')}</ul>
      <div class="flex-gap push-actions">
        ${on ? '<button type="button" class="btn btn-sm btn-secondary" data-push="off">Matikan di perangkat ini</button>'
          : `<button type="button" class="btn btn-sm btn-primary" data-push="on" ${(!swSupported() || perm === 'denied') ? 'disabled' : ''}>🔔 Aktifkan notifikasi</button>`}
        ${on ? '<button type="button" class="btn btn-sm btn-ghost" data-push="test">Kirim notifikasi uji</button>' : ''}
      </div>
      ${isAdmin ? `<div class="push-admin">
        <label class="check-row"><input type="checkbox" id="pushGlobal" ${st.pushEnabled !== false ? 'checked' : ''} /> Izinkan notifikasi perangkat untuk LMS ini</label>
        <div class="push-roles">${ROLES.map(([k, l]) => `<label class="check-row"><input type="checkbox" data-prole="${k}" ${roles.includes(k) ? 'checked' : ''} ${st.pushEnabled === false ? 'disabled' : ''} /> ${l}</label>`).join('')}</div>
        <p class="muted small">Notifikasi dikirim otomatis untuk setiap pemberitahuan LMS (tugas, nilai, presensi, jadwal, pengumuman, Game Battle, dll.).
          Setiap pengguna tetap perlu menekan "Aktifkan" sekali di perangkatnya — aturan keamanan semua peramban.</p>
      </div>` : ''}`;
    host.querySelectorAll('[data-push]').forEach(b => b.addEventListener('click', async () => {
      const act = b.dataset.push;
      if (global.UI) UI.setBusy(b, true);
      try {
        if (act === 'on') feedback(await enable());
        else if (act === 'off') { await disable(); UI.toast('Notifikasi perangkat dimatikan untuk perangkat ini.', 'info'); }
        else UI.toast(await test(), 'success');
      } catch (e) { UI.toast(e.message || String(e), 'error'); }
      if (global.UI) UI.setBusy(b, false);
      paintCard();
    }));
    const g = host.querySelector('#pushGlobal');
    if (g) g.addEventListener('change', () => {
      DB.setSetting('pushEnabled', g.checked);
      keyInfo = null;
      UI.toast(g.checked ? 'Notifikasi perangkat diizinkan.' : 'Notifikasi perangkat dinonaktifkan untuk semua pengguna.', 'info');
      paintCard();
    });
    host.querySelectorAll('[data-prole]').forEach(c => c.addEventListener('change', () => {
      const next = [...host.querySelectorAll('[data-prole]')].filter(x => x.checked).map(x => x.dataset.prole);
      DB.setSetting('pushRoles', next);
      keyInfo = null;
      UI.toast('Peran penerima notifikasi diperbarui.', 'info');
    }));
  }

  /** Pasang kartu pengaturan ke elemen root (dipanggil setelah render profil/pengaturan). */
  function bindCard(root) {
    cardHost = root;
    paintCard();
    if (server() && permission() === 'granted' && !prefs().off) {
      syncSubscription(false).catch(() => {}).then(() => { loadKey(true).catch(() => {}).then(paintCard); });
    } else if (server()) loadKey(true).then(paintCard).catch(() => {});
  }

  /* ---------------- Inisialisasi (dashboard) ---------------- */
  function init(u) {
    if (!u || user) return;
    user = u;
    DB.getNotifications(user.id).forEach(n => seen.add(n.id));
    if (swSupported()) {
      register();
      nav.serviceWorker.addEventListener('message', (e) => {
        const m = e.data || {};
        if (m.type === 'lms-push' && server()) Sync.syncNow('push').catch(() => {});
        if (m.type === 'lms-open') openLink(/^[a-z0-9-]{1,40}$/i.test(m.link || '') ? m.link : '', m.id || '');
      });
    }
    // Pulihkan langganan diam-diam bila izin sudah ada (tanpa meminta izin lagi).
    syncSubscription(false).catch(e => console.warn('[push] sync', e));
    global.addEventListener('lms:remote-change', (e) => {
      const keys = (e.detail && e.detail.keys) || [];
      if (keys.includes('lms_notifications')) scan(true);
      if (keys.includes('lms_settings')) keyInfo = null;
    });
    global.addEventListener('storage', (e) => { if (e.key === 'lms_notifications') scan(true); });
    setInterval(() => scan(false), 5000);
    handleHash();
    setTimeout(promptBar, 2500);
  }

  global.PushNotif = {
    init, enable, disable, test, cardHtml, bindCard, permission,
    supported: swSupported, pushSupported, get subscribed() { return subscribed; }
  };
})(window);
