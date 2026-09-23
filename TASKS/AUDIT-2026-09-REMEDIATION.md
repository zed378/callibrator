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
| A-04 | `/search` returns records the caller's role cannot list | medium | 0 | **DONE** 2026-09-23 |
| A-05 | Socket.IO: `origin: "*"`, token in the query string, no status or suspension check | medium | 0 | **DONE** 2026-09-23 |
| A-06 | public `/health` discloses Node version, pid and memory | low | 0 | **DONE** 2026-09-23 |
| A-07 | `dynamicAccess` resource names that match no menu slug | **unverified — possibly high** | 1 | TODO |
| A-08 | metered billing read every tenant's usage as **zero** | high | — | **DONE** 2026-09-21 |
| A-09 | Express 5 undefined `req.body` → 500 — and `validate(schema)` let an absent body straight through | medium | 1 | **DONE** 2026-09-23 |
| A-10 | webhook delivery: retries lost on restart, ~15 s window, no replay protection | medium | 1 | TODO |
| A-11 | only two domain events are ever emitted to webhooks | medium | 1 | TODO |
| A-12 | `sessionSecurity.middleware.js` is dead and its SQL is broken | medium | 1 | **DONE** 2026-09-23 |
| A-13 | raw internal error messages reach clients in production | medium | 0 | TODO |
| A-14 | production logging: no stdout, per-request lines dropped, unbounded files | medium | 1 | TODO |
| A-15 | `/health` checks only the database | medium | 1 | **DONE** 2026-09-23 |
| A-16 | whether `req.ip` is the client through a three-proxy chain | **unverified** | 1 | TODO |
| A-17 | MQTT: public port with nothing behind it; the MQTT path authenticates nobody | low | 0 | **DONE** 2026-09-23 |
| A-18 | dead code and unused dependencies | low | 2 | TODO |
| A-19 | no secret scanner, no hook, no gate of any kind | medium | 2 | TODO |
| A-20 | the `automate/` Playwright suite is not in the repository | medium | 2 | TODO |
| A-21 | no lockfile is committed | medium | 2 | TODO |
| A-22 | one React Compiler lint error in `GlobalSearch.tsx` | low | 2 | TODO |
| A-23 | search runs one query per type, sequentially, and logs a warning per call | low | 2 | TODO |
| A-24 | every `redis.service` helper was a no-op: **registration, passkeys and the OIDC provider broken** | **high** | — | **DONE** 2026-09-21 |
| A-25 | Stripe `upsertInvoice` never updates: an invoice that failed and was later paid stays **Open** | medium | 1 | **DONE** 2026-09-23 |
| A-26 | no consumer deduplicates: a redelivered email is sent twice (documented "idempotency claims" do not exist) | medium | 1 | **DONE** 2026-09-23 |
| A-27 | **any account could mint a `*` API key and have SCIM make it SUPERADMIN** | **critical** | 0 | **DONE** 2026-09-23 |
| A-28 | evidence and controlled documents mutable by any role (attachments, signing keys, SOP, risks) | **high** | 0 | **DONE** 2026-09-23 |
| A-29 | IoT ingest cannot be provisioned; its token would leak in list responses | medium | 1 | TODO |
| A-30 | the rate limiter never uses Redis — lockouts reset on every deploy | **high** | 0 | **DONE** 2026-09-23 |
| A-31 | nothing stops JWT access and refresh secrets being equal | low | 1 | **DONE** 2026-09-23 |
| A-32 | the 100% coverage figure includes 58 `istanbul ignore` exclusions | low | 2 | TODO |
| A-33 | SCIM PATCH ignores `path`: a standards-compliant deprovision returns 200 and does nothing | medium | 1 | **DONE** 2026-09-23 |
| A-34 | **the backend lint gate has never run** — a version mismatch crashed ESLint; behind it, 1,319 errors | medium | 0 | partly DONE 2026-09-23 |
| A-35 | **every per-user permission override silently did nothing** — including a `none` revocation | **high** | 0 | **DONE** 2026-09-23 |
| A-36 | RabbitMQ connections are never reused and never closed: `connection.isOpen` does not exist in amqplib | **high** | 0 | **DONE** 2026-09-23 |
| A-37 | **SCIM user creation is a cross-tenant existence oracle** — global unique email, tenant-scoped duplicate check | **high** | 0 | TODO |
| A-38 | SCIM Groups are global roles: every tenant's groups are listed, and a delete removes one for everyone | medium | 1 | TODO |
| A-39 | a SCIM-provisioned group grants nothing, silently — `roleLevel` defaults to 1 and it gets no menu permissions | medium | 1 | TODO |
| A-40 | storage: the driver cache is per process, and a null-checksum migration reports `migrated` unverified | low | 2 | TODO |
| A-41 | **audit rows are written after the response, outside the transaction** — the rule `CLAUDE.md` calls non-negotiable | **high** | 0 | TODO |
| A-42 | a failed audit write is reported to `console.error` only — and production writes no stdout anywhere | **high** | 0 | TODO |
| A-43 | `auditAction` logs full request and response bodies, unredacted — dead code, and a loaded gun | medium | 1 | TODO |
| A-44 | the access log was never pruned: `history` is a filename, not a retention period | medium | 0 | **DONE** 2026-09-23 |
| A-45 | a soft-deleted IoT device still ingested; one bad MQTT message shut the server down | **high** | 0 | **DONE** 2026-09-23 |
| A-46 | IoT anomaly detection is structurally dead — `readingTolerance` cannot be set | medium | 1 | TODO |
| A-47 | **no electronic signature could ever verify** — `Date.now()` was inside the hashed payload, and the key pairs signed nothing | **critical — compliance** | 0 | **DONE** 2026-09-23 (ADR-040) |
| A-48 | **revocation does not revoke**: nothing in the request path reads `sessions`, and production issues 24-hour access tokens | **high** | 0 | TODO |
| A-49 | SCIM leftovers: a case-sensitive `displayName` oracle, unvalidated patch values, and an e2e spec that cannot pass | medium | 1 | TODO |
| A-50 | webhook deliveries followed redirects, so a 302 walked past the SSRF check | **high** | 0 | **DONE** 2026-09-23 |
| A-51 | webhook routes have **no validator at all**: the signing secret is caller-supplied, unvalidated, plaintext, and unrotatable | **high** | 0 | TODO |
| A-52 | the socket token's `purpose: "socket"` claim is read nowhere — it is an ordinary access token | medium | 1 | TODO |
| A-53 | a reconnected socket never re-joins its board rooms: live updates stop, silently | medium | 1 | TODO |
| A-54 | no Socket.IO adapter — a second replica splits the fan-out | medium | 2 | TODO |
| A-55 | `createTwoTenants()` does not exist. `CLAUDE.md` and eight documents cite it as the fixture that makes the 404 test one line | medium | 0 | **corrected** 2026-09-23 |
| A-56 | search swallows every query error into an empty list | low | 1 | TODO |
| A-57 | the **public** verification endpoint returns the PDF path of a `draft` certificate | **high** | 0 | TODO |
| A-58 | five workflow routes gate on `"workflow"`; the slug is `"workflows"` — they deny everyone but SUPERADMIN | **high** | 0 | TODO |

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
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | `search.route.js`: `router.get("/", auth, searchController.search)`. `search.service.js` returns devices, stock and certificates for the tenant with no permission filter. |
| **Spec refs** | `docs/SEARCH/01-GLOBAL-SEARCH.md` |

**Why:** a role with no `warehouse` or `certificate` read permission can list stock and certificates through search. Tenant isolation holds (the raw SQL carries `tenant_id` explicitly); authorisation inside the tenant does not.

**Definition of Done**
- [ ] each result type is included only if the caller holds `read` on its menu slug (`equipment`, `warehouse`, `certificate`)
- [ ] API keys limited to their scopes the same way
- [ ] tests per role

---

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| the route is gated: `dynamicAccess(SEARCH_MENUS, "read")` over `["calibration", "warehouse", "certificate"]` — OR-logic, so a caller with read on any searchable menu gets in and one with none gets 403 | `routes/api/search.route.js` |
| each type is filtered by **running the same gate its own list route runs**, rather than a second copy of the permission rules; a denied type is dropped from the result, not turned into a 403 for the whole search | `controllers/search.controller.js` |
| each type config carries the menu slug its list route gates on, so search can never surface a row that resource's own endpoint would refuse | `services/search.service.js` |

Also closed a footgun in the same file: `types: []` used to mean **every type**. With a permission-filtered list now passed in, an empty allow-list would have handed a principal permitted nothing the entire tenant. An explicit list is honoured as given; only an absent list means "all".

**Verification** — `npx jest src/tests/services/search src/tests/controllers/search src/tests/routes/search` → 5 suites, 39 tests. The new suite `controllers/search.permissions.a04.test.js` runs the REAL controller, service, `dynamicAccess` and `scopeAllows`, mocking only `db.query` and the permission stores, and asserts which tables were queried: "gives a warehouse-only role stock rows and no devices or certificates", "honours a per-user 'none' override that revokes a menu the role grants", "a `warehouse:read` key sees stock only".

**Behaviour change to know about:** a principal with none of the three menus (a plain `USER`) now gets **403** where it used to get a list. `GlobalSearch.tsx` will render that as an error rather than "no results"; the frontend was not changed.

**Residual:** not verified live. The claim that `equipment:read` inherits to `calibration` and `certificate` is read from `seedMenuGroups.util.js`, not confirmed against `menu_groups` in psql.

---

### A-05 — Socket.IO hardening

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | `src/config/socket.js`: `cors: { origin: "*" }` with the comment "Adjust for production"; token read from `handshake.auth.token` **or** `handshake.query.token`; the middleware checks only that the user exists — not account status, tenant suspension, or session revocation. |
| **Spec refs** | `docs/ARCHITECTURE/10-REALTIME-ARCHITECTURE.md` · `docs/MULTI-TENANCY/06-REALTIME-ISOLATION.md` |

**Definition of Done**
- [ ] CORS origin from `CORS_ORIGIN`, as on the HTTP layer
- [ ] query-string tokens rejected — they land in proxy access logs
- [ ] handshake rejects inactive users, suspended tenants and revoked sessions, matching `auth.middleware.js`
- [ ] tests for each rejection

---

**What was changed (2026-09-23)** — `config/socket.js`

| Before | After |
|---|---|
| `origin: "*"` | the same `CORS_ORIGIN` allow-list the HTTP layer uses (`index.js`), plus `credentials: true` — which is precisely why the wildcard could not stay |
| token from `handshake.query.token` | `handshake.auth.token` only. A query-string token is now an explicit rejection with its own server-side log line, so the failure is diagnosable without the token ever being parsed |
| `User.findByPk` with an ad-hoc include | `authService.getAuthUserWithTenant`, the loader the HTTP `auth` middleware uses — MFA-pending tokens, inactive or deleted users and suspended or deleted tenants are all refused, as they are over HTTP |
| rejection said "User not found" / "Token missing" | one constant `Authentication error`; the reason goes to the server log |

It also closed a real isolation gap the card did not name: `kanban:join` → `kanban.assertAccess` ran with **no AsyncLocalStorage context**, which `tenantScope.util.js` resolves to `mode: "skip"` — no tenant predicate at all. Socket handlers now run inside `tenantStorage.run(...)` with the same context shape `tenantContext.middleware` builds.

**Verification** — `npx jest src/tests/config/socket.test.js` → 39 tests, including "rejects a valid token whose tenant is suspended" (×4 spellings, asserting `socket.user` is never set), "rejects a token supplied in the query string" (asserting `verifyAccessToken` is never called), "rejects an origin outside the allow-list in production", and "joins a kanban board room inside the tenant context after an access check" (asserting the CLS store seen *inside* `assertAccess`). Regression: 7 suites, 315 tests.

**No frontend change was needed** — `frontend/src/lib/socket.ts` already connects with `auth: { token }`.

**Residual risk**
- `src/config/` is in `coveragePathIgnorePatterns`, so `socket.js` does **not** count toward the 100 % gate. Its 100 % figure comes from an explicit override run (see A-32).
- The checks are **connect-time only**. A tenant suspended after the handshake keeps its live socket until it disconnects.
- Session revocation is still not checked — over HTTP either (`auth.middleware.js` says so explicitly). Making sockets stricter than HTTP is a decision the owner has not made: Open Question, not a judgement call.
- Outside production any origin is still allowed, deliberately mirroring the HTTP layer.

---

### A-06 — `/health` information disclosure

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low |
| **Evidence** | `backend/index.js` `GET /health` returns `node: process.version`, `pid`, `memory`, `uptime` — routed publicly by nginx. |

**Definition of Done**
- [ ] public `/health` returns status and dependency state only; runtime detail moves behind authentication or off the public route

---

**What was changed (2026-09-23)** — fixed together with A-15; see that card for the full shape.

`/health` now answers `{"status":"ok"}` — one key. No Node version, pid, memory, uptime, hostname or dependency detail. The status-code contract (200 / 503) is unchanged, because nginx and the compose and Helm probes point at this path.

**Verification** — `controllers/health.controller.test.js` "publishes no runtime or dependency detail — A-06" asserts `Object.keys(body)` is exactly `["status"]`, that 11 named keys are absent, and that the literal `process.version` and `process.pid` values do not appear anywhere in the body.

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
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low |
| **Evidence** | `docker-compose.vm.yml` publishes `0.0.0.0:19883:1883` on the backend; nothing listens there (the backend is an MQTT **client**, and MQTT is off on this deployment). `iot.service.js` takes device and tenant ids from the topic; there is no publisher authentication beyond the external broker's ACLs. `ingestReading` does require the pair to match an IoT-enabled device. |

**Definition of Done**
- [ ] the port mapping removed from the vm and dev overlays unless a broker sidecar is added
- [ ] `docs/DEVELOPER/07-IOT-INGEST.md` states the broker ACL requirement plainly: a publisher allowed on `device/#` can post readings for any device whose id and tenant id it knows

---

**What was changed (2026-09-23):** the `1883` port mapping is removed from
`docker-compose.vm.yml` (where it was published on `0.0.0.0` as `19883`) and from
`docker-compose.dev.yml`. Nothing listened on it — the backend is an MQTT *client* — so it
published a public port with nothing behind it. If a sidecar broker is ever added, its own port is
published, bound to `127.0.0.1` unless devices really must reach it from outside.

The broker-ACL point is documented in `docs/DEVELOPER/07-IOT-INGEST.md`: a publisher allowed on
`device/#` can post readings for any device whose id and tenant id it knows, because the topic is
the only thing identifying them. The ingest path itself was hardened separately — see A-45.

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
| **Status** | **DONE** 2026-09-23 |
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

**What was changed (2026-09-23)**

| Route | Gate now |
|---|---|
| `DELETE /attachments/:id` | `dynamicAccess(EQUIPMENT, "write")` — and the delete is now a **soft delete** (`isDeleted`) with an audit row, in one transaction |
| attachment reads and upload | `dynamicAccess(EQUIPMENT, "read")` — every seeded role holds it, so a technician can still attach and read its own calibration evidence |
| e-signature key pairs and workflows: writes | `denyApiKey` + `dynamicAccess(QMS, "write")`; reads `QMS:read` |
| `POST /sop`, `GET /sop` | `dynamicAccess(SOP, "write" / "read")` |
| `PATCH /sop/:id/publish` | `denyApiKey` + `SOP:write` **plus separation of duties in the service**: publishing your own SOP is a **409 with a state explanation**, and the status change, training fan-out and audit row are in one transaction |
| risk register | `dynamicAccess(RISK, "write" / "read")` |

**Deliberately left on `auth`, with the reason in the code:** `POST /esignature/sign`, `/verify`,
`/history` — a signer is whoever the workflow names, commonly a technician with no `qms` menu, so
gating `/sign` on `qms:write` would make workflows unsignable — and `POST /sop/:id/acknowledge`,
which is self-service on the caller's own row.

**Deleting a key pair does NOT break verification of existing signatures.** `verifySignature`
reads no key at all: it recomputes a hash. That is not reassurance, it is A-47 — see that card.
`TenantKey` is also `paranoid`, so the row and its public key survive the delete.

**`attachments` is NOT a menu slug.** This card claimed it was; it is not in `MENU_SLUGS`.
`equipment` is used as a stand-in, which means evidence retention cannot be granted independently
of equipment editing. That is an Open Question for `TASKS/BACKLOG.md`, not a decision to make in a
bug fix — and inventing a slug would have created another A-07 instance.

**Verification** — `npx jest src/tests/routes/routeGuards.a28.test.js` → 22 tests, running the
**real** `dynamicAccess` against the **real** role matrix, with only `auth` stubbed; every refusal
asserts the service was never called. Named: "refuses an API key — creating a key pair was
denyApiKey, deleting one was not", "refuses publication by the SOP's own author with a 409 that
explains the state", "lets a second authorised user publish it, and writes the audit row",
"refuses an ENGINEERING MANAGER rescoring a risk — it holds read, not write". Adjacent suites:
18 suites, 293 tests. 100 % on the eight changed files.

**Residual:** risk-register mutations and key-pair/workflow deletion still write no audit row. The
certificate parent-state check covers `resourceType === "certificate"` only. `/verify` returns
`biometricData` and `polygon` to any authenticated caller who knows a signature id — its own card.
Existing API-key integrations on attachment, e-signature and risk reads now authorize by scope
rather than passing on `auth` alone: intended under A-03, but a behaviour change in the field.

---

### A-29 — IoT ingest cannot be provisioned, and its credential would leak if it could

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — a shipped feature that cannot receive data; a latent credential leak |
| **Verified** | from code and the reference database (`0` devices with `iot_enabled`, `0` with a token) |

**Root cause**
- Nothing sets `iotDeviceToken`, and nothing but the demo seeder sets `iotEnabled`
  (`migration.service.js` sets `iotEnabled` on one demo device; corrected 2026-09-23 — the
  original wording said nothing sets either): no service assigns them, no validator accepts them (`calibrationDevices.validator.js` has no IoT field), no frontend surface shows them. The only reference is the lookup in `iot.controller.js:21`.
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
| **Status** | **DONE** 2026-09-23 |
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

**What was changed (2026-09-23)**

The service no longer constructs a client. `readyRedis()` takes the **shared** client from
`redis.service.getRedisConnection()` and uses it only when `client.status === "ready"` — the
property ioredis actually has (A-24). `index.js` already calls `initRedis()` at startup.

The increment is a single Lua `EVAL` that reads, increments, preserves `firstAttempt` and sets the
TTL in **one** operation. The old code did `INCR` and `PEXPIRE` separately: a process dying between
them left a counter with no TTL — a lockout that never lifts.

**A parity bug had to be fixed on the way in**, and it is the interesting part: `isTokenBlocked`,
`isUserLockedOut` and `getRateLimitStatus` all compare `now < entry.expiresAt`, while the old Redis
writes stored no `expiresAt` and the old `INCR` stored a bare integer with no `.count`. Wiring
Redis in unchanged would have made **every blocked token read as not blocked**. The dead path was
not merely unused; it was wrong, and it had been excluded from coverage rather than run.

**Outage behaviour — decided and written into the file:** fail over to the in-process Map, never
fail open. A request is still counted, just no longer counted globally (N replicas ⇒ N × the limit
during the outage). Failing *closed* on a read would turn a Redis hiccup into a total
authentication outage; failing *open* hands an attacker the control itself.

**Verification**
- `src/tests/services/rateLimiter.redis.path.test.js` — 22 tests with a mocked client, including
  "never reads a `connected` property — ioredis has none", "locks the account out on the fifth
  failure even when the first four were another replica's", and "writes an absolute expiresAt to
  Redis so a blocked token reads as blocked on either backend".
- `src/tests/services/rateLimiter.redis.live.test.js` — 6 tests against a **real Redis**
  (7.4.11), opt-in behind `REDIS_LIVE_TEST=1`: a lockout survives the process that recorded it,
  two simulated replicas lock out on the fifth failure rather than the tenth, and 40 concurrent
  requests across two replicas store exactly 40.
- **Falsifiability check**, which is why the live suite is worth anything: pointed at a dead port,
  all six fail, and they fail exactly as the finding describes.
- **12 `istanbul ignore` directives removed, none left in the file**; 100 % with no exclusions.

**Residual, stated plainly:** the live suite runs two module graphs in one Node process against a
local Redis. That proves the key design, the script and the shared counter. It does **not** prove
a deployed container restart or two pods on the VM — those DoD boxes stay open. Per-IP keys remain
only as trustworthy as `req.ip` (A-16, untouched).

---

### A-31 — Nothing stops access and refresh tokens sharing a secret

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | low–medium |
| **Evidence** | `utils/jwt.util.js:8–17` requires both secrets to exist but never compares them. `docs/BACKEND/11-CONFIGURATION.md` says "the config should reject that rather than trusting whoever wrote the `.env`" — it does not. `JWT_ALGORITHM` is also read from the environment (`:24`). |

**Why it matters:** with equal secrets, whether a refresh token is accepted as an access token depends only on claim checks in the verifier, not on cryptography.

**Fix direction:** refuse to start when the secrets are equal; pin the verification algorithm list in code rather than in the environment.

**Verification (DoD):** [ ] startup fails with equal secrets · [ ] a refresh token presented as a bearer token is rejected, with a test

---

**What was changed (2026-09-23)** — and the card understated the defect.

`JWT_REFRESH_SECRET` signed **nothing**. The key registry holds `ACCESS_SECRET` alone, and
`generateRefreshToken` signed from that registry, so the legacy JWT refresh token was signed with
the **access** secret and `verifyAccessToken` — which walks the same registry — would have accepted
it. The two secrets were not "allowed to be equal"; for that code path they already were.

What saves the deployment is that nothing issues one: every refresh token this application hands
out is opaque (`generateOpaqueRefreshToken`, 32 random bytes, stored). The JWT flavour is legacy
and unused.

| Change | File |
|---|---|
| startup refuses when `JWT_ACCESS_SECRET === JWT_REFRESH_SECRET` | `utils/jwt.util.js` |
| `JWT_ALGORITHM` is validated against a list pinned in code; an unsupported value refuses to start | `utils/jwt.util.js` |
| tokens carry `typ: "access"` / `typ: "refresh"`, and each verifier refuses a token whose claim names the other type | `utils/jwt.util.js` |
| refresh tokens are signed and verified with `REFRESH_SECRET` and HS256 alone — out of the access-key rotation registry entirely | `utils/jwt.util.js` |

A token with **no** `typ` is still accepted on the access path, deliberately: nothing issues a
typ-less refresh JWT any more, and refusing them would have invalidated every access token in
flight at deploy time.

**Verification** — `npx jest src/tests/utils/jwt` → 71 tests. The new `utils/jwt.a31.test.js` has
"refuses to start when the access and refresh secrets are equal", "refuses an algorithm that is not
on the pinned list", "refuses a refresh token presented as a bearer token", "refuses an access
token presented to the refresh path", and "still accepts a legacy access token that carries no type
claim". `services/auth`, `controllers/auth`, `controllers/sso` and `middlewares/auth` — 195 tests —
still pass.

**Before deploying:** the running `.env` must not have the two secrets equal, or the backend will
refuse to start. `deploy/compose/.env.example` already says they must differ; the VM's own file
has not been checked.

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

**Addendum (2026-09-23):** `coveragePathIgnorePatterns` also excludes **`src/config/`** entirely.
That is how `config/socket.js` — which holds the Socket.IO authentication gate — sits outside the
100 % gate. Its coverage after the A-05 fix is 100 %, but only under an explicit override run, not
under `make verify`. A directory-level exclusion hides more than an `istanbul ignore` does, and
this one hides an authentication boundary.

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

**Addendum (2026-09-23, from the A-04 work):** `calibration` and `certificate` are real menu
groups in the database seed (`seedMenuGroups.util.js`) but are **not** in `MENU_SLUGS`
(`constants/roleConstants.js`). Since `apiKey.service.js#assertScopes` validates issued scopes
against `MENU_SLUGS` (A-27), a newly issued API key **cannot** be scoped to `calibration:read` or
`certificate:read` at all — so of the three searchable types a key can only ever reach stock. The
same mismatch is what this card is about; adding the two slugs widens API-key issuance and belongs
here, with a deliberate decision, not in a search fix.

### A-09 — Undefined `req.body` under Express 5

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Evidence** | Fixed: `menuGroup.controller.js` (the production 500 on `/menu-groups/menu-groups/admin`). Remaining unguarded `req.body.x` reads on POST/PATCH handlers: `apiKey`, `attachment`, `calibrationScheduler`, `iot`, `kanban`, `ticket` controllers. |

**Definition of Done**
- [ ] a middleware defaults an absent body to `{}` for every route (BACKLOG M-10), or every read is guarded
- [ ] a bodyless POST to each listed route returns 400, not 500

---

**What was changed (2026-09-23) — and the finding was bigger than this card said.**

The card assumed a route behind `validate(schema)` was safe. **It was not.**
`validation.middleware.js` called `schema.validate(req.body, …)`, and Joi treats `undefined` as
**valid** against a non-required object schema — measured, not assumed:

```
Joi.object({ a: Joi.string().required() }).validate(undefined) -> no error, value undefined
Joi.object({ a: Joi.string().required() }).validate({})        -> "a" is required
```

So the gate opened, the middleware then assigned `req.body = undefined`, and the controller's first
read threw. `validate(schema)` was not a safe harbour — it was a **second instance of the same
bug**, and so were the 30 in-controller `validate(body, schema)` helpers in `src/validators/`.

| Layer | Change |
|---|---|
| request | `middlewares/bodyDefault.middleware.js` (new), mounted in `index.js` immediately after the body parsers and before the sanitizer, swagger and every router: fills `req.body` **only** when it is `undefined`; an object, array, string or Buffer is untouched |
| the Joi gates | `validation.middleware.js` coerces `req.body ?? {}`, so required-field rules fire and a bodyless request gets **400 with the field list**. All **31** `validate` helpers in `src/validators/` do the same — including `scim.validator.js`, the last one, whose routes mount no body validator at all |
| at the read | 69 sites across 23 controllers on routes with no body validator: `req.body || {}`, so each handler reaches its own 400 (or its service) instead of throwing |

**Triage:** 193 `req.body` sites outside tests; ~118 safe once the two shared helpers were fixed; 6
already guarded by the earlier partial fix; 69 fixed here.

**Verification** — 103 new tests in 4 suites, and **they were proved to fail without the fix**:
reverting four guards turned exactly the five corresponding cases red. Named:
"replaces an absent body with {} — the Express 5 regression itself", "leaves a Buffer body
untouched (raw-body / webhook routes)", "validates `undefined` against a required-field object
schema WITHOUT an error" (which pins the Joi behaviour so a future upgrade reports it rather than
hiding it), "`<file>.validator.js`: validate(undefined, <required schema>) is refused, not passed
through" — data-driven over the whole directory, so a **new** validator written the old way fails
this suite — and "the public IoT ingest endpoint answers 401 … not 500".

**Residual:** `bodyDefault` is mounted in `index.js`, which is excluded from coverage collection,
so its behaviour is tested but **nothing proves it is still mounted**. `supertest` is not
installed, so none of this is proved over real HTTP.


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

**Correction (2026-09-23), from documenting the module:** this card says there is no replay
protection *and* implies there is no delivery id. There **is** one — `X-Webhook-Delivery` carries
`webhook_deliveries.id`, and the same id is inside the signed body, byte-identical across every
retry, so a receiver can deduplicate today. What is genuinely missing is a **timestamp**: none in
the headers, none in the body, none signed, so a captured delivery can be replayed forever.

The retry arithmetic also needed a correction. 1-2-4-8 s is the **backoff** total (~15 s); each
attempt additionally carries `WEBHOOK_TIMEOUT_MS` (default 8 s), so the wall clock to `exhausted`
is up to **~55 s**. And the 30 s backoff cap is dead code at the default `MAX_ATTEMPTS = 5` —
`2**attempt * 500` first exceeds 30,000 at attempt 6.


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
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | Imported by nothing. Its raw SQL targets `"Sessions"` with camelCase columns (`"isRevoked"`, `"userId"`), while the table is `sessions` with snake_case attributes, and passes `$1` placeholders as `replacements` — each query would fail if the file were ever wired in. Its tests exist, so it is counted as covered. |

**Why:** a documented control — session fixation protection, concurrent-session limits, IP binding — that is not installed. Coverage of dead code is a green tick for an absent control.

**Definition of Done**
- [ ] decide: delete, or rewrite against the real `sessions` model and wire it in
- [ ] every document that claims these protections checked against the decision

---

**Decision and what was done (2026-09-23): deleted, not wired in.** Wiring it in would have changed
authentication behaviour on a judgement nobody made — IP binding logs people out when a mobile
network or hospital wifi rotates an address, and a concurrent-session cap means one login silently
kills another. That is **Q-08** in `TASKS/BACKLOG.md` (superseding Q-04, which asked *how strict*
the binding should be — a question resting on a premise that was never true).

**The breakage was worse than the card said.** Besides `"Sessions"` versus `sessions`, the
camelCase columns and `$1` passed as `replacements`, two columns it reads — `expiresAt` and
`lastActivity` — have **no counterpart under any casing** (the model has `expired_at` and
`last_activity_at`). Even a correct snake_case rewrite would have had to rename them.

**Eleven documents said these controls existed.** They were corrected, and the origin is worth
naming: **ADR-017 "User Sessions Bound to IP and User Agent", status Accepted** — a decision
recorded, propagated into six `docs/` files as fact, and never implemented. That is the PR-4 shape
exactly. ADR-017, ADR-005, ADR-034 and ADR-039 now carry the correction; so do
`ARCHITECTURE/03`, `BACKEND/04`, `BACKEND/10`, `DATABASE/03`, `SECURITY/00`, `SECURITY/01` (T2
listed IP/UA binding as a *control*), `SECURITY/03`, `PLAN/01`, `PLAN/18` (PR-3 listed it under
*mitigation in place*), `DEVOPS/03`, `DEVOPS/09` and `deploy/README.md`.

**Verification** — `npx jest src/tests/middlewares` → 23 suites, 375 tests; nothing referenced the
deleted files. The two test files went with the middleware: a passing test over an uninstalled
control is a green tick for nothing.

**It opened a bigger one:** with binding, fixation protection and the session cap all confirmed
absent, the `sessions` table is read by **nothing** in the request path. See A-48.


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
| **Status** | **DONE** 2026-09-23 |
| **Evidence** | `/health` and `/ready` call only `db.authenticate()`. With Redis down, rate limiting and brute-force lockout stop working while `/health` returns 200. |

**Definition of Done**
- [ ] `/ready` reports database, Redis and RabbitMQ separately; Redis down is **not ready**
- [ ] `/live` stays dependency-free

---

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| dependency probes with a deadline (`HEALTH_PROBE_TIMEOUT_MS`, 2 s) and a cached aggregate (`HEALTH_CACHE_TTL_MS`, 5 s) so a load-balancer poll does not re-probe three services per hit | `services/health.service.js` (new) |
| `liveness` (touches nothing), `health` (verdict only), `readiness`, `readinessDetail` (per-dependency breakdown, kept even on a 503) | `controllers/health.controller.js` (new) |
| `/health`, `/live`, `/ready` public; `GET /api/v1/health` behind `[auth, denyApiKey, superAdminOnly]` | `routes/internal/health.route.js` (new), mounted in `index.js` |

Required: PostgreSQL, Redis, RabbitMQ. Optional: MQTT — **"not configured"** unless `MQTT_HOST` and `MQTT_PORT` are both set, matching the gate in `index.js` — and ClamAV, which reports **`unknown`, never `healthy`**, because `clamAv.service` exposes no reachability probe and scanning a file on a probe endpoint would be a real side effect. Only required dependencies move the verdict.

**Verification** — 43 tests across `services/health.service.test.js` (27), `controllers/health.controller.test.js` (8) and `routes/health.route.test.js` (8, driven over real HTTP on an ephemeral port). Named cases include "is NOT ready when Redis is down — the defect A-15 describes", "stays ready when only an OPTIONAL dependency is down", "serves a cached aggregate so a load balancer does not re-probe every hit", and "GET /api/v1/health is refused for an API key".

**Deployment note, deliberate:** RabbitMQ counts as required, so a broker that is down **at boot** would now fail the Helm `startupProbe` (30 × 10 s) and restart the pod where it previously started. Compose already orders `rabbitmq: service_healthy` before the backend, so this bites only a degraded cluster. Changing it is one line in `health.service.js`; no configuration flag was invented for it.

**Stale documentation to correct (outside the change):** `deploy/README.md` still says `/health` returns `database: "connected"`, and five comments in `deploy/compose/docker-compose.yml`, the Helm values and `NOTES.txt` still describe `/health` as "calls db.authenticate()".

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
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium — billing records wrong, money correct |
| **Evidence** | `stripeWebhook.service.js#upsertInvoice` uses `Invoice.findOrCreate({ where: { stripeInvoiceId } })` with the status in `defaults` — it **never updates** an existing row. Stripe's usual retry path is `invoice.payment_failed` (row created as `Open`) then `invoice.paid` (row found, not changed). The subscription moves to `Active`; the invoice stays `Open` with `amountPaid: 0`. |
| **Spec refs** | `docs/API/11-BILLING-FINANCE-API.md` · `docs/DATABASE/11-BILLING-TABLES.md` |

**Definition of Done**
- [ ] a real upsert that updates status and amounts on an existing invoice
- [ ] a monotonic rule: `Paid` is never downgraded by a late `payment_failed` — Stripe does not guarantee event order
- [ ] tests for failed-then-paid, paid-then-late-failed, and a duplicated `invoice.paid`

**What was changed (2026-09-23)** — `services/stripeWebhook.service.js`

`upsertInvoice` was `Invoice.findOrCreate({ where, defaults })`, which only ever inserts: the
`defaults` are ignored when the row exists. It is now `findOne` → `create` or `instance.update`,
keyed on `stripeInvoiceId`, with two rules a plain upsert would not give — and both matter because
**Stripe does not guarantee event order**:

| Rule | Why |
|---|---|
| `Paid` is terminal | a late `invoice.payment_failed` must not downgrade a settled invoice |
| `amountPaid` never decreases (`Math.max`) | that same late failure carries `amount_paid: 0` and would erase a recorded payment |

`Number(existing.amountPaid)` first, because Sequelize `DECIMAL` comes back from pg as a **string**
and `Math.max` on a string is a silent wrong answer.

**Verification** — `services/stripeWebhook.upsert.a25.test.js`, 8 tests with `Invoice` backed by an
in-memory store so the assertions are on the stored **row**, not on ORM calls: "an invoice that
failed and was then paid ends up Paid, with ONE row", "a late payment_failed does not downgrade a
Paid invoice or erase amountPaid", "does not lower amountPaid when a DECIMAL comes back from pg as
a string".

**Residual:** the `invoices` model has **no** paid-at column, so only `updatedAt` moves when an
invoice settles. Writing `paidAt` would have been silently dropped by Sequelize — the same trap
shape as `is_deleted`. A `paid_at` column needs a migration and is not done.

---

### A-26 — Nothing deduplicates at-least-once delivery

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium |
| **Evidence** | Documentation across ARCHITECTURE, DEVOPS and SECURITY described Redis-held "worker idempotency claims". None exists: the only `SET NX` is the registration lock. `emailQueue.service.js` re-sends a redelivered message; webhook retries have no receiver-side idempotency key. |

**Definition of Done**
- [ ] each consumer claims a message id with `SET NX` before acting and releases the claim on failure
- [ ] outbound webhooks carry a stable `X-Webhook-Delivery` id receivers are told to deduplicate on (the header exists; the guidance does not)
- [ ] a test delivers the same message twice and asserts one effect

---

## Wave 2 — Hygiene and Gaps

**What was changed (2026-09-23)**

| Piece | File |
|---|---|
| `claimMessage(identity, ttl)` — a Redis `SET NX EX` on `dedup:msg:<identity>`, returning `{ claimed, deduplicated, release }` | `services/rabbitmq.service.js` |
| the email consumer claims `email:<job.id>` before sending; a lost claim logs and **ACKs** (nacking would redeliver work already done), and the claim is **released in the catch** so the existing retry is not read as a duplicate | `services/emailQueue.service.js` |
| the batch worker claims `batch:<payload.jobId>`, acks a duplicate, and releases the claim when the job throws so a DLQ replay can still run it | `workers/batchJob.worker.js` |

**The identity, and why it survives a redelivery:** `job.id` is minted once in `addEmailJob` and
written into the **persisted message body**, so a redelivery replays the identical body. The AMQP
**delivery tag is not stable** — it is per-channel and changes on redelivery — which is why the
identity is read from the payload, never from `msg.fields`. For batch jobs it is the `BatchJob`
row's UUID, which is additionally a natural key.

`acquireLock` from `redis.service` was deliberately **not** reused: it returns `null` both when the
lock is held and when Redis is down, and those two cases must behave in opposite ways here.

**Verification** — 111 tests across 8 suites. Named: "sends ONE email when the same message is
delivered twice, and ACKs the redelivery", "releases the claim when the send fails, so the retry is
not read as a duplicate", "runs the job ONCE when the same message is delivered twice, and ACKs
both" (in `workers/batchJob.worker.test.js` — the **first test this worker has ever had**), and
"FAILS OPEN when the Redis client is not ready — the work still happens".

**Residual risk, stated in the code as well as here:** this is **at-least-once with a dedup claim,
not exactly-once**. The claim is taken *before* the send, so a worker that dies between claiming
and sending means that email is never sent until the 24-hour TTL expires; a send that reaches SMTP
and then throws releases the claim and the retry sends a second copy. Both windows are real.
Redis down means no deduplication at all — fail open, logged, and `claim.deduplicated` is `false`
so a caller can tell; a duplicate email is recoverable, a silently dropped one is not.

**Not done:** outbound webhooks still carry no stable delivery id (that DoD box stays open), and
`QUEUE_DEDUP_TTL_SECONDS` is a new environment variable that is not yet in `.env.example`.

---

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
| **Status** | **DONE** 2026-09-23 |
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

---

**What was changed (2026-09-23)** — and the fix needed one change the card did not anticipate.

| Piece | File |
|---|---|
| `patchUser` resolves `path` through a case-insensitive attribute map (`active`, `userName`, `name.givenName`, `name.familyName`, `roleId`), stripping the core-schema URN prefix Entra ID sends; the path form and the value-object form now funnel through **one** assignment function | `services/scim.service.js` |
| `patchGroup` does the same for `displayName` and `members`, including Okta's `members[value eq "<id>"]` filter form on `remove` | `services/scim.service.js` |
| `remove` **requires** a path (the RFC makes it REQUIRED), supports `roleId`, and returns 400 for anything else — the old branch iterated `op.path` as an array against a `Joi.string()` and could never fire | `services/scim.service.js` |
| `GET /Users` parses `userName eq`, `email eq`, `emails.value eq` and `active eq` joined by ` and `; an **unsupported filter is a 400**, not the whole tenant | `services/scim.service.js` |
| the Joi schema accepts boolean and numeric values | `validators/scim.validator.js` |

**The change the card missed:** `scimPatchSchema` declared `value` as object-array-or-string, so
`{"op":"replace","path":"active","value":false}` — a **boolean** — was rejected at validation
*before the service ran*. Fixing only the service would have turned a silent 200 into a 400 on the
exact payload Okta sends.

**A guard gap closed on the way through:** `patchGroup`'s member-assignment branch had **no**
`assertAssignableRole` (A-27) at all. It was unreachable only because `assertMutableGroup` happens
to fire first for system roles — an accident of ordering, not a control. Adding path-based member
patching would have widened it. It now calls the guard before every member assignment, with tests
for both the path and value forms.

**Verification** — `npx jest src/tests/services/scim src/tests/controllers/scim src/tests/routes/scim src/tests/validators/scim` → 5 suites, **195 tests**, 100 % on all three files. Named:
"deactivates the user given the standard IdP deprovision operation" (asserting
`update({ isActive: false, status: "SUSPENDED" })`), "refuses a path-form roleId naming SUPERADMIN
with 403 and writes nothing", "rejects an unsupported path with 400 rather than ignoring it",
"narrows to one user on a userName eq filter", "rejects an unsupported filter with 400 instead of
returning the tenant", "runs a path-form member add through the A-27 role guard".

**Behaviour changes an IdP will observe:** unsupported filters, unsupported paths and `remove` on
anything but `roleId` are now **400s** where they used to be a misleading 200. `replace` on
`members` is deliberately **additive** — it assigns the listed members and does not demote omitted
ones, matching the PUT semantics — so an IdP expecting an exact sync will find omitted members
still in the group.

**Still open, and the largest remaining SCIM gap:** no SCIM mutation writes an audit row, and
`patchGroup` issues several `Users.update` calls **outside any transaction**, so a mid-loop failure
leaves partial membership. `GET /Groups` still ignores an unsupported filter and returns every role
on the platform, which is now inconsistent with `GET /Users`. `src/tests/e2e/modules/scim.e2e.test.js`
has no PATCH or filter coverage, so the live suite would not catch a regression here.


---

### A-34 — The backend lint gate has never run

| | |
|---|---|
| **Status** | **partly DONE** 2026-09-23 — ESLint runs again; the 1,319 findings behind it are not yet fixed |
| **Severity** | medium — a gate in `make verify` that could not have passed |
| **Verified** | 2026-09-23, by running it |

**Root cause:** `backend/package.json` asked for `eslint ^10.10.0` and `@eslint/js ^10.0.1`, while
the workspace root pins `eslint 9.22.0`. npm hoisting gave the backend **ESLint 9.22.0 with
`@eslint/js` 10.0.1**, and `js.configs.recommended` from 10.x enables `no-unassigned-vars`, a rule
9.22 does not have. Every invocation died before linting a single file:

```
TypeError: Key "rules": Key "no-unassigned-vars": Could not find "no-unassigned-vars" in plugin "@".
```

`make verify` runs lint first. It has therefore never passed on this machine, and nothing in CI
runs it either (there is no CI gate — A-19).

**What was changed**

| Change | File |
|---|---|
| backend pinned to the same ESLint the workspace root pins (`9.22.0`, both packages) | `backend/package.json` |
| `test`, `fetch`, `AbortController`, `AbortSignal`, `global`, `TextEncoder`, `TextDecoder`, `structuredClone` added to `globals` — the missing `test` alone produced **385** `no-undef` errors | `backend/eslint.config.js` |
| `eqeqeq` now `{ null: "ignore" }` — `x == null` is the deliberate "null or undefined" idiom in `kanban.service.js`; requiring `===` would have changed behaviour for `undefined` | `backend/eslint.config.js` |
| `no-redeclare` now `{ builtinGlobals: false }` — `webhook.service.js` declares `/* global fetch, AbortController */` for readers | `backend/eslint.config.js` |

**What is left:** **1,297 errors and 340 warnings** as re-measured on 2026-09-23 after the day's
commits (the first measurement, earlier the same day, was 1,319 and 346 — the drop is the
remediation work, not a fix to the lint debt). Of these, roughly 1,300 are auto-fixable
(`indent` 392, `quotes` 296, `comma-dangle` 266, `curly` 243, `no-trailing-spaces` 87,
`eol-last` 19). None of them is a logic defect — the three that looked like one
(`eqeqeq` ×2, `no-redeclare` ×2) were the linter being wrong about deliberate code, which is why
they are config changes above rather than code changes. The remaining `no-unused-vars` (303) and
`no-console` (24) warnings need reading one by one; an unused variable is occasionally a real bug.

**Why the fix is not "run `--fix` and commit":** it rewrites nearly every file in `backend/src`,
which would collide with the authorization work in flight and bury it in a 1,300-line diff. It is
its own commit, taken once the security waves land, with the full suite as the check.

**Verification (DoD)**
- [x] `npx eslint src/ --ext .js` runs to completion
- [ ] zero errors
- [ ] `make verify` reaches the typecheck step
- [ ] a CI job runs it (A-19)

---

### A-35 — Every per-user permission override silently did nothing

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — a revocation that did not revoke** |
| **Verified** | from code, 2026-09-23, while fixing A-04 |

**Root cause:** `userPermission.service.js#getUserOverrideMatrix` keyed the matrix by menu
**name** — `matrix[p.menu.name]`, e.g. `"Warehouse"` — while `dynamicAccess.middleware.js` looks
an override up as `overrides[menuName]`, where `menuName` is whatever the route passed. Every
route passes a lowercase **slug** (`"warehouse"`). `hasOwnProperty` therefore never matched, on
any route, and the override branch never ran.

`roles.service.js#getRolePermissionsMatrix` indexes by **both** name and slug — which is why role
permissions work and overrides did not.

**Impact:** an administrator granting a single user extra access saw it do nothing. Worse in the
other direction: an override of `"none"` is a **revocation**, and it also did nothing — the user
kept whatever the role granted while the UI showed the access as removed. That is a security
control that reported success and took no effect.

**Fix:** the override matrix is now indexed by name **and** slug, so either key resolves.

**Verification** — `npx jest src/tests/services/userPermission` → 16 tests still pass, and
A-04's `controllers/search.permissions.a04.test.js` "honours a per-user 'none' override that
revokes a menu the role grants" exercises the path end to end through the real middleware.

**Residual:** the cached matrix (`cacheKeys.userPermissions`) may hold name-only entries written
before this change until it expires; `removeUserPermission` and the setter already invalidate it.
Not verified against a live database.

---

### A-36 — RabbitMQ connections are never reused and never closed

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — a connection leak against the broker, in production** |
| **Verified** | from code and `node_modules`, 2026-09-23, while building the health probes |

**Root cause:** `rabbitmq.service.js:26` and `:57`, and `emailQueue.service.js:19` and `:54`,
cache on `connection.isOpen` / `channel.isOpen`. **amqplib 2.0.1 defines no `isOpen`** — the
property does not exist anywhere in `node_modules/amqplib/lib/`.

The guard is therefore always false, so every call to `getConnection()`,
`getRabbitMQConnection()` or `getChannel()` opens a **new** AMQP connection or channel, and
nothing ever closes it. Under load the process accumulates broker connections until the broker's
limit is reached.

**This is the third instance of one shape:** a liveness guard on a property the driver does not
have. `redis.service` guarded on ioredis's non-existent `.connected` (A-24, fixed 2026-09-21) and
its test mock **fabricated** the property, which is why the suite stayed green. Check the amqplib
mocks for the same fabrication before trusting any test here.

**Fix direction:** cache the connection and channel and clear the cached reference on amqplib's
real `"close"` and `"error"` events; reconnect when the reference is gone.

**Verification (DoD)**
- [ ] two `getConnection()` calls result in **one** `amqplib.connect`
- [ ] a `"close"` event forces the next call to reconnect
- [ ] the amqplib test mock exposes only what amqplib exposes — no invented `isOpen`
- [ ] broker connection count stays flat under repeated publishes (live check)

---

**What was changed (2026-09-23)** — `rabbitmq.service.js` and `emailQueue.service.js`

Liveness now comes from the `"close"` and `"error"` events amqplib really emits, with an identity
guard so a late event from a **superseded** connection cannot evict its replacement. Channel-level
handlers were added — there were none. `closeRabbitMQ` clears the cache in a `finally`, which it
never had to do before **because the cache never hit**.

**The test mocks fabricated `isOpen`** — exactly as the ioredis mock fabricated `connected` in
A-24. Both harnesses now expose only what amqplib exposes, and `amqplib.connect` returns a
**distinct** object per call, because otherwise a test cannot tell a reused cache from a fresh
connection.

**Verification** — "reuses one connection across calls instead of opening a new one each time"
asserts `amqp.connect` was called **once** across two `getConnection()` and two `getChannel()`
calls; "reconnects after the connection emits close"; "a close from a superseded connection does
not evict the live one"; and, in `emailQueue.service.test.js`, "should open exactly ONE connection
and channel across many queued emails". 100 % on both files.

**Note for A-32:** this is the third instance of one shape — a liveness guard on a property the
driver does not have, kept green by a mock that invented it. Worth a lint rule or a review habit,
not just three fixes.

---

### A-37 — SCIM user creation is a cross-tenant existence oracle

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — the trap `CLAUDE.md` names by name** |
| **Verified** | from code, 2026-09-23 (found during the documentation sweep, confirmed by the orchestrator) |

**Root cause:** `user.model.js` declares **global** unique indexes on `username` and `email`
(`{ fields: ["username"], unique: true }`, `{ fields: ["email"], unique: true }`), while the
duplicate check in `scim.service.js#createUser` is `Users.findOne({ where: { email } })` — which
the global tenant hooks narrow to the **caller's own tenant**.

So for an address already used by **another** tenant: the 409 check passes, the insert is
attempted, and the database constraint rejects it. The caller gets a different failure for
"exists elsewhere on the platform" than for "does not exist", which is exactly the membership
oracle the 404 rule exists to prevent — here reached with nothing but an API key.

**Also:** the same shape applies to `createGroup`, because role `name` is globally unique
(`role.model.js`) — see A-38.

**Fix direction:** this needs a decision, not a patch. Either
(a) make `username`/`email` unique **per tenant** — a migration and an ADR, and it changes what
"an account" means across the platform, or
(b) keep global uniqueness and make both paths answer **identically** (the same 409 with the same
body whether the collision is inside the tenant or outside it), which hides the oracle but keeps
an address unusable in a second hospital for reasons the admin cannot see.
Open Question for `TASKS/BACKLOG.md` either way; do not pick one in a bug fix.

**Verification (DoD)**
- [ ] creating a user whose email exists in ANOTHER tenant is indistinguishable from creating one with a fresh email failing for any other reason
- [ ] a two-tenant test asserts the two responses are byte-identical
- [ ] whichever route is chosen is recorded as an ADR

---

### A-38 — SCIM Groups are global roles

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — cross-tenant disclosure and availability, not data leakage |
| **Verified** | from code, 2026-09-23 |

Roles have no `tenantId` (`role.model.js`), so through SCIM Groups:

| Operation | Effect |
|---|---|
| `GET /Groups` | lists **every** role on the platform, including groups another tenant's IdP created |
| `POST /Groups` | 409 when the name is already taken **by another tenant** — the same oracle as A-37 |
| `DELETE /Groups/:id` | destroys a non-system role for **every** tenant whose users hold it |

Membership is tenant-scoped, so the users themselves are not disclosed. `assertMutableGroup`
(A-27) already refuses system roles, which is what keeps this from being critical.

**Fix direction:** roles need tenant ownership, or SCIM Groups need to be backed by something
that has it. That is a data-model decision — ADR, not a patch.

---

### A-39 — A SCIM-provisioned group grants nothing, silently

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — the `ROLE_LEVELS` trap, reached from the IdP side |
| **Verified** | from code, 2026-09-23 |

`scim.service.js#createGroup` creates the role with no `roleLevel` and no menu-group permissions,
so it takes the model default. Members of that group pass neither `rbac()` — which compares
`role.role_level` — nor `dynamicAccess`, which reads the role→menu matrix.

The IdP is told "group created". An administrator reads that as "access granted". Every member
gets nothing, and nothing says so.

This is the trap `CLAUDE.md` lists as "a new role without a `ROLE_LEVELS` entry fails every
privileged gate, **silently**" — the SCIM endpoint is a way to create exactly that role from
outside the codebase.

**Fix direction:** either refuse to create a group that carries no permission mapping, or give a
SCIM-created group an explicit, documented level and an empty-but-real permission set, and return
something in the response that says what it grants.

---

### A-40 — Storage: per-process driver cache, and an unverified copy reported as migrated

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

| | |
|---|---|
| `services/storage/index.js` invalidates the driver cache by deleting from an **in-process** `Map`. On more than one replica, the others keep the stale driver — including after credentials are rotated or revoked — until restart | a revoked key keeps working on replicas that did not handle the settings change |
| `storageMigration.service.js` verifies the copy only `if (attachment.checksum && …)`. A row with no checksum is copied **unverified** and reported `status: "migrated", verified: false` | the operator-facing claim is "verified copy"; for those rows it is not |

**Fix direction:** invalidate across replicas (the Redis client is available and now works), and
either compute a checksum before copying or report the row as `migrated-unverified` in a way the
operator cannot miss.

---

### A-41 — Audit rows are written after the response, outside the transaction

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — compliance evidence that does not match what happened** |
| **Verified** | from code, 2026-09-23 |

`CLAUDE.md` states the rule without qualification: *every mutation writes an audit row, inside the
transaction.* `auditLog.middleware.js#recordAudit` registers itself on `res.on("finish")`, and its
own JSDoc describes it as "best-effort and non-blocking".

So it runs **after** the response is sent, outside any transaction:

| Case | Result |
|---|---|
| the action rolls back after the response is queued | an audit row records something that did not happen |
| the audit insert fails | the action is committed and unattributable |

Both are exactly the two failures the rule exists to prevent, and the second is invisible (A-42).

**Fix direction:** mutations that carry compliance weight write their audit row inside the same
transaction as the change — services, not middleware. The middleware can stay for the rest, but it
must not be what ISO 17025 / 21 CFR Part 11 attribution depends on. This needs a decision about
which mutations are in that set, so it starts as a spec, not a patch.

**Verification (DoD)**
- [ ] a rolled-back mutation leaves **no** audit row (test with a forced rollback)
- [ ] a failing audit insert rolls the mutation back
- [ ] the list of mutations covered is written down, not implied

---

### A-42 — A failed audit write is announced only to stdout, which production discards

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

`audit.service.js#logAction` catches a failed insert, calls
`console.error("Failed to write audit log (CRITICAL):", error)` and returns `null`.

Two things make that worse than it looks:
1. the logger's Console transport is **development-only**, so in production the message goes to a
   stream nothing collects — `docker logs` shows it, the log files do not;
2. there are **25 `console.*` call sites** in runtime backend code, all with the same property.
   `docs/ENGINEERING/12-LOGGING-CONVENTIONS.md` claims `config/socket.js` is "the only application
   output that reaches stdout in production" — corrected 2026-09-23.

A compliance record that fails to write therefore fails **silently and durably**.

**Fix direction:** route it through winston at `error` level so it lands in the file sinks; decide
whether a failed audit write should also fail the request (see A-41). Sweep the other 24 sites.

---

### A-43 — `auditAction` logs full request and response bodies, unredacted

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — no live leak, because it has no caller |
| **Verified** | from code, 2026-09-23 |

`auditLog.middleware.js#auditAction` logs `body: req.body` and `response: body` at `info` into
`log/activity/combined/`. There is no redactor anywhere in `backend/src` — the only `redact`-shaped
code is GDPR anonymisation and per-response secret hiding. On a login route this writes plaintext
passwords to disk.

It has **no caller outside its own tests**. That is the only reason this is not an active leak,
and it is also why nobody has noticed: it is a loaded gun, covered by tests, waiting to be wired up.

**Fix direction:** delete it, or give it a redaction allow-list and a reason to exist. Do not leave
it as is. `docs/DEVOPS/06-LOGGING.md` § Redaction describes a redactor as as-built; that is a target
and is corrected.

---

### A-44 — The access log was never pruned

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | medium — unbounded disk growth on the deployment |
| **Verified** | against the installed library, 2026-09-23 |

`accessLog.middleware.js` passed `{ interval: "1d", compress: "gzip", history: "30d" }` to
`rotating-file-stream`. In that library `history` is **the name of the rotation-history file**
("Specifies the history filename", its README § history) — retention is `maxFiles` / `maxSize`.

So nothing pruned the access log, and a bookkeeping file literally named `30d` was created in
`log/access/`. `docs/DEVOPS/06-LOGGING.md` recorded this as "30 days" retention.

**Fix:** `maxFiles: 30` with the daily interval, and the misleading `history` option removed. The
stale `30d` file on any existing deployment can be deleted by hand.

---

### A-45 — A decommissioned IoT device still ingested, and one bad message shut the server down

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high** — an availability defect reachable from an unauthenticated MQTT topic |
| **Verified** | from code, 2026-09-23 |

Two defects in the same module, both found while documenting it:

| | |
|---|---|
| `iot.controller.js` and `iot.service.js` look the device up with `.unscoped()` — needed to cross tenants, since ingest arrives with a device token rather than a session — which also drops the `defaultScope` that excludes soft-deleted rows. **A device that was decommissioned kept ingesting.** | the soft-delete predicate is now carried explicitly: `isDeleted: false` |
| the MQTT message handler called `this.ingestReading(...)` **unawaited and uncaught**; its `try` covers only `JSON.parse`. An unknown or disabled device id rejected, reached the process-level `unhandledRejection` handler in `index.js` — which calls `shutdown()`. **One stale retained message on the broker shut the backend down.** | the call now has a `.catch` that logs and continues |

**Verification** — `npx jest src/tests/services/iot src/tests/controllers/iot` → 68 tests, 100 % on
both files. Named: "carries the soft-delete predicate explicitly on the unscoped lookup" and
"logs a failed ingest instead of taking the process down" (which asserts no `unhandledRejection`
fires).

**Residual:** the MQTT path is off on the reference deployment (`MQTT_HOST`/`MQTT_PORT` unset), so
the shutdown defect was never reachable there. Not verified against a live broker.

---

### A-46 — IoT anomaly detection is structurally dead

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — a documented feature that cannot fire |
| **Verified** | from code, 2026-09-23 |

`readingTolerance` is as unprovisionable as the device token A-29 describes: it is absent from both
Joi schemas in `calibrationDevices.validator.js`, which strip unknown keys, and there is no route
and no UI that sets it. It is therefore always `null`, the comparison in `iot.service.js` never
runs, `isAnomaly` is always `false`, and **no anomaly notification can ever fire**.

A-29 covers the token; this is the second half of the same hole, and predictive maintenance —
documented as deriving risk "from IoT readings" — sits downstream of both.

**Fix direction:** provision it with the token, in one admin surface; until then the feature is
described as planned, not built.

**Also open (same module, lower severity):** ingest writes no `audit_logs` row; the anomaly log line
inlines the whole payload, against the "no full bodies" rule; and
`src/tests/e2e/modules/iot.e2e.test.js` expects **400** for an empty body where the code throws
**401** first — an E2E assertion that looks like it cannot pass, unverified because the live suite
has never completed a run (P6-02).

---

### A-47 — No electronic signature can ever verify

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 — [ADR-040](../MEMORY/DECISIONS.md) |
| **Severity** | **critical — the evidence the 21 CFR Part 11 and ISO 13485 claims rest on** |
| **Verified** | from code, 2026-09-23, by the orchestrator |

**Root cause:** `eSignature.service.js#generateSignatureHash(documentId, userId, tenantId)` hashes
`${documentId}:${userId}:${tenantId}:${Date.now()}`. `verifySignature` recomputes that **same
function** and compares it to the stored hash. Because `Date.now()` is inside the payload, the two
values can never be equal: **`verifySignature` returns `valid: false` for every genuine
signature.**

And there is nothing behind it. `verifySignature` reads **no key**. The tenant RSA key pairs are
generated, stored encrypted, listed and deleted through the API — and used to sign nothing. The
"electronic signature" is a SHA-256 of a timestamp. It binds no document, identifies no signer and
cannot be verified by anyone, including this system.

**What this means for the compliance claims:** 21 CFR Part 11 § 11.70 requires the signature to be
linked to its record so it cannot be excised, copied or transferred. A hash that includes the
current time is linked to nothing. Any audit of this feature ends here.

**In progress:** a real RSA-SHA256 signature over a deterministic canonical payload, verified with
the tenant public key, with soft-deleted keys still loadable so a key deletion does not invalidate
past signatures, and existing records marked distinguishably rather than reported as forgeries.
That is a design change, so it lands with an ADR.

**Verification (DoD)**
- [ ] a genuine signature verifies as **valid** — the case that fails today
- [ ] a record tampered with after signing verifies as invalid
- [ ] a signature whose key was soft-deleted still verifies
- [ ] a record signed under the old scheme is distinguishable from both a valid and a forged one
- [ ] an ADR records the decision and what happens to the signatures already stored

---

**What was changed (2026-09-23) — ADR-040**

`generateSignatureHash` is **deleted**. Signing now produces an RSA-SHA256 signature with the
tenant's private key over a canonical payload binding scheme, algorithm, tenant, document,
workflow, workflow step, signer, `signedAt`, authentication method and the signature's *meaning*.
The payload is a JSON **array of `[name, value]` pairs** in a fixed order, so key ordering cannot
drift and a NULL column cannot diverge from an empty string. `signedAt` is fixed **once**, before
signing, and verification reads it from the stored column — nothing is ever derived from the
verification-time clock.

Verification loads the key with `paranoid: false`, so a **soft-deleted key still verifies its past
signatures**, and returns a `verificationStatus` enum rather than a bare boolean. Signing with no
key pair provisioned is a **409** with a remedy, not a 500. Migration `0019` adds
`signature_value`, `signing_key_id`, `signature_scheme` and `signature_reason` — nullable, and
**no backfill**: signing an old record today would assert a property it never had, which is
falsifying a Part 11 record.

**Records already signed** are reported `unverifiable_legacy` — never valid, never a forgery,
because the original scheme bound nothing and cannot tell them apart. **On the reference
deployment this is moot: `signature_records` is empty** (checked 2026-09-23 — 0 signatures, 0
workflows, 0 tenant keys). The feature was never used, which is the only reason this is a bug fix
rather than an archive recovery.

**Verification** — 6 suites, 116 tests, 100 % on `eSignature.service.js`. The new suite uses a
**real** RSA key and the real at-rest wrapper, not a mocked signer — a mocked signer is the class
of test that let this live. Named: "verifies as valid — the case that could never pass before
ADR-040", "verifies as INVALID when the signing timestamp is changed after signing", "still
verifies a signature whose key has been soft-deleted", "is reported as unverifiable_legacy —
neither valid nor a forgery", "fails with 409 and an actionable message when no key pair is
provisioned".

**Not done, and named rather than buried**
- **Migration 0019 has not been run.** No database was reachable from the machine that wrote it.
  Confirm the four columns in `psql` after `make migrate` — the log is not evidence.
- `signature_reason` is bound but the controller and validator do not accept a `reason`, so it is
  always NULL: signatures currently bind an **empty meaning**. Residual § 11.50(a)(3) gap.
- The e-signature private keys are wrapped with `ENCRYPT_KEY` directly rather than through
  `kms.service.js` like every other tenant secret — now the weakest link in the chain.
- Key rotation is undesigned; a **hard** delete of a key makes its signatures permanently
  unverifiable; there is no trusted timestamp; and per-tenant keys prove the *service* signed, not
  the person.


---

### A-48 — Revocation does not revoke

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code and the **running deployment's** configuration, 2026-09-23 |

**Root cause:** `auth.middleware.js` states its own scope in a comment — *"RBAC Only - No Session
Validation"* — and it means it. It verifies the JWT and loads the user. It never reads the
`sessions` table. Nothing else in the request path does either, now that the dead
`sessionSecurity.middleware.js` is gone (A-12).

So revoking a session, logging out, or an administrator terminating someone's access changes a row
that **no request ever consults**. The access token keeps working until it expires on its own.

**How long is "until it expires":** `.env.example` says `JWT_ACCESS_EXPIRED=15m`. The running
deployment on 10.1.200.13 is configured `JWT_ACCESS_EXPIRED=1d`, and so is the local `.env`. So a
revoked session stays usable for up to **24 hours**, not fifteen minutes — and the documented
figure is the one nobody is running.

**Why it matters here specifically:** this is the control an administrator reaches for when
credentials are suspected stolen, when someone leaves, or when a tenant is suspended mid-session.
It reports success and does nothing for a day. `docs/BACKEND/10-MODULE-REFERENCE.md` § 23 already
recorded the gap as "~15 minutes"; the real window is the deployed token lifetime.

**Fix direction:** check the session on each request — the token already carries enough to find it,
and the lookup is cacheable in Redis (now working, A-24) so it need not be a database read per
request. Failing that, shorten `JWT_ACCESS_EXPIRED` to the documented 15 minutes and say plainly
that revocation is eventual, with the window named. The first is the control; the second is an
honest mitigation. Either way, the deployed value and the documented value must be the same number.

**Verification (DoD)**
- [ ] a revoked session's access token is rejected on the next request
- [ ] a suspended tenant's live sessions stop working without waiting for expiry
- [ ] `JWT_ACCESS_EXPIRED` is the same in `.env.example`, the VM and the documentation
- [ ] the same question answered for Socket.IO, whose checks are connect-time only (A-05, Q-08)

---

### A-49 — SCIM leftovers after A-33

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23, while amending `docs/DEVELOPER/09-SCIM-PROVISIONING.md` |

Four things the A-33 work did not cover, found by reading the module against its own document:

| | |
|---|---|
| **`GET /Groups` `displayName eq` is case-sensitive against an uppercased column.** The filter assigns the value raw while `createGroup` stores `displayName.toUpperCase()`. An IdP probing `displayName eq "Engineers"` gets zero results, POSTs, and gets **409 Group already exists** | the same existence-oracle shape as A-37, reached a different way |
| **A patch `value` is never UUID-validated.** `scimUserSchema.roleId` and `scimGroupSchema.members[].value` are `Joi.string().uuid()`, but `scimPatchSchema.value` accepts any object, array, string, boolean or number. A path-form `roleId` carrying a malformed id reaches `Role.findOne({ where: { id } })` against a `UUID` column | a driver error rendered as a **500** where a 400 is owed. Inferred from the schema, not observed live — worth confirming before fixing |
| **`src/tests/e2e/modules/scim.e2e.test.js` cannot pass as written.** Its header asserts SCIM endpoints return the SCIM envelope "NOT the platform envelope — this is by spec", and it reads `body.Resources` / `body.id`. The controller wraps everything in `success()`, and the e2e setup does no unwrapping, so the real paths are `body.data.Resources` / `body.data.id` | two of the four live specs would fail. Either the envelope is fixed (the document says no compliant SCIM client can parse it today) or the spec is — and the choice is the same one A-33's "still open" list names |
| **`userName eq` filters on `email` only** | a user whose `username` differs from their email is unfindable by the filter an IdP uses to decide whether to create them |

`GET /Groups` also still ignores an unsupported filter and returns every role on the platform,
which is now inconsistent with `GET /Users`, and its `count` is unbounded.

**Fix direction:** lower-case the `displayName` comparison (or store it as given and compare
case-insensitively — pick one and record it); validate patch values against the same UUID rule the
other schemas use; and decide the envelope question, because the e2e spec and the document
currently disagree about what this endpoint is supposed to return.

---

### A-50 — Webhook deliveries followed redirects, walking past the SSRF check

| | |
|---|---|
| **Status** | **DONE** 2026-09-23 |
| **Severity** | **high — SSRF from inside the deployment** |
| **Verified** | from code, 2026-09-23, while documenting the module |

**Root cause:** `webhook.service.js` called `fetch(webhook.url, { … })` with no `redirect` option, so
Node's default (`follow`) applied. The SSRF defences are real and well placed —
`assertSafeUrl` on create and update, and `assertResolvedHostIsPublic` immediately before **every**
attempt, retries included — but they validate the **registered** URL.

A host that passes both layers can answer `302 Location: http://169.254.169.254/latest/meta-data/`
and this process fetches cloud metadata from inside the deployment, signs nothing about it, and
records the result. Registering a webhook is now tenant-admin-only (A-02), which narrows who can
do it; it does not make the request safe.

**Fix:** `redirect: "manual"`, and a 3xx is recorded as a delivery failure with a message telling
the operator to re-register at the new URL. A receiver that wants to move must say so through the
API, not through a redirect.

**Verification** — `npx jest src/tests/services/webhook` → 26 tests, 100 % on the file. Named:
"does not follow a redirect, and records it as a delivery failure", which asserts both the
`redirect: "manual"` option and the recorded `lastError`.

---

### A-51 — Webhook routes have no validator, and the signing secret is caller-supplied

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

Four problems with one root: **none of the seven webhook routes mounts `validate(schema)`.**

| | |
|---|---|
| the controller spreads `{ ...req.body }` into `createWebhook`, which honours a caller-supplied `secret` | `{"secret":"a"}` creates a webhook whose HMAC signatures are trivially forgeable. The secret is never displayed again and nothing warns |
| `url`, `events` and `isActive` are unvalidated beyond the service's own two checks | shape errors surface as 500s or as silently inert subscriptions |
| `webhooks.secret` is stored **in plaintext** — no KMS, not in `SENSITIVE_KEYS`, unlike tenant storage credentials | a database read or a backup yields every tenant's signing key |
| `updateWebhook` patches only `url`, `events`, `description`, `isActive` — there is **no rotation** | a leaked secret can only be replaced by delete + re-register, with a new id and a delivery gap. Worse: patching the `url` keeps the old secret, so the new host is signed with a key the old host still holds |

**Fix direction:** a Joi schema on every route; the secret is generated server-side only and never
accepted from a caller; store it through `kms.service.js` like the other tenant secrets; add a
rotation endpoint that returns the new secret once, with an overlap window if receivers need one.

---

### A-52 — The socket token's `purpose` claim is read nowhere

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

`auth.controller.js` mints the socket token as `jwt.sign({ id, purpose: "socket" }, …)`. Nothing
reads `purpose` — `jwt.util.js` enforces only the `typ` claim (A-31), which this token does not
set, and the socket handshake calls the same `verifyAccessToken` the HTTP layer does.

So **a socket token is a valid HTTP access token** for its 300 seconds, and any ordinary access
token is a valid handshake token. The 5-minute lifetime is shorter than `JWT_ACCESS_EXPIRED`, so
this narrows rather than widens — but the claim reads as a control and is not one, which is the
kind of thing a reviewer relies on.

It also signs with `process.env.JWT_ACCESS_SECRET` directly, bypassing the key registry that
exists to support rotation: after a rotation the minted token and the verifier can disagree.

**Fix direction:** give it `typ: "socket"` and enforce it in the handshake (the A-31 machinery is
already there), and mint it through the same registry as every other token.

---

### A-53 — A reconnected socket never re-joins its board rooms

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — user-visible, and silent |
| **Verified** | from code, 2026-09-23 |

`frontend/.../useBoard.ts` emits `kanban:join` once, from a `useEffect` keyed on `projectId`. The
client has `reconnection: true`, and a reconnect produces a **new socket id with empty server-side
room membership** — so after any reconnect, live board updates stop. REST data stays correct,
which is exactly what makes it hard to notice: the board looks fine and quietly stops moving.

It also passes **no ack callback**, and the server supports one, so a refused join is invisible too.

**Also found in the same sweep:** `super_admins` is a room nothing emits to any more; a tenantless
principal joins a literal `tenant_null` room; and of eighteen `kanban:*` server events, six are
emitted and listened to by nobody.

**Fix direction:** re-emit `kanban:join` on the client's `connect` event, and pass the ack so a
refusal surfaces.

---

### A-54 — No Socket.IO adapter: a second replica splits the fan-out

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — an architectural constraint, not a live defect |
| **Verified** | from code and the Helm values, 2026-09-23 |

The server is constructed with the default in-memory adapter; neither `@socket.io/redis-adapter`
nor `socket.io-redis` is a dependency. That is consistent with `backend.replicaCount: 1` in the
Helm values, and it is a **hard blocker on ever raising it**: with two replicas, a notification or
board update reaches only the users connected to the process that emitted it. Sticky sessions do
not fix this — the emit happens server-side, not per client.

Worth recording next to A-30, which made the rate limiter replica-safe: the limiter is ready for
more than one replica now, and the realtime layer is not.

---

### A-55 — `createTwoTenants()` does not exist

| | |
|---|---|
| **Status** | **corrected** 2026-09-23 |
| **Severity** | medium — it is the reason a non-negotiable is not being followed |
| **Verified** | repo-wide grep, 2026-09-23 |

`CLAUDE.md` states: *"Every new `:id` route needs a two-tenant test asserting 404 … `createTwoTenants()`
is a one-line fixture precisely so this gets written."* The helper appears in `CLAUDE.md` and eight
`docs/` files and in **zero** code files.

So the instruction that is supposed to make the test cheap points at something that does not exist,
and the test that `CLAUDE.md` calls mandatory is written for almost no route. This is the PR-4 shape
in the file that opens by warning about the PR-4 shape.

**Corrected in `CLAUDE.md`** on 2026-09-23 to say the fixture does not exist and that writing it is
the first step. The fixture itself is not written yet — that is the open half.

**Verification (DoD)**
- [x] `CLAUDE.md` no longer cites a helper that does not exist
- [ ] the fixture exists, and one `:id` route uses it
- [ ] the eight documents that cite it are corrected or point at the real thing

---

### A-56 — Search swallows every query error into an empty list

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

`search.service.js` catches broadly around the full-text query, retries as `ILIKE`, and on a second
failure returns `[]`. So a statement failing for any reason — a missing column, a type error, a
permission problem — renders as **"no results"**.

That is the failure shape `CLAUDE.md` calls the most repeated defect in this codebase: a list that
silently returns nothing. The fallback itself is reasonable; swallowing the second failure is not.

**Fix direction:** keep the FTS → ILIKE fallback, but let a second failure surface as a 500 with the
request id, and log both causes.

---

### A-57 — The public verification endpoint publishes a draft certificate's PDF

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23, during the file-serving debate |
| **Decision** | [ADR-042](../MEMORY/DECISIONS.md) |

`GET /certificates/verify/:certificateNumber` is deliberately unauthenticated — a third party
scanning a QR code must be able to check a certificate without an account. That is correct, and it
is the point of third-party-verifiable evidence.

But `certificatePdf.service.js` computes the verdict at `:286`:

```js
const valid = signed && !revoked && !expired;
```

and then, twenty-five lines later, returns the document regardless:

```js
documentUrl: cert.filePath || null,
```

So an **unissued draft** — and a **revoked** certificate — has its PDF path published to anyone who
walks the certificate number, which is a sequential counter
(`CERT-<YYYYMMDD>-<tenantCode>-<sequence>`). Combined with the unauthenticated `/uploads` mount
(S-01), the document itself is then fetchable.

A draft is a calibration result that has not been approved. Publishing it is worse than publishing
a finished one: it is evidence the tenant has explicitly not stood behind yet.

**Fix direction:** return `documentUrl` only when the certificate is in a state whose document is
meant to be public, and decide deliberately what a revoked certificate returns — a revoked
certificate's document arguably *should* remain fetchable so a holder can see it was revoked, but
that is a decision to record, not to infer. The status gate already exists one line above.

**Definition of Done**
- [ ] a `draft` certificate returns `documentUrl: null` from the public endpoint, proven by a named test
- [ ] the behaviour for `revoked` is decided and recorded, not left implicit
- [ ] the response for a nonexistent and an unissued number are indistinguishable beyond `found`

---

### A-58 — Five workflow routes gate on a slug that does not exist

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — a live lockout, and the proof that A-07 is not theoretical** |
| **Verified** | 2026-09-23, by executing the constant rather than reading it |
| **Decision** | [ADR-043](../MEMORY/DECISIONS.md) |

`workflows.route.js` lines 149, 215, 252, 316 and 354 gate on:

```js
dynamicAccess("workflow", "read")   // and "write"
```

**singular.** The slug in `MENU_SLUGS` is `workflows`, and the seeded menu row
(`seedMenuGroups.util.js:277`) is `workflows`. Checked by running the constant:

```
workflow  -> false
workflows -> true
```

A `dynamicAccess` name that matches no menu group grants nobody. So those five routes — the
approval-workflow engine — have been **SUPERADMIN-only**, silently, despite
`roleConstants.js:254` granting the permission to the admin roles. Nobody saw a misconfiguration;
they saw a 403 and assumed a permission decision.

This is finding A-07 with a concrete instance attached, and it is the evidence behind ADR-043's
central point: the defect is **unvalidated authorization data**, not the choice between `rbac` and
`dynamicAccess`. One character.

**Fix direction:** correct the five call sites, and — more importantly — add the startup assertion
ADR-043 step 5 describes, so that a `dynamicAccess` name matching no seeded slug refuses to boot
and names itself. Correcting these five without the assertion leaves the next typo to be found the
same way.

**Definition of Done**
- [ ] the five routes use `workflows`, and a named test proves an admin role reaches them
- [ ] a startup assertion fails, naming the offender, when any `dynamicAccess` name matches no seeded slug
- [ ] the assertion is proven by temporarily reintroducing the typo — a check nobody has watched fail is not a check
