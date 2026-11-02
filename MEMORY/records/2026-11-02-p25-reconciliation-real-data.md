# P25-01, P25-02, P25-03: RC-F4, the rest of the data-quality report and the report diff, proven on the real dump

**Date:** 2026-11-02 · **Cards:** P25-01 PARTIAL (16 of 17, R-12 BLOCKED), P25-02 DONE, P25-03 DONE · **Decision:** ADR-129 Am. 14 · **Spec refs:** `docs/UPSTREAM/05` § 7, `03` § 7, `09` § 2, threat model § 11 G-30

## Hook

Phase 25 had three gaps: RC-F4 and R-12 answered `manual`, the report's user and file sections and half of 03 § 7 did not exist, and P25-03 was a parked contract. All but R-12 now run, and all of it ran on the real 2026-10-06 dump. Nothing differs: across every one of the 8,392 imported sessions, no field of the 16 differs from what upstream's report prints.

## What was still open

| Card | Open before this change |
|---|---|
| P25-01 | RC-F4 and R-12, of 17 |
| P25-02 | the `users` section, the duplicate files of the card's title, and Q-5, Q-6, Q-7, Q-11, Q-15, Q-16, Q-17, Q-20 … Q-24, Q-27 |
| P25-03 | everything but the contract |

## What changed

- **RC-F4** (`upstreamReconciliation.service.ts`): per facility and per run, over 18 staged tables. A row's facility comes from its upstream device, not from `id_map`, so this is the one check that sees a wrong decision there.
- **Data quality** (`upstreamDataQuality.service.ts`, contract comment): 13 new per-facility findings, and at the run level Q-16, `F-DUP-HASH`, `F-DUP-NAME` and `U-1` … `U-6`.
- **Report diff:** `services/upstreamImport/reportDiff.ts` (pure, written from 09 § 2.2 and 03), `services/upstreamReportDiff.service.ts`, controller, validator, `GET /admin/upstream-sql-imports/:id/report-diff?sample=` (super admin only), OpenAPI operation `adminDiffUpstreamReports`, the two-tenant allow-list as `platform`, D-05 and G-14 entries. Contracts export by the `./*` wildcard in `packages/contracts/package.json`, so the parked module needed no export entry. The draft's "ADR-129 Am. 13" was wrong (that is the statistics amendment) and now says Am. 14. `sample.population` was added.
- **`backend/scripts/upstream-dry-run.ts`:** runs the diff at the contract's largest sample and over every session, and parses the three real answers through their contracts.

## The real dump

`2026-10-06-skp_ipm.sql` on a throwaway PostgreSQL 18 + ClamAV 1.4 (containers `lg-pg18`, `lg-clamav`), under the owner's UD-18 decision. The summaries held counts, codes and durations only, and were deleted with the logs.

**Reconciliation, 115 facilities, 0 failing:**

| Check | Expected | Actual | Quarantined |
|---|---:|---:|---:|
| R-1 devices | 23,722 | 23,722 | |
| R-2 session headers | 8,153 | 8,153 | |
| R-3, R-4 results | 294,756 | 294,756 | |
| R-5 readings | 13,872 | 13,872 | |
| R-6 environment | 16,419 | 16,419 | |
| R-7 calibrations with device dates | 27,299 | 27,299 | |
| **RC-F4, per facility and run** | **355,370** | **355,370** | **640** |
| R-10 | 371,335 | 371,335 | 12,602 |
| R-9 | 105 | 105 | |
| R-11, RC-F1, RC-F2, RC-F3, RC-F5 | 0 | 0 | |

`upstreamReconciliationResult`, `upstreamDataQualityResult` and `upstreamReportDiffResult` each parsed the real answer.

**Report diff, every session (8,392, in 17 facilities), 0 `differs` in all 16 fields:**

| Field | Equal | Explained | Differs |
|---|---:|---:|---:|
| device.name | 8,374 | 18 | 0 |
| facility | 8,392 | 0 | 0 |
| ipm.date | 8,392 | 0 | 0 |
| room | 6,343 | 2,049 | 0 |
| device.qr | 8,392 | 0 | 0 |
| device.brand | 7,385 | 1,007 | 0 |
| device.serial | 7,650 | 742 | 0 |
| device.model | 8,086 | 306 | 0 |
| visit | 8,392 | 0 | 0 |
| results.rows | 8,390 | 2 | 0 |
| results.values | 4,620 | 3,772 | 0 |
| inspection.result | 8,391 | 1 | 0 |
| maintenance.result | 8,392 | 0 | 0 |
| recommendation | 8,392 | 0 | 0 |
| notes | 8,361 | 31 | 0 |
| technician | 8,072 | 320 | 0 |

The default contract sample at its cap (2,000 sessions, 9 facilities) also had 0 `differs`. **No transform bug was found.**

**Data quality, new findings against the research (03 § 7):**

| Finding | Dry run | Research |
|---|---:|---:|
| Q-5 rows of another device type | 1,671 | 41 sessions + 280 maintenance named as examples |
| Q-6 item with no imported catalogue row | 1,175 | 4,073 deleted items (a different question, Am. 14) |
| Q-7 no item reference | 59,123 | 56,326 |
| Q-11 device date none of its calibrations' | 2,086 | 2,173 |
| Q-15 no created_at | 23,354 | 23,354 |
| Q-16 archive rows with no created_at | 3,496 | 3,496 |
| Q-17 serial placeholders | 532 | ~836 |
| `Q-18-NULL` real serials NULLed | 733 | 1,357 devices in 624 groups, so 733 |
| Q-20 name differs from its type | 888 | 888 |
| Q-21 environment kept raw | 411 | 432 |
| Q-22 decimal commas | 4,308 | 4,148 |
| Q-23 non-numeric or unknown kept raw | 11,437 | ~8,491 |
| Q-24 untrimmed printed device text | 2,695 | 95 rows (five columns here) |
| Q-27 photo URLs with a host | 23,702 | 23,710 |
| U-1 accounts not imported | 1 | |
| U-2 inactive | 2 | |
| U-3 shared e-mail, U-4 no usable e-mail | 0, 0 | |
| U-5 no full name | 75 | |
| U-6 departed users numbered | 4 | |
| `F-DUP-NAME` | 275 | |

Each is an upstream data count for the operator, not a defect. U-5 is the one to read: 75 of 105 accounts have no full name, so their snapshots and invitations carry no name.

**With a real photo sample.** A third run took 150 files of each folder through the production ingest and step 9: 291 ingested, 9 quarantined (7 `heic_converter_unavailable`, 1 `image_too_large`, 1 `scan_failed`, a ClamAV timeout under load, failing closed). R-8 at the run level 47,444 / 47,444 (47,168 quarantined); per facility 276 / 276 landed; RC-F4 and the 16 report fields unchanged (0 `differs` over every session, on the final `unnest` code). Q-28's unreferenced half read 16 and `F-DUP-HASH` 0 of the sample. **This is a sample, not the 47,444 files:** Q-28 and `F-DUP-HASH` have no full-volume figure yet, and the ingest took 1,078 s for 300 files on the loaded workstation.

**Timings:** a clean run on an unloaded machine: migrations 11.6 s, stage 1 39.9 s, transform 181.7 s, reconciliation 26.2 s, data quality 28.6 s, report diff at 2,000 sessions 8.7 s. A second run while test suites loaded the workstation took 572.7 s for the transform and is an upper bound.

## What surprised me

- **The first report-diff read compared keys with `= ANY(array)`.** At 8,392 keys that is linear per staged row and took minutes under load. It now joins `unnest()`, a hash join.
- **A planted staged device fails RC-F4 in one facility, not two.** The facility the rows left loses them from source and landed together; only the facility the source now names is short.
- **`\\s` in a Python patch became `\s` in a template literal**, which JavaScript reads as `s`, so the e-mail pattern was wrong until lint's `no-useless-escape` caught it. It now uses `[:space:]`.

## Tests

| Suite | Result |
|---|---|
| `services/upstreamReportDiff.compare.p2503` (new) | 15/15: every rule, written from 09 and 03 |
| `services/upstreamReportDiff.p2503` (new) | 6/6: 404, 409, the role, the bound sample, the key, counts only, tables a dump may lack |
| `routes/upstreamReportDiff.route.p2503` (new) | 4/4: 403 before the service, 401, the default and chosen sample, 400, the 409 |
| `services/upstreamReconciliation.p2501`, `upstreamDataQuality.p2502`, `routes/admin.route` | pass; RC-F4 and the new findings added, the inventory now 25 routes |
| Changed files, coverage | 100/100/100/100 on the six source files (8 suites, 63 tests) |
| contracts | 74 suites, 1,434 tests, `upstreamReportDiff.ts` at 100 % |
| **Live, PostgreSQL 18:** `p2402g` 9/9, `p2403` 3/3, `p2402f` 4/4 | RC-F4 fails alone on a staged device moved to another facility, with RC-F1 and R-1 still passing; a changed staged note, name and reading fail exactly `notes`, `device.name`, `results.values`; no staged value in any answer |
| Guards: `src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll` | 41 of 44 suites, 332 of 336 tests. The 3 suites are outside this change: `A-19` needs gitleaks, which is not on this box; `A-325` and `P6-11` failed in a CRLF checkout of the worktree, on files this change does not touch (Dockerfile, `mfa.service`, `workflow.service`) |
| typecheck, eslint on every changed file, `openapi:generate`, `openapi:lint` (no new error), frontend `api:types` | clean |

**Not run:** the full backend suite (per-card gates, owner rule), `openapi:breaking` (no `oasdiff` here; the change only adds), GitHub CI (out of scope by owner decision).

## Card status

- **P25-01 PARTIAL, 16 of 17.** Every check the database can answer is computed and proven on real data. R-12 is BLOCKED: it needs the two-tenant suites and a live E2E on a dry-run stack (compose, Mailpit, the operator's TOTP), and `p21-upstream-flows.e2e` cannot run as written on the real database, because it transforms a synthetic dump into a provider whose `id_map` would then hold real keys. It belongs to P25-04's rehearsal.
- **P25-02 DONE.** All sections computed on the real dump.
- **P25-03 DONE.** Proven on every session of the real dump. It compares rows, not rendered pages (Am. 14); P23-05 is the provider's visual sign-off.
- **P25-04 BLOCKED** on the operator's signature. It now has everything to sign except R-12.

## Files

`backend/src/services/upstreamReconciliation.service.ts`, `upstreamDataQuality.service.ts`, `upstreamReportDiff.service.ts` (new), `upstreamImport/reportDiff.ts` (new), `controllers/upstreamReportDiff.controller.ts` (new), `validators/upstreamReportDiff.validator.ts` (new), `routes/api/admin.route.ts`, `admin.openapi.ts`, `constants/facilityAccess.ts`, `backend/scripts/upstream-dry-run.ts`, `backend/openapi.json`, `frontend/src/api/generated/schema.d.ts`, `packages/contracts/src/upstreamReportDiff.ts`, `upstreamDataQuality.ts`, `upstreamReconciliation.ts`, the tests above, `docs/UPSTREAM/05`, `docs/BACKEND/13`, `docs/SECURITY/15`, `TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`, `TASKS/PHASE-25-UPSTREAM-RECONCILIATION.md`, `TASKS/PROGRESS.md`, `MEMORY/DECISIONS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record.
