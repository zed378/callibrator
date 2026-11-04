/**
 * Two tenants — every /calibration-records/:calibrationRecordId route
 * (CLAUDE.md: "Every new :id route needs a two-tenant test asserting 404").
 *
 * REAL router, validateUuid, dynamicAccess (role matrix granted),
 * denyPlatformAuthoring, controller, calibrationRecords service and audit
 * service on the REAL models and tenant hooks (fixtures/memoryDb). The
 * correction and the void lock the record with an unscoped, non-paranoid
 * lookup (so a voided record can be explained as a 409): that lookup still
 * passes through the tenant hook, which is what keeps tenant B out.
 *
 * @two-tenant api/calibrationRecords.route.js GET /:calibrationRecordId
 * @two-tenant api/calibrationRecords.route.js POST /:calibrationRecordId/corrections
 * @two-tenant api/calibrationRecords.route.js POST /:calibrationRecordId/void
 * @two-tenant api/calibrationRecords.route.ts POST /:calibrationRecordId/esignatures
 * @two-tenant api/calibrationRecords.route.ts GET /:calibrationRecordId/esignatures
 *
 * P21-15 (ADR-140): the e-signature routes — the credential check and the KMS unwrap are spies (their
 * own suites test them); the owner holds an active e-signature; the record lookup is the tenant hook's.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type * as Suite from "../fixtures/twoTenantSuite";
import type { SuiteContext } from "../fixtures/twoTenantSuite";
import type * as RouteModule from "../../routes/api/calibrationRecords.route";
import type CertificateServiceModule from "../../services/certificate.service";
import type SigningKeyWrapModule from "../../services/signingKeyWrap.service";
import { generateKeyPairSync } from "node:crypto";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const { twoTenantSuite } = jest.requireActual<typeof Suite>("../fixtures/twoTenantSuite");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/calibrationRecords.route");
const certificateService = jest.requireActual<typeof CertificateServiceModule>("../../services/certificate.service");
const signingKeyWrap = jest.requireActual<typeof SigningKeyWrapModule>("../../services/signingKeyWrap.service");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const DEVICE_A = "a1000000-0000-4000-8000-000000000001";
const RECORD_A = "a2000000-0000-4000-8000-000000000001";
let ctx: SuiteContext;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  const fx = twoTenants();
  ctx = { owner: fx.principal(fx.tenantA, "HEALTCARE_ADMIN"), other: fx.principal(fx.tenantB, "HEALTCARE_ADMIN") };
  seedTenants(mdb, fx, [ctx.owner, ctx.other]);
  mdb.seed("CalibrationDevice", { id: DEVICE_A, tenantId: fx.tenantA.id, name: "Infusion pump A", serialNumber: "SN-A-1" });
  mdb.seed("CalibrationRecord", {
    id: RECORD_A,
    tenantId: fx.tenantA.id,
    deviceId: DEVICE_A,
    performedBy: ctx.owner.id,
    calibrationDate: new Date("2026-09-01"),
    isCompliant: true,
    notes: "Within tolerance",
  });
  jest.spyOn(certificateService, "verifySignerCredentials").mockResolvedValue(undefined);
  jest.spyOn(signingKeyWrap, "unwrapPrivateKey").mockReturnValue(privateKey);
  mdb.seed("UserEsignature", { id: "a5000000-0000-4000-8000-000000000001", tenantId: fx.tenantA.id, userId: ctx.owner.id, version: 1, specimenSvg: "<svg></svg>", publicKeyPem: publicKey, privateKeyEnc: "synthetic-envelope", keyFingerprint: "f".repeat(64), status: "active" });
});

const REASON = { reason: "Transcription error in the recorded results" };

twoTenantSuite({
  module: "calibration-records",
  router,
  mdb,
  context: () => ctx,
  routes: [
    { key: "GET /:calibrationRecordId", method: "GET", path: (id) => `/${id}`, id: () => RECORD_A },
    {
      key: "POST /:calibrationRecordId/corrections",
      method: "POST",
      path: (id) => `/${id}/corrections`,
      id: () => RECORD_A,
      body: { ...REASON, notes: "Corrected reading" },
      writes: ["CalibrationRecord", "AuditLog"],
    },
    {
      key: "POST /:calibrationRecordId/void",
      method: "POST",
      path: (id) => `/${id}/void`,
      id: () => RECORD_A,
      body: REASON,
      writes: ["CalibrationRecord", "AuditLog"],
    },
    {
      key: "POST /:calibrationRecordId/esignatures",
      method: "POST",
      path: (id) => `/${id}/esignatures`,
      id: () => RECORD_A,
      body: { meaning: "performed", authMethod: "password", credential: "synthetic-secret" },
      ownerStatus: 201,
      writes: ["EsignatureApplication", "AuditLog", "ESignatureRecord"],
    },
    { key: "GET /:calibrationRecordId/esignatures", method: "GET", path: (id) => `/${id}/esignatures`, id: () => RECORD_A },
  ],
});
