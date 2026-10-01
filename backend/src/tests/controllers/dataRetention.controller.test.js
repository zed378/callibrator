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

// The validator module is NOT mocked: the real Zod schemas check every call,
// so the tenant and record ids below are real uuids.
const TENANT = "5a0e8400-e29b-41d4-a716-446655440040";
const RECORD = "5a0e8400-e29b-41d4-a716-446655440041";
const SUBJECT = "5a0e8400-e29b-41d4-a716-446655440042";

jest.mock("../../utils/response.util", () => ({
  success: jest.fn((res, data, meta, message, status) => {
    res.status(status || 200).json({ success: true, data, message });
  }),
  error: jest.fn(),
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
      req.params = { tenantId: TENANT };
      dataRetentionService.getRetentionPolicy.mockResolvedValue({ days: 30 });
      await dataRetentionController.getRetentionPolicy(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("setRetentionPolicy", () => {
    it("should set policy", async () => {
      req.body = { tenantId: TENANT, policyKey: "default", days: 90 };
      dataRetentionService.setRetentionPolicy.mockResolvedValue({});
      await dataRetentionController.setRetentionPolicy(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("isOnLegalHold", () => {
    it("should return legal hold status", async () => {
      req.params = { tenantId: TENANT };
      dataRetentionService.isOnLegalHold.mockResolvedValue(false);
      await dataRetentionController.isOnLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("enableLegalHold", () => {
    it("should enable legal hold", async () => {
      req.body = { tenantId: TENANT };
      dataRetentionService.enableLegalHold.mockResolvedValue({});
      await dataRetentionController.enableLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("disableLegalHold", () => {
    it("should disable legal hold", async () => {
      req.params = { tenantId: TENANT };
      dataRetentionService.disableLegalHold.mockResolvedValue({});
      await dataRetentionController.disableLegalHold(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("purgeExpiredRecords", () => {
    it("should purge records", async () => {
      req.params = { tenantId: TENANT };
      dataRetentionService.purgeExpiredRecords.mockResolvedValue({ purged: 10 });
      await dataRetentionController.purgeExpiredRecords(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe("maskPII", () => {
    it("should mask PII", async () => {
      req.body = { tenantId: TENANT, entityType: "user", recordIds: [RECORD] };
      dataRetentionService.maskPII.mockResolvedValue({ masked: 1 });
      await dataRetentionController.maskPII(req, res, next);
      expect(res.json).toHaveBeenCalled();
      expect(dataRetentionService.maskPII).toHaveBeenCalledWith(
        TENANT,
        "user",
        [RECORD],
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("A-135: passes the data subjects, and the actor, when masking audit rows", async () => {
      req.body = { tenantId: TENANT, entityType: "audit_logs", subjectIds: [SUBJECT] };
      req.ip = "10.0.0.1";
      req.headers = { "user-agent": "ops" };
      dataRetentionService.maskPII.mockResolvedValue({ masked: 3 });

      await dataRetentionController.maskPII(req, res, next);

      expect(dataRetentionService.maskPII).toHaveBeenCalledWith(TENANT, "audit_logs", [SUBJECT], {
        userId: "user-1",
        tenantId: "tenant-1",
        ipAddress: "10.0.0.1",
        userAgent: "ops",
      });
    });
  });

  describe("maskPII — A-135 refusals", () => {
    it("refuses audit-row ids for audit_logs, naming both fields", async () => {
      req.body = { tenantId: TENANT, entityType: "audit_logs", recordIds: [RECORD] };

      await dataRetentionController.maskPII(req, res, next);

      expect(dataRetentionService.maskPII).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [
          { field: "subjectIds", message: "subjectIds is required when entityType is audit_logs" },
          { field: "recordIds", message: "recordIds is not allowed when entityType is audit_logs" },
        ],
      });
    });

    it("refuses a tenantId that is not a uuid", async () => {
      req.params = { tenantId: "tenant-1" };

      await dataRetentionController.getRetentionPolicy(req, res, next);

      expect(dataRetentionService.getRetentionPolicy).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith({
        status: 400,
        message: "Validation failed",
        errors: [{ field: "tenantId", message: "Invalid GUID" }],
      });
    });
  });

  describe("anonymizeDataset", () => {
    it("should anonymize dataset", async () => {
      req.body = { tenantId: TENANT, entityType: "user", options: {} };
      dataRetentionService.anonymizeDataset.mockResolvedValue({ anonymized: 100 });
      await dataRetentionController.anonymizeDataset(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });
  });
});
// A-153: each hold / policy change passes the request's actor to the service,
// which writes the audit row inside its transaction.
describe("A-153 — the retention writes pass the request's actor", () => {
  const req = () => ({
    params: { tenantId: TENANT },
    body: { policyKey: "sessions", days: 60, reason: "litigation" },
    query: {},
    user: { id: "admin-1", tenantId: "platform" },
    ip: "10.0.0.1",
    headers: { "user-agent": "ua" },
  });
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  const ACTOR = { userId: "admin-1", tenantId: "platform", ipAddress: "10.0.0.1", userAgent: "ua" };

  beforeEach(() => jest.clearAllMocks());

  it("setRetentionPolicy", async () => {
    await dataRetentionController.setRetentionPolicy(req(), res(), jest.fn());
    expect(dataRetentionService.setRetentionPolicy).toHaveBeenCalledWith(
      TENANT,
      "sessions",
      60,
      ACTOR,
    );
  });

  it("enableLegalHold", async () => {
    await dataRetentionController.enableLegalHold(req(), res(), jest.fn());
    expect(dataRetentionService.enableLegalHold).toHaveBeenCalledWith(TENANT, ACTOR, "litigation");
  });

  it("disableLegalHold", async () => {
    await dataRetentionController.disableLegalHold(req(), res(), jest.fn());
    expect(dataRetentionService.disableLegalHold).toHaveBeenCalledWith(TENANT, ACTOR);
  });
});
