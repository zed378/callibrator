# Phase 28 — Upstream: Mobile / Offline Decision

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 27 — QR Sticker Continuity](./PHASE-27-UPSTREAM-QR-CONTINUITY.md) · [Phase 29 — Training & Documentation in Indonesian](./PHASE-29-UPSTREAM-TRAINING-DOCS.md) →

| | |
|---|---|
| **Status** | Decision **DONE** (UD-14); **ADR-127 DONE**; APK retirement BLOCKED — 2 DONE · 1 BLOCKED |
| **Goal** | PWA vs native; APK retirement |
| **Depends on** | Phase 12 |
| **Size** | S (decision) |
| **Cards** | 3: P28-01 … P28-03 |
| **Was** | UP-16 (cards UP-16-01 … UP-16-03) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 00 § 6 · 02 F-77 … F-79 · M14 · UD-14. **Size:** S (decision); the build is P22-10.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P28-01 | Decide PWA vs native | **DONE 2026-10-07 (owner decision UD-14: PWA with offline mode, camera for photos/QR, no native app)** — record: [Phase 12 § 3](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md); ADR in P28-02 | — |
| P28-02 | ADR: PWA field capture, offline queue, sync and conflict rules, CSP and service-worker constraints, browser support floor | **DONE 2026-10-07 — ADR-127** | P28-01 |
| P28-03 | APK retirement: announcement, removal from the public folder, upstream API shut down at cutover | BLOCKED | Phase 30 |
