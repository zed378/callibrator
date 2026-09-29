# 2026-09-29 — P9-10 batches 3–4: the class variant settled; workflow/QMS/suppliers and billing/usage/notifications/operations models are TypeScript

**ADR:** [ADR-087 Amendment 8](../DECISIONS.md) · **Card:** P9-10 (**36 of 71** models) · **Tree:** HEAD `35ebd76` plus the working tree. I was the only agent running. Continues [`2026-09-29-p9-10-models-kanban-inventory.md`](./2026-09-29-p9-10-models-kanban-inventory.md).

## What changed

| Area | Files |
|---|---|
| Batch 3: workflow, QMS, suppliers (11) | `src/models/workflow`, `workflowStep`, `workflowInstance`, `workflowAction`, `capa`, `nonConformance`, `sopDocument`, `sopTrainingAcknowledgment`, `vendor`, `risk`, `supplierScorecard` (`.model.ts`, `.js` removed) |
| Batch 4: billing, usage, notifications, operations (10) | `src/models/invoice`, `subscription`, `planQuota`, `usageMetric`, `usageAlert`, `notification`, `notificationState`, `batchJob`, `maintenanceWorkOrder`, `assetFinance` (`.model.ts`, `.js` removed) |
| Shared | `src/models/initModel.ts`: the `Auto` timestamp parameter. `src/types/models.ts`: 21 entries, plus `CalibrationDevice: Unconverted`. `src/utils/jsonShape.util.ts`: `NotificationChannels` beside its Joi shape |
| Tests | `src/tests/models/modelTypes.p910.test.ts`: D-21 and D-27 type checks; runtime checks for class-variant enumerability, `toNumber` (number / null / undefined), the D-27 sample, and `NotificationState` not paranoid. 7 tests |
| Ratchet | `backend/.ts-ratchet.json` floor 1150 → **1129** |
| Docs | ADR-087 Amendment 8; `docs/ENGINEERING/04` § Models (class variant, D-21, D-27, `Auto`) and its banner (87 modules); the P9-10 card; `TASKS/PROGRESS.md`; the `CLAUDE.md` scale row |

The baseline was the working-copy `.js`. Batch 3's workflow, CAPA, NC, SOP, risk and supplier-scorecard files, and batch 4's `batchJob`, carried other agents' earlier uncommitted edits. Each file was snapshotted to scratch `p9/models-wc/` and confirmed unchanged (`cmp`) when removed.

## Evidence

**Checks at each batch boundary**

| Check | Batch 3 | Batch 4 |
|---|---|---|
| TypeScript 7 `--noEmit` | clean | clean |
| Full-barrel definition equality (`p9/compareModels.js`), getter behaviour included | 71 identical | 71 identical |
| Model guards, migrations, d05, d27 and domain suites | 94 suites / 2,407 tests | 106 suites / 2,612 tests |
| `decimalGetters.d21` + `jsonShape.d27` | — | 89/89 |
| Models' own figure | 95.73 / 75.32 / 95.14 / 95.66 | **95.87 / 75.32 / 95.14 / 95.81** (reference 93.5 / 65.58 / 93.17 / 93.39) |
| Full gate | 700 suites / 13,061 tests / 100% | **700 suites / 13,065 tests / 100%** |
| Live: `dbD` / `dbC` / `w33` / `dbB` / `p6` on PostgreSQL 18.6 as `callibrator_app` | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 | 6/6 · 4/4 · 12/12 · 10/10 · 22/22 |
| Live probe | `p9/live-b3.js` **25/25** | `p9/live-b4.js` **25/25** |

The batch 3 probe checked:
- defaults and ENUMs;
- Vendor email validation;
- `Risk.rpn` and `SupplierScorecard.overallScore` read back;
- joins;
- that tenant B reads and updates none of A's rows;
- that `Workflow.associate` is not enumerable.

The batch 4 probe checked:
- D-21: `NUMERIC` read back as numbers, numeric arithmetic, `raw: true` still a string, and `min: 0`;
- D-27: a `["sms"]` write is refused;
- `NotificationState.deletedAt` as an ordinary column;
- joins, and tenant isolation.

**The harness bites.** Each plant below failed the comparison; the reassignment is the one expected to pass.

| Plant | Result |
|---|---|
| `associate` made enumerable | fails |
| `Risk.rpn` formula changed | fails |
| `toNumber` returns `null` for `undefined` (the spec's named mistake) | fails |
| a DECIMAL getter returns the raw string | fails |
| `NotificationState`'s own `deletedAt` dropped | fails |
| reassigning an existing non-enumerable method | passes (identical, as expected) |

**Other boundary checks**
- ESLint ratchet: 0 errors.
- `includeRequired.d12`: 24/24.
- `build:dist`: 90 TypeScript files compiled.
- The container and exactly its volume were removed. The three older dangling volumes were left alone, as directed.

## Recorded difference

These 16 class-shaped files exported an anonymous arrow. Converted, the export is the typed `const defineModel`, so its `Function.name` is `"defineModel"`, not `""`. An annotated `export =` arrow was tried and it re-enters the type cycle. Arity is unchanged, and nothing reads a factory's name.

## Open

- **35 models remain, then the barrel,** which converts in the same merge as the last batch.
- **The tenant-isolation-critical batch** comes on its own, with the isolation suites and a live two-tenant probe. It holds `session`, `user`, `tenant`, `role`, `auditLog`, `apiKey`, `tenantKey`, `tenantSettings`, `tenantHierarchy`, `userMenuPermission`, `roleMenuPermission` and `menuGroup`.
- **The other domains:** calibration and certificates (`calibrationDevice`, `calibrationRecord`, `certificate`, `iotReading`, `attachment`, `documentChunk`); signatures (`eSignatureRecord`, `signatureRecord`, `signatureWorkflow`, `signatureWorkflowStep`); content, tickets and GDPR (`post`, `category`, `postCategory`, `ticket`, `ticketComment`, `ticketCounter`, `consentRecord`, `dsarRequest`); platform (`customDomain`, `tenantBackup`, `scimGroup`, `webhook`, `webhookDelivery`).
- **Nothing is committed.**
