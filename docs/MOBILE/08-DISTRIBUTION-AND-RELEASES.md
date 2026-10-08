# 08 — Distribution and Releases (TARGET)

> **TARGET — nothing here is built.** No EAS project, Apple Developer account, Play Console account,
> signing key or store listing exists for this app (2026-10-08). The owner's decision (2026-10-08):
> **EAS** (dev builds, EAS Build, EAS Update OTA, config plugins), **Android + iOS, internal
> distribution**. This document decides the concrete channels; the choices the owner must still make
> (accounts, the organisation's identity, the Android fallback channel) are listed in ADR-135 § Open
> questions and in § 9 below.

---

## 0. No Paid Service Is Required (owner, 2026-10-08 — Q-M4)

There is **no budget for now**: no paid EAS plan, no owned device lab, no cloud device farm. Everything
below works on the **free EAS tier** (its monthly build allowance and update quota) and on **local
builds** — `eas build --local` (the same profiles on a developer machine; iOS needs a Mac with Xcode)
and `npx expo run:android` / `run:ios` for development. When the free build allowance is used up,
builds continue locally; when the free EAS Update quota is the limit, OTA updates carry fixes only and
features wait for the next store binary. **No release gate in `08` or `09` requires a paid service.**
The Apple Developer Program and Google Play Console registrations are still needed to distribute at
all (store fees, not optional services); their timing is the owner's (Q-M1).

## 1. EAS Build Profiles

`apps/mobile/eas.json` (target):

| Profile | Purpose | Distribution | Build | EAS Update channel | Notes |
|---|---|---|---|---|---|
| `development` | developers | EAS **internal** (Android APK link; iOS **ad hoc** to registered devices) | debug, `expo-dev-client` | `development` | never given to users; registered iOS devices are limited per year by Apple |
| `e2e` | Maestro runs (`09`) | none (CI artefact) | release-like: Android APK (the same build type as the shipped one, minus store signing), iOS **simulator** build — **not** the shipped iOS binary (a simulator build cannot be); the shipped iOS binary is exercised only by the real-device script (`09` § 5) | none (updates disabled) | the build the E2E suite tests is the build that ships, minus signing |
| `preview` | UAT, field pilots | **store** (Play internal testing, TestFlight) | release, `preview` variant (`01` § 7) | `preview` | staging host |
| `production` | users | **store** (§ 2) | release, `production` variant | `production` | `autoIncrement` build numbers |

- **App version source: remote** (EAS keeps build numbers; no committed build-number bumps).
- **Credentials:** EAS-managed for the upload key (Android) and the distribution certificate /
  provisioning profiles (iOS); **Play App Signing** holds the Android app-signing key. The EAS Update
  **code-signing private key** is **not** given to EAS: it is held by the release owner (a hardware key
  or the secrets store of `docs/DEVOPS/`), and only its certificate is embedded in the app (§ 4.3).
- Builds run on the **free tier** of EAS Build's hosted workers while its allowance lasts, otherwise
  locally (`eas build --local`) with the same profile (§ 0). Build logs are scanned by the CI secret scan (07 MT-01).

## 2. The Channels — Decided

### 2.1 Before production

| Stage | Android | iOS |
|---|---|---|
| Developers | EAS internal distribution (APK) | EAS internal distribution (ad hoc) |
| UAT / pilot (≤ 100 named people) | **Play Console internal testing track** — no review, minutes to install, testers by e-mail list | **TestFlight internal testing** (members of our App Store Connect team) |
| Wider UAT (customer staff, not in our team) | Play **closed testing** track with the customer's tester list | **TestFlight external testing** group (Beta App Review applies; builds expire after **90 days**) |

### 2.2 Production

| Platform | Primary channel | For customers without it | Rejected |
|---|---|---|---|
| **iOS / iPadOS** | **Apple Business Manager — Custom App** (private distribution): the app is assigned to named customer organisations' ABM accounts after App Review, installed silently through their MDM, or with **redemption codes** when they have ABM but no MDM | **Unlisted App Store distribution** (Apple's link-only listing: not searchable, installed from a direct link; App Review applies) | **Apple Developer Enterprise Program** — only for apps used by the developer organisation's **own employees**; our users are customers' staff, so it is not permitted. **TestFlight for production** — 90-day expiry, a beta channel by Apple's terms |
| **Android** | **Managed Google Play — private app** published to the customers' Android Enterprise organisation IDs, installed and configured through their EMM/MDM | **decided (owner, Q-M3):** a **Play production listing restricted to Indonesia**, with no self-registration (the app is useless without an invitation from a tenant administrator); the listing text says so | **Sideloaded APK** (the upstream practice, `docs/UPSTREAM/00` § 6): no integrity of the install source, no automatic updates, users trained to allow unknown sources. **Closed testing as production** — a testing track by Google's terms |

"Internal distribution" (owner) is honoured fully by ABM Custom Apps and Managed Google Play private
apps. The two fallbacks (iOS unlisted, Android public-but-invite-only) are the closest the stores offer
to a customer without device management. **Owner, 2026-10-08 (Q-M3):** Android customers without Android
Enterprise get the **restricted public Play listing** (Indonesia only, sign-in by invitation only);
Managed Google Play stays for customers who have it.

### 2.2a Store review needs a way in

Apple App Review and Google Play review need to sign in (the app has no self-registration). The
release card provisions a **reviewer tenant** on the production platform with **synthetic data only**
(the conformance fixtures' shapes, no upstream value), a reviewer account per store with password +
MFA disabled for that tenant only (or a TOTP seed given in the review notes), offline mode allowed,
and nothing else. The account is disabled between reviews. **If a real deployment's host is used** for
review, the DPIA addendum records that a store's reviewers access that host (`07` § 9) — synthetic
data only, never a customer tenant.

### 2.3 Accounts the owner provides (owner actions)

- **Apple Developer Program** membership as an **organisation** (needs a D-U-N-S number) — the
  organisation name is what users see as the seller; App Store Connect team with roles for the release
  owner.
- **Google Play Console** developer account as an **organisation** (D-U-N-S; Google's verification of
  new organisation accounts takes time), with Play App Signing enabled at the first upload.
- **Expo / EAS** organisation account on the **free tier** (owner, Q-M4: no paid plan for now) — Expo becomes a
  service provider for builds and OTA hosting; no tenant data passes through it (`07` § 9).
- The **reverse-domain app id** (`01` § 7) — permanent once published.

## 3. What Ships as a Store Binary

A store binary (a new `runtimeVersion`) is required for any change to:

- native modules or their versions, the Expo SDK, React Native;
- config plugins, permissions and their purpose strings, entitlements (associated domains, app-link
  hosts, passkey `webcredentials`), background modes, push capabilities;
- the embedded EAS Update code-signing certificate;
- the Android Network Security Config / iOS ATS settings (`07` § 7);
- the field database's **encryption** setup (SQLCipher parameters) — schema migrations in JavaScript
  may ship OTA (`04` § 11), the cipher may not.

Store binaries use **staged rollout**: Play staged rollout (10 % → 50 % → 100 %, halted on a crash-rate
or error-rate regression), App Store **phased release** (7 days, pausable). ABM Custom Apps and Managed
Google Play private apps update through the same store pipelines.

## 4. EAS Update (OTA) Policy

### 4.1 What may go over the air

JavaScript and assets **on the same runtime version** (the `runtimeVersion` policy is **`fingerprint`**:
any native change produces a new runtime, and an update built for another runtime is never offered).
Allowed: bug fixes, copy and translation fixes, UI changes within existing features, security fixes in
JavaScript, a feature behind an already-shipped flag. Not allowed: a change to the app's primary
purpose (Apple guideline 3.3.1(b)/2.5.2), anything listed in § 3.

### 4.2 How an update reaches a phone

- Checked **on launch** (`checkAutomatically: ON_LOAD`), downloaded in the background, **applied at
  the next cold start** — never mid-session and **never while a sync cycle runs** (`04` § 11).
- A **critical** update (a security fix) sets a flag the app reads: when the outbox is idle it shows
  "Restart to finish the update" and restarts on tap (`Updates.reloadAsync`); it never restarts by
  itself while a capture is open.
- **Rollouts:** EAS Update gradual rollout to 10 % → 50 % → 100 % per channel, watched for crash and
  error rates between steps.
- The binary always contains an **embedded** bundle; a failed or refused download leaves the phone on
  what it had — a phone offline for days keeps working on its current bundle.

### 4.3 Code signing (07 MT-04)

EAS Update **code signing** is enabled from the first binary. `expo-updates` embeds **one** code-signing
certificate per binary; updates are signed with the private key held **offline on a hardware key**, and a
publish needs **two people** (one builds the update, the other signs and publishes). An unsigned or
wrongly signed update is refused.

- **Rotation:** a new store binary (a new runtime) embeds the **new** certificate and receives updates
  signed with the new key; binaries of older runtimes **keep receiving updates signed with the old key**
  until `minimumSupported` (§ 5) has moved past them. Both keys are therefore live during a rotation, and
  the old key is destroyed only after the last runtime that trusts it is below the minimum.
- **Compromise:** publish a binary that trusts only a new key, raise `minimumSupported` above every
  binary that trusts the old one, and revoke sessions tenant-wide. **Residual (07 MT-04):** a 426 blocks
  only the API; malicious JavaScript already delivered runs as the app and can read the SQLCipher store
  and exfiltrate it. The offline hardware key and the two-person publish are the defences; the
  incident is handled as a breach (`07` § 9).

### 4.4 Rollback

| Situation | Action |
|---|---|
| A bad OTA update | `eas update:rollback` (or republish the previous update) on the channel — phones get it at their next launch; a rollback to the **embedded** bundle is also possible |
| A bad store binary | halt the staged rollout / phased release; publish a fixed binary; if the bad binary is out widely, an OTA fix on its runtime where the defect is in JavaScript |
| A bad binary that corrupts data or leaks | raise the minimum version (§ 5) so the server refuses it with 426 — the outbox is kept on the phone until the user updates |

## 5. Versions and Backend Compatibility

- **Marketing version** `MAJOR.MINOR.PATCH` (semver: MAJOR for a change that drops support for an older
  backend contract, MINOR for features, PATCH for fixes); **build number** auto-incremented by EAS;
  **runtime version** = the fingerprint; **update id** per OTA. Git tag `mobile-v<version>` on the
  commit that produced the binary.
- **Minimum-version policy** (server side in [`20`](./20-BACKEND-FOR-MOBILE-NODE.md), mirrored by the Go
  backend in [`21`](./21-BACKEND-FOR-MOBILE-GO.md)): the server holds `minimumSupported` and
  `recommended` per platform. Below `recommended` → a dismissible banner. Below `minimumSupported` →
  **426 `APP_UPDATE_REQUIRED`** on every API call except the version read and sign-out; the app shows a
  blocking "Update required" screen with the store link, **keeps the outbox**, and syncs after the
  update.
- **Contract compatibility promise:** a backend release must keep serving **every app version at or
  above `minimumSupported`**. In practice: routes and fields used by the app are changed only additively;
  a removal goes through a deprecation window of **at least 90 days** (store adoption lag) and a raised
  `minimumSupported`; the capture routes' request schemas also keep the 30-day outbox-age promise of
  P19-08 § 13. The `openapi:breaking` gate is run against the contract snapshot of the **oldest
  supported app version** as well as `main` (a card of the mobile phases adds the snapshot).
- **Support window:** the current and the previous MINOR are supported at least; `minimumSupported`
  rises only with a release note and, except for a security fix, after 30 days' notice in the app.
- **Two backends** (ADR-089): a deployment runs one backend; the policy is the same on both, and the
  conformance suite (`docs/CONTRACT/06`) proves every module the app uses on every engine at 100%, so an
  app version supported on the Node backend is supported on the Go backend of the same release.

## 6. Which Server the App Talks To

- A production binary is built with the **production platform host(s)** — the hosts whose
  `.well-known` files list the app (`05` § 5): app links, passkeys and SSO returns work only there.
- **Self-hosted or reference deployments** (e.g. the reference VM, memory `vm-deployment`): a host
  chosen on the first-launch **server screen** (https only, its name shown and confirmed, `07` MT-15),
  scanned from an **enrolment QR** shown by the deployment's web app (a plain `{ host }` document — **not
  signed**: there is no trust anchor a fresh install could verify a signature against, so the protection
  is the **https-only rule and the user's confirmation of the host's name** (MT-15); a
  printed QR cannot point the app elsewhere unnoticed), or set by **MDM managed configuration**
  (`serverHost`, which also hides the screen). On such a host, password + MFA sign-in works; app links,
  native passkeys and the SSO app-link return work only if the host is in the binary's entitlements.
  **Order on first run:** the server screen (only when no server is compiled in or set by MDM) comes
  **before** tenant setup (`11` § 2), because the tenant lookup runs on the chosen server.
- **Owner, 2026-10-08 (Q-M2):** the `production` binary compiles in the **production domain(s) only**;
  the reference VM host is compiled into the **`preview`/UAT** binary only.
- **Tenants do not change the build** (owner, 2026-10-08): one binary for every tenant; tenant
  branding is applied at run time after tenant setup (`11`); the launcher icon and the native splash
  stay Callibrator. No white-label builds.

## 7. MDM Considerations

| Topic | Android (Android Enterprise / Managed Google Play) | iOS (ABM + MDM) |
|---|---|---|
| Install | pushed by the EMM from the managed Play store (private app) | assigned through ABM (Custom App), installed silently by MDM on supervised devices |
| Configuration | **managed configurations** (`serverHost`, `tenantCode`, `requireBiometricUnlock`, `offlineModeAllowed` — `07` § 8) declared in the app's restrictions schema (config plugin) | **managed app configuration** (`com.apple.configuration.managed`) with the same keys |
| Work profile / per-app data separation | supported: the app lives in the work profile; its data is wiped when the profile is | managed app data is removed when the app is unmanaged; "managed open-in" can stop documents leaving to unmanaged apps |
| Battery optimisation | the EMM can exempt the app (background sync, `04` § 6) | not applicable |
| Shared devices | Android Enterprise dedicated / multi-user setups where the OEM supports them | **Shared iPad** with Managed Apple Accounts — real per-user partitions (`04` § 10.4) |
| Removal / wipe | removes the app and its data — **unsynced captures are lost**; the MDM runbook (a card) asks the user to sync first and the administrator to check the outbox count in the app before removal | the same |
| What MDM cannot do | grant access, choose a tenant, bypass a server gate — configuration narrows, the server decides | the same |

## 8. Release Procedure (the mobile Definition of Done adds to the global one)

1. The release card names the version, the runtime, the backend versions it is tested against (Node,
   and Go for any module the gateway routes to it — `docs/CONTRACT/07`), and the contract snapshot it was checked with.
2. `09`'s gates green: unit + component at the coverage floor, Maestro E2E on both platforms against a
   running stack (emulator/simulator), the offline suite, and the real-device script on the **devices
   available** — at least one physical Android phone and, for an iOS release, one physical iPhone,
   personal devices allowed (named run in `MEMORY/records/`, devices listed; the record states what
   the missing lab could not prove).
3. Store metadata in **Indonesian and English**; the App Store privacy label and the Play Data safety
   form filled from `07` § 9; the DPIA addendum's status named.
4. `.well-known` files deployed and verified on every host compiled into the binary.
4a. The reviewer tenant of § 2.2a provisioned, its credentials in the review notes, synthetic data only.
5. Staged rollout / phased release started; OTA updates on the new runtime enabled after the binary
   reaches 100 %.
6. `MEMORY/records/<date>-mobile-<version>.md`, a `MEMORY/CHANGELOG.md` entry, `TASKS/PROGRESS.md` row —
   in the same commit as the release card's state change.

## 9. Owner Questions (carried in ADR-135)

| # | Question | Recommendation |
|---|---|---|
| Q-M1 | The organisation identity for both stores (legal name, D-U-N-S) and the reverse-domain app id | the owner's company domain, reversed; one id family for all variants (`.dev`, `.preview` suffixes) |
| Q-M2 | hosts in the production binary | **answered 2026-10-08:** production domain(s) only; the VM host in preview/UAT only |
| Q-M3 | Android fallback channel | **answered 2026-10-08:** restricted public Play listing (Indonesia, invitation-only sign-in); Managed Google Play for Android Enterprise customers |
| Q-M4 | EAS plan and device lab | **answered 2026-10-08: no budget for now** — free EAS tier + local builds, emulators/simulators/personal devices; the 4-device lab a recommended pre-production item, decided later |
