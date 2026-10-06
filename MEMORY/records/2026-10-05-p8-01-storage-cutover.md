# 2026-10-05 — P8-01: every stored file goes through the storage layer (and `bootstrap:rotate` from a checkout)

**Cards:** P8-01 (`TASKS/PHASE-8-SCALE-AND-REACH.md`), the U-09 side finding (`npm run bootstrap:rotate`). **Decision record:** ADR-086 Amendment 1 (`MEMORY/DECISIONS.md`). **Builds on:** U-09 ([record](./2026-10-05-u09-s3-live.md)), ADR-042, ADR-057, ADR-084.

## 1. What was wrong

U-09 proved the S3 driver live and found that no request path used it. Before this change:

| Class | Written to | Served from |
|---|---|---|
| attachments | multer → quarantine → `uploads/attachments/` | `res.sendFile` of the disk file; `storage_key` read only by the migration tool and the sweep |
| certificate PDFs | nothing (M-11) | `uploads/certificates/` |
| avatars, logos, CMS images | `uploads/public/{profile,tenant,cms}/` | `express.static` |
| tenant backups | `fs.writeFileSync` into `backup/tenant-backups/`, absolute path in `file_path` | `res.download` |
| GDPR exports | `exports/<id>.{json,zip}` | `res.download` |

So `STORAGE_DRIVER=s3` changed nothing a user did, and two replicas would each have had half the files on every driver. The card's premise ("a configuration change plus a migration, not new code") was wrong; ADR-086 Am. 1 records that.

## 2. What now goes through storage, by file type

| Class | Key | Write | Read / serve | Delete |
|---|---|---|---|---|
| attachments | `t/<tenant>/attachments/<file>` | after link check → virus scan → checksum; only a file IN the quarantine (`assertInQuarantine`, S-17); a failed put or transaction deletes the object | download + signed link from the ROW's tenant's storage; missing → 410; a key naming another tenant → 403 (guard) | explicit delete after commit; cascade keeps; the D-22 sweep already deleted keyed objects |
| certificate PDFs | `t/<tenant>/certificates/<basename(file_path)>` | the migration tool only | storage first, legacy second; `res.download`-identical headers for `/pdf`, the inline capability for `/verify/.../document` | — |
| avatars, logos, CMS | `global/avatars|branding|content/<file>` | `promoteFromQuarantine` puts into platform storage | the public mount: storage first, `express.static` fallback, same headers | `deleteUpload`: object + legacy file (`contentMedia` now uses it — its `unlink(file.path)` would have left the object public) |
| tenant backups | `t/<tenant>/backups/<file>` in `file_path` | put of the ZIP buffer; checksum of the bytes | download (object), restore (read once; checksum and parse from memory) | delete, expiry sweep, scheduled pruner (own tenant's `backups` keys; other keys refused like paths outside the directory) |
| GDPR exports | `t/<tenant>/exports/<id>.{json,zip}` | manifest first (W-15), archive after the zip is built in scratch | the caller's tenant's storage first; legacy directory second | W-15 sweep walks every tenant's `exports` domain (500 tenants a page, listing cursor) plus the legacy directory |

Stays on the host deliberately: the quarantine, an export's working directory, CSV imports, logs, job status, the bootstrap password, ops outcome files.

New: `services/storedFile.service.ts` (bridge), `fileResponse.util#sendStorageObject`/`entityTag` (the `/storage/object` body, moved), `keys` domain `content`, `upload.util#{publicStorageKey,publicUploadsFromStorage,assertInQuarantine,PUBLIC_STORAGE_DOMAINS}`, `storageMigration#{migrateCertificates,migrateBackups,migratePublicImages,migrateEverything,copyVerified}`, `SYSTEM_ACTORS.STORAGE_MIGRATION`.

## 3. Defects found on the way (all fixed, each with a test)

- **The `local` driver refused every write and answered 500 to every read when its root did not exist** (`realpath` of the root, ENOENT). A source checkout has no `backend/storage/`. Now: `local` makes its root on the first put and reads a missing root as not found; `nfs` keeps failing (an unmounted export). `storedFile.p801` "local driver — its root" (2 cases). The boot also creates `<root>/storage`.
- **A 416 from the shared sender left a caller's `Content-Length` in place** — the backup and export downloads announce one — so the client waited for a body that never came (found by the identity test timing out). The sender removes it on 416.
- **`putLocalFile` left a read stream open when the put was refused** (found by `storedFile.p801`: ENOENT on a directory removed after the test). It destroys the stream.
- `contentMedia`'s failure path unlinked `file.path`; with the image in storage that would have left a public object for an upload the audit log refused.

## 4. Tests (named)

New:
- `src/tests/routes/storedFiles.identity.p801.test.ts` — 10: identity (GET, HEAD, Range, If-Range miss, 304, and the asserted 416 difference) for attachment download and signed link, certificate `/pdf` and `/verify/.../document`, the public mount, backup and GDPR downloads; gone → 410 on both; cross-tenant 404 and a forged key 403; upload → download → delete through storage on the real local driver.
- `src/tests/services/storedFile.p801.test.ts` — 10 (bridge + `local`/`nfs` root rules).
- `src/tests/services/storageMigration.p801.test.ts` — 10 (certificates, backups with the audited backfill, public images, paging, read-back mismatch, defaults).
- `src/tests/services/gdpr.storedExports.p801.test.ts` — 10 (download from the caller's tenant storage; W-15 storage pass).
- `src/tests/utils/upload.publicStorage.p801.test.ts` — 6.
- `src/tests/scripts/rotateBootstrapPassword.envOrder.test.ts` — 2.
- Added cases: `attachment.service.coverage` (P8-01 block, 6), `tenantBackup.service` (stored restore ×3, download/delete/expiry ×4), `scheduledBackup.service` (prune ×3), `certificatePdf.service` (×3), `gdpr.service` (×2), `tenantBackup.controller` (×1), `storage.controller` (`_entityTag`).
- Fixture: `src/tests/fixtures/fakeStorage.ts` (in-memory bytes, the REAL key rules); `routeClient.ts` captures a piped body and answers `fresh`/`range`.

**Fail-before** (a `git worktree` of HEAD `dded70c` with the new tests copied in): **31 failed, 7 passed of 38**; `storedFile.p801` could not load (no module). The 7 that passed are cases HEAD already satisfied (cross-tenant 404s, the legacy `/verify` paths). `rotateBootstrapPassword.envOrder` failed on HEAD with `order` = `["config", "bootstrapCredential"]`.

**Existing tests changed** (behaviour changes, each commented `P8-01`): unit suites of attachments, backups, GDPR, certificate PDFs, S-17 and storage migration gained the storage double or a real local root; their assertions about the old mechanism were replaced — `promoteFromQuarantine` on the attachment path (now the put), the `uploads/attachments` and `uploads/public/profile` locations in S-17 (now the storage root), the three "backup directory creation" cases (the write path no longer uses the directory), the manifest-first/cleanup assertions of `gdpr.service.test.js` (now objects), and the a360/a364 route tests (the real storage layer; the body is the streamed ZIP). `auditCoverage.p611`: `migrateAttachment` left the allow-list; `systemActors.a124` lists the new actor.

## 5. Live

`scripts/storage/p801-live-check.sh` (new): SeaweedFS (SigV4 enforced), PostgreSQL 18 (pgvector), Redis, all named `p801-<pid>-*`; the backend from this checkout under tsx with `STORAGE_DRIVER=s3`, `SEED_DEMO=true`, `VIRUS_SCAN_PROVIDER=none`; an administrator created in each demo tenant. `scripts/storage/p801-app-path-check.ts` reads the BUCKET with its own client for every "in storage" claim.

**Run 2026-10-05, twice green: 44/44** (the final run after the last script change: exit 0). Highlights: the attachment upload is in the bucket at tenant A's key and nowhere on disk; download 200, `Range` 206, `If-None-Match` 304 (over `node:http` — undici's `fetch` adds `no-cache` to a conditional request, which made the first attempt answer 200); tenant B: download 404, signed-url 404, delete 404 with the object kept; delete removes the object and the signed link then 404s; avatar and logo in `global/…`, served publicly from S3 with the pinned type, nosniff and sandbox CSP, removed on delete; a tenant backup created at `t/<A>/backups/…`, downloaded byte-identical, refused to tenant B, deleted from the bucket; a GDPR export stored, downloaded `no-store`, 404 to tenant B; a legacy certificate PDF and avatar served from disk, copied by `migrate:storage` (exit 0), **served from S3 after the legacy files were deleted**, 404 to the other tenant, a re-run copying nothing; **the bucket's own listing of each tenant prefix equals what is live**. One intermediate run exited at the seeding call while the backend was still booting (curl 22); the script now retries it.

U-09's `scripts/storage/s3-live-check.sh` with `APP_PATH=1`, re-run after the cut-over (its attachment block updated: the upload now lands in the tenant's bucket directly): driver suite 15/15 (SeaweedFS), 15/15 (Versity), app path **27/27**.

Docker hygiene: every `p801-*` and `u09-*` container removed by name (one stray `p801-24243-seaweed` from the curl-22 run removed by name); nothing pruned; the one-time password file removed; my legacy test files under `backend/uploads/` removed. `chrislusf/seaweedfs:latest` and `versity/versitygw:latest` pulled and left (the wrappers pull them each run).

## 6. `bootstrap:rotate` from a source checkout

`scripts/rotateBootstrapPassword.ts` loaded `../config` (which requires the JWT and DB variables at load) before `require("../utils/env.util")`, which sat inside the `require.main` block. Now `import "../utils/env.util"` is the first import, as in `migrateStorage.ts`. Live: before, `npx tsx src/scripts/rotateBootstrapPassword.ts --user x` died at load with "Missing required environment variables: DB_HOST, …"; after, the configuration validates and the CLI reaches the service ("Rotation refused: …" with no database running, exit 1). In the image the variables are the container's, and dotenv never overrides one set, so `./backend rotate-bootstrap-password` is unchanged.

## 7. Gates

- `npx eslint` on every changed file: clean. `node scripts/ci/eslint-ratchet.js`: 0 errors, 0 warnings, baseline 0.
- `npm run typecheck`: 0. `npm run ratchet`: 695 `.js`, at the floor. `npm run build:dist`: 611 TypeScript files. `TSX_DISABLE_CACHE=1 npm run load:check` and `-- --src`: OK (601 modules, 105 in boot order). `npm run openapi:check`: current (no contract changed).
- Full `npm run test:coverage -- --ci`: see § 8.
- The two `scripts/storage/*.ts` checks type-check clean under TypeScript 7 (`--strict --noUncheckedIndexedAccess`, nodenext); they are outside the backend lint scope.

## 8. Coverage

Full `npm run test:coverage -- --ci` (Node 26, after every change above, on a tree shared with other lanes — not a quiet tree): **100 / 100 / 100 / 100** (statements 24,295, branches 12,030, functions 3,649, lines 23,168); **887 suites passed, 37 skipped, 0 failed; 15,032 tests passed, 246 skipped**; 656 s; exit 0. An earlier run in this lane found `storageMigration.p801` "reads 500 rows a page" timing out under load (501 real copies); it now pages over absent files.

Before that, the coordinator relayed from the W-10 lane: `auditCoverage.p611` flagged `storageMigration#migrateAll/migrateBackups/migrateEverything` as unaudited mutations, and coverage was below 100% on the files this card touches. Decision (best practice, recorded in ADR-086 Am. 1 §4): the two row backfills are audited (`system:storage-migration`, one `UPDATE` row each, same transaction) rather than allow-listed — they change where tenant evidence is read from. `migrateAttachment` left the allow-list.

## 9. Still blocked, and on whom

P8-01 is **DONE in code** and **BLOCKED only on the production target**, which the owner/operator must provide:

1. a production bucket (or NFS export) with `STORAGE_DRIVER=s3`/`nfs` set in the deployment;
2. S3 credentials from the **ambient chain** (IAM role / Kubernetes service account) — every run here used static keys;
3. `migrate:storage` run against the production data, with the destination counted from the bucket.

Not proven here: MinIO, AWS S3, R2, Wasabi; TLS to the endpoint; multipart (objects above 5 GiB); ClamAV in the live run (the order is unit-proven). **Follow-up recorded, not built:** ADR-084's per-attachment quota exemption (needs a per-row record of the storage written to). The legacy disk can be reclaimed only by hand, after `migrate:storage`; no tool exists for that step.

## 10. Coordination

Other lanes touched nearby: W-10 (bodyless requests) — I changed `controllers/attachment.controller.ts` (`download`/`downloadSigned` through a shared `sendAttachment`), nothing that reads `req.body`. U-06 — none of my files. CI lane — none.
