/**
 * The client-facility switches (P21-09; ADR-124 § 10, Am. 2 § 6; spec
 * MEMORY/specs/P19-04-client-facilities.md § 10.2).
 *
 * `FACILITY_BINDING_ENABLED` holds the PRE-INVITATION GATE as a switch, not a convention: while
 * it is not "true", binding a user to a client facility (`PUT /users/:userId/client-facility`) is
 * refused with 409 "Facility-bound accounts are not enabled yet." — so no facility-bound account
 * exists before the threat model's § 11 gate is green and P17-07 has closed its findings. The
 * release that flips it does so with a record. Read at call time (a restart applies a change).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { env } from "./env";

/** Whether facility-bound accounts may be created (the pre-invitation gate is green). */
export const facilityBindingEnabled = (): boolean => env("FACILITY_BINDING_ENABLED") === "true";
