/** @jest-environment jsdom */
/**
 * The OAuth/OIDC consent screen, against the backend contract
 * (oidc.route.js, oidcProvider.controller.js):
 *  - GET  /api/v1/oidc/authorize/request/:id → `data: { clientName, scope[], redirectUri }`;
 *    another tenant's or an unknown request is a 404;
 *  - POST /api/v1/oidc/authorize/decision `{ request, approve }` →
 *    `data: { redirectTo }` (with the code, or error=access_denied).
 *
 * What the user is shown before deciding (who is asking, for what, and where
 * they will be sent), and exactly what is posted on Allow and on Deny.
 *
 * Real: the page and oidc.service. Mocked: `@/api/client`'s transport. jsdom
 * implements no cross-document navigation, so the hand-back to the client is
 * observed as jsdom's "navigation" report.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useSearchParams: () => mockParams,
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import OidcConsentPage from "../page";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const REQUEST_ID = "req_abc123";
const envelope = (data: unknown, message = "Authorization request") => ({
  success: true,
  status: 200,
  message,
  data,
  meta: null,
});
const staged = {
  clientName: "Lab Analytics",
  scope: ["openid", "email", "custom:read"],
  redirectUri: "https://analytics.example/callback",
};

let consoleError: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams({ request: REQUEST_ID });
  // jsdom reports the hand-back navigation as "Not implemented: navigation".
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => consoleError.mockRestore());

const navigationAttempted = () =>
  consoleError.mock.calls.some((args) =>
    args.some((a: unknown) => String((a as Error)?.message ?? a).includes("navigation")),
  );

describe("OIDC consent page", () => {
  it("shows the client, a plain-language line per scope, and where the user will be sent", async () => {
    mockedGet.mockResolvedValue(envelope(staged));
    const { container } = render(<OidcConsentPage />);

    expect(await screen.findByText("Lab Analytics")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(`/api/v1/oidc/authorize/request/${REQUEST_ID}`);
    const scopes = screen.getAllByRole("listitem").map((li) => li.textContent);
    // Known scopes are explained; an unknown one is shown verbatim, never hidden.
    expect(scopes).toEqual(["Verify your identity", "Access your email address", "custom:read"]);
    expect(screen.getByText(/redirected to https:\/\/analytics\.example\/callback/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Allow posts approve=true for this request and hands the browser back to the client", async () => {
    mockedGet.mockResolvedValue(envelope(staged));
    let answer: (v: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<OidcConsentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));

    // While deciding, neither choice can be pressed again.
    expect(await screen.findByRole("button", { name: "Authorizing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/oidc/authorize/decision", {
      request: REQUEST_ID,
      approve: true,
    });

    answer(envelope({ redirectTo: "https://analytics.example/callback?code=xyz&state=s" }, "Authorization decision"));
    await waitFor(() => expect(navigationAttempted()).toBe(true));
  });

  it("Deny posts approve=false", async () => {
    mockedGet.mockResolvedValue(envelope(staged));
    mockedPost.mockResolvedValue(
      envelope({ redirectTo: "https://analytics.example/callback?error=access_denied" }, "Authorization decision"),
    );
    render(<OidcConsentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/oidc/authorize/decision", {
        request: REQUEST_ID,
        approve: false,
      }),
    );
    await waitFor(() => expect(navigationAttempted()).toBe(true));
  });

  it("a failed decision is shown and nothing navigates", async () => {
    mockedGet.mockResolvedValue(envelope(staged));
    mockedPost.mockRejectedValue(
      httpError(503, "The authorization could not be completed. Return to the application and sign in again."),
    );
    render(<OidcConsentPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));

    expect(
      await screen.findByText(/authorization could not be completed/),
    ).toBeInTheDocument();
    expect(navigationAttempted()).toBe(false);
  });

  it("an unknown, expired or other-tenant request (404) is one message, with no choice offered", async () => {
    mockedGet.mockRejectedValue(httpError(404, "Authorization request not found"));
    const { container } = render(<OidcConsentPage />);

    expect(
      await screen.findByText("This authorization request has expired or is invalid."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("with no request id nothing is fetched", async () => {
    mockParams = new URLSearchParams();
    render(<OidcConsentPage />);

    expect(await screen.findByText("Missing authorization request.")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });
});
