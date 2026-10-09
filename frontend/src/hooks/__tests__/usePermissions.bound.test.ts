/** @jest-environment jsdom */
/**
 * P18-03 G-P8 (first user: P22-01) — `usePermissions().facilityBound` reads the server's
 * `facilityBound` from GET /menu-groups/my-permissions; absent (a state set before the field
 * existed) or not loaded reads as unbound. The slug checks are unchanged by it: the server has
 * already capped a bound account's permissions (P18-03 § 5), so the hook adds no role logic.
 */
import { renderHook } from "@testing-library/react";
import { useMenuStore } from "@/stores/menuStore";
import { usePermissions } from "../usePermissions";

describe("usePermissions — facilityBound (G-P8)", () => {
  it("is true for a bound account, and leaves its granted slugs as granted", () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { ipm: "write", "ipm-templates": "read" } } });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.facilityBound).toBe(true);
    expect(result.current.canWrite("ipm")).toBe(true);
    expect(result.current.canRead("ipm-templates")).toBe(true);
    expect(result.current.canWrite("ipm-templates")).toBe(false);
  });

  it("is false when the server says unbound, when the field is absent, and before the permissions load", () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: false, permissions: {} } });
    expect(renderHook(() => usePermissions()).result.current.facilityBound).toBe(false);
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, permissions: {} } });
    expect(renderHook(() => usePermissions()).result.current.facilityBound).toBe(false);
    useMenuStore.setState({ effectivePermissions: null });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.loaded).toBe(false);
    expect(result.current.facilityBound).toBe(false);
  });
});
