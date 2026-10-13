/**
 * ADR-138 Am. 5 — the access log's `:safe-url` and `:safe-referrer` write no query token (`?token=`,
 * `?t=`, a token-looking value) and no public device path token. The tokens are read through a
 * morgan double (the accessLog.test precedent). The activity log is proved in
 * activityLog.redaction.am5 (loading winston under this file's `fs` double runs out of memory,
 * ADR-138 Am. 2).
 *
 * Synthetic values only.
 */
import type { Request } from "express";

type TokenFn = (req: Request) => string;
const mockTokens: Record<string, TokenFn> = {};
const mockFormats: string[] = [];

jest.mock("rotating-file-stream", () => ({ createStream: jest.fn(() => ({ write: jest.fn() })) }));
jest.mock("morgan", () => {
  const fn = jest.fn((format: string) => {
    mockFormats.push(format);
    return (_req: unknown, _res: unknown, next: () => void) => { next(); };
  });
  Object.assign(fn, {
    token: (name: string, cb: TokenFn) => {
      mockTokens[name] = cb;
    },
  });
  return fn;
});
jest.mock("../../utils/storagePath.util", () => jest.fn(() => "/tmp/log/access-am5"));
jest.mock("fs", () => ({ existsSync: jest.fn(() => true), mkdirSync: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the doubles are in place
require("../../middlewares/accessLog.middleware");

const TOKEN = "Zq3vK9xT1mPa7Lw2Rb5Nc8Yd0EfGhJkS";
const VERIFY = `/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=${TOKEN}&lang=id`;
const REDACTED_VERIFY = "/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=[REDACTED]&lang=id";

const request = (values: { originalUrl?: string; url?: string; headers?: Record<string, string | string[]> }): Request =>
  ({ originalUrl: values.originalUrl ?? "", url: values.url ?? "", headers: values.headers ?? {} }) as unknown as Request;

describe("ADR-138 Am. 5 — the access log", () => {
  const token = (name: string): TokenFn => mockTokens[name] as TokenFn;

  it("writes :safe-url and :safe-referrer, never the raw :url or :referrer", () => {
    expect(mockFormats).toHaveLength(1);
    expect(mockFormats[0]).toContain(":safe-url");
    expect(mockFormats[0]).toContain('":safe-referrer"');
    expect(mockFormats[0]).not.toMatch(/:url\b|:referrer\b/);
  });

  it(":safe-url redacts the query token of a verification link (originalUrl, else url)", () => {
    expect(token("safe-url")(request({ originalUrl: VERIFY }))).toBe(REDACTED_VERIFY);
    expect(token("safe-url")(request({ url: "/verify?t=abc" }))).toBe("/verify?t=[REDACTED]");
  });

  it(":safe-referrer redacts a page URL's token (Referer, Referrer, the first of a list); none is -", () => {
    expect(token("safe-referrer")(request({ headers: { referer: `https://app.example.test${VERIFY}` } }))).toBe(`https://app.example.test${REDACTED_VERIFY}`);
    expect(token("safe-referrer")(request({ headers: { referrer: ["https://app.example.test/invitation?token=x", "/other"] } }))).toBe(
      "https://app.example.test/invitation?token=[REDACTED]",
    );
    expect(token("safe-referrer")(request({ headers: { referrer: "/plain" } }))).toBe("/plain");
    expect(token("safe-referrer")(request({}))).toBe("-");
  });
});
