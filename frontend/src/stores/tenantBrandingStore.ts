import { create } from "zustand";

export interface TenantBranding {
  logo?: string;
  logoBaseUrl?: string;
  favicon?: string;
  appName?: string;
  /** Per-tenant brand color (hex). Drives the `--primary` theme token. */
  primaryColor?: string;
}

interface TenantBrandingState {
  branding: TenantBranding | null;
  isLoading: boolean;
  error: string | null;
  setBranding: (branding: TenantBranding) => void;
  clearBranding: () => void;
  setError: (error: string | null) => void;
}

export const useTenantBrandingStore = create<TenantBrandingState>()((set) => ({
  branding: null,
  isLoading: false,
  error: null,

  setBranding: (branding: TenantBranding) => {
    set({ branding, error: null });

    // Store in localStorage for persistence
    try {
      localStorage.setItem("tenant_branding", JSON.stringify(branding));
    } catch {
      // Ignore storage errors
    }
  },

  clearBranding: () => {
    set({ branding: null });
    try {
      localStorage.removeItem("tenant_branding");
    } catch {
      // Ignore storage errors
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },
}));
