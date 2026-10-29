jest.mock("../../services/supplierScorecard.service", () => ({
  createScorecard: jest.fn(),
  getScorecards: jest.fn(),
  getScorecardById: jest.fn(),
  updateScorecard: jest.fn(),
  deleteScorecard: jest.fn(),
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

interface ScorecardServiceDouble {
  createScorecard: jest.Mock;
  getScorecards: jest.Mock;
  getScorecardById: jest.Mock;
  updateScorecard: jest.Mock;
  deleteScorecard: jest.Mock;
}

type Handler = (req: unknown, res: unknown, next?: unknown) => Promise<unknown>;

interface ScorecardControllerDouble {
  createScorecard: Handler;
  getScorecards: Handler;
  getScorecardById: Handler;
  updateScorecard: Handler;
  deleteScorecard: Handler;
}

interface ResponseUtilDouble {
  success: jest.Mock;
  error: jest.Mock;
}

interface AppErrorDouble {
  status: number;
  message: string;
}

type AppErrorConstructor = new (status: number, message: string) => AppErrorDouble & Error;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const AppError = require("../../utils/appError.util") as unknown as AppErrorConstructor;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const scorecardService = require("../../services/supplierScorecard.service") as ScorecardServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const supplierScorecardController = require("../../controllers/supplierScorecard.controller") as ScorecardControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { error: sendError, success } = require("../../utils/response.util") as ResponseUtilDouble;

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

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_SC_ID = "550e8400-e29b-41d4-a716-446655440010";

describe("supplierScorecard Controller", () => {
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

  describe("createScorecard", () => {
    it("should create scorecard", async () => {
      scorecardService.createScorecard.mockResolvedValue({ id: VALID_SC_ID });
      req.body = { vendorId: "vendor-1", score: 90 };
      await supplierScorecardController.createScorecard(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });
  });

  describe("getScorecards", () => {
    it("reshapes the paged result into rows + top-level meta", async () => {
      scorecardService.getScorecards.mockResolvedValue({
        rows: [{ id: VALID_SC_ID }],
        total: 5,
        page: 2,
        totalPages: 3,
      });
      req.query = { page: "2", limit: "2" };

      await supplierScorecardController.getScorecards(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: VALID_SC_ID }],
        { total: 5, page: 2, limit: 2, totalPages: 3 },
        "Scorecards retrieved successfully",
        200,
      );
    });

    it("defaults limit to 10 when the query omits it", async () => {
      scorecardService.getScorecards.mockResolvedValue({
        rows: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });
      req.query = {};

      await supplierScorecardController.getScorecards(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        [],
        { total: 0, page: 1, limit: 10, totalPages: 0 },
        "Scorecards retrieved successfully",
        200,
      );
    });
  });

  describe("getScorecardById", () => {
    it("should return scorecard by id", async () => {
      scorecardService.getScorecardById.mockResolvedValue({ id: VALID_SC_ID });
      req.params = { id: VALID_SC_ID };
      await supplierScorecardController.getScorecardById(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      scorecardService.getScorecardById.mockRejectedValue(new AppError(404, "Scorecard not found"));
      await supplierScorecardController.getScorecardById(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Scorecard not found", 404);
    });
  });

  describe("updateScorecard", () => {
    it("should update scorecard", async () => {
      scorecardService.updateScorecard.mockResolvedValue({ id: VALID_SC_ID });
      req.params = { id: VALID_SC_ID };
      req.body = { score: 95 };
      await supplierScorecardController.updateScorecard(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      req.body = { score: 95 };
      scorecardService.updateScorecard.mockRejectedValue(new AppError(404, "Scorecard not found"));
      await supplierScorecardController.updateScorecard(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Scorecard not found", 404);
    });
  });

  describe("deleteScorecard", () => {
    it("should delete scorecard", async () => {
      scorecardService.deleteScorecard.mockResolvedValue(true);
      req.params = { id: VALID_SC_ID };
      await supplierScorecardController.deleteScorecard(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      scorecardService.deleteScorecard.mockRejectedValue(new AppError(404, "Scorecard not found"));
      await supplierScorecardController.deleteScorecard(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Scorecard not found", 404);
    });
  });
});
