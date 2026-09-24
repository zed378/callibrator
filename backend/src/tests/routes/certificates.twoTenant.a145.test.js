/**
 * A-145 — certificate edit and delete, two tenants.
 *
 * CLAUDE.md: every `:id` route needs a two-tenant test asserting 404. PUT and
 * DELETE /certificates/:certificateId had only single-tenant "not found" unit
 * tests with a findOne mocked to null — which cannot tell a service that
 * scopes by tenant from one that does not. A-145 also puts both behind
 * denyPlatformAuthoring (the decision is recorded in
 * denyPlatformAuthoring.a127.test.js); this file proves the tenant behaviour
 * and that an operator's refused edit writes nothing.
 *
 * Through the REAL router, validateUuid, denyPlatformAuthoring, controller and
 * certificate service. Stubbed: `auth`, `dynamicAccess`, the PDF controller,
 * the credential services the module loads, and the model layer (the
 * auditLedger fixture, CLS off). `Certificate.findOne` matches `where` exactly
 * and does not scope by itself.
 */

const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, rows: [], user: null, tenantId: null, impersonatorId: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockRef.user;
      req.tenantId = mockRef.tenantId;
      req.impersonatorId = mockRef.impersonatorId;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (req, res, next) => next(),
}));
jest.mock("../../controllers/certificatePdf.controller", () => ({
  verifyCertificate: jest.fn(),
  verifyDocument: jest.fn(),
  generatePdf: jest.fn(),
  downloadPdf: jest.fn(),
  getQrCode: jest.fn(),
}));
jest.mock("../../services/auth.service", () => ({ passIsValid: jest.fn() }));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockRef.rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      if (!row) {return null;}
      const cert = { ...row };
      cert.update = async (values, options) => {
        Object.assign(cert, values);
        return mockRef.ledger.write("certificates", { id: cert.id, ...values }, options);
      };
      cert.destroy = async (options) =>
        mockRef.ledger.write("certificates", { id: cert.id, deleted: true }, options);
      return cert;
    }),
    STATUS: {
      DRAFT: "draft",
      PENDING_APPROVAL: "pending_approval",
      APPROVED: "approved",
      SIGNED: "signed",
      REVOKED: "revoked",
    },
  },
  CalibrationDevice: {},
  CalibrationRecord: {},
  Tenant: {},
  User: { findByPk: jest.fn() },
  ESignatureRecord: {},
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { logger } = require("../../middlewares/activityLog.middleware");
const { MESSAGES } = require("../../middlewares/denyPlatformAuthoring.middleware");
const router = require("../../routes/api/certificates.route");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "a0000001-0000-4000-8000-000000000001";
const USER_B = "b0000001-0000-4000-8000-000000000001";
const OPERATOR = "99999999-9999-4999-8999-999999999999";
const CERT_A = "a0000006-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const as = (id, tenantId, { roleName = "CALIBRATOR ADMIN", effectiveTenant = tenantId, impersonatorId = null } = {}) => {
  mockRef.user = { id, tenantId, role: { name: roleName }, isApiKey: false };
  mockRef.tenantId = effectiveTenant;
  mockRef.impersonatorId = impersonatorId;
};

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
      method,
      url,
      originalUrl: "/api/v1/certificates" + url,
      body,
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    tenantStorage.run(
      {
        tenantId: mockRef.tenantId,
        isSuperAdmin: mockRef.user.role.name === "SUPERADMIN",
        isSystemTask: false,
      },
      () =>
        router.handle(req, res, (err) =>
          resolve({
            status: err ? err.status || err.statusCode || 500 : 404,
            body: { message: err ? err.message : "no route" },
          }),
        ),
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
  mockRef.ledger = createLedger({ cls: false });
  mockRef.rows = [
    { id: CERT_A, tenantId: TENANT_A, certificateNumber: "CERT-A-0001", status: "draft", notes: null },
  ];
});

describe.each([
  ["PUT", { notes: "edited" }],
  ["DELETE", {}],
])("A-145 — %s /certificates/:certificateId across tenants", (method, body) => {
  it("another tenant's certificate answers 404, the same as one that does not exist, and nothing is written", async () => {
    as(USER_B, TENANT_B);
    const foreign = await http(method, `/${CERT_A}`, body);
    const missing = await http(method, `/${MISSING}`, body);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a member of the owning tenant reaches it, and the change is audited in its transaction", async () => {
    as(USER_A, TENANT_A);
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(200);
    expect(mockRef.ledger.committed("certificates")).toHaveLength(1);
    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, userId: USER_A, resourceId: CERT_A }),
    ]);
  });

  it("a super admin in their home tenant is a member there (ADR-052): another tenant's certificate is 404", async () => {
    as(OPERATOR, TENANT_B, { roleName: "SUPERADMIN" });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(404);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("a super admin overriding into the owning tenant is refused, and nothing is written", async () => {
    as(OPERATOR, TENANT_B, { roleName: "SUPERADMIN", effectiveTenant: TENANT_A });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.OTHER_TENANT);
    expect(mockRef.ledger.rows).toEqual([]);
  });

  it("while impersonating a member of the owning tenant, it is refused and nothing is written", async () => {
    as(USER_A, TENANT_A, { impersonatorId: OPERATOR });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(mockRef.ledger.rows).toEqual([]);
  });
});
