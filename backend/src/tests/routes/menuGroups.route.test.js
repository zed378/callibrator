/**
 * Menu Groups Routes Tests
 *
 * Tests the Menu Groups route registrations and middleware chain.
 */
const menuGroupsRoutes = require("../../routes/api/menuGroups.route");

describe("Menu Groups Routes", () => {
  it("should export an Express router", () => {
    expect(menuGroupsRoutes).toBeDefined();
    expect(typeof menuGroupsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(menuGroupsRoutes.stack)).toBe(true);
    expect(menuGroupsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = menuGroupsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST route for /filter", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/filter" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /get-assignments", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/get-assignments" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /menu-groups", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/menu-groups" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /menu-groups/admin", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/menu-groups/admin" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /roles", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/roles" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /create", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/create" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /update", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/update" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /delete", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/delete" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /assign", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/assign" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /revoke", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/revoke" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /assign-item", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/assign-item" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /revoke-item", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/revoke-item" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /bulk-assign", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/bulk-assign" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /bulk-revoke", () => {
    const routes = menuGroupsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/bulk-revoke" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

    it("should have middleware or routes in stack", () => {
    const hasMiddleware = menuGroupsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = menuGroupsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

    it("should have middleware or routes in stack", () => {
    const hasMiddleware = menuGroupsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = menuGroupsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using GET or POST methods", () => {
    menuGroupsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.get === true || methods.post === true).toBe(true);
      }
    });
  });

  it("should have exactly 14 route endpoints", () => {
    const routeCount = menuGroupsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(14);
  });
});
