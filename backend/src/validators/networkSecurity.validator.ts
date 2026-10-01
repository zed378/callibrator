/**
 * Network security request bodies (IP allow-list, geofence, login evaluation).
 *
 * P9-11 (ADR-093): moved to Zod.
 */
import { isIP } from "net";
import { z } from "zod";
import { numeric } from "./fields";

const latitude = numeric(z.number().min(-90).max(90));
const longitude = numeric(z.number().min(-180).max(180));

/** The one message for an allowlist entry that is not an address or range. */
const CIDR_MESSAGE = "Expected an IPv4 or IPv6 address or CIDR";

/**
 * ADR-100 amendment (2026-09-30) — one allowlist entry, normalised.
 *
 * It accepted IPv4 only (and let `999.1.1.1/40` through), while sign-in
 * enforcement (signInPolicy.service#addressAllowed) matches IPv6 too, so an
 * IPv6-only client could never be allowlisted. Now:
 *  - an IPv4 or IPv6 address, or a CIDR with a prefix in range (≤32 / ≤128);
 *  - trimmed, and IPv6 lower-cased;
 *  - an IPv4-mapped IPv6 entry (`::ffff:a.b.c.d`, `::ffff:a.b.c.d/n` with
 *    n ≥ 96) is stored as its IPv4 form (`a.b.c.d/n-96`), the way the sign-in
 *    matcher and utils/ssrf.util.ts treat a mapped address, so one range is
 *    written one way. A mapped prefix below 96 covers non-mapped space and is
 *    refused.
 *
 * @returns the canonical entry, or null when it is not an address or range
 */
export const normaliseAllowlistEntry = (raw: string): string | null => {
  const text = raw.trim();
  const slash = text.indexOf("/");
  const address = slash < 0 ? text : text.slice(0, slash);
  const prefixText = slash < 0 ? null : text.slice(slash + 1);
  if (prefixText !== null && !/^\d{1,3}$/.test(prefixText)) {
    return null;
  }
  const prefix = prefixText === null ? null : Number(prefixText);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1] !== undefined) {
    if (prefix !== null && prefix < 96) {
      return null;
    }
    return normaliseAllowlistEntry(prefix === null ? mapped[1] : `${mapped[1]}/${String(prefix - 96)}`);
  }
  const family = isIP(address);
  if (family === 0) {
    return null;
  }
  if (prefix !== null && prefix > (family === 4 ? 32 : 128)) {
    return null;
  }
  const canonical = family === 6 ? address.toLowerCase() : address;
  return prefix === null ? canonical : `${canonical}/${String(prefix)}`;
};

const allowlistEntry = z.string().transform((value, ctx) => {
  const entry = normaliseAllowlistEntry(value);
  if (entry === null) {
    ctx.addIssue({ code: "custom", message: CIDR_MESSAGE });
    return z.NEVER;
  }
  return entry;
});

const ipAllowlistSchema = z.object({
  cidrs: z.array(allowlistEntry),
});

const geofenceSchema = z.object({
  latitude,
  longitude,
  radiusKm: numeric(z.number().positive()).optional(),
});

/** An IPv4 or IPv6 address, with or without a CIDR suffix. */
const ip = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()], { error: "Invalid IP address" });

const evaluateLoginSchema = z.object({
  ip,
  latitude: latitude.optional(),
  longitude: longitude.optional(),
});

export { ipAllowlistSchema, geofenceSchema, evaluateLoginSchema };
