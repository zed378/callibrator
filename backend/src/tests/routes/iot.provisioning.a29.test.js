/**
 * A-29 / A-46 — IoT device provisioning, end to end through the router.
 *
 * A-29: nothing could provision a device for ingest, so `POST /iot/ingest`
 * answered 401 for every device; and a token, once written by hand, would have
 * been returned in every device response. A-46: `readingTolerance` could not
 * be set, so the anomaly comparison in iot.service never ran.
 *
 * Real chain: iot.route → auth (stubbed: sets the principal) → denyApiKey →
 * validateUuid → rbac → dynamicAccess → iot.controller → iotDevice.service /
 * iot.service. Stubbed: the permission matrix, the audit writer (observed),
 * the rate limiter (a pass-through) and the models, which are an in-memory
 * device table whose `findOne` honours every `where` key it is given — so a
 * lookup that forgot the tenant id WOULD find another tenant's device.
 * Principals come from fixtures/twoTenants.js.
 */

const crypto = require("crypto");

const mockDb = { devices: [], readings: [], notifications: [] };
let currentUser = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      next();
    },
  };
});

jest.mock("../../services/rateLimiter.redis.service", () => ({
  ...jest.requireActual("../../services/rateLimiter.redis.service"),
  endpointRateLimiter: jest.fn(() => (req, res, next) => next()),
}));

jest.mock("../../models", () => {
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  return {
    CalibrationDevice: {
      unscoped: () => ({
        findOne: jest.fn(async ({ where }) => mockDb.devices.find((d) => matches(d, where)) || null),
      }),
    },
    IotReading: {
      create: jest.fn(async (values) => {
        mockDb.readings.push(values);
        return values;
      }),
    },
    Notification: {
      create: jest.fn(async (values) => {
        mockDb.notifications.push(values);
        return values;
      }),
    },
  };
});

jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(async () => ({})) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const config = require("../../config");
const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const auditService = require("../../services/audit.service");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/iot.route");

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

const http = (method, url, { body, headers = {} } = {}) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/iot" + url,
      body,
      query: {},
      params: {},
      headers,
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const ingest = (token, payload) =>
  http("post", "/ingest", { headers: { "x-iot-token": token }, body: { payload } });

// Seed-shaped grants: the admin roles hold calibration write; USER holds read.
const MATRIX = {
  [ROLE_NAMES.HEALTCARE_ADMIN]: { calibration: ["write"] },
  [ROLE_NAMES.USER]: { calibration: ["read"] },
};

const DEVICE_A = "a0000000-0000-4000-8000-00000000000a";
const DEVICE_B = "b0000000-0000-4000-8000-00000000000b";
const DELETED_A = "a0000000-0000-4000-8000-0000000000de";

const device = (id, tenantId, extra = {}) => {
  const row = {
    id,
    tenantId,
    name: `Monitor ${id.slice(-2)}`,
    iotEnabled: false,
    readingTolerance: null,
    iotTokenHash: null,
    iotTokenIssuedAt: null,
    isDeleted: false,
    ...extra,
    async update(values) {
      Object.assign(row, values);
      return row;
    },
  };
  return row;
};

/** The persisted state of a device, without its methods. */
const stored = (id) => {
  const { update: _update, ...fields } = mockDb.devices.find((d) => d.id === id);
  return fields;
};

let fx;
let admin;
let transactions;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
  currentUser = admin;
  const byRoleId = new Map();
  for (const role of Object.keys(MATRIX)) {
    byRoleId.set(fx.principal(fx.tenantA, role).role.id, MATRIX[role]);
    byRoleId.set(fx.principal(fx.tenantB, role).role.id, MATRIX[role]);
  }
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => byRoleId.get(roleId) || {});

  mockDb.devices = [
    device(DEVICE_A, fx.tenantA.id),
    device(DEVICE_B, fx.tenantB.id),
    device(DELETED_A, fx.tenantA.id, { isDeleted: true }),
  ];
  mockDb.readings = [];
  mockDb.notifications = [];

  transactions = [];
  jest.spyOn(config.db, "transaction").mockImplementation(async (work) => {
    const tx = { LOCK: { UPDATE: "UPDATE" }, seq: transactions.length + 1 };
    transactions.push(tx);
    return work(tx);
  });
});

describe("A-29 — issuing an ingest token", () => {
  it("returns the token once and stores only its SHA-256 hash", async () => {
    const res = await http("post", `/devices/${DEVICE_A}/token`);

    expect(res.status).toBe(201);
    const { token } = res.body.data;
    expect(token).toMatch(/^iot_[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(res.body.data).toMatchObject({ deviceId: DEVICE_A, iotEnabled: true, hasToken: true, rotated: false });
    expect(res.body.data).not.toHaveProperty("iotTokenHash");

    const row = stored(DEVICE_A);
    expect(row.iotTokenHash).toBe(sha256(token));
    expect(Object.values(row)).not.toContain(token);
    expect(row.iotEnabled).toBe(true);
    expect(row.iotTokenIssuedAt).toBeInstanceOf(Date);
  });

  it("a device provisioned through the API ingests with its token (end to end)", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;

    const res = await ingest(token, { temperature: 21.5 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true, isAnomaly: false });
    expect(mockDb.readings).toEqual([
      expect.objectContaining({ tenantId: fx.tenantA.id, deviceId: DEVICE_A, isAnomaly: false }),
    ]);
  });

  it("before provisioning, and with a wrong token, ingest is refused 401", async () => {
    expect((await ingest("iot_not-a-real-token", { temperature: 1 })).status).toBe(401);
    await http("post", `/devices/${DEVICE_A}/token`);
    expect((await ingest("iot_not-a-real-token", { temperature: 1 })).status).toBe(401);
    expect(mockDb.readings).toHaveLength(0);
  });

  it("a non-string token is refused 401, not a 500", async () => {
    const res = await http("post", "/ingest", { body: { token: { $ne: null }, payload: { t: 1 } } });
    expect(res.status).toBe(401);
  });

  it("rotating replaces the hash: the old token is refused 401, the new one ingests", async () => {
    const first = (await http("post", `/devices/${DEVICE_A}/token`)).body.data.token;
    const rotation = await http("post", `/devices/${DEVICE_A}/token`);

    expect(rotation.status).toBe(201);
    expect(rotation.body.data.rotated).toBe(true);
    const second = rotation.body.data.token;
    expect(second).not.toBe(first);
    expect(stored(DEVICE_A).iotTokenHash).toBe(sha256(second));

    expect((await ingest(first, { temperature: 20 })).status).toBe(401);
    expect((await ingest(second, { temperature: 20 })).status).toBe(200);
  });

  it("revoking clears the hash and disables ingest; the token is refused 401", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;

    const res = await http("delete", `/devices/${DEVICE_A}/token`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ iotEnabled: false, hasToken: false, tokenIssuedAt: null });
    expect(stored(DEVICE_A)).toMatchObject({ iotTokenHash: null, iotEnabled: false });
    expect((await ingest(token, { temperature: 20 })).status).toBe(401);
  });

  it("revoking when there is no token is a 409 that says so", async () => {
    const res = await http("delete", `/devices/${DEVICE_A}/token`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no IoT ingest token to revoke/);
  });

  it("GET reports whether a token exists — never the token or its hash", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;

    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER); // calibration read is enough
    const res = await http("get", `/devices/${DEVICE_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      deviceId: DEVICE_A,
      name: expect.any(String),
      iotEnabled: true,
      readingTolerance: null,
      hasToken: true,
      tokenIssuedAt: expect.any(Date),
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(sha256(token));
  });

  it("every mutation writes its audit row in the same transaction, without the token or its hash", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;
    await http("post", `/devices/${DEVICE_A}/token`);
    await http("patch", `/devices/${DEVICE_A}`, { body: { readingTolerance: { temperature: { max: 30 } } } });
    await http("delete", `/devices/${DEVICE_A}/token`);

    expect(auditService.logAction).toHaveBeenCalledTimes(4);
    const events = auditService.logAction.mock.calls.map(([entry, options], i) => {
      expect(options.transaction).toBe(transactions[i]);
      expect(entry).toMatchObject({
        tenantId: fx.tenantA.id,
        userId: admin.id,
        action: "UPDATE",
        resourceType: "CalibrationDevice",
        resourceId: DEVICE_A,
      });
      const changes = JSON.stringify(entry.changes);
      expect(changes).not.toContain(token);
      expect(changes).not.toContain(sha256(token));
      return entry.changes.iot;
    });
    expect(events).toEqual(["TOKEN_ISSUED", "TOKEN_ROTATED", "CONFIG_UPDATED", "TOKEN_REVOKED"]);
  });
});

describe("A-29 — authorization and tenant isolation", () => {
  const routes = [
    ["get", (id) => `/devices/${id}`, undefined],
    ["patch", (id) => `/devices/${id}`, { readingTolerance: { temperature: { max: 30 } } }],
    ["post", (id) => `/devices/${id}/token`, undefined],
    ["delete", (id) => `/devices/${id}/token`, undefined],
  ];

  it.each(routes)(
    "%s on another tenant's device answers 404, and the device is unchanged (two-tenant)",
    async (method, path, body) => {
      mockDb.devices.find((d) => d.id === DEVICE_B).iotTokenHash = sha256("iot_tenant-b");
      const before = stored(DEVICE_B);

      const res = await http(method, path(DEVICE_B), { body });

      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Calibration device not found");
      expect(stored(DEVICE_B)).toEqual(before);
      expect(auditService.logAction).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    "%s on a soft-deleted device answers the same 404 as another tenant's",
    async (method, path, body) => {
      const deleted = await http(method, path(DELETED_A), { body });
      const foreign = await http(method, path(DEVICE_B), { body });
      expect(deleted).toEqual(foreign);
    },
  );

  it("an ordinary USER cannot issue, rotate, revoke or configure (403), and nothing changes", async () => {
    currentUser = fx.principal(fx.tenantA, ROLE_NAMES.USER);
    const before = stored(DEVICE_A);

    for (const [method, path, body] of routes.slice(1)) {
      expect((await http(method, path(DEVICE_A), { body })).status).toBe(403);
    }
    expect(stored(DEVICE_A)).toEqual(before);
  });

  it("an API key cannot mint a device token, even one scoped to calibration write", async () => {
    currentUser = { ...admin, isApiKey: true, apiKeyScopes: ["calibration:write", "*"] };
    const res = await http("post", `/devices/${DEVICE_A}/token`);
    expect(res.status).toBe(403);
    expect(stored(DEVICE_A).iotTokenHash).toBeNull();
  });

  it("a malformed device id is refused before any lookup", async () => {
    const res = await http("post", "/devices/not-a-uuid/token");
    expect(res.status).toBe(400);
    expect(config.db.transaction).not.toHaveBeenCalled();
  });
});

describe("A-46 — reading tolerance and anomaly detection", () => {
  it("PATCH sets readingTolerance; an out-of-tolerance reading is flagged and notifies (end to end)", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;
    const tolerance = { temperature: { min: 15, max: 30 }, humidity: { max: 70 } };

    const patch = await http("patch", `/devices/${DEVICE_A}`, { body: { readingTolerance: tolerance } });
    expect(patch.status).toBe(200);
    expect(patch.body.data.readingTolerance).toEqual(tolerance);
    expect(stored(DEVICE_A).readingTolerance).toEqual(tolerance);

    const res = await ingest(token, { temperature: 42, humidity: 50 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ success: true, isAnomaly: true });
    expect(mockDb.readings).toEqual([
      expect.objectContaining({ deviceId: DEVICE_A, tenantId: fx.tenantA.id, isAnomaly: true }),
    ]);
    expect(mockDb.notifications).toEqual([
      expect.objectContaining({
        tenantId: fx.tenantA.id,
        type: "system",
        message: expect.stringContaining("temperature (42) is above max (30)"),
      }),
    ]);
  });

  it("a below-min reading is flagged; an in-tolerance reading is not", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;
    await http("patch", `/devices/${DEVICE_A}`, { body: { readingTolerance: { temperature: { min: 15 } } } });

    expect((await ingest(token, { temperature: 20 })).body.data.isAnomaly).toBe(false);
    expect((await ingest(token, { temperature: 3 })).body.data.isAnomaly).toBe(true);
    expect(mockDb.notifications).toHaveLength(1);
    expect(mockDb.notifications[0].message).toContain("temperature (3) is below min (15)");
  });

  it("readingTolerance: null clears it", async () => {
    await http("post", `/devices/${DEVICE_A}/token`);
    await http("patch", `/devices/${DEVICE_A}`, { body: { readingTolerance: { t: { max: 1 } } } });
    const res = await http("patch", `/devices/${DEVICE_A}`, { body: { readingTolerance: null } });
    expect(res.status).toBe(200);
    expect(stored(DEVICE_A).readingTolerance).toBeNull();
  });

  it.each([
    ["min greater than max", { readingTolerance: { temperature: { min: 40, max: 30 } } }],
    ["a misspelt bound (refused, not stripped)", { readingTolerance: { temperature: { mx: 30 } } }],
    ["no bound at all", { readingTolerance: { temperature: {} } }],
    ["a non-numeric bound", { readingTolerance: { temperature: { max: "hot" } } }],
    ["a bad metric name", { readingTolerance: { "temp erature!": { max: 30 } } }],
    ["an empty body", {}],
    ["no body", undefined],
    ["iotEnabled not a boolean", { iotEnabled: "yes please" }],
  ])("an invalid PATCH is 400 and changes nothing: %s", async (label, body) => {
    const before = stored(DEVICE_A);
    const res = await http("patch", `/devices/${DEVICE_A}`, { body });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation failed");
    expect(stored(DEVICE_A)).toEqual(before);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("enabling ingest on a device with no token is a 409 state explanation", async () => {
    const res = await http("patch", `/devices/${DEVICE_A}`, { body: { iotEnabled: true } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no IoT ingest token.*Issue a token first/);
    expect(stored(DEVICE_A).iotEnabled).toBe(false);
  });

  it("disabling ingest keeps the token but refuses readings until re-enabled", async () => {
    const { token } = (await http("post", `/devices/${DEVICE_A}/token`)).body.data;

    expect((await http("patch", `/devices/${DEVICE_A}`, { body: { iotEnabled: false } })).status).toBe(200);
    expect((await ingest(token, { temperature: 20 })).status).toBe(401);

    expect((await http("patch", `/devices/${DEVICE_A}`, { body: { iotEnabled: true } })).status).toBe(200);
    expect((await ingest(token, { temperature: 20 })).status).toBe(200);
  });
});

describe("A-29 — a super admin acting in a tenant", () => {
  it("uses the effective tenant (x-tenant-id) for the lookup", async () => {
    currentUser = fx.superAdmin; // home tenant A
    const res = await new Promise((resolve) => {
      const req = {
        method: "POST",
        url: `/devices/${DEVICE_B}/token`,
        originalUrl: `/api/v1/iot/devices/${DEVICE_B}/token`,
        body: undefined,
        query: {},
        params: {},
        headers: {},
        tenantId: fx.tenantB.id,
        ip: "127.0.0.1",
        get: () => undefined,
      };
      const response = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          resolve({ status: this.statusCode, body: payload });
          return this;
        },
        setHeader() {
          return this;
        },
      };
      router.handle(req, response, (err) => resolve({ status: err ? err.status : 404 }));
    });
    expect(res.status).toBe(201);
    expect(stored(DEVICE_B).iotTokenHash).toBe(sha256(res.body.data.token));
  });
});
