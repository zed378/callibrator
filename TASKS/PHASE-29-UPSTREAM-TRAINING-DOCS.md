# Phase 29 — Upstream: Training & Documentation in Indonesian

> Part of the **upstream PHP feature adoption** group, **Phases 12 … 31** (the SKP IPM app, `docs/UPSTREAM/`).
> The group index is [Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md): owner decisions UD-1 … UD-18 (§ 3), owner actions
> OA-1 … OA-8 (§ 4), the phase list and build order (§ 2), the group-wide Definition of Done (§ 2)
> and the old → new id mapping (§ 7).
>
> ← [Phase 28 — Mobile / Offline Decision](./PHASE-28-UPSTREAM-MOBILE-OFFLINE.md) · [Phase 30 — Cutover & Dual-Run](./PHASE-30-UPSTREAM-CUTOVER.md) →

| | |
|---|---|
| **Status** | 3 DONE (P29-02, 2026-10-08; **P29-01 and P29-04, 2026-10-23**) · 1 BLOCKED (P29-03, videos — owner) |
| **Goal** | User guides, "what changed", as-built docs |
| **Depends on** | Phase 26 |
| **Size** | M |
| **Cards** | 4: P29-01 … P29-04 |
| **Was** | UP-17 (cards UP-17-01 … UP-17-04) in `PHASE-UPSTREAM-PHP-ADOPTION.md`, split into one file per phase on 2026-10-07 (owner instruction) |
| **Definition of Done** | the global DoD in [`00-TASK-CONVENTIONS.md`](./00-TASK-CONVENTIONS.md) **plus the group-wide DoD** in [Phase 12 § 2](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) (every implementation card of Phases 20 … 31 inherits it) |

**Privacy rule (every card):** no real upstream data value (name, e-mail, hash, serial, room,
facility name, free text, file name, credential) enters the repository — in full in
[Phase 12](./PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md).

## Cards

**Spec refs:** 02 F-55, F-56 · UD-6 · docs/ deviation protocol. **Size:** M.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P29-01 | User guides (ID): technician (capture, offline, corrections), facility users (what a facility-bound account sees, reports), provider admin (client facilities, binding users), IPSRS (countersign) | **DONE 2026-10-23** — [`docs/UPSTREAM/13-USER-GUIDES-ID.md`](../docs/UPSTREAM/13-USER-GUIDES-ID.md): four guides, one per audience the card names, written against the **built screens** (every quoted menu name, button and message is a string in `frontend/src/i18n/messages/id.ts`), each ending with what the role cannot do; the document states its own limits (not run with real users — P26-02; no videos — P29-03; four steps depend on settings that are off by default). The block was **stale** — it named Phase 22, which is DONE — [record](../MEMORY/records/2026-10-23-p29-01-user-guides-id.md) | Phase 22 (DONE) |
| P29-02 | "What changed" note (ID): no overwrite — corrections; invitations; new stickers and public page; the app replaces the APK | **DONE 2026-10-08 (draft, checked against the built screens at UAT P26-01)** — [`docs/UPSTREAM/11-WHAT-CHANGED-ID.md`](../docs/UPSTREAM/11-WHAT-CHANGED-ID.md): one account per person by invitation (no old passwords), who sees what, IPM correction instead of overwrite and void by an administrator, several IPMs per month, reports rendered in the browser, new QR stickers and the public page with the UD-15/16 caveats, the PWA replacing the APK with its offline rules, facility off-boarding (UD-18 (b)); working decisions marked ⚠ — [record](../MEMORY/records/2026-10-08-phase12-18-29-docs.md) | P12-04, P28-02 |
| P29-03 | Short videos / train-the-trainer sessions | BLOCKED (owner/recording) | P29-01 (DONE) |
| P29-04 | As-built `docs/` (English) for the new modules, with their ADRs | **DONE 2026-10-23** — [`docs/BACKEND/13-UPSTREAM-MODULES.md`](../docs/BACKEND/13-UPSTREAM-MODULES.md): the eleven adoption modules as built (catalogue, register, IPM sessions, report, client facilities, public page, invitations, the field backend, the two imports and the transform), each with its routes, models, migrations, services and open items, plus a named-controls table and a "what is not done" section. Every claim carries a file, a model or an ADR number read from the tree. The block was **stale** — it named Phase 21 and Phase 22, both DONE — [record](../MEMORY/records/2026-10-23-p29-04-upstream-modules-docs.md) **Reviewed 2026-10-24:** § 10.1 (P25 reconciliation and data quality, ADR-129 Am. 11) added; § 6 corrected (nine routes, not eight) and records F-P1707-01 (ADR-124 Am. 8); CLAUDE.md coverage/live-suite rows corrected from their records — [record](../MEMORY/records/2026-10-24-p29-04-modules-doc-review.md) | Phase 21, Phase 22 (both DONE) |
