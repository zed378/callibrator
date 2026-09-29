/**
 * P9-11 contract pin — `validators/stock.validator.js`.
 *
 * Today's Joi 400 for `createTransferSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it, and what the
 * file's own `validate(data, schema)` helper hands its controllers. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createTransferSchema, validate as validateHelper } from "../../../validators/stock.validator";
import { expectValidationContract, captureHelper, joiResultDetails } from "./harness";

describe("P9-11 contract: validators/stock.validator.js", () => {
  it("validate(createTransferSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createTransferSchema, {}, [
      {
        "field": "fromWarehouseId",
        "message": "\"fromWarehouseId\" is required",
      },
      {
        "field": "toWarehouseId",
        "message": "\"toWarehouseId\" is required",
      },
      {
        "field": "itemName",
        "message": "\"itemName\" is required",
      },
      {
        "field": "quantity",
        "message": "\"quantity\" is required",
      },
    ]);
  });
  it("its own validate(data, schema) returns Joi's result; the controller maps these details", () => {
    expect(joiResultDetails(captureHelper(() => validateHelper({}, createTransferSchema)))).toEqual([
      {
        "field": "fromWarehouseId",
        "message": "\"fromWarehouseId\" is required",
      },
      {
        "field": "toWarehouseId",
        "message": "\"toWarehouseId\" is required",
      },
      {
        "field": "itemName",
        "message": "\"itemName\" is required",
      },
      {
        "field": "quantity",
        "message": "\"quantity\" is required",
      },
    ]);
  });
});
