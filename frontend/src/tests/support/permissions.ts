/**
 * ADR-102 — give a test the effective permissions the page reads through
 * `usePermissions` (GET /menu-groups/my-permissions, held in the menu store),
 * instead of a role name. `grantPermissions({ qms: "write" })` for a tenant
 * user; `grantSuperAdmin()` for the platform super admin; `clearPermissions()`
 * for "not loaded yet".
 */
import { useMenuStore } from "@/stores/menuStore";

export const grantPermissions = (permissions: Record<string, "read" | "write">): void => {
  useMenuStore.setState({ effectivePermissions: { superAdmin: false, permissions } });
};

export const grantSuperAdmin = (): void => {
  useMenuStore.setState({ effectivePermissions: { superAdmin: true, permissions: {} } });
};

export const clearPermissions = (): void => {
  useMenuStore.setState({ effectivePermissions: null });
};
