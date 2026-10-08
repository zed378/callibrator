# Phase 38 — Mobile Field Capture, Online and Offline

> Part of the **mobile group, Phases 35 … 40 (one plan)** ([Phase 35](./PHASE-35-SHARED-PACKAGES.md)).
> Specs: [`docs/MOBILE/04-OFFLINE-FIELD-CAPTURE.md`](../docs/MOBILE/04-OFFLINE-FIELD-CAPTURE.md),
> [`05-NATIVE-FEATURES.md`](../docs/MOBILE/05-NATIVE-FEATURES.md) §§ 1–2,
> [`docs/SHARED/06-SYNC-ENGINE.md`](../docs/SHARED/06-SYNC-ENGINE.md), `MEMORY/specs/P19-08-offline-field-capture.md`.
>
> ← [Phase 37](./PHASE-37-MOBILE-APP-FOUNDATION.md) · [Phase 39](./PHASE-39-MOBILE-ROLES-TABLET-NATIVE.md) →

| | |
|---|---|
| **Status** | **BLOCKED** — 8 cards: 8 BLOCKED (written 2026-10-08; nothing built) |
| **Goal** | a technician registers devices and captures IPM sessions on the phone, online and offline, with photos and QR, and nothing captured is ever lost, duplicated or left readable after the purge rules say it must go |
| **Depends on** | P37-08; P35-07; P36-09; the upstream capture routes of Phases 20–22 (as built by then) |
| **Size** | XL |
| **Cards** | 8: P38-01 … P38-08 |
| **Definition of Done** | as Phase 37, plus: every offline rule has its named test in `docs/MOBILE/09` § 4, and the real-device script (`09` § 5) is a named run before P38-08 |

## Cards

### P38-01 — QR scanning, lookup and the verify-by-scan path

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-08 |
| **Spec refs** | `docs/MOBILE/05` § 2 · `docs/SHARED/05` § 3 · ADR-132 · ADR-100 |
| **Spec required** | no |

**Definition of Done**
- [ ] `expo-camera` scanning with typed entry always available; `readScan` decides device vs verification vs legacy vs foreign host; foreign URLs never opened
- [ ] Online lookup `GET /calibration-devices/by-qr/:qrCode`; the one 404 message for every miss
- [ ] Maestro `device.scan-register` (scan part) and `verify.public`

### P38-02 — Camera and the photo pipeline

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P37-08 |
| **Spec refs** | `docs/MOBILE/05` § 1 · `docs/MOBILE/04` § 5 · `docs/UPSTREAM/08-FILE-POLICY.md` · ADR-127 § 5 |
| **Spec required** | no |

**Definition of Done**
- [ ] In-app capture only (never the photo library), re-encode ≤ 2048 px JPEG 0.8, no EXIF (a test reads the bytes); HEIC handled; temp file deleted in the same step as the store write
- [ ] The 300-photo / 500 MB caps with their messages

**Abuse cases**
- Saving a copy to the gallery "so the technician can retry"

### P38-03 — Device registration and IPM capture online

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-01, P38-02 |
| **Spec refs** | `docs/MOBILE/02` § 2.1 · `docs/MOBILE/03` § 5 · ADR-126 · `docs/SHARED/05` §§ 4, 7a |
| **Spec required** | no |

**Definition of Done**
- [ ] Registration with photos, the checklist stepper with limit hints and outcomes from contracts, submit, the draft preview from `buildIpmReportPreview`, the issued report read online
- [ ] Idempotency keys per user intent on capture writes; 409s shown as state explanations
- [ ] Maestro `ipm.capture-online`, `device.scan-register`

### P38-04 — The native sync adapters: SQLCipher store, MMKV registry, the key, the scheduler

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-03, P35-07 |
| **Spec refs** | `docs/MOBILE/04` §§ 2–6 · `docs/SHARED/06` § 4 · ADR-135 |
| **Spec required** | **yes** — the SQLCipher schema and migrations, the adapter's mapping onto the ports, the background-run budget plan |

**Definition of Done**
- [ ] `EncryptedStore` on `expo-sqlite` + SQLCipher, key in SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), backups excluded; registry in MMKV holding ids, counts, timestamps only (test)
- [ ] Foreground triggers and `expo-background-task` with `runCycle({ budgetMs })`; Android battery-optimisation request after enabling only
- [ ] Forbidden-at-rest lint (`AsyncStorage`, stray file writes) green

**Abuse cases**
- A plaintext SQLite "cache" beside the encrypted database

### P38-05 — Offline mode: enablement, working set, capture, sync, conflicts

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-04, P36-09 |
| **Spec refs** | `docs/MOBILE/04` §§ 1, 3, 6–7, 9, 11 · P19-08 §§ 7.2, 9 |
| **Spec required** | no |

**Definition of Done**
- [ ] Enablement pre-checks (lock screen, the server's attestation verdict — Android device + app; iOS app integrity plus the advisory local jailbreak heuristic, `docs/MOBILE/20` § 9a — storage, flag), up to 3 facilities, size before download, rollback of a partial download
- [ ] Offline capture and sync through the shared engine; the conflict sheet with P19-08 § 9.6's actions and typed confirmations; local notifications without names
- [ ] Maestro `ipm.capture-offline`, `ipm.conflicts`; the offline tests of `09` § 4

### P38-06 — Purge rules, revocation and the one-field-user rules

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-05 |
| **Spec refs** | `docs/MOBILE/04` §§ 8, 10 · `docs/SHARED/06` §§ 8–9 · P19-08 §§ 10–11 |
| **Spec required** | no |

**Definition of Done**
- [ ] Every purge row tested by name (device clock, server time with a rolled-back clock, session end, each scope-loss code, fingerprint change, logout refusal, root verdict, kill switch) with the outbox asserted untouched — **mutation-checked**
- [ ] Another user on the same install; the administrator wipe recorded by `POST /field/wipes` before deletion
- [ ] `scope_check` push handled when Phase 39's push lands (test stub until then)

### P38-07 — Data compatibility across updates

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-05 |
| **Spec refs** | `docs/MOBILE/04` § 11 · `docs/MOBILE/08` § 4 |
| **Spec required** | no |

**Definition of Done**
- [ ] Additive, forward-only field-database migrations; an older app refuses a newer database
- [ ] Frozen ops replayed unchanged across an OTA update (test); 426 keeps the outbox

### P38-08 — Phase exit: the offline real-device run

| | |
|---|---|
| **Status** | BLOCKED |
| **Depends on** | P38-01 … P38-07 |
| **Spec refs** | `docs/MOBILE/09` §§ 4–5 |
| **Spec required** | no |

**Definition of Done**
- [ ] The real-device script steps 1–5, 9–13 on the owned lab (Samsung, aggressive-OEM Android, iPhone, iPad) as a named run in `MEMORY/records/`; background behaviour recorded as observed
- [ ] Phase summary; `PROGRESS.md` updated

**Abuse cases**
- Emulator runs reported as the real-device script
