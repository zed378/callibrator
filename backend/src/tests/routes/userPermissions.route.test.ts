/**
 * UserPermissions Routes Tests
 *
 * Tests the userPermissions route registrations and middleware chain.
 * Endpoints: GET /:userId, POST /:userId, DELETE /:userId/:menuGroupId
 */

interface UserPermissionsRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface UserPermissionsRouter {
    handle: unknown;
    stack: UserPermissionsRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const userPermissionsRoutes = require("../../routes/api/userPermissions.route") as UserPermissionsRouter;

describe("UserPermissions Routes", () => {
  it("should export an Express router", () => {
    expect(userPermissionsRoutes).toBeDefined();
    expect(typeof userPermissionsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(userPermissionsRoutes.stack)).toBe(true);
    expect(userPermissionsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have route handlers registered", () => {
    const allRoutes = userPermissionsRoutes.stack.filter(
      (layer) => layer.route,
    );
    expect(allRoutes.length).toBe(3);
  });

  it("should have GET /:userId route", () => {
    const routes = userPermissionsRoutes.stack.filter(
      (layer) => layer.route?.path === "/:userId" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST /:userId route", () => {
    const routes = userPermissionsRoutes.stack.filter(
      (layer) => layer.route?.path === "/:userId" && layer.route.methods["post"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE /:userId/:menuGroupId route", () => {
    const routes = userPermissionsRoutes.stack.filter(
      (layer) => layer.route?.path === "/:userId/:menuGroupId" && layer.route.methods["delete"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = userPermissionsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = userPermissionsRoutes.stack.some(
      (layer) => layer.route,
    );
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using valid HTTP methods", () => {
    userPermissionsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const validMethods = ["get", "post", "put", "patch", "delete"];
        const hasValidMethod = validMethods.some((m) => methods[m] === true);
        expect(hasValidMethod).toBe(true);
      }
    });
  });

  it("should have exactly 3 route endpoints", () => {
    const routeCount = userPermissionsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(3);
  });
});
