/** @jest-environment jsdom */
/**
 * P10-16 (ADR-099) — a one-time password's first sign-in.
 *
 *  - the sign-in answers `passwordChangeRequired` with a password-change token:
 *    the hook shows the first-password step, holds the token, forgets the
 *    typed one-time password, and navigates nowhere;
 *  - the step posts the token and the new password, then signs in with the
 *    new password and lands where sign-in lands (MFA enrolment for an
 *    operator without MFA);
 *  - a refused token (401) says the step expired, never anything about the
 *    account; a 400 shows the server's own validation message.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams("callbackUrl=/dashboard"),
}));

const mockCompleteFirstSignIn = jest.fn();
jest.mock("@/api/services/auth.service", () => ({
  authService: { completeFirstSignIn: (...args: unknown[]) => mockCompleteFirstSignIn(...args) },
}));

import { AxiosError, AxiosHeaders } from "axios";
import { useLoginForm } from "./useLoginForm";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const submitEvent = { preventDefault: () => undefined } as unknown as React.FormEvent;

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { message },
  });

const firstSignIn = jest.fn(async () => ({
  mfaRequired: false,
  passwordChangeRequired: true,
  passwordChangeToken: "pc-token",
}));

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

const reachFirstStep = async () => {
  useAuthStore.setState({ login: firstSignIn });
  const { result } = renderHook(() => useLoginForm());
  act(() => {
    result.current.setUsername("sys@mail.com");
    result.current.setPassword("One-Time-Value-xyz");
  });
  await act(async () => {
    await result.current.handleSubmit(submitEvent);
  });
  return result;
};

describe("P10-16: the first sign-in with a one-time password", () => {
  it("shows the first-password step, forgets the typed password, and navigates nowhere", async () => {
    const result = await reachFirstStep();
    expect(result.current.firstPasswordChangeRequired).toBe(true);
    expect(result.current.mfaRequired).toBe(false);
    expect(result.current.password).toBe("");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("saves the new password with the token, then signs in with it and lands on MFA enrolment", async () => {
    const result = await reachFirstStep();
    const secondLogin = jest.fn(async () => {
      useAuthStore.setState({ user: { id: "u1", mfaEnrolmentRequired: true } as User, isAuthenticated: true });
      return { mfaRequired: false };
    });
    useAuthStore.setState({ login: secondLogin });
    mockCompleteFirstSignIn.mockResolvedValue(undefined);
    act(() => {
      result.current.setNewPassword("Chosen-Pass-42");
      result.current.setConfirmPassword("Chosen-Pass-42");
    });
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });

    expect(mockCompleteFirstSignIn).toHaveBeenCalledWith("pc-token", "Chosen-Pass-42");
    expect(secondLogin).toHaveBeenCalledWith("sys@mail.com", "Chosen-Pass-42");
    expect(mockPush).toHaveBeenCalledWith("/dashboard/mfa");
    expect(result.current.firstPasswordChangeRequired).toBe(false);
    expect(result.current.newPassword).toBe("");
  });

  it("goes to the MFA code step when the new sign-in asks for one", async () => {
    const result = await reachFirstStep();
    // In act(), so the hook re-renders with the new `login` before the submit.
    act(() => {
      useAuthStore.setState({ login: jest.fn(async () => ({ mfaRequired: true, mfaToken: "mfa-t" })) });
    });
    mockCompleteFirstSignIn.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });
    expect(result.current.mfaRequired).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("a refused token says the step expired — nothing about the account", async () => {
    const result = await reachFirstStep();
    mockCompleteFirstSignIn.mockRejectedValue(httpError(401, "Invalid or expired password-change token"));
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });
    expect(result.current.firstChangeError).toMatch(/expired/);
    expect(result.current.firstChangeError).not.toMatch(/sys@mail\.com/);
    expect(result.current.firstPasswordChangeRequired).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("a validation refusal shows the server's message", async () => {
    const result = await reachFirstStep();
    mockCompleteFirstSignIn.mockRejectedValue(
      httpError(400, "The new password must be different from the one-time password"),
    );
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });
    expect(result.current.firstChangeError).toBe("The new password must be different from the one-time password");
  });

  it("any other failure is a neutral retry message", async () => {
    const result = await reachFirstStep();
    mockCompleteFirstSignIn.mockRejectedValue(new Error("network"));
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });
    expect(result.current.firstChangeError).toBe("Your password could not be saved. Please try again.");
  });

  it("back to sign in drops the token and the typed passwords", async () => {
    const result = await reachFirstStep();
    act(() => {
      result.current.setNewPassword("abc");
      result.current.cancelFirstPasswordChange();
    });
    expect(result.current.firstPasswordChangeRequired).toBe(false);
    expect(result.current.newPassword).toBe("");
    // With no token held, submitting does nothing.
    await act(async () => {
      await result.current.handleFirstPasswordChange(submitEvent);
    });
    expect(mockCompleteFirstSignIn).not.toHaveBeenCalled();
  });
});
