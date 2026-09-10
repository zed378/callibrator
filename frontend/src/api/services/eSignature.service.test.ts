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
    it("unwraps data.keyPairs", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ keyPairs: [{ id: "k1", label: "Signing key" }] }),
      );
      const res = await eSignatureService.getKeyPairs();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/key-pairs`);
      expect(res).toHaveLength(1);
    });

    it("returns [] when the tenant has no key pairs", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ keyPairs: null }));
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

  describe("workflows", () => {
    it("unwraps data.workflows", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ workflows: [{ id: "w1", documentId: "d1" }] }),
      );
      const res = await eSignatureService.getWorkflows();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/workflows`, {
        params: {},
      });
      expect(res[0].id).toBe("w1");
    });

    it("passes a status filter", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ workflows: [] }));
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
    it("sends stepId in the body (the route has no path param)", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "s1" }));
      await eSignatureService.signDocument({
        stepId: "step-1",
        authenticationMethod: "mfa",
      });
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/sign`, {
        stepId: "step-1",
        authenticationMethod: "mfa",
      });
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
    it("unwraps data.signatures and passes the backend's own filters", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ signatures: [{ id: "s1" }] }),
      );
      const res = await eSignatureService.getSignatureHistory({
        userId: "u1",
        startDate: "2026-01-01",
      });
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/history`, {
        params: { userId: "u1", startDate: "2026-01-01" },
      });
      expect(res).toHaveLength(1);
    });

    it("returns [] when there is no history", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ signatures: null }));
      await expect(eSignatureService.getSignatureHistory()).resolves.toEqual([]);
    });
  });
});
