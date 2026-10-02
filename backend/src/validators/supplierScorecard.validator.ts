/**
 * Supplier scorecard request bodies (A-336, 2026-10-01): the contract's
 * schemas, mounted by `routes/api/supplierScorecard.route.ts` with
 * `validate()`. Defined in `@callibrator/contracts/supplierScorecard` (P9-22,
 * ADR-097); re-exported here so a route imports its validators from one place.
 */
export { createScorecard, updateScorecard } from "@callibrator/contracts/supplierScorecard";
