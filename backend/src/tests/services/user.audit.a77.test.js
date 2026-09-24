/**
 * A-77 — user mutations wrote no audit row inside their transaction.
 *
 * `userService.editUser` (PATCH /users/edit and the A-63 self-service
 * PATCH /users/:userId/profile) wrote no audit row at all. `userCreate`,
 * `userRoleUpdate` and `deleteUser` were covered only by the route-level
 * `recordAudit`, which fires on `res.finish` AFTER the commit — so a failed
 * insert could not undo the change, and the change stayed unattributed
 * (CLAUDE.md: "Every mutation writes an audit row, inside the transaction").
 * A change to a user's role or status is an authorization change.
 *
 * Each test drives the real service over model doubles and a transaction double
 * that records the ORDER of events, so "inside the transaction" is asserted as
 * "carried the transaction AND happened before commit", and "a failed insert
 * rolls back" as "commit never ran".
 */

const events = [];

jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../../models", () => ({
  Users: { findByPk: jest.fn(), findOne: jest.fn(), create: jest.fn() },
  Roles: { findByPk: jest.fn() },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed"),
}));
jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(async (name) => {
    events.push(`unlink:${name}`);
  }),
  getUploadUrl: jest.fn(),
}));

const { db } = require("../../config");
const { Users, Roles } = require("../../models");
const auditService = require("../../services/audit.service");
const { deleteUpload } = require("../../utils/upload.util");
const userService = require("../../services/user.service");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_OLD = "33333333-3333-4333-8333-333333333333";
const ROLE_NEW = "44444444-4444-4444-8444-444444444444";

const actor = {
  actorIsSuperAdmin: false,
  actorTenantId: TENANT_A,
  ipAddress: "10.0.0.7",
  userAgent: "jest-agent",
};

let tx;
const makeTx = () => {
  const t = {
    finished: undefined,
    commit: jest.fn(async () => {
      events.push("commit");
      t.finished = "commit";
    }),
    rollback: jest.fn(async () => {
      events.push("rollback");
      t.finished = "rollback";
    }),
  };
  return t;
};

const makeUser = (overrides = {}) => {
  const row = {
    id: TARGET_ID,
    tenantId: TENANT_A,
    username: "nurse1",
    firstName: "Old",
    lastName: "Name",
    email: "nurse1@a.test",
    status: "ACTIVE",
    isEmailVerified: true,
    is_active: true,
    isActive: true,
    roleId: ROLE_OLD,
    role_id: ROLE_OLD,
    picture: null,
    role: { id: ROLE_OLD, name: "USER" },
    ...overrides,
  };
  row.update = jest.fn(async (values, options = {}) => {
    events.push(options.transaction ? "update:tx" : "update:no-tx");
    Object.assign(row, values);
    if (values.roleId) {
      row.role_id = values.roleId;
    }
    return row;
  });
  row.destroy = jest.fn(async (options = {}) => {
    events.push(options.transaction ? "destroy:tx" : "destroy:no-tx");
  });
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  events.length = 0;
  tx = makeTx();
  db.transaction.mockResolvedValue(tx);
  auditService.logAction.mockImplementation(async (entry, options = {}) => {
    events.push(options.transaction === tx ? "audit:tx" : "audit:no-tx");
    return {};
  });
  Users.findOne.mockResolvedValue(null);
});

describe("A-77 — editUser (PATCH /users/edit, PATCH /users/:userId/profile)", () => {
  it("writes one UPDATE audit row for the user inside the transaction, before the commit", async () => {
    const user = makeUser();
    Users.findByPk.mockResolvedValue(user);

    await userService.editUser({
      userId: TARGET_ID,
      firstName: "New",
      status: "SUSPENDED",
      updatedBy: ACTOR_ID,
      ...actor,
    });

    expect(events).toEqual(["update:tx", "audit:tx", "commit"]);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(options).toEqual({ transaction: tx });
    expect(entry).toMatchObject({
      tenantId: TENANT_A,
      userId: ACTOR_ID,
      action: "UPDATE",
      resourceType: "User",
      resourceId: TARGET_ID,
      ipAddress: "10.0.0.7",
      userAgent: "jest-agent",
    });
    expect(entry.changes).toEqual({
      firstName: { before: "Old", after: "New" },
      status: { before: "ACTIVE", after: "SUSPENDED" },
    });
  });

  it("a failed audit insert rolls the edit back — the change never commits", async () => {
    Users.findByPk.mockResolvedValue(makeUser());
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      userService.editUser({ userId: TARGET_ID, status: "SUSPENDED", updatedBy: ACTOR_ID, ...actor }),
    ).rejects.toMatchObject({ status: 500 });

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledTimes(1);
  });

  it("a refused (cross-tenant, 404) edit writes no audit row", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ tenantId: TENANT_B }));

    await expect(
      userService.editUser({ userId: TARGET_ID, firstName: "Pwned", updatedBy: ACTOR_ID, ...actor }),
    ).rejects.toMatchObject({ status: 404 });

    expect(auditService.logAction).not.toHaveBeenCalled();
  });

  it("records the actor's tenant when the target user has none (a tenant-less account)", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ tenantId: null }));

    await userService.editUser({
      userId: TARGET_ID,
      firstName: "New",
      updatedBy: ACTOR_ID,
      ...actor,
      actorIsSuperAdmin: true,
    });

    expect(auditService.logAction.mock.calls[0][0].tenantId).toBe(TENANT_A);
  });
});

describe("A-77 — userCreate", () => {
  it("writes a CREATE audit row inside the transaction, before the commit, with no password", async () => {
    Roles.findByPk.mockResolvedValue({ id: ROLE_NEW, name: "TECHNICIAN", status: "active" });
    Users.create.mockImplementation(async (values, options = {}) => {
      events.push(options.transaction ? "create:tx" : "create:no-tx");
      return { id: TARGET_ID, ...values, roleId: values.role_id };
    });
    Users.findByPk.mockResolvedValue({ id: TARGET_ID });

    await userService.userCreate({
      username: "tech1",
      firstName: "Tech",
      lastName: "One",
      email: "tech1@example.com",
      password: "Str0ng!Pass",
      roleId: ROLE_NEW,
      createdBy: ACTOR_ID,
      ...actor,
    });

    expect(events).toEqual(["create:tx", "audit:tx", "commit"]);
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(options).toEqual({ transaction: tx });
    expect(entry).toMatchObject({
      tenantId: TENANT_A,
      userId: ACTOR_ID,
      action: "CREATE",
      resourceType: "User",
      resourceId: TARGET_ID,
      ipAddress: "10.0.0.7",
    });
    expect(JSON.stringify(entry.changes)).not.toMatch(/password|hashed|Str0ng/i);
    expect(entry.changes.after).toMatchObject({ username: "tech1", roleId: ROLE_NEW });
  });

  it("a failed audit insert rolls the create back", async () => {
    Roles.findByPk.mockResolvedValue({ id: ROLE_NEW, name: "TECHNICIAN", status: "active" });
    Users.create.mockResolvedValue({ id: TARGET_ID });
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      userService.userCreate({
        username: "tech1",
        firstName: "Tech",
        lastName: "One",
        email: "tech1@example.com",
        password: "Str0ng!Pass",
        roleId: ROLE_NEW,
        createdBy: ACTOR_ID,
        ...actor,
      }),
    ).rejects.toMatchObject({ status: 500 });

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("A-77 — userRoleUpdate", () => {
  it("writes an UPDATE audit row with the role before/after inside the transaction", async () => {
    Users.findByPk.mockResolvedValue(makeUser());
    Roles.findByPk.mockResolvedValue({ id: ROLE_NEW, name: "SUPERVISOR", status: "active" });

    await userService.userRoleUpdate({
      userId: TARGET_ID,
      roleId: ROLE_NEW,
      updatedBy: ACTOR_ID,
      ...actor,
    });

    expect(events).toEqual(["update:tx", "audit:tx", "commit"]);
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(options).toEqual({ transaction: tx });
    expect(entry).toMatchObject({
      tenantId: TENANT_A,
      userId: ACTOR_ID,
      action: "UPDATE",
      resourceType: "User",
      resourceId: TARGET_ID,
      changes: { roleId: { before: ROLE_OLD, after: ROLE_NEW } },
    });
  });
});

describe("A-77 — deleteUser", () => {
  it("deletes and audits inside ONE transaction, and removes the avatar file only after the commit", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ picture: "http://host/uploads/public/profile/face.png" }));

    await userService.deleteUser({ userId: TARGET_ID, deletedBy: ACTOR_ID, ...actor });

    expect(events).toEqual(["destroy:tx", "audit:tx", "commit", "unlink:face.png"]);
    const [entry, options] = auditService.logAction.mock.calls[0];
    expect(options).toEqual({ transaction: tx });
    expect(entry).toMatchObject({
      tenantId: TENANT_A,
      userId: ACTOR_ID,
      action: "DELETE",
      resourceType: "User",
      resourceId: TARGET_ID,
      userAgent: "jest-agent",
    });
  });

  it("a failed audit insert rolls the delete back and keeps the avatar file", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ picture: "http://host/uploads/public/profile/face.png" }));
    auditService.logAction.mockRejectedValue(new Error("audit insert failed"));

    await expect(
      userService.deleteUser({ userId: TARGET_ID, deletedBy: ACTOR_ID, ...actor }),
    ).rejects.toMatchObject({ status: 500 });

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledTimes(1);
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("a commit that fails after finishing the transaction is not rolled back a second time, and keeps the avatar file", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ picture: "http://host/uploads/public/profile/face.png" }));
    tx.commit.mockImplementation(async () => {
      tx.finished = "commit";
      throw new Error("commit failed");
    });

    await expect(
      userService.deleteUser({ userId: TARGET_ID, deletedBy: ACTOR_ID, ...actor }),
    ).rejects.toMatchObject({ status: 500, message: "commit failed" });

    expect(tx.rollback).not.toHaveBeenCalled();
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("a refused (cross-tenant, 404) delete opens no transaction and writes no audit row", async () => {
    Users.findByPk.mockResolvedValue(makeUser({ tenantId: TENANT_B }));

    await expect(
      userService.deleteUser({ userId: TARGET_ID, deletedBy: ACTOR_ID, ...actor }),
    ).rejects.toMatchObject({ status: 404 });

    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
