jest.mock("../../services/dataRetention.service", () => ({
  getRetentionPolicy: jest.fn(),
  setRetentionPolicy: jest.fn(),
  isOnLegalHold: jest.fn(),
  enableLegalHold: jest.fn(),
  disableLegalHold: jest.fn(),
  purgeExpiredRecords: jest.fn(),
  maskPII: jest.fn(),
  anonymizeDataset: jest.fn(),
}));

jest.mock("../../validators/dataRetention.validator", () => ({
  validate: jest.fn((data) => data),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
}));

const dataRetentionController = require("../../controllers/dataRetention.controller");
const dataRetentionService = require("../../services/dataRetention.service");

describe("dataRetention Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { params: {}, body: {}, query: {}, user: { id: "user-1", tenantId: "tenant-1" } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    next = jest.fn();
  });

  describe("getRetentionPolicy", () => {
    it("should return policy", async () => {
      req.params = { tenantId: "tenant-1" };
      dataRetentionService.getRetentionPolicy.mockResolvedValue({ days: 30 });
      await dataRetentionController.getRetentionPolicy(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("setRetentionPolicy", () => {
    it("should set policy", async () => {
      req.body = { tenantId: "tenant-1", policyKey: "default", days: 90 };
      dataRetentionService.setRetentionPolicy.mockResolvedValue({});
      await dataRetentionController.setRetentionPolicy(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("isOnLegalHold", () => {
    it("should return legal hold status", async () => {
      req.params = { tenantId: "tenant-1" };
      dataRetentionService.isOnLegalHold.mockResolvedValue(false);
      await dataRetentionController.isOnLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("enableLegalHold", () => {
    it("should enable legal hold", async () => {
      req.body = { tenantId: "tenant-1" };
      dataRetentionService.enableLegalHold.mockResolvedValue({});
      await dataRetentionController.enableLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("disableLegalHold", () => {
    it("should disable legal hold", async () => {
      req.params = { tenantId: "tenant-1" };
      dataRetentionService.disableLegalHold.mockResolvedValue({});
      await dataRetentionController.disableLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("purgeExpiredRecords", () => {
    it("should purge records", async () => {
      req.params = { tenantId: "tenant-1" };
      dataRetentionService.purgeExpiredRecords.mockResolvedValue({ purged: 10 });
      await dataRetentionController.purgeExpiredRecords(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("maskPII", () => {
    it("should mask PII", async () => {
      req.body = { tenantId: "tenant-1", entityType: "user", recordIds: ["id-1"] };
      dataRetentionService.maskPII.mockResolvedValue({ masked: 1 });
      await dataRetentionController.maskPII(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("anonymizeDataset", () => {
    it("should anonymize dataset", async () => {
      req.body = { tenantId: "tenant-1", entityType: "user", options: {} };
      dataRetentionService.anonymizeDataset.mockResolvedValue({ anonymized: 100 });
      await dataRetentionController.anonymizeDataset(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });
});