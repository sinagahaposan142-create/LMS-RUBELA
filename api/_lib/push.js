'use strict';
/* =====================================================================
 * api/_lib/push.js — Web Push (notifikasi perangkat) tanpa dependensi
 * ---------------------------------------------------------------------
 *  - Enkripsi pesan: RFC 8291 (aes128gcm, RFC 8188) dengan node:crypto.
 *  - Identitas server: VAPID (RFC 8292), JWT ES256.
 *  - Kunci VAPID dibuat otomatis sekali lalu disimpan di tabel meta
 *    (tidak pernah disinkronkan ke klien). Dapat ditimpa lewat env
 *    VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (format base64url seperti
 *    pustaka web-push) dan VAPID_SUBJECT (mailto:… atau https://…).
 *  - Endpoint langganan dibatasi ke layanan push resmi (anti-SSRF).
 * ===================================================================*/
const crypto = require('crypto');

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(String(s || ''), 'base64url')
};

/* Layanan push yang diizinkan (Chrome/Edge/Opera/Samsung → FCM, Firefox → Mozilla,
 * Safari/iOS → Apple, Edge lama → WNS). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/i,
  /^android\.googleapis\.com$/i,
  /^updates\.push\.services\.mozilla\.com$/i,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/i,
  /^web\.push\.apple\.com$/i,
  /^[a-z0-9-]+\.push\.apple\.com$/i,
  /^[a-z0-9-]+\.notify\.windows\.com$/i
];

/** Endpoint langganan valid? (https + host layanan push resmi). */
function validEndpoint(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return false; }
  if (String(raw).length > 1000) return false;
  // Hanya untuk pengujian lokal (scripts/): izinkan push service tiruan di localhost.
  if (process.env.PUSH_TEST_LOCAL === '1' && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true;
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  return PUSH_HOSTS.some(re => re.test(u.hostname));
}

/** Kunci publik klien (p256dh: titik P-256 tak terkompresi 65 byte) & auth (16 byte). */
function validKeys(p256dh, auth) {
  const p = b64u.dec(p256dh), a = b64u.dec(auth);
  return p.length === 65 && p[0] === 4 && a.length === 16;
}

/* ============================ RFC 8291 ============================ */
function hkdf(salt, ikm, info, len) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
}

/**
 * Enkripsi payload untuk satu langganan.
 * @param {Buffer} plaintext
 * @param {{p256dh:string, auth:string}} keys  kunci dari PushSubscription
 * @param {object} [fixed] { salt, asPrivate } — HANYA untuk uji vektor
 * @returns {Buffer} body aes128gcm (header + ciphertext)
 */
function encrypt(plaintext, keys, fixed) {
  const uaPublic = b64u.dec(keys.p256dh);
  const authSecret = b64u.dec(keys.auth);
  const salt = fixed && fixed.salt ? Buffer.from(fixed.salt) : crypto.randomBytes(16);
  const ecdh = crypto.createECDH('prime256v1');
  if (fixed && fixed.asPrivate) ecdh.setPrivateKey(Buffer.from(fixed.asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();                 // 65 byte, tak terkompresi
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'latin1'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0', 'latin1'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0', 'latin1'), 12);

  // Satu record: data || 0x02 (penanda record terakhir), tanpa padding tambahan.
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = 4096;
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(rs, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ct]);
}

/* ============================ VAPID ============================ */
function jwkFromRaw(publicRaw, privateD) {
  const pub = b64u.dec(publicRaw), d = b64u.dec(privateD);
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) return null;
  return { kty: 'EC', crv: 'P-256', x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)), d: b64u.enc(d) };
}
function rawPublicOf(jwk) {
  return b64u.enc(Buffer.concat([Buffer.from([4]), b64u.dec(jwk.x), b64u.dec(jwk.y)]));
}
function generateJwk() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
}

let vapidCache = null;   // { jwk, publicKey, key }

/** Kunci VAPID: env → tabel meta → buat baru (aman bila beberapa instance bersamaan). */
async function vapid(db) {
  if (vapidCache) return vapidCache;
  let jwk = null;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    jwk = jwkFromRaw(process.env.VAPID_PUBLIC_KEY.trim(), process.env.VAPID_PRIVATE_KEY.trim());
  }
  if (!jwk) {
    const read = async () => {
      const rows = await db.query("SELECT value FROM meta WHERE name = 'vapid_jwk'");
      if (!rows.length) return null;
      try { const j = JSON.parse(rows[0].value); return j && j.d && j.x && j.y ? j : null; } catch (e) { return null; }
    };
    jwk = await read();
    if (!jwk) {
      const fresh = generateJwk();
      await db.run([{ sql: "INSERT INTO meta (name, value) VALUES ('vapid_jwk', ?) ON CONFLICT(name) DO NOTHING", args: [JSON.stringify(fresh)] }]);
      jwk = await read();                         // instance lain mungkin menang lebih dulu
    }
  }
  if (!jwk) throw new Error('Kunci VAPID tidak tersedia.');
  vapidCache = { jwk, publicKey: rawPublicOf(jwk), key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }) };
  return vapidCache;
}

/** Header Authorization VAPID untuk satu origin layanan push. */
function vapidHeader(v, audience, subject, now) {
  const header = b64u.enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.enc(JSON.stringify({ aud: audience, exp: Math.floor((now || Date.now()) / 1000) + 12 * 3600, sub: subject }));
  const unsigned = header + '.' + claims;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: v.key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${v.publicKey}`;
}

function subjectFor(req) {
  const env = String(process.env.VAPID_SUBJECT || '').trim();
  if (/^(mailto:|https:\/\/)/i.test(env)) return env;
  const host = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) && !/^(localhost|127\.)/i.test(host)) return 'https://' + host;
  return 'mailto:admin@rubela.edu';
}

/* ============================ Kirim ============================ */
/**
 * Kirim satu pesan. Mengembalikan { status, gone } — gone = langganan tidak berlaku (hapus).
 */
async function sendOne(v, sub, payload, opts) {
  const o = opts || {};
  const body = encrypt(Buffer.from(JSON.stringify(payload)), { p256dh: sub.p256dh, auth: sub.auth });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 6000);
  try {
    const aud = new URL(sub.endpoint).origin;
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        TTL: String(o.ttl || 86400),
        Urgency: o.urgency || 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: vapidHeader(v, aud, o.subject || 'mailto:admin@rubela.edu')
      },
      body,
      signal: ctrl.signal
    });
    try { await res.arrayBuffer(); } catch (e) { /* abaikan isi respons */ }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { status: 0, ok: false, gone: false, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Jalankan tugas dengan batas konkurensi & tenggat keseluruhan. */
async function pool(jobs, limit, deadlineMs) {
  const out = new Array(jobs.length);
  const stopAt = Date.now() + deadlineMs;
  let i = 0;
  const worker = async () => {
    while (i < jobs.length && Date.now() < stopAt) {
      const idx = i++;
      try { out[idx] = await jobs[idx](); } catch (e) { out[idx] = { ok: false, status: 0, error: 'exception' }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return out;
}

const clip = (v, n) => (typeof v === 'string' ? v : (v == null ? '' : String(v))).replace(/\s+/g, ' ').trim().slice(0, n);

/** Isi pesan push dari record notifikasi LMS (tanpa data sensitif tambahan). */
function payloadOf(n, appName) {
  return {
    v: 1,
    id: clip(n.id, 120),
    title: clip(n.title, 120) || 'Notifikasi baru',
    body: clip(n.body, 400),
    icon: clip(n.icon, 8),
    link: /^[a-z0-9-]{1,40}$/i.test(String(n.link || '')) ? n.link : '',
    app: clip(appName, 60) || 'LMS Rubela',
    ts: Number(n.createdAt) || Date.now()
  };
}

module.exports = {
  b64u, validEndpoint, validKeys, encrypt, vapid, vapidHeader, subjectFor, sendOne, pool, payloadOf,
  _internals: { jwkFromRaw, rawPublicOf, generateJwk, resetCache: () => { vapidCache = null; } }
};
