# Phase 37 — Mobile App Foundation

> Part of the **mobile group, Phases 35 … 40 (one plan)** (index, group-wide DoD, owner questions:
> [Phase 35](./PHASE-35-SHARED-PACKAGES.md)). The app: [`docs/MOBILE/`](../docs/MOBILE/00-README.md)
> (ADR-135); its packages: [`docs/SHARED/`](../docs/SHARED/00-README.md) (ADR-134).
>
> ← [Phase 36 — Backend for Mobile](./PHASE-36-MOBILE-BACKEND-NODE.md) · [Phase 38 — Field Capture](./PHASE-38-MOBILE-FIELD-CAPTURE.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 8 cards: 8 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | `apps/mobile` exists: an Expo + EAS app for Android and iOS that a user can set up for their organisation, sign in to with password + MFA, see their home and sessions, lock and unlock — built on the shared packages, tested in CI |
| **Depends on** | P35-10; P36-01, P36-02, P36-03, P36-07, P36-11, P36-12; owner questions Q-M1 (app id) and Q-M4 (EAS plan) answered |
| **Size** | L |
| **Cards** | 8: P37-01 … P37-08 |
| **Definition of Done** | the global DoD + the group-wide DoD ([Phase 35 § 2](./PHASE-35-SHARED-PACKAGES.md)) + `docs/MOBILE/90-CONVENTIONS.md` (coverage floor 90 / 81 / 86 / 91 for `apps/mobile/src`) + `docs/MOBILE/08` § 8 for any card that ships a build to testers |

## Cards

### P37-01 — The Expo project in the monorepo, and the runtime proofs

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P35-10; Q-M1 answered |
| **Spec refs** | `docs/MOBILE/01-ARCHITECTURE.md` §§ 1–2, 7 · `docs/MOBILE/90-CONVENTIONS.md` §§ 1, 6–7 · `docs/SHARED/01` §§ 3, 7, 11 · ADR-135 |
| **Spec required** | no |

**Why:** everything else builds on a project that resolves the workspace packages, one React and one Zod, and runs them on Hermes.

**Definition of Done**
- [ ] `apps/mobile` (Expo SDK current at the card, development builds, `expo-router`), in the root `workspaces`; `metro.config.js` resolving the workspace with `react` from the app first
- [ ] `app.config.ts` with the three variants and app ids of `01` § 7; no secret in the config or bundle (a test greps the built bundle for known secret names)
- [ ] The one-React and one-Zod tests instantiated for the app (`docs/SHARED/01` § 11)
- [ ] **Hermes proofs** on an Android and an iOS build: `@callibrator/contracts` suites (or a representative set) and the `Intl` APIs `docs/SHARED/04` § 3 needs, for `id-ID` and `en`; polyfills added in the app only if a proof fails
- [ ] **Open feasibility item — jsPDF under Hermes** (`docs/SHARED/05` § 7a): render the issued certificate and an IPM report PDF on an Android and an iOS build; record the result; if it fails, the app's rendering path is the OS print pipeline from the layout model (decided in the record, not silently)
- [ ] CI job: lint (incl. React Compiler rules), typecheck (TypeScript 7 by path), `jest-expo` tests at the floor

**Abuse cases**
- A Hermes proof run on the JS engine of the test runner, not on Hermes

### P37-02 — Theme, i18n, icons and the app shell

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-01 |
| **Spec refs** | `docs/MOBILE/03-RESPONSIVE-PHONE-TABLET.md` §§ 1–3 · `docs/MOBILE/10-ACCESSIBILITY-AND-I18N.md` · `docs/MOBILE/90` §§ 3–5 · `docs/SHARED/02`, `04`, `08` |
| **Spec required** | no |

**Definition of Done**
- [ ] `createTheme` from `@callibrator/tokens` provided app-wide; light/dark from the user's choice or the system; reduce-motion honoured; styling from tokens only (lint)
- [ ] `I18nProvider` with Indonesian default and English; the app-only `mobile.*` namespace typed against `id`
- [ ] The one native `Icon` component over `lucide-react-native`; status rendered as shape + icon + text
- [ ] The navigation chrome of `02` § 4 / `03` § 3 (tabs on compact, sidebar on expanded), chosen from the window class tokens
- [ ] Accessibility labels enforced by lint/test per `90` § 5

### P37-03 — First-run tenant setup and branding

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-02, P36-11 |
| **Spec refs** | `docs/MOBILE/11-TENANT-SETUP-AND-BRANDING.md` · `docs/MOBILE/20` § 2a · `docs/SHARED/02` § 4.4 · `docs/SHARED/03` § 5a · owner decision 2026-10-08 |
| **Spec required** | no |

**Why:** the owner decided the app knows its organisation before sign-in.

**Definition of Done**
- [ ] Org-code entry, setup QR / link `https://<host>/m/setup?org=<code>` (the dev-only custom scheme as fallback), MDM managed configuration pre-fill, and the work-email fallback through `POST /public/tenants/discover` (P36-11; **not** the web's `/auth/login/discover`, which starts a web SSO flow)
- [ ] Branding cache (`createBrandingCache` + MMKV store), the tenant palette from `brandRamp` with the copper fallback; status tones untouched
- [ ] The tenant hint injected on every request; the sign-in screen shows only the methods the public config allows
- [ ] One tenant per install; switching = sign out + empty outbox + wipe, with the confirmations of `11` § 6
- [ ] Tests per `11` § 10, including a 404 returning to setup and the uniform-404 wording

**Abuse cases**
- Caching anything beyond the public answer in MMKV "to make the switch faster"

### P37-04 — Sign-in with password + MFA, first-sign-in password, the bearer adapter

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-03, P36-03, P36-12 |
| **Spec refs** | `docs/MOBILE/06-AUTH-FLOWS.md` §§ 1–2, 6 · `docs/SHARED/03` § 5 · `docs/MOBILE/20` §§ 5–6 |
| **Spec required** | no |

**Definition of Done**
- [ ] The mobile `AuthAdapter`: access token in memory, refresh token in SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), single-flight refresh, write-before-resolve, `REFRESH_RACE` handling; the fresh-install Keychain wipe (`04` § 4.3)
- [ ] Password + MFA (TOTP and recovery code), the A-123 / A-160 gates, forgot password in the system browser
- [ ] Maestro flow `signin.password-mfa` against the compose stack through `/native/`
- [ ] No token in MMKV, logs, crash context or URLs (a test inspects the stores after sign-in)

**Abuse cases**
- Persisting the access token "to skip a refresh at cold start"

### P37-05 — Home, my sessions, sign-out and logout-all

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-04, P36-02 |
| **Spec refs** | `docs/MOBILE/02-SCREENS-AND-ROLES.md` § 1, § 4 · `docs/MOBILE/06` § 7 · `docs/SHARED/07` |
| **Spec required** | no |

**Definition of Done**
- [ ] Home per role from the effective permission (`useEffectivePermissions`), never role names; the three states on every data surface
- [ ] "My sessions" listing browsers and installs, revoke (family); sign-out and logout-all per `06` § 7
- [ ] Maestro `nav.permissions.*` for the roles available at this stage; `session.revoke`

### P37-06 — App lock (biometric re-unlock), privacy overlay, screen-capture rules

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-04 |
| **Spec refs** | `docs/MOBILE/06` § 5 · `docs/MOBILE/05` § 4 · `docs/MOBILE/07` § 5 |
| **Spec required** | no |

**Definition of Done**
- [ ] Lock at cold start and after `mobile.appLockMinutes` (≤ 5) in background; biometric or device passcode; five failures or an enrolment change → password sign-in
- [ ] The app-switcher privacy overlay; capture prevented on the screens `07` § 5 names
- [ ] Tests that the lock never gates the token or the field key (stated, `06` § 5) and that no data screen renders before unlock

### P37-07 — Configuration read, kill switches, update-required screen, error handling

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-04, P36-07 |
| **Spec refs** | `docs/MOBILE/01` §§ 5–6 · `docs/MOBILE/08` § 5 · `docs/MOBILE/20` §§ 9, 11 |
| **Spec required** | no |

**Definition of Done**
- [ ] `/mobile/config/public` at launch and `/mobile/config` after sign-in, in memory only; flags hide features, never widen access
- [ ] The error table of `01` § 5 implemented through `ApiError` classes; 426 → the blocking update screen (outbox kept)
- [ ] Maestro `update.required`

### P37-08 — Phase exit: a preview build in testers' hands

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-01 … P37-07; Q-M4 answered |
| **Spec refs** | `docs/MOBILE/08` §§ 1–2, 8 · `docs/MOBILE/09` |
| **Spec required** | no |

**Definition of Done**
- [ ] EAS preview builds for Android (Play internal testing) and iOS (TestFlight) from CI; the release procedure's steps that apply to a preview
- [ ] Maestro flows of this phase green on both platforms against a compose stack; coverage floor held
- [ ] Phase summary in `MEMORY/`; `PROGRESS.md` updated

**Abuse cases**
- A "green" phase with Maestro run on one platform only
