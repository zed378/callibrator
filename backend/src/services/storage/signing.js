/**
 * HMAC signing for local/NFS object download URLs.
 *
 * Kept in one place so the driver that MINTS a token and the route that
 * VERIFIES it can never disagree on the construction — a one-character
 * mismatch there would reject every legitimate local download.
 *
 * (S3 does not use this: it issues real presigned URLs the client fetches
 * straight from the bucket.)
 */

const crypto = require("crypto");

/** Token = `<exp>.<hmac(secret, "<key>.<exp>")>`. */
const sign = (key, ttlSec, secret) => {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${key}.${exp}`)
    .digest("hex");
  return { token: `${exp}.${sig}`, exp };
};

/** Constant-time verification. Returns false on any malformed/expired token. */
const verify = (key, token, secret) => {
  if (!token || typeof token !== "string" || !secret) {return false;}

  const dot = token.indexOf(".");
  if (dot <= 0) {return false;}
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || !sig) {return false;}
  if (Math.floor(Date.now() / 1000) > exp) {return false;}

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${key}.${exp}`)
    .digest("hex");
  // timingSafeEqual throws on a length mismatch, so guard it first — a forged
  // token of the wrong length must return false, not raise.
  if (sig.length !== expected.length) {return false;}
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

module.exports = { sign, verify };
