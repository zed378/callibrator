/**
 * P9-11 contract pin — `validators/webhook.validator.js`.
 *
 * Today's Joi 400 for `createWebhookSchema` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The
 * expectations are literals recorded on 2026-09-28; a Zod conversion must keep
 * this file passing unchanged. See ./harness.ts and
 * MEMORY/specs/P9-11-validation-error-contract.md.
 */
import { createWebhookSchema } from "../../../validators/webhook.validator";
import { expectValidationContract } from "./harness";

describe("P9-11 contract: validators/webhook.validator.js", () => {
  it("validate(createWebhookSchema) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createWebhookSchema, {}, [
      {
        "field": "url",
        "message": "\"url\" is required",
      },
      {
        "field": "events",
        "message": "\"events\" is required",
      },
    ]);
  });
});
