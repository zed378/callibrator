/**
 * E-Signature Routes Tests
 */
const eSignatureRoutes = require("../../routes/api/eSignature.route");

describe("E-Signature Routes", () => {
  it("should export an Express router", () => {
    expect(eSignatureRoutes).toBeDefined();
    expect(typeof eSignatureRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(eSignatureRoutes.stack)).toBe(true);
    expect(eSignatureRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /key-pairs route", () => {
    const route = eSignatureRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/key-pairs" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /key-pairs route", () => {
    const route = eSignatureRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/key-pairs" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /key-pairs/:keyPairId route", () => {
    const route = eSignatureRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/key-pairs/:keyPairId" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /workflows route", () => {
    const route = eSignatureRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/workflows" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /history route", () => {
    const route = eSignatureRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/history" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });
});
