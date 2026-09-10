const storageRoutes = require("../../routes/api/storage.route.js");

describe("Storage Routes", () => {
  it("exports an Express router", () => {
    expect(storageRoutes).toBeDefined();
    expect(typeof storageRoutes.handle).toBe("function");
  });

  const routePaths = () =>
    storageRoutes.stack
      .filter((l) => l.route)
      .map((l) => ({ path: l.route.path, methods: l.route.methods }));

  it("registers every settings + object + usage endpoint", () => {
    const paths = routePaths();
    const has = (path, method) =>
      paths.some((r) => r.path === path && r.methods[method]);

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
      .map((l) => l.route.path);
    expect(order.indexOf("/object")).toBeLessThan(order.indexOf("/settings"));
  });

  it("uses only valid HTTP methods", () => {
    for (const { methods } of routePaths()) {
      expect(
        methods.get || methods.post || methods.put || methods.delete,
      ).toBe(true);
    }
  });
});
