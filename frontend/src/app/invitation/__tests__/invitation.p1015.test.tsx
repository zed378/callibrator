/** @jest-environment jsdom */
/**
 * P10-15 (doc 20 §8.2) — accepting an invitation, browser half.
 *
 *  - the token is read from ?token= and removed from the address bar;
 *  - `new-password` fields, the rule stated before typing, submit disabled until
 *    the rule and the confirmation hold;
 *  - POST /api/v1/auth/invitation/accept { token, password } → /login?status=invited;
 *  - the backend's one generic 400 (bad, used, expired token) → the "no longer
 *    valid" sentence; no token at all → the same sentence, no form.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => mockParams,
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { InvitationForm } from "../components/InvitationForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";

const mockedPost = api.post as jest.Mock;

const renderForm = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <InvitationForm />
    </MessagesProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams({ token: "inv-token-123" });
  window.history.replaceState(null, "", "/invitation?token=inv-token-123");
});

describe("P10-15: invitation", () => {
  it("strips the token from the address bar, sets the password and goes to sign-in", async () => {
    mockedPost.mockResolvedValue({ success: true });
    const { container } = renderForm();
    await waitFor(() => expect(window.location.search).toBe(""));

    const pw = screen.getByLabelText(en["auth.first.newPassword"]);
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(pw).toHaveAttribute("aria-describedby", "invite-rule");
    const submit = screen.getByRole("button", { name: en["invite.submit"] });
    expect(submit).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(pw, { target: { value: "Chosen-Pass-42" } });
    fireEvent.change(screen.getByLabelText(en["auth.first.confirm"]), { target: { value: "Chosen-Pass-42" } });
    fireEvent.click(submit);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login?status=invited"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/invitation/accept", {
      token: "inv-token-123",
      password: "Chosen-Pass-42",
    });
  });

  it("the backend's generic 400 reads as an invitation that is no longer valid", async () => {
    mockedPost.mockRejectedValue(
      new AxiosError("bad", "ERR_BAD_REQUEST", { headers: new AxiosHeaders() }, {}, {
        status: 400,
        statusText: "400",
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { success: false, status: 400, message: "This invitation link is invalid or has expired" },
      }),
    );
    renderForm();
    fireEvent.change(screen.getByLabelText(en["auth.first.newPassword"]), { target: { value: "Chosen-Pass-42" } });
    fireEvent.change(screen.getByLabelText(en["auth.first.confirm"]), { target: { value: "Chosen-Pass-42" } });
    fireEvent.click(screen.getByRole("button", { name: en["invite.submit"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en["invite.expired"]);
    expect(screen.queryByRole("button", { name: en["invite.submit"] })).not.toBeInTheDocument();
  });

  it("no token: the no-longer-valid sentence and no form", () => {
    mockParams = new URLSearchParams();
    renderForm();
    expect(screen.getByRole("alert")).toHaveTextContent(en["invite.expired"]);
    expect(screen.queryByLabelText(en["auth.first.newPassword"])).not.toBeInTheDocument();
  });
});
