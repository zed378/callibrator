import { create } from "zustand";
import { Tenant, PaginatedResponse, TenantSettings, TenantSettingsResponse } from "@/types";
import { tenantService } from "@/api/services/tenant.service";

const setCookie = (name: string, value: string, days = 7) => {
  if (typeof document === "undefined") return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${value};${expires};path=/;SameSite=Lax`;
};

const deleteCookie = (name: string) => {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
};

interface TenantState {
  tenants: PaginatedResponse<Tenant> | null;
  currentTenant: Tenant | null;
  isLoading: boolean;
  error: string | null;
  settings: TenantSettingsResponse | null;

  // Actions
  fetchTenants: (
    page?: number,
    limit?: number,
    search?: string,
  ) => Promise<void>;
  fetchTenantById: (id: string) => Promise<void>;
  selectTenant: (tenant: Tenant | null) => void;
  fetchTenantSettings: (tenantId: string) => Promise<TenantSettingsResponse>;
  updateTenantSettings: (tenantId: string, settings: TenantSettings) => Promise<void>;
  createTenant: (data: {
    name: string;
    code: string;
    description?: string;
    primaryColor?: string;
    maxUsers?: number;
    file?: File;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    website?: string;
  }) => Promise<Tenant>;
  updateTenant: (data: {
    tenantId: string;
    name?: string;
    code?: string;
    description?: string;
    primaryColor?: string;
    status?: "ACTIVE" | "INACTIVE" | "SUSPENDED";
    maxUsers?: number;
    file?: File;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
    website?: string;
  }) => Promise<void>;
  refetchTenants: () => Promise<void>;
  deleteTenant: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useTenantStore = create<TenantState>()((set) => ({
  tenants: null,
  currentTenant: null,
  isLoading: false,
  error: null,
  settings: null,

  fetchTenants: async (page = 1, limit = 25, search?: string) => {
    set({ isLoading: true, error: null });
    try {
      const tenants = await tenantService.getAll(page, limit, search);
      set({ tenants, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch tenants";
      set({ isLoading: false, error: message });
    }
  },

  fetchTenantById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const tenant = await tenantService.getById(id);
      set({ currentTenant: tenant, isLoading: false, error: null });
      if (tenant) {
        setCookie("x_tenant_id", tenant.id, 7);
      } else {
        deleteCookie("x_tenant_id");
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch tenant";
      set({ isLoading: false, error: message });
    }
  },

  selectTenant: (tenant) => {
    set({ currentTenant: tenant });
    if (tenant) {
      setCookie("x_tenant_id", tenant.id, 7);
    } else {
      deleteCookie("x_tenant_id");
    }
  },

  createTenant: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const tenant = await tenantService.create(data);
      // Re-fetch tenants after successful creation
      const state = useTenantStore.getState();
      const tenants = await tenantService.getAll(
        state.tenants?.meta?.page || 1,
        state.tenants?.meta?.limit || 25,
      );
      set({ tenants, isLoading: false, error: null });
      return tenant;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create tenant";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateTenant: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const tenant = await tenantService.update(data);
      set({ currentTenant: tenant, isLoading: false, error: null });
      if (tenant) {
        setCookie("x_tenant_id", tenant.id, 7);
      } else {
        deleteCookie("x_tenant_id");
      }
      // Re-fetch tenants after successful update
      const state = useTenantStore.getState();
      const tenants = await tenantService.getAll(
        state.tenants?.meta?.page || 1,
        state.tenants?.meta?.limit || 25,
      );
      set({ tenants, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update tenant";
      set({ isLoading: false, error: message });
    }
  },

  refetchTenants: async () => {
    const state = useTenantStore.getState();
    set({ isLoading: true, error: null });
    try {
      const tenants = await tenantService.getAll(
        state.tenants?.meta?.page || 1,
        state.tenants?.meta?.limit || 25,
      );
      set({ tenants, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to refetch tenants";
      set({ isLoading: false, error: message });
    }
  },

  deleteTenant: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await tenantService.delete(id);
      // Re-fetch tenants after successful deletion
      const state = useTenantStore.getState();
      if (state.currentTenant?.id === id) {
        set({ currentTenant: null });
        deleteCookie("x_tenant_id");
      }
      const tenants = await tenantService.getAll(
        state.tenants?.meta?.page || 1,
        state.tenants?.meta?.limit || 25,
      );
      set({ tenants, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete tenant";
      set({ isLoading: false, error: message });
    }
  },

  fetchTenantSettings: async (tenantId: string) => {
    set({ isLoading: true, error: null });
    try {
      const settings = await tenantService.getSettings(tenantId);
      set({ settings, isLoading: false, error: null });
      return settings;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch tenant settings";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateTenantSettings: async (tenantId: string, settings: TenantSettings) => {
    set({ isLoading: true, error: null });
    try {
      await tenantService.updateSettings(tenantId, settings);
      set((state) => {
        if (state.settings) {
          return {
            isLoading: false,
            error: null,
            settings: {
              ...state.settings,
              settings: {
                ...state.settings.settings,
                ...settings,
              },
            },
          };
        }
        return { isLoading: false, error: null };
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update tenant settings";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  setError: (error) => set({ error }),
}));
