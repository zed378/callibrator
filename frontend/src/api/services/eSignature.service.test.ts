import { eSignatureService } from "./eSignature.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;
const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

// Mounted at /esignature — NOT /e-signature. Every method used to 404 on this.
const BASE = "/api/v1/esignature";

describe("eSignatureService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("key pairs", () => {
    // A-113: the backend (eSignature.controller#getKeyPairs) answers
    // success(res, rows, { total }, msg) — rows ARE `data`, `meta` a sibling.
    it("reads the rows from data, with meta as a top-level sibling", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "k1", label: "Signing key" }]),
        meta: { total: 1 },
      });
      const res = await eSignatureService.getKeyPairs();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/key-pairs`);
      expect(res).toEqual([{ id: "k1", label: "Signing key" }]);
    });

    it("returns [] when the tenant has no key pairs", async () => {
      mockedApi.get.mockResolvedValueOnce({ ...envelope([]), meta: { total: 0 } });
      await expect(eSignatureService.getKeyPairs()).resolves.toEqual([]);
    });

    it("returns [] when data is null", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(eSignatureService.getKeyPairs()).resolves.toEqual([]);
    });

    it("creates a key pair without sending a public key", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      await eSignatureService.createKeyPair({ label: "Signing", keySize: 4096 });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/key-pairs`, {
        label: "Signing",
        keySize: 4096,
      });
      const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("publicKey");
    });

    it("defaults to an empty body so the server applies RSA/2048", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "k1" }));
      await eSignatureService.createKeyPair();
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/key-pairs`, {});
    });

    it("deletes a key pair", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await eSignatureService.deleteKeyPair("k1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/key-pairs/k1`);
    });
  });

  // A-91 — the signer view. The backend (eSignature.controller
  // #getSignerWorkflows) answers success(res, rows, { total }, msg): rows ARE
  // `data`, and `meta` is a top-level sibling — no wrapper key.
  describe("signer view (A-91)", () => {
    it("lists the caller's workflows from data itself", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "w1", documentId: "d1", steps: [] }]),
        meta: { total: 1 },
      });
      const res = await eSignatureService.getMyWorkflows();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/my-workflows`, { params: {} });
      expect(res.map((w) => w.id)).toEqual(["w1"]);
    });

    it("passes stepStatus", async () => {
      mockedApi.get.mockResolvedValueOnce({ ...envelope([]), meta: { total: 0 } });
      await eSignatureService.getMyWorkflows("pending");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/my-workflows`, {
        params: { stepStatus: "pending" },
      });
    });

    it("an absent data is an empty list", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      expect(await eSignatureService.getMyWorkflows()).toEqual([]);
    });

    it("gets one workflow through the signer route", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "w1", steps: [] }));
      const wf = await eSignatureService.getMyWorkflow("w1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/my-workflows/w1`);
      expect(wf.id).toBe("w1");
    });
  });

  describe("workflows", () => {
    // A-106 — the backend's shape (eSignature.controller#getWorkflows,
    // pinned in backend eSignature.envelope.a105a106.test.js): rows ARE
    // `data`, the count in a top-level `meta`.
    it("reads the rows from data, meta beside it", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "w1", documentId: "d1" }]),
        meta: { total: 1 },
      });
      const res = await eSignatureService.getWorkflows();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/workflows`, {
        params: {},
      });
      expect(res).toEqual([{ id: "w1", documentId: "d1" }]);
    });

    it("returns [] for an empty list", async () => {
      mockedApi.get.mockResolvedValueOnce({ ...envelope([]), meta: { total: 0 } });
      await expect(eSignatureService.getWorkflows()).resolves.toEqual([]);
    });

    it("passes a status filter", async () => {
      mockedApi.get.mockResolvedValueOnce({ ...envelope([]), meta: { total: 0 } });
      await eSignatureService.getWorkflows("PENDING");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/workflows`, {
        params: { status: "PENDING" },
      });
    });

    it("gets one workflow", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "w1" }));
      await eSignatureService.getWorkflow("w1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/workflows/w1`);
    });

    it("creates a workflow with the required signers", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "w1" }));
      const input = {
        documentId: "d1",
        subject: "Please sign",
        signers: [{ userId: "u1", email: "a@b.c", name: "A" }],
      };
      await eSignatureService.createWorkflow(input);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/workflows`, input);
    });

    it("updates a workflow", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "w1" }));
      await eSignatureService.updateWorkflow("w1", { subject: "New" });
      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/workflows/w1`, {
        subject: "New",
      });
    });

    it("deletes a workflow", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await eSignatureService.deleteWorkflow("w1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/workflows/w1`);
    });
  });

  describe("sign and verify", () => {
    it("sends stepId and the re-authentication credential in the body, and unwraps { signatureId, certificate }", async () => {
      // data is eSignature.service#signDocument's return value, verbatim.
      const signed = {
        signatureId: "sig-1",
        certificate: {
          signatureId: "sig-1",
          workflowId: "wf-1",
          documentId: "doc-1",
          signerId: "u-1",
          signedAt: "2026-09-24T08:00:00.000Z",
          signatureHash: "ab".repeat(32),
          signatureValue: "c2ln",
          signingKeyId: "key-1",
          signatureScheme: "esig-v2-rsa-sha256",
          algorithm: "RS256",
          ipAddress: "203.0.113.9",
          userAgent: "Mozilla/5.0",
          verificationUrl: "/api/v1/esignature/verify/sig-1",
        },
      };
      mockedApi.post.mockResolvedValueOnce(envelope(signed));
      const res = await eSignatureService.signDocument({
        stepId: "step-1",
        authenticationMethod: "mfa",
        authPayload: "123456",
        reason: "Reviewed and approved",
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/sign`, {
        stepId: "step-1",
        authenticationMethod: "mfa",
        authPayload: "123456",
        reason: "Reviewed and approved",
      });
      expect(res.signatureId).toBe("sig-1");
      expect(res.certificate.signerId).toBe("u-1");
    });

    it("verifies by signatureId in the body", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ valid: true }));
      const res = await eSignatureService.verifySignature("sig-1");
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/verify`, {
        signatureId: "sig-1",
      });
      expect(res.valid).toBe(true);
    });
  });

  describe("history", () => {
    // A-106 — rows ARE `data`, the count in a top-level `meta`.
    it("reads the rows from data and passes the backend's own filters", async () => {
      mockedApi.get.mockResolvedValueOnce({
        ...envelope([{ id: "s1" }]),
        meta: { total: 1 },
      });
      const res = await eSignatureService.getSignatureHistory({
        userId: "u1",
        startDate: "2026-01-01",
      });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/history`, {
        params: { userId: "u1", startDate: "2026-01-01" },
      });
      expect(res).toEqual([{ id: "s1" }]);
    });

    it("returns [] when there is no history", async () => {
      mockedApi.get.mockResolvedValueOnce({ ...envelope([]), meta: { total: 0 } });
      await expect(eSignatureService.getSignatureHistory()).resolves.toEqual([]);
    });
  });
});
