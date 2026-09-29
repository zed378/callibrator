/**
 * P9-11 contract pin — `validators/calibrationRecords.validator.js`.
 *
 * Today's Joi 400 for `getCalibrationRecordsQuery` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { getCalibrationRecordsQuery, validate as validateHelper } from "../../../validators/calibrationRecords.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/calibrationRecords.validator.js", () => {
  it("validate(getCalibrationRecordsQuery) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(getCalibrationRecordsQuery, {
      "page": {
        "bogus": true,
      },
    }, [
      {
        "field": "page",
        "message": "\"page\" must be a number",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({
      "page": {
        "bogus": true,
      },
    }, getCalibrationRecordsQuery)))).toEqual([
      {
        "field": "page",
        "message": "\"page\" must be a number",
      },
    ]);
  });
});
