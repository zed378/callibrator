/**
 * Risk register request bodies (A-335, 2026-10-01): the contract's schemas,
 * mounted by `routes/api/risk.route.ts` with `validate()`. Defined in
 * `@callibrator/contracts/risk` (P9-22, ADR-097); re-exported here so a route
 * imports its validators from one place.
 */
export { createRisk, updateRisk } from "@callibrator/contracts/risk";
