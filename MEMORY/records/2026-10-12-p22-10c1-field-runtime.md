# P22-10c1: the field app's runtime — field reads, working-set download, purge triggers wired, profile guard, administrator wipe, photo admission

**Date:** 2026-10-12 · **Task:** P22-10c1 (Phase 22; P22-10c split into c1 / c2 / c3, ADR-127 Am. 3 § 1) · **Specs:** [`P19-08`](../specs/P19-08-offline-field-capture.md) § 7.2, § 8.1, § 10, § 11; ADR-127 + Am. 1 – 3; ADR-135 (the wipe's order) · **Base:** `937fb44`

> Frontend only. **There is still no `/field` page**: that is P22-10c2. The browser suite and the real-device script are P22-10c3.

## The split

| Part | Scope |
|---|---|
| **P22-10c1** (this one) | `frontend/src/field/app/`: the field reads, the working-set download, the runtime (store + engine + registry, purge triggers), the profile guard in the dashboard shell, the administrator wipe, photo admission; `client.ts` session-end hooks; the `idb.ts` error fix |
| P22-10c2 | the `/field` document: layout, screens (home, settings/prepare, scan, device, register, capture, outbox/attention, sign), the in-memory store, i18n, the `fieldShellNoTenantData` guard, the bundle budget |
| P22-10c3 | the browser suite (P19-08 § 16.3) on the compose stack, and the real-device script (§ 16.5) — the run itself is the owner's |

## Built

| File | What |
|---|---|
| `field/app/fieldApi.ts` | `POST /auth/verify` (user, role level, bound facility, `scopeFingerprint`); the facilities (`/client-facilities/mine` for a bound user, `/options` for an unbound one); a facility's size (`meta.total` of a one-row `view=field` page; the cap's 400 `FIELD_WORKING_SET_TOO_LARGE` is a refusal with the server's message); pages of `fieldDeviceSummary`, each row cut to `FIELD_DEVICE_SUMMARY_KEYS`; every room page (`kind=room`); the catalogue with `If-None-Match` / 304; `POST /field/wipes`. All typed except the catalogue (headers, Am. 3 § 7). |
| `field/app/workingSet.ts` | The facility rule (bound: own only; unbound: 1 – 3). Sizes first. Then the download: the old set dropped, pages of 200 (`sort=id`) to the total, the rooms, the catalogue, the facilities list, then `meta` (fingerprint, device and server time). **All or nothing**: a failure drops what was written; the outbox is never touched. `refreshCatalogue` (304 keeps the copy). The in-memory index: by id, by QR (Am. 3 § 2), by name / serial / maker / model / code. |
| `field/app/runtime.ts` | `openRuntime`: the user's store, the engine, the registry row (serialised writes, none after close); **purge triggers wired**: the session ending (`onSessionEnd`), a scope-loss code (`scopeLoss`), the clock at open and every 10 min; the profile guard's drop reconciled into `meta`. `turnOff` (sign-out / offline off): refused with a non-empty outbox, else the database and its row are deleted. `enableOffline` (AM-23 § 11.1). `fieldProfileGuard` (§ 11.2): other users' working sets dropped without their key, outboxes untouched, pending wipes retried. `adminWipe` (§ 11.3 + ADR-135): unbound tenant administrator, online, not own data; counts read without the key; recorded first; deleted after; a failed deletion kept in `cf.field.wipePending`. |
| `field/app/photos.ts` | 25 MB refusal, "phone almost full" refusal (< 50 MB or < 10 % free), then `lib/photoPrep.ts` (2048 px JPEG, metadata dropped); an undecodable HEIC is refused (Am. 3 § 3). |
| `field/app/profileGuard.ts`, `components/FieldProfileGuard.tsx`, `components/AppProviders.tsx` | The dashboard shell runs the guard by `import()` only when `cf.field.present` is set and the user is known. |
| `field/platform/idbStore.ts` | `putFacilities` / `readFacilities` (purgeable, `rooms/_facilities`), `putChoice` / `readChoice` (ids in `meta`), `dropForeignWorkingSet`, `countForeignOutbox` (another user's database, no key, never created if missing); the upgrade adds only missing stores. |
| `field/platform/idb.ts` | **The fix P22-10b noted:** `tx` rejects with the failed request's own error (`ConstraintError`), read from the error event's target. |
| `api/client.ts` | `/field` is a protected path for the session-end redirect; `onSessionEnd(hook)`; `endSession` awaits the hooks (bounded at 3 s) before navigating. |

## Evidence — tests named

New:
- `field/app/__tests__/workingSet.test.ts` (10): the facility rule; sizes before any page; pages of 200 with progress; rooms, catalogue + ETag, facilities, meta; the server time kept when absent; an empty page writes nothing; the cap refusal writes nothing; **all or nothing with the outbox intact**; `If-None-Match` kept / replaced / 304 without a copy; QR matching; the index.
- `field/app/__tests__/runtime.test.ts` (17): the registry row and the flag; **session end purges, the outbox stays**; scope-loss code purges, other codes do not; the clock at open and the 10-minute re-armed check; no write after close; reconcile; turn-off refused then allowed (database and row gone); enable refused / empty row removed; **the guard drops another user's set without the key and keeps the outbox; a missing database is not created**; wipe: who, offline, own data, recorded first, not recorded → nothing deleted, failed deletion retried by the guard, no flag storage, corrupt pending list.
- `field/app/__tests__/fieldApi.test.ts` (10), through the real `apiClient` with an axios adapter: paths, queries, the envelope (`data` + top-level `meta`), the row cut to the contract's keys, the cap refusal, `If-None-Match` / 304, the wipe body.
- `field/app/__tests__/photos.test.ts` (5), `field/app/__tests__/profileGuard.test.ts` (1), `components/__tests__/FieldProfileGuard.test.tsx` (4).

Extended:
- `field/platform/__tests__/idb.test.ts` (+1, one re-based): a duplicate `add` now rejects with `ConstraintError`; the event-target branches.
- `field/platform/__tests__/idbStore.test.ts` (+2): facilities purged with the set while the choice stays; another user's database dropped and counted without the key.
- `api/client.session.f05.test.ts` (+3): `/field` protected and `/fieldwork` not; the hooks awaited before the navigation, a failing hook does not stop it; a hanging hook is bounded.

## Gates (2026-10-12; per-card rule)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests <changed sources>` | **280 suites, 2,874 tests passed** |
| `npx jest --ci src/tests/guards src/field` | **20 suites, 233 tests passed** |
| changed files' coverage | `fieldApi.ts`, `workingSet.ts`, `runtime.ts`, `photos.ts`, `profileGuard.ts`, `FieldProfileGuard.tsx`, `idb.ts`, `idbStore.ts`: **100 / 100 / 100 / 100**. `client.ts`: the new lines covered; its older uncovered branches are unchanged (same set before and after) |
| `node ../node_modules/next/dist/bin/next build` | OK (the dashboard shell changed) |
| `node scripts/bundle-budget.mjs` | 13/13 within budget, exit 0 (`/` 128.8 / 180 brotli, 150.0 / 152 gzip — unchanged: no field code in public routes) |

## Not done / open

- **P22-10c2** (the page) and **P22-10c3** (browser suite, real-device script).
- **Backend gap, reported to the coordinator:** `GET /warehouses` has no `clientFacilityId` filter, so rooms are downloaded tenant-wide (Am. 3 § 6).
- The engine's working-set purge does not re-download by itself: c2 re-downloads the stored choice after a `scope_changed` purge.
