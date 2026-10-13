# P21-08: the public device page API — the hash-only link table, the staff issue / rotate / revoke routes, the exempted public read

**Date:** 2026-10-13 · **Task:** P21-08 (Phase 21) · **Spec:** [`MEMORY/specs/P19-07-public-device-page.md`](../specs/P19-07-public-device-page.md) · **Decisions:** ADR-138, Am. 1, **Am. 2** ([DECISIONS](../DECISIONS.md)) · **Unblocks:** P22-08

## What was built

- **Migration 0137** `public_device_tokens`. It stores only the token's SHA-256 (CHECK: 64 hex).
  - Indexes: the hash is UNIQUE globally (ADR-138 § 2's reviewed exception), and a partial UNIQUE allows one active link per device.
  - CHECKs: the revoke columns are set together; `revoked_by` may be NULL only for `device_deleted`.
  - Triggers, ENABLE ALWAYS: the table is append-mostly (only the revoke columns change, once; no DELETE or TRUNCATE), and a link must name a device of its own tenant.
  - Grants: SELECT, INSERT and UPDATE of the revoke columns only.
  - It is independent of 0138 (LINE A): it needs only `tenants`, `users`, `calibration_devices` and the application role.
- **The model** `PublicDeviceToken` is tenant-scoped. It is a reviewed PROVIDER_INTERNAL entry in G-11, and `tokenHash` is in `SECRET_ATTRIBUTES`.
- **The staff routes**, `/calibration-devices/:id/public-token`:
  - `GET` (state), `POST` (issue), `POST /rotate` and `DELETE` (revoke). A person only, `calibration` read or write, and `denyPlatformAuthoring` on the writes.
  - Not facility-accessible: a bound account gets 403 `FACILITY_ROUTE_REFUSED`.
  - Each write has one audit row in its transaction (the hash prefix, never the token). The 409s are `PUBLIC_TOKEN_ACTIVE` and `PUBLIC_TOKEN_NONE`.
  - A device delete revokes the device's link.
- **The public route** `GET /api/v1/public/devices/:token`:
  - A reviewed `routeGateExemptions` entry, a `FACILITY_SCOPE_SKIPS` entry, and an entry on the two-tenant allow-list.
  - Headers first (`no-store`, `noindex`, `no-referrer`), then the `publicDevicePage` (120) and `publicDevicePageGlobal` (3 000) budgets. Every 404 also counts against `publicDevicePageMiss` (30).
  - One 404 `PUBLIC_DEVICE_NOT_FOUND`.
  - The answer is an allow-list. A retired device is shown.
- **The setting** `public_device_page` (off / minimal / minimal_with_report) is a pattern setting of `PATCH /tenants/settings`, which is already audited.
- **Logs:** `utils/publicDevicePath.util` hashes the path token. The activity log's `sanitizeUrl` uses it, and so does the access log's new `:safe-url`.
- **The contract** `@callibrator/contracts/publicDevices`. `openapi.json` gained 5 operations (558 in total); `schema.d.ts` was regenerated. `.env.example` documents `PUBLIC_DEVICE_BASE_URL`.
- **`docs/SECURITY/15`:** EP-23 and FT-106 now name the built control and its tests, and P16 points to ADR-138.

## Tests (named)

| Suite | Result |
|---|---|
| `tests/routes/publicDeviceTokens.p2108.test.ts` (two-tenant ×4 `@two-tenant`, two-facility 403 ×4, state machine, audit, rollback, delete revokes, URL) | 27/27 |
| `tests/routes/publicDevicePage.p2108.test.ts` (allow-list, forbidden fields, 11 × one 404 in production mode, headers, 3 budgets, log redaction) | 25/25 |
| `tests/migrations/0137-public-device-tokens.p2108.test.ts` | 5/5 |
| `packages/contracts/test/publicDevices.p2108.test.ts` | 6/6, `publicDevices.ts` 100 % |
| `tests/migrations/publicDeviceTokens.p2108.live.test.ts` (PG 18.x, as `callibrator_app` and as the owner, FAIL-BEFORE on both indexes) | 10/10 |
| live `p2004`, `p2002`, `uifix` (same PG18) | 15/15, 21/21, 3/3 |

## Gates

| Gate | Result |
|---|---|
| `npx eslint` on every changed backend file; `node scripts/ci/eslint-ratchet.js` | 0 errors, 0 warnings; baseline 0 |
| `npm run typecheck`: backend, frontend, `packages/contracts` | 0 errors each |
| `npm run ratchet` | 695 `.js`, at the floor (no new `.js`) |
| `npm run load:check -- --src` | OK: 760 modules, 117 in boot order |
| New files at 100 % (statements, branches, functions, lines): `publicDevicePage.service`, `publicDeviceToken.service`, `publicDevice.controller`, `publicDevices.route`, `publicDevicePath.util`, `0137`, the two openapi modules, `activityLog` / `accessLog` middlewares | 100 % on each |
| `--findRelatedTests` on every changed source file (one run, 12,884 tests) | 12,878 passed. 6 failed, none of them this card's: `clamAv.service` ×3 (no clamd), `schedulerSwitch.w02` (no helm), and `user.passwordReset.a162` and `calibrationRecords.validator.contract` (timeouts under the load of that run; both pass alone, 72/72 with this card's suites) |
| `src/tests/guards`, `utils/rawSql`, `services/unboundedFindAll`, `includeRequired.d12`, `denyPlatformAuthoring.a127`, `readGates.p604`, `routePermissionGuard.p604` | 638/638 |
| `openapi:generate` (5 operations, 558 in total), `openapi:check`, `openapi:lint`, `api:types` + `api:types:check` | current; no new error (15 legacy warnings); `schema.d.ts` +301 lines |
| Live, a throwaway PG 18 on 127.0.0.1:56258 (`npm run test:live -- --only=p2108,p2004,p2002,uifix`), run twice (the second after the `revoked_by` index change) | 4 of 4 suites, 49/49 |

## Changed existing tests (reviewed lists and doubles, no assertion weakened)

- `guards/twoTenantRoutes` (allow-list entry) and `guards/facilityScopedModels` (PROVIDER_INTERNAL entry).
- `models/includeRequired.d12` (87 → 88 converted models), `models/associationForeignKeys.a148` (three RESTRICT keys) and `routes/denyPlatformAuthoring.a127` (the revoke in GUARDED).
- `services/calibrationDevices.service.test.js` and `services/calibrationDevices.audit.a133.test.js`: the models double gains `PublicDeviceToken.findOne → null`.

## Open

- The access log still writes other query-string tokens (for example the verification links' `?token=`) as before. This is ADR-138 Am. 2 § 3; it is not this card's.
- nginx's own log of `/d/` and `/api/v1/public/devices/` belongs to P22-08 (spec § 3 G-9).
- P27-03: the sticker's layout and the re-stickering policy.
