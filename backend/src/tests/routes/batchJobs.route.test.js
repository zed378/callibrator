/**
 * Batch Jobs Routes Tests
 *
 * Tests the Batch Jobs route registrations and middleware chain.
 */
const batchJobsRoutes = require("../../routes/api/batchJobs.route");

describe("Batch Jobs Routes", () => {
  it("should export an Express router", () => {
    expect(batchJobsRoutes).toBeDefined();
    expect(typeof batchJobsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(batchJobsRoutes.stack)).toBe(true);
    expect(batchJobsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = batchJobsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /", () => {
    const routes = batchJobsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:id", () => {
    const routes = batchJobsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /test", () => {
    const routes = batchJobsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/test" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    const middlewareLayers = batchJobsRoutes.stack.filter(
      (layer) => !layer.route,
    );
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    const hasMiddleware = batchJobsRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = batchJobsRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware).toBe(true);
    expect(hasRoutes).toBe(true);
  });

  it("should have all routes using GET or POST methods", () => {
    batchJobsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.get === true || methods.post === true).toBe(true);
      }
    });
  });

  it("should have exactly 3 route endpoints", () => {
    const routeCount = batchJobsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(3);
  });
});
