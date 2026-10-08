# 21 — Backend for Mobile, Go Variant (TARGET)

> **Status: TARGET (ADR-134 § B, ADR-089). Nothing here is built, and nothing may be built before
> Phase 999 has delivered the Go engine's auth and session parity.** There is no `backend-go/` in the
> repository (checked 2026-10-08). This document specifies the **same capabilities** as
> [`20-BACKEND-FOR-MOBILE-NODE.md`](./20-BACKEND-FOR-MOBILE-NODE.md) in the Go engine, following
> `docs/ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md`, `docs/BACKEND/12-GO-PORTING-SPECIFICATION.md`
> and `docs/ENGINEERING/15-GO-CODING-STANDARDS.md`. The Go-variant phases are written by this folder's
> other author: [`TASKS/PHASE-1000-MOBILE-BACKEND-GO.md`](../../TASKS/PHASE-1000-MOBILE-BACKEND-GO.md) (P1000-01 … P1000-16, strictly after Phase 999).

---

## 1. The Premise: the App Does Not Change

The app is bound to **the OpenAPI document**, not to an engine (`../SHARED/01` § 10). Doc 20 defines
the native capabilities **as contract** — routes, request and response shapes, headers, status codes,
error `code`s, the 426 envelope, the push payload — and as a Node implementation. The Go engine must
serve **the same contract, byte-compatible in every field the app reads**, so:

- the app keeps its `baseUrl` (`https://<host>/native`); the edge decides which engine answers;
- no app release, no `@callibrator/api-client` change, no new generated type is needed to switch a
  deployment from Node to Go;
- an installed app built against the Node engine keeps working against the Go engine — which is the
  test (§ 7).

Porting rule (doc 12 § 1.2): **no behaviour change under porting.** A Node behaviour found wrong while
porting is fixed in Node first (with its own record), then ported — never "fixed" in Go alone, which
would make the engines disagree and the app's behaviour depend on the deployment.

## 2. Preconditions From Phase 999

| Needed from Phase 999 | Card (as planned in `TASKS/PHASE-999-…`) | Why |
|---|---|---|
| JWT verification and issuance with the same keys and claims (`sid`, `amr`, `impersonatorId`) | P999-07 | a token issued by one engine is accepted by the other while both run (shared `sessions` table) |
| Session lookup and per-request revocation on the shared `sessions` table (snake_case columns) | P999-07 | doc 12 § 3.2's critical note |
| RBAC/ABAC, tenant **and facility** context propagation, two-tenant 404 | P999-08 | every native route inherits them |
| The validation layer matching the Zod schemas | P999-09 | request contracts identical |
| Error translation to the envelope (incl. `code`) | P999-10 | the app switches on `code` |
| Background workers with per-job tenant context | P999-12 | the push dispatcher |
| Contract parity suite | P999-16 | the proof of § 7 |

**Owner decisions carried unchanged into Go (2026-10-08, Q-58 … Q-60):** the `/native/` path-prefix
ingress; a 30-day absolute native session lifetime that a tenant may shorten; refresh-reuse detection
for native families only (web revisited later with a cross-tab refresh lock, on both engines alike).

## 3. Capability Map — Node → Go

Layout per `docs/ARCHITECTURE/11` § 4.1 and `15-GO-CODING-STANDARDS.md` § 2 (`internal/domain` with
no non-stdlib imports; consumer-defined interfaces; context propagation; no global mutable state).

| Capability (doc 20 §) | Node (target) | Go (target) |
|---|---|---|
| Native ingress marker (§ 3) | edge sets `X-Callibrator-Client: native`; Express middleware reads it | `internal/transport/http/middleware/client_kind.go` puts `ClientKind` into `context.Context` (a typed key, never a string key); the edge rule is the same file, its upstream pointed at the Go service |
| Browser refusal on `/native/` (§ 3) | middleware: `Origin`/`Sec-Fetch-Mode` → 403 | same rule in `client_kind.go`; identical 403 envelope |
| Session columns, families (§ 4) | migration in `backend/src/migrations/`; `session.model.ts` attributes snake_case | **no migration in Go** — the schema is shared and migrated by the Node migrator until Phase 999 decides otherwise (`11` § 4.4); `session_repo.go` struct tags `db:"family_id"`, `db:"client_kind"`, … (snake_case, doc 12 § 3.2) |
| Refresh rotation + reuse detection (§ 5) | `auth.service.ts#refreshUserToken` | `internal/application/auth/session_service.go`: one `pgx.Tx` — `SELECT … FROM sessions WHERE token_hash = $1 FOR UPDATE`, rotation, family revocation, audit insert, commit (§ 5 below) |
| Native SSO start/authorize/exchange (§ 7) | `sso.controller.ts` + Redis | `internal/application/auth/sso_native.go`; Redis via `go-redis/v9` (`GETDEL`, same key names and TTLs — § 5); PKCE check with `crypto/sha256` + `encoding/base64.RawURLEncoding`; OIDC RP with `github.com/coreos/go-oidc/v3` + `golang.org/x/oauth2`; SAML with `github.com/crewjam/saml` (SAML parity is a Phase 999 matter first) |
| Native passkey origins (§ 8) | `@simplewebauthn/server`, `WEBAUTHN_NATIVE_ORIGINS` | `github.com/go-webauthn/webauthn` with `RPOrigins` = web origin + the `android:apk-key-hash:` list; challenge/session storage in the **same Redis keys and encoding** as Node |
| Association files (§ 8.3) | Express routes before `express.static` | `internal/transport/http/handler/wellknown.go`, registered before the static file server; identical JSON |
| **`/.well-known/` on a Go deployment** | as built, the edge routes `/.well-known/` to the backend (`deploy/compose/nginx/vm-http.conf`, Helm `ingress.yaml`) and Node serves it (`backend/index.ts`: the association routes, then `express.static` for ACME) | the edge's `/.well-known/` upstream becomes the **Go engine**, which **must** serve the AASA and `assetlinks.json` (identical bytes, same configuration keys) **and** the ACME static directory — otherwise app links, passkeys and certificate renewal all break at the switch; a parity test fetches both files from each engine and diffs them |
| Work-email discovery (§ 2a.5) | `POST /public/tenants/discover` over the `sso_email_domains` claim | the same handler over the ported tenant-settings read; identical `{ code }` / uniform-404 bytes and the same budget pair |
| SSO native callbacks (§ 7.1) | the per-variant callback allow-list (https callback, the iOS 16 – 17.3 reverse-domain scheme) | the same allow-list from the same configuration keys; a callback outside it refused identically |
| Super admins refused at native issuance; override headers ignored (§ 2a.4) | every native-issuing route refuses a super admin with the generic 401; the middleware ignores `X-Tenant-Id`/`X-Tenant-Code` for native sessions; the edge strips them | the same refusal in every Go issuing handler and the same rule in `middleware/auth.go`; the edge rule is engine-independent |
| Passkey tenant at verify (§ 2a.4) | `allowCredentials` empty; the credential's user must be in the hinted tenant | the same in the `go-webauthn` handlers |
| App-log intake (§ 11a) | `POST /mobile/logs`, principal-stamped, capped, 30-day retention | `internal/application/mobilelogs/` with the same caps, redaction list and purge; structured `slog` fields only, never the raw value in a message |
| Version policy, 426 (§ 9) | `nativeClientPolicy` middleware | `internal/transport/http/middleware/app_version.go`; semver comparison with `golang.org/x/mod/semver` (which needs a `v` prefix — normalised in one helper, tested against Node's comparison table, § 5) |
| Push-token registry (§ 10.1) | `push_tokens` model + routes | `internal/domain/push/`, `internal/application/push/service.go`, `internal/infrastructure/persistence/push_token_repo.go` (explicit `tenant_id = $n` predicate in every query — doc 12 § 4.2) |
| Push fan-out (§ 10.2) | outbox + worker; FCM HTTP v1; APNs token auth | `internal/application/push/dispatcher.go` claiming with `FOR UPDATE SKIP LOCKED` (the webhook pattern, `11` § 3.6); `internal/infrastructure/push/fcm.go` (FCM HTTP v1 over `net/http` with `golang.org/x/oauth2/google` service-account tokens) and `apns.go` (HTTP/2 with ES256 provider tokens — `github.com/sideshow/apns2` or `net/http` + `golang.org/x/net/http2`); tenant context set **per job** (`tenant.IntoContext`), never for the loop (`15` § 3.3) |
| Tenant lookup by code (§ 2a.1) | public route, branding cache, `UNIQUE (lower(code))`, ETag | `internal/transport/http/handler/public_tenant.go` over `internal/application/tenant/branding.go`; the **same** normalisation, field list, uniform-404 bytes, ETag algorithm (so a 304 survives an engine switch) and Redis branding key as Node; the migration stays Node's |
| `tenants.code` settings gate (§ 2a.2) | 409 `TENANT_CODE_REQUIRED` on the settings write | same check in the ported tenant-settings service |
| Sign-in scoped by `X-Tenant-Code` (§ 2a.4) | account lookup narrowed before authentication; generic 401 | the ported login/MFA/passkey/SSO-exchange handlers narrow by the hint identically; the auth middleware still ignores tenant headers for non-super-admins (P999-07/08 parity) |
| Device attestation (§ 9a) | Play Integrity `decodeIntegrityToken` (device + app verdict); App Attest verification (**app integrity only — no jailbreak verdict**; the iOS jailbreak signal is an advisory client claim) | `internal/application/attestation/service.go`; Play Integrity through `google.golang.org/api/playintegrity/v1`; App Attest CBOR/X.509 verification (`github.com/fxamacker/cbor/v2` + `crypto/x509`) against Apple's root; the verdict written to the same `sessions` columns |
| Mobile configuration reads (§ 11) | routes over the feature-flag module and tenant settings | handlers over the ported feature-flag and settings services; the bound user's settings read uses the Go equivalent of the reviewed facility-scope bypass, listed like Node's |
| Rate limits (§ 12) | `requestBudget(<name>)`, Redis | the Go limiter (P999 `ratelimit.go`) with **the same Redis key format, windows and counting of successes** (§ 5) |
| Audit (§ 13) | inside the Sequelize transaction | inside the `pgx.Tx` before `Commit` (doc 12 § 3.2 pattern) |

## 4. Middleware Order

The Go router composes the same order as Express, because the order is observable (which error wins):

```text
request_id → recover → client_kind (native marker, browser refusal) → app_version (426)
  → rate limit (per route) → auth (JWT + session lookup) → tenant/facility context
  → permission gate (RBAC / dynamic access / facility marker) → validation → handler
```

A parity test sends the same malformed, unauthenticated, old-version request to both engines and
compares status, `code` and envelope (§ 7).

## 5. Differences and Risks

| Area | Risk | Control |
|---|---|---|
| **Concurrent refresh** | Go serves concurrent requests on real threads; two refreshes of one token arriving together are likelier to interleave than on Node's single event loop. Without a row lock both could rotate, and the loser would be read as a **reuse** and revoke the family | the Node implementation (P36-03) **defines** the semantics with `SELECT … FOR UPDATE` on the session row (the second request waits, then sees `TOKEN_ROTATION`; within 5 s and from the same installation it receives 401 `REFRESH_RACE` **without** family revocation — doc 20 § 5 rule 2a); Go ports exactly that, and a parity test fires 10 concurrent refreshes at each engine |
| **Encrypted columns** (`push_tokens.token`, other secret attributes) | a row written by Node must decrypt in Go and vice versa while both run | the envelope format of `models/secretAttributes.ts` (algorithm, IV, key id, encoding) is specified as a contract in Phase 999's KMS card; a cross-engine test writes with one and reads with the other |
| **Redis keys** (SSO start entries, hand-off codes, WebAuthn challenges, budgets) | different key names or encodings split state between engines in a mixed deployment | key formats are a documented contract (doc 20 names each); Phase 1000's parity suite reads keys written by the other engine |
| **semver** | `golang.org/x/mod/semver` requires `v`; pre-release ordering differs from naive string compare | one normalising helper; a shared table of comparisons both engines must pass |
| **JSON shape** | `null` vs omitted, number vs string decimals, timestamps (doc 12 § 6) | the 426 envelope, the login answer and the session list are compared field by field in parity tests |
| **WebAuthn library behaviour** | `go-webauthn` and `@simplewebauthn` differ in defaults (user verification, attestation, base64url handling, challenge expiry) | the options and the verification policy are written down in doc 20 § 8 terms and asserted in both engines with recorded ceremonies (fixtures from a real Android and iOS authenticator) |
| **APNs/FCM clients** | Go's HTTP/2 and OAuth2 are first-class, but retry/backoff and error mapping are new code | the error table of doc 20 § 10.2 is the spec; a fake provider server returns each error in tests |
| **SAML** | the Go SAML library may not support every configuration a tenant uses on Node | per-tenant SAML parity is checked before a deployment moves to Go; until then that deployment stays on Node (full backend per deployment, `11` § 5) |
| **Migrations** | two engines, one schema | the schema is migrated by one migrator only (Node's, until a Phase 999 sub-ADR moves it); Go never runs DDL |

## 6. Coexistence

Phase 999's model is **full backend per deployment** first (`11` § 5). For a native client this means:

- the native ingress points at the engine the deployment runs; the app cannot tell;
- sessions and push tokens live in the shared database, so a deployment switched from Node to Go keeps
  every signed-in phone signed in (same JWT keys, same `sessions` rows) — **this is a requirement**,
  tested by signing in on Node, switching the stack, and refreshing on Go;
- if partial routing (999b) is ever adopted, the push dispatcher must run on **one** engine at a time
  (both claim with `SKIP LOCKED`, so two would be safe, but metrics and rate budgets would split) — the
  sub-ADR decides.

## 7. Proof

1. **Contract:** the OpenAPI document served by the Go engine equals the TypeScript one for every
   native route (diffed with the same `openapi:breaking` tool, zero differences), and Go responses are
   validated against it (response-schema validation in the parity suite).
2. **Behaviour:** doc 20's tests re-expressed against the Go engine — reuse detection, family
   revocation, 426 and its exemptions, SSO exchange failures (one answer), native passkey origins,
   push-token scoping (two tenants, two facilities), payload rule, audit inside the transaction, rate
   budgets.
3. **The app itself:** the **same Maestro suite**, unchanged, against a compose stack running the Go
   engine — sign-in (password + MFA, SSO, passkey), offline capture and sync, push registration,
   version floor. A suite that needs a change to pass on Go is a parity defect, not a test update.
4. **Mixed state:** sign in and capture offline against Node; switch the stack to Go; sync — the
   outbox replays with the same idempotency keys and is accepted (the `idempotency_keys` rows written by
   Node are honoured by Go).

## 8. Bad Implications

- The native features double the Go parity surface (sessions families, SSO exchange, passkeys, push),
  each with cross-engine state that must agree byte for byte.
- A Node defect found during the Go port delays the Go card until the Node fix ships (the porting
  rule) — slower, deliberately.
- Until SAML parity is proven per tenant, a deployment with a SAML-only hospital stays on Node.
