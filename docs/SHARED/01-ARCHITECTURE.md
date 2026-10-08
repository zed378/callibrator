# 01 — Shared-Package Architecture (TARGET)

> **Status: TARGET (ADR-134), except § 3, which describes `@callibrator/contracts` as built.** Built
> by [`TASKS/PHASE-35-SHARED-PACKAGES.md`](../../TASKS/PHASE-35-SHARED-PACKAGES.md), which
> may not start before the backend-agnostic contract group (Phases 32 … 34, ADR-136) exits.

Related: [`00-README.md`](./00-README.md) · [`90-CONVENTIONS.md`](./90-CONVENTIONS.md) ·
[`../MOBILE/01-ARCHITECTURE.md`](../MOBILE/01-ARCHITECTURE.md) (the app side) ·
[`../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md`](../ARCHITECTURE/11-DUAL-BACKEND-ARCHITECTURE.md) ·
[`../ARCHITECTURE/12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md`](../ARCHITECTURE/12-MULTI-FRONTEND-AND-SHARED-COMPONENTS.md)
(superseded in part by ADR-134 — see § 9).

---

## 1. The Problem, and What Is Deliberately Not Shared

Two clients — the Next.js web frontend (`frontend/`, with its `/field` PWA, ADR-127) and the
React Native app (`apps/mobile/`, ADR-135) — must agree on **meaning**: request and response
shapes, what a state means and how it looks, which words exist in which language, how a scanned QR
becomes a device lookup, how an offline capture is replayed and what a refusal means. Today that
meaning lives inside the web app (`frontend/src/lib/statusTone.ts`, `brandColor.ts`,
`readableOn.ts`, `actorLabel.ts`, `menuAccess.ts`; `frontend/src/i18n/*`;
`frontend/src/api/client.ts` and `typed.ts`). A second client copying it is how two truths start.

**Shared:** logic and design tokens (owner decision, 2026-10-08).

**Not shared, by decision:**

| Not shared | Why |
|---|---|
| **UI components** (buttons, tables, dialogs, layout) | each platform renders its own UI with its own accessibility model (DOM/ARIA vs native accessibility APIs); React Native Web or a cross-platform UI kit was rejected (ADR-134 alternatives) |
| **Navigation and routing** | Next App Router vs `expo-router` (ADR-135) have nothing in common worth abstracting |
| **Storage, crypto, network, scheduling implementations** | platform adapters, behind ports defined by the packages (§ 5) |
| **The web session mechanics** — the Next proxy, httpOnly cookies, `proxy.ts`, the CSP | web-only by nature (ADR-059, ADR-071); the web *auth adapter* wraps them (`03` § 4) |
| **Theme application** — `frontend/src/lib/theme.ts`, `themeInitScript.ts` | DOM-bound (`document.documentElement`, `localStorage`); the *values* are shared (`02`), the mechanism is not |
| **Push, camera, biometric, QR decoding** | native or browser APIs; the *rules* around them (what a QR means, what a push may carry) are shared |

## 2. The Packages and the Dependency Graph

```text
                       ┌──────────────────────┐
                       │ @callibrator/contracts│  zod only            (as built, ADR-097)
                       └──────────┬───────────┘
                                  │
        ┌───────────────┬─────────┼──────────────┬────────────────┐
        ▼               │         ▼              │                │
 @callibrator/domain    │  @callibrator/api-client                │
   (contracts)          │   (contracts types, openapi-fetch,      │
        │               │    generated `paths`)                   │
        │               │         │                               │
        └──────┬────────┴─────────┤                               │
               ▼                  ▼                               │
        @callibrator/sync-engine (contracts, domain, api-client)  │
               │                                                  │
               ▼                                                  ▼
        @callibrator/hooks  ◄── @callibrator/i18n (no deps; Intl)   @callibrator/tokens (no deps)
   (react + @tanstack/react-query as PEERS;                       @callibrator/icons  (no deps; data)
    api-client, domain, i18n, sync-engine, tokens, icons)
               │
     ┌─────────┴──────────┐
     ▼                    ▼
 frontend/ (Next.js)   apps/mobile/ (Expo)       backend/ ── imports @callibrator/contracts ONLY
```

| Package | May import | Must never import |
|---|---|---|
| `contracts` | `zod`, siblings | everything else (as built: lint `no-restricted-globals` on `process`, `window`, `document`; `types: []`) |
| `tokens` | nothing | everything |
| `icons` | nothing (it is data: semantic name → glyph name) | `lucide-react`, `lucide-react-native` (the apps map the name to a component) |
| `i18n` | nothing (uses the `Intl` built-in) | any i18n framework, `next-intl`, `react-intl` |
| `domain` | `contracts` | `api-client`, `sync-engine`, React |
| `api-client` | `contracts` (types), `openapi-fetch` | `axios` (the web's axios transport stays in `frontend/`, § 8), any storage API |
| `sync-engine` | `contracts`, `domain`, `api-client` (types and the client interface) | IndexedDB, WebCrypto, SQLite, Expo, React |
| `hooks` | `react`, `@tanstack/react-query` (**peer** dependencies, never installed by the package), and every package above | `react-dom`, `react-native`, `next/*`, `expo-*` |

**Rules that hold for every package** (enforced as described in [`90-CONVENTIONS.md`](./90-CONVENTIONS.md) § 5):

1. **No platform import.** Never `next`, `next/*`, `react-dom`, `react-native`, `expo`, `expo-*`,
   `@react-native/*`, `node:*` or a Node built-in, `axios`, `idb`, `localforage`.
2. **No platform global.** Never `window`, `document`, `navigator`, `localStorage`,
   `sessionStorage`, `indexedDB`, `process`, `global`, `__DEV__`, `require`. A package's
   `tsconfig.json` has `"lib": ["ES2025"]` — **no `"DOM"`** — and `"types": []`, so a reference to a
   browser global is a compile error, not a review comment.
3. **No ambient `fetch`.** The `api-client` receives a `fetch` function from its platform adapter
   (`03` § 3); no package calls a global `fetch`, `crypto`, `setTimeout`-based scheduler or clock
   directly — they arrive through ports (§ 5). This is what makes the packages testable without
   a DOM or a device, and what keeps the "no `DOM` lib" rule honest.
4. **No environment.** Configuration (API base URL, feature flags, timeouts) is passed in by the
   app at construction. A package never reads an environment variable.
5. **Acyclic.** The graph above is the whole graph; a new edge is an ADR amendment.

## 3. `contracts` — The One Package That Exists

**As built** (ADR-097 and Amendments 1–6; `packages/contracts/package.json`):

- `src/<domain>.ts`, one module per API domain (54 modules on 2026-10-08), request schemas and their
  `z.input`/`z.output` types; `envelope.ts` holds the one envelope schema set; constants the schemas
  read are canonical here (`pagination.ts`, `qmsValues.ts`, `inspectionValues.ts`, …).
- **Ships TypeScript source.** `exports` maps `.` and `./*` to `./src/*.ts` for both `types` and
  `default`; no `"type"` field (Turbopack infers ESM from the syntax; TypeScript, tsx and Babel treat
  the files as CommonJS). Only the backend's release tree gets compiled JavaScript
  (`backend/scripts/build-dist.ts` step 4 → `backend/dist/node_modules/@callibrator/contracts`).
- **One Zod** (`^4.6.5`), asserted by `packages/contracts/test/package.test.ts` to resolve to the same
  file from the package, `backend/` and `frontend/`.
- Its own `lint`, `typecheck` (TypeScript 7 by path) and `test` at **100 %** thresholds.
- Imported **by subpath** (`@callibrator/contracts/vendor`); the barrel stops at the first slice
  (ADR-097 Am. 1 § 4).

**What ADR-134 adds (target):**

- `apps/mobile` becomes its third consumer. Metro resolves the `exports` map (package exports are on
  by default in current Metro) and Babel (`babel-preset-expo`) compiles the `.ts` source, exactly as
  Turbopack does for the web. The one-Zod test gains `apps/mobile` as a fourth resolution root.
- **Zod on Hermes.** Zod 4 feature-detects `new Function` for its fast path and falls back when it is
  unavailable; the web already runs Zod under a CSP without `'unsafe-eval'`. P37-01 (the app foundation) proves it on
  Hermes with the package's own suites run in a Hermes-compatible test or a device smoke, not by
  assumption.
- **Open feasibility items on Hermes, proved in P37-01 next to Zod:** the `Intl` APIs `04` § 3 needs,
  and **jsPDF rendering** (for sharing the issued certificate and facility-staff documents as the web's
  PDF — `05` § 7a). A failed proof changes the app's rendering path (OS print from the layout model),
  never a package's contract.
- **Pure functions the server enforces stay here** — `normaliseQrCode` (ADR-132),
  `deriveNextCalibrationDate` and `computeCalibrationDue` (ADR-133), `normaliseResult`,
  `missingRequiredItems`, `computeIpmDue`, the conflict-code tuples (P19-02 § 13) and
  `canonicalIpmReportPayload` (ADR-126 Am. 2). Server and client must agree on them byte for byte,
  and the backend imports `contracts` only (§ 2). `domain` composes them; it never re-implements or
  re-exports them (`05` § 1).
- **Location is final.** `packages/contracts` stays where it is; Q-48's working decision to move it
  into `shared/contracts` at Phase 999 is superseded (§ 9).

## 4. The Generated API Types

**As built** (ADR-103, P9-25): the backend generates `backend/openapi.json` code-first from the Zod
schemas `validate()` enforces; the frontend generates `frontend/src/api/generated/schema.d.ts` from
it (`npm run api:types`, checked by `api:types:check`), and `frontend/src/api/typed.ts` builds an
`openapi-fetch` client over the generated `paths`.

**Target (owner decision 2026-10-08, ADR-136 — the backend-agnostic contract, Phases 32 … 34):** the
source of truth becomes the **contract-first, language-neutral `contracts/` folder** at the repository
root — OpenAPI 3.1 for HTTP, AsyncAPI 3 for events/realtime, and a behaviour specification — written
**before** code, with **stable machine error `code`s**. Both engines conform to it; neither generates
it. `@callibrator/api-client` is **generated from `contracts/`** (`src/generated/schema.d.ts`, with
`api:types` / `api:types:check` pointed at the contract files), not from `backend/openapi.json`. The
frontend and the app import `paths` and `components` from the package: one generated file, two
clients, one check. How `backend/openapi.json` and the Zod schemas of `packages/contracts` relate to
`contracts/` (generated from it, or checked against it) is ADR-136's decision; this document assumes
only that `contracts/` is authoritative and that a drift between it and the running backend fails CI.

**Naming:** the root `contracts/` (language-neutral files) and `packages/contracts`
(`@callibrator/contracts`, TypeScript/Zod) are different things; this folder always writes the
package with its scope.

## 5. Ports and Adapters

A capability that differs by platform is a **port** — a TypeScript interface declared in the package
that needs it — and an **adapter** implemented in the app. Adapters never live in a shared package.

| Port | Declared in | Web adapter (`frontend/src/platform/…`) | Mobile adapter (`apps/mobile/src/platform/…`) |
|---|---|---|---|
| `AuthAdapter` | `api-client` | cookie session through the Next proxy; refresh through `/api/v1/auth/refresh` (Next route); same-origin paths | bearer access token in memory; rotating refresh token in `expo-secure-store` (Keychain/Keystore); single-flight refresh |
| `FetchLike` | `api-client` | `globalThis.fetch` (or the axios transport during migration, § 8) | `globalThis.fetch` (React Native) |
| `EncryptedStore` | `sync-engine` | IndexedDB, per-record AES-GCM under a non-extractable WebCrypto key, AAD = slot (P19-08 § 7.1) | SQLCipher database (`expo-sqlite`), key in the Keychain/Keystore (ADR-135, `../MOBILE/04`) |
| `Clock` | `sync-engine` | `Date.now()` + the server `Date` header | same |
| `Network` | `sync-engine` | `online`/`offline` + `visibilitychange` events | `@react-native-community/netinfo` + `AppState` |
| `Scheduler` | `sync-engine` | timers while the page is open; Background Sync where Chromium has it (P19-08 § 9.3) | timers in foreground; `expo-background-task` (WorkManager / BGTaskScheduler) in background — opportunistic on iOS |
| `PhotoSource` | `sync-engine` (type only) | `<input capture>` + canvas re-encode (P19-08 § 8.1) | `expo-camera`/`expo-image-manipulator` re-encode (ADR-135) |
| `LocaleStore` | `i18n` (type only) | the `locale` cookie Server Action (as built) | MMKV preference |

The port signatures are in each package's document (`03` § 3, `06` § 4). A port is the narrowest
interface the package needs; an adapter that needs more (the web auth adapter's redirect rules) keeps
it on its side.

## 6. Versioning Inside the Monorepo

- Every package is **`"private": true`**, versioned `0.x`, and consumed through the workspace link —
  the root `package.json` already lists `packages/*` (npm is the package manager, ADR-044;
  `pnpm-workspace.yaml` mirrors it, G-09). Consumers declare `"@callibrator/<name>": "^0.1.0"`, which
  the lockfile records as a `link`, exactly as `@callibrator/contracts` is today.
- **One commit is one consistent set.** There is no independent release of a package: a change that
  breaks a consumer updates that consumer in the same pull request, and the typecheck of every
  workspace is the gate (`turbo run typecheck`).
- A package's `version` is bumped **minor** for an additive change and **major-in-0.x** (`0.n → 0.n+1`
  with a `BREAKING` changelog line) for a breaking one, so the per-package `CHANGELOG.md` reads as
  history (`90` § 7). The number is informational; nothing resolves by it.
- **The app binary is versioned separately** (`apps/mobile`, EAS — `../MOBILE/08`). An installed app
  is a *frozen copy* of the packages it was built with; that is why the server's
  installed-app-version policy (`../MOBILE/20` § 9) exists — the server, not the package version,
  decides whether an old copy may still talk to it.

## 7. Build and Publish

- **Source-only packages** (ADR-097 decision 2 extended to every package): `exports` points at
  `./src/*.ts`; there is no `dist/` and no build step a consumer depends on. Consumers compile:
  - **web** — Next `transpilePackages` lists every `@callibrator/*` package (today: `contracts`);
  - **mobile** — Metro + `babel-preset-expo` (Expo's monorepo support resolves the workspace
    symlinks; `apps/mobile/metro.config.js` watches the repository root);
  - **tests** — jest transforms (`ts-jest` in the frontend, `jest-expo` in the app, the package's own
    jest config for its 100 % gate).
- **Only `contracts` is ever compiled to JavaScript**, and only into the backend's release tree
  (ADR-097 decision 3). No other package reaches the backend (§ 2).
- **Nothing is published.** No package goes to npm or a private registry. EAS Build uploads the
  monorepo and installs from the root lockfile. The `@callibrator` scope is unregistered on npm
  (ADR-097 implications). **The owner decided on 2026-10-08 (Q-61) to reserve it** by creating the free
  npm organisation `callibrator` — an owner to-do in `TASKS/BACKLOG.md`; nothing is published to it.
- **Docker images (ADR-046, ADR-123):** the frontend image copies each consumed package's
  `package.json` before `npm ci` and its `src/` before `next build`; its `Dockerfile.dockerignore`
  allow-list re-includes each package and excludes `node_modules`, `coverage` and tests — the same
  trap ADR-097's implications name for `contracts`. The backend image copies `contracts` only.

## 8. How Each Client Consumes the Packages

### 8.1 Web (`frontend/`) — a migration, not a rewrite

The web app is in production; every move is **behaviour-neutral** and proved, card by card
(Phase 35). The order follows the dependency graph, leaves first:

| Step | What moves | From → to | Proof that nothing changed |
|---|---|---|---|
| 1 | colour, type, spacing, radius, breakpoint and status-tone values | `globals.css` `:root`/`.dark`, `public-surface.css`, `statusTone.ts` tone visuals, `priority.ts`, `brandColor.ts`, `readableOn.ts` → `@callibrator/tokens` + a generated `tokens.css` that `globals.css` imports | the computed `:root` and `.dark` custom properties are byte-identical before and after (a jsdom/PostCSS diff test); the existing `brandColor.test.ts` drift test and the ADR-090 contrast tests pass unchanged |
| 2 | icon names | the tone icons in `Badge`, the scattered `lucide-react` imports for semantic icons → `@callibrator/icons` names mapped by a web `Icon` component | rendered SVG snapshot of each semantic icon unchanged |
| 3 | translator, `format`, locale config, API-error mapping, shared namespaces | `frontend/src/i18n/{translate,format,config,apiErrors}.ts` → `@callibrator/i18n`; dictionaries per `04` § 6 | `i18n.p1002.test.ts` and `copyTruthfulness.p1011.test.ts` unchanged and green; the public pages' bundle budget (`/` ≤ 150 KB gzip) held |
| 4 | state→tone registry, actor label, menu helpers | `statusTone.ts` registry, `actorLabel.ts`, `menuAccess.ts` → `@callibrator/domain` | the existing tests move with the code, same case names and count (the P9-26 rule) |
| 5 | generated `paths`, the typed client, error normalisation | `frontend/src/api/generated/`, `typed.ts`, `describeApiError` → `@callibrator/api-client`, **with the axios transport kept in `frontend/`** as a `FetchLike` adapter, so the wire, refresh-once (F-05), the A-123/A-160 redirects, the access-denied store and F-07 normalisation are untouched | `client.session.f05`, `client.passwordChange.a123`, `client.mfaEnrolment.a160`, `typed.test.ts` and every service contract test pass unchanged; the live E2E suite in one run |
| 6 | the `/field` sync engine | built **in** `@callibrator/sync-engine` from the start if Phase 22 (P22-10) has not shipped it; extracted with its tests if it has (§ 10) | P19-08 § 16 suites and the real-device script |
| 7 | headless hooks | per screen, opportunistically — a screen adopts `@callibrator/hooks` when it is next changed for another reason | that screen's tests |

Replacing the axios transport with a fetch transport is **not** part of the migration. It is a
separate, optional card (P35-11) because it would change the session behaviour the web's tests pin.

### 8.2 Mobile (`apps/mobile/`)

The app is born on the packages: it has no private copy of any rule they hold. It supplies the
adapters of § 5, its own UI, navigation and native features (ADR-135, `../MOBILE/01`).

## 9. What This Supersedes — `shared/`, Per-Backend Adapters, Shared UI

ADR-089 and its documents (`docs/ARCHITECTURE/11` § 2, `12` §§ 2–5, `docs/FRONTEND/12`, `13`,
`TASKS/PHASE-999` P999-01/18/19) planned a root **`shared/`** with **shared UI components** and a
**second frontend adapter per backend** (`frontend/src/services/api-go.ts`, `ICalibrationAPIClient`).
ADR-134 supersedes those parts:

| Planned (ADR-089) | Now (ADR-134) | Why |
|---|---|---|
| root `shared/` (`components/`, `utilities/`, `types/`, `contracts/`) | `packages/*` workspaces, one package per concern | the workspace already exists and holds `contracts`; the owner chose `packages/*`; a second root would split the same concern across two homes |
| move `packages/contracts` into `shared/contracts` at Phase 999 (Q-48 working decision) | it stays in `packages/contracts` | nothing is gained by the move; every consumer imports by package name |
| shared React UI components | not shared — tokens and logic only | owner decision 2026-10-08; web DOM components cannot render on React Native without React Native Web (rejected, ADR-134) |
| a per-backend frontend adapter (TS adapter + Go adapter, same signatures) | **one** generated client; the backend is chosen by `baseUrl` | both backends serve the same OpenAPI document (§ 10); an adapter per backend is two copies of the contract |

Banners pointing here were added to the superseded documents (deviation protocol, ADR-134).

## 10. The Go Era Changes Nothing for a Client

Every client is bound to **the OpenAPI document**, not to an implementation:

1. The contract is the language-neutral **`contracts/`** folder (OpenAPI 3.1, AsyncAPI 3, behaviour
   spec — ADR-136, Phases 32 … 34), authored first; each engine is checked against it in CI (lint,
   breaking-change diff, conformance). *As built until then:* `backend/openapi.json`, code-first from
   Zod (ADR-103).
2. `@callibrator/api-client` is generated from `contracts/`; the web and the app call `paths`, never
   a backend-specific module.
3. The Go engine (ADR-089, Phase 999) must serve **the same document** — same paths, envelope, status
   codes, error `code`s and headers (`docs/API/14-BACKEND-INTEROPERABILITY-CONTRACT.md`,
   `docs/BACKEND/12` § 1.1, § 8). Its parity suite runs the contract against both engines.
4. Switching a deployment's engine is a **server** change (nginx/ingress); the clients' `baseUrl` does
   not even change. An installed app built before the switch keeps working because the contract did.

Because `contracts/` is authored independently of both engines (ADR-136), neither engine can become
the contract's author by accident; an engine that drifts from it fails its conformance gate.
The backend-for-mobile capabilities are specified once as contract and twice as implementation:
[`../MOBILE/20`](../MOBILE/20-BACKEND-FOR-MOBILE-NODE.md) and [`../MOBILE/21`](../MOBILE/21-BACKEND-FOR-MOBILE-GO.md).

## 11. Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| **Two React versions in one install.** Expo pins the `react` its React Native needs; Next 16 has its own (`frontend/package.json`: `react ^19.3.0`) | npm hoists one and nests the other; a hook package resolving the wrong copy throws "Invalid hook call" at runtime, not at compile time | `hooks` declares `react` and `@tanstack/react-query` as **peer** dependencies only; Metro is configured to resolve `react` from `apps/mobile/node_modules` first; a test in each app asserts `require.resolve("react")` from inside `@callibrator/hooks` equals the app's own copy (the one-Zod test's pattern) |
| A package grows a platform import "just this once" | the other client stops building, or worse, bundles a shim | the lint rule, the `lib`-without-`DOM` compile and the import-scan guard (`90` § 5) — three independent failures |
| The frontend's Docker allow-list misses a new package | the image build fails on `npm ci` (workspace not visible) or on `next build` (module missing) | each package card's DoD includes the image build (`make` image target or `docker build`), not just `npm run build` |
| A rule duplicated between `contracts` and `domain` | the client and the server disagree on a computed value | `domain` imports from `contracts` and never re-implements; a guard test lists `contracts`' exported functions and fails if `domain` exports a function of the same name |
| Source-only packages slow Metro/Next cold builds as they grow | longer builds | measured at P35-10; a build step is reconsidered only with a measurement (ADR-097's reasons against a `dist/` still hold) |
