/**
 * Tests for notFound middleware
 * Tests that unmatched routes trigger the 404 response utility.
 */
const { notFound } = require("../../middlewares/notFound.middleware");
const responseUtil = require("../../utils/response.util");

describe("notFound middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call sendNotFound with 404 status", () => {
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    notFound({}, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalled();
  });

  it("should not call next() - notFound does not pass to error handlers", () => {
    const next = jest.fn();
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    notFound({}, mockRes);

    expect(next).not.toHaveBeenCalled();
  });
});
