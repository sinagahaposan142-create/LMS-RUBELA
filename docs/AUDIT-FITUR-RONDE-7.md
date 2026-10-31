# Audit Fitur Ronde 7

Ruang lingkup: whiteboard profesional, pencarian global, persentase kehadiran, dan perayaan ulang tahun,
diterapkan ke panel Admin, Tutor (guru), Mentee (siswa), dan Orang Tua. Arsitektur tetap HTML/CSS/JS
tanpa backend; seluruh data di `localStorage`.

> Catatan: permintaan menyebut "tujuh fitur", tetapi yang dirinci hanya empat. Empat fitur itulah yang dikerjakan.

## Migrasi data yang aman
- Kunci baru `lms_schema_version` (versi 2) dengan `runMigrations()` yang idempoten: hanya menambah field
  yang belum ada (`birthDate`, `photo`), tidak pernah menghapus data. Seed lama (`lms_seeded_v6`) tidak diubah
  sehingga data pengguna tidak di-reset.
- Whiteboard v1 (goresan berkoordinat 0..1) dikonversi di memori ke v2 (objek berkoordinat px papan) dan baru
  ditulis ulang saat editor menyimpan. Pengguna baca-saja tidak pernah menulis data.
- Status presensi baru `terlambat` (dihitung hadir). `upsertAttendance` menolak status yang tidak dikenal.

## 1. Whiteboard (`js/whiteboard.js`)
| Kebutuhan | Implementasi |
|---|---|
| Full screen / minimize | Fullscreen API pada kartu; cadangan mode maksimal CSS; tombol minimalkan/pulihkan |
| Ukuran papan & kanvas diperluas | Preset 16:9, 4:3, persegi, A4 tegak/mendatar; "Tambah ke bawah/kanan" (+50%, maks 8000 px) |
| Zoom in/out/fit | Tombol, Ctrl+scroll di posisi kursor, tombol `+ − 0`; geser dengan ✋, spasi+seret, tombol tengah |
| Toolbar minimal & dapat dipindah | Palet mengambang dengan pegangan ⠿ (posisi disimpan per pengguna) atau ditempel di atas |
| 10 alat tulis | Pena, pena halus, kuas (lebar mengikuti kecepatan/tekanan), spidol, stabilo (transparan), kaligrafi (ujung 45°), pensil (tekstur deterministik), penghapus (goresan/per objek), laser (sementara, disiarkan ke tab lain, tidak disimpan), bentuk (garis, panah, persegi, elips, segitiga; Shift = proporsional) |
| Pengaturan | Pemilih warna, palet preset + kustom (8), ketebalan, opasitas, tekanan stylus (`PointerEvent.pressure`), solid/putus/titik, bold, font & ukuran & warna teks, isi bentuk |
| Fitur belajar | Undo/redo semua jenis objek (alias id menjaga rantai undo setelah pemulihan), hapus satu/semua, pilih-pindah-ubah ukuran, teks, gambar (dikompres), tabel (klik ganda untuk isi sel), template kotak/titik/garis/milimeter, garis bantu |
| Ekspor | PNG (resolusi hingga 2×, maks 8192 px), PDF lewat dialog cetak |
| Simpan | Autosave ≤1 detik, versi otomatis tiap ±5 menit + versi manual (maks 15), papan bernama (maks 20), buka/pulihkan dapat di-undo |
| Performa | Objek selesai dirender ke kanvas cache; selama menggambar hanya goresan aktif yang digambar ulang via rAF; culling objek di luar layar; titik rapat dibuang |
| Sinkron | BroadcastChannel + event `storage`, tombstone `deletedIds`, `clearEpoch`, penggabungan per objek berdasarkan `updatedAt`, antrean update saat sedang menggambar |
| Hak akses | `DB.saveWhiteboard`/`addWhiteboardSave` menolak non-admin/non-tutor kelas; siswa & orang tua mode baca (zoom, geser, ekspor) |

## 2. Pencarian global (`js/data-search.js`)
Komponen bersama memindai **seluruh** dataset yang boleh diakses peran (bukan hanya baris tampil): multi-kata,
parsial, tanpa beda huruf/aksen, sorotan hasil, filter, rentang tanggal, urutan, tombol ✕/Reset, debounce 220 ms,
pagination atas hasil. Karena tidak ada server, pencarian berjalan di browser terhadap data lengkap peran tersebut.

| Halaman | Panel |
|---|---|
| Bank Soal (isi soal, opsi, pembahasan, kunci, kata kunci, pernyataan, pasangan, subtest, tipe, tingkat, penulis; lintas subtest) | Admin, Tutor |
| Kelola Siswa / Guru / Orang Tua, Admin & Staff | Admin |
| Semua Kelas (judul, subtest, tutor, kelas utama, jadwal, deskripsi) | Admin |
| CBT / Ujian, Hasil Tryout per ujian | Admin, Tutor, Siswa |
| Jadwal (hari ini/akan datang/selesai, rencana & riwayat) | Admin, Tutor, Siswa, Orang Tua |
| Materi kelas, Modul (isi bagian ikut tercari) | Tutor, Siswa |
| Tugas & Pengumpulan, Nilai | Tutor (penilaian), Siswa, Orang Tua |
| Log Presensi (tanpa batas 200), Riwayat Kehadiran | Admin, Tutor, Siswa, Orang Tua |
| Keuangan: pemasukan, pengeluaran, gaji; Pembayaran | Admin, Siswa |
| Kritik & Saran (nama pengirim anonim tidak diindeks) | Semua |
| Notifikasi & Riwayat Aktivitas | Semua (riwayat aktivitas khusus admin) |
| Moderasi & ucapan Birthday Wall | Admin, semua |

## 3. Persentase kehadiran (`DB.attendanceSummary`, `js/attendance-insights.js`)
- Rumus tunggal di semua panel: **(hadir + terlambat) ÷ total sesi terlaksana × 100%**.
- Sesi pada tanggal yang rencananya **dibatalkan** tidak masuk penyebut.
- Izin/sakit ditampilkan terpisah; kebijakan admin: tetap dihitung (default) atau dikeluarkan dari penyebut.
- Ambang standar (default 75%) diatur di Pengaturan → Kebijakan Kehadiran; di bawah ambang muncul peringatan.
- Tampilan: circular progress, progress bar, grafik bulanan & semester, statistik per kelas, riwayat per bulan,
  riwayat lengkap dengan pencarian. Filter periode (30 hari, 3 bulan, semester, tahun) dan kelas.
- Siswa: Presensi Saya + tab presensi kelas. Orang tua: Kehadiran anak. Tutor: Kehadiran Mengajar (bulanan/semester)
  + Rekap Siswa kelas yang diampu. Admin: Rekap Siswa & Rekap Guru dengan filter kelas/tingkat dan detail per orang.

## 4. Ulang tahun (`js/birthday.js`)
- Deteksi dari tanggal lahir (29 Februari dirayakan 28 Februari pada tahun non-kabisat).
- Notifikasi otomatis sekali per tahun ke siswa, orang tua, tutor kelas, dan teman sekelas (idempoten).
- Banner + confetti di Overview (sekali per sesi per hari; mati bila *reduce motion*); bingkai foto & mahkota.
- Birthday Wall: daftar hari ini / 7 hari terakhir / 30 hari ke depan, profil, kartu ucapan (5 templat, 12 stiker,
  pesan cepat, pratinjau). Ucapan dibuka 7 hari sebelum hingga 7 hari sesudah ulang tahun, satu per penulis per teman per tahun.
- Hanya siswa, tutor, dan admin yang dapat menulis; orang tua hanya melihat; tidak bisa menulis untuk diri sendiri.
- Hadiah: animasi membuka kado, poin (0–1000, diatur admin, buku besar 1×/tahun), Birthday Badge, pesan khusus admin.
- Moderasi: mode langsung tampil atau persetujuan admin; laporan pesan (≥3 laporan otomatis disembunyikan);
  antrean moderasi admin dengan pencarian & filter; penulis dapat menghapus ucapannya.

## Pengujian
- Uji data (Node): rumus kehadiran & kebijakan izin, sesi dibatalkan, validasi status, jendela ucapan
  (−10/−7/−3/0/+3/+7/+8 hari), duplikasi & izin ucapan, moderasi, hadiah sekali, batas versi whiteboard,
  cascade hapus kelas, log aktivitas tanpa membocorkan API key.
- Uji browser per fitur: pencarian/filter/reset/pagination, validasi tanggal lahir, roster & detail kehadiran,
  pengaturan, Birthday Wall (kirim, sembunyikan, laporkan, buka kado, poin bertambah), Admin & Staff,
  whiteboard (10 alat, undo/redo/rantai pemulihan, pindah, hapus, teks, tabel, template, perluas, zoom, simpan/buka,
  papan baru, ekspor PNG, minimalkan, layar penuh, migrasi v1, sinkron storage, mode baca), panel orang tua.
- Regresi navigasi seluruh menu 4 peran pada 1440×900, 768×1024, 390×844, dan admin 1280×620:
  0 galat JavaScript, 0 halaman gagal/kosong, 0 overflow horizontal.

## Batasan yang perlu diketahui
- Tanpa backend: sinkron realtime hanya antar-tab/jendela pada browser yang sama; lintas perangkat butuh server realtime.
- "Pencarian server-side" diwujudkan sebagai pemindaian seluruh dataset peran di browser.
- Gambar whiteboard & foto profil dikompres, tetapi tetap memakan kuota `localStorage` (±5 MB per browser).
