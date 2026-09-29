/**
 * P9-11 contract pin — `validators/billing.validator.js`.
 *
 * Today's Joi 400 for `updateSubscription` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { updateSubscription, validate as validateHelper } from "../../../validators/billing.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/billing.validator.js", () => {
  it("validate(updateSubscription) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(updateSubscription, {}, [
      {
        "field": "",
        "message": "\"value\" must contain at least one of [planId, status, billingCycle]",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, updateSubscription)))).toEqual([
      {
        "field": "",
        "message": "\"value\" must contain at least one of [planId, status, billingCycle]",
      },
    ]);
  });
});
