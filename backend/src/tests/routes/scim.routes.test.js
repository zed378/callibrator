/**
 * SCIM Routes Tests
 */
const scimRoutes = require("../../routes/api/scim.route");

describe("SCIM Routes", () => {
  it("should export an Express router", () => {
    expect(scimRoutes).toBeDefined();
    expect(typeof scimRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(scimRoutes.stack)).toBe(true);
    expect(scimRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET /Users route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users/:id" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /Users route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users" && layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users/:id" && layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users/:id" && layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Users/:id" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /Groups route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Groups" && layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route && layer.route.path === "/Groups/:id" && layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });
});
