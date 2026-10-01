/**
 * P9-11 contract pin — `validators/workflow.validator.ts` (ADR-093).
 *
 * The validation 400 for `createWorkflowSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { createWorkflowSchema } from "../../../validators/workflow.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/workflow.validator.ts", () => {
  it("validate(createWorkflowSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createWorkflowSchema, {}, [
      {
        "field": "name",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "resourceType",
        "message": "Invalid option: expected one of \"Certificate\"|\"StockTransfer\"|\"MaintenanceWorkOrder\"",
      },
      {
        "field": "steps",
        "message": "Invalid input: expected array, received undefined",
      },
    ]);
  });
});
