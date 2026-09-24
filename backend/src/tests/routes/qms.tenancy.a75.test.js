/**
 * A-74 / A-75 — the QMS create routes validate their body, and a QMS record
 * cannot reference another tenant's device or user.
 *
 * Behaviour through the REAL chain: qms.route → dynamicAccess → validate →
 * qms.controller → qms.service, over the two-tenant fixture
 * (fixtures/twoTenants.js). Only `auth` (to set the principal), the permission
 * matrix (the seed's grants: both tenant-admin roles hold `qms` write), the
 * audit insert and the model/database layer are stubbed. The model doubles
 * answer `findOne({ where: { id, tenantId } })` against rows that belong to
 * tenant A or tenant B, as the database would; they do not scope by
 * themselves, so a service that forgot the tenant predicate would find the
 * foreign row and these tests would see it.
 */

const mockFx = { current: null, store: null };
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

/** findOne over a table: matches every key of `where` exactly, nothing else. */
const mockFindOne = (table) =>
  jest.fn(async ({ where }) => {
    const row = mockFx.store[table].find((r) =>
      Object.entries(where).every(([k, v]) => r[k] === v),
    );
    return row ? { ...row } : null;
  });

const mockCreate = (table) =>
  jest.fn(async (values) => {
    const row = { id: `${table}-${mockFx.store[table].length + 1}`, ...values };
    mockFx.store[table].push(row);
    return row;
  });

jest.mock("../../models", () => ({
  Tenants: { findByPk: (...args) => mockFx.current.Tenants.findByPk(...args) },
  User: {
    findByPk: (...args) => mockFx.current.Users.findByPk(...args),
    findOne: mockFindOne("users"),
  },
  CalibrationDevice: { findOne: mockFindOne("devices") },
  // `count` is here only so that pre-A-73 code (which numbered by count()+1)
  // runs to completion under this fixture: a refusal these tests assert must
  // come from the tenant check, not from a missing double.
  NonConformance: {
    findOne: mockFindOne("ncs"),
    create: mockCreate("ncs"),
    count: jest.fn(async ({ where }) => mockFx.store.ncs.filter((r) => r.tenantId === where.tenantId).length),
  },
  Capa: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockFx.store.capas.find((r) => r.id === where.id && r.tenantId === where.tenantId);
      return row ? Object.assign(row, { save: jest.fn(async () => row) }) : null;
    }),
    create: mockCreate("capas"),
    count: jest.fn(async ({ where }) => mockFx.store.capas.filter((r) => r.tenantId === where.tenantId).length),
  },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: async (cb) => cb({ id: "tx" }),
    // The per-tenant counter claim (A-73): one counter per tenant and kind.
    query: async (sql, { replacements: { tenantId, kind } }) => {
      const key = `${tenantId}:${kind}`;
      const seq = (mockFx.store.counters.get(key) || 0) + 1;
      mockFx.store.counters.set(key, seq);
      return [[{ seq }]];
    },
  },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const models = require("../../models");
const { ROLE_NAMES, MENU_SLUGS } = require("../../constants");
const router = require("../../routes/api/qms.route");

const http = (method, url, body = {}) =>
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
      originalUrl: "/api/v1/qms" + url,
      body,
      query: {},
      params: {},
      headers: {},
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

const DEVICE_A = "aaaa0001-0000-4000-8000-000000000001";
const DEVICE_B = "bbbb0001-0000-4000-8000-000000000001";
const NC_A = "aaaa0002-0000-4000-8000-000000000001";
const CAPA_A = "aaaa0003-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let fx;
let adminA;
let userA;
let userB;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockFx.current = fx;
  adminA = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
  userA = fx.principal(fx.tenantA, ROLE_NAMES.USER);
  userB = fx.principal(fx.tenantB, ROLE_NAMES.USER);
  mockFx.store = {
    users: [userA, userB, adminA].map((p) => ({ id: p.id, tenantId: p.tenantId })),
    devices: [
      { id: DEVICE_A, tenantId: fx.tenantA.id },
      { id: DEVICE_B, tenantId: fx.tenantB.id },
    ],
    ncs: [{ id: NC_A, tenantId: fx.tenantA.id, ncNumber: "NC-00001" }],
    capas: [{ id: CAPA_A, tenantId: fx.tenantA.id, capaNumber: "CAPA-00001", assignedTo: null }],
    counters: new Map(),
  };
  const grant = { [MENU_SLUGS.QMS]: ["write"] };
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) =>
    roleId === adminA.role.id ? grant : {},
  );
  currentUser = adminA;
});

describe("A-75 — a QMS record cannot reference another tenant's device or user", () => {
  it("a foreign deviceId is refused with 404", async () => {
    const res = await http("post", "/nc", { title: "Drift", description: "d", deviceId: DEVICE_B });

    expect(res.status).toBe(404);
    expect(models.NonConformance.create).not.toHaveBeenCalled();
    expect(mockFx.store.ncs).toHaveLength(1);
  });

  it("a foreign deviceId gets the same answer as a device that does not exist", async () => {
    const foreign = await http("post", "/nc", { title: "t", description: "d", deviceId: DEVICE_B });
    const missing = await http("post", "/nc", { title: "t", description: "d", deviceId: MISSING });

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it("a device of the caller's own tenant is accepted, and the NC is numbered in that tenant", async () => {
    const res = await http("post", "/nc", { title: "Drift", description: "d", deviceId: DEVICE_A });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(
      expect.objectContaining({ tenantId: fx.tenantA.id, deviceId: DEVICE_A, ncNumber: "NC-00001" }),
    );
  });

  it("a foreign assignedTo is refused with 404", async () => {
    const res = await http("post", "/capa", {
      ncId: NC_A,
      title: "Recalibrate",
      actionPlan: "p",
      assignedTo: userB.id,
    });

    expect(res.status).toBe(404);
    expect(models.Capa.create).not.toHaveBeenCalled();
    expect(mockFx.store.capas).toHaveLength(1);
  });

  it("an assignee of the caller's own tenant is accepted", async () => {
    const res = await http("post", "/capa", {
      ncId: NC_A,
      title: "Recalibrate",
      actionPlan: "p",
      assignedTo: userA.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(expect.objectContaining({ assignedTo: userA.id, capaNumber: "CAPA-00001" }));
  });

  it("reassigning a CAPA to a foreign user is refused with 404 and the CAPA is unchanged", async () => {
    const res = await http("patch", `/capa/${CAPA_A}`, { assignedTo: userB.id });

    expect(res.status).toBe(404);
    expect(mockFx.store.capas[0].assignedTo).toBeNull();
  });

  it("another tenant's NC cannot be the parent of a CAPA", async () => {
    mockFx.store.ncs[0].tenantId = fx.tenantB.id;

    const res = await http("post", "/capa", { ncId: NC_A, title: "t", actionPlan: "p" });

    expect(res.status).toBe(404);
  });
});

describe("A-74 — the QMS create routes validate their body", () => {
  it("POST /nc with an invalid severity is a 400", async () => {
    const res = await http("post", "/nc", { title: "t", description: "d", severity: "APOCALYPTIC" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Validation Error");
    expect(models.NonConformance.create).not.toHaveBeenCalled();
  });

  it.each([
    ["POST /nc without a title", "/nc", { description: "d" }],
    ["POST /nc without a description", "/nc", { title: "t" }],
    ["POST /nc with a non-uuid deviceId", "/nc", { title: "t", description: "d", deviceId: "dev-1" }],
    ["POST /capa without an ncId", "/capa", { title: "t", actionPlan: "p" }],
    ["POST /capa without an actionPlan", "/capa", { ncId: NC_A, title: "t" }],
    ["POST /capa with a non-uuid assignedTo", "/capa", { ncId: NC_A, title: "t", actionPlan: "p", assignedTo: "x" }],
  ])("%s is a 400 that reaches no model", async (name, url, body) => {
    const res = await http("post", url, body);

    expect(res.status).toBe(400);
    expect(models.NonConformance.create).not.toHaveBeenCalled();
    expect(models.Capa.create).not.toHaveBeenCalled();
  });

  it("a body tenantId is stripped — the record is stamped with the caller's tenant", async () => {
    const res = await http("post", "/nc", { title: "t", description: "d", tenantId: fx.tenantB.id });

    expect(res.status).toBe(201);
    expect(res.body.data.tenantId).toBe(fx.tenantA.id);
  });
});
