# docs/ARCHIVE/

**Superseded documents. Kept for provenance. Never authoritative.**

Nothing here should be acted on. Where a document in this folder disagrees with the rest of `docs/`, the rest of `docs/` is right — it is grounded in the code and names its source files.

These are kept because deleting them would destroy the evidence of what was believed at the time, which is the one thing that explains how the specification and the code came apart.

---

## Contents

| File | Was | Superseded by |
|---|---|---|
| [`2026-09-context-prd.md`](./2026-09-context-prd.md) | `context.md` — the original PRD and architecture brief | [`../PLAN/`](../PLAN/00-PROJECT-OVERVIEW.md) |
| [`2026-06-modules-reference.md`](./2026-06-modules-reference.md) | `MODULES.old.md` — the first module reference | [`../BACKEND/10-MODULE-REFERENCE.md`](../BACKEND/10-MODULE-REFERENCE.md) |
| [`2026-07-fullstack-integration-audit.md`](./2026-07-fullstack-integration-audit.md) | `AUDIT-REPORT.md` — the live audit that found 24 defects | still the **primary source** for those defects; the lessons are distributed through `docs/` |
| [`2026-09-10-monorepo-setup-summary.md`](./2026-09-10-monorepo-setup-summary.md) | `SETUP-COMPLETE.md` — the first monorepo scaffolding | [`../../MEMORY/records/2026-09-10-monorepo-restructure-and-as-built-docs.md`](../../MEMORY/records/2026-09-10-monorepo-restructure-and-as-built-docs.md) |
| [`2026-09-blockers.md`](./2026-09-blockers.md) | `MEMORY/BLOCKERS.md` | [`../PLAN/18-RISK-REGISTER.md`](../PLAN/18-RISK-REGISTER.md), [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) |
| [`2026-09-memory-progress.md`](./2026-09-memory-progress.md) | `MEMORY/PROGRESS.md` — status in the wrong folder | [`../../TASKS/PROGRESS.md`](../../TASKS/PROGRESS.md) |
| [`openclaw-backend-directive.md`](./openclaw-backend-directive.md) | `commands-backend.md` — an agent execution directive | [`../../CLAUDE.md`](../../CLAUDE.md), [`../../AGENTS.md`](../../AGENTS.md) |
| [`openclaw-frontend-directive.md`](./openclaw-frontend-directive.md) | `commands-frontend.md` — the same, for the frontend | same |

## Why the Audit Report Is Different

[`2026-07-fullstack-integration-audit.md`](./2026-07-fullstack-integration-audit.md) is in this folder for filing reasons, not because it is stale.

It remains the **primary source** for the 24 defects found in the July 2026 live audit, and the only place several of them are described end to end. The lessons have been distributed into the relevant `docs/` documents — the INNER JOIN trap into `BACKEND/00`, the envelope violation into `API/00`, the certificate 409 into ADR-035 — but the report itself is the evidence.

Read it when you want to know **what actually happened**, rather than what the rule now says.

## Why These Were Not Deleted

`context.md`, `SETUP-COMPLETE.md` and the two OpenClaw directives all describe a system that was **planned and then built differently** — TypeScript, Kubernetes-first, RLS-based isolation, OIDC-only authentication.

Deleting them would make the divergence invisible. Keeping them makes it legible: you can read what was intended, read [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) Part II for what happened instead, and see the shape of the gap.

That gap is the largest recorded lesson in this repository (PR-4): **an instruction document that disagrees with the code produces confidently wrong work.** The archive is the evidence for it.

## Rules

1. **Never cite an archived document as current.** If you find yourself needing to, the live document is missing something — fix that instead.
2. **Never edit anything here.** These are snapshots. Correcting an archived document destroys its value as a record of what was believed.
3. **Adding to this folder is an event**, and it belongs in a change record: something was superseded, and the reason is worth writing down.
