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
| A-01 | `tenant-hierarchy` lets any authenticated principal write **other tenants** | **critical** | 0 | TODO |
| A-02 | webhook, storage-settings and custom-domain routes are guarded only by `auth` | **high** | 0 | TODO |
| A-03 | API keys ignore their scopes on every route without `dynamicAccess` | **high** | 0 | TODO |
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

---

## Wave 0 — Security

### A-01 — Cross-tenant write on `tenant-hierarchy`

| | |
|---|---|
| **Status** | TODO |
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

### A-02 — Tenant configuration guarded only by `auth`

| | |
|---|---|
| **Status** | TODO |
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

### A-03 — API keys ignore their scopes on ungated routes

| | |
|---|---|
| **Status** | TODO |
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
| A-09 (part) | `/menu-groups/menu-groups/admin` 500 | commit `f3d323e` |
| — | avatar and tenant-logo broken images; email templates carrying another company's branding and a broken Outlook CTA | commits `78028b0`, `582e24b`, `6621722` |
| — | `npm test` could not run under a hoisted workspace install | commit `78028b0` |
| — | MySQL support removed — it never worked | ADR-039 |
