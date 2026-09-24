/**
 * F-07 / F-15 / F-12 — the dashboard chrome: a refused action opens the
 * access-denied modal and re-resolves the menu; a menu that cannot load is a
 * visible error with a retry; keyboard users can skip the navigation.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush }),
  usePathname: () => "/dashboard",
}));
jest.mock("../Sidebar", () => () => null);
jest.mock("../TopBar", () => () => null);
jest.mock("../ImpersonationBanner", () => () => null);
const mockPersonalized = jest.fn();
jest.mock("@/api/services/menuGroupRole.service", () => ({
  menuGroupRoleService: { getPersonalizedMenu: (...a: unknown[]) => mockPersonalized(...a) },
}));

import DashboardLayout from "../DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore, MENU_ROLE_MISSING } from "@/stores/menuStore";
import { useAccessDeniedStore } from "@/stores/accessDeniedStore";
import type { User } from "@/types";

const signIn = (patch: Partial<User> = {}) =>
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    user: { id: "u1", username: "ada", email: "a@x.test", roleId: "r1", ...patch } as User,
  });

const renderLayout = async () => {
  render(
    <DashboardLayout>
      <p>page body</p>
    </DashboardLayout>,
  );
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  useMenuStore.getState().clearMenu();
  useAccessDeniedStore.setState({ isOpen: false, message: null, refusals: 0 });
  mockPersonalized.mockResolvedValue([]);
});

describe("DashboardLayout", () => {
  it("F-15: a user with no role sees an error and no menu is requested", async () => {
    signIn({ roleId: undefined });
    await renderLayout();
    expect(screen.getByRole("alert")).toHaveTextContent(MENU_ROLE_MISSING);
    expect(mockPersonalized).not.toHaveBeenCalled();
  });

  it("F-15: a failed menu load shows the error; Retry loads it again", async () => {
    signIn();
    mockPersonalized.mockRejectedValueOnce(new Error("Menu service down"));
    await renderLayout();
    expect(screen.getByRole("alert")).toHaveTextContent("Menu service down");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(mockPersonalized).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Menu service down")).toBeNull();
  });

  it("F-07: a refused action opens AccessDeniedModal and re-resolves the menu", async () => {
    signIn();
    await renderLayout();
    expect(mockPersonalized).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAccessDeniedStore.getState().show("You may not delete devices");
    });

    expect(screen.getByRole("alertdialog")).toHaveTextContent("You may not delete devices");
    expect(mockPersonalized).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /Go to Profile/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/profile");
    expect(useAccessDeniedStore.getState().isOpen).toBe(false);
  });

  it("F-12: a skip link targets the main content", async () => {
    signIn();
    await renderLayout();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
