jest.mock("../../services/sop.service", () => ({
  createDocument: jest.fn(),
  getDocuments: jest.fn(),
  publishDocument: jest.fn(),
  acknowledgeTraining: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => {
  return class AppError extends Error {
    constructor(status, message) {
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

const sopService = require("../../services/sop.service");
const sopController = require("../../controllers/sop.controller");
const { error: sendError } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_DOC_ID = "550e8400-e29b-41d4-a716-446655440010";

describe("sop Controller", () => {
  let req, res, next;

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

  describe("createDocument", () => {
    it("should create document", async () => {
      sopService.createDocument.mockResolvedValue({ id: VALID_DOC_ID });
      req.body = { title: "SOP-001" };
      await sopController.createDocument(req, res, next);
      expect(sopService.createDocument).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_USER_ID, req.body);
      expect(sendError).not.toHaveBeenCalled();
    });
  });

  describe("getDocuments", () => {
    it("should return documents", async () => {
      sopService.getDocuments.mockResolvedValue([]);
      req.query = { page: "1", limit: "10" };
      await sopController.getDocuments(req, res, next);
      expect(sopService.getDocuments).toHaveBeenCalledWith(VALID_TENANT_ID, "1", "10", undefined);
    });
  });

  describe("publishDocument", () => {
    it("should publish document", async () => {
      sopService.publishDocument.mockResolvedValue({ published: true });
      req.params = { id: VALID_DOC_ID };
      await sopController.publishDocument(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      const AppError = require("../../utils/appError.util");
      sopService.publishDocument.mockRejectedValue(new AppError(404, "Document not found"));
      await sopController.publishDocument(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Document not found", 404);
    });
  });

  describe("acknowledgeTraining", () => {
    it("should acknowledge training", async () => {
      sopService.acknowledgeTraining.mockResolvedValue({ acknowledged: true });
      req.params = { id: VALID_DOC_ID };
      await sopController.acknowledgeTraining(req, res, next);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      const AppError = require("../../utils/appError.util");
      sopService.acknowledgeTraining.mockRejectedValue(new AppError(404, "Training acknowledgment not found"));
      await sopController.acknowledgeTraining(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Training acknowledgment not found", 404);
    });
  });
});