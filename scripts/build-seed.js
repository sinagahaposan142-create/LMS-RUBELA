'use strict';
/* =====================================================================
 * Membangun api/_lib/seed-base.json: data dasar untuk database server
 * yang baru (pengaturan bawaan, bank soal verifikasi login, kata
 * motivasi, ayat, reading text, course mandiri contoh).
 * TIDAK memuat akun/kelas/nilai demo. Jalankan: node scripts/build-seed.js
 * ===================================================================*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] || null,
  get length() { return store.size; }
};
const ctx = { localStorage, console, Date, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'), ctx, { filename: 'data.js' });

const BASE_KEYS = ['lms_settings', 'lms_security_questions', 'lms_motivations', 'lms_verses', 'lms_reading_texts', 'lms_hub_courses'];
const out = { version: 1, generatedAt: new Date().toISOString().slice(0, 10), keys: {} };
BASE_KEYS.forEach(k => { out.keys[k] = JSON.parse(store.get(k)); });

const file = path.join(ROOT, 'api/_lib/seed-base.json');
fs.writeFileSync(file, JSON.stringify(out) + '\n');
console.log('seed-base.json:', Object.entries(out.keys).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : Object.keys(v).length}`).join(', '));
