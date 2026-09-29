/**
 * P9-11 contract pin — `validators/user.validator.js`.
 *
 * Today's Joi 400 for `createUserSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createUserSchema, validate as validateHelper } from "../../../validators/user.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/user.validator.js", () => {
  it("validate(createUserSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createUserSchema, {}, [
      {
        "field": "username",
        "message": "\"username\" is required",
      },
      {
        "field": "firstName",
        "message": "\"firstName\" is required",
      },
      {
        "field": "lastName",
        "message": "\"lastName\" is required",
      },
      {
        "field": "email",
        "message": "\"email\" is required",
      },
      {
        "field": "password",
        "message": "\"password\" is required",
      },
      {
        "field": "roleId",
        "message": "\"roleId\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, createUserSchema)))).toEqual([
      {
        "field": "username",
        "message": "\"username\" is required",
      },
      {
        "field": "firstName",
        "message": "\"firstName\" is required",
      },
      {
        "field": "lastName",
        "message": "\"lastName\" is required",
      },
      {
        "field": "email",
        "message": "\"email\" is required",
      },
      {
        "field": "password",
        "message": "\"password\" is required",
      },
      {
        "field": "roleId",
        "message": "\"roleId\" is required",
      },
    ]);
  });
});
