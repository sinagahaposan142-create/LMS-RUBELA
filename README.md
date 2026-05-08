# LMS Rubela

Website Learning Management System sederhana berbasis HTML, CSS, dan JavaScript murni (tanpa framework & tanpa backend). Semua data disimpan di `localStorage` browser, jadi cukup buka file HTML langsung untuk mencoba.

## Fitur

### Panel Login
- Tiga peran: **Admin**, **Guru**, dan **Siswa** dengan tab pemilih peran.
- Registrasi mandiri khusus Siswa dari halaman login.
- Session disimpan di `localStorage` — halaman dashboard otomatis redirect ke login jika belum masuk.

### Admin
- **Overview**: statistik (guru, siswa, kelas, tugas belum dinilai), kelas terbaru, aktivitas penilaian.
- **Kelola Guru**: tambah / edit / hapus akun guru.
- **Kelola Siswa**: tambah / edit / hapus akun siswa.
- **Semua Kelas**: melihat daftar seluruh kelas beserta jumlah materi, tugas, dan siswa; dapat menghapus kelas.
- **Pengaturan**: reset seluruh data LMS ke default.

### Guru
- **Overview**: statistik kelas milik sendiri, siswa unik, tugas, submission yang perlu dinilai.
- **Kelas Saya**: buat / edit / hapus kelas.
- **Detail Kelas** (tab): 
  - *Materi* — tambah / edit / hapus materi beserta tautan opsional.
  - *Tugas* — buat tugas dengan deadline, lihat daftar submission, beri nilai + feedback.
  - *Siswa* — daftar siswa terdaftar di kelas.
- **Penilaian**: satu halaman global untuk semua submission yang masuk.
- **Profil**: ubah nama, email, mata pelajaran, password.

### Siswa
- **Overview**: statistik pribadi, tugas akan datang, daftar kelas yang diikuti.
- **Kelas Saya**: melihat kelas yang diikuti, membuka detail (materi + tugas), keluar dari kelas.
- **Jelajah Kelas**: cari + gabung kelas yang tersedia.
- **Tugas**: daftar semua tugas dari kelas yang diikuti beserta statusnya (Belum/Terlambat/Menunggu/Nilai).
- **Nilai**: riwayat nilai, rata-rata, nilai terbaik, dan feedback dari guru.
- **Profil**: ubah nama, email, kelas, password.

## Cara Menjalankan

1. Clone repo:
   ```bash
   git clone https://github.com/<owner>/LMS-RUBELA.git
   cd LMS-RUBELA
   ```
2. Buka `index.html` langsung di browser, atau jalankan static server:
   ```bash
   python3 -m http.server 8080
   # lalu akses http://localhost:8080
   ```
3. Login dengan akun demo di bawah.

## Akun Demo

| Peran | Username | Password |
|-------|----------|----------|
| Admin | `admin`  | `admin123` |
| Guru  | `guru1`  | `guru123` (Matematika) |
| Guru  | `guru2`  | `guru123` (Bahasa Indonesia) |
| Siswa | `siswa1` | `siswa123` |
| Siswa | `siswa2` | `siswa123` |
| Siswa | `siswa3` | `siswa123` |

Siswa juga bisa mendaftar sendiri melalui tombol **"Daftar di sini"** pada halaman login.

## Struktur Proyek

```
LMS-RUBELA/
├── index.html           # Halaman login + registrasi
├── dashboard.html       # Shell dashboard (sidebar + topbar + konten)
├── css/
│   └── style.css        # Semua styling (auth, dashboard, komponen)
└── js/
    ├── data.js          # Data store + seeding (localStorage)
    ├── auth.js          # Session, login, registerSiswa, requireAuth
    ├── login.js         # Controller halaman login
    ├── ui.js            # Helper (escape, format tanggal, modal, toast)
    ├── dashboard.js     # Router role-based, sidebar + navigasi
    ├── admin.js         # Panel Admin
    ├── guru.js          # Panel Guru
    └── siswa.js         # Panel Siswa
```

## Tips

- Ingin memulai dari nol? Buka **Admin → Pengaturan → Reset Semua Data**. Atau hapus localStorage browser.
- Data di setiap browser independen — ideal untuk demo di satu device.
- Seluruh interaksi terjadi di sisi klien, sehingga tidak memerlukan server atau database eksternal.
