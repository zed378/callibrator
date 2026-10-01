# Phase 6 — Correctness and Compliance

**The debt that blocks a defensible release.**

Everything here sits underneath what Phases 0–5 built. Building Phase 7 on top of it would compound, which is what the phase rule exists to prevent.

---

### P6-01 — Restore the backend coverage gate

| | |
|---|---|
| **Status** | ✅ DONE — verified 2026-09-11; **restated 2026-09-28 under P6-14 (ADR-085)**: `npm run test:coverage` runs (P6-01a closed — the scripts call `../node_modules/jest/bin/jest.js` under Node 26), a full `npm run test:coverage -- --ci` on 2026-09-28 (Node 26.10, working tree over `c905e74`) exited 0: **638 suites passed (23 skipped, opt-in live), 12,780 tests passed (148 skipped), 100% statements / branches / functions / lines** — of the six measured layers (P6-14) |
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
- [x] **`npm run test:coverage` itself runs** — P6-01a (verified 2026-09-28, Node 26.10, see Status)

**Abuse cases**
- The threshold is lowered rather than the tests written
- The demo seeder is excluded without recording why

---

### P6-02 — One clean full E2E pass, uninterrupted

| | |
|---|---|
| **Status** | ✅ DONE — verified 2026-09-28 (ADR-077). Two consecutive uninterrupted runs, `npm run test:e2e` (Node 26.10) against a disposable compose stack (`-p callib-e2e`, base + dev overlay, backend :25000, seeded by `/migration/seeding` + `/migration/seed-demo`). Count re-derived: `find backend/src/tests/e2e -name '*.test.js'` → **54** (53 contract specs + the opt-in `liveContract.smoke.test.js`, skipped without `LIVE_CONTRACT=1`). **Run A** 11:34:46: 53 suites passed, 1 skipped; 392 tests passed, 5 skipped, 0 failed; 35 s. **Run B** 11:35:23: identical counts; 48 s. **No 429** in either, checked in the backend access log (519 and 518 requests). **5xx: one per run, `POST /ai/query`** — environment-dependent (no AI key), accepted by its spec and named here, not counted as a verified pass. GDPR export now 200 (it was a real defect, not an environment one). No spec touched the default tenant destructively. SCIM (A-49) passes. First run: 12 suites / 24 tests failed → 11 app fixes + 9 stale specs, listed in ADR-077 and `MEMORY/records/2026-09-28-p6-02-e2e-green.md`. **Open:** runs < 60 s apart can meet `tenantCreate`'s 10/min limit; `/ai/query` should not be a 500 |
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
| **Status** | ✅ DONE — verified 2026-09-25 on PostgreSQL 18.6 (ADR-062, migration `0057`). A trigger refuses DELETE, TRUNCATE and any content change for every role; `callibrator_app` has no UPDATE/DELETE/TRUNCATE beyond the lifecycle columns; `PUT`/`DELETE` routes replaced by `POST /:id/corrections` and `POST /:id/void`. **Tested as the application role** (`SET LOCAL ROLE callibrator_app`): DELETE, content UPDATE and TRUNCATE → `permission denied`; as the superuser owner the trigger refuses. **Mutation check:** DELETE granted back → the trigger still refuses; trigger also disabled → the row is deleted. Tests: `dataIntegrity.p6.live.test.js` (P6-03 blocks), `dbRole.util.p603.test.js`, `0057-0059.p6.test.js`, `calibrationRecords.service.test.js` "P6-03 correct / void" (15 fail at `fabc3be`). **Open:** `RESET ROLE` undoes the switch (a separate LOGIN role is the stronger form, not built); the Helm chart does not set `DB_APP_ROLE`; `unseedDemoData` can no longer delete demo calibration records |
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
| **Status** | ✅ DONE 2026-09-25 (ADR-058), **re-verified 2026-09-28** — `routePermissionGuard.p604.test.js` and `readGates.p604.test.js` (212 tests) green on the current tree. Whole-tree walk of `api/` and `internal/`, resolved slugs checked against the seeded menu set (A-07), both directions tested, exemptions in `constants/routeGateExemptions.js` with `publicRoutes()` the list P9-21 reads. Runs in `npm test` → `make verify`, and in CI `backend-test` (`npm run test:coverage`). **Caveat, owned by P7-01:** that CI stage has never run on GitHub; the opt-in `pre-push` hook does not run unit suites |
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
- [x] a script failing any diff that adds a `router.<verb>` call with no permission gate
- [x] it walks `src/routes/**` recursively — `api/` **and** `internal/`
- [x] it checks the **resolved resource name against the menu-slug set**, not merely that a gate is present (A-07). A gate naming a slug that does not exist is the same hole with a longer line of code
- [x] wired into `make verify` **and** a real hook or pipeline (CI `backend-test`; never run on GitHub — P7-01) — no `pre-push` hook exists yet, whatever older documents say (A-19: no `.husky/`, no `lefthook`, no `core.hooksPath`)
- [x] **tested both directions**: a gated route passes, an ungated one fails
- [x] documented exemptions for the public endpoints, listed explicitly — and it is the **same list** P9-21's `public()` marker uses, not a second one that drifts
- [x] run once over the whole tree, not only over diffs, and the result recorded. A diff-only guard never sees the routes that were already wrong

**Abuse cases**
- The exemption list becomes a place to put anything inconvenient
- The guard checks for the string rather than the call position, and a comment satisfies it
- It is wired to diffs only, so the four routes A-01/A-02/A-03/A-27 found would still have shipped

---

### P6-05 — Post-migration column verification

| | |
|---|---|
| **Status** | ✅ DONE — verified 2026-09-25 on PostgreSQL 18.6 (ADR-062). Every boot compares every model column plus seven migration-only control objects with `information_schema` and refuses on a mismatch; `make migrate` ends in `make migrate-verify`. A fresh boot (`db.sync()` + 57 migrations) and an upgrade from `fabc3be`'s schema with legacy rows both pass, and a second boot is a no-op. Tests: `schemaVerify.util.p605.test.js` (16), `dataIntegrity.p6.live.test.js` "P6-05 — verifySchema" (a dropped column, trigger and an undeclared NOT NULL column each fail it). Blanket-catch audit: `docs/DATABASE/13-MIGRATIONS.md` |
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
| **Status** | ✅ DONE 2026-09-28 — **the partial clause is decided against (ADR-078):** a soft-deleted device keeps its serial, because it still anchors append-only calibration evidence and its public verification prints the serial; a returned device is brought back by A-133 restore (ADR-075), whose history comes with it. Measured on the P7-04 drill stack: re-register a deleted device's serial → 409 naming its id; other tenant, same serial → 201; restore → 200. Pinned by `dataIntegrity.p6.live.test.js` "ADR-078: a soft-deleted device keeps its serial — the index is NOT partial on is_deleted" (22/22 on PG 18). No migration (0083 unused). Earlier: the constraint is done by D-04 / ADR-049 (migration `0026`, `UNIQUE (tenant_id, serial_number)`, refuses on in-tenant duplicates); re-verified on PG 18.6 by `dataIntegrity.p6.live.test.js` "two tenants hold the same serial; one tenant cannot hold it twice", and the index is a P6-05 control object. **Not done:** the DoD's *partial on `is_deleted = false`* — a soft-deleted device still holds its serial. That needs a decision, not a migration |
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
| **Status** | ✅ DONE 2026-09-25 (ADR-059; record `MEMORY/records/2026-09-25-phase0-batch6.md`) — **this card was stale; re-verified 2026-09-28**: `auth.superAdminMfa.p607.test.js` (middleware and service suites) green. A level-10 account without MFA gets an enrolment-only session (403 `MFA_ENROLMENT_REQUIRED` elsewhere); break-glass is the audited CLI `scripts/breakGlassMfaReset.js`, which clears the enrolment and never disables the check. **Open:** the E2E harness's MFA enrolment has not run live (P6-02) |
| **Spec refs** | `docs/SECURITY/03-AUTHENTICATION-SECURITY.md` |

**Why:** `SUPERADMIN` bypasses every permission check and every tenant predicate, and **there is no second gate behind it**. MFA is available and not enforced, so that account is one credential away from total compromise of every tenant (PR-3).

**Definition of Done**
- [x] MFA enforced at login for `ROLE_LEVELS >= 10`, not merely requested at onboarding
- [x] an enrolment path that does not lock out an existing super-admin
- [x] a documented break-glass procedure — and it must not be "disable the check" (`docs/SECURITY/03-AUTHENTICATION-SECURITY.md`)
- [x] tests: a super-admin without MFA cannot complete a login

**Abuse cases**
- The check is client-side
- The break-glass path becomes the normal path

---

### P6-08 — Align Swagger with the GDPR validators

| | |
|---|---|
| **Status** | ✅ DONE 2026-09-25 (record `MEMORY/records/2026-09-25-phase0-batch6.md`) — **this card was stale; re-verified 2026-09-28**: `swaggerValidatorAlignment.p608.test.js` green. The GDPR endpoints agree exactly; the rest of the tree's drift is pinned in its `KNOWN_DRIFT` list (a new drift fails, a fixed one forces the list to shrink). `npm run build` runs `swagger:generate` first. 2026-09-28 (P6-13): the comparison ignores a `forbidden()` key, which is refused rather than accepted |
| **Spec refs** | `docs/API/13-INTEGRATION-API.md` · `docs/BACKEND/03-VALIDATION.md` |

**Why:** the published contract and the enforced Joi schemas disagree for the GDPR endpoints. **Documented drift is still drift**, and a client written from the spec will fail (AC-29).

**Definition of Done**
- [x] annotations match the validators for every `/gdpr` endpoint
- [x] `npm run swagger:generate` reflects it
- [x] a check that the spec is regenerated on build — `build` = `swagger:generate && build:dist && pkg` (backend/package.json)
- [x] a sweep for the same divergence elsewhere (`KNOWN_DRIFT`)

---

### P6-09 — Reason required on every stock quantity change

| | |
|---|---|
| **Status** | ✅ DONE — verified 2026-09-25 on PostgreSQL 18.6 (ADR-062, migration `0059`). `PATCH /stocks/:id` refuses a quantity change (a `0` included) with a 400 naming the adjustment endpoint; an adjustment's reason is NOT NULL with `CHECK (btrim(reason) <> '')` and the validator refuses blank; every adjustment records `stock_id` and before/after. Tests: `stock.service.test.js` "P6-09: REFUSES a quantity change (400) …", `stock.validator.test.js` "P6-09: refuses a whitespace reason" and five more (fail at `fabc3be`), `dataIntegrity.p6.live.test.js` P6-09 block. Docs: `docs/DATABASE/05-WAREHOUSE-TABLES.md`, `docs/API/05-WAREHOUSE-STOCK-API.md` |
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
| **Status** | 🟡 PARTIAL — **2026-09-28: rehearsed on the P7-04 drill data (ADR-078)**, MFA seeds included: 12 envelopes re-wrapped, 0 failed; after the old key was dropped an old TOTP seed verified a real code and old and new e-signatures verified (`docs/SECURITY/13` § Rehearsal against the drill data). Still owed: a copy of **production** data. Earlier: built and rehearsed on seeded data, 2026-09-25 (ADR-062, migration `0058`). Key-id envelopes (`v2:<keyId>`), the `KMS_MASTER_KEY_PREVIOUS` ring, `npm run keys:rotate`; signing keys moved from AES-CBC/`ENCRYPT_KEY` into KMS envelopes with tenant AAD; the certificate HMAC names its key (tests: `keyRotation.s08.live.test.js` (5, PG 18.6), `keyRotation.service.s08`, `kms.rotation.s08`, `signingKeyWrap.s08`, `keyring.util.p610`, `certificatePdf.keyId.p610`). **Not done:** the rehearsal against a copy of production data (`docs/SECURITY/13-KEY-ROTATION.md`). **Decided 2026-09-30** (working decision under the owner's delegation, awaiting the owner's confirmation; ADR-109 §1): for this phase, "a copy of production data" is **a restored copy of the VM database taken after the closing deploy** — rehearsed on a disposable restore, never on the VM itself. The VM is wiped at that deploy, so its data is seeded, not hospital data; **a rehearsal on real hospital data is a post-go-live check**. Still owed: that rehearsal, run and recorded |
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
| **Status** | ✅ **DONE 2026-09-30** for the decided set ([record](../MEMORY/records/2026-09-30-p6-11-audit-coverage.md)). Of the 15, kanban (23 writes), ticket, content, featureFlag, warehouse and meteredBilling alerts now write their row inside the transaction; vendor, risk, supplierScorecard, finance, apiKey, oidcProvider and webauthn already did; notification, ai.ingestDocument and three metering entry points are allow-listed with a reason (owner to confirm, with ADR-109 §2). Proof: `routes/auditCoverage.p611.test.ts` (one row, same transaction; a forced rollback leaves neither), `services/auditRollback.p611.live.test.ts` (PG18 as `callibrator_app`, 4/4), fail-before on a reversed copy. New guard `guards/auditCoverage.p611.test.ts` fails on any new unaudited mutating service entry point. Phase 2 (same day, ADR-109 §2 Amendment) closed the gaps it found outside the 15 — GDPR consent/DSAR, SCIM groups, sop.createDocument, storage config, registerUser, sso JIT, getSubscription; startWorkflow is audited by its callers; the services helper audited stock (deleteStock, createOpname, updateOpnameStatus), so no known gap remains. — Earlier: 🟡 PARTIAL 2026-09-28 (ADR-085) — **references [A-41](./AUDIT-2026-09-REMEDIATION.md)** (DONE). Everything but agreement on scope is done: the covered set is re-stated from the code (38 files, addendum to `MEMORY/specs/A-41-audit-inside-transaction.md`), and `auditInTransaction.p611.test.js` pins that every `logAction` call passes a transaction (two named file-only exceptions), that nothing but `audit.service.js` writes `audit_logs`, and that no route mounts `recordAudit`. Found and fixed: `webhook.service.js` wrote `AuditLog.create` with no `actorType`, so every webhook rotation 500ed on PostgreSQL (see P6-13). **Open:** 15 mutating services write no audit row at all (`apiKey`, `kanban`, `ticket`, `vendor`, `warehouse`, …, listed in the addendum) — **decided 2026-09-30: all 15 are in scope** (working decision under the owner's delegation, awaiting the owner's confirmation; ADR-109 §2). An agent is implementing their audit rows; the card closes when each writes its row inside its transaction, the spec addendum lists them as covered, and `auditInTransaction.p611.test.js` still passes |
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
- [x] A-41 closed with its own verification: a rolled-back mutation leaves **no** audit row, proved with a forced rollback (`*.audit.a41.test.js`)
- [x] a failing audit insert rolls the mutation back (`audit.service.a42.test.js` "inside a transaction, a failed write is re-thrown")
- [x] **the list of covered mutations is written down** — a spec, agreed, not inferred from which services happened to be changed — *written (spec addendum 2026-09-28; addendum 2026-09-30); scope decided 2026-09-30 — all 15 are in (ADR-109 §2, awaiting the owner's confirmation); implemented 2026-09-30 and pinned by `guards/auditCoverage.p611.test.ts`*
- [x] the middleware's remaining role is stated: **none** — no route mounts it, nothing compliance-bearing depends on it (spec addendum, `docs/DATABASE/10-AUDIT-LOGS.md`, pinned by `auditInTransaction.p611.test.js`)
- [x] a failed audit write is **visible** — which is A-42, routed to P7-03. This card is not `DONE` while the only report of a failure is a `console.error` production discards

**Abuse cases**
- The transaction is passed to the audit write but the write is still `await`-less, so a rejection floats and the commit proceeds
- "Covered mutations" is defined as whichever services were easy to change

---

### P6-12 — Revocation that revokes

| | |
|---|---|
| **Status** | 🟡 PARTIAL 2026-09-28 (ADR-085) — **references [A-48](./AUDIT-2026-09-REMEDIATION.md)** (DONE). A token without `sid` is now **refused** (`SIDLESS_ACCESS_TOKENS_ACCEPTED = false`, closing A-59's last item); an open Socket.IO connection re-runs the handshake checks every 60 s and is disconnected when its session, user or tenant fails them; the windows are named in `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`; the cache-key-without-tenant is a recorded exception. **Open:** the VM's `JWT_ACCESS_EXPIRED` was `1d` at the last read against `15m` in the repository — an operator change on the VM, not made here |
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
- [x] A-48 closed: a revoked session's access token is rejected on the **next** request — and since 2026-09-28 a token with no session is rejected outright
- [x] a suspended tenant's live sessions stop working without waiting for expiry
- [ ] `JWT_ACCESS_EXPIRED` is the **same number** in `.env.example`, on the VM, and in the documentation — `15m` in both `.env.example` files and the docs; **the VM is `1d`** (operator action)
- [x] the same question answered for Socket.IO: open sockets are re-checked every 60 s (`socket.test.js` "P6-12 — an open socket stops when its principal stops")
- [x] the window is named in the security documentation (§ Revocation takes effect on the next request)
- [x] the session lookup is cached in Redis — the key is `session:live:<sid>` **without** the tenant id, a recorded exception (ADR-085 §4)

**Abuse cases**
- The lookup is added and then cached without invalidation on revoke, so revocation is still eventual and now also looks solved
- The deployed `JWT_ACCESS_EXPIRED` is changed and the documentation is not, reversing which number is the lie

---

### P6-13 — Webhook routes: validate the input, own the secret

| | |
|---|---|
| **Status** | ✅ DONE 2026-09-28 (ADR-085, migration `0090`) — **references [A-51](./AUDIT-2026-09-REMEDIATION.md)** (DONE). A caller `secret` is **refused** (400) on create, patch and rotate; rotation takes `overlapHours` (0–168, default 24) and the replaced secret signs `X-Webhook-Signature-Previous` until then; a url change rotates with no overlap; create/patch/rotate/delete are audited in their transaction. **Found:** every rotation and url change failed on PostgreSQL (audit row without `actorType`) behind mocked tests — proved on `f0d7f08` against PG 18.6 and fixed. `0090` verified on PG 18.6: fresh boot, upgrade with a live row, re-run, down, up (`0090-webhook-secret-rotation-overlap.p613.live.test.js`, 5/5). Frontend has no rotate button yet (F-18) |
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
- [x] A-51 closed: every route that takes a body mounts `validate(schema)` (create, patch, rotate); the four bodyless routes validate their `:id` with `validateUuid` — a body schema on a GET would validate nothing
- [x] path parameters reach the validator: the body schemas take no `id`; `validateUuid("id")` checks the path, and the controller reads `req.params`
- [x] the secret is **generated server-side only**; a request that supplies one is **rejected** (400, `webhook.validator.test.js` "P6-13: REFUSES a caller-supplied secret…")
- [x] stored through `kms.service.js` (A-51, migration `0022`); `SENSITIVE_KEYS` is now the `tenant_settings` list, and `secret`/`previousSecret` are caught by both redactors (ADR-085 §10)
- [x] a rotation endpoint returning the new secret **once**, with an overlap window
- [x] a test that the secret is absent from every response body, every log line and `audit_logs.changes` (`webhook.secret.a51.test.js` "P6-13: no secret — new, old or previous — reaches…")
- [x] the two-tenant 404 test on each `:id` route (`webhooks.twoTenant.test.js`, six routes) (`CLAUDE.md`, and A-55 — the fixture it depends on does not exist yet)

**Abuse cases**
- A schema is added that accepts `secret` and drops it silently, so an integrator believes they set one
- Rotation is added without the overlap and every receiver breaks at once

---

### P6-14 — Make the coverage figure mean what it says

| | |
|---|---|
| **Status** | ✅ DONE 2026-09-28 (ADR-085) — **references [A-32](./AUDIT-2026-09-REMEDIATION.md)** (DONE: 31 directives, each with a reason, ratchet `istanbulIgnore.a32.test.js`). `src/app.js` removed from `collectCoverageFrom`; `index.js` excluded with a reason and its boot covered by CI `boot-and-migrate` and `liveContract.smoke.test.js`; the six-layer scope stated in `docs/BACKEND/09-TESTING.md` § What 100% covers and the two testing docs; the reviewer rule in `docs/ENGINEERING/14-CODE-REVIEW-CHECKLIST.md`; pinned by `coverageScope.p614.test.js`. P6-01's evidence restated: a full `npm run test:coverage -- --ci` on 2026-09-28 (Node 26.10, working tree over `c905e74`) exited 0: **638 suites passed (23 skipped, opt-in live), 12,780 tests passed (148 skipped), 100% statements / branches / functions / lines** — of the six measured layers (P6-14) |
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
- [x] A-32 closed: zero unexplained directives; every remaining one carries a reason
- [x] code described as unreachable is **deleted**, not ignored — and if it cannot be deleted, the reason says why (the four left — exhaustive-switch defaults and a path-escape check — say what they guard against)
- [x] `collectCoverageFrom` names files that exist; the phantom `src/app.js` entry removed
- [x] `backend/index.js` excluded **with a written reason and a named E2E spec covering its boot path** (`liveContract.smoke.test.js`, plus CI `boot-and-migrate`)
- [x] the six-layer scope stated where "100%" is the gate in `docs/` (`BACKEND/09-TESTING.md`, `TESTING/00-TEST-STRATEGY.md`, `TESTING/01-UNIT-TESTING.md`, `ENGINEERING/14-CODE-REVIEW-CHECKLIST.md`)
- [x] a reviewer rule written down: a new `istanbul ignore` is treated like a new `eslint-disable`
- [x] P6-01's evidence block restated from a fresh run (see P6-01 Status)

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
