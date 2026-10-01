# 00 — Backend Standards

> **Language status — target: TypeScript, strict (ADR-038).** As-built on 2026-09-29 the backend is **mixed JavaScript and TypeScript, CommonJS**, run from one `dist/` tree (ADR-087). TypeScript: all of `constants/`, `models/` (71 models and the barrel `models/index.ts`, P9-10) and `validators/` (Zod, P9-11), most of `utils/` (including `tenantScope`, `jobContext`, `response` and `sql`), `config/env.ts`, and the middlewares `tenantContext`, `activityLog` and `validation`. **Controllers, services, routes and most middlewares are still JavaScript**; `backend/.ts-ratchet.json` lists every remaining `.js` file (`npm run ratchet -- --list`). The migration is [`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md). Behaviour described here is **as-built** unless marked *target*. New backend code follows [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../../docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md). Remove this banner only when every module this document describes is converted.

**As-built:** `"type": "commonjs"`, entry `index.js`, Node 26 (root `.nvmrc`; `engines` `>=26 <27`; a jest `globalSetup` refuses any other major — ADR-076). Source runs through **tsx** (`npm start` is `node --import tsx index.js`, `npm run dev` is `tsx watch index.js`), because Node's CommonJS resolver cannot `require` an extensionless `.ts` module — **plain `node` on backend source fails with `MODULE_NOT_FOUND`** at the first converted module (ADR-087 decision 4). **Target: strict TypeScript everywhere** (ADR-038, superseding ADR-030).

Three instructions follow from that, and all matter:

- **new** backend files — source **and tests** — are TypeScript, held to `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` from the first line. `npm run ratchet` fails on any `.js` path not already listed in `backend/.ts-ratchet.json` (ADR-087 Amendment 1);
- an **existing** `.js` file keeps its JavaScript shape when edited. Half-converting it — a few types here, an `import` there — produces a file that is neither, and conversion is a separate, behaviour-neutral PR;
- a conversion goes **leaf-first** (a `.ts` file may import only what is already `.ts`: `npm run build:dist` fails a `.ts` → `.js` import with TS7016), and it **never changes behaviour** — a defect the checker exposes is fixed in its own change against an AUDIT id (ADR-038 rules 1 and 3; the identity-check procedure is in `docs/ENGINEERING/04` § Converting a Module).

Architecture: [`../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/03-BACKEND-ARCHITECTURE.md).

---

## Layering

```
route → middleware → validator → controller → service → model
```

| Layer | Owns | Must not |
|---|---|---|
| route | mount path, middleware composition | contain logic |
| validator | Zod schema for body, query, params (`validators/*.validator.ts`, P9-11) | touch the database |
| controller | unwrap the request, call a service, send the envelope | open transactions, query models |
| service | business logic, transactions, orchestration | touch `req` or `res` |
| model | schema, associations, instance methods | contain workflow logic |

Two known violations exist — a few controllers query models directly, a few services accept `req`-shaped objects. Both are wrong and should be fixed when touched, not codified.

## The Model Barrel Exports `sequelize`, Not `db`

```js
const { sequelize } = require("../models");   // ✓
const { db } = require("../models");          // ✗ undefined
```

`models/index.ts` (TypeScript since P9-10, ADR-087 Amendment 11) takes the Sequelize instance from `config/index.js`, defines the 71 models, wires associations, and installs the tenant hooks. It exports **`sequelize`** (the same object as the connection), `Sequelize`, `Op` and every model — **no `db` key**.

A service destructuring `db` gets `undefined` and then throws at `db.sequelize.transaction()`. That broke every workflow create, update and submit-action until it was fixed in three places. A **`.ts`** caller now gets a compile error for it, because the barrel is typed (`ModelsBarrel`, `src/types/models.ts`); a `.js` caller still gets `undefined`.

## The Two Sequelize Traps

These are the most repeated defect shapes in this codebase. Both produce a **silently empty list**, which is worse than an error.

### 1. Optional includes need `required: false`

Sequelize defaults an include with a `where` — or against a model with a `defaultScope` — to an **INNER JOIN**, dropping every parent row whose optional association is null.

Two production defects from this exact cause:

| Where | Symptom |
|---|---|
| `getRisks`, `getRiskById` | risks with no assignee were **completely invisible** — absent from the list, 404 on get, update and delete |
| `GET /certificates` | returned **zero rows** while rows existed — four includes (`device`, `calibratedByUser`, `approvedByUser`, `signedByUser`) were INNER JOINs, and every draft has null `approvedBy` and `signedBy` |

Assume this applies to any include on a nullable FK. `maintenance_work_orders` has two (`vendorId`, `assignedTo`); both of `maintenance.service`'s reads carry `required: false` (and `paranoid: false`), pinned by the generated SQL in `tests/services/maintenance.includes.a190.test.js` — it is **not** latent, as this line used to say (A-190, AUDIT-2026-09-DATA D-12).

### 2. `defaultScope` hides soft-deleted rows

Use `.unscoped()` to see them. And note the naming:

```js
{ isDeleted: true }    // ✓ the Sequelize attribute
{ is_deleted: true }   // ✗ silently does nothing
```

Models are `underscored`: `isDeleted` in code, `is_deleted` in the database.

### 3. `DECIMAL` and `COUNT` come back as strings

`node-postgres` returns `NUMERIC` and `bigint` as strings, and Sequelize passes them through: `a + b`
concatenates and `"90.00" > "1000.00"` is true — quietly (D-21, ADR-064). Every `DECIMAL` attribute declares a
`get()` that returns `Number(...)` (null stays null); `tests/models/decimalGetters.d21.test.js` discovers every
`DECIMAL` attribute and fails on one without it. A getter does not cover `raw: true` reads or aggregates
(`SUM`, `COUNT`): parse those at the call site (`parseInt(row.count, 10)`).

## The `sessions` Exception

`sessions` uses **snake_case attribute names** — `tenant_id`, `user_id`, `token_hash`.

```js
Session.destroy({ where: { tenantId } })    // ✗ column "tenantId" does not exist
Session.destroy({ where: { tenant_id } })   // ✓
```

This broke the nightly data-retention purge. `tenantKeyOf()` in the scoping util checks both spellings, so automatic scoping works — hand-written queries get no such help.

## Validation

**Corrected 2026-09-29 (P9-11, ADR-093):** the validators are **Zod**, and `joi` is gone from `backend/package.json`. The rules below are as-built; the full treatment is [`03-VALIDATION.md`](./03-VALIDATION.md).

```js
const { validate } = require("../../middlewares/validation.middleware");
router.post("/", validate(schema), controller.create);   // ✓ the only middleware form
router.post("/", schema.parse, controller.create);       // ✗ throws on every request
```

`validate(schema)` (`middlewares/validation.middleware.ts`) returns middleware. Passing a schema's own method (`parse`, `safeParse`, `parseAsync`, or the old Joi `validate`) means Express calls it as `(req, res, next)`. In a `.ts` route that is a compile error (TS2769); `.js` routes are held to it by the source guard `tests/guards/schemaAsMiddleware.p911.test.ts`. The same shape once appeared as a controller that spread a schema into a plain object and called `.validate` on the result — `schema.validate is not a function`, on every request.

Outside a route, a controller or service checks input with `validators/input.ts`: `validateInput(data, schema)` returns the parsed value or throws `{ status: 400, message: "Validation failed", errors }`; `checkInput(data, schema)` never throws. No validator module has a helper of its own.

### Path parameters must reach the validator

```js
router.put("/:tenantId/policy", validate(schema, { from: ["params", "body"] }), ctrl.setPolicy);
// in the handler (.ts): const input = validated(req, schema);
```

`validate(schema)` reads **`req.body` only** (an absent body is checked as `{}`, A-09). Declare the sources with `{ from: [...] }`; in a merge **a path parameter always wins** over a body or query key of the same name. The parsed value is on `req.validated`, read typed through `validated(req, schema)`; `req.body` is replaced only when the source is the body. Several endpoints once validated `req.body` for an identifier that only ever arrives in `req.params`, and **400ed every request** — feature flags, tenant lifecycle and data retention. *As-built:* those controllers still merge by hand with `validateInput({ ...req.params, ...req.body }, schema)`, where **the body wins** — AUDIT A-273. (This section used to prescribe `validate(schema)({ ...req.params, ...req.body })`, which is not how the middleware is called.)

### A missing validator surfaces as a 500

A bad enum value reaching the database always produces a 500 rather than a 400, which sends the investigation to the wrong layer. That is the signature of a missing validator, not a database problem.

## Tenant Scoping Is Automatic — Respect It

Global Sequelize hooks inject the tenant predicate. You do not opt in.

Four sanctioned bypasses, all greppable:

| Bypass | Rule |
|---|---|
| `options.skipTenantScope` | needs a comment saying why. Typed for `.ts` callers by the `FindOptions` augmentation in `src/types/sequelize.d.ts` (ADR-087 Amendment 9) — the type only admits the key; it enforces nothing |
| `isSystemTask` | set only through `utils/jobContext.util` (`runForTenant`, `runAsSystem` with a listed reason); guard `jobContext.w12` fails any other source that sets it. Scope as narrowly as possible, **never** a whole consumer loop |
| `isSuperAdmin` | by design |
| no CLS context | pre-auth, public, migrations, schedulers |

**Raw SQL bypasses the hooks entirely.** In TypeScript it goes through **`sql()`** (`utils/sql.util.ts`, P9-07, ADR-087 Amendment 12): bind parameters only, the tenant predicate **bound** (`tenant_id = $n`), never interpolated:

```ts
const rows = await sql<{ id: string }>(sequelize, "SELECT id FROM stocks WHERE tenant_id = $1 AND warehouse_id = $2", [tenantId, warehouseId], { transaction });
```

A direct `sequelize.query` / `db.query` in a `.ts` file outside the helper, migrations and tests is a lint error. `rawSqlTenantPredicate.d05` fails a `sql()` statement that names a tenant-scoped table without a bound predicate. The remaining JavaScript call sites (19 `query(` calls in 11 files, ADR-087 Amendment 12) move to the helper as their modules convert; until then every `sequelize.query` carries the predicate explicitly, and every new one is a review item.

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

A new route with no permission gate works for everyone with a token — the single most likely authorization defect in the codebase. **Corrected 2026-09-29:** since ADR-058 (P6-04) a guard fails it. `tests/routes/routePermissionGuard.p604.test.js` walks the real Express stacks of every route module (`.js` and `.ts`, ADR-087 Amendment 4) and fails a route that carries no gate (`dynamicAccess`, `rbac`, `checkRoleLevel`, `abac`, `superAdminOnly`) and no reviewed entry in `constants/routeGateExemptions.ts`, as well as a stale or contradicted exemption. It runs in the unit suite, so it gates `npm test`, CI and `make verify` — but only when they run. (This section used to say no build guard existed.)

Every route with a `:param` path is held the same way by `tests/guards/twoTenantRoutes.guard.test.ts`: it must carry an `@two-tenant` test marker or a reviewed `NOT_TENANT_ADDRESSED` entry (below, § Before a PR).

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

ESLint is the gate; Prettier is not (ADR-092). The backend ESLint error baseline is **0** (`backend/.eslint-baseline.json`), so any new error fails `node scripts/ci/eslint-ratchet.js`, CI and the pre-push hook. `backend/.prettierrc` governs `backend/`, but `npm run prettier` is not clean over the tree and `npm run prettier:fix` is not assumed lint-clean — run `npx eslint <file>` on what you change. Commands, configuration and the ratchets: [`../ENGINEERING/10-TOOLING-LINT-FORMAT.md`](../ENGINEERING/10-TOOLING-LINT-FORMAT.md).

JSDoc on the exports of unconverted `.js` files — until conversion, it is the only type information they have. Converted files declare types in TypeScript instead, and explicit return types on exports are mandatory (`explicit-module-boundary-types`).

**Configuration** is read through `src/config/`: a `.ts` file reads a variable with `env(name)` / `envOr(name, fallback)` / `isProduction()` from `config/env.ts` (P9-06 part 1, ADR-087 Amendment 6); `process.env` outside `src/config/` is a lint error in `.ts`. `envOr` keeps `||` on purpose: an empty variable means "use the default" here. *Target (P9-06 part 2):* one Zod schema over every variable, and a boot that refuses listing every problem.

**Logging** goes through `activityLog.middleware`'s `logger`. No `console.*` outside the six terminal CLIs in `src/scripts/` — guard `tests/guards/noConsole.a42.test.js` (ADR-076).

## Before a PR

- [ ] `node scripts/ci/eslint-ratchet.js` (from the repository root) — 0 errors; `npm run typecheck`; `npm run ratchet`
- [ ] `npm run test:coverage` at the 100% gate (ADR-085 scope), suite count named
- [ ] `npm run test:e2e` against a running server
- [ ] every new route has a permission gate (`routePermissionGuard.p604` passes)
- [ ] every new `:id` route has a **two-tenant test asserting 404** with an `@two-tenant` marker (`twoTenantRoutes.guard` passes; fixtures in [`../ENGINEERING/09-TESTING-CONVENTIONS.md`](../ENGINEERING/09-TESTING-CONVENTIONS.md))
- [ ] every new mutation writes an audit row, in the transaction (`auditInTransaction.p611`)
- [ ] no new raw SQL outside `sql()` in a `.ts` file, and a bound tenant predicate in every statement on a tenant-scoped table
- [ ] no `console.*` (`noConsole.a42`)
