/**
 * The rsync image import's routes through their REAL chain (upstreamFileImports.route.ts:
 * `auth` → `denyApiKey` → `superAdminOnly` → Zod `validate` → controller), with the service
 * doubled (it is proven over the real models in tests/services/upstreamFileImport.service.test.ts).
 * Only `auth` is replaced (fixtures/routeClient), so the principal is chosen.
 *
 * The import table has no tenant (it names a TARGET tenant): the `:id` routes are allow-listed as
 * `platform` in the two-tenant guard; the proof that no tenant principal reaches them — 403 for a
 * tenant administrator in their own tenant, and for an API key — is here.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Service from "../../services/upstreamFileImport.service";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../services/upstreamFileImport.service", () => ({
  checkConnection: jest.fn(),
  startImport: jest.fn(),
  listImports: jest.fn(),
  getImport: jest.fn(),
  cancelImport: jest.fn(),
  getImportConfig: jest.fn(),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { as, call, twoTenants, seedTenants } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const svc = jest.requireMock<jest.Mocked<typeof Service>>("../../services/upstreamFileImport.service");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the mocks
const router = require("../../routes/api/upstreamFileImports.route") as unknown;

const ID = "5f0c2b8e-3a4d-4c6b-9e1f-7a8b9c0d1e2f";
const FP = `SHA256:${"A".repeat(43)}`;
const PASSWORD = "Route-PW-probe-1";
const SOURCE = {
  host: "test-ssh",
  port: 2222,
  username: "importer",
  authMethod: "password",
  password: PASSWORD,
  remotePath: "/srv/uploads",
  fileClasses: ["front"],
  syntheticSource: true,
};
const VIEW = { id: ID, status: "pending", credentialStored: true } as unknown as Service.ImportView;

let fx: RouteClient.TwoTenantWorld;

beforeEach(() => {
  mdb.reset();
  fx = twoTenants();
  seedTenants(mdb, fx, [fx.superAdmin]);
  svc.checkConnection.mockResolvedValue({ status: "host_key_unconfirmed", hostKeys: [{ type: "ssh-ed25519", fingerprint: FP }], confirmedHostKey: null, classes: {}, estimate: null });
  svc.startImport.mockResolvedValue(VIEW);
  svc.listImports.mockResolvedValue({ rows: [VIEW], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } });
  svc.getImport.mockResolvedValue(VIEW);
  svc.cancelImport.mockResolvedValue({ ...VIEW, cancelRequested: true });
  svc.getImportConfig.mockReturnValue({ realDataAllowed: false, allowListedHostCount: 1, heicConversion: false, fileClasses: [] });
  as(fx.superAdmin);
});

describe("the gate: super admin only, JWT only", () => {
  it.each([
    ["GET", "/config"],
    ["GET", "/"],
    ["GET", `/${ID}`],
    ["POST", "/check-connection"],
    ["POST", "/"],
    ["POST", `/${ID}/cancel`],
  ])("%s %s: a tenant administrator gets 403, an API key 403, no principal 401", async (method, url) => {
    as(fx.principal(fx.tenantA, "HEALTHCARE ADMIN"));
    expect((await call(router, method, url, { body: SOURCE })).status).toBe(403);
    as({ ...fx.superAdmin, isApiKey: true });
    expect((await call(router, method, url, { body: SOURCE })).status).toBe(403);
    as(null);
    expect((await call(router, method, url, { body: SOURCE })).status).toBe(401);
    expect(svc.checkConnection).not.toHaveBeenCalled();
    expect(svc.startImport).not.toHaveBeenCalled();
    expect(svc.cancelImport).not.toHaveBeenCalled();
  });
});

describe("the super admin", () => {
  it("GET /config answers the configuration", async () => {
    const res = await call(router, "GET", "/config");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { realDataAllowed: false, allowListedHostCount: 1 } });
  });

  it("POST /check-connection validates, then answers the outcome — never echoing the password", async () => {
    const res = await call(router, "POST", "/check-connection", { body: SOURCE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { status: "host_key_unconfirmed" } });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    const [input, actor] = svc.checkConnection.mock.calls[0] as [Record<string, unknown>, Service.Actor];
    expect(input).toMatchObject({ host: "test-ssh", password: PASSWORD, remotePath: "/srv/uploads" });
    expect(actor.userId).toBe(fx.superAdmin.id);
  });

  it.each([
    ["an injected host", { host: "host;reboot" }],
    ["a relative path", { remotePath: "srv" }],
    ["a traversal", { remotePath: "/srv/../etc" }],
    ["the certificate folder", { fileClasses: ["inventory"] }],
  ])("POST /check-connection refuses %s with 400 before the service", async (_label, over) => {
    const res = await call(router, "POST", "/check-connection", { body: { ...SOURCE, ...over } });
    expect(res.status).toBe(400);
    expect(svc.checkConnection).not.toHaveBeenCalled();
  });

  it("POST / starts an import (201)", async () => {
    const res = await call(router, "POST", "/", {
      body: { ...SOURCE, confirmedFingerprint: FP, targetTenantId: fx.tenantA.id },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ data: { id: ID, status: "pending" } });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
  });

  it("POST / without a confirmed fingerprint is a 400", async () => {
    expect((await call(router, "POST", "/", { body: { ...SOURCE, targetTenantId: fx.tenantA.id } })).status).toBe(400);
  });

  it("GET / lists: rows in data, pagination in a top-level meta", async () => {
    const res = await call(router, "GET", "/", { query: { page: "1", limit: "20" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: [{ id: ID }], meta: { total: 1, page: 1 } });
  });

  it("GET /:id and POST /:id/cancel; a malformed id is a 400", async () => {
    expect((await call(router, "GET", `/${ID}`)).body).toMatchObject({ data: { id: ID } });
    expect((await call(router, "POST", `/${ID}/cancel`)).body).toMatchObject({ data: { cancelRequested: true } });
    expect((await call(router, "GET", "/not-a-uuid")).status).toBe(400);
  });
});
