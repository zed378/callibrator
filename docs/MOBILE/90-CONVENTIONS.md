# 90 — Conventions for `apps/mobile` (TARGET)

> **TARGET — nothing here is built.** These are the rules the first card that creates `apps/mobile`
> sets up as lint rules, guards and CI stages. Where a rule below says "a guard refuses", the guard is
> part of that card's Definition of Done, not a hope. Shared-package conventions:
> [`docs/SHARED/90-CONVENTIONS.md`](../SHARED/90-CONVENTIONS.md). Repository-wide: `CLAUDE.md`,
> `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md`, `docs/FRONTEND/00-FRONTEND-STANDARDS.md` (whose API,
> state, error and accessibility rules apply to the app unless this file says otherwise).

---

## 1. Folder Layout

```
apps/mobile/
├── app.config.ts            the only app configuration (variants, plugins, entitlements) — 01 § 7
├── eas.json                 build profiles — 08 § 1
├── plugins/                 in-house config plugins (backup exclusion, network security config,
│                            managed configuration schema, screen-capture, SQLCipher options)
├── modules/                 in-house Expo modules (managed app configuration reader, biometric
│                            enrolment-change check) — each with its own tests
├── e2e/                     Maestro flows (09 § 3)
└── src/
    ├── app/                 expo-router routes ONLY (01 § 2.1) — thin: compose components, call hooks
    ├── components/          native UI components (PascalCase.tsx), grouped by feature:
    │   ├── ui/              primitives: Button, TextField, StatusBadge, MeasurementValue, Sheet, …
    │   ├── layout/          Tabs/Sidebar chrome, SplitView, ScreenHeader, OfflineBanner
    │   └── <feature>/       devices/, ipm/, verify/, auth/, outbox/, dashboard/
    ├── features/            feature logic that is app-specific (not shared): view models, screen hooks
    ├── platform/            the adapters the shared packages ask for: storage (SQLCipher), secureStore,
    │                        scheduler (AppState + background task), clock, network, camera, push
    ├── stores/              Zustand stores: sessionStore, menuStore, fieldStore, toastStore (01 § 3)
    ├── theme/               ThemeProvider over the shared tokens' native theme; useWindowClass()
    ├── i18n/                the provider wiring the shared i18n package; app-only keys live in the
    │                        package under `mobile.*`, never here
    └── lib/                 small app utilities (no domain rule — those are in packages/domain)
```

**What never lives in `apps/mobile`:** a domain rule (QR normalisation, due computation, report
canonicalisation, validation) — those are in the shared `domain`/`contracts` packages; an API path or
type written by hand — the generated `api-client` has them; a translation string — the shared `i18n`
package has them; a colour, spacing or radius value — the shared `tokens` package has them.

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| Route files | expo-router conventions, kebab-case segments, `[param].tsx` named **after the API's path parameter** — one rule, no app-only names; where a route mirrors a web URL (verification), the web's segment name (`[certificateNumber]`) is also the API's | `devices/[calibrationDeviceId]/photos.tsx`, `verify/[certificateNumber].tsx` |
| Components | `PascalCase.tsx`, one exported component per file | `IpmItemField.tsx` |
| Hooks | `useThing.ts` | `useWindowClass.ts` |
| Stores | `<concern>Store.ts` | `fieldStore.ts` |
| Platform adapters | `<port>.native.ts` implementing the shared package's port interface | `storage.sqlcipher.ts` |
| Tests | `<subject>.test.ts(x)` beside the subject; Maestro flows `<area>.<journey>.yaml` | `purge.rules.test.ts`, `ipm.capture-offline.yaml` |
| Accessibility ids (Maestro) | the **visible label** first; `testID` only where no stable label exists, `<screen>.<element>` | `devices.list.search` |
| i18n keys | `<namespace>.<screen or area>.<item>` in the shared package | `field.conflicts.IPM_DRAFT_EXISTS.title` |

## 3. Styling — Tokens Only

- **Every colour, space, radius, font size, line height, elevation and duration comes from the theme**
  built from the shared tokens (`docs/SHARED/02-TOKENS.md`): `const t = useTheme(); { color: t.color.foreground }`.
- **A guard refuses raw values** in `apps/mobile/src/**` (non-test `.ts`/`.tsx`): hex/`rgb()`/`hsl()`
  literals, named colours (`"white"`, `"black"`, `"red"`), numeric `fontSize`/`padding`/`margin`/
  `borderRadius` literals outside the theme (0 and `StyleSheet.hairlineWidth` excepted), and opacity on
  text. It is the native twin of the web's `dashboardColours.p1101.guard` and starts at **zero** — the
  app has no legacy to ratchet down. An allow-list (`constants/styleExemptions.ts`: file, literal,
  reason) exists for user-chosen data colours only; growing it to pass is an abuse case.
- `StyleSheet.create` for static styles; theme-dependent styles through a `makeStyles(theme)` helper
  memoised per theme. No CSS-in-JS runtime library; no Tailwind-for-RN layer (the tokens are the
  system; a second styling vocabulary would drift from the web's semantic names).
- **Tenant branding** may change only the primary (chrome and identity), never a status tone or a
  badge (ADR-122 § 4, `docs/UI-UX/00`) — the theme exposes a `brandPrimary` slot and nothing else.
  The tenant's palette is **derived only by `packages/tokens`** from `primaryColor` with its AA guard
  (`11` § 4); the app never computes a colour itself. The tenant logo is shown only through one
  `TenantLogo` component (fixed box, raster only, the tenant name as its accessible label and text
  fallback). The launcher icon and the splash are never tenant-specific.
- Platform feel (owner: "same brand, native feel"): native controls (switches, pickers, sheets, the
  system font — `docs/SHARED/02` § 6), platform navigation chrome, platform haptics for confirmations
  (light) and errors (notification-error) — haptics are never the only signal.

## 4. Component Rules

- **State before decoration** (`docs/UI-UX/00`): the first thing on a screen is what is true (due,
  overdue, needs attention, offline).
- Every data screen implements **loading / empty / failed / data** — `EmptyState` and `ErrorState`
  are different components; an empty list for a failed request is the defect `docs/FRONTEND/00` calls
  the most important frontend rule.
- **Absent, not disabled**: a control the user may not use is not rendered (`02` § 1). The exception is
  a control **temporarily** unavailable for a stated reason ("Needs a connection") — rendered disabled
  **with** the reason as visible text and accessible hint.
- **409 is an explanation**: components show the server's state explanation verbatim (or the shared
  dictionary's for a known code) and the action it suggests; never "Something went wrong".
- **No role names** in components; permission questions go through the shared capability hook.
- **No raw `fetch`**, no direct `api-client` call from a component: component → feature hook → shared
  hook → `api-client` (`docs/FRONTEND/00` § API Access, same layering).
- **No tenant data in component state that outlives the screen**; no `AsyncStorage`; no writes to the
  file system outside `platform/` (guards, `04` § 4.1).
- Lists: `FlashList`-class virtualised lists for anything that can exceed ~50 rows; `keyExtractor` on
  the server id; never index keys.
- Serial numbers, QR codes, report numbers: monospaced token font, **never truncated** (`docs/UI-UX/15`).
- Measured values through `MeasurementValue` (value + unit + limit, `docs/UI-UX/10`) — the same
  component spec as the web.

## 5. Accessibility Labels (enforced)

- Every `Pressable`/`Touchable` has `accessibilityRole` and an accessible name (visible text or
  `accessibilityLabel`); icon-only controls are named **after their object** (`10` § 1).
- Images: meaningful ones have `accessibilityLabel`; decorative ones `accessible={false}`
  (`importantForAccessibility="no"` on Android).
- Status badges expose their text; charts expose a data alternative.
- The a11y lint plugin runs as an error, not a warning; a disabled rule needs a reason comment and a
  reviewer (as every `eslint-disable` in this repository).

## 6. TypeScript and Lint

- `strict` + the ADR-038 flags, no `any`, reasons on every `@ts-expect-error` and `eslint-disable`;
  typechecked by TypeScript 7 (`npm run typecheck -w apps/mobile`, never bare `npx tsc` — ADR-076).
- ESLint with the React Native, React Hooks, React Compiler and a11y plugins; `no-console` is an error
  (the logger only; production strips `console.*`); `no-restricted-imports` refuses
  `@react-native-async-storage/async-storage`, `react-native-webview` (no web views in the app,
  `07` § 6) and any analytics/ads SDK (`07` MT-10).
- Module shape: named exports; no default exports except where expo-router requires them (route files).

## 7. Configuration and Secrets

- One configuration file (`app.config.ts`), variant by `APP_VARIANT`; values from EAS environment
  variables; **no secret** in the app or its configuration (`01` § 7, `07` MT-01); a secret scan runs on
  the workspace and the exported bundle.
- Every native change is a **config plugin** (Continuous Native Generation); `android/` and `ios/` are
  generated and git-ignored. A hand edit of a generated native project is lost at the next prebuild —
  and is therefore refused in review.

## 8. Tests and Coverage

- Unit and component tests beside their subject; coverage floor **90 / 81 / 86 / 91**
  (statements / branches / functions / lines) for `apps/mobile/src` — measured, never lowered to pass
  (`09` § 1).
- Every new screen: a component test for loading / empty / failed / data, the permission-absent case,
  and its accessibility props; every new permission-dependent action: a test with a principal that may
  **not** use it (the negative case — `TASKS/00-TASK-CONVENTIONS.md` § Testing).
- Every bug fix: a test that fails without the fix (mutation-checked where the behaviour is
  load-bearing).
- A mock proves the client, not the contract: every new API use is exercised by a Maestro flow against
  the running stack before the card is DONE.
- **Name the test** in every record and PR.

## 9. Commits, Branches, Releases

- Branches and commits follow `TASKS/00-TASK-CONVENTIONS.md`: `feat/P<phase>-<seq>-<slug>`, the task id
  in the subject, the **why** in the body.
- A change to `apps/mobile` that changes behaviour states, in its PR, whether it can ship **OTA** or
  needs a **store binary** (`08` § 3) — a PR that changes a config plugin or a native dependency is
  labelled `native` and cannot be released by `eas update`.
- A change to a route or field the app uses states its effect on **supported app versions** (`08` § 5);
  `openapi:breaking` against the oldest supported app's contract snapshot is the check.
- Releases: the procedure of `08` § 8; a `MEMORY/records/` entry, a `MEMORY/CHANGELOG.md` entry and the
  `TASKS/PROGRESS.md` row in the same commit; `mobile-v<version>` tag.
- **Docs follow the deviation protocol** (`CLAUDE.md`): when building the app shows a document here to
  be wrong, stop, write an ADR (or an amendment to ADR-135), amend the document referencing it, and
  record both. These documents state as fact only what is built; until then they are TARGET.
