# P21-01 — the catalogue and template API: device types, the item library, templates, drafts, publish with the base rebase, the published document, proposals

**Date:** 2026-10-09 · **Task:** P21-01 (Phase 21) · **Decision:** ADR-125 Amendment 3 · **Spec:** [`MEMORY/specs/P19-01-inspection-catalogue.md`](../specs/P19-01-inspection-catalogue.md) § 6 – § 8, § 10, § 13 · **Base commit:** `1a9c814` (working tree, not committed) · **Kind:** code + migration 0125 + contracts + OpenAPI + tests; nothing committed

> **Privacy:** every fixture is synthetic ("Test Device Type A", "Synthetic leakage check", synthetic numbers). No upstream value anywhere; `mozivid/` untouched.

## What was built

| | |
|---|---|
| Contracts | `inspectionValues.ts`: `parseDecimal`, `normaliseUnit` (+ `UNIT_ALIASES`), `parseLimit`, `evaluate` (scaled `BigInt`, inclusive bounds), `resolveTemplateVersion`, `inspectionContentOf`, `inspectionContentProblems` (deferred by P20-03, ADR-125 Am. 2). New `inspectionCatalogue.ts`: the content union on `inputKind`, device-type / library / template / version / draft / proposal request schemas (route forms with their path parameter, `…Body` forms for the OpenAPI). `calibrationDevices.ts`: `deviceTypeId` on create and update |
| Routes (34) | `/api/v1/device-types` (6: list/read = `calibration`\|`ipm`\|`ipm-templates` read, marked facility-accessible; create/rename/retire/reactivate = `superAdminOnly` + `denyApiKey`); `/api/v1/ipm` (21: `GET /templates/published` with strong ETag / 304 / `private, no-cache`, `GET /template-versions/:versionId` — draft = 404 to non-operators; the library, templates, drafts, items PUT at a revision, note, publish, discard, history — operator; proposals list/create/read/withdraw — `ipm-templates`, not facility-accessible); admin router (3: the proposal queue, accept, reject) |
| Services | `deviceType`, `inspectionItemDefinition`, `inspectionTemplate` (template row lock, publish: base materialised, previous retired, number, hash of the contract's canonical text, APPROVE audit; base publish rebases every published type template; `openOrLinkDraft`), `inspectionProposal` (tenant-scoped; accept opens/links a draft and copies nothing; audit in the proposal's tenant; in-app notification in the transaction), `inspectionCatalogue.shared` (views without actors) |
| Device | `calibrationDevices.service`: giving a device a retired or unknown type is a 400 with the reason; keeping a held retired type and clearing are allowed |
| Migration 0125 | `inspection_template_versions_one_draft` rebuilt `WHERE status = 'draft' AND rebased_from_version_id IS NULL` (ADR-125 Am. 3 § 1) |
| Types | the six catalogue brand constructors in `types/ids.ts` |
| Guards / lists | new `inspectionCatalogueGlobal.guard`; `facilityAccess` (4 reads marked); `twoTenantRoutes` allow-list (17 entries: `not-tenant-owned` for the two reads by id, `platform` for the rest); D-24 reviewed list (11); A-127 `NOT_GUARDED` (2); p608 known drift (1, the sweep reads a GET query as a body); `scripts/live-suites.ts` (`p2101`) |
| OpenAPI | `deviceTypes.openapi.ts`, `ipm.openapi.ts`, `admin.openapi.ts` (+3), `docs/openapi/inspectionCatalogueSchemas.ts`; `openapi.json` 533 operations; frontend `schema.d.ts` regenerated |

## What surprised me (→ ADR-125 Amendment 3)

1. **0112's one-draft index made § 7.3 unbuildable**: the rebase version must be inserted as a draft (items only under a draft parent), so a type template with an open operator draft refused the base publish with 23505 — proven on PostgreSQL 18 (fail-before). Migration 0125 excludes rows carrying `rebased_from_version_id`.
2. Shapes the spec left open, decided: limit written as text and parsed by the server; draft items `{ itemDefinitionId, required?, content? }` in array order; an item keeps its definition's section and kind; the base template is never retired; no actor in any answer; proposal writes refuse API keys; contracts by subpath and response schemas in the OpenAPI modules (house pattern, not the barrel § 8.4 named).

## Evidence — tests named

**Backend (`npm run test:coverage -- --ci`, Node 26):** 981 suites passed, 43 skipped, 0 failed; 16,629 tests passed, 349 skipped; **100 / 100 / 100 / 100**; 381 s. New suites:
- `tests/routes/ipmCatalogue.operator.p2101.test.ts` — 18: device types (each 409 text, audit under PLATFORM, unique race → 409, other error → 500, tenant admin 403); library (limit parsed `≤ 0,5 µA` → `lte 0.5`, notes by length only in audit, section change 400, retired 409, defaults); drafts (revision 409, every 400 of § 7.2 incl. base ∩ type, > 60 per section, a planted unit mismatch refused at publish); publish (base materialised, hash = SHA-256 of `canonicalTemplateVersion` recomputed in the test, one APPROVE row, v2 retires v1); templates (retire retires the version, base never retired, list filters); versions (draft 404 = missing to a tenant user, retired readable, no actor field); **base rebase** (type v2 with `rebasedFromVersionId`, v1 retired, operator draft untouched, a type without a published version skipped, REBASE audit); ETag (304 on `If-None-Match`, moves on publish and rename, not on a draft edit); **audit in the transaction** (a publish failing after its audit write leaves no audit row and the draft unchanged); system-actor publish.
- `tests/routes/ipmTemplateProposals.twoTenant.test.ts` — 11 (`@two-tenant` GET `/template-proposals/:proposalId`, POST `…/withdraw`: 404 identical to missing, nothing written); lists isolated; tenant stamped from context (body `tenantId` 400); queue spans tenants; accept opens/creates/links drafts and copies nothing; audits in the proposal's tenant; notification in the transaction; 409s for decided/withdrawn; tenant admin 403 on the admin router.
- `tests/routes/ipmCatalogue.twoFacility.test.ts` — 5 (`@two-facility` both read-by-id routes): bound = unbound (same bodies, same ETag), draft 404 = missing; proposals and operator routes 403 `FACILITY_ROUTE_REFUSED`; the hooks DENY proposals in a bound context (0 rows) while global models read.
- `tests/routes/calibrationDevices.deviceType.p2101.test.ts` — 2; `tests/guards/inspectionCatalogueGlobal.guard.test.ts` — 3 (fail-before: a planted chain without `superAdminOnly`, a missing inventory entry, a stale entry, a read without the G-2 gate); `tests/migrations/0125-catalogue-rebase-drafts.test.ts` — 4; `tests/types/ids.catalogue.p2101.test.ts` — 12.
- Updated: `twoTenantRoutes.guard`, `admin.route.test.js` (20 routes), `admin.flags.a174` (mock), `denyPlatformAuthoring.a127`, `unboundedFindAll.d24`, `swaggerValidatorAlignment` known drift.

**Contracts:** 58 suites, 1,298 tests, 100 % — new `inspectionValues.parse.p2101.test.ts` (parse / units / limit shapes and the `text` remainder / evaluate boundaries, `0.7000001` fails, pct of a negative nominal / resolve / content checks) and `inspectionCatalogue.contract.p2101.test.ts`.

**Live, PostgreSQL 18 (`pgvector/pgvector:pg18`, container `p2101-pg18` on 127.0.0.1:55211, removed by name):** `npm run test:live` — **37 of 37 suites passed**, incl. the new `inspectionCatalogue.p2101.live.test.ts` (6: 0125 applied; a type v1 published through the real triggers; **fail-before** with 0125 down: the base publish is refused 23505; with 0125 up: rebase published, v1 retired, operator draft untouched, the rebased hash recomputed from the stored rows equals the stored one, one APPROVE row; as `callibrator_app` a second operator draft still 23505; the published document and ETag on real rows; `verifySchema` 0 problems) and `p2003` unchanged.

**Gates (2026-10-09):** `node scripts/ci/eslint-ratchet.js` 0 errors, 0 warnings, baseline 0; contracts `npm run lint` clean; `npm run typecheck` 0 (backend, contracts, frontend); `npm run ratchet` 695 `.js`, at the floor; `load:check` OK both modes (dist 678 modules / 110 boot; src 690 / 112); `openapi:check` current, `openapi:lint` no new error; frontend jest 320 suites, 3,480 tests passed. **Tree not quiet in principle** (single agent; no other edits observed).

## Not done / open

- Live API smoke and E2E of the new routes: P21-10. Not committed.
- `openapi:breaking` not run (all routes new; the device create/update gain an optional field).
- `make migrate-verify` on production-shaped data: P20-09.

## Boards

P21-01 **DONE**. Phase 21: 6 DONE · 0 TODO · 8 BLOCKED. **P22-01 unblocked** (TODO). Group total 38 DONE · 9 TODO · 55 BLOCKED of 102.
