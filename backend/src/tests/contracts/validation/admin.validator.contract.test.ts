/**
 * P9-11 contract pin — `validators/admin.validator.js`.
 *
 * Today's Joi 400 for `updateTenantFlagsSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { updateTenantFlagsSchema } from "../../../validators/admin.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/admin.validator.js", () => {
  it("validate(updateTenantFlagsSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(updateTenantFlagsSchema, {}, [
      {
        "field": "flags",
        "message": "\"flags\" is required",
      },
    ]);
  });
});
