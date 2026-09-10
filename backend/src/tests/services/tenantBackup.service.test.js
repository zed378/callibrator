/**
 * Tests for tenantBackup service
 */

// Mock fs module
const mockFs = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn(() => ({
    on: jest.fn(function (event, cb) {
      if (event === "data") {cb(Buffer.from("mock data"));}
      if (event === "end") {cb();}
      return this;
    }),
  })),
};

jest.mock("fs", () => mockFs);

// Mock path module
jest.mock("path", () => ({
  join: jest.fn((...args) => "/mock/" + args.join("/")),
  dirname: jest.fn(() => "/mock"),
  resolve: jest.fn(() => "/mock/resolved"),
}));

// Mock crypto module
jest.mock("crypto", () => ({
  createHash: jest.fn(() => ({
    update: jest.fn(),
    digest: jest.fn(() => "mock-checksum"),
  })),
}));

// Mock JSZip
const mockZipGenerateAsync = jest
  .fn()
  .mockResolvedValue(Buffer.from("mock-zip-data"));
const mockZipFile = jest.fn();
const mockZipLoadAsync = jest.fn();

jest.mock("jszip", () => {
  return jest.fn().mockImplementation(() => ({
    file: mockZipFile,
    generateAsync: mockZipGenerateAsync,
  }));
});

// Mock uuid
jest.mock("uuid", () => ({
  v4: jest.fn(() => "mock-uuid-123"),
}));

// Mock moment
jest.mock("moment", () => {
  const actual = jest.requireActual("moment");
  const mockMoment = jest.fn(() => ({
    format: jest.fn(() => "20240101_120000"),
    subtract: jest.fn().mockReturnThis(),
  }));
  return Object.assign(mockMoment, actual);
});

// Mock models
const mockTenantBackup = {
  createBackup: jest.fn(),
  updateStatus: jest.fn(),
  findByPk: jest.fn(),
  getTenantBackups: jest.fn(),
  getLatestBackup: jest.fn(),
  hasValidBackups: jest.fn(),
  COUNT: jest.fn(),
  count: jest.fn(),
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  DEFAULT_RETENTION_DAYS: 30,
  BACKUP_TYPES: {
    FULL: "FULL",
    PARTIAL: "PARTIAL",
    USER_ONLY: "USER_ONLY",
  },
  STATUS: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    RESTORING: "RESTORING",
    RESTORED: "RESTORED",
    DELETING: "DELETING",
  },
};

const mockTenant = {
  findByPk: jest.fn(),
};

const mockUsers = {
  findAll: jest.fn(),
  findByPk: jest.fn(),
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
  findOrCreate: jest.fn(),
};

const mockTenantSettings = {
  findAll: jest.fn(),
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
  findOrCreate: jest.fn(),
};

const mockTenantRoles = {
  findAll: jest.fn(),
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
  findOrCreate: jest.fn(),
};

const mockTenantFeatures = {
  findAll: jest.fn(),
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
  findOrCreate: jest.fn(),
};

const mockUserPermissions = {
  findAll: jest.fn(),
  bulkCreate: jest.fn(),
  destroy: jest.fn(),
};

const mockTenantAuditLog = {
  findAll: jest.fn(),
};

const mockSessions = {
  destroy: jest.fn(),
};

const mockSequelize = {
  Op: {
    ne: "$ne",
    or: "$or",
    gte: "$gte",
    lt: "$lt",
  },
  Sequelize: {
    Op: {
      ne: "$ne",
      or: "$or",
      gte: "$gte",
      lt: "$lt",
    },
    UUIDV4: "uuid-v4",
    STRING: "string",
    UUID: "uuid",
    TEXT: "text",
    BOOLEAN: "boolean",
    INTEGER: "integer",
    BIGINT: "bigInt",
    JSONB: "jsonb",
    ENUM: "enum",
    fn: jest.fn((name, col) => `${name}(${col})`),
    col: jest.fn((col) => col),
  },
  transaction: jest.fn().mockResolvedValue({
    commit: jest.fn(),
    rollback: jest.fn(),
  }),
};

jest.mock("../../models", () => ({
  TenantBackup: mockTenantBackup,
  Tenant: mockTenant,
  Users: mockUsers,
  TenantSettings: mockTenantSettings,
  TenantRoles: mockTenantRoles,
  TenantFeatures: mockTenantFeatures,
  UserPermissions: mockUserPermissions,
  TenantAuditLog: mockTenantAuditLog,
  Sessions: mockSessions,
  // The models barrel really does export `sequelize`; restoreBackup falls back
  // to it when the caller passes no models.sequelize.
  sequelize: mockSequelize,
}));

// Mock activity log
jest.mock("../../middlewares/activityLog.middleware", () => ({
  createLogger: jest.fn(),
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    http: jest.fn(),
  },
}));

// NOTE: appError.util is deliberately NOT mocked. The real AppError exposes
// `.status` (not `.statusCode`) and InternalServerError is an AppError with
// status 500 — a hand-rolled mock previously fabricated a `.statusCode` field
// that does not exist on the real class.

const {
  createBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
  cleanupExpiredBackups,
} = require("../../services/tenantBackup.service");

describe("Tenant Backup Service", () => {
  const mockTenantId = "tenant-123";
  const mockUserId = "user-456";
  const mockBackupId = "backup-789";

  const mockModels = {
    sequelize: {
      ...mockSequelize,
      models: {
        Users: {
          destroy: jest.fn(),
          bulkCreate: jest.fn(),
          findOrCreate: jest.fn(),
        },
      },
    },
    Sequelize: mockSequelize.Sequelize,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // clearMocks only clears calls — reset the fs stubs so a throwing
    // implementation from one test cannot leak into the next.
    mockFs.existsSync.mockReset();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReset();
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockTenant.findByPk.mockReset();
    mockUsers.findAll.mockReset();
    mockUsers.findAll.mockResolvedValue([]);
    mockZipGenerateAsync.mockResolvedValue(Buffer.from("mock-zip-data"));
  });

  describe("createBackup", () => {
    it("should create a backup successfully", async () => {
      const mockBackup = {
        id: mockBackupId,
        tenantId: mockTenantId,
        status: "PENDING",
      };

      const mockTenantData = {
        id: mockTenantId,
        name: "Test Tenant",
        toJSON: jest.fn(() => ({ id: mockTenantId, name: "Test Tenant" })),
      };

      mockTenantBackup.createBackup.mockResolvedValue(mockBackup);
      mockTenantBackup.updateStatus.mockResolvedValue({
        ...mockBackup,
        status: "COMPLETED",
      });
      mockTenant.findByPk.mockResolvedValue(mockTenantData);
      mockTenantSettings.findAll.mockResolvedValue([]);
      mockTenantRoles.findAll.mockResolvedValue([]);
      mockTenantFeatures.findAll.mockResolvedValue([]);
      mockUsers.findAll.mockResolvedValue([]);
      mockUserPermissions.findAll.mockResolvedValue([]);
      mockTenantAuditLog.findAll.mockResolvedValue([]);
      mockZipGenerateAsync.mockResolvedValue(Buffer.from("mock-zip-data"));

      const result = await createBackup({
        tenantId: mockTenantId,
        createdById: mockUserId,
        name: "Test Backup",
        backupType: "FULL",
        models: mockModels,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("Backup created successfully");
      expect(mockTenantBackup.createBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          createdById: mockUserId,
          name: "Test Backup",
        }),
        mockModels,
      );
    });

    it("should handle backup creation failure", async () => {
      const mockBackup = {
        id: mockBackupId,
        tenantId: mockTenantId,
        status: "PENDING",
      };

      mockTenantBackup.createBackup.mockResolvedValue(mockBackup);
      mockTenantBackup.updateStatus
        .mockResolvedValueOnce({ ...mockBackup, status: "IN_PROGRESS" })
        .mockResolvedValueOnce({ ...mockBackup, status: "FAILED" });

      const mockTenantData = {
        id: mockTenantId,
        name: "Test Tenant",
        toJSON: jest.fn(() => ({ id: mockTenantId, name: "Test Tenant" })),
      };

      mockTenant.findByPk
        .mockResolvedValueOnce(mockTenantData)
        .mockRejectedValueOnce(new Error("Database error"));

      await expect(
        createBackup({
          tenantId: mockTenantId,
          createdById: mockUserId,
          name: "Test Backup",
          models: mockModels,
        }),
      ).rejects.toThrow("Failed to create backup");
    });

    it("should throw a 404 AppError when the tenant does not exist", async () => {
      mockTenant.findByPk.mockResolvedValue(null);

      await expect(
        createBackup({ tenantId: "ghost", createdById: mockUserId, models: mockModels }),
      ).rejects.toMatchObject({ status: 404, message: "Tenant not found" });

      expect(mockTenantBackup.createBackup).not.toHaveBeenCalled();
    });

    it("should mark the backup FAILED and wrap the error as a 500", async () => {
      mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
      mockTenant.findByPk
        .mockResolvedValueOnce({ toJSON: () => ({ id: mockTenantId }) })
        .mockRejectedValueOnce(new Error("boom"));

      const err = await createBackup({
        tenantId: mockTenantId,
        createdById: mockUserId,
        models: mockModels,
      }).catch((e) => e);

      expect(err).toMatchObject({ status: 500, message: "Failed to create backup: boom" });
      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        { status: "FAILED", errorMessage: "boom" },
        mockModels,
      );
    });

    it("should serialise users via toJSON and record the row count", async () => {
      mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
      mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId, name: "T" }) });
      mockUsers.findAll.mockResolvedValue([
        { toJSON: () => ({ id: "u1", email: "u1@test.com" }) },
        { toJSON: () => ({ id: "u2", email: "u2@test.com" }) },
      ]);

      await createBackup({
        tenantId: mockTenantId,
        createdById: mockUserId,
        backupType: "FULL",
        models: mockModels,
      });

      // Password hashes must never be selected into the export.
      expect(mockUsers.findAll).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId },
        attributes: { exclude: ["password", "createdAt", "updatedAt", "deleted_at"] },
      });

      const payload = JSON.parse(mockZipFile.mock.calls[0][1]);
      expect(payload.users).toEqual([
        { id: "u1", email: "u1@test.com" },
        { id: "u2", email: "u2@test.com" },
      ]);
      expect(payload.tenant).toEqual({ id: mockTenantId, name: "T" });

      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        expect.objectContaining({
          status: "COMPLETED",
          recordCount: 2,
          metadata: expect.objectContaining({ checksum: "mock-checksum" }),
        }),
        mockModels,
      );
    });

    it("should skip the user export for a backup type that excludes users", async () => {
      mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
      mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId }) });

      await createBackup({
        tenantId: mockTenantId,
        createdById: mockUserId,
        backupType: "PARTIAL",
        models: mockModels,
      });

      expect(mockUsers.findAll).not.toHaveBeenCalled();
      const payload = JSON.parse(mockZipFile.mock.calls[0][1]);
      expect(payload.users).toEqual([]);
      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        expect.objectContaining({ status: "COMPLETED", recordCount: 0 }),
        mockModels,
      );
    });

    it("should record a null tenant when the tenant vanishes mid-export", async () => {
      mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
      mockTenant.findByPk
        .mockResolvedValueOnce({ toJSON: () => ({ id: mockTenantId }) }) // validation passes
        .mockResolvedValueOnce(null); // gone by export time
      mockUsers.findAll.mockResolvedValue([]);

      await createBackup({
        tenantId: mockTenantId,
        createdById: mockUserId,
        backupType: "USER_ONLY",
        models: mockModels,
      });

      const payload = JSON.parse(mockZipFile.mock.calls[0][1]);
      expect(payload.tenant).toBeNull();
    });

    it("should fall back to a default application version when npm_package_version is unset", async () => {
      const original = process.env.npm_package_version;
      delete process.env.npm_package_version;
      try {
        mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
        mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId }) });
        mockUsers.findAll.mockResolvedValue([]);

        await createBackup({ tenantId: mockTenantId, createdById: mockUserId, models: mockModels });

        const payload = JSON.parse(mockZipFile.mock.calls[0][1]);
        expect(payload.metadata.applicationVersion).toBe("1.0.0");
      } finally {
        if (original === undefined) delete process.env.npm_package_version;
        else process.env.npm_package_version = original;
      }
    });

    describe("backup directory creation", () => {
      it("should create the backup directory when it does not exist", async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
        mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId }) });
        mockUsers.findAll.mockResolvedValue([]);

        const result = await createBackup({
          tenantId: mockTenantId,
          createdById: mockUserId,
          models: mockModels,
        });

        expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
        expect(result.success).toBe(true);
      });

      it("should tolerate an EEXIST race when creating the directory", async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => {
          const err = new Error("exists");
          err.code = "EEXIST";
          throw err;
        });
        mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
        mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId }) });
        mockUsers.findAll.mockResolvedValue([]);

        const result = await createBackup({
          tenantId: mockTenantId,
          createdById: mockUserId,
          models: mockModels,
        });

        expect(result.success).toBe(true);
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      });

      it("should surface a non-EEXIST mkdir failure as a wrapped 500", async () => {
        mockFs.existsSync.mockReturnValue(false);
        mockFs.mkdirSync.mockImplementation(() => {
          const err = new Error("permission denied");
          err.code = "EACCES";
          throw err;
        });
        mockFs.writeFileSync.mockImplementation(() => {
          throw new Error("ENOENT: no such directory");
        });
        mockTenantBackup.createBackup.mockResolvedValue({ id: mockBackupId });
        mockTenant.findByPk.mockResolvedValue({ toJSON: () => ({ id: mockTenantId }) });
        mockUsers.findAll.mockResolvedValue([]);

        await expect(
          createBackup({ tenantId: mockTenantId, createdById: mockUserId, models: mockModels }),
        ).rejects.toMatchObject({
          status: 500,
          message: "Failed to create backup: ENOENT: no such directory",
        });
      });
    });
  });

  describe("downloadBackup", () => {
    it("should return backup file path and metadata", async () => {
      const mockBackup = {
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: { filename: "backup.zip" },
        tenant: { id: mockTenantId },
        creator: { id: mockUserId },
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(true);

      const result = await downloadBackup(mockBackupId, mockModels);

      expect(result.data.filePath).toBe("/mock/backups/backup.zip");
      expect(result.data.metadata).toEqual(mockBackup);
    });

    it("should throw error if backup not found", async () => {
      mockTenantBackup.findByPk.mockResolvedValue(null);

      await expect(downloadBackup("nonexistent", mockModels)).rejects.toThrow(
        "Backup not found",
      );
    });

    it("should throw error if backup is not ready", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "IN_PROGRESS",
      });

      await expect(downloadBackup(mockBackupId, mockModels)).rejects.toMatchObject({
        status: 400,
        message: "Backup is not ready for download",
      });
    });

    it("should throw 404 when the recorded file is missing from storage", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/gone.zip",
      });
      mockFs.existsSync.mockReturnValue(false);

      await expect(downloadBackup(mockBackupId, mockModels)).rejects.toMatchObject({
        status: 404,
        message: "Backup file not found on storage",
      });
    });

    it("should throw 404 when the backup row has no filePath", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: null,
      });

      await expect(downloadBackup(mockBackupId, mockModels)).rejects.toMatchObject({
        status: 404,
        message: "Backup file not found on storage",
      });
    });
  });

  describe("restoreBackup", () => {
    it("should restore a backup successfully", async () => {
      const mockBackup = {
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: {},
        tenant: { id: mockTenantId },
      };

      const mockZipData = Buffer.from("mock-zip");
      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(mockZipData);

      // Mock JSZip loadAsync
      const MockJSZip = require("jszip");
      const mockZipInstance = {
        loadAsync: jest.fn().mockResolvedValue({
          files: {
            "tenant_data_full.json": {
              async: jest.fn().mockResolvedValue(
                JSON.stringify({
                  metadata: { version: "1.0" },
                  tenant: { id: mockTenantId },
                  settings: [],
                  tenantRoles: [],
                  tenantFeatures: [],
                  users: [{ username: "test1", email: "test1@example.com" }],
                  userPermissions: [],
                  auditLogs: [],
                }),
              ),
            },
          },
        }),
      };
      MockJSZip.mockImplementation(() => mockZipInstance);

      // Mock transaction
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      mockTenantBackup.updateStatus.mockResolvedValue({
        ...mockBackup,
        status: "RESTORED",
      });

      const result = await restoreBackup({
        backupId: mockBackupId,
        restoredById: mockUserId,
        models: mockModels,
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe("Backup restored successfully");
    });

    it("should throw error if backup not found", async () => {
      mockTenantBackup.findByPk.mockResolvedValue(null);

      await expect(
        restoreBackup({
          backupId: "nonexistent",
          restoredById: mockUserId,
          models: mockModels,
        }),
      ).rejects.toThrow("Backup not found");
    });

    it("should throw error if backup file missing", async () => {
      const mockBackup = {
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/missing.zip",
        metadata: {},
        tenant: { id: mockTenantId },
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        restoreBackup({
          backupId: mockBackupId,
          restoredById: mockUserId,
          models: mockModels,
        }),
      ).rejects.toThrow("Backup file not found on storage");
    });

    it("should restore a backup successfully with mergeData=false", async () => {
      const mockBackup = {
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("mock-zip-data"));

      const MockJSZip = require("jszip");
      const mockZipInstance = {
        loadAsync: jest.fn().mockResolvedValue({
          files: {
            "tenant_data_full.json": {
              async: jest.fn().mockResolvedValue(
                JSON.stringify({
                  metadata: { version: "1.0" },
                  tenant: { id: mockTenantId },
                  users: [{ username: "test1", email: "test1@example.com" }],
                }),
              ),
            },
          },
        }),
      };
      MockJSZip.mockImplementation(() => mockZipInstance);

      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);
      mockTenantBackup.updateStatus.mockResolvedValue({
        ...mockBackup,
        status: "RESTORED",
      });

      const result = await restoreBackup({
        backupId: mockBackupId,
        restoredById: mockUserId,
        models: mockModels,
        mergeData: false,
      });

      expect(result.success).toBe(true);
      expect(mockUsers.destroy).toHaveBeenCalled();
      expect(mockUsers.bulkCreate).toHaveBeenCalled();
    });

    // Builds a JSZip stub whose archive yields `payload` for the tenant data file.
    const stubZipWith = (files) => {
      const MockJSZip = require("jszip");
      MockJSZip.mockImplementation(() => ({
        loadAsync: jest.fn().mockResolvedValue({ files }),
        file: mockZipFile,
        generateAsync: mockZipGenerateAsync,
      }));
    };
    const tenantDataFile = (payload) => ({
      "tenant_data_full.json": { async: jest.fn().mockResolvedValue(JSON.stringify(payload)) },
    });

    it("should throw 400 when the backup is not COMPLETED", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({ id: mockBackupId, status: "IN_PROGRESS" });

      await expect(
        restoreBackup({ backupId: mockBackupId, restoredById: mockUserId, models: mockModels }),
      ).rejects.toMatchObject({ status: 400, message: "Backup is not ready for restore" });

      expect(mockTenantBackup.updateStatus).not.toHaveBeenCalled();
    });

    it("should fail when the archive contains no tenant data file", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith({ "backup_metadata.json": { async: jest.fn() } });

      await expect(
        restoreBackup({ backupId: mockBackupId, restoredById: mockUserId, models: mockModels }),
      ).rejects.toMatchObject({
        status: 500,
        message: "Failed to restore backup: Invalid backup file: no tenant data found",
      });

      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        { status: "FAILED", errorMessage: "Invalid backup file: no tenant data found" },
        mockModels,
      );
    });

    it("should fail when the backup data structure is invalid", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith(tenantDataFile({ metadata: { version: "1.0" } })); // no tenant

      await expect(
        restoreBackup({ backupId: mockBackupId, restoredById: mockUserId, models: mockModels }),
      ).rejects.toMatchObject({
        status: 500,
        message: "Failed to restore backup: Invalid backup data structure",
      });
    });

    it("should merge users with findOrCreate when mergeData is true", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: { checksum: "abc" },
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith(
        tenantDataFile({
          metadata: { version: "1.0" },
          tenant: { id: mockTenantId },
          users: [{ id: "old-id", username: "test1", email: "test1@example.com" }],
        }),
      );
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);
      mockUsers.findOrCreate.mockResolvedValue([{}, true]);

      const result = await restoreBackup({
        backupId: mockBackupId,
        restoredById: mockUserId,
        mergeData: true,
        models: mockModels,
      });

      expect(result.data.recordsProcessed).toBe(1);
      expect(mockUsers.destroy).not.toHaveBeenCalled();
      // The backed-up primary key must not be reused.
      expect(mockUsers.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          defaults: expect.objectContaining({ id: undefined, username: "test1" }),
          transaction: mockTransaction,
        }),
      );
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        expect.objectContaining({
          status: "RESTORED",
          metadata: expect.objectContaining({ checksum: "abc", recordsProcessed: 1, restoredById: mockUserId }),
        }),
        mockModels,
      );
    });

    it("should commit with no work when the backup holds no users", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: {},
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith(
        tenantDataFile({ metadata: { version: "1.0" }, tenant: { id: mockTenantId }, users: [] }),
      );
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      const result = await restoreBackup({
        backupId: mockBackupId,
        restoredById: mockUserId,
        models: mockModels,
      });

      expect(result.data.recordsProcessed).toBe(0);
      expect(mockUsers.destroy).not.toHaveBeenCalled();
      expect(mockUsers.bulkCreate).not.toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();
    });

    it("should roll back and mark FAILED when a restore write fails", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: {},
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith(
        tenantDataFile({
          metadata: { version: "1.0" },
          tenant: { id: mockTenantId },
          users: [{ username: "test1", email: "test1@example.com" }],
        }),
      );
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);
      mockUsers.bulkCreate.mockRejectedValue(new Error("constraint violation"));

      await expect(
        restoreBackup({ backupId: mockBackupId, restoredById: mockUserId, models: mockModels }),
      ).rejects.toMatchObject({
        status: 500,
        message: "Failed to restore backup: constraint violation",
      });

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
      expect(mockTenantBackup.updateStatus).toHaveBeenLastCalledWith(
        mockBackupId,
        { status: "FAILED", errorMessage: "constraint violation" },
        mockModels,
      );
    });

    it("should fall back to the models barrel sequelize when none is supplied", async () => {
      mockTenantBackup.findByPk.mockResolvedValue({
        id: mockBackupId,
        status: "COMPLETED",
        filePath: "/mock/backups/backup.zip",
        metadata: {},
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from("zip"));
      stubZipWith(
        tenantDataFile({ metadata: { version: "1.0" }, tenant: { id: mockTenantId }, users: [] }),
      );
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      const result = await restoreBackup({
        backupId: mockBackupId,
        restoredById: mockUserId,
        models: { Sequelize: mockSequelize.Sequelize }, // no sequelize property
      });

      expect(result.success).toBe(true);
      expect(mockSequelize.transaction).toHaveBeenCalled();
    });
  });

  describe("deleteBackup", () => {
    it("should delete a backup successfully", async () => {
      const mockBackup = {
        id: mockBackupId,
        filePath: "/mock/backups/backup.zip",
        status: "COMPLETED",
        destroy: jest.fn().mockResolvedValue(true),
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(true);

      const result = await deleteBackup(mockBackupId, mockUserId, mockModels);

      expect(result.success).toBe(true);
      expect(result.message).toBe("Backup deleted successfully");
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(
        "/mock/backups/backup.zip",
      );
      expect(mockBackup.destroy).toHaveBeenCalled();
    });

    it("should throw error if backup not found", async () => {
      mockTenantBackup.findByPk.mockResolvedValue(null);

      await expect(
        deleteBackup("nonexistent", mockUserId, mockModels),
      ).rejects.toThrow("Backup not found");
    });

    it("should handle file deletion failure gracefully", async () => {
      const mockBackup = {
        id: mockBackupId,
        filePath: null,
        status: "COMPLETED",
        destroy: jest.fn().mockResolvedValue(true),
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);

      const result = await deleteBackup(mockBackupId, mockUserId, mockModels);

      expect(result.success).toBe(true);
    });
  });

  describe("getBackupStats", () => {
    it("should return backup statistics", async () => {
      mockTenantBackup.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // completed
        .mockResolvedValueOnce(2); // failed

      mockTenantBackup.findAll.mockResolvedValue([
        { dataValues: { totalSize: 1048576 } },
      ]);

      const mockDate = new Date("2026-01-01T00:00:00Z");
      mockTenantBackup.getLatestBackup.mockResolvedValue({
        id: "latest-backup",
        createdAt: mockDate,
      });

      mockTenantBackup.hasValidBackups.mockResolvedValue(true);

      const stats = await getBackupStats(mockTenantId, mockModels);

      expect(stats.data.totalBackups).toBe(10);
      expect(stats.data.completedBackups).toBe(8);
      expect(stats.data.failedBackups).toBe(2);
      expect(stats.data.totalSize).toBe(1048576);
      expect(stats.data.latestBackup).toEqual({
        id: "latest-backup",
        createdAt: mockDate,
      });
      expect(stats.data.hasValidBackups).toBe(true);
    });

    it("reports totalSize 0 when SUM(file_size) is NULL", async () => {
      // No COMPLETED backup carries a fileSize, so the aggregate returns NULL.
      mockTenantBackup.count.mockResolvedValue(0);
      mockTenantBackup.findAll.mockResolvedValue([
        { dataValues: { totalSize: null } },
      ]);
      mockTenantBackup.getLatestBackup.mockResolvedValue(null);
      mockTenantBackup.hasValidBackups.mockResolvedValue(false);

      const stats = await getBackupStats(mockTenantId, mockModels);

      expect(stats.data.totalSize).toBe(0);
      expect(stats.data.latestBackup).toBeNull();
      expect(stats.data.hasValidBackups).toBe(false);
    });

    it("reports totalSize 0 when the aggregate query returns no rows", async () => {
      mockTenantBackup.count.mockResolvedValue(0);
      mockTenantBackup.findAll.mockResolvedValue([]); // exercises totalSizeResult[0]?.
      mockTenantBackup.getLatestBackup.mockResolvedValue(null);
      mockTenantBackup.hasValidBackups.mockResolvedValue(false);

      const stats = await getBackupStats(mockTenantId, mockModels);

      expect(stats.data.totalSize).toBe(0);
    });

    it("reports totalSize 0 when the aggregate row has no dataValues", async () => {
      mockTenantBackup.count.mockResolvedValue(0);
      mockTenantBackup.findAll.mockResolvedValue([{}]); // exercises ?.dataValues?.
      mockTenantBackup.getLatestBackup.mockResolvedValue(null);
      mockTenantBackup.hasValidBackups.mockResolvedValue(false);

      const stats = await getBackupStats(mockTenantId, mockModels);

      expect(stats.data.totalSize).toBe(0);
    });

    it("parses a string SUM into a number", async () => {
      // Postgres returns SUM() of a bigint column as a string.
      mockTenantBackup.count.mockResolvedValue(1);
      mockTenantBackup.findAll.mockResolvedValue([
        { dataValues: { totalSize: "2048.5" } },
      ]);
      mockTenantBackup.getLatestBackup.mockResolvedValue(null);
      mockTenantBackup.hasValidBackups.mockResolvedValue(false);

      const stats = await getBackupStats(mockTenantId, mockModels);

      expect(stats.data.totalSize).toBe(2048.5);
    });
  });

  describe("cleanupExpiredBackups", () => {
    it("should clean up expired backups successfully", async () => {
      const mockBackup1 = {
        id: "backup-1",
        filePath: "/path/to/backup1.zip",
        destroy: jest.fn().mockResolvedValue(),
      };
      const mockBackup2 = {
        id: "backup-2",
        filePath: "/path/to/backup2.zip",
        destroy: jest.fn().mockResolvedValue(),
      };

      mockTenantBackup.findAll.mockResolvedValue([mockBackup1, mockBackup2]);
      mockFs.existsSync.mockReturnValue(true);

      const result = await cleanupExpiredBackups(mockTenantId, mockModels);

      expect(mockTenantBackup.findAll).toHaveBeenCalled();
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/path/to/backup1.zip");
      expect(mockFs.unlinkSync).toHaveBeenCalledWith("/path/to/backup2.zip");
      expect(mockBackup1.destroy).toHaveBeenCalled();
      expect(mockBackup2.destroy).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        status: 200,
        message: "Expired backups cleanup completed",
        data: { deletedCount: 2 },
      });
    });

    it("should handle error during deletion gracefully", async () => {
      const mockBackup = {
        id: "backup-1",
        filePath: "/path/to/backup1.zip",
        destroy: jest.fn().mockRejectedValue(new Error("Failed to delete")),
      };

      mockTenantBackup.findAll.mockResolvedValue([mockBackup]);
      mockFs.existsSync.mockReturnValue(true);

      const result = await cleanupExpiredBackups(null, mockModels);

      expect(result.data.deletedCount).toBe(0);
    });

    it("still soft-deletes a row that has no filePath, without touching the disk", async () => {
      const mockBackup = {
        id: "backup-no-path",
        filePath: null, // short-circuits `backup.filePath && fs.existsSync(...)`
        destroy: jest.fn().mockResolvedValue(),
      };
      mockTenantBackup.findAll.mockResolvedValue([mockBackup]);

      const result = await cleanupExpiredBackups(mockTenantId, mockModels);

      expect(mockFs.existsSync).not.toHaveBeenCalled();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      expect(mockBackup.destroy).toHaveBeenCalled();
      expect(result.data.deletedCount).toBe(1);
    });

    it("still soft-deletes a row whose physical file is already gone", async () => {
      const mockBackup = {
        id: "backup-missing-file",
        filePath: "/path/to/gone.zip",
        destroy: jest.fn().mockResolvedValue(),
      };
      mockTenantBackup.findAll.mockResolvedValue([mockBackup]);
      mockFs.existsSync.mockReturnValue(false);

      const result = await cleanupExpiredBackups(mockTenantId, mockModels);

      expect(mockFs.existsSync).toHaveBeenCalledWith("/path/to/gone.zip");
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      expect(mockBackup.destroy).toHaveBeenCalled();
      expect(result.data.deletedCount).toBe(1);
    });

    it("scopes the query to a tenant when given one, and globally when not", async () => {
      mockTenantBackup.findAll.mockResolvedValue([]);

      await cleanupExpiredBackups(mockTenantId, mockModels);
      expect(mockTenantBackup.findAll.mock.calls[0][0].where).toMatchObject({
        tenantId: mockTenantId,
      });

      await cleanupExpiredBackups(null, mockModels);
      expect(
        mockTenantBackup.findAll.mock.calls[1][0].where,
      ).not.toHaveProperty("tenantId");
    });
  });

  describe("deleteBackup failure handling", () => {
    it("should handle deletion failure and revert status", async () => {
      const mockBackup = {
        id: mockBackupId,
        filePath: "/mock/backups/backup.zip",
        status: "COMPLETED",
        destroy: jest.fn().mockRejectedValue(new Error("Database deletion error")),
      };

      mockTenantBackup.findByPk.mockResolvedValue(mockBackup);
      mockFs.existsSync.mockReturnValue(true);

      await expect(
        deleteBackup(mockBackupId, mockUserId, mockModels),
      ).rejects.toThrow("Failed to delete backup");

      expect(mockTenantBackup.updateStatus).toHaveBeenCalledWith(
        mockBackupId,
        { status: "COMPLETED" },
        mockModels,
      );
    });
  });
});
