# 11 — Security Testing

Test strategy overall: [`../TESTING/00-TEST-STRATEGY.md`](../TESTING/00-TEST-STRATEGY.md). This document is the security-specific suite and the rules that keep it honest.

---

## Unwaivable Findings

A multi-tenancy finding is **not waivable by anyone**. Not for a deadline, not for a demo, not with a follow-up ticket.

Everything else is negotiable with a recorded decision naming who agreed.

## The Rules That Separate a Real Test From a Green Tick

These four have each produced a test that passed while the control was absent.

### 1. Test database grants as the **application role**, not the owner

```sql
-- as the owner, this succeeds whether the REVOKE exists or not
DELETE FROM audit_logs WHERE id = '...';
```

A permission test run as the database owner passes unconditionally. It is worse than no test, because it produces a green tick for an absent control.

### 2. A test generated from the code it tests verifies consistency, never correctness

A log-redaction test that iterates the same key set the redactor uses cannot catch a key being **deleted** from that set — both sides change together and the test stays green.

Fix: an independently maintained list of things that must never appear, or a mutation check.

### 3. A mock test proves the client calls what the developer believed

It does not prove the endpoint exists.

**3,863 tests passed while 13 endpoints were broken.** Frontend services had been written against imagined endpoints, with tests mocking the fabrication. Only a live call against a running server found it.

Mocks verify shape. Live calls verify contract. Both are needed and neither substitutes.

### 4. Name the test

"IDOR tested, all good" with no test named is **worse than saying nothing**, because it stops anyone looking again.

An assertion that a control passed is not evidence. The evidence is the test name and its result.

## The IDOR Sweep

The most important security test in the project.

```
1. create tenant A and tenant B, each with a user
2. as A, create a resource on every :id route; note the ids
3. as B, attempt GET / PUT / PATCH / DELETE on each
4. assert 404 — not 403, not 200
5. as B, list each collection; assert A's resources are absent
```

**404, not 403.** A 403 says "this exists and you may not have it", which turns id enumeration into a working tenant-membership oracle. Non-existent, soft-deleted and not-yours must be indistinguishable.

### `createTwoTenants()` is the load-bearing part

A one-line fixture is what decides whether this test gets written for a new endpoint. Twenty lines of setup means it gets skipped, and the sweep decays into covering only the routes someone had time for.

### Cases easy to miss

- an authenticated principal with **no** tenant sees zero rows (the deny branch, `NO_TENANT_UUID`)
- a cache populated by A is not served to B
- global search returns only A's rows, across every entity type it unions
- a batch job started by A produces a result containing only A's data
- a `document_chunks` retrieval for A cites only A's documents — **the highest-risk instance**
- a Kanban query starting from a child table (columns, cards, labels) joins to the project

## Authorization Tests

A test that only proves the allowed role can get in proves nothing. The negative cases are the test.

```
for each gated route:
  ✓ granted role succeeds
  ✓ role without the grant → 403
  ✓ read-only role attempting a write → 403
  ✓ per-user override changes the outcome as documented
  ✓ different tenant → 404
  ✓ SUPERADMIN succeeds
```

Plus one that catches the silent failure mode: **a role missing from `ROLE_LEVELS` fails every privileged gate with nothing explaining why.** A test asserting every seeded role has a level entry costs one line.

## Authentication Tests

| Assertion |
|---|
| bad credentials → uniform 401 regardless of whether the account exists |
| `/send-otp` → identical response regardless of whether the address exists |
| lockout triggers at the threshold |
| lockout is per source as well as per account |
| a suspended tenant → 403 on every authenticated route |
| an expired token → 401 |
| an access token cannot be used as a refresh token |
| WebAuthn: a sign count **lower than or equal to** the stored value is rejected |
| an OTP is single-use and cleared on use |
| `x-tenant-id` is ignored — not rejected — for a non-super-admin |

## Compliance Tests

| Assertion |
|---|
| `audit_logs` has no reachable delete path — **as the application role** |
| every mutating endpoint writes an audit row, in the action's transaction |
| a rolled-back action leaves no audit row |
| approving a `draft` certificate → **409**, not 500 and not 200 |
| a signature writes `meaning`, `authMethod` and `documentHash` |
| a retention purge skips an entity under legal hold that is older than the window |
| erasure anonymises and leaves `calibration_records.performedBy` resolvable |
| certificate verification: valid, expired, revoked, tampered, and unknown all behave correctly |
| verification returns an **identical shape** for unknown and tampered |

## Secret and Log Tests

| Assertion |
|---|
| no response ever contains `password`, `mfaSecret`, `otpCode`, `privateKey`, storage credentials |
| **`iotDeviceToken` is absent from device list responses** |
| logs contain no bearer token, at any nesting depth, under any key name |
| `audit_logs.changes` contains no secret for any mutating endpoint |
| the app **exits** without `CERT_SIGNING_SECRET`, `ENCRYPT_KEY` or `ATTACHMENT_URL_SECRET` |
| access and refresh JWT secrets being equal is rejected |
| a live provider key with `NODE_ENV != production` is rejected |

The last one cannot be done with per-field validation. It needs a cross-field rule, and it is the one that stops a staging test charging a real card.

## Upload Tests

| Assertion |
|---|
| a scanner error **rejects** the upload by default |
| `nosniff` and `Content-Disposition` present on every `/uploads` response |
| an unsigned attachment URL is refused |
| an expired signed URL is refused |
| tenant B cannot fetch tenant A's object — 404 |
| quota is enforced before the write, leaving no partial object |

## SSRF Tests

| Assertion |
|---|
| a tenant-supplied webhook URL to `169.254.169.254` is refused |
| a tenant-supplied webhook URL to an internal hostname is refused |
| a tenant-supplied S3 endpoint to an internal address is refused |
| an **operator-configured** internal endpoint still works — the asymmetry is intentional |

The last one matters: a fix that blocks internal endpoints everywhere breaks the normal compose configuration.

## Live E2E

51 specs at `backend/src/tests/e2e/modules/<module>.e2e.test.js`, run against a **running server** with a real database.

```bash
npm run test:e2e
```

### Two operational rules

**Never suspend the default tenant.** Create a disposable one. Suspending the default suspends the super-admin who lives in it and 403s every subsequent request; recovery is a direct database update. This has happened.

**Watch the rate limiter.** The global budget is 5,000/15 min in production and 100,000 otherwise. Repeated verification runs have exhausted it and produced failures unrelated to the code under test.

### Current state, stated honestly

Every fix has been verified live and individually. A **single clean full-suite pass has not yet been achieved** in one uninterrupted run, because the rate-limit window kept needing to reset.

That is a gap, not a pass. It is in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md) as a "now" item.

## Browser Suite

Playwright, `automate/`, 71 tests across auth, navigation, tenants, roles, users, kanban, notifications, account, profile, module health, and theme.

Transient failures during long runs have been **self-inflicted** — editing a backend file triggers nodemon, which restarts mid-test and produces `ECONNRESET`. Clean re-runs pass. Do not chase a flake until you have confirmed nothing was recompiling.

## Before a Release

- [ ] IDOR sweep green, and the test **named** in the release record
- [ ] authorization negative cases green
- [ ] compliance assertions green
- [ ] secret and log assertions green
- [ ] full E2E green in **one uninterrupted run**
- [ ] browser suite green
- [ ] anything waived is recorded with **who agreed** — and no multi-tenancy finding is waived
