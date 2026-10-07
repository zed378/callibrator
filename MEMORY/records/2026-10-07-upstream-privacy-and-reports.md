# Upstream privacy and report layouts — DPIA, minimisation, file policy, report layouts, owner checklist

> **Card ids renumbered 2026-10-07: see PHASE-12 mapping** — [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) § 7 (`UP-xx-yy` → `P(12+xx)-yy`; the plan file `PHASE-UPSTREAM-PHP-ADOPTION.md` was split into Phases 12 … 31 and deleted). This record keeps the ids it was written with.

**Date:** 2026-10-07 · **Cards:** UP-05-02, UP-05-04, UP-05-05, UP-11-01 → DONE (the first three
pending legal review, UP-05-03); UP-05-01 advice handed over (owner to confirm) · **Base commit:**
`755314d` (working tree; nothing committed) · **Decisions:** none taken by this work beyond the
proposals marked in the documents; two owner instructions received mid-task were applied (below).

## What was done

1. Read the research (`docs/UPSTREAM/00` § 9, `03` § 6 and § 9, `04` § 6–7, `05` § 6 and § 10),
   the plan (UP-05, UP-11, UD-1…UD-18, OA-1…OA-8), our privacy and storage material
   (`docs/SECURITY/06`, `09`, `12`; `docs/STORAGE/04`; `docs/BACKEND/07`; ADR-095, ADR-107,
   ADR-114), and the code that decides the file policy (`backend/src/utils/fileValidation.util.ts`
   magic bytes — no HEIC; `attachment.model.ts`; `ai.service.ts` — explicit ingest only;
   `frontend/src/lib/certificatePdf.ts` — jsPDF A4; `deploy/compose/docker-compose.vm.yml` —
   `STORAGE_DRIVER=local`, ClamAV fail-closed).
2. Read the upstream **code only** for UP-11-01: views `ipm/pdf_ipm.php`, `ipm/pdf_admin.php`,
   `ipm/pdf.php`; controllers `InventoryController` (IPM PDF, inventory PDFs/XLSX, range recaps),
   `IpmController` (calibration XLSX), `FaskesController::readQr`. No dump, upload, log or `.env`
   was opened; no real value, and not the provider's hard-coded name/address, was copied.
3. Wrote `docs/UPSTREAM/06-DPIA.md`, `07-DATA-MINIMISATION.md`, `08-FILE-POLICY.md`,
   `09-REPORT-LAYOUTS.md`, `10-OWNER-CHECKLIST.md` (Indonesian).
4. Updated the plan's card statuses (UP-05-01 note, UP-05-02/04/05 and UP-11-01 DONE, totals
   9 DONE · 5 TODO · 1 WIP · 81 BLOCKED), `TASKS/PROGRESS.md`, `docs/UPSTREAM/README.md`,
   `docs/README.md` (12 files), `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`.
5. Annotated `docs/UPSTREAM/02-FEATURES.md` F-58, F-65, F-66: their notes proposed backend
   puppeteer/batch-job PDF and backend XLSX, which contradict the code (ADR-095: the backend
   renders no PDF) and the owner rule; marked superseded, pointing to 09. (Research document
   brought in line with the as-built code and an owner rule — no new decision, so no ADR.)

## Owner instructions applied during the task (relayed by the coordinator)

- **Tenancy correction (replaces UD-1):** the tenant is the **calibration company**; each faskes is
  a **client entity inside the tenant**; faskes users are restricted by a mandatory facility scope.
  The DPIA's roles were re-derived (faskes = controller; tenant = processor for each faskes and
  controller of its staff; platform = sub-processor), the separating control assessed is the
  **facility scope** (R-04, 16 → requires central deny-by-default scope, "two-faskes" 404 tests
  with a guard, threat model, pen test), storage keys became `t/<tenant>/f/<faskes>/…`, requests
  and breach notices flow faskes ↔ tenant ↔ platform. The tenancy ADR is the other agent's.
- **Certificates and exports rendered in the frontend, no certificate files in storage:** the
  ~11.9 k certificate PDFs (19 GB) go to the encrypted offline archive only; storage receives
  device photos only (~47 k referenced files, ~91 GB of 96.9 GB on disk); finding **F-CERT**
  (07 § 4.1): the external-lab certificates' content exists only in the PDFs — recommended
  archive-only, with an optional later data-entry pass for the latest certificate per device;
  UP-07-05 (future external certificate uploads) must decide under the same rule. Report targets
  are frontend jsPDF / browser XLSX with paged API reads and a progress UI.

## Findings worth carrying

- **R-17:** open registration + one group-less account upstream → a past unauthorised access is
  possible; the owner checks logs before closing holes (10 § 3); a 3 × 24 h notice may follow.
- **Cloudflare Tunnel ends TLS at the edge** → a sub-processor and a likely cross-border transfer
  for every user request (06 § 2.4) ⚖; the VM's physical location and volume encryption are not
  recorded in the repository.
- UU PDP response windows (as short as 3 × 24 h, as read) are shorter than our GDPR-based DSAR
  workflow ⚖; performer snapshots must be covered by DSAR export and erasure (UP-07-02).
- `docs/SECURITY/12-INCIDENT-RESPONSE.md` states GDPR's 72 h to the authority only; UU PDP adds
  subjects within the same window — **follow-up for the docs/SECURITY owner** (not edited here).
- `fileValidation.util.ts` has no HEIC signature; the backend has no image library — both needed
  by UP-09-02. `keys.js` needs a facility segment in `buildKey()` (under the tenancy ADR).
- Upstream report defects not to copy (09 § 2.4): "Tanggal Kalibrasi" prints the IPM date;
  "Hasil Pemeriksaan" value never printed; cleanliness printed from the condition code; battery
  not printed.
- 07 § 3 changes 04 § 6's pseudonym from the legacy id to a per-migration sequence number.
- **Question for the owner (not changed):** the GDPR personal-data export (ADR-114) builds a ZIP
  on the backend and stores it under `t/<tenant>/exports/`; does the "exports are rendered in the
  frontend" rule apply to it?

## Evidence

Documentation only. **Not run:** `make verify` (no code changed), any test, the EXIF survey
(deferred to UP-12-05 by design), any check against the live upstream. No container was started.

## Privacy

No real value (name, e-mail, hash, IP, serial, room, facility or provider name, address, file
name, credential) was written to any file. Counts and code labels only; layout labels quoted from
the views are the field captions, not data.
