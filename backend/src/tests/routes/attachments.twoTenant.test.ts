/**
 * Two tenants — the authenticated /attachments/:id routes (CLAUDE.md: "Every
 * new :id route needs a two-tenant test asserting 404"). fileServing.s01
 * probes the download without comparing it with a missing id; this does.
 * GET /:id/signed has no principal — it is authorised by its HMAC capability
 * token — and is on the guard's reviewed allow-list.
 *
 * REAL router, dynamicAccess (role matrix granted), validateUuid, controller,
 * attachment service and audit service on the REAL models and tenant hooks
 * (fixtures/memoryDb). Doubled: the bytes — whether the stored file exists
 * (it does) and streaming it (sendStoredFile answers with the path it would
 * serve).
 *
 * @two-tenant api/attachments.route.js GET /:id
 * @two-tenant api/attachments.route.js GET /:id/download
 * @two-tenant api/attachments.route.js POST /:id/signed-url
 * @two-tenant api/attachments.route.js DELETE /:id
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as FileResponse from "../../utils/fileResponse.util";
import type * as RouteModule from "../../routes/api/attachments.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../utils/fileResponse.util", () => ({
  ...jest.requireActual<typeof FileResponse>("../../utils/fileResponse.util"),
  sendStoredFile: (res: { status: (c: number) => { json: (b: unknown) => unknown } }, absPath: string) => {
    res.status(200).json({ served: absPath });
    return Promise.resolve();
  },
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/attachments.route");

const ATTACHMENT_A = "a1000000-0000-4000-8000-000000000001";
const STORED_NAME = "3f0c2a-two-tenant.pdf";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const realExists = fs.existsSync.bind(fs);
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith(STORED_NAME) || realExists(p));
  jest.spyOn(fs, "unlinkSync").mockImplementation(() => undefined);
  jest.spyOn(fs.promises, "unlink").mockResolvedValue(undefined);
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("Attachment", {
    id: ATTACHMENT_A,
    tenantId: fx.tenantA.id,
    resourceType: "generic",
    fileName: STORED_NAME,
    originalName: "calibration-report.pdf",
    folder: "uploads/attachments",
    mimeType: "application/pdf",
    size: 1024,
    uploadedBy: ctx.owner.id,
  });
});

twoTenantSuite({
  module: "attachments",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:id", method: "GET", path: (id) => `/${id}`, id: () => ATTACHMENT_A },
    { key: "GET /:id/download", method: "GET", path: (id) => `/${id}/download`, id: () => ATTACHMENT_A },
    { key: "POST /:id/signed-url", method: "POST", path: (id) => `/${id}/signed-url`, id: () => ATTACHMENT_A },
    { key: "DELETE /:id", method: "DELETE", path: (id) => `/${id}`, id: () => ATTACHMENT_A, writes: ["Attachment", "AuditLog"] },
  ],
});
