# Phase 36 — Backend for Mobile (Node Variant; the Go Variant Follows Phase 999)

> Part of the **mobile group, Phases 35 … 40 (one plan)** (index, build order, group-wide DoD and
> owner questions: [Phase 35](./PHASE-35-SHARED-PACKAGES.md)). Spec:
> [`docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md`](../docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md) · ADR-134 § B.
> The Go variant of this phase is planned after Phase 999 (Phase 1000+, by its author — the backend for mobile is the one part of the mobile plan with two variants).
>
> ← [Phase 35 — Shared Packages](./PHASE-35-SHARED-PACKAGES.md) · [Phase 37 — Mobile App Foundation](./PHASE-37-MOBILE-APP-FOUNDATION.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 14 cards: 14 BLOCKED (written 2026-10-08; nothing built; P36-14 added by audit round 1) |
| **Goal** | today's TypeScript backend serves a native client: an ingress that does not strip tokens, tenant setup before sign-in, install sessions with rotation and reuse detection, hospital SSO through an app link, native passkeys, push, a version floor, attestation — without weakening any web rule |
| **Depends on** | **Phase 34 DONE** (the contract group, ADR-136); P35-06 for every card that changes the contract (the regenerated client) |
| **Size** | L |
| **Cards** | 14: P36-01 … P36-14 (P36-14 sits before the exit card P36-13 in this file) |
| **Definition of Done** | the global DoD + the group-wide DoD ([Phase 35 § 2](./PHASE-35-SHARED-PACKAGES.md)); every new route: gate or reviewed exemption, `*.openapi.ts`, facility-scope decision, audit inside the transaction, two-tenant/two-facility tests where it has a path parameter |

**Rules for every card here:** the route, headers, responses and stable `code`s are written into the
contract-first `contracts/` folder (ADR-136; `docs/MOBILE/20` § 13a) **before** the Node implementation;
the Go variant (after Phase 999) implements the same files. The web's session model (ADR-059, A-71) is not touched; the `sessions`
model's attributes are **snake_case** (the `CLAUDE.md` trap); no token, verifier, code, device token or
attestation token in a response it should not be in, a log, or `audit_logs.changes`; grants and
triggers tested as `callibrator_app` on PostgreSQL 18.

## Cards

### P36-01 — The native ingress `/native/api/` in compose and Helm

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | Phase 34 DONE (Q-58 decided by the owner 2026-10-08: the `/native/` path prefix) |
| **Spec refs** | `docs/MOBILE/20` § 3 · `deploy/compose/nginx/{vm-http,default}.conf` · `deploy/helm/callibrator/templates/ingress.yaml` · ADR-106 |
| **Spec required** | no |

**Why:** the Next proxy strips tokens by design; a phone has no other path to them.

**Definition of Done**
- [ ] Both nginx files and the Helm ingress route `/native/api/` to the backend with the prefix rewritten, `Cookie` stripped, `X-Callibrator-Client: native` set (overwriting client input)
- [ ] Backend middleware reads the marker into the request; a request with `Origin` or `Sec-Fetch-Mode` on the native ingress → 403 — **after** proving on an Android and an iOS build that React Native's `fetch` sends neither (if one does, the rule is dropped and recorded)
- [ ] Live test on the compose stack: login through `/native/` returns tokens; through `/api/` it does not (A-71 still holds); a browser-shaped request to `/native/` is refused
- [ ] Helm validated on the kind cluster (stated as kind-only, U-01)

**Abuse cases**
- Routing `/native/` through Next "to reuse the proxy", with token stripping turned off for it

### P36-02 — Install sessions: client kind, family, installation, device name

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01 |
| **Spec refs** | `docs/MOBILE/20` § 4 · `backend/src/models/session.model.ts` · `routes/api/session.route.ts` · `docs/MOBILE/06` § 7 |
| **Spec required** | no |

**Why:** a phone must appear as one session a user or administrator can see and revoke.

**Definition of Done**
- [ ] Migration adds `client_kind`, `family_id`, `installation_id`, `platform`, `app_version`, `app_build` (snake_case), existing rows `web`; verified by inspecting columns, not the log; up/down/up live
- [ ] Rotation copies `family_id`; revoking any session of a family revokes the family (self and administrator paths), audited
- [ ] `/sessions/mine` and the super-admin list return the new fields (contract additive); `device` filled from `X-Device-Name`, truncated, never trusted
- [ ] `/sessions/mine/:id/revoke` two-tenant test still green; a revoke of another user's family → 404

**Abuse cases**
- Writing `familyId` on the `sessions` model ("column does not exist" — the trap)

### P36-03 — Native refresh: reuse detection, the race rule, installation binding, absolute lifetime

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-02 (Q-59 decided by the owner 2026-10-08: 30 days absolute, tenants may shorten; Q-60: native only) |
| **Spec refs** | `docs/MOBILE/20` § 5 · `auth.service.ts#refreshUserToken` · `docs/MOBILE/21` § 5 (the Go port depends on these semantics) |
| **Spec required** | **yes** — `MEMORY/specs/P36-03-native-refresh.md`: the state table (fresh, rotated < 5 s same install, rotated otherwise, other install, revoked, expired, absolute limit) with the answer and side effect of each |

**Why:** rotation without reuse detection lets a stolen refresh token live as long as the victim's.

**Definition of Done**
- [ ] `SELECT … FOR UPDATE` on the session row; every row of the spec's state table implemented and tested; 10 concurrent refreshes of one token → exactly one rotation, the rest `REFRESH_RACE`, no family revocation (named test)
- [ ] Reuse and installation mismatch revoke the family, delete its push tokens, audit `REFRESH_TOKEN_REUSE` — **mutation-checked**
- [ ] Absolute 30-day limit per native family; tenant setting `mobile.session.absoluteDays` may only shorten it
- [ ] Web families unchanged (their refresh tests unchanged and green)
- [ ] `requestBudget("nativeRefresh")`

**Abuse cases**
- Treating every reuse as a race "to avoid sign-outs", which disables the control

### P36-04 — Push-token registry and FCM/APNs fan-out

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-02 |
| **Spec refs** | `docs/MOBILE/20` § 10 · `docs/MOBILE/05` § 3 · the webhook outbox (`webhookDeliveryScheduler`) · `docs/UPSTREAM/06-DPIA.md` |
| **Spec required** | no |

**Why:** field and facility users need sign requests and due reminders without a socket on the phone.

**Definition of Done**
- [ ] `push_tokens` with per-tenant uniqueness (no global unique), the token encrypted through `secretAttributes`, never returned; `PUT`/`DELETE /push-tokens/current` (self, native only, facility-accessible, audited without the token)
- [ ] `push_deliveries` outbox written in the notification's transaction; worker with `FOR UPDATE SKIP LOCKED` and per-job tenant context; FCM HTTP v1 and APNs token auth; the error table; off without `PUSH_ENABLED` and credentials (boot logs it, no crash)
- [ ] The payload test: every category's payload holds only `n`, `c` and a generic alert — written from `05` § 3.2, not from the serializer
- [ ] Data-only `scope_check` on family revocation, logout-all and binding change
- [ ] Two-tenant test: tenant B cannot touch tenant A's row by sending A's installation id
- [ ] The DPIA's sub-processor list updated (Google FCM, Apple APNs) — the legal confirmation named as the owner's

**Abuse cases**
- A "helpful" alert that includes the device name — the lock screen is public

### P36-05 — Hospital SSO from the app: start by tenant code, authorize, native callback, exchange

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-02, P36-11 |
| **Spec refs** | `docs/MOBILE/20` §§ 2a.3, 7, 7.1 · RFC 8252 § 7.1 · `controllers/sso.controller.ts` (`startSsoFor`, hand-off A-60) · `docs/MOBILE/06` § 3 · ADR-100 |
| **Spec required** | no |

**Why:** a system browser cannot hand a cookie-bound hand-off code to an app; app-to-backend PKCE proves the redeemer started the flow.

**Definition of Done**
- [ ] **Entry item — the device spike (owner decision 2026-10-08):** iOS 16, iOS 17.4+, a Samsung and an aggressive-OEM Android, Chrome and the OEM browser as defaults; the callback per platform fixed from it (`20` § 7.1: https callback on iOS 17.4+ via `.https(host:path:)`; a private reverse-domain scheme only as the auth-session callback on iOS 16 – 17.3; Android per the spike) and recorded before any code
- [ ] `POST /auth/native/sso/start` `{ tenantCode, codeChallenge, S256, appState }` reusing `startSsoFor`; `GET …/authorize`; the callback redirects native flows only to the per-variant allow-listed callbacks; a dev-only custom scheme only in development builds
- [ ] `POST /auth/native/sso/exchange` `{ code, codeVerifier }`: GETDEL, S256 check, installation match, one 401 for every failure (test per failure, bodies identical)
- [ ] `/m/sso-return` frontend page: static, `Referrer-Policy: no-referrer`, never redeems
- [ ] One OIDC and one SAML test tenant end to end on the compose stack
- [ ] Budgets `ssoStart` (as built) and `ssoExchange`; added to the client's credential-endpoint table

**Abuse cases**
- Accepting a code without the verifier "for SAML tenants"

### P36-06 — Native passkeys and the association files

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01; Q-M1, Q-M2 (app ids and hosts) answered |
| **Spec refs** | `docs/MOBILE/20` § 8 · `services/webauthn.service.ts` · `backend/index.ts` (`/.well-known` static) · `docs/MOBILE/05` § 5 (to be aligned: the files are served by the backend) |
| **Spec required** | no |

**Why:** an Android app's WebAuthn origin is not a URL; app links and passkeys need the association files.

**Definition of Done**
- [ ] `WEBAUTHN_NATIVE_ORIGINS` accepted in every ceremony; unset → today's behaviour (test both)
- [ ] `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` served by the backend before the static handler, from runtime configuration, `application/json`, no redirect; content asserted against configuration; Apple's and Google's validators run against the deployed host (named in the record)
- [ ] Passwordless passkey through `/native/` returns tokens; registration requires recent re-authentication

**Abuse cases**
- Adding the Android origin to `WEBAUTHN_ORIGIN` by string concatenation, widening the web's check

### P36-07 — Version floor (426), mobile configuration reads, contract snapshots

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01, P35-06 |
| **Spec refs** | `docs/MOBILE/20` §§ 9, 11 · `docs/MOBILE/08` § 5 · ADR-103 (`openapi:breaking`) |
| **Spec required** | no |

**Why:** an installed binary cannot be recalled; the server decides what may still talk to it.

**Definition of Done**
- [ ] `nativeClientPolicy`: 426 `APP_UPDATE_REQUIRED` envelope below the floor (and for missing headers while a floor is set); the three exemptions; `X-App-Update-Recommended`; native-only (a web request is never 426)
- [ ] 426 and the `X-App-*` headers in the OpenAPI document as shared components
- [ ] `GET /mobile/config/public` (public, budget) and `GET /mobile/config` (self, facility-accessible) as specified
- [ ] `openapi-snapshots/mobile-<version>.json` mechanism and `openapi:breaking` against the oldest supported snapshot in CI

**Abuse cases**
- Exempting the capture routes from 426 "so old phones can still sync" — a floor exists because those builds are unsafe

### P36-08 — `x-facility-accessible` in the OpenAPI document

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-06 |
| **Spec refs** | `docs/SHARED/05` § 5 · ADR-124 Am. 1 §§ 3, 8 · `MEMORY/specs/P18-03-facility-scope-permissions.md` |
| **Spec required** | no |

**Why:** clients hide unmarked writes from bound users; the list must reach them from the one constant the gate reads.

**Definition of Done**
- [ ] Every operation carries `x-facility-accessible: true|false` generated from `FACILITY_ACCESSIBLE_ROUTES` (no second list); a test fails if the document and the constant disagree
- [ ] `canInvoke` (domain) reads it from the generated types; the web's per-page bound tests still green

**Abuse cases**
- Hand-annotating operations in `*.openapi.ts`

### P36-09 — Device attestation (Play Integrity device + app verdict; App Attest app integrity only)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-02, P36-07 |
| **Spec refs** | `docs/MOBILE/20` § 9a · `docs/MOBILE/07` § 3 |
| **Spec required** | **yes** — the verification steps per platform, nonce binding, the verdict states and the tenant setting for `unknown` |

**Why:** offline mode on a compromised device defeats data-at-rest protection; the server's verdict decides.

**Definition of Done**
- [ ] `POST /mobile/attestation` with server-side verification on both platforms; verdict on the family (`ok` Android device + app, `app_ok` iOS, `compromised`, `unknown`, plus `jailbreak_claim`); `/mobile/config` answers `offlineAllowed` with the reason
- [ ] **No device-integrity claim is derived from App Attest** (a test asserts an iOS pass yields `app_ok`, never `ok`); the iOS jailbreak signal is the app's local heuristic, stored as an advisory claim; the iOS residual is recorded in `07` and ADR-134
- [ ] Recorded real-device fixtures (Android, iOS) and a refused tampered fixture; a `compromised` verdict audited
- [ ] DPIA processors listed (owner's legal confirmation named)

**Abuse cases**
- Trusting a client-side root check as the verdict

### P36-10 — Security review and threat-model rows of the native surface

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01 … P36-09, P36-11, P36-12, P36-14 |
| **Spec refs** | `docs/MOBILE/20` § 14 · `docs/MOBILE/07` § 2.2 · `docs/SECURITY/15` · `docs/SECURITY/11-SECURITY-TESTING.md` |
| **Spec required** | no |

**Why:** a new client type is a new trust boundary.

**Definition of Done**
- [ ] The native threat rows merged into `docs/SECURITY/15` (or a new `16`, decided in the record) with the control and the named test for each
- [ ] A review of every new route against `14-CODE-REVIEW-CHECKLIST`; findings fixed or recorded with an owner

**Abuse cases**
- A threat row whose "control" is a document rather than a test

### P36-11 — Tenant setup before sign-in: lookup by code and the `tenants.code` gate

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01 |
| **Spec refs** | `docs/MOBILE/20` §§ 2a.1, 2a.2 · `tenant.service.ts#getPublicBranding` · `tenant.model.ts` (`code`) · ADR-098 (discovery residual) · ADR-100 (budgets) · owner decision 2026-10-08 |
| **Spec required** | no |

**Why:** the app must brand itself and offer the right sign-in methods before anyone signs in (owner decision).

**Definition of Done**
- [ ] `GET /public/tenants/by-code/:code`: branding + public auth config only (field names as `20` § 2a.1 — authoritative); active, mobile-enabled tenants; uniform 404; the budget **pair** — `tenantByCodeMiss` (404s only, strict) and `tenantByCode` (all, loose: CGNAT); ETag/304; case-insensitive match
- [ ] `POST /public/tenants/discover { email }` (owner decision 2026-10-08, `20` § 2a.5): `{ code }` only for a super-admin-claimed domain (`tenant_settings.sso_email_domains`) of an active mobile-enabled tenant; the generic 404 otherwise; never starts SSO, sets no cookie; the same budget pair; the larger ADR-098 residual recorded
- [ ] Migration `UNIQUE (lower(code)) WHERE code IS NOT NULL`, refusing to run on a case collision (dry run first); columns inspected
- [ ] Settings gate: `mobile.enabled` refused with 409 `TENANT_CODE_REQUIRED` while the code is unset or invalid, and clearing a mobile tenant's code refused
- [ ] Tests named in the record: two-tenant, uniform-404 (bytes and headers compared), the rate-limit pair (miss limit + 1 → 429; hits pass beyond it), **no-secret-fields** (written from the spec's field list), case-insensitivity, the gate both ways, discovery's key set and its no-cookie/no-SSO-state check
- [ ] `/m/setup` frontend fallback page (shows the code, "open in the app", no lookup); added to the association files' paths (P36-06)

**Abuse cases**
- A 404 for a suspended tenant that differs in body or timing from an unknown code
- Returning the IdP client id "because it is not secret" — the field list is closed

### P36-12 — Sign-in scoped by the tenant hint (`X-Tenant-Code`)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-11 |
| **Spec refs** | `docs/MOBILE/20` § 2a.4 · `middlewares/auth.middleware.ts` (tenant headers super-admin only) · `controllers/auth.controller.ts`, `publicAuth.controller.ts` |
| **Spec required** | no |

**Why:** one install serves one tenant; an account of another tenant must not sign in there, and must not learn that it exists.

**Definition of Done**
- [ ] Login, MFA login, passkey verify and the SSO exchange narrow the account lookup by the hint; a wrong-tenant account, an unknown or inactive code → the **same** generic 401 as a wrong password (body, status, budget count compared)
- [ ] Passkey options keep `allowCredentials` **empty** (as built); the tenant is enforced at **verify** (a credential of a user outside the hinted tenant → the generic 401) — a test asserts the options carry no credential id
- [ ] **Super admins refused at every native-issuing route** (owner Q-M6) with the generic 401; the native ingress moves `X-Tenant-Code` into `X-Callibrator-Tenant-Hint` and strips `X-Tenant-Code`/`X-Tenant-Id` (live test through nginx); the middleware ignores the override headers for native sessions
- [ ] The auth middleware's handling of tenant headers **unchanged** — a tenant-A bearer with a tenant-B hint sees tenant A only; a tenant-B `:id` → 404 (named guard test)
- [ ] Web sign-in unchanged (no hint)

**Abuse cases**
- Using the hint after authentication "as a convenience" — the token's tenant is the authority

### P36-14 — App-log intake (owner Q-M5: logs go to our own backend)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-02 |
| **Spec refs** | `docs/MOBILE/20` § 11a · `docs/MOBILE/01` § 5 · `docs/SECURITY/08` · the data-retention job |
| **Spec required** | no |

**Why:** until a crash-reporting processor is approved, field problems must be diagnosable without sending data to a third party.

**Definition of Done**
- [ ] `POST /mobile/logs` in `contracts/` first; self, native only, facility-accessible; tenant, facility and user stamped from the principal
- [ ] Caps (200 entries, 64 KB, 512-character strings), `requestBudget("mobileLogs")`; the redaction list applied before storage
- [ ] Untrusted content: stored structured; never interpolated into the server's log lines; rendered as text only in the administrator view — tests with a `<script>` and a CRLF in a field
- [ ] 30-day purge by the data-retention job (a tenant may shorten); the administrator read route paged, its download audited as `EXPORT`

**Abuse cases**
- Taking `tenantId` from the uploaded entry "because the app knows it"
- Rendering a log field in an HTML viewer "for formatting"

### P36-13 — Phase exit

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P36-01 … P36-12, P36-14 |
| **Spec refs** | `TASKS/00-TASK-CONVENTIONS.md` · `docs/PLAN/16` § Definition of Phase Complete |
| **Spec required** | no |

**Definition of Done**
- [ ] `make verify` green; live E2E (with the new native specs through `/native/`) twice, one uninterrupted run each; images built and booted; an upgrade boot from the previous release image proves the migrations
- [ ] `docs/MOBILE/20` swept to as built; `docs/MOBILE/21` amended with anything the Node build changed (the Go port's spec)
- [ ] Phase summary in `MEMORY/`; `PROGRESS.md` updated

**Abuse cases**
- Native specs run against the backend directly instead of through the ingress the phone uses
