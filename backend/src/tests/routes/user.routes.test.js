/**
 * User Routes Tests
 *
 * Tests the user route registrations and middleware chain.
 */
const EventEmitter = require("events");

// auditLog.middleware stays UNMOCKED and what it writes through is stubbed, so
// a recordAudit layer on any user route would show up as a logAction call.
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
  // A-77. The user mutations are audited INSIDE the service's transaction
  // (userService.userCreate / userRoleUpdate / editUser / deleteUser — see
  // services/user.audit.a77.test.js). The post-response recordAudit that used
  // to sit on these routes ran after the commit, so it could not undo a
  // change whose audit insert failed; left in place it would also write a
  // second row for every change. No route layer may write an audit row.
  // --------------------------------------------------------------------
  describe("A-77 — no post-response audit on the user mutation routes", () => {
    const handlesFor = (path, method) => {
      const layer = userRoutes.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods[method],
      );
      return layer.route.stack.map((s) => s.handle);
    };

    const fireFinish = async (path, method) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.status = jest.fn().mockReturnValue(res);
      res.json = jest.fn().mockReturnValue(res);
      res.send = jest.fn().mockReturnValue(res);
      res.setHeader = jest.fn().mockReturnValue(res);
      res.getHeader = jest.fn();
      const req = {
        headers: {},
        params: {},
        query: { userId: "user-99" },
        body: { userId: "user-99" },
        user: { id: "actor-1", tenantId: "tenant-1" },
      };
      for (const h of handlesFor(path, method)) {
        try {
          h(req, res, () => {});
        } catch {
          /* a gate rejecting the stub request */
        }
      }
      res.emit("finish");
      await new Promise((r) => setImmediate(r));
    };

    beforeEach(() => jest.clearAllMocks());

    it.each([
      ["/role-update", "post"],
      ["/create", "post"],
      ["/edit", "patch"],
      ["/delete", "delete"],
    ])("%s (%s) writes no audit row from the route layer", async (path, method) => {
      await fireFinish(path, method);
      expect(auditService.logAction).not.toHaveBeenCalled();
    });
  });
});
