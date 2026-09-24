/**
 * F-65 — viewing or editing a tenant does not switch the super admin into it.
 * F-64 — a failed tenant update/delete reaches the caller.
 *
 * Fail-before: fetchTenantById and updateTenant wrote x_tenant_id (sent as
 * X-Tenant-ID, honoured for a super admin); updateTenant/deleteTenant
 * swallowed failures.
 */
const tenantService = {
  getVisible: jest.fn(),
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
};
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));

import type { StoreApi, UseBoundStore } from "zustand";
import { useTenantStore } from "../tenantStore";
import { describeStoreContract } from "@/tests/support/storeContract";

type AnyStore = UseBoundStore<StoreApi<Record<string, unknown>>>;
const page = { data: [{ id: "tB" }], meta: { page: 3, limit: 10, totalPages: 3 } };

const clearCookies = () =>
  document.cookie.split(";").forEach((c) => {
    const name = c.split("=")[0].trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
const tenantCookie = () =>
  document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("x_tenant_id="));

beforeEach(() => {
  Object.values(tenantService).forEach((m) => m.mockReset());
  clearCookies();
  useTenantStore.setState({ tenants: page as never, currentTenant: null, listTenantId: null, error: null });
});

describe("tenantStore (F-65: no silent tenant switch)", () => {
  it("viewing a tenant does not write x_tenant_id", async () => {
    tenantService.getById.mockResolvedValue({ id: "tB" });
    await useTenantStore.getState().fetchTenantById("tB");
    expect(useTenantStore.getState().currentTenant).toEqual({ id: "tB" });
    expect(tenantCookie()).toBeUndefined();
  });

  it("editing a tenant does not write x_tenant_id, and refetches the list it holds", async () => {
    tenantService.update.mockResolvedValue({ id: "tB", name: "B2" });
    tenantService.getVisible.mockResolvedValue(page);
    await useTenantStore.getState().updateTenant({ tenantId: "tB", name: "B2" });
    expect(tenantCookie()).toBeUndefined();
    expect(tenantService.getVisible).toHaveBeenCalledWith(3, 10, undefined, null);
  });

  it("an explicit switch (selectTenant) is the one thing that writes it — and clears it", () => {
    useTenantStore.getState().selectTenant({ id: "tB" } as never);
    expect(tenantCookie()).toBe("x_tenant_id=tB");
    useTenantStore.getState().selectTenant(null);
    expect(tenantCookie()).toBeUndefined();
  });

  it("F-64: a failed update rethrows (the modal stays open with the message)", async () => {
    tenantService.update.mockRejectedValue(new Error("Code already in use"));
    await expect(
      useTenantStore.getState().updateTenant({ tenantId: "tB", code: "X" }),
    ).rejects.toThrow("Code already in use");
    expect(useTenantStore.getState().error).toBe("Code already in use");
  });

  it("deleting the selected tenant clears the selection and its cookie; a failure rethrows", async () => {
    useTenantStore.getState().selectTenant({ id: "tB" } as never);
    tenantService.delete.mockResolvedValue(undefined);
    tenantService.getVisible.mockResolvedValue(page);
    await useTenantStore.getState().deleteTenant("tB");
    expect(useTenantStore.getState().currentTenant).toBeNull();
    expect(tenantCookie()).toBeUndefined();

    tenantService.delete.mockRejectedValue(new Error("Tenant has users"));
    await expect(useTenantStore.getState().deleteTenant("tC")).rejects.toThrow("Tenant has users");
  });

  it("A-76: a refetch keeps the list scope it was loaded with", async () => {
    tenantService.getVisible.mockResolvedValue(page);
    await useTenantStore.getState().fetchTenants(1, 25, "b", "own-tenant");
    expect(tenantService.getVisible).toHaveBeenLastCalledWith(1, 25, "b", "own-tenant");
    await useTenantStore.getState().refetchTenants();
    expect(tenantService.getVisible).toHaveBeenLastCalledWith(3, 10, undefined, "own-tenant");
    tenantService.create.mockResolvedValue({ id: "tN" });
    await useTenantStore.getState().createTenant({ name: "N", code: "N" });
    expect(tenantService.getVisible).toHaveBeenLastCalledWith(3, 10, undefined, "own-tenant");
  });

  it("settings: a merge into the loaded settings; nothing to merge into leaves them unset", async () => {
    tenantService.updateSettings.mockResolvedValue(undefined);
    useTenantStore.setState({ settings: null });
    await useTenantStore.getState().updateTenantSettings("t1", { sso_enabled: true } as never);
    expect(useTenantStore.getState().settings).toBeNull();

    useTenantStore.setState({ settings: { settings: { a: 1 } } as never });
    await useTenantStore.getState().updateTenantSettings("t1", { sso_enabled: true } as never);
    expect(useTenantStore.getState().settings).toEqual({ settings: { a: 1, sso_enabled: true } });

    tenantService.updateSettings.mockRejectedValue("x");
    await expect(
      useTenantStore.getState().updateTenantSettings("t1", {} as never),
    ).rejects.toBe("x");
    expect(useTenantStore.getState().error).toBe("Failed to update tenant settings");
  });
});

describeStoreContract(
  "tenantStore",
  useTenantStore as unknown as AnyStore,
  tenantService,
  { tenants: null, currentTenant: null, settings: null, listTenantId: null, isLoading: false, error: null },
  [
    { action: "fetchTenants", args: [1, 25, "x", null], method: "getVisible", resolved: page, stateKey: "tenants", rethrows: false, fallback: "Failed to fetch tenants" },
    { action: "fetchTenantById", args: ["t1"], method: "getById", resolved: { id: "t1" }, stateKey: "currentTenant", rethrows: false, fallback: "Failed to fetch tenant" },
    { action: "fetchTenantSettings", args: ["t1"], method: "getSettings", resolved: { settings: {} }, rethrows: true, fallback: "Failed to fetch tenant settings" },
  ],
);
