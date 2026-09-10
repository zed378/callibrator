import { create } from "zustand";
import type { MenuGroup } from "@/types";
import { DASHBOARD_MENU } from "@/constants";
import { menuGroupRoleService } from "@/api/services/menuGroupRole.service";

export interface BackendMenuItem {
  label: string;
  path: string;
  icon: string;
  requiredPermission?: string;
  // Sub-group categories carry their own items (3-level menus).
  items?: BackendMenuItem[];
}

export interface BackendMenuGroup {
  label: string;
  icon: string;
  path?: string;
  items?: BackendMenuItem[];
}

interface MenuState {
  menuGroups: MenuGroup[];
  isMenuLoaded: boolean;
  isMenuLoading: boolean;
  menuError: string | null;

  // Actions
  fetchPersonalizedMenu: (roleId?: string) => Promise<void>;
  clearMenu: () => void;
}

export const useMenuStore = create<MenuState>()((set, get) => ({
  menuGroups: [],
  isMenuLoaded: false,
  isMenuLoading: false,
  menuError: null,

  fetchPersonalizedMenu: async (roleId?: string) => {
    // Don't fetch if already loaded
    if (get().isMenuLoaded) return;

    set({ isMenuLoading: true, menuError: null });
    try {
      let menuGroups: MenuGroup[];
      if (roleId) {
        menuGroups = (await menuGroupRoleService.getAvailableMenuGroups(
          roleId,
        )) as MenuGroup[];
      } else {
        menuGroups = DASHBOARD_MENU as unknown as MenuGroup[];
      }

      set({
        menuGroups,
        isMenuLoaded: true,
        isMenuLoading: false,
        menuError: null,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch menu";
      set({
        isMenuLoaded: false,
        isMenuLoading: false,
        menuError: message,
        menuGroups: [],
      });
    }
  },

  clearMenu: () => {
    set({
      menuGroups: [],
      isMenuLoaded: false,
      isMenuLoading: false,
      menuError: null,
    });
  },
}));
