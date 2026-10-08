# 03 — `@callibrator/api-client` (TARGET)

> **Status: TARGET (ADR-134). Not built.** What it generalises is **as built** in
> `frontend/src/api/typed.ts` (P9-25, ADR-103: `openapi-fetch` over generated `paths`),
> `frontend/src/api/client.ts` (refresh-once F-05, the A-123/A-160 gate redirects, F-07 error
> normalisation, multipart handling) and `frontend/src/i18n/apiErrors.ts` (status + code → message).
> Built by P35-06. The server side of the mobile auth adapter is
> [`../MOBILE/20-BACKEND-FOR-MOBILE-NODE.md`](../MOBILE/20-BACKEND-FOR-MOBILE-NODE.md).

---

## 1. Purpose

The **only** way a client talks to the API. It is generated from the OpenAPI document, so a path,
parameter or body the backend does not publish is a compile error on both platforms (the reason
ADR-103 exists: hand-written services had called endpoints that did not exist while their tests
mocked the fabrication). It owns, once for both clients: the envelope unwrap, error normalisation,
the refresh-once rule, the `Idempotency-Key` option and retry policy. It owns **no** credential
storage and **no** transport: those are the platform's, behind two ports.

## 2. Contents

```text
packages/api-client/
├── src/
│   ├── generated/schema.d.ts   # openapi-typescript output of the root contracts/ OpenAPI 3.1 files (ADR-136)
│   ├── client.ts               # createApiClient(): openapi-fetch + middleware chain
│   ├── envelope.ts             # unwrap(), unwrapList() — rows in `data`, paging in top-level `meta`
│   ├── errors.ts               # ApiError, classify(), the gate/scope/update code tables
│   ├── auth.ts                 # AuthAdapter port; single-flight refresh; credential-endpoint table
│   ├── retry.ts                # backoff with jitter; Retry-After
│   ├── idempotency.ts          # newIdempotencyKey() (UUID v4 from an injected random source)
│   └── types.ts                # Op, JsonBody, QueryOf, Answer, DataOf (moved from typed.ts)
└── test/                       # 100 %
```

Scripts: `api:types` (generate) and `api:types:check` (`--check`, in CI), moved from the frontend and
pointed at the contract-first `contracts/` folder (ADR-136), the source of truth for paths, schemas and
the **stable machine error `code`s** this package classifies on (`01` § 4).

## 3. The Two Ports

```ts
/** The transport. The platform passes its own; the package never touches a global fetch. */
export type FetchLike = (request: Request) => Promise<Response>;

/** Credentials. One implementation per platform (§ 4, § 5). */
export interface AuthAdapter {
  /** Add credentials to an outgoing request (mobile: Authorization; web: nothing — the proxy does it). */
  decorate(request: Request): Request | Promise<Request>;
  /** Perform ONE refresh. Called by the client's single-flight wrapper, never concurrently. */
  performRefresh(): Promise<"refreshed" | "ended">;
  /** The session is over (refresh failed, or the server ended it). The platform decides what to show. */
  sessionEnded(reason: SessionEndReason): void;
}

export interface ApiClientOptions {
  baseUrl: string;                       // web: "" (same origin); mobile: "https://<host>/native" (§ 5)
  fetch: FetchLike;
  auth: AuthAdapter;
  timeoutMs?: number;                    // default 35 000 (F-14: client 35 > proxy 32 > backend 30)
  headers?: () => Record<string, string>;// per-request extras: Accept-Language; mobile X-App-* (§ 5)
  random?: () => Uint8Array;             // 16 random bytes, for idempotency keys (crypto.getRandomValues / expo-crypto)
  onEvent?: (event: ClientEvent) => void;// gate, scope-loss, update-required, rate-limited (§ 6.3)
}
export function createApiClient(options: ApiClientOptions): ApiClient;
```

`Request`/`Response`/`Headers`/`URL` are used as types only and are declared by a minimal ambient
module in the package (`src/fetch-types.d.ts`), because the package compiles without the `DOM` lib
(`01` § 2 rule 2). Node 26, browsers and React Native all provide the runtime objects.

## 4. The Web Adapter — Cookie Through the Next Proxy (as built behaviour, kept)

As built (ADR-059, ADR-074, A-71, `docs/FRONTEND/00` § "The Next proxy owns `/api/`"): nginx sends
every `/api/` request to Next; `frontend/src/app/api/v1/[...path]/route.ts` relays it upstream with
the access token from an httpOnly cookie, and **strips `token`/`refreshToken` from any JSON answer**
before the browser sees it. The browser never holds a token.

The web adapter therefore:

- `baseUrl: ""` — same-origin `/api/v1/…` paths, exactly as `typedApi` today;
- `decorate`: no-op (the cookie travels by itself);
- `performRefresh`: `POST /api/v1/auth/refresh` — the **Next** route, which reads the refresh cookie,
  calls the backend and re-sets the cookies (as built, `route.refreshCookie.f05.test.ts`);
- `sessionEnded`: `sessionExpiredRedirect` (as built: to `/login?callbackUrl=…` from a protected page,
  nowhere from a public one);
- **during and after the migration, the transport is the existing axios instance**, wrapped as a
  `FetchLike` in `frontend/` (the shape `typed.ts`'s `apiFetch` already has). Refresh-once, the
  password-change and MFA-enrolment redirects, the access-denied store and the F-07 normalisation
  stay byte-identical; `01` § 8.1 step 5 lists the tests that prove it. Replacing axios with fetch is
  the separate optional card P35-11.

## 5. The Mobile Adapter — Bearer + Rotating Refresh in the Secure Store

The app talks to the backend **directly**, never through the Next proxy (the proxy strips tokens by
design, A-71). It uses the **native ingress** `https://<host>/native/api/v1/…`, routed by the edge
(nginx / the Cloudflare tunnel / the Helm ingress) to the backend's `/api/v1/…` — so the generated
paths are unchanged and only `baseUrl` differs (`../MOBILE/20` § 3 decides and justifies the path
prefix).

- **Access token:** in memory only, never persisted (15 minutes, as built).
- **Refresh token:** in `expo-secure-store` — iOS Keychain / Android Keystore-backed —
  `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, so background sync can refresh after the
  first unlock, never migrating to another device by backup (`../MOBILE/06`, ADR-135, and the
  biometric trade-off in `../MOBILE/20` § 6).
- `decorate`: `Authorization: Bearer <access>`; plus `X-Installation-Id`.
- `performRefresh`: `POST /native/api/v1/auth/refresh` with `{ refreshToken, sessionId }` (the body
  the backend accepts today, `auth.controller.ts#refresh`), then **writes the rotated refresh token to
  the secure store before resolving**. The backend revokes the old token at rotation (as built,
  `auth.service.ts` "TOKEN_ROTATION"); a crash between the server's rotation and the local write loses
  the session — the user signs in again, and the outbox is kept (`06` § 8). That is the accepted cost
  of rotation; the reuse-detection rule that makes rotation worth it is server-side (`../MOBILE/20` § 5).
- `sessionEnded`: clears the tokens, tells the sync engine (which purges the working set, never the
  outbox — `06` § 8), and routes to sign-in.
- **Extra headers:** `X-App-Version`, `X-App-Build`, `X-App-Platform` (`ios` | `android`),
  `X-Installation-Id` — read by the server's compatibility policy (`../MOBILE/20` § 9); never trusted
  for authorization.

## 5a. Tenant Hint and Branding Cache (owner decision 2026-10-08 — mobile tenant setup)

The app is set up for **one tenant per install** before sign-in (`../MOBILE/20` § 2a). Two small pieces
live in the package so the rule is implemented once:

- **Tenant-hint injector:** `createApiClient({ …, tenantHint: () => string | null })` adds
  `X-Tenant-Code: <code>` to every request when the function returns a code. It is a **hint**: before
  sign-in it scopes the account lookup (a wrong-tenant account gets the generic 401); after sign-in the
  token's tenant is authoritative. As built, `auth.middleware.ts` honours `x-tenant-code` /
  `x-tenant-id` as an override **for a super admin**; so the native ingress **moves** the app's
  `X-Tenant-Code` into an edge-set `X-Callibrator-Tenant-Hint` and strips both override headers, and
  super admins are refused at native token issuance (owner Q-M6; `../MOBILE/20` § 2a.4). The client
  never sends `x-tenant-id`, and never derives a tenant from anything the server did not confirm. The
  web passes no hint.
- **Work-email fallback:** `POST /public/tenants/discover { email }` → `{ code }` or the uniform 404
  (`../MOBILE/20` § 2a.5); then the by-code read below. Never the web's `/auth/login/discover`.
- **`BrandingCache` port** with a fetcher over `GET /public/tenants/by-code/:code`:
  ```ts
  export interface BrandingStore { read(code: string): Promise<CachedBranding | null>; write(code: string, b: CachedBranding): Promise<void>; clear(): Promise<void> }
  export function createBrandingCache(client: ApiClient, store: BrandingStore): { get(code: string): Promise<TenantBranding>; refresh(code: string): Promise<TenantBranding>; clear(): Promise<void> }
  ```
  Revalidates with `If-None-Match` (304 keeps the stored copy); serves the stored copy offline. The
  stored value holds **only** the public answer (name, code, colour, logo URL, public auth flags) — it
  is the one tenant-identifying value allowed outside the encrypted store, because it is public by
  definition. The app's adapter keeps it in MMKV; `clear()` runs on tenant switch (sign out + empty
  outbox + wipe). A 404 clears it and returns the app to tenant setup.

## 6. Behaviour Owned by the Package

### 6.1 Envelope

```ts
export function unwrap<T>(answer: { data?: { data: T } }): T;                       // single resource or document
export function unwrapList<T>(answer: { data?: { data: T[]; meta?: PaginationMeta } }): { rows: T[]; meta: PaginationMeta | null };
```

Rows are `data`; paging is the **top-level** `meta`, a sibling of `data` (`CLAUDE.md` § The Response
Envelope). `unwrapList` throws an `ApiError` of kind `contract` on a `data` that is not an array —
the silent empty list three screens once showed is a loud failure here. The two report documents
that carry arrays inside `data` (A-343) use `unwrap`, not `unwrapList`.

### 6.2 Errors

Every failure **rejects** with one normalised `ApiError` (F-07's rule, extended):

```ts
export class ApiError extends Error {
  readonly status: number | null;          // null: no response
  readonly code: string | null;            // the backend's machine code — the envelope's top-level `code`
  readonly kind: "http" | "timeout" | "network" | "aborted" | "contract";
  readonly requestId: string | null;       // X-Request-Id — what a user quotes to support
  readonly retryAfterSeconds: number | null;
  readonly errors: readonly { path: string; code: string; message: string }[] | null; // 400 field errors — the contract's top-level `errors[]` (docs/CONTRACT/03 B-ENV-3, target); as built only `details[{field,message}]`, and only outside production
}
```

| Answer | Classification | What the client does |
|---|---|---|
| **400** | `validation` | nothing; the screen maps `details` to fields |
| **401** on a credential endpoint (the F-05 table, now in `auth.ts`, plus the native ones of `../MOBILE/20`) | `credentials` | nothing — it is an answer about what was just sent (a wrong password, a spent code) |
| **401** elsewhere | `session` | single-flight `performRefresh`, then **one** retry of the original request; a second 401 or a failed refresh → `sessionEnded("refresh_failed")`. A refresh answered 401 **`REFRESH_RACE`** (native only: another run of the same install rotated first — `../MOBILE/20` § 5 rule 2a) is not a failure: the adapter re-reads the stored token and refreshes once more |
| **403** with `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED` | `gate` | `onEvent({ type: "gate", code })` — the platform routes to its change-password / MFA screen (as built on the web: A-123, A-160) |
| **403** with a `SCOPE_LOSS_CODES` code (contracts; P19-08 § 10: `ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`, `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING`) | `scope_lost` | `onEvent({ type: "scope_lost", code })` — the sync engine purges the working set; the UI explains |
| **403** otherwise | `forbidden` | nothing; "you do not have permission" inside the caller's own tenant |
| **404** | `not_found` | nothing. **The client never distinguishes "another tenant's" or "another facility's" from "does not exist"** — the server made them indistinguishable on purpose, and no client message may suggest otherwise |
| **409** | `conflict` | nothing; the screen shows the **state explanation**: the i18n message for `code` (`errors.conflict.<CODE>`), else the server's `message` — never a generic "something went wrong" (`CLAUDE.md` § Status Codes) |
| **413 / 415** | `payload` | nothing; the photo/file screen explains |
| **401** `SESSION_EXPIRED_ABSOLUTE` (native) | `session_expired` | `sessionEnded("absolute_limit")` — the app shows a **re-sign-in prompt** naming the reason; the outbox is kept (`../MOBILE/20` § 5 rule 4) |
| **426** with `APP_UPDATE_REQUIRED` | `update_required` | `onEvent({ type: "update_required", minVersion })` — the app shows its blocking update screen (`../MOBILE/08`) |
| **429** | `rate_limited` | GETs retried after `Retry-After` (§ 6.4); otherwise surfaced with the seconds (as built: `readApiFailure`) |
| **5xx, 504, timeout, network** | `unavailable` | GETs retried (§ 6.4); mutations surfaced (or retried by the sync engine) |

### 6.3 `Idempotency-Key`

The backend honours `Idempotency-Key` on the capture routes and `POST /attachments` (ADR-127 § 7,
P19-02 § 9.2, built by P21-03): same key + same request hash → the stored **status**, with the body
**re-read in the current context** (no response body is stored — ADR-126 Am. 1; `docs/CONTRACT/03`
B-IDEM-1); same key, different hash → 409 `IDEMPOTENCY_KEY_REUSED`; in flight → 409
`IDEMPOTENCY_IN_FLIGHT`; the caller's access changed since the first attempt → 409
`IDEMPOTENCY_SCOPE_CHANGED`. All target (P21-03).

- The option exists **only on operations whose OpenAPI document declares the header** — the
  generated `parameters.header` type carries it, so passing a key to a route that would ignore it is a
  compile error.
- The client **never invents a key on its own.** The sync engine passes the key it froze with the op
  (`06` § 5). Interactive screens get a key from the hooks' mutation helper, created **once per user
  intent** (the first submit of a form) and reused for every retry of that same submission — a double
  tap or a retry after a timeout replays instead of duplicating.
- `newIdempotencyKey()` makes a UUID v4 from the injected random source (`crypto.getRandomValues` on
  the web, `expo-crypto` on the app).

### 6.4 Retries

| Request | Retried by the client? |
|---|---|
| `GET`/`HEAD` on network error, timeout, 502/503/504, 429 | **yes**, at most **2** retries, backoff 500 ms × 2ⁿ ± 20 % jitter, `Retry-After` honoured up to 30 s |
| any 4xx other than 408/429 | **never** |
| a mutation **without** a key | **never** — a lost answer to a POST is not knowable; the screen asks the user |
| a mutation **with** a key, `retry: "idempotent"` | yes, as a GET; the sync engine does **not** use this — it has its own unlimited loop (P19-08 § 9.3) |

### 6.5 Uploads and downloads

- Multipart bodies are `FormData`; the client **removes** a default `Content-Type` so the platform
  sets the boundary (as built on the web, `client.ts` request interceptor). On React Native the part is
  `{ uri, name, type }`.
- Upload **progress** is not available from `fetch` on every platform; a screen that needs it uses the
  optional `UploadPort` (XHR-based) its app provides. The sync engine does not need progress.
- `parseAs: "blob" | "arrayBuffer"` for downloads (report data documents are JSON; there are no stored
  certificate or report files, ADR-095, ADR-126 § 8).

## 7. What Stays Outside

- **Realtime** (Socket.IO, ADR-031; `POST /auth/socket-token`) is not in this package; the app's
  socket use is decided in `../MOBILE/01`.
- **The public verification page's `fetch` wrapper** (`/verify`, built to avoid axios in that bundle,
  P10-13) stays as built; it is not an authenticated client.
- **Redirect targets** (which screen a gate opens) are the platform's.

## 8. Tests

- Unit tests at the package's **100 %** gate, with an in-memory `FetchLike` double that returns real
  envelopes produced by `packages/contracts/src/envelope.ts`'s schemas (the envelope test of ADR-097
  Am. 1 § 5 is the precedent): single-flight under 10 concurrent 401s performs one refresh; a second 401
  ends the session; credential endpoints never refresh; `unwrapList` refuses `data.rows`; each status
  row of § 6.2 classifies as stated; a GET is retried and a key-less POST is not.
- **A mock proves the client, not the contract** (`CLAUDE.md` § Evidence). The proof against the real
  server is the live E2E suite on the web and the app's Maestro suite against a compose stack
  (`../MOBILE/09`), plus `api:types:check` keeping the generated types equal to the published document.

## 9. Bad Implications

- The web keeps axios underneath the generated client for now — two HTTP layers, deliberately, until
  P35-11 proves a fetch transport preserves every pinned session behaviour.
- The credential-endpoint table is data that must be kept in step with new auth routes; a new
  credential endpoint missing from it would refresh on a wrong password and could end a session. The
  backend's `authPublic.route.ts`/`auth.route.ts` route list is checked against the table by a guard
  test in P35-06.
- The mobile adapter's crash-between-rotation window ends a session now and then — visible to users as
  "please sign in again", with no data loss.
