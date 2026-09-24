/**
 * A-92 (residual) — in-tenant serial-number conflicts answered 500 instead of 409.
 *
 * `calibration_devices` carries UNIQUE (tenant_id, serial_number) (migration
 * 0026, ADR-049). The index covers SOFT-DELETED rows, but the model's
 * defaultScope (`is_deleted = false`) hid them from the duplicate check, and the
 * update path had no check at all. Both reached the index and failed with a
 * SequelizeUniqueConstraintError — a 500.
 *
 * Technique (includes.a90.test.js): the REAL models barrel and global tenant
 * hooks on an UNCONNECTED PostgreSQL-dialect Sequelize whose `query` is a small
 * fake of the table. The fake behaves like the index: the only device holding
 * SN_DELETED is soft-deleted, so a SELECT that filters `is_deleted = false`
 * finds nothing, and an INSERT/UPDATE writing a taken serial throws the same
 * UniqueConstraintError the PostgreSQL dialect raises for index 0026.
 *
 * Decided behaviour (see calibrationDevices.service.js, SERIAL-NUMBER
 * CONFLICTS): a serial held by a deleted device is a 409 that says so — the
 * deleted device is not silently resurrected by a create.
 */

const mockDb = { statements: [], handler: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    const text = typeof sql === "string" ? sql : sql.query;
    // a write carries its values as bind parameters on the sql object
    const opts = { ...options, bind: (typeof sql === "object" && sql.bind) || (options && options.bind) };
    mockDb.statements.push({ text, options: opts });
    if (mockDb.handler) {
      const handled = await mockDb.handler(text, opts);
      if (handled !== undefined) {return handled;}
    }
    if (/^SELECT count\(/i.test(text)) {return { count: 0 };}
    return options && options.plain ? null : [];
  };
  // A-133: device writes now run in a managed transaction with their audit
  // row. Nothing is connected, so the transaction is a stand-in the fake
  // `query` ignores; an error from the callback propagates as it would.
  db.transaction = async (optionsOrCallback, maybeCallback) => {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    return callback({ id: "a133-tx", afterCommit: () => undefined });
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

const fs = require("fs");
const os = require("os");
const path = require("path");
const { UniqueConstraintError } = require("sequelize");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const service = require("../../services/calibrationDevices.service");
const controller = require("../../controllers/calibrationDevices.controller");

const TENANT = "11111111-1111-4111-8111-111111111111";
const DEVICE = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const SN_DELETED = "SN-DELETED-1";
const SN_LIVE = "SN-LIVE-1";
const INDEX = "calibration_devices_tenant_id_serial_number_unique";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

/** The error the PostgreSQL dialect raises when index 0026 refuses a write. */
const serialViolation = (serial) =>
  new UniqueConstraintError({
    message: "Validation error",
    fields: { tenant_id: TENANT, serial_number: serial },
    parent: Object.assign(new Error("duplicate key value violates unique constraint"), {
      constraint: INDEX,
      code: "23505",
    }),
  });

const isSelect = (sql) => /^SELECT /i.test(sql);
const isWrite = (sql) => /^(INSERT|UPDATE) /i.test(sql);
const filtersLiveOnly = (sql) => /"is_deleted" = false/.test(sql);
const selects = () => mockDb.statements.map((s) => s.text).filter(isSelect);

/** Everything a statement writes: inline SQL plus its bind parameters. */
const writes = (sql, options, serial) =>
  sql.includes(serial) || (options && Array.isArray(options.bind) && options.bind.includes(serial));

/**
 * The table holds one SOFT-DELETED device with SN_DELETED and one live device
 * (OTHER) with SN_LIVE; DEVICE is live with serial "SN-OWN".
 */
const fakeTable = () => {
  mockDb.handler = (sql, options) => {
    if (isSelect(sql) && sql.includes(`"id" = '${DEVICE}'`)) {
      return models.CalibrationDevice.build(
        { id: DEVICE, tenantId: TENANT, name: "Mine", serialNumber: "SN-OWN", isDeleted: false },
        { isNewRecord: false },
      );
    }
    if (isSelect(sql) && sql.includes(`'${SN_DELETED}'`)) {
      // the only holder is deleted: invisible to a live-only query
      return filtersLiveOnly(sql) ? null : { id: OTHER, isDeleted: true, deletedAt: null };
    }
    if (isSelect(sql) && sql.includes(`'${SN_LIVE}'`)) {
      return { id: OTHER, isDeleted: false, deletedAt: null };
    }
    if (isSelect(sql) && /FROM "calibration_devices"/.test(sql) && !(options && options.plain)) {
      // the bulk-import serial listing
      return filtersLiveOnly(sql)
        ? [{ serialNumber: SN_LIVE, isDeleted: false, deletedAt: null }]
        : [
          { serialNumber: SN_LIVE, isDeleted: false, deletedAt: null },
          { serialNumber: SN_DELETED, isDeleted: true, deletedAt: null },
        ];
    }
    if (isWrite(sql)) {
      for (const serial of [SN_DELETED, SN_LIVE]) {
        if (writes(sql, options, serial)) {throw serialViolation(serial);}
      }
      // a write the index accepts: what the dialect hands back to save()
      return options && options.instance ? [options.instance, 1] : [];
    }
    return undefined;
  };
};

const resDouble = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

let tmpFiles = [];
const csv = (content) => {
  const file = path.join(os.tmpdir(), `a92-${Date.now()}-${Math.random().toString(16).slice(2)}.csv`);
  fs.writeFileSync(file, content);
  tmpFiles.push(file);
  return file;
};

beforeEach(() => {
  mockDb.statements = [];
  mockDb.handler = null;
  fakeTable();
});

afterEach(() => {
  for (const f of tmpFiles) {fs.rmSync(f, { force: true });}
  tmpFiles = [];
});

describe("A-92 — create: a serial held by a SOFT-DELETED device", () => {
  it("answers 409 explaining a deleted device holds it (was a 500 from the index)", async () => {
    const result = await asTenant(() =>
      service.createCalibrationDevice(TENANT, { name: "New", serialNumber: SN_DELETED }),
    );

    expect(result.status).toBe(409);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/held by a deleted calibration device in this organisation/);
    expect(result.message).toMatch(/restore/);
  });

  it("looks the serial up across deleted rows, inside the caller's tenant", async () => {
    await asTenant(() =>
      service.createCalibrationDevice(TENANT, { name: "New", serialNumber: SN_DELETED }),
    );

    const [lookup] = selects();
    expect(lookup).toContain(`'${SN_DELETED}'`);
    expect(lookup).not.toMatch(/"is_deleted" = false/);
    expect(lookup).toContain(`"tenant_id" = '${TENANT}'`);
    // no INSERT was attempted
    expect(mockDb.statements.some((s) => /^INSERT /i.test(s.text))).toBe(false);
  });

  it("answers 409 for a live holder with the in-tenant explanation", async () => {
    const result = await asTenant(() =>
      service.createCalibrationDevice(TENANT, { name: "New", serialNumber: SN_LIVE }),
    );

    expect(result.status).toBe(409);
    expect(result.message).toMatch(/already exists in this organisation/);
  });

  it("maps a unique violation that races past the check to 409", async () => {
    // The lookup sees nothing (a concurrent insert lands after it); the INSERT hits the index.
    const base = mockDb.handler;
    let lookups = 0;
    mockDb.handler = (sql, options) => {
      if (isSelect(sql) && sql.includes(`'${SN_LIVE}'`) && lookups++ === 0) {return null;}
      return base(sql, options);
    };

    const result = await asTenant(() =>
      service.createCalibrationDevice(TENANT, { name: "New", serialNumber: SN_LIVE }),
    );

    expect(result.status).toBe(409);
    expect(result.message).toMatch(/already exists in this organisation/);
  });

  it("lets a unique violation that is NOT the serial index propagate", async () => {
    mockDb.handler = (sql) => {
      if (/^INSERT /i.test(sql)) {
        throw new UniqueConstraintError({
          fields: { iot_device_token: "t" },
          parent: Object.assign(new Error("dup"), { constraint: "calibration_devices_iot_device_token_key" }),
        });
      }
      return undefined;
    };

    await expect(
      asTenant(() => service.createCalibrationDevice(TENANT, { name: "New", serialNumber: "SN-FREE" })),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });
});

describe("A-92 — update: changing the serial to one another device holds", () => {
  it("answers 409 when another live device of the tenant holds it (was a 500)", async () => {
    const result = await asTenant(() =>
      service.updateCalibrationDevice(TENANT, DEVICE, { serialNumber: SN_LIVE }),
    );

    expect(result.status).toBe(409);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already exists in this organisation/);
    expect(mockDb.statements.some((s) => /^UPDATE /i.test(s.text))).toBe(false);
  });

  it("answers 409 when a deleted device holds it", async () => {
    const result = await asTenant(() =>
      service.updateCalibrationDevice(TENANT, DEVICE, { serialNumber: SN_DELETED }),
    );

    expect(result.status).toBe(409);
    expect(result.message).toMatch(/held by a deleted calibration device/);
  });

  it("does not look the serial up when the device keeps its own serial", async () => {
    const result = await asTenant(() =>
      service.updateCalibrationDevice(TENANT, DEVICE, { serialNumber: "SN-OWN", name: "Renamed" }),
    );

    expect(result.status).toBe(200);
    expect(selects().filter((s) => s.includes("'SN-OWN'"))).toHaveLength(0);
  });

  it("maps a unique violation that races past the check to 409", async () => {
    const base = mockDb.handler;
    let lookups = 0;
    mockDb.handler = (sql, options) => {
      if (isSelect(sql) && sql.includes(`'${SN_LIVE}'`) && lookups++ === 0) {return null;}
      return base(sql, options);
    };

    const result = await asTenant(() =>
      service.updateCalibrationDevice(TENANT, DEVICE, { serialNumber: SN_LIVE }),
    );

    expect(result.status).toBe(409);
  });

  it("lets a unique violation that names no constraint and no fields propagate", async () => {
    const base = mockDb.handler;
    mockDb.handler = (sql, options) => {
      if (/^UPDATE /i.test(sql)) {
        throw new UniqueConstraintError({});
      }
      return base(sql, options);
    };

    await expect(
      asTenant(() => service.updateCalibrationDevice(TENANT, DEVICE, { name: "Renamed" })),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });
});

describe("A-92 — an empty serial is no serial", () => {
  // The validator allows "" (and trims "  " to ""). "" is not NULL: a second
  // serial-less device stored as "" collided on the index; NULLs never do.
  it("stores an empty serial as NULL and does not look it up", async () => {
    const result = await asTenant(() =>
      service.createCalibrationDevice(TENANT, { name: "No serial", serialNumber: "" }),
    );

    expect(result.status).toBe(201);
    expect(selects()).toHaveLength(0);
    const insert = mockDb.statements.find((s) => /^INSERT /i.test(s.text));
    expect(insert.options.bind).not.toContain("");
    expect(result.data.serialNumber).toBeNull();
  });

  it("clears a serial on update without a lookup", async () => {
    const result = await asTenant(() =>
      service.updateCalibrationDevice(TENANT, DEVICE, { serialNumber: "  " }),
    );

    expect(result.status).toBe(200);
    expect(result.data.serialNumber).toBeNull();
  });
});

describe("A-92 — bulk import: the same handling, per row", () => {
  it("reports a row whose serial a deleted device holds, and imports the rest (was a 500 for the whole file)", async () => {
    const file = csv(
      "Device Name,Serial Number\n" +
        `Revived,${SN_DELETED}\n` +
        "Fresh,SN-FRESH-1\n",
    );
    // the INSERT of the remaining row succeeds
    const base = mockDb.handler;
    mockDb.handler = base;

    const result = await asTenant(() => service.bulkImportCalibrationDevices(TENANT, file));

    expect(result.status).toBe(200);
    expect(result.data.successCount).toBe(1);
    expect(result.data.failedCount).toBe(1);
    expect(result.data.errors[0]).toEqual({
      row: 2,
      errors: [
        expect.objectContaining({
          field: "serialNumber",
          message: expect.stringMatching(/held by a deleted device in this organisation/),
        }),
      ],
    });
    const listing = selects()[0];
    expect(listing).not.toMatch(/"is_deleted" = false/);
    expect(listing).toContain(`"tenant_id" = '${TENANT}'`);
  });

  it("answers 409, nothing imported, when a serial is taken while the import runs", async () => {
    const file = csv("Device Name,Serial Number\nLate,SN-RACE-1\n");
    mockDb.handler = (sql) => {
      if (/^INSERT /i.test(sql)) {throw serialViolation("SN-RACE-1");}
      return undefined;
    };

    const result = await asTenant(() => service.bulkImportCalibrationDevices(TENANT, file));

    expect(result.status).toBe(409);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No device was imported/);
  });

  it("lets any other bulkCreate failure propagate", async () => {
    const file = csv("Device Name,Serial Number\nXray,SN-X-1\n");
    mockDb.handler = (sql) => {
      if (/^INSERT /i.test(sql)) {throw new Error("connection reset");}
      return undefined;
    };

    await expect(asTenant(() => service.bulkImportCalibrationDevices(TENANT, file))).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("A-92 — the HTTP answer: 409 with success:false and the explanation", () => {
  it("POST /calibration-devices with a deleted device's serial", async () => {
    const res = resDouble();
    const next = jest.fn();
    const req = {
      tenantId: TENANT,
      user: { tenantId: TENANT },
      params: {},
      body: { name: "New", serialNumber: SN_DELETED },
    };

    await asTenant(() => controller.createCalibrationDevice(req, res, next));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/held by a deleted calibration device/);
  });

  it("PUT /calibration-devices/:id to another device's serial", async () => {
    const res = resDouble();
    const next = jest.fn();
    const req = {
      tenantId: TENANT,
      user: { tenantId: TENANT },
      params: { calibrationDeviceId: DEVICE },
      body: { serialNumber: SN_LIVE },
    };

    await asTenant(() => controller.updateCalibrationDevice(req, res, next));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, status: 409 });
  });
});
