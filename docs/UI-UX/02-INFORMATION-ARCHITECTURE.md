# 02 — Information Architecture

The navigation is **not designed in the frontend**. It is rendered from the menu tree the server resolves for the caller — `menu_groups`, filtered through `role_menu_permissions` and `user_menu_permissions`.

That means IA and authorization are the same structure. Adding a screen means adding a menu group ([`../DATABASE/04-RBAC-TABLES.md`](../DATABASE/04-RBAC-TABLES.md)).

---

## Top Level

```
/                          landing
/login  /register          auth
/blog  /blog/[slug]        content
/news  /news/[slug]        content
/verify/[certificateNumber]  PUBLIC certificate verification
/dashboard/*               authenticated
```

`/verify` is the only public route that is functionally load-bearing rather than marketing. Everything else public is evaluation or content.

## The Dashboard Tree

Grouped by menu slug. A user sees only the groups their role grants.

### Operations — the daily work

| Slug | Route | For |
|---|---|---|
| `dashboard` | `/dashboard` | the landing figures |
| `equipment` | `/dashboard/devices` | the device register |
| | `/dashboard/calibration` | calibration records |
| | `/dashboard/calibration-scheduler` | what is due |
| | `/dashboard/maintenance` | work orders |
| `warehouse` | `/dashboard/stock` | warehouses, locations, stock, transfers, opname |
| `predictive-maintenance` | `/dashboard/predictive-maintenance` | recommendations |

### Quality and compliance

| Slug | Route |
|---|---|
| `qms` | `/dashboard/qms` — non-conformances and CAPA |
| `sop` | `/dashboard/sop` |
| `risk` | `/dashboard/risk` |
| `supplier-scorecard` | `/dashboard/supplier-scorecard` |
| — | `/dashboard/esignature` |
| `security` | `/dashboard/audit` |
| `gdpr` | `/dashboard/gdpr` |
| `data-retention` | `/dashboard/data-retention` |

### Administration

| Slug | Route |
|---|---|
| `account` | `/dashboard/users` |
| `management` | `/dashboard/roles`, `/permissions`, `/user-permissions`, `/menu-groups` |
| | `/dashboard/tenants` |
| `tenant-hierarchy` | `/dashboard/tenant-hierarchy` |
| `tenant-lifecycle` | `/dashboard/tenant-lifecycle` |
| `custom-domains` | `/dashboard/custom-domains` |
| `feature-flags` | `/dashboard/feature-flags` |
| `network-security` | `/dashboard/network-security` |

### Identity

`/dashboard/oidc`, `/scim`, `/mfa`, `/session-management`, and the always-granted `/dashboard/profile` and `/change-password`.

### Commercial

`finance`, `metered-billing` → `/dashboard/billing`, `/finance`, `/metered-billing`.

### Platform services

`/dashboard/attachments`, `/storage`, `/reports`, `/notifications`, `/api-keys`, `/batch-jobs`, `/ai-assistant`, `/content`.

### Collaboration

`kanban` → `/dashboard/kanban`, `/kanban/[projectId]`.

`tickets-raise` → `/dashboard/tickets/raise`. `tickets-response` → `/dashboard/tickets/response`.

**Two slugs, not one.** The platform operator holds `tickets-response` and deliberately not `tickets-raise` (BR-13) — a single slug with read/write could not express that.

## What Different Roles Actually See

The IA is not one tree; it is eleven.

| Role | Sees |
|---|---|
| `SUPERADMIN` | everything except the raise-a-ticket surface |
| `HEALTHCARE ADMIN` | operations, quality, administration, both ticket surfaces; no `security`, `content`, `kanban` |
| `CALIBRATOR ADMIN` | operations, quality, kanban, both ticket surfaces |
| `ENGINEERING MANAGER` | read across operations and quality; kanban and tickets |
| `SUPERVISOR` | dashboard, warehouse, equipment (read); kanban; tickets |
| `TECHNICIAN` | dashboard, warehouse, equipment (read); kanban; raise tickets |
| `WAREHOUSE STAFF` | **warehouse (write)**, equipment (read); raise tickets |
| `ROOM USER`, `USER` | dashboard, warehouse, equipment (read); raise tickets |

`WAREHOUSE STAFF` at level 4 holds write where `SUPERVISOR` at level 6 holds read. Level orders privilege escalation, not scope.

Full matrix: [`../PLAN/03-USER-ROLES.md`](../PLAN/03-USER-ROLES.md).

## Local Component Placement

```
src/app/dashboard/<domain>/
├── page.tsx
├── components/     local to this domain
└── hooks/          local to this domain
```

Only genuinely shared UI is promoted to `src/components/`. This keeps a domain deletable and stops `src/components/` becoming a landfill.

## Navigation Behaviour

| Element | Behaviour |
|---|---|
| Sidebar | from the resolved menu tree; collapsible; current section marked |
| Breadcrumb | on nested routes (`/dashboard/tenants/[tenantId]`, `/kanban/[projectId]`) |
| Command palette | global search over `/api/v1/search` |
| Notification bell | live count from Socket.IO |
| Theme toggle | persisted, applied before paint |
| Tenant branding | logo and name in the chrome |

## Reaching a Route You Cannot Use

`AccessDeniedModal` covers the cases the menu tree cannot: a stale menu, a permission revoked mid-session, a bookmarked URL.

It explains rather than merely refusing, and it offers a way back. A dead end is worse than a refusal.

The backend refuses independently regardless — the menu tree is navigation, not enforcement.

## Deep Linking

Every list row links to a stable URL. Every notification carries an `actionUrl` pointing at the screen where the thing can be dealt with.

A notification that says something happened without linking to it makes the user search for it, which is how notifications get ignored.

## What Is Deliberately Not in the Navigation

| Absent | Why |
|---|---|
| A separate admin app | the admin surface is role-gated inside the same app |
| A settings mega-menu | settings live with the thing they configure |
| Nested menus beyond two levels | `menu_groups` supports a tree; the UI does not use its depth |
| An "all modules" index | 33 modules listed flat is a directory, not navigation |
