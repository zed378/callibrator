# Review 2026-09-23 — Wave-0 Remediation (`e326ae5`, `c005b8c`, `c131729`)

Adversarial review of the three commits that landed on `main` on 2026-09-23 — 188 files,
+13,918 / −1,787, written by nine agents on disjoint findings. Review only; **no application
code was changed by this review**. Ids are `V-nn` and follow the card shape of
[`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md).

> **Note on the working tree.** When this review started, `git status` reported clean. By the time
> it finished, `CLAUDE.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-3/6/9` were modified and four
> untracked `TASKS/AUDIT-2026-09-*.md` / `DOCS-GAP-2026-09.md` files existed. None of that is this
> review's doing — this review wrote exactly one file. Someone or something else is editing the
> repository concurrently; reconcile before merging.

---

## Verdict

**I would not merge this as it stands.** The substance is better than the average change in this
repository: the crypto in `eSignature.service.js` is real and its determinism argument holds, the
amqplib and ioredis lifecycle fixes are correct and their tests were rewritten to stop inventing
driver properties, the SCIM PATCH rework is faithful to RFC 7644, and the honesty of the commit
message — twenty new findings recorded *not* fixed — is exactly the standard `CLAUDE.md` asks for.
But nine agents working on disjoint slices produced three defects that live **between** slices, and
two of them are worse than the holes they were meant to close.

Three things block the merge:

1. **V-01 — every newly tenant-admin-gated route is now SUPERADMIN-only, silently.** Sixteen
   routes across API keys, webhooks and storage settings were moved onto
   `rbac([ROLE_NAMES.TENANT_ADMIN])`. `rbac` decides by role *level*, and the only loader that
   populates `req.user.role` (`auth.service.js:451`) selects `["id", "name", "description"]` — no
   `roleLevel`. So `userRoleLevel` is `0`, `0 < 8`, and HEALTHCARE ADMIN / CALIBRATOR ADMIN get
   **403** on API-key issuance, webhook management and storage configuration in their own tenant.
   This is the `A-07` failure shape ("a gate that denies everyone but SUPER_ADMIN, silently") that
   another agent explicitly warned about *in this same change*, committed by a different agent, and
   the test written to prove the gating (`routeGuards.a02.test.js`) mocks `rbac` to a pass-through
   so it cannot see it.
2. **V-02 — the API-key scope allow-list was built from the wrong list.**
   `apiKey.service.js:39` derives `ALLOWED_RESOURCES` from `MENU_SLUGS` (31 entries). The menus
   routes actually gate on come from `menu_groups` (56 seeded slugs). `calibration`,
   `certificate`, `users`, `vendors`, `billing`, `maintenance`, `audit`, `attachments` and
   `workflows` are all gated and none of them can be named in a scope any more. Combined with
   A-03's new deny-by-default in `controllerWrapper.util.js`, **no API key can ever again be
   authorised for those modules** — a key minted today gets 400 at creation, and a key minted
   yesterday with `calibration:read` still works, so the two behave differently with no migration
   and no note.
3. **V-03 — `/health` and `/ready` now fail closed on Redis *or* RabbitMQ**, and the Helm
   readiness probe points at `/health`. A RabbitMQ blip now removes every backend pod from the
   Service. The change is defensible; shipping it without amending
   `deploy/helm/callibrator/values.yaml`, `charts/backend/templates/deployment.yaml` and
   `templates/NOTES.txt` — which still say "/health calls db.authenticate()" — is a deviation
   protocol violation, and the availability blast radius is not stated anywhere.

Two more should be fixed before merge but do not block it on their own: **V-04** (the 21 CFR
11.50(a)(3) "meaning of the signature" is unreachable — the validator strips it) and **V-06** (the
lint gate now runs and reports 1,297 errors, so `make verify` still fails at step one, and
`CLAUDE.md`'s "Two Things Currently Failing" was not updated to three).

Everything else below is a card, not a blocker.

---

## V-01 — `rbac([TENANT_ADMIN])` refuses every tenant admin: `roleLevel` is never loaded

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **blocker** |
| **Evidence** | `backend/src/services/auth.service.js:451` — `attributes: ["id", "name", "description"]`. `backend/src/middlewares/rbac.middleware.js:39` — `req.user.role?.role_level \|\| req.user.role?.roleLevel \|\| 0`. `backend/src/routes/api/apiKeys.route.js:17`, `backend/src/routes/api/webhooks.route.js:15`, `backend/src/routes/api/storage.route.js:13` — `rbac([ROLE_NAMES.TENANT_ADMIN])`. `backend/src/constants/roleConstants.js:100` — `TENANT_ADMIN: 8`. `backend/src/models/role.model.js:36` — `roleLevel` exists on the model; it is simply not selected. |
| **Spec refs** | `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · `CLAUDE.md` § The Traps ("a new role without a `ROLE_LEVELS` entry fails every privileged gate, silently") |

**Why it matters.** `TENANT_ADMIN` is not a seeded role name — `roleConstants.js:40-45` says so
explicitly — so `rbac` can only admit a tenant administrator via the level comparison. With the
level absent the comparison is `0 < 8`, the name is not in the allow-list, and the request is
refused. Only the hardcoded SUPERADMIN bypass at `rbac.middleware.js:47` survives. The commit
message states "webhooks and storage settings are tenant-admin only" and "Issuance is now
TENANT_ADMIN-only"; the code makes all three **platform-admin only**. A hospital admin can no
longer create an API key, register a webhook or point storage at their own bucket, and the refusal
is a bare 403 with no diagnosis.

This is precisely the seam the brief asked about: the A-02/A-27 agent chose `rbac` and was right
that `dynamicAccess` had no matching menu; the `auth` loader was never in that agent's slice; and
the verification test it wrote could not see across the boundary (see V-08). `meteredBilling.route.js:33`
already carried the same defect before this change, so it is not a regression *of the mechanism* —
but this change multiplies its reach by sixteen routes and asserts the opposite in the commit
message.

**Fix direction.** Add `"roleLevel"` to the `Roles` include in `auth.service.js#getAuthUserWithTenant`
(one word, no behaviour change for anything else), then add a behaviour test that drives the real
`auth`-shaped principal — role loaded by the real loader's attribute list — through the real `rbac`.
Alternatively drop `rbac` here and use `dynamicAccess` against the seeded `api-keys`, `webhooks` and
`security` slugs, which do exist in `menu_groups`.

**Definition of Done**
- [ ] a HEALTHCARE ADMIN principal built from `getAuthUserWithTenant`'s real attribute list passes `rbac([TENANT_ADMIN])`
- [ ] a ROOM USER built the same way is refused
- [ ] the test constructs `req.user.role` from the loader, not from a literal that supplies `role_level` by hand
- [ ] `meteredBilling.route.js:33` and `tenant-backup` are covered by the same fix or explicitly excluded with a reason

---

## V-02 — API-key scopes are validated against `MENU_SLUGS`, not the menus routes actually gate on

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **blocker** |
| **Evidence** | `backend/src/services/apiKey.service.js:39` — `ALLOWED_RESOURCES = new Set(Object.values(MENU_SLUGS)...)`; `:50` throws 400 `Unknown scope resource`. Route gates in use: `grep -o 'dynamicAccess([^,]*' backend/src/routes/api/*.js` → `"calibration"`, `"certificate"`, `"users"`, `"content"`, `"workflow"`, `"Billing"`, `"Maintenance"`, `"Management"`, `"Vendors"`, `["AuditLogs"…]`. Seeded slugs: `backend/src/utils/seedMenuGroups.util.js` → 56 slugs including `calibration`, `certificate`, `users`, `vendors`, `billing`, `maintenance`, `audit`, `attachments`, `api-keys`, `webhooks`. `MENU_SLUGS` (`roleConstants.js:121-155`) has 31 and contains none of those. |
| **Spec refs** | `docs/API/13-INTEGRATION-API.md` · A-03 / A-07 |

**Why it matters.** Two agents were each locally right. The A-27 agent closed a real hole — a
`["*"]` scope — by requiring "a real menu slug", and used the constant a developer would reach for.
The A-03 agent made API-key authorisation deny-by-default in `controllerWrapper.util.js`, so a key
that no gate authorised is refused. Jointly they produce a closed set: a route gated on
`"calibration"` authorises a key only if it holds a `calibration:*` scope, and `createApiKey` now
refuses to issue one. The affected modules are the operationally important ones — calibration
devices, certificates, users, vendors, billing, maintenance, audit, attachments, workflows.

Two aggravating details:

- `"AuditLogs"` and `"workflow"` lowercase to `auditlogs` / `workflow`, which match neither the
  constant nor the seed. Those gates already admitted no API key and never will.
- `assertScopes` runs on `createApiKey` only. Keys created before 2026-09-23 keep whatever scopes
  they hold and continue to work, so the same scope string is simultaneously valid (in a row) and
  invalid (at the API). There is no migration and no report of which live keys are now
  unreproducible.

The commit message's claim — "scopes must name a real menu slug" — is true of the constant and
false of the database.

**Fix direction.** Build the allow-list from the same source the gates resolve against: the seeded
`menu_groups` slug set (and the menu *names*, since `getRolePermissionsMatrix` indexes by both).
Either load it at boot from `menu_groups`, or make `MENU_SLUGS` the single source and convert the
ten free-text `dynamicAccess(...)` arguments to constants — which is A-07 and is still TODO.
Whichever way, reject a scope only against the same list `scopeAllows` will later match on.

**Definition of Done**
- [ ] a scope naming any menu a route gates on is accepted; a scope naming a menu no route gates on is refused
- [ ] a test asserts `ALLOWED_RESOURCES ⊇ { every string passed to dynamicAccess in routes/ }`, derived from the routes, not restated
- [ ] existing keys carrying now-unissuable scopes are enumerated and reported (or A-07 closes the gap)
- [ ] `docs/API/13-INTEGRATION-API.md` lists the issuable scopes

---

## V-03 — `/health` fails closed on Redis and RabbitMQ; probes and docs were not updated

| | |
|---|---|
| **Status** | TODO |
| **Severity** | high |
| **Evidence** | `backend/src/services/health.service.js:115` (`Redis — required`), `:157` (`RabbitMQ — required`), `:257` — `dependency.required && dependency.status !== HEALTHY`. `backend/src/controllers/health.controller.js` `health`/`readiness` → `healthService.isReady()`. `deploy/helm/callibrator/values.yaml:62` — `readinessProbe.path: /health`; `:53` still says "/health calls db.authenticate()". `deploy/helm/callibrator/templates/NOTES.txt:16` — "/health returns 503 when the database is unreachable". |
| **Spec refs** | `docs/DEVOPS/09-KUBERNETES.md` · A-15 |

**Why it matters.** A-15 was a real finding, and widening the readiness verdict is the right
direction. But `/health` is wired to the Kubernetes readiness **and startup** probes. Making Redis
and RabbitMQ required means a broker restart now removes every backend replica from its Service —
a total API outage for endpoints that do not touch RabbitMQ at all — and, on the startup probe, can
prevent a rollout from ever becoming ready. That is a much larger availability change than "the
health check now checks more things", and nothing in the commit message, the Helm values or
`NOTES.txt` says so. `CLAUDE.md`'s deviation protocol requires the docs to be amended in the same
change.

Secondary, unflagged: the public `/health` body changed from
`{status:"OK", uptime, timestamp, memory, pid, node, database}` to `{status:"ok"}`. The case of the
verdict string changed. Any external monitor matching `"OK"` now reads a failure on a healthy
deployment.

**Fix direction.** Either (a) keep `/health` as a *required-dependency* verdict but point the
Kubernetes readiness probe at a narrower path (`/ready` scoped to Postgres only) and reserve the
aggregate for alerting, or (b) demote RabbitMQ to optional — queued work stopping is an alerting
concern, not a reason to refuse HTTP traffic — and say so in `health.service.js`. Whichever way,
amend the Helm comments and `NOTES.txt` in the same commit and record the choice as an ADR.

**Definition of Done**
- [ ] a decision recorded in `MEMORY/DECISIONS.md` naming which dependencies gate *serving* versus *alerting*
- [ ] `values.yaml`, `charts/backend/templates/deployment.yaml` and `NOTES.txt` describe what `/health` actually checks
- [ ] a test asserts the public body shape, including the verdict string, so a silent rename is caught
- [ ] the `OK` → `ok` change is either reverted or noted in `MEMORY/CHANGELOG.md` as a consumer-visible break

---

## V-04 — the signature's "meaning" is bound, stored, indexed — and unreachable

| | |
|---|---|
| **Status** | TODO |
| **Severity** | high (compliance claim not supported) |
| **Evidence** | `backend/src/services/eSignature.service.js:514` — `const reason = signatureData.reason \|\| null;` and `:552` `signatureReason: reason`. `backend/src/validators/eSignature.validator.js:52-59` — `exports.signDocument` has **no** `reason` key and `.options({ stripUnknown: true })`. `backend/src/controllers/eSignature.controller.js:126-145` — destructures `stepId, polygon, biometricData, authenticationMethod, ipAddress, userAgent` and passes no `reason`. `backend/src/migrations/0019-add-signature-crypto-fields.js` adds `signature_reason` "the meaning of the signature (21 CFR 11.50(a)(3))". |
| **Spec refs** | ADR-040 · `docs/SECURITY/00-SECURITY-REQUIREMENTS.md` |

**Why it matters.** `POST /api/v1/esignature/sign` runs `validate(signDocumentValidator)`, which
strips unknown keys; even if a client sent `reason`, it would be gone before the controller ran —
and the controller does not forward it regardless. So `signature_reason` is **always NULL**, the
canonical payload always binds `["reason",""]`, and the certificate always reports
`reason: null`. The column, the canonical field, the migration and the model comment all describe a
21 CFR 11.50(a)(3) property the system cannot record. This is exactly the shape `CLAUDE.md` opens
with: a document (here, a code comment and a migration header) asserting something the code
contradicts.

It is also a seam: the crypto agent added the parameter; the A-09 agent touched all 31 validator
files without knowing a new field was expected in one of them.

**Fix direction.** Add `reason: Joi.string().max(255).optional()` to `signDocument` (255, to match
the column — a longer value would be a Postgres error, not a truncation), forward it from the
controller, and add a test that signs **with** a reason and verifies, then mutates the stored
`signatureReason` and asserts `verificationStatus === "invalid"`. That last assertion is what makes
the field load-bearing rather than decorative.

**Definition of Done**
- [ ] `reason` survives the validator and reaches `signDocument`
- [ ] a named test proves a reason-bearing signature verifies, and that tampering with the stored reason invalidates it
- [ ] ADR-040 and `0019`'s header either describe the working field or are corrected
- [ ] the column length and the Joi `max()` agree

---

## V-05 — `allowApiKey` is exported and never called; the chokepoint comment miscounts the bypasses

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `backend/src/middlewares/auth.middleware.js:230` — `exports.allowApiKey`. `grep -rn "allowApiKey" backend/src --include=*.js` outside comments: zero call sites. `backend/src/routes/api/scim.route.js:42` sets `req.apiKeyAuthorized = true` inline instead. `backend/src/utils/controllerWrapper.util.js:23` — "every controller but two is wrapped"; the controllers without `asyncHandler` are **three**: `health.controller.js`, `iot.controller.js`, `predictiveMaintenance.controller.js`. |
| **Spec refs** | A-03 |

**Why it matters.** The opt-in the design depends on is dead code, and the one place that needs it
open-codes the flag — so the invariant "only `allowApiKey` or `dynamicAccess` may set
`apiKeyAuthorized`" is already broken by the only consumer, and nothing can enforce it. Separately,
the comment asserting the coverage of the chokepoint is off by one: `predictiveMaintenance.controller.js`
bypasses it too. That one is harmless today (its routes carry `dynamicAccess`, so a key is
authorised by scope anyway) and `iot.controller.js` is a device-token endpoint with no API-key path,
but a comment that miscounts its own exceptions is how the next reader concludes the check is total.

**Fix direction.** Use `allowApiKey` in `scim.route.js` in place of the inline assignment, or delete
it and document the inline form. Correct the count in `controllerWrapper.util.js` and name the three
controllers. Add a test that enumerates `controllers/*.js` and fails when a file without
`asyncHandler` appears that is not on an explicit allow-list — the coverage claim then defends
itself.

**Definition of Done**
- [ ] `apiKeyAuthorized` is set in exactly one place, or every place is named in the comment
- [ ] the bypass list is enumerated by a test, not by prose
- [ ] no exported middleware in `auth.middleware.js` is without a call site

---

## V-06 — `make verify` still fails at step one; `CLAUDE.md` still says two things are failing

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `Makefile:255` — `verify: lint typecheck test build`. `backend/package.json:48` — `"lint": "eslint src/ --ext .js"`. Observed: `npx eslint src/ --ext .js` → **1,297 errors, 340 warnings**, non-zero exit. Commit `c005b8c` states "ESLint now runs to completion and reports 1,319 errors and 346 warnings". `CLAUDE.md` § Two Things Currently Failing was not amended; `TASKS/AUDIT-2026-09-REMEDIATION.md` marks A-34 "partly DONE". |
| **Spec refs** | `CLAUDE.md` § Workflow, § Two Things Currently Failing |

**Why it matters.** The commit is honest in its own body — it says the errors exist and that fixing
them is its own commit. But `CLAUDE.md` is the document an agent reads first, and it still lists
exactly two failing gates, neither of them lint. An agent that runs `make verify` after this change
hits a red gate the operating document says does not exist. That is the PR-4 failure mode this
repository is organised around, in miniature.

`A-34` itself is real and correctly diagnosed; the finding here is that the *consequence* was not
propagated.

**Fix direction.** Amend `CLAUDE.md` § Two Things Currently Failing to three, naming the count and
pointing at A-34. Optionally split `verify` so `lint` reports without blocking until A-34 completes,
but only with the split stated in the Makefile and in `CLAUDE.md` — a silently non-blocking gate is
worse than a red one.

**Definition of Done**
- [ ] `CLAUDE.md` names the lint gate's current state and the error count
- [ ] `make verify`'s behaviour matches what `CLAUDE.md` says it does
- [ ] the error count in the record and the count a fresh run produces agree (they currently differ by 22)

---

## V-07 — the suite is not green on a clean run; the evidence line names counts that do not reproduce

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `cd backend && npx jest --coverage=false` → `Test Suites: 1 failed, 1 skipped, 307 passed, 308 of 309 total; Tests: 1 failed, 6 skipped, 6121 passed, 6128 total`. Failure: `src/tests/services/esignature.service.coverage.test.js:97` — *"Exceeded timeout of 10000 ms"* on `generateKeyPair › rethrows a persistence error that already carries a status`. Re-running that file plus `esignature.signing.test.js` alone: 2 suites, 43 tests, all pass in 11.3 s. Commit `c131729` claims "308 suites, 6,122 tests, 100%". |
| **Spec refs** | `CLAUDE.md` § Evidence · A-32 |

**Why it matters.** The failure is timing, not logic: `generateKeyPair` performs a real 2048-bit RSA
key generation and the file takes 53 s under full parallelism against a 10 s per-test default. It
passes in isolation. But a suite that is green only when it is not under load is not a gate, and the
CI story for this repository is "someone runs it by hand" — which is exactly the condition under
which it will be run on a loaded laptop. The counts also do not reproduce: 309 suites and 6,128
tests were collected here, against 308 / 6,122 claimed, so the evidence line cannot be checked
against a fresh run.

**Fix direction.** Give the RSA-touching tests an explicit `timeout` argument, or generate the key
pair once in a `beforeAll` shared across the file (the helper `tests/utils/esignatureKey.utils.js`
already recommends exactly this and this file does not follow it). Then record the count from the
command actually named in the evidence line, or name the command that produces the recorded count.

**Definition of Done**
- [ ] two consecutive full runs on a loaded machine are green
- [ ] no test in the suite depends on RSA key generation completing inside the default timeout
- [ ] the evidence line's suite/test counts match `npm run test:coverage` on a clean checkout

---

## V-08 — `routeGuards.a02.test.js` proves the chain's shape, not the gate's behaviour

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `backend/src/tests/routes/routeGuards.a02.test.js:20-34` mocks `rbac` and `dynamicAccess` to `(req,res,next)=>next()` carrying `__roles` / `__gate` tags, then asserts `roleGate(handlers).__roles` equals `[ROLE_NAMES.TENANT_ADMIN]`. |
| **Spec refs** | `CLAUDE.md` § Evidence ("a mock proves the client, not the contract") |

**Why it matters.** The file is candid — its header says "These cases assert the gate is *in the
chain*… They do not re-test the middlewares themselves". That honesty is worth keeping. The problem
is that it is the *only* evidence offered for the commit's claim that "webhooks and storage settings
are tenant-admin only", and it passes cleanly while the gate admits no tenant admin at all (V-01).
The assertion `__roles === [TENANT_ADMIN]` is satisfied by the argument, not by the outcome; it
could not fail for the defect it was written to prevent.

By contrast `routeGuards.a28.test.js` runs the **real** `dynamicAccess` off the role matrix and
asserts the service was never reached. That is the right pattern and it is in this same change —
the two agents simply did not converge on it.

**Fix direction.** Add at least one behaviour case per newly gated router that drives the real
middleware with a real-shaped principal and asserts status and non-invocation of the service, in the
style of `routeGuards.a28.test.js`. Keep the shape sweep ("no route on `auth` alone") — it is
genuinely useful — but stop it being the sole evidence.

**Definition of Done**
- [ ] each of webhooks / storage / api-keys has one real-middleware case admitting a tenant admin and one refusing a lower role
- [ ] the principal in those cases is built from `getAuthUserWithTenant`'s attribute list
- [ ] the commit-message claim and the named test say the same thing

---

## V-09 — the rate limiter's Lua script has no coverage in the gate that runs

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `backend/src/services/rateLimiter.redis.service.js` — `INCR_ENTRY_SCRIPT`, executed via `client.eval(...)`. `backend/src/tests/services/rateLimiter.redis.live.test.js:41` — `const liveDescribe = process.env.REDIS_LIVE_TEST === "1" ? describe : describe.skip;`. `rateLimiter.redis.path.test.js` mocks `eval`. Commit message: "Verified against a real Redis, and against a dead one to prove the tests can fail." |
| **Spec refs** | A-30 · `CLAUDE.md` § Evidence |

**Why it matters.** The atomicity claim — the whole point of A-30 — lives entirely inside a Lua
string. The mocked suite proves which command is issued with which arguments; it cannot prove the
script parses, that `cjson.decode` on a foreign value takes the takeover branch, or that
`firstAttempt` survives. The live suite proves all three and is skipped unless an environment
variable is set, so `npm run test:coverage` and `make verify` exercise none of it. The commit
message's claim is a claim about a manual run: it names the file (good) but the run is not
reproducible from the repository, and this is one of the six items `BACKLOG.md § Unverified Claims`
exists to hold.

**Fix direction.** Either add `REDIS_LIVE_TEST=1` to a `make` target that the release process runs
against the dev stack (`make test-integration`), or record the live run in
`MEMORY/records/` with its output. Add the claim to `BACKLOG.md § Unverified Claims` until one of
those exists.

**Definition of Done**
- [ ] the live suite is run by a named command that is part of a documented gate
- [ ] `BACKLOG.md § Unverified Claims` lists "the limiter's Lua script is atomic" until it is
- [ ] the "against a dead Redis" negative control is a checked-in test, not a recollection

---

## V-10 — the search permission probe is a fake `res` that only survives by luck

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `backend/src/controllers/search.controller.js:19` — `const probe = { status: () => ({ json: () => resolve(false) }) }; dynamicAccess(menuSlug, "read")(req, probe, () => resolve(true));`. `backend/src/middlewares/dynamicAccess.middleware.js` exits at `:45`, `:97`, `:105`, `:121`, `:130`, `:171`, `:203` — all `res.status(n).json(...)` today. |
| **Spec refs** | A-04 · A-23 |

**Why it matters.** Re-using the real gate instead of duplicating the rules is the right instinct
and the card argues it well. The implementation, though, depends on an undocumented invariant:
*every* exit from `dynamicAccess` must be exactly `res.status().json()`. The moment someone converts
it to the house helpers (`forbidden(res, …)` — which happens to work) or adds a header, a
`res.send()`, or lets an exception escape the outer `try` (a throw from `logger.error` inside the
catch would do it), the promise never settles: `await canRead` hangs, the request rides the 30 s
`timeout` middleware, and the caller gets a 503 on a search. There is no assertion anywhere pinning
the invariant.

Secondary: `canRead` is awaited in a loop, one `getUserOverrideMatrix` lookup per type, so a search
now costs three extra permission resolutions. A-23 already records search as one-query-per-type;
this adds to it.

**Fix direction.** Replace the probe with a small exported predicate in `dynamicAccess.middleware.js`
— `resolveAccess(user, menu, permission) => { allowed, reason }` — that both the middleware and the
search controller call. The middleware keeps its `res` handling; the controller gets a value. Then
resolve the types with `Promise.all`.

**Definition of Done**
- [ ] search does not construct a fake `res`
- [ ] a test asserts that a `dynamicAccess` denial path which does not use `.status().json()` still produces a filtered search rather than a hang
- [ ] permission resolution per search is O(1) lookups against the cached matrix, not one per type

---

## V-11 — A-31's token-type enforcement is on a path nothing calls, and the fallback is not algorithm-pinned

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Evidence** | `backend/src/utils/jwt.util.js` — `generateRefreshToken` / `verifyRefreshToken` exported; `grep -rn "verifyRefreshToken\|generateRefreshToken" backend/src --include=*.js` outside `jwt.util.js` and its tests: **no call sites**. `:70` — `assertTokenType` is a no-op when `decoded.typ` is absent (documented at `:59-65`). `:290` — the backward-compat fallback verifies with `algorithms: ["HS256"]` regardless of `JWT_ALGORITHM`. `:252` — `const lastError = null;` is assigned and never read, under a comment that says "Store error but continue trying keys". |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` · A-31 |

**Why it matters.** The commit says "Token types are now claimed and enforced, and the backend
refuses to start on equal secrets or an unpinned algorithm." The boot guards are real and are the
valuable half. The enforcement half is weaker than stated: a token with no `typ` is still accepted
(the code comment is honest about this; the commit message is not), and the refresh-token functions
that now carry the claim have no call sites at all — every refresh token this application issues is
opaque. And "unpinned algorithm" is only partly true: the last-resort branch of `verifyAccessToken`
always accepts an HS256 token signed with `ACCESS_SECRET` even when the deployment has pinned
`JWT_ALGORITHM=RS256` and supplied a key pair. Not directly exploitable (the attacker does not hold
`ACCESS_SECRET`), but it is the one place where the verification algorithm is not the pinned one,
and the commit message asserts the opposite.

**Fix direction.** Make the fallback honour `JWT_ALGORITHM`, or delete it and state that any token
in flight at deploy time is invalidated. Decide a date after which a missing `typ` is refused and
record it. Either wire `verifyRefreshToken` into the refresh path or mark both functions deprecated
so the next reader does not take them for live surface. Delete `lastError`.

**Definition of Done**
- [ ] the commit-message claim and `jwt.util.js`'s own comment agree about `typ`-less tokens
- [ ] no verification path uses an algorithm other than the pinned one
- [ ] `generateRefreshToken` / `verifyRefreshToken` are either used or marked dead
- [ ] a named test asserts a `typ: "refresh"` token is refused by `verifyAccessToken` **and** that a legacy `typ`-less token is still accepted (the documented deliberate gap)

---

## V-12 — the attachments gating rationale rests on a false premise

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/src/routes/api/attachments.route.js:40-42` — "There is **NO** `attachments` slug in MENU_SLUGS (roleConstants.js). Naming one here would produce an A-07 instance". `backend/src/utils/seedMenuGroups.util.js:36` and `:431` — slug `attachments`, id `a0000000-…-210`, `parentSlug: "mgmt-content"`. |
| **Spec refs** | A-07 · A-28 |

**Why it matters.** The conclusion (use `equipment`) happens to be right, but for a reason the
comment does not give: `attachments` **is** seeded as a menu group, it is simply absent from
`MENU_SLUGS` and therefore from `ROLE_MENU_ASSIGNMENTS`, and its parent `mgmt-content` is not
assigned either — so it would inherit nothing and deny everyone but SUPER_ADMIN. The recorded
recommendation ("add a dedicated `attachments` slug to MENU_SLUGS") will therefore look like a
one-line change and will not be: it also needs role assignments seeded, or a parent that carries
them. As written, the next agent adds the constant, re-points the gates, and locks every technician
out of calibration evidence.

**Fix direction.** Correct the comment to state what is actually true — the slug exists in
`menu_groups`, it has no role permissions and no assigned parent — and expand the A-28
recommendation to include the seeding step. This is also the concrete instance A-07 was waiting for;
worth promoting A-07 out of "unverified".

**Definition of Done**
- [ ] the route comment matches `seedMenuGroups.util.js`
- [ ] the A-28 recommendation names the seeding work, not just the constant
- [ ] A-07 records `attachments`, `mgmt-*`, `api-keys`, `webhooks`, `reports`, `sessions` as slugs seeded with no role assignment

---

## V-13 — SOP separation of duties returns 409 for an identity condition

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/src/services/sop.service.js` — `if (String(doc.authorId) === String(publisherId)) throw new AppError(409, "SOP … was authored by you …")`. `CLAUDE.md` § Status Codes That Carry Meaning: 403 = "permission failure **inside the caller's own tenant**"; 409 = "invalid state transition". |
| **Spec refs** | `CLAUDE.md` § Status Codes · A-28 |

**Why it matters.** "This SOP is `PUBLISHED` and cannot be published again" is a state transition
and the 409 there is exactly right — that one is a model of what `CLAUDE.md` asks for. "You wrote
this one, so you may not release it" is a property of the *caller*, not of the document: the same
document in the same state is publishable by the next person. Under the table that is a 403 carrying
an explanation. The distinction matters to the frontend, which will retry-or-explain differently.

Secondary, and worth an Open Question rather than a judgement call: a tenant with a single
administrator can now never publish an SOP at all. That is arguably correct for 21 CFR 11.10(d) and
arguably a support incident; it is not recorded as a decision anywhere.

**Fix direction.** Return 403 with the same explanatory message for the author case, keep 409 for
`PUBLISHED`/`ARCHIVED`. Raise the single-admin tenant as an Open Question in `TASKS/BACKLOG.md`.

**Definition of Done**
- [ ] author-is-publisher returns 403; already-published returns 409; both carry the explanation
- [ ] the single-admin tenant case is an Open Question with an owner
- [ ] `docs/` for SOP publishing lists both codes

---

## V-14 — the limiter's Lua script drops the `revoked` flag on the next increment

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low (pre-existing shape, preserved by the rewrite) |
| **Evidence** | `backend/src/services/rateLimiter.redis.service.js` — `INCR_ENTRY_SCRIPT` writes `{ count, firstAttempt, expiresAt }`, discarding any other key. `recordAuthFailure`: `if (count >= 3 && !entry?.revoked) { await storeSet(tokenKey, { count, revoked: true, firstAttempt }, ttlMs); }`. |
| **Spec refs** | A-30 |

**Why it matters.** On the 3rd failure the entry is rewritten with `revoked: true`. On the 4th, the
script reads it, writes a fresh entry without `revoked`, and the `!entry?.revoked` guard — now
looking at the *previous* entry, which did have it — suppresses the rewrite. From the 4th failure
onward the token is no longer marked revoked in the store. The old read-then-write code had the same
hole, so this is not a regression, but A-30 rewrote these exact lines and left it. `blocked` /
`blockUntil` survive only because their condition stays true and re-writes them every time.

**Fix direction.** Have the script merge unknown keys from the previous value rather than replacing
the object, or make the revocation write unconditional once `count >= 3`. A test that records five
consecutive failures and then reads the entry would catch it; the current tests stop at three.

**Definition of Done**
- [ ] a named test records `maxAttempts + 2` failures and asserts `revoked` is still set
- [ ] the script's contract about which keys it preserves is stated next to it

---

## V-15 — `ownTenantOnly` recognises only one spelling of super admin

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/src/routes/api/tenantHierarchy.route.js` — `if (req.user?.role?.name === ROLE_NAMES.SUPER_ADMIN) return next();` where `ROLE_NAMES.SUPER_ADMIN === "SUPERADMIN"`. Every other gate in the codebase accepts both spellings: `auth.middleware.js:133-136`, `dynamicAccess.middleware.js:52`, `rbac.middleware.js:47`, `config/socket.js` `isSuperAdminRole`. |
| **Spec refs** | A-01 |

**Why it matters.** Four call sites accept `"SUPER_ADMIN"` *or* `"SUPERADMIN"` because at some point
both existed. The new guard accepts one. If any deployment carries the other spelling, the platform
admin gets a 404 on tenant-hierarchy reads — indistinguishable, by design, from "no such tenant",
which is the one place that ambiguity is expensive to debug.

**Fix direction.** Use the shared predicate (`isSuperAdminRole`, currently private to `socket.js`)
and export it once from `constants` or a `role.util`. Nine copies of a two-way string comparison is
itself the finding.

**Definition of Done**
- [ ] one exported super-admin predicate, used by auth, rbac, dynamicAccess, socket and this guard
- [ ] a test asserts both spellings resolve identically

---

## V-16 — unflagged consumer-visible changes

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/src/routes/api/risk.route.js` — reads now require `risk:read`; the route comment says a TECHNICIAN or USER gets 403 on **every** route including reads, but the commit message says only that the register was "mutable by any role". `backend/src/routes/api/storage.route.js` — `GET /usage` moved from `auth` to tenant-admin. `backend/src/services/scim.service.js` `parseUserFilter` — an unrecognised SCIM filter is now a **400**; previously it was ignored and the whole tenant was returned. `backend/src/controllers/health.controller.js` — public body `{status:"ok"}`. `frontend/src/lib/socket.ts:29` uses `auth: { token }`, so the query-string rejection is safe — but nothing asserts that. |
| **Spec refs** | `CLAUDE.md` § When to Act |

**Why it matters.** Each of these is defensible; none of them is wrong. But the commit message is
the record, and a reader reconstructing the change from it will not learn that risk *reads* became
privileged, that storage *usage* became privileged, or that a SCIM filter that used to be tolerated
is now rejected. The SCIM filter change in particular is the kind of thing an IdP integration
discovers in production.

**Fix direction.** Add them to `MEMORY/CHANGELOG.md` under a "consumer-visible" heading, and add a
frontend assertion (or at least a note in `docs/ARCHITECTURE/10-REALTIME-ARCHITECTURE.md`) that the
socket client must use `auth`, not `query`.

**Definition of Done**
- [ ] every status-code or visibility change in this batch appears in `MEMORY/CHANGELOG.md`
- [ ] the SCIM filter change is in `docs/DEVELOPER/09-SCIM-PROVISIONING.md` with the supported grammar
- [ ] a frontend test or lint rule prevents a query-string socket token regressing

---

## V-17 — flags written but never read

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Evidence** | `backend/src/services/eSignature.service.js:24` — `SIGNATURE_ALGORITHM = process.env.SIGNATURE_ALGORITHM \|\| "RS256"` is stored on every record and bound into the canonical payload, but signing is `crypto.sign("sha256", …)` and verification is `crypto.verify("sha256", …)` — both hardcoded. Setting `SIGNATURE_ALGORITHM=RS512` relabels records without changing a byte of the algorithm. `:25` — `SIGNATURE_KEY_SIZE` is read by `generateKeyPair` only. `backend/src/utils/jwt.util.js:252` — `const lastError = null` never read. |
| **Spec refs** | ADR-040 |

**Why it matters.** A label that can disagree with the thing it labels is a trap in a compliance
record: an auditor reading `signature_algorithm = 'RS512'` on a SHA-256 signature is being told
something false, and the canonical payload binds the false label rather than the real algorithm.

**Fix direction.** Derive the digest from `SIGNATURE_ALGORITHM` (`RS256 → sha256`, `RS512 → sha512`)
and refuse an unsupported value at load, the same way `jwt.util.js` now refuses an unsupported
`JWT_ALGORITHM`. Or drop the environment variable and hardcode the constant that is actually used.

**Definition of Done**
- [ ] `signature_algorithm` on a record names the algorithm that produced it
- [ ] an unsupported `SIGNATURE_ALGORITHM` fails at load, not silently
- [ ] `lastError` is removed

---

## Reviewed and found sound

A review that lists only faults says nothing about its own coverage. The following were read in
full and I found no defect in them.

**`services/eSignature.service.js` — the new signature scheme (A-47 / ADR-040).** The central
question was whether the canonical payload is deterministic. It is: `CANONICAL_FIELDS` fixes the
order in one array, `canonicalizeSignaturePayload` emits `[name, value]` **pairs in an array** so
JSON key ordering cannot matter, and every value is coerced with `null`/`undefined` collapsed to
`""`. Nothing on the verify path is derived from the current clock — `canonicalTimestamp` is applied
to the **stored** `signedAt` on both sides, and `signedAt` is computed once at `:511` before
anything is signed and is the same value persisted at `:557`. `signature_records.signed_at` is
`DataTypes.DATE` (timestamptz, millisecond round-trip through node-postgres), so the ISO-8601
rendering is stable. A soft-deleted key still verifies its past signatures — `loadVerificationKey`
passes `paranoid: false` deliberately and says why. The private key is **not** loaded on the verify
path: `loadVerificationKey` leaves the model's `defaultScope` (`attributes: { exclude: ["privateKey"] }`)
in place, while `loadSigningKey` opts back in with `.unscoped()` on the sign path only. Pre-fix rows
are reported `unverifiable_legacy` rather than valid or forged, `valid` stays a strict boolean, and
the eight `verificationStatus` values are exhaustive over the branches. `esignature.signing.test.js`
uses real RSA key material and real `crypto` rather than a mocked signer, which is the right call and
the reason the original defect could not have survived it.

**`migrations/0019-add-signature-crypto-fields.js`.** It does what its header says and it is safe to
run twice: every `addColumn` is guarded by `describeTable`, the index by `showIndex`, and `down`
mirrors both. There is no blanket `try/catch` — the trap in `CLAUDE.md` — and the header says so
explicitly. All four columns are nullable with no backfill, which is what makes the legacy
discrimination in `verifySignature` correct rather than a guess. `context.queryInterface || context`
handles both Umzug context shapes.

**`middlewares/bodyDefault.middleware.js` and its mounting.** It mutates only an **absent** body
(`req.body === undefined`), leaving a parsed object, array, string or Buffer untouched — so the
Stripe raw-body path (`index.js:260`, `verify` hook stashing `req.rawBody`) is unaffected. It is
mounted at `index.js:285`, after both parsers and before the sanitizer, the timeout, the access log
and every router (first router mount is `:436`). `backend/index.js:80` is the only `express()` in the
backend, so there is no second app that could miss it. 43 controller reads additionally carry
`|| {}` and ~27 do not; harmless with the middleware mounted, and the belt-and-braces layering in
`validation.middleware.js` (`req.body ?? {}`) and all 31 validator helpers is correct.

**`services/rabbitmq.service.js` and `services/emailQueue.service.js` (A-36, A-26).** The `isOpen`
diagnosis is right — amqplib defines no such property — and the replacement tracks liveness through
`"close"`/`"error"` with an identity check so a late event from a superseded connection cannot evict
its replacement. `closeRabbitMQ` now clears the cache in a `finally`, which it had to once the cache
started hitting. The test mocks were rewritten to expose only what amqplib exposes and say so in a
comment; `health.service.test.js`'s `connected: false` mock is **not** a fourth instance of the
invented-property mistake — `IotService` really does maintain `this.connected` (`iot.service.js:8`).
`claimMessage` fails open on an unreachable Redis, checks `client.status !== "ready"` (not
`.connected`), and the "this is not exactly-once" caveat lists the three ways it can still lose or
duplicate — including that a crash between claim and send loses the email. That is the right level
of honesty. The email retry path releases the claim before re-publishing the same `job.id` and
`nack(msg, false, false)` prevents a double.

**`services/stripeWebhook.service.js` (A-25).** `findOrCreate` → `findOne` + explicit update is
correct, `Paid` is treated as terminal against Stripe's unordered delivery, `amountPaid` is
monotonic, and the DECIMAL-comes-back-as-a-string detail is handled. The webhook route carries no
`auth`, so no `AsyncLocalStorage` context exists and `tenantScope.util.js:54` returns
`{ mode: "skip" }` — the `findOne` therefore really does see the row. `stripeInvoiceId` is globally
unique from Stripe, so the unscoped lookup is not an existence oracle.

**`config/socket.js` (A-05).** The handshake genuinely mirrors `auth.middleware.js#auth`: same
loader, same `mfaRequired` rejection, same `isActive` / `INACTIVE` / `SUSPENDED` checks, same tenant
suspension check, and every rejection returns one opaque `AUTH_ERROR` with the reason logged
server-side only. The query-string token is refused rather than quietly ignored, and
`frontend/src/lib/socket.ts:29` already uses `auth: { token }` so nothing breaks.
`withTenantContext` is applied to `kanban:join`, the only handler that queries — `kanban:leave` and
`disconnect` do not touch the database. `socket.tenantContext` is built in the same shape
`tenantContext.middleware.js` builds for HTTP, including `isSuperAdmin`, so the Sequelize hooks
behave identically on both transports.

**`services/scim.service.js` (A-33, A-27).** The `op.path` handling matches RFC 7644 § 3.5.2,
including the schema-URN prefix form Entra ID sends, Okta's `members[value eq "…"]` filter, and
`"True"`/`"False"` string booleans. Both patch forms funnel through `applyUserAttribute`, which is
what keeps `assertAssignableRole` unavoidable on every `roleId` write — the property the A-27 fix
depends on. An operation with an unparseable path is a 400, never a silent no-op, which was the
original defect's whole shape. `assertMutableGroup` correctly refuses renaming or deleting a system
role given that roles are global here.

**`services/userPermission.service.js` (A-35).** The diagnosis — matrix keyed by name, lookup by
slug — matches `dynamicAccess.middleware.js:272`, and indexing by both name and slug mirrors what
`roles.service.js#getRolePermissionsMatrix:313-330` already does. `userPermission.service.test.js`
asserts a `none` override actually revokes.

**`services/webhook.service.js` (A-50).** `redirect: "manual"` plus an explicit 3xx→failure branch
is the correct fix; the SSRF check validates the registered URL, so not following the redirect is
the only way to keep that check meaningful. `lastError` carries the explanation into the delivery row.

**`services/iot.service.js` and `controllers/iot.controller.js` (A-45).** Both `.unscoped()` calls
now carry `isDeleted: false` explicitly, which is exactly right — `.unscoped()` is needed to cross
tenants on a device token and drops the soft-delete predicate as a side effect. The unawaited
`ingestReading` now has a `.catch`, which is what stops one stale retained MQTT message reaching the
process-level `unhandledRejection` handler and calling `shutdown()`.

**`middlewares/accessLog.middleware.js` (A-44).** `history` is indeed rotating-file-stream's history
*filename*, not a retention period; `maxFiles: 30` is the correct replacement.

**`routes/api/tenantHierarchy.route.js` (A-01).** `ownTenantOnly` returns **404**, not 403, on a
cross-tenant id — the rule `CLAUDE.md` is most insistent about, and the one most often got wrong.
Mutations are `[auth, denyApiKey, superAdminOnly]`. The diagnosis (the `Tenant` model has no
`tenantId`, so `tenantScope.util.js` never applies to it) is correct and checkable.

**`services/attachment.service.js` and `services/sop.service.js` (A-28).** Both write the mutation
and its audit row inside one `db.transaction`, both take `db` from `../config` rather than the models
barrel and say why, and both use `isDeleted` rather than `is_deleted`. The attachment 409 —
"evidence for certificate X, which is approved" — is a state explanation naming the state and the
remedy, which is the standard `CLAUDE.md` sets and which most of this codebase does not meet.

**Deleted `sessionSecurity.middleware.js` (A-12).** Confirmed dead: no route or `index.js` mount
referenced it, and its two test files went with it. Removing it while eleven documents described it
as live is the right order of operations, and A-48 records what is now honestly missing.

**Infrastructure (A-17).** The `1883` port mappings really did publish a port with nothing behind
it — the backend is an MQTT client and no broker is embedded — and removing them from both compose
files, with a comment explaining what to publish if a sidecar is ever added, is the right fix.

---

## Appendix — commit-message claims the code does not support

| Claim | Where the code says otherwise |
|---|---|
| "webhooks and storage settings are tenant-admin only" (`e326ae5`) · "Issuance is now TENANT_ADMIN-only" | `auth.service.js:451` never loads `roleLevel`, so `rbac.middleware.js:39` yields `0` and only SUPERADMIN passes — V-01 |
| "scopes must name a real menu slug" (`e326ae5`) | `apiKey.service.js:39` uses `MENU_SLUGS` (31 entries); the gates resolve against `menu_groups` (56 seeded slugs). `calibration`, `certificate`, `users`, `vendors`, `attachments` … cannot be named — V-02 |
| "Token types are now claimed and enforced" (`c131729`, A-31) | `jwt.util.js:70` — a token with no `typ` is accepted, and the two functions that carry the refresh claim have no call sites — V-11 |
| "…or an unpinned algorithm" (A-31) | `jwt.util.js:290` — the fallback always verifies `HS256` against `ACCESS_SECRET`, whatever `JWT_ALGORITHM` pins — V-11 |
| "every controller but two is wrapped" (`controllerWrapper.util.js:23`) | Three are not: `health`, `iot`, `predictiveMaintenance` — V-05 |
| "`allowApiKey` is the explicit opt-in" (`e326ae5`, A-03) | It has no call sites; `scim.route.js:42` sets the flag inline — V-05 |
| "There is NO `attachments` slug in MENU_SLUGS … naming one here would produce an A-07 instance" (`attachments.route.js:40`) | `attachments` **is** a seeded menu slug (`seedMenuGroups.util.js:431`); the real reason the gate would fail is that neither it nor its parent `mgmt-content` is in `ROLE_MENU_ASSIGNMENTS` — V-12 |
| "308 suites, 6,122 tests, 100%" (`c131729`) | A clean run here collected 309 suites / 6,128 tests with one timing failure — V-07 |
| "signature_reason … the meaning of the signature (21 CFR 11.50(a)(3))" (`0019`, ADR-040) | The validator strips `reason` and the controller never forwards it; the column is always NULL — V-04 |
| A-34 "DONE"-adjacent framing | `make verify` still fails at `lint` with 1,297 errors; `CLAUDE.md` still lists two failing gates — V-06 |
