/**
 * P9-11 contract pin — `validators/meteredBilling.validator.ts` (ADR-093).
 *
 * The validation 400 for `createUsageAlert` through the real `validate(schema)`
 * middleware, byte for byte, in production and outside it. The status, the
 * envelope, the top-level `message` ("Validation Error") and `details`
 * only outside production are the contract this suite pinned before P9-11;
 * the wording inside `details` is Zod's since the move to Zod (the owner's
 * decision, ADR-093, which lists every changed string). See ./harness.ts.
 */
import { validate } from "../../../middlewares/validation.middleware";
import { createUsageAlert, getBillingHistory } from "../../../validators/meteredBilling.validator";
import { expectValidationContract, expectedValidationBody, JSON_CONTENT_TYPE, send, withNodeEnv } from "./harness";

describe("P9-11 contract: validators/meteredBilling.validator.ts", () => {
  it("validate(createUsageAlert) answers the pinned 400; details only outside production", async () => {
    await expectValidationContract(createUsageAlert, {}, [
      {
        "field": "metricName",
        "message": "Invalid input: expected string, received undefined",
      },
      {
        "field": "threshold",
        "message": "Invalid input: expected number, received undefined",
      },
    ]);
  });
  // Surface B folded (ADR-093): metered billing's own validateBody /
  // validateQuery answered through the errorHandler — no `data`, a
  // `requestId`, and in production the generic 500-style message. The route
  // now mounts validate(schema, { from: "query" }), so a query failure has the
  // common envelope and says "Validation Error" in production too.
  it("validate(getBillingHistory, { from: \"query\" }) answers the common 400 for a bad query", async () => {
    for (const mode of ["test", "production"] as const) {
      const wire = await withNodeEnv(mode, () =>
        send({ handlers: [validate(getBillingHistory, { from: "query" })], body: undefined, query: "?page=0" }),
      );
      expect({ mode, status: wire.status }).toEqual({ mode, status: 400 });
      expect(wire.contentType).toBe(JSON_CONTENT_TYPE);
      expect(wire.text).toBe(
        expectedValidationBody(mode, [{ field: "page", message: "Too small: expected number to be >=1" }]),
      );
    }
  });
});
