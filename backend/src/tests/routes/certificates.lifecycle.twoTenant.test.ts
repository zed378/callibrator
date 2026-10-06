/**
 * Two tenants — GET /certificates/:certificateId, its four transitions, its
 * document and its stored PDF (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404"). PUT and DELETE are covered by
 * certificates.twoTenant.a145.test.js.
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted),
 * denyPlatformAuthoring, validate, controllers, certificate service (with its
 * locked transition, the Part 11 ESignatureRecord and the audit row),
 * workflow service, certificatePdf service and certificateDocument service, on
 * the REAL models and tenant hooks (fixtures/memoryDb). Doubled: the signer's
 * password check (it answers "valid" — re-authentication is not what is under
 * test, and a foreign certificate is refused before it runs), and the disk
 * check for the stored pre-M-11 PDF. The backend renders no PDF (ADR-095), so
 * nothing is written for one.
 *
 * Each transition is probed on a tenant-A certificate in the state that
 * transition needs, so the owner's positive control can succeed.
 *
 * ADR-101 (separation of duties): the owner drafted every certificate here
 * (`createdBy`), so it may not approve one. The approval's positive control
 * runs as `reviewer`, a second administrator of the SAME tenant; a separate
 * case asserts the author's approval is refused (403) and writes nothing.
 *
 * @two-tenant api/certificates.route.js GET /:certificateId
 * @two-tenant api/certificates.route.js POST /:certificateId/submit
 * @two-tenant api/certificates.route.js POST /:certificateId/approve
 * @two-tenant api/certificates.route.js POST /:certificateId/sign
 * @two-tenant api/certificates.route.js POST /:certificateId/revoke
 * @two-tenant api/certificates.route.js GET /:certificateId/document
 * @two-tenant api/certificates.route.js GET /:certificateId/pdf
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/certificates.route";

// P8-01 (ADR-086 Amendment 1): the stored PDF is looked for in storage first.
// The double holds none, so the PDF is found at its legacy path, as before.
jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

interface PasswordCheck {
  passIsValid(userId: string, password: string): Promise<{ data: { valid: boolean } }>;
}

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
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
const STORED_PDF = "1758600000000-4242-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.pdf";
const REAUTH = { authMethod: "password", authPayload: "correct horse", meaning: "Reviewed and approved" };
/** The suite's context, plus a second administrator of the owner's tenant (ADR-101). */
interface LifecycleContext extends SuiteContext {
  reviewer: SuiteContext["owner"];
}
let ctx: LifecycleContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
  // The signed certificate has a PDF stored before M-11; only its file is doubled.
  const realExists = fs.existsSync;
  jest.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith(STORED_PDF) || realExists(p));
  const fx = twoTenants();
  ctx = {
    owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"),
    other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN"),
    reviewer: fx.principal(fx.tenantA, "CALIBRATOR_ADMIN"),
  };
  seedTenants(mdb, fx, [ctx.owner, ctx.other, ctx.reviewer]);
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
      filePath: status === "signed" ? `certificates/${STORED_PDF}` : null,
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
      // ADR-101: the owner drafted it; another user of the same tenant approves.
      ownerPrincipal: (c) => c.reviewer,
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
    { key: "GET /:certificateId/document", method: "GET", path: (id) => `/${id}/document`, id: () => CERT.signed },
    { key: "GET /:certificateId/pdf", method: "GET", path: (id) => `/${id}/pdf`, id: () => CERT.signed },
  ],
});

describe("ADR-101 — separation of duties on POST /:certificateId/approve", () => {
  it("the certificate's author is refused (403, the rule named), and nothing is written", async () => {
    as(ctx.owner);
    const passIsValid = jest.spyOn(authService, "passIsValid");
    const before = mdb.committed().length;

    const res = await call(router, "POST", `/${CERT.pending_approval}/approve`, { body: REAUTH });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/separation of duties/);
    expect(mdb.committed().slice(before)).toEqual([]);
    expect(passIsValid).not.toHaveBeenCalled();
  });
});
