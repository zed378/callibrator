/** @jest-environment jsdom */
/**
 * A-160 (and A-123, which had no test here) — the dashboard layout sends an
 * account that must act first to the one page that lets it:
 *  - must change an administrator-set password → the change-password page;
 *  - its tenant requires MFA and it has none → the MFA page;
 *  - both → the change-password page first (the backend's order).
 *
 * Fail-before (baseline 2a157f1): the MFA cases fail — the layout knew only
 * the password flag.
 *
 * Real: the layout and the auth store. Mocked: next/navigation, the menu
 * store's fetch, and the chrome (sidebar, top bar, banner).
 */
import React from "react";
import { render } from "@testing-library/react";

const mockReplace = jest.fn();
let mockPathname = "/dashboard";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => mockPathname,
}));
jest.mock("../Sidebar", () => () => null);
jest.mock("../TopBar", () => () => null);
jest.mock("../ImpersonationBanner", () => () => null);
jest.mock("@/stores/menuStore", () => ({
  useMenuStore: () => ({ menuGroups: [], isMenuLoaded: true, fetchPersonalizedMenu: jest.fn() }),
}));

import DashboardLayout from "../DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const signIn = (patch: Partial<User>) =>
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    user: { id: "u1", username: "ada", email: "ada@x.test", roleId: "r1", ...patch } as User,
  });

const renderAt = (path: string) => {
  mockPathname = path;
  return render(
    <DashboardLayout>
      <div>page</div>
    </DashboardLayout>,
  );
};

beforeEach(() => {
  mockReplace.mockClear();
});

describe("DashboardLayout: accounts that must act first", () => {
  it("an account its tenant requires to enrol MFA is sent to the MFA page", () => {
    signIn({ mfaEnrolmentRequired: true });

    renderAt("/dashboard/devices");

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/mfa");
  });

  it("not again once on the MFA page", () => {
    signIn({ mfaEnrolmentRequired: true });

    renderAt("/dashboard/mfa");

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("an account under both is sent to change the password first, and stays there", () => {
    signIn({ mustChangePassword: true, mfaEnrolmentRequired: true });

    renderAt("/dashboard/mfa");
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/change-password");

    mockReplace.mockClear();
    renderAt("/dashboard/change-password");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("an account that must only change the password is sent there (A-123)", () => {
    signIn({ mustChangePassword: true });

    renderAt("/dashboard");

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/change-password");
  });

  it("an ordinary account is left where it is", () => {
    signIn({ mfaEnrolmentRequired: false, mustChangePassword: false });

    renderAt("/dashboard/devices");

    expect(mockReplace).not.toHaveBeenCalled();
  });
});
