jest.mock("../../services/risk.service", () => ({
  createRisk: jest.fn(),
  getRisks: jest.fn(),
  getRiskById: jest.fn(),
  updateRisk: jest.fn(),
  deleteRisk: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => {
  return class AppError extends Error {
    status: number;
    statusCode: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.statusCode = status;
    }
  };
});

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
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

type Handler = (req: FakeReq, res: FakeRes, next: jest.Mock) => Promise<unknown>;

interface RiskServiceDouble {
  createRisk: jest.Mock;
  getRisks: jest.Mock;
  getRiskById: jest.Mock;
  updateRisk: jest.Mock;
  deleteRisk: jest.Mock;
}

interface RiskControllerDouble {
  createRisk: Handler;
  getRisks: Handler;
  getRiskById: Handler;
  updateRisk: Handler;
  deleteRisk: Handler;
}

interface ResponseDouble {
  success: jest.Mock;
  error: jest.Mock;
}

type AppErrorCtor = new (status: number, message: string) => Error;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const riskService = require("../../services/risk.service") as RiskServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const riskController = require("../../controllers/risk.controller") as RiskControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success, error: sendError } = require("../../utils/response.util") as ResponseDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const AppError = require("../../utils/appError.util") as AppErrorCtor;

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_RISK_ID = "550e8400-e29b-41d4-a716-446655440010";

describe("risk Controller", () => {
  let req: FakeReq;
  let res: FakeRes;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: VALID_USER_ID, tenantId: VALID_TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createRisk", () => {
    it("should create risk", async () => {
      riskService.createRisk.mockResolvedValue({ id: VALID_RISK_ID });
      req.body = { title: "Test risk" };
      await riskController.createRisk(req, res, next);
      expect(success).toHaveBeenCalledWith(
        res,
        expect.any(Object),
        null,
        "Risk created successfully",
        201,
      );
    });
  });

  describe("getRisks", () => {
    it("reshapes the paged result into rows + top-level meta", async () => {
      riskService.getRisks.mockResolvedValue({
        rows: [{ id: VALID_RISK_ID }],
        total: 7,
        page: 2,
        totalPages: 4,
      });
      req.query = { page: "2", limit: "2" };

      await riskController.getRisks(req, res, next);

      // data is the array; pagination is the meta sibling.
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: VALID_RISK_ID }],
        { total: 7, page: 2, limit: 2, totalPages: 4 },
        "Risks retrieved successfully",
        200,
      );
    });

    it("defaults limit to 10 when the query omits it", async () => {
      riskService.getRisks.mockResolvedValue({
        rows: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });
      req.query = {};

      await riskController.getRisks(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        [],
        { total: 0, page: 1, limit: 10, totalPages: 0 },
        "Risks retrieved successfully",
        200,
      );
    });
  });

  describe("getRiskById", () => {
    it("should return risk by id", async () => {
      riskService.getRiskById.mockResolvedValue({ id: VALID_RISK_ID });
      req.params = { id: VALID_RISK_ID };
      await riskController.getRiskById(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      riskService.getRiskById.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.getRiskById(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });

  describe("updateRisk", () => {
    it("should update risk", async () => {
      riskService.updateRisk.mockResolvedValue({ id: VALID_RISK_ID });
      req.params = { id: VALID_RISK_ID };
      req.body = { title: "Updated" };
      await riskController.updateRisk(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      req.body = { title: "Updated" };
      riskService.updateRisk.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.updateRisk(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });

  describe("deleteRisk", () => {
    it("should delete risk", async () => {
      riskService.deleteRisk.mockResolvedValue(true);
      req.params = { id: VALID_RISK_ID };
      await riskController.deleteRisk(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      riskService.deleteRisk.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.deleteRisk(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });
});
