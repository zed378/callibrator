# 05 — Multi-Tenancy Security

**Mandatory reading. No exceptions.**

This is the number-one security control in the system. A single missed tenant predicate leaks one hospital's device register, calibration history and staff to another, and that is the failure that ends the product (PR-1).

Implementation: `backend/src/utils/tenantScope.util.js` and `backend/src/middlewares/tenantContext.middleware.js`.

---

## The Mechanism

Isolation is **not** per-query. It is installed once, globally, and applies to every query touching a tenant-scoped model.

```
auth.middleware.js
    sets req.tenantId (honouring the SUPERADMIN x-tenant-id override)
            │
            ▼
tenantContext.middleware.js
    AsyncLocalStorage.run({ tenantId, isSuperAdmin, isSystemTask })
            │
            ▼
global Sequelize hooks  (installed by models/index.js)
    beforeFind / beforeBulkUpdate / beforeBulkDestroy → inject WHERE
    beforeCreate / beforeUpdate                       → stamp tenantId
```

A developer writing a query does not opt in. That is the entire design: a control that requires remembering will eventually not be remembered.

## Deny by Default

```
options.skipTenantScope  → skip   explicit, greppable, auditable opt-out
no CLS context           → skip   pre-auth login/register, public endpoints,
                                  migrations, schedulers
context.isSystemTask     → skip   background work spanning tenants
context.isSuperAdmin     → skip   cross-tenant operator, by design
context.tenantId         → filter by that tenant
otherwise                → DENY
```

The last line is the one that matters. An **authenticated principal with no resolvable tenant sees nothing.**

The previous inline implementation returned early — applying no filter at all — whenever a request had no `tenantId`. An authenticated principal without a tenant therefore saw **every tenant's rows**. That is the same fail-open hole PostgreSQL RLS had via its `app.current_tenant = ''` branch.

### `NO_TENANT_UUID`

```js
const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000";
```

A syntactically valid UUID no real tenant will ever own.

Not a sentinel string like `"__no_tenant__"`, because tenant columns are UUID-typed and a non-UUID literal makes PostgreSQL raise a **type error** — which turns a denial into a 500, and a 500 is something people fix by removing the check.

## Why Not Row Level Security

RLS was implemented (migration `0012`) and removed (migration `0015`, ADR-029). Both migrations are kept, because squashing them would erase the evidence that RLS was tried.

| Reason | Detail |
|---|---|
| **Engine lock-in** | RLS is PostgreSQL-only. The platform must also run on MySQL. An isolation mechanism that exists on one engine is not an isolation mechanism. |
| **Fail-open policy** | `app.current_tenant = ''` matched **every row**. A request arriving without the session variable set saw everything. |
| **Cost** | Two round-trips and a wrapping transaction per authenticated request, to set and reset the GUC. |

The rule to carry forward: **an isolation mechanism whose "no context" branch permits rather than denies is not an isolation mechanism.**

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

`sessions` uses snake_case **attribute** names. Automatic scoping handles both; hand-written queries do not get the same help, and `Session.destroy({ where: { tenantId } })` fails with `column "tenantId" does not exist` — which is exactly what broke the nightly retention purge.

## Where the Hooks Do Not Reach

These are the places a leak can still happen. Each needs its own attention.

| Bypass | Risk | Mitigation |
|---|---|---|
| **Raw SQL** (`sequelize.query`) | hooks do not apply | every raw query must carry the predicate explicitly; grep for new ones in review |
| **Vector similarity search** | `document_chunks` retrieval; a missing predicate returns another tenant's documents and paraphrases them into an answer, with no error | the highest-risk instance in the system — see [`../PLAN/14-ANALYTICS-AND-REPORTING.md`](../PLAN/14-ANALYTICS-AND-REPORTING.md) |
| **`skipTenantScope`** | explicit opt-out | one greppable string; every use needs a comment saying why |
| **`isSystemTask`** | background work spanning tenants | set as narrowly as possible, **never** for the duration of a whole consumer loop |
| **`isSuperAdmin`** | by design | audited; the highest-value credential in the system |
| **Cache keys** | a key missing the tenant id serves one tenant's data to another, and keeps doing so after the bug is fixed until the key expires | **every cache key in tenant-scoped territory includes the tenant id** |
| **Global search** | queries many tables at once; one missed branch is enough | re-read after any change |
| **Kanban child tables** | only `kanban_projects` and `kanban_cards` carry `tenantId` | a query starting from a child table must join to the project |

## Status Codes Leak

**Cross-tenant access returns 404, never 403.**

403 says "this exists and you may not have it", which turns id enumeration into a working tenant-membership oracle. Non-existent, soft-deleted and not-yours must be indistinguishable.

The same applies to error messages, response timing where it is trivially different, and uniqueness violations — see below.

### The `serialNumber` oracle

`calibration_devices.serialNumber` is declared `unique: true` on the column, making it unique **globally**, not per tenant.

A create that fails on uniqueness therefore tells the caller that some **other tenant** holds that serial. It is a weak oracle, and it also blocks a legitimate situation: manufacturer serials are unique per manufacturer, not per world.

The correct constraint is a composite unique on `(tenant_id, serial_number)`. Tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

## Super-Admin

`SUPERADMIN` skips the tenant predicate and short-circuits every permission check. There is no second gate.

| Header | Effect |
|---|---|
| `x-tenant-id` | act inside that tenant |
| `x-tenant-code` | same, by code |

Honoured **only** for `SUPERADMIN`. For anyone else they are **ignored, not rejected** — a probe returns the caller's own data rather than an error confirming the header means something.

The account itself is the highest-value credential in the system. MFA is available but not enforced, which is PR-3.

## Suspension

`tenants.status = 'suspended'` rejects every authenticated request from that tenant (BR-3), enforced in `auth.middleware.js`.

**The trap:** suspending the default tenant suspends the super-admin who lives in it, including the request that would reverse it. Recovery requires a direct database update.

Any script or test that suspends must create a **disposable** tenant first.

## Testing Isolation

The only test that proves anything is a **two-tenant** test.

```
1. create tenant A and tenant B, each with a user
2. as A, create a resource; note its id
3. as B, attempt GET / PUT / DELETE on that id
4. assert 404 — not 403, not 200
5. as B, list the collection; assert A's resource is absent
```

`createTwoTenants()` as a one-line fixture is what decides whether this test gets written for a new endpoint. If it takes twenty lines of setup, it will be skipped.

Additional cases that are easy to miss:

- an authenticated principal with **no** tenant sees zero rows (the deny branch)
- a cache populated by A is not served to B
- a search query returns only A's rows across every entity type
- a batch job started by A produces a result containing only A's data
- a `document_chunks` retrieval for A cites only A's documents

## Review Checklist

Before merging anything that touches data access:

- [ ] no new `sequelize.query` without an explicit tenant predicate
- [ ] no new `skipTenantScope` without a comment explaining why
- [ ] no new `isSystemTask` spanning more than the operation that needs it
- [ ] every new cache key includes the tenant id
- [ ] every new `:id` route has a two-tenant test asserting 404
- [ ] cross-tenant failures return 404, not 403
- [ ] no new uniqueness constraint that spans tenants
