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
      rm: jest.fn(),
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
    // A-153/A-154: the erasure runs in a managed transaction.
    transaction: jest.fn(async (cb) => cb({ id: "tx" })),
  },
}));

jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../utils/upload.util", () => ({ deleteUpload: jest.fn() }));
jest.mock("../../services/session.service", () => ({
  revokeOtherSessions: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../services/mfa.service", () => ({
  MFA_CLEARED: { mfaEnabled: false, mfaSecret: null },
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
    // A-180: the export reads the subject's sessions through unscoped().
    Session: (() => {
      const m = model();
      m.unscoped = jest.fn(() => m);
      return m;
    })(),
    CalibrationDevice: model(),
    CalibrationRecord: model(),
    Certificate: model(),
    ConsentRecord: model(),
    DsarRequest: model(),
    // A-151: the subject-scoped export reads these by their model name.
    StockTransfer: model(),
    StockAdjustment: model(),
    StockOpname: model(),
    MaintenanceWorkOrder: model(),
  };
});

const gdprService = require("../../services/gdpr.service");
const {
  User,
  ConsentRecord,
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
    // D-24 (ADR-070): the export streams — consume the iterable like Node does.
    fs.promises.writeFile.mockImplementation(async (file, content) => {
      if (typeof content !== "string") {
        for await (const chunk of content) {
          void chunk;
        }
      }
    });
    fs.promises.stat.mockResolvedValue({ size: 1024 });
    fs.promises.rm.mockResolvedValue(undefined);
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

    it("should throw 404 if user not found, and remove the partial export (A-151)", async () => {
      jest.useRealTimers();
      User.findOne.mockResolvedValueOnce(null);
      await expect(
        gdprService.exportUserData("tenant-1", "nonexistent"),
      ).rejects.toMatchObject({ status: 404, message: "User not found" });
      expect(fs.promises.rm).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
        force: true,
      });
    });

    it("should handle warning errors in nested exports blocks and continue", async () => {
      const { AuditLog } = require("../../models");
      AuditLog.findAll.mockRejectedValueOnce(new Error("Audit logs error"));

      const resultPromise = gdprService.exportUserData("tenant-1", "user-1");
      await jest.runAllTimersAsync();
      const result = await resultPromise;
      expect(result).toHaveProperty("exportId");
    });

    it("a subject table that cannot be read fails the export, not silently (A-151)", async () => {
      jest.useRealTimers();
      const { CalibrationRecord } = require("../../models");
      CalibrationRecord.findAll.mockRejectedValueOnce(new Error("table gone"));

      await expect(gdprService.exportUserData("tenant-1", "user-1")).rejects.toMatchObject({
        status: 500,
        message: "Failed to export user data",
      });
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

    // A-124: every erasure names its requester, the audit row's actor.
    it("refuses an erasure that names no requester, and erases nothing", async () => {
      await expect(gdprService.eraseUserData("tenant-1", "user-1")).rejects.toMatchObject({
        status: 400,
        message: "An erasure must name the user who requested it",
      });
      expect(User.update).not.toHaveBeenCalled();
    });

    it("records the requester as the erasure's actor, inside the erasure's transaction", async () => {
      const auditService = require("../../services/audit.service");
      await gdprService.eraseUserData("tenant-1", "user-1", { requestedBy: "dpo-1" });

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "dpo-1", resourceId: "user-1", action: "DELETE" }),
        { transaction: { id: "tx" } },
      );
    });

    it("should anonymize user by default", async () => {
      const result = await gdprService.eraseUserData("tenant-1", "user-1", { requestedBy: "user-1" });

      expect(result).toHaveProperty("erased", true);
      expect(result).toHaveProperty("method", "anonymized");
      expect(result).toHaveProperty("erasureDate");
    });

    it("should soft delete when anonymize is false", async () => {
      const result = await gdprService.eraseUserData("tenant-1", "user-1", {
        anonymize: false,
        requestedBy: "user-1",
      });

      expect(result.method).toBe("soft_deleted");
    });

    // D-11: there is no physical delete. The flag used to run a paranoid
    // (soft) destroy that left every column readable and report "hard_deleted".
    it.each([
      [{ hardDelete: true, anonymize: false }],
      [{ hardDelete: true }],
    ])("D-11: refuses hardDelete (%j) with a 400 that says what an erasure does instead, and touches nothing", async (flags) => {
      await expect(
        gdprService.eraseUserData("tenant-1", "user-1", { ...flags, requestedBy: "user-1" }),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/^A physical delete of an account is not offered: .*pseudonymises the account in place/),
      });
      expect(User.update).not.toHaveBeenCalled();
      expect(User.destroy).not.toHaveBeenCalled();
    });

    it("should throw AppError on database exception during erasure", async () => {
      User.update.mockRejectedValueOnce(new Error("Update failed"));
      await expect(
        gdprService.eraseUserData("tenant-1", "user-1", { requestedBy: "user-1" }),
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
