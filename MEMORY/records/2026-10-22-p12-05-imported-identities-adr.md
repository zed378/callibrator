# P12-05: the ADR for imported identities (ADR-139)

**Date:** 2026-10-22 · **Card:** P12-05 · **ADR:** ADR-139 · **Status:** DONE (a decision record; § 1 and § 6 describe what is built, § 2 … § 5 are the target).

## What was decided

| § | | State |
|---|---|---|
| 1 | No upstream hash: one unusable bcrypt per run, `must_change_password`, e-mail unverified; inactive upstream → inactive, never invited | **built** (P24-02b, ADR-129 Am. 4) |
| 2 | `users.awaiting_invitation`, set on insert by the transform; while true the e-mail-code reset sends nothing / refuses with its usual answers, and SSO does not link | target → **P24-08** |
| 3 | `user_invitations`: 256-bit token, SHA-256 only, one live per user, 7 days; unbound `management` write or the operator; 409 `INVITATION_NOT_APPLICABLE`; 409 `PRE_INVITATION_GATE_OPEN` until the operator-only tenant setting `upstream_invitations_open`; the person behind a shared account named at issue | target → **P24-09** |
| 4 | The existing acceptance route and page take both kinds of token; one 400 `INVITATION_INVALID`; password, e-mail verified, both flags cleared, token spent, audit row — one transaction | target → **P24-09** |
| 5 | Unclaimed → `INACTIVE` 30 days after the **first** invitation (not after import) | target → **P24-09** |
| 6 | Departed upstream performers are never accounts: the import key with "Former upstream user #<n>", or "Upstream import"; an orphan mapping is quarantined `performer_not_found` | **built** (P24-02f, ADR-129 Am. 8, ADR-133 Am. 4) |

## The gap found (M-19)

`services/upstreamImport/transform/users.ts` says the invitation "is the only way in". Read against the code, it is not:

- `auth.service#requestOTP` (`POST /auth/send-otp`) looks the account up by e-mail only and sends a code; `#processResetPassword` sets the password, `isEmailVerified: true` and `mustChangePassword: false`. Neither looks at anything an imported account carries.
- `sso.service#provisionUser` finds `{ email, tenantId }` and signs that account in.
- No column distinguishes an imported account from an administrator-created one with a temporary password, for which the reset is the intended exit (A-123), so refusing on `must_change_password` is not an option.

**Latent:** no deployment holds an imported user. The transform answers 409 `TRANSFORM_NOT_AVAILABLE` until P24-03, and real data is gated by `UPSTREAM_REAL_DATA_ALLOWED`. P24-08 is marked to be done before either changes.

Nothing was changed in code by this card; the gap is recorded in `TASKS/BACKLOG.md` M-19 and P24-08.

## Evidence

A decision record: no test was run or is claimed. The claims about the built parts were read from the code on 2026-10-22:

- `backend/src/services/upstreamImport/transform/users.ts` (the header comment and the `INSERT INTO users` column list: `is_email_verified false`, `must_change_password true`, one `unusable` hash);
- `backend/src/services/auth.service.ts` `requestOTP`, `processResetPassword`, `passwordManagedBy`;
- `backend/src/services/sso.service.ts` `provisionUser`;
- `backend/src/services/invitation.service.ts` and `constants/accessRequest.ts` (`INVITATION_TTL_MS` = 7 days);
- ADR-129 Am. 8 § 2 for the departed-performer numbering.

## Files

- `MEMORY/DECISIONS.md` (ADR-139)
- `docs/UPSTREAM/05-DATA-MIGRATION.md` § 5 (a note naming ADR-139)
- `TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md` (P12-05 DONE; the index row), `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md` (P24-08, P24-09 added), `TASKS/PROGRESS.md`, `TASKS/BACKLOG.md` (M-19)
- `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`, this record
