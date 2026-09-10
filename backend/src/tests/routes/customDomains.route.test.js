/**
 * Custom Domains Routes Tests
 *
 * Tests the Custom Domains route registrations and middleware chain.
 */
const customDomainsRoutes = require("../../routes/api/customDomains.route");

describe("Custom Domains Routes", () => {
  it("should export an Express router", () => {
    expect(customDomainsRoutes).toBeDefined();
    expect(typeof customDomainsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(customDomainsRoutes.stack)).toBe(true);
    expect(customDomainsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = customDomainsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /domains", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /domains", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /domains/:domainId/verify", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains/:domainId/verify" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE route for /domains/:domainId", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains/:domainId" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /domains/:domainId/status", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains/:domainId/status" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /domains/:domainId/default", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains/:domainId/default" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /domains/:domainId/dns", () => {
    const routes = customDomainsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/domains/:domainId/dns" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = customDomainsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = customDomainsRoutes.stack.some((layer) => layer.route);
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using GET, POST, or DELETE methods", () => {
    customDomainsRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPost = methods.post === true;
        const hasDelete = methods.delete === true;
        expect(hasGet || hasPost || hasDelete).toBe(true);
      }
    });
  });

  it("should have exactly 7 route endpoints", () => {
    const routeCount = customDomainsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(7);
  });
});
