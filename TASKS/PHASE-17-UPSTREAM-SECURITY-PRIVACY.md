# Phase 17 — Upstream: Security, Privacy & Data Protection

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 16 — Feature Research](./PHASE-16-UPSTREAM-FEATURE-RESEARCH.md) · [Phase 18 — Role & Permission Mapping](./PHASE-18-UPSTREAM-ROLES-PERMISSIONS.md) →

| | |
|---|---|
| **Status** | 3 DONE (pending legal review) / TODO (1: P17-06, unblocked by ADR-124) / BLOCKED (3) — 3 DONE · 1 TODO · 3 BLOCKED |
| **Goal** | DPIA (UU PDP 27/2022, GDPR posture), legal basis, minimisation, file policy, threat model of the new surfaces |
| **Depends on** | Phase 12 |
| **Size** | M |
| **Cards** | 7: P17-01 … P17-07 |
| **Was** | UP-05 (cards UP-05-01 … UP-05-07) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) and the DoD below |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Goal:** nothing leaves the owner's machine, and nothing is built, without a lawful basis, a DPIA
and a threat model. **Spec refs:** 00 § 9 (S-01…S-18) · 03 § 9 · 05 § 10 · docs/SECURITY/05 ·
`docs/SECURITY/` GDPR documents · UD-18. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P17-01 | Upstream hardening advice handed over and its execution confirmed by the owner (OA-1, OA-2, OA-3) | BLOCKED (owner) — advice handed over 2026-10-07 as `docs/UPSTREAM/10-OWNER-CHECKLIST.md` (Indonesian, step by step); DONE when the owner confirms its § 10 | OA-1 … OA-3 |
| P17-02 | DPIA under UU PDP 27/2022 (+ GDPR posture): data inventory from 03 § 9, flows, controller/processor roles, risks, mitigations | **DONE 2026-10-07, pending legal review** (P17-03) — `docs/UPSTREAM/06-DPIA.md`, for the owner-corrected tenancy (tenant = calibration company, faskes = client entity); [record](../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md) | — |
| P17-03 | Legal basis and DPA; facility notification text (ID); residency choice | BLOCKED | UD-18, OA-5 |
| P17-04 | Minimisation list: migrated / archived / destroyed, per table and per file class (05 § 10) | **DONE 2026-10-07, pending legal review** — `docs/UPSTREAM/07-DATA-MINIMISATION.md` (certificate PDFs archive-only per the owner rule; finding F-CERT); [record](../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md) | — |
| P17-05 | File policy: content allow-list, ClamAV, SHA-256, derivatives stripping EXIF, originals only by signed download; an aggregate-only EXIF survey (tag presence counts, no values) | **DONE 2026-10-07, pending legal review** — `docs/UPSTREAM/08-FILE-POLICY.md` (photos only; keys `t/<tenant>/f/<faskes>/…`); the EXIF survey is deferred to the dry run P24-05 (files not opened outside it); [record](../MEMORY/records/2026-10-07-upstream-privacy-and-reports.md) | — |
| P17-06 | Threat model of the new surfaces: the facility dimension and facility-bound users (ADR-124; was "access grants and the active-facility switch"), public capability page, offline queue (ADR-127), import tooling | TODO (unblocked by ADR-124) | P12-02 |
| P17-07 | Security review before go/no-go: penetration test of the facility scope (ADR-124; was "grants"), public page and PWA sync; findings closed | BLOCKED | Phase 21, Phase 22 |

**DoD:** DPIA and threat model written and reviewed; every S-finding mapped to "not ported" or to the
control that replaces it; no real value in any artefact. **Abuse case:** a DPIA that lists the data
classes but never decides what is *not* migrated.
