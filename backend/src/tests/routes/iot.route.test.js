/**
 * IoT Routes Tests
 *
 * Tests the IoT route registrations and middleware chain.
 */
const iotRoutes = require("../../routes/api/iot.route");
const { auth } = require("../../middlewares/auth.middleware");

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

  // A-29 / A-46: provisioning routes joined ingest. Each is gated; ingest is
  // the one unauthenticated route and carries the rate limiter instead.
  it("has ingest plus the four provisioning routes, and nothing else", () => {
    const routes = iotRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods).join(",")} ${layer.route.path}`);
    expect(routes.sort()).toEqual(
      [
        "post /ingest",
        "get /devices/:deviceId",
        "patch /devices/:deviceId",
        "post /devices/:deviceId/token",
        "delete /devices/:deviceId/token",
      ].sort(),
    );
  });

  it("gates every provisioning route with auth; ingest carries a rate limiter", () => {
    for (const layer of iotRoutes.stack.filter((l) => l.route)) {
      if (layer.route.path === "/ingest") {
        expect(layer.route.stack).toHaveLength(2); // the limiter, then the controller
      } else {
        expect(layer.route.stack[0].handle).toBe(auth);
        // auth, validateUuid, dynamicAccess (+ denyApiKey, rbac on writes), controller
        expect(layer.route.stack.length).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
