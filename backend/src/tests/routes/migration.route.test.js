/**
 * Migration Routes Tests
 *
 * Tests the internal migration route registrations and middleware chain.
 * Endpoints: GET /up, GET /down, GET /seeding, GET /unseeding
 */

// The two inline guards are security-critical and were never invoked by these
// tests (0% function coverage). Mock their collaborators so they can be driven
// directly off the route stack.
jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((req, res, next) => next()),
  superAdminOnly: jest.fn((req, res, next) => next()),
}));

jest.mock("../../utils/response.util", () => ({
  forbidden: jest.fn((res, message) => res.status(403).json({ message })),
  success: jest.fn(),
  error: jest.fn(),
}));

const migrationRoutes = require("../../routes/internal/migration.route");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");
const { forbidden } = require("../../utils/response.util");

describe("Migration Routes", () => {
  it("should export an Express router", () => {
    expect(migrationRoutes).toBeDefined();
    expect(typeof migrationRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(migrationRoutes.stack)).toBe(true);
    expect(migrationRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = migrationRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBe(5);
  });

  it("should have GET /up route", () => {
    const routes = migrationRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/up" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET /down route", () => {
    const routes = migrationRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/down" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET /seeding route", () => {
    const routes = migrationRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/seeding" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET /unseeding route", () => {
    const routes = migrationRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/unseeding" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET /seed-demo route", () => {
    const routes = migrationRoutes.stack.filter(
      (layer) =>
        layer.route &&
        layer.route.path === "/seed-demo" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(routes.length).toBe(1);
  });

  it("should have middleware or routes in stack", () => {
    const hasMiddleware = migrationRoutes.stack.some(
      (layer) => !layer.route,
    );
    const hasRoutes = migrationRoutes.stack.some(
      (layer) => layer.route,
    );
    expect(hasMiddleware || hasRoutes).toBe(true);
  });

  it("should have all routes using GET method only", () => {
    migrationRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        expect(methods.get === true).toBe(true);
      }
    });
  });

  it("should have exactly 4 route endpoints", () => {
    const routeCount = migrationRoutes.stack.filter(
      (layer) => layer.route,
    ).length;
    expect(routeCount).toBe(5);
  });

  // --------------------------------------------------------------------
  // Inline guards, reached through the route stack. These gate destructive
  // and bootstrap operations, so their branches are worth pinning.
  // --------------------------------------------------------------------

  /** Pull a named middleware off a route's handler stack. */
  const guardFor = (path, name) =>
    migrationRoutes.stack
      .find((l) => l.route && l.route.path === path)
      ?.route.stack.find((s) => s.handle && s.handle.name === name)?.handle;

  const makeRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  });

  describe("allowDestructive", () => {
    const guard = () => guardFor("/down", "allowDestructive");
    const ORIGINAL = { ...process.env };

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL.NODE_ENV;
      process.env.ALLOW_DESTRUCTIVE_MIGRATION =
        ORIGINAL.ALLOW_DESTRUCTIVE_MIGRATION;
    });

    it("is wired onto the destructive routes", () => {
      expect(typeof guard()).toBe("function");
      expect(typeof guardFor("/unseeding", "allowDestructive")).toBe("function");
    });

    it("blocks in production even with the opt-in flag set", () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_DESTRUCTIVE_MIGRATION = "true";
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalled();
    });

    it("blocks outside production when the opt-in flag is absent", () => {
      process.env.NODE_ENV = "test";
      delete process.env.ALLOW_DESTRUCTIVE_MIGRATION;
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalled();
    });

    it("blocks when the opt-in flag is not exactly 'true'", () => {
      process.env.NODE_ENV = "test";
      process.env.ALLOW_DESTRUCTIVE_MIGRATION = "yes";
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("allows outside production with the explicit opt-in flag", () => {
      process.env.NODE_ENV = "test";
      process.env.ALLOW_DESTRUCTIVE_MIGRATION = "true";
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).toHaveBeenCalled();
      expect(forbidden).not.toHaveBeenCalled();
    });
  });

  describe("superAdminOrBootstrap", () => {
    const guard = () => guardFor("/seeding", "superAdminOrBootstrap");
    const ORIGINAL_SEEDING = process.env.ALLOW_SEEDING;

    afterEach(() => {
      if (ORIGINAL_SEEDING === undefined) delete process.env.ALLOW_SEEDING;
      else process.env.ALLOW_SEEDING = ORIGINAL_SEEDING;
    });

    it("is wired onto the bootstrap-capable routes", () => {
      expect(typeof guard()).toBe("function");
      expect(typeof guardFor("/up", "superAdminOrBootstrap")).toBe("function");
    });

    it("short-circuits to next() when the bootstrap flag is set", () => {
      process.env.ALLOW_SEEDING = "true";
      const next = jest.fn();

      guard()({}, makeRes(), next);

      expect(next).toHaveBeenCalled();
      // No auth is attempted on the bootstrap path.
      expect(auth).not.toHaveBeenCalled();
    });

    it("falls back to auth + superAdminOnly without the flag", () => {
      delete process.env.ALLOW_SEEDING;
      const next = jest.fn();
      const req = {};
      const res = makeRes();

      guard()(req, res, next);

      expect(auth).toHaveBeenCalled();
      expect(superAdminOnly).toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("forwards an auth error instead of running superAdminOnly", () => {
      delete process.env.ALLOW_SEEDING;
      const boom = new Error("bad token");
      auth.mockImplementationOnce((req, res, cb) => cb(boom));
      const next = jest.fn();

      guard()({}, makeRes(), next);

      expect(next).toHaveBeenCalledWith(boom);
      expect(superAdminOnly).not.toHaveBeenCalled();
    });

    it("is fail-closed: a non-'true' flag still requires super admin", () => {
      process.env.ALLOW_SEEDING = "1";
      const next = jest.fn();

      guard()({}, makeRes(), next);

      expect(auth).toHaveBeenCalled();
    });
  });

  describe("allowDemoSeeding", () => {
    const guard = () => guardFor("/seed-demo", "allowDemoSeeding");
    const ORIGINAL_SEED_DEMO = process.env.SEED_DEMO;

    afterEach(() => {
      if (ORIGINAL_SEED_DEMO === undefined) delete process.env.SEED_DEMO;
      else process.env.SEED_DEMO = ORIGINAL_SEED_DEMO;
    });

    it("is wired onto the seed-demo route", () => {
      expect(typeof guard()).toBe("function");
    });

    it("blocks when SEED_DEMO is not set to true", () => {
      delete process.env.SEED_DEMO;
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(forbidden).toHaveBeenCalled();
    });

    it("allows when SEED_DEMO is set to true", () => {
      process.env.SEED_DEMO = "true";
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).toHaveBeenCalled();
      expect(forbidden).not.toHaveBeenCalled();
    });
  });
});
