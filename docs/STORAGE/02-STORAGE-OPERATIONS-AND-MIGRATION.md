# 02 — Storage Operations and Migration

An operator runbook for the one tool that moves data into pluggable storage: `migrate:storage`, which copies legacy on-disk files — attachments and, since P8-01 (ADR-086 Amendment 1), certificate PDFs, tenant backups and the public image class — into the configured backend and records where it put them. It covers what must be true before you run it, how to run it, how it decides a row succeeded, what the checksum does, and what you can and cannot undo.

> **Target standard: TypeScript, strict (ADR-038).** As built, every file named here is **JavaScript/CommonJS**: `backend/src/services/storageMigration.service.js`, `backend/src/scripts/migrateStorage.js`, and the storage layer under `backend/src/services/storage/`. Some modules they load are already `.ts` (Phase 9, ADR-087), so the tool must run under `tsx` (§ Invocation).

**Sources** (under `backend/src/` unless noted):

- `services/storageMigration.service.js`: `legacyPath`, `migrateAttachment`, `migrateAll`, `hashStream`
- `scripts/migrateStorage.js`: the CLI
- `services/storage/index.js`: `getTenantStorage`, `ScopedStorage`, the driver cache
- `services/storage/local.driver.js` and `services/storage/s3.driver.js`
- `services/storage/config.service.js`
- `models/attachment.model.js`
- migration `0016-add-attachment-storage-key.js`
- `backend/package.json` (`migrate:storage`)

The layer itself (providers, keys, credentials, signed URLs) is [`04-TENANT-STORAGE.md`](./04-TENANT-STORAGE.md). This document does not repeat it.

---

## Read This First

**Since P8-01 (2026-10-05, ADR-086 Amendment 1) migrating a file CHANGES WHERE IT IS SERVED FROM.** The request paths read storage first: an attachment row with a `storage_key` is served, signed and deleted from that object; a certificate PDF from `t/<tenant>/certificates/<file>` when that object exists; an avatar, logo or CMS image from `global/<avatars|branding|content>/<file>` when it exists; a backup from the key its `file_path` names. Only when the object is absent is the legacy path read. New files never touch the legacy paths. The legacy file is still left in place by the tool, so until you remove it a failed object read never falls back to a stale copy silently — the object either exists (served) or does not (legacy read).

**What the tool copies (P8-01):**

| Class | Source | Key | Row change |
|---|---|---|---|
| attachments | `<root>/<folder>/<fileName>` | `t/<tenant>/attachments/<fileName>` | `storage_key` set, **with one `UPDATE` audit row (`system:storage-migration`) in the same transaction** |
| certificate PDFs | `<root>/uploads/certificates/<basename(file_path)>` | `t/<tenant>/certificates/<file>` | none — the (signed) row is never rewritten; the key is derived from `file_path` |
| tenant backups | the row's `file_path`, refused outside `<root>/backup/tenant-backups/` | `t/<tenant>/backups/<file>` | `file_path` set to the key, verified against the recorded checksum, **with one audit row** as above |
| public images | `<root>/uploads/public/{profile,tenant,cms}/*` (images only; `default.svg` and unkeyable names skipped) | `global/{avatars,branding,content}/<file>` | none |

GDPR exports are not copied: they live seven days, and the legacy directory is still read and swept until the last pre-cut-over one expires. Every class is resumable (an object already present with the same bytes is `skipped`; one with OTHER bytes fails and is not overwritten), verified (read back and hashed), and reads rows 500 at a time. `--tenant` limits attachments, certificates and backups to one tenant and skips the public images (they are the platform's).

**P8-01's run** (2026-10-05, `scripts/storage/p801-live-check.sh`, [record](../../MEMORY/records/2026-10-05-p8-01-storage-cutover.md)): through a running backend with `STORAGE_DRIVER=s3` on SeaweedFS, a legacy certificate PDF and a legacy avatar laid on disk were served from there, copied by `migrate:storage` (exit 0) byte-identical into the bucket, served from S3 after the legacy files were deleted, and a re-run copied nothing. The bucket's own listing, not the tool's report, matched what is live.

**The first end-to-end run is recorded** (U-09, 2026-10-05, [`MEMORY/records/2026-10-05-u09-s3-live.md`](../../MEMORY/records/2026-10-05-u09-s3-live.md)): on a throwaway PostgreSQL 18, one attachment uploaded through `POST /attachments` was copied by `migrateStorage.ts --tenant <id>` into that tenant's S3 bucket (SeaweedFS), verified against the source file, read back byte-identical from the bucket, and skipped by a re-run (`migrated=0`); `scripts/storage/s3-live-check.sh` with `APP_PATH=1` repeats it. One row is not a production volume. Before that, the only recorded invocation was `MEMORY/records/2026-09-28-p9-helper-lint-baseline-coverage.md`: `npm run migrate:storage -- --dry-run` loaded under `tsx`, printed its header, and then failed because no PostgreSQL was available. Plain `node` failed at `Cannot find module './packaged.util'`. The migration `0056` header states that the reference deployment had zero attachments when it ran. Everything below is read from the code and its unit suite (`backend/src/tests/services/storageMigration.service.test.js`, which mocks the model, the filesystem streams and the storage façade). **A mock proves the client, not the contract.**

## Preconditions

| # | Check | Why |
|---|---|---|
| 1 | **The target storage is configured,** in the same environment the tool will read: `STORAGE_DRIVER` plus its keys for the platform default, or a tenant's saved override (`storage_config` / `storage_credentials` in `tenant_settings`) | the tool copies into whatever `getTenantStorage(attachment.tenantId)` resolves: the tenant's override, else the platform default. **With `STORAGE_DRIVER` unset the default is `local`** (`config.service.js:32`), rooted at `storagePath("storage")`. A run with nothing configured therefore "migrates" every file into a second directory on the same disk and marks it migrated |
| 2 | `KMS_MASTER_KEY` is set to the deployment's key | a tenant override's credentials are a KMS envelope. Without the key they cannot be decrypted, and that tenant's rows fail |
| 3 | the database environment (`DB_*`) points at the deployment's database | the tool loads `../config` and reads and writes `attachments` directly |
| 4 | **the legacy files are visible at `<storage root>/uploads/…`** from where the tool runs | the source path is `storagePath(<folder>, <fileName>)`, and anything outside `path.resolve(storagePath("uploads"))` is refused (`legacyPath`, S-15). Unpackaged, the storage root is the `backend/` directory, so the uploads volume must appear at `backend/uploads/` of the checkout you run from |
| 5 | a **source checkout with `node_modules`**, not the production image | the image runs a `pkg` binary (`backend/Dockerfile`, `CMD ["./backend"]`), and the tool is not one of its entry points. No Makefile target, Helm job or binary subcommand runs it. How to run it against a containerised deployment is **not documented anywhere in this repository and not verified.** Mounting the uploads volume and the environment into a checkout is the implied route |
| 6 | a **database backup** and a copy of the uploads volume | § Rollback. There is no tool-level undo |
| 7 | Redis reachable (optional) | the driver cache reads its generation from Redis. When Redis is not ready, `redis.service#get` returns `null` and the tool still works |

## Invocation

From `backend/`:

```bash
npm run migrate:storage -- --dry-run               # report only; writes nothing
npm run migrate:storage -- --tenant <uuid> --dry-run
npm run migrate:storage -- --tenant <uuid> --limit 100
npm run migrate:storage                            # every tenant, every unmigrated row
```

`migrate:storage` is `tsx src/scripts/migrateStorage.js` (`backend/package.json:47`). The usage block at the top of `migrateStorage.js` still says `node src/scripts/migrateStorage.js`. **That form no longer loads** (the record above), so use the npm script.

**The argument parser is permissive. Read the first line it prints before letting it run.** `parseArgs` (`migrateStorage.js:22–31`) knows exactly three flags and ignores everything else silently:

| You type | What happens |
|---|---|
| `--dryrun`, `--dry_run`, `-n` | **ignored: a real run** |
| `--tenant` with no value after it | `tenantId` is `undefined`: **every tenant** |
| `--tenant --dry-run` | `tenantId` becomes the string `"--dry-run"`, and dry-run is **off**. The query then fails on the UUID and the tool exits 1 |
| `--limit abc` | `Number("abc")` is `NaN`, which is falsy: **no limit** |

The header line says `Storage migration (dry-run)…` and names the tenant when one is set. If it does not say what you meant, stop the process.

## What It Does, Per Row

`migrateAll` (`storageMigration.service.js:154`) selects `Attachment.findAll({ where: { storageKey: null [, tenantId] }, order: [["createdAt","ASC"]] [, limit] })`. The attachment model's default scope and `paranoid` exclude soft-deleted rows, so **only live rows are migrated**. The CLI has no tenant context, so the tenant hooks add no predicate (`tenantScope.util.ts#resolveScope`: no context means `skip`). **The run is cross-tenant unless you pass `--tenant`.** All matching rows are loaded into memory at once. Use `--limit` on a large table.

Then, for each row, in order (`migrateAttachment`, `:73–143`):

1. **Already keyed?** A row with a `storageKey` returns `skipped`. That is what makes a re-run resume. The query already filters these rows out, so in practice this branch only fires when a row gains a key during the run.
2. **Source path.** `legacyPath` builds `storagePath(...folder, fileName)` and refuses a path outside `<root>/uploads/` with a 400. The row is recorded as `failed`.
3. **Source present?** A missing file returns `missing-source` with the path, and the run continues.
4. **Target key.** `t/<tenantId>/attachments/<fileName>`, built by `getTenantStorage(row.tenantId).buildKey`. The key is bound to the row's **own** tenant, and `ScopedStorage` re-checks that on every call.
5. **Dry run** stops here with `would-migrate` and the key.
6. **Hash the source** (SHA-256 of the file on disk).
7. **Refuse a changed source.** If the row has a `checksum` and the source hash differs, the tool throws and the row is `failed`. **Nothing has been copied at this point.**
8. **Copy.** `put(key, stream, { contentType: mimeType || "application/octet-stream" })`. Both drivers **overwrite** an existing object at that key: the local driver opens with `"w"`, and S3 `PutObject` replaces.
9. **Read back and hash** the object from storage.
10. **Compare** it with the expected hash: the row's `checksum`, or the source hash from step 6 when the row has none. On a mismatch the tool deletes the object (a failure of that delete is swallowed) and throws. The row is `failed`.
11. **Record.** `attachment.storageKey = key; attachment.save({ hooks: false })`. The row is `migrated`, `verified: true`, with `verifiedAgainst: "recorded-checksum"` or `"source-file"`.

## How Success Is Decided

| Outcome | Summary counter | Exit code | Meaning |
|---|---|---|---|
| `migrated` | `migrated` | 0 | the object read back from storage hashes to the expected SHA-256, and the key is saved |
| `skipped` | `skipped` | 0 | already had a key |
| `would-migrate` | `wouldMigrate` | 0 | dry run only |
| `missing-source` | `missingSource` | **0** | the row has no file on disk. **This does not fail the run.** Read the count |
| `failed` | `failed` | **1** | anything thrown: a path outside `uploads/`, a changed source, a copy or read error, a mismatch after the copy, a save error |

The CLI prints one line per row (`<status> <id> -> <key>`) and, since P8-01, `Done.` followed by one summary line per class (`attachments`, `certificates`, `backups`, `publicImages`, each `total=… migrated=… skipped=… missing=… wouldMigrate=… failed=…`). It exits `1` if any class has `failed > 0` or if the run crashed (`migrateStorage.js:56–64`). One failing row never stops the others (`migrateAll`, `:176–184`). `logger.error("Attachment migration failed", { id, error })` records each failure, and a final `logger.info("Storage migration complete", …)` records the counts.

**A zero exit is not a clean migration.** Check `missing` too. Those rows stay on `storage_key IS NULL`, and every re-run lists them again.

## Checksum Handling — A-40

`attachments.checksum` is `STRING(64)`, the hex SHA-256 of the file, computed at upload (`attachment.service.js:521`, `computeChecksum`). Current uploads always have one. A `NULL` checksum is a row from before that computation existed. Which rows those are has not been established here.

**Status: fixed in code** (A-40, DONE 2026-09-25, recorded under ADR-057). When A-40 was found (2026-09-23), the copy was verified only `if (attachment.checksum && …)`. A row with no checksum was copied **unchecked** and reported `status: "migrated", verified: false`, so the operator-facing claim "verified copy" was false for those rows. Today (`storageMigration.service.js:97–142`):

| The row has | The copy is verified against | What that proves | What it does not prove |
|---|---|---|---|
| a `checksum` | the recorded checksum, **and** the source must match it before any copy | the stored object is byte-identical to what was uploaded | — |
| no `checksum` | the source file's hash, taken just before the copy | the stored object is byte-identical to **the file as it is on disk now** | that the file on disk is what was uploaded. `verifiedAgainst: "source-file"` says exactly this, and no stronger claim is available |

There is no `verified: false` outcome any more. Every `migrated` row is verified against one of the two.

A-40's other half, the per-process driver cache, is also fixed: a settings change bumps a Redis generation that every replica compares against (`services/storage/index.js:46–56, 169–195, 253–262`), with a 60 s local TTL bound when Redis is down. That matters here in one way. **Do not change a tenant's storage settings while a migration for that tenant is running.** The cached driver can switch mid-run, so earlier rows land in the old backend and later rows in the new one, each verified against the backend it was written to. Nothing in the tool detects this.

Tests (unit, mocked): `storageMigration.service.test.js` › "A-40: a row with no recorded checksum is verified against the source file, not reported unverified", "A-40: a row with no recorded checksum whose copy differs from the source is FAILED and rolled back", "A-40: a source that no longer matches its recorded checksum is refused before copying". This document did not run them.

## Things That Can Go Wrong Quietly

Read from the code. None of these has been observed in a run.

- **Key collision.** The key is `t/<tenant>/attachments/<fileName>`. Two live rows of one tenant with the same `fileName` get the same key. The second copy overwrites the first object, both rows verify against their own source, and afterwards the first row's key points at the second row's bytes. `fileName` is "opaque, randomized by multer" (`attachment.model.js:49`), so this needs rows that share a name, for example rows copied or restored by hand. No uniqueness constraint prevents it. Before a real run, `SELECT tenant_id, file_name, count(*) FROM attachments WHERE storage_key IS NULL AND is_deleted = false GROUP BY 1, 2 HAVING count(*) > 1` should return nothing.
- **Orphaned objects.** If the copy and verification succeed and `save` then fails, the object stays in storage with no row pointing at it. A re-run copies it again over the same key. Nothing lists or removes such objects.
- **A hook bypass.** `save({ hooks: false })` skips the model hooks, including tenant stamping and checking. The key was built from the row's own `tenantId`, so it is consistent, but it is a bypass, and it writes no `audit_logs` row. **The migration leaves no audit trail** beyond the log lines.
- **A file that changes during the run.** The source is hashed (step 6) and then read again for the copy (step 8). A file modified between the two reads fails the comparison and the row is `failed`, which is the correct outcome.

## Rollback

**There is none in the tool.** No `--undo`, no script, no endpoint clears `storage_key` or deletes the copied objects. What limits the damage:

- **The legacy file is never touched.** It is not moved, deleted or rewritten. Reclaiming disk is described as "a separate, deliberate step" (`storageMigration.service.js:17–18`), and **no tool for that step exists either.**
- **Serving prefers the object** (P8-01). A partial migration is safe — an unmigrated file is still served from its legacy path — but a WRONG object (one whose bytes differ) would be served. The tool refuses to overwrite an object whose bytes differ from the source, and verifies every copy it makes, for that reason.

An undo, if one is needed, is manual and **unverified**. Nobody has run it:

1. **First record which objects to remove.** `SELECT id, storage_key FROM attachments WHERE tenant_id = '<uuid>' AND storage_key IS NOT NULL AND file_purged_at IS NULL;` — save the output. After the next step, this list exists nowhere else.
2. In `psql`, clear the keys. Scope the statement by tenant, because this is raw SQL and the hooks do not apply: `UPDATE attachments SET storage_key = NULL WHERE tenant_id = '<uuid>' AND storage_key IS NOT NULL AND file_purged_at IS NULL;`. The last condition leaves alone the rows that were migrated, then soft-deleted and swept (`file_purged_at` set). Their objects and files are already gone.
3. Delete exactly the objects listed in step 1 from the target backend, with the backend's own tooling (an S3 console or CLI, or `rm` under the local/NFS root). `ScopedStorage.deleteMany(domain)` (`services/storage/index.js:122`) would remove a tenant's whole `attachments` domain, **including objects not written by the migration**. No CLI exposes it, and it should not be used for this.
4. Restore from the backup instead (precondition 6) if the database state is in doubt.

**P8-01 (2026-10-05): the read path IS cut over.** Steps 1–3 above now change what users are served: after step 2 an attachment is served from its legacy file again, which must still exist (the tool never removes it, so it does unless someone reclaimed the disk). Do not reclaim legacy disk until the migrated objects have been read back by users for a while; there is no way back once both copies are gone. Backups migrated by the tool also had `file_path` rewritten — undo is the same pattern on `tenant_backups.file_path`, using the audit rows (`resourceType` `TenantBackup`, `changes.operation` `STORAGE_MIGRATE`, `changes.filePath.before`) as the record of the old paths. **Never clear the `storage_key` of an attachment uploaded after the cut-over:** it has no legacy file, and clearing the key makes it unreachable (410). Step 1's `SELECT` must therefore be limited to the rows the TOOL keyed — those with a `STORAGE_MIGRATE` audit row (`SELECT resource_id FROM audit_logs WHERE resource_type = 'Attachment' AND changes->>'operation' = 'STORAGE_MIGRATE' AND tenant_id = '<uuid>'`). Neither undo has been run.

## Related

| For | Read |
|---|---|
| providers, keys, credentials, signed URLs, the driver cache | [`04-TENANT-STORAGE.md`](./04-TENANT-STORAGE.md) |
| the storage architecture and the cutover plan | [`../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`](../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md) · `TASKS/PHASE-8-SCALE-AND-REACH.md` § P8-01 |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-40 |
| migrations that report success while doing nothing (a different tool, the same lesson) | [`../../CLAUDE.md`](../../CLAUDE.md) § The Traps |
