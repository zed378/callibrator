/**
 * A-369 (ADR-075 Amendment 1) — only a platform (super admin) account may have no tenant.
 *
 * The bug: `POST /users/create` by a super admin who named no `tenantId` created the account
 * with `tenant_id` NULL whatever its role (`effectiveTenantId = actorIsSuperAdmin ? tenantId
 * : actorTenantId`). The account could sign in — its LOGIN row skipped with "LOGIN not
 * audited: the user has no tenant" — and every later request answered 401 "Invalid session":
 * the tenant hooks deny a tenant-less non-super-admin principal every row, its own user row
 * included, so auth.service#verifyUserSession found nobody.
 *
 * Fail-before (user.service.ts and auth.service.ts at HEAD f2a2d70): 5 of 14 fail — both
 * creation refusals (the TECHNICIAN row was created), the role-change refusal (the role
 * changed), and both sign-in refusals (a session was issued; the one-time password was spent).
 *
 * Real: user.service (userCreate, userRoleUpdate), auth.service (loginUser, verifyUserSession),
 * the User model and its hooks, the tenant hooks, the audit service (fixtures/memoryDb).
 * Doubled: the database and bcrypt's cost.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Bcrypt from "bcryptjs";
import type * as Constants from "../../constants";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as TenantRequired from "../../utils/tenantRequired.util";
import type * as Coded from "../../utils/codedError.util";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof Bcrypt>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});
// A-288 (ADR-100): the network policy has its own suites; here it permits.
jest.mock("../../services/signInPolicy.service", () => ({ assertSignInPermitted: jest.fn(() => Promise.resolve(undefined)) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const bcrypt = jest.requireActual<typeof Bcrypt>("bcryptjs");
const { ROLE_IDS, DEFAULT_TENANT } = jest.requireActual<typeof Constants>("../../constants");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const rule = jest.requireActual<typeof TenantRequired>("../../utils/tenantRequired.util");
const { CodedError } = jest.requireActual<typeof Coded>("../../utils/codedError.util");
const userService = jest.requireActual<{
  userCreate: (input: Record<string, unknown>) => Promise<{ status: number; data: Record<string, unknown> }>;
  userRoleUpdate: (input: Record<string, unknown>) => Promise<{ status: number }>;
    }>("../../services/user.service");
const authService = jest.requireActual<{
  loginUser: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  verifyUserSession: (userId: string) => Promise<{ status: number }>;
    }>("../../services/auth.service");

const OPERATOR_ID = "a0000000-0000-4000-8000-0000000000ad";
const PLATFORM_OPERATOR_ID = "a0000000-0000-4000-8000-0000000000ae";
const ORPHAN_ID = "b0000000-0000-4000-8000-0000000000b9";
const ORPHAN_ONE_TIME_ID = "b0000000-0000-4000-8000-0000000000ba";
const TECH_ROLE_ID = "7f1a2b3c-0000-4000-8000-00000000abcd";
const SUPER_ADMIN_ACTOR = {
  actorIsSuperAdmin: true,
  actorTenantId: DEFAULT_TENANT.id,
  actorRoleLevel: 100,
  ipAddress: "203.0.113.9",
  userAgent: "jest",
};

const newAccount = (roleId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...SUPER_ADMIN_ACTOR,
  createdBy: OPERATOR_ID,
  username: "nobody",
  firstName: "No",
  lastName: "Body",
  email: "nobody@hospital.id",
  password: "Admin-Chosen-Pass-1",
  roleId,
  ...extra,
});

const userRow = (id: string): MemoryDbModule.Row | undefined => mdb.rows("User").find((r) => r["id"] === id);

const signIn = (user: string, password: string): Promise<Record<string, unknown>> =>
  authService.loginUser({ user, password, ip: "203.0.113.7" });

beforeEach(async () => {
  mdb.reset();
  mdb.seed("Tenant", { id: DEFAULT_TENANT.id, name: "Default", code: "DEFAULT", status: "active" });
  mdb.seed("Role", [
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 100, status: "active" },
    { id: TECH_ROLE_ID, name: "TECHNICIAN", roleLevel: 10, status: "active" },
  ]);
  const base = { status: "ACTIVE", isActive: true, isDeleted: false, passwordOneTime: false, mustChangePassword: false };
  mdb.seed("User", [
    {
      ...base,
      id: OPERATOR_ID,
      email: "op@hospital.id",
      username: "op",
      password: await bcrypt.hash("Operator-Pass-1", 4),
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: DEFAULT_TENANT.id,
    },
    {
      ...base,
      id: PLATFORM_OPERATOR_ID,
      email: "platform@hospital.id",
      username: "platform",
      password: await bcrypt.hash("Platform-Pass-1", 4),
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: null,
    },
    // What the bug left behind: a tenant-less TECHNICIAN with a password of its own…
    {
      ...base,
      id: ORPHAN_ID,
      email: "orphan@hospital.id",
      username: "orphan",
      password: await bcrypt.hash("Orphan-Pass-1", 4),
      roleId: TECH_ROLE_ID,
      tenantId: null,
    },
    // …and one still holding the administrator's one-time password.
    {
      ...base,
      id: ORPHAN_ONE_TIME_ID,
      email: "orphan2@hospital.id",
      username: "orphan2",
      password: await bcrypt.hash("Admin-Chosen-Pass-2", 4),
      roleId: TECH_ROLE_ID,
      tenantId: null,
      passwordOneTime: true,
      mustChangePassword: true,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("why: a tenant-less non-platform principal cannot read its own user row", () => {
  it("verifyUserSession answers 401 'Invalid session' in that principal's own context", async () => {
    const own = { tenantId: null, isSuperAdmin: false, isSystemTask: false, userId: ORPHAN_ID };
    await expect(tenantStorage.run(own, () => authService.verifyUserSession(ORPHAN_ID))).rejects.toMatchObject({
      status: 401,
      message: "Invalid session",
    });
    // The same row, read by a principal in a tenant or by the operator, exists.
    const operator = { tenantId: null, isSuperAdmin: true, isSystemTask: false };
    await expect(tenantStorage.run(operator, () => authService.verifyUserSession(ORPHAN_ID))).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe("creation: a super admin who names no tenant may create only another super admin", () => {
  it("refuses a tenant-less TECHNICIAN with 400 TENANT_REQUIRED and writes nothing", async () => {
    const before = mdb.rows("AuditLog").length;
    const caught: unknown = await userService.userCreate(newAccount(TECH_ROLE_ID)).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(CodedError);
    expect(caught).toMatchObject({ status: 400, publicCode: "TENANT_REQUIRED", message: rule.TENANT_REQUIRED_MESSAGE });
    expect(mdb.rows("User").find((r) => r["email"] === "nobody@hospital.id")).toBeUndefined();
    expect(mdb.rows("AuditLog")).toHaveLength(before);
  });

  it("a blank tenantId is no tenant either", async () => {
    await expect(userService.userCreate(newAccount(TECH_ROLE_ID, { tenantId: null }))).rejects.toMatchObject({
      publicCode: "TENANT_REQUIRED",
    });
  });

  it("the same account with a tenant is created there", async () => {
    const created = await userService.userCreate(newAccount(TECH_ROLE_ID, { tenantId: DEFAULT_TENANT.id }));
    expect(created.status).toBe(201);
    expect(userRow(String(created.data["id"]))).toMatchObject({ tenantId: DEFAULT_TENANT.id });
  });

  it("a tenant-less SUPER ADMIN is still allowed (the tenant hooks skip scoping for it)", async () => {
    const created = await userService.userCreate(newAccount(ROLE_IDS.SUPER_ADMIN));
    expect(created.status).toBe(201);
    expect(userRow(String(created.data["id"]))?.["tenantId"] ?? null).toBeNull();
  });
});

describe("role change: a tenant-less super admin cannot be given a tenant role", () => {
  it("refuses with 400 TENANT_REQUIRED and leaves the role as it was", async () => {
    const caught: unknown = await userService
      .userRoleUpdate({ ...SUPER_ADMIN_ACTOR, userId: PLATFORM_OPERATOR_ID, roleId: TECH_ROLE_ID, updatedBy: OPERATOR_ID })
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(CodedError);
    expect(caught).toMatchObject({ status: 400, publicCode: "TENANT_REQUIRED" });
    expect(userRow(PLATFORM_OPERATOR_ID)).toMatchObject({ roleId: ROLE_IDS.SUPER_ADMIN });
  });

  it("an account in a tenant may take a tenant role", async () => {
    const result = await userService.userRoleUpdate({
      ...SUPER_ADMIN_ACTOR,
      userId: OPERATOR_ID,
      roleId: TECH_ROLE_ID,
      updatedBy: PLATFORM_OPERATOR_ID,
    });
    expect(result.status).toBe(200);
  });
});

describe("sign-in: an existing tenant-less non-platform account is refused, not half-signed-in", () => {
  it("refuses with 403 ACCOUNT_HAS_NO_TENANT after the password, with no session and no LOGIN row", async () => {
    const caught: unknown = await signIn("orphan@hospital.id", "Orphan-Pass-1").catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(CodedError);
    expect(caught).toMatchObject({ status: 403, publicCode: "ACCOUNT_HAS_NO_TENANT" });
    expect(mdb.rows("Session")).toHaveLength(0);
    expect(mdb.rows("AuditLog").filter((r) => r["action"] === "LOGIN")).toHaveLength(0);
  });

  it("a wrong password is still the plain 401: the refusal says nothing before the credential", async () => {
    await expect(signIn("orphan@hospital.id", "Wrong-Pass-1")).rejects.toMatchObject({
      status: 401,
      message: "Invalid credentials",
    });
  });

  it("does not spend a one-time password it refuses", async () => {
    await expect(signIn("orphan2@hospital.id", "Admin-Chosen-Pass-2")).rejects.toMatchObject({
      publicCode: "ACCOUNT_HAS_NO_TENANT",
    });
    expect(userRow(ORPHAN_ONE_TIME_ID)).toMatchObject({ passwordOneTime: true });
  });

  it("a tenant-less super admin still signs in", async () => {
    const result = await signIn("platform@hospital.id", "Platform-Pass-1");
    expect(result["token"]).toBeTruthy();
    expect(mdb.rows("Session")).toHaveLength(1);
  });
});

describe("the rule itself (utils/tenantRequired.util)", () => {
  it("a platform role is the super admin's, by id or by name", () => {
    expect(rule.isPlatformRole({ id: ROLE_IDS.SUPER_ADMIN, name: "renamed" })).toBe(true);
    expect(rule.isPlatformRole({ id: "x", name: "SUPERADMIN" })).toBe(true);
    expect(rule.isPlatformRole({ id: TECH_ROLE_ID, name: "TECHNICIAN" })).toBe(false);
    expect(rule.isPlatformRole(null)).toBe(false);
    expect(rule.isPlatformRole(undefined)).toBe(false);
  });

  it("assertTenantForRole passes a tenant or a platform role and refuses the rest", () => {
    const tenant = DEFAULT_TENANT.id as TenantId;
    expect(() => {
      rule.assertTenantForRole(tenant, { id: TECH_ROLE_ID, name: "TECHNICIAN" });
    }).not.toThrow();
    expect(() => {
      rule.assertTenantForRole(null, { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN" });
    }).not.toThrow();
    expect(() => {
      rule.assertTenantForRole(undefined, { id: TECH_ROLE_ID, name: "TECHNICIAN" });
    }).toThrow(rule.TENANT_REQUIRED_MESSAGE);
  });

  it("tenantlessSignInRefusal: null for a tenant or a platform role; a role-less tenant-less account is refused", () => {
    expect(rule.tenantlessSignInRefusal({ tenantId: DEFAULT_TENANT.id, role: null })).toBeNull();
    expect(rule.tenantlessSignInRefusal({ tenantId: null, role: { name: "SUPERADMIN" } })).toBeNull();
    expect(rule.tenantlessSignInRefusal({ tenantId: null, role: null })).toMatchObject({
      status: 403,
      publicCode: rule.ACCOUNT_HAS_NO_TENANT_CODE,
      message: rule.ACCOUNT_HAS_NO_TENANT_MESSAGE,
    });
  });
});
