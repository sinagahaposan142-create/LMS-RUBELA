/* =====================================================================
 * js/sync-config.js — konfigurasi publik sinkronisasi LMS Rubela
 * ---------------------------------------------------------------------
 * Aman untuk publik: TIDAK berisi password, token database, atau
 * service key. Kunci Supabase di bawah adalah *publishable key* yang
 * memang dirancang untuk browser; dipakai hanya untuk sinyal realtime
 * (Broadcast) agar perubahan segera terlihat di perangkat lain.
 * Data LMS disimpan di database Turso melalui /api/rubela (Vercel).
 * ===================================================================*/
window.LMS_SYNC_CONFIG = {
  api: '/api/rubela',
  supabaseUrl: 'https://igoaoenjrwtozbesustk.supabase.co',
  supabaseKey: 'sb_publishable_ZzbBKqYIdIC1lMa6a8AnRA_I_y-ii_W',
  realtimeTopic: 'lms-rubela-sync-v1',
  realtime: true
};
