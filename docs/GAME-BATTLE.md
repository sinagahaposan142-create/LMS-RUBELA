# Game Battle — 18 game edukasi + Main Bareng Kelas

Menu siswa **Gamifikasi → Game Battle**; admin & tutor **Game Battle** (kelola soal, pengaturan,
dan tuan rumah Main Bareng).

## 10 game dasar (`js/games.js`)

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

## 8 game arkade (`js/games-arcade.js`)

Gambar dibuat di perangkat (SVG/kanvas, `js/game-art.js`), tanpa berkas gambar.

| Game | Mekanik | Kontrol | Format soal |
|---|---|---|---|
| 🗺️ Petualangan Peta | Pulau 12 tempat dari Dermaga ke Kuil Harta; 2 persimpangan: Jalur Aman (2 soal, utamakan mudah) atau Jalur Berbahaya (1 soal sulit, poin ×2 + peti harta); salah = −1 tenaga (3) dan soal lain di tempat yang sama | klik / tombol 1–2 | semua format otomatis |
| 👹 Pertarungan Monster | Pilih peran (Penyerang, Penyihir, Penjaga, Penyembuh), tiap ronde pilih 1 dari 2 jurus lalu jawab; benar = jurus kena, menjawab di 40% waktu awal = kritis ×1,6; monster membalas; Goblin → Orc → Golem; 1 Ramuan Kebangkitan | klik / tombol 1–2 | semua format otomatis |
| 🏎️ Balapan Mobil | Kamu vs 3 bot, 3 putaran, 8 sirkuit (taman kota, gurun, pantai, salju, hutan, kota malam, pegunungan, pelabuhan). Mobil melaju sendiri; pindah lajur untuk menghindari rintangan & oli; papan turbo. Gerbang "?": benar = Turbo / Perisai / Genangan Oli (dilempar ke mobil di depan), salah = tergelincir. **Mode Kelas** (proyektor): soal besar & mikrofon otomatis | ← → / A D / usap, Spasi pakai item, A–E menjawab, suara | PG, Benar/Salah |
| 🏃 Lari-Lompat | Lintasan atletik 3 lajur: lompati gawang, ambil koin; saat soal muncul masuk gerbang jawaban yang benar (PG diringkas jadi 3 pilihan, B/S 2 gerbang + tembok) | ← → / usap, Spasi/↑/ketuk lompat | PG (pilihan ≤ 40 huruf), Benar/Salah |
| 🪢 Tarik Tambang | 75 dtk; tiap benar menarik tali (cepat & beruntun lebih kuat), salah tergelincir, tim lawan terus menarik makin kuat; menang bila bendera melewati garis | klik, suara | PG, Benar/Salah, Pilihan Lebih dari Satu |
| 🧺 Tangkap Jawaban | Pilihan jatuh dari pohon; geser keranjang dan tangkap yang benar; salah tangkap atau yang benar jatuh = −1 nyawa | ← → (tahan), seret, tombol | PG (pilihan ≤ 40 huruf), Benar/Salah |
| 🏰 Rebut Wilayah | Peta 35 petak heksagon (padang, benteng ×2, tambang emas); 12 giliran, pilih petak di sebelah wilayahmu lalu jawab; lawan bot menyerang balik dan bisa merebut petakmu | klik / Tab + Enter | semua format otomatis |
| 🎲 Ludo Edukasi | Papan Ludo asli (52 petak, petak aman, jalur pulang); kamu + 3 bot, 2 bidak; lempar dadu lalu jawab: benar = maju (cepat +1, dadu 6 = giliran lagi), salah = diam; tangkap bidak lawan; 12 giliran | klik / Spasi, 1–2 | semua format otomatis |

Semua game arkade memakai mesin yang sama: Main Sendiri, Battle 1 lawan 1 (soal, sirkuit, dan
lintasan sama untuk kedua pemain), Lawan Bot, Pratinjau, skor, Peringkat, Riwayat, dan XP streak.
Penilaian memakai `Exam.gradeQuestion`. Animasi mengikuti "kurangi gerakan".

**Jawab dengan suara** (`js/voice-answer.js`): tombol mikrofon di soal PG & Benar/Salah pada
Balapan Mobil, Tarik Tambang, dan Main Bareng. Sebut hurufnya ("A", "be", "pilihan C") atau isi
jawabannya ("dua puluh lima", "benar"). Memakai pengenalan suara peramban (Chrome/Edge/Safari,
bahasa id-ID, butuh internet & izin mikrofon). Firefox belum mendukung — tombol dinonaktifkan.

## Main Bareng Kelas (`js/game-room.js`)

Tutor/admin: **Game Battle → tab Main Bareng** → pilih jenis → Buat Ruang. Layar menampilkan kode
6 huruf (tampilkan di proyektor; ada tombol layar penuh). Siswa: **Game Battle → Main Bareng** →
masukkan kode, atau ketuk ruang yang sedang dibuka.

**Monster Co-op** — setiap soal satu ronde (15–60 dtk). Di HP siswa memilih jurus lalu menjawab;
layar kelas memutar pertarungannya (jurus satu per satu, angka kerusakan, monster membalas).

| Peran | Jurus 1 | Jurus 2 |
|---|---|---|
| Penyerang | Tebasan (34) | Serangan Berat (52, salah = −12 HP sendiri) |
| Penyihir | Bola Api (30) | Kutukan (16 + serangan monster −40%) |
| Penjaga | Perisai Kelompok (12 + luka semua teman −50%) | Provokasi (20, monster hanya menyerangnya, luka −50%) |
| Penyembuh | Pulihkan (36 HP ke teman terlemah / bangkitkan yang pingsan) | Berkah (semua teman +16) |

Benar = jurus kena; menjawab di 40% waktu awal = kritis (×1,6). Monster membalas 2 siswa
(Goblin), 3 siswa (Orc), atau semua (Golem). HP 0 = pingsan; bangkit lagi bila menjawab benar
atau disembuhkan. Darah monster = 60 / 90 / 135 × jumlah siswa. Semua pingsan = kalah.

**Balap Kelas** — tiap siswa menyetir mobilnya sendiri dari HP (pindah lajur, pakai item),
gerbang "?" berisi soal yang sama untuk semua. Benar = Turbo / Perisai / Oli (dilempar ke mobil
tepat di depan; korbannya mendapat peringatan dan bisa menghindar dengan pindah lajur); salah =
tergelincir. Layar kelas: peta sirkuit dengan nama, klasemen, lap, item, dan kabar lemparan oli.
Selesai saat semua finis, 60 detik setelah juara 1, atau 9 menit.

Skor Main Bareng masuk Riwayat & Peringkat (mode "Main Bareng") di game Pertarungan Monster /
Balapan Mobil. Ruang & pemain lebih dari 2 hari dirapikan otomatis oleh tuan rumah/pemiliknya.

## Layar penuh & skor

- Tombol layar penuh di HUD Game Battle, bilah Main Bareng (HP mentee), dan Games Area Arena. Memakai Fullscreen API
  bila ada, dan tampilan memenuhi layar (`.game-fs`) di peramban tanpa API itu (mis. iPhone). Esc/gesture sistem
  mengembalikan tampilan biasa; "Main Lagi" tetap di layar penuh; kanvas game arkade ikut membesar.
- Skor: jawaban/poin setelah waktu habis tidak lagi dihitung; hasil ronde disimpan sekali; "Rekor pribadi baru"
  hanya bila melampaui rekor lama; skor NaN tidak mungkin; balapan: pemain yang tidak tercatat di hasil tidak
  pernah menjadi juara; Kilat Hitung: jawaban kosong tidak dihitung.

## Kategori latihan & riwayat soal

- **Kategori latihan** (`js/qscope.js`) di tab Main dan Battle: semua subtest, satu atau beberapa subtest, atau
  per materi dan sub bab. Pilihan diingat per mentee. Jumlah game yang siap mengikuti kategori. **Cari Lawan** dengan kategori
  tertentu hanya mencocokkan tantangan terbuka berkategori sama; kategori "Semua subtest" menerima tantangan apa pun. Battle menyimpan `scope` (ringkas) dan `subject` (label).
- **Riwayat jawaban** (`lms_q_history`, dipakai bersama Arena Belajar): soal yang sudah dijawab benar disisihkan,
  soal yang salah dan soal baru tetap dimainkan. Bila sisa soal kurang dari syarat minimum game, kekurangannya diisi
  soal yang sudah dikuasai (paling lama dulu). Bila semua soal kategori itu sudah dikuasai, putaran baru dimulai dari
  semua soal dan mentee diberi tahu.
- Jawaban dicatat per soal saat ronde selesai (benar bila semua bagian soal benar). Mode pratinjau, tutor/admin, dan
  Main Bareng Kelas tidak dicatat. Soal battle disusun dari riwayat pembuat tantangan; tiap pemain mencatat hasilnya sendiri.

## Sumber & pengelolaan soal (admin/tutor)

- **Sumber soal** (Pengaturan, admin): Bank Soal + Soal Game (bawaan), Soal Game saja, atau Bank Soal saja.
- **Soal Game**: editor soal LMS yang sama (semua format kecuali Esai), pilih game tujuan
  (bawaan: semua game yang cocok), aktif/nonaktif. Tutor hanya mengubah soal miliknya.
- **Ambil dari Bank Soal**: pemilih soal halaman penuh (`js/qpicker.js`) — centang per soal, per materi, per kategori
  subtest, atau semua soal sekaligus; soal yang sudah disalin atau tidak cocok untuk game dilewati otomatis.
  Ikon menunjukkan game yang cocok untuk tiap soal.
- **Buat dengan AI**: pilih game → format menyesuaikan sistem game → AI membuat soal → tinjau → simpan.
- **Paket Soal Contoh**: 47 soal semua format agar semua game langsung bisa dimainkan.
- **Coba Game**: pratinjau tanpa menyimpan skor. **Ringkasan**: kesiapan soal per game & statistik.

## Teknis

| Data (tersinkron) | Isi | Aturan server (`api/_lib/rules.js`) |
|---|---|---|
| `lms_game_questions` | soal game | tulis: admin/tutor |
| `lms_game_battles` | battle & skor tiap pemain | pemain hanya mengubah skornya sendiri; transisi status divalidasi; pemenang dihitung server |
| `lms_game_scores` | riwayat skor | dibuat pemiliknya, tidak dapat diubah; skor angka wajar (±1.000.000), mode solo/battle/bot/kelas, hasil menang/kalah/seri |
| `lms_game_rooms` | ruang Main Bareng & keadaan pertarungan | hanya tutor/admin tuan rumah; kode/jenis/tuan rumah tetap; jam fase & mulai balapan dicap server; ukuran dibatasi |
| `lms_game_players` | peran, jawaban per ronde/gerbang, posisi mobil, lemparan oli | hanya siswa pemiliknya; jawaban terkunci setelah terkirim + cap waktu server; item & posisi divalidasi |
| `lms_q_history` | riwayat jawaban per mentee: `items[ref] = [benar 1/0, kali dijawab, waktu]`, `cycles` per kategori | hanya mentee pemiliknya yang menulis; dibaca pemilik & admin; bentuk & ukuran divalidasi |

Ruang & pemain yang lebih dari 12 jam tidak dikirim lagi ke peran lain. Perangkat di dalam
ruang menyinkron tiap 1,5 detik (tuan rumah) / 2 detik (siswa); bila Supabase Realtime aktif,
sinyal perubahan dikirim ke tuan rumah & pemain sehingga lebih cepat. Tuan rumah adalah wasit:
menilai ulang jawaban dengan kunci soal dan menghitung kerusakan. Waktu respons untuk serangan
kritis diukur di HP siswa (sejak soal tampil), jadi tidak dirugikan jeda jaringan.

Berkas: `js/games.js` (mesin, 10 game dasar, battle, halaman siswa), `js/games-arcade.js`,
`js/game-art.js`, `js/race-engine.js`, `js/voice-answer.js`, `js/game-room.js`,
`js/games-admin.js`, `js/games-starter.js`, `js/qscope.js`, `css/games.css`, `css/games-arcade.css`.
