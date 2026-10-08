/**
 * P21-09 — G-16 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 7.1,
 * § 7.2; AM-1, AM-2, AM-3): the facility context comes from the LOADED user row only, and a bound
 * account whose facility no longer lets it in is refused with a TOP-LEVEL machine-readable code.
 *
 * What is real: auth.middleware, tenantContext.middleware (the context the hooks read),
 * response.util (the envelope), utils/facilityRefusal.util. What is faked: the JWT verify, the
 * session check, the user loader, the API-key lookup.
 *
 * Fail-before (recorded): without the refusal step a bound user of an `ended` facility reached
 * `next()` with a bound context.
 */
import type { NextFunction, Request, Response } from "express";
import { SCOPE_LOSS_CODES } from "@callibrator/contracts/clientFacilities";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { facilityRefusalOf, FACILITY_REFUSAL_MESSAGES } from "../../utils/facilityRefusal.util";
import { registerRouteIndex } from "../../utils/routeTable";

jest.mock("../../utils/jwt.util", () => ({ verifyAccessToken: jest.fn() }));
jest.mock("../../services/auth.service", () => ({ getAuthUserWithTenant: jest.fn() }));
jest.mock("../../services/tenant.service", () => ({ getTenantByCodeForMiddleware: jest.fn(), getTenantByIdForMiddleware: jest.fn() }));
jest.mock("../../services/apiKey.service", () => ({ verifyApiKey: jest.fn() }));
jest.mock("../../services/session.service", () => ({
  isSessionLive: jest.fn(() => Promise.resolve(true)),
  runWithSession: jest.fn((_sessionId: unknown, fn: () => unknown) => fn()),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- the mocked modules, typed by what this test calls */
const { verifyAccessToken } = require("../../utils/jwt.util") as { verifyAccessToken: jest.Mock };
const authService = require("../../services/auth.service") as { getAuthUserWithTenant: jest.Mock };
const apiKeyService = require("../../services/apiKey.service") as { verifyApiKey: jest.Mock };
const { auth, optionalAuth } = require("../../middlewares/auth.middleware") as {
  auth: (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
  optionalAuth: (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const T = "22222222-2222-4222-8222-222222222222";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const U = "11111111-1111-4111-8111-111111111111";

const principal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: U,
  isActive: true,
  status: "ACTIVE",
  tenantId: T,
  tenant: { id: T, name: "Provider", status: "active" },
  role: { name: "HEALTHCARE TECHNICIAN" },
  clientFacilityId: null,
  clientFacility: null,
  facilityBindingPending: false,
  ...over,
});
const bound = (status: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  principal({ clientFacilityId: F1, clientFacility: { id: F1, status }, ...over });

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
  context?: TenantContextStore | undefined;
  nextCalled: boolean;
}

/** Run a middleware with a request carrying spoofed facility input everywhere it could hide. */
const run = async (mw: typeof auth, headers: Record<string, string> = {}): Promise<Captured> => {
  const out: Captured = { nextCalled: false };
  const req = {
    headers: {
      authorization: "Bearer token",
      "x-client-facility-id": F2,
      "x-facility-id": F2,
      ...headers,
    },
    body: { clientFacilityId: F2 },
    query: { clientFacilityId: F2 },
    params: { clientFacilityId: F2 },
    method: "GET",
    baseUrl: "/api/v1/calibration-devices",
    path: "/",
  } as unknown as Request;
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  await mw(req, res, () => {
    out.nextCalled = true;
    out.context = tenantStorage.getStore();
  });
  return out;
};

beforeAll(() => {
  // The facility route gate (called from the context middleware) resolves against an index; this
  // request names no mounted route, so it passes to the handler for every principal.
  registerRouteIndex({ root: { stack: [] }, fileOf: () => null });
});

afterAll(() => {
  registerRouteIndex(null);
});

beforeEach(() => {
  verifyAccessToken.mockReturnValue({ id: U, sid: "sess-1", facilityId: F2, clientFacilityId: F2 });
});

describe("G-16 — the facility context and the refusal codes", () => {
  it("an unbound account: unbound context, its user id, no facility", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal());
    const out = await run(auth);
    expect(out.nextCalled).toBe(true);
    expect(out.context).toMatchObject({ tenantId: T, userId: U, clientFacilityId: null, facilityBound: false });
  });

  it("a bound account: the facility is the ROW's — never the header, body, query, path or a token claim (FT-02, FT-06)", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(bound("active"));
    const out = await run(auth);
    expect(out.nextCalled).toBe(true);
    expect(out.context).toMatchObject({ tenantId: T, userId: U, clientFacilityId: F1, facilityBound: true });
  });

  it.each([
    ["inactive", "FACILITY_INACTIVE"],
    ["ended", "FACILITY_ENDED"],
  ])("a bound account of an %s facility: 403 with the top-level code %s", async (status, code) => {
    authService.getAuthUserWithTenant.mockResolvedValue(bound(status));
    const out = await run(auth);
    expect(out.nextCalled).toBe(false);
    expect(out.status).toBe(403);
    expect(out.body).toEqual({ success: false, status: 403, message: FACILITY_REFUSAL_MESSAGES[code as "FACILITY_ENDED"], data: null, code });
    expect(SCOPE_LOSS_CODES).toContain(code);
  });

  it("a bound account whose facility row did not load: FACILITY_UNRESOLVED (and an unknown status likewise)", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(bound("active", { clientFacility: null }));
    expect((await run(auth)).body?.["code"]).toBe("FACILITY_UNRESOLVED");
    authService.getAuthUserWithTenant.mockResolvedValue(bound("archived"));
    expect((await run(auth)).body?.["code"]).toBe("FACILITY_UNRESOLVED");
  });

  it("an account waiting for its binding (JIT/SCIM, AM-15): FACILITY_BINDING_PENDING, bound or not", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(principal({ facilityBindingPending: true }));
    const out = await run(auth);
    expect(out.status).toBe(403);
    expect(out.body?.["code"]).toBe("FACILITY_BINDING_PENDING");
  });

  it("optionalAuth treats a refused account as no principal (as a suspended tenant)", async () => {
    authService.getAuthUserWithTenant.mockResolvedValue(bound("ended"));
    const refused = await run(optionalAuth);
    expect(refused.nextCalled).toBe(true);
    expect(refused.context).toMatchObject({ userId: null, clientFacilityId: null, facilityBound: false });
    authService.getAuthUserWithTenant.mockResolvedValue(bound("active"));
    const ok = await run(optionalAuth);
    expect(ok.context).toMatchObject({ userId: U, clientFacilityId: F1, facilityBound: true });
  });

  it("an API key is tenant-wide by design (FT-04): unbound, no user", async () => {
    apiKeyService.verifyApiKey.mockResolvedValue({ id: "key-1", tenantId: T, scopes: [], tenant: { status: "active" }, clientFacilityId: F1 });
    const out = await run(auth, { authorization: "ApiKey raw" });
    expect(out.nextCalled).toBe(true);
    expect(out.context).toMatchObject({ tenantId: T, userId: null, clientFacilityId: null, facilityBound: false });
  });
});

describe("facilityRefusalOf", () => {
  it("nothing to refuse for no user, an unbound one, an active facility", () => {
    expect(facilityRefusalOf(null)).toBeNull();
    expect(facilityRefusalOf(undefined)).toBeNull();
    expect(facilityRefusalOf({ clientFacilityId: null })).toBeNull();
    expect(facilityRefusalOf({ clientFacilityId: "" })).toBeNull();
    expect(facilityRefusalOf({ clientFacilityId: F1, clientFacility: { status: "active" } })).toBeNull();
  });
});
