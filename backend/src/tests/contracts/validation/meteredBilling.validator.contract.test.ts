/**
 * P9-11 contract pin — `validators/meteredBilling.validator.js`.
 *
 * Today's Joi 400 for `createUsageAlert` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createUsageAlert, validate as validateHelper, validateBody } from "../../../validators/meteredBilling.validator";
import { expectValidationContract, captureHelper, JSON_CONTENT_TYPE, send, withNodeEnv } from "./harness";

describe("P9-11 contract: validators/meteredBilling.validator.js", () => {
  it("validate(createUsageAlert) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createUsageAlert, {}, [
      {
        "field": "metricName",
        "message": "\"metricName\" is required",
      },
      {
        "field": "threshold",
        "message": "\"threshold\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws an Error with this message and no status", () => {
    expect(captureHelper(() => validateHelper({}, createUsageAlert))).toEqual({
      kind: "thrownError",
      message: "\"metricName\" is required, \"threshold\" is required",
    });
  });

  // A SECOND live validation middleware: meteredBilling.route mounts
  // validateBody/validateQuery, not validate(schema). It forwards an Error to
  // the central errorHandler, so its 400 has a different envelope — no `data`,
  // a `requestId`, the messages joined into ONE string — and in production
  // the message is the GENERIC one, because an Error is not "exposable"
  // (fileValidation.util#isExposableError). Pinned as it is; P9-11 decides.
  it("validateBody(createUsageAlert) answers through the errorHandler: this 400 outside production", async () => {
    const wire = await withNodeEnv("test", () => send({ handlers: [validateBody(createUsageAlert)], body: {} }));
    expect(wire.status).toBe(400);
    expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
    const body = JSON.parse(wire.text) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["success", "status", "message", "stack", "name", "requestId"]);
    expect({ ...body, stack: typeof body["stack"] }).toEqual({
      success: false,
      status: 400,
      message: "\"metricName\" is required, \"threshold\" is required",
      stack: "string",
      name: "Error",
      requestId: "unknown",
    });
  });

  it("validateBody(createUsageAlert) in production: the generic message, byte for byte", async () => {
    const wire = await withNodeEnv("production", () =>
      send({ handlers: [validateBody(createUsageAlert)], body: {} }),
    );
    expect(wire.status).toBe(400);
    expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
    expect(wire.text).toBe(
      '{"success":false,"status":400,"message":"An unexpected error occurred. Please try again later.","requestId":"unknown"}',
    );
  });
});
