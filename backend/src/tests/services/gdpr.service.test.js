/**
 * Tests for GDPR Service
 */

const EventEmitter = require("events");

let mockArchiverInstance;
let mockWriteStreamInstance;

jest.mock("fs", () => {
  const originalFs = jest.requireActual("fs");
  return {
    ...originalFs,
    promises: {
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      stat: jest.fn(),
    },
    createWriteStream: jest.fn().mockImplementation(() => {
      const ws = {
        on: jest.fn((event, cb) => {
          if (event === "close" && ws.triggerClose) {
            setImmediate(cb);
          }
          return ws;
        }),
        triggerClose: true,
      };
      mockWriteStreamInstance = ws;
      return ws;
    }),
    existsSync: jest.fn(),
    rmSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

jest.mock("archiver", () => {
  return jest.fn().mockImplementation(() => {
    const arch = {
      on: jest.fn((event, cb) => {
        if (event === "end" && arch.triggerEnd) {
          setImmediate(cb);
        }
        if (event === "error" && arch.triggerError) {
          setImmediate(() => cb(new Error("Archiver Error")));
        }
        return arch;
      }),
      pipe: jest.fn(),
      directory: jest.fn(),
      finalize: jest.fn(),
      triggerEnd: true,
      triggerError: false,
    };
    mockArchiverInstance = arch;
    return arch;
  });
});

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../config", () => ({
  db: {
    getDialect: jest.fn().mockReturnValue("sqlite"),
    Sequelize: { Op: { or: "or_symbol" } },
  },
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("../../models", () => {
  const model = (overrides = {}) => ({
    findOne: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "rec-1" }),
    update: jest.fn().mockResolvedValue([1]),
    destroy: jest.fn().mockResolvedValue(1),
    ...overrides,
  });
  return {
    User: model({
      findOne: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        username: "john",
        firstName: "John",
        lastName: "Doe",
        status: "active",
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
        Role: { name: "USER" },
      }),
      findByPk: jest.fn().mockResolvedValue({
        id: "user-1",
        privacyPreferences: { marketing: false },
      }),
    }),
    Role: model(),
    AuditLog: model(),
    Notification: model(),
    Session: model(),
    CalibrationDevice: model(),
    CalibrationRecord: model(),
    Certificate: model(),
    ConsentRecord: model(),
    DataRetentionPolicy: model({ findAll: jest.fn().mockResolvedValue([]) }),
    DsarRequest: model(),
    // Plural aliases. src/models/index.js really does export these
    // (`Stocks: models.Stock`, ...), and exportTenantData looks tables up by
    // their plural name — without them the export loop silently skips every
    // table and never exercises its body.
    Stocks: model(),
    StockTransfers: model(),
    StockAdjustments: model(),
    StockOpnames: model(),
    CalibrationDevices: model(),
    CalibrationRecords: model(),
    Certificates: model(),
    MaintenanceWorkOrders: model(),
    Notifications: model(),
  };
});

jest.mock("../../services/dataRetention.service", () => ({
  isOnLegalHold: jest.fn().mockResolvedValue(false),
}));

const gdprService = require("../../services/gdpr.service");
const dataRetentionService = require("../../services/dataRetention.service");
const {
  User,
  AuditLog,
  ConsentRecord,
  DataRetentionPolicy,
  DsarRequest,
} = require("../../models");
const fs = require("fs");

describe("gdprService", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    process.env.GDPR_ENABLED = "true";
    process.env.EXPORT_RETENTION_HOURS = "168";
    process.env.ERASURE_BATCH_SIZE = "100";
    process.env.CONSENT_REQUIRED = "false";

    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.writeFile.mockResolvedValue(undefined);
    fs.promises.stat.mockResolvedValue({ size: 1024 });
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.GDPR_ENABLED = "true";
  });

  describe("exportUserData", () => {
    it("should throw error when GDPR is disabled", async () => {
      jest.useRealTimers();
      process.env.GDPR_ENABLED = "false";
      await expect(
        gdprService.exportUserData("tenant-1", "user-1"),
      ).rejects.toThrow("Data export is disabled");
    });

    it("should export user data successfully", async () => {
      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("exportId");
      expect(result).toHaveProperty("downloadUrl");
      expect(result).toHaveProperty("expiresAt");
    });

    it("should fallback to getDialect postgres and still export successfully", async () => {
      const { db } = require("../../config");
      db.getDialect.mockReturnValue("postgres");

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("exportId");
    });

    it("should throw 404 if user not found", async () => {
      jest.useRealTimers();
      User.findOne.mockResolvedValueOnce(null);
      await expect(
        gdprService.exportUserData("tenant-1", "nonexistent"),
      ).rejects.toThrow("Failed to export user data");
    });

    it("should handle warning errors in nested exports blocks and continue", async () => {
      const { AuditLog } = require("../../models");
      AuditLog.findAll.mockRejectedValueOnce(new Error("Audit logs error"));

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toHaveProperty("exportId");
    });

    it("should handle warning errors in calibration devices export and continue", async () => {
      const { CalibrationDevice } = require("../../models");
      CalibrationDevice.findAll.mockRejectedValueOnce(
        new Error("Calibration device error"),
      );

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toHaveProperty("exportId");
    });

    it("should handle zip compression failure and reject", async () => {
      // Mock fs.createWriteStream to throw, triggering the service's error handling
      fs.createWriteStream.mockImplementationOnce(() => {
        throw new Error("Cannot create write stream");
      });

      await expect(
        gdprService.exportUserData("tenant-1", "user-1"),
      ).rejects.toThrow("Failed to export user data");
    });

    it("should reject when the archiver stream emits an error", async () => {
      // createZipArchive wires `archive.on("error", reject)`; drive that path.
      // Real timers so the setImmediate below fires on its own.
      jest.useRealTimers();
      const archiver = require("archiver");
      archiver.mockImplementationOnce(() => {
        const arch = {
          on: jest.fn((event, cb) => {
            if (event === "error") {
              setImmediate(() => cb(new Error("Archiver Error")));
            }
            return arch;
          }),
          pipe: jest.fn(),
          directory: jest.fn(),
          finalize: jest.fn(),
        };
        return arch;
      });

      await expect(
        gdprService.exportUserData("tenant-1", "user-1"),
      ).rejects.toThrow("Failed to export user data");
    });

    it("should export each tenant table and the calibration records of every device", async () => {
      // Devices present => the `deviceIds.length > 0` arms of exportCalibrationData
      // run, and the plural-aliased tenant tables are each queried.
      const {
        CalibrationDevice,
        CalibrationRecord,
        Certificate,
        Stocks,
        Notifications,
      } = require("../../models");

      CalibrationDevice.findAll.mockResolvedValueOnce([{ id: "dev-1" }, { id: "dev-2" }]);
      CalibrationRecord.findAll.mockResolvedValueOnce([{ id: "rec-1" }]);
      Certificate.findAll.mockResolvedValueOnce([{ id: "cert-1" }]);

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("exportId");

      // Tenant tables are looked up by their plural alias and scoped to the tenant.
      expect(Stocks.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: "tenant-1" }, limit: 1000, raw: true }),
      );
      expect(Notifications.findAll).toHaveBeenCalled();

      // Calibration records/certificates are fetched for the collected device ids.
      expect(CalibrationRecord.findAll).toHaveBeenCalledWith({
        where: { deviceId: ["dev-1", "dev-2"] },
        raw: true,
      });
      expect(Certificate.findAll).toHaveBeenCalledWith({
        where: { deviceId: ["dev-1", "dev-2"] },
        raw: true,
      });
    });

    it("should skip a tenant table that is not a registered model", async () => {
      // exportTenantData guards with `if (Model)` for tables that aren't
      // registered on the models index. Simulate one going missing.
      const models = require("../../models");
      const removed = models.StockOpnames;
      delete models.StockOpnames;

      try {
        const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
        await jest.runAllTimersAsync();
        const result = await resultPromise;

        expect(result).toHaveProperty("exportId");
        // Skipped silently — not warned about, and absent from the payload.
        expect(removed.findAll).not.toHaveBeenCalled();
        const written = fs.promises.writeFile.mock.calls.find(([p]) =>
          String(p).endsWith("tenant_data.json"),
        );
        expect(Object.keys(JSON.parse(written[1]))).not.toContain("StockOpnames");
      } finally {
        models.StockOpnames = removed;
      }
    });

    it("should log a warning and continue when a tenant table export fails", async () => {
      const { Stocks } = require("../../models");
      const { logger } = require("../../middlewares/activityLog.middleware");
      Stocks.findAll.mockRejectedValueOnce(new Error("Stocks table gone"));

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toHaveProperty("exportId");
      expect(logger.warn).toHaveBeenCalledWith("Failed to export Stocks", {
        error: "Stocks table gone",
      });
    });

    it("should run cleanup on timer expiry and delete files", async () => {
      fs.existsSync.mockReturnValue(true);

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      jest.advanceTimersByTime(168 * 3600000);
      await jest.runAllTimersAsync();
      await resultPromise;

      expect(fs.rmSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("should log warning if cleanup throws exception", async () => {
      fs.existsSync.mockReturnValue(true);
      fs.rmSync.mockImplementationOnce(() => {
        throw new Error("Cannot delete");
      });

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      jest.advanceTimersByTime(168 * 3600000);
      await jest.runAllTimersAsync();
      await resultPromise;

      expect(fs.rmSync).toHaveBeenCalled();
    });

    it("should fallback getFileSize to 0 if stat throws exception", async () => {
      fs.promises.stat.mockRejectedValueOnce(new Error("stat error"));

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.fileSize).toBe(0);
    });
  });

  describe("eraseUserData", () => {
    it("should throw error when GDPR is disabled", async () => {
      process.env.GDPR_ENABLED = "false";
      await expect(
        gdprService.eraseUserData("tenant-1", "user-1"),
      ).rejects.toThrow("Data erasure is disabled");
    });

    it("should anonymize user by default", async () => {
      const result = await gdprService.eraseUserData("tenant-1", "user-1");

      expect(result).toHaveProperty("erased", true);
      expect(result).toHaveProperty("method", "anonymized");
      expect(result).toHaveProperty("erasureDate");
    });

    it("should soft delete when anonymize is false", async () => {
      const result = await gdprService.eraseUserData("tenant-1", "user-1", {
        anonymize: false,
      });

      expect(result.method).toBe("soft_deleted");
    });

    it("should hard delete when hardDelete is true", async () => {
      const result = await gdprService.eraseUserData("tenant-1", "user-1", {
        hardDelete: true,
        anonymize: false,
      });

      expect(result.method).toBe("hard_deleted");
    });

    it("should throw AppError on database exception during erasure", async () => {
      User.update.mockRejectedValueOnce(new Error("Update failed"));
      await expect(
        gdprService.eraseUserData("tenant-1", "user-1"),
      ).rejects.toThrow("Failed to erase user data");
    });
  });

  describe("recordConsent", () => {
    it("should throw error when GDPR is disabled", async () => {
      process.env.GDPR_ENABLED = "false";
      await expect(
        gdprService.recordConsent("tenant-1", "user-1", "analytics"),
      ).rejects.toThrow("Consent management is disabled");
    });

    it("should record consent successfully", async () => {
      const result = await gdprService.recordConsent(
        "tenant-1",
        "user-1",
        "analytics",
      );
      expect(result).toHaveProperty("consentId");
    });

    it("should throw error when consent creation fails", async () => {
      ConsentRecord.create.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        gdprService.recordConsent("tenant-1", "user-1", "analytics"),
      ).rejects.toThrow("Failed to record consent");
    });
  });

  describe("withdrawConsent", () => {
    it("should throw error when GDPR is disabled", async () => {
      process.env.GDPR_ENABLED = "false";
      await expect(
        gdprService.withdrawConsent("tenant-1", "user-1", "analytics"),
      ).rejects.toThrow("Consent management is disabled");
    });

    it("should withdraw consent successfully", async () => {
      const result = await gdprService.withdrawConsent(
        "tenant-1",
        "user-1",
        "analytics",
      );
      expect(result).toHaveProperty("withdrawn", true);
    });

    it("should throw error when consent withdraw fails", async () => {
      ConsentRecord.update.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        gdprService.withdrawConsent("tenant-1", "user-1", "analytics"),
      ).rejects.toThrow("Failed to withdraw consent");
    });
  });

  describe("getConsentHistory", () => {
    it("should return consent history", async () => {
      ConsentRecord.findAll.mockResolvedValueOnce([
        { id: "consent-1", purpose: "analytics" },
      ]);
      const result = await gdprService.getConsentHistory("tenant-1", "user-1");
      expect(result).toHaveLength(1);
      expect(result[0].purpose).toBe("analytics");
    });

    it("should return empty array on database error", async () => {
      ConsentRecord.findAll.mockRejectedValueOnce(new Error("DB error"));
      const result = await gdprService.getConsentHistory("tenant-1", "user-1");
      expect(result).toEqual([]);
    });
  });

  describe("updatePrivacyPreferences", () => {
    it("should update privacy preferences", async () => {
      const result = await gdprService.updatePrivacyPreferences(
        "tenant-1",
        "user-1",
        {
          darkMode: true,
        },
      );

      expect(result).toHaveProperty("success", true);
    });

    it("should throw error on DB update failure", async () => {
      User.update.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        gdprService.updatePrivacyPreferences("tenant-1", "user-1", {
          darkMode: true,
        }),
      ).rejects.toThrow("Failed to update preferences");
    });
  });

  describe("getPrivacyPreferences", () => {
    it("should return privacy preferences successfully", async () => {
      const result = await gdprService.getPrivacyPreferences(
        "tenant-1",
        "user-1",
      );
      expect(result).toEqual({ marketing: false });
    });

    it("should return an empty object when the user has no preferences set", async () => {
      User.findByPk.mockResolvedValueOnce({ id: "user-1", privacyPreferences: null });

      const result = await gdprService.getPrivacyPreferences("tenant-1", "user-1");

      expect(result).toEqual({});
    });

    it("should return an empty object when the user does not exist", async () => {
      User.findByPk.mockResolvedValueOnce(null);

      const result = await gdprService.getPrivacyPreferences("tenant-1", "user-1");

      expect(result).toEqual({});
    });

    it("should return empty object on error", async () => {
      User.findByPk.mockRejectedValue(new Error("db error"));
      const result = await gdprService.getPrivacyPreferences(
        "tenant-1",
        "user-1",
      );
      expect(result).toEqual({});
    });
  });

  describe("enforceDataRetention", () => {
    it("should return disabled when GDPR is disabled", async () => {
      process.env.GDPR_ENABLED = "false";
      const result = await gdprService.enforceDataRetention();

      expect(result.enforced).toBe(false);
      expect(result.reason).toBe("GDPR disabled");
    });

    it("should enforce data retention policies and purge expired data", async () => {
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        {
          id: "policy-1",
          entityType: "Logs",
          retentionDays: 30,
          isActive: true,
        },
      ]);

      const result = await gdprService.enforceDataRetention();
      expect(result.enforced).toBe(true);
      expect(result.purged).toBe(0);
    });

    it("should return failure object when database error occurs during retention run", async () => {
      DataRetentionPolicy.findAll.mockRejectedValueOnce(
        new Error("DB find failure"),
      );
      const result = await gdprService.enforceDataRetention();
      expect(result.enforced).toBe(false);
      expect(result.error).toBe("DB find failure");
    });

    it("purges a known entity type for a tenant not on legal hold", async () => {
      dataRetentionService.isOnLegalHold.mockResolvedValue(false);
      AuditLog.destroy.mockResolvedValue(4);
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        { id: "p1", entityType: "audit_logs", tenantId: "t1", retentionDays: 30, isActive: true },
      ]);

      const result = await gdprService.enforceDataRetention();

      expect(dataRetentionService.isOnLegalHold).toHaveBeenCalledWith("t1");
      expect(AuditLog.destroy).toHaveBeenCalled();
      expect(result.purged).toBe(4);
    });

    it("skips purge for a tenant on legal hold", async () => {
      dataRetentionService.isOnLegalHold.mockResolvedValue(true);
      AuditLog.destroy.mockResolvedValue(9);
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        { id: "p1", entityType: "audit_logs", tenantId: "t1", retentionDays: 30, isActive: true },
      ]);

      const result = await gdprService.enforceDataRetention();

      expect(AuditLog.destroy).not.toHaveBeenCalled();
      expect(result.purged).toBe(0);
    });

    it("purges a policy with no tenant scope without checking legal hold", async () => {
      AuditLog.destroy.mockResolvedValue(2);
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        { id: "p1", entityType: "AuditLog", retentionDays: 10, isActive: true },
      ]);

      const result = await gdprService.enforceDataRetention();

      expect(dataRetentionService.isOnLegalHold).not.toHaveBeenCalled();
      expect(result.purged).toBe(2);
    });

    it("treats a null destroy result as zero purged", async () => {
      dataRetentionService.isOnLegalHold.mockResolvedValue(false);
      AuditLog.destroy.mockResolvedValue(null);
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        { id: "p1", entityType: "audit_logs", tenantId: "t1", retentionDays: 30, isActive: true },
      ]);

      const result = await gdprService.enforceDataRetention();

      expect(result.purged).toBe(0);
    });

    it("defaults a missing retentionDays to zero (purge-from-now)", async () => {
      dataRetentionService.isOnLegalHold.mockResolvedValue(false);
      AuditLog.destroy.mockResolvedValue(1);
      DataRetentionPolicy.findAll.mockResolvedValueOnce([
        { id: "p1", entityType: "audit_logs", tenantId: "t1", isActive: true },
      ]);

      const result = await gdprService.enforceDataRetention();

      expect(AuditLog.destroy).toHaveBeenCalled();
      expect(result.purged).toBe(1);
    });
  });

  describe("createDsar", () => {
    it("should create a DSAR", async () => {
      const result = await gdprService.createDsar(
        "tenant-1",
        "user-1",
        "export",
      );
      expect(result).toHaveProperty("dsarId");
    });

    it("should throw error if DSAR creation throws database exception", async () => {
      DsarRequest.create.mockRejectedValueOnce(new Error("DB error"));
      await expect(
        gdprService.createDsar("tenant-1", "user-1", "export"),
      ).rejects.toThrow("Failed to create DSAR");
    });
  });

  describe("getDsarStatus", () => {
    it("should return dsar record", async () => {
      DsarRequest.findOne.mockResolvedValueOnce({
        id: "dsar-1",
        status: "pending",
      });
      const result = await gdprService.getDsarStatus("tenant-1", "dsar-1");
      expect(result.status).toBe("pending");
    });

    it("should return null on error", async () => {
      DsarRequest.findOne.mockRejectedValueOnce(new Error("DB error"));
      const result = await gdprService.getDsarStatus("tenant-1", "nonexistent");
      expect(result).toBeNull();
    });

    it("should return null when no DSAR matches", async () => {
      DsarRequest.findOne.mockResolvedValueOnce(undefined);

      const result = await gdprService.getDsarStatus("tenant-1", "nonexistent");

      expect(result).toBeNull();
      expect(DsarRequest.findOne).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", id: "nonexistent" },
      });
    });
  });

  describe("getStatus", () => {
    it("should return service status", () => {
      const status = gdprService.getStatus();

      expect(status).toHaveProperty("enabled", true);
      expect(status).toHaveProperty("exportRetentionHours", 168);
      expect(status).toHaveProperty("consentRequired", false);
    });
  });
});
