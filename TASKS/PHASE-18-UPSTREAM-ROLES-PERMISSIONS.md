# Phase 18 — Upstream: Role & Permission Mapping

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 17 — Security, Privacy & Data Protection](./PHASE-17-UPSTREAM-SECURITY-PRIVACY.md) · [Phase 19 — Domain Design](./PHASE-19-UPSTREAM-DOMAIN-DESIGN.md) →

| | |
|---|---|
| **Status** | 1 DONE (P18-03, 2026-10-07) · 3 TODO (P18-01, P18-02 — unblocked 2026-10-07 by the UD-4 working decisions, Phase 12 § 3; P18-04) |
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
| P18-01 | Role matrix: `admin`/`user` → provider tenant `CALIBRATOR ADMIN`/`TECHNICIAN` (unbound); `client`/`teknisi_client` → **facility-bound** users of the provider tenant with a facility-side role (ADR-124 § 4); IPSRS → `FACILITY MAINTENANCE` (bound) | TODO — unblocked 2026-10-07: UD-4 (a) taken as a **working decision** (Phase 12 § 3; owner may revise); the matrix is drafted in the P18-03 spec § 4.2 | UD-4 (working decision) |
| P18-02 | Slugs and grants spec: `ipm`, `ipm-templates` (+ `seededMenuSlugs`), reports; no new role unless needed — if one is, its `ROLE_LEVELS` entry | TODO — unblocked 2026-10-07: UD-4 (a) and (b) taken as **working decisions** (Phase 12 § 3); drafted in the P18-03 spec § 7: three slugs (`ipm`, `ipm-templates`, `client-facilities`), the explicit grants, the seed/migration plan, **no new role**. UD-4 (b) changes existing tenants' technician grants: **its seed migration does not ship before the owner confirms** | P18-01 |
| P18-03 | Facility scope ↔ permissions (ADR-124 § 5, § 7): the facility-accessible route list, the `FACILITY_READABLE` model list, the bound role set, which menus a bound user may hold | **DONE 2026-10-07** — spec [`P18-03-facility-scope-permissions.md`](../MEMORY/specs/P18-03-facility-scope-permissions.md), **ADR-124 Amendment 1** (bound menu ceiling in the effective permission; the marker as one reviewed list and its refusal rule; `FACILITY_READABLE`; bound HA read-only); UD-4 (b)/(c) added to Phase 12 § 3 ([record](../MEMORY/records/2026-10-07-p18-03-role-mapping.md)) | P12-02 |
| P18-04 | Two-tenant **and two-facility** test plan: every new `:id` route and every cross-facility case listed with its expected 404 | TODO (unblocked 2026-10-07 by P18-03: the `@2f` rows of spec § 8 and the guards of § 15 are its input; the Phase 21 routes' exact paths come from P19-02/03/04 as they land) | P18-03 |

**DoD:** matrix in 01 updated through the deviation protocol (done 2026-10-07 for the scope; the roles wait on UD-4); test plan reviewed before Phase 21 starts.
