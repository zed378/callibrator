/**
 * Tests for tenantContext.middleware.
 *
 * The middleware's only job now is to publish the per-request tenant context
 * into AsyncLocalStorage. Postgres RLS (and with it the per-request
 * `set_config` GUC + wrapping transaction) has been removed: it was
 * Postgres-only and fail-open. utils/tenantScope.util.js reads this context to
 * enforce isolation in the ORM, deny-by-default, on every dialect.
 */

const {
  tenantStorage,
  tenantContextMiddleware,
} = require("../../middlewares/tenantContext.middleware");

describe("tenantContext.middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {};
    next = jest.fn();
  });

  /** Capture the CLS context visible to downstream handlers. */
  const contextSeenByNext = () => {
    let seen;
    next.mockImplementation(() => {
      seen = tenantStorage.getStore();
    });
    tenantContextMiddleware(req, res, next);
    return seen;
  };

  it("always calls next()", () => {
    tenantContextMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("publishes the request tenantId to downstream handlers", () => {
    req.tenantId = "tenant-abc";
    expect(contextSeenByNext()).toEqual({
      tenantId: "tenant-abc",
      isSuperAdmin: false,
      isSystemTask: false,
    });
  });

  it("marks SUPERADMIN as cross-tenant", () => {
    req.tenantId = "tenant-abc";
    req.user = { role: { name: "SUPERADMIN" } };
    expect(contextSeenByNext()).toMatchObject({ isSuperAdmin: true });
  });

  it("also accepts the SUPER_ADMIN spelling", () => {
    req.user = { role: { name: "SUPER_ADMIN" } };
    expect(contextSeenByNext()).toMatchObject({ isSuperAdmin: true });
  });

  it("treats any other role as tenant-bound", () => {
    req.tenantId = "t1";
    req.user = { role: { name: "TECHNICIAN" } };
    expect(contextSeenByNext()).toMatchObject({
      isSuperAdmin: false,
      tenantId: "t1",
    });
  });

  it("nulls the tenantId when the request has none", () => {
    // tenantScope resolves this to DENY for a non-super-admin — an
    // authenticated principal without a tenant must read nothing.
    expect(contextSeenByNext()).toMatchObject({ tenantId: null });
  });

  it("tolerates a user without a role object", () => {
    req.user = {};
    expect(contextSeenByNext()).toMatchObject({ isSuperAdmin: false });
  });

  it("does not leak context outside the request scope", () => {
    req.tenantId = "tenant-abc";
    tenantContextMiddleware(req, res, next);
    expect(tenantStorage.getStore()).toBeUndefined();
  });

  it("isolates concurrent requests from each other", async () => {
    const run = (tenantId) =>
      new Promise((resolve) => {
        tenantContextMiddleware({ tenantId, headers: {} }, {}, async () => {
          // Yield so the two requests interleave.
          await new Promise((r) => setImmediate(r));
          resolve(tenantStorage.getStore().tenantId);
        });
      });

    await expect(Promise.all([run("t1"), run("t2")])).resolves.toEqual([
      "t1",
      "t2",
    ]);
  });
});
