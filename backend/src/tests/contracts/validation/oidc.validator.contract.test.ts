/**
 * P9-11 contract pin — `validators/oidc.validator.js`.
 *
 * Today's Joi 400 for `oidcClientSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { oidcClientSchema, validate as validateHelper } from "../../../validators/oidc.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/oidc.validator.js", () => {
  it("validate(oidcClientSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(oidcClientSchema, {}, [
      {
        "field": "name",
        "message": "\"name\" is required",
      },
      {
        "field": "redirectUris",
        "message": "\"redirectUris\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, oidcClientSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "name": "\"name\" is required",
          "redirectUris": "\"redirectUris\" is required",
        },
      },
    });
  });
});
