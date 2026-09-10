/**
 * Kanban Routes Tests
 *
 * Tests the Kanban route registrations and middleware chain.
 */
const kanbanRoutes = require("../../routes/api/kanban.route.js");

describe("Kanban Routes", () => {
  it("should export an Express router", () => {
    expect(kanbanRoutes).toBeDefined();
    expect(typeof kanbanRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(kanbanRoutes.stack)).toBe(true);
    expect(kanbanRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = kanbanRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = kanbanRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = kanbanRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    kanbanRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const validMethods = ["get", "post", "put", "patch", "delete"];
        const hasValidMethod = validMethods.some((m) => methods[m] === true);
        expect(hasValidMethod).toBe(true);
      }
    });
  });
});
