/**
 * Tests for tenantContext.middleware.
 *
 * The middleware's only job now is to publish the per-request tenant context
 * into AsyncLocalStorage. Postgres RLS (and with it the per-request
 * `set_config` GUC + wrapping transaction) has been removed: it was
 * Postgres-only and fail-open. utils/tenantScope.util.js reads this context to
 * enforce isolation in the ORM, deny-by-default, on every dialect.
 */
import type { Request, Response, NextFunction } from "express";
import type { TenantContextStore } from "../../middlewares/tenantContext.middleware";
import {
  tenantStorage,
  tenantContextMiddleware,
} from "../../middlewares/tenantContext.middleware";

interface MockRequest {
  headers: Record<string, string | string[] | undefined>;
  tenantId?: string;
  user?: {
    role?: {
      name?: string;
    };
  };
}

describe("tenantContext.middleware", () => {
  let req: MockRequest;
  let res: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    req = { headers: {} };
    res = {};
    next = jest.fn();
  });

  /** Capture the CLS context visible to downstream handlers. */
  const contextSeenByNext = (): TenantContextStore | undefined => {
    let seen: TenantContextStore | undefined;
    next.mockImplementation(() => {
      seen = tenantStorage.getStore();
    });
    tenantContextMiddleware(req as unknown as Request, res as Response, next);
    return seen;
  };

  it("always calls next()", () => {
    tenantContextMiddleware(req as unknown as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("publishes the request tenantId to downstream handlers", () => {
    req.tenantId = "tenant-abc";
    expect(contextSeenByNext()).toEqual({
      tenantId: "tenant-abc",
      isSuperAdmin: false,
      isSystemTask: false,
      // P21-09: the facility half of the context (no principal: unbound, no user).
      userId: null,
      clientFacilityId: null,
      facilityBound: false,
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
    tenantContextMiddleware(req as unknown as Request, res as Response, next);
    expect(tenantStorage.getStore()).toBeUndefined();
  });

  it("isolates concurrent requests from each other", async () => {
    const run = (tenantId: string): Promise<string | null | undefined> =>
      new Promise((resolve) => {
        const concurrentReq = { tenantId, headers: {} } as unknown as Request;
        const concurrentRes = {} as unknown as Response;
        tenantContextMiddleware(concurrentReq, concurrentRes, () => {
          void (async () => {
            // Yield so the two requests interleave.
            await new Promise((r) => {
              setImmediate(r);
            });
            resolve(tenantStorage.getStore()?.tenantId);
          })();
        });
      });

    await expect(Promise.all([run("t1"), run("t2")])).resolves.toEqual([
      "t1",
      "t2",
    ]);
  });
});
