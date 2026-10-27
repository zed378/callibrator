/**
 * Tenant Hierarchy Routes Tests
 */

interface TenantHierarchyRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface TenantHierarchyRouter {
    handle: unknown;
    stack: TenantHierarchyRouteLayer[];
}

const tenantHierarchyRoutes =
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
    require("../../routes/api/tenantHierarchy.route") as TenantHierarchyRouter;

describe("Tenant Hierarchy Routes", () => {
  it("should export an Express router", () => {
    expect(tenantHierarchyRoutes).toBeDefined();
    expect(typeof tenantHierarchyRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(tenantHierarchyRoutes.stack)).toBe(true);
    expect(tenantHierarchyRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /tree route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route?.path === "/tree" && layer.route.methods["get"],
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/children route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/children" && layer.route.methods["get"],
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:tenantId/parent route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/parent" && layer.route.methods["delete"],
    );
    expect(route).toBeDefined();
  });

  it("should have GET /cross-tenant-roles route", () => {
    const route = tenantHierarchyRoutes.stack.find(
      (layer) => layer.route?.path === "/cross-tenant-roles" && layer.route.methods["get"],
    );
    expect(route).toBeDefined();
  });
});
