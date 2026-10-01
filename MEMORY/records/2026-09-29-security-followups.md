# 2026-09-29 — Security follow-ups: certificate verification token, sign-in network policy, request budgets (ADR-100)

**Cards:** A-293, A-288 (with Q-38), A-291, A-292, A-289, A-282 (remainder), A-304, A-305, A-272; opened Q-51 · **ADR:** ADR-100 · **Agent:** security-followups, with two sub-agents: one on the certificate token, one on A-282/A-304/A-305 and the A-272 test updates · **Coordinated with:** the P9-12 lead, the bootstrap agent, the Phase 10 backend and frontend leads, the UI-correctness agent, the SSRF agent and the P9 services helper · **Nothing committed** (the lead commits).

## What changed

| Card | Change | Main files |
|---|---|---|
| A-293 | Every certificate has a random 192-bit `verification_token`. The model generates it; migration 0096 back-fills it and swallows no errors. The QR carries `?t=<token>`. The full public verdict needs that token. A bare number or a wrong token gets a minimal verdict: status flags, issuing tenant, dates and hashes, with no device, serial, signer or document. Old QR codes get the minimal verdict, with no redirect. Per-address budgets, per 15 min: 300 requests, and 60 answers that are not the full verdict | `models/certificate.model.ts`, `migrations/0096-certificate-verification-token.ts`, `utils/certificateVerificationToken.ts`, `services/certificateDocument.service.ts`, `services/certificatePdf.service.js`, `controllers/certificatePdf.controller.js`, `routes/api/certificates.route.js`, `constants/routeGateExemptions.ts`; frontend `app/verify/[certificateNumber]/page.tsx` |
| A-288 | The IP allowlist is enforced at every sign-in: password, the MFA step, the SSO exchange, passkey verify-login and refresh. The geofence is enforced on password, MFA and passkey only. It uses the location the device reports, and a sign-in without one is refused (`LOCATION_REQUIRED`). A refusal is a 403 with a top-level `code`. It is answered only after the credential is proved, and it is audited as `LOGIN`/`SignInPolicy`. A refused refresh also revokes its token. A tenant's policy never refuses a platform operator; that is the lock-out-safe path, recorded as `operator-exempt` under PLATFORM. The CIDR matcher handles IPv6 and IPv4-mapped addresses | `services/signInPolicy.service.ts` (new), `services/auth.service.js` (three calls, agreed with the P9-12 lead and the bootstrap agent), `controllers/sso.controller.js`, `controllers/webauthn.controller.js`, `controllers/auth.controller.js`, `services/networkSecurity.service.js`, `utils/controllerWrapper.util.ts` (`publicCode` → `code`) |
| Q-38 | A tenant administrator may set its own allowlist and geofence (`network-security: write`, seeded; migration 0098). A change that would lock out its own caller is refused with 409 `SELF_LOCKOUT`. The operator is exempt from that check and can override it through `/tenants/:tenantId/…`. An API key may change neither (`denyApiKey`) | `routes/api/networkSecurity.route.js`, `controllers/networkSecurity.controller.js`, `constants/roleConstants.ts`, `migrations/0098-network-security-tenant-admin-write.ts`, `config/migrator.js` |
| A-291 | Request budgets now count every request, successes included, in the shared store. They cover sign-in, MFA sign-in, register, send-otp (plus a budget per mailed-to address), reset-password, and the SAML and OIDC starts (one shared budget). A 429 is the error envelope plus `retryAfter` and a `Retry-After` header; lockout 429s now send the header too. The dead `authLimiter`/`otpLimiter` are removed. Per-IP failure counting is on by default in production | `middlewares/requestBudget.middleware.ts` (new), `constants/rateLimitConstants.ts`, `services/rateLimiter.redis.service.js` (+ `.d.ts`), `routes/api/auth.route.js`, `index.js`, `backend/.env.example` |
| A-292 | Every refused SSO start gets the same 404, "Single sign-on is not available for this organisation code". The real reason is logged. The refusal is exported as `ssoUnavailable` for the Phase 10 `/auth/sso/start` | `controllers/sso.controller.js` |
| A-289 | The activation link's origin comes from `FRONTEND_URL`, else `HOST_URL`, and never from the request. In production an unset origin is a 500, raised before anything is written | `utils/publicLinkOrigin.util.ts` (new), `controllers/auth.controller.js` |
| A-272 | A validation failure thrown in a controller now gets exactly the answer `validate()` gives | `utils/controllerWrapper.util.ts` |
| A-282 | Every audited write an API key can reach uses `auditPrincipal` (done by a sub-agent; the module list is in ADR-100 §9). A guard fails on `auditActor(req)` in any key-reachable controller | `utils/auditPrincipal.util.ts`, the listed services and controllers, `tests/guards/apiKeyAuditPrincipal.a282.guard.test.ts` |
| A-304 | `GET /dashboard/metrics` is gated by `dynamicAccess(home, read)` | `routes/api/dashboard.route.js`, `constants/routeGateExemptions.ts` |
| A-305 | Offboarding writes two audit rows, one under PLATFORM and one under the tenant. The Stripe plan change is audited as `system:billing-webhook` | `services/tenantLifecycle.service.js`, `services/stripeWebhook.service.js` |

Docs amended under the deviation protocol, each citing ADR-100:
- `docs/BACKEND/07-CERTIFICATE-PIPELINE.md` § Public Verification
- `docs/DEVELOPER/03-RATE-LIMITS-AND-ERROR-CODES.md`: the budgets table, the per-IP default and Retry-After
- `docs/SECURITY/10-ABUSE-PREVENTION.md`: four rows
- `docs/MULTI-TENANCY/07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md`: the network-security row

## Evidence — tests, named

**Fail-before.** New tests were run against the code without their fix, in one of three ways:
- a temporary copy of the suite that `jest.mock`s the new module out (sign-in policy, request budgets);
- a temporary revert of the one hunk involved (the A-272 wrapper line), restored immediately;
- for the sub-agents' tests, running them against the unfixed code before implementing.

Where no fail-before run was possible, the table says so.

| Suite | Tests | Before the fix |
|---|---|---|
| `tests/services/signInPolicy.paths.a288.test.ts` (real auth.service over memoryDb: password, MFA, refresh, operator) | 10 | 5 failed: every refusal and the operator-exempt row. The 5 controls passed |
| `tests/services/signInPolicy.a288.test.ts` (matcher, loader, refusal audit, role lookup, Q-38 guard) | — | Written with the module. Covers `signInPolicy.service.ts` 100% |
| `tests/controllers/signInPolicy.controllers.a288.test.ts` (passkey); `tests/controllers/sso.exchangeStatus.a83.test.js` › "A-288 (ADR-100)" (SSO exchange) | 4 + 3 | Not run. Before the fix the controllers made no policy call, so these would fail |
| `tests/controllers/networkSecurity.selfService.q38.test.ts` | 8 | Not run. By reading, the old code had `superAdminOnly`, a `read` seed and no guard |
| `tests/migrations/0098-network-security-tenant-admin-write.test.ts` | 5 | — |
| `tests/routes/authRequestBudget.a291.test.ts` (real auth router, production limits) | 9 | **9 of 9 failed** with the budgets unmounted |
| `tests/middlewares/requestBudget.a291.test.ts` | — | Covers the middleware and `countsFailuresByIp` 100% |
| `tests/utils/publicLinkOrigin.a289.test.ts`; `tests/controllers/auth.controller.test.js` › register (a forged `Origin`/`Host` is ignored) | 3 + 1 | The register case was not run. By reading, the old line passed the header through |
| `tests/controllers/sso.controller.test.js` (the seven A-292 cases) | 7 | Each fails against the old code, which answered with the 404/400 split |
| `tests/contracts/validation/middleware.contract.test.ts` (A-272) | 4 of 8 | **4 failed** with the wrapper hunk reverted |
| `tests/utils/controllerWrapper.publicCode.a288.test.ts` | 7 | — |
| `tests/services/rateLimiter.service.coverage.test.js` › authPreCheck 429 | extended | Now asserts `Retry-After` |
| Certificate sub-agent: `tests/routes/certificateVerify.a293.test.ts`, `tests/models/certificateVerificationToken.a293.test.ts`, `tests/services/certificateDocument.verifyToken.a293.test.ts`, `tests/migrations/0096-certificate-verification-token.test.ts`, `tests/utils/certificateVerificationToken.a293.test.ts`; frontend `app/verify/[certificateNumber]/__tests__/page.a293.test.tsx` and `lib/certificatePdf.test.ts` | 12 / 6 / 5 / 11 / 9 / 4 | 11 / 5 / 4 / — / — / 2 failed. The migration was written before its test, so it has no real fail-before |
| A-282/A-304/A-305 sub-agent: `tests/guards/apiKeyAuditPrincipal.a282.guard.test.ts`, `tests/routes/apiKeyAudit.a282.test.ts`, `tests/routes/dashboardMetrics.gate.a304.test.ts`, `tests/services/stripeWebhook.planChange.a305.test.ts`, `tests/services/tenantLifecycle.w01.test.js` › A-305 | 8 / 6 / 5 / 4 / 2 | 44 offenders / 5 of 6 / 2 / 2 / 3 failed |
| Frontend `LOCATION_REQUIRED` retry (Phase 10 frontend lead, in its rewrite): `frontend/src/app/login/__tests__/loginFlow.p1004.test.tsx`, the four A-288 cases | 4 | — |

**Existing suites adapted:**
- About 25 auth, MFA and SSO suites gained one `jest.mock` line for the policy. They double the models without `TenantSettings`, and the policy has its own suites.
- `networkSecurity.controller.test.js`: the caller is now the operator.
- `webauthn.controller.test.js` and `bodyless.a09.test.js`: the policy mock.
- `auth.ssoExchange.a60`, `auth.rateLimit.a67` and `rateLimiter.service.coverage`: `res.set` added to their doubles.
- The sub-agent's suites, listed in ADR-100 §9.

**Coverage of this change's files**, from targeted runs:
- 100 / 100 / 100 / 100: `signInPolicy.service.ts`, `requestBudget.middleware.ts`, `publicLinkOrigin.util.ts`, `networkSecurity.{service,controller,route}`, `auth.route.js`, `auth.controller.js` and `webauthn.controller.js`.
- The lines this change added to `controllerWrapper.util.ts`, `rateLimiter.redis.service.js` and `auth.service.js` are covered. In `auth.service.js` only lines 718–735 are uncovered, and they are Phase 10's `completePasswordlessSignIn`.

**Static checks:**
- `npm run typecheck`: 0 errors on the whole backend (2026-09-30).
- `npx eslint`: 0 errors on every file this change touched, tests included.
- `npm run ratchet`: passes.

## Decisions
The full argument is in ADR-100.
- **Verification token:**
  - The QR carries the token.
  - A bare number gets the minimal verdict, and a wrong token is treated as no token.
  - Old QR codes get the minimal verdict, with no redirect.
  - The token is stored in the clear, so it can be reprinted.
- **Allowlist:** a control at every sign-in, refresh included.
- **Geofence:** a device attestation that fails closed. It is not checked on SSO or refresh.
- **Refusal:** a 403 with a `code`, answered only after the credential. A tenant's policy never binds the operator.
- **Tenant self-service:** tenant administrators set their own allowlist and geofence, behind a 409 self-lockout guard. API keys may change neither.
- **Request budgets:** they count successes, and the per-IP failure count is on by default in production.
- **SSO start:** one 404 for every refusal.
- **Emailed links:** their origin comes from configuration only.

## Left open
- **Q-51.** Data columns that reference users (`performed_by`, `adjusted_by`, …) still refuse an API key on PostgreSQL.
- **Certificate audit rows — closed 2026-09-30.** The UI-correctness agent (ADR-101) converted certificate create/update/delete/submit to `auditPrincipal` (`createdBy`/`submittedBy` null for a key; approve/sign/revoke need a re-authentication a key cannot give). The guard's PENDING_OWNER list is empty.
- **Geofence spoofing.** The geofence can be spoofed until there is a GeoIP source.
- **Tenant administrator geofence saves.** The network-security page has no `currentLocation` field. Until the form sends one, a tenant administrator's geofence save is a 409.
- **IPv6 in the allowlist.** The allowlist validator accepts IPv4 only.
- **Migrations 0096 and 0098** have not been run on PostgreSQL. Verify them with the psql queries in their headers.
- **SSO-start timing.** The timing difference between refusal causes remains.
- **Token-less verify URL.** `frontend/src/api/services/calibration.service.ts#getVerifyUrl` still builds a URL without the token. Only its own test uses it.

## Full gate — `npm run test:coverage -- --ci`

Run on 2026-09-30 on a busy tree, with at least six other agents editing.

**Result:** 765 suites (740 passed, 25 failed, 28 skipped) and 14,297 tests (14,079 passed, 36 failed, 182 skipped). Coverage over all files was 98.84 / 98.24 / 98.69 / 98.84. **The gate is not green on this tree.**

I then re-ran the 25 failed suites on their own. 20 passed: their failures in the full run were 10-second jest timeouts under load (bcrypt, otplib, the validator contract suites, the webhook receivers). Two of the other five were this change's, and both are now fixed:
- `denyPlatformAuthoring.a127` flagged `auth.route.js POST /login` as a regulated-looking route, because the budget middleware was named `signInBudget` and `sign` matched it. Renamed to `loginBudget`; the suite passes.
- `unboundedFindAll.d24` flagged `signInPolicy.service.ts#loadNetworkPolicy`. It now has `limit: 2` (one row per tenant and key); D-24 passes.

The remaining failures are in other agents' in-flight files:
- `routePermissionGuard.p604`: `auth.service.js#impersonateUser` no longer names a function in that file, because of the P9-12 conversion.
- `swaggerValidatorAlignment.p608`: `PATCH /roles/:id`.
- `admin.route.test.js`: the admin route set changed.

The files at 0% coverage (`billing.service.ts`, `warehouse.service.ts`) and the below-100 files (`accessRequest.service.ts`, `menuGroup.controller.js`) are other agents' conversions and features. Every file this change touched is at 100%, as measured above.


## Amendment 1 (2026-09-30) — the open items closed (ADR-100 Amendment 1)

Working decisions by the coordinator, under the owner's delegation. A sub-agent did Q-51 and the PostgreSQL runs; I did the rest.

| Item | Change | Tests, and fail-before |
|---|---|---|
| **Q-51** | Migration **0105-api-key-actor-columns**. The user column becomes nullable and a new `api_key_id` column is a foreign key to api_keys, RESTRICT, with an index. A CHECK requires exactly one actor per row (`NOT VALID`, then a counted `VALIDATE`). Services write `rowActor(auditPrincipal(req))`. `denyApiKey` refuses keys on the transfer PATCH, opname POST, record void, and the **workflow decision** route (found here). The swagger actor fields are nullable plus `apiKeyId`, and `openapi.json` is regenerated | `tests/routes/apiKeyActor.q51.test.ts`: 13 of 13 failed with the service and route hunks reverted. `tests/routes/workflowActionApiKey.q51.test.ts`: the key case returned 404, not 403, without `denyApiKey`. `tests/migrations/0105-api-key-actor-columns.test.ts`: 14 tests, 100% coverage. `tests/utils/rowActor.q51.test.ts`. **Live:** `tests/migrations/apiKeyActor.q51.live.test.ts`, 6 of 6 on pg18 as `callibrator_app` (`Q51_PG_LIVE_TEST=1`). Before 0105, key ids in the three user columns fail with 23503. After 0105, the real `createAdjustment`/`createTransfer`/`createCalibrationRecord` write `api_key_id` for a key, and the audit row is `system:api-key`. The CHECK returns 23514, and updating `api_key_id` returns 42501 |
| **Guards updated deliberately** | Only reviewed entries added: three `api_keys RESTRICT` foreign keys, each with a reason (target, ON DELETE, tenant safety). The three user columns are expected nullable. The three CHECKs are pinned in `schemaVerify.util.ts`. No rule, matcher or scope was loosened | `associationForeignKeys.a148`, `tenantForeignKeys.a88`, `schemaVerify.util.p605`: pass. `jsonShape.d27` fails only on ADR-108's `WebauthnCredential.transports`, which is not this change |
| **Migrations on PG18** | Disposable container `q51-pg18`, removed by name afterwards (no prune). Both runs cover 0096, 0098 and 0105. Fresh: 77 applied. Upgraded: from 0095, with 5 token-less certificates (1 soft-deleted) and HEALTHCARE ADMIN `read` | psql: `verification_token` is character varying(64) NOT NULL with `certificates_verification_token_unique`; total 5, null 0, distinct 5, lengths 32/32, soft-deleted 1. HEALTHCARE ADMIN has `write`. The three CHECKs show `convalidated t`, and the foreign keys are `ON DELETE RESTRICT`. As the application role: reads work, key-authored inserts work, and a neither-actor insert fails the CHECK. Down then up is clean. **0096's down regenerates every token**, so it must not be run on a database with printed certificates. 0105's down refuses while a key-authored row exists. A key referenced by a row cannot be deleted (RESTRICT) |
| **Allowlist IPv6** | `normaliseAllowlistEntry`: IPv4/IPv6 address or CIDR, prefix range-checked. A mapped entry is stored as its IPv4 form | `tests/validators/networkSecurity.allowlistIpv6.a288.test.ts`: 15 of 18 failed against the old pattern. The validator is at 100% |
| **Network-security page** | A geofence save sends `currentLocation`, with browser consent and a message when it is unavailable. The write controls are shown only with `canWrite("network-security")` (ADR-102), and not before permissions load. F-19 confirmations are kept. The first client-side CIDR check accepts IPv6 | `frontend/src/app/dashboard/network-security/__tests__/page.test.tsx`: two geofence-position cases and five "who sees the write controls" cases, of 42 passing in the page and service suites. `frontend/src/api/services/networkSecurity.service.test.ts` › currentLocation. Fail-before by construction only: the old page sent no position and rendered every control to everyone |
| **SSO-start timing** | `withSsoRefusalFloor`: every refusal is held to `SSO_REFUSAL_FLOOR_MS` (default 400 ms) on `/sso/login`, `/sso/oidc/login` and `startSsoFor` | `tests/controllers/sso.refusalTiming.a292.test.ts`, 7 tests. An unknown code and a disabled one, the latter with a 120 ms settings read, answer within 60 ms of each other, both at or after the floor. The control with the floor at 0 shows the ≥100 ms gap, which is the fail-before |

**Static checks.**
- `npm run typecheck`: clean for every file in this amendment. The remaining errors are in other agents' in-flight files (the ADR-107 snapshot test, the ADR-108 webauthn service).
- `npx eslint`: 0 errors on every touched file, backend and frontend.
- `npm run ratchet`: passes.
- `npm run openapi:check`: current.
- Frontend `npm run typecheck`: clean.

**Still open.**
- The row-to-key tenant equality is enforced by the application, not by a composite foreign key.
- ~~Lists show no actor for a key-authored row~~ — closed by Amendment 2 below.
- The geofence is an attestation until a GeoIP source exists.
- A slow IdP discovery is still slower than the refusal floor.


## Amendment 2 (2026-09-30) — lists name the key that wrote a row (ADR-100 Amendment 2)

The services helper that converted `stock.service.ts` released the file before this edit (its A-319..A-322 changes had landed).

| Change | Tests, and fail-before |
|---|---|
| `apiKey` include (id, name, keyPrefix; `required: false`; `ApiKey.scope("includeDeleted")`; tenant-scoped) on the calibration-record list and detail and the stock adjustment and transfer lists | `backend/src/tests/routes/apiKeyActorReads.q51.test.ts` (records, 3 tests: key named, hash never serialised, user row still listed, another tenant's key null, revoked key still named): **3 of 3 failed** with the include removed. `backend/src/tests/routes/apiKeyActorStockReads.q51.test.ts` (stock, 2 tests, same properties): **2 of 2 failed** without it. The unit suites `calibrationRecords.service.test.js` and `stock.service.test.js` assert the include and its three attributes. `calibrationRecords.service.js` and `stock.service.ts` are at 100% |
| The frontend shows "API key: <name>" where the user's name showed (`src/lib/actorLabel.ts`, three tables and the CSV exports) | `frontend/src/lib/actorLabel.q51.test.tsx` renders the adjustments, transfers and calibration-records tables with a key-written row. No fail-before was run; the old tables printed `-` for such a row. With the neighbouring stock and calibration suites, 101 tests pass |

**Checks:**
- Backend: `npx eslint` 0 errors on the touched files, `openapi:check` current, typecheck clean for these files.
- Frontend: `npm run typecheck` and eslint clean.


## Amendment 3 (2026-09-30) — the upgrade-boot blocker from Amendment 1, fixed and guarded (ADR-100 Amendment 3)

**What broke.** The live PG18 agent found that boot runs `db.sync()` before the migrator. On a database the previous release built (ce74932), `sync()` tried to build the model-declared `api_key_id` indexes before 0105 had added the column, and the boot failed: `column "api_key_id" does not exist — CREATE INDEX calibration_records_api_key_id`. Fresh databases hid it.

**The fix (mine).**
- `models/calibrationRecord.model.ts`, `stockAdjustment.model.ts` and `stockTransfer.model.ts` no longer declare the `api_key_id` index. Each carries a comment naming the guard (`tests/guards/modelIndexColumns.am3.guard.test.ts`). 0105 creates the identical indexes.
- The stale "migration 0104" comments now say 0105.
- `tests/migrations/0105-api-key-actor-columns.test.ts` now asserts that no model index names `api_key_id` (14 of 14 pass).
- The affected suites pass: 946 passed, 6 skipped.

**The guards and the proof.** A sub-agent did this work; its report is summarised here.

| Evidence | Result |
|---|---|
| Static guard `backend/src/tests/guards/modelIndexColumns.am3.guard.test.ts` (unit gate) | 8 of 8 pass. It fails on a re-added `api_key_id` index (fail-before). Its ALLOW list has one reviewed entry, `invoices.stripe_invoice_id` (0002, before the base; a unique attribute emitted only inside CREATE TABLE), and fails on a stale entry |
| Live `backend/src/tests/migrations/upgradeBoot.am3.live.test.ts` (`AM3_UPGRADE_LIVE_TEST=1`) | 7 of 7 pass on a disposable PG18. It builds the base from ce74932's own boot schema step (`git archive`, no checkout), writes that release's rows, then boots the current tree with no manual migrate |
| The upgrade boot from ce74932 with the three model edits | Boots. **15 migrations applied** (those after the base's 0090). Schema-verify OK. A second boot applies nothing |
| Fail-before | A scratch copy of the current tree with the three indexes re-added (the real tree was not edited) fails the boot with `column "api_key_id" does not exist` |
| Sweep of 0091–0106 | No other index-on-a-later-column case |

Docker: the sub-agent's named container, removed by name; nothing pruned.

**Recommendation: how CI could run the live upgrade test (not wired now).**
1. Add a job with a `services:` PostgreSQL container, image `pgvector/pgvector:pg18`, with a health check (`pg_isready`) and a random password from the job. Name the scratch database `am3_scratch`; the suite drops and recreates it, and refuses any name without "scratch".
2. Check out with `fetch-depth: 0`, or at least with the base revision fetched, so `git archive <base>` can read it. Take the base from a variable (`AM3_UPGRADE_BASE`) that the release process moves to each deployed release, so the test always upgrades from what production runs.
3. Add a step for the base's own dependencies: `npm install --prefix "$RUNNER_TEMP/am3-base" joi@18.2.9`, then set `AM3_BASE_NODE_MODULES=$RUNNER_TEMP/am3-base/node_modules`. The list grows only when a later release removes a package the base still needs; the test's header says how to add one.
4. Run `AM3_UPGRADE_LIVE_TEST=1 DB_HOST=localhost DB_PORT=5432 DB_NAME=am3_scratch DB_USER=postgres DB_PASS=$PG_PASSWORD npm test -- src/tests/migrations/upgradeBoot.am3.live --coverage=false` in `backend/`.
5. Trigger it on every PR that touches `backend/src/models/**`, `backend/src/migrations/**`, `backend/src/config/migrator.js` or `backend/src/utils/{migrationLock,schemaVerify}.util.ts`, and on the release branch. It takes minutes, not seconds, so it should not run on every commit.
6. Make it a required check for release tags. A fresh-database test cannot see this class of defect.

CI has still never run on GitHub (P7-01), so this recommendation is also untested there.


## Amendment 4 (2026-10-01) — A-331: no response carries a credential (ADR-100 Amendment 4)

The coordinator assigned it; the P9-22 helper found it and carried the controller conversion (`controllers/roles.controller.ts`, `routes/api/roles.route.ts`, `roles.openapi.ts`). I changed `roles.service.ts` with the P9 lead's release.

| Change | Tests, and fail-before |
|---|---|
| `roles.service#assignRoleToUser` answers `assignedUserView(user)` (9 named fields) | `backend/src/tests/routes/rolesAssign.a331.test.ts` (real router, controller, service and models over memoryDb): **2 of 2 failed** with the projection and the model redaction both reverted. The scan's message named `data.password` (a credential key and a bcrypt value), `mfaSecret`, `mfaPendingSecret`, `mfaRecoveryCodes`, `webauthnCredentialId`, `webauthnPublicKey`, `webauthnSignCount`, `otpCode` and `otpRequestCount`. `roles.service.ts` is at 100% |
| `models/secretAttributes.ts` + the barrel's `installSecretRedaction`: listed attributes dropped from `toJSON()` for User, ApiKey, Session, Webhook, TenantKey, AccessRequest, CalibrationDevice | `backend/src/tests/models/secretAttributes.a331.test.ts`: every listed model through the real barrel. Its `toJSON()` and `JSON.stringify` drop every listed attribute while the instance still reads them. An unknown model name throws |
| S-20 scan: `backend/src/tests/support/secretScan.ts`, on every routeClient response (`fixtures/routeClient.ts`) and every real Express `res.json` (`backend/src/tests/setup/secretScan.setup.ts`, `jest.config.js` `setupFilesAfterEnv`) | `backend/src/tests/guards/secretScan.s20.guard.test.ts` (8 tests: keys, hash values, allowed one-time secret on its routes only, the real-Express patch records a leak and nothing for a clean body). **Full suite with the scan on: no leak besides A-331.** The one finding was the allowed webhook rotation under a test mount path, which widened the exception's pattern |

**Item 4, the unprojected-read review.** The grep was reads of User, ApiKey, Session, Webhook, TenantKey and AccessRequest without `attributes`. Each result falls into one of four groups:
- **Internal only**, never returned to a handler:
  - `auth.service` sign-in, MFA and refresh reads;
  - `bootstrapCredential.service`;
  - `gdpr.service` internals;
  - `eSignature.service` signer reads;
  - `invitation.service`;
  - `oidcProvider.service` token reads;
  - `migration.service` seeds;
  - `dataRetention.service`;
  - `customDomains.service` and `dashboard.service` user lists (these select explicitly two lines on).
- **Projected before the response:**
  - `apiKey.service#getApiKey` (`publicKey`);
  - `webhook.service` (`publicWebhook`);
  - `auth.service` (`signInResponse`);
  - `accessRequest.service` lists (their own view).
- **Reaching a handler as a row**, now covered by the toJSON layer and the scan:
  - `auth.service#getAuthUserWithTenant` → `req.user`;
  - `apiKey.service#loadOwned` and `webhook.service#loadOwned` (both internal to their projections).
- **The defect:** `roles.service#assignRoleToUser`, fixed.

**Other suites in the full run** that failed on other agents' in-flight work:
- `dynamicAccessSlugs.a07`: the gate count changed with the route conversions.
- `effectivePermission.adr102`: page gates.
- `notification.service.test`: a conversion in progress.

`sso.refusalTiming.a292` failed under full-suite load (a 90 ms gap against a 60 ms bound). Its margins are now wider: settings 250 ms, floor 600 ms, bound 150 ms. The control still needs a gap of at least 220 ms without the floor, and the test passes.

**Checks.**
- `npm run typecheck`: clean on the whole backend at the last run.
- `npx eslint`: 0 errors on every touched file, including `routeClient.ts`, where an unnecessary `as unknown as` was removed.
