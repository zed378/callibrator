# MOBILE/ — The Native Mobile App (TARGET)

> **Everything in this folder is TARGET. Nothing here is built.** There is no `apps/mobile/`, no
> Expo project, no EAS account configuration and no native code in the repository (checked
> 2026-10-08: the repository has `backend/`, `frontend/`, `packages/contracts/`; no `apps/`). Where a
> document says "the app does X", read "the app, once built, will do X". Writing a target as fact is
> PR-4 (`CLAUDE.md`, `docs/PLAN/18-RISK-REGISTER.md`), and these documents are written to avoid it.

**Decision record:** ADR-135 (`MEMORY/DECISIONS.md` — the mobile app architecture: Expo + EAS,
expo-router, offline field capture on SQLCipher, internal distribution; Accepted as the plan, not
built). **Origin:** the owner's brainstorm of 2026-10-08, `TASKS/BACKLOG.md` D-11, and the owner's
decisions of the same day recorded in ADR-135 § Context.

---

## What This App Is, in One Paragraph

A React Native app built with **Expo** (development builds, config plugins) and shipped with **EAS**
(EAS Build, EAS Submit, EAS Update), for **Android and iOS, phone and tablet**, distributed
**internally** (never as a public consumer listing by default — `08`). It serves four kinds of user:
**field technicians** doing heavy daily IPM capture and device registration (offline-capable),
**facility (faskes) staff** tracking their own facility's devices, **auditors** verifying a
certificate or an IPM report by QR, and **managers** reading dashboards. It shares with the web
frontend **logic and design tokens only** — through the packages in `packages/*` — and renders its
own native UI. The **offline PWA (ADR-127, `/field`) stays**: it is the quick, occasional,
nothing-to-install path; the native app is for the people who capture all day.

## One App, One Plan; Only the Backend for Mobile Has Two Variants

The app is **backend-agnostic**: it talks to the API only through the shared `api-client` package,
which is generated from the language-neutral contract in `contracts/` (ADR-136,
[`docs/CONTRACT/`](../CONTRACT/00-README.md)). Since 2026-10-08 (owner decision) there is **one**
mobile and shared-package plan, whatever language serves the API:

| Work | Phases | Owner of the phase files |
|---|---|---|
| the contract, its conformance suite, portability (prerequisite) | **Phases 32 … 34** — [`PHASE-32`](../../TASKS/PHASE-32-CONTRACT-FIRST-FOUNDATION.md), [`33`](../../TASKS/PHASE-33-CONFORMANCE-SUITE.md), [`34`](../../TASKS/PHASE-34-PORTABILITY.md) | this folder's author (ADR-136) |
| shared packages, the Node backend for mobile, the app | **Phases 35 … 40** — [`PHASE-35-SHARED-PACKAGES.md`](../../TASKS/PHASE-35-SHARED-PACKAGES.md) (group index), [`36`](../../TASKS/PHASE-36-MOBILE-BACKEND-NODE.md) backend for mobile on Node, `37` … `40` the app | the shared-packages documentation agent |
| the **Go** backend for mobile (the only Go-variant mobile work) | **Phase 1000** — [`PHASE-1000-MOBILE-BACKEND-GO.md`](../../TASKS/PHASE-1000-MOBILE-BACKEND-GO.md), after Phase 999 (Go, module by module) | this folder's author |

The app documents here hold whichever engine serves a module: the gateway routes modules, the
conformance suite proves them, and `GET /api/v1/meta` hides what an engine has not implemented
(`docs/CONTRACT/07`). No app build is ever made per backend.

## Documents

| # | Document | What it decides |
|---|---|---|
| 00 | this file | index, scope, reading order |
| 01 | [`01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) | the Expo project, `expo-router` (decided over React Navigation directly), state (shared headless hooks + Zustand stores), data layer (shared `api-client` + `sync-engine`), error handling, feature flags, configuration per environment |
| 02 | [`02-SCREENS-AND-ROLES.md`](./02-SCREENS-AND-ROLES.md) | the screen inventory per role, the permission ceiling for facility-bound users, the navigation map |
| 03 | [`03-RESPONSIVE-PHONE-TABLET.md`](./03-RESPONSIVE-PHONE-TABLET.md) | window classes from shared tokens, split view (master-detail), the two-column checklist, dashboards, landscape, hardware keyboard and focus order, Dynamic Type |
| 04 | [`04-OFFLINE-FIELD-CAPTURE.md`](./04-OFFLINE-FIELD-CAPTURE.md) | the native variant of P19-08: SQLCipher + MMKV, keys in the Keychain/Keystore, the outbox, background sync limits per OS, conflict UX, purge rules (72 h, revocation, scope loss), one field user per device and the shared-hospital-phone rules |
| 05 | [`05-NATIVE-FEATURES.md`](./05-NATIVE-FEATURES.md) | camera and the photo pipeline (re-encode, EXIF strip), QR scanning (`expo-camera`), push notifications (direct FCM/APNs, no personal data in a push), biometric unlock, deep links and app links |
| 06 | [`06-AUTH-FLOWS.md`](./06-AUTH-FLOWS.md) | password + MFA, hospital SSO (OIDC + PKCE in the system browser, app-link return), native passkeys, biometric re-unlock, token storage and rotation, logout and wipe |
| 07 | [`07-SECURITY-AND-PRIVACY.md`](./07-SECURITY-AND-PRIVACY.md) | the native threat rows (mapped from `docs/SECURITY/15`), root/jailbreak stance, no certificate pinning (decided, with reasons), screenshot policy, data at rest, MDM, UU PDP |
| 08 | [`08-DISTRIBUTION-AND-RELEASES.md`](./08-DISTRIBUTION-AND-RELEASES.md) | EAS build profiles, the internal channels (Play internal testing / Managed Google Play, TestFlight / Apple Business Manager), MDM, the OTA policy vs store binaries, versioning, minimum-version compatibility with the backend, rollback |
| 09 | [`09-TESTING.md`](./09-TESTING.md) | unit (`jest-expo`), component (React Native Testing Library), E2E with **Maestro** (decided over Detox), real devices, accessibility, offline tests |
| 10 | [`10-ACCESSIBILITY-AND-I18N.md`](./10-ACCESSIBILITY-AND-I18N.md) | WCAG 2.1 AA mapped to native, screen readers, targets, Dynamic Type, Indonesian-first i18n through the shared package |
| 11 | [`11-TENANT-SETUP-AND-BRANDING.md`](./11-TENANT-SETUP-AND-BRANDING.md) | **owner decision 2026-10-08:** the first-run tenant setup screen (org code, setup link/QR, MDM, email discovery), tenant branding (in-app logo, palette from `primaryColor` with an AA guard; launcher icon and splash stay Callibrator — one build), the tenant hint header, one tenant per install, per-tenant sign-in methods |
| 90 | [`90-CONVENTIONS.md`](./90-CONVENTIONS.md) | folder layout, naming, styling through tokens only, component rules, a11y labels, i18n keys, coverage, commit and release rules |
| 20, 21 | backend for mobile — **written by the shared-packages documentation agent** (see `docs/MOBILE/` listing; linked from 01, 06, 08) | native bearer + refresh auth, the push-token registry, the SSO app-link exchange, native passkeys, the installed-app-version policy |

**Shared packages** (`packages/contracts`, `tokens`, `api-client`, `i18n`, `domain`, `sync-engine`,
headless hooks, icon map) are documented in [`docs/SHARED/`](../SHARED/) by the shared-packages
documentation agent. These documents **reference** them and do not restate their APIs; where an app
rule depends on a package's behaviour, the dependency is named and the package's document wins.

## Reading Order

1. `01` (how the app is put together) → `02` (what it shows to whom) → `04` (offline — the hardest
   part, and the part with security weight) → `06` and `07` (sign-in, data at rest).
2. Before writing UI: `03`, `10`, `90`, then `docs/UI-UX/00`, `08`, `10`, `15`, `17` — the app keeps
   the product's design direction (precision, colour carries meaning, status is shape + icon + text).
3. Before a release: `08`, `09`.

## What These Documents Inherit, Unchanged

The app is a new **client**; it changes no server rule. Every rule below holds for it exactly as for
the web frontend, and a document here that seems to contradict one is wrong:

- **Tenant isolation is the server's** (`docs/SECURITY/05`). The app never sends a `tenantId` or a
  `clientFacilityId` that the server would trust; it never decides scope.
- **Facility scope** (ADR-124 + Am. 1–3): bound users see one facility; cross-facility is **404**;
  the menu is the effective permission from `GET /menu-groups/my-permissions` (as built:
  `{ superAdmin, permissions }`; **target**, P21-09: `facilityBound` and the bound ceiling cap). The app hides what the server denies — it never computes permission
  from a role name (`docs/FRONTEND/05-RBAC-IN-UI.md`).
- **The envelope**: rows in `data`, paging in a top-level `meta` (`CLAUDE.md`). Handled once, in the
  shared `api-client`.
- **409 is a state explanation**, shown as such, never as a generic error.
- **IPM sessions are issued records** (ADR-126): draft → submitted, corrected by supersession, voided
  by an unbound tenant administrator only, never edited after submit.
- **Reports are rendered by the client** from the API's data document (ADR-126 § 8, Am. 2); nothing
  is stored as a file, on the server or on the phone (`04` § 9).
- **Colour carries meaning; status is shape + icon + text** (ADR-122 § 6).
