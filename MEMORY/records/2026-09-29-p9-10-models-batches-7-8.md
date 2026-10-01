# 2026-09-29 — P9-10 batches 7–8: content, tickets, GDPR and platform models are TypeScript

**ADR:** [ADR-087 Amendment 10](../DECISIONS.md) · **Card:** P9-10 (**59 of 71** models) · **Tree:** HEAD `ce74932` (committed by the owner's commit agent at the batch-6 boundary) plus this work. A P9-11 helper now works on `validators/*` and `validation.middleware`; it had no changes in the tree during these batches. Continues [`2026-09-29-p9-10-models-batches-5-6.md`](./2026-09-29-p9-10-models-batches-5-6.md).

## What changed

| Area | Files |
|---|---|
| Batch 7, content, tickets and GDPR (8) | `src/models/post`, `category`, `postCategory`, `ticket`, `ticketComment`, `ticketCounter`, `consentRecord`, `dsarRequest` (`.model.ts`, `.js` removed) |
| Batch 8, platform (5) | `src/models/customDomain`, `scimGroup`, `webhook`, `webhookDelivery`, `tenantBackup` (`.model.ts`, `.js` removed) |
| D-27 types (`src/utils/jsonShape.util.ts`) | `DsarDetails`, `WebhookPayload`, `TenantBackupMetadata`, `WebhookEvents` |
| `src/types/models.ts` | 13 more entries |
| Ratchet | `backend/.ts-ratchet.json` floor 1119 → **1106** |
| Docs | ADR-087 Amendment 10; the P9-10 card; `TASKS/PROGRESS.md`; `docs/ENGINEERING/04` banner (110 modules); the `CLAUDE.md` scale row |

## Evidence

| Check | Batch 7 | Batch 8 |
|---|---|---|
| TypeScript 7 `--noEmit` | clean | clean |
| Full-barrel definition equality (validators and methods included) | 71 identical | 71 identical |
| Model guards, migrations, d05, d27, domain suites | 77 suites / 2,137 tests | 99 suites / 2,638 tests |
| Models' own figure | 96.08 / 75.32 / 95.14 / 96.03 | **96.14 / 75.32 / 95.14 / 96.09** |
| Full gate `npm run test:coverage -- --ci --forceExit` | 700 suites / 13,065 tests / 100% | **700 suites / 13,065 tests / 100%** |
| Live PostgreSQL 18.6 as `callibrator_app`: `dbD` / `dbC` / `w33` / `dbB` / `p6` / `q02` | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 · 10/10 | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 · 10/10 |
| Live probe | `p9/live-b7.js` **25/25** | `p9/live-b8.js` **26/26** |

**Other boundary checks**
- `includeRequired.d12`: 24/24, with eight branded models.
- ESLint ratchet: 0 errors, and warnings down from 283 to 278.
- `build:dist`: 114 TypeScript files compiled.
- The container and exactly its volume were removed.

**Probe notes**
- The batch 7 probe's D-12 check first expected an empty `posts` list. The as-built behaviour is that a bare include of a soft-deleted default-scoped `Post` removes the category row itself (INNER JOIN). The check was corrected to assert that, together with the `required: false` contrast.
- The batch 8 probe runs every `TenantBackup` static against a real database:
  - `createBackup`'s dropped `name` and `description`, and its `''` tag falling back to `null`;
  - `updateStatus`'s derived fields, a rolled-back transaction, and an unknown id;
  - `getTenantBackups`, `getLatestBackup` and `hasValidBackups`.

## Open

- **The tenant-isolation-critical batch (12),** in the same merge as the barrel `models/index`: `session`, `user`, `tenant`, `role`, `auditLog`, `apiKey`, `tenantKey`, `tenantSettings`, `tenantHierarchy`, `userMenuPermission`, `roleMenuPermission`, `menuGroup`. It needs:
  - the full isolation suites and the `twoTenantRoutes` guard;
  - a live two-tenant probe as `callibrator_app` (reads, includes, bulk operations, the Tenant PLATFORM-exclusion hook, Session snake_case);
  - a Docker build and boot, plus the P9-00 E2E baseline against the converted image.
- **Nothing is committed** by me.
