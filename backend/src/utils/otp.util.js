const crypto = require("crypto");

// ==========================================
// GENERATE OTP
// ==========================================

exports.generateOTP = (length = 6) => {
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

exports.hashOTP = (otp) => {
  return crypto.createHash("sha256").update(otp).digest("hex");
};

// ==========================================
// VERIFY OTP
// ==========================================

exports.verifyOTP = (otp, hashedOtp) => {
  if (!otp || !hashedOtp) return false;
  return exports.hashOTP(otp) === hashedOtp;
};
