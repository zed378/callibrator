# Authorization Matrix — 2026-09-23

**Every route in the backend, and what actually authorizes it.**

Companion to [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md). That board tracks
defects; this one is a map. It exists because `CLAUDE.md` names the missing permission gate as
*"the single most likely authorization defect in the codebase"* and notes that **nothing in the
build enforces it** — so the only way to know is to enumerate.

Generated from the route files as of commit `c131729`, then **verified by hand**. The generator is
in the session scratch, not the repository, because its output is worthless without the hand pass —
see the method note below.

---

## The Method, And Why A Naive Sweep Is Wrong Here

A first pass over `router.<verb>(path, …middlewares)` reports **112 routes** as "authenticated but
carrying no authorization gate". That number is wrong, in both directions, and believing it would
produce a large pile of false findings — which is exactly what happened in the first audit, where a
route-level sweep declared SCIM ungated because its gate is an **inline** function the script did
not know the name of. That produced a confidently wrong card.

Three things defeat a route-level sweep in this codebase:

| Pattern | Example | What a naive sweep concludes |
|---|---|---|
| a **factory** guard: `const g = (param) => function guard(req, res, next)` | `ownTenantOnly("tenantId")` in `tenantHierarchy.route.js` | no gate — wrong, there is one |
| an **inline** guard defined in the router file | `requireApiKeyOrAdmin` in `scim.route.js` | no gate — wrong |
| authorization in the **service**, not the route | `assertAccess` — 28 call sites in `kanban.service.js`; `isResponder` in `ticket.service.js` | no gate — wrong, the resource ACL is below the route |

So every route below was classified by reading the router **and** its controller and service.

**This has a direct consequence for task P6-04** ("build guard: no route without a permission
gate"). A guard that only inspects route chains would fail 112 routes, 56 of them wrongly, and be
switched off within a week. P6-04 needs an allow-list mechanism — a route marks itself
service-gated or self-service and the guard checks that the named check exists. That is a change to
a task that already exists; it is flagged in the phase file.

---

## The Numbers

| | Count |
|---|---|
| Routes registered under `backend/src/routes` | **389** (242 mutating) |
| Carrying an explicit authorization gate in the chain | **253** |
| Unauthenticated by design | 24 |
| Authenticated, no gate in the chain | 112 → of which **48 are gated in the service**, **8 act only on the caller**, and **56 have no gate anywhere** |
| Of those 56, verified **false positives** (guard is elsewhere) | 11 |
| Of those 56, protocol or self-service endpoints | 12 |
| **Remaining: real intra-tenant authorization gaps** | **33** (7 mutating) |

**One defect is in the gates themselves, not in their absence** — see AZ-04: both authorization
middlewares answer 403 for a cross-tenant id where the rule requires 404, on the 50 routes that
pass `checkTenant: true`.

Gate kinds in use: `dynamicAccess` 136 · `rbac` 68 · `denyApiKey` 38 · `superAdminOnly` 26 ·
`requireApiKeyOrAdmin` 12 (SCIM) · `abac` 7 · `superAdminOrBootstrap` 3.

---

## Unauthenticated Routes — 24

Each one is deliberate. Listed so that "deliberate" is a claim someone can check, rather than an
assumption.

| Route | Why it is public | Its own defence |
|---|---|---|
| `POST /auth/login`, `/register`, `/send-otp`, `/reset-password`, `/refresh`, `/mfa/login`, `GET /auth/activation` | the login surface | rate limiter (A-30), lockout counters |
| `POST /auth/sso/*` (6 routes), `GET /auth/sso/metadata*` | SAML and OIDC callbacks — the IdP is the caller | signature validation in the SSO service |
| `POST /billing/webhook` | Stripe is the caller | Stripe signature verification over the raw body |
| `GET /certificates/verify/:certificateNumber` | a QR code on a printed certificate, scanned by anyone | the certificate number is the capability |
| `GET /content/posts/public`, `/posts/public/:slug`, `/categories/public` | the public site | read-only, published rows only |
| `POST /iot/ingest` | devices have no session | device token (`X-IoT-Token`); **unprovisionable today — A-29** |
| `GET /storage/object` | file downloads | HMAC/signed path — **the whole defence, see A-51's neighbours** |
| `GET /tenant/public` | tenant lookup for the login page | **verified**: returns only `id`, `name`, `code`, `primaryColor` and a logo URL, for an `active` tenant, given an id the caller already holds (`tenant.service.js:302-326`). A 404 does confirm whether a tenant id exists, but the id is a UUID |
| `GET /attachments/:id/signed` | signed attachment URL | the signature is the capability |
| `GET /oidc/.well-known/openid-configuration`, `/.well-known/jwks.json` | the OIDC discovery contract | public by specification |

**Not verified:** whether the signed paths for `/storage/object` and `/attachments/:id/signed` can
be forged or replayed. That is in scope for the infrastructure audit and is not settled here.
`GET /tenant/public` **was** checked and is listed above.

---

## Gated Below The Route — 48

Not defects. Recorded so a future sweep does not re-report them, and so the P6-04 guard knows they
exist.

| Module | Routes | Where the check lives |
|---|---|---|
| `kanban` | 28 (23 mutating) | `kanban.service.js#assertAccess(user, projectId, minLevel)` — project membership plus a level, 28 call sites |
| `tickets` | 8 (5 mutating) | `ticket.service.js` — `tenantScope(user)` and `isResponder(user)` against `RESPONDER_ROLES` |
| `gdpr` | 8 (5 mutating) | operates on the caller's own subject data |
| `notifications` | 6 (5 mutating) | `recipientScope(tenantId, userId)` — every read and delete is scoped to the recipient |
| `menuGroups`, `networkSecurity`, others | 6 | partial — see the gaps below |

---

## The Gaps — 33 Routes

One shape accounts for most of them: **the write is gated and the read is not.**

### G-01 — Security configuration is readable by every authenticated user

| Route | Write is | Read is |
|---|---|---|
| `GET /network-security/ip-allowlist` | `superAdminOnly` (`PUT`) | `auth` |
| `GET /network-security/geofence` | `superAdminOnly` | `auth` |
| `POST /network-security/evaluate-login` | — | `auth` |
| `GET /oidc/clients` | `superAdminOnly` (`POST`) | `auth` |
| `GET /data-retention/:tenantId/policy` | `superAdminOnly` (`PUT`) | `auth` |
| `GET /data-retention/:tenantId/legal-hold` | `superAdminOnly` (`POST`/`DELETE`) | `auth` |

**Severity: medium.** The IP allowlist and geofence tell an attacker which addresses are accepted —
the configuration of the control they would have to evade. Legal-hold status tells any user whether
records are frozen for litigation. `GET /oidc/clients` was checked: it whitelists its fields and
does **not** return `clientSecretHash` (`oidcProvider.service.js:175-192`), so it discloses client
ids and redirect URIs only.

`:tenantId` on the data-retention reads is a path parameter, but `TenantSettings` carries a
`tenantId` attribute, so the global hooks add the caller's predicate and a foreign id returns
nothing rather than another tenant's policy. **That containment is accidental, not designed** — the
service reads the parameter, and if the model ever loses its `tenantId` the read becomes
cross-tenant.

### G-02 — Every role can read the tenant's whole reporting surface

`GET /reports/summary`, `/compliance`, `/calibration-workload`, `/overdue-devices`, `/inventory` —
five routes, `auth` only. Each calls `reportingService` with `req.user.tenantId`
(`reporting.controller.js:22-45`), so the tenant boundary holds; there is no role check at all.

**Severity: medium.** A room user or a warehouse clerk can read compliance posture, calibration
workload and full inventory valuation. Every other route that exposes this data is behind
`dynamicAccess`, so the reporting surface is a way around those gates.

### G-03 — Quality and vendor records readable by every role

`GET /qms/nc`, `GET /qms/capa`, `GET /supplier-scorecard`, `GET /supplier-scorecard/:id`,
`GET /quota`, `GET /feature-flags`, `/feature-flags/definitions`, `/feature-flags/:tenantId/:flagKey`.

**Severity: medium for QMS, low for the rest.** Non-conformances and CAPA records are ISO 13485
evidence; their write paths were gated on 2026-09-23 under A-28 and their read paths were not.

### G-04 — The RAG index answers any role

`POST /ai/query` and `POST /ai/ocr`, `auth` only. `ai.service.js` scopes retrieval to the tenant (26
`tenantId` references), so no cross-tenant answer — but **within** the tenant the index contains
documents whose own endpoints are gated, and the query path is not. A natural-language question is
a way to read them.

**Severity: medium.** Retrieval-augmented answers inherit the permissions of the index, not of the
asker, unless someone makes them.

### G-05 — Batch jobs

`GET /batch-jobs`, `GET /batch-jobs/:id`, `POST /batch-jobs/test` — `auth` only. The last one
triggers work. **Severity: low-medium** — it is a test endpoint, which is itself worth asking about
in production.

### G-06 — Permission metadata

`GET /menu-groups/menu-groups`, `POST /menu-groups/filter`, `POST /menu-groups/get-assignments` —
`auth` only, and `menuGroup.service.js` has **no** `tenantId` reference at all because menus are
global. Discloses the permission matrix: which roles hold which menus. **Severity: low**, and it is
mostly useful to an attacker who already has a foothold.

### Known, already tracked — not re-reported here

`POST /esignature/verify` and `GET /esignature/history` are `auth`-only by a decision recorded in
A-28, and `/verify` returns `biometricData` and `polygon` to any authenticated caller who knows a
signature id. That is tracked there.

---

## Cards

### AZ-01 — Read paths are ungated where their write paths are gated

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **medium** |
| **Verified** | from code, 2026-09-23, route by route (G-01 … G-03 above) |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` |

**Root cause:** gating has been applied where a mutation was the obvious risk. Nobody swept the
reads. The result is a consistent asymmetry across six modules: `network-security`,
`data-retention`, `oidc`, `reports`, `qms`, `supplier-scorecard`.

**Why it matters here:** the role matrix is the product's model of who sees what — a hospital's
warehouse clerk is not supposed to read its compliance posture. An ungated read path makes the
gated ones decorative, because the same data is one endpoint away.

**Fix direction:** gate each read with `dynamicAccess` on the slug its own module already uses for
writes (`network-security`, `data-retention`, `oidc`, `qms` and `supplier-scorecard` all exist in
`MENU_SLUGS`). `reports` has no slug — decide whether it gets one or inherits `equipment`, and
record the decision; inventing a slug that matches no menu creates an instance of A-07.

**Definition of Done**
- [ ] each route in G-01, G-02 and G-03 carries a gate, or carries a comment saying why it must not
- [ ] a `USER` gets 403 from each, proven by a named test
- [ ] the reporting slug decision is recorded (ADR or Open Question, not a judgement call)
- [ ] no new `dynamicAccess` resource name that is absent from `MENU_SLUGS` (A-07)

---

### AZ-02 — The RAG query path inherits the index's reach, not the asker's

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **medium** |
| **Verified** | from code, 2026-09-23 |

`POST /ai/query` is `auth`-only. Retrieval is tenant-scoped but not permission-scoped, so a role
that cannot open a document can ask a question whose answer is drawn from it.

**Fix direction:** filter retrieval by the asker's permissions — the chunk rows would need to carry
the source resource's menu slug — or gate the endpoint to the roles allowed to read every indexed
type. The first is correct; the second is honest and cheap. Whichever is chosen, say so in
`docs/` rather than leaving the reach implicit.

**Definition of Done**
- [ ] a role without access to an indexed document cannot obtain its content through `/ai/query`, proven by a named test
- [ ] `POST /ai/ocr` gated or justified
- [ ] the chosen model written down

---

### AZ-04 — Both authorization middlewares answer 403 for cross-tenant, where the rule says 404

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 — both middlewares and `user.service.js`. The `dynamicAccess` 500 leak is **still open**, deliberately, see below |
| **Severity** | **high — it is the tenant-membership oracle the 404 rule exists to prevent** |
| **Verified** | from code, 2026-09-23 |

`CLAUDE.md` states it without qualification:

> **Cross-tenant returns 404, never 403.** A 403 says "this exists and you may not have it" — which
> turns id enumeration into a tenant-membership oracle. Non-existent, soft-deleted and not-yours
> must be **indistinguishable**.

Both gates break it, in the same words:

| Where | Code |
|---|---|
| `middlewares/dynamicAccess.middleware.js:105` | `res.status(403)` — *"Access denied: resource belongs to a different tenant"* |
| `middlewares/dynamicAccess.middleware.js:130` | the same, on the resource-owner branch |
| `middlewares/abac.middleware.js:82` | the same |

**And `abac` makes it worse by being helpful.** It answers **404 "Tenant not found"** when the id
matches no tenant (`abac.middleware.js:77`) and **403** when it matches someone else's
(`:82`). Those two responses are exactly the distinction the rule forbids: a caller can enumerate
tenant ids and learn which exist, from any of the **50 routes** that pass `checkTenant: true`.

The irony is worth naming: this is the deny-by-default gate. The code that exists to enforce
isolation is the code that discloses it.

**Fix direction:** both branches return **404** with the same body the not-found path returns —
same status, same message, same shape. The reason belongs in the log, keyed by request id, not in
the response. Then a test asserts that a foreign id and a non-existent id are **byte-identical**,
because that is the actual requirement and anything weaker will drift back.

**Also in `abac`:** its `catch` returns `res.status(500)` with `error.message` — a raw internal
message to the client, which is finding A-13's shape and is still open.

**Definition of Done**
- [ ] a foreign tenant id and a non-existent tenant id produce byte-identical responses on a route using `checkTenant: true`, proven by a named test
- [ ] the same for the resource-owner branch of `dynamicAccess`
- [ ] the reason is logged with the request id
- [ ] `abac`'s 500 path stops returning `error.message` (folded into A-13)

---

**What was changed (2026-09-24)**

Both middlewares now route cross-tenant and not-found through one helper, so the two responses are
**byte-identical**:

| Case | Body |
|---|---|
| foreign tenant id, or nonexistent (abac, and `dynamicAccess`'s tenant branch) | `{"success":false,"status":404,"message":"Tenant not found","data":null}` |
| foreign owner, or missing owner (`dynamicAccess`'s owner branch) | `{"success":false,"status":404,"message":"Resource not found","data":null}` |
| permission failure **inside the caller's own tenant** | `{"success":false,"status":403,"message":"Forbidden: Insufficient permissions","data":null}` — still 403, correctly |

The two 404 branches carry different messages, but the caller already knows which branch ran from
the parameter it sent, so that distinguishes nothing. The reason is logged against the request id.
`abac`'s error path now calls `next(error)` instead of writing `error.message` to the client.

**Five existing tests had encoded the oracle** and asserted the old 403 for a cross-tenant id — one
in `abac.test.js` (`"should return 403 if tenant ID does not match"`) and four in
`dynamicAccess.test.js`. They now assert the full 404 body. Every in-tenant 403 test was left
untouched and still passes; flattening those to 404 would have been a new bug.

**Verification** — 5 suites, 128 tests, **100 %** on both middlewares. Named: byte-identical
foreign-vs-nonexistent tests for `abac` and for both `dynamicAccess` branches; in-tenant 403 tests on
a `checkTenant` route whose tenant is the caller's own.

**Still open, found while fixing:** `user.service.js` repeats the oracle at three sites — `404 "User
not found"` immediately followed by `403 "resource belongs to a different tenant"` — and
`dynamicAccess`'s own `catch` still writes `error.message` in a 500. Both are being closed now.

**Closed 2026-09-24 — the `user.service.js` instance.** All three sites (`userRoleUpdate`,
`editUser`, `deleteUser`) now throw the same `404 "User not found"` for a user in another tenant as for
a user that does not exist, and log the reason. `user.service.crossTenant.az04.test.js`: **7 of 11
fail** against the old code, 11 pass with the fix.

The branch was **latent, not live** — checked per site rather than assumed. `Users` carries a
`tenantId`, the `beforeFind` hook covers `findByPk`, none of the three lookups uses `.unscoped()` or
`skipTenantScope`, and the routes also run `dynamicAccess(…, {checkTenant: true})`, which turns a
foreign id into a 404 first. So a foreign user already came back `null`. The 403 would have become a
live oracle the moment anyone added `.unscoped()` to one of those lookups, or called the service
without a request context.

One behaviour change beyond the brief, and it is the right one: in `deleteUser` the tenant check now
runs **before** the system-account guard. A tenant admin who reached another tenant's `sys` account
used to get `403 "cannot be deleted"` — confirming that id exists. Now it is a 404. A super-admin
still gets the explicit 403.

**Still open — the `dynamicAccess` internal-error leak (A-13 shape), and why it was not landed.**
Its `catch` still writes `res.status(500).json({ success: false, message: error.message })`. Routing it
through `next(error)`, as `abac` now does, **was written, tested, and then reverted**, because on its
own it makes **search fail open**. `search.controller.js:19-25` probes each searchable type by running
the real `dynamicAccess` gate with a callback of `() => resolve(true)` — it treats **any** call to
`next` as "allowed" and ignores the argument. With `next(error)`, a failure of the permission store
would read as "allowed for every type". `search.permissions.a04.test.js` › *"returns no rows when the
permission store itself fails"* caught it, with three search queries run.

That is a seam between two changes that are each correct, the same shape as V-01. **To land it**, the
patches are ready and one line must change with them: `search.controller.js:24`, `() => resolve(true)`
→ `(err) => resolve(!err)`, so a failed check denies. The safety of `next(error)` itself was verified
by running the real `errorHandler` under `NODE_ENV=production`: the client receives
`"An unexpected error occurred. Please try again later."` and none of the internal text. One caveat
for whoever lands it — `sanitizeError` copies `err.errors` in every environment, so a Sequelize
`ValidationError` would still carry detail.


### AZ-03 — P6-04's premise needs changing before it is built

| | |
|---|---|
| **Status** | TODO — **edits an existing task** |
| **Severity** | medium — a guard that cries wolf gets disabled |
| **Verified** | this document is the evidence |

P6-04 says: *"build guard: no route without a permission gate."* Run literally, it fails 112 routes,
**56 of them wrongly**, because kanban, tickets, GDPR and notifications authorize in the service
and two routers use factory or inline guards.

**Fix direction:** the guard checks that each route is covered by one of — a gate in the chain, an
explicit `serviceGated("<function>")` marker whose named function exists, or an explicit
`selfService()` marker. Unmarked and ungated is the failure. The 48 service-gated and 8
self-service routes above are the initial allow-list, and each entry is a claim a reviewer can
check.

**Definition of Done**
- [ ] the guard passes on the current tree with the allow-list, and fails when a marker names a function that does not exist
- [ ] adding an ungated route fails CI
- [ ] P6-04's card records the markers

---

## What This Document Does Not Cover

- **Nothing here was tested against a running server.** Every claim is read from source. A route I
  call gated could still be reachable — a gate can be present and wrong.
- `abac` (7 routes) and `requireFeature` were **not** evaluated for correctness, only for presence.
- The 24 unauthenticated routes were classified by intent, not probed, except
  `GET /tenant/public`, which was read in full. The signed-path downloads remain unverified.
- Frontend consequences are out of scope here and are in `AUDIT-2026-09-FRONTEND.md`.
