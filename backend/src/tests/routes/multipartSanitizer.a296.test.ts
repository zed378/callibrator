/**
 * A-296 — a multipart body is sanitized exactly like its JSON twin.
 *
 * `globalSanitizer` is mounted app-wide in index.js, BEFORE the routers. A
 * JSON or urlencoded body is parsed by then, so it was escaped; a
 * multipart/form-data body is parsed later, by multer inside the route
 * (utils/upload.util#upload), so every field of it reached the controller —
 * and the database — as sent. A tenant renamed to `<script>…` through
 * `PATCH /tenants/edit` as form-data was stored raw (confirmed live by the
 * P9-19 helper, MEMORY/records/2026-09-29-p9-19-middlewares-round1.md).
 *
 * This drives REAL HTTP requests (node's fetch and FormData against a
 * listening server; supertest is not a dependency here) through the app's
 * own parser → bodyDefault → globalSanitizer order, the REAL tenant router,
 * the REAL upload() (real multer), controller, service and audit service, on
 * the REAL models and tenant hooks (fixtures/memoryDb). Doubled: `auth`
 * (routeClient.authMock), the permission matrix (grantAllMenus) and the
 * Redis-backed endpoint rate limiter.
 *
 * The assertion is the twin: the stored value of the multipart request equals
 * the stored value of the same fields sent as JSON, and both are escaped.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import xss from "xss";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as RouteModule from "../../routes/api/tenant.route";
import type * as Sanitizer from "../../middlewares/globalSanitizer.middleware";
import type * as ErrorHandlers from "../../middlewares/errorHandlers.middleware";
import type { RequestHandler } from "express";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
// The tenant-edit budget lives in Redis; it is not what this test is about.
jest.mock("../../services/rateLimiter.redis.service", () => ({
  endpointRateLimiter: (): RequestHandler => (_req, _res, next) => {
    next();
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/tenant.route");
const { globalSanitizer } = jest.requireActual<typeof Sanitizer>("../../middlewares/globalSanitizer.middleware");
const { errorHandler } = jest.requireActual<typeof ErrorHandlers>("../../middlewares/errorHandlers.middleware");
// bodyDefault is still JavaScript with no declaration; its one export is a handler.
const { bodyDefault } = jest.requireActual<{ bodyDefault: RequestHandler }>("../../middlewares/bodyDefault.middleware");

const PAYLOAD = '<script>alert("x")</script>Acme <img src=x onerror=alert(1)>';

let server: Server;
let base = "";
let tenantA = "";

beforeAll(async () => {
  // The order of index.js: body parsers, bodyDefault, globalSanitizer, routers,
  // error handler.
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(bodyDefault);
  app.use(globalSanitizer);
  // The route module is CommonJS (`module.exports = router`); its namespace type is not a Router.
  app.use("/api/v1/tenants", router as unknown as express.Router);
  app.use(errorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1/tenants`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  tenantA = fx.tenantA.id;
  seedTenants(mdb, fx, [fx.superAdmin]);
  as(fx.superAdmin);
});

const storedTenantA = (): Record<string, unknown> => {
  const row = mdb.rows("Tenant").find((t) => t["id"] === tenantA);
  if (!row) {
    throw new Error("tenant A is not seeded");
  }
  return row;
};

const editAsJson = (): Promise<Response> =>
  fetch(`${base}/edit`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tenantA, name: PAYLOAD }),
  });

const editAsMultipart = (): Promise<Response> => {
  const form = new FormData();
  form.append("tenantId", tenantA);
  form.append("name", PAYLOAD);
  return fetch(`${base}/edit`, { method: "PATCH", body: form });
};

describe("A-296: PATCH /tenants/edit stores a multipart body as it stores its JSON twin", () => {
  it("JSON: the stored name is escaped (the as-built JSON path, unchanged)", async () => {
    const res = await editAsJson();
    expect(res.status).toBe(200);
    expect(storedTenantA()["name"]).toBe(xss(PAYLOAD));
    expect(String(storedTenantA()["name"])).not.toContain("<script");
  });

  it("multipart/form-data: the stored value is escaped, byte-identical to the JSON twin", async () => {
    const json = await editAsJson();
    expect(json.status).toBe(200);
    const fromJson = { name: storedTenantA()["name"] };

    mdb.reset();
    const fx = twoTenants();
    seedTenants(mdb, fx, [fx.superAdmin]);

    const multipart = await editAsMultipart();
    expect(multipart.status).toBe(200);
    const fromMultipart = { name: storedTenantA()["name"] };

    expect(fromMultipart).toEqual(fromJson);
    expect(String(fromMultipart.name)).not.toContain("<script");
  });

  it("multipart/form-data: the response echoes the escaped value, as the JSON one does", async () => {
    const res = await editAsMultipart();
    const body = (await res.json()) as { data?: { name?: unknown } };
    expect(res.status).toBe(200);
    expect(body.data?.name).toBe(xss(PAYLOAD));
  });
});
