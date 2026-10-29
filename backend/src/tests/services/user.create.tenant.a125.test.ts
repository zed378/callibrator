/**
 * A-125 follow-up — user.service#userCreate takes the new account's tenant
 * from the CALLER, never from the body, unless the caller is a super admin.
 *
 * The bug: `effectiveTenantId = actorIsSuperAdmin ? tenantId : actorTenantId
 * || tenantId`. A non-super-admin principal with NO tenant fell through to
 * the body's tenantId — so it could create an account in any tenant it named,
 * the reserved PLATFORM tenant (which holds the platform audit trail)
 * included. A non-super-admin whose own tenant is PLATFORM could create
 * accounts there too.
 *
 * Two tenants from fixtures/twoTenants.js; the real models barrel on an
 * unconnected PostgreSQL-dialect Sequelize (as user.create.attributes.test.js),
 * with `Users.create` captured.
 *
 * Fail-before (baseline 2a157f1): "a tenant-less non-super-admin" created the
 * account in the body's tenant B (and in PLATFORM); "a non-super-admin whose
 * own tenant is PLATFORM" created it there.
 */
import type * as SequelizeModule from "sequelize";
import type UserService from "../../services/user.service";
import type * as PlatformTenantModule from "../../constants/platformTenant";
import type * as RoleConstantsModule from "../../constants/roleConstants";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = () => Promise.resolve([]);
  (db as unknown as { transaction: unknown }).transaction = () => {
    const t = {
      finished: undefined as string | undefined,
      commit: () => {
        t.finished = "commit";
        return Promise.resolve();
      },
      rollback: () => {
        t.finished = "rollback";
        return Promise.resolve();
      },
    };
    return Promise.resolve(t);
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as user.create.attributes does */
require("../../models");
const models = require("../../models") as {
    Users: {
        findOne: (...args: unknown[]) => Promise<unknown>;
        findByPk: (...args: unknown[]) => Promise<unknown>;
        create: (...args: unknown[]) => Promise<unknown>;
        build: (values: Record<string, unknown>) => Record<string, unknown>;
    };
    Roles: { findByPk: (...args: unknown[]) => Promise<unknown> };
};
const userService = require("../../services/user.service") as typeof UserService;
const auditService = require("../../services/audit.service") as { logAction: jest.Mock };
const { createTwoTenants } = require("../fixtures/twoTenants") as {
    createTwoTenants: () => TwoTenantsFixture;
};
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant") as typeof PlatformTenantModule;
const { ROLE_NAMES } = require("../../constants/roleConstants") as typeof RoleConstantsModule;
/* eslint-enable @typescript-eslint/no-require-imports */

interface TenantShape {
    id: string;
    [key: string]: unknown;
}

interface PrincipalShape {
    id: string;
    tenantId: string | null;
    [key: string]: unknown;
}

interface TwoTenantsFixture {
    tenantA: TenantShape;
    tenantB: TenantShape;
    superAdmin: PrincipalShape;
    principal: (tenant: TenantShape, roleName?: string) => PrincipalShape;
}

const ROLE = "33333333-3333-4333-8333-333333333333";

let fx: TwoTenantsFixture;
let created: Record<string, unknown>[];

beforeEach(() => {
  fx = createTwoTenants();
  created = [];
  jest.spyOn(models.Users, "findOne").mockResolvedValue(null);
  jest.spyOn(models.Roles, "findByPk").mockResolvedValue({ id: ROLE, name: "TECHNICIAN", status: "active" });
  jest.spyOn(models.Users, "create").mockImplementation((values: unknown) => {
    created.push(values as Record<string, unknown>);
    return Promise.resolve(models.Users.build(values as Record<string, unknown>));
  });
  jest.spyOn(models.Users, "findByPk").mockImplementation(() => Promise.resolve({ id: "u-new" }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/** userCreate as the controller calls it: body fields + getActor(req). */
const createAs = (
  principal: PrincipalShape,
  bodyTenantId: string,
  { superAdmin = false }: { superAdmin?: boolean } = {},
): Promise<unknown> =>
  userService.userCreate({
    tenantId: bodyTenantId,
    username: "ada",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@hospital.example.com",
    password: "Str0ng!Passw0rd",
    roleId: ROLE,
    createdBy: principal.id,
    actorTenantId: principal.tenantId,
    actorIsSuperAdmin: superAdmin,
  });

describe("A-125 follow-up: userCreate never takes a non-super-admin's tenant from the body", () => {
  it("a tenant A admin naming tenant B in the body creates the account in tenant A", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    await createAs(admin, fx.tenantB.id);

    expect(created).toHaveLength(1);
    expect(created[0]?.["tenantId"]).toBe(fx.tenantA.id);
  });

  it.each([
    ["tenant B", (): string => fx.tenantB.id],
    ["the PLATFORM tenant", (): string => PLATFORM_TENANT_ID],
  ])("a tenant-less non-super-admin naming %s is refused 403 and creates nothing (was: created there)", async (_l: string, target: () => string) => {
    const orphan = { ...fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN), tenantId: null };

    await expect(createAs(orphan, target())).rejects.toEqual({
      status: 403,
      message: "Forbidden: your account cannot create users",
    });
    expect(created).toEqual([]);
    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("a non-super-admin whose own tenant is PLATFORM is refused 403 (was: created in PLATFORM)", async () => {
    const stray = { ...fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN), tenantId: PLATFORM_TENANT_ID };

    await expect(createAs(stray, fx.tenantA.id)).rejects.toMatchObject({ status: 403 });
    expect(created).toEqual([]);
  });

  it("a super admin still places the account in the tenant it names — PLATFORM only when named explicitly", async () => {
    await createAs(fx.superAdmin, fx.tenantB.id, { superAdmin: true });
    await createAs(fx.superAdmin, PLATFORM_TENANT_ID, { superAdmin: true });

    expect(created.map((c) => c["tenantId"])).toEqual([fx.tenantB.id, PLATFORM_TENANT_ID]);
  });
});
