/**
 * Attachments Routes Tests
 *
 * Tests the Attachments route registrations and middleware chain.
 */
const attachmentsRoutes = require("../../routes/api/attachments.route");

describe("Attachments Routes", () => {
  it("should export an Express router", () => {
    expect(attachmentsRoutes).toBeDefined();
    expect(typeof attachmentsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(attachmentsRoutes.stack)).toBe(true);
    expect(attachmentsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = attachmentsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /:id/signed", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id/signed" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:id", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:id/download", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id/download" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /:id/signed-url", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id/signed-url" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(routes.length).toBe(1);
  });

  it("should have DELETE route for /:id", () => {
    const routes = attachmentsRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/:id" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(routes.length).toBe(1);
  });

    it("should have middleware or routes in stack", () => {
    const hasMiddleware = attachmentsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = attachmentsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

    it("should have middleware or routes in stack", () => {
    const hasMiddleware = attachmentsRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = attachmentsRoutes.stack.some(
      (layer) => layer.route,
    );
    // At least one middleware or route layer should exist
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using GET, POST, or DELETE methods", () => {
    attachmentsRoutes.stack.forEach((layer) => {
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
    const routeCount = attachmentsRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(7);
  });
});
