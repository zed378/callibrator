// src/utils/ssrf.util.js
//
// SSRF (Server-Side Request Forgery) protection for user-supplied outbound URLs
// (e.g. tenant-registered webhook targets). A tenant admin must not be able to
// point an outbound request at loopback, link-local, private, or cloud-metadata
// addresses to reach internal services or the instance metadata endpoint
// (169.254.169.254).
//
// Two layers are provided:
//   assertSafeUrl(url)            — synchronous format + literal-IP check, run at
//                                   registration/update time for fast feedback.
//   assertResolvedHostIsPublic(url) — async DNS resolution check, run immediately
//                                   before the request so a hostname that resolves
//                                   to an internal IP (or DNS-rebinding) is blocked.

const dns = require("dns");
const net = require("net");
const { AppError } = require("./appError.util");

// ---- IPv4 range checks (CIDR via 32-bit integer math) --------------------
const ipv4ToInt = (ip) =>
  ip.split(".").reduce((acc, oct) => (acc << 8) + (parseInt(oct, 10) & 0xff), 0) >>> 0;

// Blocked IPv4 CIDRs: loopback, private (RFC1918), link-local (incl. cloud
// metadata 169.254.0.0/16), CGNAT, reserved, multicast, benchmarking, docs, etc.
const BLOCKED_IPV4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
].map(([base, bits]) => {
  // istanbul ignore next -- unreachable: BLOCKED_IPV4 contains no /0 entry, so
  // `bits === 0` is never true; the branch is a defensive guard only.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  // Force unsigned (>>> 0): the bitwise & yields a signed 32-bit int, which for
  // ranges with a high first octet (e.g. 192.x, 172.x, 169.254.x) would be
  // negative and never match the unsigned masked value in isBlockedIpv4.
  return { net: (ipv4ToInt(base) & mask) >>> 0, mask };
});

const isBlockedIpv4 = (ip) => {
  const val = ipv4ToInt(ip);
  return BLOCKED_IPV4.some(({ net: n, mask }) => (val & mask) >>> 0 === n);
};

const isBlockedIpv6 = (raw) => {
  // Strip zone id and brackets, lowercase.
  const ip = raw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  // IPv4-mapped / -translated (::ffff:a.b.c.d, ::a.b.c.d) — check embedded v4.
  const embedded = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded && net.isIPv4(embedded[1])) return isBlockedIpv4(embedded[1]);
  const head = ip.split(":")[0];
  if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 ULA
  if (["fe8", "fe9", "fea", "feb"].some((p) => head.startsWith(p))) return true; // fe80::/10
  if (head.startsWith("ff")) return true; // ff00::/8 multicast
  return false;
};

const isBlockedIp = (ip) => {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP → block defensively
};

/**
 * Synchronous format + literal-IP validation. Throws AppError(400) on violation.
 */
const assertSafeUrl = (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, "Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "URL must use http or https");
  }
  if (url.username || url.password) {
    throw new AppError(400, "URL must not contain embedded credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    throw new AppError(400, "URL host is not allowed");
  }
  // If the host is a literal IP, block internal ranges immediately.
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new AppError(400, "URL host resolves to a disallowed (internal) address");
  }
  return url;
};

/**
 * Async DNS-resolution guard. Resolves the host and rejects if ANY resolved
 * address is internal. Run immediately before making the outbound request.
 */
const assertResolvedHostIsPublic = async (rawUrl) => {
  const url = assertSafeUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return; // literal IP already validated by assertSafeUrl

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new AppError(400, "URL host could not be resolved");
  }
  if (!addresses.length) {
    throw new AppError(400, "URL host could not be resolved");
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new AppError(400, "URL host resolves to a disallowed (internal) address");
    }
  }
};

module.exports = { assertSafeUrl, assertResolvedHostIsPublic, isBlockedIp };
