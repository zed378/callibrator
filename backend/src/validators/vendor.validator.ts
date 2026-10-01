/**
 * Vendor request bodies.
 *
 * P9-11 (ADR-093): moved to Zod. P9-22 (ADR-097): the schemas live in
 * `@callibrator/contracts/vendor` (packages/contracts/src/vendor.ts), shared
 * with the frontend. The same objects are re-exported here under the same
 * names, so routes, `validate()` and the tests are unchanged.
 */
export { createVendor, updateVendor, qualifyVendor } from "@callibrator/contracts/vendor";
