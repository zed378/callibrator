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

  // P6-02 (ADR-077): the shape PostgreSQL's uuid type accepts. The old
  // version-1-5 pattern refused the ids this system seeds (menu groups are
  // `a0000000-0000-0000-0000-…`), so a permission override on a seeded menu
  // group could never be deleted — found by the live E2E suite.
  it.each([
    ["a seeded menu group id (version nibble 0)", "a0000000-0000-0000-0000-000000000002"],
    ["the nil uuid", "00000000-0000-0000-0000-000000000000"],
    ["a version 6 uuid", "550e8400-e29b-61d4-a716-446655440000"],
    ["a version 7 uuid", "01890a5d-ac96-774b-bcce-b302099a8057"],
    ["upper case", "550E8400-E29B-41D4-A716-446655440000"],
  ])("passes %s through to the handler", (_label, id) => {
    req.params.id = id;
    validateUuid("id")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-hex digit", "g50e8400-e29b-41d4-a716-446655440000"],
    ["a missing group", "550e8400-e29b-41d4-446655440000"],
    ["no hyphens", "550e8400e29b41d4a716446655440000"],
    ["a trailing character", "550e8400-e29b-41d4-a716-4466554400001"],
    ["an injection attempt", "550e8400-e29b-41d4-a716-446655440000' OR 1=1"],
  ])("refuses %s with 400", (_label, id) => {
    req.params.id = id;
    validateUuid("id")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
