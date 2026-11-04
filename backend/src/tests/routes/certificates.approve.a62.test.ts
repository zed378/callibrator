/**
 * A-62 — the approver of a certificate was whoever the request body said.
 *
 * `certificate.controller#approveCertificate` passed `req.body.approvedBy` to
 * the service, which re-authenticated THAT user and stamped THAT id on the
 * certificate, the e-signature record and the audit row. A caller who knew
 * another approver's password could approve in that person's name.
 *
 * These drive the REAL route (routes/api/certificates.route.js): the real
 * validation middleware with the real approveCertificateSchema, the real
 * controller, and the real certificate service. Stubbed:
 *  - `auth` — sets the principal (identity is what is under test here, so the
 *    principal is fixed by the test, not by a token);
 *  - `dynamicAccess` — the permission gate is not what is under test;
 *  - the models and `db`, backed by the auditLedger fixture, which enforces
 *    the real audit_logs ENUM / NOT NULL columns and commits only what a real
 *    transaction would;
 *  - `authService.passIsValid` — a credential store holding a DIFFERENT
 *    password for each user, so "whose password was checked" is observable.
 */
import type { Request, Response, NextFunction } from "express";
import { createLedger } from "../fixtures/auditLedger";

const CALLER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CERT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PASSWORDS: Record<string, string> = { [CALLER]: "caller-password", [OTHER]: "other-password" };

interface MockCertificate {
  id: string;
  certificateNumber: string;
  deviceId: string;
  calibrationRecordId: string;
  status: string;
  approvedBy: string | null;
  save?: (options?: unknown) => Promise<unknown>;
  approve?: (approvedBy: string, reason?: string) => Promise<void>;
}

interface MockRefHolder {
  ledger: ReturnType<typeof createLedger> | null;
  certificate: MockCertificate | null;
  user: { id: string; tenantId: string } | null;
}

const mockRef: MockRefHolder = { ledger: null, certificate: null, user: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<typeof import("../../middlewares/auth.middleware")>(
    "../../middlewares/auth.middleware",
  );
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: unknown }).user = mockRef.user;
      next();
    },
  };
});
jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// Not under test, and it pulls in the PDF/QR toolchain.
jest.mock("../../controllers/certificatePdf.controller", () => ({
  verifyCertificate: jest.fn(),
  verifyDocument: jest.fn(),
  getDocument: jest.fn(),
  downloadPdf: jest.fn(),
  getQrCode: jest.fn(),
}));

// P21-15: the e-signature collaborator is outside this suite's scope; certificateEsignatures.p2115 tests it over the real models.
jest.mock("../../services/esignatureApplication.service", () => ({ autoApplyApproval: jest.fn().mockResolvedValue(null), certificateMarks: jest.fn().mockResolvedValue([]) }));
jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async () => mockRef.certificate),
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
  ESignatureRecord: {
    create: jest.fn(async (values: Record<string, unknown>, options: unknown) =>
      mockRef.ledger!.write("e_signature_records", values, options),
    ),
  },
  AuditLog: { create: (...args: any[]) => (mockRef.ledger as any)?.AuditLog?.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: any[]) => (mockRef.ledger as any)?.transaction(...args) },
}));
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(async (userId: string, password: string) => ({
    data: { valid: PASSWORDS[userId] !== undefined && PASSWORDS[userId] === password },
  })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => false) }));
jest.mock("../../services/workflow.service", () => ({
  startWorkflow: jest.fn(async () => undefined),
  // A-203: no workflow pending unless a test says so.
  findPendingInstance: jest.fn(async () => null),
}));

import { Sequelize, DataTypes } from "sequelize";
import { logger } from "../../middlewares/activityLog.middleware";

/* eslint-disable @typescript-eslint/no-require-imports */
const RealCertificate = (jest.requireActual("../../models/certificate.model") as (s: Sequelize, d: typeof DataTypes) => { prototype: { approve: (approvedBy: string, reason?: string) => Promise<void> } })(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const authService = require("../../services/auth.service") as typeof import("../../services/auth.service");
const router = require("../../routes/api/certificates.route") as { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };
/* eslint-enable @typescript-eslint/no-require-imports */

const makeCertificate = (): MockCertificate => {
  const cert: MockCertificate = {
    id: CERT_ID,
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    calibrationRecordId: "rec-1",
    status: "pending_approval",
    approvedBy: null,
  };
  cert.save = async (options: unknown) =>
    mockRef.ledger!.write(
      "certificates",
      { id: cert.id, status: cert.status, approvedBy: cert.approvedBy },
      options,
    );
  // The model's own transition rules, not the test's.
  cert.approve = RealCertificate.prototype.approve as unknown as (approvedBy: string, reason?: string) => Promise<void>;
  return cert;
};

interface HttpResponse {
  status: number;
  body: unknown;
}

const post = (url: string, body: Record<string, unknown>): Promise<HttpResponse> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: unknown) {
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
      originalUrl: "/api/v1/certificates" + url,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "jest-agent" },
      ip: "10.0.0.7",
      get: () => undefined,
    };
    (router as unknown as { handle: (req: unknown, res: unknown, next: (err?: { status?: number; statusCode?: number; message?: string }) => void) => void }).handle(req, res, (err?: { status?: number; statusCode?: number; message?: string }) =>
      resolve({
        status: err ? err.status || err.statusCode || 500 : 404,
        body: { message: err?.message ?? "no route" },
      }),
    );
  });

const approve = (body: Record<string, unknown>) => post(`/${CERT_ID}/approve`, body);

describe("A-62 — POST /certificates/:id/approve: the approver is the caller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRef.ledger = createLedger({ cls: false });
    mockRef.certificate = makeCertificate();
    mockRef.user = { id: CALLER, tenantId: TENANT };
    jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(logger, "info").mockImplementation(() => logger);
  });

  it("a body approvedBy naming another user has no effect", async () => {
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    expect(mockRef.certificate!.approvedBy).toBe(CALLER);
    const committed = mockRef.ledger!.committed("certificates");
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((row: { approvedBy?: string }) => row.approvedBy !== OTHER)).toBe(true);
    expect(JSON.stringify(mockRef.ledger!.rows)).not.toContain(OTHER);
  });

  it("re-authentication checks the caller's own credentials", async () => {
    // The caller knows the OTHER user's password and names them in the body.
    // That used to be a valid approval in the other user's name.
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[OTHER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(401);
    expect(authService.passIsValid).toHaveBeenCalledTimes(1);
    expect(authService.passIsValid).toHaveBeenCalledWith(CALLER, PASSWORDS[OTHER]);
    // Nothing was approved or signed. The one audit row is the failed
    // attempt itself (A-126, ADR-051 Q-15), naming the CALLER.
    expect(mockRef.certificate!.status).toBe("pending_approval");
    expect(mockRef.ledger!.committed("certificates")).toEqual([]);
    expect(mockRef.ledger!.committed("e_signature_records")).toEqual([]);
    expect(mockRef.ledger!.auditRows().map((r: { action: string; userId: string }) => [r.action, r.userId])).toEqual([
      ["SIGNATURE_AUTH_FAILED", CALLER],
    ]);
  });

  it("the certificate's approver and the audit row's userId are the same id", async () => {
    const res = await approve({
      approvedBy: OTHER,
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    // model.approve() saves the status transition first; the service's save
    // that stamps the approver is the final certificate write.
    const certRow = (mockRef.ledger as unknown as { committed: (tbl: string) => { at: (idx: number) => { approvedBy: string } } }).committed("certificates").at(-1);
    const signature = ((mockRef.ledger as unknown as { committed: (tbl: string) => Array<{ userId: string }> }).committed("e_signature_records"))[0] as { userId: string };
    const audit = (mockRef.ledger as unknown as { auditRows: () => Array<{ userId: string; changes: { after: { approvedBy: string } } }> }).auditRows();

    expect(audit).toHaveLength(1);
    const audit0 = audit[0] as { userId: string; changes: { after: { approvedBy: string } } };
    expect(certRow?.approvedBy).toBe(CALLER);
    expect(audit0.userId).toBe(certRow?.approvedBy);
    expect(audit0.changes.after.approvedBy).toBe(CALLER);
    expect(signature.userId).toBe(CALLER);
    expect(audit0).toEqual(
      expect.objectContaining({ action: "APPROVE", resourceId: CERT_ID, ipAddress: "10.0.0.7" }),
    );
  });

  it("approves as the caller when the body carries no approvedBy", async () => {
    const res = await approve({
      authMethod: "password",
      authPayload: PASSWORDS[CALLER],
      meaning: "Reviewed and approved",
    });

    expect(res.status).toBe(200);
    expect(mockRef.certificate!.approvedBy).toBe(CALLER);
    expect(authService.passIsValid).toHaveBeenCalledWith(CALLER, PASSWORDS[CALLER]);
  });

  it("still 400s when the e-signature triple is missing", async () => {
    const res = await approve({ approvedBy: CALLER });

    expect(res.status).toBe(400);
    expect(authService.passIsValid).not.toHaveBeenCalled();
    expect(mockRef.ledger!.rows).toEqual([]);
  });
});
