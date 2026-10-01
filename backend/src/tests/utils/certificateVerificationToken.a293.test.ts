/**
 * A-293 (ADR-100) — the certificate verification token: its shape, and the
 * constant-time comparison that decides between the full and the minimal
 * public verdict.
 */
import type * as CryptoModule from "crypto";
import type * as TokenModule from "../../utils/certificateVerificationToken";

// The transform does not hoist jest.mock (jest.transform.js), so the module
// under test is loaded after it, and sees these spies on the real functions.
jest.mock("crypto", () => {
  const actual = jest.requireActual<typeof CryptoModule>("crypto");
  return {
    ...actual,
    randomBytes: jest.fn((size: number) => actual.randomBytes(size)),
    timingSafeEqual: jest.fn((a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => actual.timingSafeEqual(a, b)),
  };
});

const crypto = jest.requireMock<{ randomBytes: jest.Mock; timingSafeEqual: jest.Mock }>("crypto");
const { VERIFICATION_TOKEN_BYTES, newVerificationToken, verificationTokenMatches } =
  jest.requireActual<typeof TokenModule>("../../utils/certificateVerificationToken");

const TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";

describe("A-293 — certificate verification token", () => {
  it("is 24 CSPRNG bytes as 32 base64url characters", () => {
    const token = newVerificationToken();

    expect(VERIFICATION_TOKEN_BYTES).toBe(24);
    expect(crypto.randomBytes).toHaveBeenCalledWith(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(24);
    expect(newVerificationToken()).not.toBe(token);
  });

  it("matches only the identical, non-empty string, compared with timingSafeEqual", () => {
    crypto.timingSafeEqual.mockClear();

    expect(verificationTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(crypto.timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(verificationTokenMatches(TOKEN, `${TOKEN.slice(0, 31)}x`)).toBe(false);
  });

  it.each([
    ["a shorter token", TOKEN, TOKEN.slice(0, 31)],
    ["a longer token", TOKEN, `${TOKEN}A`],
    ["no token", TOKEN, undefined],
    ["an empty token", TOKEN, ""],
    ["a repeated query parameter (an array)", TOKEN, [TOKEN, TOKEN]],
    ["a row with no token", null, TOKEN],
    ["a row with an empty token", "", ""],
  ])("%s never matches", (_label, expected, presented) => {
    expect(verificationTokenMatches(expected, presented)).toBe(false);
  });
});
