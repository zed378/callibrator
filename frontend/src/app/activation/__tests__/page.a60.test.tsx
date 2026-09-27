/** @jest-environment jsdom */
/**
 * A-60 item 3 (ADR-075, Q-11) — the activation link lands on a page.
 *
 * Registration and an email change mail `<origin>/activation?token=…`. No
 * page answered that path, so every activation link was a 404 and an address
 * could never be verified through the application. Fail-before: the module
 * `../page` does not exist.
 *
 * Real: the page. Mocked: next/navigation's search params and the auth API
 * client (its call is observed).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

let mockToken: string | null = "activation-token";
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => (key === "token" ? mockToken : null) }),
}));

jest.mock("@/api/services/auth.service", () => ({
  authService: { activateAccount: jest.fn() },
}));

import ActivationPage from "../page";
import { authService } from "@/api/services/auth.service";

const activate = authService.activateAccount as jest.Mock;

beforeEach(() => {
  activate.mockReset();
  mockToken = "activation-token";
  window.history.replaceState(null, "", "/activation?token=activation-token");
});

describe("A-60 — /activation", () => {
  it("spends the token once and says the address is verified", async () => {
    activate.mockResolvedValue(undefined);

    render(<ActivationPage />);

    expect(await screen.findByRole("heading", { name: "Email address verified" })).toBeTruthy();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith("activation-token");
    expect(screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href")).toBe("/login");
  });

  it("removes the token from the address bar", async () => {
    activate.mockResolvedValue(undefined);

    render(<ActivationPage />);

    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/activation");
  });

  it("shows the backend's explanation when the link is refused", async () => {
    activate.mockRejectedValue(new Error("This activation link was sent to an address this account no longer uses"));

    render(<ActivationPage />);

    expect(await screen.findByRole("heading", { name: "Verification failed" })).toBeTruthy();
    expect(screen.getByText("This activation link was sent to an address this account no longer uses")).toBeTruthy();
  });

  it("falls back to a generic message when the failure carries none", async () => {
    activate.mockRejectedValue("network down");

    render(<ActivationPage />);

    expect(await screen.findByText("This activation link could not be used.")).toBeTruthy();
  });

  it("a link without a token is refused without calling the API", async () => {
    mockToken = null;

    render(<ActivationPage />);

    expect(await screen.findByText(/This activation link is incomplete/)).toBeTruthy();
    expect(activate).not.toHaveBeenCalled();
  });
});
