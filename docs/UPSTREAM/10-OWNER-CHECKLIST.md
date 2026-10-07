# 10 — Daftar Periksa Pemilik: Mengamankan Upstream dan Salinan Lokal (OA-1, OA-2, OA-3)

> **English summary.** A step-by-step checklist, in Indonesian, for the owner to run on the **live
> upstream server** (CodeIgniter 4 + myth/auth) and on the **local copy** `mozivid/`: back up,
> check for a possible past breach, close self-registration properly (an `app/Config/Auth.php`
> override instead of the edited vendor file), switch to production mode, delete `info.php` and
> operator files from `public/`, put the public QR/IPM/PDF routes behind a role, rotate the DB
> password and `JWT_SECRET`, enable CSRF, block script execution in `public/uploads`, then encrypt
> the local copy (BitLocker, VeraCrypt or 7-Zip AES-256), keep it out of cloud sync, and delete it
> securely after cutover. **No secret value appears here.** It closes 06 risks R-01, R-02, R-03 and
> answers R-17. Card P17-01 is DONE only when the owner confirms each box.

**Status:** diserahkan 2026-10-07, **menunggu pelaksanaan dan konfirmasi pemilik** (P17-01).
Rujukan temuan: [`00-OVERVIEW.md`](./00-OVERVIEW.md) § 9 (S-01 … S-18); risiko:
[`06-DPIA.md`](./06-DPIA.md) § 5. Dokumen ini **tidak memuat** kata sandi, kunci, nama orang,
nama faskes, atau alamat server. Jangan menuliskan nilai rahasia ke dokumen, chat, atau tiket —
simpan hanya di pengelola kata sandi.

**Urutan wajib:** § 1 → § 2 → § 3 dahulu (cadangan dan pemeriksaan insiden **sebelum** mengubah
apa pun, agar bukti tidak hilang), lalu § 4 … § 7 secepatnya (hari yang sama), § 8 … § 9 untuk
salinan lokal. Setiap langkah di server: kerjakan saat lalu lintas sepi, dan uji login admin,
teknisi, dan akun faskes sesudahnya.

---

## 1. Cadangan dulu (sebelum mengubah apa pun)

- [ ] Buat dump basis data: `mysqldump --single-transaction --routines <nama_db> > ipm-<tanggal>.sql`
      (jalankan di server; nama DB ada di `.env`, jangan disalin ke tempat lain).
- [ ] Salin folder aplikasi **tanpa** `public/uploads` (kode, `.env`, `writable/`) ke arsip.
- [ ] Simpan keduanya **langsung terenkripsi** (lihat § 8, 7-Zip AES-256) — bukan di folder
      bersama/Google Drive/OneDrive tanpa enkripsi.
- [ ] Simpan juga log server web (Apache/Nginx `access.log` dan `error.log`, minimal 90 hari ke
      belakang) — ini bukti untuk § 3.

## 2. Matikan mode development (S-02)

- [ ] Di `.env` aplikasi: ubah `CI_ENVIRONMENT = development` menjadi
      `CI_ENVIRONMENT = production`.
- [ ] Pastikan `app/Config/Boot/production.php` berisi `ini_set('display_errors', '0');`
      (bawaan CodeIgniter 4).
- [ ] Muat ulang PHP-FPM / Apache. **Uji:** buka URL yang pasti salah (mis. `/tidak-ada-123`) —
      harus tampil halaman error biasa **tanpa** jejak kode (stack trace), path file, atau SQL.
- [ ] Pastikan toolbar debug (Kint / Debug Toolbar) tidak muncul lagi di bagian bawah halaman.

## 3. Periksa kemungkinan insiden (R-17) — sebelum menutup celah

Registrasi terbuka tanpa aktivasi memungkinkan siapa pun membuat akun, dan rute yang hanya
memakai filter `login` mengizinkan akun tanpa grup mengunduh inventaris faskes mana pun. Basis
data memiliki **satu akun tanpa grup**.

- [ ] Cari akun tanpa grup (jalankan di server, hasilnya **jangan** disalin ke repositori):
      `SELECT u.id, u.created_at, u.active FROM users u LEFT JOIN auth_groups_users g ON g.user_id = u.id WHERE g.user_id IS NULL;`
- [ ] Untuk setiap akun itu: apakah Anda mengenalinya? Jika **tidak**: nonaktifkan
      (`UPDATE users SET active = 0 WHERE id = <id>;`), catat waktu pembuatannya.
- [ ] Cari di `access.log` permintaan oleh sesi/akun itu atau dari IP yang sama ke:
      `inventory_download_admin_xls`, `inventory_download_admin`, `inventory_download`,
      `ipm/htmlToPDF`, `teknisi_list`, `dashboard`, `register`, dan juga akses ke `info.php` dan
      `.env`. Catat **jumlah** dan rentang waktu, bukan isinya.
- [ ] Jika ada bukti data pribadi (nama/e-mail staf) atau data faskes diakses oleh pihak yang
      tidak berwenang: ini **dugaan pelanggaran data pribadi**. Hubungi penasihat hukum **hari
      itu juga** — UU PDP Pasal 46 (sebagaimana dibaca) mewajibkan pemberitahuan tertulis
      **paling lambat 3 × 24 jam** kepada subjek data dan lembaga. Jangan menghapus log.
- [ ] Laporkan hasilnya (ada/tidak ada temuan, jumlah, tanggal) ke catatan proyek — tanpa nilai
      pribadi.

## 4. Tutup celah di folder publik (S-03, S-08, S-13)

- [ ] Hapus `info.php` di root situs (berisi `phpinfo()`). **Uji:** `https://<situs>/info.php`
      harus 404.
- [ ] Pindahkan keluar dari `public/` (ke folder di luar web root, atau hapus jika tidak dipakai):
      berkas APK, serta **berkas `.sh` dan `.txt` di `public/uploads/inventory/`**. Sebelum
      menghapus `.sh`: lihat di `access.log` apakah pernah diakses; jika isinya bukan skrip
      pemindahan berkas milik operator sendiri, perlakukan sebagai insiden (§ 3).
- [ ] Cari berkas skrip yang tidak semestinya ada di folder unggahan:
      `find public/uploads -type f \( -iname '*.php*' -o -iname '*.phtml' -o -iname '*.phar' -o -iname '*.sh' -o -iname '*.htaccess' \)`
      — hasil yang diharapkan: kosong (kecuali `.htaccess` dari § 9 langkah ini nanti).
- [ ] **Blokir eksekusi di `public/uploads`** (S-08). Untuk Apache (CodeIgniter 4 memakai
      `public/.htaccess`), buat `public/uploads/.htaccess`:
      ```apache
      # Tidak ada skrip yang boleh dijalankan dari folder unggahan
      Options -ExecCGI -Indexes
      RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .phar
      RemoveType .php .phtml .php3 .php4 .php5 .php7 .phar
      <FilesMatch "\.(php\d?|phtml|phar|sh|pl|py|cgi)$">
          Require all denied
      </FilesMatch>
      <IfModule mod_php.c>
          php_flag engine off
      </IfModule>
      <IfModule mod_headers.c>
          Header set X-Content-Type-Options "nosniff"
          <FilesMatch "\.svg$">
              Header set Content-Disposition "attachment"
          </FilesMatch>
      </IfModule>
      ```
      Pastikan virtual host mengizinkan `.htaccess` (`AllowOverride All` atau minimal `FileInfo
      Options AuthConfig`). **Untuk Nginx**, padanannya di blok server:
      `location ^~ /uploads/ { location ~ \.(php\d?|phtml|phar|sh)$ { deny all; } add_header X-Content-Type-Options nosniff; }`
- [ ] **Uji:** unggah (di lingkungan uji, bukan produksi) atau letakkan sementara berkas
      `uji.php` berisi `<?php echo 1;` di `public/uploads/` → membukanya harus **403**, bukan
      menampilkan "1". Hapus berkas uji itu.
- [ ] Pastikan `.env` tidak bisa diunduh: `https://<situs>/.env` harus 403/404 (document root
      harus `public/`, bukan folder aplikasi).

## 5. Tutup registrasi dengan benar (S-04) dan batasi rute publik (S-06, S-12)

File vendor `vendor/myth/auth/src/Config/Auth.php` **sudah diedit langsung** (tampilan login dan
registrasi kustom, registrasi aktif). Edit di vendor akan hilang saat `composer install`, jadi
pindahkan pengaturan ke **override di `app/Config`**:

- [ ] Buat `app/Config/Auth.php` (atau jalankan `php spark auth:publish`, lalu rapikan):
      ```php
      <?php
      namespace Config;

      use Myth\Auth\Config\Auth as MythAuth;

      class Auth extends MythAuth
      {
          // salin dari file vendor yang diedit: nilai $views yang menunjuk
          // ke tampilan login/registrasi kustom aplikasi
          // public $views = [ ... ];

          public $allowRegistration = false;   // registrasi mandiri DITUTUP
          public $requireActivation = null;    // tidak relevan bila registrasi ditutup
          public $minimumPasswordLength = 10;  // naik dari 6 (S-17)
      }
      ```
- [ ] Kembalikan file vendor ke aslinya: `composer reinstall myth/auth` (Composer ≥ 2.1), lalu
      pastikan tampilan login kustom tetap tampil (berarti `$views` sudah benar di override).
- [ ] **Uji:** `https://<situs>/register` tidak boleh lagi membuat akun (diarahkan kembali dengan
      pesan registrasi ditutup). Pengguna baru dibuat hanya oleh admin (menu Add User).
- [ ] Di `app/Config/Routes.php`, ganti filter rute publik. Filter `login` **tidak cukup** (akun
      tanpa grup lolos), pakai filter `role`:
      - `readQr/(:alphanum)` → `['filter' => 'role:admin,user,client,teknisi_client']`
      - `ipm/getIPM/(:hash)/(:hash)` → sama
      - `ipm/downloadSertifikatIPM` → sama
      - rute ekspor yang hanya `login`: `inventory_download`, `inventory_download_admin`,
        `inventory_download_admin_xls`, `ipm/htmlToPDF`, `inventory_ipm`,
        `inventory_datatable_ipm/(:segment)`, `teknisi`, `teknisi_list`, `group`, `ipm/editIPM` →
        role sesuai menu (admin/user untuk yang khusus penyedia)
      - **hapus** rute debug `recall` (S-12)
- [ ] Akibatnya: memindai stiker QR tanpa login akan diminta login. Itu disengaja sampai halaman
      publik yang aman tersedia di Callibrator (UD-15). Beri tahu teknisi.
- [ ] **Uji** dengan satu akun per grup: admin, teknisi, akun faskes, teknisi faskes — semua
      menu yang biasa dipakai tetap berfungsi; akun faskes tetap hanya melihat faskesnya.

## 6. Rotasi kata sandi basis data (OA-1, S-01)

- [ ] Buat kata sandi baru yang kuat (≥ 24 karakter acak) di pengelola kata sandi.
- [ ] Di MariaDB, sebagai admin DB:
      `ALTER USER '<user_aplikasi>'@'<host>' IDENTIFIED BY '<kata_sandi_baru>';`
      (`<host>` sesuai yang terdaftar, mis. `localhost`).
- [ ] Perbarui `database.default.password` di `.env`, muat ulang PHP-FPM / Apache, uji login.
- [ ] Pastikan port MariaDB (3306) **tidak** terbuka ke internet (`ss -ltnp | grep 3306` →
      hanya `127.0.0.1` atau socket); pengguna DB aplikasi tidak punya hak `GRANT`/`FILE`/`SUPER`.
- [ ] Jika ada salinan `.env` lama di tempat lain (cadangan, folder kerja), anggap kata sandi
      lama **bocor** — itulah alasan rotasi; jangan pakai ulang.

## 7. Rotasi `JWT_SECRET` dan aktifkan CSRF (OA-1, S-01, S-09, S-10)

- [ ] Buat secret baru: `openssl rand -base64 48` → simpan di pengelola kata sandi → ganti nilai
      `JWT_SECRET` di `.env` → muat ulang. Token lama (umur 10 menit) otomatis tidak berlaku.
      Catatan: API mobile saat ini menunjuk kelas yang tidak ada (`Apiuser_1`), jadi kemungkinan
      tidak dipakai; rotasi tetap wajib.
- [ ] Periksa apakah `.env` memuat rahasia lain (e-mail, layanan pihak ketiga) — rotasi juga.
- [ ] **CSRF** (dianjurkan; **uji di salinan dulu**, karena form AJAX bisa terputus): di
      `app/Config/Filters.php`, pada `$globals['before']` tambahkan
      `'csrf' => ['except' => ['api_v1/*']]`. Untuk form biasa pakai `<?= csrf_field() ?>`; untuk
      permintaan jQuery/DataTables tambahkan token di header
      (`<meta name="<?= csrf_header() ?>" content="<?= csrf_hash() ?>">` dan `$.ajaxSetup`).
      Uji simpan inventaris, simpan IPM, simpan kalibrasi, reset kata sandi, mapping user.
- [ ] Jika CSRF belum bisa diaktifkan karena memutus form, catat dan lanjutkan — **langkah § 2–6
      tetap wajib**.

## 8. Enkripsi salinan lokal `mozivid/` (OA-3)

Salinan lokal (36 dump + ±116 GB berkas) adalah **data pribadi nyata di laptop/PC**. Pilih salah
satu:

- [ ] **A. BitLocker (Windows 11 Pro — disarankan):** aktifkan BitLocker pada **seluruh drive**
      tempat `mozivid/` berada (Settings → Privacy & security → Device encryption / Control Panel →
      BitLocker Drive Encryption → Turn on). Simpan *recovery key* di luar laptop (pengelola kata
      sandi / kertas di tempat aman), **bukan** di folder yang sama.
- [ ] **B. VeraCrypt:** buat *container* ≥ 140 GB, AES-256, kata sandi kuat; pindahkan `mozivid/`
      ke dalamnya; mount hanya saat diperlukan.
- [ ] **C. 7-Zip AES-256** (cocok untuk dump dan arsip, kurang praktis untuk 116 GB yang masih
      dipakai): `7z a -t7z -mhe=on -p mozivid-dump-<tanggal>.7z mozivid\db_dump` — `-mhe=on`
      juga mengenkripsi nama berkas; kata sandi diketik saat diminta, jangan di baris perintah.
- [ ] Verifikasi: buka arsip/container sekali dan cocokkan jumlah berkas.
- [ ] **Keluarkan dari sinkronisasi awan:** proyek ada di `Documents` — jika OneDrive *Known
      Folder Move* aktif, `mozivid/` bisa terunggah ke OneDrive. Periksa (ikon awan OneDrive →
      Settings → Sync and back up → Manage back up); pindahkan `mozivid/` ke folder yang tidak
      disinkronkan, dan periksa juga di web OneDrive bahwa tidak ada salinan (hapus dari Recycle
      Bin OneDrive juga). Periksa File History / cadangan lain dengan cara yang sama.
- [ ] **Windows Defender:** matikan *Automatic sample submission* selama data ini ada, atau
      tambahkan pengecualian folder — agar berkas (mis. skrip `.sh`) tidak terkirim ke layanan
      awan untuk analisis.
- [ ] Pastikan `mozivid/` tetap di `.gitignore` dan **jangan pernah** `git add -A` / `git add .`
      di repositori ini.

## 9. Penghapusan aman setelah cutover (OA-3, P31-03)

Lakukan hanya setelah: cutover selesai, rekonsiliasi ditandatangani, **arsip terenkripsi**
upstream dibuat dan **satu kali restore berhasil diuji** (P31-01).

- [ ] Hapus `mozivid/` dan semua salinan turunan (folder kerja, unduhan, kontainer Docker sisa —
      hapus menurut nama, bukan *prune* massal).
- [ ] Pada SSD, menimpa berkas tidak menjamin data hilang. Karena itu langkah § 8-A (BitLocker
      seluruh drive) adalah perlindungan utamanya; sesudah menghapus, jalankan
      `cipher /w:<huruf_drive>:\` untuk menimpa ruang kosong (efektif penuh pada HDD).
- [ ] Jika memakai VeraCrypt/7-Zip: hapus container/arsip yang tidak lagi diperlukan, lalu
      **musnahkan kata sandi/kuncinya** di pengelola kata sandi (tanpa kunci, salinan sisa tidak
      terbaca).
- [ ] Hapus dari Recycle Bin, OneDrive (termasuk Recycle Bin web), dan cadangan lain.
- [ ] Catat tanggal penghapusan, lokasi yang dibersihkan, dan siapa yang melakukannya
      (catatan dekomisi P31-03) — tanpa nilai data.

## 10. Konfirmasi ke proyek

Kirim konfirmasi singkat (ya/tidak + tanggal) untuk: § 1 cadangan · § 2 production · § 3 hasil
pemeriksaan insiden · § 4 `info.php`/APK/`.sh` dihapus dan eksekusi diblokir · § 5 registrasi
ditutup dan rute dibatasi · § 6 kata sandi DB dirotasi · § 7 `JWT_SECRET` dirotasi (CSRF:
aktif/ditunda) · § 8 salinan lokal terenkripsi dan keluar dari sinkronisasi. Dengan konfirmasi
itu P17-01 menjadi DONE dan *dry run* data nyata (P24-05) boleh dijadwalkan dari sisi ini.
