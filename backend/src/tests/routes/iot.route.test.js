/**
 * IoT Routes Tests
 *
 * Tests the IoT route registrations and middleware chain.
 */
const iotRoutes = require("../../routes/api/iot.route");

describe("IoT Routes", () => {
  it("should export an Express router", () => {
    expect(iotRoutes).toBeDefined();
    expect(typeof iotRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(iotRoutes.stack)).toBe(true);
    expect(iotRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = iotRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST route for /ingest", () => {
    const routes = iotRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/ingest" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have exactly 1 route endpoint", () => {
    const routeCount = iotRoutes.stack.filter((layer) => layer.route).length;
    expect(routeCount).toBe(1);
  });

  it("should have all routes using POST method", () => {
    iotRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.post === true).toBe(true);
      }
    });
  });
});
