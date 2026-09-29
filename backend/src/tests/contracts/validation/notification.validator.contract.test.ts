/**
 * P9-11 contract pin — `validators/notification.validator.js`.
 *
 * Today's Joi 400 for `deleteManySchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { deleteManySchema, validate as validateHelper } from "../../../validators/notification.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/notification.validator.js", () => {
  it("validate(deleteManySchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(deleteManySchema, {}, [
      {
        "field": "ids",
        "message": "ids is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, deleteManySchema)))).toEqual([
      {
        "field": "ids",
        "message": "ids is required",
      },
    ]);
  });
});
