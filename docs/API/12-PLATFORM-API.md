# 12 — Platform API

Cross-cutting platform services: audit, search, reports, dashboard, notifications, workflows, feature flags, batch jobs, network security, admin and migration.

---

## `/api/v1/audit` — 1 endpoint

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/` | `security` read | query the audit trail |

`audit_logs`: `tenantId`, `userId`, `action` (`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `APPROVE`, `EXPORT`), `resourceType`, `resourceId`, `changes` (JSONB with before and after), `ipAddress`, `userAgent`.

**One endpoint, read-only, and that is the design.** There is no create, no update, no delete. Rows are written by `auditLog.middleware.js` inside the transaction of the action they describe — an audit row that survives a rolled-back action records something that did not happen.

`audit_logs` is the one significant table with **no** `paranoid` flag and no delete path. The absence is the control (BR-6).

`resourceId` is a `STRING`, not a `UUID`, because some audited resources are not UUID-keyed.

Filters: `action`, `resourceType`, `resourceId`, `userId`, date range. Exports run as batch jobs and are themselves audited as `EXPORT` — knowing who extracted the audit trail is part of the audit trail.

## `/api/v1/search` — 1 endpoint

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | cross-entity full-text search |

Backed by the search vectors from migration `0003-add-search-vectors`.

Search is a common place for tenant isolation to leak, because it queries many tables at once and one missed predicate is enough. Every branch of the union must carry the tenant filter, and this is the endpoint worth re-reading after any change.

## `/api/v1/reports` — 5 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/summary` | headline figures |
| GET | `/compliance` | which devices were in and out of interval over a period |
| GET | `/calibration-workload` | forecast workload |
| GET | `/overdue-devices` | what is overdue now |
| GET | `/inventory` | device and stock register |

Large exports run as batch jobs. A full audit-trail export for a busy tenant will exceed the 30-second timeout, and a report that dies halfway is worse than one that takes five minutes and says when it is ready.

## `/api/v1/dashboard` — 1 endpoint

| Method | Path | Purpose |
|---|---|---|
| GET | `/metrics` | every dashboard tile in one response |

One endpoint rather than a dozen, deliberately. A dashboard that fans out to twelve endpoints is twelve chances to leak a tenant predicate and twelve round trips on a hospital network.

## `/api/v1/notifications` — 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list for the current user |
| POST | `/test` | send a test notification |
| PATCH | `/read-all` | mark all read |
| PATCH | `/:notificationId/read` | mark one read |
| DELETE | `/all` | dismiss all |
| DELETE | `/bulk` | dismiss many |
| DELETE | `/:notificationId` | dismiss one |

The `DELETE` verbs write `notification_states.deletedAt` for **this user only**. The `notifications` row survives, which is what makes "why was I not told" answerable.

Types: `SYSTEM`, `CALIBRATION`, `INVENTORY`, `MAINTENANCE`.

Realtime arrival is over Socket.IO into the tenant room; these endpoints are the durable list.

## `/api/v1/workflows` — 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/instances/pending` | approvals awaiting me |
| POST | `/instances/:instanceId/action` | approve or reject |
| GET | `/` | list workflow definitions |
| POST | `/` | create |
| GET | `/:id` | one |
| PUT | `/:id` | update |
| DELETE | `/:id` | delete |

`workflows`: `name`, `resourceType` (`Certificate`, `StockTransfer`, `MaintenanceWorkOrder`), `isActive`.
`workflow_steps`: `stepOrder`, `roleId`, `requiredApprovals`.
`workflow_instances`: `workflowId`, `resourceId`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), `currentStepOrder`.
`workflow_actions`: `instanceId`, `stepId`, `userId`, `action` (`APPROVED`, `REJECTED`), `comments`.

The `resourceType` ENUM is a **closed set of three**. A generic "any resource" engine would need a generic permission model, and the menu-group model is not generic.

### The `db` versus `sequelize` defect

`POST /workflows`, `PUT /workflows` and submit-action all 500ed because `workflow.service` destructured `db` from the models barrel — which exports `sequelize`, not `db` — making `db.sequelize` undefined at `transaction()`.

Fixed in three places. The general rule: `const { sequelize } = require("../models")`.

A step advance and its `workflow_actions` row are written in **one transaction**. A decision without a record is unauditable.

## `/api/v1/feature-flags` — 6 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | flags for the current tenant |
| GET | `/definitions` | the flag catalogue |
| GET | `/:tenantId/:flagKey` | one flag |
| POST | `/:tenantId/initialize` | seed defaults |
| POST | `/:tenantId/:flagKey` | set `{ enabled }` |
| DELETE | `/:tenantId/:flagKey` | clear |

Both `tenantId` and `flagKey` are **path parameters**. The validator originally required them in the body and 400ed every request; it now merges `{ ...req.params, ...req.body }` first.

## `/api/v1/jobs` — 3 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list batch jobs |
| GET | `/:id` | job detail and progress |
| POST | `/test` | enqueue a test job |

`batch_jobs`: `type`, `status` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), `progress`, `totalItems`, `processedItems`, `resultUrl`, `errorDetails`.

**`PROCESSING` is not a resting state.** A job stuck there is indistinguishable from one that is working, and a worker crash must leave the row recoverable — reclaimed by another consumer, or swept to `FAILED`. This is the failure mode most worth testing.

`BATCH_JOBS_INLINE=true` processes in-process for local development, no broker needed. Leave it unset in production; inline mode makes the job synchronous with whatever triggered it, reintroducing the timeout it exists to avoid.

## `/api/v1/network-security` — 5 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/ip-allowlist` | read |
| PUT | `/ip-allowlist` | write |
| GET | `/geofence` | read |
| PUT | `/geofence` | write |
| POST | `/evaluate-login` | evaluate a login against the policy |

An IP allowlist that locks out the only administrator is a self-inflicted outage with no in-product recovery. Any write here should be confirmed against the caller current address before it takes effect.

## `/api/v1/admin` — 3 endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/tenants` | `SUPERADMIN` | cross-tenant listing |
| PATCH | `/tenants/:id/status` | `SUPERADMIN` | set status |
| PATCH | `/tenants/:id/flags` | `SUPERADMIN` | set flags |

Every call here bypasses tenant scoping by role. Every call must be audited.

## `/api/v1/migration` — internal

Mounted from `src/routes/internal/` — the only router outside `routes/api/`.

Runs and inspects database migrations over HTTP. That capability is genuinely dangerous and exists because the platform ships as a **compiled binary with no shell in the runtime image**: without it there is no way to run a migration in a deployed container.

Also carries the demo seeder:

| Endpoint | Gate | Effect |
|---|---|---|
| `GET /api/v1/migration/seed-demo` | `SEED_DEMO=true` | ~80 demo rows across every business module, idempotent, with teardown |

**`SEED_DEMO` must never be true in production.** A demo seeder running against real data is a data-integrity incident.

## Unauthenticated Health

| Endpoint | Returns |
|---|---|
| `GET /health` | 200 with uptime, memory, pid, node version, `database: "connected"`; **503** with `database: "disconnected"` |
| `GET /` | 200 liveness |

`/health` calls `db.authenticate()`, so it is a genuine readiness probe. Using it as a liveness probe would restart a healthy process during a database blip.
