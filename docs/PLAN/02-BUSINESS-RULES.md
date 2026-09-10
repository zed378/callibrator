# 02 — Business Rules

Rules are stated as `BR-<n>`. A business rule is a constraint that must hold regardless of which surface is used to reach the data — API, UI, batch job, or a direct service call. Where a rule is enforced in more than one place, the **enforcement point of record** is named; that is the one that must never be removed.

A rule with no enforcement point is an aspiration. Every rule below names one.

---

## BR-1 — Tenant isolation is deny-by-default

No tenant-scoped query may return rows belonging to another tenant, and a query executed by an authenticated principal that has no resolvable tenant must return **nothing**, not everything.

**Enforcement point of record:** `backend/src/utils/tenantScope.util.js`. Global Sequelize hooks inject a mandatory tenant predicate into every query touching a tenant-scoped model. When no tenant can be resolved, the predicate becomes `tenantId = '00000000-0000-0000-0000-000000000000'` — a syntactically valid UUID no tenant will ever own, chosen over a sentinel string so the database returns zero rows instead of raising a type error and turning a denial into a 500.

**Deliberate exemptions**, each of which is greppable:

| Condition | Behaviour | Why |
|---|---|---|
| `options.skipTenantScope` | skip | explicit, auditable opt-out at a call site |
| no CLS context | skip | pre-auth login/register, public endpoints, migrations, schedulers |
| `context.isSystemTask` | skip | background work that must span tenants |
| `context.isSuperAdmin` | skip | cross-tenant operator, by design |

This replaced PostgreSQL Row Level Security, which was removed (ADR-029). RLS was Postgres-only, and its policy carried a fail-open branch: `app.current_tenant = ''` matched every row.

## BR-2 — A user has exactly one tenant and exactly one role

`users.tenantId` and `users.roleId` are single-valued. There is no user-to-tenant or user-to-role join table. A user needing access to two tenants needs two accounts.

**Enforcement point of record:** the schema — `backend/src/models/user.model.js`.

**Consequence to know:** because role is single-valued, permission breadth is expressed through menu-group grants and per-user overrides (BR-4), never by stacking roles.

## BR-3 — A suspended tenant blocks every request from its users

Setting `tenants.status = 'suspended'` must reject every subsequent authenticated request from that tenant with a clear message, not merely hide the UI.

**Enforcement point of record:** `backend/src/middlewares/auth.middleware.js`.

**Operational trap, learned the hard way:** suspending the default tenant suspends the super-admin who lives in it, which 403s every subsequent request including the one that would un-suspend it. Recovery required a direct database update. Any test or script that suspends a tenant must create a disposable one first — see [`../TESTING/03-E2E-TESTING.md`](../TESTING/03-E2E-TESTING.md).

## BR-4 — Effective permission is role grant, then user override

A user sees a menu group if their role has a `role_menu_permissions` row for it, unless a `user_menu_permissions` row for that user and menu group overrides it. `write` implies `read`. `SUPERADMIN` short-circuits the whole resolution.

**Enforcement point of record:** `backend/src/middlewares/dynamicAccess.middleware.js`.

## BR-5 — Role level, not role name, gates privileged operations

Where an operation is restricted to "tenant administrators or above", the check compares `ROLE_LEVELS` numerically. `TENANT_ADMIN` is a **logical tier at level 8**, not a seeded database role; it exists so that both `HEALTHCARE ADMIN` and `CALIBRATOR ADMIN` satisfy one gate.

**Enforcement point of record:** `backend/src/constants/roleConstants.js` and `rbac.middleware.js`.

**Consequence:** adding a new administrative role means adding it to `ROLE_LEVELS`. A role absent from that map is treated as the lowest privilege, which fails closed — correct, but silently.

## BR-6 — Every mutation is audit-logged, and audit rows are never deleted

Create, update, delete, login, approve and export all write an `audit_logs` row carrying the actor, the resource type and id, the before and after state in `changes`, the IP address, and the user agent.

`audit_logs` is the one significant table with **no** `paranoid` flag and no delete path — the absence is the rule.

**Enforcement point of record:** `backend/src/middlewares/auditLog.middleware.js`.

## BR-7 — Calibration records are append-only

A calibration record is evidence. Correcting a result means writing a new record that supersedes the old one, never editing the original. The same applies to certificates once signed: the transition out of `signed` is `revoked`, not back to `draft`.

**Enforcement point of record:** the `certificates.status` state machine (BR-8) plus the append-only convention in `calibrationRecords.service.js`.

**Known gap:** unlike `audit_logs`, `calibration_records` is `paranoid` and therefore soft-deletable by a sufficiently privileged caller. The append-only property is currently a service-layer convention rather than a database constraint. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## BR-8 — The certificate state machine has no shortcuts

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──sign──▶ signed
                                                                     │
                                                                  revoke
                                                                     ▼
                                                                  revoked
```

Approving a `draft` is not a validation failure and not a server error — it is a **conflict**, and returns **409**. Before ADR-035 it threw a plain `Error` and surfaced as a 500, which made approval unreachable because no submit transition existed.

**Enforcement point of record:** the model transition methods in `backend/src/models/certificate.model.js`, surfaced by `certificates.route.js`.

## BR-9 — A signature must record what it means

An electronic signature that records only "user X signed at time T" does not satisfy 21 CFR Part 11. Every `e_signature_records` row carries `meaning` (why the signature was applied), `authMethod` (`password`, `mfa`, or `sso`), and `documentHash` (what exactly was signed), alongside actor, IP and user agent.

**Enforcement point of record:** `e_signature_records` column nullability plus `eSignature.service.js`.

## BR-10 — Stock transfers are a state machine with two warehouses

A transfer references `fromWarehouseId` and `toWarehouseId`, and moves `pending → in_transit → completed`. `cancelled` is reachable from `pending` and `in_transit` only. Quantity leaves the source when the transfer enters `in_transit` and arrives at the destination on `completed` — never both at once, and never neither.

**Enforcement point of record:** `backend/src/services/stock.service.js`, inside a transaction.

## BR-11 — A device out of interval is a reportable state, not an error

Passing `nextCalibrationDate` does not disable a device or block operations. It changes what the scheduler and dashboards report. Business consequence is the responsibility of the operating facility; the platform makes the fact impossible to miss, not impossible to have.

**Enforcement point of record:** `calibrationScheduler.service.js`.

## BR-12 — Risk priority number is derived, never stored

`risks.rpn` is a Sequelize `VIRTUAL` column computed from `severity` and `likelihood`. It must not be persisted, because a stored RPN can disagree with its own inputs after an edit and there is then no way to tell which is right.

The same reasoning applies to `supplier_scorecards.overallScore`, also `VIRTUAL`.

**Enforcement point of record:** the model definitions.

## BR-13 — The support desk has two sides and the platform operator is only on one

`SUPERADMIN` is a cross-tenant **responder**. It holds `tickets-response` and deliberately does **not** hold `tickets-raise` — the platform operator answers tickets and never raises them. Every other role holds `tickets-raise`.

**Enforcement point of record:** `ROLE_MENU_ASSIGNMENTS` in `roleConstants.js`, plus `RESPONDER_ROLES` in the ticket service.

## BR-14 — A tenant may bring its own storage bucket

Object storage resolves per tenant first, then falls back to the platform default (`STORAGE_DRIVER`). Tenant-supplied S3 endpoints are SSRF-checked; operator-configured endpoints are not, because they are allowed to be internal (`http://minio:9000`).

**Enforcement point of record:** `backend/src/services/storage/`.

## BR-15 — Quota is enforced before the work, not after

Seat and storage limits (`tenants.limitSeats`, `tenants.limitStorageMb`) and metric quotas (`plan_quotas`) are checked by middleware ahead of the handler, so a rejected request never performs a partial write.

**Enforcement point of record:** `backend/src/middlewares/enforceQuota.middleware.js`.

## BR-16 — Purge respects legal hold

A data-retention purge must skip any entity under legal hold, regardless of age. A retention policy that outranks a legal hold is a compliance incident, not a feature.

**Enforcement point of record:** `dataRetention.service.js`.

## BR-17 — Soft delete writes `isDeleted`, not `is_deleted`

Models in this codebase are `underscored`, so the database column is `is_deleted` while the Sequelize attribute is `isDeleted`. Writing the snake_case name in application code silently does nothing.

Related: a scoped `include` must carry `required: false`, or it becomes an INNER JOIN and drops every parent row whose optional association is null. This has caused at least two production-visible list-returns-empty defects (see [`../ARCHIVE/2026-07-fullstack-integration-audit.md`](../ARCHIVE/2026-07-fullstack-integration-audit.md), defects 3 and 15).

**Enforcement point of record:** convention plus the model `defaultScope`. There is no mechanism preventing the mistake; it is caught in review and by tests.
