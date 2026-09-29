/**
 * P9-11 contract harness — today's validation 400, over real HTTP.
 *
 * Every contract test in this folder mounts the REAL middleware on a real
 * Express 5 app (`express.json()` in front, the real central `errorHandler`
 * behind), sends a real request with Node's fetch, and compares the response
 * **as bytes**: status, content type and the exact body text, key order
 * included. A mock of `response.util` would prove the test, not the contract
 * (CLAUDE.md, Evidence) — nothing here is mocked.
 *
 * The expected strings in the tests are literals copied from what the Joi
 * validators answer on 2026-09-28. They pin behaviour; they do not judge it.
 * When P9-11 moves a validator to Zod, its test must keep passing unchanged —
 * that is the byte compatibility the P9-11 card asks for
 * (MEMORY/specs/P9-11-validation-error-contract.md).
 */
import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { validate } from "../../../middlewares/validation.middleware";
import { errorHandler } from "../../../middlewares/errorHandlers.middleware";

/** One entry of the `details` array the middleware answers outside production. */
export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** What a client receives: the status line, the content type, the body bytes. */
export interface WireResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly text: string;
}

/** Non-production is anything but "production": response.util#error reads it per call. */
export type Mode = "production" | "test";

/** The request a contract test sends; `body: undefined` sends no body at all. */
export interface ProbeRequest {
  readonly handlers: readonly RequestHandler[];
  readonly body: unknown;
  readonly path?: string;
  readonly route?: string;
  readonly query?: string;
}

/** The content type Express 5's `res.json` writes. */
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** The terminal handler: reached only when validation passed, and echoes the body it was left. */
const reached: RequestHandler = (req, res) => {
  const body: unknown = req.body;
  res.status(200).json({ reached: true, body: body ?? null });
};

/**
 * Run `fn` with NODE_ENV set to `mode`, restoring the previous value after.
 *
 * @param mode - "production" or "test"
 * @param fn - the work to run under that mode
 * @returns what `fn` resolves to
 */
export async function withNodeEnv<T>(mode: Mode, fn: () => Promise<T>): Promise<T> {
  // eslint-disable-next-line no-restricted-properties -- response.util#error and the errorHandler read NODE_ENV raw at call time; the contract differs by it, so the test must set it
  const env = process.env;
  const previous = env["NODE_ENV"];
  env["NODE_ENV"] = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete env["NODE_ENV"];
    } else {
      env["NODE_ENV"] = previous;
    }
  }
}

/**
 * Mount `handlers` on POST `route` of a fresh app and send one request.
 *
 * @param request - the handlers, the JSON body (or undefined for none), the path
 * @returns the response as the client received it
 */
export async function send(request: ProbeRequest): Promise<WireResponse> {
  const app = express();
  app.use(express.json());
  app.post(request.route ?? "/probe", ...request.handlers, reached);
  const handleError: ErrorRequestHandler = errorHandler;
  app.use(handleError);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => {
      resolve(s);
    });
  });
  try {
    const { port } = server.address() as AddressInfo;
    const url = `http://127.0.0.1:${String(port)}${request.path ?? "/probe"}${request.query ?? ""}`;
    const init: RequestInit =
      request.body === undefined
        ? { method: "POST" }
        : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) };
    const response = await fetch(url, init);
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * The exact body `validate(schema)` answers today, spelled out as a string so
 * key order and spacing are part of the assertion.
 *
 * @param mode - production omits `details`
 * @param details - the field errors, in Joi's order
 * @returns the JSON text of the 400 body
 */
export function expectedValidationBody(mode: Mode, details: readonly FieldError[]): string {
  const base = '{"success":false,"status":400,"message":"Validation Error","data":null';
  if (mode === "production") {
    return `${base}}`;
  }
  const items = details
    .map((d) => `{"field":${JSON.stringify(d.field)},"message":${JSON.stringify(d.message)}}`)
    .join(",");
  return `${base},"details":[${items}]}`;
}

/** A schema as `validate()` takes it — a Joi schema today, whatever P9-11 exports tomorrow. */
export type ValidatorSchema = Parameters<typeof validate>[0];

/**
 * Assert the full `validate(schema)` 400 contract for one schema and one
 * invalid payload, in production and outside it.
 *
 * @param schema - a real schema exported by a validator file
 * @param body - the invalid JSON body
 * @param details - the exact field errors expected outside production
 */
export async function expectValidationContract(
  schema: ValidatorSchema,
  body: unknown,
  details: readonly FieldError[],
): Promise<void> {
  for (const mode of ["test", "production"] as const) {
    const wire = await withNodeEnv(mode, () => send({ handlers: [validate(schema)], body }));
    expect({ mode, status: wire.status }).toEqual({ mode, status: 400 });
    expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
    expect(wire.text).toBe(expectedValidationBody(mode, details));
  }
}

/** How a validator file's own `validate(data, schema)` helper ended. */
export type HelperOutcome =
  | { readonly kind: "returned"; readonly value: unknown }
  | { readonly kind: "thrownError"; readonly message: string }
  | { readonly kind: "thrownValue"; readonly value: unknown };

/**
 * Call a validator file's own helper and record how it ended, so a test can
 * pin the shape the controllers receive.
 *
 * @param fn - the call to make
 * @returns the returned value, or what was thrown
 */
export function captureHelper(fn: () => unknown): HelperOutcome {
  try {
    return { kind: "returned", value: fn() };
  } catch (err: unknown) {
    if (err instanceof Error) {
      return { kind: "thrownError", message: err.message };
    }
    return { kind: "thrownValue", value: err };
  }
}

/**
 * The field errors of a Joi result, as the helper's caller maps them — for a
 * helper that returns Joi's `{ error, value }` instead of throwing.
 *
 * @param outcome - a "returned" outcome whose value is a Joi validation result
 * @returns each detail's path and message, in order
 */
export function joiResultDetails(outcome: HelperOutcome): FieldError[] {
  if (outcome.kind !== "returned") {
    throw new Error(`expected the helper to return, it ended as ${outcome.kind}`);
  }
  const result = outcome.value as { error?: { details: { path: (string | number)[]; message: string }[] } };
  return (result.error?.details ?? []).map((d) => ({ field: d.path.join("."), message: d.message }));
}
