# Uji Fitur Ronde 17

Semua perubahan ronde 17 digabung ke commit ronde 15–16 di cabang `feature/lms-website`.
Pengujian memakai `scripts/dev-server.js` (mode lokal dan mode server dengan Turso tiruan)
dan Playwright pada lebar 1366 px dan 390 px.

## Hasil per poin

| # | Permintaan | Perubahan | Hasil uji |
|---|---|---|---|
| 1 | Notifikasi "Ada data baru dari perangkat lain" muncul setiap menyimpan; simpan otomatis tanpa notifikasi dengan waktu simpan | Pantulan perubahan sendiri (simpan, unggah) tidak lagi dianggap "data baru". Perubahan dari perangkat lain dimuat diam-diam (posisi gulir & tab aktif tetap), ditunda selama pengguna mengetik atau membuka dialog. Lencana sinkron menampilkan **"Menyimpan 0.8 detik"** lalu **"Tersimpan 0.5 detik"**. Chip notifikasi dihapus. | Mode server: perangkat sendiri tidak digambar ulang; perangkat lain diperbarui tanpa chip |
| 2 | Mentee yang dimasukkan ke kelas utama tidak otomatis masuk kelas subtest | Pendaftaran mengikuti kelas utama (`via: main`) dibuat saat akun dibuat, saat kelas utama diubah, dan saat kelas subtest menambah/melepas kelas utama. Pendaftaran perorangan tidak ikut dilepas. Formulir pengguna menampilkan kelas subtest yang akan diikuti. Perbaikan data lama sekali saat admin masuk. Mentee tidak dapat mengubah kelas utamanya sendiri (dijaga server). | Mentee baru langsung terdaftar; pindah kelas utama memindahkan pendaftaran |
| 3 | Kelas yang jamnya lewat tidak pindah ke "Selesai"; butuh hapus & batalkan | Fase pertemuan dihitung dari jam selesai (zona waktu LMS). Halaman diperiksa tiap 30 detik dan pertemuan berpindah sendiri ke **Selesai**. Di Selesai: **Batalkan** (dengan alasan, bisa dipulihkan), **Hapus** (presensi sesi itu ikut terhapus, ada **Urungkan**), dan ubah catatan. Tab aktif tidak kembali ke awal saat halaman diperbarui. | Pertemuan berpindah otomatis; batal → pulihkan; hapus → urungkan mengembalikan pertemuan + presensi |
| 4 | War Jadwal responsif & mudah; tiap pertemuan 90 menit | Tutor cukup memilih jam mulai, jam selesai terisi otomatis (+90 menit, ditegakkan server). Tampilan **Tabel** dan **Per hari** (bawaan di ponsel) dengan tombol cepat "＋ PK 16.00" untuk jadwal rutin yang belum diisi. Tombol **＋ Tambah pertemuan** dan **⚡ Isi otomatis** (dengan konfirmasi). Teks panjang lama diganti "Setiap pertemuan berlangsung 90 menit…". Form jadwal rutin kelas juga 90 menit. | 1366 px & 390 px tanpa gulir horizontal |
| 5 | Menu titik tiga (⋯) letaknya salah | Penyebab: animasi masuk kartu dan baris tabel (`fill-mode: both`) meninggalkan `transform`, sehingga panel `position: fixed` menempel ke kartu. Animasi kini `backwards`; posisi panel dikoreksi bila masih ada leluhur ber-transform. Panel mengikuti gulir, dapat dibuka dengan keyboard (Enter, panah). | Menu di tabel Log Presensi & daftar Grup tepat di bawah tombol |
| 6 | Whiteboard: blok & kelompok, gambar bisa diseret, kotak putih dihapus, PDF ukuran asli | Alat Pilih: **seret di area kosong untuk memblok**, Shift+klik menambah, Ctrl+A semua, **Ctrl+G kelompokkan / Ctrl+Shift+G pisahkan** (tombol ⧉/⧈ di toolbar), panah menggeser. Kelompok dipindah dan diubah ukurannya bersama, satu langkah Undo. Gambar yang diunggah menjadi objek yang dapat diseret dan diubah ukurannya tanpa penyok. Latar papan memenuhi layar (tidak ada kotak putih di atas latar abu-abu). Halaman PDF tampil dengan ukuran aslinya; latar PDF tidak lagi terbawa ke halaman lain (penyebab "penyok"); ukuran preset dinonaktifkan di halaman PDF; ekspor tidak memotong tulisan di luar papan. | 15/15 cek (pdf.js tiruan) |
| 7 | Tutor di Course Mandiri untuk menilai & membuat modul | Admin memilih **Tutor course**. Tutor mendapat menu **Course Mandiri**: menyusun bab, pelajaran, kuis, deskripsi, tujuan, persyaratan; tidak dapat mengubah judul, harga, sasaran, pendaftaran, atau daftar tutor (dijaga server). **Nilai esai** 0–100 per soal + umpan balik; mentee mendapat notifikasi dan melihat nilainya. Jawaban & catatan peserta hanya terkirim ke tutor course itu. Esai yang belum dinilai muncul di "Perlu Ditindaklanjuti". | 16/16 cek mode lokal, 12/12 cek mode server |
| 8 | Presensi: tanpa "Hadir" bawaan & "Tersimpan"; bisa batal/ubah; tutor yang tidak mengajar disembunyikan; banyak tutor per pertemuan | Baris kosong sampai ditandai; status dapat diganti atau **dikosongkan** (×, dengan Urungkan). Kelas dengan beberapa pertemuan sehari dipilih per **sesi**. Hanya tutor pengajar sesi itu yang tampil. Satu pertemuan boleh diajar **beberapa tutor** (pilih di form pertemuan). "Isi yang kosong" tidak menimpa yang sudah diisi. **Selesai** mengingatkan baris kosong dan mengirim notifikasi Alfa sekali. Admin dapat mengubah/menghapus dari Log Presensi. | 17/17 cek |
| 9 | Tutor lain dapat mengubah presensi tutor pengajar | Hanya tutor pertemuan itu atau admin yang dapat mengisi/mengubah/menghapus presensinya. Tutor lain melihat lembar terkunci. Dijaga di perangkat dan di server (`checkAttendance`). | Ditolak di UI, DB, dan server |
| 10 | Tabel rencana materi, minggu ke berapa, pengajar; tersambung ke isian "Materi" | Tab **Rencana Materi** di halaman Jadwal: Minggu, Tanggal (rentang minggu dari tanggal mulai kelas), Materi, Pengajar, Pertemuan, Catatan; ubah langsung di tabel, isi dari Materi subtest. Nama materi terdaftar di Materi & Sub Materi subtest dan menjadi pilihan di form pertemuan (terisi otomatis sesuai minggu), whiteboard, materi, dan modul. Pertemuan minggu itu yang materinya kosong ikut terisi. | OK desktop & ponsel |

## Pemeriksaan menyeluruh

- 4 peran × semua menu (128 halaman) × 2 lebar layar: **tanpa error JavaScript**, tidak ada halaman yang meluber.
  Tanda yang tersisa adalah deretan yang memang digeser ke samping (kalender streak, filter kategori).
- Perbaikan tambahan: tab aktif di deretan tab ponsel kini selalu terlihat; teks status presensi terpilih
  tetap terbaca saat disentuh; urutan pertemuan di form whiteboard (field jam salah).

## Uji otomatis

`node scripts/test-api.js` → **214/214 lulus** (tambahan: 22 uji jadwal & presensi, 14 uji tutor Course Mandiri).

## Keterbatasan yang diketahui

- Gambar contoh untuk poin 5 tidak terlampir; penyebab didiagnosis langsung dari kode dan diuji di tabel & grup.
- pdf.js dimuat dari CDN jsDelivr yang tidak terjangkau dari sandbox, jadi impor PDF diuji dengan pdf.js tiruan.
- Penundaan pembaruan saat mengetik (poin 1) diuji lewat kode; uji dua perangkat yang mengetik bersamaan belum dilakukan.
- Domain rubela.biz.id tidak dapat diperiksa dari sandbox.
