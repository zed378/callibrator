/** @jest-environment jsdom */
/**
 * A-123 / A-141 — where sign-in lands, and how the MFA step sends a recovery
 * code.
 *
 *  - an account whose password an administrator set goes straight to the
 *    change-password screen after signing in (password or MFA step), not to
 *    the callback URL (A-123);
 *  - with "use a recovery code" on, the MFA step hands completeMfaLogin the
 *    code as a recovery code (A-141).
 *
 * Fail-before: sign-in always pushed the callback URL, and completeMfaLogin
 * was called with no recovery flag.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams("callbackUrl=/dashboard/devices"),
}));

jest.mock("@/api/services/auth.service", () => ({ authService: {} }));

import { useLoginForm } from "./useLoginForm";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const submitEvent = { preventDefault: () => undefined } as unknown as React.FormEvent;

const signedInAs = (patch: Partial<User>) => () => {
  useAuthStore.setState({ user: { id: "u1", ...patch } as User, isAuthenticated: true });
  return Promise.resolve({ mfaRequired: false });
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe("A-123: sign-in destination", () => {
  it("a flagged account lands on the change-password screen", async () => {
    useAuthStore.setState({ login: jest.fn(signedInAs({ mustChangePassword: true })) });
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/change-password");
  });

  it("an ordinary account lands on the callback URL", async () => {
    useAuthStore.setState({ login: jest.fn(signedInAs({ mustChangePassword: false })) });
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/devices");
  });
});

describe("A-141: the MFA step with a recovery code", () => {
  it("passes the code as a recovery code, and a flagged account still lands on change-password", async () => {
    const completeMfaLogin = jest.fn(async () => {
      useAuthStore.setState({ user: { id: "u1", mustChangePassword: true } as User });
    });
    useAuthStore.setState({
      login: jest.fn(async () => ({ mfaRequired: true, mfaToken: "tmp" })),
      completeMfaLogin,
    });
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });
    act(() => {
      result.current.setUseRecoveryCode(true);
    });
    act(() => {
      result.current.setMfaCode("AAAA-BBBB-CCCC-DDDD");
    });
    await act(async () => {
      await result.current.handleMfaSubmit(submitEvent);
    });

    expect(completeMfaLogin).toHaveBeenCalledWith("tmp", "AAAA-BBBB-CCCC-DDDD", true);
    expect(mockPush).toHaveBeenCalledWith("/dashboard/change-password");
  });

  it("toggling clears what was typed, and going back resets the toggle", async () => {
    useAuthStore.setState({
      login: jest.fn(async () => ({ mfaRequired: true, mfaToken: "tmp" })),
    });
    const { result } = renderHook(() => useLoginForm());
    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    act(() => {
      result.current.setMfaCode("123");
    });
    act(() => {
      result.current.setUseRecoveryCode(true);
    });
    expect(result.current.mfaCode).toBe("");
    expect(result.current.useRecoveryCode).toBe(true);

    act(() => {
      result.current.cancelMfa();
    });
    expect(result.current.useRecoveryCode).toBe(false);
    expect(result.current.mfaRequired).toBe(false);
  });
});
