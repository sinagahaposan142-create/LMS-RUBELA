# Server & Sinkronisasi Lintas Perangkat

Dokumen ini menjelaskan cara LMS Rubela menyimpan data di server sehingga perubahan dari satu
perangkat terlihat di perangkat lain, beserta aturan akses dan cara perawatannya.

## Ringkasan

| Bagian | Teknologi | Peran |
|---|---|---|
| Hosting halaman | Vercel (statis, tanpa build) | `index.html`, `dashboard.html`, `css/`, `js/` |
| API | 1 Vercel Function: `api/rubela.js` (Node.js, tanpa dependensi npm) | login, kuis login, registrasi, sinkronisasi, berkas, proxy AI |
| Database | Turso (libSQL) lewat protokol HTTP resmi (`/v2/pipeline`) | semua data LMS, hash password, sesi |
| Sinyal realtime (opsional) | Supabase Realtime Broadcast (publishable key) | memberi tahu perangkat lain agar segera menarik data |
| Cache perangkat | IndexedDB (`lms_rubela_sync`) | data tetap terbuka cepat & bisa dipakai saat offline |

Tidak ada password, token database, atau service key di repositori. Kunci Supabase di
`js/sync-config.js` adalah *publishable key* yang memang untuk browser dan hanya dipakai untuk sinyal
"ada perubahan" (tanpa isi data).

## Konfigurasi Vercel

| Env | Wajib | Keterangan |
|---|---|---|
| `TURSO_DATABASE_URL` | ya | dibuat otomatis saat database Turso di-*Connect Project* (prefiks kustom juga dikenali, mis. `STORAGE_TURSO_DATABASE_URL`) |
| `TURSO_AUTH_TOKEN` | ya | token database Turso |
| `ADMIN_INITIAL_PASSWORD` | tidak | password admin awal (≥ 10 karakter) **hanya** dipakai saat database pertama kali dibuat; bila kosong dipakai password awal yang hash-nya tertanam di `api/_lib/store.js` |
| `ADMIN_RESET_PASSWORD` | tidak | darurat bila password admin hilang: isi (≥ 10 karakter), redeploy, masuk sebagai `admin`, ganti password, lalu **hapus env ini** dan redeploy lagi |

Setelah env diubah, lakukan **Redeploy** (env hanya berlaku untuk deployment baru).
Cek status: `GET /api/rubela?action=health` → `configured`, `ready`, region database & fungsi.

Untuk performa, samakan *Function Region* Vercel dengan region database (mis. Turso
`aws-ap-northeast-1` → Vercel `hnd1`). Kartu **Pengaturan → Server & Sinkronisasi** menampilkan
saran ini bila keduanya berbeda.

## Data awal

Saat tabel kosong, server membuat:
- akun `admin` (id `u_admin`) — password diberikan terpisah kepada pemilik, bukan di repositori;
- data dasar dari `api/_lib/seed-base.json`: pengaturan bawaan, 116 soal verifikasi login, kata
  motivasi, ayat harian, 2 reading text, 1 course mandiri contoh.

Akun/kelas/nilai demo **tidak** dibuat di server. Data yang dulu dibuat di browser (mode lokal)
dicadangkan otomatis ke IndexedDB perangkat itu; admin dapat mengunduhnya (.json) atau
memindahkannya ke server lewat **Pengaturan → Server & Sinkronisasi** (opsi melewati data contoh;
akun berpassword contoh seperti `guru123` diberi password acak baru).

## Cara kerja sinkronisasi

- Kode aplikasi tetap memakai `localStorage.getItem/setItem`. `js/sync.js` menyadap kunci yang
  terdaftar di `js/sync-catalog.js`: nilainya disimpan di memori + IndexedDB, bukan localStorage,
  sehingga tidak terkena batas 5 MB.
- Setiap kunci dipecah per record (`records` = array ber-id, `map` = per properti, `doc` = utuh).
  Perubahan lokal dihitung per record lalu dikirim sebagai `put` / `patch` (hanya field yang
  berubah) / `del`. Server menggabungkan patch ke versi terbaru di dalam transaksi Turso, jadi dua
  orang yang mengubah field berbeda pada record yang sama tidak saling menimpa.
- Setiap baris server punya `ver` (urutan perubahan global) dan `seq` (urutan pembuatan). Perangkat
  menyimpan `cursor` dan hanya menarik baris dengan `ver > cursor`. Perangkat baru menarik penuh
  per halaman (maks. ±3 MB per respons).
- Jadwal tarik: segera setelah ada perubahan lokal (±0,5 dtk), saat ada sinyal realtime, saat tab
  kembali aktif/online, dan berkala: 7 dtk (tanpa realtime), 25 dtk (dengan realtime), 60 dtk (tab
  tersembunyi). Status tampil di topbar: *Tersinkron / Menyimpan / Offline / Gagal sinkron*.
- Saat offline, perubahan disimpan di IndexedDB dan dikirim ketika koneksi kembali.
- Halaman ringkasan (Overview, Notifikasi, Pengumuman, Kalender, Online) diperbarui otomatis;
  halaman lain menampilkan tombol **Muat ulang** agar isian yang sedang diketik tidak hilang. Chat
  dan whiteboard memperbarui isinya sendiri secara langsung.
- Berkas besar (audio musik latar, lampiran terenkripsi Mesin Waktu) diunggah per bagian ±768 KB ke
  tabel `blobs` dan disimpan juga di IndexedDB sebagai cache.

## Aturan akses (ditegakkan server)

| Data | Admin | Guru | Siswa | Orang tua |
|---|---|---|---|---|
| Akun (`lms_users`) | semua | ubah profil sendiri* | ubah profil sendiri* | ubah profil sendiri* |
| Pengaturan | semua | hanya kunci/model AI | — | — |
| Konten kelas, soal, CBT, presensi, jadwal, whiteboard, pengumuman, kalender | semua | ya | baca | baca |
| Keuangan (pembayaran) | semua | baca siswa binaan | baca milik sendiri | baca milik anak |
| Pengeluaran, log aktivitas | semua | — | — | — |
| Gaji | semua | baca milik sendiri | — | — |
| Pesan chat | hanya percakapan sendiri | sendiri | sendiri | sendiri |
| Notifikasi | buat untuk siapa pun; baca/ubah milik sendiri | sama | sama | sama |
| Pengumpulan tugas | semua | semua | milik sendiri (isi tugas siswa lain disamarkan) | milik anak |
| Hasil CBT | semua | semua | milik sendiri + memperbarui skor cohort | memperbarui skor cohort |
| Mesin Waktu (terenkripsi) | statistik & hapus | — | milik sendiri | — |

\* Field `role`, `username`, `status`, `childIds`, `salaryRate` tidak dapat diubah selain oleh admin.
Password yang diisi di form mana pun dikirim sekali ke server, di-hash (scrypt), lalu dihapus dari
data. Mengganti password mengeluarkan sesi lain akun tersebut. Akun berstatus *Dikeluarkan* tidak
dapat masuk dan sesinya diakhiri. Server menolak menghapus/menurunkan admin aktif terakhir.

Pembatas percobaan: 8 kali gagal per username / 15 menit, 40 per IP / 15 menit, registrasi 10 per IP /
jam, verifikasi password 5 kali / 10 menit. Kuis login memilih soal dan memeriksa jawaban di server.

## Keterbatasan yang perlu diketahui

- Jawaban & kunci soal CBT masih dimuat ke browser (penilaian & skor cohort dihitung di perangkat).
  Siswa yang paham DevTools dapat melihat kunci jawaban; untuk ujian berisiko tinggi perlu penilaian
  di server.
- Password kelas (Jelajah Kelas) masih terlihat oleh pengguna yang masuk.
- Notifikasi ulang tahun dapat terkirim dua kali bila dua perangkat membuka dashboard pada detik yang
  sama.
- Vercel Hobby ditujukan untuk penggunaan non-komersial dan punya kuota pemanggilan fungsi; tiap tab
  aktif melakukan ±2–9 permintaan per menit. Supabase gratis menjeda proyek yang tidak aktif 7 hari
  (sinyal realtime berhenti; sinkronisasi berkala tetap jalan).

## Pengembangan & pengujian lokal

```bash
node scripts/dev-server.js                 # mode server + database tiruan (node:sqlite), port 8777
DB_FILE=.dev/rubela.db node scripts/dev-server.js
RT_URL=http://127.0.0.1:8791 node scripts/dev-server.js   # sinyal realtime ke server Phoenix lokal
node scripts/dev-server.js --local         # mode lokal (tanpa backend)
node scripts/build-seed.js                 # bangun ulang api/_lib/seed-base.json dari js/data.js
```

`scripts/mock-turso.js` meniru protokol Turso (`/v2/pipeline`: execute, batch berkondisi, baton
transaksi) di atas `node:sqlite`, sehingga kode server yang sama dengan produksi dapat diuji tanpa
koneksi internet.
