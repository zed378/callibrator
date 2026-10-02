/**
 * P9-19 gate (a) — three dynamicAccess rules no suite pinned.
 *
 * Planted in a scratch mirror of the converted `dynamicAccess.middleware.ts`
 * (src/ untouched), each of these passed every watching suite (79 suites,
 * 1,116 tests):
 *   1. the self bypass taken on a `checkTenant`-only gate (`checkSelf || checkTenant`),
 *   2. an API key the gate allowed left without `req.apiKeyAuthorized` (A-03),
 *   3. the verb compared case-sensitively, so `"READ"` needs WRITE.
 * Each rule is the gate's documented behaviour; this suite fails on each plant.
 */
import type { NextFunction, Request, Response } from "express";
import type * as DynamicAccessModule from "../../middlewares/dynamicAccess.middleware";

const mockPermissions = jest.fn<string[], []>(() => []);
const mockScopeAllows = jest.fn<boolean, [unknown, unknown, unknown]>(() => false);

jest.mock("../../models", () => ({ User: { findByPk: jest.fn() }, Tenants: { findByPk: jest.fn() } }));
jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/apiKey.service", () => ({
  scopeAllows: (scopes: unknown, resource: unknown, action: unknown): boolean => mockScopeAllows(scopes, resource, action),
}));
jest.mock("../../services/effectivePermission.service", () => ({
  loadPermissionSources: jest.fn(async () => Promise.resolve({})),
  permissionsForMenu: (): string[] => mockPermissions(),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { dynamicAccess } = jest.requireActual<typeof DynamicAccessModule>("../../middlewares/dynamicAccess.middleware");

interface Outcome {
  status: number | null;
  passed: boolean;
  req: Record<string, unknown>;
}

const run = async (gate: ReturnType<typeof dynamicAccess>, req: Record<string, unknown>): Promise<Outcome> => {
  const outcome: Outcome = { status: null, passed: false, req };
  const res: Partial<Response> = {};
  res.status = (code: number) => {
    outcome.status = code;
    return res as Response;
  };
  res.json = () => res as Response;
  const next: NextFunction = (err?: unknown) => {
    outcome.passed = err === undefined;
  };
  await gate(req as unknown as Request, res as Response, next);
  return outcome;
};

const user = { id: "u-1", tenantId: "t-1", role: { id: "r-1", name: "TECHNICIAN" } };

beforeEach(() => {
  mockPermissions.mockReset().mockReturnValue([]);
  mockScopeAllows.mockReset().mockReturnValue(false);
});

describe("dynamicAccess — rules pinned by P9-19 gate (a)", () => {
  it("a checkTenant-only gate gives NO self bypass: the path naming the caller does not stand in for the permission", async () => {
    const out = await run(dynamicAccess("users", "write", { checkTenant: true }), { user, params: { id: "u-1" }, body: {}, query: {} });
    expect(out).toMatchObject({ status: 403, passed: false });
    // …while checkSelf on the same request does bypass.
    const self = await run(dynamicAccess("users", "write", { checkSelf: true }), { user, params: { id: "u-1" }, body: {}, query: {} });
    expect(self).toMatchObject({ status: null, passed: true });
  });

  it("an API key the gate allowed is marked apiKeyAuthorized (A-03); a user, or a refused key, is not", async () => {
    mockScopeAllows.mockReturnValue(true);
    const key = { id: "k-1", tenantId: "t-1", role: { id: "r-k" }, isApiKey: true, apiKeyScopes: ["warehouse:read"] };
    const allowed = await run(dynamicAccess("warehouse", "read"), { user: key, params: {}, body: {}, query: {} });
    expect(allowed.passed).toBe(true);
    expect(allowed.req["apiKeyAuthorized"]).toBe(true);

    mockScopeAllows.mockReturnValue(false);
    const refused = await run(dynamicAccess("warehouse", "read"), { user: { ...key }, params: {}, body: {}, query: {} });
    expect(refused).toMatchObject({ status: 403, passed: false });
    expect(refused.req["apiKeyAuthorized"]).toBeUndefined();

    mockPermissions.mockReturnValue(["read"]);
    const human = await run(dynamicAccess("warehouse", "read"), { user, params: {}, body: {}, query: {} });
    expect(human.passed).toBe(true);
    expect(human.req["apiKeyAuthorized"]).toBeUndefined();
  });

  it("the verb is case-insensitive: \"READ\" is a read, satisfied by a read grant", async () => {
    mockPermissions.mockReturnValue(["read"]);
    const out = await run(dynamicAccess("warehouse", "READ"), { user, params: {}, body: {}, query: {} });
    expect(out).toMatchObject({ status: null, passed: true });
    const write = await run(dynamicAccess("warehouse", "Write"), { user, params: {}, body: {}, query: {} });
    expect(write).toMatchObject({ status: 403, passed: false });
  });
});
