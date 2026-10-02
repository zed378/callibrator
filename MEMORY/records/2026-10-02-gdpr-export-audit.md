# A-364 — the GDPR export request is audited

**Date:** 2026-10-02 · **Agent:** A-364 helper (under the owner's delegation) · **Found by:** the A-359…A-363 lane ([record](./2026-10-02-a359-a363.md) § A-360 "Follow-up"; ADR-114) · **ADR:** none (no decision; the contract already said `audited: true`, and the code now does it)

## Defect

`POST /api/v1/gdpr/export` is published `audited: true` (`backend/src/routes/api/gdpr.openapi.ts`), and an Article 15 export compiles a ZIP of the subject's personal data. `gdpr.service#exportUserData` wrote the manifest and the archive and **no audit row**. Only the later download (A-360, `getExportDownload`) wrote one, so an export that was built but never downloaded left no trace in `audit_logs`, and the record of the disclosure had no record of what was disclosed being assembled.

## Why the P6-11 guard did not catch it

`backend/src/tests/guards/auditCoverage.p611.test.ts` flags an exported service entry point that MUTATES and reaches no `logAction(`. "Mutates" meant a **database** write (`MUTATION`: `.create(`, `.update(`, `.destroy(`, raw `INSERT/UPDATE/DELETE`, …). `exportUserData` writes only **files** (`fs.promises.writeFile`, the archiver, `fs.promises.rm`), so the guard saw no mutation and passed it. Its companion `auditInTransaction.p611.test.js` only checks the `logAction` calls that exist. Nothing reads the contract's `audited:` flag.

**Hole closed:** a file write is now a mutation for the guard — `FILE_WRITE` (`writeFile`, `writeFileSync`, `appendFile`, `createWriteStream`, `copyFile`, `rename`, `unlink`, `rm`, `rmdir` and their sync forms; a read or `mkdir` alone is not one). The widened scan found four other file-only entry points that write no audit row; each was reviewed and listed with its reason (none is a principal's action on user data):

| Entry point | Why no row |
|---|---|
| `jobMonitor.service#runMonitored`, `#checkOverdue`, `#watchdogTick` | the job monitor's own state file (temp file + rename) |
| `quarantineSweep.service#sweepQuarantine` | abandoned, never-scanned uploads a dead process left in the quarantine (S-33); never published, no row names them |

The known-gap category stays empty. `tenantBackup#cleanupExpiredBackups` was already listed. The remaining limit (stated in the guard): a write through a helper in another file (`upload.util#deleteUpload`, a storage driver) is not followed, and the contract's `audited: true` is still not cross-checked against the handler — a route → controller → service resolver is a larger piece of work, and it is not done here.

## Fix

- **`backend/src/services/gdpr.service.ts` `exportUserData(tenantId, userId, actor = null)`**: once the ZIP is written and the unpacked copy removed, ONE row — `action: EXPORT`, `resourceType: DataExport`, `resourceId: <exportId>`, `changes: { operation: "GDPR_EXPORT_CREATE", fileSize, expiresAt, subjectId }` (+ `apiKeyId` for a key) — through the existing `auditGdpr` helper, in `db.transaction`, **before** the export id is answered. If the row cannot be written, the existing catch deletes the ZIP and the manifest and the request is a 500: no row, no export. An export that fails earlier (no such subject: 404) writes no row, because no export exists.
  - The third parameter was `_options`, accepted and never read ("as built"); no caller passed it. It is now `actor`.
  - **Why this shape (a non-database action):** the export has no rows of its own, so there is no mutation transaction to join. The codebase's pattern for an audited file action is the file work first, then the audit row as the only database write, with no row → no result: `contentMedia.service#recordMediaUpload` (a null row deletes the uploaded file and refuses) and `gdpr.service#getExportDownload` (A-360: the row in `db.transaction` before the file is handed over). The export follows the download's form (same helper, same transaction, the `EXPORT` action and `DataExport` resource), so one export id carries two rows: `GDPR_EXPORT_CREATE`, then `GDPR_EXPORT_DOWNLOAD`. Writing the row FIRST was rejected: a later failure (archiver, disk) would leave a row recording an export that does not exist.
  - Nothing personal is recorded: the operation, the size and the expiry. `subjectId` is the caller's own id (as every `auditGdpr` row carries).
- **`backend/src/controllers/gdpr.controller.ts`**: passes `auditPrincipal(req)` (user, API key, IP, user agent), as the download and the other GDPR mutations do.
- **`docs/BACKEND/10-MODULE-REFERENCE.md`** (GDPR § Export rule and § Logging): states the export's row (as-built description, no deviation).
- The contract (`gdpr.openapi.ts`) already said `audited: true`; it is unchanged, so `openapi.json` and the frontend schema are unchanged.

## Test doubles (eight export suites)

The suites that run `exportUserData` and had no transaction double got one; no assertion was removed or weakened:

| Suite | Change |
|---|---|
| `services/gdpr.exportStream.d24.test.js` | `db: {}` → `db: { transaction: cb => cb({ id: "tx" }) }` |
| `services/gdpr.exportDecimals.q55.test.ts` | the same, typed |
| `services/gdpr.exportProfile.a140.test.js` | `db.transaction` double on its unconnected Sequelize (as `gdpr.subject.a151.a154`), and `audit.service` mocked as the other export suites mock it (the real one inserted through the SQL double, which answers nothing) |
| `controllers/gdpr.controller.test.js` | the two `exportUserData` call assertions now also require the actor (`objectContaining({ userId })`) — stronger |
| `services/gdpr.service.test.js`, `gdpr.a180.test.js`, `gdpr.subject.a151.a154.test.js`, `gdpr.tenantPredicates.p918.test.ts`, `routes/gdpr.exportDownload.a360.test.ts` | unchanged: they already had a transaction double (or memoryDb) and pass |

## Tests

- **New: `backend/src/tests/routes/gdpr.exportAudit.a364.test.ts` — 4**, the REAL router, controller, service, `audit.service`, models and tenant hooks over `fixtures/memoryDb`:
  1. one committed `AuditLog` write, in a transaction (`tx` set): tenant, user, `EXPORT`, `DataExport`, `resourceId` = the answered `exportId`, the request's user agent, `changes` exactly `{ operation, fileSize, expiresAt, subjectId }` equal to the answer; the row holds none of the subject's email, bcrypt-shaped password, MFA secret or phone;
  2. a failed audit write → 500, no export id in the body, nothing committed, the exports directory empty (no ZIP, no manifest);
  3. no such subject → 404, no row, nothing on disk;
  4. export then download → two rows for the same export id, `GDPR_EXPORT_CREATE` then `GDPR_EXPORT_DOWNLOAD`.
- **`backend/src/tests/guards/auditCoverage.p611.test.ts` — +3**: "gdpr.service#exportUserData is a mutating entry point that reaches an audit write"; synthetic "an entry point that writes only FILES is a mutation, and is flagged without an audit write"; synthetic "a file-writing entry point that reaches logAction( is audited".
- **Fail-before**, in a scratch copy of `backend/src` (`Callibrator/.scratch-a364/`, junctions to the two `node_modules`, removed afterwards) with `exportUserData` and the controller restored to their pre-fix form: route suite 3 of 4 failed (case 3 passes before too — it pins the refusal); guard: the `exportUserData` pin and "no mutating entry point is unaudited unless it is listed" (it named `services/gdpr.service#exportUserData`) failed; controller 2 of 2 failed. With the guard's old definition (`mutates` = database only), both synthetic cases failed, and "no mutating entry point is unaudited" PASSED on the pre-fix service — the hole, reproduced.

## Gates (2026-10-02)

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run ratchet` | 695 `.js`, at the floor |
| `node scripts/ci/eslint-ratchet.js` | 0 errors, 0 warnings; baseline 0 |
| `npx eslint` on the 8 changed backend files | 0 |
| `npm run build:dist` | 604 TypeScript files compiled; contracts 52 |
| `TSX_DISABLE_CACHE=1 npm run load:check` / `-- --src` | OK (dist via node; src via tsx): 595 modules, boot order 105 |
| `npm test -- gdpr audit` | 66 suites passed, 3 skipped; 811 tests passed, 17 skipped |
| `npm run test:coverage -- --ci` | **100 / 100 / 100 / 100**; 869 suites passed, 36 skipped, 0 failed; 14,859 tests passed, 231 skipped (busy tree, Node 26). No flakes this run |

Not run: live E2E (another agent's stack), PostgreSQL (no schema change: `audit_logs` already takes `EXPORT`).

## Files

- `backend/src/services/gdpr.service.ts`, `backend/src/controllers/gdpr.controller.ts`
- Tests: `backend/src/tests/routes/gdpr.exportAudit.a364.test.ts` (new), `backend/src/tests/guards/auditCoverage.p611.test.ts`, `backend/src/tests/controllers/gdpr.controller.test.js`, `backend/src/tests/services/gdpr.exportStream.d24.test.js`, `backend/src/tests/services/gdpr.exportDecimals.q55.test.ts`, `backend/src/tests/services/gdpr.exportProfile.a140.test.js`
- `docs/BACKEND/10-MODULE-REFERENCE.md`, `TASKS/AUDIT-2026-09-REMEDIATION.md` (A-364 row; A-360's follow-up points to it), `TASKS/PROGRESS.md`, `MEMORY/CHANGELOG.md`, `MEMORY/MEMORY-INDEX.md`
