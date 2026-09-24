/**
 * iotDevice.service (A-29, A-46) — the edges the router suite
 * (routes/iot.provisioning.a29.test.js) does not reach: a call with no actor
 * (a system caller) and the controller's own path validation.
 */

jest.mock("../../models", () => {
  const mockFindOne = jest.fn();
  return { CalibrationDevice: { unscoped: () => ({ findOne: mockFindOne }) }, _findOne: mockFindOne };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(async () => ({})) }));

const crypto = require("crypto");
const config = require("../../config");
const models = require("../../models");
const auditService = require("../../services/audit.service");
const service = require("../../services/iotDevice.service");
const controller = require("../../controllers/iot.controller");

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";

const row = (extra = {}) => {
  const r = {
    id: DEVICE,
    tenantId: TENANT,
    name: "Pump",
    iotEnabled: false,
    readingTolerance: null,
    iotTokenHash: null,
    iotTokenIssuedAt: null,
    ...extra,
    update: jest.fn(async (values) => Object.assign(r, values)),
  };
  return r;
};

beforeEach(() => {
  jest.spyOn(config.db, "transaction").mockImplementation(async (work) => work({ LOCK: { UPDATE: "UPDATE" } }));
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
    for (const [entry] of auditService.logAction.mock.calls) {
      expect(entry).toMatchObject({ userId: null, ipAddress: null, userAgent: null });
    }
  });

  it("hashIotToken is the hex SHA-256 migration 0044 computes in SQL", () => {
    expect(service.hashIotToken("iot_abc")).toBe(crypto.createHash("sha256").update("iot_abc").digest("hex"));
    expect(service.TOKEN_PREFIX).toBe("iot_");
  });
});

describe("iot.controller provisioning handlers", () => {
  it("answer 400 for a malformed device id without touching the service", async () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await controller.issueDeviceToken(
      { params: { deviceId: "nope" }, headers: {}, user: { tenantId: TENANT } },
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(models._findOne).not.toHaveBeenCalled();
  });
});
