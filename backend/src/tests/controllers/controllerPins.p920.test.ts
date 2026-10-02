/**
 * P9-20 — six controller behaviours that only the conversion's identity harness
 * watched. A planted defect in each (in a scratch mirror) left every existing
 * suite green; these tests pin them, so a regression fails the build.
 *
 *  1. tenant.createTenant — A-79: a body `logo` never reaches the service.
 *  2. user.getAllUsersSimple — A-109: the role include is LEFT (required: false).
 *  3. session list and detail — A-90: the user, role and tenant includes are LEFT.
 *  4. auth.loginMfa — A-288: the device-reported `location` reaches loginMfa.
 *  5. tenantBackup — the stats are the PATH tenant's (never the caller's), and
 *     the detail's creator and tenant includes are LEFT (A-90).
 *  6. scim.getUserById — the tenant is the principal's, never a query value.
 *
 * Each controller runs for real, with its services doubled at the module
 * boundary; the assertions are on what the controller hands those services.
 */
import type { Request, Response } from "express";

// ---- doubles ---------------------------------------------------------------

const mockTenantService = { createTenant: jest.fn() };
jest.mock("../../services/tenant.service", () => mockTenantService);
jest.mock("../../services/tenantUpload.service", () => ({}));

const mockUsersFindAll = jest.fn();
const mockSessions = { findAndCountAll: jest.fn(), findByPk: jest.fn() };
const mockTenantBackupFindByPk = jest.fn();
jest.mock("../../models", () => ({
  Users: { findAll: mockUsersFindAll },
  Roles: { name: "Roles" },
  Sessions: mockSessions,
  Tenants: { name: "Tenants" },
  TenantBackup: { findByPk: mockTenantBackupFindByPk, getTenantBackups: jest.fn() },
  sequelize: { transaction: (cb: (tx: string) => unknown) => cb("TX") },
}));
jest.mock("../../services/user.service", () => ({}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

const mockLoginMfa = jest.fn();
jest.mock("../../services/auth.service", () => ({ loginMfa: mockLoginMfa }));
jest.mock("../../services/rateLimiter.redis.service", () => ({
  noteAuthFailure: jest.fn().mockResolvedValue(undefined),
  noteAuthSuccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../utils/jwt.util", () => ({
  verifyPurposeToken: jest.fn(() => ({ id: "a9200000-0000-4000-8000-000000000001", mfaRequired: true })),
  generatePurposeToken: jest.fn(),
}));

const mockGetBackupStats = jest.fn();
jest.mock("../../services/tenantBackup.service", () => ({
  createBackup: jest.fn(),
  downloadBackup: jest.fn(),
  restoreBackup: jest.fn(),
  deleteBackup: jest.fn(),
  getBackupStats: mockGetBackupStats,
}));

const mockScimGetUserById = jest.fn();
jest.mock("../../services/scim.service", () => ({ getUserById: mockScimGetUserById }));

// ---- the controllers under test ---------------------------------------------

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;
type Controller = Record<string, Handler>;
/* eslint-disable @typescript-eslint/no-require-imports -- each controller is `export =` (CommonJS), loaded after its doubles */
const tenantController = require("../../controllers/tenant.controller") as Controller;
const userController = require("../../controllers/user.controller") as Controller;
const sessionController = require("../../controllers/session.controller") as Controller;
const authController = require("../../controllers/auth.controller") as Controller;
const tenantBackupController = require("../../controllers/tenantBackup.controller") as Controller;
const scimController = require("../../controllers/scim.controller") as Controller;
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "a9200000-0000-4000-8000-0000000000a1";
const OTHER_TENANT = "a9200000-0000-4000-8000-0000000000b2";
const USER = "a9200000-0000-4000-8000-000000000001";

/** Run one handler to its response (or its error). */
const run = (handler: Handler, req: Record<string, unknown>): Promise<{ status: number; body: unknown }> =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(body: unknown) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    const request = { ip: "203.0.113.9", headers: { "user-agent": "jest" }, params: {}, query: {}, body: {}, ...req };
    void handler(request as unknown as Request, res as unknown as Response, (err?: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

/** The `include` entries of a model call's options, by alias. */
const includesOf = (options: { include?: { as: string; required?: boolean; include?: unknown[] }[] }): Record<string, boolean | undefined> =>
  Object.fromEntries((options.include ?? []).map((inc) => [inc.as, inc.required]));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("P9-20 pins — what only the identity harness watched", () => {
  it("1. A-79: createTenant never forwards a body logo (no file was uploaded)", async () => {
    mockTenantService.createTenant.mockResolvedValue({ success: true, status: 201, data: { id: TENANT } });
    await run(tenantController["createTenant"] as Handler, {
      user: { id: USER, tenantId: TENANT, role: { name: "SUPERADMIN" } },
      body: { name: "New Hospital", code: "NEWH", logo: "another-tenant.png" },
    });
    const [input] = mockTenantService.createTenant.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({ name: "New Hospital", code: "NEWH" });
    expect(input).not.toHaveProperty("logo");
  });

  it("2. A-109: the simple user list joins the role LEFT", async () => {
    mockUsersFindAll.mockResolvedValue([]);
    await run(userController["getAllUsersSimple"] as Handler, { user: { id: USER, tenantId: TENANT, role: { name: "x", roleLevel: 1 } } });
    const [options] = mockUsersFindAll.mock.calls[0] as [Parameters<typeof includesOf>[0]];
    expect(includesOf(options)).toEqual({ role: false });
  });

  it("3. A-90: the session list and detail join user, role and tenant LEFT", async () => {
    mockSessions.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    await run(sessionController["getAllSessions"] as Handler, { query: {} });
    const [listOptions] = mockSessions.findAndCountAll.mock.calls[0] as [Parameters<typeof includesOf>[0] & { include: { include?: { as: string; required?: boolean }[] }[] }];
    expect(includesOf(listOptions)).toEqual({ user: false, tenant: false });
    expect(includesOf({ include: listOptions.include[0]?.include as { as: string; required?: boolean }[] })).toEqual({ role: false });

    mockSessions.findByPk.mockResolvedValue(null);
    await run(sessionController["getSessionById"] as Handler, { params: { id: "s1" } }).catch(() => undefined);
    const [, detailOptions] = mockSessions.findByPk.mock.calls[0] as [string, Parameters<typeof includesOf>[0] & { include: { include?: { as: string; required?: boolean }[] }[] }];
    expect(includesOf(detailOptions)).toEqual({ user: false, tenant: false });
    expect(includesOf({ include: detailOptions.include[0]?.include as { as: string; required?: boolean }[] })).toEqual({ role: false });
  });

  it("4. A-288: loginMfa receives the device-reported location", async () => {
    mockLoginMfa.mockResolvedValue({ data: {}, token: "t", session: null, refreshToken: "r" });
    const location = { latitude: -6.2, longitude: 106.8 };
    await run(authController["loginMfa"] as Handler, { body: { code: "123456", token: "mfa-token", location } });
    const args = mockLoginMfa.mock.calls[0] as unknown[];
    expect(args[4]).toEqual({ recoveryCode: undefined, location });
  });

  it("5a. backup stats are the PATH tenant's, never the caller's", async () => {
    mockGetBackupStats.mockResolvedValue({ data: { total: 0 }, message: "ok", status: 200 });
    await run(tenantBackupController["getBackupStats"] as Handler, {
      user: { id: USER, tenantId: OTHER_TENANT },
      params: { tenantId: TENANT },
    });
    expect((mockGetBackupStats.mock.calls[0] as unknown[])[0]).toBe(TENANT);
  });

  it("5b. A-90: a backup's creator and tenant are joined LEFT", async () => {
    mockTenantBackupFindByPk.mockResolvedValue(null);
    await run(tenantBackupController["getBackup"] as Handler, { params: { tenantId: TENANT, backupId: "b1" } });
    const [, options] = mockTenantBackupFindByPk.mock.calls[0] as [string, Parameters<typeof includesOf>[0]];
    expect(includesOf(options)).toEqual({ creator: false, tenant: false });
  });

  it("6. SCIM reads a user in the principal's tenant, never a query-named one", async () => {
    mockScimGetUserById.mockResolvedValue({ id: USER });
    await run(scimController["getUserById"] as Handler, {
      user: { id: "key-1", tenantId: TENANT, isApiKey: true },
      apiKeyAuthorized: true,
      params: { id: USER },
      query: { tenantId: OTHER_TENANT },
    });
    expect(mockScimGetUserById).toHaveBeenCalledWith(TENANT, USER);
  });
});
