# 04 — Offline Field Capture, Native (TARGET)

> **TARGET — nothing here is built.** This is the **native variant of
> `MEMORY/specs/P19-08-offline-field-capture.md`** (the PWA spec, ADR-127 + Am. 1). Everything the
> server does — idempotency, `client_ref`, the `view=field` working-set read, scope fingerprints,
> scope-loss codes, the field wipe route, 409 codes — is **the same contract** and is not restated
> here; read P19-08 § 7.2, § 9 and § 9.5. This document decides only what is different on a native
> app: where data rests, how keys are held, how sync is scheduled, and how a phone shared between
> people behaves. Threat rows: `docs/SECURITY/15` EP-19, EP-20 (FT-83 … FT-96), mapped in `07`.

---

## 1. Scope — Unchanged From ADR-127 § 1

Offline is a mode of **field capture only**: the QR lookup, device registration with photos, and IPM
capture (drafts and submit). Every other screen is online-only and says so when offline. Offline mode
is **opt-in per phone** ("Prepare this phone for offline work"), and only a user whose effective
permission includes `ipm` write (unbound `TECHNICIAN`, bound `HEALTHCARE TECHNICIAN`) is offered it.
Facility staff, IPSRS and managers never hold tenant data at rest on the phone.

## 2. What Is Shared With the PWA, and What Is Not

| Concern | PWA (P19-08) | Native app (this document) |
|---|---|---|
| Server contract (reads, writes, codes, idempotency, `client_ref`) | P19-08 § 7.2, § 9.5 | **identical** |
| Sync planner / runner, conflict mapping | `sync-engine` | **the same package** (`docs/SHARED/`), with a native storage adapter and scheduler adapter |
| Validation, QR normalisation, due, report preview | contracts / `domain` | **the same functions** |
| Where data rests | IndexedDB, per-record AES-GCM with a non-extractable WebCrypto key | **SQLCipher** database per user and tenant; key in the **Keychain / Keystore** (§ 4) |
| Lookups over encrypted data | encrypted pages decrypted into memory; no plaintext index (G-O12) | ordinary indexes **inside** the encrypted database (the whole file is encrypted, so an index leaks nothing a page would not) |
| App shell offline | a service worker under the nonce CSP, a replayed nonce (FT-89) | **none needed** — the code is in the binary/OTA bundle; no CSP, no nonce exception |
| Background sync | Chromium Background Sync; none on iOS | WorkManager (Android), BGTaskScheduler (iOS), both best-effort (§ 6) |
| Camera / QR | `<input capture>`, `getUserMedia` + `BarcodeDetector` / JS decoder | `expo-camera` in-app capture and its built-in QR scanner (`05`) |
| Shared phone boundary | one field user per **browser profile** (AM-23) | one field user per **app install** (§ 10) |
| Exporting a refused capture | "keep for an administrator" exports the preview PDF | **no export** — the capture stays, encrypted, in "needs attention" (§ 7.3) |

## 3. Enabling Offline Mode

The Settings → Offline screen:

1. **Pre-checks**, each named if it fails: secure storage available; device lock (passcode/biometric)
   set — **offline mode is refused on a phone without a screen lock** (`expo-local-authentication`
   `getEnrolledLevelAsync` ≥ secret; the field guide P29-01 already requires a lock, the app now
   checks it); not rooted/jailbroken (`07` § 3); free storage ≥ 500 MB; server flag
   `mobile.offline.enabled`.
2. **Facilities**: an unbound technician picks up to **3** facilities (the P19-08 recommendation; a
   larger number raises a lost phone's exposure); a bound technician gets its own facility only.
3. **The size before the download**: `meta.total` of the `view=field` read per facility, refused
   above the tenant cap (`field.workingSetMaxDevices`, default 2,000, P19-08 § 7.2) with "choose
   rooms" as the narrowing.
4. **Download**: `POST /auth/verify` (scope fingerprint) → the working set pages → rooms → the
   published checklist (`If-None-Match`) → the caller's open drafts → tenant settings needed offline.
   Photos and documents of devices are **never** downloaded.
5. "Ready for offline work" only when every step succeeded; a partial download is rolled back.

## 4. Where Data Rests

### 4.1 Stores

| Store | Technology | Holds | Encrypted by |
|---|---|---|---|
| **Field database** — one per user and tenant: `field-<tenantId>-<userId>.db` | `expo-sqlite` built with **SQLCipher** (the module's SQLCipher option, set by its config plugin) | `meta` (scope fingerprint, last sync by server time and device time, facilities, the tenant settings needed offline, the user's display name and `bound` flag), `catalogue` (the published document + ETag), `devices` (`fieldDeviceSummary` rows) with indexes on QR, name, room, facility, `rooms`, `captures`, `ops` (frozen requests), `photos` (re-encoded JPEG bytes as blobs, § 5) | SQLCipher (AES-256, per-page HMAC) with the key of § 4.2 |
| **Registry** — one per install | **MMKV** (unencrypted) | per user: `{ key: "<tenantId>:<userId>", outboxCount, workingSetPresent, lastSyncServerAt }` — **ids, counts and timestamps only**, no name, no tenant value (as P19-08's registry); the "fresh install" marker (§ 4.3) | nothing to protect by design |
| **Preferences** | MMKV | theme, language, last tab, "upload photos on mobile data" | — |
| **Secrets** | `expo-secure-store` (Keychain on iOS; Android Keystore-wrapped) | the field database key per user (`field-key-<tenantId>-<userId>`); the refresh token and device session id (`06` § 6) | the platform |

**Forbidden at rest:** tenant data in MMKV, AsyncStorage, plain files, the query cache, logs or crash
reports; any photo in the photo library; any decrypted export — **except** the short-lived share file of
an issued report (§ 7.3), deleted on the share callback and at launch. A lint rule refuses `AsyncStorage` and
`expo-file-system` writes outside the photo pipeline's temporary directory (§ 5), which the pipeline
empties itself.

### 4.2 The key

- 256 random bits from the platform CSPRNG (`expo-crypto`), generated when offline mode is enabled,
  stored in SecureStore, **never** shown, exported, logged or derived from the password (no PIN, no
  password-derived key — ADR-127's reasons hold: a PIN adds a credential and protects little on an
  unlocked phone; a password-derived key needs the password offline).
- **Accessibility class: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`** (iOS) — the key is not in iCloud or
  device backups and does not migrate to a new phone; it is readable after the first unlock since
  boot, so **background sync can open the database while the phone is locked in a pocket** (§ 6).
  The stricter `WHEN_UNLOCKED_THIS_DEVICE_ONLY` was rejected: it would disable background sync for
  exactly the case it exists for (ADR-135 alternatives). The consequence is stated in `07` § 4: a
  phone seized while powered on and once unlocked keeps the key reachable to code running as the app.
- Android: SecureStore wraps the value with an Android Keystore key (hardware-backed where the phone
  has a TEE/StrongBox); `requireAuthentication` is **off** for this item for the same reason as above.
- Biometric re-unlock (`06` § 5) is a **UI lock** over the app; it does not gate the key. That is
  stated, not hidden: the protection of data at rest is SQLCipher + the platform keystore + the device
  lock; the app lock protects against a colleague picking up an unlocked phone.

### 4.3 What survives what

| Event | Effect |
|---|---|
| App uninstalled (Android) | sandbox and Keystore entries deleted by the OS |
| App uninstalled (**iOS**) | sandbox deleted, but **Keychain items can survive** uninstall. On the first launch after an install (no MMKV install marker), the app **deletes every SecureStore item it owns** before anything else — a reinstalled app never inherits a refresh token or a key |
| Device backup (iCloud / Google) | the field database and MMKV registry are **excluded**. On iOS `NSURLIsExcludedFromBackupKey` is a **runtime file attribute**, not something a config plugin can set: the in-house module sets it on the database file (and its `-wal`/`-shm` siblings) **right after creation and at every launch**, with a test that reads the attribute back; the database lives in Application Support, **never in `Caches`** (which the OS may purge). On Android `allowBackup="false"` and data-extraction rules excluding everything (a config plugin); even if copied, the database is useless without the `…THIS_DEVICE_ONLY` key |
| Moving to a new phone | nothing moves; the user signs in and syncs; an unsynced outbox on the old phone stays there (the field guide says: sync before you change phones) |
| OS-level "clear app data" / MDM app removal | everything deleted, outbox included — the field guide and the MDM runbook (`08` § 7) warn that this destroys unsynced captures |

## 5. Photos at Rest

The pipeline (`05` § 1) produces a re-encoded JPEG (≤ 2048 px, quality 0.8, no EXIF) from an in-app
capture. The JPEG's bytes are written **into the field database** (`photos` blob) and the temporary
file is deleted in the same step; a crash between the two leaves a file in the app's cache directory
that the next launch deletes before anything else. Storing the bytes in SQLCipher keeps **one
encryption rule** for everything at rest; the cost (a larger database, `VACUUM` after uploads) is
accepted and bounded:

- at most **300 photos** (≈ 450 MB) waiting at once; capture refuses a new photo beyond it, or below
  500 MB free storage, with "Sync, or free space" (ADR-127's "never fail mid-write");
- uploaded photos are deleted from the database when their op is `done`; `VACUUM` runs at the next
  foreground idle moment.

## 6. Sync Scheduling and the OS Limits

The engine is the shared `sync-engine` (P19-08 § 9: the local capture is the source of truth; ops are
**planned** from the difference with the server-confirmed state and **frozen** — key and body — before
the first attempt; retries are identical; one capture's ops in order, two captures in parallel). The
app supplies when it runs:

| Trigger | Android | iOS |
|---|---|---|
| app start, return to foreground (`AppState` → active) | yes | yes |
| connectivity regained (`@react-native-community/netinfo`) while in foreground | yes | yes |
| "Sync now" | yes | yes |
| **periodic background task** (`expo-background-task`) | **WorkManager**, requested every 15 min (the platform minimum) with a network constraint; deferred by **Doze** and **App Standby Buckets**; on many OEM builds common in Indonesia (Xiaomi HyperOS/MIUI, Oppo ColorOS, Vivo, realme, Samsung "sleeping apps") **killed or never run** unless the app is exempted from battery optimisation | **BGTaskScheduler**, **opportunistic**: the system decides when (often hours, typically overnight on charge); **never** after the user force-quits the app from the switcher; off when Background App Refresh or Low Power Mode is off. **To verify at the card:** our reading is that `expo-background-task` schedules a **`BGProcessingTask`** (not an app-refresh task) — which, if confirmed, means a longer budget than app refresh's ~30 s but runs that favour idle-and-charging, and `Info.plist` needs `UIBackgroundModes: processing` plus the task identifier in `BGTaskSchedulerPermittedIdentifiers`. The card confirms the task type, budget and keys against the installed version and records them; the rules of § 6.1 are written to hold for either budget |
| background **photo uploads** after the app is suspended | not used (§ 6.1) | not used (§ 6.1) |

### 6.1 Rules that follow from those limits

- **Foreground sync is the path; background sync is a bonus.** The Home screen shows the outbox count,
  the age of the oldest unsynced item and "Last synced <server time>" on every screen's header while
  offline mode is on; a banner appears when the oldest item is older than **4 hours**: "Open the app
  with a connection to sync". The field guide (P29-01) says so in Indonesian.
- A background run does only what fits its budget (whatever the card confirms; the engine checks the
  remaining time before each op): it runs `POST /auth/verify`, then small ops
  (create, PATCH header, PUT results, submit) of the oldest capture, then **one** photo if time remains,
  and stops cleanly before the budget ends (a frozen op interrupted mid-flight is retried identically
  next time — the idempotency key makes it safe).
- **No OS-level background upload session** (iOS `URLSession` background uploads, Android upload
  services) is used: those need the photo **decrypted into a plain file** that outlives the app's
  control, and carry a bearer token in the OS's queue. Rejected (ADR-135 alternatives).
- **Battery-optimisation exemption** is requested only on Android and only after the user enables
  offline mode, with a screen that explains why and links to the OEM's setting where known; it is
  never a condition of offline mode. Under MDM, the exemption is set by policy (`08` § 7).
- **Mobile data:** photos upload on mobile data by default (technicians need the sync more than the
  data cost); a setting "Upload photos only on Wi-Fi" defers photo ops, never the small ops.
- Background tasks require the server flag `mobile.backgroundSync.enabled`; the kill switch turns them
  off without touching the outbox.

## 7. Conflicts — the Native UX

The **codes and meanings are P19-08 § 9.6, unchanged** (`IPM_DRAFT_EXISTS`, `IPM_REVISION_CONFLICT`,
`IPM_DEVICE_RETIRED`, `IPM_FACILITY_ENDED`, `IDEMPOTENCY_SCOPE_CHANGED`, 404 "no longer in your
access", 400 missing items, 413/415 on a photo …); the explanations live in the shared `i18n` package
under `field.conflicts.*` so the PWA and the app say the same thing in Indonesian and English.

### 7.1 Where the technician meets a conflict

- A capture whose op was refused moves to **Needs attention**; its queue stops; other captures carry on.
- The Outbox tab/badge shows "N need attention" in the attention tone (ADR-122: `triangle-alert` icon +
  text, not colour alone); a local notification (no push, no server involvement) is posted once per
  capture if the app is in the background: "1 capture needs your attention" — **no device or facility
  name in the notification** (`05` § 3's rule applies to local notifications too).
- Opening it shows a **bottom sheet** (phone) or the detail pane (tablet): the server's explanation, the
  localised explanation keyed by `data.code`, and the actions of P19-08 § 9.6 as buttons named after
  their object ("Use the draft on the server", "Keep this phone's version", "Discard this capture").

### 7.2 Destructive actions

"Discard" asks for a typed confirmation when the capture holds results or photos ("Type HAPUS to
discard 1 capture with 3 photos" — the word is localised; Indonesian first). Nothing is dropped without
a confirmed action — the engine never discards on its own.

### 7.3 "Keep for an administrator" without an export

The PWA exports the preview PDF so the work is not lost when the server refuses it. The app does
**not** export a **draft** out of its encrypted store: a share-sheet PDF would put tenant data into another
app's storage, outside every purge rule. Instead the capture stays in "Needs attention" (encrypted,
viewable as the watermarked preview), and an unbound tenant administrator resolves it — on the server
(e.g. un-retiring a device), after which "Retry" succeeds, or by re-entering it on the web from the
preview shown on the phone. A capture kept like this is purged only by a confirmed discard, the
administrator wipe (§ 10.3), or uninstall.

**The one plaintext exception — sharing an issued report** (§ 9): to share an **issued** report PDF
through the OS share sheet, the app writes it to a **temporary plaintext file** in the cache directory,
hands it to the share sheet, and **deletes it in the share callback** (completed or cancelled); any
left-over share file is deleted **at the next launch** before anything else. Nothing else is ever
written in plaintext. Whether the PDF primitives run under Hermes (jsPDF) is an **open feasibility
item** (P37-01); until it is proved, sharing a PDF is not offered.

## 8. Purge Rules

"Purge" = delete the working set, rooms and catalogue tables and the in-memory copy, and set the
registry's `workingSetPresent = false`. **The outbox (`captures`, `ops`, `photos`) is never purged by
these rules** — only by a successful sync, a confirmed discard, the administrator wipe, or the OS
deleting the app's data.

| Trigger | Rule (P19-08 § 10, native form) |
|---|---|
| **72 h** after the last successful sync by the **device clock** | checked at launch, on every foreground, every 10 min while open, before any working-set read, and at the start of every background run |
| **72 h by server time** (AM-24) | every response's `Date` header vs `meta.lastSyncServerAt`; a rolled-back device clock cannot keep the set once the phone is online |
| **Session ended** | the refresh failed (`06` § 6) → purge, then sign-in; the outbox stays for the same user |
| **Scope-loss code** (AM-1) | any response with `data.code ∈ SCOPE_LOSS_CODES` → purge, sign out with the reason; captures stay in attention |
| **Scope fingerprint changed** (AM-26) | `POST /auth/verify` at the start of every sync cycle (foreground or background) → purge and re-download |
| **Revocation of a lost phone** | the administrator revokes the user's sessions (`/sessions`, logout-all); the phone purges at its next online contact — including a **background** contact, which the native app has and the iOS PWA does not; a data-only push `{ "t": "scope-check" }` (no personal data, `05` § 3) asks the app to run `/auth/verify` early — best effort (silent pushes are throttled) |
| **Logout** | refused with a non-empty outbox ("N items are not synced: Sync now / Discard N items"); with an empty outbox: purge **and delete the user's database, its key and its registry row** |
| **Offline mode turned off** | as logout |
| **Another user signs in** | § 10.2 |
| **Rooted / jailbroken device detected** after enabling | purge and turn offline mode off (the outbox is kept and synced online) — `07` § 3 |
| **Kill switch** `mobile.offline.enabled = false` | no new enablement; the working set is purged at the next contact; the outbox still syncs |

## 9. Reports on the Phone

- **Draft preview offline:** `buildIpmReportPreview` (shared `domain`) over the local capture, the local
  checklist version and the working-set device, rendered as **native screen components** with the
  watermark "DRAFT — NOT A RECORD"; no PDF of a draft is produced.
- **Issued report:** exists only after the server accepted the submit; read online through the report
  data document (`GET /ipm/sessions/:sessionId/report-document`, P19-06 § 10). The printable PDF is
  produced by the same PDF primitives as the web (ADR-126 Am. 2 § 8 moves them to `lib/pdf/`; the
  shared-packages plan says whether they become a package Hermes can run — `docs/SHARED/`); the fetch
  uses `render=pdf` so the server writes its `EXPORT` audit row before the document is sent. Sharing
  the issued PDF through the OS share sheet is the same act as downloading it on the web — audited by
  that read; nothing is cached after the share completes.
- **Signing** is online only, in the signature dialog, with a re-entered password (and MFA per the
  method); biometrics never sign (`06` § 5). A capture synced from the outbox appears in "To sign".

## 10. One Field User per Install, and Shared Hospital Phones

The PWA's AM-23 rule ("one field user per browser profile") becomes **one field user per app install**.
The reason is the same: the per-user database is **not** a boundary between people using one app —
code running as the app can open any of its users' databases (FT-86).

### 10.1 Enabling offline mode

Refused while the registry holds **another** user's row with `outboxCount > 0` or `workingSetPresent`:
"This phone holds offline data of another user — they must sign in and sync, or an administrator can
wipe it." The registry names nobody. Another user's row with an empty outbox and no working set is
removed silently first.

### 10.2 A different user signs in

Online use by several people, one after another, is supported (sign out between them). When user B
signs in and the registry holds user A's data, the app — before B sees anything — **purges A's working
set** (tables dropped without reading them) and **leaves A's outbox untouched and encrypted**, showing
B "Another user's unsynced captures remain on this phone (N)". B cannot open them and cannot enable
offline mode until they are gone (§ 10.1).

### 10.3 The administrator wipe

An unbound tenant administrator signed in on the phone may wipe another user's offline data (typed
confirmation), **only online**, recorded by `POST /api/v1/field/wipes` (`rbac([TENANT_ADMIN])`, audit
`FIELD_DATA_WIPED`, counts only — P19-08 § 11.3). **Order:** (1) the app sends `POST /field/wipes` with
the counts and waits for the **audit row** to be confirmed; (2) only then deletes the database, its key
and its registry row; (3) if the deletion fails, it is **retried** at the next launch (the audit row
already says it was ordered). Offline the wipe is refused. *This order deliberately differs from
P19-08 § 11.3 (delete first, then report); P19-08 carries a note referencing ADR-135 — an audit row must
exist for every destruction of potential evidence, and a deletion that happens before its record can
be lost with no trace.*

### 10.4 Shared hospital phones — the recommendation

| Setup | Fit |
|---|---|
| **A phone per technician** | the design point: one field user, offline works fully |
| **A shared ward phone** used by several facility staff for look-ups | fine — facility staff never use offline mode; each signs in and out; the app lock (`06` § 5) after 5 min in the background limits a forgotten session |
| **A shared phone used by several technicians for offline capture** | works only one technician at a time (§ 10.1); attribution on an unlocked shared phone is the accepted residual FT-83 (`captured_offline` in the trail); **recommended against** in the field guide |
| **Platform multi-user partitions** — iPadOS **Shared iPad** with Managed Apple Accounts (business), Android Enterprise multi-user on supported devices | a real OS boundary between people (separate sandboxes and keychains): the recommended setup when a provider insists on shared tablets; it needs the customer's MDM (`08` § 7) |

## 11. Updates and Data Compatibility

- **Schema migrations** of the field database are additive and forward-only; the `captures`, `ops`
  and `photos` tables are **never dropped** by a migration. An older app version never opens a newer
  database (it refuses and asks to update).
- **OTA updates** (`08` § 4) are applied only at a **cold start** and never while a sync cycle runs;
  frozen ops from the previous bundle are replayed unchanged (their bodies were valid contracts then;
  a contract tightened since answers 400 → attention, never a silent loss). The capture routes'
  request schemas stay backward compatible for 30 days of outbox age (P19-08 § 13, the same promise).
- **Upgrade required** (426 `APP_UPDATE_REQUIRED`, `08` § 5): the app keeps the outbox, stops
  syncing, and shows the store link. Nothing is discarded because an upgrade is due.

## 12. Tests

Listed in `09` § 4 (offline): the purge table row by row (device clock, server time with a rolled-back
clock, session end, each scope-loss code, fingerprint change, logout refusal, root detection), the
fresh-install Keychain wipe, the shared-install rules (§ 10), the photo cap, the frozen-op identity
across an app kill, background-run budget handling, and the real-device script — two Android phones
(one from an aggressive-OEM family) and one iPhone, plus one iPad — recorded as a named run before the
offline card is DONE.
