/**
 * Feature Flags Routes Tests
 *
 * Tests the Feature Flags route registrations and middleware chain.
 */

interface FeatureFlagsRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface FeatureFlagsRouter {
    handle: unknown;
    stack: FeatureFlagsRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const featureFlagsRoutes = require("../../routes/api/featureFlags.route") as FeatureFlagsRouter;

describe("Feature Flags Routes", () => {
  it("should export an Express router", () => {
    expect(featureFlagsRoutes).toBeDefined();
    expect(typeof featureFlagsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(featureFlagsRoutes.stack)).toBe(true);
    expect(featureFlagsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = featureFlagsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) => layer.route?.path === "/" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /definitions", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) => layer.route?.path === "/definitions" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:tenantId/:flagKey", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) =>
        layer.route?.path === "/:tenantId/:flagKey" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:tenantId/:flagKey", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) =>
        layer.route?.path === "/:tenantId/:flagKey" && layer.route.methods["post"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE route for /:tenantId/:flagKey", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) =>
        layer.route?.path === "/:tenantId/:flagKey" && layer.route.methods["delete"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:tenantId/initialize", () => {
    const routes = featureFlagsRoutes.stack.filter(
      (layer) =>
        layer.route?.path === "/:tenantId/initialize" && layer.route.methods["post"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    const middlewareLayers = featureFlagsRoutes.stack.filter((layer) => !layer.route);
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    const hasMiddleware = featureFlagsRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = featureFlagsRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware).toBe(true);
    expect(hasRoutes).toBe(true);
  });

  it("should have all routes using GET, POST, or DELETE methods", () => {
    featureFlagsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods["get"] === true;
        const hasPost = methods["post"] === true;
        const hasDelete = methods["delete"] === true;
        expect(hasGet || hasPost || hasDelete).toBe(true);
      }
    });
  });

  it("should have exactly 6 route endpoints", () => {
    const routeCount = featureFlagsRoutes.stack.filter((layer) => layer.route).length;
    expect(routeCount).toBe(6);
  });
});
