/**
 * P9-11 contract pin — `validators/kanban.validator.js`.
 *
 * Today's Joi 400 for `createCard` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createCard } from "../../../validators/kanban.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/kanban.validator.js", () => {
  it("validate(createCard) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createCard, {}, [
      {
        "field": "columnId",
        "message": "\"columnId\" is required",
      },
      {
        "field": "title",
        "message": "\"title\" is required",
      },
    ]);
  });
});
