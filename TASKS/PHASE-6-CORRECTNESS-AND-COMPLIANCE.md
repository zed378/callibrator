# Phase 6 — Correctness and Compliance

**The debt that blocks a defensible release.**

Everything here sits underneath what Phases 0–5 built. Building Phase 7 on top of it would compound, which is what the phase rule exists to prevent.

---

### P6-01 — Restore the backend coverage gate

| | |
|---|---|
| **Status** | 🔴 TODO |
| **Depends on** | — |
| **Spec refs** | `docs/BACKEND/09-TESTING.md` · `docs/TESTING/01-UNIT-TESTING.md` |
| **Spec required** | no |

**Why:** the suite runs against a 100% threshold and is currently below it. **A gate that is currently failing is a gate nobody trusts**, and every other gate in the project is judged by whether this one is respected.

Uncovered: `seedDemoData()` and its helpers, certificate submit-for-approval (service and controller), `qms.validator`, the data-retention `legalHoldSchema`, the tenant subdomain-derivation branch, and the param-merge branches.

**Definition of Done**
- [ ] `npm run test:coverage` passes at the configured threshold
- [ ] each uncovered branch is either tested, or excluded with a **recorded reason**
- [ ] the exact uncovered-line list from a full run is captured in the record

**Abuse cases**
- The threshold is lowered rather than the tests written
- The demo seeder is excluded without recording why

---

### P6-02 — One clean full E2E pass, uninterrupted

| | |
|---|---|
| **Status** | 🔴 TODO |
| **Depends on** | — |
| **Spec refs** | `docs/TESTING/03-E2E-TESTING.md` |

**Why:** every fix has been verified live and **individually**. The suite has never passed as a suite, because the global rate-limit window kept needing to reset.

**A suite that has never passed as a suite has not passed.**

**Definition of Done**
- [ ] all 51 specs green in **one uninterrupted run**
- [ ] no 429s in the output
- [ ] no spec touched the default tenant destructively
- [ ] environment-dependent failures (`/ai`, GDPR export, PDF without Chromium) are **named as such**, not counted as passes

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
| **Status** | ⏳ TODO |
| **Spec refs** | `docs/SECURITY/04-AUTHORIZATION-RBAC.md` § "The failure mode nothing prevents" |

**Why:** a new route with no `dynamicAccess` or `rbac` call **works for everyone with a token**, and nothing fails the build. This is the single most likely authorization defect in the codebase, and it has no mechanism against it.

**Definition of Done**
- [ ] a script failing any diff that adds a `router.<verb>` call with no permission gate
- [ ] wired into `pre-push` and `make verify`
- [ ] **tested both directions**: a gated route passes, an ungated one fails
- [ ] documented exemptions for the public endpoints, listed explicitly

**Abuse cases**
- The exemption list becomes a place to put anything inconvenient
- The guard checks for the string rather than the call position, and a comment satisfies it

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

## Phase Exit

Phase 6 is complete when:

- [ ] every task above is `DONE` with a `MEMORY/records/` entry
- [ ] the coverage gate passes
- [ ] the E2E suite passes in **one uninterrupted run**
- [ ] append-only on `calibration_records` is a **constraint**, tested as the application role
- [ ] no route can be merged without a permission gate
- [ ] a phase summary exists, with security outcomes **named** rather than asserted
