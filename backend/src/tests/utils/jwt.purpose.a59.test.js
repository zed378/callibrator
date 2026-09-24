/**
 * A-59 — single-purpose tokens (activation, mfa, socket).
 *
 * Each is signed with the access key but carries its own `typ`. The access
 * verifier refuses it; the purpose verifier accepts it only for its own type
 * and, unlike the access verifier, refuses a token with NO `typ`.
 */

const jwt = require("jsonwebtoken");
const {
  generateAccessToken,
  generatePurposeToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyPurposeToken,
  decodeToken,
} = require("../../utils/jwt.util");

const PURPOSES = ["activation", "mfa", "socket"];

describe("jwt.util purpose tokens (A-59)", () => {
  it.each(PURPOSES)("a %s token is refused by verifyAccessToken", (typ) => {
    const token = generatePurposeToken({ id: "user-1" }, typ);

    expect(decodeToken(token).typ).toBe(typ);
    expect(() => verifyAccessToken(token)).toThrow(
      "Invalid or expired access token",
    );
  });

  it.each(PURPOSES)("a %s token is accepted by verifyPurposeToken for its own type only", (typ) => {
    const token = generatePurposeToken({ id: "user-1" }, typ);

    expect(verifyPurposeToken(token, typ)).toMatchObject({ id: "user-1", typ });
    for (const other of PURPOSES.filter((p) => p !== typ)) {
      expect(() => verifyPurposeToken(token, other)).toThrow(
        `Invalid or expired ${other} token`,
      );
    }
  });

  it.each(PURPOSES)("verifyPurposeToken(%s) refuses an access token", (typ) => {
    expect(() =>
      verifyPurposeToken(generateAccessToken({ id: "user-1", sid: "s" }), typ),
    ).toThrow(`Invalid or expired ${typ} token`);
  });

  it("verifyPurposeToken refuses a token with no typ — the pre-A-59 socket token shape", () => {
    const untyped = jwt.sign(
      { id: "user-1", purpose: "socket" },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: 300, algorithm: "HS256" },
    );
    expect(() => verifyPurposeToken(untyped, "socket")).toThrow(
      "Invalid or expired socket token",
    );
  });

  it("verifyPurposeToken refuses a refresh token", () => {
    expect(() =>
      verifyPurposeToken(generateRefreshToken({ id: "user-1" }), "mfa"),
    ).toThrow("Invalid or expired mfa token");
  });

  it("each purpose has its own default lifetime, independent of JWT_ACCESS_EXPIRED", () => {
    const lifetime = (typ) => {
      const { iat, exp } = decodeToken(generatePurposeToken({ id: "u" }, typ));
      return exp - iat;
    };
    expect(lifetime("activation")).toBe(24 * 60 * 60);
    expect(lifetime("mfa")).toBe(5 * 60);
    expect(lifetime("socket")).toBe(300);
  });

  it("honours an explicit expiresIn", () => {
    const { iat, exp } = decodeToken(
      generatePurposeToken({ id: "u" }, "socket", { expiresIn: 60 }),
    );
    expect(exp - iat).toBe(60);
  });

  it("an expired purpose token is refused as expired", () => {
    const token = generatePurposeToken({ id: "u" }, "mfa", { expiresIn: -1 });
    expect(() => verifyPurposeToken(token, "mfa")).toThrow("jwt expired");
  });

  it.each(["access", "refresh", "admin", undefined])(
    "refuses to mint or verify an unknown purpose (%s)",
    (typ) => {
      expect(() => generatePurposeToken({ id: "u" }, typ)).toThrow(
        /Unknown token purpose/,
      );
      expect(() =>
        verifyPurposeToken(generateAccessToken({ id: "u" }), typ),
      ).toThrow(/Unknown token purpose/);
    },
  );
});
