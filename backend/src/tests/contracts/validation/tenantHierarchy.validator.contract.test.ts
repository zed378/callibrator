/**
 * P9-11 contract pin — `validators/tenantHierarchy.validator.ts` (ADR-093).
 *
 * The validation 400 for `createSubOrganization` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { createSubOrganization } from "../../../validators/tenantHierarchy.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/tenantHierarchy.validator.ts", () => {
  it("validate(createSubOrganization) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createSubOrganization, {}, [
      {
        "field": "name",
        "message": "Invalid input: expected string, received undefined",
      },
    ]);
  });
});
