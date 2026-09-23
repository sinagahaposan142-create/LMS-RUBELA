# LMS Rubela

Website Learning Management System lengkap berbasis HTML, CSS, dan JavaScript murni (tanpa framework & tanpa backend). Semua data disimpan di `localStorage` browser, semua entitas saling terhubung dan otomatis tersinkronisasi.

Antarmuka dilengkapi **layer animasi & micro-interaction** (ripple pada tombol, transisi halaman berjenjang, count-up angka statistik, reveal saat scroll) serta **mode terang/gelap** yang tersimpan per browser.

## Fitur Utama

### Tampilan & Interaksi
- **Animasi tombol**: efek ripple mengikuti titik klik, umpan balik tekan (scale), kilau geser pada aksi utama.
- **Transisi halaman**: setiap perpindahan menu memunculkan konten secara berjenjang (stagger).
- **Angka statistik** menghitung naik (count-up), progress bar & donut meter teranimasi.
- **Toast** bergaya kartu dengan ikon, warna per jenis, dan progress auto-dismiss.
- **Modal** membuka/menutup dengan animasi pop + latar blur, fokus otomatis ke field pertama.
- **Mode Gelap / Terang** via tombol di topbar (juga tersedia di halaman login), tersimpan otomatis.
- **Responsif**: sidebar menjadi drawer dengan tombol hamburger di layar kecil.
- Menghormati `prefers-reduced-motion` untuk pengguna yang menonaktifkan animasi.

### Login
- Empat peran: **Admin**, **Guru**, **Siswa**, dan **Orang Tua** dengan tab pemilih peran.
- Registrasi mandiri khusus Siswa (sekaligus mengisi **universitas & jurusan impian**).
- Session disimpan di `localStorage`.
- Pesan error spesifik bila peran tidak cocok, dengan animasi shake.

### CBT / Ujian — Halaman Khusus (dirombak total)
Menu **CBT / Ujian** kini membuka *workspace* layar penuh dengan sub-halaman sendiri, dipakai bersama oleh Admin dan Guru.
- **Daftar ujian**: status berlangsung/akan datang/selesai, jumlah peserta, dan ikon pengaturan keamanan tiap ujian.
- **Wizard 6 langkah** untuk membuat/menyunting ujian:
  1. **Informasi & Deskripsi** — judul, petunjuk pengerjaan (tampil di halaman pembuka peserta), jadwal.
  2. **Kelas Tujuan** — centang **beberapa kelas tingkat sekaligus** (X-A, XI-B, …) atau pilih **“Untuk Semua Kelas”**. Kelas di sini adalah kelas tingkat, bukan kelas mata pelajaran; kelas mata pelajaran tetap bisa dikaitkan secara opsional.
  3. **Metode Subtest** — *Per 1 Subtest*, *Gabungan 7 Subtest (Full UTBK)*, atau *Custom*. Memilih mode **tidak** otomatis mencentang soal apa pun.
  4. **Pilih Soal** — halaman “Soal Tersedia” dengan panel kategori subtest di samping, filter format & tingkat kesulitan, pencarian, serta kartu soal responsif.
  5. **Keamanan & Pemantauan** — wajib kamera, wajib mikrofon, paksa layar penuh, deteksi pindah tab, dan batas pelanggaran.
  6. **Tinjau & Simpan** — ringkasan lengkap + urutan pengerjaan.
- **Soal Tersedia (Bank Soal)**: halaman khusus per kategori subtest. Setiap soal menampilkan **jenis subtest**, **format soal** (Pilihan Ganda, Pilihan Lebih dari Satu, Esai, Benar/Salah, Majemuk Kompleks), **tingkat kesulitan**, dan jumlah opsi.
- **Pemantauan Langsung**: status tiap peserta (belum mulai / mengerjakan / selesai), jumlah dan rincian pelanggaran, auto-refresh 5 detik.
- **Hasil & Analisis**: skor keseluruhan + **rata-rata per subtest** untuk melihat subtest terlemah.

### Pengalaman Ujian Peserta
- **Halaman pembuka** berisi judul, **deskripsi/petunjuk**, ringkasan (jumlah soal, durasi, jumlah bagian), urutan pengerjaan, dan ketentuan keamanan.
- **Pemeriksaan perangkat**: bila ujian mewajibkannya, peserta harus mengizinkan **kamera** dan **mikrofon** — lengkap dengan pratinjau kamera dan indikator level suara. Ujian tidak dapat dimulai bila izin ditolak.
- **Pengerjaan berurutan per subtest**: untuk mode Gabungan 7 Subtest, peserta mengerjakan **PU → PPU → PBM → PK → Literasi Indonesia → Literasi Inggris → Penalaran Matematika**, masing-masing dengan timer sendiri dan tidak dapat diulang.
- **Pemantauan selama ujian**: pratinjau kamera menempel di sudut layar, pelanggaran (pindah tab, keluar layar penuh) dicatat dan diberi peringatan; melewati batas otomatis memberi tahu pengawas.
- **Hasil**: skor akhir, rincian skor per subtest, dan pembahasan tiap soal. Soal esai ditandai untuk dinilai manual.

> **Catatan privasi:** kamera dan mikrofon hanya dipakai secara lokal di perangkat peserta untuk pratinjau dan indikator suara. Tidak ada rekaman video/audio yang dikirim atau disimpan — sistem hanya mencatat *kejadian* pelanggaran.

### Pusat Notifikasi (semua peran)
- Ikon bel di topbar dengan penghitung yang belum dibaca.
- Notifikasi otomatis terkirim saat: tugas dinilai, submission masuk, siswa bergabung kelas, presensi **Alfa** tersimpan, dan akun orang tua dihubungkan.
- Klik notifikasi langsung membuka halaman terkait; tersedia "Tandai dibaca" & "Bersihkan".

### Papan Peringkat & Lencana (Admin / Guru / Siswa)
- **Papan Peringkat**: poin dihitung dari data nyata (kehadiran, jumlah tugas, nilai, jumlah & skor CBT), filter per kelas lewat kotak pilihan.
- **Level & progres** ditampilkan pada Overview siswa.
- **9 lencana pencapaian** yang terbuka otomatis mengikuti aktivitas belajar.

### Panel Admin
- **Overview**: statistik lengkap (guru, siswa, kelas, pembayaran, pemasukan, pengeluaran, laba bersih, CBT, tugas, modul, rekaman, bank soal).
- **Kelola Guru** (dengan tarif gaji) & **Kelola Siswa**.
- **Kelola Orang Tua**: buat akun wali, hubungkan ke satu atau beberapa siswa (daftar centang rapi dengan **pencarian langsung**), lihat siswa yang belum punya wali, serta **Export / Import Excel**.
- **Semua Kelas**: daftar dengan rekap materi/tugas/siswa + kolom **Password Kelas** beserta tombol atur cepat, plus **Export / Import Excel**. Judul kelas dipilih dari **7 subtest UTBK** atau ditulis manual lewat opsi *Lainnya*.
- **Presensi**: tab **Ambil Presensi** (pilih kelas lewat kotak berbaris, tandai status dengan satu klik **tanpa animasi** agar cepat), plus rekap siswa, rekap guru, dan log lengkap.
- **Papan Peringkat**: peringkat poin seluruh siswa.
- **Rekapan**: ringkasan aktivitas per kelas (siswa, materi, modul, rekaman, tugas, CBT, rata-rata nilai, kehadiran) dan per siswa (submission, rata tugas, CBT selesai, kehadiran, total pembayaran).
- **Keuangan**: kelola pemasukan siswa (SPP), pengeluaran operasional, dan gaji/honor guru (otomatis mengisi dari tarif guru). Laba bersih terhitung real-time.
- **Pengaturan**: reset seluruh data.

### Panel Guru
- **Overview**: statistik kelas saya, siswa, tugas, submission yang perlu dinilai.
- **Kelas Saya**: buat / edit / hapus kelas (dengan harga/SPP) dan **atur password kelas**.
- **Detail Kelas** (7 tab): Materi, **Modul** (dengan beberapa bagian per modul), **Rekaman Kelas** (embed YouTube/Vimeo/video), Tugas, **CBT/Ujian**, **Absensi**, Siswa.
- **Modul** (global): kumpulan modul dari seluruh kelas saya.
- **Rekaman Kelas** (global): agregat rekaman video dengan filter kelas.
- **Bank Soal**: kelola bank soal multiple-choice (mapel, tingkat kesulitan, 4 pilihan, pembahasan). Digunakan di CBT.
- **CBT/Ujian**: buat ujian berbasis bank soal, tentukan durasi & jadwal. Lihat hasil semua siswa + rata-rata.
- **Penilaian Tugas**: grading terpusat untuk semua submission.
- **Presensi**: pilih kelas lewat **kotak berbaris ke samping**, lalu tandai **Hadir / Izin / Sakit / Alfa** dengan tombol sejajar (tanpa dropdown, **tanpa animasi centang**). Tersimpan otomatis tiap klik, ada tombol "Tandai Semua", ringkasan hidup, dan catatan per siswa. Tab lain: rekap siswa & riwayat presensi sendiri.
- **Honor Saya**: riwayat gaji (total diterima, pending, tarif per bulan).
- **Profil**: ubah data diri & password.

### Panel Siswa
- **Overview**: sambutan **"Selamat Datang (Nama) — Calon Mahasiswa (Universitas Impian)"** lengkap dengan target jurusan, level & poin, lencana pencapaian, statistik, tugas mendatang, dan kelas saya.
- **Kelas Saya**: lihat kelas yang diikuti, detail 6 tab (Materi, Modul, Rekaman, Tugas, CBT, Absensi).
- **Jelajah Kelas**: cari & gabung kelas. Penempatan kelas utama tetap diatur Admin, dan setiap kelas dapat **dilindungi password** (diatur Admin maupun guru pengajar) — kelas terkunci menampilkan gerbang password sebelum bergabung, kelas terbuka bisa langsung digabung.
- **Modul** (global): semua modul dari kelas yang diikuti.
- **Rekaman Kelas** (global): semua rekaman, filter per kelas, embed video.
- **CBT/Ujian**: daftar ujian, kerjakan dengan timer & navigasi soal, otomatis simpan jawaban, hasil + pembahasan setiap soal.
- **Tugas**: daftar semua tugas + status (Belum/Terlambat/Menunggu/Nilai).
- **Nilai**: riwayat nilai + rata-rata + nilai terbaik.
- **Absensi Saya**: statistik hadir/izin/sakit/alfa, rekap per kelas, riwayat lengkap.
- **Pembayaran**: riwayat transaksi SPP (total terbayar, belum lunas).
- **Papan Peringkat**: posisi sendiri disorot di antara seluruh siswa.
- **Profil**: ubah data diri, **universitas & jurusan impian**, password, serta lihat akun orang tua yang terhubung.

### Panel Orang Tua (baru)
Akun khusus pemantauan (hanya-baca) yang dibuat Admin dan dihubungkan ke satu atau beberapa anak. Bila memantau lebih dari satu anak, tersedia pemilih anak di bagian atas setiap halaman.
- **Overview Anak**: sambutan, sorotan "Perlu Perhatian" otomatis (kehadiran rendah, tugas lewat deadline, nilai rendah, tagihan belum lunas), 4 donut meter capaian, dan **timeline aktivitas** terbaru.
- **Nilai & Ujian**: seluruh nilai tugas beserta catatan guru + hasil setiap CBT.
- **Kehadiran**: rekap hadir/izin/sakit/alfa, persentase per kelas, dan riwayat lengkap.
- **Tugas**: progres pengumpulan dan status tiap tugas.
- **Kelas & Guru**: kelas yang diikuti, kehadiran per kelas, dan kontak guru pengajar.
- **Perkembangan**: grafik batang skor CBT & nilai tugas, indikator tren (naik/turun/stabil), lencana anak, dan saran terarah untuk orang tua.
- **Pembayaran**: riwayat dan status tagihan anak.
- **Chat Guru**, **Kalender**, **Pengumuman**, **Kritik & Saran**, **Profil**.

### Atribusi Tutor per Konten & per Pertemuan
Satu kelas subtest bisa diampu **dua tutor atau lebih**, tetapi satu pertemuan hanya diajar satu tutor.
- Setiap **materi, modul, rekaman, tugas, CBT, dan presensi** menyimpan `createdBy` (tutor penanggung jawab) dan `enteredBy` (akun yang mengetiknya). Kartu konten menampilkan keterangan "Dibuat oleh …" — bila admin yang mengetik, tertulis "… (dicatat admin)".
- Saat **admin** membuat konten, tersedia pemilih **Tutor Penanggung Jawab** (termasuk di wizard CBT) agar rekap keaktifan tutor tetap akurat.
- **Halaman Kelas**, **Jadwal Kelas**, dan **War Jadwal** menampilkan tutor yang mengajar pada pertemuan tersebut, diambil dari rencana pertemuan (`classPlans`) — bukan dari daftar tutor kelas.
- **Presensi** kelas multi-tutor menampilkan **semua** tutor pada lembar presensi, dan tutor pertemuan berganti otomatis mengikuti tanggal yang dipilih.
- **Kepemilikan tugas**: hanya tutor pembuat (atau admin) yang boleh mengedit, mengoreksi, dan menilai tugas tersebut. Validasi/konfirmasi rencana kelas juga hanya bisa dilakukan admin dan tutor yang bersangkutan — dijaga di sisi handler, bukan hanya disembunyikan di tampilan.

### Editor Kaya (rasa Word & Excel)
Satu mesin editor bersama (`js/editor.js`) dipakai di **Bank Soal, Materi, Modul, dan Tugas** sehingga fiturnya identik di panel admin maupun tutor.
- Format teks lengkap: heading, tebal/miring/garis bawah/coret, superscript & subscript, warna teks & sorotan, perataan, daftar berpoin/bernomor, **checklist**, indentasi, garis pemisah, kode, dan **kutipan yang benar-benar bisa dimatikan lagi** (toggle).
- **Tabel** ala spreadsheet: sisipkan tabel N×M, tambah/hapus baris & kolom, baris header.
- **Rumus & simbol**: dialog LaTeX dengan pratinjau, plus palet simbol **matematika, fisika, kimia, dan Yunani**.
- **Media**: unggah gambar (otomatis dikompres), tautan **video YouTube/Vimeo** dan audio dengan **pratinjau langsung di editor**, serta tempel-dari-Word yang membersihkan format sampah.

### Halaman Khusus Materi / Modul / Rekaman / Tugas
Tombol **Tambah** kini membuka *workspace* satu halaman penuh (bukan modal sempit), sama untuk admin dan tutor: editor kaya penuh lebar, lampiran, pratinjau video, pemilih tutor penanggung jawab, dan tombol kembali yang aman.
- **Tugas** punya dua mode: **uraian** (jawaban teks/berkas) atau **berbasis soal** — mengambil soal langsung dari **Bank Soal pusat** sehingga mendukung **8 format soal** dan LaTeX tanpa duplikasi data. Jawaban siswa dinilai otomatis untuk semua format objektif; esai tetap dinilai manual.

### Bank Soal: Massal, Impor & Ekspor
- **Buat Soal Massal**: satu halaman untuk mengetik/menempel banyak soal sekaligus (tanpa membuka form berulang), lengkap dengan pratinjau baris dan deteksi format otomatis dari kunci jawaban (mis. kunci `A,C` dikenali sebagai *Pilihan Lebih dari Satu*).
- **Impor / Ekspor** `.xlsx` dan `.csv` dengan kolom seragam: `Subtest | Format | Tingkat | Pertanyaan | A | B | C | D | E | Kunci | Pembahasan`, plus unduhan **template**.
- Memilih kategori subtest lalu menekan **Tambah Soal** membuat pilihan subtest **otomatis tersinkronisasi**.

### Jadwal, Kalender & Pengumuman
- Jadwal kelas tersinkronisasi ke **halaman kelas** (agenda pertemuan hari itu beserta materi/modul yang sudah tersedia) dan ke **Kalender utama** semua peran: admin, tutor, siswa, dan orang tua.
- **Pengumuman** kini punya sasaran peran **Orang Tua** (selain semua/guru/siswa), dengan label sasaran yang jelas.

### Integrasi AI (Google Gemini + Agent API)
Seluruh fitur AI memakai **data asli LMS**, bukan angka contoh, dan dipakai bersama semua panel.
- **AI Guru** (siswa): percakapan sungguhan dengan Gemini. Konteks kelas yang diikuti dan subtest terlemah siswa dikirim otomatis agar jawabannya terarah.
- **Rencana Belajar Mingguan** (siswa): disusun dari **jadwal kelas yang sebenarnya**; hari tanpa kelas diisi belajar mandiri pada subtest terlemah. Tersedia tombol agar AI merapikannya.
- **Rekomendasi Materi** (siswa): prioritas belajar dihitung dari rata-rata skor CBT per subtest, dilengkapi materi & modul nyata yang tersedia di kelasnya.
- **Kesiapan PTN** (siswa): kesiapan terukur per subtest berdasarkan skor CBT dan target kampus siswa sendiri, dengan keterangan tegas bahwa ini bukan prediksi resmi SNBT.
- **Deteksi Dini Siswa** (admin & tutor): kehadiran, keterlambatan tugas, dan tren nilai. Tutor hanya melihat siswa pada kelas yang dia ampu.
- **Integritas Ujian** (admin & tutor): hanya menampilkan pelanggaran yang **benar-benar tercatat** sistem (pindah tab, keluar layar penuh), durasi pengerjaan tidak wajar, dan skor sempurna berwaktu singkat — disertai keterangan bahwa daftar ini bukan tuduhan.
- **Buat Soal dengan AI** (Bank Soal): menghasilkan beberapa soal sekaligus beserta pembahasan, lalu **wajib diperiksa** lewat pratinjau sebelum disimpan.
- **Tulis dengan AI** (editor): tombol 🤖 pada toolbar Materi/Modul/Tugas/Bank Soal untuk menulis, merapikan, meringkas, atau menambah contoh soal.
- **Agent Web** (admin): kirim URL + tujuan, terima data terstruktur yang bisa diunduh sebagai CSV.

> **Keamanan kunci API.** Aplikasi ini statis tanpa server, sehingga kunci yang ditulis di dalam
> kode akan terbaca publik. Karena itu kunci **tidak disertakan di repositori**. Admin mengisinya
> di **Pengaturan → Integrasi AI**, dan kunci hanya disimpan pada `localStorage` browser tersebut.
> Bila kunci belum diisi, halaman AI tetap menampilkan analisis dari data asli LMS — hanya ulasan
> naratif AI yang dinonaktifkan, lengkap dengan petunjuk cara mengaktifkannya.

Hasil audit lengkap 23 poin permintaan beserta buktinya ada di
[`docs/AUDIT-23-POIN.md`](docs/AUDIT-23-POIN.md).

### Keuangan & Branding
- **Pemasukan** dibedakan per jenis: pembayaran SPP **dan denda siswa** (mis. pelanggaran atau keluar kelas) dengan daftar alasan denda siap pakai.
- **Pengaturan → Branding**: unggah **logo Rubela** dan atur nama lembaga; logo langsung dipakai di halaman login, topbar dashboard, judul halaman, dan favicon.

## Arsitektur Data (semua tersinkronisasi)

Semua entitas direlasikan via ID, jadi update/hapus satu entitas otomatis konsisten di seluruh panel:

```
users ─── guru ───▶ courses ───▶ materials
  │        │          │   ├───▶ modules (berisi sections[])
  │        │          │   ├───▶ recordings (video URL)
  │        │          │   ├───▶ assignments ───▶ submissions ◀── siswa
  │        │          │   ├───▶ cbts ───▶ cbtAttempts ◀── siswa
  │        │          │   │       └─ questionIds[] ──▶ questions (bank soal)
  │        │          │   ├───▶ enrollments ◀── siswa
  │        │          │   ├───▶ attendance ◀── siswa & guru
  │        │          │   └───▶ payments ◀── siswa
  │        └─▶ salaries (gaji guru)
  │        └─▶ attendance (kehadiran guru)
  │        └─▶ questions (bank soal author)
  └── siswa ───▶ payments, enrollments, submissions, cbtAttempts, attendance
  └── orangtua ──childIds[]──▶ siswa (pemantauan hanya-baca)
admin ── kelola semua + expenses (pengeluaran operasional)
notifications ──userId──▶ users (dikirim otomatis oleh aksi lintas peran)
```

Contoh sinkronisasi otomatis:
- Guru tambah **bank soal** → muncul di **CBT** guru → siswa terdaftar langsung bisa **mengerjakan** → hasil langsung tampil di **CBT results** guru & **Rekapan** admin.
- Guru isi **absensi siswa** → langsung tampil di **Absensi Saya** siswa dan **Absensi admin** + **Rekapan**.
- Admin tambah **pembayaran** siswa → tampil di **Pembayaran** siswa dan **Overview/Keuangan** admin.
- Guru set **tarif gaji** → admin **Catat Gaji** otomatis terisi sesuai tarif.
- Guru/Admin **menilai tugas** → notifikasi otomatis ke **siswa** dan **semua orang tuanya**; nilai langsung muncul di panel siswa dan **Nilai & Ujian** orang tua.
- Guru/Admin menyimpan presensi **Alfa** → notifikasi ke siswa & orang tua, langsung terlihat di **Kehadiran** orang tua dan rekap admin.
- Siswa **mengumpulkan tugas** → notifikasi ke guru pengajar dan orang tua.
- Siswa **bergabung kelas** (dengan password bila terkunci) → notifikasi ke guru & orang tua, enrollment langsung terhitung di semua rekap.
- Admin **menghubungkan orang tua** ke siswa → siswa mendapat notifikasi, dan orang tua langsung dapat memantau seluruh data anak.
- Password kelas diubah Admin **atau** guru pengajar → langsung berlaku pada gerbang **Jelajah Kelas** siswa.
- Hapus **kelas** → semua materi, modul, rekaman, tugas, submission, CBT, attempt, enrollment, attendance, dan payment terkait ikut terhapus (cascade).
- Hapus **siswa** → tautan ke akun orang tua, notifikasi, dan pesan chat terkait ikut dibersihkan.

## Import / Export Excel

Tersedia pada **Kelola Guru**, **Kelola Siswa**, **Kelola Orang Tua**, dan **Semua Kelas**.
Tekan *Export Excel* untuk mengunduh template berisi kolom lengkap (termasuk data yang sudah ada), lalu gunakan file tersebut sebagai acuan import.

| Data | Kolom |
|------|-------|
| Guru | Nama, Username, **Password**, Email, WhatsApp, Subtest, Tarif Gaji, Status |
| Siswa | Nama, Username, **Password**, Email, Telepon, Kelas, Universitas Tujuan, Jurusan Tujuan, Status |
| Orang Tua | Nama, Username, **Password**, Email, Telepon, Hubungan, **Username Anak** (pisahkan koma), Status |
| Kelas | Judul Kelas, Subtest, Kelas Utama, Username Guru (boleh beberapa), Hari, Jam Mulai, Jam Selesai, Tanggal Mulai, Jumlah Pertemuan, Tautan Kelas, Kategori, Deskripsi, Biaya, Password |
| Bank Soal | Subtest, Format, Tingkat, Pertanyaan, A, B, C, D, E, Kunci, Pembahasan |

- Kolom **Password** dipakai langsung sebagai password akun. Bila dikosongkan, akun memakai `password123`.
- Baris dengan username/judul yang sudah ada otomatis dilewati agar tidak duplikat.
- Pada import orang tua, kolom *Username Anak* langsung menghubungkan akun wali ke siswa dan mengirim notifikasi ke siswa tersebut.

## Cara Menjalankan

```bash
git clone https://github.com/<owner>/LMS-RUBELA.git
cd LMS-RUBELA

# Buka index.html langsung, atau:
python3 -m http.server 8080
# akses http://localhost:8080
```

## Akun Demo

| Peran | Username | Password |
|-------|----------|----------|
| Admin | `admin`  | `admin123` |
| Guru  | `guru1`  | `guru123` (Bu Maria Simbolon — PK 11-A & PU 12-A) |
| Guru  | `guru2`  | `guru123` (Bu Irana Dewi — PK 11-B) |
| Guru  | `guru3`  | `guru123` (Pak Budi Santoso — PU 12-A) |
| Guru  | `guru4`  | `guru123` (Bu Sari Wulandari — Literasi B. Indonesia 10-A) |
| Siswa | `siswa1` … `siswa6` | `siswa123` |
| Orang Tua | `ortu1` | `ortu123` (memantau Andi Pratama) |
| Orang Tua | `ortu2` | `ortu123` (memantau Dewi & Rendy) |

Kelas **12-A • Penalaran Umum** diampu **dua tutor** (`guru3` + `guru1`) — pakai kelas ini untuk mencoba
atribusi tutor per pertemuan, presensi multi-tutor, dan pembatasan hak edit/nilai antar tutor.

Login sebagai `siswa1` sudah otomatis terdaftar di 2 kelas + sudah punya data tugas, submission, CBT attempt, pembayaran, dan absensi — cocok untuk eksplorasi cepat.
Login sebagai `ortu2` untuk mencoba pemantauan **dua anak** sekaligus lewat pemilih anak.

### Password Kelas Demo

| Kelas | Password |
|-------|----------|
| Kelas 11-A • Pengetahuan Kuantitatif (PK) | `pk2026` |
| Kelas lainnya | *(kosong — kelas terbuka)* |

Ubah kapan saja lewat Admin → Semua Kelas → **Atur**, atau Guru → Kelas Saya → tombol 🔒.

## Struktur Proyek

```
LMS-RUBELA/
├── index.html           # Halaman login + registrasi
├── dashboard.html       # Shell dashboard
├── css/
│   ├── style.css        # Styling lengkap (auth, dashboard, CBT, editor, keuangan, modul, presensi)
│   └── responsive.css   # Penyesuaian layout tablet/ponsel + area scroll (chat, sidebar, tabel)
└── js/
    ├── data.js          # Data store (localStorage) + seed + helper atribusi tutor, pertemuan, denda/branding
    ├── auth.js          # Session + login (4 peran) + register
    ├── login.js         # Controller halaman login
    ├── loginquiz.js     # Kuis penyemangat sebelum masuk dashboard
    ├── ui.js            # Helper format (Rp, tanggal, durasi), modal, toast, progress, meter, greeting
    ├── effects.js       # Layer animasi: ripple, reveal, count-up, transisi halaman, tema gelap/terang
    ├── responsive.js    # Pembungkus tabel & penyesuaian elemen agar aman di layar kecil
    ├── branding.js      # Logo & nama lembaga (login, topbar, judul halaman, favicon)
    ├── ai.js            # Integrasi Gemini & Agent API: pemanggilan, penanganan galat,
    │                    #   render markdown aman, status "belum dikonfigurasi"
    ├── richtext.js      # Sanitasi & ringkasan teks kaya (plain text, potong aman)
    ├── editor.js        # Mesin editor bersama: toolbar, tabel, LaTeX, palet simbol, media
    ├── qeditor.js       # Editor khusus form soal (mendelegasikan ke editor.js)
    ├── content.js       # Workspace halaman penuh: Materi, Modul, Rekaman, Tugas
    ├── bank.js          # Bank Soal massal + impor/ekspor Excel & CSV + template
    ├── jadwal.js        # Jadwal kelas, War Jadwal, rencana pertemuan & tutor per pertemuan
    ├── rekap.js         # Rekapan aktivitas per kelas, tutor, dan siswa
    ├── shared.js        # Modul bersama: video embed, kalender, chat, pengumuman, password kelas,
    │                    #   lembar presensi (pill), papan peringkat, lencana
    ├── cbt.js           # Workspace CBT: daftar ujian, wizard 6 langkah, bank soal per subtest,
    │                    #   pemantauan langsung, hasil & analisis per subtest
    ├── exam.js          # Runner ujian peserta: halaman pembuka, cek kamera/mikrofon,
    │                    #   pengerjaan berurutan per subtest, pencatatan pelanggaran, hasil
    ├── dashboard.js     # Router role-based + sidebar + pusat notifikasi + tema + drawer mobile
    ├── admin.js         # Panel Admin (23 menu, termasuk Kelola Orang Tua, Keuangan,
    │                    #   Agent Web, Branding & Integrasi AI)
    ├── guru.js          # Panel Guru (18 menu)
    ├── siswa.js         # Panel Siswa (18 menu)
    └── orangtua.js      # Panel Orang Tua (13 menu pemantauan)
```

## Tips
- Untuk memulai dari nol: Admin → Pengaturan → Reset Semua Data.
- Data tiap browser independen — cocok untuk demo.
- Embed video mendukung YouTube (watch/embed/short url) dan Vimeo.
- Sambutan siswa mengambil data dari **Universitas Impian** di Profil; bila kosong akan muncul tombol pintas untuk mengisinya.
- Agar animasi tetap ringan, semua efek berbasis CSS transform/opacity dan otomatis dimatikan bila sistem mengaktifkan *reduce motion*.
- Mode gelap/terang bisa diganti kapan saja lewat tombol di topbar (atau di halaman login).
