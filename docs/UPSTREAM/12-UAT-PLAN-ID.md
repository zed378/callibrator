# 12 — Rencana UAT dan Skrip Uji per Persona (P26-01)

> **English summary.** The user-acceptance-test plan and scripts of card **P26-01**, in Indonesian, for
> the people who will accept the replacement of SKP IPM: the provider's technician and administrator,
> the facility's administrator and technician, the IPSRS, the platform operator (catalogue and import
> tooling) and a member of the public scanning a sticker. Every script describes **only what is built
> as of 2026-10-13** (Phases 21 – 22, the `/field` app, the public device page, the P27-03 sticker and
> the import tooling of P24-06 / P24-07), with the screen and the record that built it. A step that
> cannot be accepted yet is marked **⏳ pending** with its reason — never as passing: the owner's
> real-phone run of `/field` (P22-10), the dry run with real data (P24-05 → P25-04), what legacy
> stickers encode (OA-4 / UD-16), and the pre-invitation gate that keeps facility-bound accounts off
> (`FACILITY_BINDING_ENABLED`). § 9 lists the gaps the plan found against the code (C-1, no screen for
> four tenant settings, C-3, the menu entries, and C-4, the SQL-import page's stale stage-2 text, were closed the same day; **C-2, the dashboard capture's evidence photos, closed 2026-10-23**). The run itself is
> **P26-02**; triage and sign-off **P26-03**. No real data, name or facility appears here.

**Status:** rencana dan skrip, 2026-10-13 (P26-01). **Belum dijalankan.** Diperbarui 2026-10-13: C-1 (M-18), C-3 (migrasi 0142) dan C-4 selesai, label layar diselaraskan dengan `id.ts`. Pelaksanaan = P26-02 (di
*staging* dengan data *dry run*), triase dan pengesahan = P26-03. Istilah layar dikutip dari kamus
aplikasi (`frontend/src/i18n/messages/id.ts`) per 2026-10-13.

---

## 1. Tujuan dan Batas

UAT menjawab satu pertanyaan per persona: **dapatkah orang ini mengerjakan pekerjaannya sehari-hari di
Device Calibrator, tanpa SKP IPM?** UAT bukan uji teknis: keamanan, isolasi tenant, dan regresi sudah
diuji otomatis (rangkaian *unit*, *live*, E2E, dan uji peramban `automate/*.browser.*`). UAT menguji
**alur kerja, bahasa, dan kecocokan dengan kebiasaan kerja** — dan mencatat setiap hal yang membuat
pengguna ragu, walau secara teknis "benar".

Di luar UAT ini (dikerjakan di kartu lain): rekonsiliasi angka data (P25), uji pindai stiker di ponsel
nyata (P27-04), uji ponsel nyata aplikasi lapangan (runbook pemilik,
[`TASKS/RUNBOOK-FIELD-REAL-DEVICE.md`](../../TASKS/RUNBOOK-FIELD-REAL-DEVICE.md)), dan perbandingan
laporan berdampingan oleh penyedia (P23-05).

## 2. Persona dan Akunnya

| Kode | Persona | Peran di aplikasi | Lingkup | Siap diuji? |
|---|---|---|---|---|
| **TP** | Teknisi penyedia jasa (dulu grup `user`) | `TECHNICIAN` | semua faskes klien penyedia (tidak terikat) | ✅ |
| **AP** | Admin penyedia jasa (dulu grup `admin`) | `CALIBRATOR ADMIN` (administrator tenant) | seluruh tenant penyedia | ✅ |
| **AF** | Admin faskes (dulu grup `client`) | `HEALTHCARE ADMIN`, **terikat** ke satu faskes | hanya faskesnya, **hanya baca** | ⏳ gerbang pra-undangan (§ 3.3) |
| **TF** | Teknisi faskes (dulu `teknisi_client`) | `HEALTHCARE TECHNICIAN`, terikat | hanya faskesnya | ⏳ gerbang pra-undangan |
| **IP** | IPSRS faskes (tidak punya akun di SKP IPM) | `FACILITY MAINTENANCE`, terikat | hanya faskesnya; menandatangani sebagai pemeriksa | ⏳ gerbang pra-undangan (§ 3.3) |
| **OP** | Operator platform | `SUPERADMIN` | katalog global, alat impor | ✅ (data sintetis); ⏳ data nyata (§ 3.2) |
| **PU** | Publik (pasien, pengunjung, perawat) | tanpa akun | halaman publik alat | ✅ (setelah AP-08) |

Peran dan lingkup ini adalah matriks peran yang final di bawah keputusan kerja:
[`MEMORY/specs/P18-01-02-role-matrix-and-grants.md`](../../MEMORY/specs/P18-01-02-role-matrix-and-grants.md) § 2.
Akun dibuat oleh AP di **Pengguna** (`/dashboard/users`); undangan massal untuk pengguna lama adalah
bagian *cutover* (P30-04), bukan UAT.

## 3. Lingkungan, Data, dan Prasyarat

### 3.1 Lingkungan
- **Staging** dengan konfigurasi produksi (mode `production`, HTTPS), satu tenant penyedia, minimal
  **dua faskes klien** (agar terlihat bahwa akun terikat tidak melihat faskes lain).
- Peramban: Chrome atau Edge terbaru di laptop; Chrome di Android dan Safari di iOS untuk aplikasi
  lapangan dan halaman publik.
- Printer label 60 × 40 mm bila ada (stiker, § 4 TP-09); bila tidak, cetak ke PDF.

### 3.2 Data
- **Target: data *dry run*** — dump terbaru SKP IPM yang dimuat ke salinan sekali pakai (P24-05),
  setelah rekonsiliasi hijau (P25-04). **⏳ Belum tersedia:** P24-05 diblokir (P24-02 masih berjalan,
  UD-7, UD-18), dan gerbang DPIA `UPSTREAM_REAL_DATA_ALLOWED` tetap mati sampai pemilik
  menyalakannya.
- **Sampai saat itu: gladi dengan data sintetis.** Semua skrip di bawah dapat digladikan dengan data
  sintetis (nama berawalan "Sintetis"/"Synthetic"). Hasil gladi **tidak** dihitung sebagai penerimaan:
  penerimaan butuh data yang dikenal pengguna (alat, ruang, dan riwayat mereka sendiri).

### 3.3 Sakelar dan pengaturan yang harus disiapkan
| Sakelar / pengaturan | Untuk | Cara menyalakan (hari ini) |
|---|---|---|
| `FACILITY_BINDING_ENABLED=true` | akun terikat (AF, TF, IP) | variabel lingkungan backend; **gerbang pra-undangan** (`docs/SECURITY/15` § 11, P17-07). Menyalakannya di staging adalah keputusan pemilik dan dicatat. Selama mati, mengikat akun ke faskes ditolak 409 "Facility-bound accounts are not enabled yet." |
| `public_device_page` = `minimal` (atau `minimal_with_report`) | halaman publik (PU) | **Tenant** → kartu tenant → **Pengaturan IPM dan halaman publik** (administrator tenant; sejak M-18, C-1) |
| `ipm_countersign_enabled` = `true` | tanda tangan IPSRS (IP) | **Tenant** → kartu tenant → **Pengaturan IPM dan halaman publik** (administrator tenant; sejak M-18, C-1) |
| `ipm_interval_months` | jatuh tempo IPM di dasbor | **Tenant** → kartu tenant → **Pengaturan IPM dan halaman publik** (administrator tenant; sejak M-18, C-1) |

### 3.4 Aturan pelaksanaan
- Satu fasilitator per sesi; pengguna mengerjakan sendiri, fasilitator hanya mencatat.
- Setiap langkah diberi **Lulus / Gagal / Lulus dengan catatan**; setiap "Gagal" dan "catatan" menjadi
  tiket di log P26-02 (§ 8) dengan tangkapan layar **tanpa data pribadi**.
- Bahasa: semua skrip dijalankan dalam **Bahasa Indonesia** (bawaan aplikasi); satu skrip per persona
  diulang dalam bahasa Inggris untuk memeriksa terjemahan.
- Status di kolom terakhir tabel skrip: **✅ siap** = fitur terbangun dan dapat diterima;
  **⏳ tertunda** = tidak dapat diterima sekarang, alasannya disebut. Langkah ⏳ **tidak boleh** diberi
  "Lulus".

---

## 4. Skrip TP — Teknisi Penyedia Jasa

| ID | Langkah | Hasil yang diharapkan | Siap? |
|---|---|---|---|
| TP-01 | Masuk dengan akun TP. | Dasbor terbuka; menu memuat **Alat**, **Riwayat IPM**; panel kondisi alat dan aktivitas teknisi tampil. | ✅ |
| TP-02 | **Alat** → **Tambah alat**: nama, kode QR stiker, tipe alat (cari dan pilih), merek, model, nomor seri, faskes, ruang + lantai, kondisi. | Alat tersimpan; lalu diminta **dua foto wajib** (depan dan pelat nomor seri). | ✅ |
| TP-03 | Unggah dua foto dari kamera/galeri. | Pratinjau keduanya tampil, "kedua foto wajib ada", **Selesai** aktif; daftar alat menampilkan gambar kecil. | ✅ |
| TP-04 | Coba daftarkan alat lain dengan **kode QR yang sama**. | Ditolak dengan penjelasan bahwa stiker sudah dipakai alat lain. | ✅ |
| TP-05 | **Mulai IPM** (`/dashboard/ipm/new`): ketik kode QR, atau pakai pemindai genggam, atau **pindai dengan kamera** (hanya di peramban yang mendukung `BarcodeDetector`). | Data alat tampil (QR, seri, merek · model, faskes, ruang, IPM terakhir); **Mulai** membuka daftar periksa. | ✅ (kamera: ⏳ ponsel nyata, P22-10) |
| TP-06 | Isi setiap langkah daftar periksa; tunggu tanpa menekan simpan. | Satu langkah per bagian, hitungan "terjawab / total" di tiap tombol langkah; baris status "tersimpan pukul hh:mm" (simpan otomatis). Nilai di luar batas ditandai. | ✅ |
| TP-07 | Langkah tinjauan → **Kirim**. | Tombol kirim mati selama ada butir wajib kosong; setelah lengkap, "Kunjungan IPM … terkirim" dan pemberitahuan efek samping (mis. perintah perbaikan dibuka). | ✅ |
| TP-08 | Buka **Riwayat IPM** → kunjungan tadi → **Buka laporan IPM** → **Tandatangani laporan IPM …** (kata sandi atau kode autentikator) → **Unduh … sebagai PDF**. | Arti tanda tangan harus dicentang dulu; tanda tangan "Sah"; PDF terunduh, dibuat di peramban. | ✅ |
| TP-09 | **Alat** → aksi baris **Tautan publik …** → **Terbitkan tautan** → **Cetak stiker** dan **Unduh stiker (PNG)**. | Label 60 × 40 mm: QR, "Pindai untuk status kalibrasi / Scan for calibration status", nama alat, "QR …" dan tanggal terbit. Pesan: tautan tidak akan ditampilkan lagi. Kebijakan "Kapan stiker diganti" terbaca. | ✅ (pindai di ponsel: ⏳ P27-04) |
| TP-10 | **Tanggal kalibrasi** (tautan di halaman Kalibrasi): pindai/ketik QR, isi laboratorium dan nomor sertifikat, **Simpan tanggal kalibrasi**. | "Tanggal kalibrasi dicatat untuk …"; tab daftar menampilkannya. Tidak ada unggahan berkas sertifikat (aturan pemilik). | ✅ |
| TP-11 | Riwayat IPM → kunjungan terkirim → **Koreksi kunjungan ini** (alasan ≥ 3 karakter) → ubah di daftar periksa → kirim. | Versi asli tetap terbaca dan berstatus "digantikan" setelah koreksi dikirim; silsilah versi terlihat di kedua arah. | ✅ |
| TP-12 | Aplikasi lapangan `/field` di ponsel: **Siapkan ponsel ini** → pilih faskes → **Periksa ukuran** → **Unduh untuk kerja luring**. | Unduhan dengan kemajuan; "Mode luring aktif"; data dihapus 72 jam setelah sinkron terakhir. | ⏳ ponsel nyata (P22-10, runbook pemilik) |
| TP-13 | Mode pesawat → **Pindai** → alat → isi IPM + foto bukti → kirim; nyalakan jaringan → **Sinkronkan sekarang**. | Antrean bertambah saat offline, kosong setelah sinkron; kunjungan muncul di Riwayat IPM dengan tanda "diambil offline". | ⏳ ponsel nyata (P22-10) |
| TP-14 | Ekspor (tautan **Ekspor** di halaman Alat): inventaris XLSX satu faskes → **Periksa ukuran** → **Buat dan unduh**. | Jumlah baris dan perkiraan ukuran tampil dulu; berkas dibuat di peramban. | ✅ |

## 5. Skrip AP — Admin Penyedia Jasa

| ID | Langkah | Hasil yang diharapkan | Siap? |
|---|---|---|---|
| AP-01 | **Fasilitas klien** → **Tambah fasilitas** (nama, kode, jenis). | Tersimpan; dapat dicari; kode ganda ditolak dengan formulir tetap terisi. | ✅ |
| AP-02 | Ubah status satu faskes menjadi tidak aktif (alasan wajib). | Peringatan bahwa semua sesi akun faskes itu keluar; jumlah sesi yang diakhiri dilaporkan. | ✅ |
| AP-03 | **Pengguna** → buat akun TP dan akun calon AF/TF/IP. | Akun terbuat dengan kata sandi sekali pakai. | ✅ |
| AP-04 | Fasilitas klien → akun → **ikat** akun calon AF ke faskes (alasan). | Terikat; sesi akun itu diakhiri. | ⏳ gerbang pra-undangan (§ 3.3); selama mati: 409 dengan penjelasan server — itu yang benar |
| AP-05 | Riwayat IPM → kunjungan → **Batalkan kunjungan ini** (alasan). | Final; teks menjelaskan apa yang dibatalkan (perintah kerja preventif, permintaan kalibrasi) dan apa yang tidak. | ✅ |
| AP-06 | Dasbor: panel kondisi → **Tampilkan alat …**; panel IPM; aktivitas teknisi (cari QR, "Hanya kunjungan saya"). | Tautan membuka daftar alat yang tersaring kondisinya; "jatuh tempo" mengikuti interval IPM (AP-08). | ✅ |
| AP-07 | Ekspor: inventaris **PDF** penyedia (dengan foto) dan **rekap kalibrasi terakhir** XLSX. | PDF A3 lanskap, 14 kolom, blok tanda tangan; > 1.000 alat dibuat tanpa foto dan halaman memberi tahu dulu; XLSX dengan tanggal sebagai sel tanggal. | ✅ (batas 1.000: angka sementara, diukur di *dry run*) |
| AP-08 | **Tenant** → kartu tenant → **Pengaturan IPM dan halaman publik**: halaman publik **Minimal**, interval IPM 6, zona waktu `Asia/Makassar` → **Simpan**. | "Pengaturan disimpan"; dibuka lagi, nilai yang sama terbaca. Interval 61 atau zona "Mars/Olympus" dijelaskan di kolomnya dan tidak dikirim. | ✅ |
| AP-09 | Panel yang sama: centang **IPSRS faskes menandatangani laporan IPM secara elektronik** → **Simpan**. | Tersimpan; laporan IPM yang sudah ditandatangani teknisi kini menawarkan tanda tangan IPSRS (IP-01). | ✅ |
| AP-10 | Tautan publik alat: **Ganti tautan** (konfirmasi) dan **Cabut tautan** (konfirmasi). | Konfirmasi menyebut bahwa stiker tercetak berhenti bekerja; halaman publik tautan lama menjawab "Tidak ada perangkat yang menjawab tautan ini.". | ✅ |

## 6. Skrip AF, TF, IP — Akun Faskes (terikat)

**Semua langkah di bagian ini ⏳ menunggu gerbang pra-undangan** (§ 3.3): akun terikat tidak dapat
dibuat selama `FACILITY_BINDING_ENABLED` mati. Kode dan uji otomatisnya sudah ada; UAT menunggu
keputusan pemilik untuk menyalakan sakelar di staging.

| ID | Persona | Langkah | Hasil yang diharapkan |
|---|---|---|---|
| AF-01 | AF | Masuk. | Menu terbatas (tanpa administrasi); hanya data faskesnya. |
| AF-02 | AF | Alat, Riwayat IPM, Tanggal kalibrasi (daftar), laporan IPM. | Hanya alat dan kunjungan faskesnya; tidak ada filter atau kolom faskes; tidak ada tombol tulis. |
| AF-03 | AF | Fasilitas klien. | Pesan bahwa akun ini tidak mengelola fasilitas; tidak ada data yang dimuat. |
| AF-04 | AF | Ekspor inventaris PDF. | Tata letak faskes (A4 lanskap, 9 kolom, nama faskes sebagai judul). |
| TF-01 | TF | Tambah alat (dasbor atau `/field` → **Daftarkan alat**). | Tanpa kode QR dan tanpa pilihan faskes (faskesnya sendiri); ruang dipilih, tidak dibuat offline; dua foto. |
| TF-02 | TF | Mulai IPM, isi, kirim. | Seperti TP-05 … TP-07, hanya untuk alat faskesnya. |
| TF-03 | TF | Hapus alat, rekam tanggal kalibrasi. | Tidak ditawarkan (server menolak 403 untuk akun terikat). |
| IP-01 | IP | Buka laporan IPM yang sudah ditandatangani teknisi → **Tandatangani sebagai IPSRS laporan IPM …**. | Hanya bila tanda tangan IPSRS dinyalakan (AP-09); teknisi pelaksana tidak dapat menandatangani sebagai IPSRS; staf penyedia tidak dapat menandatangani untuk faskes. |
| IP-02 | IP | `/field` → **Menunggu tanda tangan**. | Daftar kunjungan terkirim (dibaca saat sinkron terakhir); tanda tangan butuh jaringan. |

## 7. Skrip OP dan PU

| ID | Persona | Langkah | Hasil yang diharapkan | Siap? |
|---|---|---|---|---|
| OP-01 | OP | **Daftar periksa IPM**: tambah tipe alat; buat daftar periksa → **draf kosong** → tambah butir pustaka → **Simpan butir** → catatan perubahan → **Terbitkan**. | "Versi 1 terbit"; katalog terbit menawarkan tipe dan butirnya. | ✅ |
| OP-02 | OP | **Impor dump SQL**: unggah dump **sintetis**; buka run yang dimuat → bagian **Tahap 2: transformasi** → pilih **Tenant penyedia** → **Transformasi ke …**. | Dipindai, diurai (tidak pernah dieksekusi), dimuat ke *staging*; notifikasi dengan jumlah saja. Tahap 2 menampilkan statusnya; selama langkah transformasi belum lengkap di server, permintaan dijawab **"Transformasi tidak dimulai"** dengan penjelasan server (409 `TRANSFORM_NOT_AVAILABLE`) — itu yang benar. | ✅ tahap 1 sintetis; ⏳ tahap 2 sampai langkah transformasi lengkap (P24-02 / P24-03); ⏳ data nyata (gerbang DPIA, P24-05) |
| OP-03 | OP | **Impor gambar** (rsync): **Periksa koneksi** ke server uji, konfirmasi sidik jari kunci host, jalankan. | Foto depan dan pelat seri masuk karantina lalu ke penyimpanan tenant; berkas yang ditolak tercatat dengan alasannya. | ✅ server uji; ⏳ server lama yang nyata (gerbang DPIA) |
| PU-01 | PU | Pindai stiker baru (atau buka `/d/<tautan>`) tanpa masuk. | Nama alat sebagai judul; tipe, merek, model, faskes, status kalibrasi dalam kata-kata, tanggal kalibrasi berikut, IPM terakhir. **Tidak pernah**: nomor seri, nomor QR, ruang, foto, dokumen, nama orang. | ✅ setelah AP-08 |
| PU-02 | PU | Buka tautan yang sudah dicabut atau salah ketik. | "Tidak ada perangkat yang menjawab tautan ini." — tanpa data apa pun. | ✅ |
| PU-03 | PU | Pindai **stiker lama** SKP IPM. | — | ⏳ **OA-4 / UD-16** (isi stiker lama belum diketahui; P27-01/02) |

## 8. Log Pelaksanaan (diisi pada P26-02)

| Tanggal | Persona | ID langkah | Hasil (Lulus / Gagal / Catatan) | Tiket | Fasilitator |
|---|---|---|---|---|---|
| | | | | | |

Kriteria penerimaan (P26-03): semua langkah ✅ **Lulus** atau **Lulus dengan catatan** yang disetujui
pemilik; tidak ada "Gagal" terbuka berkategori *blocker*; langkah ⏳ dicatat sebagai **belum diterima**
dengan kartu yang menutupnya — bukan diabaikan.

## 9. Celah yang Ditemukan Saat Menyusun Rencana (terhadap kode, 2026-10-13)

| Kode | Celah | Dampak ke UAT | Penutup yang diusulkan |
|---|---|---|---|
| **C-1** | ~~Empat pengaturan tenant (`public_device_page`, `ipm_countersign_enabled`, `ipm_interval_months`, `tenant_time_zone`) tidak punya layar~~ — **SELESAI 2026-10-13 (M-18):** panel **Pengaturan IPM dan halaman publik** pada kartu tenant di `/dashboard/tenants`, untuk administrator tenant ([catatan](../../MEMORY/records/2026-10-13-m18-tenant-ipm-settings.md)). | AP-06, AP-08, AP-09, IP-01, PU-01 kini disiapkan oleh AP sendiri. | — |
| **C-2** | ~~**Foto bukti IPM** hanya ada di aplikasi lapangan `/field`; daftar periksa di dasbor belum menerimanya (catatan terbuka P22-03).~~ — **SELESAI 2026-10-23:** langkah **Periksa dan kirim** pada daftar periksa dasbor kini menampilkan, menambah, dan menghapus foto bukti draf (tautan bertanda tangan ke berkas aslinya; foto IPM tidak punya turunan tanpa metadata). Server memang sudah menerimanya sejak P21-03 ([catatan](../../MEMORY/records/2026-10-23-c2-ipm-evidence-photos.md)). | TP-07 di dasbor kini dapat memuat foto bukti; TP-13 di `/field` tetap. | — |
| **C-3** | ~~**Tanggal kalibrasi** dan **Ekspor** tidak punya entri menu sendiri~~ — **SELESAI 2026-10-13:** entri menu di bawah Peralatan, migrasi 0142 ([catatan](../../MEMORY/records/2026-10-13-c3-calibration-dates-exports-menu.md)). | Pengguna menemukannya di menu samping. | — |
| **C-4** | ~~Halaman **Impor dump SQL** menyatakan tahap 2 "belum tersedia"~~ — **SELESAI 2026-10-13:** bagian **Tahap 2: transformasi** dengan pilihan tenant penyedia, status transformasi, ringkasan per langkah, dan jawaban server apa adanya ([catatan](../../MEMORY/records/2026-10-13-c4-sql-import-transform.md)). | OP-02 kini menguji tahap 2 sejauh server mengizinkannya. | — |

## 10. Sumber

Setiap langkah mengacu ke catatan pembangunannya: P22-01 … P22-09 dan P22-10a – c3
(`MEMORY/records/2026-10-09-p22-*`, `2026-10-10-p22-*`, `2026-10-12-p22-10c*`, `2026-10-13-p22-08-*`),
laporan dan tanda tangan [P23-02](../../MEMORY/records/2026-10-10-p23-02-ipm-report-renderer.md),
stiker [P27-03](../../MEMORY/records/2026-10-13-p27-03-sticker-layout.md), impor
[P24-06](../../MEMORY/records/2026-10-07-sql-dump-import-module.md) dan
[P24-07](../../MEMORY/records/2026-10-07-rsync-image-import-module.md), dan cakupan peramban
[`2026-10-13-p22-browser-coverage.md`](../../MEMORY/records/2026-10-13-p22-browser-coverage.md) (alur yang
sama, dijalankan otomatis). Catatan "apa yang berubah" untuk pengguna:
[`11-WHAT-CHANGED-ID.md`](./11-WHAT-CHANGED-ID.md).
