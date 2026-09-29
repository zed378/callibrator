# 2026-09-29 — P9-10 starts: the model pattern amended; Kanban and inventory models are TypeScript

**ADR:** [ADR-087 Amendment 7](../DECISIONS.md) · **Card:** P9-10 started (15 of 71 models) · **Spec:** [`MEMORY/specs/P9-10-model-typing-pattern.md`](../specs/P9-10-model-typing-pattern.md), amended in its header · **Tree:** HEAD `35ebd76` plus the working tree. I was the only agent running. Continues [`2026-09-29-p9-round6-jobcontext-config.md`](./2026-09-29-p9-round6-jobcontext-config.md).

## What changed

| Area | Files |
|---|---|
| Converted (`.js` removed) — batch 1, Kanban | `src/models/kanbanCard`, `kanbanCardAssignee`, `kanbanCardLabel`, `kanbanCardRelation`, `kanbanColumn`, `kanbanLabel`, `kanbanProject`, `kanbanProjectMember`, `kanbanSprint` (`.model.ts`) |
| Converted (`.js` removed) — batch 2, inventory | `src/models/warehouse`, `storageLocation`, `stock`, `stockTransfer`, `stockAdjustment`, `stockOpname` (`.model.ts`) |
| New | `src/models/initModel.ts` (`initModel<M, S>`, `TypedModel<M, S>`); `src/types/models.ts` (`Models`, `ModelInstance<K>`, `DefaultScoped`); `UserId` in `src/types/ids.ts` |
| Tests | `src/tests/models/includeRequired.d12.test.js`: the brand equals the runtime set (the card's follow-up). **New:** `src/tests/models/modelTypes.p910.test.ts` |
| Lint | `backend/eslint.config.js`: `no-restricted-imports` bars the `.js` models barrel from production `.ts` |
| Ratchet | `backend/.ts-ratchet.json` floor 1165 → **1150** |
| Docs | ADR-087 Amendment 7; the spec's header; `docs/ENGINEERING/04` § Models (the pattern as built) and its banner (66 modules); the P9-10 card; `TASKS/PROGRESS.md`; the `CLAUDE.md` scale row |

## The deviation

The spec's in-factory `class X extends Model<InferAttributes<X>, …> { declare … }` fails with **TS2502** between any two models that name each other. I reproduced it in scratch with two models (`p9/cyc`, `p9/cyc2`).

The pattern as built:
- a module-level row **interface**;
- a statics interface;
- an **explicitly typed** `const` factory;
- `initModel<X, XStatics>(class extends Model {}, attributes, { …options, modelName, sequelize: db })`, which at run time does exactly what `db.define` did.

ADR-087 Amendment 7 has the alternatives and the bad implications.

## Evidence

**Definition equality over the whole barrel** (`p9/compareModels.js`; the originals placed in a twin of `dist/src`)

| Run | Result |
|---|---|
| Nothing converted (harness self-check) | 71 models + barrel keys identical |
| After batch 1 | **71 identical** |
| After batch 2 | **71 identical** (15 originals placed) |
| Bite: unknown option key; `createdAt` in `init`; `allowNull` flipped; a named `associate`; an extra static; an association alias | **each fails** the harness |
| A named class; a moved known option | identical, as expected: `init` makes them so |

**Type checks**

| Check | Result |
|---|---|
| TypeScript 7 `--noEmit` | clean after each batch |
| `modelTypes.p910.test.ts` | 10 used `@ts-expect-error` checks and 3 runtime tests, all passing |
| Bite: `Warehouse.status` → `string`; `KanbanProject.tenantId` → `string` | each gives TS2578 (unused directive), so the typecheck fails |

**D-12 brand and the barrel lint rule**

| Check | Result |
|---|---|
| `includeRequired.d12` | 24/24. Branded set = runtime set (`Stock`, `Warehouse`) |
| D-12 bite: a stray brand on `KanbanSprint`; the brand removed from `Warehouse` | each fails D-12 |
| Barrel rule bite: `../models`, `./index`, `.` | each is an error. `../types/models` and `./initModel` pass |

**Suites and coverage**

| Check | Result |
|---|---|
| Model guards, migrations, d05, d27, inventory and Kanban suites | 67 suites, 2,089 tests passed (batch 2) |
| Full gate after batch 1 | 699 suites, 13,058 tests, 100% |
| Full gate after batch 2 | **700 suites, 13,061 tests, 100%** |
| Models figure (ADR-092 command, `.js` + `.ts`) | 95.49/75.32/95.14/95.41 after batch 1 → **95.57/75.32/95.14/95.50** after batch 2. Reference 93.5/65.58/93.17/93.39. Every converted model is at 100% |
| ESLint ratchet | 0 errors |
| `build:dist` | 416 JavaScript files copied, 69 TypeScript files compiled |

**Live on PostgreSQL 18.6 as `callibrator_app`, after each batch.** Schema booted by `runSchemaSetup` with the converted models (63 migrations, 75 tables).

| Suite | Batch 1 | Batch 2 |
|---|---|---|
| `dataLayer.dbD` (D-22 Kanban delete, D-26 enum mirror) | 6/6 | 6/6 |
| `dataLayer.dbC` | 4/4 | 4/4 |
| `bulkDestroyRoutes.w33` (paranoid `KanbanProject` delete) | 12/12 | 12/12 |
| `dataLayer.dbB` (fresh database) | 10/10 | 10/10 |
| `dataIntegrity.p6` (fresh database) | 22/22 | 22/22 |
| `p9/live-inventory.js`: defaults, ENUM refusal, `softDelete`, the INNER join a defaultScope forces vs `required: false`, `restoreStatic`, and tenant A never touching B | — | **21/21** |

The container and its volume were removed.

## Open

- **56 models remain, plus the barrel.** The barrel converts in the same merge as the last batch.
  - The 16 models already written as classes (`class X extends Model { static associate(){} … }`) need the pattern's class variant: methods stay non-enumerable class members. This is to settle on their first batch.
  - `jsonShape` models need the D-27 hand-written types.
  - DECIMAL models need the D-21 getter typing.
  - `Session` must stay snake_case.
- **Three dangling anonymous Docker volumes** from 05:31 today predate this work. They are probably round 6's, but that is not proved, so they were **not** deleted.
- **Nothing is committed.**
