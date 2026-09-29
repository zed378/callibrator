/**
 * P9-11 contract pin — `validators/eSignature.validator.js`.
 *
 * Today's Joi 400 for `createWorkflow` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createWorkflow, validate as validateHelper } from "../../../validators/eSignature.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/eSignature.validator.js", () => {
  it("validate(createWorkflow) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createWorkflow, {}, [
      {
        "field": "documentId",
        "message": "\"documentId\" is required",
      },
      {
        "field": "signers",
        "message": "\"signers\" is required",
      },
      {
        "field": "subject",
        "message": "\"subject\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws an Error with this message and no status", () => {
    expect(captureHelper(() => validateHelper({}, createWorkflow))).toEqual({
      kind: "thrownError",
      message: "\"documentId\" is required, \"signers\" is required, \"subject\" is required",
    });
  });
});
