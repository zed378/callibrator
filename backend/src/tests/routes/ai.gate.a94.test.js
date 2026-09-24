/**
 * A-94 — the AI routes had no permission gate (P6-04).
 *
 * `ai.route.js` mounted `auth` and nothing else, so every authenticated
 * principal — any role, any API key — could run certificate OCR on the
 * tenant's AI budget (`POST /ai/ocr`) and query the tenant's RAG knowledge base
 * (`POST /ai/query`), whatever their menu grants.
 *
 * Now:
 *   POST /ai/ocr    dynamicAccess("certificate", "write") — OCR is the intake
 *                   step of a certificate record; the roles that may create
 *                   certificates keep it. Gate BEFORE multer, so a refused
 *                   request never buffers the file.
 *   POST /ai/query  dynamicAccess("sop", "read") — the knowledge base holds
 *                   only SOP documents today (scripts/backfillEmbeddings.js is
 *                   the only ingester), so the answer can disclose only what
 *                   the SOP screen already shows the caller.
 *
 * The matrix here is the REAL seed read back through the REAL
 * getRolePermissionsMatrix and enforced by the REAL dynamicAccess
 * (fixtures/seededAuthorization.js). The expected role lists below are written
 * out by hand — they are the claim, not something derived from the code.
 */

const mockSeed = { current: null };
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
  const roles = {
    findOne: (...args) => mockSeed.current.Roles.findOne(...args),
    findByPk: (...args) => mockSeed.current.Roles.findByPk(...args),
  };
  return {
    Tenants: { findByPk: jest.fn() },
    User: { findByPk: jest.fn() },
    Users: { findByPk: jest.fn() },
    Role: roles,
    Roles: roles,
    MenuGroup: {
      findAll: (...args) => mockSeed.current.MenuGroup.findAll(...args),
      findOne: (...args) => mockSeed.current.MenuGroup.findOne(...args),
      create: (...args) => mockSeed.current.MenuGroup.create(...args),
    },
    RoleMenuPermission: {
      findAll: (...args) => mockSeed.current.RoleMenuPermission.findAll(...args),
      findOne: (...args) => mockSeed.current.RoleMenuPermission.findOne(...args),
      create: (...args) => mockSeed.current.RoleMenuPermission.create(...args),
      destroy: (...args) => mockSeed.current.RoleMenuPermission.destroy(...args),
    },
  };
});

// Pulled in by migration.service (the real seed); not exercised here.
jest.mock("../../services/featureFlag.service", () => ({}));
jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delPattern: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { permissions: (id) => `permissions:${id}` },
}));
jest.mock("../../services/ai.service", () => ({
  processCertificateOcr: jest.fn(async () => ({ certificateNumber: "C-1" })),
  queryDocuments: jest.fn(async () => "an answer"),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const { createSeededAuthorization } = require("../fixtures/seededAuthorization");
const { ROLE_NAMES, ROLE_IDS } = require("../../constants/roleConstants");
const aiService = require("../../services/ai.service");
const router = require("../../routes/api/ai.route");

const http = (url, { body = {}, file = null } = {}) =>
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
      method: "POST",
      url,
      originalUrl: "/api/v1/ai" + url,
      body,
      query: {},
      params: {},
      // No multipart content-type: multer passes the request through untouched,
      // so `file` (when given) stands in for what it would have attached.
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
      file,
    };
    router.handle(req, res, (err) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err ? err.message : "no route" },
      }),
    );
  });

// Hand-written claims (A-94). Every seeded role is in exactly one list.
const OCR_ALLOWED = [ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN];
const QUERY_ALLOWED = [
  ROLE_NAMES.HEALTCARE_ADMIN,
  ROLE_NAMES.CALIBRATOR_ADMIN,
  ROLE_NAMES.ENGINEERING_MANAGER,
];
// Every SEEDED role except the super admin (TENANT_ADMIN is a logical tier,
// not a seeded role).
const TENANT_ROLES = Object.keys(ROLE_IDS)
  .filter((key) => key !== "SUPER_ADMIN")
  .map((key) => ROLE_NAMES[key]);

let fx;

beforeEach(async () => {
  jest.clearAllMocks();
  fx = createTwoTenants();
  mockSeed.current = createSeededAuthorization();
  await mockSeed.current.seed();
  currentUser = null;
});

const seededPrincipal = (role) => {
  const p = fx.principal(fx.tenantA, role);
  p.role.id = mockSeed.current.roleId(p.role.name);
  return p;
};

const FILE = { buffer: Buffer.from("img"), mimetype: "image/png" };

describe("A-94 — POST /ai/ocr is gated on certificate write", () => {
  it.each(TENANT_ROLES)("%s", async (role) => {
    currentUser = seededPrincipal(role);

    const res = await http("/ocr", { file: FILE });

    if (OCR_ALLOWED.includes(role)) {
      expect(res.status).toBe(200);
      expect(aiService.processCertificateOcr).toHaveBeenCalledWith(
        fx.tenantA.id,
        FILE.buffer,
        "image/png",
      );
    } else {
      expect(res.status).toBe(403);
      expect(aiService.processCertificateOcr).not.toHaveBeenCalled();
    }
  });

  it("the super admin keeps it", async () => {
    currentUser = fx.superAdmin;

    const res = await http("/ocr", { file: FILE });

    expect(res.status).toBe(200);
  });

  it("an API key is authorized by its scopes: certificate:read is refused, certificate:write passes", async () => {
    // Before A-94 every key was refused here by the A-03 wrapper (no gate had
    // authorized it); now the gate decides, from the key's scopes.
    const key = (scopes) => ({
      ...fx.principal(fx.tenantA, ROLE_NAMES.USER),
      isApiKey: true,
      apiKeyScopes: scopes,
    });

    currentUser = key(["certificate:read"]);
    const refused = await http("/ocr", { file: FILE });
    currentUser = key(["certificate:write"]);
    const allowed = await http("/ocr", { file: FILE });

    expect(refused.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(aiService.processCertificateOcr).toHaveBeenCalledTimes(1);
  });

  it("the gate runs BEFORE multer: in the route's handler chain, dynamicAccess precedes the upload", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/ocr");
    const names = layer.route.stack.map((l) => l.name);
    expect(names.indexOf("multerMiddleware")).toBeGreaterThan(-1);
    expect(names.length).toBe(3);
    // [dynamicAccess's anonymous async middleware, multer, the controller]
    expect(names.indexOf("multerMiddleware")).toBe(1);
  });
});

describe("A-94 — POST /ai/query is gated on sop read", () => {
  it.each(TENANT_ROLES)("%s", async (role) => {
    currentUser = seededPrincipal(role);

    const res = await http("/query", { body: { question: "What is SOP-1?" } });

    if (QUERY_ALLOWED.includes(role)) {
      expect(res.status).toBe(200);
      expect(aiService.queryDocuments).toHaveBeenCalledWith(fx.tenantA.id, "What is SOP-1?");
    } else {
      expect(res.status).toBe(403);
      expect(aiService.queryDocuments).not.toHaveBeenCalled();
    }
  });

  it("the super admin keeps it", async () => {
    currentUser = fx.superAdmin;

    const res = await http("/query", { body: { question: "q" } });

    expect(res.status).toBe(200);
  });
});
