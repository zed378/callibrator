# 00 — Backend Standards

**The backend is JavaScript (CommonJS), not TypeScript** (ADR-030).

`"type": "commonjs"`, entry `index.js`, Node 24. Anyone acting on an instruction to "remove the `any` types" or "enable strict mode" here is working from a stale premise — there are no types to remove.

Architecture: [`../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md).

---

## Layering

```
route → middleware → validator → controller → service → model
```

| Layer | Owns | Must not |
|---|---|---|
| route | mount path, middleware composition | contain logic |
| validator | Joi schema for body, query, params | touch the database |
| controller | unwrap the request, call a service, send the envelope | open transactions, query models |
| service | business logic, transactions, orchestration | touch `req` or `res` |
| model | schema, associations, instance methods | contain workflow logic |

Two known violations exist — a few controllers query models directly, a few services accept `req`-shaped objects. Both are wrong and should be fixed when touched, not codified.

## The Model Barrel Exports `sequelize`, Not `db`

```js
const { sequelize } = require("../models");   // ✓
const { db } = require("../models");          // ✗ undefined
```

`models/index.js` constructs Sequelize, loads all 72 models, wires associations, and installs the tenant hooks. It exports **`sequelize`**.

A service destructuring `db` gets `undefined` and then throws at `db.sequelize.transaction()`. That broke every workflow create, update and submit-action until it was fixed in three places.

## The Two Sequelize Traps

These are the most repeated defect shapes in this codebase. Both produce a **silently empty list**, which is worse than an error.

### 1. Optional includes need `required: false`

Sequelize defaults an include with a `where` — or against a model with a `defaultScope` — to an **INNER JOIN**, dropping every parent row whose optional association is null.

Two production defects from this exact cause:

| Where | Symptom |
|---|---|
| `getRisks`, `getRiskById` | risks with no assignee were **completely invisible** — absent from the list, 404 on get, update and delete |
| `GET /certificates` | returned **zero rows** while rows existed — four includes (`device`, `calibratedByUser`, `approvedByUser`, `signedByUser`) were INNER JOINs, and every draft has null `approvedBy` and `signedBy` |

Assume this applies to any include on a nullable FK. `maintenance_work_orders` has two (`vendorId`, `assignedTo`) and is latent.

### 2. `defaultScope` hides soft-deleted rows

Use `.unscoped()` to see them. And note the naming:

```js
{ isDeleted: true }    // ✓ the Sequelize attribute
{ is_deleted: true }   // ✗ silently does nothing
```

Models are `underscored`: `isDeleted` in code, `is_deleted` in the database.

## The `sessions` Exception

`sessions` uses **snake_case attribute names** — `tenant_id`, `user_id`, `token_hash`.

```js
Session.destroy({ where: { tenantId } })    // ✗ column "tenantId" does not exist
Session.destroy({ where: { tenant_id } })   // ✓
```

This broke the nightly data-retention purge. `tenantKeyOf()` in the scoping util checks both spellings, so automatic scoping works — hand-written queries get no such help.

## Validation

```js
router.post("/", validate(schema), controller.create);   // ✓
router.post("/", schema.validate, controller.create);    // ✗ 500s every request
```

`validate(schema)` returns middleware. Passing `schema.validate` directly means Express calls it as `(req, res, next)` while Joi expects a value.

The same shape appeared as a defect where a controller spread a Joi schema into a plain object and then called `.validate` on the result — `schema.validate is not a function`, on every request.

### Path parameters must reach the validator

```js
validate(schema)({ ...req.params, ...req.body })
```

Several endpoints validated `req.body` for an identifier that only ever arrives in `req.params`, and **400ed every request**. This recurred across feature flags, tenant lifecycle and data retention — it is not a one-off.

### A missing validator surfaces as a 500

A bad enum value reaching the database always produces a 500 rather than a 400, which sends the investigation to the wrong layer. That is the signature of a missing validator, not a database problem.

## Tenant Scoping Is Automatic — Respect It

Global Sequelize hooks inject the tenant predicate. You do not opt in.

Four sanctioned bypasses, all greppable:

| Bypass | Rule |
|---|---|
| `options.skipTenantScope` | needs a comment saying why |
| `isSystemTask` | scope as narrowly as possible, **never** a whole consumer loop |
| `isSuperAdmin` | by design |
| no CLS context | pre-auth, public, migrations, schedulers |

**Raw SQL bypasses the hooks entirely.** Every `sequelize.query` carries the tenant predicate explicitly, and every new one is a review item.

Full treatment: [`05-TENANT-SCOPING.md`](./05-TENANT-SCOPING.md) and [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md).

## Response Envelope

```js
const { success, error, paginated } = require("../utils/response.util");
```

```json
{ "success": true, "status": 200, "message": "...", "data": [], "meta": { } }
```

**Rows in `data`. Pagination in a top-level `meta`, a sibling of `data`.** Never `data.rows`, never `data.items`, never `data.meta`.

`GET /qms/nc`, `/qms/capa` and `/sop` violated this and three frontend screens rendered empty for weeks with no error anywhere.

## Errors

```js
throw new AppError(409, "Certificate is in draft and must be submitted first");
```

| Status | Meaning |
|---|---|
| 400 | validation |
| 401 | unauthenticated |
| 403 | permission failure **inside your own tenant** |
| 404 | not found — **including belonging to another tenant** |
| **409** | invalid state transition |
| 429 | rate limited |

Cross-tenant returns 404, never 403. A 403 confirms the resource exists, turning id enumeration into a tenant-membership oracle.

**The central mapper forwards recognised error types only.** A raw `pg` message carries SQL; a raw Node message carries a file path. No care at the call site fixes an over-permissive mapper.

## Transactions

Opened in the **service**, never in a controller:

```js
await sequelize.transaction(async (t) => { /* … */ });
```

Audit rows are written **inside** the transaction of the action they describe. An audit row surviving a rolled-back action records something that did not happen.

## Every Route Needs a Gate

```js
router.post("/", auth, dynamicAccess("equipment", "write"), validate(schema), ctrl.create);
```

**Nothing prevents omission.** A new route with no permission gate works for everyone with a token, and there is no build guard that fails it.

This is the single most likely authorization defect in the codebase. The guard is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Idempotency in Workers

```js
const claimed = await redis.set(key, "1", "NX", "EX", ttl);
if (!claimed) return;
try { await doWork(); }
catch (e) { await redis.del(key); throw e; }   // RELEASE, or the retry no-ops
```

"Check then mark" is racy — two consumers can both pass the check before either marks. And a failed attempt that does not release its claim turns "retry three times" into "try once, no-op twice", with logs identical to three successes.

## Secrets Never Leave

```
users.password  ·  users.mfaSecret  ·  users.otpCode  ·  users.webauthnPublicKey
tenant_keys.privateKey  ·  tenant storage credentials
calibration_devices.iotDeviceToken   ← especially in a LIST response
```

Excluded by `defaultScope`. A query bypassing the scope must exclude them explicitly, and it should be asserted in tests rather than intended — the field is absent from the screen the developer is looking at.

`audit_logs.changes` is the highest-consequence leak: the table is append-only with no delete path, so anything landing there is permanent.

## Style

ESLint plus Prettier. `npm run lint`, `npm run lint:fix`, `npm run prettier:fix`.

JSDoc on exported functions — it is the only type information this codebase has.

## Before a PR

- [ ] `npm run lint`
- [ ] `npm test` at the coverage gate
- [ ] `npm run test:e2e` against a running server
- [ ] every new route has a permission gate
- [ ] every new `:id` route has a **two-tenant test asserting 404**
- [ ] every new mutation writes an audit row, in the transaction
- [ ] no new `sequelize.query` without an explicit tenant predicate
- [ ] no `console.log` left behind
