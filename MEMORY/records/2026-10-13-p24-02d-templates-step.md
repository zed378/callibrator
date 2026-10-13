# P24-02d: the upstream transform's templates step (one published version per device type)

**Date:** 2026-10-13 · **Card:** P24-02d (the fourth part of P24-02) · **ADR:** ADR-129 Amendment 6 · **Status:** DONE. The transform stays **not available** (409) until steps 6 … 12 are built (P24-02e vendors, rooms and devices; P24-02f calibrations; P24-02g sessions and results; attachments wait on P24-03).

## What was built

| | |
|---|---|
| `transform/templates.ts` (step 5) | The five `mapping_*` tables → one PUBLISHED version per device type. The type is `id_alat`, resolved through step 3's `id_map`. The item is the row's one `id_*` column besides `id_alat`, resolved through step 4's `id_map` (target present and active). Writes, in order: template (when absent), draft, the type items copied from their definitions in upstream id order per section, the base's published items materialised (`origin = base`), retire the previous version, publish. The publish sets `content_hash` (the contracts' `canonicalTemplateVersion`), `published_by_system = system:upstream-transform` and a fixed change note. Duplicate pairs collapse to the lowest id (`mergedIntoLegacyId`). A re-run compares a **fingerprint** (canonical form, item ids replaced by definition ids, version 0): equal → nothing written; different → the next version. Quarantined: `reference_unresolved`, `item_content_incomplete` (the publish's own `inspectionContentProblems`), `template_operator_managed` (retired template, open operator draft, or a latest authored version not the transform's). Writes its own CREATE (template) and APPROVE (`PUBLISH_TEMPLATE_VERSION`) audit rows under PLATFORM |
| `transform/auditRows.ts` | `STEP_AUDITED`: step 13 skips the three template tables (their step audits them) |
| `transform/steps.ts` | Step 5 registered with its five sources |
| Migration `0138-upstream-transform-templates` | Reason CHECK rebuilt (+3 reasons); SELECT, INSERT, UPDATE on `inspection_templates`, `inspection_template_versions`, `inspection_template_items` to the transform role. `down` refuses while a new reason is in use. **0137 is line B's** (public device tokens) |
| Contracts | `UPSTREAM_IMPORT_QUARANTINE_REASONS` +3 (28) |
| Guards | D-05 and G-14: `templates.ts#${table}` (id_map and allow-listed staging reads; global targets) and `templates.ts#audit_logs` (PLATFORM tenant bound, no facility) |

## Tests (named)

- **Unit:**
  - `services/upstreamImport/transform.p2402d` (new): the registry; both references in every shape; who owns a template (6 cases); the fingerprint; the plan (new type with duplicates merged, the canonical hash recomputed; unresolved ×5; item content incomplete; operator-managed; next number; unchanged keeps; relabel / new base / missing published list publish the next version); the step (nothing staged; a new type with every statement and bind; retirement without base items; an existing template with nothing published; nothing to publish; no base → `TRANSFORM_FAILED`).
  - `migrations/0138-upstream-transform-templates.p2402d` (new).
  - `services/upstreamImport/transform.p2402a`: step 13's bind now leaves out `STEP_AUDITED`.
  - Contracts `upstreamSqlImport.p2401`: 28 reasons. The contracts suite: 70 suites, 1,414 tests, 100 %.
  - `--findRelatedTests` over the changed sources: `templates.ts`, `auditRows.ts`, `steps.ts` and `0138` at 100 / 100 / 100 / 100.
- **Live, PostgreSQL 18** (`la-pg18` on 127.0.0.1:56240; ClamAV `la-clamd` on 13315):
  - `upstreamTransform.p2402d` (new, `--only=p2402d`): **3/3**, as the transform role.
    - **0138:** down/up/up gives identical grants and reasons; DELETE is refused on all three tables.
    - **First transform:** `mapping_fugsi_alat` 6 staged → 4 mapped, 1 `reference_unresolved`, 1 `template_operator_managed`; `mapping_kelengkapan_alat` 1 → 1. Pompa v1 has its items in the expected order; the base is copied whole. The stored `content_hash` equals the hash recomputed from the stored rows. Duplicates share one item. The operator's type is untouched. Audit rows: 2 CREATE and 2 APPROVE under PLATFORM, none per item.
    - **Re-runs:** the same values write nothing. A relabelled function item publishes Pompa v2 and retires v1, Monitor stays at v1, the mapping moves to v2's item, and one more APPROVE row is written.
  - Also re-run: `p2004` 15/15, `p2002` 21/21, `uifix` 3/3, `p2401` 8/8, `p2402a` 7/7, `p2402b` 4/4, `p2402c` 3/3.
- **Guards** (`src/tests/guards`, `utils/rawSql*`, `services/unboundedFindAll`): 44 suites, 335 tests. **4 failures, none from this card:** G-13 (`publicDevicePage.service.ts`) and the two-tenant guard (`calibrationDevices` public-token routes). Both are line B's P21-08, still in flight in the working tree. Mine (D-05, G-14) are green.

## Left for later

- **P24-02e:** vendors, rooms (`warehouses`) and devices.
- **P24-02f:** calibrations.
- **P24-02g:** sessions and results.
- Attachments wait on P24-03.
- **Dry run (P24-05):**
  - the exact item-column names of the five mapping tables;
  - how many items `item_content_incomplete` holds back (performance values without a unit).

## Files

- `backend/src/services/upstreamImport/transform/templates.ts` (new), `auditRows.ts`, `steps.ts`
- `backend/src/migrations/0138-upstream-transform-templates.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/constants/facilityAccess.ts`, `backend/src/tests/utils/rawSqlTenantPredicate.d05.test.js`, `backend/scripts/live-suites.ts`
- `packages/contracts/src/upstreamSqlImport.ts`, `packages/contracts/test/upstreamSqlImport.p2401.test.ts`
- tests:
  - new: `backend/src/tests/services/upstreamImport/transform.p2402d.test.ts`, `backend/src/tests/migrations/0138-upstream-transform-templates.p2402d.test.ts`, `backend/src/tests/migrations/upstreamTransform.p2402d.live.test.ts`
  - changed: `backend/src/tests/services/upstreamImport/transform.p2402a.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-129 Am. 6), `docs/UPSTREAM/05-DATA-MIGRATION.md` (§ 3.1 note), this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, `TASKS/PROGRESS.md`, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`
