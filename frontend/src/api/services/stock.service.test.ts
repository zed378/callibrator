import { stockService } from "./stock.service";
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

const paged = <T,>(data: T[]) => ({
  success: true,
  data,
  meta: { total: data.length, page: 1, limit: 20, totalPages: 1 },
});

const BASE = "/api/v1/stocks";

describe("stockService", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("getAll", () => {
    it("passes params and maps success/data/meta", async () => {
      const backend = paged([{ id: "st1" }]);
      mockedApi.get.mockResolvedValueOnce(backend);

      const params = { page: 1, limit: 20, warehouseId: "w1" };
      const res = await stockService.getAll(params);

      expect(mockedApi.get).toHaveBeenCalledWith(BASE, { params });
      expect(res).toEqual({
        success: true,
        data: backend.data,
        meta: backend.meta,
      });
    });
  });

  describe("getById", () => {
    it("unwraps data", async () => {
      mockedApi.get.mockResolvedValueOnce({ success: true, data: { id: "st1" } });
      const res = await stockService.getById("st1");
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/st1`);
      expect(res).toEqual({ id: "st1" });
    });
  });

  describe("create", () => {
    it("POSTs the body and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({ success: true, data: { id: "st1" } });
      const input = { itemName: "Gauge", quantity: 5 } as never;
      const res = await stockService.create(input);
      expect(mockedApi.post).toHaveBeenCalledWith(BASE, input);
      expect(res).toEqual({ id: "st1" });
    });
  });

  describe("update", () => {
    it("PATCHes a partial by id", async () => {
      mockedApi.patch.mockResolvedValueOnce({ success: true, data: { id: "st1" } });
      const res = await stockService.update("st1", { quantity: 9 } as never);
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/st1`, { quantity: 9 });
      expect(res).toEqual({ id: "st1" });
    });
  });

  describe("delete", () => {
    it("deletes by id and returns void", async () => {
      mockedApi.delete.mockResolvedValueOnce(undefined);
      const res = await stockService.delete("st1");
      expect(mockedApi.delete).toHaveBeenCalledWith(`${BASE}/st1`);
      expect(res).toBeUndefined();
    });
  });

  describe("createAdjustment", () => {
    it("POSTs to the adjustment path and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({ success: true, data: { id: "a1" } });
      const data = {
        stockId: "st1",
        type: "addition" as const,
        quantity: 3,
        reason: "found",
      };
      const res = await stockService.createAdjustment(data);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/adjustment`, data);
      expect(res).toEqual({ id: "a1" });
    });
  });

  describe("getAdjustments", () => {
    it("GETs adjustment history with params and maps the page", async () => {
      const backend = paged([{ id: "a1" }]);
      mockedApi.get.mockResolvedValueOnce(backend);
      const params = { page: 1, type: "addition" as const };
      const res = await stockService.getAdjustments(params);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/adjustment/history`, {
        params,
      });
      expect(res).toEqual({
        success: true,
        data: backend.data,
        meta: backend.meta,
      });
    });
  });

  describe("createTransfer", () => {
    it("POSTs to the transfer path and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({ success: true, data: { id: "t1" } });
      const data = {
        fromWarehouseId: "w1",
        toWarehouseId: "w2",
        itemName: "Gauge",
        quantity: 2,
      };
      const res = await stockService.createTransfer(data);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/transfer`, data);
      expect(res).toEqual({ id: "t1" });
    });
  });

  describe("updateTransferStatus", () => {
    it("PATCHes the transfer status by id", async () => {
      mockedApi.patch.mockResolvedValueOnce({ success: true, data: { id: "t1" } });
      const res = await stockService.updateTransferStatus("t1", "completed");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/transfer/t1`, {
        status: "completed",
      });
      expect(res).toEqual({ id: "t1" });
    });
  });

  describe("getTransfers", () => {
    it("GETs transfer history with params and maps the page", async () => {
      const backend = paged([{ id: "t1" }]);
      mockedApi.get.mockResolvedValueOnce(backend);
      const params = { status: "pending" as const };
      const res = await stockService.getTransfers(params);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/transfer/history`, {
        params,
      });
      expect(res).toEqual({
        success: true,
        data: backend.data,
        meta: backend.meta,
      });
    });
  });

  describe("createOpname", () => {
    it("POSTs to the opname path and unwraps data", async () => {
      mockedApi.post.mockResolvedValueOnce({ success: true, data: { id: "o1" } });
      const data = { warehouseId: "w1", scheduledAt: "2026-01-01" };
      const res = await stockService.createOpname(data);
      expect(mockedApi.post).toHaveBeenCalledWith(`${BASE}/opname`, data);
      expect(res).toEqual({ id: "o1" });
    });
  });

  describe("updateOpnameStatus", () => {
    it("PATCHes the opname status by id", async () => {
      mockedApi.patch.mockResolvedValueOnce({ success: true, data: { id: "o1" } });
      const res = await stockService.updateOpnameStatus("o1", "completed");
      expect(mockedApi.patch).toHaveBeenCalledWith(`${BASE}/opname/o1`, {
        status: "completed",
      });
      expect(res).toEqual({ id: "o1" });
    });
  });

  describe("getOpnames", () => {
    it("GETs opname history with params and maps the page", async () => {
      const backend = paged([{ id: "o1" }]);
      mockedApi.get.mockResolvedValueOnce(backend);
      const params = { warehouseId: "w1" };
      const res = await stockService.getOpnames(params);
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/opname/history`, {
        params,
      });
      expect(res).toEqual({
        success: true,
        data: backend.data,
        meta: backend.meta,
      });
    });
  });

  describe("getInventoryReportSummary", () => {
    it("GETs the summary and unwraps data", async () => {
      const summary = {
        totalItems: 10,
        totalUnits: 100,
        lowStockCount: 2,
        warehouseDistribution: [],
      };
      mockedApi.get.mockResolvedValueOnce({ success: true, data: summary });
      const res = await stockService.getInventoryReportSummary();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/reports/summary`);
      expect(res).toEqual(summary);
    });
  });

  describe("exportInventoryCsv", () => {
    it("GETs the export as text and returns the raw string", async () => {
      mockedApi.get.mockResolvedValueOnce("a,b,c\n1,2,3");
      const res = await stockService.exportInventoryCsv();
      expect(mockedApi.get).toHaveBeenCalledWith(`${BASE}/reports/export`, {
        responseType: "text",
      });
      expect(res).toBe("a,b,c\n1,2,3");
    });
  });
});
