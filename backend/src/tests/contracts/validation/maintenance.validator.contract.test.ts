/**
 * P9-11 contract pin — `validators/maintenance.validator.ts` (ADR-093).
 *
 * The validation 400 for `createWorkOrder` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { createWorkOrder } from "../../../validators/maintenance.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/maintenance.validator.ts", () => {
  it("validate(createWorkOrder) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createWorkOrder, {}, [
      {
        "field": "deviceId",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "title",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "type",
        "message": "Invalid option: expected one of \"Preventative\"|\"Breakdown\"|\"Repair\"",
      },
    ]);
  });
});
