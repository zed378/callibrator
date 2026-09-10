/**
 * Tests for batchJob controller
 */

jest.mock("../../services/batchJob.service", () => ({
  createJob: jest.fn(),
  getJobs: jest.fn(),
  getJobStatus: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.statusCode = status;
    }
  },
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const batchJobService = require("../../services/batchJob.service");
const batchJobController = require("../../controllers/batchJob.controller");
const { error: sendError } = require("../../utils/response.util");

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_JOB_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("batchJob Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      params: {},
      body: {},
      user: {
        id: VALID_USER_ID,
        tenantId: VALID_TENANT_ID,
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createTestJob", () => {
    it("should create a job with defaults", async () => {
      batchJobService.createJob.mockResolvedValue({
        id: VALID_JOB_ID,
        type: "EXPORT_CSV",
        status: "PENDING",
        totalItems: 10,
        processedItems: 0,
      });

      await batchJobController.createTestJob(req, res, next);

      expect(batchJobService.createJob).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_USER_ID,
        "EXPORT_CSV",
        10,
      );
    });

    it("should create a job with custom type and totalItems", async () => {
      req.body = { type: "IMPORT_CSV", totalItems: 1000 };
      batchJobService.createJob.mockResolvedValue({
        id: VALID_JOB_ID,
        type: "IMPORT_CSV",
        status: "PENDING",
        totalItems: 1000,
      });

      await batchJobController.createTestJob(req, res, next);

      expect(batchJobService.createJob).toHaveBeenCalledWith(
        VALID_TENANT_ID,
        VALID_USER_ID,
        "IMPORT_CSV",
        1000,
      );
    });
  });

  describe("getJobs", () => {
    it("should return paginated jobs", async () => {
      batchJobService.getJobs.mockResolvedValue([
        { id: VALID_JOB_ID, type: "EXPORT_CSV", status: "COMPLETED" },
      ]);

      await batchJobController.getJobs(req, res, next);

      expect(batchJobService.getJobs).toHaveBeenCalledWith(VALID_TENANT_ID, undefined, undefined);
    });

    it("should return paginated jobs with pagination params", async () => {
      req.query = { page: "2", limit: "50" };
      batchJobService.getJobs.mockResolvedValue([]);

      await batchJobController.getJobs(req, res, next);

      expect(batchJobService.getJobs).toHaveBeenCalledWith(VALID_TENANT_ID, "2", "50");
    });
  });

  describe("getJobStatus", () => {
    it("should return job status", async () => {
      req.params = { id: VALID_JOB_ID };
      batchJobService.getJobStatus.mockResolvedValue({
        id: VALID_JOB_ID,
        type: "EXPORT_CSV",
        status: "COMPLETED",
        totalItems: 10,
        processedItems: 10,
        progress: 100,
      });

      await batchJobController.getJobStatus(req, res, next);

      expect(batchJobService.getJobStatus).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_JOB_ID);
    });

    it("should return 404 when job not found", async () => {
      req.params = { id: VALID_JOB_ID };
      batchJobService.getJobStatus.mockRejectedValue(new Error("Job not found"));

      await batchJobController.getJobStatus(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Job not found", 404);
    });
  });
});
