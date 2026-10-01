/**
 * P9-11 contract pin — `validators/user.validator.ts` (ADR-093).
 *
 * The validation 400 for `createUserSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { createUserSchema } from "../../../validators/user.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/user.validator.ts", () => {
  it("validate(createUserSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createUserSchema, {}, [
      {
        "field": "username",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "firstName",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "lastName",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "email",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "password",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "roleId",
        "message": "Invalid input: expected string, received undefined",
      },
    ]);
  });
});
