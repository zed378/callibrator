# MEMORY/ — Change Record and Decision Log

`TASKS/` is what will be done. `MEMORY/` is what **was** done, and why it ended up that way.

This folder exists because `docs/` describes the intended system and the code describes the current system — but neither explains how one became the other. Six months from now, the question "why did approving a certificate return a 500, and why is there a `submit` step that looks redundant?" is answerable from here and nowhere else. The code shows the behaviour; only the record shows what it cost to decide.

Agents and contributors working on this repository do not retain memory between sessions. `MEMORY/` is the only mechanism for continuity, which is why writing to it is part of a task rather than a summary appended afterwards.

---

## Structure

| Path | Purpose |
|---|---|
| [`MEMORY-INDEX.md`](./MEMORY-INDEX.md) | One line per record, newest first. The entry point. |
| [`CHANGELOG.md`](./CHANGELOG.md) | Chronological summary, coarser than the records. |
| [`DECISIONS.md`](./DECISIONS.md) | 37 ADRs — every choice `docs/` left open, and every deviation from it. |
| [`records/`](./records/) | One file per completed task: what changed, why, and what to watch. |
| [`specs/`](./specs/) | Feature specs for tasks marked `Spec required`, written **before** implementation. |
| [`templates/`](./templates/) | The change-record, phase-summary and feature-spec templates. |

**Where the current status lives:** [`../TASKS/PROGRESS.md`](../TASKS/PROGRESS.md), not here. This folder is history; the board is state. A snapshot in two places drifts, and then neither can be trusted.

## Read `DECISIONS.md` Part II First

`DECISIONS.md` has two halves.

**Part I (ADR-001 to ADR-028)** was written before the system was built. Several of those ADRs describe a system that was then built differently — TypeScript, Kubernetes-first, RLS-based isolation, OIDC-only authentication.

**Part II (ADR-029 to ADR-037)** records what actually happened, and says which earlier ADR each one supersedes.

The earlier ADRs are **left in place rather than edited**. An ADR is a record of what was decided at a moment; rewriting it destroys the evidence that the decision changed, which is the one thing a future reader needs.

## What Gets a Record

**Every task that reaches `DONE`.** That is global Definition of Done item 10 in [`../TASKS/00-TASK-CONVENTIONS.md`](../TASKS/00-TASK-CONVENTIONS.md), and it is not negotiable — a task without a record is not done, however finished the code looks.

Also recorded:

- **Any deviation from `docs/`** — as an ADR, per the deviation protocol. A documented deviation is a decision; an undocumented one is a bug nobody has found yet.
- **Any decision `docs/` deliberately left open** — the storage driver, the fail-open/fail-closed choices, retention windows, whether a control is a constraint or a convention.
- **Phase completions** — what shipped, what deviated, what was deferred, what to watch.
- **Security-relevant outcomes** — the IDOR sweep result, a pentest, a load test, a restore drill. These are the evidence [`../docs/PLAN/17-ACCEPTANCE-CRITERIA.md`](../docs/PLAN/17-ACCEPTANCE-CRITERIA.md) is built on, and **an assertion that a test passed is not evidence**.
- **Operational events with lasting consequence** — a production incident, a rollback, a key rotation.

## What Does Not Get a Record

- Work in progress. Records describe completed changes.
- Anything the git history already tells you accurately. A record explains **why**, not what changed on which line.
- Restating a `docs/` document. Link to it instead.

## Writing a Record

1. Copy [`templates/CHANGE-RECORD-TEMPLATE.md`](./templates/CHANGE-RECORD-TEMPLATE.md).
2. Name it `records/YYYY-MM-DD-<task-id>-<slug>.md`.
3. Fill in **every** section. "Not applicable" is a valid answer; a blank section is not — each section exists because it has been the missing piece in someone's later investigation.
4. Add a one-line pointer to [`MEMORY-INDEX.md`](./MEMORY-INDEX.md) at the top of the list.
5. Add a [`CHANGELOG.md`](./CHANGELOG.md) entry if the change is user-visible or operationally significant.
6. Add an ADR to [`DECISIONS.md`](./DECISIONS.md) if a decision was made or a `docs/` document deviated from.
7. Commit all of it **with the code**, not afterwards. A record written a week later is a reconstruction, and reconstructions quietly omit the parts that were confusing at the time — which are exactly the parts worth having.

## Writing an ADR

Use the format at the top of `DECISIONS.md`. The two sections easiest to skip are the two that matter:

- **Alternatives considered** — the value of an ADR is that a future reader can tell whether their new idea was already evaluated and rejected, or genuinely never considered.
- **Implications, including the bad ones.** An ADR listing only benefits is marketing, and it will not be trusted when someone needs to decide whether to revisit the choice.

## Honesty Rules

These matter more here than anywhere else in the repository, because a record is only worth reading if it can be trusted.

- **Record what happened, not what was supposed to happen.** If a test was skipped, say so. If a Definition of Done item was waived, say which one and **who agreed**.
- **Record failures.** A load test that missed its target, an approach abandoned after two days, a migration rolled back, a control that did not fire — these are the highest-value records here, because they stop the same ground being covered twice.
- **Never claim a security test passed without naming it.** A record that says "IDOR tested, all good" and names no test is **worse than one that says nothing**, because it stops anyone looking again.
- **Do not retroactively edit a record to look better.** Add a follow-up record instead. The point of an append-oriented log is that it can be trusted — the same reason `audit_logs` has no delete path at the database level.
- **Record open questions found during the work**, and add them to [`../TASKS/BACKLOG.md`](../TASKS/BACKLOG.md) so they have a consequence rather than only a mention.
- **Distinguish "renders" from "works".** The Helm charts render; they are not known to be accepted by a cluster. The E2E suite has been verified fix by fix; it has never passed in one uninterrupted run. Both distinctions belong in a record, not rounded up.

## Relationship to Other Folders

| Folder | Direction | Nature |
|---|---|---|
| `docs/` | Reference | What the system **is**, grounded in the code. Amended only through the deviation protocol. |
| `TASKS/` | Forward | What will be built, in what order, and how it will be judged done. |
| `MEMORY/` | Backward | What was built, what it cost, and what to watch. |

A `docs/` document changing is itself an event worth a record — it means reality taught the specification something.

## A Note on This Project's History

The single largest recorded lesson here is **PR-4, the stale-specification trap**, and it was realised rather than avoided:

`CLAUDE.md` instructed engineers and agents to write strict TypeScript with no `any`, for a backend that is JavaScript. `TASKS/README.md` listed foundation tasks as TODO for work that had shipped months earlier. `MEMORY/DECISIONS.md` described Kubernetes-first deployment and RLS-based isolation, both since changed.

An instruction document that disagrees with the code produces confidently wrong work, **and the confidence is the dangerous part**.

That is why `docs/` is now as-built and names its source files, why Part II of `DECISIONS.md` exists, and why the deviation protocol makes a `docs/` change an event with a record rather than an edit nobody notices.
