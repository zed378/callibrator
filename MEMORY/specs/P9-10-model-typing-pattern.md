# Feature Spec — P9-10 The Model Typing Pattern

**Written:** 2026-09-28, **before** implementation (no model file has been converted)
**Amended:** 2026-09-29 by **ADR-087 Amendment 7**, at the first batch. Item 1's in-factory `class X extends Model<InferAttributes<X>, …> { declare … }` fails with **TS2502** as soon as two models name each other through `Models[...]`. Each factory's return type is inferred from its class, the class's base type needs the other factory's return type, and so round. The scratch probes never met this, because they converted one model of each pair.
- **As built:** the row type is a module-level `interface X extends Model<InferAttributes<X>, InferCreationAttributes<X>> { … }`; the statics are `interface XStatics { … }`; the factory is `const defineModel: DefineX = …`, **explicitly typed**; and `initModel<X, XStatics>(class extends Model {}, attrs, { …opts, modelName, sequelize })` returns the typed class.
- **Unchanged:** timestamps stay out of `init`; `export =` stays; the `is_deleted` defaultScope key and `where: null` keep their reasoned directives; and the `DefaultScoped` brand now sits among the statics.
- Items 1, 2 and 6 below describe the ORIGINAL proposal; `src/models/initModel.ts` holds the pattern as built.

**Implemented:** 2026-09-29, **P9-10 DONE** (ADR-087 Amendments 7–11): all 71 models and the barrel. Amendment 8 adds the class variant, D-21 and D-27 typing, and initModel's `Auto` timestamps; Amendment 11 covers the barrel, `config/index.d.ts` and the branded deny sentinel.
**Task:** P9-10 (`TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`)
**Author:** Phase 9 helper 3 (Claude)
**Spec refs:** ADR-038 (models row, rule 3) · ADR-064 items 5, 6, 10 (D-21, D-12, D-25/D-27) · ADR-087 and Amendment 1 (`export =`, `src/types/`, the build) · `docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` § Models · `docs/BACKEND/05-TENANT-SCOPING.md` · CLAUDE.md § The Traps
**Checked against:** Sequelize **6.37.8** (`node_modules/sequelize/types/model.d.ts`, `lib/sequelize.js#define`, `lib/model.js`), TypeScript **7.0.2** under `backend/tsconfig.json`

> This is a typing spec, not a feature. The template's Data Model, API, UI and Rollout sections
> have no content here; the pattern, the probes and the traps take their place. **Nothing in
> this document is shipped.** Every code block is a proposal, typechecked in a scratch directory
> outside the repository (see *Evidence*). The models are still JavaScript.

---

## Problem

The next conversion after the utilities is the 71 model files plus the `models/index.js` barrel.
Several people will convert them, in batches of up to 12. Whatever the first batch does, the
other 59 will copy. A wrong first pattern is expensive here for three reasons:

1. **The models hold the most repeated defects** (CLAUDE.md § The Traps). Three examples:
   - a default-scoped include that silently becomes an INNER JOIN;
   - `is_deleted` written where the attribute is `isDeleted`;
   - `tenantId` on `Session`, whose attributes are snake_case.
2. **Sequelize's own typings push towards a behaviour change.** The documented way to satisfy
   `Model.init`'s types changes the model (probe 1). The `where` type also rejects two
   constructs whose runtime meaning matters (probes 2 and 3).
3. **Tests call the model factories directly.** At least 20 tests call
   `require("…/x.model")(sequelize, DataTypes)` with a Sequelize instance of their own. The
   module shape has to survive that.

## What `docs/` and the ADRs already decide

| Decision | Source |
|---|---|
| Models use Sequelize 6's native typing: `Model<InferAttributes<M>, InferCreationAttributes<M>>` with `declare` fields. Not `sequelize-typescript` | ADR-038, models row |
| A conversion changes types, syntax and imports only. A defect the checker exposes is fixed in its own change | ADR-038 rule 3 |
| `Session` declares `tenant_id`, so `tenantId` on it is a compile error | 04-TYPESCRIPT-STANDARDS § Models; P9-10 DoD |
| The 71 models and the barrel are **one merge**. No `.ts` consumer may import a `.js` barrel on `main` | P9-10 card (a); Phase 9 § Dependency Reality |
| `tsconfig.build.json` sets `allowJs: false`. A `.ts` model that imports a `.js` util fails the build with TS7016 | ADR-087 decision 3 |
| `require()` of a converted module must still return what it returned before (`export =`) | ADR-087 Amendment 1, item 4 |
| A DECIMAL attribute reads as a number through a per-attribute `get()`. `raw: true` and `SUM()` bypass it | ADR-064 item 5 (D-21) |
| Every include of a default-scoped model states `required`. **The rule is a test over the source** (`includeRequired.d12.test.js`) | ADR-064 item 6 (D-12) |
| Every JSON column's shape is declared once, in `utils/jsonShape.util`, and validated on write | ADR-064 item 10, ADR-070 (D-27) |
| Shared types live in `backend/src/types/`. A type derived from a constant stays beside the constant | ADR-087 decision 7 |
| Brands live in `src/types/ids.ts`. It exists and holds `Brand<T, B>` and `TenantId` only. `UserId`, `SessionId` and the validating constructors are added **by the first converted module that needs them** ("no speculative types", `src/types/README.md`). The first model batch is that module for the ids it declares. The request context is in `src/types/express.d.ts`. `ApiResponse<T>` lands in `src/types/` with `response.util`'s conversion. This spec defines no parallel type | 04-TYPESCRIPT-STANDARDS § Branded identifiers; ADR-087 decision 7 |
| **Models stay outside the 100% figure.** P9-10's "still at 100%" is replaced by four checks: (a) typecheck; (b) a definition-equality check per converted model; (c) the model guard suites green; (d) the models' own figure (93.5 / 65.58 / 93.17 / 93.39 on 2026-09-28) does not fall | **ADR-092 item 4** (P9-03a). Referenced here, not re-decided |

### Where `docs/` is silent or wrong (for the owner or the docs owner)

- **04-TYPESCRIPT-STANDARDS § Models** puts `export class Device extends Model<…>` at module
  level. Done literally, that breaks every test that calls a factory with its own Sequelize (see
  *The module shape*). The example should put the class inside the factory. **Amendment wanted.**
  It is a docs change, so this spec does not make it.
- The standard's example says nothing about timestamps. The obvious fix, declaring them in
  `init`, is a behaviour change (probe 1).
- Nothing in `docs/` says that **12 of the 13 default-scoped models name the column
  (`is_deleted`) in their defaultScope `where`, not the attribute (`isDeleted`)**. Nor that
  `user.service#assertIdentityFree` depends on that (probe 3).

---

## The pattern

### 1. The module shape: class inside the factory, factory exported with `export =`

```ts
// src/models/session.model.ts  (proposal: typechecked in scratch, not in the tree)
import {
  Model,
  type BelongsToGetAssociationMixin,
  type CreationOptional,
  type DataTypes as DataTypesNamespace,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from "sequelize";
import type { SessionId, TenantId, UserId } from "../types/ids";      // TenantId exists; the batch adds UserId/SessionId
import type { DefaultScoped, Models } from "../types/models";         // item 7
import { initModel } from "./initModel";

function defineModel(db: Sequelize, DataTypes: typeof DataTypesNamespace) {
  class Session extends Model<InferAttributes<Session>, InferCreationAttributes<Session>> {
    declare id: CreationOptional<SessionId>;
    declare user_id: UserId;
    declare tenant_id: TenantId | null;
    // …every column, snake_case, exactly as the JavaScript names it…
    declare is_deleted: CreationOptional<boolean>;
    declare deleted_at: Date | null;
    declare createdAt: CreationOptional<Date>;   // underscored: true keeps ATTRIBUTE names camelCase
    declare updatedAt: CreationOptional<Date>;

    declare user?: NonAttribute<InstanceType<Models["User"]>>;
    declare tenant?: NonAttribute<InstanceType<Models["Tenant"]>>;
    declare getUser: BelongsToGetAssociationMixin<InstanceType<Models["User"]>>;

    declare softDelete: () => Promise<Session>;
    declare static restoreStatic: (id: string) => Promise<[affectedCount: number]>;
    declare static associate: (models: Models) => void;
    declare static readonly defaultScoped: DefaultScoped;
  }
  initModel(Session, { /* the attributes, unchanged */ }, { sequelize: db, modelName: "Session", /* the options, unchanged */ });
  Session.prototype.softDelete = async function softDelete(this: Session): Promise<Session> { /* unchanged body */ };
  Session.restoreStatic = async function restoreStatic(id: string) { /* unchanged body */ };
  Session.associate = (models: Models): void => { /* unchanged body */ };
  return Session;
}

export = defineModel;
```

**Why the class sits inside the factory.** In Sequelize 6.37.8, `db.define(name, attrs, opts)`
does exactly this:

```js
const model = class extends Model {};
model.init(attrs, { ...opts, modelName, sequelize: this });
```

It creates a **new class on every call**, and the tests rely on that. The following call a model
factory with their **own** Sequelize:

- `tests/fixtures/auditLedger.js`;
- `auth.impersonator.f8.test.js`;
- `systemActors.a124.test.js`;
- the migration tests `0023`, `0026`, `0028`, `0029`, `0031`, `0039`, `0040`, `0052`, `0078`,
  `0087` and `0088`.

With a module-level class, the second `init` would rebind that single shared class, and the
barrel's model would move to the test's instance. Probe 1 confirms that the class-in-factory
form returns a fresh class on every call, each bound to its own Sequelize.

**16 of the 71 models already have this shape:** `auditLog`, `batchJob`, `capa`, `invoice`,
`maintenanceWorkOrder`, `nonConformance`, `notification`, `notificationState`, `sopDocument`,
`sopTrainingAcknowledgment`, `subscription`, `vendor`, `workflow`, `workflowAction`,
`workflowInstance`, `workflowStep`. The other 55 use `db.define`, which is the same thing
spelled differently.

**Why `export =`.** `require("./x.model")` must keep returning the factory itself. ADR-087
Amendment 1 did the same for `storagePath.util`.

- `export =` rules out any other named export in the file.
- Other files reach the class type through the factory:
  `InstanceType<ReturnType<typeof defineSession>>`. The shared `Models` map publishes it as
  `Models["Session"]` (item 7).
- If a model file needs a second export, such as an enum tuple, the tuple moves to `constants/`
  and its type sits beside it (ADR-087 decision 7).

**Keep each file's existing form of methods and statics.** Enumerability is observable:

- `X.prototype.softDelete = function` creates an **enumerable** property. A class method is
  **not** enumerable.
- `X.associate = …` in the 55 `define` files is an enumerable static. `static associate()` in the
  16 class files is not.

So a `define` file keeps the assignment and types it with `declare softDelete: …` or
`declare static associate: …`. A class file keeps its class method. Probe 1 compares
`Object.keys(Model.prototype)` and `Object.keys(Model)` for exactly this reason.

**Keep each factory's parameter list.** 16 files are `(sequelize) =>` and take `DataTypes` from
`require("sequelize")`. The other 55 are `(db, DataTypes) =>`. Tests call some factories with
one argument, so changing the arity is a behaviour change.

### 2. Timestamps: use `initModel()`, never `createdAt: DataTypes.DATE` in `init`

Sequelize's `init` type requires a definition for **every** attribute of the class, including
the declared timestamps. Sequelize's documentation quiets it with
`createdAt: DataTypes.DATE, updatedAt: DataTypes.DATE` in `init`.

**Probe 1: that changes the model.** The attribute loses `allowNull: false` and
`_autoGenerated: true`. As a result:

- `db.sync()` would create a nullable `created_at` on a fresh database;
- `InstanceValidator` (`lib/instance-validator.js:78`) would start schema-validating a column it
  skips today.

The pattern is one helper, `src/models/initModel.ts`. It takes the attributes **without** the
timestamp keys and makes, in one reviewed place, the single assertion the typings force:

```ts
type TimestampKey = "createdAt" | "updatedAt" | "deletedAt";
export function initModel<MS extends ModelStatic<Model>>(
  model: MS,
  attributes: ModelAttributes<InstanceType<MS>, Omit<Attributes<InstanceType<MS>>, TimestampKey>>,
  options: InitOptions<InstanceType<MS>>,
): MS {
  return model.init(attributes as ModelAttributes<InstanceType<MS>, Attributes<InstanceType<MS>>>, options);
}
```

`initModel` calls `init`, and so does `define`, so the result is the same. In probe 1,
`KanbanLabel` and `Session` built through `initModel` are identical to the `define` originals.
`initModel.ts` is a new `.ts` file under `models/`, which the ratchet allows.

### 3. Attributes

| Column | Declared as | Why |
|---|---|---|
| primary key with a default | `CreationOptional<XId>` | optional on create, present on read |
| column with a `defaultValue` | `CreationOptional<T>` | same reason |
| `allowNull: true` | `T \| null` | Sequelize's `CreationAttributes` makes a nullable key optional on create by itself (`MakeNullishOptional`) |
| `allowNull: false` | `T` | required on create |
| tenant or user key | `TenantId` / `UserId` (P9-05) | a raw `string` passed as a tenant fails to compile (negative check 5) |
| foreign key **declared in `init`** | its plain type, **not** `ForeignKey<>` | `ForeignKey<>` makes the key optional in `init`. That is only right for a key an association adds and `init` does not declare |
| ENUM | a union built from an `as const` tuple, with `DataTypes.ENUM(...TUPLE)` | 04-TYPESCRIPT-STANDARDS § State machines. The same values give the same column, and the D-26 mirror test holds the values |
| DECIMAL (D-21) | `number` (or `number \| null`): the **getter's** type | item 4 |
| JSON / JSONB (D-27) | the type of the declared shape | item 5 |
| association | `NonAttribute<…>`, optional, because it is present only when included | `InferAttributes` excludes it |
| association mixin | declared **only** where code calls it | a declared mixin with no association behind it is a lie the checker believes |
| timestamps | `CreationOptional<Date>`, plus `deletedAt: Date \| null` when `paranoid` | they are **not** passed to `init` (item 2) |

The card names `declare foo: any` "to be typed later" as an abuse case. Use `unknown` and narrow
it, or type the column now.

### 4. DECIMAL (ADR-064 item 5, D-21)

```ts
declare purchasePrice: number;                        // what the getter returns
…
purchasePrice: {
  type: DataTypes.DECIMAL(14, 2),
  allowNull: false,
  validate: { min: 0 },
  get(this: AssetFinance): unknown { return toNumber(this.getDataValue("purchasePrice")); },
},
```

- **The attribute's type is the getter's output.** node-postgres delivers a string, but no
  consumer ever sees that string through the model. Negative check 8: `a.purchasePrice +
  a.salvageValue` is a `number`, and assigning it to a `string` fails.
- Sequelize types `get()` as returning `unknown`, so the getter compiles without an assertion.
- **The gap, stated in the file:** `raw: true` reads and aggregates still return strings
  (ADR-064, "bad implications"). The type covers model reads only. A raw query's row type comes
  from P9-07's `sql<Row>()`, never from the model type.
- **`toNumber` must keep its JavaScript behaviour exactly.** The original returns `value` for
  both `null` **and `undefined`**. The scratch fragment typed it
  `(value: unknown) => number | null` and returned `value ?? null`, which turns `undefined` into
  `null`. Recorded here as **the thing not to copy**. The conversion keeps
  `number | null | undefined` and returns `value`.

### 5. JSON columns (ADR-064 item 10, D-27)

`utils/jsonShape.util` declares 14 shapes **as Joi schemas**. Joi does not infer a type, so until
P9-11 each shape's TypeScript type is written by hand, **beside its Joi shape**, in
`jsonShape.util.ts`:

```ts
// iot.validator#readingToleranceSchema: .or("min", "max") per metric
export type MetricBounds =
  | { readonly min: number; readonly max?: number }
  | { readonly min?: number; readonly max: number };
export type ReadingTolerance = Readonly<Record<string, MetricBounds>>;
export type UncertaintyBudget = JsonObject;          // `object` in JSON_SHAPES
…
declare readingTolerance: ReadingTolerance | null;
```

- `JsonObject` and `JsonValue` go in `src/types/json.ts`, because several models share them.
- **When P9-11 moves the shapes to Zod, each hand-written type becomes
  `z.infer<typeof shape>`.** Until then, a type test pins each hand-written type against one
  sample the Joi shape accepts and one it refuses. Negative check 7: the type refuses
  `{ temp: {} }`, as Joi's `.or("min","max")` does.
- **An ordering problem found here.** `jsonShape.util` imports `validators/iot.validator`, a
  utility importing a validator, and nine models import `jsonShape.util`. Under `allowJs: false`
  (ADR-087), a `.ts` model that imports a `.js` `jsonShape.util` fails the build. So
  **`jsonShape.util` and `iot.validator` must be TypeScript before the first model with a JSON
  column converts.**
  - Converting `iot.validator` to TypeScript **while it still uses Joi** is a legitimate P9-09
    prerequisite (Joi ships its own `.d.ts`). It does not pre-empt P9-11's Joi → Zod step.
  - Phase 9's Dependency Reality table does not list this edge.

### 6. The defaultScope flag (D-12)

13 models have a defaultScope `where`. `includeRequired.d12.test.js` pins the list:
`ApiKey, Attachment, CalibrationDevice, CalibrationRecord, Category, Post, Role, Session, Stock,
Tenant, User, Warehouse, Webhook`. Each of these declares a **phantom brand**:

```ts
// src/types/models.ts
declare const defaultScopedBrand: unique symbol;
export interface DefaultScoped { readonly [defaultScopedBrand]: true }

// in the model class
declare static readonly defaultScoped: DefaultScoped;   // emits nothing; nothing may read it at runtime
```

**How it is enforced.** No type can make Sequelize's own `include: [{ model: User }]` fail to
compile: `IncludeOptions` is not generic in the included model, and module augmentation can only
widen. So the flag serves two consumers:

1. **The lint rule, which stays a test.** ADR-064 item 6 already says "a test over the source is
   the lint rule". In the P9-10 merge, `includeRequired.d12.test.js` is extended to:
   - **parse `.ts` as well as `.js`.** Today it uses `espree` and walks
     `name.endsWith(".js")` (line 319), so a converted service silently drops out of the rule.
     The replacement parser is `@typescript-eslint/typescript-estree`, which typescript-eslint
     already installs;
   - **read the default-scoped set from the brand in the source**, and assert that this set
     **equals** the runtime set (`m._scope.where`), so the brand cannot drift;
   - keep its "proven to bite" case, and add a `.ts` source case.
2. **An opt-in typed helper for new code**, typechecked in scratch (negative check 9):

   ```ts
   type IsDefaultScoped<S> = S extends { readonly defaultScoped: DefaultScoped } ? true : false;
   type ScopedInclude<S extends ModelStatic<Model>> = IncludeOptions & { model: S } &
     (IsDefaultScoped<S> extends true ? { required: boolean } : { required?: boolean });
   export function include<S extends ModelStatic<Model>>(options: ScopedInclude<S>): IncludeOptions { return options; }
   ```

   `include({ model: CalibrationDevice, as: "device" })` fails to compile with
   "Property 'required' is missing". Using the helper is optional. It is **not** a reason to
   rewrite existing includes inside a conversion.

A custom ESLint rule reading the brand through the type checker would be stronger. It was not
chosen, because:

- the repository has no custom-rule infrastructure;
- the source test already exists, already runs in `make verify`, and already has a bite test.

### 7. The `Models` map and the barrel (`models/index`)

```ts
// src/types/models.ts: grows one entry per converted model
export interface Models { Session: ReturnType<typeof defineSession>; /* … */ }

// models/index.ts: the last merge
export type ModelsBarrel = Sequelize & Models & ModelAliases & {
  sequelize: Sequelize; Sequelize: typeof SequelizeCtor; Op: typeof Op;
};
```

- **Before the last batch, `Models` lives in `src/types/models.ts`, not in the barrel.** Under
  `allowJs`, a type imported from the `.js` barrel is inferred loosely, and the typecheck
  accepts it silently. Each batch adds its models' entries to `src/types/models.ts`. In the
  final merge, the `.ts` barrel is checked against the map (`const models: Models = …`).
- The barrel converts **in the same merge as the last model batch** (P9-10 card (a)).
- The barrel uses `export =`, because `require("../models")` must return the same object. 118
  service imports rely on that.
- The barrel is `Object.assign(db, { …singular and plural aliases… })`. Its type is the
  intersection above, **not** a cast. `db.sequelize = db` and similar lines are writes onto the
  Sequelize instance, so `ModelsBarrel` declares those properties.
- **The `db` trap becomes a compile error.** On a typed barrel,
  `const { db } = require("../models")` fails, because `ModelsBarrel` has no `db`.
- Internally, the model loop (`models[model.name] = model`) needs
  `Record<string, ModelStatic<Model>>`. What the barrel exports is the typed `Models`.

### 8. Session: snake_case, and typed as snake_case

Every Session attribute is snake_case **except the timestamps**: `underscored: true` keeps the
attribute names `createdAt` and `updatedAt` and changes only the columns.
`response.util#login` reads `session.createdAt`.

Negative checks 1 to 3: `where: { tenantId }`, `update({ tenantId })` and `session.tenantId`
each fail to compile. The last gives TS2551, "Did you mean 'tenant_id'?". This is the bug that
broke the nightly retention purge.

`session.model.js` passes `underscoredAll: true`. Sequelize 6 reads no such option (checked with
grep over `lib/`), but the option does sit in `model.options`, so a conversion keeps it. Probe 1
caught its absence.

**A limit of the pattern:** TypeScript did **not** reject that unknown option key when it passed
through `initModel`'s generic `options` parameter. An excess option name is **not** caught.

---

## Probes (runtime evidence, Sequelize 6.37.8, an unconnected PostgreSQL-dialect instance)

| # | Question | Result |
|---|---|---|
| 1 | Is `initModel(class…)` identical to `db.define`? | **Identical** for `KanbanLabel` and `Session`, comparing the typed TypeScript (loaded with tsx) against the real `.js` model. Compared: name, table, pk, every `rawAttributes` entry, `_scope`, `options.scopes`, indexes, timestamp attributes, `Object.keys(model.options)`, `Object.keys(prototype)`, `Object.keys(model)`. Every call gives a fresh class bound to its own Sequelize. **Not identical** when `createdAt/updatedAt/deletedAt: DataTypes.DATE` are declared in `init`: `allowNull: false` and `_autoGenerated: true` are lost |
| 2 | Can `scopes: { includeDeleted: { where: null } }` become `{}`, or lose its `where`, to satisfy the types? | **No.** `.scope("includeDeleted")` alone gives the same SQL in all three forms. But `.scope(["defaultScope","includeDeleted"])` **drops** `is_deleted = false` with `null`, and **keeps** it with `{}` or with no `where` (findAll and count) |
| 3 | Is the defaultScope `where: { is_deleted: false }` (the column) the same as `{ isDeleted: false }` (the attribute)? | Same SQL for findAll, include, update and destroy. **But a caller's `where: { is_deleted: … }` replaces the default when the default uses the column key, and is dropped when it uses the attribute key.** `user.service#assertIdentityFree` passes `is_deleted: { [Op.in]: [true, false] }` to find a **soft-deleted** holder of a username or email. With `User`'s default rewritten to `isDeleted`, that lookup would silently stop finding it, and a reused identity would reach the unique index as a 500 instead of a 409 |

**Consequences, decided here.** These are part of the typing pattern, not an architecture
change, so there is no ADR:

- The defaultScope `where` of the 12 models with a camelCase attribute **stays
  `{ is_deleted: false }`**, with a reasoned directive:
  `// @ts-expect-error: the key is the COLUMN is_deleted, not the attribute …(P9-10 spec, probe 3)`.
  `Session` needs no directive, because `is_deleted` is its attribute.
- `includeDeleted: { where: null }` **stays `null`**, with the directive
  `// @ts-expect-error: where: null clears the defaultScope's predicate when the scopes are combined (probe 2)`.
  **No source file uses `includeDeleted` today.** Removing the 13 scopes would be a behaviour
  change in its own right, so it belongs in BACKLOG, not in P9-10.
- When `user.service` converts (Stage C), its `is_deleted` key needs the same reasoned directive,
  or a named constant for the column key. **It must not be "fixed" to `isDeleted`.**

---

## Security

- **This pattern does not type tenant isolation, and must not look as if it did.**
  `tenantScope.util` adds the tenant predicate at runtime, through hooks. A typed `where` with no
  `tenantId` still compiles, and that is correct. The P9-10 DoD line "the deny branch returns
  `TenantId` (`NO_TENANT_UUID`)" belongs to `tenantScope.util`'s own conversion (P9-09c, after
  the models).
- `skipTenantScope: true` is not in Sequelize's `FindOptions`. The option is typed by module
  augmentation of `FindOptions` and `IncludeOptions` in `src/types/sequelize.d.ts`, the
  counterpart of P9-05's `express.d.ts`. Augmentation only **adds** the key, so nothing gets
  stricter because of it.
- The `iotTokenHash` attribute is declared even though the defaultScope excludes it. That is the
  honest type: an `unscoped()` read and `create()` both carry it, and the `toJSON` override
  removes it. `Model#toJSON` is generic (`toJSON<T>(): T`), and the override keeps that
  signature (scratch `calibrationDevice.model.ts`).

## Tests (named before they are written)

- **An identity probe for each converted model.** This is ADR-092 check (b), made concrete by
  probe 1. It loads the `git show HEAD:` original and the compiled module, each on a fresh
  Sequelize, and compares:
  - ADR-092's keys: `rawAttributes`, `tableName`, the options, hook names and associations;
  - the keys probe 1 adds: `Object.keys(model.options)`, `Object.keys(prototype)` and
    `Object.keys(model)`. Without these, `underscoredAll` and a change in enumerability pass
    unnoticed.

  For a model with JSON or DECIMAL columns, it also compares `validate` and `get` behaviour on
  sample values.
- `includeRequired.d12.test.js`: extended to `.ts` sources, with the assertion that the brand set
  equals the runtime set (item 6).
- `unscopedModels.d17.test.js` (line 226) and `jsonShape.d27.test.js` (line 23, `.model.js`)
  **also filter `.js` only**, so a converted model silently drops out of both.
  - Both must accept `.ts` **in the same merge as the first model batch**.
  - Each must assert a minimum count, so that a scanner finding nothing fails.
- `decimalGetters.d21.test.js` finds DECIMAL attributes at runtime, through the barrel, and keeps
  working unchanged.
- **The regression test for the module shape** is the set of migration tests that call a
  factory with their own Sequelize (the list in item 1). They must pass unchanged.
- **Coverage: ADR-092 item 4 decided it.** Models stay outside the 100% figure. The card's
  "still at 100%" is replaced by checks (a) to (d), and the identity probe above is check (b).
  ADR-092 check (c) lists `unscopedModels.d17` among the model guard suites. This spec adds one
  finding: that suite and `jsonShape.d27` (and `includeRequired.d12`) **read `.js` only**, so
  "green" means nothing for a converted model until they read `.ts`. ADR-092 already made the
  A-32 guard read `.ts`; these three need the same change.

## Traps to avoid (checked against this pattern)

- [x] `required: false` on every optional include: item 6, the brand plus the D-12 rule extended to `.ts`.
- [x] `const { sequelize } = require("../models")`, **not `db`**: item 7. On the typed barrel, `db` is a compile error.
- [x] `isDeleted`, not `is_deleted`, **in values**: negative check 4 (`update({ is_deleted })` fails).
  **But the defaultScope `where` keeps the column key** (probe 3).
- [x] `sessions` uses snake_case attributes: item 8, negative checks 1 to 3.
- [x] A global uniqueness constraint: unaffected, because indexes are copied, not retyped.
- [ ] **New for Phase 9:** `createdAt: DataTypes.DATE` in `init` "to satisfy the types" changes the column (probe 1).
- [ ] **New:** a module-level model class breaks the tests that re-`init` a factory (item 1).
- [ ] **New:** a guard test that filters `.js` silently stops guarding a converted file (Tests).

## Open questions (for the owner, not settled here)

1. (Closed by ADR-092 item 4: models stay outside the figure, and the four checks apply.)
2. Should the unused `includeDeleted` scopes on 13 models be removed? That is a behaviour change
   and needs its own card.
3. The example in `04-TYPESCRIPT-STANDARDS § Models` should move the class inside the factory,
   use `initModel`, and drop the timestamps from `init`. That amendment is for the docs owner.

## Evidence

All of this was done in a scratch directory, `<scratchpad>/p9h3/`, outside the repository. Its
`tsconfig.json` **extends `backend/tsconfig.json` unchanged**. It adds only `paths` and
`typeRoots`, to reach the repository's `node_modules`, and a `rootDir` for the scratch files.

What the scratch directory holds:

- `models/session.model.ts`, `kanbanLabel.model.ts`, `calibrationDevice.model.ts`: the three
  models worked through (one simple, one default-scoped with JSON columns, and Session);
- `models/assetFinance.fragment.ts`: the DECIMAL case;
- `models/initModel.ts`, `shared.ts`, `jsonShapes.ts` and `index.ts`: the helper, the brands,
  the JSON types and the `Models` map;
- `models/negative.ts`: nine `@ts-expect-error` checks.

| Check | Result |
|---|---|
| TypeScript 7.0.2, `tsc -p tsconfig.json --noEmit`, on the scratch project | **exit 0**. Every `@ts-expect-error` in `negative.ts` is used; an unused one would fail the check |
| Failing direction: the same checks with the directives stripped | 9 errors, each the intended one (list below) |
| Before the reasoned directives were added: the defaultScope `where: { is_deleted: false }` and `where: null` | TS2353 and TS2322. These are the reason for the two directives in *Consequences* |
| Probe 1 (runtime identity) | as in the probe table |
| Probes 2 and 3 (generated SQL) | as in the probe table |

The nine errors when the directives are stripped:

1. TS2353: `'tenantId' does not exist in type 'WhereOptions<…Session…>'`.
2. TS2769 on `update({ tenantId })`.
3. TS2551: `Property 'tenantId' does not exist on type 'Session'. Did you mean 'tenant_id'?`.
4. TS2769 on `update({ is_deleted })`.
5. TS2322: `string` is not assignable to `TenantId`.
6. TS2769: `"broken"` is not in the status union.
7. TS2769: `{}` is not assignable to `MetricBounds`.
8. TS2322: `number` is not assignable to `string` (DECIMAL).
9. TS2345: `Property 'required' is missing` (default-scoped include).
