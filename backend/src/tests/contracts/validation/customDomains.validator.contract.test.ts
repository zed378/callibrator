/**
 * P9-11 contract pin — `validators/customDomains.validator.js`.
 *
 * Today's Joi 400 for `addDomain` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { addDomain, validate as validateHelper } from "../../../validators/customDomains.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/customDomains.validator.js", () => {
  it("validate(addDomain) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(addDomain, {}, [
      {
        "field": "domain",
        "message": "Domain is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws an Error with this message and no status", () => {
    expect(captureHelper(() => validateHelper({}, addDomain))).toEqual({
      kind: "thrownError",
      message: "Domain is required",
    });
  });
});
