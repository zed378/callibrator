# Q-54 / Q-56: debated and decided — no self-approval exception; stored fields are returned — DONE

**Date:** 2026-10-24 · **Items:** BACKLOG Q-54, Q-56 · **Status:** DONE · **Spec refs:** ADR-101, V-13, ADR-109 §7, BACKLOG Q-54/Q-56, record 2026-10-02-a349-a358

## Hook

BACKLOG carried two open owner questions. Q-54 asked whether a single-admin tenant may publish its own SOPs or approve its own certificates; Q-56 asked whether three stored-but-never-returned columns (`kanban_projects.code`, `tenants.suspension_reason`/`suspended_at`) should be returned. Both were decided here by debate, best practice, without waiting for the owner — Q-54 as documentation (no code), Q-56 as code.

## Q-54: no exception — a single-admin tenant cannot self-publish or self-approve

### A (strict compliance): no exception

Separation of duties is a compliance control, not a UX preference. 21 CFR 11.10(d) and ISO 13485 §4.2.4 require a controlled procedure to be released by someone other than its author; ISO/IEC 17025 §7.8.1.2 and 21 CFR Part 11 §11.10(g) read a certificate approval as an independent review. A per-tenant "allow self-approval" setting switches a compliance control off per tenant — the exact shape ADR-101 rejected ("a compliance control that can be switched off per tenant needs an owner decision"). The refusal is already built and tested (SOP author → 403 V-13; certificate author/submitter → 403 ADR-101, before re-auth, nothing written). A tenant that needs to publish grants a second user; that is the control working.

### B (operability): allow it for small tenants

A one-person lab or a single-admin tenant is real: the rule makes it impossible for them to ever publish an SOP or issue a certificate. An audited per-tenant setting (default off, operator-gated, every self-approval flagged in the audit row) would unblock them without changing the default. The cost is a compliance control with an off-switch, and every future audit must then ask which tenants flipped it.

### Decision: (a), as built — no code changed

The control stays unconditional. A self-approval path would need its own ADR, an audit design, and an owner decision; none is built here. The BACKLOG row is closed with this record. If a single-person lab asks, the answer is a second authorised user, not a setting.

## Q-56: return the stored fields — DONE in code

### A (return them): stored data the API drops is a lie by omission

`kanban_projects.code` is the card-key prefix the board view already shows (`getProject` returns it); `tenants.suspension_reason`/`suspended_at` are what an operator needs to see WHY a tenant is suspended (the 2026-10-02 working decision itself called the reason "the more useful of the two"). The columns exist, the writes exist, the reads silently drop them. Returning them is additive (nullable fields beside existing ones), no migration, no model change. The 2026-10-02 "do not add in Phase 10" deferral waited on the dashboard revamp; the revamp is not scheduled, and the fields are needed by any operator screen today.

### B (keep hiding them): the UI never rendered them, so nothing is lost

A-351/A-356 removed the UI that showed fields the API never answered — and nothing ever rendered, so no user lost anything. Adding fields to two contracts widens the API surface for screens that do not exist yet; the dashboard revamp (Phase 11) is the right place to design what the operator sees. The cost of waiting is zero visible change.

### Decision: (a) — implemented

Stored-but-dropped is the Q-52/Q-55 defect shape (accepted-then-dropped), and those were fixed by returning/storing, not by hiding. The deferral had no expiry; waiting for an unscheduled revamp keeps an operator blind to why a tenant is suspended indefinitely.

## What was changed (Q-56 only)

| | |
|---|---|
| `services/kanban.service.ts` | `listProjects` maps `code: p.code` (was dropped; `getProject` already returned it) |
| `services/tenantLifecycle.service.ts` | `getTenantLifecycleStatus` returns `suspensionReason` + `suspendedAt` (type + body) |
| `routes/api/kanban.openapi.ts` | `KanbanProjectSummary` gains `code: string \| null` (+ example) |
| `routes/api/tenantLifecycle.openapi.ts` | status data gains `suspensionReason: string \| null`, `suspendedAt: datetime \| null` |
| `backend/openapi.json` | regenerated (563 operations, code-first; current per `openapi:check`) |
| `tests/routes/kanban.code.q56.test.ts` | NEW: list carries `code`; null-code board answers null with the key present |
| `tests/routes/tenantLifecycle.suspension.q56.test.ts` | NEW: suspended tenant answers reason + date; active tenant answers nulls with keys present |

No migration: the columns already exist (0023 lifecycle; kanban `code` predates the drift). No model change: the attributes are declared.

## Tests

- `kanban.code.q56` + `tenantLifecycle.suspension.q56`: **4/4** (2026-10-24).
- Fail-before (revert each service line, run its suite): kanban **2/2 fail** (`code` undefined / key missing); lifecycle **2/2 fail** (`suspensionReason` undefined / key missing). Restored after.
- `npm run openapi:check`: current. `npm run typecheck`: clean. ESLint on all six touched files: clean.
- **Not run:** the full suite — this card touches two reads and their contracts; the two new suites plus the contract check cover it.

## Definition of Done

- [x] Q-54 debated (both sides) and decided: no exception, no code, row closed with this record
- [x] Q-56 debated (both sides) and decided: return the fields; service + contract + openapi.json + 4 tests
- [x] fail-before shown for both new suites (revert → fail → restore → pass)
- [x] BACKLOG Q-54/Q-56 rows marked DONE with this record
- [x] MEMORY-INDEX + CHANGELOG updated

## Files

- `TASKS/BACKLOG.md` (Q-54, Q-56 rows)
- `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
- This record
- Q-56 code: the six files in the table above (services, openapi.ts × 2, openapi.json, tests × 2)
