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
 * change. Exempt: an impersonation session (the operator is not the account
 * holder and cannot enrol its authenticator) and — A-160's owner question,
 * decided — a FEDERATED session (SAML/OIDC): its second factor is the
 * identity provider's, and a local TOTP enrolment would never be asked for
 * at an SSO sign-in, so demanding one would be theatre, not a control.
 *
 * A PASSKEY DOES NOT COUNT (A-160's other owner question, decided):
 * WebAuthn here is a step-up check inside an existing session
 * (/webauthn/verify-login needs `auth` and opens no session); no sign-in ever
 * asks for it. Counting an enrolled passkey would let an account satisfy the
 * policy with a factor its sign-in never uses. Only TOTP (`mfaEnabled`) is a
 * sign-in factor today.
 *
 * P6-07 — A PLATFORM OPERATOR MUST HAVE MFA, whatever any tenant says. A
 * role at level 10 (SUPER_ADMIN) bypasses every permission and every tenant
 * predicate, so without a second factor it is one password from every
 * tenant (PR-3). Such an account without MFA gets the same enrolment-only
 * session: it can enrol, change its password, ask "who am I" and sign out,
 * and nothing else, until it has enrolled; from then on every password
 * sign-in asks for the code. It used to be exempt here as "the recovery
 * path"; a recovery path one password away from every tenant is the risk.
 * An operator never signs in through a tenant's SSO (A-210, sso.service).
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

/** P6-07: ROLE_LEVELS.SUPER_ADMIN — the level that bypasses every gate. */
const PLATFORM_OPERATOR_LEVEL = 10;

/** A-160: the sign-in methods whose second factor is the identity provider's. */
const FEDERATED_METHODS = new Set(["saml", "oidc"]);

/**
 * Whether this account is a platform operator (role level 10, or a super
 * admin role by name whatever its stored level).
 *
 * @param {{role?: {name?: string, roleLevel?: number}|null}|null} user
 * @returns {boolean}
 */
const isPlatformOperator = (user) =>
  Boolean(user && user.role) &&
  (SUPER_ADMIN_ROLE_NAMES.has(user.role.name) ||
    Number(user.role.roleLevel || 0) >= PLATFORM_OPERATOR_LEVEL);

/**
 * Whether a session signed in through an identity provider.
 *
 * @param {string|null|undefined} method - the access token's `amr` claim
 * @returns {boolean}
 */
const isFederatedMethod = (method) => FEDERATED_METHODS.has(method);

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
 * @param {{method?: (string|null)}} [session] - how the session signed in
 *   (the access token's `amr` claim)
 * @returns {boolean}
 */
const mfaEnrolmentRequired = (user, impersonatorId, { method = null } = {}) => {
  if (!user || impersonatorId || user.mfaEnabled === true) {
    return false;
  }
  // P6-07: whatever the tenant's policy — or with no tenant at all.
  if (isPlatformOperator(user)) {
    return true;
  }
  const policy = user.mfaPolicy;
  if (!policy || !policy.required || isFederatedMethod(method)) {
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
  PLATFORM_OPERATOR_LEVEL,
  parseMfaPolicy,
  isPlatformOperator,
  isFederatedMethod,
  mfaEnrolmentRequired,
};
