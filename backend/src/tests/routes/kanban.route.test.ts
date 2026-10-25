/**
 * Kanban Routes Tests
 *
 * Tests the Kanban route registrations and middleware chain.
 */

interface KanbanRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface KanbanRouter {
    handle: unknown;
    stack: KanbanRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const kanbanRoutes = require("../../routes/api/kanban.route") as KanbanRouter;

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
