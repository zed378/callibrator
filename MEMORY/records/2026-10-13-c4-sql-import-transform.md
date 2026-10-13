# C-4: the SQL-dump import page offers stage 2 (the transform) and tells the server's truth about it

**Date:** 2026-10-13 · **Task:** `docs/UPSTREAM/12-UAT-PLAN-ID.md` § 9 **C-4** (found by P26-01), line B of the 2026-10-13 batch (assigned by the coordinator) · **Base:** after M-18 (`f178e58` + C-1) · **Builds on:** P24-01 (ADR-129 Am. 1: the transform route and run fields), P24-02a (Am. 3: the provider tenant named on the request)

> Frontend only. No backend file, route or migration. Synthetic data only. `mozivid/` not touched.

## What was wrong

A loaded run's detail said "Stage 2 (the transform into the application's tables) is not available yet: the rows stay in staging." But `POST /admin/upstream-sql-imports/:id/transform` exists (P24-01), the run view carries the transform's state, and the steps are being built (P24-02). What is still true is narrower: the server refuses with 409 `TRANSFORM_NOT_AVAILABLE` while its transform steps are not all built (step 9, P24-03, has not landed). That refusal is the server's, so the page should show it as the server words it.

## Built

| What | Where |
|---|---|
| **Stage 2 section** | `frontend/src/app/(app)/dashboard/upstream-sql-import/TransformSection.tsx`, shown for a loaded run and for any run whose transform has been requested. It holds: what stage 2 does; the transform state (`not_available` "Not requested", requested, transforming, transformed, failed — new status-tone domain `upstreamSqlTransform`, with failed as alarm); the failure code in words (all eight `transformErrorCode` values); the per-step summary (step, staged table, staged / mapped / unchanged / quarantined by reason); the **provider tenant** chosen from the **active** tenants (`GET /tenants/all`, with a search, failed + retry and empty states); and **"Transform into {tenant}"**, disabled until a tenant is chosen and while a transform is requested or running |
| **The answer** | `POST …/:id/transform { providerTenantId }` (`upstreamSqlImportService.transform`, generated client). A **409** (`TRANSFORM_NOT_AVAILABLE`, `RUN_NOT_LOADED`, `TRANSFORM_IN_PROGRESS`, `PROVIDER_TENANT_NOT_ACTIVE`) is shown as the run's state ("The transform was not started", an info alert) **in the server's words**; any other refusal (403 `REAL_DATA_NOT_ALLOWED`, 404) is a failure ("The transform was refused.") in the server's words. A queued transform is announced, the run as the server answered is shown, and the list is re-read |
| **Polling** | `UpstreamSqlImportClient.tsx`: the page now also polls while the open run's transform is requested or transforming (`ACTIVE_SQL_TRANSFORM_STATUSES`) |
| **Messages** | `sqlImport.detail.transform` rewritten (what stage 2 does: every staged row mapped or quarantined, or nothing kept; a run can be transformed again — the route's OpenAPI description); 33 new `sqlImport.transform.*` keys, ID and EN |

The server's refusal text is English (the backend writes its messages in English), so an Indonesian page shows the English sentence under an Indonesian title. That is the existing rule for 409s on this page ("a 409 shows the backend's state explanation as written").

## Tests

- **New:** `frontend/src/app/(app)/dashboard/upstream-sql-import/__tests__/transform.c4.test.tsx` — 7 cases: the state, only active tenants offered, the action disabled until one is chosen (axe); the 409 `TRANSFORM_NOT_AVAILABLE` as the run's state in the server's words, with the request body checked (axe); a 403 as a failure in the server's words; a queued transform announced, its state shown, the action disabled while it is in progress; a failed transform's reason and a finished one's rows per step (axe); the tenants failing to load, then a retry; Indonesian.
- **Changed:** `__tests__/UpstreamSqlImportClient.test.tsx` — the case that asserted the stale "not available yet" sentence now asserts the stage 2 section (the behaviour changed on purpose); its GET mock answers `/tenants/all`. `lib/statusTone.test.ts` +5 rows and the alarm allow-list entry `upstreamSqlTransform.transform_failed`.

## Gates (2026-10-13)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on the 9 changed files | 0 errors, 0 warnings |
| `npx jest --ci` on the page's tests and `lib/statusTone` | 4 suites, 151 tests passed |
| `npx jest --ci --findRelatedTests` (section, island, service, `statusTone.ts`, `en.ts`, `id.ts`) | 173 suites, 1,908 tests passed |
| `npx jest --ci src/tests/guards` | 7 suites, 115 tests passed |
| `node ../node_modules/next/dist/bin/next build` | OK |
| `node scripts/bundle-budget.mjs` | exit 0; every route within |
| **Browser** (a throwaway puppeteer script in the session's scratchpad, not committed), stack `lineb2-stack` (clean worktree of `f178e58` + C-1 + this card; production mode), the operator through the form with its TOTP, a **synthetic** one-table dump uploaded through the API and loaded into staging, Indonesian, light and dark | run 1 **4/4**, run 2 **4/4** (a run in between stopped at the sign-in when the script spent its TOTP window, before any check ran): the loaded run shows "Tahap 2: transformasi" with no "belum tersedia" text; choosing a tenant and requesting gives "Transformasi tidak dimulai" with the server's "The transform into the application's tables is not built on this server yet: the run stays staged."; axe 0 on the section in both themes; the run's `transformStatus` stays `not_available` |
| Stack note | the frontend image build failed once more in `next/font/google` (as for M-18) and passed when rebuilt unchanged |

## Documents

`docs/UPSTREAM/12-UAT-PLAN-ID.md`: C-4 marked done; OP-02 now covers stage 2. Stage 2 is marked ⏳ until the server's transform steps are complete (P24-02 / P24-03); real data is still ⏳ on the DPIA gate (P24-05).
