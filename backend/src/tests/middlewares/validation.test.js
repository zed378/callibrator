/**
 * Tests for validation middleware
 */

// Mirrors the REAL response.util signature: error(res, message, statusCode,
// details). The previous mock declared (res, details, message, status), which
// matched a bug in the middleware's call site — so the tests passed while
// every real validation failure returned a 500 ("Invalid status code:
// 'Validation Error'"). Keeping the mock honest is what surfaces that.
jest.mock("../../utils/response.util", () => {
  return {
    error: jest
      .fn()
      .mockImplementation((res, message, statusCode = 400, details = null) => {
        const body = { success: false, status: statusCode, message, data: null };
        if (details) body.details = details;
        return res.status(statusCode).json(body);
      }),
  };
});

const { validate } = require("../../middlewares/validation.middleware");
const Joi = require("joi");

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
      const schema = Joi.object({
        name: Joi.string().required(),
        age: Joi.number().integer().min(0),
      });

      req.body = { name: "John", age: 25 };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.name).toBe("John");
      expect(req.body.age).toBe(25);
    });

    it("should strip unknown keys from body", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
      });

      req.body = { name: "John", unknownField: "should be stripped" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body).toHaveProperty("name", "John");
      expect(req.body).not.toHaveProperty("unknownField");
    });

    it("should return validation errors when required field is missing", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
        email: Joi.string().email().required(),
      });

      req.body = { name: "John" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it("should return formatted validation errors with field paths", () => {
      const schema = Joi.object({
        user: Joi.object({
          name: Joi.string().required(),
          email: Joi.string().email().required(),
        }).required(),
      });

      req.body = { user: { email: "invalid" } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall).toHaveProperty("details");
      expect(Array.isArray(jsonCall.details)).toBe(true);
    });

    it("should return 400 status for validation errors", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
      });

      req.body = {};

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should handle empty body", () => {
      const schema = Joi.object({
        name: Joi.string().optional(),
      });

      req.body = {};

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should validate array fields", () => {
      const schema = Joi.object({
        tags: Joi.array().items(Joi.string()).min(1),
      });

      req.body = { tags: ["tag1", "tag2"] };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject invalid array items", () => {
      const schema = Joi.object({
        tags: Joi.array().items(Joi.string()).min(1),
      });

      req.body = { tags: [123, 456] };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should handle optional fields with defaults", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
        role: Joi.string().optional().default("user"),
      });

      req.body = { name: "John" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.body.role).toBe("user");
    });

    it("should validate nested objects", () => {
      const schema = Joi.object({
        user: Joi.object({
          profile: Joi.object({
            age: Joi.number().min(0).required(),
          }).required(),
        }).required(),
      });

      req.body = { user: { profile: { age: 25 } } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject nested objects with invalid data", () => {
      const schema = Joi.object({
        user: Joi.object({
          profile: Joi.object({
            age: Joi.number().min(0).required(),
          }).required(),
        }).required(),
      });

      req.body = { user: { profile: { age: -1 } } };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should handle multiple validation errors", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
        email: Joi.string().email().required(),
        age: Joi.number().required(),
      });

      req.body = { name: 123, email: "invalid", age: "not-a-number" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      expect(jsonCall.details.length).toBeGreaterThan(1);
    });

    it("should use custom error messages", () => {
      const schema = Joi.object({
        name: Joi.string().required().messages({
          "string.empty": "Name cannot be empty",
        }),
      });

      req.body = { name: "" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      const jsonCall = res.json.mock.calls[0][0];
      const nameError = jsonCall.details.find((e) => e.field === "name");
      expect(nameError).toBeDefined();
    });

    it("should allow null for optional fields", () => {
      const schema = Joi.object({
        name: Joi.string().required(),
        middleName: Joi.string().allow(null).optional(),
      });

      req.body = { name: "John", middleName: null };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should validate boolean fields", () => {
      const schema = Joi.object({
        active: Joi.boolean().required(),
      });

      req.body = { active: true };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should reject non-boolean for boolean fields", () => {
      const schema = Joi.object({
        active: Joi.boolean().required(),
      });

      req.body = { active: "yes" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });

    it("should handle abac schema with location", () => {
      const schema = Joi.object({
        location: Joi.object({
          lat: Joi.number().required(),
          lng: Joi.number().required(),
        }).required(),
        permissions: Joi.array().items(Joi.string()).required(),
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
      const schema = Joi.object({
        username: Joi.string().alphanum().min(3).max(30).required(),
        email: Joi.string().email().required(),
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
      expect(req.body).toHaveProperty("username", "johndoe");
      expect(req.body).toHaveProperty("email", "john@example.com");
      expect(req.body).not.toHaveProperty("password");
      expect(req.body).not.toHaveProperty("createdAt");
    });

    it("should handle login schema with user field", () => {
      const schema = Joi.object({
        user: Joi.alternatives()
          .try(Joi.string().email(), Joi.string().alphanum())
          .required(),
        password: Joi.string().required(),
      });

      req.body = { user: "johndoe", password: "Password1" };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should handle register schema with all fields", () => {
      const schema = Joi.object({
        firstName: Joi.string().trim().min(2).max(100).required(),
        lastName: Joi.string().trim().allow(null, "").optional(),
        username: Joi.string().trim().alphanum().min(3).max(30).required(),
        email: Joi.string()
          .trim()
          .lowercase()
          .email()
          .min(6)
          .max(255)
          .required(),
        password: Joi.string()
          .min(8)
          .max(100)
          .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+/)
          .required(),
      });

      req.body = {
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        email: "john@example.com",
        password: "Password1",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("should handle change password schema with confirm password validation", () => {
      const schema = Joi.object({
        oldPassword: Joi.string().required(),
        newPassword: Joi.string()
          .min(8)
          .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+/)
          .required(),
        confirmPassword: Joi.any()
          .valid(Joi.ref("newPassword"))
          .required()
          .messages({
            "any.only": "Passwords do not match",
          }),
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
      const schema = Joi.object({
        oldPassword: Joi.string().required(),
        newPassword: Joi.string().min(8).required(),
        confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required(),
      });

      req.body = {
        oldPassword: "OldPass123",
        newPassword: "NewPass123",
        confirmPassword: "DifferentPass123",
      };

      const middleware = validate(schema);
      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });
  });
});
