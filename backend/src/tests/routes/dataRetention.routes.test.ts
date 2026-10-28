/**
 * Data Retention Routes Tests
 */

interface DataRetentionRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface DataRetentionRouter {
    handle: unknown;
    stack: DataRetentionRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const dataRetentionRoutes = require("../../routes/api/dataRetention.route") as DataRetentionRouter;

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
      (layer) => layer.route?.path === "/:tenantId/policy" && layer.route.methods["get"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /:tenantId/policy route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/policy" && layer.route.methods["put"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/legal-hold" && layer.route.methods["get"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/legal-hold" && layer.route.methods["post"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:tenantId/legal-hold route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/legal-hold" && layer.route.methods["delete"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/purge route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/purge" && layer.route.methods["post"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/mask-pii route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/mask-pii" && layer.route.methods["post"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /:tenantId/anonymize route", () => {
    const route = dataRetentionRoutes.stack.find(
      (layer) => layer.route?.path === "/:tenantId/anonymize" && layer.route.methods["post"] === true,
    );
    expect(route).toBeDefined();
  });
});
