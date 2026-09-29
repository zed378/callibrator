/**
 * P9-11 contract pin — `validators/tenantHierarchy.validator.js`.
 *
 * Today's Joi 400 for `createSubOrganization` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createSubOrganization, validate as validateHelper } from "../../../validators/tenantHierarchy.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/tenantHierarchy.validator.js", () => {
  it("validate(createSubOrganization) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createSubOrganization, {}, [
      {
        "field": "name",
        "message": "\"name\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws an Error with this message and no status", () => {
    expect(captureHelper(() => validateHelper({}, createSubOrganization))).toEqual({
      kind: "thrownError",
      message: "\"name\" is required",
    });
  });
});
