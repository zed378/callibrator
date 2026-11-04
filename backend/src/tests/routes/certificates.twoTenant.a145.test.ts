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
import type { Request, Response, NextFunction } from "express";
import { createLedger } from "../fixtures/auditLedger";

interface MockCertRow {
  id: string;
  tenantId: string;
  certificateNumber: string;
  status: string;
  notes: string | null;
  [key: string]: unknown;
}

interface MockRefHolder {
  ledger: ReturnType<typeof createLedger> | null;
  rows: MockCertRow[];
  user: { id: string; tenantId: string; role: { name: string }; isApiKey: boolean } | null;
  tenantId: string | null;
  impersonatorId: string | null;
}

const mockRef: MockRefHolder = { ledger: null, rows: [], user: null, tenantId: null, impersonatorId: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      const r = req as unknown as { user?: unknown; tenantId?: unknown; impersonatorId?: unknown };
      r.user = mockRef.user;
      r.tenantId = mockRef.tenantId;
      r.impersonatorId = mockRef.impersonatorId;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock("../../controllers/certificatePdf.controller", () => ({
  verifyCertificate: jest.fn(),
  verifyDocument: jest.fn(),
  getDocument: jest.fn(),
  downloadPdf: jest.fn(),
  getQrCode: jest.fn(),
}));
jest.mock("../../services/auth.service", () => ({ passIsValid: jest.fn() }));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = mockRef.rows.find((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      if (!row) { return null; }
      const cert: Record<string, unknown> = { ...row };
      cert["update"] = async (values: Record<string, unknown>, options: unknown) => {
        Object.assign(cert, values);
        return mockRef.ledger!.write("certificates", { id: cert["id"], ...values }, options);
      };
      cert["destroy"] = async (options: unknown) =>
        mockRef.ledger!.write("certificates", { id: cert["id"], deleted: true }, options);
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
  // D-22 (ADR-070): the delete soft-deletes the certificate's attachments in
  // its transaction; this certificate has none.
  Attachment: { findAll: jest.fn(async () => []), update: jest.fn() },
  Tenant: {},
  User: { findByPk: jest.fn() },
  ESignatureRecord: {},
  AuditLog: { create: (...args: any[]) => (mockRef.ledger as any)?.AuditLog?.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: any[]) => (mockRef.ledger as any)?.transaction(...args) },
}));

import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import { logger } from "../../middlewares/activityLog.middleware";
import { MESSAGES } from "../../middlewares/denyPlatformAuthoring.middleware";

const router = require("../../routes/api/certificates.route") as { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "a0000001-0000-4000-8000-000000000001";
const USER_B = "b0000001-0000-4000-8000-000000000001";
const OPERATOR = "99999999-9999-4999-8999-999999999999";
const CERT_A = "a0000006-0000-4000-8000-000000000001";
const MISSING = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const as = (id: string, tenantId: string, { roleName = "CALIBRATOR ADMIN", effectiveTenant = tenantId, impersonatorId = null }: { roleName?: string; effectiveTenant?: string; impersonatorId?: string | null } = {}) => {
  mockRef.user = { id, tenantId, role: { name: roleName }, isApiKey: false };
  mockRef.tenantId = effectiveTenant;
  mockRef.impersonatorId = impersonatorId;
};

interface HttpResponse {
  status: number;
  body: {
    message?: string;
    [key: string]: unknown;
  };
}

const http = (method: string, url: string, body: Record<string, unknown> = {}): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: HttpResponse["body"]) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: HttpResponse["body"]) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: null as unknown as Record<string, unknown> });
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
        tenantId: mockRef.tenantId as never,
        isSuperAdmin: mockRef.user?.role.name === "SUPERADMIN",
        isSystemTask: false,
      },
      () =>
        (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; statusCode?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; statusCode?: number; message?: string }) =>
          resolve({
            status: err ? err.status || err.statusCode || 500 : 404,
            body: { message: err?.message ?? "no route" },
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
    expect(mockRef.ledger!.rows).toEqual([]);
  });

  it("a member of the owning tenant reaches it, and the change is audited in its transaction", async () => {
    as(USER_A, TENANT_A);
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(200);
    expect(mockRef.ledger!.committed("certificates")).toHaveLength(1);
    expect(mockRef.ledger!.auditRows()).toEqual([
      expect.objectContaining({ tenantId: TENANT_A, userId: USER_A, resourceId: CERT_A }),
    ]);
  });

  it("a super admin in their home tenant is a member there (ADR-052): another tenant's certificate is 404", async () => {
    as(OPERATOR, TENANT_B, { roleName: "SUPERADMIN" });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(404);
    expect(mockRef.ledger!.rows).toEqual([]);
  });

  it("a super admin overriding into the owning tenant is refused, and nothing is written", async () => {
    as(OPERATOR, TENANT_B, { roleName: "SUPERADMIN", effectiveTenant: TENANT_A });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.OTHER_TENANT);
    expect(mockRef.ledger!.rows).toEqual([]);
  });

  it("while impersonating a member of the owning tenant, it is refused and nothing is written", async () => {
    as(USER_A, TENANT_A, { impersonatorId: OPERATOR });
    const res = await http(method, `/${CERT_A}`, body);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(MESSAGES.IMPERSONATING);
    expect(mockRef.ledger!.rows).toEqual([]);
  });
});
