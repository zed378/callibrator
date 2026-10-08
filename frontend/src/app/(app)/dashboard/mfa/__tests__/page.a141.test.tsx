/** @jest-environment jsdom */
/**
 * A-141 — the MFA page shows the recovery codes once, and can turn MFA off.
 *
 * Fail-before: the page discarded the verify response (no codes were ever
 * shown), had no way to turn MFA off, and read `mfaEnabled` from a /verify
 * response that did not carry it.
 *
 * Real: the page, the auth store, the toast store. Mocked: the layout and the
 * auth API client (its calls are what is observed).
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

const mocked = authService as unknown as {
  mfaSetup: jest.Mock;
  mfaVerify: jest.Mock;
  mfaDisable: jest.Mock;
};

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DDD${"ABCDEFGHIJ"[i]}`);

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

describe("A-141: recovery codes are shown once", () => {
  it("after enrolment the ten codes are shown; Done needs the 'saved' confirmation; then they are gone", async () => {
    setUser({ mfaEnabled: false });
    mocked.mfaSetup.mockResolvedValue({ secret: "SECRET", qrCodeUrl: "data:image/png;base64,x" });
    mocked.mfaVerify.mockResolvedValue({ recoveryCodes: CODES });
    render(<MfaPage />);

    fireEvent.click(screen.getByRole("button", { name: /Set Up Authenticator/i }));
    const codeInput = await screen.findByLabelText(/Enter the 6-digit code/i);
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify & Enable/i }));

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect(list.querySelectorAll("li")).toHaveLength(10);
    expect(screen.getByText(CODES[0])).toBeInTheDocument();
    expect(useAuthStore.getState().user?.mfaEnabled).toBe(true);
    expect(useAuthStore.getState().user?.mfaRecoveryCodesRemaining).toBe(10);

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I have saved these recovery codes/i));
    expect(done).not.toBeDisabled();
    fireEvent.click(done);

    expect(screen.queryByText(CODES[0])).toBeNull();
  });
});

describe("A-141: turning MFA off", () => {
  it("needs the password and a 6-digit code, calls disable, and updates the user", async () => {
    setUser({ mfaEnabled: true, mfaRecoveryCodesRemaining: 8 });
    mocked.mfaDisable.mockResolvedValue(undefined);
    render(<MfaPage />);

    expect(screen.getByText("8 recovery codes left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Turn Off MFA/i }));

    const form = screen.getByRole("form", { name: /Turn off two-factor authentication/i });
    const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Current password", { selector: "#mfa-disable-password" }), {
      target: { value: "pw" },
    });
    fireEvent.change(screen.getByLabelText("Current 6-digit code", { selector: "#mfa-disable-code" }), {
      target: { value: "654321" },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mocked.mfaDisable).toHaveBeenCalledWith({ currentPassword: "pw", code: "654321" }),
    );
    await waitFor(() => expect(useAuthStore.getState().user?.mfaEnabled).toBe(false));
  });

  it("the lost-authenticator path sends a recovery code instead", async () => {
    setUser({ mfaEnabled: true, mfaRecoveryCodesRemaining: 5 });
    mocked.mfaDisable.mockResolvedValue(undefined);
    render(<MfaPage />);

    fireEvent.click(screen.getByRole("button", { name: /Turn Off MFA/i }));
    fireEvent.click(screen.getByText(/Lost your authenticator\? Use a recovery code/i));
    fireEvent.change(screen.getByLabelText("Current password", { selector: "#mfa-disable-password" }), {
      target: { value: "pw" },
    });
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "aaaa-bbbb-cccc-dddd" },
    });
    const form = screen.getByRole("form", { name: /Turn off two-factor authentication/i });
    fireEvent.click(form.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() =>
      expect(mocked.mfaDisable).toHaveBeenCalledWith({
        currentPassword: "pw",
        recoveryCode: "AAAA-BBBB-CCCC-DDDD",
      }),
    );
  });

  it("warns when the recovery codes are running out", () => {
    setUser({ mfaEnabled: true, mfaRecoveryCodesRemaining: 1 });
    render(<MfaPage />);

    expect(screen.getByText("1 recovery code left")).toBeInTheDocument();
    expect(screen.getByText(/running out of recovery codes/i)).toBeInTheDocument();
  });

  it("an account without MFA is not offered 'Turn Off'", () => {
    setUser({ mfaEnabled: false });
    render(<MfaPage />);

    expect(screen.queryByRole("button", { name: /Turn Off MFA/i })).toBeNull();
  });
});
