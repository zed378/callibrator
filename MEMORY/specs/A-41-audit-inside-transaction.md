# Feature Spec — A-41 Audit rows inside the transaction (with A-42 and W-04 retention purge)

**Written:** 2026-09-24 — **before** implementation
**Task:** A-41 (with A-42, and the retention-purge half of W-04)
**Author:** Claude (agent), for Zed
**Spec refs:** `CLAUDE.md` § Non-Negotiables · `docs/DATABASE/10-AUDIT-LOGS.md` · `docs/BACKEND/02-SERVICE-LAYER.md` § Audit rows go inside · `TASKS/AUDIT-2026-09-REMEDIATION.md` A-41, A-42 · `TASKS/AUDIT-2026-09-ASYNC.md` W-04, W-16

---

## Problem

The audit trail is the evidence that 21 CFR Part 11 §11.10(e) and ISO 17025 §7.5/§8.4 attribution rests on. Today it is not written the way the rule requires.

1. **A-41.** `middlewares/auditLog.middleware.js#recordAudit` writes on `res.on("finish")` — after the response, outside any transaction. It is wired on **three routes only** (`user.route.js`: user create/update/delete). **No certificate, calibration-record, role or permission mutation writes an audit row at all**, by middleware or service. Certificates have `e_signature_records`, which answer a different question (`10-AUDIT-LOGS.md` § Relationship).
2. **A-42.** `services/audit.service.js#logAction` catches a failed insert, sends it to `console.error`, and returns `null`. Production has no Console transport. A compliance record that fails to write fails silently and durably.
3. **A defect found while writing this spec.** `eSignature.service.js#signDocument` and `#revokeSignature` write `action: "DOCUMENT_SIGNED"` / `"SIGNATURE_REVOKED"` and columns `entityType`, `entityId`, `before`, `after` that do not exist. `action` is an ENUM without those members and `resourceType` is `NOT NULL`, so **every one of those inserts fails** — after the `SignatureRecord` and the step update have already committed (no transaction). The signer sees a 500, the signature exists, and nothing records it in `audit_logs`. The unit test (`esignature.signing.test.js`) asserts `action: "DOCUMENT_SIGNED"` against a mock that accepts any string — the exact failure mode described for the `RESTORE` near-miss.
4. **W-04 (retention half).** `dataRetention.service.js#purgeExpiredRecords` is the only code that permanently destroys `audit_logs`, and it records nothing about doing so.

Persona: the QA / compliance officer answering an auditor's "who approved certificate C, and show me the record" — and the inspector asking "what did your retention job delete, and when?".

---

## What `docs/` Already Decides

| Decision | Source |
|---|---|
| The audit row is written in the **same transaction** as the action it describes | `CLAUDE.md`; `10-AUDIT-LOGS.md` § Written Inside the Transaction; `02-SERVICE-LAYER.md` § Audit rows go inside |
| The six actions and when each is used; `APPROVE` is a decision, not a field change | `10-AUDIT-LOGS.md` § The Six Actions |
| `changes` carries `before` **and** `after` | `10-AUDIT-LOGS.md` § changes |
| Nothing secret reaches `changes` (append-only, permanent) | `10-AUDIT-LOGS.md`; `02-SERVICE-LAYER.md` |
| `audit_logs` is not the same thing as `e_signature_records`; Part 11 needs both | `10-AUDIT-LOGS.md` § Relationship |
| The service orchestrates the audit row, signature record and notification inside a transaction; the model owns legal transitions | `02-SERVICE-LAYER.md` |
| A rollback test must assert **no audit row** | `02-SERVICE-LAYER.md` § tests |

### Where `docs/` is wrong or silent — stop and record

| Gap | Handling |
|---|---|
| `10-AUDIT-LOGS.md` says `audit_logs` has **"no delete path anywhere in the codebase"** and is managed by **"nothing"** (BR-6). The retention purge deletes `audit_logs` rows older than `AUDIT_LOG_RETENTION_DAYS` (default 365) every night. The doc is wrong about the code, and the code contradicts a stated compliance control. | **Not decided here.** Whether `audit_logs` may be purged at all is a compliance decision, not an engineering one (the doc says so itself). This task makes the purge **record itself**, which is right under either answer. Raised as an Open Question below; the doc correction needs an ADR under the deviation protocol and is left to the owner — this task's file scope does not include `docs/`. |
| The doc says "the write path is middleware". After this task the write path for the compliance-critical set is **the service, inside its transaction**; the middleware remains for the rest. | Same — flagged for the doc amendment, not edited quietly. |
| Roles (`roles`, `role_menu_permissions`) are **global**, but `audit_logs.tenantId` is `NOT NULL`. `docs/` does not say which tenant a global change is recorded under. | Decided in § Business Rules (BR-A41-4); an Open Question for the owner to confirm. |

---

## Decision — does a failed audit write fail the transaction? (A-42)

**Yes, inside a transaction. No, outside one.**

| Call shape | On a failed insert |
|---|---|
| `logAction(entry, { transaction })` — the compliance-critical set | logged through winston at `error` **and re-thrown**. The caller's transaction rolls back; the mutation does not commit; the client gets an error. |
| `logAction(entry)` — no transaction (the middleware path, after the response) | logged through winston at `error`, returns `null`. |

**Why.** For the compliance-critical set, "the action happened but nobody can say who did it" is the failure Part 11 §11.10(e) exists to prevent. Refusing the action is recoverable — the user retries; letting it commit unattributed is not. So the audit insert is a precondition of the commit, exactly like any other row in the transaction.

**Why not everywhere.** On the middleware path the response has already been sent and the mutation already committed in its own transaction. Throwing there cannot undo anything; it would only crash a `finish` listener. What it *can* do is make the failure visible — at `error`, into the file sinks (`log/activity/error/`) that production collects — with the tenant, actor, action, resource type and resource id so the unattributed action can be found and reconciled by hand. That is the honest limit of the middleware path, and it is why the compliance-critical set does not use it.

**An invalid `action`** (anything outside the ENUM) is rejected by `logAction` **before** the insert, with the same rule: re-thrown inside a transaction, logged and dropped outside one. PostgreSQL would reject it anyway; checking first makes the failure name the value, and makes a unit test fail on it without a database.

---

## The Compliance-Critical Set — audited **inside the transaction**

Each row below: the mutation and its audit row commit together or not at all. "Rows in the transaction" lists what the transaction covers.

| # | Service function | Action | resourceType | Rows in the transaction |
|---|---|---|---|---|
| 1 | `certificate.service#createCertificate` (issue) | `CREATE` | `Certificate` | certificate insert, audit row. (`workflowService.startWorkflow` runs **after** commit — see Rollout) |
| 2 | `certificate.service#updateCertificate` | `UPDATE` | `Certificate` | certificate update, audit row |
| 3 | `certificate.service#deleteCertificate` | `DELETE` | `Certificate` | soft delete, audit row |
| 4 | `certificate.service#submitCertificateForApproval` | `UPDATE` | `Certificate` | status draft→pending_approval, audit row |
| 5 | `certificate.service#approveCertificate` | `APPROVE` | `Certificate` | status →approved, `ESignatureRecord`, audit row |
| 6 | `certificate.service#signCertificate` | `APPROVE` | `Certificate` | status →signed, `ESignatureRecord`, audit row |
| 7 | `certificate.service#revokeCertificate` | `UPDATE` | `Certificate` | status →revoked, `ESignatureRecord`, audit row |
| 8 | `calibrationRecords.service#createCalibrationRecord` | `CREATE` | `CalibrationRecord` | record insert, device `nextCalibrationDate`, audit row |
| 9 | `calibrationRecords.service#updateCalibrationRecord` | `UPDATE` | `CalibrationRecord` | record update, audit row |
| 10 | `calibrationRecords.service#deleteCalibrationRecord` | `DELETE` | `CalibrationRecord` | soft delete, audit row |
| 11 | `eSignature.service#signDocument` | `APPROVE` | `SignatureWorkflow` | `SignatureRecord`, step →signed, workflow →completed **or** next step →pending, audit row. (Emails after commit.) |
| 12 | `eSignature.service#revokeSignature` | `UPDATE` | `SignatureRecord` | signature →revoked, audit row |
| 13 | `attachment.service#deleteAttachment` | `DELETE` | `Attachment` | **already correct** (A-28, 2026-09-23); moved onto `logAction` |
| 14 | `sop.service#publishDocument` | `APPROVE` | `SopDocument` | **already correct** (A-28); moved onto `logAction` |
| 15 | `tenantBackup.service#restoreBackup` | `UPDATE` (+ `operation: "RESTORE"`) | `TenantBackup` | **already correct**; moved onto `logAction` |
| 16 | `roles.service#createRole` | `CREATE` | `Role` | role insert, audit row |
| 17 | `roles.service#updateRole` | `UPDATE` | `Role` | role update, audit row |
| 18 | `roles.service#deleteRole` | `DELETE` | `Role` | destroy (or deactivate + revoke grants for a system role), audit row |
| 19 | `roles.service#assignMenuToRole` | `UPDATE` | `Role` | grant upsert, audit row |
| 20 | `roles.service#removeMenuFromRole` | `UPDATE` | `Role` | grant delete, audit row (only when a grant was removed) |
| 21 | `roles.service#assignRoleToUser` | `UPDATE` | `User` | `users.role_id`, audit row |
| 22 | `roles.service#removeRoleFromUser` | `UPDATE` | `User` | `users.role_id = null`, audit row |
| 23 | `userPermission.service#setUserPermission` | `UPDATE` | `User` | override upsert, audit row |
| 24 | `userPermission.service#removeUserPermission` | `UPDATE` | `User` | override delete, audit row (only when an override was removed) |
| 25 | `dataRetention.service#purgeExpiredRecords` (**W-04**) | `DELETE` | `DataRetention` | the three purges **and** one audit row naming what was destroyed (only when something was) |

**One entry point.** Every row above writes through `auditService.logAction(entry, { transaction })`. The existing A-28/backup sites wrote `AuditLog.create(…, { transaction })` directly; they are moved onto `logAction` so there is one pattern, with the ENUM guard and the winston record, not two.

**Redis cache invalidation runs after commit**, never inside the transaction: invalidating before the commit lets a concurrent request re-cache the pre-change matrix for the full TTL (W-11's symptom by another route).

## Explicitly left on the middleware, or unaudited, for now

Said plainly so nobody reads this list as complete coverage:

| Left | Where it stands |
|---|---|
| User create / update / delete | `recordAudit` middleware on `user.route.js` — after the response, best-effort, **not** transactional. Next candidate for the set. |
| Every other mutation in the 53 route modules (devices, maintenance, work orders, stock, vendors, kanban, tickets, …) | **no audit row at all today** — neither middleware nor service. Unchanged by this task. |
| Menu-group CRUD (`roles.service#createMenu/updateMenu/deleteMenu`) | unaudited. A menu delete cascades grants; next candidate. |
| E-signature key-pair generate/delete, workflow create/update/cancel/delete | unaudited. Key deletion makes past signatures unverifiable — next candidate. |
| SOP create/update, training acknowledgement | unaudited |
| GDPR erasure / rectification (`gdpr.service.js`) | already writes valid rows, but not inside a transaction with the erasure; rectification swallows the failure at `warn`. Out of this file scope. |
| Login, token refresh, MFA, session revocation | out of scope — `auth.middleware.js` / `session.service.js` are being changed by other work today |
| **W-04 remainder**: tenant offboarding, scheduler-created work orders, IoT ingest | **still open.** Offboarding has never run (W-01) so auditing it first means fixing it; the scheduler and IoT ingest are system actors with no user and need the "system actor" decision below. W-04 stays **live** for these three. |
| **W-16 remainder**: one malformed retention setting silently disables a tenant's purge | still open. The transaction half of W-16 is closed by row 25. |

---

## Data Model

No schema change. `audit_logs` is used exactly as defined in `models/auditLog.model.js`.

- [x] `tenantId` — every row carries one; see BR-A41-4 for global resources.
- [x] ENUM values used: only `CREATE`, `UPDATE`, `DELETE`, `APPROVE`. No new member. Operations with no ENUM member (restore, revoke, purge, submit) are recorded under the nearest action with `changes.operation` naming them — the tenant-restore precedent.
- [x] `AUDIT_ACTIONS` becomes one frozen constant (`constants/appConstants.js`), used by both `logAction` and `recordAudit`. A test asserts it equals the model ENUM, read from `models/auditLog.model.js` — the schema, not the code under test.

## API

No new route and no route change. Controllers change only to pass the actor (`req.user.id`, `req.user.tenantId`, `req.ip`, user-agent) to the services, through one helper, `utils/auditActor.util.js`: certificate create/update/delete/submit, calibration-record create/update/delete, all role mutations, user-permission set/remove.

**Two backward-compatible model changes**, so the transaction is passed explicitly rather than left to CLS: `Certificate#submitForApproval/approve/sign/revoke` and `CalibrationRecord#softDelete` take an optional `options` argument forwarded to `save()`. Production does run `Sequelize.useCLS`, which would join these saves to the managed transaction anyway; nothing else in the codebase relies on that yet, and the tests (`cls: false`) prove the explicit path.

- [x] Status codes unchanged. A failed audit insert on the compliance-critical set surfaces as the insert's error (a 500 via the error handler) **with the mutation rolled back** — never as a 200 over an unattributed change.

## Business Rules

| Rule | Enforcement point |
|---|---|
| **BR-A41-1** A compliance-critical mutation commits only with its audit row | service: one managed `db.transaction`, `logAction(…, { transaction })` re-throws |
| **BR-A41-2** An audit row never survives its mutation's rollback | same transaction — database-enforced once inside it |
| **BR-A41-3** `action` is one of the six | `logAction` pre-check (service) + PostgreSQL ENUM (database) |
| **BR-A41-4** A change to a **global** resource (role, role grant) is recorded under the **actor's** tenant; a change to a **user's** role or override is recorded under **that user's** tenant, falling back to the actor's | service. If neither resolves, the insert fails `NOT NULL` and the change rolls back — fail-closed, deliberately |
| **BR-A41-5** The retention purge records, per tenant, what it destroyed (counts per table and each cutoff), in the same transaction as the deletes | service |
| **BR-A41-6** A failed audit write is logged at `error` through winston with tenant, actor, action, resourceType, resourceId and the error | `logAction` |

## Security

- [x] No raw SQL added. No new `skipTenantScope` / `isSystemTask`.
- [x] `changes` never includes `authPayload` (password / MFA code), private keys, or `signatureValue`. It carries ids, statuses, hashes and reasons.
- [x] Fail-closed choice: BR-A41-1/BR-A41-4. An unresolvable tenant or a broken `audit_logs` refuses the compliance-critical action rather than allowing it unattributed.

## Compliance

- [x] Touches evidence: certificates, calibration records, signatures, audit.
- [x] Append-only: still a **convention** (no `REVOKE UPDATE, DELETE` grant — `10-AUDIT-LOGS.md` recommends it; not in scope).
- [x] Audit row inside the transaction: this is the task.

## Tests

The defect is invisible to a mock that accepts anything, so the tests assert **effects** against a fixture that behaves like the database:

**`src/tests/fixtures/auditLedger.js`** — a transactional in-memory ledger:
- `AuditLog.create` enforces the **real ENUM, read from `models/auditLog.model.js`** through a real (unconnected) Sequelize model, and the model's `NOT NULL` columns; an invalid value throws the PostgreSQL error text.
- `transaction(cb)` stages writes and commits them only if `cb` resolves; a failed statement aborts the transaction. Writes with no explicit `transaction` join the ambient one — the production `Sequelize.useCLS` behaviour (`config/index.js`) — which is how the model instance methods (`certificate.approve()` → `this.save()`) join.
- Tests read **committed** rows only.

Named tests (each shown failing against the pre-change code before the change):

- `audit.service.a42.test.js` — failed write logged at `error` via winston, never `console`; re-thrown inside a transaction; dropped (null) outside one; an invalid `action` is refused.
- `auditLedger.fixture.test.js` — the fixture's ENUM is the model's; `RESTORE` is refused; rollback discards staged rows. (Guards the fixture itself — a fixture that accepts anything is the defect this task is about.)
- `certificate.audit.a41.test.js`, `calibrationRecords.audit.a41.test.js`, `esignature.audit.a41.test.js`, `roles.audit.a41.test.js`, `dataRetention.audit.w04.test.js` — for each: the mutation commits **with** exactly one valid audit row; a mutation whose transaction rolls back leaves **no** audit row; a failing audit insert leaves the mutation **uncommitted**.

## Traps to Avoid

- [x] `const { db } = require("../config")` for the transaction — the pattern the A-28 sites use. **Not** `db` from the models barrel.
- [x] `isDeleted`, not `is_deleted` (calibration record soft delete uses the model's `softDelete`).
- [x] `sessions` uses `tenant_id` in the purge.
- [x] Do not call external side effects (email, workflow start, cache invalidation) inside the transaction.
- [x] Do not write an ENUM value outside the six.

## Open Questions (for `TASKS/BACKLOG.md`)

1. **May `audit_logs` be purged at all?** `10-AUDIT-LOGS.md` says no (BR-6); the code purges after 365 days by default. Needs a compliance decision and an ADR either way.
2. **System actor.** Background jobs have no `userId`. Rows 25 writes `userId: null` with `changes.actor: "system:retention-purge"`. Should there be a first-class system principal? Blocks the rest of W-04.
3. **Tenant of a global change** (BR-A41-4) — confirm the actor's tenant is the right home.
4. `certificate.controller#approveCertificate` accepts `approvedBy` **from the request body** (`validated.approvedBy || req.user.id`). Re-authentication is checked against that id, so it needs that user's password, but the authenticated caller and the recorded approver can differ. Out of scope; flagged.

## Rollout

- [x] No migration.
- [x] Behaviour change a user can see: an audit-insert failure now **refuses** a compliance-critical action instead of letting it commit unattributed. And e-signature signing/revocation, which returned a 500 after committing, now either commits cleanly with its audit row or not at all.
- [x] `createCertificate` → `startWorkflow` stays **after** commit, as before: a workflow-start failure leaves an issued, audited certificate and an error — the same shape as today, now attributable.
- [x] Rollback of this change: revert the commit. No data shape changes.
