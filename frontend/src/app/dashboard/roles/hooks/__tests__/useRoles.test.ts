/**
 * useRoles — runs the REAL roleStore and role.service against a mocked
 * `@/api/client`, so GET /api/v1/roles (rows in `data`, a top-level `meta`,
 * each row's `status` — never `isActive`; roles.controller.js getAllRoles,
 * F-19) is unwrapped by the real code.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const api = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
jest.mock("@/api/client", () => ({ api, default: api }));

import { useRoles } from "../useRoles";
import { useRoleStore } from "@/stores/roleStore";
import type { Role } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const admin = { id: "r1", name: "HEALTHCARE ADMIN", description: "Admin", status: "active", roleLevel: 3 };
const tech = { id: "r2", name: "TECHNICIAN", description: null, status: "inactive", isActive: false, roleLevel: 1 };
// Shape of roles.controller.js getAllRoles.
const rolesBody = { success: true, data: [admin, tech], meta: { page: 1, limit: 10, total: 12, totalPages: 2 } };

const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });

beforeEach(() => {
  jest.clearAllMocks();
  useRoleStore.setState({ roles: null, isLoading: false, error: null, currentRole: null });
  api.get.mockResolvedValue(rolesBody);
});

const setup = async () => {
  const hook = renderHook(() => useRoles());
  await waitFor(() => expect(hook.result.current.roles?.data).toHaveLength(2));
  return hook;
};

describe("useRoles", () => {
  it("loads a page of roles and derives the header counts from the real envelope", async () => {
    const { result } = await setup();
    expect(api.get).toHaveBeenCalledWith("/api/v1/roles", { params: { page: "1", limit: "10", search: "" } });
    expect(result.current.totalRoles).toBe(12);
    expect(result.current.activeRoles).toBe(1);
    expect(result.current.inactiveRoles).toBe(1);
  });

  it("search, page and page size reach the request", async () => {
    const { result } = await setup();
    act(() => result.current.setSearchTerm("tech"));
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setPageSize(25));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith("/api/v1/roles", { params: { page: "2", limit: "25", search: "tech" } }),
    );
  });

  it("a failed list load is the store's error, not an empty list", async () => {
    api.get.mockRejectedValue(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.roles).toBeNull();
    expect(result.current.totalRoles).toBe(0);
  });

  it("create posts the fields the backend reads, closes the modal and resets the form", async () => {
    api.post.mockResolvedValue({ success: true, data: { id: "r3", name: "AUDITOR" } });
    const { result } = await setup();
    act(() => result.current.setShowCreateModal(true));
    act(() => result.current.setCreateForm((f) => ({ ...f, name: "AUDITOR", description: "" })));
    await act(async () => result.current.handleCreate(ev));
    expect(api.post).toHaveBeenCalledWith("/api/v1/roles", {
      name: "AUDITOR", description: undefined, roleLevel: 1, status: "active",
    });
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.createForm.name).toBe("");
    expect(result.current.formError).toBe("");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("a refused create (409 duplicate name) keeps the modal open with the backend message", async () => {
    api.post.mockRejectedValueOnce(httpError(409, "Role name already exists"));
    const { result } = await setup();
    act(() => result.current.setShowCreateModal(true));
    act(() => result.current.setCreateForm((f) => ({ ...f, name: "TECHNICIAN" })));
    await act(async () => result.current.handleCreate(ev));
    expect(result.current.formError).toBe("Role name already exists");
    expect(result.current.showCreateModal).toBe(true);

    api.post.mockRejectedValueOnce("x");
    await act(async () => result.current.handleCreate(ev));
    expect(result.current.formError).toBe("Failed to create role");
  });

  it("edit prefills from the row and patches status from the Active switch", async () => {
    api.patch.mockResolvedValue({ success: true, data: { ...tech, status: "active" } });
    const { result } = await setup();
    await act(async () => result.current.handleUpdate(ev));
    expect(api.patch).not.toHaveBeenCalled();

    act(() => result.current.handleEdit(tech as unknown as Role));
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.editForm).toEqual({ name: "TECHNICIAN", description: "", nameToShow: "", isActive: false, roleLevel: 1 });
    act(() => result.current.setEditForm((f) => ({ ...f, isActive: true, description: "Bench tech" })));
    await act(async () => result.current.handleUpdate(ev));
    expect(api.patch).toHaveBeenCalledWith("/api/v1/roles/r2", {
      name: "TECHNICIAN", nameToShow: "", description: "Bench tech", status: "active",
    });
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.editingRole).toBeNull();
  });

  it("a refused edit keeps the modal open and says why", async () => {
    const { result } = await setup();
    act(() => result.current.handleEdit({ id: "r1", name: "HEALTHCARE ADMIN" } as Role));
    expect(result.current.editForm.isActive).toBe(true);
    expect(result.current.editForm.roleLevel).toBe(1);
    api.patch.mockRejectedValueOnce(httpError(403, "System roles cannot be modified"));
    await act(async () => result.current.handleUpdate(ev));
    expect(result.current.formError).toBe("System roles cannot be modified");
    expect(result.current.showEditModal).toBe(true);
    api.patch.mockRejectedValueOnce(undefined);
    await act(async () => result.current.handleUpdate(ev));
    expect(result.current.formError).toBe("Failed to update role");
  });

  it("delete closes the confirm either way; a refusal leaves the backend message in error", async () => {
    const { result } = await setup();
    act(() => result.current.setShowDeleteConfirm("r2"));
    api.delete.mockRejectedValueOnce(httpError(409, "Role is assigned to 3 users"));
    await act(async () => result.current.handleDelete("r2"));
    expect(result.current.showDeleteConfirm).toBeNull();
    expect(result.current.error).toBe("Role is assigned to 3 users");

    api.delete.mockResolvedValueOnce({ success: true });
    act(() => result.current.setShowDeleteConfirm("r2"));
    await act(async () => result.current.handleDelete("r2"));
    expect(api.delete).toHaveBeenLastCalledWith("/api/v1/roles/r2");
    expect(result.current.showDeleteConfirm).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
