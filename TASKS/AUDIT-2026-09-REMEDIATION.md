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
| A-13 | raw internal error messages reach clients in production | medium | 0 | **PARTIAL** 2026-09-24 — `dynamicAccess` done; `asyncHandler` open |
| A-14 | production logging: no stdout, per-request lines dropped, unbounded files | medium | 1 | TODO |
| A-15 | `/health` checks only the database | medium | 1 | **DONE** 2026-09-23 |
| A-16 | whether `req.ip` is the client through a three-proxy chain | **unverified** | 1 | TODO |
| A-17 | MQTT: public port with nothing behind it; the MQTT path authenticates nobody | low | 0 | **DONE** 2026-09-23 |
| A-18 | dead code and unused dependencies | low | 2 | TODO |
| A-19 | no secret scanner, no hook, no gate of any kind | medium | 2 | TODO |
| A-20 | the `automate/` Playwright suite is not in the repository | medium | 2 | TODO |
| A-21 | no lockfile is committed | medium | 2 | **DONE** 2026-09-23 (ADR-044) |
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
| A-37 | **SCIM user creation is a cross-tenant existence oracle** — global unique email, tenant-scoped duplicate check | **high** | 0 | **PARTIAL** 2026-09-24 — signal hidden; the constraint is Q-18 |
| A-38 | SCIM Groups are global roles: every tenant's groups are listed, and a delete removes one for everyone | medium | 1 | TODO |
| A-39 | a SCIM-provisioned group grants nothing, silently — `roleLevel` defaults to 1 and it gets no menu permissions | medium | 1 | TODO |
| A-40 | storage: the driver cache is per process, and a null-checksum migration reports `migrated` unverified | low | 2 | TODO |
| A-41 | **audit rows are written after the response, outside the transaction** — the rule `CLAUDE.md` calls non-negotiable | **high** | 0 | **DONE** 2026-09-24 for the 25 mutations named in the spec; the rest stay on the middleware |
| A-42 | a failed audit write is reported to `console.error` only — and production writes no stdout anywhere | **high** | 0 | **PARTIAL** 2026-09-24 — audit path done; 24 other `console.*` sites remain |
| A-43 | `auditAction` logs full request and response bodies, unredacted — dead code, and a loaded gun | medium | 1 | TODO |
| A-44 | the access log was never pruned: `history` is a filename, not a retention period | medium | 0 | **DONE** 2026-09-23 |
| A-45 | a soft-deleted IoT device still ingested; one bad MQTT message shut the server down | **high** | 0 | **DONE** 2026-09-23 |
| A-46 | IoT anomaly detection is structurally dead — `readingTolerance` cannot be set | medium | 1 | TODO |
| A-47 | **no electronic signature could ever verify** — `Date.now()` was inside the hashed payload, and the key pairs signed nothing | **critical — compliance** | 0 | **DONE** 2026-09-23 (ADR-040) |
| A-48 | **revocation does not revoke**: nothing in the request path reads `sessions`, and production issues 24-hour access tokens | **high** | 0 | **DONE** 2026-09-24 — tokens without `sid` still accepted, see A-59 |
| A-49 | SCIM leftovers: a case-sensitive `displayName` oracle, unvalidated patch values, and an e2e spec that cannot pass | medium | 1 | TODO |
| A-50 | webhook deliveries followed redirects, so a 302 walked past the SSRF check | **high** | 0 | **DONE** 2026-09-23 |
| A-51 | webhook routes have **no validator at all**: the signing secret is caller-supplied, unvalidated, plaintext, and unrotatable | **high** | 0 | **DONE** 2026-09-24 |
| A-52 | the socket token's `purpose: "socket"` claim is read nowhere — it is an ordinary access token | medium | 1 | **DONE** 2026-09-24 (with A-59) |
| A-53 | a reconnected socket never re-joins its board rooms: live updates stop, silently | medium | 1 | TODO |
| A-54 | no Socket.IO adapter — a second replica splits the fan-out | medium | 2 | TODO |
| A-55 | `createTwoTenants()` does not exist. `CLAUDE.md` and eight documents cite it as the fixture that makes the 404 test one line | medium | 0 | **corrected** 2026-09-23 |
| A-56 | search swallows every query error into an empty list | low | 1 | TODO |
| A-57 | the **public** verification endpoint returns the PDF path of a `draft` certificate | **high** | 0 | **DONE** 2026-09-24 |
| A-58 | five workflow routes gate on `"workflow"`; the slug is `"workflows"` — they deny everyone but SUPERADMIN | **high** | 0 | **DONE** 2026-09-24 |
| A-59 | the **email activation token** and the MFA-pending token are full bearer access tokens; SSO tokens cannot be revoked | **high** | 0 | **DONE** 2026-09-24 — sid-less tokens still accepted until the switch is flipped |
| A-60 | SSO tokens travel in the redirect URL; `/auth/sso-session` stores any posted token unverified; login never checks `isEmailVerified` | **high** | 0 | **PARTIAL** 2026-09-24 — items 1 and 2 done; item 3 is Q-11 |
| A-61 | **every e-signature signing and revocation failed its audit insert** — out-of-ENUM actions, non-existent columns — after the signature had committed | **critical** | 0 | **DONE** 2026-09-24 |
| A-62 | `approveCertificate` takes `approvedBy` from the request body, so the recorded approver can differ from the caller | **high** | 0 | **DONE** 2026-09-24 |
| A-63 | **any authenticated user can edit — or suspend — any tenant**: the `checkSelf` bypass trusts a body `userId` and returns before the tenant check | **critical** | 0 | **DONE** 2026-09-24 — not yet verified on a running server |
| A-64 | `PUT /certificates/:id` accepts `status: "approved"` / `"signed"`, bypassing re-authentication and the e-signature | **critical** | 0 | **DONE** 2026-09-24 |
| A-65 | `signDocument` never checks the signer is the step's signer, does no re-authentication, and takes the Part 11 IP and user agent from the body | **high** | 0 | **DONE** 2026-09-24 — see ADR-047 |
| A-66 | the QMS routes have no permission gate and write no audit row | **high** | 0 | **DONE** 2026-09-24 |
| A-73 | NC and CAPA numbers are `count()+1` — concurrent creates collide, and nothing enforces per-tenant uniqueness | medium | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18 |
| A-74 | `POST /qms/nc` and `/qms/capa` have no validator — bad input is a 500 | medium | 0 | **DONE** 2026-09-24 |
| A-75 | `createNC`/`createCapa` store a `deviceId`/`assignedTo` from another tenant unchecked; their list includes lack `required: false` | **high** | 0 | **DONE** 2026-09-24 — verified on PostgreSQL 18 |
| A-76 | a tenant admin can probably **create tenants, list every hospital, and delete their own tenant** — the `Management` slug gates platform operations | **critical** | 0 | TODO |
| A-77 | user edits (`/users/edit`, profile) write no audit row | **high** | 0 | TODO |
| A-78 | `checkTenant` cannot see a multipart `tenantId` on any route where `upload()` runs after the gate | **high** | 0 | TODO |
| A-79 | tenant edit leaves the uploaded logo on a refused request, and deletes the old logo before commit | low | 0 | TODO |
| A-80 | the profile slug is `profile` in `ROLE_MENU_ASSIGNMENTS` and `profile-page` in the seed | medium | 0 | TODO |
| A-81 | `/auth/mfa/login` has no rate limit — the TOTP is brute-forceable inside the 5-minute MFA token | **high** | 0 | TODO |
| A-82 | impersonation creates a session with no audit row | **high** | 0 | TODO |
| A-83 | login does not check tenant status; `loginMfa` ignores `lockedUntil`; SSO exchange does not re-check user status at redemption | medium | 0 | TODO |
| A-84 | `POST /esignature/sign` has no `dynamicAccess` gate | medium | 0 | **DONE** 2026-09-24 |
| A-85 | a non-pending signature step and a `PUT` on a signed or revoked certificate answer 400 where the rule is 409 | low | 0 | **DONE** 2026-09-24 — three more are A-92 |
| A-86 | external (email-only) signers have no way to sign — a workflow naming one can never complete | medium | 0 | TODO |
| A-87 | **the global tenant hooks never filter an include** — every include of a tenant-scoped model can reach other tenants' rows; and an include of a `defaultScope`d model is an INNER JOIN even without a `where` | **critical** | 0 | **DONE** 2026-09-24 (mechanism, ADR-048) — implicit-INNER call sites are A-90 |
| A-88 | several associations declare `foreignKey: "tenant_id"` (the column), adding a second, **nullable** `tenant_id` attribute with `ON DELETE SET NULL` on synced databases | **high** | 0 | **BLOCKED** — owner decision Q-16 |
| A-89 | the QMS form sends `description` / `actionPlan` as optional; both are NOT NULL, so creation now gets a 400 (it used to be a 500) | low | 0 | TODO |
| A-90 | ~20 implicit-INNER includes (`defaultScope`) silently drop rows — and since A-87, also rows that reference a super-admin identity | **high** | 0 | TODO |
| A-91 | **most signers cannot reach the signing UI** — the page loads workflows through routes gated on `qms:read` | **high** | 0 | TODO |
| A-92 | more state conflicts answering 400 (workflow update and cancel, deleting a signed certificate) and in-tenant unique violations answering 500 (device serial on update, re-creating a soft-deleted serial) | medium | 0 | TODO |
| A-67 | the rate limiter's failure recording on login, register, OTP and reset **never runs** — it is mounted before the handler | **high** | 0 | **PARTIAL** 2026-09-24 — recording fixed; per-IP counting off until A-16 |
| A-68 | OIDC has no `state`, `nonce` or PKCE check — login CSRF and code injection | **high** | 0 | TODO |
| A-69 | SSO through the Next `/api` proxy cannot work: the proxy follows the backend's 302 server-side | **high** | 0 | TODO |
| A-70 | SSO provisioning signs in a suspended or inactive user (a session and a LOGIN row are created) | medium | 0 | **DONE** 2026-09-24 |
| A-71 | the login response returns the access token to browser JavaScript, beside the httpOnly cookie | medium | 0 | TODO |
| A-72 | password and MFA login write no `LOGIN` audit row | medium | 0 | **DONE** 2026-09-24 |

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
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | medium |
| **Evidence** | `utils/controllerWrapper.util.js#asyncHandler` (used by **44** controllers) calls `sendError(res, error.message, status, …)` **before** the central `errorHandler` can sanitise, then calls `next(error)` anyway, so the handler runs after headers are sent. Observed on production: `Cannot read properties of undefined (reading 'roleId')` returned verbatim. `dynamicAccess.middleware.js` returns `{ success: false, message: error.message }` with a 500 and no envelope. |
| **Spec refs** | `docs/ENGINEERING/06-ERROR-RESPONSE-STANDARDS.md` · `docs/API/00-API-STANDARDS.md` |

**Why:** a raw PostgreSQL message carries SQL and schema names; a raw Node message carries internals. `P0-12` claims "the error mapper forwards recognised types only" — true of the mapper, and bypassed by the wrapper in front of it.

**Definition of Done**
- [ ] `asyncHandler` forwards to `next(error)` only; the central handler alone writes error responses
- [ ] non-`AppError` errors return a generic message with the request id in production
- [ ] `dynamicAccess` errors go through the same path
- [ ] a test throws a raw `Error("SELECT secret FROM …")` in a wrapped controller and asserts the text does not appear in the production response

**What was changed (2026-09-24) — the `dynamicAccess` half only.** Its catch now does
`return next(error)`, so an internal error reaches the client only through the global handler, which
sanitises it. This could not land alone, and the earlier attempt was reverted because of that:
`search.controller.js` probes `dynamicAccess` and treated **any** call to `next` as "allowed", so
forwarding an error would have made search fail **open** — the menus a caller cannot read would have
been searched whenever the permission lookup failed. The probe is now `(err) => resolve(!err)`, and
both changes land together. Tests: `dynamicAccess.test.js` › *"A-13: an internal error reaches the
client only through the global error handler"*; `search.permissions.a04.test.js` has the
lookup-failure case, which now denies.

**Still open:** `asyncHandler` in `controllerWrapper.util.js`, which is used by 44 controllers and
writes `error.message` itself before the central handler can run. That is the larger half, and the
boxes above stay unticked until it is done.

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

**What was changed (2026-09-23)**

`package-lock.json` is committed, `make install` is now `npm ci`, and every `Makefile` target uses
one package manager instead of two. `pnpm-lock.yaml`, `bun.lock` and nested workspace lockfiles
stay ignored — a lockfile inside `backend/` produces a different tree from the hoisted root one,
and a stale one dated 2026-07-28 was sitting there.

**npm was chosen on evidence rather than preference:** the committed tree is the one **6,128 tests
and the lint gate are actually proven against**. Nothing in this repository has ever been verified
under pnpm's non-hoisted layout, and this is a codebase with a packaged binary build, Puppeteer and
native dependencies — the set most sensitive to it. The pnpm question is not closed, it is
sequenced: it belongs with P7-01, where CI can prove it.

**This finding had already cost a gate.** A-34 — ESLint crashing before it linted a file — was a
floating-tree defect: the backend asked for `eslint ^10`, the root pinned `9.22.0`, and hoisting
produced a combination where the recommended config enabled a rule the installed core did not have.
That is what "no lockfile" costs, and it is why this is a Phase 0 card rather than a Wave 2 one.

**Still open, deliberately:** `pnpm-workspace.yaml` remains and now contradicts ADR-044. Removing it
is a one-line change that reviews better on its own — Open Question in `BACKLOG.md`.


---

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
| **Status** | **PARTIAL** 2026-09-24 |
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

**What was changed (2026-09-24) — the minimal fix.** Every failure of `Users.create` in SCIM
`createUser` now answers one fixed `500 "The user could not be provisioned"`. A unique violation
against another tenant's row is **byte-identical** to a lost connection. The reason is logged without
the address. A duplicate inside the caller's own tenant still answers 409, which discloses nothing the
caller cannot list.

**Test:** `scim.crossTenantOracle.a37.test.js` › *"SCIM create for an email that exists in another
tenant is indistinguishable from a fresh email whose insert fails for any other reason"*. 4 of its 6
tests failed against the old code, which answered *"Validation error"* with a
`SequelizeUniqueConstraintError` stack.

**What this does not close:** an address that fails on every attempt is still a statistical hint,
and timing is not addressed. Only per-tenant uniqueness removes the oracle — D-06, owner question
**Q-18**.

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
| **Status** | **DONE** 2026-09-24 — for the covered set |
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
- [x] a rolled-back mutation leaves **no** audit row (test with a forced rollback)
- [x] a failing audit insert rolls the mutation back
- [x] the list of mutations covered is written down, not implied

**What was changed (2026-09-24).** The spec came first:
[`MEMORY/specs/A-41-audit-inside-transaction.md`](../MEMORY/specs/A-41-audit-inside-transaction.md).
It names **25 mutations**, and each now writes its row through
`auditService.logAction(entry, { transaction })` in the same transaction as the change:

- **certificates:** create, update, delete, submit, approve, sign, revoke. For approve, sign and
  revoke, the `ESignatureRecord` is in the transaction too.
- **calibration records:** create, update, delete. The create includes the device's
  `nextCalibrationDate`.
- **e-signatures:** sign and revoke.
- **attachment delete, SOP publish and tenant restore:** these were already transactional and are
  now on the same call.
- **roles:** all seven role and menu operations.
- **user permission overrides:** set and remove.
- **the retention purge** — W-04.

Operations with no action value of their own (revoke, sign, submit, restore, purge) are recorded
under the nearest one, with `changes.operation` naming them. The action list now lives in one place,
`constants/auditActions.js`. Cache invalidation happens **after** commit.

**Found while fixing — A-61.**

**Tests.** They run against `tests/fixtures/auditLedger.js`, a transactional ledger that reads the
**real** ENUM and NOT NULL columns from `auditLog.model.js`. It rolls back on `COMMIT` of an aborted
transaction, as PostgreSQL does. The tests are `certificate.audit.a41.test.js`,
`calibrationRecords.audit.a41.test.js`, `esignature.audit.a41.test.js` and
`roles.audit.a41.test.js`. Of their 81 tests, **58 failed against the old code**.

**Not covered:**
- **Still best-effort through the middleware:** user create, update and delete.
- **Still writing no audit row at all:** menu groups, e-signature key pairs, workflows, SOP create
  and update, training acknowledgement.
- **Written outside the transaction:** GDPR erasure and rectification.
- **Open questions:** Q-12 to Q-14.

---

### A-42 — A failed audit write is announced only to stdout, which production discards

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
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

**What was changed (2026-09-24).** `logAction` reports a failed write through winston at `error`,
with the tenant, user, action, resource and stack, and `console.error` is gone.

- **Inside a transaction,** the failure is **re-thrown**, so the mutation rolls back and the client
  gets an error.
- **Outside a transaction** (the after-response middleware), it is logged and returns `null`,
  because the change has already committed.
- **An out-of-ENUM action** is refused before the insert.

Tests: `audit.service.a42.test.js`. 4 of its tests failed against the old code, including *"inside a
transaction, a failed write is re-thrown"* and *"out-of-ENUM action (RESTORE) is refused"*.

**Still open:** the sweep of the other 24 `console.*` call sites.

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
| **Status** | **DONE** 2026-09-24 |
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

**What was changed (2026-09-24) — and this card's own fix direction was wrong.** It said *"the token
already carries enough to find it"*. It did not: the access token was `{id, email}`, with **no
session identifier**, and the session row held only the hash of the opaque refresh token. Nothing
connected the two, so revocation could not have been checked however it was cached.

Access tokens now carry `sid`. Login, MFA login, refresh and impersonation create the session
**first** and sign its id into the token. On each request the middleware checks that session is live
through `session.service.isSessionLive`, which reads Redis and falls back to one primary-key read,
filtering on the **snake_case** `is_revoked` and `is_active` columns. Revocation deletes the cache
entry — through model hooks, so the admin path in `session.controller.js`, which updates the model
directly, is covered too. A refresh revokes the previous session, so the old access token dies on its
next request. An impersonation token is now bounded by its session's one-hour expiry instead of the
full day.

**Redis down:** every request reads the database and revocation is **still enforced**. It does not
fail closed — a Redis outage should not sign every user out.

**Logout had never worked server-side**, found while fixing this. `auth.controller.logout` called
`authService.logoutSession()` with **no argument**, so it threw a TypeError and returned a 500 — which
the frontend's logout route swallowed. And even given a request, it hashed the **access** token and
compared it with **refresh**-token hashes, which matches no row. So every logout in this system's
history revoked nothing.

**Proof** — `auth.sessionRevocation.a48.test.js` runs the real middleware, service, JWT signing and
the Session model through Sequelize's PostgreSQL SQL generation, against a fake table with
hardcoded snake_case columns that **rejects unknown columns the way PostgreSQL does** — so a
camelCase slip fails the test instead of passing it. 29 tests failed against the old code. Named:
*"a revoked session's access token is rejected on the next request"*, *"a logged-out user's token
stops working"*, *"Redis down: every request reads the database, and revocation is still enforced"*.

**The suspended-tenant item was already covered** and is unchanged: the user and tenant are read from
the database on every request with no cache, and a suspended tenant is refused.

**Not closed — A-59:** tokens without a `sid` are still accepted, for compatibility with tokens
issued before the deploy. That leaves every SSO token unrevocable (`sso.controller.js` signs
`{id, email}` and discards the session) and the activation-token hole below.


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
| **Status** | **DONE** 2026-09-24 |
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

**What was changed (2026-09-24).** `validators/webhook.validator.js` mounts on every webhook route,
and a `secret` key in the body is **stripped** (the validator runs with `stripUnknown: true`), so
a caller can no longer choose the key. The
secret is generated server-side, returned exactly once, and stored through `kms.service.js`.
Migration `0022-encrypt-webhook-secrets` re-encrypts the existing plaintext rows, and it fails loudly
rather than being skipped. `POST /webhooks/:id/rotate-secret` issues a new secret. **Changing the
`url` now rotates the secret too**, because a new host must not be signed with a key the old host
still holds. Tests: `webhook.validator.test.js`; `webhook.service.test.js` › *"creates a webhook and
returns the server-generated secret"*, *"updates webhook parameters (a url change also rotates the
secret)"*.

**Not done:** there is no overlap window, so receivers must switch to the new secret at the moment
of rotation. The frontend `WebhookModal` does not yet show a rotated secret or offer a rotate button
(**F-18** on the frontend board).

---

### A-52 — The socket token's `purpose` claim is read nowhere

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — fixed under A-59 |
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
| **Status** | **DONE** 2026-09-24 |
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

**What was changed (2026-09-24)** — ADR-042 steps 1 and 2, `certificatePdf.service.js`, 41 tests, 100 %.

The public verification endpoint returns `documentUrl` **only for a `signed` certificate**. A `draft`
returns `null`; so does a **revoked** one — the decision recorded in a comment at
`verifyByCertificateNumber` is that the PDF on disk is the unwatermarked signed version, so
publishing it would present a revoked certificate as valid, while `status`, `revoked` and `valid`
already say it was revoked. Expired certificates still return their document.

The certificate filename is no longer the sequential certificate number: it is a random UUID, so
enumeration no longer works. **The half-finished version of this fix could never have passed** — it
used the `uuid` package, and the Jest setup replaces that package with a constant
(`__mocks__/uuid.js`), so "two filenames differ" was unsatisfiable. It now uses
`crypto.randomUUID()`. Against the pre-fix service, 13 tests fail.

### A-58 — Five workflow routes gate on a slug that does not exist

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
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

**What was changed (2026-09-24)** — the typo and, more importantly, the check that makes the next one loud.

All five gates in `workflows.route.js` now read `workflows`. `workflows.access.a58.test.js` (17 tests)
drives the **real** `dynamicAccess` against the matrix built from `ROLE_MENU_ASSIGNMENTS`: both admin
roles reach all five routes, ENGINEERING MANAGER gets reads only, a role without the grant gets 403.
With the typo restored, **12 of 17 fail**.

**The boot assertion (ADR-043 step 5) is wired into `backend/index.js`, in two phases**:

| Phase | Runs | Refuses to start when |
|---|---|---|
| 1 | **before** the database connection — it reads route source and constants only, so it cannot fail for a database reason | a `dynamicAccess` name matches no seeded menu name or slug, or a `ROLE_NAMES` key has no `ROLE_LEVELS` entry |
| 2 | **after** `db.sync()` and migrations, so migration 0020 has already backfilled levels | a seeded role's `role_level` disagrees with `ROLE_LEVELS` |

If phase 2 **cannot** run — the query throws, or nothing is seeded yet — it warns and boot continues,
because refusing there would make the seeding endpoint unreachable and deadlock a fresh install. Only a
check that ran **and found a disagreement** refuses. That distinction is recorded in the code.

**Both phases were watched failing**, against a throwaway PostgreSQL with seeded data:

```
[error]: AUTHZ_WIRING_FAILURE: refusing to start — 5 authorization wiring defect(s):
  - src/routes/api/workflows.route.js:149 dynamicAccess("workflow", …) matches no seeded menu
    group name or slug — the gate grants nobody but SUPERADMIN, silently (A-58)
  …
```

and, with `HEALTHCARE ADMIN` set to `role_level = 1`, boot exits on
`roles."HEALTHCARE ADMIN".role_level is 1, ROLE_LEVELS.HEALTCARE_ADMIN is 8`. Restored, it boots and
logs `133 dynamicAccess gate(s), 12 role name(s)` and `roles table agrees with ROLE_LEVELS for 11
seeded role(s)` — a silent pass is indistinguishable from a check that never ran, so it says so.

**What the scan surfaced, left unchanged by decision:** `"AuditLogs"` and `"Finance"` match nothing,
but each sits in an OR gate that still resolves through another name, so they warn rather than
refuse. `search.route.js` passes a computed list and cannot be checked statically; resolved by hand,
all three are seeded.

**Known limits, stated in the code:** under a packaged binary (`pkg` bytecode or `bun --compile`)
the source scan cannot run, so phase 1 **only warns** — a packaged deploy runs with the gate check
off, said loudly in the log. The check validates against the seed file, not the live `menu_groups`
table. Two workflow routes (`GET /instances/pending`, `POST /instances/:instanceId/action`) carry
`auth` alone — the P6-04 class, unchanged here.

---

### A-59 — Tokens that are not access tokens are accepted as access tokens

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, while fixing A-48 |

`auth.service.js:123` mints the account-activation token — the one sent **by email** — with
`generateAccessToken({ id: user.id })`. Since A-31, `generateAccessToken` stamps `typ: "access"`. So
the activation link carries a token **indistinguishable from a real access token**: the `auth`
middleware accepts it as a bearer, for the full `JWT_ACCESS_EXPIRED` — a day on the running
deployment. Activation emails are forwarded, archived and logged. `:241` does the same for the
MFA-pending token, which exists precisely to represent a login that is **not yet** authenticated.

Neither carries a `sid`, so A-48's revocation check does not apply to them — tokens without `sid` are
still accepted, for compatibility with tokens issued before that change. The same compatibility gap
leaves **every SSO token unrevocable**: `sso.controller.js:65` and `:175` sign `{id, email}` and
discard the session they could have bound to.

The machinery to fix this already exists: A-31 introduced the `typ` claim and `assertTokenType`.

**Fix direction:** mint the activation token as `typ: "activation"` and the MFA token as
`typ: "mfa"`, and accept each only on the one route that consumes it; give SSO tokens a `sid`; then,
once every issuer sets one, refuse an access token with no `sid`.

**Definition of Done**
- [x] an activation token presented as a bearer to an ordinary route is rejected, by a named test
- [x] an MFA-pending token is accepted only by the MFA completion route
- [x] an SSO token is revocable
- [ ] an access token without `sid` is refused — and the change is announced, because it signs out every session issued before it

**What was changed (2026-09-24).** `jwt.util.js` gained `generatePurposeToken` and
`verifyPurposeToken`, built on the same `typ` machinery A-31 introduced. They sign with the same key
registry, and each accepts **only** its own purpose; a token with no `typ` is refused. The
activation token is now `typ: "activation"`, 24h. The MFA-pending token is `typ: "mfa"`, 5 minutes,
and is issued **before** any session exists. Previously `loginUser` created a live session and
access token for an MFA account and then discarded them. The socket token is `typ: "socket"`, which
also closes **A-52**: it goes through the registry instead of `process.env`, and the handshake
accepts only a socket token and checks that its session is live. `verifyAccessToken` already
refused any `typ` other than `access`, so all three are refused as bearers. Both SSO callbacks now
create the session first and sign `sid`, the same order login uses.

**Every access-token issuer now sets `sid`.** `auth.middleware.js` exports
`SIDLESS_ACCESS_TOKENS_ACCEPTED = true`. Setting it to `false` is safe once one
`JWT_ACCESS_EXPIRED` has passed since the deploy, which is 1 day on the VM. After that, no valid
sid-less token remains, so the switch signs nobody out.

**Behaviour at deploy:** activation links emailed before it are refused with a 400. There is no
resend endpoint, and `loginUser` never checks `isEmailVerified`, so activation gates nothing today
(**A-60**).

**Tests.** Nine tests failed against the old code; all pass now. They are in
`auth.tokenPurpose.a59.test.js` and `jwt.purpose.a59.test.js`:
- *"an activation token presented as a bearer is rejected"*
- *"an MFA-pending token is accepted only by MFA completion"*
- *"a socket token presented as a bearer is rejected"*
- *"an SSO-issued token is revoked when its session is revoked (saml)"*, and the same for *(oidc)*
- *"logging out of an SSO session stops its token"*

Full backend suite: 331 suites, 6,586 tests.

---

### A-60 — The SSO hand-off, and an activation step that gates nothing

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 — items 1 and 2 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, while fixing A-59 |

1. **Tokens in the URL.** Both SSO callbacks redirect to `/sso-callback?token=…&refreshToken=…`,
   which puts an access token and a refresh token into proxy logs, browser history and `Referer`
   headers. The frontend page then posts only `token` to `/api/v1/auth/sso-session`, so the refresh
   token and the session behind it are dropped.
2. **`/api/v1/auth/sso-session` stores whatever it is given.** It writes the posted token into the
   httpOnly auth cookie **without verifying it** — the shape of a session-fixation endpoint. The JSON
   content type and `SameSite=Lax` limit how it can be reached; they do not make it correct.
3. **Activation gates nothing.** `loginUser` never checks `isEmailVerified`, so an account logs in
   whether or not the emailed link was ever used. There is also no endpoint to resend it.

**Fix direction:** a one-time code in the redirect, exchanged server-to-server for the tokens; verify
before setting the cookie; decide — owner question — whether unverified accounts may log in.

**Definition of Done**
- [x] no token appears in any redirect URL
- [x] `sso-session` refuses a token that does not verify, by a named test
- [ ] the email-verification policy is decided and enforced, or explicitly recorded as not required

**What was changed (2026-09-24) — items 1 and 2.**

Both callbacks now redirect to `/sso-callback?code=<43-char base64url>`. What is stored under
`sso:handoff:<sha256(code)>` for 60 seconds is the **verified identity** — never tokens.
`POST /api/v1/auth/sso/exchange` redeems it:

- **Single use:** it reads with Redis `GETDEL`, so a code works once even across replicas. If Redis
  is down, it falls back to process memory with the same TTL and single use. That fallback is correct
  on one replica, and on several it refuses an exchange that lands on another process — it never
  admits an unknown code.
- **Session and audit:** it creates the session and writes a `LOGIN` audit row in one transaction,
  then answers in `/auth/login`'s shape.
- **Refusals:** an unknown, expired or used code gets one 401. There is an IP lockout at 30 failures
  in 5 minutes.

The frontend's `sso-session` route accepts only `{code}`. It exchanges the code server-to-server and
sets exactly the cookies login sets; a posted raw token gets a 400 and no cookie. The callback page
removes the code from history and cannot spend it twice under React's double effects.

**Tests.** Backend: `sso.controller.test.js` › *"A-60: the SSO hand-off"*, which includes
*"no token appears in the SSO redirect URL (saml)"* and *"(oidc)"*, *"a one-time code can be
exchanged once only"* and *"an expired or unknown code is refused"*; and
`auth.ssoExchange.a60.test.js`. Frontend: `sso-session/route.test.ts` › *"sso-session refuses a
posted raw token"*. Full suites: backend 336 suites and 6,667 tests at 100 %; frontend 77 suites and
733 tests.

**At deploy:** both halves must ship together. SSO sign-ins in flight at that moment fail once.

**Still open:** item 3, which is the owner's decision (Q-11). Also A-69: **SSO has probably never
worked through the Next `/api` proxy on this deployment**, and this change does not fix that.

---

### A-61 — Every e-signature was committed without its audit row, and returned a 500

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical** — a 21 CFR Part 11 signature with no audit trail |
| **Verified** | against the real schema by the A-41 ledger fixture, 2026-09-24 |

`eSignature.service#signDocument` and `#revokeSignature` wrote an audit row with action
`"DOCUMENT_SIGNED"` / `"SIGNATURE_REVOKED"`, and neither value is in the `audit_logs` ENUM. The row
also named columns that do not exist (`entityType`, `entityId`, `before`, `after`) and omitted
`resourceType`, which is NOT NULL. With no transaction, the `SignatureRecord` and the workflow step
had **already committed** when the insert threw. The signer got a 500, the signature stood, and
`audit_logs` never recorded it — on every call.

`esignature.signing.test.js` asserted `"DOCUMENT_SIGNED"` against a mock that accepted any value, so
it passed. That is the fifth instance this month of a mock inventing the contract, and the second
inside a single ENUM (S-02's `"RESTORE"` was the first).

**Fixed under A-41:** both are transactional, write valid rows, and send email only after commit.
Test: `esignature.audit.a41.test.js` — 6 of 8 failed against the old code, the sign path with
*"Failed to sign document"*.

---

### A-62 — The approver of a certificate is whoever the request body says

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-41 |

`certificate.controller#approveCertificate` reads `approvedBy` from `req.body`. The re-authentication
step checks **that** user's credentials, so a caller who knows another approver's password can
record the approval in that person's name. It also means the audit row and the certificate can
name different people for the same act.

**Fix direction:** the approver is `req.user.id`, always; re-authentication checks the caller's own
credentials; a body `approvedBy` is stripped by the validator.

**Definition of Done**
- [x] a body `approvedBy` naming another user has no effect, by a named test
- [x] the certificate's approver and the audit row's `userId` are the same id

**What was changed (2026-09-24).** `approveCertificate` passes `req.user.id` and nothing else, and
the service re-authenticates, stamps, signs and audits that one id. `approvedBy` is removed from the
approve schema **and from the update schema** — a plain `PUT` could name anyone as approver with no
re-authentication at all. The approve route now mounts `validate(approveCertificateSchema)`. QMS CAPA
approval had the same shape (`qms.service#updateCapa` copied a body `approvedBy`), so it now records
the caller.

Test: `certificates.approve.a62.test.js`, which drives the real route, validator, controller and
service against the audit ledger. It includes *"a body approvedBy naming another user has no
effect"*, *"re-authentication checks the caller's own credentials"* and *"the certificate's approver
and the audit row's userId are the same id"*. 4 of its 5 tests failed against the old code.

**Found while fixing:** A-63, A-64, A-65 and A-66.

---

### A-63 — Any authenticated user can edit, or suspend, any tenant

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — server check open |
| **Severity** | **critical** — cross-tenant write |
| **Verified** | from code, 2026-09-24. Not yet exercised against a running server |

`PATCH /api/v1/tenants/edit` (`tenant.route.js`) is gated by
`dynamicAccess("Management", "update", { checkSelf: true, checkTenant: true })`. In
`dynamicAccess.middleware.js`, the self-service bypass runs **first**. It takes the owner id from
`req.params.userId || req.body.userId || …`, and if that equals the caller's id it calls `next()`.
**The tenant-isolation check below it never runs.**

JSON bodies are parsed globally, so a caller sends:

```json
{ "userId": "<their own id>", "tenantId": "<any tenant>", "status": "suspended", "maxUsers": 1 }
```

The controller merges params and body, and `tenantService.updateTenant` loads the tenant with
`findByPk(tenantId)` — `tenants` is not itself tenant-scoped — then applies name, status, `maxUsers`
and the rest. Any user holding any token can rename, re-brand or **suspend another hospital**. Within
their own tenant, the same request lets an ordinary user change the tenant's own plan limits and
status.

`checkSelf` is meaningless on this route: a tenant is not a user's own resource. The deeper defect
is that the bypass trusts a **body** field to establish ownership, and that it short-circuits every
check that follows.

**Fix direction:** remove `checkSelf` from the tenant route. In the middleware, derive ownership only
from the path, never the body or query, and never let the self bypass skip the tenant check.
`/users/edit` relies on the body `userId`, so it must move to the authenticated id. Add the two-tenant
404 test CLAUDE.md requires.

**Definition of Done**
- [x] a user of tenant A sending tenant B's id with their own `userId` gets 404, and tenant B is unchanged
- [x] an ordinary user cannot change their own tenant's `status` or `maxUsers`
- [x] the self bypass reads no body or query field, by a named test
- [ ] verified against the running server

**What was changed (2026-09-24).**

`dynamicAccess`'s self bypass now runs **after** the tenant check, and takes ownership from the
path only (`selfOwnerIdFromPath`: `:userId` or `:id`). `abac` gets the same rule.

`checkSelf` is removed from `PATCH /tenants/edit` and from `PATCH /users/edit`, which now needs
`users` update access. Self-service moves to a new route, `PATCH /users/:userId/profile`:
- username and names only;
- the path wins over the body;
- the frontend's `updateProfile` calls it.

**The gate cannot be the real control on the tenant edit.** The frontend sends multipart, and
multer parses the body after the gate — so `checkTenant` never sees the `tenantId` (A-78). So
`tenantService.updateTenant` enforces it:
- a non-super-admin may update only their own tenant;
- any other id is a 404 identical to a missing tenant;
- only a super admin may change `status` or `maxUsers`. Suspending your own tenant locks you out,
  and `maxUsers` is the seat limit.

`updateTenant` now writes its audit row inside the transaction. It wrote none before.

**`createTwoTenants()` now exists:** `tests/fixtures/twoTenants.js`. `CLAUDE.md` is corrected.

**Tests:**
- `tenant.edit.a63.test.js`, including *"a user of tenant A sending tenant B's id with their own
  userId gets 404, and tenant B is unchanged"* and *"an ordinary user cannot change their own
  tenant's status or maxUsers"*.
- `user.profile.a63.test.js`.
- `dynamicAccess.test.js` › *"the self bypass reads no body or query field"*.

**Fail-before:** 16 of these tests failed against `HEAD`. Against the old code, the cross-tenant
edit returned **200**.

**Still open:** verification against a running server.

**Found while fixing:** A-76 to A-80.

---

### A-64 — A certificate can be approved or signed by editing its status

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical** — a 21 CFR Part 11 bypass |
| **Verified** | from code, 2026-09-24, during A-62 |

`updateCertificateSchema.status` accepts `approved` and `signed`. A `PUT /certificates/:id` therefore
moves a certificate into an approved or signed state with no re-authentication, no e-signature
record and — since A-62 — no approver. The state machine exists in the model
(`submitForApproval`, `approve`, `sign`, `revoke`), and `update` walks around it.

**Fix direction:** `status` is not updatable through `PUT`. Transitions happen only through their
routes, and an invalid one is a 409 with a state explanation.

**Definition of Done**
- [x] a `PUT` carrying `status` does not change the status, by a named test
- [x] every transition goes through its route and writes its audit row

**What was changed (2026-09-24).** A `PUT` that tries to change `status` is a **409** that explains the
state, for example: *This certificate is in "draft" and editing it cannot change its status. Submit it
for approval with POST /certificates/:id/submit.* The request is refused rather than the field
stripped, because stripping would silently discard what the client meant.

- Repeating the **current** status is not a transition: it is dropped and the rest of the edit
  applies.
- Not-found runs first, so another tenant's certificate is still a 404.
- The audit row's `after` never carries `status`.
- No frontend code used `PUT` to change status.

**Test:** `certificate.statusLock.a64.test.js` › *"a PUT carrying status does not change the status"*,
across 7 transitions. Every one of them failed against the old code.

---

### A-65 — Anyone in the tenant can sign someone else's step

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-62 |

`eSignature.service#signDocument` does three things wrong:

- It never checks that `step.signerId === userId`, so any user in the tenant can complete another
  signer's pending step.
- Its "re-authentication" checks only that the user is active.
- It takes the Part 11 `ipAddress` and `userAgent` from the request body, and uses the connection's
  values only as a fallback.

A signature is supposed to be attributable, intentional and non-repudiable. As built, it is none of
the three.

**Definition of Done**
- [x] a user who is not the step's signer gets 403 inside their own tenant, by a named test
- [x] signing requires the signer's password (or MFA code), the way certificate approval does
- [x] the IP address and user agent come from the connection only

**What was changed (2026-09-24).**

- **Signer check.** A caller who is not `step.signerId` gets **403**. The check runs before the
  pending check, so a non-signer learns nothing about the step. Another tenant's step is still a 404.
- **Real re-authentication.** The credential check was extracted from certificate approval as
  `verifySignerCredentials` in `certificate.service.js`. Certificate approve, sign and revoke and
  workflow signing all use it. `REQUIRE_REAUTHENTICATION` no longer switches it off — **ADR-047**.
- **The IP address and user agent** come from the connection only.
- **Validator.** `authPayload` is required, and the method is `password` or `mfa`. `webauthn` and
  `totp` are refused, because nothing can verify them at signing time. `reason` is now accepted: the
  service signed over it, but the validator had been dropping it.
- **Frontend.** The e-signature page shows *Sign* only on the caller's own step, with a password or
  MFA form. Its types now match the real response: steps carry `signerId`, not `userId`.

**Tests.** `esignature.signer.a65.test.js` › *"a user who is not the step's signer gets 403"*,
*"signing requires the signer's password"* and *"the IP address and user agent come from the
connection only"*. 11 of the file's 13 tests failed against the old code. There is also a new
frontend page test, whose 4 tests all failed against the old page.

**Consequence:** a step whose signer is external (email only, no `signerId`) can no longer be signed
by anyone. No route has ever existed for external signers (A-86).

---

### A-66 — QMS has no permission gate and no audit trail

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-62 |

`qms.route.js` mounts `auth` and `denyApiKey`, and no `dynamicAccess`. Any authenticated user in a
tenant can create, change and approve CAPAs and quality records, and none of it writes an audit row.
CLAUDE.md names a missing permission gate as the single most likely authorization defect in the
codebase — this is one, on a quality-management surface. `frontend qmsService.approveCapa` also sends
`status: "APPROVED"`, which the backend enum does not contain; nothing calls it today.

**Definition of Done**
- [x] every QMS route has a `dynamicAccess` gate whose slug is seeded (the A-58 boot assertion checks it)
- [x] QMS mutations write audit rows inside their transactions

**What was changed (2026-09-24).** All six QMS routes are gated on the `qms` slug:

- reads need `read`;
- creates and updates need `write`.

The slug was already in `MENU_SLUGS`, the seed and the role assignments, so no migration was needed.

**Who has access now:**

| Role | Access |
|---|---|
| HEALTHCARE ADMIN, CALIBRATOR ADMIN | keep full access |
| ENGINEERING MANAGER | read only |
| every other seeded role | **loses QMS access it should never have had** |

**This is a visible behaviour change for technicians and users.**

`createNC`, `updateNC`, `createCapa` and `updateCapa` each run in one transaction with their audit
row: `CREATE`, `UPDATE` (changed fields only), or `APPROVE` for a CAPA approval.

**The QMS screen had been empty since it was built.** It read `data.nonConformances` and
`data.capas`, while the envelope puts rows in `data` — the CLAUDE.md trap, a fourth time. The
frontend now reads the envelope, and its status vocabularies match the backend enums. `approveCapa`
had been sending `"APPROVED"`, a value the validator rejects.

**Tests:**

- **`routeGuards.a66.test.js`** (44 tests), including *"every QMS route has a dynamicAccess gate
  whose slug is seeded"* and *"a user without QMS permission gets 403 in their own tenant"*.
- **`qms.audit.a66.test.js`** (22 tests), including *"a CAPA update writes its audit row in the
  transaction"* and *"a failing audit insert rolls the QMS change back"*.
- **Frontend `qms.service.test.ts`**, including *"lists NCs from the house envelope"*.

**Fail-before:** 41 backend and 9 frontend tests failed against the old code.

---

### A-67 — The login rate limiter records no failures

| | |
|---|---|
| **Status** | **PARTIAL** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-60 — not yet on a running server |

In `auth.route.js`, `authPostFailure` is mounted **before** the handler, while the response status is
still 200, so it never sees a failure. `authPostSuccess` is mounted after a handler that never calls
`next`, so it never runs. The limiter's lockouts on login, register, send-OTP and password reset are
therefore **no-ops**; only the database `failedLoginAttempts` counter locks anything, and that works
per account, not per source. Credential stuffing across many accounts is unthrottled by the layer
that exists to throttle it. The new `/sso/exchange` records its failures explicitly for this reason.

**Definition of Done**
- [ ] N failed logins from one IP lock that IP, by a test that drives the real router

**What was changed (2026-09-24).** The broken `authPostFailure` and `authPostSuccess` middlewares are
gone. The login, register, send-OTP and reset handlers record their own outcome through
`withAuthOutcome` and `noteAuthFailure`/`noteAuthSuccess`, following the A-60 `ssoExchange`
pattern:

- any 4xx except 429 counts as a failure, and a 5xx never does;
- a success clears only the per-user and per-token counters;
- each failure is logged at `warn` with its real reason.

**Per-IP counting ships switched OFF**, behind `AUTH_RATE_LIMIT_BY_IP=true`. This was decided by the
orchestrator after the fix agent's warning. Behind the Next proxy, `req.ip` is one shared hop for
every browser (A-16), so turning it on today would let **15 failed logins from anyone lock login for
everyone**, indefinitely. That is a worse defect than the one being fixed.

**Tests** are in `auth.rateLimit.a67.test.js`, which drives the real router:
- with the switch on: *"N failed logins from one IP lock that IP"* and the register, OTP and reset
  cases. These failed against the old code with 401 instead of 429;
- with it off: *"with AUTH_RATE_LIMIT_BY_IP unset, failures never lock the shared proxy address"*.

**To close:** fix A-16 so the backend sees the real client IP. `trust proxy` is 1 today, but the chain
has more hops than that: Cloudflare tunnel, nginx, then Next. The edge must overwrite
`X-Forwarded-For`, since the proxy passes the client's value through. Then set the switch on the VM.

---

### A-68 — OIDC has no `state`, `nonce` or PKCE check

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24, during A-60 |

`sso.service.js` generates a `state` and stores it nowhere. `oidcCallback` only splits it to recover
the tenant code, and no `nonce` or PKCE verifier exists. So the callback accepts any authorization
code with any `state` — login CSRF (the victim is signed into the attacker's account) and code
injection.

**Definition of Done**
- [ ] `state` is bound to the initiating browser and checked once; `nonce` is checked in the ID token; PKCE is used
- [ ] a callback with a forged `state` is refused, by a named test

---

### A-69 — SSO through the Next proxy follows the redirect on the server

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** — SSO likely does not work on this deployment at all |
| **Verified** | from code and the deployment notes, 2026-09-24. **Not observed** — no IdP is configured |

On this deployment `/api/` is served by the frontend (ADR-046). If an IdP's ACS or redirect URL
points at `https://<host>/api/v1/auth/sso/...`, the `[...path]` proxy's `fetch` follows the backend's
302 **on the server**, so the browser never receives `/sso-callback?code=…`. This predates A-60.

**Fix direction:** the proxy passes redirects through (`redirect: "manual"`), or the SSO callback
paths are routed to the backend directly in nginx. Decide which, and test with a real IdP.

---

### A-70 — SSO signs in a suspended user

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

`provisionUser` does not check `isActive` or `status`. A suspended user's SSO sign-in creates a
session and a `LOGIN` audit row. The auth middleware refuses the token on every request, so no data
is reached, but the audit trail records a login that should have been refused.

**What was changed (2026-09-24).**

- **The card was partly wrong:** `status` was already checked, and only `isActive` was missing.
  `provisionUser` now refuses both with a 403, so no code, session or `LOGIN` row is created.
- **Password login** now also refuses a user whose `status` is `INACTIVE` or `SUSPENDED`. Before, a
  user deprovisioned through SCIM could still sign in.
- **`loginMfa`** now checks status too; it checked nothing before.

**Test:** `sso.suspendedUser.a70.test.js` › *"a suspended user's SSO sign-in creates no session"*. It
returned a 302 with a code on the old code.

---

### A-71 — The login response hands the access token to JavaScript

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

The Next login route sets the httpOnly `auth_token` cookie **and** returns the access token in its
JSON body, and the generic proxy passes through any `token` field. The httpOnly cookie exists so
script cannot read the token; the response body gives it to script anyway. An XSS anywhere in the app
therefore yields a bearer token.

**Definition of Done**
- [ ] no response reaching the browser contains an access token

---

### A-72 — Password and MFA login write no audit row

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24, during A-60 |

Since A-60, SSO sign-in writes a `LOGIN` audit row. Password and MFA login write none, so *who
accessed the system, when* — basic Part 11 and ISO 27001 evidence — exists for SSO users only.

**What was changed (2026-09-24).** Password login and MFA login write a `LOGIN` / `Session` row, with
`changes.method` set to `password` or `password+totp`, in the same transaction that creates the
session. If the audit insert fails, the login fails.

**Failed logins write no audit row.** The ENUM has no `LOGIN_FAILED`, and an unknown username has no
tenant. They are logged at `warn`. Whether to add the ENUM value is **Q-15**.

**Tests:** `auth.loginAudit.a72.test.js` › *"a successful password login writes one LOGIN audit row"*
and *"an MFA login writes one LOGIN audit row"*. Each found 0 rows on the old code.

---

### A-73 — NC and CAPA numbers can collide

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-66) |

Numbers are `count() + 1`. Two concurrent creates read the same count and issue the same number, and
no per-tenant unique constraint stops it. A transaction does not serialise a `count()`. **Fix
direction:** a per-tenant sequence or a locked counter row, plus a composite unique on
`(tenant_id, number)`. The unique constraint must be per tenant, never global — a global one is an
existence oracle.

**What was changed (2026-09-24).**

**How a number is claimed.** One upsert, run inside the create's transaction:
`INSERT INTO qms_counters … ON CONFLICT (tenant_id, kind) DO UPDATE SET seq = GREATEST(seq + 1, …)
RETURNING seq`. It follows the existing `ticket_counters` pattern.
- The counter row stays locked until commit, so concurrent creates in one tenant queue.
- A rollback releases the number.
- The first value continues from the tenant's highest existing number.

**Migration `0024-qms-number-uniqueness`** creates `qms_counters` and **per-tenant** unique indexes
on `(tenant_id, nc_number)` and `(tenant_id, capa_number)`. If any tenant already has a duplicate, it
**refuses**, naming every one, rather than renumbering. These are ISO 13485 record identifiers, and
a migration should not rewrite them on its own authority. **Consequence:** migrations run at boot,
so a database holding duplicates refuses to boot until they are resolved by hand.

**Verified on real PostgreSQL 18:**
- **The defect:** the old logic issued `NC-00001` twice from two overlapping transactions.
- **The refusal:** the migration refused the duplicate and changed nothing.
- **After the fix:**
  - 25 concurrent NCs in each of two tenants came out distinct and gap-free, and 10 concurrent CAPAs
    did too;
  - a direct duplicate insert was refused with 23505;
  - `down`, `up`, `down` ran clean.

**Test:** `qms.numbering.a73.test.js` › *"two concurrent creates get distinct numbers"*. On the old
code both creates got `NC-00001`.

---

### A-74 — The QMS create routes have no validator

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-66) |

`POST /qms/nc` and `POST /qms/capa` mount no `validate(schema)`. An out-of-enum `severity` or a
missing `title` reaches the database and returns a 500, although Swagger documents a 400.

**What was changed (2026-09-24).** `createNCSchema` and `createCapaSchema` are mounted on the routes.
They validate the required NOT NULL fields and take their enums from `constants/qmsConstants.js`,
which the models also read. `tenantId` and `status` are stripped. `rootCause` is now stored — Swagger
documented it, and the service had been dropping it.

**Test:** `qms.tenancy.a75.test.js` › *"POST /nc with an invalid severity is a 400"*. On the old code
it returned 201.

---

### A-75 — QMS records can reference another tenant's device or user

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-66). The include behaviour is unverified |

`createNC` never checks that `deviceId` belongs to the caller's tenant, and `createCapa` never checks
`assignedTo`, so a foreign id is stored. `getNCs` and `getCapas` include `CalibrationDevice` and
`User` (as `assignee`) with no `required: false`. If the tenant hooks apply to the include, rows with
a foreign or deleted reference **vanish from the list** (the INNER JOIN trap). If they do not, another
tenant's device name or user **leaks**. Either is wrong.

**Definition of Done**
- [x] a foreign `deviceId` / `assignedTo` is refused with 404, by a two-tenant test
- [x] both includes are `required: false`, and a test shows no foreign attribute is returned

**What was changed (2026-09-24).**

- **Foreign references refused.** A foreign `deviceId` or `assignedTo` gets a 404 on create, and on
  `updateCapa`. The body is identical to the one for a missing id.
- **List includes.** Every include in the lists is `required: false` and carries an explicit
  `where: { tenantId }`.

**Verified on real PostgreSQL 18:**
- the lists return NCs that have no device, which the old INNER JOIN dropped;
- a reference to another tenant's device comes back as `device: null`.

**Tests:**
- `qms.tenancy.a75.test.js` › *"a foreign deviceId is refused with 404"* and *"a foreign assignedTo
  is refused with 404"*. Both returned 201 on the old code.
- `qms.includes.a75.test.js` › *"both QMS includes are required:false"*.

**What checking the includes uncovered is bigger than QMS — A-87.**

---

### A-76 — Tenant administrators hold platform operations

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **critical** — if confirmed |
| **Verified** | from code, 2026-09-24 (A-63). **Not exercised against a server** |

`POST /tenants/create`, `GET /tenants/all` and `DELETE /tenants/delete` are gated on the `Management`
slug. The seed gives `management` to both HEALTHCARE ADMIN and CALIBRATOR ADMIN, and Engineering
Manager holds `read`. `tenants` is not tenant-scoped. So, as read from the code:
- a hospital's own admin can create tenants;
- anyone with `Management` read can list every hospital on the platform;
- a tenant admin can delete their own tenant, since only `checkTenant` applies.

**Fix direction:** these are platform operations — `superAdminOnly`, like
`PATCH /admin/tenants/:id/status` already is.

**Definition of Done**
- [ ] a tenant admin gets 403 on create, list-all and delete, by a named test driving the real seed matrix
- [ ] verified against the running server

---

### A-77 — User edits are unaudited

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-63) |

`userService.editUser` writes no audit row, and `/users/edit` has no `recordAudit`. A change to a
user's role or status — an authorization change — leaves no attributable record. The new profile
route inherits the gap.

---

### A-78 — `checkTenant` is blind to multipart bodies

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-63) |

`dynamicAccess`'s `checkTenant` reads `req.body.tenantId`. On a route where `upload()` (multer) runs
**after** the gate, a multipart body has not been parsed yet, so the check sees nothing and passes.
Every such route must enforce tenant ownership in its service. Enumerate them, and either move the
check into the service or parse before the gate.

---

### A-79 — Tenant edit mishandles logo files

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-63) |

A refused edit (404, 403 or 409) leaves the uploaded logo on disk, which `createTenant` cleans up and
`updateTenant` does not. And the old logo is deleted **before** the commit, so a rollback — including
a failed audit insert — loses it.

---

### A-80 — The profile slug differs between assignment and seed

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-63) |

`ROLE_MENU_ASSIGNMENTS` grants `profile`; `seedMenuGroups` seeds `profile-page`. This is the A-58
shape: one of the two names matches nothing. Check whether the A-58 boot assertion covers
assignments, and extend it if not.

---

### A-81 — MFA verification is not rate-limited

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-67) |

`/auth/mfa/login` mounts no limiter. A 6-digit TOTP has 10⁶ values, and the MFA token lives for 5
minutes. A fresh token costs only the correct password, so a stolen password and an unthrottled
endpoint defeat the second factor.

**Definition of Done**
- [ ] N wrong TOTP codes for one MFA token or user lock further attempts, by a named test

---

### A-82 — Impersonation is unaudited

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-67) |

`impersonateUser` creates a session as another user and calls only `logger.info`. A super admin acting
as a hospital user is precisely what an audit trail exists to record.

---

### A-83 — Status checks missing at three sign-in points

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-67) |

- Password login does not check the **tenant's** status; only the per-request middleware does.
- `loginMfa` ignores `lockedUntil`.
- `ssoExchange` does not re-check the user's status when the code is redeemed, which leaves a
  60-second window.

In each case the middleware refuses the token afterwards, but a session and a `LOGIN` row are written
for a sign-in that should have been refused.

---

### A-84 — The signing route has no permission gate

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | medium — A-65's signer check limits it |
| **Verified** | from code, 2026-09-24 (A-65) |

`POST /esignature/sign` mounts `auth` and `denyApiKey` only. CLAUDE.md: every route needs a gate.

**What was changed (2026-09-24).** Three of the eleven e-signature routes had no gate:
`POST /sign`, `POST /verify` and `GET /history`. They now use a new `esignature` slug — `write` to sign,
`read` to verify and read history.

**Why a new slug rather than `qms`:** a signer is whoever the workflow names, and most roles have no
`qms` menu.

**Default grant: every seeded role gets `esignature: write`.** A-65 already refuses anyone but the
named signer, so the gate adds what was missing:
- a tenant can withdraw signing per role, or per user;
- an API key needs an explicit scope.

The default is recorded in ADR-049.

**Migration `0025-esignature-menu-grants`** backfills seeded databases. It never overwrites an
existing grant, and does nothing on an unseeded database. It was verified on PostgreSQL 18.

**At deploy:** each role's permission matrix is cached in Redis for up to an hour. Flush
`permissions:*`, or non-admin signers get 403 for up to an hour.

**Test:** `eSignature.gate.a84.test.js`, which runs the real router against the real seed matrix. It
includes a withdrawn grant (403) and a read-only role that can verify but not sign. The A-58 check
reports 140 gates and 0 errors.

---

### A-85 — Two state conflicts answer 400

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-65) |

Signing a step that is not pending, and editing a signed or revoked certificate, are state conflicts:
**409 with a state explanation**, per CLAUDE.md. Both return 400.

**What was changed (2026-09-24).** Both conflicts now answer 409 with a state explanation instead of
400:

- **Signing a step that is not pending.** The explanation depends on the state: *waiting for an
  earlier signer*, *already signed*, or *declined*.
- **Editing a signed or revoked certificate.** A signed one names the revoke route and says to issue a
  new certificate; a revoked one says revocation is final.

**Tests:**
- `esignature.service.coverage.test.js` › *"A-85: signing a step that is not pending is 409 with a
  state explanation"*
- `certificate.service.test.js` › *"A-85: a PUT on a signed certificate is 409…"*

---

### A-86 — External signers cannot sign

| | |
|---|---|
| **Status** | TODO — **owner decision** |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-65) |

A workflow step can name a signer by email alone (`signerId` null). No route authenticates such a
signer, and since A-65 nobody else may sign in their place — so such a workflow can never complete.
Either external signing gets a real identity mechanism (an emailed one-time link and a
re-authentication step), or workflows refuse external signers at creation.

---

### A-87 — The tenant hooks do not reach includes

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — mechanism; call sites under A-90 |
| **Severity** | **critical** — a codebase-wide cross-tenant read path |
| **Verified** | against Sequelize's real PostgreSQL SQL generation, with the real models and hooks, 2026-09-24 (A-75). Pinned in `qms.includes.a75.test.js` |

CLAUDE.md says tenant isolation is enforced by global hooks, deny-by-default, and that "you do not
opt in". **That is true of the root query only.** `beforeFind` fires once, for the model `findAll`
is called on, and it adds the tenant predicate to that model's `WHERE`. An `include` of another
tenant-scoped model gets **no** tenant predicate. Any include whose foreign key can point at another
tenant's row returns that row's attributes. Rows are pointed that way today: A-75 found QMS storing
unchecked foreign ids, and there is no reason to believe it was the only writer that trusted a body
id.

Second finding, same test: including `User` or `CalibrationDevice` — both have a `defaultScope`
`where` (`is_deleted = false`) — is treated as **required**, an INNER JOIN, even when the include
names no `where`. So the most repeated defect in this codebase, the one CLAUDE.md's trap table puts
first, has a trigger nobody had written down.

**Fix direction:** decide the mechanism once, not per query. Either a hook that walks
`options.include` recursively and adds the tenant predicate to every tenant-scoped model, or a lint
or test that refuses an include without an explicit tenant `where`. Then audit every include of a
tenant-scoped model — `User` and `CalibrationDevice` first — for both the leak and the INNER JOIN.
This is an architectural change to ADR-029's mechanism, so it needs an ADR.

**Definition of Done**
- [x] a test proves an include of a tenant-scoped model carries the tenant predicate, for every include in the codebase — data-driven, not per query
- [ ] every include of a `defaultScope`d model is `required: false` unless an INNER JOIN is intended and commented
- [x] an ADR amends ADR-029, and CLAUDE.md's "you do not opt in" is corrected

**What was changed (2026-09-24, ADR-048).** `tenantScope.util.js#applyTenantToIncludes` runs in
`beforeFind` and `beforeCount`:

- It normalises the includes with Sequelize's own helpers, then walks the tree, `through` models
  included.
- It adds the root's tenant predicate to every tenant-scoped include's ON clause, resolved by the
  same `resolveScope`, with the same super-admin and system exemptions.
- It first pins `required` to Sequelize's own default, so **a join type never changes**: LEFT stays
  LEFT, and a cross-tenant related row joins as `null`.
- `separate` includes are scoped by their own `findAll`.
- `skipTenantScope: true` on an include is the only opt-out.

**Tests** are in `tenantScope.includes.a87.test.js`, 743 of them:
- **Data-driven:** every one of the 245 associations in the models barrel, with implicit,
  `required: false` and `required: true` includes. The join type must equal the no-hook baseline,
  and a tenant-scoped target must carry the predicate.
- **343 failed** with the hook call disabled.
- **A mutation test:** the naive `include.where = { tenantId }` breaks 50 of them, 46 of which turn a
  LEFT JOIN into an INNER JOIN.

**Verified on PostgreSQL 18.6:**

| Query, run as tenant A | Before | After |
|---|---|---|
| NC list whose NC points at tenant B's device and user | returned `B SECRET DEVICE` and `secret-b-user@b` | both `null`; no rows lost |
| CAPA with a LEFT include of B's NC | returned tenant B's NC | `null` |

**Not done here:** the `defaultScope` INNER JOIN (DoD 2) is deliberately **not** forced by the hook,
because join semantics are a query-author decision. Those sites are **A-90**.

**The risk:** the fix relies on private Sequelize statics. The data-driven test fails if an upgrade
changes them.

---

### A-88 — Associations that create a second, nullable `tenant_id`

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | on PostgreSQL 18, `\d non_conformances`, 2026-09-24 (A-75) |

`NonConformance` and `Capa` associate to `Tenant` with `foreignKey: "tenant_id"` — the column name,
not the attribute name. Sequelize adds a second attribute. On a database built by `sync()`, the
column comes out **nullable with `ON DELETE SET NULL`**: a deleted tenant leaves orphaned rows that
belong to nobody, and the tenant hooks' predicate cannot match them. The same shape exists on other
associations. **Fix direction:** find every `foreignKey: "tenant_id"`, use the attribute name, and
verify the column in psql on a fresh database.

---

### A-89 — The QMS form lets required fields be empty

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-24 (A-74) |

`dashboard/qms/page.tsx` treats `description` and `actionPlan` as optional. Both are NOT NULL. Since
A-74 the API answers with a 400 instead of a 500, but the form should mark them required.

---

### A-90 — Implicit INNER JOINs at about twenty call sites

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code and SQL generation, 2026-09-24 (A-87) |

Includes of `User`, `CalibrationDevice` and `Warehouse` with no `required` are INNER JOINs, because
those models have a `defaultScope` `where` (A-75). They drop parent rows whose reference is null or
soft-deleted. `calibrationDevices.service.js` states that a device may have no warehouse, yet its list
query drops every such device.

Since A-87, they also drop rows whose reference points outside the tenant. The realistic case is the
super admin acting inside a tenant: calibration performer, stock adjuster, SOP author, backup creator,
session user.

Sites, from A-87:

| File | Includes |
|---|---|
| `calibrationRecords.service.js` | `device`, `performer` |
| `calibrationDevices.service.js` | `warehouse` |
| `stock.service.js` | seven sites: Warehouse, `adjuster`, `requester`, `approver`, `performer` |
| `sop.service.js` | `author` |
| `supplierScorecard.service.js` | `evaluator` |
| `tenantBackup.service.js` and its controller | `creator` |
| `session.controller.js` | `user` |
| `certificate.service.js` | `device` |

**Definition of Done**
- [ ] every listed include is `required: false`, or carries a comment saying why an INNER JOIN is intended
- [ ] a test per service shows a row with a null or foreign reference is still listed

---

### A-91 — Signers cannot open the workflow they are asked to sign

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-24 (A-84) |

`/dashboard/esignature` loads workflows through `GET /workflows` and `GET /workflows/:id`, which are
gated on `qms:read`. Technicians and every other role without a `qms` menu can be named as signers
(A-84 grants them `esignature: write`), but cannot open the workflow to sign it. A-65 made them the
only people who can sign their step. So a workflow naming a technician cannot complete.

**Fix direction:** a signer can read the workflows in which they are named, through the
`esignature` slug, or through a "my pending signatures" route. Workflow **management** stays on `qms`.

---

### A-92 — More conflicts with the wrong status

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-24 (A-85) |

These state conflicts answer 400 where the rule is 409 with a state explanation:
- `eSignature.service#updateWorkflow`
- `eSignature.service#cancelWorkflow`
- `certificate.service#deleteCertificate` on a signed certificate

These in-tenant unique violations answer 500 where the rule is 409:
- changing a device's serial to one another device in the tenant holds;
- re-creating the serial of a soft-deleted device, because the duplicate pre-check does not see
  soft-deleted rows.

`calibration_devices.iot_device_token` is also globally unique. It is a token, not a guessable
identifier, so the risk is low.
