/**
 * iotDevice.service (A-29, A-46) -- the edges the router suite
 * (routes/iot.provisioning.a29.test.js) does not reach: a call with no actor
 * (a system caller) and the controller's own path validation.
 */
import type * as NodeCrypto from "crypto";
import type { TenantId } from "../../types/ids";

jest.mock("../../models", () => {
  const mockFindOne = jest.fn();
  return { CalibrationDevice: { unscoped: () => ({ findOne: mockFindOne }) }, _findOne: mockFindOne };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(() => Promise.resolve({})) }));

interface IotDeviceService {
  issueToken: (tenantId: unknown, deviceId: string) => Promise<{ status: number }>;
  updateIotConfig: (tenantId: unknown, deviceId: string, input: unknown) => Promise<unknown>;
  revokeToken: (tenantId: unknown, deviceId: string) => Promise<{ status: number }>;
  hashIotToken: (token: string) => string;
  TOKEN_PREFIX: string;
}

interface IotController {
  issueDeviceToken: (req: unknown, res: unknown, next: jest.Mock) => Promise<void>;
}

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const nodeCrypto = require("crypto") as typeof NodeCrypto;
const config = require("../../config") as { db: { transaction: jest.Mock } };
const models = require("../../models") as { _findOne: jest.Mock };
const auditService = require("../../services/audit.service") as { logAction: jest.Mock };
const service = require("../../services/iotDevice.service") as IotDeviceService;
const controller = require("../../controllers/iot.controller") as IotController;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;
const DEVICE = "22222222-2222-4222-8222-222222222222";

interface DeviceRow {
  id: string;
  tenantId: string;
  name: string;
  iotEnabled: boolean;
  readingTolerance: unknown;
  iotTokenHash: unknown;
  iotTokenIssuedAt: unknown;
  update: jest.Mock;
}

const row = (extra: Partial<DeviceRow> = {}): DeviceRow => {
  const r: DeviceRow = {
    id: DEVICE,
    tenantId: TENANT,
    name: "Pump",
    iotEnabled: false,
    readingTolerance: null,
    iotTokenHash: null,
    iotTokenIssuedAt: null,
    ...extra,
    update: jest.fn((values: Partial<DeviceRow>) => Promise.resolve(Object.assign(r, values))),
  };
  return r;
};

beforeEach(() => {
  jest
    .spyOn(config.db, "transaction")
    .mockImplementation((work: (tx: unknown) => unknown) => Promise.resolve(work({ LOCK: { UPDATE: "UPDATE" } })));
});

describe("iotDevice.service with no actor", () => {
  it("issue, configure and revoke record a null user rather than throwing", async () => {
    models._findOne.mockResolvedValue(row());

    const issued = await service.issueToken(TENANT, DEVICE);
    await service.updateIotConfig(TENANT, DEVICE, { readingTolerance: { t: { max: 1 } } });
    const revoked = await service.revokeToken(TENANT, DEVICE);

    expect(issued.status).toBe(201);
    expect(revoked.status).toBe(200);
    expect(auditService.logAction).toHaveBeenCalledTimes(3);
    for (const [entry] of auditService.logAction.mock.calls as [
      { userId: unknown; ipAddress: unknown; userAgent: unknown },
    ][]) {
      expect(entry).toMatchObject({ userId: null, ipAddress: null, userAgent: null });
    }
  });

  it("hashIotToken is the hex SHA-256 migration 0044 computes in SQL", () => {
    expect(service.hashIotToken("iot_abc")).toBe(nodeCrypto.createHash("sha256").update("iot_abc").digest("hex"));
    expect(service.TOKEN_PREFIX).toBe("iot_");
  });
});

describe("iot.controller provisioning handlers", () => {
  it("answer 400 for a malformed device id without touching the service", async () => {
    interface FakeRes {
      status: jest.Mock;
      json: jest.Mock;
    }
    const res: FakeRes = {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
    };
    await controller.issueDeviceToken(
      { params: { deviceId: "nope" }, headers: {}, user: { tenantId: TENANT } },
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(models._findOne).not.toHaveBeenCalled();
  });
});
