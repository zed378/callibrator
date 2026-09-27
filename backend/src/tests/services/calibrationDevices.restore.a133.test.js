/**
 * A-133 (ADR-075) — a soft-deleted calibration device can be restored.
 *
 * Before: no route called `restoreStatic`; a device deleted in error left its
 * calibration records and certificates attached to a register entry nobody
 * could reach, and the only way back was the database. Now
 * POST /calibration-devices/:id/restore restores the device and EXACTLY the
 * attachments its deletion removed, in one transaction, with an audit row.
 *
 * What is real: the route's gates (rbac, validateUuid), the controller,
 * calibrationDevices.service, attachment.service#restoreForResource,
 * CalibrationDevice.restoreStatic, audit.service, the REAL models barrel with
 * its global tenant hooks and defaultScopes, on an UNCONNECTED
 * PostgreSQL-dialect Sequelize whose `query` plays the calibration_devices and
 * attachments tables from the SQL it is given — a predicate the SQL does not
 * carry is not applied, as PostgreSQL would not apply it. Writes go through the
 * auditLedger fixture, so only what a transaction COMMITS is visible.
 * Stubbed: `auth` (sets the principal and the tenant context) and
 * `dynamicAccess` (the permission matrix is not what is under test), and
 * AuditLog.findAll, which filters the ledger's rows by the `where` object the
 * service builds (the JSONB SQL itself is exercised on PostgreSQL 18 — see the
 * card).
 */
const { createLedger } = require("../fixtures/auditLedger");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const TECH_A = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const DEVICE_A = "d0000000-0000-4000-8000-00000000000a";
const LIVE_A = "d0000000-0000-4000-8000-0000000000a2";
const DEVICE_B = "d0000000-0000-4000-8000-00000000000b";
const MISSING = "d0000000-0000-4000-8000-0000000000ff";
const ATT_CASCADED = "e0000000-0000-4000-8000-000000000001";
const ATT_OWN_DELETE = "e0000000-0000-4000-8000-000000000002";
const ATT_LIVE = "e0000000-0000-4000-8000-000000000003";
const ATT_RE_DELETED = "e0000000-0000-4000-8000-000000000004";

const mockState = { tables: {}, sql: [], ledger: null, principal: null, failUpdate: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });

  // A value inline ('x', true) or bound ($n: a bulk UPDATE binds its WHERE too).
  const literal = (raw, bind = []) => {
    const value = raw.trim();
    if (/^\$\d+$/.test(value)) {return bind[Number(value.slice(1)) - 1];}
    if (value === "true" || value === "false") {return value === "true";}
    if (value === "NULL") {return null;}
    return value.replace(/^'|'$/g, "").replace(/''/g, "'");
  };
  // The equality predicates of a WHERE clause, as [column, test].
  const predicates = (where, bind) => {
    const tests = [];
    for (const m of where.matchAll(/"(\w+)" = ('(?:[^']|'')*'|true|false|\$\d+)/g)) {
      tests.push([m[1], (v) => v === literal(m[2], bind)]);
    }
    for (const m of where.matchAll(/"(\w+)" != ('(?:[^']|'')*')/g)) {
      tests.push([m[1], (v) => v !== literal(m[2])]);
    }
    for (const m of where.matchAll(/"(\w+)" IN \(([^)]*)\)/g)) {
      const values = m[2].split(",").map(literal);
      tests.push([m[1], (v) => values.includes(v)]);
    }
    return tests;
  };
  const current = (table) => {
    const rows = (mockState.tables[table] || []).map((row) => ({ ...row }));
    for (const change of mockState.ledger.committed(table)) {
      const row = rows.find((r) => r.id === change.id);
      if (row) {Object.assign(row, change);}
    }
    return rows;
  };

  db.query = async (sql, options = {}) => {
    // A bulk UPDATE arrives as { query, bind }.
    const text = typeof sql === "string" ? sql : sql.query;
    const bind = (typeof sql === "object" && sql.bind) || options.bind || [];
    mockState.sql.push(text);
    const table = (text.match(/(?:FROM|UPDATE) "(\w+)"/) || [])[1];
    const whereAt = text.indexOf(" WHERE ");
    const tests = whereAt === -1 ? [] : predicates(text.slice(whereAt), bind);
    const matching = current(table).filter((row) => tests.every(([column, test]) => test(row[column])));

    if (/^UPDATE /.test(text)) {
      if (mockState.failUpdate && mockState.failUpdate.table === table) {
        const error = mockState.failUpdate.error;
        mockState.failUpdate = null;
        throw error;
      }
      const set = text.slice(text.indexOf(" SET ") + 5, whereAt);
      const changes = {};
      for (const m of set.matchAll(/"(\w+)"=\$(\d+)/g)) {
        changes[m[1]] = bind[Number(m[2]) - 1];
      }
      for (const row of matching) {
        mockState.ledger.write(table, { id: row.id, ...changes }, options);
      }
      return matching.length;
    }
    if (!/^SELECT /.test(text) || !options.model) {
      return options.plain ? null : [];
    }
    // Rows are stored by column; answer by attribute, as the SELECT aliases do.
    const fields = options.model.getAttributes();
    const byAttribute = matching.map((row) =>
      Object.fromEntries(
        Object.entries(fields)
          .filter(([, a]) => Object.prototype.hasOwnProperty.call(row, a.field))
          .map(([name, a]) => [name, row[a.field]]),
      ),
    );
    const built = options.model.bulkBuild(byAttribute, { raw: true, isNewRecord: false });
    return options.plain ? built[0] || null : built;
  };
  db.transaction = (...args) => mockState.ledger.transaction(...args);
  return { db };
});

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  const { tenantStorage } = jest.requireActual("../../middlewares/tenantContext.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockState.principal;
      req.tenantId = mockState.principal.viaUserOnly ? undefined : mockState.principal.tenantId;
      tenantStorage.run({ tenantId: mockState.principal.tenantId, isSuperAdmin: false, isSystemTask: false }, next);
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { UniqueConstraintError } = require("sequelize");
const models = require("../../models");
const router = require("../../routes/api/calibrationDevices.route");
const { ROLE_LEVELS } = require("../../constants/roleConstants");

const admin = { id: ADMIN_A, tenantId: TENANT_A, role: { name: "HEALTCARE_ADMIN", roleLevel: ROLE_LEVELS.HEALTCARE_ADMIN } };
const technician = { id: TECH_A, tenantId: TENANT_A, role: { name: "TECHNICIAN", roleLevel: ROLE_LEVELS.TECHNICIAN } };

const device = (id, tenantId, overrides = {}) => ({
  id,
  tenant_id: tenantId,
  name: `Infusion pump ${id.slice(-2)}`,
  serial_number: `SN-${id.slice(-2)}`,
  status: "active",
  is_deleted: true,
  deleted_at: null,
  ...overrides,
});
const attachment = (id, overrides = {}) => ({
  id,
  tenant_id: TENANT_A,
  resource_type: "CalibrationDevice",
  resource_id: DEVICE_A,
  original_name: `cert-${id.slice(-1)}.pdf`,
  checksum: `sha256-${id.slice(-1)}`,
  is_deleted: true,
  deleted_at: null,
  ...overrides,
});
const deleteRow = (attachmentId, changes, createdAt) => ({
  id: `seed-${attachmentId}-${createdAt}`,
  tenantId: TENANT_A,
  userId: ADMIN_A,
  action: "DELETE",
  resourceType: "Attachment",
  resourceId: attachmentId,
  changes,
  createdAt: new Date(createdAt),
});
const cascade = (id = DEVICE_A) => ({
  operation: "cascade-soft-delete",
  before: { isDeleted: false },
  after: { isDeleted: true },
  cascade: { type: "CalibrationDevice", id },
});
const ownDelete = { before: { isDeleted: false }, after: { isDeleted: true } };

let seededAudit;

const matchesWhere = (row, where) =>
  Object.entries(where).every(([key, expected]) => {
    if (key === "changes") {
      return (
        row.changes &&
        row.changes.operation === expected.operation &&
        row.changes.cascade &&
        row.changes.cascade.type === expected.cascade.type &&
        row.changes.cascade.id === expected.cascade.id
      );
    }
    return Array.isArray(expected) ? expected.includes(row[key]) : row[key] === expected;
  });

const request = (principal, url) =>
  new Promise((resolve) => {
    mockState.principal = principal;
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload, text: JSON.stringify(payload) });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: "POST",
      url,
      originalUrl: `/api/v1/calibration-devices${url}`,
      body: {},
      query: {},
      params: {},
      headers: { "user-agent": "admin-browser" },
      ip: "192.0.2.44",
      get: () => undefined,
    };
    router.handle(req, res, (err) => resolve({ status: err ? err.status || 500 : 404, body: null, text: "" }));
  });

const restore = (principal, id) => request(principal, `/${id}/restore`);
const deviceNow = (id) => {
  const base = mockState.tables.calibration_devices.find((row) => row.id === id);
  return { ...base, ...Object.assign({}, ...mockState.ledger.committed("calibration_devices").filter((c) => c.id === id)) };
};
const attachmentNow = (id) => {
  const base = mockState.tables.attachments.find((row) => row.id === id);
  return { ...base, ...Object.assign({}, ...mockState.ledger.committed("attachments").filter((c) => c.id === id)) };
};

beforeEach(() => {
  mockState.ledger = createLedger();
  mockState.sql = [];
  mockState.failUpdate = null;
  mockState.tables = {
    calibration_devices: [
      device(DEVICE_A, TENANT_A),
      device(LIVE_A, TENANT_A, { is_deleted: false, serial_number: "SN-LIVE" }),
      device(DEVICE_B, TENANT_B),
    ],
    attachments: [
      attachment(ATT_CASCADED),
      attachment(ATT_OWN_DELETE),
      attachment(ATT_LIVE, { is_deleted: false }),
      attachment(ATT_RE_DELETED),
    ],
  };
  seededAudit = [
    // Deleted on its own BEFORE the device: the cascade never touched it.
    deleteRow(ATT_OWN_DELETE, ownDelete, "2026-09-01T10:00:00Z"),
    // Taken by the device's delete.
    deleteRow(ATT_CASCADED, cascade(), "2026-09-02T10:00:00Z"),
    // Taken by an EARLIER delete of the device, restored, then deleted on its own.
    deleteRow(ATT_RE_DELETED, cascade(), "2026-08-01T10:00:00Z"),
    deleteRow(ATT_RE_DELETED, ownDelete, "2026-08-15T10:00:00Z"),
    // Another tenant's cascade row for the same attachment id shape: never read.
    { ...deleteRow(ATT_OWN_DELETE, cascade(), "2026-09-03T10:00:00Z"), tenantId: TENANT_B },
  ];
  jest.spyOn(models.AuditLog, "findAll").mockImplementation(async ({ where, order }) => {
    const rows = [...seededAudit, ...mockState.ledger.auditRows()].filter((row) => matchesWhere(row, where));
    if (order) {
      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return rows;
  });
  jest.spyOn(models.AuditLog, "create").mockImplementation((...args) => mockState.ledger.AuditLog.create(...args));
});

afterEach(() => jest.restoreAllMocks());

const restoreRows = () =>
  mockState.ledger.auditRows().filter((row) => row.changes && /restore/i.test(row.changes.operation || ""));

describe("A-133 — restoring a deleted device", () => {
  it("a tenant administrator restores a deleted device: 200, the device is live again", async () => {
    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(200);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(false);
    expect(res.body.data).toMatchObject({ id: DEVICE_A, isDeleted: false });
  });

  it("restores exactly the attachments its deletion took — not one deleted on its own, before or after", async () => {
    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(200);
    expect(attachmentNow(ATT_CASCADED).is_deleted).toBe(false);
    expect(attachmentNow(ATT_OWN_DELETE).is_deleted).toBe(true);
    expect(attachmentNow(ATT_RE_DELETED).is_deleted).toBe(true);
    expect(res.body.message).toMatch(/1 attachment/);
  });

  it("writes one RESTORE row for the device and one cascade-restore row per attachment, in the transaction", async () => {
    await restore(admin, DEVICE_A);

    const rows = restoreRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.resourceType === "CalibrationDevice")).toMatchObject({
      tenantId: TENANT_A,
      userId: ADMIN_A,
      action: "UPDATE",
      resourceId: DEVICE_A,
      ipAddress: "192.0.2.44",
      userAgent: "admin-browser",
      changes: {
        operation: "RESTORE",
        before: { isDeleted: true },
        after: { isDeleted: false },
        attachmentsRestored: [ATT_CASCADED],
      },
    });
    expect(rows.find((r) => r.resourceType === "Attachment")).toMatchObject({
      action: "UPDATE",
      resourceId: ATT_CASCADED,
      changes: { operation: "cascade-restore", cascade: { type: "CalibrationDevice", id: DEVICE_A } },
    });
  });

  it("a failed audit insert rolls the whole restore back — device and attachments stay deleted", async () => {
    mockState.ledger.failNext("audit_logs");

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(500);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
    expect(attachmentNow(ATT_CASCADED).is_deleted).toBe(true);
    expect(restoreRows()).toEqual([]);
  });

  it("every read of the device carries the caller's tenant in its SQL", async () => {
    await restore(admin, DEVICE_A);

    const deviceSelects = mockState.sql.filter((sql) => /^SELECT .* FROM "calibration_devices"/.test(sql));
    expect(deviceSelects.length).toBeGreaterThan(0);
    for (const sql of deviceSelects) {
      expect(sql).toContain(`"tenant_id" = '${TENANT_A}'`);
    }
    const attachmentSelects = mockState.sql.filter((sql) => /^SELECT .* FROM "attachments"/.test(sql));
    expect(attachmentSelects.length).toBeGreaterThan(0);
    for (const sql of attachmentSelects) {
      expect(sql).toContain(`"tenant_id" = '${TENANT_A}'`);
    }
    // A bulk UPDATE binds its predicate; the fake applies it from the bind
    // values, so a write that lacked it would have touched tenant B's rows.
    const updates = mockState.sql.filter((sql) => /^UPDATE /.test(sql));
    expect(updates).toHaveLength(2);
    for (const sql of updates) {
      expect(sql).toMatch(/"tenant_id" = \$\d+/);
    }
  });
});

describe("A-133 — two tenants: another tenant's device is 404, never 403", () => {
  it("tenant A's administrator restoring tenant B's deleted device gets exactly the not-found answer", async () => {
    const otherTenant = await restore(admin, DEVICE_B);
    const missing = await restore(admin, MISSING);

    expect(otherTenant.status).toBe(404);
    expect(otherTenant.text).toBe(missing.text);
    expect(deviceNow(DEVICE_B).is_deleted).toBe(true);
    expect(mockState.ledger.committed("calibration_devices")).toEqual([]);
    expect(mockState.ledger.auditRows()).toEqual([]);
  });
});

describe("A-133 — 409 is a state explanation", () => {
  it("a device that is not deleted: 409 saying there is nothing to restore", async () => {
    const res = await restore(admin, LIVE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/is not deleted, so there is nothing to restore/);
    expect(mockState.ledger.auditRows()).toEqual([]);
  });

  it("a deleted device whose serial a LIVE device of the tenant now holds: 409 naming the fix, nothing written", async () => {
    mockState.tables.calibration_devices.find((row) => row.id === LIVE_A).serial_number = "SN-0a";

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/serial number "SN-0a" is now held by another calibration device/);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
    expect(mockState.ledger.auditRows()).toEqual([]);
  });

  it("the unique index refusing the restore (a race) is the same 409, and nothing is written", async () => {
    mockState.failUpdate = {
      table: "calibration_devices",
      error: new UniqueConstraintError({
        message: "Validation error",
        fields: { serial_number: "SN-0a" },
        parent: { code: "23505", constraint: "calibration_devices_tenant_id_serial_number_unique" },
      }),
    };

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/is now held by another calibration device/);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
    expect(restoreRows()).toEqual([]);
  });

  it("a restore that a concurrent request already made: 409, not a second audit row", async () => {
    jest.spyOn(models.CalibrationDevice, "restoreStatic").mockResolvedValueOnce([0]);

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/has just been restored by another request/);
    expect(restoreRows()).toEqual([]);
  });

  it("any other failure propagates as a 500 and rolls back", async () => {
    mockState.failUpdate = { table: "calibration_devices", error: new Error("connection lost") };

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(500);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
  });
});

describe("A-133 — who may restore", () => {
  it("a technician (below tenant administrator) is refused with 403, and nothing is read or written", async () => {
    const res = await restore(technician, DEVICE_A);

    expect(res.status).toBe(403);
    expect(mockState.sql).toEqual([]);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
  });

  it("a malformed id is a 400 before anything is read", async () => {
    const res = await restore(admin, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(mockState.sql).toEqual([]);
  });
});

describe("A-133 — a device with nothing cascaded", () => {
  it("restores with no attachment and says so", async () => {
    seededAudit = [];

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Calibration device restored");
    expect(restoreRows()).toHaveLength(1);
  });

  it("a device without a serial number skips the serial check", async () => {
    mockState.tables.calibration_devices.find((row) => row.id === DEVICE_A).serial_number = null;

    const res = await restore(admin, DEVICE_A);

    expect(res.status).toBe(200);
  });
});

describe("A-133 — the tenant comes from the principal", () => {
  it("with no request-level tenant, the principal's own tenant is used — and another tenant's device is still 404", async () => {
    const res = await restore({ ...admin, viaUserOnly: true }, DEVICE_B);

    expect(res.status).toBe(404);
  });

  it("the service called without an actor is refused by the audit rule and rolls back (never restored unattributed)", async () => {
    const service = require("../../services/calibrationDevices.service");
    const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

    // audit_logs requires an actor (A-124): with none, the audit insert is
    // refused and the restore rolls back — nothing is restored unattributed.
    await expect(
      tenantStorage.run({ tenantId: TENANT_A, isSuperAdmin: false, isSystemTask: false }, () =>
        service.restoreCalibrationDevice(TENANT_A, DEVICE_A),
      ),
    ).rejects.toThrow(/must name its actor/);
    expect(deviceNow(DEVICE_A).is_deleted).toBe(true);
  });
});
