/**
 * useMenuGroups — role → menu-group assignment: the role guard, single and
 * bulk assign/revoke payloads and their result summaries, optimistic toggles
 * that roll back on failure, and the assignment-state helpers.
 * menuGroupRoleService methods return the envelope's `data` (an array for
 * the lists, BulkAssignmentResult / BulkRevokeResult for the bulk calls).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const menuGroupRoleService = {
  getAvailableRoles: jest.fn(),
  getAvailableMenuGroups: jest.fn(),
  assignMenuGroupToRole: jest.fn(),
  revokeMenuGroupFromRole: jest.fn(),
  bulkAssignMenuGroups: jest.fn(),
  bulkRevokeMenuGroups: jest.fn(),
  assignMenuItemToRole: jest.fn(),
  revokeMenuItemFromRole: jest.fn(),
};
jest.mock("@/api/services/menuGroupRole.service", () => ({ menuGroupRoleService }));

import { useMenuGroups } from "../useMenuGroups";
import type { ExtendedMenuGroup, ExtendedMenuItem } from "../../types";

const roles = [{ id: "r1", name: "TECHNICIAN" }];
type Group = ExtendedMenuGroup & { items: ExtendedMenuItem[] };
const devicesGroup = {
  id: "g1", label: "Devices", isAssigned: true,
  items: [{ id: "i1", label: "List", isAssigned: true }, { id: "i2", label: "Import", isAssigned: true }],
} as unknown as Group;
const reportsGroup = {
  id: "g2", label: "Reports",
  items: [{ id: "i3", label: "Monthly", isAssigned: true }, { id: "i4", label: "Yearly", isAssigned: false }],
} as unknown as Group;
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });

beforeEach(() => {
  jest.clearAllMocks();
  menuGroupRoleService.getAvailableRoles.mockResolvedValue(roles);
  menuGroupRoleService.getAvailableMenuGroups.mockResolvedValue([devicesGroup, reportsGroup]);
});

const setup = async (withRole = true) => {
  const hook = renderHook(() => useMenuGroups());
  await waitFor(() => expect(hook.result.current.roles).toEqual(roles));
  if (withRole) {
    act(() => hook.result.current.setSelectedRoleId("r1"));
    await waitFor(() => expect(hook.result.current.menuGroups).toHaveLength(2));
  }
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe("useMenuGroups", () => {
  it("loads roles; menu groups only once a role is chosen, isAssigned defaulting to false", async () => {
    const { result } = await setup(false);
    expect(menuGroupRoleService.getAvailableMenuGroups).not.toHaveBeenCalled();
    expect(result.current.menuGroups).toEqual([]);
    act(() => result.current.setSelectedRoleId("r1"));
    await waitFor(() => expect(result.current.menuGroups).toHaveLength(2));
    expect(menuGroupRoleService.getAvailableMenuGroups).toHaveBeenCalledWith("r1");
    expect(result.current.menuGroups[1].isAssigned).toBe(false);
  });

  it("a failed load is an error with the backend message", async () => {
    menuGroupRoleService.getAvailableRoles.mockRejectedValueOnce(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useMenuGroups());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    menuGroupRoleService.getAvailableRoles.mockRejectedValueOnce("x");
    await act(async () => result.current.refresh());
    expect(result.current.error).toBe("Failed to fetch data");
  });

  it("assign and bulk assign need a role; revoke without one does nothing", async () => {
    const { result } = await setup(false);
    await act(async () => result.current.handleAssign("g1"));
    expect(result.current.toast).toMatchObject({ type: "error", title: "Role Required" });
    await act(async () => result.current.handleBulkAssign());
    expect(result.current.toast).toMatchObject({ type: "error", title: "Role Required" });
    await act(async () => result.current.handleRevoke("g1"));
    await act(async () => result.current.handleBulkRevoke());
    await act(async () => result.current.toggleAssign("g1", true));
    await act(async () => result.current.toggleItemAssign(devicesGroup, devicesGroup.items[0], false));
    expect(menuGroupRoleService.assignMenuGroupToRole).not.toHaveBeenCalled();
    expect(menuGroupRoleService.revokeMenuGroupFromRole).not.toHaveBeenCalled();
    expect(menuGroupRoleService.bulkRevokeMenuGroups).not.toHaveBeenCalled();
    expect(menuGroupRoleService.revokeMenuItemFromRole).not.toHaveBeenCalled();
  });

  it("assign sends the notes, reloads and clears them; a refusal is an error toast", async () => {
    menuGroupRoleService.assignMenuGroupToRole.mockResolvedValueOnce({ id: "r1" });
    const { result } = await setup();
    act(() => result.current.setAssignNotes("ticket #12"));
    await act(async () => result.current.handleAssign("g2"));
    expect(menuGroupRoleService.assignMenuGroupToRole).toHaveBeenCalledWith({ menuGroupId: "g2", roleId: "r1", notes: "ticket #12" });
    expect(result.current.toast).toMatchObject({ type: "success", title: "Menu Group Assigned" });
    expect(result.current.assignNotes).toBe("");
    expect(result.current.actionLoading).toBe(false);

    menuGroupRoleService.assignMenuGroupToRole.mockRejectedValueOnce(httpError(409, "Already assigned"));
    await act(async () => result.current.handleAssign("g1"));
    expect(result.current.toast).toMatchObject({ type: "error", title: "Assignment Failed", description: "Already assigned" });
    menuGroupRoleService.assignMenuGroupToRole.mockRejectedValueOnce(0);
    await act(async () => result.current.handleAssign("g1"));
    expect(result.current.toast?.description).toBe("Failed to assign menu group");
  });

  it("revoke reports success or the backend's reason", async () => {
    menuGroupRoleService.revokeMenuGroupFromRole.mockResolvedValueOnce({ id: "r1" });
    const { result } = await setup();
    await act(async () => result.current.handleRevoke("g1"));
    expect(menuGroupRoleService.revokeMenuGroupFromRole).toHaveBeenCalledWith({ menuGroupId: "g1", roleId: "r1" });
    expect(result.current.toast).toMatchObject({ type: "success", title: "Menu Group Revoked" });
    menuGroupRoleService.revokeMenuGroupFromRole.mockRejectedValueOnce(httpError(404, "Assignment not found"));
    await act(async () => result.current.handleRevoke("g1"));
    expect(result.current.toast).toMatchObject({ type: "error", title: "Revocation Failed", description: "Assignment not found" });
    menuGroupRoleService.revokeMenuGroupFromRole.mockRejectedValueOnce(null);
    await act(async () => result.current.handleRevoke("g1"));
    expect(result.current.toast?.description).toBe("Failed to revoke menu group");
  });

  // A-300: the bulk actions act on the SELECTION, which is separate from
  // what is assigned (they used to send every assigned group).
  it("selection is separate from assignment: toggle, select all, deselect all, dropped on role change", async () => {
    const { result } = await setup();
    expect(result.current.selectedGroupIds).toEqual([]);
    act(() => result.current.toggleSelected("g2"));
    expect(result.current.selectedGroupIds).toEqual(["g2"]);
    expect(result.current.allSelected).toBe(false);
    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedGroupIds).toEqual(["g1", "g2"]);
    expect(result.current.allSelected).toBe(true);
    act(() => result.current.toggleSelectAll());
    expect(result.current.selectedGroupIds).toEqual([]);
    act(() => result.current.toggleSelected("g1"));
    act(() => result.current.toggleSelected("g1"));
    expect(result.current.selectedGroupIds).toEqual([]);
    act(() => result.current.toggleSelected("g2"));
    act(() => result.current.setSelectedRoleId("r1"));
    expect(result.current.selectedGroupIds).toEqual([]);
    // Assignment is untouched by any of it.
    expect(result.current.menuGroups.map((g) => g.isAssigned)).toEqual([true, false]);
  });

  it("bulk assign sends the selected groups, clears the selection and summarises the result", async () => {
    menuGroupRoleService.bulkAssignMenuGroups.mockResolvedValueOnce({
      assigned: ["g2"], alreadyAssigned: ["g9"], failed: [{ menuGroupId: "g8", error: "x" }],
    });
    const { result } = await setup();
    act(() => result.current.toggleSelected("g2"));
    await act(async () => result.current.handleBulkAssign());
    expect(menuGroupRoleService.bulkAssignMenuGroups).toHaveBeenCalledWith({ roleId: "r1", menuGroupIds: ["g2"], notes: undefined });
    expect(result.current.selectedGroupIds).toEqual([]);
    expect(result.current.toast).toEqual({
      type: "success", title: "Bulk Assignment Complete",
      description: "Successfully assigned 1 menu group(s). 1 already assigned. 1 failed.",
    });

    menuGroupRoleService.bulkAssignMenuGroups.mockResolvedValueOnce({ assigned: ["g1"], alreadyAssigned: [], failed: [] });
    act(() => result.current.toggleSelected("g1"));
    await act(async () => result.current.handleBulkAssign());
    expect(result.current.toast?.description).toBe("Successfully assigned 1 menu group(s).");

    act(() => result.current.toggleSelected("g1"));
    menuGroupRoleService.bulkAssignMenuGroups.mockRejectedValueOnce(httpError(429, "Too many requests"));
    await act(async () => result.current.handleBulkAssign());
    expect(result.current.toast).toMatchObject({ type: "error", title: "Bulk Assignment Failed", description: "Too many requests" });
    // A failure keeps the selection, so the user can retry.
    expect(result.current.selectedGroupIds).toEqual(["g1"]);
    menuGroupRoleService.bulkAssignMenuGroups.mockRejectedValueOnce("x");
    await act(async () => result.current.handleBulkAssign());
    expect(result.current.toast?.description).toBe("Bulk assignment failed");
  });

  it("bulk actions with nothing selected say so instead of calling the backend — even with groups assigned", async () => {
    const { result } = await setup();
    await act(async () => result.current.handleBulkAssign());
    expect(result.current.toast).toMatchObject({ title: "No Selection", description: "Please select at least one menu group." });
    await act(async () => result.current.handleBulkRevoke());
    expect(result.current.toast).toMatchObject({ title: "No Selection", description: "Please select at least one menu group." });
    expect(menuGroupRoleService.bulkAssignMenuGroups).not.toHaveBeenCalled();
    expect(menuGroupRoleService.bulkRevokeMenuGroups).not.toHaveBeenCalled();
  });

  it("bulk revoke sends only the selected groups and reports the count", async () => {
    menuGroupRoleService.bulkRevokeMenuGroups.mockResolvedValueOnce({ revoked: ["g2"], notFound: [] });
    const { result } = await setup();
    act(() => result.current.toggleSelected("g2"));
    await act(async () => result.current.handleBulkRevoke());
    expect(menuGroupRoleService.bulkRevokeMenuGroups).toHaveBeenCalledWith({ roleId: "r1", menuGroupIds: ["g2"] });
    expect(result.current.toast?.description).toBe("Successfully revoked 1 menu group(s).");
    act(() => result.current.toggleSelected("g1"));
    menuGroupRoleService.bulkRevokeMenuGroups.mockRejectedValueOnce(httpError(403, "Forbidden"));
    await act(async () => result.current.handleBulkRevoke());
    expect(result.current.toast).toMatchObject({ type: "error", title: "Bulk Revocation Failed", description: "Forbidden" });
    menuGroupRoleService.bulkRevokeMenuGroups.mockRejectedValueOnce({});
    await act(async () => result.current.handleBulkRevoke());
    expect(result.current.toast?.description).toBe("Bulk revocation failed");
  });

  it("a group toggle is optimistic and rolls back when the backend refuses", async () => {
    const { result } = await setup();
    menuGroupRoleService.assignMenuGroupToRole.mockResolvedValueOnce({});
    await act(async () => result.current.toggleAssign("g2", true));
    expect(result.current.menuGroups.find((g) => g.id === "g2")?.isAssigned).toBe(true);
    expect(result.current.toast?.title).toBe("Menu Group Assigned");

    menuGroupRoleService.revokeMenuGroupFromRole.mockResolvedValueOnce({});
    await act(async () => result.current.toggleAssign("g2", false));
    expect(result.current.toast?.title).toBe("Menu Group Revoked");
    expect(result.current.menuGroups.find((g) => g.id === "g2")?.isAssigned).toBe(false);

    menuGroupRoleService.assignMenuGroupToRole.mockRejectedValueOnce(httpError(403, "Forbidden"));
    await act(async () => result.current.toggleAssign("g2", true));
    expect(result.current.menuGroups.find((g) => g.id === "g2")?.isAssigned).toBe(false);
    expect(result.current.toast).toMatchObject({ type: "error", title: "Toggle Failed", description: "Forbidden" });
    menuGroupRoleService.revokeMenuGroupFromRole.mockRejectedValueOnce("x");
    await act(async () => result.current.toggleAssign("g1", false));
    expect(result.current.menuGroups.find((g) => g.id === "g1")?.isAssigned).toBe(true);
    expect(result.current.toast?.description).toBe("Failed to toggle menu group");
  });

  it("an item toggle assigns or revokes the item and rolls back on failure", async () => {
    const { result } = await setup();
    const reports = () => result.current.menuGroups.find((g) => g.id === "g2") as ExtendedMenuGroup;
    const item = (id: string) => reports().items?.find((i) => i.id === id);

    menuGroupRoleService.assignMenuItemToRole.mockResolvedValueOnce({});
    await act(async () => result.current.toggleItemAssign(reports(), item("i4") as ExtendedMenuItem, true));
    expect(menuGroupRoleService.assignMenuItemToRole).toHaveBeenCalledWith({ menuItemId: "i4", roleId: "r1", notes: undefined });
    expect(item("i4")?.isAssigned).toBe(true);
    expect(result.current.toast?.title).toBe("Item Assigned");

    menuGroupRoleService.revokeMenuItemFromRole.mockResolvedValueOnce({});
    await act(async () => result.current.toggleItemAssign(reports(), item("i3") as ExtendedMenuItem, false));
    expect(menuGroupRoleService.revokeMenuItemFromRole).toHaveBeenLastCalledWith({ menuItemId: "i3", roleId: "r1" });
    expect(item("i3")?.isAssigned).toBe(false);

    menuGroupRoleService.assignMenuItemToRole.mockRejectedValueOnce(httpError(404, "Menu item not found"));
    await act(async () => result.current.toggleItemAssign(reports(), item("i3") as ExtendedMenuItem, true));
    expect(item("i3")?.isAssigned).toBe(false);
    expect(result.current.toast).toMatchObject({ type: "error", title: "Toggle Failed", description: "Menu item not found" });
    menuGroupRoleService.assignMenuItemToRole.mockRejectedValueOnce(null);
    await act(async () => result.current.toggleItemAssign(reports(), item("i3") as ExtendedMenuItem, true));
    expect(result.current.toast?.description).toBe("Failed to toggle menu item");
  });

  it("unchecking an item of a wholly assigned group revokes that item", async () => {
    menuGroupRoleService.revokeMenuItemFromRole.mockResolvedValueOnce({});
    const { result } = await setup();
    const devices = result.current.menuGroups[0];
    await act(async () => result.current.toggleItemAssign(devices, devices.items![0], false));
    expect(menuGroupRoleService.revokeMenuItemFromRole).toHaveBeenCalledWith({ menuItemId: "i1", roleId: "r1" });
    expect(result.current.menuGroups[0].items?.[0].isAssigned).toBe(false);
    expect(result.current.toast?.title).toBe("Item Revoked");
  });

  it("assignment-state helpers read group and item flags", async () => {
    const { result } = await setup();
    const { getGroupAssignmentState: state, isItemAssigned } = result.current;
    expect(state(devicesGroup)).toBe("all");
    expect(state(reportsGroup)).toBe("some");
    expect(state({ id: "g3", items: [] })).toBe("none");
    expect(state({ id: "g3", items: [{ id: "a", isAssigned: false } as ExtendedMenuItem] })).toBe("none");
    expect(state({ id: "g3", items: [{ id: "a", isAssigned: true } as ExtendedMenuItem] })).toBe("all");
    expect(isItemAssigned(devicesGroup, { id: "x" } as ExtendedMenuItem)).toBe(true);
    expect(isItemAssigned(reportsGroup, reportsGroup.items[1])).toBe(false);
  });

  it("a toast clears itself after four seconds", async () => {
    const { result } = await setup();
    jest.useFakeTimers();
    try {
      act(() => result.current.showToast("info", "Heads up", "x"));
      expect(result.current.toast?.title).toBe("Heads up");
      act(() => jest.advanceTimersByTime(4000));
      expect(result.current.toast).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
