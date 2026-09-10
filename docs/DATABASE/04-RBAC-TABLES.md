# 04 — RBAC Tables

`roles` · `menu_groups` · `role_menu_permissions` · `user_menu_permissions`

**All four are global**, not tenant-scoped. Every tenant draws from the same role and menu catalogue.

---

## `roles` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK — seeded with fixed UUIDs from `ROLE_IDS` |
| `name` | `STRING` | the internal identifier code compares against |
| `nameToShow` | `STRING` | display name, Indonesian for the seeded roles |
| `description` | `STRING` | |
| `isSystem` | `BOOLEAN` | marks the eleven built-ins; the delete guard |
| `status` | `STRING` | indexed |
| `sortOrder` | `INTEGER` | |
| **`roleLevel`** | `INTEGER` | the numeric privilege gates compare against |
| `isDeleted` | `BOOLEAN` | indexed |

### `roleLevel` is the gate

| Level | Roles |
|---|---|
| 10 | `SUPERADMIN` |
| 8 | `HEALTHCARE ADMIN`, `CALIBRATOR ADMIN`, and the logical `TENANT_ADMIN` |
| 7 | `ENGINEERING MANAGER` |
| 6 | `SUPERVISOR` |
| 5 | `TECHNICIAN`, `HEALTHCARE TECHNICIAN` |
| 4 | `FACILITY MAINTENANCE`, `WAREHOUSE STAFF` |
| 3 | `ROOM USER` |
| 1 | `USER` |

A role created through the API without a sensible `roleLevel` will authenticate, resolve menus, and then fail every privileged gate. That fails closed — correct — but **silently**, with nothing explaining why.

### `TENANT_ADMIN` is not in this table

It appears in `ROLE_NAMES` and `ROLE_LEVELS` at level 8 but is **not seeded**. It is a logical tier so one `rbac()` gate covers both admin roles by level comparison. Looking for it in `roles` and not finding it is the expected outcome.

### Seeded UUIDs

`ROLE_IDS` in `roleConstants.js` pins the eleven UUIDs. They must match the seed script exactly — the constants file and the seed are two halves of one fact, and changing one alone produces a role that exists but resolves nothing.

`SUPER_ADMIN_ROLE_ID` is additionally overridable by environment variable, defaulting to `9be20605-cc6a-4d91-8246-9756b4a1754b`.

## `menu_groups`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | PK |
| `name` | `STRING` | |
| `slug` | `STRING` | **indexed** — what `dynamicAccess()` matches on |
| `icon` | `STRING` | |
| `parentId` | `UUID` | indexed — a tree |
| `sortOrder` | `INTEGER` | |
| `isActive` | `BOOLEAN` | indexed |

31 slugs in `MENU_SLUGS`:

```
home  dashboard  account  management  security  profile  warehouse  equipment
content  risk  supplier-scorecard  predictive-maintenance  feature-flags
tenant-lifecycle  data-retention  oidc  webauthn  network-security  scim
qms  sop  workflows  finance  metered-billing  gdpr  custom-domains
batch-jobs  tenant-hierarchy  kanban  tickets-raise  tickets-response
```

`profile` contains the profile page and change-password as **sub-routes** (`PROFILE_SUB_ROUTES`), not separate menu groups. Granting `write` on `profile` grants both.

`tickets-raise` and `tickets-response` are deliberately two menu groups rather than one with two permission levels. The platform operator holds `tickets-response` and **not** `tickets-raise` (BR-13), which one slug with read/write could not express.

## `role_menu_permissions`

| Column | Type | Notes |
|---|---|---|
| `roleId` | `UUID` | indexed |
| `menuGroupId` | `UUID` | indexed |
| `permissionType` | `STRING` | `read` or `write` |

Composite index on `(role_id, menu_group_id)`.

`write` implies `read`. There is no separate `create`/`update`/`delete` granularity — two levels, deliberately, because a permission model with five verbs per surface is a model nobody configures correctly.

Defaults are seeded from `ROLE_MENU_ASSIGNMENTS`. Full matrix: [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md).

## `user_menu_permissions`

| Column | Type | Notes |
|---|---|---|
| `userId` | `UUID` | indexed |
| `menuGroupId` | `UUID` | indexed |
| `permissionType` | `STRING` | `read` or `write` |
| **`grantedBy`** | `UUID` | who authorised the exception |
| **`notes`** | `STRING` | why |

Composite index on `(user_id, menu_group_id)`.

`grantedBy` and `notes` are what make an exception auditable and explicable. An override with neither is an unexplained privilege that nobody can justify at review — and the person who granted it will have forgotten.

Use it for the individual exception. Reaching for it repeatedly for the same shape of exception means a role is missing.

## Resolution

```
SUPERADMIN?  ──yes──▶  allow everything, stop
      │ no
      ▼
role_menu_permissions for the user role
      │
      ▼
user_menu_permissions for this user  ──overrides──▶  effective set
      │
      ▼
required action satisfied?   write implies read
      │
   no ──▶ 403
```

`GET /api/v1/user-permissions/:userId` returns the **resolved effective** set, not the raw override rows. That is the set the sidebar is built from and the set a permission question should be answered with.

## Caching and Invalidation

The resolved menu tree is cached per role. **A permission change must invalidate it.**

TTL alone is not sufficient: a revoked permission that stays effective for five minutes is a five-minute authorization bypass, and five minutes is long enough to matter.

## Why These Tables Are Global

Per-tenant roles would mean each tenant defining its own privilege model, and then every cross-tenant operation — support, the ticket response queue, platform administration — would need to reason about eleven different models at once.

The cost is that a tenant cannot invent a role. The compensation is `user_menu_permissions`, which handles the individual case without fragmenting the model.
