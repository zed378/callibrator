# 07 — Security and Privacy of the Native App (TARGET)

> **TARGET — nothing here is built.** Source threat model: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md`
> (BF-3 phone ↔ application, BF-4 then ↔ now; EP-19 the PWA at rest; EP-20 sync — FT-83 … FT-96;
> AM-1, AM-23 … AM-26). Data protection: `docs/UPSTREAM/06-DPIA.md` (UU PDP, R-04, R-12, § 8 breach).
> Multi-tenancy: `docs/SECURITY/05` (mandatory). This document maps those rows to the native app and
> adds the rows a native client brings; it does not re-open any server decision. A security review of
> the built app (the P17-07 pattern) is a card of the mobile phases, not this document.

---

## 1. The Boundary

The phone is **outside our infrastructure** (BF-3). Nothing on it is trusted by the server: not the
user id, not the tenant, not the facility, not the clock, not the app version, not a claim that a photo
was stripped. Everything that matters is decided server-side on every request (`docs/SECURITY/05`,
ADR-124 § 5). The app's job is to **hold as little as possible, for as short as possible, encrypted,
and to forget it on the signals the server sends**.

## 2. Threat Rows Mapped to the Native App

### 2.1 From `docs/SECURITY/15` (PWA rows, native form)

| Row | Threat | Native control | Residual |
|---|---|---|---|
| FT-84 | tenant data in a second, weaker store | no persisted query cache; no tenant data in MMKV/AsyncStorage/files; lint rule (`01` § 3, `04` § 4.1) | — |
| FT-85 | lost or stolen phone | screen lock **required** for offline mode (`04` § 3); SQLCipher + `THIS_DEVICE_ONLY` key; 72 h purge; revocation → purge at next contact, **including background contact** and a `scope_check` push (`04` § 8); app lock after 5 min (`06` § 5) | the working set (≤ 3 facilities, ≤ the cap) and the outbox are readable by whoever holds the **unlocked** phone within 72 h — accepted (ADR-127), unchanged |
| FT-86 | shared phone: per-user DB is not a boundary | one field user per install (`04` § 10); another user's sign-in purges others' working sets; audited admin wipe | code running as the app on an unlocked, compromised phone can use any user's key — accepted; platform multi-user partitions recommended for shared tablets (`04` § 10.4) |
| FT-87 | clock rollback | server `Date` purge at every online response (AM-24) | an offline-only phone with a rolled-back clock — accepted |
| FT-88 | script injection reads the store | no WebView, no `eval`, no remote code except signed OTA (§ 6); React escapes | — |
| FT-89 | replayed nonce | **not applicable** — no service worker, no CSP in a native app | — |
| FT-90 | working set includes another facility | the server's hooked, marked `view=field` read (G-22) | — |
| FT-91 … FT-93 | attribution from payload; replay across a scope change; a moved device | the same server contract (P19-02 § 9, AM-25); 404 → attention (`04` § 7) | — |
| FT-94 | outbox floods | per-capture queue; 300-photo cap; storage floor; backoff | — |
| FT-95, FT-96 | stale grant after deactivation or a move | purge on failed refresh, on `SCOPE_LOSS_CODES`, on a changed scope fingerprint (AM-1, AM-26) | — |
| FT-83 | offline attribution on a shared unlocked phone | `captured_offline` in the trail; one field user per install; app lock | accepted (ADR-127) |

### 2.2 Rows a native client adds (numbered here; to be merged into `docs/SECURITY/15` by the mobile
security-review card — this document does not edit `15`, which has its own author)

| Row | Threat | Control | Residual |
|---|---|---|---|
| MT-01 | **Secrets in the bundle** — an API key, a signing key or a backend secret shipped in JavaScript or `app.config` | nothing secret is ever in the app: every value in a binary or an OTA bundle is public (`01` § 7); FCM/APNs/EAS-signing keys live server-side or in EAS secrets; a CI secret scan (gitleaks, as for the repository) runs over `apps/mobile` and the built bundle | — |
| MT-02 | **Token theft** from the Keychain/Keystore on a rooted/jailbroken phone or by malware | `THIS_DEVICE_ONLY` items; refresh rotation with reuse detection (server, [`20`](./20-BACKEND-FOR-MOBILE-NODE.md)); short access tokens; sessions visible and revocable; offline mode refused on detected root (§ 3) | a determined attacker on a rooted phone can copy a live refresh token and use it until rotation/reuse detection or revocation — accepted; sender-constrained tokens (DPoP) are a later option (ADR-135) |
| MT-03 | **Link hijack** — another app claims our scheme and receives an SSO code or a verify link | verified HTTPS app links for anything carrying a code (`05` § 5), except the owner-decided iOS 16 – 17.3 SSO callback: a **private reverse-domain scheme used only as the `ASWebAuthenticationSession` callback** (RFC 8252 § 7.1), which the session delivers only to the app that started it; PKCE makes an intercepted SSO code useless (`06` § 3, § 3.1); `state` checked | on iOS 16 – 17.3 another app registering the same private scheme could receive a URL outside the auth session — it still lacks the verifier (accepted; removed if the iOS floor rises to 17.4) |
| MT-04 | **Tampered OTA update** delivered by a compromised update server or a man in the middle | EAS Update **code signing**: the app embeds our certificate and refuses an unsigned or wrongly signed update; the private key is held **offline on a hardware key**, and a publish needs **two people** (one builds, one signs); `08` § 4.3 | **a stolen signing key**: until a new binary that trusts a new key is installed, the attacker's JavaScript runs **as the app** — it can open the SQLCipher store with the Keychain/Keystore key and exfiltrate the working set and outbox; a raised `minimumSupported` (426) blocks only the API, not the malicious code already on the phone. Accepted with the defences above; the incident runbook revokes sessions tenant-wide and treats every install as compromised (`07` § 9 breach) |
| MT-05 | **Personal data in a push** read on a lock screen or by Google/Apple | the payload rule of `05` § 3.2 — opaque id + category only; content fetched after unlock | push metadata (that a notification exists, its time) is visible to the platform — accepted |
| MT-06 | **Screenshots / screen recording / app switcher** expose tenant data or secrets | § 5 | an iOS user can still photograph the screen with another device — accepted |
| MT-07 | **Logs and crash reports** carry tenant data | production builds strip `console.*` (Babel plugin); the logger's scrubber; the crash-report rules of `01` § 5 | — |
| MT-08 | **Clipboard** leaks a value to other apps | the app never writes to the clipboard on its own; a user-initiated "Copy" exists only for a serial, a QR code and a report number, and the MFA setup key (the only secret, cleared from the clipboard after 60 s where the platform allows and marked sensitive on Android 13+) | — |
| MT-09 | **Keyboard caches / autofill** learn sensitive values | `secureTextEntry` and `autoCorrect={false}` on credentials; `importantForAutofill="no"` on free-text fields that may hold patient-area notes; password fields keep autofill for password managers | — |
| MT-10 | **Third-party SDKs** exfiltrate data | **no analytics, advertising or attribution SDK**; the dependency list is reviewed at each card; **no crash reporter** (owner, 2026-10-08 — Q-M5); scrubbed app logs go to our own backend (`01` § 5) | — |
| MT-11 | **An old app version** with a known defect keeps working | the minimum-version policy (426 `APP_UPDATE_REQUIRED`, `08` § 5) and the OTA channel for JavaScript fixes | — |
| MT-12 | **Backups** carry the database to iCloud/Google | excluded from backups; the key is `THIS_DEVICE_ONLY` (`04` § 4.3) | — |
| MT-13 | **Reinstall inherits Keychain items** (iOS) | the fresh-install wipe of every app-owned SecureStore item (`04` § 4.3) | — |
| MT-14 | **A malicious scanned QR** opens an arbitrary URL or a phishing page | the scanner opens only this deployment's verification URLs and device codes; any other text is shown, never opened (`05` § 2) | — |
| MT-15 | **Server impersonation** on a self-hosted deployment (a user is told to point the app at a hostile host) | the server screen accepts **https only**, shows the host's name and asks for confirmation; MDM can pin the host (`08` § 6); passkeys and app links work only for build-time hosts, so a hostile host cannot obtain them | a user who confirms a hostile host and types their password there — the same as a phishing page; mitigated by SSO/passkeys |
| MT-16 | **A hostile setup link or QR** points the user at another tenant's sign-in (or a look-alike) | the link only pre-fills a code; the resolved tenant **name and logo are confirmed** by the user; branding is untrusted input (raster logo in a fixed box, name as text, colour through the AA guard); the tenant header is a hint the server ignores for authorisation; the token's tenant is authoritative and a mismatch signs out (`11` § 8) | a user who confirms the wrong organisation and types their password — the server refuses an account of another tenant with the generic answer |

## 3. Rooted and Jailbroken Devices — the Stance

**Decision: detect, warn, and refuse offline mode; do not block online use by default.**

| Option | Why (not) |
|---|---|
| Ignore | a rooted phone defeats the Keychain/Keystore assumptions behind data at rest; holding a working set there is not defensible |
| **Detect → refuse offline mode, warn, report** (chosen) | the at-rest exposure (the reason detection matters) is removed; online use keeps working — the server's controls are the same for every client; detection is a signal sent in the session's metadata for the administrator's session list |
| Block the app entirely | detection is bypassable by anyone determined (so it stops only honest users), has false positives on custom ROMs and some OEM builds, and would lock a technician out of reading their own work |

- **Android:** the **Play Integrity API device-integrity verdict**, verified **server-side**
  ([`20`](./20-BACKEND-FOR-MOBILE-NODE.md) § 9a) at offline-mode enablement and periodically — a failed
  `MEETS_DEVICE_INTEGRITY` refuses offline mode.
- **iOS:** **App Attest proves app integrity** (a genuine, unmodified build of our app on a genuine
  Apple device) — it gives **no jailbreak verdict**: the server's best iOS verdict is `app_ok`, never
  `ok` (`20` § 9a; the residual is recorded in ADR-134). Jailbreak detection on iOS is therefore a **local
  heuristic** (a maintained module chosen under the package rule), **advisory only** — sent to the server as
  `jailbreak_claim`: a positive result refuses offline mode, but a jailbroken phone that hides itself passes. **Residual recorded:** on iOS
  the at-rest protection of a jailbroken phone that defeats the heuristic is not guaranteed; App Attest
  still stops a modified or re-signed app from getting a session where the server requires it.
- A tenant policy "block compromised devices entirely" is a **later** option (a server setting), not in
  the first release.

## 4. Data at Rest — Summary

| Data | Where | Protection | Lifetime |
|---|---|---|---|
| access token | memory | process isolation | minutes |
| refresh token, device session id | SecureStore | Keychain / Keystore, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` | until rotation, logout, revocation |
| field database key (per user) | SecureStore | the same | until logout / offline off / wipe |
| working set, rooms, checklist copy | SQLCipher database | AES-256 (SQLCipher) under the key above | ≤ 72 h after the last sync; purge rules (`04` § 8) |
| outbox (captures, frozen ops, photos) | the same database | the same | until synced, discarded (confirmed), wiped |
| registry (ids, counts, timestamps), preferences | MMKV | none needed (no tenant value by rule) | app lifetime |
| on-screen data of online screens | memory (query cache) | process isolation | the session; cleared on sign-out and lock-screen timeout of the cache |

**The honest consequence of `AFTER_FIRST_UNLOCK`** (chosen for background sync, `04` § 4.2): on an
iPhone that was unlocked once since boot and is then seized while powered on, the key is reachable to
code that runs **as the app**; an attacker without such code execution still faces SQLCipher and the
iOS data protection of the file. A phone powered off, or rebooted and never unlocked, holds nothing
usable.

## 5. Screenshots, Recording and the App Switcher

| Surface | Android | iOS |
|---|---|---|
| **Every screen** — the app-switcher snapshot | Android captures the recents thumbnail at `onPause`, before JavaScript can draw an overlay, so a JS overlay is **unreliable**. On **API 33+** the in-house module calls **`Activity.setRecentsScreenshotEnabled(false)`** (no thumbnail, screenshots still allowed); on **API 29 – 32** the residual is accepted (the thumbnail may show the last screen), or a tenant that requires it gets `FLAG_SECURE` on all screens (the later policy below) | a privacy overlay (brand mark on the page colour) is drawn when the app resigns active, so the switcher snapshot shows no data |
| **Secrets** — MFA setup key and QR, recovery codes, the passkey management list, the signature dialog, the server-confirmation screen | `FLAG_SECURE` on those screens (`expo-screen-capture` per screen): no screenshot, no recording, blank in recents | screen recording / mirroring is detected (`UIScreen.isCaptured` through `expo-screen-capture`) and the secret is hidden while captured; a screenshot is detected and a warning shown — iOS cannot prevent screenshots |
| **Tenant data screens** — devices, IPM, reports, dashboards | allowed (operational need), **tenant policy** to apply `FLAG_SECURE` everywhere (a server setting read at sign-in — later option, not first release) | allowed; the same later policy hides content during recording |

Rationale for not blocking screenshots of tenant data by default: technicians and facility staff share
screenshots with their provider to report problems; blocking them pushes people to photograph the
screen with another phone — which leaves a copy no policy reaches. The secrets above have no such need.

## 6. Code Integrity and Updates

- Store binaries are signed by the platform (Play App Signing; App Store / ABM); EAS Build holds the
  upload credentials ([`08`](./08-DISTRIBUTION-AND-RELEASES.md) § 3).
- **OTA updates are code-signed** (MT-04) and limited to JavaScript and assets on the same runtime
  version; they never change permissions, entitlements or native modules (`08` § 4).
- **No dynamic code** beyond the signed OTA bundle: no `eval`, no remote JavaScript, no WebView loading
  remote content in the app (the only browser use is the system browser for SSO and "open on the web").

## 7. Certificate Pinning — Not Used (decided)

**Decision: no certificate or public-key pinning in the first release.** The app relies on the
platform's TLS validation, **iOS App Transport Security** (HTTPS only, no exceptions) and the **Android
Network Security Config** (cleartext disallowed; user-installed CAs **not** trusted — the default for
apps targeting API 24+, restated in the config plugin so it cannot drift).

| Why not pin | |
|---|---|
| The reference deployment terminates TLS at **Cloudflare's edge** (`docs/UPSTREAM/06-DPIA.md` § 2.4; memory `vm-deployment`); the edge certificate and its chain rotate on Cloudflare's schedule, not ours | a pin on the leaf or intermediate breaks every installed app on the edge's next rotation; only a store binary can fix a native pin |
| **Self-hosted deployments** (`08` § 6) each have their own certificates | one binary cannot carry every deployment's pins; per-deployment pins would need per-deployment builds |
| What pinning buys here | protection against a mis-issued public certificate or a user-trusted interception CA — the latter already excluded by the Network Security Config and ATS; a corporate TLS-inspecting proxy on a hospital network would **break** pinned apps, which is an availability risk in exactly our users' networks |

**Revisit when:** a customer's security policy requires pinning, or the deployment controls its own
certificate end to end. Then: pin the **SPKI of two keys** (current + backup) of our own issuing key,
with a pin-expiry date and a server-side kill switch, delivered in a store binary — never by OTA.

## 8. MDM (Mobile Device Management)

The app works **without** MDM. With a customer's MDM (Android Enterprise / Managed Google Play; Apple
Business Manager + any MDM) the following are supported (details and the channel choice in `08` § 7):

- **Managed app configuration** (Android managed configurations; iOS `com.apple.configuration.managed`):
  `serverHost` (pins the server, hides the server screen), `tenantCode` (resolves and **locks** the tenant — the setup screen is skipped and "Change
  organisation" is absent, `11` § 6), `requireBiometricUnlock` (true/false), `offlineModeAllowed` (an MDM can **narrow** — turn
  offline off — never widen what the server allows). Read by a small in-house Expo module (config
  plugin), validated, never trusted for authorisation.
- MDM policies the field guide recommends: a device passcode, OS updates, no USB debugging, battery
  optimisation exemption for the app (`04` § 6), and **"sync before removal"** — removing the managed
  app destroys unsynced captures.
- MDM app removal or device wipe is a legitimate remote wipe of the app's data at rest; it is not a
  substitute for revoking the user's sessions (which the tenant administrator does in the web app).

## 9. Privacy — UU PDP and the DPIA

The native app changes the processing the DPIA (`docs/UPSTREAM/06-DPIA.md`) assessed: tenant data
(including incidental personal data in photos, R-12) rests on more phones, for longer, with background
activity. Before any production release the mobile phases carry a **DPIA addendum** (a card; the
privacy work owns it, `docs/UPSTREAM/06` § 9 and counsel's review ⚖) covering:

| Item | Position |
|---|---|
| **Data on phones** | only the field working set (≤ 72 h) and the outbox, encrypted; facility staff, IPSRS and managers hold nothing at rest |
| **Sub-processors** | Apple (APNs, App Store / TestFlight / ABM), Google (FCM, Play) for delivery — content-free payloads (§ 2.2 MT-05); Expo/EAS for **builds and OTA hosting** (it hosts the app's code, not tenant data — no tenant data passes through EAS); **no crash reporter** (owner, 2026-10-08 — Q-M5: app logs go to our own backend, no new sub-processor) |
| **Cross-border transfer** (UU PDP Art. 56 as read) | push metadata via Google/Apple; no tenant content leaves through the app's own channels other than the API the web already uses |
| **Data-subject rights** | an erasure or restriction that deactivates an account revokes its sessions → the phone purges at next contact (AM-1); a GDPR/UU PDP export is produced by the server (ADR-114) and is not offered from the app |
| **Breach** | a **lost or stolen phone** holding an unsynced outbox or a working set is assessed as a possible personal-data breach: the user reports to the tenant administrator **at once**; the administrator revokes the user's sessions and records the incident; the 3 × 24 h notice duty (UU PDP Art. 46 as read, `docs/SECURITY/12-INCIDENT-RESPONSE.md`) is assessed per facility from what the working set could hold (`audit_logs.client_facility_id` scopes it, ADR-124 § 9). The field guide (P29-01 pattern) says this in Indonesian |
| **Minimisation** | the `view=field` projection (no registrant, vendor, notes, documents, photos of other devices); no location permission; no contacts, no microphone; camera only |
| **Transparency** | the app's privacy screen links the deployment's privacy notice (`PRIVACY_NOTICE_URL`, ADR-113); the store listing's privacy labels (App Store privacy "nutrition label", Play Data safety) are filled from this document by the release card |
