# Audit Fitur Ronde 8

Cakupan: Streak & gamifikasi, Kampus Danau Rubela, Arena Belajar, Mesin Waktu + F2, musik latar global,
perbaikan chat, Ayat Harian, Course mandiri, serta aktifkan/matikan konten. Diterapkan pada panel Admin
(termasuk akun staf), Tutor, Mentee, dan Orang Tua. Arsitektur tetap HTML/CSS/JS tanpa backend.

## Audit awal
- **Tidak ada fitur Streak API sebelumnya** di repositori (0 kemunculan "streak"). Gamifikasi yang ada hanya poin/level
  dan lencana di `Shared.studentStats`. Streak dibangun dari nol dan poin milestone ikut masuk ke poin leaderboard lama.
- Chat: tinggi panel memakai `clamp(…, 100dvh − topbar − 80px, 900px)` tanpa menghitung ticker & padding, dan di layar
  ≤ 860 px panel kontak (210 px) ditumpuk di atas pesan (≥ 220 px) sehingga kotak ketik terdorong ke luar layar.
- Kelas `alert-warning` dipakai 17 kali tetapi tidak pernah didefinisikan di CSS (kini ditambahkan).

## Migrasi aman (schema v3)
Menambah `religion` dan `streakShare` pada akun, serta konten awal (ayat, 2 Reading Text, 1 course contoh) hanya bila
belum ada. Data lama tidak diubah. Rekaman kini memiliki `createdAt` (cadangan `recordedAt` untuk data lama).

## 5. Streak & gamifikasi (`js/streak.js`, `DB.recordLearning`)
| Aktivitas | Kriteria (divalidasi di lapisan data) |
|---|---|
| Login | sekali per hari; **tidak** menyalakan streak |
| Latihan soal | ≥ 5 soal terjawab, ≥ 30 detik |
| Mini quiz | 5/5 soal terjawab lalu dikumpulkan, ≥ 20 detik |
| Membaca materi | materi kelas/modul/pelajaran course dibuka ≥ 40 detik lalu "Selesai dibaca"; satu materi dihitung sekali |
| Reading Text | waktu baca minimum sesuai panjang teks + semua soal pemahaman dijawab |
| Tryout / CBT | otomatis dari attempt yang dikumpulkan |
| Tugas | otomatis dari pengumpulan tugas |
| Mengikuti kelas | otomatis dari presensi Hadir/Terlambat (sesi dibatalkan tidak dihitung) |
| Target harian | jumlah jenis aktivitas berbeda ≥ target admin |
| Tantangan harian | 1 soal per hari, sama untuk semua mentee |
| Games Area | 1 ronde selesai dengan skor minimal |

Perlindungan: token sesi di memori (durasi dihitung dari token, bukan angka kiriman), duplikasi per hari & per materi,
jeda 15 detik antar-catatan sejenis, batas XP harian, rantai hash per pengguna (catatan diubah/disisipkan ditandai
"Tidak sah" dan tidak dihitung), streak dihitung ulang deterministik dari log (tidak ada angka streak tersimpan),
zona waktu LMS atau pengguna, Streak Freeze otomatis (didapat tiap N hari, stok & batas bulanan diatur admin, pemberian
manual admin tercatat di audit), pengingat notifikasi setelah jam yang diatur admin.

Indikator: current, longest, total hari aktif, total aktivitas, weekly & monthly streak, daily goal, XP & level,
milestone 3/7/14/30/60/100/batch/365 hari (nama, poin, deskripsi dapat diubah). Batch default 174 hari + perpanjangan;
milestone batch & skala pertumbuhan pohon mengikuti total hari.

Visual: SVG ringan (tanpa gambar eksternal), danau dengan animasi gelombang/kilau, lima gedung bergaya menara,
balairung, atap gonjong, gedung modern, dan joglo; pepohonan, taman, jalan setapak, jembatan, air mancur, pulau,
gerbang, aurora; suasana fajar/siang/senja/malam dan cuaca harian (dapat dimatikan). Elemen terbuka sesuai streak
terpanjang; taman meredup saat streak putus. Animasi berhenti saat danau tidak terlihat dan saat *reduce motion*.

Kampus bawaan & sumber: QS World University Rankings 2026 (topuniversities.com). Peringkat UI (#189) dan Unair (#287)
mengikuti pemberitaan rilis QS 2026; peringkat kampus lain sengaja dikosongkan agar admin mengisinya dari sumber resmi.

Statistik: kalender 26 minggu, grafik 60 hari, riwayat aktivitas (cari/filter/tanggal), achievement collection,
leaderboard (metrik/cakupan/jumlah/privasi diatur admin), perbandingan teman sekelas yang sama-sama mengizinkan.
Tutor melihat roster siswa kelasnya; orang tua melihat halaman streak anak (hanya baca).

## 6. Mesin Waktu (`js/timecapsule.js`)
- Kunci data AES-GCM 256-bit acak; dibungkus kunci turunan F2 (PBKDF2-SHA-256, 600.000 iterasi, salt acak) dan kunci
  turunan Recovery Key (125 bit, tampil sekali, wajib dikonfirmasi). F2/Recovery Key tidak disimpan dalam bentuk apa pun.
- Judul, isi rich text, harapan, target, cita-cita, refleksi, nama & isi lampiran dienkripsi; lampiran di IndexedDB.
- Isi surat tidak didekripsi sebelum waktunya; tanggal hanya dapat diundur. Notifikasi saat surat siap dibuka.
- 5 kali salah → kunci 1 menit, bertingkat hingga 60 menit (berlaku juga untuk Recovery Key).
- Pemulihan: verifikasi password akun (dibatasi 3×/menit) + Recovery Key → F2 baru & Recovery Key baru.
  Tanpa Recovery Key: penjelasan konsekuensi, centang pernyataan, ketik "HAPUS PERMANEN" → seluruh surat dihapus.
- Akses data ditolak untuk sesi selain pemilik (admin/tutor/staf/mentee lain). Admin hanya melihat jumlah, tanggal,
  dan ukuran. Editor surat tidak menyediakan tombol AI agar isi tidak dikirim ke layanan luar.
- Terkunci otomatis saat berpindah halaman, setelah 10 menit tidak aktif, saat keluar, dan saat tab ditutup.

## 7. Musik latar (`js/music.js`, `js/idb.js`)
Validasi: ekstensi + MIME + signature (ID3/frame MP3, RIFF/WAVE, OggS), ≤ 15 MB, 5 detik–20 menit, maks 40 lagu,
total ≤ 150 MB, cek kuota browser, konfirmasi hak & jenis lisensi wajib. Admin: unggah, judul, artis, cover, suasana,
edit, ganti berkas, urutkan, aktif/nonaktif, hapus, musik utama, volume bawaan, autoplay, acak, dashboard yang diizinkan.
Pemutar mini: putar/jeda, sebelumnya/berikutnya, bisu, volume, progres (seek), judul, cover, suasana & daftar lagu.
Preferensi per pengguna tersimpan; posisi lagu dilanjutkan setelah reload; tidak restart saat berpindah menu;
autoplay hanya bila diizinkan browser dan pengguna tidak memilih jeda/bisu; berhenti otomatis selama ujian.

## Ayat Harian (`js/verses.js`)
Admin mengelola ayat per agama (rujukan, teks, sumber terjemahan, jadwal tanggal, status tinjauan). Mentee melihat ayat
hari ini di Overview & halaman Ayat Harian sesuai isian Agama (profil, form admin, import/export Excel).
Teks ayat bawaan ditandai **Perlu ditinjau** — mohon verifikasi admin/pemuka agama sebelum dipakai resmi.

## Course mandiri (`js/course-hub.js`)
Terpisah dari kelas bertutor. Admin: informasi, cover, hasil belajar, persyaratan, sasaran (semua/kelas utama/mentee
tertentu), mode pendaftaran, kurikulum bab & pelajaran (artikel, video, PDF, tautan, kuis), drip H+N, aktif/nonaktif,
aktifkan ulang, statistik & pendaftaran peserta. Mentee: katalog dengan pencarian, halaman course, pemutar pelajaran
dengan kurikulum samping, penyelesaian berbasis durasi, kuis dinilai di lapisan data, catatan otomatis, sertifikat.
Orang tua: progres course anak.

## Aktifkan / Matikan
Kelas (admin), materi, modul, rekaman, tugas, CBT/tryout (pembuat atau admin), course & pelajaran (admin). Konten nonaktif
disembunyikan dari siswa & orang tua dan tidak dapat dimulai (termasuk guard di runner ujian), riwayat yang sudah ada tetap
tampil. Kelas & course dapat memakai kebijakan "siswa baru hanya melihat konten yang dibuat setelah bergabung";
konten lama dibuka untuk mereka lewat **Aktifkan ulang** (siswa terkait mendapat notifikasi).

## Pengujian
- Node: token & durasi, duplikasi, deteksi manipulasi log, aktivitas turunan, visibilitas & aktifkan ulang, ayat harian,
  penjagaan akses Mesin Waktu.
- Browser: alur Arena + streak + halaman danau & hotspot; Mesin Waktu (validasi F2, enkripsi tersimpan, penguncian,
  lockout, pemulihan, pembukaan surat, notifikasi, F2 lama ditolak); admin musik (berkas palsu ditolak, unggah WAV,
  pemutar tidak restart saat navigasi, bisu tersimpan, jeda saat ujian), course (buat, ikuti, selesai, kuis, sertifikat),
  ayat, matikan kelas & tryout, pengaturan batch, Streak Freeze; tutor (kontrol aktivasi di tab kelas, roster streak).
- Chat: kotak ketik terlihat tanpa scroll pada 1366×768, 1280×620, 768×1024, 390×844, 360×640 di keempat panel.
- Regresi seluruh menu 4 peran pada 1440×900, 1280×620, 768×1024, 390×844: 0 galat JavaScript, 0 halaman gagal/kosong,
  0 overflow horizontal.

## Batasan yang perlu diketahui
- Tanpa backend, "validasi backend" diwujudkan di lapisan data terpusat (`js/data.js`) + rantai hash. Pengguna yang
  memanipulasi JavaScript di konsol browsernya sendiri tetap dapat memalsukan data lokal; validasi server sesungguhnya
  memerlukan backend.
- Penguncian waktu Mesin Waktu ditegakkan aplikasi; pemilik yang membongkar kode di perangkatnya sendiri secara teori dapat
  mendekripsi lebih awal (kriptografi time-lock memerlukan server).
- Musik & lampiran tersimpan di IndexedDB browser yang mengunggah; perangkat lain memerlukan backend/penyimpanan bersama.
