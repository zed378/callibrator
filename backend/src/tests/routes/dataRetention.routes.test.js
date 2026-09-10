/**
 * Data Retention Routes Tests
 */
const dataRetentionRoutes = require("../../routes/api/dataRetention.route");

describe("Data Retention Routes", () => {
  it("should export an Express router", () => {
    expect(dataRetentionRoutes).toBeDefined();
    expect(typeof dataRetentionRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(dataRetentionRoutes.stack)).toBe(true);
    expect(dataRetentionRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /:tenantId/policy route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/policy" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /:tenantId/policy route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/policy" && layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/legal-hold" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/legal-hold" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/legal-hold" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/purge route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/purge" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/mask-pii route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/mask-pii" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/anonymize route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:tenantId/anonymize" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });
});
