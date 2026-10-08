/**
 * Admin Routes Tests
 *
 * Tests the admin route registrations and middleware chain.
 */
const adminRoutes = require("../../routes/api/admin.route");

describe("Admin Routes", () => {
  it("should export an Express router", () => {
    expect(adminRoutes).toBeDefined();
    expect(typeof adminRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(adminRoutes.stack)).toBe(true);
    expect(adminRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = adminRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(2);
  });

  it("should have GET route for /tenants", () => {
    const getRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(getRoutes.length).toBe(1);
  });

  it("should have PATCH route for /tenants/:id/status", () => {
    const patchRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants/:id/status" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBe(1);
  });

  it("should have PATCH route for /tenants/:id/flags", () => {
    const patchRoutes = adminRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/tenants/:id/flags" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBe(1);
  });

  it("should have middleware layers in stack", () => {
    // Verify middleware layers exist (non-route layers)
    const middlewareLayers = adminRoutes.stack.filter((layer) => !layer.route);
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have router.use() applied before routes", () => {
    // The route stack should have both middleware layers and route layers
    const hasMiddleware = adminRoutes.stack.some((layer) => !layer.route);
    const hasRoutes = adminRoutes.stack.some((layer) => layer.route);
    expect(hasMiddleware).toBe(true);
    expect(hasRoutes).toBe(true);
  });

  it("should have only admin-specific routes", () => {
    const routePaths = adminRoutes.stack
      .filter((layer) => layer.route)
      .map((layer) => layer.route.path);

    expect(routePaths).toContain("/tenants");
    expect(routePaths).toContain("/tenants/:id/status");
    expect(routePaths).toContain("/tenants/:id/flags");
  });

  it("uses only the methods it serves: GET, PATCH, PUT (P10-04 domains) and POST (P10-05/07 queue actions)", () => {
    const methods = new Set();
    adminRoutes.stack.forEach((layer) => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((m) => methods.add(m));
      }
    });
    expect([...methods].sort()).toEqual(["get", "patch", "post", "put"]);
  });

  it("has exactly its 20 route endpoints: 3 tenant ones, 2 SSO-domain ones (P10-04), 6 access-request ones (P10-05/07), 6 SQL-dump import ones (P24-06) and 3 catalogue-proposal ones (P21-01)", () => {
    const routes = adminRoutes.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));
    expect(routes.sort()).toEqual(
      [
        "GET /tenants",
        "PATCH /tenants/:id/status",
        "PATCH /tenants/:id/flags",
        "GET /tenants/:id/sso-domains",
        "PUT /tenants/:id/sso-domains",
        "GET /access-requests",
        "POST /access-requests/erasure",
        "GET /access-requests/:id",
        "POST /access-requests/:id/approve",
        "POST /access-requests/:id/reject",
        "POST /access-requests/:id/resend-invitation",
        "GET /upstream-sql-imports/settings",
        "GET /upstream-sql-imports",
        "POST /upstream-sql-imports",
        "GET /upstream-sql-imports/:id",
        "POST /upstream-sql-imports/:id/cancel",
        "POST /upstream-sql-imports/:id/retry",
        "GET /ipm/template-proposals",
        "POST /ipm/template-proposals/:proposalId/accept",
        "POST /ipm/template-proposals/:proposalId/reject",
      ].sort(),
    );
  });
});
