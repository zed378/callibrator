# P19-04 — The client-facility spec (entity, facility column, hooks, binding, device moves, two-facility proof)

**Date:** 2026-10-07 · **Task:** P19-04 (Phase 19, Domain Design; BACKLOG Q-57) · **Decision:** ADR-124 Amendment 2 · **Spec:** [`MEMORY/specs/P19-04-client-facilities.md`](../specs/P19-04-client-facilities.md) · **Base commit:** `bec925f` (working tree with other agents' uncommitted work, incl. A-365) · **Kind:** documentation only — no code, migration or test was written or run; nothing was committed

> **Privacy:** no upstream data value appears in this record, the spec or any amended document. Counts are structural; every example id, name and code is synthetic.

## What the card asked

`client_facilities` and its lifecycle; `client_facility_id` on the evidence chain and the back-fill to each tenant's self facility; the second dimension in `tenantScope.util`; `FACILITY_READABLE`; the route marker; the raw-SQL helper; socket rooms; cache keys; the A-90 sweep with performer snapshots; the two-facility suite and guards. The coordinator also asked for user binding with session revocation, storage keys and signed URLs, the device move (OQ-5/OQ-12), the API, the admin UI requirements, import implications, the test plan mapped to G-01 … G-31, and the AM-n adopted. All are in the spec (§ 4 – § 18).

## What was read

ADR-124 and Amendment 1, ADR-125/126/127, ADR-062/0057, ADR-084 Q-02/0089, ADR-107/0103; `docs/SECURITY/15` (read only — another agent edits § 13); the P18-03 and P19-01 specs; `docs/UPSTREAM/03`, `04`, `05`, `07`, `08`; Phase 12 § 2 – § 3. Code (working tree): `tenantScope.util.ts`, `tenantContext.middleware.ts`, `auth.middleware.ts`, `auth.service#getAuthUserWithTenant`, `sql.util.ts`, `jobContext.util.ts`, `config/socket.ts`, `notification.service`, `dashboardCache.service`, `storage/keys.ts`, `attachment.service` (A-365 signed links), `session.service`, the three tenant-creation paths, the evidence models and their includes, `attachmentResources.ts`, `routeGateExemptions.ts`, migrations 0026/0057/0089/0103/0111, the 16 files holding `skipTenantScope: true`.

## What surprised me (findings that changed the design)

1. **ADR-124 § 5 would have broken every existing tenant**: it asks unbound principals to supply the facility on create; no create path sends one. → defaults to the self facility in the service (G-F1).
2. **"Children keep their facility" contradicts the composite keys the same ADR asks for.** A moved device could not keep `(tenant, facility, device)` FKs on its children. → children follow the device through one audited move (OQ-5/OQ-12 decided here, not in P19-03, because the keys are this card's) (G-F2).
3. **A soft-deleted facility would hide every device that references it from includes** (paranoid ⇒ `defaultScope` ⇒ INNER JOIN, A-75), and RESTRICT never stops a soft delete. → not paranoid; `ended` is the end of life (G-F3).
4. **`calibration_records` cannot get a back-filled snapshot**: 0057 makes every column added later immutable. → people shown through existing snapshots or a redacting projection (G-F5).
5. **33 routers mount `auth` with `router.use`, where `req.route` is unset**, so the marker cannot be checked in `auth` by route; and pattern matching alone would let a shadowing route (`/stats` before `/:id`) through. → the gate runs from the context middleware over an ordered route index built by the guards' walker, with a parity test (§ 7.7).
6. **The append-only triggers and the move**: the move needs a narrow exception (one column, one in-progress move row, the 0089-style transaction-local setting).
7. **`warehouses` has no kind column**, so ADR-124's room CHECK cannot be written yet (G-F4).
8. A-365 (in flight) already fixed F-2 (`scopeDrift`) and F-4 (`refuseBulkTenantReassign`) and is fixing F-1 (signed-link TTL/binding); the spec builds the facility parts on top.
9. `docs/UPSTREAM/05` § 3.1 step 1 had already been corrected by another agent; only § 4 (`id_map`) was amended here.

## Decisions (ADR-124 Amendment 2; alternatives and bad implications in `MEMORY/DECISIONS.md`)

Self-facility defaults for unbound creates · children follow a moved device (`client_facility_moves`, `callibrator.facility_move`, `ON UPDATE CASCADE` along one path, 0057's function replaced, two audit rows; refused while an IPM draft is open or a certificate unsigned) · facilities not paranoid, `ended` terminal-with-reinstate, hard delete only when unreferenced; `inactive`/`ended` semantics · one self facility per tenant (PLATFORM included) by an audited service call in every creation path, guard + live test · `audit_logs.client_facility_id` no FK, no back-fill · binding by one operation (unbound admin, never self, never to the self facility, unbind names the role, sessions revoked, one audit row per facility, DB guard + bound-role trigger), JIT/SCIM `facility_binding_pending`, `FACILITY_BINDING_ENABLED` switch for the pre-invitation gate · `…Display` people fields with cross-facility redaction · route gate from `tenantContextMiddleware` over an ordered route index · storage keys with the facility segment, legacy keys valid for the self facility, `rekey_pending` + re-key job; signed-link token v3 · per-facility serial and `UNIQUE (tenant_id, id)` in P20-07 · seven migrations, one transaction per large table; **Recreate deploy for this release**.

**AM-n adopted:** AM-1, 2, 3, 4, 5, 6, 7, 9, 12, 13, 14, 15 (mechanism; owner confirms OQ-3), 17, 18, 19, 20, 21, 22 (facility part); identifiers fixed for AM-8/AM-11 (P18-03); constraints/schema fixed for AM-27/AM-28 (built by P24); left to their cards: AM-10 (P21-09 hardening), AM-16, AM-23 – AM-26 (P19-08 / P21-03 / P22-10), AM-29 (P21-01). **Threat-model OQs answered:** OQ-1 (yes), OQ-5, OQ-12 — `docs/SECURITY/15` § 13 (owned and being edited by another agent) should record them; not edited here.

## Owner question added

**UD-18 (b)** — what a client facility receives when it leaves the provider and how long its records are kept after `ended` (recommended: browser-rendered handover before ending; nothing deleted by ending; retention per contract via the data-retention policy; bound accounts deactivated after 30 days). Added to Phase 12 § 3 (UD-18 row) and BACKLOG Q-57·UD-18; blocks nothing in Phases 20 – 22. Open decision count unchanged (a sub-question, as P18-03 did with UD-4).

## `docs/` amended (deviation protocol; target, referencing ADR-124 Am. 2)

`docs/DATABASE/00-DATA-MODEL.md` (ADR-124 bullet) · `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` (facility section) · `docs/UPSTREAM/04-SCHEMA-MAPPING.md` § 4.2 (`id_client` → `client_facility_id`), § 4.6 (key with the facility segment) · `docs/UPSTREAM/05-DATA-MIGRATION.md` § 4 (`id_map.client_facility_id`, quarantine `facility_mapping_ambiguous`) · `MEMORY/DECISIONS.md` (ADR-124 header + Amendment 2) · `TASKS/PHASE-12-…` § 3 UD-18 · `TASKS/BACKLOG.md` Q-57·UD-18.

## Boards

P19-04 **DONE**. Unblocked to **TODO**: **P20-07** (its only dependency). P21-09 stays BLOCKED on P20-07 (spec pointer added); P20-02's row notes that `UNIQUE (tenant_id, id)` and the per-facility serial land in P20-07. Totals: **18 DONE · 7 TODO · 1 WIP · 70 BLOCKED** of 96 (Phase 12 index, `TASKS/PROGRESS.md`, re-read before editing — P18-01/P18-02 had become TODO meanwhile).

## Not done / not verified

- Nothing was built or run; every test in spec § 17 is a target name. In particular **"RI cascade actions run as the referencing table's owner and fire the child triggers"** is the design's expectation, to be **proven** by `deviceMove.p2007.live.test.ts` before P20-07 is DONE.
- Back-fill timings are not measured; P20-09 measures them on production-shaped data.
- The parity of the ordered route index with Express 5's dispatch is a requirement proved by `facilityRouteIndex.parity.test.ts`, not yet shown.
