/**
 * usePermissions — the role × menu permission matrix. Regression for the F-03
 * refactor: a non-super-admin loads nothing and is not "loading"; selecting a
 * role loads its assignments (now deferred out of the effect body).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const roleService = {
  getAll: jest.fn(), getAllMenus: jest.fn(), getById: jest.fn(),
  assignPermission: jest.fn(), removePermission: jest.fn(),
};
jest.mock("@/api/services/role.service", () => ({ roleService }));

import { usePermissions } from "../usePermissions";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const as = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  roleService.getAll.mockResolvedValue({ data: [{ id: "r1", name: "TECH" }, { id: "r2", name: "ADMIN" }] });
  roleService.getAllMenus.mockResolvedValue({ data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });
  roleService.getById.mockImplementation(async (id: string) => ({
    id,
    permissions:
      id === "r1"
        ? [
            { menuGroupId: "m1", permissionType: "write" },
            { menuGroupId: "", menu: { id: "m2", name: "x" } },
          ]
        : [],
  }));
});

describe("usePermissions", () => {
  it("a non-super-admin loads nothing and is not loading", async () => {
    as("TECHNICIAN");
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(roleService.getAll).not.toHaveBeenCalled();
  });

  it("a super admin loads roles and menus, selects the first role and maps its assignments", async () => {
    as("SUPERADMIN");
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.assignments).toEqual({ m1: "write", m2: "read" }));
    expect(result.current.selectedRole).toMatchObject({ id: "r1" });
    expect(result.current.menus).toHaveLength(3);
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.setSelectedRoleId("r2"));
    await waitFor(() => expect(result.current.assignments).toEqual({}));
  });

  it("setting and removing a permission updates the matrix; a failure is shown", async () => {
    as("SUPERADMIN");
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.assignments.m1).toBe("write"));

    roleService.assignPermission.mockResolvedValue({});
    await act(async () => result.current.setPermission("m3", "read"));
    expect(roleService.assignPermission).toHaveBeenCalledWith("r1", "m3", "read");
    expect(result.current.assignments.m3).toBe("read");

    roleService.removePermission.mockResolvedValue({});
    await act(async () => result.current.setPermission("m1", null));
    expect(result.current.assignments.m1).toBeUndefined();

    roleService.assignPermission.mockRejectedValue(new Error("Cannot grant write on audit"));
    await act(async () => result.current.setPermission("m2", "write"));
    expect(result.current.error).toBe("Cannot grant write on audit");
    expect(result.current.savingMenuId).toBeNull();
  });

  it("a failed initial load is the page's error", async () => {
    as("SUPERADMIN");
    roleService.getAll.mockRejectedValue(new Error("Roles unavailable"));
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => expect(result.current.error).toBe("Roles unavailable"));
    expect(result.current.isLoading).toBe(false);
  });
});
