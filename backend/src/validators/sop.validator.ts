/**
 * SOP request bodies (W-10, 2026-10-05): the contract's schema, mounted by
 * `routes/api/sop.route.ts` with `validate()`. Defined in
 * `@callibrator/contracts/sop` (P9-22, ADR-097); re-exported here so a route
 * imports its validators from one place.
 */
export { createSopDocument } from "@callibrator/contracts/sop";
