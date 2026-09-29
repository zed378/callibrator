# 01 — Tenant Hierarchy, Lifecycle and Backup

The three modules that act **on a tenant as a whole** rather than on rows inside one: the parent/child tree, the lifecycle states, and the backup archive. Each of them is capable of crossing the per-row tenant boundary, and each is held in place by something other than the automatic hooks.

This document **extends** [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md), which is mandatory reading and is not repeated here. The inventory of every control and every known gap is [`./08-CROSS-TENANT-PROTECTION.md`](./08-CROSS-TENANT-PROTECTION.md); every platform-operator capability is listed once in [`./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md`](./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md).

> **Target standard: TypeScript, strict (ADR-038).** Every file this document names is **JavaScript/CommonJS as built**, except two that Phase 9 (ADR-087) had converted when this was written on 2026-09-28: `backend/src/middlewares/tenantContext.middleware.ts` and `backend/src/utils/tenantScope.util.ts`. Line numbers are as of that date; the function names are the stable reference.

---

## Read This First — The Model The Hooks Do Not See

`SECURITY/05` describes tenant isolation as automatic. It is automatic **only for a model that declares a tenant attribute**. `tenantScope.util.ts#tenantKeyOf` returns `"tenantId"`, `"tenant_id"` or `null`, and every hook returns early on `null`.

**`Tenant` has no tenant attribute, because it is the tenant.** `backend/src/models/tenant.model.js` line 1 says so in its own header (D-17). So:

- `Tenant.findByPk(req.params.tenantId)` reads **any** tenant on the platform, for any caller;
- `Tenant.update(…, { where: { id } })` and `tenant.save()` **write** any tenant;
- there is no deny branch — a principal with no tenant is not refused, because nothing is asked.

That is the whole of A-01: until 2026-09-23 the hierarchy routes carried `auth` alone, and any authenticated user or API key could re-parent another hospital. The handlers were not changed by the fix; **the route gate is the entire control.** Delete the gate and the isolation goes with it.

`Tenant` does carry two hooks of its own, and neither is a tenant predicate:

| Hook | What it does | Where |
|---|---|---|
| `defaultScope` `{ is_deleted: false }` + `paranoid: true` | hides soft-deleted and destroyed tenants from a plain query | `tenant.model.js` `defaultScope` |
| `excludePlatformTenant` on `beforeFind` / `beforeCount` / `beforeBulkUpdate` / `beforeBulkDestroy` | AND-s `id <> PLATFORM_TENANT_ID` onto every query unless it passes `includePlatformTenant: true` — so the reserved PLATFORM tenant answers 404 like a missing id (A-125) | `tenant.model.js#excludePlatformTenant` |

**What stands in for the missing predicate**, in every module below, is one of three things, and a reviewer should be able to name which one on any route that reaches `Tenant` by a path id:

1. `superAdminOnly` (optionally with `denyApiKey`) — only the platform operator reaches the handler;
2. an own-tenant comparison that answers **404** — `ownTenantGuard` in `tenantHierarchy.route.js`, or `checkTenant: true` on `abac` / `dynamicAccess`, which compares the path `tenantId` with `req.user.tenantId`;
3. a `where` the service writes itself with a tenant id it did not take from the request.

`backend/src/tests/models/unscopedModels.d17.test.js` holds the list of models with no tenant column (19 by its own header), each with its reason; `Tenant`'s entry is "reached by id only behind ownTenantGuard / superAdminOnly (A-01)". A new unscoped model fails that test until it is listed.

### `TenantHierarchy` is not in that list

The DOC-06 card says `tenantHierarchy.model.js` has no `tenantId`. **It has one** — `tenantId` UUID NOT NULL, FK `tenants.id` RESTRICT, uniquely indexed (`tenantHierarchy.model.js`). So the global hooks **do** scope `tenant_hierarchies`: a tenant user's context sees only its own tenant's hierarchy row. A super admin (skip) sees them all. The consequence is spelled out under [The reads, as a tenant user sees them](#the-reads-as-a-tenant-user-sees-them).

## The Parent/Child Model

Two structures, written together:

| Structure | Holds | Written by |
|---|---|---|
| `tenants.parent_id` | the parent tenant's id; `NULL` is a root. FK to `tenants.id`, `ON DELETE SET NULL` | `createSubOrganization`, `moveTenant` |
| `tenant_hierarchies` | one row per tenant that has been placed in a tree: `tenant_code`, `parent_code`, a materialised `path` (lower-cased codes joined by `/`, e.g. `/acme/acme_001`) and `depth` | the same two functions, **nowhere else** |

**What it is for:** structure — a hospital group and its branches. **What it is not:** access. ADR-084 (Q-05) decided that *a parent tenant never sees a child tenant's data by virtue of the hierarchy*, and a child never sees its parent's or a sibling's. The helpers that encoded the opposite (`getDataVisibilityScope`, `buildTenantFilter`, `HIERARCHY_SCOPE`, a "subtree" and an "all" scope) were removed. The service header says it in its first paragraph: "It grants no data visibility across tenants". `tenantContext.middleware.ts` never reads the hierarchy, and `backend/src/tests/routes/tenantHierarchy.visibility.q05.test.js` › *"the request tenant context never reads the hierarchy"* reads that file as text to keep it that way. Group reporting, if it is ever wanted, is a new feature with its own ADR: aggregates only, consented by each child (ADR-084).

**No role cascade.** Roles are global (`role.model.js` has no `tenantId`; ADR-064), so every role already applies in a child. The former `cascadeRoles` never ran and was removed (A-134).

### Creating a sub-organisation

`POST /api/v1/tenant-hierarchy/:parentId/children` → `tenantHierarchy.controller.js#addChildTenant` → `tenantHierarchy.service.js#createSubOrganization`.

| Rule | As built |
|---|---|
| **Who** | SUPERADMIN only, never an API key — `[auth, denyApiKey, superAdminOnly]` |
| Feature switch | `HIERARCHY_ENABLED=true`, else **400** "Tenant hierarchy is disabled". *Only* creation checks it; moves do not |
| Parent | must exist (**404**), be `active` (**409**), and have a `code` (**409**). The PLATFORM tenant is 404 (the model hook) |
| Depth | `HIERARCHY_MAX_DEPTH`, default **5**; over it is **409**, checked before any write |
| Child `code` | the body's `code`, else `<parentCode>_<NNN>` (count of the parent's existing children + 1) |
| Child `subdomain` | derived from the code (`subdomainFromCode`, as `tenant.service#createTenant` does) |
| Child `email`, `plan` | **copied from the parent**. The validator (`tenantHierarchy.validator.js#addChild`) also accepts `plan` and `settings`; the service ignores both |
| Child `status` | `active` |
| Atomicity | the tenant row, its hierarchy row and **one** audit row (`CREATE_SUB_ORGANIZATION`, under the PLATFORM tenant) commit together (A-187) |
| Code/subdomain collision | **409**, not 500 |

Evidence: `backend/src/tests/routes/tenantHierarchy.children.a187.test.js` (real route chain over the two-tenant fixture, models doubled) and `backend/src/tests/services/tenantHierarchy.createSub.a187.test.js`.

### Moving a tenant

`PUT /:tenantId/parent` (body `{ newParentId }`) and `DELETE /:tenantId/parent` both reach `tenantHierarchy.service.js#moveTenant` (A-224, ADR-065). In **one** transaction:

- the tenant row is locked; a missing tenant or new parent is **404**; a malformed `newParentId` is **400**;
- **409**, with an explanation, for: itself as parent; a new parent inside its own subtree (a cycle — checked on the `parent_id` chain, so it does not depend on the hierarchy rows being complete); already under that parent; already a root (on `DELETE`); a tenant or new parent with no `code`; a move that would push the subtree past `MAX_DEPTH`;
- the tenant's hierarchy row is created if missing, and **every descendant's** `path` and `depth` are rewritten;
- **one** audit row, `MOVE_TENANT` or `DETACH_TENANT`, under the PLATFORM tenant, with `descendantsMoved`.

Evidence: `backend/src/tests/services/tenantHierarchy.move.a224.test.js`.

## Gate Table — `tenantHierarchy.route.js`, as of 2026-09-28

Mounted at `/api/v1/tenant-hierarchy` (`backend/index.js:481`). `platformOnly` is `[auth, denyApiKey, superAdminOnly]` (`tenantHierarchy.route.js:55`). `ownTenantOnly(param)` builds `ownTenantGuard` (`:39-53`): SUPERADMIN passes; otherwise the path id must equal `req.user.tenantId`, or the answer is **404** "Tenant not found" — decided without a query, so it cannot answer differently for an id that exists and one that does not.

| Method · path | Chain | Handler → service | Line |
|---|---|---|---|
| `GET /tree` | `auth` | `getTenantTree` — reads `req.user.tenantId`, never a path id | 103 |
| `GET /:tenantId/children` | `auth`, `validateUuid`, `ownTenantGuard` | `getTenantChildren` → `getTenantTree(tenantId).children` | 146 |
| `GET /:tenantId/parent` | same | `getTenantParent` → last of `getAncestorTenants` | 193 |
| `GET /:tenantId/descendants` | same | `getTenantDescendants` → `getDescendantTenants` | 241 |
| `GET /:tenantId/ancestors` | same | `getTenantAncestors` → `getAncestorTenants` | 282 |
| `POST /:parentId/children` | `platformOnly`, `validateUuid` | `addChildTenant` → `createSubOrganization` | 357 |
| `PUT /:tenantId/parent` | `platformOnly`, `validateUuid` | `updateTenantParent` → `moveTenant` | 409 |
| `DELETE /:tenantId/parent` | `platformOnly`, `validateUuid` | `removeTenantParent` → `moveTenant(…, null)` | 451 |
| `GET /cross-tenant-roles?userId=` | `platformOnly` | `getCrossTenantRoles` → `getUserRolesAcrossTenants` — one user's role and tenant, by an arbitrary user id; no `userId` answers an empty list | 499 |

`GET /tree` and the four reads are listed in `backend/src/constants/routeGateExemptions.js` (`self` and `inline` / `ownTenantGuard`), which is how the P6-04 route guard accepts them without a menu permission.

Evidence: `backend/src/tests/routes/tenantHierarchy.guards.test.js` — "answers 404 for another tenant" per read route, "requires auth, denies API keys and requires SUPERADMIN" per mutation. **Not** reproduced against a running server (A-01's own note).

**Still open from A-01:** its last Definition-of-Done item — the same audit on *every other* route that loads `Tenant` by a path id — is unchecked on the board. [`./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md`](./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md) lists every such route with its gate; that is an inventory, not the audit.

### The reads, as a tenant user sees them

*Derived from the code, not verified against a database.*

`tenant_hierarchies` is tenant-scoped (above), and every child's row carries **the child's** tenant id. For an ordinary principal, the hooks therefore AND `tenant_id = <own tenant>` onto every hierarchy query in `getTenantTree`, `getDescendantTenants` and `getAncestorTenants`:

- `children` and `descendants` come back **empty** — the child rows belong to other tenants;
- `ancestors` comes back **empty** and `parent` is `null` — the ancestor rows belong to other tenants.

That is consistent with ADR-084 (the tree is not a window into other tenants), but it means the four reads carry information **only for the super admin**. A tenant user learns its own row (`depth`, `path`) and nothing else.

A second limit applies **to everyone, the super admin included**: a tenant gets a `tenant_hierarchies` row only when it is created as a child or moved. A root created by `tenant.service#createTenant` has none, so `getTenantTree(root)` finds no row and answers `{ isRoot: true, children: [] }` — **a root parent's children are not listed under it** until the root itself has been moved once. Nothing else writes that table (`grep TenantHierarchy.create backend/src` → the two service call sites).

All three read functions **swallow errors**: `getTenantTree` answers `{ isRoot: true, children: [] }` and the other two answer `[]` from their `catch`. A database failure reads as an empty tree.

## Lifecycle

### The states

| Where | Values | Meaning |
|---|---|---|
| `tenants.status` (ENUM) | `active` · `suspended` · `deleted` | the enforced state: `auth.middleware.js#tenantRefusal` answers **403** for `suspended` / `deleted` on every request; `config/socket.js#checkPrincipal` disconnects an open socket at its next 60 s re-check |
| `tenant_settings` key `lifecycle_status` | `ACTIVE` · `SUSPENDED` · `OFFBOARDED` | the granular label `getTenantLifecycleStatus` reports (ADR-037) |
| `tenants` columns (migration 0023, ADR-045) | `suspension_reason`, `suspended_at`, `suspended_by`, `grace_period_expires_at`, `offboarded_at`, `offboard_retention_expires_at` | the timestamps the transitions write |

"Offboarded" is `status = 'deleted'` plus `offboarded_at`. It deletes nothing: the data stays, readable through `GET /tenants/:tenantId/export`, until a hard delete.

### Transitions through `/api/v1/tenants/:tenantId/…`

`tenantLifecycle.route.js`, mounted at `/api/v1/tenants` (`index.js:467`), `router.use(auth)`. Every mutation is `superAdminOnly`; there is **no `denyApiKey`**, but an API-key principal carries the role name `API_KEY` (`auth.middleware.js#tryApiKeyAuth`), so `superAdminOnly` refuses it anyway.

| Route | Gate | From → to | Audit row | Service |
|---|---|---|---|---|
| `GET /status` | `dynamicAccess("tenant-lifecycle", "read", { checkTenant: true })` — another tenant's id is **404** (A-155) | read | — | `getTenantLifecycleStatus` |
| `POST /suspend` `{ reason }` | `superAdminOnly` | any → `suspended` (a no-op when already suspended) | **none** | `suspendTenant` |
| `POST /resume` | `superAdminOnly` | any → `active` (no-op when active); clears the suspension fields and `grace_period_expires_at` | **none** | `resumeTenant` |
| `POST /grace-period` | `superAdminOnly` | `suspended` only, else **409** (W-21, ADR-079); sets the deadline to now + `TENANT_GRACE_PERIOD_DAYS` (7) | **none** | `enterGracePeriod` |
| `POST /offboard` | `superAdminOnly` | any → `deleted`; retention to now + `TENANT_OFFBOARD_RETENTION_DAYS` (30); a no-op when already `deleted` | **one**, in the same transaction (W-01/W-04) | `offboardTenant` |
| `POST /offboard/cancel` | `superAdminOnly` | `deleted` → `active`, else **400**; clears offboard and grace fields | **none** | `cancelOffboarding` |
| `GET /export` | `superAdminOnly` | read — allow-listed user and setting attributes, credentials redacted (A-179) | — | `exportTenantData` |

Responses pass through `tenantLifecycle.controller.js#tenantBody`, which strips credentials mirrored into `settings` (A-263).

**The scheduler** — `tenantLifecycleScheduler.middleware.js` → `tenantLifecycle.service.js#processExpiredGracePeriods` — reads `suspended` tenants whose grace period has passed (the one legitimately cross-tenant read, on the unscoped `Tenant` model, keyset-paged), then runs each `offboardTenant` inside `runForTenant(tenantId)` (W-12), so each offboarding is confined to its own tenant. Its audit row names `system:tenant-lifecycle` as the actor.

**`hardDeleteOffboardedTenant`** exists (D-23, ADR-064): offboarded **and** past retention, else 409; refuses, naming each table and count, while any regulated record remains. **Nothing calls it** — no route, no job.

### What the code does that the table above does not stop

*Each item is read from the code; none has a test that pins it, and none is recorded on the board as of 2026-09-28.*

- **Four of the six transitions write no audit row.** `suspendTenant`, `resumeTenant`, `enterGracePeriod` and `cancelOffboarding` write `tenants`, and the first two `tenant_settings`, with a winston log line and no `audit_logs` row. Only `offboardTenant` is audited. `CLAUDE.md` makes an audit row inside the transaction a non-negotiable for every mutation.
- **`suspend` and `resume` accept an offboarded tenant.** Neither checks for `deleted`. `resume` sets it `active` but leaves `offboarded_at` and `offboard_retention_expires_at` in place — which `cancelOffboarding` exists to clear.
- **`force` is unreachable over HTTP.** The controller reads `validated.force`, but `tenantIdSchema` declares only `tenantId` and the validator strips unknown keys (`tenantLifecycle.validator.js`), so it is always `false`.
- **`cancelOffboarding` answers a state conflict with 400**, where `CLAUDE.md` § Status Codes calls for 409.
- **Two other paths write `tenants.status` with no transition rule at all:**
  - `PATCH /api/v1/admin/tenants/:id/status` (`admin.service.js#updateTenantStatus`, SUPERADMIN) sets any of the three values from any other. It **is** audited — twice, under PLATFORM and under the tenant (A-165) — but it writes none of the lifecycle timestamps;
  - the inbound Stripe webhook (`POST /api/v1/billing/webhook`, `stripeWebhook.service.js#setTenantStatus`) sets `active` on `invoice.paid` and on a subscription update to Active, and `suspended` on a repeated payment failure — unconditionally, with no audit row. As written, a paid invoice would re-activate a tenant a super admin suspended or offboarded.

**The default-tenant trap** (`CLAUDE.md` § The Traps) applies to `suspend` unchanged: the seeded super admin lives in the default tenant, and suspending it refuses the super admin too. The PLATFORM tenant cannot be suspended through these routes — `Tenant.findByPk` hides it, so it is 404.

## Backup and Restore

`tenantBackup.route.js`, mounted at `/api/v1/tenants` (`index.js:433`). Every route has the same gate:

```
auth → rbac([SUPER_ADMIN, TENANT_ADMIN], { allowHigher: true }) → abac([tenant:<action>], { checkTenant: true })
```

`rbac` admits role level ≥ 8 (`ROLE_LEVELS.TENANT_ADMIN`); `abac`'s `checkTenant` answers **404** for a path `tenantId` that is not the caller's own — the same body as for one that does not exist (AZ-04, `abac.middleware.js`). **The super admin bypasses `checkTenant`** and so reaches any tenant's backups. That is the cross-tenant capability here, and it is deliberate: backup and restore of a tenant is an operator task.

| Route | `abac` permission | Service |
|---|---|---|
| `POST /:tenantId/backups` | `tenant:update` | `createBackup` |
| `GET /:tenantId/backups`, `/backups/stats` | `tenant:read` | `getBackups`, `getBackupStats` |
| `GET /:tenantId/backups/:backupId`, `/download` | `tenant:read` | `TenantBackup.findByPk`, `downloadBackup` |
| `POST /:tenantId/backups/:backupId/restore` | `tenant:update` | `restoreBackup` |
| `DELETE /:tenantId/backups/:backupId` | `tenant:delete` | `deleteBackup` |

**Scope of an archive** (`tenantBackup.service.js#exportTenantData`): the tenant row and, for a `full` or `user_only` backup, that tenant's users — each through an **allow-list** (`TENANT_EXPORT_ATTRIBUTES`, `USER_EXPORT_ATTRIBUTES`, A-139). No password hash, no TOTP seed, no WebAuthn credential, no `settings` JSON. **Nothing else is in it** — no devices, calibration records, certificates, attachments or stock. Calling it a tenant backup overstates it; it is an account snapshot.

**Scope of a restore** (`restoreBackup`, `assertRestorable`, `reconcileUsers`):

- only a `completed` backup that has not been restored before (else **409** naming the state);
- the file's SHA-256 must match the one recorded when it was taken (D-02), else **409**;
- it restores **only into the tenant that owns the backup row**; an archive whose embedded tenant id differs is refused, and the tenant named inside the archive is never used;
- it **never creates an account** and never writes a password; it updates listed fields on accounts that already exist in that tenant (ADR-051 Q-09, A-120), and reports the rest as `notRestored`.

For a tenant administrator the `:backupId` lookups are narrowed by the hooks (`TenantBackup` has a `tenantId`) as well as by `checkTenant`. For the super admin the hooks skip, and **the controller does not compare the backup's tenant with the path's** — `/tenants/A/backups/<B's backup>` resolves B's backup. A restore still targets B, its owner, so this is a URL-consistency gap for the operator, not a leak to a tenant.

The **scheduled** backup (`backup.middleware.js` → `scheduledBackup.service.js`, `BACKUP_SCHEDULER` cron) spans every tenant; its two cross-tenant reads carry `skipTenantScope: true` and are listed in `07`.

## Related

| For | Read |
|---|---|
| the mechanism this extends | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| every control and every open gap | [`./08-CROSS-TENANT-PROTECTION.md`](./08-CROSS-TENANT-PROTECTION.md) |
| every operator capability in one table | [`./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md`](./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md) |
| the decisions | [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) ADR-037, ADR-045, ADR-064, ADR-065, ADR-079, **ADR-084** (Q-05) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-01, A-134, A-139, A-155, A-165, A-187, A-224, A-263 |
