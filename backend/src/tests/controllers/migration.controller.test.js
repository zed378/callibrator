/**
 * Tests for migration controller
 */

jest.mock("../../config/migrate", () => ({
  Up: jest.fn(),
  Down: jest.fn(),
}));

jest.mock("../../services/migration.service", () => ({
  seedAll: jest.fn(),
  unseedAll: jest.fn(),
  seedDemoData: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const { Up, Down } = require("../../config/migrate");
const migrationService = require("../../services/migration.service");
const migrationController = require("../../controllers/migration.controller");
const { success } = require("../../utils/response.util");

describe("migration Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = { user: { id: "user-1", tenantId: "tenant-1" } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("migrate", () => {
    it("should run Up() migration and respond success", async () => {
      Up.mockResolvedValue(undefined);

      await migrationController.migrate(req, res, next);

      expect(Up).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle Up() rejection", async () => {
      Up.mockRejectedValue(new Error("Sync failed"));

      await migrationController.migrate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(500);
    });
  });

  describe("dropTable", () => {
    it("should run Down() drop and respond success", async () => {
      Down.mockResolvedValue(undefined);

      await migrationController.dropTable(req, res, next);

      expect(Down).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle Down() rejection", async () => {
      Down.mockRejectedValue(new Error("Drop failed"));

      await migrationController.dropTable(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(500);
    });
  });

  describe("seeding", () => {
    it("should call migrationService.seedAll and respond", async () => {
      migrationService.seedAll.mockResolvedValue({
        rolesCreated: 4,
        usersCreated: 1,
      });

      await migrationController.seeding(req, res, next);

      expect(migrationService.seedAll).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle seedAll rejection", async () => {
      migrationService.seedAll.mockRejectedValue(new Error("Seed failed"));

      await migrationController.seeding(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(500);
    });
  });

  describe("unseeding", () => {
    it("should call migrationService.unseedAll and respond", async () => {
      migrationService.unseedAll.mockResolvedValue({
        rolesDeleted: 4,
        usersDeleted: 1,
      });

      await migrationController.unseeding(req, res, next);

      expect(migrationService.unseedAll).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle unseedAll rejection", async () => {
      migrationService.unseedAll.mockRejectedValue(new Error("Unseed failed"));

      await migrationController.unseeding(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(500);
    });
  });

  describe("seedDemo", () => {
    it("should call migrationService.seedDemoData and respond", async () => {
      migrationService.seedDemoData.mockResolvedValue({
        success: true,
      });

      await migrationController.seedDemo(req, res, next);

      expect(migrationService.seedDemoData).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle seedDemoData rejection", async () => {
      migrationService.seedDemoData.mockRejectedValue(new Error("Seed demo failed"));

      await migrationController.seedDemo(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(next.mock.calls[0][0].status).toBe(500);
    });
  });
});
