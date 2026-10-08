/**
 * useUserPermissions — per-user overrides. Regression for the F-03 refactor:
 * roles load once (no exhaustive-deps suppression any more), users reload as
 * the search changes, a non-super-admin loads nothing, and a cleared selection
 * shows no data.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const userPermissionService = {
  getUserPermissions: jest.fn(), removeUserPermission: jest.fn(), setUserPermission: jest.fn(),
};
const userService = { getAll: jest.fn(), updateRole: jest.fn() };
const getAvailableRoles = jest.fn();
jest.mock("@/api/services/userPermission.service", () => ({ userPermissionService }));
jest.mock("@/api/services/user.service", () => ({ userService }));
jest.mock("@/api/services/menuGroupRole.service", () => ({
  menuGroupRoleService: { getAvailableRoles: () => getAvailableRoles() },
}));

import { useUserPermissions } from "../useUserPermissions";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const as = (role: string) =>
  useAuthStore.setState({ user: { id: "u0", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  getAvailableRoles.mockResolvedValue([{ id: "r1", name: "TECH" }]);
  userService.getAll.mockResolvedValue({ data: [{ id: "u1" }, { id: "u2" }] });
  userPermissionService.getUserPermissions.mockImplementation(async (id: string) => ({ userId: id, menus: [] }));
});

describe("useUserPermissions", () => {
  it("a non-super-admin loads nothing and is not loading", async () => {
    as("TECHNICIAN");
    const { result } = renderHook(() => useUserPermissions());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isUsersLoading).toBe(false);
    expect(getAvailableRoles).not.toHaveBeenCalled();
    expect(userService.getAll).not.toHaveBeenCalled();
  });

  it("loads roles once, users per search, and the first user's permissions", async () => {
    as("SUPERADMIN");
    const { result } = renderHook(() => useUserPermissions());
    await waitFor(() => expect(result.current.data).toEqual({ userId: "u1", menus: [] }));
    expect(result.current.roles).toEqual([{ id: "r1", name: "TECH" }]);
    expect(result.current.isUsersLoading).toBe(false);

    act(() => result.current.setSearch("bo"));
    await waitFor(() => expect(userService.getAll).toHaveBeenLastCalledWith(1, 50, "bo"));
    expect(getAvailableRoles).toHaveBeenCalledTimes(1);

    act(() => result.current.setSelectedUserId(""));
    expect(result.current.data).toBeNull();
  });

  it("overrides: set, deny, restore inheritance — each reloads; a failure is shown", async () => {
    as("SUPERADMIN");
    const { result } = renderHook(() => useUserPermissions());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    userPermissionService.setUserPermission.mockResolvedValue({});
    await act(async () => result.current.setOverride("m1", "none"));
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe("Access denied for this menu");
    await act(async () => result.current.setOverride("m1", "write"));
    expect(useToastStore.getState().toasts.at(-1)?.title).toBe("Custom write access granted");
    userPermissionService.removeUserPermission.mockResolvedValue({});
    await act(async () => result.current.setOverride("m1", null));
    expect(userPermissionService.removeUserPermission).toHaveBeenCalledWith("u1", "m1");

    userPermissionService.setUserPermission.mockRejectedValue(new Error("Not allowed"));
    await act(async () => result.current.setOverride("m2", "read"));
    expect(result.current.error).toBe("Not allowed");
  });

  it("changing a user's role reloads their permissions; failures are shown", async () => {
    as("SUPERADMIN");
    const { result } = renderHook(() => useUserPermissions());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    userService.updateRole.mockResolvedValue({});
    await act(async () => result.current.changeRole("r1"));
    expect(userService.updateRole).toHaveBeenCalledWith("u1", "r1");
    userService.updateRole.mockRejectedValue(new Error("Role is archived"));
    await act(async () => result.current.changeRole("r1"));
    expect(result.current.error).toBe("Role is archived");
  });

  it("failed loads are errors", async () => {
    as("SUPERADMIN");
    getAvailableRoles.mockRejectedValue(new Error("roles down"));
    userService.getAll.mockRejectedValue(new Error("users down"));
    const { result } = renderHook(() => useUserPermissions());
    await waitFor(() => expect(result.current.error).toMatch(/down/));
  });
});
