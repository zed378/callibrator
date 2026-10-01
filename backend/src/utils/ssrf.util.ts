// src/utils/ssrf.util.ts
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
//
// P9-09 (ADR-087 Amendment 5): converted from ssrf.util.js with no behaviour
// change. `dns` and `net` are the module objects themselves (default imports
// of CommonJS modules), so `dns.promises.lookup` is still read at call time and
// a spy on it still reaches this code.

import axios from "axios";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import { env, isProduction } from "../config/env";
import { AppError } from "./appError.util";

// ---- IPv4 range checks (CIDR via 32-bit integer math) --------------------
const ipv4ToInt = (ip: string): number =>
  ip.split(".").reduce((acc, oct) => (acc << 8) + (parseInt(oct, 10) & 0xff), 0) >>> 0;

// Blocked IPv4 CIDRs: loopback, private (RFC1918), link-local (incl. cloud
// metadata 169.254.0.0/16), CGNAT, reserved, multicast, benchmarking, docs, etc.
const BLOCKED_IPV4 = ([
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
] as const).map(([base, bits]) => {
  // A-32: every BLOCKED_IPV4 entry has bits >= 4 (no /0), so the shift is
  // always defined; the unreachable `bits === 0 ? 0 :` guard is gone.
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  // Force unsigned (>>> 0): the bitwise & yields a signed 32-bit int, which for
  // ranges with a high first octet (e.g. 192.x, 172.x, 169.254.x) would be
  // negative and never match the unsigned masked value in isBlockedIpv4.
  return { net: (ipv4ToInt(base) & mask) >>> 0, mask };
});

const isBlockedIpv4 = (ip: string): boolean => {
  const val = ipv4ToInt(ip);
  return BLOCKED_IPV4.some(({ net: n, mask }) => (val & mask) >>> 0 === n);
};

const isBlockedIpv6 = (raw: string): boolean => {
  // Strip zone id and brackets, lowercase. split() always yields a first element.
  const ip = (raw.replace(/^\[|\]$/g, "").split("%")[0] as string).toLowerCase();
  if (ip === "::1" || ip === "::") {return true;} // loopback / unspecified
  // IPv4-mapped / -translated (::ffff:a.b.c.d, ::a.b.c.d) — check embedded v4.
  // exec() and a non-global match() return the same array (or null).
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  // The capture group always participates when the pattern matches.
  if (embedded && net.isIPv4(embedded[1] as string)) {return isBlockedIpv4(embedded[1] as string);}
  // A-176: the same forms written in hex, which is how WHATWG URL normalises
  // them (`http://[::ffff:169.254.169.254]/` has hostname `[::ffff:a9fe:a9fe]`):
  // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96) and NAT64
  // (64:ff9b::/96). Before this they fell through to "public".
  const hexEmbedded = /^(?:::ffff:|::|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (hexEmbedded) {
    const hi = parseInt(hexEmbedded[1] as string, 16);
    const lo = parseInt(hexEmbedded[2] as string, 16);
    return isBlockedIpv4(`${String(hi >> 8)}.${String(hi & 0xff)}.${String(lo >> 8)}.${String(lo & 0xff)}`);
  }
  const head = ip.split(":")[0] as string;
  if (head.startsWith("fc") || head.startsWith("fd")) {return true;} // fc00::/7 ULA
  if (["fe8", "fe9", "fea", "feb"].some((p) => head.startsWith(p))) {return true;} // fe80::/10
  if (head.startsWith("ff")) {return true;} // ff00::/8 multicast
  return false;
};

const isBlockedIp = (ip: string): boolean => {
  const kind = net.isIP(ip);
  if (kind === 4) {return isBlockedIpv4(ip);}
  if (kind === 6) {return isBlockedIpv6(ip);}
  return true; // not a valid IP → block defensively
};

/**
 * Synchronous format + literal-IP validation. Throws AppError(400) on violation.
 */
const assertSafeUrl = (rawUrl: string): URL => {
  let url: URL;
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
const assertResolvedHostIsPublic = async (rawUrl: string): Promise<void> => {
  const url = assertSafeUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {return;} // literal IP already validated by assertSafeUrl

  let addresses: dns.LookupAddress[];
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

// ---- A-176: outbound calls to tenant-chosen URLs (OIDC, AI, S3) ----------
//
// The two layers above check a URL and then let the HTTP client resolve the
// host AGAIN when it connects — a DNS-rebinding window (answer a public IP to
// the check, 169.254.169.254 to the connect). The helpers below close it: the
// agents' `lookup` IS the check, so the address that passed is the address
// that is dialled. Redirects are refused (maxRedirects 0), responses are
// capped, and a timeout always applies.

/**
 * Hosts a developer may point these calls at although they are internal (a
 * local OIDC provider, a local model server): `SSRF_DEV_ALLOW_HOSTS`, a
 * comma-separated list of hostnames. Ignored in production — always empty
 * there, whatever the variable says.
 */
const devAllowedHosts = (): string[] => {
  if (isProduction()) {
    return [];
  }
  return (env("SSRF_DEV_ALLOW_HOSTS") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== "");
};

const isDevAllowedHost = (host: string): boolean =>
  devAllowedHosts().includes(host.replace(/^\[|\]$/g, "").toLowerCase());

/**
 * Validate a tenant-chosen URL the server will call: https only in
 * production, then assertSafeUrl — unless the host is on the development
 * allow-list (never in production). Throws AppError(400) with a message that
 * names the setting when one is given.
 */
const assertOutboundUrl = (rawUrl: string, label = "URL"): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(400, `${label} is not a valid URL`);
  }
  if (isProduction() && url.protocol !== "https:") {
    throw new AppError(400, `${label} must use https`);
  }
  if (isDevAllowedHost(url.hostname)) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AppError(400, `${label} must use http or https`);
    }
    return url;
  }
  try {
    return assertSafeUrl(rawUrl);
  } catch (err) {
    throw new AppError(400, `${label}: ${(err as Error).message}`);
  }
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement for http(s) agents: resolves every address and
 * refuses the connection when ANY of them is internal (unless the host is
 * development-allowed). The connection then uses an address that passed.
 */
const ssrfSafeLookup = (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, []);
      return;
    }
    const list = addresses;
    const allowed = isDevAllowedHost(hostname);
    if (list.length === 0 || (!allowed && list.some(({ address }) => isBlockedIp(address)))) {
      const refused: NodeJS.ErrnoException = new Error(
        `SSRF guard: ${hostname} resolves to a disallowed (internal) address`,
      );
      refused.code = "ESSRFBLOCKED";
      callback(refused, []);
      return;
    }
    if (options.all) {
      callback(null, list);
      return;
    }
    const first = list[0] as dns.LookupAddress;
    callback(null, first.address, first.family);
  });
};

/** http/https agents whose every connection goes through ssrfSafeLookup. */
const ssrfSafeAgents = (): { httpAgent: http.Agent; httpsAgent: https.Agent } => ({
  httpAgent: new http.Agent({ lookup: ssrfSafeLookup }),
  httpsAgent: new https.Agent({
    lookup: ssrfSafeLookup,
    rejectUnauthorized: true,
  }),
});

/** Default cap on a response from a tenant-chosen URL (2 MiB). */
const OUTBOUND_MAX_BYTES = 2 * 1024 * 1024;

/**
 * axios options for a call to a tenant-chosen URL: pinned-lookup agents, no
 * redirects, no environment proxy (a proxy would resolve the host itself and
 * bypass the lookup), a timeout and a response-size cap.
 */
const ssrfSafeAxiosOptions = ({
  timeoutMs,
  maxBytes = OUTBOUND_MAX_BYTES,
}: {
  timeoutMs: number;
  maxBytes?: number;
}): {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  maxRedirects: 0;
  proxy: false;
  timeout: number;
  maxContentLength: number;
} => ({
  ...ssrfSafeAgents(),
  maxRedirects: 0,
  proxy: false,
  timeout: timeoutMs,
  maxContentLength: maxBytes,
});

/** The part of a fetch `RequestInit` pinnedFetch honours. */
interface PinnedFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Accepted for fetch parity; a pinned request never follows a redirect. */
  redirect?: "manual";
  /** Always set; there is no un-timed pinned request. */
  timeoutMs: number;
}

/**
 * A-307 — a fetch-shaped POST/GET through the pinned agents, for a caller
 * written against `fetch` (the webhook sender). Node's `fetch` takes no agent,
 * so it resolved the host again after the SSRF check: a rebinding window.
 *
 * Kept from fetch with `redirect: "manual"`: a 3xx is RETURNED, never
 * followed; every status resolves (no throw on 4xx/5xx); the body is sent
 * byte-for-byte (no JSON re-serialisation — a signature covers it) and the
 * response body is never read (discarded unread, so no size cap applies to
 * it); an aborted request rejects with an error named "AbortError".
 */
const pinnedFetch = async (url: string, init: PinnedFetchInit): Promise<{ ok: boolean; status: number }> => {
  try {
    const res = await axios.request<NodeJS.ReadableStream & { destroy(): void }>({
      url,
      method: init.method ?? "GET",
      ...(init.body === undefined ? {} : { data: init.body }),
      ...(init.headers === undefined ? {} : { headers: init.headers }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
      ...ssrfSafeAxiosOptions({ timeoutMs: init.timeoutMs }),
      validateStatus: () => true,
      responseType: "stream",
      transformRequest: [(data: unknown) => data],
    });
    res.data.destroy();
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    if (axios.isCancel(err) || (err as { code?: string }).code === "ECONNABORTED") {
      const aborted = new Error("The operation was aborted");
      aborted.name = "AbortError";
      throw aborted;
    }
    throw err;
  }
};

export {
  pinnedFetch,
  assertSafeUrl,
  assertResolvedHostIsPublic,
  isBlockedIp,
  assertOutboundUrl,
  ssrfSafeLookup,
  ssrfSafeAgents,
  ssrfSafeAxiosOptions,
  OUTBOUND_MAX_BYTES,
};
