/**
 * A-167 — certificate status transitions (submit / approve / sign / revoke)
 * read the status that decides them INSIDE their transaction, with the row
 * locked (SELECT ... FOR UPDATE), as A-157 made deleteCertificate do.
 *
 * The concurrency is modelled in the certificate double, not asserted as a
 * call shape alone: an UNLOCKED read (outside a transaction, or without
 * `lock: "UPDATE"`) sees the stale row a concurrent writer is about to
 * change; the LOCKED read — which in PostgreSQL waits for that writer to
 * commit — sees what it committed. Before A-167 every transition used the
 * unlocked read, so an approval updated a certificate a concurrent delete had
 * just removed, and two concurrent transitions both passed the same check.
 *
 * Persistence is the auditLedger fixture (`cls: false`): real rollback, the
 * real audit_logs ENUM, and a write without `{ transaction }` is visible as
 * an autocommit. The certificate double uses the REAL model transition
 * methods, so the legal-transition rules are the model's.
 */
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null, stale: null, current: null, reads: [] };

jest.mock("../../models", () => ({
  Certificate: {
    findOne: jest.fn(async (options) => {
      mockRef.reads.push(options);
      const locked = Boolean(options.transaction) && options.lock === "UPDATE";
      return locked ? mockRef.current : mockRef.stale;
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
  ESignatureRecord: {
    create: jest.fn(async (values, options) => mockRef.ledger.write("e_signature_records", values, options)),
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
  Sequelize: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));
jest.mock("../../services/auth.service", () => ({
  passIsValid: jest.fn(async () => ({ data: { valid: true } })),
}));
jest.mock("../../services/mfa.service", () => ({ verifyLogin: jest.fn(() => true) }));

const { Sequelize, DataTypes } = jest.requireActual("sequelize");
const RealCertificate = jest.requireActual("../../models/certificate.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);
const authService = require("../../services/auth.service");
const certificateService = require("../../services/certificate.service");
const { logger } = require("../../middlewares/activityLog.middleware");

const SNAPSHOT_FIELDS = ["id", "status", "approvedBy", "signedBy", "notes", "digitalSignature"];

const makeCertificate = (fields) => {
  const cert = {
    id: "cert-1",
    certificateNumber: "CERT-T-0001",
    deviceId: "dev-1",
    calibrationRecordId: "rec-1",
    notes: null,
    ...fields,
  };
  const snapshot = () => Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, cert[k]]));
  cert.save = async (options) => mockRef.ledger.write("certificates", snapshot(), options);
  for (const method of ["submitForApproval", "approve", "sign", "revoke"]) {
    cert[method] = RealCertificate.prototype[method];
  }
  return cert;
};

const auth = { authMethod: "password", authPayload: "pw", meaning: "I attest", ipAddress: "10.0.0.1", userAgent: "UA" };
const actor = { userId: "user-1", ipAddress: "10.0.0.1", userAgent: "UA" };

const TRANSITIONS = [
  {
    name: "submitCertificateForApproval",
    from: "draft",
    to: "pending_approval",
    reauth: false,
    run: () => certificateService.submitCertificateForApproval("tenant-1", "cert-1", actor),
  },
  {
    name: "approveCertificate",
    from: "pending_approval",
    to: "approved",
    reauth: true,
    run: () => certificateService.approveCertificate("tenant-1", "cert-1", "user-1", auth),
  },
  {
    name: "signCertificate",
    from: "approved",
    to: "signed",
    reauth: true,
    run: () => certificateService.signCertificate("tenant-1", "cert-1", "sig", "key-1", "user-1", auth),
  },
  {
    name: "revokeCertificate",
    from: "signed",
    to: "revoked",
    reauth: true,
    run: () => certificateService.revokeCertificate("tenant-1", "cert-1", "wrong device", "user-1", auth),
  },
];

const nothingWritten = () => {
  expect(mockRef.ledger.committed("certificates")).toEqual([]);
  expect(mockRef.ledger.committed("e_signature_records")).toEqual([]);
  expect(mockRef.ledger.auditRows()).toEqual([]);
};

beforeEach(() => {
  mockRef.ledger = createLedger({ cls: false });
  mockRef.reads = [];
  authService.passIsValid.mockClear();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
  jest.spyOn(logger, "info").mockImplementation(() => logger);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(TRANSITIONS)("A-167 — $name", ({ from, to, reauth, run }) => {
  it("reads the certificate once, inside its transaction, locked FOR UPDATE", async () => {
    mockRef.stale = makeCertificate({ status: from });
    mockRef.current = mockRef.stale;

    const result = await run();

    expect(result.status).toBe(200);
    expect(mockRef.reads).toEqual([
      {
        where: { id: "cert-1", tenantId: "tenant-1" },
        transaction: expect.any(Object),
        lock: "UPDATE",
      },
    ]);
    const saved = mockRef.ledger.committed("certificates");
    expect(saved.length).toBeGreaterThan(0);
    for (const row of saved) {
      expect(row).toMatchObject({ id: "cert-1", status: to });
    }
    expect(mockRef.ledger.auditRows()).toHaveLength(1);
  });

  it("a certificate a concurrent delete just removed is a 404, and nothing is written", async () => {
    // The unlocked read would still see it; the locked read waits for the
    // delete's commit and finds nothing.
    mockRef.stale = makeCertificate({ status: from });
    mockRef.current = null;

    const result = await run();

    expect(result).toEqual({ success: false, status: 404, message: "Certificate not found", data: null });
    nothingWritten();
    expect(authService.passIsValid).not.toHaveBeenCalled();
  });

  it("a certificate a concurrent transition already moved on is a 409 with the state, and nothing is written", async () => {
    // Stale: still `from` (the check passes on it). Committed: already `to`.
    mockRef.stale = makeCertificate({ status: from });
    mockRef.current = makeCertificate({ status: to });

    const err = await run().catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toMatch(new RegExp(`^This certificate is "${to}" and cannot be `));
    nothingWritten();
    // Refused before re-authentication: no credential check, no MFA code spent.
    expect(authService.passIsValid).not.toHaveBeenCalled();
  });

  if (reauth) {
    it("re-authenticates under the lock, before the change; a wrong password changes nothing", async () => {
      mockRef.stale = makeCertificate({ status: from });
      mockRef.current = mockRef.stale;
      authService.passIsValid.mockResolvedValueOnce({ data: { valid: false } });

      await expect(run()).rejects.toMatchObject({ status: 401 });

      expect(mockRef.ledger.committed("certificates")).toEqual([]);
      expect(mockRef.ledger.committed("e_signature_records")).toEqual([]);
      // The only row is A-126's record of the failed attempt, written in its
      // own transaction; no transition row.
      expect(mockRef.ledger.auditRows().map((row) => row.action)).not.toContain("APPROVE");
      expect(mockRef.ledger.auditRows().filter((row) => row.action !== "SIGNATURE_AUTH_FAILED")).toEqual([]);
    });
  }
});

describe("A-167 — refused transitions are explained 409s", () => {
  it.each([
    ["approveCertificate", "draft", /cannot be approved: it has not been submitted yet; submit it with POST \/certificates\/:id\/submit first\.$/],
    ["approveCertificate", "revoked", /cannot be approved: revocation is final; issue a new certificate instead\.$/],
    ["signCertificate", "pending_approval", /cannot be signed: only an approved certificate can be signed; approve it/],
    ["signCertificate", "draft", /cannot be signed: only an approved certificate can be signed; submit it/],
    ["signCertificate", "signed", /cannot be signed: it has already been signed/],
    ["submitCertificateForApproval", "approved", /cannot be submitted: it has already been approved/],
    ["revokeCertificate", "revoked", /cannot be revoked: it has already been revoked, and revocation is final\.$/],
  ])("%s on a %s certificate", async (name, status, expected) => {
    mockRef.current = makeCertificate({ status });
    mockRef.stale = mockRef.current;
    const run = TRANSITIONS.find((t) => t.name === name).run;

    const err = await run().catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toMatch(new RegExp(`^This certificate is "${status}" and cannot be `));
    expect(err.message).toMatch(expected);
    nothingWritten();
  });

  it("signing a certificate that is not approved no longer answers 500 (the model's plain Error)", async () => {
    mockRef.current = makeCertificate({ status: "pending_approval" });
    mockRef.stale = mockRef.current;

    const err = await certificateService
      .signCertificate("tenant-1", "cert-1", "sig", "key-1", "user-1", auth)
      .catch((e) => e);

    expect(err.status).toBe(409);
  });

  it("revoking a revoked certificate writes no second signature record or audit row", async () => {
    mockRef.current = makeCertificate({ status: "revoked", notes: "REVOKED: first" });
    mockRef.stale = mockRef.current;

    await expect(
      certificateService.revokeCertificate("tenant-1", "cert-1", "again", "user-1", auth),
    ).rejects.toMatchObject({ status: 409 });

    nothingWritten();
  });

  it("a draft, pending or approved certificate may still be revoked", async () => {
    for (const status of ["draft", "pending_approval", "approved"]) {
      mockRef.ledger = createLedger({ cls: false });
      mockRef.current = makeCertificate({ status });
      mockRef.stale = mockRef.current;

      const result = await certificateService.revokeCertificate("tenant-1", "cert-1", "r", "user-1", auth);

      expect(result.status).toBe(200);
      expect(mockRef.ledger.committed("certificates").at(-1)).toMatchObject({ status: "revoked" });
    }
  });
});
