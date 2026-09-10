import { meteredBillingService } from "./meteredBilling.service";
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

const BASE = "/api/v1/metered-billing";

describe("meteredBillingService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getUsage", () => {
    it("returns the snapshot object (not a paginated list)", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          tenantId: "t1",
          metrics: { api_calls: 1200 },
          generatedAt: "2026-07-17T00:00:00.000Z",
        }),
      );

      const res = await meteredBillingService.getUsage();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/usage`);
      expect(res.metrics.api_calls).toBe(1200);
    });
  });

  describe("getUsageHistory", () => {
    // /history is the one endpoint that really nests { rows, meta } in data.
    it("reads rows and meta from inside data", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          rows: [{ id: "inv1", amount: 100 }],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }),
      );

      const res = await meteredBillingService.getUsageHistory({
        page: 1,
        limit: 20,
      });

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/history`, {
        params: { page: 1, limit: 20 },
      });
      expect(res.rows).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });

    it("passes the date filters the validator accepts", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ rows: [] }));

      await meteredBillingService.getUsageHistory({
        startDate: "2026-01-01",
        endDate: "2026-02-01",
      });

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/history`, {
        params: { startDate: "2026-01-01", endDate: "2026-02-01" },
      });
    });

    it("falls back to empty rows and derived meta", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({}));
      const res = await meteredBillingService.getUsageHistory();
      expect(res.rows).toEqual([]);
      expect(res.meta.page).toBe(1);
    });
  });

  describe("estimateUsage", () => {
    it("sends { metrics, quantity, period } — the shape the validator requires", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ total: 42 }));

      await meteredBillingService.estimateUsage({ api_calls: 5000 }, 3);

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/estimate`, {
        metrics: { api_calls: 5000 },
        quantity: 3,
        period: "monthly",
      });
    });

    it("honours an explicit period", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ total: 1 }));

      await meteredBillingService.estimateUsage({ storage_gb: 10 }, 1, "yearly");

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/estimate`, {
        metrics: { storage_gb: 10 },
        quantity: 1,
        period: "yearly",
      });
    });
  });

  describe("getPlan", () => {
    it("returns a single plan object", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          plan: "business",
          billingCycle: "monthly",
          limits: { api_calls: 100000 },
          overagePricing: { api_calls: 0.001 },
        }),
      );

      const res = await meteredBillingService.getPlan();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/plan`);
      expect(res.plan).toBe("business");
      expect(Array.isArray(res)).toBe(false);
    });
  });

  describe("alerts", () => {
    it("reads the plain array (no rows wrapper)", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope([{ id: "a1", metricName: "api_calls", threshold: 1000 }]),
      );

      const res = await meteredBillingService.getAlerts();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/alerts`);
      expect(res).toHaveLength(1);
    });

    it("returns [] when there are no alerts", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(null));
      await expect(meteredBillingService.getAlerts()).resolves.toEqual([]);
    });

    it("creates an alert with only the required fields", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope({ id: "a1" }));

      await meteredBillingService.createAlert({
        metricName: "api_calls",
        threshold: 1000,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/alerts`, {
        metricName: "api_calls",
        threshold: 1000,
      });
    });

    it("deletes an alert (there is no acknowledge route)", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));

      await meteredBillingService.deleteAlert("a1");

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/alerts/a1`);
    });
  });

  describe("getAnalytics", () => {
    it("defaults to the 30d period", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ totals: {} }));

      await meteredBillingService.getAnalytics();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/analytics`, {
        params: { period: "30d" },
      });
    });

    it("passes period and metrics", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope({ totals: {} }));

      await meteredBillingService.getAnalytics("90d", ["api_calls"]);

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/analytics`, {
        params: { period: "90d", metrics: ["api_calls"] },
      });
    });
  });
});
