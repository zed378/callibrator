jest.mock("archiver", () => jest.fn());
const gdprRoutes = require("../../routes/api/gdpr.route");

describe("GDPR Routes", () => {
  it("should export an Express router", () => {
    expect(gdprRoutes).toBeDefined();
    expect(typeof gdprRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(gdprRoutes.stack)).toBe(true);
    expect(gdprRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have POST /export route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/export" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /erasure route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/erasure" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /erasure/:requestId route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/erasure/:requestId" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /consent route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/consent" && layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /consent/history route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/consent/history" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /processing route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/processing" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /rectify route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/rectify" && layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /restrict route", () => {
    const route = gdprRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/restrict" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });
});
