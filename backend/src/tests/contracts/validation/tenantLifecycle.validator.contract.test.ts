/**
 * P9-11 contract pin — `validators/tenantLifecycle.validator.js`.
 *
 * Today's Joi 400 for `suspendTenantSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { suspendTenantSchema, validate as validateHelper } from "../../../validators/tenantLifecycle.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/tenantLifecycle.validator.js", () => {
  it("validate(suspendTenantSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(suspendTenantSchema, {}, [
      {
        "field": "tenantId",
        "message": "\"tenantId\" is required",
      },
      {
        "field": "reason",
        "message": "\"reason\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, suspendTenantSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "tenantId": "\"tenantId\" is required",
          "reason": "\"reason\" is required",
        },
      },
    });
  });
});
