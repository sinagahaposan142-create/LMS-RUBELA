# Kredit & Lisensi — Ilustrasi Kampus (Halaman Awal LMS Rubela)

Halaman awal memakai **ilustrasi SVG orisinal** (`assets/campus-skyline.svg`) sebagai
tampilan bawaan skyline kampus. Ilustrasi ini dibuat sendiri, bukan salinan foto, dan
**tidak memakai logo/nama/lambang resmi** universitas mana pun — hanya siluet yang diabstraksi.

## Slot foto opsional (Rute A1 — hybrid)

Jika Anda ingin mengganti/menimpa skyline SVG dengan **foto nyata**, halaman awal sudah
menyediakan slot `<picture>` di dalam `.lp-campus`. Taruh berkas foto di folder ini
(`assets/campus/`) dengan nama yang dirujuk `index.html`:

| Slot        | Nama berkas yang dicari | Gedung (sesuai brief)          |
|-------------|-------------------------|--------------------------------|
| skyline     | `skyline.webp` / `.jpg` | Panorama/montase 5 gedung      |

> Jika berkas tidak ada, SVG tetap tampil — halaman tidak akan pernah kosong.
> Aktifkan foto dengan menambahkan atribut `data-campus-photo` pada elemen `.lp-campus`
> (lihat komentar di `index.html`). Tanpa atribut itu, hanya SVG yang dipakai.

## Aturan lisensi yang WAJIB dipatuhi (Pilihan A)

- **Hanya** gunakan foto berlisensi **CC BY 4.0** atau **CC0 / Public Domain**.
- **JANGAN** gunakan foto berlisensi **CC BY-SA** (ShareAlike) karena kewajiban
  "ShareAlike" dapat menular ke kode turunan. Jangan pula memakai lisensi **NC**
  (non-komersial) atau **ND** (tanpa turunan).
- Untuk setiap foto CC BY, **wajib** mencantumkan: judul karya, nama pembuat,
  lisensi, dan tautan sumber. Isi tabel di bawah dan blok atribusi di `index.html`
  (elemen `.lp-campus-credit`).

## Tabel atribusi (isi saat Anda menambahkan foto)

| Berkas | Judul / sumber (URL Wikimedia) | Pembuat | Lisensi | Perubahan |
|--------|--------------------------------|---------|---------|-----------|
| _(belum ada)_ | | | | |

## Catatan verifikasi lisawan (hasil penelusuran, perlu dicek ulang sebelum dipakai)

Penelusuran menunjukkan sebagian besar foto gedung rektorat 5 PTN di Wikimedia Commons
berlisensi **CC BY-SA** (TIDAK boleh dipakai di Pilihan A). Kandidat yang kemungkinan
aman masih harus diverifikasi langsung di halaman berkasnya:

- Unair — `File:Universitas Airlangga.jpg` ditandai "free for commercial use without
  attribution required" (indikasi CC0/PD) — **verifikasi dulu** apakah benar gedung
  rektorat dan benar CC0 sebelum dipakai.
- UGM/IPB/UI/ITB — belum ditemukan foto gedung yang dimaksud dengan lisensi CC BY/CC0
  murni; umumnya CC BY-SA. Jangan dipakai sampai ada yang benar-benar CC BY/CC0.

Selama belum ada foto yang memenuhi syarat, **biarkan SVG sebagai tampilan** (default).

Catatan teknis: lingkungan build tidak dapat mengunduh berkas dari Wikimedia secara
langsung, jadi berkas foto harus Anda unduh sendiri dan letakkan di folder ini.
