# 04 — TypeScript Standards

The compiler and lint settings for backend code, and the patterns that make them pay for themselves. Decided in ADR-038.

> **Target standard.** The backend is **JavaScript** until Phase 9 closes — as-built on 2026-09-29, 125 modules are TypeScript (all 16 `constants/`, 30 of the 36 `utils/` including `tenantScope`, `jobContext`, `migrationLock`, `response` and `upload`, `middlewares/activityLog` and `tenantContext`, `validators/iot.validator`, `config/env` — the one place converted code reads `process.env`, P9-06 part 1 — all 71 models and the models barrel `models/index.ts` with the `initModel` helper — P9-10 DONE; ADR-087 Amendments 6–11 — and the first P9-11 files, `middlewares/validation.middleware` and `validators/input`); everything else is JavaScript. The ratchet (`npm run ratchet`) refuses any new `.js` file, tests included. Every rule here applies to **new** backend files (the ratchet makes new `.js` impossible from P9-04) and to every file as it is converted. The frontend already uses TypeScript under its own, looser `tsconfig`; tightening it to this standard is not yet scheduled.

---

## The Compiler

```jsonc
// backend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2025",          // ADR-087: Node 26; the newest target TypeScript 7 accepts
    "lib": ["ES2025"],
    "types": ["node", "jest"],    // TypeScript 6+ no longer loads every @types package
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,

    "allowJs": true,     // migration only — false when Phase 9 closes
    "checkJs": false
  }
}
```

| Flag | What it catches here |
|---|---|
| `strict` | `null`/`undefined` flow, implicit `any`, `unknown` in `catch` |
| `noUncheckedIndexedAccess` | `rows[0].count` on an empty result — the aggregate queries in `meteredBilling` and the dashboard |
| `exactOptionalPropertyTypes` | `{ expiresAt?: Date }` receiving an explicit `undefined` that then gets written to a column |
| `noPropertyAccessFromIndexSignature` | `process.env.FOO` and `req.headers.foo` read as if they were guaranteed |
| `noImplicitReturns` | a controller branch that forgets to send a response |

**The release build is `tsconfig.build.json`** (ADR-087): it extends this file with `allowJs: false`, so a `.ts` file that imports an unconverted `.js` file fails the build with TS7016 — leaf-first order enforced by the compiler. `npm run typecheck` (TypeScript 7, `--noEmit`) reads this file. The unconverted `.js` is copied into `dist/` byte for byte by `scripts/build-dist.ts`, never re-emitted by `tsc`.

**`skipLibCheck` is the one allowed relaxation**, and only for third-party declaration files. It never hides an error in our code.

**`verbatimModuleSyntax` is off** while the output is CommonJS — the two are incompatible. The lint rule `consistent-type-imports` covers the practical need.

**Which compiler (ADR-076, ADR-087).** Two TypeScripts are installed: `@typescript/native` is **TypeScript 7, the compiler and the gate**; `typescript` is the TypeScript 6 **API** package that typescript-eslint and Next need. `npm run typecheck` calls TypeScript 7 **by path** (`node ../node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`). **Never check with a bare `npx tsc`**: ADR-076 found it resolving to TypeScript 6, and on 2026-09-29 it failed outright on this tree with `MODULE_NOT_FOUND` (the TypeScript 6 package names its binary `tsc6`). Typed linting runs on the TypeScript 6 API while the check runs on 7, so a construct only one of them understands shows up as a lint-only or check-only error. The program covers `src/**/*.ts`, `scripts/**/*.ts` and `__tests__/**/*.ts`. **Nothing type-checks during `jest`** — the test transform erases types — so the typecheck is the only type gate, and it must run (CI's backend-lint job, the pre-push hook, `make verify`).

## The Lint Rules

`typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`. These are **errors**; a `warn` is a rule nobody obeys.

| Rule | Allowed exception |
|---|---|
| `@typescript-eslint/no-explicit-any` | none |
| `no-unsafe-assignment` / `-member-access` / `-call` / `-return` / `-argument` | none — narrow `unknown` instead |
| `no-floating-promises`, `no-misused-promises` | `void` with a comment when fire-and-forget is the design |
| `switch-exhaustiveness-check` | none |
| `no-non-null-assertion` | none |
| `ban-ts-comment` | `@ts-expect-error` with a description only (`allow-with-description`); `@ts-ignore` and `@ts-nocheck` banned. An unused `@ts-expect-error` fails the typecheck, so each one is live |
| `consistent-type-assertions` (`objectLiteralTypeAssertions: "never"`) | `as const`. Build the object in a typed variable, then assert the variable (ADR-087 Amendment 10) |
| `non-nullable-type-assertion-style` | **off** (ADR-087 Amendment 5): it asks for the `x!` that `no-non-null-assertion` bans |
| `explicit-module-boundary-types` | none |
| `consistent-type-imports` | none |
| `no-restricted-properties` — `process.env` | inside `src/config/` only; elsewhere use `config/env.ts` (§ Configuration) |
| `no-restricted-syntax` — `enum` | none — use `as const` objects and unions |
| `no-restricted-syntax` — `declare global`, or a type named `*Envelope` / `ApiResponse*` | inside `src/types/` only (§ Where Types Live) |
| `no-restricted-syntax` — `.query(…)` on `sequelize` / `db` / `database` / `x.sequelize` | `utils/sql.util.ts`, `.ts` tests and `src/migrations/**/*.ts` (P9-07; § Raw SQL) |
| `no-namespace` | `declare global { namespace … }` for a global augmentation (`allowDeclarations`, ADR-087) |

These are configured in `backend/eslint.config.js` for `**/*.ts` (type-aware, `projectService`). **Every line- or region-level `eslint-disable` in a `.ts` file carries its reason** (`-- <reason>` on the directive, the house form); the conversions use them for exactly the as-built idioms a conversion must keep (§ Converting a Module), never to silence a finding. No lint rule enforces the reason — review does (on 2026-09-29, one production `.ts` directive gave its reason on the line above instead).

## Patterns

### Branded identifiers

`tenantId` and `userId` are both UUID strings and appear together in hundreds of calls. Swapping them compiles today.

```ts
// src/types/ids.ts — as built (P9-05, P9-10)
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;

// tenantScope's deny sentinel: a constant, never input (ADR-087 Amendment 11)
export const NO_TENANT_ID = "00000000-0000-0000-0000-000000000000" as TenantId;
```

```ts
// target — added by the first converted module that turns a raw string into a TenantId
export function toTenantId(value: string): TenantId {
  if (!UUID_RE.test(value)) throw new AppError(400, "Invalid tenant id");
  return value as TenantId;
}
```

Brands and their constructors live in `src/types/ids.ts`, the **one** file where a brand assertion (`as TenantId`) is allowed. A brand assertion anywhere else is a review finding. As built, the converted models type their tenant keys `TenantId` and their user keys `UserId`, and `modelTypes.p910.test.ts` pins that a raw string does not type-check where a `TenantId` goes. No validating constructor exists yet; the `.js` callers pass plain strings, which `typecheck` does not see (`checkJs: false`).

### State machines are unions, and switches are exhaustive

```ts
export const CERTIFICATE_STATUS = ["draft", "pending_approval", "approved", "signed", "revoked"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUS)[number];

function nextActions(status: CertificateStatus): readonly CertificateAction[] {
  switch (status) {
    case "draft": return ["submit"];
    case "pending_approval": return ["approve"];
    case "approved": return ["sign"];
    case "signed": return ["revoke"];
    case "revoked": return [];
  } // add a status and this stops compiling — the point
}
```

The same for stock transfers, opname, CAPA, work orders, tenant status and webhook delivery. The Sequelize `ENUM` is built **from** the tuple, so the database and the type cannot drift.

### `catch` narrows `unknown`

```ts
try {
  await sendMail(message);
} catch (error: unknown) {
  if (error instanceof AppError) throw error;
  logger.error("mail send failed", { error: errorMessage(error), requestId });
  throw new AppError(502, "Email delivery failed");
}
```

*Target:* a shared `errorMessage(e: unknown): string` helper — **no such helper exists yet** (there is no `utils/errors.ts`; this line used to name one). Until it lands, narrow in place (`error instanceof Error ? error.message : String(error)`). Never `catch (e: any)`.

**Never return a default from a `catch`** unless the default is a true answer. `getUsage` returned `{ total: 0 }` on every failure, and every tenant's usage read as zero in production for as long as the query was broken.

### Request data comes from Zod, not from `req.body`

**As built by P9-11 (ADR-093)**, `validators/*.validator.ts`. A schema describes **one source's flat shape**, not a `{ body, params }` wrapper (the earlier example here nested one; no validator does):

```ts
// validators/warehouse.validator.ts
import { z } from "zod";
import { caseless, optionalText } from "./fields";

const createWarehouseSchema = z.object({
  name: z.string().trim().min(2).max(255),
  code: z.string().trim().min(2).max(100),
  address: optionalText(500),
  status: caseless(WAREHOUSE_STATUSES, "lower").nullable().default("active"),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export { createWarehouseSchema /* , … */ };
```

```ts
// route: the source is declared; a path parameter always wins a merge
router.put("/:warehouseId", auth, dynamicAccess("warehouse", "write"),
  validate(updateWarehouseSchema, { from: ["params", "body"] }), ctrl.update);

// handler (.ts): typed by the SAME schema object the route mounted
const input = validated(req, updateWarehouseSchema);   // throws on a wiring mismatch, never on input
```

- `validate(schema, { from })` (`middlewares/validation.middleware.ts`) writes the parsed value to `req.validated`, and replaces `req.body` only when the source is the body. A `.ts` handler reads it through `validated(req, schema)`, **never** `req.validated as X` and never `req.body` — which on Express 5 may be `undefined`.
- Outside a route, `validateInput(data, schema)` / `checkInput(data, schema)` from `validators/input.ts`.
- Conversions are **explicit and per field**: `numeric`, `booleanish`, `dateLike` and friends in `validators/fields.ts`, not `z.coerce` (which turns `""` into `0` and `"false"` into `true`).
- *Target (P9-22):* the frontend-facing schemas move to `packages/contracts`; until then they stay in `validators/`.

### Express request augmentation, not casts

```ts
// src/types/express.d.ts — as built (abridged)
declare global {
  namespace Express {
    interface Request {
      requestId?: string;                  // optional: set by middleware that may not have run
      user?: AuthenticatedPrincipal;       // absent before auth
      tenantId?: TenantId | null;
      apiKeyAuthorized?: boolean;
      validated?: unknown;                 // read through validated(req, schema), never cast
      // …plus the upload fields utils/upload.util sets
    }
  }
}
```

Each field is typed **as the JavaScript that sets it actually leaves it** — optional where the middleware that sets it has not necessarily run — and a field is added by the first converted module that reads or writes it (no speculative types). `AuthenticatedPrincipal` holds only the members converted code reads. *Target:* handlers that run after `auth` use a helper that narrows `user` to non-optional, rather than `req.user!`; it does not exist yet (the controllers are still JavaScript).

### Models

**Amended by ADR-087 Amendment 7 (2026-09-29).** The earlier example put `export class Device extends Model<…>` at module level. That breaks every test that calls a model factory with its own Sequelize, because a second `init` rebinds the one shared class. The spec's in-factory `class … { declare … }` also fails with TS2502 as soon as two models refer to each other (a belongsTo one way and a hasMany back). As built (`src/models/initModel.ts`; all 71 models since P9-10 closed, Amendment 11):

```ts
/** A row: attributes, included associations, instance methods. Types only — emits nothing. */
interface Warehouse extends Model<InferAttributes<Warehouse>, InferCreationAttributes<Warehouse>> {
  id: CreationOptional<string>;
  tenantId: TenantId;
  status: CreationOptional<(typeof WAREHOUSE_STATUSES)[number] | null>;
  isDeleted: CreationOptional<boolean>;
  createdAt: CreationOptional<Date>;        // NOT passed to init: Sequelize adds it (allowNull: false)
  stocks?: NonAttribute<ModelInstance<"Stock">[]>;
  softDelete(): Promise<Warehouse>;
}
interface WarehouseStatics {
  associate: (models: Models) => void;
  readonly defaultScoped: DefaultScoped;    // D-12 phantom brand: the defaultScope has a `where`
}
type DefineWarehouse = (db: Sequelize, DataTypes: typeof DataTypesNamespace) => TypedModel<Warehouse, WarehouseStatics>;

const defineModel: DefineWarehouse = (db, DataTypes) => {
  // A fresh anonymous class per call, exactly as db.define(name, attrs, opts) made one.
  const Warehouse = initModel<Warehouse, WarehouseStatics>(class extends Model {}, { /* attributes, unchanged */ }, {
    /* options, unchanged */ modelName: "Warehouse", sequelize: db,
  });
  Warehouse.associate = (models: Models): void => { /* unchanged */ };
  return Warehouse;
};
export = defineModel;                        // require() still returns the factory
```

- The factory is **explicitly typed**. An inferred return type is what goes round in circles between models that refer to each other.
- Timestamps are declared on the interface and **never passed to `init`**. Declaring `createdAt: DataTypes.DATE` "to satisfy the types" makes the column nullable.
- A defaultScope that names the **column** (`where: { is_deleted: false }`), and `includeDeleted: { where: null }`, keep their meaning. They carry a reasoned `@ts-expect-error` (spec probes 2 and 3).
- Model types come from `src/types/models.ts` (`Models`, `ModelInstance<K>`, `ModelsBarrel`), which holds all 71 entries. **The barrel is TypeScript** since ADR-087 Amendment 11, so a `.ts` service gets real model types from `require("../models")` / `import … from "../models"`; the Amendment 7 lint rule that barred importing the `.js` barrel is retired. `models/index.ts` is a pure `export =` module: a named `export type` beside `export =` compiled under tsx/esbuild to a reference to an undefined binding (found by a live boot, not by jest), so no model file or barrel adds one.
- **The D-12 brand:** a model whose `defaultScope` carries a `where` declares `readonly defaultScoped: DefaultScoped` on its statics. `includeRequired.d12` holds the branded set **equal** to the runtime set (13 models on 2026-09-29), so a missing or stray brand fails.
- **Every model conversion passes the four checks** (ADR-092 item 4, as run in Amendments 7–11): (a) `npm run typecheck`; (b) definition — and, since Amendment 9, getter/validator/method behaviour — equal to the JavaScript original across the whole barrel; (c) the model guard suites; (d) the models' own coverage figure does not fall. Models stay outside the 100% gate (ADR-092).
- **Class-shaped models** (ADR-087 Amendment 8): a model the JavaScript wrote as `class X extends Model { static associate(){…} }` keeps an inner class with the same members, passed to `initModel` in place of `class extends Model {}`. Its statics and methods stay class members, so they stay non-enumerable. A method that reads attributes declares `this: X`.
- **DECIMAL (D-21):** the attribute is typed `number`, the getter's output. `toNumber` is `(value: unknown): unknown` and returns `null` **and `undefined`** unchanged.
- **JSON (D-27):** the attribute's type is the `z.infer` of its shape in `utils/jsonShape.util.ts` (`NotificationChannels`, `AuditLogChanges`, `TenantSettingsJson`, …), so the model's type and the check cannot drift. (Hand-written beside a Joi shape until P9-11 moved `jsonShape` to Zod; `JsonValue` / `JsonObject` are in `src/types/json.ts`.)
- **A timestamp column declared in `init`** (for example `NotificationState.deletedAt`, a per-user hide on a model that is not paranoid) narrows `initModel`'s third type argument, so that column is passed to `init` as before.

`Session` declares **`tenant_id`**, because that model's attributes are snake_case. Typing it honestly is what turns the bug that broke the nightly retention purge into a compile error.

### Return types on every export

```ts
export async function getUsage(tenantId: TenantId, metric: UsageMetric, options: UsageOptions = {}): Promise<UsageSummary> {
```

The declared type is the documentation JSDoc used to be. Inferred return types on exports let an accidental change of shape through review.

### Raw SQL goes through `sql()`

**As built (P9-07, ADR-087 Amendment 12):** `utils/sql.util.ts` exports `sql<Row extends object>(runner, text, bind = [], { transaction })`. The runner (the Sequelize instance, or a test double with the same `query`) is **passed in** — a deliberate deviation from the card's `sql(text, bind)`, so that the helper opens no pool on import and tests can inject a double. `bind` takes `BindValue` only; `replacements` does not exist in its options and is refused at run time; a `$n` beyond the bound values is refused before the database. A statement on a tenant-scoped table binds its tenant predicate. A direct `.query(` in `.ts` application source is a lint error. Full rules: [`docs/BACKEND/05-TENANT-SCOPING.md`](../BACKEND/05-TENANT-SCOPING.md) § Raw SQL.

### Configuration comes from `config/env.ts`

**As built (P9-06 part 1, ADR-087 Amendment 6):** a `.ts` file outside `src/config/` never reads `process.env`. It calls `env(name)` (`process.env[name]`), `envOr(name, fallback)` (`process.env[name] || fallback` — `||` kept: an empty variable means "use the default"), `isProduction()` or `environment()` (the live object, for functions taking an injectable `env`). Each reads at **call** time; nothing is cached at load. `tests/config/env.p906.test.ts` pins their semantics. *Target (P9-06 part 2):* one Zod schema over every variable and a boot that refuses listing every problem — a behaviour change, so its own card.

### Module shape and CommonJS interop

The output is CommonJS and most callers are still JavaScript, so the module's **run-time shape** is part of its contract (ADR-087 Amendments 1, 3, 5):

| Situation | As built |
|---|---|
| a module whose `.js` did `module.exports = fn` (models, `storagePath`, `appPath`) | `export =`, so `require()` still returns the function itself. An `export =` module carries **no** named `export` beside it (see § Models) — not even a type; enforced since ADR-087 Amendment 15 by the lint rule `EXPORT_EQUALS_ALONE` and by `npm run load:check` (every module must load, `dist/` under node and `src/` under tsx) |
| a module that exported an object of functions | named `export`s, in the **original key order** (an `export { … }` list at the end when declarations cannot follow it) |
| a CommonJS library (`crypto`, `bcryptjs`, `config`) | **named imports**, which compile to a property read at call time, so `jest.spyOn(crypto, …)` and `jest.mock(…)` still reach it |
| a Node builtin used as a whole (`fs`, `dns`, `path`) | a **default** import, never `import * as` — the namespace form goes through an interop copy, so a `jest.spyOn(dns.promises, …)` would not reach the module, and Babel counts the interop helper's branches against the file's coverage |
| the `.js` called its own export late (`exports.x(...)`) | a **named self-import**, so a replacement of the export still reaches the caller |
| the `.js` destructured another module at load | a `const` capturing the value at load, the same way |
| an ESM-only dependency (uuid 14) | loaded with `require`, typed with `import type … with { "resolution-mode": "import" }` |
| the constants barrel | `export const X = mod.X` (captured at load), not `export … from` (a live, non-writable getter) |

### Converting a Module

ADR-038 rule 3 — **a conversion never changes behaviour** — is proved, not asserted (ADR-087, all amendments):

1. **Leaf-first.** Convert only a file whose imports are all `.ts` already. `npm run build:dist` fails a `.ts` → `.js` import with TS7016 (`tsconfig.build.json`, `allowJs: false`); `npm run typecheck` does not (the base config keeps `allowJs` for editor resolution), so the build is where rule 1 bites. A `.js` file with a declaration twin (`config/index.d.ts`) is the reviewed exception, and the twin goes when the file converts.
2. **Take the baseline from the working copy** when other agents have uncommitted edits in the file, snapshot it, and confirm it unchanged (`cmp`) at the moment it is removed. `build:dist` refuses a module present as both `x.js` and `x.ts`.
3. **Identity check.** Compare the original against its compiled `dist/` module: export names and order, deep-equal values, freeze state, function names and arities, and every exported function's result over a sample set that includes `undefined`, `null`, `""` and wrong types. Record the check count and every accepted difference (e.g. `Function.name` becoming `"defineModel"`).
4. **Keep as-built idioms**, each under a reasoned lint directive: `||` where an empty string or `0` must still fall back; `String(x)` / `Number(x)` on what a JavaScript caller passes; no `??=` where an explicit `null` must survive. Rewrite only where the value is identical for every input.
5. **Tenant-isolation code** (`tenantContext`, `tenantScope`, `jobContext`, the tenant-critical models) converts under four gates: the watching guards bite on the `.ts` file; identity; the isolation suites; and a live two-tenant probe on PostgreSQL 18 as `callibrator_app`.
6. **A source-scanning guard must read `.ts` before its layer converts**, or it reports green having scanned less (Amendment 2; the sweep and per-guard bite proofs are Amendment 4). A test that spawns plain `node` on source must launch it with `--import tsx`.
7. **Re-run the P9-00 E2E baseline** against an image built from the branch; a spec that leaves the recorded set is a behaviour change (ADR-092 item 1; `MEMORY/records/P9-00.md`).
8. **A defect the checker exposes** (e.g. Q-35, `Role.prototype.softDelete` reading `is_system`) is kept, marked with a reasoned `@ts-expect-error`, and fixed in its own change against an AUDIT or BACKLOG id.

## Where Types Live

**`backend/src/types/`** holds the backend's shared type definitions (ADR-087, owner instruction 2026-09-28). As built on 2026-09-29: `node-process.d.ts` (`process.pkg`), `express.d.ts` (the request/principal context, P9-05), `ids.ts` (brands and the deny sentinel), `apiResponse.ts` (`ApiResponse<T>`, typed from `response.util`; `meta` is a top-level sibling of `data` — Amendment 5), `json.ts` (`JsonValue`, `JsonObject`), `models.ts` (`Models`, `ModelInstance<K>`, `ModelsBarrel`) and `sequelize.d.ts` (the `skipTenantScope` augmentation — Amendment 9). A type is added with the first converted module that uses it — no speculative types. Its `README.md` says what belongs there (its file table still describes the seed state, and is behind the directory).

| A type that is… | lives |
|---|---|
| shared by more than one backend module | `backend/src/types/` |
| derived from a constant's value (`(typeof AUDIT_ACTIONS)[number]`) | beside the value, so the two cannot drift |
| used by one module only | in that module |
| a contract the frontend also consumes | `packages/contracts` (P9-22, ADR-038) — not in `backend/src/types/` |

A `declare global` block, or a type or interface named `*Envelope` / `ApiResponse*`, anywhere else is a lint error (`no-restricted-syntax`, `backend/eslint.config.js`). Import shared types with `import type`: a type-only import emits nothing, and a `.d.ts` file never reaches `dist/` or the binary.

## Things That Look Strict and Are Not

| Looks like | Actually |
|---|---|
| `value as unknown as User` | an `any` with extra steps |
| `// @ts-expect-error` with no reason | `@ts-ignore` with a different spelling |
| `Record<string, any>` for a payload | untyped JSON in a typed file |
| `z.any()` / `.passthrough()` / `.loose()` in a request schema | validation switched off at the boundary |
| `z.coerce.number()` / `z.coerce.boolean()` on a query field | `""` becomes `0`, `"false"` becomes `true` — use `validators/fields.ts` |
| `req.validated as CreateInput` | a cast the checker never verified — read `validated(req, schema)` |
| `sql<any>(…)` or `sql<{ total: number }>` over a `COUNT` | the row type is the caller's claim; the driver returns `NUMERIC`/`bigint` as strings (D-21) |
| a brand assertion (`x as TenantId`) outside `src/types/ids.ts` | a tenant id nobody checked |
| `Partial<T>` on a create input | every required column made optional |

## Frontend

`frontend/tsconfig.json` is `strict` but lacks `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Its API types are **hand-written** until `packages/contracts` lands (P9-22); they are a belief about the backend, not a guarantee.
