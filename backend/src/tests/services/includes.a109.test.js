/**
 * A-109 — the implicit INNER JOINs on Role (and one on CalibrationDevice) that
 * A-90 left in the user, auth and certificate files.
 *
 * Role and CalibrationDevice carry a `defaultScope` (`where: { is_deleted:
 * false }`), which makes Sequelize default an include of them to
 * `required: true` — an INNER JOIN — although the include names no `where`.
 * So a user whose role was deleted (role_id SET NULL, or a soft-deleted role)
 * vanished from the user list, the user picker and the user detail (a 404);
 * could not be given a new role or be deleted (a 404 — "not found" — from the
 * very operations that repair them); could not finish an MFA sign-in they had
 * already passed the password step of; and could not be impersonated. The
 * certificate statistics' "latest certificate" skipped a certificate whose
 * device was soft-deleted.
 *
 * Measured, not assumed — the technique of includes.a90.test.js: the REAL
 * models barrel on an UNCONNECTED PostgreSQL-dialect Sequelize whose `query` is
 * a recorder, and each service/controller called for real. The assertion is on
 * the SQL: the join is LEFT OUTER.
 *
 * fetchUsers had a second, independent cause: `role_id NOT IN (<super admin>)`
 * is NULL — not true — for a user with no role. The WHERE is asserted too.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockSql.statements.push(text);
    if (/^SELECT count\(/i.test(text)) {return options && options.plain ? { count: 0 } : [];}
    return options && options.plain ? null : [];
  };
  // No connection: a transaction is a stand-in, managed or unmanaged.
  db.transaction = async (fn) => {
    const t = {
      finished: undefined,
      commit: async () => {
        t.finished = "commit";
      },
      rollback: async () => {
        t.finished = "rollback";
      },
      afterCommit: () => {},
    };
    return typeof fn === "function" ? fn(t) : t;
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  cacheKeys: { userPermissions: (id) => `user-perms:${id}` },
}));
jest.mock("../../services/session.service", () => ({
  createSession: jest.fn().mockResolvedValue({ id: "s-1" }),
}));

const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");
const userService = require("../../services/user.service");
const userController = require("../../controllers/user.controller");
const authService = require("../../services/auth.service");
const certificateService = require("../../services/certificate.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const ROLE = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);
const rowSelects = () => mockSql.statements.filter((s) => /^SELECT (?!count\()/i.test(s));
const counts = () => mockSql.statements.filter((s) => /^SELECT count\(/i.test(s));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The join type Sequelize wrote for `alias` on `table`. */
const joinType = (sql, table, alias) => {
  const match = sql.match(
    new RegExp(`(LEFT OUTER|INNER) JOIN "${esc(table)}" AS "${esc(alias)}" ON`),
  );
  if (!match) {throw new Error(`no join for ${alias} in: ${sql}`);}
  return match[1];
};

const resDouble = () => {
  const res = { headersSent: false };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

beforeEach(() => {
  mockSql.statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-109 — a user without a live role is still a user", () => {
  it("user list: role LEFT-joined in the rows AND the count, and the super-admin filter keeps role_id IS NULL", async () => {
    await asTenant(() => userService.fetchUsers({ tenantId: TENANT, role: { id: ROLE } }));

    const [list] = rowSelects();
    expect(joinType(list, "roles", "role")).toBe("LEFT OUTER");
    // findAndCountAll: an INNER JOIN in the COUNT makes meta.total disagree
    // with the rows. (A LEFT include that selects nothing may be dropped from
    // the count altogether, which is equally correct.)
    const [count] = counts();
    if (/JOIN "roles"/.test(count)) {
      expect(joinType(count, "roles", "role")).toBe("LEFT OUTER");
    }
    expect(list).toMatch(/\("User"\."role_id" IS NULL OR "User"\."role_id" NOT IN \('/);
  });

  it("user detail: role LEFT-joined — a role-less user is found, not a 404", async () => {
    await asTenant(() => userService.fetchSpecificUser(ID).catch(() => {}));

    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });

  it("role assignment: the user is loaded with role LEFT-joined — the repair can reach them", async () => {
    await asTenant(() =>
      userService
        .userRoleUpdate({ userId: ID, roleId: ROLE, updatedBy: ACTOR, actorTenantId: TENANT })
        .catch(() => {}),
    );

    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });

  it("delete: the user is loaded with role LEFT-joined", async () => {
    await asTenant(() =>
      userService
        .deleteUser({ userId: ID, deletedBy: ACTOR, actorTenantId: TENANT })
        .catch(() => {}),
    );

    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });

  it("user picker (getAllUsersSimple): role LEFT-joined", async () => {
    await asTenant(() =>
      userController.getAllUsersSimple({ user: { id: ACTOR, tenantId: TENANT } }, resDouble(), jest.fn()),
    );

    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });
});

describe("A-109 — sign-in and impersonation of a user without a live role", () => {
  it("loginMfa loads the user with role LEFT-joined, as loginUser does", async () => {
    // Pre-auth: no tenant context, as the real request.
    await authService.loginMfa(ID, "123456").catch(() => {});

    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });

  it("impersonateUser: the caller and the target are loaded with role LEFT-joined", async () => {
    // The caller, by the real query (recorded) …
    await authService.impersonateUser(ACTOR, TENANT, ID).catch(() => {});
    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");

    // … and, with a super-admin caller, the target by the real query.
    mockSql.statements = [];
    jest.spyOn(models.Users, "findByPk").mockResolvedValueOnce({
      id: ACTOR,
      email: "root@example.com",
      role: { name: "SUPER_ADMIN" },
    });
    await authService.impersonateUser(ACTOR, TENANT, ID).catch(() => {});
    expect(joinType(rowSelects()[0], "roles", "role")).toBe("LEFT OUTER");
  });
});

describe("A-109 — certificate statistics", () => {
  it("the latest certificate LEFT-joins its device (a soft-deleted device does not hide it)", async () => {
    await asTenant(() => certificateService.getCertificateStats(TENANT).catch(() => {}));

    const latest = rowSelects().find((s) => /JOIN "calibration_devices"/.test(s));
    expect(latest).toBeDefined();
    expect(joinType(latest, "calibration_devices", "device")).toBe("LEFT OUTER");
  });
});
