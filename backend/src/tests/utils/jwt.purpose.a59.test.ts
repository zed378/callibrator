/**
 * A-59 — single-purpose tokens (activation, mfa, socket).
 *
 * Each is signed with the access key but carries its own `typ`. The access
 * verifier refuses it; the purpose verifier accepts it only for its own type
 * and, unlike the access verifier, refuses a token with NO `typ`.
 */
import type { DecodedToken, TokenPurpose } from "../../types/auth";

// jwt.util is `export =` (ADR-087 Am. 15): typed by what this test calls, as jwt.keyMemo.u06 does.
interface JwtUtil {
    generateAccessToken: (payload: Record<string, unknown>) => string;
    generatePurposeToken: (
        payload: Record<string, unknown>,
        typ: TokenPurpose,
        options?: { expiresIn?: string | number },
    ) => string;
    generateRefreshToken: (payload: Record<string, unknown>) => string;
    verifyAccessToken: (token: string) => unknown;
    verifyPurposeToken: (token: string, typ: TokenPurpose) => unknown;
    decodeToken: (token: string) => DecodedToken | null;
}

interface JsonWebToken {
    sign: (payload: object, secret: string, options: object) => string;
}

/* eslint-disable @typescript-eslint/no-require-imports -- jwt.util is `export =`; one typed require keeps the exact object */
const jwtUtil = require("../../utils/jwt.util") as JwtUtil;
/* eslint-enable @typescript-eslint/no-require-imports */

const {
  generateAccessToken,
  generatePurposeToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyPurposeToken,
  decodeToken,
} = jwtUtil;

const PURPOSES: TokenPurpose[] = ["activation", "mfa", "socket"];

describe("jwt.util purpose tokens (A-59)", () => {
  it.each(PURPOSES)("a %s token is refused by verifyAccessToken", (typ) => {
    const token = generatePurposeToken({ id: "user-1" }, typ);

    expect((decodeToken(token) as { typ?: unknown }).typ).toBe(typ);
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- signed outside the util, as the .js did
    const jsonwebtoken = require("jsonwebtoken") as JsonWebToken;
    const untyped = jsonwebtoken.sign(
      { id: "user-1", purpose: "socket" },
            // eslint-disable-next-line no-restricted-properties -- the test signs with the same secret the util reads
            process.env["JWT_ACCESS_SECRET"] as string,
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
    const lifetime = (typ: TokenPurpose): number => {
      const { iat, exp } = decodeToken(generatePurposeToken({ id: "u" }, typ)) as { iat: number; exp: number };
      return exp - iat;
    };
    expect(lifetime("activation")).toBe(24 * 60 * 60);
    expect(lifetime("mfa")).toBe(5 * 60);
    expect(lifetime("socket")).toBe(300);
  });

  it("honours an explicit expiresIn", () => {
    const { iat, exp } = decodeToken(
      generatePurposeToken({ id: "u" }, "socket", { expiresIn: 60 }),
    ) as { iat: number; exp: number };
    expect(exp - iat).toBe(60);
  });

  it("an expired purpose token is refused as expired", () => {
    const token = generatePurposeToken({ id: "u" }, "mfa", { expiresIn: -1 });
    expect(() => verifyPurposeToken(token, "mfa")).toThrow("jwt expired");
  });

  it.each(["access", "refresh", "admin", undefined])(
    "refuses to mint or verify an unknown purpose (%s)",
    (typ) => {
      const unknownPurpose = typ as unknown as TokenPurpose;
      expect(() => generatePurposeToken({ id: "u" }, unknownPurpose)).toThrow(
        /Unknown token purpose/,
      );
      expect(() =>
        verifyPurposeToken(generateAccessToken({ id: "u" }), unknownPurpose),
      ).toThrow(/Unknown token purpose/);
    },
  );
});
