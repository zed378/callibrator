/**
 * Tests for audit.service.js
 *
 * Covers: logAction, fetchAuditLogs
 *
 * NOTE: Service exports are logAction (not logAudit) and fetchAuditLogs (not getAuditLogs).
 * No getAuditStats function exists.
 */

jest.mock("../../config", () => ({
  Sequelize: { useCLS: jest.fn() },
  db: {},
}));

jest.mock("../../models", () => ({
  AuditLog: {
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
  User: {},
}));

jest.mock("sequelize", () => ({
  Op: { gte: Symbol("gte"), lte: Symbol("lte") },
}));

const { AuditLog } = require("../../models");
const auditService = require("../../services/audit.service");

describe("audit.service", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  // ================================================================
  describe("logAction", () => {
    it("should create an audit log entry", async () => {
      const mockLog = { id: "log-1", tenantId: "t-1" };
      AuditLog.create.mockResolvedValueOnce(mockLog);

      const result = await auditService.logAction({
        tenantId: "t-1",
        userId: "user-1",
        action: "create",
        resourceType: "tenant",
        resourceId: "t-1",
      });

      expect(result).toEqual(mockLog);
      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          userId: "user-1",
          action: "create",
          resourceType: "tenant",
          resourceId: "t-1",
        }),
      );
    });

    it("should include optional fields", async () => {
      AuditLog.create.mockResolvedValueOnce({ id: "log-1" });

      await auditService.logAction({
        tenantId: "t-1",
        userId: "user-1",
        action: "login",
        resourceType: "session",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
      });

      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
        }),
      );
    });

    it("should return null on error without throwing", async () => {
      AuditLog.create.mockRejectedValueOnce(new Error("DB down"));

      const result = await auditService.logAction({
        tenantId: "t-1",
        userId: "user-1",
        action: "delete",
        resourceType: "user",
        resourceId: "u-1",
      });

      expect(result).toBeNull();
    });

    it("should default resourceId to null when not provided", async () => {
      AuditLog.create.mockResolvedValueOnce({ id: "log-1" });

      await auditService.logAction({
        tenantId: "t-1",
        userId: "user-1",
        action: "update",
        resourceType: "tenant",
      });

      expect(AuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: null }),
      );
    });
  });

  // ================================================================
  describe("fetchAuditLogs", () => {
    it("should return paginated audit logs with defaults", async () => {
      const mockRows = [
        {
          id: "log-1",
          action: "create",
          toJSON: () => ({ id: "log-1", action: "create", createdAt: new Date().toISOString() }),
        },
      ];
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 1, rows: mockRows });

      const result = await auditService.fetchAuditLogs({ tenantId: "t-1" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.meta.total).toBe(1);
      expect(result.data.meta.page).toBe(1);
      expect(result.data.rows).toHaveLength(1);
    });

    it("should filter by userId", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 5, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", userId: "user-1" });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "user-1" }),
        }),
      );
    });

    it("should filter by resourceType", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", resourceType: "certificate" });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceType: "certificate" }),
        }),
      );
    });

    it("should filter by action", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", action: "delete" });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: "delete" }),
        }),
      );
    });

    it("should filter by date range using Op.gte/Op.lte", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({
        tenantId: "t-1",
        startDate: "2024-01-01",
        endDate: "2024-12-31",
      });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.any(Object),
          }),
        }),
      );
    });

    it("should return empty results when no logs match", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      const result = await auditService.fetchAuditLogs({ tenantId: "t-1" });

      expect(result.data.meta.total).toBe(0);
      expect(result.data.meta.totalPages).toBe(0);
      expect(result.data.rows).toHaveLength(0);
    });

    it("should apply MAX_LIMIT cap on limit", async () => {
      const { MAX_LIMIT } = require("../../constants");
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", limit: 99999 });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: MAX_LIMIT,
        }),
      );
    });

    it("should throw on DB error", async () => {
      AuditLog.findAndCountAll.mockRejectedValueOnce(new Error("DB connection failed"));

      await expect(auditService.fetchAuditLogs({ tenantId: "t-1" }))
        .rejects.toMatchObject({ status: 500, message: "DB connection failed" });
    });
  });

  // ================================================================
  // Coverage: transform helpers, single-sided filters, error defaults
  // ================================================================
  describe("transformLog (via logAction)", () => {
    it("returns null when the created row is null", async () => {
      AuditLog.create.mockResolvedValueOnce(null);

      const result = await auditService.logAction({
        tenantId: "t-1",
        userId: "u-1",
        action: "create",
        resourceType: "tenant",
      });

      expect(result).toBeNull();
    });

    it("spreads a plain object row that has no toJSON", async () => {
      AuditLog.create.mockResolvedValueOnce({ id: "log-1", action: "create" });

      const result = await auditService.logAction({
        tenantId: "t-1",
        userId: "u-1",
        action: "create",
        resourceType: "tenant",
      });

      expect(result).toEqual({ id: "log-1", action: "create" });
    });

    it("uses toJSON when the row is a Sequelize instance", async () => {
      AuditLog.create.mockResolvedValueOnce({
        id: "log-1",
        toJSON: () => ({ id: "log-1", serialized: true }),
      });

      const result = await auditService.logAction({
        tenantId: "t-1",
        userId: "u-1",
        action: "create",
        resourceType: "tenant",
      });

      expect(result).toEqual({ id: "log-1", serialized: true });
    });
  });

  describe("fetchAuditLogs coverage gaps", () => {
    it("filters by resourceId", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", resourceId: "res-9" });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resourceId: "res-9" }),
        }),
      );
    });

    it("applies only Op.gte when startDate is given without endDate", async () => {
      const { Op } = require("sequelize");
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", startDate: "2024-01-01" });

      const where = AuditLog.findAndCountAll.mock.calls[0][0].where;
      expect(where.createdAt[Op.gte]).toEqual(new Date("2024-01-01"));
      expect(where.createdAt[Op.lte]).toBeUndefined();
    });

    it("applies only Op.lte when endDate is given without startDate", async () => {
      const { Op } = require("sequelize");
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", endDate: "2024-12-31" });

      const where = AuditLog.findAndCountAll.mock.calls[0][0].where;
      expect(where.createdAt[Op.lte]).toEqual(new Date("2024-12-31"));
      expect(where.createdAt[Op.gte]).toBeUndefined();
    });

    it("omits createdAt entirely when neither date bound is given", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1" });

      const where = AuditLog.findAndCountAll.mock.calls[0][0].where;
      expect(where).not.toHaveProperty("createdAt");
      expect(where).toEqual({ tenantId: "t-1" });
    });

    it("falls back to DEFAULT_LIMIT when limit is not a number", async () => {
      const { DEFAULT_LIMIT } = require("../../constants");
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await auditService.fetchAuditLogs({ tenantId: "t-1", limit: "abc" });

      expect(AuditLog.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: DEFAULT_LIMIT }),
      );
    });

    it("tolerates an undefined rows array from the model", async () => {
      AuditLog.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: undefined });

      const result = await auditService.fetchAuditLogs({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([]);
    });

    it("defaults status to 500 and message when the error carries neither", async () => {
      AuditLog.findAndCountAll.mockRejectedValueOnce({});

      await expect(auditService.fetchAuditLogs({ tenantId: "t-1" })).rejects.toEqual({
        status: 500,
        message: "Failed to fetch audit logs",
      });
    });

    it("preserves a non-500 status carried by the error", async () => {
      AuditLog.findAndCountAll.mockRejectedValueOnce({ status: 403, message: "Nope" });

      await expect(auditService.fetchAuditLogs({ tenantId: "t-1" })).rejects.toEqual({
        status: 403,
        message: "Nope",
      });
    });
  });
});
