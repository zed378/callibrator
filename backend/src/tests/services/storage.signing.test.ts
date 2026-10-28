import type * as SigningModule from "../../services/storage/signing";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test is `export =` (CommonJS), as built
const signing = require("../../services/storage/signing") as typeof SigningModule;

const KEY = "t/tenant-1/attachments/report.pdf";
const SECRET = "signing-secret";

describe("storage signing", () => {
  it("round-trips a freshly signed token", () => {
    const { token, exp } = signing.sign(KEY, 300, SECRET);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(signing.verify(KEY, token, SECRET)).toBe(true);
  });

  it("rejects a token signed for a different key (no cross-object reuse)", () => {
    const { token } = signing.sign(KEY, 300, SECRET);
    expect(signing.verify("t/tenant-1/attachments/other.pdf", token, SECRET)).toBe(
      false,
    );
  });

  it("rejects a token verified with the wrong secret", () => {
    const { token } = signing.sign(KEY, 300, SECRET);
    expect(signing.verify(KEY, token, "other-secret")).toBe(false);
  });

  it("rejects an expired token", () => {
    const { token } = signing.sign(KEY, -1, SECRET);
    expect(signing.verify(KEY, token, SECRET)).toBe(false);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["non-string", 12345],
    ["no dot", "abcdef"],
    ["empty exp", ".sig"],
    ["non-numeric exp", "notanumber.sig"],
    ["missing signature", "9999999999."],
  ])("rejects a malformed token: %s", (_label: string, token: unknown) => {
    expect(signing.verify(KEY, token, SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; verify must guard it.
    const future = String(Math.floor(Date.now() / 1000) + 300);
    expect(signing.verify(KEY, `${future}.deadbeef`, SECRET)).toBe(false);
  });

  it("rejects a right-length but wrong signature", () => {
    const { token, exp } = signing.sign(KEY, 300, SECRET);
    const forged = `${String(exp)}.${"0".repeat(token.length - String(exp).length - 1)}`;
    expect(signing.verify(KEY, forged, SECRET)).toBe(false);
  });

  it("returns false when no secret is configured", () => {
    const { token } = signing.sign(KEY, 300, SECRET);
    expect(signing.verify(KEY, token, undefined)).toBe(false);
  });
});
