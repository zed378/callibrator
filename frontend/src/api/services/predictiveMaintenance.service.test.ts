import { predictiveMaintenanceService } from "./predictiveMaintenance.service";
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

const BASE = "/api/v1/predictive-maintenance";

describe("predictiveMaintenanceService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("analyzeDevice", () => {
    it("POSTs to analyze/:deviceId with no body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ status: "analyzed", deviceId: "d1", anomalyRate: 0.1 }),
      );

      const res = await predictiveMaintenanceService.analyzeDevice("d1");

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/analyze/d1`);
      expect(res).toEqual({ status: "analyzed", deviceId: "d1", anomalyRate: 0.1 });
    });
  });

  describe("getRecommendations", () => {
    it("GETs the recommendations list and unwraps the array in data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "d1", name: "Caliper", recommendedCalibrationInterval: 180 }]),
      );

      const res = await predictiveMaintenanceService.getRecommendations();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/recommendations`);
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe("d1");
    });

    it("returns whatever data holds (no [] fallback) — passes null through", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(
        predictiveMaintenanceService.getRecommendations(),
      ).resolves.toBeNull();
    });
  });

  describe("approveRecommendation", () => {
    it("POSTs to recommendations/:deviceId/approve with no body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce(
        envelope({ deviceId: "d1", calibrationIntervalDays: 180 }),
      );

      const res = await predictiveMaintenanceService.approveRecommendation("d1");

      expect(mockedApi.post).toHaveBeenCalledWith(
        `${BASE}/recommendations/d1/approve`,
      );
      expect(res).toEqual({ deviceId: "d1", calibrationIntervalDays: 180 });
    });
  });
});
