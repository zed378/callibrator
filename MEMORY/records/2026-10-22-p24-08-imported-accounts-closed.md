# P24-08: an imported account is closed until its invitation is accepted

**Date:** 2026-10-22 · **Card:** P24-08 · **ADR:** ADR-139 § 2 · **Closes:** BACKLOG M-19 · **Status:** DONE.

## What was built

| | |
|---|---|
| Migration `0143-users-awaiting-invitation` | `users.awaiting_invitation boolean NOT NULL DEFAULT false` (added only when absent: on a fresh database `db.sync()` made it); `GRANT INSERT (awaiting_invitation) ON users` to the transform role, no UPDATE. Throws without the transform role. `down` refuses while any account awaits its invitation, else revokes and drops |
| `models/user.model.ts` | `awaitingInvitation` (BOOLEAN, not null, default false) |
| `transform/users.ts` | every inserted account is written `awaiting_invitation = true`; the re-run UPDATE never touches it |
| `auth.service#requestOTP` | an awaiting account is answered as an unknown one: no code written, nothing queued |
| `auth.service#processResetPassword` | an awaiting account gets the unknown account's 400 `Invalid OTP`, even with a valid stored code |
| `sso.service#provisionUser` | an awaiting account: 403 "This account is waiting for its invitation. Use the link in the invitation e-mail."; no JIT row |
| Password sign-in | unchanged: the unusable hash fails like any wrong password |

## Tests (named)

- **New, unit:**
  - `routes/importedAccount.closed.p2408` (real auth router, validator, controller and service over `memoryDb`): 3/3. **Fail-before:** with `auth.service.ts` reverted, 2 of 3 failed (the code was queued; the reset succeeded); the control case passed.
  - `services/sso.awaitingInvitation.p2408`: 2/2.
  - `migrations/0143-users-awaiting-invitation.p2408`: 9/9; the migration at 100 / 100 / 100 / 100.
- **Changed, unit:** `services/upstreamImport/transform.p2402b` asserts the column and its value are aligned in the INSERT, and absent from the UPDATE.
- **Live, PostgreSQL 18** (`pgvector/pgvector:pg18`, `npm run test:live -- --only=p2401,p2402`): **8 of 8 suites, 37 tests passed**. `p2402b` now checks that every imported account is inserted awaiting, that the transform role cannot `UPDATE users SET awaiting_invitation` (42501), and that 0135's down leaves 5 column grants (0139's four SELECTs plus 0143's INSERT).
- **`--findRelatedTests`** over the six changed source files: **570 suites, 11,485 tests passed**.
- **Gates:**
  - `npm run typecheck`: 0 errors
  - `eslint` on the changed files: clean; `eslint-ratchet`: 0 / 0
  - `ratchet`: 695 `.js`, at the floor
  - `build:dist`, then `load:check` OK in both modes (771 modules, 117 in boot order)
- **Not mine, seen on this Windows workstation:** `guards/auditCoverage.p611`, `guards/pkgBasePin.a325` and `guards/prePushHook.a19` fail the same way **with these changes stashed**. The causes are CRLF checkouts read by `\n` regexes, and gitleaks not installed. Not investigated further; CI (Linux) is the reference.
- **Workstation repair:** `node_modules` was incomplete (`zod/v4`, `sequelize/types/transaction.d.ts` and others were missing), so no suite could load. `npm ci` from the committed lockfile fixed it. Nothing committed changed.

## Left for later

- **P24-09:** `user_invitations`, issuing and accepting an invitation, and the 30-day unclaimed rule (ADR-139 § 3 … 5). Until then, an imported account has **no way in at all**, which is intended before cutover.

## Files

- `backend/src/migrations/0143-users-awaiting-invitation.ts` (new), `backend/src/config/migrator.ts`
- `backend/src/models/user.model.ts`, `backend/src/services/auth.service.ts`, `backend/src/services/sso.service.ts`, `backend/src/services/upstreamImport/transform/users.ts`
- tests:
  - new: `routes/importedAccount.closed.p2408.test.ts`, `services/sso.awaitingInvitation.p2408.test.ts`, `migrations/0143-users-awaiting-invitation.p2408.test.ts`
  - changed: `services/upstreamImport/transform.p2402b.test.ts`, `migrations/upstreamTransform.p2402b.live.test.ts`
- docs and boards: `MEMORY/DECISIONS.md` (ADR-139 status), `docs/SECURITY/15` § 11 (G-32), `docs/UPSTREAM/05-DATA-MIGRATION.md` § 5, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`, `TASKS/PROGRESS.md`, `TASKS/BACKLOG.md` (M-19), `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
