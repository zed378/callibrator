/**
 * SSO settings: SAML metadata import (F-66) and the dialog's reset when it is
 * opened for another tenant (F-03 moved that reset out of an effect).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const tenantService = { getSettings: jest.fn(), updateSettings: jest.fn() };
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));

import { parseXmlMetadata } from "./parseXmlMetadata";
import { useSsoSettings } from "./useSsoSettings";
import type { Tenant } from "@/types";

const CERT = "MIIC" + "A".repeat(100);

const prefixed = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://idp.example/entity">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${CERT}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example/redirect"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

const unprefixed = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="urn:idp">
  <IDPSSODescriptor><SingleSignOnService Binding="urn:x:HTTP-POST" Location="https://idp/post"/></IDPSSODescriptor>
</EntityDescriptor>`;

describe("parseXmlMetadata (F-66)", () => {
  it("reads PREFIXED metadata: entity id, the HTTP-Redirect SSO URL, and the certificate as PEM", () => {
    const out = parseXmlMetadata(prefixed);
    expect(out.entityId).toBe("https://idp.example/entity");
    expect(out.entryPoint).toBe("https://idp.example/redirect");
    expect(out.cert.startsWith("-----BEGIN CERTIFICATE-----\nMIIC")).toBe(true);
    expect(out.cert.endsWith("-----END CERTIFICATE-----")).toBe(true);
  });

  it("reads unprefixed metadata, falling back to the first SSO service", () => {
    expect(parseXmlMetadata(unprefixed)).toEqual({
      entityId: "urn:idp",
      entryPoint: "https://idp/post",
      cert: "",
    });
  });

  it("refuses malformed XML with an actionable message", () => {
    expect(() => parseXmlMetadata("<not-closed")).toThrow(/Failed to parse SAML XML Metadata/);
  });
});

describe("useSsoSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tenantService.getSettings.mockResolvedValue({ settings: { sso_enabled: "true", sso_idp_entity_id: "urn:saved" } });
    tenantService.updateSettings.mockResolvedValue({});
  });

  it("loads the tenant's settings; opening another tenant resets the transient state", async () => {
    const tA = { id: "tA", code: "A" } as Tenant;
    const tB = { id: "tB", code: "B" } as Tenant;
    const { result, rerender } = renderHook(({ t }) => useSsoSettings(t, () => {}), {
      initialProps: { t: tA as Tenant | null },
    });
    await waitFor(() => expect(result.current.form.sso_idp_entity_id).toBe("urn:saved"));
    expect(result.current.form.sso_enabled).toBe(true);
    expect(result.current.defaultAcsUrl).toMatch(/\/api\/v1\/auth\/sso\/callback\/A$/);

    act(() => {
      result.current.setActiveTab("xml");
      result.current.setXmlContent("<junk");
    });
    act(() => result.current.handleXmlParse());
    expect(result.current.xmlError).toMatch(/Failed to parse/);

    rerender({ t: tB });
    expect(result.current.activeTab).toBe("config");
    expect(result.current.xmlContent).toBe("");
    expect(result.current.xmlError).toBeNull();
    await waitFor(() => expect(tenantService.getSettings).toHaveBeenCalledWith("tB"));
  });

  it("an imported metadata file fills the IdP fields and returns to the config tab; save persists them", async () => {
    // A stable tenant, as the real caller passes: an inline object would be a
    // new dependency of the load effect on every render.
    const tenant = { id: "tA", code: "A" } as Tenant;
    const onClose = () => {};
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(tenantService.getSettings).toHaveBeenCalled());
    act(() => {
      result.current.setActiveTab("xml");
      result.current.setXmlContent(prefixed);
    });
    act(() => result.current.handleXmlParse());
    expect(result.current.xmlSuccess).toBe(true);
    expect(result.current.activeTab).toBe("config");
    expect(result.current.form.sso_idp_entry_point).toBe("https://idp.example/redirect");

    await act(async () =>
      result.current.handleSave({ preventDefault: jest.fn() } as unknown as React.FormEvent),
    );
    expect(tenantService.updateSettings).toHaveBeenCalledWith(
      "tA",
      expect.objectContaining({ sso_idp_entry_point: "https://idp.example/redirect" }),
    );
    expect(result.current.saveSuccess).toBe(true);
  });
});
