/**
 * Tenant Routes Tests
 *
 * Tests the tenant route registrations and middleware chain.
 */
const tenantRoutes = require("../../routes/api/tenant.route");

describe("Tenant Routes", () => {
  it("should export an Express router", () => {
    expect(tenantRoutes).toBeDefined();
    expect(typeof tenantRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(tenantRoutes.stack)).toBe(true);
    expect(tenantRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    // Count all layers that have a route property (nested routes)
    const allRoutes = tenantRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(5);
  });

  it("should have route paths defined", () => {
    // Express routers store paths in layer.route.path property
    const paths = tenantRoutes.stack
      .filter((layer) => layer.route && layer.route.path)
      .map((layer) => layer.route.path);

    // Should have paths like /all, /detail, /public, /create, /edit, /delete, etc.
    const pathSet = new Set(paths);
    expect(pathSet.size).toBeGreaterThan(0);
  });

  it("should have GET method routes", () => {
    // GET routes are stored in the stack with route.methods.get
    const getRoutes = tenantRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.get,
    );
    expect(getRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST method routes", () => {
    const postRoutes = tenantRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.post,
    );
    expect(postRoutes.length).toBeGreaterThan(0);
  });

  it("should have PATCH method routes", () => {
    const patchRoutes = tenantRoutes.stack.filter(
      (layer) =>
        layer.route && layer.route.methods && layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBeGreaterThan(0);
  });

  it("should have DELETE method routes", () => {
    const deleteRoutes = tenantRoutes.stack.filter(
      (layer) =>
        layer.route && layer.route.methods && layer.route.methods.delete,
    );
    expect(deleteRoutes.length).toBeGreaterThan(0);
  });

  it("should have public route (no auth) at /public", () => {
    // The /public route should be registered
    const publicLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/public";
    });
    expect(publicLayers.length).toBeGreaterThan(0);
  });

  it("should have create route", () => {
    const createLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/create";
    });
    expect(createLayers.length).toBeGreaterThan(0);
  });

  it("should have edit route", () => {
    const editLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/edit";
    });
    expect(editLayers.length).toBeGreaterThan(0);
  });

  it("should have delete route", () => {
    const deleteLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/delete";
    });
    expect(deleteLayers.length).toBeGreaterThan(0);
  });

  it("should have settings route", () => {
    const settingsLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/settings";
    });
    expect(settingsLayers.length).toBeGreaterThan(0);
  });

  it("should have user-count route", () => {
    const userCountLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/user-count";
    });
    expect(userCountLayers.length).toBeGreaterThan(0);
  });

  it("should have detail route", () => {
    const detailLayers = tenantRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/detail";
    });
    expect(detailLayers.length).toBeGreaterThan(0);
  });
});
