/**
 * ADR-138 Am. 5 — the activity log's `sanitizeUrl` writes the URL the access log writes
 * (utils/logUrl.util), then masks e-mail addresses (A-228): no query token (`?token=`, `?t=`, a
 * token-looking value).
 *
 * Synthetic values only.
 */
import { redactFormat, sanitizeUrl } from "../../middlewares/activityLog.middleware";

const TOKEN = "Zq3vK9xT1mPa7Lw2Rb5Nc8Yd0EfGhJkS";

describe("ADR-138 Am. 5 — the activity log", () => {
  it("redacts a verification link's token, a token-looking value and the printed ?t=, masks an e-mail; a non-string is returned as it is", () => {
    expect(sanitizeUrl(`/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=${TOKEN}&lang=id`)).toBe("/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=[REDACTED]&lang=id");
    expect(sanitizeUrl(`/x?ref=${TOKEN}&email=someone@hospital.example`)).toBe("/x?ref=[REDACTED]&email=s***@hospital.example");
    expect(sanitizeUrl("/verify/ipm/IPM-F-0001-20250510-001?t=abc")).toBe("/verify/ipm/IPM-F-0001-20250510-001?t=[REDACTED]");
    expect(sanitizeUrl(42)).toBe(42);
  });

  it("any log record's URL field (the error handler's, the access refusals') is redacted the same way; other fields are untouched", () => {
    const record = redactFormat().transform({
      level: "error",
      message: "refused",
      url: `/api/v1/ipm/verify/X?token=${TOKEN}`,
      originalUrl: `/x?t=${TOKEN}`,
      referer: `https://a.example.test/invitation?token=${TOKEN}`,
      referrer: 7,
      path: `/x?ref=${TOKEN}`,
    }) as Record<string, unknown>;
    expect(record).toMatchObject({
      url: "/api/v1/ipm/verify/X?token=[REDACTED]",
      originalUrl: "/x?t=[REDACTED]",
      referer: "https://a.example.test/invitation?token=[REDACTED]",
      referrer: 7,
      path: `/x?ref=${TOKEN}`,
    });
  });

  it("a URL sanitised twice is the same URL (the public device path's prefix is not hashed again)", () => {
    const once = sanitizeUrl(`/api/v1/public/devices/${TOKEN}?token=x`);
    expect(once).toMatch(/^\/api\/v1\/public\/devices\/~[0-9a-f]{8}\?token=\[REDACTED\]$/);
    expect(sanitizeUrl(once)).toBe(once);
  });
});
