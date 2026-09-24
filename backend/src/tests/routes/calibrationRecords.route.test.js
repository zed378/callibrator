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

  // P6-03 — a calibration record is append-only: no PUT, no DELETE.
  it.each(["put", "patch", "delete"])("has NO %s route on /:calibrationRecordId", (method) => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route && layer.route.path.startsWith("/:calibrationRecordId") && layer.route.methods[method],
    );
    expect(routes).toHaveLength(0);
  });

  it.each(["/:calibrationRecordId/corrections", "/:calibrationRecordId/void"])(
    "has a POST route for %s behind the full middleware chain",
    (path) => {
      const routes = calibrationRecordsRoutes.stack.filter(
        (layer) => layer.route && layer.route.path === path && layer.route.methods.post,
      );
      expect(routes).toHaveLength(1);
      // auth, validateUuid, dynamicAccess("calibration", "write"), denyPlatformAuthoring, controller
      const names = routes[0].route.stack.map((l) => l.name);
      expect(names).toHaveLength(5);
      expect(names[3]).toBe("denyPlatformAuthoring");
    },
  );
});
