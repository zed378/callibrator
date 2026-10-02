# 03 — Personas, Role→Menu Matrix and Key Flows (research input)

**Date:** 2026-09-29 · **Type:** code-grounded desk research. **No users were interviewed or observed.** Every persona below is a *proto-persona* derived from what the code lets each role do; goals, frequencies and pain points not visible in code are marked **UNVERIFIED**. · **Status:** input to the admin-dashboard UI/UX plan. It is not a decision. Anything that would move `docs/` (menu tree, role grants) goes through an ADR.

**Owner direction already decided (not re-litigated here):** enterprise-dense (SAP/ServiceNow-like), collapsible sidebar, comfortable/compact density toggle, role-specific home, neutral palette + 1 accent (light & dark), desktop-first / tablet-usable, WCAG 2.1 AA, Indonesian + English.

Siblings: `01-current-ui-audit.md` (screen audit), `02-standards-and-benchmarks.md` (ISO 17025 / Part 11 / KARS-MFK detail). Existing design docs this refines: `docs/UI-UX/02-INFORMATION-ARCHITECTURE.md`, `03-PERSONAS.md`, `04-USER-JOURNEYS.md`.

---

## 0. The ten findings that matter most

| # | Finding | Evidence | Consequence for the redesign |
|---|---|---|---|
| F1 | **The sidebar and the API use different inheritance rules.** Sidebar: a grant cascades to *every* descendant. API: a grant reaches *one* level down. So a `management` grant shows ~30 Management pages in the sidebar, but authorizes almost none of them. | sidebar: `backend/src/services/menuGroup.service.js#getRoleMenuAssignments` (`buildNode(child, isAssigned)`); API: `backend/src/services/roles.service.js#getRolePermissionsMatrix` ("Inherit permission to all children") + `#hasPermission` (parent only) | HEALTHCARE ADMIN, CALIBRATOR ADMIN and ENGINEERING MANAGER see menu items that 403 (Roles, Menu Groups, Blog, etc. — §2 marks them ‡). The new nav must be driven by the *effective API permission*, not the raw tree. |
| F2 | **The certificate journey is broken in the UI.** The table offers **Approve on `draft`**; the backend refuses approve from `draft` (409, "submit it first"). There is **no Submit button** and no action at all on `pending_approval`. | `frontend/src/app/dashboard/calibration/components/CertificatesTable.tsx:123` (`cert.status === "draft"` → Approve); `backend/src/services/certificate.service.js` `TRANSITION_REFUSALS.approved.draft`; no `/submit` call in `frontend/src/api/services/calibration.service.ts` | The core compliance flow (draft → submit → approve → sign) cannot be completed from the UI. Highest-priority flow fix. |
| F3 | **Write buttons are decided by hard-coded role names, not permissions.** Devices/Calibration/Stock/Warehouse show write actions to `SUPERADMIN`, `HEALTHCARE ADMIN`, **`WAREHOUSE STAFF`**; Maintenance/Vendors to SA/HCA/`CALIBRATOR ADMIN`. | `frontend/src/app/dashboard/{calibration,devices,stock,warehouse,maintenance,vendors}/hooks/use*.ts` (`hasWriteAccess = user?.role?.name === …`) | CALIBRATOR ADMIN (server: `equipment` write) sees **no** write buttons on Devices/Certificates; WAREHOUSE STAFF (server: `equipment` read) sees buttons that 403. Contradicts `docs/FRONTEND/05-RBAC-IN-UI.md` ("never from a client-side permission list", quoted in `frontend/src/lib/menuAccess.ts`). |
| F4 | **The people who do the technical work are read-only by default.** TECHNICIAN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE (IPSRS), SUPERVISOR and ENGINEERING MANAGER hold `equipment: read` — they cannot record a calibration, create/approve/sign a certificate, or update a work order. Only level-8 admins can. | `backend/src/constants/roleConstants.ts#ROLE_MENU_ASSIGNMENTS` | Either the seed is wrong (owner question) or the UX must make "ask your admin for write" obvious. Only SUPERADMIN can change grants (`roles.route.js`, `userPermissions.route.js`: `rbac(["SUPERADMIN"])`) — a tenant admin cannot fix it. |
| F5 | **Home is not role-aware.** `/dashboard` shows the same hero, stats, "recent users" and Quick Actions (Add User, New Tenant, Roles, Notifications, Settings, View Site) to every role. | `frontend/src/app/dashboard/page.tsx`, `components/DashboardQuickActions.tsx`; `fetchUsers()` is called for every role | A technician is offered "New Tenant". The `users` list call 403s for most roles. |
| F6 | **The "Home" menu leaves the app.** Slug `home` maps to `/` (public landing). "Home" and "Dashboard" are two top-level entries. | `menuGroup.service.js#mapSlugToPath` (`home: "/"`) | Merge into one role-home. |
| F7 | **Orphan pages:** `/dashboard/stock` (the whole stock ledger — only reachable via global search), `/dashboard/storage` (bring-your-own-bucket), `/dashboard/mfa` (reached via enrolment gate), `/dashboard/warehouse` (duplicate of `/warehouses`). | page list under `frontend/src/app/dashboard/`; only inbound link to stock is `components/layouts/GlobalSearch.tsx:28` | Stock must get a nav entry. |
| F8 | **Names and slugs are crossed.** Slug `calibration` → `/dashboard/devices` "Calibration Devices"; slug `certificate` → `/dashboard/calibration` "Calibration & Certificates". Calibration Scheduler page is gated by `maintenance`; Predictive Maintenance by `calibration`. | `mapSlugToPath`; `calibrationScheduler.route.js`, `predictiveMaintenance.route.js` | A grant on "Calibration Scheduler" authorizes nothing; confusing for the permission screen. |
| F9 | **Per-user permission overrides are invisible to the sidebar.** API honours `user_menu_permissions` overrides (read/write/none); the sidebar reads role grants only. | `dynamicAccess.middleware.js` (`getUserOverrideMatrix`), `getRoleMenuAssignments` (RoleMenuPermission only) | Users granted extra access per-user can't find the page; users with `none` still see it. |
| F10 | **No i18n framework.** UI strings are hard-coded English; only role display names are Indonesian (`Admin Faskes`, `Teknisi`, `Penyelia`, `IPSRS`, `Gudang`…). | `frontend/package.json` (no next-intl/react-intl); `roleConstants.ts#ROLE_DISPLAY_NAMES` | ID+EN is a from-scratch workstream; §6 supplies label pairs. |

---

## 1. Role inventory

Source: `backend/src/constants/roleConstants.ts` (`ROLE_NAMES`, `ROLE_DISPLAY_NAMES`, `ROLE_LEVELS`, `ROLE_MENU_ASSIGNMENTS`). Level semantics: `rbac(...)` passes a user whose level ≥ the lowest listed role (`backend/src/middlewares/rbac.middleware.js`); `SUPERADMIN` bypasses every `dynamicAccess` gate and tenant check (`dynamicAccess.middleware.js`, "SUPER_ADMIN bypass").

| Key | `roles.name` | UI display (ID, as seeded) | Proposed EN label | Level | Scope | Seeded? |
|---|---|---|---|---|---|---|
| `SUPER_ADMIN` | `SUPERADMIN` | Super Admin | Platform Administrator | **10** | **Cross-tenant** (platform operator; global dashboard, impersonation, tenant lifecycle) | yes |
| `TENANT_ADMIN` | `TENANT_ADMIN` | — | — | 8 | Logical tier only: used by `rbac([ROLE_NAMES.TENANT_ADMIN])` (api-keys, webhooks, attachments, storage, some users/devices/iot routes) | **no** |
| `HEALTCARE_ADMIN` *(sic)* | `HEALTHCARE ADMIN` | Admin Faskes | Healthcare Facility Admin | 8 | Tenant (hospital) | yes |
| `CALIBRATOR_ADMIN` | `CALIBRATOR ADMIN` | Admin Kalibrator | Calibration Provider Admin | 8 | Tenant (calibration lab/vendor) | yes |
| `ENGINEERING_MANAGER` | `ENGINEERING MANAGER` | Manajer Teknik | Engineering Manager | 7 | Tenant | yes |
| `SUPERVISOR` | `SUPERVISOR` | Penyelia | Supervisor | 6 | Tenant | yes |
| `TECHNICIAN` | `TECHNICIAN` | Teknisi | Technician (calibration) | 5 | Tenant | yes |
| `HEALTHCARE_TECHNICIAN` | `HEALTHCARE TECHNICIAN` | Teknisi Faskes | Facility Technician (biomedical) | 5 | Tenant | yes |
| `FACILITY_MAINTENANCE` | `FACILITY MAINTENANCE` | IPSRS | Facility Maintenance (IPSRS) | 4 | Tenant | yes |
| `WAREHOUSE_STAFF` | `WAREHOUSE STAFF` | Gudang | Warehouse Staff | 4 | Tenant | yes |
| `ROOM_USER` | `ROOM USER` | User Ruangan | Ward/Room User | 3 | Tenant | yes |
| `USER` | `USER` | Normal User | Basic User | 1 | Tenant | yes |

Notes:
- There is **no auditor / QA / finance role** in the code. Auditor = HEALTHCARE/CALIBRATOR ADMIN with `audit: read`; QA/approver = whoever holds `certificate` write (only level-8 admins by default); finance = admins with `finance: read`. A dedicated read-only auditor login is an **owner decision** (see §7 Q1).
- Level order is **not** scope order: WAREHOUSE STAFF (4) holds `warehouse: write` where SUPERVISOR (6) holds `read`. (Also stated in `docs/UI-UX/02-INFORMATION-ARCHITECTURE.md`.)
- Ticket responders are a hard-coded set: SA, HEALTHCARE ADMIN, CALIBRATOR ADMIN, ENGINEERING MANAGER, SUPERVISOR (`backend/src/services/ticket.service.js:43` `RESPONDER_ROLES`). SA may not *raise* (`ticket.service.js:335`).
- Signing (`esignature` write) is granted to technical roles and admins only; WAREHOUSE STAFF, ROOM USER, USER were revoked (migration `0032-esignature-technical-roles-only.js`, ADR-051 Q-19).
- MFA: tenant policy `mfa_required` + optional `mfa_required_min_role_level` (`backend/src/utils/mfaPolicy.util.ts`); platform operators without MFA get an enrolment-only session → `/dashboard/mfa` (`frontend/src/app/login/hooks/useLoginForm.ts#destinationAfterSignIn`).
- Divergent dead seeder: `backend/src/utils/seedMenuGroups.util.js#seedRoleMenuPermissions` grants different slugs (e.g. CALIBRATOR ADMIN → `tenants`, `roles`) all as `read`; the live seed is `migration.service.js#seedMenuGroupsAndItems` using `ROLE_MENU_ASSIGNMENTS`. No non-test caller of the util version was found. Flag for cleanup; do **not** read it as the matrix.

---

## 2. Role → menu matrix (effective, as-built)

**How to read.** Menu tree: `backend/src/utils/seedMenuGroups.util.js#seedMenuGroups`. Grants: `ROLE_MENU_ASSIGNMENTS` (+ migrations 0021, 0025, 0027, 0032, 0038, 0054 which only back-fill the same grants). Route gates: `backend/src/routes/api/*.route.js`. Cell = **effective API permission** (direct grant, or grant on the direct parent; `write` implies `read`; any non-`read` verb such as `approve`/`sign`/`generate` normalises to `write` — `dynamicAccess.middleware.js#normalizePermission`).

| Mark | Meaning |
|---|---|
| **W** / **R** | write / read allowed by the API |
| **—** | no access, not in sidebar |
| **‡** | **shown in sidebar, API refuses** (F1 leak) |
| **§** | API allows, **not in sidebar** (orphan / URL-only / self-service) |
| **m** | gated by object membership, not menu (Kanban project membership, `kanban.service.js#assertAccess`) |

Columns: **SA** SUPERADMIN · **HCA** HEALTHCARE ADMIN · **CAA** CALIBRATOR ADMIN · **EM** ENGINEERING MANAGER · **SPV** SUPERVISOR · **TEC** TECHNICIAN · **HTE** HEALTHCARE TECHNICIAN · **FM** FACILITY MAINTENANCE · **WH** WAREHOUSE STAFF · **RU** ROOM USER · **USR** USER

### 2.1 Top level, Account, Equipment, Warehouse

| Sidebar path (seed name) · slug → route | API gate | SA | HCA | CAA | EM | SPV | TEC | HTE | FM | WH | RU | USR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home · `home` → `/` (public landing!) | none | R | R | R | R | R | R | R | R | R | R | R |
| Dashboard · `dashboard` → `/dashboard` | `GET /dashboard/metrics`: auth only | R | R | R | R | R | R | R | **—§** | **—§** | R | R |
| Account › Profile · `profile-page` | self | W | W | W | W | W | W | W | W | W | W | W |
| Account › Change Password · `change-password` | self | W | W | W | R | R | —§ | —§ | —§ | —§ | —§ | R |
| Account › Notifications · `notifications` | `notifications` (1 write route) | W | W | W | R | R | —§ | —§ | —§ | —§ | —§ | R |
| Equipment › Calibration Devices · `calibration` → `/dashboard/devices` | `calibration` (+`rbac TENANT_ADMIN` on some) | W | W | W | R | R | R | R | R | R | R | R |
| Equipment › Calibration & Certificates · `certificate` → `/dashboard/calibration` | records: `calibration`; certs: `certificate` (read / generate / approve / sign) | W | W | W | R | R | R | R | R | R | R | R |
| Equipment › Maintenance · `maintenance` | `maintenance` | W | W | W | R | R | R | R | R | R | R | R |
| Equipment › Calibration Scheduler · `calibration-scheduler` | **`maintenance`** (F8) | W | W | W | R | R | R | R | R | R | R | R |
| Equipment › Reports · `reports` | `reports` | W | W | W | R | R | R | R | R | R | R | R |
| Equipment › Predictive Maintenance · `predictive-maintenance` | **`calibration`** (F8) | W | W | W | R | R | R | R | R | R | R | R |
| Warehouse · `warehouse` → `/dashboard/warehouses` | `warehouse` | W | W | R | R | R | R | R | R | **W** | R | R |
| *(no menu)* Stock → `/dashboard/stock` | `warehouse` | W§ | W§ | R§ | R§ | R§ | R§ | R§ | R§ | **W§** | R§ | R§ |

### 2.2 Management (seed: 7 sub-groups; sidebar visible to SA/HCA/CAA/EM via the `management` grant, to others only where a leaf is granted)

| Sidebar path · slug | API gate | SA | HCA | CAA | EM | SPV | TEC | HTE | FM | WH | RU | USR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Organization › Tenants · `tenants` | `management` | W | W | W | R | — | — | — | — | — | — | — |
| Organization › Tenant Hierarchy · `tenant-hierarchy` | `GET /tree` auth; writes `platformOnly` | W | R | R | R | — | — | — | — | — | — | — |
| Organization › Tenant Lifecycle · `tenant-lifecycle` | `tenant-lifecycle` read (export); suspend/resume/offboard gates not inspected — **UNVERIFIED**, assumed platform | W | R | R | ‡ | — | — | — | — | — | — | — |
| Organization › Users · `users` | `users` (+ `rbac TENANT_ADMIN`) | W | W | W | ‡ | — | — | — | — | — | — | — |
| Organization › Roles · `roles` | `rbac(["SUPERADMIN"])` | W | ‡ | ‡ | ‡ | — | — | — | — | — | — | — |
| Organization › Menu Group Assignment · `menu-groups` | `rbac(["SUPERADMIN"])` | W | ‡ | ‡ | ‡ | — | — | — | — | — | — | — |
| Work › Kanban Boards · `kanban` | m | m | m (‡-menu: not granted, shown by cascade) | m | m | m | m | —§m | —§m | —§m | —§m | —§m |
| Work › Approval Workflows · `workflows` | `workflows` | W | W | W | R | — | — | — | — | — | — | — |
| Work › Background Jobs · `batch-jobs` | `batch-jobs` | W | R | R | ‡ | — | — | — | — | — | — | — |
| Work › Raise a Ticket · `tickets-raise` | service (`ticket.service.js`) | **‡** (SA may not raise) | W | W | W | W | W | W | W | W | W | W |
| Work › Ticket Response · `tickets-response` | service `RESPONDER_ROLES` | W | W | W | W | W | — | — | — | — | — | — |
| Quality › Quality (NC & CAPA) · `qms` | `qms` | W | W | W | R | — | — | — | — | — | — | — |
| Quality › SOP Documents · `sop` | `sop` (acknowledge gate **UNVERIFIED**) | W | W | W | R | — | — | — | — | — | — | — |
| Quality › Risk Register · `risk` | `risk` | W | W | W | R | — | — | — | — | — | — | — |
| Quality › Audit Logs · `audit` | `audit` read | R | R | R | ‡ | — | — | — | — | — | — | — |
| Quality › Data Retention · `data-retention` | `data-retention` read (+checkTenant); write gates **UNVERIFIED** | W | R | R | ‡ | — | — | — | — | — | — | — |
| Quality › E-Signatures · `esignature` | `esignature` (sign/verify/history); key-pairs & workflow admin: **`qms`** | W | W | W | W (keys: —) | W (keys: —) | W (keys: —) | W (keys: —) | W (keys: —) | — | — | — |
| Quality › AI Assistant · `ai-assistant` | menu only; OCR needs `certificate` W, query needs `sop` R | W | W | W | R (OCR 403) | — | — | — | — | — | — | — |
| Finance › Billing · `billing` | `billing` (+`GET /quota`) | W | R | R | ‡ | — | — | — | — | — | — | — |
| Finance › Asset Finance · `finance` | `finance` | W | R | R | R | — | — | — | — | — | — | — |
| Finance › Usage & Metering · `metered-billing` | `metered-billing` (ADR-043) | W | W | W | ‡ | — | — | — | — | — | — | — |
| Partners › Vendors · `vendors` | `vendors` | W | W | W | R | — | — | — | — | — | — | — |
| Partners › Supplier Scorecards · `supplier-scorecard` | `supplier-scorecard` | W | W | R | R | — | — | — | — | — | — | — |
| Developer › API Keys · `api-keys` | `rbac TENANT_ADMIN` (≥8) | W | W | W | ‡ | — | — | — | — | — | — | — |
| Developer › Webhooks · `webhooks` | `rbac TENANT_ADMIN` | W | W | W | ‡ | — | — | — | — | — | — | — |
| Developer › Feature Flags · `feature-flags` | `feature-flags` read; writes **UNVERIFIED** | W | R | R | ‡ | — | — | — | — | — | — | — |
| Content › Blog & News · `content` | `content` (platform public blog) | W | ‡ | ‡ | ‡ | — | — | — | — | — | — | — |
| Content › Files & Documents · `attachments` | `rbac TENANT_ADMIN` | W | W | W | ‡ | — | — | — | — | — | — | — |
| *(no menu)* Storage → `/dashboard/storage` | `rbac TENANT_ADMIN` | W§ | W§ | W§ | — | — | — | — | — | — | — | — |

### 2.3 Security (sidebar: SA via `security`; HCA via six directly-granted children; nobody else)

| Sidebar path · slug | API gate | SA | HCA | CAA | EM | others |
|---|---|---|---|---|---|---|
| OIDC Provider · `oidc` | `oidc` read | W | R | — | — | — |
| WebAuthn · `webauthn` | self (own passkeys) | W | R | —§ | —§ | —§ (self-service, no nav for them) |
| Network Security · `network-security` | read `network-security`; writes `superAdminOnly` | W | R | — | — | — |
| SCIM Provisioning · `scim` | API-key principal with `scim` scope, or SA | W | R | — | — | — |
| Privacy & GDPR · `gdpr` | self for own data; others' requests need `gdpr` read (A-252) | W | R | —§ | —§ | —§ |
| Custom Domains · `custom-domains` | `custom-domains` | W | R | — | — | — |
| Role Permissions · `permissions` | `rbac(["SUPERADMIN"])` | W | — | — | — | — |
| User Permissions · `user-permissions` | `rbac(["SUPERADMIN"])` | W | — | — | — | — |
| Session Management · `sessions` | `rbac(["SUPERADMIN"])` | W | — | — | — | — |
| *(no menu)* MFA → `/dashboard/mfa` | self | §| § | § | § | § |

Correction to an existing doc: `docs/UI-UX/02-INFORMATION-ARCHITECTURE.md` says HEALTHCARE ADMIN has "no `security`". It has no grant on the `security` *group*, but `getRoleMenuAssignments` surfaces the group because six children are granted — HCA **does** see a Security section. Also, Security children have colliding `sortOrder` (oidc 0 / permissions 0, webauthn 1 / user-permissions 1, network-security 2 / sessions 2), so their order is not deterministic.

### 2.4 What each role's sidebar looks like today (count of leaves)

| Role | Visible leaves | Of which ‡ (refused) | Core work possible? |
|---|---|---|---|
| SA | ~58 (everything incl. Raise a Ticket) | 1 (Raise) | yes |
| HCA | ~50 | Roles, Menu Groups, Blog | yes, except Kanban writes via menu (membership OK) |
| CAA | ~41 | Roles, Menu Groups, Blog | server yes; **UI hides write on Devices/Certificates/Stock/Warehouse (F3)** |
| EM | ~39 | Users, Tenant Lifecycle, Audit, Data Retention, Batch Jobs, Billing, Usage, API Keys, Webhooks, Feature Flags, Blog, Files, Roles, Menu Groups | read-only monitor |
| SPV | 16 | 0 | read-only + tickets/kanban/sign |
| TEC | 13 | 0 | **cannot record calibration** |
| HTE | 12 | 0 | cannot record / update WO |
| FM (IPSRS) | 11 (no Dashboard) | 0 | cannot update work orders |
| WH | 10 (no Dashboard) | 0 (but F3 shows Device/Cert write buttons that 403) | warehouse yes; stock page orphaned |
| RU / USR | 11 / 13 | 0 | read-only; can raise tickets |

Counts are derived by hand from the seed tree and grants; re-count against a live `POST /api/v1/menu-groups/get-assignments` before quoting (**UNVERIFIED** against a running server).

---

## 3. Personas (one per seeded role)

Frequencies and goals are hypotheses (**UNVERIFIED** — no analytics or interviews in repo). Compliance duties cite the regulation, not a code mapping (a requirement→feature map does not exist yet; see `04-competitor-landing-and-auth.md` Q4). Indonesian hospital accreditation = KARS survey against KMK HK.01.07/MENKES/1128/2022 (STARKES), chapter **MFK** (Manajemen Fasilitas dan Keselamatan); exact element numbers **UNVERIFIED**.

### P1 — Andi, Platform Administrator (`SUPERADMIN`, 10)

| | |
|---|---|
| Goals | Onboard and keep tenants healthy; answer the cross-tenant support desk; govern roles/menus; keep the platform secure and compliant. |
| Top tasks | Create tenant + first admin; impersonate to troubleshoot (`POST /auth/impersonate`, `ImpersonationBanner.tsx`); respond to tickets; manage role/user permissions; suspend/offboard tenants; backups; feature flags; watch health/sessions. |
| Frequency | Daily; bursts at onboarding. |
| Pain points (seen in code) | Onboarding spans 4–6 unlinked screens (§4.6). Global dashboard mixes all tenants (`metrics.scope === "global"`); tenant filter is `?tenantId=` only (`dashboard.controller.js`). Sidebar shows "Raise a Ticket" he may not use. Permission editing is split across Roles, Menu Group Assignment, Role Permissions, User Permissions (4 pages, 2 top-level groups). |
| Compliance duties | Part 11 §11.10(d) access limitation and §11.10(g) authority checks (role/permission governance); §11.10(e) audit trail (platform scope in `/dashboard/audit`); GDPR processor duties (retention, erasure); impersonation must be attributable (`audit_log` impersonator, migration 0029). |

### P2 — Dewi / Rina-HCA, Healthcare Facility Admin (`HEALTHCARE ADMIN`, 8)

| | |
|---|---|
| Goals | Hospital's device inventory complete and in-interval for the KARS survey; users and vendors managed; certificates approved on time. |
| Top tasks | Manage users & vendors; approve/sign certificates; read audit trail; manage QMS/SOP/Risk; configure SSO/MFA; watch usage/billing. |
| Frequency | Daily, 30–60 min; peaks before accreditation. **UNVERIFIED** |
| Pain points | ~50-item sidebar with 3 refused items (F1); certificate approval cannot be reached properly (F2); cannot grant her own technicians write (F4 — SA-only); Security section mixes tenant config with platform-only items; no "what needs me" queue on home (F5). |
| Compliance duties | ISO 17025 §6.4 (equipment), §8.4 (records); Part 11 §11.50/§11.200 approver signature with meaning + re-auth (`ApproveCertModal`, `meaning: "Reviewed and approved"`); §11.10(e) tenant audit review (`audit: read`, Q-20); KARS MFK: annual test/calibration evidence per device. |

### P3 — Dewi, Calibration Provider Admin (`CALIBRATOR ADMIN`, 8)

| | |
|---|---|
| Goals | Run the lab: schedule jobs, issue signed ISO 17025 certificates, keep customers (hospital tenants) supplied with verifiable certificates. |
| Top tasks | Record calibrations; create → submit → approve → sign certificates; manage vendors/workflows; kanban for jobs; answer tickets. |
| Frequency | Daily, long sessions. **UNVERIFIED** |
| Pain points | **F3: UI hides write buttons on Devices, Certificates, Stock, Warehouse** even though the API allows her; F2 broken submit; no Security grants (cannot configure SSO for her lab) — possibly intended, **UNVERIFIED**. |
| Compliance duties | ISO 17025 §7.8 reporting of results (certificate content), §7.5 technical records (append-only records, corrections/void — migration 0057), §7.6 measurement uncertainty (uncertainty budgets, migration 0009); Part 11 signing. |

### P4 — Rina, Engineering Manager (`ENGINEERING MANAGER`, 7)

| | |
|---|---|
| Goals | Know within seconds what is overdue; produce compliance report; see who did what. (Matches `docs/UI-UX/03-PERSONAS.md`.) |
| Top tasks | Read reports (`/reports/compliance`, `/overdue-devices`, `/calibration-workload`); read QMS/Risk/Finance; respond to tickets; kanban; sign when named in a signature workflow. |
| Frequency | Daily, brief. **UNVERIFIED** |
| Pain points | 14 sidebar items refuse (F1) — the worst ratio of any role; **cannot read the audit trail** (no `audit` grant) though "who did what" is her need; cannot approve certificates (no `certificate` write) despite being the natural approver. |
| Compliance duties | Management review (ISO 17025 §8.9); KARS MFK programme oversight; signs as named signer (`esignature` write). |

### P5 — Pak Joko, Supervisor (`SUPERVISOR` / Penyelia, 6)

| | |
|---|---|
| Goals | Allocate and check technicians' work; unblock tickets. |
| Top tasks | Watch equipment/maintenance lists; kanban; ticket response; sign when named. |
| Frequency | Daily. **UNVERIFIED** |
| Pain points | Read-only on equipment and maintenance — cannot reassign or close work orders (F4); no queue of "work awaiting my review"; certificate approval (classic supervisor duty) not available. |
| Compliance duties | ISO 17025 §6.2 personnel competence/supervision; review of technical records **UNVERIFIED** as a system step (no review state exists besides certificate approval). |

### P6 — Budi, Technician (`TECHNICIAN` / Teknisi, 5)

| | |
|---|---|
| Goals | See today's due devices, perform calibration, record results, move on. |
| Top tasks | Look up device (global search), read schedule, record calibration, attach evidence, raise ticket, sign as performer. |
| Frequency | Many times per day, often on a tablet at the bedside/lab bench. **UNVERIFIED** |
| Pain points | **Cannot record a calibration** (`calibration` read only, F4); home offers "New Tenant / Add User" (F5); no "my assignments" view; no Change Password / Notifications menu (no `account` grant; bell exists in TopBar). |
| Compliance duties | ISO 17025 §7.5 complete technical records at time of work, §7.11 data integrity; Part 11 §11.50 performer signature. |

### P7 — Sari-HTE, Facility Technician (`HEALTHCARE TECHNICIAN` / Teknisi Faskes, 5)

| | |
|---|---|
| Goals | Hospital-side biomedical tech: know which devices are due/out-of-service, coordinate with the calibration provider, do first-line maintenance. |
| Top tasks | Browse devices by ward/status; read certificates to hand to ward staff; raise tickets; sign. |
| Frequency | Daily. **UNVERIFIED** |
| Pain points | Same read-only limits as P6; no kanban (unlike TEC); no device-by-location drill-down found (**UNVERIFIED**, see 01-audit). |
| Compliance duties | KARS MFK: inspection/testing records, device labelling (calibration sticker/QR → public `/verify/[certificateNumber]`). |

### P8 — Pak Hendra, Facility Maintenance (`FACILITY MAINTENANCE` / IPSRS, 4)

| | |
|---|---|
| Goals | Fix and maintain equipment; close work orders. |
| Top tasks | See open work orders; update status Open → InProgress → Completed (`WORK_ORDER_STATUSES`, `maintenanceWorkOrder.model.ts`). |
| Frequency | Several times a day, mobile/tablet. **UNVERIFIED** |
| Pain points | **No Dashboard** grant; home menu goes to the public landing (F6); **cannot update work orders** (maintenance read, F4); no "assigned to me" filter **UNVERIFIED**. |
| Compliance duties | KARS MFK preventive/corrective maintenance records; signature as performer. |

### P9 — Sari, Warehouse Staff (`WAREHOUSE STAFF` / Gudang, 4)

| | |
|---|---|
| Goals | Accurate stock; transfers and stock-takes (opname) done on time. |
| Top tasks | Stock in/out, adjustment (reason required, migration 0059), transfer (pending → in_transit → completed/cancelled), opname (draft → in_progress → completed), export. |
| Frequency | Daily, continuous. **UNVERIFIED** |
| Pain points | **The stock page has no menu entry** (F7 — reachable only via global search); sidebar "Warehouse" leads to warehouse/location CRUD, not stock; UI shows Device/Certificate write buttons that 403 (F3); no Dashboard grant. |
| Compliance duties | Traceability of spare parts/consumables; audit trail on adjustments. Not an e-signer (revoked, 0032). |

### P10 — Ward/Room User (`ROOM USER`, 3) and Basic User (`USER`, 1)

| | |
|---|---|
| Goals | Know if the device in my room is safe to use; report a problem. |
| Top tasks | Look up device status/certificate; raise ticket; scan QR → `/verify/...` (public). |
| Frequency | Occasional. **UNVERIFIED** |
| Pain points | Full equipment + warehouse read (more than needed); home shows admin quick actions; no "report a device problem" shortcut from a device row. |
| Compliance duties | None formal; they are the consumers of the calibration label. |

### P11 (not a role) — the KARS surveyor / external auditor ("seventh reader", existing `03-PERSONAS.md`)

Has no login. Today served by: public certificate verification (`/verify/[certificateNumber]`, `certificates.route.js` `GET /verify/:certificateNumber` and `/document`, no auth) and by an admin screen-sharing `/dashboard/audit` and `/dashboard/reports`. A read-only auditor role is **not in code** (Q1).

---

## 4. Key journeys (as-built, step by step)

API prefix `/api/v1`. Mount paths from `backend/swagger.json`. "Who" = roles the API allows by default.

### 4.1 Device → schedule → record → certificate → approve → e-sign → verify

| # | Step | Screen (route) | API | Who (default) | Status / gap |
|---|---|---|---|---|---|
| 1 | Register device (or bulk import, or IoT link) | `/dashboard/devices` — `DeviceModal`, `IotDeviceModal` | `POST /calibration-devices`, `POST /calibration-devices/bulk-import`, `/iot/*` | SA, HCA, CAA | UI shows button only to SA/HCA/**WH** (F3). Serial unique per tenant (migration 0026). Retire is terminal (0089); restore/reinstate exist. |
| 2 | Set interval / next due | device form (`nextCalibrationDate`, used by `dashboard.service.js`) | `PUT /calibration-devices/:id` | SA, HCA, CAA | — |
| 3 | See what is due; generate jobs | `/dashboard/calibration-scheduler` | `GET /calibration-scheduler/due`, `POST /calibration-scheduler/run` (gate: `maintenance`) | read: all with equipment; run: SA/HCA/CAA | Auto-scheduled work orders are unique per device/date (migration 0060). Hook special-cases SA only (`useScheduler.ts:16`). |
| 4 | Record calibration result | `/dashboard/calibration` tab **records** — `RecordCalibrationModal` | `POST /calibration-records`; corrections `POST /:id/corrections`; `POST /:id/void` | SA, HCA, CAA | Records are append-only (migration 0057). **Technicians cannot** (F4). |
| 5 | Draft certificate | tab **certificates** — `CreateCertModal` | `POST /certificates` (`deviceId`, optional `calibrationRecordId`, type, summary, conditions, standard, validUntil — `certificate.validator.ts`) | SA, HCA, CAA | — |
| 6 | **Submit for approval** | **none** | `POST /certificates/:id/submit` | SA, HCA, CAA | **Missing in UI (F2).** |
| 7 | Approve (Part 11 re-auth: method + payload + meaning) | `ApproveCertModal` (button shown on **draft**) | `POST /certificates/:id/approve` | SA, HCA, CAA | Backend requires `pending_approval` → 409 from draft. No action rendered on `pending_approval` rows. No creator≠approver check found in `certificate.service.js#approveCertificate` (**segregation of duties absent — UNVERIFIED whether intended**). |
| 8 | E-sign (key pair + Part 11 triple) | `SignCertModal` (button on `approved`) | `POST /certificates/:id/sign`; keys at `/dashboard/esignature` tab **keys** (`/esignature/key-pairs`, gated `qms`) | SA, HCA, CAA | Signer needs a key pair first; nothing in the sign modal links to key setup **UNVERIFIED**. |
| 9 | PDF / QR | row action | `GET /certificates/:id/pdf`, `/:id/document` (`frontend/src/lib/certificatePdf.ts`) | read roles | QR points to public verify (memory note `certificate-pdf-module.md`). |
| 10 | Public verification | `/verify/[certificateNumber]` (no login) | `GET /certificates/verify/:certificateNumber`, `/document` | anyone | Revoked stays verifiable as revoked (`DELETE_REFUSAL_EXPLANATIONS`). |
| 11 | Revoke (re-auth + reason) | `RevokeCertModal` (any non-revoked row) | `POST /certificates/:id/revoke` | SA, HCA, CAA | — |

Parallel signing path: generic signature workflows — `/dashboard/esignature` tabs `sign | keys | workflows | verify` (`esignature/page.tsx:34`), `GET /esignature/my-workflows` (my pending signatures), `POST /esignature/sign`. And approval workflows — `/dashboard/workflows`, `GET /workflows/instances/pending`, `POST /workflows/instances/:id/action` (gated on `certificate|warehouse|maintenance` write). **Two inboxes, neither on the home page.**

### 4.2 Maintenance work order

| # | Step | Screen | API | Who | Gap |
|---|---|---|---|---|---|
| 1 | Create WO (manual, or from scheduler run, or from predictive recommendation) | `/dashboard/maintenance` — `WorkOrderModal`; `/dashboard/predictive-maintenance` | `POST /maintenance`; `POST /predictive-maintenance/analyze/:deviceId`, `GET /recommendations`, `POST /recommendations/:deviceId/approve` (gate `calibration`) | SA, HCA, CAA | Whether approving a recommendation creates a WO: **UNVERIFIED**. |
| 2 | Work it: Open → InProgress → Completed / Cancelled; priority Low/Medium/High/Critical | row edit | `PATCH /maintenance/:orderId` | SA, HCA, CAA | IPSRS / technicians who do the work are read-only (F4). |
| 3 | Close with evidence | attachments (`/attachments`, `rbac TENANT_ADMIN`) | `POST /attachments` | level ≥ 8 | Non-admins cannot attach evidence. |
| 4 | Report | `/dashboard/reports` | `GET /reports/summary`, `/calibration-workload` | all equipment readers | — |

### 4.3 Stock & vendor

| # | Step | Screen | API | Who | Gap |
|---|---|---|---|---|---|
| 1 | Warehouses & locations | `/dashboard/warehouses` (= `/warehouse` re-export) | `/warehouses`, `/warehouses/:id/locations`, `/warehouses/locations` | W: SA, HCA, WH | CAA read only. |
| 2 | Stock items | `/dashboard/stock` (**no menu**) tabs inventory / transfers / adjustments / opname / reports | `/stocks`, `POST /stocks/adjustment`, `/stocks/transfer` + `PATCH /transfer/:id`, `/stocks/opname` + `PATCH /opname/:id`, `/stocks/reports/summary|export` | W: SA, HCA, WH | Orphan (F7). |
| 3 | Vendor onboarding & qualification | `/dashboard/vendors` | `POST /vendors`, `PATCH /vendors/:id/qualify` | W: SA, HCA, CAA; EM read | — |
| 4 | Score supplier | `/dashboard/supplier-scorecard` | `/supplier-scorecard` | W: SA, HCA | — |

### 4.4 Ticket / support desk (tenant → platform)

| # | Step | Screen | API | Who |
|---|---|---|---|---|
| 1 | Raise | `/dashboard/tickets/raise` (`/dashboard/tickets` redirects here) — `CreateTicketModal` | `POST /tickets` | every tenant role; **not SA** |
| 2 | Converse | `/dashboard/tickets/[ticketId]` | `POST /tickets/:id/comments` | raiser, assignee, responders |
| 3 | Triage / assign / resolve | `/dashboard/tickets/response` | `POST /tickets/:id/assign`, `PATCH /tickets/:id`, `GET /tickets/metrics` | `RESPONDER_ROLES`; SA across tenants |
| Gap | Help-desk sits under Management › Work & Projects; for most users it is their only Management item. Notification deep-links to the ticket: **UNVERIFIED**. |

### 4.5 Audit log review

| # | Step | Screen | API | Who |
|---|---|---|---|---|
| 1 | Open audit | `/dashboard/audit` | `GET /audit` (`audit` read) | SA, HCA, CAA (EM ‡) |
| 2 | Filter | scope **My tenant / Platform**, Resource Type (free text "e.g. Device, User…"), Start/End Date (`audit/page.tsx`) | query params | — |
| Gaps | No actor/user filter, no action filter, no record-level "history" link from a device/certificate row, no export found in the page (**UNVERIFIED** — backend may support). Audit rows are append-only (migration 0091) and carry actor/impersonator (0029, 0033). Part 11 §11.10(e) expects reviewers to reconstruct a record's history — record-scoped view is the missing piece. |

### 4.6 Tenant onboarding (by SUPERADMIN)

| # | Step | Screen | API |
|---|---|---|---|
| 1 | Create tenant (Name, Code, Description, brand colour, Max Users, contact, address, website) | `/dashboard/tenants` — `CreateTenantModal`, `TenantFormFields.tsx` | `POST /tenants/create` |
| 2 | Logo | same | `POST /tenants/:tenantId/logo` |
| 3 | Settings: SSO (`SsoConfigTab`/`SsoSpTab`/`SsoXmlTab`), MFA policy (`MfaPolicyPanel`) | tenant card → settings | `POST|PATCH /tenants/settings` |
| 4 | Feature flags | `/dashboard/feature-flags` | `POST /feature-flags/:tenantId/initialize`, `/:tenantId/:flagKey` |
| 5 | Place in hierarchy (optional) | `/dashboard/tenant-hierarchy` | `POST /tenant-hierarchy/:tenantId/children` |
| 6 | Create first tenant admin (pick role + tenant) | `/dashboard/users` | `POST /users` |
| 7 | Admin first sign-in → forced change password (A-123) → MFA if policy | `/dashboard/change-password`, `/dashboard/mfa` | `/auth/just-update-password`, `/auth/mfa/setup|verify` |
| 8 | Verify as the tenant | impersonate | `POST /auth/impersonate`, `/auth/impersonate/exit` |
| 9 | Later: backup / suspend / offboard | `/dashboard/tenants/[tenantId]/backup`, `/dashboard/tenant-lifecycle` | tenant backup routes; `POST /tenants/:tenantId/suspend|resume|grace-period|offboard` |
| Gap | **No wizard, 5–7 separate screens, nothing links step 1 → step 6.** Custom domain, storage and SSO live in different groups. Suspending the default tenant is a known trap (CLAUDE.md). |

---

## 5. Role-specific home proposal

Principle: **home = "what needs me now" (queues) + "is anything out of compliance" (KPIs) + role shortcuts**, each widget rendered only if the user holds the gate of its endpoint (so no widget can 403). Existing aggregate: `GET /dashboard/metrics` (auth only; tenant-scoped, global + `tenantBreakdown` for SA) returns `users{total,verified}`, `devices{total,byStatus,dueSoon(30d),overdue}`, `calibrations{total,compliant,recent30d}`, `certificates{total,byStatus}`, `inventory{items,totalQuantity,lowStock,warehouses,pendingTransfers,openOpnames}`, `maintenance{openWorkOrders}`, `trends{calibrations,certificates}` (`backend/src/services/dashboard.service.js`). Note: because it is auth-only, every role currently receives user counts and inventory totals — decide whether to trim per role (Q4).

| Role | Queues (top) | KPIs | Shortcuts | Endpoints |
|---|---|---|---|---|
| SA | Open tickets across tenants; tenants in grace/suspended; failed batch jobs | Tenants by status, active sessions, platform health, usage vs plan | New tenant (wizard), impersonate, respond to ticket | `/dashboard/metrics` (global + `tenantBreakdown`), `/tickets/metrics`, `/admin/tenants`, `/sessions/stats`, `/api/v1/health` (SA), `/jobs` |
| HCA | Certificates `pending_approval`; my signatures (`my-workflows`); pending workflow instances; open NC/CAPA; tickets to respond | Devices overdue / due ≤30d, % compliant (MFK readiness), open WOs, low stock | Approve certificate, add user, audit trail, compliance report | `/dashboard/metrics`, `/certificates?status=pending_approval`, `/esignature/my-workflows`, `/workflows/instances/pending`, `/qms/nc`, `/qms/capa`, `/tickets/metrics`, `/reports/compliance` |
| CAA | Calibrations due (scheduler); drafts to submit; certs to approve / sign; kanban cards | Workload by week, certificates by status, turnaround **UNVERIFIED metric** | Record calibration, new certificate, run scheduler | `/calibration-scheduler/due`, `/certificates/stats`, `/reports/calibration-workload`, `/kanban/projects`, `/esignature/my-workflows` |
| EM | Overdue devices list; my signatures; tickets | Compliance %, overdue, WO backlog, risk register top items, depreciation | Compliance report, overdue report | `/reports/compliance`, `/reports/overdue-devices`, `/reports/summary`, `/risk`, `/finance/reports/depreciation`, `/esignature/my-workflows` |
| SPV | Team WOs open/in-progress; tickets to respond; my signatures | Due this week, WO by priority | Kanban board, respond to ticket | `/maintenance`, `/calibration-scheduler/due`, `/tickets`, `/kanban/projects` |
| TEC / HTE | **My jobs today** (due devices), my kanban cards, my signatures | Due today / overdue (mine — needs assignee filter **UNVERIFIED**) | Scan/search device, record calibration (if granted), raise ticket | `/calibration-scheduler/due`, `/search`, `/kanban/projects`, `/esignature/my-workflows` |
| FM (IPSRS) | Open WOs (mine), my signatures | Critical/High WOs | Update WO, raise ticket | `/maintenance`, `/esignature/my-workflows` |
| WH | Pending/in-transit transfers, open opnames | Low-stock items, total quantity | New transfer, adjustment, start opname | `/stocks/reports/summary`, `/stocks/transfer/history`, `/stocks/opname/history`, `/dashboard/metrics` (inventory) |
| RU / USR | My tickets | Devices in my room by status (needs location filter **UNVERIFIED**) | Find device, report problem | `/tickets`, `/calibration-devices`, `/search` |

Replace the current `DashboardQuickActions` (same six actions for all) and the "recent users" panel (only meaningful to user admins).

---

## 6. Proposed information architecture (covers every existing menu)

Groups ordered by frequency of use (work first, administration last). Visibility of every leaf = the API gate in §2, evaluated with the same one-level rule the API uses (fix F1) and including per-user overrides (fix F9). ID label first.

| # | Group (ID / EN) | Leaf (ID / EN) | Current slug → route | Change |
|---|---|---|---|---|
| 0 | **Beranda / Home** | (role home) | `home` → `/` and `dashboard` → `/dashboard` | **Merge** duplicates; stop linking to public landing (F6) |
| 1 | **Pekerjaan Saya / My Work** | Tugas & Persetujuan / Tasks & Approvals | new aggregate of `/esignature/my-workflows`, `/workflows/instances/pending`, certs `pending_approval` | **New** — one inbox |
| | | Tiket Saya / My Tickets | `tickets-raise` → `/dashboard/tickets/raise` | Moved out of Management |
| | | Notifikasi / Notifications | `notifications` | Moved from Account (bell stays) |
| 2 | **Alat Kesehatan / Equipment** | Daftar Alat / Devices | `calibration` → `/dashboard/devices` | Rename slug-label pair (F8) |
| | | Jadwal Kalibrasi / Calibration Schedule | `calibration-scheduler` | Gate on the slug it names (F8) |
| | | Catatan Kalibrasi / Calibration Records | `certificate` → `/dashboard/calibration` (records tab) | **Split** records from certificates |
| | | Sertifikat / Certificates | same page (certificates tab) | Split; add Submit (F2) |
| | | Pemeliharaan / Maintenance (Work Orders) | `maintenance` | — |
| | | Pemeliharaan Prediktif / Predictive Maintenance | `predictive-maintenance` | Gate on own slug (F8) |
| | | Laporan / Reports | `reports` | — |
| 3 | **Gudang & Pengadaan / Inventory & Procurement** | Stok / Stock | *(orphan)* `/dashboard/stock` | **Add to nav** (F7) |
| | | Gudang & Lokasi / Warehouses & Locations | `warehouse` → `/dashboard/warehouses` | Retire `/dashboard/warehouse` duplicate |
| | | Vendor / Vendors | `vendors` (was Management › Partners) | Moved |
| | | Kinerja Pemasok / Supplier Scorecards | `supplier-scorecard` | Moved |
| 4 | **Mutu & Kepatuhan / Quality & Compliance** | Ketidaksesuaian & CAPA / NC & CAPA | `qms` | — |
| | | Dokumen SOP / SOP Documents | `sop` | — |
| | | Register Risiko / Risk Register | `risk` | — |
| | | Tanda Tangan Elektronik / E-Signatures (keys, workflows, verify) | `esignature` | Signing inbox moves to My Work; admin tabs stay |
| | | Alur Persetujuan / Approval Workflows | `workflows` (was Management › Work) | Moved |
| | | Jejak Audit / Audit Trail | `audit` | Add record-scoped view |
| | | Asisten AI / AI Assistant | `ai-assistant` | Consider moving to global header action |
| 5 | **Kolaborasi / Collaboration** | Papan Kanban / Kanban Boards | `kanban` | — |
| | | Layanan Tiket / Ticket Desk (respond) | `tickets-response` | — |
| 6 | **Keuangan / Finance** | Keuangan Aset / Asset Finance (depreciation) | `finance` | Separate from SaaS billing |
| | | Tagihan & Langganan / Billing & Subscription | `billing` | + quota (`GET /quota` has no page today) |
| | | Penggunaan & Meteran / Usage & Metering | `metered-billing` | — |
| 7 | **Administrasi Organisasi / Organization Admin** (tenant admin, level ≥ 8) | Pengguna / Users | `users` | — |
| | | Profil Organisasi / Organization Profile (logo, contact, SSO, MFA policy) | `tenants` (own tenant) | Tenant admin sees *own* tenant as a settings page, not a tenant list |
| | | Penyimpanan / Storage | *(orphan)* `/dashboard/storage` | **Add to nav** (F7) |
| | | Domain Kustom / Custom Domains | `custom-domains` (was Security) | Moved |
| | | Integrasi / Integrations: API Keys, Webhooks, SCIM, OIDC | `api-keys`, `webhooks`, `scim`, `oidc` | Merge Developer + identity integrations |
| | | Keamanan Jaringan / Network Security | `network-security` | — |
| | | Privasi & Retensi / Privacy & Retention | `gdpr`, `data-retention` | Merge (were Security vs Quality) |
| | | Berkas & Dokumen / Files & Documents | `attachments` | — |
| 8 | **Platform** (SUPERADMIN only) | Tenant / Tenants | `tenants` (all) | — |
| | | Hierarki Tenant / Tenant Hierarchy | `tenant-hierarchy` | SA-only writes; tenants read-only view could live in Org Admin |
| | | Siklus Hidup Tenant / Tenant Lifecycle | `tenant-lifecycle` | — |
| | | Cadangan / Backups | `/dashboard/tenants/[tenantId]/backup` | Surface as tenant sub-page |
| | | Peran & Menu / Roles & Menus | `roles`, `menu-groups`, `permissions` | **Merge 3 pages** into one permission matrix editor |
| | | Izin Pengguna / User Permission Overrides | `user-permissions` | — |
| | | Sesi / Sessions | `sessions` | — |
| | | Fitur / Feature Flags | `feature-flags` (was Developer) | Moved |
| | | Tugas Latar / Background Jobs | `batch-jobs` | Moved from Work |
| | | Konten Blog & Berita / Blog & News | `content` | Platform marketing, out of tenant Management |
| 9 | **Akun Saya / My Account** (user menu, top-right — not sidebar) | Profil / Profile | `profile-page` | — |
| | | Ubah Kata Sandi / Change Password | `change-password` | Available to every role (today 5 roles lack it) |
| | | Autentikasi Dua Faktor / Two-Factor (MFA) | *(orphan)* `/dashboard/mfa` | Link it |
| | | Passkey / Passkeys (WebAuthn) | `webauthn` (was Security) | Self-service for all |
| | | Data Pribadi Saya / My Data (GDPR export, consent) | `gdpr` self routes | Self-service for all |

Coverage check — every seeded slug appears above: home, dashboard, account(→9), management(dissolved), equipment, security(dissolved), warehouse, change-password, profile-page, notifications, menu-groups, tenants, roles, users, calibration, certificate, permissions, sessions, user-permissions, vendors, billing, audit, api-keys, webhooks, attachments, content, maintenance, calibration-scheduler, reports, feature-flags, tenant-lifecycle, data-retention, oidc, webauthn, network-security, scim, risk, supplier-scorecard, qms, sop, workflows, finance, metered-billing, tenant-hierarchy, batch-jobs, gdpr, custom-domains, kanban, tickets-raise, tickets-response, esignature, ai-assistant, predictive-maintenance; plus orphans stock, storage, mfa, warehouse-duplicate, tenants/[id]/backup. The seven `mgmt-*` category nodes are replaced by groups 3–8.

**Summary of IA defects fixed:** orphaned = stock, storage, mfa (and quota endpoint without a page); duplicated = Home/Dashboard, `/warehouse`/`/warehouses`, 4 permission pages, two signing inboxes, audit scope toggle vs platform audit; mis-grouped = tickets under Management, vendors under Management, custom-domains/webauthn/gdpr under Security, data-retention under Quality, feature flags under Developer, blog under tenant Management, asset finance beside SaaS billing, admin groups ordered before daily-work groups (Management sortOrder 3 < Equipment 4).

This IA changes the seeded menu tree — **needs an ADR** and a migration re-parenting slugs (slugs themselves can stay; route gates name slugs).

---

## 7. Open questions for the owner (not judgement calls)

| # | Question | Why it blocks design |
|---|---|---|
| Q1 | Add a read-only **AUDITOR** role (audit, reports, certificates read; no PII admin)? | P11 has no login; EM lacks audit today. |
| Q2 | Should TECHNICIAN / HEALTHCARE TECHNICIAN / FACILITY MAINTENANCE get `calibration`/`maintenance` **write**, and SUPERVISOR/EM certificate **approve**? | F4 decides whether their home is a work queue or a read-only view. |
| Q3 | Enforce **creator ≠ approver** on certificates? | Part 11 / ISO 17025 review expectation; changes the approval UI. |
| Q4 | Trim `GET /dashboard/metrics` per role (users/inventory counts to all)? | Home widgets must not show data the role could not otherwise read. |
| Q5 | Should tenant admins edit their own roles' grants (today SA-only)? | Determines whether "Roles & Permissions" appears in Org Admin. |
| Q6 | Seed tenant admins with `security` group or keep per-child grants? | Affects F1 fix and Org Admin grouping. |

## 8. Validation plan (to turn proto-personas into personas)

| Method | Participants | Output |
|---|---|---|
| 45-min contextual interviews | 2 per role cluster (admin, manager/supervisor, technician/IPSRS, warehouse) at 2 hospitals + 1 calibration lab = ~16 | Confirm goals, frequency, devices used (tablet share), language preference ID/EN |
| Task-based usability test on current UI | 5 per cluster (Nielsen: 5 finds ~85% of issues per homogeneous group) | Baseline completion/time for 4.1 steps 4–8, 4.2 step 2, 4.3 step 2, 4.5 |
| Card sort (hybrid, bilingual) of the §6 leaves | 15–20 across roles | Validate group names and placement in ID and EN |
| Accessibility check with screen-reader + keyboard-only user | 2 | WCAG 2.1 AA baseline for dense tables and sign modals |
| Instrumentation (post-launch) | all | Menu click-through, 403 rate per menu item (should be 0 after F1 fix), time-to-approve certificate |
