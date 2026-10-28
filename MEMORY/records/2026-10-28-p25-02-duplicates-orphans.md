# P25-02: the duplicates (Q-8, Q-9) and orphans (Q-2, Q-3, Q-10) in the data-quality report

**Date:** 2026-10-28 · **Card:** P25-02 · **Status:** PARTIAL (Q-28's unreferenced files and the user section still not built) · **Decision:** ADR-129 Am. 12 item 10 · **Spec refs:** `docs/UPSTREAM/03` § 7 (Q-2, Q-3, Q-8, Q-9, Q-10)

## Hook

The contract names "duplicates" and "orphans" sections as its target, and the report had none of
their 03 § 7 findings. Five of them can be counted per facility from what the transform already
wrote. No grant or contract change was needed.

## What changed

[`backend/src/services/upstreamDataQuality.service.ts`](../../backend/src/services/upstreamDataQuality.service.ts)
adds five findings per facility:

| Finding | Counts | Facility from |
|---|---|---|
| **Q-8** | Second session headers for one (QR, day), quarantined `duplicate_header` | The staged `id_client` through the `mst_faskes` mapping. Q-4's helper is now `sessionQuarantinePerFacility(context, reason)`, with the reason bound |
| **Q-9** | Devices with more than one live calibration (kept as history, flagged) | The calibration row |
| **Q-2** | Mapped IPM rows of the 16 tables (4 session, 12 result) whose staged `id_user` has no `users` mapping | The row's decided facility |
| **Q-3** | Mapped devices whose registrant (`id_user`) has no `users` mapping | The row's decided facility |
| **Q-10** | Mapped calibrations whose performer has no `users` mapping (absent or departed; the import key acts for them) | The row's decided facility |

For Q-2, Q-3 and Q-10, "no `users` mapping" covers three cases at once: an absent `id_user`, a
hard-deleted upstream user, and one the users step quarantined. In our model all three mean the
same thing: the performer is kept as a snapshot, with no account link.

The same change touched:

- the OpenAPI description, `openapi.json` and the frontend `schema.d.ts`;
- the header of the `upstreamDataQuality` contract (a comment only);
- the as-built lists in 05 § 7, `docs/BACKEND/13`, `PHASE-25`, `PROGRESS` and ADR-129 Am. 12.

## Tests

| Suite | Result |
|---|---|
| `services/upstreamDataQuality.p2502` | **6/6**. One new case covers per-facility counts: Q-8 over the four session tables, Q-2 over the 16 IPM tables, and each performer table bound in order. The Q-4 bind assertion now includes the bound reason, and the clean run carries the five new findings |
| `routes/upstreamDataQuality*` | 3/3 |
| **Live, PostgreSQL 18** (throwaway container, removed after): `--only=p2402g,p2403` | **p2402g 6/6**, with the totals predicted from the synthetic world before the run: Q-8 = 1 (the second QR-G101 header), Q-3 = 1 (QR-G102 has no `id_user`), Q-2 = 2 (the QR-G102 session and the consumable row of user 99), Q-9 = 0 and Q-10 = 0 (no calibrations). **p2403 3/3** |
| Guards: `src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll` | 44 suites, 335 tests |
| typecheck | 0 errors in these files. Two TS6133 errors exist in `models/decimalGetters.d21` and `models/softDeleteMechanisms.d25`, which belong to the parallel test-conversion work |
| eslint | clean |
| `openapi:check` current; frontend `api:types:check` current | |

## Still open on P25-02

- Q-28's unreferenced files on disk (the manifest's side).
- The user section. R-9 of the reconciliation checks the imported accounts per run.
- Real volumes: P24-05, blocked on UD-18/OA-5.
