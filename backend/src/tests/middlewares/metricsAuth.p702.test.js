/**
 * P7-02 — the metrics endpoint's gate: off (404) until METRICS_TOKEN is set
 * to at least 32 characters; 401 for a missing or wrong bearer; next() for
 * the right one.
 */
const { metricsAuth, MIN_TOKEN_LENGTH } = require("../../middlewares/metricsAuth.middleware");

const TOKEN = "m".repeat(MIN_TOKEN_LENGTH);

const call = (authorization) => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  metricsAuth({ headers: authorization === undefined ? {} : { authorization } }, res, next);
  return { res, next };
};

describe("P7-02 metricsAuth", () => {
  const saved = process.env.METRICS_TOKEN;
  afterAll(() => {
    if (saved === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = saved;
    }
  });

  it.each([undefined, "", "short-token"])("METRICS_TOKEN=%p: 404, the endpoint does not exist", (value) => {
    if (value === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = value;
    }
    const { res, next } = call(`Bearer ${value}`);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([undefined, "", `Basic ${TOKEN}`, `Bearer ${TOKEN}x`, "Bearer "])("authorization %p: 401", (header) => {
    process.env.METRICS_TOKEN = TOKEN;
    const { res, next } = call(header);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, status: 401, message: "Unauthorized", data: null });
    expect(next).not.toHaveBeenCalled();
  });

  it("the right bearer passes", () => {
    process.env.METRICS_TOKEN = TOKEN;
    const { res, next } = call(`Bearer ${TOKEN}`);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
