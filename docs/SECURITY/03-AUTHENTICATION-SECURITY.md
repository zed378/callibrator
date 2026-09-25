# 03 — Authentication Security

Endpoints: [`../API/01-AUTHENTICATION-API.md`](../API/01-AUTHENTICATION-API.md). This document is the security treatment.

---

## Password Login

*As-built after ADR-059 (A-185, 2026-09-24).*

```
POST /auth/login
  ├─ Express rate limit          20 / 15 min
  ├─ sign-in throttle (Redis)    identifier+address: 5 failures / 15 min → 429
  │                              identifier, any address: 100 / hour → 429
  │                              (checked BEFORE the account is looked up)
  ├─ resolve user by username or email
  ├─ verify password — an unknown identifier is compared against a dummy
  │    bcrypt hash, so the timing matches
  │    fail (unknown, wrong password, suspended, locked — all alike)
  │       → count against the throttle → 401 "Invalid credentials"
  ├─ — below here only for the holder of the password —
  ├─ reject a deactivated/suspended/erased account          403
  ├─ reject while users.lockedUntil is in the future        423  (set by the MFA step only)
  ├─ reject if the tenant is suspended or deleted (BR-3)    403
  ├─ clear this identifier+address throttle
  ├─ if mfaEnabled → return an "mfa" purpose token, no session
  ├─ create sessions row: token hash, IP, user agent, device
  ├─ audit_logs LOGIN
  └─ return { data, token, session }   — `data.mfaEnrolmentRequired` for an operator without MFA (P6-07)
```

### Uniform failure

Every failure without the right password returns the same 401 "Invalid credentials" — an unknown
identifier, a wrong password, a suspended or deactivated account, an account the MFA step locked.
Until A-185 a suspended account answered 403 to *any* password, and the fifth wrong password of a
**real** account answered 423 while an unknown one answered 401 forever: two account-existence
oracles.

The same applies to `/send-otp`, which must return an identical response whether or not the address is known.

### Throttling, not lockout (A-185)

A password sign-in never locks an **account**. The fifth failure of one identifier from one address
pauses that identifier **from that address** for fifteen minutes; a hundred failures of one identifier
from any addresses in an hour (NIST SP 800-63B §5.2.2's ceiling) pause it everywhere for an hour. The
keys are the SHA-256 of the identifier as typed (trimmed, lower-cased) plus `req.ip`, so an invented
identifier is paused exactly like a real one. A pause of a real account writes one `ACCOUNT_LOCKED`
audit row (`changes.scope` = `identifier+address` or `identifier`) in that account's tenant.

Until A-185 the fifth wrong password wrote `users.lockedUntil`: anyone who knew a username could lock
its owner out, everywhere, indefinitely. `lockedUntil` is now written only by the MFA step's
per-user budget (A-81), whose attempts already required the password, and it is disclosed (423) only
to a caller who has just proved the password.

**Residuals, accepted:**
- the identifier ceiling can still be triggered on purpose by a distributed attacker (100 requests
  per hour per targeted identifier) — the alternative, no ceiling, gives a botnet unbounded guesses;
- where a deployment's `req.ip` is one proxy address shared by every browser (A-16), the pair
  collapses to the identifier, bounded to fifteen minutes;
- the request that fills a pair for a real account also writes the audit row, a few milliseconds
  of extra work once per window.

## Tokens

```
Authorization: Bearer <jwt>
```

| Variable | Purpose |
|---|---|
| `JWT_ACCESS_SECRET` | signing key |
| `JWT_ACCESS_EXPIRED` | access lifetime |
| `JWT_REFRESH_SECRET` | **must differ from the access secret** |
| `JWT_REFRESH_EXPIRED` | refresh lifetime |

### The browser never holds the access token (A-71)

The backend answers a sign-in with the access token in the body (`token`): its callers are
server-side — the Next.js route handlers, the E2E suite, integrations. The browser reaches only
Next.js (nginx sends `/api/` there), and **no response Next returns to the browser carries an access
token**: `app/api/v1/auth/login` (F-62) and the catch-all proxy (for `/auth/mfa/login` and
`/auth/impersonate`, A-71) write it into the httpOnly `auth_token` cookie and remove `token` and
`refreshToken` from the body. The one token the browser does receive at sign-in is the short-lived
`mfa` purpose token, which works only at `/auth/mfa/login`. A client that needs a bearer credential
of its own uses an API key.

### The `maxAge` defect

The verifier deliberately does **not** pass `maxAge`.

A `maxAge` of `15m` against tokens signed with a one-day `expiresIn` rejected every token fifteen minutes after login and forced a re-login, platform-wide. The token's own `exp` governs; nothing second-guesses it.

Two verification parameters expressing the same idea will eventually disagree, and the one that disagrees silently is the one that causes the outage.

### Separate secrets

If the access and refresh secrets are the same value, an access token can be presented as a refresh token. They must differ, and the config should reject them being equal rather than trusting whoever writes the `.env`.

## Sessions

`sessions` rows are the revocation and audit mechanism (ADR-034). A stateless token cannot answer "revoke this person now" or "which sessions were live on 14 March", and a compliance platform needs both.

| Property | Detail |
|---|---|
| Storage | **hash only** (`token_hash`) — a database read cannot recover a token |
| Binding | **none** — `ip_address`, `user_agent` and `device` are recorded and never compared |
| Revocation | individually, per user in bulk, or by expiry sweep |
| Attributes | **snake_case** — `tenant_id`, not `tenantId` |

### IP binding is a trade-off — and it is not implemented

Corrected **2026-09-23**. This section said `sessionSecurity.middleware.js` was "where the balance is struck". It was not. That file was imported by nothing, and its raw SQL targeted a `"Sessions"` table with camelCase columns (`"isRevoked"`, `"userId"`) against a `sessions` table with snake_case ones, passing `$1` placeholders as `replacements` — Sequelize substitutes those only for `?` and `:name`, so every query in it would have thrown the moment it ran. It was deleted under audit finding A-12, and its tests with it: a passing test over an uninstalled control is a green tick for nothing.

**What is actually true:** there is no IP binding, no user-agent binding, no session fixation protection and no concurrent-session limit. `auth.middleware.js` verifies the JWT and resolves the role, and says so — *"RBAC Only - No Session Validation"*. It does not read the `sessions` table, which is also the mechanism behind the revocation gap below.

**The trade-off is still real, and still undecided.** Strict IP binding breaks legitimate users on mobile networks that rotate addresses, and hospital wifi that hands out a different address per floor. Loose binding weakens the control. A concurrent-session limit has to decide whose session is evicted. These are product decisions, not technical ones, and they are Q-08 in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) — to be answered, not guessed at in an implementation.

## MFA

TOTP. `users.mfaEnabled`, `users.mfaSecret` (migration `0004`).

With MFA enabled, `POST /login` returns a **challenge and no token**; the client completes at `/mfa/login`.

`mfaSecret` must never be returned after enrolment. It is returned once, during `/mfa/setup`, so the user can scan it.

### Platform operators must have MFA (P6-07, ADR-059)

A role at level 10 (`SUPERADMIN`) bypasses every permission check and every tenant predicate, so it
may not work without a second factor. Enforcement is **server-side**, in `auth.middleware`
(`utils/mfaPolicy.util.js#mfaEnrolmentRequired`):

- an operator **without** MFA signs in with the password to an **enrolment-only session**: every route
  but `/auth/mfa/setup`, `/auth/mfa/verify`, `/auth/just-update-password`, `/auth/verify` and the
  two sign-outs answers **403 `MFA_ENROLMENT_REQUIRED`** — impersonation included. The login
  response carries `data.mfaEnrolmentRequired: true` and the frontend goes to the MFA page;
- an operator **with** MFA gets the ordinary challenge; the password alone opens no session;
- an operator never signs in through a tenant's SSO (A-210, `sso.service#provisionUser`, 403): the
  tenant's own administrators configure that IdP.

**Enrolment path for the seeded super admin** (`sys@mail.com`, and any operator created without MFA):
sign in with the password → the MFA page → scan the secret → confirm a code → store the ten recovery
codes. Nothing else works until that is done, and nothing is locked.

**Break-glass** (the only operator lost both the authenticator and every recovery code), in order:
1. the operator's own recovery codes ("use a recovery code" at sign-in);
2. another super admin: `POST /users/:userId/mfa/reset`;
3. last: `node src/scripts/breakGlassMfaReset.js --user <username|email> --requested-by "<name>"
   --ticket <ref>` on the backend host (it needs the database credentials). It clears the enrolment,
   revokes every session and writes an audit row (actor `system:break-glass`, with the name and the
   ticket) in one transaction. **It does not turn the requirement off**: the next sign-in is the
   enrolment-only session again.

The E2E suite signs in as the seeded operator; `src/tests/e2e/setup.js` enrols it on first use and
completes the TOTP step (state file per identifier, `E2E_SUPERADMIN_TOTP_SECRET` to supply a known
secret).

### Tenant "MFA required" policy (A-160) — the two owner questions, decided

- **A passkey does not count.** WebAuthn here is a step-up check inside an existing session; no
  sign-in asks for it. Counting it would let an account satisfy the policy with a factor its
  sign-in never uses. Revisit when WebAuthn becomes a sign-in factor.
- **An SSO session answers to its identity provider's MFA.** A SAML/OIDC session is marked
  (`sessions.auth_method`, migration `0052`; the access token's `amr` claim, kept through a refresh)
  and is not asked to enrol a local TOTP that its sign-in would never ask for. A tenant that
  requires MFA must require it at its IdP. Password sessions of the same users are still held to the
  policy.

## WebAuthn

`users.webauthnEnabled`, `webauthnCredentialId`, `webauthnPublicKey`, `webauthnSignCount` (migration `0014`).

| Variable | Requirement |
|---|---|
| `WEBAUTHN_RP_ID` | the registrable domain — **no scheme, no port** |
| `WEBAUTHN_ORIGIN` | must match the browser origin **exactly** |

Both are exact-match by specification. A trailing slash, a missing port, or `https` where the browser sent `http` fails verification with an error that does not name the mismatch — which makes it a long debugging session.

### Challenges live in Redis

Not in process memory. A challenge issued by one replica must be verifiable by another, and this is one of the three hard prerequisites for running more than one backend replica.

Short TTL, single use. A challenge that can be replayed is not a challenge.

### The sign count must be checked

The authenticator increments a counter on each use. A response carrying a counter **lower than or equal to** the stored value indicates a cloned authenticator and must be rejected.

Storing `webauthnSignCount` without comparing it is storing a defence nobody applies.

## Changes That Need Fresh Re-Authentication (ADR-068)

Holding a session is not enough to change what protects the account. The rule is A-114's, shared as
`auth.service#reauthenticate`:
- the current password is required;
- on an MFA account, a current TOTP code or a recovery code is required as well;
- the code is spent inside the change's transaction;
- a wrong password and a wrong code give one combined 400.

The rule applies to:

| Change | Also |
|---|---|
| MFA rotate or disable (A-114, A-141) | other sessions revoked |
| Passkey removal, `POST /webauthn/disable` (A-213) | audited `WEBAUTHN_DISABLE` in the transaction |
| Own email, `PUT /gdpr/rectify {field: "email"}` (A-214) | audited `GDPR_RECTIFICATION` with `reauthenticatedWith`; the previous address is told |
| Own password, `POST /auth/just-update-password` | the current password only; every session is revoked |

A session that signed in through SSO (`amr` of `saml` or `oidc`) cannot change the password or the
email here (A-216). It gets a 409 that names the identity provider, and `/auth/verify` returns
`passwordManagedBy` so the page explains instead of showing the form. An account under the A-123
forced change is exempt.

**An administrator's password expires 72 hours after it is issued** (A-215): the create, or
`POST /users/:userId/password/reset`. The column is `users.temporary_password_expires_at` (migration
`0078`). Past it, sign-in gets the same 401 "Invalid credentials" as a wrong password, counted by the
same throttle, and the administrator issues a new password.

**Every signed-in check of one's own password is budgeted (A-260, ADR-072).** It covers
`POST /auth/pass-is-valid`, the change-password route, and every re-authentication above: the MFA
rotation and disable, the passkey removal and the email change. The code path is
`auth.service#verifySessionPassword`.
- The budget is one per user across all of them (`AUTH_ENDPOINTS.passwordCheck`): five wrong
  passwords in fifteen minutes.
- The attempt that spends it signs out the session that made it. It writes `ACCOUNT_LOCKED` (actor
  `system:auth-lockout`, `changes.scope` `session-password-check`) in the same transaction, apart
  from the change being re-authenticated, so the row survives that change's rollback.
- That attempt, and every check until the window ends, gets 429 with `Retry-After`. The password is
  not compared while the budget is spent.
- The budget never writes `users.locked_until`, because the guesser already holds a session.
- The right password clears the count.

**An administrator can remove another user's passkey (A-262):** `DELETE /users/:userId/webauthn`.
It has the same guards as the MFA and password resets: another tenant's user or a missing one is 404,
oneself is 400, and a higher role is 403. It revokes every session of the user and is audited
`WEBAUTHN_ADMIN_RESET` in its transaction. It is the way out for an SSO-only user, who has no password
to re-authenticate the self-service removal with.

## OTP and Password Reset

`otpCode`, `otpExpiredAt`, `otpRequestCount`, `otpLastRequestedAt`.

| Limit | Value |
|---|---|
| OTP request | 5 / hour (Express), 3 / 15 min with lockout (Redis) |
| Reset attempt | 5 / 5 min |

An activation link verifies **the address it was mailed to** (A-191): the token carries the SHA-256
of that address (`eh`, `utils/activationToken.util.js`), and `activateAccount` refuses it once the
account's address has changed — a registration link never followed no longer verifies an address
rectified after it was sent. Verifying is audited (`EMAIL_VERIFIED`). Verification stays
informational at login (ADR-051 Q-11): every provisioning path the platform controls marks the
address verified, and historic admin-created rows were stored unverified by a defect, so enforcing
it would lock out real users with no way to tell them apart.

An OTP must be single-use and cleared on use. An OTP that remains valid until expiry after being consumed is a replayable credential.

## Federation

### As a relying party

SAML and OIDC, with **per-tenant callbacks** (`/sso/callback/:tenantCode`) because each tenant may federate with its own identity provider and a shared callback cannot tell which IdP an assertion came from.

Trust configuration is per tenant. A misconfigured tenant IdP compromises that tenant, not the platform — which is the correct blast radius and worth preserving. That is also why a platform operator never signs in through one (A-210).

**OIDC endpoints come from discovery (A-188).** `oidc_authority` is the issuer base; the endpoints,
the JWKS location and the issuer the ID token is checked against are read from
`<authority>/.well-known/openid-configuration` (cached an hour). For Microsoft Entra ID configure
`https://login.microsoftonline.com/<directory-id>/v2.0` (the older
`…/<directory-id>/oauth2/v2.0` form is read the same way). A **multi-tenant** authority (`/common`,
`/organizations`) is refused: through JIT provisioning it would admit any directory's users into the
hospital. An IdP that answers the discovery URL with 404 gets the endpoints this client always
derived. A **public client** (no `oidc_client_secret`) sends no `client_secret` — PKCE is its proof.

A refused callback (state, IdP answer, suspended account, SSO not enabled) redirects the browser to
`/login?error=<code>` — `sso_state`, `sso_unavailable`, `sso_account_refused`, `sso_failed`,
`sso_error` — and the reason is logged; the JSON envelope is never rendered as a page. An SSO
sign-in stamps `users.last_login_at`.

### As a provider

Discovery and JWKS are **public** and served at the issuer root (`/oidc/.well-known/...`), not under `/api/v1`, because that is where relying parties look.

Client secrets are rotatable (`POST /clients/:clientId/rotate-secret`) — rotation without re-registration is what makes rotation actually happen.

## Impersonation

`POST /auth/impersonate` (`SUPERADMIN`) and `/impersonate/exit`.

Real support power, and the audit requirement is strict: **an impersonated session must be distinguishable in the trail from the user acting themselves.** Otherwise the trail attributes an operator action to a customer, which is worse than having no trail — it is a wrong trail that looks right.

Both transitions are audited.

## Socket Authentication

`POST /auth/socket-token` mints a short-lived token for the Socket.IO connection.

The access token is not handed to a transport that keeps it in memory for the life of a connection. A long-lived credential in a long-lived connection is a long-lived exposure.

## Error Messages

| Situation | Response |
|---|---|
| Bad credentials — unknown identifier, wrong password, suspended or locked account | 401 "Invalid credentials", uniform (A-185) |
| The right password, account suspended | 403 "Account is suspended" |
| The right password, account locked by the MFA step | 423 "Account temporarily locked" |
| Sign-in paused (identifier+address, or identifier) | 429, identical for unknown identifiers (A-185) |
| Expired token | 401 **"Invalid token"** |
| Suspended tenant | 403 "Tenant account is suspended" |
| Operator without MFA, or tenant policy | 403 `MFA_ENROLMENT_REQUIRED` (P6-07, A-160) |
| Rate limited | 429 with `X-RateLimit-*` |

An expired token reporting "Invalid token" rather than a distinct message is a known cosmetic wart, left alone deliberately: changing it churns a fully-covered unit suite for no security or usability gain. Recorded so the next reader does not treat it as a bug to chase.
