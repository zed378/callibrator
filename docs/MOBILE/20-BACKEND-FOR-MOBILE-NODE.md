# 20 — Backend for Mobile, Node Variant (TARGET)

> **Status: TARGET (ADR-134 § B). Nothing in this document is built** except where a sentence says
> **as built** and names its file. This is the server side the native app (ADR-135, `00` … `10` of
> this folder) needs from **today's backend** — Express 5, strict TypeScript compiled to CommonJS
> (ADR-038, ADR-087), Sequelize with the tenant and facility hooks. Built by
> [`TASKS/PHASE-36-MOBILE-BACKEND-NODE.md`](../../TASKS/PHASE-36-MOBILE-BACKEND-NODE.md), after the contract group (Phases 32 … 34, ADR-136).
> The same capabilities in the Go engine: [`21-BACKEND-FOR-MOBILE-GO.md`](./21-BACKEND-FOR-MOBILE-GO.md).
> The client side: `06-AUTH-FLOWS.md`, `05-NATIVE-FEATURES.md`, `08-DISTRIBUTION-AND-RELEASES.md`
> and [`../SHARED/03-API-CLIENT.md`](../SHARED/03-API-CLIENT.md).

---

## 1. Principles

1. **A new client, not a new server.** The app uses the **same API, the same OpenAPI contract, the
   same gates** as the web. Every rule of `docs/SECURITY/05` (tenant isolation, cross-tenant 404,
   deny-by-default hooks), ADR-124 (facility scope, bound menu ceiling) and the global DoD applies to
   every route below without exception.
2. **The web's rule is not weakened.** The browser never holds a token (ADR-059); the Next proxy keeps
   stripping `token`/`refreshToken` from JSON answers (A-71). The app is a *different client type*
   that reaches the backend through its own ingress (§ 3) and holds its tokens in the platform keystore.
3. **Add surface only where the native platform forces it**: an ingress that does not strip tokens,
   an SSO return that a system browser can hand to an app, passkey origins that are not URLs, a place
   to keep push tokens, a version floor for binaries that cannot be recalled. Everything else reuses
   an as-built route.
4. **Every new route** has a permission gate or a reviewed exemption (`routePermissionGuard.p604`),
   is **written into the contract-first `contracts/` folder first** (OpenAPI 3.1 / AsyncAPI 3 /
   behaviour spec — owner decision 2026-10-08, ADR-136) with a **stable machine `code`** for every
   refusal (§ 13a), then implemented with validators **generated** from it (`backend/src/generated/contract/`, ADR-136, `docs/CONTRACT/02` § 3 — no hand-written `*.openapi.ts` for new routes — a module's existing `*.openapi.ts` survives only until that module is flipped to generation, P32-03/04), a facility-scope decision (marked facility-accessible, or 403
   to bound users — ADR-124 Am. 1), its audit rows inside the transaction, and — if it has a path
   parameter — a two-tenant **and** a two-facility test asserting 404.

## 2. What Exists Today (as built), and the Gaps

| Capability | As built | Gap for a native client |
|---|---|---|
| Sign-in answer carries tokens | `POST /auth/login`, `/auth/mfa/login`, `/auth/passkey/verify` answer through `response.util.ts#login` with `token`, `refreshToken` and `session { id, createdAt, expiresAt }` beside `data` (`backend/src/utils/response.util.ts`; `controllers/publicAuth.controller.ts`) | the edge sends every `/api/` request to Next, whose proxy **strips** both tokens (`frontend/src/app/api/v1/[...path]/route.ts`, A-71) — a phone has no path to them (§ 3) |
| Access token | JWT, 15 min, carries `sid` (the session id) and `amr` for SSO (`auth.service.ts`) | none |
| Refresh | `POST /auth/refresh` `{ refreshToken, sessionId }` → opaque token hashed in `sessions.token_hash`; **rotation**: the old session is revoked (`TOKEN_ROTATION`) and a new row created with a fresh **7-day** expiry (sliding); a `sessionId` mismatch revokes all the user's sessions (`auth.service.ts#refreshUserToken`) | a **reused** rotated token is simply refused (401) — no detection of theft (§ 5); no notion of a device across rotations (each refresh is a new row) |
| Sessions | `sessions` table (**snake_case** attributes: `tenant_id`, `user_id`, `token_hash`, `ip_address`, `user_agent`, `device`, `auth_method`, `expired_at`, `last_activity_at`, `is_revoked`, `revoked_reason`); per-request revocation check; `GET /sessions/mine`, `POST /sessions/mine/:id/revoke` (self), super-admin `/sessions/*` (`routes/api/session.route.ts`) | no client kind, installation, platform or app version; no family id |
| Logout | `POST /auth/logout`, `/auth/logout-all` | push tokens (none exist yet) |
| SSO | OIDC and SAML per tenant; the backend is the relying party, with PKCE **towards the IdP** and a state/nonce/binding-cookie store; the callback redirects the browser with a **one-time hand-off code** (32 random bytes, Redis `GETDEL`, A-60) redeemed server-to-server by Next's `/api/v1/auth/sso-session` (`controllers/sso.controller.ts`) | the hand-off target is a web page; the binding cookie lives in the system browser, not the app; the code is redeemable without proof that the redeemer started the flow (§ 7) |
| Passkeys | `@simplewebauthn/server` with **one** `WEBAUTHN_RP_ID` and **one** `WEBAUTHN_ORIGIN` (`services/webauthn.service.ts`); registration under `/webauthn/*`; passwordless sign-in `/auth/passkey/options` + `/verify` (P10-10, ADR-108) | an Android app's WebAuthn origin is `android:apk-key-hash:<…>`, not `https://…` — refused today (§ 8) |
| Notifications | in-app notifications + e-mail (`notification.model.ts`, `notifications.route.ts`) | no push channel, no token registry (§ 10) |
| Request budgets | `requestBudget(<name>)` on public auth routes, counting successes (ADR-100) | budgets for the new routes (§ 12) |
| `/.well-known/` | **routed to the backend** by the edge (`deploy/compose/nginx/vm-http.conf` `location /.well-known/`; Helm `templates/ingress.yaml` path `/.well-known`), served from storage by `express.static` (`backend/index.ts`, ACME) | the two app-association files (§ 8.3) |

## 2a. Tenant Setup Before Sign-in (owner decision 2026-10-08)

On first run the app learns **which organisation** it serves before anyone signs in: the user types the
**organisation code** (`tenants.code`), scans a setup QR / opens a setup link
(`https://<host>/m/setup?org=<code>`, an app link — § 8.3), or receives the code pre-filled by MDM
managed configuration. The fallback is **"enter your work email"**, answered by a **new** public route,
`POST /public/tenants/discover` (§ 2a.5, owner decision 2026-10-08) — **not** the as-built
`POST /auth/login/discover`, which answers `{ next: "password" } | { next: "sso", redirectUrl }`, never a
tenant, and **starts the web OIDC flow with a browser-binding cookie**
(`services/loginDiscovery.service.ts`, `discoverSignIn`); it stays the web's identifier-first step and
is not used by the app. The app then fetches the tenant's branding
and **public** sign-in configuration and sends the tenant as a **hint** header on every request. **One
active tenant per install**; switching = sign out + an empty outbox + wipe (`04` § 8, `06` § 7). The
screen and flow are the app documents' (`06`, `02`); this section is the server side.

**As built today:** `GET /api/v1/tenants/public` (mounted at `/api/v1/tenants` in `backend/index.ts`;
`tenant.route.ts` → `tenant.controller.ts#getPublicBranding` → `tenantService.getPublicBranding`)
accepts only a tenant **UUID**, read from `x-tenant-id`, `?tenantId` or a path parameter, returns
`{ id, name, code, primaryColor, logoBaseUrl }` for an **active** tenant only (404 otherwise) and caches
it 300 s per tenant. `tenants.code` is
`STRING(100)`, **nullable**, with a case-sensitive `unique` (`tenant.model.ts`).
`auth.middleware.ts` honours `x-tenant-code` / `x-tenant-id` **only for a super admin**; for anyone else
the tenant comes from the authenticated user.

### 2a.1 Public lookup by code — `GET /api/v1/public/tenants/by-code/:code` (P36-11)

- **Answer** (envelope `data`): `{ id, name, code, primaryColor, logoBaseUrl, auth: { sso: { enabled,
  protocol: "oidc" | "saml" | null, buttonLabel }, passwordAllowed, passkeyAllowed } }`.
  `buttonLabel` is the tenant's display string ("Masuk dengan SSO RS …") or null.
- **Never returned:** IdP client ids, secrets, metadata URLs, certificates, issuer URLs, allowlists,
  geofences, plan, contacts, settings — only the fields above. A **no-secret-fields test** builds a
  tenant whose SSO configuration holds every sensitive field and asserts the answer's key set equals
  the list above (written from the specification, not from the serializer's own field list).
- **Matching:** `code` normalised (trim, upper-case) and compared case-insensitively; a migration adds
  `UNIQUE (lower(code)) WHERE code IS NOT NULL` (a dry-run query lists case-only collisions first; one
  found stops the migration with the colliding ids — never a silent rename).
- **Active tenants only; a uniform 404** — unknown, suspended, offboarded, deleted, a tenant without
  mobile enabled (§ 2a.2): byte-identical envelope, same headers, comparable timing (one indexed query
  in every case; the branding cache keyed by the normalised code with the same TTL whether hit or miss).
- **Rate limit — a pair, as ADR-100's verify pair:** `requestBudget("tenantByCodeMiss")` counts **only
  404s** (the enumeration signal) strictly, per address — proposal 30 / 15 min; `requestBudget(
  "tenantByCode")` counts every request loosely — proposal 600 / 15 min per address — because a
  hospital or an Indonesian mobile carrier puts hundreds of phones behind one address (CGNAT) on an
  onboarding day, and every one of them looks up the **same** valid code. 429 in the envelope.
- **Caching:** `ETag` over the answer (`If-None-Match` → 304); `Cache-Control: public, max-age=300`
  matching the as-built 300-s server cache. The branding cache is invalidated by the tenant-edit paths
  that already invalidate `tenant:branding:<id>`.
- **Gate:** a reviewed **public** exemption in `routeGateExemptions` (reason: pre-sign-in branding),
  unmarked for facility scope (no principal). It has a path parameter → a **two-tenant test**: tenant
  A's and tenant B's codes each return only their own branding; the lookup never answers another
  tenant's fields for a code (`fixtures/twoTenantSuite.ts`, marked `@two-tenant`; the guard's
  allow-list gains it as "public, not tenant-owned" only if the suite cannot express it).
- **Accepted residual (ADR-098):** a guessed code confirms that the organisation is a customer — the
  same fact a tenant-branded sign-in link and the domain-discovery answer already disclose (ADR-098,
  implications on discovery; the coordinator's reference § 7.2). The budget bounds enumeration; codes
  are short and human by design, so they are not secrets.
- The as-built `GET /tenants/public` is unchanged (the web keeps using it).
- **This answer's field names are authoritative** for the app documents (`11`): `id`, `name`, `code`,
  `primaryColor`, `logoBaseUrl`, and the nested `auth` object.
- **Logos:** the as-built public mount serves `.jpg`/`.jpeg`, `.png`, `.gif`, `.webp` and refuses SVG
  (`utils/upload.util.ts`, `PUBLIC_IMAGE_TYPES`; ADR-042). The app renders a GIF's **first frame
  only** (a sign-in screen is no place for motion, and reduce-motion would require it anyway); a WebP
  renders as is.

### 2a.2 `tenants.code` mandatory for mobile — a settings gate, not a NOT NULL migration (P36-11)

**Decision (ADR-134 § B.8):** a tenant can **enable mobile** (`mobile.enabled`, the tenant setting read
by `GET /mobile/config`) only when its `code` is set and valid (`^[A-Z0-9][A-Z0-9-]{2,31}$` after
normalisation); the settings write refuses otherwise with 409 `TENANT_CODE_REQUIRED` ("Set an
organisation code before enabling the mobile app"). Clearing the code of a mobile-enabled tenant is
refused with the same code. The by-code lookup finds only mobile-enabled tenants.

*Why not a `NOT NULL` migration:* existing tenants without a code would need invented codes — a code is
a human-facing identifier printed on setup QRs and typed by staff, chosen by the operator, and a
generated one would be both meaningless and permanent. A gate makes the requirement true exactly where
it matters, with no back-fill. The case-insensitive unique index (§ 2a.1) is the one migration.

### 2a.3 Native SSO start by tenant code

`POST /auth/native/sso/start` (§ 7) takes `tenantCode` and **reuses** the as-built
`sso.controller#startSsoFor(tenantCode)` (the same entry `publicAuth.controller.ts` calls for the web's
`POST /auth/sso/start`), with the app's PKCE challenge and a redirect only to an **allow-listed** return:
the registered native callbacks of § 7.1 — an **https callback** (`https://<host>/m/sso-return`) on
iOS 17.4+ and Android, and on **iOS 16 – 17.3 only** a **private reverse-domain scheme**
(`<reverse-domain app id>:/sso-return`, RFC 8252 § 7.1) used **solely** as the
`ASWebAuthenticationSession` callback and bound to the app's PKCE verifier. A development-only custom
scheme remains possible (`NODE_ENV !== production` and `MOBILE_DEV_SCHEMES` set). The final choice is
made **after a device spike, before the SSO card** (§ 7.1). A tenant without SSO, unknown or inactive
gets the as-built one SSO-start refusal (ADR-100).

### 2a.4 Sign-in scoped by the tenant hint — `X-Tenant-Code` (P36-12)

- The app sends `X-Tenant-Code: <code>` on every request (`@callibrator/api-client`'s tenant-hint
  injector, `../SHARED/03` § 5a).
- **Before authentication** — `POST /auth/login`, `/auth/mfa/login`, `/auth/passkey/options`,
  `/auth/passkey/verify`, `/auth/native/sso/exchange` — the hint **narrows** the account lookup: a valid
  credential of an account in **another** tenant gets the **same generic invalid-credentials 401** as a
  wrong password (same message, status, timing class, and the same budget count). An unknown or
  inactive code is the same 401.
- **Super admins are not in v1 (owner, Q-M6) — enforced server-side at native token issuance:** every
  route that issues a native session (login, MFA login, passkey verify, first-sign-in password, SSO
  exchange, refresh) refuses a super-admin principal with the generic 401 `INVALID_CREDENTIALS`,
  whatever the hint. The UI hiding it is not the control.
- **The override headers never reach the backend from the native ingress.** As built,
  `auth.middleware.ts` honours `x-tenant-code` / `x-tenant-id` for a super admin, and the app sends its
  tenant code on every request. The edge therefore **moves** the app's `X-Tenant-Code` into
  `X-Callibrator-Tenant-Hint` and **strips** `X-Tenant-Code` and `X-Tenant-Id` (§ 3); the backend reads
  the hint only from the edge-set header and only before authentication. Belt and braces: the
  middleware ignores the override headers for any `client_kind = native` session.
- **After authentication the token's tenant is authoritative.** The hint is never read by
  `auth.middleware.ts` for a non-super-admin — **that does not change** (as built: the header override
  is super-admin only). A guard test sends a valid bearer of tenant A with `X-Tenant-Code` of tenant B to
  a tenant-scoped list and asserts tenant A's rows (and a `:id` of tenant B → 404).
- Passwordless passkey: **`allowCredentials` stays empty**, as built (`authPublic.route.ts`: "no
  identifier in, no allowCredentials out"). Offering the tenant's credentials would hand credential ids
  to anyone holding a guessable org code. The tenant is enforced at **verify**: an assertion whose
  credential belongs to a user outside the hinted tenant gets the generic 401.
- Web: unchanged (no hint is sent; identifier-first discovery stays).

### 2a.5 Work-email fallback — `POST /public/tenants/discover` (owner decision 2026-10-08; P36-11)

- **Body** `{ email }`; **answer** `{ code }` **only** when the e-mail's domain is one a super admin
  has claimed for a tenant (the as-built claim: `tenant_settings.sso_email_domains`, written by
  `PUT /admin/tenants/:id/sso-domains`, `controllers/ssoDomains.controller.ts`; read today by
  `services/loginDiscovery.service.ts`) **and** that tenant is active and mobile-enabled (§ 2a.2).
  Everything else — an unclaimed domain, a public mail domain, a malformed e-mail, an inactive tenant —
  gets the **same generic 404** whose message tells the user to ask their administrator for the
  organisation code.
- **No account is looked up** (domain only, as P10-04's discovery), **no SSO flow is started**, no
  cookie is set; the app then calls the by-code lookup (§ 2a.1) with the returned code.
- **Budgets:** the same class as by-code — `tenantDiscoverMiss` (404s, strict) and `tenantDiscover`
  (all, loose), per address (§ 12).
- **Residual against ADR-098 (recorded in ADR-134):** this discloses more than the as-built discovery —
  a claimed **domain maps to a tenant's code**, i.e. which provider serves that organisation, where
  the web discovery says only "SSO" or "password". Accepted: a domain claim is a platform act for an
  organisation that chose sign-in by domain; the answer is bounded by the budget pair.
- Gate: reviewed `public` exemption; no principal, unmarked for facility scope; contract in
  `contracts/` first with its 404 shape (§ 13a `TENANT_NOT_FOUND`).

## 3. The Native Ingress — `https://<host>/native/api/v1/…`

**Decision (ADR-134 § B.1):** the app reaches the backend through a **path prefix on the platform
host**, `/native/`, which the edge routes **past Next, to the internal gateway hop and from there to the engine serving each module** (ADR-136 — today the gateway has one upstream, the Node backend), rewriting `/native/api/` to
`/api/`. The generated client's paths stay `/api/v1/…`; only the app's `baseUrl` is
`https://<host>/native` (`../SHARED/03` § 5).

```nginx
# deploy/compose/nginx/vm-http.conf and default.conf (target, P36-01)
location /native/api/ {
    # A location with ANY proxy_set_header of its own inherits NONE from the server block
    # (vm-http.conf's /socket.io/ note, A-16) — so the client-address headers are repeated here.
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $client_proto;
    proxy_set_header CF-Connecting-IP  "";
    proxy_set_header CF-Visitor        "";
    proxy_set_header Cookie "";                      # never a web session through this door
    proxy_set_header X-Callibrator-Client "native";  # overwrites anything the client sent
    proxy_set_header X-Forwarded-Prefix "/native";
    proxy_set_header X-Callibrator-Tenant-Hint $http_x_tenant_code;  # the app's hint, moved
    proxy_set_header X-Tenant-Code "";                # never the super-admin override (§ 2a.4)
    proxy_set_header X-Tenant-Id "";
    proxy_pass http://gateway/api/;                  # the internal gateway hop (ADR-136, `docs/CONTRACT/07` § 2) — never Next
}
```

- **Helm:** the same rule in `templates/ingress.yaml` (a `/native/api` path to the backend service with
  a rewrite) — validated on the kind cluster as P7-06 was, and stated as kind-only until a production
  cluster exists (U-01).
- **Cookies are stripped** at the edge: a browser on the platform origin cannot turn its web session
  into tokens through `/native/`. **The backend ignores cookies for authentication anyway** (it reads
  `Authorization: Bearer` only, `middlewares/auth.middleware.ts`); stripping is defence in depth.
- **`X-Callibrator-*` exists only on the native ingress.** The Next proxy copies incoming request
  headers to the backend except a denylist (`frontend/src/app/api/v1/[...path]/route.ts`), and every
  other edge location passes client headers through; so the Next proxy's denylist and **every non-native
  edge location** must strip `X-Callibrator-Client` and `X-Callibrator-Tenant-Hint` (any `X-Callibrator-*`)
  — otherwise a browser could mark itself native or inject a tenant hint. A test per path (`/api/` through
  Next, `/socket.io/`, `/oidc/`, `/.well-known/`) proves the headers do not reach the backend.
- **`X-Callibrator-Client: native`** is set by the edge, so the backend can apply the native policies
  (§ 5, § 9). It is **not a security boundary**: a deployment that exposes the backend's port directly
  lets a caller set it. It never grants anything; it only *adds* restrictions (a version floor, reuse
  detection).
- **Browser requests are refused on the native ingress** (target): a request carrying `Origin` or
  `Sec-Fetch-Mode` (every browser `fetch` sends them; React Native's `fetch` does not) gets 403 — so a
  script injected into the web origin cannot drive the token-returning sign-in routes from the user's
  browser. P36-01 proves on both platforms that React Native sends neither header; if one does, this
  rule is dropped and recorded (it is defence in depth, not the boundary).
- **No CORS headers** are sent on `/native/` (a native client needs none).
- **Alternative — a separate host `api.<domain>`:** cleaner separation, but a second hostname, DNS
  record, certificate and Cloudflare-tunnel route per deployment, and a second app-link/association
  host. Rejected: **the owner decided the `/native/` path prefix on 2026-10-08** (Q-58, ADR-134 § B.1).

## 4. Native Sessions — Identity of an Install

Every request from the app carries (set by `@callibrator/api-client`'s mobile adapter):

| Header | Meaning | Server use |
|---|---|---|
| `X-Installation-Id` | a UUID v4 generated at first launch, stored by the app (not a secret; reset by reinstall) | ties the session family and push tokens to one install |
| `X-App-Platform` | `ios` \| `android` | version policy, push provider |
| `X-App-Version`, `X-App-Build` | the store version (semver) and build number | version policy (§ 9), logs |
| `User-Agent` | the platform default | stored as today |

**Schema (target, migration in P36-02)** — `sessions` gains, **in snake_case like every column of
that table** (the `tenantId`-on-`sessions` trap of `CLAUDE.md`):

| Column | Type | Rule |
|---|---|---|
| `client_kind` | `varchar(16)` NOT NULL DEFAULT `'web'` | `web` \| `native`; set from `X-Callibrator-Client` at session creation; existing rows `web` |
| `family_id` | `uuid` NULL | the first session id of a rotation chain; copied to every rotated row (native and web alike, so a later change of policy has the data) |
| `installation_id` | `uuid` NULL | native only |
| `platform`, `app_version`, `app_build` | `varchar(16)`, `varchar(32)`, `varchar(32)` NULL | native only, updated at each refresh |

`device` (as built, 100 chars) holds a display name the app sends at sign-in (`X-Device-Name`, e.g.
"Samsung SM-A546E · Android 15", truncated, never trusted) so `GET /sessions/mine` shows
"Callibrator app · Samsung SM-A546E" beside browser sessions. `/sessions/mine` and the super-admin
session list return the new columns (contract additive). Revoking any session of a family revokes the
**family** (a phone is one session to its user, however many rotations it made).

## 5. Refresh Rotation With Reuse Detection (native)

As built, `POST /auth/refresh` rotates and revokes the old token. **Target (P36-03), for
`client_kind = native` families:**

1. A refresh presenting a token whose session was revoked **with reason `TOKEN_ROTATION`** is a
   **reuse**: either the token was stolen and used, or the app lost the rotated one. The server
   **revokes the whole family** (`revoked_reason = 'TOKEN_REUSE'`), deletes the family's push tokens,
   writes an audit row (`changes.operation: "REFRESH_TOKEN_REUSE"`, family id, installation id — never
   a token) and answers **401** with `code: "SESSION_REVOKED"`. The legitimate holder signs in again;
   the thief's chain dies with it.
2. A refresh whose `X-Installation-Id` differs from the family's is refused the same way (a token moved
   to another install).
2a. **Concurrency is defined, not left to timing:** the refresh reads the session row with
   `SELECT … FOR UPDATE` inside its transaction, so two refreshes of one token serialise. The second,
   finding the row revoked by `TOKEN_ROTATION` **less than 5 seconds earlier** and carrying the **same
   installation id**, is a benign race (the app's single-flight failed, e.g. a foreground and a
   background run): it gets 401 with `code: "REFRESH_RACE"` (not `SESSION_REVOKED`) and **no** family
   revocation — the app re-reads the refresh token from the secure store (the other run wrote it) and
   retries once; `REFRESH_RACE` is on `@callibrator/api-client`'s list of codes that do not end the
   session. Outside that window, or from another
   installation, it is a reuse (rule 1). The Go engine ports exactly this (`21` § 5).
   **Client handling (for `06`):** on `REFRESH_RACE` the mobile auth adapter re-reads the stored
   refresh token and retries the refresh **once**; a second failure ends the session normally
   (`../SHARED/03` § 6.2).
3. **Web families are not changed** in this phase: two browser tabs can race a refresh through the
   Next proxy, and reuse detection there would sign users out spuriously. Extending it to the web needs
   a **cross-tab refresh lock** first. **Owner decision 2026-10-08 (Q-60): reuse detection is for
   native families only for now; the web is revisited together with a cross-tab refresh lock.**
4. **Lifetimes:** the native session keeps the as-built **7-day sliding** window (each refresh renews
   it), and gains an **absolute** limit of **30 days** per family (**decided by the owner 2026-10-08**, Q-59, ADR-134 § B.4;
   a tenant setting `mobile.session.absoluteDays` may shorten it, never lengthen it). After it, the
   user signs in again; the outbox is kept (`04` § 8). Access tokens stay 15 minutes.
   **Client handling (for `06`):** the refresh past the absolute limit answers 401
   `SESSION_EXPIRED_ABSOLUTE`; the app shows a **re-sign-in prompt** naming the reason ("For security,
   please sign in again — your unsynced work is kept"), keeps the outbox, purges the working set as on
   any session end, and resumes syncing after sign-in by the same user and tenant.

**The biometric trade-off, stated (ADR-134 § B.5):** the refresh token is stored without a biometric
access control (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), because background sync must refresh while the
phone is locked (`04` § 4.2, `06` § 5). The biometric unlock is an **app lock**, not a server factor.
The server's protections for a stolen phone are therefore: the device lock, revocation (self or
administrator) with family revocation, reuse detection, the 30-day absolute limit, and the field
purge rules. A tenant that wants biometric-bound tokens must accept "no background sync" — not offered
in the first release.

## 6. Routes the Native Sign-in Uses

| Route | As built? | Native change |
|---|---|---|
| `POST /auth/login` | yes (`loginBudget`, `authPreCheck("login")`) | none in the contract; through `/native/` the answer's tokens reach the app; the session row gets § 4's columns |
| `POST /auth/mfa/login` | yes (`mfaSignInBudget`) | as above |
| `POST /auth/first-sign-in/password` | yes (P10-16) | as above |
| `POST /auth/refresh` | yes | § 5 |
| `POST /auth/logout`, `/auth/logout-all` | yes | also delete the family's push tokens (§ 10); logout-all also sends `scope_check` pushes to the user's other installs |
| `POST /auth/verify` | yes | returns `scopeFingerprint` and `user.clientFacilityId` (built by P21-09 for the PWA, AM-26); the app calls it at the start of every sync cycle |
| `POST /auth/passkey/options`, `/auth/passkey/verify` | yes (P10-10) | § 8: native origins accepted |
| `/webauthn/registration-options`, `/verify-registration` | yes | § 8 |
| `POST /auth/native/sso/start`, `GET /auth/native/sso/authorize`, `POST /auth/native/sso/exchange` | **new** | § 7 |
| `PUT /push-tokens/current`, `DELETE /push-tokens/current` | **new** | § 10 |
| `GET /mobile/config/public`, `GET /mobile/config` | **new** | § 11 |
| `POST /mobile/attestation` | **new** | § 9a |
| `GET /public/tenants/by-code/:code` | **new** | § 2a.1 |
| `POST /public/tenants/discover` | **new** | § 2a.5 (the work-email fallback; **not** `/auth/login/discover`) |
| `POST /mobile/logs` | **new** | § 11a |
| every pre-authentication route above, with `X-Tenant-Code` | changed | § 2a.4 |

The **credential-endpoint table** of `@callibrator/api-client` (a 401 there is about the credential,
never a session end — F-05) gains `/auth/native/sso/exchange` (`../SHARED/03` § 6.2).

## 7. Hospital SSO From the App — PKCE Between App and Backend, an App-Link Return

The backend stays the relying party towards the tenant's IdP exactly as for the web (PKCE, state,
nonce towards the IdP — as built). What a native client adds is **a second PKCE, between the app and
the backend** (RFC 8252 / RFC 7636 shape), because the system browser's cookie jar is not the app's:
the as-built binding cookie cannot prove that the app redeeming the hand-off code is the one that
started the flow.

```text
1. app      POST /native/api/v1/auth/native/sso/start
              { tenantCode, codeChallenge, codeChallengeMethod: "S256", appState }   (§ 2a.3)
            ← 200 { authorizeUrl: "https://<host>/native/api/v1/auth/native/sso/authorize?t=<start id>" }
            (the start id: 128 bits, Redis, 10 min; stores tenant, codeChallenge, appState, installation id)
2. app      openAuthSessionAsync(authorizeUrl, <the registered callback of § 7.1>)   — system browser (06 § 3)
3. browser  GET …/authorize?t=…  → the as-built OIDC/SAML start for that tenant (state, nonce, PKCE to the IdP)
4. browser  IdP sign-in → the as-built callback → the hand-off code is issued AS BUILT (A-60), but the
            store entry also records the start id; the redirect goes to the NATIVE CALLBACK (§ 7.1):
            302 <callback>?code=<one-time>&state=<appState>
5. OS       the auth session returns the callback URL to the app (§ 7.1); the app checks state == appState
6. app      POST /native/api/v1/auth/native/sso/exchange { code, codeVerifier }
            server: GETDEL the code; load its start entry; require S256(codeVerifier) == codeChallenge
                    and the same X-Installation-Id; issue a native session (§ 4) with auth_method sso
            ← 200 login answer (tokens + session), or 401 (one answer for every failure)
```

### 7.1 The callback the system browser returns to (owner decision 2026-10-08)

**Why not "a verified app link" alone:** inside `ASWebAuthenticationSession` an https 302 is **not**
handed to the app as a Universal Link — the session itself must recognise the callback; and Chrome
Custom Tabs hand off App Links on a **redirect** inconsistently. So:

| Platform | Callback |
|---|---|
| **iOS 17.4+** | an **https callback**: `ASWebAuthenticationSession` with `.https(host: <platform host>, path: "/m/sso-return")` — the session completes on that URL without a Universal-Link hand-off |
| **iOS 16 – 17.3** | a **private reverse-domain scheme** (`<reverse-domain app id>:/sso-return`, RFC 8252 § 7.1) used **only** as the auth-session callback; PKCE (the verifier never leaves the app) makes an interception useless; the backend allow-lists exactly that scheme per app variant |
| **Android** | the auth tab / Custom Tab returning to the registered https App Link, with the reverse-domain scheme as the fallback where the browser does not hand off on a redirect |

The final mechanism per platform is decided **after a device spike** (iOS 16, iOS 17.4+, a Samsung and
an aggressive-OEM Android, with Chrome and the OEM browser as defaults) **before P36-05 starts**; the
spike is P36-05's entry item. The backend's allow-list of callbacks is per app variant, in
configuration, and is the only place a non-https callback is ever accepted.

- **One failure answer** for an unknown, spent, expired or mismatched code or verifier: 401 with the
  as-built SSO refusal wording (ADR-100's "one SSO-start refusal" principle carried to the exchange) —
  no oracle of which part was wrong.
- The **app-link return path `/m/sso-return`** is a page of the **frontend** (Next owns every
  non-`/api/` path). If the app is not installed, or the OS does not hand the link to it, the page
  says "Open this link on the phone with the Callibrator app" and **never redeems the code** (no
  script reads it; the page is static and sets `Referrer-Policy: no-referrer`). The code dies unused in
  its TTL (as built: short-lived).
- `start` is public with `requestBudget("ssoStart")` (the as-built budget); `exchange` is public with
  a new `requestBudget("ssoExchange")`; `authorize` is a redirect route with the start id as its only
  input, behind `requestBudget("ssoAuthorize")` (per address; an unknown or spent start id is the same
  refusal as ADR-100's SSO start). All three are reviewed gate exemptions (`public`) with reasons, unmarked for facility scope
  (they have no principal yet), and the bound-user rules apply **after** authentication as for the web
  (`FACILITY_BINDING_PENDING` for a JIT user in a multi-facility tenant — P18-03 § 12).
- **SAML tenants:** the same flow works when the backend runs the SAML leg (the hand-off is the same
  A-60 code); P36-05 tests one OIDC and one SAML tenant end to end.
- **Audit:** the session creation is audited as every sign-in is (`LOGIN`, `auth_method: sso`,
  `client_kind: native`); a failed exchange is logged (no code, no verifier) and counted by its budget.

## 8. Native Passkeys

### 8.1 Origins

`@simplewebauthn/server` verifies `expectedOrigin` and `expectedRPID`. A platform authenticator called
from a native app reports:

- **iOS:** `origin = "https://<RP ID>"` — the same as the web, provided the app's associated domains
  list `webcredentials:<RP ID>` and the AASA file names the app (§ 8.3);
- **Android:** `origin = "android:apk-key-hash:<base64url(SHA-256 of the app's signing certificate)>"`
  — one per signing key (Play app signing key; the upload/internal key for preview builds).

**Target (P36-06):** `WEBAUTHN_NATIVE_ORIGINS` (config, `config/env.ts`; a comma list of the
`android:apk-key-hash:` values for the deployment's app variants) is **added** to the accepted origins
of every ceremony; `WEBAUTHN_RP_ID` stays one value. Unset → native passkeys are refused exactly as
today (no behaviour change for a deployment without the app).

### 8.2 Ceremonies

The as-built routes are reused; through `/native/` the passwordless verify answers tokens (it already
uses `response.util#login`). Registration from the app requires a recent re-authentication as on the
web. A passkey is one credential whatever device created it (synced passkeys work on both clients
because the RP ID is the platform host). **A tenant's custom domain is not the RP ID** — passkeys of a
custom-domain web sign-in are not usable in the app (`06` § 4, stated, not fixed).

### 8.3 The association files

The edge routes `/.well-known/` to the **backend** in every as-built deployment (compose
`vm-http.conf`; Helm `ingress.yaml`; `backend/index.ts` serves `/.well-known` from storage for ACME).
**Target (P36-06):** the backend serves, **before** that static handler:

- `GET /.well-known/apple-app-site-association` — `{"applinks": {"details": [{"appIDs": [...], "components": [{"/": "/verify/*"}, {"/": "/m/sso-return"}, {"/": "/m/setup"}, {"/": "/d/*"}]}]}, "webcredentials": {"apps": [...]}}`;
- `GET /.well-known/assetlinks.json` — two statements per Android app id (`delegate_permission/common.handle_all_urls` and `delegate_permission/common.get_login_creds`) with the signing-certificate fingerprints;

both built from runtime configuration (`MOBILE_IOS_APP_IDS`, `MOBILE_ANDROID_APPS` = package +
fingerprints), `Content-Type: application/json`, no redirect, no authentication, cached briefly;
absent configuration → 404 (no app associated). A test asserts the content against the configuration,
and P36-06's DoD includes Apple's and Google's own validators run against the deployed host.

> **Aligned 2026-10-08:** `05-NATIVE-FEATURES.md` § 5 first placed these files on the frontend;
> its author corrected it to the backend after this section (ADR-134 § B.6).

## 9. Installed-App-Version Compatibility — 426 `APP_UPDATE_REQUIRED`

An installed binary cannot be recalled. The server decides whether an old copy may still talk to it.

- **Configuration (P36-07):** `MOBILE_MIN_VERSION_IOS`, `MOBILE_MIN_VERSION_ANDROID` (semver; unset
  = no floor), `MOBILE_RECOMMENDED_VERSION_IOS/ANDROID`; read at runtime (env + the feature-flag module
  for a change without a restart), exposed by `GET /mobile/config/public`.
- **Middleware `nativeClientPolicy`**, mounted after the request id and before `auth` on `/api/v1`,
  active only for `X-Callibrator-Client: native`:
  - below the floor (or version headers missing while a floor is set) → **426** in the envelope:
    `{ success: false, status: 426, message: "This version of the app is no longer supported. Update the app to continue.", code: "APP_UPDATE_REQUIRED", data: { platform, minVersion } }`;
  - exempt so an old app can still learn and leave cleanly: `GET /mobile/config/public`,
    `POST /auth/logout`, `DELETE /push-tokens/current`;
  - below the recommendation → the request proceeds and the answer carries
    `X-App-Update-Recommended: <version>`.
- **RFC 9110 note:** 426 is defined for protocol upgrades and asks for an `Upgrade` header naming a
  protocol; we send none. The status is used (owner decision) because the app keys on the envelope's
  `code`, and no intermediary acts on 426. Recorded as a known deviation.
- **The OpenAPI document** declares 426 (with the error envelope) on every operation as a shared
  response component, so the generated client types it, and documents the `X-App-*` headers as
  optional request headers.
- **When to raise the floor:** a contract change the old app cannot survive. The capture routes stay
  backward compatible for **30 days of outbox age** (P19-08 § 13); a removal used by the app goes
  through a deprecation window of **at least 90 days** (`08` § 5); a breaking change needs the
  `openapi:breaking` record **and** a floor raise announced through `X-App-Update-Recommended` first.
  A floor never discards an outbox: a 426 stops syncing until the update (`04` § 11).
- **The oldest supported app's contract is a CI input (P36-07):** at each app release the generated
  contract bundle it was built against (`contracts/dist/openapi.json`, ADR-136) is committed as a
  snapshot (`contracts/snapshots/mobile-<version>.json`); `openapi:breaking` runs against the snapshot
  of the **oldest version at or above the floor** as well as against `main`, so a backend change that
  would break an installed, still-supported app fails the build.

## 9a. Device Attestation — the Server Verdict Behind "Offline Mode Refused on a Compromised Device"

`07` § 3 decides: detect a rooted/jailbroken or tampered device, **refuse offline mode** (never block
online use by default), and let the **server's** verdict be the one that refuses **where the platform
gives one**. Target (P36-09). **What each platform can prove differs, and the difference is stated:**

| Platform | Server-verifiable | What it proves | What it does **not** prove |
|---|---|---|---|
| Android | **Play Integrity** verdict | app integrity (`appRecognitionVerdict`) **and device integrity** (`MEETS_DEVICE_INTEGRITY` in `deviceRecognitionVerdict`) | — (within Google's own limits) |
| iOS | **App Attest** | that requests come from a genuine instance of **our app** on an Apple device (app integrity) | **nothing about jailbreak** — App Attest gives **no device-integrity verdict** |

On iOS the jailbreak signal is therefore a **local heuristic only** (advisory; bypassable by anyone
determined), reported to the server as a claim, never as a verdict. **Residual (recorded in ADR-134;
`07`'s author aligns `07`):** on iOS a jailbroken phone that defeats the heuristic can enable offline
mode; the protections left are SQLCipher, the Keychain class, the purge rules and revocation.

- `POST /mobile/attestation` (`auth`, self, native only, facility-accessible; `validate`;
  `requestBudget("mobileAttestation")`) — body: `{ platform, token }` where `token` is a **Play
  Integrity** integrity token (Android, with a server-issued nonce bound to the session family) or an
  **App Attest** assertion (iOS, after a one-time key attestation stored per installation).
- **Verification server-side:** Play Integrity tokens are decrypted and verified through Google's
  `decodeIntegrityToken` API with the deployment's service account (the same Google project as FCM);
  `compromised` = `MEETS_DEVICE_INTEGRITY` absent or the app not recognised. App Attest attestation is
  verified against Apple's App Attest root certificate and the app id, and assertions against the
  stored public key and counter; a failure means **app** integrity failed (`compromised`), a pass means
  `app_ok` — never "device ok". The iOS local jailbreak claim is stored beside it (`jailbreak_claim`)
  and, when true, refuses offline mode as an advisory signal. Verdict on the session family
  (`sessions.integrity_verdict` `varchar(16)`: `ok` (Android: device + app) | `app_ok` (iOS) |
  `compromised` | `unknown`, plus `jailbreak_claim`, `integrity_checked_at`), shown in
  `/sessions/mine` and the administrator's session list.
- **Use:** offline-mode enablement and every 24 h while offline mode is on, the app attests; `GET
  /mobile/config` answers `offlineAllowed: false` with the reason when the verdict is `compromised`,
  and the app purges and turns offline mode off (`04` § 8). `unknown` (attestation unavailable — an old
  phone without Play services, a sideloaded preview build) is a **tenant setting**: allow (default) or
  refuse offline mode.
- **Audit:** a `compromised` verdict writes a security audit row (counts and verdict, no token).
- **Not a gate on online use** in the first release; a tenant policy to block compromised devices
  entirely is a later server setting (`07` § 3).
- **DPIA:** Google's integrity service and Apple's attestation service process device signals — listed
  with the push processors (§ 10.2).

## 10. Push Notifications — Token Registry and Fan-out

### 10.1 The registry (P36-04)

Table `push_tokens` (tenant-scoped, hooks apply; the model follows the camelCase-attribute convention
of every model **except `sessions`** — columns below are named as in the database):

| Column | Rule |
|---|---|
| `id`, `tenant_id` (NOT NULL), `user_id`, `client_facility_id` (filled from the user, ADR-124 Am. 3's database rule) | scoped like every tenant row |
| `session_family_id` | the native session family it belongs to; **sending requires the family to be active** |
| `installation_id`, `platform` (`ios`/`android`), `provider` (`fcm`/`apns`) | |
| `token` | the device token, **encrypted at rest** with the existing secret-attribute mechanism (`models/secretAttributes.ts`); never returned by any API, never in a log or `audit_logs.changes` |
| `token_hash` | SHA-256 for lookups and de-duplication |
| `locale`, `app_version`, `last_seen_at`, `revoked_at` | |
| unique `(tenant_id, installation_id, provider)` | **per tenant — never a global unique** (the cross-tenant oracle trap); one row per install per tenant |

Routes (self, `auth`, native only — a web session gets 403; reviewed gate exemption kind `self`;
**facility-accessible** (bound users use the app); `validate`; audit inside the transaction with
`changes.operation: "PUSH_TOKEN_REGISTERED" | "PUSH_TOKEN_REMOVED"` and no token):

- `PUT /push-tokens/current` `{ provider, token, locale }` — upsert for the caller's installation and
  session family; registering removes the same installation's row for **another user of the same
  tenant** (an install has one user at a time — `04` § 10).
- `DELETE /push-tokens/current` — on sign-out; also removed by logout, family revocation, reuse
  detection, session expiry (a nightly sweep) and the provider's "unregistered" answer.

No `:id` route is added; if an administrator view of a user's devices is added later, it is `:id`
routes with two-tenant and two-facility tests.

### 10.2 Fan-out

- The as-built notification service creates the in-app notification (unchanged). A new **push
  channel** enqueues one `push_deliveries` row per active token of each recipient, **in the same
  transaction** as the notification (an outbox; no push for a rolled-back notification).
- A worker claims due rows with `SELECT … FOR UPDATE SKIP LOCKED` (the as-built webhook outbox
  pattern), sets the tenant context **per job** (never a loop-wide system task — the async audit's
  lesson), and sends:
  - **Android: FCM HTTP v1** (`https://fcm.googleapis.com/v1/projects/<id>/messages:send`) with an
    OAuth2 access token from the service account (`FCM_SERVICE_ACCOUNT_JSON`, a deployment secret);
  - **iOS: APNs** over HTTP/2 with **token-based auth** (`APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
    `APNS_TOPIC` = bundle id; `APNS_ENV` production/sandbox).
- **Payload rule (`05` § 3.2):** `{ "n": "<notification id>", "c": "<category>" }` plus a **generic**
  localised alert chosen by category — never a name, device, serial, QR, facility, room, value, note or
  report number. A server-side test renders every category's payload and fails on any field outside
  that set.
- **Errors:** FCM `UNREGISTERED`/`INVALID_ARGUMENT` on the token, APNs 410/`BadDeviceToken` → delete
  the token row (audited as removal by the system actor); 429/5xx → retry with backoff and jitter up to
  24 h, then drop the delivery (the in-app notification remains); collapse keys per category.
- **Who receives** is the notification service's rule (ADR-124 § 9: a facility's events reach that
  facility's bound users holding the menu and the provider's staff — never another facility's users);
  push adds no recipient. User preferences per category gate the push, never the in-app notification.
- **Data-only `scope_check`** is sent on family revocation, logout-all and a binding change, asking the
  app to call `/auth/verify` early (best effort; `04` § 8).
- **Off by default:** without `PUSH_ENABLED=true` and its credentials, the channel enqueues nothing and
  the boot logs that push is off (no crash, unlike a missing KMS key).
- **DPIA:** Google (FCM) and Apple (APNs) become processors of the token and the generic alert —
  listed in `docs/UPSTREAM/06-DPIA.md` § sub-processors by P36-04 (`07` of this folder; an owner
  confirmation, legal part).

## 11. The Mobile Configuration Read

| Route | Gate | Returns |
|---|---|---|
| `GET /mobile/config/public` | public, `requestBudget("mobileConfigPublic")` | min/recommended versions per platform, the server's kill switches that apply before sign-in (`mobile.enabled`), the verification hosts the app accepts in a scanned URL (`../SHARED/05` § 3) |
| `GET /mobile/config` | `auth`, self (reviewed exemption), facility-accessible | the tenant's mobile settings and flags: `mobile.offline.enabled`, `mobile.backgroundSync.enabled`, `mobile.passkeys.enabled`, `mobile.appLockMinutes` (≤ 5; a tenant may shorten), `mobile.session.absoluteDays`, `field.workingSetMaxDevices`; read through the feature-flag module and tenant settings (a bound user's read of tenant settings uses the reviewed `skipFacilityScope` of P18-03 § 10.2, never `skipTenantScope`) |

Both are cached in memory by the app, never on disk (`01` § 6).

## 11a. App-Log Intake — `POST /mobile/logs` (owner Q-M5: logs go to our own backend; P36-14)

Until a crash-reporting processor is approved (ADR-135), the app uploads its own scrubbed logs, opt-in.

- **Gate:** `auth`, **self**, native only; reviewed exemption kind `self`; **facility-accessible**. The
  row's `tenant_id`, `client_facility_id` and `user_id` are **stamped from the principal**, never read
  from the body; installation id, platform and app version come from the headers.
- **Body** (`contracts/` first): `{ entries: [{ at, level, event, fields }] }` — `event` matches an
  allow-listed pattern (`^[a-z0-9_.:-]{1,64}$`), `fields` are flat string/number/boolean values.
  **Caps:** at most 200 entries and 64 KB per request (413 above); each string at most 512 characters
  (truncated); `requestBudget("mobileLogs")` 30 uploads per hour and 5 MB per day, counted **per
  installation, per user and per session family** — `X-Installation-Id` is client-chosen, so the user
  and family caps are the binding ones (429 above).
- **Untrusted content:** stored as data in a tenant-scoped `mobile_logs` table (hooks apply); **never**
  interpolated into a line of the server's own logger (no log injection — values stay structured
  fields, control characters stripped); **never rendered as HTML** in an administrator viewer (text
  nodes only); no field is treated as a URL.
- **What the app may send** is `01` § 5's scrubbing rule (no body, token, tenant value, free text or
  photo); the server also drops any field whose name is on the redaction list (`token`, `password`,
  `code`, `verifier`, `authorization`, `qr`, `serial`, …) before storing.
- **Retention: 30 days**, purged nightly by the existing data-retention job (a tenant may shorten);
  app logs are diagnostics, not records — a legal hold does not extend them.
- **Read:** the tenant administrator (`audit` read) and the platform operator, through a paged list
  route; no `:id` route in v1 (if added: two-tenant and two-facility tests). A download is audited as
  an `EXPORT`; uploads are not audited row by row.

## 12. Rate Limits

As built, every public auth route has a `requestBudget` that counts successes (ADR-100); the 429 is in
the envelope (Q-53). The app inherits them unchanged (`login`, `mfaSignIn`, `passkey`, `ssoStart`,
`loginDiscover`). New budgets (P36-03 … P36-07), per address and, where present, per installation id:

| Budget | Limit (proposal; tuned with the U-06 load profile) |
|---|---|
| `nativeRefresh` | 60 / 15 min per installation (a background run refreshes at most once) |
| `ssoExchange` | 20 / 15 min per address |
| `ssoAuthorize` | 30 / 15 min per address |
| `pushTokenRegister` | 20 / hour per user |
| `mobileConfigPublic` | 120 / 15 min per address |
| `mobileAttestation` | 10 / hour per installation |
| `tenantByCodeMiss` | 30 / 15 min per address — **404s only** (the enumeration signal, as ADR-100's verify pair) |
| `tenantByCode` | 600 / 15 min per address, every request — loose, for hospitals and carrier CGNAT on onboarding day |
| `tenantDiscoverMiss` / `tenantDiscover` | the same pair for `POST /public/tenants/discover` |
| `mobileLogs` | 30 uploads / hour and 5 MB / day per installation — **and** per user and per session family (the installation id is client-chosen, so it alone bounds nothing) |

## 13. Audit, Scope and Tests — the Phase 36 Rules

- **Audit inside the transaction** for: native session creation (as every sign-in), family revocation
  and reuse detection, push-token registration/removal, SSO exchange success. **Never** a token,
  verifier, code or device token in `audit_logs.changes` (the redaction test lists them — and is not
  generated from the redactor's own key set).
- **Facility scope:** every new authenticated route is **self** and marked facility-accessible
  (`FACILITY_ACCESSIBLE_ROUTES`, kind `self`, with its reason); the public ones have no principal.
  Bound users get exactly what unbound users get on these routes — their own installation's rows.
- **Two-tenant / two-facility tests:** no new `:id` route in this design; the guard
  `twoTenantRoutes.guard` keeps it so. The self routes get a two-tenant test that a user of tenant B
  cannot touch tenant A's push row by sending A's installation id (the hooks scope it: 404 / no-op).
- **Super admins refused at native issuance (Q-M6):** a super admin's valid credentials through every
  issuing route (login, MFA, passkey verify, first-sign-in, SSO exchange, refresh) → the generic 401;
  the edge strips `X-Tenant-Id`/`X-Tenant-Code` (a live test through nginx shows neither reaches the
  backend) and the middleware ignores them for native sessions (unit test).
- **Passkey tenant at verify:** `allowCredentials` stays empty in the options (test); an assertion of a
  user in another tenant than the hint → the generic 401.
- **Work-email discovery (§ 2a.5):** a claimed domain → `{ code }` only (key-set test); unclaimed,
  public-mail, malformed, inactive → identical 404s; no cookie set, no SSO state written (Redis
  inspected); both budgets.
- **App logs (§ 11a):** tenant/facility/user stamped from the principal whatever the body says; caps
  (413/429); a `<script>` and a CRLF in a field stored inert and never echoed into the server log;
  the 30-day purge.
- **Tenant setup tests (§ 2a, P36-11/12):** the two-tenant test of the by-code lookup; the
  **uniform 404** (unknown, suspended, offboarded, deleted, mobile-disabled — identical bodies and
  headers, compared byte for byte); the **rate limit pair** (the miss budget + 1 404s → 429; the loose
  budget lets hits through past the miss limit); the **no-secret-fields** test (§ 2a.1); the case-insensitive match; the settings gate's 409
  `TENANT_CODE_REQUIRED` both ways; the cross-tenant sign-in 401 identical to a wrong password; a
  tenant-A bearer with a tenant-B hint still sees tenant A only. The setup link's fallback page
  `/m/setup` (frontend) shows the code and "open in the app", and performs no lookup.
- **Live tests** on PostgreSQL 18 as `callibrator_app`: the `sessions` migration up/down/up; the
  `push_tokens` constraints; reuse detection end to end; the native ingress through nginx on the
  compose stack (cookie stripped, `Origin` refused, tokens returned).
- **E2E:** the app's Maestro suite against a compose stack (`09`), plus new live specs in
  `make test-e2e` for the native routes (through `/native/`).
- **Contract first (ADR-136):** every route, header, response and `code` above is in `contracts/`
  before the Node implementation, and the Go variant (`21`) implements the same files; every new route
  is generated from them (`contract:generate`, `contract:check`) and passes its module's conformance suite; `openapi:check`, `openapi:lint`,
  `openapi:breaking` (additive only) pass; `@callibrator/api-client` regenerated; P36-08 publishes
  `x-facility-accessible` on every operation (`../SHARED/05` § 5).

## 13a. Stable Machine Error Codes (in `contracts/`)

Every refusal a native client must act on carries a **stable `code`** in the error envelope, defined in
`contracts/` (ADR-136) and switched on by `@callibrator/api-client` (`../SHARED/03` § 6.2) and the
i18n `errors.*` keys. Codes are never renamed; a retired code stays reserved.

| `code` | Status | Where |
|---|---|---|
| `APP_UPDATE_REQUIRED` | 426 | § 9 |
| `SESSION_REVOKED` | 401 | § 5 (reuse, installation mismatch, revoked family) |
| `REFRESH_RACE` | 401 | § 5 rule 2a |
| `NATIVE_BROWSER_REFUSED` | 403 | § 3 (browser request on the native ingress) |
| `NATIVE_CLIENT_REQUIRED` | 403 | § 10.1 (a web session on a native-only route) |
| `TENANT_CODE_REQUIRED` | 409 | § 2a.2 |
| `INVALID_CREDENTIALS` | 401 | § 2a.4 — the one generic answer (wrong password, wrong tenant, unknown code) |
| `SSO_EXCHANGE_FAILED` | 401 | § 7 — the one answer for every exchange failure |
| `SESSION_EXPIRED_ABSOLUTE` | 401 | § 5 rule 4 — the 30-day limit; a re-sign-in prompt, outbox kept |
| `TENANT_NOT_FOUND` | 404 | §§ 2a.1, 2a.5 — the one uniform answer of both public tenant lookups |
| `OFFLINE_NOT_ALLOWED` | — (a `/mobile/config` field reason) | § 9a |
| `PASSWORD_CHANGE_REQUIRED`, `MFA_ENROLMENT_REQUIRED` | 403 | **as built** (A-123, A-160) |
| `SCOPE_LOSS_CODES`, the IPM conflict codes, the idempotency codes | 403 / 409 | **target, not built** — specified by P19-02 / P19-08, built by P21-02/03/09 |

## 14. Threats Specific to Native Clients

| Threat | Control |
|---|---|
| A stolen phone's refresh token used elsewhere | installation binding + reuse detection revoke the family (§ 5); the user or an administrator revokes; 30-day absolute limit |
| A script on the web origin harvesting tokens through `/native/` | cookies stripped; `Origin` refused; the backend authenticates by bearer only (§ 3) |
| A malicious app intercepting the SSO return | verified HTTPS app links only; the code is useless without the verifier that never left the app (§ 7) |
| A push alert leaking patient-adjacent data on a lock screen | payload rule + test (§ 10.2) |
| An old, vulnerable binary in the field | the version floor (§ 9) |
| Version headers spoofed | they only add restrictions; nothing is granted by them |
| Push-token oracle across tenants | per-tenant uniqueness; no global constraint; no API returns a token |

## 15. Bad Implications

- A second ingress path to maintain in compose, Helm and every deployment's edge; forgetting it in a
  deployment means "the app cannot connect", found at install time.
- The `sessions` table grows five columns and a family concept the web uses only for display; a
  session list now mixes browsers and phones.
- Reuse detection will occasionally sign out a legitimate phone (a crash between the server's rotation
  and the app's secure write — `../SHARED/03` § 5). The outbox survives; the user re-enters a password.
- Push adds two processors (Google, Apple) to the DPIA and two sets of deployment secrets.
- 426 is used outside its RFC meaning (§ 9).
- Tenant custom domains get neither app links nor app passkeys (§ 8.2) — a limit of build-time
  association, not a defect to fix in the backend.
