import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  useTenantBrandingStore,
  TenantBranding,
} from "@/stores/tenantBrandingStore";
import { tenantService } from "@/api/services/tenant.service";
import { HAS_CONFIGURED_TENANT } from "@/constants";

export function useTenantBranding() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const {
    branding,
    setBranding,
    clearBranding,
    setError,
    isLoading: storeIsLoading,
  } = useTenantBrandingStore();

  useEffect(() => {
    // Try to load from localStorage first
    const stored = localStorage.getItem("tenant_branding");
    if (stored) {
      try {
        const parsed: TenantBranding = JSON.parse(stored);
        setBranding(parsed);
      } catch {
        // Ignore parse errors
      }
    }
  }, [setBranding]);

  useEffect(() => {
    // Authenticated users get their own tenant's full branding.
    const fetchAuthedBranding = async (tenantId: string) => {
      try {
        const tenant = await tenantService.getById(tenantId);

        const newBranding: TenantBranding = {
          logo: tenant.logo,
          logoBaseUrl: tenant.logoBaseUrl,
          favicon: tenant.logo || "/favicon.ico",
          appName: tenant.name || "Hospital Device Callibrator",
          primaryColor: tenant.primaryColor,
        };

        setBranding(newBranding);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to fetch tenant branding";

        // Check if this is an authentication/session verification failure (401 Unauthorized)
        const apiError = error as { response?: { status?: number } };
        const statusCode = apiError.response?.status;

        if (statusCode === 401) {
          // Auth verification failed - logout and destroy session
          await logout();
          clearBranding();
        } else {
          setError(message);
        }
      }
    };

    // Pre-auth (e.g. login/register): if the frontend is deploy-bound to a
    // tenant (NEXT_PUBLIC_TENANT_ID), fetch that tenant's public branding so
    // the auth pages are branded before sign-in. Failures leave the defaults.
    const fetchPublicBranding = async () => {
      try {
        const b = await tenantService.getPublicBranding();
        setBranding({
          appName: b.name || undefined,
          primaryColor: b.primaryColor || undefined,
          logo: b.logoBaseUrl || undefined,
          logoBaseUrl: b.logoBaseUrl || undefined,
          favicon: b.logoBaseUrl || "/favicon.ico",
        });
      } catch {
        // No public branding available — keep app defaults.
      }
    };

    if (isAuthenticated && user?.tenantId) {
      fetchAuthedBranding(user.tenantId);
    } else if (!isAuthenticated && HAS_CONFIGURED_TENANT) {
      fetchPublicBranding();
    }
  }, [
    isAuthenticated,
    user?.tenantId,
    setBranding,
    setError,
    logout,
    clearBranding,
  ]);

  return {
    branding,
    isLoading: storeIsLoading,
    error: useTenantBrandingStore.getState().error,
    clearBranding,
  };
}
