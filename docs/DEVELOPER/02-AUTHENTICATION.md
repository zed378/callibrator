# 02 — Authentication and API-Key Reach

How a caller proves who it is — a user's JWT or a tenant's API key — and, for API keys, which of the 53 route modules a key can actually reach, under which scope string, today.

> **Target standard: TypeScript, strict (ADR-038).** Every backend file named here is **JavaScript/CommonJS as built**. Conversion runs module by module under [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

Derived from the working tree on **2026-09-27**. Several route files were being edited that day; re-derive the table (§ How The Table Was Derived) before relying on a single row.

---

## Read This First

**API-key authorization is deny-by-default (A-03).** A key that authenticates is *not* thereby allowed anywhere. It reaches a controller only if a gate in the chain read its scopes and allowed it — which sets `req.apiKeyAuthorized`. A key that arrives at a wrapped controller without that flag gets **403** `This API key is not authorized for this endpoint` (`backend/src/utils/controllerWrapper.util.js:67–73`, `apiKeyBlocked`).

**Of 407 routes, 179 can be reached by some API key; only 139 by a key you can issue today.** The other 40 gate on `calibration`, `certificate`, `maintenance` or `reports`, and `apiKey.service.js#assertScopes` refuses those resources at creation (§ Scopes, V-02). Calibration devices, calibration records, certificates, maintenance and reports are therefore **not integrable by a new API key**. That is the largest gap in this surface and it is open.

**Keys minted before 2026-09-23 were never re-validated.** A key holding `*` still authorizes every `dynamicAccess` route and SCIM (§ Residual Risk).

---

## Two Credentials

`auth` (`backend/src/middlewares/auth.middleware.js:243`) accepts exactly two header forms:

| Header | Principal | Authorized by |
|---|---|---|
| `Authorization: Bearer <jwt>` | the user, loaded with role and tenant | the role matrix (`dynamicAccess`), `rbac`, `abac`, `superAdminOnly` |
| `Authorization: ApiKey cbk_<56 hex>` | a synthetic service account (`tryApiKeyAuth`, `:206`) | the key's **scopes**, and nothing else |

There is no `X-API-Key` header. (The A-27 reproduction in `TASKS/AUDIT-2026-09-REMEDIATION.md` writes one; `auth` never reads it.) SCIM additionally rewrites `Bearer <non-JWT>` to `ApiKey` — see [`09-SCIM-PROVISIONING.md`](./09-SCIM-PROVISIONING.md) § The Bearer shim.

The user path — sessions, MFA, forced password change, SSO — is in [`../API/01-AUTHENTICATION-API.md`](../API/01-AUTHENTICATION-API.md). This document is about the key path.

### What `tryApiKeyAuth` builds

`apiKey.service.js#verifyApiKey` (`:118`) hashes the raw key (SHA-256) and looks it up with an **INNER** join to its tenant. It returns nothing for: a key without the `cbk_` prefix, an unknown hash, a revoked key (`isActive: false`, soft-deleted by `revokeApiKey`), an expired key, or a key whose tenant is soft-deleted. All of those are **401** `Invalid or expired API key`. A key whose tenant is `suspended` or `deleted` (status) is **403** `Tenant account is <status>`.

Otherwise `req.user` becomes:

```js
{ id: <key id>, tenantId: <key's tenant>, isApiKey: true,
  apiKeyScopes: [...], role: { id: null, name: "API_KEY" }, tenant }
```

and the tenant context is set from the key, so the global tenant hooks scope every query to the key's tenant exactly as for a user. `API_KEY` has no `ROLE_LEVELS` entry, so its level is 0: every `rbac([...])` and `checkRoleLevel(n>0)` refuses it, and `superAdminOnly` refuses it.

---

## The Deny-By-Default Chain

```
auth ─▶ [denyApiKey] ─▶ [rbac / superAdminOnly] ─▶ [dynamicAccess | inline opt-in] ─▶ asyncHandler(controller)
          403 always      403 for any key            sets req.apiKeyAuthorized        403 unless the flag is set
```

| Piece | Where | What it does to a key |
|---|---|---|
| `denyApiKey` | `auth.middleware.js:479` | refuses any key: **403** `API keys cannot access this endpoint` |
| `dynamicAccess(resource, action)` | `dynamicAccess.middleware.js:138` | for a key, `checkApiKeyScope` (`:380`) → `apiKey.service.js#scopeAllows`; on success sets `req.apiKeyAuthorized = true` (`:314–318`); on failure **403** `Forbidden: Insufficient permissions` |
| `requireApiKeyOrAdmin` | `scim.route.js:52` | a key whose scopes allow `scim` (read for GET/HEAD, write otherwise); sets the flag **inline** (`:56`) |
| `allowApiKey` | `auth.middleware.js:496` | the documented explicit opt-in. **It has no call sites** (V-05) |
| `asyncHandler`, `asyncHandlerWithMapping` | `controllerWrapper.util.js:80`, `:147` | the chokepoint: a key without the flag is **403** before the controller runs |

The flag is set in exactly two live places: `dynamicAccess` and SCIM's inline guard. Nothing else — not `rbac`, not `abac`, not the inline `ownRoleOnly` / `ownTenantGuard` / `tenantBroadcastGate` guards, not `dynamicAccess`'s `checkSelf` bypass (which calls `next()` without setting it) — authorizes a key.

### How a route opts in

| Use | When |
|---|---|
| `dynamicAccess("<seeded slug>", "read" \| "write")` | the normal case: the route is a menu surface and a key should reach it with that menu's scope. Users and keys are then judged by the same gate |
| an inline guard that sets `req.apiKeyAuthorized` after its own check | only for an endpoint that is *for* service accounts and authorizes them some other way. SCIM is the one example. `allowApiKey` exists for this and is unused — V-05 asks that SCIM use it or that it be deleted |
| `denyApiKey` | an endpoint a key must never reach even with a matching scope: key management, webhooks, storage settings, signing, publishing, QMS writes, device-token issuance |

A route with `auth` and no gate at all is **not** open to keys (unlike before A-03): the wrapper refuses them. It is still open to every *user* with a token — that is the P6-04 guard's job ([`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) § The Failure Mode).

---

## Scopes

A scope is `<resource>:<read|write>`, lower-cased and stored as given (`apiKey.service.js:59–76`). `write` implies `read`. A bare `<resource>` means `write`. A route's action verb (`create`, `update`, `delete`, `approve`…) counts as `write` for a key (`scopeAllows`, `:154`).

**Issuing** (`POST /api/v1/api-keys`, TENANT_ADMIN, JWT only — `apiKeys.route.js`): `assertScopes` (`:41`) requires a non-empty list, refuses `*` in either position, refuses any action but `read`/`write`, and refuses any resource not in `ALLOWED_RESOURCES`:

```js
const ALLOWED_RESOURCES = new Set(Object.values(MENU_SLUGS).map(...));   // apiKey.service.js:39
```

`MENU_SLUGS` (`constants/roleConstants.js:121`) has **37** slugs; the seed (`utils/seedMenuGroups.util.js`) creates **60**. The gates resolve against the seed. So a gate can name a slug no key can be issued for:

| Gated slug | Issuable? | Modules that gate on it |
|---|---|---|
| `calibration` | **no** | calibrationDevices, calibrationRecords, iot (read), predictiveMaintenance, search (one of three) |
| `certificate` | **no** | certificates, ai (`POST /ocr`), search, workflows (one of three) |
| `maintenance` | **no** | maintenance, calibrationScheduler, workflows (one of three) |
| `reports` | **no** | reports |
| every other gated slug | yes | — |

This is **V-02** in [`../../TASKS/REVIEW-2026-09-23-REMEDIATION.md`](../../TASKS/REVIEW-2026-09-23-REMEDIATION.md), still open in code: the allow-list is built from `MENU_SLUGS`, not from the slugs the gates use. Since V-02 was written `MENU_SLUGS` gained `users`, `vendors`, `billing` and `audit` (Q-20, ADR-056), which closed those four; the four above remain.

`scim` **is** issuable. `scim:write` is what an IdP needs (A-250).

### A-07 — gate names that match no slug

The `DOC-01` card asked this document to list `Management`, `Maintenance`, `Finance`, `Vendors`, `Billing` and `AuditLogs` as open. **None of them appears in the code today.** Every `dynamicAccess` resource on every route in `routes/api` is a seeded slug — 27 distinct names, all present in `seedMenuGroups.util.js` (enumerated for this document; method below). A-07 records the normalisation (2026-09-24) and names its guard, `src/tests/routes/dynamicAccessSlugs.a07.test.js`, which was **not run** for this document.

What A-07 left open, and is still open:

- **V-02**, above — four seeded, gated slugs that no new key can carry.
- **`calibration-scheduler`** is a seeded menu that gates nothing server-side; `calibrationScheduler.route.js` gates on `maintenance`.
- **P9-19** — typing the `dynamicAccess` argument as the slug union — not done.

---

## Route-Module Reachability

**53** route modules under `backend/src/routes/api`, **407** routes. *Key routes* = routes an API key can reach with **some** scope; ✗ marks a scope that cannot be issued today. "Gates" lists what appears anywhere in the module's chains, not on every route. Mounts are under `/api/v1` (`backend/index.js:428–488`).

| Module | Mount | Routes | Public | Gates | Key routes | Scope a key needs |
|---|---|---|---|---|---|---|
| `admin` | `/admin` | 3 | 0 | auth, rbac | 0 | — |
| `ai` | `/ai` | 2 | 0 | auth, dynamicAccess | 2 | `certificate:write` ✗ (`/ocr`), `sop:read` (`/query`) |
| `apiKeys` | `/api-keys` | 4 | 0 | auth, denyApiKey, rbac | 0 | — |
| `attachments` | `/attachments` | 8 | 1 | auth, dynamicAccess, rbac | 6 | `equipment:read`, `equipment:write` (`/orphans` is TENANT_ADMIN) |
| `audit` | `/audit` | 1 | 0 | auth, dynamicAccess | 1 | `audit:read` |
| `auth` | `/auth` | 29 | 18 | auth (self) | 0 | — |
| `batchJobs` | `/jobs` | 3 | 0 | auth, dynamicAccess | 3 | `batch-jobs:read`, `batch-jobs:write` |
| `billing` | `/billing` | 4 | 1 | auth, dynamicAccess | 3 | `billing:read`, `billing:write` |
| `calibrationDevices` | `/calibration-devices` | 7 | 0 | auth, dynamicAccess, rbac | 6 | `calibration:read` ✗, `calibration:write` ✗ |
| `calibrationRecords` | `/calibration-records` | 5 | 0 | auth, dynamicAccess | 5 | `calibration:read` ✗, `calibration:write` ✗ |
| `calibrationScheduler` | `/calibration-scheduler` | 2 | 0 | auth, dynamicAccess | 2 | `maintenance:read` ✗, `maintenance:write` ✗ |
| `certificates` | `/certificates` | 14 | 2 | auth, dynamicAccess | 12 | `certificate:read` ✗, `certificate:write` ✗ |
| `content` | `/content` | 14 | 3 | auth, dynamicAccess | 11 | `content:read`, `content:write` |
| `customDomains` | `/custom-domains` | 7 | 0 | auth, denyApiKey, dynamicAccess | 3 | `custom-domains:read` (writes deny keys) |
| `dashboard` | `/dashboard` | 1 | 0 | auth only (accepted) | 0 | — |
| `dataRetention` | `/tenants` | 8 | 0 | auth, dynamicAccess, superAdminOnly | 2 | `data-retention:read` |
| `eSignature` | `/esignature` | 15 | 0 | auth, denyApiKey, dynamicAccess | 8 | `qms:read`, `qms:write` (`GET /signers`), `esignature:read` |
| `featureFlags` | `/feature-flags` | 6 | 0 | auth, dynamicAccess, superAdminOnly | 3 | `feature-flags:read` |
| `finance` | `/finance` | 6 | 0 | auth, dynamicAccess | 6 | `finance:read`, `finance:write` |
| `gdpr` | `/gdpr` | 8 | 0 | auth (self) | 0 | — |
| `iot` | `/iot` | 5 | 1 | auth, denyApiKey, rbac, dynamicAccess | 1 | `calibration:read` ✗ (`GET /devices/:deviceId`) |
| `kanban` | `/kanban` | 28 | 0 | auth (service) | 0 | — |
| `maintenance` | `/maintenance` | 5 | 0 | auth, dynamicAccess | 5 | `maintenance:read` ✗, `maintenance:write` ✗ |
| `menuGroups` | `/menu-groups`, `/menu-group-roles` | 14 | 0 | auth, rbac, inline `ownRoleOnly` | 0 | — |
| `meteredBilling` | `/metered-billing` | 8 | 0 | auth, dynamicAccess | 8 | `metered-billing:read`, `metered-billing:write` |
| `networkSecurity` | `/network-security` | 5 | 0 | auth, dynamicAccess, superAdminOnly | 3 | `network-security:read` |
| `notifications` | `/notifications` | 7 | 0 | auth (self), inline `tenantBroadcastGate` | 0 | — |
| `oidc` | `/oidc` (and root `/oidc`) | 11 | 5 | auth, superAdminOnly, dynamicAccess | 1 | `oidc:read` (`GET /clients`) |
| `predictiveMaintenance` | `/predictive-maintenance` | 3 | 0 | auth, dynamicAccess | 3 | `calibration:read` ✗, `calibration:write` ✗ |
| `qms` | `/qms` | 6 | 0 | auth, denyApiKey, dynamicAccess | 2 | `qms:read` (writes deny keys) |
| `quota` | `/quota` | 1 | 0 | auth, dynamicAccess | 1 | `billing:read` |
| `reports` | `/reports` | 5 | 0 | auth, dynamicAccess | 5 | `reports:read` ✗ |
| `risk` | `/risk` | 5 | 0 | auth, dynamicAccess | 5 | `risk:read`, `risk:write` |
| `roles` | `/roles` | 14 | 0 | auth, rbac | 0 | — |
| `scim` | `/scim/v2` | 12 | 0 | auth, inline `requireApiKeyOrAdmin` | 12 | `scim:read` (GET), `scim:write` |
| `search` | `/search` | 1 | 0 | auth, dynamicAccess | 1 | any of `calibration` ✗ / `warehouse` / `certificate` ✗ `:read` — types filtered per scope (A-04) |
| `session` | `/sessions` | 6 | 0 | auth, rbac | 0 | — |
| `sop` | `/sop` | 4 | 0 | auth, denyApiKey, dynamicAccess | 2 | `sop:read`, `sop:write` (create only; publish and acknowledge deny keys) |
| `stock` | `/stocks` | 15 | 0 | auth, dynamicAccess | 15 | `warehouse:read`, `warehouse:write` |
| `storage` | `/storage` | 6 | 1 | auth, denyApiKey, rbac | 0 | — |
| `supplierScorecard` | `/supplier-scorecard` | 5 | 0 | auth, denyApiKey, dynamicAccess | 2 | `supplier-scorecard:read` |
| `tenant` | `/tenants` | 11 | 1 | auth, superAdminOnly, dynamicAccess | 7 | `management:read`, `management:write` |
| `tenantBackup` | `/tenants` | 7 | 0 | auth, rbac, abac | 0 | — |
| `tenantHierarchy` | `/tenant-hierarchy` | 9 | 0 | auth, denyApiKey, superAdminOnly, inline `ownTenantGuard` | 0 | — |
| `tenantLifecycle` | `/tenants` | 7 | 0 | auth, dynamicAccess, superAdminOnly | 1 | `tenant-lifecycle:read` |
| `tickets` | `/tickets` | 8 | 0 | auth (service) | 0 | — |
| `user` | `/users` | 13 | 0 | auth, dynamicAccess, rbac | 10 | `users:read`, `users:write` (MFA/passkey/password reset are TENANT_ADMIN) |
| `userPermissions` | `/user-permissions` | 3 | 0 | auth, rbac | 0 | — |
| `vendor` | `/vendors` | 6 | 0 | auth, dynamicAccess | 6 | `vendors:read`, `vendors:write` |
| `warehouse` | `/warehouses` | 9 | 0 | auth, dynamicAccess | 9 | `warehouse:read`, `warehouse:write` |
| `webauthn` | `/webauthn` | 6 | 0 | auth (self) | 0 | — |
| `webhooks` | `/webhooks` | 8 | 0 | auth, denyApiKey, rbac | 0 | — |
| `workflows` | `/workflows` | 7 | 0 | auth, dynamicAccess | 7 | `workflows:read`, `workflows:write`; `POST /instances/:instanceId/action` takes any of `certificate` ✗ / `warehouse` / `maintenance` ✗ `:write` |
| **total** | | **407** | **33** | | **179** | 139 with an issuable scope |

"(self)", "(service)", "(accepted)" are the kinds in `backend/src/constants/routeGateExemptions.js`: a key reaches none of those routes, because nothing in their chain sets the flag. Public routes take no `auth`; an `ApiKey` header on them is simply not read.

Two things the table does not show and an integrator should know:

- **A `users:write` key reaches `POST /users/create`, `/role-update`, `PATCH /users/edit` and `DELETE /users/delete`.** What `user.service` lets an actor with no role level assign was **not checked** for this document.
- **A `management:write` key reaches `PATCH /tenants/settings` and `/tenants/edit`** under `checkTenant` — its own tenant only.

### How the table was derived

A scratch script (not committed) loaded every module in `backend/src/routes/api` in Node with placeholder environment variables, after wrapping the `dynamicAccess`, `rbac` and `checkRoleLevel` factories to record their arguments. It walked each router's `stack` — `router.use` layers and route layers, in order — and classified every function: `auth`, `denyApiKey`, `superAdminOnly`, `abac` and inline guards by name or source; the final handler as *wrapped* if its source calls `apiKeyBlocked`. A route counts as key-reachable when it has `auth`, no `denyApiKey`, no `rbac`/`checkRoleLevel`/`superAdminOnly`, and either a `dynamicAccess` or an inline guard that sets the flag — **or** an unwrapped handler (none found). Issuability was checked against `MENU_SLUGS` at runtime. SCIM, IoT, predictive maintenance, search and the workflow action route were then read by hand.

The committed equivalents are `src/tests/routes/routePermissionGuard.p604.test.js` (every route has a gate or an exemption) and `src/tests/routes/dynamicAccessSlugs.a07.test.js` (every gate is a seeded slug). **Neither asserts API-key reachability.** A-03's third Definition-of-Done box — a test that enumerates the router stack and fails when a route accepts a key without a declared scope — is still unchecked, and this table is not that test.

---

## Residual Risk

**Controllers outside the chokepoint.** A-03 named two (`iot.controller.js`, `predictiveMaintenance.controller.js`); V-05 named three (adding `health.controller.js`). Today, by `grep` for `asyncHandler` and for bare `exports.x = async`:

| Unwrapped | Route | Can a key reach it? |
|---|---|---|
| `predictiveMaintenance.controller.js` — all three handlers | `dynamicAccess("calibration", …)` | only with a `calibration` scope, which cannot be issued (V-02) |
| `health.controller.js` — whole file | `routes/internal/health.route.js`: public probes, and `/api/v1/health` behind `auth, denyApiKey, superAdminOnly` | no |
| `iot.controller.js#ingestHttp` (`:14`) — the rest of the file is wrapped | `POST /iot/ingest`, public, device token | not by API key |
| `billing.controller.js#handleStripeWebhook` (`:40`) | `POST /billing/webhook`, public, Stripe signature | not by API key |
| `oidcProvider.controller.js#token` (`:63`), `#userinfo` (`:101`) | public OIDC endpoints | not by API key |

None is reachable by a key without a gate today. Each is outside the guard, so a gate removed from one of those routes would open it to keys silently. The comment at `controllerWrapper.util.js:61` still says "every controller but two is wrapped" — V-05, open.

**Pre-2026-09-23 keys.** `assertScopes` runs only in `createApiKey`. `scopeAllows` still honours `*` as a resource, an action, or the whole scope (`apiKey.service.js:157–166`), and no migration touches `api_keys.scopes`. A key minted before A-27 with `["*"]` therefore still reaches all 179 key routes and SCIM with write. Whether any such key exists on any deployment is **unverified**; V-02's Definition of Done asks for exactly that enumeration.

**No per-key rate limit.** A key is limited by the global per-address limiter like any caller ([`03-RATE-LIMITS-AND-ERROR-CODES.md`](./03-RATE-LIMITS-AND-ERROR-CODES.md)).

**Not verified live.** Nothing in this document was exercised against a running server. A-03 records that an `ApiKey` header does traverse Cloudflare → nginx → Next.js → backend on the reference deployment (an invalid key returned `Invalid or expired API key`).

---

## What A Key Sees

| Status | Body `message` | Cause |
|---|---|---|
| 401 | `Invalid or expired API key` | unknown, revoked or expired key; or its tenant is soft-deleted |
| 403 | `Tenant account is suspended` / `deleted` | tenant status |
| 403 | `API keys cannot access this endpoint` | `denyApiKey` |
| 403 | `Forbidden: Insufficient permissions` | `dynamicAccess` — the key's scopes do not cover the resource/action; or `rbac` refused it |
| 403 | `Super admin access required` | `superAdminOnly` |
| 403 | `This API key is not authorized for this endpoint` | no gate authorized the key (the chokepoint) |
| 403 | SCIM error object | SCIM without `scim:read`/`scim:write` |
| 404 | `Tenant not found` / `Resource not found` | `checkTenant` — another tenant's id; identical to a missing one |

The full status-code contract is in [`03-RATE-LIMITS-AND-ERROR-CODES.md`](./03-RATE-LIMITS-AND-ERROR-CODES.md).

## Related

| For | Read |
|---|---|
| where to start as an integrator | [`00-INTEGRATION-QUICKSTART.md`](./00-INTEGRATION-QUICKSTART.md) |
| the gates themselves, and the P6-04 guard | [`../SECURITY/04-AUTHORIZATION-RBAC.md`](../SECURITY/04-AUTHORIZATION-RBAC.md) |
| key management endpoints | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/api-keys` |
| SCIM's use of keys | [`09-SCIM-PROVISIONING.md`](./09-SCIM-PROVISIONING.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-03, A-07, A-27, A-250 · [`../../TASKS/REVIEW-2026-09-23-REMEDIATION.md`](../../TASKS/REVIEW-2026-09-23-REMEDIATION.md) § V-02, V-05 |
