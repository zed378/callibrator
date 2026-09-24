/**
 * A-79 — tenant edit mishandled logo files.
 *
 *  1. A refused edit (404, 403, 409, or a failed audit insert) left the
 *     freshly uploaded logo on disk — `createTenant` cleaned up, `updateTenant`
 *     did not.
 *  2. The OLD logo was deleted BEFORE the commit, so a rolled-back edit
 *     (including a failed audit insert) lost the tenant's live logo.
 *  3. Found while fixing: `logo` was accepted from the BODY. A tenant admin
 *     could point their tenant at any filename in uploads/public/tenant — another
 *     tenant's logo — and the next logo upload then deleted that file as
 *     "the old logo". Only an uploaded file may set the logo now.
 *
 * Driven through the real chain (tenant.route -> dynamicAccess ->
 * tenant.controller -> tenant.service) over the two-tenant fixture; upload()
 * is stubbed to attach a file the way multer + upload.util do.
 */

const mockFx = { current: null };
// `fields` are multipart form fields: multer parses them in upload(), AFTER
// dynamicAccess has run, which is why checkTenant cannot see them (A-78).
const mockUpload = { filename: null, fields: null };
const mockEvents = [];
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

jest.mock("../../models", () => {
  const users = {
    findByPk: (...args) => mockFx.current.Users.findByPk(...args),
    count: async () => 0,
  };
  return {
    Tenants: {
      findByPk: (...args) => mockFx.current.Tenants.findByPk(...args),
      findOne: (...args) => mockFx.current.Tenants.findOne(...args),
    },
    User: users,
    Users: users,
    TenantSettings: {},
  };
});

// The fixture's transaction, with commit/rollback recorded in order.
jest.mock("../../config", () => ({
  db: {
    transaction: async () => {
      const tx = await mockFx.current.transaction();
      const commit = tx.commit.bind(tx);
      const rollback = tx.rollback.bind(tx);
      tx.commit = async () => {
        mockEvents.push("commit");
        return commit();
      };
      tx.rollback = async () => {
        mockEvents.push("rollback");
        return rollback();
      };
      return tx;
    },
  },
}));

jest.mock("../../services/roles.service", () => ({
  getRolePermissionsMatrix: jest.fn(),
}));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: () => (req, res, next) => next(),
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (req, res, next) => next(),
}));
jest.mock("../../utils/upload.util", () => ({
  // What multer + upload.util leave on the request for a stored file.
  upload: () => (req, res, next) => {
    if (mockUpload.fields) {
      req.body = { ...req.body, ...mockUpload.fields };
    }
    if (mockUpload.filename) {
      req.file = { filename: mockUpload.filename, path: `/uploads/public/tenant/${mockUpload.filename}` };
      req.uploadFilename = mockUpload.filename;
    }
    next();
  },
  deleteUpload: jest.fn(async (name) => {
    mockEvents.push(`unlink:${name}`);
  }),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: {
    tenant: (id) => `tenant:${id}`,
    tenantByCode: (code) => `tenant:code:${code}`,
  },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const RolesService = require("../../services/roles.service");
const auditService = require("../../services/audit.service");
const { deleteUpload } = require("../../utils/upload.util");
const { logger } = require("../../middlewares/activityLog.middleware");
const { ROLE_NAMES } = require("../../constants");
const router = require("../../routes/api/tenant.route");

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
      originalUrl: "/api/v1/tenants" + url,
      body,
      query: {},
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

const MATRIX = { Management: ["write"], management: ["write"] };
const NEW_LOGO = "new-logo-123.png";
const OLD_LOGO = "old-logo-a.png";

let fx;

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.length = 0;
  mockUpload.filename = null;
  mockUpload.fields = null;
  fx = createTwoTenants();
  mockFx.current = fx;
  fx.tenantA.logo = OLD_LOGO;
  fx.tenantB.logo = "logo-of-b.png";
  currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
  RolesService.getRolePermissionsMatrix.mockResolvedValue(MATRIX);
  auditService.logAction.mockImplementation(async () => {
    mockEvents.push("audit");
    return {};
  });
});

describe("A-79 — a refused edit removes the logo it uploaded", () => {
  it("404 (another tenant's id, multipart — past the gate): the uploaded file is deleted and tenant B is unchanged", async () => {
    mockUpload.filename = NEW_LOGO;
    mockUpload.fields = { tenantId: fx.tenantB.id, name: "Mine now" };
    const before = fx.snapshot(fx.tenantB);

    const res = await http("patch", "/edit", {});

    expect(res.status).toBe(404);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
    expect(deleteUpload).toHaveBeenCalledWith(NEW_LOGO, "uploads/public/tenant");
    expect(deleteUpload).not.toHaveBeenCalledWith("logo-of-b.png", expect.anything());
  });

  it("403 (a non-super-admin changing status): the uploaded file is deleted, the old logo kept", async () => {
    mockUpload.filename = NEW_LOGO;

    const res = await http("patch", "/edit", { tenantId: fx.tenantA.id, status: "SUSPENDED" });

    expect(res.status).toBe(403);
    expect(mockEvents).toEqual(["rollback", `unlink:${NEW_LOGO}`]);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
  });

  it("409 (a name another tenant holds): the uploaded file is deleted, the old logo kept", async () => {
    mockUpload.filename = NEW_LOGO;

    const res = await http("patch", "/edit", { tenantId: fx.tenantA.id, name: fx.tenantB.name });

    expect(res.status).toBe(409);
    expect(mockEvents).toEqual(["rollback", `unlink:${NEW_LOGO}`]);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
  });

  it("a failed audit insert: the edit rolls back, the NEW file is deleted and the OLD logo survives", async () => {
    mockUpload.filename = NEW_LOGO;
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    const res = await http("patch", "/edit", { tenantId: fx.tenantA.id, name: "Renamed" });

    expect(res.status).toBe(500);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
    expect(mockEvents).toEqual(["rollback", `unlink:${NEW_LOGO}`]);
    expect(deleteUpload).not.toHaveBeenCalledWith(OLD_LOGO, expect.anything());
  });

  it("a cleanup that itself fails is logged, and the caller still gets the original refusal", async () => {
    mockUpload.filename = NEW_LOGO;
    mockUpload.fields = { tenantId: fx.tenantB.id };
    deleteUpload.mockRejectedValueOnce(new Error("EACCES"));

    const res = await http("patch", "/edit", {});

    expect(res.status).toBe(404);
    expect(logger.warn).toHaveBeenCalledWith(
      `Failed to delete uploaded file after failure: ${NEW_LOGO}`,
      expect.any(Error),
    );
  });

  it("a refused edit with NO upload deletes nothing", async () => {
    const res = await http("patch", "/edit", { tenantId: fx.tenantB.id, name: "x" });

    expect(res.status).toBe(404);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});

describe("A-79 — the old logo is deleted only after the commit", () => {
  it("a successful logo change commits first, then deletes the old file", async () => {
    mockUpload.filename = NEW_LOGO;

    const res = await http("patch", "/edit", { tenantId: fx.tenantA.id, name: "Renamed" });

    expect(res.status).toBe(200);
    expect(fx.tenantA.logo).toBe(NEW_LOGO);
    expect(mockEvents).toEqual(["audit", "commit", `unlink:${OLD_LOGO}`]);
  });

  it("the default placeholder is never deleted", async () => {
    fx.tenantA.logo = "default.svg";
    mockUpload.filename = NEW_LOGO;

    const res = await http("patch", "/edit", { tenantId: fx.tenantA.id });

    expect(res.status).toBe(200);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});

describe("A-79 — the logo cannot be set from the body", () => {
  it("a body `logo` naming another tenant's file is ignored, and no file is deleted", async () => {
    const res = await http("patch", "/edit", {
      tenantId: fx.tenantA.id,
      logo: "logo-of-b.png",
    });

    expect(res.status).toBe(200);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});

describe("A-79 shape on delete — the tenant's logo file goes only after the commit", () => {
  it("a super admin's delete commits first, then removes the logo file", async () => {
    currentUser = fx.superAdmin;
    fx.tenantB.destroy = jest.fn(async () => {
      mockEvents.push("destroy");
    });

    const res = await http("delete", "/delete", { tenantId: fx.tenantB.id });

    expect(res.status).toBe(200);
    // A-95: the delete's audit row is written inside the transaction.
    expect(mockEvents).toEqual(["destroy", "audit", "commit", "unlink:logo-of-b.png"]);
  });

  it("a delete that fails before the commit keeps the logo file", async () => {
    currentUser = fx.superAdmin;
    fx.tenantB.destroy = jest.fn(async () => {
      throw new Error("FK violation");
    });

    const res = await http("delete", "/delete", { tenantId: fx.tenantB.id });

    expect(res.status).toBe(500);
    expect(mockEvents).toEqual(["rollback"]);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});

describe("A-78 — POST /tenants/:tenantId/logo takes the tenant from the path", () => {
  it("another tenant in the PATH is refused at the gate (404) before any file is written, whatever the multipart body says", async () => {
    mockUpload.filename = NEW_LOGO;
    mockUpload.fields = { tenantId: fx.tenantA.id };
    const before = fx.snapshot(fx.tenantB);

    const res = await new Promise((resolve) => {
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
      router.handle(
        {
          method: "POST",
          url: `/${fx.tenantB.id}/logo`,
          originalUrl: `/api/v1/tenants/${fx.tenantB.id}/logo`,
          body: {},
          query: {},
          headers: {},
          ip: "127.0.0.1",
          get: () => undefined,
        },
        response,
        (err) => resolve({ status: err ? 500 : 404, body: null }),
      );
    });

    expect(res.status).toBe(404);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});
