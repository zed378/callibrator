# Phase 6 — Correctness and Compliance

**The debt that blocks a defensible release.**

Everything here sits underneath what Phases 0–5 built. Building Phase 7 on top of it would compound, which is what the phase rule exists to prevent.

---

### P6-01 — Restore the backend coverage gate

| | |
|---|---|
| **Status** | ✅ DONE — verified 2026-09-11 · **NEEDS EDIT (2026-09-23)** |
| **Depends on** | — |
| **Spec refs** | `docs/BACKEND/09-TESTING.md` · `docs/TESTING/01-UNIT-TESTING.md` |
| **Spec required** | no |

> **What changed (2026-09-23):** the figure recorded below is right and means less than it reads.
> `jest.config.js` puts `src/models/`, `src/config/`, `src/constants/`, `src/scripts/` and
> `src/docs/` in `coveragePathIgnorePatterns`, so **"100% across the board" is 100% of six layers**
> — controllers, middlewares, routes, services, utils, validators. `collectCoverageFrom` also
> names `src/app.js`, **which does not exist**; the real entry point is `backend/index.js` and it
> is measured by nothing. Behind the figure sit **46 `istanbul ignore` directives in non-test
> `src`, 25 of them with no reason** (A-32 counted 58/31 before the remediation; A-30 removed 12 of
> them from the rate limiter by making that code reachable). The suite is also larger than the
> record: **309 suites** today, not 289. → **P6-14**.

**Why:** the suite runs against a 100% threshold and was below it. **A gate that is currently failing is a gate nobody trusts**, and every other gate in the project is judged by whether this one is respected.

Previously uncovered: `seedDemoData()` and its helpers, certificate submit-for-approval (service and controller), `qms.validator`, the data-retention `legalHoldSchema`, the tenant subdomain-derivation branch, and the param-merge branches.

**Verified 2026-09-11:**

```
npx jest --coverage
All files      100 |      100 |     100 |     100
Test Suites:   289 passed, 289 total
Tests:         5735 passed, 5735 total
exit 0
```

**One caveat, and it is the reason this is worth reading twice.** The documented command — `npm test` / `npm run test:coverage` — **does not run**: the script is `node node_modules/jest/bin/jest.js`, a hardcoded path that does not resolve when the workspace install hoists `jest` to the repo root. It fails with `MODULE_NOT_FOUND`, which looks nothing like a coverage failure. The gate passes; the script that invokes it is broken. → **P6-01a**.

**Definition of Done**
- [x] the suite passes at the configured threshold (via `npx jest --coverage`)
- [x] each uncovered branch is either tested, or excluded with a **recorded reason**
- [x] the exact result from a full run is captured above
- [ ] **`npm run test:coverage` itself runs** — P6-01a

**Abuse cases**
- The threshold is lowered rather than the tests written
- The demo seeder is excluded without recording why

---

### P6-02 — One clean full E2E pass, uninterrupted

| | |
|---|---|
| **Status** | 🔴 TODO — **NEEDS EDIT (2026-09-23)** |
| **Depends on** | — |
| **Spec refs** | `docs/TESTING/03-E2E-TESTING.md` |

> **What changed (2026-09-23):** the suite is **53** specs, not 51. Counted directly:
> `find backend/src/tests/e2e -name '*.test.js'` → 53. The Makefile's `test-e2e` help text and
> this card both said 51; `CLAUDE.md` and Phase 9's P9-00 say 53. A target nobody agrees on cannot
> be signed off. Separately, **A-49 records an e2e spec that cannot pass** — the SCIM one — so a
> clean run needs that named as a known-impossible spec or the spec fixed first.

**Why:** every fix has been verified live and **individually**. The suite has never passed as a suite, because the global rate-limit window kept needing to reset.

**A suite that has never passed as a suite has not passed.**

**Definition of Done**
- [ ] all **53** specs green in **one uninterrupted run**
- [ ] the count is re-derived from the tree at the start of the run and the command recorded — the 51/53 disagreement above is how a "full pass" quietly becomes a partial one
- [ ] no 429s in the output
- [ ] no spec touched the default tenant destructively
- [ ] environment-dependent failures (`/ai`, GDPR export, PDF without Chromium) are **named as such**, not counted as passes
- [ ] the SCIM spec A-49 describes is fixed, or named as impossible with its audit id

**Abuse cases**
- Specs are skipped to reach green
- The run is split and the halves reported as one pass
- A 429-driven failure is retried until it passes and called clean

---

### P6-03 — `REVOKE UPDATE, DELETE` on `calibration_records`

| | |
|---|---|
| **Status** | 🔴 TODO |
| **Depends on** | — |
| **Spec refs** | `docs/PLAN/07-CALIBRATION-PROGRAM.md` · `docs/DATABASE/07` · `docs/PLAN/15-COMPLIANCE-STANDARDS.md` |
| **Spec required** | **yes** |

**Why:** BR-7 says calibration records are append-only. The model is `paranoid` and the API exposes `PUT` and `DELETE`. **The guarantee is a service-layer convention, not a constraint.**

Contrast `audit_logs`, protected by having no delete path at all. Under 21 CFR Part 11 scrutiny this is the finding an auditor raises first (PR-2).

**Definition of Done**
- [ ] `REVOKE UPDATE, DELETE ON calibration_records` for the application role, in a migration
- [ ] the `PUT` and `DELETE` routes removed, or restricted to an audited correction path
- [ ] a test proving the delete fails — **run as the application role, not the owner**
- [ ] `docs/` amended and an ADR written
- [ ] a mutation check: grant the permission back, watch the test fail

**Abuse cases**
- The test runs as the database owner, where it passes whether the grant exists or not
- The routes are removed but the grant is not, leaving the hole for any other caller

---

### P6-04 — Build guard: no route without a permission gate

| | |
|---|---|
| **Status** | ⏳ TODO — **NEEDS EDIT (2026-09-23)**, and the case for it is now empirical rather than theoretical |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` § "The failure mode nothing prevents" · [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) A-01, A-02, A-03, A-27 · `AUDIT-2026-09-AUTHZ-MATRIX.md` |

> **What changed (2026-09-23):** the audit found the defect this guard exists to prevent, four
> times, live. **A-01** — any authenticated principal could write another tenant's
> `tenant-hierarchy` (critical). **A-02** — webhook, storage-settings and custom-domain routes
> guarded by `auth` alone (high). **A-03** — API keys ignored their scopes on every route without
> `dynamicAccess` (high). **A-27** — any account could mint a `*` API key (critical). All four are
> fixed **by hand, route by route**. Nothing stops the fifth.
>
> Two further facts this card should now carry: the route tree is **55 files** across
> `routes/api/` (53) and `routes/internal/` (2), so a guard that globs `src/routes/*.js` misses
> the internal subtree entirely; and **A-07 is still open and still unverified** — `dynamicAccess`
> may be called with resource names that match no menu slug, which is a gate that is present and
> does nothing. A guard that only checks for presence passes those.

**Why:** a new route with no `dynamicAccess` or `rbac` call **works for everyone with a token**, and nothing fails the build. This is the single most likely authorization defect in the codebase, and it has no mechanism against it.

**Definition of Done**
- [ ] a script failing any diff that adds a `router.<verb>` call with no permission gate
- [ ] it walks `src/routes/**` recursively — `api/` **and** `internal/`
- [ ] it checks the **resolved resource name against the menu-slug set**, not merely that a gate is present (A-07). A gate naming a slug that does not exist is the same hole with a longer line of code
- [ ] wired into `make verify` **and** a real hook or pipeline — no `pre-push` hook exists yet, whatever older documents say (A-19: no `.husky/`, no `lefthook`, no `core.hooksPath`)
- [ ] **tested both directions**: a gated route passes, an ungated one fails
- [ ] documented exemptions for the public endpoints, listed explicitly — and it is the **same list** P9-21's `public()` marker uses, not a second one that drifts
- [ ] run once over the whole tree, not only over diffs, and the result recorded. A diff-only guard never sees the routes that were already wrong

**Abuse cases**
- The exemption list becomes a place to put anything inconvenient
- The guard checks for the string rather than the call position, and a comment satisfies it
- It is wired to diffs only, so the four routes A-01/A-02/A-03/A-27 found would still have shipped

---

### P6-05 — Post-migration column verification

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/DATABASE/13-MIGRATIONS.md` |

**Why:** a migration wrapped in a blanket `try/catch` around `describeTable` is **recorded as applied while doing nothing**. Umzug reports success, the column never appears, and the failure surfaces weeks later (PR-5).

**Definition of Done**
- [ ] a step comparing expected columns against `information_schema` after migrating
- [ ] fails loudly on a mismatch
- [ ] wired into `make migrate` and any future CI
- [ ] existing migrations audited for blanket catches

**Abuse cases**
- The verification itself is wrapped in a catch

---

### P6-06 — Composite unique on `(tenant_id, serial_number)`

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/DATABASE/06-DEVICE-TABLES.md` · `docs/SECURITY/05` |
| **Spec required** | **yes** |

**Why:** `calibration_devices.serialNumber` is `unique: true` on the column — **globally unique across all tenants**. Two consequences: two hospitals cannot both register the same manufacturer serial, and a uniqueness failure reveals that another tenant holds it. A weak cross-tenant oracle.

**Definition of Done**
- [ ] expand-and-contract migration to a composite unique on `(tenant_id, serial_number)`
- [ ] partial on `is_deleted = false`, so a soft-deleted device does not hold its serial hostage
- [ ] existing duplicates identified and resolved before the constraint lands
- [ ] a test: two tenants can hold the same serial
- [ ] a test: one tenant cannot hold it twice

**Abuse cases**
- The old constraint is dropped and the new one is not added, in the same release

---

### P6-07 — Mandatory MFA at role level 10

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` |

**Why:** `SUPERADMIN` bypasses every permission check and every tenant predicate, and **there is no second gate behind it**. MFA is available and not enforced, so that account is one credential away from total compromise of every tenant (PR-3).

**Definition of Done**
- [ ] MFA enforced at login for `ROLE_LEVELS >= 10`, not merely requested at onboarding
- [ ] an enrolment path that does not lock out an existing super-admin
- [ ] a documented break-glass procedure — and it must not be "disable the check"
- [ ] tests: a super-admin without MFA cannot complete a login

**Abuse cases**
- The check is client-side
- The break-glass path becomes the normal path

---

### P6-08 — Align Swagger with the GDPR validators

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/API/13-INTEGRATION-API.md` · `docs/BACKEND/03-VALIDATION.md` |

**Why:** the published contract and the enforced Joi schemas disagree for the GDPR endpoints. **Documented drift is still drift**, and a client written from the spec will fail (AC-29).

**Definition of Done**
- [ ] annotations match the validators for every `/gdpr` endpoint
- [ ] `npm run swagger:generate` reflects it
- [ ] a check that the spec is regenerated on build — it already is, but verify
- [ ] a sweep for the same divergence elsewhere

---

### P6-09 — Reason required on every stock quantity change

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/DATABASE/05-WAREHOUSE-TABLES.md` · `docs/UI-UX/13-WAREHOUSE-UX.md` |

**Why:** every quantity change is supposed to route through adjustment, transfer or opname — each of which captures a reason and an actor. **`PATCH /api/v1/stocks/:stockId` can change `quantity` directly**, bypassing all three. The UI does not offer that path, which means the interface is currently the only thing preventing an unexplained quantity change.

**Definition of Done**
- [ ] the endpoint rejects a `quantity` change, or requires a reason and writes an adjustment
- [ ] a test proving a bare quantity change is refused
- [ ] `docs/` amended

**Abuse cases**
- A reason field is added and accepts an empty string

---

### P6-10 — Rotation procedure for the two unrotatable secrets

| | |
|---|---|
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md` · `docs/SECURITY/12-INCIDENT-RESPONSE.md` |
| **Spec required** | **yes** |

**Why:** `CERT_SIGNING_SECRET` cannot be rotated without breaking verification of every certificate ever issued. `ENCRYPT_KEY` cannot be rotated without re-encrypting every wrapped value.

**There is no procedure for either**, which means "rotate the key" is not an available response to a suspected compromise. That is far cheaper to design in advance than to improvise during an incident.

**Definition of Done**
- [ ] a design for certificate key versioning — old certificates verify against the key they were issued under
- [ ] a re-encryption procedure for `ENCRYPT_KEY`, with a rollback
- [ ] both rehearsed against a copy of production data
- [ ] an ADR

**Abuse cases**
- The procedure is written and never rehearsed, which is the same as not having one

---

## Added 2026-09-23 — from the backend audit

Four open findings in [`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) belong to
this phase and were not on it. The audit cards own the evidence and the fix direction; these cards
own the phase dependency and the exit criterion. **Neither duplicates the other** — P6-11 to P6-14
are not `DONE` until their `A-` card is.

---

### P6-11 — Audit rows inside the transaction

| | |
|---|---|
| **Status** | 🔴 TODO — **references [A-41](./AUDIT-2026-09-REMEDIATION.md)** (wave 0, high) |
| **Depends on** | — · blocks **P9-19** (do not convert `auditLog.middleware.js` first) |
| **Spec refs** | `docs/PLAN/15-COMPLIANCE-STANDARDS.md` · `docs/BACKEND/10-MODULE-REFERENCE.md` · `00-TASK-CONVENTIONS.md` § Compliance |
| **Spec required** | **yes** — the covered set is a decision, not a patch |

**Why:** `CLAUDE.md` states it without qualification — *every mutation writes an audit row, inside
the transaction* — and `auditLog.middleware.js#recordAudit` registers on `res.on("finish")`. It
runs **after** the response, outside any transaction, and its own JSDoc calls itself "best-effort".
Both failures the rule exists to prevent are therefore live: a rolled-back action can leave an
audit row recording something that did not happen, and a committed action can leave none, silently.

This is the phase that exists for *"the debt that blocks a defensible release"*, and this is the
control the ISO 17025 and 21 CFR Part 11 claims rest on. It belongs here and nowhere else.

**Definition of Done**
- [ ] A-41 closed with its own verification: a rolled-back mutation leaves **no** audit row, proved with a forced rollback
- [ ] a failing audit insert rolls the mutation back
- [ ] **the list of covered mutations is written down** — a spec, agreed, not inferred from which services happened to be changed
- [ ] the middleware's remaining role is stated: what it still records, and that nothing compliance-bearing depends on it
- [ ] a failed audit write is **visible** — which is A-42, routed to P7-03. This card is not `DONE` while the only report of a failure is a `console.error` production discards

**Abuse cases**
- The transaction is passed to the audit write but the write is still `await`-less, so a rejection floats and the commit proceeds
- "Covered mutations" is defined as whichever services were easy to change

---

### P6-12 — Revocation that revokes

| | |
|---|---|
| **Status** | 🔴 TODO — **references [A-48](./AUDIT-2026-09-REMEDIATION.md)** (wave 0, high) |
| **Depends on** | — · blocks **P9-12** (it changes the shape of the authenticated principal) |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` · `docs/BACKEND/10-MODULE-REFERENCE.md` § 23 |
| **Spec required** | **yes** — per-request session lookup is an architecture change |

**Why:** `auth.middleware.js` says so in its own comment — *"RBAC Only - No Session Validation"*.
It verifies the JWT and loads the user, and **nothing in the request path reads `sessions`**, now
that the dead `sessionSecurity.middleware.js` is gone (A-12). So logging out, revoking a session,
or an administrator terminating someone's access changes a row no request consults.

**The window is not the documented one.** `.env.example` says `JWT_ACCESS_EXPIRED=15m`; the running
deployment on 10.1.200.13 and the local `.env` are both `1d`. A revoked session stays usable for up
to **24 hours** — and the figure in the documentation is the one nobody is running.

This is the control an administrator reaches for when credentials are suspected stolen, when
someone leaves, or when a tenant is suspended mid-session. It reports success and does nothing for
a day.

**Definition of Done**
- [ ] A-48 closed: a revoked session's access token is rejected on the **next** request
- [ ] a suspended tenant's live sessions stop working without waiting for expiry
- [ ] `JWT_ACCESS_EXPIRED` is the **same number** in `.env.example`, on the VM, and in the documentation
- [ ] the same question answered for Socket.IO, whose checks are connect-time only (A-05, Q-08)
- [ ] if the answer is the honest mitigation rather than the control — shorten the lifetime and call revocation eventual — **the window is named in the security documentation**, not left implied
- [ ] the session lookup is cached in Redis (working since A-24) and **the cache key includes the tenant id** (`00-TASK-CONVENTIONS.md` § Security)

**Abuse cases**
- The lookup is added and then cached without invalidation on revoke, so revocation is still eventual and now also looks solved
- The deployed `JWT_ACCESS_EXPIRED` is changed and the documentation is not, reversing which number is the lie

---

### P6-13 — Webhook routes: validate the input, own the secret

| | |
|---|---|
| **Status** | 🔴 TODO — **references [A-51](./AUDIT-2026-09-REMEDIATION.md)** (wave 0, high) |
| **Depends on** | P6-04 would have caught the missing gates; it does not catch a missing **validator** |
| **Spec refs** | `docs/BACKEND/03-VALIDATION.md` · `docs/SECURITY/07-CRYPTOGRAPHY-AND-SECRETS.md` · `docs/API/13-INTEGRATION-API.md` |
| **Spec required** | **yes** — rotation with an overlap window is a contract change for receivers |

**Why:** **none of the seven webhook routes mounts `validate(schema)`.** Four consequences from one
root: the controller spreads `{ ...req.body }` into `createWebhook`, which honours a
**caller-supplied `secret`** — so `{"secret":"a"}` creates a webhook whose HMAC signatures are
trivially forgeable, the secret is never displayed again, and nothing warns. `url`, `events` and
`isActive` are unvalidated beyond two service-level checks. `webhooks.secret` is stored **in
plaintext** — not in `SENSITIVE_KEYS`, not through `kms.service.js`, unlike every other tenant
secret — so a database read or a backup yields every tenant's signing key. And there is **no
rotation**: patching the `url` keeps the old secret, so a new host is signed with a key the old
host still holds.

**Definition of Done**
- [ ] A-51 closed: a Joi schema on every one of the seven routes, mounted as `validate(schema)` — **not** `schema.validate`, which 500s every request to the route it is passed to
- [ ] path parameters reach the validator: `{ ...req.params, ...req.body }`, or the route 400s on every request
- [ ] the secret is **generated server-side only** and never accepted from a caller; a request that supplies one is rejected, not ignored
- [ ] stored through `kms.service.js` like the other tenant secrets, and added to `SENSITIVE_KEYS`
- [ ] a rotation endpoint returning the new secret **once**, with an overlap window
- [ ] a test that the secret is absent from every response body, every log line and `audit_logs.changes`
- [ ] the two-tenant 404 test on each `:id` route (`CLAUDE.md`, and A-55 — the fixture it depends on does not exist yet)

**Abuse cases**
- A schema is added that accepts `secret` and drops it silently, so an integrator believes they set one
- Rotation is added without the overlap and every receiver breaks at once

---

### P6-14 — Make the coverage figure mean what it says

| | |
|---|---|
| **Status** | 🔴 TODO — **references [A-32](./AUDIT-2026-09-REMEDIATION.md)** (wave 0, low) |
| **Depends on** | P6-01 · blocks **P9-03a**, and through it every Stage B–D card whose DoD says "still at 100%" |
| **Spec refs** | `docs/BACKEND/09-TESTING.md` · `docs/TESTING/01-UNIT-TESTING.md` · `00-TASK-CONVENTIONS.md` § Evidence |

**Why:** P6-01 is `DONE` and its evidence is honest. The figure it certifies is not as broad as it
reads, and Phase 9 repeats *"tests converted with the module and still at 100%"* seventeen times.
A gate nobody has read the scope of is a gate that gets cited rather than checked — the failure
`00-TASK-CONVENTIONS.md` § Evidence is about.

Counted from `backend/jest.config.js` and `backend/src`, 2026-09-23:

| | |
|---|---|
| **46** `istanbul ignore` directives in non-test `src`, **25 with no reason** | A-32 counted 58/31 on 2026-09-21; A-30 removed 12 by making the rate limiter's Redis path reachable. **14 of the remaining 25 are in `migration.service.js`** |
| `collectCoverageFrom` names **`src/app.js`, which does not exist** | the real entry point is `backend/index.js` — 90 `require()` calls, every router mount, `db.sync()`, the migrator bootstrap — and **nothing measures it** |
| `coveragePathIgnorePatterns` excludes `src/models/`, `src/config/`, `src/constants/`, `src/scripts/`, `src/docs/` | the figure covers six layers. **All 72 models are outside it** |
| the suite is **309 suites**, not the 289 recorded | P6-01's evidence block is from 2026-09-11 and has not been restated since |

Several directives mark code as *unreachable* — "`transformTenants` is never referenced",
"`decryptPrivateKey` is not exported", "`getRedis()` has no caller". That is **dead code kept and
hidden** rather than deleted, and in one case it hid a whole broken feature (A-30).

**Definition of Done**
- [ ] A-32 closed: zero unexplained directives; every remaining one carries a reason
- [ ] code described as unreachable is **deleted**, not ignored — and if it cannot be deleted, the reason says why
- [ ] `collectCoverageFrom` names files that exist; the phantom `src/app.js` entry removed
- [ ] `backend/index.js` measured, or excluded **with a written reason and a named E2E spec covering its boot path**
- [ ] the six-layer scope stated wherever "100%" appears in `docs/`, so the number is not read as the whole backend
- [ ] a reviewer rule written down: a new `istanbul ignore` is treated like a new `eslint-disable`
- [ ] P6-01's evidence block restated from a fresh run, with the current suite and test counts

**Abuse cases**
- The exclusions are widened so the figure survives
- A directive is given a reason that restates the code rather than justifying the exclusion

---

## Phase Exit

Phase 6 is complete when:

- [ ] every task above is `DONE` with a `MEMORY/records/` entry
- [ ] the coverage gate passes, **and its scope is written down** (P6-14)
- [ ] the E2E suite passes in **one uninterrupted run** — all **53** specs
- [ ] append-only on `calibration_records` is a **constraint**, tested as the application role
- [ ] no route can be merged without a permission gate
- [ ] **a rolled-back mutation leaves no audit row**, proved (P6-11)
- [ ] **a revoked session stops working on the next request**, proved (P6-12)
- [ ] a phase summary exists, with security outcomes **named** rather than asserted
