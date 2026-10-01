# Feature Spec — P10-10 Passwordless Passkey Sign-in

**Written:** 2026-09-29 — **before** implementation
**Task:** P10-10
**Author:** technical-writer agent, Phase 10 planning
**Spec refs:** `docs/UI-UX/20-LANDING-AUTH-REVAMP.md` §7.5 · `docs/UI-UX/research/04-competitor-landing-and-auth.md` §3.3 · `docs/SECURITY/05-MULTI-TENANCY-SECURITY.md` · ADR-098 §5


> **As built (2026-09-30), deviations recorded in ADR-108:** the routes live in `routes/api/authPublic.route.ts`, mounted at `/api/v1/auth`; `authPreCheck` is replaced by an ADR-100 request budget (`passkeyLogin`) plus the account's A-185 sign-in throttle; the unique index is migration **0100**; the Q-46 amendment of ADR-059 is ADR-108 §10. Record: `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md`.

---

## Problem

The owner wants a **passkey** button on the sign-in page. The product already enrols passkeys, but only for a signed-in user: every route in `backend/src/routes/api/webauthn.route.js` sits behind `router.use(auth)` (line 13), including `POST /webauthn/login-options` (line 105) and `POST /webauthn/verify-login` (line 130). Those two are a **step-up** for an existing session. There is no ceremony a signed-out user can start, so a passkey button on `/login` today would have nothing to call.

## What the Code Already Decides

| Fact | Source |
|---|---|
| Registration requires a **discoverable** credential and user verification (`residentKey: "required"`, `userVerification: "required"`) | `backend/src/services/webauthn.service.ts:126–127` |
| One credential per user, stored on the user row: `webauthnCredentialId`, `webauthnPublicKey`, `webauthnSignCount`, `webauthnEnabled` | `backend/src/models/user.model.ts:63–66, 227–240` |
| Challenges live in Redis with a TTL, keyed by **user id**, and are single-use (read then delete) | `webauthn.service.ts:54, 75–87` |
| `RP_ID` and `ORIGIN` are configured and checked on verification | `webauthn.service.ts` (`expectedOrigin: ORIGIN`) |
| A successful sign-in issues the session and access/refresh tokens through the same path password and SSO sign-ins use, and writes a `LOGIN` audit row | `auth.service.js` (A-72); the SSO hand-off in `sso.controller.js` |
| The sign-in throttle is per identifier + address, with a per-identifier ceiling | `constants/rateLimitConstants.ts` (A-185) |
| MFA (TOTP) is a second factor after a password; a passkey with user verification is itself multi-factor (possession + biometric/PIN) | FIDO; NIST SP 800-63B (research 04 §3.3) |

Because credentials are already discoverable, **no user re-enrols**: an existing passkey works for passwordless sign-in once the ceremony exists.

## Design

Two new **public** endpoints, in a new route module `backend/src/routes/api/passkeyLogin.route.ts` (outside `webauthn.route.js`'s `router.use(auth)`), mounted at `/api/v1/auth/passkey`:

| Method | Path | Gate | Purpose |
|---|---|---|---|
| `POST` | `/auth/passkey/options` | public; `authPreCheck("passkeyLogin")` | start a ceremony |
| `POST` | `/auth/passkey/verify` | public; `authPreCheck("passkeyLogin")` | finish it and sign in |

### `POST /auth/passkey/options`

- **No identifier in the request.** The options carry **no `allowCredentials`** (an empty list), so the browser offers whatever discoverable credential it holds for the RP. Asking for an email first and returning that user's credential id would answer "does this account have a passkey" — an oracle.
- Generate options with `userVerification: "required"`, `rpID: RP_ID`, timeout 60 s.
- Store the challenge in Redis under a **ceremony id** (32 random bytes, base64url), not a user id: `webauthn:pl:<sha256(ceremonyId)>`, TTL 120 s, single-use. Return `{ options, ceremonyId }`.
- Response is identical for every caller.

### `POST /auth/passkey/verify`

Body (Zod): `{ ceremonyId, credential }` (the `AuthenticationResponseJSON`).

1. Take and delete the challenge for `ceremonyId`; missing → 401 with the generic message.
2. Find the user by `webauthnCredentialId = credential.id` **across tenants**: this is a pre-authentication lookup, so it runs with **`skipTenantScope: true`** and a comment saying why (the tenant is what we are trying to learn). Only these attributes are read: id, tenant id, status, the three WebAuthn columns, `locked_until`. No user → 401 generic.
3. Verify with `verifyAuthenticationResponse` against the stored public key, `expectedChallenge`, `expectedOrigin: ORIGIN`, `expectedRPID: RP_ID`, `requireUserVerification: true`. Check the returned `userHandle` equals the user's WebAuthn user id.
4. **Sign-count check:** if both the stored and new counts are non-zero and new ≤ stored, refuse (possible cloned authenticator), audit it, and do **not** update the count.
5. Apply every rule a password sign-in applies, in the same order, by calling the **same** post-authentication function the password and SSO paths use (extract it if it is inline): user status active, not locked (`locked_until`), tenant not suspended (the distinct suspended message, 14 § Failure states), session creation, token issue, `LOGIN` audit row with `details: { method: "passkey" }`.
6. **MFA:** a passkey with user verification counts as phishing-resistant MFA; the TOTP step is **not** asked after it, for platform operators too (working decision Q-46, ADR-098 §8.5, awaiting owner confirmation). ADR-059's super-admin mandatory-MFA rule names TOTP, so this task amends it in the same change, with a test that an operator with no TOTP signing in by a UV passkey is admitted and an assertion without UV is refused.
7. Update `webauthnSignCount`. Respond exactly as a password sign-in does (same envelope, same cookies set by the frontend's `/api` layer).

### Errors

Every failure (unknown ceremony, unknown credential, bad signature, counter regression, disabled user) answers **401** with the one generic message (`auth.error.credentials` in doc 20 §11.2 maps it). Locked → the locked message; suspended tenant → the suspended message; throttled → 429 with `retryAfter`. That matches the password path's distinctions and no more.

### Rate limit

New `AUTH_ENDPOINTS.passkeyLogin = { maxAttempts: 10, windowMs: FIVE_MIN, lockoutMs: FIVE_MIN }`, per IP (no identifier is known before verification). A verification failure for a **known** credential also counts against that user's login bucket, so passkey guessing and password guessing share one ceiling.

## Frontend

- Feature-detect `window.PublicKeyCredential`; if absent, no passkey UI at all.
- **Conditional UI first:** on the identifier step, call `options` and start `navigator.credentials.get({ mediation: "conditional", publicKey })` with the identifier input carrying `autocomplete="username webauthn"`. Abort it when the user submits the identifier form.
- **Button second:** *Masuk dengan kunci sandi (passkey)* runs the modal ceremony.
- Cancellation by the user (`NotAllowedError`) is silent; no error banner.
- Uses `@simplewebauthn/browser` if the frontend already depends on it, otherwise the native API (check `frontend/package.json`; do not add a dependency for ~40 lines).

## Security Checklist

- [ ] No `allowCredentials` returned before authentication (no account oracle).
- [ ] Challenge bound to a ceremony, single-use, 120 s.
- [ ] `skipTenantScope` used once, in the credential lookup, with a comment; nothing else in the path bypasses the hooks.
- [ ] Origin and RP ID checked; user verification required.
- [ ] Counter regression refused and audited.
- [ ] The same post-authentication rules as password sign-in (status, lock, suspended tenant, session, audit).
- [ ] `webauthnCredentialId` needs an **index** for the lookup (it is queried by value now); add it in this task's migration. It must be **unique** — a credential id is globally unique by construction, so a unique index is not a cross-tenant oracle (nobody can register someone else's credential id), but state that reasoning in the migration.

## Tests (named before writing, `.ts`)

- `passkeyLogin.service.p1010.test.ts`: challenge single-use; expired ceremony → 401; unknown credential → 401 generic; bad signature → 401; counter regression → 401 and an audit row; suspended tenant → the suspended message; locked user → locked; success → session + `LOGIN` audit with `method: "passkey"`.
- `passkeyLogin.route.p1010.test.ts`: both routes reachable with **no token**; options response carries no `allowCredentials` and is identical across two calls apart from challenge and ceremony id.
- `passkeyLogin.twoTenant.p1010.test.ts`: a credential enrolled by a user in tenant A signs in **as that user in tenant A**, never into tenant B; a user of tenant B cannot complete a ceremony with A's credential id and B's session. (No `:id` path parameter, so no guard entry; the marker is not required, but the tenant test is.)
- Live E2E with a virtual authenticator (Chrome DevTools Protocol `WebAuthn.addVirtualAuthenticator` through the existing puppeteer-core smoke, ADR-077).
- Mutation check: drop `requireUserVerification` and show a UV-less assertion test fails.

## Open Questions

- The passkey-as-MFA answer is a working decision (Q-46) awaiting the owner's confirmation; if overturned, step 6 asks for the TOTP code after the passkey for accounts that have one.
- More than one passkey per user needs a credentials table; out of scope (the model holds one).

## Rollout

- Additive endpoints and one index. The login page shows the passkey UI only after this task is DONE (doc 20 §7.5); until then the button is not rendered.
- Rollback: remove the button; the endpoints are harmless without a caller but should be removed with it.
