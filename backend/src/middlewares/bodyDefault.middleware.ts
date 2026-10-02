// src/middlewares/bodyDefault.middleware.ts
//
// A-09 — Express 5 leaves `req.body` **undefined** when no body was sent.
// Express 4 gave `{}`.
//
// Every `const { x } = req.body` and every `req.body.x` in a controller then
// throws a TypeError, which the error handler reports as a **500** — on a
// request that should have been a 400 (missing required field), or, on a
// DELETE/GET whose body is genuinely optional, on a request that should have
// succeeded outright.
//
// It is not only a crash: the old validator treated `undefined` as valid against a
// non-required object schema, so the validators did not catch it either
// (`schema.validate(undefined)` → `{ value: undefined }`, no error). Those
// helpers are guarded too; this middleware is the request-level guarantee that
// every downstream handler sees an object.
//
// Mounted immediately after the body parsers in index.js, so it runs before
// the sanitizer, the routers and every route-level validator.
//
// It only fills an ABSENT body. A parsed object, an array, a string and a
// Buffer (raw-body routes) are all left exactly as the parser produced them.
//
// P9-19 (ADR-087): converted from bodyDefault.middleware.js, behaviour
// unchanged. The guarantee is now a TYPE as well (the card's DoD): the
// middleware is an assertion signature, so code that calls it learns that
// `req.body` is a `DefaultedBody` — never `undefined` — instead of the
// `any` @types/express gives it.
import type { NextFunction, Request, Response } from "express";

/**
 * A request body once bodyDefault has run: what the parser produced — a JSON
 * object or array, a Buffer (raw-body routes), a string — or `{}`. Never
 * `undefined`. (`null` is a valid JSON body and is left as it is.)
 */
export type DefaultedBody = object | string | number | boolean | null;

/**
 * A request whose body bodyDefault has defaulted. `body` is REPLACED, not
 * intersected: @types/express types it `any`, and `any & T` is still `any`.
 */
export type DefaultedBodyRequest = Omit<Request, "body"> & { body: DefaultedBody };

/** The middleware, typed as the assertion it makes about `req`. */
type BodyDefault = (req: Request, res: Response, next: NextFunction) => asserts req is DefaultedBodyRequest;

const bodyDefault: BodyDefault = (req, _res, next) => {
  if (req.body === undefined) {
    req.body = {};
  }
  next();
};

export { bodyDefault };
