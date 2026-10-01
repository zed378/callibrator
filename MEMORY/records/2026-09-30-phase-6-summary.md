# Phase 6 — Correctness and Compliance — Summary

**Completed:** **not yet.** This summary is written before the phase closes, because the phase exit requires one and none existed (`OPEN-WORK-2026-09-30.md` §2). It states the phase as it stands on 2026-09-30 and names what is still open. Re-issue it, dated, when the last box closes.
**Duration:** 2026-09-11 (P6-01 verified) → open
**Tasks:** 11 of 14 DONE; 3 PARTIAL (P6-10, P6-11, P6-12); none deferred

> Saved as `MEMORY/records/2026-09-30-phase-6-summary.md` (template: `MEMORY/templates/PHASE-SUMMARY-TEMPLATE.md`).
>
> **"DONE" below means DONE with a record.** Work after commit `ce74932` (2026-09-29) is recorded but not yet merged. Phase 6's DONE cards all predate that commit, except where a row says otherwise.

---

## What Shipped

A release can now be defended on the points an auditor raises first. Calibration records cannot be edited or deleted, even by the database owner. No route can be merged without a permission gate. A rolled-back change leaves no audit row. The super admin must use a second factor. The whole live test suite has passed in one run.

| Task | Title | Record |
|---|---|---|
| P6-01 | Restore the backend coverage gate | `2026-09-28-phase6-open-cards.md` (evidence restated under P6-14) |
| P6-02 | One clean full E2E pass, uninterrupted | `2026-09-28-p6-02-e2e-green.md` (ADR-077) |
| P6-03 | Calibration records append-only in the database | `2026-09-25-phase0-batch6.md`, `-batch7.md` (ADR-062, migration `0057`) |
| P6-04 | Build guard: no route without a permission gate | `2026-09-25-phase0-batch6.md`; re-verified in `2026-09-28-phase6-open-cards.md` (ADR-058) |
| P6-05 | Post-migration column verification | `2026-09-25-phase0-batch6.md` (ADR-062) |
| P6-06 | Composite unique `(tenant_id, serial_number)` | `2026-09-28-phase6-open-cards.md` (ADR-049, ADR-078) |
| P6-07 | Mandatory MFA at role level 10 | `2026-09-25-phase0-batch6.md` (ADR-059) |
| P6-08 | Swagger aligned with the GDPR validators | `2026-09-25-phase0-batch6.md` |
| P6-09 | A reason on every stock quantity change | `2026-09-25-phase0-batch6.md` (ADR-062, migration `0059`) |
| P6-13 | Webhook routes: validate the input, own the secret | `2026-09-28-phase6-open-cards.md` (ADR-085, migration `0090`) |
| P6-14 | Make the coverage figure mean what it says | `2026-09-28-phase6-open-cards.md` (ADR-085) |
| P6-10 | Rotation procedure for the two unrotatable secrets | **PARTIAL.** Built and rehearsed twice: `2026-09-25-phase0-batch6.md` (ADR-062) and `2026-09-27-p7-04-restore-drill.md` (ADR-078) |
| P6-11 | Audit rows inside the transaction | **PARTIAL.** `2026-09-28-phase6-open-cards.md` (ADR-085) |
| P6-12 | Revocation that revokes | **PARTIAL.** `2026-09-28-phase6-open-cards.md` (ADR-085) |

---

## What Deviated From `docs/`

| Deviation | ADR | Why |
|---|---|---|
| Calibration records are protected by a **trigger for every role** plus REVOKEs, not by REVOKE alone. A correction is a new record, not an edit | ADR-062 (confirmed ADR-084) | A REVOKE does not bind the owner. A correction path was needed, or Part 11 corrections would be impossible |
| The serial unique constraint is **not** partial on `is_deleted` | ADR-078 | A soft-deleted device still anchors append-only calibration evidence. A-133's restore is the way back |
| Super-admin MFA includes an **enrolment-only session** and an audited break-glass CLI | ADR-059 | Mandatory MFA must not lock out the only operator (Q-07). "Disable the check" was ruled out |
| The coverage gate measures **six layers**; models are outside the 100% figure | ADR-085, ADR-092 | A figure that silently excluded code was the defect P6-14 existed to fix. The exclusion is now stated and pinned (`coverageScope.p614.test.js`) |
| The audit middleware `recordAudit` has **no role**; every audit write goes through `audit.service#logAction` in the caller's transaction | ADR-085 | It ran after the response, outside any transaction |
| E2E specs follow the **documented** contract, not observed behaviour | ADR-077 | Specs that asserted what the code happened to do had hidden defects |
| P6-10's "copy of production data" is **a restored copy of the VM database after the closing deploy**; real hospital data is post-go-live | **ADR-109 §1** (working decision, awaiting the owner's confirmation) | The VM is wiped at the closing deploy, so no hospital data exists yet |
| P6-11's covered set is **all 15** remaining mutating services | **ADR-109 §2** (working decision, awaiting the owner's confirmation) | `CLAUDE.md` states the rule without qualification |

---

## What Was Deferred

| Item | Waiting on | Backlog entry |
|---|---|---|
| P6-10 rehearsal on a copy of production data | the closing deploy (a restored copy of the VM database), then a real-data rehearsal after go-live | ADR-109 §1; `BACKLOG.md` § Working Decisions WD-1 |
| P6-11: the 15 unaudited mutating services | an agent is implementing them (scope decided 2026-09-30) | ADR-109 §2; WD-2 |
| P6-12: the VM's `JWT_ACCESS_EXPIRED=1d` against the repository's `15m` | the closing deploy regenerates `.env` (`OPEN-WORK-2026-09-30.md` §7.10) | P6-12 card |
| P6-13: the frontend has no rotate button and does not show `previousSecretExpiresAt` | frontend work | F-18 |
| P6-04 and the CI `backend-test` stage | a GitHub Actions run someone has actually read | P7-01 |

---

## What Failed

- **Every webhook secret rotation and URL change failed on PostgreSQL** from migration `0033` until 2026-09-28. `webhook.service.js` wrote its audit row with no `actorType` (NOT NULL). The unit tests mocked `AuditLog.create`, so they stayed green. It was found only by P6-11's rule that nothing but `audit.service.js` writes `audit_logs` (`2026-09-28-phase6-open-cards.md`).
- **The first E2E runs failed: 12 of 53 specs and 24 tests** (2026-09-27). Getting to green found eleven application defects:
  - every tenant backup returned 500;
  - GDPR export returned 500, twice for two different reasons;
  - user-permission deletes returned 400 for every seeded menu group;
  - no session could be refreshed, because `login()` never sent the refresh token;
  - MFA enrolment looped in the browser;
  - and five more.

  Each fix has a test that fails without it (`2026-09-28-p6-02-e2e-green.md`). A later green pair of runs was followed by 2 failures and 4 × 429. That instability exposed the `auth` throttle and the `tenantCreate` budget.
- **Four cards were stale.** P6-01, P6-07 and P6-08 said TODO for work that was already done, and P6-04 was TODO on its card while PROGRESS said PARTIAL (`2026-09-28-phase6-open-cards.md`). This is the PR-4 failure in miniature: the board disagreed with the code.
- **The 100% figure measured six layers and said so nowhere,** and `collectCoverageFrom` listed a file that did not exist (`src/app.js`). It was fixed by P6-14.
- **A-99: MFA had never worked on the installed `otplib` 13.** The mock's `check()` returned true for any code. That was found in the same period and belongs to the audit board, but it is the same "mock invents the contract" shape that P6-02 kept hitting.

---

## Security Outcomes

| Control | Test | Result |
|---|---|---|
| Tenant isolation, per `:id` route | `backend/src/tests/guards/twoTenantRoutes.guard.test.ts`: 201 routes with a path parameter; 150 have a two-tenant 404 test and 51 are on a reviewed allow-list | green as of 2026-09-29 (`CLAUDE.md`). Not re-run for this summary |
| Authorization: no route without a gate | `routePermissionGuard.p604.test.js`, `readGates.p604.test.js` | 212 tests green, re-verified 2026-09-28. The 2026-09-30 full run reports `routePermissionGuard.p604` **red** on an exemption naming `auth.service.js` after its conversion to `.ts` (another lane's; `2026-09-30-p10-backend-access-requests-passkey.md`) |
| Append-only calibration records | `dataIntegrity.p6.live.test.js`, run as `callibrator_app` | 22/22 on PostgreSQL 18.6, 2026-09-28 |
| Audit completeness | `auditInTransaction.p611.test.js`: every `logAction` passes a transaction, and only `audit.service.js` writes `audit_logs`. Forced-rollback `*.audit.a41.test.js`; `audit.service.a42.test.js` | green 2026-09-28. **Coverage is not complete:** 15 services write no audit row (P6-11 open) |
| Audit rows append-only in the database (beyond the card; Q-34) | `auditLogAppendOnly.q34.live.test.ts` | green on PostgreSQL 18.6 as the app role and as the owner, 2026-09-29 (ADR-095) |
| Super-admin MFA | `auth.superAdminMfa.p607.test.js` | green, re-verified 2026-09-28 |
| Revocation | `auth.tokenPurpose.a59` "P6-12: an access token without sid is refused"; `socket.test.js` "P6-12 — an open socket stops when its principal stops" (7) | fail before, pass after (`2026-09-28-phase6-open-cards.md`). **Open:** a super admin could not revoke another user's sessions (N-01, `OPEN-WORK-2026-09-30.md` §4). It is being fixed in the tree, with no A-id or test yet |
| Secret exposure (webhooks) | `webhook.validator` "P6-13: REFUSES a caller-supplied secret…"; `webhook.secret.a51` "P6-13 — rotation with an overlap window" (5); `0090-webhook-secret-rotation-overlap.p613.live.test.js` 5/5 on PG 18.6 | green 2026-09-28 |
| Key rotation | `keyRotation.s08.live.test.js` | 5/5 on PostgreSQL 18.6, 2026-09-29 (Q-36) |

**No multi-tenancy finding was waived.** The one found in this period that touches revocation is N-01. It is not a cross-tenant disclosure; it is a super admin unable to act. It is open in the tree and is listed as open here.

---

## Compliance Outcomes

| Requirement | Evidence |
|---|---|
| Append-only records | **A constraint.** A trigger refuses DELETE, TRUNCATE and content changes on `calibration_records` for every role (migration `0057`). The app role has no UPDATE/DELETE. `audit_logs` got the same protection on 2026-09-29 (migration `0091`, ADR-095) |
| Signature completeness | the meaning of a signature is required and bound (`validators/eSignature.validator.ts`, `reason` 1–255; REVIEW V-04). A certificate's author may not approve it (ADR-101, 403) |
| Audit trail continuity | inside the transaction for the 38 covered files, pinned by `auditInTransaction.p611`. **Not yet for 15 services** (P6-11, in progress) |
| Retention and legal hold | audit rows are never purged (Q-03, ADR-069 §5; `dataRetention.a121.test.js`) |

---

## What Was Not Determined

- **P6-10 on production-like data.** The procedure has run on seeded data and on drill data only. The rehearsal on a restored copy of the VM database has not happened, and a rehearsal on real hospital data cannot happen before go-live.
- **P6-12 on the deployment.** The VM ran `JWT_ACCESS_EXPIRED=1d` at the last read, so a revoked session's access token lived for up to a day there.
- **The E2E suite has never run in CI or against the reference deployment.** It passed twice in a row on a local compose stack, run by hand.
- **The backend gate is red on today's shared tree:** 767 suites, 4 failing, 99.96% statements (2026-09-30), from other lanes' unfinished work. The last green full run was 2026-09-28. Phase 6 cannot claim a green gate at close until a run on a quiet tree is recorded.
- **P6-07's E2E harness change was not run live** (PROGRESS P6-07 row).

---

## Definition of Done

- [ ] Every task in the phase file is `DONE`. **Not met:** P6-10, P6-11 and P6-12 are PARTIAL
- [x] Every `DONE` task has a record in `MEMORY/records/`
- [ ] The global Definition of Done is satisfied for each, or the waiver is recorded with **who agreed**. The ADR-109 working decisions await the owner's confirmation
- [x] This summary exists (as an interim summary)
- [x] Security outcomes are **named**, not asserted
- [x] `TASKS/PROGRESS.md` reflects reality (reconciled 2026-09-30)

Phase exit (`PHASE-6` § Phase Exit):
- Coverage gate with its scope written down: the scope is written. The gate is **red** on the shared tree today.
- E2E in one uninterrupted run: done, 2026-09-28.
- Append-only as a constraint, tested as the application role: done.
- No route merged without a gate: done.
- A rolled-back mutation leaves no audit row: proved.
- A revoked session stops on the next request: proved in code (sid-less refused, sockets re-checked). **Not** on the VM until `JWT_ACCESS_EXPIRED` is corrected.
- A phase summary: this document.

---

## What to Watch

- **Mocks of `AuditLog.create`, `otplib` or any driver.** Three of this phase's live defects hid behind a mock that agreed with itself.
- **A new mutating service with no audit row.** `auditInTransaction.p611` pins *how* an audit row is written, not *that* one is. Until P6-11's 15 are covered, no guard fails for a sixteenth.
- **A super-admin role-name comparison written by hand.** N-01 and V-15 are the same shape. The seeded name is `SUPERADMIN`.
- **The `JWT_ACCESS_EXPIRED` value on every deployment.** The repository default is `15m`; the reference VM drifted to `1d`.

---

## Metrics

| | |
|---|---|
| Tasks completed | 11 of 14 (3 partial) |
| ADRs written in the phase | ADR-058, 059, 062, 077, 078 (P6-06, P6-10 part), 084 (confirmations), 085, and 109 (working decisions) |
| Specification gaps found | P6-11's covered set (now decided); P6-10's "production data" (now decided) |
| Defects found **after** a task was marked done | at least 4 cards whose status was wrong in either direction (P6-01, P6-04, P6-07, P6-08); the webhook `actorType` 500 behind a green suite |
| Coverage at phase close | not closed. Last green: 683 suites / 12,890 tests / 100% of six layers (2026-09-28). Latest: red, 99.96% (2026-09-30) |

---

## Next Phase

Phase 7 has been running beside Phase 6's three partial cards; see `2026-09-30-phase-7-summary.md`. Per the phase rule, Phase 6 closes when:
- P6-10 is rehearsed on the restored post-deploy copy;
- P6-11's 15 services are audited;
- P6-12's VM value is corrected;
- a full backend gate on a quiet tree is recorded green;
- the owner confirms or overturns ADR-109 §1–§2.
