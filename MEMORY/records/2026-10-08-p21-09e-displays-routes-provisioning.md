# P21-09e — the A-90 person displays, the domain and self routes marked with their two-facility suites, IdP provisioning pending, binding at creation, the off-boarding job (G-07, G-08, G-17, G-18, G-24, G-31)

**Date:** 2026-10-08 · **Task:** P21-09e (Phase 21), unblocked by P21-09c and P21-09d · **Decision:** ADR-124 Amendment 6 (§§ 8 – 13, new) · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) § 4.6, § 10.2 – § 10.6, § 12 (as-built notes added); [`P18-03`](../specs/P18-03-facility-scope-permissions.md) § 8, § 10.2 · **Base:** `db7befd`, working tree, **not committed** · **Kind:** code + tests + contracts + OpenAPI + frontend types + Helm/compose env.

> **Privacy:** synthetic fixtures only.

## What was built

| | |
|---|---|
| Person displays (§ 12) | `services/personDisplay.service.ts` (`displayPeople` — one batched read through a reviewed `skipFacilityScope`, Platform support for an outsider, redaction for a bound viewer of another facility's person; `withDisplays`, `certificateSnapshotDisplay`); contract `@callibrator/contracts/people` (`personDisplay`, `PERSON_DISPLAY_KEYS`); `performerDisplay` (records), `uploaderDisplay` (files), `calibratedBy/approvedBy/signedByDisplay` (certificates; a signed one from its snapshot), `assigneeDisplay` (work orders) on list and single reads, for every viewer; documented in OpenAPI and the maintenance contract. Unsigned certificate document: people's names via a reviewed include-level skip (Am. 6 § 8) |
| Domain routes | A-1 … A-8 on `FACILITY_ACCESSIBLE_ROUTES`; A-2/A-3 `calibrationDevices.service#boundWriteRefusal` (status 400, unreadable location 404); A-5 `middlewares/boundUploadGate.middleware.ts` (`FACILITY_UPLOAD_REFUSED`) |
| Self routes | S-1 `pass-is-valid`, `just-update-password`, `mfa/setup|verify|disable`; S-2 `POST /sessions/mine/:id/revoke`; S-3 the authenticated WebAuthn routes; S-4 the nine GDPR self routes; S-5 `PATCH /:notificationId/read`, `DELETE /all|bulk|/:notificationId`; S-7 avatar POST/DELETE (`selfParam`) |
| Reviewed skips (P18-03 § 10.2) | `storage/config.service#getTenantConfig`, `quota.service#getStorageUsageMb`, `auth.service#passwordManagedBy`, `gdpr.service#pagesOf`, `personDisplay.service#displayPeople`, `certificateDocument.service#DOCUMENT_INCLUDES` — each on `FACILITY_SCOPE_SKIPS` with its comment |
| Fixture + guards | `fixtures/twoFacilitySuite.ts` (G-07); `guards/twoFacilityRoutes.guard.test.ts` (G-08; `boundGate` held to the chain); `guards/facilityUserIncludes.guard.test.ts` (G-24) |
| IdP provisioning (§ 10.6) | `services/facilityProvisioning.ts`; SSO JIT and SCIM create `facilityBindingPending` in a multi-facility tenant; SCIM facility attributes / paths / values → 400; a bound user's non-bound role → 400 |
| Binding at creation (§ 10.2) | `createUserSchema.clientFacilityId`; `user.service#resolveCreateBinding` (switch, unbound actor, facility in tenant, not self, active, bound role); audited `operation: BIND_FACILITY` |
| Off-boarding (§ 4.6, UD-18 (b)) | `services/boundAccountDeactivation.service.ts`, `middlewares/boundAccountDeactivationScheduler.middleware.ts` (registered in `index.ts`; `BOUND_ACCOUNT_DEACTIVATION_SCHEDULER` in both `.env.example` files and disabled in the Helm API-pod ConfigMap); settings `client_facilities_bound_user_deactivation_days` (1 – 3650, default 30) and `client_facilities_ended_retention_years` (1 – 100) on the tenant-admin allow-list; system actor `system:bound-account-deactivation`; job reason `SYSTEM_TASKS.BOUND_ACCOUNT_DEACTIVATION` |
| Pending lists | G-P2 `PENDING_LOAD`: Dashboard → P21-07 (A-10), Warehouses → P20-02 / P21-02 (A-9), E-Signature → P21-03/04; the maintenance load route corrected to `GET /`. G-P3 `PENDING`: `esignature` only (P21-03/04). **Every P21-09e entry is gone** |

## Evidence — tests named (all in `npm run test:coverage`)

- G-07/G-08: `tests/routes/domainRoutes.twoFacility.test.ts` (A-1 … A-4, A-6 … A-8; `@two-facility` markers for every marked `:id` route; lists hold F1 and not F2; FT-39 unbound control; A-2/A-3 rules) · `tests/routes/selfRoutes.twoFacility.test.ts` (S-1, S-2, S-3, S-5, S-7) · `tests/routes/gdprSelf.twoFacility.test.ts` (S-4; the export holds the subject's audit rows of every facility — **fail-before: without the `pagesOf` skip it fails**) · `tests/guards/twoFacilityRoutes.guard.test.ts` (planted).
- G-P6 / A-5: `tests/routes/attachmentsUpload.bound.test.ts` (own device 201 under F1's key; F2 device 404 = missing; every other type 403, the quarantined file removed; ROOM USER 403; a failed permission lookup 500, never a pass).
- G-24: `tests/services/includes.a90.facility.test.ts` (own records authored by provider staff present with a non-redacted display; a moved-in record of an F2-bound person redacted for the bound viewer, full for staff; Platform support; snapshot; FT-15 key set) · `tests/services/personDisplay.test.ts` · `tests/guards/facilityUserIncludes.guard.test.ts` (planted).
- G-17: `tests/routes/userBinding.massAssignment.test.ts` (binding at creation and its refusals; edit/profile/rectify change no binding; the service's own bound-actor refusal).
- G-18: `tests/services/scim.facility.test.ts` (SCIM and SSO JIT).
- Off-boarding: `tests/services/boundAccountDeactivation.test.ts`, `tests/services/facilityOffboarding.settings.test.ts`.
- Contracts: `packages/contracts/test/people.p2109e.test.ts`.
- Unchanged and green in the full run (G-31): `guards/twoTenantRoutes.guard`, `routes/routePermissionGuard.p604`, `models/unscopedModels.d17`, `utils/tenantScope.*`, `guards/apiKeyAuthorizedWriters.v05.guard`, `guards/superAdminPredicate.n01.guard`, `models/includeRequired.d12`, `services/includes.a90`, the ADR-102 suites.
- Existing tests changed, each for a deliberate behaviour change (no assertion weakened): `controllers/certificate.controller.test.js`, `controllers/certificate.controller.envelope.a103.test.js`, `controllers/calibrationRecords.controller.test.js`, `controllers/envelope.a112.test.js` (the additive `…Display` fields); `services/sso.service.test.js`, `services/scim.service.test.js` (a `ClientFacility.count` double); `services/quota.ownBucket.q06.test.js` (the sum carries `skipFacilityScope`); `constants/systemActors.a124.test.js`, `utils/jobContext.w12.test.js` (the new actor and job reason); `guards/facilityContextSource.guard.test.ts` (the new readers); `services/menuEffectiveAccess.bound.test.ts`, `guards/boundCeilingRoutes.guard.test.ts` (pending lists shrunk, re-assigned).

## Gates (2026-10-08, quiet tree — the only agent; P21-09d and P21-09e together)

- `node scripts/ci/eslint-ratchet.js`: "0 error(s), 0 warning(s); baseline 0"; `npm run lint` exit 0.
- backend `npm run typecheck` 0 errors; `npm run ratchet` 695 `.js`, at the floor; `npm run build:dist` OK (688 TypeScript files; contracts 57); `npm run load:check` OK in both modes (678 modules; 110 in boot order); `openapi:check` current (503 operations); `openapi:lint` no new error (15 warnings).
- **`npm run test:coverage -- --ci`: 974 suites passed, 42 skipped, 0 failed; 16,574 tests passed, 343 skipped, 0 failed; 100 / 100 / 100 / 100**, in 378 s (Node 26).
- contracts: `npm test` 56 suites, 1,214 tests, 100 %; `typecheck` 0; `lint` 0.
- frontend (`schema.d.ts` regenerated): `npm run typecheck` 0; `api:types:check` current; `npm test -- --ci` 320 suites, 3,480 tests, 94.16 / 85.07 / 90 / 94.8 (gate 90 / 81 / 86 / 91).
- Not run: the live PostgreSQL suites (no migration or trigger changed; the move's cascade is P20-07's `deviceMove.p2007.live`), the live E2E suite (no bound account can exist).

## The § 11 pre-invitation gate — status after this card

**Not green.** Built and named in a record now: G-01 … G-03, G-05, G-06, G-08 … G-10, G-12 … G-14 (unit + guard), G-15, G-16, G-17, G-18, G-19, G-20, G-21, G-23, G-24, G-25 (P20-07), G-31 (this run). **Still open:** G-04 and G-14's live twins (`tenantHookless.facility.live`, `rawSqlFacility.live` — no bound-reachable raw statement exists yet), G-07 for the routes later cards mark (A-9, A-10, N-1 … N-13), G-11 (P20-07's guard — confirm in its record), G-22 (P21-06), G-26 (P21-03), G-27 (P22-10), G-28 (live two-facility E2E: P21-10 / P22-10 / P26-02), G-29 (P24-01), G-30 (P25); P18-04's test plan; P17-07's pentest; G-P2 / G-P3 still list A-10, A-9 and E-Signature. **`FACILITY_BINDING_ENABLED` must stay off.** `docs/SECURITY/15` § 11's status column (owned by its author) should be updated from these two records — not edited here.

## Not done / open

- The data-retention report of records past `client_facilities_ended_retention_years` (the setting is stored and readable).
- The frontend: `usePermissions` reading `facilityBound`, the bound navigation, the displays on the pages (P22-09).
- A periodic re-key sweep (P21-09d record).
