# Progress

**The single status board.** History lives in [`../MEMORY/`](../MEMORY/README.md); this is state.

Last updated: 2026-09-10

---

## Where This Project Actually Is

Phases 0–5 are **shipped**. The previous version of this board listed foundation tasks as TODO for work that had been running for months (PR-4).

| | Count |
|---|---|
| Backend modules | **33** |
| Route modules / mounts | **54** / **56** |
| Sequelize models | **72** |
| Services / controllers / validators | 76 / 56 / 37 |
| Backend test files | 342 |
| Live E2E specs | 53 |
| Frontend API services (each with a contract test) | 51 |
| Browser tests | 71 |
| Dashboard surfaces | ~60 |
| Migrations | 18 |
| ADRs | 37 |

---

## Phases 0–5 — DONE

Each has a phase file written **retrospectively**, naming the divergences, the defects found, and what they taught.

| Phase | Intent | Reality | File |
|---|---|---|---|
| **0** Foundation | monorepo, schema, tenancy, CI | ✅ shipped — CI **deferred**, isolation moved out of RLS (ADR-029), backend is **JavaScript** (ADR-030) | [P0](./PHASE-0-FOUNDATION.md) |
| **1** Auth, RBAC, users | OIDC, sessions, permissions | ✅ shipped — **plus** MFA, WebAuthn, SCIM, an OIDC **provider** (ADR-033); sessions in the database (ADR-034) | [P1](./PHASE-1-AUTH-AND-RBAC.md) |
| **2** Warehouse | inventory, transfers, opname | ✅ shipped — locations are **one level**, not a tree | [P2](./PHASE-2-WAREHOUSE.md) |
| **3** Calibration | devices, records, certificates | ✅ shipped — **plus** multi-party e-signature; approval was **unreachable** until ADR-035 | [P3](./PHASE-3-CALIBRATION.md) |
| **4** Enterprise | SSO, advanced features | ✅ largely shipped — **plus** pluggable storage, developer API, GDPR, feature flags, network security | [P4](./PHASE-4-ENTERPRISE.md) |
| **5** Analytics | data lake, predictive maintenance | 🟡 partial — predictive maintenance and pgvector RAG shipped, **plus** the whole QMS surface, workflow engine, Kanban and tickets; **no data lake, deliberately** (PR-10) | [P5](./PHASE-5-ANALYTICS.md) |

### The defects those phases produced, and what each taught

| Where | Failure | Lesson |
|---|---|---|
| P1 | every token rejected 15 min after login, platform-wide | two verification parameters expressing one idea will disagree |
| P3 | certificate approval **unreachable**; a 500 hid the gap | a conflict is a **409** |
| P3, P5 | lists returned **zero rows** while rows existed (certificates, risks) | an optional include without `required: false` is an INNER JOIN |
| P5 | three screens rendered **empty for weeks** | the envelope is a contract; a client breaks **silently** |
| P4 | the nightly retention purge failed **every night** | `sessions` uses snake_case — and a silent scheduled failure is worse than one that never ran |
| P5 | every workflow write 500ed | the models barrel exports `sequelize`, not `db` |
| P0 | the divergences went **unrecorded for months** | PR-4 — the reason Part II of `DECISIONS.md` exists |

### Shipped beyond the original plan

QMS (non-conformances, CAPA, SOP) · risk register · vendor scorecards · workflow engine · GDPR and retention · IoT telemetry with an embedded MQTT broker · feature flags · network security · metered billing · batch jobs · Kanban tracker · support desk · pluggable object storage.

---

## Phase 6 — Correctness and Compliance 🚧

**The debt that blocks a defensible release.** Details: [`PHASE-6-CORRECTNESS-AND-COMPLIANCE.md`](./PHASE-6-CORRECTNESS-AND-COMPLIANCE.md).

| Task | Title | Status | Blocks |
|---|---|---|---|
| **P6-01** | Restore the backend coverage gate | 🔴 **TODO** | trust in every other gate |
| **P6-02** | One clean full E2E pass, uninterrupted | 🔴 **TODO** | release sign-off |
| **P6-03** | `REVOKE UPDATE, DELETE` on `calibration_records` | 🔴 **TODO** | 21 CFR Part 11 defensibility (PR-2) |
| **P6-04** | Build guard: no route without a permission gate | ⏳ TODO | the likeliest authorization defect |
| **P6-05** | Post-migration column verification | ⏳ TODO | silent no-op migrations (PR-5) |
| **P6-06** | Composite unique on `(tenant_id, serial_number)` | ⏳ TODO | a cross-tenant oracle |
| **P6-07** | Mandatory MFA at role level 10 | ⏳ TODO | PR-3 |
| **P6-08** | Align Swagger with the GDPR validators | ⏳ TODO | AC-29 |
| **P6-09** | Reason required on every stock quantity change | ⏳ TODO | an unexplained quantity change |
| **P6-10** | Rotation procedure for the two unrotatable secrets | ⏳ TODO | "rotate the key" is not currently available |

### Two things are currently failing

| | |
|---|---|
| Backend unit coverage gate (100%) | **failing** — the demo seeder and the audit fixes added uncovered branches |
| Live E2E in one uninterrupted run | **never achieved** — every fix verified individually; the rate-limit window kept resetting |

**A gate that is currently failing is a gate nobody trusts. A suite that has never passed as a suite has not passed.**

---

## Phase 7 — Operational Maturity ⏳

[`PHASE-7-OPERATIONAL-MATURITY.md`](./PHASE-7-OPERATIONAL-MATURITY.md)

| Task | Title | Status | Depends on |
|---|---|---|---|
| P7-01 | CI pipeline running the gates that run only locally | ⏳ TODO | P6-01 |
| P7-02 | **Alerting on scheduled-job outcomes** | ⏳ TODO | — |
| P7-03 | Structured log shipping | ⏳ TODO | — |
| P7-04 | **A full restore drill** | ⏳ TODO | — |
| P7-05 | Formalise the secret backup procedure | ⏳ TODO | P6-10 |
| P7-06 | Validate the Helm charts against a real cluster | ⏳ TODO | a cluster |
| P7-07 | Pin the two `:latest` base images | ⏳ TODO | — |
| P7-08 | Split swagger onto its own CSP | ⏳ TODO | — |

**P7-02 first.** A scheduled compliance job failing silently is the failure mode this system is most exposed to, and it has already happened — the retention purge failed every night with `column "tenantId" does not exist` until someone looked.

**P7-04 matters more than it looks.** No restore drill has ever been performed, so the 4-hour RTO is a guess, and the lost-secrets failure is possible today.

---

## Phase 8 — Scale and Reach ⏳

[`PHASE-8-SCALE-AND-REACH.md`](./PHASE-8-SCALE-AND-REACH.md). Each is **trigger-driven**, not scheduled.

| Task | Title | Trigger |
|---|---|---|
| P8-01 | Object storage off local disk | before replica count > 1 |
| P8-02 | Socket.IO Redis adapter | same |
| P8-03 | Migration advisory lock or init container | same |
| P8-04 | Read replica for reporting | measured impact on operational p95 |
| P8-05 | Partition `iot_readings` | row count makes retention insufficient |
| P8-06 | Partition `audit_logs` | same — and it has **no delete path** |
| P8-07 | Load and abuse testing at scale | before any of the above is sized |

**P8-01, P8-02 and P8-03 are the hard prerequisites for more than one backend replica**, and none is difficult. They simply have to happen before the replica count changes, not after somebody notices duplicated backups.

---

## Live Health

| Gate | State |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` (frontend) | ✅ |
| `pnpm test` — backend, 100% gate | 🔴 **failing** |
| `pnpm test` — frontend, 70% gate | ✅ |
| `pnpm build` | ✅ |
| Live E2E, one uninterrupted run | 🔴 **never achieved** |
| Browser suite | ✅ with two deliberately retained expected-failure markers |
| CI pipeline | ⚪ **deferred** — gates run in `pre-push` and `make verify` |
| Helm charts | 🟡 **render; not cluster-validated** |
| Compose stacks | ✅ all three overlays validate |
| Makefile | 🟡 **static checks only** — `make` unavailable on the authoring machine |

---

## Open Risks Carrying Into Phase 6

From [`../docs/PLAN/18-RISK-REGISTER.md`](../docs/PLAN/18-RISK-REGISTER.md).

| Risk | Severity | State |
|---|---|---|
| **PR-2** — append-only is a convention, not a constraint | critical | **open** → P6-03 |
| **PR-3** — super-admin without enforced MFA | critical | partially mitigated → P6-07 |
| PR-1 — a missed tenant predicate | critical | mitigated, monitored |
| PR-5 — silent migration no-op | high | known → P6-05 |
| PR-12 — single host | medium | mitigated by preparation only |

---

## Legend

✅ done  ·  🚧 in progress  ·  ⏳ todo  ·  🔴 todo and blocking  ·  🟡 partial or unverified  ·  ⚪ deferred
