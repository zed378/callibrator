# CLAUDE.md — Operating Instructions for AI Agents

How Claude and other AI agents work in this repository.

---

## Read This First

**The previous version of this file was wrong in a way that produced confidently wrong work.**

It instructed agents to write strict TypeScript with no `any` — for a backend that is **JavaScript, CommonJS**. It pointed at a task board listing foundation work as TODO that had shipped months earlier.

That is recorded as PR-4 in [`docs/PLAN/18-RISK-REGISTER.md`](docs/PLAN/18-RISK-REGISTER.md), and it is the single most important thing to know about this project's history: **an instruction document that disagrees with the code produces confidently wrong work, and the confidence is the dangerous part.**

Everything below is grounded in the code as of 2026-09-10. If you find a claim here that the code contradicts, **the code wins** — and correcting this file is part of the fix.

## What This Is

**Callibrator** — multi-tenant SaaS for hospital medical-device calibration, maintenance and lifecycle management.

| | |
|---|---|
| Backend | **Express, JavaScript, CommonJS** — *not TypeScript* (ADR-030) |
| Database | PostgreSQL **or MySQL** (ADR-029) |
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand |
| Realtime | Socket.IO, both ends (ADR-031) |
| Infra | Redis · RabbitMQ · embedded MQTT · ClamAV · pgvector |
| Scale | 33 modules · 53 route modules · 72 models · 342 test files |
| Compliance | ISO 17025 · FDA 21 CFR Part 11 · ISO 13485 · GDPR · KARS · SNARS |

## Before You Start

1. **[`docs/README.md`](docs/README.md)** — the map.
2. **[`docs/PLAN/00-PROJECT-OVERVIEW.md`](docs/PLAN/00-PROJECT-OVERVIEW.md)** — what this is and what it deliberately is not.
3. **[`docs/SECURITY/05-MULTI-TENANCY-SECURITY.md`](docs/SECURITY/05-MULTI-TENANCY-SECURITY.md)** — **mandatory, no exceptions.**
4. **[`MEMORY/DECISIONS.md`](MEMORY/DECISIONS.md) Part II** — nine ADRs recording what was built differently from what was planned. Read Part II before acting on Part I.
5. **[`TASKS/PROGRESS.md`](TASKS/PROGRESS.md)** — what is actually shipped.
6. **[`TASKS/00-TASK-CONVENTIONS.md`](TASKS/00-TASK-CONVENTIONS.md)** — the Definition of Done.

## The Non-Negotiables

### Tenant isolation

Enforced by global Sequelize hooks reading an `AsyncLocalStorage` context, **deny-by-default**. You do not opt in.

```js
// You write this:
const devices = await Device.findAll();
// The hooks add the tenant predicate. A principal with no resolvable
// tenant matches NO_TENANT_UUID and sees NOTHING.
```

**Never** read `tenantId` from a request body. It is stamped from the context.

**Raw SQL bypasses the hooks entirely.** Every `sequelize.query` carries the predicate explicitly, and every new one is a review item.

### Cross-tenant returns 404, never 403

A 403 says "this exists and you may not have it" — which turns id enumeration into a tenant-membership oracle. Non-existent, soft-deleted and not-yours must be **indistinguishable**.

### Every route needs a permission gate

```js
router.post("/", auth, dynamicAccess("equipment", "write"), validate(schema), ctrl.create);
```

**Nothing in the build enforces this.** A route without one works for everyone with a token. It is the single most likely authorization defect in the codebase, and the guard is P6-04.

### Every mutation writes an audit row, inside the transaction

An audit row that survives a rolled-back action records something that did not happen. An action that commits without one is unattributable.

### Every new `:id` route needs a two-tenant test asserting 404

Not 403. Not 200. `createTwoTenants()` is a one-line fixture precisely so this gets written.

## The Traps

Every one of these has caused a production defect here. They are structural, not careless.

| Trap | What happens |
|---|---|
| An optional include without **`required: false`** | INNER JOIN — the list silently returns **nothing** |
| **`schema.validate`** passed to Express | **500 on every request** to that route |
| A path parameter the validator never sees | **400 on every request** — merge `{ ...req.params, ...req.body }` |
| **`db`** destructured from the models barrel | it exports `sequelize`; you get `undefined`, then a throw |
| **`is_deleted`** written in code | silently does nothing — the attribute is `isDeleted` |
| **`tenantId`** on the `sessions` model | `column "tenantId" does not exist` — it uses snake_case |
| A new role without a **`ROLE_LEVELS`** entry | fails every privileged gate, **silently** |
| A migration with a blanket **`try/catch`** | **recorded as applied while doing nothing** |
| A **global** uniqueness constraint | a cross-tenant existence oracle |
| Suspending the **default tenant** in a test | 403s every later request; recovery is a direct database update |

The first one is the most repeated defect shape in this codebase. It has hit certificates and risks, and it is latent on `maintenance_work_orders`.

## The Response Envelope

```json
{ "success": true, "status": 200, "message": "...", "data": [], "meta": { "total": 0 } }
```

**Rows in `data`. Pagination in a top-level `meta`, a sibling of `data`.** Never `data.rows`, never `data.items`, never `data.meta`.

Violating it renders an empty list with **no error**. Three screens did exactly that for weeks.

## Status Codes That Carry Meaning

| Code | Use |
|---|---|
| 400 | validation |
| 403 | permission failure **inside the caller's own tenant** |
| **404** | not found — **including belonging to another tenant** |
| **409** | invalid state transition |

A 409 surfaces as a **state explanation** — "this certificate is in `draft` and must be submitted first" — never a generic error. Reporting a conflict as a 500 hides a design gap behind a stack trace, which is exactly what made certificate approval unreachable.

## When to Act, and When Not To

**Act on:** an assigned task, a bug found during work, a question about the codebase, documentation that disagrees with the code.

**Do not:**

- start a task that is not assigned or next in the queue,
- change architecture without an ADR,
- **amend `docs/` quietly** — that is the deviation protocol, and it needs a record,
- mark something done without its `MEMORY/records/` entry,
- claim a test passed without **naming it**.

## The Deviation Protocol

When implementation reveals `docs/` is wrong, incomplete, or contradictory:

1. **Stop.** Do not quietly implement something different — that is how the specification drifted the first time.
2. Write an **ADR** in `MEMORY/DECISIONS.md`: decision, rationale, **alternatives considered**, implications **including the bad ones**.
3. Amend the `docs/` document, referencing the ADR.
4. Note both in the change record.

**A documented deviation is a decision. An undocumented one is a bug nobody has found yet.**

If it needs a decision the owner has not made, it is an **Open Question** in `TASKS/BACKLOG.md`, not a judgement call.

## Evidence

> **An assertion that a test passed is not evidence. Name the test.**

"IDOR tested, all good" with no test named is **worse than saying nothing**, because it stops anyone looking again.

Three rules that catch a worthless test:

- **Test database grants as the application role**, not the owner. As the owner it passes whether the grant exists or not.
- **A test generated from the code it tests verifies consistency, never correctness.** A redaction test iterating the redactor's own key set cannot catch a key being deleted from it.
- **A mock proves the client, not the contract.** 3,863 tests passed here while 13 endpoints were broken.

## Distinguish "Renders" From "Works"

Two claims currently live in this repository, and both are stated carefully on purpose:

- The Helm charts **render**. No cluster has been reachable, so they are **not known to deploy**.
- The E2E suite has been verified **fix by fix**. It has **never passed in one uninterrupted run**.

Do not round these up. `TASKS/BACKLOG.md` § Unverified Claims lists all six of them.

## Workflow

```
1. read the task and every document in its Spec refs
2. if "Spec required", write MEMORY/specs/<task-id>-<slug>.md FIRST
3. branch:   feat/P6-04-route-permission-guard
4. implement
5. verify:   make verify      (lint · typecheck · test · build)
             make test-e2e    (against a running server)
6. record:   MEMORY/records/  + MEMORY-INDEX + CHANGELOG + ADR if a decision
7. update:   TASKS/PROGRESS.md — in the SAME commit
8. PR:       P6-04: <description>
```

`make verify` does **not** cover the live or browser suites. A green `verify` is not a green release.

## Commands

```bash
make help          # every target
make dev           # local stack
make verify        # the pre-push gate
make test-e2e      # 53 live specs, running server required
make migrate       # then: make migrate-verify — the log is not evidence
```

## Code Style

Match the surrounding code. Both workspaces have standards documents:

- [`docs/BACKEND/00-BACKEND-STANDARDS.md`](docs/BACKEND/00-BACKEND-STANDARDS.md)
- [`docs/FRONTEND/00-FRONTEND-STANDARDS.md`](docs/FRONTEND/00-FRONTEND-STANDARDS.md)

JSDoc on exported backend functions — it is the only type information that codebase has.

Do not disable React Compiler lint rules to make a build pass. The rule is usually right about the component.

## Two Things Currently Failing

Stated here because an agent reading a green board and finding a red gate wastes an afternoon:

| | |
|---|---|
| Backend unit coverage gate (100%) | **failing** → P6-01 |
| Live E2E in one uninterrupted run | **never achieved** → P6-02 |

## If You Are Unsure

Read the code. `docs/` names its source files precisely so you can check it rather than trust it.

If the code and this file disagree, **the code wins, and this file gets fixed** — in the same change, with a record.
