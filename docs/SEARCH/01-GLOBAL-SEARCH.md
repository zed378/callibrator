# 01 — Global Search

One endpoint that searches three entity types at once, and the two things that make it interesting: it is the largest concentration of raw SQL in the codebase, and it is the only endpoint whose authorization is performed by **running other routes' permission gates**.

> **Target standard: TypeScript, strict (ADR-038).** The backend search module is **JavaScript/CommonJS as built** — `search.service.js`, `search.controller.js` and `search.route.js` are `.js` files today. The frontend client is already TypeScript. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

**Sources.** `backend/src/services/search.service.js`, `backend/src/controllers/search.controller.js`, `backend/src/routes/api/search.route.js` (all three rewritten 2026-09-23 under A-04), `backend/src/migrations/0003-add-search-vectors.js`, `frontend/src/api/services/search.service.ts`, `frontend/src/components/layouts/GlobalSearch.tsx`.

---

## The Endpoint

```
GET /api/v1/search?q=<term>&types=device,stock,certificate&limit=10
```

Mounted in `backend/src/routes/api/search.route.js:43-48`:

```js
router.get("/", auth, dynamicAccess(SEARCH_MENUS, "read"), searchController.search);
```

Three parameters, all from the query string:

| Parameter | Required | Handling |
|---|---|---|
| `q` | yes in practice | trimmed; an empty term short-circuits to `{ query: "", total: 0, results: [], byType: {} }` without a single query (`search.service.js:86-89`) |
| `types` | no | comma-separated; parsed in `search.controller.js:42-47`. **Absent** means every type. An **explicit** list is honoured as given, including an empty one |
| `limit` | no | clamped to `1…50`, default `10` (`search.service.js:90`). It is a limit **per type**, not per response |

## What Is Searchable

Three types, defined in one table at `search.service.js:19-41`:

| Type | Table | Columns searched | Fields returned | Soft-delete condition | Menu slug |
|---|---|---|---|---|---|
| `device` | `calibration_devices` | `name`, `serial_number`, `manufacturer`, `model`, `category` | `id, name, serialNumber, manufacturer, model, category` | `is_deleted = false` | `calibration` |
| `stock` | `stocks` | `item_name`, `sku`, `serial_number`, `description` | `id, itemName, sku, serialNumber, quantity` | `is_deleted = false` | `warehouse` |
| `certificate` | `certificates` | `certificate_number`, `standard`, `summary` | `id, certificateNumber, status, standard, deviceId` | `deleted_at IS NULL` | `certificate` |

The two soft-delete spellings are not a mistake: `certificates` uses Sequelize `paranoid` deletion (`deleted_at`), the other two use the `isDeleted` boolean. Raw SQL has to know which.

Three types, and only three. **Adding a fourth is a change to `TYPES` plus a migration** — everything else, including the route gate and the permission filter, is derived from that object (`search.service.js:113-125`).

## Authorization

This is the part worth reading carefully, because it was wrong until 2026-09-23 (A-04) and the fix is unusual.

### The route gate: read on *any* searchable menu

`SEARCH_MENUS` is `Object.values(TYPES).map(cfg => cfg.menu)` — `["calibration", "warehouse", "certificate"]` (`search.service.js:125`). Passing the array to `dynamicAccess` gives **OR** semantics: a caller holding `read` on one of the three gets in; a caller holding none is refused with **403**.

The gate has a second effect that is easy to miss. Because `dynamicAccess` runs at all, an **API-key** principal is authorized by its scopes here, rather than being blocked by the deny-by-default check in `controllerWrapper.util` (A-03). A route with `auth` alone would refuse every API key.

### The per-type filter: run the same gate the type's own list route runs

Before A-04, `search.route.js` was `router.get("/", auth, searchController.search)` and the service returned devices, stock and certificates for the whole tenant with no permission filter. A role with no `warehouse` or `certificate` read permission could list stock and certificates through search. Tenant isolation held; authorization inside the tenant did not.

The fix does **not** add a second copy of the permission rules. `search.controller.js:19-25` invokes the real middleware against a probe response object:

```js
const canRead = (req, menuSlug) =>
  new Promise((resolve) => {
    const probe = { status: () => ({ json: () => resolve(false) }) };
    dynamicAccess(menuSlug, "read")(req, probe, () => resolve(true));
  });
```

`dynamicAccess` answers either by calling `next()` — allowed — or by writing a 401/403/500 — denied. The probe captures which. `permittedTypes` (`search.controller.js:27-38`) does that once per candidate type and returns the allowed list.

The point of the shape: `TYPES[t].menu` is **the same slug the type's own list route gates on** —
`calibrationDevices.route.js:67` → `dynamicAccess("calibration", "read")`,
`stock.route.js:73` → `"warehouse"`,
`certificates.route.js:86` → `"certificate"`.
Role matrix, per-user overrides, super-admin bypass and API-key scopes therefore behave here exactly as they do on `/calibration-devices`, `/stock` and `/certificates`. Search can never surface a row that resource's own endpoint would refuse, and the two cannot drift, because there is only one implementation.

**A denied type is dropped, never turned into a 403.** A caller entitled to one type still gets that type's rows. A caller entitled to none never reaches the controller — the route gate refuses first.

### The empty-list footgun that was closed with it

`search.service.js:95-97`:

```js
const requested = Array.isArray(types)
  ? types.filter((t) => TYPES[t])
  : Object.keys(TYPES);
```

`types: []` used to mean **every type**. With a permission-filtered list now passed in, that would have handed a principal permitted nothing the entire tenant. An explicit list — including an empty one — is honoured as given; only an **absent** list means "all".

### Behaviour change to know about

A principal with none of the three menus (a plain `USER`) now gets **403** where it previously got a list. `frontend/src/components/layouts/GlobalSearch.tsx` renders that as an error rather than "no results". The frontend was not changed.

## Tenant Isolation

**The raw SQL carries `tenant_id` explicitly, in both statements.** Raw SQL bypasses the global Sequelize hooks entirely (see [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § Where The Hooks Do Not Reach), so the predicate is written into the query text:

```sql
-- search.service.js:45-49
SELECT <fields>, ts_rank("search_vector", plainto_tsquery('english', :q)) AS rank
  FROM "<table>"
 WHERE tenant_id = :tenantId AND <softDelete>
   AND "search_vector" @@ plainto_tsquery('english', :q)
 ORDER BY rank DESC LIMIT :limit
```

```sql
-- search.service.js:58-62  (fallback)
SELECT <fields>, 0 AS rank
  FROM "<table>"
 WHERE tenant_id = :tenantId AND <softDelete> AND (<col> ILIKE :like OR …)
 LIMIT :limit
```

The tenant id comes from `req.user.tenantId` (`search.controller.js:49`), never from a query parameter or a body. Every user-supplied value — the term, the like pattern, the limit — is a Sequelize `replacements` binding. The only interpolated strings are the table name, the column list and the soft-delete clause, and all three come from the `TYPES` constant, not from the request.

`db` is destructured from `../config` (`search.service.js:8`), which is the Sequelize instance. Destructuring `db` from the **models** barrel gives `undefined` — that is a listed trap in `CLAUDE.md`, and this file does not step in it.

Search is called out in `SECURITY/05` as a bypass that needs re-reading after any change, because it queries many tables at once and one missed branch is enough. Treat an edit to `TYPES` as a tenant-isolation change.

## Full-Text Search, And The Fallback

`backend/src/migrations/0003-add-search-vectors.js` adds, to each of the three tables:

- a `search_vector tsvector` column, `GENERATED ALWAYS AS (to_tsvector('english', coalesce(col,'') || ' ' || …)) STORED` — a generated STORED column maintains itself on insert and update with no triggers, and requires PostgreSQL 12+;
- a GIN index `idx_<table>_search` on it.

Both statements are `IF NOT EXISTS`, and `down` drops both, so the migration is idempotent and reversible.

`searchType` (`search.service.js:69-83`) tries FTS first and falls back to ILIKE on **any** error:

```js
try {
  return await ftsSearch(cfg, tenantId, q, limit);
} catch (err) {
  logger.warn(`FTS unavailable for ${cfg.table} (${err.message}); using ILIKE`);
  try { return await ilikeSearch(cfg, tenantId, q, limit); }
  catch (err2) { logger.error(`Search failed for ${cfg.table}: ${err2.message}`); return []; }
}
```

Two consequences to be aware of:

- The fallback exists for a database without migration 0003 — notably a test database built from `db.sync()`. In production, hitting it means the migration did not apply, and [the migration log is not evidence](../../CLAUDE.md): check for the column in `psql`.
- The `catch` is broad. A statement that fails for a reason **other** than a missing FTS column is retried as an ILIKE and, failing again, returns `[]` — an empty result set rather than an error. A search that silently returns nothing is one of the shapes this codebase has been bitten by before.

## The Response

`search.controller.js:58` calls `success(res, data, null, "Search results", 200)`, so the envelope is the standard one with `meta: null`:

```json
{ "success": true, "status": 200, "message": "Search results",
  "data": { "query": "...", "total": 12, "results": [ … ], "byType": { "device": [ … ] } },
  "meta": null }
```

`data` is an **object**, not an array. Note that `total` lives inside `data` rather than in `meta` — it is a result count, not pagination, and there is no pagination on this endpoint. `results` is every type's rows merged and sorted by `rank` descending (`search.service.js:108`); `byType` is the same rows grouped, each tagged with its `type` (`search.service.js:103`).

Because `limit` is per type, `total` can be up to `3 × limit`. ILIKE-fallback rows all carry `rank: 0`, so a mixed response sorts FTS hits above fallback hits, and the fallback rows keep their arrival order.

The frontend contract mirrors this exactly in `frontend/src/api/services/search.service.ts:42-51` (`SearchResponse`), and `GlobalSearch.tsx:160` reads `response.byType[type]`.

## Known Cost — A-23

**One query per type, sequentially.** `search.service.js:101-105`:

```js
for (const type of requested) {
  const rows = await searchType(type, tenantId, term, safeLimit);
  …
}
```

Three types means three round-trips, one after another, on every search — and the frontend's `GlobalSearch.tsx:75` calls `searchService.search(q, undefined, 10)` with no type filter, so the full-width path is the common one. The latency is the sum, not the maximum.

**And the fallback warning is logged per call, not per process.** On a database without the FTS column — every unit-test run, and any deployment where migration 0003 did not apply — each search writes three `logger.warn` lines.

A-23 is open, wave 2, severity low. Its Definition of Done: the three queries run concurrently or as one `UNION ALL`, and the fallback warning is logged once per process.

Two related open items sit next to it:

- **A-22** — `GlobalSearch.tsx` carries a React Compiler lint error (`react-hooks/set-state-in-effect`, line 101), pre-existing since the first commit. Fix by restructuring the component, not by disabling the rule.
- `docs/ARCHITECTURE/00-SYSTEM-ARCHITECTURE.md:49` links to `docs/SEARCH/02-FULL-TEXT.md`, which **does not exist**. That link is broken today; the FTS detail is the § Full-Text Search section above until someone writes it.

## Evidence

Named, per the evidence rule — these are the suites, not an assertion that "search is tested":

| Suite | What it covers |
|---|---|
| `backend/src/tests/controllers/search.permissions.a04.test.js` | the permission filter, running the **real** controller, service, `dynamicAccess` and `scopeAllows`, mocking only `db.query` and the permission stores, and asserting which tables were queried. 15 cases, including "gives a warehouse-only role stock rows and no devices or certificates", "honours a per-user 'none' override that revokes a menu the role grants", "a `warehouse:read` key sees stock only", "returns nothing and queries nothing for a role with none of the three menus" |
| `backend/src/tests/routes/search.guard.a04.test.js` | the route-level OR gate |
| `backend/src/tests/services/search.service.test.js` | FTS, the ILIKE fallback, limit clamping, the empty-list semantics |
| `backend/src/tests/controllers/search.controller.test.js`, `backend/src/tests/routes/search.route.test.js` | the pre-existing controller and route behaviour |

**Not verified live.** A-04's own residual records it: the claim that `equipment:read` inherits to `calibration` and `certificate` is read from `seedMenuGroups.util.js`, not confirmed against `menu_groups` in `psql`.

## Related

| For | Read |
|---|---|
| why raw SQL must carry the predicate | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the full inventory of raw SQL and unscoped models | [`../MULTI-TENANCY/08-CROSS-TENANT-PROTECTION.md`](../MULTI-TENANCY/08-CROSS-TENANT-PROTECTION.md) |
| the permission model `dynamicAccess` implements | [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) |
| the response envelope | [`../API/00-API-STANDARDS.md`](../API/00-API-STANDARDS.md) |
| the remediation cards | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-04, A-22, A-23, A-35 |
