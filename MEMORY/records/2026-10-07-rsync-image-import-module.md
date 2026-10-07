# 2026-10-07 — The rsync image import (P24-07, ADR-130)

**Owner request (2026-10-07, paraphrased):** "Build a module to import images from the existing server into the current
server's directory, using rsync in a background process. A form to input username, password, host, path; a 'check
connection' feature to make sure the server is reachable. Send a notification when the image import finishes."
**Design:** the coordinator's brief of the same day, written down as **ADR-130** (`MEMORY/DECISIONS.md`).
**Card:** P24-07 (new, `TASKS/PHASE-24-UPSTREAM-DATA-ETL.md`) — the transfer and ingest half of P24-03.
**Privacy:** no real upstream value entered the repository or any test; the live check used a throwaway SSH server with
SYNTHETIC files only; the real upstream server was never contacted.

## 1. What was built

| Layer | Files |
|---|---|
| Config | `backend/src/config/upstream.ts` — `UPSTREAM_REAL_DATA_ALLOWED` (the DPIA gate, **shared** with the SQL-dump import, ADR-129, which imports it from here), `RSYNC_ALLOWED_HOSTS`, `UPSTREAM_FILE_IMPORT_DIR`, `RSYNC_CHECK_TIMEOUT_MS`, `RSYNC_IO_TIMEOUT_SEC` |
| Constants | `backend/src/constants/upstreamFileImport.ts` — file classes (`front` = `foto_depan`, `serial` = `foto_sn`; no certificate class), quarantine reasons, size and pixel bounds, the job type, the host-key alias |
| Model + migrations | `models/upstreamFileImport.model.ts`; `migrations/0113-upstream-file-imports.ts` (table, ENUM, target-tenant FK CASCADE, CHECK "a terminal row holds no credential", CHECK "a class", list and FK indexes); `migrations/0115-upstream-import-menu.ts` (menu `upstream-import`, SUPERADMIN write — as 0101). Registered after the SQL-dump import's 0114 |
| Service | `services/upstreamFileImport.service.ts` (check, start, cancel, list, detail, reconcile, finish + notify, the batch handler); `services/upstreamFileImport/` — `sshArgs.ts` (pure argument vectors), `processRunner.ts` (spawn, never a shell, bounded), `hostKeys.ts` (keyscan parse, SHA256 fingerprint), `hostGuard.ts` (DPIA gate, SSRF), `connection.ts` (scan, dry-run listing, transfer, stable error codes), `workspace.ts` (quarantine/staging/refused/manifest layout, 0600 secret files wiped on dispose), `imageInspect.ts` (magic bytes, JPEG/PNG structure and dimensions, lossless GPS/XMP/IPTC removal), `ingest.ts` (08-FILE-POLICY § 2 per file, manifest) |
| API | `validators/upstreamFileImport.validator.ts`, `controllers/upstreamFileImport.controller.ts`, `routes/api/upstreamFileImports.route.ts` (`auth` → `denyApiKey` → `superAdminOnly`), `routes/api/upstreamFileImports.openapi.ts`; mounted at `/api/v1/admin/upstream-file-imports` in `backend/index.ts` |
| Shared registrations | `models/index.ts`, `types/models.ts`, `models/secretAttributes.ts` (`secretCiphertext` never serialises), `utils/jsonShape.util.ts` (three count-only shapes), `packages/contracts/src/states.ts` (`UPSTREAM_FILE_IMPORT_STATUSES`), `utils/seedMenuGroups.util.ts`, `constants/seededMenuSlugs.ts`, `constants/menuPageAccess.ts`, `config/migrator.ts` |
| Image | `backend/Dockerfile`: `rsync`, `openssh-client`, `sshpass` (`--no-install-recommends`) |
| Frontend | `app/dashboard/upstream-import/page.tsx` + `messages.ts` (ID/EN, the page's `lang`), `api/services/upstreamImport.service.ts`, `lib/statusTone.ts` domain `upstreamImport`, `components/layouts/menuHelpers.tsx` icon `ImageDown`, regenerated `api/generated/schema.d.ts` |
| Live check | `scripts/upstream/rsync-live-check.sh`, `rsync-app-path-check.ts`, `rsync-live-fixtures.ts` |
| Docs | ADR-130; `docs/UPSTREAM/08-FILE-POLICY.md` § 11 (as built, deviations); `docs/BACKEND/10-MODULE-REFERENCE.md` Module 34; `backend/.env.example` |

## 2. The design in one paragraph

A super admin fills the source (host, port, user, password **or** private key — recommended — remote `public/uploads`
path, classes, "synthetic source"), presses **Cek koneksi / Check connection**: the server's SSH host keys are read
(`ssh-keyscan`) and their `SHA256:` fingerprints shown; the operator compares one with the server and confirms; the next
check logs in with exactly that key pinned (temporary known_hosts, `StrictHostKeyChecking=yes`, `HostKeyAlias`) and
lists each class folder with `rsync --dry-run --stats` (estimate). **Start** checks again and queues a batch job; the
credential is stored only as a KMS envelope bound to the row id and is erased with the terminal status in one transaction
(CHECK-enforced). The job rsyncs each class into a quarantine directory (not served, not a storage key; resumable,
bandwidth-limited, cancellable), ingests each file per 08-FILE-POLICY (size, magic bytes, ClamAV, SHA-256, structure and
dimensions, GPS removed losslessly, put + read-back verify into `t/<tenant>/attachments/<uuid>.<ext>`, a manifest line),
moves refused files to `refused/<import>/<reason>/`, and notifies the requester in-app and by e-mail with counts only.
`UPSTREAM_REAL_DATA_ALLOWED` (default off) restricts every step to a synthetic source on an allow-listed host until the
DPIA gates (R-01, R-03, R-17) are met.

## 3. Tests (TypeScript; named)

| Suite | Tests | Proves |
|---|---:|---|
| `tests/services/upstreamFileImport/sshArgs.test.ts` | 30 | fixed hardened ssh options; key vs password auth; injection payloads in host/user/path stay ONE argument after `--`; the `-e` string refuses any non-word token; **the password is in no argument vector** (only `SSHPASS`); the child environment is built from nothing |
| `tests/services/upstreamFileImport/hostKeysAndGuard.test.ts` | 22 | OpenSSH SHA256 fingerprints; keyscan parsing; the DPIA gate (403 before any lookup); SSRF — loopback, RFC 1918, link-local/metadata, CGNAT, IPv6 loopback/ULA, a mixed answer, local names, literal addresses; the allow-list exception |
| `tests/services/upstreamFileImport/imageInspect.test.ts` | 58 | JPEG/PNG/HEIC by magic bytes; script, text, SVG, AVIF, MP4, PDF refused; the GPS IFD emptied with orientation and image data byte-identical (LE and BE EXIF); XMP/IPTC/COM dropped; unparseable EXIF dropped whole; 15 malformed JPEG shapes and 8 malformed PNG shapes `image_undecodable`; decompression-bomb limits |
| `tests/services/upstreamFileImport/ingest.test.ts` | 10 | the pipeline over synthetic files on disk: ingested (GPS gone) vs quarantined by reason (HEIC, script, text, truncated, oversized, bomb, broken, virus, scan error), manifest lines with both hashes, refused files moved, partial dir ignored, skip-if-present, duplicate content, put failure, read-back mismatch, unreadable file, cancel between files |
| `tests/services/upstreamFileImport/processRunner.test.ts` | 10 | `shell: false`; ONLY the given environment reaches the child (a variable of this process does not); timeout → SIGTERM then SIGKILL; abort; ENOENT; output tail cap |
| `tests/services/upstreamFileImport/connection.test.ts` | 27 | stable codes from exit codes/messages; stats and progress parsing; known_hosts holds exactly the pinned key; key file written 0600 and wiped; `SSHPASS` only in the env; listing/transfer argument vectors |
| `tests/services/upstreamFileImport/workspace.test.ts` | 9 | config defaults and call-time reads; the layout; 0700/0600; the secret file overwritten with zeros before removal |
| `tests/services/upstreamFileImport.service.test.ts` | 42 | over the REAL models/hooks (memoryDb), audit, KMS, batch job (inline), notification: check outcomes and audit; rate limit; **credential lifecycle — a KMS envelope that opens only under its own row id, erased on completed/failed/cancelled/reconciled, absent from every answer, audit row, notification, e-mail and log line (scanned)**; the full run with counts; skip-if-present on a re-run; refusals (404/409/503); failure codes; the gate re-checked at run time; cancel pending/running/racing; reconciliation of a dead worker; notifications in-app + e-mail with counts only |
| `tests/validators/upstreamFileImport.validator.test.ts` | 50 | host, path, user, password, key, fingerprint, classes (no `inventory`), credential/method pairing |
| `tests/routes/upstreamFileImports.route.test.ts` | 16 | the real chain: tenant admin 403, API key 403, no principal 401 on all six routes; 400 before the service on injection; envelope (`data` + top-level `meta`); no password echoed |
| `tests/migrations/0113-upstream-file-imports.test.ts` | 6 | the table equals the model column for column; constraints idempotent; failure propagates; down; registered after 0112 |
| `tests/migrations/0115-upstream-import-menu.test.ts` | 6 | unseeded database left alone; fixed id or random fallback; idempotent grant; down; registered after 0114 |
| Guard entries | — | `twoTenantRoutes.guard` (2 routes `platform`), `unscopedModels.d17`, `enumMirrors.d26`, `stateUnions.p905`, `associationForeignKeys.a148` (3 FKs), `jsonShape.d27` (3 shapes, good and bad fixtures — a file name smuggled into `quarantinedByReason` is refused), `includeRequired.d12` (80 models), `pageOrderTiebreaker.ci3` (id tiebreaker) |
| Frontend `app/dashboard/upstream-import/__tests__/page.test.tsx` | 17 | restriction; gate banner; check → confirm fingerprint → estimate → start; the password cleared after start and never in the DOM; key auth; 403/409 explanations; details, cancel with confirmation; ID/EN with `lang`; polling; the import a notification links to (`?import=`) opens; **axe: no violations** |
| Frontend `api/services/upstreamImport.service.test.ts`, `lib/statusTone.test.ts` | 3 + 4 rows | the contract paths; the tones (`failed` is the only alarm) |

## 4. Live evidence (2026-10-07)

`scripts/upstream/rsync-live-check.sh` against the backend **image** `callibrator-be:rsync-import-live-2026-10-07`
(built once from a snapshot of the tree — see § 6), PostgreSQL 18 (pgvector), Redis 8.6, RabbitMQ 3.13, Mailpit 1.27 and
an `alpine:3.20` SSH server (openssh + rsync) on a private network (`rsynclive-<pid>-net`). The SSH server held a
synthetic `public/uploads` tree: 2 GPS-tagged JPEGs (one with XMP), a PNG with text/eXIf chunks, a HEIC, the shell
script and text file stand-ins, a 512-byte truncated file, two byte-identical JPEGs at two paths, a ~3 MB JPEG, and a
certificate PDF in `inventory/`. `UPSTREAM_REAL_DATA_ALLOWED=false`, `RSYNC_ALLOWED_HOSTS=test-ssh`. **PASSED, run 2**
(run 1 failed only on the check script's own comparison: JSONB key order — fixed to compare sorted entries):

- the image ships rsync 3.2.7, OpenSSH 9.2p1, ssh-keyscan, sshpass 1.09;
- 34 API checks: gate closed; a real source 403; injected host 400; traversing path 400; a non-allow-listed host 403;
  host keys without a login; **the ed25519 fingerprint equal to the one read on the server with `ssh-keygen -lf`**; wrong
  fingerprint → `host_key_mismatch`; login + estimate (front 7, serial 3); wrong password → `auth_failed`; missing folder
  → `path_not_found`; key auth OK; start 201 with the credential stored encrypted; **import 1 completed: copied 10,
  ingested 6, quarantined 4 (`file_type_refused` 2, `heic_converter_unavailable` 1, `file_truncated` 1), metadata
  stripped 3, duplicate content 1**, credential erased; the in-app notification with counts and no file name; **the
  e-mail delivered to sys@mail.com (Mailpit)**; import 2 (key auth) completed with all 6 skipped as already present;
  import 3 (64 KiB/s) cancelled mid-transfer within seconds, credential erased; a second cancel 409; the list envelope;
  no answer carried the password or the key;
- from outside the API: **while import 3 transferred, no process's `/proc/*/cmdline` held the SSH password**, and rsync
  ran with `--protect-args`; `upstream_file_imports` holds no ciphertext after the run; 13 audit rows, none with the
  credential; the backend's log holds no credential; the shell script sits in `refused/<import>/file_type_refused/…`;
  no PDF anywhere; no run scratch left; **the 6 stored objects re-inspected: SHA-256 equal to the manifest, no location
  metadata left, UUID keys with no source name**.

Every container and the network were removed by name (trap); the four images the run pulled (alpine, redis, rabbitmq,
mailpit, by digest) and the baseline `debian:bookworm-slim` digest pulled for the size measurement were removed by
reference. Nothing was pruned.

## 5. Gates

| Gate | Result |
|---|---|
| Backend lint | `node scripts/ci/eslint-ratchet.js`: **0 error(s), 0 warning(s); baseline 0** (whole tree); `npx eslint` on every file of § 1 and § 3: 0 |
| Backend typecheck | `npm run typecheck`: **0 errors** (re-run after the SQL-dump agent fixed its scheduler import; earlier in the day its `index.ts(42)` was the tree's only error) |
| `npm run ratchet` | 695 `.js`, at the floor (no new `.js`) |
| `openapi:check` / `openapi:lint` | current (491 operations, regenerated with the tree) / no new Spectral error |
| `build:dist` / `load:check` | **OK**: 655 TypeScript files compiled (+ 55 of contracts); load-check **645 modules, 107 in boot order — OK in both modes** (dist via node, src via tsx) |
| Image build | OK (from the snapshot; `openapi:check` and `build:dist` ran inside it), see § 6 |
| My suites | 286 tests in 12 backend suites; 100 % statements/branches/functions/lines on `services/upstreamFileImport*`, the validator, the controller and the route (measured with `--collectCoverageFrom` on those files) |
| Frontend | typecheck 0; lint 0 errors (55 pre-existing warnings); jest **314 suites, 3,438 tests**, coverage 94.12 / 85.06 / 89.83 / 94.77 (gate 90/81/86/91); `next build` OK (`ƒ /dashboard/upstream-import`); bundle budget 10/10 within |
| Full backend `test:coverage -- --ci` | **100 % statements / branches / functions / lines (All files)**; 958 suites (919 run, 39 skipped), 15,852 tests passed, 5 failed in 4 suites: **2 mine** — test-only races under the full suite's load (the settle helper did not wait for the batch-job row; `pruneStaging` did not await its `rm`) — **fixed** (the helper waits for the batch job; the `rm` is awaited) and re-run green (286/286, 100 % on the module); **3 not mine**: `apiKey.scopeContract.a299` and `unboundedFindAll.d24` (the SQL-dump import's new slug and `findAll`s, that agent's to register), `storage.localFsync.p918` (passes alone: 2/2 — load-sensitive). Re-run of the guard suites on the final tree: every guard this module touches green |

## 6. The image

- Built once from a snapshot of the working tree (`tar` of the dockerignore's allow-list) because the tree's
  `index.ts` did not compile at that moment (the SQL-dump agent's in-progress scheduler import, `import type X from` a
  module with no default export); in the snapshot only that one line was changed to `import type * as X`. Nothing of
  this module was patched.
- Size: **1.17 GB** total. The three packages pull **13 Debian packages, 9,613 KB installed** (openssh-client 5,801,
  libkrb5-3 1,077, rsync 793, libgssapi-krb5-2 425, libk5crypto3 261, libedit2 258, libpopt0 245, libfido2-1 241,
  libbsd0 202, libkrb5support0 134, libcbor0.8 98, libkeyutils1 40, sshpass 38), measured against the same base with the
  old package set. The VM and compose need nothing else.
- Tag `callibrator-be:rsync-import-live-2026-10-07`, removed by name after the run.

## 7. Deviations and decisions (ADR-130)

GPS stripped before the put (08 § 4.2's ⚖ alternative, not its default); HEIC quarantined (no converter until P21-02);
keys without the facility segment (P24-03 re-keys from the manifest); SHA-256 on arrival, not against a source-side
hash; no derivatives and no attachment rows; manifest as a 0600 JSON-Lines file, not a table; the dashboard page is
bilingual by itself (ADR-098 §4 exception); the connection check audited as `UPDATE` with an operation name; the rate
limit per process. `docs/UPSTREAM/08-FILE-POLICY.md` § 11 records each.

## 8. Deferred

- **Retention sweep** for `.upstream-import/staging` and `refused/` (a failed or cancelled import keeps its staging to
  resume; nothing removes either automatically yet). Until then: remove by hand after the ETL.
- **HEIC → JPEG and derivatives** (P21-02, needs an image library under the owner's package rule), then re-run.
- **The facility re-key, attachment rows, deletion of the manifest at cutover** (P24-03, P31).
- **Maker-note GPS** (vendor-private formats) — sized by the aggregate EXIF survey (08 § 4.3, P24-05).
- **ClamAV in the live check**: the run used `VIRUS_SCAN_PROVIDER=none`; the scanner verdict paths are unit-tested
  (virus, scan error).
- **A source-side SHA-256** (P24-05, by hand).
- The rate limit is per process; a shared (Redis) limiter if the API runs on several replicas.
- `config/upstreamImport.ts` (the SQL-dump import) also reads `UPSTREAM_REAL_DATA_ALLOWED` directly for its own
  settings object — for that agent to fold into `config/upstream.ts#upstreamRealDataAllowed`.
