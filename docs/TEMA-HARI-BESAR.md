# Tema Hari Besar Nasional

Admin dapat mengganti tampilan seluruh LMS sesuai hari besar nasional lewat menu
**Operasional → Tema Hari Besar**. Tema dipilih **manual**: aktifkan saat harinya tiba,
lalu kembalikan ke tema bawaan setelah selesai. Tema berlaku untuk semua peran
(admin, tutor, mentee, orang tua) dan semua perangkat, termasuk halaman masuk.

## Daftar tema dan unsurnya

| Tema | Tanggal | Unsur khas |
|---|---|---|
| Tahun Baru Masehi | 1 Januari | kembang api, langit malam berbintang, jam tengah malam, untaian lampu emas, angka tahun |
| Tahun Baru Imlek | 1 Cia Gwee (Jan–Feb) | lampion merah, bunga mei, koin emas, nuansa merah–emas, shio & unsur tahun, tahun Kongzili |
| Hari Raya Nyepi | sehari setelah Tilem Kesanga (Maret) | candi bentar, kain poleng, canang sari & dupa, langit tilem tanpa bulan, jendela padam (Amati Geni), Catur Brata Penyepian, tahun Saka |
| Hari Raya Idulfitri | 1 Syawal | masjid & menara, bulan sabit & bintang, ketupat, hijau–emas, ucapan mohon maaf lahir dan batin, tahun Hijriah |
| Hari Pendidikan Nasional | 2 Mei | buku terbuka, toga, pensil, trilogi Ki Hajar Dewantara, biru–emas |
| Kenaikan Yesus Kristus | 40 hari setelah Paskah (dihitung otomatis) | awan, berkas cahaya dari langit, salib, biru langit |
| Hari Raya Waisak | purnama Waisak (Mei–Juni) | stupa, bulan purnama, teratai, lampion terbang, warna bendera Buddhis, tahun BE |
| Hari Raya Iduladha | 10 Zulhijah | bulan sabit & bintang, kubah masjid, domba kurban, zaitun–pasir, tahun Hijriah |
| Hari Lahir Pancasila | 1 Juni | lima simbol sila (bintang, rantai, beringin, kepala banteng, padi & kapas) dan teks kelima sila |
| Hari Anak Nasional | 23 Juli | balon, layang-layang, pesawat kertas, matahari, umbul-umbul pelangi |
| Proklamasi Kemerdekaan RI | 17 Agustus | bendera Merah Putih berkibar, umbul-umbul merah putih, angka HUT RI, kembang api, konfeti |
| Hari Guru Nasional | 25 November | papan tulis "Terima kasih, Guru!", apel, buku & kapur, kelopak bunga |
| Hari Raya Natal | 25 Desember | pohon Natal, bintang, kado, lampu Natal, salju turun, kampus bersalju |

Lambang Negara Garuda Pancasila sengaja tidak digambar. Tema Pancasila hanya memakai
kelima simbol sila secara terpisah.

Tanggal Idulfitri, Iduladha, Imlek, Nyepi, dan Waisak ditetapkan pemerintah setiap tahun
(SKB 3 Menteri), sehingga LMS tidak menebak tanggalnya. Untuk tanggal tetap dan Kenaikan,
halaman admin menampilkan hari besar terdekat, tombol "Aktifkan sekarang" pada harinya,
dan pengingat bila tema masih aktif lebih dari 3 hari setelah harinya lewat.

## Yang berubah saat tema aktif

- Warna utama, tombol, tautan, menu aktif, cincin fokus, dan latar halaman (terang & gelap).
- Hero sambutan di setiap dashboard: gradien tema, untaian (garland), dan ilustrasi SVG.
- Kartu ucapan di Overview semua peran, dengan teks yang menyesuaikan tahun
  (mis. "Dirgahayu Republik Indonesia ke-81", "Tahun Baru Saka 1948", "1 Syawal 1447 H").
- Halaman masuk: pita ucapan, panel hero, langit kampus (mis. salju saat Natal, langit gelap
  tanpa bulan dan jendela padam saat Nyepi), dan warna tombol.
- Lencana kecil di logo sidebar, garis warna di topbar/sidebar, dan warna bilah alamat ponsel.
- Partikel animasi (salju, kembang api, lampion, balon, konfeti, kelopak, bintang).

## Pengaturan admin

- **Aktifkan / Nonaktifkan** tema (meminta konfirmasi, berlaku untuk semua pengguna).
- **Pratinjau**: hanya terlihat di perangkat admin dan tidak disimpan. Pratinjau berakhir
  saat admin meninggalkan halaman Tema Hari Besar.
- **Ucapan kustom** per tema (judul ≤ 80 karakter, pesan ≤ 240 karakter). Bisa disiapkan
  sebelum harinya tiba. Kosongkan untuk memakai ucapan bawaan.
- **Animasi dekorasi** dan **kartu/pita ucapan** dapat dimatikan untuk semua pengguna.

Setiap pengguna juga dapat mematikan animasi atau menutup ucapan di perangkatnya sendiri.
Ucapan yang ditutup muncul lagi pada tahun berikutnya. Animasi tidak diputar bila sistem
operasi meminta "kurangi gerakan" dan selama ujian berlangsung.

## Teknis

| Bagian | Berkas |
|---|---|
| Katalog tema, ilustrasi SVG, partikel, kartu ucapan, halaman admin | `js/holiday-theme.js` |
| Pemetaan variabel `--hd-*` ke token design system | `css/holiday-themes.css` |
| Skrip pra-render (tanpa kedipan) | `<head>` di `index.html` & `dashboard.html` |
| Tema untuk pengunjung yang belum masuk | `health()` di `api/_lib/handlers.js`, dipakai `js/login.js` |

- Pengaturan disimpan di `lms_settings`: `holidayTheme` (`''` = bawaan), `holidayEffects`,
  `holidayBanner`, `holidayMessages` (`{ idTema: { title, text } }`). Pengaturan ini tersinkron
  ke server seperti pengaturan lain, dan hanya admin yang dapat mengubahnya.
- `lms_holiday_cache` dan `lms_holiday_prefs` adalah kunci localStorage lokal per perangkat
  (tidak ada di `js/sync-catalog.js`). Cache dipakai skrip pra-render agar tema terpasang
  sebelum paint pertama.
- Menambah tema baru: tambahkan entri di `THEMES`, lalu fungsi dengan id yang sama di `ART`,
  `GARLAND`, `PATTERN`, `ICON`, dan `FX` (semuanya di `js/holiday-theme.js`). CSS tidak perlu diubah.
