/**
 * A-29 — the IoT ingest credential never appears in a device response.
 *
 * Before A-29 the model's defaultScope excluded nothing, so once a device had
 * `iotDeviceToken` it was SELECTed and returned by every device list and
 * detail response to everyone who could read the register. The token is now
 * stored only as `iotTokenHash` (migration 0044), which the defaultScope
 * excludes and toJSON() strips.
 *
 * Technique (calibrationDevices.serial.a92.test.js): the REAL models barrel on
 * an UNCONNECTED PostgreSQL-dialect Sequelize whose `query` fakes the table.
 * The fake answers a SELECT with only the columns the SQL actually asked for,
 * from a row that holds BOTH the legacy plaintext column and the hash — so the
 * test observes what the generated SQL would have exposed, whichever model
 * version is under test. The full chain is the real controller → service →
 * model → response.util.
 */

const mockDb = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockDb.statements.push(text);
    return mockDb.handler(text, options);
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id) => `user-perms:${id}` },
}));

const crypto = require("crypto");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const controller = require("../../controllers/calibrationDevices.controller");

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "iot_plaintext-ingest-token-that-must-never-leak";
const HASH = crypto.createHash("sha256").update(TOKEN).digest("hex");

/** The device as the database holds it — every column any version has had. */
const DB_ROW = {
  id: DEVICE,
  tenantId: TENANT,
  name: "Infusion pump",
  status: "active",
  iotEnabled: true,
  readingTolerance: { temperature: { max: 30 } },
  iotDeviceToken: TOKEN, // the pre-0044 plaintext column
  iotTokenHash: HASH, // the 0044 column
  iotTokenIssuedAt: new Date("2026-09-24T00:00:00Z"),
  isDeleted: false,
};

/** Only the columns the SELECT asked for, under their attribute names. */
const projected = (attributes) =>
  Object.fromEntries(
    (attributes || [])
      .map((a) => (Array.isArray(a) ? a[1] : a))
      .filter((name) => typeof name === "string" && name in DB_ROW)
      .map((name) => [name, DB_ROW[name]]),
  );

beforeEach(() => {
  mockDb.statements = [];
  mockDb.handler = (sql, options) => {
    if (/^SELECT count\(/i.test(sql)) {
      return { count: 1 };
    }
    if (/FROM "calibration_devices"/.test(sql)) {
      const row = models.CalibrationDevice.build(projected(options.attributes), {
        isNewRecord: false,
        raw: true,
      });
      return options.plain ? row : [row];
    }
    return options.plain ? null : []; // calibration records, anything else
  };
});

const call = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      status: jest.fn(() => res),
      json: jest.fn((body) => {
        resolve({ status: res.status.mock.calls.at(-1)?.[0], body });
        return res;
      }),
    };
    tenantStorage.run({ tenantId: TENANT }, () => handler(req, res, reject));
  });

const principal = { id: "33333333-3333-4333-8333-333333333333", tenantId: TENANT };

describe("A-29 — no device response carries the ingest token or its hash", () => {
  it("the device LIST response never contains the token or its hash", async () => {
    const { status, body } = await call(controller.getAllCalibrationDevices, {
      query: {},
      user: principal,
    });

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].toJSON()).toMatchObject({ id: DEVICE, iotEnabled: true });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(HASH);
    const listSelect = mockDb.statements.find((s) => /^SELECT "CalibrationDevice"/.test(s));
    expect(listSelect).not.toMatch(/iot_device_token|iot_token_hash/);
  });

  it("the device DETAIL response never contains the token or its hash", async () => {
    const { status, body } = await call(controller.getSpecificCalibrationDevice, {
      params: { calibrationDeviceId: DEVICE },
      user: principal,
    });

    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).toContain(DEVICE);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(HASH);
  });

  it("toJSON() strips the hash even from a row loaded unscoped", () => {
    const row = models.CalibrationDevice.build(
      { id: DEVICE, tenantId: TENANT, name: "x", iotTokenHash: HASH },
      { isNewRecord: false },
    );
    expect(row.iotTokenHash).toBe(HASH); // the server can still read it
    expect(JSON.stringify(row)).not.toContain(HASH);
    expect(row.toJSON()).not.toHaveProperty("iotTokenHash");
  });
});
