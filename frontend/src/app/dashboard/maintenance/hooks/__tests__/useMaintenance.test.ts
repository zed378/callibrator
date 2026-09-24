/**
 * useMaintenance — work orders: filters, reference data, the device guard,
 * the create/edit payload, delete, and their failures.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const maintenanceService = { getAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
const deviceService = { getAll: jest.fn() };
const vendorService = { getAll: jest.fn() };
jest.mock("@/api/services/maintenance.service", () => ({ maintenanceService }));
jest.mock("@/api/services/device.service", () => ({ deviceService }));
jest.mock("@/api/services/vendor.service", () => ({ vendorService }));

import { useMaintenance } from "../useMaintenance";
import { useToastStore } from "@/stores/toastStore";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const list = { data: [], meta: { page: 1, limit: 10, totalPages: 1 } };
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  maintenanceService.getAll.mockResolvedValue(list);
  deviceService.getAll.mockResolvedValue({ data: [{ id: "d1" }] });
  vendorService.getAll.mockResolvedValue({ data: [{ id: "v1" }] });
});

const setup = async () => {
  const hook = renderHook(() => useMaintenance());
  await waitFor(() => expect(hook.result.current.workOrders).toEqual(list));
  await waitFor(() => expect(hook.result.current.devices).toEqual([{ id: "d1" }]));
  return hook;
};

describe("useMaintenance", () => {
  it("loads work orders and the modal's reference data; filters reach the request", async () => {
    const { result } = await setup();
    expect(result.current.vendors).toEqual([{ id: "v1" }]);
    act(() => result.current.handleSearchChange({ target: { value: "pump" } } as React.ChangeEvent<HTMLInputElement>));
    act(() => result.current.handleStatusChange("Open"));
    act(() => result.current.handlePriorityChange("High"));
    act(() => result.current.handleTypeChange("Corrective"));
    await waitFor(() =>
      expect(maintenanceService.getAll).toHaveBeenLastCalledWith({
        page: 1, limit: 10, find: "pump", status: "Open", priority: "High", type: "Corrective",
      }),
    );
  });

  it("a failed list load is an error; failed reference data leaves the selects empty", async () => {
    deviceService.getAll.mockRejectedValue(new Error("x"));
    maintenanceService.getAll.mockRejectedValue(new Error("WO service down"));
    const { result } = renderHook(() => useMaintenance());
    await waitFor(() => expect(result.current.workOrdersError).toBe("WO service down"));
    expect(result.current.devices).toEqual([]);
  });

  it("a work order needs a device; create sends a trimmed payload", async () => {
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    await act(async () => result.current.handleFormSubmit(ev));
    expect(lastToast()?.title).toBe("Please select a device");
    expect(maintenanceService.create).not.toHaveBeenCalled();

    maintenanceService.create.mockResolvedValue({ id: "w1" });
    act(() => result.current.setForm((f) => ({ ...f, deviceId: "d1", title: "  Replace filter ", description: " " })));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(maintenanceService.create).toHaveBeenCalledWith({
      deviceId: "d1", title: "Replace filter", type: "Preventative", description: undefined,
      priority: "Medium", status: "Open", vendorId: undefined,
    });
    expect(result.current.isWorkOrderModalOpen).toBe(false);
  });

  it("edit updates by id; failures of save and delete are toasts", async () => {
    const { result } = await setup();
    act(() =>
      result.current.openEditModal({
        id: "w1", deviceId: "d1", title: "T", type: "Corrective", priority: "Low", status: "Open", vendorId: "v1",
      } as never),
    );
    maintenanceService.update.mockRejectedValueOnce(new Error("Closed orders are read-only"));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "Closed orders are read-only" });
    maintenanceService.update.mockResolvedValue({});
    await act(async () => result.current.handleFormSubmit(ev));
    expect(maintenanceService.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: "w1", vendorId: "v1" }));

    await act(async () => result.current.confirmDelete());
    expect(maintenanceService.delete).not.toHaveBeenCalled();
    act(() => result.current.handleDeleteClick("w1"));
    maintenanceService.delete.mockRejectedValueOnce(new Error("In progress"));
    await act(async () => result.current.confirmDelete());
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    maintenanceService.delete.mockResolvedValue({});
    await act(async () => result.current.confirmDelete());
    expect(result.current.isDeleteConfirmOpen).toBe(false);
  });
});
