/** @jest-environment jsdom */
/**
 * P10-06 (doc 20 §8, spec P10-05 § API) — the request-access page.
 *
 *  - fields carry their autocomplete tokens (SC 1.3.5); consent is NOT pre-ticked;
 *  - the honeypot is out of the tab order and hidden from assistive technology;
 *  - an empty submit shows a role="alert" summary linking each field, sends nothing;
 *  - a valid submit posts the contract body (consent version, locale, honeypot)
 *    to POST /api/v1/access-requests, and the success state replaces the form
 *    with its own <h1>, role="status", and promises no response time;
 *  - 400 with field details → those fields flagged; 429 → minutes from retryAfter;
 *    network → retry message; the backend's English never shows;
 *  - it never calls POST /auth/register.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { RequestAccessForm, normaliseWhatsapp, CONSENT_VERSION } from "../components/RequestAccessForm";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";

const mockedPost = api.post as jest.Mock;

const refusal = (status: number, body: Record<string, unknown> = {}) =>
  new AxiosError("refused", "ERR_BAD_REQUEST", { headers: new AxiosHeaders() }, {}, {
    status,
    statusText: String(status),
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { success: false, status, message: "Backend English", ...body },
  });

const NOTICE = "https://example.test/privacy-notice";
/** The consent label now carries the notice link (Q-42), so it is matched by its opening words. */
const CONSENT = new RegExp(`^${en["access.consent.before"].slice(0, 30)}`);

const renderForm = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <RequestAccessForm privacyNoticeUrl={NOTICE} />
    </MessagesProvider>,
  );

const fillValid = () => {
  fireEvent.change(screen.getByLabelText(en["access.organisationName"]), { target: { value: "RS Contoh Sehat" } });
  fireEvent.click(screen.getByLabelText(en["access.facility.hospital"]));
  fireEvent.change(screen.getByLabelText(en["access.city"]), { target: { value: "Bandung" } });
  fireEvent.change(screen.getByLabelText(en["access.deviceCountBand"]), { target: { value: "100_499" } });
  fireEvent.change(screen.getByLabelText(en["access.contactName"]), { target: { value: "Dewi Lestari" } });
  fireEvent.change(screen.getByLabelText(new RegExp(en["access.workEmail"])), { target: { value: "dewi@rs-contoh.test" } });
  fireEvent.change(screen.getByLabelText(en["access.whatsapp"]), { target: { value: "0812 3456 7890" } });
  fireEvent.click(screen.getByLabelText(CONSENT));
};

beforeEach(() => jest.clearAllMocks());

describe("P10-06: request access", () => {
  it("autocomplete tokens, unticked consent, an unreachable honeypot, one <h1>, axe-clean", async () => {
    const { container } = renderForm();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByLabelText(en["access.organisationName"])).toHaveAttribute("autocomplete", "organization");
    expect(screen.getByLabelText(en["access.city"])).toHaveAttribute("autocomplete", "address-level2");
    expect(screen.getByLabelText(en["access.contactName"])).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/Job title/)).toHaveAttribute("autocomplete", "organization-title");
    expect(screen.getByLabelText(en["access.workEmail"])).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(en["access.whatsapp"])).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByLabelText(CONSENT)).not.toBeChecked();

    const honeypot = container.querySelector<HTMLInputElement>('input[name="website"]');
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: en["access.honeypot"] })).not.toBeInTheDocument();

    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty submit lists every missing field in an alert and sends nothing", async () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));
    const alert = await screen.findByRole("alert");
    for (const key of ["access.organisationName", "access.city", "access.contactName", "access.workEmail", "access.whatsapp"] as const) {
      expect(alert).toHaveTextContent(en[key]);
    }
    expect(screen.getByLabelText(en["access.city"])).toHaveAttribute("aria-invalid", "true");
    expect(mockedPost).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a valid request posts the contract body and shows the success state", async () => {
    mockedPost.mockResolvedValue({ success: true, status: 202, message: "Request received", data: null });
    const { container } = renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));

    const title = await screen.findByRole("heading", { level: 1, name: en["access.success.title"] });
    expect(title.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: en["access.submit"] })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(mockedPost).toHaveBeenCalledTimes(1);
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
    expect(mockedPost.mock.calls.some(([url]) => String(url).includes("/auth/register"))).toBe(false);
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    [refusal(429, { retryAfter: 1800 }), "Too many requests from this network. Try again in 30 minutes."],
    [new AxiosError("Network Error", "ERR_NETWORK", { headers: new AxiosHeaders() }, {}), en["access.error.network"]],
    [refusal(500), en["access.error.server"]],
  ])("a failed send shows the dictionary sentence (%#)", async (err, shown) => {
    mockedPost.mockRejectedValue(err);
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(shown);
    expect(alert).not.toHaveTextContent("Backend English");
  });

  it("a 400 naming fields flags those fields", async () => {
    mockedPost.mockRejectedValue(refusal(400, { errors: [{ field: "workEmail", message: "Invalid email" }] }));
    renderForm();
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: en["access.submit"] }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText(en["access.workEmail"])).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Invalid email")).not.toBeInTheDocument();
  });

  it("normalises a WhatsApp number the way the backend does", () => {
    expect(normaliseWhatsapp("0812-3456 7890")).toBe("+6281234567890");
    expect(normaliseWhatsapp("62 812 3456 7890")).toBe("+6281234567890");
    expect(normaliseWhatsapp("+62 (812) 3456.7890")).toBe("+6281234567890");
  });
});
