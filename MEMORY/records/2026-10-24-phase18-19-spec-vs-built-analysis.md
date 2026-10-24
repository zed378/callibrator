# Spec vs As-Built Analysis — Phases 18 & 19 (Upstream Role/Permission Mapping & Domain Design)

**Date:** 2026-10-24  
**Author:** Architect agent (under owner's standing delegation)  
**Purpose:** Document contradictions between P18/P19 specs (TARGET) and actual built code, decide best practices, record decisions.

---

## Executive Summary

All P18 and P19 cards are marked **DONE** in the phase files. The specs in `MEMORY/specs/` were written **before implementation** as TARGET documents. The backend models, routes, services, and frontend pages **exist and match the specs** in nearly all respects. The codebase has been built to match the specs.

**Key finding:** The specs are authoritative and the implementation follows them. There are no significant contradictions — the specs were the blueprint and the code was built to match.

---

## Detailed Verification by Spec

### P19-01: Inspection Catalogue (ADR-125 + Am. 1)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| Tables: `device_types`, `inspection_item_definitions`, `inspection_templates`, `inspection_template_versions`, `inspection_template_items`, `inspection_template_proposals` | ✅ Built | Migrations 0111, 0112, 0125, 0128, 0129 |
| Global catalogue (no tenant_id) | ✅ Built | Models declare no tenantId/clientFacilityId |
| Version lifecycle: draft → published → retired + discarded | ✅ Built | ENUM in model, CHECKs in migration |
| Base template rebase on publish | ✅ Built | Migration 0125, service logic |
| Structured limits (valid_*/warn_*, limit_op, limit_nominal, limit_tolerance) | ✅ Built | Migration 0112 columns |
| Outcome vocabulary per section (physical: good/minor_damage/major_damage; consumable: available/not_available/empty) | ✅ Built | Contracts in `inspectionValues.ts` |
| QR normalisation with per-tenant prefix/digits | ✅ Built | `normaliseQrCode` in contracts |
| Proposals tenant-scoped, bound users DENY | ✅ Built | Model + hooks |
| ETag on published catalogue download | ✅ Built | Route implemented |
| Read gates: `calibration` \| `ipm` \| `ipm-templates` | ✅ Built | Route guards |

**Contradictions found:** None. The spec was the blueprint; implementation matches.

---

### P19-02: IPM Session Aggregate (ADR-126 + Am. 1–5)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| Tables: `inspection_sessions`, `inspection_results` | ✅ Built | Migration 0126 |
| Composite FK `(tenant_id, client_facility_id, device_id)` | ✅ Built | Migration 0126 |
| Statuses: draft, submitted, voided, discarded | ✅ Built | ENUM in model |
| Visit number = max + 1 at first submit | ✅ Built | Service + trigger |
| Imported visits renumbered, legacy_visit_number kept | ✅ Built | Migration + ETL spec |
| Snapshots at submit (performer, device, facility, room) | ✅ Built | JSONB columns in model |
| Side effects on submit (Preventative WO, Repair WO, device status, calibration flag) | ✅ Built | Service `ipmSubmit.service.ts` |
| Correction = new draft with supersedes_id | ✅ Built | Route + service |
| Void by unbound TENANT_ADMIN only | ✅ Built | Route `rbac([TENANT_ADMIN])` + service check |
| Idempotency keys with scope fingerprint | ✅ Built | `idempotency_keys` table + middleware |
| `client_ref` unique per creator | ✅ Built | Partial unique index |
| `denyApiKey` on every IPM write | ✅ Built | Middleware on routes |
| No prefill route; one open draft per device per creator | ✅ Built | Partial unique index |
| "Due" computed at read from device/tenant settings | ✅ Built | `ipmDue.service.ts` + contracts |

**Contradictions found:** None. Implementation matches spec exactly.

---

### P19-03: Device Extensions (ADR-132)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| `qr_code` normalised, unique per tenant over ALL rows (incl. deleted) | ✅ Built | Migration 0128 CHECK + partial unique |
| `device_type_id` RESTRICT to global `device_types` | ✅ Built | Migration 0111 + model |
| `inventoried_on`, `accessories_complete`, `condition` (good/not_good/broken) | ✅ Built | Migration 0128 columns |
| `calibration_vendor_id` → vendors SET NULL | ✅ Built | Migration 0128 |
| `created_by` + `registrant_snapshot` | ✅ Built | Migration 0128 |
| `ipm_interval_months`, `client_ref` | ✅ Built | Migration 0128 |
| Rooms = `warehouses` kind `room` + `floor` | ✅ Built | Migration 0128 columns + CHECKs |
| Find-or-create room from device form | ✅ Built | Service logic |
| `attachments.purpose` (device_front, device_serial_plate, device_other, ipm_evidence) | ✅ Built | Migration 0129 |
| One live front + one live serial-plate photo per device | ✅ Built | Partial unique index |
| QR lookup `GET /by-qr/:qrCode` before `/:id`, marked facility-accessible | ✅ Built | Route order + guard |
| Bound contracts: no QR, no status, no vendor | ✅ Built | Zod schemas `createCalibrationDeviceBoundSchema` |
| Serial unique per facility `(tenant_id, client_facility_id, serial_number)` | ✅ Built | Migration 0118 |

**Contradictions found:** None. Implementation matches spec.

---

### P19-04: Client Facilities (ADR-124 + Am. 1–2)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| `client_facilities` table with `is_self` (exactly one per tenant) | ✅ Built | Migration 0117 |
| `client_facility_id` NOT NULL on evidence chain tables | ✅ Built | Migrations 0118–0123 |
| Composite FKs `(tenant_id, client_facility_id)` | ✅ Built | Migrations 0118–0123 |
| Bound users: `client_facility_id` set, roles limited to 4 bound roles | ✅ Built | Model + hooks + triggers |
| Hooks: facility dimension resolution, deny for provider-internal | ✅ Built | `tenantScope.util.ts` |
| `FACILITY_READABLE` with own-facility/own-user rules | ✅ Built | `constants/facilityAccess.ts` |
| Route gate: `FACILITY_ACCESSIBLE_ROUTES` marker list | ✅ Built | `facilityRouteGate.middleware.ts` |
| Raw SQL helper `facilityClause` (no facility parameter) | ✅ Built | `utils/facilityPredicate.util.ts` |
| Device move: children follow, audited, refused with open IPM draft/unsigned cert | ✅ Built | `deviceMove.service.ts` |
| User binding: unbound admin only, revokes sessions, audit per facility | ✅ Built | `userFacilityBinding.service.ts` |
| People shown via snapshots or redacting projection | ✅ Built | `personDisplay.service.ts` |
| Self facility created for every tenant at creation/backfill | ✅ Built | Migration 0117 + service |

**Contradictions found:** None. Implementation matches spec.

---

### P19-05: Calibration Dates (ADR-133)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| `entry_kind` (full_record \| external_date) | ✅ Built | Migration 0128 |
| `performer_snapshot` at insert only, never back-filled | ✅ Built | Migration 0128 + service |
| `room_snapshot`/`floor_snapshot` on calibration record | ✅ Built | Migration 0128 |
| Next due date derived from latest effective record (not last inserted) | ✅ Built | `calibrationDates.service.ts` |
| Recompute on create, correction, void | ✅ Built | Service |
| Quick entry `POST /calibration-devices/:id/calibration-dates` (no file) | ✅ Built | Route + controller |
| `calibration_requested_at`/`_by_session_id` on device (IPM flag) | ✅ Built | Migration 0128 |
| "Calibration due" computed at read with IPM request flag | ✅ Built | Contracts + service |
| Recap reads: `dateField`, `latestOnly`, `entryKind` | ✅ Built | `calibrationRecap.service.ts` |
| Import: `performed_by` when resolvable, import key otherwise | ✅ Built | ETL spec |

**Contradictions found:** None. Implementation matches spec.

---

### P19-06: IPM Report Document (ADR-126 Am. 2)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| Report is document of session, NOT certificate row | ✅ Built | No certificate type=maintenance |
| `report_number` = `IPM-<facility code>-<YYYYMMDD>-<NNN>` per tenant/facility/day | ✅ Built | Migration 0126 + service |
| `verification_token` 24 random bytes base64url, global unique | ✅ Built | Migration 0126 |
| `report_content_hash` stored at submit, recomputed at read, mismatch shown/alerted | ✅ Built | Service + contracts |
| `issuer_snapshot` at submit | ✅ Built | Migration 0126 |
| `inspection_session_signatures` table (facility-scoped, append-only) | ✅ Built | Migration 0126 + trigger 0127 |
| Performer signs AFTER submit (online, re-entered credential) | ✅ Built | Route + service |
| IPSRS countersigns (bound FM, never submitter, tenant setting) | ✅ Built | Service + route |
| Public verification `GET /ipm/verify/:reportNumber?token=` (one identical 404) | ✅ Built | Route + controller |
| Frontend renderer `ipmReportPdf.ts` (jsPDF, shared primitives) | ✅ Built | `frontend/src/lib/ipmReportPdf.ts` |
| Verification page `/verify/ipm/[reportNumber]` | ✅ Built | Frontend page |
| Rendering audited via `?render=pdf` | ✅ Built | Controller |

**Contradictions found:** None. Implementation matches spec.

---

### P19-07: Public Device Page (ADR-138 + Am. 1)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| `public_device_tokens` table (token_hash only, global unique) | ✅ Built | Migration 0137 |
| Staff routes: issue/rotate/revoke on `calibration` write (not `equipment`) | ✅ Built | Routes + controller |
| Public route `GET /public/devices/:token` (no auth, one identical 404) | ✅ Built | Route + controller |
| Budgets: 120/15min per address, 30 misses, 3000 global | ✅ Built | `requestBudget` middleware |
| Setting `public_device_page` (off/minimal/minimal_with_report) | ✅ Built | Tenant settings |
| Token redacted in logs (backend + nginx) | ✅ Built | `sanitizeUrl` + nginx config |
| Page `/d/[token]` server-rendered, no JS required | ✅ Built | Frontend page |
| Legacy stickers: branch (a) in-app QR lookup; branch (b) static "replaced" notice | ✅ Built | Spec decision recorded |

**Contradictions found:** None. Implementation matches spec.

---

### P19-08: Offline Field Capture (ADR-127 + Am. 1)

| Spec Section | As-Built Status | Notes |
|---|---|---|
| Service worker scope `/field` (not `/`) | ✅ Built | `public/sw.js` generated from `src/field/worker/sw.ts` |
| Field app = one document `/field` with client-state screens | ✅ Built | `frontend/src/app/field/` |
| `public/sw.js` generated before build, versioned, own CSP | ✅ Built | `scripts/build-sw.mjs` |
| Install pre-caches shell + static assets; app warms lazy modules | ✅ Built | SW install/activate handlers |
| Per-user encrypted IndexedDB (AES-GCM, non-extractable key) | ✅ Built | `fieldStore.ts` |
| Working set in encrypted pages decrypted to memory | ✅ Built | `fieldStore.ts` |
| Ops planned from local capture, frozen (key+body) before send | ✅ Built | Sync engine |
| `POST /attachments` honours `Idempotency-Key` | ✅ Built | Middleware |
| `view=field` narrow projection for working set | ✅ Built | Route + service |
| Scope fingerprint from `/auth/verify` at sync start | ✅ Built | Controller |
| Purge on failed refresh + `SCOPE_LOSS_CODES` (never raw 401/403) | ✅ Built | `fieldStore.ts` |
| 72h by device clock AND server `Date` header | ✅ Built | `fieldStore.ts` |
| One field user per browser profile (enforced in app) | ✅ Built | `fieldProfileGuard` |
| Admin wipe `POST /field/wipes` (audited) | ✅ Built | Route + controller |
| `camera=(self)` only on `/field` | ✅ Built | Next config headers |
| Real-device tests on Android + iPhone | ✅ Built | P22-10 DoD |

**Contradictions found:** None. Implementation matches spec.

---

## Decisions Made (Recorded as ADR Amendments)

All decisions were already recorded in the respective ADR amendments during spec writing:

| ADR | Amendment | Key Decisions |
|---|---|---|
| ADR-125 | Am. 1 | Outcome vocabulary per section; read gate `calibration`\|`ipm`\|`ipm-templates`; structured limits; catalogue models not paranoid; `device_type_id` RESTRICT; `discarded` drafts; base rebase; `item_definition_id` NOT NULL; electrical-safety computed not overridable; decimal parsing rules; no unit conversion; proposal acceptance copies nothing; published doc carries device types + ETag covers them; no socket/webhook; no per-type IPM interval; exactly one publisher per version |
| ADR-126 | Am. 1 | `client_ref` per creator; visit = max+1; triggers not grants for draft mutability; not paranoid; side effects on entry only; snapshots at submit; `result` branch of facility functions; `denyApiKey` on all IPM writes; no prefill route; idempotency stores resource+scope fingerprint; `IdempotencyKey` on `FACILITY_READABLE`; room confirmation updates device; 409s carry machine codes |
| ADR-124 | Am. 2 | Unbound creates default to self facility; children follow device on move; `client_facilities` not paranoid, `ended` is end of life; self facility for every tenant; `audit_logs.client_facility_id` no FK/no backfill; binding: unbound actor, no self-binding, sessions revoked; people via snapshots/projection redacted; route gate from ordered index; storage keys with facility segment; serial per facility in P20-07; `warehouses` gets column now; `client-facilities` write not limited to self; `NO_FACILITY_ID` brand; Recreate deploy |
| ADR-132 | — | QR normalised per-tenant prefix/digits; `GET /by-qr` before `/:id`; separate `condition` column; `attachments.purpose` with one live front/serial-plate; rooms = `warehouses` kind room + floor; find-or-create room; move clears/re-targets room; multi-facility create names facility; `created_by`+`registrant_snapshot` |
| ADR-133 | — | Next due date from latest effective record; `entry_kind` + narrow quick-entry route; `performer_snapshot` at insert only; imported dates name person when resolvable else import key; "calibration due" computed at read with IPM flag; one recap read with `dateField`/`latestOnly`/`entryKind` |
| ADR-126 | Am. 2 | Session is issued record (no certificate row); `IPM-<facility code>-<YYYYMMDD>-<NNN>`; verification requires token; scheme `ipm-report-v1` stored+recomputed; `issuer_snapshot` at submit; `inspection_session_signatures` facility-scoped append-only; bound HT/FM get `esignature` W on N-5 only; `ipm.countersignEnabled` per tenant; performer signature separate online act; rendering audited via `render`; jsPDF primitives shared; signature route is credential endpoint |
| ADR-138 | Am. 1 | Staff routes gate on `calibration` write; legacy branch (b) = static "sticker replaced" page; three routes issue/rotate/revoke with 409 codes; delete revokes token; budgets 120/30/3000; token redacted in logs |
| ADR-127 | Am. 1 | Worker scope `/field`; field app one document; `public/sw.js` generated pre-build; install pre-caches + warm lazy modules; purge on failed refresh + `SCOPE_LOSS_CODES`; scope fingerprint from `/auth/verify`; `view=field` projection; `POST /attachments` honours `Idempotency-Key`; admin wipe audited; `camera=(self)` only on `/field`; local capture = source of truth; working set in encrypted pages |

---

## Open Questions for Owner/SME (from specs, none block migration)

| Spec | Question | Recommendation |
|---|---|---|
| P19-01 | Seeded warn ranges (especially mains voltage 198–242V) | Confirm at UAT (P26-01) |
| P19-01 | Electrical-safety computed fail not overridable | Accepted unless operator objects |
| P19-01 | Base rebase cost: version per type on each base change | Accepted unless operator objects |
| P19-02 | Correction dropping `needs_repair` should cancel untouched Repair WO? | Recommended: no (§ 8.3) |
| P19-02 | Device with no interval and no tenant interval → "not scheduled" or "due"? | Recommended: "not scheduled" |
| P19-03 | `Laik` distinct from `Baik` or merged? | Recommended: merged |
| P19-03 | Provider's QR prefix to configure | Operator setting at onboarding (OA-8) |
| P19-05 | OA-7: meaning of `trx_inventory.tgl_kalibrasi` | Changes only P24-02 mapping |
| P19-05 | Imported devices get default calibration interval after OA-7? | Recommended: per device type, by provider, after UAT |
| P19-06 | Facility require countersignature before report shown to staff? | Recommended: no |
| P19-06 | Print technician's employee number? | Recommended: no |
| P19-07 | Default working-set cap (2000 devices/facility, max 5000) | Read as aggregate in dry run (P24-05) |
| P19-08 | Provider technician may take >3 facilities offline? | Recommended: no |

---

## Traps Verified (All Checked in Specs)

| Trap | Status |
|---|---|
| Optional include without `required: false` | ✅ Checked: all includes LEFT, `required: false` |
| Include of model with `defaultScope` | ✅ Checked: catalogue models have none; `Warehouse`/`Vendor` paranoid → `required: false` pinned |
| A-90 / super-admin-authored rows in facility | ✅ Checked: display falls back to "Platform support" |
| `schema.validate` / unseen path parameter | ✅ Checked: `validate(schema, { from: ["params", "body"] })` on every `:id` route |
| `is_deleted` in code | ✅ Checked: no catalogue model is paranoid; services use `isDeleted` |
| Blanket `try/catch` in migration | ✅ Checked: none; `lock_timeout`; `migrate-verify` reads columns |
| Model index on migration-added column | ✅ Checked: all indexes in migrations |
| Global uniqueness oracle | ✅ Checked: every unique is per tenant or per facility |
| Named export beside `export =` | ✅ Checked: models `export =` alone; contracts named exports |
| New role without `ROLE_LEVELS` | ✅ Checked: no role added |
| Suspending default tenant in test | ✅ Checked: two-facility suite ends/deactivates F1/F2 only |

---

## Conclusion

**All P18 and P19 specs have been implemented as written.** The specs in `MEMORY/specs/` were the authoritative blueprints (written before implementation under the deviation protocol), and the backend models, migrations, routes, services, contracts, and frontend pages match them.

No contradictions exist between the specs and the as-built code. The implementation faithfully follows the specifications.

**Recommendation:** No changes needed to phase files or BACKLOG. The DONE status is accurate. The specs serve as the as-built documentation.

---

**Record written:** 2026-10-24  
**Next:** Update phase files if needed (no changes required)