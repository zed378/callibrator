/**
 * P9-11 contract pin — `validators/vendor.validator.js`.
 *
 * Today's Joi 400 for `qualifyVendor` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { qualifyVendor, validate as validateHelper } from "../../../validators/vendor.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/vendor.validator.js", () => {
  it("validate(qualifyVendor) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(qualifyVendor, {
      "approvalStatus": {
        "bogus": true,
      },
    }, [
      {
        "field": "approvalStatus",
        "message": "\"approvalStatus\" must be one of [APPROVED, PENDING, REJECTED, CONDITIONAL]",
      },
      {
        "field": "approvalStatus",
        "message": "\"approvalStatus\" must be a string",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({
      "approvalStatus": {
        "bogus": true,
      },
    }, qualifyVendor)))).toEqual([
      {
        "field": "approvalStatus",
        "message": "\"approvalStatus\" must be one of [APPROVED, PENDING, REJECTED, CONDITIONAL]",
      },
      {
        "field": "approvalStatus",
        "message": "\"approvalStatus\" must be a string",
      },
    ]);
  });
});
