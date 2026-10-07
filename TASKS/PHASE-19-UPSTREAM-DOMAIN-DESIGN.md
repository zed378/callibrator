# Phase 19 — Upstream: Domain Design

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 18 — Role & Permission Mapping](./PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md) · [Phase 20 — DB-Structure Migration to Our Conventions](./PHASE-20-UPSTREAM-DB-MIGRATION.md) →

| | |
|---|---|
| **Status** | 2 DONE (P19-01, P19-04) · 6 BLOCKED on open decisions |
| **Goal** | Specs for catalogue, IPM aggregate, device extensions, client facilities + facility scope, calibration dates, IPM report, public page |
| **Depends on** | Phase 12, Phase 18 |
| **Size** | L |
| **Cards** | 8: P19-01 … P19-08 |
| **Was** | UP-07 (cards UP-07-01 … UP-07-08) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) and the DoD below |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** a reviewed spec per aggregate before any migration. **Spec refs:** 02 F-17…F-79 · 04 § 3–8
· 03 § 4.6 · 00 § 11 · ADR-107 (snapshots) · certificate pipeline docs. **Size:** L. All cards *spec required*.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P19-01 | Catalogue spec per ADR-125: `device_types`, `inspection_item_definitions`, `inspection_templates` / `_versions` / `_items` (replacing 04's `device_type_inspection_items`), proposals; typed items (tri-state, measured-with-limit, setting/measured/reference); limit parsing | **DONE 2026-10-07** — spec [`MEMORY/specs/P19-01-inspection-catalogue.md`](../MEMORY/specs/P19-01-inspection-catalogue.md); ADR-125 Amendment 1 (outcome sets per section — corrects `04` § 5 for physical and consumable; structured limits + hard/soft ranges; no soft delete; `discarded` drafts; base rebase; read gate `calibration`); `docs/UPSTREAM/02, 04, 05, 07`, `DATABASE/00` amended as target; unblocks P20-01, P20-03; [record](../MEMORY/records/2026-10-07-p19-01-domain-spec.md) | P12-03 |
| P19-02 | IPM aggregate spec: `inspection_sessions` / `inspection_results`, states, corrections/supersede, void, visit number computed at submit, "due" flag, work-order link (UD-12), side effects (UD-17) | BLOCKED | P12-04, UD-12, UD-17 |
| P19-03 | Device extensions spec: `qr_code` normalisation + per-tenant uniqueness, `device_type_id`, `inventoried_on`, `calibration_vendor_id`, `accessories_complete`, condition vocabulary, photos as attachments (`device-photos`), serial duplicates | BLOCKED | UD-9, UD-10 |
| P19-04 | **Client-facility spec** (ADR-124; was "access-grant spec"): `client_facilities` and its lifecycle, `client_facility_id` on the evidence chain and the backfill to each tenant's self facility, the second dimension in `tenantScope.util`, `FACILITY_READABLE`, the route marker, raw-SQL helper, socket rooms, cache keys, the A-90 sweep with performer snapshots, two-facility suite and guards | **DONE 2026-10-07** — spec [`MEMORY/specs/P19-04-client-facilities.md`](../MEMORY/specs/P19-04-client-facilities.md); **ADR-124 Amendment 2** (unbound creates default to the self facility; a moved device's children follow it — OQ-5/OQ-12; facilities not soft-deleted, `ended` the end of life; one binding operation revoking sessions — OQ-1; people shown by snapshot or a redacting projection; the route gate over an ordered route index; seven migrations, Recreate deploy); UD-18 (b) put to the owner; `docs/` amended: DATABASE/00, SECURITY/05, UPSTREAM/04, 05; unblocks **P20-07**; [record](../MEMORY/records/2026-10-07-p19-04-client-facilities-spec.md) | P12-02, P18-03 |
| P19-05 | Calibration-date spec: quick external calibration record by QR, history kept, import actor (per-tenant import API key, 04 § 4.7) | BLOCKED | UD-8 |
| P19-06 | IPM report spec: a **frontend renderer** fed by a hashed data document (ADR-126 § 8, ADR-095 §4 — **no stored PDF**), numbering, QR to `/verify`, e-signature and countersign | BLOCKED | P19-02, UD-17 |
| P19-07 | Public device page spec (capability token) and legacy resolver | BLOCKED | P12-06, UD-16 |
| P19-08 | Offline capture spec (UD-14): service worker scope under the nonce CSP, IndexedDB queue, idempotency keys, photo queue, conflict 409, catalogue ETag download (F-79) | BLOCKED | P28-02, P19-02 |

**DoD:** each spec names its tables, routes, contracts, gates, audit events and two-tenant tests;
`docs/` amendments drafted with their ADR. **Abuse case:** copying the 16-table upstream shape
because "the ETL is simpler".
