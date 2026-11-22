/* =====================================================================
 * sw.js — Service Worker LMS Rubela
 * ---------------------------------------------------------------------
 *  - push              : tampilkan notifikasi sistem (Windows/macOS/Android/iOS)
 *  - notificationclick : buka/fokuskan dashboard ke halaman terkait
 *  - message           : notifikasi lokal dari halaman (mode lokal / tab tersembunyi)
 *                        & daftar berkas halaman untuk disalin (lms-shell-cache)
 *  - fetch             : salinan halaman untuk dibuka tanpa sinyal. Selalu
 *                        jaringan dulu; salinan hanya dipakai bila jaringan
 *                        gagal. /api/, permintaan non-GET, dan domain lain
 *                        tidak pernah disentuh, jadi data tetap dari server.
 * ===================================================================*/
'use strict';

const ICON = 'assets/icons/icon-192.png';
const BADGE = 'assets/icons/badge-72.png';
const SHELL = 'lms-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith('lms-shell-') && n !== SHELL).map(n => caches.delete(n)));
  await self.clients.claim();
})()));

/* ---------------- Salinan halaman (offline) ---------------- */
function shellable(url) {
  return url.origin === self.location.origin && !/\/api\//.test(url.pathname);
}
async function fromNetwork(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic' && !res.redirected) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!shellable(url)) return;
  event.respondWith(fromNetwork(req));
});
async function precache(urls) {
  const cache = await caches.open(SHELL);
  await Promise.all(urls.slice(0, 250).map(async (u) => {
    try {
      const url = new URL(String(u), self.registration.scope);
      if (!shellable(url) || await cache.match(url.href)) return;
      const res = await fetch(url.href, { cache: 'no-cache' });
      if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(url.href, res);
    } catch (e) { /* lewati berkas yang gagal */ }
  }));
}

const scopeUrl = (path) => new URL(path, self.registration.scope).href;
const isDashboard = (c) => { try { return /\/dashboard\.html$/.test(new URL(c.url).pathname); } catch (e) { return false; } };
// Chromium tidak mewajibkan notifikasi bila ada tab situs yang sedang fokus; Safari & Firefox mewajibkan.
const chromium = /Chrome|Chromium|Edg\//.test(self.navigator.userAgent || '') && !/Firefox/.test(self.navigator.userAgent || '');

function parse(data) {
  if (!data) return {};
  try { return data.json() || {}; } catch (e) {
    try { return { title: 'Notifikasi baru', body: data.text() }; } catch (e2) { return {}; }
  }
}

function show(p) {
  const title = String(p.title || 'Notifikasi baru').slice(0, 120);
  const icon = p.icon && /^\S{1,8}$/u.test(p.icon) ? p.icon + ' ' : '';
  return self.registration.showNotification(title, {
    body: (icon + String(p.body || '')).trim().slice(0, 400) || (p.app || 'LMS Rubela'),
    icon: scopeUrl(ICON),
    badge: scopeUrl(BADGE),
    tag: p.id ? 'lms-' + String(p.id).slice(0, 100) : undefined,
    timestamp: Number(p.ts) || Date.now(),
    lang: 'id',
    data: { link: p.link || '', id: p.id || '' }
  });
}

self.addEventListener('push', (event) => {
  const p = parse(event.data);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.filter(c => c.focused && isDashboard(c));
    // Dashboard sedang dibuka & fokus: cukup minta tab menyinkron (ucapan muncul di aplikasi).
    if (chromium && focused.length && p.id) {
      focused.forEach(c => c.postMessage({ type: 'lms-push', payload: p }));
      return;
    }
    wins.filter(isDashboard).forEach(c => c.postMessage({ type: 'lms-push', payload: p }));
    await show(p);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const link = /^[a-z0-9-]{1,40}$/i.test(String(d.link || '')) ? d.link : '';
  const nid = /^[A-Za-z0-9_.:-]{1,120}$/.test(String(d.id || '')) ? d.id : '';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const dash = wins.find(isDashboard);
    if (dash) {
      dash.postMessage({ type: 'lms-open', link, id: nid });
      try { await dash.focus(); } catch (e) { /* noop */ }
      return;
    }
    const hash = link ? '#go=' + encodeURIComponent(link) + (nid ? '&nid=' + encodeURIComponent(nid) : '') : '';
    await self.clients.openWindow(scopeUrl('dashboard.html' + hash));
  })());
});

/* Notifikasi lokal dari halaman (tab tersembunyi tanpa langganan push). */
self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'lms-local-notify' && m.payload) event.waitUntil(show(m.payload));
  // Hanya halaman dari origin ini yang dapat mengirim pesan ke service worker.
  if (m.type === 'lms-shell-cache' && Array.isArray(m.urls)) event.waitUntil(precache(m.urls));
});
