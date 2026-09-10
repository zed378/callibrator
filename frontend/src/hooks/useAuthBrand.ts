import { useTenantBrandingStore } from "@/stores/tenantBrandingStore";
import { HAS_CONFIGURED_TENANT } from "@/constants";

const DEFAULT_BRAND_NAME = "Device Calibrator";

/**
 * Brand identity for the auth pages (login/register). Returns the
 * deploy-configured tenant's name + logo when available — fetched pre-auth by
 * `useTenantBranding` into the branding store — otherwise the default product
 * branding. `logoUrl` is null when there's no tenant logo (callers fall back to
 * the default Shield mark).
 */
export function useAuthBrand() {
  const branding = useTenantBrandingStore((s) => s.branding);
  // Only honor tenant branding on a deploy-bound (single-tenant) frontend, so a
  // default build always shows default branding regardless of any stale
  // localStorage from a previous authenticated session on this browser.
  const tenant = HAS_CONFIGURED_TENANT ? branding : null;
  const name = tenant?.appName || DEFAULT_BRAND_NAME;
  const logoUrl = tenant?.logoBaseUrl || null;
  const hasTenant = Boolean(tenant?.appName);
  return { name, logoUrl, hasTenant };
}

export default useAuthBrand;
