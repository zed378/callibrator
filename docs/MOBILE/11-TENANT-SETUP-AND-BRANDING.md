# 11 — Tenant Setup and Branding Before Sign-in (TARGET)

> **TARGET — nothing here is built.** **Owner decision, 2026-10-08:** the app gets a **tenant setup
> screen before sign-in**. The user identifies the tenant; the app fetches the tenant's public
> branding, applies its logo and colours, sends the tenant as a request **hint**, and the sign-in screen
> shows that tenant's sign-in methods. Recorded in ADR-135 § 14. The **server side** (the public tenant
> lookup by code, the public sign-in configuration, `tenants.code` mandatory for tenants that use
> mobile) belongs to the backend-for-mobile documents [`20`](./20-BACKEND-FOR-MOBILE-NODE.md) /
> [`21`](./21-BACKEND-FOR-MOBILE-GO.md) and their phases. Where this document names a server behaviour,
> those documents are the authority.

---

## 1. As Built Today (what this builds on)

| Fact | Source |
|---|---|
| `tenants.code` exists, **nullable, unique** | `backend/src/models/tenant.model.ts` (`code: string \| null`) |
| A public, unauthenticated branding read exists for the web's pre-auth pages: `GET /api/v1/tenants/public`, the tenant chosen by the `x-tenant-id` header **or** the `?tenantId` query (a UUID), returning only non-sensitive branding fields | `backend/src/routes/api/tenant.route.ts` ("PUBLIC BRANDING (no auth)"), `tenant.controller.ts#getPublicBranding`; the web calls it as `/api/v1/tenants/public` (`frontend/src/api/services/tenant.service.ts`) |
| Identifier-first discovery by **email domain** (no account looked up): `POST /api/v1/auth/login/discover`. It returns **no tenant**: `{ next: "password" }` or `{ next: "sso", redirectUrl }`, and in the SSO case it **starts the web OIDC flow and sets its browser-binding cookie** — unusable from the app | `routes/api/authPublic.route.ts` (P10-04, ADR-108); `services/loginDiscovery.service.ts` (`Discovery` type, `discoverSignIn(identifier, res)`) |
| The `x-tenant-id` / `x-tenant-code` headers are honoured **only for a super admin**; every other principal's tenant comes from its user row | `middlewares/auth.middleware.ts` (the block after `tenantRefusal`, ~L445: "Tenant-bound and tenant-less non-super-admin accounts must NEVER be able to select a tenant via request headers") |
| Tenant logos are in the public file class: **PNG, JPEG, GIF and WebP** are accepted; only **SVG is refused** at upload | ADR-042 (step 3); `utils/upload.util.ts` `PUBLIC_IMAGE_TYPES` (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`) |
| A tenant has one brand colour (`tenants.primaryColor`) that overrides `--primary` only, never a status | ADR-090 amendment, ADR-122 § 4, `docs/UI-UX/08` |

## 2. The Flow

```
first run (no stored tenant)
  │
  ├─ (self-hosted builds / no compiled default server) server screen first: `08` § 6 — the server is
  │    chosen and confirmed BEFORE the tenant, because the tenant lookup runs on that server
  ├─ MDM managed configuration has `tenantCode`?  ── yes ─▶ resolve it (§ 3); the screen is skipped,
  │                                                          the tenant is locked (§ 6)
  ├─ opened from a setup link / QR?  ── yes ─▶ prefill the code, ask the user to confirm the shown
  │                                            tenant name and logo
  └─ otherwise: Tenant setup screen
        • "Organisation code"  [ RSABC ]   (Continue)
        • "Scan setup QR"
        • link: "Don't know your code? Enter your work email"  → the work-email code lookup (§ 2, owner (A))
  │
  ▼
resolve (§ 3) → show "<tenant name> + logo — Is this your organisation?" → Confirm
  │
  ▼
store the tenant config (§ 5) → apply branding (§ 4) → Sign-in screen with that tenant's methods (§ 7)
```

- The **org code** is `tenants.code` — short, human, printed on onboarding material. **Never the UUID**
  (unreadable, and not something to teach users). The input is case-insensitive, trimmed, and
  normalised the same way the server compares it.
- The **setup link** is `https://<platform host>/m/setup?org=<code>` (a verified app link / universal
  link, `05` § 5) and, for development builds and as a fallback only, `callibrator://setup?org=<code>`.
  A link carries **no secret and grants nothing**: it only pre-fills the code, and the user still
  confirms the resolved tenant name and logo before anything is stored. The same URL in a **QR** is
  what a tenant administrator prints or shows from the web app (a card of the web side, P-ids by the
  Node phases' author).
- The **email fallback** — **owner decision (A), 2026-10-08:** the as-built `POST /auth/login/discover`
  is **not** used (it returns no tenant and starts the web OIDC flow with a cookie). A **new public route**,
  **`POST /api/v1/public/tenants/discover { email }`** (`20` § 2a.5, card P36-11), returns **only
  `{ code }`** when the email's domain is one a **super admin has claimed** for a tenant, and the uniform
  404 `TENANT_NOT_FOUND` otherwise (the same answer as the by-code lookup). It **never starts SSO** and looks up no account. The app then resolves the code as in
  § 3 and asks for the usual confirmation. A domain that matches nothing → "We could not find your
  organisation — ask your administrator for the organisation code". The disclosure (a claimed domain
  reveals the tenant's code) is recorded as a residual under ADR-098 (the discovery implications), the
  same class of fact as the as-built discovery's answer.
- A refused or unknown code gets **one** message ("No organisation with this code") whether the code
  is unknown, the tenant suspended or its code absent — the lookup is not a tenant-existence oracle
  beyond what the public branding read already discloses, and it is rate-limited by the server.

## 3. Resolving a Tenant

The app calls **`GET /api/v1/public/tenants/by-code/:code`** ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md)
§ 2a, card P36-11 (Node); P1000-14 on Go): unauthenticated, case-insensitive, one uniform
404, `requestBudget("tenantByCode")`, an `ETag`. `tenants.code` becomes mandatory for mobile through a
**settings gate** (`mobile.enabled` is refused while the code is null) plus `UNIQUE (lower(code))` —
no NOT NULL migration. Its answer is public information only:

| Field | Use |
|---|---|
| `id` (uuid), `code`, `name` | the stored tenant id (compared after sign-in, § 8), the hint header, the confirmation screen |
| `logoBaseUrl` (a public-class image: PNG, JPEG, GIF or WebP — ADR-042) | the in-app logo |
| `primaryColor` | the palette derivation (§ 4) |
| `auth: { sso: { enabled, protocol, buttonLabel }, passwordAllowed, passkeyAllowed }` | which methods the sign-in screen shows (§ 7) |

Field names are `20` § 2a.1's (that document is the authority on them).
| `ETag` (response header) | refresh with `If-None-Match` (§ 5) |

**Never** in this answer: an IdP client secret, an IdP metadata URL with credentials, user counts,
facility names, settings, or anything else of the tenant's configuration. **No IdP secret ever reaches
the device**: SSO runs through the backend as relying party (`06` § 3).

## 4. Branding: Logo and Palette

- **What the tenant brands:** the **in-app logo** (header, sign-in screen, about) and the **primary
  colour** of chrome and identity.
- **What the tenant does not brand:** the **launcher icon** and the **native splash screen** stay
  Callibrator. **One build for every tenant — no white-label builds.** Tenant branding applies after
  JavaScript loads (the splash is the product's; the first rendered screen is the tenant's).
- **Logo:** PNG, JPEG, GIF or WebP (SVG is refused at upload, ADR-042); a GIF or animated WebP is
  rendered as its **first frame** (no animation in chrome); downloaded once, stored in the app's
  cache directory, re-validated with the branding's ETag; rendered with a fixed box and the tenant
  name as its accessible label; a failed load shows the tenant name in text, never a broken image.
- **Palette:** derived **in `packages/tokens`** from the single `primaryColor` (no schema change) —
  a light and a dark **tonal ramp** (primary, hover, pressed, foreground, tint) for both themes, each
  checked by a **WCAG-AA contrast guard** (text 4.5:1 on page, card and its own tint; foreground 4.5:1
  on the fill; focus ring 3:1). A colour that fails is first **adjusted**: its OKLCH **lightness** is
  moved, keeping hue and chroma, until the pair passes (`docs/SHARED/02-TOKENS.md` § 4.4; the web's
  `frontend/src/lib/brandColor.ts` does the same today). Only when no lightness passes does it fall
  back to the **brand copper** (ADR-122 `--primary`) for that theme — a last resort, logged for the
  operator. The derivation is
  the native twin of the web's `lib/brandColor.ts` (ADR-122 § 4) and moves into the package so both
  clients derive identically (`docs/SHARED/02-TOKENS.md`; built by P35-02). The
  setup screen itself is built by P37-03 (the app phase).
- **Status tones never take the tenant colour**: OK / due / overdue / fail (`--status-*`, ADR-122 § 6)
  and badges are product tokens on every tenant. The theme exposes only a `brandPrimary` slot (`90` § 3).

## 5. What Is Stored, and How It Refreshes

| Item | Where | Why there |
|---|---|---|
| tenant config: `tenantId`, `code`, `name`, the public auth config, `primaryColor`, the derived palette, `etag`, `lockedByMdm` | MMKV (public information, not tenant data in the sense of `04` § 4.1) | the app must **start offline** with the right branding and sign-in screen |
| the logo image | app cache directory | the same |

- **Refresh:** at every launch with a connection and on foreground at most every 6 hours, with
  `If-None-Match`; **304** keeps the stored copy; 200 replaces it and re-derives the palette.
- **Offline start:** the stored branding is used as is; nothing about it is trusted for authorisation.
- A refresh that answers "no such tenant" (the code changed or the tenant ended) does **not** wipe a
  signed-in session by itself; the next authenticated call decides (§ 8). On the sign-in screen it
  returns the user to tenant setup.

## 6. One Active Tenant per Install

- An install has **one** active tenant. The app sends its code as a **hint** header (`X-Tenant-Code`,
  injected by the shared `api-client` — P35-06) on pre-auth calls (branding, sign-in, SSO start) and after sign-in.
  The native ingress **moves** it into `X-Callibrator-Tenant-Hint` and strips any `X-Tenant-Code` /
  `X-Tenant-Id` the app sent (`20`), so the as-built super-admin header override can never be reached
  from the app.
- **Switching tenant** ("Change organisation" in Settings, or on the sign-in screen when nobody is
  signed in) requires: **sign-out first**, and **every registry user's offline outbox empty** on the
  install (`04` § 10's registry, not only the last user's) — or each non-empty outbox discarded with its
  own typed, confirmed discard (`04` § 7.2). It then wipes, in order: the tokens (SecureStore), the
  in-memory cache, the encrypted field database and its key, the push registration, and the branding
  (MMKV entries and the logo); then shows tenant setup.
- **MDM can lock the tenant** (`tenantCode` in managed configuration, `07` § 8): the setup screen is
  skipped and "Change organisation" is absent.
- Several people of the **same** tenant may still sign in one after another (`04` § 10); a person who
  works for two tenants uses one at a time on an install, or two phones.

## 7. The Sign-in Screen per Tenant

The sign-in screen (`06`) renders only the methods the public auth config allows:

| Config | Screen |
|---|---|
| `sso.enabled` | the SSO button with `sso.buttonLabel` ("Sign in with RS ABC account"), first |
| `passwordAllowed` | email + password (+ MFA step) |
| `passkeyAllowed` | "Sign in with a passkey" |
| SSO **enforced** (`sso.enabled` and not `passwordAllowed`) | **no password field at all** — only the SSO button (and passkey if allowed) |

These flags are **presentation only**: the server enforces each method on its own routes; a client
that showed a hidden form would still be refused.

## 8. Security Rules

1. **The tenant header is a hint, never an authority** (`X-Tenant-Code`; the as-built `x-tenant-id` /
   `x-tenant-code` override). For every principal but the super admin the backend already ignores it
   (as built, `auth.middleware.ts` ~L445); for pre-auth calls it only selects
   which **public** branding and sign-in configuration to show.
2. **Sign-in by an account of another tenant** (a valid account whose tenant differs from the hint)
   gets the generic "invalid credentials" — the same answer as a wrong password, so the hint gives no
   account-existence oracle across tenants (server rule, `20`, P36-12).
3. **After sign-in the token's tenant is authoritative.** The app compares the authenticated user's
   `tenantId` (`POST /auth/verify`) with the stored config; a **mismatch forces sign-out** and returns to
   tenant setup (the outbox rules of § 6 apply).
4. **The device receives public configuration only** (§ 3): whether SSO is enabled, its label, whether
   password and passkey are allowed. No IdP secret, no client secret, no tenant setting.
5. **SSO** runs in the system browser (`ASWebAuthenticationSession` / Custom Tabs) with PKCE and an
   app-link return (`06` § 3).
6. **Branding is untrusted input**: the logo is a raster image rendered in a fixed box; the name is
   text (never markup); the colour passes the contrast guard or is replaced. A tenant cannot change a
   status colour, the launcher icon, the splash or any security-relevant text.
7. **Setup links and QRs grant nothing** and are always confirmed by the user against the resolved
   name and logo (MT-16 in `07`).

## 9. Platform Super Admins

**Not a mobile v1 audience — owner decision (C), 2026-10-08 (Q-M6 decided)**, enforced **server-side at
native token issuance**: every native token-issuing route (sign-in, MFA, refresh, SSO exchange,
passkey) refuses a super-admin principal with the **generic 401** (`20`, P36 — no oracle that the
account is a super admin). The app's refusal screen is a courtesy, not the control. The
platform operator works in the web app, where impersonation and cross-tenant administration live; the
app's one-tenant-per-install model and the header-is-a-hint rule both assume a tenant-bound user. A
super admin who signs in to the app in v1 is refused with "Use the web app for platform administration".

## 10. Tests (added to `09`)

- `tenantSetup.resolve.test.ts` — code normalisation; one message for unknown / suspended / absent;
  the confirmation step cannot be skipped from a link.
- `branding.palette.test.ts` (in `packages/tokens`) — ramps for a set of brand colours including
  failing ones; every derived pair meets AA or falls back to copper; status tokens unchanged for every
  input (property test).
- `tenantSwitch.wipe.test.ts` — switching refused with a non-empty outbox; after a confirmed discard,
  SecureStore, the field database, the push registration and the branding are gone.
- `tenantMismatch.test.ts` — a verify answer with another `tenantId` forces sign-out.
- Maestro flows `setup.code`, `setup.link`, `setup.email-discovery`, `setup.mdm-locked`, `setup.sso-enforced`
  (no password field), `setup.offline-start` (stored branding without a network).
