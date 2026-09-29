/**
 * P9-11 contract pin — `validators/workflow.validator.js`.
 *
 * Today's Joi 400 for `createWorkflowSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createWorkflowSchema } from "../../../validators/workflow.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/workflow.validator.js", () => {
  it("validate(createWorkflowSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createWorkflowSchema, {}, [
      {
        "field": "name",
        "message": "\"name\" is required",
      },
      {
        "field": "resourceType",
        "message": "\"resourceType\" is required",
      },
      {
        "field": "steps",
        "message": "\"steps\" is required",
      },
    ]);
  });
});
