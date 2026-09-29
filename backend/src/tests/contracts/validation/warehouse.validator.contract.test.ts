/**
 * P9-11 contract pin — `validators/warehouse.validator.js`.
 *
 * Today's Joi 400 for `createLocationSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createLocationSchema, validate as validateHelper } from "../../../validators/warehouse.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/warehouse.validator.js", () => {
  it("validate(createLocationSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createLocationSchema, {}, [
      {
        "field": "warehouseId",
        "message": "\"warehouseId\" is required",
      },
      {
        "field": "name",
        "message": "\"name\" is required",
      },
      {
        "field": "code",
        "message": "\"code\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, createLocationSchema)))).toEqual([
      {
        "field": "warehouseId",
        "message": "\"warehouseId\" is required",
      },
      {
        "field": "name",
        "message": "\"name\" is required",
      },
      {
        "field": "code",
        "message": "\"code\" is required",
      },
    ]);
  });
});
