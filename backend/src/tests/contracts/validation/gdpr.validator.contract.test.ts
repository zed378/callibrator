/**
 * P9-11 contract pin — `validators/gdpr.validator.js`.
 *
 * Today's Joi 400 for `requestErasure` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { requestErasure, validate as validateHelper } from "../../../validators/gdpr.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/gdpr.validator.js", () => {
  it("validate(requestErasure) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(requestErasure, {}, [
      {
        "field": "reason",
        "message": "\"reason\" is required",
      },
      {
        "field": "confirm",
        "message": "\"confirm\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws an Error with this message and no status", () => {
    expect(captureHelper(() => validateHelper({}, requestErasure))).toEqual({
      kind: "thrownError",
      message: "\"reason\" is required, \"confirm\" is required",
    });
  });
});
