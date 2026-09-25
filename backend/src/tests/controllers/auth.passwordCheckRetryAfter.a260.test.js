/**
 * A-260 — a spent signed-in password budget reaches the client as 429 with a
 * Retry-After header.
 *
 * auth.service#verifySessionPassword throws an AppError(429) carrying
 * `retryAfterSeconds`; controllerWrapper#sendCaughtError turns it into the
 * header (RFC 9110 §10.2.3). The controller passes the request's address and
 * user agent, for the pause's audit row.
 *
 * Real: auth.controller#passIsValid, controllerWrapper, response.util.
 * Faked: auth.service.
 */
jest.mock("../../services/auth.service", () => ({ passIsValid: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const authService = require("../../services/auth.service");
const authController = require("../../controllers/auth.controller");
const { AppError } = require("../../utils/appError.util");

const call = (handler) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, headers: this.headers, body: payload });
        return this;
      },
    };
    const req = {
      user: { id: "u-1" },
      body: { password: "guess" },
      ip: "198.51.100.8",
      headers: { "user-agent": "jest" },
    };
    handler(req, res, () => {});
  });

beforeEach(() => jest.clearAllMocks());

describe("A-260: POST /auth/pass-is-valid when the budget is spent", () => {
  it("answers 429 with Retry-After, and hands the service the request's address and agent", async () => {
    const paused = new AppError(429, "Too many wrong passwords.");
    paused.retryAfterSeconds = 842.2;
    authService.passIsValid.mockRejectedValueOnce(paused);

    const res = await call(authController.passIsValid);

    expect(authService.passIsValid).toHaveBeenCalledWith("u-1", "guess", {
      ipAddress: "198.51.100.8",
      userAgent: "jest",
    });
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("843");
    expect(res.body).toMatchObject({ success: false, message: "Too many wrong passwords." });
  });

  it("a 429 that does not know when it ends sends no Retry-After", async () => {
    authService.passIsValid.mockRejectedValueOnce(new AppError(429, "Slow down"));

    const res = await call(authController.passIsValid);

    expect(res.status).toBe(429);
    expect(res.headers).not.toHaveProperty("retry-after");
  });

  it("Retry-After is never below one second", async () => {
    const paused = new AppError(429, "Too many wrong passwords.");
    paused.retryAfterSeconds = 0;
    authService.passIsValid.mockRejectedValueOnce(paused);

    const res = await call(authController.passIsValid);

    expect(res.headers["retry-after"]).toBe("1");
  });
});
