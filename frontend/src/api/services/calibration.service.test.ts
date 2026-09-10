import { calibrationService } from "./calibration.service";
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

describe("calibrationService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("passes pagination + filter params and unwraps data.rows with top-level meta", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: { rows: [{ id: "c1" }], count: 1 },
        meta: { total: 42, page: 2, limit: 5, totalPages: 9 },
      });

      const res = await calibrationService.getAll(
        2,
        5,
        "dev1",
        true,
        "2026-01-01",
        "2026-02-01",
      );

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/calibration-records", {
        params: {
          page: 2,
          limit: 5,
          deviceId: "dev1",
          isCompliant: true,
          from: "2026-01-01",
          to: "2026-02-01",
        },
      });
      expect(res.data).toEqual([{ id: "c1" }]);
      expect(res.meta).toEqual({
        total: 42,
        page: 2,
        limit: 5,
        totalPages: 9,
      });
    });

    it("falls back to [] and computed meta when data is empty", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "",
        data: null,
      });

      const res = await calibrationService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/calibration-records", {
        params: {
          page: 1,
          limit: 20,
          deviceId: undefined,
          isCompliant: undefined,
          from: undefined,
          to: undefined,
        },
      });
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 1 });
    });

    it("accepts a plain-array data payload", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: [{ id: "c1" }, { id: "c2" }],
      });

      const res = await calibrationService.getAll();
      expect(res.data).toHaveLength(2);
      expect(res.meta.total).toBe(2);
    });
  });

  describe("getById", () => {
    it("GETs one record and returns data", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "c1" }));
      const res = await calibrationService.getById("c1");
      expect(mockedApi.get).toHaveBeenCalledWith(
        "/api/v1/calibration-records/c1",
      );
      expect(res).toEqual({ id: "c1" });
    });
  });

  describe("create", () => {
    it("POSTs the input and returns data", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "c1" }));
      const input = { deviceId: "d1", calibrationDate: "2026-01-01" };
      const res = await calibrationService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/calibration-records",
        input,
      );
      expect(res).toEqual({ id: "c1" });
    });
  });

  describe("update", () => {
    it("strips id and PUTs the rest to /:id", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "c1" }));
      await calibrationService.update({ id: "c1", notes: "n" });
      expect(mockedApi.put).toHaveBeenCalledWith(
        "/api/v1/calibration-records/c1",
        { notes: "n" },
      );
    });
  });

  describe("delete", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await calibrationService.delete("c1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/calibration-records/c1",
      );
    });
  });

  describe("getAllCertificates", () => {
    it("passes cert filter params and unwraps rows", async () => {
      mockedApi.get.mockResolvedValueOnce({
        success: true,
        message: "ok",
        data: { rows: [{ id: "cert1" }], count: 1 },
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });

      const res = await calibrationService.getAllCertificates(
        1,
        20,
        "d1",
        ["approved"],
        ["calibration"],
        "CN-1",
        "2026-01-01",
        "2026-02-01",
      );

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/certificates", {
        params: {
          page: 1,
          limit: 20,
          deviceId: "d1",
          status: ["approved"],
          type: ["calibration"],
          certificateNumber: "CN-1",
          from: "2026-01-01",
          to: "2026-02-01",
        },
      });
      expect(res.data).toEqual([{ id: "cert1" }]);
    });
  });

  describe("getCertificateById", () => {
    it("GETs one certificate", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "cert1" }));
      const res = await calibrationService.getCertificateById("cert1");
      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/certificates/cert1");
      expect(res).toEqual({ id: "cert1" });
    });
  });

  describe("createCertificate", () => {
    it("POSTs input", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "cert1" }));
      const input = { deviceId: "d1" };
      await calibrationService.createCertificate(input);
      expect(mockedApi.post).toHaveBeenCalledWith("/api/v1/certificates", input);
    });
  });

  describe("updateCertificate", () => {
    it("strips id and PUTs the rest", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ id: "cert1" }));
      await calibrationService.updateCertificate({
        id: "cert1",
        status: "approved",
      });
      expect(mockedApi.put).toHaveBeenCalledWith("/api/v1/certificates/cert1", {
        status: "approved",
      });
    });
  });

  describe("deleteCertificate", () => {
    it("DELETEs by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));
      await calibrationService.deleteCertificate("cert1");
      expect(mockedApi.delete).toHaveBeenCalledWith(
        "/api/v1/certificates/cert1",
      );
    });
  });

  describe("approveCertificate", () => {
    it("POSTs the approval + e-sig triple to /:id/approve", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "cert1" }));
      const input = {
        approvedBy: "u1",
        authMethod: "password" as const,
        authPayload: "pw",
        meaning: "Approved",
      };
      await calibrationService.approveCertificate("cert1", input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/certificates/cert1/approve",
        input,
      );
    });
  });

  describe("signCertificate", () => {
    it("POSTs signature + key id to /:id/sign", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "cert1" }));
      const input = {
        digitalSignature: "sig",
        digitalSignatureKeyId: "k1",
        authMethod: "mfa" as const,
        authPayload: "123456",
        meaning: "Signed",
      };
      await calibrationService.signCertificate("cert1", input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/certificates/cert1/sign",
        input,
      );
    });
  });

  describe("revokeCertificate", () => {
    it("POSTs reason + triple to /:id/revoke", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "cert1" }));
      const input = {
        reason: "expired",
        authMethod: "password" as const,
        authPayload: "pw",
        meaning: "Revoked",
      };
      await calibrationService.revokeCertificate("cert1", input);
      expect(mockedApi.post).toHaveBeenCalledWith(
        "/api/v1/certificates/cert1/revoke",
        input,
      );
    });
  });

  describe("getCertificateStats", () => {
    it("GETs stats and returns data", async () => {
      const stats = { totalCertificates: 3, byStatus: {}, byType: {} };
      mockedApi.get.mockResolvedValueOnce(envelope(stats));
      const res = await calibrationService.getCertificateStats();
      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/certificates/stats");
      expect(res).toEqual(stats);
    });
  });

  describe("getVerifyUrl", () => {
    it("builds a public verify URL and encodes the certificate number", () => {
      const url = calibrationService.getVerifyUrl("CN 1/2");
      expect(url).toBe(
        `${window.location.origin}/api/v1/certificates/verify/CN%201%2F2`,
      );
    });
  });
});
