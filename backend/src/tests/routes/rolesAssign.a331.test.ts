/**
 * A-331 (ADR-100 Amendment 4) — `POST /roles/assign` answered the whole User
 * row: the bcrypt password hash, the MFA seed envelopes, the recovery codes,
 * the OTP and the WebAuthn columns. It now answers a named projection.
 *
 * The real roles router, controller, service, models (with their toJSON) and
 * tenant hooks over memoryDb. routeClient also scans every response for
 * credential material (S-20), so this suite fails on a leak twice over.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal, TwoTenantWorld } from "../fixtures/routeClient";
import type * as RolesRoutes from "../../routes/api/roles.route";
import type RolesServiceClass from "../../services/roles.service";
import type * as SecretScan from "../support/secretScan";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, as, call, grantAllMenus } =
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const roles = jest.requireActual<typeof RolesRoutes>("../../routes/api/roles.route");
const RolesService = jest.requireActual<typeof RolesServiceClass>("../../services/roles.service");
const { findSecrets } = jest.requireActual<typeof SecretScan>("../support/secretScan");

const TARGET = "a3310000-0000-4000-8000-000000000001";
const NEW_ROLE = "a3310000-0000-4000-8000-000000000002";
const BCRYPT = `$2b$12$${"a".repeat(53)}`;
const PROJECTION = ["email", "firstName", "id", "isActive", "lastName", "roleId", "status", "tenantId", "username"];

let fx: TwoTenantWorld;
let operator: Principal;

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  fx = twoTenants();
  operator = fx.superAdmin;
  seedTenants(mdb, fx, [operator]);
  mdb.seed("Role", { id: NEW_ROLE, name: "TECHNICIAN", roleLevel: 3, status: "active" });
  mdb.seed("User", {
    id: TARGET,
    tenantId: fx.tenantA.id,
    username: "target",
    email: "target@a.test",
    firstName: "Tar",
    lastName: "Get",
    password: BCRYPT,
    mfaEnabled: true,
    mfaSecret: "kms:v1:seed-envelope",
    mfaPendingSecret: "kms:v1:pending-envelope",
    mfaRecoveryCodes: ["hash-1", "hash-2"],
    otpCode: "otp-sha256",
    webauthnEnabled: true,
    webauthnCredentialId: "cred-id",
    webauthnPublicKey: "pub-key",
    status: "ACTIVE",
    isActive: true,
    isDeleted: false,
  });
});

it("the service answers the named projection, and nothing else", async () => {
  const answer = await RolesService.assignRoleToUser(TARGET, NEW_ROLE, { userId: operator.id });
  expect(Object.keys(answer).sort()).toEqual(PROJECTION);
  expect(answer).toMatchObject({ id: TARGET, roleId: NEW_ROLE, username: "target" });
  expect(JSON.stringify(answer)).not.toContain(BCRYPT);
  expect(findSecrets(answer)).toEqual([]);
});

it("POST /roles/assign: 200, the role is stored, and the body carries no credential", async () => {
  as(operator);
  const res = await call(roles, "POST", "/assign", { body: { userId: TARGET, roleId: NEW_ROLE } });
  expect(res.status).toBe(200);
  const data = (res.body as { data: Record<string, unknown> }).data;
  expect(Object.keys(data).sort()).toEqual(PROJECTION);
  expect(JSON.stringify(res.body)).not.toMatch(/\$2b\$|kms:v1|otp-sha256|cred-id|pub-key|hash-1/);
  expect(mdb.rows("User").find((u) => u["id"] === TARGET)?.["roleId"]).toBe(NEW_ROLE);
});
