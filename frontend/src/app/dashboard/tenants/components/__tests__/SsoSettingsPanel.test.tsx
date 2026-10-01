/** @jest-environment jsdom */
/**
 * The SAML SSO dialog for one tenant, against the backend contract:
 * POST /api/v1/tenants/settings { tenantId } → data.settings (read), and
 * PATCH /api/v1/tenants/settings { tenantId, settings } (write).
 *
 * Real: the panel, its tabs, useSsoSettings, the tenant store and service.
 * Mocked: the HTTP client.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { SsoSettingsPanel } from "../SsoSettingsPanel";
import { useTenantStore } from "@/stores/tenantStore";
import type { Tenant } from "@/types";

jest.setTimeout(20000);

const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

const envelope = (data: unknown) => ({ success: true, status: 200, message: "ok", data });
const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const tenant = { id: "t-1", name: "RS Harapan", code: "RSH", status: "ACTIVE", limitSeats: 50, createdAt: "", updatedAt: "" } as Tenant;

const stored = {
  sso_enabled: "true",
  sso_idp_entry_point: "https://idp.example/sso",
  sso_idp_entity_id: "https://idp.example/entity",
  sso_idp_cert: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
  sso_sp_entity_id: "",
  sso_sp_callback_url: "",
};

const METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://okta.example/entity">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>MIICabc</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://okta.example/redirect"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

beforeEach(() => {
  jest.clearAllMocks();
  useTenantStore.setState({ isLoading: false, error: null, settings: null });
  post.mockResolvedValue(envelope({ tenantId: "t-1", settings: stored }));
  patch.mockResolvedValue(envelope(null));
});

const renderPanel = async (onClose = jest.fn()) => {
  const view = render(<SsoSettingsPanel tenant={tenant} onClose={onClose} />);
  await waitFor(() => expect(screen.getByLabelText(/Entry Point/)).toHaveValue("https://idp.example/sso"));
  return { ...view, onClose };
};

describe("SsoSettingsPanel", () => {
  it("renders nothing without a tenant", () => {
    const { container } = render(<SsoSettingsPanel tenant={null} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(post).not.toHaveBeenCalled();
  });

  it("loads the tenant's stored SAML settings into the form and passes an accessibility check", async () => {
    const { container } = await renderPanel();

    expect(post).toHaveBeenCalledWith("/api/v1/tenants/settings", { tenantId: "t-1" });
    expect(screen.getByRole("dialog", { name: "SSO SAML Configuration" })).toHaveTextContent("RS Harapan (RSH)");
    expect(screen.getByRole("checkbox", { name: "Enable SAML Single Sign-On" })).toBeChecked();
    expect(screen.getByLabelText(/Entity ID\)/)).toHaveValue("https://idp.example/entity");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("saves the edited settings and confirms it", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable SAML Single Sign-On" }));
    fireEvent.change(screen.getByLabelText(/Entry Point/), { target: { value: "https://idp.example/new" } });
    fireEvent.change(screen.getByLabelText(/Public Certificate/), { target: { value: "PEM" } });
    fireEvent.change(screen.getByLabelText("Override SP Entity ID"), { target: { value: "urn:sp" } });
    fireEvent.change(screen.getByLabelText("Override ACS Callback URL"), { target: { value: "https://sp/acs" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(await screen.findByText("SAML Configuration saved successfully!")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledWith("/api/v1/tenants/settings", {
      tenantId: "t-1",
      settings: {
        sso_enabled: false,
        sso_idp_entry_point: "https://idp.example/new",
        sso_idp_entity_id: "https://idp.example/entity",
        sso_idp_cert: "PEM",
        sso_sp_entity_id: "urn:sp",
        sso_sp_callback_url: "https://sp/acs",
      },
    });
  });

  it("a refused save shows the backend's reason and no success message", async () => {
    patch.mockRejectedValue(httpError(400, "sso_idp_cert must be a PEM certificate"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(await screen.findByText("sso_idp_cert must be a PEM certificate")).toBeInTheDocument();
    expect(screen.queryByText("SAML Configuration saved successfully!")).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("a failed load shows the backend's reason", async () => {
    post.mockRejectedValue(httpError(404, "Tenant not found"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    render(<SsoSettingsPanel tenant={tenant} onClose={jest.fn()} />);

    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("Cancel closes without saving — and is not the form's default button, so Enter in a field saves instead", async () => {
    const { onClose } = await renderPanel();
    const cancel = screen.getByRole("button", { name: "Cancel" });

    // Implicit submission (Enter) activates the form's FIRST submit button;
    // jsdom does not simulate it, so the button's type is what decides it.
    expect(cancel).toHaveAttribute("type", "button");
    fireEvent.click(cancel);

    expect(onClose).toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("the SP tab lists the service-provider URLs and copies one", async () => {
    const writeText = jest.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "SP Parameters" }));
    expect(screen.getAllByText(/\/api\/v1\/auth\/sso\/metadata\/RSH$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/\/api\/v1\/auth\/sso\/callback\/RSH$/)).toBeInTheDocument();

    jest.useFakeTimers();
    // The copy awaits the clipboard write before it says "Copied!".
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Copy/ })[1]);
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/auth\/sso\/callback\/RSH$/));
    expect(screen.getByRole("button", { name: /Copied!/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByRole("button", { name: /Copied!/ })).not.toBeInTheDocument();
    jest.useRealTimers();
  });

  it("F-19: a refused clipboard write says so and never shows Copied!", async () => {
    const writeText = jest.fn().mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"));
    Object.assign(navigator, { clipboard: { writeText } });
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "SP Parameters" }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Copy/ })[0]);
    });
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not copy/i);
    expect(screen.queryByRole("button", { name: /Copied!/ })).not.toBeInTheDocument();
  });

  it("importing IdP metadata fills the SAML fields and returns to the settings tab", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Import Metadata XML" }));
    const importButton = screen.getByRole("button", { name: "Import Configuration Parameters" });
    expect(importButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Paste Metadata XML/), { target: { value: METADATA } });
    fireEvent.click(importButton);

    expect(await screen.findByText("Metadata XML imported successfully!")).toBeInTheDocument();
    expect(screen.getByLabelText(/Entry Point/)).toHaveValue("https://okta.example/redirect");
    expect(screen.getByLabelText(/Entity ID\)/)).toHaveValue("https://okta.example/entity");
    expect(screen.getByLabelText(/Public Certificate/)).toHaveValue(
      "-----BEGIN CERTIFICATE-----\nMIICabc\n-----END CERTIFICATE-----",
    );
  });

  it("invalid metadata is refused with an explanation and the fields are untouched", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Import Metadata XML" }));
    fireEvent.change(screen.getByLabelText(/Paste Metadata XML/), { target: { value: "<not-xml" } });
    fireEvent.click(screen.getByRole("button", { name: "Import Configuration Parameters" }));

    expect(await screen.findByText(/Failed to parse SAML XML Metadata/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SAML Settings" }));
    expect(screen.getByLabelText(/Entry Point/)).toHaveValue("https://idp.example/sso");
  });

  it("an uploaded metadata file fills the paste box", async () => {
    const { container } = await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Import Metadata XML" }));

    const input = container.ownerDocument.querySelector('input[type="file"][accept=".xml"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([METADATA], "idp.xml", { type: "text/xml" })] } });

    await waitFor(() => expect(screen.getByLabelText(/Paste Metadata XML/)).toHaveValue(METADATA));
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Import Configuration Parameters" })).toBeEnabled();
  });
});
