/**
 * useMenuGroupCrud — super-admin menu-group CRUD: the admin list only for the
 * super admin, the edit prefill (admin entity first, list label as fallback),
 * the name guard, the trimmed payload, and refused writes.
 * menuGroupRoleService returns the envelope's `data` (the raw entity/array).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const menuGroupRoleService = {
  getAdminMenuGroups: jest.fn(),
  createMenuGroup: jest.fn(),
  updateMenuGroup: jest.fn(),
  deleteMenuGroup: jest.fn(),
};
jest.mock("@/api/services/menuGroupRole.service", () => ({ menuGroupRoleService }));

import { useMenuGroupCrud } from "../useMenuGroupCrud";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import type { User } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const adminGroup = { id: "g1", label: "Devices", name: "Devices", slug: "devices", icon: "cpu", sortOrder: 2, isActive: false };
const showToast = jest.fn();
const onMutated = jest.fn();
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
// A-301 (ADR-102): the super-admin flag comes from the effective permissions,
// not the role name. `signIn` sets both, consistently; the A-301 test below
// sets them apart.
const signIn = (role: string, superAdmin = role === "SUPERADMIN") => {
  useAuthStore.setState({ user: { id: "u1", role: { name: role } } as unknown as User });
  useMenuStore.setState({ effectivePermissions: { superAdmin, permissions: {} } });
};

beforeEach(() => {
  jest.clearAllMocks();
  signIn("SUPERADMIN");
  menuGroupRoleService.getAdminMenuGroups.mockResolvedValue([adminGroup]);
  onMutated.mockResolvedValue(undefined);
});

const setup = async () => {
  const hook = renderHook(() => useMenuGroupCrud({ showToast, onMutated }));
  await waitFor(() => expect(hook.result.current.adminMenuGroups).toEqual([adminGroup]));
  return hook;
};

describe("useMenuGroupCrud", () => {
  it("only the super admin loads the admin list", async () => {
    signIn("HEALTHCARE ADMIN");
    const { result } = renderHook(() => useMenuGroupCrud({ showToast, onMutated }));
    await act(async () => {});
    expect(result.current.isSuperAdmin).toBe(false);
    expect(menuGroupRoleService.getAdminMenuGroups).not.toHaveBeenCalled();
  });

  // A-301 fail-before: the hook read `role.name === "SUPERADMIN"`, so the
  // role name alone decided — a role merely NAMED SUPERADMIN got the controls
  // and the platform super admin under any other name did not.
  it("decides by the effective super-admin flag, not the role name (A-301)", async () => {
    signIn("SUPERADMIN", false);
    const named = renderHook(() => useMenuGroupCrud({ showToast, onMutated }));
    await act(async () => {});
    expect(named.result.current.isSuperAdmin).toBe(false);
    expect(menuGroupRoleService.getAdminMenuGroups).not.toHaveBeenCalled();
    named.unmount();

    signIn("PLATFORM OWNER", true);
    const { result } = renderHook(() => useMenuGroupCrud({ showToast, onMutated }));
    await waitFor(() => expect(result.current.isSuperAdmin).toBe(true));
    expect(menuGroupRoleService.getAdminMenuGroups).toHaveBeenCalled();
  });

  it("a failed admin-list load is non-blocking: edit falls back to the list label", async () => {
    menuGroupRoleService.getAdminMenuGroups.mockRejectedValue(httpError(500, "boom"));
    const { result } = renderHook(() => useMenuGroupCrud({ showToast, onMutated }));
    await waitFor(() => expect(menuGroupRoleService.getAdminMenuGroups).toHaveBeenCalled());
    act(() => result.current.openEditModal({ id: "g1", label: "Devices (list)" }));
    expect(result.current.crudForm).toEqual({ name: "Devices (list)", slug: "", icon: "", sortOrder: 0, isActive: true });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("edit prefills from the admin entity", async () => {
    const { result } = await setup();
    act(() => result.current.openEditModal({ id: "g1", label: "ignored" }));
    expect(result.current.crudModalType).toBe("edit");
    expect(result.current.crudModalOpen).toBe(true);
    expect(result.current.crudForm).toEqual({ name: "Devices", slug: "devices", icon: "cpu", sortOrder: 2, isActive: false });
  });

  it("an unnamed group is refused before any request", async () => {
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setCrudForm((f) => ({ ...f, name: "  " })));
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(showToast).toHaveBeenCalledWith("error", "Name Required", "Please enter a menu group name.");
    expect(menuGroupRoleService.createMenuGroup).not.toHaveBeenCalled();
  });

  it("create sends a trimmed payload, closes, and refreshes both lists", async () => {
    menuGroupRoleService.createMenuGroup.mockResolvedValue({ id: "g2" });
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setCrudForm({ name: " Reports ", slug: " ", icon: " chart ", sortOrder: 5, isActive: true }));
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(menuGroupRoleService.createMenuGroup).toHaveBeenCalledWith({
      name: "Reports", slug: undefined, icon: "chart", sortOrder: 5, isActive: true,
    });
    expect(showToast).toHaveBeenCalledWith("success", "Menu Group Created", expect.any(String));
    expect(result.current.crudModalOpen).toBe(false);
    expect(onMutated).toHaveBeenCalled();
    expect(menuGroupRoleService.getAdminMenuGroups).toHaveBeenCalledTimes(2);
    expect(result.current.crudLoading).toBe(false);
  });

  it("a refused create keeps the modal open and says why", async () => {
    menuGroupRoleService.createMenuGroup.mockRejectedValueOnce(httpError(409, "Slug already exists"));
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setCrudForm((f) => ({ ...f, name: "Devices", slug: "devices" })));
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(showToast).toHaveBeenLastCalledWith("error", "Creation Failed", "Slug already exists");
    expect(result.current.crudModalOpen).toBe(true);
    expect(onMutated).not.toHaveBeenCalled();
    menuGroupRoleService.createMenuGroup.mockRejectedValueOnce("x");
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(showToast).toHaveBeenLastCalledWith("error", "Creation Failed", "Failed to save menu group");
  });

  it("update sends the id with the payload; a refusal is an Update Failed toast", async () => {
    const { result } = await setup();
    act(() => result.current.openEditModal({ id: "g1" }));
    menuGroupRoleService.updateMenuGroup.mockRejectedValueOnce(httpError(404, "Menu group not found"));
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(showToast).toHaveBeenLastCalledWith("error", "Update Failed", "Menu group not found");

    menuGroupRoleService.updateMenuGroup.mockResolvedValueOnce(adminGroup);
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(menuGroupRoleService.updateMenuGroup).toHaveBeenLastCalledWith({
      id: "g1", name: "Devices", slug: "devices", icon: "cpu", sortOrder: 2, isActive: false,
    });
    expect(showToast).toHaveBeenLastCalledWith("success", "Menu Group Updated", expect.any(String));
    expect(result.current.crudModalOpen).toBe(false);
  });

  it("an edit of a group without an id sends nothing", async () => {
    const { result } = await setup();
    act(() => result.current.openEditModal({ label: "Orphan" }));
    await act(async () => result.current.handleCrudSubmit(ev));
    expect(menuGroupRoleService.updateMenuGroup).not.toHaveBeenCalled();
    expect(result.current.crudLoading).toBe(false);
  });

  it("delete: nothing without a target; a refusal keeps the confirm open; success closes it", async () => {
    const { result } = await setup();
    await act(async () => result.current.confirmDelete());
    expect(menuGroupRoleService.deleteMenuGroup).not.toHaveBeenCalled();

    act(() => result.current.handleDeleteClick("g1"));
    expect(result.current.deleteConfirmOpen).toBe(true);
    menuGroupRoleService.deleteMenuGroup.mockRejectedValueOnce(httpError(409, "Menu group is assigned to roles"));
    await act(async () => result.current.confirmDelete());
    expect(showToast).toHaveBeenLastCalledWith("error", "Deletion Failed", "Menu group is assigned to roles");
    expect(result.current.deleteConfirmOpen).toBe(true);
    menuGroupRoleService.deleteMenuGroup.mockRejectedValueOnce(undefined);
    await act(async () => result.current.confirmDelete());
    expect(showToast).toHaveBeenLastCalledWith("error", "Deletion Failed", "Failed to delete menu group");

    menuGroupRoleService.deleteMenuGroup.mockResolvedValueOnce(undefined);
    await act(async () => result.current.confirmDelete());
    expect(menuGroupRoleService.deleteMenuGroup).toHaveBeenLastCalledWith("g1");
    expect(showToast).toHaveBeenLastCalledWith("success", "Menu Group Deleted", expect.any(String));
    expect(result.current.deleteConfirmOpen).toBe(false);
    expect(onMutated).toHaveBeenCalled();
  });
});
