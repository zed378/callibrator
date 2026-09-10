import { dashboardService } from "./dashboard.service";
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

describe("dashboardService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getMetrics", () => {
    it("GETs metrics with no params when no tenantId is given", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ scope: "tenant" }));

      const res = await dashboardService.getMetrics();

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/dashboard/metrics", {
        params: undefined,
      });
      expect(res).toEqual({ scope: "tenant" });
    });

    it("GETs metrics with tenantId param when provided", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ scope: "global" }));

      await dashboardService.getMetrics("t1");

      expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/dashboard/metrics", {
        params: { tenantId: "t1" },
      });
    });
  });
});
