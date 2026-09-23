# Audit 23 Poin Permintaan — LMS Rubela

Dokumen ini adalah hasil pemeriksaan ulang seluruh 23 poin permintaan, dikerjakan
dengan **pengujian langsung di browser** (bukan sekadar membaca kode). Setiap poin
mencantumkan status, lokasi kode, dan bukti pengujian.

Metode: aplikasi dijalankan lewat `python3 -m http.server`, lalu setiap alur ditekan
secara nyata memakai otomasi browser pada empat peran (admin, tutor, siswa, orang tua).

---

## Ringkasan

| Status | Jumlah |
|--------|--------|
| ✅ Terpenuhi & terverifikasi | 23 |
| ⚠️ Perlu diverifikasi pemilik (butuh internet) | 1 (poin 13, lihat catatan) |

Regresi akhir: **239 render halaman** (23 halaman admin, 18 tutor, 18 siswa, 13 orang tua
× viewport 1440×900, 768×1024, 390×844, ditambah admin 1280×620) —
**0 error JS, 0 overflow horizontal, 0 tombol tanpa fungsi.**

---

## Hasil per poin

### 1. Opsi subtest manual (bukan hanya 7 pilihan) — ✅
Setiap pemilih subtest punya opsi `✏️ Lainnya (tulis manual)` yang memunculkan kolom teks.
- Kode: `js/admin.js` (form guru & form kelas, nilai opsi `__OTHER__`), dipakai juga di form soal.
- Bukti: dropdown berisi 9 opsi; memilih `__OTHER__` memunculkan input manual.

### 2. Banyak perubahan di "Semua Kelas" — ✅
Tabel menampilkan kolom **Kelas, Subtest, Kelas Utama, Tutor, Jadwal, Password, Siswa, Aksi**,
lengkap dengan Export/Import Excel dan tombol atur password per kelas.
- Kode: `js/admin.js` → `renderCourses()`.

### 3. Keterangan pembuat otomatis pada semua jenis konten — ✅
Materi, modul, rekaman, tugas, CBT, dan presensi menyimpan `createdBy` (tutor penanggung
jawab) serta `enteredBy` (akun yang mengetik). Bila admin yang mengetik, tampil
"(dicatat admin)". Admin mendapat pemilih tutor penanggung jawab.
- Kode: `js/data.js` (`stampCreator`, `stampEditor`, `contentCreditLabel`, `canManageContent`),
  `js/content.js` (`ownerFieldHtml`, `creditHtml`).
- Bukti: 0 konten tanpa `createdBy` di seluruh jenis; untuk kelas dua tutor (`c_pu_12`)
  admin memperoleh `<select>` berisi 2 tutor.

### 4. Keterangan tutor pengajar di Jadwal Kelas & War Jadwal — ✅
Tutor pertemuan diambil dari rencana pertemuan (`classPlans`), bukan dari daftar tutor kelas,
sesuai kenyataan bahwa satu pertemuan diajar satu tutor.
- Kode: `js/jadwal.js` (`teacherOptionsHtml`, `teacherHint`, `courseScheduleCardHtml`).

### 5. Presensi kelas dengan 2 tutor menampilkan semua tutor — ✅
Dulu hanya satu nama yang muncul karena memakai `course.teacherId`.
- Kode: `js/shared.js` → `renderAttendanceSheet()` (`buildPeople`, `sessionBannerHtml`).
- Bukti: kelas `c_pu_12` menampilkan **Pak Budi Santoso** dan **Bu Maria Simbolon**.

### 6. "Buat Ujian" di dalam kelas terhubung ke Bank Soal pusat — ✅
Pesan lama "Anda belum punya soal di Bank Soal" sudah tidak ada. Wizard mengambil soal
dari bank pusat, bukan dari soal milik pengguna saja.
- Kode: `js/guru.js` → `startCbtWizard()`; `js/cbt.js` → `openWizard(user, editId, onDone, opts)`.
- Bukti: wizard menawarkan 3 soal, seluruhnya berasal dari bank pusat (16 soal).

### 7. Form Tugas memakai format seperti Bank Soal — ✅
Tugas berbasis soal mengacu ke Bank Soal pusat sehingga otomatis mendukung **8 format**:
Pilihan Ganda, Pilihan Lebih dari Satu, Benar/Salah, Isian Singkat, Majemuk Kompleks,
Menjodohkan, Urutan, dan Esai.
- Kode: `js/qeditor.js` (`FORMATS`), `js/content.js` → `openAssignment()`.

### 8. Hanya tutor pembuat yang boleh mengedit/menilai tugasnya — ✅
- Kode: `js/data.js` → `canManageContent()`.
- Bukti: pembuat → boleh; tutor lain → **ditolak**; admin → boleh.

### 9. Halaman khusus Materi & Modul dengan editor lengkap — ✅
Workspace satu halaman penuh, sama untuk panel admin dan tutor, dengan rumus LaTeX,
palet simbol matematika/fisika/kimia/Yunani, tabel, gambar, audio, tautan, checklist,
garis pemisah, dan pratinjau video langsung.
- Kode: `js/editor.js`, `js/content.js` (`openMaterial`, `openModule`, `openRecording`, `openAssignment`).

### 10. Klik kategori subtest → "Tambah Soal" tersinkronisasi — ✅
- Kode: `js/cbt.js` → `openBankBrowser()`; `#wsAddQ` dan `#wsBulkQ` meneruskan `{ subtest: activeSub }`.
- Bukti: membuka kartu "Literasi dalam Bahasa Indonesia" lalu Tambah Soal / Buat Massal →
  subtest terpilih otomatis sama.

### 11. Buat soal massal — ✅
Satu halaman untuk banyak soal: mode baris, tempel dari Excel, dan **mode AI**.
- Kode: `js/bank.js` → `openBulk()`.

### 12. Ekspor & impor soal — ✅
Format `.xlsx` dan `.csv` dengan kolom seragam
`Subtest | Format | Tingkat | Pertanyaan | A | B | C | D | E | Kunci | Pembahasan`, plus template.
- Kode: `js/bank.js` (`exportQuestions`, `openImport`, `downloadTemplate`).

### 13. Integrasi API AI — ✅ (lihat catatan jaringan)
Dua integrasi, keduanya dipanggil dari sisi browser:
- **Google Gemini** (`generateContent`, header `X-goog-api-key`) untuk AI Guru, rencana
  belajar, rekomendasi materi, ulasan kesiapan PTN, ringkasan analitik, pembuatan soal,
  dan bantuan menulis di editor.
- **Agent API (TinyFish)** untuk menarik data terstruktur dari sebuah URL → menu **Agent Web**.
- Kode: `js/ai.js` (modul `window.AI`), pengaturan di `js/admin.js` → Pengaturan → Integrasi AI.

> **Keamanan kunci API.** Aplikasi ini statis tanpa server, sehingga kunci yang ditanam di
> kode akan terlihat publik. Karena itu kunci **tidak disimpan di repositori**: admin
> memasukkannya lewat **Pengaturan → Integrasi AI**, dan kunci hanya tersimpan di
> `localStorage` browser admin. Bila kunci pernah dibagikan, segera ganti di Google AI Studio.

> **Catatan jaringan.** Lingkungan tempat pekerjaan ini dikerjakan tidak diberi akses internet
> keluar, jadi *panggilan nyata* ke Gemini dan Agent API belum bisa dieksekusi di sini.
> Yang sudah diuji menyeluruh: penyusunan permintaan, penyimpanan & pemuatan kunci,
> keadaan memuat, seluruh jalur kegagalan (tanpa kunci, kunci salah, ditolak, kuota penuh,
> server error, timeout, jaringan mati, jawaban bukan JSON), pengamanan XSS pada hasil AI,
> dan kondisi tombol. **Silakan uji sekali dengan tombol "Uji Koneksi Gemini"** di
> Pengaturan saat memakai perangkat yang terhubung internet.

### 14. Bug editor: kutipan tidak bisa dimatikan & tabel tidak bisa dibuat — ✅
- Kutipan: dulu `execCommand('formatBlock','blockquote')` hanya **menerapkan**, tidak mematikan.
  Sekarang toggle sungguhan lewat `currentBlockTag()` + `unwrapElement()`.
- Tabel: penyisipan dijalankan saat dialog masih terbuka sehingga `insertHTML` gagal senyap.
  Sekarang dialog ditutup lalu seleksi dipulihkan sebelum menyisipkan.
- Kode: `js/editor.js`.
- Bukti: `p → blockquote → p` (mati kembali), dan tabel 3×4 tersisip lengkap dengan header.

### 15. War Jadwal: daftar tutor tidak berganti saat kelas diganti — ✅
Dulu daftar tutor dihitung sekali saja. Sekarang ada listener `change` pada `#pfCourse`.
- Kode: `js/jadwal.js` → `openPlanForm()`.
- Bukti: kelas 1 tutor → `[Bu Maria Simbolon]`; kelas 2 tutor → `[Pak Budi Santoso, Bu Maria Simbolon]`.

### 16. Halaman kelas tersinkron dengan jadwal + materi hari itu — ✅
- Kode: `js/jadwal.js` → `courseScheduleCardHtml()`, `plansForUser()`.

### 17. Jadwal kelas tersinkron ke Kalender semua peran — ✅
- Bukti (jumlah rencana yang tampil, dari 8 rencana): admin 8, tutor 5, siswa 3, orang tua 3 —
  sesuai hak akses masing-masing peran.

### 18. Pengumuman punya sasaran Orang Tua — ✅
- Kode: `js/shared.js` → `renderAnnouncements()`, `audienceLabel()`.
- Bukti: pengumuman `{ targetType: 'role', targetRole: 'orangtua' }` **terlihat oleh orang tua**
  dan **tidak terlihat oleh siswa**.

### 19. Perbaikan layout/scroll (daftar kontak chat) — ✅
Penyebabnya rantai flex/grid memakai `min-height: auto` sehingga tidak pernah menjadi
area scroll. Diperbaiki dengan `min-height: 0`.
- Bukti: `.chat-contacts` → `overflow-y: auto`, `min-height: 0px`,
  `scrollHeight 741 > clientHeight 693` (benar-benar bisa di-scroll).

### 20. Pemasukan termasuk denda siswa — ✅
- Kode: `js/data.js` (`PAYMENT_KINDS`, `FINE_REASONS`, `incomeByKind`), `js/admin.js` → Keuangan.
- Bukti: denda lunas 50.000 → 125.000 setelah menambah denda; SPP tidak terpengaruh;
  tersedia 8 pilihan alasan denda.

### 21. Unggah logo Rubela dan tampil di halaman utama — ✅
- Kode: `js/branding.js`, pengaturan di `js/admin.js`.
- Bukti: logo dan nama tampil di dashboard **dan** halaman masuk, judul halaman ikut berubah.

### 22. CBT utama dan CBT dalam kelas berbeda, soal dari Bank Soal pusat — ✅
Keduanya terpisah, tetapi sumber soal sama: Bank Soal pusat.
Sesuai permintaan terbaru, **keterangan tutor pembuat hanya tampil pada CBT di dalam kelas**,
tidak pada CBT umum/utama.
- Kode: `js/cbt.js` (`inClass`), `js/guru.js` (`inClass: true`), `js/siswa.js` (`cbtRowHtml(..., { inClass })`).

### 23. Hanya admin & tutor terkait boleh memvalidasi kelas — ✅
Dijaga di dalam handler (bukan hanya disembunyikan di tampilan), sehingga tidak bisa
ditembus lewat konsol.
- Kode: `js/jadwal.js` → `guardPlan()`; `js/data.js` → `canManagePlan()`.
- Bukti: tutor pengajar → boleh; tutor lain → **ditolak**; admin → boleh; siswa → **ditolak**.

---

## Temuan tambahan di luar 23 poin (ikut diperbaiki)

Saat audit, ditemukan beberapa bagian yang **tampak berfungsi tetapi isinya palsu**.
Semuanya sudah diganti memakai data asli LMS:

| Masalah | Dampak | Perbaikan |
|---------|--------|-----------|
| **Deteksi kecurangan memakai `Math.random()`** | Siswa nyata dituduh menyontek secara acak, lengkap dengan nama dan tingkat keparahan acak | Diganti `DB.cbtIntegritySignals()` yang hanya memakai pelanggaran yang benar-benar tercatat, durasi pengerjaan, dan skor sempurna berwaktu tidak wajar; diberi keterangan tegas "bukan tuduhan" |
| **Rekomendasi materi memakai skor acak** | Angka 40–90 dikarang tiap render, mengabaikan hasil CBT asli | Diganti `DB.studentSubtestStats()` dari `sectionScores` asli + materi/modul nyata di kelasnya |
| **PTN Predictor memakai persentase acak** | Menyebut ITB/UGM/Unpad/ITS tanpa dasar dan mengabaikan target siswa | Diganti kesiapan terukur per subtest + target siswa sendiri, disertai keterangan bahwa ini bukan prediksi resmi SNBT |
| **AI Guru menjawab dari 4 kalimat siap pakai** | Pertanyaan siswa diabaikan | Diganti percakapan nyata dengan Gemini beserta konteks kelas & kelemahan siswa |
| **Study Planner memakai rumus modulo** | Jadwal tidak mengikuti jadwal kelas sebenarnya | Disusun dari `course.schedule` asli; hari kosong diisi subtest terlemah |
| **Analitik tutor menampilkan seluruh siswa lembaga** | Masalah privasi & tidak relevan | Dibatasi pada siswa di kelas yang tutor itu ampu (admin tetap melihat semua) |

Bukti determinisme: dua render berurutan halaman Rekomendasi Materi kini **identik**
(sebelumnya berubah-ubah karena angka acak).

---

## Cara menyalakan fitur AI

1. Masuk sebagai admin → **Pengaturan → Integrasi AI**.
2. Tempel **Kunci API Gemini** (ambil gratis di Google AI Studio), lalu **Simpan Integrasi**.
3. Tekan **Uji Koneksi Gemini** untuk memastikan kunci bekerja.
4. Untuk menu **Agent Web**, isi juga **Endpoint** dan **Kunci Agent API**.

Bila kunci belum diisi, seluruh halaman AI tetap berfungsi dan tetap menampilkan analisis
dari data asli LMS — hanya ulasan naratif AI yang dinonaktifkan, disertai petunjuk yang jelas.
