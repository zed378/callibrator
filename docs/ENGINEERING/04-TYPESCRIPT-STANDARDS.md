# 04 — TypeScript Standards

The compiler and lint settings for backend code, and the patterns that make them pay for themselves. Decided in ADR-038.

> **Target standard.** The backend is **JavaScript** until Phase 9 closes. Every rule here applies to **new** backend files (the ratchet makes new `.js` impossible from P9-04) and to every file as it is converted. The frontend already uses TypeScript under its own, looser `tsconfig`; tightening it to this standard is not yet scheduled.

---

## The Compiler

```jsonc
// backend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
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

```ts
export class Device extends Model<InferAttributes<Device>, InferCreationAttributes<Device>> {
  declare id: CreationOptional<DeviceId>;
  declare tenantId: TenantId;
  declare name: string;
  declare serialNumber: string | null;
  declare nextCalibrationDate: Date | null;
  declare isDeleted: CreationOptional<boolean>;
}
```

`Session` declares **`tenant_id`**, because that model's attributes are snake_case. Typing it honestly is what turns the bug that broke the nightly retention purge into a compile error.

### Return types on every export

```ts
export async function getUsage(tenantId: TenantId, metric: UsageMetric, options: UsageOptions = {}): Promise<UsageSummary> {
```

The declared type is the documentation JSDoc used to be. Inferred return types on exports let an accidental change of shape through review.

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
