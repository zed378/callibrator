/**
 * P9-21 — four route gates that no suite watched. A planted defect in each, in
 * a scratch mirror of the converted route (`p920/routebite3.py`: a control run
 * first, then the plant, against every suite that names the route or its
 * mount), left every existing test green:
 *
 *  1. POST /api/v1/tenants/detail — `checkTenant` on the `management: read`
 *     gate. Without it a tenant administrator reads ANOTHER tenant's row by
 *     naming its id in the body (the Tenant model is not tenant-scoped, A-01).
 *     The two-tenant guard covers path parameters only; this id is in the body.
 *  2. GET /api/v1/tenants/:tenantId/backups/:backupId — `checkTenant` on the
 *     `tenant:read` abac gate (the path tenant must be the caller's).
 *  3. GET /api/v1/sessions/mine — `denyApiKey` (Q-08, ADR-084: a key has no
 *     sessions of its own; the list is a JWT holder's).
 *  4. POST /api/v1/api-keys — `requireFeature("api_keys")` (the plan feature).
 *
 * The claim is written out by hand: the gate each route must carry, with its
 * arguments. The gate factories are the REAL ones, recorded as they are
 * called when the routes load.
 */
import type { RequestHandler, Router } from "express";

/** Each handler a recorded factory produced, with the factory's name and arguments. */
const mockMade = new Map<unknown, readonly unknown[]>();

jest.mock("../../middlewares/dynamicAccess.middleware", () => {
  const actual = jest.requireActual<{ dynamicAccess: (...a: unknown[]) => RequestHandler }>("../../middlewares/dynamicAccess.middleware");
  return {
    ...actual,
    dynamicAccess: (...args: unknown[]) => {
      const handler = actual.dynamicAccess(...args);
      mockMade.set(handler, ["dynamicAccess", ...args]);
      return handler;
    },
  };
});
jest.mock("../../middlewares/abac.middleware", () => {
  const actual = jest.requireActual<{ abac: (...a: unknown[]) => RequestHandler }>("../../middlewares/abac.middleware");
  return {
    ...actual,
    abac: (...args: unknown[]) => {
      const handler = actual.abac(...args);
      mockMade.set(handler, ["abac", ...args]);
      return handler;
    },
  };
});
jest.mock("../../middlewares/enforceQuota.middleware", () => {
  const actual = jest.requireActual<{ requireFeature: (...a: unknown[]) => RequestHandler }>("../../middlewares/enforceQuota.middleware");
  return {
    ...actual,
    requireFeature: (...args: unknown[]) => {
      const handler = actual.requireFeature(...args);
      mockMade.set(handler, ["requireFeature", ...args]);
      return handler;
    },
  };
});

/* eslint-disable @typescript-eslint/no-require-imports -- each route is `export =` (CommonJS), loaded after the recorders */
const tenantRoutes = require("../../routes/api/tenant.route") as Router;
const tenantBackupRoutes = require("../../routes/api/tenantBackup.route") as Router;
const sessionRoutes = require("../../routes/api/session.route") as Router;
const apiKeyRoutes = require("../../routes/api/apiKeys.route") as Router;
const { denyApiKey } = require("../../middlewares/auth.middleware") as { denyApiKey: RequestHandler };
/* eslint-enable @typescript-eslint/no-require-imports */

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle: unknown;
}

/** The handlers a request to `method path` runs through, router-level `use` layers first. */
const chainOf = (router: Router, method: string, path: string): unknown[] => {
  const stack = (router as unknown as { stack: Layer[] }).stack;
  const at = stack.findIndex((l) => l.route?.path === path && l.route.methods[method] === true);
  if (at < 0) {
    throw new Error(`no ${method.toUpperCase()} ${path} on this router`);
  }
  const before = stack.slice(0, at).filter((l) => !l.route).map((l) => l.handle);
  return [...before, ...(stack[at]?.route?.stack.map((s) => s.handle) ?? [])];
};

/** What the recorded factories made for the chain, in order. */
const gatesOf = (chain: unknown[]): (readonly unknown[])[] =>
  chain.map((h) => mockMade.get(h)).filter((g): g is readonly unknown[] => g !== undefined);

describe("P9-21 pins — route gates no suite watched", () => {
  it("1. POST /tenants/detail: management read WITH checkTenant", () => {
    expect(gatesOf(chainOf(tenantRoutes, "post", "/detail"))).toEqual([["dynamicAccess", "management", "read", { checkTenant: true }]]);
  });

  it("2. GET /tenants/:tenantId/backups/:backupId: tenant:read abac WITH checkTenant", () => {
    const gates = gatesOf(chainOf(tenantBackupRoutes, "get", "/:tenantId/backups/:backupId"));
    expect(gates).toEqual([["abac", ["tenant:read"], { checkTenant: true }]]);
  });

  it("3. GET /sessions/mine: an API key is refused (denyApiKey)", () => {
    expect(chainOf(sessionRoutes, "get", "/mine")).toContain(denyApiKey);
  });

  it("4. POST /api-keys: the plan feature api_keys is required", () => {
    expect(gatesOf(chainOf(apiKeyRoutes, "post", "/"))).toContainEqual(["requireFeature", "api_keys"]);
  });
});
