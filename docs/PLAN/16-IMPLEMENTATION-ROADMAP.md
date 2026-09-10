# 16 — Implementation Roadmap

**This project is past the greenfield phase.** Most of what earlier planning documents describe as Phase 1 through Phase 3 work is already shipped and running. This roadmap reflects that.

Live status is [`../../TASKS/PROGRESS.md`](../../TASKS/PROGRESS.md). This document is the shape of the phases and the dependency rules between them.

---

## Where the Project Actually Is

| Phase | Original intent | Reality as of 2026-09-10 |
|---|---|---|
| **Phase 0** — Foundation | monorepo, schema, tenancy, CI | **shipped**, with divergences (see below) |
| **Phase 1** — Auth, RBAC, users | OIDC, sessions, permissions | **shipped** — plus MFA, WebAuthn, SCIM, OIDC provider |
| **Phase 2** — Warehouse | inventory, transfers, opname | **shipped** |
| **Phase 3** — Calibration | devices, records, certificates | **shipped** — plus e-signature workflows |
| **Phase 4** — Enterprise | SSO, advanced features | **largely shipped** — OIDC, SCIM, custom domains, per-tenant storage |
| **Phase 5** — Analytics | data lake, predictive maintenance | **partially shipped** — predictive maintenance and RAG exist; no data lake, deliberately |

Beyond the original five phases, the platform also shipped: QMS, risk register, vendor scorecards, workflow engine, GDPR and retention, IoT telemetry, feature flags, network security, metered billing, batch jobs, Kanban tracker, support desk, and pluggable object storage.

### Divergences from the original plan

Each of these is an ADR in [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md), not an accident:

| Planned | Actual | ADR |
|---|---|---|
| TypeScript backend, strict mode | **JavaScript, CommonJS** | ADR-030 |
| PostgreSQL only | PostgreSQL **or** MySQL | ADR-029 |
| Row Level Security for tenant isolation | ORM-layer scoping, deny-by-default | ADR-029 |
| Kubernetes-first deployment | Docker Compose first, Helm charts available | ADR-032 |
| OIDC as the only auth | password + JWT primary; OIDC as RP **and** OP | ADR-033 |
| Plain WebSocket realtime | Socket.IO, both ends | ADR-031 |

The TypeScript divergence is the widest and the one most likely to mislead: `CLAUDE.md` and several planning documents specified strict TypeScript with no `any`. The backend is JavaScript. Any instruction to "fix the types" in `backend/` is based on a stale premise.

## The Phase Rule

> **Never build a Phase N+1 feature while Phase N is incomplete.**

The rule survives even though the phases are largely complete, because it governs the remaining work. Concretely:

- Tenant isolation is Phase 0. Every `:id` endpoint written before scoping existed is an IDOR waiting to be found — and scoping now exists, so any new endpoint that opts out of it (`skipTenantScope`) is a Phase 0 regression, not a Phase 5 feature.
- Audit logging is Phase 0. A new mutation without an audit row is not a new feature with a gap; it is a compliance regression.
- The certificate state machine is Phase 3. New certificate transitions do not get added without extending the machine and its 409 mapping.

## Remaining Work

Ordered by what blocks what, not by appeal.

### Now — correctness and compliance debt

| Item | Why it is first |
|---|---|
| **Restore the backend unit-test coverage gate** | The demo seeder and the audit fixes added uncovered branches, dropping the suite below its 100% threshold. A gate that is currently failing is a gate nobody trusts. |
| **`REVOKE UPDATE, DELETE` on `calibration_records`** | The Part 11 originality control is currently a convention (see [`15-COMPLIANCE-STANDARDS.md`](./15-COMPLIANCE-STANDARDS.md)). |
| **One clean full E2E pass** | 51 live specs plus the browser suite have each been verified individually but not in a single uninterrupted run — the global rate limiter kept exhausting. |
| **GDPR Swagger vs validator alignment** | The published contract and the enforced Joi schemas disagree. Documented drift is still drift. |

### Next — operational maturity

| Item | Depends on |
|---|---|
| CI pipeline running the gates that currently run only locally | the coverage gate being green |
| Helm chart validated against a real cluster | a reachable cluster — the charts render, they are not yet known to be accepted |
| Read replica for reporting | evidence that reporting is affecting operational latency |
| Structured log shipping and alerting | [`../DEVOPS/05-MONITORING.md`](../DEVOPS/05-MONITORING.md) |

### Later — scale and reach

| Item | Trigger |
|---|---|
| Data lake / warehouse | reporting on the operational database becoming a measured problem |
| Table partitioning for `iot_readings` and `audit_logs` | row counts crossing the point where retention alone stops being enough |
| Multi-region | a customer requirement, not a technical one |

## Critical Dependencies

Things that must stay in the stated order:

```
tenant scoping ──▶ every tenant-scoped endpoint
     (Phase 0)

role levels + menu groups ──▶ every authorization gate
     (Phase 1)

device model ──▶ calibration records ──▶ certificates ──▶ e-signature
     (Phase 3, strictly sequential — each is the input to the next)

workflow engine ──▶ gated approval on Certificate / StockTransfer / WorkOrder
     (the engine ships before any resource routes through it)

storage abstraction ──▶ attachments ──▶ per-tenant buckets
     (Phase 4)
```

## Definition of Phase Complete

A phase is complete when, and only when:

1. Every task card in the phase file is `DONE`.
2. Every `DONE` task has a record in [`../../MEMORY/records/`](../../MEMORY/records/).
3. The global Definition of Done in [`../../TASKS/00-TASK-CONVENTIONS.md`](../../TASKS/00-TASK-CONVENTIONS.md) is satisfied for each.
4. A phase summary exists in `MEMORY/` naming what shipped, what deviated, what was deferred, and what to watch.
5. Security-relevant outcomes are **named**, not asserted. "IDOR tested, all good" with no test named is worse than silence, because it stops anyone looking again.
