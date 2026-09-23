/**
 * A-04 — /search was guarded by `auth` and nothing else.
 *
 * The route gate is what makes an API-key principal authorized at all
 * (controllerWrapper's deny-by-default, A-03) and what refuses a caller who
 * may read none of the searchable menus. This case fails if the gate is
 * removed or narrowed to a menu that is not one of the three the search can
 * return rows from.
 */

jest.mock("../../middlewares/auth.middleware", () => ({
  auth: jest.fn((req, res, next) => next()),
}));

jest.mock("../../middlewares/dynamicAccess.middleware", () => ({
  dynamicAccess: jest.fn((menus, permission) => {
    const fn = (req, res, next) => next();
    fn.__menus = menus;
    fn.__permission = permission;
    return fn;
  }),
}));

const searchRoutes = require("../../routes/api/search.route");
const { auth } = require("../../middlewares/auth.middleware");

const chain = (method, path) => {
  const layer = searchRoutes.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method],
  );
  expect(layer).toBeDefined();
  return layer.route.stack.map((s) => s.handle);
};

describe("A-04 — GET /search carries a permission gate", () => {
  it("authenticates and then gates on read of every searchable menu", () => {
    const handlers = chain("get", "/");

    expect(handlers).toContain(auth);

    const gate = handlers.find((h) => Array.isArray(h.__menus));
    expect(gate).toBeDefined();
    expect([...gate.__menus].sort()).toEqual([
      "calibration",
      "certificate",
      "warehouse",
    ]);
    expect(gate.__permission).toBe("read");
  });

  it("leaves no route on auth alone", () => {
    for (const layer of searchRoutes.stack.filter((l) => l.route)) {
      const handlers = layer.route.stack.map((s) => s.handle);
      expect(handlers.find((h) => Array.isArray(h.__menus))).toBeDefined();
    }
  });
});
