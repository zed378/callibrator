/**
 * stockStore — the data-store error contract (src/tests/support/storeContract.ts)
 * for every stock action: reads store their page and never throw; writes
 * (create/update/delete, adjustments, transfers, opnames) rethrow so the
 * stock screen can say the write failed.
 */
const stockService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  createAdjustment: jest.fn(), getAdjustments: jest.fn(),
  createTransfer: jest.fn(), updateTransferStatus: jest.fn(), getTransfers: jest.fn(),
  createOpname: jest.fn(), updateOpnameStatus: jest.fn(), getOpnames: jest.fn(),
  getInventoryReportSummary: jest.fn(),
};
jest.mock("@/api/services/stock.service", () => ({ stockService }));

import type { StoreApi, UseBoundStore } from "zustand";
import { describeStoreContract } from "@/tests/support/storeContract";
import { useStockStore } from "../stockStore";

type AnyStore = UseBoundStore<StoreApi<Record<string, unknown>>>;
const page = { success: true, message: "", data: [{ id: "s1" }], meta: { page: 1, limit: 10, totalPages: 1, total: 1 } };
const summary = { totalItems: 3, totalUnits: 40, lowStockCount: 1, warehouseDistribution: [] };

const initial = {
  stocks: null, transfers: null, adjustments: null, opnames: null,
  currentStock: null, reportSummary: null, isLoading: false, error: null,
};

describeStoreContract("stockStore", useStockStore as unknown as AnyStore, stockService, initial, [
  { action: "fetchReportSummary", args: [], method: "getInventoryReportSummary", resolved: summary, stateKey: "reportSummary", rethrows: false, fallback: "Failed to fetch report summary" },
  { action: "fetchStocks", args: [{ page: 2, limit: 5, find: "glove", warehouseId: "w1" }], method: "getAll", resolved: page, stateKey: "stocks", rethrows: false, fallback: "Failed to fetch stocks" },
  { action: "fetchStockById", args: ["s1"], method: "getById", resolved: { id: "s1" }, stateKey: "currentStock", rethrows: false, fallback: "Failed to fetch stock details" },
  { action: "createStock", args: [{ itemName: "Glove", quantity: 5 }], method: "create", resolved: { id: "s2" }, rethrows: true, fallback: "Failed to create stock item" },
  { action: "updateStock", args: ["s1", { quantity: 9 }], method: "update", resolved: { id: "s1", quantity: 9 }, stateKey: "currentStock", rethrows: true, fallback: "Failed to update stock item" },
  { action: "deleteStock", args: ["s1"], method: "delete", rethrows: true, fallback: "Failed to delete stock item" },
  { action: "createAdjustment", args: [{ stockId: "s1", type: "write_off", quantity: 1, reason: "expired" }], method: "createAdjustment", resolved: { id: "a1" }, rethrows: true, fallback: "Failed to submit stock adjustment" },
  { action: "fetchAdjustments", args: [{ page: 1, type: "addition" }], method: "getAdjustments", resolved: page, stateKey: "adjustments", rethrows: false, fallback: "Failed to fetch stock adjustments" },
  { action: "createTransfer", args: [{ fromWarehouseId: "w1", toWarehouseId: "w2", itemName: "Glove", quantity: 2 }], method: "createTransfer", resolved: { id: "t1" }, rethrows: true, fallback: "Failed to initiate stock transfer" },
  { action: "updateTransferStatus", args: ["t1", "completed"], method: "updateTransferStatus", resolved: { id: "t1", status: "completed" }, rethrows: true, fallback: "Failed to update transfer status" },
  { action: "fetchTransfers", args: [{ status: "pending" }], method: "getTransfers", resolved: page, stateKey: "transfers", rethrows: false, fallback: "Failed to fetch transfers" },
  { action: "createOpname", args: [{ warehouseId: "w1", scheduledAt: "2026-10-01" }], method: "createOpname", resolved: { id: "o1" }, rethrows: true, fallback: "Failed to schedule stock opname" },
  { action: "updateOpnameStatus", args: ["o1", "in_progress"], method: "updateOpnameStatus", resolved: { id: "o1", status: "in_progress" }, rethrows: true, fallback: "Failed to update opname status" },
  { action: "fetchOpnames", args: [{ warehouseId: "w1" }], method: "getOpnames", resolved: page, stateKey: "opnames", rethrows: false, fallback: "Failed to fetch stock opnames" },
]);

describe("stockStore — loading and error flags", () => {
  beforeEach(() => useStockStore.setState(initial));

  it("is loading while a read is in flight, and a new request clears the previous error", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    stockService.getAll.mockReturnValue(new Promise((r) => { resolve = r; }));
    useStockStore.setState({ error: "old failure" });

    const pending = useStockStore.getState().fetchStocks({ page: 1 });
    expect(useStockStore.getState()).toMatchObject({ isLoading: true, error: null });

    resolve(page);
    await pending;
    expect(useStockStore.getState()).toMatchObject({ isLoading: false, stocks: page });
  });

  it("a failed read keeps the rows it already had (the screen shows the error over them)", async () => {
    useStockStore.setState({ stocks: page as unknown as ReturnType<typeof useStockStore.getState>["stocks"] });
    stockService.getAll.mockRejectedValue(new Error("Request failed with status code 429"));

    await useStockStore.getState().fetchStocks({ page: 2 });

    expect(useStockStore.getState()).toMatchObject({ stocks: page, error: "Request failed with status code 429" });
  });

  it("setError sets and clears the message", () => {
    useStockStore.getState().setError("x");
    expect(useStockStore.getState().error).toBe("x");
    useStockStore.getState().setError(null);
    expect(useStockStore.getState().error).toBeNull();
  });
});
