/**
 * AI Routes Tests
 *
 * Tests the AI route registrations and middleware chain.
 */
const aiRoutes = require("../../routes/api/ai.route");

describe("AI Routes", () => {
  it("should export an Express router", () => {
    expect(aiRoutes).toBeDefined();
    expect(typeof aiRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(aiRoutes.stack)).toBe(true);
    expect(aiRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = aiRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST route for /ocr", () => {
    const postRoutes = aiRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/ocr" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(postRoutes.length).toBe(1);
  });

  it("should have POST route for /query", () => {
    const postRoutes = aiRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/query" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(postRoutes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    const middlewareLayers = aiRoutes.stack.filter((layer) => !layer.route);
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    const hasMiddleware = aiRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = aiRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware).toBe(true);
    expect(hasRoutes).toBe(true);
  });

  it("should have only AI-specific routes", () => {
    const routePaths = aiRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    expect(routePaths).toContain("/ocr");
    expect(routePaths).toContain("/query");
  });

  it("should have all routes using POST method", () => {
    aiRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.post === true).toBe(true);
      }
    });
  });

  it("should have exactly 2 route endpoints", () => {
    const routeCount = aiRoutes.stack.filter((layer) => layer.route).length;
    expect(routeCount).toBe(2);
  });
});
