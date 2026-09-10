/**
 * Calibration Devices Routes Tests
 */
const calibrationDevicesRoutes = require("../../routes/api/calibrationDevices.route");

describe("Calibration Devices Routes", () => {
  it("should export an Express router", () => {
    expect(calibrationDevicesRoutes).toBeDefined();
    expect(typeof calibrationDevicesRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(calibrationDevicesRoutes.stack)).toBe(true);
    expect(calibrationDevicesRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET / route", () => {
    const route = calibrationDevicesRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST / route", () => {
    const route = calibrationDevicesRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /:calibrationDeviceId route", () => {
    const route = calibrationDevicesRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/:calibrationDeviceId" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /bulk-import route", () => {
    const route = calibrationDevicesRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/bulk-import" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });
});
