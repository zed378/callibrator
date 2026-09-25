# 01 — Authentication API

Base: `/api/v1/auth`, `/api/v1/sessions`, `/api/v1/webauthn`, `/api/v1/oidc` (also `/oidc`).

Envelope, status codes and header conventions: [`00-API-STANDARDS.md`](./00-API-STANDARDS.md).

---

## `/api/v1/auth` — 25 endpoints

### Core

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/register` | public | create an account |
| GET | `/activation` | public | activate from an emailed link |
| POST | `/login` | public | password login |
| POST | `/logout` | bearer | revoke the current session |
| POST | `/logout-all` | bearer | revoke every session for this user |
| POST | `/refresh` | refresh token | rotate the access token |
| POST | `/verify` | bearer | verify the current token and return the user |
| POST | `/socket-token` | bearer | mint a short-lived token for the Socket.IO connection |

`POST /login` returns the standard envelope plus top-level `token` and `session`.

`POST /socket-token` exists so the long-lived access token is never handed to a transport that keeps it in memory for the life of a connection.

### Password and OTP

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/send-otp` | public | request a reset OTP — **3 per 15 min**, then lockout |
| POST | `/reset-password` | public | complete reset with an OTP — 5 per 5 min |
| POST | `/just-update-password` | bearer | change password while signed in. 409 for an SSO session, naming the IdP (A-216), or for an expired temporary password (A-215) (ADR-068) |
| POST | `/pass-is-valid` | bearer | check a password without changing it. 400 without a password |

**These two, and every re-authentication (MFA rotate or disable, passkey removal, email change), share one per-user budget (A-260, ADR-072).** Five wrong passwords in 15 minutes: the attempt that spends it signs its session out and is audited `ACCOUNT_LOCKED`. It and every check until the window ends answer **429 with `Retry-After`**.

OTP state lives on the user row: `otpCode`, `otpExpiredAt`, `otpRequestCount`, `otpLastRequestedAt`.

`/send-otp` must return the same response whether or not the address exists. A different response is an account-existence oracle.

### MFA

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/mfa/setup` | bearer | begin TOTP enrolment, returns the secret and provisioning URI |
| POST | `/mfa/verify` | bearer | confirm enrolment with a code |
| POST | `/mfa/login` | partial | complete a login that returned an MFA challenge |

With MFA enabled, `POST /login` returns a challenge rather than a token; the client completes at `/mfa/login`.

### SSO — SAML and OIDC as relying party

| Method | Path | Purpose |
|---|---|---|
| POST | `/sso/login` | begin SAML |
| POST | `/sso/callback` | SAML assertion consumer |
| POST | `/sso/callback/:tenantCode` | per-tenant ACS |
| GET | `/sso/metadata` | SP metadata |
| GET | `/sso/metadata/:tenantCode` | per-tenant SP metadata |
| POST | `/sso/oidc/login` | begin OIDC |
| POST | `/sso/oidc/callback` | OIDC callback |
| POST | `/sso/oidc/callback/:tenantCode` | per-tenant OIDC callback |

Per-tenant variants exist because each tenant may federate with its own identity provider; a single shared callback cannot tell which IdP an assertion came from.

OIDC endpoints are read from the IdP's discovery document at `<oidc_authority>/.well-known/openid-configuration`
(A-188; a multi-tenant authority such as Entra's `/common` is refused with 400). The callbacks are
reached by the browser: a refusal redirects to `/login?error=<code>`, never a JSON body. A platform
operator is refused SSO (A-210). An SSO session's access token carries `amr` = `saml` / `oidc`.

### Impersonation

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/impersonate` | `SUPERADMIN` | assume another user identity |
| POST | `/impersonate/exit` | bearer | return to the operator identity |

Support tooling with real power. Both transitions must be audited, and an impersonated session must be distinguishable in the audit trail from the user acting themselves — otherwise the trail attributes an operator action to a customer.

## `/api/v1/sessions` — 6 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list sessions |
| GET | `/stats` | session statistics |
| GET | `/:id` | one session |
| POST | `/:id/revoke` | revoke one |
| POST | `/user/:userId/revoke-all` | revoke every session for a user |
| DELETE | `/:id` | delete a session record |

`sessions` carries `token_hash`, `ip_address`, `user_agent`, `device`, `expired_at`, `last_activity_at`, `is_revoked`, `revoked_at`, `revoked_reason`.

Note the **snake_case attribute names** on this model — `tenant_id`, not `tenantId`. Writing `Session.destroy({ where: { tenantId } })` fails with `column "tenantId" does not exist`, which is exactly what broke the nightly retention purge.

Sessions are stored in the database rather than only in Redis because a session here is an audit record, not a cache entry (ADR-034).

## `/api/v1/webauthn` — 6 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | is a passkey registered |
| POST | `/registration-options` | begin registration |
| POST | `/verify-registration` | complete registration |
| POST | `/login-options` | begin authentication |
| POST | `/verify-login` | complete authentication |
| POST | `/disable` | remove the passkey |

Challenges are stored in **Redis**, not process memory — a challenge issued by one replica must be verifiable by another.

Configuration:

| Variable | Requirement |
|---|---|
| `WEBAUTHN_RP_ID` | the registrable domain, **no scheme, no port** |
| `WEBAUTHN_ORIGIN` | must match the browser origin **exactly** |

Both are exact-match by specification. A trailing slash, a missing port, or an `https` where the browser sent `http` fails verification with an error that does not name the mismatch.

Credential state lives on the user row: `webauthnEnabled`, `webauthnCredentialId`, `webauthnPublicKey`, `webauthnSignCount` (migration `0014`).

## `/api/v1/oidc` and `/oidc` — 11 endpoints

Callibrator as an OIDC **provider**.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/.well-known/openid-configuration` | **public** | discovery |
| GET | `/.well-known/jwks.json` | **public** | signing keys |
| GET | `/authorize` | user session | authorization endpoint |
| POST | `/token` | client credentials | token endpoint |
| GET | `/userinfo` | bearer | claims |
| GET | `/authorize/request/:requestId` | user session | consent screen data |
| POST | `/authorize/decision` | user session | consent decision |
| POST | `/clients` | admin | register a client |
| GET | `/clients` | admin | list clients |
| POST | `/clients/:clientId/rotate-secret` | admin | rotate |
| DELETE | `/clients/:clientId` | admin | remove |

### Why it is mounted twice

```js
app.use("/api/v1/oidc", oidcRoutes);
app.use("/oidc", oidcRoutes);          // issuer root
```

The discovery document advertises endpoints at `<issuer>/oidc/...` where the issuer is the host root. Relying parties fetch `/oidc/.well-known/openid-configuration` directly, not under the API prefix. Serving it only under `/api/v1` produces a discovery document nobody can follow.

## Authentication Flow

*As-built after ADR-059 (A-185, P6-07). The security treatment is
[`../SECURITY/03-AUTHENTICATION-SECURITY.md`](../SECURITY/03-AUTHENTICATION-SECURITY.md).*

```
POST /auth/login
  ├─ rate limit (20 / 15 min at Express)
  ├─ sign-in throttle: identifier+address 5 failures / 15 min, identifier 100 / hour → 429
  ├─ resolve user by username or email
  ├─ verify password (an unknown identifier against a dummy hash)
  │    any failure → counted → 401 "Invalid credentials" (unknown, wrong, suspended, locked: alike)
  ├─ with the right password only: 403 suspended account · 423 locked by the MFA step · 403 tenant (BR-3)
  ├─ if mfaEnabled → return an MFA challenge, no session
  ├─ create a sessions row: token hash, IP, user agent, device
  ├─ write audit_logs LOGIN
  └─ return { data, token, session }   (data.mfaEnrolmentRequired for an operator without MFA)
```

`token` in this body is for server-side callers; the Next.js layer moves it into the httpOnly cookie
and removes it before the browser sees the response (A-71).

## Error Semantics

| Situation | Response |
|---|---|
| Bad credentials — unknown user, wrong password, suspended or locked account | 401 "Invalid credentials", uniform (A-185) |
| The right password, suspended account | 403 "Account is suspended" |
| The right password, account locked by the MFA step | 423 "Account temporarily locked" |
| Sign-in paused after repeated failures | 429 — the same for an unknown identifier (A-185) |
| Expired token | 401 **"Invalid token"** |
| Suspended tenant | 403 "Tenant account is suspended" |
| Operator (level 10) without MFA; tenant MFA policy | 403 `MFA_ENROLMENT_REQUIRED` (P6-07, A-160) |
| SSO callback refused | 302 to `/login?error=sso_state\|sso_unavailable\|sso_account_refused\|sso_failed\|sso_error` (A-188) |
| Rate limited | 429 with `X-RateLimit-*` |

An expired token reporting "Invalid token" rather than a distinct "token expired" is a known cosmetic wart. It was left alone deliberately: changing the message churns a fully-covered unit suite for no security or usability gain. Recorded so the next reader does not treat it as a bug to chase.
