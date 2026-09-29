/**
 * P9-11 contract pin — `validators/featureFlag.validator.js`.
 *
 * Today's Joi 400 for `flagValueSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { flagValueSchema, validate as validateHelper } from "../../../validators/featureFlag.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/featureFlag.validator.js", () => {
  it("validate(flagValueSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(flagValueSchema, {}, [
      {
        "field": "tenantId",
        "message": "\"tenantId\" is required",
      },
      {
        "field": "flagKey",
        "message": "\"flagKey\" is required",
      },
      {
        "field": "enabled",
        "message": "\"enabled\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, flagValueSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "tenantId": "\"tenantId\" is required",
          "flagKey": "\"flagKey\" is required",
          "enabled": "\"enabled\" is required",
        },
      },
    });
  });
});
