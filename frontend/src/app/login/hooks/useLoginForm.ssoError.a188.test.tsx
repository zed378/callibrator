/** @jest-environment jsdom */
/**
 * A-188 / P6-07 — the login page after an SSO refusal, and after an
 * operator's password sign-in.
 *
 *  - A refused SSO callback now redirects to `/login?error=<code>` (it used
 *    to render the backend's JSON error as a page). The form opens the SSO tab
 *    and shows a fixed message for the code — never the query text itself.
 *  - A platform operator without MFA (P6-07) has an enrolment-only session:
 *    sign-in goes straight to the MFA page.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";

const mockPush = jest.fn();
let mockQuery = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

jest.mock("@/api/services/auth.service", () => ({ authService: {} }));

import { useLoginForm, SSO_ERROR_MESSAGES, ssoErrorMessage } from "./useLoginForm";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const submitEvent = { preventDefault: () => undefined } as unknown as React.FormEvent;

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = "";
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe("A-188: /login?error=<code> after a refused SSO callback", () => {
  it.each(Object.keys(SSO_ERROR_MESSAGES))("%s opens the SSO tab with its message", (code) => {
    mockQuery = `error=${code}`;

    const { result } = renderHook(() => useLoginForm());

    expect(result.current.loginMethod).toBe("sso");
    expect(result.current.ssoError).toBe(SSO_ERROR_MESSAGES[code]);
  });

  it("an unknown code shows the generic SSO failure — the query text is never rendered", () => {
    mockQuery = `error=${encodeURIComponent("<img src=x onerror=alert(1)>")}`;

    const { result } = renderHook(() => useLoginForm());

    expect(result.current.ssoError).toBe(SSO_ERROR_MESSAGES.sso_failed);
    expect(result.current.ssoError).not.toContain("<img");
  });

  it("with no error the password tab opens and no message shows", () => {
    const { result } = renderHook(() => useLoginForm());

    expect(result.current.loginMethod).toBe("password");
    expect(result.current.ssoError).toBeNull();
    expect(ssoErrorMessage(null)).toBeNull();
  });
});

describe("P6-07: an operator who must enrol MFA goes to the MFA page", () => {
  const signedInAs = (patch: Partial<User>) => () => {
    useAuthStore.setState({ user: { id: "u1", ...patch } as User, isAuthenticated: true });
    return Promise.resolve({ mfaRequired: false });
  };

  it("mfaEnrolmentRequired → /dashboard/mfa", async () => {
    useAuthStore.setState({ login: jest.fn(signedInAs({ mfaEnrolmentRequired: true })) });
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/mfa");
  });

  it("a forced password change still comes first", async () => {
    useAuthStore.setState({
      login: jest.fn(signedInAs({ mustChangePassword: true, mfaEnrolmentRequired: true })),
    });
    const { result } = renderHook(() => useLoginForm());

    await act(async () => {
      await result.current.handleSubmit(submitEvent);
    });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/change-password");
  });
});
