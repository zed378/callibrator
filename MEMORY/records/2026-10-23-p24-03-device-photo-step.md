# P24-03: transform step 9, the device photos — and the whole transform proved end to end

**Date:** 2026-10-23 · **Card:** P24-03 (engineering only, synthetic data) · **ADR:** ADR-129 Am. 10 · **Status:** DONE. Real files wait on UD-18 (the owner's legal decision) through P24-05; `UPSTREAM_REAL_DATA_ALLOWED` stays false.

## What was built

| | |
|---|---|
| `services/upstreamImport/transform/attachments.ts` (new) | Step 9. `trx_inventory_file` → quarantine `certificate_archived_offline` (owner rule: no certificate file stored). Per photo (`trx_inventory.foto_depan` / `foto_sn`): name from URL or bare value → device from step 8's mapping (`no_device`) → the manifest's decision (`file_missing`, or the ingest's own reason) → unchanged by hash → the operator's live photo (`photo_operator_managed`, never replaced) → read + SHA-256 check (`storage_verify_failed`) → full decode + derivatives (`image_undecodable`) → original + display + thumb under `t/<tenant>/f/<device facility>/attachments/` → the import's own earlier photo soft-deleted, the device-photo row inserted, CREATE / DELETE audit rows, `id_map` (source table = folder). `accountPhotos` counts each folder for the runner |
| `transform/photoFiles.ts` (new) | `catalogueOf(manifests)`: the latest manifest line of a path wins; `skipped_present` resolves to the earlier ingest of the same hash; torn lines skipped. The `TransformFiles` contract (`created` removed on rollback, `superseded` after commit) |
| `upstreamImport/transformFiles.ts` (new) | Reads the manifests of the provider's COMPLETED image imports (oldest first, ≤ 1,000), binds the tenant's storage; `settleTransformFiles` after the outcome |
| `transform/steps.ts`, `runner.ts` | A step may declare `account` (extra sources counted after it, in the summary, fatal when unaccounted); `StepContext.files`. Step 9 wired; every step built → `transformAvailable()` true |
| `upstreamSqlTransform.service.ts` | Loads the files before the run; after the commit removes the re-keyed originals, after a failure the objects written |
| `transform/auditRows.ts` | `attachments` in `STEP_AUDITED` |
| Migration **0145** | Quarantine reasons `certificate_archived_offline`, `photo_operator_managed`; transform role on `attachments`: SELECT / INSERT columns, UPDATE `is_deleted, updated_at` only, no DELETE |
| `@callibrator/contracts/upstreamSqlImport` | the two reasons (35 in all) |
| `constants/facilityAccess.ts`, `rawSqlTenantPredicate.d05` | the step's four raw statements reviewed (worker, provider tenant bound) |

## The end-to-end synthetic proof (the card's acceptance)

`upstreamTransform.p2403.live`, PostgreSQL 18 (pgvector/pgvector:pg18), local storage, **3/3 passed**:

1. 0145 down / up / up identical. The transform role is refused (42501) DELETE and UPDATE of `storage_key`, `client_facility_id` and `checksum`.
2. Two image imports through the REAL `ingestStaged`: a JPEG, a PNG, a HEIC refused, then the ETL's JPEG re-imported under the HEIC's path. Then a loaded run with rows for every step's tables. `requestTransform` (no 409) → inline batch job → `transformed`. The summary lists **all 13 steps in 05 § 3.1 order**; 18 sources carried staged rows, and the runner proved each mapped or quarantined. Photos: `foto_depan` 3 = 2 mapped + 1 `no_device`, `foto_sn` 2 = 1 mapped + 1 `file_missing`, `trx_inventory_file` 2 = `certificate_archived_offline`. Three rows sit under their device's facility key with both derivatives on disk. The re-keyed originals are gone; the unimported device's original stays. Three CREATE audits.
3. A re-run of the same dump writes nothing (2 + 1 unchanged). A changed upstream photo replaces the import's own (DELETE + CREATE). The operator's serial photo is kept (`photo_operator_managed`).

## Tests (named; scoped)

- **New:**
  - `transform.p2403` (registry, names, catalogue, plan, step, accounting, runner);
  - `transformFiles.p2403`;
  - `0145-upstream-transform-attachments.p2403`.
- **Updated:**
  - `transform.p2401` (every step built; the NOT_BUILT refusal on an unbuilt step);
  - `transform.p2402a`, `transform.p2402g`;
  - `upstreamSqlTransform.service.p2401` (files loaded and settled);
  - `upstreamSqlImport.service.p2406` (`transformAvailable: true`);
  - contracts `upstreamSqlImport.p2401` 3/3.
- **Scoped unit run:** 20 suites / 406 tests passed. Changed files at 100 / 100 / 100 / 100: attachments, photoFiles, transformFiles, runner, steps, auditRows, the service, 0145.
- **Guards:** `src/tests/guards`, `utils/rawSql*` and `services/unboundedFindAll`: 44 suites / 335 tests passed.
- **Live:** p2403 3/3, then p2004 15/15, p2002 21/21, uifix 3/3, p2401 8/8, and p2402a … g 7 + 4 + 3 + 3 + 3 + 4 + 5, all passed (11 of 11 suites, 76 tests).
- **Gates:** eslint on the changed files clean; ratchet 0 errors, baseline 0; ts-ratchet 695 `.js`, at the floor; typecheck 0 errors in backend, contracts and frontend.
- **Not run:** the full suites (owner rule: at the end of Phase 31). Routes did not change, so `openapi:*` and `api:types:check` were not run.

## Notes

- The PG18 container and its image disappeared mid-session (not removed by this agent). They were recreated by name and the live run repeated: p2403 3/3.
- Docs amended under ADR-129 Am. 10: `docs/UPSTREAM/05` § 3.1 step 9 and `08` § 11 (rows 3, 4.1, 7 and 2 step 8).

## Files

- backend: `src/services/upstreamImport/transform/{attachments,photoFiles}.ts` (new), `src/services/upstreamImport/transformFiles.ts` (new), `src/migrations/0145-upstream-transform-attachments.ts` (new), `transform/{steps,runner,auditRows}.ts`, `src/services/upstreamSqlTransform.service.ts`, `src/config/migrator.ts`, `src/constants/facilityAccess.ts`, `scripts/live-suites.ts`
- tests: `src/tests/services/upstreamImport/{transform.p2403,transformFiles.p2403}.test.ts`, `src/tests/migrations/{0145-upstream-transform-attachments.p2403,upstreamTransform.p2403.live}.test.ts` (new); `transform.p2401/p2402a/p2402g`, `upstreamSqlTransform.service.p2401`, `upstreamSqlImport.service.p2406`, `utils/rawSqlTenantPredicate.d05.test.js`
- contracts: `packages/contracts/src/upstreamSqlImport.ts`, `test/upstreamSqlImport.p2401.test.ts`
- docs / records: `docs/UPSTREAM/05-DATA-MIGRATION.md`, `08-FILE-POLICY.md`, `MEMORY/DECISIONS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
