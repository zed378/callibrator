/**
 * useTenants — A-76 scoping (super admin lists every tenant, anyone else only
 * their own), the create/edit payloads, the logo preview rules (P7-08), and
 * refused writes. The real tenantStore runs; tenantService is mocked with the
 * shapes it returns (getVisible a PaginatedResponse, create/update a Tenant).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const tenantService = { getVisible: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));
const tenantLifecycleService = { suspend: jest.fn(), resume: jest.fn() };
jest.mock("@/api/services/tenantLifecycle.service", () => ({ tenantLifecycleService }));

import { useTenants, initialCreateForm } from "../useTenants";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuthStore } from "@/stores/authStore";
import type { Tenant, User } from "@/types";
import { grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const rsA = {
  id: "t1", name: "RS A", code: "RSA", status: "active", description: "Hospital A", primaryColor: "#112233",
  limitSeats: 50, email: "a@rs.id", phone: "021", address: "Jl. A", city: "Jakarta", state: "DKI", zipCode: "10110",
  country: "ID", website: "https://rsa.id", logoBaseUrl: "/api/v1/tenants/t1/logo",
} as unknown as Tenant;
const listOf = (rows: Tenant[]) => ({
  success: true, message: "ok", data: rows, meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
// ADR-102: the write flags follow the effective permissions, granted as seeded.
const signIn = (role: string, tenantId = "t1") => {
  useAuthStore.setState({ user: { id: "u1", tenantId, role: { name: role } } as unknown as User });
  if (role === "SUPERADMIN") grantSuperAdmin();
  else grantPermissions({ management: "write" });
};

beforeEach(() => {
  jest.clearAllMocks();
  useTenantStore.setState({ tenants: null, isLoading: false, error: null, listTenantId: null, currentTenant: null });
  tenantService.getVisible.mockResolvedValue(listOf([rsA]));
  signIn("SUPERADMIN");
});

const setup = async () => {
  const hook = renderHook(() => useTenants());
  await waitFor(() => expect(hook.result.current.tenants?.data).toEqual([rsA]));
  return hook;
};

describe("useTenants", () => {
  it("waits for the principal before asking for a list", async () => {
    useAuthStore.setState({ user: null });
    renderHook(() => useTenants());
    await act(async () => {});
    expect(tenantService.getVisible).not.toHaveBeenCalled();
  });

  it("the super admin lists all tenants and may manage the platform", async () => {
    const { result } = await setup();
    expect(result.current.canManagePlatform).toBe(true);
    expect(tenantService.getVisible).toHaveBeenCalledWith(1, 10, "", null);
    act(() => result.current.setSearchTerm("rs"));
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setPageSize(25));
    await waitFor(() => expect(tenantService.getVisible).toHaveBeenLastCalledWith(2, 25, "rs", null));
  });

  it("a tenant admin's list is scoped to their own tenant (A-76)", async () => {
    signIn("HEALTHCARE ADMIN", "t9");
    const { result } = await setup();
    expect(result.current.canManagePlatform).toBe(false);
    expect(tenantService.getVisible).toHaveBeenCalledWith(1, 10, "", "t9");
  });

  it("a failed list load is the store's error", async () => {
    tenantService.getVisible.mockRejectedValue(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useTenants());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
  });

  it("create sends the form with blanks dropped and the logo file, then resets", async () => {
    tenantService.create.mockResolvedValue({ ...rsA, id: "t2" });
    const { result } = await setup();
    const logo = new File(["x"], "logo.png", { type: "image/png" });
    act(() => {
      result.current.setShowCreateModal(true);
      result.current.setCreateForm({ ...initialCreateForm, name: "RS B", code: "RSB", limitSeats: "25", city: "Bandung" });
      result.current.setCreateLogoFile(logo);
      result.current.setLogoPreview("blob:logo");
    });
    await act(async () => result.current.handleCreate(ev));
    expect(tenantService.create).toHaveBeenCalledWith({
      name: "RS B", code: "RSB", description: undefined, primaryColor: "#4f46e5", limitSeats: 25, file: logo,
      email: undefined, phone: undefined, address: undefined, city: "Bandung", state: undefined,
      zipCode: undefined, country: undefined, website: undefined,
    });
    expect(result.current.showCreateModal).toBe(false);
    expect(result.current.createForm).toEqual(initialCreateForm);
    expect(result.current.createLogoFile).toBeNull();
    expect(result.current.logoPreview).toBe("");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("an empty seat limit is not sent (plan default); a refused create keeps the modal with the reason", async () => {
    tenantService.create.mockRejectedValueOnce(httpError(409, "Tenant code already exists"));
    const { result } = await setup();
    act(() => {
      result.current.setShowCreateModal(true);
      result.current.setCreateForm({ ...initialCreateForm, name: "Dup", code: "RSA", limitSeats: "", primaryColor: "" });
    });
    await act(async () => result.current.handleCreate(ev));
    expect(tenantService.create).toHaveBeenCalledWith(expect.objectContaining({ limitSeats: undefined, primaryColor: undefined, file: undefined }));
    expect(result.current.formError).toBe("Tenant code already exists");
    expect(result.current.showCreateModal).toBe(true);

    tenantService.create.mockRejectedValueOnce("x");
    await act(async () => result.current.handleCreate(ev));
    expect(result.current.formError).toBe("Failed to create tenant");
  });

  it("edit prefills from the row and keeps the served logo", async () => {
    const { result } = await setup();
    act(() => result.current.handleEdit(rsA));
    expect(result.current.showEditModal).toBe(true);
    expect(result.current.editForm).toEqual({
      name: "RS A", code: "RSA", description: "Hospital A", primaryColor: "#112233", status: "active",
      email: "a@rs.id", phone: "021", address: "Jl. A", city: "Jakarta", state: "DKI", zipCode: "10110",
      country: "ID", website: "https://rsa.id",
    });
    expect(result.current.editLogoPreview).toBe("/api/v1/tenants/t1/logo");
    expect(result.current.editLogoKeep).toBe(true);
  });

  it("a tenant whose logo the backend will not serve gets no preview and form defaults", async () => {
    const { result } = await setup();
    act(() => result.current.handleEdit({ id: "t3", name: "Bare", code: "BR", status: "suspended", logoBaseUrl: null } as unknown as Tenant));
    expect(result.current.editLogoPreview).toBe("");
    expect(result.current.editLogoKeep).toBe(false);
    expect(result.current.editForm).toMatchObject({ description: "", primaryColor: "#4f46e5", website: "" });
    // A-303: the seat limit is not an edit field.
    expect(result.current.editForm).not.toHaveProperty("maxUsers");
  });

  it("update sends the tenant id and the edited fields, then closes; nothing without a tenant", async () => {
    tenantService.update.mockResolvedValue(rsA);
    const { result } = await setup();
    await act(async () => result.current.handleUpdate(ev));
    expect(tenantService.update).not.toHaveBeenCalled();

    act(() => result.current.handleEdit(rsA));
    act(() => result.current.setEditForm((f) => ({ ...f, status: "suspended", website: "" })));
    await act(async () => result.current.handleUpdate(ev));
    // A-303: an emptied profile field is sent as "" (it clears); no maxUsers is sent.
    expect(tenantService.update).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t1", name: "RS A", code: "RSA", website: "", city: "Jakarta", file: undefined,
    }));
    expect(tenantService.update.mock.calls[0][0]).not.toHaveProperty("maxUsers");
    // A-326 / ADR-112: an edit never carries a status, whatever the form holds.
    expect(tenantService.update.mock.calls[0][0]).not.toHaveProperty("status");
    expect(result.current.showEditModal).toBe(false);
    expect(result.current.editingTenant).toBeNull();
    expect(result.current.editLogoPreview).toBe("");
  });

  it("a refused update keeps the edit modal open with the reason", async () => {
    const { result } = await setup();
    act(() => result.current.handleEdit(rsA));
    tenantService.update.mockRejectedValueOnce(httpError(409, "The default tenant cannot be suspended"));
    await act(async () => result.current.handleUpdate(ev));
    expect(result.current.formError).toBe("The default tenant cannot be suspended");
    expect(result.current.showEditModal).toBe(true);
    tenantService.update.mockRejectedValueOnce(null);
    await act(async () => result.current.handleUpdate(ev));
    expect(result.current.formError).toBe("Failed to update tenant");
  });

  it("delete: the confirm opens by request and closes either way; a refusal is the store's error", async () => {
    const { result } = await setup();
    act(() => result.current.handleDeleteRequest("t1"));
    expect(result.current.showDeleteConfirm).toBe("t1");
    tenantService.delete.mockRejectedValueOnce(httpError(409, "Tenant still has users"));
    await act(async () => result.current.handleDelete("t1"));
    expect(result.current.showDeleteConfirm).toBeNull();
    expect(result.current.error).toBe("Tenant still has users");

    tenantService.delete.mockResolvedValueOnce(undefined);
    await act(async () => result.current.handleDelete("t1"));
    expect(tenantService.delete).toHaveBeenLastCalledWith("t1");
  });

  it("A-326 / ADR-112: suspend and resume go through the lifecycle service, then the modal shows the new status", async () => {
    const { result } = await setup();
    await act(async () => result.current.handleLifecycle("suspend", "Contract ended"));
    expect(tenantLifecycleService.suspend).not.toHaveBeenCalled(); // no tenant being edited

    act(() => result.current.handleEdit(rsA));
    tenantLifecycleService.suspend.mockResolvedValueOnce({ tenantId: "t1", status: "suspended" });
    await act(async () => result.current.handleLifecycle("suspend", "Contract ended"));
    expect(tenantLifecycleService.suspend).toHaveBeenCalledWith("t1", "Contract ended");
    expect(result.current.editingTenant?.status).toBe("suspended");
    expect(result.current.editForm.status).toBe("suspended");
    expect(tenantService.update).not.toHaveBeenCalled();

    tenantLifecycleService.resume.mockResolvedValueOnce(undefined);
    await act(async () => result.current.handleLifecycle("resume"));
    expect(tenantLifecycleService.resume).toHaveBeenCalledWith("t1");
    expect(result.current.editingTenant?.status).toBe("active");
  });

  it("a refused lifecycle action keeps the modal open with the reason", async () => {
    const { result } = await setup();
    act(() => result.current.handleEdit(rsA));
    tenantLifecycleService.suspend.mockRejectedValueOnce(httpError(409, "The default tenant cannot be suspended"));
    await act(async () => result.current.handleLifecycle("suspend", "x"));
    expect(result.current.formError).toBe("The default tenant cannot be suspended");
    expect(result.current.showEditModal).toBe(true);
    tenantLifecycleService.resume.mockRejectedValueOnce(null);
    await act(async () => result.current.handleLifecycle("resume"));
    expect(result.current.formError).toBe("Failed to resume tenant");
  });

  it("the SSO panel opens for the chosen tenant", async () => {
    const { result } = await setup();
    act(() => result.current.handleSsoClick(rsA));
    expect(result.current.showSsoPanel).toBe(true);
    expect(result.current.ssoConfigTenant).toBe(rsA);
  });
});
