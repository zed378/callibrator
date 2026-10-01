/**
 * useDevices — filters reaching the list request, who may write, the
 * create/edit payload (blank optionals become undefined, dates trimmed to
 * yyyy-mm-dd), refused writes keeping the modal/confirm open (F-64), and the
 * CSV import. The real deviceStore and warehouseStore run; deviceService and
 * warehouseService are mocked with the shapes they return (getAll a
 * PaginatedResponse, bulkImport the envelope's `data`).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const deviceService = { getAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), bulkImport: jest.fn() };
const warehouseService = { getAll: jest.fn() };
jest.mock("@/api/services/device.service", () => ({ deviceService }));
jest.mock("@/api/services/warehouse.service", () => ({ warehouseService }));

import { useDevices } from "../useDevices";
import { useDeviceStore } from "@/stores/deviceStore";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import type { Device } from "@/api/services/device.service";
import type { User } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const pump = {
  id: "d1", name: "Infusion pump", serialNumber: "SN1", manufacturer: "B", model: "M1", category: "ICU",
  status: "active", locationId: "l1", installationDate: "2025-01-02T00:00:00.000Z",
  nextCalibrationDate: "2026-12-01T00:00:00.000Z", calibrationIntervalDays: 365, remarks: "ok",
} as unknown as Device;
const page = <T,>(rows: T[]) => ({ success: true, message: "ok", data: rows, meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 } });
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
const change = (value: string) => ({ target: { value } }) as React.ChangeEvent<HTMLInputElement>;
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
// ADR-102: write actions follow the caller's EFFECTIVE permission on the
// hook's API slug (GET /menu-groups/my-permissions), never a role name.
const grant = (effectivePermissions: Effective) => useMenuStore.setState({ effectivePermissions });
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", tenantId: "t1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  useDeviceStore.setState({ devices: null, isLoading: false, error: null });
  useWarehouseStore.setState({ warehouses: null, isLoading: false, error: null });
  deviceService.getAll.mockResolvedValue(page([pump]));
  warehouseService.getAll.mockResolvedValue(page([{ id: "w1", name: "Main" }]));
  signIn("HEALTHCARE ADMIN");
  grant({ superAdmin: false, permissions: { calibration: "write" } });
});

const setup = async () => {
  const hook = renderHook(() => useDevices());
  await waitFor(() => expect(hook.result.current.devices?.data).toEqual([pump]));
  await waitFor(() => expect(hook.result.current.warehouses?.data).toHaveLength(1));
  return hook;
};

describe("useDevices", () => {
  it("loads the first page and the warehouses; filters go back to page 1", async () => {
    const { result } = await setup();
    expect(deviceService.getAll).toHaveBeenCalledWith(1, 10, undefined, undefined, undefined);
    expect(warehouseService.getAll).toHaveBeenCalledWith(1, 100, undefined);
    act(() => result.current.setCurrentPage(3));
    act(() => result.current.handleSearchChange(change("pump")));
    expect(result.current.currentPage).toBe(1);
    act(() => result.current.handleStatusChange("inactive"));
    act(() => result.current.handleCategoryChange(change("ICU")));
    await waitFor(() => expect(deviceService.getAll).toHaveBeenLastCalledWith(1, 10, "pump", "inactive", "ICU"));
  });

  it.each<[string, Effective, boolean]>([
    ["superAdmin", { superAdmin: true, permissions: {} }, true],
    ["write on calibration", { superAdmin: false, permissions: { calibration: "write" } }, true],
    ["read on calibration", { superAdmin: false, permissions: { calibration: "read" } }, false],
    ["write on another slug only", { superAdmin: false, permissions: { other: "write" } }, false],
    ["permissions not loaded (null)", null, false],
  ])("write access: %s → %s", async (_label, effective, may) => {
    grant(effective);
    const { result } = await setup();
    expect(result.current.hasWriteAccess).toBe(may);
  });

  it("a failed list load is the store's error", async () => {
    deviceService.getAll.mockRejectedValue(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useDevices());
    await waitFor(() => expect(result.current.devicesError).toBe("Forbidden"));
  });

  it("create sends blank optionals as undefined, closes the modal and reloads", async () => {
    deviceService.create.mockResolvedValue({ ...pump, id: "d2" });
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    expect(result.current.modalType).toBe("create");
    act(() => result.current.setForm((f) => ({ ...f, name: "Monitor", calibrationIntervalDays: 0 })));
    const loads = deviceService.getAll.mock.calls.length;
    await act(async () => result.current.handleFormSubmit(ev));
    expect(deviceService.create).toHaveBeenCalledWith({
      name: "Monitor", serialNumber: "", manufacturer: "", model: "", category: "", status: "active",
      locationId: undefined, installationDate: undefined, nextCalibrationDate: undefined,
      calibrationIntervalDays: undefined, remarks: "",
    });
    expect(result.current.isDeviceModalOpen).toBe(false);
    await waitFor(() => expect(deviceService.getAll.mock.calls.length).toBe(loads + 1));
  });

  it("a refused create keeps the modal open with the backend message", async () => {
    deviceService.create.mockRejectedValueOnce(httpError(409, "Serial number already registered"));
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setForm((f) => ({ ...f, name: "Dup", serialNumber: "SN1" })));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(result.current.isDeviceModalOpen).toBe(true);
    expect(result.current.devicesError).toBe("Serial number already registered");
  });

  it("edit prefills with date-only values and updates by id", async () => {
    deviceService.update.mockResolvedValue(pump);
    const { result } = await setup();
    act(() => result.current.openEditModal(pump));
    expect(result.current.modalType).toBe("edit");
    expect(result.current.selectedDevice).toBe(pump);
    expect(result.current.form).toMatchObject({
      installationDate: "2025-01-02", nextCalibrationDate: "2026-12-01", calibrationIntervalDays: 365, locationId: "l1",
    });
    await act(async () => result.current.handleFormSubmit(ev));
    expect(deviceService.update).toHaveBeenCalledWith(expect.objectContaining({
      id: "d1", name: "Infusion pump", installationDate: "2025-01-02", calibrationIntervalDays: 365,
    }));
    expect(result.current.isDeviceModalOpen).toBe(false);
  });

  it("a device with no optional fields prefills blanks and the default interval", async () => {
    const { result } = await setup();
    act(() => result.current.openEditModal({ id: "d9", name: "Bare", status: "inactive" } as unknown as Device));
    expect(result.current.form).toEqual({
      name: "Bare", serialNumber: "", manufacturer: "", model: "", category: "", status: "inactive",
      locationId: "", installationDate: "", nextCalibrationDate: "", calibrationIntervalDays: 180, remarks: "",
    });
  });

  it("delete needs a chosen device; a refusal keeps the confirm open (F-64)", async () => {
    const { result } = await setup();
    await act(async () => result.current.confirmDelete());
    expect(deviceService.delete).not.toHaveBeenCalled();

    act(() => result.current.handleDeleteClick("d1"));
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    deviceService.delete.mockRejectedValueOnce(httpError(409, "Device has open work orders"));
    await act(async () => result.current.confirmDelete());
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    expect(result.current.devicesError).toBe("Device has open work orders");

    deviceService.delete.mockResolvedValueOnce(undefined);
    await act(async () => result.current.confirmDelete());
    expect(deviceService.delete).toHaveBeenLastCalledWith("d1");
    expect(result.current.isDeleteConfirmOpen).toBe(false);
    await waitFor(() => expect(result.current.isDevicesLoading).toBe(false));
  });

  it("a CSV import shows the per-row result and reloads; a failure is the error", async () => {
    const result1 = { successCount: 2, failedCount: 1, totalCount: 3, errors: [{ row: 3, errors: "name is required" }] };
    deviceService.bulkImport.mockResolvedValueOnce(result1);
    const { result } = await setup();
    const csv = new File(["name\nA"], "devices.csv", { type: "text/csv" });
    await act(async () => result.current.handleImportFile(csv));
    expect(deviceService.bulkImport).toHaveBeenCalledWith(csv);
    expect(result.current.importResult).toEqual(result1);
    expect(result.current.isImporting).toBe(false);
    act(() => result.current.clearImportResult());
    expect(result.current.importResult).toBeNull();

    deviceService.bulkImport.mockRejectedValueOnce(httpError(413, "File too large"));
    await act(async () => result.current.handleImportFile(csv));
    expect(result.current.devicesError).toBe("File too large");
    deviceService.bulkImport.mockRejectedValueOnce("x");
    await act(async () => result.current.handleImportFile(csv));
    expect(result.current.devicesError).toBe("CSV import failed");
    await waitFor(() => expect(result.current.isDevicesLoading).toBe(false));
  });
});
