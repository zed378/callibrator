/**
 * Tests for validation middleware
 *
 * P9-11 (ADR-093): the middleware (validation.middleware.ts) takes Zod
 * schemas. Every case below was an old-library schema; each is rewritten as the Zod
 * schema that states the same rule, and the old messages the cases relied on
 * are now asserted as Zod's. The source option and the typed `validated()`
 * reader are covered by validation.p911.test.ts.
 */

// Mirrors the REAL response.util signature: error(res, message, statusCode,
// details, extra). The previous mock declared (res, details, message, status),
// which matched a bug in the middleware's call site — so the tests passed
// while every real validation failure returned a 500 ("Invalid status code:
// 'Validation Error'"). Keeping the mock honest is what surfaces that. The
// real error() adds `details` only outside production; tests run outside it.
jest.mock("../../utils/response.util", () => {
  return {
    error: jest
      .fn()
      .mockImplementation((res, message, statusCode = 400, details = null, extra = null) => {
        const body = { success: false, status: statusCode, message, data: null, ...(extra || {}) };
        if (details) {body.details = details;}
        return res.status(statusCode).json(body);
      }),
  };
});

const { z } = require("zod");
const { validate } = require("../../middlewares/validation.middleware");
const { error } = require("../../utils/response.util");

describe("validation middleware", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    next = jest.fn();

    req = {
      body: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe("validate", () => {
    it("should pass valid data to next()", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().int().min(0).optional(),
      });

      req.body = { name: "John", age: 25 };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.name).toBe("John");
      expect(req.body.age).toBe(25);
    });

    it("should set req.validated to the parsed value as well as req.body", () => {
      const schema = z.object({ name: z.string().trim() });

      req.body = { name: "  John  ", extra: 1 };

      validate(schema)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.validated).toEqual({ name: "John" });
      expect(req.body).toEqual({ name: "John" });
    });

    it("should strip unknown keys from body", () => {
      const schema = z.object({
        name: z.string(),
      });

      req.body = { name: "John", unknownField: "should be stripped" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toHaveProperty("name", "John");
      expect(req.body).not.toHaveProperty("unknownField");
    });

    it("should return validation errors when required field is missing", () => {
      const schema = z.object({
        name: z.string(),
        email: z.email(),
      });

      req.body = { name: "John" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        status: 400,
        message: "Validation Error",
        data: null,
        details: [{ field: "email", message: "Invalid input: expected string, received undefined" }],
      });
    });

    it("should answer through response.util#error with (res, message, status, details)", () => {
      const schema = z.object({ name: z.string() });

      req.body = {};

      validate(schema)(req, res, next);

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(res, "Validation Error", 400, [
        { field: "name", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should return formatted validation errors with field paths", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.email(),
        }),
      });

      req.body = { user: { email: "invalid" } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.details).toEqual([
        { field: "user.name", message: "Invalid input: expected string, received undefined" },
        { field: "user.email", message: "Invalid email address" },
      ]);
    });

    it("should return 400 status for validation errors", () => {
      const schema = z.object({
        name: z.string(),
      });

      req.body = {};

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    // A-09. Express 5 leaves req.body undefined when no body was sent. Under
    // the old library, `undefined` was VALID against a non-required object schema — so
    // this gate once called next() with req.body === undefined and the
    // controller's first `req.body.x` threw a TypeError, reported as a 500.
    it("should return 400, not pass through, when the body is absent entirely (A-09)", () => {
      const schema = z.object({
        name: z.string(),
      });

      req.body = undefined;

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.details.map((d) => d.field)).toContain("name");
    });

    it("should call next() with a real object body when the body is absent and every field is optional (A-09)", () => {
      const schema = z.object({
        note: z.string().optional(),
      });

      req.body = undefined;

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      // The handler downstream must be able to destructure it.
      expect(req.body).toEqual({});
      expect(() => {
        const { note } = req.body;
        return note;
      }).not.toThrow();
    });

    it("should handle empty body", () => {
      const schema = z.object({
        name: z.string().optional(),
      });

      req.body = {};

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should validate array fields", () => {
      const schema = z.object({
        tags: z.array(z.string()).min(1).optional(),
      });

      req.body = { tags: ["tag1", "tag2"] };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid array items, naming each item", () => {
      const schema = z.object({
        tags: z.array(z.string()).min(1).optional(),
      });

      req.body = { tags: [123, 456] };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].details).toEqual([
        { field: "tags.0", message: "Invalid input: expected string, received number" },
        { field: "tags.1", message: "Invalid input: expected string, received number" },
      ]);
    });

    it("should handle optional fields with defaults", () => {
      const schema = z.object({
        name: z.string(),
        role: z.string().default("user"),
      });

      req.body = { name: "John" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.role).toBe("user");
    });

    it("should validate nested objects", () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            age: z.number().min(0),
          }),
        }),
      });

      req.body = { user: { profile: { age: 25 } } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject nested objects with invalid data", () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            age: z.number().min(0),
          }),
        }),
      });

      req.body = { user: { profile: { age: -1 } } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].details).toEqual([
        { field: "user.profile.age", message: "Too small: expected number to be >=0" },
      ]);
    });

    it("should handle multiple validation errors", () => {
      const schema = z.object({
        name: z.string(),
        email: z.email(),
        age: z.number(),
      });

      req.body = { name: 123, email: "invalid", age: "not-a-number" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.details).toEqual([
        { field: "name", message: "Invalid input: expected string, received number" },
        { field: "email", message: "Invalid email address" },
        { field: "age", message: "Invalid input: expected number, received string" },
      ]);
    });

    it("should use custom error messages", () => {
      const schema = z.object({
        name: z.string().min(1, { error: "Name cannot be empty" }),
      });

      req.body = { name: "" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      const nameError = jsonCall.details.find((e) => e.field === "name");
      expect(nameError).toEqual({ field: "name", message: "Name cannot be empty" });
    });

    it("should allow null for optional fields", () => {
      const schema = z.object({
        name: z.string(),
        middleName: z.string().nullable().optional(),
      });

      req.body = { name: "John", middleName: null };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.middleName).toBeNull();
    });

    it("should validate boolean fields", () => {
      const schema = z.object({
        active: z.boolean(),
      });

      req.body = { active: true };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject non-boolean for boolean fields", () => {
      const schema = z.object({
        active: z.boolean(),
      });

      req.body = { active: "yes" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should handle abac schema with location", () => {
      const schema = z.object({
        location: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        permissions: z.array(z.string()),
      });

      req.body = {
        location: { lat: 40.7128, lng: -74.006 },
        permissions: ["read", "write"],
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should sanitize input by stripping extra fields", () => {
      const schema = z.object({
        username: z.string().regex(/^[a-zA-Z0-9]+$/).min(3).max(30),
        email: z.email(),
      });

      req.body = {
        username: "johndoe",
        email: "john@example.com",
        password: "should-be-stripped",
        createdAt: "2024-01-01",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toEqual({ username: "johndoe", email: "john@example.com" });
    });

    it("should handle login schema with user field", () => {
      const schema = z.object({
        user: z.union([z.email(), z.string().regex(/^[a-zA-Z0-9]+$/)]),
        password: z.string(),
      });

      req.body = { user: "johndoe", password: "Password1" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should handle register schema with all fields", () => {
      const schema = z.object({
        firstName: z.string().trim().min(2).max(100),
        lastName: z.string().trim().nullable().optional(),
        username: z.string().trim().regex(/^[a-zA-Z0-9]+$/).min(3).max(30),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .pipe(z.email().min(6).max(255)),
        password: z
          .string()
          .min(8)
          .max(100)
          .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+/),
      });

      req.body = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: " John@Example.com ",
        password: "Password1",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.email).toBe("john@example.com");
    });

    it("should handle change password schema with confirm password validation", () => {
      const schema = z
        .object({
          oldPassword: z.string(),
          newPassword: z
            .string()
            .min(8)
            .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+/),
          confirmPassword: z.string(),
        })
        .refine((body) => body.confirmPassword === body.newPassword, {
          error: "Passwords do not match",
          path: ["confirmPassword"],
        });

      req.body = {
        oldPassword: "OldPass123",
        newPassword: "NewPass123",
        confirmPassword: "NewPass123",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject mismatched confirm password", () => {
      const schema = z
        .object({
          oldPassword: z.string(),
          newPassword: z.string().min(8),
          confirmPassword: z.string(),
        })
        .refine((body) => body.confirmPassword === body.newPassword, {
          error: "Passwords do not match",
          path: ["confirmPassword"],
        });

      req.body = {
        oldPassword: "OldPass123",
        newPassword: "NewPass123",
        confirmPassword: "DifferentPass123",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].details).toEqual([
        { field: "confirmPassword", message: "Passwords do not match" },
      ]);
    });

    it("should check the query without replacing the body when the source is the query", () => {
      const schema = z.object({ page: z.string() });

      req.body = { untouched: true };
      req.query = { page: "2", extra: "x" };

      validate(schema, { from: "query" })(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.validated).toEqual({ page: "2" });
      expect(req.body).toEqual({ untouched: true });
    });
  });
});
