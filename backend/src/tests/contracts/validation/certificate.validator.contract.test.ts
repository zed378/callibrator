/**
 * P9-11 contract pin — `validators/certificate.validator.ts` (ADR-093).
 *
 * The validation 400 for `approveCertificateSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { approveCertificateSchema } from "../../../validators/certificate.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/certificate.validator.ts", () => {
  it("validate(approveCertificateSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(approveCertificateSchema, {}, [
      {
        "field": "authMethod",
        "message": "Invalid option: expected one of \"password\"|\"mfa\"",
      },
      {
        "field": "authPayload",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "meaning",
        "message": "Invalid input: expected string, received undefined",
      },
    ]);
  });
});
