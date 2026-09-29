/**
 * P9-11 contract pin — `validators/ticket.validator.js`.
 *
 * Today's Joi 400 for `createTicket` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createTicket } from "../../../validators/ticket.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/ticket.validator.js", () => {
  it("validate(createTicket) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createTicket, {}, [
      {
        "field": "subject",
        "message": "\"subject\" is required",
      },
    ]);
  });
});
