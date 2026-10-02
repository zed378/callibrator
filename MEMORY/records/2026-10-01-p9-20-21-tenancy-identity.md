# 2026-10-01 — P9-20 / P9-21 Tenancy and identity: 19 controllers and 17 routes are TypeScript, the routes documented code-first

**ADR:** ADR-087 **Amendment 26** (placed by this helper at the coordinator's instruction; the text below is what was placed, condensed there) and ADR-103 (P9-25 code-first contract; the two `Permission` / `Success` extensions are listed there too) · **Cards:** P9-20 (controllers), P9-21 (routes), P9-25 (contracts for the 17 routes) · **Tree:** HEAD `fb55605` plus the uncommitted work of many agents. DONE waits on the full gate on a quiet tree, as P9-12 / P9-13 do.

## What changed

| Area | Files |
|---|---|
| Controllers (P9-20), `.js` removed in the same step | `src/controllers/{tenant,tenantLifecycle,tenantHierarchy,tenantBackup,customDomains,featureFlag,networkSecurity,dataRetention,admin,auth,user,userPermission,session,ownSessions,webauthn,oidcProvider,sso,scim,apiKey}.controller.ts` (19) |
| Routes (P9-21), `.js` removed in the same step | `src/routes/api/{tenant,tenantLifecycle,tenantHierarchy,tenantBackup,customDomains,featureFlags,networkSecurity,dataRetention,admin,auth,user,userPermissions,session,webauthn,oidc,scim,apiKeys}.route.ts` (17) |
| Contracts (P9-25), the routes' `@swagger` JSDoc deleted in the same change | `src/routes/api/<the 17>.openapi.ts`; shared `src/docs/openapi/tenantSchemas.ts` (`Tenant`, `TenantAsStored`, `tenantIdParams`) |
| P9-25 infrastructure | `docs/openapi/operation.ts`: `Permission` gains `{ kind: "authenticated", reason }`; `Success` gains `{ status: 204, noContent }` and `{ status: 302, redirect }`. `tests/guards/openapiRoutes.p925.test.ts`: `declaredGate` reads `authenticated` as "no gate factory", plus two tests pinning both directions. `scripts/openapi/build.ts`: one sentence on the new gate in the document's description |
| Generated | `backend/openapi.json` (`npm run openapi:generate`), `frontend/src/api/generated/schema.d.ts` (`npm run api:types`) |
| JSDoc components removed (the id is now code-first) | `docs/components.js`: `Tenant`, `TenantBackup`, `User` (auth's remaining JSDoc `$ref` resolves to the code-first `User`) |
| Type-only | middleware twins `src/middlewares/{auth,dynamicAccess,enforceQuota,abac}.middleware.d.ts` (P9-20); `services/rateLimiter.redis.service.d.ts` (`noteAuthFailure`/`noteAuthSuccess` P9-20; `authPreCheck`, `mfaLoginPreCheck`, `mfaManagePreCheck` P9-21); `utils/upload.util.ts` `UploadOptions.allowedMimes/allowedExtensions` and `types/express.d.ts` `req.allowedMimes/allowedExtensions` → `readonly string[]`; the service actor/input widenings listed in §Amendment text |
| Tests, file names only | `constants/routeGateExemptions.ts` keys `api/{session,auth,tenant,oidc,webauthn,tenantHierarchy,scim}.route.ts`; `routePermissionGuard.p604` lines 430/432; `denyPlatformAuthoring.a127` (apiKeys, webauthn, session ×3, admin, auth); `uploadAfterGate.a78` (user, tenant ×4); `apiKeyAuthorizedWriters.v05` AUTHORIZERS `routes/api/scim.route.ts`; `networkSecurity.selfService.q38` reads the `.ts`; `webauthn.route`, `networkSecurity.route`, `oidc.route`, `session.route` tests require the route extensionless |
| Guard lists, shrink only | `swaggerValidatorAlignment.knownDrift.json`: `POST /api/v1/custom-domains/domains` removed (the drift was the JSDoc's). `openapiRoutes.undocumented.json`: `GET /api/v1/auth/sso/oidc/callback` and `…/{tenantCode}` removed (now documented). `openapi.spectral-baseline.json`: 7 entries removed (tenant-hierarchy tree, scim ×3, oidc ×3), each reported `fixed` by `openapi:lint` |
| New tests | `tests/controllers/controllerPins.p920.test.ts` (7), `tests/controllers/session.createdAt.a334.test.ts` (2) — see P9-20 below |
| Fixed, each as its own change with a fail-before test | A-334 (`session.controller` `createdAt`, no invented `location`); round 2: A-339 (`ownSessions.service` selects/reads the attribute `createdAt`), A-338 (offboard reads `force`) |
| Findings | `TASKS/AUDIT-2026-09-REMEDIATION.md`: A-334 (DONE), **A-338** (offboard `force` unreachable), **A-339** (`/sessions/mine` never answers `createdAt`) |

`backend/.ts-ratchet.json`: the floor was lowered by `npm run ratchet` as the `.js` files went (it reports the new floor; commit it with this change).

## P9-20 — the controllers

Each is `export =` of the original key order, load-time captures kept, `req.user` destructuring text kept (the TypeError messages are the same). Identity: a sampled harness per controller (`p920/ctrl.js`), every one bitten, check counts: customDomains 2802, userPermission 1752, ownSessions 1052, apiKey 1752, admin 1402, featureFlag 2627, dataRetention 3677, networkSecurity 3677, tenantLifecycle 3002, tenantHierarchy 3602, oidcProvider 6252, scim 4202, webauthn 2732, tenantBackup 2882, tenant 9902, user 5762, session 3122, auth 11702, sso 5951. Surface identical 19/19 (oidcProvider's `token` and `userinfo` are newly named functions). 100% coverage under each module's suites (sso with publicAuth's suites included).

**The six gaps** (coordinator decision 1): six behaviours only the identity harness watched — a planted defect left every existing suite green. Each is now pinned in `controllerPins.p920.test.ts`, and each pin was proved by a plant in a scratch mirror (`p920/pinbite.py`: a planted copy mapped in by a scratch jest config; the shared tree untouched): A-79 body logo dropped; A-109 role include LEFT; A-90 session user/role/tenant includes LEFT; A-288 `location` reaches `loginMfa`; backup stats use the PATH tenant and the backup detail's includes are LEFT; SCIM reads in the principal's tenant, never a query value. Control 7/7 pass; every plant fails its pin.

**A-334** (coordinator decision 2), fixed as its own change: `session.controller#sessionView` read `session.created_at` (always undefined: the attribute is `createdAt`) and answered a constant `location: "N/A"` (no such column). Now `createdAt: session.createdAt`, no `location`. `session.createdAt.a334.test.ts` fails 2/2 before, passes after; `session.controller.test.js` asserts no `location`. The frontend `SessionData` type still declares `location` (unused).

## P9-21 — the routes

**Method.** A mechanical first pass (`p920/route2ts.py`: `@swagger` stripped, requires → imports, `express.Router()` → `Router()`, `module.exports` → `export =`), reviewed by hand, typechecked in scratch against the live tree (`p920/stc.sh`), then swapped in with the `.js` deleted in the same step (`p920/swap.sh`). Gate text is byte-identical: `authorizationWiring.util` and `constants/menuPageAccess` quote it, and `effectivePermission.adr102` checks every quote (it caught one: see scim below).

**Conversion rules the routes needed** (beyond Amendment 13):
- A closure defined in the route that calls an imported helper keeps a load-time capture of it (`const isSuperAdmin = loadedIsSuperAdmin`): tenantHierarchy (`isSuperAdmin`), scim (`scopeAllows`, `MENU_SLUGS`, `isSuperAdmin`), auth (`hashedKey`). Without it the compiled closure reads `(0, import_x.f)(…)` at call time — found by the identity harness (tenantHierarchy).
- A module with named exports is imported `import * as` (webauthnCredentials, accessRequest, ssoDomains controllers; session, tenantBackup validators). `sso.controller` (an `export =` object) is also imported `import * as` in auth.route: `authRequestBudget.a291` mocks it with a Proxy that answers `__esModule`, so a default import read `.default` and registered `undefined`.
- A cast that would change quoted gate text moves out of the quoted line (scim: `keyMayUseScim(req)) || isSuperAdmin(req.user)` is quoted by `menuPageAccess`).
- `process.env.MAX_FILE_SIZE` → `env("MAX_FILE_SIZE") as string` (tenant.route), as `upload.util` reads it; `env(name)` is `process.env[name]`.
- Requires that the `.js` made and never used are dropped (tenantHierarchy `addChild`, tenant `validateUuid`); TypeScript would elide them anyway, and the controllers load those modules themselves.
- Imports hoist: auth.route's `auth.controller`, `firstSignIn.controller` and `sso.controller` were required below the `requestBudget(...)` calls and now load before them; none depends on them. Noted in the file header.
- An unused handler parameter kept for source identity takes a reasoned `@ts-expect-error` (scim's shim `res`); `return next()` inside a kept closure takes a reasoned `no-confusing-void-expression` disable.

**(b) Identity, two harnesses, both bitten:**
- `p920/routecmp.js`, the mounted route table: the original `.js` (from the snapshot) against the `.ts`, both loaded in one process sharing every dependency instance; every exported function of `middlewares/`, `utils/`, `validators/` and `services/` is wrapped (the module's exports replaced in `require.cache`) so a factory's product carries its factory and arguments; per layer, in order: kind, path, methods, every handler by reference or (factory, arguments); closures by name and source printed through esbuild. **17/17 identical** (final run: 960 functions wrapped, no module left unwrapped). Two harness defects were found and fixed on the way, and every route was re-run after the fix: `.ts` named exports are non-configurable getters (wrapping in place failed silently — fixed by replacing the exports object), and a module whose first load threw was left unwrapped (its products compared as same-source closures — `requestBudget` plants were MISSED; fixed with a retry-until-no-progress pass, after which they bite).
- `p920/modcmp.js`, the module text: both files printed by esbuild (types stripped), imports, captures, router construction and export removed, compared character for character; the one sanctioned rewrite is `env("X")` ↔ `process.env.X`. **17/17 identical.** It catches what the route table cannot: a change inside a helper a closure calls (scim's `keyMayUseScim`, plant MISSED by routecmp, caught here).
- Plants (`p920/rbite.sh`, in a copy of the original; every one reported DIFFERS): customDomains (gate READ→WRITE, a validateUuid dropped, a write route on the read gate, an argument-only `validateUuid("id")`), apiKeys (`requireFeature` key), userPermissions (`validateUuid` arity), featureFlags (`checkTenant: false`), tenantLifecycle (`superAdminOnly` dropped), dataRetention (purge on the read gate), networkSecurity (`denyApiKey` dropped), webauthn (`validate` source), session (`denyApiKey` dropped), tenantBackup (`abac` action), tenantHierarchy (the inline guard inverted), admin (`validate` dropped), oidc (`dynamicAccess` action), user (upload limit), tenant (`superAdminOnly` dropped), auth (`authPreCheck` key, `requestBudget` name, the `keyOf` closure body); scim (`keyMayUseScim` scope: modcmp).

**The four gates for the isolation-critical routes** (tenant, tenantLifecycle, tenantHierarchy, tenantBackup, auth, user, session, scim, apiKeys):

(a) **Plants in the `.ts`, against the suites that watch the route.** `p920/routebite3.py`: a planted copy of the converted route in a scratch mirror, mapped in by a JS jest config that requires the real one (so `.env` loads); the suites are every test that names the route module or its mount, plus the route guards; per route one control run with no plant; a plant is caught only by a test that fails with it and passes in the control. Results: see §Gate (a) results.

(b) **Identity:** above.

(c) **Isolation suites together:** see §Gate (c).

(d) **Live, over HTTP, on a disposable PostgreSQL 18.6 (`pgvector/pgvector:pg18`, container `p920routes-pg18`) as `callibrator_app`: 57/57** (`p920/live-routes.js`, output `p920/live-routes.out`). A database from `createDisposableDatabase`, `bootSchemaAsApplicationRole`, `migration.service#seedAll`; two tenants, two tenant administrators (HEALTCARE_ADMIN) and a technician in B; the 17 converted routers (asserted to be the `.ts` files) mounted at index.js's mounts with the real auth chain, `notFound` and `errorHandler`; both administrators sign in through the real `POST /api/v1/auth/login`. Checked: sign-in, wrong password 401, `/verify`, unauthenticated 401; tenant `/detail`, `/settings`, `/user-count` own 200 / other 404 (identical to a missing id on `/detail`); `/all` and `/delete` refused (403), B untouched; public branding without a token; lifecycle status, retention policy and backup list own 200 / other 404; lifecycle suspend refused; hierarchy children own 200 / other 404 identical to missing; re-parenting refused, B's parent unchanged; user detail own 200 / other 404 identical to missing; profile edit and password reset of B's user 404, B unchanged; user list holds A only; `/sessions/mine` lists own only; revoking B's session 404 as a missing one, B's session still valid; the platform session list refused; a scim-scoped key minted in A; `GET /api-keys/:id` own 200, B's administrator 404 identical to missing; the A key reads A's user, reading B's user (even naming B) 404, the list holds A only; a tenant administrator without a key refused SCIM 403; an API key (`ApiKey <key>`) minting a key is `denyApiKey`'s 403 and nothing is written; feature flags of B 404; customDomains, webauthn missing ids 404; userPermissions, admin, the operator's network-security and oidc named-tenant routes refused 403; OIDC discovery public; `logout-all` ends the sessions. Each scratch database was dropped by the script. Super-admin flows were not driven live: a platform operator without MFA has an enrolment-only session (P6-07).

## OpenAPI (P9-25)

For each route: a `.openapi.ts` whose request bodies are the schemas the chain or the controller enforces (imported from `validators/` or `@callibrator/contracts`; a body read raw is documented as read, and says so), response schemas read from the services, permission exactly the chain's gate, `audited` from the audit writes actually present. `npm run openapi:generate`, `openapi:check` (current), `openapi:lint` (no new error; the baseline only shrank), `cd frontend && npm run api:types` and `api:types:check`. As built, documented rather than changed: the access-request list's `meta` (counts, no `totalPages`) and the user list's `meta` (`statusCounts`, `hasNextPage`) as whole bodies; SCIM's own 403 shape; the OIDC token/userinfo OAuth error shape; `oidc`'s `getAuthRequest` 404 answered through `success()` (`success: true, status: 404`); user and permission controllers' own 400s without `data`; `tenant.route`'s `PATCH /settings` writing every body key, `tenantId` included; offboard reading no body (A-338); `/sessions/mine` never answering `createdAt` (A-339). `oidc.route` is mounted twice (`/api/v1/oidc` and `/oidc`); the contract documents the first and the `/oidc` copies stay on the pinned list.

`authenticated` (new `Permission` kind) is declared on routes that carry `auth` and no gate factory — the caller's own resources (auth, webauthn, `/sessions/mine`, tenantHierarchy reads guarded by the in-file `ownTenantOnly`, the OIDC consent pair) and SCIM (scope checked in the router's `requireApiKeyOrAdmin`). The p925 guard reads it as "no gate": declared on a gated chain it is a mismatch, declared on a public chain the security check refuses it (both pinned).

## Gates run (on the shared tree, so other lanes' work is in them)

- `npm run typecheck`: clean. `npm run ratchet`: the floor lowered, no new `.js`. `npx eslint` on every file written: 0 problems. `TSX_DISABLE_CACHE=1 npm run load:check` (dist) and `-- --src`: OK (dist flaked once and passed on rerun, as before).
- Guards: `openapiRoutes.p925`, `swaggerValidatorAlignment.p608`, `routePermissionGuard.p604`, `twoTenantRoutes.guard`, `apiKeyAuditPrincipal.a282`, `superAdminPredicate.n01`, `dynamicAccessSlugs.a07`, `effectivePermission.adr102`, `declarationDrift.p912`, `authorizationWiring` — pass, apart from failures traced to other lanes (below).
- Each route's suites with the route guards after its swap (e.g. customDomains 146/146 with 100% coverage of the route and its contract; tenant 447/447; scim 274/274; oidc 232/232; auth 271/271).

**Not mine, seen during the run (A/B'd, reported, not fixed):** `build:dist` refused while `middlewares/enforceQuota.middleware` existed as both `.js` and `.ts` (another lane mid-conversion); `apiKeyAuthorizedWriters.v05` red while `dynamicAccess.middleware` existed as both (P9-19 lane), with `zzp919*.dynamicAccess.middleware` scratch files in `src/middlewares`; p604 briefly red on billing's exemption key; p925 / a127 briefly red on eSignature's in-flight conversion. My `.d.ts` twins for auth / dynamicAccess / enforceQuota / abac must be deleted when those `.js` files go.

## Gate (a) results

17 plants across the nine isolation-critical routes; every control run had 0 failures.

**First run: 13 of 17 caught.** Caught, with the test that caught each:
- tenant `/delete` without `superAdminOnly`: `tenant.platform.a76` (2).
- tenantLifecycle status without `checkTenant`: `readGates.a155`.
- tenantLifecycle suspend without `superAdminOnly`: `twoTenantRoutes.guard` (structural only).
- tenantHierarchy children without `ownTenantOnly`: `tenantHierarchy.guards` (6).
- tenantHierarchy guard inverted: `tenantHierarchy.guards` (18).
- auth `logout-all` without `auth`: `routePermissionGuard.p604` (structural only).
- auth `/login` without its request budget: `authRequestBudget.a291`.
- user profile without `checkTenant`: `user.profile.a63` (2).
- user MFA reset without TENANT_ADMIN: `user.mfaReset.a141`.
- session `GET /:id` without `rbac`: `twoTenantRoutes.guard` (structural only).
- scim, any API key passes: `scim.route` (5).
- scim write scope read as read: `scim.route`.
- apiKeys minting without `denyApiKey`: `routeGuards.a02.behaviour.v08`.

**Missed: 4.** Each is now pinned in `tests/routes/routeGatePins.p921.test.ts` (4 tests, written out by hand, the real gate factories recorded as the routes load):
- tenant `POST /detail` without `checkTenant`. Unwatched, this would let a tenant administrator read another tenant's row by body id; the two-tenant guard sees path parameters only.
- tenantBackup `GET /:tenantId/backups/:backupId` without `checkTenant`.
- session `/mine` without `denyApiKey`.
- apiKeys create without `requireFeature("api_keys")`.

**Rerun of the four routes with the pins: 7 of 7 caught**, each miss by its pin, so 17 of 17 overall (`p920/out/routebite3.log`, `p920/out/routebite3-pins.log`).

The first two attempts at this gate were invalid and are not counted:
- The scratch JSON config did not load `.env`, so the route suites crashed on the JWT secret.
- Failing tests were then parsed from console text, which missed every one (`✕` was lost in the encoding).

Both are fixed in `routebite3.py`: a JS config that requires the real one, and results read from `jest --json`.

## Gate (c)

Isolation and route suites together, **303 suites / 4,710 tests passed** (1 suite and 7 tests skipped, as on the base).
The run covered:
- every `routes/`, `guards/` and `controllers/` suite;
- every two-tenant suite;
- `tenantScope`, the tenant hooks, `includeRequired` and `includes.a*`;
- `crossTenant`, `tenantContext`, `jobContext` and `rawSqlTenantPredicate`;
- `systemActors` and `auditInTransaction`.

## Final gates (after the last change)

- `npm run typecheck`: clean.
- `npm run ratchet`: floor lowered (it reports 779 → 770 at the end, other lanes' conversions included).
- `npm run build:dist`: OK (519 TS compiled).
- `load:check` dist and `--src`: OK.
- `openapi:check`: current. `openapi:lint`: no new error, 3 baselined.
- Frontend: `api:types` regenerated, `api:types:check` OK, `npm run typecheck` clean.


## Round 2 (coordinator, 2026-10-01): A-339, A-338, the amendment, super-admin flows live

**A-339 fixed, as its own change.** In `services/ownSessions.service.ts`, `LIST_ATTRIBUTES` now selects the attribute `createdAt` (the column is still created_at) and `toView` reads `row.createdAt`.
- Test: `tests/services/ownSessions.createdAt.a339.test.ts` spies on the REAL Session model's `findAll` and builds the rows with `bulkBuild(…, { raw: true })`, keyed by exactly the attributes the service requests, which is what Sequelize does with a real query. It failed before (`Received: undefined`) and passes after.
- The Q-08 suite's mock row carries `createdAt`. The service is at 100% under its suites.
- `session.openapi.ts` now documents `createdAt` as always present.

**A-338 fixed; the decision was to implement it as specified, not to remove it.**
- `force` is defined in three places: the module reference (tenant lifecycle §8 and §11, "idempotent unless `force`"), the service, and the frontend client (`tenantLifecycleService.offboard(tenantId, force)`). Only the controller dropped it.
- A forced re-offboard skips no safety step. It restarts the retention window, with a later `offboardedAt` and `offboardRetentionExpiresAt`, never an earlier one. The hard delete still refuses during retention and while retained records remain (D-23).
- It is super admin only (the route's `superAdminOnly`), and the service audits it twice, under PLATFORM and under the tenant, with `changes.force: true`.
- No ADR: the code now matches the specification.
- Change: `@callibrator/contracts/tenantLifecycle` gains `offboardTenantSchema` (`tenantId`, `force: booleanish().optional()`), re-exported by `validators/tenantLifecycle.validator`. The controller validates `withPathParams(params, body)` against it.
- Test: `tests/controllers/tenantLifecycle.offboardForce.a338.test.ts`. 3 of 4 failed before; 4/4 pass after. It covers `force: true`, the string `"true"`, no body or `false`, and a non-boolean, which is a 400 with nothing offboarded.
- The controller is at 100%. `tenantLifecycle.openapi.ts` documents the body.

**ADR-087 Amendment 26 placed** in `MEMORY/DECISIONS.md`. The status line now covers Amendments 1–26.

**Super-admin flows live: 38/38** (`p920/live-superadmin.js`, output `p920/live-superadmin.out`). The run used a disposable PostgreSQL 18.6, container `p920routes-pg18`, removed by name afterwards, with every docker call under `timeout`; the scratch database was dropped.

The operator is a SUPER_ADMIN in the platform tenant. Sign-in and MFA:
- the first sign-in is enrolment-only (P6-07), and that session reaches no tenant route (403);
- `/auth/mfa/setup` answers a secret, and `/auth/mfa/verify` with a computed RFC 6238 code enables MFA;
- the next sign-in asks for MFA, and `/auth/mfa/login` signs in;
- a replayed TOTP step is refused with a 401.

Tenant flows as the operator:
- **Create:** 201 and audited; a duplicate code is 409; the list shows every tenant.
- **Suspend, resume, grace period:** suspend, then resume; a grace period on an active tenant is a 409 that explains the state; on a suspended tenant it is set.
- **Offboard:** offboarding sets status `deleted` and a retention deadline. Repeating it without `force` changes nothing and writes no audit row.
- **A-338 live:** with `force: true` the retention deadline moves later and the change is audited with `force: true` under PLATFORM and B. A non-boolean `force` is a 400, and a tenant administrator's forced offboard is a 403.
- **Cancel:** cancelling the offboarding makes B active again, and the status read confirms it.
- **Hierarchy:** a child is added under A (201) and listed, moved under B, refused as its own parent (409), and made a root.
- **Backup:** created (201) and completed with a file, listed, downloaded as a ZIP, then restored. The restore puts the archived user field back and is audited in A. The backup file was deleted by the script.
- **A-339 live:** `/sessions/mine` answers an ISO `createdAt` for every session.

**The tenant-admin live run was repeated after both fixes: 57/57.**

**Gates after round 2:**
- Suites: tenantLifecycle, ownSessions, session, every guard, p604, p608, adr102 and the route pins — 405/405.
- `build:dist`, and `load:check` in dist and src: OK. `openapi:check`: current. eslint on every touched file: 0 problems.
- Frontend: `api:types` regenerated and `api:types:check` OK.
- `npm run typecheck`: my files are clean. It reports errors in `services/emailQueue.service.ts`, which I did not touch (another lane's in-flight work).
- The four middleware twins and their `.js` files are gone (P9-19 lane), as the amendment states.

## Amendment text (placed as ADR-087 Amendment 26, condensed)

**Amendment 26 (2026-10-01) — P9-20 / P9-21, tenancy and identity: controllers and routes.**

1. The Amendment 13 pattern holds for controllers and routes. For a route module additionally: a closure the route defines that calls an imported helper keeps a load-time capture of that helper (`import { f as loadedF }`, `const f = loadedF`), so the compiled closure is the `.js`'s; gate text that another module quotes (`menuPageAccess`, `authorizationWiring`) stays byte-identical, a cast moving out of the quoted expression; a named-export module is imported `import * as`, and an `export =` module that a test replaces with a Proxy is too.
2. A route conversion is proved by two harnesses together — the mounted route table (every factory product compared by factory and arguments, with no dependency module left unwrapped) and the module text (both sides printed by esbuild) — and each is bitten. Neither alone is enough: the table cannot see a helper a closure calls, and the text cannot see a factory's behaviour.
3. The isolation-critical routes take the four gates: plants in the `.ts` caught by the suites that watch the route (a control run first; caught means a test that passes in the control fails with the plant), identity, the isolation suites together, and a live run over HTTP as `callibrator_app` with two tenants.
4. Type-only changes made for the conversion, none emitting code:
   - twins `middlewares/{auth,dynamicAccess,enforceQuota,abac}.middleware.d.ts` (delete each when its `.js` converts);
   - `services/rateLimiter.redis.service.d.ts`: `noteAuthFailure`, `noteAuthSuccess`, `authPreCheck`, `mfaLoginPreCheck`, `mfaManagePreCheck` typed; `services/audit.service.d.ts` `userAgent` admits `string | readonly string[] | null | undefined`;
   - `utils/upload.util.ts` `UploadOptions.allowedMimes/allowedExtensions` and `types/express.d.ts` `req.allowedMimes/allowedExtensions` are `readonly string[]`;
   - `utils/response.util.ts` `ServiceResult.success/message` admit `undefined`;
   - actor and input interfaces widened to what the controllers pass: customDomains `DomainActor`, `DomainInput.domain`; userPermission `PermissionActor`, `grantedBy`; ownSessions `RevokeActor`; apiKey `KeyActor`, `CreateKeyInput` (`name` optional, `expiresAt`), `listApiKeys` page/limit; admin `AdminActor`; dataRetention `RetentionActor`, `actorEntry`, `enabledBy`/`disabledBy`, `ids: string[]`; tenantLifecycle `LifecycleActor`; tenantHierarchy `HierarchyActor`, `moveTenant`/`updateTenantParent` `newParentId: TenantId | null | undefined`, `SubOrganizationInput.code`; networkSecurity `GeofenceInput.radiusKm`, `checkGeofence`/`evaluateLoginSecurity` coordinates `number | undefined` (a missing one is NaN, outside the fence: fail-closed, as built); oidcProvider `OidcActor.userAgent` and the token inputs; scim `ScimUserInput`, `ScimGroupInput`; webauthn `ReauthProof`; tenantBackup `CreateBackupInput`, `models/tenantBackup.model.ts` `TenantBackupListOptions`; tenant.service `RequestActor`, the fetch query, `createTenant`/`updateTenant`/`deleteTenant`/`updateTenantSettings` actor and id parameters; tenantUpload `updateTenantLogo`/`removeTenantLogo`/`changeLogo`; user.service `FetchUsersQuery`; auth.service `passwordManagedBy` and `LoginInput.ip/userAgent`.
5. P9-25 (ADR-103) gains, under the same review: `Permission.kind: "authenticated"` (a route with `auth` and no gate factory, its reason published as `x-permission.note`; the p925 guard holds it to the chain), and `Success` variants for a 204 with no body and a 302 redirect.
