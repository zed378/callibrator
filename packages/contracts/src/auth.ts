/**
 * Auth validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod. The messages a user can act on (the password
 * rule, a mismatched confirmation) are kept word for word.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/auth.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the auth routes.
 */
import { z } from "zod";
import { email as emailAddress } from "./fields";

const email = z.string().trim().toLowerCase().pipe(emailAddress()).pipe(z.string().min(6).max(255));

const password = z
  .string()
  .min(8)
  .max(100)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, { error: "Password must contain uppercase, lowercase, and number" });

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-zA-Z0-9]+$/, { error: "Username must only contain letters and digits" })
  .min(3)
  .max(30);

const otp = z
  .string()
  .length(6)
  .regex(/^[0-9]+$/, { error: "OTP must contain digits only" });

const registerSchema = z.object({
  firstName: z.string().trim().min(2).max(100),
  // Trimmed first: "  " is an empty last name (allowed), not a too-short one.
  lastName: z.string().trim().pipe(z.string().min(2).max(100).or(z.literal(""))).nullable().optional(),
  username,
  email,
  password,
});

/** `user` / `username` / `email`: at least one names the account. */
const loginSchema = z
  .object({
    user: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    email: emailAddress().optional(),
    password: z.string().min(1),
    ip: z.string().min(1).optional(),
    userAgent: z.string().min(1).optional(),
  })
  .refine((v) => v.user !== undefined || v.username !== undefined || v.email !== undefined, {
    error: "Provide user, username or email",
  });

const verifyOtpSchema = z.object({ email, otp });

const resendOtpSchema = z.object({ email });

const forgotPasswordSchema = z.object({ email });

const resetPasswordSchema = z.object({
  email: emailAddress(),
  otp: z.string().length(6),
  // reuses the complex password rule (upper + lower + digit, min 8)
  password,
});

const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1),
    newPassword: password,
    confirmPassword: z.string({ error: "Passwords do not match" }),
  })
  .refine((v) => v.confirmPassword === v.newPassword, { error: "Passwords do not match", path: ["confirmPassword"] });

/**
 * P10-16 (ADR-099) — POST /auth/first-sign-in/password: the password-change
 * token a one-time password's first sign-in returned, and the new password
 * under the same rule as every other password a user chooses.
 */
const firstSignInPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: password,
});

export {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  firstSignInPasswordSchema,
};

// The client-side (input) and handler-side (output) types of each schema.
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterBody = z.output<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type LoginBody = z.output<typeof loginSchema>;
export type VerifyOtpInput = z.input<typeof verifyOtpSchema>;
export type VerifyOtpBody = z.output<typeof verifyOtpSchema>;
export type ResendOtpInput = z.input<typeof resendOtpSchema>;
export type ResendOtpBody = z.output<typeof resendOtpSchema>;
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;
export type ForgotPasswordBody = z.output<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
export type ResetPasswordBody = z.output<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
export type ChangePasswordBody = z.output<typeof changePasswordSchema>;
export type FirstSignInPasswordInput = z.input<typeof firstSignInPasswordSchema>;
export type FirstSignInPasswordBody = z.output<typeof firstSignInPasswordSchema>;
