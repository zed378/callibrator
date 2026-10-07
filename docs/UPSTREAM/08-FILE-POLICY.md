# 08 — File Policy for the Upstream Files (P17-05)

> **Ringkasan (Bahasa Indonesia).** Kebijakan pemindahan berkas upstream. **Yang masuk storage
> aplikasi hanya foto alat** (foto depan dan foto pelat nomor seri: ±47 ribu berkas yang dirujuk
> dan ada, ±91 GB). **PDF sertifikat kalibrasi (±11,9 ribu, 19 GB) tidak disimpan di aplikasi** —
> aturan pemilik 2026-10-07: sertifikat dan ekspor dirender di frontend, tidak ada berkas
> sertifikat di storage — PDF hanya masuk **arsip luring terenkripsi**. Setiap foto: jenis diperiksa
> dari *magic bytes* (JPEG, PNG, HEIC/HEIF saja), batas ukuran dan piksel, pindai ClamAV **sebelum**
> objek dapat dijangkau, SHA-256, kunci `t/<tenant>/f/<faskes>/attachments/<uuid>.<ext>`, turunan
> tampilan dan *thumbnail* tanpa metadata (EXIF/GPS dibuang; HEIC → JPEG), berkas asli tetap utuh
> dan hanya bisa diunduh lewat URL bertanda tangan. Tanpa deduplikasi. Skrip shell dan berkas teks
> di folder sertifikat publik: dikarantina, dilaporkan, **tidak pernah** dipindah. Verifikasi:
> jumlah dan hash per faskes.

**Status: DONE 2026-10-07 — pending the legal review of 06 for the items marked ⚖; the aggregate
EXIF survey is deferred to the dry run (§ 4.3).** Volumes from 03 § 6 and 05 § 6.1 (measured by
listing only — no file was opened by this work). Tenancy: the owner's correction of 2026-10-07
(tenant = calibration company; facility = client entity inside it). Owner rule of 2026-10-07:
**no certificate file of any kind in storage; certificates and data exports are rendered in the
frontend.** Replaces the pipeline sketch of 05 § 6.2 where they differ. Decision basis:
[`06-DPIA.md`](./06-DPIA.md), [`07-DATA-MINIMISATION.md`](./07-DATA-MINIMISATION.md).

---

## 1. Scope and Volumes

| Class | On disk | Referenced and present (≈ moved) | Destination |
|---|---:|---:|---|
| Front photos `uploads/foto_depan` | 25,092 / 49.7 GB | ≈ 23,540 | **application storage** |
| Serial-plate photos `uploads/foto_sn` | 25,006 / 47.2 GB | ≈ 23,540 | **application storage** |
| Certificate PDFs `uploads/inventory` | 11,923 / 19.2 GB | ≈ 11,570 | **encrypted offline archive only** (§ 6) |
| Profile images, other | small | — | not migrated (07 § 2.1) |
| **Into application storage** | | **≈ 47,080 files ≈ 91 GB** (estimate, pro rata) + derivatives ≈ +15 % | |

Photo types on disk (from extensions, 03 § 6): JPEG ≈ 49,000, HEIC 897, PNG 160, SVG 4, AVIF 1.
Sizes: median 1.9 MB, p95 3.4 MB, max 8.1 MB; 816 files under 50 KB.

## 2. Order (unchanged from our attachment path — the import must not bypass it)

Our upload path already enforces: link check → **magic-byte check** → **ClamAV** → **checksum** →
put at `t/<tenant>/…` with `storage_key` recorded with the row; **nothing is reachable before the
scan passes**, and a refused upload leaves no object (`docs/STORAGE/04-TENANT-STORAGE.md` § What
Is Wired; `docs/SECURITY/06-FILE-UPLOAD-SECURITY.md`). The ETL runs the same steps, per file:

```
source file (read-only)                                     manifest: source path, size, SHA-256 (§ 9)
  → 1 type by magic bytes (§ 3)          ── refused → quarantine file_type_refused
  → 2 size and pixel limits (§ 3)        ── refused → quarantine file_too_large / image_too_large
  → 3 ClamAV, fail-closed (§ 5)          ── infected/error → quarantine virus_found / scan_failed
  → 4 SHA-256 = manifest hash?           ── mismatch → quarantine transfer_corrupt
  → 5 put original  t/<tenant>/f/<faskes>/attachments/<uuid>.<ext>      (§ 7)
  → 6 read back, SHA-256 again (as `migrate:storage` verifies)          ── mismatch → delete object, quarantine
  → 7 derivatives (display, thumbnail), metadata stripped (§ 4)
  → 8 INSERT attachments row (+ audit row) in the batch transaction
       failure after 5 → objects deleted, row quarantined (05 § 6.2 step 5)
```

## 3. Allow-list and Limits

| Detected type (magic bytes, not extension) | Signature | Accepted | Note |
|---|---|---|---|
| JPEG | `FF D8 FF` at 0 | yes | in `utils/fileValidation.util.ts` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` at 0 | yes | in `fileValidation.util.ts` |
| HEIC / HEIF | ISO-BMFF `ftyp` box at offset 4 with a major or compatible brand in `heic heix hevc hevx heim heis mif1 msf1` | yes — **original kept, JPEG derivative generated** | **not in `fileValidation.util.ts` today**: P21-02 adds it (with a test that an AVIF/MP4 `ftyp` is refused) |
| SVG, AVIF, GIF, WebP, anything else (incl. the `.sh` and `.txt`) | — | **no** → quarantine | SVG is script-capable; AVIF is outside the allow-list (1 file — the operator may convert it by hand) |
| PDF | `%PDF-` | **not into application storage** | archive path only (§ 6) |

- **The extension never decides**; the stored extension is derived from the detected type
  (`.jpg`, `.png`, `.heic`), and the declared MIME type is recorded but not trusted (06 SECURITY).
- **Size limit: 10 MB per file** — the same as our ingest limit, so the import accepts nothing the
  application would refuse. Measured max is 8.1 MB, so no real file is expected to hit it; a hit is
  an anomaly to review.
- **Lower bound:** files under 1 KB are quarantined `file_truncated` (a photo cannot be that small;
  816 files under 50 KB exist and are accepted, but listed in the report as "very small").
- **Decoder limits for derivatives:** at most **50 megapixels** and **12,000 px** per side,
  decoder memory capped; beyond that → quarantine `image_too_large` (decompression-bomb guard).
- **Polyglots:** a file must parse as its detected type (the derivative step fully decodes it); a
  JPEG that does not decode is quarantined `image_undecodable` even if its signature matched.

## 4. Metadata (EXIF/GPS) and Derivatives

### 4.1 Derivatives (what pages show)

| Derivative | Spec | Key |
|---|---|---|
| display | longest side 1,600 px, JPEG q≈80 (or WebP), **all metadata stripped** (EXIF, GPS, XMP, IPTC, ICC kept only as an sRGB conversion), orientation applied then removed | `…/attachments/<uuid>.display.jpg` |
| thumbnail | 320 px, same stripping | `…/attachments/<uuid>.thumb.jpg` |

HEIC originals always get both (browsers do not render HEIC). Requirement for P21-02: deleting or
erasing an attachment deletes its derivatives too, and the storage `usage()` counts them.
**Dependency:** the backend has no image library today (no `sharp`, no HEIC decoder); P21-02
adds one under the owner's package rule (proved by tests and an image boot).

### 4.2 Originals ⚖

**Default: originals are stored byte-exact** (their SHA-256 equals the source hash — the evidence
that the photo is the one taken in the field), are **never** rendered by pages, and are reachable
only through a signed download to a user of the tenant **whose facility scope includes the
device's facility** (§ 8). Alternative, if the survey (§ 4.3) shows GPS in originals and counsel
prefers minimisation over byte-exact evidence: strip **GPS only** losslessly before the put,
record both hashes (source in the manifest, stored in `attachments.checksum`) — at the cost that
the provenance link to the source hash disappears when `upstream_import` is dropped.

### 4.3 Aggregate EXIF survey (deferred to the dry run, P24-05)

Run inside the throwaway ETL environment on the real files, **output counts only**: images with
any EXIF, with GPS tags, with `Make`/`Model`, with `DateTimeOriginal`, with an embedded
thumbnail (face detection is **not** attempted). No value is printed, logged or kept. The result decides
§ 4.2 and is recorded in the dry-run record. Not run in this card because the brief forbids
opening the files outside that environment.

## 5. Scanning

- **ClamAV, fail-closed** (`VIRUS_SCAN_FAIL_OPEN=false`, the reference deployment's setting): a
  scanner error quarantines the file (`scan_failed`) and the run continues; nothing is put before
  a clean verdict.
- Signatures updated at the start of the run; the signature version is written into the run's
  record.
- Throughput is measured in the dry run (05 § 6.3 assumes 20–40 MB/s per worker).
- **Certificate PDFs on their way to the archive** are scanned too, and additionally checked for
  **active content** by a structural keyword count (`/JavaScript`, `/JS`, `/OpenAction`, `/AA`,
  `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`, `/SubmitForm`): counts per file go to the
  archive index; a flagged PDF is archived unchanged (evidence) and marked "open only in a
  sandboxed viewer". **Sanitising (rewriting) PDFs is refused**: it changes the bytes of a legal
  record. Since PDFs never enter the application (owner rule), no PDF is ever served by our origin.

## 6. Certificate PDFs — Archive Only

Under the owner's rule the ~11.9 k certificate PDFs (and the ~350 unreferenced ones) are **not**
put into application storage. They are:

1. type-checked (`%PDF-`), scanned (§ 5), hashed (SHA-256);
2. written to the **encrypted offline archive** of P31-01 together with an index
   `(archive id, device legacy id, file sequence, size, SHA-256, active-content counts)` — the
   index holds no file name and no person;
3. represented in Callibrator only by **a count per device and an opaque archive reference**
   (07 § 2.3); retrieval is a provider action on a facility's request, logged in the provider's
   tenant.

The information that exists only inside these PDFs is finding **F-CERT** (07 § 4.1), with the
options and the recommendation (archive-only).

## 7. Storage Keys and Isolation

| Object | Key |
|---|---|
| original photo | `t/<tenant uuid>/f/<faskes uuid>/attachments/<attachment uuid>.<ext>` |
| derivatives | `t/<tenant uuid>/f/<faskes uuid>/attachments/<attachment uuid>.{display,thumb}.jpg` |

- UUIDs are generated by the ETL; **no legacy id, QR, serial, facility name or original file name
  appears in a key** (a key is visible in signed URLs and logs).
- **Change to the storage module this requires (Phases 20/21, under the tenancy ADR):** today
  `keys.js` builds `t/<tenantId>/<domain>/<name>` with a domain allow-list; a facility segment
  `f/<faskes>` must be added in **`buildKey()` only**, validated (UUID shape) like the tenant
  segment. `assertKeyForTenant` keeps guarding the tenant prefix unchanged.
- **The key prefix is not the facility control.** Like `STORAGE_S3_PREFIX`, a path segment is
  not an authorisation boundary: before minting a signed URL or streaming an object, the service
  checks that the **attachment row's facility** is within the caller's facility scope (the same
  check as the row read; a facility user of A asking for B's object gets **404**). Covered by the
  two-faskes tests (06 R-04).
- **Not shared:** each attachment row has its own object, even for the 3,293 byte-identical
  copies (05 § 6.2: deleting one row deletes its object).

## 8. Encryption at Rest and Access

| Store | Requirement | Today |
|---|---|---|
| Application storage (reference VM: `STORAGE_DRIVER=local`) | the volume holding `storage/` on an **encrypted filesystem** (LUKS/dm-crypt) — **precondition of the first real-data dry run** | not recorded in the repository → owner confirms or provisions (06 § 2.4) |
| S3 (if used) | server-side encryption on the bucket, Indonesian region or the self-hosted store (UD-18); bucket not public | — |
| PostgreSQL data and `db-backup` dumps | encrypted volume (dumps are `0600` to the backup user already) | volume encryption not recorded |
| ETL staging, scratch, quarantine | encrypted throwaway volume; removed by name after the run | — |
| Offline archive (PDFs, dump) | AES-256 container (VeraCrypt/7-Zip AES, 10 § 8), key held by the owner, separate from the archive | — |

**Access:** pages show derivatives; originals download only through the existing signed,
time-limited URLs (HMAC for `local`/`nfs`, presigned for `s3`; `docs/STORAGE/04` § Signed
Downloads) after the facility-scope check of § 7. No photo is on the public capability page by
default (UD-15). Exports never embed permanent photo URLs (09 § 4).

## 9. Verification

| Check | How | Pass |
|---|---|---|
| Source manifest | one SHA-256 per referenced file, computed once on the source side (≈ 8 min for 110 GB at the measured ~250 MB/s); kept in `upstream_import` (holds source paths — dropped with it) | — |
| Transfer integrity | SHA-256 after transfer = manifest; after put, read back = manifest | 100 % |
| Counts per facility | referenced names per folder per facility = attachments + quarantine (`file_missing`, `file_type_refused`, …) — 05 R-8 | zero unexplained |
| Derivatives | one display + one thumbnail per image attachment; none carries EXIF (checked by a metadata reader on the derivatives — they are ours) | 100 % |
| No certificate files | 07 R-15 | none |
| No original names | 07 R-14 | none |
| Isolation | two-faskes tests over the attachment routes; a forged key of another tenant 403 (existing), another facility's attachment 404 | named tests green |

## 10. Special Files

| File | Handling |
|---|---|
| the **shell script** and **text file** in the public certificate folder | **never migrated, never executed, never archived as records.** The ETL detects their type and records `file_type_refused` with the folder only; the owner removes them from the live public folder and checks the access log for requests to them (OA-2, 10 § 4). If the content suggests anything other than the operator's own file-moving script, it is an incident question (06 R-17) |
| 4 SVG | quarantined; not migrated (script-capable) |
| 1 AVIF | quarantined; the operator may convert and re-upload through the app |
| 162 referenced but missing | quarantine `file_missing`; listed per facility in the data-quality report |
| 3,360 unreferenced (photos and PDFs) | not migrated; counted per folder; destroyed with the upstream copy (PDFs among them go to the archive only if the operator asks — they are not linked to any device) |
| files replaced during the dual-run (`inventory_update` unlinks the old photo) | the delta by name at cutover (05 § 6.3) takes the new file; the old object stays attached to its row's history only if the row changed — decided by the ETL's idempotency rule (05 § 8) |
