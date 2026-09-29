/**
 * P9-11 contract pin — the behaviour of `validate(schema)` itself, and of the
 * one other way a validator's 400 reaches the wire today.
 *
 * The per-validator files in this folder pin each validator's messages; this
 * file pins what every one of them relies on and what P9-11's Zod `validate()`
 * must keep (or change only by a recorded decision):
 *  - a bodyless request is validated as {} (A-09, Express 5);
 *  - unknown keys are stripped and the stripped value REPLACES req.body;
 *  - the middleware validates req.body ONLY — a path parameter is not merged
 *    in, so a schema that requires it 400s even when the path carries it (the
 *    "path parameter the validator never sees" trap, as-built);
 *  - a validator helper's thrown `{ status, message, errors }` object, sent by
 *    asyncHandler, loses `errors` on the wire and carries "[object Object]" as
 *    `details` outside production.
 * See ./harness.ts and MEMORY/specs/P9-11-validation-error-contract.md.
 */
import type { RequestHandler } from "express";
import { validate } from "../../../middlewares/validation.middleware";
import { asyncHandler } from "../../../utils/controllerWrapper.util";
import { tenantIdSchema } from "../../../validators/tenantLifecycle.validator";
import { createTenantSchema, validate as validateTenant } from "../../../validators/tenant.validator";
import { JSON_CONTENT_TYPE, expectedValidationBody, send, withNodeEnv } from "./harness";

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("P9-11 contract: validate(schema) middleware", () => {
  it("a request with NO body is validated as {} — required-field 400, not a pass (A-09)", async () => {
    const wire = await withNodeEnv("test", () => send({ handlers: [validate(tenantIdSchema)], body: undefined }));
    expect(wire.status).toBe(400);
    expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
    expect(wire.text).toBe(
      expectedValidationBody("test", [{ field: "tenantId", message: '"tenantId" is required' }]),
    );
  });

  it("a valid body passes; unknown keys are stripped and the stripped value replaces req.body", async () => {
    const wire = await withNodeEnv("test", () =>
      send({ handlers: [validate(tenantIdSchema)], body: { tenantId: TENANT, tenant: "x", isAdmin: true } }),
    );
    expect(wire.status).toBe(200);
    expect(wire.text).toBe(`{"reached":true,"body":{"tenantId":"${TENANT}"}}`);
  });

  it("validates req.body only: a path parameter is NOT merged in (as-built)", async () => {
    const wire = await withNodeEnv("test", () =>
      send({ handlers: [validate(tenantIdSchema)], route: "/probe/:tenantId", path: `/probe/${TENANT}`, body: {} }),
    );
    expect(wire.status).toBe(400);
    expect(wire.text).toBe(
      expectedValidationBody("test", [{ field: "tenantId", message: '"tenantId" is required' }]),
    );
  });

  it("validates req.body only: the query string is not seen either", async () => {
    const wire = await withNodeEnv("test", () =>
      send({ handlers: [validate(tenantIdSchema)], query: `?tenantId=${TENANT}`, body: {} }),
    );
    expect(wire.status).toBe(400);
  });
});

describe("P9-11 contract: a validator helper's throw, sent by asyncHandler", () => {
  // tenant.controller#createTenant's first step, as the controller runs it.
  // asyncHandler and the helper are JavaScript typed by JSDoc (`Function`,
  // `Object`), so the test adapts to them rather than asserting a type.
  const wrapped: unknown = asyncHandler(async (req: { body: object }) => {
    await Promise.resolve();
    validateTenant(req.body, createTenantSchema);
  });
  const createTenant: RequestHandler = (req, res, next) => {
    if (typeof wrapped !== "function") {
      throw new Error("asyncHandler returned no function");
    }
    wrapped.call(undefined, req, res, next);
  };

  it("outside production: the message, and `details` is the string \"[object Object]\" — `errors` is dropped", async () => {
    const wire = await withNodeEnv("test", () => send({ handlers: [createTenant], body: {} }));
    expect(wire.status).toBe(400);
    expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
    expect(wire.text).toBe(
      '{"success":false,"status":400,"message":"Validation failed","data":null,"details":"[object Object]"}',
    );
  });

  it("in production: the message only", async () => {
    const wire = await withNodeEnv("production", () => send({ handlers: [createTenant], body: {} }));
    expect(wire.status).toBe(400);
    expect(wire.text).toBe('{"success":false,"status":400,"message":"Validation failed","data":null}');
  });
});
