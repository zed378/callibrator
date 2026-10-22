# P24-09c: the invitation on the users page, and the admin password reset closed for imported accounts

**Date:** 2026-10-23 · **Card:** P24-09c · **ADR:** ADR-139 § 2, § 3 (Am. 1) · **Status:** DONE (the users page). The operator's switch on a screen is split out as **P24-09d**.

## What was built

| | |
|---|---|
| `users/components/InvitationActions.tsx` (new) | An "Invite {name}" button on the row of an account awaiting its invitation. Its dialog reads the state and shows: the operator's gate when it is closed (and then no send); the live invitation (sent, by whom, valid until or expired); the first issue; the person's first and last name for a shared account ("Send" stays disabled until both are given); "Send invitation" or "Send again", and "Withdraw". A refusal is shown in the server's own words; a failed load can be retried. The token is never seen. ID / EN (23 keys each) |
| `UserRow.tsx` | An account awaiting its invitation gets the Invite button **instead of** the credential resets |
| `user.service.ts` (frontend) | `getInvitation`, `issueInvitation`, `revokeInvitation`; the list maps `awaitingInvitation`. `User.awaitingInvitation` added |
| **Gap closed (backend):** `user.service#resetUserPassword` | An administrator's password reset **gave an imported account a temporary password** — a third way in that ADR-139 § 2 had not listed. It now answers 409 "This account is waiting for its invitation. Send the invitation instead of resetting the password." for an account awaiting its invitation, and writes nothing. Documented as the route's `conflict`; `openapi.json` and `schema.d.ts` regenerated |

## Tests (named; scoped — the full suites were not run)

- **Backend:** `routes/userInvitation.p2409a`, now 26/26. The new case: the reset of an awaiting account is 409 with nothing written, and the reset of an accepted one is 200.
- **Frontend, new:**
  - `users/components/__tests__/InvitationActions.p2409c`, 6 tests: the gate closed; a named send; a shared send needing both names; live, withdraw and expired; refusal, failure, retry and close; Indonesian.
  - `api/services/user.invitation.p2409c`, 4 tests.
  - Together with the users page, i18n and user-service suites: **12 suites, 102 tests passed**.
- **Coverage:** `InvitationActions.tsx` 100% of lines and functions, 96.25% of branches.
- **Gates:** typecheck 0 errors (backend and frontend); eslint on the changed files clean; `openapi:check` current; `openapi:lint` no new error.
- **Not run:** `next build` and the browser suites.

## Left for later

- **P24-09d:** the operator's switch (`upstream_invitations_open`) on a screen. Today it is the API only (`PATCH /admin/tenants/:id/flags`).
- **P30-04:** the cutover batch.

## Files

- `frontend/src/app/(app)/dashboard/users/components/InvitationActions.tsx` (new), `UserRow.tsx`
- `frontend/src/api/services/user.service.ts`, `frontend/src/types/index.ts`, `frontend/src/i18n/messages/en.ts`, `id.ts`, `frontend/src/api/generated/schema.d.ts`
- `backend/src/services/user.service.ts`, `backend/src/routes/api/user.openapi.ts`, `backend/openapi.json`
- tests:
  - new: `frontend/src/app/(app)/dashboard/users/components/__tests__/InvitationActions.p2409c.test.tsx`, `frontend/src/api/services/user.invitation.p2409c.test.ts`
  - changed: `backend/src/tests/routes/userInvitation.p2409a.test.ts`
- `MEMORY/DECISIONS.md` (ADR-139 Am. 2), `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
