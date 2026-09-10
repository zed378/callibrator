# 02 — Service Layer

76 services in `backend/src/services/`. Business logic and transactions live here and nowhere else.

---

## The Contract

A service:

- takes plain values, never `req` or `res`,
- owns its transactions,
- throws `AppError(status, message)`,
- returns data, never an HTTP response.

A service that touches `req` cannot be called from a worker, a scheduler or a script — and all three exist here.

There are a few services that accept `req`-shaped objects. They are wrong and should be fixed when touched.

## Transactions

```js
const { sequelize } = require("../models");   // NOT { db }

await sequelize.transaction(async (t) => {
  const record = await CalibrationRecord.create(payload, { transaction: t });
  await device.update({ nextCalibrationDate }, { transaction: t });
  await AuditLog.create(auditRow, { transaction: t });
  return record;
});
```

### `sequelize`, not `db`

`models/index.js` exports **`sequelize`**. Destructuring `db` yields `undefined`, and `db.sequelize.transaction()` throws — which broke every workflow create, update and submit-action across three functions.

### What must be atomic

| Operation | Why |
|---|---|
| Stock transfer transitions | quantity must move **exactly once** (BR-10) |
| Workflow step advance + action row | a decision without a record is unauditable |
| Certificate transition + e-signature record | the signature must not outlive a failed transition |
| Calibration record + device due-date update | a record whose device was not updated is a stale due date |
| Tenant creation + first user | a tenant with no admin is unreachable |
| Batch job progress + result | progress disagreeing with the result is worse than none |

### Audit rows go inside

An audit row that survives a rolled-back action records something that did not happen. An action that commits without its audit row is unattributable.

The transaction is what makes both impossible — which means `auditLog.middleware.js` and the service transaction have to cooperate, not run independently.

## Tenant Scoping Is Not Your Job

The global hooks inject the predicate. Services do not add `where: { tenantId }` — and adding it manually is harmless but signals a misunderstanding worth correcting in review.

Where a service genuinely must cross tenants, use `skipTenantScope` **with a comment**, or `isSystemTask` for background work.

`isSystemTask` should be scoped as narrowly as possible. Setting it for the duration of a whole consumer loop turns every query in that loop into a cross-tenant query, and there will be no error to signal it.

**Raw SQL bypasses the hooks entirely.** Every `sequelize.query` carries the predicate explicitly.

## Includes: the trap that keeps recurring

```js
include: [{ model: User, as: "assignee", required: false }]   // ✓
include: [{ model: User, as: "assignee" }]                    // ✗ INNER JOIN
```

Sequelize defaults an include against a model with a `defaultScope` — or with a `where` — to an INNER JOIN, silently dropping every parent whose optional association is null.

Two production defects:

| Where | Symptom |
|---|---|
| `getRisks`, `getRiskById` | risks with no assignee were **invisible** — absent from lists, 404 on get, update and delete |
| certificate list | returned **zero rows** while rows existed; four includes were INNER JOINs and every draft has null `approvedBy` and `signedBy` |

`maintenance_work_orders` has two nullable actor FKs and is latent.

## Pagination

```js
const { rows, count } = await Model.findAndCountAll({ limit, offset, where });
return { rows, count };
```

The controller passes these to `paginated()`, which puts rows in `data` and pagination in a **top-level `meta`**.

Three services returned `{ total, …, items: [] }` inside `data` and three frontend screens rendered empty for weeks with no error anywhere. The envelope is not a style preference.

## Errors

```js
throw new AppError(404, "Device not found");
throw new AppError(409, "Certificate is in draft and must be submitted first");
```

| Status | Use |
|---|---|
| 400 | validation the validator could not express |
| 403 | permission failure **inside the caller's tenant** |
| 404 | not found — **including belonging to another tenant** |
| **409** | invalid state transition |

Never throw a bare `Error` for a domain condition. The certificate model did exactly that for an invalid transition, and it surfaced as a 500 — hiding a real design gap (there was no submit transition at all) behind a stack trace.

## State Machines Live in the Model

```js
certificate.submitForApproval();   // model method
certificate.approve(userId);
```

The model owns which transitions are legal. The service orchestrates the surrounding work — the audit row, the signature record, the notification — inside a transaction.

That split keeps the legality rules in one place rather than repeated at every call site.

## Idempotency

Anything invoked by a worker or a webhook must be idempotent. RabbitMQ redelivers; Stripe retries.

```js
const claimed = await redis.set(key, "1", "NX", "EX", ttl);
if (!claimed) return;
try { await doWork(); }
catch (e) { await redis.del(key); throw e; }   // RELEASE
```

**"Check then mark" is racy** — two consumers can both pass the check before either marks, and a payment gets credited twice.

**The release is not optional.** Without it, "retry three times" becomes "try once, no-op twice", and the logs of that are identical to three successes.

## Cross-Service Calls

A service may call another service directly. It must **not** call its own API over HTTP — that loses the transaction, doubles the authorization work, and turns an internal call into a network dependency.

Where two services would form a cycle, the shared logic belongs in a third.

## Secrets

Never return `users.password`, `mfaSecret`, `otpCode`, `webauthnPublicKey`, `tenant_keys.privateKey`, tenant storage credentials, or `calibration_devices.iotDeviceToken` — the last one especially in a list.

`defaultScope` excludes them. A query bypassing the scope must exclude them explicitly.

Take particular care with what reaches `audit_logs.changes`: that table is append-only with no delete path, so anything landing there is permanent.

## Notable Services

| Service | Note |
|---|---|
| `calibrationScheduler` | recalculates `nextCalibrationDate` on the calibration write, not by a nightly sweep |
| `certificate` | owns the state machine and the 409 mapping |
| `eSignature` | writes the Part 11 quartet — `meaning`, `authMethod`, `documentHash`, actor |
| `storage/` | pluggable local/s3/nfs; **key construction is a tenant-isolation control** |
| `dataRetention` | legal hold checked **first**, before any age comparison (BR-16) |
| `workflow` | the `db`-versus-`sequelize` defect lived here |
| `migration` | carries the demo seeder, gated on `SEED_DEMO=true` |

## Testing

Services are where the unit-test coverage gate bites. Test:

- the happy path,
- each error branch with its status code,
- transaction rollback leaving no partial state **and no audit row**,
- idempotency: the second call is a no-op,
- **two-tenant isolation**, asserting the wrong tenant gets nothing.

The rollback-and-no-audit-row assertion is the one most often missing, and it is the one that catches an audit write that escaped its transaction.
