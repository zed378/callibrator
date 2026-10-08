# 06 — `@callibrator/sync-engine` (TARGET)

> **Status: TARGET (ADR-134). Not built.** It is the platform-neutral core of the offline engine
> specified for the PWA in [`MEMORY/specs/P19-08-offline-field-capture.md`](../../MEMORY/specs/P19-08-offline-field-capture.md)
> (ADR-127 + Am. 1) — the outbox, frozen ops, idempotent replay, `client_ref`, conflict mapping and
> purge rules — with its storage, crypto, clock, network and scheduling **behind ports**, so the PWA
> (IndexedDB + WebCrypto) and the native app (SQLCipher + Keychain/Keystore, ADR-135,
> [`../MOBILE/04`](../MOBILE/04-OFFLINE-FIELD-CAPTURE.md)) run **one** engine. Built by P35-07.
>
> **This document restates no server rule.** The server contract — the `view=field` read,
> `Idempotency-Key`, `client_ref`, the scope fingerprint, `SCOPE_LOSS_CODES`, the 409 codes, the field
> wipe route — is P19-08 § 7.2 and § 9.5, built by P21-02/03/09. Where this document and P19-08
> disagree, P19-08 wins until amended through the deviation protocol.

---

## 1. Why One Engine

The engine is where offline capture can lose or duplicate regulated work: a retry with a changed
body, a purge that takes the outbox with it, an op planned twice. P19-08 specified it carefully once.
Two implementations — one in the PWA, one in the app — would mean two places for each of those
defects and two test suites that could disagree. The engine is therefore one package, and each
platform supplies only what is genuinely different: where bytes rest, how keys are held, when the
engine is allowed to run.

## 2. What Is in the Package, and What Is Not

| In the engine (pure TypeScript) | In the platform adapters (each app) |
|---|---|
| the capture model and its states (P19-08 § 9.1) | the database (IndexedDB / SQLCipher) and its schema migrations |
| the **planner**: the minimal op from the difference between the local capture and the server-confirmed state (§ 9.2) | the encryption (per-record AES-GCM with a non-extractable key / SQLCipher page encryption) and the key's custody |
| **freezing**: key + body written before the first attempt; identical retries | the photo pipeline (decode, resize, re-encode, EXIF drop) |
| the **runner**: cycle order, parallelism (one capture's ops in order, 2 captures at once), backoff, `Retry-After`, budgets | QR decoding and camera |
| **classification** of every answer into success / retry / attention / scope loss / session end (§ 9.3, § 9.6) | timers, background execution (Background Sync / WorkManager / BGTaskScheduler) |
| the **working-set** download plan: sizes first, the cap, paging, `If-None-Match` | network status events |
| the **purge rules** (§ 10) and the **one-field-user** rules (§ 11) | the UI: every screen, every confirmation, every notification |
| the scope-fingerprint check at the start of every cycle | the registry's physical storage (`localStorage` flag + IndexedDB / MMKV) |

## 3. Layout

```text
packages/sync-engine/
├── src/
│   ├── model.ts          # Capture, CaptureState, Op, OpState, PhotoRef, AttentionReason
│   ├── planner.ts        # plan(capture, lastConfirmed) → Op[] (pure)
│   ├── freeze.ts         # freezeOp(): key (UUID v4 from Random), exact body, request hash
│   ├── runner.ts         # runCycle({ budgetMs? }) — verify → catalogue → ops
│   ├── classify.ts       # ApiError | Response → Outcome (uses contracts' code tuples)
│   ├── workingSet.ts     # download plan, cap, refresh
│   ├── purge.ts          # the purge table as data + evaluatePurge(now, serverDate, meta, events)
│   ├── registry.ts       # one field user per profile / install
│   ├── ports.ts          # every port (§ 4)
│   └── engine.ts         # createSyncEngine(ports, config) — the public API (§ 5)
└── test/                 # 100 %; in-memory adapters; property tests for the planner (§ 10)
```

## 4. Ports

```ts
// packages/sync-engine/src/ports.ts (target API — narrowed at P35-07 to what the code uses)

/** One user's encrypted store. Opened per (tenantId, userId). How it is encrypted is the adapter's. */
export interface EncryptedStore {
  transaction<T>(tables: readonly Table[], mode: "read" | "readwrite", work: (tx: StoreTx) => Promise<T>): Promise<T>;
  /** Device lookup over the working set (web: an in-memory index built from decrypted pages; native: SQL indexes inside SQLCipher). */
  findDeviceByQr(qrCode: string): Promise<FieldDeviceSummary | null>;
  searchDevices(query: DeviceQuery): Promise<readonly FieldDeviceSummary[]>;
  /** Drop the working-set tables WITHOUT reading them (purge). Never touches captures, ops, photos. */
  dropWorkingSet(): Promise<void>;
  /** Delete the whole store and its key (logout with an empty outbox; administrator wipe). */
  destroy(): Promise<void>;
}
export type Table = "meta" | "catalogue" | "devices" | "rooms" | "captures" | "ops" | "photos";

export interface StoreFactory {
  open(tenantId: TenantId, userId: UserId): Promise<EncryptedStore>;   // creates the key on first open
  exists(tenantId: TenantId, userId: UserId): Promise<boolean>;
}

/** The per-profile/per-install registry: ids, counts and timestamps ONLY — no name, no tenant value. */
export interface RegistryStore {
  list(): Promise<readonly RegistryRow[]>;     // { key: "<tenantId>:<userId>", outboxCount, workingSetPresent, lastSyncServerAt }
  put(row: RegistryRow): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Clock { now(): number }                      // device time, ms
export interface Network { online(): boolean; subscribe(listener: (online: boolean) => void): () => void }
export interface Scheduler { setTimeout(fn: () => void, ms: number): () => void }
export interface Random { bytes(n: number): Uint8Array }      // CSPRNG: crypto.getRandomValues / expo-crypto

/** The slice of @callibrator/api-client the engine needs; the app passes its configured client. */
export interface SyncTransport { /* typed calls for the reads and writes of P19-08 § 7.2 and § 9.2 */ }

/** Diagnostics WITHOUT tenant data: op ids, states, status codes, counts. Never a body, a QR, a name. */
export interface EngineLog { event(name: string, fields: Readonly<Record<string, string | number | boolean>>): void }
```

**The storage rule both adapters keep** (P19-08 § 7.1; `../MOBILE/04` § 4): tenant data exists at
rest **only** inside the encrypted store. The registry and any preference store hold ids, counts and
timestamps only. On the web, IndexedDB itself is not encrypted, so records are encrypted one by one
with the record's slot as AAD and clear fields are limited to ids, timestamps, states and counts (no
plaintext index over a tenant value). On native, the whole SQLCipher file is encrypted, so ordinary
indexes inside it leak nothing (ADR-135). The port expresses the **outcome** (lookups that work,
nothing readable at rest without the key), and each adapter achieves it the way its platform allows.

| Concern | Web adapter (`frontend/src/field/platform/`) | Native adapter (`apps/mobile/src/platform/sync/`) |
|---|---|---|
| Store | IndexedDB `callibrator-field-<tenantId>-<userId>`; per-record AES-GCM-256, IV 96 random bits, AAD `"<store>/<key>/<schemaVersion>"` | `expo-sqlite` with SQLCipher, `field-<tenantId>-<userId>.db` |
| Key | WebCrypto `CryptoKey`, `extractable: false`, kept in the same database | 256 random bits in `expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (background sync needs it while locked — `../MOBILE/04` § 4.2) |
| Lookup | decrypt the working-set pages into memory at open (≤ 2,000 devices decrypt well under a second, P19-08 § 7.1) | SQL indexes on QR, name, room, facility |
| Photos | encrypted `ArrayBuffer` records | BLOBs in SQLCipher; temp file deleted in the same step |
| Registry | `callibrator-field-registry` + `localStorage["cf.field.present"]` | MMKV (unencrypted, ids/counts only) |
| Scheduler | timers while the page is open; Background Sync's `sync` event asks an open page to run (the worker holds no key) | timers in foreground; `expo-background-task` with `runCycle({ budgetMs: 25_000 })` |
| Network | `online`/`offline`, `visibilitychange` | NetInfo + `AppState` |

## 5. Public API

```ts
export interface SyncEngine {
  // capture lifecycle (the UI calls these; each is a local write, then a debounced plan)
  createCapture(input: NewCapture): Promise<LocalId>;        // generates clientRef (UUID v4) at creation
  editCapture(localId: LocalId, patch: CapturePatch): Promise<void>;
  addPhoto(localId: LocalId, photo: EncodedPhoto, purpose: PhotoPurpose): Promise<PhotoId>;
  submitLocal(localId: LocalId): Promise<void>;              // editing → submitted_local (read-only on the device)
  resolveAttention(localId: LocalId, action: AttentionAction, confirmation?: string): Promise<void>;

  // sync
  runCycle(options?: { budgetMs?: number; trigger: Trigger }): Promise<CycleReport>;
  status(): SyncStatus;                                       // outbox count, oldest item age, attention count, last sync (server time)
  subscribe(listener: (status: SyncStatus) => void): () => void;

  // working set
  prepareOffline(facilities: readonly FacilityId[]): Promise<PrepareReport>;  // sizes first; refuses above the cap
  lookupByQr(qrCode: string): Promise<FieldDeviceSummary | null>;

  // session and scope
  onSessionEnded(): Promise<void>;                            // purge working set; outbox kept
  onScopeLost(code: ScopeLossCode): Promise<void>;
  signOut(): Promise<SignOutResult>;                          // refused with a non-empty outbox → { refused: true, pending: n }
  wipeOtherUser(key: string): Promise<WipeCounts>;            // after the server recorded POST /field/wipes
}
export function createSyncEngine(ports: EnginePorts, config: EngineConfig): SyncEngine;
```

`EngineConfig` carries the numbers P19-08 fixed — 72 h working-set life, 2 captures in parallel,
backoff 2 s × 2ⁿ to 5 min ± 20 %, the 60-second "captured offline" window, the 2-second edit debounce —
as **defaults that the app cannot loosen**: a value above P19-08's is refused at construction (a test
pins each).

## 6. Working Set and Lookup

As P19-08 § 7.2: `POST /auth/verify` (scope fingerprint, the user's `clientFacilityId`) → the facility
list (bound: its own) → `GET /calibration-devices?clientFacilityId=…&view=field` paged, `meta.total`
read **first** so the screen states the size before downloading, refused above
`field.workingSetMaxDevices` → rooms → the published catalogue with `If-None-Match` (304 keeps the
copy) → the caller's open drafts → the tenant settings needed offline. **Photos and documents of
devices are never downloaded.** A partial download is rolled back (`../MOBILE/04` § 3).

A lookup goes through `@callibrator/domain`'s `readScan` (`05` § 3) and contracts' `normaliseQrCode`,
then `findDeviceByQr`. A miss offline is "not in the devices you took offline".

## 7. Captures, Ops and the Planner (P19-08 § 9.1 – § 9.4)

- **States:** `editing` → `submitted_local` → `syncing` → `synced` (removed after the server state is
  re-read) | `attention` | `discarded_local`. A registration capture of a new device is a dependency
  (`dependsOn`) of the IPM capture made on it.
- **The local capture is the source of truth.** The planner diffs it against `lastConfirmed` and emits
  at most: create (`POST /ipm/sessions` with `clientRef`, `capturedOffline`, `clientCapturedAt`; or
  `POST /calibration-devices` with `clientRef`), `PATCH` header with `revision`, `PUT …/results` with
  the **whole** result set and `revision`, one op per photo **before** the submit, then `POST …/submit`.
  A photo is never planned after a submit.
- **Freezing:** each op gets a fresh UUID v4 `Idempotency-Key` and its exact body **written to the
  store before the first attempt**; every retry sends the same bytes (the server's request-hash check
  would refuse a changed body as `IDEMPOTENCY_KEY_REUSED`). An edit made while an op is in flight is
  planned **after** it completes, as a new op with a new key.
- **`clientRef`** is generated when the capture is created and keyed by the server per
  `(tenant, creator, ref)`; a replayed create answers the existing session (200).
- **Attribution and scope come from the server**, never from the payload: the engine sends no tenant,
  facility or performer (ADR-127 § 7). `clientCapturedAt` is the device's claim, never used for
  ordering, visit numbers or "due".

## 8. Classification, Conflicts and Purge

| Answer (via `@callibrator/api-client`'s `ApiError`, `03` § 6.2) | Engine outcome |
|---|---|
| 2xx (including a replayed key's stored answer) | record server id / revision / confirmed state; op `done`; plan the next |
| network, timeout, 5xx, 429 (`Retry-After`), 409 `IDEMPOTENCY_IN_FLIGHT` | retry the **same frozen op** with backoff, unlimited while the capture exists |
| 409 `IDEMPOTENCY_KEY_REUSED` | a client defect: re-plan once with a new key automatically, then attention ("internal sync error") |
| 409 `IDEMPOTENCY_SCOPE_CHANGED` | attention; re-plan with a new key only after the user confirms (their access changed) |
| 409 with an `IPM_*` / device code, 404, 400, 403 without a code, 413/415 | **attention** — the capture's queue stops; the reason is the code; the actions are P19-08 § 9.6's table, offered as data (`AttentionAction`) for the UI to word through `@callibrator/i18n` (`field.conflicts.*`) |
| 403 with a `SCOPE_LOSS_CODES` code | **purge** the working set (§ 8.1); captures stay, marked attention |
| session ended (the auth adapter's `sessionEnded`) | **purge**; the outbox stays for the same user's next sign-in |

Nothing is dropped without a confirmed user action (`resolveAttention` with the typed confirmation the
UI collected). The engine never discards on its own.

### 8.1 Purge (P19-08 § 10; `../MOBILE/04` § 8)

"Purge" = drop the working-set tables (devices, rooms, catalogue) **without reading them** and the
in-memory copy; registry `workingSetPresent = false`. **The outbox (captures, ops, photos) is never
purged by these rules.** The triggers, evaluated by `purge.ts` as data so both platforms run the same
table: 72 h since the last successful sync by the **device clock**; 72 h by the **server `Date`**
header (a rolled-back clock cannot keep a set once online — AM-24); session ended; a scope-loss code;
a changed scope fingerprint at the start of a cycle (AM-26); logout and "offline off" (refused with a
non-empty outbox; with an empty one the whole store and its key are destroyed); another user signing
in (§ 9); the server's kill switch; and, on native only, a rooted/jailbroken device detected after
enabling (`../MOBILE/07` § 3 — the adapter raises it).

## 9. One Field User per Profile or Install (AM-23)

`registry.ts` implements P19-08 § 11 and `../MOBILE/04` § 10 as one rule set: enabling offline mode is
refused while another user's row has an outbox or a working set; another user's sign-in purges that
user's working set **without opening their outbox**, and leaves a count-only note; an unbound tenant
administrator's wipe runs **only after** the server recorded `POST /api/v1/field/wipes` (audit
`FIELD_DATA_WIPED`, counts only). The registry names nobody.

## 10. Tests

- **100 %** at the package gate, with in-memory adapters that implement the ports faithfully
  (including a store that throws mid-transaction, a clock that goes backwards, a network that flaps).
- **Planner properties:** for random sequences of local edits and server answers, (a) a frozen op is
  never re-sent with a different body, (b) no photo op follows a submit, (c) the confirmed state after
  all ops equals the local capture, (d) a crash at any point and a restart re-sends only frozen ops.
- **Purge table** row by row, with the outbox asserted untouched in every row.
- **The adapters are not tested here** — the web's in the frontend suite (P19-08 § 16.1), the native
  one in the app suite (`../MOBILE/09`). Real proof is end-to-end: the PWA's browser suite and live
  E2E (P19-08 § 16.3–16.4), the app's Maestro offline flows, and the **real-device scripts** (Android +
  iPhone + iPad, network cut and restored), each recorded as a named run.

## 11. Extraction Path (target; no execution)

The PWA's engine is built by **P22-10** (Phase 22), before this package exists. Two cases:

1. **Recommended:** P22-10 writes the engine under `frontend/src/field/engine/` with the port
   boundary of § 4 already in place — planner, runner, classification and purge never touching
   IndexedDB, WebCrypto or `window` directly. P35-07 is then a **move** of that directory into the
   package plus its tests (same case names and count), and the web adapters stay in
   `frontend/src/field/platform/`.
2. If P22-10 interleaves platform calls with the engine, P35-07 first refactors it behind the ports
   **inside the frontend** (proved by P19-08 § 16's suites unchanged), then moves it.

Either way the proof that nothing changed for the PWA is the same: P19-08 § 16's unit, browser and
live suites, and the PWA real-device script re-run after the move.

## 12. Bad Implications

- The port boundary costs the PWA an indirection it would not need alone, and the P22-10 author must
  respect a boundary for a consumer that does not exist yet.
- The storage rule is the same in outcome, not in mechanism: the web forbids plaintext indexes, native
  allows indexes inside the encrypted file. A reviewer comparing the two must read § 4, not assume.
- Background execution differs sharply by OS (`../MOBILE/04` § 6); the engine supports budgets, but no
  engine design makes iOS background sync reliable.
