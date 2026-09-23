/**
 * JWT secret and token-type separation (A-31)
 *
 * The configuration document said the config "should reject [equal secrets]
 * rather than trusting whoever wrote the .env". It did not.
 *
 * Worse than the card recorded: the key registry holds ACCESS_SECRET only, and
 * the legacy JWT refresh token was signed from that registry — so
 * JWT_REFRESH_SECRET signed nothing, and a refresh token would have verified
 * as an access token whatever the two secrets were set to.
 */

const loadJwt = (env) => {
  const saved = { ...process.env };
  jest.resetModules();
  Object.assign(process.env, env);
  try {
    return require("../../utils/jwt.util");
  } finally {
    process.env = saved;
  }
};

describe("jwt.util startup validation (A-31)", () => {
  it("refuses to start when the access and refresh secrets are equal", () => {
    expect(() =>
      loadJwt({ JWT_ACCESS_SECRET: "same-secret", JWT_REFRESH_SECRET: "same-secret" }),
    ).toThrow(/must differ/);
  });

  it("starts when they differ", () => {
    expect(() => loadJwt({ JWT_ACCESS_SECRET: "a-secret", JWT_REFRESH_SECRET: "b-secret" })).not.toThrow();
  });

  it("refuses an algorithm that is not on the pinned list", () => {
    expect(() =>
      loadJwt({
        JWT_ACCESS_SECRET: "a-secret",
        JWT_REFRESH_SECRET: "b-secret",
        JWT_ALGORITHM: "none",
      }),
    ).toThrow(/is not supported/);
  });

  it("accepts a pinned algorithm", () => {
    expect(() =>
      loadJwt({
        JWT_ACCESS_SECRET: "a-secret",
        JWT_REFRESH_SECRET: "b-secret",
        JWT_ALGORITHM: "HS512",
      }),
    ).not.toThrow();
  });
});

describe("token types cannot be exchanged (A-31)", () => {
  let jwt;

  beforeEach(() => {
    jwt = loadJwt({
      JWT_ACCESS_SECRET: "access-secret-a31",
      JWT_REFRESH_SECRET: "refresh-secret-a31",
      JWT_ALGORITHM: "HS256",
    });
  });

  it("signs a real access token that verifies as an access token", () => {
    const token = jwt.generateAccessToken({ id: "u1" });
    expect(jwt.verifyAccessToken(token)).toMatchObject({ id: "u1", typ: "access" });
  });

  it("refuses a refresh token presented as a bearer token", () => {
    const refresh = jwt.generateRefreshToken({ id: "u1" });
    expect(() => jwt.verifyAccessToken(refresh)).toThrow("Invalid or expired access token");
  });

  it("refuses an access token presented to the refresh path", () => {
    const access = jwt.generateAccessToken({ id: "u1" });
    expect(() => jwt.verifyRefreshToken(access)).toThrow("Invalid or expired refresh token");
  });

  it("verifies a real refresh token", () => {
    const refresh = jwt.generateRefreshToken({ id: "u1" });
    expect(jwt.verifyRefreshToken(refresh)).toMatchObject({ id: "u1", typ: "refresh" });
  });

  // A token with no `typ` predates this change. Refusing it would log every
  // session out on deploy, and nothing issues a typ-less refresh JWT any more,
  // so it is accepted on the access path — deliberately, and only there.
  it("still accepts a legacy access token that carries no type claim", () => {
    const jsonwebtoken = require("jsonwebtoken");
    const legacy = jsonwebtoken.sign({ id: "u1" }, "access-secret-a31", { algorithm: "HS256" });
    expect(jwt.verifyAccessToken(legacy)).toMatchObject({ id: "u1" });
  });

  it("does not accept a legacy token signed with the refresh secret on the access path", () => {
    const jsonwebtoken = require("jsonwebtoken");
    const legacy = jsonwebtoken.sign({ id: "u1" }, "refresh-secret-a31", { algorithm: "HS256" });
    expect(() => jwt.verifyAccessToken(legacy)).toThrow("Invalid or expired access token");
  });
});
