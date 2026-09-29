/**
 * P9-11 contract pin — `validators/session.validator.js`.
 *
 * Today's Joi 400 for `revokeSessionSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { revokeSessionSchema, validate as validateHelper } from "../../../validators/session.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/session.validator.js", () => {
  it("validate(revokeSessionSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(revokeSessionSchema, {
      "reason": {
        "bogus": true,
      },
    }, [
      {
        "field": "reason",
        "message": "\"reason\" must be a string",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({
      "reason": {
        "bogus": true,
      },
    }, revokeSessionSchema)))).toEqual([
      {
        "field": "reason",
        "message": "\"reason\" must be a string",
      },
    ]);
  });
});
