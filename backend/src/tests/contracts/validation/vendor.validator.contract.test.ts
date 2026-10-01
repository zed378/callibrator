/**
 * P9-11 contract pin — `validators/vendor.validator.ts` (ADR-093).
 *
 * The validation 400 for `qualifyVendor` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { qualifyVendor } from "../../../validators/vendor.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/vendor.validator.ts", () => {
  it("validate(qualifyVendor) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(qualifyVendor, {
      "approvalStatus": {
        "bogus": true,
      },
    }, [
      {
        "field": "approvalStatus",
        "message": "Invalid input: expected string, received object",
      },
    ]);
  });
});
