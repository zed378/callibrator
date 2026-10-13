/**
 * ADR-138 Am. 5 — utils/logUrl.util: what a logged URL keeps and what it loses. The expected
 * strings are written by hand from the rules in the module's header, not generated from its lists.
 *
 * Synthetic values only.
 */
import { createHash } from "crypto";
import { REDACTED, isSensitiveKey, looksLikeToken, normaliseKey, redactUrlForLog } from "../../utils/logUrl.util";

const TOKEN = "Zq3vK9xT1mPa7Lw2Rb5Nc8Yd0EfGhJkS"; // 32 base64url characters, the IPM verify token's shape
const UUID = "a2402000-0000-4000-8000-0000000000c1";

describe("ADR-138 Am. 5 — a URL as the logs write it", () => {
  it("the verification, invitation, activation and attachment links lose their token, by key", () => {
    expect(redactUrlForLog(`/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=${TOKEN}`)).toBe(`/api/v1/ipm/verify/IPM-F-0001-20250510-001?token=${REDACTED}`);
    expect(redactUrlForLog("/verify/ipm/IPM-F-0001-20250510-001?t=abc")).toBe(`/verify/ipm/IPM-F-0001-20250510-001?t=${REDACTED}`);
    expect(redactUrlForLog("/invitation?token=x&lang=id")).toBe(`/invitation?token=${REDACTED}&lang=id`);
    expect(redactUrlForLog("/api/v1/attachments/1/signed?token=x&variant=thumb")).toBe(`/api/v1/attachments/1/signed?token=${REDACTED}&variant=thumb`);
    expect(redactUrlForLog("/sso-callback?refresh_token=a&State=b&code=123456&pin=9&sig=s&api-key=k")).toBe(
      `/sso-callback?refresh_token=${REDACTED}&State=${REDACTED}&code=${REDACTED}&pin=${REDACTED}&sig=${REDACTED}&api-key=${REDACTED}`,
    );
    expect(redactUrlForLog("/x?resetLink=https%3A%2F%2Fa%2Fb")).toBe(`/x?resetLink=${REDACTED}`);
    expect(redactUrlForLog("/x?%74oken=a")).toBe(`/x?%74oken=${REDACTED}`);
  });

  it("a token-looking value is redacted whatever its key; ids, dates, words and short values stay", () => {
    expect(redactUrlForLog(`/x?ref=${TOKEN}&id=${UUID}&from=2025-05-10&search=Pompa+infus&page=2`)).toBe(
      `/x?ref=${REDACTED}&id=${UUID}&from=2025-05-10&search=Pompa+infus&page=2`,
    );
    expect(redactUrlForLog(`/x?${TOKEN}`)).toBe(`/x?${REDACTED}`);
    expect(redactUrlForLog("/x?flag&sort=created_at")).toBe("/x?flag&sort=created_at");
    expect(redactUrlForLog(`/x?h=${"ab12".repeat(16)}`)).toBe(`/x?h=${REDACTED}`);
    expect(redactUrlForLog("/x?name=calibration_device_name_long")).toBe("/x?name=calibration_device_name_long");
  });

  it("the public device path token is hashed; a URL without a query is returned as it is; a malformed escape is kept raw", () => {
    const hash = createHash("sha256").update(TOKEN, "utf8").digest("hex").slice(0, 8);
    expect(redactUrlForLog(`/api/v1/public/devices/${TOKEN}?token=x`)).toBe(`/api/v1/public/devices/~${hash}?token=${REDACTED}`);
    expect(redactUrlForLog("/api/v1/calibration-devices")).toBe("/api/v1/calibration-devices");
    expect(redactUrlForLog("/x?q=%E0%A4%A&token=%E0%A4%A")).toBe(`/x?q=%E0%A4%A&token=${REDACTED}`);
  });

  it("the shared key rules and the token shape", () => {
    expect(normaliseKey("X-Api_Key")).toBe("xapikey");
    expect(isSensitiveKey("refreshToken")).toBe(true);
    expect(isSensitiveKey("inviteLink")).toBe(true);
    expect(isSensitiveKey("page")).toBe(false);
    expect(looksLikeToken(TOKEN)).toBe(true);
    expect(looksLikeToken(`${TOKEN}==`)).toBe(true);
    expect(looksLikeToken(UUID)).toBe(false);
    expect(looksLikeToken("123456789012345678901234567890")).toBe(false);
    expect(looksLikeToken("abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(looksLikeToken("Zq3vK9xT1mPa7Lw2Rb5Nc8Y")).toBe(false);
  });
});
