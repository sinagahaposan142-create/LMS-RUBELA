# Notifikasi Perangkat (Web Push)

Siswa, tutor, admin, dan orang tua menerima notifikasi sistem (Windows, macOS, Android, iPhone/iPad)
untuk setiap notifikasi LMS — tugas, nilai, presensi, jadwal, pengumuman, nilai esai, undangan
Game Battle, dan lainnya — **walau situs sedang ditutup**.

## Alur pengguna

1. Setelah masuk, muncul kartu **"Aktifkan notifikasi"**. Satu klik **Aktifkan** → peramban
   menampilkan izin → pilih **Izinkan**. Izin ini diwajibkan semua peramban dan hanya diminta
   sekali per perangkat; situs tidak dapat mengaktifkannya tanpa persetujuan pengguna.
2. Sejak itu otomatis: tiap kali dashboard dibuka, langganan perangkat dipulihkan diam-diam.
3. Klik notifikasi membuka dashboard langsung ke halaman terkait (`dashboard.html#go=…`).
4. Saat dashboard sedang terbuka, notifikasi dari perangkat lain tampil sebagai toast dan lonceng
   diperbarui tanpa muat ulang.

Pengaturan perangkat ada di **Profil → Notifikasi Perangkat** (admin: **Pengaturan**):
status izin, aktifkan/matikan, kirim notifikasi uji. Admin juga dapat mematikan fitur untuk
semua pengguna atau per peran.

## Catatan platform

- **Chrome, Edge, Firefox, Opera, Samsung Internet** (desktop & Android): didukung. Di desktop,
  peramban perlu berjalan (boleh tanpa tab LMS) agar notifikasi muncul.
- **iPhone/iPad**: iOS 16.4+, LMS harus ditambahkan ke Layar Utama (Bagikan → Tambah ke Layar
  Utama) lalu dibuka dari ikon tersebut. Kartu ajakan menampilkan petunjuk ini otomatis.
- Butuh HTTPS (Vercel sudah HTTPS). Mode lokal (tanpa server) hanya dapat menampilkan
  notifikasi selama tab terbuka.
- Bila izin diblokir, buka ikon gembok di bilah alamat → Notifikasi → Izinkan.

## Teknis

| Bagian | Berkas |
|---|---|
| Service worker (hanya notifikasi, tanpa cache) | `sw.js` |
| Klien: izin, langganan, toast, tautan, kartu pengaturan | `js/push.js` |
| Enkripsi RFC 8291 (aes128gcm) + VAPID RFC 8292, tanpa dependensi | `api/_lib/push.js` |
| Aksi API `push_key`, `push_sub`, `push_test`, pengiriman otomatis | `api/_lib/handlers.js` |
| Manifest & ikon aplikasi | `manifest.webmanifest`, `assets/icons/` |

- Pengiriman dipicu di server saat record `lms_notifications` **baru** masuk lewat sinkronisasi
  (setelah commit). Penanda "dibaca" tidak memicu push. Notifikasi lebih tua dari 6 jam diabaikan,
  maksimal 3 pesan per penerima per batch (sisanya diringkas), dan pengirim non-staf dibatasi.
- Kunci VAPID dibuat otomatis sekali dan disimpan di tabel `meta` (tidak pernah dikirim ke klien).
  Opsional: env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (base64url, format pustaka web-push) dan
  `VAPID_SUBJECT` (`mailto:…` / `https://…`).
- Langganan disimpan di tabel `push_subs` (maks. 10 perangkat per akun). Langganan yang ditolak
  layanan push (404/410) dihapus otomatis. Endpoint hanya diterima dari layanan push resmi
  (FCM, Mozilla, Apple, WNS).
- Enkripsi diverifikasi dengan vektor uji resmi RFC 8291 Lampiran A.
