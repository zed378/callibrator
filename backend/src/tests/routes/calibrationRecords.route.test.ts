/**
 * Calibration Records Routes Tests
 *
 * Tests the Calibration Records route registrations and middleware chain.
 */

import type { RequestHandler } from "express";

interface CalibrationRecordsRouteStackEntry {
    handle: unknown;
    name: string;
}

interface CalibrationRecordsRoute {
    path: string;
    methods: Record<string, boolean>;
    stack: CalibrationRecordsRouteStackEntry[];
}

interface CalibrationRecordsRouteLayer {
    route?: CalibrationRecordsRoute;
}

interface CalibrationRecordsRouter {
    handle: unknown;
    stack: CalibrationRecordsRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const calibrationRecordsRoutes = require("../../routes/api/calibrationRecords.route") as CalibrationRecordsRouter;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the middleware is `export =` (CommonJS), as built
const { denyApiKey } = require("../../middlewares/auth.middleware") as { denyApiKey: RequestHandler };

describe("Calibration Records Routes", () => {
  it("should export an Express router", () => {
    expect(calibrationRecordsRoutes).toBeDefined();
    expect(typeof calibrationRecordsRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(calibrationRecordsRoutes.stack)).toBe(true);
    expect(calibrationRecordsRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = calibrationRecordsRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(0);
  });

  it("should have GET route for /", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route?.path === "/" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have POST route for /", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) => layer.route?.path === "/" && layer.route.methods["post"] === true,
    );
    expect(routes.length).toBe(1);
  });

  it("should have GET route for /:calibrationRecordId", () => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route?.path === "/:calibrationRecordId" && layer.route.methods["get"] === true,
    );
    expect(routes.length).toBe(1);
  });

  // P6-03 — a calibration record is append-only: no PUT, no DELETE.
  it.each(["put", "patch", "delete"])("has NO %s route on /:calibrationRecordId", (method: string) => {
    const routes = calibrationRecordsRoutes.stack.filter(
      (layer) =>
        layer.route?.path.startsWith("/:calibrationRecordId") === true &&
                layer.route.methods[method] === true,
    );
    expect(routes).toHaveLength(0);
  });

  it.each(["/:calibrationRecordId/corrections", "/:calibrationRecordId/void"])(
    "has a POST route for %s behind the full middleware chain",
    (path: string) => {
      const routes = calibrationRecordsRoutes.stack.filter(
        (layer) => layer.route?.path === path && layer.route.methods["post"] === true,
      );
      expect(routes).toHaveLength(1);
      // auth, [denyApiKey on void — Q-51], validateUuid, [rbac(TENANT_ADMIN) on void — P20-06],
      // dynamicAccess("calibration", "write"), denyPlatformAuthoring, controller
      const names = routes[0]?.route?.stack.map((l) => l.name) ?? [];
      const voids = path.endsWith("/void");
      expect(names).toHaveLength(voids ? 7 : 5);
      expect(names[voids ? 5 : 3]).toBe("denyPlatformAuthoring");
      expect(routes[0]?.route?.stack.some((l) => l.handle === denyApiKey)).toBe(voids);
    },
  );
});
