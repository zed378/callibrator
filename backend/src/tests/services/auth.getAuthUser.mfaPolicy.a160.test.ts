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
import type * as SequelizeModule from "sequelize";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as MfaPolicy from "../../utils/mfaPolicy.util";

const mockSql: { statements: string[]; settingsRows: { key: string; value: string }[] } = {
  statements: [],
  settingsRows: [],
};

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (
    sql: string | { query: string; bind?: unknown[] },
    options: { bind?: unknown[] } = {},
  ) => {
    const raw = typeof sql === "string" ? sql : sql.query;
    const bind = (typeof sql === "object" ? (sql.bind ?? options.bind) : options.bind) ?? [];
    const text = raw.replace(/\$(\d+)/g, (_m: string, n: string) => `'${String(bind[Number(n) - 1])}'`);
    mockSql.statements.push(text);
    return Promise.resolve(text.includes('FROM "tenant_settings"') ? mockSql.settingsRows : []);
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

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
require("../../models");
const models = require("../../models") as {
    Users: { findByPk: (...args: unknown[]) => Promise<unknown> };
};
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as typeof TenantContext;
const { getAuthUserWithTenant } = require("../../services/auth.service") as {
    getAuthUserWithTenant: (id: string) => Promise<({ mfaPolicy: unknown } & Record<string, unknown>) | null>;
};
const { NO_POLICY } = require("../../utils/mfaPolicy.util") as typeof MfaPolicy;
/* eslint-enable @typescript-eslint/no-require-imports */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const settingsSelect = () => mockSql.statements.find((s) => s.includes('FROM "tenant_settings"'));

let loaded: { id: string; tenantId: string | null; mfaEnabled: boolean; role: { name: string } } | null;
beforeEach(() => {
  mockSql.statements = [];
  mockSql.settingsRows = [];
  loaded = { id: USER_ID, tenantId: TENANT, mfaEnabled: false, role: { name: "TECHNICIAN" } };
  jest.spyOn(models.Users, "findByPk").mockImplementation(() => Promise.resolve(loaded));
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
    const user = await tenantStorage.run({ tenantId: null, isSuperAdmin: false, isSystemTask: false }, () =>
      getAuthUserWithTenant(USER_ID),
    );

    expect(user?.mfaPolicy).toEqual({ required: true, minRoleLevel: 5 });
    const sql = settingsSelect();
    expect(sql).toMatch(/SELECT "key", "value" FROM "tenant_settings" AS "TenantSettings"/);
    expect(sql).toContain(`"TenantSettings"."tenant_id" = '${TENANT}'`);
    expect(sql).toContain("\"TenantSettings\".\"key\" IN ('mfa_required', 'mfa_required_min_role_level')");
    expect(sql).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it("a tenant that set nothing has no policy", async () => {
    const user = await getAuthUserWithTenant(USER_ID);

    expect(user?.mfaPolicy).toEqual({ required: false, minRoleLevel: null });
  });

  it.each([
    ["a user who already has MFA", { mfaEnabled: true }],
    ["a user with no tenant", { tenantId: null }],
  ])("%s: no policy, and no settings read", async (_label: string, overrides: { mfaEnabled?: boolean; tenantId?: null }) => {
    Object.assign(loaded ?? {}, overrides);

    const user = await getAuthUserWithTenant(USER_ID);

    expect(user?.mfaPolicy).toBe(NO_POLICY);
    expect(settingsSelect()).toBeUndefined();
  });

  it("an unknown user is returned as null, with nothing read", async () => {
    loaded = null;

    expect(await getAuthUserWithTenant(USER_ID)).toBeNull();
    expect(settingsSelect()).toBeUndefined();
  });
});
