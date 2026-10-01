/**
 * `validate(schema)` — the one way a request schema is used as Express middleware.
 *
 * P9-11 (ADR-093): converted from validation.middleware.js and moved to Zod. What a client sees on a failure is unchanged apart from the wording
 * inside `details`: HTTP 400, `{ success: false, status: 400, message:
 * "Validation Error", data: null }`, plus `details: [{ field, message }]` only
 * outside production (response.util#error). On success the parsed value —
 * unknown keys stripped, declared conversions applied — is written to
 * `req.validated`, and, when the source is the body (the default), also
 * replaces `req.body`, as the middleware always did, so existing handlers are
 * unchanged.
 *
 * The source is declared. `validate(schema)` checks `req.body` (an absent body
 * is checked as `{}`, A-09). `validate(schema, { from: ["params", "body"] })`
 * checks the merge of those sources; whatever the order written, a path
 * parameter always wins over a body or query key of the same name, because
 * the path is what the route's permission and tenant gates checked.
 *
 * Passing `schema.parse` (or `safeParse`, `parseAsync`) to a router is a type
 * error in a `.ts` route; `.js` routes are held to the same rule by the source
 * guard tests/guards/schemaAsMiddleware.p911.test.ts.
 */
import type { Request, RequestHandler } from "express";
import type { z } from "zod";
import { error } from "../utils/response.util";
import { fieldErrors } from "../validators/input";

/** Where a request schema reads its input. */
export type RequestSource = "body" | "params" | "query";

/** `validate()`'s options. */
export interface ValidateOptions {
  /** The source, or the sources merged (path parameters win). Default `"body"`. */
  readonly from?: RequestSource | readonly RequestSource[];
}

/** Merge precedence, lowest first: a path parameter overrides a body key, a body key a query key. */
const PRECEDENCE: readonly RequestSource[] = ["query", "body", "params"];

/** Which schema produced each request's `req.validated`, so `validated()` can refuse a mismatch. */
const PRODUCED_BY = new WeakMap<Request, z.ZodType>();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * @param req - the request
 * @param from - the declared source(s)
 * @returns the input to check
 */
const readInput = (req: Request, from: RequestSource | readonly RequestSource[]): unknown => {
  if (typeof from === "string") {
    const value: unknown = from === "body" ? req.body : from === "query" ? req.query : req.params;
    return value ?? {};
  }
  const merged: Record<string, unknown> = {};
  for (const source of PRECEDENCE) {
    if (from.includes(source)) {
      Object.assign(merged, asRecord(source === "body" ? req.body : source === "query" ? req.query : req.params));
    }
  }
  return merged;
};

/**
 * The request-validation middleware.
 *
 * @param schema - a request schema from `validators/`
 * @param options - the source to check (default: the body)
 * @returns the middleware
 */
export const validate = (schema: z.ZodType, options: ValidateOptions = {}): RequestHandler => {
  const from = options.from ?? "body";
  return (req, res, next) => {
    const result = schema.safeParse(readInput(req, from));
    if (!result.success) {
      error(res, "Validation Error", 400, fieldErrors(result.error));
      return;
    }
    req.validated = result.data;
    PRODUCED_BY.set(req, schema);
    if (from === "body") {
      req.body = result.data;
    }
    next();
  };
};

/**
 * The value `validate(schema)` left on this request, typed by that schema.
 *
 * @param req - a request that passed `validate(schema)`
 * @param schema - the same schema object the route mounted
 * @returns `req.validated`, as the schema's output type
 * @throws Error when the request was not validated by that schema — a wiring mistake, never input
 */
export const validated = <S extends z.ZodType>(req: Request, schema: S): z.output<S> => {
  if (PRODUCED_BY.get(req) !== schema) {
    throw new Error("validated(): this request was not validated by that schema");
  }
  // The WeakMap check above ties req.validated to this schema's successful parse.
  return req.validated as z.output<S>;
};
