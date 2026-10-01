/**
 * Default and maximum page sizes for list endpoints (P9-22, ADR-097).
 *
 * Canonical here, because the list-query schemas (certificate) are contracts.
 * backend/src/constants/appConstants.ts re-exports the same bindings, and
 * test/constants.test.ts asserts they are the same values.
 */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 200;
