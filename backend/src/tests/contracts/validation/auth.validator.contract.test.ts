/**
 * P9-11 contract pin — `validators/auth.validator.js`.
 *
 * Today's Joi 400 for `registerSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { registerSchema, validate as validateHelper } from "../../../validators/auth.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/auth.validator.js", () => {
  it("validate(registerSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(registerSchema, {}, [
      {
        "field": "firstName",
        "message": "\"firstName\" is required",
      },
      {
        "field": "username",
        "message": "\"username\" is required",
      },
      {
        "field": "email",
        "message": "\"email\" is required",
      },
      {
        "field": "password",
        "message": "\"password\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, registerSchema)))).toEqual([
      {
        "field": "firstName",
        "message": "\"firstName\" is required",
      },
      {
        "field": "username",
        "message": "\"username\" is required",
      },
      {
        "field": "email",
        "message": "\"email\" is required",
      },
      {
        "field": "password",
        "message": "\"password\" is required",
      },
    ]);
  });
});
