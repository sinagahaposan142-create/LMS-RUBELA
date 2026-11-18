# Game Battle — 10 game edukasi

Menu siswa **Gamifikasi → Game Battle**; admin & tutor **Game Battle** (kelola soal & pengaturan).

## 10 game

| Game | Mekanik | Format soal |
|---|---|---|
| ⚡ Kuis Kilat | 10 soal, 15 dtk/soal, bonus kecepatan + combo beruntun | PG, Benar/Salah, Pilihan Lebih dari Satu |
| 🚦 Benar–Salah Turbo | Sebanyak mungkin pernyataan dalam 60 dtk, +50/−25, tombol ← → | Benar/Salah, B/S Majemuk, Majemuk Kompleks (kolom Benar \| Salah) |
| ❤️ Bertahan Hidup | 3 nyawa, mudah → sulit, poin per tingkat | Semua format otomatis |
| 🪜 Tangga Juara | 10 anak tangga poin, titik aman, bantuan 50:50 / Ganti Soal / +15 dtk, boleh berhenti | PG (≥ 3 pilihan) |
| 🎲 Taruhan Cerdas | Modal 500, pasang taruhan 10–100% sebelum soal, soal sulit ×2 | Semua format otomatis |
| ⌨️ Isian Kilat | Ketik jawaban, petunjuk huruf pertama (−30) | Isian Singkat |
| 🔗 Jodohkan Kilat | Ketuk kiri lalu kanan, 90 dtk, +40/−10 | Menjodohkan |
| 🃏 Kartu Memori | Buka 2 kartu, temukan 6 pasangan, bonus sisa waktu | Menjodohkan, PG teks pendek |
| 🧱 Susun Urutan | Susun item, sempurna +150, per posisi benar +20 | Urutan |
| 🎈 Pecah Balon | Pilihan terbang sebagai balon, pecahkan yang benar | PG (pilihan pendek) |

Penilaian jawaban memakai `Exam.gradeQuestion` yang sama dengan CBT (termasuk toleransi Isian
Singkat). Animasi mengikuti "kurangi gerakan"; suara dapat dimatikan (🔊).

## Mode bermain

- **Main Sendiri** — skor masuk Riwayat & Peringkat (rekor per game) dan XP streak
  (aturan "Games Area": maks. 3 ronde/hari, minimal 6 jawaban benar).
- **Battle 1 lawan 1** — kedua pemain mendapat soal & urutan yang sama, mulai bersamaan
  (hitung mundur), dan melihat skor lawan secara langsung. Pemenang dihitung server.
  - **Pilih lawan sendiri**: daftar siswa yang sedang online (yang sedang membuka Game Battle
    ditandai). Lawan menerima kartu undangan di halaman mana pun + notifikasi perangkat.
  - **Cari Otomatis**: bot matchmaking mengambil tantangan terbuka siswa lain, atau membuat
    tantangan terbuka dan mengundang hingga 3 siswa online yang paling cocok. Berlaku 2 menit.
  - **Lawan Bot** (Mudah/Sedang/Sulit) — latihan battle kapan saja.
  - Keluar di tengah battle = skor saat itu menjadi skor akhir. Siswa dapat menonaktifkan
    "Terima tantangan battle" agar tidak muncul di daftar lawan.

## Sumber & pengelolaan soal (admin/tutor)

- **Sumber soal** (Pengaturan, admin): Bank Soal + Soal Game (bawaan), Soal Game saja, atau Bank Soal saja.
- **Soal Game**: editor soal LMS yang sama (semua format kecuali Esai), pilih game tujuan
  (bawaan: semua game yang cocok), aktif/nonaktif. Tutor hanya mengubah soal miliknya.
- **Ambil dari Bank Soal**: salin soal terpilih; ikon menunjukkan game yang cocok untuk tiap soal.
- **Buat dengan AI**: pilih game → format menyesuaikan sistem game → AI membuat soal → tinjau → simpan.
- **Paket Soal Contoh**: 47 soal semua format agar 10 game langsung bisa dimainkan.
- **Coba Game**: pratinjau tanpa menyimpan skor. **Ringkasan**: kesiapan soal per game & statistik.

## Teknis

| Data (tersinkron) | Isi | Aturan server |
|---|---|---|
| `lms_game_questions` | soal game | tulis: admin/tutor |
| `lms_game_battles` | battle & skor tiap pemain | pemain hanya mengubah skornya sendiri; transisi status divalidasi; pemenang dihitung server |
| `lms_game_scores` | riwayat skor | dibuat pemiliknya, tidak dapat diubah |

Berkas: `js/games.js` (mesin, 10 game, battle, halaman siswa), `js/games-admin.js`,
`js/games-starter.js`, `css/games.css`. Siswa kini menerima status online sesama siswa
(tanpa info perangkat) untuk mencari lawan; admin/tutor tetap melihat detail lengkap.
