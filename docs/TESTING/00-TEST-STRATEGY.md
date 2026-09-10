# 00 — Test Strategy

---

## The Lesson This Strategy Was Built From

**3,863 tests passed while 13 endpoints were broken.**

Frontend services had been written against endpoints that did not exist, and their tests mocked the fabrication. Every test agreed with every other test, and none of them agreed with the server.

> A mock proves the code calls what the developer believed.
> Only a live call proves the endpoint exists and answers that way.

Everything below follows from that.

## The Layers

| Layer | Where | Count | Proves |
|---|---|---|---|
| Unit | `backend/src/tests/` | 342 files | a function does what it says |
| Contract (mock) | `frontend/src/api/services/*.test.ts` | 51 | the client sends the right request |
| **Live E2E** | `backend/src/tests/e2e/modules/` | **51** | **the endpoint exists and answers that way** |
| Component | `frontend/**/__tests__/` | — | a screen renders correctly |
| Browser | `automate/` | 71 | the whole flow works |

The bolded row is the one that was missing.

## Coverage Gates

| Workspace | Gate | Status |
|---|---|---|
| Backend unit | **100%** | **currently failing** |
| Frontend | 70% | |
| Live E2E | none — proves contracts, not lines | |

The backend gate is below threshold: the demo seeder, certificate submit-for-approval, `qms.validator`, the retention `legalHoldSchema`, the tenant subdomain-derivation branch and the param-merge branches all added uncovered code.

**A gate that is currently failing is a gate nobody trusts.** Restoring it is the first item in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md).

## Four Rules That Separate a Real Test From a Green Tick

Each has produced a test that passed while the control was absent.

### 1. Test database grants as the **application role**

```sql
-- as the OWNER this succeeds whether the REVOKE exists or not
DELETE FROM audit_logs WHERE id = '…';
```

A permission test run as the database owner passes unconditionally. **It is worse than no test** — it produces a green tick for an absent control.

### 2. A self-verifying test verifies consistency, never correctness

A log-redaction test that iterates the same key set the redactor uses **cannot catch a key being deleted from that set** — both sides change together and the test stays green.

Fix: an independently maintained list, or a mutation check.

### 3. A test written against observed behaviour encodes the bug

Several agent-written E2E specs originally asserted the **broken** behaviour — the QMS and SOP envelope deviation, the feature-flag and lifecycle 400s. They were updated when the defects were fixed.

Always ask whether the behaviour you are asserting is correct.

### 4. Name the test

"IDOR tested, all good" with no test named is **worse than saying nothing**, because it stops anyone looking again.

An assertion that a control passed is not evidence. The evidence is the test name and its result.

## The Unwaivable Set

A multi-tenancy finding is **not waivable by anyone** — not for a deadline, not for a demo, not with a follow-up ticket.

| Must pass | |
|---|---|
| Two-tenant IDOR sweep on every `:id` route | **404**, not 403, not 200 |
| The deny branch — an authenticated principal with no tenant sees zero rows | |
| Every mutation writes an audit row, **in its transaction** | |
| A rolled-back action leaves **no** audit row | |
| `audit_logs` has no reachable delete path — **as the application role** | |
| No secret in any response, log, or `audit_logs.changes` | |

Full list: [`../SECURITY/11-SECURITY-TESTING.md`](../SECURITY/11-SECURITY-TESTING.md).

## `createTwoTenants()` Is Load-Bearing

The IDOR sweep is the most important test in the project, and whether it gets written for a new endpoint is decided by how many lines its setup takes.

**A one-line fixture gets used. Twenty lines of setup gets skipped**, and the sweep decays into covering only what someone had time for.

## Mutation Checking

Where a test guards something load-bearing, prove the test works by **breaking the thing**:

- drop a database constraint → the right test fails
- remove a key from the redaction set → the right test fails
- delete a tenant predicate → the IDOR sweep fails

**A test nobody has ever seen fail is a test nobody knows is connected.**

## What Each Layer Cannot Tell You

| Question | Answered by |
|---|---|
| Does the client send the right request? | mock contract test |
| **Does the endpoint exist?** | **live E2E** |
| **Does it return the envelope we expect?** | **live E2E** |
| **Is the tenant predicate applied?** | **live E2E, two tenants** |
| Does the screen render correctly? | component test |
| Does the whole flow work? | browser suite |
| Does the control actually exist? | **mutation check** |

## Operational Rules for the Live Suite

Both learned by breaking things.

**Never suspend the default tenant.** It suspends the super-admin who lives in it and 403s every subsequent request; recovery required a direct database update. Three specs originally grabbed `/tenants/all` `data[0]` in `beforeAll` and did exactly this. Create a **disposable** tenant.

**Watch the rate limiter.** The global budget is 5,000/15 min in production and 100,000 otherwise. Repeated verification runs have exhausted it and produced failures unrelated to the code under test.

## Current State, Stated Honestly

| | |
|---|---|
| Backend coverage gate | **failing** |
| Live E2E | every fix verified **individually**; **no clean full-suite pass in one uninterrupted run** |
| Browser suite | passing, with two deliberately retained expected-failure markers |
| CI | **deferred** — gates run in `pre-push` and `make verify` |

A suite that has never passed as a suite has not passed. Saying so is more useful than a status report that rounds up.

## Deliberately Retained Failures

Two browser markers are kept rather than deleted to make the suite look green:

| Marker | Note |
|---|---|
| User-edit modal, fuller-payload persistence | the backend was verified to persist correctly; the UI marker stands |
| A role display-name assertion | |

**A suite made green by deleting the failing test tells you nothing.**

The tenant-create marker was the reverse case: a `test.fail()` whose own comment predicted it would flip when the backend was fixed — and it did.

## Demo Data Has Diagnostic Value

`SEED_DEMO=true` seeds ~80 rows across every business module, idempotently, with teardown.

Defect #15 — the certificate list returning zero rows because four includes were INNER JOINs — was **only visible once there was data**. An empty database hides an entire class of query defect.

**`SEED_DEMO` must never be true in production.**

## Running Everything

```bash
make verify         # lint + typecheck + test + build
make test-e2e       # 51 live specs against a running server
make test-browser   # Playwright
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## Where to Go Next

| Layer | Document |
|---|---|
| Unit | [`01-UNIT-TESTING.md`](./01-UNIT-TESTING.md) |
| Integration | [`02-INTEGRATION-TESTING.md`](./02-INTEGRATION-TESTING.md) |
| Live E2E | [`03-E2E-TESTING.md`](./03-E2E-TESTING.md) |
| Security | [`04-SECURITY-TESTING.md`](./04-SECURITY-TESTING.md) |
| Performance | [`05-PERFORMANCE-TESTING.md`](./05-PERFORMANCE-TESTING.md) |
| Browser | [`06-BROWSER-TESTING.md`](./06-BROWSER-TESTING.md) |
| Acceptance | [`07-ACCEPTANCE-TESTING.md`](./07-ACCEPTANCE-TESTING.md) |
