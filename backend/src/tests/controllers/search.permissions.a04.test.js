/**
 * A-04 — /search must not return rows the caller cannot list.
 *
 * These cases run the REAL controller, the REAL search service and the REAL
 * dynamicAccess gate against a simulated role-permission matrix. Only the
 * database (`db.query`) and the permission STORES (role matrix, per-user
 * overrides) are mocked, so what is asserted is the rows that reach the
 * response — not the shape of the implementation.
 *
 * The permission expectations are written out by hand per role, not derived
 * from the type->menu map the code uses: a test that read that map would pass
 * whatever the map said.
 */

jest.mock("../../config", () => ({ db: { query: jest.fn() } }));

jest.mock("../../models", () => ({
  User: { findByPk: jest.fn() },
  Tenants: { findByPk: jest.fn() },
  ApiKey: {},
  Tenant: {},
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));

const searchController = require("../../controllers/search.controller");
const { db } = require("../../config");
const RolesService = require("../../services/roles.service");
const userPermissionService = require("../../services/userPermission.service");

// Rows the database would return, one recognisable row per table.
const ROWS = {
  calibration_devices: [{ id: "dev-1", name: "Infusion pump", rank: 0.5 }],
  stocks: [{ id: "stk-1", itemName: "Thermocouple", rank: 0.4 }],
  certificates: [{ id: "cert-1", certificateNumber: "C-1", rank: 0.3 }],
};

const tableOf = (sql) =>
  Object.keys(ROWS).find((t) => sql.includes(`"${t}"`));

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

const runSearch = async (user, query = { q: "pump" }, reqExtra = {}) => {
  const req = { params: {}, body: {}, query, user, ...reqExtra };
  const res = makeRes();
  await searchController.search(req, res, jest.fn());
  return res;
};

// Which tables were actually hit, in call order.
const tablesQueried = () =>
  db.query.mock.calls.map(([sql]) => tableOf(sql)).filter(Boolean);

const typesInResponse = (res) =>
  [...new Set(res.body.data.results.map((r) => r.type))].sort();

const roleUser = (roleName = "TECHNICIAN") => ({
  id: "user-1",
  tenantId: "tenant-1",
  role: { id: "role-1", name: roleName },
});

beforeEach(() => {
  jest.clearAllMocks();
  RolesService.getRolePermissionsMatrix.mockResolvedValue({});
  userPermissionService.getUserOverrideMatrix.mockResolvedValue({});
  db.query.mockImplementation(async (sql) => ROWS[tableOf(sql)] || []);
});

describe("A-04 — search returns only the types the caller may read", () => {
  it("gives a warehouse-only role stock rows and no devices or certificates", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      warehouse: ["read"],
    });

    const res = await runSearch(roleUser("WAREHOUSE_STAFF"));

    expect(tablesQueried()).toEqual(["stocks"]);
    expect(typesInResponse(res)).toEqual(["stock"]);
    expect(res.body.data.results.map((r) => r.id)).toEqual(["stk-1"]);
    expect(res.body.data.byType.device).toBeUndefined();
    expect(res.body.data.byType.certificate).toBeUndefined();
  });

  it("gives a calibration-only role device rows and no stock or certificates", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      calibration: ["read"],
    });

    const res = await runSearch(roleUser());

    expect(tablesQueried()).toEqual(["calibration_devices"]);
    expect(typesInResponse(res)).toEqual(["device"]);
  });

  it("returns nothing and queries nothing for a role with none of the three menus", async () => {
    // home/dashboard only — the shape of a ROOM USER or basic USER role.
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      home: ["read"],
      dashboard: ["read"],
    });

    const res = await runSearch(roleUser("ROOM_USER"));

    expect(db.query).not.toHaveBeenCalled();
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.results).toEqual([]);
    // The empty allow-list must NOT be read as "search everything".
    expect(res.body.data.byType).toEqual({});
  });

  it("treats write on a menu as read for that type", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      certificate: ["write"],
    });

    const res = await runSearch(roleUser("SUPERVISOR"));

    expect(tablesQueried()).toEqual(["certificates"]);
    expect(typesInResponse(res)).toEqual(["certificate"]);
  });

  it("lets a super admin search every type without consulting the matrix", async () => {
    const res = await runSearch({
      id: "sa-1",
      tenantId: "tenant-1",
      role: { id: "role-sa", name: "SUPER_ADMIN" },
    });

    expect(tablesQueried().sort()).toEqual([
      "calibration_devices",
      "certificates",
      "stocks",
    ]);
    expect(typesInResponse(res)).toEqual(["certificate", "device", "stock"]);
    expect(RolesService.getRolePermissionsMatrix).not.toHaveBeenCalled();
  });

  it("intersects an explicit ?types= filter with the caller's permissions", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      warehouse: ["read"],
    });

    const res = await runSearch(roleUser(), {
      q: "pump",
      types: "device,stock",
    });

    // "device" was asked for and refused; "stock" was asked for and allowed.
    expect(tablesQueried()).toEqual(["stocks"]);
    expect(typesInResponse(res)).toEqual(["stock"]);
  });

  it("ignores a type name that is not a search type at all", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      warehouse: ["read"],
      calibration: ["read"],
    });

    const res = await runSearch(roleUser(), { q: "pump", types: "nope" });

    expect(db.query).not.toHaveBeenCalled();
    expect(res.body.data.total).toBe(0);
  });

  it("honours a per-user 'none' override that revokes a menu the role grants", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      warehouse: ["read"],
      calibration: ["read"],
    });
    userPermissionService.getUserOverrideMatrix.mockResolvedValue({
      warehouse: "none",
    });

    const res = await runSearch(roleUser());

    expect(tablesQueried()).toEqual(["calibration_devices"]);
    expect(typesInResponse(res)).toEqual(["device"]);
  });

  it("returns no rows when the permission store itself fails", async () => {
    // dynamicAccess hands a matrix lookup failure to next(err) (A-13); the
    // search probe must read that as a denial, never fall through to
    // "allowed". This case is the guard that caught the fail-open.
    RolesService.getRolePermissionsMatrix.mockRejectedValue(
      new Error("permission store down"),
    );

    const res = await runSearch(roleUser());

    expect(db.query).not.toHaveBeenCalled();
    expect(res.body.data.total).toBe(0);
  });

  it("denies every type when the request carries no role", async () => {
    const res = await runSearch({ id: "u", tenantId: "tenant-1" });

    expect(db.query).not.toHaveBeenCalled();
    expect(res.body.data.total).toBe(0);
  });
});

describe("A-04 — API-key principals are filtered by their scopes", () => {
  const apiKeyUser = (scopes) => ({
    id: "key-1",
    tenantId: "tenant-1",
    role: { id: "role-svc", name: "SERVICE" },
    isApiKey: true,
    apiKeyScopes: scopes,
  });

  // The route gate runs before the controller and, having read the key's
  // scopes, marks the request authorized (A-03). These cases start from that
  // point; the case below asserts what happens when it has not run.
  const gated = { apiKeyAuthorized: true };

  it("refuses a key outright when no gate has authorized the request", async () => {
    const res = await runSearch(apiKeyUser(["*"]), { q: "pump" });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("a warehouse:read key sees stock only", async () => {
    const res = await runSearch(apiKeyUser(["warehouse:read"]), { q: "pump" }, gated);

    expect(tablesQueried()).toEqual(["stocks"]);
    expect(typesInResponse(res)).toEqual(["stock"]);
  });

  it("a wildcard key sees every type", async () => {
    const res = await runSearch(apiKeyUser(["*"]), { q: "pump" }, gated);

    expect(typesInResponse(res)).toEqual(["certificate", "device", "stock"]);
    expect(tablesQueried().sort()).toEqual([
      "calibration_devices",
      "certificates",
      "stocks",
    ]);
  });

  it("a key scoped to an unrelated resource sees nothing", async () => {
    const res = await runSearch(apiKeyUser(["finance:read"]), { q: "pump" }, gated);

    expect(db.query).not.toHaveBeenCalled();
    expect(res.body.data.total).toBe(0);
  });

  it("does not consult the role matrix for an API key", async () => {
    RolesService.getRolePermissionsMatrix.mockResolvedValue({
      warehouse: ["read"],
      calibration: ["read"],
      certificate: ["read"],
    });

    const res = await runSearch(apiKeyUser(["certificate:write"]), { q: "pump" }, gated);

    // Scopes decide, not the role the key happens to carry.
    expect(RolesService.getRolePermissionsMatrix).not.toHaveBeenCalled();
    expect(typesInResponse(res)).toEqual(["certificate"]);
  });
});
