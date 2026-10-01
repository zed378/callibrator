/**
 * P9-11 (ADR-093) — `validate(schema)` over Zod, `validated()`, and the shared
 * input helpers in validators/input.
 *
 * Driven through the real middleware with a real `response.util`, so the
 * asserted status and body are what a client receives.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { validate, validated } from "../../middlewares/validation.middleware";
import { checkInput, fieldErrors, validateInput } from "../../validators/input";

/** The parts of a response the middleware writes. */
interface Captured {
  status?: number;
  body?: unknown;
}

const fakeResponse = (captured: Captured): Response => {
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      return res;
    },
  };
  return res as unknown as Response;
};

const fakeRequest = (parts: { body?: unknown; query?: unknown; params?: unknown }): Request =>
  ({ body: parts.body, query: parts.query ?? {}, params: parts.params ?? {} }) as unknown as Request;

const schema = z.object({ id: z.guid(), count: z.number().int().optional() });
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/**
 * Run the middleware once.
 *
 * @param handler - the middleware
 * @param req - the request
 * @returns what it sent, and whether it called next
 */
const run = (handler: ReturnType<typeof validate>, req: Request): Captured & { nexted: boolean } => {
  const captured: Captured = {};
  let nexted = false;
  void handler(req, fakeResponse(captured), () => {
    nexted = true;
  });
  return { ...captured, nexted };
};

describe("P9-11 validate(schema) over Zod", () => {
  it("passes a valid body, strips unknown keys, replaces req.body and sets req.validated", () => {
    const req = fakeRequest({ body: { id: ID, extra: true } });
    const out = run(validate(schema), req);
    expect(out.nexted).toBe(true);
    expect(req.body).toEqual({ id: ID });
    expect(req.validated).toEqual({ id: ID });
    expect(validated(req, schema)).toEqual({ id: ID });
  });

  it("checks an absent body as {} and answers the 400 envelope with details outside production", () => {
    const req = fakeRequest({ body: undefined });
    const out = run(validate(schema), req);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(400);
    expect(out.body).toEqual({
      success: false,
      status: 400,
      message: "Validation Error",
      data: null,
      details: [{ field: "id", message: "Invalid input: expected string, received undefined" }],
    });
  });

  it("reads the query when declared, and leaves req.body alone", () => {
    const req = fakeRequest({ body: { untouched: 1 }, query: { id: ID } });
    const out = run(validate(schema, { from: "query" }), req);
    expect(out.nexted).toBe(true);
    expect(req.body).toEqual({ untouched: 1 });
    expect(validated(req, schema)).toEqual({ id: ID });
  });

  it("reads the path parameters when declared", () => {
    const req = fakeRequest({ params: { id: ID } });
    expect(run(validate(schema, { from: "params" }), req).nexted).toBe(true);
    expect(validated(req, schema)).toEqual({ id: ID });
  });

  it("an absent single source is checked as {}", () => {
    const req = { body: undefined, query: undefined, params: undefined } as unknown as Request;
    expect(run(validate(schema, { from: "query" }), req).status).toBe(400);
  });

  it("merges declared sources with the path winning, whatever order they are written in", () => {
    const req = fakeRequest({ body: { id: OTHER, count: 2 }, params: { id: ID }, query: { id: OTHER } });
    expect(run(validate(schema, { from: ["body", "params", "query"] }), req).nexted).toBe(true);
    expect(validated(req, schema)).toEqual({ id: ID, count: 2 });
    expect(req.body).toEqual({ id: OTHER, count: 2 });
  });

  it("a non-object source contributes nothing to a merge", () => {
    const req = fakeRequest({ body: "text", params: { id: ID } });
    expect(run(validate(schema, { from: ["params", "body"] }), req).nexted).toBe(true);
    expect(validated(req, schema)).toEqual({ id: ID });
  });

  it("validated() refuses a schema the request was not validated by", () => {
    const req = fakeRequest({ body: { id: ID } });
    run(validate(schema), req);
    expect(() => validated(req, z.object({}))).toThrow("was not validated by that schema");
    expect(() => validated(fakeRequest({}), schema)).toThrow("was not validated by that schema");
  });
});

describe("P9-11 validators/input", () => {
  const nested = z.object({ items: z.array(z.object({ n: z.number() })) });

  it("fieldErrors joins the path with dots, array indexes included", () => {
    const result = nested.safeParse({ items: [{ n: 1 }, { n: "x" }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toEqual([
        { field: "items.1.n", message: "Invalid input: expected number, received string" },
      ]);
    }
  });

  it("checkInput answers ok with the parsed value, or the field errors; null is checked as {}", () => {
    expect(checkInput({ id: ID, extra: 1 }, schema)).toEqual({ ok: true, value: { id: ID } });
    expect(checkInput(null, schema)).toEqual({
      ok: false,
      errors: [{ field: "id", message: "Invalid input: expected string, received undefined" }],
    });
  });

  it("validateInput returns the value, or throws the plain 400 object", () => {
    expect(validateInput({ id: ID }, schema)).toEqual({ id: ID });
    let thrown: unknown;
    try {
      validateInput(undefined, schema);
    } catch (err: unknown) {
      thrown = err;
    }
    expect(thrown).toEqual({
      status: 400,
      message: "Validation failed",
      errors: [{ field: "id", message: "Invalid input: expected string, received undefined" }],
    });
    expect(thrown instanceof Error).toBe(false);
  });
});
