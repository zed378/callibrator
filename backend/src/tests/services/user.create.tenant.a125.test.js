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

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => [];
  db.transaction = async () => {
    const t = {
      finished: undefined,
      commit: async () => {
        t.finished = "commit";
      },
      rollback: async () => {
        t.finished = "rollback";
      },
    };
    return t;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("$2b$hash"),
  comparePassword: jest.fn(),
}));

const models = require("../../models");
const userService = require("../../services/user.service");
const auditService = require("../../services/audit.service");
const { createTwoTenants } = require("../fixtures/twoTenants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const { ROLE_NAMES } = require("../../constants/roleConstants");

const ROLE = "33333333-3333-4333-8333-333333333333";

let fx;
let created;

beforeEach(() => {
  fx = createTwoTenants();
  created = [];
  jest.spyOn(models.Users, "findOne").mockResolvedValue(null);
  jest.spyOn(models.Roles, "findByPk").mockResolvedValue({ id: ROLE, name: "TECHNICIAN", status: "active" });
  jest.spyOn(models.Users, "create").mockImplementation(async (values) => {
    created.push(values);
    return models.Users.build(values);
  });
  jest.spyOn(models.Users, "findByPk").mockImplementation(async () => ({ id: "u-new" }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/** userCreate as the controller calls it: body fields + getActor(req). */
const createAs = (principal, bodyTenantId, { superAdmin = false } = {}) =>
  userService.userCreate({
    tenantId: bodyTenantId,
    username: "ada",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@hospital.example.com",
    password: "Str0ng!Passw0rd",
    roleId: ROLE,
    createdBy: principal.id,
    actorTenantId: principal.tenantId || null,
    actorIsSuperAdmin: superAdmin,
  });

describe("A-125 follow-up: userCreate never takes a non-super-admin's tenant from the body", () => {
  it("a tenant A admin naming tenant B in the body creates the account in tenant A", async () => {
    const admin = fx.principal(fx.tenantA, ROLE_NAMES.HEALTCARE_ADMIN);

    await createAs(admin, fx.tenantB.id);

    expect(created).toHaveLength(1);
    expect(created[0].tenantId).toBe(fx.tenantA.id);
  });

  it.each([
    ["tenant B", () => fx.tenantB.id],
    ["the PLATFORM tenant", () => PLATFORM_TENANT_ID],
  ])("a tenant-less non-super-admin naming %s is refused 403 and creates nothing (was: created there)", async (_l, target) => {
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

    expect(created.map((c) => c.tenantId)).toEqual([fx.tenantB.id, PLATFORM_TENANT_ID]);
  });
});
