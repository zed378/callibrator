/**
 * A-04 — /search was guarded by `auth` and nothing else.
 *
 * The route gate is what makes an API-key principal authorized at all
 * (controllerWrapper's deny-by-default, A-03) and what refuses a caller who
 * may read none of the searchable menus. This case fails if the gate is
 * removed or narrowed to a menu that is not one of the three the search can
 * return rows from.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";

interface GateHandler {
    (req: Request, res: Response, next: NextFunction): void;
    __menus: unknown;
    __permission: unknown;
}

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((_req: Request, _res: Response, next: NextFunction): void => {
    next();
  }),
}));

jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((menus: unknown, permission: unknown): GateHandler => {
    const fn = ((_req: Request, _res: Response, next: NextFunction): void => {
      next();
    }) as GateHandler;
    fn.__menus = menus;
    fn.__permission = permission;
    return fn;
  }),
}));

interface SearchRouteStackEntry {
    handle: unknown;
}

interface SearchRoute {
    path: string;
    methods: Record<string, boolean>;
    stack: SearchRouteStackEntry[];
}

interface SearchRouteLayer {
    route?: SearchRoute;
}

interface SearchRouter {
    handle: unknown;
    stack: SearchRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const searchRoutes = require("../../routes/api/search.route") as SearchRouter;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the middleware is `export =` (CommonJS), as built
const { auth } = require("../../middlewares/auth.middleware") as { auth: RequestHandler };

const chain = (method: string, path: string): unknown[] => {
  const layer = searchRoutes.stack.find(
    (l) => l.route?.path === path && l.route.methods[method] === true,
  );
  expect(layer).toBeDefined();
  return layer?.route?.stack.map((s) => s.handle) ?? [];
};

describe("A-04 — GET /search carries a permission gate", () => {
  it("authenticates and then gates on read of every searchable menu", () => {
    const handlers = chain("get", "/");

    expect(handlers).toContain(auth);

    const gate = handlers.find((h) => Array.isArray((h as { __menus?: unknown }).__menus)) as
            | GateHandler
            | undefined;
    expect(gate).toBeDefined();
    expect([...(gate?.__menus as string[])].sort()).toEqual([
      "calibration",
      "certificate",
      "warehouse",
    ]);
    expect(gate?.__permission).toBe("read");
  });

  it("leaves no route on auth alone", () => {
    for (const layer of searchRoutes.stack.filter((l) => l.route)) {
      const handlers = layer.route?.stack.map((s) => s.handle) ?? [];
      expect(handlers.find((h) => Array.isArray((h as { __menus?: unknown }).__menus))).toBeDefined();
    }
  });
});
