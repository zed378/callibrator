/**
 * Tests for tenantBackup controller
 */
import type { Request, Response, NextFunction } from "express";
import type * as fsTypes from "fs";

jest.mock("../../services/tenantBackup.service", () => ({
  createBackup: jest.fn(),
  downloadBackup: jest.fn(),
  restoreBackup: jest.fn(),
  deleteBackup: jest.fn(),
  getBackupStats: jest.fn(),
}));

jest.mock("../../models", () => ({
  TenantBackup: {
    getTenantBackups: jest.fn(),
    findByPk: jest.fn(),
    BACKUP_TYPES: { FULL: "FULL", USER_ONLY: "USER_ONLY" },
    STATUS: {
      IN_PROGRESS: "IN_PROGRESS",
      COMPLETED: "COMPLETED",
      FAILED: "FAILED",
      RESTORING: "RESTORING",
      RESTORED: "RESTORED",
      DELETING: "DELETING",
    },
    createBackup: jest.fn(),
    updateStatus: jest.fn(),
    count: jest.fn(),
    hasValidBackups: jest.fn(),
    getLatestBackup: jest.fn(),
  },
  Users: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
  Tenants: {
    findByPk: jest.fn(),
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

// downloadBackup falls back to fs.statSync(filePath).size when the backup
// metadata carries no fileSize. Only statSync is stubbed.
jest.mock("fs", () => ({
  ...jest.requireActual<typeof fsTypes>("fs"),
  statSync: jest.fn(),
}));

interface FsDouble {
  statSync: jest.Mock;
}

interface TenantBackupServiceDouble {
  createBackup: jest.Mock;
  downloadBackup: jest.Mock;
  restoreBackup: jest.Mock;
  deleteBackup: jest.Mock;
  getBackupStats: jest.Mock;
}

interface TenantBackupModelDouble {
  getTenantBackups: jest.Mock;
  findByPk: jest.Mock;
  BACKUP_TYPES: { FULL: string; USER_ONLY: string };
  STATUS: Record<string, string>;
  createBackup: jest.Mock;
  updateStatus: jest.Mock;
  count: jest.Mock;
  hasValidBackups: jest.Mock;
  getLatestBackup: jest.Mock;
}

interface ModelsDouble {
  TenantBackup: TenantBackupModelDouble;
  Users: { findByPk: jest.Mock; findAll: jest.Mock };
  Tenants: { findByPk: jest.Mock };
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

interface TenantBackupControllerDouble {
  createBackup: Handler;
  getBackups: Handler;
  getBackup: Handler;
  downloadBackup: Handler;
  restoreBackup: Handler;
  deleteBackup: Handler;
  getBackupStats: Handler;
}

interface FakeRes {
  status: ((code: number) => FakeRes) & jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  download: jest.Mock;
}

interface MockReq {
  params: Record<string, string | undefined>;
  body: Record<string, unknown> | undefined;
  query: Record<string, string | undefined>;
  user?: { id: string; tenantId?: string | undefined } | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs") as FsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantBackupController = require("../../controllers/tenantBackup.controller") as TenantBackupControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tenantBackupService = require("../../services/tenantBackup.service") as TenantBackupServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TenantBackup } = require("../../models") as ModelsDouble;
// P6-02: the controller hands the services the models BARREL. It used to pass
// `req.models`, which no middleware sets, and these tests built a request WITH
// `models: {}` — so they passed while every live backup failed on
// `models.Users`. The request below carries no `models`, as in production.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const modelsBarrel = require("../../models") as ModelsDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { success } = require("../../utils/response.util") as ResponseDouble;

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";
const BACKUP_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("tenantBackup Controller", () => {
  let req: MockReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((resDouble: FakeRes, data: unknown, _meta: unknown, message: unknown, status?: number) => {
      resDouble.status(status ?? 200).json({ success: true, data, message });
    });
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: USER_ID, tenantId: TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      download: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createBackup", () => {
    it("should create a backup successfully", async () => {
      req.params = { tenantId: TENANT_ID };
      req.body = { name: "backup-1", description: "test", backupType: "FULL" };
      tenantBackupService.createBackup.mockResolvedValue({
        success: true,
        status: 201,
        message: "Backup created successfully",
        data: { id: BACKUP_ID, name: "backup-1" },
      });

      await tenantBackupController.createBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.createBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          createdById: USER_ID,
          name: "backup-1",
        }),
      );
      const firstCall = tenantBackupService.createBackup.mock.calls[0] as [{ models: unknown }];
      expect(firstCall[0].models).toBe(modelsBarrel);
      expect(modelsBarrel.Users).toBeDefined();
      expect(success).toHaveBeenCalled();
    });

    it("should fall back to its default message and 201 when the service omits them", async () => {
      req.params = { tenantId: TENANT_ID };
      req.body = { name: "nightly" };
      tenantBackupService.createBackup.mockResolvedValue({
        data: { id: BACKUP_ID, name: "nightly" },
      });

      await tenantBackupController.createBackup(req as unknown as Request, res as unknown as Response, next);

      expect(success).toHaveBeenCalledWith(
        res,
        { id: BACKUP_ID, name: "nightly" },
        null,
        "Backup created successfully",
        201,
      );
    });

    it("should return 400 when name is missing", async () => {
      req.params = { tenantId: TENANT_ID };
      req.body = { description: "no name" };

      await tenantBackupController.createBackup(req as unknown as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: 400,
          message: "Backup name is required",
        }),
      );
    });
  });

  describe("getBackups", () => {
    it("should list backups with pagination", async () => {
      req.params = { tenantId: TENANT_ID };
      req.query = { page: "1", limit: "10" };
      TenantBackup.getTenantBackups.mockResolvedValue({
        rows: [{ id: BACKUP_ID, name: "backup-1" }],
        count: 1,
      });

      await tenantBackupController.getBackups(req as unknown as Request, res as unknown as Response, next);

      expect(TenantBackup.getTenantBackups).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          limit: 10,
          offset: 0,
        }),
        modelsBarrel,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should filter by status", async () => {
      req.params = { tenantId: TENANT_ID };
      req.query = { page: "1", limit: "10", status: "COMPLETED" };
      TenantBackup.getTenantBackups.mockResolvedValue({
        rows: [],
        count: 0,
      });

      await tenantBackupController.getBackups(req as unknown as Request, res as unknown as Response, next);

      expect(TenantBackup.getTenantBackups).toHaveBeenCalledWith(
        expect.objectContaining({ status: "COMPLETED" }),
        modelsBarrel,
      );
    });

    it("should default to page 1 / limit 20 when the query is empty", async () => {
      req.params = { tenantId: TENANT_ID };
      req.query = {};
      TenantBackup.getTenantBackups.mockResolvedValue({
        rows: [{ id: BACKUP_ID }],
        count: 45,
      });

      await tenantBackupController.getBackups(req as unknown as Request, res as unknown as Response, next);

      expect(TenantBackup.getTenantBackups).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 0 }),
        modelsBarrel,
      );
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: BACKUP_ID }],
        { total: 45, page: 1, limit: 20, totalPages: 3 },
        "Backups retrieved successfully",
        200,
      );
    });
  });

  describe("getBackup", () => {
    it("should return a specific backup", async () => {
      req.params = { backupId: BACKUP_ID };
      const mockBackup = { id: BACKUP_ID, name: "backup-1", toJSON: () => ({ id: BACKUP_ID, name: "backup-1" }) };
      TenantBackup.findByPk.mockResolvedValue(mockBackup);

      await tenantBackupController.getBackup(req as unknown as Request, res as unknown as Response, next);

      expect(TenantBackup.findByPk).toHaveBeenCalledWith(BACKUP_ID, expect.any(Object));
      expect(success).toHaveBeenCalled();
    });

    it("should return 404 when backup not found", async () => {
      req.params = { backupId: "invalid-id" };
      TenantBackup.findByPk.mockResolvedValue(null);

      await tenantBackupController.getBackup(req as unknown as Request, res as unknown as Response, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          status: 404,
          message: "Backup not found",
        }),
      );
    });
  });

  describe("downloadBackup", () => {
    it("should download a backup file", async () => {
      req.params = { backupId: BACKUP_ID };
      tenantBackupService.downloadBackup.mockResolvedValue({
        success: true,
        status: 200,
        message: "Backup ready for download",
        data: {
          filePath: "/backups/backup.zip",
          metadata: { filename: "backup.zip", fileSize: 1024 },
        },
      });

      await tenantBackupController.downloadBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.downloadBackup).toHaveBeenCalledWith(BACKUP_ID, modelsBarrel);
      expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment; filename=\"backup.zip\"");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/zip");
    });

    it("should fall back to statSync for Content-Length when metadata has no fileSize", async () => {
      req.params = { backupId: BACKUP_ID };
      tenantBackupService.downloadBackup.mockResolvedValue({
        data: {
          filePath: "/backups/nested/backup-2.zip",
          metadata: {},
        },
      });
      fs.statSync.mockReturnValue({ size: 4096 });

      await tenantBackupController.downloadBackup(req as unknown as Request, res as unknown as Response, next);

      expect(fs.statSync).toHaveBeenCalledWith("/backups/nested/backup-2.zip");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Length", 4096);
      // filename is derived from the stored path, not from metadata
      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="backup-2.zip"',
      );
      expect(res.download).toHaveBeenCalledWith(
        "/backups/nested/backup-2.zip",
        "backup-2.zip",
      );
    });
  });

  describe("restoreBackup", () => {
    it("should restore a backup successfully", async () => {
      req.params = { backupId: BACKUP_ID };
      req.body = { mergeData: false };
      tenantBackupService.restoreBackup.mockResolvedValue({
        success: true,
        status: 200,
        message: "Backup restored successfully",
        data: { tenantId: TENANT_ID, recordsProcessed: 5 },
      });

      await tenantBackupController.restoreBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.restoreBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          backupId: BACKUP_ID,
          restoredById: USER_ID,
          mergeData: false,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should restore with mergeData true", async () => {
      req.params = { backupId: BACKUP_ID };
      req.body = { mergeData: true };
      tenantBackupService.restoreBackup.mockResolvedValue({
        status: 200,
        data: { tenantId: TENANT_ID },
      });

      await tenantBackupController.restoreBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.restoreBackup).toHaveBeenCalledWith(
        expect.objectContaining({ restoredById: USER_ID, mergeData: true }),
      );
    });

    it("should default mergeData to false when the body omits it", async () => {
      req.params = { backupId: BACKUP_ID };
      req.body = {};
      tenantBackupService.restoreBackup.mockResolvedValue({
        data: { tenantId: TENANT_ID },
      });

      await tenantBackupController.restoreBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.restoreBackup).toHaveBeenCalledWith({
        backupId: BACKUP_ID,
        restoredById: USER_ID,
        mergeData: false,
        models: modelsBarrel,
      });
      // restoreBackup always responds 200 and falls back to its default message
      expect(success).toHaveBeenCalledWith(
        res,
        { tenantId: TENANT_ID },
        null,
        "Backup restored successfully",
        200,
      );
    });
  });

  describe("deleteBackup", () => {
    it("should delete a backup successfully", async () => {
      req.params = { backupId: BACKUP_ID };
      tenantBackupService.deleteBackup.mockResolvedValue({
        success: true,
        status: 200,
        message: "Backup deleted successfully",
        data: null,
      });

      await tenantBackupController.deleteBackup(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.deleteBackup).toHaveBeenCalledWith(BACKUP_ID, USER_ID, modelsBarrel);
      expect(success).toHaveBeenCalled();
    });

    it("should fall back to its default message when the service omits one", async () => {
      req.params = { backupId: BACKUP_ID };
      tenantBackupService.deleteBackup.mockResolvedValue({ data: null });

      await tenantBackupController.deleteBackup(req as unknown as Request, res as unknown as Response, next);

      expect(success).toHaveBeenCalledWith(
        res,
        null,
        null,
        "Backup deleted successfully",
        200,
      );
    });
  });

  describe("getBackupStats", () => {
    it("should return backup statistics", async () => {
      req.params = { tenantId: TENANT_ID };
      tenantBackupService.getBackupStats.mockResolvedValue({
        totalBackups: 5,
        completedBackups: 4,
        failedBackups: 1,
        totalSize: 1048576,
        latestBackup: { id: BACKUP_ID },
        hasValidBackups: true,
      });

      await tenantBackupController.getBackupStats(req as unknown as Request, res as unknown as Response, next);

      expect(tenantBackupService.getBackupStats).toHaveBeenCalledWith(TENANT_ID, modelsBarrel);
      expect(success).toHaveBeenCalled();
    });
  });
});

// P8-01 (ADR-086 Amendment 1): a backup in the tenant's storage is sent from
// the object, its length from the object when the row records none, with the
// saved-as name res.download gives (the identity is
// routes/storedFiles.identity.p801).
describe("P8-01 — downloading a stored backup", () => {
  it("sends the stored object with the object's size when the metadata has none", async () => {
    const piped: unknown[] = [];
    const object = {
      meta: { size: 42, modifiedAt: new Date(0) },
      open: jest.fn(async () => {
        await Promise.resolve();
        return { on: jest.fn(), pipe: (dest: unknown) => piped.push(dest) };
      }),
    };
    tenantBackupService.downloadBackup.mockResolvedValue({
      data: { filePath: `t/${TENANT_ID}/backups/b.zip`, metadata: { fileSize: 0 }, object },
    });
    const headers: Record<string, unknown> = {};
    const res = {
      setHeader: jest.fn((k: string, v: unknown) => { headers[k.toLowerCase()] = v; }),
      removeHeader: jest.fn(),
      attachment: jest.fn((name: string) => { headers["content-disposition"] = `attachment; filename="${name}"`; }),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      download: jest.fn(),
      headersSent: false,
    };
    const req = { params: { tenantId: TENANT_ID, backupId: BACKUP_ID }, user: { id: USER_ID }, method: "GET", headers: {}, fresh: false, range: () => undefined };

    await tenantBackupController.downloadBackup(req as unknown as Request, res as unknown as Response, jest.fn());

    expect(res.download).not.toHaveBeenCalled();
    expect(fs.statSync).not.toHaveBeenCalled();
    expect(res.attachment).toHaveBeenCalledWith("b.zip");
    expect(headers["content-length"]).toBe(42);
    expect(headers["cache-control"]).toBe("public, max-age=0");
    expect(piped).toEqual([res]);
  });
});
