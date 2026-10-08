# 03 — The Behaviour Spec (TARGET; draft of `contracts/behaviour/`)

> **TARGET — nothing here is built.** This is the **draft** of the normative behaviour that OpenAPI
> cannot express. When Phase 32 builds `contracts/`, this text moves to `contracts/behaviour/*.md`
> (versioned with the contract), and this file becomes a pointer. Every rule has an id (`B-<area>-<n>`)
> so the conformance suite ([`06`](./06-CONFORMANCE-SUITE.md)) can name the rule each check proves.
> "As built" marks a rule the Node backend already follows. Unmarked rules are new or tightened, and
> each names its card.
> Words: **MUST**, **MUST NOT**, **SHOULD** as in RFC 2119.

---

## 1. The Envelope (B-ENV)

- **B-ENV-1 (as built).** Every JSON response from `/api/v1` is
  `{ "success": boolean, "status": <the HTTP status>, "message": string, "data": … }`. A list adds a
  **top-level** `meta` beside `data`: rows in `data`, paging in `meta`. There is never `data.rows`,
  `data.items` or `data.meta` (`CLAUDE.md` § The Response Envelope). A single report document (e.g.
  `/reports/overdue-devices`) is one object in `data` that may hold arrays of its own (A-343).
- **B-ENV-2.** An error response has `success: false`, `data: null` (never `{}` or `[]`,
  `docs/BACKEND/12` § 9), the HTTP status in `status`, a human `message`, and a **top-level `code`**
  from the catalogue ([`04`](./04-ERROR-CODES.md)) on every error status: 400, 401, 403, 404, 409, 410,
  413, 415, 422, 426, 429, 5xx. As built: `code` exists only where a client must react — the gates
  `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED` (`auth.middleware.ts`, via `response.util.ts#error`'s
  `extra`) and the sign-in policy codes `LOCATION_REQUIRED`, `NETWORK_POLICY`, `SELF_LOCKOUT` (a thrown
  error's `publicCode`, sent as top-level `code` by `utils/controllerWrapper.util.ts`, ADR-100). Making it
  universal is P32-07 / P32-08.
- **B-ENV-3 (target, P32-07).** A 400 from validation carries `errors: [{ path, code, message }]` at top
  level, in every environment; `path` is a JSON Pointer into the request part (`/body/serialNumber`,
  `/params/id`, `/query/limit`). **As built** it is inconsistent: `validate()` sends
  `details: [{ field, message }]` **outside production only** (`middlewares/validation.middleware.ts`), while
  `controllerWrapper` and some controllers send `errors: [{ field, message }]`. P32-07 unifies them
  additively (`errors[]` added everywhere; `details` stays non-production).
- **B-ENV-4.** `details` (stack, internal message) **MUST NOT** appear in production (as built:
  `isProduction()`). A generic 500 carries `requestId` (A-132).
- **B-ENV-5.** 429 uses the envelope with a `Retry-After` header — **as built** (Q-53 / ADR-109:
  `globalRateLimit.middleware.ts`, `requestBudget.middleware.ts`, the `RateLimited` response component).
  Only `code: RATE_LIMITED` is new (P32-07, additive).

## 2. Status Codes (B-STATUS)

| Rule | |
|---|---|
| **B-STATUS-1** | 400 validation · 401 not authenticated (or a credential just sent is wrong) · 403 permission failure **inside the caller's own tenant/facility** · **404 not found, including another tenant's or facility's row** · **409 invalid state transition or uniqueness conflict, with a state explanation** · 410 gone (a spent capability token) · 413/415 upload limits · 426 app update required (ADR-134) · 429 budget · 5xx server |
| **B-STATUS-2** | (as built: the status, message and headers; **target**, P32-07: the `code` — `notFound()` sends none today) **Not-found, soft-deleted and not-yours are indistinguishable**: same status, same `code` (`NOT_FOUND`), same `message`, same headers, and no timing difference beyond noise (`docs/SECURITY/05`). A 403 never reveals that a row exists in another tenant |
| **B-STATUS-3** | (as built: the 409 and its explanatory `message`; **target**, P32-08: the conflict `code`s — none exists today) A **409 is a state explanation**: its `message` says what state the resource is in and what must happen first ("this certificate is in `draft` and must be submitted first"), and its `code` names the conflict (`CERTIFICATE_NOT_SUBMITTED`, `IPM_NOT_DRAFT` …). A conflict is never a 500 |
| **B-STATUS-4** | A route the caller's facility binding forbids answers **403 `FACILITY_ROUTE_REFUSED`** before reading any parameter (ADR-124 Am. 2 § 8) |

## 3. Authentication and Sessions (B-AUTH)

- **B-AUTH-1 (as built).** The backend authenticates **`Authorization: Bearer <access token>`**. Two
  client transports put it there:
  - the **web**: the browser never holds a token. The Next proxy `frontend/src/app/api/v1/[...path]`
    turns the httpOnly session cookie into the bearer and strips tokens from answers (ADR-059, A-71);
  - the **native app**: holds the bearer itself, on the native ingress `/native/api/v1` (ADR-134).
- **B-AUTH-2.** Access tokens are **JWTs signed with an asymmetric key** (ES256) with a `kid`. Every
  engine verifies them against the **JWKS** of the token issuer ([`07`](./07-PORTING-PLAYBOOK.md) § 4).
  As built: `JWT_ALGORITHM` defaults to **HS256**, a shared secret. Moving to ES256 + JWKS is P34.
  The **claim set is a contract**, kept from the as-built tokens (`auth.service.ts`: `id`, `email`, `sid`,
  `amr`, `impersonatorId`, `typ`) plus the standard `iat`, `exp` — renaming `id` to `sub` is **not** done in
  v1. **`kid` lives in the JWT header**, never in the claims. A facility and a tenant are **not** claims:
  both are read from the user row (ADR-124 AM-2). Purpose tokens (activation 24 h, MFA 5 min, socket
  300 s — `jwt.util.ts` `PURPOSE_TOKEN_TYPES`) share the access-token keys and follow the same move
  (`07` § 4).
- **B-AUTH-3.** Every authenticated request re-checks the **session row** (revocation) and the principal.
  **As built:** the session row, an active account and a non-suspended tenant — a refusal is a 403 with
  **prose and no code** (`auth.middleware.ts#tenantRefusal`). **Target:** the facility-active check
  (P21-09) and the scope-loss `code`s `ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED` (P21-03)
  and `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING` (P21-09).
- **B-AUTH-4 (as built).** **Refresh once on 401**: a client that gets 401 on a non-credential endpoint
  performs **one** refresh (single-flight) and retries once; a second 401 or a failed refresh ends the
  session. A **credential endpoint** (sign-in, MFA, password confirmation, signature) answering 401 is
  about what was just sent and never triggers a refresh. The list of credential endpoints is part of the
  contract: `x-credential-endpoint: true` on the operation.
- **B-AUTH-5.** Refresh **rotates** the refresh token; reuse of a rotated token revokes the session family
  (ADR-134 § B.4, `docs/MOBILE/20` § 5).
- **B-AUTH-6 (as built).** Tenant headers (`x-tenant-id`, `x-tenant-code`) are honoured **only for the
  super admin**. For everyone else the tenant comes from the user row. Before sign-in, `X-Tenant-Code` is
  a **hint** that selects only public branding and sign-in configuration (ADR-135 § 14). An account of
  another tenant signing in with a hint gets the generic `INVALID_CREDENTIALS`.
- **B-AUTH-7 (as built).** `PASSWORD_CHANGE_REQUIRED` and `MFA_ENROLMENT_REQUIRED` are 403 gates that a
  client routes to its own screens (A-123, A-160).

## 4. Cookies and CSRF (B-CSRF)

- **B-CSRF-1.** Cookies are a **client-transport** concern of the web: the backend contract is
  **bearer-only for authentication**; the one cookie the backend itself sets is the OIDC **binding** cookie
  of the SSO start (`controllers/sso.controller.ts`), which authenticates nothing. The Next proxy (one implementation, in the frontend) owns
  the session cookies (`HttpOnly`, `Secure`, `SameSite=Lax`), and their CSRF protection is the proxy's.
  That protection is the same-origin check of the Next route handlers plus `SameSite`, as built
  (ADR-059 / ADR-074). A port **MUST NOT** add cookie authentication to the backend.
- **B-CSRF-2.** The only cookie that crosses the proxy is the OIDC binding cookie (A-68). Its name and
  attributes are documented in the contract's SSO operations.

## 5. Pagination, Sorting, Filtering (B-PAGE)

- **B-PAGE-1 (as built).** List operations take `page` (1-based) and `limit` (default and maximum per
  operation, in the contract), and answer `meta: { total, page, limit, totalPages }` (the as-built
  shape; `docs/API/00`).
- **B-PAGE-2 (as built).** Every list order **ends in `id`** as a tiebreaker, so a page is stable
  (`pageOrderTiebreaker.ci3.guard`).
- **B-PAGE-3.** A `limit` above the maximum is a **400**, never a silent clamp (each operation's schema
  states `maximum`). Where as-built code clamps today, the contract records the as-built behaviour
  first; turning a clamp into a 400 is a tightening of input that was never valid — allowed in v1 only
  under **CD-1** (B-VER-1).
- **B-PAGE-4.** Unknown query parameters are **ignored**; known ones with a wrong type are 400. Filters,
  `sort` values and their defaults are enumerated per operation.

## 6. Conditional Requests (B-ETAG)

- **B-ETAG-1.** Operations marked `x-etag: true` answer with a strong `ETag`. With a matching
  `If-None-Match` they answer **304** with no body. Used by the published catalogue (P19-01 § 8.3), tenant
  branding (ADR-135 § 14), `/meta`. The ETag is an opaque string; clients never parse it.
- **B-ETAG-2.** Optimistic concurrency on drafts uses a body `revision` field, not `If-Match`
  (P19-02 G-S9). The conflict is 409 `…_REVISION_CONFLICT`.

## 7. Idempotency (B-IDEM)

- **B-IDEM-1.** Operations marked `x-idempotent: true` accept `Idempotency-Key` (a UUID v4). They store
  a request hash, a **scope fingerprint**, the status and a **resource reference, never a body**.
  - A replay re-reads the resource **in the current context**.
  - The same key with a different request is 409 `IDEMPOTENCY_KEY_REUSED`.
  - A key still in flight is 409 `IDEMPOTENCY_IN_FLIGHT`.
  - A changed scope is 409 `IDEMPOTENCY_SCOPE_CHANGED`.
  
  Keys are kept 30 days, per tenant and user (ADR-126 Am. 1 § 8, ADR-127).

## 8. Uploads and Downloads (B-FILE)

- **B-FILE-1.** Uploads are `multipart/form-data` with one `file` part and the other fields as parts;
  limits (size, MIME types, extensions) are per operation in the contract (`x-upload`); content is
  sniffed and virus-scanned server-side; SVG is never accepted for public images (ADR-042) — **as built**.
  **Target (P32-08):** a refused type is 415 `UNSUPPORTED_MEDIA_TYPE` and too large is 413
  `PAYLOAD_TOO_LARGE` — neither status nor code is used consistently today.
- **B-FILE-2 (as built).** Files are downloaded through **short-lived signed links** (ADR-128): a TTL cap,
  binding to the tenant and the issuing principal, and a re-check at redemption. A spent or expired link
  is 410 / 404 as documented. The token format is opaque to clients.
- **B-FILE-3.** Download responses set `Content-Type`, `Content-Disposition` (attachment unless the
  public class) and `X-Content-Type-Options: nosniff`.

## 9. Streaming (B-STREAM)

- **B-STREAM-1 (as built, ADR-059/F-16).** Request and response bodies may be streamed through the Next
  proxy. The backend does not depend on a buffered request.
- **B-STREAM-2.** Long-running work is a **batch job**: `202` with the job reference, progress read by
  polling and/or a realtime event ([`05`](./05-REALTIME-ASYNCAPI.md)). Never a response held open past the
  30-s backend budget (`docs/FRONTEND/00` § The Next proxy: proxy 32 s, client 35 s, backend 30 s).
- **B-STREAM-3.** Server-sent events are not part of v1. Realtime is Socket.IO ([`05`](./05-REALTIME-ASYNCAPI.md)).

## 10. Rate Limits (B-RATE)

- **B-RATE-1 (as built).** Budgets are per operation (`x-rate-limit`, pinned by test, ADR-103 § 3):
  identity (IP, user, installation, recipient), window, limit. A fixed window: a refused request never
  extends it (ADR-100 Am. 5). A refusal is 429 + `Retry-After` (B-ENV-5).

## 11. Time, Numbers, Identifiers (B-DATA)

- **B-DATA-1.** Timestamps are RFC 3339 in UTC (`…Z`). Date-only fields are `YYYY-MM-DD` and are
  interpreted in the **tenant's time zone** (default `Asia/Jakarta`) where the operation says so.
- **B-DATA-2.** Decimals that are measurements or money are **strings** with exact digits (ADR-125 Am. 2,
  `docs/BACKEND/12` § 6.1). Counts are integers.
- **B-DATA-3.** Ids are UUIDs (lowercase). A path id that is not a UUID is 400. A well-formed id that is
  absent or not yours is 404 (B-STATUS-2).
- **B-DATA-4.** JSON field names are camelCase. A nullable field is present with `null`, never omitted,
  unless the schema marks it optional.
- **B-DATA-5.** Secrets (`password`, `mfaSecret`, `privateKey`, device tokens, refresh tokens outside the
  native sign-in answers) **MUST NOT** appear in any response, log or audit `changes` (A-331).

## 12. Tenant and Facility Isolation as Observable Behaviour (B-ISO)

- **B-ISO-1.** No operation lets a non-super-admin read or write another tenant's rows. Seen from
  outside, every `:id` of another tenant is 404, every list omits it, and every count excludes it. The
  contract marks tenant-owned resources (`x-tenant-scoped: true`), and the conformance suite derives its
  two-tenant cases from that mark ([`06`](./06-CONFORMANCE-SUITE.md) § 3.2).
- **B-ISO-2.** For facility-bound users, the same holds per facility (`x-facility-accessible`, ADR-124
  Am. 1–2; a route without the mark is 403 `FACILITY_ROUTE_REFUSED` for them).
- **B-ISO-3.** Every mutation writes an audit row in the same transaction. A rolled-back mutation leaves
  none (observable through the audit read of an administrator in the same tenant; `x-audited: true`).

## 13. Realtime (B-RT)

See [`05`](./05-REALTIME-ASYNCAPI.md). Normative there: the handshake by short-lived socket token, room
isolation, event names and payloads, and the 60-second principal re-check.

## 14. Capabilities (B-META)

- **B-META-1.** `GET /api/v1/meta` (public, ETag) answers
  `{ contractVersion: "1.<minor>.<patch>", capabilities: { <module>: true|false, <feature flag>: … } }`.
  A client hides a feature whose capability is false. It never infers capabilities from an engine name,
  and the answer names no engine ([`07`](./07-PORTING-PLAYBOOK.md) § 5). **Deployment-wide only**: no
  per-tenant or per-user flag appears here; those stay behind the authenticated mobile configuration
  read (`docs/MOBILE/01` § 6). Rate limit: `requestBudget("meta")`, per address (P34-03).

## 15. Versioning (B-VER)

- **B-VER-1.** The contract is versioned **once**, not per engine: `/api/v1`. Within v1 changes are
  **additive only**: new operations, new optional request fields, new response fields, new enum values
  **only where the operation declares the enum open** (`x-extensible-enum: true`), new error codes. Every
  client MUST ignore unknown response fields.
  **CD-1 — the one exception class** (decided by the coordinator under the owner's delegation,
  2026-10-08): a **security or validation tightening of input that was never valid** (a clamp becoming a
  400, an unvalidated body gaining validation — the as-built `POST /sop` W-10 case, ADR-121). It is
  recorded in `contracts/CHANGELOG.md` with an ADR reference, announced through the mobile
  minimum-app-version policy (`docs/MOBILE/08` § 5), and accepted by `openapi:breaking` **only through a
  reviewed allow-list entry** naming the ADR. Every other breaking change goes to `/api/v2`.
- **B-VER-2.** A breaking change is a new **`/api/v2`** operation set, served beside v1 and announced
  through `/meta` and the mobile minimum-version policy. **Owner, 2026-10-08 (Q-C3):** v1 stays served
  **at least 90 days after v2**, and for as long as any supported app version uses it.
- **B-VER-3.** `contracts/VERSION` follows `1.<minor>.<patch>`: minor for additive changes, patch for
  documentation-only changes. `/meta` reports it.
