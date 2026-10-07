/**
 * P24-06 — the SQL-dump import's routes on the admin router, through their REAL
 * chains over a real HTTP server: `router.use(auth)` + `rbac(SUPER_ADMIN)` and
 * `superAdminOnly` on each route, the real multer upload into the quarantine
 * (size, extension, field), Zod validation of the `:id` and the query, and the
 * real controller. Only `auth` (the principal is chosen, fixtures/routeClient)
 * and the service (tested on its own, services/upstreamSqlImport.service.p2406)
 * are replaced.
 *
 * The runs have no tenant: the `:id` routes are allow-listed as `platform` in
 * the two-tenant guard; the proof that no tenant principal reaches them — 403
 * for a tenant administrator in their own tenant, before anything is read — is
 * here.
 *
 * The upload's own time budget (uploadTimeBudget) is tested on a request double.
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { EventEmitter } from "events";
import type { AddressInfo } from "net";
import type * as RouteClient from "../fixtures/routeClient";
import type ExpressDefault from "express";
import type { ErrorRequestHandler, Router } from "express";
import type * as PathModule from "path";
import type * as ControllerModule from "../../controllers/upstreamSqlImport.controller";
import { environment } from "../../config/env";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "p2406-route-"));
const penv = environment();

jest.mock("../../utils/storagePath.util", () => (...parts: string[]) => jest.requireActual<typeof PathModule>("path").join(TMP, ...parts));
jest.mock("../../middlewares/auth.middleware", () => jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock());
const service = {
  getSettings: jest.fn(),
  listRuns: jest.fn(),
  getRun: jest.fn(),
  uploadDump: jest.fn(),
  cancelRun: jest.fn(),
  retryRun: jest.fn(),
};
jest.mock("../../services/upstreamSqlImport.service", () => service);

const { as, twoTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const express = jest.requireActual<typeof ExpressDefault>("express");
const controller = jest.requireActual<typeof ControllerModule>("../../controllers/upstreamSqlImport.controller");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is loaded after the mocks
const adminRouter = require("../../routes/api/admin.route") as Router;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the house error handler, as index.ts mounts it
const { errorHandler } = require("../../middlewares/errorHandlers.middleware") as { errorHandler: ErrorRequestHandler };

const RUN = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const VIEW = { id: RUN, status: "uploaded" };
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
  fs.rmSync(TMP, { recursive: true, force: true });
});
beforeEach(() => {
  jest.clearAllMocks();
  as(fx.superAdmin);
  service.getSettings.mockReturnValue({ maxUploadBytes: 1, maxUncompressedBytes: 2, failedRetentionDays: 7, realDataAllowed: false, transformAvailable: false });
  service.listRuns.mockResolvedValue({ rows: [VIEW], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
  service.getRun.mockResolvedValue(VIEW);
  service.uploadDump.mockResolvedValue(VIEW);
  service.cancelRun.mockResolvedValue({ ...VIEW, status: "cancelled" });
  service.retryRun.mockResolvedValue(VIEW);
  delete penv["UPSTREAM_IMPORT_MAX_BYTES"];
});

const form = (name: string, body: string, fields: Record<string, string> = { dataClass: "synthetic" }, type = "application/sql"): FormData => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    data.append(k, v);
  }
  data.append("file", new Blob([body], { type }), name);
  return data;
};
const json = async (res: Response): Promise<{ status: number; body: Record<string, unknown> }> => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

describe("P24-06 — /admin/upstream-sql-imports", () => {
  it("a tenant administrator is refused (403) on every route, before the service or multer runs", async () => {
    as(fx.principal(fx.tenantA, "TENANT_ADMIN"));
    const answers = await Promise.all([
      fetch(`${base}/settings`),
      fetch(base),
      fetch(base, { method: "POST", body: form("d.sql", "-- x\n") }),
      fetch(`${base}/${RUN}`),
      fetch(`${base}/${RUN}/cancel`, { method: "POST" }),
      fetch(`${base}/${RUN}/retry`, { method: "POST" }),
    ]);
    expect(answers.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    expect(fs.existsSync(path.join(TMP, "uploads", ".quarantine")) ? fs.readdirSync(path.join(TMP, "uploads", ".quarantine")) : []).toEqual([]);
  });

  it("no principal is a 401", async () => {
    as(null);
    expect((await fetch(base)).status).toBe(401);
  });

  it("settings and the list: rows in `data`, pagination in a top-level `meta`; the query is validated", async () => {
    expect(await json(await fetch(`${base}/settings`))).toMatchObject({ status: 200, body: { data: { maxUploadBytes: 1, realDataAllowed: false } } });
    const list = await json(await fetch(`${base}?status=failed&page=2&limit=5`));
    expect(list).toMatchObject({ status: 200, body: { data: [VIEW], meta: { total: 1 } } });
    expect(service.listRuns).toHaveBeenCalledWith({ status: "failed", page: 2, limit: 5 });
    expect((await fetch(`${base}?status=bogus`)).status).toBe(400);
  });

  it("an upload goes through multer into the quarantine and reaches the service with the super admin as actor (201)", async () => {
    const res = await json(await fetch(base, { method: "POST", body: form("skp_ipm.sql", "-- MariaDB dump\n") }));
    expect(res).toMatchObject({ status: 201, body: { data: VIEW } });
    const [file, body, actor] = service.uploadDump.mock.calls[0] as [{ path: string; size: number }, Record<string, unknown>, Record<string, unknown>];
    expect(path.dirname(file.path)).toBe(path.join(TMP, "uploads", ".quarantine"));
    expect(path.basename(file.path)).not.toContain("skp_ipm");
    expect(file.size).toBe(16);
    expect(body).toMatchObject({ dataClass: "synthetic" });
    expect(actor).toMatchObject({ userId: fx.superAdmin.id, tenantId: fx.superAdmin.tenantId, ipAddress: expect.any(String) as unknown });
    fs.rmSync(file.path, { force: true });
  });

  it("a gzip upload under any of the names browsers give it is accepted for the service to sniff", async () => {
    for (const type of ["application/gzip", "application/octet-stream", "text/plain"]) {
      expect((await fetch(base, { method: "POST", body: form("d.sql.gz", "x", undefined, type) })).status).toBe(201);
    }
  });

  it("refuses an upload with no file, another extension, or over UPSTREAM_IMPORT_MAX_BYTES (400) — before the service", async () => {
    const noFile = new FormData();
    noFile.append("dataClass", "synthetic");
    expect(await json(await fetch(base, { method: "POST", body: noFile }))).toMatchObject({ status: 400, body: { message: expect.stringContaining("multipart field `file`") as unknown } });
    expect((await fetch(base, { method: "POST", body: form("dump.zip", "PK") })).status).toBe(400);
    penv["UPSTREAM_IMPORT_MAX_BYTES"] = "8";
    expect(await json(await fetch(base, { method: "POST", body: form("d.sql", "-- far more than eight bytes\n") }))).toMatchObject({ status: 400, body: { message: expect.stringContaining("File too large") as unknown } });
    expect(service.uploadDump).not.toHaveBeenCalled();
  });

  it("a run by id, its cancellation and its retry; a malformed id is a 400; a service 409 explains itself", async () => {
    expect(await json(await fetch(`${base}/${RUN}`))).toMatchObject({ status: 200, body: { data: VIEW } });
    expect(await json(await fetch(`${base}/${RUN}/cancel`, { method: "POST" }))).toMatchObject({ status: 200, body: { data: { status: "cancelled" } } });
    expect((await fetch(`${base}/${RUN}/retry`, { method: "POST" })).status).toBe(200);
    expect(service.cancelRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ userId: fx.superAdmin.id }));
    expect((await fetch(`${base}/not-a-uuid`)).status).toBe(400);
    const { AppError } = jest.requireActual<{ AppError: new (s: number, m: string) => Error }>("../../utils/appError.util");
    service.retryRun.mockRejectedValueOnce(new AppError(409, "The run is loaded; only a failed run can be retried."));
    expect(await json(await fetch(`${base}/${RUN}/retry`, { method: "POST" }))).toMatchObject({ status: 409, body: { message: "The run is loaded; only a failed run can be retried." } });
  });

  it("a principal with no home tenant reaches the service with tenantId null", async () => {
    as({ ...fx.superAdmin, tenantId: null as unknown as string });
    await fetch(`${base}/${RUN}/cancel`, { method: "POST" });
    expect(service.cancelRun).toHaveBeenCalledWith(RUN, expect.objectContaining({ tenantId: null }));
  });
});

describe("P24-06 — the upload's own time budget", () => {
  const fakeRequest = (): EventEmitter & { clearTimeout?: jest.Mock; timedout?: boolean } => Object.assign(new EventEmitter(), { clearTimeout: jest.fn() });

  it("replaces the application's 30 s with UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS, and times the request out after it", async () => {
    penv["UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS"] = "5";
    const req = fakeRequest();
    const res = new EventEmitter();
    const next = jest.fn();
    const timeout = new Promise((resolve) => req.on("timeout", resolve));
    controller.uploadTimeBudget(req as never, res as never, next);
    expect(req.clearTimeout).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
    expect(await timeout).toBe(5);
    expect(req.timedout).toBe(true);
    delete penv["UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS"];
  });

  it("a request that ends first clears the timer; one without connect-timeout's handle is fine", async () => {
    penv["UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS"] = "20";
    const req = new EventEmitter() as EventEmitter & { timedout?: boolean };
    const res = new EventEmitter();
    controller.uploadTimeBudget(req as never, res as never, jest.fn());
    res.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(req.timedout).toBeUndefined();
    delete penv["UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS"];
  });
});
