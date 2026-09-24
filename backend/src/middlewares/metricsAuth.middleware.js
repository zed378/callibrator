const crypto = require("crypto");

/** A token shorter than this is refused as unset: it would be guessable. */
const MIN_TOKEN_LENGTH = 32;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest();

/**
 * Gate for the metrics endpoint (P7-02): `Authorization: Bearer
 * <METRICS_TOKEN>`.
 *
 * A scraper (Prometheus, an uptime agent) has no user, so a session gate does
 * not fit and an API key would carry tenant permissions it must not have. A
 * single static operator token does.
 *
 * - METRICS_TOKEN unset, or shorter than 32 characters: 404, as if the route
 *   did not exist. Metrics are OFF until an operator turns them on.
 * - Wrong or missing token: 401.
 * - The comparison hashes both sides first, so it is constant-time and
 *   length-independent.
 */
const metricsAuth = (req, res, next) => {
  const expected = String(process.env.METRICS_TOKEN || "");
  if (expected.length < MIN_TOKEN_LENGTH) {
    return res.status(404).json({ success: false, status: 404, message: "Not found", data: null });
  }
  const header = String(req.headers.authorization || "");
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!crypto.timingSafeEqual(sha256(presented), sha256(expected))) {
    return res.status(401).json({ success: false, status: 401, message: "Unauthorized", data: null });
  }
  return next();
};

module.exports = { metricsAuth, MIN_TOKEN_LENGTH };
