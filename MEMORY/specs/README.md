# MEMORY/specs/

Feature specs, written **before** implementation, for tasks marked `Spec required` in [`../../TASKS/`](../../TASKS/README.md).

Template: [`../templates/FEATURE-SPEC-TEMPLATE.md`](../templates/FEATURE-SPEC-TEMPLATE.md).
Naming: `<task-id>-<slug>.md`.

---

## Why a Spec Before Code

To surface the decisions and the traps **while they are still cheap**.

Reading `docs/` carefully before writing anything has repeatedly found contradictions that would otherwise have become defects. The certificate approval path is the clearest example: `docs/` described `draft → approved`, the model had no way to get there, and approving a draft threw a plain `Error` that surfaced as a 500. Approval was **unreachable in practice**, and the 500 hid it.

A spec that asks "what are the exact transitions, and what happens on an illegal one?" finds that in twenty minutes. Finding it in the code costs an afternoon and a live-audit defect entry.

## When a Spec Is Required

| Required | Not required |
|---|---|
| New domain tables or a schema change | a bug fix within an existing shape |
| A new API surface | adding a field to an existing endpoint |
| Anything touching **tenant isolation** | a UI-only change |
| Anything touching **evidence** — calibration records, certificates, signatures, audit | a dependency bump |
| A new fail-open/fail-closed choice | |
| A new outbound destination a tenant can supply | |
| A new role or menu group | |

The rule of thumb: **if getting it wrong would need a migration or an ADR to undo, write the spec.**

## The Two Sections That Earn the Spec

**"What `docs/` already decides."** Half the value is discovering that the decision has already been made and you were about to make a different one. The other half is discovering that `docs/` is silent, contradictory, or wrong — which is a specification gap, and it belongs in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) and probably in an ADR **before** any code is written.

**"Traps to avoid."** The template carries the known ones, and they recur because they are structural rather than careless:

| Trap | Consequence |
|---|---|
| An optional include without `required: false` | INNER JOIN, and the list silently returns **nothing** |
| `schema.validate` passed to Express | **500 on every request** to that route |
| A path parameter the validator never sees | **400 on every request** |
| `db` destructured from the models barrel | `undefined`, then a throw at `transaction()` |
| A role without a `ROLE_LEVELS` entry | fails every privileged gate, **silently** |
| A migration with a blanket `try/catch` | **recorded as applied while doing nothing** |
| A global uniqueness constraint | a cross-tenant existence oracle |

Each of these has happened here. Checking the list costs a minute.

## A Spec Is Not a Design Document

It is not a place to invent architecture. Every task points back to the `docs/` document that already decided the design.

**If a task would need a decision `docs/` does not contain, it is not a task** — it is an entry in `BACKLOG.md` under "Open Questions", to be raised with the project owner.

## After Implementation

The spec **stays as written**. It is a record of what was intended, and comparing it against what shipped is exactly the value.

What actually happened goes in a **change record** ([`../records/`](../records/)), which has its own "What surprised me" section for the gap between the two.

Do not retroactively edit a spec to match the implementation. That destroys the only evidence of what was learned.

## Current State

Empty. The system was built before this convention existed — which is itself the story recorded in [`../README.md`](../README.md) under the stale-specification trap, and the reason this folder exists now.

The first spec written here will be for the first `Spec required` task in [`../../TASKS/PROGRESS.md`](../../TASKS/PROGRESS.md).
