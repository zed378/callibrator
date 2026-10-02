# 05 — Layer Templates

A copyable template for every backend layer, in TypeScript, with an **as-built** note under each naming the module the converted code actually follows. Where a template and its note differ, the note is the code.

> **Language status (as-built 2026-10-02).** The backend's source is **TypeScript, strict** (ADR-038; toolchain ADR-087); the only source `.js` file left is the dead `utils/checkMenu.util.js`, awaiting deletion (A-18). The **694 `.js` files in the test trees are legacy JavaScript** (682 test files and 12 fixtures and helpers, `src/tests/` and `__tests__/`, counted 2026-10-02), converted opportunistically under P9-26; **all new code, tests included, is TypeScript** (`npm run ratchet` refuses a new `.js` file). Edit a legacy `.js` test in place; do not half-convert it.

---

## Route

The route file is the only place a URL exists, and the only place its gate is declared. A route with no gate is audit finding A-03.

```ts
// src/routes/api/devices.route.ts
import { Router } from "express";
import { auth, denyApiKey } from "../../middlewares/auth.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { createDeviceSchema, deviceIdParams } from "../../validators/device.validator";
import { createDevice, getDevice } from "../../controllers/device.controller";

const router = Router();

router.post("/", auth, dynamicAccess("equipment", "write"), validate(createDeviceSchema), createDevice);
router.get("/:deviceId", auth, dynamicAccess("equipment", "read"), validate(deviceIdParams, { from: "params" }), getDevice);

export = router;
```

**As-built** (`routes/api/vendor.route.ts`): `const router = Router()`, the handlers imported **by name** from their controller, and `export = router` — `index.ts` `require`s each router. Prefer named imports to `import * as controller`: under jest, Babel's namespace-interop helper adds branches a route's tests never take (ADR-087 Am. 28, the P9-21 follow-up). The order is the same: **auth → gate → validate → handler**. A validator before `auth` does work for anonymous callers; a gate after the handler is not a gate.

## Validator

```ts
// src/validators/device.validator.ts
import { z } from "zod";

export const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().max(100).nullable().optional(),
  calibrationIntervalDays: z.number().int().positive(),
});

export const deviceIdParams = z.object({ deviceId: z.uuid() });

export type CreateDeviceBody = z.infer<typeof createDeviceSchema>;
```

`validate(schema, { from })` validates the source it is told to — the body by default, or `"params"`, `"query"`, or several (`{ from: ["params", "body"] }`) — which is the fix for the "path parameter the validator never sees" trap. Its 400 keeps the envelope, status and message the Joi layer had (ADR-093), so the frontend's error handling did not change.

**As-built:** Zod schemas in `validators/*.validator.ts`, many re-exported from `@callibrator/contracts` (P9-22; `validators/vendor.validator.ts`). `validate(schema, { from })` from `middlewares/validation.middleware.ts` is the only middleware form; a handler reads the parsed input with `validated(req, schema)`, and controllers and services use `validateInput` / `checkInput` (`validators/input.ts`). Joi is removed (ADR-093). Never pass a schema's own method (`parse`, `safeParse`) to Express — it 500s every request (`schemaAsMiddleware.p911` guards it).

## Controller

```ts
// src/controllers/device.controller.ts
import type { RequestHandler } from "express";
import { authed } from "../utils/authed";
import { success } from "../utils/response";
import * as deviceService from "../services/device.service";
import type { CreateDeviceBody } from "../validators/device.validator";

export const create: RequestHandler = authed<{ body: CreateDeviceBody }>(async (req, res) => {
  const device = await deviceService.createDevice(req.principal, req.validated.body);
  success(res, device, null, "Device created", 201);
});
```

A controller reads the validated input and the principal, calls **one** service, and sends the envelope. It does not catch errors to answer them itself — the central error handler does (A-13).

**As-built** (`controllers/vendor.controller.ts`): `export const createVendor = asyncHandler(async (req: Request, res: Response) => { … success(res, result.data, null, result.message, result.status); })`. `asyncHandler` (`utils/controllerWrapper.util.ts`) forwards an error to the central handler with `next(error)` (A-13, DONE); the principal is `req.user` (`src/types/express.d.ts`); the service answers `{ status, message, data }` and `success()` (`utils/response.util.ts`) sends the envelope. The template's `authed` helper and `req.principal` do not exist.

## Service

```ts
// src/services/device.service.ts
import { sequelize, Device, AuditLog } from "../models";
import type { Principal } from "../types/principal";
import type { CreateDeviceBody } from "../validators/device.validator";
import type { DeviceDto } from "../types/dto";

export async function createDevice(principal: Principal, input: CreateDeviceBody): Promise<DeviceDto> {
  return sequelize.transaction(async (transaction) => {
    const device = await Device.create(
      { ...input, tenantId: principal.tenantId },   // stamped from the principal, never the body
      { transaction },
    );
    await AuditLog.create(
      { action: "DEVICE_CREATED", resourceId: device.id, actorId: principal.userId, changes: { after: device.toJSON() } },
      { transaction },                              // same transaction: no audit row for a rolled-back write
    );
    return toDeviceDto(device);
  });
}
```

**As-built** (`services/vendor.service.ts`): `export =` of one object of functions, in the original key order (ADR-087 Am. 13, 28); `db.transaction(async (transaction) => { … })` with the audit row written through `auditService.logAction(…, { transaction })` inside it. The rules do not change with the language: the transaction lives in the service, the audit row is written inside it, `tenantId` comes from the principal.

## Model

```ts
// src/models/device.model.ts
export class Device extends Model<InferAttributes<Device>, InferCreationAttributes<Device>> {
  declare id: CreationOptional<DeviceId>;
  declare tenantId: TenantId;
  declare name: string;
  declare serialNumber: string | null;
  declare isDeleted: CreationOptional<boolean>;
}

export function initDevice(sequelize: Sequelize): typeof Device {
  Device.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      tenantId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(200), allowNull: false },
      serialNumber: { type: DataTypes.STRING(100), allowNull: true },
      isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { sequelize, tableName: "calibration_devices", underscored: true },
  );
  return Device;
}
```

A new model with a `tenantId` attribute is scoped automatically. A model **without** one — `Tenant` is the example — is not, and every lookup of it by an id from the request needs an explicit ownership check.

## Raw SQL

```ts
const rows = await sql<{ period: string; total: string }>(
  dbRunner,                 // the Sequelize instance, as a SqlRunner
  `SELECT TO_CHAR("periodStart", 'YYYY-MM-DD') AS period, SUM(count) AS total
     FROM "UsageMetrics"
    WHERE "tenantId" = $1 AND metric = $2
    GROUP BY "periodStart"`,
  [tenantId, metric],       // bind parameters — the helper accepts nothing else
);
```

Raw SQL **bypasses the tenant hooks**, so the predicate is explicit and bound. The helper (P9-07) exists because `$1` passed as `replacements` read every tenant's usage as zero in production.

**As-built:** `sql(runner, text, bind, { transaction })` from `utils/sql.util.ts` (P9-07). The runner — the Sequelize instance, usually `const dbRunner = db as unknown as SqlRunner` — is passed in, so the helper opens no pool on import and a test can pass a double. `replacements` is refused at run time, a `$n` with no bound value is refused before the database, and a direct `.query(` in `.ts` source is a lint error.

## Test

```ts
describe("GET /api/v1/devices/:deviceId", () => {
  it("returns the device to its own tenant", async () => { /* … */ });

  it("returns 404 — not 403 — for another tenant's device", async () => {
    const fx = createTwoTenants();                          // synchronous; no database
    deviceRows.push({ id: DEVICE_ID, tenantId: fx.tenantB.id }); // the model double's rows
    currentUser = fx.principal(fx.tenantA, "HEALTHCARE ADMIN");   // what `auth` sets as req.user
    const res = await http(router, "GET", `/${DEVICE_ID}`);   // router.handle, as in readGates.p604.test.js
    expect(res.status).toBe(404);
  });
});
```

**As-built:** new tests are TypeScript. A new `:id` route's two-tenant test uses `fixtures/twoTenantSuite.ts` over `fixtures/memoryDb.ts` (the real models and tenant hooks, in memory) and carries an `@two-tenant <route file> <METHOD> <path>` marker (`twoTenantRoutes.guard`). The sample above is shaped on the older synchronous fixture, `backend/src/tests/fixtures/twoTenants.js` (A-63), which the legacy `.js` tests use. An earlier version of this sample awaited the fixture and called `createDevice`, `authFor` and supertest `request(app)` — none of which the fixture provides (ADR-088). The fixture replaces the database with doubles; the tenant hooks and SQL are tested against PostgreSQL.

Every `:id` route gets the two-tenant 404 test. Detail: [`09-TESTING-CONVENTIONS.md`](./09-TESTING-CONVENTIONS.md).
