# Design System LMS Rubela (v4 — "Modern Gen Z EdTech")

Sumber kebenaran: `css/design-system.css`, dimuat **paling akhir** setelah `style.css` dan `responsive.css`
di `dashboard.html` dan `index.html`. Tidak ada library atau build step baru; hanya font
[Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) (dengan fallback sistem bila offline).

## Audit awal (temuan yang diperbaiki)
| Temuan | Perbaikan |
|---|---|
| 33 menu admin (22–25 di panel lain) dalam satu daftar datar | Menu dikelompokkan per kategori di keempat panel; key routing & label tidak berubah |
| Menu sidebar berupa `<a>` tanpa `href` → tidak bisa dicapai keyboard | `href="#"`, `aria-current="page"`, label grup, tooltip saat sidebar ringkas |
| `overflow-x: hidden` pada `<body>` membuat topbar *sticky* tidak pernah menempel saat halaman digulir | Diganti `overflow-x: clip` (fallback `hidden`) |
| Sel tabel mode-kartu (ponsel) yang berisi teks + badge pecah jadi baris terpisah | Label kolom diposisikan absolut, isi sel tetap satu alur |
| Toast di kanan bawah menutupi tombol aksi & pemutar musik | Toast di kanan atas (di bawah topbar), `role="status"`/`alert` |
| Checkbox/radio ikut `padding` input form (26×22 px, tidak simetris) | Checkbox & radio kustom 18 px (20 px di layar sentuh), tanda tepat di tengah |
| Efek hover yang menggeser baris tabel, kartu statistik, dan menu | Dihapus; hover hanya pada elemen yang dapat diklik |
| Radius, bayangan, dan tinggi kontrol berbeda-beda | Token radius/shadow/kontrol tunggal |

## Token
| Kategori | Nilai |
|---|---|
| Warna brand | `--brand-500 #4f46e5` (tetap), `--brand-600`, `--brand-50`; aksen `--violet-500`, `--pink-500`, `--sky-500`; `--brand-grad` |
| Status | `--success`, `--warning`, `--danger` (+ `-bg`), dari `style.css` |
| Tipografi | `--font-sans` Plus Jakarta Sans; skala `--fs-2xs 11` → `--fs-3xl 30`; bobot 400–800 |
| Spasi | `--sp-1 4px` … `--sp-10 40px` (kelipatan 4) |
| Radius | `--r-xs 6`, `--r-sm 10` (tombol/input), `--r-md 14`, `--r-lg 18` (card), `--r-xl 24` (modal/hero), `--r-pill` |
| Bayangan | `--shadow-xs`, `--shadow-sm`, `--shadow`, `--shadow-lg`, `--shadow-brand` |
| Kontrol | `--ctl-h 42px`, `--ctl-h-sm 34px`, `--ctl-h-lg 48px`, `--focus-ring` |
| Layout | `--sidebar-w 256px` (232 di 1024–1279, 272 di ≥1680), `--sidebar-w-collapsed 76px`, `--content-max 1560px` |

## Komponen
- **Tombol**: `.btn` + `.btn-primary | -secondary | -outline | .btn-ghost | -danger | -success`, ukuran `.btn-sm | .btn-lg`,
  `.btn-icon`, `.btn-block`; status hover/active/focus/disabled; memuat via `UI.setBusy(btn, true|false)`.
- **Form**: tinggi seragam, panah dropdown kustom, `:user-invalid` / `.is-invalid`, `.field-error`, helper text,
  checkbox/radio kustom, tombol file bergaya, `label.btn` untuk unggah berkas.
- **Card**: `.card`, `.stat-card` (aksen lewat `--acc`, pita kiri + lingkaran lembut), `.fin-card`, `.list-item`, `.course-card`.
- **Tabel**: wadah berbingkai, header lekat, hover baris lembut; mode kartu di ≤760 px (otomatis oleh `js/responsive.js`).
- **Badge**: pill dengan titik penanda pada status sukses/peringatan/bahaya (status tidak hanya dibedakan warna).
- **Tabs**: kontrol segmen (pill) untuk `.tabs` dan `.subtabs`; digulir horizontal di ponsel.
- **Modal**: tengah layar, header lekat, melebar otomatis bila berisi tabel/insight, bottom sheet di ≤640 px.
- **Empty/Loading**: `.empty`, `.skeleton`, `.spinner`, `.btn.is-loading`.
- **Navigasi**: sidebar berkelompok + mode ringkas (tombol « di samping logo, tersimpan per perangkat),
  drawer di ≤1023 px, **navigasi bawah** di ≤767 px (4 menu utama per peran + Menu), skip link.
- **Overview**: blok **Aksi cepat** per peran (hanya menu yang tersedia bagi peran tersebut).

## Breakpoint
`320–480` ponsel • `481–767` ponsel besar • `768–1023` tablet (sidebar menjadi drawer) • `1024–1279` laptop •
`1280–1679` desktop • `≥1680` layar lebar (padding & sidebar lebih lega, konten dibatasi 1560 px).

## Aksesibilitas
Fokus keyboard terlihat di semua kontrol, `aria-current` pada menu aktif, `aria-expanded` pada tombol menu & ringkas,
dialog `role="dialog"` + `aria-modal`, toast `aria-live`, landmark `<main>`, skip link, target sentuh ≥ 44 px,
`prefers-reduced-motion` mematikan animasi, `forced-colors` didukung.

## Pengujian
- Seluruh menu keempat panel (97 halaman) pada 1920×1080, 1440×900, 1280×620, 1024×768, 768×1024, 390×844, 320×568:
  0 galat JavaScript, 0 halaman gagal/kosong, 0 overflow horizontal, 0 teks tombol terpotong.
- Interaksi: sidebar ringkas (lebar 256 ↔ 76 px, tersimpan), navigasi keyboard, aksi cepat, navigasi bawah, buka/tutup
  drawer (Esc), checkbox, `UI.setBusy`, posisi toast, topbar lekat saat digulir, kotak ketik chat di atas navigasi bawah.
- Fungsi lama (login, routing, CRUD, hak akses, data) tidak diubah; key menu identik dengan versi sebelumnya.
