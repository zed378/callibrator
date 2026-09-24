/**
 * A-96 — avatar mutations (user.service#updateUserAvatar / #removeUserAvatar).
 *
 * Before: no audit row, and the OLD file was unlinked BEFORE the row update —
 * a failed update left the user pointing at a file that no longer existed.
 *
 * Now, for both: the row update and its audit row share one transaction
 * (CLAUDE.md: "Every mutation writes an audit row, inside the transaction");
 * the replaced file is deleted only AFTER the commit; a failed audit insert
 * rolls the update back and leaves the old file where it was. Another tenant's
 * user answers 404, like a missing one.
 */

const mockEvents = [];

jest.mock("../../models", () => ({
  Users: { findByPk: jest.fn() },
  Roles: {},
}));

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async () => ({
      finished: undefined,
      commit: jest.fn(async function commit() {
        mockEvents.push("commit");
        this.finished = "commit";
      }),
      rollback: jest.fn(async function rollback() {
        mockEvents.push("rollback");
        this.finished = "rollback";
      }),
    })),
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async () => {
    mockEvents.push("audit");
    return {};
  }),
}));

jest.mock("../../utils/upload.util", () => ({
  deleteUpload: jest.fn(async (name) => {
    mockEvents.push(`unlink:${name}`);
  }),
  getUploadUrl: jest.fn(),
}));

jest.mock("../../utils/password.util", () => ({ hashPassword: jest.fn() }));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Users } = require("../../models");
const { db } = require("../../config");
const auditService = require("../../services/audit.service");
const { deleteUpload } = require("../../utils/upload.util");
const userService = require("../../services/user.service");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const ACTOR_ID = "cccccccc-cccc-4ccc-8ccc-000000000002";

const actor = (overrides = {}) => ({
  actorTenantId: TENANT_A,
  actorIsSuperAdmin: false,
  ipAddress: "10.0.0.1",
  userAgent: "jest",
  ...overrides,
});

const userRow = (fields) => {
  const row = {
    id: USER_ID,
    tenantId: TENANT_A,
    avatarUrl: "old.png",
    ...fields,
    getDataValue(key) {
      return row[key];
    },
    update: jest.fn(async (values) => {
      mockEvents.push("update");
      Object.assign(row, values);
      return row;
    }),
  };
  return row;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.length = 0;
});

describe("A-96 — updateUserAvatar", () => {
  it("updates, audits inside the transaction, commits, THEN deletes the replaced file", async () => {
    const row = userRow();
    Users.findByPk.mockResolvedValue(row);

    const result = await userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor());

    expect(result).toMatchObject({ status: 200, data: { avatar: "new.png" } });
    const tx = await db.transaction.mock.results[0].value;
    expect(Users.findByPk).toHaveBeenCalledWith(USER_ID, { transaction: tx });
    expect(row.update).toHaveBeenCalledWith(
      { avatarUrl: "new.png" },
      { silent: true, transaction: tx },
    );
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: TENANT_A,
        userId: ACTOR_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: {
          operation: "UPDATE_AVATAR",
          avatarUrl: { before: "old.png", after: "new.png" },
        },
        ipAddress: "10.0.0.1",
        userAgent: "jest",
      },
      { transaction: tx },
    );
    expect(mockEvents).toEqual(["update", "audit", "commit", "unlink:old.png"]);
    expect(deleteUpload).toHaveBeenCalledWith("old.png", "uploads/public/profile");
  });

  it("a failed audit insert rolls the update back and the old file stays", async () => {
    Users.findByPk.mockResolvedValue(userRow());
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(
      userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor()),
    ).rejects.toBeDefined();

    expect(mockEvents).toEqual(["update", "rollback"]);
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("does not delete the placeholder, and a failed unlink after commit does not fail the request", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "default.svg" }));

    await userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor());
    expect(deleteUpload).not.toHaveBeenCalled();

    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "prev.png" }));
    deleteUpload.mockRejectedValueOnce(new Error("EPERM"));
    await expect(
      userService.updateUserAvatar(USER_ID, "new2.png", ACTOR_ID, actor()),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("a user with no avatar yet: nothing to delete, the audit records null → new", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: null }));

    await userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor());

    expect(auditService.logAction.mock.calls[0][0].changes.avatarUrl).toEqual({
      before: null,
      after: "new.png",
    });
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("another tenant's user is 404, byte-identical to a missing one, and nothing is written", async () => {
    Users.findByPk.mockResolvedValueOnce(userRow({ tenantId: TENANT_B }));
    const foreign = await userService
      .updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor())
      .catch((e) => e);
    Users.findByPk.mockResolvedValueOnce(null);
    const missing = await userService
      .updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor())
      .catch((e) => e);

    expect(foreign).toEqual({ status: 404, message: "User not found" });
    expect(missing).toEqual(foreign);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(mockEvents).toEqual(["rollback", "rollback"]);
  });

  it("the super admin may act across tenants; the row goes to the target's tenant", async () => {
    Users.findByPk.mockResolvedValue(userRow({ tenantId: TENANT_B }));

    await userService.updateUserAvatar(
      USER_ID,
      "new.png",
      ACTOR_ID,
      actor({ actorIsSuperAdmin: true }),
    );

    expect(auditService.logAction.mock.calls[0][0].tenantId).toBe(TENANT_B);
  });

  it("with no actor at all, refuses (the actor defaults to nobody)", async () => {
    Users.findByPk.mockResolvedValue(userRow());

    await expect(userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID)).rejects.toEqual({
      status: 404,
      message: "User not found",
    });
  });

  it("wraps an unexpected (non-status) error as a 500 AppError after rolling back", async () => {
    Users.findByPk.mockRejectedValue(new TypeError("boom"));

    await expect(
      userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor()),
    ).rejects.toMatchObject({ status: 500, message: "Failed to update user avatar" });
    expect(mockEvents).toEqual(["rollback"]);
  });
});

describe("A-96 — updateUserAvatar edges", () => {
  it("re-uploading under the same stored name never deletes the file just stored", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "same.png" }));

    await userService.updateUserAvatar(USER_ID, "same.png", ACTOR_ID, actor());

    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("an old value stored as a URL is reduced to its filename for the delete", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "/uploads/public/profile/old-url.png" }));

    await userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor());

    expect(deleteUpload).toHaveBeenCalledWith("old-url.png", "uploads/public/profile");
  });

  it("with no acting user id, the audit row's userId is null (a system change), not undefined", async () => {
    Users.findByPk.mockResolvedValue(userRow());

    await userService.updateUserAvatar(USER_ID, "new.png", undefined, actor());

    expect(auditService.logAction.mock.calls[0][0].userId).toBeNull();
  });

  it("rethrows an error that already carries a status untouched", async () => {
    Users.findByPk.mockRejectedValue({ status: 409, message: "conflict" });

    await expect(
      userService.updateUserAvatar(USER_ID, "new.png", ACTOR_ID, actor()),
    ).rejects.toEqual({ status: 409, message: "conflict" });
  });
});

describe("A-96 — removeUserAvatar", () => {
  it("resets to the placeholder, audits inside the transaction, commits, THEN deletes the file", async () => {
    const row = userRow({ avatarUrl: "old.png" });
    Users.findByPk.mockResolvedValue(row);

    const result = await userService.removeUserAvatar(USER_ID, ACTOR_ID, actor());

    expect(result).toMatchObject({ status: 200, data: { avatar: "default.svg" } });
    const tx = await db.transaction.mock.results[0].value;
    expect(row.update).toHaveBeenCalledWith(
      { avatarUrl: "default.svg" },
      { silent: true, transaction: tx },
    );
    expect(auditService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        userId: ACTOR_ID,
        action: "UPDATE",
        resourceType: "User",
        resourceId: USER_ID,
        changes: {
          operation: "REMOVE_AVATAR",
          avatarUrl: { before: "old.png", after: "default.svg" },
        },
      }),
      { transaction: tx },
    );
    expect(mockEvents).toEqual(["update", "audit", "commit", "unlink:old.png"]);
  });

  it("a failed audit insert rolls back and the file stays", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "old.png" }));
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID, actor())).rejects.toBeDefined();

    expect(mockEvents).toEqual(["update", "rollback"]);
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it.each([null, "default.svg"])(
    "no avatar (%s): nothing changes, nothing is audited, nothing is deleted",
    async (avatarUrl) => {
      const row = userRow({ avatarUrl });
      Users.findByPk.mockResolvedValue(row);

      const result = await userService.removeUserAvatar(USER_ID, ACTOR_ID, actor());

      expect(result).toMatchObject({ status: 200 });
      expect(row.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
      expect(deleteUpload).not.toHaveBeenCalled();
      expect(mockEvents).toEqual(["rollback"]);
    },
  );

  it("a failed unlink after commit does not fail the request", async () => {
    Users.findByPk.mockResolvedValue(userRow({ avatarUrl: "old.png" }));
    deleteUpload.mockRejectedValueOnce(new Error("EPERM"));

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID, actor())).resolves.toMatchObject({
      status: 200,
    });
  });

  it("another tenant's user is 404 and nothing is written", async () => {
    Users.findByPk.mockResolvedValue(userRow({ tenantId: TENANT_B }));

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID, actor())).rejects.toEqual({
      status: 404,
      message: "User not found",
    });
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it("a missing user is the same 404", async () => {
    Users.findByPk.mockResolvedValue(null);

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID)).rejects.toEqual({
      status: 404,
      message: "User not found",
    });
  });

  it("a rollback that itself fails does not mask the original error", async () => {
    Users.findByPk.mockRejectedValue({ status: 404, message: "User not found" });
    db.transaction.mockResolvedValueOnce({
      commit: jest.fn(),
      rollback: jest.fn().mockRejectedValue(new Error("already finished")),
    });

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID, actor())).rejects.toEqual({
      status: 404,
      message: "User not found",
    });
  });

  it("wraps an unexpected error as a 500 AppError", async () => {
    Users.findByPk.mockRejectedValue(new TypeError("boom"));

    await expect(userService.removeUserAvatar(USER_ID, ACTOR_ID, actor())).rejects.toMatchObject({
      status: 500,
      message: "Failed to remove user avatar",
    });
  });
});
