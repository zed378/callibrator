/** @jest-environment jsdom */
/**
 * A-262 — "Remove passkey" on the users page: an administrator removes
 * another user's passkey (DELETE /users/:id/webauthn). Offered only for a user
 * with a passkey; asks first; says what happens; refreshes the list.
 *
 * Fail-before: the action and userService.resetPasskey did not exist — an
 * administrator had no screen, and the backend had no route, for it.
 *
 * Real: the component, the UI kit, the toast store. Mocked: the user API
 * client (its calls are what is observed). The route's own behaviour is
 * asserted in backend/src/tests/routes/user.passkeyReset.a262.test.js.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/api/services/user.service", () => ({
  userService: { resetMfa: jest.fn(), resetPassword: jest.fn(), resetPasskey: jest.fn() },
}));

import { CredentialResetActions } from "../CredentialResetActions";
import { userService } from "@/api/services/user.service";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const mocked = userService as unknown as {
  resetMfa: jest.Mock;
  resetPassword: jest.Mock;
  resetPasskey: jest.Mock;
};

const target = (patch: Partial<User> = {}) =>
  ({ id: "u-2", username: "grace", email: "grace@hospital.example.com", ...patch }) as User;

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("A-262: Remove passkey", () => {
  it("is offered only for a user with a passkey", () => {
    const { rerender } = render(<CredentialResetActions user={target({ webauthnEnabled: false })} />);
    expect(screen.queryByRole("button", { name: /Remove passkey for grace/i })).toBeNull();

    rerender(<CredentialResetActions user={target({ webauthnEnabled: true })} />);
    expect(screen.getByRole("button", { name: /Remove passkey for grace/i })).toBeInTheDocument();
  });

  it("asks first, then removes it, reports the signed-out sessions, and refreshes the list", async () => {
    mocked.resetPasskey.mockResolvedValue({ id: "u-2", webauthnEnabled: false, sessionsRevoked: 2 });
    const onReset = jest.fn();
    render(<CredentialResetActions user={target({ webauthnEnabled: true })} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: /Remove passkey for grace/i }));
    expect(screen.getByText(/Remove the passkey of grace\?/)).toBeInTheDocument();
    expect(screen.getByText(/Their password and MFA are not changed/)).toBeInTheDocument();
    expect(mocked.resetPasskey).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove passkey" }));

    await waitFor(() => expect(mocked.resetPasskey).toHaveBeenCalledWith("u-2"));
    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(mocked.resetMfa).not.toHaveBeenCalled();
    expect(mocked.resetPassword).not.toHaveBeenCalled();
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Passkey removed for grace" });
    expect(toasts()[0].description).toMatch(/2 session\(s\) signed out/);
  });

  it("a refusal from the backend is shown as an error", async () => {
    mocked.resetPasskey.mockRejectedValue(new Error("This user has no passkey to remove"));
    render(<CredentialResetActions user={target({ webauthnEnabled: true })} />);

    fireEvent.click(screen.getByRole("button", { name: /Remove passkey for grace/i }));
    fireEvent.click(screen.getByRole("button", { name: "Remove passkey" }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({
        type: "error",
        title: "Could not remove the passkey",
        description: "This user has no passkey to remove",
      }),
    );
  });
});
