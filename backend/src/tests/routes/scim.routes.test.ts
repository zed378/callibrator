/**
 * SCIM Routes Tests
 */

interface ScimRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface ScimRouter {
    handle: unknown;
    stack: ScimRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const scimRoutes = require("../../routes/api/scim.route") as ScimRouter;

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
      (layer) => layer.route?.path === "/Users" && layer.route.methods["get"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Users/:id" && layer.route.methods["get"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have POST /Users route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Users" && layer.route.methods["post"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have PUT /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Users/:id" && layer.route.methods["put"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have PATCH /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Users/:id" && layer.route.methods["patch"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Users/:id" && layer.route.methods["delete"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have GET /Groups route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Groups" && layer.route.methods["get"] === true,
    );
    expect(route).toBeDefined();
  });

  it("should have DELETE /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) => layer.route?.path === "/Groups/:id" && layer.route.methods["delete"] === true,
    );
    expect(route).toBeDefined();
  });
});
