# Phase 33 — The Conformance Suite and CI per Backend

> Part of the **backend-agnostic contract group, Phases 32 … 34** (ADR-136, [`docs/CONTRACT/06`](../docs/CONTRACT/06-CONFORMANCE-SUITE.md)).
>
> ← [Phase 32 — Contract-First Foundation](./PHASE-32-CONTRACT-FIRST-FOUNDATION.md) · [Phase 34 — Portability](./PHASE-34-PORTABILITY.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 10 cards, 10 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | one black-box suite that runs against any `BACKEND_URL`; Node at 100%; CI runs it per backend |
| **Depends on** | P32-10 |
| **Size** | L |
| **Cards** | 10: P33-01 … P33-10 |
| **Definition of Done** | the global DoD plus the group rule of [Phase 32](./PHASE-32-CONTRACT-FIRST-FOUNDATION.md) |

---

### P33-01 — Harness, SQL fixtures and scoring

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P32-10 |
| **Spec refs** | `docs/CONTRACT/06` § 2, § 4 · `docs/CONTRACT/90` § 1, § 5 · ADR-077 (the disposable compose stack) |
| **Spec required** | **yes** — `MEMORY/specs/P33-01-conformance-harness.md` |

**Definition of Done**
- [ ] `conformance/` workspace with no import of any backend (a lint rule)
- [ ] `contracts/fixtures/*.sql`: two tenants, two client facilities plus self, every role unbound and bound, a published catalogue, fixed UUIDs, synthetic values only
- [ ] Seed loader, sign-in through contract operations, a fresh database per run
- [ ] JUnit + JSON per-module score; a run id

**Abuse cases**
- Minting tokens in the harness (authentication then goes untested)

### P33-02 — The 57 live E2E specs, made black-box

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 |
| **Spec refs** | `backend/src/tests/e2e/` (57 files, green 2026-10-05, runs S/T) · `docs/CONTRACT/06` § 3.1 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every spec moved to `conformance/functional/<module>/`, assertions about the contract only, tagged `@module` and `@rule`
- [ ] Specs that cannot be black-box stay in the Node suite, listed with reasons in the record
- [ ] Same test count (case names kept) — a conversion never drops an assertion (the P9-26 rule)

**Abuse cases**
- Weakening an assertion to make it engine-neutral

### P33-03 — Isolation cases generated from the contract (two tenants, two facilities)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01, P32-06 (`x-tenant-scoped`, `x-facility-accessible`) |
| **Spec refs** | `docs/CONTRACT/06` § 3.2 · `docs/SECURITY/05` · ADR-124 § 10 · `MEMORY/specs/P18-04-two-tenant-two-facility-test-plan.md` · `backend/src/tests/guards/twoTenantRoutes.guard.test.ts` |
| **Spec required** | no |

**Definition of Done**
- [ ] Generated 404 cases for every tenant-scoped `:id` operation, absence in lists, and excluded counts; byte-identical 404 vs unknown id
- [ ] The facility twin, plus 403 `FACILITY_ROUTE_REFUSED` for unmarked routes
- [ ] A diff against the Node suite's `@two-tenant` / `@two-facility` markers: nothing covered in Node is missing here

**Abuse cases**
- Generating only from routes that already have Node tests

### P33-04 — The permission matrix from outside

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 |
| **Spec refs** | `docs/CONTRACT/06` § 3.3 · ADR-102 · P18-03 Matrix B |
| **Spec required** | no |

**Definition of Done**
- [ ] Every operation tested with a principal holding and one lacking its `x-permission`; the bound ceiling included
- [ ] A disagreement with Node's in-process `openapiRoutes.p925` check is a defect in one of them, fixed

### P33-05 — Contract fuzzing with Schemathesis

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 |
| **Spec refs** | `docs/CONTRACT/06` § 3.4 |
| **Spec required** | no |

**Definition of Done**
- [ ] Schemathesis (pinned container) against the bundle with authenticated principals: response conformance, negative cases → 400 `VALIDATION_FAILED`, no undeclared status or code, **no 5xx**; fixed seed
- [ ] Every finding on Node fixed (a named test each) or the contract corrected through review

**Abuse cases**
- Excluding operations from fuzzing because they fail

### P33-06 — Behaviour checks per `B-*` rule

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 |
| **Spec refs** | `docs/CONTRACT/03` · `contracts/behaviour/` |
| **Spec required** | no |

**Definition of Done**
- [ ] At least one check per rule (envelope, status, auth/refresh/rotation, credential endpoints, CSRF at the proxy level where testable, pagination, ETag, idempotency's four answers, uploads, signed links, rate limits, data formats, isolation, audit-in-transaction)
- [ ] A coverage report: every rule id has a check; a rule without one fails the job

### P33-07 — Route inventory per engine

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 |
| **Spec refs** | `docs/CONTRACT/06` § 3.6 · `docs/CONTRACT/02` § 5 (undocumented-route gate) |
| **Spec required** | no |

**Definition of Done**
- [ ] For every module an engine claims: every contract operation is served, and no extra route answers anything but 404

### P33-08 — CI per backend (and the live suite's first CI run)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-02 … P33-07 |
| **Spec refs** | `docs/CONTRACT/06` § 5 · BACKLOG A-19 · `.github/workflows/ci.yml` |
| **Spec required** | no |

**Definition of Done**
- [ ] `conformance-node` in CI on the compose stack: **path-filtered per module** on change, blocking merges on `backend/`, `contracts/`, `conformance/` changes; the **full suite plus Schemathesis nightly** (CD-2, `docs/CONTRACT/06` § 5); a matrix ready for further engines
- [ ] The CI-minutes ceiling recorded (free GitHub Actions minutes), the monthly use printed by the nightly job, and the drop order applied when exceeded (nightly fuzz depth first)
- [ ] A-19 (live E2E not in CI) closed by this job — named run id in the record
- [ ] Runs in free CI minutes (owner, 2026-10-08: no paid services)

### P33-09 — Node at 100%

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-08 |
| **Spec refs** | `docs/CONTRACT/06` § 4 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every module of Node at 100%; every defect found fixed with a named test (or the contract corrected with a client-owner review)
- [ ] Two consecutive green runs (the ADR-077 standard)

**Abuse cases**
- Deleting or skipping a check to reach 100%

### P33-10 — Exit

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P33-01 … P33-09 |
| **Spec refs** | `docs/CONTRACT/06` |
| **Spec required** | no |

**Definition of Done**
- [ ] `docs/CONTRACT/06` amended to as-built; record with the run ids; PROGRESS; Phase 34 unblocked
