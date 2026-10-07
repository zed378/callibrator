# 09 — Upstream Report and Export Layouts (structure only) and Their Target Renderers (P23-01)

> **Ringkasan (Bahasa Indonesia).** Referensi **struktur saja** (bagian, kolom, urutan, ukuran
> kertas, blok tanda tangan — tanpa data nyata) dari semua dokumen yang dihasilkan upstream:
> **laporan IPM** (PDF A4 lanskap), **daftar inventaris PDF** versi penyedia (A3 lanskap, dengan
> foto) dan versi faskes (A4 lanskap), **XLSX inventaris** (14 kolom), **lima rekap kalibrasi
> XLSX** (11 kolom), dan halaman publik QR. Kop penyedia disebut generik sebagai "kop surat
> penyedia". Target di Callibrator: **semua dirender di frontend** (aturan pemilik 2026-10-07) —
> PDF dengan jsPDF seperti sertifikat (ADR-095), XLSX dibuat di browser — dari data API yang dibaca
> per halaman; **tidak ada** pembuatan PDF/XLSX di backend dan **tidak ada** berkas ekspor yang
> disimpan. Cacat tata letak upstream yang tidak boleh ditiru dicatat (mis. "Tanggal Kalibrasi" di
> laporan IPM sebenarnya mencetak tanggal IPM; nilai "Hasil Pemeriksaan" tidak pernah tercetak).

**Status: DONE 2026-10-07.** Read from the upstream views and controllers (code only; no data, no
rendering of real records): `app/Views/ipm/pdf_ipm.php`, `ipm/pdf_admin.php`, `ipm/pdf.php`,
`app/Controllers/InventoryController.php` (`getDataIPM`, `htmlToPDF`, `downloadSertifikatIPM`,
`inventory_download_admin`, `inventory_download`, `inventory_download_admin_xls`,
`kalibrasi_download_rentang_*`), `IpmController.php` (`kalibrasi_download_*`),
`FaskesController.php` (`readQr`, `getIPM`). Labels are quoted because they are the layout; no
person, facility, provider name, address or value appears. The provider's hard-coded name, address
and logo are called **"the provider's letterhead"**.

**Target rule (owner, 2026-10-07):** certificates and data exports are rendered **in the
frontend**; no certificate or export file is stored. Our certificate is already built this way:
the backend serves a data document (`GET /certificates/:certificateId/document`, every printed
field, `verifyUrl`, integrity hashes) and `frontend/src/lib/certificatePdf.ts` renders it with
jsPDF (A4 portrait, QR, integrity hash, status watermark, signature blocks) —
`docs/BACKEND/07-CERTIFICATE-PIPELINE.md` § PDF Rendering, ADR-095. Every target below follows the
same pattern. **The backend renders no PDF and writes no XLSX.**

> **Drift found.** `02-FEATURES.md` F-58 says the IPM report would render "HTML → PDF with
> puppeteer (`certificatePdf.service.ts`)", and F-65/F-66 propose backend batch jobs that produce
> PDF/XLSX files. Both contradict the code (ADR-095: the backend renders no PDF; puppeteer left
> the backend) and the owner rule. This document is the corrected target; 02 is annotated to
> point here (record).

---

## 1. Documents Inventory

| # | Upstream document | Engine, paper | Route (filter) | Target in Callibrator | Card |
|---|---|---|---|---|---|
| D1 | **IPM report** (HTML preview + PDF download) | Dompdf, **A4 landscape** | `ipm/htmlToPDF` (login), `ipm/downloadSertifikatIPM` (**public**), `ipm/getIPM/<qr>/<date>` (**public**) | **issued IPM report on the certificate pipeline** (`type: maintenance`), frontend jsPDF renderer, QR to `/verify` with token | P19-06, P23-02 |
| D2 | **Inventory list PDF — provider** | Dompdf, **A3 landscape**, photo thumbnails optional | `inventory_download_admin` (login) | frontend jsPDF, paged API reads, thumbnails from derivatives | P23-03 |
| D3 | Inventory list PDF — facility | Dompdf, A4 landscape | `inventory_download` (login) | same renderer, facility variant | P23-03 |
| D4 | **Inventory XLSX** (two near-identical implementations) | Spout | `inventory_download_admin_xls` (login), `kalibrasi_download_admin_xls` (admin, user) | frontend XLSX writer | P23-04 |
| D5 | **Calibration recaps XLSX** ×4 (+ D4's calibration variant) | Spout | `kalibrasi_download_harian_xls`, `…_by_tgl_kalibrasi_xls`, `…_rentang_input_xls`, `…_rentang_kalibrasi_xls` | frontend XLSX writer, one parametrised recap | P23-04 |
| D6 | Public device page (HTML, not a PDF) | inline HTML | `readQr/<qr>` (**public**) | capability-token page (UD-15) — layout reference only | P19-07 |

## 2. D1 — IPM Report (`ipm/pdf_ipm.php`)

**Page:** A4 landscape; margins left 30 px, right 15 px, top 10 px, bottom 5 px; small type
throughout; section title bars filled with one accent colour; bordered tables. One page in the
common case; the notes + signature block is kept together (`page-break-inside: avoid`), and so is
the completeness section. **No page number, no footer, no document number, no generation time,
no QR, no signature image, no integrity mark.** File name: `Sertifikat_IPM_<QR>_<IPM date>.pdf`.
An HTML "Print Preview" button shows only in the browser preview.

### 2.1 Header block (bordered table)

| Row | Col 1 | Col 2 | Col 3 | Col 4 |
|---|---|---|---|---|
| title | "IPM" with subtitle "Insfection [sic] Preventive Maintenance" | the **device name in upper case** | the provider's letterhead logo (spans 2) | |
| 1 | "Rumah Sakit" | facility name | "Tanggal IPM" | IPM date `d-M-Y` (from the URL) |
| 2 | "Ruang" | room | "No. Inventory" | QR number |
| 3 | "Merk" | brand | "S/N" | serial |
| 4 | "Model/Type" | model | "Tanggal Kalibrasi" | **prints the IPM date again** (defect, § 2.4) |

Below: "Visit ke : NNN" (zero-padded to 3 digits, from the session's environment rows).

### 2.2 Sections in print order (two-column grid unless noted)

| # | Left column | Right column | Item rendering |
|---|---|---|---|
| 1 | **Kondisi Lingkungan** (environment) | **Kondisi Kelistrikan** (electrical supply) | `label : value symbol` / `label : value` or "N/A" when NULL |
| 2 | **Alat Kerja yang Digunakan** (test tools) — items split into two sub-columns (first half left, second half right) | **Pemeriksaan Keamanan Lain** (other safety): "Baik" / "Tidak" / "N/A"; then a nested bar **Pemeriksaan Fisik** (physical): "Baik" / "Cacat/Rusak Ringan (C/RR)" / "Rusak Berat (RB)" + " \| " + "Bersih" / "Kotor" | tools as disabled checkboxes (checked unless status 0) |
| 3 | **Pemeriksaan Keamanan Listrik** (electrical safety) | **Pemeriksaan Fungsi Alat** (function) | safety: `value symbol`, "N/A" when −1; function: "Baik" / "Tidak" / "N/A" |
| 4 | **Pemeriksaan Kelengkapan Alat** (completeness) — full width, items in two sub-columns | | "Baik" / "Tidak" / "N/A" |
| 5 | **Pemeriksaan Kinerja Alat** (performance) — full-width table, columns: item · "Setting" · "Terukur 1" · "Terukur 2" · "Nilai Acuan" · "Kondisi" ("Baik"/"Tidak Baik") | | |
| 6 | bar **"Hasil Pemeriksaan :"** — **the value is never printed** (defect) | | |
| 7 | **Pemeliharaan Alat** (maintenance tasks, 65 %, two sub-columns): "Dilakukan" / "Tidak" | **Stok Konsumabel** (35 %): "Iya" / "Tidak" / "Habis" | |
| 8 | bar **"Hasil Maintenance :"** → "Alat Berfungsi Dengan Baik" / "Alat Tidak Berfungsi Dengan Baik" / "N/A" | | |
| 9 | bar **"Rekomendasi Hasil Pekerjaan :"** → code 1 "Alat Dapat Digunakan", 0 "Alat Perlu Dikalibrasi", −1 "Alat Tidak Dapat Digunakan", −2 "Alat Harus Diperbaiki", NULL "N/A" | | |
| 10 | **Catatan** (notes) — free text, "-" when absent | | |
| 11 | **Signature block** (kept with the notes): two centred columns **"Teknisi Pelaksana"** (a line, then the technician's full name) and **"IPSRS"** (a blank line for a wet signature) | | |

The battery section's rows are passed to the view but **never rendered** (00 D-06).

### 2.3 Data sources (for the target's document endpoint)

Device and facility from the device row; every section from its `trx_*` table for `(QR, date)`;
technician name from the user of the first environment row; visit from the environment rows.

### 2.4 Upstream defects — do NOT reproduce

| # | Defect | Target |
|---|---|---|
| L-1 | "Tanggal Kalibrasi" prints the **IPM date** | print the device's last calibration record date (UD-8) or omit the row |
| L-2 | "Hasil Pemeriksaan" has a label and **no value** | print the session's overall inspection outcome |
| L-3 | Physical check prints "Bersih"/"Kotor" from the **condition** code, not from the cleanliness column | print cleanliness from its own field |
| L-4 | Battery section collected but not printed | print it when present (2024 sessions) |
| L-5 | "Visit ke" is a 0/1 flag + 1 (00 D-08) | visit number computed at submit (P19-02) |
| L-6 | Subtitle typo "Insfection" | "Inspection and Preventive Maintenance" / "Inspeksi dan Pemeliharaan Preventif" |
| L-7 | Re-rendered from current rows every time; no number, no integrity | issued once at submit, numbered, data-hashed, QR-verifiable (below) |
| L-8 | Public by guessable QR + date (S-06); unescaped values (S-07) | gated route + capability token for the public verify page; jsPDF writes text, no HTML |

### 2.5 Target (P19-06, P23-02)

| Aspect | Target |
|---|---|
| Record | a certificate row `type: maintenance` issued when the IPM session is submitted (UD-6, P12-04) |
| Data | `GET /certificates/:id/document` extended (or a sibling document endpoint) with the IPM sections — every printed field, `verifyUrl`, integrity hash over the data (v3 snapshot pattern, ADR-107: the issuer, device and people as at issue) |
| Renderer | frontend jsPDF module beside `certificatePdf.ts`, **A4 landscape** to keep the upstream's one-page density; Noto Sans (Unicode, as the certificate); the same status watermark for anything not issued |
| Letterhead | the **issuer** block = the calibration company's tenant identity snapshot (name, address, logo) — the provider's letterhead becomes data, not a hard-coded image ⚖ design: confirm in P19-06 |
| Added beyond parity | report number; QR to `/verify/<number>?t=<token>`; integrity hash; page "x / y" and generation time in a footer; electronic signature of the technician at submit and the IPSRS countersignature (UD-17) in place of the wet-signature line (a wet-signature line stays printable for facilities that do not enable countersigning) |
| Golden test | synthetic session → the document JSON → jsPDF text extraction: section order, labels, code → label maps (§ 2.2), L-1…L-4 fixed |

## 3. D2 / D3 — Inventory List PDFs

### 3.1 D2 — provider variant (`ipm/pdf_admin.php`, A3 landscape)

- **Header:** a single title line "Daftar Alat pada Rumah Sakit / Klinik" and a rule. No logo, no
  facility header, no date, no page numbers.
- **Table** (bordered, grey header row), 14 columns in order: "No" · "Nama Rumah Sakti" [sic] ·
  "Nama Alat" · "Merk" · "Type" · "Qrcode" · "Serial Number" · "Ruangan" · "Lantai" · "Kondisi" ·
  "Teknisi Pelaksana" · "Tanggal Pengerjaan" (inventory date, `d-M-Y`) · "Foto Alat" · "Foto SN".
- **Photos:** 40 × 40 thumbnails generated server-side (80 px wide, JPEG q35, cached as data URIs);
  with `tanpa_foto=1` the two photo cells print "-".
- **Signature block** after the table: two columns "Pelaksana Teknis" and "Pihak Rumah Sakit" +
  the facility name (taken from the **last row**), each with blank lines for a wet signature.
- **Filter and order:** one facility (`id_client` from the query string — S-05), optional text
  search over the device fields and the inventory date; ordered by QR ascending.
- **Scale:** raises PHP memory to 512 MB and time to 180 s, and **still runs out of memory for a
  large facility** (observed on the throwaway copy).

### 3.2 D3 — facility variant (`ipm/pdf.php`, A4 landscape)

- **Header:** the facility name (large), then its address and "Phone:", then a rule.
- **Table**, 9 columns: "No" · "Nama Alat" · "Merk" · "Type" · "Qrcode" · "Serial Number" ·
  "Ruangan" · "Lantai" · "Kondisi". No photos, no technician, no signature block.
- **Order:** serial number **descending**; optional text search.

### 3.3 Target (P23-03)

- **Renderer:** frontend jsPDF; one facility per document (facility scope, 06 R-04); variants
  "provider" (with technician, inventory date, optional photos, two signature blocks) and
  "facility" (device columns only), both A3/A4 landscape as upstream.
- **Data:** the device list API read **page by page** (rows in `data`, paging in top-level `meta`,
  CLAUDE.md envelope) — never one unbounded request.
- **Photos:** the 320 px **thumbnail derivative** (08 § 4.1), fetched through signed URLs with a
  small concurrency limit, down-scaled to the cell; originals are never fetched for a report. ⚖
  CSP: a presigned S3 URL is another origin — fetch through the app's `/storage/object` path or
  allow the store origin in `img-src`/`connect-src` (ADR-071 nonce CSP) — decided in P23-03.
- **Fixes:** a generation date and page numbers in a footer; the "Pihak Rumah Sakit" block names
  the document's facility (not "the last row"); header typo fixed; "Kondisi" printed from our
  condition vocabulary.

## 4. D4 / D5 — XLSX Exports

Common style upstream: one sheet, header row bold on light grey, thin borders on every cell, dates
written as **text** (`Y-m-d`), no column widths, no freeze pane, no autofilter.

### 4.1 D4 — Inventory XLSX (`inventory.xlsx`)

| Variant | Columns (14) | Rows | Order | Notes |
|---|---|---|---|---|
| `inventory_download_admin_xls` | "No", "Nama Rumah Sakit", "Nama Alat", "Merk", "Type", "QrCode", "Serial Number", "Ruangan", "Lantai", "Kondisi", "Teknisi Pelaksana", "Tanggal Kalibrasi", "Foto Alat", "Foto SN" | one facility's devices, optional search | latest calibration date desc | "Tanggal Kalibrasi" **falls back to the inventory date** when there is no calibration (unmarked); "Teknisi Pelaksana" = the calibration entrant, else the device registrant; photo columns hold **permanent public URLs** |
| `kalibrasi_download_admin_xls` | same 14 | one facility, **or every facility when none is given** | latest calibration date desc | no fallback; technician = calibration entrant only |

### 4.2 D5 — Calibration recaps (11 columns)

Columns: "No", "Nama Rumah Sakit", "Nama Alat", "Merk", "Type", "QrCode", "Serial Number",
"Ruangan", "Lantai", "Tanggal Kalibrasi", "Diinput Oleh".

| Recap | Filter | Order | File name pattern |
|---|---|---|---|
| daily (*harian*) | input date = day | input order, newest first | `rekap_kalibrasi_harian_<date>.xlsx` |
| by calibration date | calibration date = day | input order, newest first | `rekap_tgl_kalibrasi_<date>.xlsx` |
| input range | input date in [from, to] | input order, newest first | `rekap_rentang_input_<from>_sd_<to>.xlsx` |
| calibration range | calibration date in [from, to] | calibration date asc | `rekap_rentang_kalibrasi_<from>_sd_<to>.xlsx` |

All take an optional facility; without it they cover **every facility**. Two copies of the range
recaps exist (00 D-11): the routed one joins calibrations INNER, the dead one LEFT. "Ruangan" is
the device's current room, not the room confirmed at calibration.

### 4.3 Target (P23-04)

- **One parametrised recap** (`dateField = input | calibration`, `from`, `to`, `latestOnly`) over
  the calibration-records API, read page by page; the frontend writes the XLSX in the browser.
  The existing backend CSV (`reporting.service.ts`) stays as is; **no backend XLSX**.
- **Dependency (P23-04):** the frontend has no XLSX writer today; choose a maintained,
  streaming-capable, browser-side library under the owner's package rule (bundle budget: `/` is
  at 148.7 of 150 KB gzip — load it with a dynamic import on the export page only).
- **Columns kept for parity**, with fixes: dates as real date cells; "Tanggal Kalibrasi" never
  silently replaced by the inventory date (a separate "Tanggal Inventaris" column instead);
  "Teknisi Pelaksana" / "Diinput Oleh" from the performer snapshot (07 § 3); **photo columns hold
  no permanent URL** — either omitted (default) or short-lived signed links with the expiry stated
  in a header note; a frozen header row and an autofilter.
- **Cross-facility exports** for company staff: one request runs in one tenant, and the facility
  scope applies; a company-wide recap is assembled client-side from per-facility pages, with the
  facility as a column — never by bypassing the scope.

## 5. Large Exports (the upstream ran out of memory)

Upstream builds whole documents in one PHP request (D2 exhausts 512 MB). Target, for every D2–D5:

1. **Paged reads**: the frontend reads the API in pages (cursor or `page`/`limit`, `meta.total`
   first so the UI can show the size), with a bounded page size and the stable id-ending order
   introduced for CI (`88e198c`: every paginated query ends its order in `id`).
2. **Client-side generation** in a **Web Worker** where the library allows, so the page stays
   responsive; images decoded at thumbnail size only.
3. **Progress UI**: "rows read n / total", "photos n / m", "building file", with **Cancel**; the
   download is offered when done; nothing is uploaded back or stored.
4. **Guard rails**: above a row threshold (set in P23-03 by measurement on a synthetic
   facility of the largest real size — 23,722 devices / 118 facilities, the largest facility's
   count to be read as an aggregate in the dry run) the PDF defaults to "without photos" and offers
   splitting by room or floor; XLSX has no practical limit at this volume.
5. **Rate limits** on the list endpoints still apply; the export paces itself rather than
   bypassing them.

## 6. D6 — Public Device Page (`FaskesController::readQr`, layout reference)

Mobile card, max width ~460 px: a header band with **the provider's letterhead name**, the device
name and "QR: <number>"; a two-column key/value table "Nama Instansi" (facility), "Merk", "Type",
"Ruangan", "Serial Number"; two photos ("Foto Alat", "Foto Serial Number"); a section "Dokumen
Kalibrasi" with one button per certificate PDF ("Kalibrasi n", a direct public file link); a
section "Riwayat IPM" with one button per IPM date ("IPM n", the public report). Values are echoed
unescaped (S-07). **Target (UD-15, P19-07):** capability-token URL; default shows identity
(device type, brand, model), calibration status and last IPM date only; no room, serial, photos,
documents or person unless the tenant enables them; no certificate files exist to link (07 § 4.1).

## 7. Field Mapping Summary (upstream label → our field, for the document endpoints)

| Upstream label | Our field (proposed, 04) |
|---|---|
| Rumah Sakit / Nama Rumah Sakit / Nama Instansi / Pihak Rumah Sakit | the facility client entity's name (tenant = the calibration company) |
| Ruang / Ruangan, Lantai | device location (warehouse/room, floor — UD-10) |
| No. Inventory / Qrcode | `calibration_devices.qr_code` |
| Nama Alat, Merk, Model/Type, S/N | device name snapshot, brand, model, `serial_number` |
| Kondisi | device condition (P19-03 vocabulary) |
| Tanggal IPM, Visit ke | `inspection_sessions.performed_at`, `visit_number` |
| Tanggal Kalibrasi | latest `calibration_records` date (UD-8) |
| Tanggal Pengerjaan | `inventoried_on` |
| Teknisi Pelaksana / Diinput Oleh | `performer_snapshot.name` (07 § 3) |
| sections 1–9 | `inspection_results` by section and item, outcome code → label maps of § 2.2 |
| IPSRS | countersignature (`FACILITY MAINTENANCE`, UD-17) |
| the provider's letterhead | the issuer snapshot of the calibration company's tenant |
