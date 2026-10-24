# Phase 25 — Upstream: Reconciliation & Parity Verification

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 24 — Data ETL (incl. ~91 GB of Photos)](./PHASE-24-UPSTREAM-DATA-ETL.md) · [Phase 26 — UAT With Real Users](./PHASE-26-UPSTREAM-UAT.md) →

| | |
|---|---|
| **Status** | **P25-01 DONE 2026-10-24** — the automated R-1 … R-12 per tenant · **P25-02 DONE 2026-10-24** — the quarantine review and per-tenant data-quality report (aggregates only; Q-4, Q-14, Q-28 answer `manual` until P25-04) · 2 BLOCKED (P25-03, P25-04 wait on the dry run with real data) |
| **Goal** | Prove the migrated data equals the source, per tenant |
| **Depends on** | Phase 24 |
| **Size** | M |
| **Cards** | 4: P25-01 … P25-04 |
| **Was** | UP-13 (cards UP-13-01 … UP-13-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 05 § 7 (R-1 … R-12) · 03 § 7. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P25-01 | Automated R-1 … R-12 per tenant, aggregates only | **DONE 2026-10-24** — [`GET /admin/upstream-sql-imports/:id/reconciliation`](../backend/src/routes/api/admin.route.ts): R-1/R-2/R-7 per facility computed, R-10/R-11/RC-F1/RC-F2/RC-F3/RC-F5 at the run level, the rest `manual` with where to record them; contract [`upstreamReconciliation.ts`](../packages/contracts/src/upstreamReconciliation.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests 4 + 3 + 3, both guards green — [record](../MEMORY/records/2026-10-24-p25-01-reconciliation-automated.md). **Exercised on real volumes: P24-05** (BLOCKED on UD-18/OA-5) | P24-05 (mechanism built ahead of the data, as P29-02 was) |
| P25-02 | Quarantine review and per-tenant data-quality report (duplicate serials, duplicate files, orphans, implausible dates) | **DONE 2026-10-24** — [`GET /admin/upstream-sql-imports/:id/data-quality`](../backend/src/routes/api/admin.route.ts): quarantine by (facility, table, reason) with run-level totals, Q-18/Q-12/Q-13 computed per facility, Q-4/Q-14/Q-28 `manual` with where to review them; contract [`upstreamDataQuality.ts`](../packages/contracts/src/upstreamDataQuality.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests 5 + 3 + 3, both guards green — [record](../MEMORY/records/2026-10-24-p25-02-data-quality-report.md). **Exercised on real volumes: P24-05** (BLOCKED on UD-18/OA-5) | P25-01 (mechanism built ahead of the data, as P25-01 was) |
| P25-03 | Sampled report diff: upstream vs ours, field by field, on throwaway copies | BLOCKED | P23-02 |
| P25-04 | Signed reconciliation by the operator: zero unexplained deltas | BLOCKED | P25-01 … 03 |
