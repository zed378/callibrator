/**
 * API Keys Routes Tests
 *
 * Tests the API Keys route registrations and middleware chain.
 */
const apiKeysRoutes = require("../../routes/api/apiKeys.route");

describe("API Keys Routes", () => {
  it("should export an Express router", () => {
    expect(apiKeysRoutes).toBeDefined();
    expect(typeof apiKeysRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(apiKeysRoutes.stack)).toBe(true);
    expect(apiKeysRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = apiKeysRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST route for /", () => {
    const postRoutes = apiKeysRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(postRoutes.length).toBe(1);
  });

  it("should have GET route for /", () => {
    const getRoutes = apiKeysRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(getRoutes.length).toBe(1);
  });

  it("should have GET route for /:id", () => {
    const getRoutes = apiKeysRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(getRoutes.length).toBe(1);
  });

  it("should have DELETE route for /:id", () => {
    const deleteRoutes = apiKeysRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(deleteRoutes.length).toBe(1);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = apiKeysRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = apiKeysRoutes.stack.some((layer) => layer.route);
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using POST, GET, or DELETE methods", () => {
    apiKeysRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasPost = methods.post === true;
        const hasGet = methods.get === true;
        const hasDelete = methods.delete === true;
        expect(hasPost || hasGet || hasDelete).toBe(true);
      }
    });
  });

  it("should have exactly 4 route endpoints", () => {
    const routeCount = apiKeysRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(4);
  });
});
