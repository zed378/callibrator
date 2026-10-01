/**
 * A-288 (ADR-100) — the tenant's IP allowlist and geofence at the sign-in
 * points of auth.service: password, MFA and token refresh, end to end over the
 * REAL models, tenant hooks, audit service, session service and auth.service
 * (fixtures/memoryDb). The SSO and passkey points are signInPolicy.sso and
 * .passkey (controller suites).
 *
 * Before A-288 every refusal here was a successful sign-in: nothing read the
 * allowlist outside POST /network-security/evaluate-login.
 *
 * TypeScript without jest's hoisting: mocks first, then `jest.requireActual`.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Bcrypt from "bcryptjs";
import type * as RateLimiter from "../../services/rateLimiter.redis.service";
import type * as Constants from "../../constants";
import type * as PlatformTenant from "../../constants/platformTenant";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof Bcrypt>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof ModelsBarrel>("../../models");
// auth.service is JavaScript until P9-12 converts it; loaded for its real sign-in points.
const authService: {
  loginUser: (input: Record<string, unknown>) => Promise<{ status: number; token: string; refreshToken: string | null }>;
  loginMfa: (
    userId: string,
    code: string,
    ip: string,
    ua: string,
    options?: { recoveryCode?: string; location?: unknown },
  ) => Promise<unknown>;
  refreshUserToken: (refreshToken: string, sessionId: string | null, ip: string | null, ua: string | null) => Promise<unknown>;
} = jest.requireActual("../../services/auth.service");
const rateLimiter = jest.requireActual<typeof RateLimiter>(
  "../../services/rateLimiter.redis.service",
);
const bcrypt = jest.requireActual<typeof Bcrypt>("bcryptjs");
const { ROLE_IDS } = jest.requireActual<typeof Constants>("../../constants");
const { PLATFORM_TENANT_ID } = jest.requireActual<typeof PlatformTenant>(
  "../../constants/platformTenant",
);

const TENANT = "a2880000-0000-4000-8000-000000000001";
const TECH_ROLE = "a2880000-0000-4000-8000-0000000000aa";
const USER_ID = "a2880000-0000-4000-8000-000000000011";
const OPERATOR_ID = "a2880000-0000-4000-8000-000000000022";
const PASSWORD = "Correct-Horse-9";
const INSIDE = "10.20.30.40";
const OUTSIDE = "203.0.113.9";
/** Jakarta, and a point about 1,000 km away. */
const JAKARTA = { latitude: -6.2, longitude: 106.8 };
const FAR_AWAY = { latitude: 1.35, longitude: 103.8 };

/** The seeded technician's stored row (live: a test may change it). */
let techRow: MemoryDbModule.Row = {};

const seed = async (): Promise<void> => {
  mdb.seed("Tenant", { id: TENANT, name: "Hospital A", code: "HOSPA", status: "active" });
  mdb.seed("Role", [
    { id: TECH_ROLE, name: "TECHNICIAN", roleLevel: 3 },
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 10 },
  ]);
  const password = await bcrypt.hash(PASSWORD, 4);
  const common = { password, status: "ACTIVE", isActive: true, isDeleted: false, mustChangePassword: false, passwordOneTime: false, tenantId: TENANT };
  [techRow = {}] = mdb.seed("User", [
    { id: USER_ID, email: "tech@a.test", username: "tech", firstName: "T", lastName: "A", roleId: TECH_ROLE, ...common },
    { id: OPERATOR_ID, email: "op@a.test", username: "op", firstName: "O", lastName: "P", roleId: ROLE_IDS.SUPER_ADMIN, ...common },
  ]);
};

const setAllowlist = (cidrs: string[]): void => {
  mdb.seed("TenantSettings", { tenantId: TENANT, key: "ip_allowlist", value: JSON.stringify(cidrs) });
};
const setGeofence = (): void => {
  mdb.seed("TenantSettings", { tenantId: TENANT, key: "geofence", value: JSON.stringify({ ...JAKARTA, radiusKm: 50 }) });
};

const policyRows = (): MemoryDbModule.Row[] => mdb.rows("AuditLog").filter((r) => r["resourceType"] === "SignInPolicy");
const loginRows = (): MemoryDbModule.Row[] => mdb.rows("AuditLog").filter((r) => r["resourceType"] === "Session");

const login = (ip: string, extra: Record<string, unknown> = {}): ReturnType<typeof authService.loginUser> =>
  authService.loginUser({ user: "tech", password: PASSWORD, ip, userAgent: "jest", ...extra });

beforeEach(async () => {
  mdb.reset();
  rateLimiter.clearMemoryStore();
  await seed();
});

describe("A-288 — password sign-in", () => {
  it("refuses an address outside the allowlist: 403 NETWORK_POLICY, no session, one audit row", async () => {
    setAllowlist(["10.20.30.0/24"]);
    await expect(login(OUTSIDE)).rejects.toMatchObject({ status: 403, publicCode: "NETWORK_POLICY" });
    expect(mdb.rows("Session")).toHaveLength(0);
    expect(loginRows()).toHaveLength(0);
    const rows = policyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: TENANT, userId: USER_ID, action: "LOGIN", ipAddress: OUTSIDE });
    expect(rows[0]?.["changes"]).toMatchObject({ outcome: "refused", reason: "ip_allowlist", method: "password" });
  });

  it("the refusal names no rule and no range", async () => {
    setAllowlist(["10.20.30.0/24"]);
    const error = (await login(OUTSIDE).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(/10\.20|allowlist|geofence|km/i);
  });

  it("a wrong password from outside is still the plain 401 (nothing about the policy)", async () => {
    setAllowlist(["10.20.30.0/24"]);
    await expect(authService.loginUser({ user: "tech", password: "wrong", ip: OUTSIDE })).rejects.toMatchObject({ status: 401 });
    expect(policyRows()).toHaveLength(0);
  });

  it("permits an address inside the allowlist (IPv4-mapped IPv6 too)", async () => {
    setAllowlist(["10.20.30.0/24"]);
    await expect(login(`::ffff:${INSIDE}`)).resolves.toMatchObject({ status: 200 });
    expect(mdb.rows("Session")).toHaveLength(1);
    expect(policyRows()).toHaveLength(0);
  });

  it("a geofence without a location is 403 LOCATION_REQUIRED; outside it is NETWORK_POLICY; inside it signs in", async () => {
    setGeofence();
    await expect(login(OUTSIDE)).rejects.toMatchObject({ status: 403, publicCode: "LOCATION_REQUIRED" });
    await expect(login(OUTSIDE, { location: FAR_AWAY })).rejects.toMatchObject({ status: 403, publicCode: "NETWORK_POLICY" });
    await expect(login(OUTSIDE, { location: JAKARTA })).resolves.toMatchObject({ status: 200 });
    expect(policyRows().map((r) => (r["changes"] as { reason: string }).reason)).toEqual(["location_required", "geofence"]);
  });

  it("the lock-out-safe path: a platform operator is not refused by its home tenant's policy, and it is recorded under PLATFORM", async () => {
    setAllowlist(["10.20.30.0/24"]);
    await expect(authService.loginUser({ user: "op", password: PASSWORD, ip: OUTSIDE })).resolves.toBeDefined();
    const rows = policyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: PLATFORM_TENANT_ID, userId: OPERATOR_ID });
    expect(rows[0]?.["changes"]).toMatchObject({ outcome: "operator-exempt", reason: "ip_allowlist" });
  });
});

describe("A-288 — MFA step", () => {
  it("refuses at the second factor when the address left the allowlist after the password step", async () => {
    techRow["mfaEnabled"] = true;
    techRow["mfaSecret"] = "JBSWY3DPEHPK3PXP";
    const first = await login(INSIDE);
    expect(first.status).toBe(202);
    setAllowlist(["10.20.30.0/24"]);
    await expect(authService.loginMfa(USER_ID, "123456", OUTSIDE, "jest")).rejects.toMatchObject({
      status: 403,
      publicCode: "NETWORK_POLICY",
    });
    expect(mdb.rows("Session")).toHaveLength(0);
    expect(policyRows()[0]?.["changes"]).toMatchObject({ method: "password+totp" });
  });
});

describe("A-288 — token refresh", () => {
  it("refuses a refresh from outside the allowlist and revokes the session", async () => {
    const signedIn = await login(INSIDE);
    expect(signedIn.refreshToken).toBeTruthy();
    setAllowlist(["10.20.30.0/24"]);
    await expect(authService.refreshUserToken(String(signedIn.refreshToken), null, OUTSIDE, "jest")).rejects.toMatchObject({
      status: 403,
      publicCode: "NETWORK_POLICY",
    });
    const sessions = mdb.rows("Session");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ is_revoked: true, revoked_reason: "NETWORK_POLICY" });
    expect(policyRows()[0]?.["changes"]).toMatchObject({ method: "refresh" });
  });

  it("a refresh from inside rotates as before", async () => {
    setAllowlist(["10.20.30.0/24"]);
    const signedIn = await login(INSIDE);
    await expect(authService.refreshUserToken(String(signedIn.refreshToken), null, INSIDE, "jest")).resolves.toBeDefined();
    expect(mdb.rows("Session")).toHaveLength(2);
  });

  it("the geofence is not asked at a refresh (no user is present to attest a location)", async () => {
    const signedIn = await login(INSIDE);
    setGeofence();
    await expect(authService.refreshUserToken(String(signedIn.refreshToken), null, OUTSIDE, "jest")).resolves.toBeDefined();
  });
});
