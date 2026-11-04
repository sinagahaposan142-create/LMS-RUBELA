/* =====================================================================
 * js/sync-catalog.js — katalog data yang disinkronkan ke server
 * ---------------------------------------------------------------------
 * Dipakai bersama oleh browser (js/sync.js) dan server (api/_lib/*).
 * Setiap kunci localStorage bisnis didaftarkan di sini beserta bentuknya:
 *   records → array objek ber-id (satu baris server per objek)
 *   map     → objek biasa (satu baris server per properti)
 *   doc     → satu nilai utuh (satu baris server)
 * Kunci yang TIDAK ada di katalog tetap lokal per perangkat (tema, sesi,
 * draf tugas, preferensi musik/whiteboard, presence, cooldown, dsb.).
 * ===================================================================*/
(function (root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.LMSSyncCatalog = catalog;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RECORDS = 'records';
  const MAP = 'map';
  const DOC = 'doc';

  const KEYS = {
    lms_users: { type: RECORDS },
    lms_courses: { type: RECORDS },
    lms_materials: { type: RECORDS },
    lms_modules: { type: RECORDS },
    lms_recordings: { type: RECORDS },
    lms_assignments: { type: RECORDS },
    lms_submissions: { type: RECORDS },
    lms_enrollments: { type: RECORDS },
    lms_questions: { type: RECORDS },
    lms_cbts: { type: RECORDS },
    lms_cbt_attempts: { type: RECORDS },
    lms_attendance: { type: RECORDS },
    lms_payments: { type: RECORDS },
    lms_expenses: { type: RECORDS },
    lms_salaries: { type: RECORDS },
    lms_notifications: { type: RECORDS, quiet: false, target: ['userId'] },
    lms_class_plans: { type: RECORDS },
    lms_whiteboards: { type: RECORDS },
    lms_whiteboard_boards: { type: RECORDS, quiet: true },
    lms_motivations: { type: RECORDS },
    lms_security_questions: { type: RECORDS },
    lms_events: { type: RECORDS },
    lms_batches: { type: RECORDS },
    lms_feedbacks: { type: RECORDS },
    lms_announcements: { type: RECORDS },
    lms_messages: { type: RECORDS, target: ['senderId', 'receiverId'] },
    lms_birthday_wishes: { type: RECORDS },
    lms_birthday_rewards: { type: RECORDS },
    lms_activity_log: { type: RECORDS, quiet: true },
    lms_learning_log: { type: RECORDS, quiet: true },
    lms_streak_grants: { type: RECORDS },
    lms_reading_texts: { type: RECORDS },
    lms_verses: { type: RECORDS },
    lms_hub_courses: { type: RECORDS },
    lms_hub_progress: { type: RECORDS, quiet: true },
    lms_capsule_vaults: { type: RECORDS, idField: 'userId', quiet: true },
    lms_capsules: { type: RECORDS, quiet: true },
    lms_music_tracks: { type: RECORDS },
    lms_ai_chats: { type: RECORDS, quiet: true },           // riwayat chat AI pribadi (7 hari)
    lms_settings: { type: MAP },
    lms_birthday_notified: { type: MAP, quiet: true },
    lms_class_options: { type: DOC }
  };

  /** Pengaturan yang berisi rahasia: tidak pernah dikirim ke non-admin. */
  const SECRET_SETTINGS = ['geminiApiKey', 'groqApiKey', 'mistralApiKey', 'openrouterApiKey', 'customAiApiKey', 'tinyfishApiKey',
    'deepseekApiKey', 'kimiApiKey', 'siliconflowApiKey', 'museApiKey', 'freeaiApiKey', 'iteraApiKey', 'patewayApiKey',
    'radoxApiKey', 'kitsoraApiKey'];
  /** Nilai pengganti rahasia untuk non-admin (menandakan "sudah diisi di server"). */
  const MASK = '__server__';

  function has(k) { return Object.prototype.hasOwnProperty.call(KEYS, k); }
  function info(k) { return has(k) ? KEYS[k] : null; }
  function isSecretSetting(name) {
    return SECRET_SETTINGS.indexOf(name) >= 0 || /(api|secret)[_-]?key|token|password|secret/i.test(String(name || ''));
  }
  /** Id baris server untuk sebuah record (null bila tidak valid). */
  function idOf(k, rec) {
    const meta = info(k);
    if (!meta || meta.type !== RECORDS || !rec || typeof rec !== 'object') return null;
    const v = rec[meta.idField || 'id'];
    if (typeof v === 'number' && isFinite(v)) return String(v);
    if (typeof v === 'string' && v.length > 0 && v.length <= 200) return v;
    return null;
  }
  /** Nilai kosong yang dikembalikan getItem untuk kunci tersinkron yang belum berisi. */
  function emptyString(k) {
    const meta = info(k);
    if (!meta) return null;
    if (meta.type === RECORDS) return '[]';
    if (meta.type === MAP) return '{}';
    return null;
  }

  /**
   * JSON kanonik (kunci objek diurutkan). Dipakai untuk membandingkan isi
   * record tanpa terpengaruh urutan properti, di klien maupun server.
   */
  function canon(v) {
    if (v === undefined || typeof v === 'function') return 'null';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (typeof v.toJSON === 'function') return canon(v.toJSON());
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    const keys = Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== 'function').sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  }

  return {
    VERSION: 1,
    RECORDS, MAP, DOC, KEYS, SECRET_SETTINGS, MASK,
    has, info, idOf, emptyString, isSecretSetting, canon,
    /** Batas ukuran satu record (JSON) agar respons server tetap < 4,5 MB. */
    MAX_RECORD_BYTES: 3500000,
    /** Id akun demo bawaan (dipakai saat memindahkan data lama perangkat). */
    DEMO_USER_IDS: ['u_admin', 'u_guru1', 'u_guru2', 'u_guru3', 'u_guru4',
      'u_siswa1', 'u_siswa2', 'u_siswa3', 'u_siswa4', 'u_siswa5', 'u_siswa6', 'u_ortu1', 'u_ortu2']
  };
});
