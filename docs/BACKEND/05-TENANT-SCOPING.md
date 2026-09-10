# 05 — Tenant Scoping

The implementation of the number-one security control. Security treatment: [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) — mandatory reading.

Code: `backend/src/utils/tenantScope.util.js`, `backend/src/middlewares/tenantContext.middleware.js`, installed by `backend/src/models/index.js`.

---

## How It Works

```
auth.middleware.js
    → req.tenantId  (honouring the SUPERADMIN x-tenant-id override)
          │
tenantContext.middleware.js
    → AsyncLocalStorage.run({ tenantId, isSuperAdmin, isSystemTask })
          │
global Sequelize hooks   (installed once, by models/index.js)
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

```js
const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000";
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
| **Engine lock-in** | RLS is PostgreSQL-only; the platform must also run on MySQL. An isolation mechanism existing on one engine is not an isolation mechanism. |
| **Fail-open policy** | `app.current_tenant = ''` matched every row |
| **Cost** | two round-trips and a wrapping transaction per authenticated request |

The rule to carry forward: **an isolation mechanism whose "no context" branch permits rather than denies is not an isolation mechanism.**

## Where the Hooks Do Not Reach

Each of these needs its own attention. They are where a leak can still happen.

| Bypass | Rule |
|---|---|
| **Raw SQL** (`sequelize.query`) | carry the predicate explicitly; every new one is a review item |
| **Vector similarity search** | `document_chunks` — the highest-risk instance; similarity search does not scope itself |
| **Cache keys** | **every key includes the tenant id**; a key missing it keeps leaking after the bug is fixed, until it expires |
| **Global search** | unions many tables; one missed branch is enough |
| **Kanban child tables** | only `kanban_projects` and `kanban_cards` carry `tenantId`; queries from a child table must join to the project |
| `skipTenantScope` | one greppable string; each use needs a comment |
| `isSystemTask` | scope narrowly — **never** a whole consumer loop |

The `isSystemTask` one is worth restating: a worker that sets it for the duration of its loop turns every query in that loop into a cross-tenant query, with no error to signal it.

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

Also assert:

- an authenticated principal with **no** tenant sees zero rows — the deny branch
- a cache populated by A is not served to B
- search returns only A's rows across every entity type
- a `document_chunks` retrieval for A cites only A's documents

## Review Checklist

- [ ] no new `sequelize.query` without an explicit tenant predicate
- [ ] no new `skipTenantScope` without a comment
- [ ] no new `isSystemTask` spanning more than the operation needing it
- [ ] every new cache key includes the tenant id
- [ ] every new `:id` route has a two-tenant test asserting **404**
- [ ] no new uniqueness constraint spanning tenants
- [ ] any new model carries `tenantId`, or has a recorded reason not to
