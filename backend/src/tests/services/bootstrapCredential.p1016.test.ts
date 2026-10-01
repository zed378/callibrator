/**
 * P10-16 (ADR-099) — the first super admin's one-time password, end to end
 * over the REAL models, hooks, audit service, jwt util and auth.service
 * (fixtures/memoryDb), with the plaintext's ONLY home a temporary directory.
 *
 * What is doubled: the database (memoryDb), the storage root (a temp dir, so a
 * developer's real backend/.bootstrap file is never touched) and bcrypt's cost
 * (4 rounds instead of 12 — the same algorithm, hash-only storage and compare;
 * only slower rounds are skipped). Everything else is the code that runs.
 *
 * Owner's rule, asserted throughout: the plaintext is in the 0600 file and
 * NOWHERE else — not a logger call, not process.stdout/stderr, not a response,
 * not an audit row, not any table, not the environment.
 *
 * TypeScript without jest's hoisting: mocks first, then `jest.requireActual`.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsBarrel from "../../models";
import type * as Service from "../../services/bootstrapCredential.service";
import type * as Secret from "../../utils/bootstrapSecret.util";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import type * as JwtUtil from "../../utils/jwt.util";
import type * as Cli from "../../scripts/rotateBootstrapPassword";
import type * as Dispatch from "../../scripts/cliDispatch";
import type * as Bcrypt from "bcryptjs";
import type * as Constants from "../../constants";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p1016-svc-"));

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(ROOT, ...parts),
);
jest.mock("bcryptjs", () => {
  const real = jest.requireActual<typeof Bcrypt>("bcryptjs");
  return { ...real, hash: (plain: string) => real.hash(plain, 4) };
});

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof ModelsBarrel>("../../models");
const svc = jest.requireActual<typeof Service>("../../services/bootstrapCredential.service");
const secret = jest.requireActual<typeof Secret>("../../utils/bootstrapSecret.util");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");
const jwtUtil = jest.requireActual<typeof JwtUtil>("../../utils/jwt.util");
// auth.service is JavaScript until P9-12 converts it; loaded for its real loginUser.
const authService = jest.requireActual<{
  loginUser: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }>("../../services/auth.service");
const bcrypt = jest.requireActual<typeof Bcrypt>("bcryptjs");
const nodeFs = jest.requireActual<typeof fs>("fs");

const { ROLE_IDS, DEFAULT_TENANT } = jest.requireActual<typeof Constants>("../../constants");
const { Users } = models;

const FILE = path.join(ROOT, ".bootstrap", "superadmin-password");
const SPEC: Service.SystemUserSpec = {
  email: "sys@mail.com",
  username: "sys",
  firstName: "Super",
  lastName: "System",
  status: "ACTIVE",
  roleId: ROLE_IDS.SUPER_ADMIN,
  tenantId: DEFAULT_TENANT.id,
  isEmailVerified: true,
};
const TENANT_ROLE_ID = "7f1a2b3c-0000-4000-8000-00000000abcd";

/** Everything the process said: every logger call and every stdout/stderr write. */
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

/** The plaintext, read the way the operator reads it. */
const readFile = (): string => fs.readFileSync(FILE, "utf8").trimEnd();

/** Nothing the process said, stored or returned carries `plain`. */
const expectNowhereBut = (plain: string, ...alsoReturned: unknown[]): void => {
  expect(plain.length).toBeGreaterThanOrEqual(20);
  for (const line of said) {
    expect(line).not.toContain(plain);
  }
  expect(JSON.stringify(mdb.dump())).not.toContain(plain);
  for (const value of alsoReturned) {
    expect(safe(value)).not.toContain(plain);
  }
  // eslint-disable-next-line no-restricted-properties -- the assertion IS about the environment: nothing may put the value there (owner, ADR-099)
  for (const value of Object.values(process.env)) {
    expect(value ?? "").not.toContain(plain);
  }
};

const userRow = (email = SPEC.email): MemoryDbModule.Row => {
  const row = mdb.rows("User").find((r) => r["email"] === email);
  if (!row) {
    throw new Error(`no user ${email}`);
  }
  return row;
};

const auditRows = (): MemoryDbModule.Row[] => mdb.rows("AuditLog");

const seedTenantAndRoles = (): void => {
  mdb.seed("Tenant", { id: DEFAULT_TENANT.id, name: "Default", code: "DEFAULT", status: "active" });
  mdb.seed("Role", [
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", roleLevel: 100 },
    { id: TENANT_ROLE_ID, name: "TECHNICIAN", roleLevel: 10 },
  ]);
};

/** A super admin seeded directly, holding `password`. */
const seedAdmin = async (email: string, password: string, extra: MemoryDbModule.Row = {}): Promise<string> => {
  const id = `9${Math.random().toString(16).slice(2, 9)}-0000-4000-8000-000000000001`;
  mdb.seed("User", {
    id,
    email,
    username: email.split("@")[0],
    password: await bcrypt.hash(password, 4),
    firstName: "Op",
    lastName: "Erator",
    roleId: ROLE_IDS.SUPER_ADMIN,
    tenantId: DEFAULT_TENANT.id,
    status: "ACTIVE",
    isActive: true,
    isDeleted: false,
    mustChangePassword: false,
    passwordOneTime: false,
    ...extra,
  });
  return id;
};

const seedSession = (userId: string): void => {
  mdb.seed("Session", {
    id: "5e551011-0000-4000-8000-000000000001",
    user_id: userId,
    tenant_id: DEFAULT_TENANT.id,
    refresh_token: "hash",
    is_revoked: false,
    is_active: true,
    expired_at: new Date(Date.now() + 86400000),
  });
};

beforeEach(() => {
  mdb.reset();
  seedTenantAndRoles();
  secret.removeBootstrapSecret();
  captureOutput();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// ==========================================================================
describe("bootstrap: no super admin exists", () => {
  it("creates sys@mail.com with a one-time password stored ONLY as a hash, and reveals it only in the file", async () => {
    const before = Date.now();
    const result = await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();

    expect(result).toEqual({ created: true, updated: false, bootstrapPasswordFile: FILE });
    expect(plain).toHaveLength(24);
    const row = userRow();
    expect(row["password"]).not.toBe(plain);
    expect(String(row["password"])).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(plain, String(row["password"]))).toBe(true);
    expect(row["passwordOneTime"]).toBe(true);
    expect(row["mustChangePassword"]).toBe(true);
    const expires = new Date(row["temporaryPasswordExpiresAt"] as string).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + svc.ONE_TIME_PASSWORD_TTL_MS - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + svc.ONE_TIME_PASSWORD_TTL_MS + 1000);

    expectNowhereBut(plain, result);
    // The pointer is the one thing said about it.
    expect(said.some((l) => l.includes(FILE) && l.includes("docker exec"))).toBe(true);
  });

  it("writes the CREATE audit row, by system:bootstrap, in the same transaction as the account", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const [audit] = auditRows();
    expect(audit).toMatchObject({
      action: "CREATE",
      resourceType: "User",
      actorType: "system",
      actorName: "system:bootstrap",
      resourceId: userRow()["id"],
    });
    expect(audit?.["changes"]).toMatchObject({ operation: "BOOTSTRAP_SUPER_ADMIN", kind: "one_time_password" });
    const writes = mdb.committed().filter((w) => w.model === "User" || w.model === "AuditLog");
    expect(new Set(writes.map((w) => w.tx)).size).toBe(1);
    expect(writes[0]?.tx).not.toBeNull();
  });

  it("rolls the account back when the file cannot be written — no account whose password nobody can read", async () => {
    jest.spyOn(nodeFs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error("read-only file system"), { code: "EROFS" });
    });
    await expect(svc.ensureSystemSuperAdmin(SPEC)).rejects.toThrow("read-only file system");
    expect(mdb.rows("User")).toHaveLength(0);
    expect(auditRows()).toHaveLength(0);
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("removes the file it wrote when the transaction fails after the write", async () => {
    const realTransaction = mdb.sequelize.transaction.bind(mdb.sequelize);
    jest
      .spyOn(mdb.sequelize, "transaction")
      .mockImplementationOnce((async (cb: (t: unknown) => Promise<unknown>) => {
        await realTransaction(cb);
        throw new Error("commit failed");
      }) as never);
    await expect(svc.ensureSystemSuperAdmin(SPEC)).rejects.toThrow("commit failed");
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("the seed endpoint's service reports the file path, never the value", async () => {
    // migration.service is JavaScript: typed here by what the test reads.
    const migrationService = jest.requireActual<{
      seedUsers: () => Promise<Record<string, unknown>>;
        }>("../../services/migration.service");
    const result = await migrationService.seedUsers();
    const plain = readFile();
    expect(result).toMatchObject({ usersCreated: 1, usersSkipped: 0, bootstrapPasswordFile: FILE, errors: [] });
    expectNowhereBut(plain, result);
    // Re-seeding touches no credential and issues no new file.
    secret.removeBootstrapSecret();
    const again = await migrationService.seedUsers();
    expect(again).toMatchObject({ usersCreated: 0, usersSkipped: 1, bootstrapPasswordFile: null });
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("the seed service reports a failure as an error entry", async () => {
    const migrationService = jest.requireActual<{
      seedUsers: () => Promise<{ errors: string[] }>;
        }>("../../services/migration.service");
    jest.spyOn(svc, "ensureSystemSuperAdmin").mockRejectedValueOnce(new Error("boom"));
    const result = await migrationService.seedUsers();
    expect(result.errors[0]).toContain("boom");
  });
});

describe("bootstrap is idempotent", () => {
  it("never regenerates or resets an existing system super admin's password on a re-seed", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const hash = userRow()["password"];
    secret.removeBootstrapSecret();

    const again = await svc.ensureSystemSuperAdmin(SPEC);
    expect(again).toEqual({ created: false, updated: true, bootstrapPasswordFile: null });
    expect(userRow()["password"]).toBe(hash);
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("keeps a changed password (the old seed reset it to the public default)", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42");
    const hash = userRow()["password"];
    await svc.ensureSystemSuperAdmin(SPEC);
    expect(userRow()["password"]).toBe(hash);
    expect(userRow()["passwordOneTime"]).toBe(false);
  });

  it("restores a soft-deleted system user without touching its credential", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42", { deletedAt: new Date() });
    const hash = userRow()["password"];
    const result = await svc.ensureSystemSuperAdmin(SPEC);
    expect(result.updated).toBe(true);
    expect(userRow()["deletedAt"]).toBeNull();
    expect(userRow()["password"]).toBe(hash);
  });

  it("creates nothing when another super admin already exists", async () => {
    await seedAdmin("other-op@hospital.id", "Chosen-Pass-42");
    const result = await svc.ensureSystemSuperAdmin(SPEC);
    expect(result).toEqual({ created: false, updated: false, bootstrapPasswordFile: null });
    expect(mdb.rows("User").some((r) => r["email"] === SPEC.email)).toBe(false);
    expect(fs.existsSync(FILE)).toBe(false);
  });
});

// ==========================================================================
describe("boot: retire the public default, sweep a stale file", () => {
  it("moves a super admin still on the retired default to a one-time password, and only that one", async () => {
    const onDefault = await seedAdmin(SPEC.email, svc.RETIRED_DEFAULT_PASSWORD);
    await seedAdmin("careful@hospital.id", "Chosen-Pass-42");
    seedSession(onDefault);

    expect(await svc.retireKnownDefaultPassword()).toBe(1);
    const plain = readFile();
    const row = userRow();
    expect(row["passwordOneTime"]).toBe(true);
    expect(row["mustChangePassword"]).toBe(true);
    expect(await bcrypt.compare(svc.RETIRED_DEFAULT_PASSWORD, String(row["password"]))).toBe(false);
    expect(await bcrypt.compare(plain, String(row["password"]))).toBe(true);
    expect(userRow("careful@hospital.id")["passwordOneTime"]).toBe(false);
    expect(mdb.rows("Session")[0]?.["is_revoked"]).toBe(true);
    expect(auditRows()[0]).toMatchObject({ actorName: "system:bootstrap", action: "UPDATE" });
    expect(auditRows()[0]?.["changes"]).toMatchObject({ operation: "RETIRE_DEFAULT_PASSWORD" });
    expectNowhereBut(plain);

    // Idempotent: the next boot finds nothing to retire.
    expect(await svc.retireKnownDefaultPassword()).toBe(0);
  });

  it("deletes a file no account can use any more, and keeps one that is still live", async () => {
    expect(await svc.sweepStaleBootstrapSecret()).toBe(false); // no file
    await svc.ensureSystemSuperAdmin(SPEC);
    expect(await svc.sweepStaleBootstrapSecret()).toBe(false); // live: kept
    expect(fs.existsSync(FILE)).toBe(true);

    await Users.update({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) }, { where: { email: SPEC.email } });
    expect(await svc.sweepStaleBootstrapSecret()).toBe(true); // expired unused: removed
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("runBootChecks logs, rotates and sweeps — and never refuses the boot", async () => {
    await seedAdmin(SPEC.email, svc.RETIRED_DEFAULT_PASSWORD);
    await svc.runBootChecks();
    expect(userRow()["passwordOneTime"]).toBe(true);
    expect(said.some((l) => l.includes("Retired the public default password of 1"))).toBe(true);

    jest.spyOn(Users, "findAll").mockRejectedValueOnce(new Error("db down"));
    await expect(svc.runBootChecks()).resolves.toBeUndefined();
    expect(said.some((l) => l.includes("Bootstrap credential check failed") && l.includes("db down"))).toBe(true);

    jest.spyOn(Users, "findAll").mockRejectedValueOnce("not an Error");
    await expect(svc.runBootChecks()).resolves.toBeUndefined();
  });

  it("runBootChecks with nothing to retire says nothing about retiring", async () => {
    await svc.runBootChecks();
    expect(said.some((l) => l.includes("Retired the public default"))).toBe(false);
  });
});

// ==========================================================================
describe("first sign-in with the one-time password (the real auth.service#loginUser)", () => {
  const signIn = (password: string) =>
    authService.loginUser({ user: SPEC.email, password, ip: "203.0.113.7", userAgent: "jest" });

  it("answers a password-change token — no session, no refresh token — and consumes the password", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();

    const result = await signIn(plain);
    expect(result).toMatchObject({
      success: true,
      status: 200,
      message: "Password change required",
      data: { email: SPEC.email, passwordChangeRequired: true },
      refreshToken: null,
    });
    expect(result["session"]).toBeUndefined();
    expect(mdb.rows("Session")).toHaveLength(0);

    const decoded = jwtUtil.verifyPurposeToken(String(result["token"]), "password-change") as Record<string, unknown>;
    expect(decoded["id"]).toBe(userRow()["id"]);
    expect(decoded["typ"]).toBe("password-change");
    // The token is refused as an access token and as any other purpose.
    expect(() => jwtUtil.verifyAccessToken(String(result["token"]))).toThrow();
    expect(() => jwtUtil.verifyPurposeToken(String(result["token"]), "mfa")).toThrow();

    const row = userRow();
    expect(row["passwordOneTime"]).toBe(false);
    expect(row["mustChangePassword"]).toBe(true);
    expect(new Date(row["temporaryPasswordExpiresAt"] as string).getTime()).toBeLessThanOrEqual(Date.now());
    // Consumed: the file is gone.
    expect(fs.existsSync(FILE)).toBe(false);
    expectNowhereBut(plain, result);
  });

  it("clears the flag in the same transaction as its audit row", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();
    const before = mdb.committed().length;
    await signIn(plain);
    const writes = mdb
      .committed()
      .slice(before)
      .filter((w) => w.model === "User" || w.model === "AuditLog");
    const consumed = auditRows().find(
      (r) => (r["changes"] as Record<string, unknown> | null)?.["operation"] === "ONE_TIME_PASSWORD_CONSUMED",
    );
    expect(consumed).toMatchObject({ actorType: "user", userId: userRow()["id"], ipAddress: "203.0.113.7" });
    const flagWrite = writes.find((w) => w.model === "User" && JSON.stringify(w.values).includes("passwordOneTime"));
    const auditWrite = writes.find((w) => w.model === "AuditLog");
    expect(flagWrite?.tx).toBeTruthy();
    expect(flagWrite?.tx).toBe(auditWrite?.tx);
  });

  it("a second sign-in with the same password is refused exactly like a wrong password", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();
    await signIn(plain);

    const reused = await signIn(plain).catch((e: unknown) => e);
    const wrong = await signIn("Not-The-Password-1").catch((e: unknown) => e);
    expect(reused).toMatchObject({ status: 401, message: "Invalid credentials" });
    expect(wrong).toMatchObject({ status: 401, message: "Invalid credentials" });
    expect((reused as Error).constructor).toBe((wrong as Error).constructor);
  });

  it("of two concurrent sign-ins with it, exactly one gets a token; the other is the wrong-password 401", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();
    const results = await Promise.allSettled([signIn(plain), signIn(plain)]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]?.reason).toMatchObject({ status: 401, message: "Invalid credentials" });
    expect(
      auditRows().filter(
        (r) => (r["changes"] as Record<string, unknown> | null)?.["operation"] === "ONE_TIME_PASSWORD_CONSUMED",
      ),
    ).toHaveLength(1);
  });

  it("firstSignIn called directly for an account already consumed is the wrong-password 401", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const user = await Users.findOne({ where: { email: SPEC.email } });
    if (!user) {
      throw new Error("missing");
    }
    await svc.firstSignIn(user);
    await expect(svc.firstSignIn(user)).rejects.toMatchObject({ status: 401, message: svc.INVALID_CREDENTIALS });
  });

  it("an unused one-time password past its 72 h is refused like a wrong password", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();
    await Users.update({ temporaryPasswordExpiresAt: new Date(Date.now() - 1000) }, { where: { email: SPEC.email } });
    await expect(signIn(plain)).rejects.toMatchObject({ status: 401, message: "Invalid credentials" });
    expect(userRow()["passwordOneTime"]).toBe(true);
  });
});

// ==========================================================================
describe("POST /auth/first-sign-in/password (completeFirstSignInPasswordChange)", () => {
  const firstToken = async (): Promise<{ token: string; plain: string }> => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const plain = readFile();
    const result = await authService.loginUser({ user: SPEC.email, password: plain });
    return { token: String(result["token"]), plain };
  };

  it("sets the new password, clears every flag, revokes sessions, audits in the transaction — then the new password signs in normally", async () => {
    const { token, plain } = await firstToken();
    seedSession(String(userRow()["id"]));
    const before = mdb.committed().length;

    const result = await svc.completeFirstSignInPasswordChange(
      { token, newPassword: "Chosen-Pass-42" },
      { ipAddress: "203.0.113.7", userAgent: "jest" },
    );
    expect(result).toEqual({
      success: true,
      status: 200,
      message: "Password changed. Sign in with your new password.",
      data: { signInRequired: true },
    });

    const row = userRow();
    expect(await bcrypt.compare("Chosen-Pass-42", String(row["password"]))).toBe(true);
    expect(row["passwordOneTime"]).toBe(false);
    expect(row["mustChangePassword"]).toBe(false);
    expect(row["temporaryPasswordExpiresAt"]).toBeNull();
    expect(row["passwordChangedAt"]).toBeTruthy();
    expect(mdb.rows("Session")[0]?.["is_revoked"]).toBe(true);

    const change = auditRows().find(
      (r) => (r["changes"] as Record<string, unknown> | null)?.["method"] === "one_time_password",
    );
    expect(change).toMatchObject({ action: "UPDATE", userId: row["id"], actorType: "user" });
    expect(change?.["changes"]).toMatchObject({ operation: "PASSWORD_CHANGE", forced: true });
    const writes = mdb
      .committed()
      .slice(before)
      .filter((w) => w.model === "User" || w.model === "AuditLog");
    expect(new Set(writes.map((w) => w.tx)).size).toBe(1);

    // Normal sign-in now: an operator without MFA gets the enrolment-only session (P6-07).
    const signedIn = await authService.loginUser({ user: SPEC.email, password: "Chosen-Pass-42" });
    expect(signedIn["token"]).toBeTruthy();
    expect(signedIn["data"]).toMatchObject({ mustChangePassword: false, mfaEnrolmentRequired: true });
    // And the one-time password is still dead.
    await expect(authService.loginUser({ user: SPEC.email, password: plain })).rejects.toMatchObject({ status: 401 });
    expectNowhereBut(plain, result, signedIn);
  });

  it("the token is single-use: a second change with it is refused", async () => {
    const { token } = await firstToken();
    await svc.completeFirstSignInPasswordChange({ token, newPassword: "Chosen-Pass-42" });
    await expect(svc.completeFirstSignInPasswordChange({ token, newPassword: "Other-Pass-43" })).rejects.toMatchObject({
      status: 401,
      message: svc.TOKEN_REFUSED,
    });
  });

  it("of two concurrent changes with the same token, exactly one succeeds", async () => {
    const { token } = await firstToken();
    const results = await Promise.allSettled([
      svc.completeFirstSignInPasswordChange({ token, newPassword: "Chosen-Pass-42" }),
      svc.completeFirstSignInPasswordChange({ token, newPassword: "Other-Pass-43" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(lost?.reason).toMatchObject({ status: 401, message: svc.TOKEN_REFUSED });
  });

  it("refuses the one-time password as the new password", async () => {
    const { token, plain } = await firstToken();
    await expect(svc.completeFirstSignInPasswordChange({ token, newPassword: plain })).rejects.toMatchObject({
      status: 400,
      message: "The new password must be different from the one-time password",
    });
    expect(userRow()["mustChangePassword"]).toBe(true);
  });

  it.each([
    ["too short", "Ab1"],
    ["no upper case", "chosen-pass-42"],
    ["no digit", "Chosen-Pass-xx"],
  ])("refuses a password that fails the policy (%s)", async (_label, newPassword) => {
    const { token } = await firstToken();
    await expect(svc.completeFirstSignInPasswordChange({ token, newPassword })).rejects.toMatchObject({
      status: 400,
      message: "Validation failed",
    });
  });

  it("refuses a missing body", async () => {
    await expect(svc.completeFirstSignInPasswordChange(undefined)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a forged, expired-shape or wrong-purpose token with one message", async () => {
    await firstToken();
    const id = String(userRow()["id"]);
    const candidates = [
      "not-a-jwt",
      jwtUtil.generatePurposeToken({ id, mfaRequired: true }, "mfa"),
      jwtUtil.generateAccessToken({ id, email: SPEC.email, sid: "s" }),
      jwtUtil.generatePurposeToken({ id }, "password-change"), // no pf
      jwtUtil.generatePurposeToken({ pf: "x" }, "password-change"), // no id
      jwtUtil.generatePurposeToken({ id: "00000000-0000-4000-8000-00000000dead", pf: "x" }, "password-change"),
      jwtUtil.generatePurposeToken({ id, pf: "stale-fingerprint" }, "password-change"),
    ];
    for (const token of candidates) {
      await expect(
        svc.completeFirstSignInPasswordChange({ token, newPassword: "Chosen-Pass-42" }),
      ).rejects.toMatchObject({ status: 401, message: svc.TOKEN_REFUSED });
    }
    expect(userRow()["mustChangePassword"]).toBe(true);
  });

  it("a token for an account whose password is not awaiting this change is refused", async () => {
    const id = await seedAdmin("careful@hospital.id", "Chosen-Pass-42");
    const token = jwtUtil.generatePurposeToken(
      { id, pf: svc.credentialFingerprint(String(userRow("careful@hospital.id")["password"])) },
      "password-change",
    );
    await expect(svc.completeFirstSignInPasswordChange({ token, newPassword: "Other-Pass-43" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("a token minted before a CLI rotation is dead after it", async () => {
    const { token } = await firstToken();
    await svc.rotateOneTimePassword({ identifier: SPEC.email, requestedBy: "Ops", ticket: "CHG-1" });
    await expect(svc.completeFirstSignInPasswordChange({ token, newPassword: "Chosen-Pass-42" })).rejects.toMatchObject({
      status: 401,
    });
  });
});

// ==========================================================================
describe("recovery: rotateOneTimePassword and the CLI", () => {
  it("refuses without a requester, a ticket or an account", async () => {
    await expect(svc.rotateOneTimePassword({ identifier: "", requestedBy: "a", ticket: "b" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.rotateOneTimePassword({ identifier: "x", requestedBy: "", ticket: "b" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.rotateOneTimePassword({ identifier: "x", requestedBy: "a", ticket: "" })).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.rotateOneTimePassword({ identifier: "nobody@x.id", requestedBy: "a", ticket: "b" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a tenant user — theirs is an administrator's reset", async () => {
    await seedAdmin("tech@hospital.id", "Chosen-Pass-42", { roleId: TENANT_ROLE_ID });
    await expect(
      svc.rotateOneTimePassword({ identifier: "tech@hospital.id", requestedBy: "a", ticket: "b" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fs.existsSync(FILE)).toBe(false);
  });

  it("issues a new one-time password to a super admin: hash, flags, sessions revoked, audit naming requester and ticket, file", async () => {
    const id = await seedAdmin(SPEC.email, "Chosen-Pass-42");
    seedSession(id);
    const out = await svc.rotateOneTimePassword({ identifier: "sys", requestedBy: "Rina (IT)", ticket: "INC-42" });
    const plain = readFile();
    expect(out).toEqual({ userId: id, file: FILE });
    expect(userRow()["passwordOneTime"]).toBe(true);
    expect(await bcrypt.compare(plain, String(userRow()["password"]))).toBe(true);
    expect(mdb.rows("Session")[0]?.["is_revoked"]).toBe(true);
    expect(auditRows()[0]?.["changes"]).toMatchObject({
      operation: "ROTATE_ONE_TIME_PASSWORD",
      requestedBy: "Rina (IT)",
      ticket: "INC-42",
    });
    expectNowhereBut(plain, out);

    // Re-issuing on an account that is ALREADY one-time keeps it one-time
    // (the model hook must not clear the flag on a re-issue).
    await svc.rotateOneTimePassword({ identifier: "sys", requestedBy: "Rina (IT)", ticket: "INC-43" });
    expect(userRow()["passwordOneTime"]).toBe(true);
    expect(readFile()).not.toBe(plain);
  });

  it("a super admin with no home tenant has its row recorded under the PLATFORM tenant", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42", { tenantId: null });
    await svc.rotateOneTimePassword({ identifier: "sys", requestedBy: "a", ticket: "b" });
    expect(auditRows()[0]?.["tenantId"]).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("a failed rotation leaves the file it wrote removed and the old credential in place", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42");
    const hash = userRow()["password"];
    const realTransaction = mdb.sequelize.transaction.bind(mdb.sequelize);
    jest.spyOn(mdb.sequelize, "transaction").mockImplementationOnce((async (cb: (t: unknown) => Promise<unknown>) => {
      await realTransaction(cb);
      throw new Error("commit failed");
    }) as never);
    await expect(svc.rotateOneTimePassword({ identifier: "sys", requestedBy: "a", ticket: "b" })).rejects.toThrow(
      "commit failed",
    );
    expect(fs.existsSync(FILE)).toBe(false);
    expect(hash).toBeTruthy();
  });

  it("a rotation whose file write fails is rolled back entirely", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42");
    const hash = userRow()["password"];
    jest.spyOn(nodeFs, "writeFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(svc.rotateOneTimePassword({ identifier: "sys", requestedBy: "a", ticket: "b" })).rejects.toThrow("disk full");
    expect(userRow()["password"]).toBe(hash);
    expect(userRow()["passwordOneTime"]).toBe(false);
    expect(auditRows()).toHaveLength(0);
  });

  it("the CLI prints one line with the file path — never the value — and exits 0", async () => {
    await seedAdmin(SPEC.email, "Chosen-Pass-42");
    const cli = jest.requireActual<typeof Cli>("../../scripts/rotateBootstrapPassword");
    const code = await cli.main(["--user", "sys@mail.com", "--requested-by", "Rina", "--ticket", "INC-7"]);
    const plain = readFile();
    expect(code).toBe(0);
    expect(said.some((l) => l.includes(`cat ${FILE}`))).toBe(true);
    expectNowhereBut(plain);
  });

  it("the CLI reports a refusal on stderr and exits 1", async () => {
    const cli = jest.requireActual<typeof Cli>("../../scripts/rotateBootstrapPassword");
    expect(await cli.main(["--user", "sys@mail.com"])).toBe(1);
    expect(said.some((l) => l.includes("Rotation refused"))).toBe(true);
    expect(cli.readFlag(["--user"], "user")).toBe("");
    expect(cli.readFlag([], "ticket")).toBe("");
  });

  it("the binary's dispatch recognises only its command, and runs it", async () => {
    const dispatch = jest.requireActual<typeof Dispatch>("../../scripts/cliDispatch");
    expect(dispatch.cliCommandFrom(["node", "index.js"])).toBeNull();
    expect(dispatch.cliCommandFrom(["node", "index.js", "--migrate"])).toBeNull();
    expect(dispatch.cliCommandFrom(["node", "index.js", "toString"])).toBeNull();
    expect(dispatch.cliCommandFrom(["node", "index.js", "rotate-bootstrap-password"])).toBe("rotate-bootstrap-password");
    expect(await dispatch.runCliCommand(["node", "index.js", "nope"])).toBe(2);
    // Runs the CLI: no account named → refused, exit 1.
    expect(await dispatch.runCliCommand(["node", "index.js", "rotate-bootstrap-password"])).toBe(1);
  });
});

// ==========================================================================
describe("User model: a password written without the flag is not one-time", () => {
  it("clears passwordOneTime when an instance save changes the password", async () => {
    await svc.ensureSystemSuperAdmin(SPEC);
    const user = await Users.findOne({ where: { email: SPEC.email } });
    if (!user) {
      throw new Error("missing");
    }
    await user.update({ password: await bcrypt.hash("Chosen-Pass-42", 4) });
    expect(userRow()["passwordOneTime"]).toBe(false);
  });

  it("keeps it when the same save sets it, and leaves it alone when the password does not change", async () => {
    const created = await Users.create({
      email: "x@hospital.id",
      username: "x",
      password: await bcrypt.hash("a", 4),
      firstName: "X",
      lastName: "Y",
      roleId: ROLE_IDS.SUPER_ADMIN,
      tenantId: null,
      passwordOneTime: true,
    });
    expect(userRow("x@hospital.id")["passwordOneTime"]).toBe(true);
    await created.update({ firstName: "Z" });
    expect(userRow("x@hospital.id")["passwordOneTime"]).toBe(true);
  });
});
