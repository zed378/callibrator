# 08 — Cross-Tenant Protection

The controls that stop one hospital reaching another's data — and the four places where, on 2026-09-23, something still crossed the boundary. Layer 5 records which have closed since (ADR-088).

This document **extends** [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md), which is mandatory reading and defines the mechanism. It is not repeated here. This one is the *inventory*: which controls exist, which models they do not reach, and what is currently leaking through the gaps.

Isolation over a socket is [`./06-REALTIME-ISOLATION.md`](./06-REALTIME-ISOLATION.md).

> **Target standard: TypeScript, strict (ADR-038).** Every backend file named below is **JavaScript/CommonJS as built** — except `utils/tenantScope.util`, which Phase 9 converted to `backend/src/utils/tenantScope.util.ts` by 2026-09-28; its line numbers below are those of the former `.js` (ADR-088). Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

---

## The Control Stack

Five layers, in the order a request meets them. Only the first is automatic.

| # | Control | Where | Automatic? |
|---|---|---|---|
| 1 | global Sequelize hooks injecting the tenant predicate | `backend/src/utils/tenantScope.util.js` | **yes** — you do not opt in |
| 2 | the 404-not-403 rule for anything that is not yours | per controller / per route guard | no |
| 3 | an explicit predicate in every raw SQL statement | per call site | no |
| 4 | a route-level guard for models the hooks cannot scope | per route | no |
| 5 | tenant-scoped uniqueness | per index, in the model and the migration | no |

Layers 2 through 5 are conventions. Nothing in the build enforces any of them, which is why this document exists as an inventory rather than a description.

## Layer 1 — Where The Hooks Reach, And Where They Stop

The hooks scope a model **if and only if** it declares a tenant column. `tenantScope.util.js:38-44`:

```js
const tenantKeyOf = (model) => {
  const attrs = model && model.rawAttributes;
  if (!attrs) return null;
  if (attrs.tenantId) return "tenantId";
  if (attrs.tenant_id) return "tenant_id";
  return null;
};
```

`applyTenantWhere` returns immediately when that is `null` (`tenantScope.util.js:64-65`). **A model with no tenant attribute is never scoped, and never denied.** There is no warning, no log line, no failing test. `Model.findAll()` on such a model returns every row on the platform.

Two of them are load-bearing:

| Model | File | Consequence |
|---|---|---|
| **`Tenant`** | `backend/src/models/tenant.model.js` — no `tenantId` attribute | `Tenant.findByPk(req.params.tenantId)` reads **any** tenant; `Tenant.update(…, { where: { id } })` **writes** any tenant. This was A-01 |
| **`Role`** | `backend/src/models/role.model.js` — no `tenantId`, and `name` is `unique: true` at line 28 | roles are **global**. Every tenant shares the role table. This was the root of A-38 and A-39; SCIM no longer creates, renames or deletes a role — its groups are the tenant-owned `scim_groups` table since 2026-09-24 (ADR-053) (ADR-088) |

Others exist — `kanbanProjectMember`, `kanbanColumn`, `kanbanLabel`, `kanbanSprint` and the kanban join tables carry no `tenantId`; only `kanbanProject` and `kanbanCard` do. Those are reachable only through a project, and the project lookup is tenant-bound, so they are guarded upstream rather than by the hooks. That is a different risk class from `Tenant` and `Role`, which are addressed directly by id from routes.

**To find them yourself:** a model whose file contains no `tenantId:` (or `tenant_id:`) attribute declaration is unscoped. Grep before you assume.

## Layer 2 — 404, Never 403

Defined in [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § Status Codes Leak, and not restated. The operational form of it in this codebase:

- When the hooks scope the model, you get the 404 for free: the row simply is not found.
- When they do **not** — an unscoped model reached by a path id — the 404 is yours to write. `backend/src/routes/api/tenantHierarchy.route.js:39-53` is the worked example:

```js
const ownTenantOnly = (param) =>
  function ownTenantGuard(req, res, next) {
    if (req.user?.role?.name === ROLE_NAMES.SUPER_ADMIN) return next();
    if (req.params[param] !== req.user?.tenantId) {
      return res.status(404).json({ success: false, status: 404,
        message: "Tenant not found", data: null });
    }
    return next();
  };
```

Note what it does **not** do: it does not look the tenant up to decide. Comparing the path id to the caller's own tenant id needs no query and cannot answer differently for an id that exists and one that does not.

`kanban.service.js:130-139` shows the same rule at service level — 404 when the caller has no access at all, 403 only when they have *some* access and not enough:

```js
if (!level) throw new AppError(404, "Project not found");
throw new AppError(403, `Requires ${minLevel} access to this project`);
```

A 403 **inside the caller's own tenant** is correct and carries meaning. A 403 across tenants is the oracle.

## Layer 3 — Raw SQL Carries The Predicate

`sequelize.query` bypasses the hooks entirely. There is no interception point; the string you write is the query that runs.

The complete inventory of raw SQL in runtime backend code (excluding `src/tests/`, `src/migrations/` and the two `SELECT 1` liveness probes), as of 2026-09-23:

| Call site | Statement | Tenant predicate |
|---|---|---|
| `services/search.service.js:45-49` | FTS `SELECT` per type | **explicit** — `WHERE tenant_id = :tenantId` |
| `services/search.service.js:58-62` | ILIKE fallback `SELECT` | **explicit** — `WHERE tenant_id = :tenantId` |
| `services/ai.service.js:206-211` | `INSERT INTO document_chunks` | **explicit** — `tenant_id` bound as `$1` |
| `services/ai.service.js:233-244` | pgvector cosine-distance retrieval | **explicit** — `WHERE tenant_id = $2` |
| `services/meteredBilling.service.js:176-190` | usage aggregate over `"UsageMetrics"` | **explicit** — `WHERE "tenantId" = $1` |
| `services/meteredBilling.service.js:655-658` | `DELETE FROM "UsageMetrics"` | **explicit** — `WHERE "tenantId" = $1` |
| `services/ticket.service.js:196-203` | `INSERT … ON CONFLICT` ticket counter | **explicit** — `tenant_id` in the insert and the conflict target |
| `services/kanban.service.js:745-752` | `UPDATE kanban_projects SET card_seq = card_seq + 1 WHERE id = :projectId` | **none** — guarded upstream |

The last row is the honest exception, and it is worth reading before you copy the pattern. `createCard` calls `assertAccess(user, projectId, "editor")` at `kanban.service.js:713` before reaching line 745, and `assertAccess` resolves the project with an explicit `tenantId` term. The statement is therefore unreachable with a foreign `projectId`. It is nonetheless a raw write whose own text contains no tenant term: its safety depends on a call three dozen lines above it staying where it is.

The vector retrieval at `ai.service.js:233` is called out in `SECURITY/05` as the highest-risk instance in the system — a missing predicate there returns another tenant's documents and paraphrases them into an answer, with no error. It carries its predicate today. **Re-read it after any change.**

## Layer 5 — Global Uniqueness Is An Existence Oracle

It is the trap `CLAUDE.md` names by name. When this section was written (2026-09-23) it was live in three places. **As of 2026-09-28 the code has closed all three on the paths below** — by a global duplicate check that answers one 409 either way (A-37, ADR-075), by tenant-owned SCIM groups (A-38, ADR-053) and by a per-tenant serial index (D-04, ADR-049). The global `username`/`email` indexes remain by decision (BACKLOG Q-18). The table and the two step-by-steps below are kept as the record of the defect shape; each row now says what the code does today (ADR-088).

The shape is always the same: **a uniqueness constraint that spans tenants, plus a duplicate check that does not.** The application's pre-check is narrowed to the caller's own tenant by the global hooks; the database constraint is not narrowed at all. So a value already held by *another* tenant produces a different failure from a value nobody holds — and the difference is the oracle.

| Value | Constraint | Duplicate check | Finding |
|---|---|---|---|
| `users.username` | `{ fields: ["username"], unique: true }` — `user.model.js:206`, and `unique: true` inline at line 30 | *today:* `user.service.js#assertIdentityFree` — deliberately global (`skipTenantScope`, A-128), so "held here" and "held elsewhere" are the same 409 (ADR-088) | **A-37** |
| `users.email` | `{ fields: ["email"], unique: true }` — `user.model.js:207`. A **non-unique** composite `["tenant_id", "email"]` sits right beneath it at line 208, which reads like tenant scoping and is not | *was:* `scim.service.js` `Users.findOne({ where: { email } })`, narrowed by the hooks. *Today:* `scim.service.js#assertAddressFree` calls the global `assertIdentityFree` for both fields — one 409, rate-limited per key, audited as `system:scim` (ADR-075) (ADR-088) | **A-37** |
| `roles.name` | `unique: true` — `role.model.js:28`, on a model with no `tenantId` | *was:* `scim.service.js` `Role.findOne({ where: { name } })`, unscoped. *Today:* SCIM checks names in `scim_groups`, unique per `(tenant_id, lower(display_name))` (migration 0042), and creates no role (ADR-088) | **A-38** |
| `calibration_devices.serialNumber` | *was* `unique: true` on the column. *Today:* `UNIQUE (tenant_id, serial_number)`, created by migration 0026 — `calibrationDevice.model.js:35-38` (D-04, ADR-049) (ADR-088) | — | closed; [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § The `serialNumber` oracle still describes the old constraint |

### A-37 — SCIM user creation, step by step

> **Historical (ADR-088).** This is the defect as found on 2026-09-23. Since 2026-09-27 (ADR-075) step 2 is a **global** check and every conflict is one 409; the decision the last paragraph asks for was taken as "keep global identity" (BACKLOG Q-18). See A-37 on the board.

1. An IdP (or anyone with a SCIM API key) posts a user with an email address.
2. `scim.service.js:334` checks for a duplicate. The global hooks add `tenantId = <caller's tenant>`, so the check sees only the caller's own tenant. It passes.
3. The insert runs. The **global** unique index on `email` rejects it.
4. The caller receives a database-constraint failure — visibly different from the 409 it would get for a duplicate inside its own tenant, and visibly different from the 201 it would get for a fresh address.

The caller has learned that some other tenant on the platform holds that address, using nothing but an API key. That is precisely the membership oracle the 404 rule exists to prevent.

**Do not patch this.** It needs a decision: either make `username`/`email` unique **per tenant** — a migration and an ADR, and it changes what "an account" means across the platform — or keep global uniqueness and make both paths answer **identically**, which hides the oracle but leaves an address unusable in a second hospital for reasons no administrator can see. A-37 records both options as an Open Question.

### A-38 — SCIM Groups are global roles

> **Historical (ADR-088).** Closed 2026-09-24 by ADR-053: SCIM groups are rows of the tenant-owned `scim_groups` table; every group query names `tenantId`, another tenant's group is 404, and SCIM never creates, renames or deletes a role. A-39 was closed by the same ADR — a group maps to an existing role that grants something, and an unmapped group refuses members with 409. Roles an IdP created through the old code remain global. The line numbers below are of the old `scim.service.js`.

Because `Role` has no `tenantId`:

| Operation | Effect | Code |
|---|---|---|
| `GET /Groups` | lists **every** role on the platform, including groups another tenant's IdP created | the list query has no tenant term to add |
| `GET /Groups/:id` | `scim.service.js:474` — `Role.findOne({ where: { id: groupId } })`, any id, any tenant | membership is still tenant-scoped (`scim.service.js:479-482`), so the *users* are not disclosed |
| `POST /Groups` | 409 when the name is taken **by another tenant** — the A-37 oracle again | `scim.service.js:494` |
| `DELETE /Groups/:id` | destroys a non-system role for **every** tenant whose users hold it | — |

`assertMutableGroup` (added under A-27) refuses system roles, which is what keeps this from being critical. Roles needing tenant ownership is a data-model decision: ADR, not a patch.

A-39 is the adjacent one worth knowing about: a SCIM-created group takes the `roleLevel` default of `1` (`role.model.js:36-39`) and gets no menu permissions, so it grants **nothing**, silently, while the IdP is told "group created".

## What Was Fixed On 2026-09-23

### A-01 — `tenant-hierarchy` allowed cross-tenant writes

Every route in `backend/src/routes/api/tenantHierarchy.route.js` carried `auth` and nothing else. Because the `Tenant` model is unscoped, `addChildTenant`, `updateTenantParent` and `removeTenantParent` reached **any** tenant: any authenticated user of any tenant — or any API key, whatever its scope — could create a sub-organisation under another hospital, or re-parent and detach one. The menu matrix said `SUPERADMIN` only; the backend enforced nothing. It was hidden in the UI, which is not a control.

The gates now (line numbers re-read 2026-09-28, ADR-088; the living table is [`./01-TENANT-HIERARCHY-AND-SUBORGS.md`](./01-TENANT-HIERARCHY-AND-SUBORGS.md) § Gate Table):

| Route | Gate | Line |
|---|---|---|
| `GET /tree` | `auth` — the controller reads `req.user.tenantId`, never a path id (`tenantHierarchy.controller.js:30`) | `103` |
| `GET /:tenantId/children`, `/parent`, `/descendants`, `/ancestors` | `ownTenantOnly(...)` — a cross-tenant id is **404**, not 403 | `146`, `193`, `241`, `282` |
| `POST /:tenantId/children` | `[auth, denyApiKey, superAdminOnly]` | `357` |
| `PUT /:tenantId/parent`, `DELETE /:tenantId/parent` | `[auth, denyApiKey, superAdminOnly]` | `409`, `451` |
| `GET /cross-tenant-roles` | `[auth, denyApiKey, superAdminOnly]` — it reads role assignments for an arbitrary user id | `499` |

**The handlers were not changed.** They still call `Tenant.findByPk` and `Tenant.update`, which the hooks do not scope. The route gate is the entire control. That is worth internalising: for an unscoped model, deleting the gate deletes the isolation.

Evidence: `backend/src/tests/routes/tenantHierarchy.guards.test.js` — 23 tests, including "answers 404 for another tenant" (one per read route) and "requires auth, denies API keys and requires SUPERADMIN" (one per mutation). **Not** reproduced live against a running server.

A-01's last Definition-of-Done item is still the important one and is **not** closed: *the same audit applied to every other route that loads `Tenant` by a path id — the unscoped model is the root cause, and it may not be the only instance.*

### A-35 — Per-user permission overrides never applied

Not a cross-tenant leak, but a control that reported success and took no effect, so it belongs in any honest inventory of what protects a tenant's data.

`userPermission.service.js#getUserOverrideMatrix` keyed the override matrix by menu **name** — `matrix[p.menu.name]`, e.g. `"Warehouse"` — while `dynamicAccess.middleware.js:272` looks an override up as `overrides[menuName]`, where `menuName` is whatever the route passed. Every route passes a lowercase **slug** (`"warehouse"`). The `hasOwnProperty` test therefore never matched, on any route, and the override branch never ran.

Role permissions worked, which is why nobody noticed: `roles.service.js#getRolePermissionsMatrix` indexes by **both** name and slug.

The impact ran in both directions. An administrator granting one user extra access saw it do nothing. Worse: an override of `"none"` is a **revocation**, and it did nothing either — the user kept whatever the role granted while the UI showed the access as removed.

Fixed by indexing the override matrix under both keys (`userPermission.service.js:227` and `:230`). Evidence: `src/tests/services/userPermission` (16 tests) plus `controllers/search.permissions.a04.test.js:190` — "honours a per-user 'none' override that revokes a menu the role grants" — which drives the real middleware end to end.

**Residual:** the cached matrix (`cacheKeys.userPermissions`) may hold name-only entries written before the change until they expire. `removeUserPermission` and the setter already invalidate it. Not verified against a live database.

## Review Checklist

`SECURITY/05` § Review Checklist is the baseline and still applies in full. These are the additions this document exists for:

- [ ] does the model you touched declare `tenantId` or `tenant_id`? If not, **nothing automatic protects it** — name the route guard that does
- [ ] any new `Tenant.*` or `Role.*` call reached from a path parameter has an explicit own-tenant guard returning **404**
- [ ] any new unique index is composite on `(tenant_id, …)`, or the ADR explaining why it is global exists
- [ ] any new duplicate pre-check answers the same way for "exists here" and "exists elsewhere"
- [ ] any new `sequelize.query` carries the predicate **in its own text**, not in a caller three dozen lines above it

## Related

| For | Read |
|---|---|
| the mandatory isolation document this one extends | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| isolation over a socket | [`./06-REALTIME-ISOLATION.md`](./06-REALTIME-ISOLATION.md) |
| the tenant-scoped raw SQL in global search | [`../SEARCH/01-GLOBAL-SEARCH.md`](../SEARCH/01-GLOBAL-SEARCH.md) |
| the findings behind every open item here | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-01, A-35, A-37, A-38, A-39 |
| the open decisions | [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) |
