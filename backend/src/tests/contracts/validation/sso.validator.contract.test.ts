/**
 * P9-11 contract pin — `validators/sso.validator.js`.
 *
 * Today's Joi 400 for `ssoLoginSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { ssoLoginSchema, validate as validateHelper } from "../../../validators/sso.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/sso.validator.js", () => {
  it("validate(ssoLoginSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(ssoLoginSchema, {}, [
      {
        "field": "tenantCode",
        "message": "\"tenantCode\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, ssoLoginSchema)))).toEqual([
      {
        "field": "tenantCode",
        "message": "\"tenantCode\" is required",
      },
    ]);
  });
});
