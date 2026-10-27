/**
 * Storage Routes Tests
 *
 * Tests the storage route registrations and middleware chain.
 */

interface StorageRouteLayer {
    route?: { path: string; methods: Record<string, boolean> };
}

interface StorageRouter {
    handle: unknown;
    stack: StorageRouteLayer[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), as built
const storageRoutes = require("../../routes/api/storage.route") as StorageRouter;

describe("Storage Routes", () => {
  it("exports an Express router", () => {
    expect(storageRoutes).toBeDefined();
    expect(typeof storageRoutes.handle).toBe("function");
  });

  const routePaths = (): { path: string; methods: Record<string, boolean> }[] =>
    storageRoutes.stack
      .filter((l) => l.route)
      .map((l) => ({ path: (l.route as { path: string }).path, methods: (l.route as { methods: Record<string, boolean> }).methods }));

  it("registers every settings + object + usage endpoint", () => {
    const paths = routePaths();
    const has = (path: string, method: string): boolean =>
      paths.some((r) => r.path === path && r.methods[method] === true);

    expect(has("/object", "get")).toBe(true);
    expect(has("/settings", "get")).toBe(true);
    expect(has("/settings", "put")).toBe(true);
    expect(has("/settings", "delete")).toBe(true);
    expect(has("/settings/test", "post")).toBe(true);
    expect(has("/usage", "get")).toBe(true);
  });

  it("registers the public /object route BEFORE the authed routes", () => {
    // Ordering matters: /object is token-gated and must not sit behind auth.
    const order = storageRoutes.stack
      .filter((l) => l.route)
      .map((l) => (l.route as { path: string }).path);
    expect(order.indexOf("/object")).toBeLessThan(order.indexOf("/settings"));
  });

  it("uses only valid HTTP methods", () => {
    for (const { methods } of routePaths()) {
      expect(
        methods["get"] === true || methods["post"] === true || methods["put"] === true || methods["delete"] === true,
      ).toBe(true);
    }
  });
});
