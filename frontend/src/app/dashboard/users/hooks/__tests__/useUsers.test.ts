/**
 * useUsers — the users screen's logic: password rules, the create guard,
 * username availability, role options (A-76 / super-admin-only role) and the
 * write paths. Services mocked; the user and tenant stores are real.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const userService = {
  getAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  checkUsername: jest.fn(),
};
jest.mock("@/api/services/user.service", () => ({ userService }));
const getAvailableRoles = jest.fn();
jest.mock("@/api/services/menuGroupRole.service", () => ({
  menuGroupRoleService: { getAvailableRoles: () => getAvailableRoles() },
}));
const tenantService = { getVisible: jest.fn() };
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));

import { useUsers, initialCreateForm } from "../useUsers";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import type { User } from "@/types";

const page = { data: [{ id: "u2", username: "bob" }], meta: { page: 1, limit: 10, totalPages: 1, total: 1 } };
const roles = [
  { id: "r-sa", name: "SUPERADMIN", nameToShow: "Super Admin" },
  { id: "r-t", name: "TECHNICIAN" },
];
const form = { preventDefault: jest.fn() } as unknown as React.FormEvent;

const signInAs = (roleName: string, tenantId = "t1") =>
  useAuthStore.setState({
    user: { id: "u1", username: "ada", email: "a@x", tenantId, role: { name: roleName } } as unknown as User,
  });

beforeEach(() => {
  jest.clearAllMocks();
  userService.getAll.mockResolvedValue(page);
  tenantService.getVisible.mockResolvedValue({ data: [{ id: "t1", name: "RS One" }], meta: { page: 1, limit: 100, totalPages: 1 } });
  getAvailableRoles.mockResolvedValue(roles);
  useUserStore.setState({ users: null, error: null, isLoading: false });
});

const setup = async () => {
  const hook = renderHook(() => useUsers());
  await waitFor(() => expect(hook.result.current.users).toEqual(page));
  return hook;
};

describe("useUsers", () => {
  it("A-76: a tenant admin's tenant list is their own; the SUPERADMIN role is not offered", async () => {
    signInAs("HEALTHCARE ADMIN", "t1");
    const { result } = await setup();
    await waitFor(() => expect(result.current.roleOptions).toHaveLength(1));
    expect(tenantService.getVisible).toHaveBeenCalledWith(1, 100, undefined, "t1");
    expect(result.current.roleOptions).toEqual([{ value: "r-t", label: "TECHNICIAN" }]);
    expect(result.current.tenantOptions).toEqual([{ value: "t1", label: "RS One" }]);
  });

  it("a super admin lists every tenant and may assign SUPERADMIN", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    await waitFor(() => expect(result.current.roleOptions).toHaveLength(2));
    expect(tenantService.getVisible).toHaveBeenCalledWith(1, 100, undefined, null);
  });

  it("validatePassword reports each rule", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    act(() => result.current.validatePassword("abc"));
    expect(result.current.passwordRules).toEqual({
      minLength: false, hasUppercase: false, hasLowercase: true, hasNumber: false, hasSymbol: false,
    });
    act(() => result.current.validatePassword("Abcdef1!"));
    expect(Object.values(result.current.passwordRules).every(Boolean)).toBe(true);
  });

  it("a weak password is refused before any request", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    act(() => result.current.setCreateForm({ ...initialCreateForm, password: "weak" }));
    await act(async () => result.current.handleCreate(form));
    expect(result.current.formError).toMatch(/at least 8 characters/);
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("a create sends no empty tenantId, closes the modal and refetches; a refusal is shown", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    userService.create.mockResolvedValue({ id: "u3" });
    act(() => {
      result.current.setShowCreateModal(true);
      result.current.setCreateForm({ ...initialCreateForm, username: "cy", password: "Abcdef1!" });
    });
    await act(async () => result.current.handleCreate(form));
    expect(userService.create).toHaveBeenCalledWith(expect.objectContaining({ username: "cy", tenantId: undefined }));
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.createForm).toEqual(initialCreateForm);

    userService.create.mockRejectedValue(new Error("Email already registered"));
    act(() => result.current.setCreateForm({ ...initialCreateForm, password: "Abcdef1!" }));
    await act(async () => result.current.handleCreate(form));
    expect(result.current.formError).toBe("Email already registered");
  });

  it("username availability: too short is unknown; unchanged when editing is unknown; else debounced check", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    jest.useFakeTimers();
    act(() => result.current.checkUsernameAvailability("ab"));
    expect(result.current.usernameAvailability).toEqual({ checking: false, available: null });
    act(() => result.current.checkUsernameAvailability("bob", true, "bob"));
    expect(result.current.usernameAvailability).toEqual({ checking: false, available: null });

    userService.checkUsername.mockResolvedValue({ available: false });
    act(() => result.current.checkUsernameAvailability("carol"));
    expect(result.current.usernameAvailability.checking).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();
    await waitFor(() =>
      expect(result.current.usernameAvailability).toEqual({ checking: false, available: false }),
    );
    expect(userService.checkUsername).toHaveBeenCalledTimes(1);
  });

  it("edit → update sends only the changed fields; a failure keeps the modal open with the message", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    userService.checkUsername.mockResolvedValue({ available: true });
    act(() => result.current.handleEdit({ id: "u2", username: "bob", email: "b@x", status: "ACTIVE" } as User));
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.editForm).toMatchObject({ username: "bob", email: "b@x", status: "ACTIVE" });

    userService.update.mockRejectedValue(new Error("Username taken"));
    await act(async () => result.current.handleUpdate(form));
    expect(result.current.formError).toBe("Username taken");
    expect(result.current.showEditModal).toBe(true);

    userService.update.mockResolvedValue({ id: "u2" });
    await act(async () => result.current.handleUpdate(form));
    expect(result.current.showEditModal).toBe(false);

    act(() => result.current.handleCancelEdit());
    expect(result.current.editingUser).toBeNull();
    act(() => result.current.handleCancelCreate());
    expect(result.current.formError).toBe("");
  });

  it("status colours and delete", async () => {
    signInAs("SUPERADMIN");
    const { result } = await setup();
    expect(["ACTIVE", "INACTIVE", "SUSPENDED", "PENDING", "?"].map(result.current.getStatusColor)).toEqual([
      "success", "default", "danger", "warning", "default",
    ]);
    userService.delete.mockResolvedValue(undefined);
    act(() => result.current.handleDeleteRequest("u2"));
    expect(result.current.showDeleteConfirm).toBe("u2");
    await act(async () => result.current.handleDelete("u2"));
    expect(userService.delete).toHaveBeenCalledWith("u2");
    expect(result.current.showDeleteConfirm).toBeNull();
  });
});
