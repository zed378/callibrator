/** @jest-environment jsdom */
/**
 * The SSO callback page (A-60). The backend redirects here with a one-time
 * `code`; the page posts it to the Next route POST /api/v1/auth/sso-session
 * (which sets the httpOnly cookies), then reads the user from
 * POST /api/v1/auth/verify (`data` is the user — auth.controller verify).
 *
 * Real: the page, the auth store and the auth service. Mocked: `fetch` (the
 * Next route), `@/api/client`'s transport, next/navigation.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => mockParams,
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import SsoCallbackPage from "../page";
import { useAuthStore } from "@/stores/authStore";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedPost = api.post as jest.Mock;
const CODE = "a".repeat(43);

const user = {
  id: "u-9",
  username: "sso.user",
  email: "sso@rs.test",
  tenantId: "t-1",
  roleId: "r-1",
  mfaEnrolmentRequired: false,
};

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
  useAuthStore.setState({ user: null, isAuthenticated: false, error: null });
  mockedPost.mockResolvedValue({ success: true, status: 200, message: "Token is valid", data: user });
});

describe("SSO callback page", () => {
  it("redeems the code once, signs the user in and goes to the dashboard", async () => {
    mockParams = new URLSearchParams({ code: CODE });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const { container } = render(<SsoCallbackPage />);

    expect(await screen.findByRole("heading", { name: "Success" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/sso-session", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: CODE }),
    }));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/verify", {});
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: expect.objectContaining({ id: "u-9" }) });
    // The single-use code is taken out of the address bar.
    expect(window.location.search).toBe("");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("without a code it explains the failure, requests nothing, and offers the way back", async () => {
    const { container } = render(<SsoCallbackPage />);

    expect(await screen.findByRole("heading", { name: "Authentication Error" })).toBeInTheDocument();
    expect(screen.getByText(/code query parameter is missing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Login/ })).toHaveAttribute("href", "/login");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a refused code shows the route's message and does not sign in", async () => {
    mockParams = new URLSearchParams({ code: CODE });
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, status: 401, message: "The SSO code has expired" }),
    });
    render(<SsoCallbackPage />);

    expect(await screen.findByText("The SSO code has expired")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("a refusal with no readable body still says the sign-in failed", async () => {
    mockParams = new URLSearchParams({ code: CODE });
    fetchMock.mockResolvedValue({ ok: false, json: async () => { throw new SyntaxError("bad json"); } });
    render(<SsoCallbackPage />);

    expect(await screen.findByText("SSO Login failed")).toBeInTheDocument();
  });

  it("the page is shown as processing until the exchange answers", async () => {
    mockParams = new URLSearchParams({ code: CODE });
    fetchMock.mockReturnValue(new Promise(() => undefined));
    render(<SsoCallbackPage />);

    expect(screen.getByRole("heading", { name: "SSO Authentication" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
