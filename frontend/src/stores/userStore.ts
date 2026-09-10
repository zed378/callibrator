import { create } from "zustand";
import { User, PaginatedResponse } from "@/types";
import { userService } from "@/api/services/user.service";

interface UserState {
  users: PaginatedResponse<User> | null;
  currentUser: User | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchUsers: (page?: number, limit?: number, search?: string) => Promise<void>;
  fetchUserById: (id: string) => Promise<void>;
  createUser: (data: {
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    roleId: string;
    tenantId?: string;
  }) => Promise<void>;
  updateUser: (data: {
    userId: string;
    username?: string;
    email?: string;
    status?: string;
  }) => Promise<void>;
  refetchUsers: () => Promise<void>;
  updateUserRole: (userId: string, roleId: string) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export const useUserStore = create<UserState>()((set) => ({
  users: null,
  currentUser: null,
  isLoading: false,
  error: null,

  fetchUsers: async (page = 1, limit = 50, search?: string) => {
    set({ isLoading: true, error: null });
    try {
      const users = await userService.getAll(page, limit, search);
      set({ users, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch users";
      set({ isLoading: false, error: message });
    }
  },

  fetchUserById: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const user = await userService.getById(id);
      set({ currentUser: user, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch user";
      set({ isLoading: false, error: message });
    }
  },

  createUser: async (data) => {
    set({ isLoading: true, error: null });
    try {
      await userService.create(data);
      // Re-fetch users after successful creation
      const state = useUserStore.getState();
      const users = await userService.getAll(
        state.users?.meta?.page || 1,
        state.users?.meta?.limit || 50,
      );
      set({ users, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to create user";
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  updateUser: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const user = await userService.update(data);
      set({ currentUser: user, isLoading: false, error: null });
      // Re-fetch users after successful update
      const state = useUserStore.getState();
      const users = await userService.getAll(
        state.users?.meta?.page || 1,
        state.users?.meta?.limit || 50,
      );
      set({ users, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update user";
      set({ isLoading: false, error: message });
    }
  },

  refetchUsers: async () => {
    const state = useUserStore.getState();
    set({ isLoading: true, error: null });
    try {
      const users = await userService.getAll(
        state.users?.meta?.page || 1,
        state.users?.meta?.limit || 50,
      );
      set({ users, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to refetch users";
      set({ isLoading: false, error: message });
    }
  },

  updateUserRole: async (userId: string, roleId: string) => {
    set({ isLoading: true, error: null });
    try {
      await userService.updateRole(userId, roleId);
      set({ isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update user role";
      set({ isLoading: false, error: message });
    }
  },

  deleteUser: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await userService.delete(id);
      // Re-fetch users after successful deletion
      const state = useUserStore.getState();
      const users = await userService.getAll(
        state.users?.meta?.page || 1,
        state.users?.meta?.limit || 50,
      );
      set({ users, isLoading: false, error: null });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to delete user";
      set({ isLoading: false, error: message });
    }
  },

  setError: (error) => set({ error }),
}));
