/**
 * Two tenants — GET /certificates/:certificateId, its four transitions and
 * its PDF (CLAUDE.md: "Every new :id route needs a two-tenant test asserting
 * 404"). PUT and DELETE are covered by certificates.twoTenant.a145.test.js.
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted),
 * denyPlatformAuthoring, validate, controllers, certificate service (with its
 * locked transition, the Part 11 ESignatureRecord and the audit row),
 * workflow service and certificatePdf service, on the REAL models and tenant
 * hooks (fixtures/memoryDb). Doubled: the signer's password check (it answers
 * "valid" — re-authentication is not what is under test, and a foreign
 * certificate is refused before it runs), puppeteer, and the two filesystem
 * writes of a generated PDF.
 *
 * Each transition is probed on a tenant-A certificate in the state that
 * transition needs, so the owner's positive control can succeed.
 *
 * @two-tenant api/certificates.route.js GET /:certificateId
 * @two-tenant api/certificates.route.js POST /:certificateId/submit
 * @two-tenant api/certificates.route.js POST /:certificateId/approve
 * @two-tenant api/certificates.route.js POST /:certificateId/sign
 * @two-tenant api/certificates.route.js POST /:certificateId/revoke
 * @two-tenant api/certificates.route.js GET /:certificateId/pdf
 * @two-tenant api/certificates.route.js POST /:certificateId/pdf
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/certificates.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("puppeteer", () => ({
  launch: () =>
    Promise.resolve({
      newPage: () =>
        Promise.resolve({
          setContent: () => Promise.resolve(),
          pdf: () => Promise.resolve(Buffer.from("%PDF-1.4 two-tenant test")),
        }),
      close: () => Promise.resolve(),
    }),
}));

interface PasswordCheck {
  passIsValid(userId: string, password: string): Promise<{ data: { valid: boolean } }>;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const authService = jest.requireActual<PasswordCheck>("../../services/auth.service");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/certificates.route");

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const CERT = {
  draft: "a2000000-0000-4000-8000-000000000001",
  pending_approval: "a2000000-0000-4000-8000-000000000002",
  approved: "a2000000-0000-4000-8000-000000000003",
  signed: "a2000000-0000-4000-8000-000000000004",
} as const;
const REAUTH = { authMethod: "password", authPayload: "correct horse", meaning: "Reviewed and approved" };
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
  jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Infusion pump A", serialNumber: "SN-A-1" });
  mdb.seed(
    "Certificate",
    Object.entries(CERT).map(([status, id], i) => ({
      id,
      tenantId: fx.tenantA.id,
      deviceId: DEVICE_A,
      certificateNumber: `CERT-A-000${String(i + 1)}`,
      status,
      calibratedBy: ctx.owner.id,
      createdBy: ctx.owner.id,
    })),
  );
});

twoTenantSuite({
  module: "certificates",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:certificateId", method: "GET", path: (id) => `/${id}`, id: () => CERT.signed },
    {
      key: "POST /:certificateId/submit",
      method: "POST",
      path: (id) => `/${id}/submit`,
      id: () => CERT.draft,
      writes: ["Certificate", "AuditLog"],
    },
    {
      key: "POST /:certificateId/approve",
      method: "POST",
      path: (id) => `/${id}/approve`,
      id: () => CERT.pending_approval,
      body: REAUTH,
      writes: ["Certificate", "ESignatureRecord", "AuditLog"],
    },
    {
      key: "POST /:certificateId/sign",
      method: "POST",
      path: (id) => `/${id}/sign`,
      id: () => CERT.approved,
      body: { ...REAUTH, digitalSignature: "c2lnbmF0dXJl", digitalSignatureKeyId: "key-a-1" },
      writes: ["Certificate", "ESignatureRecord", "AuditLog"],
    },
    {
      key: "POST /:certificateId/revoke",
      method: "POST",
      path: (id) => `/${id}/revoke`,
      id: () => CERT.signed,
      body: { ...REAUTH, reason: "Reference standard found out of calibration" },
      writes: ["Certificate", "AuditLog"],
    },
    { key: "GET /:certificateId/pdf", method: "GET", path: (id) => `/${id}/pdf`, id: () => CERT.signed, writes: ["Certificate"] },
    { key: "POST /:certificateId/pdf", method: "POST", path: (id) => `/${id}/pdf`, id: () => CERT.signed, writes: ["Certificate"] },
  ],
});
