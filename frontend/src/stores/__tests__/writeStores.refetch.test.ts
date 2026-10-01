/**
 * The users, tenants and tenant-backup stores beyond the generic contract:
 * a write re-reads the list at the page the screen is on, a failed write
 * leaves `error` for the screen's alert, and the backup list is stored as
 * rows + a separate `meta` (the service returns `{ data, meta }`).
 */
const userService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(),
  updateRole: jest.fn(), delete: jest.fn(),
};
const tenantService = {
  getVisible: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  getSettings: jest.fn(), updateSettings: jest.fn(),
};
const tenantBackupService = {
  getAll: jest.fn(), delete: jest.fn(), create: jest.fn(), getById: jest.fn(),
  downloadToDisk: jest.fn(), restore: jest.fn(), getStats: jest.fn(),
};
jest.mock("@/api/services/user.service", () => ({ userService }));
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));
jest.mock("@/api/services/tenantBackup.service", () => ({ tenantBackupService }));

import { useUserStore } from "../userStore";
import { useTenantStore } from "../tenantStore";
import { useTenantBackupStore } from "../tenantBackupStore";

const pageOf = (rows: unknown[], page = 1, limit = 50) => ({
  success: true, message: "", data: rows, meta: { total: rows.length, page, limit, totalPages: 1 },
});

beforeEach(() => {
  jest.clearAllMocks();
  useUserStore.setState({ users: null, currentUser: null, isLoading: false, error: null });
  useTenantBackupStore.setState({ backups: [], meta: null, currentBackup: null, stats: null, isLoading: false, error: null });
});

describe("userStore — writes re-read the current page", () => {
  it("create, update and delete each re-read the list at the page and page size on screen", async () => {
    useUserStore.setState({ users: pageOf([{ id: "u1" }], 3, 20) as never });
    const fresh = pageOf([{ id: "u1" }, { id: "u2" }], 3, 20);
    userService.getAll.mockResolvedValue(fresh);
    userService.create.mockResolvedValue({ id: "u2" });
    userService.update.mockResolvedValue({ id: "u1", email: "new@rs.id" });
    userService.delete.mockResolvedValue(undefined);

    await useUserStore.getState().createUser({ username: "b", firstName: "B", lastName: "C", email: "b@rs.id", password: "Pw#12345", roleId: "r1" });
    await useUserStore.getState().updateUser({ userId: "u1", email: "new@rs.id" });
    await useUserStore.getState().deleteUser("u2");

    expect(userService.getAll).toHaveBeenCalledTimes(3);
    for (const call of userService.getAll.mock.calls) expect(call).toEqual([3, 20]);
    expect(useUserStore.getState()).toMatchObject({ users: fresh, currentUser: { id: "u1", email: "new@rs.id" }, error: null, isLoading: false });
  });

  it("with no list loaded yet, the re-read uses page 1 and 50 per page", async () => {
    userService.create.mockResolvedValue({ id: "u1" });
    userService.getAll.mockResolvedValue(pageOf([{ id: "u1" }]));
    await useUserStore.getState().createUser({ username: "a", firstName: "A", lastName: "B", email: "a@rs.id", password: "Pw#12345", roleId: "r1" });
    expect(userService.getAll).toHaveBeenCalledWith(1, 50);
  });

  it("a refused create (409 username taken) rethrows for the form and keeps the message", async () => {
    userService.create.mockRejectedValue(new Error("Username already exists"));
    await expect(
      useUserStore.getState().createUser({ username: "a", firstName: "A", lastName: "B", email: "a@rs.id", password: "x", roleId: "r1" }),
    ).rejects.toThrow("Username already exists");
    expect(useUserStore.getState()).toMatchObject({ error: "Username already exists", isLoading: false });
    expect(userService.getAll).not.toHaveBeenCalled();
  });

  it("a failed delete or role change does not throw: the users page shows `error` in its alert", async () => {
    userService.delete.mockRejectedValue(new Error("User not found"));
    await expect(useUserStore.getState().deleteUser("gone")).resolves.toBeUndefined();
    expect(useUserStore.getState().error).toBe("User not found");

    userService.updateRole.mockRejectedValue("opaque");
    await useUserStore.getState().updateUserRole("u1", "r2");
    expect(useUserStore.getState().error).toBe("Failed to update user role");
  });

  it("updateUserRole sends the user and the role; refetchUsers and fetchUserById store their results", async () => {
    userService.updateRole.mockResolvedValue(undefined);
    await useUserStore.getState().updateUserRole("u1", "r2");
    expect(userService.updateRole).toHaveBeenCalledWith("u1", "r2");
    expect(useUserStore.getState().error).toBeNull();

    userService.getAll.mockRejectedValueOnce(new Error("Request failed with status code 429"));
    await useUserStore.getState().refetchUsers();
    expect(useUserStore.getState().error).toBe("Request failed with status code 429");

    userService.getById.mockRejectedValueOnce(new Error("User not found"));
    await useUserStore.getState().fetchUserById("other-tenant-user");
    expect(useUserStore.getState()).toMatchObject({ currentUser: null, error: "User not found" });
  });
});

describe("tenantStore — writes", () => {
  beforeEach(() => {
    useTenantStore.setState({ tenants: pageOf([{ id: "t1" }], 2, 25) as never, currentTenant: null, isLoading: false, error: null });
  });

  it("create returns the tenant and re-reads the visible list at the current page", async () => {
    tenantService.create.mockResolvedValue({ id: "t2" });
    const fresh = pageOf([{ id: "t1" }, { id: "t2" }], 2, 25);
    tenantService.getVisible.mockResolvedValue(fresh);

    const created = await useTenantStore.getState().createTenant({ name: "RS Dua", code: "RS2" } as never);

    expect(created).toEqual({ id: "t2" });
    expect(tenantService.getVisible.mock.calls[0].slice(0, 2)).toEqual([2, 25]);
    expect(useTenantStore.getState().tenants).toEqual(fresh);
  });

  it("a refused create (409 code in use) rethrows and keeps the message", async () => {
    tenantService.create.mockRejectedValue(new Error("Tenant code already exists"));
    await expect(useTenantStore.getState().createTenant({ name: "x" } as never)).rejects.toThrow("Tenant code already exists");
    expect(useTenantStore.getState().error).toBe("Tenant code already exists");
  });

  it("a failed refetch is an error, not an empty list", async () => {
    tenantService.getVisible.mockRejectedValue(new Error("Network Error"));
    await useTenantStore.getState().refetchTenants();
    expect(useTenantStore.getState()).toMatchObject({ error: "Network Error", isLoading: false });
    expect(useTenantStore.getState().tenants).not.toBeNull();
  });

  it("setError sets the message", () => {
    useTenantStore.getState().setError("boom");
    expect(useTenantStore.getState().error).toBe("boom");
  });
});

describe("tenantBackupStore — list and delete", () => {
  it("stores the rows and the pagination separately", async () => {
    const meta = { total: 1, page: 2, limit: 10, totalPages: 1 };
    tenantBackupService.getAll.mockResolvedValue({ data: [{ id: "b1" }], meta });

    await useTenantBackupStore.getState().fetchBackups("t1", 2, 10, "completed");

    expect(tenantBackupService.getAll).toHaveBeenCalledWith("t1", 2, 10, "completed");
    expect(useTenantBackupStore.getState()).toMatchObject({ backups: [{ id: "b1" }], meta, error: null, isLoading: false });
  });

  it("uses page 1 / 20 by default; a failed list keeps the previous rows and sets the error", async () => {
    useTenantBackupStore.setState({ backups: [{ id: "old" }] as never });
    tenantBackupService.getAll.mockRejectedValue(new Error("Tenant not found"));

    await useTenantBackupStore.getState().fetchBackups("t1");

    expect(tenantBackupService.getAll).toHaveBeenCalledWith("t1", 1, 20, undefined);
    expect(useTenantBackupStore.getState()).toMatchObject({ backups: [{ id: "old" }], error: "Tenant not found" });
  });

  it("delete calls the service with tenant and backup; a failure is kept in `error`", async () => {
    tenantBackupService.delete.mockResolvedValueOnce(undefined);
    await useTenantBackupStore.getState().deleteBackup("t1", "b1");
    expect(tenantBackupService.delete).toHaveBeenCalledWith("t1", "b1");
    expect(useTenantBackupStore.getState().error).toBeNull();

    tenantBackupService.delete.mockRejectedValueOnce("opaque");
    await useTenantBackupStore.getState().deleteBackup("t1", "b1");
    expect(useTenantBackupStore.getState().error).toBe("Failed to delete backup");

    useTenantBackupStore.getState().setError(null);
    expect(useTenantBackupStore.getState().error).toBeNull();
  });
});
