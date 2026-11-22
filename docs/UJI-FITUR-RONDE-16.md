# Uji Fitur Ronde 16

Semua perubahan ronde 16 digabung ke commit ronde 15 (`f106d36`). Pengujian memakai
`scripts/dev-server.js` (mode lokal & mode server dengan Turso tiruan) dan Playwright
pada lebar 1366 px dan 390 px.

## Hasil per poin

| # | Permintaan | Perubahan | Hasil uji |
|---|---|---|---|
| 1 | Tabel Semua Kelas pecah per huruf; kolom kelas cukup subtest + kelas | Judul kelas tidak lagi memuat nama tutor (dibersihkan saat dibaca dan dirapikan permanen saat admin masuk). Kolom: Kelas, Tutor (avatar), Jadwal, Mentee, Akses, Status, Aksi (Buka + menu ⋯). Sel aksi tabel kembali berupa sel tabel (garis baris tidak terputus). | Desktop & 390 px rapi, tidak ada kata terpecah |
| 2 | Deteksi data ganda | Halaman **Cek Data Ganda** (akun, kelas, soal, teks bacaan, ujian, konten) dengan gabung/hapus/"Bukan ganda". Peringatan langsung di formulir pengguna, kelas, editor soal, impor Excel, soal massal, dan impor PDF/Word (soal ganda dilewati kecuali dicentang). Soal dianggap ganda bila sama atau ≥ 90% mirip pada subtest & teks bacaan yang sama. | Akun bernama sama terdeteksi; impor ulang 5 soal → 5 ganda dilewati |
| 3 | Soal dengan teks bacaan + impor PDF/Word | Teks bacaan dipakai bersama beberapa soal (`lms_passages`). Saat ujian: dua kolom dengan teks menempel di kiri (≥ 1080 px), bisa diciutkan di ponsel. Pembahasan menampilkan teks sekali per kelompok. Soal massal: `TEKS: Judul` … `---`; Excel: kolom "Judul Teks" & "Teks Bacaan"; PDF/Word: mengenali "Bacalah teks berikut untuk soal nomor 1–3" beserta judulnya. | Ujian 7 soal dengan 1 teks: tampil berkelompok; impor dokumen mengenali 2 teks |
| 4 | Tutor hanya bisa memilih satu kelas di "Tambah Rencana Kelas" | Pilihan kelas tampil untuk tutor yang mengajar > 1 kelas; tutor bawaan = tutor yang masuk. | Tutor 2 kelas melihat keduanya |
| 5 | Whiteboard | Judul "Whiteboard Kelas" dihapus. Satu papan per materi/pertemuan berisi judul, materi, pertemuan, pembuat. Papan lama tetap dapat dibuka & diubah. Layar penuh hanya kanvas dengan kontrol mengambang. Impor PDF/gambar menjadi halaman papan. | Impor 1 gambar + PDF 3 halaman → 4 halaman; layar penuh OK |
| 6 | Whiteboard mentee per materi/pertemuan | Daftar papan dengan gambar mini, dikelompokkan "Per pertemuan" atau "Per materi"; mentee dapat membuka halaman lain atau "Ikuti tutor". | Mentee di perangkat lain melihat gambar & coretan tutor |
| 7 | Tutor lebih dari satu subtest | Pilihan chip subtest di formulir tutor (`user.subjects`). | Tersimpan dan tampil di daftar tutor |
| 8 | Mentee belum punya kelas, tutor belum masuk kelas | Kolom "Kelas Diajar"/"Kelas Subtest", filter penempatan, banner peringatan, dan item di Ruang Perhatian. | OK |
| 9 | Pemeriksaan besar + Guru→Tutor, Siswa/Murid→Mentee | 350 teks antarmuka diganti (nilai peran `guru`/`siswa` di data tidak berubah; "Hari Guru Nasional" dan isi soal tetap). Perbaikan: persentase desimal "66.7%" teranimasi menjadi "667%"; deskripsi ujian/materi menjorok & berjarak kosong di ponsel; kartu kelas selalu bertanda "K" (kini kode subtest PK/PU/…); label peran di log presensi. | 127 menu dari 4 peran, masing-masing di 2 lebar layar: tanpa error JavaScript |

## Batas berkas whiteboard (agar database Turso tidak membengkak)

- Berkas masukan ≤ 10 MB; ≤ 15 halaman PDF sekali impor; ≤ 30 halaman per papan.
- Tiap halaman dikompres di browser menjadi JPEG ≤ 1600 px dan ≤ 900 KB.
- Total berkas whiteboard per kelas 8 MB, ditegakkan juga di server.
- Berkas disimpan terpisah (`wb:<kelas>:<papan>:<id>`), bukan di dalam data papan;
  berkas yang tidak dipakai lagi dan berkas papan yang dihapus ikut dihapus.
- Hanya tutor kelas itu dan admin yang dapat mengunggah/menghapus; hanya anggota kelas yang dapat membuka.

## Uji otomatis

`node scripts/test-api.js` → **178/178 lulus** (tambahan: 7 uji teks bacaan, 17 uji whiteboard).

## Keterbatasan yang diketahui

- pdf.js dimuat dari CDN jsDelivr. Di sandbox pengujian CDN tidak terjangkau, jadi impor PDF diuji
  dengan pdf.js tiruan; impor gambar dan alur unggah/unduh berkas diuji sungguhan.
- Domain rubela.biz.id tidak dapat diperiksa dari sandbox.
