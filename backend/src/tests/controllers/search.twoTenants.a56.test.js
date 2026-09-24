/**
 * /search across two tenants (CLAUDE.md "two-tenant test"), and A-56 at the
 * controller boundary.
 *
 * Search is raw SQL (`sequelize.query`), so the global tenant hooks do not
 * apply to it: the tenant predicate in search.service.js is the ONLY thing
 * keeping tenant B's rows out of tenant A's results. These cases run the REAL
 * controller, the REAL search service and the REAL dynamicAccess gate, with
 * principals from the shared createTwoTenants() fixture.
 *
 * The database double holds rows for BOTH tenants in every searched table and
 * answers the way PostgreSQL would: a statement carrying
 * `tenant_id = :tenantId` gets the rows of the tenant bound to :tenantId; a
 * statement WITHOUT that predicate gets every tenant's rows. So deleting the
 * predicate from either the FTS or the ILIKE statement, or binding it to
 * something other than the caller's tenant, turns these cases red. It models
 * the predicate, not the SQL engine: that the statements execute as written
 * against PostgreSQL 18 is the live check recorded on the A-56 card.
 */

jest.mock("../../config", () => ({ db: { query: jest.fn() } }));

jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
  ApiKey: {},
  Tenant: {},
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));

jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(),
}));

const searchController = require("../../controllers/search.controller");
const { db } = require("../../config");
const RolesService = require("../../services/roles.service");
const userPermissionService = require("../../services/userPermission.service");
const { GENERIC_ERROR_MESSAGE } = require("../../utils/fileValidation.util");
const {
  createTwoTenants,
  TENANT_A_ID,
  TENANT_B_ID,
} = require("../fixtures/twoTenants");

// Every row matches the search term "pump" in both tenants, so only the
// tenant predicate can tell them apart.
const TABLES = {
  calibration_devices: [
    { tenant_id: TENANT_A_ID, id: "dev-A", name: "Infusion pump A", rank: 0.5 },
    { tenant_id: TENANT_B_ID, id: "dev-B", name: "Infusion pump B", rank: 0.9 },
  ],
  stocks: [
    { tenant_id: TENANT_A_ID, id: "stk-A", itemName: "Pump seal A", rank: 0.4 },
    { tenant_id: TENANT_B_ID, id: "stk-B", itemName: "Pump seal B", rank: 0.8 },
  ],
  certificates: [
    { tenant_id: TENANT_A_ID, id: "cert-A", certificateNumber: "PUMP-A", rank: 0.3 },
    { tenant_id: TENANT_B_ID, id: "cert-B", certificateNumber: "PUMP-B", rank: 0.7 },
  ],
};

const tableOf = (sql) => Object.keys(TABLES).find((t) => sql.includes(`"${t}"`));

// PostgreSQL's answer to the statement: filtered by tenant only when the
// statement says so. `failFts` makes the FTS statement throw (no
// search_vector column), exercising the ILIKE path.
const pgLike = ({ failFts = false } = {}) =>
  async (sql, { replacements }) => {
    if (failFts && sql.includes("search_vector")) {
      throw new Error('column "search_vector" does not exist');
    }
    let rows = TABLES[tableOf(sql)] || [];
    if (/\btenant_id = :tenantId\b/.test(sql)) {
      rows = rows.filter((r) => r.tenant_id === replacements.tenantId);
    }
    // The SELECT lists never include tenant_id.
    return rows.map(({ tenant_id: _omit, ...r }) => r);
  };

const makeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
};

const runSearch = async (user, query = { q: "pump" }) => {
  const req = { params: {}, body: {}, query, user, requestId: "req-search-1" };
  const res = makeRes();
  const next = jest.fn();
  await searchController.search(req, res, next);
  return { res, next };
};

const ids = (res) => res.body.data.results.map((r) => r.id).sort();

let fx;

beforeEach(() => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  // The role may read all three searched menus.
  RolesService.getRolePermissionsMatrix.mockResolvedValue({
    calibration: ["read"],
    warehouse: ["read"],
    certificate: ["read"],
  });
  userPermissionService.getUserOverrideMatrix.mockResolvedValue({});
  db.query.mockImplementation(pgLike());
});

describe("search — two tenants", () => {
  it("returns only tenant A's rows to a tenant-A principal, on every type", async () => {
    const { res } = await runSearch(fx.principal(fx.tenantA, "TECHNICIAN"));

    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(["cert-A", "dev-A", "stk-A"]);
    // Every statement was bound to the caller's tenant.
    expect(db.query).toHaveBeenCalledTimes(3);
    for (const [, opts] of db.query.mock.calls) {
      expect(opts.replacements.tenantId).toBe(TENANT_A_ID);
    }
  });

  it("returns only tenant B's rows to a tenant-B principal", async () => {
    const { res } = await runSearch(fx.principal(fx.tenantB, "TECHNICIAN"));

    expect(ids(res)).toEqual(["cert-B", "dev-B", "stk-B"]);
  });

  it("keeps tenant B out on the ILIKE fallback path too", async () => {
    db.query.mockImplementation(pgLike({ failFts: true }));

    const { res } = await runSearch(fx.principal(fx.tenantA, "TECHNICIAN"));

    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(["cert-A", "dev-A", "stk-A"]);
    // FTS then ILIKE for each of the three types.
    expect(db.query).toHaveBeenCalledTimes(6);
  });

  it("ignores a tenantId supplied in the query string", async () => {
    const { res } = await runSearch(fx.principal(fx.tenantA, "TECHNICIAN"), {
      q: "pump",
      tenantId: TENANT_B_ID,
    });

    expect(ids(res)).toEqual(["cert-A", "dev-A", "stk-A"]);
  });

  it("scopes a super admin to its home tenant, not every tenant", async () => {
    const { res } = await runSearch(fx.superAdmin);

    expect(ids(res)).toEqual(["cert-A", "dev-A", "stk-A"]);
  });
});

describe("A-56 — a failing type surfaces as an error, never as 'no results'", () => {
  const failCertificates = async (sql, opts) => {
    if (sql.includes('"certificates"')) {
      throw new Error("permission denied for table certificates");
    }
    return pgLike()(sql, opts);
  };

  const withEnv = async (value, fn) => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      return await fn();
    } finally {
      process.env.NODE_ENV = prior;
    }
  };

  it("answers 500 with success:false when a type fails on both FTS and ILIKE", async () => {
    db.query.mockImplementation(failCertificates);

    const { res, next } = await withEnv("test", () =>
      runSearch(fx.principal(fx.tenantA, "TECHNICIAN")));

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toBe("Search failed for certificate");
    // Forwarded so the global handler logs it against the request id.
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }));
  });

  it("in production shows the generic message and the request id, never the SQL error", async () => {
    db.query.mockImplementation(failCertificates);

    const { res } = await withEnv("production", () =>
      runSearch(fx.principal(fx.tenantA, "TECHNICIAN")));

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe(GENERIC_ERROR_MESSAGE);
    expect(res.body.requestId).toBe("req-search-1");
    expect(JSON.stringify(res.body)).not.toMatch(/permission denied/);
  });
});
