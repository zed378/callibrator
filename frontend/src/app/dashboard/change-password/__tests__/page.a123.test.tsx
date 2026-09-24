/** @jest-environment jsdom */
/**
 * A-123 (ADR-051 Q-11) — the change-password screen for an account whose
 * password an administrator set.
 *
 *  - it says why the user is there;
 *  - the live "is my current password right?" check is refused by the
 *    backend for such an account (403) — that says nothing about the
 *    password, so the page shows no verdict instead of a false "Incorrect";
 *  - after the change every session is revoked (this one too), so the user is
 *    signed out and sent to sign in with the new password.
 *
 * Fail-before: no banner; the 403 showed "Incorrect password"; after the
 * change the page stayed on a revoked session.
 *
 * Real: the page and the auth store. Mocked: the layout, the router, and the
 * user API client (its calls are observed).
 */
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, prefetch: jest.fn() }),
  usePathname: () => "/dashboard/change-password",
}));

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/services/user.service", () => ({
  userService: {
    verifyCurrentPassword: jest.fn(),
    changePassword: jest.fn(),
  },
}));

import ChangePasswordPage from "../page";
import { userService } from "@/api/services/user.service";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const mocked = userService as unknown as {
  verifyCurrentPassword: jest.Mock;
  changePassword: jest.Mock;
};

const logout = jest.fn(async () => undefined);

const setUser = (patch: Partial<User>) =>
  useAuthStore.setState({
    isAuthenticated: true,
    logout,
    user: {
      id: "u1",
      username: "ada",
      firstName: "Ada",
      lastName: "L",
      email: "ada@hospital.example.com",
      ...patch,
    } as User,
  });

const passwordInputs = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[];

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("A-123: forced password change screen", () => {
  it("explains why the user is here", () => {
    setUser({ mustChangePassword: true });
    render(<ChangePasswordPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/An administrator set your password/);
  });

  it("an unflagged user sees no such banner", () => {
    setUser({ mustChangePassword: false });
    render(<ChangePasswordPage />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a 403 from the live password check is no verdict, not 'Incorrect password'", async () => {
    jest.useFakeTimers();
    setUser({ mustChangePassword: true });
    mocked.verifyCurrentPassword.mockRejectedValue({ response: { status: 403 } });
    const { container } = render(<ChangePasswordPage />);

    fireEvent.change(passwordInputs(container)[0], { target: { value: "Adm1n-Chosen!" } });
    await act(async () => {
      jest.advanceTimersByTime(700);
    });

    expect(mocked.verifyCurrentPassword).toHaveBeenCalled();
    expect(screen.queryByText("Incorrect password")).toBeNull();
  });

  it("another failure of the live check still reads as incorrect", async () => {
    jest.useFakeTimers();
    setUser({ mustChangePassword: false });
    mocked.verifyCurrentPassword.mockRejectedValue(new Error("Invalid password"));
    const { container } = render(<ChangePasswordPage />);

    fireEvent.change(passwordInputs(container)[0], { target: { value: "guess" } });
    await act(async () => {
      jest.advanceTimersByTime(700);
    });

    expect(screen.getByText("Incorrect password")).toBeInTheDocument();
  });

  it("after the forced change the user is signed out and sent to sign in again", async () => {
    setUser({ mustChangePassword: true });
    mocked.verifyCurrentPassword.mockRejectedValue({ response: { status: 403 } });
    mocked.changePassword.mockResolvedValue({ success: true });
    const { container } = render(<ChangePasswordPage />);

    const [current, next, confirm] = passwordInputs(container);
    fireEvent.change(current, { target: { value: "Adm1n-Chosen!" } });
    fireEvent.change(next, { target: { value: "My-0wn-Passw0rd" } });
    fireEvent.change(confirm, { target: { value: "My-0wn-Passw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: /Change Password/i }));

    await waitFor(() =>
      expect(mocked.changePassword).toHaveBeenCalledWith({
        currentPassword: "Adm1n-Chosen!",
        newPassword: "My-0wn-Passw0rd",
      }),
    );
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("an ordinary change keeps the existing behaviour (no forced sign-out here)", async () => {
    setUser({ mustChangePassword: false });
    mocked.verifyCurrentPassword.mockResolvedValue({ valid: true });
    mocked.changePassword.mockResolvedValue({ success: true });
    const { container } = render(<ChangePasswordPage />);

    const [current, next, confirm] = passwordInputs(container);
    fireEvent.change(current, { target: { value: "Old-Passw0rd!" } });
    fireEvent.change(next, { target: { value: "My-0wn-Passw0rd" } });
    fireEvent.change(confirm, { target: { value: "My-0wn-Passw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: /Change Password/i }));

    await waitFor(() => expect(mocked.changePassword).toHaveBeenCalled());
    expect(logout).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
