/* =====================================================================
 * sw.js — Service Worker LMS Rubela (notifikasi perangkat / Web Push)
 * ---------------------------------------------------------------------
 * Hanya menangani notifikasi. TIDAK ada cache/fetch handler, sehingga
 * halaman & data selalu diambil langsung dari server seperti biasa.
 *  - push              : tampilkan notifikasi sistem (Windows/macOS/Android/iOS)
 *  - notificationclick : buka/fokuskan dashboard ke halaman terkait
 *  - message           : notifikasi lokal dari halaman (mode lokal / tab tersembunyi)
 * ===================================================================*/
'use strict';

const ICON = 'assets/icons/icon-192.png';
const BADGE = 'assets/icons/badge-72.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
});
