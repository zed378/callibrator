# Storage

Where uploaded bytes live. That covers the pluggable object-storage layer (`local`, `s3`, `nfs`; a platform default plus a per-tenant override), the legacy on-disk path the application still serves from, and the tool that copies one into the other.

> **Target standard: TypeScript, strict (ADR-038).** As built, the storage layer is **JavaScript/CommonJS**: `backend/src/services/storage/*.js`, `storageSettings.service.js`, `storageMigration.service.js`, `scripts/migrateStorage.js`, `storage.controller.js`, `storage.route.js`. Documents here name each file by its real extension and label current behaviour **as-built**. Conversion happens module by module under [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md).

## Documents

| | Document | Covers |
|---|---|---|
| 02 | [Storage Operations and Migration](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) | operator runbook for `npm run migrate:storage`: preconditions, invocation and its argument traps, how a row is judged migrated, checksum handling (A-40), what can go wrong quietly, and the fact that there is no rollback tool |
| 04 | [Tenant Storage](./04-TENANT-STORAGE.md) | the layer itself: providers, resolution order and the cross-replica driver cache, keys as the isolation boundary, signed downloads, the `/api/v1/storage` endpoints and their gate, credentials at rest, traps, named suites |

`00`, `01`, `03` and everything from `05` on are unassigned. A link to a `STORAGE/` path that is absent from the table above is a broken link, not a hidden document.

## The Short Version

**The layer is built, but attachments do not use it yet.** Uploads and downloads still go through `attachment.service.js` and the `uploads/` directory on the app server. The pluggable layer is reachable through `/api/v1/storage` (tenant-admin settings, token-gated object reads) and through the migration tool. Cutting the request path over is Phase 8 card P8-01, **BLOCKED** on a target S3/NFS environment (ADR-086). See [`04`](./04-TENANT-STORAGE.md) § Read This First.

**A-40 is fixed in code.** A settings change now invalidates the driver cache on every replica through a Redis generation key. The migration verifies every copy: against the recorded checksum, or against the source file when the row has none. See [`02`](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) § Checksum Handling.

**The migration has never been recorded running end to end** against a real database, and it has no undo. Read [`02`](./02-STORAGE-OPERATIONS-AND-MIGRATION.md) before running it.

## Related

| For | Read |
|---|---|
| the architecture this category implements | [`../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md`](../ARCHITECTURE/05-STORAGE-ARCHITECTURE.md) |
| the endpoints in API terms | [`../API/13-INTEGRATION-API.md`](../API/13-INTEGRATION-API.md) § `/api/v1/storage` |
| the deny-by-default rule the key guard mirrors | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-02, A-40 · `TASKS/PHASE-8-SCALE-AND-REACH.md` § P8-01 |
