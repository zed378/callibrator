# P30-01: the cutover runbook, written before the data exists

**Date:** 2026-10-23 · **Card:** P30-01 (draft) · **Status:** DRAFT — the run is P30-02, which waits on Phase 25 · **Spec refs:** `docs/UPSTREAM/05` § 8 (the checklist it follows), `docs/UPSTREAM/06` (DPIA), `docs/UPSTREAM/07` (minimisation), `docs/UPSTREAM/08` (file policy), ADR-116 (backups), ADR-123 (images), ADR-129 (import/transform), ADR-130 (image import), ADR-139 (invitations)

## Hook

The card is BLOCKED on Phase 25, which needs **real upstream data** the owner's legal decision gates.
But the deliverable is a **document**, and the repository already has the precedent: P29-02's "what
changed" note is `DONE (draft, checked at UAT)` — written ahead of the run so that it can be reviewed
while a review is still cheap. A cutover sequence invented during a freeze window is a cutover
sequence nobody checked. So the runbook is written now, marked DRAFT, and the **run** stays blocked.

## What was built

| | |
|---|---|
| [`TASKS/RUNBOOK-UPSTREAM-CUTOVER.md`](../../TASKS/RUNBOOK-UPSTREAM-CUTOVER.md) (new) | The gate list before T-14 d (legal, pre-invitation, security, reconciliation, UAT, sticker, backups, pinned images); T-14 d / T-7 d / T-1 d / T-0 / T+0 … T+30 d; the T-0 sequence as ten decision points with what proves each; the freeze estimate; the rollback table; and § 11, what the runbook does not yet know |

Every command in it exists: `make backup`, `make migrate-status`, `make migrate-verify`, `make psql`,
`make preflight` — read from the `Makefile`, not recalled. The steps follow `docs/UPSTREAM/05` § 8's
own checklist, so the spec and the runbook cannot drift apart silently.

## Why this shape

The two rules that matter are stated first, because they are the ones a person under pressure gets
wrong:

1. **The upstream is never written to.** Every step reads upstream; the only writes are to Callibrator
   and to the import's own schema.
2. **Rollback is the pre-import backup, not a delete.** Tenant foreign keys are `RESTRICT`
   (migration 0030), so "delete the imported tenants" fails; and after cutover there is no rollback
   for writes made in Callibrator — the fallback is fix-forward with upstream read-only.

The T-0 sequence is written as **decision points** rather than a script, because the transform is one
transaction: a surprise at step 4 rolls back everything it wrote, so stopping is safe up to the
invitations and unsafe after them. Saying where the point of no return is, precisely, is the whole
value of a runbook.

## Alternatives considered

- **Writing it during the dry run, when the timings are known.** Rejected as the *only* option: the
  dry run is exactly when a reviewed sequence is needed. § 7 carries estimates and says so; P24-05
  replaces them with measurements and P30-02 times a rehearsal.
- **A checklist with no commands.** Rejected: "run the migration check" is not runnable at 2 a.m. The
  `make` targets are named.
- **Marking P30-01 DONE.** Rejected: the card's DoD is a runbook that has been **exercised**; only
  P30-02 can say that. DRAFT is the honest status, and the phase file says so.

## What surprised me

Reading `docs/UPSTREAM/05` § 8 against the built system found one step the checklist implies but does
not name: the **import key must be provisioned before the transform runs**, or the calibration step
fails `IMPORT_KEY_MISSING` and the whole run rolls back. That is by design (ADR-133 Am. 4 — a record
is never attributed to a key that was not intended), but a cutover operator meeting it for the first
time at T-0 would read it as a broken import. It is now a T-1 d confirmation (§ 5.4), named as
"by design, not a bug".

A second: the runbook has to say that re-running the transform **after** the invitations are issued
is forbidden — not because the transform is not idempotent (it is, and re-runs write nothing when
nothing changed) but because a changed upstream row after the freeze means **the freeze did not
hold**, which is a different problem wearing the same clothes.

## Tests

Docs only; nothing to run. Traceability:

- every command named is a `Makefile` target (`backup`, `migrate-status`, `migrate-verify`, `psql`,
  `preflight`), read from the file;
- the step order matches `docs/UPSTREAM/05` § 8, item by item;
- the refusal codes named exist in the contracts (`TRANSFORM_INCOMPLETE`, `IMPORT_KEY_MISSING`);
- the migration cited for the RESTRICT keys is 0030, as `docs/UPSTREAM/05` § 8 states;
- § 11 names every fact the runbook lacks, each with its card (P24-05, P30-02) or owner action
  (OA-4, OA-5).

- **Not run:** nothing. No code, route, migration or test changed.

## Definition of Done

- [x] the runbook exists in `TASKS/`, T-14 d … T+30 d, with the rollback stated as the backup
- [x] every command is a real target; every step follows the spec's checklist
- [x] the point of no return is named precisely
- [x] what is unknown is stated, not smoothed over
- [ ] **exercised** — P30-02, blocked on Phase 25. This card does not claim it.
- [x] no real data value in the file

## Files

- `TASKS/RUNBOOK-UPSTREAM-CUTOVER.md` (new)
- `TASKS/PHASE-30-UPSTREAM-CUTOVER.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`,
  `MEMORY/CHANGELOG.md`, this record
