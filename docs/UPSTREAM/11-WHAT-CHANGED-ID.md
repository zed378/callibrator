# 11 — Apa yang Berubah: dari SKP IPM ke Device Calibrator (untuk Staf Faskes dan Staf Penyedia Jasa)

> **English summary.** The "what changed" note of card **P29-02**, in Indonesian, for the people who
> used the upstream SKP IPM app: facility staff (`client`, `teknisi_client`, IPSRS) and the service
> provider's staff (`admin`, `user`). It explains, in plain language: one personal account per
> person, reached by an **invitation** (old passwords do not carry over); what each kind of account
> sees; that a submitted IPM is **never overwritten** — it is **corrected** by a new version, and
> only an administrator may void it with a reason; that several IPMs per device per month are
> normal and the monthly schedule is only a "due" flag; that reports and exports are **rendered in
> the browser** and not stored; the **new QR stickers** and the public device page (working decisions
> UD-15 and UD-16, with their open points); that the **PWA replaces the Android APK**, with its
> offline rules; and what happens when a facility leaves. **Target text** — the application is not
> built yet (Phases 20 – 22); every statement follows an ADR or a recorded decision named in § 12,
> and the note is re-checked against the built screens at UAT (P26-01) and folded into the user
> guides (P29-01). No real data, name, facility or address appears here.

**Status:** draf 2026-10-08 (P29-02), **menunggu pengecekan terhadap aplikasi yang sudah dibangun**
(UAT, P26) — istilah di layar dapat sedikit berbeda dan akan diselaraskan dengan kamus aplikasi
(`id.ts`). Bagian yang masih **keputusan kerja** (dapat diubah pemilik) ditandai ⚠.

---

## 1. Ringkasnya

| Dulu (SKP IPM) | Sekarang (Device Calibrator) |
|---|---|
| Akun bersama per faskes, kata sandi lama | **Satu akun per orang**, diaktifkan lewat **undangan** e-mail; kata sandi lama tidak dibawa |
| Simpan ulang IPM = data bulan itu ditimpa | IPM yang sudah dikirim **tidak pernah ditimpa** — salah ketik diperbaiki dengan **koreksi**; riwayat lengkap tetap ada |
| Satu IPM per alat per bulan | **Boleh lebih dari satu** IPM per alat; jadwal bulanan hanya menandai alat yang **jatuh tempo** |
| Laporan PDF/Excel dibuat di server | Laporan dan ekspor **dibuat di peramban (browser)** Anda; tidak ada berkas laporan yang disimpan di server |
| Stiker QR berisi nomor urut; halaman publik bisa ditebak | **Stiker QR baru** dengan kode acak yang tidak bisa ditebak; halaman publik menampilkan data minimal ⚠ |
| Aplikasi Android (APK) | **Aplikasi web (PWA)** yang dipasang ke layar utama ponsel, bisa bekerja **offline** |
| Akun faskes melihat menu yang tidak relevan | Akun faskes **hanya melihat faskesnya sendiri** |

---

## 2. Akun dan Cara Masuk

- **Setiap orang mendapat akunnya sendiri.** Akun bersama ("satu akun untuk satu faskes") tidak
  dipakai lagi: catatan IPM dan kalibrasi adalah bukti mutu, dan setiap bukti harus menyebut siapa
  yang mengerjakannya. Saat peralihan, admin penyedia jasa menanyakan **siapa orang di balik setiap
  akun lama**, lalu mengundang orang itu.
- **Undangan, bukan kata sandi lama.** Anda menerima **e-mail undangan** berisi tautan sekali pakai.
  Buka tautan itu, buat kata sandi baru, lalu masuk. Kata sandi lama **tidak berlaku** dan tidak
  pernah disalin ke sistem baru. Tautan undangan kedaluwarsa setelah beberapa hari — minta undangan
  ulang ke admin penyedia jasa bila terlewat.
- **Lengkapi nama Anda.** Banyak akun lama tidak memiliki nama lengkap; saat menerima undangan,
  periksa dan perbaiki nama Anda.
- **Akun yang sudah tidak aktif** di aplikasi lama tetap tidak aktif dan tidak diundang.
- Untuk keamanan tambahan Anda dapat memasang **passkey** (sidik jari/wajah pada perangkat) atau
  kode verifikasi dua langkah dari halaman profil.

## 3. Siapa Melihat Apa

| Anda adalah | Di Device Calibrator Anda… |
|---|---|
| **Admin penyedia jasa** (dulu `admin`) | mengelola pengguna, daftar faskes klien, dan mengaitkan akun staf faskes ke faskesnya; dapat membatalkan (void) IPM dengan alasan |
| **Teknisi penyedia jasa** (dulu `user`/Teknisi) | bekerja di **semua faskes** yang dilayani penyedia: mendaftarkan dan mengubah data alat, mencatat kalibrasi, mengisi IPM ⚠ (pendaftaran alat dan pencatatan kalibrasi oleh teknisi adalah keputusan kerja UD-4 (b)) |
| **Admin faskes** (dulu akun `client` pertama di faskes Anda) | melihat **hanya faskes Anda**: daftar alat, riwayat IPM dan kalibrasi, sertifikat, perintah kerja — **hanya baca**; tidak mengelola pengguna |
| **Pengguna ruangan** (akun `client` lainnya) | sama seperti admin faskes: hanya baca, hanya faskes Anda |
| **Teknisi faskes** (dulu `teknisi_client`) | di **faskes Anda saja**: mendaftarkan alat, mengisi IPM, mengunggah foto alat |
| **IPSRS** (baru) | di faskes Anda: melihat IPM, dan — bila faskes Anda memakainya — **menandatangani (kontrasign) laporan IPM secara elektronik** ⚠ |

Akun faskes **tidak dapat** melihat faskes lain, data internal penyedia jasa (vendor, stok,
pengguna lain), maupun laporan rekap seluruh klien. Bila Anda membuka alamat data milik faskes lain,
aplikasi menjawab "tidak ditemukan" — sama seperti data yang memang tidak ada.

## 4. IPM: Tidak Ada Lagi "Simpan Ulang Menimpa" — Ada Koreksi

Ini perubahan terbesar bagi teknisi.

1. **Draf → Kirim.** IPM dimulai sebagai **draf**: Anda dapat mengisi, menyimpan, dan melanjutkan
   kapan saja. Draf hanya dapat diubah oleh pembuatnya. Saat semua butir wajib terisi, tekan
   **Kirim**. Sejak dikirim, IPM menjadi **catatan resmi** dan **tidak dapat diubah lagi**.
2. **Salah isi? Buat koreksi.** Pada IPM yang sudah dikirim, pilih **Koreksi**: aplikasi membuat
   salinan sebagai draf baru; perbaiki, tulis **alasan koreksi**, lalu kirim. IPM lama **tetap
   tersimpan** dengan tanda "digantikan oleh versi koreksi" — tidak dihapus. Inilah yang diminta
   standar mutu (ISO/IEC 17025, 21 CFR Part 11): perubahan tidak boleh menghilangkan catatan aslinya.
   Mengubah **tanggal** pelaksanaan juga dilakukan lewat koreksi.
3. **Membatalkan (void).** IPM yang memang tidak seharusnya ada (misalnya tercatat ganda) dibatalkan
   oleh **admin penyedia jasa**, dengan alasan tertulis. Teknisi dan akun faskes tidak dapat
   membatalkan — mintalah ke admin. IPM yang dibatalkan tetap terlihat sebagai "dibatalkan".
4. **Lebih dari satu IPM per bulan itu normal.** Kunjungan ulang setelah perbaikan dicatat sebagai
   IPM baru; keduanya disimpan. Jadwal bulanan sekarang hanya **menandai alat yang jatuh tempo**,
   tidak melarang pengisian.
5. **Nomor kunjungan** diberikan saat IPM pertama kali dikirim. Bila ada IPM yang dibatalkan,
   nomornya tidak dipakai ulang — celah nomor itu wajar, bukan kesalahan.
6. **Riwayat lama dibawa.** IPM dari aplikasi lama dipindahkan sebagai catatan yang sudah dikirim;
   nomor kunjungan lama ditampilkan apa adanya.
7. **Daftar periksa (ceklis) berversi.** Ceklis IPM sekarang satu katalog untuk semua, dengan
   **versi**. IPM selalu memakai versi yang berlaku saat dibuat, sehingga laporan lama tidak berubah
   ketika ceklis diperbarui.

Akibat rekomendasi IPM ⚠ (keputusan kerja UD-17): "perlu perbaikan" membuat perintah kerja
perbaikan; "tidak layak pakai" mengubah status alat menjadi dalam perawatan; "perlu kalibrasi"
menandai alat untuk penjadwalan kalibrasi — semuanya tercatat otomatis saat IPM dikirim.

## 5. Data Alat dan Kalibrasi

- **Nomor seri unik per faskes.** Dua faskes boleh memiliki nomor seri yang sama; di dalam satu
  faskes tidak. Bila data lama memiliki nomor seri ganda di satu faskes, admin penyedia akan
  menerima daftar untuk diperiksa.
- **Foto alat** diunggah lewat aplikasi; data lokasi (GPS) di foto dihapus otomatis.
- **Catatan kalibrasi** juga tidak ditimpa: kesalahan diperbaiki dengan koreksi; pembatalan hanya
  oleh admin.
- **Tanggal kalibrasi berikutnya** untuk alat yang dipindahkan dari aplikasi lama **belum diisi
  otomatis** sampai arti kolom tanggal kalibrasi lama dipastikan oleh penyedia jasa ⚠ (UD-8, OA-7) —
  jadi pengingat jatuh tempo kalibrasi untuk alat lama belum aktif pada awalnya.
- **PDF sertifikat dari lab eksternal** yang dulu diunggah **tidak dimasukkan** ke aplikasi baru:
  berkasnya diarsipkan secara aman di luar aplikasi dan dapat diminta ke penyedia jasa bila
  diperlukan.

## 6. Laporan dan Ekspor Dibuat di Peramban

- Laporan IPM, daftar inventaris (PDF/Excel), dan rekap kalibrasi **dibuat langsung di peramban**
  Anda dari data terbaru. Server **tidak menyimpan** berkas laporan.
- **Laporan IPM memiliki kode QR verifikasi**: siapa pun yang memindainya dapat memastikan isi
  laporan cocok dengan catatan di sistem. Laporan versi koreksi menyebut bahwa ia menggantikan versi
  sebelumnya; versi lama tetap dapat dibuka.
- Ekspor besar (misalnya inventaris dengan foto untuk faskes besar) **memerlukan waktu**; ukurannya
  ditampilkan sebelum mulai dan prosesnya terlihat. Di ponsel lambat, gunakan komputer untuk ekspor
  terbesar.
- Akun faskes mendapat ekspor **faskesnya sendiri**; rekap seluruh klien hanya untuk staf penyedia.

## 7. Stiker QR Baru dan Halaman Publik ⚠

- **Stiker baru** berisi kode acak panjang yang **tidak dapat ditebak** (dulu nomor urut yang bisa
  dicoba satu per satu). Penyedia jasa akan mengganti stiker secara bertahap.
- **Halaman publik** (yang terbuka saat pengunjung atau pasien memindai stiker) menampilkan secara
  bawaan: **identitas alat, status kalibrasi, dan tanggal IPM terakhir**. **Foto dan dokumen tidak
  ditampilkan.** Setiap penyedia dapat mengatur tampilan ini, dan kode stiker dapat dicabut.
  *(Keputusan kerja UD-15 — dapat diubah pemilik.)*
- **Stiker lama:** cara kerjanya bergantung pada isi stiker lama, yang **belum dipastikan** (pemilik
  akan memindai satu stiker fisik — OA-4). Bila stiker lama berisi alamat web, alamat itu akan
  diarahkan ke halaman publik minimal; bila hanya berisi nomor, stiker lama dapat dipindai **dari
  dalam aplikasi** oleh staf yang sudah masuk. *(Keputusan kerja UD-16 — kedua cara sudah
  dirancang; pilihan final menunggu pemindaian.)*
- Teknisi yang sudah masuk memindai stiker dari aplikasi untuk membuka alat; stiker milik faskes
  lain menjawab "tidak ditemukan" bagi akun faskes.

## 8. Aplikasi Android (APK) Diganti Aplikasi Web (PWA)

- **APK lama dihentikan** saat peralihan. Penggantinya adalah aplikasi web yang **dipasang ke layar
  utama** ponsel: buka alamat aplikasi di Chrome (Android) atau Safari (iPhone), lalu pilih
  "Tambahkan ke Layar Utama". Di iPhone, **memasang ke layar utama wajib** agar data offline tidak
  dihapus otomatis oleh Safari.
- **Mode offline** (untuk ruang bawah tanah, radiologi, puskesmas dengan sinyal lemah): aktifkan
  "Siapkan ponsel ini untuk kerja offline", pilih faskes atau daftar alat yang akan dikunjungi, lalu
  Anda dapat mencari alat dengan QR, mendaftarkan alat dengan foto, dan mengisi IPM tanpa sinyal.
  Pekerjaan masuk ke **antrean kirim** dan **tersinkron otomatis** saat sinyal kembali (atau tekan
  "Sinkronkan sekarang").
- **Di iPhone, sinkronisasi hanya berjalan saat aplikasi terbuka.** Buka aplikasi setelah selesai
  bekerja agar antrean terkirim.
- **Bila ada yang ditolak saat sinkron** (misalnya alat sudah dipindah atau dihapus), item itu tetap
  di antrean dengan tanda "perlu perhatian" dan penjelasannya — tidak pernah hilang diam-diam.
- **Aturan keamanan di ponsel:**
  - **Kunci layar wajib** (PIN/sidik jari). Aplikasi offline tidak dapat mengetahui siapa yang
    memegang ponsel; ponsel yang tidak dikunci dapat dipakai orang lain atas nama Anda.
  - **Satu pengguna per profil peramban.** Jangan berbagi satu ponsel/profil untuk dua akun; aplikasi
    akan menolaknya selama masih ada pekerjaan yang belum terkirim.
  - **Keluar (logout) ditolak** selama masih ada pekerjaan yang belum tersinkron — sinkronkan dulu,
    atau buang pekerjaan itu secara sadar dengan konfirmasi.
  - **Data kerja offline dihapus otomatis 72 jam** setelah sinkron terakhir (antrean kirim Anda tidak
    ikut dihapus).
  - **Ponsel hilang:** segera lapor ke admin penyedia; admin mencabut sesi Anda, dan data kerja di
    ponsel itu terhapus saat ponsel tersambung lagi.
- **Peramban minimal untuk offline:** Android Chrome 120 ke atas; iPhone/iPad iOS 17.4 ke atas
  (terpasang di layar utama). Peramban yang lebih lama tetap dapat dipakai **secara online**.
- **Foto** diambil langsung dengan kamera ponsel dari aplikasi; foto diperkecil dan data lokasi
  dihapus sebelum dikirim.

## 9. Bila Faskes Berhenti Menjadi Klien ⚠

Sebelum hubungan dengan sebuah faskes diakhiri, penyedia jasa menawarkan **paket serah terima** yang
dibuat di peramban: daftar alat, riwayat kalibrasi dan IPM, serta sertifikat faskes tersebut.
**Mengakhiri hubungan tidak menghapus data**; lama penyimpanan mengikuti kontrak dengan faskes
(bawaan: disimpan selama masa simpan bukti yang berlaku bagi faskes). Akun staf faskes itu langsung
tidak dapat masuk dan **dinonaktifkan 30 hari** kemudian. *(Keputusan kerja UD-18 (b).)*

## 10. Data Pribadi

Data pribadi Anda diproses sesuai UU PDP 27/2022. Anda dapat mengunduh salinan data pribadi Anda dan
mengajukan permintaan terkait data pribadi dari halaman profil. Hanya data yang diperlukan yang
dipindahkan dari aplikasi lama (misalnya foto profil lama tidak dibawa).

## 11. Yang Masih Bisa Berubah ⚠

| Hal | Status | Siapa yang memastikan |
|---|---|---|
| Isi halaman publik (UD-15) | keputusan kerja: identitas + status kalibrasi + tanggal IPM terakhir; foto/dokumen tidak | pemilik dapat mengubah |
| Cara kerja stiker lama (UD-16) | dua cara dirancang; pilihan menunggu pemindaian stiker | pemilik (OA-4) |
| Kontrasign IPSRS dan akibat rekomendasi IPM (UD-17) | keputusan kerja; kontrasign diaktifkan per penyedia | pemilik dapat mengubah |
| Pendaftaran alat dan pencatatan kalibrasi oleh teknisi (UD-4 (b)) | keputusan kerja: ya | pemilik dapat mengubah |
| Tanggal kalibrasi berikutnya untuk alat lama (UD-8) | belum diisi | penyedia jasa (OA-7) |
| Serah terima dan masa simpan saat faskes berhenti (UD-18 (b)) | keputusan kerja | kontrak penyedia–faskes |
| Istilah di layar | dapat sedikit berbeda | dicek saat UAT (P26) |

## 12. Dasar Keputusan (untuk pembaca teknis)

ADR-124 (penyedia = tenant, faskes = klien di dalamnya, akun faskes terikat ke faskesnya) dan
Amandemen 1 – 2 · ADR-125 (katalog ceklis global berversi) · ADR-126 (IPM sebagai catatan resmi:
draf → kirim, koreksi, void; laporan dan ekspor dirender di frontend) · ADR-127 (PWA offline) ·
ADR-108 / P10-15 (undangan) · `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md` § 3 (UD-4, UD-5, UD-6,
UD-8, UD-9, UD-14 … UD-18) · [`06-DPIA.md`](./06-DPIA.md) · [`07-DATA-MINIMISATION.md`](./07-DATA-MINIMISATION.md) ·
[`08-FILE-POLICY.md`](./08-FILE-POLICY.md) · kartu P29-02 ([Fase 29](../../TASKS/PHASE-29-UPSTREAM-TRAINING-DOCS.md)).
