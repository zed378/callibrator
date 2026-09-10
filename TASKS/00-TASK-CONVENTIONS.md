# 00 — Task Conventions

How to work in this repository. Read before starting any task.

---

## Task IDs

```
P<phase>-<sequence>          P6-01, P7-03, P8-02
```

Phases 0–5 are complete. Current work is P6 and beyond — see [`README.md`](./README.md).

## Statuses

| Status | Meaning |
|---|---|
| `TODO` | not started; dependencies may or may not be met |
| `BLOCKED` | dependencies not met, or waiting on an owner decision |
| `WIP` | in progress, on a branch |
| `REVIEW` | PR open |
| `DONE` | merged **and** its `MEMORY/records/` entry exists |

**`DONE` requires the record.** A task without one is not done, however finished the code looks.

## Anatomy of a Task Card

```markdown
### P6-01 — Restore the backend coverage gate

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | — |
| **Spec refs** | docs/TESTING/01-UNIT-TESTING.md · docs/BACKEND/09-TESTING.md |
| **Spec required** | no |

**Why:** A gate that is currently failing is a gate nobody trusts.

**Definition of Done**
- [ ] `npm run test:coverage` passes at the configured threshold
- [ ] every uncovered branch is either tested or deliberately excluded with a recorded reason

**Abuse cases**
- Coverage restored by lowering the threshold rather than adding tests
```

**Spec refs are mandatory.** A task with none is a task nobody can check.

**Abuse cases** state how the task could be satisfied dishonestly. They exist because most of them have happened somewhere.

## Branches

```
{type}/{task-id}-{kebab-description}

feat/P6-04-route-permission-guard
fix/P6-02-e2e-clean-run
docs/P7-01-ci-pipeline
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

One task, one branch, one PR. `main` stays deployable.

## Commits

```
P6-04: Add a build guard for routes without a permission gate

- Fails any diff adding a router call with no dynamicAccess or rbac
- Tested both directions: a gated route passes, an ungated one fails
- Closes the gap named in docs/SECURITY/04 § "The failure mode nothing prevents"
```

Subject carries the task ID. Body explains **why**, not what — git has the what.

## The Global Definition of Done

Every task inherits this. A task-specific DoD **adds** to it.

### Code

- [ ] Implements the spec in `docs/`
- [ ] Follows existing conventions ([`../docs/BACKEND/00-BACKEND-STANDARDS.md`](../docs/BACKEND/00-BACKEND-STANDARDS.md), [`../docs/FRONTEND/00-FRONTEND-STANDARDS.md`](../docs/FRONTEND/00-FRONTEND-STANDARDS.md))
- [ ] No `console.log`, no commented-out code
- [ ] Errors carry the right status — **404 cross-tenant, 409 invalid transition**

### Security — unwaivable

- [ ] **Every new route has a permission gate.** Nothing in the build enforces this.
- [ ] **Every new `:id` route has a two-tenant test asserting 404** — not 403, not 200
- [ ] No new `sequelize.query` without an explicit tenant predicate
- [ ] No new `skipTenantScope` without a comment explaining why
- [ ] No new `isSystemTask` spanning more than the operation needing it
- [ ] Every new cache key includes the tenant id
- [ ] No new uniqueness constraint spanning tenants
- [ ] No secret reachable in a response, a log, or `audit_logs.changes`

### Compliance

- [ ] Every mutation writes an audit row, **inside the action's transaction**
- [ ] A rolled-back action leaves **no** audit row
- [ ] Anything touching evidence states whether its guarantee is a **constraint** or a **convention**

### Testing

- [ ] Unit tests for new functions, **including the error branches**
- [ ] Negative authorization cases — the positive case alone proves nothing
- [ ] A live E2E spec where an endpoint changed
- [ ] Tests pass at the coverage gate
- [ ] Where a test guards something load-bearing, a **mutation check**: break the thing, watch the right test fail

### Build

- [ ] `pnpm lint` — React Compiler rules included, not disabled
- [ ] `pnpm typecheck` — frontend; the backend is JavaScript (ADR-030)
- [ ] `pnpm build`
- [ ] Migrations apply to a clean database **and** to production-shaped data
- [ ] **Migration results verified by inspecting columns**, not by trusting the log

### Documentation

- [ ] `docs/` amended **if and only if** reality changed — through the deviation protocol
- [ ] An ADR if a decision was made or a `docs/` document deviated from

### Record

- [ ] `MEMORY/records/YYYY-MM-DD-<task-id>-<slug>.md` written
- [ ] A line added to `MEMORY/MEMORY-INDEX.md`
- [ ] A `MEMORY/CHANGELOG.md` entry if user-visible or operationally significant
- [ ] `TASKS/PROGRESS.md` updated **in the same commit**

## What May Be Waived, and What May Not

**A multi-tenancy finding is not waivable by anyone.** Not for a deadline, not for a demo, not with a follow-up ticket.

Everything else is negotiable with a recorded decision **naming who agreed**, written into the change record.

## The Deviation Protocol

When implementation reveals `docs/` is wrong, incomplete, or contradictory:

1. **Stop.** Do not quietly implement something different.
2. Write an **ADR** in `MEMORY/DECISIONS.md` — decision, rationale, **alternatives considered**, implications **including the bad ones**.
3. Amend the `docs/` document, referencing the ADR.
4. Note both in the change record.

**A documented deviation is a decision. An undocumented one is a bug nobody has found yet.**

If the deviation would need a decision the owner has not made, it is an Open Question in [`BACKLOG.md`](./BACKLOG.md), not a judgement call.

## Evidence

> **An assertion that a test passed is not evidence. Name the test.**

"IDOR tested, all good" with no test named is **worse than saying nothing**, because it stops anyone looking again.

Two related rules, both learned here:

**Test database grants as the application role**, not the owner. As the owner the test passes whether the grant exists or not — a green tick for an absent control.

**A test generated from the code it tests verifies consistency, never correctness.** A redaction test iterating the redactor's own key set cannot catch a key being deleted from it.

## Distinguish "Renders" From "Works"

Two claims currently in this repository:

- The Helm charts **render**. No cluster has been reachable, so they are **not known to deploy**.
- The E2E suite has been verified **fix by fix**. It has **never passed in one uninterrupted run**.

Both distinctions belong in records and status updates. Rounding them up is how a board becomes untrustworthy.

## Traps Worth Checking Before You Finish

Each has caused a production defect here, and each is structural rather than careless.

| Trap | Consequence |
|---|---|
| An optional include without `required: false` | INNER JOIN — the list silently returns **nothing** |
| `schema.validate` passed to Express | **500 on every request** to that route |
| A path parameter the validator never sees | **400 on every request** |
| `db` destructured from the models barrel | `undefined`, then a throw at `transaction()` |
| `is_deleted` written in application code | silently does nothing — the attribute is `isDeleted` |
| `tenantId` used on the `sessions` model | `column "tenantId" does not exist` |
| A new role without a `ROLE_LEVELS` entry | fails every privileged gate, **silently** |
| A migration with a blanket `try/catch` | **recorded as applied while doing nothing** |
| A global uniqueness constraint | a cross-tenant existence oracle |
| Suspending the default tenant in a test | 403s every subsequent request; recovery is a direct database update |

## Before Opening a PR

```bash
make verify        # lint + typecheck + test + build
make test-e2e      # against a running server
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## PR

**Title:** `P6-04: Add a build guard for routes without a permission gate`

**Body:** spec refs, what changed and why, **named tests**, DoD checklist, anything waived and who agreed, anything **not determined**.

The last item is not optional. A PR that omits what it could not verify is a PR that will be trusted more than it should be.
