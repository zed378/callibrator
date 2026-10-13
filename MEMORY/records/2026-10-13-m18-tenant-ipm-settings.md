# M-18: a screen for the tenant's IPM and public-page settings (closes P26-01's gap C-1)

**Date:** 2026-10-13 · **Task:** BACKLOG M-18 = `docs/UPSTREAM/12-UAT-PLAN-ID.md` § 9 **C-1**, line B of the 2026-10-13 batch (assigned by the coordinator) · **Base:** `f178e58` · **Decisions:** none new — the settings, their rules and the API are as built by P21-04 / P21-08 (ADR-126 Am. 5, ADR-138 § 5); where the screen lives and who is offered it are below

> Frontend only. No backend file, no route, no migration, no menu entry (the tenants page already has one). No real data.

## What was missing

`public_device_page`, `ipm_countersign_enabled`, `ipm_interval_months` and `tenant_time_zone` were on the tenant-admin allow-list of `PATCH /tenants/settings` (`backend/src/constants/tenantAdminSettings.ts`) but no screen wrote them: a tenant administrator could not turn on the public device page or the IPSRS countersignature, nor set the IPM interval, without a technical helper (P26-01 found it while writing UAT steps AP-06/08/09, IP-01, PU-01).

## Built

| What | Where |
|---|---|
| **The panel** | `frontend/src/app/(app)/dashboard/tenants/components/IpmSettingsPanel.tsx` — a dialog: the public page (off / minimal / minimal with the last IPM report, each with what it shows and never shows), the IPSRS countersignature (on / off, and what "off" means), the IPM interval (months), the time zone (a datalist offering Asia/Jakarta, Asia/Makassar, Asia/Jayapura; any IANA zone). Loading, failed (retry) and loaded are three states; a failed read is never "all off". A refusal is the server's message, as written (`describeApiError`) |
| **The rules** | `components/ipmSettings.ts` — `formOf` (stored → form; an unset or unknown mode reads `off`), `problemsOf` (the interval a whole number 1 … `IPM_INTERVAL_MONTHS_MAX` = 60 or empty; the zone `isTimeZone` or empty — the contracts the server uses), `changesOf` (only the changed keys; `off` and a cleared field as `""`, which the server clears) |
| **The API** | the existing tenant service on the generated client: `POST /tenants/settings { tenantId }` to read, `PATCH /tenants/settings { tenantId, settings }` to write (`management` read / write with `checkTenant`; audited by the server) |
| **Where** | the tenants page, where the SSO and MFA settings already live: a **"IPM and public page settings of {tenant}"** action on the tenant's card (`TenantCard.tsx`, `SlidersHorizontal` icon, named after the tenant) |
| **Who** | offered when the caller holds `management` **write** and is **not** the platform operator (`canEditTenant && !canManagePlatform` in `TenantsClient.tsx`): the tenant's own administrators. The operator does not author a tenant's operational choices (A-127's rule for tenant records; the server would accept the operator, the screen does not offer it). A facility-bound account never reaches the tenants page (the bound menu ceiling) |
| **ID / EN** | the tenants page becomes a server shell (`page.tsx`: `getServerI18n`, `pickMessages(["tenantSettings."])`, `MessagesProvider`) around its former body, now `TenantsClient.tsx` (unchanged otherwise). 29 `tenantSettings.*` keys in `id.ts` and `en.ts`. The rest of the tenants page stays as it was (English) |
| **Tidy** | `TenantCard.tsx`: the unused `CardContent` import removed (its lint warning, on a file this card changes) |

## Tests

- **New:** `frontend/src/app/(app)/dashboard/tenants/__tests__/ipmSettings.m18.test.tsx` — 12 cases: `formOf`, `problemsOf` (1, 60, 0, 61, 1.5, −3, words; a known and an unknown zone), `changesOf`; a tenant administrator opens it from the card; the operator and a reader are not offered it; the stored values read and only the changed keys saved with the tenant in the body (axe); `off` and a cleared interval sent as `""`; an invalid interval and zone explained on their fields with `aria-invalid` / `aria-describedby` and nothing sent (axe); "nothing has changed"; a 400 and a 409 shown as written with the dialog kept open; a failed read with no form, then a retry; Indonesian.
- **Re-based (import only):** `tenants/__tests__/page.test.tsx` imports the island from `../TenantsClient` (the page is now an async server component); no assertion changed.

## Gates (2026-10-13)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on the 9 changed files | 0 errors, 0 warnings |
| `npx jest --ci src/app/(app)/dashboard/tenants` | 16 suites, 120 tests passed |
| `npx jest --ci --findRelatedTests` (the page, island, card, panel, rules, `en.ts`, `id.ts`) | 63 of 64 suites, 630 of 631 tests passed; the one failure was `src/field/ui/__tests__/FieldApp.test.tsx` "sign: … offline, it needs a connection" (no file of this card is in its path; it reads `en` only for its labels). Re-run alone: failed twice more while the machine was loaded, then passed 14/14 with HEAD's dictionaries and **14/14 twice with this card's** — a timing flake, reported to the coordinator, not changed here |
| `npx jest --ci src/tests/guards` | 7 suites, 115 tests passed |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | exit 0; every route within |
| **Browser** (a throwaway puppeteer script in the session's scratchpad, not committed), on a disposable stack (project `lineb2-stack`, `BUILD_TAG=lineb2`, a clean worktree of `f178e58` + this card; production mode), a HEALTHCARE ADMIN of the seeded tenant made through the API, Indonesian (the default locale), twice | **6/6, 6/6**: the tenants page offers the action (one `<main>`, one `<h1>`); the dialog axe-clean (WCAG 2.1 AA) in light and dark; an interval of 61 marked `aria-invalid` with its message, axe-clean, and the server's value unchanged; saving "Minimal", 6 and Asia/Makassar closes the dialog and `POST /tenants/settings` reads `public_device_page=minimal`, `ipm_interval_months=6`, `tenant_time_zone=Asia/Makassar`. The settings were restored (200) and the user deleted after each run |
| Stack note | the first build of the stack failed in the frontend's `next build` (Turbopack could not resolve a `next/font/google` file; no change of this card is involved); the unchanged rebuild passed |

## Documents

`docs/UPSTREAM/12-UAT-PLAN-ID.md`: C-1 marked done; AP-06, AP-08, AP-09, IP-01, PU-01 and § 3.3 now point at the panel; and the screen labels the plan had wrong are aligned with `id.ts` ("Unduh untuk kerja luring", "Mode luring aktif", "Menunggu tanda tangan", "Tanggal kalibrasi dicatat untuk …", "Versi 1 terbit", "Tidak ada perangkat yang menjawab tautan ini."). `TASKS/BACKLOG.md` M-18 marked done.
