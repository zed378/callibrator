/**
 * A-288 / Q-38 (ADR-100) — services/signInPolicy.service.ts itself: the
 * address matcher, the policy decision, the audit of a refusal, the operator's
 * lock-out-safe path, and the self-lockout guard on a policy change. Over the
 * REAL models and audit service (fixtures/memoryDb).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Policy from "../../services/signInPolicy.service";
import type * as PlatformTenant from "../../constants/platformTenant";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof ModelsBarrel>("../../models");
const policy = jest.requireActual<typeof Policy>("../../services/signInPolicy.service");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenant>(
  "../../constants/platformTenant",
);

const TENANT = "a2880000-0000-4000-8000-0000000000b1";
const USER = "a2880000-0000-4000-8000-0000000000c1";
const TECH_ROLE = "a2880000-0000-4000-8000-0000000000d1";
const OP_ROLE = "a2880000-0000-4000-8000-0000000000d2";
const JAKARTA = { latitude: -6.2, longitude: 106.8 };

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", { id: TENANT, name: "T", code: "T1", status: "active" });
  mdb.seed("Role", [
    { id: TECH_ROLE, name: "TECHNICIAN", roleLevel: 3 },
    { id: OP_ROLE, name: "SUPERADMIN", roleLevel: 10 },
  ]);
});

const allow = (cidrs: unknown): void => {
  mdb.seed("TenantSettings", { tenantId: TENANT, key: "ip_allowlist", value: JSON.stringify(cidrs) });
};

describe("addressAllowed", () => {
  it.each([
    ["10.1.2.3", ["10.1.0.0/16"], true],
    ["10.2.0.1", ["10.1.0.0/16"], false],
    ["::ffff:10.1.2.3", ["10.1.0.0/16"], true],
    ["10.1.2.3", ["10.1.2.3"], true],
    ["2001:db8::1", ["2001:db8::/32"], true],
    ["2001:db9::1", ["2001:db8::/32"], false],
    ["2001:db8::1", ["2001:db8::1"], true],
    ["not-an-ip", ["0.0.0.0/0"], false],
    ["10.1.2.3", ["garbage", "10.0.0.0/99", "10.0.0.0/x", "10.0.0.0/8"], true],
    ["10.1.2.3", ["garbage"], false],
  ])("%s in %j → %s", (ip, cidrs, expected) => {
    expect(policy.addressAllowed(ip, cidrs)).toBe(expected);
  });
});

describe("loadNetworkPolicy", () => {
  it("reads the allowlist and geofence of the named tenant only", async () => {
    allow(["10.0.0.0/8", 7]);
    mdb.seed("TenantSettings", { tenantId: TENANT, key: "geofence", value: JSON.stringify({ ...JAKARTA, radiusKm: 5 }) });
    mdb.seed("TenantSettings", { tenantId: "a2880000-0000-4000-8000-0000000000b2", key: "ip_allowlist", value: '["1.1.1.1"]' });
    await expect(policy.loadNetworkPolicy(TENANT)).resolves.toEqual({
      allowlist: ["10.0.0.0/8"],
      geofence: { ...JAKARTA, radiusKm: 5 },
    });
  });

  it("a malformed value restricts nothing (not JSON, not a list, not a fence)", async () => {
    mdb.seed("TenantSettings", [
      { tenantId: TENANT, key: "ip_allowlist", value: "{not json" },
      { tenantId: TENANT, key: "geofence", value: '{"latitude":"x"}' },
    ]);
    await expect(policy.loadNetworkPolicy(TENANT)).resolves.toEqual({ allowlist: [], geofence: null });
    mdb.reset();
    mdb.seed("TenantSettings", { tenantId: TENANT, key: "ip_allowlist", value: '{"a":1}' });
    await expect(policy.loadNetworkPolicy(TENANT)).resolves.toEqual({ allowlist: [], geofence: null });
  });
});

describe("policyRefusal", () => {
  const fence = { ...JAKARTA, radiusKm: 50 };
  it("allowlist first, then the geofence for the methods that can attest a location", () => {
    expect(policy.policyRefusal({ allowlist: ["10.0.0.0/8"], geofence: null }, { method: "sso" })).toBe("ip_allowlist");
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "passkey" })).toBe("location_required");
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "passkey", location: { latitude: 99, longitude: 0 } })).toBe(
      "location_required",
    );
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "password", location: { latitude: 1.35, longitude: 103.8 } })).toBe(
      "geofence",
    );
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "password", location: JAKARTA })).toBeNull();
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "sso" })).toBeNull();
    expect(policy.policyRefusal({ allowlist: [], geofence: fence }, { method: "refresh" })).toBeNull();
  });
});

describe("assertSignInPermitted", () => {
  it("is a no-op for an account with no tenant", async () => {
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: null }, { method: "password" })).resolves.toBeUndefined();
    expect(mdb.writes()).toHaveLength(0);
  });

  it("resolves with nothing written when the tenant restricts nothing", async () => {
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: TENANT }, { method: "password", ip: "1.2.3.4" })).resolves.toBeUndefined();
    expect(mdb.writes()).toHaveLength(0);
  });

  it("a refusal is audited in the tenant, then thrown as 403 NETWORK_POLICY with the fixed message", async () => {
    allow(["10.0.0.0/8"]);
    const error = await policy
      .assertSignInPermitted({ id: USER, tenantId: TENANT, role: { name: "TECHNICIAN", roleLevel: 3 } }, { method: "sso", ip: "1.2.3.4", userAgent: "ua" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(policy.SignInRefusedError);
    expect(error).toMatchObject({ status: 403, publicCode: "NETWORK_POLICY", message: policy.SIGN_IN_NOT_PERMITTED });
    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        userId: USER,
        action: "LOGIN",
        resourceType: "SignInPolicy",
        ipAddress: "1.2.3.4",
        userAgent: "ua",
        changes: { outcome: "refused", reason: "ip_allowlist", method: "sso" },
      }),
    ]);
  });

  it("a missing location is 403 LOCATION_REQUIRED", async () => {
    mdb.seed("TenantSettings", { tenantId: TENANT, key: "geofence", value: JSON.stringify({ ...JAKARTA, radiusKm: 5 }) });
    await expect(
      policy.assertSignInPermitted({ id: USER, tenantId: TENANT, role: null }, { method: "password" }),
    ).rejects.toMatchObject({ status: 403, publicCode: "LOCATION_REQUIRED", message: policy.LOCATION_REQUIRED_MESSAGE });
    expect(mdb.rows("AuditLog")[0]).toMatchObject({ ipAddress: null, userAgent: null });
  });

  it("finds the role by roleId, and by the account, when the caller loaded neither", async () => {
    allow(["10.0.0.0/8"]);
    mdb.seed("User", [
      { id: USER, email: "u@t.test", username: "u", password: "x", roleId: OP_ROLE, tenantId: TENANT, status: "ACTIVE", isActive: true },
    ]);
    // By roleId: an operator → exempt, recorded under PLATFORM.
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: TENANT, roleId: OP_ROLE }, { method: "refresh", ip: "1.1.1.1" })).resolves.toBeUndefined();
    // By the account (SSO passes only the id).
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: TENANT }, { method: "sso", ip: "1.1.1.1" })).resolves.toBeUndefined();
    expect(mdb.rows("AuditLog").map((r) => [r["tenantId"], (r["changes"] as { outcome: string }).outcome])).toEqual([
      [PLATFORM_TENANT_ID, "operator-exempt"],
      [PLATFORM_TENANT_ID, "operator-exempt"],
    ]);
  });

  it("a roleId of null, a missing role row and a missing account are not operators", async () => {
    allow(["10.0.0.0/8"]);
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: TENANT, roleId: null }, { method: "refresh", ip: "1.1.1.1" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      policy.assertSignInPermitted({ id: USER, tenantId: TENANT, roleId: "a2880000-0000-4000-8000-0000000000ff" }, { method: "refresh", ip: "1.1.1.1" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(policy.assertSignInPermitted({ id: USER, tenantId: TENANT }, { method: "sso", ip: "1.1.1.1" })).rejects.toMatchObject({
      status: 403,
    });
    expect(mdb.rows("AuditLog").every((r) => (r["changes"] as { outcome: string }).outcome === "refused")).toBe(true);
  });

  it("a role loaded without a name counts by its level; a stored null value restricts nothing", async () => {
    mdb.seed("TenantSettings", { tenantId: TENANT, key: "geofence", value: null });
    allow(["10.0.0.0/8"]);
    await expect(
      policy.assertSignInPermitted({ id: USER, tenantId: TENANT, role: { roleLevel: 10 } }, { method: "password", ip: "1.1.1.1" }),
    ).resolves.toBeUndefined();
    expect(mdb.rows("AuditLog")[0]).toMatchObject({ tenantId: PLATFORM_TENANT_ID, resourceId: TENANT });
  });

  it("a role loaded without a level still counts by name", async () => {
    allow(["10.0.0.0/8"]);
    await expect(
      policy.assertSignInPermitted({ id: USER, tenantId: TENANT, role: { name: "SUPERADMIN" } }, { method: "password", ip: "1.1.1.1" }),
    ).resolves.toBeUndefined();
  });
});

/** A thunk for `expect(...).toThrow` over the guard. */
const guard =
  (...args: Parameters<typeof policy.assertChangeKeepsCaller>) =>
    (): void => {
      policy.assertChangeKeepsCaller(...args);
    };

describe("Q-38 — assertChangeKeepsCaller (the self-lockout guard)", () => {
  const admin = { name: "HEALTHCARE ADMIN", roleLevel: 5 };

  it("refuses an allowlist without the caller's address: 409 SELF_LOCKOUT naming the address", () => {
    let caught: unknown;
    try {
      policy.assertChangeKeepsCaller({ allowlist: ["10.0.0.0/8"] }, { ip: "::ffff:192.0.2.7", role: admin });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(policy.SelfLockoutError);
    expect(caught).toMatchObject({ status: 409, publicCode: "SELF_LOCKOUT" });
    expect((caught as Error).message).toContain("192.0.2.7");
  });

  it("an unknown caller address is named as unknown", () => {
    expect(guard({ allowlist: ["10.0.0.0/8"] }, { role: admin })).toThrow(/\(unknown\)/);
  });

  it("accepts an allowlist containing the caller, and an empty one", () => {
    expect(guard({ allowlist: ["192.0.2.0/24"] }, { ip: "192.0.2.7", role: admin })).not.toThrow();
    expect(guard({ allowlist: [] }, { ip: "192.0.2.7", role: admin })).not.toThrow();
  });

  it("a geofence needs the caller's current location, inside it", () => {
    const geofence = { ...JAKARTA, radiusKm: 50 };
    expect(guard({ geofence }, { role: admin })).toThrow(/currentLocation/);
    expect(guard({ geofence }, { role: admin, currentLocation: { latitude: 1.35, longitude: 103.8 } })).toThrow(
      /outside its 50 km radius/,
    );
    expect(guard({ geofence }, { role: admin, currentLocation: JAKARTA })).not.toThrow();
  });

  it("does not bind a platform operator (the override)", () => {
    expect(
      guard({ allowlist: ["10.0.0.0/8"], geofence: { ...JAKARTA, radiusKm: 1 } }, { ip: "1.1.1.1", role: { name: "SUPERADMIN" } }),
    ).not.toThrow();
    expect(guard({ allowlist: ["10.0.0.0/8"] }, { ip: "1.1.1.1" })).toThrow(policy.SelfLockoutError);
  });
});
