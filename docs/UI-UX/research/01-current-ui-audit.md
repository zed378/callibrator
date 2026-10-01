# Research 01: Current Admin Dashboard UI Audit, Menu by Menu

**Date:** 2026-09-29 · **Type:** expert review (heuristic evaluation and design-system audit) of the code as it stands. **No users were studied and the app was not run.** · **Status:** input to the enterprise-dense redesign. It is not a decision. Anything it implies for `docs/` goes through an ADR (the deviation protocol in `CLAUDE.md`).

**Owner direction this audit measures against:** enterprise-dense (SAP/ServiceNow-like); a collapsible sidebar grouped by domain; comfortable density with a compact toggle; a home page per role; a neutral palette plus one accent (the tenant brand) in light and dark; the existing design system (Tailwind 4 and `frontend/src/components/ui/*`) kept and tidied; desktop first with tablets usable; WCAG 2.1 AA; Indonesian and English.

**Read with:** [`02-standards-and-benchmarks.md`](./02-standards-and-benchmarks.md) (the external yardstick), [`../00-DESIGN-DIRECTION.md`](../00-DESIGN-DIRECTION.md), [`../02-INFORMATION-ARCHITECTURE.md`](../02-INFORMATION-ARCHITECTURE.md), [`../06-DESIGN-SYSTEM.md`](../06-DESIGN-SYSTEM.md), [`../11-DASHBOARD-UX.md`](../11-DASHBOARD-UX.md), [`../17-ACCESSIBILITY.md`](../17-ACCESSIBILITY.md), [`../../FRONTEND/00-FRONTEND-STANDARDS.md`](../../FRONTEND/00-FRONTEND-STANDARDS.md), and ADR-090 and ADR-071 in [`../../../MEMORY/DECISIONS.md`](../../../MEMORY/DECISIONS.md).

---

## 0. Method, and How Far to Trust Each Claim

| What | How | Confidence |
|---|---|---|
| Menu tree, slugs, routes | read `backend/src/utils/seedMenuGroups.util.js` (tree), `backend/src/services/menuGroup.service.js` (`mapSlugToPath`, `getRoleMenuAssignments`) | **high** |
| Which role sees which menu | computed from `ROLE_MENU_ASSIGNMENTS` in `backend/src/constants/roleConstants.ts` (the default grants the boot assertion checks) with the sidebar's cascade rule (a grant on a node shows every descendant). The legacy `seedRoleMenuPermissions()` list in the seed file is a fallback and was not used | **high** for seeded defaults. A tenant can change grants in the permissions screens, so a live tenant may differ |
| Page behaviour | read every `page.tsx` under `frontend/src/app/dashboard/**` with its `components/` and `hooks/` (59 page files in 50 domain folders, about 40,000 lines). The large domains (home, devices, calibration, stock, users, tenants, QMS, e-signature, kanban, permissions) were read in full; the rest by structure plus targeted reads. Counts in §4–§6 come from scripted scans of the source (kept in the session scratchpad, not the repo) | **high** for what the code renders; **medium** for runtime feel (spacing, overflow, real data length) |
| Design system | read all of `frontend/src/components/ui/*` and `frontend/src/app/globals.css` | **high** |
| Screenshots | **not taken.** Running the dashboard needs the Next proxy, a backend, a seeded PostgreSQL 18 and a session (ADR-090's sweep built that stack). Other agents were editing frontend code at the same time, so a build could not be tied to a stable tree. `docs/UI-UX/research/screens/` was not created | the visual claims below are read from class names, not seen. **Verify the top findings in a browser before quoting them to users** |

**Severity scale (Nielsen):** 0 not a problem · 1 cosmetic · 2 minor · 3 major (fix before the redesign ships) · 4 catastrophic (fix now, independent of the redesign).

**Page rating:** 1–5 for fitness against the ten heuristics and the owner's direction together (5 = could ship in the new system with restyling only; 1 = needs rework of behaviour, not just look).

**What this audit cannot tell you:** whether real users stumble where the heuristics predict. §9 lists what to test with people.

---

## 1. Summary

The dashboard is **one visual family with many dialects**. The primitives are sound and, since ADR-090 and F-12, unusually accessible for a codebase this size: tokens pass contrast in both themes, dialogs trap focus, labels are wired. What is missing is the **enterprise layer above the primitives** (data grid, filter bar, page header, tabs, detail view, density, app shell) and **one information architecture** that matches the domains people work in.

Five things matter most:

1. **The menu is not grouped by domain.** A catch-all *Management* group holds 27 of 46 leaves in three levels (the IA document says the UI never goes beyond two). Daily work (kanban, tickets, e-signatures) sits two levels down inside *Management*; personal settings are split across *Account*, *Security* and an unlisted page; the entire stock module (`/dashboard/stock`: inventory, transfers, adjustments, opname) **has no menu entry at all**.
2. **The menu shows doors the server refuses.** The sidebar cascades a grant to every descendant; the API checks a slug and its **parent only** (`roles.service.ts` ~L561). A grant on `management` therefore shows grandchildren the API denies. And about two thirds of pages show create/edit buttons to read-only roles; the user finds out at submit.
3. **Destructive and irreversible actions have no confirmation on several screens:** tenant backup **Restore** and **Delete**, e-signature **key-pair** and **workflow** delete, usage-alert delete, CIDR removal. Elsewhere there are five different confirmation patterns.
4. **Lists are built three ways and paged three ways.** The shared `Table` is used on 34 screens, a raw `<table>` on 5, card lists on others; pagination is the shared `Pagination` (18 files), ad-hoc Previous/Next (8), or absent (13 list screens). No list sorts, none keeps state in the URL, only notifications has bulk selection, and a failed load usually renders **an error banner above "No items found"**, which is the lie `06-DESIGN-SYSTEM.md` forbids.
5. **Home is one page for everyone.** A greeting hero with a bouncing emoji, eight animated tiles in a fixed order (overdue is sixth), no tile links anywhere, admin-only quick actions (Add User, New Tenant, Roles) shown to a technician, and a "Recent Activity" panel that lists users with the time hard-coded as "Recently".

The owner's direction is reachable from here without a rewrite: the tokens, `Dialog`, `FormField`, `Badge` and `useModalA11y` are the right foundations. Density, i18n, and the shell need building.

---

## 2. The Shell

### 2.1 Structure as built

| Piece | File | Behaviour |
|---|---|---|
| App shell | `frontend/src/components/layouts/DashboardLayout.tsx` | **Every page wraps itself** in `<DashboardLayout>`; there is no `app/dashboard/layout.tsx`. The shell therefore remounts on each navigation: the sub-group expansion state and the sidebar scroll position are lost |
| Sidebar | `frontend/src/components/layouts/Sidebar.tsx` | Fixed `w-72` (288 px), always open at ≥1024 px, off-canvas below. **Not collapsible to a rail.** Groups expand and collapse; state is not persisted. Up to three levels (group → sub-group → leaf) |
| Brand block | `Sidebar.tsx` | Hard-coded "HDC / Callibrator" and `BrandIcon` in `text-[#001250]`. **The tenant's logo and name are not shown** (the IA document says they are); `TenantBrandingProvider` recolours `--primary` only |
| Top bar | `frontend/src/components/layouts/TopBar.tsx` | Title is literally "Dashboard" on every page except profile ("Account"). No breadcrumb, no page title, no tenant indicator, no user menu (the avatar is a picture, not a control; `UserDropdown.tsx` is used only by the public site). Global search, notification bell and theme toggle |
| Global search | `frontend/src/components/layouts/GlobalSearch.tsx` | Three entity types (devices, stock, certificates). Hidden below 640 px. No keyboard shortcut, no arrow-key navigation of results, no navigation to pages. **Choosing a result opens the list page, not the record** (`handleSelect` → `TYPE_CONFIG[type].href`) |
| Notification bell | `NotificationBell.tsx` | Live count over Socket.IO; "view all" goes to `/dashboard/notifications`, which five roles have no menu entry for |
| Access denied | `AccessDeniedModal` via `api/client.ts` | Raised only for a refused **mutation** (a refused read is left to the page). Re-resolves the menu |
| Logout | sidebar footer | Icon-only button with `title="Logout"` and no `aria-label` |

### 2.2 Shell issues

| # | Issue | Evidence | Sev |
|---|---|---|---|
| S1 | Sidebar cannot collapse to an icon rail; 288 px is permanently taken at 1024–1280 px, the tablet-landscape and small-laptop widths | `Sidebar.tsx` `w-72`; `DashboardLayout.tsx` `lg:ml-72` | 3 |
| S2 | No page title or breadcrumb in the chrome. The top bar says "Dashboard" on 57 screens, so the only orientation is the sidebar highlight, and nested routes (`/tenants/[id]/backup`, `/kanban/[id]`, `/tickets/[id]`) have no path back | `TopBar.tsx` `currentPage` | 3 |
| S3 | No tenant context in the chrome. A super admin working across tenants, or an impersonator, sees the tenant name only in the home hero chip | `TopBar.tsx`, `Sidebar.tsx` | 3 |
| S4 | Shell remounts per page (no route-group layout), so sub-group expansion resets and the sidebar jumps | `DashboardLayout` imported by 57 pages; no `app/dashboard/layout.tsx` | 2 |
| S5 | Sidebar group buttons have no `aria-expanded`; active links have no `aria-current="page"` | `Sidebar.tsx` (0 occurrences of either) | 2 |
| S6 | Global search opens a list, not the record it found | `GlobalSearch.tsx` `handleSelect` | 3 |
| S7 | "Home" links to `/`, the public marketing page | `menuGroup.service.js` `mapSlugToPath` (`home: "/"`) | 2 |
| S8 | Menu while loading or on error: the sidebar shows only the "MENU" caption; the error banner is inside `<main>` | `DashboardLayout.tsx` | 1 |
| S9 | Brand colour and logo are hard-coded in the sidebar; tenant branding cannot reach identity | `Sidebar.tsx` `text-[#001250]` | 2 |

---

## 3. Menu Inventory

### 3.1 The seeded tree

60 `menu_groups` rows: **7 top-level groups**, **7 sub-groups** under *Management*, **46 leaves**. With the three top-level entries that are themselves links (Home, Dashboard, Warehouse), the sidebar can show **49 destinations**; 48 of them are dashboard routes (Home goes to `/`).

Role abbreviations: **SA** SUPERADMIN · **HA** HEALTHCARE ADMIN (Admin Faskes) · **CA** CALIBRATOR ADMIN (Admin Kalibrator) · **EM** ENGINEERING MANAGER · **SV** SUPERVISOR · **TE** TECHNICIAN · **HT** HEALTHCARE TECHNICIAN · **FM** FACILITY MAINTENANCE (IPSRS) · **WS** WAREHOUSE STAFF · **RU** ROOM USER · **US** USER.

Cell legend: **W** / **R** explicit write/read grant on that slug · **w** / **r** inherited from an ancestor's grant (shown in the sidebar; **see §3.3: the API may refuse these**) · **·** not shown.

| Group | Menu (label) | Route | Purpose (as the page states it) | SA | HA | CA | EM | SV | TE | HT | FM | WS | RU | US | Main entities · actions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | Home | `/` | public landing page | R | R | R | R | R | R | R | R | R | R | R | — |
| — | Dashboard | `/dashboard` | overview figures | R | R | R | R | R | R | R | · | · | R | R | metrics · refresh |
| — | Warehouse | `/dashboard/warehouses` (alias of `/warehouse`) | depots, sub-locations | W | W | R | R | R | R | R | R | W | R | R | warehouse, location · create, edit, delete |
| Account | Change Password | `/dashboard/change-password` | change own password | w | w | w | r | r | · | · | · | · | · | r | password · change |
| Account | Profile | `/dashboard/profile` | own profile, photo | W | W | W | W | W | W | W | W | W | W | W | user (self) · edit, upload photo |
| Account | Notifications | `/dashboard/notifications` | notification inbox | w | w | w | r | r | · | · | · | · | · | r | notification · read, mark read, delete, bulk delete, send test |
| Management › Organization | Tenants | `/dashboard/tenants` | tenant workspaces | w | w | w | r | · | · | · | · | · | · | · | tenant · create, edit, delete, SSO (SAML), MFA policy, backups |
| Management › Organization | Tenant Hierarchy | `/dashboard/tenant-hierarchy` | position in tenant tree, business units | W | R | w | r | · | · | · | · | · | · | · | tenant tree · add unit, move tenant |
| Management › Organization | Tenant Lifecycle | `/dashboard/tenant-lifecycle` | suspend, resume, grace, offboard | W | R | R | r | · | · | · | · | · | · | · | tenant state · suspend, offboard |
| Management › Organization | Users | `/dashboard/users` | tenant users | w | W | W | r | · | · | · | · | · | · | · | user · create, edit, delete, reset credentials |
| Management › Organization | Roles | `/dashboard/roles` | roles | w | w | w | r | · | · | · | · | · | · | · | role · create, edit, delete |
| Management › Organization | Menu Group Assignment | `/dashboard/menu-groups` | which menus a role has | w | w | w | r | · | · | · | · | · | · | · | menu group, role assignment · CRUD, bulk assign |
| Management › Work & Projects | Kanban Boards | `/dashboard/kanban` | project boards | w | w | W | W | W | W | · | · | · | · | · | board, card, sprint · CRUD, drag, migrate |
| Management › Work & Projects | Approval Workflows | `/dashboard/workflows` | approval chains and my tasks | W | W | W | R | · | · | · | · | · | · | · | workflow, step · create, delete, approve |
| Management › Work & Projects | Background Jobs | `/dashboard/batch-jobs` | long-running imports/exports | W | R | R | r | · | · | · | · | · | · | · | job · queue test job, watch progress |
| Management › Work & Projects | Raise a Ticket | `/dashboard/tickets/raise` | raise support tickets | w | W | W | W | W | W | W | W | W | W | W | ticket · create, view |
| Management › Work & Projects | Ticket Response | `/dashboard/tickets/response` | answer the support queue | W | W | W | W | W | · | · | · | · | · | · | ticket · reply, change status |
| Management › Quality & Compliance | Quality (NC & CAPA) | `/dashboard/qms` | non-conformances, CAPA | W | W | W | R | · | · | · | · | · | · | · | NC, CAPA · raise, update status |
| Management › Quality & Compliance | SOP Documents | `/dashboard/sop` | controlled procedures | W | W | W | R | · | · | · | · | · | · | · | SOP · draft, publish |
| Management › Quality & Compliance | Risk Register | `/dashboard/risk` | ISO 14971 risks, RPN | W | W | W | R | · | · | · | · | · | · | · | risk · add, edit, delete |
| Management › Quality & Compliance | Audit Logs | `/dashboard/audit` | audit trail | w | R | R | r | · | · | · | · | · | · | · | audit log · filter, expand |
| Management › Quality & Compliance | Data Retention | `/dashboard/data-retention` | retention windows, legal hold, purge | W | R | R | r | · | · | · | · | · | · | · | policy, hold · enable hold, purge |
| Management › Quality & Compliance | E-Signatures | `/dashboard/esignature` | Part 11 signing workflows, key pairs | W | W | W | W | W | W | W | W | · | · | · | workflow, key pair, signature · create, sign, verify, delete |
| Management › Quality & Compliance | AI Assistant | `/dashboard/ai-assistant` | ask SOPs, OCR certificates | R | R | R | R | · | · | · | · | · | · | · | query, OCR |
| Management › Finance & Billing | Billing | `/dashboard/billing` | subscription, invoices | w | R | R | r | · | · | · | · | · | · | · | subscription, invoice · edit (SA) |
| Management › Finance & Billing | Asset Finance | `/dashboard/finance` | cost, depreciation per device | W | R | R | R | · | · | · | · | · | · | · | asset record · record, delete |
| Management › Finance & Billing | Usage & Metering | `/dashboard/metered-billing` | usage vs plan, alerts | W | W | W | r | · | · | · | · | · | · | · | usage, alert · create, delete |
| Management › Partners | Vendors | `/dashboard/vendors` | labs, suppliers, service partners | w | W | W | R | · | · | · | · | · | · | · | vendor · CRUD, approve, reject |
| Management › Partners | Supplier Scorecards | `/dashboard/supplier-scorecard` | vendor evaluations | W | W | R | R | · | · | · | · | · | · | · | evaluation · add, delete |
| Management › Developer | API Keys | `/dashboard/api-keys` | integration keys | w | w | w | r | · | · | · | · | · | · | · | API key · create, revoke |
| Management › Developer | Webhooks | `/dashboard/webhooks` | outbound events | w | w | w | r | · | · | · | · | · | · | · | webhook, delivery · CRUD, test, rotate secret |
| Management › Developer | Feature Flags | `/dashboard/feature-flags` | capabilities per tenant | W | R | R | r | · | · | · | · | · | · | · | flag · toggle |
| Management › Content | Blog & News | `/dashboard/content` (+ `/new`, `/[id]/edit`) | public marketing content | W | w | w | r | · | · | · | · | · | · | · | post, category · CRUD, publish |
| Management › Content | Files & Documents | `/dashboard/attachments` | tenant files and evidence | w | w | w | r | · | · | · | · | · | · | · | attachment · upload, download, delete |
| Security | Role Permissions | `/dashboard/permissions` | read/write per menu per role | w | · | · | · | · | · | · | · | · | · | · | role × menu matrix · set |
| Security | OIDC Provider | `/dashboard/oidc` | this platform as IdP | W | R | · | · | · | · | · | · | · | · | · | OIDC client · register, delete |
| Security | User Permissions | `/dashboard/user-permissions` | per-user menu overrides | w | · | · | · | · | · | · | · | · | · | · | user × menu · grant, deny |
| Security | WebAuthn | `/dashboard/webauthn` | **own** passkeys | W | R | · | · | · | · | · | · | · | · | · | passkey · add, remove |
| Security | Session Management | `/dashboard/session-management` | **own** sessions | w | · | · | · | · | · | · | · | · | · | · | session · revoke, delete |
| Security | Network Security | `/dashboard/network-security` | IP allowlist, geofence | W | R | · | · | · | · | · | · | · | · | · | CIDR, geofence · add, remove, test |
| Security | SCIM Provisioning | `/dashboard/scim` | IdP-synced users and groups | W | R | · | · | · | · | · | · | · | · | · | SCIM user/group · view, map |
| Security | Privacy & GDPR | `/dashboard/gdpr` | **own** data-subject rights | W | R | · | · | · | · | · | · | · | · | · | consent, request · export, erase, correct, restrict |
| Security | Custom Domains | `/dashboard/custom-domains` | own hostname | W | R | · | · | · | · | · | · | · | · | · | domain · add, verify, remove |
| Equipment | Calibration Devices | `/dashboard/devices` | device register | w | w | w | r | r | r | r | r | r | r | r | device · CRUD, CSV import, IoT token, tolerance |
| Equipment | Calibration & Certificates | `/dashboard/calibration` | records and certificates | w | w | w | r | r | r | r | r | r | r | r | record, certificate · record, draft, approve, sign, revoke, PDF |
| Equipment | Maintenance | `/dashboard/maintenance` | work orders | w | w | w | r | r | r | r | r | r | r | r | work order · CRUD |
| Equipment | Calibration Scheduler | `/dashboard/calibration-scheduler` | what is due; generate work orders | w | w | w | r | r | r | r | r | r | r | r | due device · run scheduler |
| Equipment | Reports | `/dashboard/reports` | compliance, workload, overdue, inventory | w | w | w | r | r | r | r | r | r | r | r | report · filter, export |
| Equipment | Predictive Maintenance | `/dashboard/predictive-maintenance` | interval recommendations | W | R | W | R | r | r | r | r | r | r | r | recommendation · run analysis, approve |

**Routes with no menu entry**

| Route | What it is | How a user reaches it | Sev |
|---|---|---|---|
| `/dashboard/stock` | **the whole inventory module**: current stock, inter-depot transfers, adjustments, opname, reports | only through a global-search result (`GlobalSearch.tsx`) or a typed URL. Neither the Warehouse page nor any menu links to it | **4** |
| `/dashboard/storage` | bring-your-own object storage (tenant files) | typed URL only | 3 |
| `/dashboard/mfa` | own TOTP enrolment | only the forced redirect when a tenant requires MFA (`api/client.ts` `MFA_PATH`); not linked from Profile | 3 |
| `/dashboard/tickets/[ticketId]`, `/kanban/[projectId]`, `/kanban/[projectId]/dashboard`, `/tenants/[tenantId]/backup`, `/content/new`, `/content/[id]/edit` | detail and sub-pages | from their list page; no breadcrumb back | 2 |
| `/dashboard/tickets`, `/dashboard/warehouse` | aliases (redirect / re-export) | — | 0 |

### 3.2 What each role actually gets (seeded defaults)

| Role | Sidebar shape | Observations |
|---|---|---|
| SUPERADMIN | 7 groups, 48 destinations | everything but Raise a Ticket (by design, BR-13) |
| HEALTHCARE ADMIN | Home, Dashboard, Warehouse, Account (3), Management (27 across 7 sub-groups), Equipment (6), Security (6) | sees Blog & News, Menu Group Assignment, Roles, Tenants, API Keys, Webhooks, Files, Kanban **by cascade only** (§3.3). The IA document says HA has "no `security`, `content`, `kanban`" |
| CALIBRATOR ADMIN | as HA without the Security group | the same cascade exposure |
| ENGINEERING MANAGER | read nearly everything | every Management leaf visible, most by cascade; write buttons shown on most of them (§5.4) |
| SUPERVISOR | Home, Dashboard, Warehouse, Account, Management › Work (3), Management › Quality › E-Signatures, Equipment (6) | reaches kanban, ticket queues and signing **three clicks deep inside "Management"** |
| TECHNICIAN | Home, Dashboard, Warehouse, **Account › Profile only**, Management › Work (Kanban, Raise a Ticket), Management › Quality › E-Signatures, Equipment (6) | no Change Password, no Notifications page, no passkeys, no GDPR self-service |
| HEALTHCARE TECHNICIAN | as TE without Kanban | same gaps |
| FACILITY MAINTENANCE | Home, Warehouse, Account › Profile, Management › Work › Raise a Ticket, Management › Quality › E-Signatures, Equipment (6) | no Dashboard grant, yet login lands every role on `/dashboard` (`login` pushes `/dashboard`) |
| WAREHOUSE STAFF | Home, Warehouse (write), Account › Profile, Management › Work › Raise a Ticket, Equipment (6) | **the warehouse role cannot see Stock**; its write grant is on a page that configures depots, not on the stock it moves |
| ROOM USER | as WS with Dashboard, read-only Warehouse | — |
| USER | Home, Dashboard, Warehouse, Account (3), Management › Work › Raise a Ticket, Equipment (6) | documented as "profile only" in `ROLE_LEVELS`; sees the full equipment register |

### 3.3 Sidebar visibility is not access

`menuGroup.service.js#getRoleMenuAssignments` shows a node when it **or any ancestor** is granted. The server's permission check (`roles.service.ts`, around line 561) looks at the route's slug **and its parent only**. For a leaf two levels below a grant (every lower-case cell under *Management* in §3.1), the link appears but a route gated by `dynamicAccess(<slug>)` refuses it. A refused read renders as the page's own error banner; a refused write raises `AccessDeniedModal`. `roleConstants.ts` records this for four slugs (Q-20, ADR-056) and fixed those by explicit grant; the rest of the lower-case cells were not checked route by route here. **Severity 3**; verify each lower-case cell live before the IA is redrawn, because the redraw will move these nodes anyway.

### 3.4 IA issues

| # | Issue | Evidence | Sev |
|---|---|---|---|
| IA1 | Stock module unreachable from navigation | §3.1 | 4 |
| IA2 | *Management* is a catch-all of 27 leaves across 7 sub-groups mixing daily work (Kanban, tickets), compliance (QMS, SOP, e-signature), commercial, developer and marketing content. The owner's "grouped by domain" is not met | seed file | 3 |
| IA3 | Three menu levels, contrary to `02-INFORMATION-ARCHITECTURE.md` ("nested menus beyond two levels" deliberately absent). A technician's daily Kanban is Management › Work & Projects › Kanban Boards | seed file | 3 |
| IA4 | Personal settings are scattered: Profile/Password/Notifications under *Account*; Passkeys, Sessions and GDPR rights ("every action here applies to your own account") under the admin *Security* group and granted to SA/HA only; MFA unlisted. Most users cannot find their own passkeys, sessions or data-subject rights | §3.1, page subtitles | 3 |
| IA5 | Labels and routes are crossed: slug `calibration` → `/devices` ("Calibration Devices"), slug `certificate` → `/calibration` ("Calibration & Certificates"), and that page's `<h1>` is "Compliance & Quality Control" | `mapSlugToPath`, `calibration/page.tsx` | 2 |
| IA6 | Menu label ≠ page title on 9 screens: Warehouse / "Warehouse Management", Tenants / "Tenants Management", Role Permissions / "Permissions", Menu Group Assignment / "Menu Groups Assignment", Profile / "Profile Settings", E-Signatures / "e-Signature", WebAuthn / "Passkeys", Users / "Users Management", Calibration & Certificates / "Compliance & Quality Control" | §4 | 2 |
| IA7 | Duplicate `sortOrder` in *Security*: Role Permissions and OIDC are both 0, User Permissions and WebAuthn both 1, Sessions and Network Security both 2, so the order interleaves unrelated items | seed file | 1 |
| IA8 | Two screens govern the same thing: *Menu Group Assignment* (which menus a role has) and *Role Permissions* (read/write per menu per role), plus *User Permissions* on top | `menu-groups/`, `permissions/`, `user-permissions/` | 2 |
| IA9 | "Audit" means three things: Audit Logs (trail), "Audit Stock" button and "Physical Counts (Audits)" tab (opname). The design direction says **opname** is the term users use | `stock/page.tsx` | 2 |

---

## 4. Page-by-Page Audit

Legend for the list columns. **Tbl:** `ui` shared `Table` · `raw` hand-written `<table>` · `card` card rows · `board`. **Pg:** `P` shared `Pagination` · `pn` ad-hoc Previous/Next · `—` none. **States (L/E/F):** loading / empty / failed; `sk` skeleton, `sp` spinner, `msg` text, `A` error `Alert` banner, `ES` `ErrorState`, `T` toast only. **Dlg:** `D` shared `Dialog`, `CD` `ConfirmDialog`, `X` hand-built overlay (uses `useModalA11y`, looks different). **W-gate:** write actions hidden from read-only roles (✓) or not (✗). Every page: English literals only, dates via `toLocaleDateString()` with no locale argument, no sorting, no URL state, `<h1>` present.

### 4.1 Top level and Account

| Page | Pattern | List (search · filter · Pg · bulk) | States L/E/F | Forms / Dlg | Primary action | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Home** `page.tsx`, `components/*` | dashboard | — | sk / msg / A | — | none (quick-action grid) | tiles use status colours decoratively (success for "Pending Transfers", warning for "Settings", destructive for "View Site") | ✗ | **2** | Not role-specific: only SA-vs-rest differs (`DashboardStats.tsx`) (3). Overdue is tile 6 of 8, none of the tiles link to a filtered list though `StatCard` has `cursor-pointer` (3). Quick actions Add User / New Tenant / Roles shown to every role (`DashboardQuickActions.tsx`) (3). "Recent Activity" is `fetchUsers()` rendered with `time="Recently"` (`DashboardCharts.tsx`) (3). Hero: `text-5xl` greeting, `animate-bounce` 👋, grid background, staggered tile entrance via `setTimeout`, contrary to "the dashboard may not spend anything on impression" (2). No "awaiting your action" queue (3) |
| **Profile** `profile/` | form | — | sp / — / T | inline fields | save (in form), photo upload | — | n/a | 3 | No links to Change Password, MFA, passkeys or sessions (3, IA4). Error only by toast/inline success, two feedback styles (1) |
| **Change Password** `change-password/` | form | — | — / — / A | live checklist | Change password | — | n/a | 4 | Not in the menu for TE/HT/FM/WS/RU (2) |
| **Notifications** `notifications/` | list | — · filter · P · **✓ select, bulk delete** | sk / msg / A | CD | none; "Send test" (secondary) | toLocaleString | n/a | 3 | Only list in the product with bulk selection (good, but unique). "Send test" is a developer control on an end-user inbox (2). No link from a notification to its record in the list view to check live (see `actionUrl`, IA doc) |

### 4.2 Equipment

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Calibration Devices** `devices/` | list | search · category (free-text) · status · P | sk / msg / **A + "No devices found"** | D (grid 2–3 cols), custom delete modal | Add Device (+ Import CSV) | Badge; next calibration shown as a plain date | ✓ | **3** | **Next calibration shows no overdue/due-soon state**; `06-DESIGN-SYSTEM.md` says it is computed at render (3). A failed load shows the error banner and "No devices found" together (3). Search and filters are placeholder-only fields (no label) (2). Category filter is free text while status is a select (1). No device detail page; nothing deep-links to a device (3). Delete dialog does not name the device (2). 9 columns at `px-6 py-4` force horizontal scroll below ~1400 px content width (2) |
| **Calibration & Certificates** `calibration/` | list + tabs | Records: device · compliance · P. Certificates: number · status · P | sk / msg / A | D ×5 (record, draft, approve, sign, revoke) | Record Calibration | Badge map draft→secondary, pending→warning, approved→info, signed→success, revoked→danger | ✓ | **3** | **The calibration record is entered in a 512 px modal** (`RecordCalibrationModal.tsx`, `Dialog` default `lg`), with three numeric fields side by side and labels in `uppercase text-xs` (3). `00-DESIGN-DIRECTION.md`: "spacious where entering data that must be right". Device picker lists only the page of devices already fetched (`devices?.data`) (3, verify). Tabs are plain buttons without `role="tab"` and not in the URL (2). Title mismatch (IA5) (2). Certificate actions are status-dependent buttons (good) but no certificate detail view, so the three attributions (calibrated / approved / signed by) required by `06-DESIGN-SYSTEM.md` have nowhere to live (3) |
| **Maintenance** `maintenance/` | list | search · status · P | sk / msg / A | D, custom delete modal | New Work Order | "In Progress" = warning, "High" priority = danger, Critical = danger | ✓ | 3 | Warning colour used for a normal in-flight state dilutes "due soon" (2). No due date column; no status-transition affordance in the row (2) |
| **Calibration Scheduler** `calibration-scheduler/` | list + control panel | lead-days · all-tenants (SA) · — | sk / — / A | — | Run Scheduler | Overdue = danger, Due soon = warning (the only screen computing it) | ✓ | 3 | No pagination on a list that grows with the fleet (2). The one screen that computes overdue is not linked from Home's overdue tile (3, see Home) |
| **Reports** `reports/` | report sections (cards + small tables) | date range · Apply · export per section | sk (cards) / msg / A | — | Apply | 8 KPI cards, `toLocaleDateString` ×9 | n/a | 3 | Card-heavy layout for a data screen; KPI cards duplicate Home's (2). `text-3xl font-extrabold` title differs from most pages (1) |
| **Predictive Maintenance** `predictive-maintenance/` | list | — · — · — | — / msg / A | — | Run Analysis | Badge | ✗ | 3 | Approve shown to read-only roles (HA, EM have R) (3, §5.4) |

### 4.3 Warehouse (and the unlisted Stock)

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Warehouse** `warehouse/` (served at `/warehouses`) | list + nested locations | search · P | sk / msg / A | D, custom delete modal | Add Warehouse | Badge | ✓ | 3 | Vocabulary drifts: "Depots", "Storage Shelves / Rooms", "sub-locations" (2). No link to the stock held in a warehouse (3, IA1) |
| **Stock** `stock/` (**no menu entry**) | list + 5 tabs | search · warehouse · location · P (+ page size) | sk / msg / A | D ×4 (stock, adjustment, transfer, opname) | Add Inventory (+ New Transfer, Audit Stock) | Badge; transfers pending/in_transit/completed | ✓ | **3 (unreachable: 4)** | Unreachable (4, IA1). Tabs are buttons, not in the URL (2). Opname called "Physical Counts (Audits)" and "Audit Stock" (2, IA9) |

### 4.4 Management › Organization

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Tenants** `tenants/` | **card grid** + stats | search · P | sp / msg / A | **X** (create, edit, delete, SSO) | Create Tenant | Badge | ✗ | **2** | An admin register rendered as a two-column card grid, not a table: no scanning, no sorting, 2 per row (3). SSO SAML and MFA policy are panels reached from a card, not settings sections (2). Four hand-built overlays with their own headers and a `bg-black/50` scrim vs `Dialog`'s `/60` blur (1). "Configure and manage multitenant workspace environments" is platform jargon on a page HA/CA reach (1) |
| **Tenant backup** `tenants/[tenantId]/backup/` | list | P | sp / msg / A | X (create) | Create Backup | — | ✗ | **1** | **Restore and Delete run on one click with no confirmation** (`BackupList.tsx` → `useTenantBackups.ts` `handleRestoreBackup`, `handleDeleteBackup`) (**4**). No breadcrumb back to the tenant (2) |
| **Tenant Hierarchy** `tenant-hierarchy/` | tree + tables | — | — / msg / A | D (add unit, move) | Create | — | ✗ | 3 | Move/Add shown to HA (R) (3, §5.4) |
| **Tenant Lifecycle** `tenant-lifecycle/` | state panel | — | — / — / A | D (suspend, offboard) | per state | — | ✗ | 3 | Destructive state changes are dialog-confirmed (good); buttons shown to HA/CA (R) (3) |
| **Users** `users/` | list + stats | search · P (+ page size) | sk / card msg / A (title **and** body both = the error) | **X** (create, edit), inline row confirm | Add User | Badge by status | ✗ (menu-gated) | 3 | **Stats "Active / Suspended / Pending" count the current page only**, next to "Total Users" from `meta.total` (`StatsCards.tsx`) (3, P3 "never fake certainty"). Raw `<table>` (`UserTable.tsx`) instead of `Table` (2). Delete confirm is inline in the row (third pattern) (2). Button says "Add User", dialog says "Create User" (1) |
| **Roles** `roles/` | list + stats | search · P | sk / msg / A | **X** (edit, delete) | Add Role (dialog says "Create Role") | — | ✗ | 3 | Raw `<table>` (2). Hand-built overlays (1) |
| **Menu Group Assignment** `menu-groups/` (15 files) | role picker + card list + bulk bar | role · — | sp / — / local toast | D, custom delete | per action | assignment badges | ✓ | **2** | **Its own toast component** (`menu-groups/components/ToastNotification.tsx`) with no `role="status"`/`alert`, positioned over the global one (2). Overlaps Role Permissions (IA8) (2). Title "Menu Groups Assignment" (1) |

### 4.5 Management › Work & Projects

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Kanban Boards** `kanban/` (14 files, 2,945 lines) | board list → board → analytics | — | sp / msg / A | D, CD, X | Create Board | priority colours | ✓ | 3 | **No keyboard way to move a card between columns**: drag only (`BoardColumn.tsx`, `CardTile.tsx`); the card modal offers priority and sprint, not column. `17-ACCESSIBILITY.md` requires it (3, WCAG 2.1.1). |
| **Approval Workflows** `workflows/` | list + tabs | — · — · — | — / msg / A | D | Create Workflow | Badge | ✗ | 3 | Remove-step has no undo inside the form (1). Create shown to EM (R) (3) |
| **Background Jobs** `batch-jobs/` | list (polling) | — · pn | — / msg / A | D | **Queue Test Job** | Badge | ✗ | **2** | The page's primary action is a developer test (2). Shown writable to HA/CA (R) (3) |
| **Raise a Ticket** `tickets/raise/` | **card rows** | search · status · — | sp / msg / A | D | Raise a ticket | custom `StatusBadge`, `PriorityBadge` | ✓ | 3 | Card-row list (fourth list pattern) (2). No pagination (2) |
| **Ticket Response** `tickets/response/` | card rows | search · status · tenant · — | sp / "Queue is clear" / A | — | — | as above | ✓ | 3 | As above |
| **Ticket detail** `tickets/[ticketId]/` | detail + thread | — | sp / — / A | CD | Reply | as above | ✓ | 3 | Back button, no breadcrumb (1) |

### 4.6 Management › Quality & Compliance

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Quality (NC & CAPA)** `qms/` | list + tabs | status · **pn** | sp / msg / **A + "No non-conformances recorded."** | D (`FormField`) | Raise NC / New CAPA (switches with tab) | enum shown as `UNDER_INVESTIGATION`→`replace("_"," ")` (first underscore only) | ✗ | 3 | Failed load reads as "No non-conformances recorded" under a banner (3). "Raise NC" shown to EM (R) (3). Ad-hoc pagination (2). Dialog content is `p-6` inside `Dialog`'s `p-6` (1) |
| **SOP Documents** `sop/` | list | status · pn | sp / msg / A | D | Create Draft | Badge | ✗ | 3 | Publish (assigns training to the whole tenant) confirmed in a dialog (good) |
| **Risk Register** `risk/` | list | search · — | sp / msg / A | D | Add Risk | RPN, Badge | ✗ | 3 | No pagination (2) |
| **Audit Logs** `audit/` | list, expandable rows | action · resource · date from/to · P | sk / msg / A | — | none | `toLocaleString()` | ✓ | 3 | Raw `<table>` (2). **No export** of the audit trail on the screen an inspector will ask for (21 CFR 11.10(b)) (3). No actor or record filter (2) |
| **Data Retention** `data-retention/` | settings sections | — | — / — / A | D | Enable Hold | — | ✗ | 3 | Purge is dialog-confirmed (good). Shown writable to HA/CA (R) (3) |
| **E-Signatures** `esignature/` (969 lines, one file) | 3 tabbed tables + dialogs | — | — / msg / **T only** | D | Create Workflow | Badge | ✗ | **2** | **Key pair and workflow delete have no confirmation** (`deleteKey`, `deleteWorkflow`) (**4** for keys: signatures verify against them). Load failures surface only as a toast, then "No key pairs yet" (3). Public key truncated to 40 chars (1) |
| **AI Assistant** `ai-assistant/` | chat + OCR form | — | — / — / T | — | Ask / Upload certificate | — | n/a | 3 | Errors only by toast (2) |

### 4.7 Management › Finance, Partners, Developer, Content

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Billing** `billing/` | cards + invoice table | P | sk / msg / A | inline edit (SA) | Save (SA) | amounts as `"IDR 1500000.00"` (`toFixed(2)`, no grouping) | ✓ | 3 | Currency formatting ignores locale (2) |
| **Asset Finance** `finance/` | list | pn | — / msg / A | D | **Record Asset** | numbers `toFixed` | ✗ | **2** | "Record Asset" shown to HA/CA/EM, all read-only; the form fails at submit (3) |
| **Usage & Metering** `metered-billing/` | sections + tables | pn | — / msg / A | D | Create Alert | — | ✗ | 3 | **Alert delete has no confirmation** (2) |
| **Vendors** `vendors/` | list | search · P | sk / msg / A | D, custom delete | Add Vendor | Badge; approve/reject icon buttons coloured `text-emerald-600` / `text-amber-600` | ✓ | 3 | Raw palette colours bypass the ADR-090 tokens; amber-600 is the shade ADR-090 measured below 4.5:1 (2). Approve/reject are icon-only with colour as the main cue (2) |
| **Supplier Scorecards** `supplier-scorecard/` | list | — | — / msg / A | D | Add evaluation | — | ✗ | 3 | Add shown to CA/EM (R) (3). No pagination (2) |
| **API Keys** `api-keys/` | list | P | sk / msg / A | D (secret shown once) | Create API Key | Badge | ✗ (menu-gated) | **4** | Good one-time-secret pattern |
| **Webhooks** `webhooks/` | list + deliveries panel | P | sk / msg / A | D, CD | Add Webhook | Badge, `font-mono` | ✗ (menu-gated) | **4** | The deliveries panel is an inline card below the table, not a side panel (1) |
| **Feature Flags** `feature-flags/` | list of toggles | — | — / msg / A | — | — | — | ✗ | 3 | Toggles shown to HA/CA (R) (3). Raw checkboxes (no `Switch`) (1) |
| **Blog & News** `content/` (+ new, edit) | list + full-page editor | search · pn | sp / msg / A | D (categories), inline confirm | New post | — | ✗ | 3 | Raw `<table>` (2). Icon buttons with `title` only (1). Category delete has no confirm (2). Reached by HA/CA by cascade only (§3.3) |
| **Files & Documents** `attachments/` | list | P | sk / msg / A | D, custom delete | Upload | — | ✗ | 3 | Reached by cascade (§3.3) |

### 4.8 Security

| Page | Pattern | List | States | Forms / Dlg | Primary | Status / format | W-gate | Rating | Issues (sev) |
|---|---|---|---|---|---|---|---|---|---|
| **Role Permissions** `permissions/` | master–detail (roles left, matrix right) | — | sp / msg / A | — | per-cell read/write buttons | — | ✓ (SA) | 3 | The one true master–detail in the product; a good seed for the split view. Changes apply per click with toast feedback, no batch save or undo (2) |
| **User Permissions** `user-permissions/` | master–detail | search | sp / msg / A | — | per cell | — | ✓ (SA) | 3 | Same pattern, same gap |
| **Session Management** `session-management/` | list + stats | search · own pagination component | sp / msg / **ES** | X | Refresh | Badge | n/a | 3 | Only page using `ErrorState` (good). Its own `SessionPagination` (2). Own sessions are a personal setting granted to SA only (3, IA4) |
| **OIDC Provider** `oidc/` | list | — | — / msg / A | D (secret once) | Register | — | ✗ | 3 | Register shown to HA (R) (3) |
| **WebAuthn** `webauthn/` | list | — | — / msg / A | D | Register This Device | — | n/a | 4 | Personal setting in an admin group (IA4) |
| **Network Security** `network-security/` | settings sections | — | — / msg / A | — | per section | — | ✗ | 3 | **CIDR removal has no confirmation**; removing the wrong range can lock the tenant out (3) |
| **SCIM Provisioning** `scim/` | tabs + tables | pn | — / msg / A | — | — | — | ✗ | 3 | — |
| **Privacy & GDPR** `gdpr/` | sections + tables | — | — / msg / A | D (erase, correct, restrict) | per right | — | n/a | 3 | Data-subject rights for **your own account** reachable only by SA/HA (3, IA4) |
| **Custom Domains** `custom-domains/` | list | — | — / msg / A | D | Add Domain | Badge | ✗ | 3 | Add shown to HA (R) (3) |

### 4.9 Unlisted

| Page | Rating | Issues (sev) |
|---|---|---|
| **MFA** `mfa/` | 4 | Reachable only when forced (IA4) (3) |
| **Storage** `storage/` | 2 | Unreachable (3). No error `Alert`; failures by toast (2) |

---

## 5. Cross-Cutting Inconsistencies

### 5.1 Lists

| Dimension | What exists | Count |
|---|---|---|
| Table implementation | shared `ui/Table` · raw `<table>` (`audit`, `users`, `roles`, `content`, home `TenantBreakdown`) · card rows (`tickets`, `tenants`) · board (`kanban`) | 34 files · 5 · 2 · 1 |
| Pagination | shared `Pagination` · ad-hoc Previous/Next (`batch-jobs`, `content`, `finance`, `metered-billing`, `qms`, `scim`, `sop`) · own component (`session-management`) · **none** (`calibration-scheduler`, `custom-domains`, `esignature`, `feature-flags`, `gdpr`, `oidc`, `predictive-maintenance`, `reports`, `risk`, `supplier-scorecard`, `tenant-hierarchy`, `workflows`, `tickets`) | 18 · 7 · 1 · 13 |
| Page size choice | only `stock`, `users` pass `onPageSizeChange` | 2 |
| Sorting | none anywhere; `Table` has no sort API | 0 |
| Bulk selection | `notifications` only (and `menu-groups` bulk assign) | 1–2 |
| URL state (filters, tab, page) | none (`useSearchParams` appears in 0 dashboard files) | 0 |
| Filter placement | in a `Card` above the table (devices, audit, qms), bare (users, tickets), in a `FormField` labelled "Filter by status" (qms), placeholder-only (devices) | ≥4 styles |
| Loading | `TableSkeleton` · `Table isLoading` spinner (`border-t-indigo-600`, a raw palette colour) · `CardSkeleton` · page spinner | 4 |
| Empty | `Table emptyMessage` · custom icon block · card | 3 |
| Failed | `Alert` banner above the (then empty) list · `ErrorState` (1 page) · toast only (`esignature`, verified; `storage`, `profile`, `mfa`, `ai-assistant` by pattern) | 3 |
| Row click | `Table onRowClick` puts a click handler on `<tr>`: not focusable, no keyboard activation | — |
| Row keys | `Table` keys rows by index | — |

The "failed" row is the important one. `06-DESIGN-SYSTEM.md` and the frontend standards call rendering an empty list after a failed request "a lie about a compliance figure", and "the single most important frontend rule in the product". On most list pages the failed state is a red banner **plus** the empty-state text beneath it.

### 5.2 Actions and dialogs

| Dimension | What exists |
|---|---|
| Overlay shells | shared `Dialog` (30 imports) · `ConfirmDialog` (6 files) · 11 hand-built `fixed inset-0` overlays in `tenants`, `users`, `roles`, `session-management`, `kanban` (all use `useModalA11y`, so the keyboard contract holds; they look different: `bg-black/50` vs `/60 backdrop-blur`, own headers and paddings) |
| Dialog sizes | default `lg` (512 px) for most forms; `xl` is the maximum (576 px). No drawer, no full-page form except content editing |
| Confirmation for destructive actions | **five patterns**: `ConfirmDialog`; a bespoke `Delete*Modal` per domain (10 files); inline "Confirm / Cancel" in the row (`users`, `content`); `Dialog` with custom copy; **none** (tenant backup restore/delete, e-signature key/workflow delete, metered alert delete, network CIDR remove, content category delete, kanban attachment/relation remove) |
| Cancel button style | `outline` 22 · `ghost` 15 · `secondary` 7 |
| Button order | Cancel then primary, right-aligned, almost everywhere (good). Exception: inline row confirm in `users/components/UserRow.tsx` puts Confirm first |
| Primary action placement | top-right of the page header on most pages (good); none on Home; a test action on Background Jobs; switches with the tab on QMS |
| Feedback | global `addToast` (41 domains) · inline success banner (`profile`, `change-password`, `tenants`) · `menu-groups` local toast · `ToastContainer` sets every toast `role="alert"` `aria-live="assertive"`, including successes |
| Write gating | 14 domains hide write actions from read-only roles; the others show them and rely on the 403 (§5.4) |

### 5.3 Visual grammar

| Dimension | What exists |
|---|---|
| Page title (`<h1>`) | four styles: `text-2xl font-bold tracking-tight` (most) · `text-2xl font-bold text-foreground` (users, roles, tenants, sessions, menu-groups, profile, change-password) · `text-3xl font-extrabold` (kanban, reports, stock, tickets, warehouse) · `text-xl font-semibold` (permissions, user-permissions); Home is `text-4xl lg:text-5xl`. `font-display` (Space Grotesk) is defined in `globals.css` and used by none of them |
| Subtitle | `text-sm text-muted-foreground` vs `text-muted-foreground mt-1` (base size) |
| Form labels | `FormField` (sentence case, `text-sm font-semibold`) in 21 domains · hand-written `uppercase text-xs tracking-wider` labels in 8 (`api-keys`, `attachments`, `calibration`, `devices`, `maintenance`, `menu-groups`, `vendors`, `webhooks`), contrary to "no all-caps" in `17-ACCESSIBILITY.md` · `Input label` (`text-sm font-medium`) · `DateField` label in `text-muted-foreground` |
| Required marker | `FormField` renders `*` in `text-primary`; hand-written labels type `*` into the label text; some required fields carry no marker (`RecordCalibrationModal` device select) |
| Status → colour | at least 12 local `getStatusBadge` maps. `warning` means "due soon", "in progress", "maintenance", "pending approval", "medium priority" and a Settings button; `danger` means "retired", "high priority" and "revoked". `00-DESIGN-DIRECTION.md` reserves alarm for overdue and non-conformant |
| Radius | `rounded-md` 17 · `rounded-lg` 64 · `rounded-xl` 84 · `rounded-2xl` 46 · `rounded-3xl` 2 (dashboard and `ui/`) |
| Numbers | `tabular-nums` used in 4 files; no numeric alignment in tables; currencies unformatted |
| Motion | hover lifts (`hover:-translate-y-0.5`) on every button variant, `active:scale-[0.98]`, card hover lift, staggered tile entrance, bounce emoji. `globals.css` zeroes the motion *tokens* under reduced motion, but Tailwind `transition`/`animate-bounce` classes and the `setTimeout` stagger are not tied to those tokens |

### 5.4 Write buttons shown to read-only roles

`00-DESIGN-DIRECTION.md` principle 2 ("absent, not disabled") is honoured by the sidebar but not by most pages. Pages with no write gate (by source scan, confirmed on `finance/page.tsx` and `qms/page.tsx`): qms, sop, risk, workflows, finance, supplier-scorecard, feature-flags, tenant-hierarchy, tenant-lifecycle, data-retention, oidc, scim, custom-domains, network-security, batch-jobs, predictive-maintenance, esignature, content, attachments, api-keys, webhooks, tenants, users, roles. Combined with the seeded grants in §3.1, an HA sees create/edit on at least 12 read-only screens and an EM on at least 8. The user completes a form and learns at submit (`AccessDeniedModal`). **Severity 3.**

### 5.5 Internationalisation

| Aspect | State |
|---|---|
| Framework | none: no `next-intl`, `react-i18next` or message catalogue in `frontend/package.json`; 0 uses of `useTranslation` |
| Strings | every user-facing string is an English literal in JSX, including status labels, errors, empty states and confirmation copy. Backend error messages are shown verbatim (English) |
| Document language | `<html lang="en">` (`app/layout.tsx`); no `lang="id"` on the Indonesian role names (`17-ACCESSIBILITY.md` requires it) |
| Dates | about 55 call sites of `toLocaleDateString()` / `toLocaleString()` with **no locale argument**, so the format follows the browser. `utils/index.ts` has `formatDate` / `formatDateTime` hard-coded to `en-US` and is imported by **0** dashboard files |
| Numbers and currency | `toLocaleString()` without locale (Home tiles), `toFixed(2)` for money (`billing/components/InvoicesTable.tsx`, `finance`), no thousands separator |
| Terms | mixed domain vocabulary (opname / physical count / audit; depot / warehouse / storage shelves; "Calibration Audit Log" for a calibration record) |

For Indonesian plus English this is a greenfield: every screen needs string extraction, and dates, numbers and currency need one formatter layer. Severity 3 against the owner's direction (not a defect in the English-only product).

### 5.6 Responsive behaviour

| Aspect | State |
|---|---|
| Breakpoint for the sidebar | 1024 px: overlay below, fixed 288 px above. A 1024 px tablet in landscape gets 736 px of content |
| Tables | `overflow-x-auto` with `table-fixed` and `whitespace-nowrap`; no column priority, no card reflow. `17-ACCESSIBILITY.md` says tables reflow to cards at 200% zoom and on mobile; nothing does |
| Page header | `flex-col sm:flex-row`, consistent; multi-button headers wrap (`stock`) |
| Forms | 2–3 column grids collapse to one column below 640 px |
| Touch targets | `Button size="sm"` is about 28 px tall; icon-only row actions are `sm` ghost buttons. WCAG 2.1 AA does not require 44 px (2.5.5 is AAA), but "tablets usable" does in practice |
| Global search | hidden below 640 px |

---

## 6. Heuristic Evaluation

Each heuristic is rated 1–5 across the dashboard, with the evidence that drives the score.

| # | Heuristic | Score | Evidence (strongest first) |
|---|---|---|---|
| H1 | Visibility of system status | **2** | Failed loads render as empty lists under a banner (§5.1); device register shows no overdue state; Home tiles do not say what period or scope beyond the chip; stats on Users count one page. Good: live notification count, batch-job progress polling, per-button `isLoading` |
| H2 | Match with the real world | **3** | Domain terms mostly right; crossed labels (IA5), "Calibration Audit Log" for a record, "Audit" overloaded, "Depots"; English-only for an Indonesian market; status enums shown raw in QMS |
| H3 | User control and freedom | **2** | No undo anywhere; per-click permission changes with no batch save; no breadcrumbs or back paths on nested routes; tab and filter state lost on navigation and refresh (no URL state); search result loses the record |
| H4 | Consistency and standards | **2** | Three table and three pagination implementations; five confirmation patterns; four `<h1>` styles; three Cancel styles; two toast systems; status colours mean different things per page (§5) |
| H5 | Error prevention | **2** | Restore and delete backups, delete signing keys, remove CIDR ranges with one click; write buttons shown to read-only roles; free-text category filter; calibration entered in a cramped modal; the device picker limited to one fetched page (verify) |
| H6 | Recognition rather than recall | **3** | Menu requires knowing that kanban and tickets live under "Management"; unlisted Stock, MFA and Storage need a remembered URL; global search is narrow and hidden on small screens. Good: labelled forms (F-12), badges carry text |
| H7 | Flexibility and efficiency | **1** | No sorting, no saved views, no bulk actions except notifications, no keyboard shortcuts or command palette, no density option, no column choice, no deep links to records, no export outside Reports and stock |
| H8 | Aesthetic and minimalist design | **3** | Page bodies are mostly clean; Home is decorative (hero, emoji, animated tiles); cards-in-cards and `rounded-2xl` everywhere lower information density; stat cards duplicate across Home, Reports, Users, Tenants, Sessions |
| H9 | Help users recover from errors | **3** | Backend messages are specific (409s explain state per `CLAUDE.md`) and shown; but `Users` shows the error as both title and body, toast-only failures vanish, and the AccessDenied modal arrives after the form is filled |
| H10 | Help and documentation | **3** | Page subtitles explain purpose well (§4); helper text in `FormField`; e-signature and SOP explain consequences. No contextual help or glossary for ISO/Part 11 terms |

**Per-page ratings** are in the tables of §4. Distribution: 5 → 0 pages · 4 → 6 (Change Password, API Keys, Webhooks, WebAuthn, MFA, and Stock *if it were reachable*) · 3 → 40 · 2 → 8 (Home, Tenants, Menu Group Assignment, Background Jobs, E-Signatures, Asset Finance, Storage, and Stock as unreachable) · 1 → 1 (Tenant backup).

---

## 7. The Design System

### 7.1 What exists (`frontend/src/components/ui/`)

| Component | Variants / API | Notes against the direction |
|---|---|---|
| `Button` | `primary`, `secondary`, `outline`, `ghost`, `danger`; `sm` / `md` / `lg`; `isLoading`, `leftIcon`, `rightIcon` | `rounded-xl`, hover lift and `active:scale` on every variant. `md` is `px-5 py-2.5` (about 40 px), comfortable but not dense. No `icon` size (icon-only buttons are `sm` ghost with ad-hoc classes). Doc says variants are "primary, secondary, ghost, destructive" |
| `Input` | `label`, `error`, `helperText`, left/right icon, password toggle | `px-4 py-3` (about 46 px), `rounded-xl`, ring styling; label `text-sm font-medium` differs from `FormField` |
| `Select` | custom listbox | tested for a11y (`a11y.f12*`) |
| `MultiSelect`, `SearchableDropdown` | custom | two combobox implementations |
| `Textarea`, `DateField` | — | `DateField` uses `bg-muted/30 ring-border`, `Input` uses `bg-background ring-input`: two field looks |
| `FormField` | label, error, helper, required; wires `id`, `aria-invalid`, `aria-describedby`, `aria-required` | the right primitive; used in 21 of 50 domains |
| `Card`, `CardHeader`, `CardContent`, `CardFooter` | `hover` | `rounded-2xl`, `p-6`; `CardHeader` title is an `<h2>` (ADR-090) |
| `Table` + `Pagination` | columns (`key`, `header`, `render`, `className`), `data`, `onRowClick`, `isLoading`, `emptyMessage` | no sort, selection, sticky header, column sizing, row key, density, keyboard row activation, error state. Cells `px-6 py-4` (about 53 px rows). Header `uppercase text-xs font-bold` |
| `Badge` | `default`, `primary`, `secondary`, `success`, `warning`, `danger`, `info`; `sm` / `md`; removable | fine as a primitive; no domain status registry above it |
| `Alert` | `default`, `success`, `warning`, `error`, `info`; dismissible | title is a `<p>` (ADR-090) |
| `Dialog` | `sm`–`xl` (384–576 px); title or `ariaLabel` | focus trap, Escape, restore (`useModalA11y`). No full-height, drawer or wide variant |
| `ConfirmDialog` | `danger` / `primary`, labels, `isLoading` | the right primitive; used by 6 files |
| `Skeleton`, `TableSkeleton`, `CardSkeleton` | — | `TableSkeleton` has a typo class `bg-muted0/5` (renders nothing) |
| `ErrorState` | copy by status (`errorStateCopy`), retry | used by **1** page |
| `Avatar`, `ToastContainer` | — | toasts are all `role="alert"` / assertive |
| `useModalA11y`, `fieldA11y` | hooks | solid |

### 7.2 Tokens (`frontend/src/app/globals.css`)

| Layer | Present | Missing for the direction |
|---|---|---|
| Colour | semantic tokens for surfaces (`background`, `card`, `popover`, `muted`), text, `border`/`input`/`ring`, brand (`primary`, `secondary`, `accent`), states (`success`, `warning`, `destructive`, `info`), light and dark, ADR-090 contrast policy with an executable test (`a11y.adr090.test.tsx`), tenant brand via `data-tenant-brand` and per-theme derived primaries | **domain status tokens** (overdue, due-soon, current, draft, revoked) separate from generic success/warning, so tenant brand and "in progress" cannot collide with "due soon"; a neutral surface ramp for dense chrome (row hover, selected row, zebra, header); `accent` (cyan) is a second brand colour, which the "neutral plus one accent" direction removes |
| Typography | three families (`sans` Inter, `mono` JetBrains, `display` Space Grotesk) | a type scale (no named sizes; pages pick `text-xl`–`text-5xl`), `tabular-nums` default for data |
| Spacing / size | none (Tailwind defaults) | **density tokens**: row height, cell padding, control height, gap, in comfortable and compact sets, switched by one attribute on `<html>` |
| Radius | none | one radius scale (today five values are used ad hoc) |
| Elevation | none | shadow scale for popover, dialog, sticky header |
| Motion | `--ease-*`, `--dur-*`, `--stagger`, zeroed under reduced motion | dashboard motion policy wired to them (today hover lifts and stagger ignore the tokens) |
| Z-index | ad hoc (`z-30`, `z-40`, `z-50`, `z-100`, `z-[200]`) | a layer scale |

### 7.3 What an enterprise-dense system needs that is not there

| Missing | Why the audit says so |
|---|---|
| **AppShell** (route-group `layout.tsx`, collapsible rail sidebar, top bar with page title, breadcrumb, tenant switcher/indicator, user menu) | S1–S4, S9 |
| **DataGrid** on top of `Table`: sort, sticky header, row selection and bulk-action bar, column visibility and width, row actions overflow menu, keyboard navigation, stable row keys, density, loading/empty/**error** states built in, server pagination bound to `meta` | §5.1; 34 table screens would move onto it |
| **FilterBar** with labelled fields, active-filter chips, clear-all, and URL sync; saved views later | §5.1 |
| **PageHeader / Toolbar** (title, subtitle, primary action slot, secondary actions, tabs slot) | four `<h1>` styles, header rebuilt per page |
| **Tabs** with `role="tablist"` / `tab` / `tabpanel`, arrow keys, URL sync | 7 hand-built tab bars, none ARIA |
| **Drawer / Sheet** and **SplitView** (list plus detail panel) | no record detail pages for devices, certificates, work orders, vendors; `permissions` is the only master–detail |
| **DescriptionList / RecordHeader** for detail views (key-value, attribution: calibrated / approved / signed by) | `06-DESIGN-SYSTEM.md` attribution rule has no component |
| **EmptyState** | documented as a core component; does not exist |
| **StatusBadge registry** (domain → state → token and label, one place) | ≥12 local maps (§5.3) |
| **KPI / Stat tile** with link, unavailable state, trend | five stat-card implementations (home, reports, users, tenants, sessions) |
| **CommandPalette** (Ctrl/⌘+K: pages from the resolved menu, records from `/search`) | S6, H7; the IA doc promises it |
| **DropdownMenu / Popover / Tooltip** | row actions are rows of icon buttons; `title=` used as tooltip |
| **Checkbox, Switch, RadioGroup, SegmentedControl** | raw inputs in feature flags, notifications, kanban |
| **NumberField with unit**, **DateRangePicker** | calibration readings, audit and report ranges |
| **Density provider** (comfortable default, compact toggle, persisted per user) | owner direction; nothing exists |
| **i18n layer** (message catalogue, `id` and `en`, formatters for date, number, currency) | §5.5 |
| **Toast** split into `status` (polite) and `alert` (assertive) | `ToastContainer` |

### 7.4 Where the UX documents and the code disagree

Recorded for the owner; per `CLAUDE.md` these are deviation-protocol items, not quiet edits.

| Document says | Code does |
|---|---|
| `06-DESIGN-SYSTEM.md`: core components include DatePicker, Modal **and Drawer**, **Tabs**, **Tooltip**, **EmptyState**; Button variants "primary, secondary, ghost, destructive"; "Table: one implementation" | none of Drawer, Tabs, Tooltip, EmptyState exists in `components/ui`; Button has `outline` and `danger`; five raw tables |
| `02-INFORMATION-ARCHITECTURE.md`: sidebar collapsible; breadcrumb on nested routes; command palette over `/api/v1/search`; tenant logo and name in the chrome; no nesting beyond two levels; HA has no `security`, `content`, `kanban` | none of the first four; three levels; HA's sidebar shows content and kanban by cascade |
| `11-DASHBOARD-UX.md`: overdue first and the only red; every tile links to its filtered list; tiles shaped by role; "Awaiting your action"; recent activity from `audit_logs` | overdue sixth; no links; SA vs rest only; no queue; recent activity is a user list |
| `17-ACCESSIBILITY.md`: kanban keyboard move; tables reflow to cards at 200%; no all-caps labels; `lang="id"` on Indonesian names | none |
| `00-DESIGN-DIRECTION.md`: dashboard spends nothing on impression; spacious calibration entry | Home hero and animation; calibration in a 512 px modal |

### 7.5 Side observation (outside UX scope)

`GET /api/v1/dashboard/metrics` is mounted with `auth` only, no `dynamicAccess` (`backend/src/routes/api/dashboard.route.js`, line 47). `CLAUDE.md` asks every route to carry a permission gate. It may be deliberate (the figures are tenant-scoped); flagged for the owner, not assessed here.

---

## 8. Top 15 Issues

Ordered by severity, then by how many users and screens they touch.

| # | Issue | Where | Sev |
|---|---|---|---|
| 1 | Tenant backup **Restore** and **Delete** execute on one click, no confirmation | `tenants/[tenantId]/backup/components/BackupList.tsx`, `hooks/useTenantBackups.ts` | 4 |
| 2 | The stock module (inventory, transfers, adjustments, opname) has **no menu entry**; the warehouse role cannot see it | seed file; `stock/page.tsx`; `GlobalSearch.tsx` is the only link | 4 |
| 3 | E-signature **key-pair** (and workflow) delete with no confirmation; load errors toast-only, then "No key pairs yet" | `esignature/page.tsx` `deleteKey`, `deleteWorkflow`, `loadKeys` | 4 |
| 4 | Failed loads render as empty lists ("No devices found", "No non-conformances recorded") under an error banner; `ErrorState` used by one page | `devices/components/DevicesTable.tsx`, `qms/page.tsx`, most list pages | 3 |
| 5 | Sidebar shows grandchildren the API refuses (cascade vs one-level check) | `menuGroup.service.js#getRoleMenuAssignments` vs `roles.service.ts` ~L561 | 3 |
| 6 | Write buttons shown to read-only roles on about two thirds of pages; the 403 arrives after the form is filled | §5.4 (`finance/page.tsx` "Record Asset", `qms/page.tsx` "Raise NC", …) | 3 |
| 7 | Home is not role-specific, has no drill-down, shows admin quick actions to everyone, overdue is tile 6, "Recent Activity" is a user list stamped "Recently" | `app/dashboard/page.tsx`, `components/DashboardStats.tsx`, `DashboardQuickActions.tsx`, `DashboardCharts.tsx` | 3 |
| 8 | IA not by domain: 27-leaf *Management* catch-all, three levels, daily work buried, personal settings in the admin *Security* group | seed file | 3 |
| 9 | Device register shows next calibration as a bare date: no overdue/due-soon state on the primary register | `devices/components/DevicesTable.tsx` | 3 |
| 10 | Calibration record entry in a 512 px modal with all-caps micro-labels and three numeric fields per row; no record or certificate detail views to hold attribution | `calibration/components/RecordCalibrationModal.tsx`, `CertificatesTable.tsx` | 3 |
| 11 | Lists: three table implementations, three pagination patterns plus none on 13 screens; no sort, bulk, URL state or column control anywhere | §5.1 | 3 |
| 12 | No shell orientation: top bar says "Dashboard" on every page; no breadcrumb, tenant indicator or collapsible rail | `TopBar.tsx`, `Sidebar.tsx` | 3 |
| 13 | Global search opens the list, not the record; three entity types, no shortcut, no page search | `GlobalSearch.tsx` | 3 |
| 14 | No i18n: English literals throughout, browser-dependent dates, unformatted currency, `lang="en"` only | §5.5 | 3 |
| 15 | Kanban cards cannot be moved between columns without a mouse | `kanban/[projectId]/components/BoardColumn.tsx`, `CardTile.tsx`, `CardModal.tsx` | 3 |

Close behind: Users stats counting one page (3); CIDR removal without confirmation (3); five confirmation patterns and 11 hand-built overlays (2); status colour semantics diluted (2); four title styles and two field looks (2).

---

## 9. What to Verify, and What to Test With People

**Verify in a browser before the redesign plan quotes them** (static reading can be wrong about runtime):

1. The §3.3 cascade: sign in as HA and EM, open every lower-case cell in §3.1, record which answer 403.
2. The calibration device picker's reach: does it list more than the first page of devices?
3. Home as FACILITY MAINTENANCE and WAREHOUSE STAFF (no `dashboard` grant) after login.
4. Row heights and horizontal scroll of the devices and stock tables at 1024, 1280 and 1440 px, with realistic data lengths.
5. Screenshots of the 15 issues above into `docs/UI-UX/research/screens/`, reusing ADR-090's seeded stack.

**Test with people** (task-based, 5–6 per role group is enough to find the big problems, see [`02-standards-and-benchmarks.md`](./02-standards-and-benchmarks.md) §7):

| Task | Role | Tests |
|---|---|---|
| "Which devices are overdue, and open the worst one" | Admin Faskes, Manajer Teknik | Home drill-down, register status, detail view |
| "Record a calibration and generate its certificate" | Teknisi, Admin Kalibrator | form in modal vs page, numeric entry, certificate flow |
| "Move 5 units from Gudang A to Gudang B, then do an opname" | Gudang | findability of stock (IA1), vocabulary |
| "Find your kanban card and move it to Done using the keyboard" | Teknisi, Penyelia | IA3, keyboard move |
| "Set up your passkey and see where you are signed in" | any non-admin | IA4 |
| "Show the auditor who approved and who signed certificate X" | Admin Faskes | attribution, detail view, audit export |

Record completion, time on task, errors and the SEQ (single-ease question) per task, in Indonesian with bilingual materials.
