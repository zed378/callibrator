/**
 * ADR-101 — separation of duties on certificate approval.
 *
 * The user who drafted (`createdBy`) or submitted (`submittedBy`) a
 * certificate may not approve it: directly (POST /certificates/:id/approve)
 * or at any step of its approval workflow. The refusal is a 403 with the rule
 * named, decided BEFORE re-authentication, so it consumes no one-time MFA
 * code and writes nothing — no certificate change, no signature record, no
 * APPROVE audit row. Another user approves the same row, unchanged.
 *
 * Fail-before: until ADR-101 the author's approval returned 200 and the
 * certificate was approved by the person who wrote it.
 *
 * Persistence is the auditLedger fixture (`cls: false`: real rollback, only
 * committed rows are asserted). The certificate double uses the REAL model
 * transition methods, as certificate.transitionLock.a167.test.js does.
 */
import type * as SequelizeModule from "sequelize";

type LedgerRow = Record<string, unknown>;
interface Ledger {
  write(table: string, row: LedgerRow, options?: unknown): LedgerRow;
  committed(table: string): LedgerRow[];
  auditRows(): LedgerRow[];
  transaction(...args: unknown[]): unknown;
  AuditLog: { create(...args: unknown[]): unknown };
}
interface CertDouble {
  id: string;
  status: string;
  createdBy: string | null;
  submittedBy: string | null;
  approvedBy?: string | null;
  [key: string]: unknown;
}
interface ServiceResult {
  status: number;
  data: CertDouble;
}
interface ThrownStatus {
  status: number;
  message: string;
}

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories and the JavaScript service graph; typed by the members used */
const mockRef: { ledger: Ledger | null; current: CertDouble | null } = { ledger: null, current: null };
const ledger = (): Ledger => {
  if (!mockRef.ledger) {throw new Error("ledger not set");}
  return mockRef.ledger;
};

jest.mock("../../services/attachment.service", () => ({
  softDeleteForResource: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(() => Promise.resolve(mockRef.current)),
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
    create: jest.fn((values: LedgerRow, options: unknown) =>
      Promise.resolve(ledger().write("e_signature_records", values, options)),
    ),
  },
  AuditLog: { create: (...args: unknown[]) => ledger().AuditLog.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args: unknown[]) => ledger().transaction(...args) },
}));
jest.mock("../../services/workflow.service", () => ({
  startWorkflow: jest.fn(() => Promise.resolve(null)),
  findPendingInstance: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(() => Promise.resolve({ data: { valid: true } })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => true) }));

const { createLedger } = require("../fixtures/auditLedger") as { createLedger: (o: { cls: boolean }) => Ledger };
const { Sequelize, DataTypes } = jest.requireActual<typeof SequelizeModule>("sequelize");
const initCertificate: (s: unknown, d: unknown) => { prototype: Record<string, unknown> } = jest.requireActual(
  "../../models/certificate.model",
);
const RealCertificate = initCertificate(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const authService = require("../../services/auth.service") as { passIsValid: jest.Mock };
const certificateService = require("../../services/certificate.service") as {
  approveCertificate(t: string, c: string, by: string, auth: object): Promise<ServiceResult>;
  submitCertificateForApproval(t: string, c: string, actor: object): Promise<ServiceResult>;
  refuseSelfApprovalInWorkflow(tx: unknown, t: string, c: string, by: string): Promise<void>;
  isAuthorOf(cert: Partial<CertDouble>, by: string): boolean;
  SELF_APPROVAL_REFUSAL: string;
};
const { logger } = require("../../middlewares/activityLog.middleware") as {
  logger: { error: (...a: unknown[]) => unknown; info: (...a: unknown[]) => unknown };
};
/* eslint-enable @typescript-eslint/no-require-imports */

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const SUBMITTER = "22222222-2222-4222-8222-222222222222";
const REVIEWER = "33333333-3333-4333-8333-333333333333";
const auth = { authMethod: "password", authPayload: "pw", meaning: "Reviewed and approved", ipAddress: "10.0.0.1", userAgent: "UA" };

const makeCertificate = (fields: Partial<CertDouble>): CertDouble => {
  const cert: CertDouble = {
    id: "cert-1",
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    status: "pending_approval",
    createdBy: AUTHOR,
    submittedBy: SUBMITTER,
    ...fields,
  };
  cert["save"] = (options: unknown) =>
    Promise.resolve(
      ledger().write(
        "certificates",
        { id: cert.id, status: cert.status, approvedBy: cert.approvedBy ?? null, submittedBy: cert.submittedBy },
        options,
      ),
    );
  for (const method of ["submitForApproval", "approve"]) {
    cert[method] = RealCertificate.prototype[method];
  }
  return cert;
};

const nothingWritten = (): void => {
  expect(ledger().committed("certificates")).toEqual([]);
  expect(ledger().committed("e_signature_records")).toEqual([]);
  expect(ledger().auditRows()).toEqual([]);
};

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  authService.passIsValid.mockClear();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ADR-101 — POST /certificates/:id/approve refuses the certificate's author", () => {
  it.each([
    ["the user who drafted it (createdBy)", AUTHOR],
    ["the user who submitted it (submittedBy)", SUBMITTER],
  ])("%s: 403 with the rule named, before re-authentication, and nothing is written", async (_who, approver) => {
    mockRef.current = makeCertificate({});

    const err = (await certificateService
      .approveCertificate("tenant-1", "cert-1", approver, auth)
      .catch((e: unknown) => e)) as ThrownStatus;

    expect(err.status).toBe(403);
    expect(err.message).toBe(certificateService.SELF_APPROVAL_REFUSAL);
    expect(err.message).toMatch(/separation of duties/);
    expect(authService.passIsValid).not.toHaveBeenCalled();
    nothingWritten();
    expect(mockRef.current.status).toBe("pending_approval");
  });

  it("another user with approval rights approves the same certificate: 200, one APPROVE audit row", async () => {
    mockRef.current = makeCertificate({});

    const result = await certificateService.approveCertificate("tenant-1", "cert-1", REVIEWER, auth);

    expect(result.status).toBe(200);
    expect(result.data.status).toBe("approved");
    expect(result.data.approvedBy).toBe(REVIEWER);
    expect(ledger().auditRows().map((row) => row["action"])).toEqual(["APPROVE"]);
  });

  it("a certificate with no recorded submitter (seeded before migration 0095) still refuses its creator", async () => {
    mockRef.current = makeCertificate({ submittedBy: null });

    await expect(
      certificateService.approveCertificate("tenant-1", "cert-1", AUTHOR, auth),
    ).rejects.toMatchObject({ status: 403 });
    nothingWritten();
  });

  it("the state rule still comes first: the author approving a draft is told to submit it (409)", async () => {
    mockRef.current = makeCertificate({ status: "draft" });

    await expect(
      certificateService.approveCertificate("tenant-1", "cert-1", AUTHOR, auth),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("ADR-101 — submit records the submitter", () => {
  it("stamps submittedBy with the caller, in the saved row and in the audit row", async () => {
    mockRef.current = makeCertificate({ status: "draft", submittedBy: null });

    const result = await certificateService.submitCertificateForApproval("tenant-1", "cert-1", {
      userId: SUBMITTER,
      ipAddress: "10.0.0.1",
      userAgent: "UA",
    });

    expect(result.status).toBe(200);
    expect(ledger().committed("certificates")).toEqual([
      expect.objectContaining({ status: "pending_approval", submittedBy: SUBMITTER }),
    ]);
    const rows = ledger().auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: SUBMITTER, changes: { after: { submittedBy: SUBMITTER } } });
  });
});

describe("ADR-101 — the workflow path refuses the author at every approving step", () => {
  it("403 for the author or the submitter; passes for another user", async () => {
    mockRef.current = makeCertificate({});

    await expect(
      certificateService.refuseSelfApprovalInWorkflow({}, "tenant-1", "cert-1", AUTHOR),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      certificateService.refuseSelfApprovalInWorkflow({}, "tenant-1", "cert-1", SUBMITTER),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      certificateService.refuseSelfApprovalInWorkflow({}, "tenant-1", "cert-1", REVIEWER),
    ).resolves.toBeUndefined();
  });

  it("a certificate that is gone is left to lockForWorkflowDecision (no refusal here)", async () => {
    mockRef.current = null;

    await expect(
      certificateService.refuseSelfApprovalInWorkflow({}, "tenant-1", "cert-1", AUTHOR),
    ).resolves.toBeUndefined();
  });
});

describe("ADR-101 — isAuthorOf", () => {
  it("ignores null authorship and compares ids as strings", () => {
    expect(certificateService.isAuthorOf({ createdBy: null, submittedBy: null }, AUTHOR)).toBe(false);
    expect(certificateService.isAuthorOf({ createdBy: AUTHOR, submittedBy: null }, AUTHOR)).toBe(true);
    expect(certificateService.isAuthorOf({ createdBy: null, submittedBy: SUBMITTER }, SUBMITTER)).toBe(true);
    expect(certificateService.isAuthorOf({ createdBy: AUTHOR, submittedBy: SUBMITTER }, REVIEWER)).toBe(false);
  });
});
