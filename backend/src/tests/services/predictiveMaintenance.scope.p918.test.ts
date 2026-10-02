/**
 * P9-18 (predictiveMaintenance): both telemetry counts are tenant-scoped, and
 * an API-key principal is recorded on the recommendation's audit row.
 *
 * Found by two planted defects during the conversion that left every suite
 * green:
 * - dropping the tenant from the ANOMALY count (the total count kept it), so
 *   another tenant's anomalies could drive this tenant's calibration
 *   recommendation;
 * - dropping `actorChanges(actor)` from the audit row's changes, so a key's
 *   id (A-282, ADR-100) was lost and the recommendation could not be traced
 *   to the key that requested it.
 */
const mockCount = jest.fn();
const mockLogAction = jest.fn();

jest.mock("../../models", () => ({
  CalibrationDevice: {
    findOne: jest.fn(() =>
      Promise.resolve({
        id: "device-1",
        name: "Pump",
        calibrationIntervalDays: 100,
        update: jest.fn().mockResolvedValue({}),
      }),
    ),
  },
  IotReading: { count: mockCount },
  Notification: { create: jest.fn().mockResolvedValue({}) },
  sequelize: { transaction: (fn: (t: object) => Promise<unknown>) => fn({ tx: 1 }) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: mockLogAction }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const service = require("../../services/predictiveMaintenance.service") as {
  analyzeDevice: (tenantId: string, deviceId: string, actor?: Record<string, unknown>) => Promise<{ status: string }>;
};

const TENANT = "5ea5c400-0000-4000-8000-0000000000a1";

describe("predictiveMaintenance — scope and attribution", () => {
  beforeEach(() => {
    mockCount.mockReset();
    mockLogAction.mockReset().mockResolvedValue({});
    // 100 readings, 10 anomalies: a "recommended" outcome, so both counts run and a row is audited.
    mockCount.mockImplementation((options: { where: { isAnomaly?: boolean } }) =>
      Promise.resolve(options.where.isAnomaly ? 10 : 100),
    );
  });

  it("the total AND the anomaly counts both name the caller's tenant and device", async () => {
    await service.analyzeDevice(TENANT, "device-1", { userId: "u1" });
    const wheres = (mockCount.mock.calls as [{ where: Record<string, unknown> }][]).map(([o]) => o.where);
    expect(wheres).toHaveLength(2);
    for (const where of wheres) {
      expect(where["tenantId"]).toBe(TENANT);
      expect(where["deviceId"]).toBe("device-1");
    }
  });

  it("an API-key principal's key id is recorded in the audit row's changes", async () => {
    const result = await service.analyzeDevice(TENANT, "device-1", { apiKeyId: "key-7", ipAddress: "192.0.2.9" });
    expect(result.status).toBe("recommended");
    const [[entry]] = mockLogAction.mock.calls as [[{ changes: Record<string, unknown>; systemActor?: string }]];
    expect(entry.changes["apiKeyId"]).toBe("key-7");
  });
});
