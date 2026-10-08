/**
 * P21-09 (ADR-124 Am. 2 § 8; spec MEMORY/specs/P19-04-client-facilities.md § 7.2; AM-1, AM-3) —
 * why an authenticated USER principal may not act for its facility, or null.
 *
 * Read after the tenant refusal (A-101) and before the context is built, by every entry path that
 * loads a user: `auth` (403 with a TOP-LEVEL `code` — the PWA purges on the scope-loss codes),
 * `optionalAuth` (treated as no principal, as a suspended tenant is) and the socket handshake and
 * re-check (config/socket). One function, so the three cannot drift.
 *
 * Bound-ness is a ROW property (`clientFacilityId` set — AM-3), never a role or a join. The
 * facility's status comes from the `clientFacility` include auth.service#getAuthUserWithTenant
 * loads (`required: false`, no context).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import type { FacilityRefusalCode } from "@callibrator/contracts/clientFacilities";

/** The loaded user, as far as the refusal reads it. */
export interface FacilityRefusalPrincipal {
  readonly clientFacilityId?: unknown;
  readonly facilityBindingPending?: unknown;
  readonly clientFacility?: { readonly status?: unknown } | null;
}

/** A refusal: the machine-readable code and the message the account holder reads. */
export interface FacilityRefusal {
  readonly code: Exclude<FacilityRefusalCode, "FACILITY_ROUTE_REFUSED">;
  readonly message: string;
}

/** The messages of spec § 7.2, by code. */
export const FACILITY_REFUSAL_MESSAGES: Readonly<Record<FacilityRefusal["code"], string>> = Object.freeze({
  FACILITY_BINDING_PENDING: "Your account is waiting for an administrator to assign it to a facility.",
  FACILITY_UNRESOLVED: "Your facility could not be found.",
  FACILITY_INACTIVE: "Your facility's access is paused.",
  FACILITY_ENDED: "Your facility's access has ended.",
});

const refusal = (code: FacilityRefusal["code"]): FacilityRefusal => ({ code, message: FACILITY_REFUSAL_MESSAGES[code] });

/**
 * Why `user` is refused for its facility, or null when it may act.
 *
 * - `facilityBindingPending` (SSO JIT / SCIM in a multi-facility tenant, AM-15) — any account;
 * - a bound account whose facility row did not load (cannot happen with the foreign key; held);
 * - a bound account whose facility is `inactive` or `ended`.
 * An unbound account (provider staff, a self-served hospital, the super admin) is never refused here.
 *
 * @param user - the loaded user row
 * @returns the refusal, or null
 */
export const facilityRefusalOf = (user: FacilityRefusalPrincipal | null | undefined): FacilityRefusal | null => {
  if (!user) {
    return null;
  }
  if (user.facilityBindingPending === true) {
    return refusal("FACILITY_BINDING_PENDING");
  }
  if (typeof user.clientFacilityId !== "string" || !user.clientFacilityId) {
    return null;
  }
  if (!user.clientFacility) {
    return refusal("FACILITY_UNRESOLVED");
  }
  if (user.clientFacility.status === "inactive") {
    return refusal("FACILITY_INACTIVE");
  }
  if (user.clientFacility.status === "ended") {
    return refusal("FACILITY_ENDED");
  }
  return user.clientFacility.status === "active" ? null : refusal("FACILITY_UNRESOLVED");
};
