/**
 * P9-11 contract pin — `validators/warehouse.validator.ts` (ADR-093).
 *
 * The validation 400 for `createLocationSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { createLocationSchema } from "../../../validators/warehouse.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/warehouse.validator.ts", () => {
  it("validate(createLocationSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createLocationSchema, {}, [
      {
        "field": "warehouseId",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "name",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "code",
        "message": "Invalid input: expected string, received undefined",
      },
    ]);
  });
});
