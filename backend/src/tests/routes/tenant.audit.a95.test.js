/**
 * A-95 / A-96 — tenant mutations that wrote no audit row.
 *
 * A-95: `createTenant` and `deleteTenant` wrote no audit row, and
 *       `deleteTenant` took its actor (`deletedBy`) from the body or query.
 * A-96: `POST /tenants/:tenantId/logo` and `DELETE /tenants/:tenantId/logo`
 *       wrote no audit row, deleted the OLD file BEFORE the update, and left a
 *       refused upload on disk.
 *
 * CLAUDE.md: "Every mutation writes an audit row, inside the transaction." The
 * row for a platform operation on a tenant (create, delete) is recorded under
 * the reserved PLATFORM tenant (A-125, ADR-051 Q-14, F-7) — it was the ACTOR's
 * home tenant (BR-A41-4), a hospital whose admins could read it; a logo change
 * is recorded under the tenant changed.
 *
 * Real chain: tenant.route -> gate -> tenant.controller -> tenant.service /
 * tenantUpload.service, over the two-tenant fixture. Stubbed: `auth`, the
 * permission matrix, the rate limiter, the quota, `upload()` (attaches a file
 * as multer would), redis and the audit insert (recorded in event order).
 */

const mockFx = { current: null };
const mockUpload = { filename: null };
const mockEvents = [];
let currentUser = null;

const NEW_TENANT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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
      create: jest.fn(async (values) => {
        mockEvents.push("create");
        return { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ...values };
      }),
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
      mockFx.current.lastTx = tx;
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
  upload: () => (req, res, next) => {
    if (mockUpload.filename) {
      req.file = { filename: mockUpload.filename };
      req.uploadFilename = mockUpload.filename;
    }
    next();
  },
  deleteUpload: jest.fn(async (name) => {
    mockEvents.push(`unlink:${name}`);
  }),
  getUploadUrl: jest.fn(),
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
const { Tenants } = require("../../models");
const { ROLE_NAMES } = require("../../constants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const router = require("../../routes/api/tenant.route");

const http = (method, url, { body = {}, query = {} } = {}) =>
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
    const search = new URLSearchParams(query).toString();
    const req = {
      method: method.toUpperCase(),
      url: search ? `${url}?${search}` : url,
      originalUrl: "/api/v1/tenants" + url,
      body,
      query,
      params: {},
      headers: { "user-agent": "jest-a95" },
      ip: "127.0.0.9",
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
const OLD_LOGO = "old-logo-a.png";
const NEW_LOGO = "new-logo-a.png";
const FORGED_ACTOR = "99999999-9999-4999-8999-999999999999";

let fx;

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.length = 0;
  mockUpload.filename = null;
  fx = createTwoTenants();
  mockFx.current = fx;
  fx.tenantA.logo = OLD_LOGO;
  fx.tenantB.logo = "logo-of-b.png";
  fx.tenantB.destroy = jest.fn(async () => {
    mockEvents.push("destroy");
  });
  currentUser = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);
  RolesService.getRolePermissionsMatrix.mockResolvedValue(MATRIX);
  auditService.logAction.mockImplementation(async () => {
    mockEvents.push("audit");
    return {};
  });
});

const auditCall = () => {
  expect(auditService.logAction).toHaveBeenCalledTimes(1);
  return auditService.logAction.mock.calls[0];
};

describe("A-95 — POST /tenants/create is audited inside its transaction", () => {
  it("a tenant creation is audited under the PLATFORM tenant, not the super admin's home tenant", async () => {
    currentUser = fx.superAdmin;

    const res = await http("post", "/create", {
      body: { name: "New Hospital", code: "NEW-H", createdBy: FORGED_ACTOR },
    });

    expect(res.status).toBe(201);
    const [entry, options] = auditCall();
    expect(entry).toMatchObject({
      tenantId: PLATFORM_TENANT_ID,
      userId: fx.superAdmin.id,
      action: "CREATE",
      resourceType: "Tenant",
      resourceId: NEW_TENANT_ID,
      ipAddress: "127.0.0.9",
      userAgent: "jest-a95",
    });
    expect(entry.tenantId).not.toBe(fx.superAdmin.tenantId);
    expect(entry.changes).toMatchObject({ after: { name: "New Hospital", code: "NEW-H" } });
    expect(options).toEqual({ transaction: fx.lastTx });
    expect(mockEvents).toEqual(["create", "audit", "commit"]);
    // The body cannot name the creator.
    expect(Tenants.create.mock.calls[0][0].createdBy).toBe(fx.superAdmin.id);
  });

  it("a failed audit insert rolls the create back (500) and removes the uploaded logo", async () => {
    currentUser = fx.superAdmin;
    mockUpload.filename = "created-logo.png";
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    const res = await http("post", "/create", { body: { name: "New Hospital", code: "NEW-H" } });

    expect(res.status).toBe(500);
    expect(mockEvents).toEqual(["create", "rollback", "unlink:created-logo.png"]);
  });
});

describe("A-95 — DELETE /tenants/delete: audited, and the actor is the caller", () => {
  it("a deletedBy in the body or query is ignored; the row names req.user", async () => {
    currentUser = fx.superAdmin;

    const res = await http("delete", "/delete", {
      body: { deletedBy: FORGED_ACTOR },
      query: { tenantId: fx.tenantB.id, deletedBy: FORGED_ACTOR },
    });

    expect(res.status).toBe(200);
    const [entry, options] = auditCall();
    expect(entry).toMatchObject({
      // A-125: under PLATFORM — not the actor's home tenant, not the deleted one.
      tenantId: PLATFORM_TENANT_ID,
      userId: fx.superAdmin.id,
      action: "DELETE",
      resourceType: "Tenant",
      resourceId: fx.tenantB.id,
      ipAddress: "127.0.0.9",
    });
    expect(entry.changes).toMatchObject({
      before: { name: fx.tenantB.name, code: fx.tenantB.code },
    });
    expect(JSON.stringify(entry)).not.toContain(FORGED_ACTOR);
    expect(options).toEqual({ transaction: fx.lastTx });
    expect(mockEvents).toEqual(["destroy", "audit", "commit", "unlink:logo-of-b.png"]);
  });

  it("a failed audit insert rolls the delete back and keeps the logo file", async () => {
    currentUser = fx.superAdmin;
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    const res = await http("delete", "/delete", { query: { tenantId: fx.tenantB.id } });

    expect(res.status).toBe(500);
    expect(mockEvents).toEqual(["destroy", "rollback"]);
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});

describe("A-96 — POST /tenants/:tenantId/logo", () => {
  it("updates, audits in the transaction, commits, THEN deletes the old file", async () => {
    mockUpload.filename = NEW_LOGO;

    const res = await http("post", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(200);
    expect(fx.tenantA.logo).toBe(NEW_LOGO);
    const [entry, options] = auditCall();
    expect(entry).toMatchObject({
      tenantId: fx.tenantA.id,
      userId: currentUser.id,
      action: "UPDATE",
      resourceType: "Tenant",
      resourceId: fx.tenantA.id,
      changes: { operation: "UPDATE_LOGO", logo: { before: OLD_LOGO, after: NEW_LOGO } },
    });
    expect(options).toEqual({ transaction: fx.lastTx });
    expect(mockEvents).toEqual(["audit", "commit", `unlink:${OLD_LOGO}`]);
  });

  it("a failed audit insert: rolled back, the OLD logo survives, the NEW upload is deleted", async () => {
    mockUpload.filename = NEW_LOGO;
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    const res = await http("post", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(500);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
    expect(mockEvents).toEqual(["rollback", `unlink:${NEW_LOGO}`]);
  });

  it("a refusal past the gate (a super admin naming no tenant) deletes the upload: 404", async () => {
    currentUser = fx.superAdmin;
    mockUpload.filename = NEW_LOGO;

    const res = await http("post", "/ffffffff-ffff-4fff-8fff-ffffffffffff/logo");

    expect(res.status).toBe(404);
    expect(mockEvents).toEqual(["rollback", `unlink:${NEW_LOGO}`]);
  });

  it("another tenant in the path is refused at the gate (404) and nothing is written or deleted", async () => {
    mockUpload.filename = NEW_LOGO;
    const before = fx.snapshot(fx.tenantB);

    const res = await http("post", `/${fx.tenantB.id}/logo`);

    expect(res.status).toBe(404);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("no file: 400, nothing written", async () => {
    const res = await http("post", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(400);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
  });
});

describe("A-96 — DELETE /tenants/:tenantId/logo", () => {
  it("clears the logo, audits in the transaction, commits, THEN deletes the file", async () => {
    const res = await http("delete", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(200);
    expect(fx.tenantA.logo).toBeNull();
    const [entry, options] = auditCall();
    expect(entry).toMatchObject({
      tenantId: fx.tenantA.id,
      userId: currentUser.id,
      action: "UPDATE",
      resourceType: "Tenant",
      resourceId: fx.tenantA.id,
      changes: { operation: "REMOVE_LOGO", logo: { before: OLD_LOGO, after: null } },
    });
    expect(options).toEqual({ transaction: fx.lastTx });
    expect(mockEvents).toEqual(["audit", "commit", `unlink:${OLD_LOGO}`]);
  });

  it("a failed audit insert: rolled back, the logo and its file survive", async () => {
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    const res = await http("delete", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(500);
    expect(fx.tenantA.logo).toBe(OLD_LOGO);
    expect(mockEvents).toEqual(["rollback"]);
  });

  it("no logo of its own: nothing changes, nothing is audited, nothing is deleted", async () => {
    fx.tenantA.logo = "default.svg";

    const res = await http("delete", `/${fx.tenantA.id}/logo`);

    expect(res.status).toBe(200);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(fx.tenantA.logo).toBe("default.svg");
  });

  it("another tenant in the path is 404 at the gate; tenant B is unchanged", async () => {
    const before = fx.snapshot(fx.tenantB);

    const res = await http("delete", `/${fx.tenantB.id}/logo`);

    expect(res.status).toBe(404);
    expect(fx.snapshot(fx.tenantB)).toEqual(before);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });
});
