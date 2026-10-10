# P22-06: exports rendered in the browser — the inventory list (PDF and XLSX) and the calibration recaps (XLSX), size first, paged, with progress and Cancel

**Date:** 2026-10-10 · **Task:** P22-06 (Phase 22; F-65 … F-69). P23-03 and P23-04 are built here too · **Specs:** ADR-126 § 8 (the owner's rule: exports render in the frontend, nothing stored); ADR-133 Am. 3 (the recap reads); `docs/UPSTREAM/09-REPORT-LAYOUTS.md` § 3.3, § 4.3, § 5 · **Base:** `1942c5d` · **Resumed:** the session ended mid-card. The tree was complete and gated, the full jest run included, except for the build, the bundle budget, the audit gate and this record

> Frontend only. No backend file and no API change. No file is stored or uploaded. Synthetic data only.

## Built

| Area | What |
|---|---|
| Page | `dashboard/exports`: a server `page.tsx` (`exports.` namespace and the language toggle) plus the `ExportsClient` island (ID/EN). The gate is `calibration` read, the gate of both list routes. The page is reached from the device register's new **Export** link and from a link on `/dashboard/reports`. It has **no menu entry of its own** (none was seeded; adding one is a backend seed and migration if wanted) |
| Size first | "Check the size" reads **one row** (`limit=1`) and shows the row count, the number of requests the build will take (`ceil(n / 200)`) and an estimated file size. "Build and download" appears only after that. Changing any choice forgets the measured size (a render-time reset, no effect) |
| Paged reads | `lib/export/pagedRead.ts` reads every page in order at 200 rows a page (the lists' maximum). It shows "rows read n / total" after each page and pauses 150 ms between pages, because the rate limits still apply. It stops on an empty page, on the last page, or at a 1,000-page ceiling. **Cancel** (`AbortSignal`) is checked before each page, during the pause and after each page. Each page is the caller's own read, so the facility scope applies to every page and a facility filter can only narrow (ADR-133 Am. 3 § 4) |
| Inventory PDF (F-65, F-67) | `lib/export/inventoryPdf.ts` uses jsPDF on demand. **Provider** layout (D2): A3 landscape, 14 columns, photo thumbnails or "-", and two signature blocks; the facility block names **the document's facility**. **Facility** layout (D3): A4 landscape, 9 columns, with the facility's name as the heading. Both layouts sort by QR ascending, repeat the header row on every page, print our condition words, and carry "generated <date>" and "page n of m" on every page. They use the self-hosted Noto Sans font when it can be fetched, otherwise Helvetica with Latin-1 folding. **One facility per PDF**: provider staff must choose it; a bound reader's facility comes from the server's scope, and its name is read from the rows |
| Photos | Off by default. When asked for, `lib/export/photoThumbs.ts` fetches each photo's **thumbnail derivative** (never the original) through a signed link used as a same-origin path. It runs at most 4 fetches at a time, shows "photos n / m", downscales each to 80 px JPEG on a canvas, and prints a failed photo as "-". **Above 1,000 devices the PDF is built without photos**, and the page says so first. 1,000 is provisional: 09 § 5.4 wants it measured on the dry-run size (P23-03 / P23-05) |
| Inventory XLSX (F-66) | 13 columns. The latest calibration date and the inventory date are **separate date cells**; the inventory date never fills in for a missing calibration date. "Technician" is the latest calibration's performer, else the registrant, or "Redacted". Order: latest calibration descending, none last. One facility or all of them. **No photo column**, so no permanent URL is written |
| Recaps (F-68, F-69) | 12 columns. Either a range by calibration date or by input date over `fromDay` / `toDay` (both checked, in order), or **the latest calibration of every device** (`latestOnly`), with an optional facility filter. Shows the room snapshot, the input day in the browser's zone, and the performer or "Redacted". A calibration-date range is ordered ascending; the other recaps put the newest input first. File names follow the upstream: `rekap_kalibrasi_harian_<d>`, `rekap_tgl_kalibrasi_<d>`, `rekap_rentang_input_<a>_sd_<b>`, `rekap_rentang_kalibrasi_<a>_sd_<b>`, and `daftar_kalibrasi_terakhir_<today>` |
| XLSX writer | `lib/export/xlsx.ts` writes the six OOXML parts itself and zips them with `fflate`. Each sheet has a bold grey header, thin borders, **real date cells** (`yyyy-mm-dd`), column widths, a **frozen header** and an **autofilter**. Text is written as inline strings, so a leading `=` is never evaluated as a formula. Characters that XML forbids are dropped. **Checked by a real reader:** openpyxl, installed in the scratchpad only, opened a generated file with freeze `A3`, filter `A2:C4`, the date read as `datetime(2026, 10, 10)` and `=1+1` read as text |

## The dependency: `fflate` 0.8.3 (direct, frontend)

| | |
|---|---|
| Why | An XLSX file is a zip of XML parts, and the frontend had no XLSX writer (09 § 4.3) |
| Size and licence | MIT. The `esm/browser.js` build is 90.9 KB raw and 22.3 KB gzip as a whole. Only `zipSync` and `strToU8` are imported, so the shipped code is a fraction of that, and it is loaded on `/dashboard/exports` only. The bundle budget is unchanged: 10/10 within, `/` still at 149.7 of 150 KB gzip |
| Already installed | jsPDF 4.2.1 depends on `fflate@^0.8.1`. `npm ls fflate` shows one copy, deduped. The lockfile changed by one line (the frontend's direct entry) |
| Lighter options | None lighter that still writes a zip. The alternatives are heavier and add no feature this page needs: `exceljs` (about 1 MB, a stream polyfill in the browser), SheetJS `xlsx` (the npm build is unmaintained and has advisories; the maintained build is off-npm) and `write-excel-file` (bundles its own zip) |
| Audit | `node scripts/ci/npm-audit-gate.js`: 0 failing, production tree 0 (one allowed dev-only advisory, `braces`, already recorded) |

## Evidence — tests named

New tests:
- `lib/export/xlsx.test.ts` (4), node environment
- `lib/export/pagedRead.test.ts` (6)
- `lib/export/documents.test.ts` (6)
- `lib/export/inventoryPdf.test.ts` (4): real jsPDF in node; A3/A4 MediaBox; headers; the image object; the "-" cell; signature blocks; "Page n of m" on every page across more than 2 pages; the Unicode font embedded when the font fetch is answered from `public/fonts`
- `lib/export/photoThumbs.test.ts` (3)
- `app/(app)/dashboard/exports/__tests__/ExportsClient.test.tsx` (11): access; axe; Indonesian; size before build; the 3 pages read at 200; PDF input and file name; photos on request and the limit; 9 columns; changed choice resets; a real XLSX unzipped from the download; Cancel mid-read; a failed read; empty; bound; recap query, file name and the latest list
- `exports/__tests__/page.test.tsx` (2)

## Gates (2026-10-10, Node 26, Windows)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --coverage` | **347 suites, 3,728 tests passed**; 94.53 / 86.32 / 90.62 / 95.14 (gate 90/81/86/91). The new files are at 98.75 / 95.01 / 99.2 / 98.92 |
| `node ../node_modules/next/dist/bin/next build` | OK (`ƒ /dashboard/exports`) |
| `node scripts/bundle-budget.mjs` | 10/10 within, exit 0 |
| `node scripts/ci/npm-audit-gate.js` | 0 failing |

## Not done / open

- **No Web Worker.** 09 § 5.2 says "where the library allows". jsPDF and the canvas downscale run on the main thread. The reads are paced and the page stays responsive between pages; the build step itself blocks for its duration. A worker would need an OffscreenCanvas path for the photos.
- **The photo threshold (1,000)** is provisional until it is measured on the dry-run's largest facility (09 § 5.4; P23-05). Splitting a PDF by room or floor is not offered.
- **The D3 header has no address or phone**: the facility options read carries neither.
- A company-wide recap across tenants is out of scope (one tenant per request, 09 § 4.3).
- No live browser run, and no side-by-side sign-off against the upstream (P23-05).
