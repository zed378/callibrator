# Feature Spec — P19-08 Offline Field Capture: the `/field` App, Its Service Worker Under the Nonce CSP, the Encrypted Per-User IndexedDB, the Outbox and Its Idempotent Replay, Conflicts, Photos, QR Scanning, Purge Rules, One Field User per Browser Profile, Installability, Updates and Real-Device Tests

**Written:** 2026-10-08 — **before** implementation. **Everything in this spec is TARGET: nothing here is built.**
**Task:** P19-08 (Phase 19, Domain Design). Builds in **P22-10** (the PWA: worker, store, sync, field screens' offline mode), **P22-03** (the capture stepper the field app hosts), P22-02 (device registration in the field app), **P21-03** (server pieces this spec needs: idempotency on `POST /attachments`, the `view=field` projection with P21-02, the scope fingerprint and refusal codes with P21-09), P26-02 (field UAT on real phones), P29-01 (the field guide); consumes P19-01 (catalogue download), P19-02 (sessions, idempotency, `client_ref`, 409 codes), P19-03 (QR lookup, device create, photos), P19-06 (offline draft preview, the "to sign" list)
**Author:** software-architect agent, under the owner's standing delegation (decide by best practice, record it; owner decisions stay open with a recommendation)
**Card scope (verbatim):** *"Offline capture spec (UD-14): service worker scope under the nonce CSP, IndexedDB queue, idempotency keys, photo queue, conflict 409, catalogue ETag download (F-79)."*
**Decision record:** **ADR-127 Amendment 1** (`MEMORY/DECISIONS.md`, written with this spec)
**Spec refs:** ADR-127 § 1 – § 12 (this spec implements it) · ADR-126 Am. 1 § 1, § 7 – § 9 (`client_ref` per creator, `revision`, idempotency without stored bodies, 409 codes) · ADR-125 § 3, § 6 and Am. 1 (pinned versions, the published document and its `ETag`) · ADR-132 (QR lookup, photos, the bound device contract) · ADR-124 and Am. 1 – 2 (facility scope, binding changes revoke sessions — AM-1) · ADR-059 (the browser never holds the access token) · ADR-071 / ADR-090 (nonce CSP, pages per request, a11y) · ADR-122 (palette, status tones) · ADR-131 (route groups — not built) · ADR-084 / ADR-085 (session revocation) · ADR-128 (signed links) · `MEMORY/specs/P19-02-ipm-session-aggregate.md` § 7, § 9, § 10 · `P19-03-device-extensions.md` § 4, § 5, § 7, § 8 · `P19-01-inspection-catalogue.md` § 6, § 7.5, § 8.3 · `P19-06-ipm-report-document.md` § 7.2, § 10.2 · `P18-03-facility-scope-permissions.md` § 5, § 8 · `P18-04-…` G-22, G-27, C-05 · `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` BF-3, BF-4, EP-19, EP-20 (FT-84 … FT-96), AM-1, AM-16, AM-23, AM-24, AM-25, AM-26, G-26 … G-28, PT-24, OQ-10 · `docs/UPSTREAM/02-FEATURES.md` F-77 … F-79 · `docs/FRONTEND/00-FRONTEND-STANDARDS.md` § Content Security Policy
**Code read 2026-10-08 (working tree, read only):** `frontend/src/proxy.ts` (the nonce per request; matcher excludes `api`, `_next/static`, `_next/image`, `favicon.ico`, `uploads/public`; only `/dashboard*` is redirected without a usable session), `src/lib/securityHeaders.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `worker-src`/`manifest-src`, `Permissions-Policy camera=()`), `src/api/client.ts` (F-05: refresh once on 401 outside `CREDENTIAL_ENDPOINTS`; `endSession()` when the refresh fails; A-123/A-160 gate codes), `src/api/typed.ts` (openapi-fetch over the generated schema, sent through `api`), `src/lib/authCookies.ts`, `src/lib/theme.ts`, `src/i18n/config.ts` (`htmlLangFor`: `/dashboard*` is `en`, other pages the locale, default `id`), `scripts/bundle-budget.mjs` + `bundle-budget.json` (first-load JS per route, brotli and gzip ceilings; `/` 180 / 150 KB), `package.json` (Next 16, React 19, `next-bun-compile` — the image serves `public/` from the compiled binary; no service-worker or IndexedDB dependency today); backend `middlewares/auth.middleware.ts` (`tenantRefusal` answers 403 with a message and **no code**; only `PASSWORD_CHANGE_REQUIRED` and `MFA_ENROLMENT_REQUIRED` carry codes), `routes/api/auth.route.ts` (`POST /auth/verify`).

> **Deviation note (2026-10-08, ADR-136; `docs/CONTRACT/04`):** machine codes travel as a **top-level `code`** in the error envelope, not `data.code` — as built, `response.util.ts#error` spreads its `extra` at the top level and `data` is `null` (e.g. `auth.middleware.ts`'s `PASSWORD_CHANGE_REQUIRED` / `MFA_ENROLMENT_REQUIRED`). Every error's `data.code` / `data.<field>` below now reads top-level `code` / `<field>`.

> **Privacy.** No upstream data value appears here. Every example is synthetic.

---

## 1. Problem

Provider technicians inspect devices in basements, radiology rooms and rural health centres with poor or no connectivity; upstream shipped a React Native APK whose batch endpoints trusted the body for the user and the facility (S-11) and whose tokens carried the password hash (S-10). The owner chose a PWA with offline mode (UD-14); ADR-127 fixed the shape — opt-in offline mode on the field screens only, a static same-origin worker under the nonce CSP, one encrypted IndexedDB per user and tenant, an outbox replaying the **normal** API with idempotency keys, 409/404 with reasons, 72-hour purge, refusal of logout with unsynced work, a support floor — and left to this card the exact worker scope and caching, the database schema and encryption, the sync engine, the conflict screens, the photo and QR pipelines, the purge triggers, the shared-phone rule (AM-23), installability, updates and the test strategy. Building it from ADR-127 alone would hit four walls found here (§ 2): App Router navigations need the server, a service worker scoped to `/` would control every page of the product, a 401 from a wrong signing password would purge the phone, and nothing on the server yet tells the phone that its user lost a facility.

Personas: the **provider technician** (unbound; works across facilities; the main user; shared phones are most likely here), the **facility technician** (bound HT; one facility), the **tenant administrator** (revokes a lost phone's sessions; may wipe another user's field data from a shared phone), the **phone** itself (P14 of `docs/SECURITY/15`: offline it is nobody), the **server** (replays answer in the current context).

---

## 2. What Is Already Decided (not re-decided here) — and the Gaps Found

| Decision | Source |
|---|---|
| Offline is a mode of the field capture screens only — device lookup by QR, device registration with photos, IPM capture; opt-in per device; the rest of the product is online-only and says so | ADR-127 § 1 |
| A web app manifest; installation recommended, on iOS effectively required; `navigator.storage.persist()` requested, the grant and the quota shown | ADR-127 § 2 |
| CSP gains `worker-src 'self'` and `manifest-src 'self'`; one static, same-origin, versioned worker, no third-party worker library, no `importScripts` from another origin | ADR-127 § 3 |
| The worker caches `/_next/static/*` cache-first and the capture document network-first (offline fallback only); **no API response in the Cache API**; the cached document replays its nonce while offline — a recorded exception | ADR-127 § 3; FT-84, FT-89 |
| One IndexedDB per user and tenant; catalogue, working set (≤ 2,000 devices per facility by default, capture fields only) and outbox; the working set purged 72 h after the last sync (the outbox not); AES-GCM with a **non-extractable** WebCrypto key in the same database | ADR-127 § 4 |
| Photos re-encoded to JPEG ≤ 2048 px, quality 0.8 (EXIF dropped); undecodable files queued as is and converted, stripped and scanned on the server; the server never trusts the client's stripping; `camera=(self)` | ADR-127 § 5; ADR-132 § 7 |
| QR: `BarcodeDetector` where available, else a pure-JavaScript decoder loaded on demand; **no WebAssembly**; typing the code always possible | ADR-127 § 6 |
| The outbox replays the normal API; every queued mutation has an `Idempotency-Key`; `client_ref` per creator, resolved in context; per-session ordered queue; attribution and scope from the server; `client_captured_at` a claim only | ADR-127 § 7; ADR-126 Am. 1 § 1, § 8 |
| Idempotency stores a scope fingerprint and a resource reference, never a body; a replay re-reads in the current context; a changed scope is 409 `IDEMPOTENCY_SCOPE_CHANGED` | ADR-126 Am. 1 § 8 (AM-25) |
| Conflicts are rare (append-only, many sessions per device) and each is a 409/404 with a reason, kept as "needs attention", never silently dropped; a retired version is accepted offline | ADR-127 § 8; ADR-125 § 3 |
| Logout refuses while the outbox is non-empty (sync or confirmed discard); a revoked session purges the working set on the next online contact; no offline PIN; the device lock screen is required by the field guide | ADR-127 § 9 |
| Support floor: Android Chrome/Chromium 120+, iOS/iPadOS Safari 17.4+ installed to the home screen, current desktop browsers; others get online-only capture with a banner | ADR-127 § 10 |
| A draft's report can be previewed offline; the issued report exists only after the server accepted the submit | ADR-127 § 11; P19-06 § 10.2 |
| A binding change or a facility leaving `active` revokes the user's sessions (AM-1, OQ-1); one field user per browser profile, enforced in the app (AM-23, OQ-10); purge on server time (AM-24); a scope fingerprint on `/auth/verify` (AM-26) | `docs/SECURITY/15` § 13.1 working decisions |

### Gaps and contradictions found — resolved by ADR-127 Amendment 1 (deviation protocol)

| # | What `docs/` says | What is true or missing | Resolution (§) |
|---|---|---|---|
| G-O1 | ADR-127 § 3: the worker's **scope `/`** | a worker scoped to `/` controls every page — the landing, sign-in, the dashboard — so its fetch handler runs on every navigation of every user who ever enabled field mode on that browser, and a defect in it breaks the whole product; a worker controls the **pages** in its scope and sees **all** their requests (including `/_next/static/*`), so a narrower scope loses nothing | **scope `/field`** (the worker script stays `/sw.js`; a scope below the script's path needs no `Service-Worker-Allowed` header); a guard asserts no other route starts with `/field` (§ 4) |
| G-O2 | ADR-127 § 1, § 3: "the capture screen's HTML document" cached; P22-03: a "mobile-first stepper" | in the App Router a client-side navigation fetches the next route's RSC payload **from the server**; offline every `<Link>` between field screens fails, and caching RSC payloads would put rendered tenant data in the Cache API (FT-84) | the field app is **one document, `/field`**, whose screens are client state (URL kept in `?view=…&id=…` through `history.pushState`, which Next 16 syncs with `useSearchParams` without a server round trip); links out of the field app are full navigations and online-only (§ 3) |
| G-O3 | ADR-127 § 3: "a static, same-origin, versioned file built with the app" | a static `public/` file does not know the build; Next's client manifests are server-side; the frontend image is a compiled binary serving `public/` | `public/sw.js` is **generated before `next build`** by `scripts/build-sw.mjs` from `src/sw/serviceWorker.ts` (bundled by the same toolchain, no dependency), stamped with a version (`<package version>-<git short sha>-<source hash>`); excluded from the proxy matcher with `manifest.webmanifest`; served `Cache-Control: no-cache` with its **own** worker CSP (§ 4) |
| G-O4 | ADR-127 § 3 lists only network-first HTML and cache-first static | lazily loaded chunks (scanner, PDF preview, the store) are not in the HTML; a chunk not fetched while online is missing offline | install pre-caches `/field` and every `/_next/static` and `/fonts` URL its HTML references; after activation the app **warms** every lazy module by importing it (each `import()` passes through the worker); a module still missing offline shows "needs a connection" for that feature only (§ 4.3) |
| G-O5 | ADR-127 § 9: "a revoked session answers 401 on the next online contact; the client then purges"; AM-1 adds the 403 codes | (a) a **401 from a wrong signing password** (P19-06 G-R12) or any credential endpoint is not a session ending; (b) `client.ts` already refreshes once on a 401 — only a **failed refresh** means the session is gone; (c) the server's tenant refusals are 403 **without a code** (`auth.middleware.ts#tenantRefusal`) and no facility refusal exists yet | the purge triggers are **the refresh failing** (`endSession`) and the **scope-loss codes** `SCOPE_LOSS_CODES` = `ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`, `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING` — a new contract the server must send in top-level `code` (built by P21-09 with AM-1; the tenant ones by P21-03 in `tenantRefusal`) — never a raw 401 or 403 (§ 10) |
| G-O6 | AM-26: "`/auth/verify` (and the field screens' sync response) returns a scope fingerprint" | there is no "sync response" — the outbox replays ordinary routes | the fingerprint comes only from `POST /auth/verify` (field `scopeFingerprint`), called at the **start of every sync cycle** and at app start online; a different value purges the working set and catalogue and re-downloads (§ 10.3) |
| G-O7 | ADR-127 § 4: working set = "only the fields capture needs"; FT-90: "an ordinary list read" | `GET /calibration-devices` returns the full device shape (registrant, vendor, intervals, notes …) | `GET /calibration-devices?view=field` returns the narrow `fieldDeviceSummary` (§ 7.2) — an additive contract on the existing route (P21-02), still the hooked, marked list read (G-22 covers it) |
| G-O8 | P19-02 § 10.2: IPM photos through `POST /attachments`; only the IPM routes and the device photo route honour `Idempotency-Key` | a replayed photo upload without a key stores the photo twice | `POST /attachments` **honours `Idempotency-Key`** (the P19-02 § 9.2 middleware; request hash over the file's SHA-256 + fields) — added by P21-03 (§ 9.5) |
| G-O9 | AM-23: "an explicit administrator wipe" | nothing defines it, and destroying another user's unsynced captures is the loss of potential evidence | an **unbound tenant administrator** signed in on the phone may wipe another user's field database after a typed confirmation; the app reports it to `POST /api/v1/field/wipes` (`rbac([TENANT_ADMIN])`, unmarked) which writes a `DELETE` audit row `FIELD_DATA_WIPED` with counts only (§ 11.3) |
| G-O10 | ADR-127 § 5: `Permissions-Policy` becomes `camera=(self)` (globally) | only the field app uses the camera | `camera=(self)` is sent **only on `/field`** responses (next.config path-scoped headers); every other page keeps `camera=()` (§ 5) |
| G-O11 | ADR-127 § 4: "the outbox: drafts, submits and photos waiting to sync" — an op log | a technician edits a draft dozens of times; replaying every keystroke is waste, and a replayed op must carry the **same body** as its first attempt (or the request hash changes and the key is refused) | the local **capture is the source of truth**; the sync engine **plans** a minimal op (create / PATCH header / PUT results / photo / submit) from the difference between the capture and the last state the server confirmed, **freezes** each planned op (key + body) before sending, and re-plans only after it completes (§ 9) |
| G-O12 | ADR-127 § 4: encryption of "outbox and working set" | lookups by QR and search by name over encrypted rows need either plaintext indexes (a leak) or decryption | the working set is stored in **encrypted pages** of ≤ 200 devices and decrypted **into memory** when the field app opens (≤ 2,000 devices per facility × a few hundred bytes); no plaintext index on any tenant value; only opaque ids and timestamps are clear (§ 7.1) |

---

## 3. The Field App — Routes, Screens, State

### 3.1 One document

| URL | What | Online | Offline |
|---|---|---|---|
| `/field` | the whole field app (screens below as client state) | rendered per request (nonce CSP), protected like `/dashboard` by `proxy.ts` (no usable session → `/login?callbackUrl=/field`) | the worker serves the cached document of the last successful online load (§ 4) |
| `/field?view=…` | screen state (`home`, `scan`, `device&id=`, `register`, `capture&ref=`, `preview&ref=`, `outbox`, `attention&ref=`, `sign`, `settings`) — pushed with `history.pushState`; the back button works offline | same | same (no request) |
| links to `/dashboard/...` | plain `<a>` (full navigation) | normal | disabled with "Needs a connection" |

`proxy.ts`: the protected prefixes become `/dashboard` and `/field` (one list, `PROTECTED_PREFIXES`, with `proxy.test.ts` cases). `htmlLangFor` already gives `/field` the public locale (Indonesian by default) — the field app is Indonesian-first; every string in `id.ts` **and** `en.ts` (namespace `field`).

Layout: `app/field/layout.tsx` (under ADR-131's `(app)` group when P10-18 builds it — the URL stays `/field`), a lean shell: no sidebar, no socket connection, no dashboard providers beyond messages and the theme; `metadata.manifest = "/manifest.webmanifest"` (so **only** the field app advertises installation); theme tokens and status tones of ADR-122; one `<main>`, one `<h1>` per screen state (the screen's title, moved focus on change, announced by an `aria-live="polite"` region).

### 3.2 Screens

| Screen | Purpose | Notes |
|---|---|---|
| Home | outbox count and state, last sync (server time), working-set summary per facility with its expiry ("purged in 41 h unless synced"), storage use, "Sync now", "Scan", "Register device", the "to sign" list (P19-06 § 7.2) | the outbox count shows on **every** screen's header (ADR-127 § 7) |
| Settings — offline mode | "Prepare this phone for offline work": choose facilities (unbound: up to 3; bound: its own), show the device count **before** download, request `persist()`, show grant + quota, download; "Turn off offline mode" (= purge, refused with a non-empty outbox) | opt-in (ADR-127 § 1); a browser below the floor sees "This browser cannot work offline: <missing feature>" |
| Scan | camera QR (§ 8.2) or typed code → device; unknown → "Not in your offline list — register a new device or sync later" (offline) / the by-QR lookup (online) | |
| Device | identity, room, condition, last IPM, due state, photo completeness; "Start IPM" (or "Resume draft"), "Add photos" | data from the working set or the online read |
| Register device | P19-03's create form (unbound: QR from the sticker; bound: no QR field — ADR-132), room pick or create (online only — creating a room offline is refused: rooms are the facility's register, P19-03 § 6.3), two photos | queued with a `clientRef` |
| Capture | P22-03's stepper over the pinned version's items (from the local catalogue), `normaliseResult` / `missingRequiredItems` from contracts (the server's exact rules), autosave **locally** on every change; "Submit" freezes the capture | |
| Preview | the P19-06 renderer over `buildIpmReportPreview` (watermark "DRAFT — NOT A RECORD") | offline-capable (the renderer and font are warmed, § 4.3) |
| Outbox / Needs attention | per capture: state, last error with the server's explanation, actions (§ 9.6) | never a silent drop |
| Sign | online: the P19-06 signature dialog for synced, submitted captures | credentials never stored |

### 3.3 Client state

- **Zustand store** `stores/fieldStore.ts` (in-memory): decrypted working set index (by id, by normalised QR, by facility, name search), the catalogue in memory, captures, sync state; hydrated from IndexedDB at start; every mutation written through to IndexedDB **before** the UI confirms it.
- **No React state in the worker**; the worker knows nothing of tenant data (§ 4.2).

---

## 4. The Service Worker (G-O1, G-O3, G-O4)

### 4.1 Registration and scope

- Registered **only** by the field app, only after the user enables offline mode: `navigator.serviceWorker.register("/sw.js", { scope: "/field", type: "classic", updateViaCache: "none" })`. The dashboard and the public pages never register it, and the worker controls no page outside `/field`.
- Turning offline mode off unregisters it and deletes its caches (`caches.keys()` filtered by the `cf-` prefix).
- **Guard** `fieldRouteNamespace.guard.test.ts`: no `app/**` route other than `field` starts with `/field` (the scope is a prefix match: a future `/fieldwork` would be controlled).

### 4.2 What it does (the whole fetch policy)

| Request | Policy |
|---|---|
| navigation to `/field` (any query) | **network-first** (3 s timeout); a `200` HTML response with `Content-Security-Policy` is stored as **the** shell (`cf-shell-<version>`, one entry, key `/field`), replacing the previous; offline or timeout → the stored shell; none stored → a built-in offline page (plain text, no script) |
| `GET /_next/static/**` | **cache-first** (`cf-static-<version>`); a miss fetches and stores (content-hashed, immutable) |
| `GET /fonts/**`, `/brand/**` icons used by the field app | cache-first (`cf-static-<version>`) |
| `GET /manifest.webmanifest` | network-first, cached copy offline |
| **anything else** — `/api/**`, `/uploads/**`, `/_next/image`, other origins, every non-GET | **not intercepted** (`fetch` passes through untouched); **never** `cache.put` — FT-84 |

- The worker holds **no tenant data, no token, no cookie value** (the cookies are httpOnly and travel with same-origin requests as now — ADR-059); it never reads a response body except to store the shell and static files.
- No `importScripts`, no third-party library, no `eval`, no WebAssembly.
- Its own response headers (next.config, `source: "/sw.js"`): `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: no-cache, max-age=0`, `X-Content-Type-Options: nosniff`, and a **worker CSP** `default-src 'none'; connect-src 'self'; script-src 'self'` (a worker's own CSP comes from its script response; it fetches only same-origin).

### 4.3 Install, warm-up, cache limits

- **install:** fetch `/field` (network), store it as the shell, parse its HTML for `/_next/static/` and `/fonts/` URLs (`<script src>`, `<link href>` — a strict regex over attributes, never `eval`), fetch and store them; any failure fails the install (no half-populated version becomes active).
- **activate:** delete every `cf-*` cache of another version; **no** `clients.claim()` unless this is the first install (an update waits for the user, § 13).
- **warm-up** (the app, after activation, online): `import()` of every lazy field module (scanner, PDF preview and its font URLs, the photo pipeline, the IndexedDB store) — each request passes through the worker and lands in `cf-static-<version>`; the Settings screen shows "Ready for offline use" only after the warm-up resolved. A lazy module that fails offline later (evicted) → that feature says "Needs a connection" and the rest works.
- **Size:** `cf-static` is bounded by what the field app loads (target ≤ 3 MB including the font); `navigator.storage.estimate()` shown; entries not referenced by the current shell and older than 14 days are deleted at activate.

### 4.4 The nonce, honestly (ADR-127 § 3, FT-89)

The stored shell carries the nonce of the response it was rendered with, in its HTML and in its stored CSP header, and is replayed only while offline (or on a 3-s timeout). The shell contains **no tenant data** (the field page renders data client-side from IndexedDB; a server-component read of tenant data in `app/field/**` is refused by a guard, `fieldShellNoTenantData.guard.test.ts`: the field page and layout import no API service and no server fetch other than messages and the theme). Every successful online load replaces it.

---

## 5. CSP, Permissions and Headers (P22-10; `securityHeaders.ts`)

- `buildContentSecurityPolicy` gains `worker-src 'self'` and `manifest-src 'self'` **for every page** (the directives are inert where nothing registers a worker); everything else unchanged — `script-src` keeps `'strict-dynamic'` without `'wasm-unsafe-eval'` (FT-88).
- `media-src` is not added: the camera stream is a `MediaStream` assigned to `video.srcObject`, not a URL load.
- `img-src` already has `blob:` (photo previews from `URL.createObjectURL`).
- **`Permissions-Policy`**: `camera=(self)` on `source: "/field"` only (next.config path-scoped header that **replaces** the global one for that path); all other paths keep `camera=()` (G-O10). `geolocation` unchanged.
- `proxy.ts` matcher excludes `sw.js` and `manifest.webmanifest` (as it excludes `_next/static`), so neither gets a page CSP with a nonce.
- Tests: `securityHeaders.test.ts` (both directives, no `wasm-unsafe-eval`, `camera=(self)` only for `/field`), `proxy.test.ts` (`/field` redirected without a session; `/sw.js` and the manifest untouched), the browser CSP smoke on `/field` (0 violations with the worker active, online and offline).

---

## 6. Installability — the Manifest

`public/manifest.webmanifest` (static, `application/manifest+json`):

```json
{ "id": "/field", "name": "Callibrator — Lapangan", "short_name": "Callibrator",
  "description": "Inspeksi dan registrasi alat di lapangan", "lang": "id",
  "start_url": "/field?view=home", "scope": "/field", "display": "standalone",
  "orientation": "portrait", "background_color": "<ivory token hex>", "theme_color": "<charcoal/copper token hex>",
  "icons": [ { "src": "/brand/icon-192.png", "sizes": "192x192", "type": "image/png" },
             { "src": "/brand/icon-512.png", "sizes": "512x512", "type": "image/png" },
             { "src": "/brand/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" } ] }
```

- Colours are the ADR-122 light tokens' hex values, copied by `scripts/build-sw.mjs` from the token file at build (one source; a test compares them).
- Icons from the brand set (ADR-118 Am. 2); the maskable variant generated by `gen-static-icons.mjs` if absent.
- iOS: `apple-touch-icon` exists; the field layout adds `<meta name="apple-mobile-web-app-capable" content="yes">` and the status-bar style through the metadata API (no inline script).
- The Settings screen explains installation per platform (Android: the browser's install prompt, captured with `beforeinstallprompt` and offered as a button; iOS: "Share → Add to Home Screen", with the reason: storage is kept only for installed apps).

---

## 7. IndexedDB — Schema, Encryption, Keys (ADR-127 § 4; G-O12)

### 7.1 Databases and stores

**Registry** `callibrator-field-registry` (one per browser profile; **no tenant data**): store `users` — `{ key: "<tenantId>:<userId>", tenantId, userId, enabledAt, outboxCount, workingSetPresent, lastSyncServerAt }`. `outboxCount` is a number only (it tells the next user that unsynced work exists — AM-23 needs it — and nothing else). A `localStorage` flag `cf.field.present = "1"` marks the profile for the sign-in guard (§ 11.2).

**Per user** `callibrator-field-<tenantId>-<userId>` (version 1; upgrades only add stores/indexes and migrate records — the outbox store is **never** dropped by an upgrade):

| Store | Key | Clear fields | Encrypted payload |
|---|---|---|---|
| `keys` | `"aes"` | — | the **non-extractable** `CryptoKey` (AES-GCM 256, `extractable: false`, usages `encrypt`/`decrypt`) — stored as a structured-cloneable `CryptoKey`; never exported |
| `meta` | name | `schemaVersion`, `createdAt` | `{ scopeFingerprint, lastSyncServerAt, lastSyncDeviceAt, facilities: [{ id, name, code, downloadedAt, deviceCount }], tenantSettings: { qrPrefix, qrDigits, timeZone, countersignEnabled }, user: { displayName, roleName, bound } }` |
| `catalogue` | `"published"` | `etag`, `fetchedAt` | the published document (P19-01 § 8.3) — platform content, encrypted anyway (one rule for the whole database) |
| `workingSet` | `"<facilityId>:<page>"` | `facilityId`, `page`, `fetchedAt` | ≤ 200 `fieldDeviceSummary` rows |
| `rooms` | `facilityId` | `fetchedAt` | the facility's rooms (`id`, `name`, `floor`) |
| `captures` | `localId` (uuid) | `kind` (`ipm` \| `device`), `state` (§ 9.1), `updatedAt`, `dependsOn` (a `localId` or null) | the capture: `clientRef`, server ids once known, the device reference, the pinned version id, header, results, photo ids, `capturedOffline`, `clientCapturedAt`, `serverRevision`, `lastConfirmed` (the server-confirmed state the planner diffs against), the last server error |
| `ops` | `opId` (uuid) | `localId`, `seq`, `state` (`planned`, `in_flight`, `done`, `failed`), `attempts`, `nextAttemptAt` | the **frozen** request: method, path template + params, `Idempotency-Key`, body (JSON) or the photo reference, and the request's own hash (for the test that a retry sends identical bytes) |
| `photos` | `photoId` (uuid) | `localId`, `purpose`, `bytes`, `uploaded` | the re-encoded JPEG (or the original file) as an encrypted `ArrayBuffer` |

- **Encryption:** each record's payload is `AES-GCM(key, iv = 96 random bits, aad = "<store>/<record key>/<schemaVersion>")` — the AAD binds a ciphertext to its slot, so a record copied into another slot fails to decrypt. Clear fields are ids, timestamps, states and counts only — **no** name, QR, serial, room, value or note in clear (an index on a tenant value would be one).
- **What this protects** (ADR-127 § 4): a copy of the profile (backup, forensic image of a powered-off phone) — the key is non-extractable and the platform protects it at rest. **What it does not:** anyone using the unlocked phone, or same-origin script (FT-86, FT-88) — the residuals ADR-127 and `docs/SECURITY/15` accepted.
- **No key derivation from the password** and no PIN (ADR-127 alternatives).

### 7.2 What is downloaded (the working set — FT-90, G-22)

| Read | Contract | Notes |
|---|---|---|
| `POST /auth/verify` | + `scopeFingerprint`, `user { id, tenantId, clientFacilityId \| null, roleName, displayName }` (AM-26 — P21-09) | first call of every sync cycle |
| `GET /client-facilities/mine` (bound) or the unbound user's facility picker (`GET /client-facilities`, `client-facilities` read) | P19-04 | a bound user downloads **its** facility only |
| `GET /calibration-devices?clientFacilityId=<F>&view=field&page=&limit=200&sort=id` | **`fieldDeviceSummary`** (G-O7): `id, clientFacilityId, name, manufacturer, model, serialNumber, qrCode, deviceTypeId, status, condition, locationId, ipmIntervalMonths, ipmDue, lastIpm { performedAt, visitNumber } \| null, calibrationDue, photosComplete, openIpmDraftId (the caller's) \| null, updatedAt` — **no** registrant, vendor, notes, documents, photos | paged, `meta.total` first so the screen states the size **before** downloading; the cap (`field.workingSetMaxDevices`, tenant setting, default 2,000, maximum 5,000) refuses a facility above it with "This facility has N devices; choose rooms…" — a room filter (`locationId`) is the narrowing |
| `GET /warehouses?kind=room&clientFacilityId=<F>` | rooms | |
| `GET /ipm/templates/published` with `If-None-Match: <etag>` | P19-01 § 8.3; **304** keeps the local copy | F-79 |
| `GET /ipm/sessions?status=draft&mine=true` | the caller's open drafts (P19-02 § 10.2) | reconciles drafts started on another device |
| tenant settings needed offline (QR prefix/digits, time zone, countersign flag) | the existing settings read (reviewed `skipFacilityScope` for bound users, P18-03 § 10.2) | |

Every read is an ordinary hooked, marked read: a bound user's `clientFacilityId=F2` returns nothing (G-22 covers the `view=field` read). Device **photos and documents are never downloaded**.

---

## 8. Capture Inputs

### 8.1 Photos (ADR-127 § 5)

1. `<input type="file" accept="image/*" capture="environment">` — no permission prompt; one or several files.
2. Refuse > 25 MB before decoding (the server's limit is the authority — `08` § 3).
3. `createImageBitmap(file, { imageOrientation: "from-image" })` → scale so the long edge ≤ 2048 px → `OffscreenCanvas` (or a detached `<canvas>`) → `convertToBlob({ type: "image/jpeg", quality: 0.8 })`. Re-encoding through a canvas writes **no EXIF** (no GPS, serial, timestamp); a unit test asserts the output has no `APP1 Exif` segment (§ 15).
4. Decode failure (HEIC on a browser without HEIC) → queue the **original**, flagged `reencoded: false`; the server converts, strips and scans (P21-02; never trusts the client).
5. Before storing: `navigator.storage.estimate()`; with < 50 MB or < 10 % free the photo is refused with "Phone storage is almost full — sync, or free space" (ADR-127 implication: never fail mid-write).
6. Encrypted into `photos`; a preview through `URL.createObjectURL` of the decrypted blob (revoked on unmount).
7. Upload order: device photos after the device exists on the server (`POST /calibration-devices/:id/photos`, `purpose`); IPM photos after the draft exists and **before** the submit (`POST /attachments`, `resourceType: "inspectionsession"`, `purpose: "ipm_evidence"`) — both with an `Idempotency-Key` (G-O8). A photo of a submitted session cannot be added (P19-02 § 10.2): the planner never orders a photo after a submit.

### 8.2 QR scanning (ADR-127 § 6)

- `getUserMedia({ video: { facingMode: "environment" } })` (needs `camera=(self)` — § 5), a `<video playsinline muted>` with `srcObject`; frames sampled at ≤ 10 fps into a canvas.
- Decoder: `BarcodeDetector({ formats: ["qr_code"] })` where `BarcodeDetector.getSupportedFormats()` includes it (Android Chrome); else a **pure-JavaScript** decoder loaded with `import()` (the `jsQR` class; the package is chosen in P22-10 under the owner's package rule with its size measured — pure JS, no WebAssembly, no `eval`, a permissive licence, maintained).
- The decoded text → `normaliseQr(text, tenantSettings)` (contracts, P19-03 § 4.2) — a URL on the old upstream host is handled by P27's resolver rules (UD-16) when built; until then the bare number inside is extracted only if it matches the tenant's pattern.
- The stream stops on success, on leaving the screen and on `visibilitychange`; a torch toggle where `MediaStreamTrack.getCapabilities().torch` exists.
- **Typed entry** is always on the screen (accessibility, a broken camera, a damaged sticker).
- Online lookup `GET /calibration-devices/by-qr/:qrCode` (P19-03, 404 identical across scopes); offline lookup in the decrypted working set.

---

## 9. The Outbox and the Sync Engine (ADR-127 § 7, § 8; G-O11)

### 9.1 Capture states

`editing` → (`submit` tapped) `submitted_local` (read-only on the phone) → `syncing` → `synced` (the server accepted the submit; the capture stays until the server state is re-read, then is removed from `captures`, and its id moves to the "to sign" list) — or `attention` (a refused op; § 9.6) — or `discarded_local` (the user discarded; removed after the server discard, if the server had the draft).

A device registration capture: `editing` → `submitted_local` (saved) → … → `synced`; an IPM capture of a **new** device has `dependsOn` = the registration's `localId`.

### 9.2 Planning (one capture at a time, captures in parallel up to 2)

Given the capture and `lastConfirmed`:
1. **Server draft unknown** → `POST /ipm/sessions` `{ deviceId, templateVersionId, clientRef, capturedOffline, clientCapturedAt, performedAt }` (device registrations: `POST /calibration-devices` with `clientRef`). A `dependsOn` capture not yet `synced` blocks planning.
2. **Header differs** → `PATCH /ipm/sessions/:id` with `revision = serverRevision` and only the changed fields.
3. **Results differ** → `PUT /ipm/sessions/:id/results` with `revision` and the **whole** result set (the draft is a document — P19-02 G-S9 alternative).
4. **Photos not uploaded** → one op per photo.
5. **`submitted_local` and everything above confirmed** → `POST /ipm/sessions/:id/submit` with `revision`.

Each op is **frozen** when planned: a fresh UUID v4 `Idempotency-Key` and the exact body are written to `ops` **before** the first attempt; a retry resends the identical request (same key, same bytes → the server's request hash matches). A local edit made while an op is in flight is planned **after** it completes (a new op, a new key). While `editing` and online, planning runs debounced (2 s after the last change) — so online capture behaves as server autosave; offline, ops accumulate as `planned` and run at the next trigger.

### 9.3 Running

- **Triggers:** app start, `online`, `visibilitychange` → visible, "Sync now", the Background Sync `sync` event where available (Chromium: the worker posts a message to an open client to run the engine, and if none is open, does nothing — the engine lives in the page, not the worker, so the worker holds no data or key); **iOS has none**: sync runs only while the app is open (ADR-127 § 7).
- **Each cycle:** `POST /auth/verify` (scope fingerprint, § 10.3) → the catalogue `If-None-Match` → each capture's next op, in `seq` order per capture.
- **Transport:** the typed client (`api/typed.ts` through `api`), so refresh-once, the gate redirects and the error normalisation are the dashboard's; the `Idempotency-Key` header added per op; `X-Field-Client: 1` (informational, for the access log only — never trusted).
- **Retry:** network error, timeout, 5xx, 429 (`Retry-After` honoured), 409 `IDEMPOTENCY_IN_FLIGHT` → backoff 2 s × 2ⁿ up to 5 min with ±20 % jitter, unlimited attempts while the capture exists; the Home screen shows "waiting to retry (n)".
- **Success:** 2xx (a replayed key answers the stored status with a body **re-read in the current context** — ADR-126 Am. 1 § 8) → record the server id / revision / confirmed state, mark the op `done`, plan the next.
- **Stop for attention:** any other 4xx (§ 9.6) — that capture's queue stops; other captures continue.

### 9.4 `client_ref` (AM-16)

Every capture has a `clientRef` (UUID v4) generated locally at creation; the server keys it `(tenant, creator, ref)` and answers a replay of the caller's own create with that session (200). The phone learns the server id from the answer. A capture is never sent by another user (the database is per user), so a cross-user collision cannot happen from the phone.

### 9.5 Server requirements this spec adds (built by P21-03 unless stated)

| Requirement | Where |
|---|---|
| `POST /attachments` honours `Idempotency-Key` (request hash over the file's SHA-256 and the fields) (G-O8) | P21-03 (the P19-02 § 9.2 middleware) |
| `GET /calibration-devices?view=field` → `fieldDeviceSummary[]` (G-O7) | P21-02 |
| `POST /auth/verify` returns `scopeFingerprint` (SHA-256 of `tenantId`, `clientFacilityId | "unbound"`, `roleId`, the facility's status) and `user.clientFacilityId` (AM-26, G-O6) | P21-09 |
| Scope-loss refusals carry top-level `code` ∈ `SCOPE_LOSS_CODES` (G-O5): tenant suspended/deleted in `tenantRefusal`; account inactive; facility inactive/ended, binding pending (AM-1) | P21-03 (tenant, account), P21-09 (facility) |
| `POST /field/wipes` (G-O9) | P21-03 |
| Every capture route's 409 carries its code (`IPM_CONFLICT_CODES`, `IDEMPOTENCY_CONFLICT_CODES`, the device codes of P19-03) | P21-02, P21-03 (as specified there) |

### 9.6 Conflicts and refusals — what the technician sees (ADR-127 § 8)

Each refused op keeps the capture in `attention` with the server's message **and** a localised explanation keyed by top-level `code`; nothing is dropped without a confirmed action.

| Answer | Message (gist; `id`/`en` in `field.conflicts.*`) | Actions |
|---|---|---|
| 404 on create / a device read | "This device is no longer in your access (moved to another facility, or removed)." | discard capture (confirm) · keep for an administrator (export the capture as a preview PDF, § 12) |
| 409 `IPM_DEVICE_RETIRED` / `IPM_DEVICE_INACTIVE` | "The device was retired / is inactive since <date>." | discard · keep for an administrator |
| 409 `IPM_FACILITY_ENDED` / `DEVICE_FACILITY_ENDED` | "<facility> has ended; new records cannot be added." | discard · keep |
| 409 `IPM_DRAFT_EXISTS` (top-level `draftId`, the caller's own) | "You already have a draft for this device on the server (started <date>), probably from another phone." | **use the server draft** (adopt `draftId`, re-plan header + results from this phone's capture onto it) · discard this capture |
| 409 `IPM_REVISION_CONFLICT` | "This draft was changed elsewhere at <time>." | **keep this phone's version** (re-read revision, re-plan the whole state) · take the server's version (replace the local capture) |
| 409 `IPM_NOT_DRAFT` / `IPM_VOIDED` / `IPM_SUPERSEDED` / `IPM_ORIGINAL_NOT_EFFECTIVE` | the server's explanation (already submitted/voided/corrected) | open the server session online · discard the local capture |
| 409 `IPM_NO_CHECKLIST` | "No checklist is published for this device type." | keep · discard |
| 400 on submit (missing items) | the list by section and label (same text as offline validation — contracts) | edit (the capture returns to `editing`) |
| 400 on results (a value outside the hard range, a computed outcome overridden) | the item and the rule | edit |
| 409 `IDEMPOTENCY_KEY_REUSED` | a client defect — logged to the console in development and reported in the attention screen as "internal sync error" | re-plan with a new key (automatic once), then attention |
| 409 `IDEMPOTENCY_SCOPE_CHANGED` | "This request was made under a different access; review it." | re-plan with a new key after the user confirms (the user's access changed) · discard |
| 403 permission (no code) | "You no longer have permission to <act>." | keep for an administrator · discard |
| 403 with a `SCOPE_LOSS_CODES` code | § 10 (purge) — the capture stays encrypted in the outbox | — |
| 413 / 415 on a photo | "This photo could not be accepted (<reason>)." | remove the photo · keep |

A **retired catalogue version** is accepted (`capturedOffline: true`); a capture started online on a version retired before its create reached the server gets `IPM_VERSION_RETIRED` only if `capturedOffline` is false — the phone sets `capturedOffline: true` whenever the capture **started** without confirmed server contact in the preceding 60 s (the claim ADR-127 § 7 stores, never trusted for ordering).

---

## 10. Purge Rules (ADR-127 § 4, § 9; AM-1, AM-24, AM-26; FT-85, FT-87, FT-95, FT-96)

"Purge" = delete the `workingSet`, `rooms`, `catalogue` stores and the decrypted memory copy, and set the registry's `workingSetPresent = false`. **The outbox (`captures`, `ops`, `photos`) is never purged by these rules** — only by a confirmed discard, a successful sync, or the administrator wipe (§ 11.3).

| Trigger | Rule |
|---|---|
| **72 h** after the last successful sync, by the device clock | checked at app start, every 10 min while open, and before any working-set read |
| **72 h by server time** (AM-24) | every online response's `Date` header is compared with `meta.lastSyncServerAt`; a gap > 72 h purges before the data is used again — a rolled-back device clock cannot keep the set once the phone is online (FT-87) |
| **Session ended** (G-O5) | `client.ts#endSession` (the refresh failed) → purge; then the login page; the outbox stays for the same user's next sign-in |
| **Scope-loss code** (AM-1, FT-95) | any response with top-level `code ∈ SCOPE_LOSS_CODES` → purge; the field app shows "Your access changed (<reason>)"; captures stay, marked `attention` |
| **Scope fingerprint changed** (AM-26, FT-96) | `POST /auth/verify`'s `scopeFingerprint` ≠ `meta.scopeFingerprint` → purge and re-download (a bound user moved F1 → F2 sees F2's set only) |
| **Logout** | non-empty outbox → **refused**: "N items are not synced: Sync now / Discard N items (type DISCARD to confirm)"; empty → purge **and delete the user's database** and its registry row |
| **Another user signs in on this profile** (AM-23) | § 11.2 |
| **Offline mode turned off** | as logout (refused with a non-empty outbox) |
| **Revocation of a lost phone** | the administrator revokes the user's sessions (`/sessions`, logout-all); the phone purges at its next online contact (session ended) or at 72 h if it never comes online (FT-85 residual, accepted) |

A **binding change** (bind, unbind, move) already revokes all of the user's sessions (AM-1, ADR-124 Am. 2) → "session ended" above; the scope codes and the fingerprint are defence in depth.

---

## 11. One Field User per Browser Profile (AM-23, OQ-10; FT-86)

### 11.1 Enabling field mode

Refused while the registry holds **another** user's row with `outboxCount > 0` or `workingSetPresent`: "This phone holds offline data of another user — they must sign in and sync, or an administrator can wipe it." The registry stores no names, so the message names nobody. A row of another user with an empty outbox and no working set is deleted silently first.

### 11.2 Sign-in of a different user

The authenticated shells (`app/field/layout.tsx` and `app/dashboard/layout.tsx`) run **`fieldProfileGuard`** — a `import()`-loaded module executed only when `localStorage["cf.field.present"] === "1"` (so the dashboard pays nothing on a profile that never enabled field mode). It reads the current user (`/auth/verify`, which the dashboard already calls) and, for every other registry row: **purges** its working set and catalogue (opening that database deletes stores, it never decrypts anything), keeps its outbox untouched and encrypted, and leaves a registry note so the field app shows "Another user's unsynced captures remain on this phone (N)". The current user cannot read them.

### 11.3 The administrator wipe (G-O9)

On the Settings screen, an **unbound tenant administrator** signed in on the phone sees "Wipe another user's offline data" per registry row; a typed confirmation ("WIPE"); the app deletes that database and the registry row, then sends `POST /api/v1/field/wipes { wipedUserId, captures, photos }` (`auth`, `rbac([TENANT_ADMIN])`, `dynamicAccess("ipm", "write")`, `validate`; **unmarked** — bound users never wipe; the wiped user must be of the caller's tenant, loaded in context, else 404) → audit `DELETE`, resource `User` (the wiped user), `changes { operation: "FIELD_DATA_WIPED", captures, photos }` — counts only. If the phone is offline, the wipe is refused ("Needs a connection, so the wipe is recorded").

> **Note (2026-10-08, deviation protocol — ADR-135, `docs/MOBILE/04` § 10.3):** the order above (delete, then report) is **superseded** for both the PWA and the native app: the app first sends `POST /field/wipes` and waits for the audit row, **then** deletes, and retries a failed deletion at the next launch — so no evidence is destroyed without its record. The route and the audit row are unchanged.

---

## 12. Reports, Signatures and the Field App (P19-06)

- **Preview offline:** `buildIpmReportPreview` (contracts) over the local capture, the local catalogue version and the working-set device → P19-06's renderer (warmed, § 4.3) → watermark "DRAFT — NOT A RECORD". "Keep for an administrator" in § 9.6 exports exactly this preview PDF so the work is not lost when the server refuses it.
- **Issued report:** exists only after the server accepted the submit; the "to sign" list (Home) holds synced submits whose performer signature is missing (read `GET /ipm/sessions?mine=true&status=submitted&unsigned=true` online — a filter P21-04 adds with the signatures); signing is **online only**, through P19-06's dialog — no credential is ever stored, queued or cached.
- The signature route is a credential endpoint for `client.ts` (P19-06 G-R12): a wrong password never triggers § 10's "session ended" purge.

---

## 13. Updates

- The browser checks `/sw.js` on navigations to `/field` (`updateViaCache: "none"`, `no-cache`). A new version **installs** (its own caches) and **waits**.
- The field app listens for `registration.waiting` and shows "An update is ready" with **Update now**. The update is **deferred** while a sync cycle runs (there is never unsaved input to protect: every change is written through to IndexedDB). On tap: `postMessage({ type: "SKIP_WAITING" })` → `controllerchange` → one reload of `/field` → the new shell → warm-up.
- **Offline**, no update is possible and none is needed: the stored shell and its chunks are consistent (same version).
- **Data compatibility:** IndexedDB `schemaVersion` upgrades in `onupgradeneeded` are additive and migrate records forward; an older app never opens a newer database (the version check refuses and asks to update). `ops` frozen by an older version are replayed unchanged (their bodies were valid contracts then; a contract that has since tightened answers 400 → attention, never a silent loss). The contracts package keeps request schemas **backward compatible for 30 days** of outbox age for the capture routes (`openapi:breaking` already guards breaking changes).
- **Kill switch:** a response header `X-Field-Worker: disable` on `/field` (set by configuration `FIELD_WORKER_DISABLED=true`) makes the app unregister the worker and run online-only — the operator's recovery if a worker version misbehaves.

---

## 14. iOS and Platform Limits (ADR-127 § 10)

| Limit | Consequence | Mitigation |
|---|---|---|
| No Background Sync | the outbox syncs only while the app is open | the Home screen and the field guide say so; a banner when the outbox is older than 4 h: "Open the app online to sync" |
| Storage of a non-installed site evicted after 7 days without interaction; quota prompts | the outbox can be lost if not installed | offline mode on iOS **requires** the installed app (`display-mode: standalone`); in a Safari tab the Settings screen refuses with the install instructions |
| `navigator.storage.persist()` may be denied | eviction under storage pressure | the grant is shown; a denied grant plus a non-empty outbox shows a warning |
| `BarcodeDetector` absent | the JS decoder (bigger, slower) | lazy-loaded, ≤ 10 fps |
| Camera in standalone mode | supported from iOS 13.4; permission asked per app | the field guide shows the prompt |
| HEIC photos | `createImageBitmap` decodes HEIC on iOS Safari; other browsers may not | the server conversion path (§ 8.1) |
| `OffscreenCanvas` | iOS 17+ | a detached `<canvas>` fallback |
| WebCrypto non-extractable keys in IndexedDB | supported on the floor (Chromium 120+, Safari 17.4+) | feature test at enable time |

**Feature test at enable:** Service Worker, IndexedDB, `crypto.subtle` AES-GCM with a non-extractable key stored and re-read, `createImageBitmap`, `navigator.storage.estimate` — any missing → online-only capture with the reason named.

---

## 15. Performance and Bundle Budgets

| Route / chunk | Budget | How it holds |
|---|---|---|
| `/` and every existing public route | **unchanged** (`/` 180 brotli / 150 gzip) | no field code in the root layout; the manifest link and registration live in `app/field/layout.tsx`; `bundle-budget.mjs` run is the proof |
| dashboard routes | ≤ +1 KB first load | `fieldProfileGuard` is an `import()` behind a `localStorage` check; a `bundle-budget.json` entry for `/dashboard` is added at its measured value + 2 KB so the guard cannot grow silently |
| **`/field`** first load | **≤ 170 KB brotli** (ceiling set at the first build + 5 KB, never above 170) | the shell, the store, the stepper; scanner, PDF preview, photo pipeline and the IndexedDB crypto layer are lazy |
| scanner chunk (JS decoder) | ≤ 60 KB brotli | loaded only when `BarcodeDetector` lacks QR |
| report preview | the P19-06 renderer + jsPDF + font, lazy | warmed for offline |
| working set in memory | 2,000 devices decrypted in < 1 s on a mid-range Android phone (measured in P22-10, recorded) | pages of 200, decrypted in parallel |
| sync of one capture (online) | ≤ 5 requests + photos | header and results only when changed |

`bundle-budget.mjs` gains the authenticated routes `/field`, `/dashboard` and `/dashboard/ipm/sessions/[sessionId]/report` (P19-06): the script reads any route's client-reference manifest; the routes are added to `bundle-budget.json` with notes.

---

## 16. Test Strategy

### 16.1 Unit and component (jest; frontend gate 90/81/86/91 holds)

- `fieldStore.crypto.test.ts` — AES-GCM round trip with the AAD; a record moved to another slot fails; the key is `extractable: false` and `exportKey` rejects (WebCrypto from `node:crypto.webcrypto` in jest).
- `fieldStore.schema.test.ts` (`fake-indexeddb`, a new **dev** dependency under the package rule) — stores and versions; an upgrade keeps `captures`/`ops`/`photos`; no clear field holds a tenant value (scan of every stored record's clear keys against a deny-list: name, qr, serial, room, value, note).
- **G-27:** `fieldStore.purge.test.ts` (72 h device clock; 72 h by server `Date` with a rolled-back device clock — AM-24, PT-24; session ended; each `SCOPE_LOSS_CODES` code; logout refused with a non-empty outbox, allowed after discard; **the outbox survives every purge**); `fieldStore.sharedProfile.test.ts` (AM-23: enabling refused with another user's outbox; a different user's sign-in purges others' working sets and never opens their outbox; the admin wipe deletes and reports counts); `fieldStore.scopeChange.test.ts` (AM-26: fingerprint change purges and re-downloads; F1 → F2 sees F2 only); `serviceWorker.cachePolicy.test.ts` (the worker's fetch handler with mocked `caches`: `/api/**` never stored, never intercepted; shell network-first with timeout; static cache-first; activate deletes other versions; install fails atomically).
- `syncEngine.plan.test.ts` — the planner's ops for each capture difference; ops frozen (a retry sends the identical body and key — compared byte for byte); a local edit during an in-flight op becomes a later op; `dependsOn` blocks; online debounce.
- `syncEngine.run.test.ts` — against a **contract-typed fake API** (responses built from `@callibrator/contracts` schemas — not invented shapes; CLAUDE.md "a mock proves the client, not the contract", so the live suites below are the proof): retry/backoff with `Retry-After`; replay 200 accepted; every row of § 9.6 leads to its state and actions; 401 on the signature path does not end the session.
- `photoPipeline.test.ts` — the output JPEG has no `APP1 Exif` segment, long edge ≤ 2048, quality parameter passed; HEIC fallback queues the original; quota refusal (canvas through a small stub in jsdom; the real encode is proved in the browser suite).
- `qrScan.test.ts` — decoder selection (`BarcodeDetector` vs the lazy decoder), stream stopped on success and on `visibilitychange`, typed entry always present, normalisation shared with the server's fixtures.
- `fieldRouteNamespace.guard.test.ts`, `fieldShellNoTenantData.guard.test.ts` (§ 4), `securityHeaders.test.ts` and `proxy.test.ts` (§ 5), `manifest.test.ts` (fields, colours equal the tokens, scope/start_url/id).
- Component tests per screen (one `<main>`/`<h1>`, focus moved on view change, live-region announcements, buttons named after their object, status tones with text).

### 16.2 Backend (built by P21-03/P21-09 — listed here because the PWA depends on them)

`idempotencyKeys.p2103.test.ts`, `idempotencyKeys.scopeChange.test.ts`, `clientRef.twoFacility.test.ts`, `sync.attribution.p2103.test.ts` (G-26, already in P19-02); **new:** `attachments.idempotency.p2103.test.ts` (a replayed IPM photo upload stores one file; a different file under the same key → 409), `calibrationDevices.fieldView.twoFacility.test.ts` (the `view=field` projection's key set; F1 only — G-22), `authVerify.scopeFingerprint.test.ts` (AM-26: changes with binding, role, facility status), `scopeLossCodes.test.ts` (each refusal carries its code), `fieldWipes.test.ts` (unbound TA only; bound → 403 route; another tenant's user → 404; the audit row's counts), `sync.scopeChange.p2210.test.ts` (FT-93: an outbox item for F1's device replayed after a move → 404 in the new context).

### 16.3 Browser suites (puppeteer-core, `automate/`, on the compose stack; P22-10)

`field.offline.browser.mts`:
1. sign in as a provider technician; enable offline mode for a synthetic facility; the worker is active with scope `/field`; caches hold the shell and chunks; **no `/api` entry in any cache** (enumerated through CDP `CacheStorage`);
2. CDP `Network.emulateNetworkConditions({ offline: true })`; reload `/field` → served by the worker, 0 CSP violations; scan a QR from a synthetic image (fed to the decoder through a fake camera stream, `--use-file-for-fake-video-capture`); capture an IPM with two photos; register a new device and capture an IPM on it (dependency); submit both locally;
3. restore the network; sync → both sessions submitted on the server (verified through the API: visit numbers, Preventative orders, the photos once each, `captured_offline` true); a replay of the same ops answers the stored statuses;
4. logout refused while one capture is pending; allowed after sync;
5. a second user signs in on the same profile → the first user's working set purged, the outbox untouched; enabling field mode refused until the admin wipe;
6. move the user to another facility (API) → the next sync purges and re-downloads the new facility only;
7. axe on every field screen in **light and dark** (`a11y.browser.js` gains `/field` states), `responsive.browser.js` at 360×640, 390×844, 768×1024 (no horizontal scroll), the CSP smoke on `/field` online and offline.

### 16.4 Live E2E (P21-10, P22-10)

A spec replaying a create + results + photo + submit with the **same keys** twice against a running stack (the second answers the stored statuses, nothing duplicated), plus the conflict codes of § 9.6 that the API can produce on demand (retired device, draft exists, revision conflict).

### 16.5 Real devices (P22-10 DoD; G-28; PT-24; P26-02 field UAT)

A written script run on **one mid-range Android phone (Chrome, current)** and **one iPhone (iOS 17.4 or later, installed to the home screen)**, recorded as a named run in `MEMORY/records/` (device model, OS and browser versions, the build's version stamp, each step's result — no screenshots with real data):
1. install; enable offline mode; persistent storage grant shown;
2. airplane mode; kill the app; reopen from the home screen → the field app opens offline;
3. capture 2 IPMs with 3 photos each (one HEIC on iPhone), register 1 device; kill and reopen mid-capture — nothing lost;
4. network restored; sync; verify on the dashboard (desktop) the sessions, photos (EXIF absent in the stored derivative), visit numbers;
5. sign the reports (online), the IPSRS countersigns on another device;
6. logout refusal with a pending item; discard with confirmation;
7. **73 h offline** (or the clock rolled forward 73 h) → the working set purged at next open; separately, roll the clock **back** 5 days, go online → purged at the first response (PT-24);
8. revoke the user's sessions from the admin's desktop while the phone is offline → the phone purges at its first online contact;
9. second user on the same phone (AM-23) → steps of § 16.3 (5);
10. update: deploy a new build; the phone shows "An update is ready"; update; the outbox survives.

A failure on a real device blocks P22-10's DONE; the record names what failed.

---

## 17. Threat-Model Rows and AM-n Adopted Here

| Row / AM | Here |
|---|---|
| FT-84 | adopted: the fetch policy never stores or intercepts `/api/**` (§ 4.2); `serviceWorker.cachePolicy.test.ts` |
| FT-85 | adopted as specified: ≤ the stated working set, 72 h, purge on revocation; residual accepted (ADR-127) |
| FT-86 / **AM-23** / OQ-10 | **adopted**: enabling refused with another user's data; another user's sign-in purges others' working sets; the administrator wipe, audited (§ 11) |
| FT-87 / **AM-24** | **adopted**: server-time purge at every online response (§ 10) |
| FT-88 | adopted: `worker-src`/`manifest-src`, no WASM, no `eval`, data rendered by React from IndexedDB |
| FT-89 | adopted as ADR-127's exception, narrowed: one shell, scope `/field`, no tenant data in it (guard) |
| FT-90 / G-22 | adopted: the working set is the hooked, marked `view=field` list read (§ 7.2) |
| FT-91 / FT-92 / **AM-25** | consumed from P19-02 (server attribution; idempotency without bodies) — the client re-plans on `IDEMPOTENCY_SCOPE_CHANGED` only with the user's confirmation |
| FT-93 | adopted: a moved device's replay → 404 → attention (§ 9.6) |
| FT-94 | adopted: per-capture ordered queue, 2 captures in parallel, quota refusal, backoff |
| FT-95 / **AM-1** (client part) | **adopted**: purge on the refresh failing and on `SCOPE_LOSS_CODES` — never on a raw 401/403 (G-O5) |
| FT-96 / **AM-26** | **adopted**: the fingerprint from `/auth/verify` at every sync cycle (G-O6) |
| **AM-16** | consumed: `clientRef` per capture, resolved by the server per creator |
| FT-83 | accepted residual (ADR-127): offline attribution on a shared, unlocked phone — mitigated by AM-23 and `captured_offline` |

## 18. Traps Checked

| Trap | Here |
|---|---|
| a list read returning `data.rows` | the working set reads `data` + top-level `meta` (CLAUDE.md envelope) — the `view=field` projection keeps the envelope |
| a 409 shown as a generic error | every code has its explanation and actions (§ 9.6) |
| a mock inventing a contract | the fake API is built from the contracts' schemas, and the live suites prove the real one |
| an inline `<script>` / un-nonced `<style>` | none: the worker is a same-origin file; the manifest a static file; the field layout uses the metadata API |
| disabling a React Compiler rule to pass the build | not allowed (the setState-in-effect gotcha: hydration from IndexedDB goes through a store subscription, not an effect that sets state) |
| `tenantId` from a body | never sent; the server stamps tenant, facility, creator |
| a new frontend dependency | `fake-indexeddb` (dev) and the QR decoder (runtime, lazy) — each chosen under the owner's package rule with its licence and size recorded by P22-10 |

## 19. Decisions Made Here (recorded as ADR-127 Amendment 1)

1. Worker scope `/field`, not `/` (G-O1).
2. The field app is one document with client-state screens (G-O2).
3. `public/sw.js` generated before the build from TypeScript, versioned, outside the proxy, with its own CSP (G-O3).
4. Install pre-caches the shell's referenced assets; the app warms lazy modules; a missing module degrades one feature (G-O4).
5. Purge on the refresh failing and on `SCOPE_LOSS_CODES`, never on a raw 401/403; the server sends the codes (G-O5).
6. The scope fingerprint from `/auth/verify` at every sync cycle (G-O6).
7. `view=field` narrow projection for the working set (G-O7).
8. `POST /attachments` honours `Idempotency-Key` (G-O8).
9. The administrator wipe of another user's field data, audited through `POST /field/wipes` (G-O9).
10. `camera=(self)` only on `/field` (G-O10).
11. The local capture is the source of truth; ops are planned from differences and frozen before sending (G-O11).
12. The working set in encrypted pages decrypted into memory; no plaintext index of tenant values (G-O12).

**For the owner / SME (none blocks the build):** the default working-set cap (2,000 devices per facility, maximum 5,000 per tenant setting) against the largest real facility, read as an aggregate in the dry run (P24-05); whether a provider technician may take **more than three** facilities offline at once (recommended no — the exposure of a lost phone grows with it).
