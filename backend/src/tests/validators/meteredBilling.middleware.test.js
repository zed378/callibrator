/**
 * Tests for the metered-billing validator middleware factories (validateBody /
 * validateQuery) — the fix for routes previously misusing Joi schemas as
 * Express middleware.
 */
jest.mock("../../utils/appError.util", () => ({
  formatErrors: (details) => (details && details[0] && details[0].message) || "invalid",
  AppError: class AppError extends Error {},
}));

const meteredValidator = require("../../validators/meteredBilling.validator");

const run = (mw, req) =>
  new Promise((resolve) => {
    const next = jest.fn((err) => resolve({ err, req }));
    const res = {};
    const maybe = mw(req, res, next);
    if (maybe && typeof maybe.then === "function") maybe.then(() => {});
  });

describe("meteredBilling validator middleware", () => {
  it("validateBody passes and normalizes a valid body", async () => {
    const req = { body: { metricName: "api_calls", threshold: 100 } };
    const { err } = await run(
      meteredValidator.validateBody(meteredValidator.createUsageAlert),
      req,
    );
    expect(err).toBeUndefined();
    // Defaults applied by the schema (stripUnknown + defaults) are written back.
    expect(req.body.comparison).toBe("gte");
    expect(req.body.notificationChannels).toEqual(["email"]);
  });

  it("validateBody calls next(err) with status 400 on an invalid body", async () => {
    const req = { body: { threshold: -5 } }; // missing metricName, negative threshold
    const { err } = await run(
      meteredValidator.validateBody(meteredValidator.createUsageAlert),
      req,
    );
    expect(err).toBeDefined();
    expect(err.status).toBe(400);
  });

  it("validateQuery rejects an invalid analytics period", async () => {
    const req = { query: { period: "banana" } };
    const { err } = await run(
      meteredValidator.validateQuery(meteredValidator.getAnalytics),
      req,
    );
    expect(err).toBeDefined();
    expect(err.status).toBe(400);
  });

  it("validateQuery passes a valid analytics period", async () => {
    const req = { query: { period: "7d" } };
    const { err } = await run(
      meteredValidator.validateQuery(meteredValidator.getAnalytics),
      req,
    );
    expect(err).toBeUndefined();
  });
});
