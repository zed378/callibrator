/**
 * A-113 — two e-signature defects, through the REAL controller, service and
 * response.util. Only the models and the audit write are doubled.
 *
 * 1. GET /key-pairs wrapped its rows as `data.keyPairs`. The envelope rule
 *    (CLAUDE.md) is rows in `data`, the count in a top-level `meta`.
 * 2. DELETE /workflows/:id soft-deleted a COMPLETED workflow — a signed
 *    record — with no state check. It is now a 409 that explains the state,
 *    as editing or cancelling a completed workflow already is (A-92).
 */

const mockModels = {
  TenantKey: { findAll: jest.fn() },
  SignatureWorkflow: { findOne: jest.fn() },
  // A-130 / A-144: deletion now also counts the workflow's signatures. These
  // cases have none; the signed cases are in eSignature.a130.test.js.
  SignatureRecord: { count: jest.fn() },
};

jest.mock("../../models", () => mockModels);
jest.mock("../../config", () => ({
  db: { transaction: async (cb: (tx: string) => Promise<unknown>) => cb("TX") },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  statusCode: number | null;
  body: Record<string, unknown> | null;
  headersSent: boolean;
  status: jest.Mock;
  json: jest.Mock;
}

type ControllerHandler = (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;

interface ESignatureControllerDouble {
  getKeyPairs: ControllerHandler;
  deleteWorkflow: ControllerHandler;
}

interface AuditServiceDouble {
  logAction: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const eSignatureController = require("../../controllers/eSignature.controller") as ESignatureControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const auditService = require("../../services/audit.service") as AuditServiceDouble;

const WF_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const makeRes = (): FakeRes => {
  const res: FakeRes = {
    statusCode: null,
    body: null,
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: Record<string, unknown>) => {
    res.body = body;
    res.headersSent = true;
    return res;
  });
  return res;
};

const makeReq = (overrides: Partial<FakeReq> = {}): FakeReq => ({
  user: { id: "user-1", tenantId: "tenant-1" },
  params: {},
  query: {},
  body: {},
  headers: {},
  ip: "203.0.113.7",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockModels.SignatureRecord.count.mockResolvedValue(0);
});

describe("A-113 — GET /key-pairs: rows in data, count in a top-level meta", () => {
  it("answers the rows AS data, with meta.total beside them — no data.keyPairs", async () => {
    mockModels.TenantKey.findAll.mockResolvedValueOnce([
      { id: "k1", keyId: "key-1", keyType: "RSA", algorithm: "RS256", publicKey: "PUB1", createdAt: "t1" },
      { id: "k2", keyId: "key-2", keyType: "RSA", algorithm: "RS256", publicKey: "PUB2", createdAt: "t2" },
    ]);
    const res = makeRes();

    await eSignatureController.getKeyPairs(makeReq(), res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: "Key pairs retrieved",
      data: [
        { id: "k1", keyId: "key-1", keyType: "RSA", algorithm: "RS256", publicKey: "PUB1", createdAt: "t1" },
        { id: "k2", keyId: "key-2", keyType: "RSA", algorithm: "RS256", publicKey: "PUB2", createdAt: "t2" },
      ],
      meta: { total: 2 },
    });
  });

  it("a tenant with no key pairs gets data: [] and meta.total 0", async () => {
    mockModels.TenantKey.findAll.mockResolvedValueOnce([]);
    const res = makeRes();

    await eSignatureController.getKeyPairs(makeReq(), res, jest.fn());

    expect(res.body?.["data"]).toEqual([]);
    expect(res.body?.["meta"]).toEqual({ total: 0 });
  });
});

describe("A-113 — DELETE /workflows/:id on a completed workflow", () => {
  const workflow = (status: string) => ({
    id: WF_ID,
    status,
    documentId: "doc-1",
    destroy: jest.fn().mockResolvedValue(undefined),
  });

  it("a completed workflow cannot be deleted: 409 with the reason, nothing destroyed, nothing audited", async () => {
    const wf = workflow("completed");
    mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce(wf);
    const res = makeRes();

    await eSignatureController.deleteWorkflow(
      makeReq({ params: { workflowId: WF_ID } }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      status: 409,
      message:
        'This signature workflow is "completed" and cannot be deleted: every signer has signed, and the signatures cover the workflow as it was signed.',
    });
    expect(wf.destroy).not.toHaveBeenCalled();
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it.each(["pending", "in_progress", "cancelled", "expired"])(
    "a %s workflow is still deleted, with its audit row in the transaction",
    async (status) => {
      const wf = workflow(status);
      mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce(wf);
      const res = makeRes();

      await eSignatureController.deleteWorkflow(
        makeReq({ params: { workflowId: WF_ID } }),
        res,
        jest.fn(),
      );

      expect(res.statusCode).toBe(200);
      expect(wf.destroy).toHaveBeenCalledWith({ transaction: "TX" });
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "DELETE", resourceId: WF_ID }),
        { transaction: "TX" },
      );
    },
  );

  it("a workflow of another tenant stays a 404", async () => {
    mockModels.SignatureWorkflow.findOne.mockResolvedValueOnce(null);
    const res = makeRes();

    await eSignatureController.deleteWorkflow(
      makeReq({ params: { workflowId: WF_ID } }),
      res,
      jest.fn(),
    );

    expect(res.statusCode).toBe(404);
    const callArg = (mockModels.SignatureWorkflow.findOne.mock.calls[0] as [{ where: unknown }])[0];
    expect(callArg.where).toEqual({
      id: WF_ID,
      tenantId: "tenant-1",
    });
  });
});
