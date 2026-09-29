# 04 — TypeScript Standards

The compiler and lint settings for backend code, and the patterns that make them pay for themselves. Decided in ADR-038.

> **Target standard.** The backend is **JavaScript** until Phase 9 closes — as-built on 2026-09-29, 97 modules are TypeScript (all 16 `constants/`, 30 of the 36 `utils/` including `tenantScope`, `jobContext`, `migrationLock`, `response` and `upload`, `middlewares/activityLog` and `tenantContext`, `validators/iot.validator`, `config/env` — the one place converted code reads `process.env`, P9-06 part 1 — and 46 of the 71 models with their `initModel` helper, P9-10 batches 1–6; ADR-087 Amendments 6–9); everything else is JavaScript. The ratchet (`npm run ratchet`) refuses any new `.js` file, tests included. Every rule here applies to **new** backend files (the ratchet makes new `.js` impossible from P9-04) and to every file as it is converted. The frontend already uses TypeScript under its own, looser `tsconfig`; tightening it to this standard is not yet scheduled.

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

## The Lint Rules

`typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`. These are **errors**; a `warn` is a rule nobody obeys.

| Rule | Allowed exception |
|---|---|
| `@typescript-eslint/no-explicit-any` | none |
| `no-unsafe-assignment` / `-member-access` / `-call` / `-return` / `-argument` | none — narrow `unknown` instead |
| `no-floating-promises`, `no-misused-promises` | `void` with a comment when fire-and-forget is the design |
| `switch-exhaustiveness-check` | none |
| `no-non-null-assertion` | none |
| `ban-ts-comment` | `@ts-expect-error: <reason>` only |
| `consistent-type-assertions` (`objectLiteralTypeAssertions: "never"`) | `as const` |
| `explicit-module-boundary-types` | none |
| `consistent-type-imports` | none |
| `no-restricted-properties` — `process.env` | inside `src/config/` only |
| `no-restricted-syntax` — `enum` | none — use `as const` objects and unions |
| `no-namespace` | `declare global { namespace … }` for a global augmentation (`allowDeclarations`, ADR-087) |

## Patterns

### Branded identifiers

`tenantId` and `userId` are both UUID strings and appear together in hundreds of calls. Swapping them compiles today.

```ts
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;

export function toTenantId(value: string): TenantId {
  if (!UUID_RE.test(value)) throw new AppError(400, "Invalid tenant id");
  return value as TenantId; // the ONE place this assertion is allowed
}

export const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000" as TenantId;
```

Constructors live in `src/types/ids.ts`. A brand assertion anywhere else is a review finding.

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

`errorMessage(e: unknown): string` lives in `utils/errors.ts`. Never `catch (e: any)`.

**Never return a default from a `catch`** unless the default is a true answer. `getUsage` returned `{ total: 0 }` on every failure, and every tenant's usage read as zero in production for as long as the query was broken.

### Request data comes from Zod, not from `req.body`

```ts
export const createDeviceSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    serialNumber: z.string().max(100).optional(),
    calibrationIntervalDays: z.number().int().positive(),
  }),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>["body"];
```

`validate(schema)` writes the parsed result to `req.validated`. Controllers read `req.validated`, never `req.body` — which on Express 5 may be `undefined`.

### Express request augmentation, not casts

```ts
// src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthenticatedPrincipal;   // absent before auth
      tenantId?: TenantId;
      validated?: unknown;             // narrowed by the typed handler helper
    }
  }
}
```

Handlers that run after `auth` use a helper that narrows `user` to non-optional, rather than `req.user!`.

### Models

**Amended by ADR-087 Amendment 7 (2026-09-29).** The earlier example put `export class Device extends Model<…>` at module level. That breaks every test that calls a model factory with its own Sequelize, because a second `init` rebinds the one shared class. The spec's in-factory `class … { declare … }` also fails with TS2502 as soon as two models refer to each other (a belongsTo one way and a hasMany back). As built (`src/models/initModel.ts`, the Kanban and inventory models):

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
- Until the barrel converts, model types come from `src/types/models.ts` (`Models`, `ModelInstance<K>`). A production `.ts` file importing the `.js` barrel is a lint error.
- **Class-shaped models** (ADR-087 Amendment 8): a model the JavaScript wrote as `class X extends Model { static associate(){…} }` keeps an inner class with the same members, passed to `initModel` in place of `class extends Model {}`. Its statics and methods stay class members, so they stay non-enumerable. A method that reads attributes declares `this: X`.
- **DECIMAL (D-21):** the attribute is typed `number`, the getter's output. `toNumber` is `(value: unknown): unknown` and returns `null` **and `undefined`** unchanged.
- **JSON (D-27):** the attribute's type is written by hand in `utils/jsonShape.util.ts`, beside its Joi shape, until P9-11 derives it with `z.infer`.
- **A timestamp column declared in `init`** (for example `NotificationState.deletedAt`, a per-user hide on a model that is not paranoid) narrows `initModel`'s third type argument, so that column is passed to `init` as before.

`Session` declares **`tenant_id`**, because that model's attributes are snake_case. Typing it honestly is what turns the bug that broke the nightly retention purge into a compile error.

### Return types on every export

```ts
export async function getUsage(tenantId: TenantId, metric: UsageMetric, options: UsageOptions = {}): Promise<UsageSummary> {
```

The declared type is the documentation JSDoc used to be. Inferred return types on exports let an accidental change of shape through review.

## Where Types Live

**`backend/src/types/`** holds the backend's shared type definitions (ADR-087, owner instruction 2026-09-28): augmentations of runtime and library globals (`node-process.d.ts`), the request/principal context (`express.d.ts`, P9-05), branded ids (`ids.ts`, P9-05), the response envelope, and domain or model types used across layers. Its `README.md` says what belongs there.

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
| `z.any()` / `.passthrough()` in a request schema | validation switched off at the boundary |
| `Partial<T>` on a create input | every required column made optional |

## Frontend

`frontend/tsconfig.json` is `strict` but lacks `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Its API types are **hand-written** until `packages/contracts` lands (P9-22); they are a belief about the backend, not a guarantee.
