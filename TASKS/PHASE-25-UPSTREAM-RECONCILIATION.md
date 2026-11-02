# Phase 25 — Upstream: Reconciliation & Parity Verification

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 24 — Data ETL (incl. ~91 GB of Photos)](./PHASE-24-UPSTREAM-DATA-ETL.md) · [Phase 26 — UAT With Real Users](./PHASE-26-UPSTREAM-UAT.md) →

| | |
|---|---|
| **Status** | **P25-01 PARTIAL 2026-11-02** — 16 of 17 checks computed and proven on the real 2026-10-06 dump, R-12 BLOCKED · **P25-02 DONE 2026-11-02** · **P25-03 DONE 2026-11-02** · **P25-04 BLOCKED** on the operator's signature (ADR-129 Am. 14, [record](../MEMORY/records/2026-11-02-p25-reconciliation-real-data.md)). Earlier: P25-01/P25-02 PARTIAL 2026-10-24, proven on synthetic data, ADR-129 Am. 11, Am. 12 |
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
| P25-01 | Automated R-1 … R-12 per tenant, aggregates only | **PARTIAL 2026-11-02, 16 of 17: every check the database can answer is computed and proven on the real dump (115 facilities, 0 failing), RC-F4 from the staged rows (ADR-129 Am. 14, [record](../MEMORY/records/2026-11-02-p25-reconciliation-real-data.md)). R-12 BLOCKED: it needs a live E2E on a dry-run stack, in P25-04's rehearsal.** Before: **PARTIAL 2026-10-24** (review correction: first recorded DONE; its SQL had never run — live it failed on a missing grant, fixed by migration 0146, ADR-129 Am. 11) — [`GET /admin/upstream-sql-imports/:id/reconciliation`](../backend/src/routes/api/admin.route.ts): R-1/R-2/R-7 per facility, R-10/R-11/RC-F1/RC-F2/RC-F3/RC-F5 at the run level, proven on PG18 with synthetic data (`upstreamTransform.p2402g.live`, a planted facility mismatch fails RC-F1 and R-1); **R-3 … R-6 automated 2026-10-27, row by row** (ADR-129 Am. 12; `p2402g.live` 6/6 on PG 18.6, a planted status, reading and environment value each fail exactly R-4/R-5/R-6 — [record](../MEMORY/records/2026-10-27-p25-01-r3-r6-row-level.md)); **R-9 automated 2026-10-27** at the run level (`p2402g.live`: a renamed staged group fails it — [record](../MEMORY/records/2026-10-27-p25-01-r9-user-roles.md)); **R-8 automated 2026-10-27** (`p2403.live`: 5 referenced = 3 mapped + 2 quarantined; a soft-deleted photo fails its facility — [record](../MEMORY/records/2026-10-27-p25-01-r8-photos.md)); contract [`upstreamReconciliation.ts`](../packages/contracts/src/upstreamReconciliation.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests: contracts 4, service 4, route 3, migration 0146 5, live 1 — [record](../MEMORY/records/2026-10-24-p25-01-reconciliation-automated.md). | P24-05 (mechanism built ahead of the data, as P29-02 was) |
| P25-02 | Quarantine review and per-tenant data-quality report (duplicate serials, duplicate files, orphans, implausible dates) | **DONE 2026-11-02: the rest of 03 § 7, the duplicate files and the users section, every section computed on the real dump (ADR-129 Am. 14, [record](../MEMORY/records/2026-11-02-p25-reconciliation-real-data.md)).** Before: **PARTIAL 2026-10-24** (review correction: first recorded DONE) — [`GET /admin/upstream-sql-imports/:id/data-quality`](../backend/src/routes/api/admin.route.ts): quarantine groups in the run totals (a facility row only carries mapped rows' groups), Q-12/Q-13/Q-18/Q-19 per facility, proven on PG18 with synthetic data; **Q-4, Q-14 and Q-28's missing files automated 2026-10-27** (`p2402g.live`, `p2403.live`: each flags exactly the right facility — [record](../MEMORY/records/2026-10-27-p25-02-q4-q14-q28.md)); **duplicates Q-8/Q-9 and orphans Q-2/Q-3/Q-10 automated 2026-10-28** ([record](../MEMORY/records/2026-10-28-p25-02-duplicates-orphans.md)); **Q-28's unreferenced files automated 2026-10-28** at the run level ([record](../MEMORY/records/2026-10-28-p25-02-q28-unreferenced.md)); contract [`upstreamDataQuality.ts`](../packages/contracts/src/upstreamDataQuality.ts); service + controller + validator + route + OpenAPI + two-tenant allow-list; tests: contracts 5, service 4, route 3, live 1 — [record](../MEMORY/records/2026-10-24-p25-02-data-quality-report.md). | P25-01 (mechanism built ahead of the data, as P25-01 was) |
| P25-03 | Sampled report diff: upstream vs ours, field by field, on throwaway copies | **DONE 2026-11-02** — [`GET /admin/upstream-sql-imports/:id/report-diff`](../backend/src/routes/api/admin.route.ts): 16 fields over a deterministic sample, aggregates only; it compares the rows a report is built from, not rendered pages (ADR-129 Am. 14). On the real dump every one of 8,392 sessions: 0 `differs` — [record](../MEMORY/records/2026-11-02-p25-reconciliation-real-data.md) | P23-02 |
| P25-04 | Signed reconciliation by the operator: zero unexplained deltas | BLOCKED on people: the operator's signature, and R-12 on a dry-run stack | P25-01 … 03 |
