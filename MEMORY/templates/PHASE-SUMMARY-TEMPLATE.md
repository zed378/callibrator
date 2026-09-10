# Phase <N> — <Name> — Summary

**Completed:** YYYY-MM-DD
**Duration:** <start> → <end>
**Tasks:** <n> completed, <n> deferred

> Save to `MEMORY/records/YYYY-MM-DD-phase-<n>-summary.md`.
>
> A phase is complete only when every task is `DONE`, every `DONE` task has a record, and this summary exists. See `docs/PLAN/16-IMPLEMENTATION-ROADMAP.md`.

---

## What Shipped

*The capability, in a sentence a non-engineer would understand. Then the list.*

| Task | Title | Record |
|---|---|---|

---

## What Deviated From `docs/`

*Every deviation, with its ADR. A documented deviation is a decision; an undocumented one is a bug nobody has found yet.*

| Deviation | ADR | Why |
|---|---|---|

**If this table is empty, check again.** A phase that implemented a specification with no surprises at all is unusual, and an empty table more often means the deviations were not noticed than that there were none.

---

## What Was Deferred

*What did not get done, and what it is waiting on. Each should be in `TASKS/BACKLOG.md`.*

| Item | Waiting on | Backlog entry |
|---|---|---|

---

## What Failed

*Approaches abandoned, tests that did not pass, targets missed, controls that did not fire.*

**This is the highest-value section in the document.** It is what stops the same ground being covered twice. A phase summary with an empty one is a phase summary nobody will trust.

---

## Security Outcomes

*Named tests and their results. **An assertion that a test passed is not evidence.***

| Control | Test | Result |
|---|---|---|
| Tenant isolation | *name the IDOR sweep spec* | |
| Authorization | *name the negative-case suite* | |
| Audit completeness | | |
| Secret exposure | | |

**No multi-tenancy finding may be waived.** If one was found, it was fixed before this phase closed, or this phase is not closed.

---

## Compliance Outcomes

| Requirement | Evidence |
|---|---|
| Append-only records | *constraint, or convention? Say which.* |
| Signature completeness | |
| Audit trail continuity | |
| Retention and legal hold | |

---

## What Was Not Determined

*Things that could not be verified — an environment that was unavailable, a test that could not run, a claim that rests on inference.*

*Examples of the shape: "the Helm charts render; no cluster was reachable, so they are not known to deploy". "The E2E suite was verified fix by fix; it has never passed in one uninterrupted run."*

**Rounding this up is how a status report becomes untrustworthy.**

---

## Definition of Done

- [ ] Every task in the phase file is `DONE`
- [ ] Every `DONE` task has a record in `MEMORY/records/`
- [ ] The global Definition of Done is satisfied for each, or the waiver is recorded with **who agreed**
- [ ] This summary exists
- [ ] Security outcomes are **named**, not asserted
- [ ] `TASKS/PROGRESS.md` reflects reality

---

## What to Watch

*What might break as the next phase builds on this. Fragile assumptions, fail-open defaults, anything currently held together by convention rather than mechanism.*

---

## Metrics

| | |
|---|---|
| Tasks completed | |
| ADRs written | |
| Specification gaps found | |
| Defects found **after** a task was marked done | |
| Coverage at phase close | |

The fourth row is the interesting one: a defect found after `DONE` is a gap in the Definition of Done, not just a bug. Ask what would have caught it.

---

## Next Phase

*What is unblocked now. What is still blocked, and by what.*

Per the phase rule: **never build a Phase N+1 feature while Phase N is incomplete.**
