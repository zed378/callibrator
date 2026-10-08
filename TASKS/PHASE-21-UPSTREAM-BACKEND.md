# Phase 21 — Upstream: Backend Implementation

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 20 — DB-Structure Migration to Our Conventions](./PHASE-20-UPSTREAM-DB-MIGRATION.md) · [Phase 22 — Frontend Implementation](./PHASE-22-UPSTREAM-FRONTEND.md) →

| | |
|---|---|
| **Status** | 2 DONE (P21-09a, P21-09b — 2026-10-08) · 1 TODO (P21-09d) · 11 BLOCKED |
| **Goal** | Services, routes, Zod contracts, OpenAPI, gates, audit, two-tenant tests |
| **Depends on** | Phase 20 |
| **Size** | L |
| **Cards** | 14: P21-01 … P21-08, P21-09a … e (P21-09 split 2026-10-08, ADR-124 Am. 4), P21-10 |
| **Was** | UP-09 (cards UP-09-01 … UP-09-10) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** the features of 02 behind our API. **Spec refs:** 02 (feature rows named per card) · the
Phase 19 specs · docs/API/00 · docs/BACKEND/00 · CLAUDE.md non-negotiables. **Size:** L.

| Card | Title | Features | Status | Depends on |
|---|---|---|---|---|
| P21-01 | Catalogue and template API: device types, versions, publish (audited), published-catalogue download with ETag (routes, contracts and tests: P19-01 spec § 8, § 13). **Also lands (deferred by P20-03, ADR-125 Am. 2):** `parseDecimal`, `parseLimit`, `normaliseUnit`, `evaluate`, `resolveTemplateVersion`, `inspectionCatalogue.ts`, the brand constructors, the retired-type 400 on a device; the schema, models, vocabularies and canonical hash are built (0111/0112) | F-19 … F-22, F-31, F-79 | BLOCKED | P20-01, 03, **P20-06** (the read gates name the `ipm` / `ipm-templates` slugs — P19-01 G-11) |
| P21-02 | Device extensions: QR lookup, type, photos (sniffing, HEIC → JPEG, EXIF strip, thumbnails, ClamAV), photo replace; **+ `GET /calibration-devices?view=field`** (the PWA working set, P19-08 § 7.2) | F-23 … F-29 | BLOCKED | P20-02, 08 |
| P21-03 | IPM sessions: prefill, draft, submit, correction, void, list/history; idempotency keys for offline sync; **+ for the PWA (P19-08 spec § 9.5, 2026-10-08):** `POST /attachments` honours `Idempotency-Key`, tenant/account refusals carry `SCOPE_LOSS_CODES`, `POST /field/wipes` | F-35 … F-57 | BLOCKED | P20-04, 05 |
| P21-04 | IPM side effects in the submit transaction: work order, device status, scheduler flag, "due" flag; **+ the IPM report's issuance in the submit (number, token, hash, issuer snapshot), the report document, the signatures route and the public verification** ([P19-06 spec](../MEMORY/specs/P19-06-ipm-report-document.md) § 4 – § 10, added 2026-10-08) | F-48, F-51, F-54, F-58 … F-61 | BLOCKED (UD-17 a working decision; P19-06 DONE as spec) | P21-03, UD-17, P19-06 |
| P21-05 | Quick calibration-date entry by QR ~~with certificate attachment~~ — **no file** (owner rule; P19-05 spec § 7, ADR-133): `POST /calibration-devices/:id/calibration-dates`, the next-due-date derivation on create / correction / void (fail-before tests), "calibration due" | F-32, F-62 … F-64 | BLOCKED (spec DONE 2026-10-08; waits on the columns of P20-02) | P19-05, **P20-02** |
| P21-06 | Export **reads** (owner rule 2026-10-07, ADR-126 § 8): paginated API reads behind the inventory and calibration recaps — **no backend PDF/XLSX, no export batch job, no stored file**; rendering is P22-06 / Phase 23 | F-65 … F-69 | BLOCKED | P21-02 |
| P21-07 | Dashboard condition metrics and technician activity list | F-70 … F-73 | BLOCKED | P21-03 |
| P21-08 | Public device page API (capability token, rate-limited, exemption list) | F-74, F-75 | BLOCKED | P12-06 |
| P21-09 | Client facilities and facility-bound users: facility CRUD, binding users, the facility dimension in the hooks and the route layer (ADR-124; **+ for the PWA (P19-08 § 9.5): `scopeFingerprint` on `POST /auth/verify` (AM-26) and the facility `SCOPE_LOSS_CODES` (AM-1)**; was "access grants and the active-facility switch"; spec [`P19-04`](../MEMORY/specs/P19-04-client-facilities.md) § 7 – § 13, tests § 17) **Hand-off from P20-07 (2026-10-08, [record](../MEMORY/records/2026-10-08-p20-07-client-facilities.md), ADR-124 Am. 3):** (1) build G-F1's service default — until then a tenant with a second facility refuses every device create that omits the facility (23502, the database default stands in only for single-facility tenants); decide and record whether the device branch of `facility_insert_default` stays; (2) `calibrationDevices.service#findSerialHolder` pre-checks per TENANT, the index is per FACILITY (UD-9); (3) `auditService.logAction` resolves `clientFacilityId` from the resource when omitted (spec § 16); (4) the hooks' AM-6 refusal beside the database triggers; (5) review `createSelfFacility`'s `skipTenantScope` with the 29 sites. | F-13 … F-17, F-26 | **SPLIT 2026-10-08** into P21-09a … e below (ADR-124 Am. 4 § 1; [record](../MEMORY/records/2026-10-08-p21-09-facility-dimension.md)) — the five hand-offs are closed by P21-09a | P20-07 |
| P21-09a | The facility dimension: context (`userId`, `clientFacilityId`, `facilityBound`, one writer), the hooks (every branch of spec § 7.3 – § 7.4, `FACILITY_READABLE`, reviewed `skipFacilityScope`, AM-6 refusal), the refusal codes with a top-level `code` (§ 7.2, AM-1), the socket context, rooms and re-check (AM-19/20), `POST /auth/verify` `clientFacilityId`/`facilityBound`/`facilityMode`/`scopeFingerprint` (AM-26); hand-offs 1 – 5 of P20-07 (G-F1 service default, serial per facility, audit stamping, AM-6, the `skipTenantScope` review) | F-13 … F-17 | **DONE 2026-10-08** — [record](../MEMORY/records/2026-10-08-p21-09-facility-dimension.md); ADR-124 Am. 4 | P20-07 |
| P21-09b | The route layer: `FACILITY_ACCESSIBLE_ROUTES` + `facilityRouteGate` from `tenantContextMiddleware` over the route index (parity proved), G-09, G-10; `GET /client-facilities/mine` (S-8); `PUT /users/:userId/client-facility` (bind / re-bind / unbind / confirm, sessions revoked, one audit row per facility, `FACILITY_BINDING_ENABLED`); the facility administration **service** (§ 4.4 – § 4.6) | F-13 … F-17 | **DONE 2026-10-08** — same record | P21-09a |
| P21-09c | The facility administration **routes** (`GET /`, `/options`, `/:clientFacilityId`, create, edit, status, delete, `/:clientFacilityId/users`) + OpenAPI + two-tenant tests; the bound menu ceiling in `effectivePermission` and `facilityBound` in `GET /menu-groups/my-permissions` (P18-03 § 5, § 13; G-P1 … G-P3) | F-13 … F-17 | BLOCKED | **P20-06** (seeds `client-facilities`, `ipm`, `ipm-templates`; a gate on an unseeded slug does not compile — A-07) |
| P21-09d | Device move (`POST /calibration-devices/:id/move`, `GET …/moves`, § 11), storage keys with the facility segment, `rekey_pending` + re-key job (§ 9.3 – § 9.4), signed-link token v3 (§ 9.5, AM-22), `recipientsFor` and `emitForRow` (§ 9.1, § 9.6), `dashboard:metrics:v2` keys (§ 9.2), `facilityClause` + the d05 twin rule (§ 8, G-14), G-15, G-19 guards | F-26 | TODO | P21-09b |
| P21-09e | The A-90 sweep — `personDisplay`, redaction for bound viewers (§ 12, G-24); the domain routes A-1 … A-8 and the remaining self routes (S-2 revoke, S-3, S-4 with its subject-row skips, S-5 `:id`, S-7 avatar, MFA/password with the settings skip) marked with `twoFacilitySuite` (G-07, G-08); SSO JIT / SCIM pending (§ 10.6, G-18); binding at `POST /users` and the mass-assignment test (§ 10.2 – § 10.3); the 30-day bound-account deactivation job and the ended-retention setting (§ 4.6, UD-18 (b)); the G-31 regression evidence | F-13 … F-17 | BLOCKED | P21-09c, P21-09d |
| P21-10 | Live API smoke of every new route and live E2E specs for the backend flows | all | BLOCKED | P21-01 … 09 |
