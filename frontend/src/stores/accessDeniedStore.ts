// src/stores/accessDeniedStore.ts
import { create } from "zustand";

/**
 * F-07: an action refused with 403 inside the caller's own tenant. Opened by
 * the API client (api/client.ts) on a refused mutation; rendered once, by
 * DashboardLayout, as AccessDeniedModal. Imports nothing, so the API client
 * can depend on it without a cycle through the auth store.
 */
interface AccessDeniedState {
  isOpen: boolean;
  /** The backend's message for the refusal, when it sent one. */
  message: string | null;
  /** Bumped on every refusal — DashboardLayout re-resolves the menu on change. */
  refusals: number;
  show: (message?: string | null) => void;
  close: () => void;
}

export const useAccessDeniedStore = create<AccessDeniedState>()((set) => ({
  isOpen: false,
  message: null,
  refusals: 0,
  show: (message) =>
    set((s) => ({ isOpen: true, message: message || null, refusals: s.refusals + 1 })),
  close: () => set({ isOpen: false, message: null }),
}));
