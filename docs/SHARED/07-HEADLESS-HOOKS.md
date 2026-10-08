# 07 — `@callibrator/hooks` — Headless React Hooks (TARGET)

> **Status: TARGET (ADR-134). Not built.** The web's hooks today are `frontend/src/hooks/*`
> (`usePermissions`, `useTenantBranding`, `useLiveNotifications`, …) over Zustand stores
> (`frontend/src/stores/*`) and per-screen data hooks calling `src/api/services/*` (the layering of
> `docs/FRONTEND/00` § API Access: page → hook → service → client). Built by P35-08.

---

## 1. Purpose and Limits

React hooks that both clients can call because they touch **no DOM and no React Native API**: they
compose `api-client`, `domain`, `i18n`, `sync-engine` and `tokens` into the state a screen needs —
loading, error, empty, data — and leave rendering to each platform.

- **Peers, never dependencies:** `react` and `@tanstack/react-query` are `peerDependencies`. The
  package never installs its own copy (the two-React risk of `01` § 11).
- **No `react-dom`, `react-native`, `next/*`, `expo-*`** (`01` § 2). No `window`, no `AppState`, no
  `navigator.onLine` — platform events arrive through the providers each app mounts (§ 5).
- **No UI.** A hook returns data and callbacks, never an element.

## 2. Server State: TanStack Query

**Decision (ADR-134 § A.8):** server-state hooks are built on **TanStack Query** (`@tanstack/react-query`).

| Need | Why TanStack Query |
|---|---|
| The same caching, deduplication, refetch-on-focus and retry semantics on web and native | it is headless and runs unchanged on both; its focus and online managers take platform events through two small adapters |
| The mobile app's foreground/background and connectivity behaviour | `focusManager` + `onlineManager` fed from `AppState` and NetInfo (`../MOBILE/01`) |
| Paged lists with the envelope's top-level `meta` | `useQuery` over `unwrapList` (`03` § 6.1) |
| Invalidation after a mutation | query-key factories (§ 3) |

**The web adopts it opportunistically**, screen by screen, when a screen is next changed for another
reason (`01` § 8.1 step 7). There is no sweep: the existing Zustand stores and hooks keep working, and
the two coexist on the web for as long as unconverted screens remain. Zustand stays the store for
**client** state on both platforms (UI state, the sign-in session view, preferences).

**Alternatives** (ADR-134): a hand-written cache on `useSyncExternalStore` (one more cache to get
right, with no gain); SWR (thinner mutation and invalidation model, weaker native focus/online
story); Redux Toolkit Query (pulls Redux into a codebase that chose Zustand).

## 3. Query Keys Include the Tenant — a Rule, Not a Convention

The global DoD says **every new cache key includes the tenant id** (`TASKS/00-TASK-CONVENTIONS.md` §
Security). A client cache is a cache: after a super-admin switches tenant context, or a different user
signs in on the same device, a key without the tenant would serve another tenant's rows.

```ts
// packages/hooks/src/keys.ts (target API)
export const keys = {
  devices: {
    list: (scope: CacheScope, q: DeviceListQuery) => ["t", scope.tenantId, "f", scope.facilityId ?? "*", "devices", "list", q] as const,
    detail: (scope: CacheScope, id: string) => ["t", scope.tenantId, "f", scope.facilityId ?? "*", "devices", id] as const,
  },
  // … one factory per resource
} as const;
export interface CacheScope { tenantId: TenantId; userId: UserId; facilityId: FacilityId | null }
```

- Every key **starts** with the tenant id; a facility-bound user's keys carry the facility (ADR-124:
  a bound user's answers differ by facility). A guard test enumerates the factories and fails on a key
  that does not start with `["t", tenantId]`.
- **Sign-out, a tenant switch, a scope-loss event or a changed scope fingerprint clears the whole
  cache** (`queryClient.clear()`), not just the affected keys.
- **The cache is memory only on both platforms.** Persisting it to disk is refused: it would put
  tenant data at rest outside the encrypted store and every purge rule (`06` § 4, `../MOBILE/01`).
  Offline data is the sync engine's working set, never a persisted query cache.

## 4. The Hooks

| Hook | Returns | Built on |
|---|---|---|
| `useApiQuery(key, op, params)` / `useApiList(key, op, params)` | `{ data, meta, status, error: ApiError \| null, refetch }` — the three states every data surface must render (`../ARCHITECTURE/12` § 7's three-state rule, kept) | TanStack Query + `api-client` |
| `useApiMutation(op, { invalidates })` | `{ mutate, status, error }`; for operations that declare `Idempotency-Key`, **one key per user intent**, reused for retries of the same submission (`03` § 6.3) | TanStack Query + `api-client` |
| `useEffectivePermissions()` / `useCan(slug, action)` / `useCanInvoke(op)` | the server's effective permission and the capability checks of `05` § 5 — never a role-name test | `GET /menu-groups/my-permissions` + `domain` |
| `useTranslate()`, `useFormatters()` | `t(key, values)`, the `Intl` formatters bound to the locale and the **tenant's** time zone | `i18n`; the app supplies the messages through `I18nProvider` (§ 5) |
| `useStatus(domain, state)` | `{ tone, label, icon }` (`tone` from `domain`, visual from `tokens`, label from `i18n`) — the platform renders shape + icon + text | `domain`, `tokens`, `icons`, `i18n` |
| `useDue(view)` | the online or offline-estimated due view of `05` § 2, with its label | `domain` |
| `useScan()` | `{ read(text) → ScanResult }` with the tenant's QR settings and the deployment's hosts bound | `domain` |
| `useSyncStatus()` | outbox count, oldest age, attention count, last sync — subscribed to the engine | `sync-engine` |
| `useCapture(localId)` | the capture, its checklist progress (`domain.checklistProgress`) and the engine's actions | `sync-engine` + `domain` |

## 5. Providers the Apps Mount

The package exports **context interfaces and providers that take values**, never platform objects:

```tsx
<CallibratorProvider
  api={apiClient}                 // from createApiClient (03)
  queryClient={queryClient}       // the app creates it; focus/online managers wired by the app
  scope={cacheScope}              // tenant, user, facility — from the signed-in session
  i18n={{ locale, messages }}     // the app chooses how messages are loaded
  sync={syncEngine ?? null}       // null on screens/platforms without offline mode
  config={{ verificationHosts, legacyHosts }}
>
```

The web wires the focus/online managers to `visibilitychange`/`online`; the app wires them to
`AppState`/NetInfo (`../MOBILE/01`). The package contains neither wiring.

## 6. Tests

At the package's **100 %** gate, rendered with `@testing-library/react`'s `renderHook` in a **plain
JS environment** (jest `testEnvironment: "node"`, no jsdom) — if a hook needed the DOM, the test
environment would fail it. Cases: each hook's three states; key factories (the tenant-prefix guard);
cache cleared on each scope event; one idempotency key per intent across a retry; `useCan` never reads
a role name (a fixture with a misleading role name and a contrary permission).

## 7. Bad Implications

- A second data-fetching style on the web until its screens are converted (Zustand + service hooks
  beside TanStack Query). Documented in `docs/FRONTEND/02-STATE-MANAGEMENT.md` when P35-08 lands.
- A new dependency for the web (TanStack Query, ~13 KB gzip) — only on the dashboard and `/field`
  bundles that adopt it, never on the public pages (budget 148.7 of 150 KB).
- Clearing the whole cache on every scope event costs refetches; correctness over cache hits.
