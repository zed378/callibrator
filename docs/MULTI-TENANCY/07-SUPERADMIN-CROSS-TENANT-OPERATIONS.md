# 07 — Super-Admin and Cross-Tenant Operations

Every place the code is **meant** to act across tenants, or is reserved to the platform operator — with the gate that holds it and the reason it is an exception rather than a bug.

This document **extends** [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) (mandatory, not repeated). The controls and the known leaks are [`./08-CROSS-TENANT-PROTECTION.md`](./08-CROSS-TENANT-PROTECTION.md); the tenant hierarchy, lifecycle and backup modules are described in [`./01-TENANT-HIERARCHY-AND-SUBORGS.md`](./01-TENANT-HIERARCHY-AND-SUBORGS.md).

> **Target standard: TypeScript, strict (ADR-038).** Every file named here is **JavaScript/CommonJS as built**, except those Phase 9 (ADR-087) had converted on 2026-09-28 — among them `backend/src/utils/tenantScope.util.ts`, `backend/src/middlewares/tenantContext.middleware.ts` and `backend/src/constants/roleConstants.ts`. Line numbers are as of that date.

---

## How The Super Admin Crosses

Nothing below is a special mechanism. It is three ordinary ones:

| Mechanism | Where | Effect |
|---|---|---|
| `isSuperAdmin → skip` | `tenantScope.util.ts#resolveScope`; the flag is set in `tenantContext.middleware.ts` for role name `SUPER_ADMIN` or `SUPERADMIN` | the global hooks add **no** tenant predicate to any query, root or include |
| the permission bypass | `rbac.middleware.js`, `abac.middleware.js`, `dynamicAccess.middleware.js` — each returns `next()` for the super admin **before** its `checkTenant` comparison | a route gated "own tenant only, else 404" is not gated for the operator |
| `x-tenant-id` / `x-tenant-code` | `auth.middleware.js` (`isSuperAdminPrincipal` branch) | sets `req.tenantId` to another **active** tenant; ignored — not rejected — for everyone else |

`SECURITY/05` § Super-Admin: *there is no second gate.* The one place the bypass is deliberately narrowed is `denyPlatformAuthoring` (A-127, ADR-052): a super admin who is impersonating, or whose effective tenant is not their home tenant, gets **403** on a Part 11 authoring act, and in their home tenant the context is **rebound** to an ordinary member. It is in the chain of 14 route registrations (calibration records, certificates, e-signature, SOP, workflows); `backend/src/tests/routes/denyPlatformAuthoring.a127.test.js` enumerates them.

## How This Inventory Was Built

Counted on 2026-09-28 from `backend/src` only — code, not documents or boards.

| Source | Search | Found |
|---|---|---|
| route-level operator gates | `superAdminOnly`, `platformOnly`, and `rbac([...])` whose only names are `SUPERADMIN` / `SUPER_ADMIN`, in `routes/api/*.js` and `routes/internal/*.js` | **71** route registrations in 14 files |
| tenant-bound gates the super admin passes | `ownTenantGuard` (4); `checkTenant: true` (**55** registrations in 14 files); the SCIM, ticket and dashboard chains named in `constants/routeGateExemptions.js` (21) | **80** |
| service-level operator checks | `isSuperAdmin` / role-name comparisons in `controllers/` and `services/` | 1 route (`POST /auth/impersonate`) plus branches inside routes already counted |
| unauthenticated routes that act with **no** tenant context | `kind: PUBLIC` entries in `routeGateExemptions.js` whose handler resolves a tenant from a capability | 5 (not re-audited here — see the section) |
| explicit opt-outs | `skipTenantScope: true` outside `tests/` and `tenantScope.util` | **21** sites in 12 files |
| background opt-outs | `runAsSystem(` call sites; `SYSTEM_TASKS` in `utils/jobContext.util.js` | **6** reasons, 6 call sites |

**Deliberately excluded:** `.unscoped()`. It removes a model's `defaultScope` (the soft-delete filter), not the global tenant hooks, which are installed on the Sequelize instance; `tenant.model.js#restoreStatic` says so in its comment. Raw `sequelize.query` is inventoried in [`08`](./08-CROSS-TENANT-PROTECTION.md) § Layer 3.

**A count is a snapshot.** Re-run the searches before quoting it.

## 1 — Routes Reserved to the Super Admin (71)

Each is a platform operation: it acts on the platform's own configuration, on the tenant set, or on a named tenant from outside it. An API-key principal carries the role name `API_KEY` (`auth.middleware.js#tryApiKeyAuth`), so every gate here refuses a key even where `denyApiKey` is absent.

| Module · mount | Routes | Gate | Acts on | Why it is intentional |
|---|---|---|---|---|
| `admin.route.js` · `/api/v1/admin` | `GET /tenants`, `PATCH /tenants/:id/status`, `PATCH /tenants/:id/flags` (3) | `router.use(auth, rbac(["SUPER_ADMIN","SUPERADMIN"]))` | any tenant | the tenant set is the platform's. Status and flag changes are audited twice, under PLATFORM and under the tenant (A-165). The status route has **no transition rules** — see `01` § Lifecycle |
| `tenant.route.js` · `/api/v1/tenants` | `GET /all`, `POST /create`, `DELETE /delete` (3) | `auth, superAdminOnly` | the tenant set | creating and deleting a customer is a platform act (A-95, A-125); the delete refuses a tenant with users |
| `tenantHierarchy.route.js` · `/api/v1/tenant-hierarchy` | `POST /:parentId/children`, `PUT` / `DELETE /:tenantId/parent`, `GET /cross-tenant-roles` (4) | `[auth, denyApiKey, superAdminOnly]` | any tenant; any user id | re-parenting a tenant is structure across tenants (A-01). Grants no data visibility (ADR-084) |
| `tenantLifecycle.route.js` · `/api/v1/tenants` | `POST /:tenantId/suspend`, `/resume`, `/grace-period`, `/offboard`, `/offboard/cancel`, `GET /:tenantId/export` (6) | `router.use(auth)`, `superAdminOnly` | the named tenant | suspending or offboarding a customer cannot be the customer's own call. Every transition is audited since 2026-09-29 (A-278, ADR-094) — see `01` |
| `dataRetention.route.js` · `/api/v1/tenants` | `PUT /:tenantId/policy`, `POST` / `DELETE /:tenantId/legal-hold`, `POST /:tenantId/purge`, `/mask-pii`, `/anonymize` (6) | `router.use(auth)`, `superAdminOnly` | the tenant named in the path | irreversible data operations and legal holds are held by the operator |
| `featureFlags.route.js` · `/api/v1/feature-flags` | `POST /:tenantId/initialize`, `POST` / `DELETE /:tenantId/:flagKey` (3) | `router.use(auth)`, `superAdminOnly` | the tenant named in the path | flags gate paid features |
| `networkSecurity.route.js` · `/api/v1/network-security` | `PUT /ip-allowlist`, `PUT /geofence` (2) | `router.use(auth)`, `superAdminOnly` | **`req.user.tenantId` — the super admin's home tenant** | **Reviewed 2026-09-29 (A-280, ADR-094):** the home-tenant PUTs stay; `GET`/`PUT /tenants/:tenantId/ip-allowlist` and `…/geofence` (`superAdminOnly`, the tenant named in the path, 404 if it does not exist) act on any tenant. Every write is audited under PLATFORM and the tenant. **Amended 2026-09-29 (ADR-100):** Q-38 decided — the home-tenant PUTs are gated by `network-security: write`, which the tenant administrator now holds (migration 0098), behind a self-lockout guard (409 `SELF_LOCKOUT` unless the change keeps the caller's address / current location inside); the operator is exempt and is the override. A-288: both are enforced at every sign-in (password, MFA, SSO exchange, passkey, refresh — the geofence on password/MFA/passkey only, from a device-reported location), and a tenant's policy never binds a platform operator |
| `oidc.route.js` · `/api/v1/oidc` | `POST /clients`, `POST /clients/:clientId/rotate-secret`, `DELETE /clients/:clientId` (3) | `router.use(auth)`, `superAdminOnly` | `req.user.tenantId` (`oidcProvider.controller.js`) | registering an OIDC relying party is a trust decision. **Reviewed 2026-09-29 (A-280, ADR-094):** the home-tenant routes register **platform** clients; `/oidc/tenants/:tenantId/clients[...]` register, list, rotate and delete a named tenant's clients. Only a user of the client's own tenant may see or decide its consent request (A-275). Every change is audited under PLATFORM and the tenant |
| `roles.route.js` · `/api/v1/roles` | `GET /`, `GET /menus`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`, `GET` / `PATCH` / `DELETE /menus/:id`, `POST /menus`, `POST /:roleId/permissions`, `DELETE /:roleId/permissions/:menuGroupId`, `POST /assign`, `DELETE /assign/:userId` (14) | `auth, rbac(["SUPERADMIN"])` | the **global** role and menu tables; any user | roles have no `tenantId` (ADR-064, D-16); a write to one is a write for every tenant. `rolesGlobal.d16.test.js` holds every write SUPERADMIN-only |
| `menuGroups.route.js` · `/api/v1/menu-groups` **and** `/api/v1/menu-group-roles` | `GET /menu-groups/admin`, `GET /roles`, `POST /create`, `/update`, `/delete`, `/assign`, `/revoke`, `/assign-item`, `/revoke-item`, `/bulk-assign`, `/bulk-revoke` (11, each reachable under both mounts) | `auth, rbac(["SUPERADMIN"])` | the global menu taxonomy | the menu matrix is platform configuration |
| `userPermissions.route.js` · `/api/v1/user-permissions` | `GET` / `POST /:userId`, `DELETE /:userId/:menuGroupId` (3) | `rbac(["SUPERADMIN"])` | any user, any tenant | per-user overrides can revoke or grant beyond the role (A-35) |
| `session.route.js` · `/api/v1/sessions` | `GET /stats`, `GET /`, `GET /:id`, `POST /:id/revoke`, `POST /user/:userId/revoke-all`, `DELETE /:id` (6) | `router.use(auth)`, `rbac(["SUPERADMIN"])` | every session on the platform | incident response. A user's own sessions are `GET /mine` and `POST /mine/:id/revoke` (ADR-084 Q-08), not these |
| `internal/health.route.js` · `/api/v1/health` | `GET /`, `GET /jobs` (2) | `[auth, denyApiKey, superAdminOnly]` | the process and its dependencies | the per-dependency breakdown discloses topology (A-06/A-15) |
| `internal/migration.route.js` · `/api/v1/migration` | `GET /down`, `GET /unseeding` (`auth, superAdminOnly, allowDestructive`); `GET /up`, `GET /seeding`, `GET /seed-demo` (`superAdminOrBootstrap`) (5) | as listed | the whole schema | schema operations. **`superAdminOrBootstrap` lets any caller through while `ALLOW_SEEDING=true`** — an empty database has no user to authenticate |

## 2 — Tenant-Bound Routes the Super Admin Crosses (80)

The gate here protects tenants from each other; the operator passes it by the bypass. None of these is SUPERADMIN-only.

| Routes | Gate | What the super admin reaches | Why it is intentional |
|---|---|---|---|
| `tenantHierarchy.route.js` `GET /:tenantId/children`, `/parent`, `/descendants`, `/ancestors` (4) | `ownTenantGuard` — own tenant or SUPERADMIN, else **404** | any tenant's position in the tree | the tree is operator-maintained; a tenant user gets its own id only, and in practice sees no other tenant's row (`01` § The reads) |
| every `checkTenant: true` route — 55 registrations in `audit`, `billing`, `calibrationScheduler`, `dataRetention`, `featureFlags`, `finance`, `maintenance`, `networkSecurity`, `predictiveMaintenance`, `tenant`, `tenantBackup`, `tenantLifecycle`, `user`, `vendor` | `abac(…, { checkTenant: true })` or `dynamicAccess(…, { checkTenant: true })` — another tenant's id is **404** | the resource of the tenant named in the path, body or query | operator support. **A class entry: the 55 handlers were not individually re-reviewed in this pass** |
| — of those, `tenantBackup.route.js` (7) | `rbac([SUPER_ADMIN, TENANT_ADMIN])` + `abac(tenant:*, checkTenant)` | any tenant's backups, their download, restore and delete | an operator restores a tenant. A restore writes only into the backup's owning tenant (`01` § Backup). The controller does not check that `:backupId` belongs to `:tenantId` for the super admin |
| — of those, `calibrationScheduler.route.js` `GET /due`, `POST /run` | `dynamicAccess("maintenance", …, checkTenant)` | `allTenants=true` scans every tenant; `body.tenantId` scans one (`calibrationScheduler.controller.js#resolveScanScope`) | a platform-wide due scan |
| — of those, `audit.route.js` `GET /` with `?scope=platform` | `audit.controller.js#readableTenantId` — **403** for anyone else | the PLATFORM tenant's audit trail | platform operations are recorded under PLATFORM (F-7); tenants cannot read that trail |
| `scim.route.js` — 12 routes under `/api/v1/scim/v2` | inline `requireApiKeyOrAdmin`: an API key scoped `scim:read` / `scim:write` (A-250), **or a SUPERADMIN JWT** | the tenant in `req.user.tenantId` — a key's own tenant, or the operator's home tenant | SCIM is a tenant's IdP channel, not a cross-tenant one. The cross-tenant defects it had are § 5 below |
| `tickets.route.js` — 8 routes | service checks: `ticket.service.js#tenantScope` / `isResponder` / `assertCanManage` / `loadTicket` | **every tenant's tickets** — `tenantScope(user)` is `{}` for the super admin | the platform support desk: tenants raise, the operator answers. The super admin cannot raise (**403**). Per-tenant responder roles (`RESPONDER_ROLES`) see their own tenant's queue only |
| `dashboard.route.js` `GET /metrics` (1) | `auth` only — `accepted` under ADR-058 | global totals plus a per-tenant breakdown; `?tenantId=` narrows to one (`dashboard.controller.js`) | the operator's landing page. Everyone else is pinned to their own tenant |

## 3 — Operator Acts Reached Some Other Way

| Route / function | Gate | Why it is intentional |
|---|---|---|
| `POST /api/v1/auth/impersonate` → `auth.service.js#impersonateUser` | service: 403 unless the caller's role is `SUPER_ADMIN` / `SUPERADMIN`, **before** the target is resolved; the target is looked up by `(id, tenantId)` | support "see what the user sees". Every impersonated request is refused Part 11 authoring (`denyPlatformAuthoring`), and a refresh re-checks the operator is still entitled (`assertImpersonatorEntitled`) |
| `scripts/breakGlassMfaReset.js` → `auth.service.js#breakGlassResetOperatorMfa` | **no route** — a script run on the host; requires `requestedBy` and a `ticket`; refuses a non-operator account | recovering a locked-out platform operator |
| Socket.IO room `super_admins` (`config/socket.js`) | joined only when `socket.tenantContext.isSuperAdmin` | **nothing emits to it** — `notification.service.js` stopped fanning out to it. A dormant cross-tenant channel; see [`06`](./06-REALTIME-ISOLATION.md) |

## 4 — Cross-Tenant Without an Operator

These are not super-admin capabilities. They are listed because they are the rest of the answer to "what legitimately spans tenants".

### Explicit opt-outs — `skipTenantScope: true` (21)

| Site | Why the predicate is dropped |
|---|---|
| `auth.service.js:884`, `:1024` | pre-auth read of the user's **own** tenant's MFA and IdP settings; the tenant id is the user's, never request input |
| `auth.service.js:929` (`breakGlassResetOperatorMfa`) | the operator account may have no tenant |
| `controllers/sso.controller.js:274` | pre-auth `lastLoginAt`, named by `(id, tenantId)` of the signing-in user |
| `rateLimiter.redis.service.js:372` | pre-auth lookup of the account a lockout engages on |
| `session.service.js:158`, `:197`, `:332`, `:428`, `:473`; `ownSessions.service.js:82`, `:108` | a session is named by a server-derived user or session id; the tenant predicate made "sign out everywhere" miss rows (A-161) |
| `user.service.js:197` (`assertIdentityFree`) | **global on purpose** (A-128, ADR-063): identity is platform-wide, so the duplicate check must see every tenant — and answers one 409 either way |
| `gdpr.service.js:1221` (`assertEmailFree`) | the same rule for a rectified address |
| `models/certificate.model.js:210` | certificate numbers are unique platform-wide (the public verification key); the sequence must step past another tenant's number. Only the maximum is read, never returned (D-40) |
| `customDomains.service.js:135` | a live domain claim is unique across the platform (ADR-065) |
| `jobMonitor.service.js:596` | platform check for stuck batch jobs |
| `scheduledBackup.service.js:207`, `:380` | the scheduled backup's retention pass and tenant page, over every tenant |
| `tenantLifecycle.service.js:317`, `:340` | the (unrouted) hard delete counts and removes a named tenant's rows with an explicit tenant predicate |

### Background work — `runAsSystem` (6)

`utils/jobContext.util.js` `SYSTEM_TASKS` is a **closed list** (W-12, ADR-060/ADR-069): `runAsSystem` refuses a reason not on it, and `isSystemTask: true` appears nowhere else in `src/`. The six: `BATCH_JOB_SWEEP`, `BATCH_JOB_SHUTDOWN` (`batchJob.service.js`), `CALIBRATION_SCAN` (`calibrationScheduler.service.js`), `SESSION_CLEANUP` (`session.service.js`), `QUARANTINE_SWEEP` (`quarantineSweep.service.js`), `WEBHOOK_DISPATCH` (`webhook.service.js` — the claim only; each delivery runs in `runForTenant`). Neither `runAsSystem` nor `runForTenant` sets `isSuperAdmin`.

A job that declares **neither** runs with no context, which `resolveScope` treats as **skip**. Which schedulers still do that was not audited in this pass.

### Unauthenticated routes that resolve a tenant from a capability (5)

Listed as `public` in `routeGateExemptions.js`, with the reason given there. With no principal there is no tenant context, so the hooks skip; the handler's own lookup is the isolation. **Not re-audited here.**

| Route | Capability (from `routeGateExemptions.js`) |
|---|---|
| `POST /api/v1/billing/webhook` | Stripe signature over the raw body. `stripeWebhook.service.js` writes `subscriptions`, `invoices` and `tenants.status` / `plan` for the tenant the Stripe object maps to. Since 2026-09-29 (A-276, ADR-094) a status change follows the dunning rule in `01` and is audited as `system:billing-webhook`; the plan change is still unaudited |
| `GET /api/v1/tenants/public` | an active tenant id the caller already holds; returns branding only |
| `GET /api/v1/certificates/verify/:certificateNumber`, `…/document` | the certificate number (QR code); a signed, expiring token for the document |
| `POST /api/v1/iot/ingest` | the per-device `X-IoT-Token` (A-29, A-45) |

## 5 — The SCIM And Cross-Tenant Findings

The DOC-07 card names four "still-open" findings. On 2026-09-28 the board records all four as **DONE** and the code agrees; what remains open is residue, linked here and not restated.

| Finding | Board status | In the code today | Still open |
|---|---|---|---|
| [A-27](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — any account could mint a `*` key and SCIM made it SUPERADMIN | DONE 2026-09-23 | scope allow-list; SCIM refuses to map a group to SUPERADMIN | — |
| [A-37](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — SCIM create is a cross-tenant existence oracle | index row **DONE 2026-09-27 (ADR-075)**; the card's own header still reads **PARTIAL 2026-09-24** | `scim.service.js` calls `user.service#assertIdentityFree` for `email` and `username` — global, one 409, rate-limited per key (`scimIdentityConflict`), audited as `system:scim` | identity stays **global** by decision (BACKLOG **Q-18**, ADR-051/ADR-075); a persistent 409 is still a signal that an address exists somewhere |
| [A-38](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — SCIM Groups are global roles | DONE 2026-09-24 (ADR-053, migration 0042) | `scim_groups` is tenant-owned; every group query names `tenantId`; another tenant's group is 404 | roles an IdP created through the old code remain global roles; nothing records their tenant |
| [A-39](../../TASKS/AUDIT-2026-09-REMEDIATION.md) — a SCIM group grants nothing, silently | DONE 2026-09-24 (ADR-053) | a group maps to an existing role that grants something; an unmapped group refuses members with 409 | — |

The broader cross-tenant gaps — `Role` as a global table, global `username` / `email` uniqueness on non-SCIM paths — are [`08`](./08-CROSS-TENANT-PROTECTION.md) § Layer 5 and A-01's unfinished last item.

## Adding A New Cross-Tenant Capability

- [ ] it has a row in this document, with its gate and its reason, in the same change
- [ ] a route reserved to the operator uses `superAdminOnly` (and `denyApiKey` where a key could otherwise reach it) — not a hidden menu
- [ ] a path `tenantId` on a tenant-facing route answers **404** for another tenant, identical to a missing id
- [ ] a mutation of another tenant writes an audit row inside the transaction — under PLATFORM, and under the affected tenant where it changes that tenant's data (A-165)
- [ ] a `skipTenantScope` carries a comment saying why; a background job uses `runForTenant`, or adds a `SYSTEM_TASKS` entry in review
- [ ] a Part 11 authoring route carries `denyPlatformAuthoring`

## Related

| For | Read |
|---|---|
| the mechanism | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| role levels and the bypass in each middleware | [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) |
| hierarchy, lifecycle, backup | [`./01-TENANT-HIERARCHY-AND-SUBORGS.md`](./01-TENANT-HIERARCHY-AND-SUBORGS.md) |
| controls and open gaps | [`./08-CROSS-TENANT-PROTECTION.md`](./08-CROSS-TENANT-PROTECTION.md) |
| the P6-04 exemption list this draws on | `backend/src/constants/routeGateExemptions.js` |
