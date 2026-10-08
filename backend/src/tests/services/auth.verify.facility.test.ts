/**
 * P21-09 — `POST /auth/verify` ("who am I") gains the facility scope (spec
 * MEMORY/specs/P19-04-client-facilities.md § 13.1; P19-08 § 9.5, AM-26; G-27's server half):
 * `clientFacilityId`, `facilityBound`, `facilityMode` and `scopeFingerprint`.
 *
 *  - `facilityMode` is `single` while the tenant has only its self facility (the frontend then
 *    hides every facility concept — a self-served hospital notices nothing) and `multi` once it
 *    serves a client facility;
 *  - the fingerprint is SHA-256 (hex) of the contract's canonical text, and it CHANGES when the
 *    binding, the role or the bound facility's status changes — the PWA purges on a change.
 * The REAL auth.service, models and hooks over memoryDb; the bound call runs in a bound context
 * (the readable rule gives the user its own facility row only).
 */
import { createHash } from "crypto";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as AuthServiceModule from "../../services/auth.service";
import { scopeFingerprintInput } from "@callibrator/contracts/clientFacilities";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const authService = jest.requireActual<typeof AuthServiceModule>("../../services/auth.service");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const ROLE = "70707070-7070-4070-8070-707070707070";
const ROLE2 = "71717171-7171-4171-8171-717171717171";
const U = "11111111-1111-4111-8111-111111111111";

const seed = ({ client = false, bound = false, status = "active", roleId = ROLE } = {}): void => {
  mdb.reset();
  mdb.seed("Role", [{ id: ROLE, name: "HEALTHCARE TECHNICIAN", roleLevel: 3 }, { id: ROLE2, name: "ROOM USER", roleLevel: 1 }]);
  mdb.seed("ClientFacility", { id: SELF, tenantId: T, name: "Self", code: "SELF", isSelf: true, status: "active" });
  if (client) {
    mdb.seed("ClientFacility", { id: F1, tenantId: T, name: "Facility One", code: "F-0001", isSelf: false, status });
  }
  mdb.seed("User", {
    id: U,
    tenantId: T,
    username: "tech",
    email: "tech@example.test",
    firstName: "Tech",
    lastName: "One",
    roleId,
    isActive: true,
    status: "ACTIVE",
    clientFacilityId: bound ? F1 : null,
  });
};

const ctx = (bound: boolean): TenantContextStore => ({
  tenantId: T as TenantId,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: U,
  clientFacilityId: (bound ? F1 : null) as ClientFacilityId | null,
  facilityBound: bound,
});

const verify = async (bound: boolean): Promise<Record<string, unknown>> => {
  const result = await tenantStorage.run(ctx(bound), () => authService.verifyUserSession(U));
  return result["data"] as Record<string, unknown>;
};

const fingerprint = (clientFacilityId: string | null, roleId: string, facilityStatus: string | null): string =>
  createHash("sha256").update(scopeFingerprintInput({ tenantId: T, clientFacilityId, roleId, facilityStatus })).digest("hex");

describe("P21-09 — POST /auth/verify reports the facility scope", () => {
  it("a self-served tenant: single mode, unbound, the unbound fingerprint", async () => {
    seed();
    const data = await verify(false);
    expect(data).toMatchObject({ clientFacilityId: null, facilityBound: false, facilityMode: "single" });
    expect(data["scopeFingerprint"]).toBe(fingerprint(null, ROLE, null));
    expect(data["scopeFingerprint"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a provider tenant with a client facility: multi mode for its unbound staff", async () => {
    seed({ client: true });
    expect(await verify(false)).toMatchObject({ facilityBound: false, facilityMode: "multi" });
  });

  it("a bound user: its facility, multi mode, a fingerprint over the facility and its status", async () => {
    seed({ client: true, bound: true });
    const data = await verify(true);
    expect(data).toMatchObject({ clientFacilityId: F1, facilityBound: true, facilityMode: "multi" });
    expect(data["scopeFingerprint"]).toBe(fingerprint(F1, ROLE, "active"));
  });

  it("the fingerprint changes with the binding, the role and the facility's status (AM-26)", async () => {
    seed({ client: true, bound: true });
    const base = (await verify(true))["scopeFingerprint"];
    seed({ client: true, bound: false });
    expect((await verify(false))["scopeFingerprint"]).not.toBe(base);
    seed({ client: true, bound: true, roleId: ROLE2 });
    expect((await verify(true))["scopeFingerprint"]).not.toBe(base);
    seed({ client: true, bound: true, status: "inactive" });
    expect((await verify(true))["scopeFingerprint"]).not.toBe(base);
    seed({ client: true, bound: true });
    expect((await verify(true))["scopeFingerprint"]).toBe(base);
  });

  it("a bound user whose facility row cannot be read: the status part is `-`", async () => {
    seed({ client: false, bound: true });
    const data = await verify(true);
    expect(data["scopeFingerprint"]).toBe(fingerprint(F1, ROLE, null));
  });

  it("a tenant-less principal (a platform operator) is single and unbound", async () => {
    seed();
    mdb.reset();
    mdb.seed("User", { id: U, tenantId: null, username: "op", email: "op@example.test", firstName: "O", lastName: "P", isActive: true, status: "ACTIVE" });
    const data = await tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => authService.verifyUserSession(U));
    expect(data["data"]).toMatchObject({ clientFacilityId: null, facilityBound: false, facilityMode: "single" });
  });
});
