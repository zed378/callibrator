# 05 — Tenant Scoping

> **Language status (as-built 2026-10-02).** The backend's source is **TypeScript, strict** (ADR-038; the toolchain is ADR-087), compiled to CommonJS and run from one `dist/` tree. The only source `.js` file left is the dead `utils/checkMenu.util.js`, awaiting deletion (A-18); `noSourceJs.p924.guard` fails on any other. The **694 `.js` files in the test trees are legacy JavaScript** (682 test files and 12 fixtures and helpers, `src/tests/` and `__tests__/`, counted 2026-10-02), converted opportunistically under P9-26; **all new code, tests included, is TypeScript** (`npm run ratchet` refuses a new `.js` file). The rules are [`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`](../ENGINEERING/04-TYPESCRIPT-STANDARDS.md). Behaviour described here is **as-built** unless marked *target*.

The implementation of the number-one security control. Security treatment: [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) — mandatory reading.

Code: `backend/src/utils/tenantScope.util.ts`, `backend/src/middlewares/tenantContext.middleware.ts`, installed by `backend/src/models/index.ts` — all three TypeScript since 2026-09-28/29 (ADR-087 Amendments 2, 4 and 11), each converted under the four isolation gates (guards bite, identity, isolation suites, live PostgreSQL 18 as `callibrator_app`). The snippets below are simplified from that code; the TypeScript is the reference.

---

## How It Works

```
auth.middleware.ts
    → req.tenantId  (honouring the SUPERADMIN x-tenant-id override)
          │
tenantContext.middleware.ts
    → AsyncLocalStorage.run({ tenantId, isSuperAdmin, isSystemTask })
          │
global Sequelize hooks   (installed once, by models/index.ts)
    beforeFind / beforeBulkUpdate / beforeBulkDestroy → inject WHERE
    beforeCreate / beforeUpdate                       → stamp tenantId
```

**A developer writing a query does not opt in.** That is the whole design: a control requiring someone to remember will eventually not be remembered.

## Resolution

```js
const resolveScope = (options) => {
  if (options && options.skipTenantScope) return { mode: "skip" };

  const ctx = tenantStorage.getStore();
  if (!ctx) return { mode: "skip" };
  if (ctx.isSystemTask) return { mode: "skip" };
  if (ctx.isSuperAdmin) return { mode: "skip" };
  if (ctx.tenantId) return { mode: "filter", tenantId: ctx.tenantId };

  return { mode: "deny" };
};
```

| Condition | Result | Covers |
|---|---|---|
| `skipTenantScope` | skip | explicit, greppable opt-out |
| no CLS context | skip | pre-auth login/register, public endpoints, migrations, schedulers |
| `isSystemTask` | skip | background work spanning tenants |
| `isSuperAdmin` | skip | cross-tenant operator |
| `tenantId` present | filter | the normal case |
| otherwise | **deny** | authenticated, no tenant ⇒ sees nothing |

## The Deny Branch Is the Point

```ts
// src/types/ids.ts — a constant, never input; the one file where a brand assertion is allowed
export const NO_TENANT_ID = "00000000-0000-0000-0000-000000000000" as TenantId;
// utils/tenantScope.util.ts
const NO_TENANT_UUID: TenantId = NO_TENANT_ID;
```

An **authenticated principal with no resolvable tenant sees nothing**, not everything.

The previous inline implementation returned early — applying no filter — whenever a request had no `tenantId`. An authenticated principal without a tenant therefore saw **every tenant's rows**. That is the same fail-open hole PostgreSQL RLS had via its `app.current_tenant = ''` branch, which matched every row.

### Why a UUID and not a sentinel string

Tenant columns are UUID-typed. A literal like `"__no_tenant__"` makes PostgreSQL raise a **type error**, turning a denial into a 500 — and a 500 is something people fix by removing the check.

A valid UUID no tenant will ever own returns zero rows cleanly.

## Both Column Spellings

```js
const tenantKeyOf = (model) => {
  const attrs = model && model.rawAttributes;
  if (!attrs) return null;
  if (attrs.tenantId) return "tenantId";
  if (attrs.tenant_id) return "tenant_id";
  return null;
};
```

`sessions` uses **snake_case attribute names**. Automatic scoping handles it; hand-written queries do not:

```js
Session.destroy({ where: { tenantId } })    // ✗ column "tenantId" does not exist
```

That broke the nightly retention purge.

A model with **neither** attribute is not tenant-scoped and passes through untouched — which is correct for `roles`, `menu_groups`, `categories` and `posts`, and would be a silent hole for anything else.

## Writes Are Stamped, Not Trusted

`applyTenantAssignment` stamps `tenantId` on create and update from the context.

**`tenantId` is never read from the request body.** A body-supplied tenant id is an obvious cross-tenant write, and the way to make it impossible is to never read it. Validators forbid it ([`03-VALIDATION.md`](./03-VALIDATION.md)).

## Why Not Row Level Security

RLS was implemented (migration `0012`) and removed (migration `0015`, ADR-029). Both migrations are kept — squashing them would erase the evidence that RLS was tried.

| Reason | |
|---|---|
| **Engine lock-in** | RLS is PostgreSQL-only, and the platform then had to run on MySQL. *(Dropped by ADR-039 — PostgreSQL is now the only engine, so this reason no longer applies; the two below still do.)* |
| **Fail-open policy** | `app.current_tenant = ''` matched every row |
| **Cost** | two round-trips and a wrapping transaction per authenticated request |

The rule to carry forward: **an isolation mechanism whose "no context" branch permits rather than denies is not an isolation mechanism.**

> **Target — decided by the owner 2026-10-08 (Q-C1, ADR-136; built in Phase 34):** RLS returns as a **second layer** beneath the ORM hooks, **fail-closed** (no tenant setting ⇒ no rows), staged — the evidence-chain tables first, before a second engine writes to them — with its cost measured first; reads run inside transactions (`SET LOCAL` is lost outside one), and the super-admin `skipTenantScope` path gets an explicit, reviewed bypass. The ORM hooks stay the first layer. Nothing here is built.

## Where the Hooks Do Not Reach

Each of these needs its own attention. They are where a leak can still happen.

| Bypass | Rule |
|---|---|
| **Raw SQL** | in TypeScript, only through `sql()` with the tenant predicate **bound** (below); in the remaining JavaScript, carry the predicate explicitly. Every new statement is a review item |
| **Vector similarity search** | `document_chunks` — the highest-risk instance; similarity search does not scope itself |
| **Cache keys** | **every key includes the tenant id**; a key missing it keeps leaking after the bug is fixed, until it expires |
| **Global search** | unions many tables; one missed branch is enough |
| **Kanban child tables** | only `kanban_projects` and `kanban_cards` carry `tenantId`; queries from a child table must join to the project |
| `skipTenantScope` | one greppable string; each use needs a comment. In `.ts` it type-checks only on `FindOptions` (below) |
| `isSystemTask` | set only by `utils/jobContext.util` (`runForTenant`, `runAsSystem` with a reason from its closed list); scope narrowly — **never** a whole consumer loop. Guard: `jobContext.w12` fails any other source file that sets it |

The `isSystemTask` one is worth restating: a worker that sets it for the duration of its loop turns every query in that loop into a cross-tenant query, with no error to signal it.

### Raw SQL: `sql()` with a bound tenant predicate

**As-built since 2026-09-29 (P9-07, ADR-087 Amendment 12).** `utils/sql.util.ts` is the one way TypeScript code runs raw SQL:

```ts
import { sql } from "../utils/sql.util";

const rows = await sql<{ id: string; total: number }>(
  sequelize,                                                   // the runner: passed in, never imported by the helper
  "SELECT id, total FROM invoices WHERE tenant_id = $1 AND status = $2",
  [tenantId, "paid"],                                           // bind only — BindValue[]
  { transaction },                                              // optional
);
```

- **The tenant predicate is a bound parameter** (`tenant_id = $n`, or `"tenantId" = $n`), never `'${tenantId}'` in the text. `tests/utils/rawSqlTenantPredicate.d05.test.js` reads every `sql(...)` call and fails a statement that names a tenant-scoped table without a **bound** predicate; merely mentioning `tenant_id` is not enough for helper calls. `tests/utils/sql.p907.test.ts` asserts the tenant id is in `bind` and absent from the text.
- **`replacements` cannot be passed** — not by type, and a JavaScript caller gets a `TypeError` at run time — and a statement naming `$n` beyond the bound values is refused before the database. That is the ADR-039 shape (`$1` sent as a replacement read every tenant's metered usage as zero).
- **`Row` is the caller's claim**; the driver checks nothing. `sql<any>` is a lint error.
- **Lint:** in `.ts` application source, a `.query(...)` on `sequelize` / `db` / `database` / `x.sequelize` is a `no-restricted-syntax` error ("Run raw SQL through utils/sql.util#sql"). Exempt: `sql.util.ts`, `.ts` tests, and `src/migrations/**/*.ts` (DDL through the QueryInterface, outside any tenant). One reasoned `eslint-disable-next-line` exists: `dbReady.util.ts`'s `SELECT 1` connectivity probe.
- **JavaScript is not covered by the lint rule.** ADR-087 Amendment 12 counted 19 direct `query(` calls in 11 `.js` files outside tests and migrations; they move to `sql()` as their modules convert (the Stage C Definition of Done), and D-05's older presence check applies to them until then.

### `skipTenantScope` in TypeScript

`src/types/sequelize.d.ts` augments Sequelize's `FindOptions` with `skipTenantScope?: boolean` (ADR-087 Amendment 9), so a `.ts` finder may pass it. The augmentation **only admits the key**: it makes nothing stricter, and nothing about tenant isolation is enforced by a type — that stays in the hooks, at run time. The comment rule above applies unchanged.

## Cross-Tenant Returns 404

Not 403. A 403 says "this exists and you may not have it", turning id enumeration into a tenant-membership oracle.

Non-existent, soft-deleted and not-yours must be indistinguishable.

### The one existing oracle

`calibration_devices.serialNumber` is `unique: true` on the column — **globally unique across all tenants**. A create failing on uniqueness therefore reveals that some other tenant holds that serial.

The correct constraint is a composite unique on `(tenant_id, serial_number)`, ideally partial on `is_deleted = false`. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Testing

Only a **two-tenant** test proves anything.

```
1. create tenant A and tenant B, each with a user
2. as A, create a resource; note the id
3. as B: GET / PUT / DELETE that id → assert 404, not 403, not 200
4. as B: list the collection → assert A's resource is absent
```

`createTwoTenants()` as a **one-line fixture** is what decides whether this test gets written for a new endpoint. Twenty lines of setup means it gets skipped.

**What the fixture is (ADR-088).** `backend/src/tests/fixtures/twoTenants.js` (A-63) is **synchronous and has no database**: `const fx = createTwoTenants()` returns `fx.tenantA`, `fx.tenantB`, `fx.principal(tenant, role)` (a `req.user`), `fx.superAdmin`, `Tenants`/`Users` model doubles and a rollback-able `fx.transaction()`. It drives the real route → middleware → controller → service chain with `jest.mock("../../models")`; it does not create rows, run hooks or execute SQL. Steps 1–2 above are therefore a model double holding tenant B's row, not an HTTP create. Test the hooks and SQL themselves against PostgreSQL. Worked examples: `tenant.edit.a63.test.js`, `readGates.p604.test.js`.

**For a new `:id` route, use `twoTenantSuite` over `memoryDb` instead** (`backend/src/tests/fixtures/`, TypeScript): `memoryDb` loads the **real** models barrel and the **real** tenant hooks over an in-memory store, so a cross-tenant 404 is produced by the hooks, not by a double. The rules, the `@two-tenant` marker and the guard that requires it are in [`../ENGINEERING/09-TESTING-CONVENTIONS.md`](../ENGINEERING/09-TESTING-CONVENTIONS.md) § 3.

Also assert:

- an authenticated principal with **no** tenant sees zero rows — the deny branch
- a cache populated by A is not served to B
- search returns only A's rows across every entity type
- a `document_chunks` retrieval for A cites only A's documents

## Review Checklist

- [ ] no new raw SQL in a `.ts` file outside `sql()`; every statement on a tenant-scoped table binds its tenant predicate (`tenant_id = $n`); no new `sequelize.query` in `.js` without an explicit tenant predicate
- [ ] no new `skipTenantScope` without a comment
- [ ] no new `isSystemTask` spanning more than the operation needing it
- [ ] every new cache key includes the tenant id
- [ ] every new `:id` route has a two-tenant test asserting **404**
- [ ] no new uniqueness constraint spanning tenants
- [ ] any new model carries `tenantId`, or has a recorded reason not to
