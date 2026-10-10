/**
 * P24-01 — `POST /admin/upstream-sql-imports/:id/transform` through its REAL chain over a real
 * HTTP server: the admin router's `auth` + `rbac(SUPER_ADMIN)`, `superAdminOnly`, Zod validation
 * of the `:id`, and the real controller. Only `auth` (fixtures/routeClient) and the two services
 * (each tested on its own) are replaced.
 *
 * The run has no tenant: the route is allow-listed as `platform` in the two-tenant guard; the
 * proof that no tenant principal reaches it — 403 for a tenant administrator in their own
 * tenant, before anything is read — is here. A refusal carries its top-level `code`.
 */
import http from "http";
import type { AddressInfo } from "net";
import type * as RouteClient from "../fixtures/routeClient";
import type ExpressDefault from "express";
import type { ErrorRequestHandler, Router } from "express";
import type * as CodedErrorModule from "../../utils/codedError.util";

jest.mock("../../middlewares/auth.middleware", () => jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock());
const importService = {
  getSettings: jest.fn(),
  listRuns: jest.fn(),
  getRun: jest.fn(),
  uploadDump: jest.fn(),
  cancelRun: jest.fn(),
  retryRun: jest.fn(),
};
const transformService = { requestTransform: jest.fn() };
jest.mock("../../services/upstreamSqlImport.service", () => importService);
jest.mock("../../services/upstreamSqlTransform.service", () => transformService);

const { as, twoTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const express = jest.requireActual<typeof ExpressDefault>("express");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is loaded after the mocks
const adminRouter = require("../../routes/api/admin.route") as Router;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the house error handler, as index.ts mounts it
const { errorHandler } = require("../../middlewares/errorHandlers.middleware") as { errorHandler: ErrorRequestHandler };
const { CodedError } = jest.requireActual<typeof CodedErrorModule>("../../utils/codedError.util");

const RUN = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const VIEW = { id: RUN, status: "loaded", transformStatus: "transform_requested" };
let base = "";
let server: http.Server;
const fx = twoTenants();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", adminRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/admin/upstream-sql-imports`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  jest.clearAllMocks();
  as(fx.superAdmin);
  transformService.requestTransform.mockResolvedValue(undefined);
  importService.getRun.mockResolvedValue(VIEW);
});

const post = async (id: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(`${base}/${id}/transform`, { method: "POST", headers: { "user-agent": "p2401-test" } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("P24-01 — POST /admin/upstream-sql-imports/:id/transform", () => {
  it("a tenant administrator is refused (403) before the service runs; no principal is a 401", async () => {
    as(fx.principal(fx.tenantA, "TENANT_ADMIN"));
    expect((await post(RUN)).status).toBe(403);
    as(null);
    expect((await post(RUN)).status).toBe(401);
    expect(transformService.requestTransform).not.toHaveBeenCalled();
    expect(importService.getRun).not.toHaveBeenCalled();
  });

  it("the super admin queues it: the service gets the id and the actor, the answer is the run (200, in `data`)", async () => {
    expect(await post(RUN)).toMatchObject({ status: 200, body: { success: true, data: VIEW } });
    expect(transformService.requestTransform).toHaveBeenCalledWith(RUN, expect.objectContaining({ userId: fx.superAdmin.id, userAgent: "p2401-test" }));
    expect(importService.getRun).toHaveBeenCalledWith(RUN);
  });

  it("a malformed id is a 400 before the service", async () => {
    expect((await post("not-a-uuid")).status).toBe(400);
    expect(transformService.requestTransform).not.toHaveBeenCalled();
  });

  it.each([
    [404, "UPSTREAM_SQL_IMPORT_NOT_FOUND"],
    [409, "TRANSFORM_NOT_AVAILABLE"],
    [409, "RUN_NOT_LOADED"],
    [409, "TRANSFORM_IN_PROGRESS"],
    [403, "REAL_DATA_NOT_ALLOWED"],
  ])("a service refusal %i %s answers with its top-level code, and no run", async (status, code) => {
    transformService.requestTransform.mockRejectedValueOnce(new CodedError(status, code, `refused: ${code}`));
    expect(await post(RUN)).toMatchObject({ status, body: { code, message: `refused: ${code}` } });
    expect(importService.getRun).not.toHaveBeenCalled();
  });
});
