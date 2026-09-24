/**
 * useVendors — list with filters (each resets to page 1), the create/edit
 * payload (trimmed, empty → undefined, rating numeric), qualification and
 * delete, and their failures.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const vendorService = {
  getAll: jest.fn(), create: jest.fn(), update: jest.fn(), qualify: jest.fn(), delete: jest.fn(),
};
jest.mock("@/api/services/vendor.service", () => ({ vendorService }));

import { useVendors } from "../useVendors";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const list = { data: [], meta: { page: 1, limit: 10, totalPages: 1 } };
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  vendorService.getAll.mockResolvedValue(list);
  useAuthStore.setState({ user: { id: "u1", role: { name: "CALIBRATOR ADMIN" } } as unknown as User });
});

const setup = async () => {
  const hook = renderHook(() => useVendors());
  await waitFor(() => expect(hook.result.current.vendors).toEqual(list));
  return hook;
};

describe("useVendors", () => {
  it("filters reach the request and reset to page 1; a failed load is an error", async () => {
    const { result } = await setup();
    expect(result.current.hasWriteAccess).toBe(true);
    act(() => result.current.setCurrentPage(3));
    act(() => result.current.handleSearchChange({ target: { value: "lab" } } as React.ChangeEvent<HTMLInputElement>));
    act(() => result.current.handleStatusChange("Active"));
    act(() => result.current.handleTypeChange("CalibrationLab"));
    await waitFor(() =>
      expect(vendorService.getAll).toHaveBeenLastCalledWith(1, 10, "lab", "Active", "CalibrationLab"),
    );
    expect(result.current.currentPage).toBe(1);

    vendorService.getAll.mockRejectedValue(new Error("Vendors unavailable"));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.vendorsError).toBe("Vendors unavailable"));
  });

  it("create sends a trimmed payload with empty fields omitted and a numeric rating", async () => {
    const { result } = await setup();
    vendorService.create.mockResolvedValue({ id: "v1" });
    act(() => result.current.openCreateModal());
    act(() =>
      result.current.setForm({
        name: "  Lab One ", type: "CalibrationLab", contactPerson: " ", email: "lab@x.test ",
        phone: "", address: "", status: "Active", rating: "4",
      }),
    );
    await act(async () => result.current.handleFormSubmit(ev));
    expect(vendorService.create).toHaveBeenCalledWith({
      name: "Lab One", type: "CalibrationLab", contactPerson: undefined, email: "lab@x.test",
      phone: undefined, address: undefined, status: "Active", rating: 4,
    });
    expect(result.current.isVendorModalOpen).toBe(false);
    expect(lastToast()?.title).toBe("Vendor created");
  });

  it("edit prefills the form and updates by id; a failure keeps the modal open", async () => {
    const { result } = await setup();
    act(() =>
      result.current.openEditModal({
        id: "v1", name: "Lab", type: "Supplier", status: "Inactive", rating: 3,
      } as never),
    );
    expect(result.current.form).toMatchObject({ name: "Lab", rating: "3", email: "" });
    vendorService.update.mockRejectedValueOnce(new Error("Name taken"));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(result.current.isVendorModalOpen).toBe(true);
    expect(lastToast()).toMatchObject({ type: "error", title: "Name taken" });

    vendorService.update.mockResolvedValue({});
    await act(async () => result.current.handleFormSubmit(ev));
    expect(vendorService.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: "v1", rating: 3 }));
    expect(lastToast()?.title).toBe("Vendor updated");
  });

  it("qualify and delete, with their failures", async () => {
    const { result } = await setup();
    vendorService.qualify.mockResolvedValue({});
    await act(async () => result.current.handleQualify("v1", "Approved"));
    expect(vendorService.qualify).toHaveBeenCalledWith("v1", { approvalStatus: "Approved" });
    vendorService.qualify.mockRejectedValue(new Error("Audit missing"));
    await act(async () => result.current.handleQualify("v1", "Approved"));
    expect(lastToast()).toMatchObject({ type: "error" });

    await act(async () => result.current.confirmDelete());
    expect(vendorService.delete).not.toHaveBeenCalled();
    act(() => result.current.handleDeleteClick("v1"));
    vendorService.delete.mockRejectedValueOnce(new Error("Vendor in use"));
    await act(async () => result.current.confirmDelete());
    expect(lastToast()).toMatchObject({ type: "error" });
    vendorService.delete.mockResolvedValue({});
    await act(async () => result.current.confirmDelete());
    expect(result.current.isDeleteConfirmOpen).toBe(false);
  });
});
