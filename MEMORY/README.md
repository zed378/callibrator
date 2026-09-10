# Memory

Decisions, architectural records, implementation notes, and project memory.

## Structure

- **DECISIONS.md** — Architectural Decision Records (ADRs) with rationale
- **records/** — Completed task records with what was built and why
- **PROGRESS.md** — Phase tracking and completion status
- **BLOCKERS.md** — Known issues and technical debts

## Key Decision Records (ADRs)

See `DECISIONS.md` for the complete list. Each ADR includes:
- What was decided
- Why that choice was made
- What was considered but rejected
- Trade-offs and implications

## Task Records

Each completed task in `records/` captures:
- What was implemented
- Why it was done that way
- Key decisions made during implementation
- Technical notes for future maintenance

## Phase Progress

Track completion status across all phases in `PROGRESS.md`:
- Phase 1: Foundation (Current)
- Phase 2: Warehouse & Inventory
- Phase 3: Calibration
- Phase 4: Enterprise SSO
- Phase 5: Analytics & Data Lake

## Maintenance Notes

Future maintainers should review `DECISIONS.md` before proposing architectural changes. Each decision has context explaining rejected alternatives.
