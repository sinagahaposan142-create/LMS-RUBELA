# Uji Fitur Ronde 14 — Materi & Sub Materi, Remedial, Berita, Tools, Grup Belajar

Lingkungan uji: Node.js 22, server pengembangan (`node scripts/dev-server.js`, Turso tiruan),
Chromium headless lewat Playwright. Mode lokal (`file://`) dan mode server (beberapa browser
terpisah). Layar desktop 1280 px dan ponsel 390 px, tema terang dan gelap.

**Batasan lingkungan uji**
- Sandbox tidak dapat mengakses CDN. KaTeX dan SheetJS asli **tidak teruji**. Yang diuji adalah
  jalur tanpa CDN: renderer rumus bawaan, impor CSV, dan pembaca `.docx`/`.xlsx` bawaan (`js/office.js`).
- Tidak ada kunci API AI di sandbox. Analisis AI Kalkulator UTBK diuji dengan penyedia AI tiruan
  yang menggantikan `AI.ask`/`AI.chat`. Isi prompt dan alur tampilan diperiksa, kualitas jawaban AI sungguhan belum.

## Pemeriksaan otomatis

| Pemeriksaan | Hasil |
|---|---|
| `node --check` semua berkas `js/`, `api/`, `scripts/` | lulus |
| ESLint `no-undef` + `no-unused-vars` pada berkas yang diubah (konfigurasi sementara di luar repo) | 0 galat; peringatan variabel tak terpakai hanya pada kode lama |
| `node scripts/test-api.js` | **112/112 lulus** (55 lama + 17 Berita + 15 Tools + 25 Grup Belajar) |
| Sisa `console.log` / rahasia di berkas baru | tidak ada |

## 1. Materi & Sub Materi (commit `b711aac`)

| Skenario | Hasil |
|---|---|
| Kelola Materi per subtest: daftar bawaan UTBK (tombol), tambah, ganti nama, urutkan, hapus | berjalan; hapus materi yang masih dipakai meminta konfirmasi dan melepaskan rujukannya |
| Contoh dari permintaan: PU → Logika umum → "Logika Alam sadar umum dasar" | tersimpan dan tampil sebagai "Logika umum › Logika Alam sadar umum dasar" |
| Pemilih Materi/Sub Materi di editor soal, materi kelas, dan modul | tersimpan sebagai id (ganti nama tidak memutus rujukan) |
| Filter Bank Soal & wizard CBT, ambil soal acak dari filter | hanya soal dari materi terpilih |
| Kolom Materi & Sub Materi di impor/ekspor Excel/CSV Bank Soal | nama dicocokkan atau dibuat |
| Analisis penguasaan per materi (admin & siswa) | persentase benar per materi |
| Perbaikan: daftar subtest Bank Soal tinggi 0 px | tampil kembali |

Catatan: sebelum ronde ini, materi kelas dan modul **belum punya** taksonomi materi sama sekali. Taksonomi ditambahkan di sana juga.

## 2. Remedial (commit `f1ae039`)

| Skenario | Hasil |
|---|---|
| Sakelar remedial & nilai bawaan (KKM 75 / 500 untuk IRT, kebijakan nilai akhir) di admin | tersimpan; saat dimatikan tombol remedial hilang dan server menolak percobaan baru |
| Peserta otomatis: di bawah KKM, tidak ikut, atau keduanya; bisa ditambah/dikurangi manual | daftar sesuai nilai ujian induk |
| Jadwal tiap putaran, beberapa putaran | peserta di luar daftar/jadwal ditolak server (toleransi jam perangkat 10 menit) |
| Kebijakan nilai akhir: maks KKM / tertinggi / menggantikan | nilai akhir benar di hasil admin dan siswa |
| Notifikasi siswa & orang tua | terkirim |

## 3. Berita (commit `3a06216`)

| Skenario | Hasil |
|---|---|
| Admin: tulis berita dengan judul, ringkasan, sampul (diperkecil + potongan 16:10), kategori, slug | tersimpan; slug otomatis dari judul |
| **Impor Word**: `.docx` berisi judul, tebal/miring/garis bawah, sup/sub, tautan, daftar bertingkat & bernomor, tabel dengan sel gabungan, kutipan, gambar, rata tengah | semua masuk ke editor; persamaan Word masuk sebagai teks biasa dengan pemberitahuan |
| **Lembar Data** (ala Excel): isi sel, rumus `=AVERAGE(B2:B3)` → 650,25; impor `.xlsx` tanpa internet (tanggal, persen, desimal koma, BENAR/SALAH) | tabel disisipkan dengan hasil hitung |
| Tabel: urutkan A–Z, gabung ke kanan, pisahkan sel | benar |
| Status Draf / Terbit / Jadwalkan, berita utama (satu saja), pratinjau, simpanan sementara di perangkat lalu pulihkan | berjalan |
| Halaman depan: 1 berita utama + berita lain; draf & terjadwal tidak tampil | benar |
| `berita.html`: daftar, kategori, pencarian (tersimpan di URL), muat lebih banyak, artikel, berita terkait, salin tautan, WhatsApp, 404, tema gelap, ponsel | benar |
| Mode server: halaman publik tanpa login lewat `GET /api/rubela?action=news`; siswa membaca via API, tidak menyimpan berita di perangkat | benar; respons berhasil di-cache CDN 60 detik |
| Server menolak: penulis bukan admin, skrip di isi, slug tidak valid, sampul bukan gambar | ditolak |
| Perbaikan: sisipan dari dialog editor (tabel, Lembar Data) masuk di **awal** teks, bukan di posisi kursor | diperbaiki |
| Perbaikan: "Judul besar" (H2) hilang saat disimpan; PNG transparan menjadi hitam saat diperkecil | diperbaiki |

## 4. Tools: Kalkulator UTBK, Kalender Seleksi, Data PTN (commit `e93fa55`)

| Skenario | Hasil |
|---|---|
| Menu **Tools** di sidebar admin, tutor, mentee, orang tua; **Data PTN** khusus admin | benar |
| Data PTN: tambah kampus, fakultas (juga dari form jurusan), jurusan dengan rata-rata, minimum, skor per subtest, daya tampung, peminat, sumber | tersimpan; minimum > rata-rata ditolak |
| Impor CSV 6 baris (1 baris tanpa skor) | pratinjau "3 kampus, 5 jurusan baru", baris rusak dilaporkan dan **tidak** meninggalkan kampus kosong |
| Impor ulang berkas yang sama | 5 jurusan **diperbarui**, tidak dobel |
| Ekspor (CSV bila SheetJS tidak termuat) dan templat | berkas terunduh |
| Kalkulator: 7 skor, input 1200 ditandai salah, desimal koma | rata-rata 695,8, total 4.870,5, 7/7 |
| Cari "informatika uun" → Enter | Kampus → Fakultas → Jurusan terisi otomatis |
| Hasil: peluang 82% "Peluang tinggi", rata-rata & minimum diterima, total 7 subtest jurusan, keketatan 3,33% (±1 dari 30), selisih per subtest, jurusan serupa yang lebih aman, cara perhitungan | benar |
| Simpan & bandingkan pilihan (maks 4), tersimpan setelah pindah menu | benar |
| "Isi dari tryout LMS" | mengambil rata-rata IRT 3 tryout terakhir per subtest |
| Analisis AI (penyedia tiruan): prompt berisi data jurusan, skor, hasil model, alternatif; jawaban markdown dirender; tanya lanjut AI | benar. Tanpa kunci AI muncul pemberitahuan dan tombol nonaktif |
| Kalender Seleksi: admin tambah SNBT, SNBP, Mandiri, Lainnya; duplikat; filter jalur; tampilan bulan | dikelompokkan Berlangsung / Akan datang / Selesai dengan hitung mundur |
| Mentee "Ingatkan saya" | notifikasi "Dimulai H-2" dan "Ditutup besok" langsung; tidak dikirim dua kali |
| Unduh `.ics`, penanda di menu Kalender (klik membuka Kalender Seleksi) | benar |
| Server: guru tidak boleh mengubah data PTN; skor > 1000, kode subtest asing, tanggal terbalik, tautan `javascript:` ditolak; rencana UTBK hanya terlihat/ditulis pemiliknya (dan admin) | benar |

## 5. Grup Belajar (commit `1943a73`)

| Skenario | Hasil |
|---|---|
| Admin membuat grup: filter kelas → "Pilih yang tampil", tutor, warna | anggota & tutor mendapat notifikasi |
| Pesan dengan rumus `$a^2+b^2=c^2$` dan tautan | dirender seperti Chat |
| Kirim **kuis** dari Bank Soal (filter subtest + materi), **bahan diskusi**, **materi**, **pengumuman** (tersemat) | tampil sebagai kartu; anggota mendapat notifikasi |
| Mentee: tidak ada tombol "+"; mengerjakan kuis (draf tersimpan otomatis), kirim → 0/3 benar, kunci & pembahasan tampil, jawaban terkunci | benar |
| Mentee membalas diskusi; kartu menjadi "Lihat 1 balasan" | benar |
| Mentee hanya dapat menyunting/menghapus pesannya sendiri | benar |
| Tutor: hasil kuis per anggota & per soal, atur ulang jawaban, hapus pesan mentee | benar |
| Bukan anggota | "Kamu belum dimasukkan ke grup belajar mana pun." |
| Arsipkan → kotak pesan hilang; hapus grup → kiriman & jawaban ikut terhapus | benar |
| Ponsel 390 px: daftar ↔ percakapan dengan tombol kembali | benar |
| Mode server, 3 browser: pesan admin tampil di mentee, balasan mentee muncul di admin tanpa muat ulang; mentee lain tidak menerima data grup | benar |
| Mentee menyelipkan pengumuman palsu langsung ke penyimpanan | server menolak, data palsu hilang dari perangkat |
| Mentee dikeluarkan dari grup | grup hilang dari perangkatnya setelah sinkron |
| Server: kuis lewat batas waktu, jawaban yang sudah dikirim, jawaban untuk kiriman non-kuis, grup diarsipkan, isi materi berskrip | ditolak |

## Batasan yang perlu diketahui

- **Peluang di Kalkulator UTBK adalah perkiraan sederhana, bukan prediksi resmi SNPMB.** Model:
  Φ((rata-rata skor − ambang) ÷ 30 atau 35). Halaman menampilkan cara perhitungannya.
- **Tidak ada data kampus, jurusan, atau tanggal seleksi bawaan.** Semua diisi admin dari sumber resmi agar tidak ada angka karangan.
- Skor tryout LMS memakai skala IRT cohort 200–800, berbeda dari skor UTBK resmi.
- Kunci jawaban kuis grup (seperti CBT) ada di perangkat anggota, dan skor dihitung di perangkat.
  Server menjaga keanggotaan, batas waktu, dan kunci jawaban yang sudah dikirim, tetapi tidak menghitung ulang skor.
- Penanda "belum dibaca" grup tersimpan per perangkat.
- Isi berita disanitasi di peramban saat simpan dan tampil; server menambah pemeriksaan pola skrip.
  Halaman publik memakai cache CDN ±1 menit, jadi perubahan berita bisa terlambat tampil sebentar.
- Impor Word tidak membawa persamaan Word (jadi teks biasa), kotak teks, dan gambar EMF/WMF. Berkas `.doc`/`.xls` lama perlu disimpan ulang sebagai `.docx`/`.xlsx`, atau butuh SheetJS (CDN) untuk `.xls`.

## Uji manual setelah deploy

1. Buka `/` dan `/berita.html` tanpa login setelah menerbitkan satu berita: berita tampil, rumus di isi berita dirender KaTeX.
2. Impor satu `.xlsx` asli dari Excel di Lembar Data dan di Data PTN.
3. Isi kunci AI di Pengaturan → Integrasi AI, lalu coba "Analisis dengan AI" di Kalkulator UTBK.
4. Kirim satu pesan grup dari ponsel mentee dan pastikan tampil di dashboard admin tanpa muat ulang.
