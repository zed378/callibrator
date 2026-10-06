/** @jest-environment jsdom */
/**
 * P10-17 (ADR-118, brief §19) — the auth surface's new PRESENTATION, proved
 * not to change behaviour:
 *
 *  - request access: the two-section progress follows focus; nothing is hidden
 *    and the submitted payload is byte-for-byte the contract body P10-06 pins;
 *  - inline validation on blur (not while typing), with the submit rules;
 *  - the success state summarises, lists the three honest next steps, and
 *    promises no time;
 *  - sign-in: the identifier and password hints appear on blur only; the OTP
 *    field takes a pasted "123 456" whole (inputmode numeric, one-time-code).
 */
import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/components/auth/Spinner", () => function Spinner() {
  return <span data-testid="spinner" />;
});

import { api } from "@/api/client";
import { RequestAccessForm, CONSENT_VERSION } from "../components/RequestAccessForm";
import IdentifierForm from "@/app/login/components/IdentifierForm";
import PasswordLoginForm from "@/app/login/components/PasswordLoginForm";
import MfaLoginForm from "@/app/login/components/MfaLoginForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";

const mockedPost = api.post as jest.Mock;
const CONSENT = new RegExp(`^${en["access.consent.before"].slice(0, 30)}`);

const renderForm = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <RequestAccessForm privacyNoticeUrl="https://example.test/privacy-notice" />
    </MessagesProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe("P10-17: request access presentation", () => {
  it("progress follows focus; every field stays on the page; the payload is the P10-06 contract", async () => {
    mockedPost.mockResolvedValue({ data: { success: true, status: 202 } });
    const { container } = renderForm();
    const steps = container.querySelectorAll(".auth-progress > li");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toHaveAttribute("aria-current", "step");

    fireEvent.change(screen.getByLabelText(en["access.organisationName"]), { target: { value: "RS Contoh Sehat" } });
    fireEvent.click(screen.getByLabelText(en["access.facility.hospital"]));
    fireEvent.change(screen.getByLabelText(en["access.city"]), { target: { value: "Bandung" } });
    fireEvent.change(screen.getByLabelText(en["access.deviceCountBand"]), { target: { value: "100_499" } });
    fireEvent.focus(screen.getByLabelText(en["access.contactName"]));
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).toHaveAttribute("data-done", "true");
    fireEvent.change(screen.getByLabelText(en["access.contactName"]), { target: { value: "Dewi Lestari" } });
    fireEvent.blur(screen.getByLabelText(en["access.contactName"]));
    fireEvent.change(screen.getByLabelText(new RegExp(en["access.workEmail"])), { target: { value: "dewi@rs-contoh.test" } });
    fireEvent.change(screen.getByLabelText(en["access.whatsapp"]), { target: { value: "0812 3456 7890" } });
    fireEvent.click(screen.getByLabelText(CONSENT));
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/access-requests", {
      organisationName: "RS Contoh Sehat",
      facilityType: "hospital",
      city: "Bandung",
      deviceCountBand: "100_499",
      contactName: "Dewi Lestari",
      workEmail: "dewi@rs-contoh.test",
      whatsapp: "0812 3456 7890",
      consent: true,
      consentVersion: CONSENT_VERSION,
      locale: "en",
      website: "",
    });

    // Success: a summary, the three honest next steps, no promised time.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("The request for RS Contoh Sehat, in the name of Dewi Lestari, is on record.");
    for (const k of ["landing.work.step1", "landing.work.step2", "landing.work.step3"] as const) {
      expect(status).toHaveTextContent(en[k]);
    }
    expect(status.textContent ?? "").not.toMatch(/\b\d+\s*(hours?|days?|jam|hari)\b/i);
  });

  it("validates on blur, not while typing; an untouched empty field is not flagged; a blur never grows the summary", () => {
    renderForm();
    const email = screen.getByLabelText(new RegExp(en["access.workEmail"]));
    fireEvent.blur(email);
    expect(screen.queryByText(en["access.error.email"])).not.toBeInTheDocument();
    fireEvent.change(email, { target: { value: "dewi@" } });
    expect(screen.queryByText(en["access.error.email"])).not.toBeInTheDocument();
    fireEvent.blur(email);
    expect(screen.getByText(en["access.error.email"])).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    // The error appears beside the field only — the summary (submit-time) stays empty.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Editing clears it at once; a valid blur adds nothing.
    fireEvent.change(email, { target: { value: "dewi@rs-contoh.test" } });
    expect(screen.queryByText(en["access.error.email"])).not.toBeInTheDocument();
    fireEvent.blur(email);
    expect(screen.queryByText(en["access.error.email"])).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("after a failed submit, fixing a field shrinks the summary while editing, never on blur", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));
    const alert = screen.getByRole("alert");
    const before = alert.querySelectorAll("li").length;
    expect(before).toBeGreaterThan(3);
    fireEvent.change(screen.getByLabelText(en["access.organisationName"]), { target: { value: "RS Contoh Sehat" } });
    expect(screen.getByRole("alert").querySelectorAll("li").length).toBe(before - 1);
    fireEvent.blur(screen.getByLabelText(en["access.organisationName"]));
    expect(screen.getByRole("alert").querySelectorAll("li").length).toBe(before - 1);
  });
});

describe("P10-17: sign-in presentation", () => {
  const wrap = (ui: React.ReactElement) => render(<MessagesProvider locale="en" messages={en}>{ui}</MessagesProvider>);

  function Identifier() {
    const [v, setV] = useState("");
    return <IdentifierForm username={v} setUsername={setV} onSubmit={(e) => e.preventDefault()} isLoading={false} />;
  }

  it("the identifier hint appears on blur when empty, and is tied to the field", () => {
    wrap(<Identifier />);
    const field = screen.getByLabelText(en["auth.login.identifier"]);
    expect(screen.queryByText(en["auth.login.identifierRequired"])).not.toBeInTheDocument();
    fireEvent.blur(field);
    expect(screen.getByText(en["auth.login.identifierRequired"])).toHaveAttribute("id", "username-hint");
    expect(field).toHaveAttribute("aria-describedby", "username-hint");
    fireEvent.change(field, { target: { value: "dewi" } });
    expect(screen.queryByText(en["auth.login.identifierRequired"])).not.toBeInTheDocument();
  });

  it("the password hint appears on blur when empty; autocomplete stays current-password", () => {
    wrap(
      <PasswordLoginForm
        username="dewi"
        password=""
        setPassword={() => undefined}
        onSubmit={(e) => e.preventDefault()}
        onChangeAccount={() => undefined}
        isLoading={false}
        showPassword={false}
        setShowPassword={() => undefined}
        errorId="login-error"
      />,
    );
    const field = screen.getByLabelText(en["auth.login.password"]);
    expect(field).toHaveAttribute("autocomplete", "current-password");
    fireEvent.blur(field);
    expect(screen.getByText(en["auth.login.passwordRequired"])).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-describedby", "password-hint login-error");
  });

  it("the OTP field takes a pasted code whole", () => {
    function Mfa() {
      const [code, setCode] = useState("");
      return <MfaLoginForm code={code} setCode={setCode} onSubmit={(e) => e.preventDefault()} onBack={() => undefined} isLoading={false} />;
    }
    wrap(<Mfa />);
    const field = screen.getByLabelText(en["auth.mfa.title"]);
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(field, { target: { value: "123 456" } });
    expect(field).toHaveValue("123456");
    expect(screen.getByRole("button", { name: en["auth.mfa.submit"] })).toBeEnabled();
  });
});
