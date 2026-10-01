/**
 * P10-16 (ADR-099 Amendment 1, Q-49) — every password an ADMINISTRATOR sets
 * for another user is one-time, like the bootstrap super admin's.
 *
 * Before (A-123/A-215): the administrator's password opened a normal session,
 * gated route by route to change-password, and kept signing in until changed
 * (fail-before: the first sign-in below answered "Login successful" with a
 * session and a refresh token; the second sign-in succeeded again).
 * After: the first sign-in yields a password-change token and NO session; the
 * second is the wrong-password 401; the change completes as for the bootstrap.
 *
 * Real: user.service (userCreate, resetUserPassword), auth.service#loginUser,
 * bootstrapCredential.service, the User model and its hooks, the audit
 * service (fixtures/memoryDb). Doubled: the database and bcrypt's cost.
 *
 * The reset's temporary password is shown ONCE, in the administrator's
 * response, by design (it is handed over). It must appear nowhere else: no
 * log line, no stdout/stderr write, no table, no audit row.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Service from "../../services/bootstrapCredential.service";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import type * as Bcrypt from "bcryptjs";
import type * as Constants from "../../constants";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof Bcrypt>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof ModelsBarrel>("../../models");
const svc = jest.requireActual<typeof Service>("../../services/bootstrapCredential.service");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");
const bcrypt = jest.requireActual<typeof Bcrypt>("bcryptjs");
const { ROLE_IDS, DEFAULT_TENANT } = jest.requireActual<typeof Constants>("../../constants");
// Both still typed here by what the test reads (user.service is .ts, but its export is a large object).
const userService = jest.requireActual<{
  userCreate: (input: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
  resetUserPassword: (input: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }>;
    }>("../../services/user.service");
const authService = jest.requireActual<{
  loginUser: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }>("../../services/auth.service");

const { Users } = models;

const ADMIN_ID = "a0000000-0000-4000-8000-0000000000ad";
const TECH_ROLE_ID = "7f1a2b3c-0000-4000-8000-00000000abcd";
const TECH_ID = "b0000000-0000-4000-8000-0000000000b1";
const ACTOR = {
  actorIsSuperAdmin: true,
  actorTenantId: DEFAULT_TENANT.id,
  actorRoleLevel: 100,
  ipAddress: "203.0.113.9",
  userAgent: "jest",
};

let said: string[] = [];
const safe = (v: unknown): string => {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
};
const captureOutput = (): void => {
  said = [];
  const target = logger as unknown as Record<string, unknown>;
  for (const level of ["error", "warn", "info", "http", "verbose", "debug", "silly", "log"]) {
    if (typeof target[level] === "function") {
      jest.spyOn(target as Record<string, (...a: unknown[]) => unknown>, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map(safe).join(" "));
        return logger;
      });
    }
  }
  jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
  jest.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
};
const expectOnlyInResponse = (plain: string): void => {
  for (const line of said) {
    expect(line).not.toContain(plain);
  }
  expect(JSON.stringify(mdb.dump())).not.toContain(plain);
};

const row = (id: string): MemoryDbModule.Row => {
  const found = mdb.rows("User").find((r) => r["id"] === id);
  if (!found) {
    throw new Error(`no user ${id}`);
  }
  return found;
};

beforeEach(async () => {
  mdb.reset();
  mdb.seed("Tenant", { id: DEFAULT_TENANT.id, name: "Default", code: "DEFAULT", status: "active" });
  mdb.seed("Role", [
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 100, status: "active" },
    { id: TECH_ROLE_ID, name: "TECHNICIAN", roleLevel: 10, status: "active" },
  ]);
  mdb.seed("User", [
    {
      id: ADMIN_ID,
      email: "op@hospital.id",
      username: "op",
      password: await bcrypt.hash("Operator-Pass-1", 4),
      firstName: "Op",
      lastName: "Erator",
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: DEFAULT_TENANT.id,
      status: "ACTIVE",
      isActive: true,
      isDeleted: false,
    },
    {
      id: TECH_ID,
      email: "tech@hospital.id",
      username: "tech",
      password: await bcrypt.hash("Own-Chosen-Pass-1", 4),
      firstName: "Tech",
      lastName: "Nician",
      roleId: TECH_ROLE_ID,
      tenantId: DEFAULT_TENANT.id,
      status: "ACTIVE",
      isActive: true,
      isDeleted: false,
      passwordOneTime: false,
      mustChangePassword: false,
    },
  ]);
  captureOutput();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const signIn = (user: string, password: string) => authService.loginUser({ user, password, ip: "203.0.113.7" });

describe("an administrator's password RESET is one-time", () => {
  it("the first sign-in gives a password-change token and no session; the second is the wrong-password 401", async () => {
    const reset = await userService.resetUserPassword({ ...ACTOR, userId: TECH_ID, resetBy: ADMIN_ID });
    const temporary = String(reset.data["temporaryPassword"]);
    expect(temporary.length).toBeGreaterThanOrEqual(16);
    expect(row(TECH_ID)).toMatchObject({ passwordOneTime: true, mustChangePassword: true });

    const first = await signIn("tech@hospital.id", temporary);
    expect(first).toMatchObject({ data: { passwordChangeRequired: true }, refreshToken: null });
    expect(first["session"]).toBeUndefined();
    expect(mdb.rows("Session")).toHaveLength(0);
    expect(row(TECH_ID)["passwordOneTime"]).toBe(false);

    await expect(signIn("tech@hospital.id", temporary)).rejects.toMatchObject({
      status: 401,
      message: "Invalid credentials",
    });

    const changed = await svc.completeFirstSignInPasswordChange({
      token: String(first["token"]),
      newPassword: "Tech-Chosen-Pass-2",
    });
    expect(changed.data.signInRequired).toBe(true);
    const normal = await signIn("tech@hospital.id", "Tech-Chosen-Pass-2");
    expect(normal["token"]).toBeTruthy();
    expect(normal["data"]).toMatchObject({ mustChangePassword: false });

    expectOnlyInResponse(temporary);
  });

  it("a second reset of an account that is ALREADY one-time keeps it one-time (the save option, not the attribute)", async () => {
    await userService.resetUserPassword({ ...ACTOR, userId: TECH_ID, resetBy: ADMIN_ID });
    const second = await userService.resetUserPassword({ ...ACTOR, userId: TECH_ID, resetBy: ADMIN_ID });
    expect(row(TECH_ID)["passwordOneTime"]).toBe(true);
    const first = await signIn("tech@hospital.id", String(second.data["temporaryPassword"]));
    expect(first).toMatchObject({ data: { passwordChangeRequired: true } });
  });
});

describe("an administrator-CREATED account's password is one-time", () => {
  it("the first sign-in gives a password-change token, not a gated session", async () => {
    const created = await userService.userCreate({
      ...ACTOR,
      createdBy: ADMIN_ID,
      tenantId: DEFAULT_TENANT.id,
      username: "newtech",
      firstName: "New",
      lastName: "Tech",
      email: "newtech@hospital.id",
      password: "Admin-Chosen-Pass-1",
      roleId: TECH_ROLE_ID,
    });
    const id = String(created.data["id"]);
    expect(row(id)).toMatchObject({ passwordOneTime: true, mustChangePassword: true });

    const first = await signIn("newtech@hospital.id", "Admin-Chosen-Pass-1");
    expect(first).toMatchObject({ data: { passwordChangeRequired: true }, refreshToken: null });
    expect(mdb.rows("Session")).toHaveLength(0);
    await expect(signIn("newtech@hospital.id", "Admin-Chosen-Pass-1")).rejects.toMatchObject({ status: 401 });
    expectOnlyInResponse("Admin-Chosen-Pass-1");
  });
});

describe("the User model hook — both directions", () => {
  it("a password saved with { oneTimePassword: true } is one-time, even when the flag was already set", async () => {
    const user = await Users.findByPk(TECH_ID);
    if (!user) {
      throw new Error("missing");
    }
    await user.update({ password: await bcrypt.hash("x", 4) }, { oneTimePassword: true });
    expect(row(TECH_ID)["passwordOneTime"]).toBe(true);
    await user.update({ password: await bcrypt.hash("y", 4), passwordOneTime: true }, { oneTimePassword: true });
    expect(row(TECH_ID)["passwordOneTime"]).toBe(true);
  });

  it("the holder's own password change (no option) clears it", async () => {
    const user = await Users.findByPk(TECH_ID);
    if (!user) {
      throw new Error("missing");
    }
    await user.update({ password: await bcrypt.hash("x", 4) }, { oneTimePassword: true });
    await user.update({ password: await bcrypt.hash("Own-Chosen-Pass-3", 4) });
    expect(row(TECH_ID)["passwordOneTime"]).toBe(false);
  });

  it("a save that does not touch the password leaves the flag alone", async () => {
    const user = await Users.findByPk(TECH_ID);
    if (!user) {
      throw new Error("missing");
    }
    await user.update({ password: await bcrypt.hash("x", 4) }, { oneTimePassword: true });
    await user.update({ firstName: "Renamed" });
    expect(row(TECH_ID)["passwordOneTime"]).toBe(true);
  });
});

describe("the demo seeder is development-only", () => {
  it("refuses in production before anything is written, and is allowed elsewhere", () => {
    const migrationService = jest.requireActual<{
      assertDemoSeedingPermitted: () => void;
      seedDemoData: () => Promise<unknown>;
        }>("../../services/migration.service");
    // eslint-disable-next-line no-restricted-properties -- the test switches NODE_ENV to prove the production refusal; config/env.ts reads it per call
    const env = process.env as Record<string, string | undefined>;
    const original = env["NODE_ENV"];
    try {
      env["NODE_ENV"] = "production";
      expect(() => {
        migrationService.assertDemoSeedingPermitted();
      }).toThrow(/refused in production/);
      env["NODE_ENV"] = "development";
      expect(() => {
        migrationService.assertDemoSeedingPermitted();
      }).not.toThrow();
    } finally {
      env["NODE_ENV"] = original;
    }
  });

  it("seedDemoData itself refuses in production with nothing written", async () => {
    const migrationService = jest.requireActual<{ seedDemoData: () => Promise<unknown> }>(
      "../../services/migration.service",
    );
    // eslint-disable-next-line no-restricted-properties -- the test switches NODE_ENV to prove the production refusal; config/env.ts reads it per call
    const env = process.env as Record<string, string | undefined>;
    const original = env["NODE_ENV"];
    const before = mdb.writes().length;
    try {
      env["NODE_ENV"] = "production";
      await expect(migrationService.seedDemoData()).rejects.toMatchObject({ status: 403 });
    } finally {
      env["NODE_ENV"] = original;
    }
    expect(mdb.writes().length).toBe(before);
  });
});
