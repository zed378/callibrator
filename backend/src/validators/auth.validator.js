/**
 * Auth validation schemas and validators
 * Moved from src/middlewares/inputValidation.js
 */
const Joi = require("joi");

// ==========================================
// COMMON SCHEMAS
// ==========================================

const email = Joi.string()
  .trim()
  .lowercase()
  .email()
  .min(6)
  .max(255)
  .required();

const password = Joi.string()
  .min(8)
  .max(100)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/)
  .required()
  .messages({
    "string.pattern.base":
      "Password must contain uppercase, lowercase, and number",
  });

const username = Joi.string()
  .trim()
  .lowercase()
  .alphanum()
  .min(3)
  .max(30)
  .required();

const otp = Joi.string()
  .length(6)
  .pattern(/^[0-9]+$/)
  .required();

// ==========================================
// REGISTER
// ==========================================

exports.registerSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(100).required(),
  lastName: Joi.string().trim().min(2).max(100).allow(null, ""),
  username,
  email,
  password,
});

// ==========================================
// LOGIN
// ==========================================

exports.loginSchema = Joi.object({
  user: Joi.alternatives()
    .try(Joi.string().email(), Joi.string())
    .optional(),
  username: Joi.alternatives()
    .try(Joi.string().email(), Joi.string())
    .optional(),
  email: Joi.string().email().optional(),
  password: Joi.string().required(),
  ip: Joi.string().optional(),
  userAgent: Joi.string().optional(),
}).or("user", "username", "email");

// ==========================================
// VERIFY OTP
// ==========================================

exports.verifyOtpSchema = Joi.object({
  email,
  otp,
});

// ==========================================
// RESEND OTP
// ==========================================

exports.resendOtpSchema = Joi.object({
  email,
});

// ==========================================
// FORGOT PASSWORD
// ==========================================

exports.forgotPasswordSchema = Joi.object({
  email,
});

// ==========================================
// RESET PASSWORD
// ==========================================

exports.resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
  password: password, // reuses the complex password rule (upper + lower + digit, min 8)
});

// ==========================================
// CHANGE PASSWORD
// ==========================================

exports.changePasswordSchema = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: password,
  confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "Passwords do not match",
  }),
});

// ==========================================
// VALIDATION HELPER
// ==========================================

/**
 * Validate request body against a Joi schema
 * @param {Object} body - Request body to validate
 * @param {Object} schema - Joi schema
 * @returns {Object} - { error, value }
 */
exports.validate = (body, schema) => {
  return schema.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
};

/**
 * Format validation errors for API response
 * @param {Array} details - Joi error details
 * @returns {Array} - Formatted errors
 */
exports.formatErrors = (details) => {
  return details.map((item) => ({
    field: item.path.join("."),
    message: item.message,
  }));
};
