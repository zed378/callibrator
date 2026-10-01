# Feature Spec — P10-16 First super admin: one-time bootstrap password

**Written:** 2026-09-29 — **before** implementation
**Task:** P10-16 (TASKS/PHASE-10-LANDING-AUTH-REVAMP.md)
**Decision record:** ADR-099
**Spec refs:** docs/SECURITY/03-AUTHENTICATION-SECURITY.md · docs/SECURITY/05-MULTI-TENANCY-SECURITY.md · docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md · MEMORY/specs/A-41-audit-inside-transaction.md · ADR-051 Q-11 (A-123) · ADR-068 (A-215) · P6-07

## Owner request (2026-09-29)

> The first superadmin is created (ingested) with a randomly generated password string, used for the first login only; the password must be changed after login; the random password expires immediately once it has been used for the first login.

Owner decision, added the same day: the plaintext is visible **only inside the container**. It must not appear on stdout or stderr, in any API or seed response, in the audit log, in the database (hash only) or in an environment variable. It goes into a mode-0600 file owned by the app user, at a path that is neither a bind mount nor a volume. The operator reads it with `docker exec <backend> cat <path>`. Stdout gets a one-line pointer at most. The file is deleted when the password is consumed and is never rewritten for an existing super admin. The recovery CLI follows the same rule.

## What the code does today (as-built, 2026-09-29)

| Fact | Source |
|---|---|
| The super admin is created by `GET /api/v1/migration/seeding`, gated by `superAdminOrBootstrap` (`ALLOW_SEEDING=true`), through `migration.service.js#seedUsers` | `routes/internal/migration.route.js:42,200` |
| `DEFAULT_SYSTEM_USERS` hard-codes `sys@mail.com` / `sys` / **`123123`** | `migration.service.js:201–215` |
| **Every** seed call re-hashes `123123` onto the existing `sys@mail.com`, so re-running the seed resets the super admin's password to the public default | `migration.service.js#seedUsers` (`existing.update(fields)`) |
| An administrator's temporary password sets `mustChangePassword` (A-123) and `temporaryPasswordExpiresAt` (A-215, 72 h). A correct one yields a **normal session**, and the auth middleware then refuses every route except `PASSWORD_CHANGE_ALLOWED` | `user.service.js#resetPassword`, `auth.middleware.js:114,171,326` |
| An expired temporary password is refused as the same 401 as a wrong one, counted by the throttle | `auth.service.js#loginUser` (`temporaryPasswordExpired`) |
| Purpose tokens (`typ` ≠ `access`) are refused by `verifyAccessToken`, so `auth` refuses them on every route | `utils/jwt.util.ts` (A-59) |
| A platform operator without MFA gets an enrolment-only session (P6-07) | `auth.service.js#loginUser` `mfaEnrolmentRequired` |
| The Next login route passes a 202 or `data.mfaRequired` body through without writing cookies | `frontend/src/app/api/v1/auth/login/route.ts` |
| The container image runs a pkg binary with no Node, and nothing under `/app` is writable by the app user except the listed directories | `backend/Dockerfile` |

**Reuse decision.** The A-123/A-215 mechanism (flag plus expiry) is sound, and it is reused for the *after* state. It does not meet the owner's "first login only", though: an A-123 password keeps signing in until it is changed, and each sign-in opens a normal (gated) session. A one-time password needs a separate marker. That marker is `users.password_one_time`.

## Design

### States of the super admin's credential

| State | `password_one_time` | `must_change_password` | `temporary_password_expires_at` | Password sign-in |
|---|---|---|---|---|
| **Issued** (bootstrap or CLI rotation) | true | true | now + 72 h | the one-time password → **restricted token**, no session |
| **Consumed** (first sign-in succeeded) | false | true | **now** (expired) | every password → 401, the same as a wrong one |
| **Changed** | false | false | null | the new password → normal login (P6-07 MFA enrolment) |
| Issued but unused for 72 h | true | true | past | 401 (A-215 path); recover with the CLI |

### Bootstrap (seed)

`seedUsers` → `bootstrapCredential.ensureSystemSuperAdmin()`:
- If `sys@mail.com` exists, restore it if it was deleted and refresh its profile fields. **Never** touch `password`, `password_one_time`, `must_change_password` or the expiry. This makes the seed idempotent, and it closes the reset-to-`123123` defect.
- Else, if any live super admin exists, create nothing.
- Else, generate a password (below), create `sys@mail.com` in state **Issued** (hash only), and write the audit row (`CREATE User`, actor `system:bootstrap`, `changes` carrying no secret) in the same transaction. Write the secret file **inside** that transaction, so a failed write rolls the creation back. If the commit fails after the write, delete the file.
- Log exactly one line: `Bootstrap password for sys@mail.com written to <path> inside the container (host <hostname>)`. The value never appears.
- The seed response reports `{ bootstrapPasswordFile: <path> }` and never the value.

### Retiring the known default on existing databases (boot)

The retired default `123123` stays in the code for one purpose only: a boot step compares it against the hash of every live super admin that is not already one-time (bcrypt, one compare per super admin). On a match it rotates that account to state **Issued** (same transaction, audit row, file, pointer line). This covers existing deployments, the VM included. It runs after `enterApplicationRole`, and it does not block boot on failure: an error is logged without the value.

### Generator

`crypto.randomInt` over an alphabet with the ambiguous characters removed (`0 O o 1 l I i`): 24 upper, 23 lower, 8 digits, 6 symbols (`-_.@+=`), 61 characters in all. The length is **24**, with at least one character from each class, placed by a uniform permutation (draw without replacement) that also uses `randomInt`. The entropy is 24·log2(61) ≈ 142 bits, of which the class constraint costs less than 3. The result also passes the Zod password rule (upper, lower, digit).

### Secret file

`storagePath(".bootstrap", "superadmin-password")`. In the image that is `/app/.bootstrap/superadmin-password`: a directory created in the Dockerfile, `app:app`, mode 0700, **not** a volume in compose or Helm. For a local `tsx` run it is `backend/.bootstrap/superadmin-password`, which is gitignored. The content is the password followed by a newline. Any old file is removed first, then the new one is written `wx` with mode 0600 and `chmod`ed to 0600, because umask can only narrow the mode and the explicit chmod makes it exact. The file is deleted on consumption, and a boot sweep deletes it when no account holds an unexpired one-time password.

Multi-replica caveat (Helm): the file lives in the pod that ran the seed or the CLI. Seed with one replica, or `kubectl exec` into the pod named by the pointer line's hostname. A consumption handled by another pod cannot delete the file, but the boot sweep in that pod will.

### First sign-in

`auth.service.js#loginUser` gets one hook, after the password, account-state, lock and tenant checks and after `clearLoginThrottle`: `if (dbUser.passwordOneTime) return bootstrapCredential.firstSignIn(...)`. Then:
1. In one transaction: a **conditional** `UPDATE users SET password_one_time=false, temporary_password_expires_at=now WHERE id=? AND password_one_time=true`, plus an audit row (`UPDATE User`, `operation: ONE_TIME_PASSWORD_CONSUMED`). If the update touches no row, a concurrent sign-in won, and this caller gets `401 Invalid credentials`, word for word the wrong-password answer.
2. After the commit, delete the secret file.
3. Answer `200` with `data: { id, username, email, passwordChangeRequired: true }`, `token` = a purpose token `typ: "password-change"` (10 min, claims `id` and `pf` = SHA-256 of the stored hash, which binds it to this credential state), `refreshToken: null` and no session. `verifyAccessToken` refuses the token, so `auth` answers 401 on every route.

### Change password

`POST /api/v1/auth/first-sign-in/password` is public, and `{ token, newPassword }` is Zod-validated with the existing password rule:
- The token must verify as `password-change`. The user must exist, and the state must be `must_change_password = true`, `password_one_time = false`, with `pf` matching the current hash. Anything else gets **401** `Invalid or expired password-change token`.
- The new password must not equal the one-time password (bcrypt compare against the stored one-time hash), else **400**.
- One transaction: a conditional update `WHERE id=? AND password=<old hash>` sets the new hash, `must_change_password=false`, `temporary_password_expires_at=null`, `password_one_time=false` and `password_changed_at=now`, and revokes all sessions. If no row changes, the answer is 401: a double submit loses. The audit row is `PASSWORD_CHANGE {forced:true, method:"one_time_password"}`.
- Answer `200 { data: { signInRequired: true } }`. The client then signs in with the new password, and P6-07 sends the operator to MFA enrolment.

### Recovery CLI

`src/scripts/rotateBootstrapPassword.ts --user <email|username> --requested-by "<name>" --ticket <ref>`. It refuses anyone who is not a super admin. In one transaction it moves the account to state **Issued**, revokes every session, writes an audit row (`system:bootstrap`, `requestedBy`, `ticket`) and writes the file. It prints only the pointer.
- Host: `npm run bootstrap:rotate -- --user …`
- Container: `docker exec <backend> ./backend rotate-bootstrap-password --user …` (index.js dispatches this before the server starts).

### Model invariant

A `beforeSave` hook on `User` sets `passwordOneTime = false` whenever `password` changes and `passwordOneTime` was not set in the same save. Every existing password writer (e-mail reset, justUpdatePassword, admin reset, SCIM, SSO) therefore leaves the account non-one-time, with no edit to those services.

### Frontend

- The login route also passes `data.passwordChangeRequired` through without cookies.
- `authStore.login` returns `{ passwordChangeRequired, passwordChangeToken }`.
- `useLoginForm` swaps to a `FirstPasswordChangeForm`: two fields, both `autocomplete="new-password"`, labelled; errors in a `role="alert"` region; the policy stated up front. On success it signs in with the new password and routes as usual (`mfaEnrolmentRequired` → MFA page).

## Decisions (with alternatives)

1. **The file, not a log line and not the response.** This is the owner's decision; `docker logs` and API responses leave the container.
2. **Expire in place, don't burn the hash.** Setting the expiry to *now* reuses A-215's refusal path, so the second sign-in is exactly the wrong-password 401, throttle included. It also keeps the hash, which the "must differ" check needs. Burning the hash would lose that check, and holding the one-time value anywhere else would be a second secret.
3. **Restricted token rather than a gated session.** The owner said "no normal session". A purpose token is refused by `auth` on every route, so no allow-list is involved.
4. **TTL of 72 h** for an unused bootstrap password, the same as A-215. After it, use the CLI.
5. **No `SUPERADMIN_BOOTSTRAP_PASSWORD` override.** The owner forbids the value in environment variables. Tests call the service directly. The E2E harness completes the bootstrap from `E2E_BOOTSTRAP_PASSWORD`, which the operator reads with `docker exec … cat`, and it sets `E2E_OPERATOR_PASSWORD`.

## Tests (TypeScript)

- `bootstrapSecret.p1016.test.ts`: the generator (length, classes, no ambiguous characters, uniqueness over 2,000 draws, alphabet size, a `randomInt`-only source); the file (0600 and `wx` passed to fs, chmod, deleted on remove, `ENOENT` tolerated); the real mode on POSIX.
- `bootstrapCredential.p1016.test.ts` (over `memoryDb`): create when none exists (hash only, flags, expiry, audit row in the transaction, file written, pointer logged, value in no log call and no stdout write); idempotent re-seed (no file, no hash change, profile restored); another super admin present (nothing created); the file write fails (rolled back); retire the default (rotates only a `123123` hash); the stale-file sweep.
- `bootstrapFirstSignIn.p1016.test.ts`: the one-time password gives a restricted token and no session; the flag cleared and the expiry set, in one transaction with the audit row; the file deleted; a second sign-in gets the same 401 body as a wrong password; a concurrent double sign-in yields exactly one token; the restricted token refused by `auth` on several routes; change-password happy path (flags cleared, audit row, sessions revoked, token dead afterwards); unhappy paths (bad token, wrong `typ`, reused token, same as the one-time password, fails policy, stale `pf`).
- `rotateBootstrapPassword.p1016.test.ts`: refuses a non-super-admin; rotates, revokes sessions, audits and writes the file; prints only the pointer.
- `user.passwordOneTime.p1016.test.ts`: the model hook.
- Frontend: `FirstPasswordChangeForm.p1016.test.tsx`, `useLoginForm.p1016.test.tsx`, and the login route pass-through test.

## Addendum (2026-09-30) — Amendment 1, Q-49

Decided after this spec: **every administrator-set password is one-time.** `userCreate` and `resetUserPassword` save with `{ oneTimePassword: true }`, and the `User` `beforeSave` hook sets the flag from that option (or from an explicit `true` in the same save), clearing it on any other password write. The first sign-in and the change are exactly the flow above. The demo seeder is refused under `NODE_ENV=production`. See ADR-099 Amendment 1 and the record's Amendment section. The live verification procedure is `deploy/README.md` § Closing deploy (U-08).
