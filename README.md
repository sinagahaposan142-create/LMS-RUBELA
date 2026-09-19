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
- **Kelola Orang Tua**: buat akun wali, hubungkan ke satu atau beberapa siswa, lihat siswa yang belum punya wali.
- **Semua Kelas**: daftar dengan rekap materi/tugas/siswa + kolom **Password Kelas** beserta tombol atur cepat.
- **Absensi**: tab **Ambil Presensi** (pilih kelas lewat kotak berbaris, tandai status dengan satu klik), plus rekap siswa, rekap guru, dan log lengkap.
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
- **Absensi**: pilih kelas lewat **kotak berbaris ke samping**, lalu tandai **Hadir / Izin / Sakit / Alfa** dengan tombol sejajar (tanpa dropdown). Tersimpan otomatis tiap klik, ada tombol "Tandai Semua", ringkasan hidup, dan catatan per siswa. Tab lain: rekap siswa & riwayat presensi sendiri.
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
| Guru  | `guru1`  | `guru123` (Matematika) |
| Guru  | `guru2`  | `guru123` (Bahasa Indonesia) |
| Siswa | `siswa1` | `siswa123` |
| Siswa | `siswa2` | `siswa123` |
| Siswa | `siswa3` | `siswa123` |
| Orang Tua | `ortu1` | `ortu123` (memantau Andi Pratama) |
| Orang Tua | `ortu2` | `ortu123` (memantau Dewi & Rendy) |

Login sebagai `siswa1` sudah otomatis terdaftar di 2 kelas + sudah punya data tugas, submission, CBT attempt, pembayaran, dan absensi — cocok untuk eksplorasi cepat.
Login sebagai `ortu2` untuk mencoba pemantauan **dua anak** sekaligus lewat pemilih anak.

### Password Kelas Demo

| Kelas | Password |
|-------|----------|
| Matematika Dasar | `mat2026` |
| Bahasa Indonesia | *(kosong — kelas terbuka)* |

Ubah kapan saja lewat Admin → Semua Kelas → **Atur**, atau Guru → Kelas Saya → tombol 🔒.

## Struktur Proyek

```
LMS-RUBELA/
├── index.html           # Halaman login + registrasi
├── dashboard.html       # Shell dashboard
├── css/
│   └── style.css        # Styling lengkap (auth, dashboard, CBT, finance, modul, video, absensi)
└── js/
    ├── data.js          # Data store (localStorage) + seed 16 entitas + helper orang tua/notifikasi/password kelas
    ├── auth.js          # Session + login (4 peran) + register
    ├── login.js         # Controller halaman login
    ├── ui.js            # Helper format (Rp, tanggal, durasi), modal, toast, progress, meter, greeting
    ├── effects.js       # Layer animasi: ripple, reveal, count-up, transisi halaman, tema gelap/terang
    ├── shared.js        # Modul bersama: CBT runner, video embed, kalender, chat, AI, password kelas,
    │                    #   lembar presensi (pill), papan peringkat, lencana
    ├── dashboard.js     # Router role-based + sidebar + pusat notifikasi + tema + drawer mobile
    ├── admin.js         # Panel Admin (20 menu, termasuk Kelola Orang Tua & Papan Peringkat)
    ├── guru.js          # Panel Guru (16 menu)
    ├── siswa.js         # Panel Siswa (17 menu)
    └── orangtua.js      # Panel Orang Tua (12 menu pemantauan)
```

## Tips
- Untuk memulai dari nol: Admin → Pengaturan → Reset Semua Data.
- Data tiap browser independen — cocok untuk demo.
- Embed video mendukung YouTube (watch/embed/short url) dan Vimeo.
- Sambutan siswa mengambil data dari **Universitas Impian** di Profil; bila kosong akan muncul tombol pintas untuk mengisinya.
- Agar animasi tetap ringan, semua efek berbasis CSS transform/opacity dan otomatis dimatikan bila sistem mengaktifkan *reduce motion*.
- Mode gelap/terang bisa diganti kapan saja lewat tombol di topbar (atau di halaman login).
