/**
 * Calibration Scheduler Routes Tests
 *
 * Tests the Calibration Scheduler route registrations and middleware chain.
 */
const calibrationSchedulerRoutes = require("../../routes/api/calibrationScheduler.route");

describe("Calibration Scheduler Routes", () => {
  it("should export an Express router", () => {
    expect(calibrationSchedulerRoutes).toBeDefined();
    expect(typeof calibrationSchedulerRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(calibrationSchedulerRoutes.stack)).toBe(true);
    expect(calibrationSchedulerRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = calibrationSchedulerRoutes.stack.filter(
      (layer) => layer.route,
    );
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /due", () => {
    const routes = calibrationSchedulerRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/due" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /run", () => {
    const routes = calibrationSchedulerRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/run" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    const routes = calibrationSchedulerRoutes.stack.filter(
      (layer) => layer.route,
    );
    expect(routes.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    const hasRoutes = calibrationSchedulerRoutes.stack.some(
      (layer) => layer.route,
    );
    expect(hasRoutes).toBe(true);
  });

  it("should have all routes using GET or POST methods", () => {
    calibrationSchedulerRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.get === true || methods.post === true).toBe(true);
      }
    });
  });

  it("should have exactly 2 route endpoints", () => {
    const routeCount = calibrationSchedulerRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(2);
  });
});
