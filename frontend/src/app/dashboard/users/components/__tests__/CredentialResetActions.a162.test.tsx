/** @jest-environment jsdom */
/**
 * A-162 — the users page's credential resets for one row: "Reset MFA" (only
 * for a user with MFA) and "Reset password" (a temporary password shown once).
 *
 * Fail-before (baseline 2a157f1): the component and the two service calls did
 * not exist — there was no screen for either reset.
 *
 * Real: the component, the UI kit, the toast store. Mocked: the user API
 * client (its calls are what is observed).
 */
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("@/api/services/user.service", () => ({
  userService: { resetMfa: jest.fn(), resetPassword: jest.fn() },
}));

import { CredentialResetActions } from "../CredentialResetActions";
import { userService } from "@/api/services/user.service";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const mocked = userService as unknown as { resetMfa: jest.Mock; resetPassword: jest.Mock };

const target = (patch: Partial<User> = {}) =>
  ({ id: "u-2", username: "grace", email: "grace@hospital.example.com", ...patch }) as User;

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("A-162: Reset MFA", () => {
  it("is offered only for a user with MFA", () => {
    const { rerender } = render(<CredentialResetActions user={target({ mfaEnabled: false })} />);
    expect(screen.queryByRole("button", { name: /Reset MFA for grace/i })).toBeNull();

    rerender(<CredentialResetActions user={target({ mfaEnabled: true })} />);
    expect(screen.getByRole("button", { name: /Reset MFA for grace/i })).toBeInTheDocument();
  });

  it("asks first, then resets, reports the signed-out sessions, and refreshes the list", async () => {
    mocked.resetMfa.mockResolvedValue({ id: "u-2", mfaEnabled: false, sessionsRevoked: 3 });
    const onReset = jest.fn();
    render(<CredentialResetActions user={target({ mfaEnabled: true })} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset MFA for grace/i }));
    expect(screen.getByText(/Reset MFA for grace\?/)).toBeInTheDocument();
    expect(mocked.resetMfa).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset MFA" }));

    await waitFor(() => expect(mocked.resetMfa).toHaveBeenCalledWith("u-2"));
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(toasts()[0]).toMatchObject({ type: "success", title: "MFA reset for grace" });
    expect(toasts()[0].description).toMatch(/3 session\(s\) signed out/);
  });

  it("cancel does nothing", () => {
    render(<CredentialResetActions user={target({ mfaEnabled: true })} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset MFA for grace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mocked.resetMfa).not.toHaveBeenCalled();
    expect(screen.queryByText(/Reset MFA for grace\?/)).toBeNull();
  });

  it("a refusal from the backend is shown as an error", async () => {
    mocked.resetMfa.mockRejectedValue(new Error("MFA is not enabled for this user"));
    render(<CredentialResetActions user={target({ mfaEnabled: true })} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset MFA for grace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reset MFA" }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({
        type: "error",
        title: "Could not reset MFA",
        description: "MFA is not enabled for this user",
      }),
    );
  });
});

describe("A-162: Reset password", () => {
  it("asks first, then shows the temporary password once; closing forgets it", async () => {
    mocked.resetPassword.mockResolvedValue({
      id: "u-2",
      temporaryPassword: "Abcd3fghJkmn7pqr",
      mustChangePassword: true,
      sessionsRevoked: 1,
    });
    const onReset = jest.fn();
    render(<CredentialResetActions user={target()} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset password for grace/i }));
    expect(screen.getByText(/Reset the password of grace\?/)).toBeInTheDocument();
    expect(screen.getByText(/they must change it when they sign in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    const shown = await screen.findByTestId("temporary-password");
    expect(shown).toHaveTextContent("Abcd3fghJkmn7pqr");
    expect(mocked.resetPassword).toHaveBeenCalledWith("u-2");
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/It is shown only now/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("temporary-password")).toBeNull();
    expect(screen.queryByText("Abcd3fghJkmn7pqr")).toBeNull();
  });

  it("copies the temporary password", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mocked.resetPassword.mockResolvedValue({
      id: "u-2",
      temporaryPassword: "Abcd3fghJkmn7pqr",
      mustChangePassword: true,
      sessionsRevoked: 0,
    });
    render(<CredentialResetActions user={target()} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset password for grace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
    const dialog = (await screen.findByTestId("temporary-password")).parentElement as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: /Copy temporary password/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Abcd3fghJkmn7pqr"));
  });

  it("a refusal from the backend is shown as an error, and no password dialog opens", async () => {
    mocked.resetPassword.mockRejectedValue(
      new Error("Forbidden: you cannot reset the password of a user whose role is above yours"),
    );
    render(<CredentialResetActions user={target()} />);

    fireEvent.click(screen.getByRole("button", { name: /Reset password for grace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "Could not reset the password" }),
    );
    expect(screen.queryByTestId("temporary-password")).toBeNull();
  });
});
