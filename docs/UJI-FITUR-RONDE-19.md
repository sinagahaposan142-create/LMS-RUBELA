# Uji Fitur Ronde 19

Semua perubahan ronde 19 digabung ke commit ronde 15–18 di cabang `feature/lms-website`.
Pengujian memakai `scripts/dev-server.js` (mode lokal dan mode server dengan Turso tiruan),
`node scripts/test-api.js`, dan Playwright pada lebar 1366 px dan 390 px.

## Hasil per poin

| # | Permintaan | Perubahan | Hasil uji |
|---|---|---|---|
| 1 | Keterangan berapa kali soal dipakai di tryout/ujian; utamakan soal yang belum pernah dipakai | `DB.questionUsage()` menghitung pemakaian setiap soal di ujian & tryout (remedial tidak dihitung karena salinan ujian induk; ujian yang sedang disunting dikecualikan). Chip **Belum dipakai** (hijau) atau **N× dipakai · N tryout** (ikon putar; judul ujian di tooltip) tampil di wizard CBT langkah Soal, Bank Soal (CBT), pemilih soal halaman penuh, dan studio/setoran Tryout. Urutan: belum dipakai → paling jarang → paling lama tidak dipakai. Filter **Pemakaian** (semua / belum pernah / sudah pernah) dan opsi pemilih **Belum pernah dipakai**; "acak soal" di wizard mendahulukan soal yang belum dipakai. | Soal di tryout tampil "1× dipakai · 1 tryout"; filter "Belum pernah dipakai" hanya menampilkan chip hijau; di mode server angka sama di admin |
| 2 | Game Battle & streak: soal yang sudah dijawab benar tidak muncul lagi, yang salah muncul lagi, bila semua sudah dipakai ulang dari awal | Riwayat jawaban per mentee `lms_q_history` (tersinkron, hanya pemilik yang menulis, admin dapat membaca). Dipakai Game Battle (semua game dasar & arkade) dan Arena (Mini Quiz, Latihan Soal, Mode Adaptif). Soal benar disisihkan; soal salah diselipkan ±40% di awal sesi berselang dengan soal baru; bila sisa soal kurang dari satu sesi, diisi soal dikuasai yang paling lama; bila semua dikuasai → putaran baru + notifikasi. Bilah status baru / perlu diulang / dikuasai di panel kategori. | Kuis Kilat: 7 dari 15 soal ditandai benar → tak satu pun muncul lagi, jawaban baru tercatat; semua dikuasai → "Mulai putaran ke-2" dan 15 soal kembali baru. Arena: 6 benar + 2 salah → 0 soal benar & 2 soal salah di 5 soal pertama |
| 3 | Game Battle: pilihan kategori latihan per subtest, beberapa subtest, semua subtest, per sub bab/materi | Panel **Kategori latihan** (`js/qscope.js`) di tab Main dan Battle (termasuk lawan bot & Cari Lawan) dan Arena → Latihan Soal: *Semua subtest*, *Pilih subtest* (boleh beberapa, jumlah soal per subtest), *Per materi* (subtest → materi → sub bab). Pilihan diingat per mentee; jumlah game siap mengikuti kategori; battle menyimpan kategori (divalidasi server dan tidak dapat diubah). | PU → "0/18 game siap"; PU+PPU+PBM+PK → 13/18; mode Per materi tetap terpilih walau subtest belum punya materi; battle berkategori diterima, kategori rusak ditolak (uji API) |
| 4 | Ganti layar "menyiapkan data" saat login dengan kata penyemangat/animasi loading yang keren | `js/boot-splash.js`: logo lembaga dengan orbit animasi, sapaan sesuai waktu (zona waktu pengguna) + nama depan, kalimat penyemangat bergilir sesuai peran, 3 tahap (akun terverifikasi → menyinkronkan data → menyiapkan dashboard) dengan jumlah data, tombol coba lagi bila server tidak terjangkau, mode gelap, dan *reduced motion*. Layar yang sama berlanjut tanpa kedip dari halaman login ke dashboard. Overlay lama di `sync.js` dihapus. | Mode lokal & server: tampil saat masuk, lalu hilang setelah data siap ("Selamat siang, Siswa · … · Siap!") |
| 5 | Streak: mode adaptif yang otomatis mengarahkan soal ke subtest terlemah dari data tryout | Tab **🎯 Mode Adaptif** di Arena: `DB.studentWeakness()` menghitung penguasaan per subtest & per materi dari 10 tryout/ujian terakhir (bobot terbaru lebih besar); cadangan dari riwayat latihan bila belum ada tryout. Urutan fokus: subtest lemah (< 85%) → subtest belum diukur → subtest kuat. 10 soal dibagi 6/3/1 ke tiga subtest fokus, materi < 70% didahulukan, kekurangan diisi subtest berikutnya, mengikuti riwayat jawaban. | Mentee dengan 1 tryout (PK 100%): fokus PU/PPU/PBM "belum diukur", PK di bawah; susunan 3/2/1 + 4 soal berikutnya sesuai jumlah soal Bank Soal |
| 6 | Streak kata baku: 2 pilihan baku/tidak baku, contoh kalimat setelah memilih, tombol Lupa (besok), Ragu (2 hari), Ingat (tidak diulang kecuali semua selesai → ulang dari awal) | Tab **🔤 Kata Baku** (`js/vocab.js`, 184 kata bawaan di `js/vocab-data.js`, 6 kategori): kartu 2 pilihan (posisi acak, bentuk tidak baku acak), setelah memilih tampil putusan, bentuk baku & tidak baku, **contoh kalimat** dengan kata disorot, dan kaidahnya. **Lupa** → jatuh tempo besok, **Ragu** → 2 hari lagi, **Ingat** → selesai; **Ingat dikunci bila pilihan salah** (Lupa disarankan). Semua kata diingat → putaran baru dari awal. Beranda dek: cincin progres, jatuh tempo/baru/dijadwalkan/akurasi, aktivitas 14 hari, penguasaan per kategori, filter kategori, "Ulang lebih awal", tab **Daftar kata** (cari, filter status & kategori, urut paling sering lupa). Pintasan ←/→ dan 1/2/3. Sesi ≥ 10 kartu tercatat di streak (`katabaku`, 8 XP, maks 3×/hari). | Salah pilih → Ingat terkunci & klik/tombol 3 tidak berpengaruh; 10 kartu → 6 Ingat, 3 Ragu (jatuh tempo +2), 1 Lupa (+1); semua 184 diingat → "Putaran ke-2 dimulai dari awal" |
| 7 | Streak flashcard vocab bahasa Inggris yang sering muncul + contoh kalimat | Tab **🗂 Vocab Inggris** (160 kata akademik/literasi UTBK, 9 kategori): mode **Flashcard** (kartu 3D dibalik: arti, kelas kata, definisi Inggris, contoh kalimat + terjemahan, sinonim) dan mode **Tebak arti** (4 pilihan dari kelas kata yang sama). Pelafalan kata & contoh kalimat (speech synthesis en-US). Sistem Lupa/Ragu/Ingat & putaran sama dengan Kata Baku; Ingat dikunci bila tebakan salah. Sesi ≥ 10 kartu tercatat di streak (`vocab`). **Admin** (Arena Belajar admin): tambah/ubah/hapus kosakata tambahan, nonaktifkan kata bawaan, impor Excel/CSV + template, aktif/nonaktif fitur, jumlah kartu per sesi (10–50), statistik mentee. | Flashcard dibalik (Spasi) menampilkan arti & contoh; tebak salah → Ingat terkunci; 10 kartu → "Tercatat di streak: +12 XP" setelah durasi minimum; kosakata tambahan admin sampai ke mentee (mode server) |
| 8 | Satu commit bersama commit sebelumnya, hapus kode tak terpakai | Commit ronde 15–18 di-amend menjadi ronde 15–19 (cadangan tag `backup-ronde18-58f095b`). Dihapus: overlay "menyiapkan data" lama di `sync.js`, pemilih subtest tunggal Game Battle (`subjectSelectHtml`). | — |

## Perbaikan yang ditemukan saat pengujian

- Sesi kosakata tidak pernah mencatat XP streak karena token aktivitas disimpan sebagai objek, bukan id token.
- Mode Adaptif menandai subtest 100% sebagai "Fokus utama" bila hanya satu subtest yang pernah diukur; kini subtest
  yang belum diukur didahulukan dan susunan soal mengikuti jumlah soal yang benar-benar tersedia.
- Arena memulai putaran baru terlalu cepat (saat sisa soal kurang dari 10); kini putaran baru hanya bila semua soal
  kategori sudah dikuasai, sama seperti Game Battle.
- Panel kategori berpindah ke "Pilih subtest" saat memilih "Per materi" untuk subtest yang belum memiliki materi.
- Sapaan layar pemuatan memakai jam perangkat, bukan zona waktu pengguna seperti dashboard.

## Pemeriksaan menyeluruh

- 4 peran × semua menu (256 halaman, 1366 px dan 390 px): **tanpa error JavaScript** dan tanpa halaman yang meluber.
- Tab Arena baru (Latihan Soal + kategori, Mode Adaptif, Kata Baku, Vocab Inggris, Daftar kata), panel kategori Game
  Battle, wizard CBT, Bank Soal, dan pengelola kosakata di 390 px: tanpa luapan horizontal.
- Mode server (Turso tiruan, 6 peramban): riwayat soal & progres kosakata kembali di perangkat kedua mentee yang sama;
  mentee lain tidak menerima dan tidak dapat menulis data mentee lain; admin dapat membaca; kosakata tambahan admin
  sampai ke mentee. Galat konsol yang tersisa hanya koneksi Supabase Realtime yang memang tidak terjangkau dari sandbox.

## Uji otomatis

`node scripts/test-api.js` → **272/272 lulus** (tambahan: riwayat soal & progres kosakata — pemilik, admin, mentee lain,
bentuk data rusak, kosakata tambahan hanya staf — serta kategori battle).

## Keterbatasan yang diketahui

- Soal battle disusun dari riwayat pembuat tantangan (kedua pemain harus mendapat soal yang sama); lawan tetap mencatat hasilnya sendiri.
- Main Bareng Kelas dan pratinjau game tidak memakai riwayat soal.
- Tantangan Harian Arena tetap sama untuk semua mentee (adil untuk peringkat), tetapi hasilnya ikut dicatat ke riwayat.
- Pelafalan bergantung pada suara bahasa Inggris yang tersedia di peramban/perangkat; tombolnya disembunyikan bila peramban tidak mendukung speech synthesis.
- Progres kosakata mentee dapat dilihat admin (ringkasan di pengelola kosakata); tutor belum memiliki tampilan progres kosakata.
