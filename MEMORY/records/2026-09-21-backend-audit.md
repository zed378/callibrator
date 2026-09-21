# Backend Audit — 2026-09-21

**Kind:** audit · decision record
**Tasks:** [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) · [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md)
**Decisions:** ADR-038 (TypeScript), ADR-039 (PostgreSQL only)

---

## How This Started

The request was documentation: add the categories a reference repository has and this one lacks. Writing them as-built meant reading the code each document would describe — and the code kept disagreeing with the documents already here.

The audit is the by-product. Every finding below was found by reading source, then checked against the running deployment where that could be done read-only. Nothing was attacked.

## Findings, by Kind

### Live security holes

| | Evidence |
|---|---|
| **Cross-tenant write** on `tenant-hierarchy` | three mutating routes guarded by `auth` alone; the `Tenant` model has no `tenantId`, so the scoping hooks never apply to it. Any principal can create a sub-tenant under, re-parent, or detach **another** tenant |
| Tenant configuration open to every user | webhooks, storage settings and custom domains: `auth` only. The lowest role can point the tenant's uploads at its own bucket |
| API-key scopes enforced on 16 of 53 route files | scopes live in `dynamicAccess`; 31 route files use neither it nor `rbac` |
| Search ignores read permissions | `auth` only; returns devices, stock and certificates to any role |
| Raw error messages in production | `asyncHandler` answers before the sanitising handler runs; observed verbatim on the live system |

### Silent correctness defects

| | Evidence |
|---|---|
| **Every tenant's metered usage read as zero** | `$1` placeholders passed as `replacements`; proven against a real PostgreSQL 17 (`there is no parameter $1`); a `catch` returned `{ total: 0 }`; the unit test asserted the bug. **Fixed** |
| Production writes nothing to stdout | Console transport development-only → `docker logs`: 0 lines |
| Per-request logs dropped in production | `logger.http` is below the `info` level → 0 of 640 combined-log lines |
| Dead security middleware | `sessionSecurity.middleware.js` imported by nothing, SQL against a nonexistent table, counted as covered |
| Webhook retries are 15 seconds long and die on restart | in-process `setTimeout`, 1-2-4-8 s |
| Two webhook events in the whole system | `device.calibration_due`, `device.overdue` |

### Documentation that described a different system

| Claimed | True |
|---|---|
| an embedded `aedes` MQTT broker inside Express | an MQTT **client** of an external broker, off on the reference deployment; `aedes` referenced by no code |
| PostgreSQL **or** MySQL | `mysql2` was never a dependency; search, webhooks and RAG were PostgreSQL-only SQL |
| RAG "unavailable" on MySQL | it returned the five most recent chunks as context, regardless of relevance |
| gates run in a `pre-push` hook, with a secret scanner and an IDOR enforcement script | none of the three exists; nothing automatic stands between a commit and `main` |
| `docker logs` empty because winston initialised early | empty because production writes nothing to stdout, ever |

The last row is mine: I wrote that explanation on 2026-09-10 without checking it. The `pre-push` and secret-scanner text was written in the same documentation pass and appears to have been carried over from the reference project's structure. Both are the failure `CLAUDE.md` calls PR-4, produced while writing documents meant to prevent it.

## Decisions Taken

| | Why |
|---|---|
| **ADR-039 — PostgreSQL only** | the second engine never ran, and its cost was real: one feature written twice, the wrong copy running, the tests exercising whichever copy the mock picked |
| **ADR-038 — strict TypeScript, incrementally** | owner decision. The defects found here are overwhelmingly the kind a type checker rejects — wrong option names, undefined bodies, attributes spelled the wrong way — and 5,741 mocked tests did not catch them |
| **Security fixes first, in JavaScript** | the migration is months; the holes are live |
| **Documents state TypeScript as the target, not as fact** | writing it as done would repeat PR-4 at the scale of every backend document |

## Lessons

1. **A control that is not wired is worse than no control.** The dead session middleware, the non-existent hook and scanner, the hidden-menu "authorisation" on `tenant-hierarchy`: each looked like protection to anyone reading, and each stopped someone looking further.
2. **A `catch` that returns a default hides the outage.** `getUsage` failed on every call for as long as it existed and reported zero. Swallow an error only where zero is a true answer.
3. **A test can lock a bug in.** The metered-billing test asserted `replacements`. Tests that mirror the implementation's options verify consistency, never correctness (`CLAUDE.md` § Evidence).
4. **Read the code before explaining the symptom.** The `docker logs` explanation was plausible, specific, and wrong.
