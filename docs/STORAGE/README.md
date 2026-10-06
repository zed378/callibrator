# Storage

Where uploaded bytes live. That covers the pluggable object-storage layer (`local`, `s3`, `nfs`; a platform default plus a per-tenant override) that every stored file goes through since P8-01, the legacy on-disk paths still read as a fallback for files written before it, and the tool that copies one into the other.

> **Target standard: TypeScript, strict (ADR-038).** As built, the storage layer is **JavaScript/CommonJS**: `backend/src/services/storage/*.js`, `storageSettings.service.js`, `storageMigration.service.js`, `scripts/migrateStorage.js`, `storage.controller.js`, `storage.route.js`. Documents here name each file by its real extension and label current behaviour **as-built**. Conversion happens module by module under [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md).

## Documents

| | Document | Covers |
|---|---|---|
| 02 | [Storage Operations and Migration](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) | operator runbook for `npm run migrate:storage`: preconditions, invocation and its argument traps, how a row is judged migrated, checksum handling (A-40), what can go wrong quietly, and the fact that there is no rollback tool |
| 04 | [Tenant Storage](./04-TENANT-STORAGE.md) | the layer itself: providers, resolution order and the cross-replica driver cache, keys as the isolation boundary, signed downloads, the `/api/v1/storage` endpoints and their gate, credentials at rest, traps, named suites |

`00`, `01`, `03` and everything from `05` on are unassigned. A link to a `STORAGE/` path that is absent from the table above is a broken link, not a hidden document.

## The Short Version

**Every file the application keeps goes through the layer (P8-01, 2026-10-05, ADR-086 Amendment 1).** Attachments, the stored certificate PDFs, avatars, tenant logos, CMS images, tenant backups and GDPR exports are written, read (with Range, ETag/304 and the hardened headers), signed and deleted through `services/storage` — on the `local` driver (the default, `/app/storage`), NFS or S3 alike. A file written before the cut-over is still read from its legacy path until `npm run migrate:storage` copies it. Scratch files that live for one request (the upload quarantine, a GDPR export being built, a CSV import) stay on the host's disk. P8-01 is **DONE in code**; it stays **BLOCKED only on the production target**: a production bucket or NFS export and the ambient IAM credential chain. See [`04`](./04-TENANT-STORAGE.md) § Read This First, [record](../../MEMORY/records/2026-10-05-p8-01-storage-cutover.md).

**A-40 is fixed in code.** A settings change now invalidates the driver cache on every replica through a Redis generation key. The migration verifies every copy: against the recorded checksum, or against the source file when the row has none. See [`02`](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) § Checksum Handling.

**The S3 driver has run live** (U-09, 2026-10-05): against SeaweedFS and Versity S3 Gateway, and through a running backend's `/api/v1/storage` and `migrate:storage` on PostgreSQL 18 — `scripts/storage/s3-live-check.sh`, [record](../../MEMORY/records/2026-10-05-u09-s3-live.md). Not against MinIO, AWS S3 or R2, and not with the ambient IAM chain. See [`04`](./04-TENANT-STORAGE.md) § Tests.

**The migration has no undo.** Its recorded end-to-end runs: U-09's (one attachment into a tenant's S3 bucket) and P8-01's (a certificate PDF and an avatar through a running backend on SeaweedFS, then served from S3 with the legacy files removed, and a re-run copying nothing; [record](../../MEMORY/records/2026-10-05-p8-01-storage-cutover.md)). Read [`02`](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) before running it.

## Related

| For | Read |
|---|---|
| the architecture this category implements | [`../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`](../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md) |
| the endpoints in API terms | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/storage` |
| the deny-by-default rule the key guard mirrors | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02, A-40 · `TASKS/PHASE-8-SCALE-AND-REACH.md` § P8-01 |
