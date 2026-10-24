# Phase 20-21 audit (migration / model / service / route vs spec) — no blocking defect, no code change

**Date:** 2026-10-24 · **Task:** audit Fase 20-21 vs spec, fix bugs found · **Spec refs:** [`PHASE-20-UPSTREAM-DB-MIGRATION.md`](TASKS/PHASE-20-UPSTREAM-DB-MIGRATION.md), [`PHASE-21-UPSTREAM-BACKEND.md`](TASKS/PHASE-21-UPSTREAM-BACKEND.md), [`P19-01`](MEMORY/specs/P19-01-inspection-catalogue.md), [`P19-02`](MEMORY/specs/P19-02-ipm-session-aggregate.md), [`P19-03`](MEMORY/specs/P19-03-device-extensions.md), [`P19-04`](MEMORY/specs/P19-04-client-facilities.md), [`P19-05`](MEMORY/specs/P19-05-calibration-dates.md), [`P19-06`](MEMORY/specs/P19-06-ipm-report-document.md), [`P19-07`](MEMORY/specs/P19-07-public-device-page.md), [`P19-08`](MEMORY/specs/P19-08-offline-field-capture.md), [`P18-03`](MEMORY/specs/P18-03-facility-scope-permissions.md), [`P18-04`](MEMORY/specs/P18-04-two-tenant-two-facility-test-plan.md) · **ADRs:** ADR-124 (Am. 1–8), ADR-125 (Am. 1–3), ADR-126 (Am. 1–7), ADR-127 (Am. 1–6), ADR-132 (Am. 1–3), ADR-133 (Am. 1–4), ADR-138 — all in [`DECISIONS.md`](MEMORY/DECISIONS.md)

## Hook

Every Phase 20-21 guard that the specs name was re-run on this tree. All green. [`typecheck`](backend/package.json:42) and [`load-check`](backend/package.json:61) green. No migration, model, service or route defect found in the Phase 20-21 scope, so no src file was changed. The only failing suite in the wider guard run is outside this scope and environment-caused (see § Guards).

## Migrations 0111–0146 — all present, manifest order correct

Read from [`migrator.ts`](backend/src/config/migrator.ts) lines 180–251 and the files in [`migrations`](backend/src/migrations):

- P20-01: [`0111-device-types.ts`](backend/src/migrations/0111-device-types.ts) — table, normalised-name CHECK, per-status unique, no-delete/no-truncate triggers, RESTRICT key.
- P20-03: [`0112-inspection-catalogue.ts`](backend/src/migrations/0112-inspection-catalogue.ts) — five tables, 14 ENUM types, CHECKs, one-published/one-draft indexes, triggers, revokes, base seed v1.
- P20-07: [`0117-client-facilities.ts`](backend/src/migrations/0117-client-facilities.ts) through [`0123-facility-nullable.ts`](backend/src/migrations/0123-facility-nullable.ts) — table + self facility per tenant, composite keys `ON UPDATE CASCADE`, immutability/binding/ended triggers, UD-9 per-facility serial, `UNIQUE (tenant_id, id)`.
- P20-06: [`0124-ipm-menus-technician-calibration.ts`](backend/src/migrations/0124-ipm-menus-technician-calibration.ts) — three menu entries inactive, UD-4 (b) technician `calibration` write, void narrowed to `rbac([TENANT_ADMIN])`.
- P21-01: [`0125-catalogue-rebase-drafts.ts`](backend/src/migrations/0125-catalogue-rebase-drafts.ts) — rebase version excluded from the one-open-draft index.
- P20-04/05: [`0126-ipm-sessions.ts`](backend/src/migrations/0126-ipm-sessions.ts), [`0127-ipm-immutability.ts`](backend/src/migrations/0127-ipm-immutability.ts) — four tables, CHECKs, composite keys, facility function `result` branch, append-only/draft-only/correction triggers with the move exception.
- P20-02: [`0128-device-extensions.ts`](backend/src/migrations/0128-device-extensions.ts) — 14 device columns, rooms `kind`/`floor`, 6 record columns, QR unique per tenant, room unique per facility, facility triggers, `manual` back-fill; reuses 0117/0118 uniques, no duplicate.
- P20-08: [`0129-attachment-purpose.ts`](backend/src/migrations/0129-attachment-purpose.ts) — `purpose` + CHECKs, one-live-device-photo partial unique, `inspectionsession` widened, follow-facility trigger.
- Menu activations: [`0130-ipm-templates-menu-active.ts`](backend/src/migrations/0130-ipm-templates-menu-active.ts), [`0131-ipm-menu-active.ts`](backend/src/migrations/0131-ipm-menu-active.ts), [`0132-client-facilities-menu-active.ts`](backend/src/migrations/0132-client-facilities-menu-active.ts).
- P21-08: [`0137-public-device-tokens.ts`](backend/src/migrations/0137-public-device-tokens.ts) — hash-only table, global hash UNIQUE (ADR-138 reviewed exception), one-active-per-device partial unique, append-mostly + same-tenant triggers, no DELETE grant.
- 0113–0116, 0133–0136, 0138–0146 are the import/transform/reconciliation menus, roles and grants (Phases 24–25 scope, present and ordered; not Phase 20-21 behaviour). No blanket `try/catch` in the 0111–0132 path; `down` exists per migration (refuses on data loss where destructive).
- [`pending/drop-legacy-user-webauthn-columns.ts`](backend/src/migrations/pending/drop-legacy-user-webauthn-columns.ts) is the only pending item — out of scope, left for its owner.

## Models — tenant + facility predicates as specified

- Facility-scoped set exactly per P19-04 § 5.1: [`calibrationDevice.model.ts`](backend/src/models/calibrationDevice.model.ts:83), [`calibrationRecord.model.ts`](backend/src/models/calibrationRecord.model.ts:49), [`certificate.model.ts`](backend/src/models/certificate.model.ts:64), [`maintenanceWorkOrder.model.ts`](backend/src/models/maintenanceWorkOrder.model.ts:51), [`iotReading.model.ts`](backend/src/models/iotReading.model.ts:40), [`inspectionSession.model.ts`](backend/src/models/inspectionSession.model.ts:52), [`inspectionResult.model.ts`](backend/src/models/inspectionResult.model.ts:57), [`inspectionSessionSignature.model.ts`](backend/src/models/inspectionSessionSignature.model.ts:45), plus nullable [`attachment.model.ts`](backend/src/models/attachment.model.ts:46), [`warehouse.model.ts`](backend/src/models/warehouse.model.ts:39), [`nonConformance.model.ts`](backend/src/models/nonConformance.model.ts:43), [`user.model.ts`](backend/src/models/user.model.ts:82), [`auditLog.model.ts`](backend/src/models/auditLog.model.ts:56). All declare `allowNull: true` in the model while the database holds `NOT NULL` where § 5.1 says (ADR-124 Am. 3) — the reviewed shape.
- Global catalogue has no tenant/facility key: [`deviceType.model.ts`](backend/src/models/deviceType.model.ts:5), [`inspectionItemDefinition.model.ts`](backend/src/models/inspectionItemDefinition.model.ts:13) and siblings; [`inspectionTemplateProposal.model.ts`](backend/src/models/inspectionTemplateProposal.model.ts:10) is tenant-scoped, not facility-scoped.
- [`publicDeviceToken.model.ts`](backend/src/models/publicDeviceToken.model.ts:12) and [`userInvitation.model.ts`](backend/src/models/userInvitation.model.ts:11) are tenant-scoped, not facility-scoped, with reviewed skips — the ADR-138/ADR-139 exception.
- No model index on `client_facility_id`, no `references` on it, every `ClientFacility` association is `constraints: false` (ADR-100 Am. 3).

## Services — bound correctly

- Raw SQL goes through [`sql()`](backend/src/utils/sql.util.ts:62) with bound parameters; facility fragments come from [`facilityClause()`](backend/src/utils/facilityPredicate.util.ts:1) with arity 2 (no facility parameter, AM-9).
- Statements naming facility tables without the clause are exactly the reviewed [`RAW_SQL_UNREACHABLE_BY_BOUND`](backend/src/constants/facilityAccess.ts:394) list (transform workers, reconciliation read-only, boot check) — none reachable from a marked route.
- [`skipTenantScope`](backend/src/utils/tenantScope.util.ts:17) never skips the facility dimension (FT-30); [`skipFacilityScope`](backend/src/constants/facilityAccess.ts:140) uses are all reviewed with reasons.
- Mutations run in the service transaction with audit rows (P6-11 pattern); IPM submit/void/report issuance in [`ipmSubmit.service.ts`](backend/src/services/ipmSubmit.service.ts:1) holds lock order device → original → session.

## Routes — gates + two-tenant / two-facility tests

- [`routePermissionGuard.p604`](backend/src/tests/routes/routePermissionGuard.p604.test.js:1) green: every route gated or reviewed-exempt; [`openapiRoutes.undocumented.json`](backend/src/tests/guards/openapiRoutes.undocumented.json:1) is empty (no undocumented route).
- [`twoTenantRoutes.guard`](backend/src/tests/guards/twoTenantRoutes.guard.test.ts:1) 11/11; [`twoFacilityRoutes.guard`](backend/src/tests/guards/twoFacilityRoutes.guard.test.ts:1) 5/5; [`facilityAccessibleRoutes.guard`](backend/src/tests/guards/facilityAccessibleRoutes.guard.test.ts:1) 9/9; [`boundCeilingRoutes.guard`](backend/src/tests/guards/boundCeilingRoutes.guard.test.ts:1) 6/6; [`facilityScopedModels.guard`](backend/src/tests/guards/facilityScopedModels.guard.test.ts:1), [`facilityReadable.guard`](backend/src/tests/guards/facilityReadable.guard.test.ts:1), [`catalogueModels.p2003.guard`](backend/src/tests/guards/catalogueModels.p2003.guard.test.ts:1), [`inspectionCatalogueGlobal.guard`](backend/src/tests/guards/inspectionCatalogueGlobal.guard.test.ts:1), [`skipFacilityScope.guard`](backend/src/tests/guards/skipFacilityScope.guard.test.ts:1), [`facilityContextSource.guard`](backend/src/tests/guards/facilityContextSource.guard.test.ts:1), [`facilityUserIncludes.guard`](backend/src/tests/guards/facilityUserIncludes.guard.test.ts:1), [`socketEmitters.facility.guard`](backend/src/tests/guards/socketEmitters.facility.guard.test.ts:1), [`socketFacilityRooms.guard`](backend/src/tests/guards/socketFacilityRooms.guard.test.ts:1), [`cacheKeyFacility.guard`](backend/src/tests/guards/cacheKeyFacility.guard.test.ts:1), [`literalSubquery.guard`](backend/src/tests/guards/literalSubquery.guard.test.ts:1), [`tenantCreateSelfFacility.guard`](backend/src/tests/guards/tenantCreateSelfFacility.guard.test.ts:1), [`modelIndexColumns.am3.guard`](backend/src/tests/guards/modelIndexColumns.am3.guard.test.ts:1), [`rawSqlFacilityPredicate.d05twin`](backend/src/tests/utils/rawSqlFacilityPredicate.d05twin.test.ts:1), [`apiKeyAuditPrincipal.a282.guard`](backend/src/tests/guards/apiKeyAuditPrincipal.a282.guard.test.ts:1), [`auditCoverage.p611`](backend/src/tests/guards/auditCoverage.p611.test.ts:1) — all green on this tree.
- Public capability routes are reviewed exemptions: [`ipmReports.route.ts`](backend/src/routes/api/ipmReports.route.ts) `GET /verify/:reportNumber` and [`publicDevices.route.ts`](backend/src/routes/api/publicDevices.route.ts) `GET /:token` as `public` in the two-tenant guard.

## Guards run — what failed

- `src/tests/guards` full run: 40/41 suites pass, 308/314 tests pass. The single failing suite is [`prePushHook.a19.test.js`](backend/src/tests/guards/prePushHook.a19.test.js:1) (6 tests): exit 127 (the committed hook is a shell script; this workstation runs `cmd.exe`) plus `EPERM` cleaning temp repos on Windows. Unrelated to Phase 20-21; no product file implicated. Needs its owner (Windows CI path or skip rule) — not fixed here.
- [`typecheck`](backend/package.json:42) (`tsc --noEmit`) exit 0; [`load-check`](backend/package.json:61) OK (739 modules, 116 boot order).

## Bugs fixed

None. No src, migration, contract or OpenAPI file was changed — there was no failing Phase 20-21 assertion to fix within the 3-files-per-bug budget. Fail-before behaviour of every guard above was already proved by its own `bites` cases.

## Phase files — no status change

- [`PHASE-20-UPSTREAM-DB-MIGRATION.md`](TASKS/PHASE-20-UPSTREAM-DB-MIGRATION.md): 9 DONE, complete — stays as is.
- [`PHASE-21-UPSTREAM-BACKEND.md`](TASKS/PHASE-21-UPSTREAM-BACKEND.md): 14 DONE, 0 TODO — stays as is.

## Still needing an owner (not this audit's fix)

1. Live twins on PostgreSQL (upgrade boot, device move cascade, `callibrator_app` grant proofs) were not re-run here — no database in this session; last green per `2026-10-09-p20-04-05-ipm-schema.md`, `2026-10-09-p20-02-08-device-extensions.md`, `2026-10-10-p20-09-upgrade-boot-production-shaped.md`, `2026-10-23-p21-10-live-smoke-and-e2e.md`.
2. Working decisions awaiting the owner: UD-4 (b)/(c), UD-17 side-effects switch, UD-18 (b) leaving-facility data, Q-57·T (b)–(d) — see Phase 12 § 3.
3. P21-09e § 11 gate status (G-22, G-26…G-30, live twins, P18-04, P17-07) per its record — owned by those cards.
4. [`prePushHook.a19`](backend/src/tests/guards/prePushHook.a19.test.js:1) on Windows — owner: CI path or documented skip.
