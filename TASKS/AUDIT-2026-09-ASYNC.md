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
| W-01 | the tenant-lifecycle processor has **never run**: it filters on a column the model does not define, and on an enum value that does not exist | **high** | **live** |
| W-02 | `CALIBRATION_SCHEDULER` is set in **no** deployment file, and the chart's "not the scheduler" branch disables only one of four jobs | **high** | latent (1 replica today), live on the documented scale-out |
| W-03 | the calibration scan's idempotency guard is a check-then-create race with no lock and no constraint | **high** | latent — needs a second replica |
| W-04 | **no background mutation writes an audit row** — including the purge that destroys `audit_logs` | **high** | **live** |
| W-05 | one Redis blip disables Redis **permanently** for that process, silently, restoring the whole A-24 symptom set | **high** | **DONE** 2026-09-24 |
| W-06 | a RabbitMQ consumer is never re-registered: a broker restart ends both workers for the life of the process | **high** | **live** |
| W-07 | a batch job interrupted by SIGTERM is **acked on redelivery and never runs again** — stuck `PROCESSING`, no DLQ row | **medium–high** | **live** |
| W-08 | batch jobs do nothing: the handler registry is empty and every job reports `COMPLETED`, progress 100, with a download URL | **medium–high** | **live** |
| W-09 | the email retry both re-publishes **and** dead-letters the same message, from an in-process timer that can take the server down | medium | **live** |
| W-10 | the nightly "tenant backup" backs up two local folders and not the database; the real backup service is scheduled by nothing | medium | **live** |
| W-11 | a deleted or deactivated role keeps its permissions for up to an hour — cached authorization with no invalidation on that path | medium | **DONE** 2026-09-24 |
| W-12 | every scheduled job runs with **no tenant predicate at all**, and `beforeCreate` does not stamp `tenantId` | medium | **live** |
| W-13 | silent failure is the norm: every job's failure path ends at `logger.error`, and production writes no stdout (A-14) | medium | **live** |
| W-14 | MQTT ingest fans out to every replica — N duplicate readings and N duplicate alerts per message — with no backpressure | medium | latent (MQTT off) |
| W-15 | the GDPR export ZIP is deleted by a 168-hour in-process timer; a restart leaves exported personal data on disk forever | medium | **live** |
| W-16 | the retention purge has no transaction, and one malformed setting makes a tenant silently never purge | medium | **live** |
| W-17 | unbounded result sets and N+1 inside the per-tenant and per-device loops | low–medium | **live** |
| W-18 | connection and timer lifecycle: two AMQP connections per process, one never closed, no in-flight memo on either getter | low–medium | **live** |
| W-19 | the rate limiter's memory fallback has lazy expiry only — no sweep, unbounded growth | low | **live** |

**By severity:** 6 high · 2 medium–high · 8 medium · 3 low/low–medium. **19 total.**

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
| **Status** | TODO |
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

---

## W-02 — `CALIBRATION_SCHEDULER` is configured nowhere, and the "not the scheduler" branch disables one job of four

| | |
|---|---|
| **Status** | TODO |
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

---

## W-03 — The calibration scan's idempotency guard is a race

| | |
|---|---|
| **Status** | TODO |
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

---

## W-04 — No background mutation writes an audit row

| | |
|---|---|
| **Status** | TODO |
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
| **Status** | TODO |
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

---

## W-07 — A batch job interrupted by SIGTERM is acked on redelivery and never runs

| | |
|---|---|
| **Status** | TODO |
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

---

## W-08 — Batch jobs do nothing, and report success

| | |
|---|---|
| **Status** | TODO |
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

---

## W-09 — The email retry re-publishes *and* dead-letters, from a timer that can take the server down

| | |
|---|---|
| **Status** | TODO |
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
| **Status** | TODO |
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

---

## W-17 — Unbounded result sets and N+1 inside the per-tenant loops

| | |
|---|---|
| **Status** | TODO |
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

---

## W-18 — Connection, channel and timer lifecycle

| | |
|---|---|
| **Status** | TODO |
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
