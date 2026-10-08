/**
 * useStock — the inventory screen: which list each tab loads and with which
 * filters, who may write, the stock / adjustment / transfer / opname
 * payloads (P6-09: an edit never sends `quantity`), refused writes keeping
 * their modal open with the backend's message, and the CSV exports.
 * The real stockStore and warehouseStore run; stockService and
 * warehouseService are mocked with the shapes they return (lists a
 * PaginatedResponse, writes the entity, exportInventoryCsv the CSV text).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const stockService = {
  getAll: jest.fn(), create: jest.fn(), update: jest.fn(),
  createAdjustment: jest.fn(), getAdjustments: jest.fn(),
  createTransfer: jest.fn(), updateTransferStatus: jest.fn(), getTransfers: jest.fn(),
  createOpname: jest.fn(), updateOpnameStatus: jest.fn(), getOpnames: jest.fn(),
  getInventoryReportSummary: jest.fn(), exportInventoryCsv: jest.fn(),
};
const warehouseService = { getAll: jest.fn(), getLocations: jest.fn() };
jest.mock("@/api/services/stock.service", () => ({ stockService }));
jest.mock("@/api/services/warehouse.service", () => ({ warehouseService }));

import { localDateInputValue, useStock } from "../useStock";
import { useStockStore } from "@/stores/stockStore";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import type { Stock, User } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const page = <T,>(rows: T[]) => ({ success: true, message: "ok", data: rows, meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 } });
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
// ADR-102: write actions follow the caller's EFFECTIVE permission on the
// hook's API slug (GET /menu-groups/my-permissions), never a role name.
const grant = (effectivePermissions: Effective) => useMenuStore.setState({ effectivePermissions });
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", tenantId: "t1", role: { name: role } } as unknown as User });

const gloves = {
  id: "s1", warehouseId: "w1", locationId: null, itemName: "Gloves", sku: null, serialNumber: null,
  quantity: 40, minQuantity: 10, description: null,
} as unknown as Stock;
const transfer = {
  id: "x1", itemName: 'Probe "X"', quantity: 2, status: "completed", createdAt: "2026-09-01",
  fromWarehouse: { name: "Main" }, toWarehouse: { name: "ICU" },
  requester: { firstName: "Siti", lastName: "A" }, approver: null,
};

let lastBlob: Blob | null = null;
// jsdom's Blob has no text(); FileReader reads it.
const csvText = () =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(lastBlob as Blob);
  });
let clickSpy: jest.SpyInstance;

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (b: Blob) => {
      lastBlob = b;
      return "blob:csv";
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  lastBlob = null;
  clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  useStockStore.setState({ stocks: null, transfers: null, adjustments: null, opnames: null, reportSummary: null, isLoading: false, error: null });
  useWarehouseStore.setState({ warehouses: null, locations: [], isLoading: false, error: null });
  signIn("WAREHOUSE STAFF");
  grant({ superAdmin: false, permissions: { warehouse: "write" } });
  warehouseService.getAll.mockResolvedValue(page([{ id: "w1", name: "Main" }, { id: "w2", name: "ICU" }]));
  warehouseService.getLocations.mockResolvedValue([{ id: "l1", name: "Shelf A" }]);
  stockService.getAll.mockResolvedValue(page([gloves]));
  stockService.getTransfers.mockResolvedValue(page([transfer]));
  stockService.getAdjustments.mockResolvedValue(page([]));
  stockService.getOpnames.mockResolvedValue(page([]));
  stockService.getInventoryReportSummary.mockResolvedValue({ totalItems: 1 });
});
afterEach(() => clickSpy.mockRestore());

const setup = async () => {
  const hook = renderHook(() => useStock());
  await waitFor(() => expect(hook.result.current.stocks?.data).toEqual([gloves]));
  await waitFor(() => expect(hook.result.current.warehouses?.data).toHaveLength(2));
  return hook;
};

describe("localDateInputValue (F-19)", () => {
  it("is the LOCAL calendar date as YYYY-MM-DD, zero-padded", () => {
    // 23:59 local on 5 January — toISOString() would roll to the 6th (or
    // stay on the 5th) depending on the zone; the local date never does.
    expect(localDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDateInputValue(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });
});

describe("useStock", () => {
  it("loads warehouses and the inventory tab; search goes back to page 1", async () => {
    const { result } = await setup();
    expect(warehouseService.getAll).toHaveBeenCalledWith(1, 100, undefined);
    expect(stockService.getAll).toHaveBeenCalledWith({ page: 1, limit: 10, find: "", warehouseId: undefined, locationId: undefined });
    expect(result.current.hasWriteAccess).toBe(true);
    act(() => result.current.setCurrentPage(3));
    act(() => result.current.handleSearchChange({ target: { value: "glo" } } as React.ChangeEvent<HTMLInputElement>));
    expect(result.current.currentPage).toBe(1);
    await waitFor(() => expect(stockService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ find: "glo", page: 1 })));
  });

  it("a warehouse filter loads its locations and clears the chosen location", async () => {
    const { result } = await setup();
    act(() => result.current.setSelectedLocationId("l9"));
    act(() => result.current.handleWarehouseFilterChange("w2"));
    expect(result.current.selectedLocationId).toBe("");
    await waitFor(() => expect(warehouseService.getLocations).toHaveBeenCalledWith("w2"));
    act(() => result.current.setSelectedLocationId("l1"));
    await waitFor(() =>
      expect(stockService.getAll).toHaveBeenLastCalledWith({ page: 1, limit: 10, find: "", warehouseId: "w2", locationId: "l1" }),
    );
  });

  it("each tab loads its own list, filtered by the chosen warehouse", async () => {
    const { result } = await setup();
    act(() => result.current.handleWarehouseFilterChange("w1"));
    act(() => result.current.handleTabChange("transfers"));
    await waitFor(() => expect(stockService.getTransfers).toHaveBeenCalledWith({ page: 1, limit: 10, fromWarehouseId: "w1" }));
    act(() => result.current.handleTabChange("adjustments"));
    await waitFor(() => expect(stockService.getAdjustments).toHaveBeenCalledWith({ page: 1, limit: 10, warehouseId: "w1" }));
    act(() => result.current.handleTabChange("opnames"));
    await waitFor(() => expect(stockService.getOpnames).toHaveBeenCalledWith({ page: 1, limit: 10, warehouseId: "w1" }));
    act(() => result.current.handleTabChange("reports"));
    await waitFor(() => expect(result.current.reportSummary).toEqual({ totalItems: 1 }));
    expect(result.current.activeTab).toBe("reports");
  });

  it.each<[string, Effective, boolean]>([
    ["superAdmin", { superAdmin: true, permissions: {} }, true],
    ["write on warehouse", { superAdmin: false, permissions: { warehouse: "write" } }, true],
    ["read on warehouse", { superAdmin: false, permissions: { warehouse: "read" } }, false],
    ["write on another slug only", { superAdmin: false, permissions: { calibration: "write" } }, false],
    ["permissions not loaded (null)", null, false],
  ])("write access: %s → %s", async (_label, effective, may) => {
    grant(effective);
    const { result } = await setup();
    expect(result.current.hasWriteAccess).toBe(may);
  });

  it("a read-only caller may not write; a failed list load is the store's error", async () => {
    grant({ superAdmin: false, permissions: { warehouse: "read" } });
    stockService.getAll.mockRejectedValue(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useStock());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.hasWriteAccess).toBe(false);
    act(() => result.current.handleTabChange("transfers"));
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("create defaults to the first warehouse and sends blank optionals as null", async () => {
    stockService.create.mockResolvedValue({ ...gloves, id: "s2" });
    const { result } = await setup();
    act(() => result.current.openCreateStock());
    expect(result.current.stockForm.warehouseId).toBe("w1");
    act(() => result.current.setStockForm((f) => ({ ...f, itemName: "Masks", quantity: 5, minQuantity: 2 })));
    await act(async () => result.current.handleStockSubmit(ev));
    expect(stockService.create).toHaveBeenCalledWith({
      warehouseId: "w1", locationId: null, itemName: "Masks", sku: null, serialNumber: null,
      quantity: 5, minQuantity: 2, description: null,
    });
    expect(result.current.isStockModalOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("an edit never sends quantity (P6-09); a refusal keeps the modal with the reason", async () => {
    const { result } = await setup();
    act(() => result.current.openEditStock(gloves));
    expect(result.current.stockModalType).toBe("edit");
    expect(result.current.stockForm).toMatchObject({ itemName: "Gloves", sku: "", locationId: "", quantity: 40 });
    act(() => result.current.setStockForm((f) => ({ ...f, quantity: 999, minQuantity: 12, sku: "GL-1" })));
    stockService.update.mockRejectedValueOnce(httpError(409, "Quantity changes go through an adjustment"));
    await act(async () => result.current.handleStockSubmit(ev));
    expect(result.current.isStockModalOpen).toBe(true);
    // F-19: the reason is shown in the open dialog, not the page alert behind it.
    expect(result.current.dialogError).toBe("Quantity changes go through an adjustment");
    expect(result.current.error).toBeNull();

    stockService.update.mockResolvedValueOnce(gloves);
    await act(async () => result.current.handleStockSubmit(ev));
    expect(stockService.update).toHaveBeenLastCalledWith("s1", {
      itemName: "Gloves", sku: "GL-1", serialNumber: null, minQuantity: 12, description: null,
    });
    expect(result.current.isStockModalOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("an adjustment is sent for the chosen stock; a refusal keeps the modal open", async () => {
    const { result } = await setup();
    act(() => result.current.openAdjustment(gloves));
    expect(result.current.adjustmentForm).toEqual({ stockId: "s1", type: "addition", quantity: 1, reason: "" });
    act(() => result.current.setAdjustmentForm((f) => ({ ...f, type: "subtraction", quantity: 50, reason: "expired" })));
    stockService.createAdjustment.mockRejectedValueOnce(httpError(409, "Insufficient stock: 40 on hand"));
    await act(async () => result.current.handleAdjustmentSubmit(ev));
    expect(result.current.isAdjustmentModalOpen).toBe(true);
    expect(result.current.dialogError).toBe("Insufficient stock: 40 on hand");
    expect(result.current.error).toBeNull();

    stockService.createAdjustment.mockResolvedValueOnce({ id: "a1" });
    await act(async () => result.current.handleAdjustmentSubmit(ev));
    expect(stockService.createAdjustment).toHaveBeenLastCalledWith({ stockId: "s1", type: "subtraction", quantity: 50, reason: "expired" });
    expect(result.current.isAdjustmentModalOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("F-19: a dialog's refusal does not follow the user into the next dialog", async () => {
    const { result } = await setup();
    act(() => result.current.openAdjustment(gloves));
    stockService.createAdjustment.mockRejectedValueOnce(httpError(409, "Insufficient stock: 40 on hand"));
    await act(async () => result.current.handleAdjustmentSubmit(ev));
    expect(result.current.dialogError).toBe("Insufficient stock: 40 on hand");
    act(() => result.current.setIsAdjustmentModalOpen(false));
    act(() => result.current.openTransfer(gloves));
    expect(result.current.dialogError).toBeNull();
  });

  it("a transfer starts from the stock's warehouse or the filter; its submit and status changes", async () => {
    const { result } = await setup();
    act(() => result.current.openTransfer(gloves));
    expect(result.current.transferForm).toEqual({ fromWarehouseId: "w1", toWarehouseId: "", itemName: "Gloves", quantity: 1, notes: "" });
    act(() => result.current.handleWarehouseFilterChange("w2"));
    act(() => result.current.openTransfer());
    expect(result.current.transferForm).toMatchObject({ fromWarehouseId: "w2", itemName: "" });

    act(() => result.current.setTransferForm((f) => ({ ...f, toWarehouseId: "w1", itemName: "Gloves", quantity: 3 })));
    stockService.createTransfer.mockRejectedValueOnce(httpError(400, "Source and destination must differ"));
    await act(async () => result.current.handleTransferSubmit(ev));
    expect(result.current.isTransferModalOpen).toBe(true);
    expect(result.current.dialogError).toBe("Source and destination must differ");
    stockService.createTransfer.mockResolvedValueOnce({ id: "x2" });
    await act(async () => result.current.handleTransferSubmit(ev));
    expect(stockService.createTransfer).toHaveBeenLastCalledWith({ fromWarehouseId: "w2", toWarehouseId: "w1", itemName: "Gloves", quantity: 3, notes: "" });
    expect(result.current.isTransferModalOpen).toBe(false);

    stockService.updateTransferStatus.mockRejectedValueOnce(
      httpError(409, 'This transfer is "completed" and cannot move to "cancelled"'),
    );
    await act(async () => result.current.handleUpdateTransferStatus("x1", "cancelled"));
    expect(result.current.error).toBe('This transfer is "completed" and cannot move to "cancelled"');
    stockService.updateTransferStatus.mockResolvedValueOnce({ id: "x1" });
    await act(async () => result.current.handleUpdateTransferStatus("x1", "in_transit"));
    expect(stockService.updateTransferStatus).toHaveBeenLastCalledWith("x1", "in_transit");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("an opname defaults to today's date and sends the picked date as ISO YYYY-MM-DD; status changes surface refusals", async () => {
    const { result } = await setup();
    act(() => result.current.openOpname());
    expect(result.current.opnameForm.warehouseId).toBe("w1");
    // F-19: a value <input type="date"> can show — never a "…THH:mm" datetime.
    expect(result.current.opnameForm.scheduledAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.opnameForm.scheduledAt).toBe(localDateInputValue());
    act(() => result.current.setOpnameForm({ warehouseId: "w2", scheduledAt: "2026-10-01", notes: "Q4" }));
    stockService.createOpname.mockRejectedValueOnce(httpError(409, "An opname is already open for this warehouse"));
    await act(async () => result.current.handleOpnameSubmit(ev));
    expect(result.current.isOpnameModalOpen).toBe(true);
    expect(result.current.dialogError).toBe("An opname is already open for this warehouse");
    expect(result.current.error).toBeNull();

    stockService.createOpname.mockResolvedValueOnce({ id: "o1" });
    await act(async () => result.current.handleOpnameSubmit(ev));
    // createOpnameSchema.scheduledAt is isoDate() (packages/contracts
    // fields.ts): an ISO date is accepted as that day.
    expect(stockService.createOpname).toHaveBeenLastCalledWith({
      warehouseId: "w2", scheduledAt: "2026-10-01", notes: "Q4",
    });
    expect(result.current.dialogError).toBeNull();
    expect(result.current.isOpnameModalOpen).toBe(false);

    stockService.updateOpnameStatus.mockRejectedValueOnce(httpError(409, "Only an in-progress opname can be completed"));
    await act(async () => result.current.handleUpdateOpnameStatus("o1", "completed"));
    expect(result.current.error).toBe("Only an in-progress opname can be completed");
    stockService.updateOpnameStatus.mockResolvedValueOnce({ id: "o1" });
    await act(async () => result.current.handleUpdateOpnameStatus("o1", "in_progress"));
    expect(stockService.updateOpnameStatus).toHaveBeenLastCalledWith("o1", "in_progress");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("the stock-level export downloads the backend's CSV", async () => {
    stockService.exportInventoryCsv.mockResolvedValueOnce("Item,Qty\nGloves,40");
    const { result } = await setup();
    await act(async () => result.current.handleExportStocks());
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(await csvText()).toBe("Item,Qty\nGloves,40");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("the transfer export quotes every cell and escapes embedded quotes", async () => {
    const { result } = await setup();
    await act(async () => result.current.handleExportTransfers());
    expect(stockService.getTransfers).toHaveBeenLastCalledWith({ limit: 1000 });
    const lines = (await csvText()).split("\n");
    expect(lines[0]).toBe("Item Name,Quantity,From Warehouse,To Warehouse,Status,Requested By,Approved By,Date Requested");
    expect(lines[1]).toBe('"Probe ""X""","2","Main","ICU","completed","Siti A","","2026-09-01"');
  });

  it("the adjustment and opname exports write one row per record", async () => {
    stockService.getAdjustments.mockResolvedValue(page([
      { warehouse: { name: "Main" }, type: "write_off", quantity: 3, reason: "broken", adjuster: { firstName: "Budi", lastName: "S" }, createdAt: "2026-09-02" },
      { warehouse: null, type: "addition", quantity: 1, reason: null, adjuster: null, createdAt: "2026-09-03" },
    ]));
    stockService.getOpnames.mockResolvedValue(page([
      { warehouse: { name: "ICU" }, status: "completed", scheduledAt: "2026-09-04", completedAt: "2026-09-05", notes: "ok" },
    ]));
    const { result } = await setup();
    await act(async () => result.current.handleExportAdjustments());
    expect((await csvText()).split("\n")).toEqual([
      "Warehouse,Adjustment Type,Quantity Delta,Reason,Performed By,Date Logged",
      '"Main","write_off","3","broken","Budi S","2026-09-02"',
      '"","addition","1","","","2026-09-03"',
    ]);
    await act(async () => result.current.handleExportOpnames());
    expect((await csvText()).split("\n")).toEqual([
      "Warehouse,Status,Scheduled At,Completed At,Notes",
      '"ICU","completed","2026-09-04","2026-09-05","ok"',
    ]);
  });

  it("a failed export is an error on the screen, never a download", async () => {
    const { result } = await setup();
    stockService.exportInventoryCsv.mockRejectedValueOnce(httpError(403, "Forbidden"));
    await act(async () => result.current.handleExportStocks());
    expect(result.current.error).toBe("Failed to export stock levels");
    stockService.getTransfers.mockRejectedValueOnce(httpError(429, "Too many requests"));
    await act(async () => result.current.handleExportTransfers());
    expect(result.current.error).toBe("Failed to export stock transfers");
    stockService.getAdjustments.mockRejectedValueOnce(new Error("Network Error"));
    await act(async () => result.current.handleExportAdjustments());
    expect(result.current.error).toBe("Failed to export stock adjustments");
    stockService.getOpnames.mockRejectedValueOnce(new Error("Network Error"));
    await act(async () => result.current.handleExportOpnames());
    expect(result.current.error).toBe("Failed to export stock audits");
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
