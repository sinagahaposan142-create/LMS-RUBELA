# Uji Fitur Ronde 15 — Ruang Belajar, Avatar, Ruang Perhatian, Offline, Impor PDF/Word, 8 Game & Main Bareng Kelas

Lingkungan uji: Node.js 22, server pengembangan (`node scripts/dev-server.js`, Turso tiruan) dan
mode lokal (`--local`), Chromium headless lewat Playwright. Mode server diuji dengan **tiga browser
terpisah** (tutor di layar 1366 px, dua siswa di ponsel 390/412 px). Tema terang dan gelap.

**Batasan lingkungan uji**
- Sandbox tidak dapat membuka internet: domain `rubela.biz.id`, Vercel, CDN (pdf.js, KaTeX,
  SheetJS, font), Supabase Realtime, dan layanan pengenalan suara Google **tidak teruji langsung**.
  Kode yang sama diuji di server lokal; pemeriksaan di domain ada di bagian "Uji manual setelah deploy".
- Tidak ada kunci API AI. Analisis AI pada Impor PDF/Word hanya diuji alur dan isi prompt-nya.
- Mikrofon tidak tersedia di peramban uji. Pencocokan ucapan ("be", "pilihan C", "dua puluh lima",
  "benar") diuji langsung pada fungsi `VoiceAnswer.match`; perekaman suara sungguhan belum.

## Pemeriksaan otomatis

| Pemeriksaan | Hasil |
|---|---|
| `node --check` semua berkas `js/`, `api/`, `scripts/` | lulus |
| ESLint `no-undef` + `no-unused-vars` seluruh `js/`, `api/` (konfigurasi sementara di luar repo) | **0 peringatan**; kode mati lama ikut dibersihkan (`rewardFor`, `setWorkspaceHeader`, `lastLocalEdit`, `stopPresenceBadge`, `dialogHost`, `allUsers`, `subs`, `clamp`, `hashStr`) |
| `node scripts/test-api.js` | **154/154 lulus** (112 ronde 14 + 26 Ruang Belajar/offline/avatar + 16 Main Bareng Kelas) |

## 1. Jawaban aman saat sinyal putus

| Skenario | Hasil |
|---|---|
| Ujian CBT: jaringan diputus, jawab beberapa soal, muat ulang halaman tanpa sinyal | halaman terbuka dari salinan, jawaban pulih dari jurnal perangkat |
| Kirim ujian saat offline → sinyal kembali | terkirim otomatis; indikator Tersimpan / Mengirim / Offline benar |
| Kuis course & kuis grup offline | dipulihkan & dikirim; kiriman kuis grup yang dibuat sebelum batas tapi tersinkron sesudahnya diterima (maks. 2 jam) |
| Pemantauan ujian (tutor) | kolom koneksi: tidak terhubung, perubahan tertunda, riwayat putus-sambung |

## 2. Avatar Almamater

| Skenario | Hasil |
|---|---|
| Pilih kampus (12), cowok/cewek, 6 gaya termasuk 2 berhijab; saran dari target kampus | tersimpan sebagai kode pendek `av1:…`, tampil di topbar, chat, peringkat, status online, ujian, game, presensi |
| Admin mengoreksi warna jas per kampus | berlaku di semua avatar kampus itu |
| Server menolak foto non-gambar atau lebih dari ±200 KB | ditolak |

## 3. Ruang Perhatian

| Skenario | Hasil |
|---|---|
| Admin & tutor: tugas belum dinilai, lewat tenggat, esai belum dinilai, ujian tanpa soal, peserta tidak ikut, jadwal belum divalidasi, presensi belum diisi; admin juga pembayaran & moderasi | dikelompokkan per rentang waktu, filter & pencarian, tombol tindak lanjut; hilang otomatis setelah selesai |
| Tutor | hanya pekerjaannya sendiri |

## 4. Ruang Belajar

| Skenario | Hasil |
|---|---|
| Tambah tujuan, mulai/istirahat/selesai, pindah halaman & muat ulang | timer tetap berjalan (chip mengambang) |
| Tidak menjawab "masih belajar?" 3 menit | dijeda di waktu pemeriksaan |
| Ruang Kelas, peringkat hari/minggu/bulan/total, statistik 7 hari & kalender, rekap admin/tutor + CSV, pantauan orang tua | benar |
| Server: sesi & tujuan hanya pemilik, sesi tidak dapat diubah/diisi mundur, batas 24 jam per hari | ditolak bila dilanggar |

## 5. Impor PDF/Word dibantu AI

| Skenario | Hasil |
|---|---|
| `.docx` berisi soal bernomor, pilihan A–H (termasuk satu baris), Kunci, Pembahasan, gambar & format | terbaca tanpa AI; halaman tinjau menandai siap/perlu dicek |
| Teks 100 soal dengan bagian Kunci Jawaban di akhir | kunci dipasangkan ke nomor soal |
| Menjodohkan & Urutan di tabel impor/ekspor Bank Soal | didukung |
| PDF | memakai pdf.js dari CDN — **belum teruji** (lihat batasan) |

## 6. 8 game arkade (Game Battle)

Diuji di Kelola Game Battle → Coba Game (admin, 1280 px) dan Main Sendiri (siswa, ponsel 390 px, tema gelap),
dengan Paket Soal Contoh terpasang. Tidak ada galat JavaScript di semua game.

| Game | Skenario | Hasil |
|---|---|---|
| Petualangan Peta | 3 tempat dijawab benar → persimpangan → Jalur Berbahaya → salah | penanda berpindah di peta, jalur berwarna; tenaga 3 → 2 dan soal lain di tempat yang sama |
| Pertarungan Monster | pilih Penyihir → Bola Api benar & cepat; ronde 2 Kutukan salah | "Bola Api mengenai! −48 (KRITIS)", Goblin membalas −18, HP 82/100 |
| Balapan Mobil | pilih sirkuit Pantai, pindah lajur, gerbang "?" dijawab benar, pakai item | item "Turbo" diterima & dipakai; klasemen 4 mobil, peta mini bergerak |
| Lari-Lompat | lompat, soal B/S → gerbang Kiri/Kanan + tembok tengah | gawang, koin, gerbang jawaban tampil; menabrak gawang mengurangi nyawa |
| Tarik Tambang | 4 jawaban benar beruntun | tali bergeser ke tim sendiri ("Unggul 95") |
| Tangkap Jawaban | geser keranjang dengan ←, pilihan berjatuhan | label pilihan terbaca, keranjang bergerak |
| Rebut Wilayah | pilih petak bercahaya, jawab | 2 petak dapat diserang; bot menyerang di gilirannya |
| Ludo Edukasi | lempar dadu, jawab benar, pilih bidak | bidak melangkah per petak; bot bergiliran; klasemen 4 pemain |
| Semua | ponsel 390 px | kontrol (◀ item/lompat ▶) tetap di layar di atas navigasi bawah |

## 7. Main Bareng Kelas (mode server, 3 browser)

| Skenario | Hasil |
|---|---|
| Tutor membuat ruang Monster Co-op (15 dtk/ronde) | kode 6 huruf tampil besar |
| Dua siswa memasukkan kode, memilih Penyerang & Penyembuh | daftar siswa & peran muncul di layar tutor |
| Ronde 1: Dimas benar (Serangan Berat), Nadia salah | "1 jurus mengenai monster: −71", Goblin membalas 2 siswa; HP Goblin 49/120 (60 × 2 siswa) |
| Ronde 2: keduanya benar | Nadia memulihkan 18 HP Dimas, **Goblin kalah**, ronde 3 melawan **Orc 180** (90 × 2) |
| HP siswa setelah ganti monster | +25 HP (pulih), pingsan dibangkitkan |
| Golem dikalahkan | layar kelas "Kelas mengalahkan Golem raksasa!" + peringkat kontribusi; HP siswa menampilkan "Kelas menang!" + skor |
| Balap Kelas, Kota Malam & Pegunungan, 2 putaran | hitung mundur bersama, kedua HP menyetir, gerbang soal di HP, item diterima & dipakai |
| Layar kelas | peta dengan nama & posisi mobil, klasemen, putaran, item |
| Finis | hasil "1 Nadia 40,6 dtk • 6 benar, 2 Dimas 40,7 dtk • 6 benar" di layar kelas dan HP |
| Skor | tercatat di Riwayat siswa sebagai "Main Bareng" (Pertarungan Monster & Balapan Mobil) dan riwayat tutor |
| Server (test-api) | siswa tidak dapat membuat/menutup ruang; tutor hanya atas nama sendiri; kode & tuan rumah tetap; jam fase dicap server; pemain hanya menulis datanya sendiri; jawaban terkunci & dicap waktu server; item asing ditolak |

## Batasan yang perlu diketahui

- **Main Bareng butuh layar tuan rumah tetap terbuka.** Tuan rumah adalah wasit (menilai jawaban & menghitung
  kerusakan). Bila tab tutor ditutup, permainan berhenti sampai dibuka lagi (ruang dapat dilanjutkan dari daftar
  "Ruang yang sedang terbuka").
- Tanpa Supabase Realtime, perangkat menyinkron tiap 1,5–2 detik, jadi posisi mobil di layar kelas terlambat ±2–3
  detik (diperhalus dengan perkiraan kecepatan). Di HP siswa sendiri tidak ada jeda.
- Setiap ronde/gerbang menulis ke server. Untuk kelas besar (30+ siswa) ini menambah beban fungsi Vercel & Turso.
- Waktu jawab untuk serangan kritis diukur di HP siswa. Siswa yang mengutak-atik perangkatnya bisa memalsukan
  waktu ini; jawaban tetap dinilai tuan rumah dengan kunci soal.
- Kunci jawaban game (seperti game lain) ada di perangkat siswa.
- Jawab dengan suara memakai layanan pengenalan suara peramban: butuh internet, izin mikrofon, dan Chrome/Edge/Safari.
  Kelas yang ramai dapat menurunkan ketepatan; jawaban yang tidak dikenali diminta diulang.

## Uji manual setelah deploy (di `rubela.biz.id`)

1. Buka `https://rubela.biz.id/api/rubela?action=health` → harus `"configured": true` dan `"ready": true`.
   Bila `configured: false`, halaman masuk kini menampilkan petunjuk mengisi env Turso untuk Production.
2. Masuk sebagai tutor → Game Battle → **Main Bareng** → buat Monster Co-op; dari HP siswa → Game Battle →
   Main Bareng → masukkan kode. Jalankan 2 ronde.
3. Ulangi dengan Balap Kelas dari dua HP; pastikan mobil terlihat di layar tutor.
4. Di Balapan Mobil (Mode Kelas) tekan "Jawab dengan suara" dan sebut "be" atau isi jawabannya.
5. Bank Soal → **Impor PDF/Word** → unggah satu PDF asli (memastikan pdf.js dari CDN termuat).
6. Matikan Wi-Fi saat mengerjakan tryout, muat ulang, nyalakan lagi → jawaban terkirim.
