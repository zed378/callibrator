# 01 — Architecture of the Mobile App (TARGET)

> **TARGET — nothing here is built.** Decision record: ADR-135. Shared packages: [`docs/SHARED/`](../SHARED/).
> Backend for mobile: [`20-BACKEND-FOR-MOBILE-NODE.md`](./20-BACKEND-FOR-MOBILE-NODE.md) (Node) and [`21-BACKEND-FOR-MOBILE-GO.md`](./21-BACKEND-FOR-MOBILE-GO.md) (Go) (written by the shared-packages documentation agent).

---

## 1. The Shape

```
callibrator/                         (the existing monorepo, npm workspaces — ADR-044)
├── backend/                         TypeScript backend (Node variant's server)
├── backend-go/                      Go backend (Phase 999; Go variant's server) — not built
├── frontend/                        Next.js 16 web app, incl. the /field PWA (ADR-127)
├── apps/
│   └── mobile/                      ← this app (Expo, React Native, TypeScript strict)
└── packages/
    ├── contracts/                   exists today (@callibrator/contracts, ADR-097)
    ├── tokens/  api-client/  i18n/  domain/  sync-engine/  hooks/  icons/   ← target, docs/SHARED
```

The app is one workspace, `apps/mobile`, using **Expo SDK (current stable at build time)** with
**development builds** (`expo-dev-client`) — never Expo Go, because the app needs native modules
(SQLCipher, secure storage, passkeys, a managed-configuration module) that Expo Go cannot load. Native
projects (`android/`, `ios/`) are **generated** by `npx expo prebuild` from `app.config.ts` and the
config plugins (Continuous Native Generation) and are **not committed**; every native change is a
config plugin, so the native project is reproducible from the repository alone.

**Language:** TypeScript, `strict` plus the ADR-038 flags, checked by the repository's TypeScript 7
(`npm run typecheck` in the workspace, ADR-076). No `any`, reasons on every `@ts-expect-error`
(`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`). **Engine:** Hermes (Expo default). **Architecture:**
React Native's New Architecture (default in current Expo SDKs); a library that requires the legacy
architecture is not admitted.

## 2. Navigation — `expo-router` (decided)

**Decision:** `expo-router` (file-based routing on top of React Navigation).

| | `expo-router` | React Navigation used directly |
|---|---|---|
| Deep links / app links | **every screen has a URL by construction**; universal/app links map onto files with no linking table to keep in sync | a hand-written `linking` config that drifts from the navigator tree |
| Typed routes | generated (`experiments.typedRoutes`) — a link to a screen that does not exist fails the typecheck | manual param lists |
| Mental model | the same as the web's App Router (`frontend/src/app/**`) — one routing vocabulary across the monorepo | a second vocabulary |
| Custom layouts (tabs ↔ sidebar, master-detail) | `_layout.tsx` + `Slot`, `Tabs`, `Drawer`, `Stack`, custom navigators via `withLayoutContext` | the same primitives, wired by hand |
| Cost | a thinner abstraction that occasionally lags React Navigation features | — |

React Navigation remains underneath; when `expo-router` lacks something, its React Navigation
primitive is used inside a layout, never as a second, parallel navigator tree.

### 2.1 The route tree (target)

```
apps/mobile/src/app/
├── _layout.tsx                 root: providers (theme, i18n, query/session), splash, OTA check, lock gate
├── (public)/                   no session needed
│   ├── sign-in.tsx             password → MFA step; "Sign in with your hospital" (SSO); passkey
│   ├── mfa.tsx
│   ├── m/sso-return.tsx        app-link return of the SSO flow, path /m/sso-return (06 § 3)
│   ├── verify/                 auditor's QR verification (02 § 2.4)
│   │   ├── scan.tsx
│   │   ├── [certificateNumber].tsx   mirrors the web's /verify/[certificateNumber] (05 § 5)
│   │   └── ipm/[reportNumber].tsx    mirrors <IPM_VERIFY_BASE_URL>/<n>?t= ; +native-intent maps the API form
│   ├── server.tsx              choose / confirm the server (self-hosted deployments, 08 § 6)
│   └── setup/                  first-run tenant setup (11): index.tsx (org code, scan, email
│                               discovery), confirm.tsx; the app link /m/setup?org=… lands here
├── (locked)/unlock.tsx         biometric re-unlock (06 § 5)
└── (app)/                      requires a session; the navigation chrome lives here
    ├── _layout.tsx             phone: bottom tabs · tablet: sidebar (03 § 3)
    ├── home/index.tsx          role-adaptive home (02)
    ├── devices/
    │   ├── _layout.tsx         master-detail on expanded width (03 § 4)
    │   ├── index.tsx           list (search, filters, due state)
    │   ├── [calibrationDeviceId]/index.tsx, photos.tsx, ipm.tsx, calibration.tsx
    │   └── register.tsx
    ├── scan.tsx                QR → device (online lookup or offline working set)
    ├── ipm/
    │   ├── index.tsx           sessions list; due list (tab)
    │   ├── capture/[localId].tsx   the capture stepper (offline-capable)
    │   ├── [sessionId]/index.tsx, report.tsx, sign.tsx
    ├── certificates/ …         read
    ├── work-orders/ …          read
    ├── dashboard/ …            managers (02 § 2.5)
    ├── outbox/ index.tsx, [localId].tsx   sync state and "needs attention"
    ├── notifications.tsx
    └── settings/ index.tsx, offline.tsx, security.tsx (passkeys, MFA, my sessions), about.tsx
```

A screen file the user's effective permission does not reach is **not navigable**: the `(app)` layout
resolves the menu once (`02` § 3) and a guard redirects a direct link (deep link, notification) to a
"not available" screen that names nothing — the same absent-not-disabled rule as the web
(`docs/UI-UX/00` principle 2).

## 3. State

Three kinds of state, three homes. Nothing else.

| Kind | Home | Rule |
|---|---|---|
| **Server state** (lists, a device, a session) | the **shared headless hooks** (`packages/hooks`, `docs/SHARED/07-HEADLESS-HOOKS.md` — TanStack Query with tenant-keyed caches) over the shared `api-client` | the app does not re-implement fetching, paging or envelope handling; a screen calls a hook and renders its `loading / empty / failed / data` states. The app adds no second data-fetching primitive; it supplies the platform hooks the package asks for (focus = `AppState`, online = NetInfo) |
| **Session and app state that outlives a screen** | **Zustand** stores, one per concern (as `docs/FRONTEND/00` § State) | `sessionStore` (user, `facilityBound`, effective permissions, lock state), `menuStore` (the resolved menu), `fieldStore` (offline mode, outbox counts, sync state — `04`), `toastStore`. A store that exists for one screen is a defect |
| **Durable local data** | SQLCipher (tenant data, `04`), SecureStore (secrets, `06`), MMKV (non-sensitive preferences) | **no tenant data in MMKV, AsyncStorage or the file system in clear** (`07` § 4); a lint rule refuses `AsyncStorage` imports |

The server-state cache is **memory only**. Persisting the query cache to disk is refused: it would put
tenant data at rest outside the one encrypted store and its purge rules (the PWA's FT-84 lesson,
ADR-127 § 3). The only tenant data at rest is the field working set and the outbox (`04`).

**React Compiler** is enabled (as on the web, ADR-090 note in `docs/FRONTEND/00`); its lint rules are
not disabled to pass a build — the setState-in-effect trap is avoided by subscribing to stores, not by
setting state in effects.

## 4. Data Layer

```
screen → shared headless hook → shared api-client (generated from OpenAPI) → HTTPS → API
                      ↘ fieldStore → sync-engine (shared) → api-client          (offline capture only)
```

- **`api-client`** (`packages/api-client`, `docs/SHARED/`): typed from the backend's OpenAPI document
  (ADR-103's code-first contract); unwraps the envelope; normalises errors (`§ 5`); carries the
  `Idempotency-Key` for queued writes. In the app it is configured with the package's **mobile auth
  adapter** (`docs/SHARED/03-API-CLIENT.md` § 5; `06` § 6 here): the access token in memory, attached
  as `Authorization: Bearer`, single-flight refresh on 401 through the native refresh route of
  [`20`](./20-BACKEND-FOR-MOBILE-NODE.md). The web's cookie-through-Next adapter (ADR-059) is not used
  by the app; the token never reaches JavaScript on the web and never reaches disk on the phone outside
  the Keychain/Keystore.
- **Base URL:** the **native ingress** of the build's environment, `https://<host>/native/api/v1/…`
  (routed by the edge straight to the backend, never through the Next proxy, which strips tokens by
  design — `docs/SHARED/03` § 5; the prefix is decided in [`20`](./20-BACKEND-FOR-MOBILE-NODE.md)),
  or the same path on a host chosen on the server screen / by MDM managed configuration for a
  self-hosted deployment (`08` § 6).
- **Client identification:** every request carries `X-App-Version`, `X-App-Build`, `X-App-Platform`
  (`ios` | `android`) and `X-Installation-Id` (`docs/SHARED/03` § 5). The server uses them for the
  minimum-version policy (`08` § 5; server side in [`20`](./20-BACKEND-FOR-MOBILE-NODE.md)) and for
  logs — never for authorisation. The EAS Update id and runtime version go into log and crash context
  only.
- **`sync-engine`** (`packages/sync-engine`): the planner/runner of P19-08 § 9 (frozen ops, retry,
  conflict codes → explanations), written once and used by both the PWA and the app; the app supplies
  the storage adapter (SQLCipher) and the scheduler adapter (foreground + background tasks, `04` § 6).
- **`domain`** (`packages/domain`): pure functions both clients and the server agree on —
  `normaliseQrCode`, `computeIpmDue`, `missingRequiredItems`, `buildIpmReportPreview`, the
  `ipm-report-v1` canonical payload (P19-02, P19-03, P19-06 put them in `@callibrator/contracts`;
  `docs/SHARED/` says where each lives after the split). The app never re-implements one.
- **Realtime:** the app does **not** hold a Socket.IO connection in the first release. Live updates
  reach the phone as push notifications (`05` § 3) that trigger a refetch. A socket on a phone costs
  battery and reconnect complexity for little gain on screens that are refreshed on focus. (Revisit
  only with a measured need; a bound socket must join only its facility room — ADR-124 § 9.)

## 5. Error Handling

The rule of the web holds: **every list has three states — loading, empty, failed** — and an empty
list shown for a failed request is a lie about a compliance figure (`docs/FRONTEND/00` § Errors).

| Answer | App behaviour |
|---|---|
| network error / timeout / offline | online screens: a failed state with "Retry" and the offline banner; capture screens: continue locally (`04`) |
| **401** | one refresh through the mobile refresh route (`REFRESH_RACE` → one more refresh attempt; `SESSION_EXPIRED_ABSOLUTE` (the 30-day limit) → "Please sign in again", outbox kept — `06` § 6); a failed refresh **ends the session** (sign-in screen; the field purge rule of `04` § 8 runs). A 401 from a **credential endpoint** (signature dialog, password confirm, MFA step) is about the credential, never a session end (P19-06 G-R12) |
| **403** without a code | "You do not have access to this" — the action is hidden next time (the menu is re-read) |
| **403** with a `SCOPE_LOSS_CODES` code (`ACCOUNT_INACTIVE`, `TENANT_SUSPENDED`, `TENANT_DELETED`, `FACILITY_INACTIVE`, `FACILITY_ENDED`, `FACILITY_BINDING_PENDING`) | purge the working set (`04` § 8), sign out, explain the reason |
| **404** | "Not found" — identical for missing, deleted and not-yours; the app never guesses which |
| **409** | the server's state explanation, verbatim, with the action it suggests; capture conflicts map `data.code` to the P19-08 § 9.6 table (`04` § 7) |
| **426** `APP_UPDATE_REQUIRED` | the blocking "Update required" screen (`08` § 5); the outbox is kept |
| **429** | wait `Retry-After`, then retry; never a tight loop |
| 5xx | a failed state with retry; capture ops back off (`04` § 6) |

**Crash and error reporting (owner, 2026-10-08 — Q-M5): no crash reporter** until the DPIA approves
one. The app keeps a small rotating **local log** (errors, unhandled rejections, a native-crash marker
found at the next launch) and **sends it to our own backend** at the next foreground with a
connection, batched and scrubbed, through **`POST /mobile/logs`** of the backend for mobile
([`20`](./20-BACKEND-FOR-MOBILE-NODE.md) § 11a, card P36-14: authenticated, rate-limited, size-capped,
retained like other application logs). The local log is deleted on sign-out. In every case: **no request or
response body, no token, no tenant value, no free text, no photo** in a report; user identity as the
opaque user id only; breadcrumbs carry route names, never route parameters with ids of devices or
people.

## 6. Feature Flags

| Layer | Source | Use |
|---|---|---|
| **Tenant config and branding** | the public tenant read by code (`11` § 3), stored in MMKV, refreshed with `If-None-Match` | which sign-in methods show, the in-app logo, the derived palette — presentation only, never authorisation (`11` § 8) |
| **Server flags** | the backend's feature-flag module, read through the mobile configuration read of [`20`](./20-BACKEND-FOR-MOBILE-NODE.md) at sign-in and on foreground (cached in memory, never on disk) | turn a feature off for a tenant or everyone without a release — e.g. `mobile.offline.enabled`, `mobile.backgroundSync.enabled`, `mobile.passkeys.enabled`, `mobile.ipm.countersign` |
| **Kill switches** | the same read; evaluated **before** the feature starts | the operator's recovery if a feature misbehaves in the field (the PWA's `FIELD_WORKER_DISABLED` equivalent: `mobile.offline.enabled = false` stops new offline enablement and background sync; existing outboxes still sync in the foreground — **a kill switch never discards captured work**) |
| **Build-time flags** | `app.config.ts` per environment (`§ 7`) | native capabilities that need a binary (a config plugin, an entitlement) — these change only with a store build (`08` § 3) |

A flag never widens access: a flag can hide or disable a feature; the server's gates decide whether
the action is allowed. A screen behind an off flag is absent, not disabled.

## 7. Configuration per Environment

| Environment | `APP_VARIANT` | App id (bundle / package) | API host | EAS Update channel | Distributed by |
|---|---|---|---|---|---|
| development | `development` | `<reverse-domain>.callibrator.dev` | a developer's or the dev stack's host | `development` | EAS internal distribution (dev builds) |
| preview / UAT | `preview` | `<reverse-domain>.callibrator.preview` | the staging host | `preview` | Play internal testing, TestFlight (`08`) |
| production | `production` | `<reverse-domain>.callibrator` | the production platform host(s) | `production` | `08` § 2 |

- `<reverse-domain>` is the owner's organisation domain, reversed — **an owner question** (ADR-135):
  the app id is permanent once published.
- `app.config.ts` reads `APP_VARIANT` and the EAS environment variables (EAS's
  development/preview/production environments). **No secret ever lives in the app configuration or
  the bundle** — everything shipped in a binary or an OTA update is public. Server-held secrets (FCM
  service account, APNs key, EAS Update signing private key) live in EAS secrets or the backend's own
  configuration, never in `apps/mobile`.
- Three variants install side by side on one phone (different app ids), so a tester can hold
  production and preview without mixing data. Each variant has its own Keychain/Keystore items and
  its own SQLCipher database.
- The **associated domains** (iOS) and **app-link hosts** (Android) are build-time per variant
  (`05` § 5) — a host added later needs a store build, not an OTA update.
