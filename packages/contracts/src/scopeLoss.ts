/**
 * The 403 codes on which an offline client purges its working set and signs out (AM-1; P19-08
 * § 10, G-O5). The account and tenant codes are sent by P21-03; the facility codes by P21-09.
 * `FACILITY_ROUTE_REFUSED` is NOT one: it refuses one action, the account keeps its scope.
 *
 * P22-10c2 (ADR-127 Am. 4): its own module, with no zod import, so the field app's sync engine
 * reads it without loading zod into the `/field` first load. `clientFacilities.ts` re-exports it.
 */
export const SCOPE_LOSS_CODES = Object.freeze([
  "ACCOUNT_INACTIVE",
  "TENANT_SUSPENDED",
  "TENANT_DELETED",
  "FACILITY_INACTIVE",
  "FACILITY_ENDED",
  "FACILITY_BINDING_PENDING",
] as const);
export type ScopeLossCode = (typeof SCOPE_LOSS_CODES)[number];

/** Whether a response's top-level `code` means the account lost its scope. */
export const isScopeLossCode = (code: unknown): code is ScopeLossCode =>
  typeof code === "string" && (SCOPE_LOSS_CODES as readonly string[]).includes(code);
