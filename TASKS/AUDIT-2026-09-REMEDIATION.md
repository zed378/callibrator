# Audit 2026-09 — Remediation

Tasks for every defect and gap found in the backend audit of **2026-09-21** (and the deployment audit of 2026-09-10/11 where it is still open). The findings and their evidence are recorded in [`../MEMORY/records/2026-09-21-backend-audit.md`](../MEMORY/records/2026-09-21-backend-audit.md).

Task ids are `A-nn`. They are referenced from [`PHASE-9-TYPESCRIPT-MIGRATION.md`](./PHASE-9-TYPESCRIPT-MIGRATION.md) and from `BACKLOG.md`.

---

## How These Are Ordered

| Wave | Rule | Why |
|---|---|---|
| **0 — security** | fix **now, in JavaScript**, before Phase 9 starts | live holes on a production deployment. A months-long migration is not a reason to leave them open (ADR-038) |
| **1 — correctness** | fix before or alongside the Phase 9 stage that converts the module | a defect the type checker will expose anyway should get its own PR, not ride inside a conversion (ADR-038 rule 3) |
| **2 — hygiene and gaps** | schedule freely | real, but nothing is broken for a user today |

**Evidence standard.** Every card names the file, the route, or the command that shows the defect. "Verified from code" means read, not exploited; nothing here was attacked on the live system. Where a finding is **unverified**, the card says so and its first checkbox is the verification.

## Summary

| Id | Finding | Severity | Wave | Status |
|---|---|---|---|---|
| A-01 | `tenant-hierarchy` lets any authenticated principal write **other tenants** | **critical** | 0 | **DONE** 2026-09-23 |
| A-02 | webhook, storage-settings and custom-domain routes are guarded only by `auth` | **high** | 0 | **DONE** 2026-09-23 |
| A-03 | API keys ignore their scopes on every route without `dynamicAccess` | **high** | 0 | **DONE** 2026-09-23 |
| A-04 | `/search` returns records the caller's role cannot list | medium | 0 | TODO |
| A-05 | Socket.IO: `origin: "*"`, token in the query string, no status or suspension check | medium | 0 | TODO |
| A-06 | public `/health` discloses Node version, pid and memory | low | 0 | TODO |
| A-07 | `dynamicAccess` resource names that match no menu slug | **unverified — possibly high** | 1 | TODO |
| A-08 | metered billing read every tenant's usage as **zero** | high | — | **DONE** 2026-09-21 |
| A-09 | Express 5 undefined `req.body` → 500 | medium | 1 | partly DONE |
| A-10 | webhook delivery: retries lost on restart, ~15 s window, no replay protection | medium | 1 | TODO |
| A-11 | only two domain events are ever emitted to webhooks | medium | 1 | TODO |
| A-12 | `sessionSecurity.middleware.js` is dead and its SQL is broken | medium | 1 | TODO |
| A-13 | raw internal error messages reach clients in production | medium | 0 | TODO |
| A-14 | production logging: no stdout, per-request lines dropped, unbounded files | medium | 1 | TODO |
| A-15 | `/health` checks only the database | medium | 1 | TODO |
| A-16 | whether `req.ip` is the client through a three-proxy chain | **unverified** | 1 | TODO |
| A-17 | MQTT: public port with nothing behind it; the MQTT path authenticates nobody | low | 0 | TODO |
| A-18 | dead code and unused dependencies | low | 2 | TODO |
| A-19 | no secret scanner, no hook, no gate of any kind | medium | 2 | TODO |
| A-20 | the `automate/` Playwright suite is not in the repository | medium | 2 | TODO |
| A-21 | no lockfile is committed | medium | 2 | TODO |
| A-22 | one React Compiler lint error in `GlobalSearch.tsx` | low | 2 | TODO |
| A-23 | search runs one query per type, sequentially, and logs a warning per call | low | 2 | TODO |
| A-24 | every `redis.service` helper was a no-op: **registration, passkeys and the OIDC provider broken** | **high** | — | **DONE** 2026-09-21 |
| A-25 | Stripe `upsertInvoice` never updates: an invoice that failed and was later paid stays **Open** | medium | 1 | TODO |
| A-26 | no consumer deduplicates: a redelivered email is sent twice (documented "idempotency claims" do not exist) | medium | 1 | TODO |
| A-27 | **any account could mint a `*` API key and have SCIM make it SUPERADMIN** | **critical** | 0 | **DONE** 2026-09-23 |
| A-28 | evidence and controlled documents mutable by any role (attachments, signing keys, SOP, risks) | **high** | 0 | TODO |
| A-29 | IoT ingest cannot be provisioned; its token would leak in list responses | medium | 1 | TODO |
| A-30 | the rate limiter never uses Redis — lockouts reset on every deploy | **high** | 0 | TODO |
| A-31 | nothing stops JWT access and refresh secrets being equal | low | 1 | TODO |
| A-32 | the 100% coverage figure includes 58 `istanbul ignore` exclusions | low | 2 | TODO |
| A-33 | SCIM PATCH ignores `path`: a standards-compliant deprovision returns 200 and does nothing | medium | 1 | TODO |

---

## Wave 0 — Security

### A-01 — Cross-tenant write on `tenant-hierarchy`

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **critical** |
| **Evidence** | `backend/src/routes/api/tenantHierarchy.route.js`: `router.post("/:parentId/children", auth, addChildTenant)`, `router.put("/:tenantId/parent", auth, …)`, `router.delete("/:tenantId/parent", auth, …)` — no role, scope or ownership gate. `tenantHierarchy.controller.js#updateTenantParent` calls `Tenant.findByPk(tenantId)` and `Tenant.update({ parentId }, { where: { id: tenantId } })`. The `Tenant` model has no `tenantId` attribute, so the global scoping hooks **do not apply to it**. |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · `docs/MULTI-TENANCY/08-CROSS-TENANT-PROTECTION.md` · `roleConstants.js` `ROLE_MENU_ASSIGNMENTS` (tenant-hierarchy: **write = SUPERADMIN only**) |
| **Spec required** | no — the intended access is already encoded in the menu matrix |

**Why:** any authenticated user of any tenant — or any API key, whatever its scope — can create a sub-organisation under another tenant, and re-parent or detach another tenant. The menu matrix says only `SUPERADMIN` may write here; the backend enforces nothing. It is hidden in the UI, which is not a control.

**Definition of Done**
- [ ] every mutating `tenant-hierarchy` route is `superAdminOnly` and `denyApiKey`
- [ ] read routes return only the caller's own subtree unless the caller is `SUPERADMIN`; another tenant's id returns **404**, not 403
- [ ] tests: a `USER` in tenant A attempting each mutation on tenant B gets 403/404 **and nothing changes in the database**; an API key gets 403; `SUPERADMIN` succeeds
- [ ] the same audit applied to every other route that loads `Tenant` by a path id — the unscoped model is the root cause, and it may not be the only instance

**Abuse cases**
- Hiding the menu harder instead of gating the route
- Testing only that the response is an error, not that the row is unchanged

---

**What was changed (2026-09-23)** — `routes/api/tenantHierarchy.route.js`

| Route | Gate |
|---|---|
| `GET /:tenantId/children`, `/parent`, `/descendants`, `/ancestors` | `ownTenantGuard` — the id must be the caller's own tenant, or the caller is SUPERADMIN. A cross-tenant id is **404**, not 403 |
| `POST /:parentId/children`, `PUT` and `DELETE /:tenantId/parent`, `GET /cross-tenant-roles` | `[auth, denyApiKey, superAdminOnly]` — re-parenting a tenant is a platform operation, and `cross-tenant-roles` reads role assignments for an arbitrary user id |

The handlers themselves are unchanged: they call `Tenant.findByPk` / `Tenant.update`, which the
global hooks do not scope because the `Tenant` model has no `tenantId` attribute. The gate is what
constrains them.

**Verification** — `npx jest src/tests/routes/tenantHierarchy` → 23 tests, including
`tenantHierarchy.guards.test.js` "answers 404 for another tenant" (one per read route) and
"requires auth, denies API keys and requires SUPERADMIN" (one per mutation). Still open: a live
two-tenant reproduction against a running server.

---

### A-02 — Tenant configuration guarded only by `auth`

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** |
| **Evidence** | `webhooks.route.js` (7 routes: `auth` + `requireFeature("webhooks")`); `storage.route.js` (`PUT/DELETE /settings`, `POST /settings/test`: `auth` only); `customDomains.route.js` (7 routes: `auth` only). Their controllers contain no role or API-key check. |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` · `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` · `docs/STORAGE/04-TENANT-STORAGE.md` |
| **Spec required** | **yes** — `MEMORY/specs/A-02-tenant-config-access.md`: who may configure webhooks, storage and domains. The menu matrix gives `custom-domains` write to `SUPERADMIN` only; webhooks and storage have no menu slug at all |

**Why:** the lowest-privilege account in a tenant can:
- point the **tenant's object storage at a bucket it controls**, so every later upload lands with the attacker;
- register a webhook that ships device events to an address it chose;
- add, remove or change the default custom domain.

**Definition of Done**
- [ ] the access decision recorded in the spec, then enforced at the route (`rbac` or `dynamicAccess`) **and** `denyApiKey` on storage settings
- [ ] webhooks and storage get menu slugs so the matrix can express them
- [ ] negative tests per route: a `USER` gets 403 and the configuration is unchanged

**Abuse cases**
- Gating the GET routes and forgetting `POST /settings/test`, which makes the server connect to a caller-supplied endpoint

---

**What was changed (2026-09-23)**

| Router | Gate |
|---|---|
| `webhooks.route.js` (7 routes) | `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` — a webhook decides where the tenant's events are POSTed and its secret signs them |
| `storage.route.js` `/settings*` (4 routes) | `[auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]` — these hold the tenant's object-storage credentials. `GET /object` is deliberately left out: it is the read path for stored files |
| `customDomains.route.js` (7 routes) | `dynamicAccess(MENU_SLUGS.CUSTOM_DOMAINS, read\|write)`, plus `denyApiKey` on writes. The slug already exists with WRITE for the admin roles and READ below them |

**Verification** — `npx jest src/tests/routes/routeGuards.a02` → 21 tests, one per route, plus
"leaves no route on auth alone" for the webhook and custom-domain routers.

---

### A-03 — API keys ignore their scopes on ungated routes

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** |
| **Evidence** | `auth.middleware.js#tryApiKeyAuth` admits the key; scopes are enforced **only** in `dynamicAccess` (`checkApiKeyScope`). 16 of 53 route files use `dynamicAccess`; 31 use neither it nor `rbac`; only 4 (`apiKeys`, `eSignature`, `qms`, `supplierScorecard`) use `denyApiKey`. A key scoped `warehouse:read` therefore reaches every route in those 31 files. Header verified to traverse Cloudflare → nginx → Next.js → backend (an invalid key returns `Invalid or expired API key`). |
| **Spec refs** | `docs/DEVELOPER/02-AUTHENTICATION.md` · `docs/API/13-INTEGRATION-API.md` |
| **Spec required** | no |

**Why:** a scope that is only checked on some routes is not a scope.

**Definition of Done**
- [ ] **default-deny for API keys**: `auth` rejects an API-key principal on any route that does not declare a scope, via an explicit `apiKeyScope(resource, action)` or `dynamicAccess`
- [ ] every route that should be reachable by keys declares its scope; the list is in `docs/DEVELOPER/02-AUTHENTICATION.md`
- [ ] a test enumerates the router stack and fails if a route accepts an API key without a declared scope

**Abuse cases**
- Adding `denyApiKey` to the routes someone happened to think of

---

**What was changed (2026-09-23)** — authorization for API keys is now deny-by-default.

| Piece | File |
|---|---|
| a gate that has read the key's scopes and allowed it sets `req.apiKeyAuthorized` | `middlewares/dynamicAccess.middleware.js` |
| `allowApiKey` — the explicit opt-in for endpoints meant for service accounts | `middlewares/auth.middleware.js` |
| SCIM opts in inside `requireApiKeyOrAdmin` (it authorizes the key itself rather than by scope) | `routes/api/scim.route.js` |
| the chokepoint: an API-key principal that reaches a wrapped controller without that flag gets **403** | `utils/controllerWrapper.util.js` (`asyncHandler`, `asyncHandlerWithMapping`) |

**Why the controller wrapper.** Express has no hook that runs after the middleware chain but
before the handler, and the gate is not always in the route's own stack (several routers apply
`auth` with `router.use`). Every controller but two is wrapped, so the wrapper is the one place
that sees every request after every gate has run.

**Residual risk — named, not hidden:** `iot.controller.js` and `predictiveMaintenance.controller.js`
do not use the wrapper. IoT ingest authenticates by device token, not API key; predictive
maintenance is behind `dynamicAccess`, which sets the flag. Any new controller written without the
wrapper is outside this guard — folded into A-07's sweep.

**Verification** — `npx jest src/tests/utils/controllerWrapper.apiKey` → 7 tests
("refuses an API key that no gate authorized", "runs the controller when a gate authorized the
key", plus the ordinary-user, unauthenticated and no-request cases) and
`src/tests/middlewares/auth.test.js` § "allowApiKey (A-03)".

---

### A-04 — `/search` bypasses read permissions

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `search.route.js`: `router.get("/", auth, searchController.search)`. `search.service.js` returns devices, stock and certificates for the tenant with no permission filter. |
| **Spec refs** | `docs/SEARCH/01-GLOBAL-SEARCH.md` |

**Why:** a role with no `warehouse` or `certificate` read permission can list stock and certificates through search. Tenant isolation holds (the raw SQL carries `tenant_id` explicitly); authorisation inside the tenant does not.

**Definition of Done**
- [ ] each result type is included only if the caller holds `read` on its menu slug (`equipment`, `warehouse`, `certificate`)
- [ ] API keys limited to their scopes the same way
- [ ] tests per role

---

### A-05 — Socket.IO hardening

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `src/config/socket.js`: `cors: { origin: "*" }` with the comment "Adjust for production"; token read from `handshake.auth.token` **or** `handshake.query.token`; the middleware checks only that the user exists — not account status, tenant suspension, or session revocation. |
| **Spec refs** | `docs/ARCHITECTURE/10-REALTIME-ARCHITECTURE.md` · `docs/MULTI-TENANCY/06-REALTIME-ISOLATION.md` |

**Definition of Done**
- [ ] CORS origin from `CORS_ORIGIN`, as on the HTTP layer
- [ ] query-string tokens rejected — they land in proxy access logs
- [ ] handshake rejects inactive users, suspended tenants and revoked sessions, matching `auth.middleware.js`
- [ ] tests for each rejection

---

### A-06 — `/health` information disclosure

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/index.js` `GET /health` returns `node: process.version`, `pid`, `memory`, `uptime` — routed publicly by nginx. |

**Definition of Done**
- [ ] public `/health` returns status and dependency state only; runtime detail moves behind authentication or off the public route

---

### A-13 — Raw error messages reach clients in production

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `utils/controllerWrapper.util.js#asyncHandler` (used by **44** controllers) calls `sendError(res, error.message, status, …)` **before** the central `errorHandler` can sanitise, then calls `next(error)` anyway, so the handler runs after headers are sent. Observed on production: `Cannot read properties of undefined (reading 'roleId')` returned verbatim. `dynamicAccess.middleware.js` returns `{ success: false, message: error.message }` with a 500 and no envelope. |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` · `docs/API/00-API-STANDARDS.md` |

**Why:** a raw PostgreSQL message carries SQL and schema names; a raw Node message carries internals. `P0-12` claims "the error mapper forwards recognised types only" — true of the mapper, and bypassed by the wrapper in front of it.

**Definition of Done**
- [ ] `asyncHandler` forwards to `next(error)` only; the central handler alone writes error responses
- [ ] non-`AppError` errors return a generic message with the request id in production
- [ ] `dynamicAccess` errors go through the same path
- [ ] a test throws a raw `Error("SELECT secret FROM …")` in a wrapped controller and asserts the text does not appear in the production response

---

### A-17 — MQTT exposure

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `docker-compose.vm.yml` publishes `0.0.0.0:19883:1883` on the backend; nothing listens there (the backend is an MQTT **client**, and MQTT is off on this deployment). `iot.service.js` takes device and tenant ids from the topic; there is no publisher authentication beyond the external broker's ACLs. `ingestReading` does require the pair to match an IoT-enabled device. |

**Definition of Done**
- [ ] the port mapping removed from the vm and dev overlays unless a broker sidecar is added
- [ ] `docs/DEVELOPER/07-IOT-INGEST.md` states the broker ACL requirement plainly: a publisher allowed on `device/#` can post readings for any device whose id and tenant id it knows

---

### A-27 — Any account could mint an unrestricted API key, and SCIM would make it SUPERADMIN

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **critical — full platform takeover by the lowest-privilege account** |
| **Verified** | from code, 2026-09-21; **corrected 2026-09-23** (see below). **Not exploited**: doing so on the reference deployment would change real privileges |
| **Spec refs** | `docs/API/13-INTEGRATION-API.md` § SCIM · `docs/DEVELOPER/09-SCIM-PROVISIONING.md` · `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |

> **Correction to the 2026-09-21 write-up.** It said every SCIM route is guarded by `auth` alone.
> That is wrong: `scim.route.js:38–45` also applies `requireApiKeyOrAdmin`, so a plain user JWT
> gets 403. The escalation was real, but it ran **through API-key issuance**, which was open to
> every authenticated user. The original text is kept below the line so the correction is visible.

**Root cause — four facts that combined**

| # | Fact | Where |
|---|---|---|
| 1 | `POST /api/v1/api-keys` was guarded by `auth` + `denyApiKey` only — **any** authenticated user, of any role, could mint a key | `routes/api/apiKeys.route.js` |
| 2 | the key's scopes were whatever the caller sent: `Array.isArray(scopes) ? scopes : []`, no allow-list — `["*"]` was accepted | `services/apiKey.service.js#createApiKey` |
| 3 | SCIM accepts **any** API key as a service account (`req.user.isApiKey`), regardless of its scopes | `routes/api/scim.route.js:38–45` |
| 4 | SCIM wrote a caller-chosen `roleId`, and the SUPERADMIN role id is a **committed constant** — `ROLE_IDS.SUPER_ADMIN = "9be20605-cc6a-4d91-8246-9756b4a1754b"` — which skips every permission gate and every tenant predicate | `services/scim.service.js` `createUser` / `updateUser` / `patchUser` · `constants/roleConstants.js` · `utils/tenantScope.util.js` |

**Reproduction** — on a **disposable local stack only**:

```http
POST /api/v1/auth/login                          # as any user, e.g. role USER
POST /api/v1/api-keys                            # step 1: mint an unrestricted key
Authorization: Bearer <that user's access token>
{ "name": "x", "scopes": ["*"] }

POST /api/v1/scim/v2/Users                       # step 2: provision a platform operator
X-API-Key: <the key from step 1>
{ "userName": "me@evil.test", "roleId": "9be20605-cc6a-4d91-8246-9756b4a1754b" }
```

Before the fix: 201, and that account is SUPERADMIN. Note the SCIM **PATCH** form — `patchUser`
reads `op.value` as an object and **ignores `op.path`** (A-33), so the escalating patch is
`{ "op": "replace", "value": { "roleId": "<id>" } }`, not the path-based form the 2026-09-21
write-up showed.

**Three more paths through the same module**

| Path | Effect |
|---|---|
| `PATCH /Groups/<SUPERADMIN id>` with `op: add, members: [<own id>]` | `Users.update({ roleId: groupId })` — the same escalation via membership |
| `PUT` / `PATCH /Groups/<any role id>` with a new `displayName` | renames a **global** role, including system roles; code that compares role **names** (`ROLE_LEVELS`, `role.name === "SUPERADMIN"`) then misbehaves for **every tenant** |
| `DELETE /Groups/<any role id>` | `role.destroy()` with no `isSystem` check — deletes a global role out from under every tenant |

**Impact:** any authenticated principal — a room user, a warehouse clerk — could become platform
operator, read and modify every hospital's data, and delete or rename the roles every tenant
depends on.

**What was changed (2026-09-23)**

| Change | File |
|---|---|
| API-key management is `TENANT_ADMIN`-only (`const adminOnly = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])]`), applied to all four routes | `routes/api/apiKeys.route.js` |
| `assertScopes()` — scopes must be a non-empty list of `<menu slug>:<read\|write>`; `*` in either position, unknown resources and unknown actions are 400; stored lower-cased | `services/apiKey.service.js` |
| `assertAssignableRole()` — refuses `ROLE_IDS.SUPER_ADMIN`, any role named SUPERADMIN, and unknown role ids (400). Called at all five sites that assign a role: `createUser`, `updateUser`, the two `patchUser` branches, and group membership | `services/scim.service.js` |
| `assertMutableGroup()` — `isSystem` roles cannot be renamed, patched or deleted through SCIM | `services/scim.service.js` |

**Verification** — `npx jest src/tests/services/scim src/tests/services/apiKey src/tests/routes/scim src/tests/routes/apiKey` → 6 suites, 166 tests, all passing. The new cases are in
`src/tests/services/scim.service.test.js` § "scim.service — privileged role guards (A-27)"
(7 tests: create/update/patch into SUPERADMIN, unknown roleId, rename/delete/patch a system role)
and `src/tests/services/apiKey.service.test.js` (wildcard scopes, unknown resource, unknown action,
empty list, non-array, lower-casing).

**Not covered by this fix — still open**
- [ ] SCIM mutations write no audit row attributed to the IdP credential (folded into A-33)
- [ ] roles are **global**, not per-tenant; SCIM group management therefore edits rows every tenant shares. That is a data-model question, not a guard — Open Question in `TASKS/BACKLOG.md`
- [ ] a live two-account reproduction on a disposable stack (unit tests only so far)

**Abuse cases covered by the tests**
- Blocking the role id while `members` still assigns it — membership goes through the same guard
- Filtering the constant but not a renamed SUPERADMIN row — the guard checks `role.name` too

---

### A-28 — Evidence and controlled documents can be changed by any role

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — compliance** (ISO 13485 document control, 21 CFR Part 11 records) |
| **Verified** | from code, 2026-09-21 |

**Root cause:** the routes below carry `auth` and nothing else, and their services check tenant only — never role or ownership.

| Route | Service | What any role can do |
|---|---|---|
| `DELETE /api/v1/attachments/:id` (`attachments.route.js:204`) | `attachment.service.js#deleteAttachment` (`:172`) — `(tenantId, id)` only | delete any attachment in the tenant, including calibration evidence and certificate support files |
| `DELETE /api/v1/esignature/key-pairs/:keyPairId` | `eSignature.service.js#deleteKeyPair` (`:161`) — `where: { id, tenantId }` | delete the tenant's signing keys. **Creating** a key pair is `denyApiKey` (`:125`); **deleting** one is not, so any API key can |
| `POST / PUT / DELETE /api/v1/esignature/workflows` | workflow CRUD | create, change or delete multi-party signing workflows, including in-flight ones |
| `POST /api/v1/sop`, `PATCH /api/v1/sop/:id/publish` (`sop.route.js:56`, `:104`) | `sop.service.js#publishDocument` (`:46`) — sets `PUBLISHED`, no approver | author **and publish** a controlled procedure with no review. The service comment reads "in a real app, this might be filtered by role" |
| `POST / PUT / DELETE /api/v1/risks` (`risk.route.js:56`, `:170`, `:195`) | `risk.service.js` — tenant only | create, rescore or delete entries in the risk register |

**Impact:** an auditor asks who approved SOP rev 3, or why a calibration's evidence file is missing. Today the honest answer is "any account could have". Deletion of signing keys may also make past signatures unverifiable, depending on where public keys are kept — verify before assuming either way.

**Fix direction:** gate each with `dynamicAccess` on its menu slug (`attachments`, `qms`, `sop`, `risk` exist in `MENU_SLUGS`) and `denyApiKey` for key and workflow management; SOP publish requires a role distinct from the author (separation of duties); deletion of evidence-bearing attachments becomes a soft delete with an audit row, or is refused once the parent record is signed.

**Verification (DoD)**
- [ ] per route: a `USER` gets 403 and the row is unchanged
- [ ] an API key cannot delete a key pair
- [ ] SOP publish by its author is refused; by a second authorised role succeeds and is audited
- [ ] a decision recorded on whether deleting a key pair breaks verification of existing signatures

---

### A-29 — IoT ingest cannot be provisioned, and its credential would leak if it could

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — a shipped feature that cannot receive data; a latent credential leak |
| **Verified** | from code and the reference database (`0` devices with `iot_enabled`, `0` with a token) |

**Root cause**
- Nothing sets `iotEnabled` or `iotDeviceToken`: no service assigns them, no validator accepts them (`calibrationDevices.validator.js` has no IoT field), no frontend surface shows them. The only reference is the lookup in `iot.controller.js:21`.
- `POST /api/v1/iot/ingest` therefore returns 401 for every device unless a token is written into the database by hand. MQTT ingest (off on the reference deployment) authenticates by topic and needs the same flag.
- Predictive maintenance, documented as deriving risk "from IoT readings", has no readings to derive from.
- `calibrationDevice.model.js` `defaultScope` excludes nothing: once a token exists it is returned in every device list and detail response — the leak `PHASE-3` P3-01 warns about ("a token in the device register is a leak to everyone who can read it").

**Documentation impact:** `PHASE-5` marks P5-02 IoT telemetry "✅ DONE". Built, tested with mocks, and **unreachable**.

**Fix direction:** an admin-only endpoint that issues a random token (≥ 32 bytes, stored **hashed**, shown once — as API keys already are) and toggles `iotEnabled`; the token excluded from default attributes; a UI surface; a rate limit on `/iot/ingest`.

**Verification (DoD)**
- [ ] a device can be provisioned end to end through the API and ingest succeeds
- [ ] no device response contains the token
- [ ] tokens are hashed at rest

---

### A-30 — The rate limiter never uses Redis

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** — brute-force protection resets on every deploy |
| **Verified** | from code |

**Root cause:** `rateLimiter.redis.service.js` constructs its Redis client inside `getRedis()` (`:34`), which is **not exported and never called**. `redisReady` is never true, so every counter lives in the in-process `Map`. Twelve `istanbul ignore` comments in the file mark the Redis branches as unreachable — the dead path was excluded from coverage rather than wired in or deleted.

**Consequences**

| | |
|---|---|
| counters reset on **every restart and deploy** | an attacker waits for the next deploy — or triggers a crash — and the 5-attempt login lockout starts again |
| per replica | with N replicas the effective limit is N × the configured one |
| keyed by `req.ip` (`:344`, `:544`) | if `req.ip` is a proxy address rather than the client (A-16, unverified), **every user shares one bucket**: one attacker's five failures lock everyone out |

**Documentation impact:** ARCHITECTURE/06 ("Redis-backed endpoint limiters"), ENGINEERING/08 and several SECURITY documents describe Redis-backed limiting. Corrected alongside this card.

**Fix direction:** initialise the client at startup (or reuse the shared, now-working `redis.service` client), keep the memory fallback for outages only, and resolve A-16 before trusting any per-IP key.

**Verification (DoD)**
- [ ] a lockout survives a backend restart
- [ ] two replicas share one counter
- [ ] the `istanbul ignore` markers on the Redis path removed and the path covered

---

### A-31 — Nothing stops access and refresh tokens sharing a secret

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low–medium |
| **Evidence** | `utils/jwt.util.js:8–17` requires both secrets to exist but never compares them. `docs/BACKEND/11-CONFIGURATION.md` says "the config should reject that rather than trusting whoever wrote the `.env`" — it does not. `JWT_ALGORITHM` is also read from the environment (`:24`). |

**Why it matters:** with equal secrets, whether a refresh token is accepted as an access token depends only on claim checks in the verifier, not on cryptography.

**Fix direction:** refuse to start when the secrets are equal; pin the verification algorithm list in code rather than in the environment.

**Verification (DoD):** [ ] startup fails with equal secrets · [ ] a refresh token presented as a bearer token is rejected, with a test

---

### A-32 — The 100% coverage figure includes 58 exclusions

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low — a trust problem with the gate, not a runtime defect |
| **Evidence** | 58 `istanbul ignore` directives in `backend/src` (non-test), **31 with no reason**. Concentrated in `migration.service.js` (15) and `rateLimiter.redis.service.js` (12). Several mark code as "unreachable" — `transformTenants is never referenced`, `decryptPrivateKey is not exported`, `getRedis() is not exported and has no caller` — i.e. **dead code kept and hidden** rather than deleted, and in one case a whole feature (A-30). |

**Fix direction:** every directive carries a reason; dead code is deleted, not ignored; a reviewer treats a new `istanbul ignore` like a new `eslint-disable`.

**Verification (DoD):** [ ] zero unexplained directives · [ ] no directive on code described as unreachable

---

## Wave 1 — Correctness

### A-07 — `dynamicAccess` names that match no menu slug

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **unverified — possibly high** |
| **Evidence** | Resources passed to `dynamicAccess`: `"Management"` (×10), `"Maintenance"` (×7), `"Finance"` (×6), `"Vendors"` (×6), `"Billing"` (×3), `"AuditLogs"` (×1) — beside lowercase slugs `warehouse`, `calibration`, `certificate`. Menu slugs are lowercase (`maintenance`, `finance`, `vendors`, `billing`, `audit`, `management`). `scopeAllows` lower-cases both sides, so API keys match case-insensitively; **whether `checkMenuPermission` does the same for users has not been checked.** `AuditLogs` matches no slug in any case. |

**Definition of Done**
- [ ] **verify first**: as a `HEALTHCARE ADMIN` (not super-admin), call one route per mismatched name; record 200 or 403
- [ ] if any is denied: normalise every resource to its slug; add a test that every `dynamicAccess` name exists in `MENU_SLUGS`
- [ ] Phase 9 P9-19 types the argument as the slug union so this cannot recur

---

### A-09 — Undefined `req.body` under Express 5

| | |
|---|---|
| **Status** | partly DONE |
| **Evidence** | Fixed: `menuGroup.controller.js` (the production 500 on `/menu-groups/menu-groups/admin`). Remaining unguarded `req.body.x` reads on POST/PATCH handlers: `apiKey`, `attachment`, `calibrationScheduler`, `iot`, `kanban`, `ticket` controllers. |

**Definition of Done**
- [ ] a middleware defaults an absent body to `{}` for every route (BACKLOG M-10), or every read is guarded
- [ ] a bodyless POST to each listed route returns 400, not 500

---

### A-10 — Webhook delivery durability

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `webhook.service.js#deliverWithRetry` runs in-process with `setTimeout` backoff `min(2^n × 500 ms, 30 s)` for `WEBHOOK_MAX_ATTEMPTS` = 5 — four waits of 1, 2, 4, 8 s, **about 15 s end to end**. A restart loses every pending retry and leaves the row `pending` or `failed` forever. The signature is `HMAC-SHA256(secret, body)` with no timestamp. |
| **Spec refs** | `docs/WEBHOOK/04-WEBHOOK-RETRY.md` · `docs/WEBHOOK/03-WEBHOOK-SECURITY.md` |

**Definition of Done**
- [ ] delivery moves onto RabbitMQ with a dead-letter queue (the service's own comment names this as the deferred design)
- [ ] a retry schedule measured in hours, not seconds
- [ ] a signed timestamp header, and receivers told to reject stale ones
- [ ] a restart during delivery resumes it — tested

---

### A-11 — The webhook event catalogue is two events

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | The only `emitEvent` call site is `calibrationScheduler.service.js`: `device.calibration_due` and `device.overdue`. Plus the synthetic `webhook.test`. Certificates, work orders, stock transfers and CAPA emit nothing. |
| **Spec required** | **yes** — which events, with which payloads, before anyone subscribes |

**Definition of Done**
- [ ] catalogue agreed in `docs/WEBHOOK/01-EVENT-CATALOG.md`
- [ ] each event emitted **after** the transaction commits, never inside it — a webhook for a rolled-back change announces something that did not happen

---

### A-12 — `sessionSecurity.middleware.js`

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | Imported by nothing. Its raw SQL targets `"Sessions"` with camelCase columns (`"isRevoked"`, `"userId"`), while the table is `sessions` with snake_case attributes, and passes `$1` placeholders as `replacements` — each query would fail if the file were ever wired in. Its tests exist, so it is counted as covered. |

**Why:** a documented control — session fixation protection, concurrent-session limits, IP binding — that is not installed. Coverage of dead code is a green tick for an absent control.

**Definition of Done**
- [ ] decide: delete, or rewrite against the real `sessions` model and wire it in
- [ ] every document that claims these protections checked against the decision

---

### A-14 — Production logging

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `activityLog.middleware.js` adds the Console transport only outside production → `docker logs` has **0 lines** on the reference deployment. Per-request lines use `logger.http`, below the production level `info` → **0 `http` lines in 640 combined-log lines**. Exception and rejection transports have no `maxFiles`. |
| **Spec refs** | `docs/OBSERVABILITY/01-LOGGING.md` · `docs/DEVOPS/06-LOGGING.md` |

**Definition of Done**
- [ ] JSON logs to stdout in production (files optional)
- [ ] per-request completion logged at `info`, with request id, status and a **numeric** duration
- [ ] every file transport bounded

---

### A-15 — Health checks that check health

| | |
|---|---|
| **Status** | TODO |
| **Evidence** | `/health` and `/ready` call only `db.authenticate()`. With Redis down, rate limiting and brute-force lockout stop working while `/health` returns 200. |

**Definition of Done**
- [ ] `/ready` reports database, Redis and RabbitMQ separately; Redis down is **not ready**
- [ ] `/live` stays dependency-free

---

### A-16 — Is `req.ip` the client?

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **unverified** — compliance-relevant |
| **Evidence** | `app.set("trust proxy", 1)`. Browser API traffic passes Cloudflare → `cloudflared` → nginx → **Next.js** → backend: three hops behind the first. The morgan access log shows real client addresses via `cf-connecting-ip`; what `req.ip` resolves to — the value in `audit_logs`, `sessions` and **`e_signature_records.ipAddress`** (21 CFR Part 11 evidence) — has not been checked. |

**Definition of Done**
- [ ] **verify**: sign in through the public domain and compare the stored session and audit IP with the client's real address
- [ ] if wrong: derive the client IP from a trusted header set explicitly by the edge, configured per deployment, and never from a header a client can send directly to nginx on `:19080`

### A-25 — Stripe invoices that were paid after a failure stay "Open"

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — billing records wrong, money correct |
| **Evidence** | `stripeWebhook.service.js#upsertInvoice` uses `Invoice.findOrCreate({ where: { stripeInvoiceId } })` with the status in `defaults` — it **never updates** an existing row. Stripe's usual retry path is `invoice.payment_failed` (row created as `Open`) then `invoice.paid` (row found, not changed). The subscription moves to `Active`; the invoice stays `Open` with `amountPaid: 0`. |
| **Spec refs** | `docs/API/11-BILLING-FINANCE-API.md` · `docs/DATABASE/11-BILLING-TABLES.md` |

**Definition of Done**
- [ ] a real upsert that updates status and amounts on an existing invoice
- [ ] a monotonic rule: `Paid` is never downgraded by a late `payment_failed` — Stripe does not guarantee event order
- [ ] tests for failed-then-paid, paid-then-late-failed, and a duplicated `invoice.paid`

### A-26 — Nothing deduplicates at-least-once delivery

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | Documentation across ARCHITECTURE, DEVOPS and SECURITY described Redis-held "worker idempotency claims". None exists: the only `SET NX` is the registration lock. `emailQueue.service.js` re-sends a redelivered message; webhook retries have no receiver-side idempotency key. |

**Definition of Done**
- [ ] each consumer claims a message id with `SET NX` before acting and releases the claim on failure
- [ ] outbound webhooks carry a stable `X-Webhook-Delivery` id receivers are told to deduplicate on (the header exists; the guidance does not)
- [ ] a test delivers the same message twice and asserts one effect

---

## Wave 2 — Hygiene and Gaps

### A-18 — Dead code and unused dependencies

| | |
|---|---|
| **Status** | TODO |
| **Evidence** | `response.util#paginated` (no callers; reads `res.query`); `aedes`, `aedes-server-factory` (referenced by no code); `build:bun` script; `backend/.eslintrc.js` (ignored by ESLint 9); `package.json` `name: "express-boilerplate"`; `ai.service#chunkText` documents "overlapping chunks" and implements none. |

**Definition of Done**
- [ ] each removed or corrected; the full suite still at 100%

### A-19 — No automatic gate of any kind

| | |
|---|---|
| **Status** | TODO |
| **Evidence** | No CI, no hook tooling, no secret scanner. Documents claimed a `pre-push` hook, a secret scanner and an IDOR enforcement script; none exist. |

**Definition of Done**
- [ ] gitleaks (or equivalent) configured and run in a committed hook and in CI (P7-01)
- [ ] the hook installed by `npm install`, not by instructions

### A-20 — The browser suite is missing

**Evidence:** `docs/TESTING/06-BROWSER-TESTING.md` describes `automate/` with 71 Playwright tests; the directory is untracked and absent (BACKLOG U-07).
**Definition of Done:** restore it to the repository, or withdraw the claim everywhere it appears.

### A-21 — Commit a lockfile

**Evidence:** `.gitignore` excludes `pnpm-lock.yaml`, `package-lock.json` and `bun.lock` (BACKLOG W-11). Every build resolves dependencies fresh.
**Definition of Done:** one package manager chosen; its lockfile committed; images install with the frozen-lockfile flag.

### A-22 — React Compiler error in `GlobalSearch.tsx`

**Evidence:** `react-hooks/set-state-in-effect` at line 101 — synchronous `setState` inside an effect. Pre-existing since the first commit.
**Definition of Done:** fixed by restructuring the component, not by disabling the rule (`CLAUDE.md`).

### A-23 — Search efficiency

**Evidence:** `search.service.js` runs one query per requested type, sequentially, and logs a warning on every call where the FTS column is missing (always, in the unit-test database).
**Definition of Done:** the three queries run concurrently or as one `UNION ALL`; the fallback warning logged once per process.

---

## Already Done in This Audit

| Id | What | Where |
|---|---|---|
| A-08 | metered billing zero usage — `$1` placeholders passed as `replacements` | commit `9745f01`, ADR-039 |
| A-24 | `redis.service` guarded every helper on `client.connected`, a property ioredis does not have — registration answered 429 to everyone, passkeys 503, the OIDC provider could not complete an authorisation; the test mock fabricated `connected`, so the suite was green | this commit |
| A-09 (part) | `/menu-groups/menu-groups/admin` 500 | commit `f3d323e` |
| — | avatar and tenant-logo broken images; email templates carrying another company's branding and a broken Outlook CTA | commits `78028b0`, `582e24b`, `6621722` |
| — | `npm test` could not run under a hoisted workspace install | commit `78028b0` |
| — | MySQL support removed — it never worked | ADR-039 |

---

### A-33 — SCIM PATCH ignores `path`: standard IdP patches silently do nothing

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — a shipped integration that no standards-compliant IdP can drive |
| **Verified** | from code, 2026-09-23, while fixing A-27 |

**Root cause:** `scim.service.js#patchUser` handles an operation by iterating
`Object.entries(op.value)` — it reads `op.path` only in the `remove` branch, and there it treats
it as an **array of keys**. RFC 7644 § 3.5.2 defines `path` as a **string** attribute path, and
the normal form of a patch is `{ "op": "replace", "path": "active", "value": false }`.

Given that operation, the code evaluates `Object.entries(op.value || {})` where `op.value` is the
scalar `false` — `Object.entries(false)` is `[]`, so the loop body never runs. The operation is
silently dropped and the endpoint returns **200 with the user unchanged**.

Only the non-standard shape `{ "op": "replace", "value": { "active": false } }` works.

**Impact:** Okta, Entra ID and OneLogin all send path-based operations for the common cases
(deactivate a user, change a group membership). Against this endpoint they get 200 and nothing
happens — deprovisioning appears to succeed while the account stays active. That is the worst
failure mode available: a silent no-op on the operation that removes access.

**Also missing:** no SCIM mutation writes an audit row, so there is no record of what the IdP
changed (carried over from A-27).

**Fix direction:** parse `path` per RFC 7644 (at minimum the simple `attr` and `attr.sub` forms)
and route it through the same assignment code — including `assertAssignableRole` — as the value
form; reject an operation whose `path` is present but unparseable with 400 rather than ignoring
it; write an audit row per mutation, attributed to the API key.

**Verification (DoD)**
- [ ] `{ "op": "replace", "path": "active", "value": false }` deactivates the user
- [ ] `{ "op": "replace", "path": "roleId", "value": "<superadmin id>" }` returns 403, not 200
- [ ] an unparseable `path` returns 400 and changes nothing
- [ ] an audit row exists for every accepted SCIM mutation
