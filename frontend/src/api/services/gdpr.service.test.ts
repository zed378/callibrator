import { gdprService } from "./gdpr.service";
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

const BASE = "/api/v1/gdpr";

describe("gdprService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("exportData", () => {
    it("posts with no body — the subject comes from the JWT", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ user: { id: "u1" } }));

      await gdprService.exportData();

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/export`);
    });
  });

  describe("erasure", () => {
    it("requires reason and confirm:true", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "r1" }));

      await gdprService.requestErasure({
        reason: "No longer a customer",
        confirm: true,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/erasure`, {
        reason: "No longer a customer",
        confirm: true,
      });
      // The subject is never sent — the backend reads it from the token.
      const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("userId");
    });

    it("reads one erasure request by id", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ id: "r1" }));

      await gdprService.getErasureRequest("r1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/erasure/r1`);
    });
  });

  describe("consent", () => {
    it("sends { categories, consent } — the shape the validator requires", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope([{ id: "c1" }]));

      await gdprService.updateConsent(["analytics", "marketing"], false);

      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/consent`, {
        categories: ["analytics", "marketing"],
        consent: false,
      });
    });

    it("reads history as a plain array (not data.rows)", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope([{ id: "c1" }]));

      const res = await gdprService.getConsentHistory();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/consent/history`);
      expect(res).toHaveLength(1);
    });

    it("returns [] when there is no history", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(gdprService.getConsentHistory()).resolves.toEqual([]);
    });
  });

  describe("processing activities", () => {
    // Verified live: this returns an Article 30 record document, NOT a bare
    // array — the activities are nested under `activities`.
    const RECORD = {
      controller: "Hospital Device Calibration Platform",
      tenantId: "t1",
      subjectId: "u1",
      generatedAt: "2026-07-17T00:00:00.000Z",
      activities: [{ purpose: "Calibration records" }],
    };

    it("returns the full Article 30 record", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(RECORD));

      const res = await gdprService.getProcessingRecord();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/processing`);
      expect(res.controller).toBe("Hospital Device Calibration Platform");
      expect(res.activities).toHaveLength(1);
    });

    it("getProcessingActivities unwraps just the activities", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(RECORD));

      const res = await gdprService.getProcessingActivities();

      expect(res[0].purpose).toBe("Calibration records");
    });

    it("getProcessingActivities returns [] when the record has none", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ ...RECORD, activities: undefined }));

      await expect(gdprService.getProcessingActivities()).resolves.toEqual([]);
    });
  });

  describe("rectifyData", () => {
    it("sends { field, value }", async () => {
      mockedApi.put.mockResolvedValueOnce(envelope({ updated: true }));

      await gdprService.rectifyData("firstName", "Jane");

      expect(mockedApi.put).toHaveBeenCalledWith(`${BASE}/rectify`, {
        field: "firstName",
        value: "Jane",
      });
    });
  });

  describe("restrictProcessing", () => {
    it("sends the required reason", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ restricted: true }));

      await gdprService.restrictProcessing("Disputing accuracy");

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/restrict`, {
        reason: "Disputing accuracy",
      });
    });
  });
});
