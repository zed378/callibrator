/**
 * useSsoSettings — what sso.test.ts does not cover: settings that failed to
 * load must never be saved over the stored ones, a refused save, a boolean
 * sso_enabled, the save banner timing out, copy feedback, reading a metadata
 * file, and a closed dialog. The real tenantStore runs; tenantService is
 * mocked (getSettings returns the envelope's `data`: `{ settings }`).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const tenantService = { getSettings: jest.fn(), updateSettings: jest.fn() };
jest.mock("@/api/services/tenant.service", () => ({ tenantService }));

import { useSsoSettings } from "../useSsoSettings";
import { useTenantStore } from "@/stores/tenantStore";
import type { Tenant } from "@/types";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const tenant = { id: "tA", code: "RSA" } as Tenant;
const onClose = () => {};
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });

beforeEach(() => {
  jest.clearAllMocks();
  useTenantStore.setState({ settings: null, isLoading: false, error: null });
  jest.spyOn(console, "error").mockImplementation(() => {});
  tenantService.getSettings.mockResolvedValue({
    settings: {
      sso_enabled: true, sso_idp_entry_point: "https://idp/sso", sso_idp_entity_id: "urn:idp",
      sso_idp_cert: "CERT", sso_sp_entity_id: "urn:sp", sso_sp_callback_url: "https://sp/acs",
    },
  });
  tenantService.updateSettings.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("useSsoSettings", () => {
  it("a boolean sso_enabled and saved SP values are shown in place of the defaults", async () => {
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(result.current.form.sso_enabled).toBe(true));
    expect(result.current.currentSpEntityId).toBe("urn:sp");
    expect(result.current.currentAcsUrl).toBe("https://sp/acs");
    expect(result.current.defaultSpEntityId).toMatch(/\/api\/v1\/auth\/sso\/metadata\/RSA$/);
  });

  it("a tenant with no settings row gets an empty, disabled form", async () => {
    tenantService.getSettings.mockResolvedValueOnce({});
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(tenantService.getSettings).toHaveBeenCalledWith("tA"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.form).toEqual({
      sso_enabled: false, sso_idp_entry_point: "", sso_idp_entity_id: "", sso_idp_cert: "",
      sso_sp_entity_id: "", sso_sp_callback_url: "",
    });
    expect(result.current.currentSpEntityId).toBe(result.current.defaultSpEntityId);
  });

  it("settings that failed to load are never saved over the stored configuration", async () => {
    tenantService.getSettings.mockRejectedValueOnce(httpError(429, "Too many requests"));
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(result.current.error).toBe("Too many requests"));
    // The form is still the blank default: saving it would disable SSO and
    // erase the IdP certificate for every user of this tenant.
    expect(result.current.form.sso_idp_cert).toBe("");
    await act(async () => result.current.handleSave(ev));
    expect(tenantService.updateSettings).not.toHaveBeenCalled();
    expect(result.current.saveSuccess).toBe(false);
  });

  it("reopening after a failed load loads again and allows saving once it succeeds", async () => {
    tenantService.getSettings.mockRejectedValueOnce(httpError(500, "boom"));
    const { result, rerender } = renderHook(({ t }) => useSsoSettings(t, onClose), {
      initialProps: { t: tenant as Tenant | null },
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
    rerender({ t: null });
    rerender({ t: { ...tenant } as Tenant });
    await waitFor(() => expect(result.current.form.sso_idp_cert).toBe("CERT"));
    await act(async () => result.current.handleSave(ev));
    expect(tenantService.updateSettings).toHaveBeenCalledWith("tA", expect.objectContaining({ sso_idp_cert: "CERT" }));
  });

  it("a refused save leaves the success banner off and the store's error set", async () => {
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(result.current.form.sso_enabled).toBe(true));
    tenantService.updateSettings.mockRejectedValueOnce(httpError(400, "sso_idp_cert must be a PEM certificate"));
    await act(async () => result.current.handleSave(ev));
    expect(result.current.saveSuccess).toBe(false);
    expect(result.current.error).toBe("sso_idp_cert must be a PEM certificate");
  });

  it("the save banner clears after three seconds; without a tenant nothing is saved", async () => {
    const { result } = renderHook(() => useSsoSettings(tenant, onClose));
    await waitFor(() => expect(result.current.form.sso_enabled).toBe(true));
    jest.useFakeTimers();
    try {
      await act(async () => result.current.handleSave(ev));
      expect(result.current.saveSuccess).toBe(true);
      act(() => jest.advanceTimersByTime(3000));
      expect(result.current.saveSuccess).toBe(false);
    } finally {
      jest.useRealTimers();
    }

    const closed = renderHook(() => useSsoSettings(null, onClose));
    await act(async () => closed.result.current.handleSave(ev));
    expect(tenantService.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("copy writes the value and marks the field copied for two seconds", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { result } = renderHook(() => useSsoSettings(null, onClose));
    jest.useFakeTimers();
    try {
      await act(async () => result.current.handleCopy("urn:sp", "entityId"));
      expect(writeText).toHaveBeenCalledWith("urn:sp");
      expect(result.current.copiedField).toBe("entityId");
      expect(result.current.copyError).toBeNull();
      act(() => jest.advanceTimersByTime(2000));
      expect(result.current.copiedField).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("F-19: a refused clipboard write reports an error and never shows the field as copied", async () => {
    const writeText = jest.fn().mockRejectedValue(new DOMException("Write permission denied.", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const { result } = renderHook(() => useSsoSettings(null, onClose));
    await act(async () => result.current.handleCopy("urn:sp", "entity"));
    expect(writeText).toHaveBeenCalledWith("urn:sp");
    expect(result.current.copiedField).toBeNull();
    expect(result.current.copyError).toMatch(/could not copy/i);
    // A later copy that succeeds clears the error.
    writeText.mockResolvedValueOnce(undefined);
    await act(async () => result.current.handleCopy("urn:sp", "entity"));
    expect(result.current.copyError).toBeNull();
    expect(result.current.copiedField).toBe("entity");
  });

  it("F-19: no Clipboard API at all (insecure origin) is reported, not shown as copied", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    const { result } = renderHook(() => useSsoSettings(null, onClose));
    await act(async () => result.current.handleCopy("urn:sp", "acs"));
    expect(result.current.copiedField).toBeNull();
    expect(result.current.copyError).toMatch(/could not copy/i);
  });

  it("a chosen metadata file is read into the XML box; no file does nothing", async () => {
    const { result } = renderHook(() => useSsoSettings(null, onClose));
    act(() => result.current.handleXmlFileUpload({ target: { files: [] } } as unknown as React.ChangeEvent<HTMLInputElement>));
    expect(result.current.xmlContent).toBe("");
    const file = new File(["<EntityDescriptor/>"], "idp.xml", { type: "text/xml" });
    act(() => result.current.handleXmlFileUpload({ target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>));
    await waitFor(() => expect(result.current.xmlContent).toBe("<EntityDescriptor/>"));
  });
});
