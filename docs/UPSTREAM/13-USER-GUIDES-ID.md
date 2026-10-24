# 13 — Panduan Pengguna (Bahasa Indonesia)

> **English summary.** The user guides of card **P29-01**, in Indonesian, for the four roles that
> work in the new system: the provider's **technician** (IPM capture, the offline field app,
> corrections), the **facility user** (what a facility-bound account sees, and reports), the
> **provider administrator** (client facilities, binding accounts, invitations), and the facility's
> **IPSRS** (the countersignature). Written against the **built screens**: every menu name, button
> and message quoted here is the string the application actually shows
> (`frontend/src/i18n/messages/id.ts`), not a description of what it should say. Each guide ends
> with what the role **cannot** do, and why.
>
> **Reviewed 2026-10-24:** § 2 now gives each facility-bound role its own row, taken from
> `BOUND_MENU_CEILING` and migration 0124. The earlier text said the facility technician had
> *narrower* access, but it can record and correct IPM, and register and edit devices, in its facility. It cannot record calibration dates, because `POST /calibration-devices/:id/calibration-dates` is not in `FACILITY_ACCESSIBLE_ROUTES`. § 6 now marks
> three things as pending: the real-phone run, OA-4 and the real-data dry run.
>
> **Status:** draf 2026-10-23 (P29-01). The screens exist and are tested; the **field run with real
> people has not happened** (P26-02), so this is a guide for a system that is built but not yet used
> in anger. Where a step depends on a deployment setting that is off by default, it says so. No real
> data, name, facility or address appears here.

**Berlaku untuk:** aplikasi Device Calibrator, tahap adopsi dari SKP IPM. Bacalah
[`11-WHAT-CHANGED-ID.md`](./11-WHAT-CHANGED-ID.md) lebih dulu bila Anda pengguna lama SKP IPM — bab
itu menjelaskan **apa yang berubah**; dokumen ini menjelaskan **cara mengerjakannya**.

---

## 0. Sebelum Mulai: Tiga Hal yang Berlaku untuk Semua Peran

1. **Setiap orang punya akun sendiri.** Akun bersama tidak dipakai. Kalau Anda menerima **undangan**
   lewat e-mail, buka tautannya dan buat kata sandi Anda. Kata sandi lama dari aplikasi lama tidak
   berlaku.
2. **Yang sudah dikirim tidak ditimpa.** IPM yang sudah dikirim tidak dapat diubah; salah ketik
   diperbaiki dengan **koreksi** (membuat versi baru), dan hanya administrator yang dapat
   **membatalkan (void)** dengan alasan. Ini yang membuat laporan Anda bernilai sebagai bukti mutu.
3. **Laporan dan ekspor dibuat di peramban Anda.** Tidak ada berkas laporan yang disimpan di server.
   Tombol **Unduh** membuat PDF/Excel di komputer atau ponsel Anda.

---

## 1. Panduan Teknisi Penyedia Jasa

**Anda adalah:** `TECHNICIAN` (dulu `user` / Teknisi di SKP IPM). Anda bekerja di **semua fasilitas**
yang dilayani perusahaan Anda.

### 1.1 Masuk dan Menemukan Pekerjaan

Masuk dengan e-mail dan kata sandi Anda. Bila perusahaan Anda mengaktifkan verifikasi dua langkah
atau passkey, selesaikan langkah itu.

Di menu samping, pekerjaan Anda ada di bawah **Peralatan**:

| Menu | Untuk apa |
|---|---|
| **Alat** | Daftar alat semua fasilitas; mencari alat; mendaftarkan alat baru |
| **IPM** | Riwayat kunjungan IPM; memulai kunjungan baru |
| **Tanggal kalibrasi** | Mencatat tanggal kalibrasi dari laboratorium luar |
| **Ekspor** | Membuat PDF/Excel inventaris dan rekap kalibrasi |

### 1.2 Merekam IPM (di Dasbor)

1. Buka **IPM**, lalu **Mulai IPM**.
2. **Cari alatnya.** Ketik nomor stiker QR, arahkan pemindai genggam ke stiker, atau — pada ponsel —
   gunakan kamera (**Pindai dengan kamera**). Alat yang tidak ditemukan dijawab dengan jelas; itu
   berarti alatnya bukan milik fasilitas yang boleh Anda lihat, atau belum terdaftar.
3. **Isi per langkah.** Daftar periksa muncul satu bagian satu langkah (lingkungan, pasokan listrik,
   alat kerja yang digunakan, keamanan lain, pemeriksaan fisik, keamanan listrik, fungsi,
   kelengkapan, kinerja, baterai, tugas pemeliharaan, bahan habis pakai). Setiap angka diperiksa
   **sebelum** dikirim: nilai di luar rentang yang mungkin, atau hasil yang dipaksa berbeda dari
   hitungan batas, ditandai di kolomnya dan **tidak** dikirim.
4. **Tersimpan sendiri.** Setiap perubahan tersimpan otomatis setelah jeda singkat; status
   ("Menyimpan…", "Tersimpan pukul …") selalu terlihat. Bila draf berubah di tempat lain, autosave
   berhenti dan menawarkan **Muat ulang draf**.
5. **Hasil dan rekomendasi.** Isi waktu pelaksanaan, ruangan (konfirmasi ruangan alat, atau pilih
   ruangan lain bila alat sudah dipindah), hasil pemeriksaan, hasil pemeliharaan, rekomendasi, dan
   catatan.
6. **Foto bukti.** Di langkah **Periksa dan kirim** ada bagian **Foto bukti**. Tombol **Tambah foto
   bukti** mengambil atau memilih foto — foto yang rusak, angka pada layar alat. Foto dikecilkan
   otomatis di ponsel dan metadata kamera (termasuk lokasi) dibuang sebelum dikirim. Selama IPM
   masih draf, foto dapat **dihapus**; setelah dikirim, foto menjadi bagian rekamnya.
7. **Periksa dan kirim.** Langkah terakhir mendaftar butir wajib yang masih kurang; **Kirim** tidak
   aktif selama ada yang kurang atau ada nilai bermasalah. Setelah dikirim, Anda melihat **nomor
   kunjungan** dan pemberitahuan dampaknya (mis. perintah kerja perbaikan dibuka, alat disetel ke
   pemeliharaan).

> **Bila rekomendasi Anda "perlu perbaikan"** atau **"tidak layak pakai"**, sistem membuka perintah
> kerja atau menyetel status alat secara otomatis — itu bukan kesalahan, itu memang tujuannya.

### 1.3 Merekam IPM Tanpa Jaringan (`/field`)

Aplikasi lapangan terpisah, dipasang ke layar utama ponsel (**aplikasi web / PWA**). Buka `/field`
pada ponsel Anda.

1. **Siapkan ponsel ini** (menu **Pengaturan luring**): pilih fasilitas yang akan Anda kerjakan dan
   unduh datanya. Data dienkripsi di ponsel dan dihapus 72 jam setelah sinkron terakhir.
2. **Pindai kode QR** untuk menemukan alat, atau **Daftarkan alat** untuk alat baru.
3. **Perekaman IPM** bekerja seperti di dasbor. **Setiap perubahan tersimpan di ponsel ini** — tidak
   ada tombol simpan yang bisa Anda lupa.
4. **Kirim** mengunci rekaman di ponsel. Rekaman terkirim ke server saat ada koneksi.
5. **Antrean** menampilkan apa yang belum terkirim, apa yang menunggu dicoba lagi, dan apa yang perlu
   tindakan. Rekaman yang ditolak server ditampilkan **dengan pesan server apa adanya**; Anda dapat
   **Lanjutkan mengisi** setelah memperbaiki, atau **Buang** rekaman.
6. **Tanda tangan** hanya daring, di halaman laporan. Kata sandi tidak pernah disimpan di ponsel.

> **Penting:** iOS tidak menyinkronkan di latar belakang. **Buka aplikasi saat daring** agar antrean
> terkirim.

### 1.4 Mengoreksi IPM yang Sudah Dikirim

Buka **IPM**, pilih kunjungan, lalu **Koreksi**. Koreksi membuat **draf baru** yang menyalin isi
kunjungan asli; perbaiki, lalu kirim. Kunjungan asli tetap dapat dibaca — koreksi menggantikannya
hanya setelah dikirim. Alasan koreksi wajib diisi.

### 1.5 Mencatat Tanggal Kalibrasi (Laboratorium Luar)

Buka **Tanggal kalibrasi** → tab **Catat tanggal**.

1. Cari alat dari **stiker QR** (ketik nomornya, atau arahkan pemindai genggam). Nomor saja boleh:
   awalan dan nol di depan ditambahkan oleh server.
2. Isi **tanggal kalibrasi**, **nomor sertifikat**, **hasil menurut laboratorium**, dan
   **laboratorium** (pilih dari daftar, atau ketik namanya).
3. **Konfirmasi ruangan** alat saat ini, atau ubah bila alat sudah dipindah.
4. Simpan. Bila sudah ada kalibrasi pada tanggal yang sama, sistem memberi tahu bahwa ini akan
   menjadi **entri kedua** untuk hari itu — riwayat tetap disimpan.

**Tidak ada berkas yang disimpan.** Sertifikat laboratorium luar adalah dokumen laboratorium itu;
sistem mencatat **datanya**, bukan filenya.

### 1.6 Ekspor

Buka **Ekspor**. Ukuran dibaca lebih dulu, lalu pilih:

- **PDF inventaris** — tata letak **Penyedia** (A3, dengan kolom teknisi dan tanggal inventaris) atau
  **Fasilitas** (A4). Satu PDF berisi **satu fasilitas**; pilih fasilitasnya dulu.
- **XLSX inventaris**, dan **rekap kalibrasi** (XLSX).

Semuanya dibuat di peramban Anda; Anda dapat membatalkan di tengah proses.

### 1.7 Yang Tidak Dapat Anda Lakukan

| Tidak dapat | Mengapa |
|---|---|
| Menghapus atau mengubah IPM yang sudah dikirim | Bukti mutu tidak ditimpa; gunakan **Koreksi** |
| Membatalkan (void) IPM | Hanya administrator tenant, dengan alasan |
| Mengubah fasilitas sebuah alat | Perpindahan alat adalah satu operasi teraudit (lihat admin penyedia) |
| Memindai tanda tangan sendiri dari ponsel | Tanda tangan hanya daring, di halaman laporan |

---

## 2. Panduan Pengguna Faskes

**Anda adalah:** akun yang **terikat pada satu fasilitas** — `HEALTHCARE ADMIN` (admin faskes, dulu
akun `client` pertama) atau `ROOM USER` (dulu akun `client` lainnya). Kadang `HEALTHCARE TECHNICIAN`
(dulu `teknisi_client`).

### 2.1 Apa yang Anda Lihat

Anda **hanya melihat fasilitas Anda sendiri**. Fasilitas lain milik klien lain di perusahaan penyedia
yang sama **tidak** muncul di daftar, pencarian, ekspor, atau laporan Anda — bukan disembunyikan,
memang tidak ada bagi Anda.

| Anda melihat | Catatan |
|---|---|
| **Alat** fasilitas Anda | daftar, pencarian, riwayat tiap alat |
| **IPM** fasilitas Anda | kunjungan yang sudah dikirim, hasilnya, laporannya |
| **Tanggal kalibrasi** fasilitas Anda | kalibrasi terakhir tiap alat |
| **Sertifikat** fasilitas Anda | hanya baca |
| **Ekspor** fasilitas Anda | PDF/Excel |

Apa yang boleh Anda **ubah** bergantung pada peran Anda. Batas atas tiap peran terikat ditetapkan
di sistem (`BOUND_MENU_CEILING`), jadi tidak ada pengaturan yang dapat memberi akun terikat lebih
dari batas ini:

| Peran | IPM | Alat dan tanggal kalibrasi | Tanda tangan laporan |
|---|---|---|---|
| **Admin faskes** (`HEALTHCARE ADMIN`) | baca | baca | — |
| **Pengguna ruangan** (`ROOM USER`) | baca | baca | — |
| **Teknisi faskes** (`HEALTHCARE TECHNICIAN`) | **rekam, kirim dan koreksi**, di fasilitas Anda saja | **daftarkan dan ubah alat, serta fotonya**, di fasilitas Anda saja. Tanggal kalibrasi: baca saja | sebagai pelaksana |
| **IPSRS** (`FACILITY MAINTENANCE`) | baca | baca | tanda tangan bersama (bagian 4) |

Teknisi faskes mengikuti langkah **1.2 – 1.4**. Aplikasi luring `/field` hanya mengunduh alat
fasilitas Anda. Bedanya, semua alat dan kunjungan yang Anda lihat dan rekam terbatas pada fasilitas
Anda. Langkah 1.5 (mencatat tanggal kalibrasi) **tidak** dibuka untuk akun terikat: server
menolaknya dengan 403. Alat atau stiker milik fasilitas lain dijawab "tidak
ditemukan".

### 2.2 Membaca Hasil IPM dan Laporan

Buka **IPM** untuk melihat riwayat kunjungan. Pilih satu kunjungan untuk melihat hasilnya per bagian
dan **koreksi** yang pernah dilakukan (kunjungan asli tetap ada).

Untuk laporan: buka laporan kunjungan, lalu **Unduh … sebagai PDF**. Laporan berisi identitas alat,
hasil per bagian, rekomendasi, tanda tangan pelaksana, dan — bila diaktifkan — tanda tangan bersama
IPSRS. **Foto bukti** ditampilkan di halaman laporan (di layar), tetapi **tidak dicetak** di PDF.

Bila alat memiliki halaman publik (lihat bagian 3.5), stiker QR alat membawa kode acak yang tidak
dapat ditebak; halaman itu menampilkan **data minimal** saja.

### 2.3 Yang Tidak Dapat Anda Lakukan

| Tidak dapat | Mengapa |
|---|---|
| Mengubah data alat, mencatat kalibrasi, atau mengisi IPM (admin faskes, pengguna ruangan, IPSRS) | Peran-peran ini **hanya baca** pada data teknis. Pekerjaan itu milik teknisi penyedia atau teknisi faskes |
| Mengundang atau mengelola pengguna | Manajemen pengguna bukan tugas akun faskes |
| Melihat fasilitas lain | Itu data klien lain |
| Membatalkan IPM | Hanya administrator tenant penyedia |

---

## 3. Panduan Admin Penyedia Jasa

**Anda adalah:** `CALIBRATOR ADMIN` (dulu `admin`). Anda mengelola pengguna, **fasilitas klien**, dan
kaitan akun staf faskes.

### 3.1 Mengelola Fasilitas Klien

Buka **Fasilitas klien** (menu samping).

- **Tambah fasilitas** — isi nama dan **kode**. Kode dipakai pada nomor laporan (mis.
  `IPM-<kode fasilitas>-<tanggal>-<urut>`), jadi buat yang pendek dan konsisten.
- **Ubah** — nama, alamat, narahubung, dan seterusnya.
- **Ubah status** — `Aktif` / `Nonaktif` / `Berakhir`. Meninggalkan `Aktif` akan **mengeluarkan semua
  akun fasilitas itu**; fasilitas yang `Berakhir` **tidak menerima catatan baru** dan hanya dapat
  diaktifkan kembali oleh administrator tenant.
- **Hapus** — hanya bila fasilitas belum punya alat atau catatan. Fasilitas yang sudah punya catatan
  **diakhiri**, bukan dihapus.

### 3.2 Mengikat Akun Staf Faskes ke Fasilitasnya

Ini yang membuat staf faskes **hanya** melihat fasilitasnya.

1. Buka **Fasilitas klien** → **Pengguna {nama fasilitas}**.
2. **Ikat akun**: ketik nama, nama pengguna, atau e-mail orangnya, lalu pilih.
3. Pilih **peran** yang boleh dimiliki akun fasilitas, lalu konfirmasi.

> **Mengubah ikatan akan mengeluarkan akun tersebut.** Setelah diikat, orang itu masuk lagi dan hanya
> melihat fasilitasnya. **Lepaskan** mengembalikannya bekerja di semua fasilitas.

### 3.3 Mengundang Pengguna Hasil Impor

Akun yang datang dari aplikasi lama **tidak dapat masuk** sampai diundang.

1. Operator platform lebih dulu membuka undangan untuk organisasi Anda. Bila belum, layar undangan
   mengatakan **"Undangan untuk organisasi ini belum dibuka."**
2. Buka halaman **Pengguna**, cari orangnya, lalu **Undang {nama}**.
3. Bila itu **akun bersama** dari aplikasi lama, isi **siapa yang akan memakai akun ini** — satu nama.
   Nama itu tercatat di jejak audit.
4. **Kirim undangan**. E-mail berisi tautan sekali pakai yang berlaku **7 hari**; tautannya tidak
   pernah ditampilkan di layar. Anda dapat **Kirim lagi** atau **Tarik undangan**.
5. **Akun yang masih menunggu 30 hari setelah undangan pertama akan dinonaktifkan** secara otomatis.
   Anda dapat mengaktifkannya kembali dan mengundang ulang.

> Untuk akun impor, tombol reset kata sandi **sengaja tidak tersedia** — itu akan membuka akun
> sebelum pemeriksaan sebelum-undangan selesai. Kirim undangannya.

### 3.4 Memindahkan Alat Antar Fasilitas

Buka **Alat**, pilih alat, lalu **Pindahkan**. Perpindahan adalah satu operasi teraudit: seluruh
riwayat alat (kalibrasi, IPM, sertifikat) mengikuti, dan berkas-berkasnya dipindahkan ke ruang
fasilitas baru. Perpindahan ditolak bila alat sudah **dipensiunkan**, bila ada **draf IPM** yang
belum selesai, atau bila **nomor serinya sudah ada** di fasilitas tujuan.

### 3.5 Pengaturan Tenant (termasuk Halaman Publik Alat)

Di halaman **Tenant**, panel **Pengaturan IPM dan halaman publik**:

- **Halaman publik alat** — `nonaktif` (bawaan), `minimal`, atau `minimal dengan laporan IPM
  terakhir`. Bila aktif, setiap alat dapat memiliki tautan publik berisi **kode acak** yang dapat
  dicabut; halaman itu menampilkan data minimal dan tidak dapat ditebak.
- **Tanda tangan bersama IPSRS** — menyalakan kewajiban tanda tangan kedua oleh IPSRS faskes.
- **Interval IPM** (1–60 bulan) dan **zona waktu tenant** — dipakai untuk menghitung jatuh tempo.

### 3.6 Yang Tidak Dapat Anda Lakukan

| Tidak dapat | Mengapa |
|---|---|
| Mengelola tenant atau operator platform | Itu kewenangan operator (super admin) |
| Menyalakan undangan untuk organisasi Anda | Operator platform yang membukanya, setelah pemeriksaan sebelum-undangan |
| Mengubah laporan yang sudah ditandatangani | Laporan adalah bukti; gunakan koreksi/void |

---

## 4. Panduan IPSRS (Tanda Tangan Bersama)

**Anda adalah:** `FACILITY MAINTENANCE`, terikat pada fasilitas Anda. Tugas Anda di sini satu:
**menandatangani bersama** laporan IPM yang dikerjakan teknisi penyedia di fasilitas Anda.

### 4.1 Kapan Anda Diminta Menandatangani

Bila administrator tenant menyalakan **tanda tangan bersama IPSRS**, sebuah laporan yang sudah
ditandatangani pelaksana menampilkan **Tanda tangan bersama**. Anda menandatangani **setelah**
pelaksana, bukan sebagai penggantinya.

### 4.2 Caranya

1. Buka laporan kunjungan (dari **IPM**, atau dari tautan yang dikirim ke Anda).
2. Baca hasil per bagian, rekomendasi, dan **foto bukti** di layar.
3. Klik **Tanda tangan bersama**. Dialog menampilkan **makna** tanda tangan lebih dulu; Anda
   menyatakan telah membacanya, lalu memasukkan kata sandi Anda saat itu. Kata sandi tidak disimpan.
4. Setelah ditandatangani, laporan menampilkan kedua tanda tangan.

### 4.3 Yang Tidak Dapat Anda Lakukan

| Tidak dapat | Mengapa |
|---|---|
| Menandatangani laporan yang belum ditandatangani pelaksana | Urutannya pelaksana dulu |
| Menandatangani laporan fasilitas lain | Anda hanya melihat fasilitas Anda |
| Mengisi atau mengubah isi IPM | Itu pekerjaan teknisi; Anda memeriksa dan menandatangani |
| Menandatangani laporan yang sudah dibatalkan (void) | Laporan batal bukan rekam yang berlaku |

> **Bila tanda tangan gagal**, pesannya menjelaskan sebabnya — mis. Anda bukan pihak yang berhak
> untuk kunjungan itu, atau laporan sudah ditandatangani. Pesan itu berasal dari server dan mengikuti
> aturan yang sama yang dilihat auditor.

---

## 5. Istilah di Layar (Ringkas)

| Di layar | Artinya |
|---|---|
| **Pindai kode QR** | Membaca nomor stiker alat |
| **Antrean** | Daftar rekaman di ponsel yang belum terkirim ke server |
| **Periksa dan kirim** | Langkah terakhir IPM sebelum dikirim |
| **Foto bukti** | Foto yang menjelaskan temuan inspeksi |
| **Koreksi** | Membuat versi baru sebuah IPM yang sudah dikirim |
| **Void / batalkan** | Menyatakan IPM tidak berlaku, dengan alasan (administrator) |
| **Tanda tangan bersama** | Tanda tangan IPSRS setelah tanda tangan pelaksana |
| **Siapkan ponsel ini** | Mengunduh data fasilitas untuk kerja luring |

---

## 6. Batasan Dokumen Ini (agar tidak dilebihkan)

- **Ini draf yang belum diuji di lapangan.** Layar sudah dibangun dan diuji dengan perangkat lunak,
  tetapi **belum dijalankan bersama pengguna nyata** (P26-02). Istilah dapat berubah sedikit dan akan
  diselaraskan dengan kamus aplikasi.
- **Tidak menggantikan pelatihan.** Untuk **pelatihan langsung dan video singkat**, lihat **P29-03**
  (belum dikerjakan).
- **Beberapa langkah bergantung pada pengaturan yang mati secara bawaan:** undangan pengguna impor
  (dibuka operator), pengikatan akun faskes, tanda tangan bersama IPSRS, dan halaman publik alat.
  Bila sebuah tombol tidak muncul, pengaturannya belum dinyalakan — tanyakan administrator tenant
  atau operator platform.
- **Belum terjadi, dan belum boleh dianggap sudah:**
  - **Uji di ponsel nyata.** Aplikasi lapangan (`/field`) sudah diuji dengan peramban otomatis,
    tetapi **belum dijalankan di dua ponsel nyata** (Android dan iOS; P22-10, P26-02). Langkah 1.3
    belum terbukti di perangkat Anda.
  - **Stiker QR lama.** Format stiker dari aplikasi lama belum diketahui (**OA-4**, keputusan
    pemilik). Pemindaian stiker lama ke alat yang benar **belum dibangun** (P27-02). Gunakan stiker
    baru atau ketik nomor alatnya.
  - **Data lama.** Data dari aplikasi lama **belum dipindahkan**. Uji coba pemindahan dengan data
    asli menunggu keputusan hukum pemilik (**OA-5**, UD-18). Selama itu, riwayat IPM dan alat dari
    aplikasi lama tidak tampil di sini.
- **Bukan dokumen kepatuhan.** Kewajiban hukum, dasar pemrosesan data, dan retensi ada di
  [`06-DPIA.md`](./06-DPIA.md) dan [`07-DATA-MINIMISATION.md`](./07-DATA-MINIMISATION.md).
