/** @jest-environment jsdom */
/**
 * A-216 — a user signed in through single sign-on is told where their
 * password lives, instead of being shown a form asking for one they never had.
 *
 *  - /auth/verify reports `passwordManagedBy` (backend auth.service
 *    #passwordManagedBy); the page then shows the identity provider and no
 *    password fields;
 *  - should a 409 still come back from the change (the state changed after the
 *    page loaded, or A-215's expired temporary password), its explanation is
 *    shown as a form-level message, not as "the current password is wrong".
 *
 * Fail-before: the form was always shown, and every submission failed with
 * "Current password is incorrect".
 *
 * Real: the page and the auth store. Mocked: the layout, the router, and the
 * user API client.
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/dashboard/change-password",
}));

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/services/user.service", () => ({
  userService: {
    verifyCurrentPassword: jest.fn(async () => ({ valid: true })),
    changePassword: jest.fn(),
  },
}));

import ChangePasswordPage from "../page";
import { userService } from "@/api/services/user.service";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const mocked = userService as unknown as { changePassword: jest.Mock };

const setUser = (patch: Partial<User>) =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: {
      id: "u1",
      username: "ada",
      firstName: "Ada",
      lastName: "L",
      email: "ada@hospital.example.com",
      ...patch,
    } as User,
  });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("A-216: a federated session's password", () => {
  it("shows the identity provider instead of the form", () => {
    setUser({ passwordManagedBy: { protocol: "oidc", provider: "login.microsoftonline.com" } });
    const { container } = render(<ChangePasswordPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /managed by your organisation's identity provider/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/OIDC, login\.microsoftonline\.com/);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Change Password/ })).toBeNull();
  });

  it("with no provider name, the protocol alone", () => {
    setUser({ passwordManagedBy: { protocol: "saml", provider: null } });
    render(<ChangePasswordPage />);

    expect(screen.getByRole("status")).toHaveTextContent("(SAML)");
  });

  it("a password session still gets the form", () => {
    setUser({ passwordManagedBy: null });
    const { container } = render(<ChangePasswordPage />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(3);
  });

  it("a 409 from the change is shown as the account's state, not as a wrong current password", async () => {
    setUser({});
    const conflict = Object.assign(
      new Error(
        "The temporary password an administrator set for you has expired. Ask an administrator to reset your password again.",
      ),
      { response: { status: 409 } },
    );
    mocked.changePassword.mockRejectedValueOnce(conflict);
    const { container } = render(<ChangePasswordPage />);
    const [current, next, confirm] = Array.from(
      container.querySelectorAll('input[type="password"]'),
    ) as HTMLInputElement[];

    fireEvent.change(current, { target: { value: "Temp-Pw-1" } });
    fireEvent.change(next, { target: { value: "New-Passw0rd!" } });
    fireEvent.change(confirm, { target: { value: "New-Passw0rd!" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Change Password/ }));
    });

    await waitFor(() =>
      expect(screen.getByText(/temporary password an administrator set for you has expired/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Current password is incorrect")).toBeNull();
    // A form-level message: the current-password field is not marked wrong.
    expect(current).not.toHaveAttribute("aria-invalid", "true");
  });
});
