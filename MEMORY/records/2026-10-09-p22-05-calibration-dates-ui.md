# P22-05 — the calibration-date page: the quick entry by QR sticker, and the calibration list

**Date:** 2026-10-09 · **Task:** P22-05 (Phase 22) · **Spec:** [`MEMORY/specs/P19-05-calibration-dates.md`](../specs/P19-05-calibration-dates.md) § 6 – § 8 · **API:** P21-05 ([record](./2026-10-09-p21-05-calibration-dates.md)), P21-06 ([record](./2026-10-09-p21-06-export-reads.md)), P21-02a's by-QR lookup ([record](./2026-10-09-p21-02a-device-register-api.md)), P21-09's facility options · **Kind:** frontend only (page, services, tests, i18n). No backend file and no `schema.d.ts` change. Nothing committed

> **Privacy:** every fixture is synthetic ("Synthetic infusion pump", "Synthetic Lab", "Synthetic clinic"). No upstream value appears anywhere, and `mozivid/` was not touched.

> **Resumed work:** a previous frontend agent was halted before its typecheck. Its partial tree was complete apart from tests and wiring: the page, both panels, `entry.ts`, the two services, the promoted `usePaged`, the `calibrationDue` tones and the i18n keys. It typechecked clean as found, and no half-written code was found. This card kept that work and added the tests, the link and the record.

## What was built

| | |
|---|---|
| Page | `frontend/src/app/(app)/dashboard/calibration-dates/`. `page.tsx` is the server half: it reads the locale cookie, hands the island only the `calibrationDates.` namespace, and posts the language toggle to `setLocale`, as P22-01 does. `CalibrationDatesClient.tsx` renders one `<main>` through `DashboardLayout`, one `<h1>` in every state (loading, restricted, loaded), and tabs driven by the arrow keys |
| Audiences (ADR-102: effective permissions, never a role name) | **Record a date:** `calibration` write, **not** facility-bound (N-10: the route answers 403 `FACILITY_ROUTE_REFUSED`) and **not** the platform operator (A-127: `denyPlatformAuthoring`). **Calibration list:** `calibration` read. For a bound reader the server already scopes the read, so the page offers no facility filter and shows no facility column or fact. **No read:** a restriction notice, and nothing is loaded |
| Quick entry (spec § 7) | The QR sticker is typed, or typed by a handheld scanner, then sent to `GET /calibration-devices/by-qr/:qrCode`. Each lookup outcome is a different state: 404 means "no device among those you may see", 400 shows the server's "not a sticker" message, and any other failure is `ErrorState` with a retry. Found, the page shows the device's facts: type, make · model, serial, facility (provider staff only), room, last calibration, and the next date with its `calibrationDue` badge. A retired device gets a notice and no form. The form takes the date (default today, between 1990 and today), the laboratory (the device's own pre-selected; otherwise picked from `GET /vendors?type=CalibrationLab&status=Active` with `vendors` read, or typed), the certificate number, the certificate's next date, the verdict (not stated / within / out of tolerance), the room (confirmed or changed) and notes. The form's own checks run before any round trip, and the server still decides. **Same-day warning:** a count read before saving; the save is accepted and the server's `notices` are shown. **Saved notice:** the re-derived next date, or "no next date" when none follows, "the IPM request is cleared" when it was, plus a success toast; the form resets for the next sticker. **409** (`CALIBRATION_DEVICE_RETIRED`, `CALIBRATION_FACILITY_ENDED`) and other refusals show the server's own message as a state explanation, and the form is kept |
| List (spec § 8, as built by P21-06) | `GET /calibration-records`: latest per device by default (`latestOnly`), or every record. Filters: QR (normalised by the server), facility (provider staff only; when the options read fails the filter is left out), entry kind, a date range on the calibration date or the input date (`fromDay`/`toDay`, tenant days; a reversed range is warned about), and sort by the chosen date. The room comes from the entry's snapshot. "Recorded by" is the snapshot name, "Redacted" for another facility's author, or the API key's name. The verdict is a `calibrationResult` badge. Loading, empty and **failed** (`ErrorState` with a retry, never an empty list) are separate states. The pager reads the top-level `meta` |
| Services (generated client only; types read off `paths`) | `api/services/calibrationDates.service.ts`: `findDeviceByQr`, `recordDate`, `listRecords` (rows from `data`, paging from the top-level `meta`; a missing `meta` means one page), `sameDayEntries`, `laboratories`. `api/services/clientFacility.service.ts`: `options` |
| Shared | `usePaged` moved to `src/hooks/usePaged.ts` (its own `Paged`/`PageMeta`); P22-01's `ipm-templates/hooks/usePaged.ts` re-exports it. `statusTone` `calibrationDue` gains `requested` (attention), `ok` (current) and `not_scheduled` (draft, never an alarm). 107 `calibrationDates.*` keys each in `id.ts` and `en.ts` |
| Reachability | A **"Calibration dates"** link in the header of `/dashboard/calibration` (that page is English; the link is shown to every reader). The page has no sidebar entry of its own (follow-up below) |

## Decisions (within the spec; no `docs/` deviation, no ADR)

1. **Camera scanning is P22-03's** (the field app). This page takes what a handheld scanner types into the sticker field, so no camera dependency enters the dashboard bundle.
2. **The room:** if the room is confirmed unchanged, the device's own `locationId` is sent. If it was changed, `room { name, floor }` is sent, and the server finds or creates it in the device's facility. When there is neither, nothing is sent. Blank optional fields are left out, never sent empty.
3. **The same-day warning is a convenience read**: `GET /calibration-records?deviceId&fromDay=toDay&entryKind=external_date&limit=1`, read from `meta.total`. A failed read is silent, because the server's `notices` after saving still say it. History is never refused (§ 7.3).
4. **The laboratory list is fetched only when needed**: on the first device found by a `vendors` reader. A caller without `vendors` read can use the device's own laboratory or type a name, and the vendors route is never called for them.
5. **The facility filter is a convenience, not a boundary** (P19-04). A bound reader is never offered it, and the options route is never called for them.
6. **A link, not a menu entry**: the sidebar shows only seeded, active entries (ADR-124 Am. 5), so an entry is the backend's to add.

## Evidence: tests named

- `src/api/services/calibrationDates.service.test.ts` (8 tests): every path, method, query and body is checked against `schema.d.ts`, along with the envelope (rows in `data`, the top-level `meta`, a missing `meta` read as one page, `null` data read as none). A 409 rejects. `sameDayEntries` counts from `meta.total`, else from the rows. `laboratories` is checked with and without `find`, and the facility options with `null` data.
- `src/app/(app)/dashboard/calibration-dates/__tests__/entry.test.ts` (16 tests): `todayDay`; `deviceRoom` (a room, a store, no floor, none); the starting laboratory mode; `entryProblems` row by row (missing, future, before 1990, due date not after, no laboratory picked or typed, floor without a room, clean); the exact body for a confirmed room, a changed room, a typed laboratory and a verdict.
- `…/__tests__/CalibrationDatesClient.test.tsx` (7 tests):
  - `tabsFor` per audience;
  - loading with one `<h1>`, and nothing loaded;
  - the restriction notice;
  - a writer's two tabs with the arrow keys, checked with axe;
  - **a bound account holding `calibration` write gets the list only, with no facility filter or column, and the options route is never called**;
  - the operator reads but never records;
  - Indonesian.
- `…/__tests__/QuickEntryPanel.test.tsx` (14 tests):
  - the full find → facts → save path, checking the exact POST, the saved notice, the server's notice, the toast, the reset and the dismiss, with axe;
  - the request cleared and no next date;
  - 404, 400 and 500 shown as three states, with a retry;
  - an empty sticker sends nothing;
  - a retired device;
  - the form's problems shown before any POST;
  - **a 409 shown as the server's explanation, with the form kept**;
  - a refusal with no message;
  - the same-day warning, re-checked on a date change, and silent when the check fails;
  - a picked laboratory with a changed room, due date, verdict and notes, checking the exact body;
  - a typed laboratory, with no facility shown when `showFacility` is false;
  - no laboratories yet, and cancel;
  - a failed laboratory read, then a retry;
  - an unnamed device laboratory, a store as no room, and a full record as the last calibration.
- `…/__tests__/CalibrationListPanel.test.tsx` (8 tests): `listQuery` sends only what is set; the rows (snapshot room, the "—" room, recorder by snapshot / "Redacted" / API key, verdict badges, kinds) checked with axe; each filter re-reads page 1 with its query; the reversed-range warning; empty; **failed with a retry, never shown as empty**; a failed facility read leaves the filter out; paging from the top-level `meta`.
- `…/__tests__/page.test.tsx` (2 tests): the title in the request's language; only the `calibrationDates.` namespace is handed over; the toggle.
- `src/app/(app)/dashboard/calibration/__tests__/page.test.tsx`: one assertion added, that the "Calibration dates" link points to `/dashboard/calibration-dates`.
- `src/lib/statusTone.test.ts`: 3 rows added for the new `calibrationDue` states.

**Gates (2026-10-09, frontend):**

- `npm run typecheck`: 0 errors.
- `npx eslint` on every changed file: clean.
- `npx jest --ci --coverage`: **333 suites and 3,629 tests passed, 0 failed**, at 94.27 / 85.59 / 90.24 / 94.94 (gate 90 / 81 / 86 / 91). The new files: services 100 %, the page directory 100 / 97.6 / 100 / 100, the components 98.61 / 97.94 / 100 / 99.48.
- `node ../node_modules/next/dist/bin/next build`: OK (`ƒ /dashboard/calibration-dates`).
- `node scripts/bundle-budget.mjs`: 10 / 10 within.

**The first build failed** on `src/tests/support/ipmCatalogueFixtures.ts` (P22-01's). The backend agent had regenerated `schema.d.ts` in parallel, and the proposal queue row now carries a required `tenantName`. TypeScript 7 (`npm run typecheck`) accepted the fixture's spread; the TypeScript 6 in `next build` did not. The fixture now sets `tenantName: null`. The P22-01 suites were re-run: 64/64.

The tree was not quiet: the backend agent was editing `backend/`, `packages/contracts/` and `schema.d.ts` in parallel. None of those were touched here.

## Not done / open

- **Backend follow-up (optional):** a sidebar entry for `/dashboard/calibration-dates` (seed + migration, gated on `calibration`). Until then the page is reached by the link on `/dashboard/calibration`.
- **P22-01 follow-up, now possible:** the queue row carries `tenantName`, but the queue panel still shows `tenantId`.
- Live browser, E2E, accessibility (light + dark) and responsive suites on a running stack (the phase DoD) were not run, because there was no stack in this session.
- Nothing was committed.
