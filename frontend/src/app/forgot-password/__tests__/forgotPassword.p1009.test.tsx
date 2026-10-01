/** @jest-environment jsdom */
/**
 * P10-09 (doc 20 §9) — forgot and reset password, in the browser half.
 *
 *  - step 1: `autocomplete="email"`; the same neutral sentence follows whether
 *    the backend knows the address or not (the controller is neutral; the page
 *    also treats any non-429 refusal as "sent" so it cannot become an oracle);
 *  - a 429 answers with the wait from Retry-After, and the resend button counts
 *    down from it;
 *  - step 2: `one-time-code`, `new-password`, the backend's rule stated under
 *    the field before typing; a refused reset says one generic sentence that
 *    does not say whether the code or the email was wrong;
 *  - success goes to /login?status=reset.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { ForgotPasswordForm } from "../components/ForgotPasswordForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";

const mockedPost = api.post as jest.Mock;

const refusal = (status: number, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new AxiosError("refused", "ERR_BAD_REQUEST", { headers: new AxiosHeaders() }, {}, {
    status,
    statusText: String(status),
    headers,
    config: { headers: new AxiosHeaders() },
    data: { success: false, status, message: "Backend English", ...body },
  });

const renderForm = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <ForgotPasswordForm />
    </MessagesProvider>,
  );

const sendFor = async (email: string) => {
  fireEvent.change(screen.getByLabelText(en["reset.email"]), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: en["reset.send"] }));
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe("P10-09: forgot password", () => {
  it("step 1 is labelled, autocompletes the email, and is axe-clean", async () => {
    const { container } = renderForm();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en["reset.title"]);
    expect(screen.getByLabelText(en["reset.email"])).toHaveAttribute("autocomplete", "email");
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    ["a known address", async () => ({ success: true, message: "If the account exists, OTP has been sent" })],
    ["an unknown address", async () => ({ success: true, message: "If the account exists, OTP has been sent" })],
    ["a refusal other than 429", async () => Promise.reject(refusal(403))],
  ])("%s gets the same neutral sentence and the code step", async (_label, answer) => {
    mockedPost.mockImplementation(answer);
    const { container } = renderForm();
    await sendFor("someone@rs.test");

    expect(await screen.findByRole("status")).toHaveTextContent(en["reset.sent"]);
    expect(screen.getByLabelText(en["reset.code"])).toHaveAttribute("autocomplete", "one-time-code");
    const pw = screen.getByLabelText(en["reset.newPassword"]);
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(pw).toHaveAttribute("aria-describedby", "reset-rule");
    expect(screen.getByText(en["reset.rule"])).toBeInTheDocument();
    expect(screen.queryByText(/Backend English/)).not.toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/send-otp", { email: "someone@rs.test" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a 429 shows the wait and counts the resend down from Retry-After", async () => {
    mockedPost.mockRejectedValue(refusal(429, {}, { "retry-after": "120" }));
    renderForm();
    await sendFor("someone@rs.test");
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 2 minutes.");
    expect(screen.getByRole("button", { name: "Resend the code in 120 seconds" })).toBeDisabled();
  });

  it("a refused reset is one generic sentence; success returns to /login with a notice", async () => {
    mockedPost.mockImplementation(async (url: string, body: { otp?: string }) => {
      if (url === "/api/v1/auth/send-otp") return { success: true };
      if (body.otp === "111111") throw refusal(400, { message: "Invalid OTP" });
      return { success: true };
    });
    renderForm();
    await sendFor("someone@rs.test");
    await screen.findByLabelText(en["reset.code"]);

    fireEvent.change(screen.getByLabelText(en["reset.code"]), { target: { value: "111111" } });
    fireEvent.change(screen.getByLabelText(en["reset.newPassword"]), { target: { value: "NewPass123" } });
    fireEvent.click(screen.getByRole("button", { name: en["reset.submit"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en["reset.error.invalid"]);
    expect(screen.queryByText("Invalid OTP")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(en["reset.code"]), { target: { value: "222 222" } });
    fireEvent.click(screen.getByRole("button", { name: en["reset.submit"] }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login?status=reset"));
    expect(mockedPost).toHaveBeenLastCalledWith("/api/v1/auth/reset-password", {
      email: "someone@rs.test",
      otp: "222222",
      password: "NewPass123",
    });
  });

  it("a password that breaks the rule is stopped before the request", async () => {
    mockedPost.mockResolvedValue({ success: true });
    renderForm();
    await sendFor("someone@rs.test");
    await screen.findByLabelText(en["reset.code"]);
    fireEvent.change(screen.getByLabelText(en["reset.code"]), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(en["reset.newPassword"]), { target: { value: "short" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: en["reset.submit"] }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(en["reset.error.rule"]);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
