/**
 * Two tenants — the e-signature routes of a certificate (CLAUDE.md: "Every new :id route needs a
 * two-tenant test asserting 404"). P21-15 (ADR-140 § 6).
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted), denyPlatformAuthoring, validate,
 * controller, e-signature services, the models and tenant hooks (fixtures/memoryDb). Doubled: the
 * password check and the KMS unwrap. The owner calibrated the certificate and holds an active
 * e-signature, so its positive control (`performed`) succeeds.
 *
 * @two-tenant api/certificates.route.ts POST /:certificateId/esignatures
 * @two-tenant api/certificates.route.ts GET /:certificateId/esignatures
 */
import { generateKeyPairSync } from "node:crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/certificates.route";
import type SigningKeyWrapModule from "../../services/signingKeyWrap.service";

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
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const authService = jest.requireActual<PasswordCheck>("../../services/auth.service");
const signingKeyWrap = jest.requireActual<typeof SigningKeyWrapModule>("../../services/signingKeyWrap.service");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/certificates.route");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const CERT_A = "a2000000-0000-4000-8000-000000000003";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  jest.spyOn(authService, "passIsValid").mockResolvedValue({ data: { valid: true } });
  jest.spyOn(signingKeyWrap, "unwrapPrivateKey").mockReturnValue(privateKey);
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Infusion pump A", serialNumber: "SN-A-1" });
  mdb.seed("Certificate", { id: CERT_A, tenantId: fx.tenantA.id, deviceId: DEVICE_A, certificateNumber: "CERT-A-0003", status: "approved", calibratedBy: ctx.owner.id, createdBy: ctx.owner.id });
  for (const p of [ctx.owner, ctx.other]) {
    mdb.seed("UserEsignature", {
      id: `a5000000-0000-4000-8000-${p.id.slice(-12)}`,
      tenantId: p.tenantId,
      userId: p.id,
      version: 1,
      specimenSvg: "<svg></svg>",
      publicKeyPem: publicKey,
      privateKeyEnc: "synthetic-envelope",
      keyFingerprint: "f".repeat(64),
      status: "active",
    });
  }
});

twoTenantSuite({
  module: "certificates (e-signatures)",
  router,
  mdb,
  context: () => ctx,
  routes: [
    {
      key: "POST /:certificateId/esignatures",
      method: "POST",
      path: (id) => `/${id}/esignatures`,
      id: () => CERT_A,
      body: { meaning: "performed", authMethod: "password", credential: "correct horse" },
      ownerStatus: 201,
      writes: ["EsignatureApplication", "AuditLog", "ESignatureRecord"],
    },
    { key: "GET /:certificateId/esignatures", method: "GET", path: (id) => `/${id}/esignatures`, id: () => CERT_A },
  ],
});
