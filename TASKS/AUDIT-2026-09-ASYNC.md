# Audit 2026-09 — The Asynchronous Layer

Everything in this codebase that runs **outside a request**: cron jobs, the `setInterval`
processor, the RabbitMQ producers and consumers, the Redis client and every cache read, the
rate-limiter store, and the MQTT ingest path.

Audited **2026-09-23** against the working tree at `c131729`. Task ids are `W-nn`.

**Nothing here re-reports A-24, A-26, A-30 or A-36.** Those four were verified in the code first —
see [Verification of the four prior async findings](#verification-of-the-four-prior-async-findings)
— and all four fixes are real. Two of them left adjacent work behind, which is filed below as
W-05 and W-18 rather than reopened.

**Evidence standard.** Every card names a file and a line. "Verified from code" means read, not
run: **no broker, no Redis, no second replica and no cluster was available**, and every claim that
needs one to settle says so in its own card.

---

## Summary

| Id | Finding | Severity | Live or latent |
|---|---|---|---|
| W-01 | the tenant-lifecycle processor has **never run**: it filters on a column the model does not define, and on an enum value that does not exist | **high** | **DONE** 2026-09-24 — verified on PostgreSQL 18.6 |
| W-02 | `CALIBRATION_SCHEDULER` is set in **no** deployment file, and the chart's "not the scheduler" branch disables only one of four jobs | **high** | **DONE** 2026-09-25: rendered chart asserted (ADR-060) |
| W-03 | the calibration scan's idempotency guard is a check-then-create race with no lock and no constraint | **high** | **DONE** 2026-09-25: index and live race on PostgreSQL 18.6 (ADR-061) |
| W-04 | **no background mutation writes an audit row** — including the purge that destroys `audit_logs` | **high** | **DONE** 2026-09-25: IoT anomaly, calibration notification and batch-job transitions audited in their transactions; audit rows have no retention window (ADR-069) |
| W-05 | one Redis blip disables Redis **permanently** for that process, silently, restoring the whole A-24 symptom set | **high** | **DONE** 2026-09-24 |
| W-06 | a RabbitMQ consumer is never re-registered: a broker restart ends both workers for the life of the process | **high** | **DONE** 2026-09-25: live broker restart (ADR-061) |
| W-07 | a batch job interrupted by SIGTERM is **acked on redelivery and never runs again** — stuck `PROCESSING`, no DLQ row | **medium–high** | **DONE** 2026-09-25: row claim, heartbeat, sweep, drain (ADR-060) |
| W-08 | batch jobs do nothing: the handler registry is empty and every job reports `COMPLETED`, progress 100, with a download URL | **medium–high** | **DONE** 2026-09-25: unregistered type refused or FAILED; no handlers exist (ADR-060) |
| W-09 | the email retry both re-publishes **and** dead-letters the same message, from an in-process timer that can take the server down | medium | **DONE** 2026-09-25: broker delay queues, one DLQ message, live (ADR-061) |
| W-10 | the nightly "tenant backup" backs up two local folders and not the database; the real backup service is scheduled by nothing | medium | **live** |
| W-11 | a deleted or deactivated role keeps its permissions for up to an hour — cached authorization with no invalidation on that path | medium | **DONE** 2026-09-24 |
| W-12 | every scheduled job runs with **no tenant predicate at all**, and `beforeCreate` does not stamp `tenantId` | medium | **DONE** 2026-09-25: every job declares a context; opt-outs are a closed list (ADR-060, ADR-069) — live on PostgreSQL 18.6 |
| W-13 | silent failure is the norm: every job's failure path ends at `logger.error`, and production writes no stdout (A-14) | medium | **live** |
| W-14 | MQTT ingest fans out to every replica — N duplicate readings and N duplicate alerts per message — with no backpressure | medium | latent (MQTT off) |
| W-15 | the GDPR export ZIP is deleted by a 168-hour in-process timer; a restart leaves exported personal data on disk forever | medium | **live** |
| W-16 | the retention purge has no transaction, and one malformed setting makes a tenant silently never purge | medium | **partial** — transaction added 2026-09-24 |
| W-17 | unbounded result sets and N+1 inside the per-tenant and per-device loops | low–medium | **DONE** 2026-09-25: every scheduled job paged or batched (ADR-069); emit-path first attempts capped, the scan commits per tenant chunk, offboarding builds no export (ADR-073) — live on PostgreSQL 18.6 |
| W-18 | connection and timer lifecycle: two AMQP connections per process, one never closed, no in-flight memo on either getter | low–medium | **DONE** 2026-09-25: one connection, one close (ADR-061) |
| W-19 | the rate limiter's memory fallback has lazy expiry only — no sweep, unbounded growth | low | **live** |
| W-20 | `hardDeleteOffboardedTenant` would **cascade-delete the tenant's audit trail** (`audit_logs.tenant_id ON DELETE CASCADE`), with no transaction and no audit row | **high** | **fixed** 2026-09-24 — `audit_logs.tenant_id` RESTRICT (migration 0030) |
| W-21 | `enterGracePeriod` accepts a tenant that is not suspended; a later suspension past the deadline is offboarded immediately | medium | live |
| W-30 | the scheduled calibration scan's work orders were **all rolled back**: it passed no actor, and `logAction` refuses one inside the transaction (A-124 + A-190) | **high** | **DONE** 2026-09-25 (ADR-061) |
| W-31 | the batch worker acked through the shared **publishing** channel, where the delivery tag means nothing: a protocol error that closes that channel | medium | **DONE** 2026-09-25 (ADR-061) |
| W-32 | the IoT anomaly alert was written with `type: "system"`, which the notifications ENUM refuses: **no anomaly alert had ever been stored** | medium | **DONE** 2026-09-25 (ADR-069) — live on PostgreSQL 18.6 |
| W-33 | the isolation hook put the ATTRIBUTE `tenantId` into a bulk DELETE after Sequelize had mapped names to columns: **every bulk destroy of an underscored model in a tenant context failed on PostgreSQL** | **high** | **DONE** 2026-09-25 (ADR-069) — live on PostgreSQL 18.6. The 5 affected tenant-user routes are enumerated and live-tested (`bulkDestroyRoutes.w33.live.test.js`) |
| W-34 | `sum`/`min`/`max`/`aggregate`, static `increment`/`decrement` and `restore` ran **no tenant hook**, and `destroy({ truncate })` dropped the predicate: tenant A's `Stock.sum` returned A's **and B's** total on PostgreSQL 18.6 | medium (latent: every current call site passes `tenantId`) | **DONE** 2026-09-25 (ADR-073) — wrapped per model, live on PostgreSQL 18.6 |

**By severity:** 7 high · 2 medium–high · 10 medium · 3 low/low–medium. **22 total.**

**Added 2026-09-25 (ADR-073):** W-34 (medium, latent), confirmed from the Sequelize 6.37.8 source
after W-33's card noted it in passing. Its card is at the end of this file.

**Added 2026-09-25 (ADR-069):** W-32 (medium) and W-33 (high), found by the first live run of the
tenant-scoped jobs. Their cards are at the end of this file.

**Added 2026-09-25:** W-30 (high) and W-31 (medium), which were found while W-03 and W-06 were being
fixed. Their cards are at the end of this file.

---

## Verification of the four prior async findings

Read before writing anything below, so that none of it re-reports fixed work.

| Card | Verdict | Where |
|---|---|---|
| **A-24** — every Redis helper a no-op on a missing `.connected` | **real.** `redis.service.js:56` is `const isReady = (client) => Boolean(client) && client.status === "ready";` and all seven helpers call it (`:104`, `:130`, `:150`, `:168`, `:208`, `:241`). `grep -n "\.connected" src/services/redis.service.js` returns nothing | `services/redis.service.js` |
| **A-26** — no consumer deduplicates | **real.** `rabbitmq.service.js:187` `claimMessage` is a `SET NX EX` on the shared client, checking `status !== "ready"` (`:192`), never `.connected`. Both consumers call it on an identity from the **message body**, not the delivery tag: `emailQueue.service.js:281` (`email:${job.id}`, minted at `:150`) and `batchJob.worker.js:47` (`batch:${payload.jobId}`) | `rabbitmq.service.js`, both consumers |
| **A-30** — the rate limiter never used Redis | **real.** `rateLimiter.redis.service.js:49–52` `readyRedis()` takes the shared client from `redis.service` and gates on `status === "ready"`. The private `getRedis()` is gone. `grep -c "istanbul ignore"` on the file returns **0** — all twelve directives removed, as the card claimed | `services/rateLimiter.redis.service.js` |
| **A-36** — amqplib `isOpen` leak | **real.** `grep -rn "isOpen" src/` returns nothing outside tests. Liveness is event-driven in both modules, with the identity check that stops a late event evicting a replacement: `rabbitmq.service.js:41–52`, `emailQueue.service.js:30–41` | both AMQP modules |

**What the four left behind**, filed as new cards rather than reopened:

- A-24 fixed the readiness *predicate* but not the client's *lifecycle*: `retryStrategy` still gives
  up after three attempts and `initRedis()` still runs only at boot, so the A-24 symptom set returns
  after the first blip — **W-05**.
- A-36 fixed `isOpen` in both modules but left the **duplication** in place: `emailQueue.service.js`
  still keeps its own connection and channel beside `rabbitmq.service`'s, and shutdown closes only
  one of them — **W-18**.
- A-26's claim is taken *before* the side effect. The card names that honestly for email. For batch
  jobs the consequence is different in kind, not degree — **W-07**.

---

## Scheduler inventory

Four `node-cron` jobs and one `setInterval`, all registered in `index.js:613–638`, all in-process,
**none with leader election.**

| Job | Registered | Schedule | Does | On failure | Safe to run twice? |
|---|---|---|---|---|---|
| Local folder backup | `middlewares/backup.middleware.js:140` | `BACKUP_SCHEDULER`, **code default `0 0 * * *`** | zips `backend/data` and `backend/log`, prunes `backup/` files older than 30 days | inner `catch` → `logger.error` (`:84`), outer `catch` → `logger.error` (`:148`). Nothing else | yes — but it backs up the wrong thing (**W-10**) |
| Session cleanup | `middlewares/sessionCleanup.middleware.js:60` | `SESSION_CLEANUP_SCHEDULER`, default `0 2 * * *` | `Sessions.destroy` where `expired_at < now` (`session.service.js:159`) | `catch` → `logger.error` (`:67`) | **yes** — a single idempotent DELETE |
| Calibration scan | `middlewares/calibrationScheduler.middleware.js:35` | `CALIBRATION_SCHEDULER`, default `0 1 * * *` — **set nowhere in `deploy/`** | per due device: creates a `Preventative` work order, a tenant-wide notification and a webhook event (`calibrationScheduler.service.js:105–144`) | per-device `catch` → `summary.errors` + `logger.error` (`:159`); outer `catch` → `logger.error` (`:47`) | **NO** — check-then-create race (**W-03**) |
| Retention purge | `middlewares/retentionScheduler.middleware.js:37` | `RETENTION_SCHEDULER`, default `0 2 * * *` | per tenant: hard-deletes `audit_logs`, `notifications`, `sessions` past their window (`dataRetention.service.js:128–154`) | per-tenant `catch` → `summary.errors` + `logger.error` (`:194`); outer `catch` → `logger.error` (`:47`) | mostly — DELETE-by-cutoff is idempotent; but no audit row (**W-04**) and no transaction (**W-16**) |
| Tenant lifecycle | `index.js:632`, `setInterval` 24 h | no cron expression; **24 h after boot** | offboards tenants past their grace period (`tenantLifecycle.service.js:234`) | `catch` → `logger.error("Tenant lifecycle processor failed")` (`index.js:635`) | moot — **it throws on every run and always has** (**W-01**) |

Two consumers sit beside them, started once at boot and never re-registered (**W-06**):
`workers/batchJob.worker.js:12` and `emailQueue.service.js:232`.

**Replica count today.** `deploy/helm/callibrator/values-prod.yaml:26` — backend `replicaCount: 1`
(line 85's `3` is the frontend). `values-staging.yaml:13` — 1. `values.yaml:30` — 1. The compose
files define one backend service with no `deploy.replicas`. **So the concurrency findings are
latent today.** They become live at the exact configuration the chart documents as intended —
`values.yaml:38–40`, "one single-replica deployment with cron.enabled true, and the API deployment
scaled with cron.enabled false" — because of W-02.

---

## W-01 — The tenant-lifecycle processor has never run

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23. Confirming the Postgres error text needs a running database |

**Evidence**

`services/tenantLifecycle.service.js:234–240`:

```js
const tenants = await Tenant.findAll({
  where: {
    status: 'SUSPENDED',
    gracePeriodExpiresAt: { [Op.ne]: null },
  },
});
```

Two independent defects in four lines.

1. `models/tenant.model.js:64` — `status: DataTypes.ENUM("active", "suspended", "deleted")`.
   **Lowercase.** The rest of the same service agrees: `:29` tests `tenant.status === 'suspended'`,
   `:112` tests `=== 'deleted'`, `:148` the same. Only the scheduled path spells it `'SUSPENDED'`.
   Postgres does not coerce: comparing an enum column to a non-member literal raises
   `invalid input value for enum enum_tenants_status: "SUSPENDED"`.
2. `gracePeriodExpiresAt` **is not an attribute of the Tenant model.** `grep -n
   "gracePeriod\|offboard" src/models/tenant.model.js` returns nothing; the full attribute list is
   `models/tenant.model.js:17–100`. Sequelize passes an unknown where-key through as a quoted
   column name, so the query is `WHERE … "gracePeriodExpiresAt" IS NOT NULL` against a column that
   does not exist.

Either one alone makes the query throw. The throw is caught at `index.js:634–638` and written to
`logger.error`, which in production has no Console transport (A-14) — so `docker logs` is empty and
the only trace is a file nobody reads.

**The write side is broken in the same way and is worse, because it is silent.**
`tenantLifecycle.service.js:86` does `tenant.gracePeriodExpiresAt = graceExpiresAt;` then `save()`.
Sequelize ignores a property that is not a model attribute: **no error, no column, no grace
period.** `offboardTenant` writes three more of the same — `offboardedAt` (`:119`),
`offboardRetentionExpiresAt` (`:120`). The retention deadline a tenant's data is supposedly held
to is assigned to an object property and dropped on the floor.

**Why it matters here.** This is the job that ends a suspended tenant's grace period and offboards
it. It has produced no effect and no visible error since it was written. It is also the exact PR-4
shape `CLAUDE.md` opens with, in code rather than documentation: a module written against a schema
that does not exist, with tests that never touched the real model.

**Fix direction.** Decide first whether tenant lifecycle is a real feature. If it is: add the four
columns in a migration (verified in psql, not from the migration log — see the traps table), use
the enum's own values, and move the job onto `node-cron` beside the others so it is configurable
and does not depend on a process living 24 hours. If it is not, delete the module and the interval;
a scheduled job that throws nightly is worse than no job, because the board says it exists.

**Definition of Done**
- [ ] a test asserts `Tenant.rawAttributes` contains every key `tenantLifecycle.service` writes —
      data-driven, so the next added field cannot reintroduce this
- [ ] `processExpiredGracePeriods()` runs against a real Postgres in a test and returns, rather than
      throwing
- [ ] a suspended tenant past its grace period is offboarded, and the row shows it
- [ ] the failure path reaches something a human sees (W-13)

**What was changed (2026-09-24, ADR-045).**

- **The card undercounted.** `suspendTenant` also wrote `suspensionReason`, `suspendedAt` and
  `suspendedBy`, which were dropped the same silent way — so **six** columns were missing, not four.
  Migration `0023-tenant-lifecycle-columns` adds all six plus an index on
  `(status, grace_period_expires_at)`. It has one catch, which re-throws anything but "table does not
  exist".
- **The scheduled query** uses `status: 'suspended'` and does the date comparison in SQL.
- **The job** runs on `node-cron` under `TENANT_LIFECYCLE_SCHEDULER`, and the `setInterval` is gone.
- **Offboarding** commits the tenant update, the settings row and its audit row in one transaction.
- **Isolation:** each tenant runs inside its **own** tenant context — never as a system task or super
  admin — and one tenant's failure does not stop the next.
- **Resume and cancel now clear the grace deadline.** Otherwise, once the column persists, a stale
  deadline would offboard a re-suspended tenant with no grace at all.

**Tests.** `tenantLifecycle.w01.test.js` runs the real model's SQL generation and the audit ledger.
It includes a data-driven check that every `tenant.X =` in the service is a model attribute. **23 of
its 27 tests failed against the old code.** There are also `0023-tenant-lifecycle-columns.test.js`
and `tenantLifecycleScheduler.middleware.test.js`.

**Verified on real PostgreSQL 18.6**, in a throwaway container:
- **The old query fails** with `invalid input value for enum enum_tenants_status: "SUSPENDED"`.
- **Upgrade path:** `sync()` then `migrator.up()` adds the columns. `down` and a second `up` both
  work.
- **A real run:** `processExpiredGracePeriods()` against three tenants offboarded exactly the
  expired one. It wrote one audit row, and the tenant still in its grace period and the active tenant
  were untouched.

**Still open:**
- The Postgres run was a script, not a jest test: no database-backed harness exists.
- A failure reaches only `logger.error` (W-13).
- W-20 and W-21.

---

## W-02 — `CALIBRATION_SCHEDULER` is configured nowhere, and the "not the scheduler" branch disables one job of four

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-060) |
| **Severity** | **high** |
| **Verified** | from code and from every file in `deploy/`. Confirming the rendered ConfigMap needs `helm template`, which was not run |

**Evidence**

`deploy/helm/callibrator/templates/guards.tpl:36–39` refuses to render `cron.enabled` with
`replicaCount > 1`, and names what it is preventing: "every tenant backup twice, every
data-retention purge twice, **every calibration sweep notifying twice**".

The guard's escape hatch is `cron.enabled: false` on the API deployment. That branch is
`deploy/helm/callibrator/templates/configmap.yaml:102–103`:

```yaml
  {{- else }}
  # Explicitly disabled: this replica is an API pod, not the scheduler.
  RETENTION_SCHEDULER: "disabled"
```

**One variable.** `SESSION_CLEANUP_SCHEDULER` and `BACKUP_SCHEDULER` are absent from that branch,
so both fall back to their code defaults —
`middlewares/sessionCleanup.middleware.js:51` (`"0 2 * * *"`) and
`middlewares/backup.middleware.js:140` (`"0 0 * * *"`). And:

```
$ grep -rn "CALIBRATION_SCHEDULER" deploy/
(no matches)
```

`CALIBRATION_SCHEDULER` appears in **no** Helm template, **no** values file, **no** compose file
and **not** in `deploy/compose/.env.example` — which does list the other three
(`.env.example:179–181`). So `middlewares/calibrationScheduler.middleware.js:15` takes its default
`0 1 * * *` and the calibration scan runs **on every replica, in every environment, including the
pods explicitly configured not to schedule anything.**

The `setInterval` at `index.js:632` is gated by nothing at all.

**Why it matters here.** The guard is good engineering — a render-time failure instead of a silent
double-run — and it is defeated by its own else branch. The one job the guard names as the reason
it exists ("every calibration sweep notifying twice") is the one job no environment variable can
turn off. Today that costs nothing because prod is one replica. The moment anyone follows the
chart's own documented scale-out, every API pod starts creating work orders (**W-03**).

**Fix direction.** One switch, not four: a single `SCHEDULERS_ENABLED` (or a per-job map) read in
one place, defaulting to **off**, so a replica opts in rather than opting out. `cron.enabled:
false` then sets one variable and the code cannot grow a fifth job that escapes it. Add
`CALIBRATION_SCHEDULER` to `.env.example` regardless.

**Definition of Done**
- [ ] a rendered ConfigMap with `cron.enabled: false` contains **no** enabled scheduler — asserted
      by a test over the template output, not by reading it
- [ ] a test enumerates every `cron.schedule` call site in `src/` and fails if one is not covered by
      the switch
- [ ] `.env.example` lists every scheduler variable the code reads

**What was changed (2026-09-25, ADR-060).**

- **One switch.** `utils/schedulerSwitch.util.js#scheduleSetting(env, default)` is read by every
  singleton scheduler. `SCHEDULERS_ENABLED=false` disables all of them, whatever their own variables
  say. The webhook dispatcher is the one named exemption: its claim is `SKIP LOCKED` (ADR-054).
- **Deviation from the fix direction: the switch defaults to ON.** Defaulting to off would silently
  stop backups and the retention purge on every existing single-instance deployment at upgrade.
  ADR-060 records why.
- The chart's `cron.enabled: false` branch sets `SCHEDULERS_ENABLED: "false"` and disables every
  scheduler variable. Both `.env.example` files list them all, `CALIBRATION_SCHEDULER` included.

**Tests.** `src/tests/utils/schedulerSwitch.w02.test.js` (14 tests):
- It enumerates every `cron.schedule` call site in `src/` and fails on one that bypasses
  `scheduleSetting`.
- It checks both `.env.example` files.
- **"an API deployment (cron.enabled false, three replicas) renders NO enabled singleton
  scheduler"** runs `helm template` and asserts on the **rendered** ConfigMap. It is skipped when
  `helm` is not on PATH. It ran here with helm v3.21.2.

**Fail-before.** At `fabc3be` the suite cannot load, because `schedulerSwitch.util` does not exist.
The old chart, rendered with the same arguments, disables **only** `RETENTION_SCHEDULER` and has no
`SCHEDULERS_ENABLED`.

---

## W-03 — The calibration scan's idempotency guard is a race

| | |
|---|---|
| **Status** | **DONE** 2026-09-25, verified on PostgreSQL 18.6 (ADR-061) |
| **Severity** | **high** |
| **Verified** | from code. **Needs a second replica to demonstrate** — stated plainly, not rounded up |

**Evidence**

`services/calibrationScheduler.service.js:9–13` states the contract: "a device that already has an
Open/InProgress Preventative work order is skipped, so repeated daily runs never create duplicate
work orders or notifications".

The implementation is a read at `:81–87` followed by three writes at `:105`, `:119` and `:134`:

```js
const existing = await MaintenanceWorkOrder.findOne({
  where: { deviceId: device.id, type: "Preventative",
           status: { [Op.in]: ["Open", "InProgress"] } },
});
if (existing) { summary.skipped++; continue; }
… maintenanceService.createWorkOrder(…)      // :105
… notificationService.emitNotification(…)    // :119
… webhookService.emitEvent(…)                // :134
```

Nothing makes that atomic: no `acquireLock`, no transaction, no `SELECT … FOR UPDATE`, and no
unique constraint on `maintenance_work_orders` that would make the second `create` fail. Two
processes on the same cron minute both read "none", both write. The result is a duplicate work
order, a **duplicate tenant-wide notification** to every user of that hospital, and a **duplicate
webhook POST** to whatever the tenant subscribed.

The idempotency claim is true for *repeated* runs and false for *concurrent* ones, which is exactly
the distinction the comment does not draw.

**Why it matters here.** This is the one scheduled job whose output is visible to customers.
Duplicate calibration work orders in a hospital's maintenance queue are not a cosmetic defect —
they are two technicians dispatched to the same device, and an ISO 17025 record that says the
device was scheduled twice.

Note also the trap from `CLAUDE.md`: `maintenance_work_orders` is where the optional-include
defect is described as latent. This card adds a second reason to look at that table.

**Fix direction.** A partial unique index is the durable answer —
`UNIQUE (device_id) WHERE type = 'Preventative' AND status IN ('Open','InProgress')` — because it
holds whatever the process topology is, and the scan then catches the constraint violation and
counts a skip. `redis.service#acquireLock` (`:205`, a correct `SET NX EX`) already exists and is
used by exactly one caller (`auth.service.js:67`); wrapping the whole scan in it is the cheap
interim, but it is advisory and it fails open when Redis is down (**W-05**).

**Definition of Done**
- [ ] the constraint exists, verified **in psql**, not from the migration log
- [ ] a test runs two `runCalibrationScan()` calls concurrently against one due device and asserts
      exactly **one** work order, **one** notification and **one** webhook delivery row
- [ ] the violation path is counted as `skipped`, not as `errors`
- [ ] the comment at `:9–13` says "concurrent" or stops claiming it

**What was changed (2026-09-25, ADR-061).**

- **Migration `0060-work-order-auto-scheduled-unique`** adds `auto_scheduled BOOLEAN NOT NULL
  DEFAULT false`, and a partial unique index on `device_id` where the order is auto-scheduled, Open
  or InProgress, and not deleted. It runs in one transaction, and it throws on a missing table
  instead of recording itself applied.
- **Deviation:** the index covers **auto-scheduled** orders only, not every open Preventative order.
  A person may legitimately open a second preventative order.
- The scan sets `autoScheduled: true`. `maintenance.service#createWorkOrder` maps the unique
  violation to **409**, and the scan counts it as **`skipped`**, before any notification or webhook.
- The header comment now separates repeated runs from concurrent ones.

**Tests.**
- `calibrationScheduler.w03.test.js`, "W-03 — a concurrent scan's work order is a skip, not an
  error". Across the whole file, 9 of 11 fail at `fabc3be`.
- `maintenance.w30.test.js`, "maps the partial unique index's violation to 409 with a state
  explanation".
- `0060-work-order-auto-scheduled-unique.test.js`, which cannot load at `fabc3be`.

**Verified on real PostgreSQL 18.6**, in a throwaway `pgvector/pgvector:pg18` container:
- The full `db.sync()` + `migrator.up()` applied 0060.
- A second `migrator.up()` applied nothing.
- A direct re-run of `up`, then `down`, which drops the index and keeps the column, then `up` again,
  all worked.
- `\d maintenance_work_orders` shows the column and the index.
- `calibrationScheduler.w03.live.test.js` passes 3 of 3. Two scans, forced to race by a barrier,
  produce one work order, one audit row, one notification and one webhook event.
- **Fail-before:** with the index dropped (`down` instead of `up`), 2 of 3 fail and the race
  creates a second work order.

---

## W-04 — No background mutation writes an audit row

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-069) |
| **Severity** | **high — compliance** (ISO 17025, 21 CFR Part 11 §11.10(e)) |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/audit.service.js` exports exactly two functions: `logAction` (`:24`) and `fetchAuditLogs`
(`:57`). `grep -rn "require.*audit.service" src/` outside tests returns **two** callers:
`controllers/audit.controller.js:1` (the read API) and `middlewares/auditLog.middleware.js:3`.

So the only writer of `audit_logs` is a **request middleware**. A cron job has no request, so:

| Background mutation | Where | Audit row |
|---|---|---|
| calibration creates a work order | `maintenance.service.js:142–161` — a bare `MaintenanceWorkOrder.create`, no transaction, no audit | none |
| calibration creates a tenant-wide notification | `notification.service.js:46` | none |
| **retention hard-deletes `audit_logs`** | `dataRetention.service.js:128–133` | **none** |
| retention hard-deletes notifications and sessions | `dataRetention.service.js:137`, `:146` | none |
| tenant offboarding sets `status = 'deleted'` | `tenantLifecycle.service.js:118–132` | none |
| session cleanup deletes sessions | `session.service.js:160` | none |
| IoT ingest writes readings and anomaly alerts | `iot.service.js:162`, `:172` | none |
| a batch job's state transitions | `batchJob.service.js:80`, `:91`, `:101` | none |

**Why it matters here.** `CLAUDE.md` calls "every mutation writes an audit row, inside the
transaction" non-negotiable, and A-41 already records that the request path writes it *after* the
response and outside the transaction. This card is the other half and it is worse: for background
work there is no row at all, in a transaction or out of one.

The retention purge is the sharp case. It is the only code in the system that **permanently
destroys audit records** — `AuditLog.destroy` with no `paranoid` soft delete visible — and it
leaves nothing saying it ran, how many rows it took, or for which tenant. An auditor asking "what
happened to the March logs" has no answer available anywhere in the database. Default window is
365 days (`dataRetention.service.js:7`), which is also worth a decision against the Part 11 record
retention the project claims.

**Fix direction.** A system-principal audit writer: `logAction` accepting an explicit actor
(`system:retention-purge`, `system:calibration-scan`) instead of reading one off `req`, called
inside the same transaction as the mutation. The purge in particular should write its row
*before* the deletes commit, in the same transaction, recording counts per entity — otherwise the
record of the deletion can be lost by the same crash that half-completed it (**W-16**).

**Definition of Done**
- [ ] `logAction` has a system-actor form and at least the purge, the offboard and the calibration
      work-order creation use it
- [ ] each of those is inside the transaction that does the work
- [ ] a test asserts a retention purge of N rows leaves an `audit_logs` row naming N and the tenant,
      and that rolling the transaction back leaves **neither**
- [ ] a decision recorded on the 365-day audit-log window against the compliance claim

**Partly fixed (2026-09-24, under A-41).** The retention purge's three deletes and one audit row are
now a single transaction. The row is `DELETE` / `DataRetention`, with counts per table, the cutoffs
and `changes.actor: "system:retention-purge"`. Test: `dataRetention.audit.w04.test.js`. 4 of its 6
tests failed against the old code.

**Still live:** tenant offboarding (W-01, which never runs), scheduler-created work orders, and IoT
ingest. They wait on Q-13, the system actor.

**2026-09-25 (W-30, ADR-061):**
- Scheduler-created work orders are now audited inside their transaction, as
  `system:calibration-scan`, and as the requesting user on a manual run. Test:
  `maintenance.w30.test.js`, "with the system actor it commits the work order and ONE audit row
  naming the job" (3 of 3 fail at `fabc3be`).
- Offboarding has been audited since W-01.
- **Still open:** IoT ingest, the tenant-wide notification, batch-job state transitions, and the
  decision on the 365-day audit-log window.

**What was changed (2026-09-25, ADR-069).** Every audit row below is written with
`logAction(entry, { transaction })`, inside the transaction of the change it records. Each names a
system actor from `constants/systemActors.js`.

- **IoT ingest (`iot.service.js`), actor `system:iot-ingest`, new.** An out-of-tolerance reading,
  its tenant-wide alert and one `CREATE Notification` audit row are ONE transaction. The row's
  `changes` hold `IOT_ANOMALY_ALERT`, the reading id and the findings. An ordinary reading writes no
  audit row. Q-13 is kept: individual readings are not audited, and the reading row is the record.
  Writing the live test found **W-32**: no anomaly alert had ever been stored.
- **The calibration scan's tenant-wide notification (`calibrationScheduler.service.js`).** The
  notification and a `CREATE Notification` audit row form their own transaction. The row is
  written as the job, or as the user on a manual run. `notificationService.emitNotification(data,
  { transaction })` is the new transactional form: it re-throws, and it pushes the socket and email
  delivery to `afterCommit`. Towards the scan the notification stays best-effort: a failure is
  logged and not counted, and the work order has already committed.
- **Batch jobs (`batchJob.service.js`), actor `system:batch-job`, new.** Every state change is
  audited, with the queuing user in `changes.requestedBy`:
  - the claim, PENDING→PROCESSING (claim, re-read and audit row in one transaction);
  - completion;
  - every failure path: handler error, no handler, the abandoned-job sweep and shutdown.

  A failure updates only a row still `PROCESSING`, so a job the sweep already failed is not failed
  or audited twice. The sweeps use `UPDATE … RETURNING` and audit each returned row in its own
  tenant.
- **The 365-day window — decided (ADR-069 §5).** An audit row's retention period is
  **indefinite**. The 365 days was the pre-A-121 *deletion* window, which Q-12 removed. It is not a
  retention period.
  - A finite minimum would understate 21 CFR 11.10(e): the trail must be kept as long as the records
    it describes, and those are kept indefinitely.
  - "Window" may only ever mean hot storage. That requires an archival process that keeps the rows
    retrievable through the audit API, keeps their integrity verifiable, and audits itself. None
    exists, so there is no window.
  - Recorded in `docs/DATABASE/10-AUDIT-LOGS.md` § Retention period.

**Tests.**
- `iot.service.test.js`:
  - "W-04: an anomaly's reading, alert and ONE audit row naming system:iot-ingest share a
    transaction"
  - "W-04: a failed audit insert rejects the ingest (the transaction rolls the alert back)"
  - "W-04 / Q-13: an ordinary reading writes no audit row and opens no transaction"
- `calibrationScheduler.service.test.js`:
  - "W-04: a scheduled scan's tenant-wide notification is audited as system:calibration-scan, in
    its transaction"
  - "W-04: a manual run's notification names the requesting user, not the job"
  - "W-04: a failed audit insert means no notification is counted"
  - "W-04: a notification whose transaction fails is logged and not counted; the device is not an
    error"
- `notification.service.test.js`:
  - "W-04: with a transaction, writes in it and delivers only after the COMMIT"
  - "W-04: with a transaction, a failed insert is RE-THROWN so the caller rolls back"
- `batchJob.service.test.js`, describe "W-04 — every state change writes one audit row, in its
  transaction", 7 tests. Among them:
  - "a completed job: PENDING -> PROCESSING and PROCESSING -> COMPLETED, naming the job and who
    asked"
  - "the abandoned-job sweep audits each failed row in ITS OWN tenant"
  - "a job the sweep already failed is not failed, or audited, a second time"
- `systemActors.a124.test.js`, "the list is closed and frozen…", now lists the two new actors.
- **Live, PostgreSQL 18.6** (the 0033 actor CHECK in force):
  - `backgroundJobs.w12.live.test.js`:
    - "an anomaly stores the reading, the tenant-wide alert and ONE audit row naming
      system:iot-ingest"
    - "an ordinary reading is stored with no audit row (ADR-051 Q-13)"
    - "the abandoned-job sweep fails each stale job and audits it in ITS OWN tenant"
  - `calibrationScheduler.w03.live.test.js`: the race test now also asserts ONE `Notification`
    audit row by `system:calibration-scan`.
  - `batchJob.w07.live.test.js`: its cleanup now deletes the new audit rows first (RESTRICT FK).

**Fail-before** (a `git worktree` at `beb0c4b`, with the new tests copied in):
- every W-04 test named above fails;
- live, the anomaly test fails with `invalid input value for enum enum_notifications_type:
  "system"` (W-32);
- the sweep test and the w03 notification-audit assertion fail on the missing rows.

---

## W-05 — One Redis blip disables Redis permanently, silently

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code. **Needs a running Redis to demonstrate** — restart it and watch the client never come back |

**Evidence**

`services/redis.service.js:20–29`:

```js
redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) { return null; }      // <- give up, for good
    return Math.min(times * 200, 1000);
  },
  lazyConnect: true,
});
```

Returning a non-number from ioredis's `retryStrategy` means **stop reconnecting**. The client moves
to `end` and stays there. The reconnect budget is three attempts at 200 ms, 400 ms and 600 ms —
**about 1.2 seconds**. A Redis restart, a failover, a brief network partition, a container
reschedule: all longer than that.

`initRedis()` (`:62`) is called once, from `index.js:613`. Nothing calls it again. `getRedisConnection()`
returns the cached dead client (`:12`), and every helper's guard —
`isReady(client)`, `client.status === "ready"` — is then false forever.

What silently stops for the life of the process:

| | |
|---|---|
| rate limiting and lockouts | `rateLimiter.redis.service.js:52` falls back to the in-process Map — **the pre-A-30 behaviour, restored** |
| queue deduplication | `rabbitmq.service.js:192` logs one warning and processes without dedup — **the pre-A-26 behaviour** |
| the registration lock | `auth.service.js:67` `acquireLock` returns `null` |
| WebAuthn challenges, OIDC authorization requests | `webauthn.service.js`, `oidcProvider.service.js` — **the A-24 production symptoms verbatim** |
| every permission, tenant and role cache | read-through on every request |

**Why it matters here.** A-24 fixed the *predicate*. This is the *lifecycle*, and it produces the
identical observable failure — registration answering 429, passkeys 503 — from a different cause.
It will be diagnosed as "A-24 regressed", which it has not.

`/ready` would notice: `health.service.js:129–137` PINGs and reports `unhealthy`. But liveness is
`/` (`values.yaml:55`, deliberately, so a database blip does not crash-loop the pod), so Kubernetes
removes the pod from service **and never restarts it**. On the compose and VM deployments nothing
reads readiness at all. Either way the outage outlives its cause until someone restarts the
process by hand.

**Fix direction.** Let ioredis reconnect indefinitely with a capped backoff — the whole point of a
retry strategy is that the dependency comes back. If a cap is wanted, pair it with a supervisor
that calls `initRedis()` again, and log the transition from ready to end at `warn` so it is
greppable. Whatever is chosen, a test must pin it: today nothing asserts what happens after the
third failure.

**Definition of Done**
- [ ] a live test (opt-in, beside `rateLimiter.redis.live.test.js`) kills Redis for 10 s and asserts
      the client returns to `ready` and the rate limiter resumes shared counting
- [ ] the ready→end transition produces one log line naming the consequence
- [ ] `/ready` behaviour on a permanently-ended client is decided — recover, or fail loudly enough to
      be restarted

---

**What was changed (2026-09-24)** — `redis.service.js`, 100 %.

Read from the source rather than assumed: in ioredis 5.11.1, `event_handler.js#closeHandler` calls
`retryStrategy(++retryAttempts)` and, **if the result is not a number, calls `close()`** —
`setStatus("end")` and a flushed queue, with no timer and no later retry. The README says it plainly:
*"the connection will be lost forever if the user doesn't call `redis.connect()` manually."* So the
old strategy's `return null` after three attempts ended the client for good after about 1.2 seconds.

`retryStrategy` now always returns a number, capped at 2000 ms — ioredis's own default. The counter
resets on every `ready`, so backoff starts short again after each recovery. An **unintended** `end`
schedules a single re-dial, which puts the client back into the normal retry loop; a deliberate
`closeRedis()` is marked and never re-dialled. Losing and regaining the connection are logged through
the project logger, naming what degrades.

**Proof** — `redis.service.reconnect.test.js` drives **real ioredis** against an in-process RESP
server that drops every socket and refuses connections for 2.5 s, longer than the old ~1.2 s budget.
Against the old code: `expect(client.status).not.toBe("end")` fails. Two old tests that asserted the
bug — `retryStrategy(5)).toBeNull()` and "retries up to 3 times then gives up" — are removed.

**Not covered:** a real Redis restart. The fake server proves the client lifecycle, not Redis. The DoD
item "kill a real Redis for 10 s and assert the rate limiter resumes shared counting" stays open.
Also: during an outage the existing error listener logs every reconnect attempt — about 30 lines a
minute at the 2 s cap, where the old code logged four and then died. Not throttled.

## W-06 — A RabbitMQ consumer is never re-registered

| | |
|---|---|
| **Status** | **DONE** 2026-09-25, verified on a real RabbitMQ 4 (ADR-061) |
| **Severity** | **high** |
| **Verified** | from code. **Needs a running broker to demonstrate** — restart it and watch both queues stop draining |

**Evidence**

Both consumers are registered exactly once, at boot:

- `index.js:640–645` → `workers/batchJob.worker.js:26` `rabbitmq.consume(...)`
- `index.js:648` → `emailQueue.service.js:360` `ch.consume(EMAIL_QUEUE, processJob)`

The A-36 fix is correct about *caching*: `forgetConnection` / `forgetChannel`
(`rabbitmq.service.js:41–52`, `emailQueue.service.js:30–41`) null the handles on `close` or `error`
so the **next call** reconnects. But a consumer is not a call. When the connection drops there is
no next call — the subscription simply ceases to exist, and nothing re-establishes it. The next
`publish()` will happily open a fresh connection and enqueue work that nobody is listening for.

The boot path has the same hole in a different shape. `processEmailQueue` (`:232–246`):

```js
try { const initialized = await initEmailQueue(); if (!initialized) throw …; }
catch (error) { logger.warn("Failed to initialize RabbitMQ, email queue worker not started", …); return; }
```

Broker not up yet at boot — ordinary in compose and in Kubernetes — and the email worker **is never
started and never retried**. `startBatchJobWorker` does the same at `batchJob.worker.js:77–79`
(`logger.warn`, return).

Email partly survives this by accident: `addEmailJob` catches its own failure and sends
synchronously (`emailQueue.service.js:180–183`). Batch jobs also fall back inline
(`batchJob.service.js:53–62`). But anything **already in the queue** when the consumer died stays
there, invisible, until someone restarts the process.

**Why it matters here.** "A mock proves the client, not the contract." A consumer registration is
precisely the kind of thing a mock cannot test: the mock's `consume()` resolves and the test is
green, and the property that matters — that the subscription is re-established after the socket
closes — is never exercised.

**Fix direction.** A single supervised `start()` per consumer: register, and on the connection's
`close` event schedule a re-register with capped backoff, plus a bounded retry at boot instead of
one attempt. The re-register must be idempotent (one consumer per queue per process) or a flapping
broker multiplies consumers, which is a different bug with the same symptom.

**Definition of Done**
- [ ] a live test starts a consumer, closes the connection underneath it, and asserts a message
      published afterwards is consumed
- [ ] the broker down at boot is retried, and the log says so once per attempt, not once per second
- [ ] exactly one consumer per queue after ten forced reconnects

**What was changed (2026-09-25, ADR-061).** `rabbitmq.service#startConsumer(queue, handler,
{prefetch, setup})`:
- It registers on a channel of its own.
- It re-registers with capped exponential backoff (`RABBITMQ_RECONNECT_BASE_MS` /
  `RABBITMQ_RECONNECT_MAX_MS`) when the channel closes, the broker cancels, or registration fails.
  It logs once per attempt.
- It re-runs `setup` (the queue declarations) each time.
- There is one consumer per queue.

Both workers (`emailQueue.service#processEmailQueue` and `workers/batchJob.worker.js`) use it.

**Tests.**
- `rabbitmq.service.test.js` (32 tests, over the in-memory broker `tests/fixtures/fakeAmqp.js`):
  - "a message published AFTER a broker restart is consumed — the consumer re-registered itself"
  - "a broker that is down at boot is retried, one log line per attempt, until it is up"
  - "exactly ONE consumer per queue after ten forced reconnects"
  - At `fabc3be`, 24 of 32 fail.
- `emailQueue.service.test.js`, "an email queued after a broker restart is still sent".
- `batchJob.worker.test.js`, "a job published after a broker restart is still run".

**Live:** `rabbitmq.w06.live.test.js` (opt-in, `RABBITMQ_LIVE_TEST=1`). It passes 4 of 4 against
`rabbitmq:4-alpine` with a real `docker restart` of the broker. Both consumers logged
"re-registered", and a message published after the restart was consumed. At `fabc3be`, 4 of 4 fail.

---

## W-07 — A batch job interrupted by SIGTERM is acked on redelivery and never runs

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-060) |
| **Severity** | **medium–high** |
| **Verified** | from code. **Needs a broker to demonstrate** |

**Evidence**

The consumer claims before it works — `workers/batchJob.worker.js:47`:

```js
claim = await rabbitmq.claimMessage(`batch:${payload.jobId}`);
if (!claim.claimed) { return ackMsg(msg); }      // :48-53  "done already — ack"
try { await batchJobService.runJob(payload.jobId); ackMsg(msg); }
catch (err) { if (claim) await claim.release(); channelNack(msg); }   // :61-71
```

The claim is released on a **thrown** failure. It is not released when the process is killed
mid-job, and the shutdown path does not drain: `index.js:695–730` closes the HTTP server, the
database, Redis and (only) the email queue's AMQP connection, then `process.exit(0)`. The batch
worker's in-flight message is never acked, so the broker redelivers it after the restart — and the
redelivery hits a claim that is still held, for `QUEUE_DEDUP_TTL_SECONDS` = **86,400 s**
(`rabbitmq.service.js:167`).

The redelivery is therefore acked as a duplicate and dropped. Meanwhile `runJob` had already
written `status: "PROCESSING"` (`batchJob.service.js:80`) and never reached `COMPLETED` or
`FAILED`. Net result of one ordinary deploy: **the job row sits at PROCESSING forever, the message
is gone, and there is no DLQ entry** — the queue looks clean and the job list shows a job that has
been "processing" for a week.

`rabbitmq.service.js:155–158` documents this for email ("the redelivery is skipped and that email
is never sent"), which is proportionate for an email. For a batch job — an export, an import, a
bulk update — the same trade is not proportionate, and it is not recorded anywhere as a decision
for this consumer.

**Why it matters here.** Nothing distinguishes "this job is running" from "this job died in a
deploy". The state that would tell them apart — `PROCESSING` with a stale timestamp — is never
read.

**Fix direction.** Either claim *after* the work and accept duplicate runs for idempotent jobs, or
keep the pre-claim and make the claim owned and heartbeated so an abandoned one expires in minutes
rather than a day. Independently: drain on SIGTERM (stop consuming, wait for in-flight handlers,
then close), and add a startup sweep that fails any `PROCESSING` row older than a threshold, with
a reason.

**Definition of Done**
- [ ] a test kills the worker mid-`runJob`, restarts it, and asserts the job reaches a terminal
      state — `COMPLETED`, or `FAILED` with a reason
- [ ] shutdown stops consuming before it closes the channel, and waits for in-flight work
- [ ] no `batch_jobs` row can stay `PROCESSING` past a bounded age without something saying so

**What was changed (2026-09-25, ADR-060).**

- **The claim is the row.** `batchJob.service#runJob(jobId, tenantId)` does an atomic
  `PENDING -> PROCESSING` UPDATE inside the job's tenant context. A lost claim is `ran: false`, and
  the worker acks it with a log line.
- A running job **heartbeats** its row (`BATCH_JOB_HEARTBEAT_MS`, 60 s).
- `failAbandonedJobs` (every 5 min, on every replica, idempotent) fails a `PROCESSING` row that has
  been silent for `BATCH_JOB_STALE_MINUTES` (10), with a reason.
- **Shutdown** (`index.js`, then `stopBatchJobWorker`) cancels the consumers, waits for in-flight
  handlers (`RABBITMQ_DRAIN_TIMEOUT_MS`), and fails the jobs it had to abandon.
- The redelivered message then finds a `FAILED` row and is acked.
- **Nothing is re-run automatically.** Handlers are not declared idempotent.
- The worker no longer uses the Redis claim.

**Tests.**
- `batchJob.service.test.js` (30 tests; 20 fail at `fabc3be`).
- `batchJob.worker.test.js` (16 tests; 16 fail at `fabc3be`), including "shutdown mid-job fails the
  job; its redelivery elsewhere settles without running it". That test stops the worker mid-job,
  closes the connection, and starts a fresh worker graph on the same in-memory broker.
- `rabbitmq.service.test.js`, "stopConsumers cancels, then waits for in-flight handlers".

**Live on PostgreSQL 18.6:** `batchJob.w07.live.test.js` (opt-in, `BATCHJOB_PG_LIVE_TEST=1`)
passes 3 of 3:
- Two runners racing on one row: one runs, the other is a no-op.
- The heartbeat moves `updated_at`, and the sweep fails a silent `PROCESSING` row but not a live one.

At `fabc3be`, 3 of 3 fail.

**Also fixed here:** a message whose body parses to a non-object (`null`, a number) used to throw
before being settled. It held a prefetch slot until its channel closed. It is now dead-lettered.

---

## W-08 — Batch jobs do nothing, and report success

| | |
|---|---|
| **Status** | **DONE** 2026-09-25, by decision, not by handlers (ADR-060) |
| **Severity** | **medium–high** |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/batchJob.service.js:15` — `const HANDLERS = {};`

```
$ grep -rn "registerHandler" src/ index.js | grep -v /tests/
src/services/batchJob.service.js:18:exports.registerHandler = (type, fn) => {
```

**Zero callers.** The registry is empty in every process. `runJob` (`:73–107`) therefore takes this
path for every job of every type:

```js
await job.update({ status: "PROCESSING" });
const handler = HANDLERS[job.type];
if (handler) { await handler(job); }       // never taken
…
await fresh.update({ status: "COMPLETED", progress: 100,
                     processedItems: fresh.totalItems || …,
                     resultUrl: `/api/v1/jobs/${jobId}/download` });
```

So every batch job goes `PENDING → PROCESSING → COMPLETED`, reports **100 % progress**, reports
`processedItems` equal to whatever `totalItems` the caller declared — a number it did not measure —
and hands back a `resultUrl` for output that was never produced.

**Why it matters here.** This is the "renders vs works" distinction `CLAUDE.md` insists on, in its
most misleading form: the feature does not fail, it **succeeds falsely**. A user who starts an
export gets a green tick and a download link. The queue, the worker, the DLQ, the dedup and the
restart-safety around it are all real and all correct; they carry nothing.

**Fix direction.** Not a bug fix — a scope decision. Either register the handlers the feature was
built for, or make an unregistered type a **failure**: `status: "FAILED"`, `errorDetails: "no
handler registered for type X"`. The current default ("types with no registered handler simply
complete (a no-op job)", `:14`) is the wrong default for a system whose whole discipline is not
claiming work that did not happen.

**Definition of Done**
- [ ] a job of an unregistered type ends `FAILED` with a reason, or the handlers exist
- [ ] `resultUrl` is set only when something was written, and `GET /api/v1/jobs/:id/download`
      returns 404 rather than a fabricated success when it was not
- [ ] `progress` and `processedItems` come from the handler, not from the request's `totalItems`
- [ ] whatever the board says about batch jobs is corrected to match

**What was changed (2026-09-25, ADR-060).** The fix direction's second option: **there is no
default handler.**
- `createJob` refuses an unregistered type with **400**, naming the registered types or saying
  there are none.
- A queued job of an unregistered type ends **`FAILED`**, with `errorDetails` saying nothing was
  processed.
- `resultUrl` and `processedItems` come **only** from the handler's return value.
- There is no `/download` route, so there is nothing to fabricate; a request for it is a 404.

**This means the feature does nothing.** No type is registered in `src/`, so `POST
/api/v1/jobs/test` answers 400 for every type. Writing a real handler is new work, not part
of this card.

**Tests:** `batchJob.service.test.js`:
- "refuses an unregistered type with 400 and creates nothing"
- "a queued job of an unregistered type ends FAILED with the reason, never COMPLETED (W-08)"
- "a handler that returns nothing leaves processedItems as the handler set it and no resultUrl
  (W-08)"

All three fail at `fabc3be`. The previous test file asserted the opposite: "processes and
completes a job with no handler", with a `resultUrl`.

---

## W-09 — The email retry re-publishes *and* dead-letters, from a timer that can take the server down

| | |
|---|---|
| **Status** | **DONE** 2026-09-25, verified on a real RabbitMQ 4 (ADR-061) |
| **Severity** | medium |
| **Verified** | from code. **Needs a broker to demonstrate the DLQ duplication** |

**Evidence**

`services/emailQueue.service.js:336–355`, the failure path:

```js
if (job.retries < (job.maxRetries || 3)) {
  job.retries += 1;
  const delay = Math.pow(2, job.retries) * 1000;
  setTimeout(() => {
    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(job)),
                   { persistent: true, messageId: job.id });
  }, delay);
}
// Nack without requeue (will go to DLQ after max retries)
ch.nack(msg, false, false);
```

Three separate defects sharing four lines.

1. **The comment is wrong about the DLQ.** `nack(msg, false, false)` dead-letters **every** failed
   attempt, not the last one — the queue is declared with `x-dead-letter-routing-key: email_dlq`
   (`:120–126`). A job that fails four times leaves **four** DLQ copies while simultaneously being
   retried on the main queue. The DLQ is not a record of exhausted work; it is a record of every
   attempt, and it will be read as the former.
2. **The retry is an in-process timer.** A restart during the 2/4/8/16 s window loses it, and the
   original message was already nacked without requeue — so the only surviving copy is the DLQ
   entry, which nothing replays. Same durability shape as A-10 for webhooks; different module.
3. **The timer can kill the process.** `ch` is captured at `:250`, before the delay. If the channel
   closed in between — which is precisely what happens when the broker restarts, and is what
   `forgetChannel` at `:37` exists to handle — `sendToQueue` throws **inside a timer callback**,
   with nothing to catch it. `index.js:738–743` handles `uncaughtException` by calling
   `shutdown()`. One failed email during a broker blip exits the server. That is the same shape as
   A-45, which was fixed for MQTT and is still open here.

Two smaller things in the same function: `consumerTimeout` (`:256–259`) is a timer that logs
"Email queue consumer timeout reached" 30 s after start and affects nothing — dead code presenting
as a safety control; and the connect-timeout timer at `:54` is not `unref()`d, unlike its twin at
`rabbitmq.service.js:68`.

**Fix direction.** Retries belong in the broker, not in a timer: a delay queue (per-message TTL
plus a dead-letter hop back) or a retry queue per backoff tier. Then the failure path is one
`nack`, the DLQ means what its name says, and a restart loses nothing. Delete `consumerTimeout`
rather than leave a control that does not control.

**Definition of Done**
- [ ] a job that fails N times produces exactly **one** DLQ message, after the last attempt
- [ ] a restart mid-backoff still delivers the retry
- [ ] a throw anywhere in the consumer cannot reach `uncaughtException` — asserted by a test that
      closes the channel and then fails a job
- [ ] `consumerTimeout` is gone or does something

**What was changed (2026-09-25, ADR-061).**

- Retry *n* is published to `email_retry_<ms>`, a durable queue whose `x-message-ttl`
  dead-letters it back onto `email_queue`. The original is **acked**. Only the last failure is
  nacked, to `email_dlq`.
- The in-process timer is gone, and so is `consumerTimeout`:
  `grep -rn consumerTimeout backend/src` returns nothing.
- A retry sent on a channel that has closed is logged. The broker then redelivers the unacked
  original. Nothing is thrown out of the consumer, and `rabbitmq.service`'s dispatch catches
  anything a handler throws.

**Tests.** `emailQueue.service.test.js` (27 tests, rewritten against the in-memory broker; 20 fail at
`fabc3be`):
- "a job that always fails produces exactly ONE DLQ message, after the last attempt"
- "a restart during the backoff still delivers the retry: the delay is a durable queue"
- "the channel closing mid-send cannot throw out of the consumer: the job is redelivered and sent"

**Live, RabbitMQ 4:** `rabbitmq.w06.live.test.js`, "an email that always fails dead-letters ONCE".
On the same broker the **old code left 4 DLQ copies** of one always-failing email, after 4 sends.

**Also fixed here:** a message body that parses to a non-object is dead-lettered instead of throwing
before it is settled.

---

## W-10 — The nightly "tenant backup" backs up two local folders, not the database

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code. Confirming what is actually inside `backend/data` on the VM needs shell access there |

**Evidence**

`deploy/helm/callibrator/values.yaml:33` describes the cron set as "session cleanup, **tenant
backup**, data-retention purge, the calibration sweep", and `backup: "0 3 * * 0"` feeds
`BACKUP_SCHEDULER`. That variable drives exactly one thing — `middlewares/backup.middleware.js:140`
→ `backupAndZip()` (`:42`), which zips two directories:

```js
const dataSourceDir = path.join(rootDir, "data");     // :45
const logSourceDir  = path.join(rootDir, "log");      // :46
…
await fse.copy(dataSourceDir, tempDataBackupDir, {
  filter: (src) => !src.endsWith("mysql.sock"),       // :74
});
```

`rootDir` is the backend directory (`:11`). No `pg_dump`, no database connection, no tenant data,
no object storage. The `mysql.sock` filter is a leftover from the MySQL support ADR-039 removed —
a fair indication of when this last described reality.

Meanwhile `services/tenantBackup.service.js` (616 lines) — the module that actually backs up a
tenant — is reachable **only** through `routes/api/tenantBackup.route.js`. `grep -rn "tenantBackup"
src/ index.js` outside tests returns the controller, the route, the model registration and the
route mount. **Nothing schedules it.**

Secondary, in the same file: `deleteOldFiles` prunes `storagePath("backup")` (`:12`) while
`backupAndZip` writes to `path.join(rootDir, "backup")` (`:47`). Identical in development, where
`storagePath.util.js:7` resolves to the backend directory — but **different when packaged**, where
`:5` resolves to `APP_STORAGE_PATH` or `execPath/storage`. In that configuration backups are
written to one directory and pruned from another, and the written one grows without limit.

**Why it matters here.** The operational story is "we take a weekly backup". What exists is a
weekly zip of a log folder and an empty MySQL data directory, and a real backup service that has
never been scheduled. It is the third instance in this audit of a control that exists as code and
not as behaviour.

**Fix direction.** Decide which backup is the backup. If it is `tenantBackup.service`, schedule it
and delete `backup.middleware`; if the folder zip has a purpose, rename the variable and the Helm
comment so nobody reads "tenant backup" and believes it. Either way, make the write and prune paths
one constant.

**Definition of Done**
- [ ] `BACKUP_SCHEDULER` drives something that contains tenant data, or is renamed
- [ ] a restore from whatever it produces is exercised once, and the test is named
- [ ] the write and prune paths come from a single expression
- [ ] `deploy/**` and `docs/DEVOPS/**` say what the job actually does

---

## W-11 — A deleted or deactivated role keeps its permissions for up to an hour

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/roles.service.js:288–353` caches the authorization matrix for an hour:

```js
static async getRolePermissionsMatrix(roleId) {
  const cacheKey = cacheKeys.permissions(roleId);     // "permissions:role:<id>"
  const cached = await get(cacheKey);
  if (cached) { return cached; }
  …
  await set(cacheKey, matrix, 3600);                  // :353
}
```

`middlewares/dynamicAccess.middleware.js:260` and `:341` read it on **every gated request**. Most
mutation paths do invalidate: `assignMenuToRole` (`:181`), `removeMenuFromRole` (`:194`),
`updateMenu` and `deleteMenu` (`delPattern("permissions:role:*")`, `:555`, `:576`).

`deleteRole` (`:131–148`) does **neither**:

```js
if (role.is_system) {
  await role.update({ status: "inactive" });
  await RoleMenuPermission.destroy({ where: { roleId: id } });
  return { message: "System role deactivated" };
}
await role.destroy();
```

No `del`, no `delPattern`. The permission rows are gone from the database and the matrix is still in
Redis, shared by every replica, for the remainder of its hour.

Nothing else closes the gap: `grep -n "role.*status\|role.*inactive" src/middlewares/auth.middleware.js
src/services/auth.service.js` returns nothing, so a holder of a deactivated role still authenticates
normally.

**Why it matters here.** This is the one cache in the async layer that holds an **authorization
decision**. Revoking a role — the blunt instrument an operator reaches for during an incident —
does not take effect for up to an hour, and the operator gets a success message. Per-user overrides
were fixed under A-35 and do invalidate (`userPermission.service.js:171`, `:188`, TTL 300 s at
`:25`); this path was not covered.

The cache is otherwise sound and I want to be precise about that: keys are `permissions:role:<uuid>`
and `permissions:user:<uuid>` (`redis.service.js:272–273`), roles are global rather than per tenant,
and I found **no** cache key in the async layer that mixes tenants. There is no cross-tenant cache
hit here.

**Fix direction.** `del(cacheKeys.permissions(id))` on both branches of `deleteRole` — and, because
the next omission will be somewhere else, a test that enumerates every write to `RoleMenuPermission`
or `Role` in the service and asserts each one invalidates.

**Definition of Done**
- [ ] both `deleteRole` branches invalidate
- [ ] a test deactivates a system role and asserts the very next `dynamicAccess` call denies
- [ ] a data-driven test over the service's mutations fails when a new one forgets

---

**What was changed (2026-09-24)** — `roles.service.js`, 100 %.

`deleteRole` (both branches), `updateRole` when it changes `status`, and `createMenu` for a child menu
now invalidate the permission cache. The last one was a second instance: a child inherits its
parent's grant, so a stale matrix **denied** a newly created child menu for up to an hour.

**Invalidating the cache alone would not have revoked anything**, which is the part worth recording.
`updateRole(id, {status: "inactive"})` leaves the role's permission rows in place, `Role` is
`paranoid` so `destroy()` is a soft delete that also leaves them, and `getRolePermissionsMatrix` never
checked status — so the rebuilt matrix granted exactly what the stale one did. On a cache miss it now
returns `{}` for a role that is missing or not `active`, the same rule `hasPermission` already
applied. The denial is not cached, so a reactivated role works again immediately.

**That new check was verified against the data before being accepted**, because it would silently
strip grants from any role whose status is anything other than exactly `"active"`: the column is
`STRING(20)`, not an ENUM. But every writer in the code uses lowercase `"active"`/`"inactive"`,
`roles.validator.js:18` restricts the API to `"active" | "inactive" | "deleted"`, and all 11 roles on
the running deployment are `active`. The only reachable non-active values are exactly the ones that
should deny.

**Proof** — a stateful Map-backed Redis mock, so each test reads, mutates and reads again: after
`deleteRole` the next read grants nothing (against the old code: `Expected: false, Received: true`),
and the same for deactivation and for `updateRole` to inactive.

**Not covered:** if Redis is down at the moment of revocation, `del` returns `false` and the old
matrix returns with Redis for the rest of its hour. `deleteRole` does not fail or retry.

## W-12 — Every scheduled job runs with no tenant predicate

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-060, ADR-069) — live on PostgreSQL 18.6 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`utils/tenantScope.util.js:53–61`:

```js
const ctx = tenantStorage.getStore();
if (!ctx) { return { mode: "skip" }; }
```

and the header comment names schedulers as an intended `skip` case (`:20–22`). No cron job, no
worker and no MQTT handler wraps its body in `tenantStorage.run(...)` — grep for it outside
`middlewares/` and `config/socket.js` returns nothing. So for all background work:

- **`beforeFind` / `beforeCount` / `beforeBulkUpdate` / `beforeBulkDestroy` add no predicate at
  all** (`:71`),
- **`beforeCreate` does not stamp `tenantId`** (`:83–84`, "only stamp when there is a real tenant"),
- `beforeDestroy`'s cross-tenant assertion is skipped too (`:93–94`).

Deny-by-default, the property the whole design rests on, does not apply. Every background query's
isolation is whatever the call site wrote by hand, and they are not consistent:

| Call site | Tenant predicate |
|---|---|
| `dataRetention.service.js:128`, `:137`, `:146` | explicit, and the comment at `:169–171` says so deliberately |
| `calibrationScheduler.service.js:58` | `buildDueWhere(null, …)` — **all tenants, by design** |
| `calibrationScheduler.service.js:81` | **none** — `deviceId` + `type` + `status` only |
| `iot.service.js:134` | explicit `tenantId` from the MQTT topic |
| `batchJob.service.js:74` `runJob` | **none** — `findByPk(jobId)`, and the `tenantId` carried in the message payload (`:35`) is never used |

The two with no predicate are saved today by UUID primary keys, not by a control. And because
`beforeCreate` does not stamp, a background `create` that forgets `tenantId` writes a NULL-tenant
row rather than being corrected — silently, exactly like the `is_deleted` trap.

**Why it matters here.** The skip is a defensible decision, and it is recorded. What is missing is
the compensating control: nothing makes a background job declare which tenant it is acting for, so
"remembered the predicate" is the only thing between this and a cross-tenant write. Raw SQL gets a
review rule for exactly this reason (`CLAUDE.md`); background work has the same property and no
rule.

**Fix direction.** Give the jobs the context they are entitled to. A per-tenant sweep (`retention`,
and the per-device body of the calibration scan) should run inside
`tenantStorage.run({ tenantId, isSystemTask: false }, …)` so the hooks enforce it and the call sites
stop hand-rolling it. Genuinely cross-tenant reads then set `isSystemTask: true` **explicitly**,
which makes them greppable and reviewable instead of implicit.

**Definition of Done**
- [ ] a helper — `runAsSystem()` / `runForTenant(tenantId)` — exists and every job uses one
- [ ] a test asserts a job running `runForTenant(A)` cannot read tenant B's rows even with a
      hand-written `where` that omits the predicate
- [ ] `batchJob.service.runJob` uses the `tenantId` its own message carries
- [ ] every remaining `isSystemTask` is a named, reviewed opt-out

**Partly fixed (2026-09-25, ADR-060).**

- `utils/jobContext.util.js` has two helpers:
  - `runForTenant(tenantId, fn)`: the hooks confine and stamp every query to that tenant.
  - `runAsSystem(reason, fn)`: a named cross-tenant opt-out. It refuses an empty reason.
  Neither helper is a super admin.
- **Using them:**
  - The batch-job runner, in the tenant its **message** carries. It refuses a message with no
    `tenantId`.
  - The batch-job sweeps.
  - The calibration scan: the all-tenant read uses `runAsSystem`, and each device's work runs under
    `runForTenant(device.tenantId)`.
- The tenant-lifecycle processor (W-01) and the scheduled backup already ran each tenant in its own
  context.

**Tests.**
- `jobContext.w12.test.js`: "a hand-written where that forgets the tenant is confined to tenant A"
  and "a where naming ANOTHER tenant is overridden to tenant A". These use the real global hooks on a
  real model. The suite cannot load at `fabc3be`.
- `batchJob.w07.live.test.js`, "a runner confined to another tenant cannot claim the job, and leaves
  it PENDING". This one ran live on PostgreSQL 18.6.

**Still open:**
- The retention purge, session cleanup, the quarantine sweep, the webhook dispatcher and MQTT ingest
  use neither helper.
- The DoD's "every remaining `isSystemTask` is a named, reviewed opt-out" is not met for them.

**What was changed (2026-09-25, ADR-069) — DONE.**

- **The opt-outs are a closed list.** `SYSTEM_TASKS` in `utils/jobContext.util.js` has six
  entries, and `runAsSystem` refuses any other reason. A test scans `src/` and fails when
  `isSystemTask: true` appears outside that file, or when a `runAsSystem(...)` passes a literal.
- **Each remaining job now declares its context:**

  | Job | Context |
  |---|---|
  | Retention purge | `runForTenant(tenant)` per tenant. The `tenants` list itself is not tenant-scoped |
  | Session cleanup | `SYSTEM_TASKS.SESSION_CLEANUP`. An operator's session has no tenant, so a per-tenant loop would miss it |
  | Quarantine sweep | `SYSTEM_TASKS.QUARANTINE_SWEEP`. One shared directory, no table |
  | Webhook dispatcher | The raw claim runs under `SYSTEM_TASKS.WEBHOOK_DISPATCH`. Each claimed delivery runs under `runForTenant(its tenant)` |
  | MQTT and HTTP IoT ingest | `runForTenant(tenant)` inside `ingestReading`. A topic naming another tenant's device finds nothing |
  | Tenant lifecycle, scheduled backup | They had a per-tenant context already. Both now use `runForTenant` |

- **Found and fixed: W-33.** Giving the retention purge a tenant context exposed it. The isolation
  hook put `tenantId` into a bulk DELETE after Sequelize had mapped names to columns, and PostgreSQL
  refused every one. `beforeBulkDestroy` now uses the column name.

**Tests.**
- `jobContext.w12.test.js`:
  - "ADR-069: runAsSystem refuses a reason that is not a reviewed SYSTEM_TASKS entry"
  - "the list is frozen and names exactly the reviewed jobs"
  - "no source file but jobContext.util sets isSystemTask: true"
  - "every runAsSystem call names a SYSTEM_TASKS entry, never a literal"
- `scheduledJobs.w17.test.js`:
  - "the sweep reads tenants in keyset pages and purges each inside ITS OWN tenant context"
  - "runs as the named platform task, never in a tenant and never as a super admin" (sessions)
  - "reads expired tenants in keyset pages of ids, and offboards each in its own tenant"
  - "claims as the named system task and delivers each row in its own tenant" (webhooks)
- `quarantineSweep.s33.test.js`, "W-12: runs in the named platform context, never a tenant's and
  never a super admin's".
- `iot.service.test.js`:
  - "W-12: the ingest runs confined to the tenant it was given, not as a system task"
  - "W-12: an ingest with no tenant is refused before any query"
- **Live, PostgreSQL 18.6** — `backgroundJobs.w12.live.test.js`:
  - "a destroy with NO tenant predicate inside runForTenant(A) deletes only A's rows, in a bounded
    statement"
  - "the sweep purges each tenant in batches, one audit row per pass, and never touches a tenant on
    hold"
  - "a message naming tenant B for tenant A's device writes nothing, in either tenant"
  - "deletes every expired session — both tenants' and a platform operator's — in batches, and
    keeps live ones"

**Fail-before** (a worktree at `beb0c4b`):
- all four `jobContext.w12` tests above fail;
- so do the `scheduledJobs.w17` context tests;
- live, the first two tests fail with `column "tenantId" does not exist` (W-33).

"A message naming tenant B…" fails at `beb0c4b` only because of rows the earlier failures left
behind. Its own predicate was explicit before, so it is **not** independent fail-before evidence.
The session test passes at `beb0c4b`: its SQL was always correct, and it pins the new behaviour.

The two-tenant fixture `createTwoTenants()` was **not** used. It is a request-path double with no
hooks and no SQL (its header says so). What W-12 needed proved is the global hooks and the
statements they produce, so the proof is the real hooks on real models against PostgreSQL.

---

## W-13 — Every job's failure path ends in a log nobody reads

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code; the "0 lines in `docker logs`" measurement is A-14's, on the reference deployment |

**Evidence**

Every scheduled job has the same terminal handler:

| Job | Line | Handler |
|---|---|---|
| backup | `backup.middleware.js:148` | `logger.error(...)` |
| session cleanup | `sessionCleanup.middleware.js:67` | `logger.error(...)` |
| calibration scan | `calibrationScheduler.middleware.js:47`, and per device `calibrationScheduler.service.js:159` | `logger.error(...)` |
| retention | `retentionScheduler.middleware.js:47`, per tenant `dataRetention.service.js:194` | `logger.error(...)` |
| tenant lifecycle | `index.js:635` | `logger.error(...)` |
| email consumer | `emailQueue.service.js:323` | `logger.error(...)` |
| batch worker | `batchJob.worker.js:62`, `:78` | `logger.error` / `logger.warn` |
| MQTT ingest | `iot.service.js:76` | `logger.error(...)` |
| socket emit from a job | `notification.service.js:71` | **`console.warn`** |

Per A-14, `activityLog.middleware.js` adds the Console transport **outside production only**, so on
the reference deployment `docker logs` has zero lines and these go to a file. There is no alert, no
metric, no counter, no `job_runs` table, and no endpoint that reports when a job last succeeded.
The summary objects the jobs build — `{ scanned, workOrdersCreated, skipped, errors }`
(`calibrationScheduler.service.js:62`), `{ tenants, purged, skipped, errors }`
(`dataRetention.service.js:179`) — are formatted into a log line and discarded.

Three of the findings above are instances of this, not coincidences: W-01 has thrown nightly since
it was written and nobody knew; W-05 degrades silently; W-06 stops consuming silently. And the
project's own history names the same shape — the retention purge that "failed nightly for weeks".

**Why it matters here.** These are compliance jobs. "Would anyone know?" is answered **no** for
every row of the table above.

**Fix direction.** Persist the outcome, do not log it: a `job_runs` row per execution — job name,
started, finished, counts, error — written by the same wrapper that runs the job, and a
super-admin endpoint plus a readiness signal for "job X has not succeeded in N intervals". That is
also the cheapest possible test for W-01, because a job that has never succeeded has no rows.

**Definition of Done**
- [ ] every scheduled job writes a run record, success or failure
- [ ] a stale-success condition is surfaced somewhere a human or a monitor sees
- [ ] `notification.service.js:71` uses the logger, not `console.warn`
- [ ] a test asserts a throwing job still leaves a run record with the error

---

## W-14 — MQTT ingest fans out to every replica, with no backpressure

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code. **Latent** — MQTT is off on the reference deployment (`index.js:664`, A-17), and demonstrating it needs a broker and two replicas |

**Evidence**

`services/iot.service.js:26–44`:

```js
const clientOpts = { clientId: `callibrator-backend-${Date.now()}`, clean: true, reconnectPeriod: 5000 };
…
this.client.subscribe("device/#", …)
```

A unique client id per process, `clean: true`, and a plain wildcard subscription — **not** a shared
subscription (`$share/...`). Every replica receives every retained and live message on `device/#`.
There is no message identity and no `claimMessage` on this path, so at N replicas one publish
produces **N `iot_readings` rows** (`:162`) and, when the reading is out of tolerance, **N
tenant-wide anomaly notifications** (`:172`).

Three further properties of the same handler:

- **No backpressure.** `on("message")` does two unbatched writes per message with no queue and no
  concurrency limit. A device burst, or a broker replaying retained messages on reconnect, issues
  as many concurrent database writes as there are messages.
- **No transaction.** The reading (`:162`) and the alert (`:172`) are independent; a failure between
  them leaves a recorded anomaly with no alert, or the reverse on a retry.
- **No alert deduplication.** An oscillating sensor creates one tenant-wide notification per
  reading. `emitNotification` with `userId: null` reaches every user of the hospital
  (`notification.service.js:61–65`).

The A-45 fix is present and correct: the ingest rejection is caught (`:75–82`) instead of reaching
`unhandledRejection`, and `.unscoped()` carries `isDeleted: false` explicitly (`:134–135`).

**Why it matters here.** These rows feed predictive maintenance and the anomaly alerts a clinical
engineer acts on. Duplicated readings are not a cosmetic defect — they change the statistics. This
is latent only because the feature cannot be provisioned at all (A-29), which means it will be
turned on for the first time by someone who does not know this.

**Fix direction.** Ingest belongs behind the durable queue that already exists: the MQTT handler
publishes to RabbitMQ and a worker consumes it, which brings prefetch, the DLQ and `claimMessage`
with it. If MQTT stays direct, use a shared subscription so exactly one replica gets each message,
give the payload a producer-side id to deduplicate on, and put the reading and the alert in one
transaction. Alerts need a suppression window regardless.

**Definition of Done**
- [ ] one publish produces exactly one reading row with two replicas running — a live test
- [ ] reading and alert commit together or not at all
- [ ] a repeating anomaly produces one notification per window, not one per reading
- [ ] a burst of M messages issues bounded concurrent writes

---

## W-15 — The GDPR export ZIP is deleted by an in-process timer

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — privacy |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/gdpr.service.js:264–282`:

```js
function scheduleExportCleanup(exportDir, zipPath) {
  const cleanupTime = EXPORT_RETENTION_HOURS * 3600000;
  setTimeout(() => { … fs.rmSync(exportDir, …); fs.unlinkSync(zipPath); … }, cleanupTime);
}
```

with `EXPORT_RETENTION_HOURS` defaulting to **168** (`:25–26`) — seven days. A single `setTimeout`,
held only in that process's event loop, is the **only** thing that deletes a ZIP containing a data
subject's exported personal data. Any restart inside those seven days — a deploy, a crash, an
`uncaughtException` (W-09), an OOM — and the timer is gone. Nothing sweeps the directory
afterwards: `grep -rn "EXPORT_RETENTION_HOURS" src/` returns only the definition, the
`expiresAt` the caller reports (`:81`), this timer, and a config read-back (`:884`).

The row still claims an expiry the file no longer has, so the database says the export expired and
the disk still has it.

**Why it matters here.** A GDPR subject-access export is the densest single file of personal data
this system produces, and its retention is enforced by the least durable mechanism available. The
deletion also leaves no record — same gap as W-04.

**Fix direction.** Retention belongs in the retention sweep, which already runs nightly: record the
expiry on the row and have `runRetentionSweep` delete expired exports and their files, then write
an audit row. Keep the timer as the fast path if that is wanted, but it must not be the only path.

**Definition of Done**
- [ ] an export whose process died is deleted by the next sweep
- [ ] a test creates an expired export, runs the sweep, and asserts the file is gone and a row says
      so
- [ ] the retention window is stated in `docs/` against the GDPR commitment

---

## W-16 — The retention purge: no transaction, and one bad setting silences a tenant

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/dataRetention.service.js:116–160` loops three entities per tenant, issuing three
independent `destroy` calls with **no transaction**. A crash between them leaves audit logs purged
and notifications not, with nothing recording how far it got (W-04).

`:30–34` is the sharper one:

```js
policies.forEach((p) => {
  const key = p.key.replace('retention_policy_', '');
  result[key] = parseInt(p.value, 10);      // NaN for anything non-numeric
});
```

`parseInt("", 10)`, `parseInt("none", 10)` and `parseInt(null, 10)` are all `NaN`. `NaN <= 0` is
**false**, so `:117`'s guard does not skip it, and `:121–122` then computes
`cutoff.setDate(cutoff.getDate() - NaN)` → **Invalid Date**. Sequelize serialising that throws, the
per-tenant `catch` at `:192` counts one `errors` and logs, and the sweep moves on.

The consequence is precise: **one malformed `retention_policy_*` row makes that tenant's data never
purge, forever, and the only trace is a counter in a log line.** `setRetentionPolicy` (`:38`)
validates the key but never the value's numeric-ness, and the setting can also arrive through any
other writer of `tenant_settings`.

Also here: `runRetentionSweep` iterates `Tenant.findAll({ attributes: ['id'] })` (`:177`) with no
pagination and issues roughly five queries per tenant sequentially — see W-17.

**Fix direction.** `Number.isInteger` the parsed value and fall back to the default with a **loud**
log when it is not; wrap each tenant's three deletes in one transaction with the audit row from
W-04 inside it; validate on write in `setRetentionPolicy` as well, so the bad value cannot be
stored through the supported path.

**Definition of Done**
- [ ] a tenant with `retention_policy_audit_logs = "forever"` purges on the default and the anomaly
      is reported, not swallowed
- [ ] a failure mid-purge rolls back, asserted by a test
- [ ] `setRetentionPolicy` rejects a non-numeric value with 400

**Transaction half fixed (2026-09-24, under A-41);** see W-04. One malformed setting still silently
stops a tenant's purge.

---

## W-17 — Unbounded result sets and N+1 inside the per-tenant loops

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-069, ADR-073): every scheduled job bounded; emit-path first attempts capped; the scan commits per tenant chunk; offboarding builds no export |
| **Severity** | low–medium |
| **Verified** | from code. Impact depends on row counts nobody has measured here |

**Evidence**

| Site | Shape |
|---|---|
| `calibrationScheduler.service.js:58` | `CalibrationDevice.findAll` over **every tenant**, no `limit`, every attribute — the whole due set materialised at once |
| `calibrationScheduler.service.js:72–163` | per device: 1 `findOne` + 1 `create` + 1 notification (+ its own email lookup) + 1 webhook query — **sequential**, ~5 round trips per device |
| `dataRetention.service.js:177` | `Tenant.findAll` with no pagination, then ~5 queries per tenant, sequential |
| `tenantLifecycle.service.js:235` | `Tenant.findAll` full rows, then `offboardTenant` **per tenant inside the loop** |
| `tenantLifecycle.service.js:116` | offboarding calls `exportTenantData(tenantId)` — a full export of the tenant's users and settings, built in memory and **returned to a caller that discards it** (`index.js:633`) |
| `dataRetention.service.js:257–276` | `Model.findAll({ where: { tenantId } })` then **one UPDATE per row**, plus a `recordUpdates.id = randomUUID()` on an instance update, which is not a safe way to change a primary key |
| `webhook.service.js:248–259` via `calibrationScheduler.service.js:134` | one detached delivery chain per device per webhook, each living up to ~55 s (A-10), with **no concurrency cap** |

The last one compounds: 500 due devices and one subscribed webhook means 500 concurrent in-flight
`fetch` chains spawned from a loop that does not wait for them.

**Why it matters here.** None of this is wrong on the reference deployment's data volume. All of
it is wrong on a hospital group's, and the failure mode — a scheduler that OOMs the process at
01:00 — takes the API down with it, because the scheduler and the API are the same process (W-02).

**Fix direction.** Batch the scans: `findAll` with `limit` and a cursor, and process tenants and
devices in bounded chunks. Replace the per-device round trips with a single grouped query for
outstanding work orders. Cap outbound delivery concurrency. Drop the export from the offboard path,
or write it somewhere.

**Definition of Done**
- [ ] no scheduled job calls `findAll` without a bound
- [ ] the calibration scan's per-device queries are constant, not linear in devices
- [ ] outbound webhook concurrency is capped, with the cap named
- [ ] `offboardTenant` does not build an export it throws away

**Partly fixed (2026-09-25).**

- The calibration scan reads due devices in keyset pages (`CALIBRATION_SCAN_BATCH_SIZE`, 200).
- It reads the open work orders of a page in **one** query, instead of one query per device.
- Test: `calibrationScheduler.w03.test.js`, "reads due devices in keyset pages and open work orders
  once per page".

**Still open:**
- Creating a work order is still a transaction per due device. That is inherent in the work.
- The other jobs' `findAll` calls are not bounded.
- Webhook concurrency is not capped.
- `offboardTenant` still builds an export it throws away.

**What was changed (2026-09-25, ADR-069 §6).** Every scheduled job now reads and deletes in bounded
pages or batches:

| Job | Bound | Setting (default) |
|---|---|---|
| Retention sweep | tenants in keyset pages of ids | `RETENTION_SWEEP_TENANT_PAGE_SIZE` (100) |
| Retention purge | each pass deletes at most N rows per table (`DELETE … WHERE id IN (SELECT id … LIMIT n)`), with one transaction and one audit row per pass. A table that filled its batch gets another pass | `RETENTION_PURGE_BATCH_SIZE` (5000) |
| Retention sweep | every tenant gets at least one pass per run. After the budget, catch-up passes stop and the tenant is counted in `incomplete` | `RETENTION_SWEEP_BUDGET_MS` (15 min) |
| Session cleanup | bounded DELETE batches until a short batch or the budget | `SESSION_CLEANUP_BATCH_SIZE` (1000), `SESSION_CLEANUP_BUDGET_MS` (60 s) |
| Quarantine sweep | the directory is streamed with `opendir`, and a run stops after N entries with `truncated: true` | `QUARANTINE_SWEEP_MAX_ENTRIES` (5000) |
| Tenant lifecycle | ids in keyset pages | `TENANT_LIFECYCLE_PAGE_SIZE` (50) |
| Scheduled backup | tenants in keyset pages. The prune walks `(tenant ASC, created_at DESC, id DESC)` pages and carries the tenant's rank across a page boundary | `BACKUP_PRUNE_PAGE_SIZE` (500) |
| Webhook dispatcher | already `LIMIT`ed, so one pass has at most N POSTs in flight | `WEBHOOK_DISPATCH_BATCH` (50) |

The watchdog's stuck-job read was already bounded (`limit: 20`). The batch-job sweeps are one
conditional `UPDATE` each.

**Tests.**
- `scheduledJobs.w17.test.js`:
  - "a table that fills its batch gets another pass, each pass one transaction and one audit row"
  - "stops starting passes once the deadline has passed, and says the tenant is incomplete"
  - "the sweep counts a tenant left with rows as incomplete"
  - "deletes in bounded batches until a batch comes back short"
  - "stops after the batch in hand once its time budget is spent"
  - "reads expired tenants in keyset pages of ids…"
  - "the tenant list is read in keyset pages"
  - "the prune carries a tenant's rank across a page boundary and pages on the composite key"
- `quarantineSweep.s33.test.js`:
  - "W-17: one run examines at most `limit` entries and says it stopped early"
  - "W-17: QUARANTINE_SWEEP_MAX_ENTRIES sets the bound; an invalid value falls back to the default"
- `tenantScope.bulkDestroy.w33.test.js`, "a bounded destroy carries it inside the LIMIT subquery".
- **Live, PostgreSQL 18.6** — `backgroundJobs.w12.live.test.js`:
  - "the sweep purges each tenant in batches, one audit row per pass…" (batch 2, tenant page 1)
  - "the composite keyset walks every tenant's backups across pages, keeping the newest keepMin of
    each"

**Fail-before** (a worktree at `beb0c4b`): every `scheduledJobs.w17` bound test and both quarantine
bound tests fail. The live keyset test passes at `beb0c4b`, because the old prune read everything
in one query. It pins the new paging, not a defect.

**DoD after this change:**
- [x] no scheduled job calls `findAll` without a bound
- [ ] the calibration scan's per-device **writes** are still linear in devices. Its reads are
      constant per page
- [ ] outbound webhook concurrency: capped per dispatcher pass (`WEBHOOK_DISPATCH_BATCH`). The first
      attempt `emitEvent` makes per event is **not** capped
- [ ] `offboardTenant` still builds an export it throws away. `tenantLifecycle.service.js` is being
      edited under D-23, so this was left alone

**What was changed (2026-09-25, ADR-073) — the remainder.**

1. **Emit-path cap.** `emitEvent` keeps at most `WEBHOOK_EMIT_CONCURRENCY` (10) first attempts in
   flight per process. A delivery past the cap is written, gets no immediate attempt, and is counted
   in the result's `deferred`. The row is already due, so the dispatcher's next pass (15 s) sends it.
   Nothing is queued in memory.
2. **Offboarding builds no export (removed, not kept).** It was built before the transaction,
   discarded by the scheduler, and ignored by the operator's screen, which nonetheless said "data
   exported". The data stays readable through `GET /tenants/:tenantId/export` until the hard delete.
   The response is `{ tenant }`. The frontend's type, test and toast were updated.
3. **The scan commits per tenant chunk.** Within a page, due devices are grouped by tenant and split
   into chunks of `CALIBRATION_SCAN_TX_BATCH_SIZE` (25). Each chunk gets two transactions:
   - the work orders: `maintenanceService.createAutoScheduledWorkOrders`, which does one `INSERT …
     ON CONFLICT DO NOTHING` and a read-back **by id**, then writes one audit row per order;
   - the notifications, one audit row each.

   A device whose order a concurrent scan created is `conflicted` and counted as a skip (W-03 is
   intact: `calibrationScheduler.w03.live.test.js` still passes).

**Tests.**
- `webhook.emitCap.w17.test.js`:
  - "writes a row for every webhook but starts at most WEBHOOK_EMIT_CONCURRENCY attempts; the rest are deferred"
  - "the cap is per process, across events: a second event while two are in flight starts none"
  - "a slot is released when its attempt settles, so the next event's first attempt runs"
  - "a failed attempt releases its slot too"
  - "WEBHOOK_EMIT_CONCURRENCY defaults to 10, and an invalid value falls back to it"
- `tenantLifecycle.service.test.js`, "W-17: offboarding builds no export — no user, setting,
  subscription or invoice is read". Also `tenantLifecycle.export.a179.test.js`, "the offboarding
  response carries no export", which replaces "…carries the same redacted export".
- `maintenance.autoScheduled.w17.test.js` (7 tests), including:
  - "inserts every item in ONE statement, ON CONFLICT DO NOTHING, in one transaction"
  - "writes one audit row per created order, naming the actor and that order, in the transaction"
  - "reads back what was inserted BY ID, so a conflicted device is reported, not misattributed"
  - "a device that is not the tenant's is reported missing and never inserted (A-220)"
- `calibrationScheduler.w03.test.js`, "W-17 (ADR-073) — work orders and notifications in one
  transaction per tenant chunk":
  - "one batch call per chunk of one tenant's devices; two tenants never share one"
  - "the chunk's notifications share ONE transaction, each with its own audit row naming its device and work order"
  - "a chunk in which nothing was created opens no notification transaction"
  - "CALIBRATION_SCAN_TX_BATCH_SIZE defaults to 25, and an invalid value falls back to it"
- `calibrationScheduler.service.test.js`:
  - "a failed chunk is an error for each of its devices, and the next chunk still runs"
  - "a device the batch reports as not the tenant's is an error, and nothing is notified for it"
- **Live, PostgreSQL 18.6** — `calibrationScheduler.batch.w17.live.test.js` (opt-in
  `CALIBRATION_BATCH_PG_LIVE_TEST=1`):
  - "chunks of 2: three work-order transactions and three notification transactions for five
    devices; a device conflicted AFTER the read is skipped without aborting its chunk". It checks
    that every audit row, notification audit and webhook payload names its own device and order;
  - "an all-tenant scan puts each tenant's devices in its own transaction, and skips the open ones by
    its read guard".

**Fail-before** (a worktree at `beb0c4b`):
- every test named above from `webhook.emitCap.w17`, `tenantLifecycle.service`,
  `maintenance.autoScheduled.w17` and the W-17 block of `calibrationScheduler.w03` fails;
- 7 pre-existing tests in `calibrationScheduler.w03.test.js` fail there only because the mocked
  seam moved from `createWorkOrder` to `createAutoScheduledWorkOrders`;
- the two new `calibrationScheduler.service.test.js` tests were not run at `beb0c4b`;
- the live chunk test fails; the live all-tenant test passes, because its behaviour is unchanged.

**DoD (final):**
- [x] no scheduled job calls `findAll` without a bound
- [x] the calibration scan's per-device queries are constant per chunk: 2 commits per ≤25 devices of
      a tenant. The exception is one autocommit webhook-delivery row per subscribed webhook per
      device, from `emitEvent`
- [x] outbound webhook concurrency is capped, with the caps named: `WEBHOOK_DISPATCH_BATCH` per
      dispatcher pass, and `WEBHOOK_EMIT_CONCURRENCY` for first attempts
- [x] `offboardTenant` does not build an export it throws away

**Found while doing it, open.** The offboard response returns the raw `Tenant` row. Its `settings`
JSONB can mirror a credential, and A-179's `exportedTenant` strips that only from the export. This
was true before, beside the export. `suspend`, `resume` and `cancelOffboarding` return the same row.
It is super-admin only, and it needs its own card.

---

## W-18 — Connection, channel and timer lifecycle

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-061) |
| **Severity** | low–medium |
| **Verified** | from code. The duplicate-connection race needs a broker to observe |

**Evidence**

A-36 fixed `isOpen` in both AMQP modules and left the duplication that made two modules necessary.

1. **Two AMQP connections per process.** `emailQueue.service.js:15–16` keeps its own `connection`
   and `channel`, built by its own `getRabbitMQConnection` (`:43`) and `createChannel` (`:79`) —
   near-identical copies of `rabbitmq.service.js:54` and `:86`, which the batch worker and every
   publisher use. The file header of `rabbitmq.service.js:3–5` says it exists precisely so this
   would stop ("the email queue historically kept its own private connection; this is the reusable
   version"); the email queue was never moved onto it.
2. **One of the two is never closed.** `index.js:51` imports `closeRabbitMQ` from
   **`emailQueue.service`**, and `index.js:718` calls that one. `rabbitmq.service.js:228`'s
   `closeRabbitMQ` — the connection the batch worker and all publishing use — has no caller outside
   tests. Shutdown closes the email connection and leaks the other. `process.exit(0)` hides it;
   a broker-side connection churn on every deploy does not.
3. **No in-flight memo on either getter.** `rabbitmq.service.js:54–84` and `emailQueue.service.js:43`
   check `if (connection) return connection` and then `await amqplib.connect(...)`. Two concurrent
   first callers both see `null`, both connect, and one result is cached while the other is
   **orphaned with no reference and no close** — a smaller instance of the leak A-36 fixed. Same at
   `getChannel` (`:86`).
4. **An unref'd connect timer.** `emailQueue.service.js:53–58` builds a 10 s timeout promise whose
   timer is not `unref()`d; its twin at `rabbitmq.service.js:68` is. On a successful fast connect
   the process holds the event loop for the remainder of the 10 s.

**Fix direction.** Delete `emailQueue`'s connection management and have it call
`rabbitmq.service`'s — the module was written for that. Memoise the in-flight promise in both
getters (`if (connecting) return connecting`). Export one `closeRabbitMQ` and call it once.

**Definition of Done**
- [ ] one AMQP connection per process, asserted by a test that calls `getChannel()` ten times
      concurrently and counts `amqplib.connect` invocations
- [ ] shutdown closes every AMQP connection the process opened
- [ ] `emailQueue.service` holds no `amqplib` import

**What was changed (2026-09-25, ADR-061).**

- `emailQueue.service` holds no `amqplib` import and no connection of its own.
- There is one connection per process, in `rabbitmq.service`, with in-flight memos on both
  `getConnection` and `getChannel`. The connect timer is `unref()`d.
- There is **one** `closeRabbitMQ`. `index.js` imports it from `rabbitmq.service` and calls it once.
  It stops the consumers, then closes their channels, the publishing channel and the connection.

**Tests.**
- `rabbitmq.service.test.js`:
  - "ten concurrent getConnection() calls dial ONCE"
  - "ten concurrent first callers share ONE connection and ONE channel"
  - "closeRabbitMQ closes the consumer channels, the publishing channel and the ONE connection"
- `emailQueue.service.test.js`: "queues each type as a persistent message whose messageId is the
  job id" asserts one connection. "closeRabbitMQ closes the process's ONE connection (W-18)" also
  passes.

---

## W-19 — The rate limiter's memory fallback never sweeps

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

**Evidence**

`services/rateLimiter.redis.service.js:103–120`. `memoryStore` is a `Map` with **lazy expiry only**:
an entry is removed at `:109` when it is read after expiry, and at `:120` on an explicit delete.
There is no interval, no size cap and no sweep. An entry whose key is never read again — the common
case for a per-IP bucket — stays for the life of the process.

The fallback is not exotic: it is the path taken whenever Redis is not ready, which after W-05 is
**permanent** following the first blip. A distributed credential-stuffing run from many addresses
then grows the Map without limit, in a process that is also serving the API.

**Fix direction.** Bound it: a periodic sweep (`unref`'d, so it cannot hold the process open) or an
LRU with a stated maximum. A bound is also the honest thing to document, since the fallback's
contract — "a request is still counted, just no longer counted globally" (A-30) — currently comes
with unbounded memory.

**Definition of Done**
- [ ] `memoryStore` has a stated maximum or a sweep, and a test drives it past that maximum
- [ ] the sweep timer cannot keep the process alive
- [ ] the A-30 note on outage behaviour names the bound

---

## What could not be checked

Stated plainly, because the difference between "renders" and "works" is the point.

| | Why |
|---|---|
| **Every RabbitMQ claim** — the DLQ duplication (W-09), consumer re-registration (W-06), the SIGTERM-abandoned claim (W-07), the duplicate-connection race (W-18) | no broker was started. All are read from code; each needs one run against a real RabbitMQ to settle |
| **Every concurrency claim** — the calibration race (W-03), the MQTT fan-out (W-14), the per-replica cron duplication (W-02) | needs two replicas. Today prod is `replicaCount: 1`, so all three are **latent**, and W-02 is the reason they stop being latent |
| **The Redis lifecycle (W-05)** | ioredis's behaviour on `retryStrategy → null` is read from the option's contract, not observed. Restarting a real Redis under a running backend would settle it in a minute |
| **What is actually inside `backend/data` on the VM (W-10)** | needs shell access to `10.1.200.13`. The code path is unambiguous; the contents are an assumption |
| **The Postgres error text for W-01** | `invalid input value for enum` and `column "gracePeriodExpiresAt" does not exist` are predicted from the model definition and the Sequelize where-clause behaviour, not observed. The *defect* does not depend on which of the two fires first |
| **Whether the deployed image is packaged (W-10, secondary)** | the `storagePath` divergence only bites when `isPackaged` is true; the Dockerfile's runtime was not traced |
| **Anything about running jobs** | no job was executed. This is a code audit, as the evidence standard above says |

**No code was changed.** This file is the only thing written.

---

## W-20 — A hard delete would erase the tenant's audit trail

| | |
|---|---|
| **Status** | TODO — **owner decision** |
| **Severity** | **high** — latent; the function is not routed or scheduled |
| **Verified** | on PostgreSQL 18.6, `\d tenants`, 2026-09-24 (W-01) |

`hardDeleteOffboardedTenant` destroys the tenant's users, subscription, invoices, settings and the
tenant row. It runs with no transaction and writes no audit row. And `audit_logs.tenant_id` is
`ON DELETE CASCADE`, so deleting the tenant row **deletes every audit row the tenant ever had** —
including the record of its own offboarding. That contradicts the 21 CFR Part 11 retention claim, and
it joins Q-12: can audit rows be deleted at all?

**Fix direction:** change the audit foreign key so it no longer cascades — either `RESTRICT`, or no FK,
keeping the tenant id as a value. Then give the hard delete a transaction and an audit row. Decide
this before anyone routes the function.

---

## W-21 — A grace period can be set on a tenant that is not suspended

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (W-01) |

`enterGracePeriod` accepts an active tenant and sets the deadline. If that tenant is suspended after
the deadline has passed, the next scheduled run offboards it at once, with no grace. **Fix
direction:** a 409 with a state explanation when the tenant is not suspended.

---

## W-30 — The scheduled calibration scan's work orders were all rolled back

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-061) |
| **Severity** | **high** |
| **Verified** | by test against the audit-ledger fixture (real ENUM, NOT NULL columns, migration 0033's actor CHECK, real rollback) |

**Evidence.**
- A-190 moved `maintenance.service#createWorkOrder` into a transaction together with its audit row.
- A-124 made `logAction` refuse an entry that names neither a user nor a system actor.
- The calibration scan called `createWorkOrder(tenantId, data)` with **no actor**.

So every work order the **scheduled** scan tried to create was rolled back, and was counted as a
per-device error. A manual run from the API was unaffected, because it had a user. Found while
fixing W-03.

**Fix.**
- `SYSTEM_ACTORS.CALIBRATION_SCAN` (`system:calibration-scan`) is passed as the actor of a
  scheduled scan.
- A manual run passes the requesting user, and an actor without a `userId` falls back to the
  system actor.

**Tests.**
- `maintenance.w30.test.js`:
  - "with NO actor (what the scan passed before) the work order is rolled back"
  - "with the system actor it commits the work order and ONE audit row naming the job"
  - 3 of 3 fail at `fabc3be`.
- `calibrationScheduler.w03.test.js`, "a scheduled scan (no actor) is attributed to
  system:calibration-scan".
- Live on PostgreSQL 18.6: `calibrationScheduler.w03.live.test.js` asserts one audit row for the
  one work order.

---

## W-31 — The batch worker acked on the wrong channel

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-061) |
| **Severity** | medium |
| **Verified** | against the in-memory broker, and live on RabbitMQ 4 |

**Evidence.**
- `workers/batchJob.worker.js` consumed on one channel and acked through
  `rabbitmq.getChannel()`, the shared **publishing** channel.
- A delivery tag is per channel. The broker answers an ack of a tag the channel never delivered
  with `PRECONDITION_FAILED` and **closes that channel**.
- The result: every batch-job ack broke publishing for every producer in the process, until the
  channel was reopened.

**Fix.**
- A handler receives `(msg, ch)`, where `ch` is the arrival channel.
- `rabbitmq.ack(ch, msg)` and `nack(ch, msg)` settle there.
- They never throw: a closed channel means the broker has already requeued the message.

**Tests.**
- `rabbitmq.service.test.js`:
  - "acking on the PUBLISHING channel (what the batch worker did) closes that channel"
  - "ack/nack on the channel the message came on; a closed channel is logged, not thrown"
- `batchJob.worker.test.js`, "consumes, acks on the arrival channel, and dead-letters a failure".
- Live: `rabbitmq.w06.live.test.js` raised no channel error across its runs.

---

## W-32 — The IoT anomaly alert had never been stored

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-069) |
| **Severity** | medium |
| **Verified** | live on PostgreSQL 18.6 |

**Evidence.**
- `iot.service.js#ingestReading` created the alert with `type: "system"`.
- `enum_notifications_type` is `{SYSTEM, CALIBRATION, INVENTORY, MAINTENANCE}`, and PostgreSQL
  answered `invalid input value for enum enum_notifications_type: "system"`.
- The reading had already autocommitted. So every anomaly stored its reading, then rejected the
  ingest, and no alert ever reached the hospital.
- Three unit tests and the A-46 route test asserted `"system"`. They held the defect in place: a
  mock accepts any string.

**Fix.** `type: "SYSTEM"`. The reading, the alert and the audit row are one transaction now (W-04),
so a refused alert can no longer leave its reading behind either.

**Tests.**
- `backgroundJobs.w12.live.test.js`, "an anomaly stores the reading, the tenant-wide alert and ONE
  audit row naming system:iot-ingest". At `beb0c4b` it fails with the ENUM error above.
- `iot.service.test.js` and `iot.provisioning.a29.test.js` now assert `"SYSTEM"`.

---

## W-33 — A bulk destroy inside a tenant context named a column that does not exist

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-069) |
| **Severity** | **high** |
| **Verified** | live on PostgreSQL 18.6, and in the real Sequelize query generator |

**Evidence.**
- `Model.destroy` calls `Utils.mapOptionFieldNames(options, this)` **before**
  `runHooks("beforeBulkDestroy", options)` (`sequelize/lib/model.js`, 6.x). Nothing maps the names
  again.
- `tenantScope.util.js#applyTenantWhere` then added `{ tenantId: ctx }`, and `DELETE … WHERE
  "tenantId" = …` reached PostgreSQL.
- So every bulk destroy of a model whose tenant attribute is `tenantId` (column `tenant_id`) failed
  whenever a tenant context was active: `column "tenantId" does not exist`.
- `Session` escaped only because its attribute is literally `tenant_id`.
- Finds and bulk updates map names after their hooks, so they were never affected.

**Why nobody saw it.** Background jobs ran with no context, so the hook skipped them. The first live
run of the tenant-scoped retention purge (W-12) failed for every tenant. On the request path, a
super admin also skips the hook. A tenant user's bulk destroy on such a model has been failing. The
affected routes are **five**, enumerated below.

**Fix.** The `beforeBulkDestroy` hook calls `applyTenantWhere(options, model, { byField: true })`,
which uses the attribute's `field`.

**Tests.**
- `tenantScope.bulkDestroy.w33.test.js` runs the real Sequelize PostgreSQL generator with the real
  hooks. All 3 tests fail at `beb0c4b`:
  - "the predicate is the COLUMN tenant_id, never the attribute tenantId"
  - "a bounded destroy carries it inside the LIMIT subquery"
  - "a where naming another tenant is overridden, not AND-ed with an unknown column"
- Live: `backgroundJobs.w12.live.test.js`, "a destroy with NO tenant predicate inside
  runForTenant(A) deletes only A's rows, in a bounded statement". It fails at `beb0c4b` with the
  error above.
- `tenantScope.test.js`, "bound hooks apply scoping…", still passes: an attribute with no `field`
  keeps its name.

**Affected routes — enumerated 2026-09-25.** Every `.destroy(` in `backend/src` (tests excluded)
was classified by model, bulk/instance and the context that reaches it.

A call site could fail only when all four were true: it is a **static** `Model.destroy` (an instance
`destroy()` fires `beforeDestroy`, not `beforeBulkDestroy`); the model's tenant attribute is
`tenantId` with column `tenant_id`; the hook resolves to `filter` or `deny`; and nothing passes
`skipTenantScope`. A super admin (`superAdminOnly`), a script, the ALLOW_SEEDING bootstrap and
`runAsSystem` all skip the hook. A paranoid model fails as well: its bulk soft delete is an
`UPDATE … SET deleted_at` built from the same mapped `where`.

**The five tenant-user routes that answered 500.** They were verified live on PostgreSQL 18
(pgvector/pgvector:pg18). The test file is `bulkDestroyRoutes.w33.live.test.js`, which is opt-in
with `W33_PG_LIVE_TEST=1`. It has 12 tests and all 12 pass with the fix. With `beb0c4b`'s
`tenantScope.util.js`, exactly these five fail with `column "tenantId" does not exist`. That result
is the same on a clean `beb0c4b` checkout and on today's `src/` with only that one file reverted.

| Route (gate) | Call site | Was broken | Test |
|---|---|---|---|
| `DELETE /api/v1/kanban/projects/:projectId` (auth + project owner) | `kanban.service.js#deleteProject` → `KanbanProject.destroy({ where: { id } })` (paranoid) | **yes**: no tenant user could delete a board | "a tenant user deletes their own project: it succeeds, and tenant B's project is untouched"; cross-tenant: "tenant B's project id answers 404 and deletes nothing" |
| `DELETE /api/v1/notifications/:notificationId` (auth) | `notification.service.js#removeForUser` → `Notification.destroy` | **yes**, for a personal notification. A tenant-wide one is only hidden through `notification_states` and worked | "DELETE /:notificationId removes the caller's personal notification, and tenant B's are untouched"; cross-tenant: "DELETE /:notificationId with tenant B's id answers 404 and deletes nothing" |
| `DELETE /api/v1/notifications/bulk` (auth) | same | **yes**, whenever a personal notification was among the ids | "DELETE /bulk deletes the caller's ids and ignores tenant B's"; "DELETE /bulk naming only tenant B's ids answers 404 and deletes nothing" |
| `DELETE /api/v1/notifications/all` (auth) | same | **yes**, whenever the caller had a personal notification | "DELETE /all removes every personal notification of the caller, and none of tenant B's" |
| `DELETE /api/v1/storage/settings` (TENANT_ADMIN) | `storage/config.service.js#clearTenantConfig` → `TenantSettings.destroy` | **yes**: a tenant could not revert to platform storage | "a tenant admin reverts to the platform default: A's two rows go, B's stay" |

**Not broken, and why.**

| Route or caller | Call site | Why | Test |
|---|---|---|---|
| `DELETE /api/v1/feature-flags/:tenantId/:flagKey` (superAdminOnly) | `featureFlag.service.js#resetTenantFlag` (TenantSettings) | super admin skips the hook | "DELETE /api/v1/feature-flags/:tenantId/:flagKey — featureFlag.resetTenantFlag" (passes at `beb0c4b`) |
| `DELETE /api/v1/oidc/clients/:clientId` (superAdminOnly) | `oidcProvider.service.js#deleteClient` (TenantSettings) | super admin | "DELETE /api/v1/oidc/clients/:clientId — oidcProvider.deleteClient" (passes at `beb0c4b`) |
| `DELETE /api/v1/data-retention/:tenantId/legal-hold` (superAdminOnly) | `dataRetention.service.js#disableLegalHold` (TenantSettings) | super admin | "DELETE /api/v1/data-retention/:tenantId/legal-hold — dataRetention.disableLegalHold" (passes at `beb0c4b`) |
| `POST /api/v1/data-retention/:tenantId/purge` (superAdminOnly) | `purgeBatch` (Notification, IotReading) | super admin on the route. The **scheduled** sweep failed only after W-12 wrapped it in `runForTenant` | `backgroundJobs.w12.live.test.js` (above) |
| no route (`tenantLifecycle.service.js#hardDeleteOffboardedTenant` has no caller) | `unscoped().destroy` | passes `skipTenantScope: true`, and nothing calls it | — |
| internal `/migration` seed/unseed (super admin or ALLOW_SEEDING) and scripts | `migration.service.js`, 46 bulk destroys | super admin, or no context | — |
| `scripts/backfillEmbeddings.js` only | `ai.service.js#ingestDocument` (DocumentChunk) | no context; no route reaches it | — |
| session cleanup scheduler | `session.service.js#cleanupExpiredSessions` (Session) | the attribute is literally `tenant_id`, and it runs under `runAsSystem` | — |
| webhook-delivery purge job (new, untracked, owned by another agent) | `webhookDeliveryPurge.service.js#purgeTenant` (WebhookDelivery) | runs under `runForTenant`, so it **would** have failed before the fix. It is not in `beb0c4b` and is not a route | not covered here |

These bulk destroys were never affected because their model is not tenant-scoped:
- `kanban.service.js`: KanbanCardAssignee, KanbanCardLabel and KanbanCardRelation;
- `menuGroup.service.js` ×3, `roles.service.js` ×3 and `seedMenuGroups.util.js`: RoleMenuPermission;
- `userPermission.service.js`: UserMenuPermission;
- `workflow.service.js`: WorkflowStep.

That leaves 34 of the 105 call sites. 31 are instance `destroy()` calls. The other 3 are not
Sequelize at all: `res.destroy`, and the ClamAV socket and stream.

**The same shape elsewhere: none found.** The other hooks were checked against
`sequelize/lib/model.js` 6.37.8. `beforeBulkUpdate` runs at :1941, before
`mapOptionFieldNames` at :2008. `beforeFind` runs before `mapFinderOptions`. `beforeCount` runs
before `aggregate`'s mapping at :1275. So the attribute name is correct in all three.

The live test "the same shape through beforeBulkUpdate is NOT affected: PATCH /projects/:projectId
updates only A's row" passes both before and after the fix.

The other hooks that add a `where` are also safe:
- `Tenant`'s `excludePlatformTenant` names `id`, where the attribute and the column are the same;
- `TenantSettings.beforeBulkUpdate` reads its `where` before mapping, as it should;
- the session liveness `beforeBulkUpdate` reads its `where` before mapping, as it should.

No code change was needed.

**Seen in passing, a different shape, not fixed here** *(now W-34, fixed by ADR-073)*. Two static methods run no tenant hook at all:
- `Model.sum/min/max/aggregate` never runs `beforeFind`. Its two call sites
  (`dashboard.service.js` `Stock.sum` and `quota.service.js` `Attachment.sum`) name `tenantId`
  explicitly.
- `Model.increment` and `Model.restore` run no tenant hook either. No static call site exists
  today.

---

## W-34 — The Sequelize statics that run no tenant hook

| | |
|---|---|
| **Status** | **DONE** 2026-09-25 (ADR-073) |
| **Severity** | medium, latent: every current call site passes `tenantId` itself |
| **Verified** | from the Sequelize 6.37.8 source, and live on PostgreSQL 18.6 |

**Evidence** (`sequelize/lib/model.js`, 6.37.8):

| Verb | Hook it runs |
|---|---|
| `aggregate`; `sum`/`min`/`max` are `this.aggregate(...)` | **none** |
| `count` | `beforeCount`, then `this.aggregate(...)` |
| static `increment`; `decrement` and instance `increment`/`decrement` end in it | **none** |
| static `restore` | `beforeBulkRestore`, after `mapOptionFieldNames`. It was **not registered** |
| instance `restore` | `beforeRestore`, **not registered** |
| `destroy({ truncate: true })` | `beforeBulkDestroy`, but the statement is `TRUNCATE`, so the WHERE is dropped |

At `beb0c4b`, on PostgreSQL 18.6, inside `runForTenant(A)`:
- `Stock.sum("quantity")` returned **1107**, which is A's 7 plus B's 1100;
- `Stock.max` returned B's 1000;
- an `increment` aimed at B's row by id changed it;
- a bulk `restore` restored B's rows.

**Fix — structural, not a guard test (ADR-073).** `tenantScope.util.js#scopeHooklessStatics` wraps
`aggregate` and `increment` on every tenant-scoped model, both the models already defined and later
ones through `afterDefine`. Those two wrappers reach every verb above. The predicate is resolved as
for a find, and `skipTenantScope: true` is the only opt-out. The other three gaps:
- `beforeBulkRestore` names the column;
- `beforeRestore` refuses another tenant's row;
- a truncate inside a tenant or deny scope is refused.

A guard test was the alternative. It was rejected because it is opt-in again (ADR-048's argument): a
text scan cannot follow aliases or a `where` built elsewhere.

**No CLAUDE.md trap line.** Nothing is left for an author to remember. Raw SQL is already listed.

**Tests.**
- `tenantScope.hookless.w34.test.js` runs the real generator with the real hooks. It has 21 tests,
  including:
  - "sum/min/max inside a tenant context carries the tenant predicate with no where of its own"
  - "an include inside sum is scoped in its ON clause too"
  - "count carries the predicate exactly once"
  - "a principal with no resolvable tenant sums nothing (deny)"
  - "skipTenantScope is the opt-out; no context and the super admin skip"
  - "static increment carries the tenant COLUMN after Sequelize maps it"
  - "with no where it is still refused by Sequelize, not widened to the whole tenant"
  - "a bulk restore carries the tenant COLUMN"
  - "an instance restore of another tenant's row is refused"
  - "a truncate inside a tenant context is refused; outside one it runs"
- `tenantScope.test.js`, "wires every mutating and reading hook", now lists `afterDefine`,
  `beforeBulkRestore` and `beforeRestore`.
- **Live, PostgreSQL 18.6** — `tenantHookless.w34.live.test.js` (opt-in `W34_PG_LIVE_TEST=1`, 6
  tests):
  - "tenant A's sum excludes tenant B's rows without an explicit where"
  - "min, max, aggregate and count see only the caller's tenant"
  - "a where naming tenant B inside tenant A's context sums A's rows, not B's"
  - "static increment and decrement with no tenant in the where change only A's rows"
  - "an increment aimed at B's row by id from A's context changes nothing"
  - "a bulk restore from A's context restores only A's soft-deleted rows"

**Fail-before** (a worktree at `beb0c4b`):
- 15 of the 21 unit tests fail. The 6 that pass pin paths that did not change: no tenant key,
  the opt-outs, the no-`where` refusal, `count`'s single predicate, and the caller's options left
  unmutated;
- all 6 live tests fail, with the numbers quoted above.
