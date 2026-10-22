# P24-09b: an unclaimed invitation deactivates its account after 30 days

**Date:** 2026-10-23 · **Card:** P24-09b · **ADR:** ADR-139 § 5 · **Status:** DONE. No migration.

## What was built

| | |
|---|---|
| `services/unclaimedInvitation.service.ts` (new) | `deactivateUnclaimedAccounts(now)` reads the active accounts still awaiting an invitation across tenants (system task `UNCLAIMED_INVITATION`), 500 at a time by id and at most 5,000 per run, so a page of never-invited accounts cannot stall it. Each account is handled inside `runForTenant` of its tenant. The job reads its **first** invitation. If that is at least 30 days old, one transaction locks and re-checks the user, sets `isActive = false` and `status = INACTIVE`, and writes one audit row (`system:unclaimed-invitation`, operation `DEACTIVATE_UNCLAIMED_ACCOUNT`, the facility stamped). An account never invited is untouched. The live invitation is left as it is, because its acceptance already refuses an inactive account |
| `middlewares/unclaimedInvitationScheduler.middleware.ts` (new) | `unclaimed-invitation`, `UNCLAIMED_INVITATION_SCHEDULER` (default `47 3 * * *`), switched off by `SCHEDULERS_ENABLED=false`, monitored (P7-02); started in `index.ts` after the bound-account job |
| Registries | `SYSTEM_ACTORS.UNCLAIMED_INVITATION`, `SYSTEM_TASKS.UNCLAIMED_INVITATION`, both `.env.example` files, and the Helm configmap (`disabled` in the API deployment) |

## Tests (named; scoped — the full suite was not run)

- **New:** `services/unclaimedInvitation.p2409b`, 9 tests:
  - the due accounts in both tenants, with their audit rows;
  - a re-issue does not reset the clock;
  - never-invited, accepted and inactive accounts are untouched;
  - a re-run does nothing more;
  - a failure is counted and the others continue;
  - an account accepted between the page read and the lock is left alone;
  - more than one page is paged through;
  - the scheduler: default schedule, the switch, an invalid expression, the tick, the summary.
- **Changed:** `utils/jobContext.w12` and `constants/systemActors.a124` (the new task and actor). These two plus the new suite: 25/25.
- **Coverage:** both new files at 100 / 100 / 100 / 100.
- **Not run here:** the W-02 Helm render (`schedulerSwitch.w02`). Its two helm-rendering cases fail because `helm` is not on this workstation's PATH; its other 12 cases pass.
- **Gates:** typecheck 0 errors; eslint on the changed files clean.

## Left for later

- **P24-09c:** the screen to issue and revoke an invitation, and the operator's switch on the tenant console.

## Files

- `backend/src/services/unclaimedInvitation.service.ts`, `backend/src/middlewares/unclaimedInvitationScheduler.middleware.ts`, `backend/index.ts`
- `backend/src/constants/systemActors.ts`, `backend/src/utils/jobContext.util.ts`
- `backend/.env.example`, `deploy/compose/.env.example`, `deploy/helm/callibrator/templates/configmap.yaml`
- tests:
  - new: `backend/src/tests/services/unclaimedInvitation.p2409b.test.ts`
  - changed: `backend/src/tests/utils/jobContext.w12.test.js`, `backend/src/tests/constants/systemActors.a124.test.js`
- `MEMORY/DECISIONS.md` (ADR-139 status), `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
