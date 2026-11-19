# Arsitektur Penyimpanan LMS Rubela

Dokumen ini menjelaskan di mana setiap jenis data disimpan, kenapa, dan apa yang
perlu diperhatikan saat jumlah pengguna atau berkas bertambah.

## Ringkasan

| Jenis data | Disimpan di | Keterangan |
|---|---|---|
| Data terstruktur (akun, kelas, soal, nilai, chat, course, pembayaran) | Turso, tabel `kv` | Satu baris per record (`k`, `id`, `v` JSON, `ver`). Diakses lewat `/api/rubela`, aturan akses di `api/_lib/rules.js`. |
| Berkas kecil (QRIS, bukti transfer, lampiran Mesin Waktu, musik) | Turso, tabel `blobs` + `blob_meta` | Dipecah per ~800 KB. Kebijakan per awalan kunci di `blobPolicy` (`api/_lib/handlers.js`). |
| Sesi, password (hash), langganan push, kuota login | Turso, tabel `sessions`, `auth`, `push_subs`, `throttle` | Tidak pernah dikirim ke peramban. |
| Cache di perangkat | `localStorage` + IndexedDB | Salinan data server agar aplikasi cepat dan tetap terbuka saat sinyal putus. Bukan sumber kebenaran. |
| Kode aplikasi | Vercel (statis + satu Function) | Tidak menyimpan data pengguna. |

## Kenapa Vercel saja tidak cukup

Vercel Function berjalan *serverless*: setiap permintaan bisa dilayani instans baru,
dan sistem berkasnya hanya-baca kecuali `/tmp` yang sementara dan hilang saat instans
berhenti. Vercel sendiri menyatakan SQLite berbasis berkas tidak cocok di Functions
karena penyimpanannya *ephemeral*
([Vercel KB](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)).
Jadi data harus ada di layanan terpisah: di proyek ini Turso.

## Kenapa `localStorage` saja bermasalah

- Hanya ada di satu peramban. Guru di laptop dan siswa di ponsel tidak melihat data yang sama.
- Bisa terhapus kapan saja (bersihkan data situs, mode penyamaran, Safari menghapus data situs yang lama tidak dibuka).
- Kuota sekitar 5–10 MB per situs, tidak cukup untuk gambar.
- Tidak ada aturan akses: siapa pun yang memegang perangkat bisa mengubah nilainya lewat DevTools.
  Karena itu semua aturan (siapa boleh membaca/menulis apa) ditegakkan di server, bukan di peramban.

Di LMS Rubela, `localStorage` dipakai sebagai **cache** yang disadap `js/sync.js`:
setiap perubahan pada kunci katalog (`js/sync-catalog.js`) dikirim ke server, dan
server bisa menolak atau mengoreksinya.

### Audit kunci `localStorage` di luar katalog sinkron

Semua kunci `lms_*` di luar katalog adalah preferensi, cache, atau penanda perangkat.
Tidak ada data bisnis yang hanya tinggal di peramban:

- Preferensi tampilan: `lms_theme`, `lms_timezone`, `lms_sidebar_collapsed`, `lms_modal_full`, `lms_wb_pref`, `lms_music_pref`, `lms_music_pos`, `lms_game_prefs`, `lms_holiday_prefs`, `lms_push_prefs`
- Cache: `lms_holiday_cache`, `lms_mathpad_hist` (riwayat rumus), `lms_yt_progress` (posisi terjauh video, hanya untuk kenyamanan; pembatasan lompat maju tetap berjalan meski cache kosong)
- Draf yang belum dikirim: `lms_assignment_draft:*` (hilang dari perangkat setelah tugas dikirim)
- Sesi & mesin sinkron: `lms_session` (token sesi), `lms_rubela_sync`, `lms_sync_*`, `lms_presence_*`, `lms_seeded_v*`, `lms_schema_version`
- Penanda lokal: `lms_login_quiz_block`, `lms_streak_reminded`, `lms_bd_confetti`

## Migrasi data lama dari `localStorage` ke server

Sudah tersedia di `js/sync.js` (`Sync.legacy`):

1. Saat sebuah perangkat pertama kali membuka aplikasi dalam mode server, data lama di
   `localStorage` dipindahkan ke cadangan IndexedDB di perangkat itu (`backupIfNeeded`),
   lalu dihapus dari `localStorage` agar tidak bercampur dengan data server.
2. Di perangkat yang menyimpan data lama, admin membuka menu pemindahan data lama dan
   menekan **Pindahkan** (`importToServer`). Setiap record tetap melewati aturan server,
   jadi data yang tidak sah ditolak. Akun dengan password contoh diberi password acak baru.
3. Setelah impor, perangkat lain cukup masuk ulang untuk menarik data dari server.

## Variabel lingkungan dan kebocoran ke klien

Variabel yang dibaca server: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD`,
`ADMIN_PASSWORD_LOCK`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

- Tidak ada yang ditulis ke HTML/JS statis. Proyek ini tidak punya langkah build, jadi tidak
  ada mekanisme `NEXT_PUBLIC_*` yang bisa tidak sengaja membocorkan nilai.
- Endpoint `health` hanya mengembalikan status, branding, dan tema hari besar.
- Endpoint `push_key` hanya mengembalikan **kunci publik** VAPID.
- Kunci AI disimpan sebagai pengaturan rahasia; non-admin menerima nilai tersamar (`catalog.MASK`).
- `js/sync-config.js` berisi *publishable key* Supabase yang memang dirancang untuk peramban
  dan hanya dipakai untuk sinyal realtime.

**Perhatian:** `api/_lib/store.js` punya password admin bawaan (`rubela2026`) bila
`ADMIN_PASSWORD` tidak diisi. Karena repositori ini publik, isi `ADMIN_PASSWORD` di
Vercel atau ganti password admin lewat menu profil (server tidak menimpa password yang
sudah diganti lewat UI).

## Berkas: kebijakan per awalan kunci

| Awalan | Baca | Tulis | Hapus | Batas | Isi |
|---|---|---|---|---|---|
| `music:<id>` | semua yang login | admin | admin | 16 MB | bebas |
| `cap:<siswaId>:…` | pemilik | pemilik (siswa) | pemilik, admin | 4 MB | bebas (terenkripsi di klien) |
| `qris:<courseId>:<versi>` | semua yang login | admin | admin | 1,5 MB | PNG/JPG/WEBP |
| `proof:<siswaId>:<payId>` | pemilik, admin | pemilik (siswa), **sekali** | admin | 3 MB | PNG/JPG/WEBP |

- Jenis gambar diperiksa dari byte awal (magic number), bukan dari nama berkas atau tipe yang
  dikirim peramban. Berkas HTML yang menyamar sebagai `image/png` ditolak.
- Bukti transfer tidak dapat ditimpa. Unggahan ulang memakai kunci baru sehingga riwayat
  bukti yang pernah ditolak tetap utuh untuk pemeriksaan admin.
- QRIS memakai kunci berversi (`qris:<courseId>:<waktu>`) agar perangkat lain tidak memakai
  gambar lama dari cache setelah admin menggantinya.
- Gambar dikompres di peramban sebelum diunggah (sisi terpanjang 1600 px, JPEG/WEBP).
- Saat akun dihapus, berkas `cap:<id>:*` dan `proof:<id>:*` ikut dihapus di server.

## Opsi yang dievaluasi

| Opsi | Kelebihan | Kekurangan | Keputusan |
|---|---|---|---|
| **Tetap Turso untuk data + berkas kecil** | Sudah berjalan dan teruji; satu tempat untuk aturan akses; tidak ada layanan atau env baru | Berkas disimpan sebagai base64 (lebih besar ~33%) dan melewati Function (batas body 4,5 MB, jadi dipecah per bagian) | **Dipakai sekarang** |
| Turso + Vercel Blob untuk berkas | Cocok untuk berkas besar/banyak; dikirim lewat CDN | Layanan dan token baru (`BLOB_READ_WRITE_TOKEN`), aturan akses harus diduplikasi (URL publik atau *private blob*), kuota Hobby kecil | Disarankan bila berkas tumbuh besar |
| Dua database (mis. Turso + Postgres) | — | Dua sumber kebenaran, transaksi lintas database tidak mungkin, kompleksitas dan biaya naik tanpa manfaat nyata untuk skala ini | Ditolak |

Angka kuota (periksa ulang sebelum memutuskan, karena bisa berubah):

- Turso: halaman harga resmi [turso.tech/pricing](https://turso.tech/pricing). Menurut ringkasan
  pihak ketiga per 2026, paket gratis mencakup sekitar 5 GB penyimpanan, 500 juta baris dibaca, dan
  10 juta baris ditulis per bulan.
- Vercel Blob: paket Hobby mendapat 1 GB penyimpanan dan 10 GB transfer per bulan
  ([changelog Vercel](https://vercel.com/changelog/vercel-blob-is-now-generally-available));
  operasi lanjutan (`put`, `list`, `copy`) dibatasi sekitar 2.000 per bulan di Hobby
  ([changelog Vercel](https://vercel.com/changelog/unlimited-vercel-blob-stores-on-every-plan)).

Perkiraan untuk fitur pembayaran: satu bukti transfer terkompresi sekitar 150–400 KB.
1.000 bukti ≈ 0,4 GB di Turso. Masih jauh di bawah kuota gratis, sehingga menambah Vercel
Blob sekarang belum sebanding dengan tambahan kerumitan dan risiko kebocoran berkas.

**Kapan pindah ke Vercel Blob:** bila total berkas mendekati 2–3 GB, atau bila ingin
menyimpan video/berkas besar. Langkahnya: tambahkan Blob store di Vercel, buat endpoint
unggah bertanda tangan yang memakai `blobPolicy` yang sama, lalu simpan URL/pathname blob
di record alih-alih kunci `qris:`/`proof:`.

## Risiko yang tersisa

- Turso adalah satu titik kegagalan. Aktifkan cadangan/point-in-time restore sesuai paket.
- Jika Turso tidak terhubung, aplikasi jatuh ke **mode lokal** (data hanya di peramban).
  Status ini ditampilkan di aplikasi; pastikan `TURSO_DATABASE_URL` dan `TURSO_AUTH_TOKEN`
  terisi di Vercel untuk environment Production dan Preview.
