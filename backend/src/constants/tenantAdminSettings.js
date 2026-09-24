/**
 * A-176 — the `tenant_settings` keys a tenant's own administrator may write
 * through `PATCH /tenants/settings` (Management write). Every other key is
 * refused with a 400 that names it.
 *
 * Before A-176 that endpoint accepted ANY key, and several keys in the same
 * table are controls that belong to a super admin or to a dedicated, gated
 * endpoint with its own validation and audit:
 *
 *   legal_hold_*, retention_policy_*   dataRetention.service (minimum periods,
 *                                      legal-hold release rules)
 *   lifecycle_status                   tenantLifecycle.service
 *   feature_flag_*                     featureFlag.service
 *   ip_allowlist, geofence             networkSecurity.service
 *   oidc_rp_*                          oidcProvider.service (client registry)
 *   storage_config, storage_credentials storage/config.service
 *
 * A Management writer could set any of them directly — lift a legal hold, put
 * a retention period below the minimum, re-open a suspended lifecycle, switch
 * a feature on, clear the IP allow-list, register an OIDC client — none of
 * which the gated endpoint would have allowed. Those keys stay writable ONLY
 * through their own endpoints.
 *
 * The list is derived from the code, not invented (2026-09-24):
 *  - WRITTEN by the frontend: the SSO form (frontend/src/app/dashboard/tenants/
 *    components/sso/useSsoSettings.ts) — the six `sso_*` keys. It is the only
 *    screen that calls `PATCH /tenants/settings`; branding uses tenant columns.
 *  - READ by the backend with no other writer:
 *      sso.controller / sso.service / oidcJwks  the `sso_*` and `oidc_*` keys
 *      utils/mfaPolicy.util                     mfa_required,
 *                                               mfa_required_min_role_level
 *      ai.service#getAiConfig                   ai_vendor, ai_base_url, ai_api_key
 *
 * A key added tomorrow is refused until it is named here, which is the point:
 * an allow-list fails closed, a deny-list fails open.
 */
const TENANT_ADMIN_SETTING_KEYS = Object.freeze([
  // SAML — the SSO form
  "sso_enabled",
  "sso_idp_entry_point",
  "sso_idp_entity_id",
  "sso_idp_cert",
  "sso_sp_entity_id",
  "sso_sp_callback_url",
  // OIDC relying party (this server signing in AGAINST the tenant's IdP)
  "oidc_client_id",
  "oidc_client_secret",
  "oidc_redirect_uri",
  "oidc_authority",
  // The tenant's MFA policy
  "mfa_required",
  "mfa_required_min_role_level",
  // The tenant's AI vendor
  "ai_vendor",
  "ai_base_url",
  "ai_api_key",
]);

/**
 * @param {string} key - a tenant_settings key
 * @returns {boolean} true when `PATCH /tenants/settings` may write it
 */
const isTenantAdminSettingKey = (key) =>
  typeof key === "string" && TENANT_ADMIN_SETTING_KEYS.includes(key);

module.exports = {
  TENANT_ADMIN_SETTING_KEYS,
  isTenantAdminSettingKey,
};
