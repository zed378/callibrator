# Phase 18 — Upstream: Role & Permission Mapping

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 17 — Security, Privacy & Data Protection](./PHASE-17-UPSTREAM-SECURITY-PRIVACY.md) · [Phase 19 — Domain Design](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) →

| | |
|---|---|
| **Status** | **DONE 2026-10-08 — 4 DONE** (P18-03 2026-10-07; P18-01, P18-02, P18-04 2026-10-08 — [record](../MEMORY/records/2026-10-08-phase12-18-29-docs.md)) |
| **Goal** | 4 groups + IPSRS → our roles, slugs, facility-bound users, two-tenant and two-facility test plan |
| **Depends on** | Phase 12 |
| **Size** | S |
| **Cards** | 4: P18-01 … P18-04 |
| **Was** | UP-06 (cards UP-06-01 … UP-06-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) and the DoD below |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** every upstream actor has a role, a tenant and gates. **Spec refs:** 01 § Role Mapping ·
04 § 6 · 00 § 4 · `backend/src/constants/roleConstants.ts` · ADR-064 · UD-1, UD-4. **Size:** S.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P18-01 | Role matrix: `admin`/`user` → provider tenant `CALIBRATOR ADMIN`/`TECHNICIAN` (unbound); `client`/`teknisi_client` → **facility-bound** users of the provider tenant with a facility-side role (ADR-124 § 4); IPSRS → `FACILITY MAINTENANCE` (bound) | **DONE 2026-10-08** — spec [`P18-01-02-role-matrix-and-grants.md`](../MEMORY/specs/P18-01-02-role-matrix-and-grants.md) § 2: the final matrix under the UD-4 working decisions and the **deterministic assignment rules** (the facility's `HEALTHCARE ADMIN` = its earliest active `client` account, ties by lowest upstream id; ambiguous mappings quarantined; inactive accounts imported inactive, never invited; facilities with no account get none); `docs/UPSTREAM/01-MODULES.md` § Role Mapping amended (deviation protocol) | UD-4 (working decision) |
| P18-02 | Slugs and grants spec: `ipm`, `ipm-templates` (+ `seededMenuSlugs`), reports; no new role unless needed — if one is, its `ROLE_LEVELS` entry | **DONE 2026-10-08** — spec [`P18-01-02-role-matrix-and-grants.md`](../MEMORY/specs/P18-01-02-role-matrix-and-grants.md) § 3 – § 5: three slugs, the final explicit grants **with UD-4 (b)** (working decision 2026-10-08, **ships**: `calibration` write for `TECHNICIAN` and `HEALTHCARE TECHNICIAN`), the measured effect on existing tenants (§ 3.2) that P20-06's record must carry, calibration-record **void narrowed to `rbac([TENANT_ADMIN])`** in the same release (§ 4.3), no `reports` slug (§ 3.3), no new role, the migration's content and tests | P18-01 |
| P18-03 | Facility scope ↔ permissions (ADR-124 § 5, § 7): the facility-accessible route list, the `FACILITY_READABLE` model list, the bound role set, which menus a bound user may hold | **DONE 2026-10-07** — spec [`P18-03-facility-scope-permissions.md`](../MEMORY/specs/P18-03-facility-scope-permissions.md), **ADR-124 Amendment 1** (bound menu ceiling in the effective permission; the marker as one reviewed list and its refusal rule; `FACILITY_READABLE`; bound HA read-only); UD-4 (b)/(c) added to Phase 12 § 3 ([record](../MEMORY/records/2026-10-07-p18-03-role-mapping.md)) | P12-02 |
| P18-04 | Two-tenant **and two-facility** test plan: every new `:id` route and every cross-facility case listed with its expected 404 | **DONE 2026-10-08** — plan [`P18-04-two-tenant-two-facility-test-plan.md`](../MEMORY/specs/P18-04-two-tenant-two-facility-test-plan.md): 16 new `:id` routes with their two-tenant 404 or allow-list kind, 23 existing and 15 target facility-accessible cases with the expected answer (404 identical to missing, absent from lists, forced facility, 403 route/self) and the test file that proves each, the unmarked escalation routes, the non-route gate rows, the two route guards' exemptions; provisional paths (‡) updated by P19-02/03/05/06/07 in the same change. **Gap closed:** the QR lookup route was missing from P18-03 § 8.3 — added as N-13 | P18-03 |

**DoD:** matrix in 01 updated through the deviation protocol (done 2026-10-07 for the scope; **2026-10-08 for the roles**); test plan reviewed before Phase 21 starts (P21-09's first step).
