/**
 * A-276 (ADR-094) — whose suspension a tenant is under.
 *
 * Two parties suspend a tenant: the platform operator
 * (tenantLifecycle.service#suspendTenant, which always names the operator in
 * `suspended_by`) and dunning (stripeWebhook.service, on repeated payment
 * failure). A payment may lift only dunning's suspension; before this, a paid
 * invoice set every suspended, and every offboarded, tenant `active`.
 *
 * Dunning's suspension is recognised by BOTH marks: this reason, and no
 * `suspended_by`. An operator who happens to type the reason still names
 * themselves, so their suspension is never mistaken for dunning's.
 */

/** The `suspension_reason` a dunning suspension carries. */
export const DUNNING_SUSPENSION_REASON = "billing:dunning";

/**
 * A-322 — the `suspension_reason` of a free-plan tenant suspended by quota
 * enforcement (meteredBilling.service#enforceQuotas). Marked as dunning's is:
 * this reason and no `suspended_by`. A payment does NOT lift it (it is not
 * dunning's): the tenant is over its free quota, not behind on a bill.
 */
export const QUOTA_SUSPENSION_REASON = "billing:quota";

/** The Tenant fields the decision reads. */
export interface SuspensionState {
  readonly status?: string | null;
  readonly suspensionReason?: string | null;
  readonly suspendedBy?: string | null;
}

/**
 * @param tenant - a Tenant row
 * @returns whether the tenant is suspended by dunning (and only by dunning)
 */
export const isDunningSuspension = (tenant: SuspensionState): boolean =>
  tenant.status === "suspended" &&
  !tenant.suspendedBy &&
  tenant.suspensionReason === DUNNING_SUSPENSION_REASON;
