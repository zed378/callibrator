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
 *  - WRITTEN by the frontend: the SSO form (frontend/src/app/(app)/dashboard/tenants/
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
export const TENANT_ADMIN_SETTING_KEYS = Object.freeze([
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
  // P21-09e (P19-04 spec § 4.6, UD-18 (b)): the off-boarding of a client facility — the days after
  // `ended` before its bound accounts are deactivated (default 30), and the years its records are
  // kept after `ended` (unset: no end date; the data-retention policy reports, never purges evidence).
  "client_facilities_bound_user_deactivation_days",
  "client_facilities_ended_retention_years",
  // P21-04 (P19-02 spec § 4.3, § 11; P19-06 spec § 7.3; UD-17 a working decision, ADR-126 Am. 5): the
  // tenant's IANA time zone (report numbers' day, "due"'s month; unset = Asia/Jakarta), the IPM interval
  // in months (unset = not scheduled), the electronic IPSRS countersignature (unset = off), and the
  // switch for the recommendation's side effects (unset = on — the reversible part of UD-17).
  "tenant_time_zone",
  "ipm_interval_months",
  "ipm_countersign_enabled",
  "ipm_recommendation_side_effects",
  // P21-02a / P21-05 (ADR-132 Am. 2, ADR-133 Am. 2): the QR prefix and digits of a bare sticker number,
  // the PWA working set's cap, and the "calibration due soon" window (services/deviceSettings).
  "device_qr_code_prefix",
  "device_qr_code_digits",
  "field_working_set_max_devices",
  "calibration_due_soon_days",
] as const);

/** P21-09e: the integer settings above, with their allowed range (an empty value clears one). */
export type TenantAdminIntegerSettingKey =
  | "client_facilities_bound_user_deactivation_days"
  | "client_facilities_ended_retention_years"
  | "ipm_interval_months"
  | "device_qr_code_digits"
  | "field_working_set_max_devices"
  | "calibration_due_soon_days";
export const TENANT_ADMIN_INTEGER_SETTINGS: Readonly<Record<TenantAdminIntegerSettingKey, { readonly min: number; readonly max: number }>> = Object.freeze({
  client_facilities_bound_user_deactivation_days: { min: 1, max: 3650 },
  client_facilities_ended_retention_years: { min: 1, max: 100 },
  ipm_interval_months: { min: 1, max: 60 },
  device_qr_code_digits: { min: 4, max: 12 },
  field_working_set_max_devices: { min: 1, max: 5000 },
  calibration_due_soon_days: { min: 1, max: 365 },
});

/** P21-02a: the settings held to a pattern (the source of a RegExp), with the 400's wording. */
export const TENANT_ADMIN_PATTERN_SETTINGS: Readonly<Record<string, { readonly pattern: string; readonly wording: string }>> = Object.freeze({
  device_qr_code_prefix: { pattern: "^[A-Z]{1,8}$", wording: "1 to 8 upper-case letters" },
});

/** P21-04: the boolean settings above — `true` / `false` (a string or a JSON boolean), or nothing (cleared). */
export const TENANT_ADMIN_BOOLEAN_SETTINGS: readonly string[] = Object.freeze(["ipm_countersign_enabled", "ipm_recommendation_side_effects"]);

/** P21-04: the settings holding an IANA time zone (checked against the runtime's zone database when saved). */
export const TENANT_ADMIN_TIME_ZONE_SETTINGS: readonly string[] = Object.freeze(["tenant_time_zone"]);

/** One key a tenant administrator may write. */
export type TenantAdminSettingKey = (typeof TENANT_ADMIN_SETTING_KEYS)[number];

/** The same list, widened so `includes` accepts any string (no runtime effect). */
const ADMIN_KEYS: readonly string[] = TENANT_ADMIN_SETTING_KEYS;

/**
 * @param key - a tenant_settings key
 * @returns true when `PATCH /tenants/settings` may write it
 */
export const isTenantAdminSettingKey = (key: unknown): key is TenantAdminSettingKey =>
  typeof key === "string" && ADMIN_KEYS.includes(key);
