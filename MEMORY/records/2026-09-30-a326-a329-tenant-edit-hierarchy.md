# 2026-09-30 — A-326 … A-329: the tenant edit no longer answers 500, the creator write is gone, and a root's tree lists its children

**Findings:** A-326, A-327, A-328, A-329. The P9-13 conversion found all four; the TypeScript compiler exposed A-326 to A-328, and the live probe found A-329. The coordinator asked for them to be fixed first, each as its own change with a fail-before test and a live PG18 check. **ADR:** ADR-112 (A-326/A-327). **Agent:** the Phase 9 lead.

## A-326 — the edit wrote an upper-case status into the lower-case ENUM (ADR-112)

**The defect.** The validator upper-cases `status`, but `tenants.status` is ENUM('active','suspended','deleted'). Every edit that carried a status got a PostgreSQL `invalid input value for enum`, answered as a 500. The edit modal always resubmits the status.

**The fix** (`backend/src/services/tenant.service.ts#updateTenant`, ADR-112): an edit never writes `status`.
- The current status resubmitted, in any case, is no change.
- A different status is a 409 that names the lifecycle endpoints (`POST /tenants/:id/suspend`, `/resume`), which write the ADR-094 marks.
- A value outside the ENUM (`INACTIVE`) is a 400.
- A tenant admin sending a different status is still a 403 (A-63), checked first.

The route's OpenAPI description was updated to match. `openapi.json` and the frontend `schema.d.ts` were regenerated: `openapi:check`, `api:types:check` and Spectral all pass, with no new error.

## A-327 — a null or empty email reached the NOT NULL, isEmail column

Now a 400, with nothing written. Previously it was a `SequelizeValidationError`, answered as a 500.

**Evidence for A-326 and A-327:**
- **`backend/src/tests/routes/tenant.statusEmail.a326a327.test.ts`:** the real router, dynamicAccess, controller, service, audit and models on memoryDb.
  - Tenant A is seeded with the ENUM's own `active`; the shared fixture seeds `ACTIVE`, which is itself off-ENUM.
  - Each committed Tenant write is checked against the model's ENUM values.
  - **Before the fix, 6 of 9 failed:**
    - both resubmits wrote `ACTIVE`;
    - SUSPENDED was 200, not 409;
    - INACTIVE was 200, not 400;
    - email null and email "" were 500, not 400.
  - The A-63 403 and the empty-status control passed. **After the fix, 9/9 pass.**
- **Live, PostgreSQL 18 (`pgvector/pgvector:pg18`, digest-pinned) as `callibrator_app`:** scratch `p9/live-a326.js` passed 11/11.
  - Resubmits `active`, `ACTIVE` and `Active` all save, and the status stays `active`.
  - A super admin's SUSPENDED is a 409 naming the lifecycle, and B is unchanged.
  - INACTIVE is a 400, and a tenant admin's status change is a 403.
  - Email null and "" are 400, with the email unchanged; a new email is stored.
  - Exactly 4 UPDATE audit rows were written.
  - The live "before" is the P9-13 probe's measurement: both status cases and both email cases answered 500.
- **Tests that encoded the defect, updated per ADR-112:**
  - `tests/services/tenant.service.coverage.test.js`: it expected `status: "inactive"` and `email: null` to be written. The Tenants double gained `getAttributes`, and new A-326/A-327 cases were added.
  - `tests/routes/tenant.edit.a63.test.js`: "a super admin can change another tenant's status" became an edit of another field, plus a 409 case; its double gained `getAttributes`.

## A-328 — createTenant wrote `createdBy`, which is not a Tenant attribute

**Triage decision:** remove the write rather than add a column. Sequelize dropped the value anyway, and the creator is already recorded, in the same transaction, by the CREATE audit row under PLATFORM (A-95, A-125). That audit row is where attribution lives in this codebase.

**Evidence:**
- **`backend/src/tests/services/tenant.createAttributes.a328.test.ts`:** a general guard that every key createTenant hands to `Tenant.create` is a model attribute.
  - **Before the fix, 1 of 2 failed**, listing exactly `["createdBy"]`; 2/2 pass after.
  - The second test pins the audit row's `userId`, which is the creator.
- **`tenant.audit.a95.test.js` and the coverage test** pinned the dropped value. They now assert that it is absent.
- **Live on PG18 as `callibrator_app`:** the create succeeds, and the CREATE audit row carries the creator under PLATFORM.

## A-329 — a root tenant's tree listed no sub-organizations

**The defect.** createSubOrganization writes a hierarchy row for the child only. A root has none, so `getTenantTree(root)` answered `children: []` and `getDescendantTenants(root)` answered `[]`.

**Found while fixing it:** the descendant `LIKE` was unescaped. Every generated child code has a `_` (for example `ACME_001`), which LIKE treats as a single-character wildcard, so `/acme/acme_001/%` also matched `/acme/acmez001/…`.

**The fix** (`backend/src/services/tenantHierarchy.service.ts`):
- A new `implicitRoot` helper treats a tenant with no row as the root at `/<code>`, depth 0. That is exactly where createSubOrganization and moveTenant place the children of a parent without a row.
- `getTenantTree` and `getDescendantTenants` use it.
- The descendant pattern now goes through the file's own `subtreePattern`, which escapes `\`, `%` and `_`.

**A test-fixture fix, needed to test it:** `src/tests/fixtures/memoryDb.ts` `likeToRegex` ignored LIKE's backslash escape, so an escaped pattern matched MORE rows in memory than on PostgreSQL. It now honours `\` as PostgreSQL's default ESCAPE does.
- The suites that exercise escaped patterns, together with every hierarchy, user, includes, d24 and tenantScope suite, were run.
- 814 suites passed, with two failures unrelated to LIKE: a07's gate count, moved by other lanes converting routes, and rabbitmq W-18, which the leaf helper is working on.

**Evidence:**
- **`backend/src/tests/services/tenantHierarchy.rootTree.a329.test.ts`:** the real service and models on memoryDb, in the super-admin context.
  - **Against the pre-fix file, 3 of 6 failed:** the root's tree, the root's descendants, and the `_` wildcard. The pre-fix file was swapped in briefly and restored (checked with `cmp`).
  - **After the fix, 6/6 pass.** All hierarchy suites pass 137/137, and `tenantHierarchy.service.ts` is at 100%.
- **Live on PG18 as `callibrator_app`:** scratch `p9/live-a328a329.js` created a root through createTenant, then children through createSubOrganization (a generated `ACME_001` and a lookalike `ACMEZ001`, each with a child).
  - **Pre-fix file: 3/6.** Tree `[]`, descendants 0, and the child's descendants included the lookalike's child.
  - **Fixed file: 6/6.**

**Not changed:** `/tenant-hierarchy/tree` runs under the caller's tenant context. The model's own note says cross-tenant traversal needs a super-admin context, so a tenant user's tree still cannot see children that belong to other tenant ids. That is a design question, not A-329.

## Tree gates

- **ESLint:** clean on every changed file.
- **`npm run typecheck`:** 0 errors.
- **Coverage:** the tenant, accessRequest and p1005 suites, 3,047 tests, put `tenant.service.ts` at 100% statements, functions and lines. Branch coverage is 99.64%; the one uncovered branch, line 1291 in the tenant-settings `findOrCreate`, predates this change.
- **Cleanup:** the scratch PG18 container and its password file were removed, and the disposable databases were dropped by the probes.
