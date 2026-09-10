# 03 — User Roles

Source of truth: `backend/src/constants/roleConstants.js`. These values must stay in sync with the database seed; changing one without the other produces a role that exists but resolves no permissions.

---

## The Eleven Seeded Roles

| Level | Role name (`ROLE_NAMES`) | Display name | Scope |
|---|---|---|---|
| 10 | `SUPERADMIN` | Super Admin | Global — all tenants, bypasses tenant scoping |
| 8 | `HEALTHCARE ADMIN` | Admin Faskes | Tenant administrator (healthcare facility) |
| 8 | `CALIBRATOR ADMIN` | Admin Kalibrator | Tenant administrator (calibration provider) |
| 7 | `ENGINEERING MANAGER` | Manajer Teknik | Management and reporting |
| 6 | `SUPERVISOR` | Penyelia | Review and approve |
| 5 | `TECHNICIAN` | Teknisi | Technical staff |
| 5 | `HEALTHCARE TECHNICIAN` | Teknisi Faskes | Technical staff (facility side) |
| 4 | `FACILITY MAINTENANCE` | IPSRS | Operational staff |
| 4 | `WAREHOUSE STAFF` | Gudang | Operational staff (inventory) |
| 3 | `ROOM USER` | User Ruangan | Read-only device status |
| 1 | `USER` | Normal User | Profile only |

Display names are Indonesian because the primary market is Indonesian healthcare (KARS, SNARS). The internal role name stays English and is what code compares against.

## `TENANT_ADMIN` — the twelfth role that is not a role

`TENANT_ADMIN` appears in `ROLE_NAMES` and `ROLE_LEVELS` at level 8, but it is **not seeded** and no user holds it. It is a logical authorization tier that lets one `rbac()` gate cover both `HEALTHCARE ADMIN` and `CALIBRATOR ADMIN` by level comparison, rather than repeating a two-name list at every tenant-administrative route.

If you look for it in the `roles` table you will not find it. That is correct.

## Role Levels Are the Gate

```js
const ROLE_LEVELS = {
  SUPER_ADMIN: 10,
  TENANT_ADMIN: 8,   // logical tier
  HEALTCARE_ADMIN: 8,
  CALIBRATOR_ADMIN: 8,
  ENGINEERING_MANAGER: 7,
  SUPERVISOR: 6,
  TECHNICIAN: 5,
  HEALTHCARE_TECHNICIAN: 5,
  FACILITY_MAINTENANCE: 4,
  WAREHOUSE_STAFF: 4,
  ROOM_USER: 3,
  USER: 1,
};
```

A role absent from this map resolves to the lowest privilege. That fails closed, which is right, but it fails **silently** — a newly added role that nobody added here will simply be unable to do anything, with no error explaining why.

Note the spelling `HEALTCARE_ADMIN` (missing the `H`) in the constant key. It is a typo preserved deliberately: renaming it would require a coordinated change to the seed data and every consumer, for no behavioural gain. The `ROLE_NAMES` value it maps to is correctly spelled `HEALTHCARE ADMIN`.

## Menu Groups Are the Permission Unit

Permission is not expressed per endpoint. It is expressed per **menu group** — a named surface such as `equipment`, `warehouse`, `qms` — with a permission type of `read` or `write`. `dynamicAccess(resource, action)` maps an incoming request to a menu group and required action, then resolves whether the caller has it.

The menu group catalogue (`MENU_SLUGS`) currently holds 31 slugs:

```
home  dashboard  account  management  security  profile  warehouse  equipment
content  risk  supplier-scorecard  predictive-maintenance  feature-flags
tenant-lifecycle  data-retention  oidc  webauthn  network-security  scim
qms  sop  workflows  finance  metered-billing  gdpr  custom-domains
batch-jobs  tenant-hierarchy  kanban  tickets-raise  tickets-response
```

`profile` is special: the profile page and the change-password page are sub-routes within it (`PROFILE_SUB_ROUTES`), not separate menu groups. Granting `write` on `profile` grants both.

## Default Grants by Role

Full matrix: `ROLE_MENU_ASSIGNMENTS` in `roleConstants.js`. The shape of it:

| Role | Gets `write` on | Gets `read` on | Notably absent |
|---|---|---|---|
| `SUPERADMIN` | everything except `home`/`dashboard` | `home`, `dashboard` | **`tickets-raise`** — see BR-13 |
| `HEALTHCARE ADMIN` | account, management, warehouse, equipment, risk, supplier-scorecard, qms, sop, workflows, tickets (both) | dashboard, predictive-maintenance, feature-flags, tenant-lifecycle, data-retention, oidc, webauthn, network-security, scim, finance, metered-billing, gdpr, custom-domains, batch-jobs, tenant-hierarchy | `security`, `content`, `kanban` |
| `CALIBRATOR ADMIN` | account, management, equipment, risk, predictive-maintenance, qms, sop, workflows, kanban, tickets (both) | warehouse, supplier-scorecard, feature-flags, tenant-lifecycle, data-retention, finance, batch-jobs | the governance screens the healthcare admin gets read on |
| `ENGINEERING MANAGER` | kanban, tickets (both) | everything operational | all write access to domain data |
| `SUPERVISOR` | kanban, tickets (both) | dashboard, account, warehouse, equipment | qms, sop, workflows |
| `TECHNICIAN` | kanban, tickets-raise | dashboard, warehouse, equipment | account |
| `HEALTHCARE TECHNICIAN` | tickets-raise | dashboard, warehouse, equipment | kanban |
| `FACILITY MAINTENANCE` | tickets-raise | home, warehouse, equipment | dashboard |
| `WAREHOUSE STAFF` | **warehouse**, tickets-raise | home, equipment | dashboard |
| `ROOM USER` | tickets-raise | home, dashboard, warehouse, equipment | everything else |
| `USER` | tickets-raise | home, dashboard, account, warehouse, equipment | everything else |

Every role, without exception, holds `write` on `profile`.

Two asymmetries worth understanding rather than tidying:

- **`WAREHOUSE STAFF` outranks its level on one axis.** At level 4 it holds `write` on `warehouse` — more than `SUPERVISOR` (level 6) has. Level orders privilege *escalation*; it does not order *scope*. A warehouse clerk is supposed to move stock; a supervisor is supposed to approve it.
- **`SUPERADMIN` cannot raise a support ticket.** This is deliberate (BR-13) and will look like an omission.

## Per-User Overrides

`user_menu_permissions` grants or narrows a single user relative to their role, carrying `grantedBy` and `notes` so the grant is attributable and explicable. Resolution order is role grant, then user override, then super-admin short-circuit.

Use it for the individual exception. Reaching for it repeatedly for the same shape of exception means a role is missing.

## Adding a Role

1. Add to `ROLE_NAMES`, `ROLE_DISPLAY_NAMES`, `ROLE_IDS`, **`ROLE_LEVELS`**, and `ROLE_SEEDING_ORDER`.
2. Add a `ROLE_MENU_ASSIGNMENTS` entry — a role with no menu assignments can log in and see nothing.
3. Update the seed script with the same UUID as `ROLE_IDS`.
4. Add permission-enforcement tests, including the negative case.
5. Record an ADR in [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) — the role model is architecture.

Skipping step 1's `ROLE_LEVELS` entry is the failure mode that produces a role which authenticates, resolves menus, and then fails every privileged gate for no visible reason.
