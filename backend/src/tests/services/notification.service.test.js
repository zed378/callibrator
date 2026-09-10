const { describe, it, expect, beforeEach } = require("@jest/globals");

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    iLike: Symbol("iLike"),
    in: Symbol("in"),
  },
}));

// --- Mock socket.io: getIo harus mock function agar .toHaveBeenCalled() bekerja ---
let _mockToRoom = null;
let _mockEmitArgs = null;

const mockSocket = {
  to: jest.fn((room) => {
    _mockToRoom = room;
    return mockSocket;
  }),
  emit: jest.fn((event, data) => {
    _mockEmitArgs = [event, data];
  }),
};

jest.mock("../../config/socket", () => ({
  getIo: jest.fn(() => mockSocket),
}));

jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

jest.mock("../../models", () => ({
  Notification: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
  },
  NotificationState: {
    findOrCreate: jest.fn(),
    findAll: jest.fn(),
    bulkCreate: jest.fn(),
    update: jest.fn(),
  },
  User: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../../services/notificationChannels.service", () => ({
  dispatch: jest.fn().mockResolvedValue({ email: "queued" }),
  DEFAULT_CHANNELS: ["realtime"],
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

const { Op } = require("sequelize");
const { Notification, NotificationState, User } = require("../../models");
const { getIo } = require("../../config/socket");
const notificationChannels = require("../../services/notificationChannels.service");
const {
  emitNotification,
  fetchUserNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  deleteManyNotifications,
} = require("../../services/notification.service");

// ---- helpers ----
const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false);
  } catch (err) {
    expect(err).toBeDefined();
    const actual = (err && err.message) || String(err);
    expect(actual).toContain(message);
  }
};

const mockNotification = (extra = {}) => ({
  id: "n-1",
  title: "Test notification",
  message: "Test message",
  userId: "u-1",
  tenantId: "t-1",
  isRead: false,
  type: "info",
  ...extra,
  toJSON: () => ({ ...extra }),
});

// A NotificationState row as returned by findOrCreate (the instance half).
const mockStateRow = (extra = {}) => ({
  notificationId: "n-1",
  userId: "u-1",
  isRead: false,
  readAt: null,
  deletedAt: null,
  update: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

// ================================================================
describe("notification.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _mockToRoom = null;
    _mockEmitArgs = null;

    // Per-user state store defaults: nothing exists yet, so every write is a
    // create. Individual tests override where the create/update split matters.
    NotificationState.findOrCreate.mockResolvedValue([mockStateRow(), true]);
    NotificationState.findAll.mockResolvedValue([]);
    NotificationState.bulkCreate.mockResolvedValue([]);
    NotificationState.update.mockResolvedValue([0]);
    Notification.findAll.mockResolvedValue([]);
    Notification.destroy.mockResolvedValue(0);
  });

  // ================================================================
  describe("emitNotification", () => {
    it("should create and emit a notification via socket.io", async () => {
      const created = mockNotification({ id: "n-new", userId: "u-1" });
      Notification.create.mockResolvedValueOnce(created);

      const result = await emitNotification({
        title: "Test",
        message: "Hello",
        userId: "u-1",
        tenantId: "t-1",
      });

      expect(Notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Test",
          message: "Hello",
          userId: "u-1",
          tenantId: "t-1",
        }),
      );
      expect(getIo).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalled();
      expect(_mockEmitArgs[0]).toBe("new_notification");
      expect(_mockToRoom).toBe("user_u-1");
    });

    it("should emit to tenant room when userId not provided", async () => {
      const created = mockNotification({ id: "n-2", tenantId: "t-2" });
      Notification.create.mockResolvedValueOnce(created);

      await emitNotification({
        title: "Tenant-wide",
        message: "All tenants",
        tenantId: "t-2",
      });

      expect(getIo).toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalled();
      expect(_mockEmitArgs[0]).toBe("new_notification");
      expect(_mockToRoom).toBe("tenant_t-2");
    });

    it("should not fail when socket.io throws", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-throw", userId: "u-1" }),
      );
      // Force emit to throw
      mockSocket.emit.mockImplementation(() => {
        throw new Error("Socket not ready");
      });

      const result = await emitNotification({ title: "T", message: "M" });
      // emit is caught internally, returns transformed notification
      expect(result).toBeDefined();
      expect(result.id).toBe("n-throw");
    });

    it("should return null when Notification.create fails", async () => {
      Notification.create.mockRejectedValueOnce(new Error("DB down"));

      const result = await emitNotification({ title: "T", message: "M" });
      expect(result).toBeNull();
    });

    it("should dispatch the email channel when specified", async () => {
      const created = mockNotification({ id: "n-3", userId: "u-1" });
      Notification.create.mockResolvedValueOnce(created);

      await emitNotification({
        title: "Email test",
        message: "Test",
        userId: "u-1",
        channels: ["email"],
        recipientEmail: "test@example.com",
      });

      expect(notificationChannels.dispatch).toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Branch coverage: channel routing + recipient resolution
    // ------------------------------------------------------------------
    it("should strip channel-routing fields before persisting the row", async () => {
      // channels/recipientEmail/recipientName are not Notification columns —
      // passing them to create() would be a Sequelize error.
      Notification.create.mockResolvedValueOnce(mockNotification({ id: "n-strip" }));

      await emitNotification({
        title: "T",
        message: "M",
        userId: "u-1",
        channels: ["email"],
        recipientEmail: "a@b.com",
        recipientName: "Ann",
      });

      expect(Notification.create).toHaveBeenCalledWith({
        title: "T",
        message: "M",
        userId: "u-1",
      });
    });

    it("should not dispatch channels when DEFAULT_CHANNELS has no email", async () => {
      // DEFAULT_CHANNELS is ["realtime"] — realtime-only means no dispatch call.
      Notification.create.mockResolvedValueOnce(mockNotification({ id: "n-def" }));

      await emitNotification({ title: "T", message: "M", userId: "u-1" });

      expect(notificationChannels.dispatch).not.toHaveBeenCalled();
    });

    it("should resolve recipient contact details from the target user when not supplied", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-res", userId: "u-7" }),
      );
      User.findByPk.mockResolvedValueOnce({
        email: "looked-up@test.com",
        firstName: "Looked",
      });

      await emitNotification({
        title: "T",
        message: "M",
        userId: "u-7",
        channels: ["email"],
      });

      expect(User.findByPk).toHaveBeenCalledWith("u-7", {
        attributes: ["email", "firstName"],
      });
      expect(notificationChannels.dispatch).toHaveBeenCalledWith(
        expect.any(Object),
        {
          channels: ["email"],
          recipientEmail: "looked-up@test.com",
          recipientName: "Looked",
        },
      );
    });

    it("should prefer explicitly supplied recipient details over the user lookup", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-pref", userId: "u-7" }),
      );

      await emitNotification({
        title: "T",
        message: "M",
        userId: "u-7",
        channels: ["email"],
        recipientEmail: "explicit@test.com",
        recipientName: "Explicit",
      });

      // The email was supplied, so no user lookup is needed.
      expect(User.findByPk).not.toHaveBeenCalled();
      expect(notificationChannels.dispatch).toHaveBeenCalledWith(
        expect.any(Object),
        {
          channels: ["email"],
          recipientEmail: "explicit@test.com",
          recipientName: "Explicit",
        },
      );
    });

    it("should dispatch with undefined contact details when the target user no longer exists", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-nouser", userId: "gone" }),
      );
      User.findByPk.mockResolvedValueOnce(null);

      await emitNotification({
        title: "T",
        message: "M",
        userId: "gone",
        channels: ["email"],
      });

      expect(notificationChannels.dispatch).toHaveBeenCalledWith(
        expect.any(Object),
        {
          channels: ["email"],
          recipientEmail: undefined,
          recipientName: undefined,
        },
      );
    });

    it("should skip the user lookup for a tenant-wide notification with no userId", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-tenant", tenantId: "t-9" }),
      );

      await emitNotification({
        title: "T",
        message: "M",
        tenantId: "t-9",
        channels: ["email"],
        recipientEmail: "ops@test.com",
      });

      expect(User.findByPk).not.toHaveBeenCalled();
      expect(notificationChannels.dispatch).toHaveBeenCalled();
    });

    it("should swallow a channel dispatch failure and still return the notification", async () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-chfail", userId: "u-1" }),
      );
      notificationChannels.dispatch.mockRejectedValueOnce(new Error("SMTP down"));

      const result = await emitNotification({
        title: "T",
        message: "M",
        userId: "u-1",
        channels: ["email"],
        recipientEmail: "a@b.com",
      });

      // Dispatch failures must never block the caller's main flow.
      expect(result).not.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "Notification channel dispatch failed:",
        "SMTP down",
      );
      warnSpy.mockRestore();
    });

    it("does not emit when the notification has neither userId nor tenantId", async () => {
      Notification.create.mockResolvedValueOnce(mockNotification({ id: "n-global" }));

      const result = await emitNotification({ title: "T", message: "M" });

      // There is no recipient room to target. The row is still persisted, but
      // nothing is pushed — notably NOT to a global "super_admins" room, which
      // used to give super admins a phantom unread badge for other people's
      // notifications.
      expect(mockSocket.to).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it("emits only to the addressed user, never to super_admins", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-1", userId: "u-9" }),
      );

      await emitNotification({ userId: "u-9", tenantId: "t-1", title: "T", message: "M" });

      expect(mockSocket.to).toHaveBeenCalledTimes(1);
      expect(mockSocket.to).toHaveBeenCalledWith("user_u-9");
      expect(mockSocket.to).not.toHaveBeenCalledWith("super_admins");
    });

    it("emits to the tenant room for tenant-wide notifications", async () => {
      Notification.create.mockResolvedValueOnce(
        mockNotification({ id: "n-2", userId: null }),
      );

      await emitNotification({ tenantId: "t-7", title: "T", message: "M" });

      expect(mockSocket.to).toHaveBeenCalledTimes(1);
      expect(mockSocket.to).toHaveBeenCalledWith("tenant_t-7");
    });
  });

  // ================================================================
  describe("fetchUserNotifications", () => {
    it("should fetch notifications with pagination for a user", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [mockNotification()],
        count: 1,
      });
      Notification.count.mockResolvedValueOnce(0);

      const result = await fetchUserNotifications({
        tenantId: "t-1",
        userId: "u-1",
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.meta.total).toBe(1);
      expect(result.data.meta.unread).toBe(0);
      expect(result.data.meta.page).toBe(1);
    });

    it("stays recipient-scoped even for a super admin", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      Notification.count.mockResolvedValueOnce(0);

      await fetchUserNotifications({
        tenantId: "t-1",
        userId: "u-1",
        // Historically a super admin got `where: {}` (every notification in
        // every tenant). That leaked other users' notifications into their
        // bell and 404'd on mark-as-read, since the mutations are recipient
        // scoped. The feed must always filter by tenant + recipient.
        isSuperAdmin: true,
      });

      expect(Notification.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: "t-1" }),
        }),
      );
      const { where } = Notification.findAndCountAll.mock.calls[0][0];
      expect(where).not.toEqual({});
      // The Op.or recipient filter must be present.
      expect(Object.getOwnPropertySymbols(where).length).toBeGreaterThan(0);
    });

    it("should filter by isRead", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      Notification.count.mockResolvedValueOnce(0);

      await fetchUserNotifications({
        tenantId: "t-1",
        userId: "u-1",
        isRead: true,
      });

      expect(Notification.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ "$states.is_read$": true }),
        }),
      );
    });

    it("should filter by type", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      Notification.count.mockResolvedValueOnce(0);

      await fetchUserNotifications({
        tenantId: "t-1",
        userId: "u-1",
        type: "alert",
      });

      expect(Notification.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "alert" }),
        }),
      );
    });

    it("should use safeLimit with MAX_LIMIT cap", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      Notification.count.mockResolvedValueOnce(0);

      await fetchUserNotifications({
        tenantId: "t-1",
        userId: "u-1",
        limit: 9999,
      });

      const callArgs = Notification.findAndCountAll.mock.calls[0][0];
      expect(callArgs.limit).toBe(200); // MAX_LIMIT default
    });

    it("should propagate error on failure", async () => {
      Notification.findAndCountAll.mockRejectedValueOnce(new Error("DB failure"));
      await expectRejectsWithMessage(
        fetchUserNotifications({ tenantId: "t-1", userId: "u-1" }),
        "DB failure",
      );
    });
  });

  // ================================================================
  describe("markAsRead", () => {
    it("upserts the caller's own state row instead of mutating the shared row", async () => {
      const notif = mockNotification({ id: "n-read", isRead: false });
      notif.update = jest.fn().mockResolvedValue({});
      Notification.findOne.mockResolvedValueOnce(notif);

      const result = await markAsRead("t-1", "u-1", "n-read");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      // Writing isRead on a tenant-wide Notification row would mark it read for
      // every recipient — the state row is per user.
      expect(notif.update).not.toHaveBeenCalled();
      expect(NotificationState.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { notificationId: "n-read", userId: "u-1" },
          defaults: expect.objectContaining({
            notificationId: "n-read",
            userId: "u-1",
            isRead: true,
            readAt: expect.any(Date),
          }),
        }),
      );
      // The response is forced read regardless of the shared row's column.
      expect(result.data.isRead).toBe(true);
    });

    it("updates an existing state row when findOrCreate did not create one", async () => {
      const state = mockStateRow({ notificationId: "n-read" });
      NotificationState.findOrCreate.mockResolvedValueOnce([state, false]);
      Notification.findOne.mockResolvedValueOnce(
        mockNotification({ id: "n-read" }),
      );

      await markAsRead("t-1", "u-1", "n-read");

      expect(state.update).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
      );
    });

    it("does not update the state row when findOrCreate created it", async () => {
      const state = mockStateRow({ notificationId: "n-read" });
      NotificationState.findOrCreate.mockResolvedValueOnce([state, true]);
      Notification.findOne.mockResolvedValueOnce(
        mockNotification({ id: "n-read" }),
      );

      await markAsRead("t-1", "u-1", "n-read");

      expect(state.update).not.toHaveBeenCalled();
    });

    it("should throw 404 when notification not found", async () => {
      Notification.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        markAsRead("t-1", "u-1", "missing"),
        "Notification not found",
      );
      expect(NotificationState.findOrCreate).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("markAllAsRead", () => {
    it("creates state rows for every visible notification the user has not touched", async () => {
      Notification.findAll.mockResolvedValueOnce([{ id: "n-1" }, { id: "n-2" }]);
      NotificationState.findAll.mockResolvedValueOnce([]);

      const result = await markAllAsRead("t-1", "u-1");

      expect(result.success).toBe(true);
      // Scope must be the same recipient scope the feed uses.
      const { where } = Notification.findAll.mock.calls[0][0];
      expect(where).toEqual(expect.objectContaining({ tenantId: "t-1" }));
      expect(Object.getOwnPropertySymbols(where).length).toBeGreaterThan(0);
      // No state rows existed => everything is bulk-created, nothing updated.
      expect(NotificationState.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({ notificationId: "n-1", userId: "u-1", isRead: true }),
          expect.objectContaining({ notificationId: "n-2", userId: "u-1", isRead: true }),
        ],
        { ignoreDuplicates: true },
      );
      expect(NotificationState.update).not.toHaveBeenCalled();
      // The shared rows themselves are never written.
      expect(Notification.update).not.toHaveBeenCalled();
    });

    it("updates existing state rows and creates only the missing ones", async () => {
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-1" },
        { id: "n-2" },
        { id: "n-3" },
      ]);
      NotificationState.findAll.mockResolvedValueOnce([
        { notificationId: "n-2" },
      ]);

      await markAllAsRead("t-1", "u-1");

      expect(NotificationState.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({ notificationId: "n-1" }),
          expect.objectContaining({ notificationId: "n-3" }),
        ],
        { ignoreDuplicates: true },
      );
      expect(NotificationState.update).toHaveBeenCalledWith(
        expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
        expect.objectContaining({
          where: expect.objectContaining({ userId: "u-1" }),
        }),
      );
    });

    it("only updates when every visible notification already has a state row", async () => {
      Notification.findAll.mockResolvedValueOnce([{ id: "n-1" }, { id: "n-2" }]);
      NotificationState.findAll.mockResolvedValueOnce([
        { notificationId: "n-1" },
        { notificationId: "n-2" },
      ]);

      await markAllAsRead("t-1", "u-1");

      expect(NotificationState.bulkCreate).not.toHaveBeenCalled();
      expect(NotificationState.update).toHaveBeenCalledTimes(1);
    });

    it("writes nothing when the user has no visible notifications", async () => {
      Notification.findAll.mockResolvedValueOnce([]);

      const result = await markAllAsRead("t-1", "u-1");

      expect(result.success).toBe(true);
      expect(NotificationState.findAll).not.toHaveBeenCalled();
      expect(NotificationState.bulkCreate).not.toHaveBeenCalled();
      expect(NotificationState.update).not.toHaveBeenCalled();
    });

    it("should throw on database error", async () => {
      Notification.findAll.mockRejectedValueOnce(new Error("Update failed"));
      await expectRejectsWithMessage(
        markAllAsRead("t-1", "u-1"),
        "Update failed",
      );
    });
  });

  // ================================================================
  describe("deleteNotification", () => {
    it("hard-deletes a notification addressed to the caller personally", async () => {
      const notif = mockNotification({ id: "n-del", userId: "u-1" });
      Notification.findOne.mockResolvedValueOnce(notif);

      const result = await deleteNotification("t-1", "u-1", "n-del");

      expect(result.success).toBe(true);
      // Nobody else can see a personal row, so it is removed outright.
      expect(Notification.destroy).toHaveBeenCalledTimes(1);
      const { where } = Notification.destroy.mock.calls[0][0];
      expect(where.id).toBeDefined();
      // No per-user hide needed.
      expect(NotificationState.bulkCreate).not.toHaveBeenCalled();
      expect(NotificationState.update).not.toHaveBeenCalled();
    });

    it("only hides a tenant-wide notification for the caller", async () => {
      const notif = mockNotification({ id: "n-shared", userId: null });
      Notification.findOne.mockResolvedValueOnce(notif);

      const result = await deleteNotification("t-1", "u-1", "n-shared");

      expect(result.success).toBe(true);
      // Destroying a shared row would delete it for every other recipient.
      expect(Notification.destroy).not.toHaveBeenCalled();
      expect(NotificationState.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            notificationId: "n-shared",
            userId: "u-1",
            deletedAt: expect.any(Date),
          }),
        ],
        { ignoreDuplicates: true },
      );
    });

    it("should throw 404 when notification not found", async () => {
      Notification.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        deleteNotification("t-1", "u-1", "missing"),
        "Notification not found",
      );
    });

    it("should throw on database error", async () => {
      Notification.findOne.mockRejectedValueOnce(new Error("Delete failed"));
      await expectRejectsWithMessage(
        deleteNotification("t-1", "u-1", "n-1"),
        "Delete failed",
      );
    });
  });

  describe("deleteAllNotifications", () => {
    it("removes every notification in the caller's scope", async () => {
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-1", userId: "u-1" },
        { id: "n-2", userId: "u-1" },
        { id: "n-3", userId: null },
        { id: "n-4", userId: null },
      ]);

      const result = await deleteAllNotifications("t-1", "u-1");

      expect(result.status).toBe(200);
      expect(result.data.deleted).toBe(4);
      expect(result.message).toBe("4 notifications deleted");
      // Must be scoped — never a bare sweep across the table.
      const { where } = Notification.findAll.mock.calls[0][0];
      expect(where).toEqual(expect.objectContaining({ tenantId: "t-1" }));
      expect(Object.getOwnPropertySymbols(where).length).toBeGreaterThan(0);
      // Mixed batch: personals destroyed, shared ones hidden per user.
      expect(Notification.destroy).toHaveBeenCalledTimes(1);
      expect(NotificationState.bulkCreate).toHaveBeenCalledTimes(1);
    });

    it("destroys personal rows and writes no state when nothing is shared", async () => {
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-1", userId: "u-1" },
        { id: "n-2", userId: "u-1" },
      ]);

      const result = await deleteAllNotifications("t-1", "u-1");

      expect(result.data.deleted).toBe(2);
      expect(Notification.destroy).toHaveBeenCalledTimes(1);
      expect(NotificationState.findAll).not.toHaveBeenCalled();
      expect(NotificationState.bulkCreate).not.toHaveBeenCalled();
      expect(NotificationState.update).not.toHaveBeenCalled();
    });

    it("hides shared rows without destroying anything", async () => {
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-3", userId: null },
        { id: "n-4", userId: null },
      ]);
      // n-4 was already interacted with, so it is updated rather than created.
      NotificationState.findAll.mockResolvedValueOnce([
        { notificationId: "n-4" },
      ]);

      const result = await deleteAllNotifications("t-1", "u-1");

      expect(result.data.deleted).toBe(2);
      expect(Notification.destroy).not.toHaveBeenCalled();
      expect(NotificationState.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            notificationId: "n-3",
            deletedAt: expect.any(Date),
          }),
        ],
        { ignoreDuplicates: true },
      );
      expect(NotificationState.update).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) }),
        expect.objectContaining({
          where: expect.objectContaining({ userId: "u-1" }),
        }),
      );
    });

    it("ignores rows addressed to a different user", async () => {
      // Defensive: such a row cannot match the scoped query, and it is neither
      // destroyed nor hidden if it somehow appears.
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-other", userId: "u-2" },
      ]);

      const result = await deleteAllNotifications("t-1", "u-1");

      expect(result.data.deleted).toBe(0);
      expect(Notification.destroy).not.toHaveBeenCalled();
      expect(NotificationState.bulkCreate).not.toHaveBeenCalled();
    });

    it("uses the singular message for exactly one row", async () => {
      Notification.findAll.mockResolvedValueOnce([{ id: "n-1", userId: "u-1" }]);
      const result = await deleteAllNotifications("t-1", "u-1");
      expect(result.message).toBe("1 notification deleted");
    });

    it("reports zero when there is nothing to delete", async () => {
      Notification.findAll.mockResolvedValueOnce([]);
      const result = await deleteAllNotifications("t-1", "u-1");
      expect(result.data.deleted).toBe(0);
      expect(result.message).toBe("0 notifications deleted");
    });

    it("propagates database errors", async () => {
      Notification.findAll.mockRejectedValueOnce(new Error("boom"));
      await expectRejectsWithMessage(
        deleteAllNotifications("t-1", "u-1"),
        "boom",
      );
    });

    it("defaults to 500 and its own message when the error carries neither", async () => {
      Notification.findAll.mockRejectedValueOnce({});
      const err = await deleteAllNotifications("t-1", "u-1").catch((e) => e);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Failed to delete notifications");
    });
  });

  describe("deleteManyNotifications", () => {
    it("removes only the ids within the caller's scope", async () => {
      Notification.findAll.mockResolvedValueOnce([
        { id: "n-1", userId: "u-1" },
        { id: "n-2", userId: null },
      ]);

      const result = await deleteManyNotifications("t-1", "u-1", [
        "n-1",
        "n-2",
      ]);

      expect(result.data).toEqual({ deleted: 2, requested: 2 });
      const { where } = Notification.findAll.mock.calls[0][0];
      expect(where.tenantId).toBe("t-1");
      expect(where.id).toBeDefined();
      expect(Notification.destroy).toHaveBeenCalledTimes(1);
      expect(NotificationState.bulkCreate).toHaveBeenCalledTimes(1);
    });

    it("reports a partial match via requested vs deleted", async () => {
      // One id belonged to somebody else, so it simply never matched.
      Notification.findAll.mockResolvedValueOnce([{ id: "mine", userId: "u-1" }]);

      const result = await deleteManyNotifications("t-1", "u-1", [
        "mine",
        "someone-elses",
      ]);

      expect(result.data).toEqual({ deleted: 1, requested: 2 });
      expect(result.message).toBe("1 notification deleted");
    });

    it("rejects an empty id list with 400", async () => {
      await expectRejectsWithMessage(
        deleteManyNotifications("t-1", "u-1", []),
        "No notification ids provided",
      );
      expect(Notification.findAll).not.toHaveBeenCalled();
      expect(Notification.destroy).not.toHaveBeenCalled();
    });

    it("rejects a non-array payload with 400", async () => {
      await expectRejectsWithMessage(
        deleteManyNotifications("t-1", "u-1", undefined),
        "No notification ids provided",
      );
    });

    it("returns 404 when none of the ids matched", async () => {
      Notification.findAll.mockResolvedValueOnce([]);
      await expectRejectsWithMessage(
        deleteManyNotifications("t-1", "u-1", ["nope"]),
        "No matching notifications found",
      );
      expect(Notification.destroy).not.toHaveBeenCalled();
    });

    it("propagates database errors", async () => {
      Notification.findAll.mockRejectedValueOnce(new Error("kaboom"));
      await expectRejectsWithMessage(
        deleteManyNotifications("t-1", "u-1", ["n-1"]),
        "kaboom",
      );
    });

    it("defaults to 500 and its own message when the error carries neither", async () => {
      Notification.findAll.mockRejectedValueOnce({});
      const err = await deleteManyNotifications("t-1", "u-1", ["n-1"]).catch(
        (e) => e,
      );
      expect(err.status).toBe(500);
      expect(err.message).toBe("Failed to delete notifications");
    });
  });

  // ================================================================
  // Branch coverage: transform helpers, isRead coercion, error fallbacks
  // ================================================================
  describe("transform helpers (via fetchUserNotifications)", () => {
    beforeEach(() => {
      Notification.count.mockResolvedValue(0);
    });

    it("should map a plain (non-Sequelize) row by spreading it when toJSON is absent", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "plain-1", title: "Plain" }],
        count: 1,
      });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows).toEqual([{ id: "plain-1", title: "Plain" }]);
    });

    it("should map a null row to null rather than throwing", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [null], count: 1 });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows).toEqual([null]);
    });

    it("should return an empty rows array when the model returns undefined rows", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: undefined, count: 0 });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows).toEqual([]);
    });

    it("should fall back to DEFAULT_LIMIT when limit is not numeric", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1", limit: "not-a-number" });

      expect(Notification.findAndCountAll.mock.calls[0][0].limit).toBe(25); // DEFAULT_LIMIT
    });

    it("should coerce a boolean isRead=false into the state where clause", async () => {
      // `isRead !== undefined` guards the filter, so a literal false must apply.
      // "Unread" must also match a NULL join — no state row means unread.
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1", isRead: false });

      const filter =
        Notification.findAndCountAll.mock.calls[0][0].where["$states.is_read$"];
      expect(filter).toEqual({ [Op.or]: [false, null] });
    });

    it("should coerce the string \"false\" into a boolean false", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1", isRead: "false" });

      const filter =
        Notification.findAndCountAll.mock.calls[0][0].where["$states.is_read$"];
      expect(filter).toEqual({ [Op.or]: [false, null] });
    });

    it("should coerce the string \"true\" into the state where clause", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1", isRead: "true" });

      expect(
        Notification.findAndCountAll.mock.calls[0][0].where["$states.is_read$"],
      ).toBe(true);
    });

    it("should coerce a boolean isRead=true into the state where clause", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1", isRead: true });

      expect(
        Notification.findAndCountAll.mock.calls[0][0].where["$states.is_read$"],
      ).toBe(true);
    });

    it("always excludes rows this user has hidden, and joins their state only", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      const args = Notification.findAndCountAll.mock.calls[0][0];
      expect(args.where["$states.deleted_at$"]).toBeNull();
      // subQuery:false is required for a WHERE on an included column to work
      // alongside limit/offset.
      expect(args.subQuery).toBe(false);
      expect(args.distinct).toBe(true);
      expect(args.include[0]).toEqual(
        expect.objectContaining({ as: "states", required: false, where: { userId: "u-1" } }),
      );
      // The unread count must apply the same join, else it counts hidden rows.
      expect(Notification.count).toHaveBeenCalledWith(
        expect.objectContaining({ subQuery: false, distinct: true }),
      );
    });

    it("collapses the state join into a flat isRead/readAt and strips it", async () => {
      const readAt = new Date("2026-01-01T00:00:00Z");
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [
          {
            toJSON: () => ({
              id: "n-1",
              states: [{ isRead: true, readAt, deletedAt: null }],
            }),
          },
        ],
        count: 1,
      });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows[0]).toEqual({ id: "n-1", isRead: true, readAt });
      // The join array is internal and must not leak to clients.
      expect(result.data.rows[0]).not.toHaveProperty("states");
    });

    it("treats an empty state array as unread", async () => {
      // No state row for this user = unread + visible.
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [{ toJSON: () => ({ id: "n-2", states: [] }) }],
        count: 1,
      });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows[0]).toEqual({ id: "n-2", isRead: false, readAt: null });
    });

    it("treats a non-array states value as unread", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [{ toJSON: () => ({ id: "n-3", states: null }) }],
        count: 1,
      });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows[0]).toEqual({ id: "n-3", isRead: false, readAt: null });
    });

    it("leaves a row without a states property untouched", async () => {
      Notification.findAndCountAll.mockResolvedValueOnce({
        rows: [{ toJSON: () => ({ id: "n-4", title: "No join" }) }],
        count: 1,
      });

      const result = await fetchUserNotifications({ tenantId: "t-1", userId: "u-1" });

      expect(result.data.rows[0]).toEqual({ id: "n-4", title: "No join" });
    });
  });

  describe("error normalisation fallbacks", () => {
    // fetch/markAsRead/markAllAsRead/deleteNotification funnel failures through
    // `{ status: error.status || 500, message: error.message || "<default>" }`.
    // (emitNotification deliberately swallows and returns null instead.)
    const cases = [
      ["fetchUserNotifications", () => fetchUserNotifications({ tenantId: "t-1", userId: "u-1" }), "findAndCountAll", "Failed to fetch notifications"],
      ["markAsRead", () => markAsRead("t-1", "u-1", "n-1"), "findOne", "Failed to mark notification as read"],
      ["markAllAsRead", () => markAllAsRead("t-1", "u-1"), "findAll", "Failed to mark all notifications as read"],
      ["deleteNotification", () => deleteNotification("t-1", "u-1", "n-1"), "findOne", "Failed to delete notification"],
    ];

    // These now reject with a real AppError (not a bare object literal), so the
    // global handler gets a usable stack — previously `details` in the HTTP
    // response rendered as the useless string "[object Object]".
    const expectAppError = async (invoke, status, message) => {
      const err = await invoke().then(
        () => {
          throw new Error("expected the call to reject");
        },
        (e) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(status);
      expect(err.message).toBe(message);
      expect(err.stack).toBeDefined();
      return err;
    };

    it.each(cases)(
      "%s should default to status 500 and its own message when the error carries neither",
      async (_name, invoke, mockFn, defaultMessage) => {
        Notification[mockFn].mockRejectedValueOnce({});

        await expectAppError(invoke, 500, defaultMessage);
      },
    );

    it.each(cases)(
      "%s should preserve a status carried on the thrown error",
      async (_name, invoke, mockFn) => {
        Notification[mockFn].mockRejectedValueOnce({ status: 409, message: "Conflict" });

        await expectAppError(invoke, 409, "Conflict");
      },
    );

    it("markAsRead should surface the 404 AppError status, not a generic 500", async () => {
      Notification.findOne.mockResolvedValueOnce(null);

      await expectAppError(
        () => markAsRead("t-1", "u-1", "missing"),
        404,
        "Notification not found",
      );
    });
  });
});
