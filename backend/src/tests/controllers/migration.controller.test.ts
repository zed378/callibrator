/**
 * Tests for migration controller
 */
import type { Request, Response } from "express";

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

interface MigrateDouble {
  Up: jest.Mock;
  Down: jest.Mock;
}

interface MigrationServiceDouble {
  seedAll: jest.Mock;
  unseedAll: jest.Mock;
  seedDemoData: jest.Mock;
}

interface ResponseDouble {
  success: jest.Mock;
}

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<unknown>;

interface FakeRes {
  status: (code: number) => FakeRes;
  json: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { Up, Down } = require("../../config/migrate") as MigrateDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const migrationService = require("../../services/migration.service") as MigrationServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const migrationController = require("../../controllers/migration.controller") as {
  migrate: Handler;
  dropTable: Handler;
  seeding: Handler;
  unseeding: Handler;
  seedDemo: Handler;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseDouble;

describe("migration Controller", () => {
  let req: Record<string, unknown>;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((response: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      response.status(status ?? 200).json({ success: true, data, message });
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

      await migrationController.migrate(req as unknown as Request, res as unknown as Response, next);

      expect(Up).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle Up() rejection", async () => {
      Up.mockRejectedValue(new Error("Sync failed"));

      await migrationController.migrate(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      expect((next.mock.calls[0] as unknown[])[0] as { status: number }).toHaveProperty("status", 500);
    });
  });

  describe("dropTable", () => {
    it("should run Down() drop and respond success", async () => {
      Down.mockResolvedValue(undefined);

      await migrationController.dropTable(req as unknown as Request, res as unknown as Response, next);

      expect(Down).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle Down() rejection", async () => {
      Down.mockRejectedValue(new Error("Drop failed"));

      await migrationController.dropTable(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      expect((next.mock.calls[0] as unknown[])[0] as { status: number }).toHaveProperty("status", 500);
    });
  });

  describe("seeding", () => {
    it("should call migrationService.seedAll and respond", async () => {
      migrationService.seedAll.mockResolvedValue({
        rolesCreated: 4,
        usersCreated: 1,
      });

      await migrationController.seeding(req as unknown as Request, res as unknown as Response, next);

      expect(migrationService.seedAll).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle seedAll rejection", async () => {
      migrationService.seedAll.mockRejectedValue(new Error("Seed failed"));

      await migrationController.seeding(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      expect((next.mock.calls[0] as unknown[])[0] as { status: number }).toHaveProperty("status", 500);
    });
  });

  describe("unseeding", () => {
    it("should call migrationService.unseedAll and respond", async () => {
      migrationService.unseedAll.mockResolvedValue({
        rolesDeleted: 4,
        usersDeleted: 1,
      });

      await migrationController.unseeding(req as unknown as Request, res as unknown as Response, next);

      expect(migrationService.unseedAll).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle unseedAll rejection", async () => {
      migrationService.unseedAll.mockRejectedValue(new Error("Unseed failed"));

      await migrationController.unseeding(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      expect((next.mock.calls[0] as unknown[])[0] as { status: number }).toHaveProperty("status", 500);
    });
  });

  describe("seedDemo", () => {
    it("should call migrationService.seedDemoData and respond", async () => {
      migrationService.seedDemoData.mockResolvedValue({
        success: true,
      });

      await migrationController.seedDemo(req as unknown as Request, res as unknown as Response, next);

      expect(migrationService.seedDemoData).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle seedDemoData rejection", async () => {
      migrationService.seedDemoData.mockRejectedValue(new Error("Seed demo failed"));

      await migrationController.seedDemo(req as unknown as Request, res as unknown as Response, next);

      expect(next).toHaveBeenCalled();
      expect((next.mock.calls[0] as unknown[])[0] as { status: number }).toHaveProperty("status", 500);
    });
  });
});
