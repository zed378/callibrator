# P21-09c — the client-facility administration routes, the bound menu ceiling, `my-permissions.facilityBound`, G-P1 … G-P3

**Date:** 2026-10-08 · **Task:** P21-09c (Phase 21), unblocked the same day by P20-06 · **Decision:** ADR-124 Amendment 5 (new) · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) § 4.4 – § 4.6, § 13 (as-built note added); [`P18-03`](../specs/P18-03-facility-scope-permissions.md) § 5, § 13, § 15 · **Base:** `24a0738`, working tree, **not committed** · **Kind:** code + tests + contracts + OpenAPI + frontend types.

> **Privacy:** synthetic fixtures only ("Facility One", `F-0001`, `@example.test`).

## What was built

| | |
|---|---|
| Routes (`routes/api/clientFacilities.route.ts`) | `GET /` (`client-facilities` read; `clientFacilityListQuery` from query; rows in `data`, paging in top-level `meta`), `GET /options` (`dynamicAccess(["calibration","ipm","client-facilities"], "read")`), `GET /:clientFacilityId` (read), `POST /` (write + `denyApiKey`), `PATCH /:clientFacilityId` (write + `denyApiKey`, `clientFacilityEdit` from params+body), `POST /:clientFacilityId/status` (write + `denyApiKey`, `clientFacilityStatusRequest`; `ended → active` needs `rbacAllows(TENANT_ADMIN)` in the service), `DELETE /:clientFacilityId` (`denyApiKey` + `rbac([TENANT_ADMIN])` + write), `GET /:clientFacilityId/users` (`users` read). `/mine` and `/options` registered before `/:clientFacilityId`. None marked facility-accessible. Handlers in `controllers/clientFacility.controller.ts` over the P21-09b service; every write's audit row is inside its transaction (the service) |
| Contracts | `@callibrator/contracts/clientFacilities`: `clientFacilityEdit` (strict body + `clientFacilityId`, at least one field), `clientFacilityStatusRequest` (status body + `clientFacilityId`) — ADR-124 Am. 5 § 4 |
| OpenAPI | `clientFacilities.openapi.ts` (8 new operations; `ClientFacility`, `ClientFacilityOption`, `ClientFacilityUser`); `menuGroups.openapi.ts` `facilityBound`; `calibrationRecords.openapi.ts` void gate; `openapi.json` **501 operations**; frontend `schema.d.ts` regenerated |
| Ceiling (P18-03 § 5) | `constants/facilityAccess.ts#BOUND_MENU_CEILING` (Matrix B per bound role); `services/effectivePermission.service.ts`: `PermissionPrincipal.clientFacilityId` / `isApiKey`, `isBound`, `PermissionSources.ceiling`, applied in `permissionsForMenu` after the override (none ⇒ nothing, read ⇒ read if anything held, write ⇒ unchanged); role outside the bound set ⇒ empty ceiling; super admin uncapped |
| Menu / my-permissions | `menuGroup.service`: the requester's binding passed for its own role's menu; `getMyPermissions` answers `{ superAdmin, facilityBound, permissions }`. Frontend `menuGroupRole.service#getMyPermissions` reads `facilityBound`; the store type keeps it optional (absent = unbound) |

## Evidence — tests named

- `tests/routes/clientFacilities.admin.twoTenant.test.ts` — **33**: `twoTenantSuite` over the five `:id` routes (`@two-tenant` markers: GET, PATCH, POST status, DELETE, GET users — 404 identical to missing, nothing written; owner reaches, writes committed); **two facilities**: all seven administration routes answer a bound principal 403 `FACILITY_ROUTE_REFUSED` (top-level `code`) identically for its own facility, another facility and a missing id, nothing written; `/mine` still reachable; list paging + `meta`, strict query 400, options, create 201 + audit / duplicate 409, strict body 400, edit 400/409, status leaving active revokes the bound user's session (Session row + audit), `ended → active` 403 for a SUPERVISOR and 200 for the admin, self-facility 409, delete referenced 409 with counts / SUPERVISOR 403, bound users list, API key 403 on all four writes.
- `tests/routes/clientFacilities.gates.p2109c.test.ts` — **12** on the real seeded matrix (technicians read `/options`, are refused `/` and `/:id`; ENGINEERING MANAGER reads but cannot create; both admins create; DELETE rbac).
- **G-P1** `tests/services/effectivePermission.boundCeiling.test.ts` — **28**: every bound role × every `SEEDED_MENU_SLUGS` slug = min(unbound, ceiling); an override lifting every slug to write yields exactly the ceiling; a hand spot table of 15 cells; outside-set role ⇒ nothing; API key never bound; super admin uncapped. **Fail-before:** ceiling removed ⇒ 17 of 27 fail (before the no-role case was added).
- **G-P2** `tests/services/menuEffectiveAccess.bound.test.ts` — **9**: each bound role's sidebar written out (base: Dashboard, Devices, Calibration & Certificates, Maintenance, Profile, Warehouses; + Change Password for HA, + E-Signature for HT/FM); each bound leaf's load route marked or on `PENDING_LOAD` (fails when it becomes marked); unbound HA unchanged; `my-permissions` bound/unbound.
- **G-P3** `tests/guards/boundCeilingRoutes.guard.test.ts` — **6**: ceiling roles = bound set, slugs seeded; every marked route within the ceiling union (checkSelf self routes excepted); every ceiling write with write routes is marked or `PENDING` (`calibration` → P21-09e, `esignature` → P21-03/04); three planted violations caught.
- Contracts: `packages/contracts/test/clientFacilities.p2109c.test.ts` — **4**.
- Unchanged and green in the full run: `facilityAccessibleRoutes.guard` (G-09), `facilityRouteDefault` (G-10 — now over the new routes too), `twoTenantRoutes.guard`, `routePermissionGuard.p604`, `effectivePermission.adr102`, `menuEffectiveAccess.adr102`, `seededMenuSlugs.p919`.

## Gates (2026-10-08, quiet tree — the only agent; P20-06 and P21-09c together)

- `node scripts/ci/eslint-ratchet.js`: "0 error(s), 0 warning(s); baseline 0"; `npx eslint` on every changed file clean.
- backend `npm run typecheck` 0 errors; `npm run ratchet` 695 `.js`, at the floor; `npm run build:dist` OK (677 TypeScript files; contracts 56); `npm run load:check` OK in both modes (667 modules; 109 in boot order); `npm run openapi:check` current (501 operations); `npm run openapi:lint` no new error (15 warnings).
- **`npm run test:coverage -- --ci`: 950 suites passed, 42 skipped, 0 failed; 16,347 tests passed, 343 skipped, 0 failed; 100 / 100 / 100 / 100**, in 365 s (Node 26).
- contracts: `npm test` 54 suites, 1,209 tests, 100 %; `typecheck` 0; `lint` 0.
- frontend (`schema.d.ts` regenerated; `menuGroupRole.service` reads `facilityBound`, the store type keeps it optional; the API-key dialog labels `IPM`): `npm run typecheck` 0; `api:types:check` current; `npm test -- --ci` 320 suites, 3,480 tests, 94.16 / 85.07 / 90 / 94.8 (gate 90 / 81 / 86 / 91).
- Live PostgreSQL 18 (throwaway `p2006-pg18`, 127.0.0.1:55206, removed by name; no prune): `npm run test:live -- --only=p2007,p2006` 3 of 3 suites (`clientFacilities.p2007.live` 56, `deviceMove.p2007.live` 7, `menuGrants.p2006.live` 5); `--only=p2006,uifix` earlier (uifix 3).
- Existing tests changed, each for a deliberate behaviour change (no assertion weakened): `calibrationRecords.route.test.js` (void chain 7 links), `denyPlatformAuthoring.a127.test.js` (the void's member is the tenant admin), `menuEffectiveAccess.adr102.test.ts` (super admin sees every ACTIVE leaf), `menuGroup.service.test.js` / `menuGroup.controller.test.js` (`isBound` double, `facilityBound`, the requester's binding), `facilityContextSource.guard.test.ts` (menuGroup service + contract name `facilityBound` as a response field), `swaggerValidatorAlignment.p608.test.js` (path-param omission for a refined object), `clientFacilities.p2007.live` / `deviceMove.p2007.live` (migrations after 0123). Contract `API_KEY_SCOPE_RESOURCES` + `ipm`, `ipm-templates`, `client-facilities` (A-299/A-311).
- Not run: the live E2E suite (no frontend page changed behaviour; no bound account can exist).

## Not done / open

- **`FACILITY_BINDING_ENABLED` stays off.** A bound user would today see sidebar leaves whose load routes are unmarked (403) — `PENDING_LOAD` / `PENDING` name P21-09e (A-1 … A-8, MFA/password self routes) and P21-03/04 (N-5). Both lists must be empty before the switch.
- The three menu entries are inactive until P22 builds their pages (ADR-124 Am. 5 § 2).
- Frontend: `usePermissions` does not yet read `facilityBound` to hide unmarked write actions (P18-03 § 13, G-P8) — P22-09.
- P21-09d is next; P21-09e after it. P21-01 is unblocked by P20-06.
