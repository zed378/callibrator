/**
 * A-273 — the path names the resource; a body (or query) cannot override it.
 *
 * Four controllers validated `{ ...req.params, ...req.body }`, so the BODY won:
 * on `PUT /data-retention/:tenantId/policy` the route checked the path tenant
 * and the service acted on the body's. Every site now merges through
 * utils/pathParams.util#withPathParams: the path wins, and a request naming a
 * different id is a 400 that reaches no service.
 *
 * The REAL controllers, validators, controller wrapper and response envelope
 * run; only the services are doubled. One case per site.
 * Fail-before: each "different id → 400" case reached the service with the
 * BODY's tenant (200), and the "path wins" query case used the query's id.
 */
import type { Request, Response } from "express";

jest.mock("../../services/dataRetention.service", () => ({
  setRetentionPolicy: jest.fn((tenantId: string) => Promise.resolve({ tenantId })),
  enableLegalHold: jest.fn((tenantId: string) => Promise.resolve({ tenantId })),
  maskPII: jest.fn((tenantId: string) => Promise.resolve({ tenantId })),
  anonymizeDataset: jest.fn((tenantId: string) => Promise.resolve({ tenantId })),
}));
jest.mock("../../services/featureFlag.service", () => ({
  isEnabled: jest.fn(() => Promise.resolve(true)),
  setTenantFlag: jest.fn((tenantId: string) => Promise.resolve({ tenantId })),
}));
jest.mock("../../services/tenantLifecycle.service", () => ({
  suspendTenant: jest.fn((tenantId: string) => Promise.resolve({ id: tenantId })),
}));
jest.mock("../../services/tenant.service", () => ({
  updateTenant: jest.fn((tenantId: string) => Promise.resolve({ id: tenantId })),
}));
jest.mock("../../services/tenantUpload.service", () => ({}));

/* eslint-disable @typescript-eslint/no-require-imports -- the controllers and services are JavaScript (CommonJS) */
type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void>;
const dataRetention = require("../../controllers/dataRetention.controller") as Record<string, Handler>;
const featureFlag = require("../../controllers/featureFlag.controller") as Record<string, Handler>;
const tenantLifecycle = require("../../controllers/tenantLifecycle.controller") as Record<string, Handler>;
const tenant = require("../../controllers/tenant.controller") as Record<string, Handler>;
const dataRetentionService = require("../../services/dataRetention.service") as Record<string, jest.Mock>;
const featureFlagService = require("../../services/featureFlag.service") as Record<string, jest.Mock>;
const tenantLifecycleService = require("../../services/tenantLifecycle.service") as Record<string, jest.Mock>;
const tenantService = require("../../services/tenant.service") as Record<string, jest.Mock>;
/* eslint-enable @typescript-eslint/no-require-imports */
import { withPathParams } from "../../utils/pathParams.util";

const PATH_TENANT = "a2730000-0000-4000-8000-000000000001";
const BODY_TENANT = "a2730000-0000-4000-8000-000000000002";
const OPERATOR = { id: "a2730000-0000-4000-8000-000000000003", tenantId: null, role: { name: "SUPERADMIN", roleLevel: 10 } };
const RECORD = "a2730000-0000-4000-8000-000000000004";

/** The arguments of a double's first call ([] when it was never called). */
const firstArgs = (mock: jest.Mock | undefined): unknown[] => (mock?.mock.calls[0] as unknown[] | undefined) ?? [];

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

const run = (handler: Handler | undefined, req: Record<string, unknown>): Promise<Answer> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    if (!handler) {
      throw new Error("no handler");
    }
    void handler(
      { user: OPERATOR, headers: {}, query: {}, body: {}, params: {}, ip: "10.0.0.9", get: () => undefined, ...req } as unknown as Request,
      res as unknown as Response,
      () => undefined,
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("A-273 — withPathParams", () => {
  it("the path wins and fills a missing key", () => {
    expect(withPathParams({ tenantId: PATH_TENANT }, { reason: "r" })).toEqual({ tenantId: PATH_TENANT, reason: "r" });
  });
  it("the same value repeated is accepted", () => {
    expect(withPathParams({ tenantId: PATH_TENANT }, { tenantId: PATH_TENANT })).toEqual({ tenantId: PATH_TENANT });
  });
  it("a number equal to its path segment is accepted", () => {
    expect(withPathParams({ id: "7" }, { id: 7 })).toEqual({ id: "7" });
  });
  it("null and undefined in the input are treated as absent", () => {
    expect(withPathParams({ tenantId: PATH_TENANT }, { tenantId: null })).toEqual({ tenantId: PATH_TENANT });
    expect(withPathParams({ tenantId: PATH_TENANT }, undefined)).toEqual({ tenantId: PATH_TENANT });
    expect(withPathParams({ tenantId: PATH_TENANT }, null)).toEqual({ tenantId: PATH_TENANT });
  });
  it("a different value is a 400 naming the key", () => {
    expect(() => withPathParams({ tenantId: PATH_TENANT }, { tenantId: BODY_TENANT })).toThrow(
      expect.objectContaining({ status: 400, message: expect.stringContaining('"tenantId"') as unknown }) as Error,
    );
  });
  it("an object or boolean can never name the path's resource: 400", () => {
    expect(() => withPathParams({ tenantId: PATH_TENANT }, { tenantId: { $ne: null } })).toThrow(
      expect.objectContaining({ status: 400 }) as Error,
    );
    expect(() => withPathParams({ tenantId: PATH_TENANT }, { tenantId: true })).toThrow(expect.objectContaining({ status: 400 }) as Error);
  });
  it("no path params: the input passes through (PATCH /tenants/edit)", () => {
    expect(withPathParams({}, { tenantId: BODY_TENANT, name: "x" })).toEqual({ tenantId: BODY_TENANT, name: "x" });
  });
});

describe.each([
  ["dataRetention#setRetentionPolicy", () => dataRetention["setRetentionPolicy"], () => dataRetentionService["setRetentionPolicy"], { policyKey: "audit_logs", days: 30 }],
  ["dataRetention#enableLegalHold", () => dataRetention["enableLegalHold"], () => dataRetentionService["enableLegalHold"], { reason: "litigation" }],
  ["dataRetention#maskPII", () => dataRetention["maskPII"], () => dataRetentionService["maskPII"], { entityType: "users", recordIds: [RECORD] }],
  ["dataRetention#anonymizeDataset", () => dataRetention["anonymizeDataset"], () => dataRetentionService["anonymizeDataset"], { entityType: "users" }],
  ["tenantLifecycle#suspendTenant", () => tenantLifecycle["suspendTenant"], () => tenantLifecycleService["suspendTenant"], { reason: "unpaid" }],
])("A-273 — %s", (_site, handler, service, body) => {
  it("a body naming ANOTHER tenant is 400 and reaches no service", async () => {
    const answer = await run(handler(), { params: { tenantId: PATH_TENANT }, body: { ...body, tenantId: BODY_TENANT } });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ success: false, status: 400 });
    expect(service()).not.toHaveBeenCalled();
  });

  it("the path tenant is the one acted on", async () => {
    const answer = await run(handler(), { params: { tenantId: PATH_TENANT }, body });
    expect(answer.status).toBe(200);
    expect(service()).toHaveBeenCalledTimes(1);
    expect(firstArgs(service())[0]).toBe(PATH_TENANT);
  });
});

describe("A-273 — featureFlag", () => {
  it("setTenantFlag: a body naming another tenant is 400", async () => {
    const answer = await run(featureFlag["setTenantFlag"], {
      params: { tenantId: PATH_TENANT, flagKey: "beta" },
      body: { enabled: true, tenantId: BODY_TENANT },
    });
    expect(answer.status).toBe(400);
    expect(featureFlagService["setTenantFlag"]).not.toHaveBeenCalled();
  });

  it("setTenantFlag: a body naming another flag is 400", async () => {
    const answer = await run(featureFlag["setTenantFlag"], {
      params: { tenantId: PATH_TENANT, flagKey: "beta" },
      body: { enabled: true, flagKey: "other" },
    });
    expect(answer.status).toBe(400);
    expect(featureFlagService["setTenantFlag"]).not.toHaveBeenCalled();
  });

  it("setTenantFlag: the path's tenant and flag are acted on", async () => {
    const answer = await run(featureFlag["setTenantFlag"], {
      params: { tenantId: PATH_TENANT, flagKey: "beta" },
      body: { enabled: true },
    });
    expect(answer.status).toBe(200);
    expect(firstArgs(featureFlagService["setTenantFlag"]).slice(0, 3)).toEqual([PATH_TENANT, "beta", true]);
  });

  it("isFlagEnabled: a query naming another tenant is 400 (it used to win)", async () => {
    const answer = await run(featureFlag["isFlagEnabled"], {
      params: { tenantId: PATH_TENANT, flagKey: "beta" },
      query: { tenantId: BODY_TENANT },
    });
    expect(answer.status).toBe(400);
    expect(featureFlagService["isEnabled"]).not.toHaveBeenCalled();
  });
});

describe("A-273 — tenant#updateTenant (PATCH /tenants/edit)", () => {
  it("has no path parameter: the body's tenantId is the one passed on (ownership is the service's, A-63)", async () => {
    const answer = await run(tenant["updateTenant"], { params: {}, body: { tenantId: BODY_TENANT, name: "Renamed" } });
    expect(answer.status).toBe(200);
    expect(firstArgs(tenantService["updateTenant"])[0]).toBe(BODY_TENANT);
  });

  it("if mounted with a :tenantId path, a differing body tenant is 400 and reaches no service", async () => {
    const answer = await run(tenant["updateTenant"], {
      params: { tenantId: PATH_TENANT },
      body: { tenantId: BODY_TENANT, name: "Renamed" },
    });
    expect(answer.status).toBe(400);
    expect(tenantService["updateTenant"]).not.toHaveBeenCalled();
  });
});
