# Sistem Penilaian CBT: IRT, Poin Manual, atau keduanya

Setiap ujian CBT kini memilih sistem penilaiannya sendiri pada langkah **3. Metode** di wizard
(kartu "Sistem Penilaian"):

| Sistem | Cara kerja |
|---|---|
| **IRT UTBK (200–800)** — bawaan | Cohort-weighted / Rasch-like seperti sebelumnya. Benar 1, salah/kosong 0, tanpa minus. |
| **Poin Manual** | Skor = jumlah poin. Benar mendapat poin penuh, kosong 0, salah sesuai "Poin jawaban salah". |
| **Poin + IRT** | Skor utama berupa poin; skor IRT 200–800 tetap ditampilkan sebagai pembanding. |

## Cara menentukan poin

- **Poin per Soal**: poin bawaan diambil dari Bank Soal (field **Poin bawaan** di editor soal,
  kolom `Poin` saat impor/ekspor Excel/CSV; kosong = 1). Pada langkah **6. Tinjau & Simpan**
  tabel "Poin per Soal" dapat mengubah poin khusus ujian itu tanpa mengubah Bank Soal,
  menyamakan semua soal, atau mengembalikan ke poin Bank Soal. Total poin dihitung langsung.
- **Poin per Paket**: isi total poin paket (mis. 100); poin dibagi rata ke setiap soal.
- **Poin jawaban salah**: 0 (tanpa minus, seperti UTBK) atau negatif, mis. −1. Angka positif
  otomatis diubah menjadi negatif. Jawaban kosong selalu 0.

## Esai

Soal esai mendapat poin dari tutor/admin lewat tombol **✍️ Nilai Esai** pada halaman Hasil
ujian (admin: CBT → Hasil; tutor: Hasil Ujian kelas). Poin 0 sampai poin maksimal soal.
Setelah disimpan, skor dihitung ulang dan siswa serta orang tua mendapat notifikasi.
Siswa tidak dapat mengubah nilai esainya sendiri (dijaga di server, `api/_lib/rules.js`).

## Tampilan

Halaman hasil siswa, tabel hasil admin/tutor, daftar CBT siswa, nilai di panel orang tua,
dan konteks Asisten AI memakai skor utama sesuai sistemnya (mis. "8/11 poin"). Pembahasan
menampilkan poin yang diperoleh per soal. Daftar CBT admin menampilkan label sistem penilaian.
Laporan lintas-ujian (rekap, tren) tetap memakai skala IRT agar dapat dibandingkan antar-ujian.

## Teknis

- `js/scoring.js` (versi 2): `modeOf`, `pointsConfig`, `maxPointsMap`, `computePoints`,
  `primary`, `label`, `describe`. IRT tetap dihitung untuk semua ujian.
- Field CBT: `scoringMode` (`irt`|`points`|`both`), `pointsBasis` (`question`|`package`),
  `packageTotal`, `wrongPoints`, `points` (`{ idSoal: poin }`, hanya yang berbeda dari Bank Soal).
- Field attempt: `essayPoints` (`{ idSoal: poin }`), `essayGradedBy`, `essayGradedAt`.
  Hasil disimpan di `attempt.scoring.points`; `attempt.score` (0–100) = persentase poin.
