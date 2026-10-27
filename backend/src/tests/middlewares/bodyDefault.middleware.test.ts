/**
 * A-09 — bodyDefault middleware.
 *
 * Express 5 leaves `req.body` undefined when no body was sent; Express 4 gave
 * `{}`. This middleware is the request-level guarantee that no handler ever
 * sees an absent body, so a bodyless request produces the 400 (or the 2xx,
 * where the body is optional) it is owed instead of a TypeError-driven 500.
 */

import type { Request, Response } from "express";
import { bodyDefault } from "../../middlewares/bodyDefault.middleware";

describe("bodyDefault middleware (A-09)", () => {
  let res: Response;
  let next: jest.Mock;

  beforeEach(() => {
    res = {} as unknown as Response;
    next = jest.fn();
  });

  it("replaces an absent body with {} — the Express 5 regression itself", () => {
    const req = {} as unknown as Request;

    bodyDefault(req, res, next);

    expect(req.body).toEqual({});
    // Destructuring the body is what threw the TypeError that surfaced as a 500.
    expect(() => {
      const { anything } = req.body as { anything?: unknown };
      return anything;
    }).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves a parsed object body untouched", () => {
    const parsed = { name: "Device A" };
    const req = { body: parsed } as unknown as Request;

    bodyDefault(req, res, next);

    expect(req.body).toBe(parsed);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("leaves a Buffer body untouched (raw-body / webhook routes)", () => {
    const raw = Buffer.from('{"id":"evt_1"}');
    const req = { body: raw } as unknown as Request;

    bodyDefault(req, res, next);

    expect(Buffer.isBuffer(req.body)).toBe(true);
    expect(req.body).toBe(raw);
  });

  it("leaves an explicit null body untouched (only `undefined` is filled)", () => {
    const req = { body: null } as unknown as Request;

    bodyDefault(req, res, next);

    expect(req.body).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
