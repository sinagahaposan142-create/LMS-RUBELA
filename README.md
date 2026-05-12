# LMS Rubela

Website Learning Management System lengkap berbasis HTML, CSS, dan JavaScript murni (tanpa framework & tanpa backend). Semua data disimpan di `localStorage` browser, semua entitas saling terhubung dan otomatis tersinkronisasi.

## Fitur Utama

### Login
- Tiga peran: **Admin**, **Guru**, dan **Siswa** dengan tab pemilih peran.
- Registrasi mandiri khusus Siswa.
- Session disimpan di `localStorage`.

### Panel Admin
- **Overview**: statistik lengkap (guru, siswa, kelas, pembayaran, pemasukan, pengeluaran, laba bersih, CBT, tugas, modul, rekaman, bank soal).
- **Kelola Guru** (dengan tarif gaji) & **Kelola Siswa**.
- **Semua Kelas**: daftar dengan rekap materi/tugas/siswa.
- **Absensi** (global): rekap kehadiran siswa & guru per kelas + log lengkap.
- **Rekapan**: ringkasan aktivitas per kelas (siswa, materi, modul, rekaman, tugas, CBT, rata-rata nilai, kehadiran) dan per siswa (submission, rata tugas, CBT selesai, kehadiran, total pembayaran).
- **Keuangan**: kelola pemasukan siswa (SPP), pengeluaran operasional, dan gaji/honor guru (otomatis mengisi dari tarif guru). Laba bersih terhitung real-time.
- **Pengaturan**: reset seluruh data.

### Panel Guru
- **Overview**: statistik kelas saya, siswa, tugas, submission yang perlu dinilai.
- **Kelas Saya**: buat / edit / hapus kelas (dengan harga/SPP).
- **Detail Kelas** (7 tab): Materi, **Modul** (dengan beberapa bagian per modul), **Rekaman Kelas** (embed YouTube/Vimeo/video), Tugas, **CBT/Ujian**, **Absensi**, Siswa.
- **Modul** (global): kumpulan modul dari seluruh kelas saya.
- **Rekaman Kelas** (global): agregat rekaman video dengan filter kelas.
- **Bank Soal**: kelola bank soal multiple-choice (mapel, tingkat kesulitan, 4 pilihan, pembahasan). Digunakan di CBT.
- **CBT/Ujian**: buat ujian berbasis bank soal, tentukan durasi & jadwal. Lihat hasil semua siswa + rata-rata.
- **Penilaian Tugas**: grading terpusat untuk semua submission.
- **Absensi**: presensi per tanggal (diri sendiri + semua siswa) + rekap.
- **Honor Saya**: riwayat gaji (total diterima, pending, tarif per bulan).
- **Profil**: ubah data diri & password.

### Panel Siswa
- **Overview**: statistik, tugas mendatang, kelas saya.
- **Kelas Saya**: lihat kelas yang diikuti, detail 6 tab (Materi, Modul, Rekaman, Tugas, CBT, Absensi).
- **Jelajah Kelas**: cari & gabung kelas.
- **Modul** (global): semua modul dari kelas yang diikuti.
- **Rekaman Kelas** (global): semua rekaman, filter per kelas, embed video.
- **CBT/Ujian**: daftar ujian, kerjakan dengan timer & navigasi soal, otomatis simpan jawaban, hasil + pembahasan setiap soal.
- **Tugas**: daftar semua tugas + status (Belum/Terlambat/Menunggu/Nilai).
- **Nilai**: riwayat nilai + rata-rata + nilai terbaik.
- **Absensi Saya**: statistik hadir/izin/sakit/alfa, rekap per kelas, riwayat lengkap.
- **Pembayaran**: riwayat transaksi SPP (total terbayar, belum lunas).
- **Profil**: ubah data diri & password.

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
admin ── kelola semua + expenses (pengeluaran operasional)
```

Contoh sinkronisasi otomatis:
- Guru tambah **bank soal** → muncul di **CBT** guru → siswa terdaftar langsung bisa **mengerjakan** → hasil langsung tampil di **CBT results** guru & **Rekapan** admin.
- Guru isi **absensi siswa** → langsung tampil di **Absensi Saya** siswa dan **Absensi admin** + **Rekapan**.
- Admin tambah **pembayaran** siswa → tampil di **Pembayaran** siswa dan **Overview/Keuangan** admin.
- Guru set **tarif gaji** → admin **Catat Gaji** otomatis terisi sesuai tarif.
- Hapus **kelas** → semua materi, modul, rekaman, tugas, submission, CBT, attempt, enrollment, attendance, dan payment terkait ikut terhapus (cascade).

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

Login sebagai `siswa1` sudah otomatis terdaftar di 2 kelas + sudah punya data tugas, submission, CBT attempt, pembayaran, dan absensi — cocok untuk eksplorasi cepat.

## Struktur Proyek

```
LMS-RUBELA/
├── index.html           # Halaman login + registrasi
├── dashboard.html       # Shell dashboard
├── css/
│   └── style.css        # Styling lengkap (auth, dashboard, CBT, finance, modul, video, absensi)
└── js/
    ├── data.js          # Data store (localStorage) + seed 15 entitas
    ├── auth.js          # Session + login + register
    ├── login.js         # Controller halaman login
    ├── ui.js            # Helper format (Rp, tanggal, durasi), modal, toast
    ├── shared.js        # Shared modules: CBT runner + video embed
    ├── dashboard.js     # Router role-based + sidebar
    ├── admin.js         # Panel Admin (Overview, Guru, Siswa, Kelas, Absensi, Rekapan, Keuangan, Settings)
    ├── guru.js          # Panel Guru (8 menu)
    └── siswa.js         # Panel Siswa (9 menu)
```

## Tips
- Untuk memulai dari nol: Admin → Pengaturan → Reset Semua Data.
- Data tiap browser independen — cocok untuk demo.
- Embed video mendukung YouTube (watch/embed/short url) dan Vimeo.
