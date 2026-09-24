/**
 * F-15 / F-63 / F-10 — the menu is the SERVER's, for the caller's role, or
 * nothing.
 *
 * F-15 fail-before: with no roleId the store loaded the static DASHBOARD_MENU
 * (Tenants, Roles, Users, Session Management...) for anyone.
 * F-63 fail-before: with a roleId it read GET /menu-groups/menu-groups, which
 * returns every active group — the personalised tree is
 * POST /menu-groups/get-assignments.
 */
const mockGetPersonalized = jest.fn();
const mockGetAvailable = jest.fn();
jest.mock("@/api/services/menuGroupRole.service", () => ({
  menuGroupRoleService: {
    getPersonalizedMenu: (...a: unknown[]) => mockGetPersonalized(...a),
    getAvailableMenuGroups: (...a: unknown[]) => mockGetAvailable(...a),
  },
}));

import { MENU_ROLE_MISSING, useMenuStore } from "../menuStore";

const tree = [
  { id: "g1", label: "Devices", icon: "cpu", path: "/dashboard/devices" },
];

beforeEach(() => {
  jest.clearAllMocks();
  useMenuStore.getState().clearMenu();
});

describe("menuStore", () => {
  it("F-15: no roleId → no menu and a visible error, never a static tree", async () => {
    await useMenuStore.getState().fetchPersonalizedMenu();

    const s = useMenuStore.getState();
    expect(s.menuGroups).toEqual([]);
    expect(s.menuError).toBe(MENU_ROLE_MISSING);
    expect(s.isMenuLoaded).toBe(false);
    expect(mockGetPersonalized).not.toHaveBeenCalled();
    expect(mockGetAvailable).not.toHaveBeenCalled();
  });

  it("F-63: a roleId loads the PERSONALISED tree (get-assignments), not every group", async () => {
    mockGetPersonalized.mockResolvedValue(tree);

    await useMenuStore.getState().fetchPersonalizedMenu("r1");

    expect(mockGetPersonalized).toHaveBeenCalledWith("r1");
    expect(mockGetAvailable).not.toHaveBeenCalled();
    expect(useMenuStore.getState()).toMatchObject({
      menuGroups: tree,
      isMenuLoaded: true,
      menuError: null,
    });
  });

  it("does not refetch once loaded", async () => {
    mockGetPersonalized.mockResolvedValue(tree);
    await useMenuStore.getState().fetchPersonalizedMenu("r1");
    await useMenuStore.getState().fetchPersonalizedMenu("r1");
    expect(mockGetPersonalized).toHaveBeenCalledTimes(1);
  });

  it("F-15: a failed fetch is visible — the message is kept and the menu is empty", async () => {
    mockGetPersonalized.mockRejectedValue(new Error("Menu service down"));

    await useMenuStore.getState().fetchPersonalizedMenu("r1");

    expect(useMenuStore.getState()).toMatchObject({
      menuGroups: [],
      menuError: "Menu service down",
      isMenuLoaded: false,
    });

    mockGetPersonalized.mockRejectedValue("not an error");
    await useMenuStore.getState().fetchPersonalizedMenu("r1");
    expect(useMenuStore.getState().menuError).toBe("Failed to fetch menu");
  });

  it("F-10: a refused search is remembered until the menu is cleared (sign-out)", () => {
    useMenuStore.getState().refuseSearch();
    expect(useMenuStore.getState().searchRefused).toBe(true);
    useMenuStore.getState().clearMenu();
    expect(useMenuStore.getState().searchRefused).toBe(false);
  });
});
