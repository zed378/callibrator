/**
 * P7-02 — the metrics endpoint's gate: off (404) until METRICS_TOKEN is set
 * to at least 32 characters; 401 for a missing or wrong bearer; next() for
 * the right one.
 */
import type { Request, Response } from "express";
import { metricsAuth, MIN_TOKEN_LENGTH } from "../../middlewares/metricsAuth.middleware";
import { environment } from "../../config/env";

const TOKEN = "m".repeat(MIN_TOKEN_LENGTH);

// The live environment object (config/env: process.env itself, not a copy).
const penv = environment();

interface CallOut {
    res: { status: jest.Mock; json: jest.Mock };
    next: jest.Mock;
}

const call = (authorization: string | undefined): CallOut => {
  const res: CallOut["res"] = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  const next = jest.fn();
  const req = { headers: authorization === undefined ? {} : { authorization } } as unknown as Request;
  metricsAuth(req, res as unknown as Response, next);
  return { res, next };
};

describe("P7-02 metricsAuth", () => {
  const saved = penv["METRICS_TOKEN"];
  afterAll(() => {
    if (saved === undefined) {

      Reflect.deleteProperty(penv, "METRICS_TOKEN");
    } else {

      penv["METRICS_TOKEN"] = saved;
    }
  });

  it.each<[string | undefined]>([[undefined], [""], ["short-token"]])(
    "METRICS_TOKEN=%p: 404, the endpoint does not exist",
    (value) => {
      if (value === undefined) {

        Reflect.deleteProperty(penv, "METRICS_TOKEN");
      } else {

        penv["METRICS_TOKEN"] = value;
      }
      const { res, next } = call(`Bearer ${String(value)}`);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each<[string | undefined]>([[undefined], [""], [`Basic ${TOKEN}`], [`Bearer ${TOKEN}x`], ["Bearer "]])(
    "authorization %p: 401",
    (header) => {

      penv["METRICS_TOKEN"] = TOKEN;
      const { res, next } = call(header);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, status: 401, message: "Unauthorized", data: null });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it("the right bearer passes", () => {

    penv["METRICS_TOKEN"] = TOKEN;
    const { res, next } = call(`Bearer ${TOKEN}`);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
