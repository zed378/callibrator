/**
 * ADR-100 amendment (2026-09-30) — the IP allowlist accepts IPv6 and IPv6
 * CIDR, normalised, and an IPv4-mapped entry is stored as its IPv4 form.
 * Before, the validator accepted IPv4 only (and out-of-range octets and
 * prefixes), while sign-in enforcement matched IPv6: an IPv6-only client could
 * never be allowlisted.
 */
import { ipAllowlistSchema, normaliseAllowlistEntry } from "../../validators/networkSecurity.validator";
import { addressAllowed } from "../../services/signInPolicy.service";

const parse = (cidrs: unknown[]): ReturnType<typeof ipAllowlistSchema.safeParse> => ipAllowlistSchema.safeParse({ cidrs });

describe("accepted, and normalised", () => {
  it.each([
    ["10.0.0.0/8", "10.0.0.0/8"],
    [" 192.168.1.1 ", "192.168.1.1"],
    ["2001:DB8::/32", "2001:db8::/32"],
    ["2001:db8::1", "2001:db8::1"],
    ["::1/128", "::1/128"],
    ["::ffff:10.1.2.3", "10.1.2.3"],
    ["::FFFF:10.1.0.0/112", "10.1.0.0/16"],
    ["::ffff:10.1.2.3/128", "10.1.2.3/32"],
  ])("%p → %p", (input, expected) => {
    const result = parse([input]);
    expect(result.success).toBe(true);
    expect(result.data?.cidrs).toEqual([expected]);
  });
});

describe("refused with one message", () => {
  it.each(["999.1.1.1", "10.0.0.0/33", "2001:db8::/129", "::ffff:10.0.0.0/95", "10.0.0.0/x", "10.0.0.0/", "host.example", ""])("%p", (input) => {
    const result = parse([input]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["cidrs.0", "Expected an IPv4 or IPv6 address or CIDR"]]);
  });

  it("a non-string entry is refused by type", () => {
    expect(parse([42]).success).toBe(false);
  });
});

it("a stored entry matches what sign-in enforcement matches", () => {
  const stored = normaliseAllowlistEntry("::ffff:10.1.0.0/112");
  expect(stored).toBe("10.1.0.0/16");
  expect(addressAllowed("::ffff:10.1.9.9", [stored ?? ""])).toBe(true);
  expect(addressAllowed("2001:db8::5", [normaliseAllowlistEntry("2001:DB8::/32") ?? ""])).toBe(true);
});
