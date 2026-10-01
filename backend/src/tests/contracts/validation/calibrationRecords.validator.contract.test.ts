/**
 * P9-11 contract pin — `validators/calibrationRecords.validator.ts` (ADR-093).
 *
 * The validation 400 for `getCalibrationRecordsQuery` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { getCalibrationRecordsQuery } from "../../../validators/calibrationRecords.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/calibrationRecords.validator.ts", () => {
  it("validate(getCalibrationRecordsQuery) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(getCalibrationRecordsQuery, {
      "page": {
        "bogus": true,
      },
    }, [
      {
        "field": "page",
        "message": "Invalid input: expected number, received object",
      },
    ]);
  });
});
