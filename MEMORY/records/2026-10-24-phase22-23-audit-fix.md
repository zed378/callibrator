# Phase 22-23 audit (frontend + reports vs spec) — two display defects fixed

**Date:** 2026-10-24 · **Task:** audit Fase 22-23 vs spec, jalankan suite lokal, perbaiki bug · **Spec refs:** [`PHASE-22-UPSTREAM-FRONTEND.md`](TASKS/PHASE-22-UPSTREAM-FRONTEND.md), [`PHASE-23-UPSTREAM-REPORTS.md`](TASKS/PHASE-23-UPSTREAM-REPORTS.md), [`P19-06`](MEMORY/specs/P19-06-ipm-report-document.md), [`P19-08`](MEMORY/specs/P19-08-offline-field-capture.md), [`09-REPORT-LAYOUTS.md`](docs/UPSTREAM/09-REPORT-LAYOUTS.md) · **ADRs:** ADR-126 Am. 2/5, ADR-127 Am. 1/3, ADR-132 Am. 3, ADR-138

## Hook

Every Phase 22-23 page was re-read against its card, every service against the generated client (rows in `data`, paging in top-level `meta`), every renderer against 09 § 2–§ 5 and the golden file. 180 frontend suites in the touched scope pass; backend `typecheck` passes; backend `ipmReport.p2104` / `ipmDue.p2107` / `dashboard.p2107` / `calibrationRecords` suites pass. Two display defects found and fixed (3 files + 2 test files, within budget). No phase status change (both phases stay DONE in code).

## Pages — all present, all on the generated client

| Card | Page | Service | Envelope |
|---|---|---|---|
| P22-01 | `/dashboard/ipm-templates` ([`IpmTemplatesClient.tsx`](frontend/src/app/(app)/dashboard/ipm-templates/IpmTemplatesClient.tsx)) | [`ipmCatalogue.service.ts`](frontend/src/api/services/ipmCatalogue.service.ts) | `data` + top-level `meta` via `usePaged` |
| P22-02 | `/dashboard/devices` ([`DevicesClient.tsx`](frontend/src/app/(app)/dashboard/devices/DevicesClient.tsx)) | [`deviceRegister.service.ts`](frontend/src/api/services/deviceRegister.service.ts) | `Paged<RegisterDevice>` (`rows`, `meta`) |
| P22-03 | `/dashboard/ipm/new`, `/dashboard/ipm/capture/<id>` | [`ipmHistory.service.ts`](frontend/src/api/services/ipmHistory.service.ts) (`create`, `saveResults`, `submit`) | single-row `data` |
| P22-04 | `/dashboard/ipm` ([`IpmClient.tsx`](frontend/src/app/(app)/dashboard/ipm/IpmClient.tsx)) | `ipmHistoryService.list` | `rows` + `meta` |
| P22-05 | `/dashboard/calibration-dates` | [`calibrationDates.service.ts`](frontend/src/api/services/calibrationDates.service.ts) | `Paged` helper |
| P22-06 | `/dashboard/exports` ([`ExportsClient.tsx`](frontend/src/app/(app)/dashboard/exports/ExportsClient.tsx)) | `deviceRegisterService.list` + `calibrationDatesService.listRecords`, paged at 200 via [`pagedRead.ts`](frontend/src/lib/export/pagedRead.ts) | `measure` reads `meta.total` first |
| P22-07 | `/dashboard` ([`DashboardClient.tsx`](frontend/src/app/(app)/dashboard/DashboardClient.tsx)) | dashboard metrics + `usePermissions` | three states (loading/empty/failed) |
| P22-08 | `/d/[token]` | [`publicDevice.service.ts`](frontend/src/api/services/publicDevice.service.ts) | server-rendered, no JS needed |
| P22-09 | `/dashboard/client-facilities` | [`clientFacility.service.ts`](frontend/src/api/services/clientFacility.service.ts) | `data` + `meta` |
| P22-10 | `/field` ([`FieldClient.tsx`](frontend/src/app/(app)/field/FieldClient.tsx)) | engine behind ports, encrypted IndexedDB, `/sw.js` scoped `/field` | 21 suites / 206 tests pass |
| P23-02 | `/dashboard/ipm/sessions/<id>/report` ([`ReportClient.tsx`](frontend/src/app/(app)/dashboard/ipm/sessions/[sessionId]/report/ReportClient.tsx)), `/verify/ipm/[reportNumber]` | [`ipmReport.service.ts`](frontend/src/api/services/ipmReport.service.ts) (`document` with `render=pdf`, `sign`) | fresh audited read on download; hash recomputed in browser |
| P23-03/04 | inventory PDF/XLSX + 5 recaps (same `ExportsClient`) | [`documents.ts`](frontend/src/lib/export/documents.ts) → [`inventoryPdf.ts`](frontend/src/lib/export/inventoryPdf.ts) / [`xlsx.ts`](frontend/src/lib/export/xlsx.ts) | 09 § 3.3/§ 4.3 fixes kept |

## Renderers vs 09 — conform

- **D1 IPM report** ([`ipmReportPdf.ts`](frontend/src/lib/ipmReportPdf.ts)): A4 landscape, § 2.2 section order, L-1 (device's own calibration dates), L-2 (session's inspection outcome), L-3 (condition/cleanliness apart), L-4 (battery when present), footer (number, page x/y, reader, hash), QR first page, watermarks. Golden file [`ipmReport.synthetic.en.txt`](frontend/src/lib/__golden__/ipmReport.synthetic.en.txt) written by hand from P19-06 § 11 — passes.
- **D2/D3 inventory PDF**: provider A3 (14 cols, thumbnails, two signature blocks naming the document's facility) / facility A4 (9 cols); generation date + page numbers; header repeated.
- **D4/D5 XLSX**: 13-col inventory (calibration + inventory dates apart, real date cells, frozen header, autofilter, no photo URLs) + 12-col recap (room snapshot, input day in browser zone, performer/Redacted); upstream file names; recap orders per 09 § 4.2.
- **§ 5 large-export rules**: paged reads, progress + Cancel, photo threshold 1,000, rate-limit pacing — all in `ExportJob` + `pagedRead`.

## Bugs fixed (2)

### B1 — inventory export "Type" printed the model, the register prints the device type (High — wrong column on a compliance document)

- **Found:** [`documents.ts`](frontend/src/lib/export/documents.ts:92) `typeOf` returned `d.model ?? d.deviceType?.name`; the register's [`DeviceTable.tsx`](frontend/src/app/(app)/dashboard/devices/components/DeviceTable.tsx:104) prints `d.deviceType?.name ?? d.category`. Every inventory PDF/XLSX "Type" cell disagreed with the screen for any device with a model but no type, or a type plus a category.
- **Fixed:** `typeOf` now returns `d.deviceType?.name ?? d.category ?? null` — the same value as the register. Comment names the register as the source of truth.
- **Test:** [`documents.test.ts`](frontend/src/lib/export/documents.test.ts) — fixture gains `category: "General"`; asserts the full row's `type: "General"` (was `"M-1"`), a type-beats-category case, and the null case. Fail-before: `type` was `"M-1"`.

### B2 — on-screen IPM report printed raw ISO calibration dates (Medium — the PDF was right, the screen was not)

- **Found:** [`ReportClient.tsx`](frontend/src/app/(app)/dashboard/ipm/sessions/[sessionId]/report/ReportClient.tsx:161-162) rendered `doc.device["lastCalibrationDate"] ?? "—"` verbatim (`2026-03-01`); the PDF renders the same field through `dayText` (`1 Mar 2026`). P19-06 § 11 requires the same printed day.
- **Fixed:** [`ipmReportPdf.ts`](frontend/src/lib/ipmReportPdf.ts:69) `dayText` exported (was module-private); the report passes both dates through it with the page's `tag` (`en-GB`/`id-ID`, same as every other date on the page).
- **Test:** [`ReportClient.test.tsx`](frontend/src/app/(app)/dashboard/ipm/__tests__/ReportClient.test.tsx:115-118) asserts `1 Mar 2026` / `1 Mar 2027` present and `2026-03-01` absent. Fail-before: raw ISO shown (test failed with "Unable to find an element with the text: 1 Mar 2026" before the fix; passes after).

## Guards run

- Frontend touched scope: `src/lib/export`, `src/lib/ipmReportPdf.test.ts`, `src/app/*/dashboard/exports`, `src/app/*/dashboard/ipm` — **23 suites / 180 tests pass**; `src/field` 21/206; devices + calibration-dates + client-facilities + verify/ipm 16/143; services 4/21. `npm run typecheck` exit 0.
- Backend: `ipmReport.p2104` 20/20, `ipmDue.p2107` + `dashboard.p2107` 10/10, `calibrationRecords.service` + `nextDate.p2105` 41/41, `typecheck` exit 0.
- Not run here (needs owner/live stack): live browser suites (`automate/p22.browser.mts`, `p10.browser.mts`, a11y), real-phone offline run (P22-10 § 16.5), side-by-side parity sign-off (P23-05 BLOCKED), dry-run photo-threshold measurement (provisional 1,000). Backend `npx jest` without `npm run test:unit` fails on the `uuid` ESM shim (environment, pre-existing); `packages/contracts` jest fails on a missing `@babel/plugin-transform-modules-commonjs` (environment, pre-existing) — both out of scope.

## Phase files — no status change

- [`PHASE-22-UPSTREAM-FRONTEND.md`](TASKS/PHASE-22-UPSTREAM-FRONTEND.md): 10 DONE in code — stays (live browser / real phone runs remain OPEN per card).
- [`PHASE-23-UPSTREAM-REPORTS.md`](TASKS/PHASE-23-UPSTREAM-REPORTS.md): 1 DONE + 3 DONE in code, P23-05 BLOCKED — stays (parity sign-off needs the dry run).

## Still needing an owner (not this audit's fix)

1. P23-05 side-by-side sign-off (BLOCKED on P24-05 dry-run data).
2. P22-10 real-phone offline run (§ 16.5) + P22-03 real-device scan + P22-08 live browser run (LINE C).
3. Photo threshold re-measurement on the largest facility's aggregate (provisional 1,000).
4. `lib/pdf/` move (G-R11: renderer primitives shared with the certificate PDF) — open since P23-02.
