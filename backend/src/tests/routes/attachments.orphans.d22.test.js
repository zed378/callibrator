/**
 * D-22 (ADR-070) — GET /api/v1/attachments/orphans, the orphan report.
 *
 * Gated twice: a tenant administrator (rbac TENANT_ADMIN, i.e. role level 8 or
 * above) who also holds `equipment: read` — the grant every attachment read
 * needs. It reads only the caller's tenant (the service's SQL is tenant-bound;
 * attachment.cascade.d22.test.js and dataLayer.dbC.live.test.js prove it), and
 * answers in the envelope: rows in `data`, pagination in a top-level `meta`.
 *
 * The real dynamicAccess runs over the seeded matrix (roleConstants); only
 * `auth` and the service are stubbed. It has no `:id`, so no two-tenant 404
 * case applies; the two-tenant property is the live test's.
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

jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models", () => ({ Tenants: { findByPk: jest.fn() } }));
jest.mock("../../services/attachment.service", () => ({
  listOrphans: jest.fn(),
  getAttachment: jest.fn(),
}));
jest.mock("../../utils/upload.util", () => ({
  upload: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (req, res, next) => next(),
}));

const RolesService = require("../../services/roles.service");
const attachmentService = require("../../services/attachment.service");
const { ROLE_NAMES, ROLE_LEVELS, ROLE_MENU_ASSIGNMENTS } = require("../../constants");
const router = require("../../routes/api/attachments.route");

const TENANT = "33333333-3333-4333-8333-333333333333";

const call = (url) =>
  new Promise((resolve) => {
    const [pathname, search = ""] = url.split("?");
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
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
        resolve({ status: this.statusCode, body: null });
        return this;
      },
    };
    const req = {
      method: "GET",
      url,
      originalUrl: `/api/v1/attachments${url}`,
      path: pathname,
      body: {},
      query: Object.fromEntries(new URLSearchParams(search)),
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({ status: err ? err.status || err.statusCode || 500 : 404, body: { message: err && err.message } }),
    );
  });

const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  return Object.fromEntries(Object.entries(entry.menus).map(([slug, p]) => [slug, [p]]));
};

const levelKey = (roleName) => Object.entries(ROLE_NAMES).find(([, name]) => name === roleName)[0];

const as = (roleName) => {
  currentUser = {
    id: "u-1",
    tenantId: TENANT,
    role: { id: roleName, name: roleName, role_level: ROLE_LEVELS[levelKey(roleName)] },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => matrixFor(roleId));
  attachmentService.listOrphans.mockResolvedValue({
    rows: [{ id: "a-1", reason: "parent_missing_or_deleted" }],
    meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
  });
});

describe("D-22 — GET /attachments/orphans", () => {
  it.each([ROLE_NAMES.TECHNICIAN, ROLE_NAMES.SUPERVISOR, ROLE_NAMES.ENGINEERING_MANAGER])(
    "refuses %s (below tenant administrator) with 403 and never reads",
    async (role) => {
      as(role);
      const res = await call("/orphans");
      expect(res.status).toBe(403);
      expect(attachmentService.listOrphans).not.toHaveBeenCalled();
    },
  );

  it.each([ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN])(
    "answers %s with the caller's tenant's orphans — rows in data, meta top-level",
    async (role) => {
      as(role);
      const res = await call("/orphans?page=1&limit=25");
      expect(res.status).toBe(200);
      expect(attachmentService.listOrphans).toHaveBeenCalledWith(TENANT, { page: "1", limit: "25" });
      expect(res.body.data).toEqual([{ id: "a-1", reason: "parent_missing_or_deleted" }]);
      expect(res.body.meta).toEqual({ total: 1, page: 1, limit: 25, totalPages: 1 });
      expect(res.body.data.rows).toBeUndefined();
    },
  );

  it("is not captured by GET /:id — 'orphans' is never read as an attachment id", async () => {
    as(ROLE_NAMES.HEALTCARE_ADMIN);
    await call("/orphans");
    expect(attachmentService.getAttachment).not.toHaveBeenCalled();
  });
});
