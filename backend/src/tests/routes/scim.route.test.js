/**
 * SCIM Routes Tests (full)
 *
 * Tests all 14 SCIM route registrations (Users + Groups) and middleware chain.
 * Endpoints:
 *   Users — GET, GET/:id, POST, PUT/:id, PATCH/:id, DELETE/:id (6)
 *   Groups — GET, GET/:id, POST, PUT/:id, PATCH/:id, DELETE/:id (6)
 *   Plus router.use() middleware layers (scimAuthShim, requireApiKeyOrAdmin)
 */
const scimRoutes = require("../../routes/api/scim.route");

describe("SCIM Routes (full coverage)", () => {
  it("should export an Express router", () => {
    expect(scimRoutes).toBeDefined();
    expect(typeof scimRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(scimRoutes.stack)).toBe(true);
    expect(scimRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have middleware layers (router.use)", () => {
    const middlewareLayers = scimRoutes.stack.filter(
      (layer) => !layer.route,
    );
    expect(middlewareLayers.length).toBeGreaterThan(0);
  });

  it("should have route handlers registered", () => {
    const allRoutes = scimRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBe(12);
  });

  // --- Users: GET /Users ---
  it("should have GET /Users route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  // --- Users: GET /Users/:id ---
  it("should have GET /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users/:id" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  // --- Users: POST /Users ---
  it("should have POST /Users route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  // --- Users: PUT /Users/:id ---
  it("should have PUT /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users/:id" &&
        layer.route.methods &&
        layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  // --- Users: PATCH /Users/:id ---
  it("should have PATCH /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users/:id" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  // --- Users: DELETE /Users/:id ---
  it("should have DELETE /Users/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Users/:id" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: GET /Groups ---
  it("should have GET /Groups route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: GET /Groups/:id ---
  it("should have GET /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups/:id" &&
        layer.route.methods &&
        layer.route.methods.get,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: POST /Groups ---
  it("should have POST /Groups route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups" &&
        layer.route.methods &&
        layer.route.methods.post,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: PUT /Groups/:id ---
  it("should have PUT /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups/:id" &&
        layer.route.methods &&
        layer.route.methods.put,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: PATCH /Groups/:id ---
  it("should have PATCH /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups/:id" &&
        layer.route.methods &&
        layer.route.methods.patch,
    );
    expect(route).toBeDefined();
  });

  // --- Groups: DELETE /Groups/:id ---
  it("should have DELETE /Groups/:id route", () => {
    const route = scimRoutes.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === "/Groups/:id" &&
        layer.route.methods &&
        layer.route.methods.delete,
    );
    expect(route).toBeDefined();
  });

  it("should have all routes using valid HTTP methods", () => {
    scimRoutes.stack.forEach((layer) => {
      if (layer.route) {
        const methods = layer.route.methods;
        const validMethods = ["get", "post", "put", "patch", "delete"];
        const hasValidMethod = validMethods.some((m) => methods[m] === true);
        expect(hasValidMethod).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------
  // The two inline middlewares are not exported, so reach them through the
  // router stack and actually invoke them. Registration-only assertions left
  // both functions (and all 11 of their branches) uncovered.
  // --------------------------------------------------------------------

  /** router.use() layers, in registration order: shim, auth, requireApiKeyOrAdmin. */
  const useLayers = () => scimRoutes.stack.filter((l) => !l.route);
  const layerNamed = (name) =>
    useLayers().find((l) => l.handle && l.handle.name === name)?.handle;

  const JWT_LIKE =
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig";
  const API_KEY_LIKE = "Bearer " + "k".repeat(40);

  describe("scimAuthShim", () => {
    const shim = () => layerNamed("scimAuthShim");

    it("is registered as a router.use layer", () => {
      expect(typeof shim()).toBe("function");
    });

    it("rewrites a long dotless Bearer token to ApiKey", () => {
      const req = { headers: { authorization: API_KEY_LIKE } };
      const next = jest.fn();

      shim()(req, {}, next);

      expect(req.headers.authorization).toBe("ApiKey " + "k".repeat(40));
      expect(next).toHaveBeenCalled();
    });

    it("leaves a JWT-looking Bearer token alone (contains dots)", () => {
      const req = { headers: { authorization: JWT_LIKE } };
      const next = jest.fn();

      shim()(req, {}, next);

      expect(req.headers.authorization).toBe(JWT_LIKE);
      expect(next).toHaveBeenCalled();
    });

    it("leaves a short Bearer token alone", () => {
      const short = "Bearer abc";
      const req = { headers: { authorization: short } };
      const next = jest.fn();

      shim()(req, {}, next);

      expect(req.headers.authorization).toBe(short);
      expect(next).toHaveBeenCalled();
    });

    it("leaves a non-Bearer scheme alone", () => {
      const apiKey = "ApiKey " + "k".repeat(40);
      const req = { headers: { authorization: apiKey } };
      const next = jest.fn();

      shim()(req, {}, next);

      expect(req.headers.authorization).toBe(apiKey);
      expect(next).toHaveBeenCalled();
    });

    it("passes through when there is no authorization header", () => {
      const req = { headers: {} };
      const next = jest.fn();

      shim()(req, {}, next);

      expect(req.headers.authorization).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  describe("requireApiKeyOrAdmin", () => {
    const guard = () => layerNamed("requireApiKeyOrAdmin");
    const makeRes = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    });

    it("is registered as a router.use layer", () => {
      expect(typeof guard()).toBe("function");
    });

    it("allows an API key principal", () => {
      const next = jest.fn();
      const res = makeRes();

      guard()({ user: { isApiKey: true } }, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it.each(["SUPER_ADMIN", "SUPERADMIN"])("allows %s", (roleName) => {
      const next = jest.fn();
      const res = makeRes();

      guard()({ user: { role: { name: roleName } } }, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("rejects an ordinary user with a SCIM-shaped 403", () => {
      const next = jest.fn();
      const res = makeRes();

      guard()({ user: { role: { name: "TECHNICIAN" } } }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "403",
        }),
      );
    });

    it("rejects when there is no user at all", () => {
      const next = jest.fn();
      const res = makeRes();

      guard()({}, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("rejects a user with no role", () => {
      const next = jest.fn();
      const res = makeRes();

      guard()({ user: {} }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
