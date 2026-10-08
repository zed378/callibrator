# Phase 40 — Mobile Distribution, Field UAT and First Release · Group Exit

> Part of the **mobile group, Phases 35 … 40 (one plan)** ([Phase 35](./PHASE-35-SHARED-PACKAGES.md)).
> Specs: [`docs/MOBILE/07`](../docs/MOBILE/07-SECURITY-AND-PRIVACY.md), [`08`](../docs/MOBILE/08-DISTRIBUTION-AND-RELEASES.md),
> [`09`](../docs/MOBILE/09-TESTING.md).
>
> ← [Phase 39](./PHASE-39-MOBILE-ROLES-TABLET-NATIVE.md) · next on the roadmap: [Phase 999](./PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 8 cards: 8 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | the app is distributed internally to real users, proved in the field, released, and the group exits |
| **Depends on** | Phases 38 and 39 DONE; Q-M1 … Q-M4 answered |
| **Size** | L |
| **Cards** | 8: P40-01 … P40-08 |
| **Definition of Done** | as Phase 37, plus `docs/MOBILE/08` § 8 in full for every release card |

## Cards

### P40-01 — Store accounts, internal channels and MDM runbook

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | Q-M1, Q-M3 answered; owner actions of `08` § 2.3 done |
| **Spec refs** | `docs/MOBILE/08` §§ 2, 7 · `docs/MOBILE/07` § 8 |
| **Spec required** | no |

**Definition of Done**
- [ ] Managed Google Play private app and TestFlight / Apple Business Manager channels set up; the Android fallback per Q-M3
- [ ] The MDM runbook (managed configuration incl. the org code, battery exemption, sync before wipe)

### P40-02 — OTA policy and code signing

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P40-01 |
| **Spec refs** | `docs/MOBILE/08` §§ 3–4 · `docs/MOBILE/07` § 6 |
| **Spec required** | no |

**Definition of Done**
- [ ] EAS Update channels with code signing; updates applied at cold start only, never during sync; rollback rehearsed and recorded

### P40-03 — Crash and error reporting (after the DPIA)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | the sub-processor approved in the DPIA (owner, legal) |
| **Spec refs** | `docs/MOBILE/01` § 5 · `docs/MOBILE/07` § 9 |
| **Spec required** | no |

**Definition of Done**
- [ ] Reporter scrubbing proved: no body, token, tenant value, free text or photo in a report (a test inspects a captured event)

### P40-04 — Privacy labels, DPIA addendum, store metadata

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P40-01 |
| **Spec refs** | `docs/MOBILE/07` § 9 · `docs/UPSTREAM/06-DPIA.md` |
| **Spec required** | no |

**Definition of Done**
- [ ] App Store privacy label and Play Data safety from `07` § 9; metadata in Indonesian and English; the DPIA addendum's legal status named (owner)

### P40-05 — Security review and penetration test of the app and its backend surface

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-10, Phases 38–36 |
| **Spec refs** | `docs/MOBILE/07` · `docs/SECURITY/11-SECURITY-TESTING.md` |
| **Spec required** | no |

**Definition of Done**
- [ ] Data-at-rest inspection on a rooted test device; token reuse, SSO return hijack, push content, version floor, tenant-hint cross-tenant attempts — each finding fixed or recorded with an owner

### P40-06 — Field UAT with technicians, facility staff and managers

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P40-02, P40-05 |
| **Spec refs** | `TASKS/PHASE-26-UPSTREAM-UAT.md` (the method) · `docs/MOBILE/09` § 5 |
| **Spec required** | **yes** — the UAT plan: participants, facilities, scripts, success criteria, how findings are triaged |

**Definition of Done**
- [ ] UAT run with real users in at least one provider tenant and one facility, findings triaged; the full real-device script as a named run

### P40-07 — First production release

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P40-01 … P40-06 |
| **Spec refs** | `docs/MOBILE/08` § 8 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every step of the release procedure; staged rollout; `minimumSupported` and `recommended` set; the contract snapshot committed (P36-07)
- [ ] `MEMORY/records/<date>-mobile-<version>.md`, CHANGELOG, `PROGRESS.md`

### P40-08 — Group exit (Phases 35 … 40)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P40-07 |
| **Spec refs** | Phase 35 § 2 · `docs/PLAN/16` § Definition of Phase Complete · ADR-134 · ADR-135 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every card of Phases 35 … 40 DONE with its record; `docs/SHARED/` and `docs/MOBILE/` as built; ADR-134/135 marked as built with any amendments
- [ ] `CLAUDE.md` stack table updated (mobile app, packages); the Go variant of the backend for mobile (after Phase 999) entry check unblocked when Phase 999 exits
- [ ] Group summary in `MEMORY/`

**Abuse cases**
- Closing the group with the field UAT findings untriaged
