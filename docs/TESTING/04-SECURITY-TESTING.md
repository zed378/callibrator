# 04 — Security Testing

The full suite and the rules that keep it honest are in [`../SECURITY/11-SECURITY-TESTING.md`](../SECURITY/11-SECURITY-TESTING.md). This document is how it fits the testing pyramid, and what to run when.

---

## Unwaivable

**A multi-tenancy finding is not waivable by anyone.** Not for a deadline, not for a demo, not with a follow-up ticket.

Everything else is negotiable with a recorded decision naming **who agreed**.

## Where Each Control Is Tested

| Control | Layer |
|---|---|
| Tenant scoping hooks, deny branch | **integration** — the hooks fire only on real queries |
| Cross-tenant 404 on every `:id` route | **live E2E** |
| Permission gate present on a route | **live E2E** |
| Role level resolution | unit |
| `audit_logs` has no delete path | **integration, as the application role** |
| Secrets absent from responses | unit + live E2E |
| Log redaction | unit, **with a mutation check** |
| Rate limiting | live E2E |
| Upload scanner fail-closed | integration |
| SSRF on tenant-supplied endpoints | integration |
| Certificate verification tamper-evidence | live E2E |

Nothing security-relevant is proven by a mock alone.

## The Four Rules That Catch a Worthless Test

### 1. Test grants as the **application role**

```sql
-- as the OWNER this succeeds whether the REVOKE exists or not
DELETE FROM audit_logs WHERE id = '…';
```

A permission test run as the database owner passes unconditionally. **It is worse than no test** — a green tick for an absent control.

### 2. A self-verifying test proves consistency, never correctness

A redaction test iterating the same key set the redactor uses **cannot catch a key being deleted** from that set. Both sides change together; the test stays green.

Fix: an independently maintained list, or a mutation check.

### 3. A mock proves the client, not the contract

3,863 tests passed while 13 endpoints were broken. Security controls live on the server; only a live call exercises them.

### 4. Name the test

"IDOR tested, all good" with no test named is **worse than silence**, because it stops anyone looking again.

## The IDOR Sweep

```
1. createTwoTenants()
2. as A, create a resource on every :id route
3. as B: GET / PUT / PATCH / DELETE  →  404, not 403, not 200
4. as B: list the collection          →  A's resource absent
```

**404, not 403.** A 403 confirms the resource exists, turning id enumeration into a tenant-membership oracle.

`createTwoTenants()` as a one-line fixture is what decides whether this gets written for a new endpoint.

### The one known oracle

`calibration_devices.serialNumber` is `unique: true` **globally**, not per tenant. A create failing on uniqueness reveals that another tenant holds that serial.

The fix is a composite unique on `(tenant_id, serial_number)`. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

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

Plus the sweep that catches the silent failure: **every seeded role has a `ROLE_LEVELS` entry.** A role missing from that map fails every privileged gate with nothing explaining why.

### The gap nothing tests

**A new route with no permission gate works for everyone with a token**, and nothing fails the build. There is no guard that fails a route lacking `dynamicAccess` or `rbac`.

That is the single most likely authorization defect in the codebase, and building the guard is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Compliance Assertions

| Assertion |
|---|
| every mutating endpoint writes an audit row, **in the action's transaction** |
| a **rolled-back** action leaves no audit row |
| approving a `draft` certificate → **409**, not 500 and not 200 |
| signing writes `meaning`, `authMethod` and `documentHash` |
| a purge **skips an entity under legal hold** older than the window |
| erasure anonymises and leaves `performedBy` resolvable |
| verification: valid, expired, revoked, tampered, unknown |
| **unknown and tampered return identical shapes** |
| verification requires no authentication |

The last two matter together: distinguishing "not found" from "signature mismatch" is a certificate-number oracle.

## Secret Assertions

| Assertion |
|---|
| no response contains `password`, `mfaSecret`, `otpCode`, `privateKey`, storage credentials |
| **`iotDeviceToken` is absent from device LIST responses** |
| logs contain no bearer token at any nesting depth, under any key name |
| **`audit_logs.changes` contains no secret** for any mutating endpoint |
| the app **exits** without `CERT_SIGNING_SECRET`, `ENCRYPT_KEY`, `ATTACHMENT_URL_SECRET` |
| equal JWT access and refresh secrets are rejected |
| a live provider key with `NODE_ENV != production` is rejected |

`audit_logs.changes` is the highest-consequence: the table is append-only with **no delete path**, so anything landing there is permanent.

The last one cannot be done per-field. A live Stripe key passes every shape, length and format check and **will charge a real card from a test** — only a cross-field rule catches it.

## Fail-Open Assertions

Every optional subsystem made a fail-open/fail-closed choice. Test the closed side.

| Assertion |
|---|
| a **scanner error** rejects the upload (`VIRUS_SCAN_FAIL_OPEN=false`) |
| no tenant context → **zero rows**, not all rows |
| production with no `CORS_ORIGIN` → **rejects** |
| WebAuthn with Redis unavailable → **fails**, not bypasses |

**Watch for any change that flips one of these toward convenience.** The RLS policy that was removed had exactly that shape: `app.current_tenant = ''` matched every row.

## SSRF Assertions

| Assertion |
|---|
| a tenant-supplied webhook URL to `169.254.169.254` → refused |
| a tenant-supplied webhook URL to an internal hostname → refused |
| a tenant-supplied S3 endpoint to an internal address → refused |
| an **operator-configured** internal endpoint still works |

The last one matters: a fix that blocks internal endpoints everywhere breaks the normal compose configuration, where `http://minio:9000` is correct.

## Mutation Checking

Where a test guards something load-bearing, **break the thing**:

```
drop a database constraint      → the right test fails
remove a redaction key          → the right test fails
delete a tenant predicate       → the IDOR sweep fails
remove a permission gate        → the authorization test fails
```

**A test nobody has ever seen fail is a test nobody knows is connected.**

## What Runs When

| Moment | Runs |
|---|---|
| `pre-push` | secret scan, IDOR enforcement script |
| `make verify` | the same, plus lint, types, unit, build |
| `make test-e2e` | the live IDOR sweep and authorization negatives |
| Before a release | everything, plus the unwaivable set **named** in the release record |

The secret scanner works: on its first run it flagged the project's own JWT test fixture.

## Not Yet Done

| Gap | |
|---|---|
| Penetration test | none performed |
| Automated dependency advisory gate | not in CI |
| Route-gate build guard | **not built** |
| Post-migration column verification in CI | not built |
| Load and abuse testing at scale | see [`05-PERFORMANCE-TESTING.md`](./05-PERFORMANCE-TESTING.md) |

Listed rather than omitted. A security-testing document that names only what passes is a marketing document.
