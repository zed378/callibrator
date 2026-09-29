/**
 * P9-11 contract pin — `validators/dataRetention.validator.js`.
 *
 * Today's Joi 400 for `retentionPolicySchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { retentionPolicySchema, validate as validateHelper } from "../../../validators/dataRetention.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/dataRetention.validator.js", () => {
  it("validate(retentionPolicySchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(retentionPolicySchema, {}, [
      {
        "field": "tenantId",
        "message": "\"tenantId\" is required",
      },
      {
        "field": "policyKey",
        "message": "\"policyKey\" is required",
      },
      {
        "field": "days",
        "message": "\"days\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, retentionPolicySchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "tenantId": "\"tenantId\" is required",
          "policyKey": "\"policyKey\" is required",
          "days": "\"days\" is required",
        },
      },
    });
  });
});
