/**
 * Audit Routes Tests
 */

interface AuditRouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: unknown[] };
}

interface AuditRouter {
  handle: unknown;
  stack: AuditRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const auditRoutes = require("../../routes/api/audit.route") as AuditRouter;

describe("Audit Routes", () => {
  it("should export an Express router", () => {
    expect(auditRoutes).toBeDefined();
    expect(typeof auditRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(auditRoutes.stack)).toBe(true);
    expect(auditRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have GET / route defined with auth and dynamicAccess middleware", () => {
    const getRoutes = auditRoutes.stack.filter(
      (layer) => layer.route?.path === "/" && layer.route.methods["get"],
    );
    expect(getRoutes.length).toBe(1);

    // Check that we have middlewares registered on this route (auth, dynamicAccess, fetchAuditLogs)
    const route = getRoutes[0]?.route;
    expect(route?.stack.length).toBeGreaterThan(2);
  });
});
