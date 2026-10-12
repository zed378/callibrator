# P24-02c: the upstream transform's catalogue steps (device types and item definitions)

**Date:** 2026-10-12 · **Card:** P24-02c (the third part of P24-02) · **ADR:** ADR-129 Amendment 5 · **Status:** DONE. The transform stays **not available** (409) until steps 5 … 12 are built (P24-02d onwards: templates, vendors, rooms and devices, calibrations, sessions and results).

## What was built

| | |
|---|---|
| `transform/catalogue.ts` (steps 3 and 4) | **Step 3, `mst_alat` → `device_types` (global):** names normalised; case/space duplicates merged into the lowest legacy id (members carry `mergedIntoLegacyId`, and the raw name when it was normalised); an operator-made type of the same name adopted (`legacy_id` set when empty); empty names quarantined `value_out_of_range`; a changed survivor renames its type. **Step 4, the eleven `mst_*` checklists → `inspection_item_definitions` (global):** section and kind from § 5.1; content built by `@callibrator/contracts` `inspectionContentOf`, with limits by `parseLimit` from `nilai_acuan`; outcomes from the upstream code list via § 5.1's mapping; `notes` kept operator-only; base sections imported **retired**, type sections **active**; `mst_rekomendasi_hasil_pekerjaan` quarantined `session_header_value`. Staged rows are read generically (`to_jsonb(s)`), so a table's optional columns need no per-table SQL |
| Migration `0136-upstream-transform-catalogue` | Rebuilds the reason CHECK (adds `session_header_value`). Grants SELECT, INSERT and UPDATE on `device_types` and `inspection_item_definitions`. `down` refuses while the new reason is in use |
| `transform/steps.ts` | Steps 3 and 4 registered with their sources |
| Guards | D-05 `CROSS_TENANT` and G-14: `catalogue.ts#${table}` (allow-listed staging reads; global targets) |

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2402c` (new): 26/26. It covers the registry; `cleanText`; § 5.1's code mapping in 13 cases; the content of performance, electrical-safety and base items; both plans in every branch; the statements and binds, including the empty outcome list stored as `'{}'` and never NULL.
  - `migrations/0136-upstream-transform-catalogue.p2402c` (new): 8/8.
  - Contracts: `upstreamSqlImport.p2401` now lists 25 reasons. The contracts suite: 1,408 tests, 100%.
  - `--findRelatedTests` over the changed files: 11 suites, 179 tests. Every `transform/*.ts` file is at 100 / 100 / 100 / 100.
- **Live, PostgreSQL 18** (`p2402a-pg18` on 127.0.0.1:56231; ClamAV `bk-clamd` on 13314):
  - `upstreamTransform.p2402c` (new, `--only=p2402c`): **3/3**, as the transform role.
    - **0136:** down/up/up gives identical grants and reasons; DELETE is refused on both tables.
    - **First transform:** the 5 staged types become 3 types (a merge, an adoption that keeps its retired status, one quarantine). Six definitions are written with the parsed limits (`plus_minus_pct`, `plus_minus` with unit `mmHg`, `text`), and the 0112 CHECKs accept them. The base section is retired and the recommendation quarantined. Audit rows are written under the PLATFORM tenant with no facility.
    - **Re-runs:** the same values again write nothing; a relabel updates the definition, with one audit row.
  - **Defect found live:** an empty outcome list was bound as NULL (`string_to_array('')`), which the NOT NULL column refused. It is now stored as `'{}'`.
  - Also re-run: `p2402a` 7/7 (its 0134 grant check is now scoped to its own two tables), `p2402b` 4/4, `p2401` 8/8, `p2004` 15/15, `p2002` 21/21, `uifix` 3/3, `p2406` 13/13.
- **Guards:** `src/tests/guards`, `utils/rawSql*` and `services/unboundedFindAll`: 44 suites, 335 tests.
- **Gates:**
  - `eslint` on the changed files: clean
  - `eslint-ratchet`: 0 / 0
  - `typecheck`: 0 errors
  - `ratchet`: 695
  - `load:check`: OK in dist and src
  - `openapi:check`: current (no route change)

## Left for later

- **P24-02d onwards:**
  - the template versions from the 5 `mapping_*` tables. Version 1 per type, published under the transform's actor, its `content_hash` from `canonicalTemplateVersion`, and the 5 duplicate pairs collapsed;
  - vendors, rooms and devices;
  - calibrations;
  - sessions and results.
- **Dry run (P24-05):** confirm where upstream keeps the electrical-safety limits, and the units of the measured items.

## Files

- `packages/contracts/src/upstreamSqlImport.ts`, `packages/contracts/test/upstreamSqlImport.p2401.test.ts`
- `backend/src/migrations/0136-upstream-transform-catalogue.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/services/upstreamImport/transform/catalogue.ts` (new), `steps.ts`
- `backend/src/constants/facilityAccess.ts`, `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js`
- `backend/scripts/live-suites.ts`
- tests:
  - new: `backend/src/tests/services/upstreamImport/transform.p2402c.test.ts`, `backend/src/tests/migrations/0136-upstream-transform-catalogue.p2402c.test.ts`, `backend/src/tests/migrations/upstreamTransform.p2402c.live.test.ts`
  - changed: `backend/src/tests/migrations/upstreamTransform.p2402a.live.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 5), `docs/UPSTREAM/05-DATA-MIGRATION.md` (§ 3.1 note), `MEMORY/specs/P19-01-inspection-catalogue.md` (§ 12 superseded note), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
