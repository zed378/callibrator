/**
 * The client-facility dimension's reviewed lists (ADR-124 and its Amendments 1–2; spec
 * MEMORY/specs/P19-04-client-facilities.md § 7, § 10; P18-03 spec § 4.1).
 *
 * P20-07 (the database layer) adds the one list the database itself enforces:
 * FACILITY_BOUND_ROLES, which migration 0123's `users_bound_role_check` trigger holds for every
 * write path the hooks do not see (the ETL, SCIM, a hand-written UPDATE). The migration writes
 * the names out as literals (a migration is frozen once applied); a test holds the two equal.
 *
 * TARGET, added by P21-09: FACILITY_ACCESSIBLE_ROUTES, FACILITY_READABLE, FACILITY_SCOPE_SKIPS.
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { ROLE_NAMES } from "./roleConstants";

/**
 * The roles a facility-bound user (`users.client_facility_id` set) may hold — the four upstream
 * facility actors map to them (P18-03 § 4.1). No new role; `ROLE_LEVELS` unchanged. Any other role
 * on a bound row is refused (400 by the service, P21-09; by the database trigger, now).
 */
export const FACILITY_BOUND_ROLES = Object.freeze([
  ROLE_NAMES.HEALTCARE_ADMIN,
  ROLE_NAMES.HEALTHCARE_TECHNICIAN,
  ROLE_NAMES.FACILITY_MAINTENANCE,
  ROLE_NAMES.ROOM_USER,
] as const);

/** One role a facility-bound user may hold. */
export type FacilityBoundRole = (typeof FACILITY_BOUND_ROLES)[number];
