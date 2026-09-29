# 02 — Storage Operations and Migration

An operator runbook for the one tool that moves data into pluggable storage: `migrate:storage`, which copies legacy on-disk attachments into the configured backend and records where it put them. It covers what must be true before you run it, how to run it, how it decides a row succeeded, what the checksum does, and what you can and cannot undo.

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

**Migrating a row does not change how it is served.** The attachment upload and download path still reads `folder`/`fileName` from local disk. Nothing in the request path reads `attachments.storage_key`. Its only readers are this tool and the deleted-file sweep (`attachmentFileSweep.service.js:123–125`, which also deletes a migrated row's object). The migration prepares for a cutover that has not happened ([`04`](./04-TENANT-STORAGE.md) § Read This First; `TASKS/PHASE-8-SCALE-AND-REACH.md` § P8-01, **BLOCKED** on a target S3/NFS environment).

**The tool has never been recorded running end to end.** The only recorded invocation is `MEMORY/records/2026-09-28-p9-helper-lint-baseline-coverage.md`: `npm run migrate:storage -- --dry-run` loaded under `tsx`, printed its header, and then failed because no PostgreSQL was available. Plain `node` failed at `Cannot find module './packaged.util'`. The migration `0056` header states that the reference deployment had zero attachments when it ran. Everything below is read from the code and its unit suite (`backend/src/tests/services/storageMigration.service.test.js`, which mocks the model, the filesystem streams and the storage façade). **A mock proves the client, not the contract.**

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

The CLI prints one line per row (`<status> <id> -> <key>`) and a final `Done. total=… migrated=… skipped=… missing=… wouldMigrate=… failed=…`. It exits `1` if `failed > 0` or if the run crashed (`migrateStorage.js:56–64`). One failing row never stops the others (`migrateAll`, `:176–184`). `logger.error("Attachment migration failed", { id, error })` records each failure, and a final `logger.info("Storage migration complete", …)` records the counts.

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
- **Serving does not depend on `storage_key`** (§ Read This First). A wrong or partial migration changes nothing a user sees today.

An undo, if one is needed, is manual and **unverified**. Nobody has run it:

1. **First record which objects to remove.** `SELECT id, storage_key FROM attachments WHERE tenant_id = '<uuid>' AND storage_key IS NOT NULL AND file_purged_at IS NULL;` — save the output. After the next step, this list exists nowhere else.
2. In `psql`, clear the keys. Scope the statement by tenant, because this is raw SQL and the hooks do not apply: `UPDATE attachments SET storage_key = NULL WHERE tenant_id = '<uuid>' AND storage_key IS NOT NULL AND file_purged_at IS NULL;`. The last condition leaves alone the rows that were migrated, then soft-deleted and swept (`file_purged_at` set). Their objects and files are already gone.
3. Delete exactly the objects listed in step 1 from the target backend, with the backend's own tooling (an S3 console or CLI, or `rm` under the local/NFS root). `ScopedStorage.deleteMany(domain)` (`services/storage/index.js:122`) would remove a tenant's whole `attachments` domain, **including objects not written by the migration**. No CLI exposes it, and it should not be used for this.
4. Restore from the backup instead (precondition 6) if the database state is in doubt.

Once the read path is cut over to `storage_key` (not built), this stops being true. At that point a rollback changes what users are served, and this section must be rewritten before the first cut-over run.

## Related

| For | Read |
|---|---|
| providers, keys, credentials, signed URLs, the driver cache | [`04-TENANT-STORAGE.md`](./04-TENANT-STORAGE.md) |
| the storage architecture and the cutover plan | [`../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`](../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md) · `TASKS/PHASE-8-SCALE-AND-REACH.md` § P8-01 |
| the finding | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-40 |
| migrations that report success while doing nothing (a different tool, the same lesson) | [`../../CLAUDE.md`](../../CLAUDE.md) § The Traps |
