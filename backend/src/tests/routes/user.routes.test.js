/**
 * User Routes Tests
 *
 * Tests the user route registrations and middleware chain.
 */
const EventEmitter = require("events");

// The route file passes `resolveResourceId` callbacks into recordAudit. They
// only run when the real middleware fires on response finish, so keep
// auditLog.middleware UNMOCKED and stub what it writes through instead —
// mocking recordAudit would leave those callbacks uncovered.
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue(undefined),
}));

const userRoutes = require("../../routes/api/user.route");
const auditService = require("../../services/audit.service");

describe("User Routes", () => {
  it("should export an Express router", () => {
    expect(userRoutes).toBeDefined();
    expect(typeof userRoutes.handle).toBe("function");
  });

  it("should have registered routes", () => {
    expect(Array.isArray(userRoutes.stack)).toBe(true);
    expect(userRoutes.stack.length).toBeGreaterThan(0);
  });

  it("should have multiple route handlers registered", () => {
    const allRoutes = userRoutes.stack.filter((layer) => layer.route);
    expect(allRoutes.length).toBeGreaterThan(5);
  });

  it("should have GET method routes", () => {
    const getRoutes = userRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.get,
    );
    expect(getRoutes.length).toBeGreaterThan(0);
  });

  it("should have POST method routes", () => {
    const postRoutes = userRoutes.stack.filter(
      (layer) => layer.route && layer.route.methods && layer.route.methods.post,
    );
    expect(postRoutes.length).toBeGreaterThan(3);
  });

  it("should have PATCH method routes", () => {
    const patchRoutes = userRoutes.stack.filter(
      (layer) =>
        layer.route && layer.route.methods && layer.route.methods.patch,
    );
    expect(patchRoutes.length).toBeGreaterThan(0);
  });

  it("should have DELETE method routes", () => {
    const deleteRoutes = userRoutes.stack.filter(
      (layer) =>
        layer.route && layer.route.methods && layer.route.methods.delete,
    );
    expect(deleteRoutes.length).toBeGreaterThan(0);
  });

  it("should have /all route", () => {
    const allLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/all";
    });
    expect(allLayers.length).toBeGreaterThan(0);
  });

  it("should have /detail route", () => {
    const detailLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/detail";
    });
    expect(detailLayers.length).toBeGreaterThan(0);
  });

  it("should have /create route", () => {
    const createLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/create";
    });
    expect(createLayers.length).toBeGreaterThan(0);
  });

  it("should have /edit route", () => {
    const editLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/edit";
    });
    expect(editLayers.length).toBeGreaterThan(0);
  });

  it("should have /delete route", () => {
    const deleteLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/delete";
    });
    expect(deleteLayers.length).toBeGreaterThan(0);
  });

  it("should have /username-check route", () => {
    const usernameCheckLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/username-check";
    });
    expect(usernameCheckLayers.length).toBeGreaterThan(0);
  });

  it("should have /role-update route", () => {
    const roleUpdateLayers = userRoutes.stack.filter((layer) => {
      return layer.route && layer.route.path === "/role-update";
    });
    expect(roleUpdateLayers.length).toBeGreaterThan(0);
  });

  it("should have avatar routes with userId param", () => {
    const avatarLayers = userRoutes.stack.filter((layer) => {
      const p = layer.route && layer.route.path;
      return p && p.includes("avatar");
    });
    expect(avatarLayers.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------
  // Audit trail (FDA 21 CFR Part 11 §11.10(e)). The recordAudit middleware
  // is driven off the route stack so the route's own resolveResourceId
  // callbacks actually execute.
  // --------------------------------------------------------------------
  describe("recordAudit resource resolution", () => {
    /** The recordAudit layer registered on a given route path. */
    const auditLayerFor = (path, method) => {
      const layer = userRoutes.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method],
      );
      // recordAudit returns an anonymous middleware; it is the one that
      // subscribes to res "finish".
      return layer?.route.stack.map((s) => s.handle);
    };

    /**
     * Invoke every handler on the route so the recordAudit layer subscribes to
     * "finish", then emit it.
     *
     * The other layers (auth, dynamicAccess) run too and will reject the fake
     * request — that is fine and intentional, but they need a res that answers
     * status()/json(), otherwise they throw before recordAudit is reached.
     */
    const fireAudit = async (path, method, req, statusCode = 200) => {
      const handles = auditLayerFor(path, method) || [];
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      res.send = jest.fn().mockReturnValue(res);
      res.setHeader = jest.fn().mockReturnValue(res);
      res.getHeader = jest.fn();

      for (const h of handles) {
        try {
          h(req, res, () => {});
        } catch {
          /* a non-audit layer rejecting the stub request */
        }
      }
      res.emit("finish");
      // logAction is fired without await inside the finish handler.
      await new Promise((r) => setImmediate(r));
      return res;
    };

    beforeEach(() => jest.clearAllMocks());

    it("resolves the UPDATE resource id from body.userId", async () => {
      await fireAudit("/role-update", "post", {
        headers: {},
        query: {},
        params: {},
        body: { userId: "user-42" },
        user: { id: "actor-1", tenantId: "tenant-1" },
      });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "UPDATE",
          resourceType: "User",
          resourceId: "user-42",
        }),
      );
    });

    it("resolves the DELETE resource id from query.userId", async () => {
      await fireAudit("/delete", "delete", {
        headers: {},
        params: {},
        query: { userId: "user-99" },
        body: {},
        user: { id: "actor-1", tenantId: "tenant-1" },
      });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "DELETE",
          resourceId: "user-99",
        }),
      );
    });

    it("falls back to body.userId when DELETE has no query id", async () => {
      await fireAudit("/delete", "delete", {
        headers: {},
        params: {},
        query: {},
        body: { userId: "user-77" },
        user: { id: "actor-1", tenantId: "tenant-1" },
      });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "user-77" }),
      );
    });

    it("records a null resource id when neither is supplied", async () => {
      await fireAudit("/delete", "delete", {
        headers: {},
        params: {},
        query: {},
        body: {},
        user: { id: "actor-1", tenantId: "tenant-1" },
      });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: null }),
      );
    });

    it("does not record an audit row for a failed request", async () => {
      await fireAudit(
        "/delete",
        "delete",
        {
          headers: {},
          params: {},
          query: { userId: "user-99" },
          body: {},
          user: { id: "a" },
        },
        400,
      );

      expect(auditService.logAction).not.toHaveBeenCalled();
    });
  });
});
