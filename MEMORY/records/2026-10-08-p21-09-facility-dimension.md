# P21-09a + P21-09b — the facility dimension: context, hooks, refusal codes, route gate, binding (P21-09 split in five)

**Date:** 2026-10-08 · **Task:** P21-09 (Phase 21), split into P21-09a … e · **Decision:** ADR-124 Amendment 4 (new) · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) § 7 – § 13, § 16, § 17 (as-built notes in § 7.4, § 7.7, § 13.1) · **Base:** `260fbd1`, then `5ba2865` (the coordinator's Next.js bump, committed during the work; the final gates ran on it) — working tree, not committed · **Kind:** code + tests + contracts + OpenAPI + docs. **Nothing committed.**

> **Privacy:** no upstream value anywhere; fixtures are synthetic ("Facility One", `F-0001`, `@example.test`).

## The split (ADR-124 Am. 4 § 1)

| Card | Status | What |
|---|---|---|
| **P21-09a** | **DONE** | the facility context, the hooks, the refusal codes, the socket, `/auth/verify`, the five P20-07 hand-offs |
| **P21-09b** | **DONE** | the route gate and index, `GET /client-facilities/mine`, the binding route, the facility administration service |
| P21-09c | BLOCKED on **P20-06** | the facility administration routes (`client-facilities` / `ipm` slugs are not seeded — a gate on an unseeded slug does not compile, A-07), the bound menu ceiling, `my-permissions.facilityBound` |
| P21-09d | TODO | device move, storage-key segment + re-key job, signed-link v3, `recipientsFor`/`emitForRow`, cache keys v2, `facilityClause` + d05 twin, G-14/15/19 |
| P21-09e | BLOCKED (09c, 09d) | A-90 person display, domain routes A-1 … A-8 + remaining self routes with two-facility suites, SSO JIT/SCIM pending, invitation binding, the 30-day deactivation job |

## What was built

| | |
|---|---|
| Context (§ 7.1, AM-2/3) | `TenantContextStore` gains `userId`, `clientFacilityId`, `facilityBound` (optional; absent = unbound). One writer per entry path: `tenantContextMiddleware` (`facilityContextOf(req.user)` — auth, optionalAuth, API keys: unbound) and the socket handshake. `getAuthUserWithTenant` includes `clientFacility (id, status)`, `required: false` |
| Refusals (§ 7.2, AM-1) | `utils/facilityRefusal.util#facilityRefusalOf`: `FACILITY_BINDING_PENDING`, `FACILITY_UNRESOLVED`, `FACILITY_INACTIVE`, `FACILITY_ENDED` — 403 with a **top-level `code`** (`response.util#error` extra); `optionalAuth` treats them as no principal; the socket handshake and re-check refuse them |
| Hooks (§ 7.3 – § 7.5) | `utils/tenantScope.util.ts`: `resolveFacilityScope` (skip / filter / rule / deny), the root predicate forced beside the tenant one, the include walk (deny per include, join type pinned, `through`, nested), count/aggregate/increment, bulk destroy/restore by column, instance destroy/restore, create/bulkCreate stamp-or-refuse, upsert refusal, TRUNCATE; `skipTenantScope` never skips it (FT-30). **AM-6** (hand-off 4): a change of `clientFacilityId` is refused in every context unless `facilityMove`/`facilityBinding` |
| Lists | `constants/facilityAccess.ts`: `FACILITY_READABLE` (ClientFacility own-facility `id`; Session `user_id`, Notification, ConsentRecord, DsarRequest own-user), `FACILITY_SCOPE_SKIPS` (2 reviewed: `user.service#assertIdentityFree`, `gdpr.service#assertEmailFree` — global unique indexes), `FACILITY_ACCESSIBLE_ROUTES` (S-1 verify/logout/logout-all/socket-token/impersonate-exit, S-2 `GET /sessions/mine`, S-5 `GET /notifications` + `PATCH /read-all`, S-6, S-7 profile with `selfParam`, S-8). `types/sequelize.d.ts`: `skipFacilityScope`, `facilityMove`, `facilityBinding` |
| Socket (§ 9.1, AM-19/20) | a bound socket joins `facility_<tenant>_<facility>` + `user_<id>`, never `tenant_<id>`; `scopeDrift` disconnects on a binding change; `kanban:join` refused |
| `/auth/verify` (§ 13.1, AM-26) | `clientFacilityId`, `facilityBound`, `facilityMode` (`single`/`multi`), `scopeFingerprint` = SHA-256 hex of `scopeFingerprintInput` (`scope-fingerprint/v1`, one part per line) |
| Route gate (§ 7.7, AM-12) | `middlewares/facilityRouteGate.middleware.ts`, called from `tenantContextMiddleware`; `utils/routeTable.ts` (`resolveRoute` with router 2's matchers, `registerAppRouteIndex` in `index.ts` after every mount); no index → bound requests refused; unmarked → 403 `FACILITY_ROUTE_REFUSED` |
| Routes | `GET /api/v1/client-facilities/mine` (new router, `self` exemption, `.openapi.ts`); `PUT /api/v1/users/:userId/client-facility` (`auth, denyApiKey, dynamicAccess("users","update",{checkTenant}), rbac([TENANT_ADMIN]), validate(userFacilityBinding, {from: params+body})`) |
| Binding (§ 10.1) | `services/userFacilityBinding.service#setBinding`: switch `FACILITY_BINDING_ENABLED` (`config/facility.ts`, `.env.example`; off → 409); unbound actor; not self (400); super admin target 404; self facility / non-active 409; bound role set 400; unbind needs `roleId`; confirm-unbound; `set_config('callibrator.facility_binding')` (= 0117's `BINDING_SETTING`, pinned by a test); every session revoked; one audit row per affected facility; after commit the permission cache and the user's sockets |
| Admin service (§ 4.4 – § 4.6) | `services/clientFacilityAdmin.service.ts`: `getMine`, `listFacilities`, `getFacility`, `facilityOptions`, `facilityUsers`, `createFacility`, `updateFacility`, `statusRefusal` + `changeFacilityStatus` (leaving active revokes the bound users' sessions), `deleteFacility` (self/referenced → 409 with counts) — every 409 text of § 4.4; contact values never audited |
| Hand-off 1 (G-F1) | `calibrationDevices.service#resolveCreateFacility`: unbound → named facility (404 / 409 ended) or the self facility; bound → own; bulk import → self. Create contract gains optional `clientFacilityId`. **Decision (Am. 4 § 2): the device branch of `facility_insert_default` stays** as the raw-SQL backstop |
| Hand-off 2 (UD-9) | `findSerialHolder(tenant, facility, serial)`; create, update, restore and bulk import check the serial per facility |
| Hand-off 3 (§ 16) | `auditService.logAction` resolves `clientFacilityId` from the resource (one PK read, unscoped, paranoid off) when omitted |
| Hand-off 5 | the 29 `skipTenantScope` sites reviewed — table below; `createSelfFacility`'s two are correct (tenant creation is unmarked; under a bound context the readable rule finds nothing and the create is refused — fail closed) |
| Contracts | `@callibrator/contracts/clientFacilities`: `FACILITY_REFUSAL_CODES`, `SCOPE_LOSS_CODES`, `isScopeLossCode`, `FACILITY_MODES`, `scopeFingerprintInput`, `clientFacilityCreate/Update/StatusChange/ListQuery/IdParams`, `userFacilityBinding`; `createCalibrationDeviceSchema.clientFacilityId` |
| OpenAPI | `clientFacilities.openapi.ts`; `user.openapi` `setUserClientFacility`; `auth.openapi` verify fields; `openapi.json` regenerated (493 operations); frontend `schema.d.ts` regenerated |

## The `skipTenantScope` review (hand-off 5; spec § 7.6)

| Site(s) | Verdict |
|---|---|
| `auth.service` (3: MFA policy, login lookup, password policy), `loginDiscovery` (4), `passkeyLogin`, `rateLimiter.redis`, `signInPolicy` (2), `sso.controller`, `bootstrapCredential` | **unreachable under a bound context** — pre-auth / sign-in, no context |
| `scheduledBackup` (2), `jobMonitor`, `tenantLifecycle` (2), `upstreamFileImport` (2), `upstreamSqlImport` (2), `customDomains` | **unreachable** — system tasks, the platform operator, or unmarked administration |
| `ownSessions` (2), `session.service` (5) | **correct under the facility branch** — `Session` is FACILITY_READABLE by `user_id`; the revocations name the user |
| `certificate.model` (numbering) | **unreachable** — certificate issuing is never marked (Am. 1 § 4 rule 3) |
| `user.service#assertIdentityFree`, `gdpr.service#assertEmailFree` | **needs `skipFacilityScope`** — added (global unique indexes; reachable by a bound user's profile edit / rectification) |
| `clientFacility.service#createSelfFacility` (2) | **correct** — tenant creation is unmarked; fail closed under a bound context |

## Evidence — tests named

New suites (all in `npm run test:coverage`):
- `tests/utils/tenantScope.facility.test.ts` — **37** (G-01, G-03, G-05, G-06: every § 7.3 line, forced predicate, FT-30, deny with skipTenantScope, includes LEFT/INNER/through/nested/separate, count/sum/increment, bulk refusal in every context, row guards). Fail-before: the facility steps removed from `register` → no `client_facility_id` predicate.
- `tests/utils/tenantScope.facilityDeny.test.ts` — **56** (G-02 over the **real** registry: every facility, readable and provider-internal model).
- `tests/middlewares/facilityContext.auth.test.ts` — **9** (G-16: row-only context, codes top-level, optionalAuth, API key).
- `tests/guards/facilityContextSource.guard.test.ts` — **4**; `facilityReadable.guard.test.ts` — **12** (G-12); `skipFacilityScope.guard.test.ts` — **6** (G-13, planted fail-before).
- `tests/config/socket.facilityRooms.test.ts` — **8** (rooms, refusals, scopeDrift, re-check, kanban).
- `tests/services/auth.verify.facility.test.ts` — **6**; `auditFacilityStamp.test.ts` — **4**; `calibrationDevices.facility.p2109.test.ts` — **12**; `clientFacilityAdmin.p2109.test.ts` — **18**.
- `tests/routes/facilityRouteDefault.test.ts` — **5** (G-10 over every route of every module); `tests/middlewares/facilityRouteIndex.parity.test.ts` — **18** (real HTTP through Express 5 over the real mount table, shadowing cases); `tests/guards/facilityAccessibleRoutes.guard.test.ts` — **8** (G-09, planted markers on `POST /api-keys`, `PATCH /users/edit`, a tenant-backup route, certificate approve, the binding route).
- `tests/routes/userFacilityBinding.twoTenant.test.ts` — **20** (`@two-tenant api/user.route.ts PUT /:userId/client-facility`, every § 10.1 rule, nothing written on refusal, the bound admin refused by the gate); `tests/routes/clientFacilities.mine.test.ts` — **3**.
- Contracts: `packages/contracts/test/clientFacilities.p2109.test.ts` — **11**.

Updated (assertion of the new context fields, or the new facility lookup — no behaviour assertion weakened): `tenantContext.test.js`, `config/socket.test.js` (context shape), `auth.service.test.js`, `auth.service.coverage.test.js`, `auth.passwordChange.a123.test.js` (a `ClientFacility.count` double), `calibrationDevices.service.test.js`, `calibrationDevices.audit.a133.test.js` (a `ClientFacility.findOne` double), `calibrationDevices.serial.a92.test.js` (its serial-SELECT filter skips the facility lookup), `unboundedFindAll.d24.test.js` (3 reviewed entries), `fixtures/routeClient.ts` (registers the route index; `routeFile` option); new fixture `fixtures/routeChains.ts`.

## Gates (2026-10-08, quiet tree — the only agent)

- `node scripts/ci/eslint-ratchet.js`: "0 error(s), 0 warning(s); baseline 0"; `npm run lint` exit 0.
- backend `npm run typecheck`: 0 errors; `npm run ratchet`: 695 `.js`, at the floor; `npm run build:dist`: OK (676 TypeScript files; contracts 56); `npm run load:check`: OK in both modes (666 modules; 109 in boot order).
- **`npm run test:coverage -- --ci`: 940 suites passed, 41 skipped, 0 failed; 16,214 tests passed, 338 skipped, 0 failed; 100 / 100 / 100 / 100**, in 356 s (Node 26).
- The 16 new suites alone: **226 tests passed**, 0 failed.
- `npm run openapi:check`: current (493 operations); `npm run openapi:lint`: no new error (0 baselined, 15 warnings).
- contracts: `npm test` 53 suites, 1,205 tests, 100 % (all four); `npm run typecheck` 0; `npm run lint` 0.
- frontend (only `src/api/generated/schema.d.ts` regenerated): `npm run typecheck` 0 errors; `npm test -- --ci` 320 suites, 3,480 tests passed, coverage 94.16 / 85.08 / 90 / 94.8 (gate 90 / 81 / 86 / 91); `npm run api:types:check` current.
- Not run: the live PostgreSQL suites (no migration or trigger changed), the live E2E suite.

## Not done / open

- **`FACILITY_BINDING_ENABLED` must stay off** until P21-09c – e land and the threat model § 11 gate is green (ADR-124 Am. 4, implications).
- P21-09c waits on **P20-06**; P21-09d is next; P21-09e after both.
- The account/tenant `SCOPE_LOSS_CODES` (`ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`) are defined in the contract but sent by P21-03.
- No live PostgreSQL suite was run: no migration or trigger changed. The binding relies on 0117's `users_binding_guard` (`callibrator.facility_binding`, proven by `clientFacilities.p2007.live` "usersBinding"); a live API run of the binding is P21-10's.
- The live E2E suite was not run (no bound account can exist; unbound behaviour is the regression suite's).
