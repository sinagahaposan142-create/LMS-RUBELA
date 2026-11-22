# Uji Fitur Ronde 18

Semua perubahan ronde 18 digabung ke commit ronde 15–17 di cabang `feature/lms-website`.
Pengujian memakai `scripts/dev-server.js` (mode lokal dan mode server dengan Turso tiruan),
`node scripts/test-api.js`, dan Playwright pada lebar 1366 px dan 390 px.

## Hasil per poin

| # | Permintaan | Perubahan | Hasil uji |
|---|---|---|---|
| 1 | CBT Tryout: admin membuat tryout untuk semua mentee (draf), tutor menyetor soal per subtest, admin juga menambah soal, terjadwal tampil di dashboard mentee, draf tidak terlihat mentee | Panel **CBT Tryout** di halaman CBT admin (`js/tryout.js`): nama, deskripsi, jadwal dibuka–ditutup, subtest dengan **target soal** & durasi, penilaian, keamanan → tersimpan **Draf** dan tutor subtest terkait diberi notifikasi. Tutor melihat panel **Tryout: setor soal** di CBT-nya (subtest yang diampu + subtest kelas yang diajar), memilih soal dari Bank Soal atau membuat soal baru; setoran tersimpan di `lms_cbt_contribs` (menunggu tinjauan) dan admin diberi notifikasi. Admin **Kelola soal**: tab per subtest (terkumpul/target), setoran menunggu (Terima, Tolak dengan alasan, Terima semua), soal di tryout (Lepas), tambah/buat soal sendiri. **Terbitkan** sekarang atau pada waktu tertentu, dengan notifikasi ke semua mentee saat tryout tampil; dapat dikembalikan ke draf selama belum ada yang mengerjakan. Mentee melihat kartu **Tryout** di Overview dan daftar CBT. | Mode lokal & server: draf tidak terkirim ke mentee; tutor tidak dapat mengubah tryout (ditolak server, dikembalikan); setoran → terima → terbit → mentee melihat tryout + notifikasi |
| 1a | Pemilih soal halaman penuh, bisa membatalkan pilihan | `js/qpicker.js`: kategori subtest di kiri (jumlah & centang semua per kategori), **Semua soal**, kelompok **Materi › Sub Materi** dengan centang per kelompok, kartu soal (subtest, materi › sub materi, format, tingkat, teks bacaan, "Selengkapnya" untuk pilihan jawaban). Klik kartu/centang untuk memilih atau membatalkan; **Tinjau pilihan** dan **Batalkan semua pilihan**. | Centang kelompok, kategori, semua; batal per soal; tinjau |
| 1b | Tambah soal langsung dengan fitur Bank Soal (PDF, Excel, Word, teks dirapikan AI) | Tombol di pemilih: **+ Soal Baru** (editor), **Buat Massal** (per baris, tempel Excel, buat dengan AI), **Impor Excel/CSV**, **Impor PDF/Word/Teks** (dibantu AI). Soal baru tersimpan di Bank Soal dan langsung dipilih. | Editor tampil di atas pemilih lalu kembali ke pemilih |
| 1c | Keterangan subtest, materi utama, sub bab; pencarian soal & per kategori | Setiap kartu menampilkan subtest dan Materi › Sub Materi; pencarian di subtest aktif atau **di semua subtest**; filter format, tingkat, materi, sub materi, dipilih/belum. | Pencarian lintas subtest & tanpa hasil |
| 2 | Status pendidikan mentee & batas ketidakhadiran (bisa diatur), deteksi otomatis, sanksi denda | Field **Status Pendidikan** di data mentee (form, daftar + filter, Excel impor/ekspor, profil mentee hanya-baca; mentee tidak dapat mengubahnya — dijaga server). **Pengaturan → Kebijakan Kehadiran → Batas ketidakhadiran per status**: Kelas 12, Gap year, Semi gap year dapat diatur; Gap year sambil bekerja tanpa batas & sanksi; periode per bulan atau sepanjang program; status yang dihitung (Alfa, opsional Izin/Sakit); nominal denda per kelebihan atau sekali per periode. **Presensi → Batas & Sanksi** menampilkan mentee yang melewati/tepat di batas dan membuat **tagihan denda** (Keuangan, jenis Denda, alasan "Melebihi batas ketidakhadiran", id tetap per mentee & periode sehingga tidak dobel). Notifikasi Alfa menyebut kelebihan batas; admin diberi tahu. Halaman kehadiran mentee/orang tua dan rekap tutor menampilkan sisa batas. Tabel pembayaran mentee & orang tua menampilkan kolom **Jenis**. | Andi (Kelas 12) Alfa 4× dari batas 3× → ditandai, denda Rp25.000 dibuat sekali; Dewi (gap year bekerja) tanpa batas |
| 3 | Kritik & saran terlihat semua orang | Tujuan **Admin** (hanya admin), **Tutor tertentu** (dipilih dari daftar akun tutor; hanya tutor itu), **Umum** (semua). Tab Kotak Masuk / Terkirim / Umum, balasan oleh penerima, hapus oleh pengirim/penerima/admin. Anonim menyembunyikan pengirim dari semua orang (server tidak mengirim `senderId`). Data lama: "kelas" menjadi umum, "individu" (nama teks bebas) hanya untuk admin. Setiap perangkat menarik ulang datanya sekali setelah pembaruan sehingga salinan lama yang tidak berhak ikut terhapus. | 20 uji API; mode server: mentee & tutor lain tidak menerima masukan ke tutor, tutor penerima tidak melihat identitas anonim |
| 4 | AI Analytics: mentee Alfa 3× tidak muncul; deteksi mentee tidak masuk kelas & tutor tidak membuat jadwal | Penyebab: risiko dihitung dari persentase Alfa (3 dari 30 catatan = 10% < 15% → Normal). Kini dari **jumlah**: Alfa 3× = Warning, 3× dalam 30 hari = lebih tinggi, 5× atau melewati batas status pendidikan = Critical, ditambah ketidakhadiran berturut-turut dan kehadiran di bawah standar; sesi batal tidak dihitung; tutor hanya melihat kelasnya. Tab **Mentee Tidak Hadir** (7/30 hari/semua: Alfa, Izin, Sakit, berturut-turut, terakhir tidak hadir) dan **Jadwal Tutor** (admin: belum pernah membuat jadwal, tanpa jadwal 14 hari ke depan). | Mentee Alfa 4× tampil Critical; kedua tab terisi |
| 5 | Grup belajar: tambah kuis, atur grup, grup baru tertutup lapisan hitam transparan | Penyebab: kelas `.gr-count` milik Main Bareng (`position:absolute; inset:0; latar gelap`) bertabrakan dengan penghitung karakter di dialog grup. Seluruh kelas/id Main Bareng diganti awalan `mbk-`. Juga: pendengar klik dokumen di daftar grup tidak lagi menumpuk. | Dialog dapat diklik di 1366 & 390 px; Main Bareng tetap tampil |
| 6 | Game Battle → Ambil dari Bank Soal: centang semua per kategori & semua soal | Memakai pemilih soal halaman penuh: centang per soal, per materi, per kategori subtest, atau **Semua soal**; soal yang sudah disalin/tidak cocok game dilewati. Ringkasan per subtest di halaman. | 15 soal disalin sekaligus |
| 7 | Layar penuh saat bermain; bug skor | Tombol layar penuh di Game Battle, Main Bareng (HP mentee), dan Games Area (Fullscreen API + tampilan memenuhi layar bila API tidak ada). Perbaikan skor: hasil battle tidak lagi tersimpan berulang tiap 2 detik saat battle hilang; hasil ronde tampil & tersimpan sekali; poin setelah waktu habis tidak dihitung (skor tampilan = skor battle); "Rekor pribadi baru" tidak muncul saat hanya menyamai rekor; skor NaN dicegah; balapan: pemain yang tidak tercatat tidak bisa "Juara 1" dan tidak mendapat 720 poin; Monster Co-op: skor tidak NaN; Kilat Hitung: jawaban kosong tidak dihitung benar, pewaktu lama tidak mempercepat ronde baru. Server memvalidasi skor game. | Layar penuh 1366×900, keluar mengembalikan gulir; 3 uji API skor |
| 8 | Satu commit bersama commit sebelumnya | Commit ronde 15–17 di-amend menjadi ronde 15–18 (cadangan tag `backup-ronde17-76db7d9`). | — |

## Pemeriksaan menyeluruh

- 4 peran × semua menu (256 halaman, 1366 px dan 390 px): **tanpa error JavaScript** dan tanpa halaman yang meluber.
- Halaman baru di 390 px (Batas & Sanksi, Pengaturan, AI Analytics, form mentee, studio tryout, pemilih soal, form tryout,
  setoran tutor): tanpa luapan horizontal.
- Mode server (Turso tiruan, 5 akun di 5 peramban): alur tryout, kritik & saran, dan status pendidikan berjalan tanpa galat
  sinkron. Galat konsol yang tersisa hanya koneksi Supabase Realtime yang memang tidak terjangkau dari sandbox.

## Uji otomatis

`node scripts/test-api.js` → **257/257 lulus** (tambahan: 20 uji kritik & saran, 20 uji CBT Tryout, 3 uji skor game).

## Keterbatasan yang diketahui

- Denda batas ketidakhadiran dideteksi otomatis, tetapi tagihannya dibuat admin dengan satu klik (Presensi → Batas & Sanksi)
  agar catatan presensi yang salah tidak langsung menjadi tagihan. Pengaturan keuangan lanjutan menunggu pembahasan berikutnya.
- Masukan lama bertujuan "individu" (nama penerima diketik bebas) kini hanya terlihat oleh admin dan pengirimnya, karena
  penerimanya tidak dapat dipastikan sebagai akun.
- Notifikasi tryout terjadwal tidak dikirim sebagai push saat waktunya tiba; mentee melihatnya di pusat notifikasi dan kartu Overview.
- Setelah pembaruan ini setiap perangkat menarik ulang seluruh datanya satu kali (aturan baca diperketat).
- pdf.js dimuat dari CDN yang tidak terjangkau dari sandbox, jadi impor PDF tidak diuji ulang di ronde ini.
