/**
 * Tests for response utility
 */

const {
  success,
  error,
  paginate,
  notFound,
  badRequest,
  unauthorized,
  forbidden,
  paginated,
  login,
} = require("../../utils/response.util");

describe("response utils", () => {
  let res;
  let jsonCalls;

  beforeEach(() => {
    jsonCalls = [];
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonCalls.push(data);
        return { send: jest.fn() };
      }),
    };
  });

  describe("success", () => {
    it("should send a success response with data and message", () => {
      success(res, { id: "1" }, "Created", 201);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(jsonCalls[0]).toMatchObject({
        success: true,
        data: { id: "1" },
        message: "Created",
      });
    });

    it("should default to 200 status", () => {
      success(res, { id: "1" }, "OK");

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should default message to success", () => {
      success(res, { id: "1" });

      expect(jsonCalls[0].message).toBe("success");
    });

    it("should send null data when provided", () => {
      success(res, null, "No data");

      expect(jsonCalls[0].data).toBeNull();
    });

    it("should include meta when provided", () => {
      success(res, [{ id: 1 }], { total: 10, page: 1 }, "Success", 200);

      expect(jsonCalls[0]).toHaveProperty("meta");
      expect(jsonCalls[0].meta.total).toBe(10);
    });

    it("should include auth data when provided", () => {
      success(res, { user: "test" }, null, "Login", 200, {
        token: "abc123",
        session: { id: "s1", createdAt: "2024-01-01", expiresAt: "2024-12-31" },
      });

      expect(jsonCalls[0]).toHaveProperty("token", "abc123");
      expect(jsonCalls[0]).toHaveProperty("session");
    });

    it("should handle meta as second param with message as fourth", () => {
      success(res, { id: 1 }, { page: 1 }, "OK", 200);

      expect(jsonCalls[0].meta).toEqual({ page: 1 });
      expect(jsonCalls[0].status).toBe(200);
    });

    it("should handle default parameter fallback when data is undefined", () => {
      success(res);
      expect(jsonCalls[0].data).toBeNull();
    });

    it("should handle metaOrMessage being string and messageOrStatusCode not a number", () => {
      success(res, null, "message", null, 201);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should handle metaOrMessage being string and statusCode not a number", () => {
      success(res, null, "message", null, "invalid");
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should use number from messageOrStatusCode when metaOrMessage is not a string", () => {
      success(res, null, null, 201);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("should default status to 200 when messageOrStatusCode is not number or string", () => {
      success(res, null, null, null, undefined);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should handle partial authData in success", () => {
      success(res, null, null, null, 200, { token: "abc" });
      expect(jsonCalls[0].token).toBe("abc");
      expect(jsonCalls[0].session).toBeUndefined();

      success(res, null, null, null, 200, { session: { id: "1" } });
      expect(jsonCalls[1].token).toBeUndefined();
      expect(jsonCalls[1].session).toEqual({ id: "1" });
    });
  });

  describe("error", () => {
    it("should send an error response", () => {
      error(res, "Something went wrong", 500);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(jsonCalls[0]).toMatchObject({
        success: false,
        message: "Something went wrong",
      });
    });

    it("should default to 400 status", () => {
      error(res, "Bad request");

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should include details in non-production", () => {
      process.env.NODE_ENV = "development";
      error(res, "Error", 500, { field: "email" });

      expect(jsonCalls[0]).toHaveProperty("details");
      expect(jsonCalls[0].details.field).toBe("email");
      process.env.NODE_ENV = "test";
    });

    it("should not include details in production", () => {
      process.env.NODE_ENV = "production";
      error(res, "Error", 500, { field: "email" });

      expect(jsonCalls[0].details).toBeUndefined();
      process.env.NODE_ENV = "test";
    });

    it("should set data to null", () => {
      error(res, "Error", 400);

      expect(jsonCalls[0].data).toBeNull();
    });
  });

  describe("notFound", () => {
    it("should send 404 response", () => {
      notFound(res, "User not found");

      expect(res.status).toHaveBeenCalledWith(404);
      expect(jsonCalls[0].message).toBe("User not found");
    });

    it("should default to Resource not found", () => {
      notFound(res);

      expect(jsonCalls[0].message).toBe("Resource not found");
    });
  });

  describe("badRequest", () => {
    it("should send 400 response", () => {
      badRequest(res, "Invalid input");

      expect(res.status).toHaveBeenCalledWith(400);
      expect(jsonCalls[0].message).toBe("Invalid input");
    });

    it("should default to Bad request", () => {
      badRequest(res);

      expect(jsonCalls[0].message).toBe("Bad request");
    });
  });

  describe("unauthorized", () => {
    it("should send 401 response", () => {
      unauthorized(res, "Not authenticated");

      expect(res.status).toHaveBeenCalledWith(401);
      expect(jsonCalls[0].message).toBe("Not authenticated");
    });

    it("should default to Unauthorized", () => {
      unauthorized(res);

      expect(jsonCalls[0].message).toBe("Unauthorized");
    });
  });

  describe("forbidden", () => {
    it("should send 403 response", () => {
      forbidden(res, "No permission");

      expect(res.status).toHaveBeenCalledWith(403);
      expect(jsonCalls[0].message).toBe("No permission");
    });

    it("should default to Forbidden", () => {
      forbidden(res);

      expect(jsonCalls[0].message).toBe("Forbidden");
    });
  });

  describe("paginated", () => {
    it("should send paginated response", () => {
      res.query = { page: "1", limit: "10" };
      paginated(res, [{ id: 1 }], 100, "Success", 200);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(jsonCalls[0].meta).toEqual({
        total: 100,
        page: 1,
        limit: 10,
        totalPages: 10,
      });
    });

    it("should include customCounts", () => {
      res.query = { page: "1", limit: "10" };
      paginated(res, [{ id: 1 }], 100, "Success", 200, { active: 50 });

      expect(jsonCalls[0].meta.customCounts).toEqual({ active: 50 });
    });

    it("should handle default page and limit", () => {
      res.query = {};
      paginated(res, [], 0);

      expect(jsonCalls[0].meta.page).toBe(1);
      expect(jsonCalls[0].meta.limit).toBe(20);
    });

    it("should handle res.query being missing entirely", () => {
      const resNoQuery = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockImplementation((data) => {
          jsonCalls.push(data);
          return { send: jest.fn() };
        }),
      };
      paginated(resNoQuery, [], 0);
      expect(jsonCalls[jsonCalls.length - 1].meta.page).toBe(1);
      expect(jsonCalls[jsonCalls.length - 1].meta.limit).toBe(20);
    });
  });

  describe("login", () => {
    it("should send login response with token and session", () => {
      const session = {
        id: "sess-123",
        createdAt: "2024-01-01T00:00:00Z",
        expiresAt: "2024-12-31T23:59:59Z",
      };
      login(res, { user: "test" }, "token-abc", session);

      expect(jsonCalls[0].token).toBe("token-abc");
      expect(jsonCalls[0].session.id).toBe("sess-123");
      expect(jsonCalls[0].success).toBe(true);
    });

    it("should handle null session", () => {
      login(res, { user: "test" }, "token-abc", null);

      expect(jsonCalls[0].token).toBe("token-abc");
      expect(jsonCalls[0].session).toBeUndefined();
    });
  });

  describe("paginate", () => {
    it("should paginate an array of items", () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      const result = paginate(items, 1, 10, 11);

      expect(result.data).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(11);
      expect(result.totalPages).toBe(2);
    });

    it("should handle empty array", () => {
      const result = paginate([], 1, 10, 0);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle default parameters in paginate", () => {
      const items = [1, 2, 3];
      const result = paginate(items);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.total).toBe(3);
    });
  });
});
