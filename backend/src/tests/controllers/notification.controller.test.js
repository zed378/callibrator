/**
 * Tests for notification controller
 */

jest.mock("../../services/notification.service", () => ({
  fetchUserNotifications: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
  deleteAllNotifications: jest.fn(),
  deleteManyNotifications: jest.fn(),
  emitNotification: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const notificationService = require("../../services/notification.service");
const notificationController = require("../../controllers/notification.controller");
const { success } = require("../../utils/response.util");

describe("notification Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        tenantId: "550e8400-e29b-41d4-a716-446655440001",
        role: { name: "USER" },
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("fetchUserNotifications", () => {
    it("should return paginated notifications", async () => {
      req.query = { page: "1", limit: "10" };
      notificationService.fetchUserNotifications.mockResolvedValue({
        data: {
          rows: [{ id: "notif-1", message: "Test" }],
          meta: { total: 1 },
        },
        message: "Notifications fetched",
        status: 200,
      });

      await notificationController.fetchUserNotifications(req, res, next);

      expect(notificationService.fetchUserNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "550e8400-e29b-41d4-a716-446655440001",
          userId: "550e8400-e29b-41d4-a716-446655440000",
          page: "1",
          limit: "10",
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    // The feed is a personal inbox — a SUPER_ADMIN role must NOT widen it.
    // It previously did, which surfaced other users' notifications and then
    // 404'd on mark-as-read (the mutations are recipient scoped).
    it.each(["SUPER_ADMIN", "SUPERADMIN"])(
      "does not widen the feed for the %s role",
      async (roleName) => {
        req.query = { page: "1", limit: "10" };
        req.user.role.name = roleName;
        notificationService.fetchUserNotifications.mockResolvedValue({
          data: { rows: [], meta: { total: 0 } },
        });

        await notificationController.fetchUserNotifications(req, res, next);

        const args =
          notificationService.fetchUserNotifications.mock.calls[0][0];
        expect(args).not.toHaveProperty("isSuperAdmin");
        expect(args.tenantId).toBe("550e8400-e29b-41d4-a716-446655440001");
        expect(args.userId).toBe("550e8400-e29b-41d4-a716-446655440000");
      },
    );

    it("should filter by isRead", async () => {
      req.query = { page: "1", limit: "10", isRead: "true" };
      notificationService.fetchUserNotifications.mockResolvedValue({
        data: { rows: [], meta: { total: 0 } },
      });

      await notificationController.fetchUserNotifications(req, res, next);

      expect(notificationService.fetchUserNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          isRead: "true",
        }),
      );
    });

    it("should filter by type", async () => {
      req.query = { page: "1", limit: "10", type: "ORDER" };
      notificationService.fetchUserNotifications.mockResolvedValue({
        data: { rows: [], meta: { total: 0 } },
      });

      await notificationController.fetchUserNotifications(req, res, next);

      expect(notificationService.fetchUserNotifications).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ORDER",
        }),
      );
    });
  });

  describe("markAsRead", () => {
    it("should mark notification as read", async () => {
      req.params = { notificationId: "notif-1" };
      notificationService.markAsRead.mockResolvedValue({
        data: { id: "notif-1", isRead: true },
        message: "Notification marked as read",
        status: 200,
      });

      await notificationController.markAsRead(req, res, next);

      expect(notificationService.markAsRead).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440000",
        "notif-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all notifications as read", async () => {
      notificationService.markAllAsRead.mockResolvedValue({
        message: "All notifications marked as read",
        status: 200,
      });

      await notificationController.markAllAsRead(req, res, next);

      expect(notificationService.markAllAsRead).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteNotification", () => {
    it("should delete a notification", async () => {
      req.params = { notificationId: "notif-1" };
      notificationService.deleteNotification.mockResolvedValue({
        message: "Notification deleted",
        status: 200,
      });

      await notificationController.deleteNotification(req, res, next);

      expect(notificationService.deleteNotification).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440000",
        "notif-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteAllNotifications", () => {
    it("deletes everything in the caller's scope", async () => {
      notificationService.deleteAllNotifications.mockResolvedValue({
        data: { deleted: 3 },
        message: "3 notifications deleted",
        status: 200,
      });

      await notificationController.deleteAllNotifications(req, res, next);

      expect(notificationService.deleteAllNotifications).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteManyNotifications", () => {
    it("forwards the selected ids", async () => {
      req.body = { ids: ["n-1", "n-2"] };
      notificationService.deleteManyNotifications.mockResolvedValue({
        data: { deleted: 2, requested: 2 },
        message: "2 notifications deleted",
        status: 200,
      });

      await notificationController.deleteManyNotifications(req, res, next);

      expect(notificationService.deleteManyNotifications).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440001",
        "550e8400-e29b-41d4-a716-446655440000",
        ["n-1", "n-2"],
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("sendTestNotification", () => {
    it("should emit a test notification (user scope)", async () => {
      req.body = {
        title: "Test",
        message: "Test message",
        type: "SYSTEM",
      };
      notificationService.emitNotification.mockResolvedValue({
        id: "notif-new",
        title: "Test",
      });

      await notificationController.sendTestNotification(req, res, next);

      expect(notificationService.emitNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "550e8400-e29b-41d4-a716-446655440001",
          userId: "550e8400-e29b-41d4-a716-446655440000",
          type: "SYSTEM",
          title: "Test",
          message: "Test message",
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should emit a test notification (tenant scope)", async () => {
      req.body = {
        scope: "tenant",
        title: "Tenant Alert",
        message: "Tenant-wide message",
        type: "ALERT",
      };
      notificationService.emitNotification.mockResolvedValue({
        id: "notif-new",
        title: "Tenant Alert",
      });

      await notificationController.sendTestNotification(req, res, next);

      expect(notificationService.emitNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "550e8400-e29b-41d4-a716-446655440001",
          userId: null,
          type: "ALERT",
          title: "Tenant Alert",
          message: "Tenant-wide message",
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should use defaults when body is empty", async () => {
      req.body = {};
      notificationService.emitNotification.mockResolvedValue({
        id: "notif-new",
      });

      await notificationController.sendTestNotification(req, res, next);

      expect(notificationService.emitNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SYSTEM",
          title: expect.stringContaining("Test notification"),
        }),
      );
    });

    it("should use defaults when body is undefined", async () => {
      req.body = undefined;
      notificationService.emitNotification.mockResolvedValue({
        id: "notif-new",
      });

      await notificationController.sendTestNotification(req, res, next);

      expect(notificationService.emitNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "SYSTEM",
        }),
      );
    });
  });
});
