# Feature Spec — P18-03 Facility Scope ↔ Permissions: the Bound Role Set, the Bound Menu Ceiling, the Facility-Accessible Route List, `FACILITY_READABLE`, and the Upstream Role × Slug × Scope Matrix

**Written:** 2026-10-07 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P18-03 (Phase 18, Role & Permission Mapping). Consumed by P18-04 (the two-tenant / two-facility test plan), P19-04 (client-facility spec: the marker's exact name and the hook mechanics), P18-01 / P18-02 (the role and grant halves that wait on UD-4), P20-06 (the slug migration), P21-09 (the build), P22-09 (the restricted navigation), P17-07 (the penetration test)
**Author:** Identity & Access Engineer agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation)
**Card scope (verbatim):** *"Facility scope ↔ permissions (ADR-124 § 5, § 7): the facility-accessible route list, the `FACILITY_READABLE` model list, the bound role set, which menus a bound user may hold."*
**Also asked by the coordinator (and delivered here, marked by whose card owns it):** the full matrix upstream group → our role → per slug read / write / approve → bound or tenant-wide → which routes carry the marker; the new slugs and their seed/migration plan (P18-02 / P20-06); separation of duties for IPM (P19-02 / P19-06, UD-17); API keys and SSO; the guards and tests.
**Decision record:** **ADR-124 Amendment 1** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-124 § 4, § 5, § 7, § 9, § 10 · ADR-125 § 4 – § 6 and Amendment 1 § 2 · ADR-126 § 3, § 8 · ADR-101 (separation of duties) · ADR-102 (one effective permission) · ADR-052 (`denyPlatformAuthoring`) · ADR-064 (roles global) · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` § 3, EP-06, EP-09, EP-10, EP-12, § 9 F-5/F-7, § 10 AM-8/AM-11/AM-14, § 11 G-09/G-10/G-12, § 13 OQ-2/OQ-4/OQ-8/OQ-9 · `docs/PLAN/03-USER-ROLES.md` · `docs/UPSTREAM/00-OVERVIEW.md` § 4 · `docs/UPSTREAM/01-MODULES.md` § Role Mapping · `MEMORY/specs/P19-01-inspection-catalogue.md` § 8 · code: `backend/src/constants/roleConstants.ts`, `seededMenuSlugs.ts`, `menuPageAccess.ts`, `routeGateExemptions.ts`, `attachmentResources.ts`; `utils/seedMenuGroups.util.ts`; `services/roles.service.ts#getRolePermissionsMatrix`, `services/effectivePermission.service.ts`; `routes/api/*.route.ts` (every gate read 2026-10-07); `services/sso.service.ts:302`, `services/scim.service.ts#assertAssignableRole`

> **Privacy.** No upstream data value appears here. Upstream group names and user **counts** per group are structural (`docs/UPSTREAM/00-OVERVIEW.md` § 4); no name, e-mail, facility or room is named.

---

## 1. Problem

ADR-124 decided that a facility's own staff are users of the provider tenant **bound** to their facility, confined by a second deny-by-default scope in the hooks (data) and by a route marker (actions). It left four lists to this card: which routes carry the marker, which non-facility tenant models a bound user may still read, which roles a bound user may hold, and which menus. Without them three things break:

1. **Escalation.** A bound `HEALTHCARE ADMIN` has `ROLE_LEVELS` 8 = the `TENANT_ADMIN` tier and today's default grants of a tenant administrator (`users` write, `api-keys`, `storage`, … — `ROLE_MENU_ASSIGNMENTS`). The marker is the only thing between it and the provider's administration (threat model FT-37, F-7).
2. **The sidebar lies.** ADR-102 made the menu, the page buttons and the API read one effective permission. A bound user whose role grants `users` write but whose routes all answer 403 would see pages that 403 — the defect ADR-102 removed.
3. **Fail-closed surprises.** A bound user's own sessions, notifications and consent records live in tenant tables; with the deny branch and no `FACILITY_READABLE` entry they vanish (FT-29), and service-internal reads (settings, quotas, storage configuration) made on the bound user's behalf return nothing.

---

## 2. What Is Already Decided (not re-decided here)

| Decision | Source |
|---|---|
| Bound iff `users.client_facility_id` is set; set by the tenant's administrator; never from a request or a role name | ADR-124 § 4 |
| Bound users may hold only `HEALTHCARE ADMIN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE`, `ROOM USER` (400 otherwise) | ADR-124 § 4 |
| Facility dimension in the same hooks; DENY for tenant models neither facility-scoped nor on `FACILITY_READABLE` | ADR-124 § 5 |
| Cross-facility = 404; own-facility permission failure = 403 | ADR-124 § 6 |
| Routes deny bound users unless marked facility-accessible; the marker is refused on `superAdminOnly` and `rbac()` tenant-admin routes | ADR-124 § 7 |
| Search and RAG not facility-accessible until their own review; API keys tenant-wide; one SSO configuration per tenant | ADR-124 § 9 |
| Catalogue reads gated `["calibration", "ipm", "ipm-templates"]` read and facility-accessible; proposals not; operator writes `superAdminOnly` | ADR-125 § 6, Am. 1 § 2; P19-01 spec § 8 |
| IPM: create `ipm` write; edit/submit the draft's creator; void an **unbound** tenant administrator (rbac) | ADR-126 § 3 |
| A certificate's author may not approve it (403) | ADR-101 |
| One effective permission for API, sidebar and buttons; a role grant reaches its menu's **direct children**; a per-user override replaces it | ADR-102; `roles.service.ts#getRolePermissionsMatrix` |

---

## 3. What the Code Says (read 2026-10-07) That Shapes the Design

| # | Fact | Where | Consequence here |
|---|---|---|---|
| C-1 | `calibration`, `certificate`, `maintenance`, `calibration-scheduler`, `reports`, `predictive-maintenance` are **children of `equipment`**; a grant on `equipment` reaches them | `utils/seedMenuGroups.util.ts` (children under Equipment); `roles.service.ts` lines 754 – 765 | `ROOM USER`, `USER`, `WAREHOUSE STAFF` read certificates and calibration records today through `equipment` read; a new `ipm` slug placed under `equipment` inherits the same way (§ 7) |
| C-2 | The technical roles are **read-only** by default: `TECHNICIAN`, `HEALTHCARE TECHNICIAN`, `FACILITY MAINTENANCE` hold `equipment` read only, so they cannot register a device or record a calibration (UI research 03 F4, open there as Q2) | `ROLE_MENU_ASSIGNMENTS` | upstream technicians (`user`, `teknisi_client`) register devices; the matrix marks those cells **UD-4 (b)** (§ 14) |
| C-3 | `HEALTHCARE ADMIN` = level 8 = `TENANT_ADMIN`; `rbac` allows higher | `roleConstants.ts`; `rbac.middleware.ts` | a bound HA passes `rbac([TENANT_ADMIN])` — the marker refusal list must cover it (§ 9) |
| C-4 | `POST /attachments` (upload) is gated by `equipment` **read**, and accepts standalone resource types `generic`, `ticket`, `post` | `attachments.route.ts`; `constants/attachmentResources.ts` | a bound `ROOM USER` could upload into the tenant's storage; the bound form is narrowed (§ 8, A-5) |
| C-5 | `denyPlatformAuthoring` is a Part 11 **authorship** guard (ADR-052), on calibration-record writes, certificate writes and `POST /esignature/sign` — not an administration gate | `calibrationRecords.route.ts`, `certificates.route.ts`, `eSignature.route.ts` | the threat model's AM-11 proposes refusing the marker on it; that would forbid the bound technician's IPM capture, which will carry it. Refined in § 9 |
| C-6 | Tenant-backup routes are gated by `abac([TENANT_PERMISSIONS.*], { checkTenant: true })`, not `rbac` | `tenantBackup.route.ts` | the refusal list covers `abac` (AM-11) |
| C-7 | SSO JIT creates an **unbound `USER`**; SCIM assigns any role but SUPERADMIN | `sso.service.ts:302`; `scim.service.ts#assertAssignableRole` | § 12 |
| C-8 | `GET /menu-groups/my-permissions` → `{ superAdmin, permissions }`, from `effectivePermission.service`; the sidebar filters through the same function + `MENU_PAGE_GATES` | `menuGroup.service`, `effectivePermission.service.ts` | the bound ceiling goes **into** `effectivePermission`, so sidebar, buttons and API agree for bound users with no second rule (§ 5) |
| C-9 | `webauthn_credentials` and `notification_states` have **no** `tenant_id` | models | the hooks never scope them; no `FACILITY_READABLE` entry needed (§ 10) |
| C-10 | `PATCH /users/:userId/profile` and the avatar routes pass a non-holder through `dynamicAccess(..., { checkSelf: true })` when the path is the caller | `user.route.ts` | a bound user's own profile works only through the self path; the marker carries `selfParam` (§ 8, § 9) |

---

## 4. The Bound Role Set and the Upstream Mapping

### 4.1 The bound role set (decided by ADR-124 § 4; confirmed here against the code)

`FACILITY_BOUND_ROLES = [HEALTHCARE ADMIN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE, ROOM USER]` — a constant beside `ROLE_NAMES` (target, `constants/facilityAccess.ts`). **No new role** is needed: each upstream actor maps to an existing role, and `ROLE_LEVELS` is unchanged. `USER`, `WAREHOUSE STAFF`, `SUPERVISOR`, `ENGINEERING MANAGER`, `TECHNICIAN`, `CALIBRATOR ADMIN` and `SUPERADMIN` may never be bound (400, ADR-124 § 4).

Level is **not** scope: a bound `HEALTHCARE ADMIN` keeps level 8 for the comparisons the code makes, and is held out of administration by the route default (§ 8 – § 9) and the ceiling (§ 5) — never by lowering its level, which would change every self-served hospital's administrator too.

### 4.2 Upstream group → our role → scope (Matrix A)

| Upstream group (`auth_groups`) | Users (dump) | Our role | Scope | Decided by | Notes |
|---|---:|---|---|---|---|
| `admin` (Administrator SKP) | 10 | `CALIBRATOR ADMIN` | **unbound** — every facility of the provider tenant | scope: ADR-124 § 4; role: **UD-4 (a)** (recommended) | administers users, facilities, bindings; may void IPM (ADR-126) |
| `user` (Teknisi SKP) | 35 | `TECHNICIAN` | **unbound** | scope: ADR-124; role: **UD-4 (a)** | field capture across facilities (P2 of the threat model); device and calibration-date writes need **UD-4 (b)** (C-2) |
| `client` (faskes account, read-only) | 57 | first account per facility `HEALTHCARE ADMIN`, the others `ROOM USER` | **bound** to its one facility (`trx_mapping_user_client`: one facility each) | scope: ADR-124; role: **UD-4 (a)** | a bound HA is **not** a tenant administrator (ADR-124 § 7); read-only in this group (§ 5) |
| `teknisi_client` (Teknisi FASKES) | 3 | `HEALTHCARE TECHNICIAN` | **bound** | scope: ADR-124; role: **UD-4 (a)** | registers devices and captures IPM **in its own facility** (upstream `inventorySaveClient`, `ipmSave`); device writes need **UD-4 (b)** |
| IPSRS (no upstream account; wet signature on the IPM report) | 0 | `FACILITY MAINTENANCE` | **bound** (in a provider tenant) / unbound (a self-served hospital's own IPSRS) | **UD-17** | created only where a facility enables countersigning |
| registered, no group (open registration, S-04) | — | none | not imported | AM-27 (P24-02) | quarantined by the ETL |
| — (no upstream group) | — | `ENGINEERING MANAGER`, `SUPERVISOR` | unbound | as today | optional provider management roles |
| platform operator | — | `SUPERADMIN` | skips both dimensions | as today | the only catalogue writer (ADR-125) |

The operator names the real person behind each shared upstream account at invitation (UD-4, Part 11 attributability); a person who works for two facilities gets two accounts (ADR-124 § 10).

---

## 5. Which Menus a Bound User May Hold — the Bound Menu Ceiling

### 5.1 The rule

For a **bound** principal, the effective permission of ADR-102 gains one last step:

```
effective(bound user, slug) = min( roleMatrix ⊕ userOverride (as today),
                                   BOUND_MENU_CEILING[role][slug] )        -- absent ⇒ none
```

- It lives in `effectivePermission.service.ts`, the one function `dynamicAccess`, the sidebar and `GET /menu-groups/my-permissions` read — so the API, the menu and the buttons cannot disagree for a bound user, and a per-user override cannot lift a bound user above the ceiling.
- Unbound principals are untouched: `effectivePermission.adr102` and `menuEffectiveAccess.adr102` must stay green unchanged (the P7 regression risk of the threat model).
- The ceiling is **not** the route layer: a slug in the ceiling still reaches only the routes marked facility-accessible (§ 8). The ceiling keeps the menu honest; the marker keeps the actions narrow. A consistency guard ties them (§ 15, G-P3).

### 5.2 The ceiling (Matrix B) — R = read, W = write, — = none

| Slug | Bound `HEALTHCARE ADMIN` | Bound `HEALTHCARE TECHNICIAN` | Bound `FACILITY MAINTENANCE` | Bound `ROOM USER` | Why |
|---|---|---|---|---|---|
| `home`, `dashboard` | R | R | R | R | the app shell; the metrics call is marked only under OQ-8 (§ 8 A-11) |
| `profile-page`, `change-password` | W | W | W | W | own profile and password (self routes) |
| `equipment` | R | R | R | R | parent menu; gates attachment reads |
| `calibration` | R | **W** ¹ | R | R | device list = the facility inventory and its export (ADR-126 § 8); HT registers devices (upstream parity) |
| `certificate` | R | R | R | R | the facility's certificates; issuing is the laboratory's (ISO/IEC 17025 7.8) — never bound |
| `maintenance` | R | R | R | R | work orders on the facility's devices (read) |
| `ipm` (new) | R | **W** | R (+ countersign, **UD-17**) | R | HT captures IPM in its facility (upstream parity); void is unbound-only |
| `ipm-templates` (new) | R | R | R | R | published catalogue is global content; proposals are not facility-accessible |
| `esignature` | — | **UD-17** | **UD-17** | — | signing the IPM report as performer / IPSRS waits on P19-06 + UD-17; signature tables are provider-internal until then |
| `warehouse` | **UD-10** (R) | **UD-10** (R) | **UD-10** (R) | **UD-10** (R) | rooms as locations of the facility; until UD-10 decides, none |
| every other slug (`account`, `management`, `users`, `roles`, `permissions`, `user-permissions`, `menu-groups`, `sessions`, `tenants`, `tenant-hierarchy`, `tenant-lifecycle`, `client-facilities`, `access-requests`, `security`, `oidc`, `webauthn`, `network-security`, `scim`, `gdpr`, `custom-domains`, `api-keys`, `webhooks`, `storage`, `attachments`, `feature-flags`, `billing`, `finance`, `metered-billing`, `audit`, `data-retention`, `batch-jobs`, `content`, `stock`, `vendors`, `supplier-scorecard`, `qms`, `sop`, `workflows`, `risk`, `kanban`, `tickets-raise`, `tickets-response`, `reports`, `predictive-maintenance`, `calibration-scheduler`, `ai-assistant`, `notifications`, `mgmt-*`) | — | — | — | — | provider administration or provider-internal data (FT-26, FT-37); reports/search/AI unreviewed (FT-57 … FT-59) |

¹ **Bound HT `calibration` W is effective only if UD-4 (b) grants `HEALTHCARE TECHNICIAN` `calibration` write** (today its role holds read; the ceiling never adds a grant). Until then a bound HT registers no device, which is the strict reading — the ceiling is ready either way.

**Bound `HEALTHCARE ADMIN` is read-only in this group** (parity with upstream `client`, least privilege). Its difference from a bound `ROOM USER` is organisational (the facility's contact; the person a later "facility user management" feature would serve — **UD-4 (c)**, recommended *not in this group*) and, if UD-17 chooses it, an approval role on the IPM report.

**Tickets** (`tickets-raise`) are not in the ceiling: the desk is tenant ↔ platform; a facility's staff talk to their provider, not to the platform operator. A "request to the provider" feature is later, with a per-user `FACILITY_READABLE` rule (OQ-9).

---

## 6. The Full Permission Matrix (Matrix C) — Slug × Action × Principal

`SA` super admin · `CA` `CALIBRATOR ADMIN` (provider admin, unbound) · `T` `TECHNICIAN` (provider technician, unbound) · `EM/SV` `ENGINEERING MANAGER` / `SUPERVISOR` (unbound) · `HA·u` `HEALTHCARE ADMIN` unbound (a self-served hospital's administrator) · `HA·b` / `HT·b` / `FM·b` / `RU·b` the bound roles. **F** = within its own facility only (hooks + marker); **all** = every facility of its tenant. Cells marked **UD-n** depend on that open decision; ✱ = default grant to be added by P18-02/P20-06 (§ 7).

| Slug → action | SA | CA | T | EM/SV | HA·u | HT·b | FM·b | RU·b | HA·b |
|---|---|---|---|---|---|---|---|---|---|
| `calibration` read (devices, records, IoT config) | ✔ | all | all | all | all | F | F | F | F |
| `calibration` write — device create / edit | ✔ | all | **UD-4 (b)** | — | all | F, **UD-4 (b)** | — | — | — |
| `calibration` write — device delete / bulk import | ✔ | all | **UD-4 (b)** | — | all | — (unmarked) | — | — | — |
| `calibration` write — device restore / reinstate (`rbac TENANT_ADMIN`) | ✔ | all | — | — | all | — | — | — | — (refused) |
| `calibration` write — calibration record create / correct / void | ✔ ² | all | **UD-4 (b)** | — | all | — (unmarked: lab work) | — | — | — |
| `certificate` read (list, get, data document, PDF link) | ✔ | all | all | all | all | F | F | F | F |
| `certificate` generate / approve / sign / revoke | ✔ ² | all (ADR-101: not its own) | — | — | all (ADR-101) | — | — | — | — |
| `maintenance` read (work orders) | ✔ | all | all | all | all | F | F | F | F |
| `maintenance` create / update / delete | ✔ | all | — | — | all | — | — | — | — |
| `ipm` read (sessions, history, report data document) | ✔ | all | all | all | all | F | F | F | F |
| `ipm` write — create draft, edit own draft, submit, discard own draft, correct | ✔ ² | all | all ✱ | — | all | F ✱ | — (unbound FM: all ✱) | — | — |
| `ipm` void (unbound tenant administrator, `rbac`) | ✔ ² | all | — | — | all | — | — | — | — (refused) |
| IPM report: performer signature | — | own sessions | own sessions | — | own sessions | own sessions, **UD-17** | — | — | — |
| IPM report: IPSRS countersignature | — | — | — | — | — | — | F, **UD-17** (unbound FM of a self tenant: all) | — | **UD-17** |
| `ipm-templates` read (published catalogue) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `ipm-templates` write — proposals (submit, withdraw) | queue | ✔ ✱ | — | — | ✔ ✱ | — | — | — | — (unmarked) |
| catalogue authoring, publish, retire, accept proposals (`superAdminOnly`) | ✔ | — | — | — | — | — | — | — | — |
| `client-facilities` read (list, get) | ✔ | all ✱ | — | read ✱ (EM) | its self facility ✱ | — | — | — | — |
| `client-facilities` write (create, edit, status) | ✔ | ✔ ✱ | — | — | ✔ ✱ (self facility only) | — | — | — | — |
| own facility (`GET /client-facilities/mine`, self) | n/a | null | null | null | self facility | own | own | own | own |
| bind / unbind / move a user (`users` write + unbound + level ≥ 8) | ✔ | ✔ | — | — | ✔ | — | — | — | — (refused) |
| `attachments` read on facility resources | ✔ | all | all | all | all | F | F | F | F |
| `attachments` upload | ✔ | all | all | all | all | F: device / IPM photos only (§ 8 A-5) | — | — | — |
| `reports` (`/summary`, `/compliance`, `/calibration-workload`, `/overdue-devices`, `/inventory`) | ✔ | all | all | all | all | — | — | — | — |
| `dashboard` metrics | ✔ | all | all | all | all | F, **OQ-8** | F, OQ-8 | F, OQ-8 | F, OQ-8 |
| `warehouse` (rooms) read | ✔ | all | all | all | all | F, **UD-10** | F, UD-10 | F, UD-10 | F, UD-10 |
| `users`, `roles`, `api-keys`, `webhooks`, `storage`, settings, SSO/OIDC/SCIM, backups, billing, audit, data retention, GDPR administration, feature flags, custom domains, network security, tenant hierarchy / lifecycle | ✔ | as today | as today | as today | as today | — | — | — | — (refused) |
| `stock`, `vendors`, `qms`, `sop`, `workflows`, `risk`, `kanban`, `tickets-*`, `search`, `ai-assistant`, `predictive-maintenance` | as today | as today | as today | as today | as today | — | — | — | — |
| own profile, password, MFA, passkeys, sessions, notifications, GDPR data-subject rights | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

² `denyPlatformAuthoring` (ADR-052): the super admin authors Part 11 records only as a member of its home tenant; the IPM writes carry the same guard (ADR-126 sessions are Part 11 records).

---

## 7. New Menu Slugs, Their Grants, and the Seed / Migration Plan (input to P18-02 and P20-06)

**No new role; `ROLE_LEVELS` unchanged.** Three new slugs:

| Slug | Parent (seed) | Label | Gates | Why there |
|---|---|---|---|---|
| `ipm` | `equipment` | IPM | IPM sessions, results, history, the IPM report data document (P21-03, P19-06); with `calibration`/`ipm-templates` the catalogue read | a device activity beside calibration and maintenance; `equipment` read reaches it one level down (C-1), as it reaches `calibration` |
| `ipm-templates` | `equipment` | IPM Checklists | catalogue read (any-of with `calibration`/`ipm`, P19-01 § 8); tenant proposals (read/write) | `equipment` **write** (the level-8 admins) inherits proposal write — exactly P19-01's "tenant-administration tier by default"; `equipment` read inherits catalogue read |
| `client-facilities` | `mgmt-organization` | Client Facilities | `client_facilities` CRUD, status (P21-09) | beside Tenants and Users; `management` reaches `mgmt-organization` only, so grants are by slug (the Q-20 pattern) |

**Default grants (`ROLE_MENU_ASSIGNMENTS` + the migration for seeded databases).** Inherited cells need no row; explicit rows only:

| Role | `ipm` | `ipm-templates` | `client-facilities` |
|---|---|---|---|
| `SUPERADMIN` | W | W | W |
| `HEALTHCARE ADMIN` | (W via `equipment` W) | (W via `equipment` W) | **W** |
| `CALIBRATOR ADMIN` | (W via `equipment` W) | (W via `equipment` W) | **W** |
| `ENGINEERING MANAGER` | (R) | (R) | **R** |
| `SUPERVISOR` | (R) | (R) | — |
| `TECHNICIAN` | **W** | (R) | — |
| `HEALTHCARE TECHNICIAN` | **W** | (R) | — |
| `FACILITY MAINTENANCE` | **W** (unbound: a self-served hospital's IPSRS captures IPM; bound: capped to R by § 5) | (R) | — |
| `WAREHOUSE STAFF`, `ROOM USER`, `USER` | (R) | (R) | — |

`ipm` write to the three technical roles is a **new** slug's grant and changes nothing a tenant can do today; `calibration` write for the technicians (C-2) is **not** decided here — it is UD-4 (b).

**Plan (P20-06, after P18-02 confirms the grants):**
1. `utils/seedMenuGroups.util.ts` `menuData`: the three rows, `ipm` and `ipm-templates` after `calibration-scheduler` under Equipment, `client-facilities` after `users` under `mgmt-organization`.
2. `constants/roleConstants.ts` `MENU_SLUGS`: `IPM`, `IPM_TEMPLATES`, `CLIENT_FACILITIES`; `ROLE_MENU_ASSIGNMENTS` rows above. `constants/seededMenuSlugs.ts` `SEEDED_MENU_SLUGS`: the three (held equal to the seed by `seededMenuSlugs.p919`; the A-58 boot check `checkRoleMenuAssignments` refuses an assignment to an unseeded slug).
3. Migration `0116` (renumber at implementation): insert the three `menu_groups` rows by slug with their parents; insert the explicit `role_menu_permissions` rows above for the seeded roles; **no blanket try/catch** (the trap); idempotent on slug; verified with `make migrate-verify` and the columns/rows inspected, not the log; flush `permissions:*` after it (the ADR-102 note).
4. `constants/menuPageAccess.ts`: no entry needed — each page loads behind its own slug (`/dashboard/ipm` → `ipm` read; `/dashboard/ipm-templates` → the any-of read; `/dashboard/client-facilities` → `client-facilities` read). The operator's draft pages are super-admin-only pages behind `superAdminOnly` routes: `ipm-templates` gets a `SUPER_ADMIN_ONLY` page gate **only** for the operator sub-page, if it is a separate menu leaf (P22-01 decides the leaf).
5. API-key scopes (`apiKey.service#scopeAllows`): `ipm` read, `ipm-templates` read and `client-facilities` read are assignable scopes; `ipm` write is **not** usable by a key on submit/correct/void (`denyApiKey`, § 12) except the dedicated import route of P24-04.

---

## 8. The Facility-Accessible Route List (Matrix D)

Every route **not** listed answers **403** to a bound principal, decided before any parameter is read (AM-12). Listed routes still pass their own gates (`dynamicAccess` reads the ceiling-capped effective permission) and the hooks (cross-facility = 404). `@2f` = needs a `twoFacilitySuite` case asserting 404 (P18-04 writes the plan, G-07/G-08).

### 8.1 Self / identity (every bound role)

| # | Route(s) | Kind | Condition | `@2f` |
|---|---|---|---|---|
| S-1 | `POST /api/v1/auth/verify`, `/logout`, `/logout-all`, `/socket-token`, `/pass-is-valid`, `/just-update-password`, `/mfa/setup`, `/mfa/verify`, `/mfa/disable`, `/impersonate/exit` | self | `/verify` returns `clientFacilityId` (id only) and `facilityBound`; the scope fingerprint of AM-26 joins it in P19-08 | — |
| S-2 | `GET /api/v1/sessions/mine`, `POST /sessions/mine/:id/revoke` | self | `Session` on `FACILITY_READABLE` (§ 10) | `:id` ✔ (F2 user's session → 404) |
| S-3 | `/api/v1/webauthn/*` (the SELF routes of `routeGateExemptions`) | self | table not tenant-scoped (C-9) | `:id` ✔ |
| S-4 | `/api/v1/gdpr` SELF routes: `POST /export`, `GET /exports/:exportId/download`, `POST /erasure`, `GET /erasure/:requestId`, `PUT /consent`, `GET /consent/history`, `GET /processing`, `PUT /rectify`, `POST /restrict` | self | the data subject's own data is collected **by user id** with a reviewed `skipFacilityScope` (§ 10.2) — a bound user's UU PDP / GDPR export must not silently omit rows the deny branch hides | `:id` ✔ |
| S-5 | `/api/v1/notifications`: `GET /`, `PATCH /read-all`, `PATCH /:notificationId/read`, `DELETE /all`, `DELETE /bulk`, `DELETE /:notificationId` | self | `Notification` on `FACILITY_READABLE` with `user_id = self` (tenant broadcasts with no user are not shown to bound users) | `:id` ✔ |
| S-6 | `GET /api/v1/menu-groups/my-permissions`, `POST /menu-groups/filter`, `POST /menu-groups/get-assignments`, `GET /menu-groups/menu-groups` (and the `/menu-group-roles` mount) | self (own role) | the ceiling applied (§ 5); `my-permissions` gains `facilityBound` (§ 13) | — |
| S-7 | `PATCH /api/v1/users/:userId/profile`, `POST` / `DELETE /users/:userId/avatar` | self, `selfParam: "userId"` | reachable by a bound principal **only** when `:userId` is the caller; the contract is strict and has no `clientFacilityId`, `roleId`, `tenantId`, `status` (AM-14); the avatar upload's quota read is a reviewed `skipFacilityScope` | ✔ (another user's id → 403 before the handler, id-independent) |
| S-8 (new, P21-09) | `GET /api/v1/client-facilities/mine` | self (exemption, kind `self`) | the caller's own facility row (`ClientFacility` rule `id = own`), or `null` for an unbound caller; the app shell shows it | — |

### 8.2 Domain reads and writes — existing routes

| # | Route | Gate | Bound principals | Condition | `@2f` |
|---|---|---|---|---|---|
| A-1 | `GET /api/v1/calibration-devices`, `GET /:calibrationDeviceId` | `calibration` read | all bound | the facility inventory and its frontend export (ADR-126 § 8; EP-16 export reads) | ✔ |
| A-2 | `POST /api/v1/calibration-devices` | `calibration` write | HT·b (UD-4 (b)) | `client_facility_id` forced to the caller's (ADR-124 § 5); the QR is not settable by a bound principal, or its 409 names nothing (OQ-2, P19-03) | ✔ (create naming F2 → refused) |
| A-3 | `PUT /api/v1/calibration-devices/:calibrationDeviceId` | `calibration` write | HT·b (UD-4 (b)) | the bound contract drops `clientFacilityId`, QR, status | ✔ |
| A-4 | `GET /api/v1/calibration-records`, `GET /:calibrationRecordId` | `calibration` read | all bound | performer include `required: false` + snapshot (A-90) | ✔ |
| A-5 | `POST /api/v1/attachments` | `equipment` read + **bound gate** | HT·b | for a bound principal: `resource_type` ∈ {`device`, the IPM photo type of P19-02/P19-03}, the resource loaded **in context**, and write on its slug (`calibration` for a device, `ipm` for an IPM result) — else 403; standalone types (`generic`, `ticket`, `post`) and `certificate`/`calibration`/`workorder`/`kanbancard` refused (C-4) | ✔ |
| A-6 | `GET /api/v1/attachments`, `GET /:id`, `GET /:id/download`, `POST /:id/signed-url` | `equipment` read | all bound | the row is loaded in context before any URL is issued; TTL capped (AM-22) | ✔ |
| A-7 | `GET /api/v1/certificates`, `GET /:certificateId`, `GET /:certificateId/document`, `GET /:certificateId/pdf` | `certificate` read | all bound | signer/author includes `required: false` + snapshot | ✔ |
| A-8 | `GET /api/v1/maintenance`, `GET /:orderId` | `maintenance` read | all bound | vendor and assignee includes `required: false` (they are provider-internal: deny per include, AM-5) | ✔ |
| A-9 | `GET /api/v1/warehouses`, `GET /:warehouseId`, `GET /:warehouseId/locations` | `warehouse` read | all bound | **only after UD-10** makes rooms facility rows (`warehouses.client_facility_id`, ADR-124 § 3); until then unmarked | ✔ |
| A-10 | `GET /api/v1/dashboard/metrics` | `home` read | all bound | **OQ-8, decided:** marked only when P21-07 delivers `dashboard.twoFacility` and G-20 (cache key per facility) green; until then unmarked and the bound home page is built from A-1/N-2 reads | ✔ (figures) |

**Deliberately not marked** (bound → 403): device `DELETE`, `restore`, `reinstate`, `bulk-import`; every calibration-record write; every certificate write (`POST /`, `PUT`, `DELETE`, approve, submit, sign, revoke) and `GET /certificates/stats`; maintenance writes; `GET /attachments/orphans`, `DELETE /attachments/:id`; `/reports/*` (PT-10); `/calibration-scheduler/*`; `/predictive-maintenance/*`; `/iot/*` (authenticated); `/search`; `/ai/*`; `/stocks/*`; `/vendors/*`; `/qms/*`, `/sop/*`, `/workflows/*`, `/risk/*`, `/supplier-scorecard/*`; `/kanban/*`; `/tickets/*`; `POST /notifications/test`; `/esignature/*` (until UD-17, then E-1); every route of users, roles, user permissions, menu-group administration, sessions administration, tenants, tenant hierarchy / lifecycle, backups, API keys, webhooks, storage, billing, quota, metered billing, finance, audit, data retention, GDPR administration, feature flags, custom domains, network security, OIDC, SCIM, content, access requests, admin, jobs.

### 8.3 Target routes (Phase 21; exact paths fixed by their specs)

| # | Route (spec) | Gate | Bound principals | Condition | `@2f` |
|---|---|---|---|---|---|
| N-1 | catalogue reads — `GET /api/v1/ipm/templates/published`, device types, `GET /ipm/template-versions/:id` (published/retired) (P19-01 § 8) | `["calibration","ipm","ipm-templates"]` read | all bound | global content, no facility rows; `:id` exempt from `twoFacilityRoutes.guard` with reason "global (ADR-125)" | exempt |
| N-2 | IPM session list, get, history per device, the report data document (P19-02, P19-06) | `ipm` read | all bound | performer snapshot; no provider user include (A-90) | ✔ |
| N-3 | IPM create draft (prefill), edit own draft, submit, discard own draft, correct (P19-02, P21-03) | `ipm` write + `denyPlatformAuthoring` + `denyApiKey` on submit/correct | HT·b | device loaded in context; facility stamped from the device; `client_ref` resolved in context (AM-16); draft edit by its creator only (403) | ✔ |
| N-4 | IPM void (P19-02) | `ipm` write + `rbac([TENANT_ADMIN])` + unbound | **none** | refused by the guard (rbac tenant-admin) | — |
| N-5 | IPM report signatures: performer sign, IPSRS countersign (P19-06) | `esignature` write + `denyPlatformAuthoring` | HT·b (own sessions), FM·b (its facility) | **UD-17**; SoD § 11 | ✔ |
| N-6 | device photos upload / replace (P19-03, P21-02) | `calibration` write | HT·b (UD-4 (b)) | as A-5 | ✔ |
| N-7 | `GET /api/v1/client-facilities`, `GET /:id`, create, edit, status, bind/unbind (P19-04, P21-09) | `client-facilities` read/write; binding on `users` write + `rbac([TENANT_ADMIN])` | **none** | administration; S-8 is the bound user's read | — |
| N-8 | technician activity list (P21-07) | `ipm` read | all bound | the facility-scoped form only, with the performer snapshot (FT-60) | ✔ |
| N-9 | IPM "due" list / condition widgets (P21-07) | `ipm` read | all bound | counts through hooked `count` or the facility predicate helper; cache key per facility (AM-18) | ✔ |
| N-10 | quick calibration-date entry (P19-05, P21-05) | `calibration` write | **none** | provider (laboratory) work | — |
| N-11 | proposals (P19-01 § 8) | `ipm-templates` read/write | **none** | provider-internal (P19-01) | — |
| N-12 | public device page (P21-08) | public capability token | n/a | `routeGateExemptions` kind `public`; not a marker matter | — |

---

## 9. The Marker, and What the Guard Refuses

**Form (decided here; the exact identifier is P19-04's).** One reviewed constant, `FACILITY_ACCESSIBLE_ROUTES` (target `constants/facilityAccess.ts`), keyed exactly like `routeGateExemptions` — route file → `"METHOD /path"` → `{ kind: "read" | "write" | "self", reason, selfParam?, boundGate? }` — and **one** middleware applied after `auth` that answers 403 to a bound principal whose matched route is not in it. One list, like `routeGateExemptions` (P6-04's "this is the ONE list"); no per-route tag that a later edit can drop silently. `boundGate` names the extra check a bound principal must pass on that route (A-5's resource rule); `selfParam` names the path parameter that must equal the caller.

**`facilityAccessibleRoutes.guard` refuses an entry (G-09, AM-11 refined):**

1. the route's chain contains `superAdminOnly`, `rbac([…])` naming `SUPERADMIN`/`SUPER_ADMIN`/`TENANT_ADMIN` or any role of level ≥ 8, `checkRoleLevel(n ≥ 8)`, or `abac([TENANT_PERMISSIONS.*])`;
2. the route's `dynamicAccess` slug is on the **administrative deny-list** — `users`, `roles`, `permissions`, `user-permissions`, `menu-groups`, `sessions` (administration; the self routes are exemptions), `tenants`, `tenant-hierarchy`, `tenant-lifecycle`, `client-facilities`, `access-requests`, `management`, `security`, `oidc`, `webauthn`, `network-security`, `scim`, `gdpr`, `custom-domains`, `api-keys`, `webhooks`, `storage`, `feature-flags`, `billing`, `finance`, `metered-billing`, `audit`, `data-retention`, `batch-jobs`, `content`, `notifications` (write: the tenant broadcast) — or names an action outside the **union of the bound ceilings** (§ 5) for that slug;
3. the route's action on `certificate` is anything but `read` (issuing is the laboratory's);
4. the route is `public` in `routeGateExemptions` (the marker is meaningless without a principal);
5. the entry has no `reason`, or a `self` entry whose route is not a `self` exemption or a `checkSelf` gate with `selfParam`.

**`denyPlatformAuthoring` is not a refusal criterion** (C-5). It marks Part 11 authorship (ADR-052) and will sit on N-3, the bound technician's IPM capture; refusing it would forbid the upstream's own facility-technician flow. Rule 3 and the ceiling cover the lab-issuance routes that AM-11 had in view. The deny-list in rule 2 lives **in the guard file** and changes only with an ADR; the marked list changes by review.

---

## 10. `FACILITY_READABLE` — and the Service-Internal Reads That Are Not on It

### 10.1 The list (each entry: model, rule — always a predicate from the **context**, never "readable" bare — reason, exercising test) (AM-8, FT-28)

| Model (table) | Rule | Reason | Exercised by |
|---|---|---|---|
| `ClientFacility` (`client_facilities`) | `id = ctx.clientFacilityId` | the bound user's own facility row (name, kind, status) for the shell; the provider's customer list stays hidden (FT-27) | `clientFacility.twoFacility.test.ts` (list = exactly one row; F2's id → 404) |
| `Session` (`sessions`) | `user_id = ctx.userId` | own sessions (S-2) | `ownSessions.facility.test.ts` |
| `Notification` (`notifications`) | `user_id = ctx.userId` | own notifications (S-5); a tenant broadcast with no user is not shown to bound users (AM-19 carries no facility data in broadcasts anyway) | `notification.facility.test.ts` |
| `ConsentRecord` (`consent_records`) | `user_id = ctx.userId` | own consent (S-4) | `gdprSelf.facility.test.ts` |
| `DsarRequest` (`dsar_requests`) | `user_id = ctx.userId` | own data-subject requests (S-4) | `gdprSelf.facility.test.ts` |
| `SignatureRecord`, `ESignatureRecord` | `user_id = ctx.userId` | **UD-17 only** — own signature history when E-1 is marked; absent until then | (P19-06) |

**Not on the list, and why:** `WebauthnCredential`, `NotificationState` (no `tenant_id`, C-9 — the hooks never touch them); `User` (facility-scoped, nullable, ADR-124 § 3 — a bound user sees its own row and its facility's colleagues only where a marked route reads users, and none does); `AuditLog` (facility-scoped nullable — rows are **written** with the facility stamped; no marked route reads them); every other tenant model (DENY).

### 10.2 Service-internal reads under a bound context (not `FACILITY_READABLE`: a reviewed `skipFacilityScope`, G-13)

These run on the bound user's behalf and return **no row to the caller**; putting them on `FACILITY_READABLE` would make them queryable by any marked route. Each use carries `skipFacilityScope: true` with a reason on the G-13 list (never `skipTenantScope` — the tenant predicate stays):

| Read | Where (today) | Why it is needed |
|---|---|---|
| `TenantSettings` keys the service needs (time zone, locale, `ipm.intervalMonths`, storage driver settings) | settings readers, `storageSettings`, the "due" computation | without it a bound user's "due" uses the default interval and its uploads find no storage driver — a silent wrong answer, not a denial |
| `TenantKey` (KMS envelope for storage credentials) | `storage/*`, `kms.service` | signed URLs and downloads (A-6) |
| `PlanQuota`, `UsageMetric`, `Subscription` (storage/seat quota) | `enforceStorageQuota()` on A-5, S-7 | a DENY here either fails open (no quota) or blocks every upload |
| the subject's own rows for the GDPR export (S-4), by `user_id = subject` | `gdpr.service` | a data-subject export must be complete (UU PDP, GDPR Art. 15); the hooks' deny would omit e.g. the subject's audit rows |
| `Tenant` (own row: name, logo, colour) | the shell / branding | if `tenantScope` treats `tenants` as scoped, its own row by `id = ctx.tenantId` (verify in P21-09) |

---

## 11. Separation of Duties

| Act | Who | Separation rule | Status code | Source |
|---|---|---|---|---|
| IPM draft edit / submit | the draft's creator | no one else edits another's draft | 403 | ADR-126 § 3 |
| IPM correction | any `ipm` writer in scope (HT·b in its facility) | none — a correction is a new attestation by its own submitter; the original stays | 409 on a voided/superseded/draft original | ADR-126 § 3 |
| IPM void | an **unbound** tenant administrator | none enforced against the submitter: void is a recorded retraction with a reason, not an approval; a bound HA can never void | 403 (bound: route), 409 (state) | ADR-126 § 3 |
| IPM report performer signature | the session's submitter only | no one signs another's performance | 403 | **UD-17 / P19-06** |
| IPM report IPSRS countersignature | a `FACILITY MAINTENANCE` of **the session's facility** (bound there, or unbound in a self-served tenant) holding `esignature` write | **the countersigner may not be the submitter** (ADR-101's rule: an author does not review its own record), and a provider technician cannot countersign for a facility | 403 with the rule named | **UD-17 (recommendation; dependent cells marked)** |
| Certificate approve | `certificate` write | not its drafter or submitter | 403 | ADR-101 (unchanged; bound users never reach it) |
| Catalogue publish | super admin | none enforced (few operators) | — | ADR-125 § 4 |
| Proposal → version | tenant admin proposes, operator accepts | two parties by construction | — | ADR-125 § 5 |
| Bind / unbind / move a user | an **unbound** tenant administrator (`users` write, level ≥ 8, `facilityBound = false`) | no self-binding (an administrator binding itself would drop out of administration mid-act: 400); every change audited and revokes the user's sessions (AM-1) | 400 / 403 | AM-14, AM-1 |
| Bound user's role change | an unbound tenant administrator; only within `FACILITY_BOUND_ROLES` | SCIM likewise (§ 12) | 400 | ADR-124 § 4 |

---

## 12. API Keys, SSO, SCIM, the OIDC Provider, Impersonation

- **API keys** stay **tenant-wide and unbound** (ADR-124 § 9): a key principal is never facility-scoped, so a key reads every facility of its tenant. Key creation stays `rbac([TENANT_ADMIN])` and is unmarked (bound users cannot mint one — FT-37's path). The key-creation UI states "this key reads every client facility". Scopes: `ipm`, `ipm-templates`, `client-facilities` read assignable; IPM submit / correct / void carry `denyApiKey` (a Part 11 record needs a person); the upstream import uses its own per-tenant import key and route (P24-04). A facility-bound key is a later ADR if a facility's HIS asks (OQ-11).
- **SSO (SAML/OIDC, one configuration per tenant).** Bound users sign in through their tenant's IdP if it has them; bound-ness comes from the user row after authentication, never from an IdP attribute. **JIT** today creates an unbound `USER` (C-7, F-5); in a tenant with more than one facility that is a fail-open for a facility employee. Recommendation carried from the threat model (AM-15, OQ-3, owner to confirm in P21-09): JIT-created users in a multi-facility tenant are created **inactive** until an unbound administrator binds them or confirms them unbound. No IdP group → facility mapping in this group.
- **SCIM** may assign any non-SUPERADMIN role (C-7); target rules: SCIM cannot set or clear `client_facility_id` (no SCIM attribute maps to it; an extension attribute naming it is 400); SCIM may not give a **bound** user a role outside `FACILITY_BOUND_ROLES` (400, the shared user-service check); SCIM-created users in a multi-facility tenant follow the JIT rule above; `active=false` revokes sessions as today.
- **Callibrator as an OIDC provider** (`/api/v1/oidc`): ID tokens and userinfo carry identity only — **no facility claim** (AM-2: the context's facility has one writer, the loaded user row).
- **Impersonation** (super admin only): the impersonated bound user's context, both dimensions (ADR-124 § 9); `POST /auth/impersonate/exit` is marked (S-1) so the operator can leave.

---

## 13. `GET /menu-groups/my-permissions` and the Frontend

- The response gains `facilityBound: boolean` (and nothing else about the facility — the shell reads S-8): `{ superAdmin, facilityBound, permissions }`. `permissions` is already ceiling-capped (§ 5), so the sidebar and `usePermissions().canWrite(slug)` follow with no frontend role logic (ADR-102; `docs/FRONTEND/05-RBAC-IN-UI.md` forbids role names in pages).
- A page whose write action is gated by a slug the bound user may hold but whose **route is unmarked** hides that action when `facilityBound` (the device page's Delete / Bulk import; the records page's Record / Correct / Void; the certificates page's every write). Each such page gets a frontend test with a bound principal (P22-09).
- The bound user's navigation (P22-09): Dashboard (or the facility home of A-10), Devices (inventory + export), IPM (history; capture for HT·b), Certificates, Work orders (read), IPM checklists (read), Profile. Nothing under Management or Security.

---

## 14. Open Decisions and the Cells That Depend on Them

| Decision | Cells | Recommendation | Where |
|---|---|---|---|
| **UD-4 (a)** role of each upstream group | Matrix A roles | as § 4.2 (unchanged from Q-57·UD-4) | Phase 12 § 3, open |
| **UD-4 (b)** — *added by this card* — do the technical roles get `calibration` write by default (device registration, calibration-date entry), F4/Q2 of UI research 03? | Matrix C `calibration` write for `T`, `HT·b`; A-2, A-3, N-6 | **Yes for `TECHNICIAN` and `HEALTHCARE TECHNICIAN` in every tenant** (seed + migration), keeping device restore/reinstate behind `rbac([TENANT_ADMIN])`; the alternative (per-user overrides on the imported provider tenant only) leaves every other tenant's technicians read-only and is the repeated-override smell `docs/PLAN/03` warns of | Phase 12 § 3, open |
| **UD-4 (c)** — *added* — may a bound facility admin manage its own facility's users (threat model OQ-4)? | none in this group | **No in this group**; if asked, a separate route forcing the actor's facility and roles ≤ its own within the bound set, audited, with an ADR | Phase 12 § 3, open |
| **UD-17** IPSRS countersignature and recommendation side effects | `esignature` ceiling, N-5, § 11 countersign, `SignatureRecord` entries | countersign by the facility's `FACILITY MAINTENANCE`, not the submitter, per-tenant setting | open |
| **UD-10** rooms | `warehouse` ceiling, A-9 | rooms as facility-owned `warehouses` rows | open |
| **OQ-8** dashboard at go-live | A-10 | **decided here:** marked only with `dashboard.twoFacility` + G-20 green; otherwise the facility home from A-1/N-2 | — |
| **OQ-2** bound users create devices / set QR | A-2, A-3 | **decided here:** create and edit in their facility (subject to UD-4 (b)); QR not settable by a bound principal, or a 409 that names nothing (P19-03 finalises) | — |
| **OQ-9** per-user `FACILITY_READABLE`; tickets | § 10.1 | **decided here:** the per-user set yes; tickets later | — |
| **OQ-3 / AM-15** JIT and SCIM in multi-facility tenants | § 12 | inactive until bound or confirmed | P21-09, owner to confirm |

---

## 15. Guards and Tests That Enforce This (built with P20-06, P21-09, P22-09; P18-04 lists every case)

| # | Test or guard | Kind | Proves |
|---|---|---|---|
| G-P1 | `services/effectivePermission.boundCeiling.test.ts` | U | for each bound role × every **seeded** slug (read from the seed, not from the ceiling): effective ≤ ceiling; a per-user override above the ceiling yields the ceiling; an unbound principal's result is unchanged (the existing ADR-102 suites stay green) |
| G-P2 | `services/menuEffectiveAccess.bound.test.ts` | M | on the real seed: no bound role sees a sidebar leaf whose page's load route is unmarked (the ADR-102 rule extended) |
| G-P3 | `guards/boundCeilingRoutes.guard.test.ts` | G | every ceiling (slug, W) has at least one marked write route; every marked route's (slug, action) is within the union of the ceilings — the ceiling and the marker cannot drift |
| G-09 | `guards/facilityAccessibleRoutes.guard.test.ts` | G | § 9 rules 1 – 5 over the **mounted** route table; a planted marker on `POST /api-keys`, `PATCH /users/edit`, a `tenantBackup` route and `POST /certificates/:id/approve` each fails it (fail-before recorded) |
| G-10 | `routes/facilityRouteDefault.test.ts` | M/G | as a bound `HEALTHCARE ADMIN`, every unmarked mounted route → 403, identical for a valid and an invalid id (AM-12); every marked route also works for an unbound technician (FT-39) |
| G-12 | `guards/facilityReadable.guard.test.ts` | G | every `FACILITY_READABLE` entry has a reason, a context-derived rule kind (`own-user`, `own-facility`) and a named exercising test that exists |
| G-13 | `guards/skipFacilityScope.guard.test.ts` | G | every `skipFacilityScope` use in source is on the reviewed list of § 10.2 with its reason |
| G-P4 | `services/userBinding.roles.test.ts`, `userBinding.massAssignment.test.ts`, `userBinding.selfBind.test.ts` | U/M | bound role set (400), no binding through self-profile or invitation, no self-binding (AM-14) |
| G-P5 | `services/scim.facility.test.ts`, `ssoJit.facility.test.ts` | U | § 12 SCIM rules; JIT per OQ-3 once confirmed |
| G-P6 | `routes/attachmentsUpload.bound.test.ts` | M | A-5: bound upload accepted only for an own-facility device / IPM resource with write on its slug; `generic`/`ticket`/`post` → 403 |
| G-P7 | `routes/ipmVoid.bound.test.ts`, `ipmCountersign.sod.test.ts` (UD-17) | M | a bound HA cannot void (403 at the route); the submitter cannot countersign (403 naming the rule) |
| G-P8 | frontend `usePermissions.bound.test.ts` + per-page bound tests | F | `facilityBound` hides unmarked write actions; the bound navigation of § 13 |
| G-07/G-08 | `twoFacilitySuite` on every `@2f` row of § 8 + `twoFacilityRoutes.guard` | M/G | 404 identical to missing; absent from lists (P18-04 enumerates) |
| G-31 | the existing tenant suites (`twoTenantRoutes.guard`, `routePermissionGuard.p604`, `menuEffectiveAccess.adr102`, `effectivePermission.adr102`, `seededMenuSlugs.p919`, `unscopedModels.d17`) | U/G | nothing regressed for unbound principals |

**Fail-before evidence** for G-P1, G-P3, G-09 and G-10 is recorded by the building card (a planted violation that the guard catches), per `docs/ENGINEERING/09-TESTING-CONVENTIONS.md`.

---

## 16. Out of Scope

Facility user administration by a bound admin (UD-4 (c)); a facility-bound API key (OQ-11); IdP-group → facility mapping; a "switch facility" (never, ADR-124 § 10); search, RAG and `/reports/*` for bound users (their own review); tickets to the provider (OQ-9, later).
