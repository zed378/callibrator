/**
 * F-13 (ADR-074) — the two list endpoints the frontend audit found breaking
 * the house envelope, driven through their REAL routers.
 *
 * CLAUDE.md § The Response Envelope: rows in `data`, pagination in a
 * TOP-LEVEL `meta`, a sibling of `data`. Never `data.rows`, never `data.meta`.
 *
 *   GET /api/v1/sessions                 sent `data: { sessions, meta }` (fixed by A-111)
 *   GET /api/v1/metered-billing/history  sent `data: { rows, meta }`     (fixed here)
 *
 * The controller and service tests mock `response.util`, so they pin the
 * arguments a controller passes, not the body a client receives. Here the
 * route, its gates, the controller, the service and `response.util` are all
 * real; only `auth` (to set the principal) and the model layer are stubbed.
 * The assertion is on the JSON body a client actually receives.
 */

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

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../config", () => ({
  db: {
    getDialect: () => "postgres",
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: { Op: { gte: "gte", lte: "lte", ne: "ne" }, fn: jest.fn(), col: jest.fn() },
    query: jest.fn(),
  },
}));

jest.mock("../../models", () => ({
  Sessions: { findAndCountAll: jest.fn() },
  Users: {},
  Roles: {},
  Tenants: { findByPk: jest.fn() },
  User: { findByPk: jest.fn() },
  Invoice: { findAndCountAll: jest.fn() },
  UsageMetric: { findAll: jest.fn().mockResolvedValue([]) },
  UsageAlert: { findAll: jest.fn() },
  Tenant: { findByPk: jest.fn() },
}));

const { Sessions, Invoice } = require("../../models");
const sessionRouter = require("../../routes/api/session.route");
const billingRouter = require("../../routes/api/meteredBilling.route");

// Express's own router.handle with a minimal req/res pair — the harness of
// routeGuards.a28 / workflows.access.a58 (supertest is not a dependency).
const call = (router, mount, url) =>
  new Promise((resolve) => {
    const [pathname, search = ""] = url.split("?");
    const query = Object.fromEntries(new URLSearchParams(search));
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
      set() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "GET",
      url,
      path: pathname,
      originalUrl: mount + url,
      baseUrl: mount,
      body: {},
      query,
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

const USER = "550e8400-e29b-41d4-a716-446655440000";
const TENANT = "33333333-3333-4333-8333-333333333333";

/** The envelope's rule, stated once: rows in data, meta beside it. */
const expectHouseEnvelope = (body, { rows, meta }) => {
  expect(body.success).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data).toHaveLength(rows);
  expect(body.meta).toEqual(meta);
  // Never the nested shapes.
  expect(body.data).not.toHaveProperty("rows");
  expect(body.data).not.toHaveProperty("meta");
  expect(body.data).not.toHaveProperty("sessions");
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = {
    id: USER,
    tenantId: TENANT,
    role: { id: "SUPERADMIN", name: "SUPERADMIN", role_level: 10 },
  };
});

describe("F-13 — list endpoints answer the house envelope through their routes", () => {
  it("GET /api/v1/metered-billing/history puts the invoices in data and the pagination in a top-level meta", async () => {
    Invoice.findAndCountAll.mockResolvedValueOnce({
      count: 21,
      rows: [
        { id: "inv-1", tenantId: TENANT, amount: 100 },
        { id: "inv-2", tenantId: TENANT, amount: 250 },
      ],
    });

    const { status, body } = await call(billingRouter, "/api/v1/metered-billing", "/history?page=2&limit=10");

    expect(status).toBe(200);
    expectHouseEnvelope(body, {
      rows: 2,
      meta: { total: 21, page: 2, limit: 10, totalPages: 3 },
    });
    expect(body.data[0]).toEqual({ id: "inv-1", tenantId: TENANT, amount: 100 });
    // The tenant is the caller's, from the principal.
    expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT }, limit: 10, offset: 10 }),
    );
  });

  it("GET /api/v1/metered-billing/history with no invoices is an empty data array, not an empty object", async () => {
    Invoice.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

    const { status, body } = await call(billingRouter, "/api/v1/metered-billing", "/history");

    expect(status).toBe(200);
    expectHouseEnvelope(body, {
      rows: 0,
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
    });
  });

  it("GET /api/v1/sessions puts the sessions in data and the pagination in a top-level meta", async () => {
    Sessions.findAndCountAll.mockResolvedValueOnce({
      count: 3,
      rows: [
        {
          id: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
          user_id: USER,
          is_revoked: false,
          expired_at: new Date(Date.now() + 86400000),
          user: { username: "tech1", email: "t@x.test" },
        },
      ],
    });

    const { status, body } = await call(sessionRouter, "/api/v1/sessions", "/?page=1&limit=20");

    expect(status).toBe(200);
    expectHouseEnvelope(body, {
      rows: 1,
      meta: { total: 3, page: 1, limit: 20, totalPages: 1 },
    });
    expect(body.data[0]).toMatchObject({ id: "8c352a92-d6cf-4b71-b0db-6e69622d1b11", status: "active" });
  });
});
