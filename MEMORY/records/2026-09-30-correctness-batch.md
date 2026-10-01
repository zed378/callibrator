# 2026-09-30 — Correctness batch: N-01 (A-323), A-324, V-05, V-08, V-12, V-13, V-14, V-15, V-17, A-273, A-274, Q-52, Q-53

**Findings:** N-01 from `TASKS/OPEN-WORK-2026-09-30.md` §4 (now **A-323**), the open V-cards of `TASKS/REVIEW-2026-09-23-REMEDIATION.md`, A-273 and A-274 of `TASKS/AUDIT-2026-09-REMEDIATION.md`, and Q-52 / Q-53 / V-13 as decided in ADR-109 §6–7.
**Agent:** correctness-batch subagent of the main session.
**Decisions:** the owner delegated these decisions to the main session. Everything marked **working decision** below is the main session's decision (or this agent's, taken under that delegation). It has the standing of ADR-109, which means it awaits the owner's confirmation.
**Method:** each item is its own change with a named test. "Fail-before" means the test was run against the pre-fix code, and the result is quoted. That code was restored by a temporary local revert, never by git. No git writes were made.

## N-01 → A-323: one super-admin predicate (V-15 folded in)

**Defect.** `session.route.js` gates revoke, revoke-all and delete with `rbac(["SUPERADMIN"])`, which is the seeded name. `session.controller.js:199,247,284` then compared `role.name === "SUPER_ADMIN"`. The result:

- `POST /sessions/user/:userId/revoke-all` answered 403 to everyone who could reach it.
- Revoke and delete worked only on the operator's own sessions.
- The unit tests mocked `"SUPER_ADMIN"`, a spelling that no seed produces.

`tenantHierarchy.route#ownTenantOnly` (V-15) had the mirror-image defect. So did `auth.middleware#superAdminOnly`, which the card did not list. Both accepted only `"SUPERADMIN"`.

**Change.**

- New file `backend/src/utils/role.util.ts`. It exports `SUPER_ADMIN_ROLE_NAMES` (both spellings), `isSuperAdminRoleName` and `isSuperAdmin(principal)`. It has named exports only, and no `export =`.
- Every string comparison of either spelling in `backend/src` now goes through it:
  - `config/socket.js`
  - controllers: audit, calibrationScheduler, dashboard, session, tenant, user
  - middlewares: abac, auth (`isSuperAdminPrincipal`, `superAdminOnly`), dynamicAccess (×2), enforceQuota, rbac (×2), tenantContext, denyPlatformAuthoring
  - routes: scim, tenantHierarchy, menuGroups
  - services: auth (×2), user (×3 plus the reset set), scim, effectivePermission (`isSuperAdmin` now delegates), kanban, ticket (including `RESPONDER_ROLES`)
  - `utils/mfaPolicy`, where `isPlatformOperator` keeps its roleLevel ≥ 10 rule
- `constants/menuPageAccess.ts` quotes the SCIM gate's source text. That anchor was updated to the new text.
- `scim.service` compared only the upper-cased `"SUPERADMIN"`. It now refuses both spellings.

**Evidence.**

- `tests/controllers/session.revoke.n01.test.ts` runs the real controller and the real envelope, with the principal named `ROLE_NAMES.SUPER_ADMIN`. **Fail-before: 3 of 6 failed** against the old controller. After the fix, 6 of 6 pass.
- `tests/guards/superAdminPredicate.n01.guard.test.ts` checks two things:
  - both spellings resolve identically, and near-miss names do not;
  - no source file outside `role.util.ts`, tests and migrations compares either spelling or `ROLE_NAMES.SUPER_ADMIN` by string. There is one reviewed allow-list line: `migration.service.js` filters ROLE_NAMES *keys*.
- `tests/controllers/session.controller.test.js` now uses the seeded name (4 sites).

**Found here: A-324** (revoke, revoke-all and delete of sessions wrote no audit row). Fixed in a follow-up the coordinator directed; see the A-324 section below.

## V-05 — `allowApiKey`

**Working decision:** remove it rather than wire it in. It had no call site, and it is an unconditional opt-in: it authorizes a key without checking anything about it. The one consumer, SCIM, needs a conditional check, namely the `scim` scope. So the inline gate in `scim.route.js` is the right form, and it is now documented as one of exactly two writers of `apiKeyAuthorized`. The other writer is dynamicAccess's scope check.

The comment in `controllerWrapper.util.ts` now names the two unwrapped controllers: `health` and `predictiveMaintenance`. `iot` is wrapped today, so the review's count of three is stale.

**Evidence.** `tests/guards/apiKeyAuthorizedWriters.v05.guard.test.ts` checks four things:

1. The writers are exactly those two files. Fail-before: `auth.middleware.js` was a third writer.
2. `auth.middleware` exports no `allowApiKey`.
3. Every middleware that `auth.middleware` exports has a call site outside the tests.
4. The unwrapped-controller list is exact.

The A-282 guard (`apiKeyAuditPrincipal.a282.guard.test.ts`) still passes, and its comment was updated. The `allowApiKey` unit test in `middlewares/auth.test.js` was removed along with the function.

## V-08 — A-02 gates proved by behaviour

`tests/routes/routeGuards.a02.behaviour.v08.test.ts` stubs only `auth`. The real `rbac` and `denyApiKey` run.

- The principal has exactly the projection of `getAuthUserWithTenant`: role `id, name, description, roleLevel` and tenant `id, name, status`. The test reads that projection from `auth.service.ts`, so the principal cannot drift from it.
- For webhooks `GET /`, storage `GET /settings` and api-keys `GET /`, the test checks three callers:
  - HEALTHCARE ADMIN is admitted with 200, and the controller is reached;
  - TECHNICIAN is refused with 403, and the controller is never reached;
  - an API key is refused with 403, and the controller is never reached.
- 10 of 10 pass.

`routeGuards.a02.test.js` keeps its role as the shape sweep, and its header now says so. **No fail-before:** the V-01 defect this would have caught is already fixed, so the test cannot be shown failing against today's code.

## V-12 — attachments gating comment

The premise was checked, and it is false in two ways:

- the slug is seeded (`seedMenuGroups.util.js`, parent `mgmt-content`);
- since ADR-102 the slug is `MENU_SLUGS.ATTACHMENTS`.

The real reason is the grants. Only HEALTHCARE ADMIN and CALIBRATOR ADMIN hold `attachments:write`, only ENGINEERING MANAGER holds `attachments:read`, and no technician holds it at all. Every role holds `equipment:read`, which was checked by loading `ROLE_MENU_ASSIGNMENTS`.

The comment was rewritten to say this, and its recommendation now names the seeding step. `tests/routes/attachments.gateRationale.v12.test.ts` asserts those facts, 4 of 4. The review's "promote A-07" item is not done here.

## V-13 — SOP author may not publish: 403 (ADR-109 §7)

`sop.service.ts#publishDocument` now answers **403** when the author tries to publish, and the message names the rule. PUBLISHED and ARCHIVED stay **409**.

**Fail-before** tests (both were 409 before the change):

- `tests/services/sop.service.test.js` › "refuses with 403 when the publisher is the author, and changes nothing";
- `tests/routes/routeGuards.a28.test.js` › "refuses publication by the SOP's own author with a 403 that explains the rule". This one runs the real service through the route.

Also updated:

- `tests/e2e/modules/sop.e2e.test.js` expects 403. **It was not run live.**
- The frontend test `app/dashboard/sop/__tests__/page.test.tsx` mocks a 403; 18 of 18 pass. The page shows `message` whatever the status, so the UI is unchanged.
- `docs/API/10-QMS-API.md` lists both codes.

The single-admin tenant case is **Q-54**, which stays open.

## V-14 — the limiter's `revoked` flag

The `INCR_ENTRY_SCRIPT` Lua script and the memory fallback in `storeIncrEntry` now **preserve every other key** of the previous entry. The contract is written next to the script. The hard block (2 × maxAttempts) also keeps `revoked`.

**Evidence.**

- `tests/services/rateLimiter.revokedFlag.v14.test.ts` covers the memory path with maxAttempts + 2 failures and the hard block. **Fail-before: 2 of 2 failed.**
- A live case, "V-14: keeps a token's revoked flag through maxAttempts + 2 failures (the real script)", was added to `rateLimiter.redis.live.test.js`. It ran against a disposable `redis:7-alpine` container (`v14-correctness-redis`, removed afterwards):
  - REDIS_LIVE_TEST=1: **7 of 7 passed**;
  - with the old script restored: **the V-14 case failed**.
- The mocked limiter suites: 130 passed, 6 skipped.

The security agent's `countsFailuresByIp`, `setRetryAfter` and `storeIncr`/`storeTtl` exports are untouched.

## V-17 — `SIGNATURE_ALGORITHM` (ADR-style note)

**Decision (working): remove the setting and hardcode RS256.** The alternative was to honour the setting end-to-end.

**Rationale.** Every v2 record was signed with RSA-SHA256, and the scheme id `esig-v2-rsa-sha256` says so. Honouring RS512 would need four things:

- a per-record digest chosen at verification from the stored label;
- a new scheme id;
- a test matrix;
- a key-size policy.

No requirement asks for any of this. Removing the setting makes the label a constant that cannot disagree with the cryptography.

**Alternatives considered.**

1. Derive the digest from the setting (RS256 → sha256, RS512 → sha512) and verify by label. **Bad:** a record relabelled before this change (label RS512 on a SHA-256 signature) would then fail verification, turning a false label into a false "invalid".
2. Ignore the setting silently. **Bad:** the operator would believe they sign with RS512.

**Implications.**

- A deployment that sets `SIGNATURE_ALGORITHM` to anything but `RS256` now **refuses to load the service**, so it fails loud at boot. No `.env.example` or chart sets it, which was checked by grep.
- Verification still uses sha256 for every record. So a record written under a relabel still verifies, and its stored label stays false. **Bad, but historical.** Count them with `SELECT count(*) FROM e_signature_records WHERE signature_algorithm <> 'RS256'` before telling an auditor there are none. That query was not run.
- `jwt.util` `lastError` was already gone.

`docs/BACKEND/10-MODULE-REFERENCE.md` is updated.

**Evidence.**

- `tests/services/eSignature.algorithmLabel.v17.test.ts`, 9 of 9. It covers unset, "" and RS256 accepted; RS512, PS256, ES256 and rs256 refused at load; and that RS256 is exactly PKCS#1 v1.5 with SHA-256. Fail-before: with RS512 the module loaded and reported "RS512".
- The e-signature suites: 295 passed.

## A-273 — path wins over body

New file `utils/pathParams.util.ts#withPathParams(params, input)`. It follows three rules:

- a path param always wins;
- a body or query value that names a path key with a **different** value is a **400** that names the key, and objects and booleans never match;
- the same value repeated is accepted.

**Sites:**

- `dataRetention.controller` ×4: setRetentionPolicy, enableLegalHold, maskPII, anonymizeDataset;
- `featureFlag#setTenantFlag`, and also `#isFlagEnabled`, where the **query** used to win;
- `tenantLifecycle#suspendTenant`;
- `tenant#updateTenant`.

**Checked:** `tenant#updateTenant` is mounted at `PATCH /tenants/edit`, which has **no path parameter**. The merge was body-wins, but there was nothing for the body to override. Ownership stays with the service (A-63).

**Deviation from the card.** The card proposed `validate(schema, { from })`. That form needs the route and controller converted, which is Phase 9 work, so a controller helper is used instead. The Phase 9 lead has been told and has dropped A-273 from its queue.

**Evidence.** `tests/controllers/pathParams.a273.test.ts`, 24 tests. It runs the real controllers, validators and wrapper, and doubles only the services. **Fail-before: 9 failed** when the sites were restored to `{ ...req.params, ...X }`.

## A-274 — `includeDeleted` scopes

The premise had moved. `ApiKey.scope("includeDeleted")` now has callers: `calibrationRecords.service.js` and `stock.service.ts` (Q-51, ADR-100 Amendment 2). So:

- ApiKey keeps its scope, and the scope is documented;
- the other **12** models lose theirs. They had no caller, which was re-grepped just before removal.

**Side effect.** `session.model.ts` `underscoredAll` had been accepted by the type checker only because the scope's `@ts-expect-error` sat in the same object literal. It now has its own `@ts-expect-error`, and `model.options` is unchanged.

**Evidence.** `tests/models/includeDeletedScope.a274.test.ts` **computes** both sets from source:

- the models that declare the scope must equal the models that some caller scopes with it;
- a caller must never combine the scope with `defaultScope`;
- a removed scope now throws, where it used to drop the predicate silently.

`tests/models/modelTypes.p910.test.ts` was re-pinned. The model suites: 1,071 passed.

## Q-52 — vendors.notes (ADR-109 §6, completed by the main session's follow-up decision)

**What changed.**

- Migration `0106-vendor-notes.ts` adds the column. It is idempotent, has a down, has no blanket catch, and is registered after 0105.
- The Vendor model declares `notes: TEXT NULL`. The OpenAPI `Vendor` response schema (`routes/api/vendor.openapi.ts`) now carries it too, and `openapi.json` and the frontend `schema.d.ts` are regenerated.
- **Validator bound (main session's decision):** `notes` is at most **2,000** characters (`VENDOR_NOTES_MAX` in `packages/contracts/src/vendor.ts`, create and update).
- **Frontend:** the vendor form has a **Notes** textarea on both create and edit. It has `maxLength` set to the contract's constant and a live `n / 2000` counter. An emptied Notes on edit is sent as `null`, so the stored note is cleared. The vendor list shows the note under the name, on one truncated line, with the full text on hover. There is no vendor detail page. The UI-correctness lane had finished, so there was nothing to coordinate with it.
- **ADR-109 §6 amended** in `MEMORY/DECISIONS.md`. The amendment records the bound and its reasoning, and corrects the claim that the vendor form offered the field: it did not until this change.

**Note on oasdiff.** A new request `maxLength` is a change oasdiff classifies as breaking. It breaks no working client: before 0106 every value was accepted and then dropped, so no client can have relied on a longer note being kept. `openapi:breaking` was skipped here because the binary is not installed. It compares against the base branch's `openapi.json`, and that file is still untracked on this tree, so CI's first run will also have no base. **If a later base exists, this change and Q-53's 429 body are the two intended breaks to expect in the report.**

**Evidence.**

- Backend: `tests/routes/vendor.notes.q52.test.ts` runs the real router, service and models over memoryDb, 3 of 3:
  - POST stores the note and GET returns it;
  - PATCH updates it and null clears it;
  - 2,000 characters are stored, and 2,001 is a 400 with nothing written.
  - **Fail-before: 2 of 2 failed** without the model attribute. The bound case is new behaviour: before, any length was accepted and then dropped.
- `tests/migrations/0106-vendor-notes.test.ts`, 7 tests.
- The contracts package: 70 of 70. The backend validator and contract suites: 1,158 passed.
- Frontend: `app/dashboard/vendors/__tests__/page.test.tsx` adds two cases:
  - "Add Vendor sends the trimmed Notes, bounded by the contract's maximum" (maxLength, counter, trimmed payload);
  - "Edit pre-fills Notes and PATCHes the change; the list shows the notes" (includes an axe pass).
  - **Fail-before: 2 of 2 failed** with the textarea and the list line removed.
  - `hooks/__tests__/useVendors.test.ts` gains "an empty Notes on edit is sent as null".
  - The vendors suites: 20 of 20.
- **PostgreSQL 18.6** (disposable container `q52-pg18`, `pgvector/pgvector:pg18`, removed by name). I built the "upgraded" state with a temporary script: `db.sync()`, then the migrator up to 0105 (77 applied), then `DROP COLUMN notes`, because `sync()` had created it from the model. Then, in order:
  - `migrate:status` listed only `0106-vendor-notes.js` as pending.
  - `npm run migrate` ran `ALTER TABLE "public"."vendors" ADD COLUMN "notes" TEXT`. `\d vendors` showed `notes | text | nullable`, and `schema_migrations` held 78 rows.
  - A second `npm run migrate` was a no-op.
  - `npm run migrate:undo` ran `DROP COLUMN "notes"` and deleted the 0106 row. `information_schema` showed the column gone, and the count was back to 77.
  - `npm run migrate` again: `notes | text | YES`.
  - This ran as the owner role, which is fine for a DDL-only migration: it adds no grant or trigger.

## Q-53 — the global 429 in the envelope (ADR-109 §6)

New file `middlewares/globalRateLimit.middleware.ts#globalLimitBody`, used as `defaultLimiter`'s `message` in `index.js`. The body is:

```
{ success: false, status: 429, message, data: null, retryAfter }
```

This is the request-budget shape. `Retry-After` is set by express-rate-limit 8.7.0 whenever standard headers are on, which was checked in its source.

`docs/openapi/envelope.ts` `RateLimitBody` now describes the envelope. `openapi.json` and `frontend/src/api/generated/schema.d.ts` were regenerated, and `openapi:check` reports it current. **`openapi:breaking` was skipped** because oasdiff is not installed. The 429 body change may be flagged, and it is intended: ADR-109 decided it.

Frontend 429 handling reads the HTTP status and `retryAfter` or the header, never `status: "Error"`, which was checked by grep.

**Evidence.** `tests/middlewares/globalRateLimit.q53.test.ts`, 3 of 3. It runs the real express-rate-limit over real HTTP, and pins the index.js configuration. Fail-before: index.js had `status: "Error"`.

## A-324 — session revocation audited (follow-up)

`session.controller.js` now writes one audit row for each of the three operations:

- revoke: UPDATE, with `resourceId` set to the session;
- revoke-all: UPDATE, with `resourceId` set to the target user;
- delete: DELETE, with `resourceId` set to the session.

The rest of the row:

- **`resourceType`** is `session`.
- **Tenant:** the session's `tenant_id`. For revoke-all it is the target user's tenant, read with `Users.unscoped()` so that a soft-deleted user's sessions stay revocable. When there is no tenant, the row goes to the platform tenant.
- **Actor:** `auditPrincipal` / `auditEntryActor`. An API key is recorded as `system:api-key`, with `changes.apiKeyId`.
- **`changes`:** `event`, `targetUserId`, `sessionCount` and `reason`. Never a token or its hash.
- **Transaction:** each row is written inside a `sequelize.transaction` together with the session change.

**Evidence.**

- `tests/routes/session.audit.a324.test.ts` runs the real route, rbac, controller, audit service, models and hooks over memoryDb, 4 of 4:
  - one row each for revoke, revoke-all (`sessionCount` 2) and delete, with no token material;
  - a failed audit insert leaves the session **not** revoked, and the route answers 500.
  - **Fail-before: 4 of 4 failed.**
- The mocked `session.controller.test.js` and `session.revoke.n01.test.ts` were adapted to the transaction. Together they pass 61 of 61.

The P6-11 guard scans services, not controllers, and has no entry for this handler, so there was nothing to remove. Its `session.service#*` entries are INFRA (sign-in machinery). `auditCoverage.p611` currently fails on 19 stale entries owned by the P6-11 lane; none of them is this batch's.

## Consumer-visible changes

- `POST /sessions/user/:id/revoke-all` now works for the super admin; it was always 403 before. The super admin can now revoke and delete other users' sessions.
- An SOP author publishing their own SOP gets **403** where it got 409.
- A body or query id that differs from the path is **400** on the data-retention, feature-flag and tenant-suspend routes.
- The global 429 body is the envelope.
- `SIGNATURE_ALGORITHM` set to anything other than RS256 stops the service loading.
- Vendors store `notes` (at most 2,000 characters; a longer value is a 400), and the vendor form offers it. **Run migration 0106 on upgrade.**
- Session revoke, revoke-all and delete are audited.
- `allowApiKey` is gone from `auth.middleware`.

## Verification (2026-09-30, shared tree, other agents active)

- **`npm run typecheck`:** none of my files errors. Three errors belong to other agents: `meteredBilling.service.ts` (duplicate `Transaction`), `tests/e2e/modules/p10-access-requests.e2e.test.ts:110`, and `tests/services/certificateDocument.snapshot.q50.test.ts:231`.
- **`npx eslint --quiet`** on every changed backend file: 0 errors. `npx eslint` on the changed frontend test: 0 errors.
- **`npm run ratchet`:** OK. It lowered its floor from 898 to 897 because another agent's conversion deleted a `.js` file.
- **`npm run load:check -- --src`:** 532 modules plus the index.js boot order, OK.
- **`npm run build:dist`:** OK. 198 JavaScript files copied, 349 TypeScript files compiled.
- **`npm run test:coverage -- --ci`** (full run): every file this batch touched is at **100%**. The gate as a whole is red because of other lanes' in-flight work.
  - `sop.service.ts` and `sop.controller.js` were being edited by the P6-11 lane (createDocument audit) mid-run, and their suites pass on re-run.
  - These suites still fail and are not this batch's:
    - `reporting.service.test.js` (A-319 CSV quoting);
    - `storage.controller.test.js`, `storageSettings.service.test.js`, `storage.config.test.js`;
    - `guards/auditCoverage.p611.test.ts` (stale list);
    - `routes/swaggerValidatorAlignment.p608.test.js` (new drift `PATCH /api/v1/roles/:id`, ADR-105);
    - `services/keyRotation.sqlBind.p918.test.ts` (fails to run).
  - `includeDeletedScope.a274` failed in that run on an intermediate version, and passes now (3 of 3).
- **Not run:** E2E (the updated `sop.e2e` expectation included).
