# P22 browser coverage: the Phase 22 pages run in a real browser for the first time (`automate/p22.browser.mts`), the a11y suite extended, and what the runs found

**Date:** 2026-10-13 · **Task:** line C of the 2026-10-13 batch ("live browser coverage for the Phase 22 pages done in code"), two cards: **C1** (P22-01 … 07, 09) and **C2** (P22-08, the public device page, added by the coordinator once `9e74b52` landed) · **Covers:** P22-01, P22-02, P22-03, P22-04 (+ the P23-02 report page it links), P22-05, P22-06, P22-07, P22-08, P22-09. P22-10 already had `automate/field.browser.mts` · **Base:** `f2a2d70` (C1, the working tree); `e076d1a` (C2, a clean worktree — see Stack)

> Synthetic data only (a stamp in every name). `mozivid/` not touched. No backend file changed.

## Built

| What | Where |
|---|---|
| **The P22 browser suite** | `automate/p22.browser.mts` (puppeteer-core, axe-core, the E2E harness; type-checked by `automate/tsconfig.json`; added to `make test-browser`). The pages run in English (the `locale` cookie). Two signed-in sessions through the form (TOTP when asked): the **operator** for the catalogue (every catalogue write is the platform operator's) and a **HEALTHCARE ADMIN** of the operator's tenant, created through the API with its one-time password replaced (A-123), for everything else (the operator may not author tenant records, A-127). Setup through the API is one library item; everything else is created through the pages. |
| **The a11y suite, extended** | `automate/a11y.browser.js`: `/dashboard/ipm-templates`, `/dashboard/ipm`, `/dashboard/ipm/new`, `/dashboard/calibration-dates`, `/dashboard/exports` and `/dashboard/client-facilities` join the axe sweep (light and dark); `/dashboard/client-facilities` joins the create-dialog focus contract; the five list/entry pages join the 200 % reflow and reduced-motion checks. `/dashboard` and `/dashboard/devices` were already in all of them. CI's `browser-a11y` job runs this file, so the additions run in CI. |
| **The a11y suite, `/d/<token>` (C2)** | The run's device gets a public link (issued by the run's HEALTHCARE ADMIN, `POST /calibration-devices/:id/public-token`) and the tenant's page is turned on ("minimal", restored afterwards); `/d/<token>` joins the signed-out axe sweep (light and dark), the 200 % reflow and the reduced-motion checks. |
| **Responsive** | `automate/responsive.browser.js` is the signed-out public-page suite (no session; clipped/overlapping text on marketing pages). The dashboard pages' layout check is the P22 suite's `layout` group instead: every P22 route at 360, 768 and 1280 px and at 200 % zoom — no sideways page scroll (a table may scroll inside its own container), exactly one `<main>` and one `<h1>`. The a11y suite adds the 200 % reflow for five of them. |
| `Makefile` | `test-browser` runs `node automate/p22.browser.mts` after the field suite (two help lines). |

## The suite's checks

1. **P22-09** `/dashboard/client-facilities`: "Add a facility" → name, code, kind → saved → listed by the search (axe on the form).
2. **P22-01** `/dashboard/ipm-templates` (operator): add a device type; Checklists → pick the type → Create checklist → **Open an empty draft** → add the library item → **Save items** (toast, button idle) → change note → **Publish** → confirm (axe) → "Version 1 published" and the history's row; the **Published catalogue** offers the type and its item.
3. **P22-02** `/dashboard/devices`: Add device → name, QR, the new type (search + pick), make, model, serial, the facility, room + floor, condition Good (axe) → the register-mode photos dialog → **two real JPEG files** (encoded by the browser) through `#photo-device_front` / `#photo-device_serial_plate` → both previews shown, "Both required photos are present", **Finish** enabled (axe) → the list (QR filter) shows the row's thumbnail, loaded through a signed same-origin link.
4. **P22-03** `/dashboard/ipm/new`: the QR typed + Enter → the facts (serial) (axe) → **Start the IPM** → `/dashboard/ipm/capture/<id>`; every item answered (N/A where offered, the first outcome otherwise, 25 for a reading); outcomes, recommendation and notes → "Saved at" (autosave); **the draft's stepper axe-clean in light and dark** (a section step and the header step); Check and submit (axe) → **Submit** → "IPM visit … submitted"; the submitted page axe-clean in dark.
5. **P22-04** `/dashboard/ipm`: the QR filter finds the visit; "Open the visit to …" → the dialog (report number shown; axe) → **Open the IPM report** → the report page (h1 carries the number; sections rendered; axe) → **Download … as PDF** → a file lands in the browser's download directory and starts with `%PDF-`.
6. **P22-05** `/dashboard/calibration-dates`: the QR typed + Enter → the form → typed laboratory + certificate number (axe) → **Save calibration date** → "Calibration date recorded for …"; the Calibration list (QR filter) shows the record (axe).
7. **P22-06** `/dashboard/exports`: inventory **XLSX** for the facility → Check the size → Build and download → the file is produced in the browser, is a zip, and its worksheet holds the device's QR; the **latest-calibration recap XLSX** likewise (file `daftar_kalibrasi_terakhir_<day>.xlsx`, holds the QR); the page axe-clean after the builds.
8a. **P22-08 (C2)** the public device page: on `/dashboard/devices`, the row action **Public link of …** → **Issue a link** → the sticker (QR image and URL) is shown once (axe, once the panel's actions are live again); the tenant turns the page on through `PATCH /tenants/settings { tenantId, public_device_page: "minimal" }` (the administrator's API session; the value found is restored at the end); **signed out**, `/d/<token>` has the device's name as its one `<h1>` (P19-07 § 10) and shows type, make, model, facility, calibration status, next calibration and last IPM, and **never** the serial, the QR number, the room, a photo (no attachment image), a document link or a person's name (the administrator's name or username); axe light and dark; layout at 360 / 768 / 1280 / 200 %. Then **Revoke the link** → its confirmation (axe) → the panel says there is no link; `/d/<token>` says **"No device answers to this link."** and shows nothing of the device (axe light and dark; layout). Every outcome of that page is HTTP 200 (ADR-138 Am. 3), so only the content is asserted.
8. **P22-07** `/dashboard`: the condition panel (named donut), the IPM panel and the technician activity; the activity search finds the visit by QR (axe); **Show Good devices** → `/dashboard/devices?condition=good`, which lists the device.
9. **axe** (WCAG 2.1 A/AA), **light and dark**: the ten P22 routes (with this run's capture and report), the device-form and facility-form dialogs, and the operator's five catalogue tabs.
10. **layout**: the ten routes × 360 / 768 / 1280 / 200 % zoom.

## What the runs found

| Finding | Action |
|---|---|
| **P22-03 capture: the current step's answered count failed contrast** — `opacity-80` on the primary fill measured **4.43:1** (axe `color-contrast`, light; every run). | **Fixed** in `CaptureClient.tsx`: the count is full-strength (`font-normal` keeps it secondary). Re-run green. |
| The same `opacity-80` count pattern on `/dashboard/access-requests` (not a P22 page). | Not changed here (outside the card); noted for its owner. |
| The suite's own timing: a control that turns from disabled (opacity 50) to enabled fades over 200 ms; axe sampled mid-fade once (2.18:1 on "Previous"). Not a page defect — 200 ms is within the reduced-motion budget. | The suite's `axe()` waits for every finite animation to finish first. |
| Next 16 keeps the route it navigated away from mounted and hidden after a client navigation (the start page under the capture). | The suite matches visible elements only, and loads the capture afresh after the start's client navigation. |
| One a11y run (before the gate runs) hit a 30 s navigation timeout on `/dashboard/ipm-templates` (light) while a host-side jest run was loading the machine; dark and every P22-suite load of that page were fast. | Watched in the gate runs (below). |

| C2: the settings routes (`POST`/`PATCH /tenants/settings`) need `tenantId` in the body (their gate's `checkTenant`); a body without it is a 400 "Validation Error". As built, not a defect; the suites send it. | — |
| C2: the issued link panel re-reads its state after issuing; axe sampled one action button during that re-render (1.83:1, gone once the actions are live). Test timing, not a page defect. | The suite waits for "Revoke the link" to be enabled before measuring. |

No backend defect was found by these flows, and none in the P22-08 page.

## Gates (2026-10-13)

| Gate | Result |
|---|---|
| C1: **`automate/p22.browser.mts`**, twice back to back | **96/96, 96/96** |
| C1: **`automate/a11y.browser.js`** (extended), twice back to back | **104/104, 104/104** |
| C2: **`automate/p22.browser.mts`** with P22-08, twice back to back | **102/102, 102/102** (the six P22-08 checks included) |
| C2: **`automate/a11y.browser.js`** with `/d/<token>`, twice back to back | **108/108, 108/108** (`/d/<token>` axe light + dark, reflow, motion). During run 1 the run's link served the device's content (its name in the HTML), not the refusal |
| `automate` type-check (`tsc -p automate/tsconfig.json`) | 0 errors |
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on the changed page file | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests CaptureClient.tsx` | 2 suites, 14 tests passed |
| frontend guards `npx jest --ci src/tests/guards` | 6 suites, 97 tests passed |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | exit 0; every route within |

**Stack:** `deploy/compose` (`docker-compose.yml` + `.build.yml` + `.e2e.yml`), project `linec-stack`, `BUILD_TAG=linec`, production mode, 127.0.0.1:27410 (API) / 27411 (frontend) / 27412 (Mailpit), seeded with `GET /api/v1/migration/seeding`. C1's images were built from the working tree (the frontend rebuilt after the fix). For C2 the working tree could not build a backend (`openapi:check`: `openapi.json` stale under line A's uncommitted contracts edits, not this card's), so both images were rebuilt with `BUILD_CONTEXT` = a clean worktree at `e076d1a` (P22-08's `9e74b52` and C1's fix included) and the containers recreated on the same database (migrations at boot). The worktree was removed afterwards. Torn down by name with `down -v --rmi local`.

## Not done / open

- The capture's IPM evidence photos are not in the stepper (P22-03's own open item), so nothing to drive.
- The report's signature (P23-02) is not exercised: the card asks to view the report; signing is P23-02's suite.
- Camera scanning and HEIC on real phones stay with the real-device runbook (`TASKS/RUNBOOK-FIELD-REAL-DEVICE.md`).
- `/dashboard/access-requests`' `opacity-80` count (above).
