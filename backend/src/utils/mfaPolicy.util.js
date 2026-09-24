/**
 * A-160 — the tenant "MFA required" policy.
 *
 * Two `tenant_settings` keys, written through the existing, gated and audited
 * settings API (PATCH /tenants/settings — Management write, A-117 audit):
 *
 *   mfa_required                  "true" turns the policy on; anything else
 *                                 (absent, "false") leaves it off
 *   mfa_required_min_role_level   optional: only roles at or above this
 *                                 level (ROLE_LEVELS) must enrol. Absent, or
 *                                 not a non-negative integer, means EVERY
 *                                 role — a typo makes the policy stricter,
 *                                 never silently weaker.
 *
 * While the policy applies to a signed-in user without MFA, auth.middleware
 * answers every route but the MFA enrolment ones with 403
 * MFA_ENROLMENT_REQUIRED — the same mechanism as A-123's forced password
 * change. Exempt: a super admin (the platform operator is not the tenant's to
 * govern, and is the recovery path) and an impersonation session (the
 * operator is not the account holder and cannot enrol its authenticator).
 *
 * The settings are read by authService.getAuthUserWithTenant, which builds
 * req.user on every request, and attached as `user.mfaPolicy`.
 */

const MFA_REQUIRED_KEY = "mfa_required";
const MFA_REQUIRED_MIN_ROLE_LEVEL_KEY = "mfa_required_min_role_level";
const MFA_POLICY_KEYS = Object.freeze([MFA_REQUIRED_KEY, MFA_REQUIRED_MIN_ROLE_LEVEL_KEY]);
const MFA_ENROLMENT_REQUIRED_CODE = "MFA_ENROLMENT_REQUIRED";

const NO_POLICY = Object.freeze({ required: false, minRoleLevel: null });

const SUPER_ADMIN_ROLE_NAMES = new Set(["SUPER_ADMIN", "SUPERADMIN"]);

/**
 * The policy from a tenant's `tenant_settings` rows.
 *
 * @param {Array<{key: string, value: (string|null)}>} rows
 * @returns {{required: boolean, minRoleLevel: (number|null)}}
 */
const parseMfaPolicy = (rows) => {
  const byKey = new Map((rows || []).map((row) => [row.key, row.value]));
  const required =
    String(byKey.get(MFA_REQUIRED_KEY) ?? "").trim().toLowerCase() === "true";
  if (!required) {
    return NO_POLICY;
  }
  const rawLevel = String(byKey.get(MFA_REQUIRED_MIN_ROLE_LEVEL_KEY) ?? "").trim();
  const minRoleLevel = /^\d+$/.test(rawLevel) ? Number(rawLevel) : null;
  return { required: true, minRoleLevel };
};

/**
 * Whether this signed-in principal must enrol MFA before anything else.
 *
 * @param {object} user - req.user as getAuthUserWithTenant builds it
 * @param {string|null} impersonatorId - set on an impersonation token
 * @returns {boolean}
 */
const mfaEnrolmentRequired = (user, impersonatorId) => {
  const policy = user && user.mfaPolicy;
  if (!policy || !policy.required || impersonatorId) {
    return false;
  }
  if (user.mfaEnabled === true || SUPER_ADMIN_ROLE_NAMES.has(user.role && user.role.name)) {
    return false;
  }
  if (policy.minRoleLevel === null || policy.minRoleLevel === undefined) {
    return true;
  }
  // A role with no level (or no role) is the lowest.
  const level = Number((user.role && user.role.roleLevel) || 0);
  return level >= policy.minRoleLevel;
};

module.exports = {
  MFA_REQUIRED_KEY,
  MFA_REQUIRED_MIN_ROLE_LEVEL_KEY,
  MFA_POLICY_KEYS,
  MFA_ENROLMENT_REQUIRED_CODE,
  NO_POLICY,
  parseMfaPolicy,
  mfaEnrolmentRequired,
};
