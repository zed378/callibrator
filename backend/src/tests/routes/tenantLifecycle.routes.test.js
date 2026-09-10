jest.mock("archiver", () => jest.fn());
const tenantLifecycleRoutes = require("../../routes/api/tenantLifecycle.route");

describe("Tenant Lifecycle Routes", () => {
  it("should export an Express router", () => {
    expect(tenantLifecycleRoutes).toBeDefined();
    expect(typeof tenantLifecycleRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(tenantLifecycleRoutes.stack)).toBe(true);
    expect(tenantLifecycleRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /:tenantId/status route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/status" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/suspend route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/suspend" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/resume route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/resume" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/grace-period route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/grace-period" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/offboard route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/offboard" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/offboard/cancel route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/offboard/cancel" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/export route", () => {
    const route = tenantLifecycleRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/export" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });
});
