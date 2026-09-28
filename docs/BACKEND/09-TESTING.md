# 09 — Backend Testing

> **Language status — target: TypeScript, strict (ADR-038).** The backend is **JavaScript/CommonJS today**; the migration is [`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md). Behaviour described here is **as-built** unless marked *target*. New backend code follows [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../../docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md). Remove this banner only when every module this document describes is converted.

Jest 30. 342 test files under `backend/src/tests/`, plus 51 live E2E specs.

Overall strategy: [`../TESTING/00-TEST-STRATEGY.md`](../TESTING/00-TEST-STRATEGY.md).

---

## Commands

```bash
npm test                # unit + integration, --forceExit
npm run test:unit
npm run test:e2e        # 51 live specs, --runInBand, against a RUNNING server
npm run test:watch
npm run test:coverage   # the gate
```

`--max-old-space-size=4096` is set on every jest invocation. The suite is large enough to exhaust the default heap.

## The Coverage Gate

The unit suite runs against a **100%** threshold (`backend/jest.config.js`). It was restored by P6-01
(2026-09-11) after the demo seeder, certificate submit-for-approval, `qms.validator`, the retention
`legalHoldSchema`, the tenant subdomain branch and the param-merge branches had pushed it below.
**A gate that is failing is a gate nobody trusts** — so the rule is to keep it green, and to quote a
figure only from a named run on a quiet tree.

### What 100% covers (P6-14, ADR-085)

**Six layers, not the whole backend:** `src/controllers/`, `src/middlewares/`, `src/routes/`,
`src/services/`, `src/utils/`, `src/validators/`. Outside the figure:

| Excluded | Why |
|---|---|
| `src/config/` | wiring (Sequelize, Redis, Socket.IO, the migrator). `config/socket.js` holds the socket authentication gate and is kept at 100% by `tests/config/socket.test.js` — under an explicit `--collectCoverageFrom` run, **not** by the gate |
| `src/constants/` | data, no branches |
| `src/docs/` | swagger components |
| `src/models/` | the **71 models** — their hooks and validators are exercised by the service and live suites, and are not measured |
| `src/scripts/` | operator CLIs |
| `backend/index.js` | the boot sequence. Covered by a real boot, not by a unit test: CI `boot-and-migrate` and `src/tests/e2e/liveContract.smoke.test.js` |

Pinned by `src/tests/guards/coverageScope.p614.test.js`: every collected pattern matches a real file
(the phantom `src/app.js` entry is gone), and the excluded layers are exactly these.

### `istanbul ignore` is reviewed like `eslint-disable`

A new directive needs `istanbul ignore <kind> -- <reason>`, and the reason says why the code is
**kept**, not what it does. Code described as unreachable is deleted; one that is kept says what it
guards against. The count only goes down: `src/tests/utils/istanbulIgnore.a32.test.js` fails on an
unexplained directive or a count above its ceiling, and raising the ceiling is a reviewed change.

## The Lesson This Suite Was Built From

**3,863 tests passed while 13 endpoints were broken.**

> A mock proves the code calls what the developer believed.
> Only a live call proves the endpoint exists and answers that way.

Both layers are required. Neither substitutes.

## Unit Tests

Services are where the gate bites. For each service function:

| Assertion |
|---|
| the happy path |
| **each error branch, with its status code** |
| transaction rollback leaves no partial state **and no audit row** |
| idempotency: a second call is a no-op |
| **two-tenant isolation** |

The rollback-and-no-audit-row assertion is the one most often missing, and it is the one that catches an audit write that escaped its transaction.

## The IDOR Sweep

The most important test in the project.

```
1. createTwoTenants()
2. as A, create a resource on every :id route
3. as B, attempt GET / PUT / PATCH / DELETE
4. assert 404 — NOT 403, NOT 200
5. as B, list the collection; assert A's resources are absent
```

**404, not 403.** A 403 says "this exists and you may not have it", turning id enumeration into a tenant-membership oracle.

### `createTwoTenants()` is the load-bearing part

A **one-line fixture** is what decides whether this test gets written for a new endpoint. Twenty lines of setup means it gets skipped, and the sweep decays into covering only what someone had time for.

It exists since 2026-09-24 (A-63): `backend/src/tests/fixtures/twoTenants.js`. **It is synchronous and in memory (ADR-088)** — `const fx = createTwoTenants()` gives `fx.tenantA`/`fx.tenantB`, `fx.principal(tenant, role)` shaped like `req.user`, `fx.superAdmin`, model doubles and a transaction double whose `rollback()` undoes writes. "Create a resource as A" in step 2 means a model double that holds the row, not an HTTP call; the fixture runs no SQL and no scoping hooks, so the hooks and grants are tested against PostgreSQL separately. Pair it with `fixtures/seededAuthorization.js` to run the real `dynamicAccess` over the real seeded grants — `readGates.p604.test.js` shows both together.

### Cases easy to miss

- an authenticated principal with **no** tenant sees zero rows — the deny branch, `NO_TENANT_UUID`
- a cache populated by A is not served to B
- global search returns only A's rows, across every entity type it unions
- a batch job started by A produces a result containing only A's data
- a `document_chunks` retrieval for A cites only A's documents

## Authorization Tests

A test proving only that the allowed role gets in proves nothing. **The negative cases are the test.**

```
✓ granted role succeeds
✓ role without the grant → 403
✓ read-only role attempting a write → 403
✓ per-user override changes the outcome
✓ different tenant → 404
✓ SUPERADMIN succeeds
```

Plus one that catches a silent failure mode: **every seeded role has a `ROLE_LEVELS` entry.** A role missing from that map fails every privileged gate with nothing explaining why.

## Live E2E — 51 specs

`backend/src/tests/e2e/modules/<module>.e2e.test.js`, one per module, run with `--runInBand` against a **running server** with a real database. Harness: `setup.js` plus a shared login.

No coverage gate — these prove contracts, not lines.

### Two operational rules, both learned by breaking things

**Never suspend the default tenant.** Create a **disposable** one.

Suspending the default suspends the super-admin who lives in it and 403s every subsequent request. Recovery required a direct database update. Three specs (`tenant-lifecycle`, `data-retention`, `feature-flags`) originally grabbed `/tenants/all` `data[0]` in `beforeAll` and did exactly this.

**Watch the rate limiter.** The global budget is 5,000/15 min in production and 100,000 otherwise. Repeated verification runs have exhausted it and produced failures unrelated to the code under test.

### Current state, stated honestly

Every fix has been verified live and individually. **A single clean full-suite pass has not yet been achieved in one uninterrupted run**, because the rate-limit window kept needing to reset.

That is a gap, not a pass.

### Tests that documented a bug

Several agent-written specs originally asserted the **broken** behaviour — the QMS and SOP envelope deviation, the feature-flag and lifecycle 400s. They were updated to assert the corrected contract when the defects were fixed.

A test written against observed behaviour without asking whether the behaviour is correct **encodes the bug**.

## Compliance Tests

| Assertion |
|---|
| `audit_logs` has no reachable delete path — **as the application role** |
| every mutating endpoint writes an audit row, in the action's transaction |
| a rolled-back action leaves **no** audit row |
| approving a `draft` certificate → **409** |
| signing writes `meaning`, `authMethod`, `documentHash` |
| a purge skips an entity under legal hold that is older than the window |
| erasure anonymises and leaves `performedBy` resolvable |
| verification handles valid, expired, revoked, tampered and unknown — **unknown and tampered identically** |

### Test grants as the application role

```sql
-- as the OWNER this succeeds whether the REVOKE exists or not
DELETE FROM audit_logs WHERE id = '…';
```

A permission test run as the database owner passes unconditionally. **It is worse than no test** — it produces a green tick for an absent control.

## Secret and Log Tests

| Assertion |
|---|
| no response contains `password`, `mfaSecret`, `otpCode`, `privateKey`, storage credentials |
| **`iotDeviceToken` absent from device list responses** |
| logs contain no bearer token at any nesting depth |
| `audit_logs.changes` contains no secret for any mutating endpoint |
| the app **exits** without `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET` |

### Self-verifying tests are worthless

**A test generated from the code it tests verifies consistency, never correctness.**

A redaction test iterating the same key set the redactor uses cannot catch a key being **deleted** from that set — both sides change together and the test stays green.

The fixes: an independently maintained list, or a mutation check that removes a key and confirms the right test fails.

## Mutation Checking

Where a test guards something load-bearing, prove the test works by **breaking the thing**:

- drop a database constraint and confirm the right test fails
- remove a key from the redaction set and confirm the right test fails
- delete a tenant predicate and confirm the IDOR sweep fails

A test nobody has ever seen fail is a test nobody knows is connected.

## Demo Data

`GET /api/v1/migration/seed-demo`, gated on `SEED_DEMO=true`. Also `src/scripts/seedDemo.js`.

~80 rows across every business module, idempotent on re-run, with a teardown removing what it created. Seeds through models directly, not over HTTP.

**`SEED_DEMO` must never be true in production.**

Demo data has real diagnostic value: defect #15 — the certificate list returning zero rows — was **only visible once there was data**.

## Before a PR

- [ ] `npm run lint`
- [ ] `npm test` at the gate
- [ ] `npm run test:e2e` against a running server
- [ ] every new `:id` route has a **two-tenant test asserting 404**
- [ ] every new gated route has **negative** authorization tests
- [ ] every new mutation asserts its audit row, inside the transaction
- [ ] rollback leaves no audit row
- [ ] no `console.log` left behind
