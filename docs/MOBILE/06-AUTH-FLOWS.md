# 06 — Sign-in and Session Flows (TARGET)

> **TARGET — nothing here is built.** This is the **app side**. The server side — the bearer + refresh
> surface for native clients, refresh rotation and reuse detection, the SSO app-link exchange, the
> native passkey ceremonies, the push-token registry, the minimum-version policy — is
> [`20-BACKEND-FOR-MOBILE-NODE.md`](./20-BACKEND-FOR-MOBILE-NODE.md) and [`21-BACKEND-FOR-MOBILE-GO.md`](./21-BACKEND-FOR-MOBILE-GO.md), written by the shared-packages documentation agent. Where this
> document names a server behaviour, that document is the authority; a disagreement is a defect in
> one of them, raised through the deviation protocol.

---

## 1. Principles

1. **Every sign-in method ends the same way**: the server issues a session for this install — an
   access token and a refresh token, tied to a server-side session row (the existing `sessions`
   model) that names the device ("Callibrator app · Samsung SM-A546E · Android 15"). The user sees it
   in Settings → Security → My sessions (S-2) and can revoke it; an administrator can revoke it.
2. **Where tokens live:** the access token **in memory only**; the refresh token in
   `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` on iOS, Keystore-wrapped on Android —
   the same class as the field key, for the same reason: background sync, `04` § 4.2). Never in MMKV,
   AsyncStorage, a file, a log, a crash report, a URL or an OTA bundle.
3. **The web's rule is not weakened.** On the web the browser never holds a token (ADR-059); that
   stays. The app is a different client type with its own, narrower surface ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)); a
   web session cookie is never given to the app, and an app token is never accepted as a cookie.
4. **No embedded web view for sign-in.** Every browser-based step (SSO) uses the **system browser**
   (`ASWebAuthenticationSession` on iOS, Chrome Custom Tabs on Android, through `expo-web-browser`) —
   RFC 8252: an embedded web view lets the app read the user's IdP password; a system browser does not.
5. **Authentication is the server's.** The app collects credentials and shows the server's answers; it
   never decides that a password is valid, that MFA is satisfied, or which tenant a user belongs to.

## 2. Password + MFA

```
Sign-in screen ── email + password ──▶ server   (POST /auth/login; the native form is 20's)
      ◀── 200 tokens + session                        → home
      ◀── 202 data.mfaRequired = true, top-level `token` = an MFA-purpose token (not a session)
                                                      → MFA screen
      ◀── 401 / 429                                   → the server's message; budgets honoured
MFA screen ── TOTP code or a recovery code + the MFA-purpose token ──▶ POST /auth/mfa/login ──▶ tokens → home

LATER, on any authenticated call (from auth.middleware, not from /auth/login):
      ◀── 403 code PASSWORD_CHANGE_REQUIRED           → first-sign-in password screen
      ◀── 403 code MFA_ENROLMENT_REQUIRED             → "set up MFA on the web" or in-app setup (§ 2.2)
```

*As built (verified 2026-10-08):* `auth.service.ts` answers an MFA-required sign-in with **202**,
`data: { id, username, email, mfaRequired: true }` and a **top-level `token`** that is an MFA-purpose
token, `refreshToken: null`. The two 403 gates are raised by `auth.middleware.ts` (the
`PASSWORD_CHANGE_REQUIRED` and A-160 MFA-required blocks) on the calls **after** sign-in, so the app
handles them in the `api-client`'s gate classifier (`docs/SHARED/03`), not on the sign-in screen.

- The sign-in screen is in the `(public)` group; the password field uses the platform's password
  autofill (`textContentType="password"`, `autoComplete="password"`) so password managers work;
  "Show password" is a toggle named after its object.
- MFA: a 6-digit TOTP field with `textContentType="oneTimeCode"`; "Use a recovery code" switches the
  field; the MFA token from the first step is held **in memory only** for that step.
- Error messages are the server's, never more specific than it chose (no "this email does not exist").
- **Tenant first** (owner decision 2026-10-08, `11`): sign-in happens **after** tenant setup; the sign-in
  screen shows only the methods the tenant's public auth config allows (an SSO-enforcing tenant shows
  no password field), and every pre-auth call carries the tenant code as a **hint** (`X-Tenant-Code`).
  The account's tenant is still the server's: an account of another tenant gets the generic "invalid
  credentials", and after sign-in a token whose tenant differs from the stored config forces sign-out
  (`11` § 8). Platform super admins are not a v1 audience (`11` § 9).

### 2.1 Forgot password

Opens the **web** "forgot password" page in the system browser (the OTP flow and its budgets live
there, ADR-098); after a reset the user returns and signs in. One flow, one place to keep correct.

### 2.2 MFA enrolment in the app

Allowed when the tenant requires MFA at first sign-in: the setup secret and QR are shown on a screen
with **screen capture prevented** (Android `FLAG_SECURE`; iOS the app-switcher overlay — `07` § 5), the
user confirms with a code, recovery codes are shown once on a capture-prevented screen with a
"I have saved them" confirmation. A technician enrolling on the same phone that will hold the
authenticator app is warned that the phone becomes both factors; the web enrolment from a desk is
recommended in the field guide.

## 3. Hospital SSO — OIDC with PKCE in the System Browser

The tenant's identity provider (one SSO configuration per tenant, ADR-124 § 9) is reached through the
backend, which stays the relying party towards the IdP (as `POST /auth/sso/oidc/login` and its
callbacks do for the web today). What the app adds is a **second PKCE, between the app and the
backend**, and an **app-link return** — the server side is [`20`](./20-BACKEND-FOR-MOBILE-NODE.md) § 7;
the app's steps:

```
1. app     user taps the tenant's SSO button (`11` § 7); the tenant is the **stored tenant code** from
           tenant setup — never an email typed here
2. app     creates codeVerifier (64 random bytes, base64url), codeChallenge = S256(verifier) and
           appState (128 bits); keeps all three in memory for this attempt only
3. app     POST /native/api/v1/auth/native/sso/start { tenantCode, codeChallenge,
           codeChallengeMethod: "S256", appState }  →  { authorizeUrl }
4. app     openAuthSessionAsync(authorizeUrl, <callback>)  — system browser; <callback> per § 3.1
5. browser backend → tenant IdP (the IdP's own sign-in, its own MFA, its own session cookie)
6. browser IdP → backend callback → 302 <callback>?code=<one-time>&state=<appState>
7. OS      the auth session delivers the callback URL to the app (§ 3.1); the browser sheet closes
8. app     checks state == appState of the pending attempt (else: refused, attempt discarded)
9. app     POST /native/api/v1/auth/native/sso/exchange { code, codeVerifier }  →  tokens + session
           (any failure is one 401 — the server gives no oracle of which part was wrong)
```

### 3.1 The callback on each platform — owner decision (B), 2026-10-08

An `https` 302 **inside** an `ASWebAuthenticationSession` is **not** delivered as a Universal Link —
the session itself must recognise the callback.

| Platform | Callback |
|---|---|
| **iOS / iPadOS 17.4+** | an **https** callback (`ASWebAuthenticationSession.Callback.https(host:path:)`): `https://<platform host>/m/sso-return`, matched by the session, the host also in the associated domains |
| **iOS 16 – 17.3** | a **private reverse-domain custom scheme** (`<reverse-domain>.callibrator://sso-return`), used **only** as the auth-session callback (RFC 8252 § 7.1). It is safe here because the session hands the URL only to the app that opened it and the code is **PKCE-bound** (useless without the verifier); the scheme is accepted by the server only on the SSO exchange redirect allow-list |
| **Android** | Custom Tabs; expected: the verified **App Link** `https://<platform host>/m/sso-return` (`autoVerify`) — **confirmed by the device spike** that opens P36-05 (`20` § 7.1) |

**Decided after a device spike** (the entry item of P36-05; server side `20` § 7.1): the spike confirms on real iOS 16, 17.3
and 17.4+ devices which callback `expo-web-browser`'s `openAuthSessionAsync` (or a small in-house
module) can use, and the record names the result. The iOS floor of `09` § 3.3 (16) is why the custom
scheme branch exists at all; raising the floor to 17.4 would remove it.

- If the link reaches the **browser** instead of the app (the app not installed, or the OS not handing
  the link over), the frontend's `/m/sso-return` page says "Open this link on the phone with the
  Callibrator app" and never redeems the code (`20` § 7); the app shows "Sign-in did not complete — try
  again" when the browser sheet closes without a return.
- The one-time code is useless without the verifier, which never left the app; a malicious app that
  intercepts the link (it cannot, with a verified app link — but if it did) gets nothing usable.
- Only the callbacks of § 3.1 are accepted as the redirect: verified HTTPS links, and on iOS 16 – 17.3
  the private reverse-domain scheme as an auth-session callback only — never a generic
  `callibrator://` scheme (`05` § 5).
- `prefersEphemeralWebBrowserSession` is **off**: the hospital IdP's session cookie in the system
  browser lets a technician sign in again without retyping the IdP password, which is the point of
  hospital SSO. The consequence: signing out of the app does **not** sign out of the IdP in the
  browser; the logout screen says so and offers the IdP's logout page when the tenant configured one.
- Bound-ness comes from the **user row after authentication**, never from an IdP claim (P18-03 § 12);
  a JIT-created user in a multi-facility tenant is refused with `FACILITY_BINDING_PENDING` until an
  administrator binds or confirms them — the app shows the reason and nothing else.
- SAML-only tenants: the same app-link return works when the backend runs the SAML leg; whether every
  existing SAML configuration can be used from the app is checked per tenant at roll-out
  ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)).

## 4. Passkeys

- **Library:** a maintained Expo-compatible passkey module (the `react-native-passkeys` class) calling
  the platform authenticators (iOS `ASAuthorizationPlatformPublicKeyCredentialProvider`, Android
  Credential Manager). Chosen and recorded by the card that adds it.
- **RP ID:** the backend's `WEBAUTHN_RP_ID` (`backend/src/services/webauthn.service.ts` — one RP ID
  for the deployment). The app's associated domains (`webcredentials:`) and Android Digital Asset
  Links (`get_login_creds`) must name that host (`05` § 5). **Consequence:** a passkey created on the
  web for the platform host works in the app and vice versa (synced passkeys through iCloud Keychain
  or Google Password Manager); a passkey for a tenant's custom domain is not the platform RP ID and is
  not usable in the app.
- **Ceremonies:** registration (Settings → Security → Passkeys, signed in, after a fresh password or
  MFA confirmation) and authentication (sign-in screen, "Sign in with a passkey", conditional UI where
  the platform offers it) go through the backend's WebAuthn routes in their native-client form
  ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md) decides whether they gain a token-returning variant); several passkeys per user
  (ADR-108 Amendment 1); passwordless passkey sign-in exists on the web since Phase 10 (ADR-108).
- A passkey sign-in satisfies MFA where the server says so (user verification required); the app does
  not decide.

## 5. Biometric Re-unlock (an App Lock)

- **What it is:** a lock over the app's UI. At cold start (with a stored session) and after **5
  minutes in the background** (a tenant may set a shorter value through the mobile configuration read;
  never longer), the app shows the unlock screen; Face ID / fingerprint, or the device passcode,
  unlocks it (`05` § 4). Until unlocked, no screen with data renders, and the app-switcher snapshot
  shows the privacy overlay (`07` § 5).
- **What it is not:**
  - **not a server authentication** — the server sees a refresh, not a biometric; server-side idle and
    absolute session limits still end the session;
  - **not a key protector** — the refresh token and the field key are not gated by the biometric
    prompt, so background sync can run while the app is locked (`04` § 4.2). The protection at rest is
    the platform keystore + SQLCipher + the device lock;
  - **not a signature** — an electronic signature (P19-06) always re-enters the password (and MFA per
    method). Part 11 (§ 11.200) allows biometric signatures only when they cannot be used by anyone but
    their owner; a phone's enrolled biometrics can include another person's finger. Biometrics never
    sign here.
- Opt-in per install after the first successful sign-in ("Use Face ID to unlock Callibrator"); five
  failed attempts or a biometric enrolment change (`05` § 4) → password sign-in.
- If the device has **no** lock at all, the app refuses offline mode (`04` § 3) and shows a standing
  recommendation to set one; online use is allowed (the server's session limits apply).

## 6. Token Use and Rotation

- **Access token:** short-lived (the server decides; today's web access token is 15 min, ADR-127
  context), attached as `Authorization: Bearer` by the `api-client`'s bearer transport, held in memory;
  a cold start begins with a refresh.
- **Refresh:** **single-flight** — one refresh at a time; concurrent requests that hit 401 wait for it
  and retry once. Every refresh **rotates** the refresh token (the server returns a new one and
  invalidates the old; reuse of an old one revokes the whole session — [`20`](./20-BACKEND-FOR-MOBILE-NODE.md)); the new
  token is written to SecureStore **before** the refresh resolves (`docs/SHARED/03` § 5); if the write
  fails, the session ends cleanly rather than continuing on a token that is not stored. A crash between
  the server's rotation and the local write loses the session — the user signs in again and the outbox
  is kept. That is the accepted cost of rotation (the shared adapter's document states it too).
- **`REFRESH_RACE`** (`20` § 13a — two refreshes of one family crossed, e.g. a background run and the
  foreground): the app **retries the refresh once** with the token now in SecureStore; a second failure
  ends the session as below. It is never treated as reuse by the client. (The client re-reads the token
  stored in SecureStore before the retry — another refresh may have rotated it.)
- **The 30-day absolute limit** of a session family (ADR-134 § B.4): when the server answers a refresh
  with **401 `SESSION_EXPIRED_ABSOLUTE`**, the app shows **"Please sign in again"** (not an
  error), keeps the outbox and the tenant config, and returns to sign-in; the field working set follows
  the purge rule for a session end (`04` § 8).
- **Refresh failure** (401 from the refresh route, or the session revoked) **ends the session**: memory
  cleared, refresh token deleted, the field purge of `04` § 8 runs (the outbox stays for the same
  user), the push token is unregistered at the next contact, and the sign-in screen states the reason
  when the server gave a code.
- Background runs (`04` § 6) refresh the same way; a refresh that fails in the background ends the
  session the same way, and the next foreground shows sign-in.
- **Sender-constrained tokens (DPoP with a Keystore/Secure Enclave key)** are not in the first release
  — a later hardening step if the threat model asks (ADR-135 alternatives).

## 7. Logout, Logout-All and Wipe

| Act | Who | Effect |
|---|---|---|
| **Sign out** (this phone) | the user | refused while the outbox is non-empty (`04` § 8: "Sync now" / "Discard N items" with a typed confirmation); then `POST /auth/logout`, the push token deleted, the refresh token deleted from SecureStore, the field database and its key deleted, memory cleared, MMKV preferences kept (language, theme) |
| **Sign out everywhere** | the user | `POST /auth/logout-all`; this phone as above; every other session of the user ends at its next contact |
| **Revoke a session** | the user (my sessions) or an administrator (`/sessions`) | the revoked phone's next contact (foreground, background, or a `scope_check` push) gets 401 → session end → purge (`04` § 8) |
| **Wipe another user's offline data** on a shared phone | an unbound tenant administrator, on the phone, online | `04` § 10.3, audited |
| **MDM: remove the managed app / wipe the device** | the customer's MDM administrator | the OS deletes everything, **including unsynced captures** — the MDM runbook (`08` § 7) asks for a sync first |
| **Account deactivated, tenant suspended, facility ended** | the server | a scope-loss code at the next contact → purge, sign out, the reason shown |

A sign-out never silently discards captured work and never silently keeps tenant data: the two rules
of ADR-127 § 9, unchanged.
