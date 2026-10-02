/**
 * P9-19 (the card's DoD for A-09) — bodyDefault's guarantee is a TYPE.
 *
 * Express 5 leaves `req.body` undefined when no body was sent; bodyDefault
 * fills it with `{}`. The middleware is typed as an assertion signature, so a
 * caller learns `req.body` is a `DefaultedBody`. These checks run at compile
 * time (`npm run typecheck`) as well as at run time: if `undefined` ever became
 * a `DefaultedBody`, the `NEVER_UNDEFINED` line would stop compiling.
 */
import type { NextFunction, Request, Response } from "express";
import { bodyDefault, type DefaultedBody, type DefaultedBodyRequest } from "../../middlewares/bodyDefault.middleware";

// Compile-time: undefined is not a DefaultedBody, and a defaulted request's body is one.
const NEVER_UNDEFINED: undefined extends DefaultedBody ? false : true = true;
const BODY_IS_DEFAULTED: DefaultedBodyRequest["body"] extends DefaultedBody ? true : false = true;

/** A request with the given body (none when `absent`). */
const requestWith = (body?: unknown, absent = false): Request => {
  const partial: Partial<Request> = absent ? {} : { body };
  return partial as Request;
};
const response: Partial<Response> = {};

const run = (req: Request): DefaultedBody => {
  const next: NextFunction = () => undefined;
  bodyDefault(req, response as Response, next);
  // After the assertion, req.body is DefaultedBody (not `any`): this assignment
  // is to the narrowed type, and the guard below is what TypeScript knows.
  const body: DefaultedBody = req.body;
  return body;
};

describe("bodyDefault — the always-an-object guarantee, typed (P9-19)", () => {
  it("is pinned at compile time", () => {
    expect(NEVER_UNDEFINED).toBe(true);
    expect(BODY_IS_DEFAULTED).toBe(true);
  });

  it("an absent body becomes {}; every parsed value is left as it is", () => {
    expect(run(requestWith(undefined, true))).toEqual({});
    expect(run(requestWith(undefined))).toEqual({});
    const parsed = { a: 1 };
    expect(run(requestWith(parsed))).toBe(parsed);
    expect(run(requestWith(null))).toBeNull();
    expect(run(requestWith(""))).toBe("");
    const buffer = Buffer.from("raw");
    expect(run(requestWith(buffer))).toBe(buffer);
  });
});
