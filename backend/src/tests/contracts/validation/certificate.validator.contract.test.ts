/**
 * P9-11 contract pin — `validators/certificate.validator.js`.
 *
 * Today's Joi 400 for `approveCertificateSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { approveCertificateSchema, validate as validateHelper } from "../../../validators/certificate.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/certificate.validator.js", () => {
  it("validate(approveCertificateSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(approveCertificateSchema, {}, [
      {
        "field": "authMethod",
        "message": "\"authMethod\" is required",
      },
      {
        "field": "authPayload",
        "message": "\"authPayload\" is required",
      },
      {
        "field": "meaning",
        "message": "\"meaning\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, approveCertificateSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": [
          {
            "field": "authMethod",
            "message": "\"authMethod\" is required",
          },
          {
            "field": "authPayload",
            "message": "\"authPayload\" is required",
          },
          {
            "field": "meaning",
            "message": "\"meaning\" is required",
          },
        ],
      },
    });
  });
});
