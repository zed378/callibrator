import { create } from 'zustand';
import { Role, PaginatedResponse } from '@/types';
import { roleService } from '@/api/services/role.service';

interface RoleState {
  roles: PaginatedResponse<Role> | null;
  currentRole: Role | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchRoles: (page?: number, limit?: number, search?: string) => Promise<void>;
  fetchRoleById: (id: string) => Promise<void>;
  createRole: (data: {
    name: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
  }) => Promise<void>;
  updateRole: (data: {
    id: string;
    name?: string;
    description?: string;
    nameToShow?: string;
    isActive?: boolean;
    roleLevel?: number;
  }) => Promise<void>;
  refetchRoles: () => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useRoleStore = create<RoleState>()((set) => ({
  roles: null,
  currentRole: null,
  isLoading: false,
  error: null,

  fetchRoles: async (page = 1, limit = 50, search?: string) => {
    set({ isLoading: true, error: null });
    try {
      const roles = await roleService.getAll(page, limit, search);
      set({ roles, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch roles';
      set({ isLoading: false, error: message });
    }
  },

  fetchRoleById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const role = await roleService.getById(id);
      set({ currentRole: role, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to fetch role';
      set({ isLoading: false, error: message });
    }
  },

  createRole: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await roleService.create(data);
      // Re-fetch roles after successful creation
      const roles = await roleService.getAll(1, 50);
      set({ roles, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to create role';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateRole: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const role = await roleService.update(data);
      set({ currentRole: role, isLoading: false, error: null });
      // Re-fetch roles after successful update
      const state = useRoleStore.getState();
      const roles = await roleService.getAll(
        state.roles?.meta?.page || 1,
        state.roles?.meta?.limit || 50,
      );
      set({ roles, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to update role';
      set({ isLoading: false, error: message });
    }
  },

  refetchRoles: async () => {
    const state = useRoleStore.getState();
    set({ isLoading: true, error: null });
    try {
      const roles = await roleService.getAll(
        state.roles?.meta?.page || 1,
        state.roles?.meta?.limit || 50,
      );
      set({ roles, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to refetch roles';
      set({ isLoading: false, error: message });
    }
  },

  deleteRole: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await roleService.delete(id);
      // Re-fetch roles after successful deletion
      const state = useRoleStore.getState();
      const roles = await roleService.getAll(
        state.roles?.meta?.page || 1,
        state.roles?.meta?.limit || 50,
      );
      set({ roles, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete role';
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
