# Audit Fitur Ronde 6 — Presence, Ticker, Grading AI, IRT, dan Whiteboard

Dokumen ini mencatat implementasi dan hasil pengujian permintaan lanjutan LMS Rubela.
Semua fitur diuji pada panel **admin, tutor, siswa, dan orang tua**. Aplikasi tetap
berbasis HTML/CSS/JavaScript murni dan menyimpan data pada `localStorage`.

## Ringkasan hasil

| Area | Status | Bukti utama |
|---|---|---|
| Status online admin/tutor | ✅ | Heartbeat, TTL, deduplikasi pengguna, scope kelas tutor, metadata perangkat, BFCache resume |
| Papan berjalan | ✅ | Permanen di semua dashboard, audience sama dengan Pengumuman, pause/resume, responsif |
| Pengumuman link + gambar | ✅ | URL aman otomatis biru, upload terkompresi, race upload dicegah |
| Pemeriksa esai/isian | ✅ | Isian deterministik+toleran; esai berupa saran Gemini, batch, konfirmasi, audit trail |
| Skor CBT IRT/cohort | ✅ | Benar=1, salah/kosong=0, tanpa minus, bobot empiris, skala 200–800 |
| Whiteboard per kelas | ✅ | Vector canvas, undo/redo, autosave, conflict merge, permissions, read-only siswa/ortu |
| Autosave CBT/tugas | ✅ | Draft tugas 1 detik; deadline bagian CBT tahan refresh |
| Regresi lintas panel | ✅ | 246 render halaman, 0 error, 0 overflow, 0 halaman kosong, 0 tombol mati |

## 1. Status online (admin dan tutor)

### Implementasi

Modul baru `js/presence.js` menjalankan:

- heartbeat setiap **15 detik**;
- TTL online **50 detik**;
- status **Aktif** / **Menjauh** berdasarkan visibility dan aktivitas;
- satu status per pengguna meskipun membuka beberapa tab;
- halaman aktif, browser, sistem operasi, dan jenis perangkat;
- sinkronisasi cepat dengan `BroadcastChannel`, serta fallback event `storage`;
- penghentian saat logout/pagehide dan pemulihan pada BFCache `pageshow`;
- halaman **Sedang Online** pada admin dan tutor;
- scope tutor hanya co-tutor dan siswa pada kelas yang diampunya.

### Privasi dan batas arsitektur

LMS **tidak mengambil alamat IP**. Permintaan memperbolehkan IP *atau data lainnya*,
sehingga implementasi memilih metadata perangkat yang lebih aman. Karena tidak ada backend,
presence hanya akurat antar-tab/window pada browser profile dan origin yang sama.
Status global lintas perangkat membutuhkan backend realtime (WebSocket/SSE/Firebase/Supabase).
UI menyampaikan batas ini secara eksplisit agar tidak menyesatkan.

## 2. Papan berjalan di atas dashboard

Papan berjalan berada permanen di bawah topbar pada seluruh panel. Sumbernya adalah
pengumuman yang dicentang **Tampilkan di papan berjalan**, sehingga aturan sasaran
`semua / peran / kelas / individu` identik dengan halaman Pengumuman.

Fitur aksesibilitas:

- tombol jeda/lanjut;
- otomatis berhenti saat hover/focus;
- `prefers-reduced-motion` mematikan animasi;
- klik teks membuka halaman Pengumuman;
- fallback ucapan selamat datang saat belum ada pengumuman ticker.

Bug yang ditemukan dan diperbaiki saat review: ticker pertama sempat dirender sebelum
`Dashboard` diekspor sehingga klik awal tidak bekerja. API Dashboard kini tersedia sebelum
paint ticker pertama.

## 3. Pengumuman: link otomatis dan gambar

`js/shared.js` kini menyediakan satu policy audience (`isAnnouncementVisible`) yang dipakai
oleh halaman dan ticker. Perbaikan tambahan:

- URL `http://` / `https://` otomatis menjadi tautan biru;
- teks di-escape sebelum auto-link untuk mencegah XSS;
- tautan memakai `target="_blank" rel="noopener noreferrer"`;
- upload PNG/JPG/WebP/GIF, kompresi gambar, pratinjau, dan hapus gambar;
- tombol Kirim dinonaktifkan selama gambar diproses;
- token pekerjaan mencegah hasil upload lama menimpa file terbaru;
- kelas/individu wajib memiliki minimal satu sasaran;
- tutor hanya dapat menargetkan kelas yang diampunya;
- admin dapat memoderasi pengumuman tutor.

Bug lama yang ikut diperbaiki: pengumuman target kelas tidak sampai ke tutor karena tutor
keliru diperiksa sebagai enrollment siswa.

## 4. Pemeriksa otomatis esai dan isian singkat

### Isian singkat

`Exam.gradeQuestion()` tetap deterministik:

- pencocokan persis terlebih dahulu;
- normalisasi aman kapital, spasi, tanda baca, dan diakritik;
- angka mendukung koma/titik dan toleransi absolut/relatif bila dikonfigurasi;
- tidak memakai fuzzy typo yang berisiko menganggap jawaban berbeda sebagai benar;
- hasil memuat `reason` dan `confidence`.

### Esai/uraian dengan Gemini

Modul baru `js/autograder.js` **tidak langsung menetapkan nilai**. Alurnya:

1. Admin/tutor pembuat tugas menjalankan pemeriksaan satu batch.
2. Gemini menerima instruksi tugas, rubrik, dan jawaban tanpa PII yang tidak perlu.
3. Hasil tersimpan sebagai proposal: skor, confidence, alasan, feedback, model, hash jawaban,
   dan snapshot rubrik.
4. Admin/tutor meninjau atau menekan **Terapkan Saran Sekaligus**.
5. Nilai final dan setiap keputusan masuk `gradingHistory`.

Perlindungan penting:

- jawaban siswa diperlakukan sebagai input tidak tepercaya (prompt injection diabaikan);
- hanya admin/tutor pemilik tugas yang boleh menjalankan atau menerapkan;
- saran stale ditolak bila jawaban berubah;
- nilai manual tidak dapat ditimpa batch AI, termasuk race antar-tab;
- resubmit identik tidak membatalkan nilai;
- resubmit yang benar-benar berubah membatalkan nilai/saran lama dan mencatat event audit;
- tutor dapat mengisi kunci Gemini perangkatnya melalui **Profil → Integrasi AI Perangkat Ini**.

Rubrik pemeriksaan ditambahkan pada editor Tugas dan ikut tersimpan pada assignment.

## 5. Skor CBT/tryout berbobot IRT/cohort

Modul baru `js/scoring.js` mempertahankan `score` 0–100 lama untuk kompatibilitas,
kemudian menambahkan `attempt.scoring` dengan model `empirical-1PL-cohort-v1`.

### Tahapan perhitungan

1. **Poin dasar:** benar = 1; salah/kosong = 0; esai = belum terukur; tanpa minus.
2. **Kesulitan empiris:** setiap item dihitung dari seluruh attempt yang telah submit pada
   CBT yang sama. Jeffreys smoothing mencegah probabilitas ekstrem pada cohort kecil.
3. **Bobot:** soal yang jarang benar mendapat bobot lebih tinggi (`1/p`), dibatasi 0,75–3
   agar satu soal tidak mendominasi.
4. **Estimasi kemampuan:** model 1PL/Rasch-like menggunakan MAP Newton dengan prior normal,
   stabil untuk peserta yang benar semua atau salah semua.
5. **Skala:** `500 + 100 × theta`, dibatasi **200–800**.
6. **Rekalibrasi:** setiap submit baru menghitung ulang seluruh peserta pada CBT tersebut,
   karena karakteristik item bersifat relatif terhadap cohort.
7. **Freshness:** signature mencakup struktur soal, kunci, kebijakan isian, jawaban, dan waktu
   submit. Mengubah kunci otomatis membuat skor lama dihitung ulang.

Hasil 200–800 tampil pada hasil siswa, daftar CBT siswa, hasil admin/tutor, panel orang tua,
dan Rekapan. Progress/indeks internal lama tetap memakai persentase 0–100 agar tidak rusak.

### Batas metodologis

Aplikasi tidak memiliki peserta/data nasional. Karena itu UI selalu menyebutnya
**skor cohort LMS / Rasch-like**, bukan skor nasional resmi. Cohort di bawah 30 peserta diberi
label **sementara**. CBT esai-only tidak diberi skor palsu 500; hasilnya **menunggu nilai esai**.
Pada CBT campuran, item esai ditandai menunggu tutor dan tidak masuk kalibrasi objektif.

Contoh pengujian 4 peserta: item mudah `p=0,9` berbobot `1,1111`, item sulit `p=0,3`
berbobot `3`; skor peserta berada pada 678, 538, 410, 410 (seluruhnya dalam 200–800).

## 6. Whiteboard per kelas

Modul baru `js/whiteboard.js` dan penyimpanan `lms_whiteboards` menyediakan:

- canvas vector dengan koordinat 0–1 agar responsif;
- pena, penghapus, warna, ketebalan, undo, redo, hapus semua;
- HiDPI/DPR dan `ResizeObserver`;
- autosave maksimum setiap 1 detik, serta flush saat pointer-up, pagehide, dan destroy;
- revision, timestamp, dan aktor terakhir;
- sinkronisasi `BroadcastChannel` + `storage`;
- antre remote update yang datang saat pengguna sedang menggambar;
- merge berdasarkan stroke ID, `deletedIds` tombstone, dan `clearEpoch` untuk konflik hapus;
- otorisasi ulang pada setiap write, bukan hanya menyembunyikan toolbar.

Hak akses:

- admin dan tutor yang ditugaskan: edit;
- siswa terdaftar: baca;
- orang tua dari anak terdaftar: baca;
- siswa/tutor lain: ditolak pada layer DB dan handler.

Whiteboard tersedia sebagai tab pada detail kelas admin, tutor, dan siswa. Orang tua membuka
whiteboard read-only melalui kartu **Kelas & Guru**.

Seperti presence, sinkronisasi saat ini hanya antar-tab pada origin/browser yang sama.
Sinkronisasi lintas perangkat memerlukan backend realtime.

## 7. Autosave CBT dan tugas

- Draft tugas tersimpan pada `lms_assignment_draft:{student}:{assignment}` maksimal satu detik
  setelah input, dipulihkan bila lebih baru dari submission, disimpan juga saat Batal, dan
  dihapus setelah submit berhasil.
- Draft kosong dipertahankan sebagai kosong; tidak menghidupkan kembali jawaban lama.
- Reset data membersihkan seluruh draft dinamis dan presence.
- Deadline setiap bagian CBT disimpan pada `attempt.sectionDeadlines`; reload/resume memakai
  timestamp yang sama sehingga siswa tidak memperoleh tambahan waktu.

## 8. Review dan hasil pengujian

Review independen pertama menemukan 11 isu (3 high, 7 medium, 1 low). Seluruhnya diperbaiki:

- nilai manual tertimpa AI;
- resubmit identik membatalkan nilai;
- lost update whiteboard;
- bypass write siswa;
- listener whiteboard bocor;
- CBT esai-only mendapat 500/800 palsu;
- freshness skor tidak memuat kunci/jawaban;
- presence tidak pulih dari BFCache;
- klik ticker awal mati;
- race kompresi gambar;
- draft kosong menghidupkan jawaban lama.

Pengujian akhir:

- syntax check semua `js/*.js`: lulus;
- **246 render halaman**: admin 24, tutor 19, siswa 18, orang tua 13 pada 1440×900,
  768×1024, 390×844, ditambah admin 1280×620;
- 0 error JavaScript;
- 0 unhandled promise rejection;
- 0 horizontal overflow;
- 0 halaman kosong;
- 0 tombol aktif tanpa handler;
- pengujian terarah untuk presence, ticker, audience pengumuman, upload race, grading AI,
  resubmission, IRT, essay-only, perubahan kunci, whiteboard conflict/tombstone/permissions,
  autosave draft, deadline CBT, serta tampilan lintas panel: seluruhnya lulus.

Live Gemini tidak diuji dari sandbox karena mode jaringan tidak mengizinkan internet umum.
Jalur loading, tanpa kunci, network error, parse error, proposal, audit, dan konfirmasi telah
diuji. Uji koneksi live tetap dilakukan melalui tombol **Uji Koneksi Gemini** pada browser
pengguna yang memiliki akses internet.
