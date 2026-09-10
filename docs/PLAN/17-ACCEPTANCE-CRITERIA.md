# 17 — Acceptance Criteria

What "done" means at the product level. Task-level Definition of Done is in [`../../TASKS/00-TASK-CONVENTIONS.md`](../../TASKS/00-TASK-CONVENTIONS.md); this document is the release gate.

Criteria are stated as `AC-<n>` and are pass or fail. "Mostly" is a fail.

---

## Security — Unwaivable

These cannot be waived by anyone. A release that fails one of them does not ship, regardless of schedule.

| ID | Criterion | How it is proven |
|---|---|---|
| AC-1 | No cross-tenant read is possible on any endpoint | Two-tenant IDOR sweep across every `:id` route, asserting 404 (not 403 — see AC-4) |
| AC-2 | An authenticated principal with no resolvable tenant sees zero rows | Direct test of the deny branch in `tenantScope.util.js`, including the `NO_TENANT_UUID` predicate |
| AC-3 | Every mutation writes an audit row with actor, before and after | Sweep asserting an `audit_logs` row per mutating endpoint |
| AC-4 | Non-existent, soft-deleted and not-yours all return the same status | Otherwise the status code leaks existence across the tenant boundary |
| AC-5 | No secret appears in the repository, in logs, or in an error response | Secret scanner in the pre-push gate; log redaction test |
| AC-6 | Rate limiting is active on auth, OTP and global paths | Live assertion of 429 with `X-RateLimit-*` headers |
| AC-7 | Uploads are rejected when the scanner errors, unless `VIRUS_SCAN_FAIL_OPEN` is explicitly set | Test with ClamAV unreachable |
| AC-8 | A suspended tenant cannot make any authenticated request | Test using a **disposable** tenant, never the default |

AC-4 deserves its own note. Returning 403 for "someone else owns this" and 404 for "does not exist" tells an attacker which ids are real. Both must be 404.

## Compliance

| ID | Criterion | How it is proven |
|---|---|---|
| AC-9 | Every calibration record has a non-null `performedBy` | Schema constraint plus a sweep over existing data |
| AC-10 | Every signature records meaning, auth method and document hash | `e_signature_records` nullability plus a signing test |
| AC-11 | `audit_logs` has no reachable delete path | Grep for a delete on the model; database permission check as the application role |
| AC-12 | A certificate cannot be approved from `draft` | Test asserting **409**, not 500 and not 200 |
| AC-13 | A retention purge skips entities under legal hold | Test with a held entity older than the policy window |
| AC-14 | Certificate verification works unauthenticated and detects tampering | Live fetch of a verification URL with a valid, an expired, a revoked and a tampered number |

AC-11 must be checked as the **application role**, not as the database owner. As the owner it passes whether the grant is correct or not, which makes the test worthless.

## Functional

| ID | Criterion |
|---|---|
| AC-15 | A device can be created, calibrated, certified, signed and publicly verified end to end |
| AC-16 | `nextCalibrationDate` recalculates on every calibration write, never by a nightly job |
| AC-17 | An overdue device appears in the scheduler, the dashboard tile and the overdue report consistently |
| AC-18 | A stock transfer moves quantity exactly once — at `in_transit` out, at `completed` in |
| AC-19 | A non-conformance can escalate to a CAPA and be closed with verification |
| AC-20 | A user granted a per-user override sees exactly the resolved effective permission |
| AC-21 | A tenant with its own bucket stores and retrieves attachments through that bucket |
| AC-22 | A batch job reports progress and terminates in `COMPLETED` or `FAILED`, never in `PROCESSING` |
| AC-23 | Notifications arrive over Socket.IO without a page refresh |
| AC-24 | A support ticket raised by a tenant user is visible to a responder and invisible to other tenants |

## API Contract

| ID | Criterion |
|---|---|
| AC-25 | Every endpoint returns the standard envelope: `success`, `status`, `message`, `data`, optional `meta` |
| AC-26 | List endpoints return **rows in `data`** and pagination in a **top-level `meta`** — never `data.rows` or `data.items` |
| AC-27 | Every response carries `X-Request-Id`, exposed through CORS |
| AC-28 | Validation failures return 400 with field detail; they never reach the database |
| AC-29 | Swagger matches the enforced validators |

AC-26 is listed because it has been violated: `GET /qms/nc`, `/qms/capa` and `/sop` returned `{ total, ..., nonConformances: [] }` inside `data`, and every frontend list rendered empty. The envelope is not a style preference; a client written against it breaks silently when it changes.

AC-29 currently **fails** for the GDPR endpoints, where Swagger bodies diverge from the Joi validators. Recorded rather than quietly excluded.

## Performance

| ID | Criterion | Threshold |
|---|---|---|
| AC-30 | Dashboard first paint | under 2s on a hospital network |
| AC-31 | List endpoints, tenant-scoped, p95 | under 500 ms |
| AC-32 | No request exceeds the 30s timeout in normal operation | 408 is a bug signal, not a normal outcome |
| AC-33 | Certificate PDF render | under 5s |
| AC-34 | Frontend Lighthouse performance on the public pages | 90 or above |

## Accessibility

| ID | Criterion |
|---|---|
| AC-35 | WCAG 2.1 AA on every dashboard surface |
| AC-36 | Every interactive element reachable and operable by keyboard |
| AC-37 | Colour contrast at least 4.5:1 for body text in both themes |
| AC-38 | `prefers-reduced-motion` honoured — motion is decoration, never the only signal |

See [`../UI-UX/17-ACCESSIBILITY.md`](../UI-UX/17-ACCESSIBILITY.md).

## Release Gate

Before a release is tagged:

- [ ] Every unwaivable security criterion (AC-1 to AC-8) passes, with the test **named** in the release record
- [ ] Every compliance criterion (AC-9 to AC-14) passes
- [ ] `pnpm test` green across both workspaces, at the configured coverage thresholds
- [ ] `pnpm lint` and `pnpm build` clean
- [ ] Full backend E2E suite green in **one uninterrupted run** against a running server
- [ ] Browser suite green
- [ ] Migrations apply to a clean database **and** to a copy of production data
- [ ] Migrations verified by inspecting the resulting columns, not by trusting the migration log
- [ ] Rollback rehearsed, not assumed
- [ ] `MEMORY/` record written, including anything that failed or was waived and who agreed

An assertion that a test passed is not evidence. Name the test.
