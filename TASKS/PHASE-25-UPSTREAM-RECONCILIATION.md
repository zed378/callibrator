# Phase 25 — Upstream: Reconciliation & Parity Verification

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 24 — Data ETL (incl. ~91 GB of Photos)](./PHASE-24-UPSTREAM-DATA-ETL.md) · [Phase 26 — UAT With Real Users](./PHASE-26-UPSTREAM-UAT.md) →

| | |
|---|---|
| **Status** | **P25-01 PARTIAL 2026-10-24** — 9 of the 17 checks automated (R-1/R-2/R-7 per facility; R-10, R-11, RC-F1, RC-F2, RC-F3, RC-F5), the other 8 answer `manual` · **P25-02 PARTIAL 2026-10-24** — quarantine totals and Q-12/Q-13/Q-18/Q-19 per facility; Q-4, Q-14, Q-28 and the orphan/file/user sections not automated · both proven live on synthetic data (PG18, `upstreamTransform.p2402g.live`), ADR-129 Am. 11 · 2 BLOCKED (P25-03, P25-04 wait on the dry run with real data) |
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
| P25-01 | Automated R-1 … R-12 per tenant, aggregates only | **PARTIAL 2026-10-24** (review correction: first recorded DONE; its SQL had never run — live it failed on a missing grant, fixed by migration 0146, ADR-129 Am. 11) — [`GET /admin/upstream-sql-imports/:id/reconciliation`](../backend/src/routes/api/admin.route.ts): R-1/R-2/R-7 per facility, R-10/R-11/RC-F1/RC-F2/RC-F3/RC-F5 at the run level, proven on PG18 with synthetic data (`upstreamTransform.p2402g.live`, a planted facility mismatch fails RC-F1 and R-1); **R-3 … R-6 automated 2026-10-27, row by row** (ADR-129 Am. 12; `p2402g.live` 6/6 on PG 18.6, a planted status, reading and environment value each fail exactly R-4/R-5/R-6 — [record](../MEMORY/records/2026-10-27-p25-01-r3-r6-row-level.md)); **R-9 automated 2026-10-27** at the run level (`p2402g.live`: a renamed staged group fails it — [record](../MEMORY/records/2026-10-27-p25-01-r9-user-roles.md)); **R-8 automated 2026-10-27** (`p2403.live`: 5 referenced = 3 mapped + 2 quarantined; a soft-deleted photo fails its facility — [record](../MEMORY/records/2026-10-27-p25-01-r8-photos.md)); **RC-F4, R-12 NOT automated** (`manual`, P25-04); contract [`upstreamReconciliation.ts`](../packages/contracts/src/upstreamReconciliation.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests: contracts 4, service 4, route 3, migration 0146 5, live 1 — [record](../MEMORY/records/2026-10-24-p25-01-reconciliation-automated.md). **Exercised on real volumes: P24-05** (BLOCKED on UD-18/OA-5) | P24-05 (mechanism built ahead of the data, as P29-02 was) |
| P25-02 | Quarantine review and per-tenant data-quality report (duplicate serials, duplicate files, orphans, implausible dates) | **PARTIAL 2026-10-24** (review correction: first recorded DONE) — [`GET /admin/upstream-sql-imports/:id/data-quality`](../backend/src/routes/api/admin.route.ts): quarantine groups in the run totals (a facility row only carries mapped rows' groups), Q-12/Q-13/Q-18/Q-19 per facility, proven on PG18 with synthetic data; **Q-4/Q-14/Q-28 and the orphan, duplicate-file and user sections NOT automated**; contract [`upstreamDataQuality.ts`](../packages/contracts/src/upstreamDataQuality.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests: contracts 5, service 4, route 3, live 1 — [record](../MEMORY/records/2026-10-24-p25-02-data-quality-report.md). **Exercised on real volumes: P24-05** (BLOCKED on UD-18/OA-5) | P25-01 (mechanism built ahead of the data, as P25-01 was) |
| P25-03 | Sampled report diff: upstream vs ours, field by field, on throwaway copies | BLOCKED | P23-02 |
| P25-04 | Signed reconciliation by the operator: zero unexplained deltas | BLOCKED | P25-01 … 03 |
