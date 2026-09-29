/**
 * P9-11 contract pin — `validators/networkSecurity.validator.js`.
 *
 * Today's Joi 400 for `geofenceSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { geofenceSchema, validate as validateHelper } from "../../../validators/networkSecurity.validator";
import { expectValidationContract, captureHelper } from "./harness";

describe("P9-11 contract: validators/networkSecurity.validator.js", () => {
  it("validate(geofenceSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(geofenceSchema, {}, [
      {
        "field": "latitude",
        "message": "\"latitude\" is required",
      },
      {
        "field": "longitude",
        "message": "\"longitude\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) throws this plain object", () => {
    expect(captureHelper(() => validateHelper({}, geofenceSchema))).toEqual({
      kind: "thrownValue",
      value: {
        "status": 400,
        "message": "Validation failed",
        "errors": {
          "latitude": "\"latitude\" is required",
          "longitude": "\"longitude\" is required",
        },
      },
    });
  });
});
