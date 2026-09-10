# TASKS/ — Execution Plan

`docs/` describes **what** the system is and **why**. This folder describes **what to do next, in what order, and how to know it is finished**.

Nothing here invents architecture. Every task points back to the `docs/` document that already decided the design. **If a task would need a decision `docs/` does not contain, it is not a task** — it is an entry in [`BACKLOG.md`](./BACKLOG.md) under Open Questions, to be raised with the project owner.

---

## Read This First

**This project is past the greenfield phase.**

The previous version of this file listed P1-01 through P1-07 as TODO — monorepo setup, database schema, authentication, RBAC, tenant isolation, sessions, audit logging. All of it had shipped months earlier. 33 modules, 53 route modules, 72 models and 342 test files were already running.

That is recorded as PR-4 in [`../docs/PLAN/18-RISK-REGISTER.md`](../docs/PLAN/18-RISK-REGISTER.md), and it is the reason this board now tracks **remaining** work rather than a plan.

## Files

| File | Purpose |
|---|---|
| [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) | Task IDs, statuses, the anatomy of a card, and the Definition of Done every task inherits |
| [`PROGRESS.md`](./PROGRESS.md) | **The single status board.** What is shipped, what is not |
| [`PHASE-0-FOUNDATION.md`](./PHASE-0-FOUNDATION.md) | ✅ Stack, scaffolding, schema, tenant scoping, audit, queue, storage — and three divergences |
| [`PHASE-1-AUTH-AND-RBAC.md`](./PHASE-1-AUTH-AND-RBAC.md) | ✅ Auth, sessions, MFA, WebAuthn, RBAC, users, federation |
| [`PHASE-2-WAREHOUSE.md`](./PHASE-2-WAREHOUSE.md) | ✅ Warehouses, stock, adjustments, transfers, opname |
| [`PHASE-3-CALIBRATION.md`](./PHASE-3-CALIBRATION.md) | ✅ Devices, records, scheduling, certificates, e-signature |
| [`PHASE-4-ENTERPRISE.md`](./PHASE-4-ENTERPRISE.md) | ✅ Tenant hierarchy and lifecycle, backup, custom domains, storage, developer API, GDPR |
| [`PHASE-5-ANALYTICS.md`](./PHASE-5-ANALYTICS.md) | 🟡 Dashboard, IoT, predictive maintenance, RAG, QMS, workflow, Kanban, tickets — **no data lake, deliberately** |
| [`PHASE-6-CORRECTNESS-AND-COMPLIANCE.md`](./PHASE-6-CORRECTNESS-AND-COMPLIANCE.md) | 🚧 The debt that blocks a defensible release |
| [`PHASE-7-OPERATIONAL-MATURITY.md`](./PHASE-7-OPERATIONAL-MATURITY.md) | ⏳ CI, monitoring, alerting, disaster-recovery rehearsal |
| [`PHASE-8-SCALE-AND-REACH.md`](./PHASE-8-SCALE-AND-REACH.md) | ⏳ Horizontal scaling, partitioning, read replicas — **trigger-driven** |
| [`BACKLOG.md`](./BACKLOG.md) | Open questions, specification gaps, deliberate deferrals, unverified claims |

**Phases 0–5 are written retrospectively.** They were executed before `TASKS/` was used as intended, so those files reconstruct what was actually built from the code, the migration sequence and the audit report — not from a plan that was followed.

They are worth reading anyway. Each one names the divergences from the original plan, the defects that were found, and what those defects taught — which is exactly the material that would otherwise have to be rediscovered.

## How to Use This Folder

1. **Open [`PROGRESS.md`](./PROGRESS.md)** and find the lowest-numbered task in the current phase that is `TODO` and whose dependencies are all `DONE`.
2. **Read every document in the task's `Spec refs` row.** These are not decoration — they contain the decisions the task implements. `docs/` is as-built and names its source files; guessing at an endpoint shape or a column name is never necessary and never acceptable.
3. **If the task is marked `Spec required`**, write the feature spec from [`../MEMORY/templates/FEATURE-SPEC-TEMPLATE.md`](../MEMORY/templates/FEATURE-SPEC-TEMPLATE.md) **before** writing code. Save it to `MEMORY/specs/<task-id>-<slug>.md`.
4. **Implement**, satisfying every line of the task's Definition of Done plus the inherited global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md).
5. **Record the change** in [`../MEMORY/`](../MEMORY/README.md) — a change record, an index line, a changelog entry if user-visible, and an ADR if a decision was made or a `docs/` document deviated from.
6. **Update `PROGRESS.md`** and tick the checkbox in the phase file, **in the same commit as the work**.

## The Phase Rule

> **Never build a Phase N+1 feature while Phase N is incomplete.**

It survives even though Phases 0–5 are complete, because it governs what remains. Concretely:

- **Tenant isolation is Phase 0.** A new endpoint that opts out of scoping (`skipTenantScope`) is a Phase 0 regression, not a Phase 8 feature.
- **Audit logging is Phase 0.** A new mutation without an audit row is a compliance regression, not a feature with a gap.
- **The certificate state machine is Phase 3.** New transitions extend the machine and its 409 mapping; they do not bypass it.

Phase 6 exists because there is correctness and compliance debt sitting under everything built in Phases 0–5, and building Phase 7 on top of it would compound.

## Two Things Currently Failing

Both are Phase 6, and both are stated here because a board that hides its failures is not a board.

| | Status |
|---|---|
| Backend unit-test coverage gate (100%) | **failing** |
| Live E2E suite in one uninterrupted run | **never achieved** — every fix verified individually |

A gate that is currently failing is a gate nobody trusts. A suite that has never passed as a suite has not passed.

## The One Rule About Evidence

> **An assertion that a test passed is not evidence. Name the test.**

A record that says "IDOR tested, all good" and names no test is **worse than one that says nothing**, because it stops anyone looking again.

This applies to task completion, phase summaries, and release sign-off alike.

## Relationship to `docs/` and `MEMORY/`

| Folder | Direction | Nature |
|---|---|---|
| `docs/` | Reference | What the system **is**, grounded in the code. Amended only through the deviation protocol. |
| `TASKS/` | Forward | What will be built, in what order, and how it will be judged done. |
| `MEMORY/` | Backward | What was built, what it cost, and what to watch. |

`TASKS/` is forward-looking; `MEMORY/` is backward-looking. **They are updated in the same commit: a task is not `DONE` until its `MEMORY` record exists.**
