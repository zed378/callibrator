/**
 * P9-11 contract pin — `validators/scim.validator.js`.
 *
 * Today's Joi 400 for `scimUserSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { scimUserSchema, validate as validateHelper } from "../../../validators/scim.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/scim.validator.js", () => {
  it("validate(scimUserSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(scimUserSchema, {}, [
      {
        "field": "userName",
        "message": "\"userName\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, scimUserSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "userName": "\"userName\" is required",
        },
      },
    });
  });
});
