/**
 * P25-02 — the data-quality route on the admin router, through its REAL
 * chain over a real HTTP server: `router.use(auth)` + `rbac(SUPER_ADMIN)` and
 * `superAdminOnly`, Zod validation of the `:id`, and the real controller.
 * Only `auth` (the principal is chosen, fixtures/routeClient) and the
 * service (tested on its own, services/upstreamDataQuality.p2502) are
 * replaced.
 *
 * The run has no tenant: the `:id` route is allow-listed as `platform` in
 * the two-tenant guard; the proof that no tenant principal reaches it — 403
 * for a tenant administrator in their own tenant, before anything is read —
 * is here.
 */
import http from "http";
import type { AddressInfo } from "net";
import type * as RouteClient from "../fixtures/routeClient";
import type ExpressDefault from "express";
import type { ErrorRequestHandler, Router } from "express";

jest.mock("../../middlewares/auth.middleware", () => jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock());
const service = {
  reportDataQuality: jest.fn(),
};
jest.mock("../../services/upstreamDataQuality.service", () => service);

const { as, twoTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const express = jest.requireActual<typeof ExpressDefault>("express");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is loaded after the mocks
const adminRouter = require("../../routes/api/admin.route") as Router;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the house error handler, as index.ts mounts it
const { errorHandler } = require("../../middlewares/errorHandlers.middleware") as { errorHandler: ErrorRequestHandler };

const RUN = "a2502000-0000-4000-8000-0000000000e1";
const VIEW = { runId: RUN, providerTenantId: "a2502000-0000-4000-8000-0000000000a1", facilities: [], totals: [] };
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
  service.reportDataQuality.mockResolvedValue(VIEW);
});

const json = async (res: Response): Promise<{ status: number; body: Record<string, unknown> }> => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

describe("P25-02 — /admin/upstream-sql-imports/:id/data-quality", () => {
  it("a tenant administrator is refused (403), before the service runs", async () => {
    as(fx.principal(fx.tenantA, "TENANT_ADMIN"));
    expect((await fetch(`${base}/${RUN}/data-quality`)).status).toBe(403);
    expect(service.reportDataQuality).not.toHaveBeenCalled();
  });

  it("no principal is a 401", async () => {
    as(null);
    expect((await fetch(`${base}/${RUN}/data-quality`)).status).toBe(401);
  });

  it("the report: rows in `data`, never a value; a malformed id is a 400; a service 409 explains itself", async () => {
    expect(await json(await fetch(`${base}/${RUN}/data-quality`))).toMatchObject({ status: 200, body: { data: VIEW } });
    expect(service.reportDataQuality).toHaveBeenCalledWith(RUN);
    expect((await fetch(`${base}/not-a-uuid/data-quality`)).status).toBe(400);
    const { AppError } = jest.requireActual<{ AppError: new (s: number, m: string) => Error }>("../../utils/appError.util");
    service.reportDataQuality.mockRejectedValueOnce(new AppError(409, "The run's transform is transforming; only a transformed run can be reported."));
    expect(await json(await fetch(`${base}/${RUN}/data-quality`))).toMatchObject({
      status: 409,
      body: { message: "The run's transform is transforming; only a transformed run can be reported." },
    });
  });
});
