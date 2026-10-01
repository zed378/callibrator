/**
 * V-08 — A-02's tenant-admin gates, proved by BEHAVIOUR, not by chain shape.
 *
 * routeGuards.a02.test.js stubs `rbac` and asserts the stub was built with
 * `[TENANT_ADMIN]`. That assertion is satisfied by the argument, not by the
 * outcome: it passed on 2026-09-23 while the real gate admitted no tenant
 * admin at all (V-01 — `roleLevel` was never loaded onto req.user). It is kept
 * as the shape sweep ("no route on auth alone"); this file is the evidence
 * that the gate does what the A-02 commit claims.
 *
 * Only `auth` is stubbed — it installs a principal shaped exactly like
 * auth.service#getAuthUserWithTenant's projection (role: id, name,
 * description, roleLevel; tenant: id, name, status), and the source is read
 * to keep that projection honest. The REAL rbac and denyApiKey run; the
 * controllers are doubles, so a refusal is proved by "never reached".
 */
import fs from "node:fs";
import path from "node:path";
import type { Request, Response, Router } from "express";
import type * as RoleConstants from "../../constants/roleConstants";

let mockCurrentUser: Record<string, unknown> | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: () => void): void => {
      (req as unknown as { user: unknown }).user = mockCurrentUser;
      next();
    },
  };
});

// requireFeature (plan gating) is not the authorization under test.
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  requireFeature: () => (_req: Request, _res: Response, next: () => void): void => {
    next();
  },
  enforceStorageQuota: () => (_req: Request, _res: Response, next: () => void): void => {
    next();
  },
}));

const mockReached = (name: string) =>
  jest.fn((_req: Request, res: Response) => {
    res.status(200).json({ success: true, status: 200, message: name, data: [] });
  });

jest.mock("../../controllers/webhook.controller", () => ({
  create: mockReached("webhook.create"),
  list: mockReached("webhook.list"),
  getOne: mockReached("webhook.getOne"),
  update: mockReached("webhook.update"),
  remove: mockReached("webhook.remove"),
  deliveries: mockReached("webhook.deliveries"),
  test: mockReached("webhook.test"),
  rotateSecret: mockReached("webhook.rotateSecret"),
}));
jest.mock("../../controllers/storage.controller", () => ({
  getObject: mockReached("storage.getObject"),
  getSettings: mockReached("storage.getSettings"),
  updateSettings: mockReached("storage.updateSettings"),
  clearSettings: mockReached("storage.clearSettings"),
  testConnection: mockReached("storage.testConnection"),
  getUsage: mockReached("storage.getUsage"),
}));
jest.mock("../../controllers/apiKey.controller", () => ({
  create: mockReached("apiKey.create"),
  list: mockReached("apiKey.list"),
  getOne: mockReached("apiKey.getOne"),
  revoke: mockReached("apiKey.revoke"),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- the routers and controllers are JavaScript (CommonJS) */
const webhooks = require("../../routes/api/webhooks.route") as Router;
const storage = require("../../routes/api/storage.route") as Router;
const apiKeys = require("../../routes/api/apiKeys.route") as Router;
const webhookController = require("../../controllers/webhook.controller") as Record<string, jest.Mock>;
const storageController = require("../../controllers/storage.controller") as Record<string, jest.Mock>;
const apiKeyController = require("../../controllers/apiKey.controller") as Record<string, jest.Mock>;
/* eslint-enable @typescript-eslint/no-require-imports */
const { ROLE_NAMES, ROLE_LEVELS } = jest.requireActual<typeof RoleConstants>("../../constants/roleConstants");

const TENANT = "a0800000-0000-4000-8000-000000000001";

/** A principal with exactly getAuthUserWithTenant's projection. */
const principal = (name: string, roleLevel: number): Record<string, unknown> => ({
  id: "a0800000-0000-4000-8000-000000000002",
  tenantId: TENANT,
  role: { id: "a0800000-0000-4000-8000-000000000003", name, description: name, roleLevel },
  tenant: { id: TENANT, name: "Hospital A", status: "active" },
});

const TENANT_ADMIN = principal(ROLE_NAMES.HEALTCARE_ADMIN, ROLE_LEVELS.HEALTCARE_ADMIN);
const TECHNICIAN = principal(ROLE_NAMES.TECHNICIAN, ROLE_LEVELS.TECHNICIAN);

interface Answer {
  status: number;
  body: unknown;
}

const call = (router: Router, method: string, url: string): Promise<Answer> =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: unknown) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
      send(payload: unknown) {
        return res.json(payload);
      },
      setHeader() {
        return res;
      },
      set() {
        return res;
      },
      end() {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: null });
        return res;
      },
    };
    const req = {
      method,
      url,
      originalUrl: url,
      body: {},
      query: {},
      params: {},
      headers: {},
      ip: "10.0.0.8",
      get: (): undefined => undefined,
    };
    (router as unknown as { handle: (q: unknown, s: unknown, n: (e?: { status?: number; statusCode?: number; message?: string }) => void) => void }).handle(
      req,
      res,
      (err) => {
        resolve({ status: err ? (err.status ?? err.statusCode ?? 500) : 404, body: { message: err?.message ?? "no route" } });
      },
    );
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("V-08 — the principal matches getAuthUserWithTenant", () => {
  it("auth.service still projects role (id, name, description, roleLevel) and tenant (id, name, status)", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../services/auth.service.ts"), "utf8");
    const loader = source.slice(source.indexOf("const getAuthUserWithTenant"));
    expect(loader).toContain('attributes: ["id", "name", "description", "roleLevel"]');
    expect(loader).toContain('attributes: ["id", "name", "status"]');
  });
});

describe.each([
  ["webhooks", () => webhooks, "/", () => webhookController["list"]],
  ["storage settings", () => storage, "/settings", () => storageController["getSettings"]],
  ["api keys", () => apiKeys, "/", () => apiKeyController["list"]],
])("V-08 — %s: the REAL tenant-admin gate", (_name, router, url, handler) => {
  it("admits a tenant administrator (HEALTHCARE ADMIN, level 8)", async () => {
    mockCurrentUser = TENANT_ADMIN;
    const answer = await call(router(), "GET", url);
    expect(answer.status).toBe(200);
    expect(handler()).toHaveBeenCalledTimes(1);
  });

  it("refuses a technician (level 5) with 403, and the controller is never reached", async () => {
    mockCurrentUser = TECHNICIAN;
    const answer = await call(router(), "GET", url);
    expect(answer.status).toBe(403);
    expect(handler()).not.toHaveBeenCalled();
  });

  it("refuses an API key (denyApiKey), and the controller is never reached", async () => {
    mockCurrentUser = { ...TENANT_ADMIN, isApiKey: true };
    const answer = await call(router(), "GET", url);
    expect(answer.status).toBe(403);
    expect(handler()).not.toHaveBeenCalled();
  });
});
