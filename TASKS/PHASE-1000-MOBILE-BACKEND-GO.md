# Phase 1000 — Backend for Mobile on the Go Engine (the Go Variant)

> **Restructured 2026-10-08 (owner decision, ADR-136):** the mobile app and the shared packages are
> **one plan** (Phases 35 … 40), independent of the backend language. Only the **backend-for-mobile**
> work has a Node variant ([Phase 36](./PHASE-36-MOBILE-BACKEND-NODE.md)) and this Go variant. The
> former `PHASE-1000-SHARED-PACKAGES-GO` and `PHASE-1002-MOBILE-APP-GO` were dropped: their contract
> parts moved to the contract group (golden vectors → P32-09, the validation corpus and replay checks →
> the conformance suite, Phase 33), and their app proofs became cards here (P1000-15, P1000-16). This
> file was `PHASE-1001-MOBILE-BACKEND-GO`; its cards were `P1001-xx` and are now `P1000-xx`, same numbers.
>
> Specification: [`docs/MOBILE/21-BACKEND-FOR-MOBILE-GO.md`](../docs/MOBILE/21-BACKEND-FOR-MOBILE-GO.md)
> (the Go implementation) and [`docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md`](../docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md)
> (the capabilities as first built on Node). The contract: [`docs/CONTRACT/`](../docs/CONTRACT/00-README.md).
>
> ← [Phase 999 — Go, module by module](./PHASE-999-GO-MIGRATION-AND-DUAL-BACKEND.md)

| | |
|---|---|
| **Status** | **BLOCKED** — 16 cards, 16 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | the backend-for-mobile modules served by the Go engine **through the gateway, module by module**, at 100% conformance; installed apps survive a module's move between engines in **both** directions |
| **Depends on** | Phase 34 DONE (the contract group); Phase 36 DONE (the capabilities exist in the contract and on Node); the Go engine's foundation in Phase 999 (its gateway-ready bootstrap, auth verification through JWKS, tenant and facility isolation) |
| **Size** | L |
| **Cards** | 16: P1000-01 … P1000-16 (P1000-14 tenant setup; P1000-15, P1000-16 moved in from the dropped app phase; the close-out stays P1000-13) |
| **Definition of Done** | the global DoD + [`docs/CONTRACT/07`](../docs/CONTRACT/07-PORTING-PLAYBOOK.md) § 7 (a module port's checklist) + `docs/BACKEND/12` § 9 |

## Identical, Different

- **Identical — by contract, not by diff:** paths under the native ingress, request and response
  shapes, status codes, error `code`s, headers, token lifetimes and rotation semantics, the push payload
  rule, the minimum-version policy, tenant setup. All of it lives in `contracts/` (ADR-136). The app
  cannot tell the engines apart, by design, and **there is no app or package work in this phase**.
- **Different:** the implementation (Go handlers; `pgx`/`sqlc` repositories with the tenant **and**
  facility predicates in every query — `docs/BACKEND/12` § 4, ADR-124 § 8), the push sender (a Go
  worker for FCM HTTP v1 and APNs), the attestation verifiers, and **continuity**: sessions,
  refresh-token families, push registrations, idempotency rows and Redis keys written by one engine
  must be honoured by the other, because a module can move between engines with apps installed.
- **How a card is done:** the module's conformance score on Go is **100%** on the current contract
  version (`docs/CONTRACT/06` § 4), plus the card's own DoD. The old "byte parity against the
  TypeScript engine" (P999-16) remains a diagnostic where the contract is silent, never the proof.
- **The order with Node** no longer matters for clients: the capabilities are specified once in
  `contracts/` and implemented on Node in Phase 36. If Go reached a capability first, it would still be
  implemented on Node before any deployment routes it (ADR-089: Node stays supported).

---

## Cards

### P1000-01 — The native ingress on a Go deployment

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | Phase 34 DONE · P999 Go foundation (bootstrap, JWKS verification, isolation) |
| **Spec refs** | `docs/MOBILE/20` (the native ingress prefix and why) · `docs/MOBILE/21` · `docs/SHARED/03-API-CLIENT.md` § 5 · `docs/CONTRACT/07` § 2 (the gateway, per operation) · P999-20, P999-22 · memory `callibrator-deployment-gotchas` (the frontend owns `/api/`) |
| **Spec required** | no |

**Why:** the app reaches the backend directly on `https://<host>/native/api/v1/…`, never through the
Next proxy. On a Go deployment the edge (nginx / Cloudflare tunnel / Helm ingress) must route that
prefix to the Go engine with the same rewriting, limits and headers as for the TS engine.

**Definition of Done**
- [ ] The gateway's routing table (P34-04) sends the native prefix of each mobile module to the engine that serves it; moving a module is a routing change, never a client change
- [ ] Request-size limits, timeouts, `X-Request-Id`, client-IP forwarding and the rate-limit identity identical to the TS deployment (asserted by a live test on both)
- [ ] `/.well-known/apple-app-site-association` and `assetlinks.json` are served by the **backend** (as built, `backend/index.ts` mounts `/.well-known`; `docs/MOBILE/20` § 8.3): the Go engine serves both (from the same runtime configuration) whenever the gateway routes `/.well-known` to it, beside the ACME challenge files — and **Apple's and Google's own validators are run against the deployed host after every routing change** of that path (named run)

**Abuse cases**
- Exposing the Go engine's internal origin to the app "temporarily"
- A Go-only ingress rule that the TS deployment lacks

### P1000-02 — Native sign-in: password, MFA, bearer + rotating refresh, reuse detection

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-01 · P999-07 |
| **Spec refs** | `docs/MOBILE/20` (auth surface, rotation, reuse detection) · `docs/MOBILE/21` · `docs/MOBILE/06-AUTH-FLOWS.md` § 2, § 6 · `docs/SECURITY/03` · ADR-119 (the JWT key ring) · ADR-059 (the web never holds a token — unchanged) |
| **Spec required** | no (the contract is specified in `20`) |

**Why:** the app's whole session model rests on this: short access tokens, a refresh token that rotates
on every use, and a reused old token revoking the family. A Go refresh that does not detect reuse
removes the control that makes rotation worth its cost.

**Definition of Done**
- [ ] Login, MFA step, first-sign-in password, `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED` codes, refresh, logout, logout-all on the native surface — parity with TS (contract suite + parity diff)
- [ ] Rotation: the old refresh token is refused after use; **reuse of an old token revokes the session family** on Go, with an audit row — tested both ways, mutation-checked (disable the reuse check → the named test fails)
- [ ] Rate-limit budgets (login, MFA, refresh) identical to TS
- [ ] No token in any Go log line, error body or audit `changes` (a scan test over the log output of the suite)
- [ ] Two-tenant: a token of tenant A presented with any id of tenant B → 404 on every `:id` route the app uses
- [ ] **No native session for a super admin** (owner decision (C), Q-M6): every native token-issuing route (sign-in, MFA, refresh, SSO exchange, passkey) answers a super-admin principal with the generic 401 on Go exactly as on Node — a conformance check
- [ ] The native ingress on Go moves `X-Tenant-Code` into `X-Callibrator-Tenant-Hint` and strips `X-Tenant-Code` / `X-Tenant-Id` (`20`)

**Abuse cases**
- Long-lived access tokens "for mobile convenience"
- Reuse detection implemented as "refuse the old token" only, without revoking the family

### P1000-03 — Install sessions, "my sessions", and `POST /auth/verify` with the scope fingerprint

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 |
| **Spec refs** | `docs/MOBILE/20` · `docs/MOBILE/06` § 1, § 7 · `MEMORY/specs/P19-08-offline-field-capture.md` § 9.5 (`scopeFingerprint`, AM-26) · P18-03 § 8.1 S-1, S-2 · ADR-124 Am. 2 § 6 (a binding change revokes sessions — AM-1) |
| **Spec required** | no |

**Why:** the user and the administrator revoke a lost phone through its session row; the phone purges
its working set on the fingerprint and the revocation. Every one of those signals must be identical on Go.

**Definition of Done**
- [ ] A session row per install with the device label; listed in `GET /sessions/mine`, revocable by the user and by an administrator; revocation answered 401 at the next refresh on Go
- [ ] `POST /auth/verify` returns `scopeFingerprint` and `user.clientFacilityId` with the TS algorithm (golden vectors of P32-09, `contracts/vectors/`)
- [ ] A binding change, a facility leaving `active`, a deactivation and a tenant suspension revoke sessions and produce the `SCOPE_LOSS_CODES` on Go exactly as on TS (the conformance suite's scope-loss checks, Phase 33, run here as the owning card)
- [ ] `sessions` model trap respected (`tenant_id`, snake case — `CLAUDE.md` § Traps)

**Abuse cases**
- A fingerprint that hashes only the tenant (a facility move goes unnoticed — FT-96)

### P1000-04 — The SSO app-link exchange (OIDC, PKCE)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 |
| **Spec refs** | `docs/MOBILE/20` (start URL, one-time code, exchange) · `docs/MOBILE/06` § 3 · RFC 7636, RFC 8252 · `backend/src/routes/api/auth.route.ts` (the web OIDC routes, as built) · P18-03 § 12 (bound-ness from the user row; JIT pending) |
| **Spec required** | no |

**Definition of Done**
- [ ] The mobile SSO start, the IdP leg and the redirect to the app-link path with a one-time, short-lived, single-use code; the exchange requires the PKCE `code_verifier` (S256 only) — parity with TS
- [ ] Negative tests: wrong verifier, reused code, expired code, mismatched redirect, a `plain` challenge → refused identically on both engines
- [ ] JIT users of a multi-facility tenant refused with `FACILITY_BINDING_PENDING` on Go
- [ ] A live test against a test IdP in the compose stack, run against both engines

**Abuse cases**
- Accepting a custom-scheme redirect in production
- A code usable without the verifier "for older app versions"

### P1000-05 — Native passkeys

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 |
| **Spec refs** | `docs/MOBILE/20` (native ceremonies) · `docs/MOBILE/06` § 4 · ADR-108 (+ Am. 1, several passkeys per user) · `backend/src/services/webauthn.service.ts` (`WEBAUTHN_RP_ID`) |
| **Spec required** | no |

**Definition of Done**
- [ ] Registration and authentication ceremonies for native clients on Go, with the same RP ID, origin rules (the Android `android:apk-key-hash:` origin and the iOS web origin) and token issuance as TS
- [ ] A passkey registered through the TS engine authenticates through the Go engine and vice versa (shared credential table — the continuity case)
- [ ] Counter / clone-detection and user-verification rules identical (vectors from the TS tests)

**Abuse cases**
- Relaxing origin checks to accept "any app" origin

### P1000-06 — Push-token registry and the FCM / APNs sender in Go

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-03 · P999-12 |
| **Spec refs** | `docs/MOBILE/20` (registry, sender) · `docs/MOBILE/05-NATIVE-FEATURES.md` § 3 (payload rule: opaque id + category; `scope_check`) · ADR-124 § 9 (who is notified) · `docs/UPSTREAM/06-DPIA.md` § 2.4 (sub-processors) |
| **Spec required** | no |

**Why:** a push that carries a name, a device or a facility puts personal data on lock screens and in
Google's and Apple's hands; the rule is enforced in one place on each engine.

**Definition of Done**
- [ ] Register / re-register / delete a token per install session; tokens unbound on logout, revocation and another user's sign-in on the same install — parity with TS
- [ ] The Go worker sends through FCM HTTP v1 and APNs (token auth) with retries and invalid-token pruning; credentials from configuration, never logged
- [ ] **Payload test**: every notification type the server emits is rendered by the sender and scanned against a deny-list of fields (names, device, serial, QR, facility, room, report number, free text) — the test fails if any appears; run on both engines
- [ ] Recipients follow ADR-124 § 9 on Go (a facility's bound users and provider staff, never another facility's) — two-facility test
- [ ] `scope_check` data-only push sent on session revocation and binding change

**Abuse cases**
- "Rich" notifications with the device name because "it helps technicians"
- The Go sender writing tokens or payloads to its logs

### P1000-07 — The minimum-version policy and the mobile configuration read

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-01 |
| **Spec refs** | `docs/MOBILE/20` (version policy, configuration read, flags) · `docs/MOBILE/08` § 5 · `docs/MOBILE/01` § 6 · `docs/SHARED/03` § 5 (`X-App-*` headers, 426 `APP_UPDATE_REQUIRED`) |
| **Spec required** | no |

**Definition of Done**
- [ ] `minimumSupported` / `recommended` per platform read from the same configuration by both engines; below the minimum → 426 `APP_UPDATE_REQUIRED` on every route but the version read and sign-out — parity test
- [ ] The mobile configuration read (server flags, kill switches, app-lock ceiling) identical on both engines; flags never widen access (a test: a flag on, the route's gate still refuses an unpermitted principal)
- [ ] The `X-App-*` headers are logged, never used for authorisation (a test with forged headers)

**Abuse cases**
- Using the version header to relax a gate for "old apps"

### P1000-08 — Device attestation verification (Play Integrity, App Attest)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-03 |
| **Spec refs** | `docs/MOBILE/07-SECURITY-AND-PRIVACY.md` § 3 · `docs/MOBILE/20` (or, if absent there, the card that adds it on Node first — group rule) |
| **Spec required** | **yes** if the Node variant has not specified the route |

**Definition of Done**
- [ ] Server-side verification on Go with the same decision table as Node: **Android** — the Play Integrity **device-integrity verdict** refuses offline mode when it fails; **iOS** — **App Attest proves app integrity only** (no jailbreak verdict): a failed attestation refuses the native session where required, while jailbreak detection stays the app's advisory local heuristic (`docs/MOBILE/07` § 3, residual recorded)
- [ ] Verification keys and Google/Apple endpoints from configuration; failures fail closed for offline enablement and open for online use (the stance of `07` § 3)
- [ ] Replay protection (nonce per challenge, single use)

**Abuse cases**
- Trusting a client-reported "not rooted" flag

### P1000-09 — The field-capture server pieces on Go

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-03 |
| **Spec refs** | `MEMORY/specs/P19-08-offline-field-capture.md` § 9.5 · `MEMORY/specs/P19-02-ipm-session-aggregate.md` § 9, § 10 · `MEMORY/specs/P19-03-device-extensions.md` (by-QR lookup, photos) · ADR-127 Am. 1 · ADR-128 (signed links) |
| **Spec required** | no |

**Why:** these were built on Node by the upstream phases (P21-02, P21-03, P21-09) and ported by Phase
999; the app's offline mode depends on every detail, so the mobile phase owns their final proof on Go.

**Definition of Done**
- [ ] `GET /calibration-devices?view=field` (the narrow `fieldDeviceSummary` key set), `GET /calibration-devices/by-qr/:qrCode` (one 404 for every not-yours case), idempotent `POST /attachments`, device photo routes, `POST /field/wipes` (`rbac([TENANT_ADMIN])`, counts-only audit) — parity diff with TS
- [ ] Two-tenant **and** two-facility suites on Go for each of these routes (`twoFacilitySuite` cases of P18-04 ported)
- [ ] Signed attachment links on Go honour ADR-128 (TTL cap, tenant and issuer binding, re-check at redemption)

**Abuse cases**
- Returning the full device shape from `view=field` "because the struct already has it"

### P1000-10 — Session and data continuity when a mobile module moves between engines, both directions

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 … P1000-09 |
| **Spec refs** | `docs/CONTRACT/07` § 2, § 4 (routing per module, the issuer move) · `docs/MOBILE/21` · `docs/MOBILE/04` § 11 · ADR-119 (key ring) · P999-17 (schema compatibility) |
| **Spec required** | **yes** — `MEMORY/specs/P1000-10-module-move-continuity.md` (builds on `docs/CONTRACT/07` § 4: the issuer move, JWKS) |

**Why:** with the app in users' hands, moving a backend-for-mobile module (above all `auth`, the token **issuer** — `docs/CONTRACT/07` § 4) from Node to Go — or back — must not sign everyone out, lose a push registration, duplicate a replayed
capture or break a frozen op in an outbox.

**Definition of Done**
- [ ] Spec written first: every piece of state an installed app relies on (access-token verification across the key ring, refresh-token families, session rows, push registrations, idempotency rows and their scope fingerprints, `client_ref` keys, attestation records) and how each engine reads what the other wrote
- [ ] A live test through the gateway: sign in and capture offline while the mobile modules (and `auth`) are on Node → route them to Go → the app refreshes, syncs, replays frozen ops (nothing duplicated), receives a push; then route back and repeat — named run
- [ ] **Redis keys** written by one engine (SSO start entries, hand-off codes, WebAuthn challenges, the tenant-by-code cache, request budgets) read by the other — key names and encodings are a documented contract (`docs/MOBILE/21`)
- [ ] A refresh-token family started on one engine and reused after the move is revoked on the other (reuse detection survives the move); tokens signed before the issuer move verify through the JWKS until expiry
- [ ] The runbook for moving the mobile modules in production with installed apps (announce, minimum version unchanged, rollback = the previous routing table) in `docs/DEVOPS/`

**Abuse cases**
- "Everyone signs in again after the switch" accepted as the plan (it also strands every phone's outbox behind a sign-in at the worst time)
- Testing only Node → Go, not the rollback

### P1000-11 — The mobile modules at 100% conformance on Go (the parity diff as a diagnostic)

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 … P1000-09 |
| **Spec refs** | `docs/CONTRACT/06` § 4 (the 100% rule) · `docs/BACKEND/12` § 8 (the parity diff, now a diagnostic) · `docs/MOBILE/09-TESTING.md` § 3 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every module the app uses scores **100%** on Go in the conformance suite (named run, contract version); the parity diff against Node is run as a **diagnostic** for every route the app calls (generated from the app's use of the `api-client`) and every difference is either a contract gap (fixed in `contracts/`) or a Go defect
- [ ] The diff runs in CI on every change to either engine that touches a route on that list
- [ ] Mutation check: change one field name in a Go handler → the conformance job fails naming the operation

**Abuse cases**
- Hand-listing the routes (the list goes stale when the app adds a call)

### P1000-12 — Security review of the mobile surface on Go

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-11 |
| **Spec refs** | `docs/MOBILE/07-SECURITY-AND-PRIVACY.md` (MT-01 … MT-16, incl. MT-16 hostile setup links) · `docs/SECURITY/15` (FT-83 … FT-96, AM-1, AM-23 … AM-26) · P999-24 · P17-07 pattern |
| **Spec required** | no |

**Definition of Done**
- [ ] The MT- and FT-rows that have a server control re-tested on Go (token reuse, scope loss, push payloads, attestation replay, SSO code interception, two-tenant and two-facility on every mobile route)
- [ ] Findings fixed or recorded with an owner and a date; none waived on multi-tenancy (`00-TASK-CONVENTIONS` § What May Be Waived)
- [ ] The MT- rows merged into `docs/SECURITY/15` by its owner if the Node variant has not done so

**Abuse cases**
- A review scoped to "the new Go code" that skips the routes ported unchanged

### P1000-13 — Close-out

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-01 … P1000-12, P1000-14 |
| **Spec refs** | `docs/MOBILE/21-BACKEND-FOR-MOBILE-GO.md` · `TASKS/00-TASK-CONVENTIONS.md` |
| **Spec required** | no |

**Definition of Done**
- [ ] `docs/MOBILE/21` amended from TARGET to as-built, every statement checked against the Go code
- [ ] Record naming every parity and continuity run; `MEMORY-INDEX`, `CHANGELOG`, `TASKS/PROGRESS.md` in the same commit
- [ ] P1000-15 and P1000-16 done

**Abuse cases**
- Closing on a parity run older than the last change to either engine

### P1000-14 — Tenant setup on Go: the public lookup by code and hint-scoped sign-in

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-02 |
| **Spec refs** | owner decision 2026-10-08 (ADR-135 § 14) · `docs/MOBILE/11-TENANT-SETUP-AND-BRANDING.md` · `docs/MOBILE/20` § 2a (Node cards **P36-11**, **P36-12**; native SSO start by tenant code in **P36-05**) · `docs/MOBILE/21` · `backend/src/middlewares/auth.middleware.ts` (tenant headers honoured for the super admin only, as built) · `backend/src/routes/api/authPublic.route.ts` (`POST /auth/login/discover`, as built) · ADR-042 (raster logos only) |
| **Spec required** | no (the contract is `20`'s) |

**Why:** the app identifies its tenant before sign-in and sends it as a hint. On the Go engine the
lookup must disclose exactly the same public fields, answer the same uniform 404, and the hint must stay
a hint — a Go handler that let `X-Tenant-Code` select the tenant of a non-super-admin principal would
be a cross-tenant hole.

**Definition of Done**
- [ ] `GET /api/v1/public/tenants/by-code/:code` on Go: case-insensitive, the same public fields (name, logo URL, `primaryColor`, `{ sso: { enabled, protocol, buttonLabel }, passwordAllowed, passkeyAllowed }`), one uniform 404 (unknown, no code, suspended, mobile not enabled), **both** budgets — `requestBudget("tenantByCodeMiss")` (strict, counting 404s only) and `requestBudget("tenantByCode")` (loose), `ETag` / 304 — parity diff with TS; a test that no other tenant field (settings, SSO secrets, IdP URLs with credentials, counts) is ever serialised
- [ ] The `mobile.enabled` settings gate (refused while `tenants.code` is null) and `UNIQUE (lower(code))` honoured identically
- [ ] Sign-in with `X-Tenant-Code`: an account of another tenant → the **generic invalid-credentials 401**, byte-identical to a wrong password (no oracle), on both engines; the token's tenant is authoritative; the super-admin-only header override unchanged — two-tenant tests, mutation-checked (let the hint select the tenant → the named test fails)
- [ ] The native SSO start by tenant code (P36-05's shape) on Go
- [ ] The **work-email code lookup** `POST /api/v1/public/tenants/discover` (`20` § 2a.5; owner decision (A): returning only `{ code }` for a super-admin-claimed domain, the generic 404 otherwise, never starting SSO — `docs/MOBILE/11` § 2, `20`) on Go: same answers, same budget, same uniform 404; the as-built `POST /auth/login/discover` (web) is a separate operation with its own conformance checks

**Abuse cases**
- Returning the tenant's full settings object from the public lookup "because the struct has it"
- A Go middleware that trusts `X-Tenant-Code` for an authenticated non-super-admin request

### P1000-15 — The mobile E2E suite and offline capture through the gateway with Go serving the mobile modules

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-01 … P1000-12, P1000-14 |
| **Spec refs** | `docs/MOBILE/09-TESTING.md` § 3, § 4 · `docs/MOBILE/04-OFFLINE-FIELD-CAPTURE.md` · `docs/CONTRACT/06` (moved in from the dropped `PHASE-1002` cards P1002-03/-04) |
| **Spec required** | no |

**Why:** the conformance suite proves the contract; the released app's Maestro flows prove that the
app's real journeys hold when Go serves its modules, at no cost to the app (no app change expected).

**Definition of Done**
- [ ] Every Maestro flow of `docs/MOBILE/09` § 3.1 (tenant setup included) against a stack whose gateway routes the mobile modules to Go — named runs, emulator/simulator (owner: no paid services)
- [ ] An outbox captured while the modules were on Node and synced after they moved to Go (and the reverse): nothing lost, nothing duplicated
- [ ] A flow failing only with Go is a Go defect fixed here, never an app workaround

**Abuse cases**
- Running the flows with an empty outbox at the move

### P1000-16 — Pilot move of the mobile modules with apps installed, and the rollback

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P1000-10, P1000-15 |
| **Spec refs** | P1000-10's spec and runbook · `docs/CONTRACT/07` § 2 (routing, rollback) · `docs/MOBILE/08` § 4.4, § 5 (moved in from the dropped P1002-06) |
| **Spec required** | no |

**Definition of Done**
- [ ] On staging with preview-channel installs (synthetic data): route the mobile modules to Go during working hours with phones holding unsynced captures; every phone syncs without signing in again; route back to Node the same way — a named run with counts (sessions kept, captures synced, duplicates 0, pushes delivered)
- [ ] The production routing runbook updated from what the rehearsal found; the go / no-go recorded by the owner or the delegated coordinator

**Abuse cases**
- Rehearsing with freshly signed-in phones; skipping the rollback

