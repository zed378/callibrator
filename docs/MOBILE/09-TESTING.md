# 09 — Testing the Mobile App (TARGET)

> **TARGET — nothing here is built.** The repository's testing rules hold unchanged
> (`docs/ENGINEERING/09-TESTING-CONVENTIONS.md`, `docs/TESTING/`): **name the test** — an assertion
> that a test passed is not evidence; **a mock proves the client, not the contract** (3,863 tests passed
> here while 13 endpoints were broken); **a test generated from the code it tests verifies consistency,
> never correctness**.

---

## 1. Layers

| Layer | Tool | What it proves | Runs |
|---|---|---|---|
| Shared packages | their own suites at 100 % (`docs/SHARED/90-CONVENTIONS.md`) | the logic the app reuses | CI, every change |
| **Unit** | **`jest-expo`** preset (iOS and Android projects), TypeScript tests | the app's own logic: adapters (storage, scheduler, secure store), stores, purge decisions, the photo pipeline's orchestration, route guards, error mapping | CI, every change |
| **Component** | **React Native Testing Library** (`@testing-library/react-native`) + `jest-expo` | screens render loading / empty / **failed** / data; absent-not-disabled per permission; accessibility props (roles, labels, states); focus moves on pane change; 409 shown as an explanation | CI, every change |
| **Contract** | the shared `api-client`'s generated types + a **live** contract smoke against a running backend | the app's requests are the API's real shapes | CI with the compose stack (§ 3.3) |
| **E2E** | **Maestro** (decided, § 2) | user journeys on a real build of the app on an emulator/simulator against a running stack | CI per merge to `main` and per release (§ 3) |
| **Offline** | unit (adapters) + Maestro with network control + the real-device script | `04`'s rules, row by row | § 4 |
| **Real devices** | the personal devices available (owner, Q-M4: no owned lab for now), a written script, a named run | what emulators cannot: OEM background killers, camera, biometrics, push, app links, Keychain behaviour | before every release (§ 5) |
| **Accessibility** | component a11y assertions + Maestro a11y checks + a manual screen-reader walk | `10` | § 6 |

**Coverage floor** (`90` § 8): the app's own code (`apps/mobile/src`, excluding generated files and the
`app/` route files' JSX) at **90 / 81 / 86 / 91** statements / branches / functions / lines — the
frontend's gate (`CLAUDE.md` § What Is Currently Failing), measured, never lowered to pass. The shared
packages carry their own 100 %.

## 2. E2E: Maestro (decided) over Detox

| | **Maestro** | Detox |
|---|---|---|
| Model | black-box: drives the built app through the accessibility tree, YAML flows | grey-box: synchronises with the JS thread and the network, JS test code |
| Setup with Expo | works on any build (APK / simulator `.app`), no native test harness in the project; supported by EAS Workflows | needs native test configuration in the generated projects (a config plugin) and per-platform build variants |
| Flakiness | automatic waiting and retries on visibility; very little test code | synchronisation is precise but breaks on long timers, animations and background work — which this app has (sync engine, background tasks) |
| What it pushes us towards | **accessible labels** on everything (it selects by text and accessibility id) — the same labels `10` requires | test ids |
| Limits | less control over app internals; network shaping through the emulator/simulator, not in-app | — |

Decision: **Maestro** for E2E. A journey that needs grey-box synchronisation is first reconsidered as a
component test; Detox is not added alongside it unless a recorded case shows Maestro cannot test a
required behaviour (ADR-135 alternatives).

## 3. E2E Journeys and Where They Run

### 3.1 Journeys (each a named flow file, `apps/mobile/e2e/<name>.yaml`)

| Flow | Asserts |
|---|---|
| `setup.*` | the tenant setup flows of `11` § 10: code, link, email discovery, MDM-locked, SSO-enforced (no password field), offline start with stored branding, tenant switch refused with an outbox |
| `signin.password-mfa` | password → MFA → home; wrong code → the server's message; lockout budget → 429 handled |
| `signin.sso` | the SSO app-link return completes sign-in (against a test IdP in the stack); a forged `state` is refused |
| `signin.passkey` | passkey sign-in on an emulator with a virtual authenticator where the platform allows; otherwise in the real-device script |
| `nav.permissions.*` | for each role of `02` (unbound technician, HT·b, HA·b, FM·b, manager): the tabs/sidebar entries present and **absent**; a bound user's hidden write actions (`02` § 1); a deep link to an unreachable screen → "not available" |
| `device.scan-register` | scan a synthetic QR (simulator camera fed an image / typed entry), register a device with two photos |
| `ipm.capture-online` | capture → submit → the report document renders; visit number shown |
| `ipm.capture-offline` | § 4 — airplane mode, capture, kill, reopen, restore, sync |
| `ipm.conflicts` | each 409 code the stack can produce on demand (draft exists, revision conflict, device retired) leads to its explanation and actions (`04` § 7) |
| `ipm.sign` | performer signature with a re-entered password; wrong password → 401 does **not** sign out |
| `verify.public` | signed out: scan a certificate QR and an IPM report QR → verdicts; a foreign URL refused |
| `session.revoke` | revoke the session from the web (API) → the app's next contact signs out and purges |
| `update.required` | the stack's minimum version raised → 426 → the blocking screen; the outbox kept |
| `tablet.split-view` | on a tablet simulator/emulator: master-detail selection survives rotation; the two-column checklist; keyboard navigation with a hardware keyboard (iPad simulator) |

### 3.2 Test data

Synthetic only (the privacy rule of every upstream card: no real upstream value enters the repository);
two tenants and two facilities seeded so every flow can assert a **404** for the other scope where the
screen reads an id (the server's two-tenant and two-facility suites are the proof; the app flows check
the app **shows** a 404 as "not found" and leaks nothing).

### 3.3 Where they run

- **CI per merge to `main`:** Android emulator (API at the floor and the newest) against the
  **disposable compose stack** the live E2E suite already uses (ADR-077's method), built from the same
  commit; the **iOS simulator** leg (floor and newest) where a macOS runner is available at no cost,
  otherwise on a developer Mac before each release (§ 7, owner Q-M4: no paid service). A failed flow blocks the release card, not the web.
- **Per release:** the full set on both platforms and both form factors.
- **Supported floor** (target, confirmed by the first release card against current store requirements):
  **Android 10 (API 29)+** and **iOS / iPadOS 16+**; phones ≥ 360 dp wide; tablets ≥ 600 dp.

## 4. Offline Tests (the rows of `04`, each named)

| Test | Proves |
|---|---|
| `fieldDb.cipher.test.ts` (unit, adapter) | the database cannot be opened without the key; a wrong key fails; the key is generated once and stored with the `THIS_DEVICE_ONLY` class (asserted on the SecureStore call) |
| `fieldDb.noPlaintext.test.ts` | the MMKV registry and preferences contain no field from a deny-list (name, qr, serial, room, value, note) — **except** the tenant-config keys of `11` § 5 (`code`, `name`, `primaryColor`, the public auth config: public by design), which are allow-listed by key after a full capture cycle |
| `purge.rules.test.ts` | every row of `04` § 8: 72 h device clock; 72 h by server `Date` with a rolled-back clock; failed refresh; each `SCOPE_LOSS_CODES` code; fingerprint change; logout refused with an outbox; root verdict; kill switch — and **the outbox survives every purge** |
| `freshInstall.keychainWipe.test.ts` | with no install marker, every app-owned SecureStore item is deleted before anything reads one |
| `sharedInstall.test.ts` | `04` § 10: enabling refused with another user's data; B's sign-in purges A's working set and never opens A's outbox; the admin wipe deletes after the server confirms and sends counts only |
| `photoPipeline.native.test.ts` (unit with fixtures) + `photo.exif.e2e` (device) | the output JPEG has no `APP1 Exif`, long edge ≤ 2048; the temp file is deleted; the 300-photo cap and storage floor refuse with the message |
| `backgroundRun.budget.test.ts` | a background run stops before its budget; an interrupted frozen op is retried byte-identical (same key, same body) |
| `sync.frozenOps.appKill` (Maestro + device) | kill the app mid-op; relaunch; the op is resent identically; nothing duplicated on the server (checked through the API: one session, one photo) |
| `ipm.capture-offline` (Maestro) | airplane mode → capture two IPMs with photos and a new device → kill → reopen → network back → all submitted once; `captured_offline` true on the server |

Network control: Android emulator `adb shell svc wifi/data`, iOS simulator via the Network Link
Conditioner profile or the stack's proxy dropping the app's traffic; the real-device script uses
airplane mode.

## 5. Real Devices — the Lab and the Script

**Devices (owner, 2026-10-08 — Q-M4: no budget for now).** The release gate runs on **emulators,
simulators and the personal devices available** — at least one physical Android phone and, for an iOS
release, one physical iPhone; a missing platform or form factor is named in the run's record as
"not proved on a real device". No paid device farm or service is required anywhere in this document.

**Recommended owned lab (a pre-production item, to be decided later):**

| Device | Why |
|---|---|
| a mid-range **Samsung** Android phone (current One UI) | the most common enterprise Android; "sleeping apps" behaviour |
| a mid-range **Xiaomi / Oppo / Vivo** phone | the aggressive background-killer family common in Indonesia (`04` § 6) |
| an **iPhone** on the iOS floor or close to it | Keychain, App Attest, background task behaviour |
| an **iPad** with a hardware keyboard | split view, keyboard navigation, Stage Manager / Split View windows |

A paid cloud device farm is **not** planned. Until the lab exists, the aggressive-OEM row (Xiaomi /
Oppo / Vivo) is proved only if such a phone is among the personal devices; otherwise the release record
says so.

**The real-device script** (a written checklist, run per release, recorded as a named run in
`MEMORY/records/` with device models, OS versions, the app version, runtime and update id — and no
screenshots with real data), adapting P19-08 § 16.5:

1. install from the release channel; sign in (password + MFA, then SSO, then passkey); enable biometric unlock;
2. enable offline mode; the pre-checks (screen lock, root) refuse correctly on a device set up to fail them;
3. airplane mode; kill; reopen → field capture works; capture 2 IPMs with 3 photos each (HEIC source on the iPhone) and register 1 device; kill mid-capture → nothing lost;
4. lock the phone in a pocket for 2 hours with the network back → note whether a background run synced (Android Samsung, Android aggressive-OEM, iOS) — **recorded as observed, not required**;
5. open the app → sync completes; verify on the web the sessions, photos (EXIF absent in the stored derivative), visit numbers;
6. sign online; the IPSRS countersigns on the iPad;
7. push: a sign request arrives with **no personal data** on the lock screen; tapping it after unlock opens the right screen;
8. app links: a verification QR scanned by the system camera opens the app's verify screen; signed out, it still verifies;
9. revoke the session from the web while the phone is offline → at its first contact (foreground or background) it purges and signs out;
10. 73 h without sync (or clock forward) → working set purged at next open; clock rolled back 5 days then online → purged at the first response;
11. second user on the same phone → the rules of `04` § 10;
12. OTA: publish an update on the preview channel → applied at next cold start, never during a sync; the outbox survives;
13. minimum version raised → 426 screen; the outbox kept; update from the store → syncs;
14. TalkBack and VoiceOver walk of the capture stepper and the verify screen (`10` § 5).

A failure on a real device **blocks the release card**; the record names what failed **and which
devices were not available**.

## 6. Accessibility Testing

- **Component level:** every interactive element has `accessibilityRole` and an accessible name;
  icon-only controls are named after their object; status badges expose their text; a lint rule
  (`eslint-plugin-react-native-a11y` class) runs on `apps/mobile/src`.
- **E2E level:** Maestro flows select by accessible text — a missing label fails the flow; a dedicated
  flow runs the main screens at the **largest** font scale and checks nothing is cut off (screenshots
  compared by a person, not pixel-diffed).
- **Platform scanners:** Android **Accessibility Scanner** and Xcode **Accessibility Inspector** audits of
  the main screens per release, findings recorded.
- **Manual:** a TalkBack and a VoiceOver walk of capture, scan, verify and sign-in per release (§ 5 step
  14) — the step the web never recorded (`docs/FRONTEND/00`: no screen-reader walk recorded, F-12); the
  app does not repeat that gap.

## 7. What CI Runs

| Stage | Command (target) | Gate |
|---|---|---|
| lint | `npm run lint -w apps/mobile` | 0 errors (React Compiler rules on) |
| typecheck | `npm run typecheck -w apps/mobile` (TypeScript 7) | 0 errors |
| unit + component | `npm test -w apps/mobile -- --coverage` | the floor of § 1 |
| bundle check | `npx expo export` for both platforms | builds; bundle size recorded against a budget set at the first release |
| E2E | the `e2e` profile built **locally in the CI runner** (`eas build --local`, no paid EAS minutes) + Maestro on the Android emulator against the compose stack; the iOS simulator leg runs where a macOS runner is available at no cost, otherwise on a developer Mac before the release (owner, Q-M4: no paid service) | every flow of § 3.1 |
| secret scan | gitleaks over `apps/mobile` and the exported bundle | 0 findings |

`make verify` gains the first four stages for `apps/mobile` when the workspace exists; the E2E stage is
in CI from the first mobile release card (unlike the web's live E2E, which is still not in CI — A-19 —
a gap the app should not copy).
