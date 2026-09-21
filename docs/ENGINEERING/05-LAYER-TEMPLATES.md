# 05 — Layer Templates

A copyable template for every backend layer, in the target TypeScript form, with the as-built JavaScript shape beside it so a reader can map one onto the other during the migration.

> **Target standard (ADR-038).** New backend files use the TypeScript template. When editing an unconverted `.js` file, follow its **as-built** shape — do not half-convert a file; conversion happens module by module under Phase 9.

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
import * as controller from "../../controllers/device.controller";

export const deviceRoutes = Router();

deviceRoutes.post("/", auth, dynamicAccess("equipment", "write"), validate(createDeviceSchema), controller.create);
deviceRoutes.get("/:deviceId", auth, dynamicAccess("equipment", "read"), validate(deviceIdParams), controller.getOne);
```

**As-built:** `router.post("/", auth, dynamicAccess("equipment", "write"), validate(schema), controller.create)` with `module.exports = router`. The order is the same: **auth → gate → validate → handler**. A validator before `auth` does work for anonymous callers; a gate after the handler is not a gate.

## Validator

```ts
// src/validators/device.validator.ts
import { z } from "zod";

export const createDeviceSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(200),
    serialNumber: z.string().trim().max(100).nullable().optional(),
    calibrationIntervalDays: z.number().int().positive(),
  }),
});

export const deviceIdParams = z.object({
  params: z.object({ deviceId: z.string().uuid() }),
});

export type CreateDeviceBody = z.infer<typeof createDeviceSchema>["body"];
```

`validate()` parses `{ params, query, body }` together — the fix for the "path parameter the validator never sees" trap — and responds with the same 400 envelope the Joi layer produces today, so the frontend's error handling does not change.

**As-built:** Joi schemas; `validate(schema)` from `validation.middleware.js`. Never pass `schema.validate` to Express — it 500s every request.

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

**As-built:** `exports.create = asyncHandler(async (req, res) => { … })`. Note that `asyncHandler` currently answers the error itself, **before** the central handler can sanitise it; that is a defect to fix (A-13), not a pattern to copy.

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

**As-built:** the same shape in CommonJS. The rules do not change with the language: the transaction lives in the service, the audit row is written inside it, `tenantId` comes from the principal.

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
  `SELECT TO_CHAR("periodStart", 'YYYY-MM-DD') AS period, SUM(count) AS total
     FROM "UsageMetrics"
    WHERE "tenantId" = $1 AND metric = $2
    GROUP BY "periodStart"`,
  [tenantId, metric],       // bind parameters — the helper accepts nothing else
);
```

Raw SQL **bypasses the tenant hooks**, so the predicate is explicit and bound. The helper (P9-07) exists because `$1` passed as `replacements` read every tenant's usage as zero in production.

**As-built:** `db.query(text, { bind: [...], type: QueryTypes.SELECT })`. Use `bind` for `$n`; `replacements` only substitutes `?` and `:name`.

## Test

```ts
describe("GET /api/v1/devices/:deviceId", () => {
  it("returns the device to its own tenant", async () => { /* … */ });

  it("returns 404 — not 403 — for another tenant's device", async () => {
    const { tenantA, tenantB } = await createTwoTenants();
    const device = await createDevice(tenantB);
    const res = await request(app).get(`/api/v1/devices/${device.id}`).set(authFor(tenantA));
    expect(res.status).toBe(404);
  });
});
```

Every `:id` route gets the two-tenant 404 test. Detail: [`09-TESTING-CONVENTIONS.md`](./09-TESTING-CONVENTIONS.md).
