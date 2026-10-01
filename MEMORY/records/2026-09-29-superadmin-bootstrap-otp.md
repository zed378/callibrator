# 2026-09-29 — P10-16: the first super admin gets a one-time password, revealed only inside the container

**Task:** P10-16 (TASKS/PHASE-10-LANDING-AUTH-REVAMP.md; auth work filed in Phase 10). The card was drafted as "P10-14"; that ID and P10-15 were already taken, so it was renumbered on 2026-09-30.
**Decision:** ADR-099 · **Spec:** [`specs/P10-16-superadmin-bootstrap-otp.md`](../specs/P10-16-superadmin-bootstrap-otp.md)
**Authority:** owner request (2026-09-29), plus the owner's follow-up decision the same day that the value is visible only inside the container.

## What was wrong

- `migration.service.js` seeded `sys@mail.com` with the public password `123123`.
- **Every** `GET /migration/seeding` re-hashed `123123` onto the existing account, so re-seeding reset the platform operator to a public password.
- No mechanism existed for a password that works exactly once. A-123/A-215 temporary passwords keep signing in, through a route-gated normal session, until they are changed.

## What changed

| Area | Change |
|---|---|
| Schema | Migration `0094-user-password-one-time.ts`: `users.password_one_time BOOLEAN NOT NULL DEFAULT false`, in the manifest. `User.passwordOneTime`, plus a `beforeSave` hook that clears it when the password changes without it |
| Bootstrap | `services/bootstrapCredential.service.ts#ensureSystemSuperAdmin`, called by `seedUsers`. Creates the system super admin only when none exists: 24-character CSPRNG password, hash only, one-time + must-change + 72 h expiry. The audit row (`system:bootstrap`) and the file write sit inside the creating transaction. **Never** touches an existing account's credential |
| Reveal | `utils/bootstrapSecret.util.ts`: `storagePath(".bootstrap/superadmin-password")` = `/app/.bootstrap/superadmin-password` in the image. The Dockerfile creates it `app:app 0700`, not a volume. The file is written `wx` 0600 plus chmod. Stdout gets a pointer line only; the seed response carries the path only. Local tsx runs use `backend/.bootstrap/`, which is gitignored |
| Boot | `index.js` → `runBootChecks()` after the role switch: a super admin still on the retired `123123` is rotated to a one-time password; a file no account can use is deleted. It never refuses the boot |
| First sign-in | Hook in `auth.service.js#loginUser`, after every refusal check and after the A-288 sign-in policy (agreed with the security agent). `firstSignIn`: one conditional UPDATE (`WHERE password_one_time = true`) sets the flag false and the expiry to now, in one transaction with `ONE_TIME_PASSWORD_CONSUMED`. The file is deleted. The answer is a `password-change` purpose token (10 min, `pf` binds it to the hash). No session, no refresh token |
| Change | `POST /api/v1/auth/first-sign-in/password` (public; `controllers/firstSignIn.controller.ts`; `firstSignInPasswordSchema`). Token plus Zod password rule. The new password must differ from the one-time one. A conditional update on the old hash clears every flag, revokes sessions and writes the audit row in one transaction. The answer is "sign in again" |
| Recovery | `src/scripts/rotateBootstrapPassword.ts`: `npm run bootstrap:rotate`, or `./backend rotate-bootstrap-password` inside the container (`scripts/cliDispatch.ts`, dispatched by `index.js`). Super admins only, `--requested-by` and `--ticket`, audited, revokes sessions, writes the file, prints the path only |
| Tokens | `TokenPurpose` gains `"password-change"` (`types/auth.ts`, `jwt.util.ts` PURPOSE_TOKEN_TYPES, 10m). `verifyAccessToken` refuses it, so `auth` refuses it everywhere |
| Frontend | The login route passes `data.passwordChangeRequired` through as a 202 with no cookie. `authStore.login` returns `{ passwordChangeRequired, passwordChangeToken }`. `useLoginForm` shows `FirstPasswordChangeForm`: labelled, `autocomplete="new-password"` ×2, the rule up front, mismatch announced, `role="alert"` errors, non-enumerating 401 copy. It then signs in with the new password, and P6-07 MFA enrolment follows. `api/client.ts`: the endpoint is a credential endpoint (a 401 there triggers no refresh or redirect) |
| Reviewed lists | `constants/routeGateExemptions.ts` (PUBLIC), `denyPlatformAuthoring.a127` NOT_GUARDED, `unboundedFindAll.d24` REVIEWED (`[1, CLOSED]`), `systemActors.a124` closed list (`system:bootstrap`) |
| E2E / automation | `tests/e2e/setup.js` exports `OPERATOR` / `OPERATOR_PASSWORD` (from `E2E_OPERATOR_PASSWORD`, **no default**; refuses to load without it). It completes the bootstrap itself from `E2E_BOOTSTRAP_PASSWORD`. All 50 specs that hard-coded `123123` now use `OPERATOR_PASSWORD`. `liveContract.smoke` falls back to `E2E_OPERATOR_PASSWORD`. `automate/smoke.browser.js` and `a11y.browser.js` read it from the harness |
| Docs | `deploy/README.md` § First Boot (the operator procedure, and an After-Deployment check), `docs/BACKEND/11-CONFIGURATION.md`, `docs/BACKEND/10-MODULE-REFERENCE.md`, `docs/SECURITY/03-AUTHENTICATION-SECURITY.md`, the swagger example (`src/docs/components.js`, `swagger.json`, `openapi.json`), `.gitignore` |

`CLAUDE.md` and `AGENTS.md` do not mention `sys@mail.com` or `123123`, so they are unchanged. The main session's own memory file `browser-verification-access.md` (sys@mail.com / 123123) is now wrong, and the main session updates it.

## Operator procedure (VM, compose)

The VM seeds with a momentary `ALLOW_SEEDING=true` and `GET /api/v1/migration/seeding`:

1. The seed response shows `"bootstrapPasswordFile": "/app/.bootstrap/superadmin-password"`, the path only. `docker logs` shows only the pointer line.
2. `docker exec <backend-container> cat /app/.bootstrap/superadmin-password` reads it.
3. Within 72 h, sign in at `/login` as `sys@mail.com` with it. The page asks for a new password at once, and the file is deleted. Then sign in with the new password and enrol MFA.
4. **On the existing VM** (seeded with `123123`), the first boot of this version rotates the operator to a one-time password, provided the hash still matches `123123`. `docker logs` shows the pointer; follow steps 2–3. If the operator had already changed the password, nothing happens.
5. Lost or expired: `docker exec <backend-container> ./backend rotate-bootstrap-password --user sys@mail.com --requested-by "<name>" --ticket <ref>`, then step 2.

## Evidence

Backend (Node 26, `npm test -- --coverage=false <file>`, 2026-09-29/30):
- `src/tests/services/bootstrapCredential.p1016.test.ts`: **42 passed**. Over the real models, hooks, audit service, jwt util and the real `auth.service#loginUser` (memoryDb). It covers:
  - creation with the hash only, the flags and the 72 h expiry;
  - the CREATE audit row in the same transaction;
  - rollback when the file write fails, and file removal when the commit fails;
  - the seed service reporting the path only, and re-seed idempotence (a changed password kept, a soft-deleted user restored, nothing created when another super admin exists);
  - retiring the default (only the `123123` holder, sessions revoked, idempotent), the stale-file sweep, and `runBootChecks` never throwing;
  - first sign-in giving a token and no session (the token refused as access, and refused as `mfa`), with the flag and the audit row in one transaction and the file deleted;
  - a second sign-in giving a 401 identical to a wrong password;
  - a **concurrent double sign-in giving exactly one token**, with one consumption audit row;
  - an expired unused password refused;
  - the change's happy path: flags cleared, sessions revoked, audit in the transaction, and a normal sign-in then giving `mfaEnrolmentRequired`;
  - the change token being single-use, and a concurrent double change giving exactly one success;
  - refusal of the one-time password as the new one, of three policy failures, of a missing body, and of seven forged or wrong-purpose tokens;
  - a stale token after a CLI rotation;
  - the CLI's 400/404/403 refusals, its rotation audit (requestedBy/ticket), a re-issue keeping the flag, a no-tenant account audited under PLATFORM, and rollback on write or commit failure;
  - CLI stdout carrying the path only, the stderr refusal, and the dispatch;
  - the model hook.
  
  **Every test asserts the plaintext is absent** from every logger call, every `process.stdout`/`stderr` write, every table (`mdb.dump()`), every returned value and `process.env`.
- `src/tests/utils/bootstrapSecret.p1016.test.ts`: **13 passed, 1 skipped**. It checks the generator (length 24, the 61-character alphabet with no ambiguous characters, every class in 2,000 draws, no repeats, `crypto.randomInt`-only) and the file (content, `wx`/0600/0700/chmod asserted through the fs calls, overwrite, remove, ENOENT tolerated, other errors thrown, a pointer without the value). The **real 0600 mode check is POSIX-only and was skipped on this Windows host**: not run.
- `src/tests/middlewares/auth.passwordChangeToken.p1016.test.ts`: **19 passed**. The real jwt util and auth middleware return 401 on 15 sampled routes, including every PASSWORD_CHANGE_ALLOWED and MFA_ENROLMENT_ALLOWED route; no session or user lookup happens; optionalAuth ignores the token; the purpose is exclusive and the TTL is 600 s.
- `src/tests/controllers/firstSignIn.p1016.test.ts`: **4 passed**. The controller, plus the route mounted with no auth middleware.
- `src/tests/services/migration.service.test.js`: 39 passed (the seedUsers cases rewritten to the delegation). `src/tests/constants/systemActors.a124.test.js` passed.
- Mutation check: removing `passwordOneTime: true` from the consume UPDATE's WHERE failed "of two concurrent sign-ins … exactly one gets a token" and "firstSignIn called directly … already consumed". Restored.
- Coverage of the new modules (targeted run): `bootstrapCredential.service.ts`, `bootstrapSecret.util.ts` and `firstSignIn.controller.ts` are each at 100% statements, branches, functions and lines.
- `npm run typecheck`: no error in any file of this change. The remaining errors are in other agents' in-flight files: 0095, 0097, effectivePermission, sso.service.ts, multipartSanitizer and certificate.separationOfDuties. `npx eslint`: 0 errors on every changed file. `npm run ratchet`: at the floor.
- **Full `npm run test:coverage -- --ci` is NOT green, and not because of this change.** The run on 2026-09-29 had ~40 failing suites from concurrent in-flight work: the A-288 `signInPolicy` hook in mocked auth suites, the access-request, menu and migration-manifest work. The three failures this change caused (d24, a127, p604) were fixed and re-run. The global 100% gate could not be quoted from a quiet tree.
- With `signInPolicy` stubbed (a scratch jest config), the auth suites give 32/34 suites passing. The two failures are IP rate-limit cases (`auth.rateLimit.a67`, `auth.ssoExchange.a60`) on routes this change does not touch.

Frontend (`npx jest`, 2026-09-30): `useLoginForm.p1016.test.tsx` 7, `FirstPasswordChangeForm.p1016.test.tsx` 13, `login/route.p1016.test.ts` 1; `src/stores src/api src/app/login src/app/api/v1/auth`: **83 suites, 893 tests passed**. `npx eslint` is clean. `npm run typecheck` shows one error, in `components/landing/ComplianceSection.tsx`, which is not this change.

**Live check: not done.** No local stack was brought up in this session, so the image build (the Dockerfile `/app/.bootstrap` line), the binary subcommand `./backend rotate-bootstrap-password`, and a real sign-in through nginx and Next are **unverified**. The live E2E suite was not run. It now needs `E2E_OPERATOR_PASSWORD`, plus `E2E_BOOTSTRAP_PASSWORD` on a fresh stack.

## Left open

- Live verification on a compose stack: the image, the subcommand, the first sign-in in a browser, and the pointer in `docker logs` with no value (BACKLOG § Unverified Claims).
- Whether A-123 administrator temporary passwords should also be one-time (BACKLOG, owner decision).
- The concurrent loser's 401 is not counted by the login throttle (accepted, ADR-099).
- Helm, multiple replicas: the file lives in one pod (documented; Helm is not known to deploy).
- Comment tags "P10-14" remain in `auth.service.js/.ts` (the P9 lead's), `invitation.service.ts` (the access-request agent's) and `useLoginForm.ts` (the Phase 10 frontend lead's). Each owner has been asked to change them to P10-16.

---

## Amendment 1 — 2026-09-30: every administrator-set password is one-time (Q-49); demo seeding refused in production

**Authority:** the coordinating session decided Q-49 = YES under the owner's delegation. It awaits the owner's confirmation. ADR-099 Amendment 1.

**Changed**
- `backend/src/services/user.service.ts`: two option additions, agreed with the P9 lead. `userCreate` → `Users.create(values, { transaction, oneTimePassword: true })`. `resetUserPassword` → `user.update({...}, { transaction, oneTimePassword: true })`. The reset's temporary password is still shown once in the administrator's response, and nowhere else.
- `backend/src/models/user.model.ts` beforeSave: when the password changes, `passwordOneTime = options.oneTimePassword === true || (the attribute was set true in this save)`. The option is read through a narrow local interface. `backend/src/types/sequelize.d.ts`: `oneTimePassword?: boolean` on SaveOptions, CreateOptions and InstanceUpdateOptions.
- `backend/src/services/bootstrapCredential.service.ts`: its create passes the option too.
- `backend/src/services/migration.service.js`: `assertDemoSeedingPermitted()` gives 403 under `NODE_ENV=production` and is the first line of `seedDemoData`, so it covers the route, the controller and `scripts/seedDemo.js`. No other seeder hard-codes a password; `scripts/load/p807-seed.sql` copies the demo admin, so it is development-only too.
- `deploy/README.md`: § Closing deploy: the one-time password, verified live. Seven steps with exact docker/curl commands; this is the U-08 procedure.
- BACKLOG Q-49 marked decided, U-08 linked to the procedure. The card DoD and abuse cases are updated.

**Frontend:** no code change was needed, because admin-created and admin-reset accounts now get the same first-password step at /login. The 401 copy in `useLoginForm.ts` ("ask your platform operator") must become audience-neutral ("ask your administrator"). I asked the Phase 10 frontend lead, who holds that file.

**Evidence** (`npm test -- --coverage=false`, 2026-09-30)
- `backend/src/tests/services/adminTemporaryPassword.p1016.test.ts`: **8 passed**. Real user.service, auth.service#loginUser, bootstrapCredential.service and the User hooks over memoryDb:
  - admin reset: the first sign-in gives a token with no session, the second gives a 401, the change completes, and normal sign-in follows; the temporary password appears in no logger call, stdout/stderr write or table;
  - a second reset of an already one-time account keeps it one-time;
  - an admin-created account: the first sign-in gives a token and no session, the second gives a 401, and the admin's password is in no log or table;
  - the model hook in both directions (the option on an already-flagged account keeps the flag; the holder's own change clears it; a non-password save leaves it);
  - demo seeding refused under production (`assertDemoSeedingPermitted`, and `seedDemoData` rejecting 403 with no write).
- **Fail-before:** with the two `oneTimePassword: true` options removed from user.service.ts, 3 of the 8 fail (reset first sign-in, re-reset, admin-created first sign-in). Restored.
- Existing suites: `src/tests/services/user*`, `src/tests/models`, `src/tests/routes/user*`, bootstrapCredential.p1016 and migration.service give 1437 of 1438 passing. The one failure is `models/associationForeignKeys.a148` on `certificates.submitted_by`, another agent's in-flight migration 0095. **No user.service assertion needed updating.**
- `npm run typecheck`: no error in user.model.ts, user.service.ts, sequelize.d.ts, bootstrapCredential or migration.service. `npx eslint`: 0 errors on the changed files.

**Still open:** the live check (U-08, procedure written); wiring userCreate to the invitation link where mail works (P10-15's lane); the frontend 401 copy (Phase 10 frontend lead).
