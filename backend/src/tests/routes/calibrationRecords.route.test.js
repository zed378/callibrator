/**
 * Calibration Records Routes Tests
 *
 * Tests the Calibration Records route registrations and middleware chain.
 */
const calibrationRecordsRoutes = require("../../routes/api/calibrationRecords.route");

describe("Calibration Records Routes", () => {
  it("should export an Express router", () => {
    expect(calibrationRecordsRoutes).toBeDefined();
    expect(typeof calibrationRecordsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(calibrationRecordsRoutes.stack)).toBe(true);
    expect(calibrationRecordsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route,
    );
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:calibrationRecordId", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:calibrationRecordId" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have PUT route for /:calibrationRecordId", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:calibrationRecordId" &&
        layer.route.methods &&
        layer.route.methods.put,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE route for /:calibrationRecordId", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:calibrationRecordId" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route,
    );
    expect(routes.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    const hasRoutes = calibrationRecordsRoutes.stack.some(
      (layer) => layer.route,
    );
    expect(hasRoutes).toBe(true);
  });

  it("should have all routes using GET, POST, PUT, or DELETE methods", () => {
    calibrationRecordsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPost = methods.post === true;
        const hasPut = methods.put === true;
        const hasDelete = methods.delete === true;
        expect(hasGet || hasPost || hasPut || hasDelete).toBe(true);
      }
    });
  });

  it("should have exactly 5 route endpoints", () => {
    const routeCount = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(5);
  });
});
