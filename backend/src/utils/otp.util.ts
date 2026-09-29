// P9-09 (ADR-087 Amendment 5): converted from otp.util.js with no behaviour
// change. `crypto` is the module object itself (a default import of a
// CommonJS module), and `verifyOTP` reads `hashOTP` from the module's exports
// at call time, as `exports.hashOTP(...)` did (a named self-import).
import crypto from "crypto";
import { hashOTP as exportedHashOTP } from "./otp.util";

// ==========================================
// GENERATE OTP
// ==========================================

const generateOTP = (length = 6): string => {
  if (length === 6) {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(min + Math.random() * (max - min + 1)).toString();
};

// ==========================================
// HASH OTP
// ==========================================

const hashOTP = (otp: string): string => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

// ==========================================
// VERIFY OTP
// ==========================================

const verifyOTP = (otp: string | null | undefined, hashedOtp: string | null | undefined): boolean => {
  if (!otp || !hashedOtp) {return false;}
  return exportedHashOTP(otp) === hashedOtp;
};

export { generateOTP, hashOTP, verifyOTP };
