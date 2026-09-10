/**
 * Tests for validateUuid middleware
 */
jest.mock("uuid", () => ({
  v4: () => "aaaaaaaa-bbbb-1ccc-9ddd-eeeeeeeeeeee",
}));

const { validateUuid } = require("../../middlewares/validateUuid.middleware");

describe("validateUuid middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { params: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("should call next() for a valid UUID", () => {
    req.params.id = "550e8400-e29b-41d4-a716-446655440000";
    const middleware = validateUuid("id");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 400 for an invalid UUID", () => {
    req.params.id = "not-a-uuid";
    const middleware = validateUuid("id");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        status: 400,
        message: expect.stringContaining("Invalid id"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should call next() when param is undefined", () => {
    const middleware = validateUuid("id");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should call next() when param is empty string", () => {
    req.params.id = "";
    const middleware = validateUuid("id");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should validate multiple params", () => {
    req.params.userId = "550e8400-e29b-41d4-a716-446655440000";
    req.params.roleId = "660e8400-e29b-41d4-a716-446655440001";
    const middleware = validateUuid("userId", "roleId");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should fail on second invalid param", () => {
    req.params.userId = "550e8400-e29b-41d4-a716-446655440000";
    req.params.roleId = "invalid";
    const middleware = validateUuid("userId", "roleId");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Invalid roleId"),
      }),
    );
  });

  it("should reject UUID with version 6+ digit", () => {
    req.params.id = "550e8400-e29b-61d4-a716-446655440000"; // version 6
    const middleware = validateUuid("id");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
