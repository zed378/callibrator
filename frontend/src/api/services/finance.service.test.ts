import { financeService } from "./finance.service";
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

/**
 * The controller calls success(res, result.data.rows, result.data.meta, ...),
 * so the rows array is in `data` and pagination is a TOP-LEVEL `meta`.
 */
const listEnvelope = <T,>(rows: T[], meta?: unknown) => ({
  success: true,
  status: 200,
  message: "Finance records retrieved",
  data: rows,
  ...(meta ? { meta } : {}),
});

const envelope = <T,>(data: T) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
});

/** Mirrors the real asset_finances model. */
const RECORD = {
  id: "1",
  tenantId: "tenant-1",
  deviceId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  purchasePrice: 1000,
  purchaseDate: "2024-01-01",
  salvageValue: 100,
  usefulLifeYears: 5,
  depreciationMethod: "straight_line" as const,
};

const BASE = "/api/v1/finance";

describe("financeService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("reads rows from data and pagination from top-level meta", async () => {
      mockedApi.get.mockResolvedValueOnce(
        listEnvelope([RECORD], { total: 1, page: 1, limit: 20, totalPages: 1 }),
      );

      const result = await financeService.getAll();

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: { page: 1, limit: 20 },
      });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it("filters by the params the backend actually reads", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope([]));

      // deviceId/method — not status/type, which were never read server-side.
      await financeService.getAll(1, 10, {
        deviceId: "dev-1",
        method: "declining_balance",
      });

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, {
        params: {
          page: 1,
          limit: 10,
          deviceId: "dev-1",
          method: "declining_balance",
        },
      });
    });

    it("derives meta when the backend omits it", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope([RECORD]));

      const result = await financeService.getAll();

      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it("handles an empty list", async () => {
      mockedApi.get.mockResolvedValueOnce(listEnvelope([]));

      const result = await financeService.getAll();

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe("getById", () => {
    it("fetches one record", async () => {
      mockedApi.get.mockResolvedValueOnce(envelope(RECORD));

      const result = await financeService.getById("1");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/1`);
      expect(result.deviceId).toBe(RECORD.deviceId);
    });
  });

  describe("create", () => {
    it("posts the asset-finance payload the validator requires", async () => {
      mockedApi.post.mockResolvedValueOnce(envelope(RECORD));

      await financeService.create({
        deviceId: RECORD.deviceId,
        purchasePrice: 1000,
        purchaseDate: "2024-01-01",
        usefulLifeYears: 5,
      });

      expect(mockedApi.post).toHaveBeenCalledWith(BASE, {
        deviceId: RECORD.deviceId,
        purchasePrice: 1000,
        purchaseDate: "2024-01-01",
        usefulLifeYears: 5,
      });
      // The old fabricated contract fields must not reappear.
      const body = mockedApi.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("name");
      expect(body).not.toHaveProperty("type");
      expect(body).not.toHaveProperty("currency");
    });
  });

  describe("update", () => {
    it("uses PATCH — there is no PUT route", async () => {
      mockedApi.patch.mockResolvedValueOnce(envelope(RECORD));

      await financeService.update("1", { purchasePrice: 2000 });

      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/1`, {
        purchasePrice: 2000,
      });
      expect(mockedApi.put).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("deletes by id", async () => {
      mockedApi.delete.mockResolvedValueOnce(envelope(null));

      await financeService.delete("1");

      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/1`);
    });
  });

  describe("getDepreciationReport", () => {
    it("sends no params when asOf is omitted", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({ asOf: "2026-07-17", totals: {}, count: 0, rows: [] }),
      );

      await financeService.getDepreciationReport();

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/reports/depreciation`, {
        params: {},
      });
    });

    it("sends asOf — the only filter the backend reads", async () => {
      mockedApi.get.mockResolvedValueOnce(
        envelope({
          asOf: "2026-07-01T00:00:00.000Z",
          totals: {
            totalPurchase: 1000,
            totalAccumulatedDepreciation: 360,
            totalBookValue: 640,
            fullyDepreciatedCount: 0,
          },
          count: 1,
          rows: [],
        }),
      );

      const res = await financeService.getDepreciationReport("2026-07-01");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/reports/depreciation`, {
        params: { asOf: "2026-07-01" },
      });
      expect(res.totals.totalBookValue).toBe(640);
    });
  });

  describe("exportDepreciationCsv", () => {
    it("requests raw CSV text", async () => {
      mockedApi.get.mockResolvedValueOnce("Device,Purchase Price\nPump,1000");

      const csv = await financeService.exportDepreciationCsv("2026-07-01");

      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/reports/depreciation`, {
        params: { asOf: "2026-07-01", format: "csv" },
        responseType: "text",
      });
      expect(csv).toContain("Device");
    });
  });
});
