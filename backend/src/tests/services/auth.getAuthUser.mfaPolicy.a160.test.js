/**
 * A-160 — authService.getAuthUserWithTenant, which builds req.user on every
 * authenticated request, attaches the user's tenant "MFA required" policy as
 * `user.mfaPolicy` (auth.middleware decides from it).
 *
 * Asserted against the SQL Sequelize generates (the A-87 technique: real
 * models barrel and global tenant hooks on an unconnected PostgreSQL-dialect
 * Sequelize whose `query` is a recorder): the settings read names the USER's
 * tenant and only the two policy keys, and carries no hook-injected tenant
 * predicate even in a "deny" context (it runs before any tenant context is
 * set, and the tenant is the user's own, not request input).
 *
 * Fail-before (baseline 2a157f1): `mfaPolicy` was never attached and no
 * settings were read.
 */

const mockSql = { statements: [], settingsRows: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options = {}) => {
    const raw = typeof sql === "string" ? sql : sql.query;
    const bind = (typeof sql === "object" && sql.bind) || options.bind || [];
    const text = raw.replace(/\$(\d+)/g, (m, n) => `'${bind[Number(n) - 1]}'`);
    mockSql.statements.push(text);
    return /FROM "tenant_settings"/.test(text) ? mockSql.settingsRows : [];
  };
  return { db };
});
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  cacheKeys: {},
}));
jest.mock("../../services/emailQueue.service", () => ({}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const { getAuthUserWithTenant } = require("../../services/auth.service");
const { NO_POLICY } = require("../../utils/mfaPolicy.util");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const settingsSelect = () => mockSql.statements.find((s) => /FROM "tenant_settings"/.test(s));

let loaded;
beforeEach(() => {
  mockSql.statements = [];
  mockSql.settingsRows = [];
  loaded = { id: USER_ID, tenantId: TENANT, mfaEnabled: false, role: { name: "TECHNICIAN" } };
  jest.spyOn(models.Users, "findByPk").mockImplementation(async () => loaded);
});
afterEach(() => jest.restoreAllMocks());

describe("A-160: the loader attaches the tenant's MFA policy", () => {
  it("reads the user's own tenant, only the policy keys, and parses them", async () => {
    mockSql.settingsRows = [
      { key: "mfa_required", value: "true" },
      { key: "mfa_required_min_role_level", value: "5" },
    ];

    // Even in a context that would DENY (a principal with no tenant), the
    // read is scoped by the user's tenant id alone.
    const user = await tenantStorage.run({ tenantId: null, isSuperAdmin: false }, () =>
      getAuthUserWithTenant(USER_ID),
    );

    expect(user.mfaPolicy).toEqual({ required: true, minRoleLevel: 5 });
    const sql = settingsSelect();
    expect(sql).toMatch(/SELECT "key", "value" FROM "tenant_settings" AS "TenantSettings"/);
    expect(sql).toContain(`"TenantSettings"."tenant_id" = '${TENANT}'`);
    expect(sql).toContain("\"TenantSettings\".\"key\" IN ('mfa_required', 'mfa_required_min_role_level')");
    expect(sql).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it("a tenant that set nothing has no policy", async () => {
    const user = await getAuthUserWithTenant(USER_ID);

    expect(user.mfaPolicy).toEqual({ required: false, minRoleLevel: null });
  });

  it.each([
    ["a user who already has MFA", { mfaEnabled: true }],
    ["a user with no tenant", { tenantId: null }],
  ])("%s: no policy, and no settings read", async (_label, overrides) => {
    Object.assign(loaded, overrides);

    const user = await getAuthUserWithTenant(USER_ID);

    expect(user.mfaPolicy).toBe(NO_POLICY);
    expect(settingsSelect()).toBeUndefined();
  });

  it("an unknown user is returned as null, with nothing read", async () => {
    loaded = null;

    expect(await getAuthUserWithTenant(USER_ID)).toBeNull();
    expect(settingsSelect()).toBeUndefined();
  });
});
