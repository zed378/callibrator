/**
 * Tests for feature flag controller
 */

jest.mock("../../services/featureFlag.service", () => ({
  getTenantFlags: jest.fn(),
  isEnabled: jest.fn(),
  setTenantFlag: jest.fn(),
  resetTenantFlag: jest.fn(),
  initializeTenantFlags: jest.fn(),
  DEFAULT_FLAGS: {
    enable_iot: { category: "calibration", defaultValue: true, description: "Enable IoT" },
    enable_mfa: { category: "platform", defaultValue: false, description: "Enable MFA" },
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface FakeQuery {
  tenantId?: string;
  flagKey?: string;
  [key: string]: unknown;
}

interface FakeParams {
  tenantId?: string;
  flagKey?: string;
  [key: string]: unknown;
}

interface FakeReq {
  query: FakeQuery;
  params: FakeParams;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
}

interface FeatureFlagServiceMock {
  getTenantFlags: jest.Mock;
  isEnabled: jest.Mock;
  setTenantFlag: jest.Mock;
  resetTenantFlag: jest.Mock;
  initializeTenantFlags: jest.Mock;
  DEFAULT_FLAGS: Record<string, unknown>;
}

interface FeatureFlagController {
  getTenantFlags: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
  isFlagEnabled: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
  setTenantFlag: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
  resetTenantFlag: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
  initializeTenantFlags: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
  getAllFlagDefinitions: (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<void>;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const featureFlagService = require("../../services/featureFlag.service") as FeatureFlagServiceMock;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const featureFlagController = require("../../controllers/featureFlag.controller") as FeatureFlagController;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success, error } = require("../../utils/response.util") as ResponseDouble;

// A-272 (ADR-100): a thrown validateInput failure answers like validate() —
// "Validation Error" with the field list as details (it was "[object Object]").
const FIELD_ERRORS: unknown = expect.arrayContaining([
  expect.objectContaining({ field: expect.any(String) as unknown, message: expect.any(String) as unknown }),
]);

describe("featureFlag Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;
  const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
  const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((resArg: FakeRes, data: unknown, _meta: unknown, message: string, status?: number) => {
      resArg.status(status ?? 200);
      resArg.json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
        role: { name: "USER" },
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("getTenantFlags", () => {
    it("should return all flags for tenant", async () => {
      req.query.tenantId = VALID_TENANT_ID;
      featureFlagService.getTenantFlags.mockResolvedValue({
        enable_iot: { enabled: true, category: "calibration", defaultValue: true, tenantOverride: false },
        enable_mfa: { enabled: false, category: "platform", defaultValue: false, tenantOverride: true },
      });

      await featureFlagController.getTenantFlags(req, res, next);

      expect(featureFlagService.getTenantFlags).toHaveBeenCalledWith(VALID_TENANT_ID);
      expect(success).toHaveBeenCalled();
    });

    it("answers 400 through the real schema when tenantId is not a uuid", async () => {
      req.query.tenantId = "not-a-uuid";

      await featureFlagController.getTenantFlags(req, res, next);

      expect(featureFlagService.getTenantFlags).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, FIELD_ERRORS); // A-272 (ADR-100)
    });
  });

  describe("isFlagEnabled", () => {
    it("should return flag status", async () => {
      req.params.tenantId = VALID_TENANT_ID;
      req.params.flagKey = "enable_iot";
      featureFlagService.isEnabled.mockResolvedValue(true);

      await featureFlagController.isFlagEnabled(req, res, next);

      expect(featureFlagService.isEnabled).toHaveBeenCalledWith(VALID_TENANT_ID, "enable_iot");
      expect(success).toHaveBeenCalledWith(
        res,
        { flagKey: "enable_iot", enabled: true },
        null,
        "Flag status fetched",
      );
    });

    it("should return disabled flag status", async () => {
      req.params.tenantId = VALID_TENANT_ID;
      req.query.flagKey = "enable_mfa";
      featureFlagService.isEnabled.mockResolvedValue(false);

      await featureFlagController.isFlagEnabled(req, res, next);

      expect(featureFlagService.isEnabled).toHaveBeenCalledWith(VALID_TENANT_ID, "enable_mfa");
      expect(success).toHaveBeenCalledWith(
        res,
        { flagKey: "enable_mfa", enabled: false },
        null,
        "Flag status fetched",
      );
    });
  });

  describe("setTenantFlag", () => {
    it("should set a feature flag for tenant", async () => {
      req.body = {
        tenantId: VALID_TENANT_ID,
        flagKey: "enable_iot",
        enabled: true,
      };
      featureFlagService.setTenantFlag.mockResolvedValue({
        flagKey: "enable_iot",
        enabled: true,
        created: false,
      });

      await featureFlagController.setTenantFlag(req, res, next);

      expect(featureFlagService.setTenantFlag).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        "enable_iot",
        true,
        VALID_USER_ID,
        expect.objectContaining({ apiKeyId: null }),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("resetTenantFlag", () => {
    it("should reset a feature flag to default", async () => {
      req.params.tenantId = VALID_TENANT_ID;
      req.params.flagKey = "enable_iot";
      featureFlagService.resetTenantFlag.mockResolvedValue({
        flagKey: "enable_iot",
        reset: true,
        defaultValue: true,
      });

      await featureFlagController.resetTenantFlag(req, res, next);

      expect(featureFlagService.resetTenantFlag).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        "enable_iot",
        expect.objectContaining({ apiKeyId: null }),
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("initializeTenantFlags", () => {
    it("should initialize default flags for tenant", async () => {
      req.params.tenantId = VALID_TENANT_ID;
      req.params.flagKey = "enable_iot";
      featureFlagService.initializeTenantFlags.mockResolvedValue({
        enable_iot: { enabled: true, category: "calibration", defaultValue: true, tenantOverride: false },
      });

      await featureFlagController.initializeTenantFlags(req, res, next);

      expect(featureFlagService.initializeTenantFlags).toHaveBeenCalledWith(VALID_TENANT_ID, expect.objectContaining({ apiKeyId: null }));
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getAllFlagDefinitions", () => {
    it("should return all flag definitions", async () => {
      await featureFlagController.getAllFlagDefinitions(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        featureFlagService.DEFAULT_FLAGS,
        null,
        "Fetch flag definitions successful",
      );
    });
  });
});
