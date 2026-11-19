# Uji Fitur Ronde 13 — Rumus, Chat, Video Pembahasan, Penyimpanan, Course Berbayar

Lingkungan uji: Node.js 22, server pengembangan (`node scripts/dev-server.js`, Turso tiruan),
Chromium headless lewat Playwright. Ukuran layar: desktop 1200–1280 px dan ponsel 390 px (sentuh).

**Batasan lingkungan uji:** sandbox tidak dapat mengakses CDN (jsdelivr, youtube.com). Karena itu
KaTeX, MathLive, dan YouTube IFrame API asli **tidak teruji di sini**. Yang diuji: jalur cadangan
saat CDN gagal, dan logika pemutar terkunci memakai tiruan `YT.Player` dengan API yang sama.
Setelah deploy, lakukan uji manual singkat di bagian "Uji manual setelah deploy".

## Pemeriksaan otomatis

| Pemeriksaan | Perintah | Hasil |
|---|---|---|
| Sintaks semua JS | `node --check` untuk `js/`, `api/`, `scripts/`, `sw.js` | lulus |
| ESLint `no-undef`, `no-unused-vars` (berkas yang diubah) | konfigurasi sementara di luar repo | 0 galat; 4 peringatan variabel tak terpakai yang sudah ada sebelum ronde ini |
| Uji API end-to-end | `node scripts/test-api.js` | **46/46 lulus** |
| Sisa `console.log` / secret | `git diff` sejak `581e731` | hanya keluaran CLI di `scripts/test-api.js` dan kredensial uji database tiruan |

Proyek tidak punya langkah build atau TypeScript, jadi tidak ada type-check terpisah.

## 1. Rumus matematika

| Skenario | Hasil |
|---|---|
| Toolbar "Pecahan" → isi pembilang, Tab, isi penyebut | `\frac{a}{b}` |
| Ketik `\sq` → saran muncul → Enter | `\sqrt{}` dengan kursor di dalam kurung |
| Alt+1 | `\frac{}{}` disisipkan |
| `\frac{1}{2` | pesan "Ada 1 kurung kurawal "{" yang belum ditutup", tombol menjadi "Sisipkan tetap", tidak crash |
| `\foo{1}`, `}x`, `\begin{pmatrix}…\end{bmatrix` | pesan galat yang sesuai |
| Template "Determinan 2×2" | dirender sebagai matriks (renderer cadangan) |
| Tab Visual tanpa internet | pesan "Editor visual tidak dapat dimuat…", kembali ke mode LaTeX |
| Ctrl+Enter | rumus disisipkan, masuk riwayat, dialog tertutup |
| Ponsel 390 px, rumus panjang | dialog jadi bottom sheet, halaman tidak melebar, rumus bisa digulir |
| Rumus di chat `$\frac{1}{2}x^2$` | dirender di gelembung pesan |

## 2. Chat (tiga browser: admin, guru desktop, siswa ponsel; mode server)

| Skenario | Hasil |
|---|---|
| Siswa kirim 2 pesan (rumus + tautan) → muncul di guru | lulus; rumus dirender, tautan bisa diklik |
| Hover pesan (desktop) → tombol Balas | tombol tampil; bar "Membalas …" muncul |
| Kirim balasan | kutipan tampil di atas pesan |
| Klik kanan pesan | menu Balas / Teruskan / Salin teks (Hapus hanya untuk pesan sendiri) |
| Teruskan → cari "admin" → pilih → kirim | admin menerima pesan bertanda "Diteruskan dari Siswa Tes" |
| Siswa geser kanan ≥ 64 px (sentuh) | indikator aktif, bar balasan terbuka |
| Geser vertikal (gulir) | tidak memicu balasan |
| Tekan lama pesan sendiri → Hapus | "Anda menghapus pesan ini"; di guru "Pesan ini telah dihapus"; kutipan berubah "Pesan telah dihapus" |
| Klik kutipan | lompat & sorot pesan asal |
| Penerima mencoba mengubah isi pesan lewat API | ditolak server: "Pesan milik pengguna lain tidak dapat diubah." |
| API: pengirim palsu, pesan kosong, > 2000 karakter, kirim ke diri sendiri, hapus permanen oleh siswa | semua ditolak; admin juga terkena validasi isi |

## 3. Video pembahasan YouTube

| Skenario | Hasil |
|---|---|
| 16 variasi URL (watch, m., youtu.be, shorts, embed, nocookie, live, ID polos, domain palsu, ID pendek, injeksi, javascript:) | semua sesuai harapan |
| Editor soal: link bukan YouTube | pesan galat, simpan ditolak |
| Editor soal: `youtube.com/shorts/…` + cegah loncat | terdeteksi, pratinjau kartu dengan lencana |
| Konten tersimpan berisi kartu palsu (`onclick`, gambar dari domain lain) | dibangun ulang dari ID; atribut berbahaya dan gambar asing hilang |
| Embed YouTube dari editor lalu disanitasi | kartu tetap ada (sebelumnya iframe terbuang saat disimpan) |
| API YouTube tidak terjangkau | "Pemutar YouTube tidak dapat dimuat…" + tombol Coba lagi |
| Video materi/rekaman biasa | iframe `youtube-nocookie.com` dimuat saat diklik |
| Tiruan YT.Player: `playerVars` | `controls:0, disablekb:1, rel:0, fs:0`, host nocookie |
| Event kecepatan 2x | dikembalikan ke 1x + pesan |
| Kecepatan diubah tanpa event | dikembalikan ke 1x oleh pemeriksaan 500 ms |
| Geser bilah ke 80% (cegah loncat aktif) | ditahan di posisi terjauh yang sudah ditonton |
| Lompat lewat API (mis. konsol) | dikembalikan oleh pemeriksaan berkala |
| Mundur | boleh |
| Spasi | jeda/putar |
| Galat 150 / 100 | pesan embed dinonaktifkan / video dihapus atau privat |
| Server: ID tidak valid atau URL non-YouTube (juga admin) | ditolak |

## 4. Penyimpanan berkas

| Skenario | Hasil |
|---|---|
| Admin unggah QRIS PNG | lulus |
| Guru unggah QRIS | 403 |
| HTML yang menyamar `image/png` | 400 "Berkas harus berupa gambar…" |
| Siswa membaca QRIS | lulus |
| Siswa unggah bukti JPG dengan tipe `application/octet-stream` | lulus, tipe dicatat `image/jpeg` dari isi berkas |
| Timpa bukti yang sudah tersimpan | 403 |
| Siswa lain unggah/baca bukti siswa1; guru baca bukti | 403 |
| Admin baca bukti | lulus |
| Siswa hapus bukti | 403 |
| Bukti > 3 MB, kunci tidak valid | ditolak |

## 5. Course berbayar

API (`scripts/test-api.js`):

| Skenario | Hasil |
|---|---|
| Harga < Rp1.000; berbayar tanpa rekening/QRIS (admin) | ditolak |
| Siswa & guru menarik data course berbayar | kurikulum tampil, isi/URL/soal tidak terkirim (`ISI RAHASIA` tidak ada di respons) |
| Admin menarik data | isi lengkap |
| Siswa membuat progres sebelum disetujui | ditolak |
| Nominal salah, bukti milik siswa lain | ditolak |
| Siswa mengirim status "approved" | dipaksa "pending"; catatan disanitasi |
| Pembayaran ganda saat menunggu; siswa mengubah pembayaran; guru membuat pembayaran | ditolak |
| Siswa lain melihat pembayaran siswa1 | tidak terkirim |
| Admin menolak tanpa alasan | ditolak |
| Admin menyetujui | `decidedBy`/`decidedAt` dicatat server; siswa menerima isi lengkap; progres boleh dibuat |
| Admin mencabut akses | course ikut tersinkron ulang ke perangkat siswa dalam keadaan terkunci |

Browser (admin desktop + siswa ponsel, mode server):

| Skenario | Hasil |
|---|---|
| Admin ubah course jadi Berbayar, ketik `150000` | tampil `150.000` |
| Unggah QRIS lewat editor, simpan | `qris:<course>:<waktu>`, rekening tersimpan |
| Salinan course di perangkat siswa | terkunci, isi tidak ada |
| Katalog & halaman course | harga Rp150.000 |
| Checkout | nomor rekening, QRIS dari server, tombol kirim nonaktif sebelum ada berkas |
| Pilih berkas teks | "Bukti harus berupa gambar PNG, JPG, atau WEBP." |
| Kirim bukti gambar + catatan | status "Menunggu verifikasi admin" |
| Bergabung paksa lewat konsol sebelum disetujui | ditolak di klien (dan di server, lihat API) |
| Admin: menu Pembayaran Course | baris siswa, thumbnail bukti termuat, notifikasi "Bukti pembayaran baru" |
| Setujui | tab Menunggu (0) |
| Siswa setelah sinkron | course terbuka, sudah terdaftar, isi pelajaran tampil di pemutar |

## Uji manual setelah deploy (perlu internet)

1. Buka editor soal → Editor Rumus → pastikan pratinjau memakai KaTeX (huruf rumus khas KaTeX) dan tab Visual memuat MathLive.
2. Tambahkan video pembahasan pada satu soal, selesaikan ujian sebagai siswa, putar video: cek kontrol kustom, coba ubah kecepatan lewat menu YouTube (tidak tersedia) dan geser bilah ke depan (ditahan bila opsi aktif).
3. Coba satu video yang embed-nya dinonaktifkan pemilik: pesan galat harus tampil.
4. Ulangi alur course berbayar di dua perangkat nyata.
