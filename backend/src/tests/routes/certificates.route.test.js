/**
 * Certificates Routes Tests
 *
 * Tests the Certificates route registrations and middleware chain.
 */
const certificatesRoutes = require("../../routes/api/certificates.route");

describe("Certificates Routes", () => {
  it("should export an Express router", () => {
    expect(certificatesRoutes).toBeDefined();
    expect(typeof certificatesRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(certificatesRoutes.stack)).toBe(true);
    expect(certificatesRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = certificatesRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /verify/:certificateNumber", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/verify/:certificateNumber" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /stats", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/stats" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:certificateId", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have PUT route for /:certificateId", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId" &&
        layer.route.methods &&
        layer.route.methods.put,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE route for /:certificateId", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:certificateId/approve", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId/approve" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:certificateId/sign", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId/sign" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:certificateId/revoke", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId/revoke" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:certificateId/pdf", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId/pdf" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:certificateId/pdf", () => {
    const routes = certificatesRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:certificateId/pdf" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = certificatesRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = certificatesRoutes.stack.some((layer) => layer.route);
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using GET, POST, PUT, or DELETE methods", () => {
    certificatesRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const hasGet = methods.get === true;
        const hasPost = methods.post === true;
        const hasPut = methods.put === true;
        const hasDelete = methods.delete === true;
        expect(hasGet || hasPost || hasPut || hasDelete).toBe(true);
      }
    });
  });

  it("should have exactly 13 route endpoints", () => {
    const routeCount = certificatesRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(13);
  });
});
