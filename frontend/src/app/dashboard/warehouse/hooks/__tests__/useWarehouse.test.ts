/**
 * useWarehouse — the warehouse list and its search, who may write, the
 * warehouse and storage-location create/edit payloads, and the shared delete
 * confirm (a refusal keeps it open with the backend message). The real
 * warehouseStore runs; warehouseService is mocked with the shapes it returns
 * (getAll a PaginatedResponse, getLocations an array, writes the entity).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const warehouseService = {
  getAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  getLocations: jest.fn(), createLocation: jest.fn(), updateLocation: jest.fn(), deleteLocation: jest.fn(),
};
jest.mock("@/api/services/warehouse.service", () => ({ warehouseService }));

import { useWarehouse } from "../useWarehouse";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import type { StorageLocation, User, Warehouse } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const main = { id: "w1", name: "Main", code: "WH-1", address: "Jl. A", description: "Central", status: "active" } as Warehouse;
const shelf = { id: "l1", warehouseId: "w1", name: "Shelf A", code: "A", description: null, isActive: false } as unknown as StorageLocation;
const listOf = (rows: Warehouse[]) => ({ success: true, message: "ok", data: rows, meta: { total: 21, page: 1, limit: 10, totalPages: 3 } });
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
// ADR-102: write actions follow the caller's EFFECTIVE permission on the
// hook's API slug (GET /menu-groups/my-permissions), never a role name.
const grant = (effectivePermissions: Effective) => useMenuStore.setState({ effectivePermissions });
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", tenantId: "t1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  useWarehouseStore.setState({ warehouses: null, locations: [], isLoading: false, error: null });
  warehouseService.getAll.mockResolvedValue(listOf([main]));
  warehouseService.getLocations.mockResolvedValue([shelf]);
  signIn("WAREHOUSE STAFF");
  grant({ superAdmin: false, permissions: { warehouse: "write" } });
});

const setup = async () => {
  const hook = renderHook(() => useWarehouse());
  await waitFor(() => expect(hook.result.current.warehouseList).toEqual([main]));
  return hook;
};

describe("useWarehouse", () => {
  it("lists warehouses with the backend's meta; search goes back to page 1", async () => {
    const { result } = await setup();
    expect(warehouseService.getAll).toHaveBeenCalledWith(1, 10, "");
    expect(result.current.meta.total).toBe(21);
    expect(result.current.hasWriteAccess).toBe(true);
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.handleSearchChange({ target: { value: "main" } } as React.ChangeEvent<HTMLInputElement>));
    expect(result.current.currentPage).toBe(1);
    await waitFor(() => expect(warehouseService.getAll).toHaveBeenLastCalledWith(1, 10, "main"));
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

  it("before the list arrives the meta is a safe default; read-only callers may not write", async () => {
    grant({ superAdmin: false, permissions: { warehouse: "read" } });
    warehouseService.getAll.mockRejectedValue(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useWarehouse());
    expect(result.current.meta).toEqual({ total: 0, page: 1, limit: 10, totalPages: 1 });
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.warehouseList).toEqual([]);
    expect(result.current.hasWriteAccess).toBe(false);
  });

  it("create sends the form and closes; a refusal keeps the modal open with the reason", async () => {
    const { result } = await setup();
    act(() => result.current.openCreateWarehouse());
    act(() => result.current.setWarehouseForm((f) => ({ ...f, name: "North", code: "WH-1" })));
    warehouseService.create.mockRejectedValueOnce(httpError(409, "Warehouse code already exists"));
    await act(async () => result.current.handleWarehouseSubmit(ev));
    expect(result.current.isWarehouseModalOpen).toBe(true);
    // F-19: shown in the warehouse dialog, not the page alert behind it.
    expect(result.current.warehouseDialogError).toBe("Warehouse code already exists");
    expect(result.current.error).toBeNull();

    warehouseService.create.mockResolvedValueOnce({ ...main, id: "w2" });
    act(() => result.current.setWarehouseForm((f) => ({ ...f, code: "WH-2" })));
    await act(async () => result.current.handleWarehouseSubmit(ev));
    expect(warehouseService.create).toHaveBeenLastCalledWith({
      name: "North", code: "WH-2", address: "", description: "", status: "active",
    });
    expect(result.current.isWarehouseModalOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("edit prefills and updates by id", async () => {
    warehouseService.update.mockResolvedValue(main);
    const { result } = await setup();
    act(() => result.current.openEditWarehouse({ ...main, address: undefined, description: undefined } as unknown as Warehouse));
    expect(result.current.warehouseForm).toEqual({ name: "Main", code: "WH-1", address: "", description: "", status: "active" });
    act(() => result.current.setWarehouseForm((f) => ({ ...f, status: "inactive" })));
    await act(async () => result.current.handleWarehouseSubmit(ev));
    expect(warehouseService.update).toHaveBeenCalledWith("w1", expect.objectContaining({ status: "inactive" }));
    expect(result.current.isWarehouseModalOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("the locations manager loads a warehouse's locations; create attaches the warehouse id", async () => {
    warehouseService.createLocation.mockResolvedValue({ ...shelf, id: "l2", name: "Shelf B" });
    const { result } = await setup();
    await act(async () => result.current.handleLocationSubmit(ev));
    expect(warehouseService.createLocation).not.toHaveBeenCalled();

    await act(async () => result.current.openLocationsManager(main));
    expect(warehouseService.getLocations).toHaveBeenCalledWith("w1");
    expect(result.current.isLocationsModalOpen).toBe(true);
    expect(result.current.locations).toEqual([shelf]);
    act(() => result.current.setLocationForm((f) => ({ ...f, name: "Shelf B", code: "B" })));
    await act(async () => result.current.handleLocationSubmit(ev));
    expect(warehouseService.createLocation).toHaveBeenCalledWith({
      name: "Shelf B", code: "B", description: "", isActive: true, warehouseId: "w1",
    });
    expect(result.current.locationForm.name).toBe("");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a location edit sends only its fields; a refusal keeps the form", async () => {
    const { result } = await setup();
    await act(async () => result.current.openLocationsManager(main));
    act(() => result.current.selectLocationForEdit(shelf));
    expect(result.current.locationFormType).toBe("edit");
    expect(result.current.locationForm).toEqual({ name: "Shelf A", code: "A", description: "", isActive: false });
    warehouseService.updateLocation.mockRejectedValueOnce(httpError(409, "Location code already exists"));
    await act(async () => result.current.handleLocationSubmit(ev));
    expect(result.current.locationsDialogError).toBe("Location code already exists");
    expect(result.current.deleteDialogError).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.locationFormType).toBe("edit");

    warehouseService.updateLocation.mockResolvedValueOnce({ ...shelf, isActive: true });
    act(() => result.current.setLocationForm((f) => ({ ...f, isActive: true })));
    await act(async () => result.current.handleLocationSubmit(ev));
    expect(warehouseService.updateLocation).toHaveBeenLastCalledWith("l1", {
      name: "Shelf A", code: "A", description: "", isActive: true,
    });
    expect(result.current.locationFormType).toBe("create");
    expect(result.current.selectedLocation).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("deleting a warehouse: a refusal keeps the confirm open; success closes it and reloads", async () => {
    const { result } = await setup();
    await act(async () => result.current.handleDeleteConfirm());
    expect(warehouseService.delete).not.toHaveBeenCalled();

    act(() => result.current.confirmDeleteWarehouse("w1"));
    expect(result.current.itemToDelete).toEqual({ id: "w1", type: "warehouse" });
    warehouseService.delete.mockRejectedValueOnce(httpError(409, "Warehouse still holds stock"));
    await act(async () => result.current.handleDeleteConfirm());
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    expect(result.current.deleteDialogError).toBe("Warehouse still holds stock");
    expect(result.current.warehouseDialogError).toBeNull();
    expect(result.current.error).toBeNull();

    warehouseService.delete.mockResolvedValueOnce(undefined);
    await act(async () => result.current.handleDeleteConfirm());
    expect(warehouseService.delete).toHaveBeenLastCalledWith("w1");
    expect(result.current.isDeleteConfirmOpen).toBe(false);
    expect(result.current.itemToDelete).toBeNull();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("deleting a location removes it from the open warehouse", async () => {
    warehouseService.deleteLocation.mockResolvedValue(undefined);
    const { result } = await setup();
    await act(async () => result.current.openLocationsManager(main));
    act(() => result.current.confirmDeleteLocation("l1"));
    await act(async () => result.current.handleDeleteConfirm());
    expect(warehouseService.deleteLocation).toHaveBeenCalledWith("l1");
    expect(result.current.isDeleteConfirmOpen).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
