# P29-04: the as-built reference for the upstream-adoption modules

**Date:** 2026-10-23 · **Card:** P29-04 · **Status:** DONE in code (docs only) · **Spec refs:** `docs/BACKEND/00-BACKEND-STANDARDS.md`, `docs/BACKEND/10-MODULE-REFERENCE.md`, the deviation protocol

## Hook

`docs/BACKEND/10-MODULE-REFERENCE.md` indexes **35 modules** and has no entry for any of the eleven
the upstream adoption built — the catalogue, the register extensions, IPM sessions, the report, client
facilities, the public page, invitations, the field app's backend, and the ETL. The largest body of
work in the repository was, in the as-built reference, invisible. P29-04 was marked BLOCKED on
**Phase 21 and Phase 22**, both DONE, so the block was stale; the gap it was waiting on was real.

## What was built

| | |
|---|---|
| [`docs/BACKEND/13-UPSTREAM-MODULES.md`](../../docs/BACKEND/13-UPSTREAM-MODULES.md) (new) | Eleven modules as built (§ 2 … § 10), each with its routes, models, migrations, services, the controls that hold it, and what is open; a named-controls table (§ 11) and a "what is not done" section (§ 12) |

The eleven: the inspection catalogue, the device register, IPM sessions, the IPM report and
signatures, client facilities and facility-bound users, the public device page, invitations for
imported users, the offline field app's backend, and the two upstream imports with the transform.

## Why

The card says "as-built `docs/` (English) for the new modules, **with their ADRs**". `10` is the
module reference and is the natural home, but it is a 4,500-line document whose numbering (1 … 35) is
referenced elsewhere; renumbering it would have broken links to prove a point. A companion document,
`13`, keeps the numbering and gives the adoption its chapter. Every claim carries a file: the route
modules, the model names, the migration numbers and the ADR numbers were read from the tree
(`dir backend/src/routes/api`, `backend/src/config/migrator.ts`, `MEMORY/DECISIONS.md`) rather than
recalled.

## Alternatives considered

- **Appending eleven modules to `10` and renumbering.** Rejected: `10`'s numbers are cited by other
  documents, and the risk of a wrong cross-reference is worse than a second file. `13` cross-links to
  `10` and `10` will point back once its owner adds the row.
- **Documenting from the phase files.** Rejected: the phase files are **plans** with status notes; a
  reference built from them would repeat the mistake `CLAUDE.md` made once, describing the intended
  system. Everything here was read from the code.
- **Covering the frontend screens too.** Rejected: `docs/FRONTEND/` and the P29-01 guide cover them;
  this document is the backend map and says so.

## What surprised me

Writing it found one thing that is not a documentation problem. § 12 has to say plainly that **the
facility-scope security gate is not green** — `docs/SECURITY/15` § 11 still has open rows (G-22,
G-26 … G-30) and the live twins — and that P17-07 (the pre-go/no-go review) is blocked on them. The
adoption surface is built and tested, but its security review is not closed, and a reference document
that listed the modules without that sentence would read as a finished system. The honest state is
the point of the document, not a footnote to it.

A smaller one: the transform's role is a **third** database role (`callibrator_transform`) beside the
app and the import roles, and its grants are per-column and per-step (migrations 0134 … 0141, 0145).
That is eleven migrations of grants to document, and it is the reason `stagedTable`'s allow-list and
the `upstreamImportGrants.p2401.live` proof matter more than they look.

## Tests

Docs only; nothing to run. What replaces a test is traceability:

- every route module named exists (`backend/src/routes/api/`: `deviceTypes`, `ipm`, `ipmSessions`,
  `ipmReports`, `calibrationDevices`, `clientFacilities`, `publicDevices`, `field`,
  `upstreamFileImports`);
- every model named exists (`backend/src/models/`: `inspectionSession`, `inspectionResult`,
  `inspectionSessionSignature`, `inspectionTemplate*`, `clientFacility`, `clientFacilityMove`,
  `publicDeviceToken`, `userInvitation`, `idempotencyKey`, `upstreamFileImport`, `upstreamSqlImport`);
- every migration number named exists (`backend/src/config/migrator.ts`: 0113 … 0145);
- every ADR number named exists with the title quoted (`MEMORY/DECISIONS.md`: ADR-124 … ADR-139);
- the "what is not done" section names the cards that carry each gap (P24-05, P25, P26, P27-02,
  P17-07) and the owner actions (OA-4, OA-5).

- **Not run:** nothing. No code, route, migration or test changed.

## Definition of Done

- [x] the new modules have an as-built reference in English, naming their ADRs
- [x] every claim carries a file, a table or an ADR number — nothing recalled
- [x] what is **not** done is stated (§ 12), with the card that carries each gap
- [x] the document says it is a map, not a second source of truth
- [x] no real upstream value in the file

## Files

- `docs/BACKEND/13-UPSTREAM-MODULES.md` (new)
- `TASKS/PHASE-29-UPSTREAM-TRAINING-DOCS.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`,
  `MEMORY/CHANGELOG.md`, this record
