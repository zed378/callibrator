/** @jest-environment jsdom */
/**
 * A-160 — the MFA page tells a user their organisation requires MFA, and
 * enrolling lifts the requirement in the store (so the dashboard layout stops
 * sending them back here).
 *
 * Fail-before (baseline 2a157f1): there was no banner and the store kept no
 * such flag.
 *
 * Real: the page, the auth store, the toast store. Mocked: the layout and the
 * auth API client.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/services/auth.service", () => ({
  authService: {
    mfaSetup: jest.fn(),
    mfaVerify: jest.fn(),
    mfaDisable: jest.fn(),
  },
}));

import MfaPage from "../page";
import { authService } from "@/api/services/auth.service";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const mocked = authService as unknown as { mfaSetup: jest.Mock; mfaVerify: jest.Mock };

const setUser = (patch: Partial<User>) =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", username: "ada", email: "ada@hospital.example.com", ...patch } as User,
  });

beforeEach(() => jest.clearAllMocks());

describe("A-160: the MFA page under a tenant 'MFA required' policy", () => {
  it("says the organisation requires MFA", () => {
    setUser({ mfaEnabled: false, mfaEnrolmentRequired: true });

    render(<MfaPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(/organisation requires two-factor authentication/i);
  });

  it("says nothing when not required", () => {
    setUser({ mfaEnabled: false, mfaEnrolmentRequired: false });

    render(<MfaPage />);

    expect(screen.queryByText(/organisation requires/i)).toBeNull();
  });

  it("enrolling clears the requirement in the store", async () => {
    setUser({ mfaEnabled: false, mfaEnrolmentRequired: true });
    mocked.mfaSetup.mockResolvedValue({ secret: "SECRET", qrCodeUrl: "data:image/png;base64,x" });
    mocked.mfaVerify.mockResolvedValue({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD"] });
    render(<MfaPage />);

    fireEvent.click(screen.getByRole("button", { name: /Set Up Authenticator/i }));
    fireEvent.change(await screen.findByLabelText(/Enter the 6-digit code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Enable/i }));

    await waitFor(() => expect(useAuthStore.getState().user?.mfaEnabled).toBe(true));
    expect(useAuthStore.getState().user?.mfaEnrolmentRequired).toBe(false);
    expect(screen.queryByText(/organisation requires/i)).toBeNull();
  });
});
