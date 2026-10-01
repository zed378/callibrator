import { create } from "zustand";
import type { MenuGroup } from "@/types";
import {
  menuGroupRoleService,
  type EffectivePermissions,
} from "@/api/services/menuGroupRole.service";

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
  /**
   * ADR-102 — the caller's effective permissions (GET /menu-groups/my-permissions),
   * loaded with the menu and cleared with it. Pages decide their write actions
   * from these through `usePermissions` — never from role names. Null until
   * loaded, or when the request failed (then no write action is offered).
   */
  effectivePermissions: EffectivePermissions | null;
  isMenuLoaded: boolean;
  isMenuLoading: boolean;
  menuError: string | null;
  /**
   * F-10: the backend refused `GET /search` this session (403). The search box
   * is then removed rather than showing an error on every keystroke. Reset
   * with the menu (clearMenu), i.e. on sign-out.
   */
  searchRefused: boolean;

  // Actions
  refuseSearch: () => void;
  fetchPersonalizedMenu: (roleId?: string) => Promise<void>;
  clearMenu: () => void;
}

/** F-15: shown when the signed-in user has no resolvable role. */
export const MENU_ROLE_MISSING =
  "Your role could not be resolved, so your menu could not be loaded.";

export const useMenuStore = create<MenuState>()((set, get) => ({
  menuGroups: [],
  effectivePermissions: null,
  isMenuLoaded: false,
  isMenuLoading: false,
  menuError: null,
  searchRefused: false,

  refuseSearch: () => set({ searchRefused: true }),

  fetchPersonalizedMenu: async (roleId?: string) => {
    // Don't fetch if already loaded — or already loading: a retry and the
    // layout's mount effect must not both fetch.
    if (get().isMenuLoaded || get().isMenuLoading) return;

    // F-15: no role, no menu. The failure mode of a permission-derived menu is
    // LESS menu — never the full static tree, which is what this used to fall
    // back to. The layout shows the error with a retry.
    if (!roleId) {
      set({
        menuGroups: [],
        isMenuLoaded: false,
        isMenuLoading: false,
        menuError: MENU_ROLE_MISSING,
      });
      return;
    }

    set({ isMenuLoading: true, menuError: null });
    try {
      // F-63: the PERSONALISED tree (POST /menu-groups/get-assignments) —
      // only the groups assigned to the role. This used to read
      // GET /menu-groups/menu-groups, which returns EVERY active group with an
      // `isAssigned` flag that nothing in the sidebar read, so every role was
      // shown the whole navigation.
      const [menuGroups, effectivePermissions] = await Promise.all([
        menuGroupRoleService.getPersonalizedMenu(roleId) as Promise<MenuGroup[]>,
        // ADR-102: a failure here must not cost the user the menu — it costs
        // the write actions only (null = none offered).
        Promise.resolve()
          .then(() => menuGroupRoleService.getMyPermissions())
          .catch((): EffectivePermissions | null => null),
      ]);

      set({
        menuGroups,
        effectivePermissions,
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
      effectivePermissions: null,
      isMenuLoaded: false,
      isMenuLoading: false,
      menuError: null,
      searchRefused: false,
    });
  },
}));
