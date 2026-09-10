const Joi = require("joi");

// ==========================================
// COMMON
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

exports.registerValidation = Joi.object({
  firstName: Joi.string().trim().min(2).max(100).required(),
  lastName: Joi.string().trim().min(2).max(100).allow(null, ""),
  username,
  email,
  password,
});

// ==========================================
// LOGIN
// ==========================================

exports.loginValidation = Joi.object({
  user: Joi.alternatives()
    .try(Joi.string().email(), Joi.string().alphanum())
    .required(),
  password: Joi.string().required(),
});

// ==========================================
// VERIFY OTP
// ==========================================

exports.verifyOtpValidation = Joi.object({
  email,
  otp,
});

// ==========================================
// RESEND OTP
// ==========================================

exports.resendOtpValidation = Joi.object({
  email,
});

// ==========================================
// FORGOT PASSWORD
// ==========================================

exports.forgotPasswordValidation = Joi.object({
  email,
});

// ==========================================
// RESET PASSWORD
// ==========================================

exports.resetPasswordValidation = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
  password: Joi.string().min(8).required(),
});

// ==========================================
// CHANGE PASSWORD
// ==========================================

exports.changePasswordValidation = Joi.object({
  oldPassword: Joi.string().required(),
  newPassword: password,
  confirmPassword: Joi.any().valid(Joi.ref("newPassword")).required().messages({
    "any.only": "Passwords do not match",
  }),
});
