/**
 * P9-11 contract pin — `validators/qms.validator.js`.
 *
 * Today's Joi 400 for `createCapaSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createCapaSchema } from "../../../validators/qms.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/qms.validator.js", () => {
  it("validate(createCapaSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createCapaSchema, {}, [
      {
        "field": "ncId",
        "message": "\"ncId\" is required",
      },
      {
        "field": "title",
        "message": "\"title\" is required",
      },
      {
        "field": "actionPlan",
        "message": "\"actionPlan\" is required",
      },
    ]);
  });
});
