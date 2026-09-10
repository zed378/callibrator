# 03 — Authentication Security

Endpoints: [`../API/01-AUTHENTICATION-API.md`](../API/01-AUTHENTICATION-API.md). This document is the security treatment.

---

## Password Login

```
POST /auth/login
  ├─ Express rate limit          20 / 15 min
  ├─ Redis endpoint limit        5 / 15 min, with lockout
  ├─ resolve user by email
  ├─ reject if tenants.status = 'suspended'         (BR-3)
  ├─ reject if users.lockedUntil is in the future
  ├─ verify password
  │    fail → failedLoginAttempts++ → maybe lockedUntil → 401
  ├─ reset failedLoginAttempts
  ├─ if mfaEnabled → return a challenge, no token
  ├─ create sessions row: token hash, IP, user agent, device
  ├─ audit_logs LOGIN
  └─ return { data, token, session }
```

### Uniform failure

Bad credentials always return the same 401 regardless of whether the account exists. Distinguishing them is an account-existence oracle.

The same applies to `/send-otp`, which must return an identical response whether or not the address is known.

### Lockout

`failedLoginAttempts` and `lockedUntil` on the user row, plus a Redis counter that can lock and revoke.

Lockout is a denial-of-service vector against a known account — an attacker who knows an email can keep that user locked out. The counter is per account **and** per source; a lockout that only counts by account hands an attacker a cheap denial tool.

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
| Binding | `ip_address`, `user_agent`, `device` |
| Revocation | individually, per user in bulk, or by expiry sweep |
| Attributes | **snake_case** — `tenant_id`, not `tenantId` |

### IP binding is a trade-off

Strict IP binding breaks legitimate users on mobile networks that rotate addresses, and hospital wifi that hands out a different address per floor. Loose binding weakens the control.

`sessionSecurity.middleware.js` is where the balance is struck, and it is a product decision, not a purely technical one. Whatever it is, it should be stated rather than emergent.

## MFA

TOTP. `users.mfaEnabled`, `users.mfaSecret` (migration `0004`).

With MFA enabled, `POST /login` returns a **challenge and no token**; the client completes at `/mfa/login`.

`mfaSecret` must never be returned after enrolment. It is returned once, during `/mfa/setup`, so the user can scan it.

### The gap

**MFA is available, not enforced — including for `SUPERADMIN`.**

`SUPERADMIN` bypasses every permission check and every tenant predicate, and there is no second gate behind it. A super-admin account without a second factor is one credential away from total compromise of every tenant.

Mandatory MFA at role level 10, enforced at login rather than requested at onboarding, is in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md) and named as PR-3.

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

## OTP and Password Reset

`otpCode`, `otpExpiredAt`, `otpRequestCount`, `otpLastRequestedAt`.

| Limit | Value |
|---|---|
| OTP request | 5 / hour (Express), 3 / 15 min with lockout (Redis) |
| Reset attempt | 5 / 5 min |

An OTP must be single-use and cleared on use. An OTP that remains valid until expiry after being consumed is a replayable credential.

## Federation

### As a relying party

SAML and OIDC, with **per-tenant callbacks** (`/sso/callback/:tenantCode`) because each tenant may federate with its own identity provider and a shared callback cannot tell which IdP an assertion came from.

Trust configuration is per tenant. A misconfigured tenant IdP compromises that tenant, not the platform — which is the correct blast radius and worth preserving.

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
| Bad credentials | 401, uniform |
| Expired token | 401 **"Invalid token"** |
| Locked account | 401 with a lockout message |
| Suspended tenant | 403 "Tenant account is suspended" |
| Rate limited | 429 with `X-RateLimit-*` |

An expired token reporting "Invalid token" rather than a distinct message is a known cosmetic wart, left alone deliberately: changing it churns a fully-covered unit suite for no security or usability gain. Recorded so the next reader does not treat it as a bug to chase.
